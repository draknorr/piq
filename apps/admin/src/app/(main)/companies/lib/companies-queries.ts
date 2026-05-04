import 'server-only';

import { runTigerQuery } from '@publisheriq/database';
import type { AggregateStats, Company, CompaniesFilterParams, CompanyIdentifier, SortField } from './companies-types';

type SqlValue = string | number | boolean | readonly number[] | readonly string[];

type CompanyRow = Record<string, unknown> & {
  id: number;
  name: string;
  type: 'publisher' | 'developer';
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const AGGREGATE_STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_AGGREGATE_STATS_CACHE_ENTRIES = 128;

const aggregateStatsCache = new Map<string, { data: AggregateStats; timestamp: number }>();

const SORT_SQL: Record<SortField, string> = {
  avg_review_score: 'avg_review_score',
  ccu_growth_7d: 'ccu_growth_7d_percent',
  estimated_weekly_hours: 'estimated_weekly_hours',
  game_count: 'game_count',
  games_trending_up: 'games_trending_up',
  growth_30d: 'ccu_growth_30d_percent',
  name: 'name',
  owners_per_game: 'owners_per_game',
  revenue_estimate_cents: 'revenue_estimate_cents',
  revenue_per_game: 'revenue_per_game',
  review_velocity: 'review_velocity_7d',
  reviews_per_1k_owners: 'reviews_per_1k_owners',
  total_ccu: 'total_ccu',
  total_owners: 'total_owners',
  total_reviews: 'total_reviews',
};

function addParam(values: SqlValue[], value: SqlValue): string {
  values.push(value);
  return `$${values.length}`;
}

function hasItems<T>(items: readonly T[] | undefined): items is readonly T[] {
  return Array.isArray(items) && items.length > 0;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  return Math.max(Math.floor(offset ?? 0), 0);
}

function hasSplitQueryOffset(params: CompaniesFilterParams): boolean {
  return normalizeOffset(params.offset) > 0;
}

export function isTigerReadConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TIGER_PRIMARY_URL || env.CHANGE_INTEL_TIGER_URL);
}

function periodPredicate(params: CompaniesFilterParams, appAlias: string, values: SqlValue[]): string {
  switch (params.period) {
    case '2025':
    case '2024':
    case '2023':
      return `AND EXTRACT(YEAR FROM ${appAlias}.release_date)::integer = ${addParam(values, Number(params.period))}`;
    case 'last_12mo':
      return `AND ${appAlias}.release_date >= CURRENT_DATE - INTERVAL '12 months'`;
    case 'last_6mo':
      return `AND ${appAlias}.release_date >= CURRENT_DATE - INTERVAL '6 months'`;
    case 'last_90d':
      return `AND ${appAlias}.release_date >= CURRENT_DATE - INTERVAL '90 days'`;
    case 'last_30d':
      return `AND ${appAlias}.release_date >= CURRENT_DATE - INTERVAL '30 days'`;
    default:
      return '';
  }
}

function buildContentFilterCtes(params: CompaniesFilterParams, values: SqlValue[]): string[] {
  const ctes: string[] = [];

  if (hasItems(params.genres)) {
    const placeholder = addParam(values, params.genres);
    ctes.push(params.genreMode === 'all'
      ? `
        genre_filter AS (
          SELECT ag.appid
          FROM legacy.app_genres ag
          WHERE ag.genre_id = ANY(${placeholder}::int[])
          GROUP BY ag.appid
          HAVING COUNT(DISTINCT ag.genre_id) = cardinality(${placeholder}::int[])
        )
      `
      : `
        genre_filter AS (
          SELECT DISTINCT ag.appid
          FROM legacy.app_genres ag
          WHERE ag.genre_id = ANY(${placeholder}::int[])
        )
      `);
  }

  if (hasItems(params.tags)) {
    ctes.push(`
      tag_filter AS (
        SELECT DISTINCT ast.appid
        FROM legacy.app_steam_tags ast
        WHERE ast.tag_id = ANY(${addParam(values, params.tags)}::int[])
      )
    `);
  }

  if (hasItems(params.categories)) {
    ctes.push(`
      category_filter AS (
        SELECT DISTINCT ac.appid
        FROM legacy.app_categories ac
        WHERE ac.category_id = ANY(${addParam(values, params.categories)}::int[])
      )
    `);
  }

  if (params.steamDeck === 'verified') {
    ctes.push(`
      steam_deck_filter AS (
        SELECT DISTINCT sd.appid
        FROM legacy.app_steam_deck sd
        WHERE sd.category = 'verified'
      )
    `);
  } else if (params.steamDeck === 'playable') {
    ctes.push(`
      steam_deck_filter AS (
        SELECT DISTINCT sd.appid
        FROM legacy.app_steam_deck sd
        WHERE sd.category IN ('verified', 'playable')
      )
    `);
  }

  return ctes;
}

