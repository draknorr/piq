import { NextResponse } from 'next/server';
import { getAuthErrorResponse, requireAuthOrThrow } from '@/lib/auth-utils';
import { postToQueryApi } from '@/lib/query-api-client';
import { createServerClient } from '@/lib/supabase/server';
import type { ChangeFeedStatus } from '@/app/(main)/changes/lib';

export const dynamic = 'force-dynamic';

const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

const CATCHING_UP_QUEUE_COUNT = 25000;
const DELAYED_QUEUE_COUNT = 100000;
const CATCHING_UP_QUEUE_AGE_HOURS = 6;
const DELAYED_QUEUE_AGE_HOURS = 24;
const CATCHING_UP_EVENT_AGE_HOURS = 3;
const DELAYED_EVENT_AGE_HOURS = 12;

interface TigerChangeFeedStatusResponse {
  latestNewsEventAt: string | null;
  latestProjectionRefreshAt: string | null;
  latestStorefrontEventAt: string | null;
  oldestProjectionQueuedAt: string | null;
  oldestQueuedAt: string | null;
  projectionQueuedJobs: number;
  queuedJobs: number;
}

let statusCache:
  | {
      data: ChangeFeedStatus;
      cachedAt: number;
    }
  | null = null;

function getHoursSince(timestamp: string | null): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return (Date.now() - parsed) / (1000 * 60 * 60);
}

function shouldUseTigerChangeFeedReads(): boolean {
  const target =
    process.env.CHANGE_INTEL_READ_TARGET?.trim().toLowerCase() ??
    process.env.CHANGE_FEED_READ_TARGET?.trim().toLowerCase();
  return target === 'tiger';
}

