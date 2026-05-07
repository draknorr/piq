export type UnreleasedSortField =
  | 'opportunity_score'
  | 'latest_added_at'
  | 'release_date'
  | 'name'
  | 'publisher_name'
  | 'developer_name'
  | 'primary_tag_name'
  | 'primary_category_name'
  | 'latest_news_at'
  | 'latest_change_at'
  | 'change_count_30d'
  | 'screenshot_count'
  | 'movie_count';

export type SortOrder = 'asc' | 'desc';

export type ReleaseStatus = 'dated_future' | 'undated' | 'stale_past_date';
export type AdultFilter = 'exclude' | 'include' | 'only';
export type PublisherStatus =
  | 'no_publisher'
  | 'self_published'
  | 'small_publisher'
  | 'established_publisher';
export type FilterMode = 'any' | 'all';

export interface UnreleasedGame {
  appid: number;
  name: string;
  type: string;
  release_date: string | null;
  release_date_raw: string | null;
  release_status: ReleaseStatus;
  days_until_release: number | null;
  latest_added_at: string | null;
  is_free: boolean;
  current_price_cents: number | null;
  current_discount_percent: number;
  has_purchase_packages: boolean;
  has_workshop: boolean;
  release_state: string | null;
  app_state: string | null;
  platforms: string | null;
  platform_array: string[];
  controller_support: string | null;
  is_adult_content: boolean;
  publisher_id: number | null;
  publisher_name: string | null;
  publisher_steam_vanity_url: string | null;
  publisher_game_count: number | null;
  publisher_released_game_count: number;
  publisher_total_owners: number;
  publisher_max_game_reviews: number;
  developer_id: number | null;
  developer_name: string | null;
  developer_steam_vanity_url: string | null;
  developer_game_count: number | null;
  is_self_published: boolean;
  publisher_status: PublisherStatus;
  genre_ids: number[];
  genre_names: string[];
  tag_ids: number[];
  tag_names: string[];
  primary_tag_name: string | null;
  category_ids: number[];
  category_names: string[];
  primary_category_name: string | null;
  screenshot_count: number;
  movie_count: number;
  latest_storefront_snapshot_at: string | null;
  latest_news_at: string | null;
  latest_news_title: string | null;
  latest_news_url: string | null;
  latest_change_at: string | null;
  latest_change_type: string | null;
  latest_change_summary: string | null;
  latest_activity_at: string | null;
  signal_families_30d: string[];
  story_kinds_30d: string[];
  announcement_count_30d: number;
  change_count_30d: number;
  release_count_30d: number;
  pricing_count_30d: number;
  store_page_count_30d: number;
  media_count_30d: number;
  taxonomy_count_30d: number;
  platform_count_30d: number;
  build_count_30d: number;
  opportunity_score: number;
  data_updated_at: string | null;
  projection_refreshed_at: string | null;
}

export interface UnreleasedStats {
  total_games: number;
  dated_future_count: number;
  undated_count: number;
  stale_past_date_count: number;
  active_30d_count: number;
  news_30d_count: number;
  adult_count: number;
  no_publisher_count: number;
  self_published_count: number;
  small_publisher_count: number;
  avg_opportunity_score: number | null;
  projection_refreshed_at: string | null;
}

export interface FilterOption {
  option_id: number;
  option_name: string;
  app_count: number;
}

export interface UnreleasedFilters {
  sort: UnreleasedSortField;
  order: SortOrder;
  limit?: number;
  offset?: number;
  search?: string;
  adult?: AdultFilter;
  releaseStatuses?: ReleaseStatus[];
  publisherStatuses?: PublisherStatus[];
  publisherSearch?: string;
  developerSearch?: string;
  minDaysUntilRelease?: number;
  maxDaysUntilRelease?: number;
  minOpportunityScore?: number;
  minChanges30d?: number;
  minNewsDays?: number;
  hasNews?: boolean;
  hasRecentChange?: boolean;
  hasScreenshots?: boolean;
  hasTrailers?: boolean;
  hasPurchasePackages?: boolean;
  isFree?: boolean;
  hasWorkshop?: boolean;
  genres?: number[];
  genreMode?: FilterMode;
  tags?: number[];
  tagMode?: FilterMode;
  categories?: number[];
  categoryMode?: FilterMode;
  platforms?: string[];
  platformMode?: FilterMode;
  signalFamilies?: string[];
  signalMode?: FilterMode;
}

export interface UnreleasedSearchParams {
  sort?: string;
  order?: string;
  search?: string;
  adult?: string;
  releaseStatus?: string;
  publisherStatus?: string;
  publisherSearch?: string;
  developerSearch?: string;
  minDaysUntilRelease?: string;
  maxDaysUntilRelease?: string;
  minOpportunityScore?: string;
  minChanges30d?: string;
  minNewsDays?: string;
  hasNews?: string;
  hasRecentChange?: string;
  hasScreenshots?: string;
  hasTrailers?: string;
  hasPurchasePackages?: string;
  isFree?: string;
  hasWorkshop?: string;
  genres?: string;
  genreMode?: string;
  tags?: string;
  tagMode?: string;
  categories?: string;
  categoryMode?: string;
  platforms?: string;
  platformMode?: string;
  signalFamilies?: string;
  signalMode?: string;
}

export interface RecentChange {
  event_id: number;
  source: string;
  change_type: string;
  occurred_at: string;
  before_value: unknown;
  after_value: unknown;
  context: Record<string, unknown>;
}

export interface RecentNews {
  gid: string;
  title: string | null;
  url: string;
  published_at: string | null;
  first_seen_at: string | null;
  feedlabel: string | null;
}

export interface UnreleasedGameDetail {
  game: UnreleasedGame;
  screenshots: unknown[];
  trailers: unknown[];
  hero_assets: Record<string, unknown>;
  recent_changes: RecentChange[];
  recent_news: RecentNews[];
}

export type UnreleasedTimelineItemType = 'change' | 'news';

export interface UnreleasedTimelineItem {
  id: string;
  item_type: UnreleasedTimelineItemType;
  event_id: number | null;
  gid: string | null;
  source: string;
  change_type: string | null;
  title: string | null;
  summary: string | null;
  occurred_at: string;
  url: string | null;
  before_value: unknown;
  after_value: unknown;
  context: Record<string, unknown>;
  feedlabel: string | null;
}

export interface UnreleasedTimelineResult {
  items: UnreleasedTimelineItem[];
  next_offset: number | null;
}
