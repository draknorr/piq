/**
 * Reviews Sync Worker
 *
 * Fetches review summaries from Steam Reviews API for apps due for sync.
 * Uses Postgres-coordinated claiming plus a shared review API token budget
 * so every actual Steam attempt remains below the one-request-per-second ceiling.
 *
 * Run with: pnpm --filter @publisheriq/ingestion reviews-sync
 */

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
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
  type AcquireApiRateTokenResult,
  type ClaimedReviewApp,
  type ReviewLane,
} from '@publisheriq/database/ingestion';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import {
  fetchReviewSummary,
  ReviewRateLimitCircuit,
  type ReviewAttemptTelemetry,
  type ReviewSummary,
  type ReviewSummaryFetchResult
} from '../apis/reviews.js';
import { withRetry } from '../utils/retry.js';
import {
  loadPreviousReviewSyncData,
  persistReviewSummary,
  type PreviousReviewSyncData,
} from '../workers-support/reviews-persistence.js';

const log = logger.child({ worker: 'reviews-sync' });

const REQUIRED_CONCURRENCY = 1;
const DEFAULT_CLAIM_BATCH_SIZE = 100;
const DEFAULT_CLAIM_TTL_MINUTES = 15;
const DEFAULT_MAX_RUNTIME_MINUTES = 45;
const DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD = 3;
const DEFAULT_IDLE_DELAY_MS = 1500;
const DEFAULT_RATE_TOKEN_DENIED_MIN_WAIT_MS = 1000;
const DEFAULT_LAUNCH_LIMIT = 25;
const DEFAULT_CHANGE_LIMIT = 20;
const DEFAULT_ACTIVE_LIMIT = 35;
const DEFAULT_BACKFILL_LIMIT = 19;
const DEFAULT_UNKNOWN_LIMIT = 1;
const DEFAULT_CLAIM_TIMEOUT_RETRIES = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type ReviewDbClient = SupabaseClient | null;
type FetchReviewSummary = typeof fetchReviewSummary;
type ClaimReviewApps = typeof claimReviewApps;
type ReleaseReviewClaims = typeof releaseClaimedReviewApps;
type AcquireReviewRateToken = typeof acquireSharedApiRateToken;

export interface ReviewsSyncStats {
  appsCreated: number;
  appsDeferred: number;
  appsFailed: number;
  appsProcessed: number;
  appsUpdated: number;
  circuitExits: number;
  circuitOpens: number;
  circuitPauseMs: number;
  claimLatencyMsTotal: number;
  claimLatencySamples: number;
  claimRounds: number;
  claimsRequested: number;
  claimedApps: number;
  claimTimeouts: number;
  consecutiveClaimTimeouts: number;
  emptyClaims: number;
  forbiddenResponses: number;
  lastClaimLatencyMs: number;
  laneClaims: Record<ReviewLane, number>;
  networkErrors: number;
  rateLimitedResponses: number;
  rateTokenSleeps: number;
  requestAttempts: number;
  requestRetries: number;
  serverErrorResponses: number;
  timeoutResponses: number;
  tokenWaitMs: number;
}

export interface ReviewsSyncDependencies {
  acquireRateToken?: (params: { source: string; workerId: string }) => Promise<AcquireApiRateTokenResult>;
  claimApps?: ClaimReviewApps;
  circuitBreaker?: ReviewRateLimitCircuit;
  env?: NodeJS.ProcessEnv;
  fetchSummary?: FetchReviewSummary;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  now?: () => Date;
  releaseClaims?: ReleaseReviewClaims;
  sleep?: (ms: number) => Promise<void>;
}

interface SuccessfulReviewFetch {
  app: ClaimedReviewApp;
  summary: ReviewSummary;
}

interface FailedReviewFetch {
  app: ClaimedReviewApp;
  errorMessage: string;
}

class SteamReviewsForbiddenError extends Error {
  constructor(appid: number) {
    super(`Steam returned HTTP 403 while processing reviews app ${appid}`);
    this.name = 'SteamReviewsForbiddenError';
  }
}

