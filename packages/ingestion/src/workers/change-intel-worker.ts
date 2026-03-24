/**
 * Change Intelligence Queue Worker
 *
 * Long-running worker intended for Railway. Drains storefront, news, and hero
 * asset queue items using the change-intelligence queue tables/RPCs.
 *
 * Run with: pnpm --filter @publisheriq/ingestion change-intel-worker
 */

import { randomUUID } from 'node:crypto';
import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchStorefrontAppDetails } from '../apis/storefront.js';
import {
  abandonStaleChangeIntelSyncJobs,
  claimCaptureQueue,
  completeCaptureQueueItems,
  createSyncJobRecord,
  refreshChangeActivityBurstsForApp,
  requeueStaleCaptureClaims,
  updateSyncJobRecord,
} from '../change-intel/repository.js';
import { upsertLatestStorefrontState } from '../change-intel/storefront-latest-state.js';
import {
  archiveHeroAssetsForApp,
  captureNewsForApp,
  captureStorefrontState,
  resolveNewsCaptureMode,
  seedStaleNewsCatchup,
} from '../workers-support/change-intel.js';

const log = logger.child({ worker: 'change-intel' });

type SupabaseClient = ReturnType<typeof getServiceClient>;

const DEFAULT_SOURCES = ['storefront', 'news', 'projection_refresh', 'hero_asset'] as const;

type QueueSource = (typeof DEFAULT_SOURCES)[number];

function normalizeTriggerCursor(triggerCursor: string | null): string | null {
  return triggerCursor && triggerCursor.length > 0 ? triggerCursor : null;
}

async function processStorefrontJob(supabase: SupabaseClient, appid: number, triggerCursor: string | null): Promise<void> {
  const result = await fetchStorefrontAppDetails(appid);

  if (result.status === 'no_data') {
    await (supabase as any).from('sync_status').upsert(
      {
        appid,
        storefront_accessible: false,
        last_storefront_sync: new Date().toISOString(),
      },
      { onConflict: 'appid' }
    );
    return;
  }

  if (result.status === 'error') {
    throw new Error(result.error);
  }

  await captureStorefrontState(supabase, appid, result.data, {
    triggerReason: 'capture_queue_storefront',
    triggerCursor,
  });
  await upsertLatestStorefrontState(supabase, appid, result.data);
}

async function processProjectionRefreshJob(supabase: SupabaseClient, appid: number): Promise<void> {
  await refreshChangeActivityBurstsForApp(supabase, appid);
}

async function processJob(
  supabase: SupabaseClient,
  source: QueueSource,
  appid: number,
  triggerCursor: string | null,
  triggerReason: string
): Promise<void> {
  switch (source) {
    case 'storefront':
      await processStorefrontJob(supabase, appid, triggerCursor);
      break;
    case 'news':
      await captureNewsForApp(supabase, appid, {
        mode: resolveNewsCaptureMode(triggerReason),
        triggerCursor,
      });
      break;
    case 'projection_refresh':
      await processProjectionRefreshJob(supabase, appid);
      break;
    case 'hero_asset':
      await archiveHeroAssetsForApp(supabase, appid);
      break;
    default:
      throw new Error(`Unsupported capture source: ${source}`);
  }
}

async function processClaimedJobs(
  supabase: SupabaseClient,
  source: QueueSource,
  workerId: string,
  claimLimit: number
): Promise<number> {
  const claimedJobs = await claimCaptureQueue(supabase, [source], claimLimit, workerId);
  if (claimedJobs.length === 0) {
    return 0;
  }

  const syncJobId = await createSyncJobRecord(supabase, `change-intel-${source}`, claimedJobs.length);

  const completedJobIds: string[] = [];
  let failedCount = 0;
  let batchErrorMessage: string | null = null;

  try {
    for (const claimedJob of claimedJobs) {
      try {
        await processJob(
          supabase,
          source,
          claimedJob.appid,
          normalizeTriggerCursor(claimedJob.triggerCursor),
          claimedJob.triggerReason
        );
        completedJobIds.push(claimedJob.id);
      } catch (error) {
        failedCount += 1;
        const failureStatus = claimedJob.attempts >= 5 ? 'dead_letter' : 'queued';
        await completeCaptureQueueItems(
          supabase,
          [claimedJob.id],
          failureStatus,
          error instanceof Error ? error.message : String(error)
        );
        log.error('Failed to process change-intel job', {
          source,
          appid: claimedJob.appid,
          id: claimedJob.id,
          attempts: claimedJob.attempts,
          error,
        });
      }
    }

    await completeCaptureQueueItems(supabase, completedJobIds, 'completed');
  } catch (error) {
    batchErrorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to finalize claimed change-intel batch', {
      workerId,
      source,
      batchSize: claimedJobs.length,
      error,
    });
  } finally {
    if (syncJobId) {
      await updateSyncJobRecord(supabase, syncJobId, {
        status: batchErrorMessage ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
        items_processed: claimedJobs.length,
        items_succeeded: completedJobIds.length,
        items_failed: failedCount,
        error_message: batchErrorMessage,
      });
    }
  }

  return claimedJobs.length;
}

