/**
 * TypeScript types for the Companies page
 */

// Re-export ColumnId from columns module
export type { ColumnId } from './companies-columns';

export type CompanyType = 'all' | 'publisher' | 'developer';

/**
 * Command Palette types
 */
export type CommandPaletteView = 'home' | 'tags' | 'genres' | 'categories';

export interface CommandPaletteState {
  isOpen: boolean;
  view: CommandPaletteView;
  searchInput: string;
  pendingTags: number[];
  pendingGenres: number[];
  pendingCategories: number[];
  tagMode: 'any' | 'all';
  genreMode: 'any' | 'all';
}

/**
 * M4b: Content & Relationship filter types
 */
export type SteamDeckFilterValue = 'verified' | 'playable' | null | undefined;
export type RelationshipFilterValue = 'self_published' | 'external_devs' | 'multi_publisher' | null | undefined;
export type StatusFilterValue = 'active' | 'dormant' | null | undefined;
export type PlatformValue = 'windows' | 'mac' | 'linux';
export type FilterMode = 'any' | 'all';

/**
 * Filter option returned from the Tiger-backed filter-count API
 */
export interface FilterOption {
  option_id: number;
  option_name: string;
  company_count: number;
}

export type SortField =
  | 'name'
  | 'estimated_weekly_hours'
  | 'game_count'
  | 'total_owners'
  | 'total_ccu'
  | 'avg_review_score'
  | 'total_reviews'
  | 'revenue_estimate_cents'
  | 'games_trending_up'
  | 'ccu_growth_7d'
  // Client-side sortable columns (computed ratios and metrics without backend support)
  | 'revenue_per_game'
  | 'owners_per_game'
  | 'reviews_per_1k_owners'
  | 'growth_30d'
  | 'review_velocity';

export type SortOrder = 'asc' | 'desc';

/**
 * Time period options for filtering
 */
export type TimePeriod =
  | 'all'
  | '2025'
  | '2024'
  | '2023'
  | 'last_12mo'
  | 'last_6mo'
  | 'last_90d'
  | 'last_30d';

/**
 * Preset identifiers (exclusive - selecting one clears others)
 */
export type PresetId =
  | 'market_leaders'
  | 'rising_indies'
  | 'breakout'
  | 'growing_publishers';

/**
 * Quick filter identifiers (stackable - can combine multiple)
 * Note: 'breakout' removed - now only in presets
 */
export type QuickFilterId =
  | 'major'
  | 'prolific'
  | 'active'
  | 'trending'
  | 'revenue1m'
  | 'revenue10m'
  | 'owners100k';

/**
 * Unified filter ID (presets or quick filters)
 */
export type UnifiedFilterId = PresetId | QuickFilterId;

/**
 * Company data returned from the Tiger-backed companies query
 */
export interface Company {
  id: number;
  name: string;
  type: 'publisher' | 'developer';
  game_count: number;
  total_owners: number;
  total_ccu: number;
  estimated_weekly_hours: number;
  total_reviews: number;
  positive_reviews: number;
  avg_review_score: number | null;
  revenue_estimate_cents: number;
  games_trending_up: number;
  games_trending_down: number;
  // Growth metrics (NULL in fast path, computed in slow path)
  ccu_growth_7d_percent: number | null;
  ccu_growth_30d_percent: number | null;
  review_velocity_7d: number | null;
  review_velocity_30d: number | null;
  // Relationship flags (NULL in fast path)
  is_self_published: boolean | null;
  works_with_external_devs: boolean | null;
  external_partner_count: number | null;
  // Timeline
  first_release_date: string | null;
  latest_release_date: string | null;
  years_active: number | null;
  // Metadata
  steam_vanity_url: string | null;
  unique_developers: number;
  data_updated_at: string | null;
}

/**
 * Aggregate statistics for filtered companies
 */
export interface AggregateStats {
  total_companies: number;
  total_games: number;
  total_owners: number;
  total_revenue: number;
  avg_review_score: number | null;
  total_ccu: number;
}

/**
 * Filter parameters for the Companies page
 */
export interface CompaniesFilterParams {
  type: CompanyType;
  sort: SortField;
  order: SortOrder;
  search?: string;
  limit?: number;
  offset?: number;
  // Metric filters
  minGames?: number;
  maxGames?: number;
  minOwners?: number;
  maxOwners?: number;
  minCcu?: number;
  maxCcu?: number;
  minHours?: number;
  maxHours?: number;
  minRevenue?: number;
  maxRevenue?: number;
  minScore?: number;
  maxScore?: number;
  minReviews?: number;
  maxReviews?: number;
  // Growth filters
  minGrowth7d?: number;
  maxGrowth7d?: number;
  minGrowth30d?: number;
  maxGrowth30d?: number;
  // Time period filter (UI only - backend not yet implemented)
  period?: TimePeriod;
  // Status filter
  status?: StatusFilterValue;
  // M4b: Content filters
  genres?: number[];
  genreMode?: FilterMode;
  tags?: number[];
  categories?: number[];
  steamDeck?: SteamDeckFilterValue;
  platforms?: PlatformValue[];
  platformMode?: FilterMode;
  // M4b: Relationship filter
  relationship?: RelationshipFilterValue;
}

/**
 * Search params shape from URL
 */
