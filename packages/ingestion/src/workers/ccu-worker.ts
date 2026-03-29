/**
 * CCU Sync Worker
 *
 * Fetches concurrent player counts directly from Steam's official API
 * (ISteamUserStats/GetNumberOfCurrentPlayers) for high-priority games.
 *
 * This provides EXACT player counts from Valve, unlike SteamSpy estimates.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-sync
 */

import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchSteamCCUBatchWithStatus } from '../apis/steam-ccu.js';
import { getSuspiciousZeroAppids } from '../workers-support/ccu-guardrails.js';
import { persistOfficialCcuValidationResults } from '../workers-support/ccu-validation.js';

const log = logger.child({ worker: 'ccu-sync' });

// Default: fetch CCU for top 1000 games by review count
const DEFAULT_CCU_LIMIT = 1000;

interface SyncStats {
  appsProcessed: number;
  appsSucceeded: number;
  appsFailed: number;
}

/**
 * Get candidate apps for CCU sync
 * Prioritizes games by total_reviews as a proxy for popularity/importance
 */
async function getCCUCandidates(
  supabase: ReturnType<typeof getServiceClient>,
  limit: number
): Promise<number[]> {
  // Get top games by review count (proxy for popularity)
  // Filter to released, non-delisted games only
  const { data, error } = await supabase
    .from('apps')
    .select('appid')
    .eq('type', 'game')
    .eq('is_released', true)
    .eq('is_delisted', false)
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get CCU candidates: ${error.message}`);
  }

  return data?.map((app) => app.appid) ?? [];
}

/**
 * Upsert CCU data to daily_metrics
 * Uses MAX to keep the highest CCU of the day if multiple syncs occur
 */
async function upsertCCUData(
  supabase: ReturnType<typeof getServiceClient>,
  ccuData: Map<number, number>,
  today: string
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  // Process in batches of 100 for reasonable transaction size
  const entries = Array.from(ccuData.entries());
  const batchSize = 100;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    // Build upsert data - we want to keep the MAX ccu_peak for the day
    // Supabase doesn't support conditional upserts, so we do a two-step approach:
    // 1. Fetch existing records for today
    // 2. Only upsert if new CCU is higher or record doesn't exist

    const appids = batch.map(([appid]) => appid);

    // Get existing CCU values for today
    const { data: existing } = await supabase
      .from('daily_metrics')
      .select('appid, ccu_peak')
      .in('appid', appids)
      .eq('metric_date', today);

    const existingMap = new Map(existing?.map((e) => [e.appid, e.ccu_peak ?? 0]) ?? []);

    // Filter to only include records where new CCU is higher or doesn't exist
    const toUpsert = batch
      .filter(([appid, newCCU]) => {
        const existingCCU = existingMap.get(appid) ?? 0;
        return newCCU >= existingCCU; // Include if new is higher or equal
      })
      .map(([appid, ccu]) => ({
        appid,
        metric_date: today,
        ccu_peak: ccu,
        ccu_source: 'steam_api' as const,
      }));

    if (toUpsert.length === 0) {
      succeeded += batch.length;
      continue;
    }

    const { error } = await supabase.from('daily_metrics').upsert(toUpsert, {
      onConflict: 'appid,metric_date',
      // Note: ccu_source may not exist yet - the migration adds it
      ignoreDuplicates: false,
    });

    if (error) {
      log.error('Failed to upsert CCU batch', { error, batchStart: i });
      failed += batch.length;
    } else {
      succeeded += batch.length;
    }
  }

  return { succeeded, failed };
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const ccuLimit = parseInt(process.env.CCU_LIMIT || String(DEFAULT_CCU_LIMIT), 10);

  log.info('Starting CCU sync (Steam API)', { githubRunId, ccuLimit });

  const supabase = getServiceClient();

  // Create sync job record
  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'ccu',
      github_run_id: githubRunId,
      status: 'running',
      batch_size: ccuLimit,
    })
    .select()
    .single();

  const stats: SyncStats = {
    appsProcessed: 0,
    appsSucceeded: 0,
    appsFailed: 0,
  };

  try {
    // Get candidate apps
    const appids = await getCCUCandidates(supabase, ccuLimit);

    if (appids.length === 0) {
      log.info('No apps found for CCU sync');

      if (job) {
        await supabase
          .from('sync_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            items_processed: 0,
            items_succeeded: 0,
            items_failed: 0,
          })
          .eq('id', job.id);
      }
      return;
    }

    log.info('Found apps for CCU sync', { count: appids.length });

    // Fetch CCU from Steam API
    const suspiciousZeroAppids = await getSuspiciousZeroAppids(supabase, appids);
    const result = await fetchSteamCCUBatchWithStatus(appids, (processed, total) => {
      log.info('CCU fetch progress', { processed, total });
    }, undefined, { suspiciousZeroAppids });

    const validCcuData = new Map<number, number>();
    for (const [appid, ccuResult] of result.results) {
      if (ccuResult.status === 'valid' && ccuResult.playerCount !== undefined) {
        validCcuData.set(appid, ccuResult.playerCount);
      }
    }

    stats.appsProcessed = appids.length;

    // Upsert to daily_metrics
    const today = new Date().toISOString().split('T')[0];
    const { succeeded, failed } = await upsertCCUData(supabase, validCcuData, today);

    const skipUntil = new Date();
    skipUntil.setDate(skipUntil.getDate() + 30);
    await persistOfficialCcuValidationResults(
      supabase,
      result.results,
      new Date().toISOString(),
      skipUntil.toISOString()
    );

    stats.appsSucceeded = succeeded;
    stats.appsFailed = failed + result.invalidCount + result.errorCount;

    // Log some interesting stats
    const ccuValues = Array.from(validCcuData.values());
    if (ccuValues.length > 0) {
      const maxCCU = Math.max(...ccuValues);
      const avgCCU = Math.round(ccuValues.reduce((a, b) => a + b, 0) / ccuValues.length);
      const gamesWithPlayers = ccuValues.filter((c) => c > 0).length;

      log.info('CCU statistics', {
        gamesWithData: validCcuData.size,
        gamesWithPlayers,
        maxCCU,
        avgCCU,
        invalidAppids: result.invalidCount,
        erroredAppids: result.errorCount,
      });
    }

    // Update sync job
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsSucceeded,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('CCU sync completed', { ...stats, durationMinutes: duration });
  } catch (error) {
    log.error('CCU sync failed', { error });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.appsProcessed,
          items_succeeded: stats.appsSucceeded,
          items_failed: stats.appsFailed,
        })
        .eq('id', job.id);
    }

    process.exit(1);
  }
}

main();