function contentFilterJoinSql(params: CompaniesFilterParams): string {
  const joins: string[] = [];
  if (hasItems(params.genres)) joins.push('JOIN genre_filter gf ON gf.appid = a.appid');
  if (hasItems(params.tags)) joins.push('JOIN tag_filter tf ON tf.appid = a.appid');
  if (hasItems(params.categories)) joins.push('JOIN category_filter cf ON cf.appid = a.appid');
  if (params.steamDeck === 'verified' || params.steamDeck === 'playable') joins.push('JOIN steam_deck_filter sdf ON sdf.appid = a.appid');
  return joins.join('\n');
}

function platformPredicate(params: CompaniesFilterParams, appAlias: string, values: SqlValue[]): string {
  if (!hasItems(params.platforms)) return '';

  const checks = params.platforms.map((platform) => {
    const normalized = platform.trim();
    return `${appAlias}.platforms ILIKE ${addParam(values, `%${normalized}%`)}`;
  });

  return params.platformMode === 'all'
    ? `AND ${checks.map((check) => `(${check})`).join(' AND ')}`
    : `AND (${checks.join(' OR ')})`;
}

function companyTypePredicate(params: CompaniesFilterParams): { publishers: boolean; developers: boolean } {
  return {
    publishers: params.type === 'all' || params.type === 'publisher',
    developers: params.type === 'all' || params.type === 'developer',
  };
}

function needsTrendMetricsInCore(params: CompaniesFilterParams): boolean {
  return params.sort === 'games_trending_up'
    || params.sort === 'ccu_growth_7d'
    || params.sort === 'growth_30d'
    || params.sort === 'review_velocity'
    || params.minGrowth7d !== undefined
    || params.maxGrowth7d !== undefined
    || params.minGrowth30d !== undefined
    || params.maxGrowth30d !== undefined;
}

