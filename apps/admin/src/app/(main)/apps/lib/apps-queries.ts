import 'server-only';

import { runTigerQuery } from '@publisheriq/database';
import type { App, AppsFilterParams, AggregateStats, CcuTier, VelocityTier, SteamDeckCategory } from './apps-types';

/**
 * Aggregate stats row shape returned by Tiger SQL.
 */
interface AggregateStatsRow {
  total_games: number;
  avg_ccu: number | null;
  avg_score: number | null;
  avg_momentum: number | null;
  trending_up_count: number;
  trending_down_count: number;
  sentiment_improving_count: number;
  sentiment_declining_count: number;
  avg_value_score: number | null;
}

interface LatestReviewMetricRow {
  appid: number;
  metric_date: string;
  total_reviews: number | null;
  positive_reviews: number | null;
  review_score: number | null;
}

interface ReviewSyncStatusRow {
  appid: number;
  last_reviews_sync: string | null;
}

interface FreshReviewOverlay {
  metricDate: string;
  totalReviews: number | null;
  positiveReviews: number | null;
  reviewScore: number | null;
  lastReviewsSync: string | null;
}

type AppRpcRow = Record<string, unknown> & {
  appid: number;
  name: string;
  type: string;
  is_free: boolean;
};

type SqlValue = string | number | boolean | readonly number[] | readonly string[];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const AGGREGATE_STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_AGGREGATE_STATS_CACHE_ENTRIES = 128;
const ACTIVE_APPS_SQL = `COALESCE(a.is_released, false) = true AND COALESCE(a.is_delisted, false) = false`;
const ACTIVE_APP_ROWS_SQL = `COALESCE(is_released, false) = true AND COALESCE(is_delisted, false) = false`;
const ACTIVE_PROJECTION_APPS_SQL = `COALESCE(p.is_released, false) = true AND COALESCE(p.is_delisted, false) = false`;

const aggregateStatsCache = new Map<string, { data: AggregateStats; timestamp: number }>();
let appsPageProjectionAvailable: boolean | null = null;

const APP_SELECT_SQL = `
  a.appid,
  a.name,
  COALESCE(a.type, 'game') AS type,
  COALESCE(a.is_free, false) AS is_free,
  COALESCE(a.is_delisted, false) AS is_delisted,
  COALESCE(a.has_workshop, false) AS has_workshop,
  COALESCE(a.is_released, true) AS is_released,
  COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
  COALESCE(ldm.owners_min, 0) AS owners_min,
  COALESCE(ldm.owners_max, 0) AS owners_max,
  COALESCE(ldm.owners_midpoint, 0) AS owners_midpoint,
  COALESCE(ldm.total_reviews, 0) AS total_reviews,
  COALESCE(ldm.positive_reviews, 0) AS positive_reviews,
  ldm.review_score,
  ldm.positive_percentage,
  COALESCE(ldm.price_cents, a.current_price_cents) AS price_cents,
  COALESCE(ldm.discount_percent, a.current_discount_percent, 0) AS current_discount_percent,
  ldm.average_playtime_forever,
  ldm.average_playtime_2weeks,
  cta.ccu_growth_7d_percent AS ccu_growth_7d_percent,
  cta.ccu_growth_30d_percent AS ccu_growth_30d_percent,
  cta.ccu_tier,
  rvs.velocity_7d,
  rvs.velocity_30d,
  rvs.velocity_tier,
  CASE
    WHEN trends.current_positive_ratio IS NOT NULL AND trends.previous_positive_ratio IS NOT NULL
      THEN ROUND((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 2)
    ELSE NULL
  END AS sentiment_delta,
  CASE
    WHEN cta.ccu_growth_7d_percent IS NOT NULL
      THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
        CASE
          WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
            THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
          ELSE 0
        END,
        0
      )) / 2, 2)
    ELSE NULL
  END AS momentum_score,
  CASE
    WHEN rvs.velocity_7d IS NOT NULL AND rvs.velocity_30d IS NOT NULL
      THEN ROUND(rvs.velocity_7d - rvs.velocity_30d, 4)
    ELSE NULL
  END AS velocity_acceleration,
  CASE
    WHEN ldm.owners_midpoint IS NOT NULL AND ldm.owners_midpoint > 0 AND ldm.ccu_peak IS NOT NULL
      THEN ROUND((ldm.ccu_peak::numeric / ldm.owners_midpoint) * 100, 4)
    ELSE NULL
  END AS active_player_pct,
  CASE
    WHEN a.release_date IS NOT NULL AND a.release_date < CURRENT_DATE AND ldm.total_reviews IS NOT NULL
      THEN ROUND(ldm.total_reviews::numeric / GREATEST(CURRENT_DATE - a.release_date, 1), 4)
    ELSE NULL
  END AS review_rate,
  CASE
    WHEN COALESCE(ldm.price_cents, a.current_price_cents, 0) > 0 AND ldm.review_score IS NOT NULL
      THEN ROUND(((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (COALESCE(ldm.price_cents, a.current_price_cents)::numeric / 100))::numeric, 2)
    ELSE NULL
  END AS value_score,
  NULL::numeric AS vs_publisher_avg,
  a.release_date,
  CASE WHEN a.release_date IS NOT NULL THEN CURRENT_DATE - a.release_date ELSE NULL END AS days_live,
  NULL::integer AS hype_duration,
  a.release_state,
  a.platforms,
  sd.category AS steam_deck_category,
  a.controller_support,
  publisher.publisher_id,
  publisher.publisher_name,
  publisher.publisher_game_count,
  developer.developer_id,
  developer.developer_name,
  ldm.metric_date,
  GREATEST(a.updated_at, COALESCE(sync.updated_at, a.updated_at)) AS data_updated_at
`;

const VS_PUBLISHER_AVG_PLACEHOLDER = 'NULL::numeric AS vs_publisher_avg';

function appSelectSql(vsPublisherAvgSql?: string): string {
  if (!vsPublisherAvgSql) {
    return APP_SELECT_SQL;
  }

  return APP_SELECT_SQL.replace(VS_PUBLISHER_AVG_PLACEHOLDER, `${vsPublisherAvgSql} AS vs_publisher_avg`);
}

const PUBLISHER_SCORE_AVGS_CTE = `
  publisher_score_avgs AS (
    SELECT
      ap.publisher_id,
      AVG(ldm.review_score)::numeric AS publisher_avg_score
    FROM legacy.app_publishers ap
    JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ap.appid
    WHERE ldm.review_score IS NOT NULL
    GROUP BY ap.publisher_id
  )
`;

const APP_FROM_SQL = `
  FROM legacy.apps a
  LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
  LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
  LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
  LEFT JOIN ops.sync_status sync ON sync.appid = a.appid
  LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
  LEFT JOIN LATERAL (
    SELECT ap.publisher_id, p.name AS publisher_name, p.game_count AS publisher_game_count
    FROM legacy.app_publishers ap
    JOIN legacy.publishers p ON p.id = ap.publisher_id
    WHERE ap.appid = a.appid
    ORDER BY p.game_count DESC NULLS LAST, p.name
    LIMIT 1
  ) publisher ON true
  LEFT JOIN LATERAL (
    SELECT ad.developer_id, d.name AS developer_name
    FROM legacy.app_developers ad
    JOIN legacy.developers d ON d.id = ad.developer_id
    WHERE ad.appid = a.appid
    ORDER BY d.game_count DESC NULLS LAST, d.name
    LIMIT 1
  ) developer ON true
`;

