import type { PostgrestError } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import type {
  ChangeActivityDetail,
  ChangeActivityRow,
  ChangeBurstDetail,
  ChangeBurstImpact,
  ChangeBurstImpactWindow,
  ChangeFeedActivityResponse,
  ChangeFeedBurstsResponse,
  ChangeFeedNewsResponse,
  ChangeFeedSource,
  ChangeNewsRow,
  JsonValue,
  RawChangeActivityRow,
  RawChangeBurstRow,
  RawChangeNewsRow,
} from './change-feed-types';
import {
  buildAnnouncementActivityDetail,
  buildAnnouncementActivityRow,
  buildChangeActivityDetail,
  buildChangeActivityRow,
  filterActivitiesBySignalFamilies,
  filterActivitiesForView,
  parseActivityId,
  sortActivities,
} from './change-feed-presenters';
import type {
  ChangeFeedActivityParams,
  ChangeFeedBurstParams,
  ChangeFeedNewsParams,
} from './change-feed-query';
import {
  buildNextCursor,
  decodeActivityCursor,
  decodeActivityScoreCursor,
  encodeActivityCursor,
  encodeActivityScoreCursor,
  isMissingChangeFeedRpcError,
  mapChangeActivityRow,
  mapChangeBurstRow,
  mapChangeNewsRow,
  toSqlChangeFeedPreset,
} from './change-feed-query';

const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const BURST_DETAIL_NEWS_LIMIT = 50;
const BURST_DETAIL_RELATED_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;

let defaultBurstsCache:
  | {
      data: ChangeFeedBurstsResponse;
      cachedAt: number;
    }
  | null = null;

let defaultNewsCache:
  | {
      data: ChangeFeedNewsResponse;
      cachedAt: number;
    }
  | null = null;

let defaultActivityCache:
  | {
      data: ChangeFeedActivityResponse;
      cachedAt: number;
    }
  | null = null;

export class ChangeFeedUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeFeedUnavailableError';
  }
}

export class ChangeFeedQueryError extends Error {
  constructor(message: string, readonly cause?: PostgrestError) {
    super(message);
    this.name = 'ChangeFeedQueryError';
  }
}

interface ParsedBurstId {
  appid: number;
  burstStartedAt: string;
  burstEndedAt: string;
}

interface RawBurstAppRow {
  appid: number;
  name: string;
  type: ChangeBurstDetail['appType'];
  is_released: boolean | null;
  release_date: string | null;
}

interface RawBurstEventRow {
  id: number;
  appid: number;
  source: ChangeFeedSource;
  change_type: string;
  occurred_at: string;
  before_value: JsonValue;
  after_value: JsonValue;
  context: Record<string, JsonValue | undefined> | null;
}

interface RawBurstNewsItemRow {
  gid: string;
  appid: number;
  url: string | null;
  feedlabel: string | null;
  feedname: string | null;
  published_at: string | null;
  first_seen_at: string | null;
}

interface RawBurstNewsVersionRow {
  gid: string;
  title: string | null;
  url: string | null;
  first_seen_at: string;
}

interface RawChangeWindowMetricsPayload {
  daily_metrics?: {
    avg_price_cents?: number | null;
    avg_discount_percent?: number | null;
    max_total_reviews?: number | null;
    avg_review_score?: number | null;
    max_ccu_peak?: number | null;
  } | null;
  ccu?: {
    max_player_count?: number | null;
  } | null;
}

function parseBurstTimestamp(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, millisecond] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
}

