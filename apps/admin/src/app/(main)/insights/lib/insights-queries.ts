import 'server-only';

/**
 * Data fetching functions for the Insights dashboard
 * Uses Supabase client to query CCU data from ccu_snapshots and related tables
 *
 * NOTE: ccu_snapshots and ccu_tier_assignments tables are new in v2.2.
 * TypeScript types may not include them yet - we use type assertions where needed.
 * Run `pnpm --filter database generate` after applying migrations to fix types.
 */

import { getServiceSupabase } from "@/lib/supabase-service";
import { postToQueryApi } from "@/lib/query-api-client";
import { resolveProductReadTarget } from "@/lib/product-read-runtime";
import type {
  TimeRange,
  GameInsight,
  TimeRangeConfig,
  NewestSortMode,
} from "./insights-types";

export interface InsightsDashboardData {
  newestGames: GameInsight[];
  topGames: GameInsight[];
  trendingGames: GameInsight[];
}

interface TigerInsightsDashboardResponse extends InsightsDashboardData {
  provenance: {
    capturedAt: string;
    source: "tiger";
    tables: string[];
  };
  timeRange: TimeRange;
}

// Type for snapshot row (not yet in generated types)
interface CCUSnapshotRow {
  appid: number;
  player_count: number;
  snapshot_time: string;
  ccu_tier: number;
}

// Type for tier assignment row (not yet in generated types)
interface CCUTierAssignmentRow {
  appid: number;
  ccu_tier: number;
  tier_reason: string | null;
  release_rank: number | null;
  recent_peak_ccu: number | null;
}

// Type for latest daily metrics
interface LatestMetricsRow {
  appid: number;
  total_reviews: number | null;
  positive_reviews: number | null;
  price_cents: number | null;
  discount_percent: number | null;
  average_playtime_forever: number | null;
}

// Type for app trends
interface AppTrendsRow {
  appid: number;
  review_velocity_7d: number | null;
}

/**
 * Downsamples CCU data points to target count, preserving peaks
 */
function downsampleToPoints(
  points: { time: Date; ccu: number }[],
  targetCount: number
): number[] {
  if (points.length === 0) return [];
  if (points.length <= targetCount) return points.map(p => p.ccu);

  const step = points.length / targetCount;
  const result: number[] = [];

  for (let i = 0; i < targetCount; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.floor((i + 1) * step);
    const bucket = points.slice(startIdx, endIdx);
    // Take max CCU in each bucket (preserves peaks)
    const maxCcu = Math.max(...bucket.map(p => p.ccu));
    result.push(maxCcu);
  }

  return result;
}

/**
 * Calculates trend direction from sparkline data
 */
function calculateTrend(dataPoints: number[]): 'up' | 'down' | 'stable' {
  if (dataPoints.length < 2) return 'stable';

  const midpoint = Math.floor(dataPoints.length / 2);
  const firstHalf = dataPoints.slice(0, midpoint);
  const secondHalf = dataPoints.slice(midpoint);

  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  if (avgFirst === 0) return 'stable';
  const changePercent = ((avgSecond - avgFirst) / avgFirst) * 100;

  if (changePercent > 5) return 'up';
  if (changePercent < -5) return 'down';
  return 'stable';
}

/**
 * Batch fetch sparkline data for multiple apps
 */
