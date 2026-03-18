import type {
  AppType,
  ChangeActivityMode,
  ChangeActivityParamsCursor,
  ChangeActivityRow,
  ChangeActivitySignalFamily,
  ChangeActivitySort,
  ChangeActivityView,
  ChangeBurstDetail,
  ChangeBurstImpact,
  ChangeBurstImpactWindow,
  ChangeBurstRow,
  ChangeDetailEvent,
  ChangeFeedCursor,
  ChangeFeedPreset,
  ChangeFeedSource,
  ChangeNewsRow,
  JsonValue,
  RawChangeActivityRow,
  RawChangeBurstDetailEvent,
  RawChangeBurstDetailRow,
  RawChangeBurstRow,
  RawChangeNewsRow,
} from './change-feed-types';
import {
  CHANGE_ACTIVITY_MODES,
  CHANGE_ACTIVITY_SIGNAL_FAMILIES,
  CHANGE_ACTIVITY_SORTS,
  CHANGE_ACTIVITY_VIEWS,
  CHANGE_FEED_APP_TYPES,
  CHANGE_FEED_PRESETS,
  CHANGE_FEED_SOURCES,
} from './change-feed-types';

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CHANGE_FEED_SQL_PRESET_MAP: Record<ChangeFeedPreset, string> = {
  'high-signal': 'high_signal',
  'upcoming-radar': 'upcoming_radar',
  'all-changes': 'all_changes',
};

function parseInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function parseStringList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function filterAppTypes(values: string[]): AppType[] | null {
  if (values.length === 0) {
    return null;
  }

  const allowed = new Set<AppType>(CHANGE_FEED_APP_TYPES);
  const filtered = values.filter((value): value is AppType => allowed.has(value as AppType));
  return filtered.length > 0 ? filtered : null;
}

function filterSources(values: string[]): ChangeFeedSource[] | null {
  if (values.length === 0) {
    return null;
  }

  const allowed = new Set<ChangeFeedSource>(CHANGE_FEED_SOURCES);
  const filtered = values.filter(
    (value): value is ChangeFeedSource => allowed.has(value as ChangeFeedSource)
  );
  return filtered.length > 0 ? filtered : null;
}

function filterSignalFamilies(values: string[]): ChangeActivitySignalFamily[] | null {
  if (values.length === 0) {
    return null;
  }

  const allowed = new Set<ChangeActivitySignalFamily>(CHANGE_ACTIVITY_SIGNAL_FAMILIES);
  const filtered = values.filter(
    (value): value is ChangeActivitySignalFamily =>
      allowed.has(value as ChangeActivitySignalFamily)
  );

  return filtered.length > 0 ? filtered : null;
}

