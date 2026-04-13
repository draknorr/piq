import { getServiceSupabase } from '@/lib/supabase-service';
import type { App, AppsFilterParams, AggregateStats, CcuTier, VelocityTier, SteamDeckCategory } from './apps-types';

/**
 * Aggregate stats row shape from RPC
 * Typed here until database types are regenerated after migration
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

export function mapAppRpcRowToApp(row: AppRpcRow): App {
  return {
    appid: row.appid,
    name: row.name,
    type: row.type,
    is_free: row.is_free,
    is_delisted: (row.is_delisted as boolean | null | undefined) ?? false,
    ccu_peak: (row.ccu_peak as number | null | undefined) ?? 0,
    owners_min: (row.owners_min as number | null | undefined) ?? 0,
    owners_max: (row.owners_max as number | null | undefined) ?? 0,
    owners_midpoint: (row.owners_midpoint as number | null | undefined) ?? 0,
    total_reviews: (row.total_reviews as number | null | undefined) ?? 0,
    positive_reviews: (row.positive_reviews as number | null | undefined) ?? 0,
    review_score: (row.review_score as number | null | undefined) ?? null,
    positive_percentage: (row.positive_percentage as number | null | undefined) ?? null,
    price_cents: (row.price_cents as number | null | undefined) ?? null,
    current_discount_percent: (row.current_discount_percent as number | null | undefined) ?? 0,
    average_playtime_forever: (row.average_playtime_forever as number | null | undefined) ?? null,
    average_playtime_2weeks: (row.average_playtime_2weeks as number | null | undefined) ?? null,
    ccu_growth_7d_percent: (row.ccu_growth_7d_percent as number | null | undefined) ?? null,
    ccu_growth_30d_percent: (row.ccu_growth_30d_percent as number | null | undefined) ?? null,
    ccu_tier: ((row.ccu_tier as number | null | undefined) ?? null) as CcuTier | null,
    velocity_7d: (row.velocity_7d as number | null | undefined) ?? null,
    velocity_30d: (row.velocity_30d as number | null | undefined) ?? null,
    velocity_tier: ((row.velocity_tier as string | null | undefined) ?? null) as VelocityTier | null,
    sentiment_delta: (row.sentiment_delta as number | null | undefined) ?? null,
    momentum_score: (row.momentum_score as number | null | undefined) ?? null,
    velocity_acceleration: (row.velocity_acceleration as number | null | undefined) ?? null,
    active_player_pct: (row.active_player_pct as number | null | undefined) ?? null,
    review_rate: (row.review_rate as number | null | undefined) ?? null,
    value_score: (row.value_score as number | null | undefined) ?? null,
    vs_publisher_avg: (row.vs_publisher_avg as number | null | undefined) ?? null,
    release_date: (row.release_date as string | null | undefined) ?? null,
    days_live: (row.days_live as number | null | undefined) ?? null,
    hype_duration: (row.hype_duration as number | null | undefined) ?? null,
    release_state: (row.release_state as string | null | undefined) ?? null,
    platforms: (row.platforms as string | null | undefined) ?? null,
    steam_deck_category: ((row.steam_deck_category as string | null | undefined) ?? null) as SteamDeckCategory | null,
    controller_support: (row.controller_support as App['controller_support'] | undefined) ?? null,
    publisher_id: (row.publisher_id as number | null | undefined) ?? null,
    publisher_name: (row.publisher_name as string | null | undefined) ?? null,
    publisher_game_count: (row.publisher_game_count as number | null | undefined) ?? null,
    developer_id: (row.developer_id as number | null | undefined) ?? null,
    developer_name: (row.developer_name as string | null | undefined) ?? null,
    metric_date: (row.metric_date as string | null | undefined) ?? null,
    data_updated_at: (row.data_updated_at as string | null | undefined) ?? null,
  };
}

/**
 * Fetch apps from the database using the unified RPC
 * Note: Uses type assertion until database types are regenerated after migration
 */
