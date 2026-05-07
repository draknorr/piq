import 'server-only';

import { runTigerQuery } from '@publisheriq/database';
import type {
  AdultFilter,
  FilterMode,
  FilterOption,
  PublisherStatus,
  RecentChange,
  RecentNews,
  ReleaseStatus,
  SortOrder,
  UnreleasedFilters,
  UnreleasedGame,
  UnreleasedGameDetail,
  UnreleasedSearchParams,
  UnreleasedSortField,
  UnreleasedStats,
  UnreleasedTimelineItem,
  UnreleasedTimelineResult,
} from './unreleased-types';

type SqlValue = string | number | boolean | readonly number[] | readonly string[];
type UnreleasedRow = Record<string, unknown> & { appid: number; name: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;

const statsCache = new Map<string, { data: UnreleasedStats; timestamp: number }>();
let projectionAvailable: boolean | null = null;
let filterCountProjectionAvailable: boolean | null = null;

const VALID_SORT_FIELDS = new Set<UnreleasedSortField>([
  'opportunity_score',
  'latest_added_at',
  'release_date',
  'name',
  'publisher_name',
  'developer_name',
  'primary_tag_name',
  'primary_category_name',
  'latest_news_at',
  'latest_change_at',
  'change_count_30d',
  'screenshot_count',
  'movie_count',
]);

const SORT_SQL: Record<UnreleasedSortField, string> = {
  opportunity_score: 'p.opportunity_score',
  latest_added_at: 'p.latest_added_at',
  release_date: 'p.release_date',
  name: 'p.name',
  publisher_name: 'p.publisher_name',
  developer_name: 'p.developer_name',
  primary_tag_name: 'p.primary_tag_name',
  primary_category_name: 'p.primary_category_name',
  latest_news_at: 'p.latest_news_at',
  latest_change_at: 'p.latest_change_at',
  change_count_30d: 'p.change_count_30d',
  screenshot_count: 'p.screenshot_count',
  movie_count: 'p.movie_count',
};

const STRING_ARRAY_FILTERS = new Set(['platforms', 'signalFamilies']);

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === 't' || value === '1';
  return false;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addParam(values: SqlValue[], value: SqlValue): string {
  values.push(value);
  return `$${values.length}`;
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  return Math.max(Math.floor(offset ?? 0), 0);
}

export function isTigerReadConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TIGER_PRIMARY_URL || env.CHANGE_INTEL_TIGER_URL);
}

export function normalizeSort(value: string | undefined): UnreleasedSortField {
  return VALID_SORT_FIELDS.has(value as UnreleasedSortField)
    ? (value as UnreleasedSortField)
    : 'opportunity_score';
}

export function normalizeOrder(value: string | undefined): SortOrder {
  return value === 'asc' ? 'asc' : 'desc';
}

export function normalizeAdultFilter(value: string | undefined): AdultFilter {
  if (value === 'include' || value === 'only') return value;
  return 'exclude';
}

export function parseNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseBoolean(value: string | null | undefined): boolean | undefined {
  if (!value) return undefined;
  return value === 'true';
}

export function parseNumberList(value: string | null | undefined): number[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item));
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