async function getCCUSparklinesBatch(
  appIds: number[],
  timeRange: TimeRange
): Promise<Map<number, { dataPoints: number[]; trend: 'up' | 'down' | 'stable' }>> {
  const supabase = getServiceSupabase();

  // Calculate cutoff time
  const cutoffTime = new Date();
  if (timeRange === '24h') {
    cutoffTime.setHours(cutoffTime.getHours() - 24);
  } else if (timeRange === '7d') {
    cutoffTime.setDate(cutoffTime.getDate() - 7);
  } else {
    cutoffTime.setDate(cutoffTime.getDate() - 30);
  }

  // Target points: 12 for 24h, 14 for 7d, 15 for 30d
  const targetPoints = timeRange === '24h' ? 12 : timeRange === '7d' ? 14 : 15;

  // Fetch all snapshots for all apps in one query
  const { data } = await (supabase as any)
    .from('ccu_snapshots')
    .select('appid, snapshot_time, player_count')
    .in('appid', appIds)
    .gte('snapshot_time', cutoffTime.toISOString())
    .order('snapshot_time', { ascending: true }) as {
      data: { appid: number; snapshot_time: string; player_count: number }[] | null;
    };

  const result = new Map<number, { dataPoints: number[]; trend: 'up' | 'down' | 'stable' }>();

  if (!data) {
    // Return empty sparklines for all apps
    for (const appid of appIds) {
      result.set(appid, { dataPoints: [], trend: 'stable' });
    }
    return result;
  }

  // Group by appid
  const byApp = new Map<number, { time: Date; ccu: number }[]>();
  for (const row of data) {
    if (!byApp.has(row.appid)) byApp.set(row.appid, []);
    byApp.get(row.appid)!.push({
      time: new Date(row.snapshot_time),
      ccu: row.player_count,
    });
  }

  // Downsample each app's data
  for (const appid of appIds) {
    const points = byApp.get(appid) ?? [];
    const dataPoints = downsampleToPoints(points, targetPoints);
    const trend = calculateTrend(dataPoints);
    result.set(appid, { dataPoints, trend });
  }

  return result;
}

/**
 * Time range configurations
 */
export const TIME_RANGE_CONFIG: Record<TimeRange, TimeRangeConfig> = {
  '24h': {
    interval: '24 hours',
    priorInterval: '48 hours',
    granularity: 'hour',
    chartPoints: 24,
    label: '24 hours',
  },
  '7d': {
    interval: '7 days',
    priorInterval: '14 days',
    granularity: 'day',
    chartPoints: 7,
    label: '7 days',
  },
  '30d': {
    interval: '30 days',
    priorInterval: '60 days',
    granularity: 'day',
    chartPoints: 30,
    label: '30 days',
  },
};

export async function getInsightsDashboardData(
  timeRange: TimeRange,
  newestSort: NewestSortMode,
): Promise<InsightsDashboardData> {
  if (resolveProductReadTarget("insights") === "legacy") {
    const [topGames, newestGames, trendingGames] = await Promise.all([
      getTopGames(timeRange),
      getNewestGames(timeRange, newestSort),
      getTrendingGames(timeRange),
    ]);
    return {
      newestGames,
      topGames,
      trendingGames,
    };
  }

  const result = await postToQueryApi<TigerInsightsDashboardResponse>(
    "/v1/contracts/get-insights-dashboard",
    {
      newestSort,
      timeRange,
    },
    { timeoutMs: 60_000 },
  );
  if (!result.ok || !result.data || result.data.provenance.source !== "tiger") {
    throw new Error(
      `Tiger Insights contract unavailable: ${result.errorCode ?? result.reason ?? "unknown error"}`,
    );
  }

  return {
    newestGames: result.data.newestGames,
    topGames: result.data.topGames,
    trendingGames: result.data.trendingGames,
  };
}

/**
 * Get top games by peak CCU in the given time range
 *
 * Data sources (in priority order):
 * 1. ccu_snapshots - Real-time hourly data for Tier 1+2 games
 * 2. ccu_tier_assignments.recent_peak_ccu - 7-day peak fallback (includes SteamSpy data)
 */
