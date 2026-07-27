/**
 * Review Histogram Sync Worker
 *
 * Fetches monthly Steam review histograms with explicit freshness tiers,
 * starvation-free coverage capacity, and a bounded runtime.
 *
 * Run with: pnpm --filter @publisheriq/ingestion histogram-sync
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type HistogramBacklogSnapshot,
  type HistogramSelectionLane,
  type HistogramServiceTier,
  type HistogramSyncCandidate,
  type ReviewHistogramUpsert,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import { BATCH_SIZES, logger } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchReviewHistogram } from '../apis/reviews.js';
import {
  HISTOGRAM_POLICY_VERSION,
  readHistogramRuntimeConfig,
  type HistogramRuntimeConfig,
} from '../workers-support/histogram-policy.js';

const log = logger.child({ worker: 'histogram-sync' });
const CONCURRENCY = 15;
const HISTOGRAM_JOB_TYPE = 'histogram';
const HISTOGRAM_JOB_LOCK_KEY = 'publisheriq:histogram-sync';

type SupabaseClient = ReturnType<typeof getServiceClient>;
type HistogramDbClient = SupabaseClient | null;
type FetchHistogram = typeof fetchReviewHistogram;

export interface HistogramSyncStats {
  created: number;
  data: number;
  deferred: number;
  empty: number;
  failed: number;
  processed: number;
  requestAttempts: number;
  selected: number;
  skippedConcurrent: boolean;
  updated: number;
}

export interface HistogramSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchHistogram?: FetchHistogram;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  now?: () => Date;
}

interface ProcessAppParams {
  candidate: HistogramSyncCandidate;
  deadlineMs: number;
  fetchHistogram: FetchHistogram;
  neverSyncedSet: Set<number>;
  now: () => Date;
  requestTimeoutMs: number;
  stats: HistogramSyncStats;
  supabase: HistogramDbClient;
  tiger: TigerWriter | null;
}

function createStats(): HistogramSyncStats {
  return {
    created: 0,
    data: 0,
    deferred: 0,
    empty: 0,
    failed: 0,
    processed: 0,
    requestAttempts: 0,
    selected: 0,
    skippedConcurrent: false,
    updated: 0,
  };
}

function minutesAgoIso(minutes: number, now: Date): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

async function updateSyncJob(
  jobId: string | null,
  supabase: HistogramDbClient,
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
    throw new Error('Supabase client is required for legacy histogram sync job updates');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

async function updateHistogramAttempt(
  appid: number,
  attemptedAt: string,
  supabase: HistogramDbClient,
  tiger: TigerWriter | null
): Promise<void> {
  if (tiger) {
    await tiger.syncStatus.updateFields(appid, {
      last_histogram_sync: attemptedAt,
    });
    return;
  }

  if (supabase) {
    await supabase
      .from('sync_status')
      .update({ last_histogram_sync: attemptedAt })
      .eq('appid', appid);
  }
}

async function recordHistogramFailure(
  appid: number,
  failedAt: string,
  message: string,
  tiger: TigerWriter | null
): Promise<void> {
  if (!tiger) {
    return;
  }

  await tiger.syncStatus.updateFields(appid, {
    last_error_at: failedAt,
    last_error_message: message.slice(0, 1000),
    last_error_source: HISTOGRAM_JOB_TYPE,
  });
}

async function processApp(params: ProcessAppParams): Promise<void> {
  const {
    candidate,
    deadlineMs,
    fetchHistogram: fetchHistogramForApp,
    neverSyncedSet,
    now,
    requestTimeoutMs,
    stats,
    supabase,
    tiger,
  } = params;

  if (now().getTime() >= deadlineMs) {
    stats.deferred++;
    return;
  }

  stats.processed++;

  try {
    const result = await fetchHistogramForApp(candidate.appid, requestTimeoutMs);
    stats.requestAttempts += result.attempts;
    const attemptedAt = now().toISOString();

    if (result.status === 'failed') {
      stats.failed++;
      await recordHistogramFailure(
        candidate.appid,
        attemptedAt,
        `${result.errorCode}: ${result.errorMessage}`,
        tiger
      );
      log.warn('Histogram request failed', {
        appid: candidate.appid,
        attempts: result.attempts,
        errorCode: result.errorCode,
        statusCode: result.statusCode,
      });
      return;
    }

    if (result.status === 'empty') {
      stats.empty++;
      await updateHistogramAttempt(candidate.appid, attemptedAt, supabase, tiger);
      return;
    }

    const histogramData: ReviewHistogramUpsert[] = result.entries.map((entry) => ({
      appid: candidate.appid,
      month_start: entry.monthStart.toISOString().split('T')[0],
      recommendations_up: entry.recommendationsUp,
      recommendations_down: entry.recommendationsDown,
    }));

    if (tiger) {
      await tiger.metrics.upsertReviewHistogram(histogramData);
    } else if (supabase) {
      await supabase
        .from('review_histogram')
        .upsert(histogramData, { onConflict: 'appid,month_start' });
    }

    await updateHistogramAttempt(candidate.appid, attemptedAt, supabase, tiger);
    stats.data++;

    if (neverSyncedSet.has(candidate.appid)) {
      stats.created++;
    } else {
      stats.updated++;
    }
  } catch (error) {
    stats.failed++;
    const failedAt = now().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error processing app histogram', {
      appid: candidate.appid,
      error: message,
    });

    try {
      await recordHistogramFailure(candidate.appid, failedAt, message, tiger);
    } catch (statusError) {
      log.warn('Failed to record histogram error status', {
        appid: candidate.appid,
        error: statusError instanceof Error ? statusError.message : String(statusError),
      });
    }
  }
}

function countSelections<T extends string>(
  candidates: HistogramSyncCandidate[],
  getKey: (candidate: HistogramSyncCandidate) => T
): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const candidate of candidates) {
    const key = getKey(candidate);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function buildJobMetadata(params: {
  backlogAfter: HistogramBacklogSnapshot | null;
  backlogBefore: HistogramBacklogSnapshot | null;
  candidates: HistogramSyncCandidate[];
  config: HistogramRuntimeConfig;
  durationMs: number;
  stats: HistogramSyncStats;
}): Record<string, unknown> {
  const durationMinutes = params.durationMs / 60_000;
  return {
    backlogAfter: params.backlogAfter,
    backlogBefore: params.backlogBefore,
    deadlineReached: params.stats.deferred > 0,
    durationMs: params.durationMs,
    laneQuotas: params.config.laneQuotas,
    maxRuntimeMs: params.config.maxRuntimeMs,
    policyVersion: HISTOGRAM_POLICY_VERSION,
    processedPerMinute:
      durationMinutes > 0
        ? Number((params.stats.processed / durationMinutes).toFixed(2))
        : params.stats.processed,
    selectedByLane: countSelections<HistogramSelectionLane>(
      params.candidates,
      (candidate) => candidate.lane
    ),
    selectedByTier: countSelections<HistogramServiceTier>(
      params.candidates,
      (candidate) => candidate.serviceTier
    ),
    stats: params.stats,
  };
}

async function getBacklogSnapshot(
  tiger: TigerWriter,
  phase: 'before' | 'after'
): Promise<HistogramBacklogSnapshot | null> {
  try {
    const snapshot = await tiger.catalog.getHistogramBacklogSnapshot();
    log.info('Histogram backlog snapshot', { phase, ...snapshot });
    return snapshot;
  } catch (error) {
    log.warn('Failed to collect histogram backlog snapshot', {
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function startHeartbeat(
  jobId: string | null,
  tiger: TigerWriter | null,
  heartbeatMinutes: number
): () => void {
  if (!jobId || !tiger) {
    return () => {};
  }

  const interval = setInterval(
    () => {
      tiger.ops.heartbeatSyncJob(jobId).catch((error) => {
        log.warn('Failed to heartbeat histogram sync job', {
          error: error instanceof Error ? error.message : String(error),
          jobId,
        });
      });
    },
    heartbeatMinutes * 60 * 1000
  );
  interval.unref?.();

  return () => clearInterval(interval);
}

async function listLegacyCandidates(
  supabase: SupabaseClient,
  limit: number
): Promise<HistogramSyncCandidate[]> {
  const { data, error } = await supabase.rpc('get_apps_for_sync', {
    p_source: 'histogram',
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Failed to list legacy histogram candidates: ${error.message}`);
  }

  const appids = (data ?? []).map((row: { appid: number }) => row.appid);
  if (appids.length === 0) {
    return [];
  }

  const { data: statuses, error: statusError } = await supabase
    .from('sync_status')
    .select('appid, last_histogram_sync, priority_score')
    .in('appid', appids);
  if (statusError) {
    throw new Error(`Failed to load legacy histogram statuses: ${statusError.message}`);
  }

  const statusByAppid = new Map((statuses ?? []).map((status) => [status.appid, status]));
  return appids.map((appid) => {
    const status = statusByAppid.get(appid);
    return {
      appid,
      hasHistogram: false,
      lane: 'reallocated',
      lastHistogramSync: status?.last_histogram_sync ?? null,
      priorityScore: status?.priority_score ?? 0,
      serviceTier: 'long_tail_monthly',
      totalReviews: 0,
    };
  });
}

export async function runHistogramSync(
  dependencies: HistogramSyncDependencies = {}
): Promise<HistogramSyncStats> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const startTime = now().getTime();
  const config = readHistogramRuntimeConfig(env, BATCH_SIZES.HISTOGRAM_BATCH);
  const deadlineMs = startTime + config.maxRuntimeMs;
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? (dependencies.getTiger?.() ?? getTigerWriter(env)) : null;
  const supabase: HistogramDbClient = tiger
    ? null
    : (dependencies.getSupabase?.() ?? getServiceClient());
  const fetchHistogramForApp = dependencies.fetchHistogram ?? fetchReviewHistogram;
  const stats = createStats();

  log.info('Starting Histogram sync', {
    batchSize: config.batchSize,
    githubRunId: env.GITHUB_RUN_ID,
    laneQuotas: config.laneQuotas,
    maxRuntimeMinutes: config.maxRuntimeMs / 60_000,
    policyVersion: HISTOGRAM_POLICY_VERSION,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  let abandonedCount = 0;
  if (tiger) {
    try {
      abandonedCount = await tiger.ops.abandonStaleRunningSyncJobsByTypes({
        errorMessage: 'abandoned_as_stale_by_new_histogram_run',
        jobTypes: [HISTOGRAM_JOB_TYPE],
        staleBeforeIso: minutesAgoIso(config.staleJobMinutes, now()),
      });
    } catch (error) {
      log.warn('Failed to abandon stale histogram jobs', { error });
    }
  }

  if (abandonedCount > 0) {
    log.warn('Abandoned stale histogram jobs before starting new run', {
      abandonedCount,
    });
  }

  const jobId = tiger
    ? await tiger.ops.tryCreateSyncJobIfIdle({
        batchSize: config.batchSize,
        freshAfterIso: minutesAgoIso(config.freshJobMinutes, now()),
        githubRunId: env.GITHUB_RUN_ID,
        jobType: HISTOGRAM_JOB_TYPE,
        lockKey: HISTOGRAM_JOB_LOCK_KEY,
      })
    : ((
        await supabase!
          .from('sync_jobs')
          .insert({
            job_type: HISTOGRAM_JOB_TYPE,
            github_run_id: env.GITHUB_RUN_ID,
            status: 'running',
            batch_size: config.batchSize,
          })
          .select()
          .single()
      ).data?.id ?? null);

  if (tiger && !jobId) {
    stats.skippedConcurrent = true;
    log.warn('Another fresh histogram sync job is active; exiting without selecting work');
    return stats;
  }

  const stopHeartbeat = startHeartbeat(jobId, tiger, config.heartbeatMinutes);
  let candidates: HistogramSyncCandidate[] = [];
  let backlogBefore: HistogramBacklogSnapshot | null = null;

  try {
    backlogBefore = tiger ? await getBacklogSnapshot(tiger, 'before') : null;
    candidates = tiger
      ? await tiger.catalog.listHistogramSyncCandidates({
          activeQuota: config.laneQuotas.active,
          coverageQuota: config.laneQuotas.coverage,
          limit: config.batchSize,
          longTailQuota: config.laneQuotas.longTail,
          mediumQuota: config.laneQuotas.medium,
        })
      : await listLegacyCandidates(supabase!, config.batchSize);
    stats.selected = candidates.length;

    if (candidates.length === 0) {
      const durationMs = now().getTime() - startTime;
      await updateSyncJob(jobId, supabase, tiger, {
        completed_at: now().toISOString(),
        items_created: 0,
        items_failed: 0,
        items_processed: 0,
        items_skipped: 0,
        items_succeeded: 0,
        items_updated: 0,
        metadata: buildJobMetadata({
          backlogAfter: backlogBefore,
          backlogBefore,
          candidates,
          config,
          durationMs,
          stats,
        }),
        status: 'completed',
      });
      log.info('No apps due for histogram sync', { backlogBefore });
      return stats;
    }

    log.info('Selected histogram candidates', {
      count: candidates.length,
      selectedByLane: countSelections(candidates, (candidate) => candidate.lane),
      selectedByTier: countSelections(candidates, (candidate) => candidate.serviceTier),
    });

    const neverSyncedSet = new Set(
      candidates
        .filter((candidate) => candidate.lastHistogramSync === null)
        .map((candidate) => candidate.appid)
    );
    const limit = pLimit(CONCURRENCY);
    const progressInterval = setInterval(() => {
      log.info('Histogram sync progress', {
        deadlineRemainingMs: Math.max(0, deadlineMs - now().getTime()),
        ...stats,
      });
    }, 10_000);

    try {
      await Promise.all(
        candidates.map((candidate) =>
          limit(() =>
            processApp({
              candidate,
              deadlineMs,
              fetchHistogram: fetchHistogramForApp,
              neverSyncedSet,
              now,
              requestTimeoutMs: config.requestTimeoutMs,
              stats,
              supabase,
              tiger,
            })
          )
        )
      );
    } finally {
      clearInterval(progressInterval);
    }

    const backlogAfter = tiger ? await getBacklogSnapshot(tiger, 'after') : null;
    const durationMs = now().getTime() - startTime;
    await updateSyncJob(jobId, supabase, tiger, {
      completed_at: now().toISOString(),
      items_created: stats.created,
      items_failed: stats.failed,
      items_processed: stats.processed,
      items_skipped: stats.empty + stats.deferred,
      items_succeeded: stats.data,
      items_updated: stats.updated,
      metadata: buildJobMetadata({
        backlogAfter,
        backlogBefore,
        candidates,
        config,
        durationMs,
        stats,
      }),
      status: 'completed',
    });

    log.info('Histogram sync completed', {
      ...stats,
      durationMinutes: Number((durationMs / 60_000).toFixed(2)),
    });
    return stats;
  } catch (error) {
    const durationMs = now().getTime() - startTime;
    log.error('Histogram sync failed', { error });
    await updateSyncJob(jobId, supabase, tiger, {
      completed_at: now().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
      items_created: stats.created,
      items_failed: stats.failed,
      items_processed: stats.processed,
      items_skipped: stats.empty + stats.deferred,
      items_succeeded: stats.data,
      items_updated: stats.updated,
      metadata: buildJobMetadata({
        backlogAfter: null,
        backlogBefore,
        candidates,
        config,
        durationMs,
        stats,
      }),
      status: 'failed',
    });
    throw error;
  } finally {
    stopHeartbeat();
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runHistogramSync().catch((error) => {
    log.error('Histogram sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
