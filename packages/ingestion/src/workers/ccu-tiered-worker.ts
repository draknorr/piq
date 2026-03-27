/**
 * Tiered CCU Sync Worker
 *
 * Fetches concurrent player counts from Steam's official API with tiered scheduling:
 * - Tier 1 (top 500 by CCU): Every hour
 * - Tier 2 (1000 newest releases): Every 2 hours (even hours only)
 *
 * Tier assignments are recalculated at hour 0 UTC each day.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-tiered-sync
 */

import { getServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { fetchSteamCCUBatch } from '../apis/steam-ccu.js';
import {
  getSuspiciousZeroAppids,
  isTierAssignmentsStale,
} from '../workers-support/ccu-guardrails.js';

const log = logger.child({ worker: 'ccu-tiered-sync' });

interface SyncStats {
  tier1Processed: number;
  tier2Processed: number;
  tier1Succeeded: number;
  tier2Succeeded: number;
  totalFailed: number;
  tierRecalculated: boolean;
}

interface TierAssignment {
  appid: number;
  ccu_tier: number;
}

/**
 * Recalculate tier assignments by calling the database function
 */
async function recalculateTiers(
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ tier1: number; tier2: number; tier3: number }> {
  log.info('Recalculating tier assignments...');

  const { data, error } = await supabase.rpc('recalculate_ccu_tiers');

  if (error) {
    throw new Error(`Failed to recalculate tiers: ${error.message}`);
  }

  // The function returns a single row with tier counts
  const result = Array.isArray(data) ? data[0] : data;

  log.info('Tier recalculation complete', {
    tier1: result.tier1_count,
    tier2: result.tier2_count,
    tier3: result.tier3_count,
  });

  return {
    tier1: result.tier1_count,
    tier2: result.tier2_count,
    tier3: result.tier3_count,
  };
}

/**
 * Get games for the specified tiers
 */
async function getTierGames(
  supabase: ReturnType<typeof getServiceClient>,
  tiers: number[]
): Promise<Map<number, number[]>> {
  const { data, error } = await supabase
    .from('ccu_tier_assignments')
    .select('appid, ccu_tier')
    .in('ccu_tier', tiers);

  if (error) {
    throw new Error(`Failed to get tier assignments: ${error.message}`);
  }

  const result = new Map<number, number[]>();
  for (const tier of tiers) {
    result.set(tier, []);
  }

  for (const assignment of data as TierAssignment[]) {
    const tierList = result.get(assignment.ccu_tier);
    if (tierList) {
      tierList.push(assignment.appid);
    }
  }

  return result;
}

/**
 * Insert CCU snapshots into the database
 */
async function insertSnapshots(
  supabase: ReturnType<typeof getServiceClient>,
  ccuData: Map<number, number>,
  tierMap: Map<number, number> // appid -> tier
): Promise<{ succeeded: number; failed: number }> {
  const snapshots = Array.from(ccuData.entries()).map(([appid, playerCount]) => ({
    appid,
    player_count: playerCount,
    ccu_tier: tierMap.get(appid) ?? 3,
  }));

  if (snapshots.length === 0) {
    return { succeeded: 0, failed: 0 };
  }

  // Insert in batches of 500
  const batchSize = 500;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < snapshots.length; i += batchSize) {
    const batch = snapshots.slice(i, i + batchSize);
    const { error } = await supabase.from('ccu_snapshots').insert(batch);

    if (error) {
      log.error('Failed to insert snapshot batch', { error, batchStart: i });
      failed += batch.length;
    } else {
      succeeded += batch.length;
    }
  }

  return { succeeded, failed };
}

/**
 * Update daily_metrics with peak CCU values
 * Ensures daily peaks are tracked for compatibility with existing system
 */