function publisherAverageJoinSql(appAlias: string, reviewScoreSql: string): string {
  return `
  LEFT JOIN LATERAL (
    SELECT ROUND((${reviewScoreSql} - AVG(peer_ldm.review_score))::numeric, 2) AS vs_publisher_avg
    FROM legacy.app_publishers ap_self
    JOIN legacy.app_publishers ap_peer ON ap_peer.publisher_id = ap_self.publisher_id
    JOIN legacy.latest_daily_metrics peer_ldm ON peer_ldm.appid = ap_peer.appid
    WHERE ap_self.appid = ${appAlias}.appid
      AND ${reviewScoreSql} IS NOT NULL
      AND peer_ldm.review_score IS NOT NULL
  ) publisher_avg ON true
`;
}

const SORT_SQL: Record<AppsFilterParams['sort'], string> = {
  active_player_pct: 'active_player_pct',
  ccu_growth_30d_percent: 'ccu_growth_30d_percent',
  ccu_growth_7d_percent: 'ccu_growth_7d_percent',
  ccu_peak: 'ccu_peak',
  days_live: 'days_live',
  momentum_score: 'momentum_score',
  owners_midpoint: 'owners_midpoint',
  price_cents: 'price_cents',
  release_date: 'release_date',
  review_rate: 'review_rate',
  review_score: 'review_score',
  sentiment_delta: 'sentiment_delta',
  total_reviews: 'total_reviews',
  value_score: 'value_score',
  velocity_7d: 'velocity_7d',
  vs_publisher_avg: 'vs_publisher_avg',
};

const DIRECT_SORT_SQL: Record<Exclude<AppsFilterParams['sort'], 'vs_publisher_avg'>, string> = {
  active_player_pct: `CASE WHEN ldm.owners_midpoint IS NOT NULL AND ldm.owners_midpoint > 0 AND ldm.ccu_peak IS NOT NULL THEN (ldm.ccu_peak::numeric / ldm.owners_midpoint) * 100 ELSE NULL END`,
  ccu_growth_30d_percent: 'cta.ccu_growth_30d_percent',
  ccu_growth_7d_percent: 'cta.ccu_growth_7d_percent',
  ccu_peak: 'COALESCE(ldm.ccu_peak, 0)',
  days_live: 'CASE WHEN a.release_date IS NOT NULL THEN CURRENT_DATE - a.release_date ELSE NULL END',
  momentum_score: `CASE
    WHEN cta.ccu_growth_7d_percent IS NOT NULL
      THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
        CASE
          WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
            THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
          ELSE 0
        END,
        0
      )) / 2, 2)
    ELSE NULL
  END`,
  owners_midpoint: 'COALESCE(ldm.owners_midpoint, 0)',
  price_cents: 'COALESCE(ldm.price_cents, a.current_price_cents)',
  release_date: 'a.release_date',
  review_rate: `CASE WHEN a.release_date IS NOT NULL AND a.release_date < CURRENT_DATE AND ldm.total_reviews IS NOT NULL THEN ldm.total_reviews::numeric / GREATEST(CURRENT_DATE - a.release_date, 1) ELSE NULL END`,
  review_score: 'ldm.review_score',
  sentiment_delta: `ROUND((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 2)`,
  total_reviews: 'COALESCE(ldm.total_reviews, 0)',
  value_score: `CASE WHEN COALESCE(ldm.price_cents, a.current_price_cents, 0) > 0 AND ldm.review_score IS NOT NULL THEN ((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (COALESCE(ldm.price_cents, a.current_price_cents)::numeric / 100))::numeric ELSE NULL END`,
  velocity_7d: 'rvs.velocity_7d',
};

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

function addParam(values: SqlValue[], value: SqlValue): string {
  values.push(value);
  return `$${values.length}`;
}

function hasItems<T>(items: readonly T[] | undefined): items is readonly T[] {
  return Array.isArray(items) && items.length > 0;
}

function buildAppsWhere(params: AppsFilterParams, values: SqlValue[]): string {
  const where: string[] = [ACTIVE_APP_ROWS_SQL];

  if (params.type && params.type !== 'all') {
    where.push(`type = ${addParam(values, params.type)}`);
  }

  if (params.search) {
    const search = params.search.trim();
    const appid = Number(search);
    if (Number.isInteger(appid)) {
      where.push(`(appid = ${addParam(values, appid)} OR lower(name) LIKE lower(${addParam(values, `%${search}%`)}))`);
    } else {
      where.push(`lower(name) LIKE lower(${addParam(values, `%${search}%`)})`);
    }
  }

  const ranges: Array<[unknown, string, string]> = [
    [params.minCcu, 'ccu_peak', '>='],
    [params.maxCcu, 'ccu_peak', '<='],
    [params.minOwners, 'owners_midpoint', '>='],
    [params.maxOwners, 'owners_midpoint', '<='],
    [params.minReviews, 'total_reviews', '>='],
    [params.maxReviews, 'total_reviews', '<='],
    [params.minScore, 'review_score', '>='],
    [params.maxScore, 'review_score', '<='],
    [params.minPrice, 'price_cents', '>='],
    [params.maxPrice, 'price_cents', '<='],
    [params.minPlaytime, 'average_playtime_forever', '>='],
    [params.maxPlaytime, 'average_playtime_forever', '<='],
    [params.minGrowth7d, 'ccu_growth_7d_percent', '>='],
    [params.maxGrowth7d, 'ccu_growth_7d_percent', '<='],
    [params.minGrowth30d, 'ccu_growth_30d_percent', '>='],
    [params.maxGrowth30d, 'ccu_growth_30d_percent', '<='],
    [params.minMomentum, 'momentum_score', '>='],
    [params.maxMomentum, 'momentum_score', '<='],
    [params.minSentimentDelta, 'sentiment_delta', '>='],
    [params.maxSentimentDelta, 'sentiment_delta', '<='],
    [params.minActivePct, 'active_player_pct', '>='],
    [params.minReviewRate, 'review_rate', '>='],
    [params.minValueScore, 'value_score', '>='],
    [params.minVsPublisher, 'vs_publisher_avg', '>='],
    [params.minAge, 'days_live', '>='],
    [params.maxAge, 'days_live', '<='],
    [params.minHype, 'hype_duration', '>='],
    [params.maxHype, 'hype_duration', '<='],
    [params.minDiscount, 'current_discount_percent', '>='],
  ];

  for (const [value, column, operator] of ranges) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      where.push(`${column} ${operator} ${addParam(values, value)}`);
    }
  }

  if (params.velocityTier) where.push(`velocity_tier = ${addParam(values, params.velocityTier)}`);
  if (params.ccuTier) where.push(`ccu_tier = ${addParam(values, params.ccuTier)}`);
  if (typeof params.isFree === 'boolean') where.push(`is_free = ${addParam(values, params.isFree)}`);
  if (typeof params.hasWorkshop === 'boolean') where.push(`has_workshop = ${addParam(values, params.hasWorkshop)}`);
  if (typeof params.earlyAccess === 'boolean') {
    where.push(params.earlyAccess ? `release_state ILIKE '%early%'` : `(release_state IS NULL OR release_state NOT ILIKE '%early%')`);
  }
  if (params.releaseYear) {
    where.push(`EXTRACT(YEAR FROM release_date)::integer = ${addParam(values, params.releaseYear)}`);
  }
  if (params.steamDeck) where.push(`steam_deck_category = ${addParam(values, params.steamDeck)}`);
  if (params.controller) where.push(`controller_support = ${addParam(values, params.controller)}`);
  if (params.publisherSearch) where.push(`publisher_name ILIKE ${addParam(values, `%${params.publisherSearch.trim()}%`)}`);
  if (params.developerSearch) where.push(`developer_name ILIKE ${addParam(values, `%${params.developerSearch.trim()}%`)}`);
  if (typeof params.selfPublished === 'boolean') {
    const predicate = `publisher_name IS NOT NULL AND developer_name IS NOT NULL AND lower(publisher_name) = lower(developer_name)`;
    where.push(params.selfPublished ? predicate : `NOT (${predicate})`);
  }
  if (params.publisherSize) {
    const clauses = {
      indie: 'COALESCE(publisher_game_count, 0) <= 5',
      major: 'COALESCE(publisher_game_count, 0) > 50',
      mid: 'COALESCE(publisher_game_count, 0) > 5 AND COALESCE(publisher_game_count, 0) <= 50',
    };
    where.push(`(${clauses[params.publisherSize]})`);
  }

  if (hasItems(params.genres)) {
    const placeholder = addParam(values, params.genres);
    where.push(
      params.genreMode === 'all'
        ? `(SELECT COUNT(DISTINCT ag.genre_id) FROM legacy.app_genres ag WHERE ag.appid = app_rows.appid AND ag.genre_id = ANY(${placeholder}::int[])) = cardinality(${placeholder}::int[])`
        : `EXISTS (SELECT 1 FROM legacy.app_genres ag WHERE ag.appid = app_rows.appid AND ag.genre_id = ANY(${placeholder}::int[]))`
    );
  }

  if (hasItems(params.tags)) {
    const placeholder = addParam(values, params.tags);
    where.push(
      params.tagMode === 'all'
        ? `(SELECT COUNT(DISTINCT ast.tag_id) FROM legacy.app_steam_tags ast WHERE ast.appid = app_rows.appid AND ast.tag_id = ANY(${placeholder}::int[])) = cardinality(${placeholder}::int[])`
        : `EXISTS (SELECT 1 FROM legacy.app_steam_tags ast WHERE ast.appid = app_rows.appid AND ast.tag_id = ANY(${placeholder}::int[]))`
    );
  }

  if (hasItems(params.categories)) {
    const placeholder = addParam(values, params.categories);
    where.push(`EXISTS (SELECT 1 FROM legacy.app_categories ac WHERE ac.appid = app_rows.appid AND ac.category_id = ANY(${placeholder}::int[]))`);
  }

  if (hasItems(params.platforms)) {
    const checks = params.platforms.map((platform) => {
      const normalized = platform.trim();
      return `platforms ILIKE ${addParam(values, `%${normalized}%`)}`;
    });
    where.push(params.platformMode === 'all' ? checks.map((check) => `(${check})`).join(' AND ') : `(${checks.join(' OR ')})`);
  }

  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