export async function getTopGames(timeRange: TimeRange): Promise<GameInsight[]> {
  const supabase = getServiceSupabase();

  // Calculate the cutoff time
  const cutoffTime = new Date();
  if (timeRange === '24h') {
    cutoffTime.setHours(cutoffTime.getHours() - 24);
  } else if (timeRange === '7d') {
    cutoffTime.setDate(cutoffTime.getDate() - 7);
  } else {
    cutoffTime.setDate(cutoffTime.getDate() - 30);
  }

  // Fetch both data sources in parallel for better performance
  const [snapshotResult, tierResult] = await Promise.all([
    // Primary: Get peak CCU from snapshots (Tier 1+2 games)
    (supabase as any)
      .from('ccu_snapshots')
      .select('appid, player_count')
      .gte('snapshot_time', cutoffTime.toISOString())
      .order('player_count', { ascending: false }) as Promise<{
        data: Pick<CCUSnapshotRow, 'appid' | 'player_count'>[] | null;
        error: Error | null;
      }>,

    // Fallback: Get recent_peak_ccu from tier assignments (includes SteamSpy data)
    (supabase as any)
      .from('ccu_tier_assignments')
      .select('appid, recent_peak_ccu')
      .gt('recent_peak_ccu', 0)
      .order('recent_peak_ccu', { ascending: false })
      .limit(500) as Promise<{
        data: { appid: number; recent_peak_ccu: number }[] | null;
        error: Error | null;
      }>,
  ]);

  const { data: snapshotData, error: snapshotError } = snapshotResult;
  const { data: tierData, error: tierError } = tierResult;

  if (snapshotError) {
    console.error('Snapshot query error:', snapshotError);
  }
  if (tierError) {
    console.error('Tier assignment query error:', tierError);
  }

  // Aggregate peak CCU per app from snapshots (primary source)
  const peakByApp = new Map<number, number>();
  if (snapshotData) {
    for (const row of snapshotData) {
      const current = peakByApp.get(row.appid) ?? 0;
      if (row.player_count > current) {
        peakByApp.set(row.appid, row.player_count);
      }
    }
  }

  // Add tier assignment data for games not in snapshots (fallback)
  // This covers games with SteamSpy CCU but no recent snapshot data
  if (tierData) {
    for (const row of tierData) {
      if (!peakByApp.has(row.appid) && row.recent_peak_ccu > 0) {
        peakByApp.set(row.appid, row.recent_peak_ccu);
      }
    }
  }

  // Sort and take top 50
  const topAppIds = Array.from(peakByApp.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([appid]) => appid);

  if (topAppIds.length === 0) return [];

  // Fetch all additional data in parallel
  const [appsResult, metricsResult, trendsResult, sparklineData] = await Promise.all([
    // App details (name, is_free)
    supabase
      .from('apps')
      .select('appid, name, release_date, is_free')
      .in('appid', topAppIds),

    // Latest metrics (reviews, price, playtime)
    (supabase
      .from('latest_daily_metrics')
      .select('appid, total_reviews, positive_reviews, price_cents, discount_percent, average_playtime_forever')
      .in('appid', topAppIds) as unknown) as Promise<{ data: LatestMetricsRow[] | null; error: Error | null }>,

    // Review velocity from app_trends
    (supabase
      .from('app_trends')
      .select('appid, review_velocity_7d')
      .in('appid', topAppIds) as unknown) as Promise<{ data: AppTrendsRow[] | null; error: Error | null }>,

    // Sparkline data
    getCCUSparklinesBatch(topAppIds, timeRange),
  ]);

  if (appsResult.error || !appsResult.data) {
    console.error('Apps query error:', appsResult.error);
    return [];
  }

  const appMap = new Map(appsResult.data.map(a => [a.appid, a]));
  const metricsMap = new Map(metricsResult.data?.map(m => [m.appid, m]) ?? []);
  const trendsMap = new Map(trendsResult.data?.map(t => [t.appid, t]) ?? []);

  // Build results
  return topAppIds.map(appid => {
    const app = appMap.get(appid);
    const metrics = metricsMap.get(appid);
    const trends = trendsMap.get(appid);
    const sparkline = sparklineData.get(appid);
    const peakCcu = peakByApp.get(appid) ?? 0;

    // Calculate positive percentage
    let positivePercent: number | undefined;
    if (metrics?.total_reviews && metrics.total_reviews > 0 && metrics.positive_reviews != null) {
      positivePercent = Math.round((metrics.positive_reviews / metrics.total_reviews) * 100);
    }

    // Convert playtime from minutes to hours
    const avgPlaytimeHours = metrics?.average_playtime_forever
      ? Math.round(metrics.average_playtime_forever / 60)
      : null;

    return {
      appid,
      name: app?.name ?? `App ${appid}`,
      releaseDate: app?.release_date ?? null,
      currentCcu: peakCcu,
      peakCcu,
      // Sparkline data
      ccuSparkline: sparkline?.dataPoints,
      ccuTrend: sparkline?.trend,
      // Review metrics
      totalReviews: metrics?.total_reviews ?? undefined,
      positivePercent,
      reviewVelocity: trends?.review_velocity_7d ?? undefined,
      // Price context
      priceCents: metrics?.price_cents,
      discountPercent: metrics?.discount_percent,
      isFree: app?.is_free ?? false,
      // Engagement
      avgPlaytimeHours,
    };
  });
}

