/**
 * Qdrant Types for PublisherIQ Similarity Search
 */

// Entity types for similarity search
export type EntityType = 'game' | 'publisher' | 'developer';

// App type classification
export type AppType = 'game' | 'dlc' | 'demo' | 'mod' | 'video' | 'hardware' | 'music';

// Steam Deck compatibility
export type SteamDeckCategory = 'unknown' | 'unsupported' | 'playable' | 'verified';

// Platforms
export type Platform = 'windows' | 'macos' | 'linux';

// Price tiers for filtering
export type PriceTier = 'free' | 'under_10' | 'under_20' | 'under_40' | 'premium';

// Owner tiers for filtering
export type OwnersTier = 'under_10k' | '10k_100k' | '100k_1m' | 'over_1m';

// CCU tiers for filtering
export type CcuTier = 'under_100' | '100_1k' | '1k_10k' | 'over_10k';

// Playtime tiers for filtering (based on average_playtime_forever)
export type PlaytimeTier = 'short' | 'medium' | 'long' | 'endless';

// Velocity tiers for activity level
export type VelocityTier = 'high' | 'medium' | 'low' | 'dormant';

// Trend direction
export type TrendDirection = 'up' | 'stable' | 'down';

/**
 * Game payload stored in Qdrant
 */
export interface GamePayload {
  appid: number;
  name: string;
  type: AppType;

  // Classification
  genres: string[];
  tags: string[];
  categories: string[];

  // Platform support
  platforms: Platform[];
  steam_deck: SteamDeckCategory;
  controller_support: string | null;

  // Pricing
  is_free: boolean;
  price_tier: PriceTier;
  price_cents: number | null;

  // Reviews & Ratings
  review_score: number | null; // 1-9 scale
  review_percentage: number | null; // 0-100
  total_reviews: number | null;

  // Popularity
  owners_tier: OwnersTier | null;
  ccu_tier: CcuTier | null;

  // Activity & Engagement (NEW)
  playtime_tier: PlaytimeTier | null;
  velocity_tier: VelocityTier | null;
  trend_direction: TrendDirection | null;

  // External ratings (NEW)
  metacritic_score: number | null;

  // Localization (NEW)
  language_count: number | null;

  // Franchise names for display (NEW)
  franchise_names: string[];

  // Dates
  release_year: number | null;

  // Relationships
  developer_ids: number[];
  publisher_ids: number[];
  franchise_ids: number[];

  // Status
  is_released: boolean;
  is_delisted: boolean;

  // Sync tracking
  embedding_hash: string;
  updated_at: number; // Unix timestamp
}

/**
 * Publisher portfolio payload - based on all games
 */
export interface PublisherPortfolioPayload {
  id: number;
  name: string;
  game_count: number;
  first_release_year: number | null;

  // Aggregated from portfolio
  top_genres: string[];
  top_tags: string[];
  platforms_supported: Platform[];

  // Metrics
  total_owners_tier: OwnersTier | null;
  avg_review_percentage: number | null;
  total_reviews: number;

  // Classification
  is_major: boolean; // 10+ games

  // Sync tracking
  embedding_hash: string;
  updated_at: number;
}

/**
 * Publisher identity payload - based on top games
 */
export interface PublisherIdentityPayload {
  id: number;
  name: string;
  game_count: number;

  // Top games (by reviews)
  top_game_names: string[];
  top_game_appids: number[];
  top_game_genres: string[];
  flagship_game_appid: number | null;

  // Same metrics as portfolio
  is_major: boolean;
  avg_review_percentage: number | null;

  // Sync tracking
  embedding_hash: string;
  updated_at: number;
}

/**
 * Developer portfolio payload
 */
export interface DeveloperPortfolioPayload {
  id: number;
  name: string;
  game_count: number;
  first_release_year: number | null;

  // Aggregated from portfolio
  top_genres: string[];
  top_tags: string[];
  platforms_supported: Platform[];

  // Metrics
  avg_review_percentage: number | null;
  total_reviews: number;

  // Classification
  is_indie: boolean; // Self-published

  // Sync tracking
  embedding_hash: string;
  updated_at: number;
}

/**
 * Developer identity payload
 */
export interface DeveloperIdentityPayload {
  id: number;
  name: string;
  game_count: number;

  // Top games
  top_game_names: string[];
  top_game_appids: number[];
  top_game_genres: string[];
  flagship_game_appid: number | null;

  // Classification
  is_indie: boolean;
  avg_review_percentage: number | null;

