/**
 * Steam App List Sync Worker
 *
 * Fetches the full list of apps from Steam Web API and syncs new apps to database.
 *
 * Run with: pnpm --filter @publisheriq/ingestion applist-sync
 */

import { pathToFileURL } from 'node:url';
import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type CatalogScanStart,
  type TigerWriter,
} from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchSteamAppList, type SteamApp } from '../apis/steam-web.js';
import {
  assertCatalogShadowParity,
  buildCatalogBatchHash,
  buildCatalogInputHash,
  buildCatalogScanRunKey,
  normalizeCatalogObservationRows,
  readCatalogObservationMode,
} from '../catalog-observation.js';
import { refreshCcuQualityCacheSafely } from '../workers-support/ccu-quality-cache.js';
import { promoteReviewsSyncBatch } from '../workers-support/reviews-sync.js';

const log = logger.child({ worker: 'applist-sync' });
const STALE_APPLIST_JOB_THRESHOLD_MS = 60 * 60 * 1000;
const DEFAULT_EXISTING_PAGE_SIZE = 1000;
const DEFAULT_APPLIST_BATCH_SIZE = 500;

type SupabaseClient = ReturnType<typeof getServiceClient>;

export interface AppListSyncResult {
  errors: number;
  newApps: number;
  reviewPromotions: number;
  totalApps: number;
  updatedApps: number;
}