function buildCompanyCtes(
  params: CompaniesFilterParams,
  values: SqlValue[],
  options: { includeTrendMetrics?: boolean } = {}
): string {
  const { publishers, developers } = companyTypePredicate(params);
  const includeTrendMetrics = options.includeTrendMetrics ?? true;
  const publisherPeriod = periodPredicate(params, 'a', values);
  const developerPeriod = periodPredicate(params, 'a', values);
  const contentFilterCtes = buildContentFilterCtes(params, values);
  const appContentJoins = contentFilterJoinSql(params);
  const appPlatformPredicate = platformPredicate(params, 'a', values);
  const unionParts: string[] = [];

  if (publishers) {
    unionParts.push(`
      SELECT
        'publisher'::text AS type,
        p.id,
        p.name,
        p.steam_vanity_url,
        p.first_game_release_date,
        ap.appid,
        a.release_date,
        a.current_price_cents,
        a.platforms,
        a.updated_at AS app_updated_at
      FROM legacy.publishers p
      JOIN legacy.app_publishers ap ON ap.publisher_id = p.id
      JOIN legacy.apps a ON a.appid = ap.appid
      ${appContentJoins}
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
        ${publisherPeriod}
        ${appPlatformPredicate}
    `);
  }

  if (developers) {
    unionParts.push(`
      SELECT
        'developer'::text AS type,
        d.id,
        d.name,
        d.steam_vanity_url,
        d.first_game_release_date,
        ad.appid,
        a.release_date,
        a.current_price_cents,
        a.platforms,
        a.updated_at AS app_updated_at
      FROM legacy.developers d
      JOIN legacy.app_developers ad ON ad.developer_id = d.id
      JOIN legacy.apps a ON a.appid = ad.appid
      ${appContentJoins}
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
        ${developerPeriod}
        ${appPlatformPredicate}
    `);
  }

  const companyAppsSql = unionParts.length > 0 ? unionParts.join('\nUNION ALL\n') : `
      SELECT NULL::text AS type, NULL::integer AS id, NULL::text AS name, NULL::text AS steam_vanity_url, NULL::date AS first_game_release_date, NULL::integer AS appid, NULL::date AS release_date, NULL::integer AS current_price_cents, NULL::text AS platforms, NULL::timestamp with time zone AS app_updated_at
      WHERE false
  `;
  const leadingCtes = contentFilterCtes.length > 0 ? `${contentFilterCtes.join(',\n')},` : '';

  return `
    WITH ${leadingCtes}
    company_apps AS (
      ${companyAppsSql}
    ),
    app_metric_rows AS (
      SELECT
        ca.type,
        ca.id,
        ca.name,
        ca.steam_vanity_url,
        ca.first_game_release_date,
        ca.appid,
        ca.release_date,
        ca.current_price_cents,
        ca.platforms,
        COALESCE(ldm.owners_min, 0) AS owners_min,
        COALESCE(ldm.owners_max, 0) AS owners_max,
        COALESCE(ldm.owners_midpoint, ((COALESCE(ldm.owners_min, 0)::bigint + COALESCE(ldm.owners_max, 0)::bigint) / 2)) AS owners_midpoint,
        COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
        COALESCE(ldm.total_reviews, 0) AS total_reviews,
        COALESCE(ldm.positive_reviews, 0) AS positive_reviews,
        COALESCE(ldm.estimated_weekly_hours, 0) AS estimated_weekly_hours,
        COALESCE(ldm.price_cents, ca.current_price_cents, 0) AS price_cents,
        ldm.metric_date,
        ${includeTrendMetrics ? 'atr.trend_30d_direction' : 'NULL::text AS trend_30d_direction'},
        ${includeTrendMetrics ? 'atr.review_velocity_7d' : 'NULL::numeric AS review_velocity_7d'},
        ${includeTrendMetrics ? 'atr.review_velocity_30d' : 'NULL::numeric AS review_velocity_30d'},
        ${includeTrendMetrics ? 'cta.ccu_growth_7d_percent' : 'NULL::numeric AS ccu_growth_7d_percent'},
        ${includeTrendMetrics ? 'cta.ccu_growth_30d_percent' : 'NULL::numeric AS ccu_growth_30d_percent'},
        ${includeTrendMetrics
          ? 'GREATEST(ca.app_updated_at, COALESCE(cta.updated_at, ca.app_updated_at), COALESCE(atr.updated_at, ca.app_updated_at))'
          : 'ca.app_updated_at'} AS data_updated_at
      FROM company_apps ca
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ca.appid
      ${includeTrendMetrics ? 'LEFT JOIN metrics.app_trends atr ON atr.appid = ca.appid' : ''}
      ${includeTrendMetrics ? 'LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = ca.appid' : ''}
    ),
    core AS (
      SELECT
        type,
        id,
        name,
        COUNT(*)::integer AS game_count,
        COALESCE(SUM(owners_midpoint), 0)::bigint AS total_owners,
        COALESCE(SUM(ccu_peak), 0)::bigint AS total_ccu,
        COALESCE(SUM(estimated_weekly_hours), 0)::bigint AS estimated_weekly_hours,
        COALESCE(SUM(total_reviews), 0)::bigint AS total_reviews,
        COALESCE(SUM(positive_reviews), 0)::bigint AS positive_reviews,
        CASE WHEN SUM(total_reviews) > 0 THEN ROUND((SUM(positive_reviews)::numeric / SUM(total_reviews)) * 100)::integer ELSE NULL END AS avg_review_score,
        COALESCE(SUM(owners_midpoint::numeric * COALESCE(price_cents, 0)), 0)::bigint AS revenue_estimate_cents,
        COUNT(*) FILTER (WHERE trend_30d_direction = 'up')::integer AS games_trending_up,
        COUNT(*) FILTER (WHERE trend_30d_direction = 'down')::integer AS games_trending_down,
        AVG(ccu_growth_7d_percent) FILTER (WHERE ccu_growth_7d_percent IS NOT NULL)::numeric AS ccu_growth_7d_percent,
        AVG(ccu_growth_30d_percent) FILTER (WHERE ccu_growth_30d_percent IS NOT NULL)::numeric AS ccu_growth_30d_percent,
        SUM(review_velocity_7d) FILTER (WHERE review_velocity_7d IS NOT NULL)::numeric AS review_velocity_7d,
        SUM(review_velocity_30d) FILTER (WHERE review_velocity_30d IS NOT NULL)::numeric AS review_velocity_30d,
        MIN(first_game_release_date) AS first_release_date,
        MAX(release_date) AS latest_release_date,
        steam_vanity_url,
        MAX(data_updated_at) AS data_updated_at,
        COUNT(*) FILTER (WHERE release_date >= CURRENT_DATE - INTERVAL '1 year')::integer AS games_released_last_year
      FROM app_metric_rows
      GROUP BY type, id, name, steam_vanity_url
    ),
    relationships AS (
      SELECT NULL::text AS type, NULL::integer AS id, NULL::integer AS external_partner_count, NULL::integer AS self_named_edges, NULL::integer AS relationship_edges
      WHERE false
    ),
    companies AS (
      SELECT
        c.*,
        0::integer AS unique_developers,
        NULL::integer AS external_partner_count,
        NULL::boolean AS is_self_published,
        NULL::boolean AS works_with_external_devs,
        CASE WHEN c.game_count > 0 THEN c.revenue_estimate_cents::numeric / c.game_count ELSE NULL END AS revenue_per_game,
        CASE WHEN c.game_count > 0 THEN c.total_owners::numeric / c.game_count ELSE NULL END AS owners_per_game,
        CASE WHEN c.total_owners > 0 THEN c.total_reviews::numeric / (c.total_owners::numeric / 1000) ELSE NULL END AS reviews_per_1k_owners
      FROM core c
    )
  `;
}

