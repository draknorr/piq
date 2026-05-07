import type { PostgrestError } from '@supabase/supabase-js';
import { resolveQueryApiBaseUrl } from '@/lib/query-api-config';
import { getServiceSupabase } from '@/lib/supabase-service';
import type {
  AppType,
  ChatChangePatternCandidateRow,
  ChangeActivityDetail,
  ChangeActivitySignalFamily,
  ChangeActivityStoryKind,
  ChangeActivityRow,
  ChangeBurstDetail,
  ChangeBurstImpact,
  ChangeBurstImpactWindow,
  ChangeDetailEvent,
  ChangeFeedActivityResponse,
  ChangeFeedBurstsResponse,
  ChangeFeedNewsResponse,
  ChangeRecentNewsFeedScope,
  ChangeRecentNewsDigestItem,
  ChangeRecentNewsTopicMatchItem,
  ChangeFeedSource,
  ChangeNewsRow,
  JsonValue,
  RawChangeBurstRow,
  RawChangeActivityRow,
  RawChatRecentNewsRow,
  RawChatRecentNewsTopicRow,
  RawChatChangeActivityCandidateRow,
  RawChatChangePatternCandidateRow,
  RawChangeNewsRow,
} from './change-feed-types';
import {
  CHANGE_ACTIVITY_SIGNAL_FAMILIES,
  CHANGE_ACTIVITY_STORY_KINDS,
  CHANGE_FEED_APP_TYPES,
  CHANGE_FEED_SOURCES,
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
  buildActivityNextCursor,
  buildChangeFeedActivityRpcArgs,
  buildChangeFeedNewsRpcArgs,
  decodeActivityCursor,
  encodeActivityCursor,
  isMissingChangeFeedRpcError,
  mapChangeActivityRow,
  mapChangeBurstRow,
  mapChangeNewsRow,
  toSqlChangeFeedPreset,
} from './change-feed-query';

const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const CHAT_RECENT_NEWS_CACHE_TTL_MS = 30 * 1000;
const CHAT_RECENT_NEWS_MAX_TOTAL_CHARS = 8_000;
const CHAT_RECENT_NEWS_MAX_ITEM_CHARS = 2_000;
const BURST_DETAIL_NEWS_LIMIT = 50;
const BURST_DETAIL_RELATED_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHANGE_FEED_QUERY_API_TIMEOUT_MS = 15_000;

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

const chatRecentNewsCache = new Map<
  string,
  {
    data: ChangeRecentNewsDigestItem[];
    cachedAt: number;
  }
>();

const chatRecentNewsTopicCache = new Map<
  string,
  {
    data: ChangeRecentNewsTopicMatchItem[];
    cachedAt: number;
  }
>();

const SIGNAL_FAMILY_SET = new Set<ChangeActivitySignalFamily>(CHANGE_ACTIVITY_SIGNAL_FAMILIES);
const STORY_KIND_SET = new Set<ChangeActivityStoryKind>(CHANGE_ACTIVITY_STORY_KINDS);
const APP_TYPE_SET = new Set<AppType>(CHANGE_FEED_APP_TYPES);
const SOURCE_SET = new Set<ChangeFeedSource>(CHANGE_FEED_SOURCES);

type TigerChangeActivityStoryKind =
  | 'announcement'
  | 'change-roundup'
  | 'commercial-move'
  | 'launch-prep'
  | 'store-refresh'
  | 'taxonomy-shift'
  | 'update-tease';

interface TigerSearchChangeActivityItem {
  activityId: string;
  activityKind: 'change' | 'announcement';
  appType: string | null;
  appid: number;
  externalUrl: string | null;
  facts: string[];
  hasBeforeAfter: boolean;
  headline: string;
  highlightLabels: string[];
  isReleased: boolean | null;
  name: string;
  occurredAt: string;
  relatedAnnouncementCount: number;
  releaseDate: string | null;
  signalFamilies: string[];
  storyKind: TigerChangeActivityStoryKind | string;
  summary: string;
}

interface TigerSearchChangeActivityResponse {
  continuationToken: string | null;
  items: TigerSearchChangeActivityItem[];
}

interface TigerChangeActivityDetailEvent {
  afterValue: JsonValue;
  appid: number;
  beforeValue: JsonValue;
  changeType: string;
  context: Record<string, JsonValue | undefined> | null;
  eventId: string;
  occurredAt: string;
  source: string;
}