/**
 * Get newest games (released in past year) with CCU data
 *
 * Data sources (in priority order):
 * 1. ccu_snapshots - Real-time hourly data for Tier 1+2 games
 * 2. ccu_tier_assignments.recent_peak_ccu - 7-day peak fallback (includes SteamSpy data)
 */
export async function getNewestGames(
  timeRange: TimeRange,
  sortBy: NewestSortMode = 'release'
): Promise<GameInsight[]> {
  const supabase = getServiceSupabase();

  // Get games released in the past year
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const { data: apps, error: appsError } = await supabase
    .from('apps')
    .select('appid, name, release_date, is_free')
    .eq('type', 'game')
    .eq('is_released', true)
    .gte('release_date', oneYearAgo.toISOString().split('T')[0])
    .order('release_date', { ascending: false })
    .limit(200); // Fetch more to filter after CCU check

  if (appsError || !apps || apps.length === 0) {
    console.error('Newest games query error:', appsError);
    return [];
  }

  const appIds = apps.map(a => a.appid);

  // Calculate cutoff time for CCU data
  const cutoffTime = new Date();
  if (timeRange === '24h') {
    cutoffTime.setHours(cutoffTime.getHours() - 24);
  } else if (timeRange === '7d') {
    cutoffTime.setDate(cutoffTime.getDate() - 7);
  } else {
    cutoffTime.setDate(cutoffTime.getDate() - 30);
  }

  // Fetch both CCU data sources in parallel
  const [snapshotResult, tierResult] = await Promise.all([
    // Primary: Get CCU data from snapshots (Tier 1+2 games)
    (supabase as any)
      .from('ccu_snapshots')
      .select('appid, player_count')
      .in('appid', appIds)
      .gte('snapshot_time', cutoffTime.toISOString()) as Promise<{
        data: Pick<CCUSnapshotRow, 'appid' | 'player_count'>[] | null;
      }>,

    // Fallback: Get recent_peak_ccu from tier assignments
    (supabase as any)
      .from('ccu_tier_assignments')
      .select('appid, recent_peak_ccu')
      .in('appid', appIds)
      .gt('recent_peak_ccu', 0) as Promise<{
        data: { appid: number; recent_peak_ccu: number }[] | null;
      }>,
  ]);

  const { data: snapshotData } = snapshotResult;
  const { data: tierData } = tierResult;

  // Aggregate peak CCU per app from snapshots (primary source)
  const peakByApp = new Map<number, number>();
  if (snapshotData) {
    for (const row of snapshotData) {
      const current = peakByApp.get(row.appid) ?? 0;
      if (row.player_count > current) {
        peakByApp.set(row.appid, row.player_count);
      }
    }
  }

  // Add tier assignment data for games not in snapshots (fallback)
  if (tierData) {
    for (const row of tierData) {
      if (!peakByApp.has(row.appid) && row.recent_peak_ccu > 0) {
        peakByApp.set(row.appid, row.recent_peak_ccu);
      }
    }
  }

  // Filter apps with CCU data and take top 50 by release date
  const appsWithCcu = apps.filter(a => (peakByApp.get(a.appid) ?? 0) > 0).slice(0, 50);
  const filteredAppIds = appsWithCcu.map(a => a.appid);

  if (filteredAppIds.length === 0) return [];

  // Fetch all additional data in parallel
  const [metricsResult, trendsResult, sparklineData] = await Promise.all([
    // Latest metrics (reviews, price, playtime)
    (supabase
      .from('latest_daily_metrics')
      .select('appid, total_reviews, positive_reviews, price_cents, discount_percent, average_playtime_forever')
      .in('appid', filteredAppIds) as unknown) as Promise<{ data: LatestMetricsRow[] | null; error: Error | null }>,

    // Review velocity from app_trends
    (supabase
      .from('app_trends')
      .select('appid, review_velocity_7d')
      .in('appid', filteredAppIds) as unknown) as Promise<{ data: AppTrendsRow[] | null; error: Error | null }>,

    // Sparkline data
    getCCUSparklinesBatch(filteredAppIds, timeRange),
  ]);

  const appMap = new Map(appsWithCcu.map(a => [a.appid, a]));
  const metricsMap = new Map(metricsResult.data?.map(m => [m.appid, m]) ?? []);
  const trendsMap = new Map(trendsResult.data?.map(t => [t.appid, t]) ?? []);

  // Build results
  const results = filteredAppIds.map(appid => {
    const app = appMap.get(appid);
    const metrics = metricsMap.get(appid);
    const trends = trendsMap.get(appid);
    const sparkline = sparklineData.get(appid);
    const peakCcu = peakByApp.get(appid) ?? 0;

    // Calculate positive percentage
    let positivePercent: number | undefined;
    if (metrics?.total_reviews && metrics.total_reviews > 0 && metrics.positive_reviews != null) {
      positivePercent = Math.round((metrics.positive_reviews / metrics.total_reviews) * 100);
    }

    // Convert playtime from minutes to hours
    const avgPlaytimeHours = metrics?.average_playtime_forever
      ? Math.round(metrics.average_playtime_forever / 60)
      : null;

    // Calculate growth % from sparkline for sorting by growth
    let growthPct: number | undefined;
    if (sparkline?.dataPoints && sparkline.dataPoints.length >= 2) {
      const midpoint = Math.floor(sparkline.dataPoints.length / 2);
      const firstHalf = sparkline.dataPoints.slice(0, midpoint);
      const secondHalf = sparkline.dataPoints.slice(midpoint);
      const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
      if (avgFirst > 0) {
        growthPct = Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
      }
    }

    return {
      appid,
      name: app?.name ?? `App ${appid}`,
      releaseDate: app?.release_date ?? null,
      currentCcu: peakCcu,
      peakCcu,
      growthPct,
      // Sparkline data
      ccuSparkline: sparkline?.dataPoints,
      ccuTrend: sparkline?.trend,
      // Review metrics
      totalReviews: metrics?.total_reviews ?? undefined,
      positivePercent,
      reviewVelocity: trends?.review_velocity_7d ?? undefined,
      // Price context
      priceCents: metrics?.price_cents,
      discountPercent: metrics?.discount_percent,
      isFree: app?.is_free ?? false,
      // Engagement
      avgPlaytimeHours,
    };
  });

  // Sort based on sortBy parameter
  if (sortBy === 'growth') {
    results.sort((a, b) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity));
  }
  // Default is already sorted by release date from initial query

  return results;
}