  // Sync tracking
  embedding_hash: string;
  updated_at: number;
}

// Union types
export type PublisherPayload = PublisherPortfolioPayload | PublisherIdentityPayload;
export type DeveloperPayload = DeveloperPortfolioPayload | DeveloperIdentityPayload;
export type QdrantPayload =
  | GamePayload
  | PublisherPortfolioPayload
  | PublisherIdentityPayload
  | DeveloperPortfolioPayload
  | DeveloperIdentityPayload;

/**
 * Range filter for numeric fields
 */
export interface RangeFilter {
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
}

/**
 * Date range filter
 */
export interface DateRangeFilter {
  after?: string; // ISO date
  before?: string; // ISO date
}

/**
 * Popularity comparison mode
 */
export type PopularityComparison = 'any' | 'less_popular' | 'similar' | 'more_popular';

/**
 * Review score comparison mode
 */
export type ReviewComparison = 'any' | 'similar_or_better' | 'better_only';

/**
 * Filters for game similarity search
 */
export interface GameFilters {
  // Type filters
  types?: AppType[];

  // Genre/Tag/Category filters (match any)
  genres?: string[];
  tags?: string[];
  categories?: string[];

  // Price filters
  price_range?: RangeFilter; // in cents
  is_free?: boolean;
  price_tiers?: PriceTier[];

  // Rating filters
  review_score?: RangeFilter; // 1-9
  review_percentage?: RangeFilter; // 0-100
  min_reviews?: number;
  max_reviews?: number;

  // Popularity filters
  owners_tiers?: OwnersTier[];
  ccu_tiers?: CcuTier[];

  // Activity & Engagement filters (NEW)
  playtime_tiers?: PlaytimeTier[];
  velocity_tiers?: VelocityTier[];
  trend_directions?: TrendDirection[];

  // Date filters
  release_year?: RangeFilter;

  // Platform filters
  platforms?: Platform[];
  steam_deck?: SteamDeckCategory[];
  has_controller_support?: boolean;

  // Status filters
  is_released?: boolean;
  exclude_delisted?: boolean;

  // Exclusion filters
  exclude_appids?: number[];
  exclude_same_publisher?: boolean;
  exclude_same_developer?: boolean;
  exclude_same_franchise?: boolean;
  same_franchise_only?: boolean;

  // Relative comparison (requires source entity context)
  popularity_comparison?: PopularityComparison;
  review_comparison?: ReviewComparison;
}

/**
 * Filters for publisher/developer similarity search
 */
export interface EntityFilters {
  game_count?: RangeFilter;
  avg_review_percentage?: RangeFilter;
  first_release_year?: RangeFilter;
  top_genres?: string[];
  top_tags?: string[];
  is_major?: boolean;
  is_indie?: boolean;
  exclude_ids?: number[];
}

/**
 * Similarity search request
 */
export interface SimilaritySearchRequest {
  // Query specification - one required
  query_by_id?: {
    entity_type: EntityType;
    id: number;
    collection_variant?: 'portfolio' | 'identity'; // For publishers/developers
  };
  query_by_text?: string;
  query_by_vector?: number[];

  // Target
  target_entity_type?: EntityType;
  target_collection_variant?: 'portfolio' | 'identity';

  // Filters
  filters?: GameFilters | EntityFilters;

  // Context for relative comparisons
  source_metrics?: {
    owners_tier?: OwnersTier;
    review_percentage?: number;
    price_cents?: number;
  };

  // Pagination
  limit?: number; // Default 20, max 50
  offset?: number;

  // Scoring
  score_threshold?: number; // 0-1

  // Response options
  include_payload?: boolean;
  payload_fields?: string[]; // Specific fields to include
}

/**
 * Individual search result
 */
export interface SimilaritySearchResult<T = QdrantPayload> {
  id: number;
  entity_type: EntityType;
  score: number; // 0-1 similarity score
  payload?: T;
}

/**
 * Search response
 */
export interface SimilaritySearchResponse<T = QdrantPayload> {
  results: SimilaritySearchResult<T>[];
  total_found: number;
  query_time_ms: number;
  query_entity?: {
    id: number;
    entity_type: EntityType;
    name: string;
  };
}

/**
 * Embedding sync status for a game/entity
 */
export interface EmbeddingSyncStatus {
  id: number;
  entity_type: EntityType;
  last_embedding_sync: Date | null;
  embedding_hash: string | null;
  needs_reembed: boolean;
}