function parseBurstId(value: string): ParsedBurstId | null {
  const match = /^(\d+):([^:]+):([^:]+)$/.exec(value);

  if (!match) {
    return null;
  }

  const [, appidValue, burstStartedAtValue, burstEndedAtValue] = match;
  const appid = Number.parseInt(appidValue, 10);
  const burstStartedAt = parseBurstTimestamp(burstStartedAtValue);
  const burstEndedAt = parseBurstTimestamp(burstEndedAtValue);

  if (!Number.isInteger(appid) || !burstStartedAt || !burstEndedAt) {
    return null;
  }

  return {
    appid,
    burstStartedAt,
    burstEndedAt,
  };
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function subtractDuration(value: string, durationMs: number): string {
  return new Date(Date.parse(value) - durationMs).toISOString();
}

function addDuration(value: string, durationMs: number): string {
  return new Date(Date.parse(value) + durationMs).toISOString();
}

function getNewsSortTime(row: Pick<ChangeNewsRow, 'publishedAt' | 'firstSeenAt'>): string | null {
  return row.publishedAt ?? row.firstSeenAt;
}

function mapMetricsImpactWindow(value: JsonValue): ChangeBurstImpactWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as RawChangeWindowMetricsPayload;
  const dailyMetrics = payload.daily_metrics ?? null;
  const ccu = payload.ccu ?? null;

  const window: ChangeBurstImpactWindow = {
    ccuPeak: ccu?.max_player_count ?? dailyMetrics?.max_ccu_peak ?? null,
    totalReviews: dailyMetrics?.max_total_reviews ?? null,
    positiveReviews: null,
    negativeReviews: null,
    reviewScore: dailyMetrics?.avg_review_score ?? null,
    reviewScoreLabel: null,
    priceCents: dailyMetrics?.avg_price_cents ?? null,
    discountPercent: dailyMetrics?.avg_discount_percent ?? null,
  };

  return Object.values(window).some((field) => field !== null) ? window : null;
}

async function fetchBurstImpact(
  appid: number,
  burstStartedAt: string,
  burstEndedAt: string
): Promise<ChangeBurstImpact | null> {
  try {
    const [baseline7d, response1d, response7d] = await Promise.all([
      executeChangeFeedRpc<JsonValue>('get_change_window_metrics', {
        p_appid: appid,
        p_start: subtractDuration(burstStartedAt, 7 * BURST_DETAIL_RELATED_NEWS_WINDOW_MS),
        p_end: burstStartedAt,
      }),
      executeChangeFeedRpc<JsonValue>('get_change_window_metrics', {
        p_appid: appid,
        p_start: burstEndedAt,
        p_end: addDuration(burstEndedAt, BURST_DETAIL_RELATED_NEWS_WINDOW_MS),
      }),
      executeChangeFeedRpc<JsonValue>('get_change_window_metrics', {
        p_appid: appid,
        p_start: burstEndedAt,
        p_end: addDuration(burstEndedAt, 7 * BURST_DETAIL_RELATED_NEWS_WINDOW_MS),
      }),
    ]);

    const impact: ChangeBurstImpact = {
      baseline7d: mapMetricsImpactWindow(baseline7d),
      response1d: mapMetricsImpactWindow(response1d),
      response7d: mapMetricsImpactWindow(response7d),
    };

    return impact.baseline7d || impact.response1d || impact.response7d ? impact : null;
  } catch (error) {
    console.error('Steam Activity impact lookup failed:', error);
    return null;
  }
}