class ReviewsDeadlineReachedError extends Error {
  constructor() {
    super('Reviews worker deadline was reached while waiting for a shared rate token');
    this.name = 'ReviewsDeadlineReachedError';
  }
}

// Generated Supabase types intentionally lag a few legacy Reviews RPCs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDb(supabase: SupabaseClient): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function createStats(): ReviewsSyncStats {
  return {
    appsCreated: 0,
    appsDeferred: 0,
    appsFailed: 0,
    appsProcessed: 0,
    appsUpdated: 0,
    circuitExits: 0,
    circuitOpens: 0,
    circuitPauseMs: 0,
    claimLatencyMsTotal: 0,
    claimLatencySamples: 0,
    claimRounds: 0,
    claimsRequested: 0,
    claimedApps: 0,
    claimTimeouts: 0,
    consecutiveClaimTimeouts: 0,
    emptyClaims: 0,
    forbiddenResponses: 0,
    lastClaimLatencyMs: 0,
    laneClaims: createEmptyLaneCounts(),
    networkErrors: 0,
    rateLimitedResponses: 0,
    rateTokenSleeps: 0,
    requestAttempts: 0,
    requestRetries: 0,
    serverErrorResponses: 0,
    timeoutResponses: 0,
    tokenWaitMs: 0
  };
}

function recordLaneClaims(stats: ReviewsSyncStats, claimedApps: ClaimedReviewApp[]): Record<ReviewLane, number> {
  const laneCounts = createEmptyLaneCounts();

  for (const app of claimedApps) {
    laneCounts[app.lane] += 1;
    stats.laneClaims[app.lane] += 1;
  }

  return laneCounts;
}

function recordAttemptTelemetry(stats: ReviewsSyncStats, telemetry: ReviewAttemptTelemetry): void {
  stats.requestAttempts += telemetry.attempts;
  stats.requestRetries += telemetry.retries;
  stats.forbiddenResponses += telemetry.forbidden;
  stats.rateLimitedResponses += telemetry.rateLimited;
  stats.serverErrorResponses += telemetry.serverErrors;
  stats.timeoutResponses += telemetry.timeouts;
  stats.networkErrors += telemetry.networkErrors;
}