/**
 * Get trending games by CCU growth percentage
 */
export async function getTrendingGames(timeRange: TimeRange): Promise<GameInsight[]> {
  const supabase = getServiceSupabase();

  // Calculate time boundaries
  const now = new Date();
  const recentStart = new Date();
  const priorStart = new Date();
  const priorEnd = new Date();

  if (timeRange === '24h') {
    recentStart.setHours(now.getHours() - 24);
    priorStart.setHours(now.getHours() - 48);
    priorEnd.setHours(now.getHours() - 24);
  } else if (timeRange === '7d') {
    recentStart.setDate(now.getDate() - 7);
    priorStart.setDate(now.getDate() - 14);
    priorEnd.setDate(now.getDate() - 7);
  } else {
    recentStart.setDate(now.getDate() - 30);
    priorStart.setDate(now.getDate() - 60);
    priorEnd.setDate(now.getDate() - 30);
  }

  // Get recent period CCU (using type assertion for new table)
  const { data: recentData, error: recentError } = await (supabase as any)
    .from('ccu_snapshots')
    .select('appid, player_count')
    .gte('snapshot_time', recentStart.toISOString())
    .lte('snapshot_time', now.toISOString()) as {
      data: Pick<CCUSnapshotRow, 'appid' | 'player_count'>[] | null;
      error: Error | null;
    };

  if (recentError) {
    console.error('Recent CCU query error:', recentError);
    return [];
  }

  // Get prior period CCU (using type assertion for new table)
  const { data: priorData, error: priorError } = await (supabase as any)
    .from('ccu_snapshots')
    .select('appid, player_count')
    .gte('snapshot_time', priorStart.toISOString())
    .lte('snapshot_time', priorEnd.toISOString()) as {
      data: Pick<CCUSnapshotRow, 'appid' | 'player_count'>[] | null;
      error: Error | null;
    };

  if (priorError) {
    console.error('Prior CCU query error:', priorError);
    return [];
  }

  // Calculate average CCU for each period
  const recentAvg = new Map<number, { sum: number; count: number }>();
  const priorAvg = new Map<number, { sum: number; count: number }>();

  for (const row of recentData ?? []) {
    const existing = recentAvg.get(row.appid) ?? { sum: 0, count: 0 };
    existing.sum += row.player_count;
    existing.count += 1;
    recentAvg.set(row.appid, existing);
  }

  for (const row of priorData ?? []) {
    const existing = priorAvg.get(row.appid) ?? { sum: 0, count: 0 };
    existing.sum += row.player_count;
    existing.count += 1;
    priorAvg.set(row.appid, existing);
  }

  // Calculate growth for apps that have data in both periods
  const growthData: Array<{
    appid: number;
    recentAvg: number;
    priorAvg: number;
    growthPct: number;
  }> = [];

  for (const [appid, recent] of recentAvg) {
    const prior = priorAvg.get(appid);
    if (!prior) continue;

    const recentAvgValue = recent.sum / recent.count;
    const priorAvgValue = prior.sum / prior.count;

    // Filter out noise: require minimum 10 avg CCU in both periods
    if (recentAvgValue < 10 || priorAvgValue < 10) continue;

    const growthPct = ((recentAvgValue - priorAvgValue) / priorAvgValue) * 100;

    growthData.push({
      appid,
      recentAvg: Math.round(recentAvgValue),
      priorAvg: Math.round(priorAvgValue),
      growthPct: Math.round(growthPct * 10) / 10, // 1 decimal place
    });
  }

  // Sort by growth and take top 50 gainers
  growthData.sort((a, b) => b.growthPct - a.growthPct);
  const topGainers = growthData.slice(0, 50);

  if (topGainers.length === 0) return [];

  const appIds = topGainers.map(g => g.appid);

  // Fetch all additional data in parallel
  const [appsResult, metricsResult, trendsResult, sparklineData] = await Promise.all([
    // App details (name, is_free)
    supabase
      .from('apps')
      .select('appid, name, release_date, is_free')
      .in('appid', appIds),

    // Latest metrics (reviews, price, playtime)
    (supabase
      .from('latest_daily_metrics')
      .select('appid, total_reviews, positive_reviews, price_cents, discount_percent, average_playtime_forever')
      .in('appid', appIds) as unknown) as Promise<{ data: LatestMetricsRow[] | null; error: Error | null }>,

    // Review velocity from app_trends
    (supabase
      .from('app_trends')
      .select('appid, review_velocity_7d')
      .in('appid', appIds) as unknown) as Promise<{ data: AppTrendsRow[] | null; error: Error | null }>,

    // Sparkline data
    getCCUSparklinesBatch(appIds, timeRange),
  ]);

  const appMap = new Map(appsResult.data?.map(a => [a.appid, a]) ?? []);
  const metricsMap = new Map(metricsResult.data?.map(m => [m.appid, m]) ?? []);
  const trendsMap = new Map(trendsResult.data?.map(t => [t.appid, t]) ?? []);

  // Build results
  return topGainers.map(g => {
    const app = appMap.get(g.appid);
    const metrics = metricsMap.get(g.appid);
    const trends = trendsMap.get(g.appid);
    const sparkline = sparklineData.get(g.appid);

    // Calculate positive percentage
    let positivePercent: number | undefined;
    if (metrics?.total_reviews && metrics.total_reviews > 0 && metrics.positive_reviews != null) {
      positivePercent = Math.round((metrics.positive_reviews / metrics.total_reviews) * 100);
    }

    // Convert playtime from minutes to hours
    const avgPlaytimeHours = metrics?.average_playtime_forever
      ? Math.round(metrics.average_playtime_forever / 60)
      : null;

    return {
      appid: g.appid,
      name: app?.name ?? `App ${g.appid}`,
      releaseDate: app?.release_date ?? null,
      currentCcu: g.recentAvg,
      avgCcu: g.recentAvg,
      priorAvgCcu: g.priorAvg,
      growthPct: g.growthPct,
      // Sparkline data
      ccuSparkline: sparkline?.dataPoints,
      ccuTrend: sparkline?.trend,
      // Review metrics
      totalReviews: metrics?.total_reviews ?? undefined,
      positivePercent,
      reviewVelocity: trends?.review_velocity_7d ?? undefined,
      // Price context
      priceCents: metrics?.price_cents,
      discountPercent: metrics?.discount_percent,
      isFree: app?.is_free ?? false,
      // Engagement
      avgPlaytimeHours,
    };
  });
}