export function parseStringList(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

export function parseFilterMode(value: string | null | undefined): FilterMode {
  return value === 'any' ? 'any' : 'all';
}

export function parseReleaseStatuses(value: string | null | undefined): ReleaseStatus[] | undefined {
  const allowed = new Set<ReleaseStatus>(['dated_future', 'undated', 'stale_past_date']);
  const items = parseStringList(value)?.filter((item): item is ReleaseStatus =>
    allowed.has(item as ReleaseStatus)
  );
  return items && items.length > 0 ? items : undefined;
}

export function parsePublisherStatuses(value: string | null | undefined): PublisherStatus[] | undefined {
  const allowed = new Set<PublisherStatus>([
    'no_publisher',
    'self_published',
    'small_publisher',
    'established_publisher',
  ]);
  const items = parseStringList(value)?.filter((item): item is PublisherStatus =>
    allowed.has(item as PublisherStatus)
  );
  return items && items.length > 0 ? items : undefined;
}

export function buildUnreleasedFiltersFromUrlSearchParams(
  searchParams: URLSearchParams
): UnreleasedFilters {
  return {
    sort: normalizeSort(searchParams.get('sort') ?? undefined),
    order: normalizeOrder(searchParams.get('order') ?? undefined),
    limit: parseNumber(searchParams.get('limit')) ?? DEFAULT_LIMIT,
    offset: parseNumber(searchParams.get('offset')) ?? 0,
    search: searchParams.get('search') || undefined,
    adult: normalizeAdultFilter(searchParams.get('adult') ?? undefined),
    releaseStatuses: parseReleaseStatuses(searchParams.get('releaseStatus')),
    publisherStatuses: parsePublisherStatuses(searchParams.get('publisherStatus')),
    publisherSearch: searchParams.get('publisherSearch') || undefined,
    developerSearch: searchParams.get('developerSearch') || undefined,
    minDaysUntilRelease: parseNumber(searchParams.get('minDaysUntilRelease')),
    maxDaysUntilRelease: parseNumber(searchParams.get('maxDaysUntilRelease')),
    minOpportunityScore: parseNumber(searchParams.get('minOpportunityScore')),
    minChanges30d: parseNumber(searchParams.get('minChanges30d')),
    minNewsDays: parseNumber(searchParams.get('minNewsDays')),
    hasNews: parseBoolean(searchParams.get('hasNews')),
    hasRecentChange: parseBoolean(searchParams.get('hasRecentChange')),
    hasScreenshots: parseBoolean(searchParams.get('hasScreenshots')),
    hasTrailers: parseBoolean(searchParams.get('hasTrailers')),
    hasPurchasePackages: parseBoolean(searchParams.get('hasPurchasePackages')),
    isFree: parseBoolean(searchParams.get('isFree')),
    hasWorkshop: parseBoolean(searchParams.get('hasWorkshop')),
    genres: parseNumberList(searchParams.get('genres')),
    genreMode: parseFilterMode(searchParams.get('genreMode')),
    tags: parseNumberList(searchParams.get('tags')),
    tagMode: parseFilterMode(searchParams.get('tagMode')),
    categories: parseNumberList(searchParams.get('categories')),
    categoryMode: parseFilterMode(searchParams.get('categoryMode')),
    platforms: parseStringList(searchParams.get('platforms')),
    platformMode: parseFilterMode(searchParams.get('platformMode')),
    signalFamilies: parseStringList(searchParams.get('signalFamilies')),
    signalMode: parseFilterMode(searchParams.get('signalMode')),
  };
}

export function buildUnreleasedFiltersFromPageParams(
  params: UnreleasedSearchParams
): UnreleasedFilters {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      searchParams.set(key, value);
    }
  });
  return buildUnreleasedFiltersFromUrlSearchParams(searchParams);
}

async function hasUnreleasedProjection(): Promise<boolean> {
  if (projectionAvailable !== null) return projectionAvailable;
  const { rows } = await runTigerQuery<{ exists: boolean }>(
    `SELECT to_regclass('metrics.unreleased_games_projection') IS NOT NULL AS exists`,
    []
  );
  const exists = rows[0]?.exists === true;
  if (exists) {
    projectionAvailable = true;
  }
  return exists;
}

async function hasUnreleasedFilterCounts(): Promise<boolean> {
  if (filterCountProjectionAvailable !== null) return filterCountProjectionAvailable;
  const { rows } = await runTigerQuery<{ exists: boolean }>(
    `SELECT to_regclass('metrics.unreleased_filter_counts') IS NOT NULL AS exists`,
    []
  );
  const exists = rows[0]?.exists === true;
  if (exists) {
    filterCountProjectionAvailable = true;
  }
  return exists;
}

function assertArrayParam(field: 'genres' | 'tags' | 'categories' | 'platforms' | 'signalFamilies'): void {
  if (!['genres', 'tags', 'categories', 'platforms', 'signalFamilies'].includes(field)) {
    throw new Error(`Unsupported array filter: ${field}`);
  }
}

