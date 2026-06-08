/**
 * Demo Mini-Tiered CCU Sync Worker
 *
 * Fetches official Steam CCU for active demos without entering the game CCU
 * tier queues. Hot demos are refreshed every scheduled run; tail demos rotate
 * only when the main game CCU lanes are not active.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-demo-tiered-sync
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
import { getSuspiciousZeroAppids } from '../workers-support/ccu-guardrails.js';
import { refreshCcuQualityCacheSafely } from '../workers-support/ccu-quality-cache.js';
import { persistOfficialDemoCcuValidationResults } from '../workers-support/ccu-validation.js';

const log = logger.child({ worker: 'ccu-demo-tiered-sync' });
const DEFAULT_HOT_LIMIT = 300;
const DEFAULT_TAIL_LIMIT = 500;
const DEFAULT_NEW_DEMO_WINDOW_DAYS = 14;
const CHECK_CHUNK_SIZE = 25;
const INVALID_SKIP_DAYS = 30;

const MAIN_CCU_JOB_GUARDS = [
  { jobTypes: ['ccu-tiered'], lookbackMinutes: 75 },
  { jobTypes: ['ccu'], lookbackMinutes: 180 },
  {
    jobTypes: ['ccu-daily', 'ccu-daily-p0', 'ccu-daily-p1', 'ccu-daily-p2'],
    lookbackMinutes: 390,
  },
] as const;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchSteamCcuBatch = typeof fetchSteamCCUBatchWithStatus;

export interface DemoCcuTieredSyncStats {
  skippedForMainCcu: boolean;
  stoppedForMainCcu: boolean;
  tier1Processed: number;
  tier1Skipped: number;
  tier1Succeeded: number;
  tier2Processed: number;
  tier2Skipped: number;
  tier2Succeeded: number;
  tierRecalculated: boolean;
  totalFailed: number;
  totalInvalid: number;
}

export interface DemoCcuTieredSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchSteamCCUBatchWithStatus?: FetchSteamCcuBatch;
  getTiger?: () => TigerWriter;
  refreshCcuQualityCache?: typeof refreshCcuQualityCacheSafely;
}

interface RunConfig {
  githubRunId: string | undefined;
  hotLimit: number;
  newDemoWindowDays: number;
  tailLimit: number;
}

interface TierFetchResult {
  result: CCUBatchResultWithStatus;
  stoppedForMainCcu: boolean;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer but received "${value}"`);
  }
  return parsed;
}

function readRunConfig(env: NodeJS.ProcessEnv): RunConfig {
  return {
    githubRunId: env.GITHUB_RUN_ID,
    hotLimit: parsePositiveInteger(env.CCU_DEMO_HOT_LIMIT, DEFAULT_HOT_LIMIT),
    newDemoWindowDays: parsePositiveInteger(
      env.CCU_DEMO_NEW_DEMO_WINDOW_DAYS,
      DEFAULT_NEW_DEMO_WINDOW_DAYS
    ),
    tailLimit: parseNonNegativeInteger(env.CCU_DEMO_TAIL_LIMIT, DEFAULT_TAIL_LIMIT),
  };
}

function createStats(): DemoCcuTieredSyncStats {
  return {
    skippedForMainCcu: false,
    stoppedForMainCcu: false,
    tier1Processed: 0,
    tier1Skipped: 0,
    tier1Succeeded: 0,
    tier2Processed: 0,
    tier2Skipped: 0,
    tier2Succeeded: 0,
    tierRecalculated: false,
    totalFailed: 0,
    totalInvalid: 0,
  };
}

function createEmptyBatchResult(): CCUBatchResultWithStatus {
  return {
    errorCount: 0,
    invalidCount: 0,
    results: new Map<number, CCUResultWithStatus>(),
    validCount: 0,
  };
}

function mergeBatchResult(
  target: CCUBatchResultWithStatus,
  source: CCUBatchResultWithStatus
): void {
  for (const [appid, result] of source.results) {
    target.results.set(appid, result);
  }

  target.validCount += source.validCount;
  target.invalidCount += source.invalidCount;
  target.errorCount += source.errorCount;
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

function toSnapshotRows(
  ccuData: Map<number, number>,
  tier: number
): Array<{ appid: number; ccu_tier: number; player_count: number }> {
  return Array.from(ccuData.entries()).map(([appid, playerCount]) => ({
    appid,
    ccu_tier: tier,
    player_count: playerCount,
  }));
}

function mainCcuStartedAfterIso(lookbackMinutes: number, now: Date): string {
  return new Date(now.getTime() - lookbackMinutes * 60 * 1000).toISOString();
}

async function countActiveMainCcuJobs(tiger: TigerWriter, now: Date = new Date()): Promise<number> {
  const counts = await Promise.all(
    MAIN_CCU_JOB_GUARDS.map((guard) =>
      tiger.ops.countRunningSyncJobsByTypes(
        [...guard.jobTypes],
        mainCcuStartedAfterIso(guard.lookbackMinutes, now)
      )
    )
  );

  return counts.reduce((total, count) => total + count, 0);
}

async function isMainCcuActive(tiger: TigerWriter): Promise<boolean> {
  return (await countActiveMainCcuJobs(tiger)) > 0;
}

async function runDemoTierFetch(params: {
  appids: number[];
  env: NodeJS.ProcessEnv;
  fetchBatch: FetchSteamCcuBatch;
  shouldYieldToMainCcu: () => Promise<boolean>;
  supabaseForGuardrails: SupabaseClient;
  tier: number;
  tiger: TigerWriter;
}): Promise<TierFetchResult> {
  const result = createEmptyBatchResult();
  if (params.appids.length === 0) {
    return { result, stoppedForMainCcu: false };
  }

  const suspiciousZeroAppids = await getSuspiciousZeroAppids(
    params.supabaseForGuardrails,
    params.appids,
    { env: params.env, tiger: params.tiger }
  );

  for (let offset = 0; offset < params.appids.length; offset += CHECK_CHUNK_SIZE) {
    if (await params.shouldYieldToMainCcu()) {
      log.info('Main CCU job detected; stopping demo CCU fetch early', {
        tier: params.tier,
        processed: result.results.size,
        planned: params.appids.length,
      });
      return { result, stoppedForMainCcu: true };
    }

    const chunk = params.appids.slice(offset, offset + CHECK_CHUNK_SIZE);
    const chunkResult = await params.fetchBatch(
      chunk,
      (processed) => {
        const totalProcessed = offset + processed;
        if (totalProcessed % 100 === 0 || totalProcessed === params.appids.length) {
          log.info('Demo CCU fetch progress', {
            tier: params.tier,
            processed: totalProcessed,
            total: params.appids.length,
          });
        }
      },
      undefined,
      { suspiciousZeroAppids }
    );

    mergeBatchResult(result, chunkResult);
  }

  return { result, stoppedForMainCcu: false };
}

async function persistDemoValidation(
  supabase: SupabaseClient,
  results: Map<number, CCUResultWithStatus>,
  tiger: TigerWriter
): Promise<void> {
  const skipUntil = new Date();
  skipUntil.setDate(skipUntil.getDate() + INVALID_SKIP_DAYS);
  const persisted = await persistOfficialDemoCcuValidationResults(
    supabase,
    results,
    new Date().toISOString(),
    skipUntil.toISOString(),
    tiger
  );
  log.info('Persisted demo CCU validation state', { ...persisted });
}

async function persistDemoResults(params: {
  supabaseForGuardrails: SupabaseClient;
  tier1Result: CCUBatchResultWithStatus;
  tier2Result: CCUBatchResultWithStatus;
  tiger: TigerWriter;
}): Promise<{ tier1Succeeded: number; tier2Succeeded: number }> {
  const tier1CcuData = extractValidCcuData(params.tier1Result);
  const tier2CcuData = extractValidCcuData(params.tier2Result);
  const combinedCcuData = new Map([...tier1CcuData, ...tier2CcuData]);
  const combinedResults = new Map([
    ...params.tier1Result.results,
    ...params.tier2Result.results,
  ]);

  if (combinedResults.size === 0) {
    return { tier1Succeeded: 0, tier2Succeeded: 0 };
  }

  const today = new Date().toISOString().split('T')[0];
  await params.tiger.metrics.upsertDailyCcuPeaks(buildDailyCcuRows(combinedCcuData, today));
  await params.tiger.metrics.insertCcuSnapshots([
    ...toSnapshotRows(tier1CcuData, 1),
    ...toSnapshotRows(tier2CcuData, 2),
  ]);
  await persistDemoValidation(params.supabaseForGuardrails, combinedResults, params.tiger);

  return {
    tier1Succeeded: tier1CcuData.size,
    tier2Succeeded: tier2CcuData.size,
  };
}

function buildJobMetadata(stats: DemoCcuTieredSyncStats, config: RunConfig): Record<string, unknown> {
  return {
    hotLimit: config.hotLimit,
    mainCcuGuardJobTypes: MAIN_CCU_JOB_GUARDS.map((guard) => guard.jobTypes),
    newDemoWindowDays: config.newDemoWindowDays,
    tailLimit: config.tailLimit,
    ...stats,
  };
}

export async function runTigerCcuDemoTieredSync(
  dependencies: DemoCcuTieredSyncDependencies = {}
): Promise<DemoCcuTieredSyncStats> {
  const env = dependencies.env ?? process.env;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const fetchBatch = dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const config = readRunConfig(env);
  const stats = createStats();
  const startTime = Date.now();
  const supabasePlaceholder = {} as SupabaseClient;

  log.info('Starting Tiger demo mini-tiered CCU sync', {
    githubRunId: config.githubRunId,
    hotLimit: config.hotLimit,
    newDemoWindowDays: config.newDemoWindowDays,
    tailLimit: config.tailLimit,
  });

  const jobId = await tiger.ops.createSyncJob({
    batchSize: config.hotLimit + config.tailLimit,
    githubRunId: config.githubRunId,
    jobType: 'ccu-demo-tiered',
  });

  try {
    if (await isMainCcuActive(tiger)) {
      stats.skippedForMainCcu = true;
      log.info('Skipping demo CCU sync because a main CCU job is active');

      if (jobId) {
        await tiger.ops.updateSyncJob(jobId, {
          completed_at: new Date().toISOString(),
          items_failed: 0,
          items_processed: 0,
          items_skipped: config.hotLimit + config.tailLimit,
          items_succeeded: 0,
          metadata: buildJobMetadata(stats, config),
          status: 'completed',
        });
      }
      return stats;
    }

    const tierCounts = await tiger.metrics.recalculateDemoCcuTiers({
      hotLimit: config.hotLimit,
      newDemoWindowDays: config.newDemoWindowDays,
    });
    stats.tierRecalculated = true;
    log.info('Demo CCU tier recalculation complete', {
      tier1Count: tierCounts.tier1Count,
      tier2Count: tierCounts.tier2Count,
    });

    if (await isMainCcuActive(tiger)) {
      stats.stoppedForMainCcu = true;
      log.info('Main CCU job detected after demo tier recalculation; stopping before polling');
    }

    let tier1Appids: number[] = [];
    let tier2Appids: number[] = [];
    const tier1Result = createEmptyBatchResult();
    const tier2Result = createEmptyBatchResult();

    if (!stats.stoppedForMainCcu) {
      const tier1Candidates = await tiger.metrics.listDemoCcuTierAppids({
        limit: config.hotLimit,
        nowIso: new Date().toISOString(),
        tier: 1,
      });
      tier1Appids = tier1Candidates.appids;
      stats.tier1Skipped = tier1Candidates.skippedCount;

      const fetchedTier1 = await runDemoTierFetch({
        appids: tier1Appids,
        env,
        fetchBatch,
        shouldYieldToMainCcu: () => isMainCcuActive(tiger),
        supabaseForGuardrails: supabasePlaceholder,
        tier: 1,
        tiger,
      });
      mergeBatchResult(tier1Result, fetchedTier1.result);
      stats.stoppedForMainCcu = fetchedTier1.stoppedForMainCcu;
    }

    if (!stats.stoppedForMainCcu && config.tailLimit > 0) {
      if (await isMainCcuActive(tiger)) {
        stats.stoppedForMainCcu = true;
        log.info('Main CCU job detected before demo tail polling; leaving tail capacity unused');
      } else {
        const tier2Candidates = await tiger.metrics.listDemoCcuTierAppids({
          limit: config.tailLimit,
          nowIso: new Date().toISOString(),
          tier: 2,
        });
        tier2Appids = tier2Candidates.appids;
        stats.tier2Skipped = tier2Candidates.skippedCount;

        const fetchedTier2 = await runDemoTierFetch({
          appids: tier2Appids,
          env,
          fetchBatch,
          shouldYieldToMainCcu: () => isMainCcuActive(tiger),
          supabaseForGuardrails: supabasePlaceholder,
          tier: 2,
          tiger,
        });
        mergeBatchResult(tier2Result, fetchedTier2.result);
        stats.stoppedForMainCcu = fetchedTier2.stoppedForMainCcu;
      }
    }

    stats.tier1Processed = tier1Result.results.size;
    stats.tier2Processed = tier2Result.results.size;
    stats.totalInvalid = tier1Result.invalidCount + tier2Result.invalidCount;
    stats.totalFailed =
      tier1Result.invalidCount +
      tier1Result.errorCount +
      tier2Result.invalidCount +
      tier2Result.errorCount;

    const persisted = await persistDemoResults({
      supabaseForGuardrails: supabasePlaceholder,
      tier1Result,
      tier2Result,
      tiger,
    });
    stats.tier1Succeeded = persisted.tier1Succeeded;
    stats.tier2Succeeded = persisted.tier2Succeeded;

    const unprocessedPlannedAppids =
      Math.max(0, tier1Appids.length - stats.tier1Processed) +
      Math.max(0, tier2Appids.length - stats.tier2Processed);

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        completed_at: new Date().toISOString(),
        items_failed: stats.totalFailed,
        items_processed: stats.tier1Processed + stats.tier2Processed,
        items_skipped: stats.tier1Skipped + stats.tier2Skipped + unprocessedPlannedAppids,
        items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
        metadata: buildJobMetadata(stats, config),
        status: 'completed',
      });
    }

    await refreshCcuQualityCache('ccu-demo-tiered');
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiger demo mini-tiered CCU sync completed', {
      ...stats,
      durationMinutes: duration,
    });
    return stats;
  } catch (error) {
    log.error('Tiger demo mini-tiered CCU sync failed', { error });
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_failed: stats.totalFailed,
        items_processed: stats.tier1Processed + stats.tier2Processed,
        items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
        metadata: buildJobMetadata(stats, config),
        status: 'failed',
      });
    }
    throw error;
  }
}

export async function runCcuDemoTieredSync(
  dependencies: DemoCcuTieredSyncDependencies = {}
): Promise<DemoCcuTieredSyncStats> {
  const env = dependencies.env ?? process.env;
  if (readDataWriteTarget(env) !== 'tiger') {
    throw new Error('Demo CCU tiered sync requires DATA_WRITE_TARGET=tiger');
  }

  return runTigerCcuDemoTieredSync(dependencies);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runCcuDemoTieredSync().catch((error) => {
    log.error('Demo mini-tiered CCU sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
