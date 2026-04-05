/**
 * Storefront Details Sync Worker
 *
 * Fetches app details from Steam Storefront API for apps due for sync.
 * Prioritizes apps by priority_score.
 *
 * Run with: pnpm --filter @publisheriq/ingestion storefront-sync
 */

import { getServiceClient } from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchStorefrontAppDetails } from '../apis/storefront.js';
import { upsertLatestStorefrontState } from '../change-intel/storefront-latest-state.js';
import { captureStorefrontState } from '../workers-support/change-intel.js';

const log = logger.child({ worker: 'storefront-sync' });

// Graceful timeout: 38 minutes (7 min buffer before 45 min hard timeout)
const GRACEFUL_TIMEOUT_MS = 38 * 60 * 1000;

// Process this many apps concurrently
// Rate limiter handles API throttling, this controls DB operation parallelism
const CONCURRENCY = 8;

interface SyncStats {
  appsProcessed: number;
  appsCreated: number;  // First-time enrichment
  appsUpdated: number;  // Refresh of existing data
  appsSkipped: number;  // Steam returned no data (private/removed/age-gated)
  appsFailed: number;   // Actual API errors
}

type SupabaseClient = ReturnType<typeof getServiceClient>;

/**
 * Process a single app - fetch details and update database
 */
async function processApp(
  appid: number,
  supabase: SupabaseClient,
  neverSyncedSet: Set<number>,
  stats: SyncStats
): Promise<void> {
  // Increment processed count synchronously (before any await) to avoid race conditions
  stats.appsProcessed++;
  const observedAt = new Date().toISOString();

  try {
    const result = await fetchStorefrontAppDetails(appid);

    // Steam returned no data - app is private, removed, or age-gated.
    // If this was a relation-discovered stub, mark it inaccessible so it does
    // not look like a healthy catalog row while remaining traceable.
    if (result.status === 'no_data') {
      log.debug('No storefront data for app (private/removed)', { appid });
      stats.appsSkipped++;

      await (supabase as any)
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

    // Actual API error - keep as retryable
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

    // Success - we have data
    const details = result.data;

    await captureStorefrontState(supabase, appid, details, {
      triggerReason: 'storefront_safety_sweep',
      triggerCursor: null,
    });
    await upsertLatestStorefrontState(supabase, appid, details);

    // Track as first-time enrichment or refresh (synchronous to avoid race)
    if (neverSyncedSet.has(appid)) {
      stats.appsCreated++;
    } else {
      stats.appsUpdated++;
    }
    log.debug('Synced app', { appid, name: details.name, firstTime: neverSyncedSet.has(appid) });
  } catch (error) {
    log.error('Error processing app', { appid, error });
    stats.appsFailed++;

    // Update sync status with error
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

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const batchSize = parseInt(process.env.BATCH_SIZE || String(BATCH_SIZES.STOREFRONT_BATCH), 10);

  // Graceful shutdown flag
  let isShuttingDown = false;

  // Set up graceful timeout to save progress before GitHub Actions hard timeout
  const timeoutId = setTimeout(() => {
    log.info('Approaching timeout limit, initiating graceful shutdown', {
      elapsedMinutes: ((Date.now() - startTime) / 1000 / 60).toFixed(1),
    });
    isShuttingDown = true;
  }, GRACEFUL_TIMEOUT_MS);

  // Handle SIGTERM from GitHub Actions cancellation
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, initiating graceful shutdown');
    isShuttingDown = true;
  });

  // Partitioning support for parallel initial sync
  const partitionCount = parseInt(process.env.PARTITION_COUNT || '1', 10);
  const partitionId = parseInt(process.env.PARTITION_ID || '0', 10);
  const isPartitioned = partitionCount > 1;

  log.info('Starting Storefront sync', {
    githubRunId,
    batchSize,
    ...(isPartitioned && { partitionCount, partitionId }),
  });

  const supabase = getServiceClient();

  // Create sync job record
  const { data: job, error: jobError } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'storefront',
      github_run_id: githubRunId,
      status: 'running',
      batch_size: batchSize,
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
    // Get apps due for sync using the database function
    // Use partitioned function for parallel initial sync, regular function otherwise
    const { data: appsToSync, error: fetchError } = isPartitioned
      ? await supabase.rpc('get_apps_for_sync_partitioned', {
          p_source: 'storefront',
          p_limit: batchSize,
          p_partition_count: partitionCount,
          p_partition_id: partitionId,
        })
      : await supabase.rpc('get_apps_for_sync', {
          p_source: 'storefront',
          p_limit: batchSize,
        });

    if (fetchError) {
      throw new Error(`Failed to get apps for sync: ${fetchError.message}`);
    }

    if (!appsToSync || appsToSync.length === 0) {
      log.info('No apps due for storefront sync');

      clearTimeout(timeoutId);

      // Mark job as completed with 0 items
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
      return;
    }

    log.info('Found apps to sync', { count: appsToSync.length });

    // Fetch sync status to determine which are first-time vs refresh
    const appIds = appsToSync.map((a: { appid: number }) => a.appid);
    const { data: syncStatuses } = await supabase
      .from('sync_status')
      .select('appid, last_storefront_sync')
      .in('appid', appIds);

    // Build set of apps that have never been synced (first-time enrichment)
    const neverSyncedSet = new Set(
      (syncStatuses || [])
        .filter((s) => s.last_storefront_sync === null)
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
      log.info('Sync progress', { ...stats, isShuttingDown });
    }, 10000);

    // Track processing with early termination support
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
        pendingPromises.push(limit(() => processApp(appid, supabase, neverSyncedSet, stats)));
      }

      // Wait for all queued work to complete
      await Promise.all(pendingPromises);
    } finally {
      clearInterval(progressInterval);
    }

    // Clear the timeout since we're done
    clearTimeout(timeoutId);

    // Update sync job as completed
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
    log.info('Storefront sync completed', {
      ...stats,
      durationMinutes: duration,
      gracefulShutdown: stoppedEarly,
    });
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

    process.exit(1);
  }
}

main();