function addArrayPredicate(
  where: string[],
  values: SqlValue[],
  field: 'genres' | 'tags' | 'categories' | 'platforms' | 'signalFamilies',
  column: string,
  items: readonly number[] | readonly string[] | undefined,
  mode: FilterMode | undefined
): void {
  assertArrayParam(field);
  if (!items || items.length === 0) return;

  const placeholder = addParam(values, items);
  const type = STRING_ARRAY_FILTERS.has(field) ? 'text' : 'int';
  where.push(mode === 'any'
    ? `${column} && ${placeholder}::${type}[]`
    : `${column} @> ${placeholder}::${type}[]`);
}

function buildWhere(params: UnreleasedFilters, values: SqlValue[]): string {
  const where: string[] = [];

  const adult = params.adult ?? 'exclude';
  if (adult === 'exclude') where.push('p.is_adult_content = false');
  if (adult === 'only') where.push('p.is_adult_content = true');

  if (params.search) {
    const search = params.search.trim();
    const appid = Number(search);
    if (Number.isInteger(appid) && appid > 0) {
      where.push(`(
        p.appid = ${addParam(values, appid)}
        OR p.name_lower LIKE lower(${addParam(values, `%${search}%`)})
        OR p.publisher_name ILIKE ${addParam(values, `%${search}%`)}
        OR p.developer_name ILIKE ${addParam(values, `%${search}%`)}
      )`);
    } else {
      const placeholder = addParam(values, `%${search}%`);
      where.push(`(
        p.name_lower LIKE lower(${placeholder})
        OR p.publisher_name ILIKE ${placeholder}
        OR p.developer_name ILIKE ${placeholder}
      )`);
    }
  }

  if (params.releaseStatuses?.length) {
    where.push(`p.release_status = ANY(${addParam(values, params.releaseStatuses)}::text[])`);
  }
  if (params.publisherStatuses?.length) {
    where.push(`p.publisher_status = ANY(${addParam(values, params.publisherStatuses)}::text[])`);
  }
  if (params.publisherSearch) {
    where.push(`p.publisher_name ILIKE ${addParam(values, `%${params.publisherSearch.trim()}%`)}`);
  }
  if (params.developerSearch) {
    where.push(`p.developer_name ILIKE ${addParam(values, `%${params.developerSearch.trim()}%`)}`);
  }

  const ranges: Array<[number | undefined, string, string]> = [
    [params.minDaysUntilRelease, 'p.days_until_release', '>='],
    [params.maxDaysUntilRelease, 'p.days_until_release', '<='],
    [params.minOpportunityScore, 'p.opportunity_score', '>='],
    [params.minChanges30d, 'p.change_count_30d', '>='],
  ];

  for (const [value, column, operator] of ranges) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      where.push(`${column} ${operator} ${addParam(values, value)}`);
    }
  }

  if (typeof params.minNewsDays === 'number' && Number.isFinite(params.minNewsDays)) {
    where.push(`p.latest_news_at >= now() - (${addParam(values, params.minNewsDays)}::integer * INTERVAL '1 day')`);
  }
  if (typeof params.hasNews === 'boolean') {
    where.push(params.hasNews ? 'p.latest_news_at IS NOT NULL' : 'p.latest_news_at IS NULL');
  }
  if (typeof params.hasRecentChange === 'boolean') {
    where.push(params.hasRecentChange ? 'p.latest_change_at IS NOT NULL' : 'p.latest_change_at IS NULL');
  }
  if (typeof params.hasScreenshots === 'boolean') {
    where.push(params.hasScreenshots ? 'p.screenshot_count > 0' : 'p.screenshot_count = 0');
  }
  if (typeof params.hasTrailers === 'boolean') {
    where.push(params.hasTrailers ? 'p.movie_count > 0' : 'p.movie_count = 0');
  }
  if (typeof params.hasPurchasePackages === 'boolean') {
    where.push(`p.has_purchase_packages = ${addParam(values, params.hasPurchasePackages)}`);
  }
  if (typeof params.isFree === 'boolean') {
    where.push(`p.is_free = ${addParam(values, params.isFree)}`);
  }
  if (typeof params.hasWorkshop === 'boolean') {
    where.push(`p.has_workshop = ${addParam(values, params.hasWorkshop)}`);
  }

  addArrayPredicate(where, values, 'genres', 'p.genre_ids', params.genres, params.genreMode);
  addArrayPredicate(where, values, 'tags', 'p.tag_ids', params.tags, params.tagMode);
  addArrayPredicate(where, values, 'categories', 'p.category_ids', params.categories, params.categoryMode);
  addArrayPredicate(where, values, 'platforms', 'p.platform_array', params.platforms, params.platformMode);
  addArrayPredicate(where, values, 'signalFamilies', 'p.signal_families_30d', params.signalFamilies, params.signalMode);

  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}