function buildAggregateWhere(params: AppsFilterParams, values: SqlValue[]): string {
  const where: string[] = [ACTIVE_APPS_SQL];

  if (params.type && params.type !== 'all') {
    where.push(`COALESCE(a.type, 'game') = ${addParam(values, params.type)}`);
  }

  if (params.search) {
    const search = params.search.trim();
    const appid = Number(search);
    if (Number.isInteger(appid)) {
      where.push(`(a.appid = ${addParam(values, appid)} OR lower(a.name) LIKE lower(${addParam(values, `%${search}%`)}))`);
    } else {
      where.push(`lower(a.name) LIKE lower(${addParam(values, `%${search}%`)})`);
    }
  }

  const priceSql = 'COALESCE(ldm.price_cents, a.current_price_cents)';
  const discountSql = 'COALESCE(ldm.discount_percent, a.current_discount_percent, 0)';
  const momentumSql = `CASE
    WHEN cta.ccu_growth_7d_percent IS NOT NULL
      THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
        CASE
          WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
            THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
          ELSE 0
        END,
        0
      )) / 2, 2)
    ELSE NULL
  END`;
  const sentimentDeltaSql = `ROUND((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 2)`;
  const activePlayerSql = `ROUND((ldm.ccu_peak::numeric / NULLIF(ldm.owners_midpoint, 0)) * 100, 4)`;
  const reviewRateSql = `ROUND(ldm.total_reviews::numeric / GREATEST(CURRENT_DATE - a.release_date, 1), 4)`;
  const valueScoreSql = `ROUND(((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (${priceSql}::numeric / 100))::numeric, 2)`;
  const vsPublisherSql = `ROUND((ldm.review_score - publisher_score_avgs.publisher_avg_score)::numeric, 2)`;

  const ranges: Array<[unknown, string, string]> = [
    [params.minCcu, 'COALESCE(ldm.ccu_peak, 0)', '>='],
    [params.maxCcu, 'COALESCE(ldm.ccu_peak, 0)', '<='],
    [params.minOwners, 'COALESCE(ldm.owners_midpoint, 0)', '>='],
    [params.maxOwners, 'COALESCE(ldm.owners_midpoint, 0)', '<='],
    [params.minReviews, 'COALESCE(ldm.total_reviews, 0)', '>='],
    [params.maxReviews, 'COALESCE(ldm.total_reviews, 0)', '<='],
    [params.minScore, 'ldm.review_score', '>='],
    [params.maxScore, 'ldm.review_score', '<='],
    [params.minPrice, priceSql, '>='],
    [params.maxPrice, priceSql, '<='],
    [params.minPlaytime, 'ldm.average_playtime_forever', '>='],
    [params.maxPlaytime, 'ldm.average_playtime_forever', '<='],
    [params.minGrowth7d, 'cta.ccu_growth_7d_percent', '>='],
    [params.maxGrowth7d, 'cta.ccu_growth_7d_percent', '<='],
    [params.minGrowth30d, 'cta.ccu_growth_30d_percent', '>='],
    [params.maxGrowth30d, 'cta.ccu_growth_30d_percent', '<='],
    [params.minMomentum, momentumSql, '>='],
    [params.maxMomentum, momentumSql, '<='],
    [params.minSentimentDelta, sentimentDeltaSql, '>='],
    [params.maxSentimentDelta, sentimentDeltaSql, '<='],
    [params.minActivePct, activePlayerSql, '>='],
    [params.minReviewRate, reviewRateSql, '>='],
    [params.minValueScore, valueScoreSql, '>='],
    [params.minVsPublisher, vsPublisherSql, '>='],
    [params.minAge, 'CURRENT_DATE - a.release_date', '>='],
    [params.maxAge, 'CURRENT_DATE - a.release_date', '<='],
    [params.minDiscount, discountSql, '>='],
  ];

  for (const [value, expression, operator] of ranges) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      where.push(`${expression} ${operator} ${addParam(values, value)}`);
    }
  }

  if (params.minHype !== undefined || params.maxHype !== undefined) where.push('FALSE');
  if (params.velocityTier) where.push(`rvs.velocity_tier = ${addParam(values, params.velocityTier)}`);
  if (params.ccuTier) where.push(`cta.ccu_tier = ${addParam(values, params.ccuTier)}`);
  if (typeof params.isFree === 'boolean') where.push(`COALESCE(a.is_free, false) = ${addParam(values, params.isFree)}`);
  if (typeof params.hasWorkshop === 'boolean') where.push(`COALESCE(a.has_workshop, false) = ${addParam(values, params.hasWorkshop)}`);
  if (typeof params.earlyAccess === 'boolean') {
    where.push(params.earlyAccess ? `a.release_state ILIKE '%early%'` : `(a.release_state IS NULL OR a.release_state NOT ILIKE '%early%')`);
  }
  if (params.releaseYear) {
    where.push(`EXTRACT(YEAR FROM a.release_date)::integer = ${addParam(values, params.releaseYear)}`);
  }
  if (params.steamDeck) where.push(`sd.category = ${addParam(values, params.steamDeck)}`);
  if (params.controller) where.push(`a.controller_support = ${addParam(values, params.controller)}`);

  if (params.publisherSearch) {
    where.push(`EXISTS (
      SELECT 1
      FROM legacy.app_publishers ap
      JOIN legacy.publishers p ON p.id = ap.publisher_id
      WHERE ap.appid = a.appid AND p.name ILIKE ${addParam(values, `%${params.publisherSearch.trim()}%`)}
    )`);
  }
  if (params.developerSearch) {
    where.push(`EXISTS (
      SELECT 1
      FROM legacy.app_developers ad
      JOIN legacy.developers d ON d.id = ad.developer_id
      WHERE ad.appid = a.appid AND d.name ILIKE ${addParam(values, `%${params.developerSearch.trim()}%`)}
    )`);
  }
  if (typeof params.selfPublished === 'boolean') {
    const predicate = `EXISTS (
      SELECT 1
      FROM legacy.app_publishers ap
      JOIN legacy.publishers p ON p.id = ap.publisher_id
      JOIN legacy.app_developers ad ON ad.appid = ap.appid
      JOIN legacy.developers d ON d.id = ad.developer_id
      WHERE ap.appid = a.appid AND lower(p.name) = lower(d.name)
    )`;
    where.push(params.selfPublished ? predicate : `NOT ${predicate}`);
  }
  if (params.publisherSize) {
    const clauses = {
      indie: 'COALESCE(p.game_count, 0) <= 5',
      major: 'COALESCE(p.game_count, 0) > 50',
      mid: 'COALESCE(p.game_count, 0) > 5 AND COALESCE(p.game_count, 0) <= 50',
    };
    where.push(`EXISTS (
      SELECT 1
      FROM legacy.app_publishers ap
      JOIN legacy.publishers p ON p.id = ap.publisher_id
      WHERE ap.appid = a.appid AND ${clauses[params.publisherSize]}
    )`);
  }

  if (hasItems(params.genres)) {
    const placeholder = addParam(values, params.genres);
    where.push(
      params.genreMode === 'all'
        ? `(SELECT COUNT(DISTINCT ag.genre_id) FROM legacy.app_genres ag WHERE ag.appid = a.appid AND ag.genre_id = ANY(${placeholder}::int[])) = cardinality(${placeholder}::int[])`
        : `EXISTS (SELECT 1 FROM legacy.app_genres ag WHERE ag.appid = a.appid AND ag.genre_id = ANY(${placeholder}::int[]))`
    );
  }

  if (hasItems(params.tags)) {
    const placeholder = addParam(values, params.tags);
    where.push(
      params.tagMode === 'all'
        ? `(SELECT COUNT(DISTINCT ast.tag_id) FROM legacy.app_steam_tags ast WHERE ast.appid = a.appid AND ast.tag_id = ANY(${placeholder}::int[])) = cardinality(${placeholder}::int[])`
        : `EXISTS (SELECT 1 FROM legacy.app_steam_tags ast WHERE ast.appid = a.appid AND ast.tag_id = ANY(${placeholder}::int[]))`
    );
  }

  if (hasItems(params.categories)) {
    const placeholder = addParam(values, params.categories);
    where.push(`EXISTS (SELECT 1 FROM legacy.app_categories ac WHERE ac.appid = a.appid AND ac.category_id = ANY(${placeholder}::int[]))`);
  }

  if (hasItems(params.platforms)) {
    const checks = params.platforms.map((platform) => {
      const normalized = platform.trim();
      return `a.platforms ILIKE ${addParam(values, `%${normalized}%`)}`;
    });
    where.push(params.platformMode === 'all' ? checks.map((check) => `(${check})`).join(' AND ') : `(${checks.join(' OR ')})`);
  }

  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

