/**
 * Reviews Sync Worker
 *
 * Fetches review summaries from Steam Reviews API for apps due for sync.
 * Uses Postgres-coordinated claiming plus a shared review API token budget
 * so multiple workers can scale safely without overshooting Steam limits.
 *
 * Run with: pnpm --filter @publisheriq/ingestion reviews-sync
 */

import { randomUUID } from 'node:crypto';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import {
  ClaimAppsTimeoutError,
  acquireApiRateToken as acquireSharedApiRateToken,
  claimAppsForReviewsSync as claimReviewApps,
  releaseReviewClaims as releaseClaimedReviewApps,
  type ClaimedReviewApp,
  type ReviewLane,
} from '@publisheriq/database/ingestion';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchReviewSummary } from '../apis/reviews.js';
import { withRetry } from '../utils/retry.js';
import {
  loadPreviousReviewSyncData,
  persistReviewSummary,
  type PreviousReviewSyncData,
} from '../workers-support/reviews-persistence.js';

const log = logger.child({ worker: 'reviews-sync' });

const CONCURRENCY = 8;
const DEFAULT_CLAIM_BATCH_SIZE = 100;
const DEFAULT_CLAIM_TTL_MINUTES = 15;
const DEFAULT_MAX_RUNTIME_MINUTES = 45;
const DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD = 3;
const DEFAULT_IDLE_DELAY_MS = 1500;
const DEFAULT_LAUNCH_LIMIT = 25;
const DEFAULT_CHANGE_LIMIT = 20;
const DEFAULT_ACTIVE_LIMIT = 35;
const DEFAULT_BACKFILL_LIMIT = 19;
const DEFAULT_UNKNOWN_LIMIT = 1;
const DEFAULT_CLAIM_TIMEOUT_RETRIES = 3;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type ReviewDbClient = SupabaseClient | null;

interface SyncStats {
  appsProcessed: number;
  appsCreated: number;
  appsUpdated: number;
  appsFailed: number;
  claimRounds: number;
  claimsRequested: number;
  claimedApps: number;
  emptyClaims: number;
  rateTokenSleeps: number;
  tokenWaitMs: number;
  claimLatencyMsTotal: number;
  claimLatencySamples: number;
  lastClaimLatencyMs: number;
  claimTimeouts: number;
  consecutiveClaimTimeouts: number;
  laneClaims: Record<ReviewLane, number>;
}