export interface AppListSyncDependencies {
  env?: NodeJS.ProcessEnv;
  fetchSteamAppList?: () => Promise<SteamApp[]>;
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

function limitAppsForSmoke(apps: SteamApp[], env: NodeJS.ProcessEnv): SteamApp[] {
  const maxApps = parsePositiveInteger(env.APPLIST_MAX_APPS, 0);
  return maxApps > 0 ? apps.slice(0, maxApps) : apps;
}

function buildReviewPromotions(apps: SteamApp[]): Array<{
  appid: number;
  bucket: 'important_backfill';
  reason: string;
  score: number;
  until: string;
}> {
  const until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  return apps.map((app) => ({
    appid: app.appid,
    bucket: 'important_backfill',
    score: 25,
    reason: 'new_steam_app_discovered',
    until,
  }));
}

async function loadExistingAppidsFromTiger(tiger: TigerWriter): Promise<Set<number>> {
  const existingSet = new Set<number>();
  let lastAppId = 0;

  while (true) {
    const existingIds = await tiger.catalog.listExistingAppids({
      afterAppid: lastAppId,
      limit: DEFAULT_EXISTING_PAGE_SIZE,
    });

    if (existingIds.length === 0) {
      break;
    }

    for (const appid of existingIds) {
      existingSet.add(appid);
    }

    if (existingIds.length < DEFAULT_EXISTING_PAGE_SIZE) {
      break;
    }
    lastAppId = existingIds[existingIds.length - 1] ?? lastAppId;
  }

  return existingSet;
}

async function loadExistingAppidsFromSupabase(supabase: SupabaseClient): Promise<Set<number>> {
  const existingSet = new Set<number>();
  let lastAppId = 0;

  while (true) {
    const { data: existingIds, error: fetchError } = await supabase
      .from('apps')
      .select('appid')
      .gt('appid', lastAppId)
      .order('appid', { ascending: true })
      .limit(DEFAULT_EXISTING_PAGE_SIZE);

    if (fetchError) {
      log.error('Error fetching existing apps', { error: fetchError });
      break;
    }

    if (!existingIds || existingIds.length === 0) {
      break;
    }

    for (const app of existingIds) {
      existingSet.add(app.appid);
    }

    if (existingIds.length < DEFAULT_EXISTING_PAGE_SIZE) {
      break;
    }
    lastAppId = existingIds[existingIds.length - 1]?.appid ?? lastAppId;
  }

  return existingSet;
}

export async function runTigerAppListSync(
  dependencies: AppListSyncDependencies = {}
): Promise<AppListSyncResult> {
  const env = dependencies.env ?? process.env;
  const fetchApps = dependencies.fetchSteamAppList ?? fetchSteamAppList;
  const tiger = dependencies.getTiger?.() ?? getTigerWriter(env);
  const startTime = Date.now();
  const githubRunId = env.GITHUB_RUN_ID;
  const runSeenAt = new Date().toISOString();
  const batchSize = parsePositiveInteger(env.APPLIST_BATCH_SIZE, DEFAULT_APPLIST_BATCH_SIZE);
  const catalogObservationMode = readCatalogObservationMode(env);

  log.info('Starting Tiger App List sync', {
    githubRunId,
    batchSize,
    catalogObservationMode,
  });

  const staleBefore = new Date(Date.now() - STALE_APPLIST_JOB_THRESHOLD_MS).toISOString();
  const abandonedCount = await tiger.ops.abandonStaleSyncJobs({
    errorMessage: 'abandoned_as_stale_by_new_applist_run',
    jobTypes: ['applist'],
    startedBeforeIso: staleBefore,
  });

  if (abandonedCount > 0) {
    log.warn('Abandoned stale applist jobs before starting new run', {
      abandonedCount,
      staleBefore,
    });
  }

  const jobId = await tiger.ops.createSyncJob({
    githubRunId,
    jobType: 'applist',
    startedAt: runSeenAt,
  });

  let newApps = 0;
  let updatedApps = 0;
  let errors = 0;
  let reviewPromotions = 0;
  let totalApps = 0;
  let catalogScan: CatalogScanStart | null = null;

  try {
    const fetchedApps = limitAppsForSmoke(await fetchApps(), env);
    const observation = normalizeCatalogObservationRows(fetchedApps, {
      requireHints: false,
    });
    const apps = observation.rows.map(({ appid, name }) => ({ appid, name }));
    totalApps = observation.sourceRowCount;
    log.info('Fetched app list', {
      accepted: apps.length,
      rejected: observation.rejections.length,
      sourceRows: totalApps,
    });

    const existingSet = await loadExistingAppidsFromTiger(tiger);
    log.info('Existing apps in Tiger', { count: existingSet.size });

    if (catalogObservationMode !== 'off') {
      catalogScan = await tiger.catalogObservation.beginScan({
        forceFull: true,
        mode: catalogObservationMode,
        runKey: buildCatalogScanRunKey('steam_applist', env),
        source: 'steam_applist',
        sourceStartedAt: runSeenAt,
      });
    }

    const expectedBatches =
      apps.length > 0 || observation.rejections.length > 0
        ? Math.max(1, Math.ceil(apps.length / batchSize))
        : 0;
    let durableUnknownRows = 0;

    for (let batchIndex = 0; batchIndex < expectedBatches; batchIndex += 1) {
      const i = batchIndex * batchSize;
      const batch = apps.slice(i, i + batchSize);
      const newInBatch = batch.filter((app) => !existingSet.has(app.appid));
      const rejections = batchIndex === 0 ? observation.rejections : [];
      let durableNewInBatch = newInBatch;

      if (catalogScan) {
        const isReplay = batchIndex <= catalogScan.lastCommittedBatch;
        const commitResult = await tiger.catalogObservation.commitBatch({
          batchHash: buildCatalogBatchHash(batch, rejections),
          batchIndex,
          rejections,
          rows: batch,
          scanId: catalogScan.id,
        });

        if (catalogObservationMode === 'shadow' && !isReplay) {
          assertCatalogShadowParity({
            actualChangedKnownAppids: commitResult.changedKnownAppids,
            actualUnknownAppids: commitResult.unknownAppids,
            expectedChangedKnownAppids: [],
            expectedUnknownAppids: newInBatch.map((app) => app.appid),
          });
        }

        const durableUnknownAppids = new Set(commitResult.unknownAppids);
        durableNewInBatch = batch.filter((app) => durableUnknownAppids.has(app.appid));
        durableUnknownRows += commitResult.unknownRows;
      }

      try {
        await tiger.catalog.upsertApps(
          batch.map((app) => ({
            appid: app.appid,
            name: app.name,
            last_seen_in_steam_applist_at: runSeenAt,
            ...(catalogScan ? {} : { catalog_seed_state: 'hydrated' }),
          }))
        );
      } catch (error) {
        log.error('Failed to upsert Tiger applist batch', {
          batchStart: i,
          error,
        });
        errors += batch.length;
        if (catalogScan) {
          throw error;
        }
        continue;
      }

      newApps += durableNewInBatch.length;
      updatedApps += batch.length - durableNewInBatch.length;
      for (const app of batch) {
        existingSet.add(app.appid);
      }

      if (durableNewInBatch.length > 0) {
        try {
          if (!catalogScan) {
            await tiger.syncStatus.upsertRows(
              durableNewInBatch.map((app) => ({
                appid: app.appid,
                priority_score: 0,
              }))
            );
          }
          reviewPromotions += await tiger.reviews.promoteReviewsSyncBatch(
            buildReviewPromotions(durableNewInBatch)
          );
        } catch (error) {
          log.warn('Failed to initialize Tiger sync status/review priority for new apps', {
            batchStart: i,
            newAppsInBatch: durableNewInBatch.length,
            error: error instanceof Error ? error.message : String(error),
          });
          errors += durableNewInBatch.length;
        }
      }

      if ((i + batchSize) % 10000 === 0) {
        log.info('Upsert progress', {
          processed: i + batchSize,
          newApps,
          updatedApps,
          errors,
        });
      }
    }

    if (catalogScan) {
      if (errors > 0) {
        throw new Error('Catalog observation cannot complete while AppList batches have errors');
      }

      await tiger.catalogObservation.completeScan({
        expectedBatches,
        expectedSourceRows: observation.sourceRowCount,
        inputHash: buildCatalogInputHash(observation),
        reconciliationOutcome: {
          accepted_rows: observation.rows.length,
          observer_unknown_rows: durableUnknownRows,
          rejected_rows: observation.rejections.length,
          status: 'matched',
        },
        scanId: catalogScan.id,
      });
    }

    const status = errors > 0 ? 'failed' : 'completed';
    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status,
        completed_at: new Date().toISOString(),
        items_processed: totalApps,
        items_succeeded: newApps + updatedApps,
        items_failed: errors,
        items_skipped: observation.rejections.length,
        items_created: newApps,
        items_updated: updatedApps,
        error_message: errors > 0 ? 'applist_batches_failed' : null,
      });
    }

    if (errors === 0) {
      try {
        await tiger.ops.refreshDashboardStats();
      } catch (error) {
        log.warn('Failed to refresh Tiger dashboard stats after applist sync', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('Tiger App List sync finished', {
      status,
      totalApps,
      newApps,
      updatedApps,
      errors,
      reviewPromotions,
      durationSeconds: duration,
      runSeenAt,
    });

    return { errors, newApps, reviewPromotions, totalApps, updatedApps };
  } catch (error) {
    log.error('Tiger App List sync failed', { error });

    if (catalogScan) {
      try {
        await tiger.catalogObservation.failScan(
          catalogScan.id,
          error instanceof Error ? error.message : String(error)
        );
      } catch (catalogFailureError) {
        log.error('Failed to mark Tiger catalog observation scan as failed', {
          catalogFailureError:
            catalogFailureError instanceof Error
              ? catalogFailureError.message
              : String(catalogFailureError),
          catalogScanId: catalogScan.id,
        });
      }
    }

    if (jobId) {
      await tiger.ops.updateSyncJob(jobId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        items_created: newApps,
        items_updated: updatedApps,
        items_failed: errors,
      });
    }

    throw error;
  }
}