function buildCompanyWhere(params: CompaniesFilterParams, values: SqlValue[], options: { ids?: CompanyIdentifier[] } = {}): string {
  const where: string[] = ['game_count > 0'];

  if (options.ids && options.ids.length > 0) {
    const publisherIds = options.ids.filter((id) => id.type === 'publisher').map((id) => id.id);
    const developerIds = options.ids.filter((id) => id.type === 'developer').map((id) => id.id);
    const idClauses: string[] = [];
    if (publisherIds.length > 0) idClauses.push(`(type = 'publisher' AND id = ANY(${addParam(values, publisherIds)}::int[]))`);
    if (developerIds.length > 0) idClauses.push(`(type = 'developer' AND id = ANY(${addParam(values, developerIds)}::int[]))`);
    where.push(`(${idClauses.join(' OR ')})`);
  }

  if (params.search) {
    where.push(`name ILIKE ${addParam(values, `%${params.search.trim()}%`)}`);
  }

  const ranges: Array<[unknown, string, string]> = [
    [params.minGames, 'game_count', '>='],
    [params.maxGames, 'game_count', '<='],
    [params.minOwners, 'total_owners', '>='],
    [params.maxOwners, 'total_owners', '<='],
    [params.minCcu, 'total_ccu', '>='],
    [params.maxCcu, 'total_ccu', '<='],
    [params.minHours, 'estimated_weekly_hours', '>='],
    [params.maxHours, 'estimated_weekly_hours', '<='],
    [params.minRevenue, 'revenue_estimate_cents', '>='],
    [params.maxRevenue, 'revenue_estimate_cents', '<='],
    [params.minScore, 'avg_review_score', '>='],
    [params.maxScore, 'avg_review_score', '<='],
    [params.minReviews, 'total_reviews', '>='],
    [params.maxReviews, 'total_reviews', '<='],
    [params.minGrowth7d, 'ccu_growth_7d_percent', '>='],
    [params.maxGrowth7d, 'ccu_growth_7d_percent', '<='],
    [params.minGrowth30d, 'ccu_growth_30d_percent', '>='],
    [params.maxGrowth30d, 'ccu_growth_30d_percent', '<='],
  ];

  for (const [value, column, operator] of ranges) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      where.push(`${column} ${operator} ${addParam(values, value)}`);
    }
  }

  if (params.status === 'active') where.push('games_released_last_year > 0');
  if (params.status === 'dormant') where.push('games_released_last_year = 0');

  if (params.relationship === 'self_published') {
    where.push(`(
      (type = 'publisher' AND EXISTS (
        SELECT 1
        FROM legacy.publishers pub
        JOIN legacy.developers dev ON dev.normalized_name = pub.normalized_name
        WHERE pub.id = companies.id
      ))
      OR
      (type = 'developer' AND EXISTS (
        SELECT 1
        FROM legacy.developers dev
        JOIN legacy.publishers pub ON pub.normalized_name = dev.normalized_name
        WHERE dev.id = companies.id
      ))
    )`);
  } else if (params.relationship === 'external_devs') {
    where.push(`type = 'publisher' AND (
      SELECT COUNT(DISTINCT ad.developer_id)
      FROM legacy.app_publishers ap
      JOIN legacy.app_developers ad ON ad.appid = ap.appid
      WHERE ap.publisher_id = companies.id
    ) > 1`);
  } else if (params.relationship === 'multi_publisher') {
    where.push(`type = 'developer' AND (
      SELECT COUNT(DISTINCT ap.publisher_id)
      FROM legacy.app_developers ad
      JOIN legacy.app_publishers ap ON ap.appid = ad.appid
      WHERE ad.developer_id = companies.id
    ) > 1`);
  }

  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    game_count: toNumber(row.game_count) ?? 0,
    total_owners: toNumber(row.total_owners) ?? 0,
    total_ccu: toNumber(row.total_ccu) ?? 0,
    estimated_weekly_hours: toNumber(row.estimated_weekly_hours) ?? 0,
    total_reviews: toNumber(row.total_reviews) ?? 0,
    positive_reviews: toNumber(row.positive_reviews) ?? 0,
    avg_review_score: toNumber(row.avg_review_score),
    revenue_estimate_cents: toNumber(row.revenue_estimate_cents) ?? 0,
    games_trending_up: toNumber(row.games_trending_up) ?? 0,
    games_trending_down: toNumber(row.games_trending_down) ?? 0,
    ccu_growth_7d_percent: toNumber(row.ccu_growth_7d_percent),
    ccu_growth_30d_percent: toNumber(row.ccu_growth_30d_percent),
    review_velocity_7d: toNumber(row.review_velocity_7d),
    review_velocity_30d: toNumber(row.review_velocity_30d),
    is_self_published: (row.is_self_published as boolean | null | undefined) ?? null,
    works_with_external_devs: (row.works_with_external_devs as boolean | null | undefined) ?? null,
    external_partner_count: toNumber(row.external_partner_count),
    first_release_date: toIsoDate(row.first_release_date),
    latest_release_date: toIsoDate(row.latest_release_date),
    years_active: toNumber(row.years_active),
    steam_vanity_url: (row.steam_vanity_url as string | null | undefined) ?? null,
    unique_developers: toNumber(row.unique_developers) ?? 0,
    data_updated_at: toIsoDate(row.data_updated_at),
  };
}

