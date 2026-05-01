import {
  getServiceClient,
  getTigerWriter,
  readDataWriteTarget,
  type TigerWriter,
} from '@publisheriq/database';
import { logger } from '@publisheriq/shared';

const TIER_ASSIGNMENT_STALE_HOURS = 24;
const SUSPICIOUS_ZERO_REVIEW_THRESHOLD = 1000;
const SUSPICIOUS_ZERO_RELEASE_WINDOW_DAYS = 180;
const RECENT_CCU_ACTIVITY_WINDOW_DAYS = 30;
const APPID_CHUNK_SIZE = 250;
const SUSPICIOUS_ZERO_RPC = 'get_suspicious_zero_appids';

type ServiceClient = ReturnType<typeof getServiceClient>;
type QueryError = { message?: string } | null;
type QueryResponse<T> = { data: T[] | null; error: QueryError };
interface CcuGuardrailOptions {
  env?: NodeJS.ProcessEnv;
  tiger?: TigerWriter;
}

const log = logger.child({ component: 'ccu-guardrails' });

function chunkAppids(appids: number[], chunkSize: number = APPID_CHUNK_SIZE): number[][] {
  const chunks: number[][] = [];

  for (let i = 0; i < appids.length; i += chunkSize) {
    chunks.push(appids.slice(i, i + chunkSize));
  }

  return chunks;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function appendNumericAppids(target: Set<number>, appids: Iterable<unknown>): void {
  for (const appid of appids) {
    const parsedAppid = typeof appid === 'number' ? appid : Number(appid);
    if (Number.isInteger(parsedAppid)) {
      target.add(parsedAppid);
    }
  }
}

function readSettledRows<T>(
  source: string,
  result: PromiseSettledResult<QueryResponse<T>>,
  chunkSize: number
): T[] {
  if (result.status === 'rejected') {
    log.warn('Suspicious zero lookup query rejected; continuing without this source', {
      source,
      chunkSize,
      error: describeError(result.reason),
    });
    return [];
  }

  if (result.value.error) {
    log.warn('Suspicious zero lookup query failed; continuing without this source', {
      source,
      chunkSize,
      error: result.value.error.message ?? 'Unknown error',
    });
    return [];
  }

  return result.value.data ?? [];
}

function didSettledQueryDegrade<T>(result: PromiseSettledResult<QueryResponse<T>>): boolean {
  return result.status === 'rejected' || !!result.value.error;
}

async function getSuspiciousZeroAppidsViaRpc(
  supabase: ServiceClient,
  appids: number[]
): Promise<Set<number> | null> {
  const suspicious = new Set<number>();

  for (const appidChunk of chunkAppids(appids)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc(SUSPICIOUS_ZERO_RPC, {
        p_appids: appidChunk,
      });

      if (error) {
        log.warn('Suspicious zero RPC unavailable; falling back to chunked lookup', {
          appids: appids.length,
          chunkSize: appidChunk.length,
          error: error.message ?? 'Unknown error',
        });
        return null;
      }

      appendNumericAppids(suspicious, Array.isArray(data) ? data : []);
    } catch (error) {
      log.warn('Suspicious zero RPC threw; falling back to chunked lookup', {
        appids: appids.length,
        chunkSize: appidChunk.length,
        error: describeError(error),
      });
      return null;
    }
  }

  return suspicious;
}

async function getSuspiciousZeroAppidsViaFallback(
  supabase: ServiceClient,
  uniqueAppids: number[]
): Promise<Set<number>> {
  const suspicious = new Set<number>();
  const recentReleaseCutoff = new Date();
  recentReleaseCutoff.setDate(recentReleaseCutoff.getDate() - SUSPICIOUS_ZERO_RELEASE_WINDOW_DAYS);

  const ccuWindowStart = new Date();
  ccuWindowStart.setDate(ccuWindowStart.getDate() - RECENT_CCU_ACTIVITY_WINDOW_DAYS);

  let degradedChunks = 0;

  for (const appidChunk of chunkAppids(uniqueAppids)) {
    const [appsResult, latestMetricsResult, dailyMetricsResult, snapshotsResult] =
      await Promise.allSettled([
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

    const appsRows = readSettledRows<{ appid: number; release_date: string | null }>(
      'apps',
      appsResult,
      appidChunk.length
    );
    const latestMetricsRows = readSettledRows<{ appid: number; total_reviews: number | null }>(
      'latest_daily_metrics',
      latestMetricsResult,
      appidChunk.length
    );
    const dailyMetricsRows = readSettledRows<{ appid: number }>(
      'daily_metrics',
      dailyMetricsResult,
      appidChunk.length
    );
    const snapshotRows = readSettledRows<{ appid: number }>(
      'ccu_snapshots',
      snapshotsResult,
      appidChunk.length
    );

    const chunkDegraded = [
      appsResult,
      latestMetricsResult,
      dailyMetricsResult,
      snapshotsResult,
    ].some(didSettledQueryDegrade);

    if (chunkDegraded) {
      degradedChunks++;
    }

    for (const row of appsRows) {
      if (row.release_date && row.release_date >= recentReleaseCutoff.toISOString().slice(0, 10)) {
        suspicious.add(row.appid);
      }
    }

    for (const row of latestMetricsRows) {
      if ((row.total_reviews ?? 0) >= SUSPICIOUS_ZERO_REVIEW_THRESHOLD) {
        suspicious.add(row.appid);
      }
    }

    appendNumericAppids(
      suspicious,
      dailyMetricsRows.map((row) => row.appid)
    );
    appendNumericAppids(
      suspicious,
      snapshotRows.map((row) => row.appid)
    );
  }

  if (degradedChunks > 0) {
    log.warn('Suspicious zero lookup degraded; continuing with partial guardrail results', {
      appids: uniqueAppids.length,
      suspiciousCount: suspicious.size,
      degradedChunks,
      totalChunks: Math.ceil(uniqueAppids.length / APPID_CHUNK_SIZE),
    });
  }

  return suspicious;
}

export async function isTierAssignmentsStale(
  supabase: ServiceClient,
  staleAfterHours: number = TIER_ASSIGNMENT_STALE_HOURS,
  options: CcuGuardrailOptions = {}
): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();

  if (readDataWriteTarget(options.env) === 'tiger') {
    return (options.tiger ?? getTigerWriter(options.env)).metrics.isCcuTierAssignmentsStale(
      staleCutoff
    );
  }

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
  appids: number[],
  options: CcuGuardrailOptions = {}
): Promise<Set<number>> {
  const uniqueAppids = Array.from(new Set(appids));

  if (uniqueAppids.length === 0) {
    return new Set<number>();
  }

  if (readDataWriteTarget(options.env) === 'tiger') {
    try {
      return await (options.tiger ?? getTigerWriter(options.env)).metrics.listSuspiciousZeroAppids(
        uniqueAppids
      );
    } catch (error) {
      log.warn('Tiger suspicious zero lookup failed; continuing without guardrail results', {
        appids: uniqueAppids.length,
        error: describeError(error),
      });
      return new Set<number>();
    }
  }

  const suspiciousViaRpc = await getSuspiciousZeroAppidsViaRpc(supabase, uniqueAppids);
  if (suspiciousViaRpc) {
    return suspiciousViaRpc;
  }

  try {
    return await getSuspiciousZeroAppidsViaFallback(supabase, uniqueAppids);
  } catch (error) {
    log.warn('Suspicious zero lookup failed completely; continuing without guardrail results', {
      appids: uniqueAppids.length,
      error: describeError(error),
    });
    return new Set<number>();
  }
}
