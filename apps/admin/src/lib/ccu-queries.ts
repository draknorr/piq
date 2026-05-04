import 'server-only';

/**
 * Shared CCU (Concurrent Users) data fetching utilities
 * Used across entity detail pages (apps, publishers, developers)
 *
 * NOTE: ccu_snapshots table is new in v2.2.
 * TypeScript types may not include it yet - we use type assertions where needed.
 */

import { runTigerQuery } from '@publisheriq/database';

// ============================================================================
// Types
// ============================================================================

export type TimeRange = '24h' | '7d' | '30d';

export interface CCUSparklineData {
  dataPoints: number[];
  trend: 'up' | 'down' | 'stable';
  growthPct: number | null;
  peakCCU: number | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Calculates growth percentage from sparkline data
 */
function calculateGrowthPct(dataPoints: number[]): number | null {
  if (dataPoints.length < 2) return null;

  const midpoint = Math.floor(dataPoints.length / 2);
  const firstHalf = dataPoints.slice(0, midpoint);
  const secondHalf = dataPoints.slice(midpoint);

  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  if (avgFirst === 0) return null;
  return Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
}

/**
 * Gets cutoff time and target points for a time range
 */
function getTimeRangeParams(timeRange: TimeRange): { cutoffTime: Date; targetPoints: number } {
  const cutoffTime = new Date();
  let targetPoints: number;

  if (timeRange === '24h') {
    cutoffTime.setHours(cutoffTime.getHours() - 24);
    targetPoints = 12;
  } else if (timeRange === '7d') {
    cutoffTime.setDate(cutoffTime.getDate() - 7);
    targetPoints = 14;
  } else {
    cutoffTime.setDate(cutoffTime.getDate() - 30);
    targetPoints = 15;
  }

  return { cutoffTime, targetPoints };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch CCU sparkline data for a single app
 */
export async function getCCUSparkline(
  appid: number,
  timeRange: TimeRange = '7d'
): Promise<CCUSparklineData> {
  const result = await getCCUSparklinesBatch([appid], timeRange);
  return result.get(appid) ?? {
    dataPoints: [],
    trend: 'stable',
    growthPct: null,
    peakCCU: null,
  };
}

/**
 * Fetch daily peak CCU data via the get_app_sparkline_data RPC.
 *
 * This is used by the game detail page to standardize sparklines with the /apps list.
 */
export async function getAppDailyPeakSparkline(
  appid: number,
  days: 7 | 30 = 7
): Promise<CCUSparklineData> {
  const result = await getCCUSparklinesBatch([appid], days === 7 ? '7d' : '30d');
  return result.get(appid) ?? {
    dataPoints: [],
    trend: 'stable',
    growthPct: null,
    peakCCU: null,
  };
}

interface CcuSnapshotRow {
  appid: number;
  snapshot_time: string;
  player_count: number;
}

function emptySparkline(): CCUSparklineData {
  return {
    dataPoints: [],
    trend: 'stable',
    growthPct: null,
    peakCCU: null,
  };
}

function uniqueFiniteAppIds(appIds: number[]): number[] {
  return [...new Set(appIds.filter(Number.isFinite))];
}

async function getCcuSnapshotRows(
  appIds: number[],
  cutoffTime: Date
): Promise<CcuSnapshotRow[]> {
  const uniqueAppIds = uniqueFiniteAppIds(appIds);
  if (uniqueAppIds.length === 0) return [];

  const { rows } = await runTigerQuery<CcuSnapshotRow>(
    `
      SELECT appid, snapshot_time, player_count
      FROM metrics.ccu_snapshots
      WHERE appid = ANY($1::int[])
        AND snapshot_time >= $2::timestamptz
      ORDER BY snapshot_time ASC
    `,
    [uniqueAppIds, cutoffTime.toISOString()]
  );

  return rows;
}

function aggregateSparklineRows(
  appIds: number[],
  rows: CcuSnapshotRow[],
  targetPoints: number
): Map<number, CCUSparklineData> {
  const result = new Map<number, CCUSparklineData>();

  if (rows.length === 0) {
    for (const appid of appIds) {
      result.set(appid, emptySparkline());
    }
    return result;
  }

  const byApp = new Map<number, { time: Date; ccu: number }[]>();
  const peakByApp = new Map<number, number>();

  for (const row of rows) {
    if (!byApp.has(row.appid)) byApp.set(row.appid, []);
    byApp.get(row.appid)!.push({
      time: new Date(row.snapshot_time),
      ccu: row.player_count,
    });

    const currentPeak = peakByApp.get(row.appid) ?? 0;
    if (row.player_count > currentPeak) {
      peakByApp.set(row.appid, row.player_count);
    }
  }

  for (const appid of appIds) {
    const points = byApp.get(appid) ?? [];
    const dataPoints = downsampleToPoints(points, targetPoints);
    result.set(appid, {
      dataPoints,
      trend: calculateTrend(dataPoints),
      growthPct: calculateGrowthPct(dataPoints),
      peakCCU: peakByApp.get(appid) ?? null,
    });
  }

  return result;
}

function aggregatePortfolioSparklineRows(
  rows: CcuSnapshotRow[],
  targetPoints: number
): CCUSparklineData {
  if (rows.length === 0) {
    return {
      dataPoints: [],
      trend: 'stable',
      growthPct: null,
      peakCCU: null,
    };
  }

  const byTimeBucket = new Map<string, number>();
  let overallPeak = 0;

  for (const row of rows) {
    const time = new Date(row.snapshot_time);
    time.setMinutes(0, 0, 0);
    const bucket = time.toISOString();

    byTimeBucket.set(bucket, (byTimeBucket.get(bucket) ?? 0) + row.player_count);
    if (row.player_count > overallPeak) {
      overallPeak = row.player_count;
    }
  }

  const sortedBuckets = Array.from(byTimeBucket.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, ccu]) => ({ time: new Date(time), ccu }));

  const dataPoints = downsampleToPoints(sortedBuckets, targetPoints);

  return {
    dataPoints,
    trend: calculateTrend(dataPoints),
    growthPct: calculateGrowthPct(dataPoints),
    peakCCU: overallPeak,
  };
}

/**
 * Batch fetch sparkline data for multiple apps
 */
export async function getCCUSparklinesBatch(
  appIds: number[],
  timeRange: TimeRange = '7d'
): Promise<Map<number, CCUSparklineData>> {
  const { cutoffTime, targetPoints } = getTimeRangeParams(timeRange);

  const result = new Map<number, CCUSparklineData>();

  // Return empty data for empty input
  if (appIds.length === 0) {
    return result;
  }

  const rows = await getCcuSnapshotRows(appIds, cutoffTime);
  return aggregateSparklineRows(appIds, rows, targetPoints);
}

/**
 * Fetch aggregated portfolio CCU sparkline for a publisher or developer
 * Aggregates CCU across all games in the portfolio
 */
export async function getPortfolioCCUSparkline(
  appIds: number[],
  timeRange: TimeRange = '7d'
): Promise<CCUSparklineData> {
  const { cutoffTime, targetPoints } = getTimeRangeParams(timeRange);

  // Return empty data for empty input
  if (appIds.length === 0) {
    return {
      dataPoints: [],
      trend: 'stable',
      growthPct: null,
      peakCCU: null,
    };
  }

  const rows = await getCcuSnapshotRows(appIds, cutoffTime);
  return aggregatePortfolioSparklineRows(rows, targetPoints);
}