function shouldUseStrictTigerChangeFeedReads(): boolean {
  const value =
    process.env.CHANGE_INTEL_READ_STRICT ?? process.env.CHANGE_FEED_READ_STRICT;
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

async function fetchTigerStatus(): Promise<ChangeFeedStatus> {
  const result = await postToQueryApi<TigerChangeFeedStatusResponse>(
    '/v1/contracts/get-change-feed-status',
    {},
    { timeoutMs: 10_000 }
  );

  if (!result.ok || !result.data) {
    throw new Error(
      `Change Feed status query failed: ${result.reason ?? result.errorCode ?? 'unknown error'}`
    );
  }

  return determineState(
    result.data.queuedJobs,
    result.data.oldestQueuedAt,
    result.data.latestStorefrontEventAt,
    result.data.latestNewsEventAt,
    result.data.projectionQueuedJobs,
    result.data.oldestProjectionQueuedAt,
    result.data.latestProjectionRefreshAt
  );
}

function determineState(
  queuedJobs: number,
  oldestQueuedAt: string | null,
  latestStorefrontEventAt: string | null,
  latestNewsEventAt: string | null,
  projectionQueuedJobs: number,
  oldestProjectionQueuedAt: string | null,
  latestProjectionRefreshAt: string | null
): ChangeFeedStatus {
  const reasons: string[] = [];
  const oldestQueuedHours = getHoursSince(oldestQueuedAt);
  const storefrontHours = getHoursSince(latestStorefrontEventAt);
  const newsHours = getHoursSince(latestNewsEventAt);
  const oldestProjectionQueuedHours = getHoursSince(oldestProjectionQueuedAt);
  const projectionRefreshHours = getHoursSince(latestProjectionRefreshAt);

  if (queuedJobs > DELAYED_QUEUE_COUNT) {
    reasons.push('Queued storefront/news backlog is above 100,000 jobs.');
  } else if (queuedJobs > CATCHING_UP_QUEUE_COUNT) {
    reasons.push('Queued storefront/news backlog is above 25,000 jobs.');
  }

  if (oldestQueuedHours != null) {
    if (oldestQueuedHours > DELAYED_QUEUE_AGE_HOURS) {
      reasons.push('Oldest queued storefront/news capture is older than 24 hours.');
    } else if (oldestQueuedHours > CATCHING_UP_QUEUE_AGE_HOURS) {
      reasons.push('Oldest queued storefront/news capture is older than 6 hours.');
    }
  }

  if (storefrontHours == null) {
    reasons.push('No storefront change events have been captured yet.');
  } else if (storefrontHours > DELAYED_EVENT_AGE_HOURS) {
    reasons.push('Latest storefront change event is older than 12 hours.');
  } else if (storefrontHours > CATCHING_UP_EVENT_AGE_HOURS) {
    reasons.push('Latest storefront change event is older than 3 hours.');
  }

  if (newsHours == null) {
    reasons.push('No news change events have been captured yet.');
  } else if (newsHours > DELAYED_EVENT_AGE_HOURS) {
    reasons.push('Latest news change event is older than 12 hours.');
  } else if (newsHours > CATCHING_UP_EVENT_AGE_HOURS) {
    reasons.push('Latest news change event is older than 3 hours.');
  }

  if (projectionQueuedJobs > DELAYED_QUEUE_COUNT) {
    reasons.push('Queued change-activity projection refresh backlog is above 100,000 jobs.');
  } else if (projectionQueuedJobs > CATCHING_UP_QUEUE_COUNT) {
    reasons.push('Queued change-activity projection refresh backlog is above 25,000 jobs.');
  }

  if (oldestProjectionQueuedHours != null) {
    if (oldestProjectionQueuedHours > DELAYED_QUEUE_AGE_HOURS) {
      reasons.push('Oldest queued change-activity projection refresh is older than 24 hours.');
    } else if (oldestProjectionQueuedHours > CATCHING_UP_QUEUE_AGE_HOURS) {
      reasons.push('Oldest queued change-activity projection refresh is older than 6 hours.');
    }
  }

  if (projectionRefreshHours == null) {
    reasons.push('No change-activity projection rows have been refreshed yet.');
  } else if (projectionRefreshHours > DELAYED_EVENT_AGE_HOURS) {
    reasons.push('Latest change-activity projection refresh is older than 12 hours.');
  } else if (projectionRefreshHours > CATCHING_UP_EVENT_AGE_HOURS) {
    reasons.push('Latest change-activity projection refresh is older than 3 hours.');
  }

  let state: ChangeFeedStatus['state'] = 'healthy';
  const isDelayed =
    queuedJobs > DELAYED_QUEUE_COUNT ||
    projectionQueuedJobs > DELAYED_QUEUE_COUNT ||
    (oldestQueuedHours != null && oldestQueuedHours > DELAYED_QUEUE_AGE_HOURS) ||
    (oldestProjectionQueuedHours != null && oldestProjectionQueuedHours > DELAYED_QUEUE_AGE_HOURS) ||
    storefrontHours == null ||
    newsHours == null ||
    projectionRefreshHours == null ||
    (storefrontHours != null && storefrontHours > DELAYED_EVENT_AGE_HOURS) ||
    (newsHours != null && newsHours > DELAYED_EVENT_AGE_HOURS) ||
    (projectionRefreshHours != null && projectionRefreshHours > DELAYED_EVENT_AGE_HOURS);

  if (isDelayed) {
    state = 'delayed';
  } else if (
    queuedJobs > CATCHING_UP_QUEUE_COUNT ||
    projectionQueuedJobs > CATCHING_UP_QUEUE_COUNT ||
    (oldestQueuedHours != null && oldestQueuedHours > CATCHING_UP_QUEUE_AGE_HOURS) ||
    (oldestProjectionQueuedHours != null && oldestProjectionQueuedHours > CATCHING_UP_QUEUE_AGE_HOURS) ||
    (storefrontHours != null && storefrontHours > CATCHING_UP_EVENT_AGE_HOURS) ||
    (newsHours != null && newsHours > CATCHING_UP_EVENT_AGE_HOURS) ||
    (projectionRefreshHours != null && projectionRefreshHours > CATCHING_UP_EVENT_AGE_HOURS)
  ) {
    state = 'catching_up';
  }

  return {
    state,
    queuedJobs,
    oldestQueuedAt,
    latestStorefrontEventAt,
    latestNewsEventAt,
    projectionQueuedJobs,
    oldestProjectionQueuedAt,
    latestProjectionRefreshAt,
    reasons,
  };
}

export async function GET() {
  try {
    await requireAuthOrThrow();

    if (statusCache && Date.now() - statusCache.cachedAt < STATUS_CACHE_TTL_MS) {
      return NextResponse.json(statusCache.data);
    }

    if (shouldUseTigerChangeFeedReads()) {
      try {
        const status = await fetchTigerStatus();
        statusCache = {
          data: status,
          cachedAt: Date.now(),
        };
        return NextResponse.json(status);
      } catch (error) {
        if (shouldUseStrictTigerChangeFeedReads()) {
          console.error('Change Feed status query error:', error);
          return NextResponse.json({ error: 'Failed to load Change Feed status' }, { status: 500 });
        }

        console.warn('Change Feed status query failed; falling back to Supabase.', error);
      }
    }

    const supabase = await createServerClient();
    // Generated DB types will lag until the migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const [
      queuedJobsResult,
      oldestQueuedResult,
      latestStorefrontResult,
      latestNewsResult,
      projectionQueuedJobsResult,
      oldestProjectionQueuedResult,
      latestProjectionRefreshResult,
    ] = await Promise.all([
      db
        .from('app_capture_work_state')
        .select('id', { count: 'exact', head: true })
        .not('dirty_since', 'is', null)
        .is('dead_lettered_at', null)
        .in('source', ['storefront', 'news']),
      db
        .from('app_capture_work_state')
        .select('dirty_since')
        .not('dirty_since', 'is', null)
        .is('dead_lettered_at', null)
        .in('source', ['storefront', 'news'])
        .order('dirty_since', { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from('app_change_events')
        .select('occurred_at')
        .eq('source', 'storefront')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('app_change_events')
        .select('occurred_at')
        .eq('source', 'news')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('app_capture_work_state')
        .select('id', { count: 'exact', head: true })
        .not('dirty_since', 'is', null)
        .is('dead_lettered_at', null)
        .eq('source', 'projection_refresh'),
      db
        .from('app_capture_work_state')
        .select('dirty_since')
        .not('dirty_since', 'is', null)
        .is('dead_lettered_at', null)
        .eq('source', 'projection_refresh')
        .order('dirty_since', { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from('change_activity_bursts')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const errors = [
      queuedJobsResult.error,
      oldestQueuedResult.error,
      latestStorefrontResult.error,
      latestNewsResult.error,
      projectionQueuedJobsResult.error,
      oldestProjectionQueuedResult.error,
      latestProjectionRefreshResult.error,
    ].filter(Boolean);

    if (errors.length > 0) {
      console.error('Change Feed status query error:', errors);
      return NextResponse.json({ error: 'Failed to load Change Feed status' }, { status: 500 });
    }

    const status = determineState(
      queuedJobsResult.count ?? 0,
      oldestQueuedResult.data?.dirty_since ?? null,
      latestStorefrontResult.data?.occurred_at ?? null,
      latestNewsResult.data?.occurred_at ?? null,
      projectionQueuedJobsResult.count ?? 0,
      oldestProjectionQueuedResult.data?.dirty_since ?? null,
      latestProjectionRefreshResult.data?.updated_at ?? null
    );

    statusCache = {
      data: status,
      cachedAt: Date.now(),
    };

    return NextResponse.json(status);
  } catch (error) {
    const authErrorResponse = getAuthErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    console.error('Change Feed status GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