function statsCacheKey(params: UnreleasedFilters): string {
  const copy: UnreleasedFilters = {
    ...params,
    limit: undefined,
    offset: undefined,
    sort: 'opportunity_score',
    order: 'desc',
  };
  return JSON.stringify(Object.entries(copy).filter(([, value]) => value !== undefined).sort());
}

function readStatsCache(key: string): UnreleasedStats | null {
  const cached = statsCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    statsCache.delete(key);
    return null;
  }
  return cached.data;
}

function writeStatsCache(key: string, data: UnreleasedStats): void {
  if (statsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = statsCache.keys().next().value as string | undefined;
    if (oldestKey) statsCache.delete(oldestKey);
  }
  statsCache.set(key, { data, timestamp: Date.now() });
}

export function mapUnreleasedRow(row: UnreleasedRow): UnreleasedGame {
  return {
    appid: Number(row.appid),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'game'),
    release_date: toIsoDate(row.release_date),
    release_date_raw: typeof row.release_date_raw === 'string' ? row.release_date_raw : null,
    release_status: (row.release_status as ReleaseStatus | undefined) ?? 'undated',
    days_until_release: toNumber(row.days_until_release),
    latest_added_at: toIsoDate(row.latest_added_at),
    is_free: toBoolean(row.is_free),
    current_price_cents: toNumber(row.current_price_cents),
    current_discount_percent: toNumber(row.current_discount_percent) ?? 0,
    has_purchase_packages: toBoolean(row.has_purchase_packages),
    has_workshop: toBoolean(row.has_workshop),
    release_state: typeof row.release_state === 'string' ? row.release_state : null,
    app_state: typeof row.app_state === 'string' ? row.app_state : null,
    platforms: typeof row.platforms === 'string' ? row.platforms : null,
    platform_array: toStringArray(row.platform_array),
    controller_support: typeof row.controller_support === 'string' ? row.controller_support : null,
    is_adult_content: toBoolean(row.is_adult_content),
    publisher_id: toNumber(row.publisher_id),
    publisher_name: typeof row.publisher_name === 'string' ? row.publisher_name : null,
    publisher_steam_vanity_url: typeof row.publisher_steam_vanity_url === 'string' ? row.publisher_steam_vanity_url : null,
    publisher_game_count: toNumber(row.publisher_game_count),
    publisher_released_game_count: toNumber(row.publisher_released_game_count) ?? 0,
    publisher_total_owners: toNumber(row.publisher_total_owners) ?? 0,
    publisher_max_game_reviews: toNumber(row.publisher_max_game_reviews) ?? 0,
    developer_id: toNumber(row.developer_id),
    developer_name: typeof row.developer_name === 'string' ? row.developer_name : null,
    developer_steam_vanity_url: typeof row.developer_steam_vanity_url === 'string' ? row.developer_steam_vanity_url : null,
    developer_game_count: toNumber(row.developer_game_count),
    is_self_published: toBoolean(row.is_self_published),
    publisher_status: (row.publisher_status as PublisherStatus | undefined) ?? 'no_publisher',
    genre_ids: toNumberArray(row.genre_ids),
    genre_names: toStringArray(row.genre_names),
    tag_ids: toNumberArray(row.tag_ids),
    tag_names: toStringArray(row.tag_names),
    primary_tag_name: typeof row.primary_tag_name === 'string' ? row.primary_tag_name : null,
    category_ids: toNumberArray(row.category_ids),
    category_names: toStringArray(row.category_names),
    primary_category_name: typeof row.primary_category_name === 'string' ? row.primary_category_name : null,
    screenshot_count: toNumber(row.screenshot_count) ?? 0,
    movie_count: toNumber(row.movie_count) ?? 0,
    latest_storefront_snapshot_at: toIsoDate(row.latest_storefront_snapshot_at),
    latest_news_at: toIsoDate(row.latest_news_at),
    latest_news_title: typeof row.latest_news_title === 'string' ? row.latest_news_title : null,
    latest_news_url: typeof row.latest_news_url === 'string' ? row.latest_news_url : null,
    latest_change_at: toIsoDate(row.latest_change_at),
    latest_change_type: typeof row.latest_change_type === 'string' ? row.latest_change_type : null,
    latest_change_summary: typeof row.latest_change_summary === 'string' ? row.latest_change_summary : null,
    latest_activity_at: toIsoDate(row.latest_activity_at),
    signal_families_30d: toStringArray(row.signal_families_30d),
    story_kinds_30d: toStringArray(row.story_kinds_30d),
    announcement_count_30d: toNumber(row.announcement_count_30d) ?? 0,
    change_count_30d: toNumber(row.change_count_30d) ?? 0,
    release_count_30d: toNumber(row.release_count_30d) ?? 0,
    pricing_count_30d: toNumber(row.pricing_count_30d) ?? 0,
    store_page_count_30d: toNumber(row.store_page_count_30d) ?? 0,
    media_count_30d: toNumber(row.media_count_30d) ?? 0,
    taxonomy_count_30d: toNumber(row.taxonomy_count_30d) ?? 0,
    platform_count_30d: toNumber(row.platform_count_30d) ?? 0,
    build_count_30d: toNumber(row.build_count_30d) ?? 0,
    opportunity_score: toNumber(row.opportunity_score) ?? 0,
    data_updated_at: toIsoDate(row.data_updated_at),
    projection_refreshed_at: toIsoDate(row.projection_refreshed_at),
  };
}