function normalizeCursor(value: string | null): string | null {
  const normalized = normalizeText(value);
  return normalized ? decodeURIComponent(normalized) : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toJsonRecord(
  value: Record<string, JsonValue | undefined> | null | undefined
): Record<string, JsonValue | undefined> {
  return value ?? {};
}

export function parseChangeFeedPreset(value: string | null): ChangeFeedPreset {
  if (!value) {
    return 'high-signal';
  }

  const normalized = value.trim().replace(/_/g, '-');
  return CHANGE_FEED_PRESETS.includes(normalized as ChangeFeedPreset)
    ? (normalized as ChangeFeedPreset)
    : 'high-signal';
}

export function parseChangeActivityView(value: string | null | undefined): ChangeActivityView {
  if (!value) {
    return 'overview';
  }

  const normalized = value.trim().replace(/_/g, '-');
  return CHANGE_ACTIVITY_VIEWS.includes(normalized as ChangeActivityView)
    ? (normalized as ChangeActivityView)
    : 'overview';
}

export function parseChangeActivityMode(value: string | null | undefined): ChangeActivityMode {
  if (!value) {
    return 'all';
  }

  const normalized = value.trim().replace(/_/g, '-');
  return CHANGE_ACTIVITY_MODES.includes(normalized as ChangeActivityMode)
    ? (normalized as ChangeActivityMode)
    : 'all';
}

export function parseChangeActivitySort(value: string | null | undefined): ChangeActivitySort {
  if (!value) {
    return 'relevant';
  }

  const normalized = value.trim().replace(/_/g, '-');
  return CHANGE_ACTIVITY_SORTS.includes(normalized as ChangeActivitySort)
    ? (normalized as ChangeActivitySort)
    : 'relevant';
}

export function getDefaultChangeActivitySort(view: ChangeActivityView): ChangeActivitySort {
  switch (view) {
    case 'launch-watch':
    case 'all-activity':
      return 'newest';
    default:
      return 'relevant';
  }
}

export function resolveChangeActivitySort(
  value: string | null | undefined,
  view: ChangeActivityView
): ChangeActivitySort {
  const parsed = parseChangeActivitySort(value);

  if (!value) {
    return getDefaultChangeActivitySort(view);
  }

  if (view === 'all-activity' && parsed === 'relevant') {
    return 'newest';
  }

  return parsed;
}

export function toSqlChangeFeedPreset(preset: ChangeFeedPreset): string {
  return CHANGE_FEED_SQL_PRESET_MAP[preset];
}

export interface ChangeFeedBurstParams {
  days: number;
  preset: ChangeFeedPreset;
  appTypes: AppType[] | null;
  search: string | null;
  sourceFilter: ChangeFeedSource[] | null;
  cursorTime: string | null;
  cursorKey: string | null;
  limit: number;
}

export interface ChangeFeedActivityParams {
  days: number;
  view: ChangeActivityView;
  mode: ChangeActivityMode;
  sort: ChangeActivitySort;
  appTypes: AppType[] | null;
  signalFamilies: ChangeActivitySignalFamily[] | null;
  search: string | null;
  cursor: string | null;
  limit: number;
}

export function parseChangeFeedActivityParams(
  searchParams: URLSearchParams
): ChangeFeedActivityParams {
  const days = Math.min(Math.max(parseInteger(searchParams.get('days'), DEFAULT_DAYS), 1), 30);
  const limit = Math.min(
    Math.max(parseInteger(searchParams.get('limit'), DEFAULT_LIMIT), 1),
    MAX_LIMIT
  );
  const view = parseChangeActivityView(searchParams.get('view'));

  return {
    days,
    view,
    mode: parseChangeActivityMode(searchParams.get('mode')),
    sort: resolveChangeActivitySort(searchParams.get('sort'), view),
    appTypes: filterAppTypes(parseStringList(searchParams.get('appTypes'))),
    signalFamilies: filterSignalFamilies(parseStringList(searchParams.get('signals'))),
    search: normalizeText(searchParams.get('search')),
    cursor: normalizeCursor(searchParams.get('cursor')),
    limit,
  };
}

export function parseChangeFeedBurstParams(searchParams: URLSearchParams): ChangeFeedBurstParams {
  const days = Math.min(Math.max(parseInteger(searchParams.get('days'), DEFAULT_DAYS), 1), 30);
  const limit = Math.min(Math.max(parseInteger(searchParams.get('limit'), DEFAULT_LIMIT), 1), MAX_LIMIT);
  const appTypes = filterAppTypes(parseStringList(searchParams.get('appTypes')));
  const sourceFilter = filterSources(parseStringList(searchParams.get('source')));

  return {
    days,
    preset: parseChangeFeedPreset(searchParams.get('preset')),
    appTypes,
    search: normalizeText(searchParams.get('search')),
    sourceFilter,
    cursorTime: normalizeText(searchParams.get('cursorTime')),
    cursorKey: normalizeCursor(searchParams.get('cursorKey')),
    limit,
  };
}

export interface ChangeFeedNewsParams {
  days: number;
  appTypes: AppType[] | null;
  search: string | null;
  cursorTime: string | null;
  cursorKey: string | null;
  limit: number;
}

export function parseChangeFeedNewsParams(searchParams: URLSearchParams): ChangeFeedNewsParams {
  const days = Math.min(Math.max(parseInteger(searchParams.get('days'), DEFAULT_DAYS), 1), 30);
  const limit = Math.min(Math.max(parseInteger(searchParams.get('limit'), DEFAULT_LIMIT), 1), MAX_LIMIT);

  return {
    days,
    appTypes: filterAppTypes(parseStringList(searchParams.get('appTypes'))),
    search: normalizeText(searchParams.get('search')),
    cursorTime: normalizeText(searchParams.get('cursorTime')),
    cursorKey: normalizeCursor(searchParams.get('cursorKey')),
    limit,
  };
}

export function mapChangeBurstRow(row: RawChangeBurstRow): ChangeBurstRow {
  return {
    burstId: row.burst_id,
    appid: row.appid,
    appName: row.app_name,
    appType: row.app_type,
    isReleased: row.is_released,
    releaseDate: row.release_date,
    effectiveAt: row.effective_at,
    burstStartedAt: row.burst_started_at,
    burstEndedAt: row.burst_ended_at,
    eventCount: row.event_count,
    sourceSet: filterSources(toStringArray(row.source_set)) ?? [],
    headlineChangeTypes: toStringArray(row.headline_change_types),
    changeTypeCount: row.change_type_count,
    hasRelatedNews: row.has_related_news,
    relatedNewsCount: row.related_news_count,
  };
}

export function mapChangeNewsRow(row: RawChangeNewsRow): ChangeNewsRow {
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
  };
}

function toSafeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function mapChangeActivityRow(row: RawChangeActivityRow): ChangeActivityRow {
  return {
    activityId: row.activity_id,
    activityKind: row.activity_kind,
    storyKind: row.story_kind,
    appid: row.appid,
    appName: row.app_name,
    appType: row.app_type,
    isReleased: row.is_released,
    releaseDate: row.release_date,
    occurredAt: row.occurred_at,
    headline: row.headline,
    summary: row.summary,
    facts: toSafeStringArray(row.facts),
    highlightLabels: toSafeStringArray(row.highlight_labels),
    signalFamilies:
      filterSignalFamilies(toSafeStringArray(row.signal_families)) ?? [],
    hasBeforeAfter: row.has_before_after,
    relatedAnnouncementCount: row.related_announcement_count,
    externalUrl: row.external_url,
  };
}

function mapChangeDetailEvent(event: RawChangeBurstDetailEvent): ChangeDetailEvent {
  return {
    eventId: event.event_id,
    appid: event.appid,
    source: event.source,
    changeType: event.change_type,
    occurredAt: event.occurred_at,
    beforeValue: event.before_value,
    afterValue: event.after_value,
    context: toJsonRecord(event.context),
  };
}

function toNumberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function toStringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function mapImpactWindow(value: JsonValue | undefined): ChangeBurstImpactWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, JsonValue | undefined>;

  return {
    ccuPeak: toNumberOrNull(record.ccu_peak),
    totalReviews: toNumberOrNull(record.total_reviews),
    positiveReviews: toNumberOrNull(record.positive_reviews),
    negativeReviews: toNumberOrNull(record.negative_reviews),
    reviewScore: toNumberOrNull(record.review_score),
    reviewScoreLabel: toStringOrNull(record.review_score_label),
    priceCents: toNumberOrNull(record.price_cents),
    discountPercent: toNumberOrNull(record.discount_percent),
  };
}

function mapImpact(value: Record<string, JsonValue | undefined> | null): ChangeBurstImpact | null {
  if (!value) {
    return null;
  }

  return {
    baseline7d: mapImpactWindow(value.baseline_7d),
    response1d: mapImpactWindow(value.response_1d),
    response7d: mapImpactWindow(value.response_7d),
  };
}

export function mapChangeBurstDetail(row: RawChangeBurstDetailRow): ChangeBurstDetail {
  const base = mapChangeBurstRow(row);

  return {
    ...base,
    events: (row.events ?? []).map(mapChangeDetailEvent),
    relatedNews: (row.related_news ?? []).map(mapChangeNewsRow),
    impact: mapImpact(row.impact),
  };
}

export function buildNextCursor(
  items: Array<{ effectiveAt?: string | null; publishedAt?: string | null; burstId?: string; gid?: string }>,
  limit: number
): ChangeFeedCursor | null {
  if (items.length < limit || items.length === 0) {
    return null;
  }

  const lastItem = items[items.length - 1];
  const time = lastItem.effectiveAt ?? lastItem.publishedAt ?? null;
  const key = lastItem.burstId ?? lastItem.gid ?? null;

  if (!time || !key) {
    return null;
  }

  return { time, key };
}

export function encodeActivityCursor(cursor: { offset: number }): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodeActivityCursor(value: string | null): { offset: number } {
  if (!value) {
    return { offset: 0 };
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as {
      offset?: unknown;
    };
    const offset =
      typeof parsed.offset === 'number' && Number.isFinite(parsed.offset) && parsed.offset >= 0
        ? parsed.offset
        : 0;
    return { offset };
  } catch {
    return { offset: 0 };
  }
}

export function encodeActivityScoreCursor(cursor: ChangeActivityParamsCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodeActivityScoreCursor(value: string | null): ChangeActivityParamsCursor | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as {
      score?: unknown;
      time?: unknown;
      id?: unknown;
    };

    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.time !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }

    return {
      score: parsed.score,
      time: parsed.time,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

export function isMissingChangeFeedRpcError(
  error: { code?: string | null; message?: string | null } | null,
  functionName: string
): boolean {
  if (!error) {
    return false;
  }

  const message = (error.message ?? '').toLowerCase();
  const normalizedName = functionName.toLowerCase();

  return (
    error.code === 'PGRST202' ||
    message.includes(normalizedName) ||
    message.includes('schema cache') ||
    message.includes('could not find the function')
  );
}