function buildProjectionWhere(params: AppsFilterParams, values: SqlValue[]): string {
  const where: string[] = [ACTIVE_PROJECTION_APPS_SQL];

  if (params.type && params.type !== 'all') where.push(`p.type = ${addParam(values, params.type)}`);

  if (params.search) {
    const search = params.search.trim();
    const appid = Number(search);
    if (Number.isInteger(appid)) {
      where.push(`(p.appid = ${addParam(values, appid)} OR p.name_lower LIKE lower(${addParam(values, `%${search}%`)}))`);
    } else {
      where.push(`p.name_lower LIKE lower(${addParam(values, `%${search}%`)})`);
    }
  }

  const ranges: Array<[unknown, string, string]> = [
    [params.minCcu, 'p.ccu_peak', '>='],
    [params.maxCcu, 'p.ccu_peak', '<='],
    [params.minOwners, 'p.owners_midpoint', '>='],
    [params.maxOwners, 'p.owners_midpoint', '<='],
    [params.minReviews, 'p.total_reviews', '>='],
    [params.maxReviews, 'p.total_reviews', '<='],
    [params.minScore, 'p.review_score', '>='],
    [params.maxScore, 'p.review_score', '<='],
    [params.minPrice, 'p.price_cents', '>='],
    [params.maxPrice, 'p.price_cents', '<='],
    [params.minPlaytime, 'p.average_playtime_forever', '>='],
    [params.maxPlaytime, 'p.average_playtime_forever', '<='],
    [params.minGrowth7d, 'p.ccu_growth_7d_percent', '>='],
    [params.maxGrowth7d, 'p.ccu_growth_7d_percent', '<='],
    [params.minGrowth30d, 'p.ccu_growth_30d_percent', '>='],
    [params.maxGrowth30d, 'p.ccu_growth_30d_percent', '<='],
    [params.minMomentum, 'p.momentum_score', '>='],
    [params.maxMomentum, 'p.momentum_score', '<='],
    [params.minSentimentDelta, 'p.sentiment_delta', '>='],
    [params.maxSentimentDelta, 'p.sentiment_delta', '<='],
    [params.minActivePct, 'p.active_player_pct', '>='],
    [params.minReviewRate, 'p.review_rate', '>='],
    [params.minValueScore, 'p.value_score', '>='],
    [params.minVsPublisher, 'p.vs_publisher_avg', '>='],
    [params.minAge, 'p.days_live', '>='],
    [params.maxAge, 'p.days_live', '<='],
    [params.minHype, 'p.hype_duration', '>='],
    [params.maxHype, 'p.hype_duration', '<='],
    [params.minDiscount, 'p.current_discount_percent', '>='],
  ];

  for (const [value, column, operator] of ranges) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      where.push(`${column} ${operator} ${addParam(values, value)}`);
    }
  }

  if (params.velocityTier) where.push(`p.velocity_tier = ${addParam(values, params.velocityTier)}`);
  if (params.ccuTier) where.push(`p.ccu_tier = ${addParam(values, params.ccuTier)}`);
  if (typeof params.isFree === 'boolean') where.push(`p.is_free = ${addParam(values, params.isFree)}`);
  if (typeof params.hasWorkshop === 'boolean') where.push(`p.has_workshop = ${addParam(values, params.hasWorkshop)}`);
  if (typeof params.earlyAccess === 'boolean') {
    where.push(params.earlyAccess ? `p.release_state ILIKE '%early%'` : `(p.release_state IS NULL OR p.release_state NOT ILIKE '%early%')`);
  }
  if (params.releaseYear) where.push(`EXTRACT(YEAR FROM p.release_date)::integer = ${addParam(values, params.releaseYear)}`);
  if (params.steamDeck) where.push(`p.steam_deck_category = ${addParam(values, params.steamDeck)}`);
  if (params.controller) where.push(`p.controller_support = ${addParam(values, params.controller)}`);
  if (params.publisherSearch) where.push(`p.publisher_name ILIKE ${addParam(values, `%${params.publisherSearch.trim()}%`)}`);
  if (params.developerSearch) where.push(`p.developer_name ILIKE ${addParam(values, `%${params.developerSearch.trim()}%`)}`);
  if (typeof params.selfPublished === 'boolean') {
    const predicate = `p.publisher_name IS NOT NULL AND p.developer_name IS NOT NULL AND lower(p.publisher_name) = lower(p.developer_name)`;
    where.push(params.selfPublished ? predicate : `NOT (${predicate})`);
  }
  if (params.publisherSize) {
    const clauses = {
      indie: 'COALESCE(p.publisher_game_count, 0) <= 5',
      major: 'COALESCE(p.publisher_game_count, 0) > 50',
      mid: 'COALESCE(p.publisher_game_count, 0) > 5 AND COALESCE(p.publisher_game_count, 0) <= 50',
    };
    where.push(`(${clauses[params.publisherSize]})`);
  }
  if (hasItems(params.genres)) {
    const placeholder = addParam(values, params.genres);
    where.push(params.genreMode === 'all' ? `p.genre_ids @> ${placeholder}::int[]` : `p.genre_ids && ${placeholder}::int[]`);
  }
  if (hasItems(params.tags)) {
    const placeholder = addParam(values, params.tags);
    where.push(params.tagMode === 'all' ? `p.tag_ids @> ${placeholder}::int[]` : `p.tag_ids && ${placeholder}::int[]`);
  }
  if (hasItems(params.categories)) {
    where.push(`p.category_ids && ${addParam(values, params.categories)}::int[]`);
  }
  if (hasItems(params.platforms)) {
    const placeholder = addParam(values, params.platforms);
    where.push(params.platformMode === 'all' ? `p.platform_array @> ${placeholder}::text[]` : `p.platform_array && ${placeholder}::text[]`);
  }

  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  return Math.max(Math.floor(offset ?? 0), 0);
}