export async function runLegacySupabaseAppListSync(
  dependencies: AppListSyncDependencies = {}
): Promise<AppListSyncResult> {
  const env = dependencies.env ?? process.env;
  const fetchApps = dependencies.fetchSteamAppList ?? fetchSteamAppList;
  const refreshCcuQualityCache =
    dependencies.refreshCcuQualityCache ?? refreshCcuQualityCacheSafely;
  const supabase = dependencies.getSupabase?.() ?? getServiceClient();
  const startTime = Date.now();
  const githubRunId = env.GITHUB_RUN_ID;
  const runSeenAt = new Date().toISOString();

  log.info('Starting legacy Supabase App List sync', { githubRunId });

  const staleBefore = new Date(Date.now() - STALE_APPLIST_JOB_THRESHOLD_MS).toISOString();
  const staleCompletedAt = new Date().toISOString();
  const { data: abandonedJobs, error: staleJobError } = await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      completed_at: staleCompletedAt,
      error_message: 'abandoned_as_stale_by_new_applist_run',
    })
    .eq('job_type', 'applist')
    .eq('status', 'running')
    .lt('started_at', staleBefore)
    .select('id');

  if (staleJobError) {
    log.warn('Failed to abandon stale applist jobs', { error: staleJobError });
  } else if ((abandonedJobs?.length ?? 0) > 0) {
    log.warn('Abandoned stale applist jobs before starting new run', {
      abandonedCount: abandonedJobs?.length ?? 0,
      staleBefore,
    });
  }

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'applist',
      github_run_id: githubRunId,
      status: 'running',
      started_at: runSeenAt,
    })
    .select()
    .single();

  let newApps = 0;
  let updatedApps = 0;
  let errors = 0;
  let reviewPromotions = 0;
  let totalApps = 0;

  try {
    const apps = limitAppsForSmoke(await fetchApps(), env);
    totalApps = apps.length;
    log.info('Fetched app list', { count: apps.length });

    const existingSet = await loadExistingAppidsFromSupabase(supabase);
    log.info('Existing apps in database', { count: existingSet.size });

    const batchSize = parsePositiveInteger(env.APPLIST_BATCH_SIZE, DEFAULT_APPLIST_BATCH_SIZE);
    for (let i = 0; i < apps.length; i += batchSize) {
      const batch = apps.slice(i, i + batchSize);
      const newInBatch = batch.filter((app) => !existingSet.has(app.appid));
      const existingInBatch = batch.length - newInBatch.length;

      const { error } = await supabase.from('apps').upsert(
        batch.map((app) => ({
          appid: app.appid,
          catalog_seed_state: 'hydrated',
          name: app.name,
          last_seen_in_steam_applist_at: runSeenAt,
        })),
        { onConflict: 'appid', ignoreDuplicates: false }
      );

      if (error) {
        log.error('Failed to upsert batch', { batchStart: i, error });
        errors += batch.length;
      } else {
        newApps += newInBatch.length;
        updatedApps += existingInBatch;

        for (const app of newInBatch) {
          existingSet.add(app.appid);
        }

        if (newInBatch.length > 0) {
          const { error: syncStatusError } = await supabase.from('sync_status').upsert(
            newInBatch.map((app) => ({
              appid: app.appid,
              priority_score: 0,
            })),
            { onConflict: 'appid' }
          );

          if (syncStatusError) {
            log.error('Failed to upsert sync_status for new applist apps', {
              batchStart: i,
              newAppsInBatch: newInBatch.length,
              error: syncStatusError,
            });
            errors += newInBatch.length;
            continue;
          }

          try {
            reviewPromotions += await promoteReviewsSyncBatch(
              supabase,
              buildReviewPromotions(newInBatch)
            );
          } catch (promotionError) {
            log.warn('Failed to promote new apps for reviews sync', {
              batchStart: i,
              newAppsInBatch: newInBatch.length,
              error:
                promotionError instanceof Error
                  ? promotionError.message
                  : String(promotionError),
            });
          }
        }
      }

      if ((i + batchSize) % 10000 === 0) {
        log.info('Upsert progress', { processed: i + batchSize, newApps, updatedApps, errors });
      }
    }

    const jobStatus = errors > 0 ? 'failed' : 'completed';
    const completedAt = new Date().toISOString();

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: jobStatus,
          completed_at: completedAt,
          items_processed: apps.length,
          items_succeeded: newApps + updatedApps,
          items_failed: errors,
          items_created: newApps,
          items_updated: updatedApps,
          error_message: errors > 0 ? 'applist_batches_failed' : null,
        })
        .eq('id', job.id);
    }

    if (errors === 0) {
      const { error: refreshDashboardError } = await supabase.rpc('refresh_dashboard_stats');
      if (refreshDashboardError) {
        log.warn('Failed to refresh dashboard stats after applist sync', {
          error: refreshDashboardError,
        });
      }

      await refreshCcuQualityCache('applist');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('Legacy Supabase App List sync finished', {
      status: errors > 0 ? 'failed' : 'completed',
      totalApps,
      newApps,
      updatedApps,
      errors,
      reviewPromotions,
      durationSeconds: duration,
      runSeenAt,
    });

    return { errors, newApps, reviewPromotions, totalApps, updatedApps };
  } catch (error) {
    log.error('App List sync failed', { error });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_created: newApps,
          items_updated: updatedApps,
          items_failed: errors,
        })
        .eq('id', job.id);
    }

    throw error;
  }
}

export async function runAppListSync(
  dependencies: AppListSyncDependencies = {}
): Promise<AppListSyncResult> {
  const env = dependencies.env ?? process.env;
  const target = readDataWriteTarget(env);
  const catalogObservationMode = readCatalogObservationMode(env);
  if (catalogObservationMode !== 'off' && target !== 'tiger') {
    throw new Error('Catalog observation requires Tiger to be the primary AppList writer');
  }

  return target === 'tiger'
    ? runTigerAppListSync(dependencies)
    : runLegacySupabaseAppListSync(dependencies);
}

async function main(): Promise<void> {
  const result = await runAppListSync();
  if (result.errors > 0) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error) => {
    log.error('App List sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
