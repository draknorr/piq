/**
 * Tiered CCU Sync Worker
 *
 * Fetches current player counts for Tier 1 every hour and Tier 2 on even hours.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-tiered-sync
 */

import { pathToFileURL } from "node:url";
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  recalculateCcuTiers,
  type DailyCcuPeakUpsert,
  type TigerWriter,
} from "@publisheriq/database";
import { logger } from "@publisheriq/shared";
import {
  fetchSteamCCUBatchWithStatus,
  type CCUBatchResultWithStatus,
  type CCUResultWithStatus,
} from "../apis/steam-ccu.js";
import {
  getSuspiciousZeroAppids,
  isTierAssignmentsStale,
} from "../workers-support/ccu-guardrails.js";
import { refreshCcuQualityCacheSafely } from "../workers-support/ccu-quality-cache.js";
import { persistOfficialCcuValidationResults } from "../workers-support/ccu-validation.js";

const log = logger.child({ worker: "ccu-tiered-sync" });
const DEFAULT_RECALC_TIMEOUT_MS = 300_000;
const DEFAULT_CCU_LIMIT = 0;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchSteamCcuBatch = typeof fetchSteamCCUBatchWithStatus;

export interface TieredCcuSyncStats {
  tier1Processed: number;
  tier2Processed: number;
  tier1Succeeded: number;
  tier2Succeeded: number;
  totalFailed: number;
  tierRecalculated: boolean;
}