function getDb(supabase: SupabaseClient): any {
  return supabase as any;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function calculateFailureBackoffMinutes(consecutiveErrors: number): number {
  const cappedErrors = Math.max(1, Math.min(consecutiveErrors, 6));
  return Math.min(15 * 2 ** (cappedErrors - 1), 360);
}

function createEmptyLaneCounts(): Record<ReviewLane, number> {
  return {
    launch_critical: 0,
    change_critical: 0,
    active_reviews: 0,
    important_backfill: 0,
    unknown_sweep: 0,
  };
}

function recordLaneClaims(stats: SyncStats, claimedApps: ClaimedReviewApp[]): Record<ReviewLane, number> {
  const laneCounts = createEmptyLaneCounts();

  for (const app of claimedApps) {
    laneCounts[app.lane] += 1;
    stats.laneClaims[app.lane] += 1;
  }

  return laneCounts;
}

async function releaseReviewClaims(
  appids: number[],
  workerId: string
): Promise<void> {
  if (appids.length === 0) {
    return;
  }

  try {
    await releaseClaimedReviewApps({ appids, workerId });
  } catch (error) {
    log.warn('Failed to release stale review claims', {
      workerId,
      claimCount: appids.length,
      error: formatUnknownError(error),
    });
  }
}

async function waitForReviewRateToken(
  workerId: string,
  stats: SyncStats
): Promise<void> {
  while (true) {
    const result = await acquireSharedApiRateToken({
      source: 'reviews',
      workerId,
    });

    if (result.granted) {
      return;
    }

    const waitMs = Math.max(1, result.waitMs || 1000);
    stats.rateTokenSleeps += 1;
    stats.tokenWaitMs += waitMs;
    await sleep(waitMs);
  }
}

async function loadPreviousSyncData(
  supabase: ReviewDbClient,
  appIds: number[],
  env: NodeJS.ProcessEnv,
  tiger: TigerWriter | null
): Promise<{ previousSyncData: Map<number, PreviousReviewSyncData>; neverSyncedSet: Set<number> }> {
  return loadPreviousReviewSyncData(supabase, appIds, {
    env,
    tiger: tiger ?? undefined,
  });
}

async function markAppFailure(
  appid: number,
  supabase: ReviewDbClient,
  previous: PreviousReviewSyncData | undefined,
  errorMessage: string,
  tiger: TigerWriter | null
): Promise<void> {
  const nextErrorCount = (previous?.consecutiveErrors ?? 0) + 1;
  const nextRetryAt = new Date(
    Date.now() + calculateFailureBackoffMinutes(nextErrorCount) * 60 * 1000
  ).toISOString();

  if (tiger) {
    await tiger.syncStatus.updateFields(appid, {
      consecutive_errors: nextErrorCount,
      last_error_source: 'reviews',
      last_error_message: errorMessage,
      last_error_at: new Date().toISOString(),
      next_reviews_sync: nextRetryAt,
      reviews_claimed_by: null,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
    });
    return;
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy reviews failure persistence');
  }

  const { error } = await getDb(supabase)
    .from('sync_status')
    .update({
      consecutive_errors: nextErrorCount,
      last_error_source: 'reviews',
      last_error_message: errorMessage,
      last_error_at: new Date().toISOString(),
      next_reviews_sync: nextRetryAt,
      reviews_claimed_by: null,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
    })
    .eq('appid', appid);

  if (error) {
    log.warn('Failed to persist reviews failure state', {
      appid,
      error: error.message,
    });
  }
}

async function processApp(
  app: ClaimedReviewApp,
  supabase: ReviewDbClient,
  workerId: string,
  today: string,
  previousSyncData: Map<number, PreviousReviewSyncData>,
  neverSyncedSet: Set<number>,
  stats: SyncStats,
  env: NodeJS.ProcessEnv,
  tiger: TigerWriter | null
): Promise<void> {
  const appid = app.appid;
  stats.appsProcessed += 1;

  try {
    await waitForReviewRateToken(workerId, stats);

    const summary = await fetchReviewSummary(appid);
    if (!summary) {
      throw new Error('Steam did not return a reviews summary');
    }

    const previous = previousSyncData.get(appid);
    await persistReviewSummary({
      appid,
      env,
      previous,
      summary,
      supabase,
      tiger: tiger ?? undefined,
      today,
      velocityTier: app.velocity_tier,
    });

    if (neverSyncedSet.has(appid)) {
      stats.appsCreated += 1;
    } else {
      stats.appsUpdated += 1;
    }
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    log.error('Error processing reviews app', {
      appid,
      lane: app.lane,
      error: errorMessage,
    });

    stats.appsFailed += 1;
    await markAppFailure(appid, supabase, previousSyncData.get(appid), errorMessage, tiger);
  }
}

async function updateSyncJob(
  jobId: string | null,
  supabase: ReviewDbClient,
  tiger: TigerWriter | null,
  values: SyncJobUpdate
): Promise<void> {
  if (!jobId) {
    return;
  }

  if (tiger) {
    await tiger.ops.updateSyncJob(jobId, values);
    return;
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy reviews sync job updates');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const env = process.env;
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? getTigerWriter(env) : null;
  const githubRunId = env.GITHUB_RUN_ID;
  const workerId = env.WORKER_ID || `reviews-${randomUUID()}`;
  const maxAppsToProcess = parseInt(
    env.BATCH_SIZE || String(BATCH_SIZES.REVIEWS_BATCH),
    10
  );
  const claimBatchSize = parseInt(
    env.CLAIM_BATCH_SIZE || `${DEFAULT_CLAIM_BATCH_SIZE}`,
    10
  );
  const claimTtlMinutes = parseInt(
    env.CLAIM_TTL_MINUTES || `${DEFAULT_CLAIM_TTL_MINUTES}`,
    10
  );
  const maxRuntimeMinutes = parseInt(
    env.MAX_RUNTIME_MINUTES || `${DEFAULT_MAX_RUNTIME_MINUTES}`,
    10
  );
  const launchLimit = parseInt(env.REVIEWS_LAUNCH_LIMIT || `${DEFAULT_LAUNCH_LIMIT}`, 10);
  const changeLimit = parseInt(env.REVIEWS_CHANGE_LIMIT || `${DEFAULT_CHANGE_LIMIT}`, 10);
  const activeLimit = parseInt(env.REVIEWS_ACTIVE_LIMIT || `${DEFAULT_ACTIVE_LIMIT}`, 10);
  const backfillLimit = parseInt(
    env.REVIEWS_BACKFILL_LIMIT || `${DEFAULT_BACKFILL_LIMIT}`,
    10
  );
  const unknownLimit = parseInt(
    env.REVIEWS_UNKNOWN_LIMIT || `${DEFAULT_UNKNOWN_LIMIT}`,
    10
  );
  const claimTimeoutRetries = parseInt(
    env.CLAIM_TIMEOUT_RETRIES || `${DEFAULT_CLAIM_TIMEOUT_RETRIES}`,
    10
  );
  const emptyClaimExitThreshold = parseInt(
    env.EMPTY_CLAIM_EXIT_THRESHOLD || `${DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD}`,
    10
  );
  const idleDelayMs = parseInt(env.IDLE_DELAY_MS || `${DEFAULT_IDLE_DELAY_MS}`, 10);
  const deadline = startTime + maxRuntimeMinutes * 60 * 1000;

  log.info('Starting Reviews sync', {
    githubRunId,
    workerId,
    maxAppsToProcess,
    claimBatchSize,
    claimTtlMinutes,
    laneLimits: {
      launch: launchLimit,
      change: changeLimit,
      active: activeLimit,
      backfill: backfillLimit,
      unknown: unknownLimit,
    },
    maxRuntimeMinutes,
  });

  const supabase: ReviewDbClient = tiger ? null : getServiceClient();
  const jobId = tiger
    ? await tiger.ops.createSyncJob({
        jobType: 'reviews',
        githubRunId,
        batchSize: maxAppsToProcess,
      })
    : (await supabase!
        .from('sync_jobs')
        .insert({
          job_type: 'reviews',
          github_run_id: githubRunId,
          status: 'running',
          batch_size: maxAppsToProcess,
        })
        .select()
        .single()
      ).data?.id ?? null;

  const stats: SyncStats = {
    appsProcessed: 0,
    appsCreated: 0,
    appsUpdated: 0,
    appsFailed: 0,
    claimRounds: 0,
    claimsRequested: 0,
    claimedApps: 0,
    emptyClaims: 0,
    rateTokenSleeps: 0,
    tokenWaitMs: 0,
    claimLatencyMsTotal: 0,
    claimLatencySamples: 0,
    lastClaimLatencyMs: 0,
    claimTimeouts: 0,
    consecutiveClaimTimeouts: 0,
    laneClaims: createEmptyLaneCounts(),
  };

  let emptyClaimRounds = 0;
  let activeClaimedAppids: number[] = [];

  const progressInterval = setInterval(() => {
    log.info('Reviews sync progress', {
      ...stats,
      avgClaimLatencyMs:
        stats.claimLatencySamples > 0
          ? Number((stats.claimLatencyMsTotal / stats.claimLatencySamples).toFixed(1))
          : 0,
      tokenWaitSeconds: Number((stats.tokenWaitMs / 1000).toFixed(1)),
      elapsedMinutes: Number(((Date.now() - startTime) / 1000 / 60).toFixed(1)),
      remainingMinutes: Number(
        Math.max(0, (deadline - Date.now()) / 1000 / 60).toFixed(1)
      ),
    });
  }, 10000);

  try {
    while (Date.now() < deadline && stats.appsProcessed < maxAppsToProcess) {
      const requestLimit = Math.min(
        Math.max(1, claimBatchSize),
        maxAppsToProcess - stats.appsProcessed
      );

      stats.claimRounds += 1;
      stats.claimsRequested += requestLimit;

      const claimStartedAt = Date.now();
      const claimedApps = await withRetry(
        () =>
          claimReviewApps({
            workerId,
            limit: requestLimit,
            claimTtlMinutes,
            launchLimit,
            changeLimit,
            activeLimit,
            backfillLimit,
            unknownLimit,
          }),
        {
          initialDelayMs: Math.max(idleDelayMs * 4, 5000),
          maxRetries: Math.max(0, claimTimeoutRetries),
          maxDelayMs: 20000,
          shouldRetry: (error) => error instanceof ClaimAppsTimeoutError,
          onRetry: (error, attempt, delayMs) => {
            stats.claimTimeouts += 1;
            stats.consecutiveClaimTimeouts += 1;
            log.warn('Claim batch timed out, retrying', {
              attempt,
              delayMs,
              requestLimit,
              workerId,
              error: formatUnknownError(error),
            });
          },
        }
      );
      const claimLatencyMs = Date.now() - claimStartedAt;
      stats.consecutiveClaimTimeouts = 0;

      stats.claimLatencyMsTotal += claimLatencyMs;
      stats.claimLatencySamples += 1;
      stats.lastClaimLatencyMs = claimLatencyMs;

      activeClaimedAppids = claimedApps.map((app) => app.appid);

      if (claimedApps.length === 0) {
        emptyClaimRounds += 1;
        stats.emptyClaims += 1;

        if (emptyClaimRounds >= emptyClaimExitThreshold) {
          log.info('Stopping reviews sync after repeated empty claims', {
            emptyClaimRounds,
            claimRounds: stats.claimRounds,
          });
          break;
        }

        await sleep(idleDelayMs);
        continue;
      }

      emptyClaimRounds = 0;
      stats.claimedApps += claimedApps.length;
      const laneCounts = recordLaneClaims(stats, claimedApps);

      log.info('Claimed reviews batch', {
        requested: requestLimit,
        claimed: claimedApps.length,
        claimLatencyMs,
        laneCounts,
      });

      const today = new Date().toISOString().split('T')[0];
      const appIds = claimedApps.map((app) => app.appid);
      const { previousSyncData, neverSyncedSet } = await loadPreviousSyncData(
        supabase,
        appIds,
        env,
        tiger
      );

      log.info('Claimed batch sync breakdown', {
        firstTime: neverSyncedSet.size,
        refresh: claimedApps.length - neverSyncedSet.size,
      });

      const limit = pLimit(CONCURRENCY);
      await Promise.all(
        claimedApps.map((app) =>
          limit(() =>
            processApp(
              app,
              supabase,
              workerId,
              today,
              previousSyncData,
              neverSyncedSet,
              stats,
              env,
              tiger
            )
          )
        )
      );

      await releaseReviewClaims(activeClaimedAppids, workerId);
      activeClaimedAppids = [];
    }

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: stats.appsProcessed,
      items_succeeded: stats.appsCreated + stats.appsUpdated,
      items_failed: stats.appsFailed,
      items_created: stats.appsCreated,
      items_updated: stats.appsUpdated,
    });

    log.info('Reviews sync completed', {
      ...stats,
      durationMinutes: Number(((Date.now() - startTime) / 1000 / 60).toFixed(2)),
      avgClaimLatencyMs:
        stats.claimLatencySamples > 0
          ? Number((stats.claimLatencyMsTotal / stats.claimLatencySamples).toFixed(1))
          : 0,
      tokenWaitSeconds: Number((stats.tokenWaitMs / 1000).toFixed(1)),
    });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    log.error('Reviews sync failed', { error: errorMessage });

    await releaseReviewClaims(activeClaimedAppids, workerId);

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      items_processed: stats.appsProcessed,
      items_succeeded: stats.appsCreated + stats.appsUpdated,
      items_failed: stats.appsFailed,
      items_created: stats.appsCreated,
      items_updated: stats.appsUpdated,
    });

    process.exit(1);
  } finally {
    clearInterval(progressInterval);
  }
}

main();
