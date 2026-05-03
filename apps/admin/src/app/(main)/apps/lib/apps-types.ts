/**
 * TypeScript types for the Games (Apps) page
 * User-facing: "Games" | Technical: "apps"
 */

/**
 * App type filter values
 * URL: ?type=game (default) | ?type=all | ?type=dlc | ?type=demo
 */
export type AppType = 'all' | 'game' | 'dlc' | 'demo';

/**
 * Sort field options (server-side supported)
 */
export type SortField =
  | 'ccu_peak'
  | 'owners_midpoint'
  | 'total_reviews'
  | 'review_score'
  | 'price_cents'
  | 'ccu_growth_7d_percent'
  | 'ccu_growth_30d_percent'
  | 'momentum_score'
  | 'sentiment_delta'
  | 'velocity_7d'
  | 'active_player_pct'
  | 'review_rate'
  | 'value_score'
  | 'vs_publisher_avg'
  | 'release_date'
  | 'days_live';

export type SortOrder = 'asc' | 'desc';

/**
 * Preset view IDs (12 total)
 * Presets clear other filters and apply their own filters + sort
 */
export type PresetId =
  | 'top_games'
  | 'rising_stars'
  | 'hidden_gems'
  | 'new_releases'
  | 'breakout_hits'
  | 'high_momentum'
  | 'comeback_stories'
  | 'evergreen'
  | 'true_gems'
  | 'best_value'
  | 'publishers_best'
  | 'f2p_leaders';

/**
 * Quick filter IDs (12 total)
 * Quick filters are stackable (AND logic)
 */
export type QuickFilterId =
  | 'popular'
  | 'trending'
  | 'well_reviewed'
  | 'free'
  | 'indie'
  | 'steam_deck'
  | 'momentum_up'
  | 'sentiment_up'
  | 'workshop'
  | 'early_access'
  | 'on_sale'
  | 'this_week';

/**
 * Unified filter ID (preset or quick filter)
 * Used in the unified filter bar
 */
export type UnifiedFilterId = PresetId | QuickFilterId;

/**
 * Publisher size filter values
 */
export type PublisherSize = 'indie' | 'mid' | 'major';

/**
 * Velocity tier from review_velocity_stats
 */
export type VelocityTier = 'high' | 'medium' | 'low' | 'dormant';

/**
 * CCU tier from ccu_tier_assignments
 * Tier 1 = Hot (top 500), Tier 2 = Active (top 1000 new), Tier 3 = Quiet
 */
export type CcuTier = 1 | 2 | 3;

/**
 * Steam Deck compatibility category
 */
export type SteamDeckCategory = 'verified' | 'playable' | 'unsupported' | 'unknown';

/**
 * Controller support level
 */
export type ControllerSupport = 'full' | 'partial' | null;

/**
 * Filter mode for multi-select filters (any = OR, all = AND)
 */
export type FilterMode = 'any' | 'all';

/**
 * Filter option from the Tiger-backed filter-count endpoint
 */
export interface FilterOption {
  option_id: number;
  option_name: string;
  app_count: number;
}

/**
 * App data returned from Tiger-backed apps queries
 */
export interface App {
  appid: number;
  name: string;
  type: string;
  is_free: boolean;
  is_delisted: boolean;

  // Core metrics
  ccu_peak: number;
  owners_min: number;
  owners_max: number;
  owners_midpoint: number;
  total_reviews: number;
  positive_reviews: number;
  review_score: number | null;
  positive_percentage: number | null;
  price_cents: number | null;
  current_discount_percent: number;
  average_playtime_forever: number | null;
  average_playtime_2weeks: number | null;

  // Growth metrics (pre-computed)
  ccu_growth_7d_percent: number | null;
  ccu_growth_30d_percent: number | null;
  ccu_tier: CcuTier | null;

  // Velocity metrics
  velocity_7d: number | null;
  velocity_30d: number | null;
  velocity_tier: VelocityTier | null;

  // Computed metrics
  sentiment_delta: number | null;
  momentum_score: number | null;
  velocity_acceleration: number | null;
  active_player_pct: number | null;
  review_rate: number | null;
  value_score: number | null;
  vs_publisher_avg: number | null;

  // Release info
  release_date: string | null;
  days_live: number | null;
  hype_duration: number | null;
  release_state: string | null;

  // Platform info
  platforms: string | null;
  steam_deck_category: SteamDeckCategory | null;
  controller_support: ControllerSupport;

  // Relationship info
  publisher_id: number | null;
  publisher_name: string | null;
  publisher_game_count: number | null;
  developer_id: number | null;
  developer_name: string | null;

  // Timestamps
  metric_date: string | null;
  data_updated_at: string | null;
}

/**
 * Filter parameters for the Apps page
 */
export interface AppsFilterParams {
  type: AppType;
  sort: SortField;
  order: SortOrder;
  limit?: number;
  offset?: number;
  search?: string;

  // Metric ranges
  minCcu?: number;
  maxCcu?: number;
  minOwners?: number;
  maxOwners?: number;
  minReviews?: number;
  maxReviews?: number;
  minScore?: number;
  maxScore?: number;
  minPrice?: number;
  maxPrice?: number;
  minPlaytime?: number;
  maxPlaytime?: number;

  // Growth filters
  minGrowth7d?: number;
  maxGrowth7d?: number;
  minGrowth30d?: number;
  maxGrowth30d?: number;
  minMomentum?: number;
  maxMomentum?: number;

  // Sentiment filters
  minSentimentDelta?: number;
  maxSentimentDelta?: number;
  velocityTier?: VelocityTier;

  // Engagement filters
  minActivePct?: number;
  minReviewRate?: number;
  minValueScore?: number;

  // Content filters
  genres?: number[];
  genreMode?: 'any' | 'all';
  tags?: number[];
  tagMode?: 'any' | 'all';
  categories?: number[];
  hasWorkshop?: boolean;

  // Boolean filters
  isFree?: boolean;

  // Discount filters
  minDiscount?: number;

  // Platform filters
  platforms?: string[];
  platformMode?: 'any' | 'all';
  steamDeck?: string;
  controller?: string;

  // Release filters
  minAge?: number;
  maxAge?: number;
  releaseYear?: number;
  earlyAccess?: boolean;
  minHype?: number;
  maxHype?: number;

  // Relationship filters
  publisherSearch?: string;
  developerSearch?: string;
  selfPublished?: boolean;
  minVsPublisher?: number;
  publisherSize?: 'indie' | 'mid' | 'major';

  // Activity filters
  ccuTier?: CcuTier;
}

/**
 * Search params shape from URL
 */
export interface AppsSearchParams {
  type?: string;
  sort?: string;
  order?: string;
  search?: string;
  // M3: Presets and quick filters
  preset?: string;
  filters?: string; // comma-separated quick filter IDs
  // M6a: Compare mode
  compare?: string; // comma-separated appids: "730,1245620,553850"
  // Metric filters (populated by presets/quick filters)
  minCcu?: string;
  maxCcu?: string;
  minOwners?: string;
  maxOwners?: string;
  minReviews?: string;
  minScore?: string;
  minGrowth7d?: string;
  maxGrowth7d?: string;
  minMomentum?: string;
  minSentimentDelta?: string;
  minReviewRate?: string;
  minValueScore?: string;
  minVsPublisher?: string;
  minAge?: string;
  maxAge?: string;
  isFree?: string;
  steamDeck?: string;
  hasWorkshop?: string;
  earlyAccess?: string;
  minDiscount?: string;
  publisherSize?: string;
}

/**
 * Aggregate statistics for filtered apps
 */
export interface AggregateStats {
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