function getAggregateStatsCacheKey(params: AppsFilterParams): string {
  const statsParams: AppsFilterParams = {
    ...params,
    sort: 'ccu_peak',
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

export function isTigerReadConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TIGER_PRIMARY_URL || env.CHANGE_INTEL_TIGER_URL);
}

async function hasAppsPageProjection(): Promise<boolean> {
  if (appsPageProjectionAvailable !== null) {
    return appsPageProjectionAvailable;
  }

  const { rows } = await runTigerQuery<{ exists: boolean }>(
    `SELECT to_regclass('metrics.apps_page_projection') IS NOT NULL AS exists`,
    []
  );
  appsPageProjectionAvailable = rows[0]?.exists === true;
  return appsPageProjectionAvailable;
}

export function mapAppRpcRowToApp(row: AppRpcRow): App {
  return {
    appid: row.appid,
    name: row.name,
    type: row.type,
    is_free: row.is_free,
    is_delisted: (row.is_delisted as boolean | null | undefined) ?? false,
    ccu_peak: toNumber(row.ccu_peak) ?? 0,
    owners_min: toNumber(row.owners_min) ?? 0,
    owners_max: toNumber(row.owners_max) ?? 0,
    owners_midpoint: toNumber(row.owners_midpoint) ?? 0,
    total_reviews: toNumber(row.total_reviews) ?? 0,
    positive_reviews: toNumber(row.positive_reviews) ?? 0,
    review_score: toNumber(row.review_score),
    positive_percentage: toNumber(row.positive_percentage),
    price_cents: toNumber(row.price_cents),
    current_discount_percent: toNumber(row.current_discount_percent) ?? 0,
    average_playtime_forever: toNumber(row.average_playtime_forever),
    average_playtime_2weeks: toNumber(row.average_playtime_2weeks),
    ccu_growth_7d_percent: toNumber(row.ccu_growth_7d_percent),
    ccu_growth_30d_percent: toNumber(row.ccu_growth_30d_percent),
    ccu_tier: toNumber(row.ccu_tier) as CcuTier | null,
    velocity_7d: toNumber(row.velocity_7d),
    velocity_30d: toNumber(row.velocity_30d),
    velocity_tier: ((row.velocity_tier as string | null | undefined) ?? null) as VelocityTier | null,
    sentiment_delta: toNumber(row.sentiment_delta),
    momentum_score: toNumber(row.momentum_score),
    velocity_acceleration: toNumber(row.velocity_acceleration),
    active_player_pct: toNumber(row.active_player_pct),
    review_rate: toNumber(row.review_rate),
    value_score: toNumber(row.value_score),
    vs_publisher_avg: toNumber(row.vs_publisher_avg),
    release_date: toIsoDate(row.release_date),
    days_live: toNumber(row.days_live),
    hype_duration: toNumber(row.hype_duration),
    release_state: (row.release_state as string | null | undefined) ?? null,
    platforms: (row.platforms as string | null | undefined) ?? null,
    steam_deck_category: ((row.steam_deck_category as string | null | undefined) ?? null) as SteamDeckCategory | null,
    controller_support: (row.controller_support as App['controller_support'] | undefined) ?? null,
    publisher_id: toNumber(row.publisher_id),
    publisher_name: (row.publisher_name as string | null | undefined) ?? null,
    publisher_game_count: toNumber(row.publisher_game_count),
    developer_id: toNumber(row.developer_id),
    developer_name: (row.developer_name as string | null | undefined) ?? null,
    metric_date: toIsoDate(row.metric_date),
    data_updated_at: toIsoDate(row.data_updated_at),
  };
}