export async function getUnreleasedGames(params: UnreleasedFilters): Promise<UnreleasedGame[]> {
  if (!(await hasUnreleasedProjection())) {
    throw new Error('The unreleased games projection is not available. Apply the unreleased games page projection before using /unreleased.');
  }

  const values: SqlValue[] = [];
  const whereSql = buildWhere(params, values);
  const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
  const sortSql = SORT_SQL[params.sort] ?? SORT_SQL.opportunity_score;
  const limitSql = addParam(values, normalizeLimit(params.limit));
  const offsetSql = addParam(values, normalizeOffset(params.offset));
  const nullsSql = params.order === 'asc' ? 'NULLS LAST' : 'NULLS LAST';

  const { rows } = await runTigerQuery<UnreleasedRow>(
    `
      SELECT p.*
      FROM metrics.unreleased_games_projection p
      ${whereSql}
      ORDER BY ${sortSql} ${orderSql} ${nullsSql}, p.appid ASC
      LIMIT ${limitSql} OFFSET ${offsetSql}
    `,
    values as unknown[]
  );

  return rows.map(mapUnreleasedRow);
}

export async function getUnreleasedStats(params: UnreleasedFilters): Promise<UnreleasedStats> {
  if (!(await hasUnreleasedProjection())) {
    throw new Error('The unreleased games projection is not available. Apply the unreleased games page projection before using /unreleased.');
  }

  const key = statsCacheKey(params);
  const cached = readStatsCache(key);
  if (cached) return cached;

  const values: SqlValue[] = [];
  const whereSql = buildWhere(params, values);
  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      SELECT
        COUNT(*)::integer AS total_games,
        COUNT(*) FILTER (WHERE p.release_status = 'dated_future')::integer AS dated_future_count,
        COUNT(*) FILTER (WHERE p.release_status = 'undated')::integer AS undated_count,
        COUNT(*) FILTER (WHERE p.release_status = 'stale_past_date')::integer AS stale_past_date_count,
        COUNT(*) FILTER (WHERE p.change_count_30d > 0)::integer AS active_30d_count,
        COUNT(*) FILTER (WHERE p.latest_news_at >= now() - INTERVAL '30 days')::integer AS news_30d_count,
        COUNT(*) FILTER (WHERE p.is_adult_content = true)::integer AS adult_count,
        COUNT(*) FILTER (WHERE p.publisher_status = 'no_publisher')::integer AS no_publisher_count,
        COUNT(*) FILTER (WHERE p.publisher_status = 'self_published')::integer AS self_published_count,
        COUNT(*) FILTER (WHERE p.publisher_status = 'small_publisher')::integer AS small_publisher_count,
        AVG(p.opportunity_score)::numeric AS avg_opportunity_score,
        MAX(p.projection_refreshed_at) AS projection_refreshed_at
      FROM metrics.unreleased_games_projection p
      ${whereSql}
    `,
    values as unknown[]
  );

  const row = rows[0] ?? {};
  const stats: UnreleasedStats = {
    total_games: toNumber(row.total_games) ?? 0,
    dated_future_count: toNumber(row.dated_future_count) ?? 0,
    undated_count: toNumber(row.undated_count) ?? 0,
    stale_past_date_count: toNumber(row.stale_past_date_count) ?? 0,
    active_30d_count: toNumber(row.active_30d_count) ?? 0,
    news_30d_count: toNumber(row.news_30d_count) ?? 0,
    adult_count: toNumber(row.adult_count) ?? 0,
    no_publisher_count: toNumber(row.no_publisher_count) ?? 0,
    self_published_count: toNumber(row.self_published_count) ?? 0,
    small_publisher_count: toNumber(row.small_publisher_count) ?? 0,
    avg_opportunity_score: toNumber(row.avg_opportunity_score),
    projection_refreshed_at: toIsoDate(row.projection_refreshed_at),
  };
  writeStatsCache(key, stats);
  return stats;
}

export async function getUnreleasedFilterOptions(
  filterType: 'genre' | 'tag' | 'category',
  params: UnreleasedFilters
): Promise<FilterOption[]> {
  if (!(await hasUnreleasedProjection())) {
    throw new Error('The unreleased games projection is not available.');
  }

  const defaultFilterCountsAvailable = await hasUnreleasedFilterCounts();
  const defaultRequest =
    defaultFilterCountsAvailable &&
    filterType &&
    (params.adult ?? 'exclude') === 'exclude' &&
    !params.search &&
    !params.releaseStatuses?.length &&
    !params.publisherStatuses?.length &&
    !params.publisherSearch &&
    !params.developerSearch &&
    params.minDaysUntilRelease === undefined &&
    params.maxDaysUntilRelease === undefined &&
    params.minOpportunityScore === undefined &&
    params.minChanges30d === undefined &&
    params.minNewsDays === undefined &&
    params.hasNews === undefined &&
    params.hasRecentChange === undefined &&
    params.hasScreenshots === undefined &&
    params.hasTrailers === undefined &&
    params.hasPurchasePackages === undefined &&
    params.isFree === undefined &&
    params.hasWorkshop === undefined &&
    !params.genres?.length &&
    !params.tags?.length &&
    !params.categories?.length &&
    !params.platforms?.length &&
    !params.signalFamilies?.length;

  if (defaultRequest) {
    const joinTable = filterType === 'genre'
      ? 'legacy.steam_genres'
      : filterType === 'tag'
        ? 'legacy.steam_tags'
        : 'legacy.steam_categories';
    const idColumn = filterType === 'genre'
      ? 'genre_id'
      : filterType === 'tag'
        ? 'tag_id'
        : 'category_id';
    const { rows } = await runTigerQuery<Record<string, unknown>>(
      `
        SELECT fc.option_id, lookup.name AS option_name, fc.app_count
        FROM metrics.unreleased_filter_counts fc
        JOIN ${joinTable} lookup ON lookup.${idColumn} = fc.option_id
        WHERE fc.filter_type = $1
        ORDER BY fc.app_count DESC, lookup.name
        LIMIT 100
      `,
      [filterType]
    );
    return rows.map((row) => ({
      option_id: toNumber(row.option_id) ?? 0,
      option_name: String(row.option_name ?? ''),
      app_count: toNumber(row.app_count) ?? 0,
    }));
  }

  const values: SqlValue[] = [];
  const whereSql = buildWhere(params, values);
  const config = {
    genre: {
      id: 'genre_id',
      ids: 'p.genre_ids',
      table: 'legacy.steam_genres',
    },
    tag: {
      id: 'tag_id',
      ids: 'p.tag_ids',
      table: 'legacy.steam_tags',
    },
    category: {
      id: 'category_id',
      ids: 'p.category_ids',
      table: 'legacy.steam_categories',
    },
  }[filterType];

  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      WITH filtered AS (
        SELECT ${config.ids} AS ids
        FROM metrics.unreleased_games_projection p
        ${whereSql}
      )
      SELECT lookup.${config.id} AS option_id, lookup.name AS option_name, COUNT(*)::integer AS app_count
      FROM filtered f
      CROSS JOIN LATERAL unnest(f.ids) AS x(option_id)
      JOIN ${config.table} lookup ON lookup.${config.id} = x.option_id
      GROUP BY lookup.${config.id}, lookup.name
      ORDER BY app_count DESC, lookup.name
      LIMIT 100
    `,
    values as unknown[]
  );

  return rows.map((row) => ({
    option_id: toNumber(row.option_id) ?? 0,
    option_name: String(row.option_name ?? ''),
    app_count: toNumber(row.app_count) ?? 0,
  }));
}

