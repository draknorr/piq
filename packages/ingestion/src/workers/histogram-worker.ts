/**
 * Review Histogram Sync Worker
 *
 * Fetches review histograms for trend analysis.
 *
 * Run with: pnpm --filter @publisheriq/ingestion histogram-sync
 */

import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type ReviewHistogramUpsert,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchReviewHistogram } from '../apis/reviews.js';

const log = logger.child({ worker: 'histogram-sync' });

// Process this many apps concurrently
// Rate limiter handles API throttling, this controls DB operation parallelism
const CONCURRENCY = 15;

interface SyncStats {
  processed: number;
  created: number;  // First-time enrichment
  updated: number;  // Refresh of existing data
  failed: number;
  skipped: number;  // Apps with no histogram data available
}

type SupabaseClient = ReturnType<typeof getServiceClient>;
type HistogramDbClient = SupabaseClient | null;

async function updateSyncJob(
  jobId: string | null,
  supabase: HistogramDbClient,
  tiger: TigerWriter | null,
  values: SyncJobUpdate
): Promise<void> {
  if (!jobId) {
    return;
  }

  if (tiger) {
    await tiger.ops.updateSyncJob(jobId, values);
    return;
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy histogram sync job updates');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

/**
 * Process a single app - fetch histogram and update database
 */
async function processApp(
  appid: number,
  supabase: HistogramDbClient,
  tiger: TigerWriter | null,
  neverSyncedSet: Set<number>,
  stats: SyncStats
): Promise<void> {
  // Increment processed count synchronously (before any await) to avoid race conditions
  stats.processed++;

  try {
    const histogram = await fetchReviewHistogram(appid);

    if (!histogram || histogram.length === 0) {
      stats.skipped++;

      // Still update sync timestamp so this app isn't re-queued immediately
      if (tiger) {
        await tiger.syncStatus.updateFields(appid, {
          last_histogram_sync: new Date().toISOString(),
        });
      } else if (supabase) {
        await supabase
          .from('sync_status')
          .update({ last_histogram_sync: new Date().toISOString() })
          .eq('appid', appid);
      }
      return;
    }

    // Batch insert all histogram entries in one call
    const histogramData: ReviewHistogramUpsert[] = histogram.map((entry) => ({
      appid,
      month_start: entry.monthStart.toISOString().split('T')[0],
      recommendations_up: entry.recommendationsUp,
      recommendations_down: entry.recommendationsDown,
    }));

    if (tiger) {
      await tiger.metrics.upsertReviewHistogram(histogramData);
    } else if (supabase) {
      await supabase
        .from('review_histogram')
        .upsert(histogramData, { onConflict: 'appid,month_start' });
    }

    // Update sync status
    if (tiger) {
      await tiger.syncStatus.updateFields(appid, {
        last_histogram_sync: new Date().toISOString(),
      });
    } else if (supabase) {
      await supabase
        .from('sync_status')
        .update({
          last_histogram_sync: new Date().toISOString(),
        })
        .eq('appid', appid);
    }

    // Track as first-time enrichment or refresh (synchronous to avoid race)
    if (neverSyncedSet.has(appid)) {
      stats.created++;
    } else {
      stats.updated++;
    }
  } catch (error) {
    log.error('Error processing app', { appid, error });
    stats.failed++;
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const env = process.env;
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? getTigerWriter(env) : null;
  const githubRunId = env.GITHUB_RUN_ID;
  const batchSize = parseInt(env.BATCH_SIZE || String(BATCH_SIZES.HISTOGRAM_BATCH), 10);

  log.info('Starting Histogram sync', { githubRunId, batchSize });

  const supabase: HistogramDbClient = tiger ? null : getServiceClient();
  const jobId = tiger
    ? await tiger.ops.createSyncJob({
        jobType: 'histogram',
        githubRunId,
        batchSize,
      })
    : (await supabase!
        .from('sync_jobs')
        .insert({
          job_type: 'histogram',
          github_run_id: githubRunId,
          status: 'running',
          batch_size: batchSize,
        })
        .select()
        .single()
      ).data?.id ?? null;

  const stats: SyncStats = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    // Get apps due for histogram sync
    const appsToSync = tiger
      ? await tiger.catalog.listAppsForSync({
          source: 'histogram',
          limit: batchSize,
        })
      : (await supabase!.rpc('get_apps_for_sync', {
          p_source: 'histogram',
          p_limit: batchSize,
        })).data ?? [];

    if (!appsToSync || appsToSync.length === 0) {
      log.info('No apps due for histogram sync');

      // Mark job as completed with 0 items
      await updateSyncJob(jobId, supabase, tiger, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: 0,
        items_succeeded: 0,
        items_failed: 0,
        items_created: 0,
        items_updated: 0,
      });
      return;
    }

    log.info('Found apps to sync', { count: appsToSync.length });

    // Fetch sync status to determine which are first-time vs refresh
    const appIds = appsToSync.map((a: { appid: number }) => a.appid);
    const syncStatuses = tiger
      ? await tiger.syncStatus.listHistogramStatuses(appIds)
      : (await supabase!
          .from('sync_status')
          .select('appid, last_histogram_sync')
          .in('appid', appIds)).data ?? [];

    // Build set of apps that have never been synced (first-time enrichment)
    const neverSyncedSet = new Set(
      (syncStatuses || [])
        .filter((s) =>
          'lastHistogramSync' in s ? s.lastHistogramSync === null : s.last_histogram_sync === null
        )
        .map((s) => s.appid)
    );

    log.info('First-time vs refresh breakdown', {
      firstTime: neverSyncedSet.size,
      refresh: appsToSync.length - neverSyncedSet.size,
    });

    // Process apps with controlled concurrency
    // Rate limiter handles API throttling, p-limit controls parallelism
    const limit = pLimit(CONCURRENCY);

    // Log progress every 10 seconds
    const progressInterval = setInterval(() => {
      log.info('Sync progress', { ...stats });
    }, 10000);

    try {
      await Promise.all(
        appsToSync.map(({ appid }: { appid: number }) =>
          limit(() => processApp(appid, supabase, tiger, neverSyncedSet, stats))
        )
      );
    } finally {
      clearInterval(progressInterval);
    }

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: stats.processed,
      items_succeeded: stats.created + stats.updated,
      items_failed: stats.failed,
      items_skipped: stats.skipped,
      items_created: stats.created,
      items_updated: stats.updated,
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Histogram sync completed', { ...stats, durationMinutes: duration });
  } catch (error) {
    log.error('Histogram sync failed', { error });

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
      items_processed: stats.processed,
      items_succeeded: stats.created + stats.updated,
      items_failed: stats.failed,
      items_skipped: stats.skipped,
      items_created: stats.created,
      items_updated: stats.updated,
    });

    process.exit(1);
  }
}

main();
