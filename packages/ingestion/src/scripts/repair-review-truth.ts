import { randomUUID } from 'node:crypto';
import { getServiceClient } from '@publisheriq/database';
import {
  acquireApiRateToken,
  getReviewTruthRepairCandidates,
  type ReviewTruthRepairCandidate,
} from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { fetchReviewSummary } from '../apis/reviews.js';
import {
  loadPreviousReviewSyncData,
  persistReviewSummary,
  type PreviousReviewSyncData,
} from '../workers-support/reviews-persistence.js';

const log = logger.child({ worker: 'repair-review-truth' });

const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MIN_TOTAL_REVIEWS = 1000;

interface RepairStats {
  appsFailed: number;
  appsRepaired: number;
  appsSelected: number;
  rateTokenSleeps: number;
  tokenWaitMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function parseAppIds(raw: string | undefined): number[] | null {
  if (!raw) {
    return null;
  }

  const appids = raw
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  return appids.length > 0 ? Array.from(new Set(appids)) : null;
}

async function waitForReviewRateToken(workerId: string, stats: RepairStats): Promise<void> {
  while (true) {
    const result = await acquireApiRateToken({
      source: 'reviews',
      workerId,
    });

    if (result.granted) {
      return;
    }

    const waitMs = Math.max(1, result.waitMs || 1000);
    stats.rateTokenSleeps += 1;
    stats.tokenWaitMs += waitMs;
    await sleep(waitMs);
  }
}

async function refreshReviewDependentViews(): Promise<void> {
  const supabase = getServiceClient();
  const views = [
    'latest_daily_metrics',
    'publisher_metrics',
    'developer_metrics',
    'publisher_game_metrics',
    'developer_game_metrics',
    'monthly_game_metrics',
  ];

  for (const viewName of views) {
    log.info('Refreshing materialized view after review repair', { viewName });
    const { error } = await supabase.rpc('refresh_materialized_view', {
      view_name: viewName,
    });

    if (error) {
      throw new Error(`Failed to refresh ${viewName}: ${error.message}`);
    }
  }
}

async function repairCandidate(
  candidate: ReviewTruthRepairCandidate,
  supabase: ReturnType<typeof getServiceClient>,
  today: string,
  previousSyncData: Map<number, PreviousReviewSyncData>,
  stats: RepairStats,
  workerId: string
): Promise<void> {
  await waitForReviewRateToken(workerId, stats);

  const summary = await fetchReviewSummary(candidate.appid);
  if (!summary) {
    throw new Error('Steam did not return a reviews summary');
  }

  await persistReviewSummary({
    appid: candidate.appid,
    previous: previousSyncData.get(candidate.appid),
    summary,
    supabase,
    today,
  });
}

async function main(): Promise<void> {
  const githubRunId = process.env.GITHUB_RUN_ID;
  const workerId = process.env.WORKER_ID || `repair-review-truth-${randomUUID()}`;
  const batchSize = Number.parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10);
  const minTotalReviews = Number.parseInt(
    process.env.MIN_TOTAL_REVIEWS || `${DEFAULT_MIN_TOTAL_REVIEWS}`,
    10
  );
  const concurrency = Number.parseInt(process.env.CONCURRENCY || `${DEFAULT_CONCURRENCY}`, 10);
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const explicitAppids = parseAppIds(process.env.APPIDS);
  const today = new Date().toISOString().split('T')[0];
  const supabase = getServiceClient();

  log.info('Starting review truth repair', {
    batchSize,
    concurrency,
    dryRun,
    explicitAppidsCount: explicitAppids?.length ?? 0,
    githubRunId,
    minTotalReviews,
    workerId,
  });

  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      batch_size: batchSize,
      github_run_id: githubRunId,
      job_type: 'review-truth-repair',
      status: 'running',
    })
    .select()
    .single();

  const stats: RepairStats = {
    appsFailed: 0,
    appsRepaired: 0,
    appsSelected: 0,
    rateTokenSleeps: 0,
    tokenWaitMs: 0,
  };

  try {
    const candidates = await getReviewTruthRepairCandidates({
      appids: explicitAppids ?? undefined,
      limit: batchSize,
      minTotalReviews,
    });

    stats.appsSelected = candidates.length;

    log.info('Selected review truth repair candidates', {
      candidates: candidates.slice(0, 20),
      selected: candidates.length,
    });

    if (dryRun || candidates.length === 0) {
      if (job) {
        await supabase
          .from('sync_jobs')
          .update({
            completed_at: new Date().toISOString(),
            items_failed: 0,
            items_processed: candidates.length,
            items_succeeded: 0,
            status: 'completed',
          })
          .eq('id', job.id);
      }
      return;
    }

    const { previousSyncData } = await loadPreviousReviewSyncData(
      supabase,
      candidates.map((candidate) => candidate.appid)
    );

    const limit = pLimit(Math.max(1, concurrency));
    await Promise.all(
      candidates.map((candidate) =>
        limit(async () => {
          try {
            await repairCandidate(candidate, supabase, today, previousSyncData, stats, workerId);
            stats.appsRepaired += 1;
          } catch (error) {
            stats.appsFailed += 1;
            log.error('Failed to repair review truth for app', {
              appid: candidate.appid,
              error: formatUnknownError(error),
            });
          }
        })
      )
    );

    if (stats.appsRepaired > 0) {
      await refreshReviewDependentViews();
    }

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          completed_at: new Date().toISOString(),
          items_failed: stats.appsFailed,
          items_processed: stats.appsSelected,
          items_succeeded: stats.appsRepaired,
          status: stats.appsFailed > 0 ? 'completed_with_errors' : 'completed',
        })
        .eq('id', job.id);
    }

    log.info('Review truth repair completed', {
      ...stats,
      tokenWaitSeconds: Number((stats.tokenWaitMs / 1000).toFixed(1)),
    });
  } catch (error) {
    log.error('Review truth repair failed', {
      error: formatUnknownError(error),
    });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          completed_at: new Date().toISOString(),
          error_message: formatUnknownError(error),
          status: 'failed',
        })
        .eq('id', job.id);
    }

    process.exitCode = 1;
  }
}

main();