export async function getApps(params: AppsFilterParams): Promise<App[]> {
  const supabase = getServiceSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_apps_with_filters', {
    p_type: params.type,
    p_sort_field: params.sort,
    p_sort_order: params.order,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_search: params.search,
    // Metric filters
    p_min_ccu: params.minCcu,
    p_max_ccu: params.maxCcu,
    p_min_owners: params.minOwners,
    p_max_owners: params.maxOwners,
    p_min_reviews: params.minReviews,
    p_max_reviews: params.maxReviews,
    p_min_score: params.minScore,
    p_max_score: params.maxScore,
    p_min_price: params.minPrice,
    p_max_price: params.maxPrice,
    p_min_playtime: params.minPlaytime,
    p_max_playtime: params.maxPlaytime,
    // Growth filters
    p_min_growth_7d: params.minGrowth7d,
    p_max_growth_7d: params.maxGrowth7d,
    p_min_growth_30d: params.minGrowth30d,
    p_max_growth_30d: params.maxGrowth30d,
    p_min_momentum: params.minMomentum,
    p_max_momentum: params.maxMomentum,
    // Sentiment filters
    p_min_sentiment_delta: params.minSentimentDelta,
    p_max_sentiment_delta: params.maxSentimentDelta,
    p_velocity_tier: params.velocityTier,
    // Engagement filters
    p_min_active_pct: params.minActivePct,
    p_min_review_rate: params.minReviewRate,
    p_min_value_score: params.minValueScore,
    // Content filters
    p_genres: params.genres,
    p_genre_mode: params.genreMode ?? 'any',
    p_tags: params.tags,
    p_tag_mode: params.tagMode ?? 'any',
    p_categories: params.categories,
    p_has_workshop: params.hasWorkshop,
    // Platform filters
    p_platforms: params.platforms,
    p_platform_mode: params.platformMode ?? 'any',
    p_steam_deck: params.steamDeck,
    p_controller: params.controller,
    // Release filters
    p_min_age: params.minAge,
    p_max_age: params.maxAge,
    p_release_year: params.releaseYear,
    p_early_access: params.earlyAccess,
    p_min_hype: params.minHype,
    p_max_hype: params.maxHype,
    // Relationship filters
    p_publisher_search: params.publisherSearch,
    p_developer_search: params.developerSearch,
    p_self_published: params.selfPublished,
    p_min_vs_publisher: params.minVsPublisher,
    p_publisher_size: params.publisherSize,
    // Activity filters
    p_ccu_tier: params.ccuTier,
    // Boolean filters
    p_is_free: params.isFree,
    // Discount filter
    p_min_discount: params.minDiscount,
  });

  if (error) {
    console.error('Error fetching apps:', error);
    throw new Error(`Failed to fetch apps: ${error.message}`);
  }

  return (data ?? []) as App[];
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
 * Uses pre-computed materialized view for default queries (~400ms)
 * Falls back to RPC for filtered queries (~2.8s)
 */