export async function getUnreleasedGameDetail(appid: number): Promise<UnreleasedGameDetail | null> {
  if (!(await hasUnreleasedProjection())) {
    throw new Error('The unreleased games projection is not available.');
  }

  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      SELECT
        to_jsonb(p) AS game,
        COALESCE(media.hero_assets, '{}'::jsonb) AS hero_assets,
        COALESCE(media.screenshots, '[]'::jsonb) AS screenshots,
        COALESCE(media.trailers, '[]'::jsonb) AS trailers,
        COALESCE(changes.items, '[]'::jsonb) AS recent_changes,
        COALESCE(news.items, '[]'::jsonb) AS recent_news
      FROM metrics.unreleased_games_projection p
      LEFT JOIN LATERAL (
        SELECT hero_assets, screenshots, trailers
        FROM docs.app_media_versions
        WHERE appid = p.appid
        ORDER BY first_seen_at DESC, id DESC
        LIMIT 1
      ) media ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'event_id', event_id,
            'source', source,
            'change_type', change_type,
            'occurred_at', occurred_at,
            'before_value', before_value,
            'after_value', after_value,
            'context', context
          )
          ORDER BY occurred_at DESC, event_id DESC
        ) AS items
        FROM (
          SELECT
            e.id AS event_id,
            e.source,
            e.change_type,
            e.occurred_at,
            e.before_value,
            e.after_value,
            e.context
          FROM events.app_change_events e
          WHERE e.appid = p.appid
          ORDER BY e.occurred_at DESC, e.id DESC
          LIMIT 30
        ) x
      ) changes ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'gid', gid,
            'title', title,
            'url', url,
            'published_at', published_at,
            'first_seen_at', first_seen_at,
            'feedlabel', feedlabel
          )
          ORDER BY sort_time DESC, gid DESC
        ) AS items
        FROM (
          SELECT
            n.gid,
            sp.title,
            format('https://store.steampowered.com/news/app/%s/view/%s', n.appid, n.gid) AS url,
            n.published_at,
            n.first_seen_at,
            n.feedlabel,
            COALESCE(n.published_at, n.first_seen_at) AS sort_time
          FROM docs.steam_news_items n
          LEFT JOIN docs.steam_news_search_projection sp ON sp.gid = n.gid
          WHERE n.appid = p.appid
          ORDER BY COALESCE(n.published_at, n.first_seen_at) DESC, n.gid DESC
          LIMIT 15
        ) x
      ) news ON true
      WHERE p.appid = $1
      LIMIT 1
    `,
    [appid]
  );

  const row = rows[0];
  if (!row) return null;

  const rawGame = toRecord(row.game);
  const game = mapUnreleasedRow(rawGame as UnreleasedRow);
  const changes = toUnknownArray(row.recent_changes).map((item) => {
    const record = toRecord(item);
    return {
      event_id: toNumber(record.event_id) ?? 0,
      source: String(record.source ?? ''),
      change_type: String(record.change_type ?? ''),
      occurred_at: toIsoDate(record.occurred_at) ?? '',
      before_value: record.before_value,
      after_value: record.after_value,
      context: toRecord(record.context),
    } satisfies RecentChange;
  });
  const news = toUnknownArray(row.recent_news).map((item) => {
    const record = toRecord(item);
    return {
      gid: String(record.gid ?? ''),
      title: typeof record.title === 'string' ? record.title : null,
      url: String(record.url ?? ''),
      published_at: toIsoDate(record.published_at),
      first_seen_at: toIsoDate(record.first_seen_at),
      feedlabel: typeof record.feedlabel === 'string' ? record.feedlabel : null,
    } satisfies RecentNews;
  });

  return {
    game,
    screenshots: toUnknownArray(row.screenshots),
    trailers: toUnknownArray(row.trailers),
    hero_assets: toRecord(row.hero_assets),
    recent_changes: changes,
    recent_news: news,
  };
}

export async function getUnreleasedGameTimeline(
  appid: number,
  params: { limit?: number; offset?: number } = {}
): Promise<UnreleasedTimelineResult> {
  if (!(await hasUnreleasedProjection())) {
    throw new Error('The unreleased games projection is not available.');
  }

  const limit = Math.min(Math.max(Math.floor(params.limit ?? 40), 1), 100);
  const offset = Math.max(Math.floor(params.offset ?? 0), 0);
  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      WITH timeline AS (
        SELECT
          ('change:' || e.id::text) AS id,
          'change'::text AS item_type,
          e.id AS event_id,
          NULL::text AS gid,
          e.source,
          e.change_type,
          NULL::text AS title,
          COALESCE(
            e.context ->> 'headline',
            e.context ->> 'summary',
            replace(e.change_type, '_', ' ')
          ) AS summary,
          e.occurred_at,
          NULL::text AS url,
          e.before_value,
          e.after_value,
          e.context,
          NULL::text AS feedlabel
        FROM events.app_change_events e
        WHERE e.appid = $1

        UNION ALL

        SELECT
          ('news:' || n.gid::text) AS id,
          'news'::text AS item_type,
          NULL::bigint AS event_id,
          n.gid::text AS gid,
          'news'::text AS source,
          'steam_news'::text AS change_type,
          sp.title,
          COALESCE(sp.title, 'Steam news') AS summary,
          COALESCE(n.published_at, n.first_seen_at) AS occurred_at,
          format('https://store.steampowered.com/news/app/%s/view/%s', n.appid, n.gid) AS url,
          NULL::jsonb AS before_value,
          NULL::jsonb AS after_value,
          jsonb_build_object(
            'feedlabel', n.feedlabel,
            'feedname', n.feedname,
            'first_seen_at', n.first_seen_at,
            'published_at', n.published_at,
            'raw_url', n.url
          ) AS context,
          n.feedlabel
        FROM docs.steam_news_items n
        LEFT JOIN docs.steam_news_search_projection sp ON sp.gid = n.gid
        WHERE n.appid = $1
      )
      SELECT *
      FROM timeline
      ORDER BY occurred_at DESC NULLS LAST, id DESC
      LIMIT $2
      OFFSET $3
    `,
    [appid, limit + 1, offset]
  );

  const items = rows.slice(0, limit).map((row) => ({
    id: String(row.id ?? ''),
    item_type: row.item_type === 'news' ? 'news' : 'change',
    event_id: toNumber(row.event_id),
    gid: typeof row.gid === 'string' ? row.gid : null,
    source: String(row.source ?? ''),
    change_type: typeof row.change_type === 'string' ? row.change_type : null,
    title: typeof row.title === 'string' ? row.title : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    occurred_at: toIsoDate(row.occurred_at) ?? '',
    url: typeof row.url === 'string' ? row.url : null,
    before_value: row.before_value,
    after_value: row.after_value,
    context: toRecord(row.context),
    feedlabel: typeof row.feedlabel === 'string' ? row.feedlabel : null,
  } satisfies UnreleasedTimelineItem));

  return {
    items,
    next_offset: rows.length > limit ? offset + limit : null,
  };
}