export async function getApps(params: AppsFilterParams): Promise<App[]> {
  if (await hasAppsPageProjection()) {
    return getAppsFromProjection(params);
  }

  if (
    isDefaultQuery(params) &&
    params.sort === 'ccu_peak' &&
    params.order === 'desc'
  ) {
    const values: SqlValue[] = [];
    const typeSql = params.type && params.type !== 'all'
      ? `AND COALESCE(a.type, 'game') = ${addParam(values, params.type)}`
      : '';
    const limitSql = addParam(values, normalizeLimit(params.limit));
    const offsetSql = addParam(values, normalizeOffset(params.offset));
    const fromSql = APP_FROM_SQL.replace(
      'FROM legacy.apps a',
      'FROM top_appids top JOIN legacy.apps a ON a.appid = top.appid'
    );
    const sql = `
      WITH top_appids AS (
        SELECT a.appid
        FROM legacy.latest_daily_metrics ldm
        JOIN legacy.apps a ON a.appid = ldm.appid
        WHERE ${ACTIVE_APPS_SQL}
        ${typeSql}
        ORDER BY ldm.ccu_peak DESC NULLS LAST, a.appid ASC
        LIMIT ${limitSql} OFFSET ${offsetSql}
      )
      SELECT ${appSelectSql('publisher_avg.vs_publisher_avg')}
      ${fromSql}
      ${publisherAverageJoinSql('a', 'ldm.review_score')}
      ORDER BY ccu_peak DESC NULLS LAST, a.appid ASC
    `;

    const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
    return rows.map(mapAppRpcRowToApp);
  }

  const values: SqlValue[] = [];
  if (params.minVsPublisher !== undefined || params.sort === 'vs_publisher_avg') {
    const whereSql = buildAggregateWhere(params, values);
    const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
    const limitSql = addParam(values, normalizeLimit(params.limit));
    const offsetSql = addParam(values, normalizeOffset(params.offset));
    const fromSql = APP_FROM_SQL.replace(
      'FROM legacy.apps a',
      'FROM selected_appids selected JOIN legacy.apps a ON a.appid = selected.appid'
    );
    const sql = `
      WITH ${PUBLISHER_SCORE_AVGS_CTE},
      publisher_primary AS (
        SELECT DISTINCT ON (ap.appid)
          ap.appid,
          ap.publisher_id
        FROM legacy.app_publishers ap
        JOIN legacy.publishers p ON p.id = ap.publisher_id
        ORDER BY ap.appid, p.game_count DESC NULLS LAST, p.name
      ),
      candidate_scores AS (
        SELECT
          a.appid,
          ROUND((ldm.review_score - publisher_score_avgs.publisher_avg_score)::numeric, 2) AS vs_publisher_avg
        FROM legacy.apps a
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
        LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
        LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
        LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
        LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
        LEFT JOIN publisher_primary ON publisher_primary.appid = a.appid
        LEFT JOIN publisher_score_avgs ON publisher_score_avgs.publisher_id = publisher_primary.publisher_id
        ${whereSql}
      ),
      selected_appids AS (
        SELECT appid, vs_publisher_avg
        FROM candidate_scores
        ORDER BY vs_publisher_avg ${orderSql} NULLS LAST, appid ASC
        LIMIT ${limitSql} OFFSET ${offsetSql}
      )
      SELECT ${appSelectSql('selected.vs_publisher_avg')}
      ${fromSql}
      ORDER BY selected.vs_publisher_avg ${orderSql} NULLS LAST, a.appid ASC
    `;

    const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
    return rows.map(mapAppRpcRowToApp);
  }

  const publisherSearch = params.publisherSearch?.trim();
  if (publisherSearch) {
    const publisherSearchPlaceholder = addParam(values, `%${publisherSearch}%`);
    const paramsWithoutPublisherSearch: AppsFilterParams = {
      ...params,
      publisherSearch: undefined,
    };
    const whereSql = buildAppsWhere(paramsWithoutPublisherSearch, values);
    const sortSql = SORT_SQL[params.sort] ?? SORT_SQL.ccu_peak;
    const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
    const limitSql = addParam(values, normalizeLimit(params.limit));
    const offsetSql = addParam(values, normalizeOffset(params.offset));
    const fromSql = APP_FROM_SQL.replace(
      'FROM legacy.apps a',
      'FROM candidate_appids candidate JOIN legacy.apps a ON a.appid = candidate.appid'
    );
    const sql = `
        WITH candidate_appids AS (
          SELECT DISTINCT ap.appid
          FROM legacy.app_publishers ap
          JOIN legacy.publishers p ON p.id = ap.publisher_id
          WHERE p.name ILIKE ${publisherSearchPlaceholder}
        ),
        app_rows AS (
          SELECT ${appSelectSql()}
          ${fromSql}
        ),
        selected_rows AS (
          SELECT *
          FROM app_rows
          ${whereSql}
          ORDER BY ${sortSql} ${orderSql} NULLS LAST, appid ASC
          LIMIT ${limitSql} OFFSET ${offsetSql}
        )
        SELECT selected_rows.*, publisher_avg.vs_publisher_avg
        FROM selected_rows
        ${publisherAverageJoinSql('selected_rows', 'selected_rows.review_score')}
        ORDER BY ${sortSql} ${orderSql} NULLS LAST, appid ASC
      `;

    const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
    return rows.map(mapAppRpcRowToApp);
  }

  const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
  const limitSql = addParam(values, normalizeLimit(params.limit));
  const offsetSql = addParam(values, normalizeOffset(params.offset));
  const directSortSql = DIRECT_SORT_SQL[params.sort as Exclude<AppsFilterParams['sort'], 'vs_publisher_avg'>] ?? DIRECT_SORT_SQL.ccu_peak;
  const directWhereSql = buildAggregateWhere(params, values);
  const fromSql = APP_FROM_SQL.replace(
    'FROM legacy.apps a',
    'FROM selected_rows selected JOIN legacy.apps a ON a.appid = selected.appid'
  );
  const sql = `
      WITH candidate_rows AS (
        SELECT
          a.appid,
          ${directSortSql} AS sort_value
        FROM legacy.apps a
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
        LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
        LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
        LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
        LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
        ${directWhereSql}
      ),
      selected_rows AS (
        SELECT appid, sort_value
        FROM candidate_rows
        ORDER BY sort_value ${orderSql} NULLS LAST, appid ASC
        LIMIT ${limitSql} OFFSET ${offsetSql}
      )
      SELECT ${appSelectSql('publisher_avg.vs_publisher_avg')}
      ${fromSql}
      ${publisherAverageJoinSql('a', 'ldm.review_score')}
      ORDER BY selected.sort_value ${orderSql} NULLS LAST, a.appid ASC
    `;

  const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
  return rows.map(mapAppRpcRowToApp);
}

async function getAppsFromProjection(params: AppsFilterParams): Promise<App[]> {
  const values: SqlValue[] = [];
  const whereSql = buildProjectionWhere(params, values);
  const sortSql = SORT_SQL[params.sort] ? `p.${SORT_SQL[params.sort]}` : 'p.ccu_peak';
  const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
  const limitSql = addParam(values, normalizeLimit(params.limit));
  const offsetSql = addParam(values, normalizeOffset(params.offset));
  const sql = `
    SELECT p.*
    FROM metrics.apps_page_projection p
    ${whereSql}
    ORDER BY ${sortSql} ${orderSql} NULLS LAST, p.appid ASC
    LIMIT ${limitSql} OFFSET ${offsetSql}
  `;
  const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
  return rows.map(mapAppRpcRowToApp);
}

/**
 * Check if params represent a "default" query with no filters applied
 * Used to determine if we can use the fast materialized view
 */
function isDefaultQuery(params: AppsFilterParams): boolean {
  return (
    !params.search &&
    params.minCcu === undefined &&
    params.maxCcu === undefined &&
    params.minOwners === undefined &&
    params.maxOwners === undefined &&
    params.minReviews === undefined &&
    params.maxReviews === undefined &&
    params.minScore === undefined &&
    params.maxScore === undefined &&
    params.minPrice === undefined &&
    params.maxPrice === undefined &&
    params.minPlaytime === undefined &&
    params.maxPlaytime === undefined &&
    params.minGrowth7d === undefined &&
    params.maxGrowth7d === undefined &&
    params.minGrowth30d === undefined &&
    params.maxGrowth30d === undefined &&
    params.minMomentum === undefined &&
    params.maxMomentum === undefined &&
    params.minSentimentDelta === undefined &&
    params.maxSentimentDelta === undefined &&
    !params.velocityTier &&
    params.minActivePct === undefined &&
    params.minReviewRate === undefined &&
    params.minValueScore === undefined &&
    (!params.genres || params.genres.length === 0) &&
    (!params.tags || params.tags.length === 0) &&
    (!params.categories || params.categories.length === 0) &&
    !params.hasWorkshop &&
    (!params.platforms || params.platforms.length === 0) &&
    !params.steamDeck &&
    !params.controller &&
    params.minAge === undefined &&
    params.maxAge === undefined &&
    !params.releaseYear &&
    params.earlyAccess === undefined &&
    params.minHype === undefined &&
    params.maxHype === undefined &&
    !params.publisherSearch &&
    !params.developerSearch &&
    params.selfPublished === undefined &&
    params.minVsPublisher === undefined &&
    !params.publisherSize &&
    !params.ccuTier &&
    params.isFree === undefined &&
    params.minDiscount === undefined
  );
}

/**
 * Fetch aggregate statistics for filtered apps
 * Fetch aggregate statistics for filtered apps from Tiger.
 */