export async function getAggregateStats(
  params: AppsFilterParams
): Promise<AggregateStats> {
  const supabase = getServiceSupabase();
  const appType = params.type || 'game';

  // For default queries (no filters), use the fast materialized view
  if (isDefaultQuery(params)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('mv_apps_aggregate_stats')
      .select('*')
      .eq('app_type', appType)
      .single();

    if (!error && data) {
      return {
        total_games: Number(data.total_games) || 0,
        avg_ccu: data.avg_ccu ? Number(data.avg_ccu) : null,
        avg_score: data.avg_score ? Number(data.avg_score) : null,
        avg_momentum: data.avg_momentum ? Number(data.avg_momentum) : null,
        trending_up_count: Number(data.trending_up_count) || 0,
        trending_down_count: Number(data.trending_down_count) || 0,
        sentiment_improving_count: Number(data.sentiment_improving_count) || 0,
        sentiment_declining_count: Number(data.sentiment_declining_count) || 0,
        avg_value_score: data.avg_value_score ? Number(data.avg_value_score) : null,
      };
    }
    // If materialized view query fails, fall through to RPC
    console.warn('Materialized view query failed, falling back to RPC:', error?.message);
  }

  // For filtered queries, use the RPC with full filter set
  // Bug #3 fix: Pass all filters to ensure stats match table results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_apps_aggregate_stats', {
    p_type: params.type,
    p_search: params.search,
    // Metric filters
    p_min_ccu: params.minCcu,
    p_max_ccu: params.maxCcu,
    p_min_owners: params.minOwners,
    p_max_owners: params.maxOwners,
    p_min_reviews: params.minReviews,
    p_max_reviews: params.maxReviews,
    p_min_score: params.minScore,
    p_max_score: params.maxScore,
    p_min_price: params.minPrice,
    p_max_price: params.maxPrice,
    p_min_playtime: params.minPlaytime,
    p_max_playtime: params.maxPlaytime,
    p_is_free: params.isFree,
    p_min_discount: params.minDiscount,
    // Growth filters
    p_min_growth_7d: params.minGrowth7d,
    p_max_growth_7d: params.maxGrowth7d,
    p_min_growth_30d: params.minGrowth30d,
    p_max_growth_30d: params.maxGrowth30d,
    p_min_momentum: params.minMomentum,
    p_max_momentum: params.maxMomentum,
    // Sentiment filters
    p_min_sentiment_delta: params.minSentimentDelta,
    p_max_sentiment_delta: params.maxSentimentDelta,
    p_velocity_tier: params.velocityTier,
    // Engagement filters
    p_min_active_pct: params.minActivePct,
    p_min_review_rate: params.minReviewRate,
    p_min_value_score: params.minValueScore,
    p_min_vs_publisher: params.minVsPublisher,
    // Content filters
    p_genres: params.genres,
    p_genre_mode: params.genreMode ?? 'all',
    p_tags: params.tags,
    p_tag_mode: params.tagMode ?? 'all',
    p_categories: params.categories,
    p_has_workshop: params.hasWorkshop,
    // Platform filters
    p_platforms: params.platforms,
    p_platform_mode: params.platformMode ?? 'all',
    p_steam_deck: params.steamDeck,
    p_controller: params.controller,
    // Release filters
    p_min_age: params.minAge,
    p_max_age: params.maxAge,
    p_release_year: params.releaseYear,
    p_early_access: params.earlyAccess,
    p_min_hype: params.minHype,
    p_max_hype: params.maxHype,
    // Relationship filters
    p_publisher_search: params.publisherSearch,
    p_developer_search: params.developerSearch,
    p_self_published: params.selfPublished,
    p_publisher_size: params.publisherSize,
    // Activity filters
    p_ccu_tier: params.ccuTier,
  });

  if (error) {
    console.error('Error fetching aggregate stats:', error);
    return {
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
  }

  // RPC returns a single row
  const rows = (data ?? []) as AggregateStatsRow[];
  const row = rows[0];
  if (!row) {
    return {
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
  }
  return {
    total_games: Number(row.total_games) || 0,
    avg_ccu: row.avg_ccu ? Number(row.avg_ccu) : null,
    avg_score: row.avg_score ? Number(row.avg_score) : null,
    avg_momentum: row.avg_momentum ? Number(row.avg_momentum) : null,
    trending_up_count: Number(row.trending_up_count) || 0,
    trending_down_count: Number(row.trending_down_count) || 0,
    sentiment_improving_count: Number(row.sentiment_improving_count) || 0,
    sentiment_declining_count: Number(row.sentiment_declining_count) || 0,
    avg_value_score: row.avg_value_score ? Number(row.avg_value_score) : null,
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
 * Uses the optimized get_apps_by_ids RPC that consolidates
 * 5 sequential queries into a single database round-trip.
 * Expected performance: ~100ms vs ~500ms with individual queries.
 */
export async function getAppsByIds(appids: number[]): Promise<App[]> {
  if (appids.length === 0) return [];

  const supabase = getServiceSupabase();

  // Use the optimized RPC that returns all data in one query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_apps_by_ids', {
    p_appids: appids,
  });

  if (error) {
    console.error('Error fetching apps by IDs:', error);
    throw new Error(`Failed to fetch apps by IDs: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  // Transform RPC result to App shape and preserve order
  const appsMap = new Map<number, App>();

  for (const row of data) {
    const app = mapAppRpcRowToApp(row as AppRpcRow);
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

  const supabase = getServiceSupabase();

  const [{ data: metricRows, error: metricsError }, { data: syncRows, error: syncError }] =
    await Promise.all([
      supabase
        .from('daily_metrics')
        .select('appid, metric_date, total_reviews, positive_reviews, review_score')
        .in('appid', appids)
        .order('metric_date', { ascending: false }),
      supabase
        .from('sync_status')
        .select('appid, last_reviews_sync')
        .in('appid', appids),
    ]);

  if (metricsError) {
    throw new Error(`Failed to fetch latest review metrics: ${metricsError.message}`);
  }

  if (syncError) {
    throw new Error(`Failed to fetch review sync status: ${syncError.message}`);
  }

  const latestMetricByAppid = new Map<number, LatestReviewMetricRow>();
  for (const row of (metricRows ?? []) as LatestReviewMetricRow[]) {
    if (!latestMetricByAppid.has(row.appid)) {
      latestMetricByAppid.set(row.appid, row);
    }
  }

  const syncByAppid = new Map<number, ReviewSyncStatusRow>();
  for (const row of (syncRows ?? []) as ReviewSyncStatusRow[]) {
    syncByAppid.set(row.appid, row);
  }

  const overlays = new Map<number, FreshReviewOverlay>();
  for (const appid of appids) {
    const metric = latestMetricByAppid.get(appid);
    if (!metric) {
      continue;
    }

    overlays.set(appid, {
      metricDate: metric.metric_date,
      totalReviews: metric.total_reviews,
      positiveReviews: metric.positive_reviews,
      reviewScore: metric.review_score,
      lastReviewsSync: syncByAppid.get(appid)?.last_reviews_sync ?? null,
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
