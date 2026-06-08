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
import {
  formatMainCcuCounts,
  inspectMainCcuActivity,
  MAIN_CCU_JOB_TYPES,
} from '../workers-support/ccu-sync-job-guard.js';
import { persistOfficialDemoCcuValidationResults } from '../workers-support/ccu-validation.js';

const log = logger.child({ worker: 'ccu-demo-tiered-sync' });
const DEFAULT_HOT_LIMIT = 300;
const DEFAULT_TAIL_LIMIT = 500;
const DEFAULT_NEW_DEMO_WINDOW_DAYS = 14;
const DEFAULT_STEAM_ERROR_RATE_THRESHOLD = 0.2;
const DEFAULT_STEAM_BACKOFF_MINUTES = 30;
const CHECK_CHUNK_SIZE = 25;
const INVALID_SKIP_DAYS = 30;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchSteamCcuBatch = typeof fetchSteamCCUBatchWithStatus;
export type DemoCcuMainCcuGuardMode = 'strict' | 'hot_independent';

export interface DemoCcuTieredSyncStats {
  skippedForMainCcu: boolean;
  stoppedForMainCcu: boolean;
  stoppedForSteamBackoff: boolean;
  steamBackoffUntilIso: string | null;
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
  now?: () => Date;
  refreshCcuQualityCache?: typeof refreshCcuQualityCacheSafely;
}

interface RunConfig {
  guardMode: DemoCcuMainCcuGuardMode;
  githubRunId: string | undefined;
  hotLimit: number;
  newDemoWindowDays: number;
  runtime: string | null;
  slotKey: string | null;
  steamBackoffMinutes: number;
  steamErrorRateThreshold: number;
  tailLimit: number;
}

