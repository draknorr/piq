/**
 * Queue projection refresh jobs for apps with recent grouped change activity.
 *
 * Run with:
 *   LOOKBACK_DAYS=180 pnpm --filter @publisheriq/ingestion change-intel-backfill-projection
 */
import { getServiceClient } from '@publisheriq/database';
import { enqueueCaptureJobs, listRecentChangeActivityAppIds } from '../change-intel/repository.js';

const LOOKBACK_DAYS = Math.max(1, parseInt(process.env.LOOKBACK_DAYS || '180', 10));
const PAGE_SIZE = Math.max(1, Math.min(parseInt(process.env.PAGE_SIZE || '1000', 10), 5000));
const MAX_APPS = Math.max(0, parseInt(process.env.MAX_APPS || '0', 10));
const PROJECTION_REFRESH_CURSOR = 'recent';

async function main(): Promise<void> {
  const supabase = getServiceClient();
  let afterAppid = 0;
  let processedApps = 0;
  let queuedJobs = 0;
  let page = 0;

  console.log(
    `Queueing change-activity projection backfill with LOOKBACK_DAYS=${LOOKBACK_DAYS}, PAGE_SIZE=${PAGE_SIZE}, MAX_APPS=${MAX_APPS || 'all'}`
  );

  while (true) {
    const appids = await listRecentChangeActivityAppIds(supabase, LOOKBACK_DAYS, afterAppid, PAGE_SIZE);
    if (appids.length === 0) {
      break;
    }

    const remaining = MAX_APPS > 0 ? Math.max(MAX_APPS - processedApps, 0) : appids.length;
    const batch = MAX_APPS > 0 ? appids.slice(0, remaining) : appids;
    if (batch.length === 0) {
      break;
    }

    const inserted = await enqueueCaptureJobs(
      supabase,
      batch.map((appid) => ({
        appid,
        source: 'projection_refresh' as const,
        triggerReason: 'projection_backfill',
        triggerCursor: PROJECTION_REFRESH_CURSOR,
        priority: 70,
      }))
    );

    page += 1;
    processedApps += batch.length;
    queuedJobs += inserted;
    afterAppid = batch[batch.length - 1] ?? afterAppid;

    console.log(
      `Page ${page}: scanned ${batch.length} apps, inserted ${inserted} queued projection_refresh jobs, last appid ${afterAppid}`
    );

    if (MAX_APPS > 0 && processedApps >= MAX_APPS) {
      break;
    }
  }

  console.log(
    `Projection backfill queueing complete. Consider running the change-intel worker with QUEUE_SOURCES=projection_refresh to drain the backlog. Processed ${processedApps} apps and inserted ${queuedJobs} jobs.`
  );
}

main().catch((error) => {
  console.error('Projection backfill failed:', error);
  process.exitCode = 1;
});
