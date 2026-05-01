/**
 * Daily CCU Sync Worker (Tier 3)
 *
 * Fetches current player counts for long-tail Tier 3 games.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-daily-sync
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type DailyCcuPeakUpsert,
  type TigerWriter,
} from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import {
  fetchSteamCCUBatchWithStatus,
  type CCUBatchResultWithStatus,
  type CCUResultWithStatus,
} from '../apis/steam-ccu.js';
import {
  getSuspiciousZeroAppids,
  isTierAssignmentsStale,
} from '../workers-support/ccu-guardrails.js';
import { refreshCcuQualityCacheSafely } from '../workers-support/ccu-quality-cache.js';
import { persistOfficialCcuValidationResults } from '../workers-support/ccu-validation.js';

const log = logger.child({ worker: 'ccu-daily-sync' });
const DEFAULT_BATCH_SIZE = 7000;
const SKIP_DURATION_DAYS = 30;
const GRACEFUL_TIMEOUT_MS = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchSteamCcuBatch = typeof fetchSteamCCUBatchWithStatus;

export interface DailyCcuSyncStats {
  appsProcessed: number;
  appsSucceeded: number;
  appsFailed: number;
  appsSkipped: number;
  appsInvalid: number;
}

export interface DailyCcuSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchSteamCCUBatchWithStatus?: FetchSteamCcuBatch;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  refreshCcuQualityCache?: typeof refreshCcuQualityCacheSafely;
}

interface RunConfig {
  batchLimit: number;
  githubRunId: string | undefined;
  isPartitioned: boolean;
  partitionCount: number;
  partitionId: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRunConfig(env: NodeJS.ProcessEnv): RunConfig {
  const partitionCount = parsePositiveInteger(env.PARTITION_COUNT, 1);
  const partitionId = Math.max(0, Number.parseInt(env.PARTITION_ID || '0', 10) || 0);
  return {
    batchLimit: parsePositiveInteger(env.CCU_DAILY_LIMIT, DEFAULT_BATCH_SIZE),
    githubRunId: env.GITHUB_RUN_ID,
    isPartitioned: partitionCount > 1,
    partitionCount,
    partitionId,
  };
}

function createStats(): DailyCcuSyncStats {
  return {
    appsProcessed: 0,
    appsSucceeded: 0,
    appsFailed: 0,
    appsSkipped: 0,
    appsInvalid: 0,
  };
}

function extractValidCcuData(result: CCUBatchResultWithStatus): Map<number, number> {
  const validCcuData = new Map<number, number>();
  for (const [appid, ccuResult] of result.results) {
    if (ccuResult.status === 'valid' && ccuResult.playerCount !== undefined) {
      validCcuData.set(appid, ccuResult.playerCount);
    }
  }
  return validCcuData;
}

function buildDailyCcuRows(
  ccuData: Map<number, number>,
  today: string
): DailyCcuPeakUpsert[] {
  return Array.from(ccuData.entries()).map(([appid, ccu]) => ({
    appid,
    metric_date: today,
    ccu_peak: ccu,
    ccu_source: 'steam_api',
  }));
}

async function getLegacyTier3Games(
  supabase: SupabaseClient,
  config: RunConfig,
  useTierAssignments: boolean
): Promise<{ appids: number[]; skippedCount: number }> {
  const now = new Date().toISOString();
  if (!useTierAssignments) {
    log.warn('Tier assignments are stale, bypassing assignment-based CCU selection');
  }

  if (useTierAssignments) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ccu_tier_assignments')
      .select('appid')
      .eq('ccu_tier', 3)
      .or(`ccu_skip_until.is.null,ccu_skip_until.lt.${now}`)
      .order('last_ccu_synced', { ascending: true, nullsFirst: true })
      .limit(config.batchLimit * config.partitionCount);

    if (error) {
      throw new Error(`Failed to get Tier 3 games: ${error.message}`);
    }

    const allAppids: number[] = (data ?? []).map((row: { appid: number }) => row.appid);
    const appids = allAppids
      .filter((_, index) => !config.isPartitioned || index % config.partitionCount === config.partitionId)
      .slice(0, config.batchLimit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('ccu_tier_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('ccu_tier', 3)
      .gt('ccu_skip_until', now);

    if (appids.length > 0) {
      return { appids, skippedCount: count ?? 0 };
    }
  }

  const { data, error } = await supabase
    .from('apps')
    .select('appid')
    .eq('type', 'game')
    .eq('is_released', true)
    .eq('is_delisted', false)
    .limit(config.batchLimit * config.partitionCount);

  if (error) {
    throw new Error(`Failed to get fallback Tier 3 games: ${error.message}`);
  }

  const appids = (data ?? [])
    .map((row) => row.appid)
    .filter((_, index) => !config.isPartitioned || index % config.partitionCount === config.partitionId)
    .slice(0, config.batchLimit);
  return { appids, skippedCount: 0 };
}

async function upsertLegacyDailyPeaks(
  supabase: SupabaseClient,
  ccuData: Map<number, number>,
  today: string
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  const entries = Array.from(ccuData.entries());

  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const appids = batch.map(([appid]) => appid);
    const { data: existing } = await supabase
      .from('daily_metrics')
      .select('appid, ccu_peak')
      .in('appid', appids)
      .eq('metric_date', today);
    const existingMap = new Map(existing?.map((row) => [row.appid, row.ccu_peak ?? 0]) ?? []);
    const toUpsert = batch
      .filter(([appid, ccu]) => ccu >= (existingMap.get(appid) ?? 0))
      .map(([appid, ccu]) => ({
        appid,
        metric_date: today,
        ccu_peak: ccu,
        ccu_source: 'steam_api' as const,
      }));

    if (toUpsert.length === 0) {
      succeeded += batch.length;
      continue;
    }

    const { error } = await supabase.from('daily_metrics').upsert(toUpsert, {
      onConflict: 'appid,metric_date',
      ignoreDuplicates: false,
    });

    if (error) {
      log.error('Failed to upsert daily metrics batch', { error, batchStart: i });
      failed += batch.length;
    } else {
      succeeded += batch.length;
    }
  }

  return { succeeded, failed };
}

async function insertLegacyTier3Snapshots(
  supabase: SupabaseClient,
  ccuData: Map<number, number>
): Promise<void> {
  const snapshots = Array.from(ccuData.entries()).map(([appid, playerCount]) => ({
    appid,
    player_count: playerCount,
    ccu_tier: 3,
  }));

  for (let i = 0; i < snapshots.length; i += 500) {
    const batch = snapshots.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('ccu_snapshots').insert(batch);
    if (error) {
      log.warn('Failed to insert Tier 3 snapshots batch', { error, batchStart: i });
    }
  }
}

async function persistValidation(
  supabase: SupabaseClient,
  results: Map<number, CCUResultWithStatus>,
  tiger?: TigerWriter
): Promise<void> {
  const skipUntil = new Date();
  skipUntil.setDate(skipUntil.getDate() + SKIP_DURATION_DAYS);
  const persisted = await persistOfficialCcuValidationResults(
    supabase,
    results,
    new Date().toISOString(),
    skipUntil.toISOString(),
    tiger
  );
  log.info('Updated skip tracking', {
    ...persisted,
    skipUntil: skipUntil.toISOString(),
  });
}

async function runDailyFetch(params: {
  appids: number[];
  config: RunConfig;
  env?: NodeJS.ProcessEnv;
  fetchBatch: FetchSteamCcuBatch;
  shouldStop: () => boolean;
  startTime: number;
  supabaseForGuardrails: SupabaseClient;
  tiger?: TigerWriter;
}): Promise<CCUBatchResultWithStatus> {
  const suspiciousZeroAppids = await getSuspiciousZeroAppids(
    params.supabaseForGuardrails,
    params.appids,
    { env: params.env, tiger: params.tiger }
  );
  return params.fetchBatch(
    params.appids,
    (processed, total) => {
      if (processed % 1000 === 0) {
        const elapsed = (Date.now() - params.startTime) / 1000 / 60;
        const rate = processed / Math.max(elapsed, 0.01);
        const remaining = (total - processed) / Math.max(rate, 0.01);
        log.info('Daily CCU fetch progress', {
          processed,
          total,
          elapsedMinutes: elapsed.toFixed(1),
          estimatedRemainingMinutes: remaining.toFixed(1),
          ...(params.config.isPartitioned && {
            partition: `${params.config.partitionId}/${params.config.partitionCount}`,
          }),
        });
      }
    },
    params.shouldStop,
    { suspiciousZeroAppids }
  );
}

export async function runTigerCcuDailySync(
  dependencies: DailyCcuSyncDependencies = {}
): Promise<DailyCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const fetchBatch = dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const config = readRunConfig(env);
  const stats = createStats();
  const startTime = Date.now();
  const supabasePlaceholder = {} as SupabaseClient;
  let isShuttingDown = false;

  const timeoutId = setTimeout(() => {
    log.info('Approaching timeout limit, initiating graceful shutdown', {
      elapsedMinutes: ((Date.now() - startTime) / 1000 / 60).toFixed(1),
    });
    isShuttingDown = true;
  }, GRACEFUL_TIMEOUT_MS);

  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, initiating graceful shutdown');
    isShuttingDown = true;
  });

  const tierAssignmentsStale = await isTierAssignmentsStale(
    supabasePlaceholder,
    undefined,
    { env, tiger }
  );

  log.info('Starting Tiger daily CCU sync (Tier 3)', {
    githubRunId: config.githubRunId,
    batchLimit: config.batchLimit,
    tierAssignmentsStale,
    ...(config.isPartitioned && { partition: `${config.partitionId}/${config.partitionCount}` }),
  });

  const jobId = await tiger.ops.createSyncJob({
    jobType: config.isPartitioned ? `ccu-daily-p${config.partitionId}` : 'ccu-daily',
    githubRunId: config.githubRunId,
    batchSize: config.batchLimit,
  });

  try {
    const candidateResult = tierAssignmentsStale
      ? {
          appids: await tiger.metrics.listFallbackTier3CcuAppids({
            limit: config.batchLimit,
            partitionCount: config.partitionCount,
            partitionId: config.partitionId,
          }),
          skippedCount: 0,
        }
      : await tiger.metrics.listTier3CcuAppids({
          limit: config.batchLimit,
          nowIso: new Date().toISOString(),
          partitionCount: config.partitionCount,
          partitionId: config.partitionId,
        });

    stats.appsSkipped = candidateResult.skippedCount;

    if (candidateResult.appids.length === 0) {
      clearTimeout(timeoutId);
      log.info('No Tier 3 games found for Tiger daily CCU sync');
      if (jobId) {
        await tiger.ops.updateSyncJob(jobId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: 0,
          items_succeeded: 0,
          items_failed: 0,
        });
      }
      return stats;
    }

    const result = await runDailyFetch({
      appids: candidateResult.appids,
      config,
      env,
      fetchBatch,
      shouldStop: () => isShuttingDown,
      startTime,
      supabaseForGuardrails: supabasePlaceholder,
      tiger,
    });
    stats.appsProcessed = result.results.size;
    stats.appsInvalid = result.invalidCount;

    const validCcuData = extractValidCcuData(result);
    await tiger.metrics.upsertDailyCcuPeaks(
      buildDailyCcuRows(validCcuData, new Date().toISOString().split('T')[0])
    );
    await persistValidation(supabasePlaceholder, result.results, tiger);
    await tiger.metrics.insertCcuSnapshots(
      Array.from(validCcuData.entries()).map(([appid, playerCount]) => ({
        appid,
        player_count: playerCount,
        ccu_tier: 3,
      }))
    );

    stats.appsSucceeded = validCcuData.size;
    stats.appsFailed = result.errorCount;
    clearTimeout(timeoutId);

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsSucceeded,
        items_failed: stats.appsFailed,
      });
    }

    await refreshCcuQualityCache(
      config.isPartitioned ? `ccu-daily-p${config.partitionId}` : 'ccu-daily'
    );

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiger daily CCU sync completed', {
      ...stats,
      durationMinutes: duration,
      gracefulShutdown: isShuttingDown,
    });
    return stats;
  } catch (error) {
    clearTimeout(timeoutId);
    log.error('Tiger daily CCU sync failed', { error });
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsSucceeded,
        items_failed: stats.appsFailed,
      });
    }
    throw error;
  }
}

export async function runLegacySupabaseCcuDailySync(
  dependencies: DailyCcuSyncDependencies = {}
): Promise<DailyCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const supabase = dependencies.getSupabase?.() ?? getServiceClient();
  const fetchBatch = dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const config = readRunConfig(env);
  const stats = createStats();
  const startTime = Date.now();
  let isShuttingDown = false;

  const timeoutId = setTimeout(() => {
    log.info('Approaching timeout limit, initiating graceful shutdown');
    isShuttingDown = true;
  }, GRACEFUL_TIMEOUT_MS);

  const tierAssignmentsStale = await isTierAssignmentsStale(supabase);
  log.info('Starting legacy Supabase daily CCU sync (Tier 3)', {
    githubRunId: config.githubRunId,
    batchLimit: config.batchLimit,
    tierAssignmentsStale,
  });

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: config.isPartitioned ? `ccu-daily-p${config.partitionId}` : 'ccu-daily',
      github_run_id: config.githubRunId,
      status: 'running',
      batch_size: config.batchLimit,
    })
    .select()
    .single();

  try {
    const { appids, skippedCount } = await getLegacyTier3Games(
      supabase,
      config,
      !tierAssignmentsStale
    );
    stats.appsSkipped = skippedCount;

    if (appids.length === 0) {
      clearTimeout(timeoutId);
      if (job) {
        await supabase
          .from('sync_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            items_processed: 0,
            items_succeeded: 0,
            items_failed: 0,
          })
          .eq('id', job.id);
      }
      return stats;
    }

    const result = await runDailyFetch({
      appids,
      config,
      fetchBatch,
      shouldStop: () => isShuttingDown,
      startTime,
      supabaseForGuardrails: supabase,
    });
    stats.appsProcessed = result.results.size;
    stats.appsInvalid = result.invalidCount;
    const validCcuData = extractValidCcuData(result);
    const { succeeded, failed } = await upsertLegacyDailyPeaks(
      supabase,
      validCcuData,
      new Date().toISOString().split('T')[0]
    );
    await persistValidation(supabase, result.results);
    await insertLegacyTier3Snapshots(supabase, validCcuData);

    stats.appsSucceeded = succeeded;
    stats.appsFailed = failed + result.errorCount;
    clearTimeout(timeoutId);

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsSucceeded,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }

    await refreshCcuQualityCache(
      config.isPartitioned ? `ccu-daily-p${config.partitionId}` : 'ccu-daily'
    );

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Legacy Supabase daily CCU sync completed', {
      ...stats,
      durationMinutes: duration,
      gracefulShutdown: isShuttingDown,
    });
    return stats;
  } catch (error) {
    clearTimeout(timeoutId);
    log.error('Daily CCU sync failed', { error });
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsSucceeded,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }
    throw error;
  }
}

export async function runCcuDailySync(
  dependencies: DailyCcuSyncDependencies = {}
): Promise<DailyCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  return readDataWriteTarget(env) === 'tiger'
    ? runTigerCcuDailySync(dependencies)
    : runLegacySupabaseCcuDailySync(dependencies);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runCcuDailySync().catch((error) => {
    log.error('Daily CCU sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