export async function getAggregateStats(
  params: AppsFilterParams
): Promise<AggregateStats> {
  const cacheKey = getAggregateStatsCacheKey(params);
  const cachedStats = readAggregateStatsCache(cacheKey);
  if (cachedStats) {
    return cachedStats;
  }

  if (await hasAppsPageProjection()) {
    const stats = await getAggregateStatsFromProjection(params);
    writeAggregateStatsCache(cacheKey, stats);
    return stats;
  }

  if (isDefaultQuery(params)) {
    const values: SqlValue[] = [];
    const typeSql = params.type && params.type !== 'all'
      ? `AND COALESCE(a.type, 'game') = ${addParam(values, params.type)}`
      : '';
    const sql = `
      SELECT
        COUNT(*)::integer AS total_games,
        AVG(COALESCE(ldm.ccu_peak, 0))::numeric AS avg_ccu,
        AVG(ldm.review_score)::numeric AS avg_score,
        AVG(
          CASE
            WHEN cta.ccu_growth_7d_percent IS NOT NULL
              THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
                CASE
                  WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
                    THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
                  ELSE 0
                END,
                0
              )) / 2, 2)
            ELSE NULL
          END
        )::numeric AS avg_momentum,
        COUNT(*) FILTER (WHERE cta.ccu_growth_7d_percent >= 10)::integer AS trending_up_count,
        COUNT(*) FILTER (WHERE cta.ccu_growth_7d_percent <= -10)::integer AS trending_down_count,
        COUNT(*) FILTER (
          WHERE COALESCE((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 0) > 1
        )::integer AS sentiment_improving_count,
        COUNT(*) FILTER (
          WHERE COALESCE((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 0) < -1
        )::integer AS sentiment_declining_count,
        AVG(
          CASE
            WHEN COALESCE(ldm.price_cents, a.current_price_cents, 0) > 0 AND ldm.review_score IS NOT NULL
              THEN ((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (COALESCE(ldm.price_cents, a.current_price_cents)::numeric / 100))::numeric
            ELSE NULL
          END
        )::numeric AS avg_value_score
      FROM legacy.apps a
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
      LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
      LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
      LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
      WHERE ${ACTIVE_APPS_SQL}
      ${typeSql}
    `;
    const { rows } = await runTigerQuery<AggregateStatsRow>(sql, values as unknown[]);
    const row = rows[0];
    const stats = {
      total_games: Number(row?.total_games) || 0,
      avg_ccu: toNumber(row?.avg_ccu),
      avg_score: toNumber(row?.avg_score),
      avg_momentum: toNumber(row?.avg_momentum),
      trending_up_count: Number(row?.trending_up_count) || 0,
      trending_down_count: Number(row?.trending_down_count) || 0,
      sentiment_improving_count: Number(row?.sentiment_improving_count) || 0,
      sentiment_declining_count: Number(row?.sentiment_declining_count) || 0,
      avg_value_score: toNumber(row?.avg_value_score),
    };
    writeAggregateStatsCache(cacheKey, stats);
    return stats;
  }

  const values: SqlValue[] = [];
  const whereSql = buildAggregateWhere(params, values);
  const includePublisherAverage = params.minVsPublisher !== undefined;
  const publisherAverageCteSql = includePublisherAverage
    ? `
      ${PUBLISHER_SCORE_AVGS_CTE},
      publisher_primary AS (
        SELECT DISTINCT ON (ap.appid)
          ap.appid,
          ap.publisher_id
        FROM legacy.app_publishers ap
        JOIN legacy.publishers p ON p.id = ap.publisher_id
        ORDER BY ap.appid, p.game_count DESC NULLS LAST, p.name
      ),
    `
    : '';
  const sql = `
    WITH ${publisherAverageCteSql}
    filtered_app_metrics AS (
      SELECT
        a.appid,
        COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
        ldm.review_score,
        cta.ccu_growth_7d_percent AS ccu_growth_7d_percent,
        CASE
          WHEN cta.ccu_growth_7d_percent IS NOT NULL
            THEN ROUND((cta.ccu_growth_7d_percent + COALESCE(
              CASE
                WHEN rvs.velocity_30d IS NOT NULL AND rvs.velocity_30d > 0
                  THEN ((rvs.velocity_7d - rvs.velocity_30d) / rvs.velocity_30d) * 100
                ELSE 0
              END,
              0
            )) / 2, 2)
          ELSE NULL
        END AS momentum_score,
        ROUND((trends.current_positive_ratio - trends.previous_positive_ratio) * 100, 2) AS sentiment_delta,
        CASE
          WHEN COALESCE(ldm.price_cents, a.current_price_cents, 0) > 0 AND ldm.review_score IS NOT NULL
            THEN ROUND(((ldm.review_score::numeric * LN(GREATEST(ldm.total_reviews, 1) + 1)) / (COALESCE(ldm.price_cents, a.current_price_cents)::numeric / 100))::numeric, 2)
          ELSE NULL
        END AS value_score
      FROM legacy.apps a
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
      LEFT JOIN metrics.review_velocity_stats rvs ON rvs.appid = a.appid
      LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
      LEFT JOIN ops.ccu_tier_assignments cta ON cta.appid = a.appid
      LEFT JOIN legacy.app_steam_deck sd ON sd.appid = a.appid
      ${includePublisherAverage ? 'LEFT JOIN publisher_primary ON publisher_primary.appid = a.appid LEFT JOIN publisher_score_avgs ON publisher_score_avgs.publisher_id = publisher_primary.publisher_id' : ''}
      ${whereSql}
    )
    SELECT
      COUNT(*)::integer AS total_games,
      AVG(ccu_peak)::numeric AS avg_ccu,
      AVG(review_score)::numeric AS avg_score,
      AVG(momentum_score)::numeric AS avg_momentum,
      COUNT(*) FILTER (WHERE ccu_growth_7d_percent >= 10)::integer AS trending_up_count,
      COUNT(*) FILTER (WHERE ccu_growth_7d_percent <= -10)::integer AS trending_down_count,
      COUNT(*) FILTER (WHERE COALESCE(sentiment_delta, 0) > 1)::integer AS sentiment_improving_count,
      COUNT(*) FILTER (WHERE COALESCE(sentiment_delta, 0) < -1)::integer AS sentiment_declining_count,
      AVG(value_score)::numeric AS avg_value_score
    FROM filtered_app_metrics
  `;

  const { rows } = await runTigerQuery<AggregateStatsRow>(sql, values as unknown[]);
  const row = rows[0];
  if (!row) {
    const emptyStats = {
      total_games: 0,
      avg_ccu: null,
      avg_score: null,
      avg_momentum: null,
      trending_up_count: 0,
      trending_down_count: 0,
      sentiment_improving_count: 0,
      sentiment_declining_count: 0,
      avg_value_score: null,
    };
    writeAggregateStatsCache(cacheKey, emptyStats);
    return emptyStats;
  }
  const stats = {
    total_games: Number(row.total_games) || 0,
    avg_ccu: toNumber(row.avg_ccu),
    avg_score: toNumber(row.avg_score),
    avg_momentum: toNumber(row.avg_momentum),
    trending_up_count: Number(row.trending_up_count) || 0,
    trending_down_count: Number(row.trending_down_count) || 0,
    sentiment_improving_count: Number(row.sentiment_improving_count) || 0,
    sentiment_declining_count: Number(row.sentiment_declining_count) || 0,
    avg_value_score: toNumber(row.avg_value_score),
  };
  writeAggregateStatsCache(cacheKey, stats);
  return stats;
}