interface TigerChangeActivityDetailNews {
  appid: number;
  appName: string;
  appType: string | null;
  feedLabel: string | null;
  feedName: string | null;
  firstSeenAt: string | null;
  gid: string;
  publishedAt: string | null;
  title: string | null;
  url: string | null;
}

interface TigerChangeActivityDetailItem {
  activity: TigerSearchChangeActivityItem;
  events: TigerChangeActivityDetailEvent[];
  impact: Record<string, JsonValue | undefined> | null;
  relatedNews: TigerChangeActivityDetailNews[];
}

interface TigerChangeActivityDetailResponse {
  item: TigerChangeActivityDetailItem | null;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function postChangeFeedQueryApi<T>(
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<{
  data?: T;
  errorCode?: string | null;
  ok: boolean;
  reason?: string | null;
}> {
  const { baseUrl, reason } = resolveQueryApiBaseUrl();
  if (!baseUrl) {
    return {
      errorCode: 'QUERY_API_BASE_URL_MISSING',
      ok: false,
      reason,
    };
  }

  const headers: HeadersInit = {
    'content-type': 'application/json',
  };
  const bearerToken = process.env.QUERY_API_BEARER_TOKEN?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  try {
    const response = await fetch(new URL(path, baseUrl), {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers,
      method: 'POST',
      signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        errorCode: isRecord(payload) && typeof payload.code === 'string' ? payload.code : null,
        ok: false,
        reason:
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`,
      };
    }

    return {
      data: payload as T,
      ok: true,
    };
  } catch (error) {
    return {
      errorCode: null,
      ok: false,
      reason: error instanceof Error ? error.message : 'Unknown query-api error',
    };
  }
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

function normalizeTigerAppType(value: string | null): AppType | null {
  return value && APP_TYPE_SET.has(value as AppType) ? (value as AppType) : null;
}

function normalizeTigerSource(value: string): ChangeFeedSource {
  return SOURCE_SET.has(value as ChangeFeedSource) ? (value as ChangeFeedSource) : 'storefront';
}

function normalizeTigerStoryKind(value: string): ChangeActivityStoryKind {
  switch (value) {
    case 'announcement':
    case 'commercial-move':
    case 'store-refresh':
      return value;
    case 'launch-prep':
      return 'release-prep';
    case 'taxonomy-shift':
      return 'positioning-shift';
    case 'update-tease':
    case 'change-roundup':
    default:
      return 'general-update';
  }
}

function mapTigerActivityItem(item: TigerSearchChangeActivityItem): ChangeActivityRow {
  return {
    activityId: item.activityId,
    activityKind: item.activityKind,
    storyKind: normalizeTigerStoryKind(item.storyKind),
    appid: item.appid,
    appName: item.name,
    appType: normalizeTigerAppType(item.appType),
    isReleased: item.isReleased,
    releaseDate: item.releaseDate,
    occurredAt: item.occurredAt,
    headline: item.headline,
    summary: item.summary,
    facts: item.facts,
    highlightLabels: item.highlightLabels,
    signalFamilies: toSafeSignalFamilies(item.signalFamilies),
    hasBeforeAfter: item.hasBeforeAfter,
    relatedAnnouncementCount: item.relatedAnnouncementCount,
    externalUrl: item.externalUrl,
  };
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

interface ChatRecentNewsParams {
  appIds: number[] | null;
  days: number;
  limit: number;
  perAppLimit: number | null;
}

interface ChatRecentNewsTopicSearchParams {
  query: string;
  aliases: string[] | null;
  appIds: number[] | null;
  appTypes: string[] | null;
  days: number;
  limit: number;
  feedScope: ChangeRecentNewsFeedScope;
}

interface RawChangeWindowMetricsPayload {
  daily_metrics?: {
    days?: number | null;
    avg_price_cents?: number | null;
    avg_discount_percent?: number | null;
    max_total_reviews?: number | null;
    avg_review_score?: number | null;
    max_ccu_peak?: number | null;
  } | null;
  review_deltas?: {
    days?: number | null;
    reviews_added?: number | null;
    positive_added?: number | null;
    negative_added?: number | null;
    avg_daily_velocity?: number | null;
  } | null;
  ccu?: {
    samples?: number | null;
    source?: string | null;
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

function toSafeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toSafeSignalFamilies(value: unknown): ChangeActivitySignalFamily[] {
  return toSafeStringArray(value).filter(
    (entry): entry is ChangeActivitySignalFamily =>
      SIGNAL_FAMILY_SET.has(entry as ChangeActivitySignalFamily)
  );
}

function toSafeStoryKinds(value: unknown): ChangeActivityStoryKind[] {
  return toSafeStringArray(value).filter(
    (entry): entry is ChangeActivityStoryKind =>
      STORY_KIND_SET.has(entry as ChangeActivityStoryKind)
  );
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

function normalizeRecentNewsCacheKey(params: ChatRecentNewsParams): string {
  return JSON.stringify({
    appIds: params.appIds ?? null,
    days: params.days,
    limit: params.limit,
    perAppLimit: params.perAppLimit,
  });
}

function normalizeRecentNewsTopicCacheKey(params: ChatRecentNewsTopicSearchParams): string {
  return JSON.stringify({
    query: params.query,
    aliases: params.aliases ?? null,
    appIds: params.appIds ?? null,
    appTypes: params.appTypes ?? null,
    days: params.days,
    limit: params.limit,
    feedScope: params.feedScope,
  });
}

function stripNewsBody(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > 0 ? stripped : null;
}

function truncateNewsText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

function mapChatRecentNewsRow(
  row: RawChatRecentNewsRow,
  maxItemChars: number
): ChangeRecentNewsDigestItem {
  const strippedBody = stripNewsBody(row.contents);

  return {
    gid: row.gid,
    appid: row.appid,
    appName: row.app_name,
    appType: row.app_type,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    title: row.title,
    feedLabel: row.feedlabel,
    feedName: row.feedname,
    url: row.url,
    excerpt: truncateNewsText(strippedBody, 260),
    bodyPreview: truncateNewsText(strippedBody, maxItemChars),
  };
}

function mapChatRecentNewsTopicRow(
  row: RawChatRecentNewsTopicRow,
  maxItemChars: number
): ChangeRecentNewsTopicMatchItem {
  return {
    gid: row.gid,
    appid: row.appid,
    appName: row.app_name,
    appType: row.app_type,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    sortTime: row.sort_time,
    feedScope: row.feed_scope,
    feedLabel: row.feedlabel,
    feedName: row.feedname,
    title: row.title,
    url: row.url,
    excerpt: truncateNewsText(row.excerpt, 260),
    bodyPreview: truncateNewsText(row.content_preview, maxItemChars),
    matchReason: row.match_reason,
  };
}

function applyRecentNewsBodyBudget<T extends { bodyPreview: string | null }>(
  rows: T[],
  maxTotalChars = CHAT_RECENT_NEWS_MAX_TOTAL_CHARS,
  maxItemChars = CHAT_RECENT_NEWS_MAX_ITEM_CHARS
): T[] {
  let remainingChars = maxTotalChars;

  return rows.map((row) => {
    if (!row.bodyPreview || remainingChars <= 0) {
      return {
        ...row,
        bodyPreview: null,
      };
    }

    const allowedChars = Math.min(maxItemChars, remainingChars);
    const bodyPreview = truncateNewsText(row.bodyPreview, allowedChars);
    remainingChars -= bodyPreview?.length ?? 0;

    return {
      ...row,
      bodyPreview,
    };
  });
}

function applyPerAppLimit(
  rows: ChangeRecentNewsDigestItem[],
  perAppLimit: number | null
): ChangeRecentNewsDigestItem[] {
  if (!perAppLimit || perAppLimit < 1) {
    return rows;
  }

  const counts = new Map<number, number>();
  const limitedRows: ChangeRecentNewsDigestItem[] = [];

  for (const row of rows) {
    const count = counts.get(row.appid) ?? 0;
    if (count >= perAppLimit) {
      continue;
    }

    counts.set(row.appid, count + 1);
    limitedRows.push(row);
  }

  return limitedRows;
}

function mapMetricsImpactWindow(value: JsonValue): ChangeBurstImpactWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as RawChangeWindowMetricsPayload;
  const dailyMetrics = payload.daily_metrics ?? null;
  const reviewDeltas = payload.review_deltas ?? null;
  const ccu = payload.ccu ?? null;
  const metricDays = toPositiveCount(dailyMetrics?.days);
  const reviewDays = toPositiveCount(reviewDeltas?.days);
  const ccuSamples = toPositiveCount(ccu?.samples);

  const window: ChangeBurstImpactWindow = {
    ccuPeak: toFiniteNumber(ccu?.max_player_count) ?? toFiniteNumber(dailyMetrics?.max_ccu_peak),
    totalReviews: toFiniteNumber(dailyMetrics?.max_total_reviews),
    positiveReviews: null,
    negativeReviews: null,
    reviewsAdded: reviewDays ? toFiniteNumber(reviewDeltas?.reviews_added) : null,
    positiveAdded: reviewDays ? toFiniteNumber(reviewDeltas?.positive_added) : null,
    negativeAdded: reviewDays ? toFiniteNumber(reviewDeltas?.negative_added) : null,
    avgDailyReviews: reviewDays ? toFiniteNumber(reviewDeltas?.avg_daily_velocity) : null,
    reviewScore: toFiniteNumber(dailyMetrics?.avg_review_score),
    reviewScoreLabel: null,
    priceCents: toFiniteNumber(dailyMetrics?.avg_price_cents),
    discountPercent: toFiniteNumber(dailyMetrics?.avg_discount_percent),
    metricDays,
    reviewDays,
    ccuSamples,
    ccuSource: typeof ccu?.source === 'string' ? ccu.source : null,
  };

  return Object.values(window).some((field) => field !== null) ? window : null;
}

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toPositiveCount(value: number | null | undefined): number | null {
  const numberValue = toFiniteNumber(value);
  return numberValue !== null && numberValue > 0 ? numberValue : null;
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
    params.historyScope === 'range' &&
    params.appIds === null &&
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
    params.historyScope === 'range' &&
    params.view === 'overview' &&
    params.mode === 'all' &&
    params.sort === 'relevant' &&
    params.appIds === null &&
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

function normalizeChatActivitySort(
  params: Pick<ChangeFeedActivityParams, 'view' | 'sort'>
): ChangeFeedActivityParams['sort'] {
  return params.view === 'all-activity' && params.sort === 'relevant' ? 'newest' : params.sort;
}

function getActivityBurstPreset(
  params: Pick<ChangeFeedActivityParams, 'view' | 'signalFamilies' | 'search'>
): 'high-signal' | 'upcoming-radar' | 'all-changes' {
  if (params.view === 'launch-watch') {
    return 'upcoming-radar';
  }

  if (
    params.search ||
    params.signalFamilies ||
    params.view === 'commercial-moves' ||
    params.view === 'store-refreshes' ||
    params.view === 'all-activity'
  ) {
    return 'all-changes';
  }

  return 'high-signal';
}

function buildActivityMeta(params: ChangeFeedActivityParams): ChangeFeedActivityResponse['meta'] {
  return {
    days: params.days,
    historyScope: params.historyScope,
    view: params.view,
    mode: params.mode,
    sort: normalizeChatActivitySort(params),
    limit: params.limit,
    appIds: params.appIds,
    appTypes: params.appTypes,
    signalFamilies: params.signalFamilies,
    search: params.search,
  };
}

function filterActivitiesByAppIds(
  items: ChangeActivityRow[],
  appIds: number[] | null
): ChangeActivityRow[] {
  if (!appIds || appIds.length === 0) {
    return items;
  }

  const allowed = new Set(appIds);
  return items.filter((item) => allowed.has(item.appid));
}

function mapChatChangeActivityCandidateRow(row: RawChatChangeActivityCandidateRow): ChangeActivityRow {
  const burstRow = mapChangeBurstRow(row);
  const signalFamilies = toSafeSignalFamilies(row.signal_families);
  const built = buildChangeActivityRow(burstRow);

  return {
    ...built,
    signalFamilies: signalFamilies.length > 0 ? signalFamilies : built.signalFamilies,
    storyKind: STORY_KIND_SET.has(row.story_kind) ? row.story_kind : built.storyKind,
  };
}

function mapChatChangePatternCandidateRow(
  row: RawChatChangePatternCandidateRow
): ChatChangePatternCandidateRow {
  const activityIds = toSafeStringArray(row.activity_ids).map((activityId) =>
    activityId.startsWith('change:') ? activityId : `change:${encodeURIComponent(activityId)}`
  );

  return {
    appid: row.appid,
    appName: row.app_name,
    appType: row.app_type,
    isReleased: row.is_released,
    releaseDate: row.release_date,
    latestOccurredAt: row.latest_occurred_at,
    activityIds,
    signalFamilies: toSafeSignalFamilies(row.signal_families),
    storyKinds: toSafeStoryKinds(row.story_kinds),
    announcementCount: row.announcement_count,
    changeCount: row.change_count,
    positivePercentage: row.positive_percentage,
    totalReviews: row.total_reviews,
    ccuPeak: row.ccu_peak,
    priceCents: row.price_cents,
    discountPercent: row.discount_percent,
    reviewVelocity7d: row.review_velocity_7d,
    reviewVelocity30d: row.review_velocity_30d,
    trend30dDirection: row.trend_30d_direction,
    ccuTrend7dPct: row.ccu_trend_7d_pct,
  };
}

async function fetchChatChangeRows(params: ChangeFeedActivityParams): Promise<ChangeActivityRow[]> {
  const sort = normalizeChatActivitySort(params);
  const excludedIds = new Set(params.excludeActivityIds ?? []);

  const data = await executeChangeFeedRpc<RawChatChangeActivityCandidateRow[]>(
    'get_chat_change_activity_candidates',
    {
      p_days: params.days,
      p_view: params.view,
      p_sort: sort,
      p_app_types: params.appTypes,
      p_signal_families: params.signalFamilies,
      p_search: params.search,
      p_limit: Math.min(Math.max(params.limit + excludedIds.size + 10, 25), 100),
    }
  );

  let items = (data ?? []).map(mapChatChangeActivityCandidateRow);
  items = filterActivitiesByAppIds(items, params.appIds);
  items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
  items = filterActivitiesForView(items, params.view);
  items = sortActivities(items, sort);
  if (excludedIds.size > 0) {
    items = items.filter((item) => !excludedIds.has(item.activityId));
  }
  return items.slice(0, params.limit);
}

export async function fetchChatChangeActivityResponse(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const sort = normalizeChatActivitySort(params);
  const excludedIds = new Set(params.excludeActivityIds ?? []);

  if (params.mode === 'announcements') {
    const newsResponse = await fetchChangeFeedNewsResponse({
      days: params.days,
      historyScope: params.historyScope,
      appIds: params.appIds,
      appTypes: params.appTypes,
      search: params.search,
      cursorTime: null,
      cursorKey: null,
      limit: Math.min(Math.max(params.limit + 25, 50), 100),
    });

    let items = newsResponse.items.map(buildAnnouncementActivityRow);
    items = filterActivitiesByAppIds(items, params.appIds);
    items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
    items = filterActivitiesForView(items, params.view);
    items = sortActivities(items, sort);
    if (excludedIds.size > 0) {
      items = items.filter((item) => !excludedIds.has(item.activityId));
    }

    return {
      items: items.slice(0, params.limit),
      nextCursor: null,
      meta: buildActivityMeta(params),
    };
  }

  const changeItems = await fetchChatChangeRows(params);

  if (
    params.mode === 'changes' ||
    params.view === 'launch-watch' ||
    params.view === 'commercial-moves' ||
    params.view === 'store-refreshes' ||
    (params.signalFamilies && !params.signalFamilies.includes('announcement'))
  ) {
    return {
      items: changeItems,
      nextCursor: null,
      meta: buildActivityMeta(params),
    };
  }

  const newsResponse = await fetchChangeFeedNewsResponse({
    days: params.days,
    historyScope: params.historyScope,
    appIds: params.appIds,
    appTypes: params.appTypes,
    search: params.search,
    cursorTime: null,
    cursorKey: null,
    limit: Math.min(Math.max(params.limit + 25, 50), 100),
  });

  let items: ChangeActivityRow[] = [
    ...changeItems,
    ...(newsResponse.items ?? []).map(buildAnnouncementActivityRow),
  ];
  items = filterActivitiesByAppIds(items, params.appIds);
  items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
  items = filterActivitiesForView(items, params.view);
  items = sortActivities(items, sort);
  if (excludedIds.size > 0) {
    items = items.filter((item) => !excludedIds.has(item.activityId));
  }

  return {
    items: items.slice(0, params.limit),
    nextCursor: null,
    meta: buildActivityMeta(params),
  };
}

export async function fetchChatChangePatternCandidates(params: {
  pattern: string;
  days: number;
  appTypes: AppType[] | null;
  search: string | null;
  limit: number;
}): Promise<ChatChangePatternCandidateRow[]> {
  const data = await executeChangeFeedRpc<RawChatChangePatternCandidateRow[]>(
    'get_chat_change_pattern_candidates',
    {
      p_pattern: params.pattern,
      p_days: params.days,
      p_app_types: params.appTypes,
      p_search: params.search,
      p_limit: params.limit,
    }
  );

  return (data ?? []).map(mapChatChangePatternCandidateRow);
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
    ...buildChangeFeedNewsRpcArgs(params),
  });

  const items = (data ?? []).map(mapChangeNewsRow);
  const response: ChangeFeedNewsResponse = {
    items,
    nextCursor: buildNextCursor(items, params.limit),
    meta: {
      days: params.days,
      historyScope: params.historyScope,
      limit: params.limit,
      appIds: params.appIds,
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

export async function fetchChatRecentNewsDigest(
  params: ChatRecentNewsParams
): Promise<ChangeRecentNewsDigestItem[]> {
  const normalizedLimit = Math.max(1, Math.min(params.limit, 6));
  const normalizedPerAppLimit =
    params.perAppLimit == null ? null : Math.max(1, Math.min(params.perAppLimit, normalizedLimit));
  const normalizedParams: ChatRecentNewsParams = {
    appIds:
      params.appIds && params.appIds.length > 0
        ? Array.from(new Set(params.appIds)).slice(0, 3)
        : null,
    days: Math.max(1, Math.min(params.days, 30)),
    limit: normalizedLimit,
    perAppLimit: normalizedPerAppLimit,
  };
  const cacheKey = normalizeRecentNewsCacheKey(normalizedParams);
  const cached = chatRecentNewsCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < CHAT_RECENT_NEWS_CACHE_TTL_MS) {
    return cached.data;
  }

  const requestedLimit =
    normalizedParams.perAppLimit != null && (normalizedParams.appIds?.length ?? 0) > 1
      ? Math.min(normalizedParams.limit * 2, 12)
      : normalizedParams.limit;

  const data = await executeChangeFeedRpc<RawChatRecentNewsRow[]>('get_chat_recent_news', {
    p_appids: normalizedParams.appIds,
    p_days: normalizedParams.days,
    p_limit: requestedLimit,
  });

  let items = (data ?? []).map((row) => mapChatRecentNewsRow(row, CHAT_RECENT_NEWS_MAX_ITEM_CHARS));
  items = applyPerAppLimit(items, normalizedParams.perAppLimit).slice(0, normalizedParams.limit);
  items = applyRecentNewsBodyBudget(items);

  if (chatRecentNewsCache.size >= 100) {
    const oldestKey = chatRecentNewsCache.keys().next().value;
    if (oldestKey) {
      chatRecentNewsCache.delete(oldestKey);
    }
  }

  chatRecentNewsCache.set(cacheKey, {
    data: items,
    cachedAt: Date.now(),
  });

  return items;
}

export async function fetchChatRecentNewsTopicSearch(
  params: ChatRecentNewsTopicSearchParams
): Promise<ChangeRecentNewsTopicMatchItem[]> {
  const normalizedParams: ChatRecentNewsTopicSearchParams = {
    query: params.query.trim(),
    aliases:
      params.aliases && params.aliases.length > 0
        ? Array.from(new Set(params.aliases.map((value) => value.trim()).filter((value) => value.length > 0))).slice(0, 8)
        : null,
    appIds:
      params.appIds && params.appIds.length > 0
        ? Array.from(new Set(params.appIds)).slice(0, 10)
        : null,
    appTypes:
      params.appTypes && params.appTypes.length > 0
        ? Array.from(new Set(params.appTypes.map((value) => value.trim()).filter((value) => value.length > 0))).slice(0, 5)
        : null,
    days: Math.max(1, Math.min(params.days, 30)),
    limit: Math.max(1, Math.min(params.limit, 10)),
    feedScope: params.feedScope,
  };

  const cacheKey = normalizeRecentNewsTopicCacheKey(normalizedParams);
  const cached = chatRecentNewsTopicCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < CHAT_RECENT_NEWS_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await executeChangeFeedRpc<RawChatRecentNewsTopicRow[]>('search_recent_news_topics', {
    p_query: normalizedParams.query,
    p_days: normalizedParams.days,
    p_limit: normalizedParams.limit,
    p_feed_scope: normalizedParams.feedScope,
    p_app_types: normalizedParams.appTypes,
    p_appids: normalizedParams.appIds,
    p_aliases: normalizedParams.aliases,
  });

  let items = (data ?? []).map((row) => mapChatRecentNewsTopicRow(row, CHAT_RECENT_NEWS_MAX_ITEM_CHARS));
  items = applyRecentNewsBodyBudget(items);

  if (chatRecentNewsTopicCache.size >= 100) {
    const oldestKey = chatRecentNewsTopicCache.keys().next().value;
    if (oldestKey) {
      chatRecentNewsTopicCache.delete(oldestKey);
    }
  }

  chatRecentNewsTopicCache.set(cacheKey, {
    data: items,
    cachedAt: Date.now(),
  });

  return items;
}

async function fetchComposedChangeFeedActivityFallback(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const { offset } = decodeActivityCursor(params.cursor);
  const internalLimit = Math.min(Math.max(offset + params.limit + 100, 150), 1000);
  const sort = normalizeChatActivitySort(params);
  const changeSignalFamilies = params.signalFamilies?.filter((family) => family !== 'announcement') ?? null;

  const [changeRows, newsResponse] = await Promise.all([
    params.mode === 'announcements'
      ? Promise.resolve<ChangeActivityRow[]>([])
      : (async () => {
          const burstsResponse = await fetchChangeFeedBurstsResponse({
            days: params.days,
            preset: getActivityBurstPreset({
              view: params.view,
              signalFamilies: changeSignalFamilies,
              search: params.search,
            }),
            appTypes: params.appTypes,
            search: params.search,
            sourceFilter: null,
            cursorTime: null,
            cursorKey: null,
            limit: internalLimit,
          });

          let items = burstsResponse.items.map(buildChangeActivityRow);
          items = filterActivitiesByAppIds(items, params.appIds);
          items = filterActivitiesBySignalFamilies(items, changeSignalFamilies);
          items = filterActivitiesForView(items, params.view);
          items = sortActivities(items, sort);
          return items;
        })(),
    fetchChangeFeedNewsResponse({
      days: params.days,
      historyScope: params.historyScope,
      appIds: params.appIds,
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

  items = filterActivitiesByAppIds(items, params.appIds);
  items = filterActivitiesForView(items, params.view);
  items = filterActivitiesBySignalFamilies(items, params.signalFamilies);
  items = sortActivities(items, sort);

  const pageItems = items.slice(offset, offset + params.limit);
  const nextCursor =
    items.length > offset + params.limit
      ? encodeActivityCursor({ offset: offset + params.limit })
      : null;

  return {
    items: pageItems,
    nextCursor,
    meta: buildActivityMeta({
      ...params,
      sort,
    }),
  };
}

async function fetchTigerChangeFeedActivityResponse(
  params: ChangeFeedActivityParams
): Promise<ChangeFeedActivityResponse> {
  const sort = normalizeChatActivitySort(params);
  const result = await postChangeFeedQueryApi<TigerSearchChangeActivityResponse>(
    '/v1/contracts/search-change-activity',
    {
      allHistory: params.historyScope === 'all' && Boolean(params.appIds?.length),
      appids: params.appIds ?? [],
      appTypes: params.appTypes ?? [],
      continuationToken: params.cursor,
      days: params.days,
      excludeActivityIds: params.excludeActivityIds ?? [],
      limit: params.limit,
      mode: params.mode,
      query: params.search,
      signalFamilies: params.signalFamilies ?? [],
      sort,
      view: params.view,
    },
    { timeoutMs: CHANGE_FEED_QUERY_API_TIMEOUT_MS }
  );

  if (!result.ok || !result.data) {
    throw new ChangeFeedQueryError(
      `Change Feed activity query failed: ${result.reason ?? result.errorCode ?? 'unknown error'}`
    );
  }

  return {
    items: (result.data.items ?? []).map(mapTigerActivityItem),
    nextCursor: result.data.continuationToken,
    meta: buildActivityMeta({
      ...params,
      sort,
    }),
  };
}

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

  let response: ChangeFeedActivityResponse;

  if (shouldUseTigerChangeFeedReads()) {
    try {
      response = await fetchTigerChangeFeedActivityResponse(params);
    } catch (error) {
      if (shouldUseStrictTigerChangeFeedReads()) {
        throw error;
      }

      console.warn('Change Feed activity query failed; falling back to Supabase.', error);
      response = await fetchComposedChangeFeedActivityFallback(params);
    }
  } else {
    try {
      const sort = normalizeChatActivitySort(params);
      const data = await executeChangeFeedRpc<RawChangeActivityRow[]>(
        'get_change_feed_activity',
        buildChangeFeedActivityRpcArgs(params, sort)
      );

      response = {
        items: (data ?? []).map(mapChangeActivityRow),
        nextCursor: buildActivityNextCursor(data ?? [], params.limit),
        meta: buildActivityMeta({
          ...params,
          sort,
        }),
      };
    } catch (error) {
      if (!(error instanceof ChangeFeedUnavailableError)) {
        throw error;
      }

      response = await fetchComposedChangeFeedActivityFallback(params);
    }
  }

  if (isDefaultRequest) {
    defaultActivityCache = {
      data: response,
      cachedAt: Date.now(),
    };
  }

  return response;
}

function toNewsExcerpt(value: string | null): string | null {
  return truncateNewsText(stripNewsBody(value), 260);
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

function mapTigerDetailEvent(event: TigerChangeActivityDetailEvent): ChangeDetailEvent {
  const parsedEventId = Number.parseInt(event.eventId, 10);

  return {
    eventId: Number.isFinite(parsedEventId) ? parsedEventId : 0,
    appid: event.appid,
    source: normalizeTigerSource(event.source),
    changeType: event.changeType,
    occurredAt: event.occurredAt,
    beforeValue: event.beforeValue,
    afterValue: event.afterValue,
    context: event.context ?? {},
  };
}

function mapTigerDetailNews(row: TigerChangeActivityDetailNews): ChangeNewsRow {
  return {
    gid: row.gid,
    appid: row.appid,
    appName: row.appName,
    appType: normalizeTigerAppType(row.appType),
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    title: row.title,
    feedLabel: row.feedLabel,
    feedName: row.feedName,
    url: row.url,
  };
}

async function fetchTigerChangeActivityDetail(
  activityId: string
): Promise<ChangeActivityDetail | null> {
  const result = await postChangeFeedQueryApi<TigerChangeActivityDetailResponse>(
    '/v1/contracts/get-change-activity-detail',
    { activityId },
    { timeoutMs: CHANGE_FEED_QUERY_API_TIMEOUT_MS }
  );

  if (!result.ok || !result.data) {
    throw new ChangeFeedQueryError(
      `Change Feed activity detail query failed: ${result.reason ?? result.errorCode ?? 'unknown error'}`
    );
  }

  const item = result.data.item;
  if (!item) {
    return null;
  }

  const activityRow = mapTigerActivityItem(item.activity);
  const events = item.events.map(mapTigerDetailEvent).sort((left, right) => {
    return left.occurredAt.localeCompare(right.occurredAt) || left.eventId - right.eventId;
  });
  const relatedNews = item.relatedNews.map(mapTigerDetailNews);
  const sourceSet = uniqueSortedStrings(events.map((event) => event.source)) as ChangeFeedSource[];
  const headlineChangeTypes = uniqueSortedStrings(events.map((event) => event.changeType)).slice(0, 3);
  const burstDetail: ChangeBurstDetail = {
    burstId: item.activity.activityId,
    appid: activityRow.appid,
    appName: activityRow.appName,
    appType: activityRow.appType,
    isReleased: activityRow.isReleased,
    releaseDate: activityRow.releaseDate,
    effectiveAt: activityRow.occurredAt,
    burstStartedAt: events[0]?.occurredAt ?? activityRow.occurredAt,
    burstEndedAt: activityRow.occurredAt,
    eventCount: events.length,
    sourceSet,
    headlineChangeTypes,
    changeTypeCount: new Set(events.map((event) => event.changeType)).size,
    hasRelatedNews: relatedNews.length > 0,
    relatedNewsCount: relatedNews.length,
    events,
    relatedNews,
    impact: null,
  };
  const detail = buildChangeActivityDetail(burstDetail);

  return {
    ...detail,
    ...activityRow,
    rawEvents: detail.rawEvents,
    diffs: detail.diffs,
    relatedAnnouncements: detail.relatedAnnouncements,
    aftermath: detail.aftermath,
    body: null,
  };
}

export async function fetchChangeFeedActivityDetail(
  activityId: string
): Promise<ChangeActivityDetail | null> {
  if (shouldUseTigerChangeFeedReads()) {
    try {
      return await fetchTigerChangeActivityDetail(activityId);
    } catch (error) {
      if (shouldUseStrictTigerChangeFeedReads()) {
        throw error;
      }

      console.warn('Change Feed activity detail query failed; falling back to Supabase.', error);
    }
  }

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