export interface TieredCcuSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchSteamCCUBatchWithStatus?: FetchSteamCcuBatch;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  refreshCcuQualityCache?: typeof refreshCcuQualityCacheSafely;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer but received "${value}"`);
  }
  return parsed;
}

function limitTierGames(
  tier1Games: number[],
  tier2Games: number[],
  limit: number,
): { tier1Games: number[]; tier2Games: number[] } {
  if (limit <= 0 || tier1Games.length + tier2Games.length <= limit) {
    return { tier1Games, tier2Games };
  }

  const selectedTier1Games = tier1Games.slice(0, limit);
  const remaining = Math.max(0, limit - selectedTier1Games.length);
  return {
    tier1Games: selectedTier1Games,
    tier2Games: tier2Games.slice(0, remaining),
  };
}

function createStats(): TieredCcuSyncStats {
  return {
    tier1Processed: 0,
    tier2Processed: 0,
    tier1Succeeded: 0,
    tier2Succeeded: 0,
    totalFailed: 0,
    tierRecalculated: false,
  };
}

async function recalculateTiers(timeoutMs: number): Promise<void> {
  const result = await recalculateCcuTiers({ timeoutMs });
  log.info("Tier recalculation complete", {
    tier1: result.tier1Count,
    tier2: result.tier2Count,
    tier3: result.tier3Count,
  });
}

async function getLegacyTierGames(
  supabase: SupabaseClient,
  tiers: number[],
): Promise<Map<number, number[]>> {
  const { data, error } = await supabase
    .from("ccu_tier_assignments")
    .select("appid, ccu_tier")
    .in("ccu_tier", tiers);

  if (error) {
    throw new Error(`Failed to get tier assignments: ${error.message}`);
  }

  const result = new Map<number, number[]>();
  for (const tier of tiers) {
    result.set(tier, []);
  }
  for (const assignment of data as Array<{ appid: number; ccu_tier: number }>) {
    result.get(assignment.ccu_tier)?.push(assignment.appid);
  }
  return result;
}

async function getTigerTierGames(
  tiger: TigerWriter,
  tiers: number[],
): Promise<Map<number, number[]>> {
  const assignments = await tiger.metrics.listCcuTierAssignments(tiers);
  const result = new Map<number, number[]>();
  for (const tier of tiers) {
    result.set(tier, []);
  }
  for (const assignment of assignments) {
    result.get(assignment.ccuTier)?.push(assignment.appid);
  }
  return result;
}

function extractValidCcuData(
  result: CCUBatchResultWithStatus,
): Map<number, number> {
  const validCcuData = new Map<number, number>();
  for (const [appid, ccuResult] of result.results) {
    if (ccuResult.status === "valid" && ccuResult.playerCount !== undefined) {
      validCcuData.set(appid, ccuResult.playerCount);
    }
  }
  return validCcuData;
}

function buildDailyCcuRows(
  ccuData: Map<number, number>,
  today: string,
): DailyCcuPeakUpsert[] {
  return Array.from(ccuData.entries()).map(([appid, ccu]) => ({
    appid,
    metric_date: today,
    ccu_peak: ccu,
    ccu_source: "steam_api",
  }));
}

async function insertLegacySnapshots(
  supabase: SupabaseClient,
  ccuData: Map<number, number>,
  tierMap: Map<number, number>,
): Promise<{ succeeded: number; failed: number }> {
  const snapshots = Array.from(ccuData.entries()).map(
    ([appid, playerCount]) => ({
      appid,
      player_count: playerCount,
      ccu_tier: tierMap.get(appid) ?? 3,
    }),
  );
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < snapshots.length; i += 500) {
    const batch = snapshots.slice(i, i + 500);
    const { error } = await supabase.from("ccu_snapshots").insert(batch);
    if (error) {
      log.error("Failed to insert snapshot batch", { error, batchStart: i });
      failed += batch.length;
    } else {
      succeeded += batch.length;
    }
  }
  return { succeeded, failed };
}

async function upsertLegacyDailyPeaks(
  supabase: SupabaseClient,
  ccuData: Map<number, number>,
  today: string,
): Promise<void> {
  for (let i = 0; i < Array.from(ccuData).length; i += 100) {
    const batch = Array.from(ccuData).slice(i, i + 100);
    const appids = batch.map(([appid]) => appid);
    const { data: existing } = await supabase
      .from("daily_metrics")
      .select("appid, ccu_peak")
      .in("appid", appids)
      .eq("metric_date", today);
    const existingMap = new Map(
      existing?.map((row) => [row.appid, row.ccu_peak ?? 0]) ?? [],
    );
    const toUpsert = batch
      .filter(([appid, ccu]) => ccu >= (existingMap.get(appid) ?? 0))
      .map(([appid, ccu]) => ({
        appid,
        metric_date: today,
        ccu_peak: ccu,
        ccu_source: "steam_api" as const,
      }));
    if (toUpsert.length > 0) {
      await supabase.from("daily_metrics").upsert(toUpsert, {
        onConflict: "appid,metric_date",
        ignoreDuplicates: false,
      });
    }
  }
}

async function persistValidation(
  supabase: SupabaseClient,
  results: Map<number, CCUResultWithStatus>,
  tiger?: TigerWriter,
): Promise<void> {
  const skipUntil = new Date();
  skipUntil.setDate(skipUntil.getDate() + 30);
  const persisted = await persistOfficialCcuValidationResults(
    supabase,
    results,
    new Date().toISOString(),
    skipUntil.toISOString(),
    tiger,
  );
  log.info("Persisted tiered CCU validation state", { ...persisted });
}

function buildTierMap(
  tier1Games: number[],
  tier2Games: number[],
): Map<number, number> {
  const tierMap = new Map<number, number>();
  for (const appid of tier1Games) {
    tierMap.set(appid, 1);
  }
  for (const appid of tier2Games) {
    if (!tierMap.has(appid)) {
      tierMap.set(appid, 2);
    }
  }
  return tierMap;
}

async function runTieredFetch(params: {
  env?: NodeJS.ProcessEnv;
  fetchBatch: FetchSteamCcuBatch;
  gamesToPoll: number[];
  supabaseForGuardrails: SupabaseClient;
  tiger?: TigerWriter;
}): Promise<CCUBatchResultWithStatus> {
  const suspiciousZeroAppids = await getSuspiciousZeroAppids(
    params.supabaseForGuardrails,
    params.gamesToPoll,
    { env: params.env, tiger: params.tiger },
  );
  return params.fetchBatch(
    params.gamesToPoll,
    (processed, total) => {
      if (processed % 500 === 0) {
        log.info("CCU fetch progress", { processed, total });
      }
    },
    undefined,
    { suspiciousZeroAppids },
  );
}

export async function runTigerCcuTieredSync(
  dependencies: TieredCcuSyncDependencies = {},
): Promise<TieredCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const fetchBatch =
    dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const currentHour = new Date().getUTCHours();
  const isEvenHour = currentHour % 2 === 0;
  const recalcTimeoutMs = parsePositiveInteger(
    env.CCU_TIER_RECALC_TIMEOUT_MS,
    DEFAULT_RECALC_TIMEOUT_MS,
  );
  const ccuLimit = parseNonNegativeInteger(env.CCU_LIMIT, DEFAULT_CCU_LIMIT);
  const supabasePlaceholder = {} as SupabaseClient;
  const tierAssignmentsStale = await isTierAssignmentsStale(
    supabasePlaceholder,
    undefined,
    { env, tiger },
  );
  const shouldRecalculateTiers = currentHour === 0 || tierAssignmentsStale;
  const stats = createStats();
  const startTime = Date.now();

  log.info("Starting Tiger tiered CCU sync", {
    githubRunId: env.GITHUB_RUN_ID,
    currentHour,
    isEvenHour,
    shouldRecalculateTiers,
    ccuLimit: ccuLimit > 0 ? ccuLimit : null,
  });

  const jobId = await tiger.ops.createSyncJob({
    jobType: "ccu-tiered",
    githubRunId: env.GITHUB_RUN_ID,
  });

  try {
    if (shouldRecalculateTiers) {
      await recalculateTiers(recalcTimeoutMs);
      stats.tierRecalculated = true;
    }

    const tiersToFetch = isEvenHour ? [1, 2] : [1];
    const tierGames = await getTigerTierGames(tiger, tiersToFetch);
    const allTier1Games = tierGames.get(1) ?? [];
    const allTier2Games = isEvenHour ? (tierGames.get(2) ?? []) : [];
    const { tier1Games, tier2Games } = limitTierGames(
      allTier1Games,
      allTier2Games,
      ccuLimit,
    );
    const gamesToPoll = [...tier1Games, ...tier2Games];
    stats.tier1Processed = tier1Games.length;
    stats.tier2Processed = tier2Games.length;

    if (gamesToPoll.length === 0) {
      log.info("No tiered games to poll this hour");
      if (jobId) {
        await tiger.ops.updateSyncJob(jobId, {
          status: "completed",
          completed_at: new Date().toISOString(),
          items_processed: 0,
          items_succeeded: 0,
          items_failed: 0,
        });
      }
      return stats;
    }

    const tierMap = buildTierMap(tier1Games, tier2Games);
    const result = await runTieredFetch({
      env,
      fetchBatch,
      gamesToPoll,
      supabaseForGuardrails: supabasePlaceholder,
      tiger,
    });
    const validCcuData = extractValidCcuData(result);

    await tiger.metrics.insertCcuSnapshots(
      Array.from(validCcuData.entries()).map(([appid, playerCount]) => ({
        appid,
        player_count: playerCount,
        ccu_tier: tierMap.get(appid) ?? 3,
      })),
    );
    await tiger.metrics.upsertDailyCcuPeaks(
      buildDailyCcuRows(validCcuData, new Date().toISOString().split("T")[0]),
    );
    await persistValidation(supabasePlaceholder, result.results, tiger);

    for (const [appid] of validCcuData) {
      const tier = tierMap.get(appid);
      if (tier === 1) stats.tier1Succeeded++;
      if (tier === 2) stats.tier2Succeeded++;
    }
    stats.totalFailed = result.invalidCount + result.errorCount;

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: "completed",
        completed_at: new Date().toISOString(),
        items_processed: stats.tier1Processed + stats.tier2Processed,
        items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
        items_failed: stats.totalFailed,
      });
    }

    await refreshCcuQualityCache("ccu-tiered");
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info("Tiger tiered CCU sync completed", {
      ...stats,
      durationMinutes: duration,
    });
    return stats;
  } catch (error) {
    log.error("Tiger tiered CCU sync failed", { error });
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_processed: stats.tier1Processed + stats.tier2Processed,
        items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
        items_failed: stats.totalFailed,
      });
    }
    throw error;
  }
}

export async function runLegacySupabaseCcuTieredSync(
  dependencies: TieredCcuSyncDependencies = {},
): Promise<TieredCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const supabase = dependencies.getSupabase?.() ?? getServiceClient();
  const fetchBatch =
    dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const currentHour = new Date().getUTCHours();
  const isEvenHour = currentHour % 2 === 0;
  const recalcTimeoutMs = parsePositiveInteger(
    env.CCU_TIER_RECALC_TIMEOUT_MS,
    DEFAULT_RECALC_TIMEOUT_MS,
  );
  const ccuLimit = parseNonNegativeInteger(env.CCU_LIMIT, DEFAULT_CCU_LIMIT);
  const stats = createStats();
  const startTime = Date.now();
  const tierAssignmentsStale = await isTierAssignmentsStale(supabase);
  const shouldRecalculateTiers = currentHour === 0 || tierAssignmentsStale;

  log.info("Starting legacy Supabase tiered CCU sync", {
    githubRunId: env.GITHUB_RUN_ID,
    currentHour,
    isEvenHour,
    shouldRecalculateTiers,
    ccuLimit: ccuLimit > 0 ? ccuLimit : null,
  });

  const { data: job } = await supabase
    .from("sync_jobs")
    .insert({
      job_type: "ccu-tiered",
      github_run_id: env.GITHUB_RUN_ID,
      status: "running",
    })
    .select()
    .single();

  try {
    if (shouldRecalculateTiers) {
      await recalculateTiers(recalcTimeoutMs);
      stats.tierRecalculated = true;
    }

    const tiersToFetch = isEvenHour ? [1, 2] : [1];
    const tierGames = await getLegacyTierGames(supabase, tiersToFetch);
    const allTier1Games = tierGames.get(1) ?? [];
    const allTier2Games = isEvenHour ? (tierGames.get(2) ?? []) : [];
    const { tier1Games, tier2Games } = limitTierGames(
      allTier1Games,
      allTier2Games,
      ccuLimit,
    );
    const gamesToPoll = [...tier1Games, ...tier2Games];
    stats.tier1Processed = tier1Games.length;
    stats.tier2Processed = tier2Games.length;

    if (gamesToPoll.length === 0) {
      log.info("No games to poll this hour");
      if (job) {
        await supabase
          .from("sync_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            items_processed: 0,
            items_succeeded: 0,
            items_failed: 0,
          })
          .eq("id", job.id);
      }
      return stats;
    }

    const tierMap = buildTierMap(tier1Games, tier2Games);
    const result = await runTieredFetch({
      fetchBatch,
      gamesToPoll,
      supabaseForGuardrails: supabase,
    });
    const validCcuData = extractValidCcuData(result);
    const { failed: snapshotFailed } = await insertLegacySnapshots(
      supabase,
      validCcuData,
      tierMap,
    );
    await upsertLegacyDailyPeaks(
      supabase,
      validCcuData,
      new Date().toISOString().split("T")[0],
    );
    await persistValidation(supabase, result.results);

    for (const [appid] of validCcuData) {
      const tier = tierMap.get(appid);
      if (tier === 1) stats.tier1Succeeded++;
      if (tier === 2) stats.tier2Succeeded++;
    }
    stats.totalFailed =
      result.invalidCount + result.errorCount + snapshotFailed;

    if (job) {
      await supabase
        .from("sync_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          items_processed: stats.tier1Processed + stats.tier2Processed,
          items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
          items_failed: stats.totalFailed,
        })
        .eq("id", job.id);
    }

    await refreshCcuQualityCache("ccu-tiered");
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info("Legacy Supabase tiered CCU sync completed", {
      ...stats,
      durationMinutes: duration,
    });
    return stats;
  } catch (error) {
    log.error("Tiered CCU sync failed", { error });
    if (job) {
      await supabase
        .from("sync_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.tier1Processed + stats.tier2Processed,
          items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
          items_failed: stats.totalFailed,
        })
        .eq("id", job.id);
    }
    throw error;
  }
}

export async function runCcuTieredSync(
  dependencies: TieredCcuSyncDependencies = {},
): Promise<TieredCcuSyncStats> {
  const env = dependencies.env ?? process.env;
  return readDataWriteTarget(env) === "tiger"
    ? runTigerCcuTieredSync(dependencies)
    : runLegacySupabaseCcuTieredSync(dependencies);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runCcuTieredSync().catch((error) => {
    log.error("Tiered CCU sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