async function fetchBurstRelatedNews(
  db: ReturnType<typeof getServiceSupabase>,
  app: RawBurstAppRow,
  burstStartedAt: string,
  burstEndedAt: string
): Promise<ChangeNewsRow[]> {
  const windowStart = subtractDuration(burstStartedAt, BURST_DETAIL_RELATED_NEWS_WINDOW_MS);
  const windowEnd = addDuration(burstEndedAt, BURST_DETAIL_RELATED_NEWS_WINDOW_MS);
  // Generated DB types lag migrations for these history surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryBuilder = db as any;

  const [
    { data: publishedNewsRows, error: publishedNewsError },
    { data: firstSeenNewsRows, error: firstSeenNewsError },
  ] = await Promise.all([
    queryBuilder
      .from('steam_news_items')
      .select('gid, appid, url, feedlabel, feedname, published_at, first_seen_at')
      .eq('appid', app.appid)
      .not('published_at', 'is', null)
      .gte('published_at', windowStart)
      .lte('published_at', windowEnd)
      .order('published_at', { ascending: false })
      .limit(BURST_DETAIL_NEWS_LIMIT) as Promise<{
      data: RawBurstNewsItemRow[] | null;
      error: PostgrestError | null;
    }>,
    queryBuilder
      .from('steam_news_items')
      .select('gid, appid, url, feedlabel, feedname, published_at, first_seen_at')
      .eq('appid', app.appid)
      .gte('first_seen_at', windowStart)
      .lte('first_seen_at', windowEnd)
      .order('first_seen_at', { ascending: false })
      .limit(BURST_DETAIL_NEWS_LIMIT) as Promise<{
      data: RawBurstNewsItemRow[] | null;
      error: PostgrestError | null;
    }>,
  ]);

  if (publishedNewsError) {
    throw new ChangeFeedQueryError(publishedNewsError.message, publishedNewsError);
  }

  if (firstSeenNewsError) {
    throw new ChangeFeedQueryError(firstSeenNewsError.message, firstSeenNewsError);
  }

  const newsByGid = new Map<string, RawBurstNewsItemRow>();
  for (const row of [...(publishedNewsRows ?? []), ...(firstSeenNewsRows ?? [])]) {
    newsByGid.set(row.gid, row);
  }

  const relatedNewsRows = Array.from(newsByGid.values())
    .filter((row) => {
      const sortTime = row.published_at ?? row.first_seen_at;
      return Boolean(sortTime && sortTime >= windowStart && sortTime <= windowEnd);
    })
    .sort((left, right) => {
      const leftSortTime = left.published_at ?? left.first_seen_at ?? '';
      const rightSortTime = right.published_at ?? right.first_seen_at ?? '';
      return rightSortTime.localeCompare(leftSortTime) || right.gid.localeCompare(left.gid);
    });

  if (relatedNewsRows.length === 0) {
    return [];
  }

  const relatedGids = relatedNewsRows.map((row) => row.gid);
  const { data: newsVersionRows, error: newsVersionError } = (await queryBuilder
    .from('steam_news_versions')
    .select('gid, title, url, first_seen_at')
    .in('gid', relatedGids)
    .order('gid', { ascending: true })
    .order('first_seen_at', { ascending: false })) as {
    data: RawBurstNewsVersionRow[] | null;
    error: PostgrestError | null;
  };

  if (newsVersionError) {
    throw new ChangeFeedQueryError(newsVersionError.message, newsVersionError);
  }

  const latestVersionByGid = new Map<string, RawBurstNewsVersionRow>();
  for (const row of newsVersionRows ?? []) {
    if (!latestVersionByGid.has(row.gid)) {
      latestVersionByGid.set(row.gid, row);
    }
  }

  return relatedNewsRows.map((row) => {
    const latestVersion = latestVersionByGid.get(row.gid);

    return {
      gid: row.gid,
      appid: row.appid,
      appName: app.name,
      appType: app.type,
      publishedAt: row.published_at,
      firstSeenAt: row.first_seen_at,
      title: latestVersion?.title ?? null,
      feedLabel: row.feedlabel ?? null,
      feedName: row.feedname ?? null,
      url: latestVersion?.url ?? row.url ?? null,
    };
  });
}

function isDefaultBurstsRequest(params: ChangeFeedBurstParams): boolean {
  return (
    params.days === 7 &&
    params.preset === 'high-signal' &&
    params.appTypes === null &&
    params.search === null &&
    params.sourceFilter === null &&
    params.cursorTime === null &&
    params.cursorKey === null &&
    params.limit === 50
  );
}

function isDefaultNewsRequest(params: ChangeFeedNewsParams): boolean {
  return (
    params.days === 7 &&
    params.appTypes === null &&
    params.search === null &&
    params.cursorTime === null &&
    params.cursorKey === null &&
    params.limit === 50
  );
}

function isDefaultActivityRequest(params: ChangeFeedActivityParams): boolean {
  return (
    params.days === 7 &&
    params.view === 'overview' &&
    params.mode === 'all' &&
    params.sort === 'relevant' &&
    params.appTypes === null &&
    params.signalFamilies === null &&
    params.search === null &&
    params.cursor === null &&
    params.limit === 50
  );
}