/**
 * Fetch companies from TigerData.
 */
export async function getCompanies(params: CompaniesFilterParams): Promise<Company[]> {
  const rows = params.type === 'all' && !hasSplitQueryOffset(params)
    ? await queryCompaniesSplitByType(params)
    : await queryCompanies(params);
  return rows.map(mapCompanyRow);
}

function getAggregateStatsCacheKey(params: CompaniesFilterParams): string {
  const statsParams: CompaniesFilterParams = {
    ...params,
    sort: 'estimated_weekly_hours',
    order: 'desc',
    limit: undefined,
    offset: undefined,
  };
  const entries = Object.entries(statsParams)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function readAggregateStatsCache(key: string): AggregateStats | null {
  const cached = aggregateStatsCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > AGGREGATE_STATS_CACHE_TTL_MS) {
    aggregateStatsCache.delete(key);
    return null;
  }
  return cached.data;
}

function writeAggregateStatsCache(key: string, data: AggregateStats): void {
  if (aggregateStatsCache.size >= MAX_AGGREGATE_STATS_CACHE_ENTRIES) {
    const oldestKey = aggregateStatsCache.keys().next().value as string | undefined;
    if (oldestKey) aggregateStatsCache.delete(oldestKey);
  }
  aggregateStatsCache.set(key, { data, timestamp: Date.now() });
}

function hasSimpleAggregateShape(params: CompaniesFilterParams): boolean {
  return !params.search
    && params.period === undefined
    && params.status === undefined
    && params.relationship === undefined
    && !hasItems(params.genres)
    && !hasItems(params.tags)
    && !hasItems(params.categories)
    && !hasItems(params.platforms)
    && params.steamDeck === undefined
    && [
      params.minGames,
      params.maxGames,
      params.minOwners,
      params.maxOwners,
      params.minCcu,
      params.maxCcu,
      params.minHours,
      params.maxHours,
      params.minRevenue,
      params.maxRevenue,
      params.minScore,
      params.maxScore,
      params.minReviews,
      params.maxReviews,
      params.minGrowth7d,
      params.maxGrowth7d,
      params.minGrowth30d,
      params.maxGrowth30d,
    ].every((value) => value === undefined);
}