/**
 * Get summary stats for the insights header
 */
export async function getInsightsSummary(_timeRange: TimeRange): Promise<{
  totalGamesTracked: number;
  tier1Count: number;
  tier2Count: number;
  avgCcu: number;
}> {
  const supabase = getServiceSupabase();

  // Get tier stats (using type assertion for new table)
  const { data: tierData, count: totalGamesTracked } = await (supabase as any)
    .from('ccu_tier_assignments')
    .select('ccu_tier', { count: 'exact' }) as {
      data: Pick<CCUTierAssignmentRow, 'ccu_tier'>[] | null;
      count: number | null;
    };

  // Get recent CCU stats (using type assertion for new table)
  const { data: ccuData } = await (supabase as any)
    .from('ccu_snapshots')
    .select('player_count')
    .gte('snapshot_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(10000) as {
      data: Pick<CCUSnapshotRow, 'player_count'>[] | null;
    };

  // Count tiers
  let tier1Count = 0;
  let tier2Count = 0;

  if (tierData) {
    for (const row of tierData) {
      if (row.ccu_tier === 1) tier1Count++;
      else if (row.ccu_tier === 2) tier2Count++;
    }
  }

  // Calculate average CCU from recent snapshots
  let avgCcu = 0;
  if (ccuData && ccuData.length > 0) {
    const sum = ccuData.reduce((acc, row) => acc + row.player_count, 0);
    avgCcu = Math.round(sum / ccuData.length);
  }

  return {
    totalGamesTracked: totalGamesTracked ?? 0,
    tier1Count,
    tier2Count,
    avgCcu,
  };
}