async function main(): Promise<void> {
  const workerId = process.env.WORKER_ID || randomUUID();
  const claimLimit = parseInt(process.env.CLAIM_LIMIT || '25', 10);
  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
  const catchupSeedLimit = parseInt(process.env.NEWS_CATCHUP_SEED_LIMIT || '10', 10);
  const maxIdlePolls = parseInt(process.env.MAX_IDLE_POLLS || '0', 10);
  const staleClaimAfterMs = Math.max(0, parseInt(process.env.CLAIM_STALE_AFTER_MS || '1800000', 10));
  const staleSyncJobAfterMs = Math.max(
    3600000,
    parseInt(process.env.SYNC_JOB_STALE_AFTER_MS || `${Math.max(staleClaimAfterMs, 3600000)}`, 10)
  );
  const staleClaimSweepIntervalMs = Math.max(
    pollIntervalMs,
    parseInt(process.env.STALE_CLAIM_SWEEP_INTERVAL_MS || '60000', 10)
  );
  const sources = (process.env.QUEUE_SOURCES?.split(',').map((value) => value.trim()).filter(Boolean) ?? [
    ...DEFAULT_SOURCES,
  ]) as QueueSource[];
  const supabase = getServiceClient();
  let idlePolls = 0;
  let lastStaleClaimSweepAt = 0;

  log.info('Starting change-intel queue worker', {
    workerId,
    claimLimit,
    sources,
    pollIntervalMs,
    staleClaimAfterMs: staleClaimAfterMs > 0 ? staleClaimAfterMs : null,
    staleSyncJobAfterMs,
    staleClaimSweepIntervalMs: staleClaimAfterMs > 0 ? staleClaimSweepIntervalMs : null,
    maxIdlePolls: maxIdlePolls > 0 ? maxIdlePolls : null,
  });

  try {
    const abandoned = await abandonStaleChangeIntelSyncJobs(
      supabase,
      sources.map((source) => `change-intel-${source}`),
      new Date(Date.now() - staleSyncJobAfterMs).toISOString()
    );
    if (abandoned > 0) {
      log.warn('Marked stale change-intel sync jobs as failed', {
        workerId,
        abandoned,
        staleSyncJobAfterMs,
      });
    }
  } catch (error) {
    log.error('Failed to mark stale change-intel sync jobs', {
      workerId,
      error,
    });
  }

  while (true) {
    let processedAny = false;

    if (staleClaimAfterMs > 0 && Date.now() - lastStaleClaimSweepAt >= staleClaimSweepIntervalMs) {
      lastStaleClaimSweepAt = Date.now();
      try {
        const requeued = await requeueStaleCaptureClaims(
          supabase,
          [...sources],
          new Date(Date.now() - staleClaimAfterMs).toISOString(),
          claimLimit * 10
        );
        if (requeued > 0) {
          log.warn('Requeued stale change-intel claims', {
            workerId,
            sources,
            requeued,
            staleClaimAfterMs,
          });
        }
      } catch (error) {
        log.error('Failed to requeue stale change-intel claims', {
          workerId,
          sources,
          error,
        });
      }
    }

    for (const source of sources) {
      try {
        const claimed = await processClaimedJobs(supabase, source, workerId, claimLimit);
        processedAny = processedAny || claimed > 0;
      } catch (error) {
        log.error('Failed to process claimed change-intel jobs', {
          workerId,
          source,
          error,
        });
      }
    }

    if (!processedAny && sources.includes('news') && catchupSeedLimit > 0) {
      try {
        const seeded = await seedStaleNewsCatchup(supabase, catchupSeedLimit);
        processedAny = seeded > 0;
        if (seeded > 0) {
          log.info('Seeded stale news catch-up jobs', { seeded });
        }
      } catch (error) {
        log.error('Failed to seed stale news catch-up jobs', {
          workerId,
          error,
        });
      }
    }

    if (!processedAny) {
      idlePolls += 1;

      if (maxIdlePolls > 0 && idlePolls >= maxIdlePolls) {
        log.info('Exiting change-intel worker after idle poll limit', { idlePolls, maxIdlePolls, sources });
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    idlePolls = 0;
  }
}

main().catch((error) => {
  log.error('Change-intel worker failed', { error });
  process.exit(1);
});