function simpleAggregateCompanyEdgesSql(companyType: CompaniesFilterParams['type']): string {
  const parts: string[] = [];

  if (companyType === 'all' || companyType === 'publisher') {
    parts.push(`
      SELECT 'publisher'::text AS type, ap.publisher_id AS id, ap.appid
      FROM legacy.app_publishers ap
      JOIN legacy.apps a ON a.appid = ap.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }

  if (companyType === 'all' || companyType === 'developer') {
    parts.push(`
      SELECT 'developer'::text AS type, ad.developer_id AS id, ad.appid
      FROM legacy.app_developers ad
      JOIN legacy.apps a ON a.appid = ad.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }

  return parts.join('\nUNION ALL\n');
}

async function getSimpleAggregateStats(params: CompaniesFilterParams): Promise<AggregateStats> {
  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      WITH company_edges AS (
        ${simpleAggregateCompanyEdgesSql(params.type)}
      )
      SELECT
        COUNT(DISTINCT ce.type || ':' || ce.id)::integer AS total_companies,
        COUNT(*)::integer AS total_games,
        COALESCE(SUM(COALESCE(ldm.owners_midpoint, ((COALESCE(ldm.owners_min, 0)::bigint + COALESCE(ldm.owners_max, 0)::bigint) / 2))), 0)::bigint AS total_owners,
        COALESCE(SUM(COALESCE(ldm.owners_midpoint, ((COALESCE(ldm.owners_min, 0)::bigint + COALESCE(ldm.owners_max, 0)::bigint) / 2))::numeric * COALESCE(ldm.price_cents, a.current_price_cents, 0)), 0)::bigint AS total_revenue,
        CASE WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
          THEN ROUND((SUM(COALESCE(ldm.positive_reviews, 0))::numeric / SUM(COALESCE(ldm.total_reviews, 0))) * 100, 2)
          ELSE NULL
        END AS avg_review_score,
        COALESCE(SUM(COALESCE(ldm.ccu_peak, 0)), 0)::bigint AS total_ccu
      FROM company_edges ce
      JOIN legacy.apps a ON a.appid = ce.appid
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ce.appid
    `
  );

  const row = rows[0] ?? {};
  return {
    total_companies: toNumber(row.total_companies) ?? 0,
    total_games: toNumber(row.total_games) ?? 0,
    total_owners: toNumber(row.total_owners) ?? 0,
    total_revenue: toNumber(row.total_revenue) ?? 0,
    avg_review_score: toNumber(row.avg_review_score),
    total_ccu: toNumber(row.total_ccu) ?? 0,
  };
}

async function queryCompanies(params: CompaniesFilterParams): Promise<CompanyRow[]> {
  const includeTrendMetrics = needsTrendMetricsInCore(params);
  const values: SqlValue[] = [];
  const ctes = buildCompanyCtes(params, values, { includeTrendMetrics });
  const whereSql = buildCompanyWhere(params, values);
  const sortColumn = SORT_SQL[params.sort] ?? SORT_SQL.estimated_weekly_hours;
  const limitPlaceholder = addParam(values, normalizeLimit(params.limit));
  const offsetPlaceholder = addParam(values, normalizeOffset(params.offset));
  const direction = params.order === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await runTigerQuery<CompanyRow>(
    `
      ${ctes}
      SELECT
        id,
        name,
        type,
        game_count,
        total_owners,
        total_ccu,
        estimated_weekly_hours,
        total_reviews,
        positive_reviews,
        avg_review_score,
        revenue_estimate_cents,
        games_trending_up,
        games_trending_down,
        ccu_growth_7d_percent,
        ccu_growth_30d_percent,
        review_velocity_7d,
        review_velocity_30d,
        is_self_published,
        works_with_external_devs,
        external_partner_count,
        revenue_per_game,
        owners_per_game,
        reviews_per_1k_owners,
        first_release_date,
        latest_release_date,
        CASE
          WHEN first_release_date IS NOT NULL
            THEN EXTRACT(YEAR FROM AGE(COALESCE(latest_release_date, CURRENT_DATE), first_release_date))::integer
          ELSE NULL
        END AS years_active,
        steam_vanity_url,
        CASE WHEN type = 'publisher' THEN (
          SELECT COUNT(DISTINCT ad.developer_id)::integer
          FROM legacy.app_publishers ap
          JOIN legacy.app_developers ad ON ad.appid = ap.appid
          WHERE ap.publisher_id = companies.id
        ) ELSE 0 END AS unique_developers,
        data_updated_at
      FROM companies
      ${whereSql}
      ORDER BY ${sortColumn} ${direction} NULLS LAST, name ASC, type ASC, id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `,
    values
  );

  if (!includeTrendMetrics) {
    await hydrateTrendMetrics(rows);
  }

  return rows;
}

async function hydrateTrendMetrics(rows: CompanyRow[]): Promise<void> {
  if (rows.length === 0) return;

  const publisherIds = rows.filter((row) => row.type === 'publisher').map((row) => row.id);
  const developerIds = rows.filter((row) => row.type === 'developer').map((row) => row.id);
  if (publisherIds.length === 0 && developerIds.length === 0) return;

  const values: SqlValue[] = [];
  const parts: string[] = [];

  if (publisherIds.length > 0) {
    parts.push(`
      SELECT 'publisher'::text AS type, ap.publisher_id AS id, ap.appid
      FROM legacy.app_publishers ap
      WHERE ap.publisher_id = ANY(${addParam(values, publisherIds)}::int[])
    `);
  }

  if (developerIds.length > 0) {
    parts.push(`
      SELECT 'developer'::text AS type, ad.developer_id AS id, ad.appid
      FROM legacy.app_developers ad
      WHERE ad.developer_id = ANY(${addParam(values, developerIds)}::int[])
    `);
  }

  const { rows: metricRows } = await runTigerQuery<Record<string, unknown>>(
    `
      WITH selected_company_apps AS (
        ${parts.join('\nUNION ALL\n')}
      )
      SELECT
        sca.type,
        sca.id,
        COUNT(*) FILTER (WHERE atr.trend_30d_direction = 'up')::integer AS games_trending_up,
        COUNT(*) FILTER (WHERE atr.trend_30d_direction = 'down')::integer AS games_trending_down,
        AVG(cta.ccu_growth_7d_percent) FILTER (WHERE cta.ccu_growth_7d_percent IS NOT NULL)::numeric AS ccu_growth_7d_percent,
        AVG(cta.ccu_growth_30d_percent) FILTER (WHERE cta.ccu_growth_30d_percent IS NOT NULL)::numeric AS ccu_growth_30d_percent,
        SUM(atr.review_velocity_7d) FILTER (WHERE atr.review_velocity_7d IS NOT NULL)::numeric AS review_velocity_7d,
        SUM(atr.review_velocity_30d) FILTER (WHERE atr.review_velocity_30d IS NOT NULL)::numeric AS review_velocity_30d,
        MAX(GREATEST(COALESCE(cta.updated_at, '-infinity'::timestamp with time zone), COALESCE(atr.updated_at, '-infinity'::timestamp with time zone))) AS trend_updated_at
      FROM selected_company_apps sca
      LEFT JOIN metrics.app_trends atr ON atr.appid = sca.appid
      LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = sca.appid
      GROUP BY sca.type, sca.id
    `,
    values
  );

  const metrics = new Map(metricRows.map((row) => [`${row.type}:${row.id}`, row]));
  for (const row of rows) {
    const metric = metrics.get(`${row.type}:${row.id}`);
    if (!metric) continue;
    row.games_trending_up = metric.games_trending_up;
    row.games_trending_down = metric.games_trending_down;
    row.ccu_growth_7d_percent = metric.ccu_growth_7d_percent;
    row.ccu_growth_30d_percent = metric.ccu_growth_30d_percent;
    row.review_velocity_7d = metric.review_velocity_7d;
    row.review_velocity_30d = metric.review_velocity_30d;
    if (metric.trend_updated_at) {
      const currentUpdatedAt = row.data_updated_at ? new Date(String(row.data_updated_at)).getTime() : Number.NEGATIVE_INFINITY;
      const trendUpdatedAt = new Date(String(metric.trend_updated_at)).getTime();
      if (Number.isFinite(trendUpdatedAt) && trendUpdatedAt > currentUpdatedAt) {
        row.data_updated_at = metric.trend_updated_at;
      }
    }
  }
}

function compareCompanyRows(a: CompanyRow, b: CompanyRow, params: CompaniesFilterParams): number {
  const sortColumn = SORT_SQL[params.sort] ?? SORT_SQL.estimated_weekly_hours;
  if (sortColumn === 'name') {
    const nameSortCompare = a.name.localeCompare(b.name);
    if (nameSortCompare !== 0) {
      return params.order === 'asc' ? nameSortCompare : -nameSortCompare;
    }
  }

  const aValue = toNumber(a[sortColumn]);
  const bValue = toNumber(b[sortColumn]);

  if (aValue === null && bValue !== null) return 1;
  if (aValue !== null && bValue === null) return -1;
  if (aValue !== null && bValue !== null && aValue !== bValue) {
    return params.order === 'asc' ? aValue - bValue : bValue - aValue;
  }

  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;
  const typeCompare = a.type.localeCompare(b.type);
  if (typeCompare !== 0) return typeCompare;
  return a.id - b.id;
}

async function queryCompaniesSplitByType(params: CompaniesFilterParams): Promise<CompanyRow[]> {
  const limit = normalizeLimit(params.limit);
  const [publisherRows, developerRows] = await Promise.all([
    queryCompanies({ ...params, type: 'publisher', offset: 0, limit }),
    queryCompanies({ ...params, type: 'developer', offset: 0, limit }),
  ]);

  return [...publisherRows, ...developerRows]
    .sort((a, b) => compareCompanyRows(a, b, params))
    .slice(0, limit);
}

/**
 * Fetch aggregate statistics for filtered companies from TigerData.
 */
export async function getAggregateStats(
  params: CompaniesFilterParams
): Promise<AggregateStats> {
  const cacheKey = getAggregateStatsCacheKey(params);
  const cached = readAggregateStatsCache(cacheKey);
  if (cached) return cached;

  if (hasSimpleAggregateShape(params)) {
    const stats = await getSimpleAggregateStats(params);
    writeAggregateStatsCache(cacheKey, stats);
    return stats;
  }

  const values: SqlValue[] = [];
  const ctes = buildCompanyCtes(params, values);
  const whereSql = buildCompanyWhere(params, values);

  const { rows } = await runTigerQuery<Record<string, unknown>>(
    `
      ${ctes}
      SELECT
        COUNT(*)::integer AS total_companies,
        COALESCE(SUM(game_count), 0)::bigint AS total_games,
        COALESCE(SUM(total_owners), 0)::bigint AS total_owners,
        COALESCE(SUM(revenue_estimate_cents), 0)::bigint AS total_revenue,
        CASE WHEN SUM(total_reviews) > 0 THEN ROUND((SUM(positive_reviews)::numeric / SUM(total_reviews)) * 100, 2) ELSE NULL END AS avg_review_score,
        COALESCE(SUM(total_ccu), 0)::bigint AS total_ccu
      FROM companies
      ${whereSql}
    `,
    values
  );

  const row = rows[0] ?? {};
  const stats: AggregateStats = {
    total_companies: toNumber(row.total_companies) ?? 0,
    total_games: toNumber(row.total_games) ?? 0,
    total_owners: toNumber(row.total_owners) ?? 0,
    total_revenue: toNumber(row.total_revenue) ?? 0,
    avg_review_score: toNumber(row.avg_review_score),
    total_ccu: toNumber(row.total_ccu) ?? 0,
  };
  writeAggregateStatsCache(cacheKey, stats);
  return stats;
}

/**
 * Fetch specific companies by their IDs for comparison from TigerData.
 */
export async function getCompaniesByIds(
  ids: CompanyIdentifier[]
): Promise<Company[]> {
  if (ids.length === 0) return [];

  const type: CompaniesFilterParams['type'] =
    ids.every((id) => id.type === 'publisher') ? 'publisher' :
    ids.every((id) => id.type === 'developer') ? 'developer' :
    'all';

  const params: CompaniesFilterParams = {
    type,
    sort: 'estimated_weekly_hours',
    order: 'desc',
    limit: ids.length,
  };
  const values: SqlValue[] = [];
  const ctes = buildCompanyCtes(params, values);
  const whereSql = buildCompanyWhere(params, values, { ids });

  const { rows } = await runTigerQuery<CompanyRow>(
    `
      ${ctes}
      SELECT
        id,
        name,
        type,
        game_count,
        total_owners,
        total_ccu,
        estimated_weekly_hours,
        total_reviews,
        positive_reviews,
        avg_review_score,
        revenue_estimate_cents,
        games_trending_up,
        games_trending_down,
        ccu_growth_7d_percent,
        ccu_growth_30d_percent,
        review_velocity_7d,
        review_velocity_30d,
        is_self_published,
        works_with_external_devs,
        external_partner_count,
        first_release_date,
        latest_release_date,
        CASE
          WHEN first_release_date IS NOT NULL
            THEN EXTRACT(YEAR FROM AGE(COALESCE(latest_release_date, CURRENT_DATE), first_release_date))::integer
          ELSE NULL
        END AS years_active,
        steam_vanity_url,
        CASE WHEN type = 'publisher' THEN (
          SELECT COUNT(DISTINCT ad.developer_id)::integer
          FROM legacy.app_publishers ap
          JOIN legacy.app_developers ad ON ad.appid = ap.appid
          WHERE ap.publisher_id = companies.id
        ) ELSE 0 END AS unique_developers,
        data_updated_at
      FROM companies
      ${whereSql}
    `,
    values
  );

  const companyMap = new Map(rows.map((row) => [`${row.type}-${row.id}`, mapCompanyRow(row)]));
  return ids
    .map((id) => companyMap.get(`${id.type}-${id.id}`))
    .filter((company): company is Company => company !== undefined);
}
