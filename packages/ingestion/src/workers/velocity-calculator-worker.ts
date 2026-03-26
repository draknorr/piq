/**
 * Velocity Calculator Worker
 *
 * Recalculates review velocity stats and updates sync_status tiers.
 * Refreshes the review_velocity_stats materialized view.
 *
 * Run with: pnpm --filter @publisheriq/ingestion calculate-velocity
 */

import { getServiceClient } from '@publisheriq/database';
import {
  refreshReviewVelocityStats,
  updateReviewVelocityTiers,
} from '@publisheriq/database/ingestion';
import { logger } from '@publisheriq/shared';

const log = logger.child({ worker: 'velocity-calc' });

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

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;

  log.info('Starting velocity calculation', { githubRunId });

  const supabase = getServiceClient();

  // Create sync job record
  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'velocity-calc',
      github_run_id: githubRunId,
      status: 'running',
      batch_size: 0,
    })
    .select()
    .single();

  try {
    // 1. Refresh the materialized view
    log.info('Refreshing review_velocity_stats materialized view');
    const refreshStartedAt = Date.now();
    await refreshReviewVelocityStats();
    const refreshDurationMs = Date.now() - refreshStartedAt;

    log.info('Materialized view refreshed successfully', { refreshDurationMs });

    // 2. Update sync_status with new velocity data
    log.info('Updating sync_status with velocity tiers');
    const tierUpdateStartedAt = Date.now();
    const updatedCount = await updateReviewVelocityTiers();
    const tierUpdateDurationMs = Date.now() - tierUpdateStartedAt;
    log.info('Velocity tiers updated', { updatedCount, tierUpdateDurationMs });

    // 3. Get tier distribution for logging
    const { data: tierStats } = await supabase
      .from('sync_status')
      .select('review_velocity_tier')
      .not('review_velocity_tier', 'is', null);

    const tierDistribution =
      tierStats?.reduce(
        (acc: Record<string, number>, row) => {
          const tier = row.review_velocity_tier || 'unknown';
          acc[tier] = (acc[tier] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ) ?? {};

    log.info('Velocity tier distribution', tierDistribution);

    // Update job as completed
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: updatedCount,
          items_succeeded: updatedCount,
          items_failed: 0,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info('Velocity calculation completed', {
      durationSeconds: duration,
      appsUpdated: updatedCount,
      tierDistribution,
    });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    log.error('Velocity calculation failed', { error: errorMessage });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq('id', job.id);
    }

    process.exit(1);
  }
}

main();