async function executeChangeFeedRpc<T>(
  functionName: string,
  args: Record<string, unknown>
): Promise<T> {
  const supabase = getServiceSupabase();

  // Generated DB types lag migrations for these RPC surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(functionName, args);

  if (error) {
    if (isMissingChangeFeedRpcError(error, functionName)) {
      throw new ChangeFeedUnavailableError(
        `Change Feed query surface "${functionName}" is not available yet. Apply the pending migration first.`
      );
    }

    throw new ChangeFeedQueryError(error.message, error);
  }

  return data as T;
}

export async function fetchChangeFeedBurstsResponse(
  params: ChangeFeedBurstParams
): Promise<ChangeFeedBurstsResponse> {
  const isDefaultRequest = isDefaultBurstsRequest(params);

  if (
    isDefaultRequest &&
    defaultBurstsCache &&
    Date.now() - defaultBurstsCache.cachedAt < DEFAULT_CACHE_TTL_MS
  ) {
    return defaultBurstsCache.data;
  }

  const data = await executeChangeFeedRpc<RawChangeBurstRow[]>('get_change_feed_bursts', {
    p_days: params.days,
    p_preset: toSqlChangeFeedPreset(params.preset),
    p_app_types: params.appTypes,
    p_search: params.search,
    p_source_filter: params.sourceFilter,
    p_cursor_time: params.cursorTime,
    p_cursor_burst_id: params.cursorKey,
    p_limit: params.limit,
  });

  const items = (data ?? []).map(mapChangeBurstRow);
  const response: ChangeFeedBurstsResponse = {
    items,
    nextCursor: buildNextCursor(items, params.limit),
    meta: {
      days: params.days,
      preset: params.preset,
      limit: params.limit,
      appTypes: params.appTypes,
      sourceFilter: params.sourceFilter,
      search: params.search,
    },
  };

  if (isDefaultRequest) {
    defaultBurstsCache = {
      data: response,
      cachedAt: Date.now(),
    };
  }

  return response;
}

export async function fetchChangeFeedNewsResponse(
  params: ChangeFeedNewsParams
): Promise<ChangeFeedNewsResponse> {
  const isDefaultRequest = isDefaultNewsRequest(params);

  if (
    isDefaultRequest &&
    defaultNewsCache &&
    Date.now() - defaultNewsCache.cachedAt < DEFAULT_CACHE_TTL_MS
  ) {
    return defaultNewsCache.data;
  }

  const data = await executeChangeFeedRpc<RawChangeNewsRow[]>('get_change_feed_news', {
    p_days: params.days,
    p_app_types: params.appTypes,
    p_search: params.search,
    p_cursor_time: params.cursorTime,
    p_cursor_gid: params.cursorKey,
    p_limit: params.limit,
  });

  const items = (data ?? []).map(mapChangeNewsRow);
  const response: ChangeFeedNewsResponse = {
    items,
    nextCursor: buildNextCursor(items, params.limit),
    meta: {
      days: params.days,
      limit: params.limit,
      appTypes: params.appTypes,
      search: params.search,
    },
  };

  if (isDefaultRequest) {
    defaultNewsCache = {
      data: response,
      cachedAt: Date.now(),
    };
  }

  return response;
}

function getLegacyPresetForView(view: ChangeFeedActivityParams['view']): ChangeFeedBurstParams['preset'] {
  switch (view) {
    case 'launch-watch':
      return 'upcoming-radar';
    case 'all-activity':
      return 'all-changes';
    default:
      return 'high-signal';
  }
}

function shouldUseComposedActivityFastPath(params: ChangeFeedActivityParams): boolean {
  if (params.mode === 'changes') {
    return false;
  }

  if (params.signalFamilies && !params.signalFamilies.includes('announcement')) {
    return false;
  }

  return true;
}

