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
import { getServiceClient } from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchReviewSummary } from '../apis/reviews.js';

const log = logger.child({ worker: 'reviews-sync' });

const CONCURRENCY = 8;
const DEFAULT_CLAIM_BATCH_SIZE = 100;
const DEFAULT_CLAIM_TTL_MINUTES = 15;
const DEFAULT_MAX_RUNTIME_MINUTES = 45;
const DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD = 3;
const DEFAULT_IDLE_DELAY_MS = 1500;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type ReviewLane =
  | 'launch_critical'
  | 'change_critical'
  | 'active_reviews'
  | 'important_backfill'
  | 'unknown_sweep';

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
  laneClaims: Record<ReviewLane, number>;
}

interface PreviousSyncData {
  totalReviews: number;
  positiveReviews: number;
  lastSync: Date | null;
  consecutiveErrors: number;
}

interface ClaimedReviewApp {
  appid: number;
  lane: ReviewLane;
  priority_score: number;
  velocity_tier: string;
  hours_overdue: number;
  last_known_total_reviews: number | null;
  last_reviews_sync: string | null;
}

interface VelocityTierResult {
  tier: string;
  intervalHours: number;
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

function calculateVelocityTier(dailyVelocity: number): VelocityTierResult {
  if (dailyVelocity >= 5) {
    return { tier: 'high', intervalHours: 4 };
  }

  if (dailyVelocity >= 1) {
    return { tier: 'medium', intervalHours: 12 };
  }

  if (dailyVelocity >= 0.1) {
    return { tier: 'low', intervalHours: 24 };
  }

  return { tier: 'dormant', intervalHours: 72 };
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

async function claimAppsForReviewsSync(
  supabase: SupabaseClient,
  workerId: string,
  limit: number,
  claimTtlMinutes: number
): Promise<ClaimedReviewApp[]> {
  const { data, error } = await getDb(supabase).rpc('claim_apps_for_reviews_sync', {
    p_worker_id: workerId,
    p_limit: limit,
    p_claim_ttl_minutes: claimTtlMinutes,
  });

  if (error) {
    throw new Error(`Failed to claim apps for reviews sync: ${error.message}`);
  }

  return (data ?? []) as ClaimedReviewApp[];
}

async function releaseReviewClaims(
  supabase: SupabaseClient,
  appids: number[],
  workerId: string
): Promise<void> {
  if (appids.length === 0) {
    return;
  }

  const { error } = await getDb(supabase)
    .from('sync_status')
    .update({
      reviews_claimed_by: null,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
    })
    .in('appid', appids)
    .eq('reviews_claimed_by', workerId);

  if (error) {
    log.warn('Failed to release stale review claims', {
      workerId,
      claimCount: appids.length,
      error: error.message,
    });
  }
}

async function waitForReviewRateToken(
  supabase: SupabaseClient,
  workerId: string,
  stats: SyncStats
): Promise<void> {
  while (true) {
    const { data, error } = await getDb(supabase).rpc('acquire_api_rate_token', {
      p_source: 'reviews',
      p_worker_id: workerId,
    });

    if (error) {
      throw new Error(`Failed to acquire shared review API token: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.granted) {
      return;
    }

    const waitMs = Math.max(1, Number(result?.wait_ms ?? 1000));
    stats.rateTokenSleeps += 1;
    stats.tokenWaitMs += waitMs;
    await sleep(waitMs);
  }
}

async function loadPreviousSyncData(
  supabase: SupabaseClient,
  appIds: number[]
): Promise<{ previousSyncData: Map<number, PreviousSyncData>; neverSyncedSet: Set<number> }> {
  const { data: syncStatuses, error: syncError } = await getDb(supabase)
    .from('sync_status')
    .select('appid, last_reviews_sync, last_known_total_reviews, consecutive_errors')
    .in('appid', appIds);

  if (syncError) {
    throw new Error(`Failed to load sync status rows: ${syncError.message}`);
  }

  const { data: previousMetrics, error: metricsError } = await getDb(supabase)
    .from('daily_metrics')
    .select('appid, total_reviews, positive_reviews')
    .in('appid', appIds)
    .order('metric_date', { ascending: false });

  if (metricsError) {
    throw new Error(`Failed to load previous daily metrics: ${metricsError.message}`);
  }

  const previousSyncData = new Map<number, PreviousSyncData>();

  for (const status of syncStatuses ?? []) {
    previousSyncData.set(status.appid, {
      totalReviews: status.last_known_total_reviews ?? 0,
      positiveReviews: 0,
      lastSync: status.last_reviews_sync ? new Date(status.last_reviews_sync) : null,
      consecutiveErrors: status.consecutive_errors ?? 0,
    });
  }

  for (const metric of previousMetrics ?? []) {
    const existing = previousSyncData.get(metric.appid);
    if (!existing) {
      continue;
    }

    if (existing.positiveReviews === 0) {
      existing.positiveReviews = metric.positive_reviews ?? 0;
      if (existing.totalReviews === 0) {
        existing.totalReviews = metric.total_reviews ?? 0;
      }
    }
  }

  const neverSyncedAppids: number[] = [];
  for (const status of syncStatuses ?? []) {
    if (status.last_reviews_sync === null) {
      neverSyncedAppids.push(status.appid);
    }
  }
  const neverSyncedSet = new Set<number>(neverSyncedAppids);

  return { previousSyncData, neverSyncedSet };
}

async function markAppFailure(
  appid: number,
  supabase: SupabaseClient,
  previous: PreviousSyncData | undefined,
  errorMessage: string
): Promise<void> {
  const nextErrorCount = (previous?.consecutiveErrors ?? 0) + 1;
  const nextRetryAt = new Date(
    Date.now() + calculateFailureBackoffMinutes(nextErrorCount) * 60 * 1000
  ).toISOString();

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
  supabase: SupabaseClient,
  workerId: string,
  today: string,
  previousSyncData: Map<number, PreviousSyncData>,
  neverSyncedSet: Set<number>,
  stats: SyncStats
): Promise<void> {
  const appid = app.appid;
  stats.appsProcessed += 1;

  try {
    await waitForReviewRateToken(supabase, workerId, stats);

    const summary = await fetchReviewSummary(appid);
    if (!summary) {
      throw new Error('Steam did not return a reviews summary');
    }

    const previous = previousSyncData.get(appid);
    const previousTotal = previous?.totalReviews ?? 0;
    const previousPositive = previous?.positiveReviews ?? 0;
    const lastSyncTime = previous?.lastSync;

    const reviewsAdded = Math.max(0, summary.totalReviews - previousTotal);
    const positiveAdded = Math.max(0, summary.positiveReviews - previousPositive);
    const negativeAdded = Math.max(0, reviewsAdded - positiveAdded);

    const hoursSinceLastSync = lastSyncTime
      ? (Date.now() - lastSyncTime.getTime()) / (1000 * 60 * 60)
      : null;

    const dailyVelocity =
      hoursSinceLastSync && hoursSinceLastSync > 0
        ? (reviewsAdded * 24) / hoursSinceLastSync
        : 0;

    const { tier, intervalHours } = calculateVelocityTier(dailyVelocity);
    const nextSync = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
    const nowIso = new Date().toISOString();

    const { error: deltaError } = await getDb(supabase).from('review_deltas').upsert(
      {
        appid,
        delta_date: today,
        total_reviews: summary.totalReviews,
        positive_reviews: summary.positiveReviews,
        review_score: summary.reviewScore,
        review_score_desc: summary.reviewScoreDesc,
        reviews_added: reviewsAdded,
        positive_added: positiveAdded,
        negative_added: negativeAdded,
        hours_since_last_sync: hoursSinceLastSync,
        is_interpolated: false,
      },
      { onConflict: 'appid,delta_date' }
    );

    if (deltaError) {
      throw new Error(`Failed to upsert review_deltas row: ${deltaError.message}`);
    }

    const { error: metricsError } = await getDb(supabase).from('daily_metrics').upsert(
      {
        appid,
        metric_date: today,
        total_reviews: summary.totalReviews,
        positive_reviews: summary.positiveReviews,
        negative_reviews: summary.negativeReviews,
        review_score: summary.reviewScore,
        review_score_desc: summary.reviewScoreDesc,
      },
      { onConflict: 'appid,metric_date' }
    );

    if (metricsError) {
      throw new Error(`Failed to upsert daily_metrics row: ${metricsError.message}`);
    }

    const syncUpdate: Record<string, unknown> = {
      last_reviews_sync: nowIso,
      next_reviews_sync: nextSync.toISOString(),
      reviews_interval_hours: intervalHours,
      review_velocity_tier: tier,
      last_known_total_reviews: summary.totalReviews,
      consecutive_errors: 0,
      last_error_source: null,
      last_error_message: null,
      last_error_at: null,
      reviews_claimed_by: null,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
      reviews_priority_override_bucket: null,
      reviews_priority_override_score: null,
      reviews_priority_override_reason: null,
      reviews_priority_override_until: null,
    };

    if (reviewsAdded > 0) {
      syncUpdate.last_activity_at = nowIso;
    }

    const { error: syncError } = await getDb(supabase)
      .from('sync_status')
      .update(syncUpdate)
      .eq('appid', appid);

    if (syncError) {
      throw new Error(`Failed to update sync_status row: ${syncError.message}`);
    }

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
    await markAppFailure(appid, supabase, previousSyncData.get(appid), errorMessage);
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const workerId = process.env.WORKER_ID || `reviews-${randomUUID()}`;
  const maxAppsToProcess = parseInt(
    process.env.BATCH_SIZE || String(BATCH_SIZES.REVIEWS_BATCH),
    10
  );
  const claimBatchSize = parseInt(
    process.env.CLAIM_BATCH_SIZE || `${DEFAULT_CLAIM_BATCH_SIZE}`,
    10
  );
  const claimTtlMinutes = parseInt(
    process.env.CLAIM_TTL_MINUTES || `${DEFAULT_CLAIM_TTL_MINUTES}`,
    10
  );
  const maxRuntimeMinutes = parseInt(
    process.env.MAX_RUNTIME_MINUTES || `${DEFAULT_MAX_RUNTIME_MINUTES}`,
    10
  );
  const emptyClaimExitThreshold = parseInt(
    process.env.EMPTY_CLAIM_EXIT_THRESHOLD || `${DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD}`,
    10
  );
  const idleDelayMs = parseInt(process.env.IDLE_DELAY_MS || `${DEFAULT_IDLE_DELAY_MS}`, 10);
  const deadline = startTime + maxRuntimeMinutes * 60 * 1000;

  log.info('Starting Reviews sync', {
    githubRunId,
    workerId,
    maxAppsToProcess,
    claimBatchSize,
    claimTtlMinutes,
    maxRuntimeMinutes,
  });

  const supabase = getServiceClient();

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'reviews',
      github_run_id: githubRunId,
      status: 'running',
      batch_size: maxAppsToProcess,
    })
    .select()
    .single();

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
    laneClaims: createEmptyLaneCounts(),
  };

  let emptyClaimRounds = 0;
  let activeClaimedAppids: number[] = [];

  const progressInterval = setInterval(() => {
    log.info('Reviews sync progress', {
      ...stats,
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

      const claimedApps = await claimAppsForReviewsSync(
        supabase,
        workerId,
        requestLimit,
        claimTtlMinutes
      );

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
        laneCounts,
      });

      const today = new Date().toISOString().split('T')[0];
      const appIds = claimedApps.map((app) => app.appid);
      const { previousSyncData, neverSyncedSet } = await loadPreviousSyncData(supabase, appIds);

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
              stats
            )
          )
        )
      );

      await releaseReviewClaims(supabase, activeClaimedAppids, workerId);
      activeClaimedAppids = [];
    }

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsCreated + stats.appsUpdated,
          items_failed: stats.appsFailed,
          items_created: stats.appsCreated,
          items_updated: stats.appsUpdated,
        })
        .eq('id', job.id);
    }

    log.info('Reviews sync completed', {
      ...stats,
      durationMinutes: Number(((Date.now() - startTime) / 1000 / 60).toFixed(2)),
      tokenWaitSeconds: Number((stats.tokenWaitMs / 1000).toFixed(1)),
    });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    log.error('Reviews sync failed', { error: errorMessage });

    await releaseReviewClaims(supabase, activeClaimedAppids, workerId);

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsCreated + stats.appsUpdated,
          items_failed: stats.appsFailed,
          items_created: stats.appsCreated,
          items_updated: stats.appsUpdated,
        })
        .eq('id', job.id);
    }

    process.exit(1);
  } finally {
    clearInterval(progressInterval);
  }
}

main();