interface TierFetchResult {
  result: CCUBatchResultWithStatus;
  stoppedForMainCcu: boolean;
  stoppedForSteamBackoff: boolean;
  steamBackoffUntilIso: string | null;
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

function parseFraction(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a number from 0 to 1 but received "${value}"`);
  }
  return parsed;
}

function readGuardMode(env: NodeJS.ProcessEnv): DemoCcuMainCcuGuardMode {
  const value = env.CCU_DEMO_MAIN_CCU_GUARD_MODE ?? 'strict';
  if (value === 'strict' || value === 'hot_independent') {
    return value;
  }
  throw new Error(
    `Expected CCU_DEMO_MAIN_CCU_GUARD_MODE to be "strict" or "hot_independent" but received "${value}"`
  );
}

function readRunConfig(env: NodeJS.ProcessEnv): RunConfig {
  return {
    guardMode: readGuardMode(env),
    githubRunId: env.GITHUB_RUN_ID,
    hotLimit: parsePositiveInteger(env.CCU_DEMO_HOT_LIMIT, DEFAULT_HOT_LIMIT),
    newDemoWindowDays: parsePositiveInteger(
      env.CCU_DEMO_NEW_DEMO_WINDOW_DAYS,
      DEFAULT_NEW_DEMO_WINDOW_DAYS
    ),
    runtime: env.CCU_DEMO_RUNTIME ?? null,
    slotKey: env.CCU_DEMO_SLOT_KEY ?? null,
    steamBackoffMinutes: parsePositiveInteger(
      env.CCU_DEMO_STEAM_BACKOFF_MINUTES,
      DEFAULT_STEAM_BACKOFF_MINUTES
    ),
    steamErrorRateThreshold: parseFraction(
      env.CCU_DEMO_STEAM_ERROR_RATE_THRESHOLD,
      DEFAULT_STEAM_ERROR_RATE_THRESHOLD
    ),
    tailLimit: parseNonNegativeInteger(env.CCU_DEMO_TAIL_LIMIT, DEFAULT_TAIL_LIMIT),
  };
}

function createStats(): DemoCcuTieredSyncStats {
  return {
    skippedForMainCcu: false,
    stoppedForMainCcu: false,
    stoppedForSteamBackoff: false,
    steamBackoffUntilIso: null,
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

async function isMainCcuActive(
  tiger: TigerWriter,
  env: NodeJS.ProcessEnv,
  context: string
): Promise<boolean> {
  const activity = await inspectMainCcuActivity({
    env,
    staleErrorMessage: 'abandoned_as_stale_before_demo_ccu_guard',
    tiger,
  });

  if (activity.active) {
    log.info('Main CCU job detected by demo guard', {
      blockingCounts: formatMainCcuCounts(activity.countsByType),
      context,
      countsByType: activity.countsByType,
      freshAfterIso: activity.freshAfterIso,
      staleBeforeIso: activity.staleBeforeIso,
      total: activity.total,
    });
  }

  return activity.active;
}

function buildSteamBackoffUntilIso(minutes: number, now: Date): string {
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

async function runDemoTierFetch(params: {
  appids: number[];
  config: RunConfig;
  env: NodeJS.ProcessEnv;
  fetchBatch: FetchSteamCcuBatch;
  now: () => Date;
  shouldYieldToMainCcu: () => Promise<boolean>;
  supabaseForGuardrails: SupabaseClient;
  tier: number;
  tiger: TigerWriter;
}): Promise<TierFetchResult> {
  const result = createEmptyBatchResult();
  if (params.appids.length === 0) {
    return {
      result,
      steamBackoffUntilIso: null,
      stoppedForMainCcu: false,
      stoppedForSteamBackoff: false,
    };
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
      return {
        result,
        steamBackoffUntilIso: null,
        stoppedForMainCcu: true,
        stoppedForSteamBackoff: false,
      };
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

    const chunkProcessed = chunkResult.results.size;
    const chunkErrorRate = chunkProcessed > 0 ? chunkResult.errorCount / chunkProcessed : 0;
    if (chunkProcessed > 0 && chunkErrorRate >= params.config.steamErrorRateThreshold) {
      const steamBackoffUntilIso = buildSteamBackoffUntilIso(
        params.config.steamBackoffMinutes,
        params.now()
      );
      log.warn('Steam CCU error rate crossed demo backoff threshold', {
        chunkErrorRate,
        errorCount: chunkResult.errorCount,
        processed: result.results.size,
        steamBackoffUntilIso,
        steamErrorRateThreshold: params.config.steamErrorRateThreshold,
        tier: params.tier,
        total: params.appids.length,
      });
      return {
        result,
        steamBackoffUntilIso,
        stoppedForMainCcu: false,
        stoppedForSteamBackoff: true,
      };
    }
  }

  return {
    result,
    steamBackoffUntilIso: null,
    stoppedForMainCcu: false,
    stoppedForSteamBackoff: false,
  };
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
    guardMode: config.guardMode,
    hotLimit: config.hotLimit,
    mainCcuGuardJobTypes: [...MAIN_CCU_JOB_TYPES],
    newDemoWindowDays: config.newDemoWindowDays,
    runtime: config.runtime,
    slotKey: config.slotKey,
    steamBackoffMinutes: config.steamBackoffMinutes,
    steamErrorRateThreshold: config.steamErrorRateThreshold,
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
  const now = dependencies.now ?? (() => new Date());
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const config = readRunConfig(env);
  const stats = createStats();
  const startTime = Date.now();
  const supabasePlaceholder = {} as SupabaseClient;

  log.info('Starting Tiger demo mini-tiered CCU sync', {
    guardMode: config.guardMode,
    githubRunId: config.githubRunId,
    hotLimit: config.hotLimit,
    newDemoWindowDays: config.newDemoWindowDays,
    runtime: config.runtime,
    slotKey: config.slotKey,
    tailLimit: config.tailLimit,
  });

  const jobId = await tiger.ops.createSyncJob({
    batchSize: config.hotLimit + config.tailLimit,
    githubRunId: config.githubRunId,
    jobType: 'ccu-demo-tiered',
  });

  try {
    const mainCcuActiveBeforeRanking = await isMainCcuActive(tiger, env, 'before_demo_ranking');
    if (mainCcuActiveBeforeRanking && config.guardMode === 'strict') {
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

    if (mainCcuActiveBeforeRanking) {
      log.info('Continuing demo hot tier while main CCU is active', {
        guardMode: config.guardMode,
      });
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

    const mainCcuActiveAfterRanking = await isMainCcuActive(tiger, env, 'after_demo_ranking');
    if (mainCcuActiveAfterRanking && config.guardMode === 'strict') {
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
        nowIso: now().toISOString(),
        tier: 1,
      });
      tier1Appids = tier1Candidates.appids;
      stats.tier1Skipped = tier1Candidates.skippedCount;

      const fetchedTier1 = await runDemoTierFetch({
        appids: tier1Appids,
        config,
        env,
        fetchBatch,
        now,
        shouldYieldToMainCcu:
          config.guardMode === 'strict'
            ? () => isMainCcuActive(tiger, env, 'tier1_chunk_guard')
            : async () => false,
        supabaseForGuardrails: supabasePlaceholder,
        tier: 1,
        tiger,
      });
      mergeBatchResult(tier1Result, fetchedTier1.result);
      stats.stoppedForMainCcu = fetchedTier1.stoppedForMainCcu;
      stats.stoppedForSteamBackoff = fetchedTier1.stoppedForSteamBackoff;
      stats.steamBackoffUntilIso = fetchedTier1.steamBackoffUntilIso;
    }

    if (!stats.stoppedForMainCcu && !stats.stoppedForSteamBackoff && config.tailLimit > 0) {
      if (await isMainCcuActive(tiger, env, 'before_tail_polling')) {
        stats.stoppedForMainCcu = true;
        log.info('Main CCU job detected before demo tail polling; leaving tail capacity unused');
      } else {
        const tier2Candidates = await tiger.metrics.listDemoCcuTierAppids({
          limit: config.tailLimit,
          nowIso: now().toISOString(),
          tier: 2,
        });
        tier2Appids = tier2Candidates.appids;
        stats.tier2Skipped = tier2Candidates.skippedCount;

        const fetchedTier2 = await runDemoTierFetch({
          appids: tier2Appids,
          config,
          env,
          fetchBatch,
          now,
          shouldYieldToMainCcu: () => isMainCcuActive(tiger, env, 'tier2_chunk_guard'),
          supabaseForGuardrails: supabasePlaceholder,
          tier: 2,
          tiger,
        });
        mergeBatchResult(tier2Result, fetchedTier2.result);
        stats.stoppedForMainCcu = fetchedTier2.stoppedForMainCcu;
        stats.stoppedForSteamBackoff = fetchedTier2.stoppedForSteamBackoff;
        stats.steamBackoffUntilIso = fetchedTier2.steamBackoffUntilIso;
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