async function fetchComposedChangeFeedActivityResponse(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const { offset } = decodeActivityCursor(params.cursor);
  const internalLimit = Math.min(Math.max(offset + params.limit + 100, 150), 1000);
  const changeSignalFamilies = params.signalFamilies?.filter((family) => family !== 'announcement') ?? null;

  const [changeRows, newsResponse] = await Promise.all([
    params.mode === 'announcements'
      ? Promise.resolve<ChangeActivityRow[]>([])
      : (async () => {
          const data = await executeChangeFeedRpc<ActivityRpcRow[]>('get_change_feed_activity', {
            p_days: params.days,
            p_view: params.view,
            p_mode: 'changes',
            p_app_types: params.appTypes,
            p_search: params.search,
            p_signal_families: changeSignalFamilies,
            p_sort:
              params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort,
            p_cursor_score: null,
            p_cursor_time: null,
            p_cursor_activity_id: null,
            p_limit: internalLimit,
          });

          return (data ?? []).map(mapChangeActivityRow);
        })(),
    fetchChangeFeedNewsResponse({
      days: params.days,
      appTypes: params.appTypes,
      search: params.search,
      cursorTime: null,
      cursorKey: null,
      limit: internalLimit,
    }),
  ]);

  let items: ChangeActivityRow[] = [
    ...changeRows,
    ...(newsResponse.items ?? []).map(buildAnnouncementActivityRow),
  ];

  items = filterActivitiesForView(items, params.view);
  items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
  items = sortActivities(
    items,
    params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort
  );

  const pageItems = items.slice(offset, offset + params.limit);
  const nextCursor =
    items.length > offset + params.limit ? encodeActivityCursor({ offset: offset + params.limit }) : null;

  return {
    items: pageItems,
    nextCursor,
    meta: {
      days: params.days,
      view: params.view,
      mode: params.mode,
      sort: params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort,
      limit: params.limit,
      appTypes: params.appTypes,
      signalFamilies: params.signalFamilies,
      search: params.search,
    },
  };
}

async function fetchLegacyChangeFeedActivityResponse(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const { offset } = decodeActivityCursor(params.cursor);
  const internalLimit = Math.min(Math.max(offset + params.limit + 25, 75), 100);

  const [burstsResponse, newsResponse] = await Promise.all([
    params.mode === 'announcements'
      ? Promise.resolve<ChangeFeedBurstsResponse | null>(null)
      : fetchChangeFeedBurstsResponse({
          days: params.days,
          preset: getLegacyPresetForView(params.view),
          appTypes: params.appTypes,
          search: params.search,
          sourceFilter: null,
          cursorTime: null,
          cursorKey: null,
          limit: internalLimit,
        }),
    params.mode === 'changes'
      ? Promise.resolve<ChangeFeedNewsResponse | null>(null)
      : fetchChangeFeedNewsResponse({
          days: params.days,
          appTypes: params.appTypes,
          search: params.search,
          cursorTime: null,
          cursorKey: null,
          limit: internalLimit,
        }),
  ]);

  let items: ChangeActivityRow[] = [
    ...(burstsResponse?.items ?? []).map(buildChangeActivityRow),
    ...(newsResponse?.items ?? []).map(buildAnnouncementActivityRow),
  ];

  items = filterActivitiesForView(items, params.view);
  items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
  items = sortActivities(
    items,
    params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort
  );

  const pageItems = items.slice(offset, offset + params.limit);
  const nextCursor =
    items.length > offset + params.limit ? encodeActivityCursor({ offset: offset + params.limit }) : null;

  return {
    items: pageItems,
    nextCursor,
    meta: {
      days: params.days,
      view: params.view,
      mode: params.mode,
      sort: params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort,
      limit: params.limit,
      appTypes: params.appTypes,
      signalFamilies: params.signalFamilies,
      search: params.search,
    },
  };
}

type ActivityRpcRow = RawChangeActivityRow & { sort_score: number | null };