async function updateDailyMetricsPeak(
  supabase: ReturnType<typeof getServiceClient>,
  ccuData: Map<number, number>,
  today: string
): Promise<void> {
  const entries = Array.from(ccuData.entries());
  const batchSize = 100;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const appids = batch.map(([appid]) => appid);

    // Get existing values
    const { data: existing } = await supabase
      .from('daily_metrics')
      .select('appid, ccu_peak')
      .in('appid', appids)
      .eq('metric_date', today);

    const existingMap = new Map(existing?.map((e) => [e.appid, e.ccu_peak ?? 0]) ?? []);

    // Only upsert if new value is higher
    const toUpsert = batch
      .filter(([appid, newCCU]) => newCCU >= (existingMap.get(appid) ?? 0))
      .map(([appid, ccu]) => ({
        appid,
        metric_date: today,
        ccu_peak: ccu,
        ccu_source: 'steam_api' as const,
      }));

    if (toUpsert.length > 0) {
      await supabase.from('daily_metrics').upsert(toUpsert, {
        onConflict: 'appid,metric_date',
        ignoreDuplicates: false,
      });
    }
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const githubRunId = process.env.GITHUB_RUN_ID;
  const currentHour = new Date().getUTCHours();
  const isEvenHour = currentHour % 2 === 0;
  const supabase = getServiceClient();
  const tierAssignmentsStale = await isTierAssignmentsStale(supabase);
  const shouldRecalculateTiers = currentHour === 0 || tierAssignmentsStale;

  log.info('Starting tiered CCU sync', {
    githubRunId,
    currentHour,
    isEvenHour,
    shouldRecalculateTiers,
    tierAssignmentsStale,
  });

  // Create sync job record
  const { data: job } = await supabase
    .from('sync_jobs')
    .insert({
      job_type: 'ccu-tiered',
      github_run_id: githubRunId,
      status: 'running',
    })
    .select()
    .single();

  const stats: SyncStats = {
    tier1Processed: 0,
    tier2Processed: 0,
    tier1Succeeded: 0,
    tier2Succeeded: 0,
    totalFailed: 0,
    tierRecalculated: false,
  };

  try {
    // Recalculate tiers at midnight UTC
    if (shouldRecalculateTiers) {
      await recalculateTiers(supabase);
      stats.tierRecalculated = true;
    }

    // Determine which tiers to poll this hour
    const tiersToFetch = isEvenHour ? [1, 2] : [1];
    const tierGames = await getTierGames(supabase, tiersToFetch);

    const tier1Games = tierGames.get(1) ?? [];
    const tier2Games = tierGames.get(2) ?? [];

    // If no tier assignments exist yet, run initial calculation
    if (tier1Games.length === 0 && !stats.tierRecalculated) {
      log.info('No tier assignments found, running initial calculation...');
      await recalculateTiers(supabase);
      stats.tierRecalculated = true;

      // Re-fetch tier games
      const refreshedTiers = await getTierGames(supabase, tiersToFetch);
      tier1Games.push(...(refreshedTiers.get(1) ?? []));
      if (isEvenHour) {
        tier2Games.push(...(refreshedTiers.get(2) ?? []));
      }
    }

    stats.tier1Processed = tier1Games.length;
    stats.tier2Processed = isEvenHour ? tier2Games.length : 0;

    log.info('Fetching CCU for tiered games', {
      tier1Count: tier1Games.length,
      tier2Count: stats.tier2Processed,
      totalGames: tier1Games.length + stats.tier2Processed,
    });

    // Combine games to poll
    const gamesToPoll = [...tier1Games, ...(isEvenHour ? tier2Games : [])];

    if (gamesToPoll.length === 0) {
      log.info('No games to poll this hour');

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

    // Build tier lookup map
    const tierMap = new Map<number, number>();
    for (const appid of tier1Games) {
      tierMap.set(appid, 1);
    }
    for (const appid of tier2Games) {
      if (!tierMap.has(appid)) {
        tierMap.set(appid, 2);
      }
    }

    // Fetch CCU data from Steam API
    const suspiciousZeroAppids = await getSuspiciousZeroAppids(supabase, gamesToPoll);
    const result = await fetchSteamCCUBatch(gamesToPoll, (processed, total) => {
      if (processed % 500 === 0) {
        log.info('CCU fetch progress', { processed, total });
      }
    }, { suspiciousZeroAppids });

    // Insert snapshots
    const { failed: snapshotFailed } = await insertSnapshots(
      supabase,
      result.data,
      tierMap
    );

    // Calculate per-tier success
    for (const [appid] of result.data) {
      const tier = tierMap.get(appid);
      if (tier === 1) {
        stats.tier1Succeeded++;
      } else if (tier === 2) {
        stats.tier2Succeeded++;
      }
    }

    stats.totalFailed = result.failedCount + snapshotFailed;

    // Update daily_metrics with peaks
    const today = new Date().toISOString().split('T')[0];
    await updateDailyMetricsPeak(supabase, result.data, today);

    // Log statistics
    const ccuValues = Array.from(result.data.values());
    if (ccuValues.length > 0) {
      const maxCCU = Math.max(...ccuValues);
      const avgCCU = Math.round(ccuValues.reduce((a, b) => a + b, 0) / ccuValues.length);
      const gamesWithPlayers = ccuValues.filter((c) => c > 0).length;

      log.info('CCU statistics', {
        gamesWithData: result.data.size,
        gamesWithPlayers,
        maxCCU,
        avgCCU,
      });
    }

    // Update sync job
    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          items_processed: stats.tier1Processed + stats.tier2Processed,
          items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
          items_failed: stats.totalFailed,
        })
        .eq('id', job.id);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    log.info('Tiered CCU sync completed', { ...stats, durationMinutes: duration });
  } catch (error) {
    log.error('Tiered CCU sync failed', { error });

    if (job) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          items_processed: stats.tier1Processed + stats.tier2Processed,
          items_succeeded: stats.tier1Succeeded + stats.tier2Succeeded,
          items_failed: stats.totalFailed,
        })
        .eq('id', job.id);
    }

    process.exit(1);
  }
}

main();
