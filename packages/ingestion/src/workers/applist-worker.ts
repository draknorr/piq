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

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;

  log.info('Starting App List sync', { githubRunId });

  const supabase = getServiceClient();

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'applist',
      github_run_id: githubRunId,
      status: 'running',
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
    let from = 0;
    const pageSize = 10000;

    while (true) {
      const { data: existingIds, error: fetchError } = await supabase
        .from('apps')
        .select('appid')
        .range(from, from + pageSize - 1);

      if (fetchError) {
        log.error('Error fetching existing apps', { error: fetchError });
        break;
      }

      if (!existingIds || existingIds.length === 0) break;

      for (const app of existingIds) {
        existingSet.add(app.appid);
      }

      if (existingIds.length < pageSize) break;
      from += pageSize;
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
          await supabase.from('sync_status').upsert(
            newInBatch.map((app) => ({
              appid: app.appid,
              priority_score: 0,
            })),
            { onConflict: 'appid' }
          );

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

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: apps.length,
          items_succeeded: newApps + updatedApps,
          items_failed: errors,
          items_created: newApps,
          items_updated: updatedApps,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('App List sync completed', {
      totalApps: apps.length,
      newApps,
      updatedApps,
      errors,
      reviewPromotions,
      durationSeconds: duration,
    });
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
