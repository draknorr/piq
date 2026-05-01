/**
 * CCU Sync Worker
 *
 * Fetches concurrent player counts from Steam's official API.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-sync
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
} from '../apis/steam-ccu.js';
import { getSuspiciousZeroAppids } from '../workers-support/ccu-guardrails.js';
import { refreshCcuQualityCacheSafely } from '../workers-support/ccu-quality-cache.js';
import { persistOfficialCcuValidationResults } from '../workers-support/ccu-validation.js';

const log = logger.child({ worker: 'ccu-sync' });
const DEFAULT_CCU_LIMIT = 1000;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchSteamCcuBatch = typeof fetchSteamCCUBatchWithStatus;

export interface CcuSyncStats {
  appsProcessed: number;
  appsSucceeded: number;
  appsFailed: number;
}

export interface CcuSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchSteamCCUBatchWithStatus?: FetchSteamCcuBatch;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
  refreshCcuQualityCache?: typeof refreshCcuQualityCacheSafely;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createStats(): CcuSyncStats {
  return {
    appsProcessed: 0,
    appsSucceeded: 0,
    appsFailed: 0,
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

async function getLegacyCcuCandidates(
  supabase: SupabaseClient,
  limit: number
): Promise<number[]> {
  const { data, error } = await supabase
    .from('apps')
    .select('appid')
    .eq('type', 'game')
    .eq('is_released', true)
    .eq('is_delisted', false)
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get CCU candidates: ${error.message}`);
  }

  return data?.map((app) => app.appid) ?? [];
}

async function upsertLegacyCcuData(
  supabase: SupabaseClient,
  ccuData: Map<number, number>,
  today: string
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  const entries = Array.from(ccuData.entries());
  const batchSize = 100;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const appids = batch.map(([appid]) => appid);
    const { data: existing } = await supabase
      .from('daily_metrics')
      .select('appid, ccu_peak')
      .in('appid', appids)
      .eq('metric_date', today);
    const existingMap = new Map(existing?.map((row) => [row.appid, row.ccu_peak ?? 0]) ?? []);
    const toUpsert = batch
      .filter(([appid, newCcu]) => newCcu >= (existingMap.get(appid) ?? 0))
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
      log.error('Failed to upsert CCU batch', { error, batchStart: i });
      failed += batch.length;
    } else {
      succeeded += batch.length;
    }
  }

  return { succeeded, failed };
}

async function persistValidation(
  supabase: SupabaseClient,
  result: CCUBatchResultWithStatus,
  tiger?: TigerWriter
): Promise<void> {
  const skipUntil = new Date();
  skipUntil.setDate(skipUntil.getDate() + 30);
  await persistOfficialCcuValidationResults(
    supabase,
    result.results,
    new Date().toISOString(),
    skipUntil.toISOString(),
    tiger
  );
}

export async function runTigerCcuSync(
  dependencies: CcuSyncDependencies = {}
): Promise<CcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const fetchBatch = dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const ccuLimit = parsePositiveInteger(env.CCU_LIMIT, DEFAULT_CCU_LIMIT);
  const stats = createStats();
  const startTime = Date.now();
  const supabasePlaceholder = {} as SupabaseClient;

  log.info('Starting Tiger CCU sync', { githubRunId: env.GITHUB_RUN_ID, ccuLimit });

  const jobId = await tiger.ops.createSyncJob({
    jobType: 'ccu',
    githubRunId: env.GITHUB_RUN_ID,
    batchSize: ccuLimit,
  });

  try {
    const appids = await tiger.metrics.listCcuSyncCandidates(ccuLimit);

    if (appids.length === 0) {
      log.info('No apps found for Tiger CCU sync');
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

    const suspiciousZeroAppids = await getSuspiciousZeroAppids(
      supabasePlaceholder,
      appids,
      { env, tiger }
    );
    const result = await fetchBatch(
      appids,
      (processed, total) => log.info('CCU fetch progress', { processed, total }),
      undefined,
      { suspiciousZeroAppids }
    );
    const validCcuData = extractValidCcuData(result);
    stats.appsProcessed = appids.length;

    const today = new Date().toISOString().split('T')[0];
    const rows = buildDailyCcuRows(validCcuData, today);
    await tiger.metrics.upsertDailyCcuPeaks(rows);
    await persistValidation(supabasePlaceholder, result, tiger);

    stats.appsSucceeded = rows.length;
    stats.appsFailed = result.invalidCount + result.errorCount;

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsSucceeded,
        items_failed: stats.appsFailed,
      });
    }

    await refreshCcuQualityCache('ccu');

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiger CCU sync completed', { ...stats, durationMinutes: duration });
    return stats;
  } catch (error) {
    log.error('Tiger CCU sync failed', { error });
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

export async function runLegacySupabaseCcuSync(
  dependencies: CcuSyncDependencies = {}
): Promise<CcuSyncStats> {
  const env = dependencies.env ?? process.env;
  const supabase = dependencies.getSupabase?.() ?? getServiceClient();
  const fetchBatch = dependencies.fetchSteamCCUBatchWithStatus ?? fetchSteamCCUBatchWithStatus;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const ccuLimit = parsePositiveInteger(env.CCU_LIMIT, DEFAULT_CCU_LIMIT);
  const stats = createStats();
  const startTime = Date.now();

  log.info('Starting legacy Supabase CCU sync', { githubRunId: env.GITHUB_RUN_ID, ccuLimit });

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'ccu',
      github_run_id: env.GITHUB_RUN_ID,
      status: 'running',
      batch_size: ccuLimit,
    })
    .select()
    .single();

  try {
    const appids = await getLegacyCcuCandidates(supabase, ccuLimit);

    if (appids.length === 0) {
      log.info('No apps found for CCU sync');
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

    const suspiciousZeroAppids = await getSuspiciousZeroAppids(supabase, appids);
    const result = await fetchBatch(
      appids,
      (processed, total) => log.info('CCU fetch progress', { processed, total }),
      undefined,
      { suspiciousZeroAppids }
    );
    const validCcuData = extractValidCcuData(result);
    stats.appsProcessed = appids.length;

    const today = new Date().toISOString().split('T')[0];
    const { succeeded, failed } = await upsertLegacyCcuData(supabase, validCcuData, today);
    await persistValidation(supabase, result);

    stats.appsSucceeded = succeeded;
    stats.appsFailed = failed + result.invalidCount + result.errorCount;

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

    await refreshCcuQualityCache('ccu');

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Legacy Supabase CCU sync completed', { ...stats, durationMinutes: duration });
    return stats;
  } catch (error) {
    log.error('CCU sync failed', { error });
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

export async function runCcuSync(
  dependencies: CcuSyncDependencies = {}
): Promise<CcuSyncStats> {
  const env = dependencies.env ?? process.env;
  return readDataWriteTarget(env) === 'tiger'
    ? runTigerCcuSync(dependencies)
    : runLegacySupabaseCcuSync(dependencies);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runCcuSync().catch((error) => {
    log.error('CCU sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