async function releaseReviewClaimsSafely(
  appids: number[],
  workerId: string,
  releaseClaims: ReleaseReviewClaims
): Promise<void> {
  if (appids.length === 0) {
    return;
  }

  try {
    await releaseClaims({ appids, workerId });
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
  stats: ReviewsSyncStats,
  deniedMinWaitMs: number,
  acquireRateToken: AcquireReviewRateToken,
  sleep: (ms: number) => Promise<void>,
  deadlineMs: number,
  nowMs: () => number
): Promise<void> {
  while (true) {
    if (nowMs() >= deadlineMs) {
      throw new ReviewsDeadlineReachedError();
    }

    const result = await acquireRateToken({
      source: 'reviews',
      workerId,
    });

    if (result.granted) {
      return;
    }

    const waitMs = Math.max(1, deniedMinWaitMs, result.waitMs || deniedMinWaitMs);
    if (nowMs() + waitMs >= deadlineMs) {
      throw new ReviewsDeadlineReachedError();
    }
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
): Promise<{
  previousSyncData: Map<number, PreviousReviewSyncData>;
  neverSyncedSet: Set<number>;
}> {
  return loadPreviousReviewSyncData(supabase, appIds, {
    env,
    tiger: tiger ?? undefined,
  });
}

async function markLegacyAppFailure(
  appid: number,
  supabase: SupabaseClient,
  previous: PreviousReviewSyncData | undefined,
  errorMessage: string,
  now: Date
): Promise<void> {
  const nextErrorCount = (previous?.consecutiveErrors ?? 0) + 1;
  const nextRetryAt = new Date(
    now.getTime() + calculateFailureBackoffMinutes(nextErrorCount) * 60 * 1000
  ).toISOString();

  const { error } = await getDb(supabase)
    .from('sync_status')
    .update({
      consecutive_errors: nextErrorCount,
      last_error_source: 'reviews',
      last_error_message: errorMessage,
      last_error_at: now.toISOString(),
      next_reviews_sync: nextRetryAt,
      reviews_claimed_by: null,
      reviews_claimed_at: null,
      reviews_claim_expires_at: null,
    })
    .eq('appid', appid);

  if (error) {
    throw new Error(`Failed to persist reviews failure state: ${error.message}`);
  }
}

async function persistFetchedBatch(params: {
  env: NodeJS.ProcessEnv;
  failures: FailedReviewFetch[];
  neverSyncedSet: Set<number>;
  now: Date;
  previousSyncData: Map<number, PreviousReviewSyncData>;
  stats: ReviewsSyncStats;
  successes: SuccessfulReviewFetch[];
  supabase: ReviewDbClient;
  tiger: TigerWriter | null;
  today: string;
  workerId: string;
}): Promise<void> {
  const { env, failures, neverSyncedSet, now, previousSyncData, stats, successes, supabase, tiger, today, workerId } =
    params;

  if (tiger) {
    if (successes.length > 0) {
      await tiger.reviews.persistReviewSummaryBatch({
        items: successes.map(({ app, summary }) => ({
          appid: app.appid,
          lane: app.lane,
          previous: previousSyncData.get(app.appid),
          priorityScore: app.priority_score,
          summary,
          today,
          velocityTier: app.velocity_tier
        })),
        persistedAt: now.toISOString(),
        workerId
      });
    }

    if (failures.length > 0) {
      const updated = await tiger.reviews.persistReviewFailuresBatch({
        failedAt: now.toISOString(),
        failures: failures.map(({ app, errorMessage }) => ({
          appid: app.appid,
          errorMessage,
          previousConsecutiveErrors: previousSyncData.get(app.appid)?.consecutiveErrors ?? 0
        })),
        workerId
      });
      if (updated !== failures.length) {
        log.warn('Some Reviews failure rows were no longer owned by this worker', {
          expected: failures.length,
          updated,
          workerId
        });
      }
    }
  } else {
    if (!supabase) {
      throw new Error('Supabase client is required for legacy reviews persistence');
    }

    for (const { app, summary } of successes) {
      await persistReviewSummary({
        appid: app.appid,
        env,
        lane: app.lane,
        previous: previousSyncData.get(app.appid),
        priorityScore: app.priority_score,
        summary,
        supabase,
        today,
        velocityTier: app.velocity_tier
      });
    }

    for (const { app, errorMessage } of failures) {
      await markLegacyAppFailure(app.appid, supabase, previousSyncData.get(app.appid), errorMessage, now);
    }
  }

  for (const { app } of successes) {
    if (neverSyncedSet.has(app.appid)) {
      stats.appsCreated += 1;
    } else {
      stats.appsUpdated += 1;
    }
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

function buildJobMetadata(params: {
  claimBatchSize: number;
  durationMs: number;
  maxRuntimeMinutes: number;
  stats: ReviewsSyncStats;
}): Record<string, unknown> {
  const durationHours = params.durationMs / (60 * 60 * 1000);
  return {
    claimBatchSize: params.claimBatchSize,
    maxRuntimeMinutes: params.maxRuntimeMinutes,
    policyVersion: 'reviews-capacity/v1',
    processedPerHour:
      durationHours > 0 ? Number((params.stats.appsProcessed / durationHours).toFixed(1)) : params.stats.appsProcessed,
    requestAttemptsPerSecond:
      params.durationMs > 0
        ? Number((params.stats.requestAttempts / (params.durationMs / 1000)).toFixed(3))
        : params.stats.requestAttempts,
    stats: params.stats
  };
}

export async function runReviewsSync(dependencies: ReviewsSyncDependencies = {}): Promise<ReviewsSyncStats> {
  const env = dependencies.env ?? process.env;
  const configuredConcurrency =
    env.REVIEWS_CONCURRENCY === undefined ? REQUIRED_CONCURRENCY : Number(env.REVIEWS_CONCURRENCY);
  if (!Number.isInteger(configuredConcurrency) || configuredConcurrency !== REQUIRED_CONCURRENCY) {
    throw new Error('REVIEWS_CONCURRENCY must be exactly 1');
  }
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const fetchSummary = dependencies.fetchSummary ?? fetchReviewSummary;
  const claimApps = dependencies.claimApps ?? claimReviewApps;
  const releaseClaims = dependencies.releaseClaims ?? releaseClaimedReviewApps;
  const acquireRateToken = dependencies.acquireRateToken ?? acquireSharedApiRateToken;
  const circuitBreaker = dependencies.circuitBreaker ?? new ReviewRateLimitCircuit();
  const startTime = now().getTime();
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? (dependencies.getTiger?.() ?? getTigerWriter(env)) : null;
  const supabase: ReviewDbClient = tiger ? null : (dependencies.getSupabase?.() ?? getServiceClient());
  const githubRunId = env.GITHUB_RUN_ID;
  const workerId = env.WORKER_ID || `reviews-${randomUUID()}`;
  const maxAppsToProcess = parsePositiveInteger(env.BATCH_SIZE, BATCH_SIZES.REVIEWS_BATCH);
  const claimBatchSize = parsePositiveInteger(env.CLAIM_BATCH_SIZE, DEFAULT_CLAIM_BATCH_SIZE);
  const claimTtlMinutes = parsePositiveInteger(env.CLAIM_TTL_MINUTES, DEFAULT_CLAIM_TTL_MINUTES);
  const maxRuntimeMinutes = parsePositiveInteger(env.MAX_RUNTIME_MINUTES, DEFAULT_MAX_RUNTIME_MINUTES);
  const requestTimeoutMs = parsePositiveInteger(env.REVIEWS_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
  const rateTokenDeniedMinWaitMs = parsePositiveInteger(
    env.REVIEW_TOKEN_DENIED_MIN_WAIT_MS,
    DEFAULT_RATE_TOKEN_DENIED_MIN_WAIT_MS
  );
  const launchLimit = parseNonNegativeInteger(env.REVIEWS_LAUNCH_LIMIT, DEFAULT_LAUNCH_LIMIT);
  const changeLimit = parseNonNegativeInteger(env.REVIEWS_CHANGE_LIMIT, DEFAULT_CHANGE_LIMIT);
  const activeLimit = parseNonNegativeInteger(env.REVIEWS_ACTIVE_LIMIT, DEFAULT_ACTIVE_LIMIT);
  const backfillLimit = parseNonNegativeInteger(env.REVIEWS_BACKFILL_LIMIT, DEFAULT_BACKFILL_LIMIT);
  const unknownLimit = parseNonNegativeInteger(env.REVIEWS_UNKNOWN_LIMIT, DEFAULT_UNKNOWN_LIMIT);
  const claimTimeoutRetries = parseNonNegativeInteger(
    env.CLAIM_TIMEOUT_RETRIES,
    DEFAULT_CLAIM_TIMEOUT_RETRIES
  );
  const emptyClaimExitThreshold = parsePositiveInteger(
    env.EMPTY_CLAIM_EXIT_THRESHOLD,
    DEFAULT_EMPTY_CLAIM_EXIT_THRESHOLD
  );
  const idleDelayMs = parsePositiveInteger(env.IDLE_DELAY_MS, DEFAULT_IDLE_DELAY_MS);
  const deadline = startTime + maxRuntimeMinutes * 60 * 1000;
  const stats = createStats();

  log.info('Starting Reviews sync', {
    githubRunId,
    workerId,
    maxAppsToProcess,
    claimBatchSize,
    claimTtlMinutes,
    concurrency: REQUIRED_CONCURRENCY,
    requestTimeoutMs,
    rateTokenDeniedMinWaitMs,
    laneLimits: {
      launch: launchLimit,
      change: changeLimit,
      active: activeLimit,
      backfill: backfillLimit,
      unknown: unknownLimit,
    },
    maxRuntimeMinutes,
  });

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
      elapsedMinutes: Number(((now().getTime() - startTime) / 60000).toFixed(1)),
      remainingMinutes: Number(Math.max(0, (deadline - now().getTime()) / 60000).toFixed(1))
    });
  }, 10000);
  progressInterval.unref?.();

  try {
    while (now().getTime() < deadline && stats.appsProcessed < maxAppsToProcess) {
      const requestLimit = Math.min(Math.max(1, claimBatchSize), maxAppsToProcess - stats.appsProcessed);

      stats.claimRounds += 1;
      stats.claimsRequested += requestLimit;

      const claimStartedAt = now().getTime();
      const claimedApps = await withRetry(
        () =>
          claimApps({
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
      const claimLatencyMs = now().getTime() - claimStartedAt;
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

      const batchNow = now();
      const today = batchNow.toISOString().split('T')[0];
      const appIds = claimedApps.map((app) => app.appid);
      const { previousSyncData, neverSyncedSet } = await loadPreviousSyncData(supabase, appIds, env, tiger);
      const successes: SuccessfulReviewFetch[] = [];
      const failures: FailedReviewFetch[] = [];
      let stopReason: 'circuit' | 'deadline' | 'forbidden' | null = null;
      let stopIndex = claimedApps.length;
      let forbiddenAppid: number | null = null;

      log.info('Claimed batch sync breakdown', {
        firstTime: neverSyncedSet.size,
        refresh: claimedApps.length - neverSyncedSet.size,
      });

      for (let index = 0; index < claimedApps.length; index += 1) {
        const app = claimedApps[index]!;
        if (now().getTime() >= deadline) {
          stopReason = 'deadline';
          stopIndex = index;
          break;
        }

        const circuitState = circuitBreaker.getState(now().getTime());
        if (circuitState.opened) {
          stopReason = 'circuit';
          stopIndex = index;
          break;
        }

        stats.appsProcessed += 1;
        let result: ReviewSummaryFetchResult;
        try {
          result = await fetchSummary(app.appid, {
            beforeAttempt: () =>
              waitForReviewRateToken(
                workerId,
                stats,
                rateTokenDeniedMinWaitMs,
                acquireRateToken,
                sleep,
                deadline,
                () => now().getTime()
              ),
            circuitBreaker,
            deadlineMs: deadline,
            now: () => now().getTime(),
            requestTimeoutMs,
            sleep
          });
        } catch (error) {
          if (!(error instanceof ReviewsDeadlineReachedError)) {
            throw error;
          }
          result = {
            circuitOpened: false,
            errorCode: 'deadline_exceeded',
            errorMessage: error.message,
            status: 'failed',
            telemetry: {
              attempts: 0,
              forbidden: 0,
              networkErrors: 0,
              rateLimited: 0,
              retries: 0,
              serverErrors: 0,
              timeouts: 0
            }
          };
        }

        recordAttemptTelemetry(stats, result.telemetry);
        if (result.status === 'success') {
          successes.push({ app, summary: result.summary });
          continue;
        }

        if (result.errorCode === 'request_guard_failed') {
          throw new Error(result.errorMessage);
        }

        const errorMessage = `${result.errorCode}: ${result.errorMessage}`;
        failures.push({ app, errorMessage });
        stats.appsFailed += 1;
        log.warn('Reviews request failed', {
          appid: app.appid,
          attempts: result.telemetry.attempts,
          circuitOpened: result.circuitOpened,
          errorCode: result.errorCode,
          lane: app.lane,
          statusCode: result.statusCode
        });

        if (result.statusCode === 403) {
          stopReason = 'forbidden';
          stopIndex = index + 1;
          forbiddenAppid = app.appid;
          break;
        }
        if (result.errorCode === 'deadline_exceeded' || result.errorCode === 'retry_deferred') {
          stopReason = 'deadline';
          stopIndex = index + 1;
          break;
        }
        if (result.circuitOpened) {
          stopReason = 'circuit';
          stopIndex = index + 1;
          stats.circuitOpens += 1;
          break;
        }
      }

      const unprocessedAppids = claimedApps.slice(stopIndex).map((app) => app.appid);
      if (unprocessedAppids.length > 0) {
        stats.appsDeferred += unprocessedAppids.length;
        await releaseReviewClaimsSafely(unprocessedAppids, workerId, releaseClaims);
      }

      await persistFetchedBatch({
        env,
        failures,
        neverSyncedSet,
        now: now(),
        previousSyncData,
        stats,
        successes,
        supabase,
        tiger,
        today,
        workerId
      });
      await releaseReviewClaimsSafely(activeClaimedAppids, workerId, releaseClaims);
      activeClaimedAppids = [];

      if (stopReason === 'forbidden') {
        throw new SteamReviewsForbiddenError(forbiddenAppid!);
      }
      if (stopReason === 'deadline') {
        break;
      }
      if (stopReason === 'circuit') {
        const circuitState = circuitBreaker.getState(now().getTime());
        const resumeAtMs = now().getTime() + circuitState.remainingMs;
        if (circuitState.opened && resumeAtMs + idleDelayMs < deadline) {
          stats.circuitPauseMs += circuitState.remainingMs;
          log.warn('Pausing Reviews sync while Steam circuit is open', {
            openUntil: circuitState.openUntilMs ? new Date(circuitState.openUntilMs).toISOString() : null,
            pauseMs: circuitState.remainingMs
          });
          await sleep(circuitState.remainingMs);
          continue;
        }

        stats.circuitExits += 1;
        log.warn('Ending Reviews sync because the circuit outlasts the runtime budget', {
          remainingCircuitMs: circuitState.remainingMs,
          remainingRuntimeMs: Math.max(0, deadline - now().getTime())
        });
        break;
      }
    }

    const completedAt = now();
    const durationMs = completedAt.getTime() - startTime;
    await updateSyncJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: completedAt.toISOString(),
      items_processed: stats.appsProcessed,
      items_succeeded: stats.appsCreated + stats.appsUpdated,
      items_failed: stats.appsFailed,
      items_skipped: stats.appsDeferred,
      items_created: stats.appsCreated,
      items_updated: stats.appsUpdated,
      metadata: buildJobMetadata({
        claimBatchSize,
        durationMs,
        maxRuntimeMinutes,
        stats
      })
    });

    log.info('Reviews sync completed', {
      ...stats,
      durationMinutes: Number((durationMs / 60000).toFixed(2)),
      avgClaimLatencyMs:
        stats.claimLatencySamples > 0
          ? Number((stats.claimLatencyMsTotal / stats.claimLatencySamples).toFixed(1))
          : 0,
      tokenWaitSeconds: Number((stats.tokenWaitMs / 1000).toFixed(1)),
    });
    return stats;
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    const failedAt = now();
    const durationMs = failedAt.getTime() - startTime;
    log.error('Reviews sync failed', { error: errorMessage });

    await releaseReviewClaimsSafely(activeClaimedAppids, workerId, releaseClaims);
    await updateSyncJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: failedAt.toISOString(),
      error_message: errorMessage,
      items_processed: stats.appsProcessed,
      items_succeeded: stats.appsCreated + stats.appsUpdated,
      items_failed: stats.appsFailed,
      items_skipped: stats.appsDeferred,
      items_created: stats.appsCreated,
      items_updated: stats.appsUpdated,
      metadata: buildJobMetadata({
        claimBatchSize,
        durationMs,
        maxRuntimeMinutes,
        stats
      })
    });
    throw error;
  } finally {
    clearInterval(progressInterval);
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  runReviewsSync().catch((error) => {
    log.error('Reviews sync failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
}