async function getAggregateStatsFromProjection(params: AppsFilterParams): Promise<AggregateStats> {
  const values: SqlValue[] = [];
  const whereSql = buildProjectionWhere(params, values);
  const sql = `
    SELECT
      COUNT(*)::integer AS total_games,
      AVG(p.ccu_peak)::numeric AS avg_ccu,
      AVG(p.review_score)::numeric AS avg_score,
      AVG(p.momentum_score)::numeric AS avg_momentum,
      COUNT(*) FILTER (WHERE p.ccu_growth_7d_percent >= 10)::integer AS trending_up_count,
      COUNT(*) FILTER (WHERE p.ccu_growth_7d_percent <= -10)::integer AS trending_down_count,
      COUNT(*) FILTER (WHERE COALESCE(p.sentiment_delta, 0) > 1)::integer AS sentiment_improving_count,
      COUNT(*) FILTER (WHERE COALESCE(p.sentiment_delta, 0) < -1)::integer AS sentiment_declining_count,
      AVG(p.value_score)::numeric AS avg_value_score
    FROM metrics.apps_page_projection p
    ${whereSql}
  `;
  const { rows } = await runTigerQuery<AggregateStatsRow>(sql, values as unknown[]);
  const row = rows[0];
  return {
    total_games: Number(row?.total_games) || 0,
    avg_ccu: toNumber(row?.avg_ccu),
    avg_score: toNumber(row?.avg_score),
    avg_momentum: toNumber(row?.avg_momentum),
    trending_up_count: Number(row?.trending_up_count) || 0,
    trending_down_count: Number(row?.trending_down_count) || 0,
    sentiment_improving_count: Number(row?.sentiment_improving_count) || 0,
    sentiment_declining_count: Number(row?.sentiment_declining_count) || 0,
    avg_value_score: toNumber(row?.avg_value_score),
  };
}

/**
 * Format large numbers compactly (e.g., 1.2M, 5.6K)
 */
export function formatCompactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Format price in cents to USD string (e.g., $19.99)
 */
export function formatPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return 'Free';
  const usd = cents / 100;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format percentage (e.g., 85%)
 */
export function formatPercentage(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n)}%`;
}

/**
 * Format playtime from minutes to hours
 */
export function formatPlaytime(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === 0) return '—';
  const hours = minutes / 60;
  if (hours >= 100) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

/**
 * Get user-facing label for app type
 */
export function getAppTypeLabel(type: string): string {
  switch (type) {
    case 'game':
      return 'Game';
    case 'dlc':
      return 'DLC';
    case 'demo':
      return 'Demo';
    case 'mod':
      return 'Mod';
    case 'video':
      return 'Video';
    case 'hardware':
      return 'Hardware';
    case 'music':
      return 'Music';
    default:
      return type;
  }
}

/**
 * Fetch specific apps by their IDs for comparison mode
 * Preserves order of input IDs in output
 *
 * Fetch specific apps by ID from Tiger in a single database round trip.
 */
export async function getAppsByIds(appids: number[]): Promise<App[]> {
  if (appids.length === 0) return [];

  const uniqueAppids = [...new Set(appids.filter(Number.isFinite))];
  if (uniqueAppids.length === 0) return [];

  const values: SqlValue[] = [uniqueAppids];
  const sql = `
    SELECT ${appSelectSql('publisher_avg.vs_publisher_avg')}
    ${APP_FROM_SQL}
    ${publisherAverageJoinSql('a', 'ldm.review_score')}
    WHERE a.appid = ANY($1::int[])
  `;

  const { rows } = await runTigerQuery<AppRpcRow>(sql, values as unknown[]);
  if (rows.length === 0) return [];

  // Transform Tiger result to App shape and preserve order
  const appsMap = new Map<number, App>();

  for (const row of rows) {
    const app = mapAppRpcRowToApp(row);
    appsMap.set(app.appid, app);
  }

  // Return in original order
  return appids.map((id) => appsMap.get(id)).filter((app): app is App => !!app);
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function shouldOverlayFreshReviews(app: App, overlay: FreshReviewOverlay | undefined): boolean {
  if (!overlay) {
    return false;
  }

  const overlayMetricDateMs = parseTimestamp(overlay.metricDate);
  const appMetricDateMs = parseTimestamp(app.metric_date);

  if (overlayMetricDateMs !== null && (appMetricDateMs === null || overlayMetricDateMs > appMetricDateMs)) {
    return true;
  }

  const appReviewsMissingOrZero = app.total_reviews === 0 || app.positive_reviews === 0;
  const lastReviewsSyncMs = parseTimestamp(overlay.lastReviewsSync);

  return Boolean(
    appReviewsMissingOrZero &&
      lastReviewsSyncMs !== null &&
      (appMetricDateMs === null || lastReviewsSyncMs > appMetricDateMs)
  );
}

function applyFreshReviewOverlay(app: App, overlay: FreshReviewOverlay | undefined): App {
  if (!shouldOverlayFreshReviews(app, overlay) || !overlay) {
    return app;
  }

  const totalReviews = overlay.totalReviews ?? app.total_reviews;
  const positiveReviews = overlay.positiveReviews ?? app.positive_reviews;
  const positivePercentage =
    totalReviews !== null && positiveReviews !== null && totalReviews > 0
      ? Number(((positiveReviews / totalReviews) * 100).toFixed(2))
      : null;

  return {
    ...app,
    total_reviews: totalReviews ?? 0,
    positive_reviews: positiveReviews ?? 0,
    review_score: overlay.reviewScore ?? app.review_score,
    positive_percentage: positivePercentage,
    metric_date: overlay.metricDate,
  };
}

async function loadFreshReviewOverlays(appids: number[]): Promise<Map<number, FreshReviewOverlay>> {
  if (appids.length === 0) {
    return new Map();
  }

  const [{ rows: metricRows }, { rows: syncRows }] = await Promise.all([
    runTigerQuery<LatestReviewMetricRow>(
      `
        SELECT DISTINCT ON (appid)
          appid,
          metric_date,
          total_reviews,
          positive_reviews,
          review_score
        FROM metrics.daily_metrics
        WHERE appid = ANY($1::int[])
        ORDER BY appid, metric_date DESC
      `,
      [appids]
    ),
    runTigerQuery<ReviewSyncStatusRow>(
      `
        SELECT appid, last_reviews_sync
        FROM ops.sync_status
        WHERE appid = ANY($1::int[])
      `,
      [appids]
    ),
  ]);

  const latestMetricByAppid = new Map<number, LatestReviewMetricRow>();
  for (const row of metricRows) {
    if (!latestMetricByAppid.has(row.appid)) {
      latestMetricByAppid.set(row.appid, row);
    }
  }

  const syncByAppid = new Map<number, ReviewSyncStatusRow>();
  for (const row of syncRows) {
    syncByAppid.set(row.appid, row);
  }

  const overlays = new Map<number, FreshReviewOverlay>();
  for (const appid of appids) {
    const metric = latestMetricByAppid.get(appid);
    if (!metric) {
      continue;
    }

    overlays.set(appid, {
      metricDate: toIsoDate(metric.metric_date) ?? '',
      totalReviews: metric.total_reviews,
      positiveReviews: metric.positive_reviews,
      reviewScore: metric.review_score,
      lastReviewsSync: toIsoDate(syncByAppid.get(appid)?.last_reviews_sync) ?? null,
    });
  }

  return overlays;
}

export async function getAppsByIdsWithFreshReviews(appids: number[]): Promise<App[]> {
  const apps = await getAppsByIds(appids);
  if (apps.length === 0) {
    return apps;
  }

  const overlays = await loadFreshReviewOverlays(appids);
  return apps.map((app) => applyFreshReviewOverlay(app, overlays.get(app.appid)));
}
