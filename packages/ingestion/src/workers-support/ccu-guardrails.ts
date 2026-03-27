import { getServiceClient } from '@publisheriq/database';

const TIER_ASSIGNMENT_STALE_HOURS = 24;
const SUSPICIOUS_ZERO_REVIEW_THRESHOLD = 1000;
const SUSPICIOUS_ZERO_RELEASE_WINDOW_DAYS = 180;
const RECENT_CCU_ACTIVITY_WINDOW_DAYS = 30;
const APPID_CHUNK_SIZE = 250;

type ServiceClient = ReturnType<typeof getServiceClient>;

function chunkAppids(appids: number[], chunkSize: number = APPID_CHUNK_SIZE): number[][] {
  const chunks: number[][] = [];

  for (let i = 0; i < appids.length; i += chunkSize) {
    chunks.push(appids.slice(i, i + chunkSize));
  }

  return chunks;
}

export async function isTierAssignmentsStale(
  supabase: ServiceClient,
  staleAfterHours: number = TIER_ASSIGNMENT_STALE_HOURS
): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('ccu_tier_assignments')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to inspect tier assignment freshness: ${error.message}`);
  }

  if (!data?.updated_at) {
    return true;
  }

  return data.updated_at < staleCutoff;
}

export async function getSuspiciousZeroAppids(
  supabase: ServiceClient,
  appids: number[]
): Promise<Set<number>> {
  const uniqueAppids = Array.from(new Set(appids));
  const suspicious = new Set<number>();

  if (uniqueAppids.length === 0) {
    return suspicious;
  }

  const recentReleaseCutoff = new Date();
  recentReleaseCutoff.setDate(recentReleaseCutoff.getDate() - SUSPICIOUS_ZERO_RELEASE_WINDOW_DAYS);

  const ccuWindowStart = new Date();
  ccuWindowStart.setDate(ccuWindowStart.getDate() - RECENT_CCU_ACTIVITY_WINDOW_DAYS);

  for (const appidChunk of chunkAppids(uniqueAppids)) {
    const [appsResult, latestMetricsResult, dailyMetricsResult, snapshotsResult] = await Promise.all([
      supabase
        .from('apps')
        .select('appid, release_date')
        .in('appid', appidChunk),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('latest_daily_metrics')
        .select('appid, total_reviews')
        .in('appid', appidChunk),
      supabase
        .from('daily_metrics')
        .select('appid')
        .in('appid', appidChunk)
        .gte('metric_date', ccuWindowStart.toISOString().slice(0, 10))
        .gt('ccu_peak', 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('ccu_snapshots')
        .select('appid')
        .in('appid', appidChunk)
        .gte('snapshot_time', ccuWindowStart.toISOString())
        .gt('player_count', 0),
    ]);

    if (appsResult.error) {
      throw new Error(`Failed to inspect app release dates for zero guard: ${appsResult.error.message}`);
    }
    if (latestMetricsResult.error) {
      throw new Error(`Failed to inspect latest metrics for zero guard: ${latestMetricsResult.error.message}`);
    }
    if (dailyMetricsResult.error) {
      throw new Error(`Failed to inspect recent daily metrics for zero guard: ${dailyMetricsResult.error.message}`);
    }
    if (snapshotsResult.error) {
      throw new Error(`Failed to inspect recent CCU snapshots for zero guard: ${snapshotsResult.error.message}`);
    }

    for (const row of appsResult.data ?? []) {
      if (row.release_date && row.release_date >= recentReleaseCutoff.toISOString().slice(0, 10)) {
        suspicious.add(row.appid);
      }
    }

    for (const row of latestMetricsResult.data ?? []) {
      if ((row.total_reviews ?? 0) >= SUSPICIOUS_ZERO_REVIEW_THRESHOLD) {
        suspicious.add(row.appid);
      }
    }

    for (const row of dailyMetricsResult.data ?? []) {
      suspicious.add(row.appid);
    }

    for (const row of snapshotsResult.data ?? []) {
      suspicious.add(row.appid);
    }
  }

  return suspicious;
}
