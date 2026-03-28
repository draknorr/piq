/**
 * Steam App List Sync Worker
 *
 * Fetches the full list of apps from Steam Web API and syncs new apps to database.
 *
 * Run with: pnpm --filter @publisheriq/ingestion applist-sync
 */

import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchSteamAppList } from '../apis/steam-web.js';
import { promoteReviewsSyncBatch } from '../workers-support/reviews-sync.js';

const log = logger.child({ worker: 'applist-sync' });
const STALE_APPLIST_JOB_THRESHOLD_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const runSeenAt = new Date().toISOString();

  log.info('Starting App List sync', { githubRunId });

  const supabase = getServiceClient();

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

  try {
    // Fetch full app list from Steam
    const apps = await fetchSteamAppList();
    log.info('Fetched app list', { count: apps.length });

    // Get existing app IDs for comparison (paginate to get ALL, not just 1000)
    const existingSet = new Set<number>();
    let lastAppId = 0;
    const pageSize = 1000;

    while (true) {
      const { data: existingIds, error: fetchError } = await supabase
        .from('apps')
        .select('appid')
        .gt('appid', lastAppId)
        .order('appid', { ascending: true })
        .limit(pageSize);

      if (fetchError) {
        log.error('Error fetching existing apps', { error: fetchError });
        break;
      }

      if (!existingIds || existingIds.length === 0) break;

      for (const app of existingIds) {
        existingSet.add(app.appid);
      }

      if (existingIds.length < pageSize) break;
      lastAppId = existingIds[existingIds.length - 1]?.appid ?? lastAppId;
    }

    log.info('Existing apps in database', { count: existingSet.size });

    // Batch upsert all apps (handles both new and existing)
    const batchSize = 500;
    for (let i = 0; i < apps.length; i += batchSize) {
      const batch = apps.slice(i, i + batchSize);

      // Track which are new before upserting
      const newInBatch = batch.filter((app) => !existingSet.has(app.appid));
      const existingInBatch = batch.length - newInBatch.length;

      const { error } = await supabase.from('apps').upsert(
        batch.map((app) => ({
          appid: app.appid,
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

        // Mark new apps in existingSet to avoid double-counting
        for (const app of newInBatch) {
          existingSet.add(app.appid);
        }

        // Also create sync_status entries for new apps
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
              newInBatch.map((app) => ({
                appid: app.appid,
                bucket: 'important_backfill',
                score: 25,
                reason: 'new_steam_app_discovered',
                until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
              }))
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
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('App List sync finished', {
      status: errors > 0 ? 'failed' : 'completed',
      totalApps: apps.length,
      newApps,
      updatedApps,
      errors,
      reviewPromotions,
      durationSeconds: duration,
      runSeenAt,
    });

    if (errors > 0) {
      process.exit(1);
    }
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

    process.exit(1);
  }
}

main();