export async function fetchChangeFeedActivityResponse(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const isDefaultRequest = isDefaultActivityRequest(params);

  if (
    isDefaultRequest &&
    defaultActivityCache &&
    Date.now() - defaultActivityCache.cachedAt < DEFAULT_CACHE_TTL_MS
  ) {
    return defaultActivityCache.data;
  }

  if (shouldUseComposedActivityFastPath(params)) {
    const response = await fetchComposedChangeFeedActivityResponse(params);

    if (isDefaultRequest) {
      defaultActivityCache = {
        data: response,
        cachedAt: Date.now(),
      };
    }

    return response;
  }

  const rpcCursor = decodeActivityScoreCursor(params.cursor);

  try {
    const data = await executeChangeFeedRpc<ActivityRpcRow[]>('get_change_feed_activity', {
      p_days: params.days,
      p_view: params.view,
      p_mode: params.mode,
      p_app_types: params.appTypes,
      p_search: params.search,
      p_signal_families: params.signalFamilies,
      p_sort: params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort,
      p_cursor_score: rpcCursor?.score ?? null,
      p_cursor_time: rpcCursor?.time ?? null,
      p_cursor_activity_id: rpcCursor?.id ?? null,
      p_limit: params.limit,
    });

    const items = (data ?? []).map(mapChangeActivityRow);
    const lastRow = data?.[data.length - 1] ?? null;

    const response: ChangeFeedActivityResponse = {
      items,
      nextCursor:
        data && data.length >= params.limit && lastRow
          ? encodeActivityScoreCursor({
              score: lastRow.sort_score ?? 0,
              time: lastRow.occurred_at,
              id: lastRow.activity_id,
            })
          : null,
      meta: {
        days: params.days,
        view: params.view,
        mode: params.mode,
        sort: params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort,
        limit: params.limit,
        appTypes: params.appTypes,
        signalFamilies: params.signalFamilies,
        search: params.search,
      },
    };

    if (isDefaultRequest) {
      defaultActivityCache = {
        data: response,
        cachedAt: Date.now(),
      };
    }

    return response;
  } catch (error) {
    if (error instanceof ChangeFeedUnavailableError) {
      const fallback = await fetchLegacyChangeFeedActivityResponse(params);

      if (isDefaultRequest) {
        defaultActivityCache = {
          data: fallback,
          cachedAt: Date.now(),
        };
      }

      return fallback;
    }

    throw error;
  }
}

function toNewsExcerpt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > 260 ? `${stripped.slice(0, 259).trimEnd()}…` : stripped;
}

