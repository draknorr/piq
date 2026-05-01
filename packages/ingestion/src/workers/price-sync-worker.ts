/**
 * Price Sync Worker
 *
 * Fetches only price data from Steam Storefront API using batch requests.
 *
 * Run with: pnpm --filter @publisheriq/ingestion price-sync
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type TigerWriter,
} from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import { fetchStorefrontPrices } from '../apis/storefront.js';

const log = logger.child({ worker: 'price-sync' });
const BATCH_SIZE_PER_REQUEST = 30;
const PRICE_STALE_MS = 6 * 60 * 60 * 1000;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type FetchStorefrontPrices = typeof fetchStorefrontPrices;

export interface PriceSyncStats {
  appsProcessed: number;
  appsUpdated: number;
  appsFailed: number;
  batchesMade: number;
}

export interface PriceSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchStorefrontPrices?: FetchStorefrontPrices;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createStats(): PriceSyncStats {
  return {
    appsProcessed: 0,
    appsUpdated: 0,
    appsFailed: 0,
    batchesMade: 0,
  };
}

async function getLegacyAppsForPriceSync(
  supabase: SupabaseClient,
  limit: number
): Promise<number[]> {
  const staleBefore = new Date(Date.now() - PRICE_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from('sync_status')
    .select('appid, priority_score')
    .eq('is_syncable', true)
    .or('storefront_accessible.is.null,storefront_accessible.eq.true')
    .or(`last_price_sync.is.null,last_price_sync.lt.${staleBefore}`)
    .order('priority_score', { ascending: false })
    .order('last_price_sync', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get apps for price sync: ${error.message}`);
  }

  return (data || []).map((row) => row.appid);
}

async function processTigerPriceBatch(params: {
  appids: number[];
  fetchPrices: FetchStorefrontPrices;
  stats: PriceSyncStats;
  tiger: TigerWriter;
}): Promise<void> {
  const { appids, fetchPrices, stats, tiger } = params;

  try {
    const priceResults = await fetchPrices(appids);
    const updateAppids: number[] = [];
    const updatePrices: number[] = [];
    const updateDiscounts: number[] = [];

    for (const [appid, priceInfo] of priceResults) {
      updateAppids.push(appid);
      updatePrices.push(priceInfo.priceCents ?? 0);
      updateDiscounts.push(priceInfo.discountPercent);
    }

    if (updateAppids.length > 0) {
      stats.appsUpdated += await tiger.metrics.batchUpdatePrices({
        appids: updateAppids,
        prices: updatePrices,
        discounts: updateDiscounts,
      });
    }

    stats.appsProcessed += appids.length;
    stats.batchesMade++;
  } catch (error) {
    log.error('Error processing Tiger price batch', { error, appids });
    stats.appsFailed += appids.length;
  }
}

async function processLegacyPriceBatch(
  appids: number[],
  supabase: SupabaseClient,
  stats: PriceSyncStats,
  fetchPrices: FetchStorefrontPrices
): Promise<void> {
  try {
    const priceResults = await fetchPrices(appids);
    const updateAppids: number[] = [];
    const updatePrices: number[] = [];
    const updateDiscounts: number[] = [];

    for (const [appid, priceInfo] of priceResults) {
      updateAppids.push(appid);
      updatePrices.push(priceInfo.priceCents ?? 0);
      updateDiscounts.push(priceInfo.discountPercent);
    }

    if (updateAppids.length > 0) {
      const { data: updated, error: updateError } = await supabase.rpc('batch_update_prices', {
        p_appids: updateAppids,
        p_prices: updatePrices,
        p_discounts: updateDiscounts,
      });

      if (updateError) {
        log.error('Failed to batch update prices', { error: updateError });
        stats.appsFailed += updateAppids.length;
        return;
      }

      stats.appsUpdated += typeof updated === 'number' ? updated : updateAppids.length;
    }

    stats.appsProcessed += appids.length;
    stats.batchesMade++;
  } catch (error) {
    log.error('Error processing price batch', { error, appids });
    stats.appsFailed += appids.length;
  }
}

export async function runTigerPriceSync(
  dependencies: PriceSyncDependencies = {}
): Promise<PriceSyncStats> {
  const env = dependencies.env ?? process.env;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const fetchPrices = dependencies.fetchStorefrontPrices ?? fetchStorefrontPrices;
  const totalBatchSize = parsePositiveInteger(
    env.BATCH_SIZE,
    BATCH_SIZES.STOREFRONT_BATCH
  );
  const startTime = Date.now();
  const stats = createStats();

  log.info('Starting Tiger Price sync', {
    githubRunId: env.GITHUB_RUN_ID,
    totalBatchSize,
    batchSizePerRequest: BATCH_SIZE_PER_REQUEST,
  });

  const jobId = await tiger.ops.createSyncJob({
    jobType: 'price',
    githubRunId: env.GITHUB_RUN_ID,
    batchSize: totalBatchSize,
  });

  try {
    const staleBefore = new Date(Date.now() - PRICE_STALE_MS).toISOString();
    const appids = await tiger.metrics.listPriceSyncAppids(totalBatchSize, staleBefore);

    if (appids.length === 0) {
      log.info('No apps due for Tiger price sync');
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

    const progressInterval = setInterval(() => {
      log.info('Tiger price sync progress', { ...stats });
    }, 10000);

    try {
      for (let i = 0; i < appids.length; i += BATCH_SIZE_PER_REQUEST) {
        await processTigerPriceBatch({
          appids: appids.slice(i, i + BATCH_SIZE_PER_REQUEST),
          fetchPrices,
          stats,
          tiger,
        });
      }
    } finally {
      clearInterval(progressInterval);
    }

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsUpdated,
        items_failed: stats.appsFailed,
      });
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiger Price sync completed', { ...stats, durationMinutes: duration });
    return stats;
  } catch (error) {
    log.error('Tiger Price sync failed', { error });
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsUpdated,
        items_failed: stats.appsFailed,
      });
    }
    throw error;
  }
}

export async function runLegacySupabasePriceSync(
  dependencies: PriceSyncDependencies = {}
): Promise<PriceSyncStats> {
  const env = dependencies.env ?? process.env;
  const supabase = dependencies.getSupabase?.() ?? getServiceClient();
  const fetchPrices = dependencies.fetchStorefrontPrices ?? fetchStorefrontPrices;
  const totalBatchSize = parsePositiveInteger(
    env.BATCH_SIZE,
    BATCH_SIZES.STOREFRONT_BATCH
  );
  const startTime = Date.now();
  const stats = createStats();

  log.info('Starting legacy Supabase Price sync', {
    githubRunId: env.GITHUB_RUN_ID,
    totalBatchSize,
    batchSizePerRequest: BATCH_SIZE_PER_REQUEST,
  });

  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'price',
      github_run_id: env.GITHUB_RUN_ID,
      status: 'running',
      batch_size: totalBatchSize,
    })
    .select()
    .single();

  if (jobError) {
    log.error('Failed to create sync job record', { error: jobError });
  }

  try {
    const appids = await getLegacyAppsForPriceSync(supabase, totalBatchSize);

    if (appids.length === 0) {
      log.info('No apps due for price sync');
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

    const progressInterval = setInterval(() => {
      log.info('Price sync progress', { ...stats });
    }, 10000);

    try {
      for (let i = 0; i < appids.length; i += BATCH_SIZE_PER_REQUEST) {
        await processLegacyPriceBatch(
          appids.slice(i, i + BATCH_SIZE_PER_REQUEST),
          supabase,
          stats,
          fetchPrices
        );
      }
    } finally {
      clearInterval(progressInterval);
    }

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsUpdated,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Legacy Supabase Price sync completed', { ...stats, durationMinutes: duration });
    return stats;
  } catch (error) {
    log.error('Price sync failed', { error });
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsUpdated,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }
    throw error;
  }
}

export async function runPriceSync(
  dependencies: PriceSyncDependencies = {}
): Promise<PriceSyncStats> {
  const env = dependencies.env ?? process.env;
  return readDataWriteTarget(env) === 'tiger'
    ? runTigerPriceSync(dependencies)
    : runLegacySupabasePriceSync(dependencies);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runPriceSync().catch((error) => {
    log.error('Price sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
