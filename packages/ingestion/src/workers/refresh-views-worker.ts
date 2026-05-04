/**
 * Materialized View Refresh Worker
 *
 * Refreshes the heavyweight materialized view chain in dependency order.
 * app_filter_data and filter-count views are refreshed on separate schedules.
 *
 * Run with: pnpm --filter @publisheriq/ingestion refresh-views
 */

import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type SyncJobUpdate,
  type TigerWriter,
} from '@publisheriq/database';
import { refreshMaterializedView } from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';

const log = logger.child({ worker: 'refresh-views' });

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;

type SupabaseClient = ReturnType<typeof getServiceClient>;
type RefreshDbClient = SupabaseClient | null;

const LEGACY_MATERIALIZED_VIEWS = [
  { name: 'latest_daily_metrics', timeoutMs: 600_000 },
  { name: 'publisher_metrics', timeoutMs: 600_000 },
  { name: 'developer_metrics', timeoutMs: 600_000 },
  { name: 'publisher_year_metrics', timeoutMs: 600_000 },
  { name: 'developer_year_metrics', timeoutMs: 600_000 },
  { name: 'publisher_game_metrics', timeoutMs: 600_000 },
  { name: 'developer_game_metrics', timeoutMs: 600_000 },
  { name: 'monthly_game_metrics', timeoutMs: 300_000 },
  { name: 'mv_apps_aggregate_stats', timeoutMs: 120_000 },
] as const;

const TIGER_MATERIALIZED_VIEWS = [
  { name: 'metrics.review_velocity_stats', timeoutMs: 600_000 },
  { name: 'metrics.apps_page_projection', timeoutMs: 900_000 },
  { name: 'metrics.apps_page_filter_counts', timeoutMs: 300_000 },
] as const;

async function createRefreshJob(
  githubRunId: string | undefined,
  supabase: RefreshDbClient,
  tiger: TigerWriter | null
): Promise<string | null> {
  if (tiger) {
    return tiger.ops.createSyncJob({
      jobType: 'refresh_views',
      githubRunId,
    });
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy refresh job tracking');
  }

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'refresh_views',
      github_run_id: githubRunId,
      status: 'running',
    })
    .select()
    .single();

  return job?.id ?? null;
}

async function updateRefreshJob(
  jobId: string | null,
  supabase: RefreshDbClient,
  tiger: TigerWriter | null,
  values: SyncJobUpdate
): Promise<void> {
  if (!jobId) return;

  if (tiger) {
    await tiger.ops.updateSyncJob(jobId, values);
    return;
  }

  if (!supabase) {
    throw new Error('Supabase client is required for legacy refresh job tracking');
  }

  await supabase.from('sync_jobs').update(values).eq('id', jobId);
}

async function refreshView(
  viewName: string,
  timeoutMs: number
): Promise<{ success: boolean; durationMs: number; error?: string }> {
  const startTime = Date.now();

  try {
    await refreshMaterializedView(viewName, {
      lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
      timeoutMs,
    });

    const durationMs = Date.now() - startTime;
    return { success: true, durationMs };
  } catch (rpcError) {
    const durationMs = Date.now() - startTime;
    let errorMessage: string;

    if (rpcError instanceof Error) {
      errorMessage = rpcError.message;
    } else if (typeof rpcError === 'object' && rpcError !== null) {
      errorMessage = JSON.stringify(rpcError);
    } else {
      errorMessage = String(rpcError);
    }

    return {
      success: false,
      durationMs,
      error: errorMessage,
    };
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const useTiger = readDataWriteTarget(process.env) === 'tiger';
  const materializedViews = useTiger ? TIGER_MATERIALIZED_VIEWS : LEGACY_MATERIALIZED_VIEWS;

  log.info('Starting materialized view refresh', { githubRunId, target: useTiger ? 'tiger' : 'supabase' });

  const tiger = useTiger ? getTigerWriter(process.env) : null;
  const supabase = useTiger ? null : getServiceClient();
  const jobId = await createRefreshJob(githubRunId, supabase, tiger);

  const results: Array<{ view: string; success: boolean; durationMs: number; error?: string }> = [];

  try {
    // Refresh each view in order
    for (const { name, timeoutMs } of materializedViews) {
      log.info('Refreshing view', {
        lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
        statementTimeoutMs: timeoutMs,
        view: name,
      });

      const result = await refreshView(name, timeoutMs);
      results.push({ view: name, ...result });

      if (result.success) {
        log.info('View refreshed', { view: name, durationMs: result.durationMs });
      } else {
        log.error('View refresh failed', { view: name, error: result.error });
        throw new Error(`Failed to refresh ${name}: ${result.error ?? 'unknown error'}`);
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    await updateRefreshJob(jobId, supabase, tiger, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_processed: results.length,
      items_succeeded: succeeded,
      items_failed: failed,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('Materialized view refresh completed', {
      durationSeconds: duration,
      succeeded,
      failed,
      results,
    });

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    log.error('Materialized view refresh failed', { error });

    await updateRefreshJob(jobId, supabase, tiger, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
    });

    process.exit(1);
  }
}

main();
