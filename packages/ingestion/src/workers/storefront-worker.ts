/**
 * Storefront Details Sync Worker
 *
 * Fetches app details from Steam Storefront API for apps due for sync.
 * Prioritizes apps by priority_score.
 *
 * Run with: pnpm --filter @publisheriq/ingestion storefront-sync
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type StorefrontSyncStatus,
  type TigerWriter,
} from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import pLimit from 'p-limit';
import {
  fetchStorefrontAppDetails,
  type StorefrontResult,
} from '../apis/storefront.js';
import { upsertLatestStorefrontState } from '../change-intel/storefront-latest-state.js';
import { captureStorefrontState } from '../workers-support/change-intel.js';

const log = logger.child({ worker: 'storefront-sync' });

const GRACEFUL_TIMEOUT_MS = 38 * 60 * 1000;
const CONCURRENCY = 8;

export interface SyncStats {
  appsProcessed: number;
  appsCreated: number;
  appsUpdated: number;
  appsSkipped: number;
  appsFailed: number;
}

export interface StorefrontSyncOptions {
  env?: NodeJS.ProcessEnv;
  fetchStorefrontAppDetails?: (appid: number) => Promise<StorefrontResult>;
  getSupabase?: () => SupabaseClient;
  getTiger?: () => TigerWriter;
}

type SupabaseClient = ReturnType<typeof getServiceClient>;
interface LegacyAppsUpdateClient {
  from(table: 'apps'): {
    update(values: {
      catalog_seed_state: string;
      updated_at: string;
    }): {
      eq(column: string, value: string | number): {
        eq(column: string, value: string | number): Promise<{
          error: { message?: string | null } | null;
        }>;
      };
    };
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRunConfig(env: NodeJS.ProcessEnv): {
  batchSize: number;
  githubRunId: string | undefined;
  isPartitioned: boolean;
  partitionCount: number;
  partitionId: number;
} {
  const partitionCount = parsePositiveInteger(env.PARTITION_COUNT, 1);
  const partitionId = Math.max(0, Number.parseInt(env.PARTITION_ID || '0', 10) || 0);

  return {
    batchSize: parsePositiveInteger(
      env.BATCH_SIZE,
      BATCH_SIZES.STOREFRONT_BATCH
    ),
    githubRunId: env.GITHUB_RUN_ID,
    isPartitioned: partitionCount > 1,
    partitionCount,
    partitionId,
  };
}

function buildNeverSyncedSet(
  appIds: number[],
  syncStatuses: StorefrontSyncStatus[]
): Set<number> {
  const statusByAppid = new Map(
    syncStatuses.map((status) => [status.appid, status.lastStorefrontSync])
  );

  return new Set(
    appIds.filter((appid) => !statusByAppid.has(appid) || statusByAppid.get(appid) === null)
  );
}

function createTigerSupabasePlaceholder(): SupabaseClient {
  return {} as SupabaseClient;
}

function getLegacyAppsUpdateClient(supabase: SupabaseClient): LegacyAppsUpdateClient {
  return supabase as unknown as LegacyAppsUpdateClient;
}

export async function processTigerStorefrontApp(params: {
  appid: number;
  fetchDetails: (appid: number) => Promise<StorefrontResult>;
  neverSyncedSet: Set<number>;
  stats: SyncStats;
  tiger: TigerWriter;
}): Promise<void> {
  const { appid, fetchDetails, neverSyncedSet, stats, tiger } = params;
  stats.appsProcessed++;
  const observedAt = new Date().toISOString();

  try {
    const result = await fetchDetails(appid);

    if (result.status === 'no_data') {
      log.debug('No storefront data for app (private/removed)', { appid });
      stats.appsSkipped++;
      await tiger.catalog.markStorefrontInaccessible(appid, observedAt);
      return;
    }

    if (result.status === 'error') {
      log.error('API error fetching storefront data', { appid, error: result.error });
      stats.appsFailed++;
      await tiger.syncStatus.updateFields(appid, {
        last_error_source: 'storefront',
        last_error_message: result.error,
        last_error_at: observedAt,
      });
      return;
    }

    const supabasePlaceholder = createTigerSupabasePlaceholder();
    await captureStorefrontState(supabasePlaceholder, appid, result.data, {
      triggerReason: 'storefront_safety_sweep',
      triggerCursor: null,
    });
    await upsertLatestStorefrontState(supabasePlaceholder, appid, result.data, tiger);

    if (neverSyncedSet.has(appid)) {
      stats.appsCreated++;
    } else {
      stats.appsUpdated++;
    }
    log.debug('Synced app in Tiger', {
      appid,
      name: result.data.name,
      firstTime: neverSyncedSet.has(appid),
    });
  } catch (error) {
    log.error('Error processing app in Tiger', { appid, error });
    stats.appsFailed++;
    await tiger.syncStatus.updateFields(appid, {
      last_error_source: 'storefront',
      last_error_message: error instanceof Error ? error.message : String(error),
      last_error_at: observedAt,
    });
  }
}

async function processLegacyStorefrontApp(
  appid: number,
  supabase: SupabaseClient,
  neverSyncedSet: Set<number>,
  stats: SyncStats,
  fetchDetails: (appid: number) => Promise<StorefrontResult>
): Promise<void> {
  stats.appsProcessed++;
  const observedAt = new Date().toISOString();

  try {
    const result = await fetchDetails(appid);

    if (result.status === 'no_data') {
      log.debug('No storefront data for app (private/removed)', { appid });
      stats.appsSkipped++;

      await getLegacyAppsUpdateClient(supabase)
        .from('apps')
        .update({
          catalog_seed_state: 'inaccessible',
          updated_at: observedAt,
        })
        .eq('appid', appid)
        .eq('catalog_seed_state', 'stub');

      await supabase
        .from('sync_status')
        .update({
          storefront_accessible: false,
          last_storefront_sync: observedAt,
        })
        .eq('appid', appid);

      return;
    }

    if (result.status === 'error') {
      log.error('API error fetching storefront data', { appid, error: result.error });
      stats.appsFailed++;

      await supabase
        .from('sync_status')
        .update({
          last_error_source: 'storefront',
          last_error_message: result.error,
          last_error_at: observedAt,
        })
        .eq('appid', appid);

      return;
    }

    await captureStorefrontState(supabase, appid, result.data, {
      triggerReason: 'storefront_safety_sweep',
      triggerCursor: null,
    });
    await upsertLatestStorefrontState(supabase, appid, result.data);

    if (neverSyncedSet.has(appid)) {
      stats.appsCreated++;
    } else {
      stats.appsUpdated++;
    }
    log.debug('Synced app', { appid, name: result.data.name, firstTime: neverSyncedSet.has(appid) });
  } catch (error) {
    log.error('Error processing app', { appid, error });
    stats.appsFailed++;

    await supabase
      .from('sync_status')
      .update({
        last_error_source: 'storefront',
        last_error_message: error instanceof Error ? error.message : String(error),
        last_error_at: observedAt,
      })
      .eq('appid', appid);
  }
}

export async function runTigerStorefrontSync(
  options: StorefrontSyncOptions = {}
): Promise<SyncStats> {
  const env = options.env ?? process.env;
  const config = readRunConfig(env);
  const tiger = options.getTiger?.() ?? getTigerWriter(env);
  const fetchDetails = options.fetchStorefrontAppDetails ?? fetchStorefrontAppDetails;
  const startTime = Date.now();
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

  log.info('Starting Tiger Storefront sync', {
    githubRunId: config.githubRunId,
    batchSize: config.batchSize,
    ...(config.isPartitioned && {
      partitionCount: config.partitionCount,
      partitionId: config.partitionId,
    }),
  });

  const jobId = await tiger.ops.createSyncJob({
    jobType: 'storefront',
    githubRunId: config.githubRunId,
    batchSize: config.batchSize,
  });

  const stats: SyncStats = {
    appsProcessed: 0,
    appsCreated: 0,
    appsUpdated: 0,
    appsSkipped: 0,
    appsFailed: 0,
  };

  try {
    const appsToSync = await tiger.catalog.listAppsForSync({
      source: 'storefront',
      limit: config.batchSize,
      ...(config.isPartitioned
        ? {
            partitionCount: config.partitionCount,
            partitionId: config.partitionId,
          }
        : {}),
    });

    if (appsToSync.length === 0) {
      log.info('No apps due for storefront sync');
      clearTimeout(timeoutId);
      if (jobId) {
        await tiger.ops.updateSyncJob(jobId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: 0,
          items_succeeded: 0,
          items_failed: 0,
          items_created: 0,
          items_updated: 0,
        });
      }
      return stats;
    }

    log.info('Found apps to sync in Tiger', { count: appsToSync.length });

    const appIds = appsToSync.map((app) => app.appid);
    const syncStatuses = await tiger.catalog.listStorefrontSyncStatuses(appIds);
    const neverSyncedSet = buildNeverSyncedSet(appIds, syncStatuses);

    log.info('First-time vs refresh breakdown', {
      firstTime: neverSyncedSet.size,
      refresh: appsToSync.length - neverSyncedSet.size,
    });

    const limit = pLimit(CONCURRENCY);
    const progressInterval = setInterval(() => {
      log.info('Sync progress', { ...stats, isShuttingDown });
    }, 10000);
    const pendingPromises: Promise<void>[] = [];
    let stoppedEarly = false;

    try {
      for (const { appid } of appsToSync) {
        if (isShuttingDown) {
          log.info('Graceful shutdown, stopping new app processing', {
            processed: stats.appsProcessed,
            remaining: appsToSync.length - stats.appsProcessed,
          });
          stoppedEarly = true;
          break;
        }
        pendingPromises.push(
          limit(() =>
            processTigerStorefrontApp({
              appid,
              fetchDetails,
              neverSyncedSet,
              stats,
              tiger,
            })
          )
        );
      }

      await Promise.all(pendingPromises);
    } finally {
      clearInterval(progressInterval);
    }

    clearTimeout(timeoutId);

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsCreated + stats.appsUpdated,
        items_skipped: stats.appsSkipped,
        items_failed: stats.appsFailed,
        items_created: stats.appsCreated,
        items_updated: stats.appsUpdated,
        metadata: stoppedEarly ? { gracefulShutdown: true } : undefined,
      });
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiger Storefront sync completed', {
      ...stats,
      durationMinutes: duration,
      gracefulShutdown: stoppedEarly,
    });

    return stats;
  } catch (error) {
    clearTimeout(timeoutId);
    log.error('Tiger Storefront sync failed', { error });

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_processed: stats.appsProcessed,
        items_succeeded: stats.appsCreated + stats.appsUpdated,
        items_skipped: stats.appsSkipped,
        items_failed: stats.appsFailed,
        items_created: stats.appsCreated,
        items_updated: stats.appsUpdated,
      });
    }

    throw error;
  }
}

export async function runLegacySupabaseStorefrontSync(
  options: StorefrontSyncOptions = {}
): Promise<SyncStats> {
  const env = options.env ?? process.env;
  const config = readRunConfig(env);
  const supabase = options.getSupabase?.() ?? getServiceClient();
  const fetchDetails = options.fetchStorefrontAppDetails ?? fetchStorefrontAppDetails;
  const startTime = Date.now();
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

  log.info('Starting legacy Supabase Storefront sync', {
    githubRunId: config.githubRunId,
    batchSize: config.batchSize,
    ...(config.isPartitioned && {
      partitionCount: config.partitionCount,
      partitionId: config.partitionId,
    }),
  });

  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'storefront',
      github_run_id: config.githubRunId,
      status: 'running',
      batch_size: config.batchSize,
    })
    .select()
    .single();

  if (jobError) {
    log.error('Failed to create sync job record', { error: jobError });
  }

  const stats: SyncStats = {
    appsProcessed: 0,
    appsCreated: 0,
    appsUpdated: 0,
    appsSkipped: 0,
    appsFailed: 0,
  };

  try {
    const { data: appsToSync, error: fetchError } = config.isPartitioned
      ? await supabase.rpc('get_apps_for_sync_partitioned', {
          p_source: 'storefront',
          p_limit: config.batchSize,
          p_partition_count: config.partitionCount,
          p_partition_id: config.partitionId,
        })
      : await supabase.rpc('get_apps_for_sync', {
          p_source: 'storefront',
          p_limit: config.batchSize,
        });

    if (fetchError) {
      throw new Error(`Failed to get apps for sync: ${fetchError.message}`);
    }

    if (!appsToSync || appsToSync.length === 0) {
      log.info('No apps due for storefront sync');

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
            items_created: 0,
            items_updated: 0,
          })
          .eq('id', job.id);
      }
      return stats;
    }

    log.info('Found apps to sync', { count: appsToSync.length });

    const appIds = appsToSync.map((app) => app.appid);
    const { data: syncStatuses } = await supabase
      .from('sync_status')
      .select('appid, last_storefront_sync')
      .in('appid', appIds);

    const neverSyncedSet = new Set(
      (syncStatuses || [])
        .filter((status) => status.last_storefront_sync === null)
        .map((status) => status.appid)
    );

    log.info('First-time vs refresh breakdown', {
      firstTime: neverSyncedSet.size,
      refresh: appsToSync.length - neverSyncedSet.size,
    });

    const limit = pLimit(CONCURRENCY);
    const progressInterval = setInterval(() => {
      log.info('Sync progress', { ...stats, isShuttingDown });
    }, 10000);
    const pendingPromises: Promise<void>[] = [];
    let stoppedEarly = false;

    try {
      for (const { appid } of appsToSync) {
        if (isShuttingDown) {
          log.info('Graceful shutdown, stopping new app processing', {
            processed: stats.appsProcessed,
            remaining: appsToSync.length - stats.appsProcessed,
          });
          stoppedEarly = true;
          break;
        }
        pendingPromises.push(
          limit(() =>
            processLegacyStorefrontApp(appid, supabase, neverSyncedSet, stats, fetchDetails)
          )
        );
      }

      await Promise.all(pendingPromises);
    } finally {
      clearInterval(progressInterval);
    }

    clearTimeout(timeoutId);

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsCreated + stats.appsUpdated,
          items_skipped: stats.appsSkipped,
          items_failed: stats.appsFailed,
          items_created: stats.appsCreated,
          items_updated: stats.appsUpdated,
          metadata: stoppedEarly ? { gracefulShutdown: true } : undefined,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Legacy Supabase Storefront sync completed', {
      ...stats,
      durationMinutes: duration,
      gracefulShutdown: stoppedEarly,
    });

    return stats;
  } catch (error) {
    clearTimeout(timeoutId);
    log.error('Storefront sync failed', { error });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsCreated + stats.appsUpdated,
          items_skipped: stats.appsSkipped,
          items_failed: stats.appsFailed,
          items_created: stats.appsCreated,
          items_updated: stats.appsUpdated,
        })
        .eq('id', job.id);
    }

    throw error;
  }
}

export async function runStorefrontSync(
  options: StorefrontSyncOptions = {}
): Promise<SyncStats> {
  const env = options.env ?? process.env;
  return readDataWriteTarget(env) === 'tiger'
    ? runTigerStorefrontSync(options)
    : runLegacySupabaseStorefrontSync(options);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  runStorefrontSync().catch((error) => {
    log.error('Storefront sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
