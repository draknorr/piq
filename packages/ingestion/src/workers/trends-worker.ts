/**
 * Trends Calculation Worker
 *
 * Calculates 30d and 90d review trends from histogram data.
 *
 * Run with: pnpm --filter @publisheriq/ingestion calculate-trends
 */

import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import { logger, BATCH_SIZES } from '@publisheriq/shared';

const log = logger.child({ worker: 'trends-sync' });
const APPID_PAGE_SIZE = 1000;

interface HistogramEntry {
  appid: number;
  month_start: string;
  recommendations_up: number;
  recommendations_down: number;
}

interface TrendResult {
  appid: number;
  trend_30d_direction: 'up' | 'down' | 'stable';
  trend_30d_change_pct: number;
  trend_90d_direction: 'up' | 'down' | 'stable';
  trend_90d_change_pct: number;
  current_positive_ratio: number;
  previous_positive_ratio: number;
  review_velocity_7d: number;
  review_velocity_30d: number;
}

type AppTrendRow = TrendResult & { updated_at: string };
type SupabaseClient = ReturnType<typeof getServiceClient>;
type TrendsDbClient = SupabaseClient | null;

async function updateSyncJob(
  jobId: string | null,
  supabase: TrendsDbClient,
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
    throw new Error('Supabase client is required for legacy trends sync job updates');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = [
      typeof record.message === 'string' ? record.message : null,
      typeof record.code === 'string' ? `code=${record.code}` : null,
      typeof record.details === 'string' ? `details=${record.details}` : null,
      typeof record.hint === 'string' ? `hint=${record.hint}` : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(' | ');
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

async function fetchHistogramAppidPage(
  supabase: SupabaseClient,
  lastAppid: number
): Promise<{ appids: number[]; nextCursor: number; hasMore: boolean; rowsFetched: number }> {
  const { data: appidRows, error: appidError } = await supabase
    .from('review_histogram')
    .select('appid')
    .gt('appid', lastAppid)
    .order('appid', { ascending: true })
    .limit(APPID_PAGE_SIZE);

  if (appidError) {
    throw new Error(
      `Failed to fetch appids from review_histogram: ${formatUnknownError(appidError)}`
    );
  }

  if (!appidRows || appidRows.length === 0) {
    return {
      appids: [],
      nextCursor: lastAppid,
      hasMore: false,
      rowsFetched: 0,
    };
  }

  const appids: number[] = [];
  let previousAppid = lastAppid;

  for (const row of appidRows) {
    if (row.appid !== previousAppid) {
      appids.push(row.appid);
      previousAppid = row.appid;
    }
  }

  const nextCursor = appidRows[appidRows.length - 1]?.appid ?? lastAppid;

  return {
    appids,
    nextCursor,
    hasMore: appidRows.length === APPID_PAGE_SIZE,
    rowsFetched: appidRows.length,
  };
}

function calculateTrendForApp(histogram: HistogramEntry[]): Omit<TrendResult, 'appid'> | null {
  if (histogram.length < 2) {
    return null;
  }

  // Sort by date descending (newest first)
  const sorted = [...histogram].sort(
    (a, b) => new Date(b.month_start).getTime() - new Date(a.month_start).getTime()
  );

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Split into periods
  const recent: HistogramEntry[] = [];
  const mid: HistogramEntry[] = [];
  const old: HistogramEntry[] = [];

  for (const entry of sorted) {
    const date = new Date(entry.month_start);
    if (date >= thirtyDaysAgo) {
      recent.push(entry);
    } else if (date >= ninetyDaysAgo) {
      mid.push(entry);
    } else if (old.length < 3) {
      old.push(entry);
    }
  }

  // Calculate 30-day trend
  const recentUp = recent.reduce((sum, e) => sum + e.recommendations_up, 0);
  const recentDown = recent.reduce((sum, e) => sum + e.recommendations_down, 0);
  const recentTotal = recentUp + recentDown;
  const currentPositiveRatio = recentTotal > 0 ? recentUp / recentTotal : 0;

  // Previous period for comparison (use mid period)
  const midUp = mid.reduce((sum, e) => sum + e.recommendations_up, 0);
  const midDown = mid.reduce((sum, e) => sum + e.recommendations_down, 0);
  const midTotal = midUp + midDown;
  const previousPositiveRatio = midTotal > 0 ? midUp / midTotal : 0;

  // Calculate 30d change
  let trend30dChangePct = 0;
  if (previousPositiveRatio > 0) {
    trend30dChangePct = ((currentPositiveRatio - previousPositiveRatio) / previousPositiveRatio) * 100;
  }

  // Determine 30d direction
  let trend30dDirection: 'up' | 'down' | 'stable' = 'stable';
  if (trend30dChangePct > 2) {
    trend30dDirection = 'up';
  } else if (trend30dChangePct < -2) {
    trend30dDirection = 'down';
  }

  // Calculate 90-day trend (compare recent+mid vs old)
  const recentMidUp = recentUp + midUp;
  const recentMidDown = recentDown + midDown;
  const recentMidTotal = recentMidUp + recentMidDown;
  const recentMidRatio = recentMidTotal > 0 ? recentMidUp / recentMidTotal : 0;

  const oldUp = old.reduce((sum, e) => sum + e.recommendations_up, 0);
  const oldDown = old.reduce((sum, e) => sum + e.recommendations_down, 0);
  const oldTotal = oldUp + oldDown;
  const oldRatio = oldTotal > 0 ? oldUp / oldTotal : 0;

  let trend90dChangePct = 0;
  if (oldRatio > 0) {
    trend90dChangePct = ((recentMidRatio - oldRatio) / oldRatio) * 100;
  }

  let trend90dDirection: 'up' | 'down' | 'stable' = 'stable';
  if (trend90dChangePct > 2) {
    trend90dDirection = 'up';
  } else if (trend90dChangePct < -2) {
    trend90dDirection = 'down';
  }

  // Calculate review velocity
  const reviewVelocity7d = recentTotal > 0 ? recentTotal / 7 : 0;
  const reviewVelocity30d = recentTotal > 0 ? recentTotal / 30 : 0;

  return {
    trend_30d_direction: trend30dDirection,
    trend_30d_change_pct: Math.round(trend30dChangePct * 100) / 100,
    trend_90d_direction: trend90dDirection,
    trend_90d_change_pct: Math.round(trend90dChangePct * 100) / 100,
    current_positive_ratio: Math.round(currentPositiveRatio * 10000) / 10000,
    previous_positive_ratio: Math.round(previousPositiveRatio * 10000) / 10000,
    review_velocity_7d: Math.round(reviewVelocity7d * 100) / 100,
    review_velocity_30d: Math.round(reviewVelocity30d * 100) / 100,
  };
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const env = process.env;
  const useTiger = readDataWriteTarget(env) === 'tiger';
  const tiger = useTiger ? getTigerWriter(env) : null;
  const githubRunId = env.GITHUB_RUN_ID;
  const batchSize = parseInt(env.BATCH_SIZE || String(BATCH_SIZES.TRENDS_BATCH), 10);

  log.info('Starting Trends calculation', { githubRunId, batchSize });

  const supabase: TrendsDbClient = tiger ? null : getServiceClient();
  const jobId = tiger
    ? await tiger.ops.createSyncJob({
        jobType: 'trends',
        githubRunId,
        batchSize,
      })
    : (await supabase!
        .from('sync_jobs')
        .insert({
          job_type: 'trends',
          github_run_id: githubRunId,
          status: 'running',
          batch_size: batchSize,
        })
        .select()
        .single()
      ).data?.id ?? null;

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    log.info('Fetching appids directly from review_histogram');

    let appidCursor = 0;
    let hasMoreAppids = true;
    let appidPagesFetched = 0;
    let appidRowsFetched = 0;
    let discoveredAppids = 0;
    const pendingAppids: number[] = [];
    let batchIndex = 0;

    while (hasMoreAppids || pendingAppids.length > 0) {
      while (hasMoreAppids && pendingAppids.length < batchSize) {
        const page = tiger
          ? await tiger.metrics.listReviewHistogramAppidPage(appidCursor, APPID_PAGE_SIZE)
          : await fetchHistogramAppidPage(supabase!, appidCursor);

        if (page.appids.length === 0) {
          hasMoreAppids = false;
          break;
        }

        pendingAppids.push(...page.appids);
        appidCursor = page.nextCursor;
        hasMoreAppids = page.hasMore;
        appidPagesFetched++;
        appidRowsFetched += page.rowsFetched;
        discoveredAppids += page.appids.length;

        log.info('Fetched histogram appid page', {
          pageIndex: appidPagesFetched,
          rowsFetched: page.rowsFetched,
          appidsDiscovered: page.appids.length,
          pendingAppids: pendingAppids.length,
          discoveredAppids,
          lastAppid: appidCursor,
        });
      }

      const batch = pendingAppids.splice(0, batchSize);

      if (batch.length === 0) {
        break;
      }

      batchIndex++;

      // Fetch histogram data for batch
      const histogramData = tiger
        ? await tiger.metrics.listReviewHistogramEntries(batch)
        : (await supabase!
            .from('review_histogram')
            .select('appid, month_start, recommendations_up, recommendations_down')
            .in('appid', batch)
            .order('month_start', { ascending: false })).data;

      if (!histogramData) continue;

      // Group by appid
      const byAppid = new Map<number, HistogramEntry[]>();
      for (const entry of histogramData) {
        if (!byAppid.has(entry.appid)) {
          byAppid.set(entry.appid, []);
        }
        byAppid.get(entry.appid)!.push(entry);
      }

      // Calculate trends for each app
      const trendsToUpsert: TrendResult[] = [];

      for (const [appid, histogram] of byAppid) {
        processed++;
        const trend = calculateTrendForApp(histogram);

        if (trend) {
          trendsToUpsert.push({
            appid,
            ...trend,
          });
          succeeded++;
        } else {
          failed++;
        }
      }

      // Upsert trends
      if (trendsToUpsert.length > 0) {
        const trendRows: AppTrendRow[] = trendsToUpsert.map((t) => ({
          ...t,
          updated_at: new Date().toISOString(),
        }));

        if (tiger) {
          await tiger.metrics.upsertAppTrends(trendRows);
        } else {
          const { error } = await supabase!.from('app_trends').upsert(
            trendRows,
            { onConflict: 'appid' }
          );

          if (error) {
            log.error('Failed to upsert trends', {
              error: formatUnknownError(error),
              batchIndex,
            });
          }
        }
      }

      log.info('Trends batch progress', {
        processed,
        succeeded,
        failed,
        batchIndex,
        batchSize: batch.length,
        pendingAppids: pendingAppids.length,
        discoveredAppids,
        appidPagesFetched,
        appidRowsFetched,
        lastAppid: appidCursor,
      });
    }

    if (discoveredAppids === 0) {
      log.info('No apps with histogram data');

      // Mark job as completed with 0 items
      await updateSyncJob(jobId, supabase, tiger, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: 0,
        items_succeeded: 0,
        items_failed: 0,
      });
      return;
    }

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: processed,
      items_succeeded: succeeded,
      items_failed: failed,
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Trends calculation completed', { processed, succeeded, failed, durationMinutes: duration });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    log.error('Trends calculation failed', { error: errorMessage });

    await updateSyncJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    });

    process.exit(1);
  }
}

main();