export interface CompaniesSearchParams {
  type?: string;
  sort?: string;
  order?: string;
  search?: string;
  preset?: string;
  filters?: string;
  // Individual filter params
  minGames?: string;
  maxGames?: string;
  minOwners?: string;
  maxOwners?: string;
  minCcu?: string;
  maxCcu?: string;
  minHours?: string;
  maxHours?: string;
  minRevenue?: string;
  maxRevenue?: string;
  minScore?: string;
  maxScore?: string;
  minReviews?: string;
  maxReviews?: string;
  // Growth filter params
  minGrowth7d?: string;
  maxGrowth7d?: string;
  minGrowth30d?: string;
  maxGrowth30d?: string;
  // Time period
  period?: string;
  // Status
  status?: string;
  // M4b: Content filters
  genres?: string; // comma-separated IDs
  genreMode?: string;
  tags?: string; // comma-separated IDs
  categories?: string; // comma-separated IDs
  steamDeck?: string;
  platforms?: string; // comma-separated
  platformMode?: string;
  // M4b: Relationship
  relationship?: string;
  // M5: Column customization
  columns?: string; // comma-separated column IDs
  // M6a: Compare mode
  compare?: string; // comma-separated company IDs (pub:123,dev:456)
}

/**
 * Saved view schema for localStorage persistence
 */
export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  filters: {
    // Metric filters
    minGames?: number;
    maxGames?: number;
    minOwners?: number;
    maxOwners?: number;
    minCcu?: number;
    maxCcu?: number;
    minHours?: number;
    maxHours?: number;
    minRevenue?: number;
    maxRevenue?: number;
    minScore?: number;
    maxScore?: number;
    minReviews?: number;
    maxReviews?: number;
    // Growth filters
    minGrowth7d?: number;
    maxGrowth7d?: number;
    minGrowth30d?: number;
    maxGrowth30d?: number;
    // Time period
    period?: TimePeriod;
    // Content filters
    genres?: number[];
    genreMode?: FilterMode;
    tags?: number[];
    categories?: number[];
    steamDeck?: SteamDeckFilterValue;
    platforms?: PlatformValue[];
    platformMode?: FilterMode;
    // Relationship
    status?: StatusFilterValue;
    relationship?: RelationshipFilterValue;
  };
  columns?: string[];
  sort: SortField;
  order: SortOrder;
  type: CompanyType;
}

/**
 * M6a: Selection & Compare types
 */

/**
 * Unique company identifier combining id and type
 * Used for selection and comparison since publisher/developer IDs can overlap
 */
export interface CompanyIdentifier {
  id: number;
  type: 'publisher' | 'developer';
}

/**
 * Serialized format for URL: "pub:123" or "dev:456"
 */
export type SerializedCompanyId = `pub:${number}` | `dev:${number}`;

/**
 * A single metric row in the comparison table
 */
export interface CompareMetricRow {
  metricId: string;
  label: string;
  category: 'engagement' | 'content' | 'reviews' | 'financial' | 'growth' | 'ratios' | 'visualization';
  values: (number | null)[];
  formattedValues: string[];
  percentDiffs: (number | null)[]; // % diff from baseline (first company)
  vsAvgValue: number | null;
  vsAvgDiff: number | null;
  bestIndex: number | null; // Index of company with best value
  worstIndex: number | null; // Index of company with worst value
  higherIsBetter: boolean;
}

/**
 * Serialize a company identifier for use in Sets and URLs
 */
export function serializeCompanyId(id: number, type: 'publisher' | 'developer'): SerializedCompanyId {
  return `${type === 'publisher' ? 'pub' : 'dev'}:${id}` as SerializedCompanyId;
}

/**
 * Parse a serialized company ID back to CompanyIdentifier
 */
export function parseSerializedCompanyId(serialized: string): CompanyIdentifier | null {
  const match = serialized.match(/^(pub|dev):(\d+)$/);
  if (!match) return null;
  return {
    type: match[1] === 'pub' ? 'publisher' : 'developer',
    id: parseInt(match[2], 10),
  };
}

const MIN_COMPARE = 2;
const MAX_COMPARE = 5;

/**
 * Parse compare URL param to CompanyIdentifier array
 * Format: "pub:123,dev:456,pub:789"
 * This function is safe to use in both server and client components.
 */
export function parseCompareParam(param: string | null): CompanyIdentifier[] {
  if (!param) return [];

  const ids = param
    .split(',')
    .map((s) => parseSerializedCompanyId(s.trim()))
    .filter((id): id is CompanyIdentifier => id !== null);

  // Deduplicate and limit
  const seen = new Set<string>();
  const unique: CompanyIdentifier[] = [];
  for (const id of ids) {
    const key = `${id.type}:${id.id}`;
    if (!seen.has(key) && unique.length < MAX_COMPARE) {
      seen.add(key);
      unique.push(id);
    }
  }

  return unique;
}

/**
 * Serialize CompanyIdentifier array to URL param
 */
export function serializeCompareParam(ids: CompanyIdentifier[]): string | null {
  if (ids.length < MIN_COMPARE) return null;
  return ids
    .slice(0, MAX_COMPARE)
    .map((id) => `${id.type === 'publisher' ? 'pub' : 'dev'}:${id.id}`)
    .join(',');
}