async function fetchChangeFeedAnnouncementDetail(gid: string): Promise<{
  row: ChangeNewsRow;
  body: string | null;
  excerpt: string | null;
} | null> {
  const supabase = getServiceSupabase();
  // Generated DB types lag migrations for these history surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [{ data: newsItem, error: newsError }, { data: latestVersion, error: versionError }] =
    await Promise.all([
      db
        .from('steam_news_items')
        .select('gid, appid, url, feedlabel, feedname, published_at, first_seen_at')
        .eq('gid', gid)
        .maybeSingle(),
      db
        .from('steam_news_versions')
        .select('title, contents, url')
        .eq('gid', gid)
        .order('first_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (newsError) {
    throw new ChangeFeedQueryError(newsError.message, newsError);
  }

  if (versionError) {
    throw new ChangeFeedQueryError(versionError.message, versionError);
  }

  if (!newsItem) {
    return null;
  }

  const { data: app, error: appError } = await db
    .from('apps')
    .select('appid, name, type')
    .eq('appid', newsItem.appid)
    .maybeSingle();

  if (appError) {
    throw new ChangeFeedQueryError(appError.message, appError);
  }

  if (!app) {
    return null;
  }

  return {
    row: {
      gid: newsItem.gid,
      appid: newsItem.appid,
      appName: app.name,
      appType: app.type,
      publishedAt: newsItem.published_at,
      firstSeenAt: newsItem.first_seen_at,
      title: latestVersion?.title ?? null,
      feedLabel: newsItem.feedlabel ?? null,
      feedName: newsItem.feedname ?? null,
      url: latestVersion?.url ?? newsItem.url ?? null,
    },
    body: latestVersion?.contents ?? null,
    excerpt: toNewsExcerpt(latestVersion?.contents ?? null),
  };
}

export async function fetchChangeFeedBurstDetail(
  burstId: string
): Promise<ChangeBurstDetail | null> {
  const parsedBurstId = parseBurstId(burstId);

  if (!parsedBurstId) {
    return null;
  }

  const supabase = getServiceSupabase();
  // Generated DB types lag migrations for these history surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [{ data: appRow, error: appError }, { data: eventRows, error: eventError }] = await Promise.all([
    db
      .from('apps')
      .select('appid, name, type, is_released, release_date')
      .eq('appid', parsedBurstId.appid)
      .maybeSingle() as Promise<{
      data: RawBurstAppRow | null;
      error: PostgrestError | null;
    }>,
    db
      .from('app_change_events')
      .select('id, appid, source, change_type, occurred_at, before_value, after_value, context')
      .eq('appid', parsedBurstId.appid)
      .in('source', ['storefront', 'pics', 'media'])
      .gte('occurred_at', parsedBurstId.burstStartedAt)
      .lte('occurred_at', parsedBurstId.burstEndedAt)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true }) as Promise<{
      data: RawBurstEventRow[] | null;
      error: PostgrestError | null;
    }>,
  ]);

  if (appError) {
    throw new ChangeFeedQueryError(appError.message, appError);
  }

  if (eventError) {
    throw new ChangeFeedQueryError(eventError.message, eventError);
  }

  if (!appRow) {
    return null;
  }

  const safeEventRows = eventRows ?? [];
  const [relatedNews, impact] = await Promise.all([
    fetchBurstRelatedNews(supabase, appRow, parsedBurstId.burstStartedAt, parsedBurstId.burstEndedAt).catch(
      (error) => {
        console.error('Steam Activity related news lookup failed:', error);
        return [] as ChangeNewsRow[];
      }
    ),
    fetchBurstImpact(appRow.appid, parsedBurstId.burstStartedAt, parsedBurstId.burstEndedAt),
  ]);

  const sourceSet = uniqueSortedStrings(safeEventRows.map((row) => row.source)) as ChangeFeedSource[];
  const headlineChangeTypes = uniqueSortedStrings(safeEventRows.map((row) => row.change_type)).slice(0, 3);
  const sortedRelatedNews = [...relatedNews].sort((left, right) => {
    const leftSortTime = getNewsSortTime(left) ?? '';
    const rightSortTime = getNewsSortTime(right) ?? '';
    return rightSortTime.localeCompare(leftSortTime) || right.gid.localeCompare(left.gid);
  });

  return {
    burstId,
    appid: appRow.appid,
    appName: appRow.name,
    appType: appRow.type,
    isReleased: appRow.is_released,
    releaseDate: appRow.release_date,
    effectiveAt: parsedBurstId.burstEndedAt,
    burstStartedAt: parsedBurstId.burstStartedAt,
    burstEndedAt: parsedBurstId.burstEndedAt,
    eventCount: safeEventRows.length,
    sourceSet,
    headlineChangeTypes,
    changeTypeCount: new Set(safeEventRows.map((row) => row.change_type)).size,
    hasRelatedNews: sortedRelatedNews.length > 0,
    relatedNewsCount: sortedRelatedNews.length,
    events: safeEventRows.map((row) => ({
      eventId: row.id,
      appid: row.appid,
      source: row.source,
      changeType: row.change_type,
      occurredAt: row.occurred_at,
      beforeValue: row.before_value,
      afterValue: row.after_value,
      context: row.context ?? {},
    })),
    relatedNews: sortedRelatedNews,
    impact,
  };
}

export async function fetchChangeFeedActivityDetail(
  activityId: string
): Promise<ChangeActivityDetail | null> {
  const parsed = parseActivityId(activityId);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === 'change') {
    const detail = await fetchChangeFeedBurstDetail(parsed.value);
    return detail ? buildChangeActivityDetail(detail) : null;
  }

  const announcementDetail = await fetchChangeFeedAnnouncementDetail(parsed.value);
  return announcementDetail ? buildAnnouncementActivityDetail(announcementDetail) : null;
}
