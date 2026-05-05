import type { QueryResultRow } from 'pg';
import { logger, PublisherIQError } from '@publisheriq/shared';

import type {
  ChangeActivitySignalFamily,
  ChangeActivitySort,
  ChangeActivityStoryKind,
  ChangeActivityView,
  CatalogFacetKind,
  ChangePattern,
  CompareEntitiesRequest,
  CompareEntitiesResponse,
  CompareMetric,
  ComparedEntity,
  DiscoverChangePatternsRequest,
  DiscoverChangePatternsResponse,
  DiscoverMomentumItem,
  DiscoverMomentumRequest,
  DiscoverMomentumResponse,
  ContinueResultSetRequest,
  ContinueResultSetResponse,
  DataPlaneReadiness,
  DataPlaneRelationKey,
  EntityKind,
  ExplainChangeMetricsWindow,
  ExplainChangesLinkedNewsItem,
  ExplainChangesMoment,
  ExplainChangesRequest,
  ExplainChangesResponse,
  GetChangeActivityDetailRequest,
  GetChangeActivityDetailResponse,
  GetChangeFeedStatusRequest,
  GetChangeFeedStatusResponse,
  GetEntityOverviewRequest,
  GetEntityOverviewResponse,
  GetRelatedEntitiesRequest,
  GetRelatedEntitiesResponse,
  GetUserContextRequest,
  GetUserContextResponse,
  GetYoutubeGameCoverageRequest,
  GetYoutubeGameCoverageResponse,
  GetYoutubeMarketPulseRequest,
  GetYoutubeMarketPulseResponse,
  MatchQuality,
  QueryProvenance,
  QueryMonthlyPlaytimeRequest,
  QueryMonthlyPlaytimeResponse,
  RankEntitiesRequest,
  RankEntitiesResponse,
  RankMetric,
  RankedEntity,
  RelatedEntityKind,
  RelatedEntityResultItem,
  ResolveEntitiesResolutionMode,
  ResolveEntitiesResolutionPreference,
  ResolveEntityMatchSource,
  ResolveEntityResolutionTier,
  ResolveEntitiesRequest,
  ResolveEntitiesResponse,
  ResolvedEntity,
  RuntimeQueryContractDescriptor,
  SearchCatalogItem,
  SearchCatalogRequest,
  SearchCatalogResponse,
  SearchChangeActivityRequest,
  SearchChangeActivityItem,
  SearchChangeActivityResponse,
  SearchDocumentItem,
  SearchDocumentsRequest,
  SearchDocumentsResponse,
  SemanticSearchCandidate,
  SemanticSearchFilters,
  SemanticSearchRequest,
  SemanticSearchResultItem,
  SemanticSearchResponse,
  TraceMetric,
  TraceMetricHistoryRequest,
  TraceMetricHistoryResponse,
  TraceMetricHistorySeries,
  UserAlertSeverity,
  UserAlertType,
  UserContextAlert,
  UserContextAlertPreferences,
  UserContextPin,
  YoutubeContentClass,
  YoutubeCoverageWindow,
  YoutubeGameCoverageCadenceItem,
  YoutubeGameCoverageContentMixItem,
  YoutubeGameCoverageCreatorItem,
  YoutubeGameCoverageEntity,
  YoutubeGameCoverageLanguageOption,
  YoutubeGameCoveragePagination,
  YoutubeGameCoverageSummary,
  YoutubeGameCoverageVideoItem,
  YoutubeGameCoverageView,
  YoutubeMarketPulseContentMixItem,
  YoutubeMarketPulseItem,
  YoutubeMarketPulseSort,
  YoutubeMarketPulseVideoItem,
} from './contracts.js';
import { CONTRACT_REGISTRY } from './contract-registry.js';
import { loadDataPlaneConfig, type DataPlaneConfig } from './config.js';
import { ContractRuntimeUnavailableError } from './errors.js';
import { buildEntityUid } from './identity.js';
import { runQuery } from './pg.js';

interface EntityRow extends QueryResultRow {
  ccu_peak: number | null;
  display_name: string;
  entity_id: number;
  game_count?: number | null;
  match_quality?: MatchQuality | null;
  match_rank?: number | null;
  match_source?: ResolveEntityMatchSource | null;
  matched_name?: string | null;
  owners_midpoint: number | null;
  release_year?: number | null;
  resolution_tier?: ResolveEntityResolutionTier | null;
  review_score: number | null;
  similarity_score?: number | null;
  total_reviews: number | null;
}

interface CanonicalLookupTerms {
  compactQuery: string;
  compactPrefix: string;
  compactSubstring: string;
  looseQuery: string;
  loosePrefix: string;
  looseSubstring: string;
  normalizedQuery: string;
  rawQuery: string;
}

interface CanonicalEntityQueryOptions {
  allowFuzzyFallback?: boolean;
  lightweight?: boolean;
}

interface CatalogRow extends QueryResultRow {
  app_type: string | null;
  appid: number;
  ccu_peak: number | null;
  developer_ids: number[] | null;
  developers: string[] | null;
  discount_percent: number | null;
  is_free: boolean;
  is_released: boolean | null;
  name: string;
  owners_midpoint: number | null;
  parent_appid: number | null;
  platforms: string | null;
  price_cents: number | null;
  publisher_ids: number[] | null;
  publishers: string[] | null;
  release_date: string | null;
  release_state: string | null;
  release_year: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface EntityOverviewRow extends QueryResultRow {
  app_type: string | null;
  appid: number | null;
  ccu_peak: number | null;
  developer_ids: number[] | null;
  developers: string[] | null;
  discount_percent: number | null;
  display_name: string;
  entity_id: number;
  game_count: number | null;
  is_free: boolean | null;
  is_released: boolean | null;
  owners_midpoint: number | null;
  parent_appid: number | null;
  platforms: string | null;
  price_cents: number | null;
  publisher_ids: number[] | null;
  publishers: string[] | null;
  release_date: string | null;
  release_state: string | null;
  release_year: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface RelatedEntityRow extends QueryResultRow {
  appid: number;
  franchise_name: string | null;
  name: string;
  positive_percentage: number | null;
  review_score: number | null;
  steam_deck_category: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
  total_reviews: number | null;
  release_date: string | null;
  release_year: number | null;
}

interface EntityOverviewGameRow extends QueryResultRow {
  appid: number;
  name: string;
  owners_midpoint: number | null;
  release_date: string | null;
  release_year: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface RankRow extends QueryResultRow {
  ccu_peak: number | null;
  display_name: string;
  entity_id: number;
  game_count: number | null;
  owners_midpoint: number | null;
  release_year?: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface MonthlyPlaytimeRow extends QueryResultRow {
  entity_id: number;
  estimated_monthly_hours: number | null;
  game_count?: number | null;
  month: string;
  month_num: number;
  monthly_ccu_sum?: number | null;
  name: string;
  year: number;
}

interface CoreEntityRow extends QueryResultRow {
  canonical_name: string;
  entity_kind: EntityKind;
  entity_uid: string;
  platform: 'steam' | 'publisheriq';
  platform_entity_id: string;
}

interface DailyMetricHistoryRow extends QueryResultRow {
  average_playtime_2weeks: number | null;
  average_playtime_forever: number | null;
  ccu_peak: number | null;
  discount_percent: number | null;
  metric_date: string;
  negative_reviews: number | null;
  owners_max: number | null;
  owners_min: number | null;
  positive_reviews: number | null;
  price_cents: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface YoutubeVideoCoverageRow extends QueryResultRow {
  channel_country: string | null;
  channel_id: string;
  channel_subscriber_count: number | string | null;
  channel_title: string;
  comment_count: number | string | null;
  confidence_score: number | null;
  content_class: YoutubeContentClass;
  default_audio_language: string | null;
  default_language: string | null;
  first_snapshot_at: string | null;
  growth_pct: number | null;
  last_snapshot_at: string | null;
  language_code: string | null;
  like_count: number | string | null;
  matched_alias: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  title: string;
  video_id: string;
  view_count: number | string | null;
  view_delta: number | string | null;
}

interface YoutubeLanguageOptionRow extends QueryResultRow {
  language_code: string | null;
  video_count: number | string | null;
}

interface YoutubeCreatorCoverageRow extends QueryResultRow {
  channel_country: string | null;
  channel_id: string;
  channel_subscriber_count: number | null;
  channel_title: string;
  latest_matched_upload_at: string | null;
  matched_video_count: number;
  total_matched_views: number | null;
}

interface YoutubeContentMixRow extends QueryResultRow {
  content_class: YoutubeContentClass;
  current_views: number;
  distinct_upload_channels: number;
  matched_primary_video_count: number;
  matched_video_view_delta: number;
  new_matched_videos: number;
}

interface YoutubeCadenceRow extends QueryResultRow {
  distinct_upload_channels: number;
  matched_video_view_delta: number;
  new_matched_videos: number;
  views_on_new_videos: number;
}

interface YoutubeCoverageSummaryRow extends QueryResultRow {
  distinct_upload_channels_30d: number;
  distinct_upload_channels_7d: number;
  freshest_matched_upload_at: string | null;
  latest_snapshot_at: string | null;
  matched_primary_video_count: number;
  matched_video_view_delta_1d: number | null;
  matched_video_view_delta_7d: number | null;
  new_matched_videos_1d: number;
  new_matched_videos_30d: number;
  new_matched_videos_7d: number;
}

interface YoutubeCoveragePage<T> {
  rows: T[];
  totalRows: number;
}

interface YoutubeMarketPulseRow extends QueryResultRow {
  ambiguous_match_count: number | string | null;
  ccu_peak: number | string | null;
  content_mix: unknown;
  current_views: number | string | null;
  dominant_content_class: YoutubeContentClass | null;
  latest_snapshot_at: string | null;
  latest_videos: unknown;
  matched_primary_video_count: number | string | null;
  name: string;
  new_matched_videos: number | string | null;
  rejected_match_count: number | string | null;
  review_score: number | string | null;
  steam_rank: number | string;
  total_reviews: number | string | null;
  total_rows: number | string;
  upload_channels: number | string | null;
  view_delta: number | string | null;
  appid: number | string;
}

interface YoutubeMarketPulseCurrentViewRow extends QueryResultRow {
  appid: number | string;
  content_class: YoutubeContentClass;
  current_views: number | string | null;
}

interface YoutubeMarketPulseLatestVideoRow extends QueryResultRow {
  appid: number | string;
  channel_id: string | null;
  channel_title: string | null;
  content_class: YoutubeContentClass;
  published_at: string | null;
  title: string | null;
  video_id: string;
  view_count: number | string | null;
  view_delta: number | string | null;
}

interface ChangeEventRow extends QueryResultRow {
  after_value: unknown | null;
  before_value: unknown | null;
  change_type: string;
  context: unknown;
  id: string;
  news_item_gid: string | null;
  occurred_at: string;
  source: string;
}

interface SearchChangeEventRow extends QueryResultRow {
  after_value: unknown | null;
  app_name: string;
  app_type: string | null;
  appid: number;
  before_value: unknown | null;
  change_type: string;
  context: unknown;
  id: string;
  is_released: boolean | null;
  news_item_gid: string | null;
  occurred_at: string;
  release_date: string | null;
  source: string;
}

interface SemanticGameReferenceRow extends QueryResultRow {
  appid: number;
  current_price_cents: number | null;
  developer_ids: number[] | null;
  genres: string[] | null;
  is_free: boolean;
  name: string;
  platforms: string | null;
  pics_review_percentage: number | null;
  publisher_ids: number[] | null;
  steam_deck_category: string | null;
  tags: string[] | null;
  total_reviews: number | null;
  type: string | null;
}

interface SemanticCompanyReferenceRow extends QueryResultRow {
  avg_review_percentage: number | null;
  game_count: number | null;
  id: number;
  name: string;
  top_genres: string[] | null;
  top_tags: string[] | null;
}

interface SemanticGameCandidateRow extends QueryResultRow {
  appid: number;
  current_price_cents: number | null;
  developer_ids: number[] | null;
  genres: string[] | null;
  is_free: boolean;
  name: string;
  platforms: string | null;
  positive_percentage: number | null;
  publisher_ids: number[] | null;
  steam_deck_category: string | null;
  tags: string[] | null;
  total_reviews: number | null;
  type: string | null;
}

interface TigerSemanticGameProfileRow extends QueryResultRow {
  appid: number;
  current_price_cents: number | null;
  developer_ids: number[] | null;
  genres: string[] | null;
  is_free: boolean;
  name: string;
  pics_review_percentage?: number | null;
  platforms: string | null;
  positive_percentage?: number | null;
  publisher_ids: number[] | null;
  steam_deck_category?: string | null;
  tags: string[] | null;
  total_reviews: number | null;
  type: string | null;
}

interface SemanticCompanyCandidateRow extends QueryResultRow {
  avg_review_percentage: number | null;
  game_count: number | null;
  id: number;
  name: string;
  top_genres: string[] | null;
  top_tags: string[] | null;
  total_reviews: number | null;
}

interface TigerSemanticGameProfile {
  appid: number;
  developerIds: number[];
  genres: string[];
  isFree: boolean;
  name: string;
  platforms: string[];
  priceCents: number | null;
  publisherIds: number[];
  reviewPercentage: number | null;
  tags: string[];
  totalReviews: number | null;
  type: string;
}

interface TigerSemanticCompanyProfile {
  avgReviewPercentage: number | null;
  gameCount: number | null;
  id: number;
  isIndie: boolean;
  isMajor: boolean;
  name: string;
  topGenres: string[];
  topTags: string[];
}

interface RankedSemanticItem {
  item: SemanticSearchResultItem;
  score: number;
}

interface ExplainNewsRow extends QueryResultRow {
  feed_scope: string | null;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  published_at: string | null;
  sort_time: string;
  title: string | null;
  url: string;
}

interface SearchDocumentRow extends QueryResultRow {
  app_name: string;
  app_name_hit?: boolean;
  appid: number;
  body_preview?: string | null;
  content_preview?: string | null;
  excerpt?: string | null;
  feed_scope: string;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  match_reason?: string | null;
  published_at: string | null;
  rank: number;
  ranking_reason?: string | null;
  sort_time: string;
  title: string | null;
  title_exact_hit?: boolean;
  title_phrase_hit: boolean;
  url: string;
}

interface ChangeActivityContractRow extends QueryResultRow {
  activity_id: string;
  activity_kind: 'announcement' | 'change';
  app_name: string;
  app_type: string | null;
  appid: number;
  burst_strength?: 'high' | 'low' | 'medium' | null;
  external_url: string | null;
  facts: string[] | null;
  has_before_after: boolean | null;
  headline: string | null;
  highlight_labels: string[] | null;
  is_released: boolean | null;
  occurred_at: string;
  relevance_reason?: string | null;
  relevance_score?: number | null;
  related_announcement_count: number | null;
  release_date: string | null;
  signal_families: string[] | null;
  sort_score?: number | null;
  strongest_signal?: string | null;
  story_kind: string | null;
  summary: string | null;
}

interface ChangePatternCandidateRow extends QueryResultRow {
  activity_ids: string[] | null;
  announcement_count: number | null;
  app_name: string;
  app_type: string | null;
  appid: number;
  ccu_peak: number | null;
  ccu_trend_7d_pct: number | null;
  change_count: number | null;
  discount_percent: number | null;
  is_released: boolean | null;
  latest_occurred_at: string;
  positive_percentage: number | null;
  price_cents: number | null;
  release_date: string | null;
  review_velocity_30d: number | null;
  review_velocity_7d: number | null;
  signal_families: string[] | null;
  story_kinds: string[] | null;
  total_reviews: number | null;
  trend_30d_direction: string | null;
}

interface ChangeFeedStatusCountRow extends QueryResultRow {
  count: string;
}

interface ChangeFeedStatusTimestampRow extends QueryResultRow {
  value: string | null;
}

interface ChangeBurstDetailRow extends QueryResultRow {
  activity_kind: 'announcement' | 'change';
  app_name: string;
  app_type: string | null;
  appid: number;
  burst_ended_at: string;
  burst_id: string;
  burst_started_at: string;
  effective_at: string;
  events: Array<{
    after_value?: unknown | null;
    appid?: number | null;
    before_value?: unknown | null;
    change_type?: string | null;
    context?: unknown | null;
    event_id?: string | null;
    news_item_gid?: string | null;
    occurred_at?: string | null;
    source?: string | null;
  }> | null;
  headline_change_types: string[] | null;
  impact: Record<string, unknown> | null;
  is_released: boolean | null;
  related_news: Array<{
    appid?: number | null;
    app_name?: string | null;
    app_type?: string | null;
    feedlabel?: string | null;
    feedname?: string | null;
    first_seen_at?: string | null;
    gid?: string | null;
    published_at?: string | null;
    title?: string | null;
    url?: string | null;
  }> | null;
  release_date: string | null;
}

interface MomentumRow extends QueryResultRow {
  appid: number;
  ccu_growth_30d_percent: number | null;
  ccu_growth_7d_percent: number | null;
  ccu_peak: number | null;
  developer_name: string | null;
  discount_percent: number | null;
  is_free: boolean;
  is_self_published: boolean;
  name: string;
  owners_midpoint: number | null;
  platforms: string | null;
  positive_percentage: number | null;
  price_cents: number | null;
  publisher_name: string | null;
  release_date: string | null;
  release_year: number | null;
  reviews_added_30d: number | null;
  reviews_added_7d: number | null;
  sentiment_delta: number | null;
  total_reviews: number | null;
  trend_direction: 'down' | 'stable' | 'up' | null;
  velocity_30d: number | null;
  velocity_7d: number | null;
  velocity_acceleration: number | null;
}

interface CCUSparklinePeakRow extends QueryResultRow {
  appid: number;
  peak_ccu: number;
  snapshot_date: string;
}

interface ChangeWindowMetricRow extends QueryResultRow {
  ccu_peak: number | null;
  discount_percent: number | null;
  negative_reviews: number | null;
  positive_reviews: number | null;
  price_cents: number | null;
  review_score: number | null;
  total_reviews: number | null;
}

interface UserContextPinRow extends QueryResultRow {
  alert_ccu_drop: boolean | null;
  alert_ccu_spike: boolean | null;
  alert_milestone: boolean | null;
  alert_new_release: boolean | null;
  alert_price_change: boolean | null;
  alert_review_surge: boolean | null;
  alert_sentiment_shift: boolean | null;
  alert_trend_reversal: boolean | null;
  alerts_enabled: boolean | null;
  app_type: string | null;
  ccu_peak: number | null;
  ccu_sensitivity: number | null;
  developer_game_count: number | null;
  display_name: string;
  entity_id: number;
  entity_type: EntityKind;
  is_free: boolean | null;
  owners_midpoint: number | null;
  pin_id: string;
  pin_order: number;
  pinned_at: string;
  platforms: string | null;
  publisher_game_count: number | null;
  release_year: number | null;
  review_score: number | null;
  review_sensitivity: number | null;
  sentiment_sensitivity: number | null;
  total_reviews: number | null;
  use_custom_settings: boolean | null;
}

interface UserContextAlertPreferencesRow extends QueryResultRow {
  alert_ccu_drop: boolean;
  alert_ccu_spike: boolean;
  alert_milestone: boolean;
  alert_new_release: boolean;
  alert_price_change: boolean;
  alert_review_surge: boolean;
  alert_sentiment_shift: boolean;
  alert_trend_reversal: boolean;
  alerts_enabled: boolean;
  ccu_sensitivity: number;
  email_digest_enabled: boolean;
  email_digest_frequency: string | null;
  review_sensitivity: number;
  sentiment_sensitivity: number;
}

interface UserContextAlertRow extends QueryResultRow {
  alert_id: string;
  alert_type: UserAlertType;
  change_percent: number | null;
  created_at: string;
  current_value: number | null;
  description: string;
  display_name: string;
  entity_id: number;
  entity_type: EntityKind;
  is_read: boolean;
  metric_name: string | null;
  pin_id: string;
  previous_value: number | null;
  read_at: string | null;
  severity: UserAlertSeverity;
  title: string;
}

interface UserContextUnreadCountRow extends QueryResultRow {
  unread_alert_count: number;
}

interface ExplainMomentAccumulator {
  directNewsGids: Set<string>;
  events: ChangeEventRow[];
  linkedNews: ExplainChangesLinkedNewsItem[];
  windowEnd: Date;
  windowStart: Date;
}

interface SearchChangeMomentAccumulator {
  appName: string;
  appType: string | null;
  appid: number;
  directNewsGids: Set<string>;
  events: SearchChangeEventRow[];
  isReleased: boolean | null;
  linkedNews: ExplainNewsRow[];
  releaseDate: string | null;
  windowEnd: Date;
  windowStart: Date;
}

type ChangeBurstStrength = 'high' | 'low' | 'medium';

interface ChangeEvidenceSummary {
  burstStrength: ChangeBurstStrength;
  relevanceReason: string;
  relevanceScore: number;
  significanceReasons: string[];
  strongestSignal: string | null;
}

interface ParsedTigerActivityId {
  activityKind: 'announcement' | 'change';
  appid: number;
  windowEnd: Date;
  windowStart: Date;
}

interface ContinuationTokenPayload {
  offset: number;
}

interface ResolvedReferenceEntity {
  id: number;
  metrics?: {
    developer_ids?: number[];
    price_cents?: number | null;
    publisher_ids?: number[];
    review_percentage?: number | null;
    total_reviews?: number | null;
  };
  name: string;
  type: string;
}

interface ResolveReferenceResult {
  candidates?: SemanticSearchCandidate[];
  entity?: ResolvedReferenceEntity | null;
  error?: string;
}

interface RelationLocation {
  schema: string;
  sql: string;
  table: string;
}

const DEFAULT_ENTITY_LIMIT = 8;
const DEFAULT_CATALOG_LIMIT = 25;
const DEFAULT_ENTITY_GAMES_LIMIT = 10;
const DEFAULT_RELATED_LIMIT = 10;
const DEFAULT_MOMENTUM_LIMIT = 10;
const DEFAULT_RANK_LIMIT = 10;
const DEFAULT_CONTINUE_LIMIT = 5;
const DEFAULT_CHANGE_ACTIVITY_DAYS = 30;
const DEFAULT_CHANGE_ACTIVITY_LIMIT = 10;
const DEFAULT_CHANGE_PATTERN_LIMIT = 10;
const DEFAULT_COMPARE_METRICS: CompareMetric[] = [
  'review_score',
  'total_reviews',
  'owners_midpoint',
  'ccu_peak',
  'game_count',
];
const DEFAULT_TRACE_DAYS = 30;
const DEFAULT_SEMANTIC_RESULTS = 10;
const DEFAULT_COMPANY_SEMANTIC_RESULTS = 6;
const DEFAULT_EXPLAIN_CHANGES_DAYS = 14;
const DEFAULT_EXPLAIN_CHANGES_LIMIT = 20;
const DEFAULT_DOCUMENT_SEARCH_DAYS = 30;
const DEFAULT_DOCUMENT_LIMIT = 8;
const DEFAULT_USER_ALERT_LIMIT = 10;
const DEFAULT_YOUTUBE_LIMIT = 10;
const DEFAULT_YOUTUBE_MARKET_LIMIT = 50;
const MAX_ENTITY_LIMIT = 15;
const MAX_CHAT_STRICT_ENTITY_LIMIT = 50;
const AUTOCOMPLETE_ENTITY_SCAN_BUFFER = 25;
const MAX_CATALOG_LIMIT = 50;
const MAX_ENTITY_GAMES_LIMIT = 25;
const MAX_RELATED_LIMIT = 25;
const MAX_MOMENTUM_LIMIT = 20;
const MAX_RANK_LIMIT = 25;
const DEFAULT_MONTHLY_PLAYTIME_LIMIT = 10;
const MAX_MONTHLY_PLAYTIME_LIMIT = 25;
const MAX_CONTINUE_LIMIT = 20;
const MAX_CHANGE_ACTIVITY_DAYS = 180;
const MAX_CHANGE_ACTIVITY_LIMIT = 25;
const MAX_CHANGE_PATTERN_LIMIT = 10;
const STRICT_ENTITY_SCAN_BUFFER = 25;
const MAX_COMPARE_ENTITY_COUNT = 5;
const MAX_TRACE_DAYS = 180;
const MAX_TRACE_METRICS = 4;
const MAX_SEMANTIC_RESULTS = 50;
const MAX_SEMANTIC_SEARCH_WINDOW = 120;
const MAX_EXPLAIN_CHANGES_DAYS = 90;
const MAX_EXPLAIN_CHANGES_LIMIT = 50;
const MAX_DOCUMENT_SEARCH_DAYS = 90;
const MAX_DOCUMENT_LIMIT = 10;
const MAX_USER_ALERT_LIMIT = 50;
const MAX_YOUTUBE_LIMIT = 25;
const MAX_YOUTUBE_MARKET_LIMIT = 100;
const YOUTUBE_MARKET_CANDIDATE_LIMIT = 200;
const EXPLAIN_CHANGE_MOMENT_GAP_MS = 6 * 60 * 60 * 1000;
const EXPLAIN_NEWS_PROXIMITY_MS = 24 * 60 * 60 * 1000;
const ALLOW_EMPTY_RELATIONS = new Set<DataPlaneRelationKey>([
  'user_pins',
  'user_alerts',
  'user_alert_preferences',
  'user_pin_alert_settings',
]);
const READINESS_GATE_CONTRACTS = new Set<
  RuntimeQueryContractDescriptor['name']
>([
  'resolveEntities',
  'searchCatalog',
  'searchChangeActivity',
  'getChangeActivityDetail',
  'discoverMomentum',
  'discoverChangePatterns',
  'getEntityOverview',
  'rankEntities',
  'queryMonthlyPlaytime',
  'semanticSearch',
  'compareEntities',
  'continueResultSet',
]);
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMANTIC_TITLE_STOP_WORDS = new Set([
  'game',
  'games',
  'edition',
  'definitive',
  'remastered',
  'remaster',
  'ultimate',
  'complete',
  'deluxe',
  'version',
  'chapter',
  'episode',
  'demo',
  'beta',
  'alpha',
  'prologue',
  'soundtrack',
  'ost',
  'the',
  'and',
  'of',
  'for',
  'to',
  'a',
  'an',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
]);
type SemanticSteamDeckCategory = NonNullable<SemanticSearchResultItem['steam_deck']>;
const SEMANTIC_CONCEPT_STOP_WORDS = new Set([
  'game',
  'games',
  'with',
  'that',
  'this',
  'those',
  'from',
  'into',
  'under',
  'over',
  'about',
  'like',
  'similar',
]);
const SEMANTIC_ATTRIBUTE_BLACKLIST = new Set([
  'action',
  'adventure',
  'indie',
  'casual',
  'rpg',
  'singleplayer',
  'early access',
  'story rich',
  'exploration',
  'atmospheric',
  'female protagonist',
]);
const TRACE_METRIC_SET = new Set<TraceMetric>([
  'owners_midpoint',
  'ccu_peak',
  'total_reviews',
  'positive_reviews',
  'negative_reviews',
  'review_score',
  'positive_percentage',
  'price_cents',
  'discount_percent',
  'average_playtime_forever',
  'average_playtime_2weeks',
]);
const COMPARE_METRIC_SET = new Set<CompareMetric>([
  'ccu_peak',
  'game_count',
  'owners_midpoint',
  'review_score',
  'total_reviews',
]);
const GAME_TYPE_PREDICATE: Record<DataPlaneConfig['source'], string> = {
  tiger: "a.type = 'game'",
  'supabase-postgres': "a.type = 'game'::public.app_type",
};
const CHANGE_TYPES_BY_SIGNAL_FAMILY: Record<ChangeActivitySignalFamily, readonly string[]> = {
  announcement: ['news_published', 'news_edited'],
  build: ['build_id_changed', 'last_content_update_changed'],
  media: [
    'capsule_url_changed',
    'header_url_changed',
    'background_url_changed',
    'screenshot_added',
    'screenshot_removed',
    'screenshot_reordered',
    'trailer_added',
    'trailer_removed',
    'trailer_reordered',
    'trailer_thumbnail_changed',
  ],
  platform: ['languages_changed', 'platforms_changed', 'controller_support_changed', 'steam_deck_status_changed'],
  pricing: [
    'price_change',
    'discount_start',
    'discount_end',
    'dlc_references_changed',
    'package_references_changed',
  ],
  release: ['release_date_text_change'],
  'store-page': ['description_rewrite', 'short_description_rewrite'],
  taxonomy: [
    'tags_added',
    'tags_removed',
    'genres_changed',
    'categories_changed',
    'publisher_association_changed',
    'developer_association_changed',
  ],
};
const CHANGE_TYPE_TO_SIGNAL_FAMILY = Object.fromEntries(
  Object.entries(CHANGE_TYPES_BY_SIGNAL_FAMILY).flatMap(([family, changeTypes]) =>
    changeTypes.map((changeType) => [changeType, family])
  )
) as Record<string, ChangeActivitySignalFamily>;
const RELATION_LOCATIONS: Record<
  DataPlaneConfig['source'],
  Record<DataPlaneRelationKey, RelationLocation>
> = {
  'supabase-postgres': {
    app_dlc: { schema: 'public', sql: 'public.app_dlc', table: 'app_dlc' },
    app_developers: { schema: 'public', sql: 'public.app_developers', table: 'app_developers' },
    app_franchises: { schema: 'public', sql: 'public.app_franchises', table: 'app_franchises' },
    app_genres: { schema: 'public', sql: 'public.app_genres', table: 'app_genres' },
    app_publishers: { schema: 'public', sql: 'public.app_publishers', table: 'app_publishers' },
    app_steam_deck: { schema: 'public', sql: 'public.app_steam_deck', table: 'app_steam_deck' },
    app_steam_tags: { schema: 'public', sql: 'public.app_steam_tags', table: 'app_steam_tags' },
    apps: { schema: 'public', sql: 'public.apps', table: 'apps' },
    ccu_snapshots: { schema: 'public', sql: 'public.ccu_snapshots', table: 'ccu_snapshots' },
    developers: { schema: 'public', sql: 'public.developers', table: 'developers' },
    latest_daily_metrics: {
      schema: 'public',
      sql: 'public.latest_daily_metrics',
      table: 'latest_daily_metrics',
    },
    metrics_daily_metrics: {
      schema: 'public',
      sql: 'public.daily_metrics',
      table: 'daily_metrics',
    },
    metrics_monthly_game_metrics: {
      schema: 'public',
      sql: 'public.monthly_game_metrics',
      table: 'monthly_game_metrics',
    },
    metrics_monthly_publisher_metrics: {
      schema: 'public',
      sql: 'public.monthly_publisher_metrics',
      table: 'monthly_publisher_metrics',
    },
    core_entities: {
      schema: 'public',
      sql: 'public.core_entities',
      table: 'core_entities',
    },
    core_entity_aliases: {
      schema: 'public',
      sql: 'public.core_entity_aliases',
      table: 'core_entity_aliases',
    },
    core_entity_external_ids: {
      schema: 'public',
      sql: 'public.core_entity_external_ids',
      table: 'core_entity_external_ids',
    },
    docs_steam_news_items: {
      schema: 'public',
      sql: 'public.steam_news_items',
      table: 'steam_news_items',
    },
    docs_steam_news_search_projection: {
      schema: 'public',
      sql: 'public.steam_news_search_projection',
      table: 'steam_news_search_projection',
    },
    events_app_change_events: {
      schema: 'public',
      sql: 'public.app_change_events',
      table: 'app_change_events',
    },
    events_change_activity_bursts: {
      schema: 'public',
      sql: 'public.change_activity_bursts',
      table: 'change_activity_bursts',
    },
    ops_app_capture_work_state: {
      schema: 'public',
      sql: 'public.app_capture_work_state',
      table: 'app_capture_work_state',
    },
    franchises: { schema: 'public', sql: 'public.franchises', table: 'franchises' },
    publishers: { schema: 'public', sql: 'public.publishers', table: 'publishers' },
    docs_youtube_channels: {
      schema: 'public',
      sql: 'public.youtube_channels',
      table: 'youtube_channels',
    },
    docs_youtube_video_matches: {
      schema: 'public',
      sql: 'public.youtube_video_matches',
      table: 'youtube_video_matches',
    },
    docs_youtube_videos: {
      schema: 'public',
      sql: 'public.youtube_videos',
      table: 'youtube_videos',
    },
    user_alert_preferences: {
      schema: 'public',
      sql: 'public.user_alert_preferences',
      table: 'user_alert_preferences',
    },
    user_alerts: { schema: 'public', sql: 'public.user_alerts', table: 'user_alerts' },
    user_pin_alert_settings: {
      schema: 'public',
      sql: 'public.user_pin_alert_settings',
      table: 'user_pin_alert_settings',
    },
    user_pins: { schema: 'public', sql: 'public.user_pins', table: 'user_pins' },
    metrics_youtube_game_daily: {
      schema: 'public',
      sql: 'public.youtube_game_daily',
      table: 'youtube_game_daily',
    },
    metrics_youtube_video_snapshots: {
      schema: 'public',
      sql: 'public.youtube_video_snapshots',
      table: 'youtube_video_snapshots',
    },
    steam_categories: { schema: 'public', sql: 'public.steam_categories', table: 'steam_categories' },
    steam_genres: { schema: 'public', sql: 'public.steam_genres', table: 'steam_genres' },
    steam_tags: { schema: 'public', sql: 'public.steam_tags', table: 'steam_tags' },
  },
  tiger: {
    app_dlc: { schema: 'legacy', sql: 'legacy.app_dlc', table: 'app_dlc' },
    app_developers: { schema: 'legacy', sql: 'legacy.app_developers', table: 'app_developers' },
    app_franchises: { schema: 'legacy', sql: 'legacy.app_franchises', table: 'app_franchises' },
    app_genres: { schema: 'legacy', sql: 'legacy.app_genres', table: 'app_genres' },
    app_publishers: { schema: 'legacy', sql: 'legacy.app_publishers', table: 'app_publishers' },
    app_steam_deck: { schema: 'legacy', sql: 'legacy.app_steam_deck', table: 'app_steam_deck' },
    app_steam_tags: { schema: 'legacy', sql: 'legacy.app_steam_tags', table: 'app_steam_tags' },
    apps: { schema: 'legacy', sql: 'legacy.apps', table: 'apps' },
    ccu_snapshots: { schema: 'metrics', sql: 'metrics.ccu_snapshots', table: 'ccu_snapshots' },
    developers: { schema: 'legacy', sql: 'legacy.developers', table: 'developers' },
    latest_daily_metrics: {
      schema: 'legacy',
      sql: 'legacy.latest_daily_metrics',
      table: 'latest_daily_metrics',
    },
    metrics_daily_metrics: {
      schema: 'metrics',
      sql: 'metrics.daily_metrics',
      table: 'daily_metrics',
    },
    metrics_monthly_game_metrics: {
      schema: 'metrics',
      sql: 'metrics.monthly_game_metrics',
      table: 'monthly_game_metrics',
    },
    metrics_monthly_publisher_metrics: {
      schema: 'metrics',
      sql: 'metrics.monthly_publisher_metrics',
      table: 'monthly_publisher_metrics',
    },
    core_entities: {
      schema: 'core',
      sql: 'core.entities',
      table: 'entities',
    },
    core_entity_aliases: {
      schema: 'core',
      sql: 'core.entity_aliases',
      table: 'entity_aliases',
    },
    core_entity_external_ids: {
      schema: 'core',
      sql: 'core.entity_external_ids',
      table: 'entity_external_ids',
    },
    docs_steam_news_items: {
      schema: 'docs',
      sql: 'docs.steam_news_items',
      table: 'steam_news_items',
    },
    docs_steam_news_search_projection: {
      schema: 'docs',
      sql: 'docs.steam_news_search_projection',
      table: 'steam_news_search_projection',
    },
    events_app_change_events: {
      schema: 'events',
      sql: 'events.app_change_events',
      table: 'app_change_events',
    },
    events_change_activity_bursts: {
      schema: 'events',
      sql: 'events.change_activity_bursts',
      table: 'change_activity_bursts',
    },
    ops_app_capture_work_state: {
      schema: 'ops',
      sql: 'ops.app_capture_work_state',
      table: 'app_capture_work_state',
    },
    franchises: { schema: 'legacy', sql: 'legacy.franchises', table: 'franchises' },
    publishers: { schema: 'legacy', sql: 'legacy.publishers', table: 'publishers' },
    docs_youtube_channels: {
      schema: 'docs',
      sql: 'docs.youtube_channels',
      table: 'youtube_channels',
    },
    docs_youtube_video_matches: {
      schema: 'docs',
      sql: 'docs.youtube_video_matches',
      table: 'youtube_video_matches',
    },
    docs_youtube_videos: {
      schema: 'docs',
      sql: 'docs.youtube_videos',
      table: 'youtube_videos',
    },
    user_alert_preferences: {
      schema: 'legacy',
      sql: 'legacy.user_alert_preferences',
      table: 'user_alert_preferences',
    },
    user_alerts: { schema: 'legacy', sql: 'legacy.user_alerts', table: 'user_alerts' },
    user_pin_alert_settings: {
      schema: 'legacy',
      sql: 'legacy.user_pin_alert_settings',
      table: 'user_pin_alert_settings',
    },
    user_pins: { schema: 'legacy', sql: 'legacy.user_pins', table: 'user_pins' },
    metrics_youtube_game_daily: {
      schema: 'metrics',
      sql: 'metrics.youtube_game_daily',
      table: 'youtube_game_daily',
    },
    metrics_youtube_video_snapshots: {
      schema: 'metrics',
      sql: 'metrics.youtube_video_snapshots',
      table: 'youtube_video_snapshots',
    },
    steam_categories: { schema: 'legacy', sql: 'legacy.steam_categories', table: 'steam_categories' },
    steam_genres: { schema: 'legacy', sql: 'legacy.steam_genres', table: 'steam_genres' },
    steam_tags: { schema: 'legacy', sql: 'legacy.steam_tags', table: 'steam_tags' },
  },
};

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(value)));
}

function normalizePositiveIntegers(values: number[] | undefined, max = 25): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(values.filter((value): value is number => Number.isInteger(value) && value > 0))
  ).slice(0, max);
}

function parseCountValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseNullableCountValue(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  return parseCountValue(value);
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function normalizeLikeValue(value: string): string {
  return `%${value.trim().toLowerCase()}%`;
}

function buildLexicalLikePatterns(value: string): string[] {
  const normalized = normalizeSemanticTextToken(value);
  if (!normalized) {
    return [];
  }

  const patterns = new Set<string>([normalizeLikeValue(normalized)]);

  for (const term of normalized.split(' ')) {
    if (term.length >= 3) {
      patterns.add(`%${term}%`);
    }
  }

  return [...patterns];
}

function sanitizeTitleFamilyValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[™®]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleFamilySuffixes(value: string): string {
  return value
    .replace(
      /\b(?:digital deluxe|deluxe edition|definitive edition|complete edition|ultimate edition|collector'?s edition|anniversary edition|director'?s cut|remaster(?:ed)?|game of the year edition|goty edition)\b.*$/i,
      ''
    )
    .replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x|2|3|4|5|6|7|8|9|10)\b(?:\s+.*)?$/i, '')
    .trim();
}

function deriveTitleFamilyQuery(sourceName: string): {
  patterns: string[];
  primaryKey: string;
  requiresSharedCompany: boolean;
} | null {
  const normalized = sanitizeTitleFamilyValue(sourceName);
  if (!normalized) {
    return null;
  }

  const candidates = new Set<string>();
  const addCandidate = (value: string): void => {
    const stripped = stripTitleFamilySuffixes(sanitizeTitleFamilyValue(value));
    if (stripped.length >= 4) {
      candidates.add(stripped);
    }
  };

  addCandidate(normalized);

  const colonPrefix = normalized.split(/\s[:\-–]\s|:/, 1)[0]?.trim();
  if (colonPrefix) {
    addCandidate(colonPrefix);
  }

  const ordered = [...candidates].sort((left, right) => right.length - left.length);
  const primaryKey = ordered[0] ?? null;
  if (!primaryKey) {
    return null;
  }

  return {
    patterns: ordered.map((entry) => `${entry}%`),
    primaryKey,
    requiresSharedCompany: primaryKey.split(/\s+/).length < 2,
  };
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}

function buildDefaultUserAlertPreferences(): UserContextAlertPreferences {
  return {
    alertCcuDrop: true,
    alertCcuSpike: true,
    alertMilestone: true,
    alertNewRelease: true,
    alertPriceChange: true,
    alertReviewSurge: true,
    alertSentimentShift: true,
    alertTrendReversal: true,
    alertsEnabled: true,
    ccuSensitivity: 1,
    emailDigestEnabled: false,
    emailDigestFrequency: 'daily',
    reviewSensitivity: 1,
    sentimentSensitivity: 1,
    source: 'default',
  };
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function coerceNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseTimestamp(value: string): Date {
  return new Date(value);
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function truncatePreview(value: string | null | undefined, maxLength = 220): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeChangeSignalFamilies(value: unknown): ChangeActivitySignalFamily[] {
  const families = toStringArray(value).filter(
    (entry): entry is ChangeActivitySignalFamily =>
      entry === 'announcement'
      || entry === 'release'
      || entry === 'pricing'
      || entry === 'store-page'
      || entry === 'media'
      || entry === 'taxonomy'
      || entry === 'platform'
      || entry === 'build'
  );

  return [...new Set(families)];
}

function normalizeChangeStoryKinds(value: unknown): Array<
  | 'announcement'
  | 'commercial-move'
  | 'launch-prep'
  | 'store-refresh'
  | 'taxonomy-shift'
  | 'update-tease'
  | 'change-roundup'
> {
  const storyKinds = toStringArray(value).filter(
    (
      entry
    ): entry is
      | 'announcement'
      | 'commercial-move'
      | 'launch-prep'
      | 'store-refresh'
      | 'taxonomy-shift'
      | 'update-tease'
      | 'change-roundup' =>
      entry === 'announcement'
      || entry === 'commercial-move'
      || entry === 'launch-prep'
      || entry === 'store-refresh'
      || entry === 'taxonomy-shift'
      || entry === 'update-tease'
      || entry === 'change-roundup'
  );

  return [...new Set(storyKinds)];
}

function normalizeChangeStoryKind(value: string | null | undefined): ChangeActivityStoryKind {
  const storyKinds = normalizeChangeStoryKinds(value ? [value] : []);
  return storyKinds[0] ?? 'change-roundup';
}

function resolveOwnersMidpoint(row: DailyMetricHistoryRow): number | null {
  if (row.owners_min === null && row.owners_max === null) {
    return null;
  }

  const minValue = row.owners_min ?? row.owners_max ?? 0;
  const maxValue = row.owners_max ?? row.owners_min ?? 0;
  return (minValue + maxValue) / 2;
}

function traceMetricValue(metric: TraceMetric, row: DailyMetricHistoryRow): number | null {
  switch (metric) {
    case 'average_playtime_2weeks':
      return row.average_playtime_2weeks;
    case 'average_playtime_forever':
      return row.average_playtime_forever;
    case 'ccu_peak':
      return row.ccu_peak;
    case 'discount_percent':
      return row.discount_percent;
    case 'negative_reviews':
      return row.negative_reviews;
    case 'owners_midpoint':
      return resolveOwnersMidpoint(row);
    case 'positive_percentage':
      return row.total_reviews && row.total_reviews > 0 && row.positive_reviews !== null
        ? roundNumber((row.positive_reviews * 100) / row.total_reviews, 1)
        : null;
    case 'positive_reviews':
      return row.positive_reviews;
    case 'price_cents':
      return row.price_cents;
    case 'review_score':
      return normalizeReviewPercentageValue(row.review_score);
    case 'total_reviews':
      return row.total_reviews;
  }
}

function normalizeReviewPercentageValue(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return value >= 0 && value <= 10
    ? roundNumber(value * 10, 2)
    : value;
}

function reviewPercentageSql(alias: string): string {
  return `CASE
    WHEN ${alias}.positive_percentage IS NOT NULL THEN ${alias}.positive_percentage
    WHEN ${alias}.review_score IS NOT NULL AND ${alias}.review_score <= 10
      THEN ROUND((${alias}.review_score::numeric * 10), 2)::double precision
    ELSE ${alias}.review_score
  END`;
}

function metricValueForRow(metric: RankMetric, row: RankRow): number | null {
  switch (metric) {
    case 'ccu_peak':
      return row.ccu_peak;
    case 'game_count':
      return row.game_count;
    case 'owners_midpoint':
      return row.owners_midpoint;
    case 'review_score':
      return normalizeReviewPercentageValue(row.review_score);
    case 'total_reviews':
      return row.total_reviews;
  }
}

function comparedMetricValue(metric: CompareMetric, item: ComparedEntity): number | null {
  switch (metric) {
    case 'ccu_peak':
      return item.metrics.ccuPeak;
    case 'game_count':
      return item.metrics.gameCount;
    case 'owners_midpoint':
      return item.metrics.ownersMidpoint;
    case 'review_score':
      return normalizeReviewPercentageValue(item.metrics.reviewScore);
    case 'total_reviews':
      return item.metrics.totalReviews;
  }
}

function inferMatchQuality(candidate: string, query: string): MatchQuality {
  const normalizedCandidate = normalizeSemanticTextToken(candidate);
  const normalizedQuery = normalizeSemanticTextToken(query);
  const compactCandidate = normalizedCandidate.replace(/\s+/g, '');
  const compactQuery = normalizedQuery.replace(/\s+/g, '');

  if (normalizedCandidate === normalizedQuery || compactCandidate === compactQuery) {
    return 'exact';
  }

  if (
    normalizedCandidate.startsWith(normalizedQuery) ||
    compactCandidate.startsWith(compactQuery)
  ) {
    return 'prefix';
  }

  return 'substring';
}

function normalizeMatchQuality(value: unknown): MatchQuality | null {
  return value === 'exact' || value === 'prefix' || value === 'substring' || value === 'fuzzy'
    ? value
    : null;
}

function normalizeResolveEntitiesResolutionMode(value: unknown): ResolveEntitiesResolutionMode {
  return value === 'chat_strict' || value === 'autocomplete' ? value : 'default';
}

function normalizeResolveEntitiesResolutionPreference(
  value: unknown
): ResolveEntitiesResolutionPreference | null {
  return value === 'game' || value === 'company' ? value : null;
}

function normalizeResolveEntityMatchSource(value: unknown): ResolveEntityMatchSource | null {
  return value === 'platform_entity_id'
    || value === 'canonical_name'
    || value === 'normalized_name'
    || value === 'alias'
    || value === 'normalized_alias'
    || value === 'legacy_name'
    ? value
    : null;
}

function normalizeResolveEntityResolutionTier(value: unknown): ResolveEntityResolutionTier | null {
  return value === 'platform_id_exact'
    || value === 'canonical_exact'
    || value === 'alias_exact'
    || value === 'normalized_exact'
    || value === 'canonical_prefix'
    || value === 'alias_prefix'
    || value === 'legacy_prefix'
    || value === 'canonical_substring'
    || value === 'alias_substring'
    || value === 'legacy_substring'
    || value === 'legacy_exact'
    || value === 'fuzzy'
    ? value
    : null;
}

function matchConfidence(matchQuality: MatchQuality, matchRank?: number | null): number {
  if (matchRank !== null && matchRank !== undefined) {
    switch (matchRank) {
      case -1:
        return 0.999;
      case 0:
        return 0.995;
      case 1:
        return 0.993;
      case 2:
        return 0.989;
      case 3:
        return 0.92;
      case 4:
        return 0.82;
      case 5:
        return 0.72;
      default:
        break;
    }
  }

  switch (matchQuality) {
    case 'exact':
      return 0.99;
    case 'prefix':
      return 0.92;
    case 'fuzzy':
      return 0.72;
    default:
      return 0.82;
  }
}

function inferLegacyResolutionTier(matchQuality: MatchQuality): ResolveEntityResolutionTier {
  switch (matchQuality) {
    case 'exact':
      return 'legacy_exact';
    case 'prefix':
      return 'legacy_prefix';
    case 'substring':
      return 'legacy_substring';
    default:
      return 'fuzzy';
  }
}

function inferResolutionTierFromResolvedEntity(entity: Pick<ResolvedEntity, 'matchQuality' | 'resolutionTier'>): ResolveEntityResolutionTier {
  return entity.resolutionTier
    ?? inferLegacyResolutionTier(entity.matchQuality);
}

function resolutionTierRank(tier: ResolveEntityResolutionTier | null | undefined): number {
  switch (tier) {
    case 'platform_id_exact':
      return 0;
    case 'canonical_exact':
      return 1;
    case 'alias_exact':
      return 2;
    case 'normalized_exact':
      return 3;
    case 'legacy_exact':
      return 4;
    case 'canonical_prefix':
      return 5;
    case 'alias_prefix':
      return 6;
    case 'legacy_prefix':
      return 7;
    case 'canonical_substring':
      return 8;
    case 'alias_substring':
      return 9;
    case 'legacy_substring':
      return 10;
    case 'fuzzy':
    default:
      return 11;
  }
}

function compareResolvedEntitiesByResolutionPriority(left: ResolvedEntity, right: ResolvedEntity): number {
  const tierDelta = resolutionTierRank(inferResolutionTierFromResolvedEntity(left))
    - resolutionTierRank(inferResolutionTierFromResolvedEntity(right));
  if (tierDelta !== 0) {
    return tierDelta;
  }

  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  const rightReviews = right.latestMetrics?.totalReviews ?? 0;
  const leftReviews = left.latestMetrics?.totalReviews ?? 0;
  if (rightReviews !== leftReviews) {
    return rightReviews - leftReviews;
  }

  return left.displayName.localeCompare(right.displayName);
}

function choosePreferredResolvedEntity(left: ResolvedEntity, right: ResolvedEntity): ResolvedEntity {
  return compareResolvedEntitiesByResolutionPriority(left, right) <= 0 ? left : right;
}

function compareResolvedEntitiesByDefaultMode(left: ResolvedEntity, right: ResolvedEntity): number {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  const rightReviews = right.latestMetrics?.totalReviews ?? 0;
  const leftReviews = left.latestMetrics?.totalReviews ?? 0;
  if (rightReviews !== leftReviews) {
    return rightReviews - leftReviews;
  }

  return left.displayName.localeCompare(right.displayName);
}

function autocompleteMatchQualityRank(entity: ResolvedEntity): number {
  switch (entity.matchQuality) {
    case 'exact':
      return 0;
    case 'prefix':
      return 1;
    case 'substring':
      return 2;
    case 'fuzzy':
    default:
      return 3;
  }
}

function autocompleteKindRank(
  entity: ResolvedEntity,
  preference: ResolveEntitiesResolutionPreference | null
): number {
  const preferredGame = preference !== 'company';
  if (preferredGame) {
    return entity.entityKind === 'game' ? 0 : 1;
  }

  return entity.entityKind === 'game' ? 1 : 0;
}

function compareResolvedEntitiesByAutocompletePriority(
  left: ResolvedEntity,
  right: ResolvedEntity,
  preference: ResolveEntitiesResolutionPreference | null
): number {
  const kindDelta = autocompleteKindRank(left, preference) - autocompleteKindRank(right, preference);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  const matchQualityDelta = autocompleteMatchQualityRank(left) - autocompleteMatchQualityRank(right);
  if (matchQualityDelta !== 0) {
    return matchQualityDelta;
  }

  if (left.entityKind === 'game' && right.entityKind === 'game') {
    const rightReviews = right.latestMetrics?.totalReviews ?? 0;
    const leftReviews = left.latestMetrics?.totalReviews ?? 0;
    if (rightReviews !== leftReviews) {
      return rightReviews - leftReviews;
    }

    const rightCcu = right.latestMetrics?.ccuPeak ?? 0;
    const leftCcu = left.latestMetrics?.ccuPeak ?? 0;
    if (rightCcu !== leftCcu) {
      return rightCcu - leftCcu;
    }

    const rightOwners = right.latestMetrics?.ownersMidpoint ?? 0;
    const leftOwners = left.latestMetrics?.ownersMidpoint ?? 0;
    if (rightOwners !== leftOwners) {
      return rightOwners - leftOwners;
    }

    const rightReleaseYear = right.releaseYear ?? 0;
    const leftReleaseYear = left.releaseYear ?? 0;
    if (rightReleaseYear !== leftReleaseYear) {
      return rightReleaseYear - leftReleaseYear;
    }
  } else if (left.entityKind !== 'game' && right.entityKind !== 'game') {
    const rightGameCount = right.signals?.gameCount ?? 0;
    const leftGameCount = left.signals?.gameCount ?? 0;
    if (rightGameCount !== leftGameCount) {
      return rightGameCount - leftGameCount;
    }
  }

  const tierDelta = resolutionTierRank(inferResolutionTierFromResolvedEntity(left))
    - resolutionTierRank(inferResolutionTierFromResolvedEntity(right));
  if (tierDelta !== 0) {
    return tierDelta;
  }

  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  return left.displayName.localeCompare(right.displayName);
}

function buildDefaultResolveAmbiguity(entities: ResolvedEntity[]): ResolveEntitiesResponse['ambiguity'] {
  if (entities.length <= 1) {
    return {
      candidateNames: entities.map((entity) => entity.displayName),
      message: null,
      requiresClarification: false,
    };
  }

  return {
    candidateNames: entities.slice(0, 3).map((entity) => entity.displayName),
    message:
      entities[0].confidence - entities[1].confidence < 0.08
        ? 'Multiple strong matches found. A follow-up disambiguation question may improve answer quality.'
        : null,
    requiresClarification:
      entities[0].confidence - entities[1].confidence < 0.08,
  };
}

function buildStrictResolveAmbiguity(
  entityKind: EntityKind,
  entities: ResolvedEntity[]
): ResolveEntitiesResponse['ambiguity'] {
  const top = entities[0] ?? null;
  if (!top) {
    return {
      bestTier: null,
      bestTierCount: 0,
      candidateNames: [],
      message:
        entityKind === 'game'
          ? 'I could not find a matching game title.'
          : `I could not find a matching ${entityKind}.`,
      requiresClarification: true,
    };
  }

  const bestTier = inferResolutionTierFromResolvedEntity(top);
  const bestTierEntities = entities.filter(
    (entity) => inferResolutionTierFromResolvedEntity(entity) === bestTier
  );
  const requiresClarification = bestTier === 'fuzzy' || bestTierEntities.length > 1;

  return {
    bestTier,
    bestTierCount: bestTierEntities.length,
    candidateNames: bestTierEntities.slice(0, 10).map((entity) => entity.displayName),
    message:
      bestTier === 'fuzzy'
        ? (
          entityKind === 'game'
            ? 'I could not confidently resolve this game title. Please choose the correct match.'
            : `I could not confidently resolve this ${entityKind}. Please choose the correct match.`
        )
        : requiresClarification
          ? (
            entityKind === 'game'
              ? 'Multiple plausible game matches remain in the best lexical tier. Please choose the correct one.'
              : `Multiple plausible ${entityKind} matches remain in the best lexical tier. Please choose the correct one.`
          )
          : null,
    requiresClarification,
  };
}

function normalizeLookupTextPreservingPunctuation(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeSemanticTextToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function buildCanonicalLookupTerms(query: string): CanonicalLookupTerms | null {
  const rawQuery = normalizeLookupTextPreservingPunctuation(query);
  const normalizedQuery = normalizeLookupTextPreservingPunctuation(query);
  const looseQuery = normalizeSemanticTextToken(query);
  const compactQuery = looseQuery.replace(/\s+/g, '');

  if (!rawQuery || !normalizedQuery || !looseQuery || !compactQuery) {
    return null;
  }

  return {
    compactQuery,
    compactPrefix: `${compactQuery}%`,
    compactSubstring: `%${compactQuery}%`,
    looseQuery,
    loosePrefix: `${looseQuery}%`,
    looseSubstring: `%${looseQuery}%`,
    normalizedQuery,
    rawQuery,
  };
}

function tokenizeSemanticTitle(value: string): string[] {
  return normalizeSemanticTextToken(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !SEMANTIC_TITLE_STOP_WORDS.has(token));
}

function tokenizeSemanticConcept(value: string): string[] {
  return normalizeSemanticTextToken(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !SEMANTIC_CONCEPT_STOP_WORDS.has(token));
}

function sharedSemanticStrings(left: string[] | undefined, right: string[] | undefined): string[] {
  if (!left?.length || !right?.length) {
    return [];
  }

  const normalizedRight = new Map<string, string>(
    right
      .map((value) => [normalizeSemanticTextToken(value), value.trim()] as const)
      .filter(([key]) => key.length > 0)
  );

  const matches: string[] = [];
  for (const value of left) {
    const normalized = normalizeSemanticTextToken(value);
    const match = normalizedRight.get(normalized);
    if (match && !matches.some((candidate) => normalizeSemanticTextToken(candidate) === normalized)) {
      matches.push(match);
    }
  }

  return matches;
}

function filterSemanticAttributes(values: string[]): string[] {
  return values.filter((value) => !SEMANTIC_ATTRIBUTE_BLACKLIST.has(normalizeSemanticTextToken(value)));
}

function semanticReviewSupportBonus(
  totalReviews: number | null | undefined,
  reviewPercentage: number | null | undefined
): number {
  if (
    totalReviews !== null &&
    totalReviews !== undefined &&
    totalReviews >= 500 &&
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    reviewPercentage >= 80
  ) {
    return 0.05;
  }

  if (
    totalReviews !== null &&
    totalReviews !== undefined &&
    totalReviews >= 100 &&
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    reviewPercentage >= 70
  ) {
    return 0.025;
  }

  return 0;
}

function semanticLowSignalPenalty(
  totalReviews: number | null | undefined,
  reviewPercentage: number | null | undefined
): number {
  if (totalReviews === null || totalReviews === undefined || totalReviews < 20) {
    return 0.12;
  }

  if (
    reviewPercentage !== null &&
    reviewPercentage !== undefined &&
    totalReviews < 50 &&
    reviewPercentage < 60
  ) {
    return 0.08;
  }

  return 0;
}

function semanticClosenessScore(left: number | null | undefined, right: number | null | undefined): number {
  if (!left || !right) {
    return 0;
  }

  const leftLog = Math.log10(left + 1);
  const rightLog = Math.log10(right + 1);
  const distance = Math.abs(leftLog - rightLog);

  return Math.max(0, 1 - distance / 3);
}

function hasSuspiciousSemanticTitleOverlap(referenceName: string, candidateName: string): boolean {
  const referenceTokens = tokenizeSemanticTitle(referenceName);
  const candidateTokens = tokenizeSemanticTitle(candidateName);

  if (referenceTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }

  const shared = referenceTokens.filter((token) => candidateTokens.includes(token));
  const sharedRatio = shared.length / Math.max(referenceTokens.length, candidateTokens.length);

  return sharedRatio >= 0.75;
}

function normalizeSemanticSteamDeckCategory(
  category: string | null | undefined
): SemanticSteamDeckCategory | undefined {
  return category === 'playable' || category === 'verified' ? category : undefined;
}

function buildProvenance(source: DataPlaneConfig['source'], tables: string[]): QueryProvenance {
  return {
    capturedAt: new Date().toISOString(),
    source,
    tables,
  };
}

function encodeContinuationToken(payload: ContinuationTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeContinuationToken(token: string | null | undefined): ContinuationTokenPayload {
  if (!token) {
    return { offset: 0 };
  }

  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };

    const offset = Number(parsed.offset);
    return Number.isFinite(offset) && offset >= 0
      ? { offset: Math.floor(offset) }
      : { offset: 0 };
  } catch {
    return { offset: 0 };
  }
}

export class DataPlaneService {
  constructor(private readonly config: DataPlaneConfig = loadDataPlaneConfig()) {}

  async describeContracts(): Promise<{
    contracts: RuntimeQueryContractDescriptor[];
    source: DataPlaneConfig['source'];
  }> {
    const contracts = await Promise.all(
      CONTRACT_REGISTRY.map(async (contract) => {
        const blockingTables =
          contract.status === 'ready'
            ? await this.getContractBlockers(contract)
            : [
                ...contract.requiredRelations.map((relationKey) => this.relation(relationKey).sql),
                ...this.getAdditionalContractBlockers(contract.name),
              ];

        return {
          ...contract,
          blockingTables,
          runtimeReadiness:
            contract.status === 'ready' && blockingTables.length === 0 ? 'ready' : 'blocked',
        } satisfies RuntimeQueryContractDescriptor;
      })
    );

    return {
      contracts,
      source: this.config.source,
    };
  }

  async healthCheck(): Promise<QueryProvenance> {
    await runQuery('SELECT 1', [], this.config);
    return buildProvenance(this.config.source, []);
  }

  async readinessCheck(): Promise<DataPlaneReadiness> {
    const description = await this.describeContracts();
    const blockedContracts = description.contracts
      .filter((contract) => contract.status === 'ready' && contract.runtimeReadiness === 'blocked')
      .map((contract) => ({
        blockingTables: contract.blockingTables,
        name: contract.name,
      }));
    const readinessBlockingContracts = blockedContracts.filter((contract) =>
      READINESS_GATE_CONTRACTS.has(contract.name)
    );

    return {
      blockedContracts,
      provenance: buildProvenance(
        this.config.source,
        description.contracts
          .filter((contract) => contract.status === 'ready')
          .flatMap((contract) => contract.requiredRelations.map((relationKey) => this.relation(relationKey).sql))
      ),
      ready: readinessBlockingContracts.length === 0,
    };
  }

  async resolveEntities(request: ResolveEntitiesRequest): Promise<ResolveEntitiesResponse> {
    await this.assertContractRuntime('resolveEntities');
    const query = request.query.trim();
    const resolutionMode = normalizeResolveEntitiesResolutionMode(request.resolutionMode);
    const resolutionPreference = normalizeResolveEntitiesResolutionPreference(
      request.resolutionPreference
    );

    if (!query) {
      return {
        ambiguity: {
          candidateNames: [],
          message: 'Query text is required.',
          requiresClarification: true,
        },
        continuationToken: null,
        entities: [],
        provenance: buildProvenance(this.config.source, []),
        totalCandidates: 0,
      };
    }

    const requestedKinds = new Set<EntityKind>(
      request.entityKinds?.length ? request.entityKinds : ['game', 'publisher', 'developer']
    );
    const strictSingleKindResolver =
      resolutionMode === 'chat_strict'
      && requestedKinds.size === 1;
    const strictResolverKind =
      strictSingleKindResolver
        ? [...requestedKinds][0] ?? null
        : null;
    const limit = normalizeLimit(
      request.limit,
      strictSingleKindResolver ? Math.min(DEFAULT_ENTITY_LIMIT, MAX_CHAT_STRICT_ENTITY_LIMIT) : DEFAULT_ENTITY_LIMIT,
      strictSingleKindResolver ? MAX_CHAT_STRICT_ENTITY_LIMIT : MAX_ENTITY_LIMIT
    );
    const continuation = decodeContinuationToken(request.continuationToken);
    const offset = continuation.offset;
    const scanLimit = strictSingleKindResolver
      ? Math.min(MAX_CHAT_STRICT_ENTITY_LIMIT, offset + limit + STRICT_ENTITY_SCAN_BUFFER)
      : resolutionMode === 'autocomplete'
        ? Math.min(MAX_CHAT_STRICT_ENTITY_LIMIT, offset + limit + AUTOCOMPLETE_ENTITY_SCAN_BUFFER)
        : limit;
    const includeMetrics = request.includeMetrics ?? true;
    const includeMetricsForSorting = resolutionMode === 'autocomplete' ? true : includeMetrics;
    const canonicalQueryOptions: CanonicalEntityQueryOptions = {
      allowFuzzyFallback: resolutionMode !== 'autocomplete',
      lightweight: resolutionMode === 'autocomplete',
    };

    const entities: ResolvedEntity[] = [];
    const provenanceTables = new Set<string>();
    const useCanonicalResolver = this.config.source === 'tiger';
    const requestedKindOrder = (['game', 'publisher', 'developer'] as const)
      .filter((kind) => requestedKinds.has(kind));
    const kindResults = await Promise.all(
      requestedKindOrder.map(async (kind) => {
        const canonicalRows = useCanonicalResolver
          ? await this.queryCanonicalEntities(kind, query, scanLimit, canonicalQueryOptions)
          : [];
        const shouldUseLegacyFallback =
          (!useCanonicalResolver || resolutionMode !== 'autocomplete')
          && (
            canonicalRows.length === 0
            || canonicalRows.every((row) => (row.match_quality ?? 'fuzzy') === 'fuzzy')
          );

        if (kind === 'game') {
          const rows = shouldUseLegacyFallback
            ? [
                ...canonicalRows,
                ...await this.queryGames(query, scanLimit),
                ...await this.queryGamesLexical(query, scanLimit),
              ]
            : canonicalRows;

          return {
            kind,
            platform: 'steam' as const,
            provenance: ['apps', 'latest_daily_metrics'] as const,
            rows,
          };
        }

        const rows = shouldUseLegacyFallback
          ? [
              ...canonicalRows,
              ...await this.queryCompanies(kind, query, scanLimit),
              ...await this.queryCompaniesLexical(kind, query, scanLimit),
            ]
          : canonicalRows;

        return {
          kind,
          platform: 'publisheriq' as const,
          provenance: [kind === 'publisher' ? 'publishers' : 'developers'] as const,
          rows,
        };
      })
    );

    for (const kindResult of kindResults) {
      entities.push(
        ...kindResult.rows.map((row) =>
          this.mapResolvedEntity(kindResult.kind, kindResult.platform, row, query, includeMetricsForSorting)
        )
      );

      if (useCanonicalResolver) {
        provenanceTables.add(this.relation('core_entities').sql);
        provenanceTables.add(this.relation('core_entity_aliases').sql);
      }

      for (const relationKey of kindResult.provenance) {
        provenanceTables.add(this.relation(relationKey).sql);
      }
    }

    const sortedEntities = [...entities
      .reduce<Map<string, ResolvedEntity>>((deduped, entity) => {
        const existing = deduped.get(entity.entityUid);
        deduped.set(
          entity.entityUid,
          existing ? choosePreferredResolvedEntity(existing, entity) : entity
        );
        return deduped;
      }, new Map())
      .values()]
      .sort((left, right) => strictSingleKindResolver
        ? compareResolvedEntitiesByResolutionPriority(left, right)
        : resolutionMode === 'autocomplete'
          ? compareResolvedEntitiesByAutocompletePriority(left, right, resolutionPreference)
          : compareResolvedEntitiesByDefaultMode(left, right));

    const totalCandidates = sortedEntities.length;
    const pagedEntities = sortedEntities
      .slice(offset, offset + limit)
      .map((entity) => includeMetrics
        ? entity
        : {
            ...entity,
            latestMetrics: undefined,
          });
    const ambiguity = strictResolverKind
      ? buildStrictResolveAmbiguity(strictResolverKind, sortedEntities)
      : buildDefaultResolveAmbiguity(pagedEntities);
    if (
      !strictSingleKindResolver
      && requestedKinds.size === 1
      && requestedKinds.has('game')
      && pagedEntities[0]?.matchQuality === 'fuzzy'
    ) {
      ambiguity.message =
        'I could not confidently resolve this game title. Please choose a more specific title.';
      ambiguity.requiresClarification = true;
    }
    const continuationToken =
      offset + limit < totalCandidates
        ? encodeContinuationToken({ offset: offset + limit })
        : null;

    return {
      ambiguity,
      continuationToken,
      entities: pagedEntities,
      provenance: buildProvenance(this.config.source, [...provenanceTables]),
      totalCandidates,
    };
  }

  async getEntityOverview(
    request: GetEntityOverviewRequest
  ): Promise<GetEntityOverviewResponse> {
    await this.assertContractRuntime('getEntityOverview');

    let entityKind = request.entityKind;
    let platformEntityId = request.platformEntityId?.trim() ?? '';
    let entityUid = request.entityUid?.trim() ?? '';

    if (entityUid) {
      const resolvedEntity = await this.resolveCoreEntity(entityUid, {
        invalidCode: 'INVALID_ENTITY_OVERVIEW_ENTITY_UID',
        notFoundCode: 'ENTITY_OVERVIEW_NOT_FOUND',
      });
      entityKind = resolvedEntity.entity_kind;
      platformEntityId = resolvedEntity.platform_entity_id;
      entityUid = resolvedEntity.entity_uid;
    }

    const entityId = Number(platformEntityId);
    if (!Number.isInteger(entityId) || entityId <= 0) {
      throw new PublisherIQError(
        'getEntityOverview requires a numeric platformEntityId.',
        'INVALID_ENTITY_OVERVIEW_ID',
        {
          entityKind,
          platformEntityId: request.platformEntityId ?? null,
        }
      );
    }

    const gamesSortBy = request.gamesSortBy === 'reviews' ? 'reviews' : 'release_date';
    const requestedGamesLimit = request.gamesLimit ?? (entityKind === 'game' ? 0 : DEFAULT_ENTITY_GAMES_LIMIT);
    const gamesLimit = Math.max(0, Math.min(Math.trunc(requestedGamesLimit), MAX_ENTITY_GAMES_LIMIT));
    const overviewRow =
      entityKind === 'game'
        ? await this.queryGameOverview(entityId)
        : await this.queryCompanyOverview(entityKind, entityId);

    if (!overviewRow) {
      throw new PublisherIQError(
        `No ${entityKind} was found for platformEntityId ${platformEntityId}.`,
        'ENTITY_OVERVIEW_NOT_FOUND',
        {
          entityKind,
          platformEntityId,
        }
      );
    }

    const games =
      entityKind !== 'game' && gamesLimit > 0
        ? await this.queryEntityOverviewGames(entityKind, entityId, gamesLimit, gamesSortBy)
        : [];
    const platform = entityKind === 'game' ? 'steam' : 'publisheriq';

    return {
      entity: {
        details: {
          appType: overviewRow.app_type,
          developerIds: overviewRow.developer_ids ?? [],
          developers: overviewRow.developers ?? [],
          discountPercent: overviewRow.discount_percent,
          isFree: overviewRow.is_free,
          isReleased: overviewRow.is_released,
          parentAppid: overviewRow.parent_appid,
          platforms: overviewRow.platforms
            ? overviewRow.platforms.split(',').map((value) => value.trim()).filter(Boolean)
            : [],
          priceCents: overviewRow.price_cents,
          publisherIds: overviewRow.publisher_ids ?? [],
          publishers: overviewRow.publishers ?? [],
          releaseDate: overviewRow.release_date,
          releaseState: overviewRow.release_state,
          releaseYear: overviewRow.release_year,
        },
        displayName: overviewRow.display_name,
        entityKind,
        entityUid: entityUid || buildEntityUid(platform, entityKind, platformEntityId),
        metrics: {
          ccuPeak: overviewRow.ccu_peak,
          gameCount: entityKind === 'game' ? null : overviewRow.game_count,
          ownersMidpoint: overviewRow.owners_midpoint,
          reviewScore: overviewRow.review_score,
          totalReviews: overviewRow.total_reviews,
        },
        platform,
        platformEntityId,
      },
      games: games.map((row) => ({
        appid: row.appid,
        name: row.name,
        ownersMidpoint: row.owners_midpoint,
        releaseDate: row.release_date,
        releaseYear: row.release_year,
        reviewScore: row.review_score,
        totalReviews: row.total_reviews,
      })),
      provenance: buildProvenance(
        this.config.source,
        entityKind === 'game'
          ? [
              this.relation('apps').sql,
              this.relation('latest_daily_metrics').sql,
              this.relation('app_publishers').sql,
              this.relation('publishers').sql,
              this.relation('app_developers').sql,
              this.relation('developers').sql,
            ]
          : [
              this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql,
              this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql,
              this.relation('apps').sql,
              this.relation('latest_daily_metrics').sql,
            ]
      ),
      sufficientToAnswer: true,
    };
  }

  async getRelatedEntities(
    request: GetRelatedEntitiesRequest
  ): Promise<GetRelatedEntitiesResponse> {
    await this.assertContractRuntime('getRelatedEntities');

    const relationKind = request.relationKind;
    const limit = normalizeLimit(request.limit, DEFAULT_RELATED_LIMIT, MAX_RELATED_LIMIT);
    let sourceAppid = Number.isInteger(request.sourceAppid) ? Number(request.sourceAppid) : null;

    if (!sourceAppid && request.sourceEntityUid?.trim()) {
      const sourceEntity = await this.resolveCoreEntity(request.sourceEntityUid.trim(), {
        invalidCode: 'INVALID_RELATED_SOURCE_UID',
        notFoundCode: 'RELATED_SOURCE_NOT_FOUND',
      });

      if (sourceEntity.entity_kind !== 'game' || sourceEntity.platform !== 'steam') {
        throw new PublisherIQError(
          'getRelatedEntities currently requires a Steam game source entity.',
          'INVALID_RELATED_SOURCE_KIND',
          {
            entityKind: sourceEntity.entity_kind,
            platform: sourceEntity.platform,
            sourceEntityUid: request.sourceEntityUid,
          }
        );
      }

      sourceAppid = Number(sourceEntity.platform_entity_id);
    }

    if (!Number.isInteger(sourceAppid) || (sourceAppid ?? 0) <= 0) {
      throw new PublisherIQError(
        'getRelatedEntities requires a numeric sourceAppid or a resolvable Steam game sourceEntityUid.',
        'INVALID_RELATED_SOURCE_ID',
        {
          sourceAppid: request.sourceAppid,
          sourceEntityUid: request.sourceEntityUid ?? null,
        }
      );
    }

    const resolvedSourceAppid = Number(sourceAppid);
    const sourceOverview = await this.queryGameOverview(resolvedSourceAppid);
    if (!sourceOverview) {
      throw new PublisherIQError(
        'No source game was found for the provided related-entity lookup.',
        'RELATED_SOURCE_NOT_FOUND',
        {
          sourceAppid: resolvedSourceAppid,
        }
      );
    }

    const sourceSteamDeckCategory = await this.querySteamDeckCategoryByApp(resolvedSourceAppid);
    const relatedLookup = relationKind === 'dlc'
      ? await this.lookupRelatedDlcRows({
          excludeSource: request.excludeSource !== false,
          filters: request.filters ?? null,
          limit,
          sourceAppid: resolvedSourceAppid,
          sourceReviewScore: sourceOverview.review_score,
        })
      : await this.lookupRelatedFranchiseRows({
          excludeSource: request.excludeSource !== false,
          filters: request.filters ?? null,
          limit,
          sourceAppid: resolvedSourceAppid,
          sourceDeveloperIds: sourceOverview.developer_ids ?? [],
          sourceName: sourceOverview.display_name,
          sourcePublisherIds: sourceOverview.publisher_ids ?? [],
          sourceReviewScore: sourceOverview.review_score,
        });

    const sourceFranchiseNames =
      relationKind === 'franchise_games' && relatedLookup.matchMode === 'structured_relation'
        ? await this.queryFranchiseNamesByApp(resolvedSourceAppid)
        : [];

    return {
      items: relatedLookup.items.map((item) => this.mapRelatedEntityItem(item)),
      matchMode: relatedLookup.matchMode,
      provenance: buildProvenance(this.config.source, relatedLookup.tables),
      relationKind,
      source: {
        appid: resolvedSourceAppid,
        displayName: sourceOverview.display_name,
        entityUid: buildEntityUid('steam', 'game', String(resolvedSourceAppid)),
        ...(sourceFranchiseNames.length > 0 ? { franchiseNames: sourceFranchiseNames } : {}),
        reviewScore: sourceOverview.review_score,
        steamDeckCategory: sourceSteamDeckCategory,
        totalReviews: sourceOverview.total_reviews,
      },
      sufficientToAnswer: relatedLookup.items.length > 0,
      ...(relatedLookup.unresolvedAppids?.length
        ? {
            unresolvedAppids: relatedLookup.unresolvedAppids,
            unresolvedCount: relatedLookup.unresolvedAppids.length,
          }
        : {}),
    };
  }

  async searchCatalog(request: SearchCatalogRequest): Promise<SearchCatalogResponse> {
    await this.assertContractRuntime('searchCatalog');
    await this.assertTigerSearchFiltersSupported(request);

    const limit = normalizeLimit(request.limit, DEFAULT_CATALOG_LIMIT, MAX_CATALOG_LIMIT);
    const { offset } = decodeContinuationToken(request.continuationToken);
    const sortBy = request.sortBy ?? 'relevance';
    const sortDirection = request.sortDirection ?? 'desc';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const publishersTable = this.relation('publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const developersTable = this.relation('developers').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const steamCategoriesTable = this.relation('steam_categories').sql;
    const facets = await this.lookupCatalogFacets(request);
    const shouldQueryItems = this.shouldQueryCatalogItems(request);

    let continuationToken: string | null = null;
    let items: SearchCatalogItem[] = [];

    if (shouldQueryItems) {
      const params: unknown[] = [];
      const conditions: string[] = [
        "a.is_delisted = false",
      ];

      if (request.includeAppTypes?.length) {
        params.push(request.includeAppTypes);
        conditions.push(`a.type::text = ANY($${params.length}::text[])`);
      } else {
        conditions.push(GAME_TYPE_PREDICATE[this.config.source]);
      }

      if (request.appids?.length) {
        params.push(request.appids);
        conditions.push(`a.appid = ANY($${params.length}::int[])`);
      }

      if (request.parentAppids?.length) {
        params.push(request.parentAppids);
        conditions.push(`a.parent_appid = ANY($${params.length}::int[])`);
      }

      if (request.query?.trim()) {
        params.push(normalizeLikeValue(request.query));
        conditions.push(`lower(a.name) LIKE $${params.length}`);
      }

      if (request.publisherQuery?.trim()) {
        params.push(normalizeLikeValue(request.publisherQuery));
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appPublishersTable} ap
            JOIN ${publishersTable} p ON p.id = ap.publisher_id
            WHERE ap.appid = a.appid
              AND lower(p.name) LIKE $${params.length}
          )`
        );
      }

      if (request.publisherIds?.length) {
        params.push(request.publisherIds);
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
              AND ap.publisher_id = ANY($${params.length}::int[])
          )`
        );
      }

      if (request.developerQuery?.trim()) {
        params.push(normalizeLikeValue(request.developerQuery));
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appDevelopersTable} ad
            JOIN ${developersTable} d ON d.id = ad.developer_id
            WHERE ad.appid = a.appid
              AND lower(d.name) LIKE $${params.length}
          )`
        );
      }

      if (request.developerIds?.length) {
        params.push(request.developerIds);
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
              AND ad.developer_id = ANY($${params.length}::int[])
          )`
        );
      }

      if (typeof request.isFree === 'boolean') {
        params.push(request.isFree);
        conditions.push(`a.is_free = $${params.length}`);
      }

      if (typeof request.isReleased === 'boolean') {
        params.push(request.isReleased);
        conditions.push(`a.is_released = $${params.length}`);
      }

      if (request.releaseYear?.gte) {
        params.push(request.releaseYear.gte);
        conditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${params.length}`);
      }

      if (request.releaseYear?.lte) {
        params.push(request.releaseYear.lte);
        conditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${params.length}`);
      }

      if (typeof request.minReviews === 'number') {
        params.push(request.minReviews);
        conditions.push(`COALESCE(ldm.total_reviews, 0) >= $${params.length}`);
      }

      if (typeof request.minReviewScore === 'number') {
        params.push(request.minReviewScore);
        conditions.push(`${reviewPercentageSql('ldm')} >= $${params.length}`);
      }

      if (typeof request.minPriceCents === 'number') {
        params.push(request.minPriceCents);
        conditions.push(`COALESCE(a.current_price_cents, 0) >= $${params.length}`);
      }

      if (typeof request.maxPriceCents === 'number') {
        params.push(request.maxPriceCents);
        conditions.push(`COALESCE(a.current_price_cents, 0) <= $${params.length}`);
      }

      if (typeof request.onSale === 'boolean') {
        conditions.push(
          request.onSale
            ? `COALESCE(a.current_discount_percent, 0) > 0`
            : `COALESCE(a.current_discount_percent, 0) = 0`
        );
      }

      if (typeof request.minDiscountPercent === 'number') {
        params.push(request.minDiscountPercent);
        conditions.push(`COALESCE(a.current_discount_percent, 0) >= $${params.length}`);
      }

      if (typeof request.minOwners === 'number') {
        params.push(request.minOwners);
        conditions.push(`COALESCE(ldm.owners_midpoint, 0) >= $${params.length}`);
      }

      if (typeof request.minCcu === 'number') {
        params.push(request.minCcu);
        conditions.push(`COALESCE(ldm.ccu_peak, 0) >= $${params.length}`);
      }

      if (request.platforms?.length) {
        for (const platform of request.platforms) {
          params.push(`%${platform.toLowerCase()}%`);
          conditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${params.length}`);
        }
      }

      if (request.genres?.length) {
        params.push(request.genres.map((genre) => genre.toLowerCase()));
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appGenresTable} ag
            JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
            WHERE ag.appid = a.appid
              AND lower(sg.name) = ANY($${params.length}::text[])
          )`
        );
      }

      if (request.tags?.length) {
        params.push(request.tags.map((tag) => tag.toLowerCase()));
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM ${appSteamTagsTable} ast
            JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
            WHERE ast.appid = a.appid
              AND lower(st.name) = ANY($${params.length}::text[])
          )`
        );
      }

      const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';

      let orderClause = `COALESCE(ldm.total_reviews, 0) DESC, a.name ASC`;
      if (sortBy === 'reviews') {
        orderClause = `COALESCE(ldm.total_reviews, 0) ${direction}, a.name ASC`;
      } else if (sortBy === 'owners') {
        orderClause = `COALESCE(ldm.owners_midpoint, 0) ${direction}, a.name ASC`;
      } else if (sortBy === 'release_date') {
        orderClause = `a.release_date ${direction} NULLS LAST, a.name ASC`;
      } else if (sortBy === 'ccu_peak') {
        orderClause = `COALESCE(ldm.ccu_peak, 0) ${direction}, a.name ASC`;
      } else if (request.query?.trim()) {
        params.push(request.query.trim().toLowerCase());
        params.push(`${request.query.trim().toLowerCase()}%`);
        params.push(normalizeLikeValue(request.query));
        orderClause = `CASE
            WHEN lower(a.name) = $${params.length - 2} THEN 3
            WHEN lower(a.name) LIKE $${params.length - 1} THEN 2
            WHEN lower(a.name) LIKE $${params.length} THEN 1
            ELSE 0
          END DESC,
          COALESCE(ldm.total_reviews, 0) DESC,
          a.name ASC`;
      }

      params.push(limit + 1);
      params.push(offset);

      const sql = `
        SELECT
          a.appid,
          a.type::text AS app_type,
          a.name,
          a.is_free,
          a.is_released,
          a.release_state,
          a.parent_appid,
          a.current_price_cents AS price_cents,
          a.current_discount_percent AS discount_percent,
          a.platforms,
          a.release_date::text,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.total_reviews,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.owners_midpoint,
          ldm.ccu_peak,
          COALESCE((
            SELECT array_agg(DISTINCT ap.publisher_id ORDER BY ap.publisher_id)
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
          ), ARRAY[]::int[]) AS publisher_ids,
          COALESCE((
            SELECT array_agg(DISTINCT p.name ORDER BY p.name)
            FROM ${appPublishersTable} ap
            JOIN ${publishersTable} p ON p.id = ap.publisher_id
            WHERE ap.appid = a.appid
          ), ARRAY[]::text[]) AS publishers,
          COALESCE((
            SELECT array_agg(DISTINCT ad.developer_id ORDER BY ad.developer_id)
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
          ), ARRAY[]::int[]) AS developer_ids,
          COALESCE((
            SELECT array_agg(DISTINCT d.name ORDER BY d.name)
            FROM ${appDevelopersTable} ad
            JOIN ${developersTable} d ON d.id = ad.developer_id
            WHERE ad.appid = a.appid
          ), ARRAY[]::text[]) AS developers
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE ${conditions.join('\n        AND ')}
        ORDER BY ${orderClause}
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `;

      const result = await runQuery<CatalogRow>(sql, params, this.config);
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      continuationToken = hasMore
        ? encodeContinuationToken({ offset: offset + pageRows.length })
        : null;
      items = pageRows.map((row) => ({
        appType: row.app_type,
        appid: row.appid,
        ccuPeak: row.ccu_peak,
        developerIds: row.developer_ids ?? [],
        developers: row.developers ?? [],
        discountPercent: row.discount_percent,
        entityUid: buildEntityUid('steam', 'game', String(row.appid)),
        isFree: row.is_free,
        isReleased: row.is_released,
        name: row.name,
        ownersMidpoint: row.owners_midpoint,
        parentAppid: row.parent_appid,
        platforms: row.platforms
          ? row.platforms.split(',').map((platform) => platform.trim()).filter(Boolean)
          : [],
        priceCents: row.price_cents,
        publisherIds: row.publisher_ids ?? [],
        publishers: row.publishers ?? [],
        releaseDate: row.release_date,
        releaseState: row.release_state,
        releaseYear: row.release_year,
        reviewScore: row.review_score,
        totalReviews: row.total_reviews,
      }));
    }

    return {
      continuationToken,
      facets,
      interpretedFilters: {
        appids: request.appids ?? [],
        developerIds: request.developerIds ?? [],
        developerQuery: request.developerQuery?.trim() ?? null,
        facetQuery: request.facetQuery?.trim() ?? null,
        genres: request.genres ?? [],
        includeFacets: request.includeFacets ?? [],
        includeAppTypes: request.includeAppTypes ?? [],
        isFree: request.isFree ?? null,
        isReleased: request.isReleased ?? null,
        minCcu: request.minCcu ?? null,
        minDiscountPercent: request.minDiscountPercent ?? null,
        minPriceCents: request.minPriceCents ?? null,
        minOwners: request.minOwners ?? null,
        minReviewScore: request.minReviewScore ?? null,
        minReviews: request.minReviews ?? null,
        onSale: request.onSale ?? null,
        parentAppids: request.parentAppids ?? [],
        platforms: request.platforms ?? [],
        publisherIds: request.publisherIds ?? [],
        publisherQuery: request.publisherQuery?.trim() ?? null,
        query: request.query?.trim() ?? null,
        releaseYear: request.releaseYear
          ? {
              gte: request.releaseYear.gte ?? null,
              lte: request.releaseYear.lte ?? null,
            }
          : null,
        sortBy,
        sortDirection,
        tags: request.tags ?? [],
        maxPriceCents: request.maxPriceCents ?? null,
      },
      items,
      provenance: buildProvenance(this.config.source, [
        appsTable,
        latestDailyMetricsTable,
        appPublishersTable,
        publishersTable,
        appDevelopersTable,
        developersTable,
        appGenresTable,
        steamGenresTable,
        appSteamTagsTable,
        steamTagsTable,
        steamCategoriesTable,
      ]),
      sufficientToAnswer:
        items.length > 0
        || Boolean(facets && (facets.tags.length || facets.genres.length || facets.categories.length)),
    };
  }

  async discoverMomentum(
    request: DiscoverMomentumRequest
  ): Promise<DiscoverMomentumResponse> {
    await this.assertContractRuntime('discoverMomentum');
    await this.assertTigerMomentumFiltersSupported(request);

    const limit = normalizeLimit(request.limit, DEFAULT_MOMENTUM_LIMIT, MAX_MOMENTUM_LIMIT);
    const timeframe = this.normalizeMomentumTimeframe(request.timeframe, request.sortBy, request.trendType);
    const excludedAppIds = new Set(
      (request.excludeAppIds ?? []).filter(
        (appid): appid is number => Number.isInteger(appid) && appid > 0
      )
    );
    const candidateLimitBase = Math.min(limit + excludedAppIds.size, 200);
    const candidateLimit = candidateLimitBase;
    const rows = await this.queryMomentumRows({
      appids: request.appids ?? null,
      filters: request.filters ?? null,
      indieHeuristic: request.indieHeuristic ?? false,
      limit: candidateLimit,
      sortBy: request.sortBy,
      sortDirection: request.sortDirection ?? 'desc',
      timeframe,
      trendType: request.trendType ?? null,
    });
    const uniqueRows = excludedAppIds.size > 0
      ? rows.filter((row) => !excludedAppIds.has(row.appid))
      : rows;
    const pageRows = uniqueRows.slice(0, limit);
    const ccuSparklines =
      timeframe === 'current' && pageRows.length > 0
        ? await this.queryMomentumSparklineData(pageRows.map((row) => row.appid), 10)
        : new Map<number, number[]>();

    return {
      filtersApplied: this.buildMomentumFiltersApplied(request, timeframe),
      items: pageRows.map((row) => this.mapMomentumItem(row, {
        sortBy: request.sortBy,
        timeframe,
        trendType: request.trendType ?? null,
      }, ccuSparklines.get(row.appid) ?? null)),
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('latest_daily_metrics').sql,
        this.relation('metrics_daily_metrics').sql,
        this.relation('app_publishers').sql,
        this.relation('publishers').sql,
        this.relation('app_developers').sql,
        this.relation('developers').sql,
        this.relation('app_genres').sql,
        this.relation('steam_genres').sql,
        this.relation('app_steam_tags').sql,
        this.relation('steam_tags').sql,
        ...(request.filters?.steamDeck?.length ? [this.relation('app_steam_deck').sql] : []),
      ]),
      rankingDefinition: this.describeMomentumRanking(request.sortBy, timeframe, request.trendType ?? null),
      rankingLabel: this.labelMomentumRanking(request.sortBy),
      sortBy: request.sortBy,
      sortDirection: request.sortDirection ?? 'desc',
      sufficientToAnswer: pageRows.length > 0,
      timeframe,
      timeframeLabel: this.labelMomentumTimeframe(timeframe),
      trendType: request.trendType ?? null,
    };
  }

  async rankEntities(request: RankEntitiesRequest): Promise<RankEntitiesResponse> {
    await this.assertContractRuntime('rankEntities');

    const limit = normalizeLimit(request.limit, DEFAULT_RANK_LIMIT, MAX_RANK_LIMIT);
    const direction = request.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const entityKind = request.entityKind;
    const metric = request.metric;
    const query = request.query?.trim() ?? '';

    if (entityKind === 'game' && metric === 'game_count') {
      throw new PublisherIQError(
        'game_count rankings are only valid for publisher or developer entities.',
        'INVALID_RANK_METRIC',
        { entityKind, metric }
      );
    }

    const rows =
      entityKind === 'game'
        ? await this.queryRankedGames(
            metric as Exclude<RankMetric, 'game_count'>,
            query,
            limit,
            direction
          )
        : await this.queryRankedCompanies(entityKind, request, limit, direction);

    return {
      entityKind,
      items: rows.map((row, index) => this.mapRankedEntity(entityKind, metric, row, index + 1)),
      metric,
      provenance: buildProvenance(
        this.config.source,
        entityKind === 'game'
          ? [this.relation('apps').sql, this.relation('latest_daily_metrics').sql]
          : [
              this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql,
              this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql,
              this.relation('apps').sql,
              this.relation('latest_daily_metrics').sql,
            ]
      ),
      sufficientToAnswer: rows.length > 0,
    };
  }

  async queryMonthlyPlaytime(
    request: QueryMonthlyPlaytimeRequest
  ): Promise<QueryMonthlyPlaytimeResponse> {
    await this.assertContractRuntime('queryMonthlyPlaytime');

    if (request.entityKind !== 'game' && request.entityKind !== 'publisher') {
      throw new PublisherIQError(
        'queryMonthlyPlaytime supports only game and publisher entity kinds.',
        'INVALID_MONTHLY_PLAYTIME_ENTITY_KIND',
        { entityKind: request.entityKind }
      );
    }

    const limit = normalizeLimit(
      request.limit,
      DEFAULT_MONTHLY_PLAYTIME_LIMIT,
      MAX_MONTHLY_PLAYTIME_LIMIT
    );
    const { endMonth, startMonth } = this.normalizeMonthlyPlaytimeWindow(
      request.startMonth ?? null,
      request.endMonth ?? null
    );
    const rows = await this.queryMonthlyPlaytimeRows(request, startMonth, endMonth, limit);

    return {
      endMonth,
      entityKind: request.entityKind,
      items: rows.map((row, index) => ({
        entityId: row.entity_id,
        entityKind: request.entityKind,
        estimatedMonthlyHours: row.estimated_monthly_hours,
        gameCount: row.game_count ?? null,
        month: row.month,
        monthNum: row.month_num,
        monthlyCcuSum: row.monthly_ccu_sum ?? null,
        name: row.name,
        rank: index + 1,
        year: row.year,
      })),
      provenance: buildProvenance(this.config.source, [
        this.relation(
          request.entityKind === 'game'
            ? 'metrics_monthly_game_metrics'
            : 'metrics_monthly_publisher_metrics'
        ).sql,
      ]),
      startMonth,
      sufficientToAnswer: rows.length > 0,
    };
  }

  async compareEntities(
    request: CompareEntitiesRequest
  ): Promise<CompareEntitiesResponse> {
    await this.assertContractRuntime('compareEntities');

    const requestedEntityUids = [...new Set(
      request.entityUids
        .map((entityUid) => entityUid.trim())
        .filter((entityUid) => entityUid.length > 0)
    )];

    if (requestedEntityUids.length < 2 || requestedEntityUids.length > MAX_COMPARE_ENTITY_COUNT) {
      throw new PublisherIQError(
        `compareEntities requires between 2 and ${MAX_COMPARE_ENTITY_COUNT} unique entityUids.`,
        'INVALID_COMPARE_ENTITY_COUNT',
        { entityUids: requestedEntityUids }
      );
    }

    const entities = await Promise.all(
      requestedEntityUids.map((entityUid) =>
        this.resolveCoreEntity(entityUid, {
          invalidCode: 'INVALID_COMPARE_ENTITY_UID',
          notFoundCode: 'COMPARE_ENTITY_NOT_FOUND',
        })
      )
    );

    const firstEntity = entities[0]!;
    if (
      entities.some(
        (entity) =>
          entity.entity_kind !== firstEntity.entity_kind || entity.platform !== firstEntity.platform
      )
    ) {
      throw new PublisherIQError(
        'compareEntities currently requires all entities to share the same kind and platform.',
        'INVALID_COMPARE_ENTITY_MIX',
        {
          entityKinds: [...new Set(entities.map((entity) => entity.entity_kind))],
          platforms: [...new Set(entities.map((entity) => entity.platform))],
        }
      );
    }

    const entityKind = firstEntity.entity_kind;
    const metrics = this.normalizeCompareMetrics(request.metrics, entityKind);
    const entityIds = entities.map((entity) => Number(entity.platform_entity_id));

    if (entityIds.some((entityId) => !Number.isInteger(entityId) || entityId <= 0)) {
      throw new PublisherIQError(
        'One or more compare entities did not resolve to a valid platform entity id.',
        'INVALID_COMPARE_ENTITY_ID',
        {
          entityUids: requestedEntityUids,
          platformEntityIds: entities.map((entity) => entity.platform_entity_id),
        }
      );
    }

    const rowsById =
      entityKind === 'game'
        ? await this.queryComparedGames(entityIds as number[])
        : await this.queryComparedCompanies(entityKind, entityIds as number[]);

    const items = entities.map((entity) => {
      const entityId = Number(entity.platform_entity_id);
      const row = rowsById.get(entityId);

      return this.mapComparedEntity(entity, row ?? null);
    });

    const highlights = this.buildCompareHighlights(metrics, items);

    return {
      entityKind,
      highlights,
      items,
      metrics,
      platform: firstEntity.platform,
      provenance: buildProvenance(
        this.config.source,
        entityKind === 'game'
          ? [this.relation('core_entities').sql, this.relation('apps').sql, this.relation('latest_daily_metrics').sql]
          : [
              this.relation('core_entities').sql,
              this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql,
              this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql,
              this.relation('apps').sql,
              this.relation('latest_daily_metrics').sql,
            ]
      ),
      sufficientToAnswer: items.length >= 2,
    };
  }

  async traceMetricHistory(
    request: TraceMetricHistoryRequest
  ): Promise<TraceMetricHistoryResponse> {
    await this.assertContractRuntime('traceMetricHistory');

    const metrics = this.normalizeTraceMetrics(request.metrics);
    const { endDate, startDate } = this.normalizeTraceDateWindow(
      request.startDate ?? null,
      request.endDate ?? null
    );
    const entity = await this.resolveCoreEntity(request.entityUid, {
      invalidCode: 'INVALID_TRACE_ENTITY_UID',
      notFoundCode: 'TRACE_ENTITY_NOT_FOUND',
    });

    if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
      throw new PublisherIQError(
        'traceMetricHistory currently supports only Steam game entities.',
        'INVALID_TRACE_ENTITY_KIND',
        {
          entityKind: entity.entity_kind,
          entityUid: request.entityUid,
          platform: entity.platform,
        }
      );
    }

    const appid = Number(entity.platform_entity_id);
    if (!Number.isInteger(appid) || appid <= 0) {
      throw new PublisherIQError(
        'Resolved game entity does not have a valid Steam appid.',
        'INVALID_TRACE_ENTITY_ID',
        {
          entityUid: request.entityUid,
          platformEntityId: entity.platform_entity_id,
        }
      );
    }

    const rows = await this.queryMetricHistoryRows(appid, startDate, endDate);
    const series = metrics.map((metric) => this.buildTraceSeries(metric, rows));

    return {
      endDate,
      entity: {
        displayName: entity.canonical_name,
        entityKind: entity.entity_kind,
        entityUid: entity.entity_uid,
        platform: entity.platform,
        platformEntityId: entity.platform_entity_id,
      },
      metrics,
      provenance: buildProvenance(this.config.source, [
        this.relation('core_entities').sql,
        this.relation('metrics_daily_metrics').sql,
      ]),
      series,
      startDate,
      sufficientToAnswer: series.some((item) => item.summary.pointCount > 0),
    };
  }

  async explainChanges(request: ExplainChangesRequest): Promise<ExplainChangesResponse> {
    await this.assertContractRuntime('explainChanges');

    const mode = request.mode ?? 'timeline';
    const limit = normalizeLimit(
      request.limit,
      DEFAULT_EXPLAIN_CHANGES_LIMIT,
      MAX_EXPLAIN_CHANGES_LIMIT
    );
    const includeNews = request.includeNews ?? true;
    const sources = this.normalizeExplainFilters(request.sources);
    const changeTypes = this.normalizeExplainFilters(request.changeTypes);
    const activityId = request.activityId?.trim() || null;

    let startTime: string;
    let endTime: string;
    let entity: CoreEntityRow;

    if (activityId) {
      const burstDetail = await this.queryChangeBurstDetail(activityId);
      if (!burstDetail) {
        throw new PublisherIQError(
          'explainChanges could not resolve the requested change activity.',
          'EXPLAIN_ACTIVITY_NOT_FOUND',
          {
            activityId,
          }
        );
      }

      startTime = formatTimestamp(parseTimestamp(burstDetail.burst_started_at));
      endTime = formatTimestamp(parseTimestamp(burstDetail.burst_ended_at));
      entity = await this.resolveCoreEntity(
        request.entityUid?.trim() || buildEntityUid('steam', 'game', String(burstDetail.appid)),
        {
          invalidCode: 'INVALID_EXPLAIN_ENTITY_UID',
          notFoundCode: 'EXPLAIN_ENTITY_NOT_FOUND',
        }
      );
    } else {
      if (!request.entityUid?.trim()) {
        throw new PublisherIQError(
          'explainChanges requires either an entityUid or an activityId.',
          'INVALID_EXPLAIN_INPUT'
        );
      }

      const normalizedWindow = this.normalizeExplainTimeWindow(
        request.startTime ?? null,
        request.endTime ?? null
      );
      startTime = normalizedWindow.startTime;
      endTime = normalizedWindow.endTime;
      entity = await this.resolveCoreEntity(request.entityUid.trim(), {
        invalidCode: 'INVALID_EXPLAIN_ENTITY_UID',
        notFoundCode: 'EXPLAIN_ENTITY_NOT_FOUND',
      });
    }

    if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
      throw new PublisherIQError(
        'explainChanges currently supports only Steam game entities.',
        'INVALID_EXPLAIN_ENTITY_KIND',
        {
          entityKind: entity.entity_kind,
          entityUid: request.entityUid,
          platform: entity.platform,
        }
      );
    }

    const appid = Number(entity.platform_entity_id);
    if (!Number.isInteger(appid) || appid <= 0) {
      throw new PublisherIQError(
        'Resolved game entity does not have a valid Steam appid.',
        'INVALID_EXPLAIN_ENTITY_ID',
        {
          entityUid: request.entityUid,
          platformEntityId: entity.platform_entity_id,
        }
      );
    }

    const events = await this.queryChangeEvents(appid, startTime, endTime, sources, changeTypes);
    const moments = this.buildExplainMoments(events, limit);

    if (includeNews && moments.length > 0) {
      await this.attachExplainNews(appid, moments);
    }

    const responseMoments: ExplainChangesMoment[] = moments.map((moment) => ({
      ...this.buildExplainMomentMetadata(moment),
      changeTypes: [...new Set(moment.events.map((event) => event.change_type))].sort(),
      eventCount: moment.events.length,
      events: [...moment.events]
        .sort(
          (left, right) =>
            parseTimestamp(left.occurred_at).getTime() - parseTimestamp(right.occurred_at).getTime() ||
            left.id.localeCompare(right.id)
        )
        .map((event) => ({
          afterValue: event.after_value,
          beforeValue: event.before_value,
          changeType: event.change_type,
          context: event.context,
          id: event.id,
          newsItemGid: event.news_item_gid,
          occurredAt: formatTimestamp(parseTimestamp(event.occurred_at)),
          source: event.source,
        })),
      linkedNews: [...moment.linkedNews].sort(
        (left, right) => parseTimestamp(right.sortTime).getTime() - parseTimestamp(left.sortTime).getTime()
      ),
      sources: [...new Set(moment.events.map((event) => event.source))].sort(),
      windowEnd: formatTimestamp(moment.windowEnd),
      windowStart: formatTimestamp(moment.windowStart),
    }));

    const responseEvents = responseMoments.flatMap((moment) => moment.events);
    const responseNews = responseMoments.flatMap((moment) => moment.linkedNews);
    const strongestMoment = this.pickStrongestExplainMoment(responseMoments);
    const selectedMoment = mode === 'before_after' ? strongestMoment : null;
    const comparisonWindows = selectedMoment
      ? await this.buildExplainComparisonWindows(
          appid,
          parseTimestamp(selectedMoment.windowStart),
          parseTimestamp(selectedMoment.windowEnd)
        )
      : null;

    return {
      comparisonWindows,
      entity: {
        displayName: entity.canonical_name,
        entityKind: entity.entity_kind,
        entityUid: entity.entity_uid,
        platform: entity.platform,
        platformEntityId: entity.platform_entity_id,
      },
      mode,
      moments: responseMoments,
      provenance: buildProvenance(
        this.config.source,
        includeNews
          ? [
              this.relation('core_entities').sql,
              this.relation('events_app_change_events').sql,
              this.relation('docs_steam_news_items').sql,
              this.relation('docs_steam_news_search_projection').sql,
            ]
          : [this.relation('core_entities').sql, this.relation('events_app_change_events').sql]
      ),
      selectedMoment,
      sufficientToAnswer: true,
      summary: {
        countsByChangeType: countBy(responseEvents.map((event) => event.changeType)),
        countsBySource: countBy(responseEvents.map((event) => event.source)),
        eventCount: responseEvents.length,
        momentCount: responseMoments.length,
        newsCount: responseNews.length,
        strongestMomentReasons: strongestMoment?.significanceReasons ?? [],
        strongestMomentStart: strongestMoment?.windowStart ?? null,
        strongestMomentStrength: strongestMoment?.burstStrength ?? null,
      },
      timeWindow: {
        endTime,
        startTime,
      },
    };
  }

  async searchChangeActivity(
    request: SearchChangeActivityRequest
  ): Promise<SearchChangeActivityResponse> {
    await this.assertContractRuntime('searchChangeActivity');

    const days = Math.max(
      1,
      Math.min(MAX_CHANGE_ACTIVITY_DAYS, Math.floor(request.days ?? DEFAULT_CHANGE_ACTIVITY_DAYS))
    );
    const limit = normalizeLimit(
      request.limit,
      DEFAULT_CHANGE_ACTIVITY_LIMIT,
      MAX_CHANGE_ACTIVITY_LIMIT
    );
    const appTypes = this.normalizeExplainFilters(request.appTypes);
    const appids = normalizePositiveIntegers(request.appids);
    const allHistory = request.allHistory === true && appids.length > 0;
    const signalFamilies = normalizeChangeSignalFamilies(request.signalFamilies);
    const sort = request.sort ?? 'relevant';
    const view = request.view ?? 'overview';
    const mode = request.mode ?? 'all';
    const query = request.query?.trim() || null;
    const offset = decodeContinuationToken(request.continuationToken).offset;
    const requestedCount = offset + limit + 1;
    const excludedActivityIds = new Set(
      (request.excludeActivityIds ?? []).filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    );

    const rows = await this.querySearchChangeActivityRows({
      allHistory,
      appids,
      appTypes,
      days,
      query,
      signalFamilies,
      view,
    });

    const filteredRows = rows.filter((row) => {
      const item = this.mapSearchChangeActivityItem(row);
      if (excludedActivityIds.has(item.activityId)) {
        return false;
      }

      if (mode === 'changes') {
        return item.activityKind === 'change';
      }

      if (mode === 'announcements') {
        return item.relatedAnnouncementCount > 0;
      }

      return true;
    });

    const sortedRows = filteredRows.sort((left, right) =>
      this.compareSearchChangeRows(left, right, sort)
    );
    const pageRows = sortedRows.slice(offset, requestedCount);
    const items = pageRows.slice(0, limit).map((row) => this.mapSearchChangeActivityItem(row));

    return {
      continuationToken:
        pageRows.length > limit
          ? encodeContinuationToken({ offset: offset + limit })
          : null,
      interpretedFilters: {
        allHistory,
        appids,
        appTypes,
        days,
        mode,
        query,
        signalFamilies,
        sort,
        view,
      },
      items,
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('events_app_change_events').sql,
        this.relation('docs_steam_news_items').sql,
        this.relation('docs_steam_news_search_projection').sql,
      ]),
      sufficientToAnswer: items.length > 0,
    };
  }

  async getChangeActivityDetail(
    request: GetChangeActivityDetailRequest
  ): Promise<GetChangeActivityDetailResponse> {
    await this.assertContractRuntime('searchChangeActivity');

    const activityId = request.activityId?.trim();
    if (!activityId) {
      throw new PublisherIQError(
        'getChangeActivityDetail requires an activityId.',
        'INVALID_CHANGE_ACTIVITY_DETAIL_INPUT'
      );
    }

    const [detailRow, activityRows] = await Promise.all([
      this.queryChangeBurstDetail(activityId),
      this.querySearchChangeActivityRows({
        activityId,
        allHistory: false,
        appids: [],
        appTypes: [],
        days: DEFAULT_CHANGE_ACTIVITY_DAYS,
        query: null,
        signalFamilies: [],
        view: 'all-activity',
      }),
    ]);

    const activityRow = activityRows[0] ?? null;
    const activity = activityRow ? this.mapSearchChangeActivityItem(activityRow) : null;
    const item =
      detailRow && activity
        ? {
            activity,
            events: (detailRow.events ?? []).map((event) => ({
              afterValue: event.after_value ?? null,
              appid: event.appid ?? detailRow.appid,
              beforeValue: event.before_value ?? null,
              changeType: event.change_type ?? 'unknown',
              context:
                event.context && typeof event.context === 'object' && !Array.isArray(event.context)
                  ? (event.context as Record<string, unknown>)
                  : null,
              eventId: event.event_id ?? '',
              newsItemGid: event.news_item_gid ?? null,
              occurredAt: event.occurred_at
                ? formatTimestamp(parseTimestamp(event.occurred_at))
                : detailRow.effective_at,
              source: event.source ?? 'unknown',
            })),
            impact: detailRow.impact,
            relatedNews: (detailRow.related_news ?? [])
              .filter((row) => typeof row.gid === 'string' && row.gid.length > 0)
              .map((row) => ({
                appid: row.appid ?? detailRow.appid,
                appName: row.app_name ?? detailRow.app_name,
                appType: row.app_type ?? detailRow.app_type,
                feedLabel: row.feedlabel ?? null,
                feedName: row.feedname ?? null,
                firstSeenAt: row.first_seen_at
                  ? formatTimestamp(parseTimestamp(row.first_seen_at))
                  : null,
                gid: row.gid!,
                publishedAt: row.published_at
                  ? formatTimestamp(parseTimestamp(row.published_at))
                  : null,
                title: row.title ?? null,
                url: row.url ?? null,
              })),
          }
        : null;

    return {
      item,
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('events_app_change_events').sql,
        this.relation('docs_steam_news_items').sql,
        this.relation('docs_steam_news_search_projection').sql,
      ]),
      sufficientToAnswer: item !== null,
    };
  }

  async getChangeFeedStatus(
    _request: GetChangeFeedStatusRequest = {}
  ): Promise<GetChangeFeedStatusResponse> {
    await this.assertContractRuntime('getChangeFeedStatus');

    const workStateTable = this.relation('ops_app_capture_work_state').sql;
    const activityBurstsTable = this.relation('events_change_activity_bursts').sql;
    const eventsTable = this.relation('events_app_change_events').sql;

    const [
      queuedJobsResult,
      oldestQueuedResult,
      latestStorefrontResult,
      latestNewsResult,
      projectionQueuedJobsResult,
      oldestProjectionQueuedResult,
      latestProjectionRefreshResult,
    ] = await Promise.all([
      runQuery<ChangeFeedStatusCountRow>(
        `
          SELECT count(*)::text AS count
          FROM ${workStateTable}
          WHERE dirty_since IS NOT NULL
            AND dead_lettered_at IS NULL
            AND source::text = ANY($1::text[])
        `,
        [['storefront', 'news']],
        this.config
      ),
      runQuery<ChangeFeedStatusTimestampRow>(
        `
          SELECT min(dirty_since)::text AS value
          FROM ${workStateTable}
          WHERE dirty_since IS NOT NULL
            AND dead_lettered_at IS NULL
            AND source::text = ANY($1::text[])
        `,
        [['storefront', 'news']],
        this.config
      ),
      runQuery<ChangeFeedStatusTimestampRow>(
        `
          SELECT max(occurred_at)::text AS value
          FROM ${eventsTable}
          WHERE source::text = $1::text
        `,
        ['storefront'],
        this.config
      ),
      runQuery<ChangeFeedStatusTimestampRow>(
        `
          SELECT max(occurred_at)::text AS value
          FROM ${eventsTable}
          WHERE source::text = $1::text
        `,
        ['news'],
        this.config
      ),
      runQuery<ChangeFeedStatusCountRow>(
        `
          SELECT count(*)::text AS count
          FROM ${workStateTable}
          WHERE dirty_since IS NOT NULL
            AND dead_lettered_at IS NULL
            AND source::text = $1::text
        `,
        ['projection_refresh'],
        this.config
      ),
      runQuery<ChangeFeedStatusTimestampRow>(
        `
          SELECT min(dirty_since)::text AS value
          FROM ${workStateTable}
          WHERE dirty_since IS NOT NULL
            AND dead_lettered_at IS NULL
            AND source::text = $1::text
        `,
        ['projection_refresh'],
        this.config
      ),
      runQuery<ChangeFeedStatusTimestampRow>(
        `
          SELECT max(updated_at)::text AS value
          FROM ${activityBurstsTable}
        `,
        [],
        this.config
      ),
    ]);

    return {
      latestNewsEventAt: latestNewsResult.rows[0]?.value ?? null,
      latestProjectionRefreshAt: latestProjectionRefreshResult.rows[0]?.value ?? null,
      latestStorefrontEventAt: latestStorefrontResult.rows[0]?.value ?? null,
      oldestProjectionQueuedAt: oldestProjectionQueuedResult.rows[0]?.value ?? null,
      oldestQueuedAt: oldestQueuedResult.rows[0]?.value ?? null,
      projectionQueuedJobs: parseCountValue(projectionQueuedJobsResult.rows[0]?.count),
      provenance: buildProvenance(this.config.source, [
        workStateTable,
        eventsTable,
        activityBurstsTable,
      ]),
      queuedJobs: parseCountValue(queuedJobsResult.rows[0]?.count),
    };
  }

  async discoverChangePatterns(
    request: DiscoverChangePatternsRequest
  ): Promise<DiscoverChangePatternsResponse> {
    await this.assertContractRuntime('discoverChangePatterns');

    const days = Math.max(
      1,
      Math.min(MAX_CHANGE_ACTIVITY_DAYS, Math.floor(request.days ?? DEFAULT_CHANGE_ACTIVITY_DAYS))
    );
    const limit = normalizeLimit(
      request.limit,
      DEFAULT_CHANGE_PATTERN_LIMIT,
      MAX_CHANGE_PATTERN_LIMIT
    );
    const appTypes = this.normalizeExplainFilters(request.appTypes);
    const query = request.query?.trim() || null;
    const offset = decodeContinuationToken(request.continuationToken).offset;
    const requestedCount = offset + limit + 1;
    const excludedAppIds = new Set(
      (request.excludeAppIds ?? []).filter(
        (value): value is number => Number.isInteger(value) && value > 0
      )
    );

    const candidates = await this.queryChangePatternCandidateRows({
      appTypes,
      days,
      pattern: request.pattern,
      query,
    });
    const filteredCandidates = candidates.filter((candidate) => !excludedAppIds.has(candidate.appid));
    const items = await this.mapDiscoverChangePatternItems(
      filteredCandidates,
      request.pattern
    );
    const sortedItems = items.sort((left, right) =>
      this.compareDiscoverChangePatternItems(left, right)
    );
    const pageItems = sortedItems.slice(offset, requestedCount);

    return {
      continuationToken:
        pageItems.length > limit
          ? encodeContinuationToken({ offset: offset + limit })
          : null,
      interpretedFilters: {
        appTypes,
        days,
        pattern: request.pattern,
        query,
      },
      items: pageItems.slice(0, limit),
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('latest_daily_metrics').sql,
        this.relation('metrics_daily_metrics').sql,
        this.relation('events_app_change_events').sql,
        this.relation('docs_steam_news_items').sql,
        this.relation('docs_steam_news_search_projection').sql,
      ]),
      sufficientToAnswer: pageItems.length > 0,
    };
  }

  async searchDocuments(
    request: SearchDocumentsRequest
  ): Promise<SearchDocumentsResponse> {
    const blockingTables = await this.getBlockingTables([
      'docs_steam_news_items',
      'docs_steam_news_search_projection',
      'apps',
    ]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        'searchDocuments is not ready on the current data source until the docs/news projection tables are present and backfilled.',
        'searchDocuments',
        blockingTables
      );
    }

    const mode = request.mode ?? 'topic_search';
    const query = request.query?.trim() ?? '';
    if (mode === 'topic_search' && !query) {
      throw new PublisherIQError(
        'searchDocuments requires a non-empty query string.',
        'INVALID_DOCUMENT_QUERY'
      );
    }

    const { endTime, startTime } = this.normalizeDocumentTimeWindow(
      request.startTime ?? null,
      request.endTime ?? null
    );
    const limit = normalizeLimit(request.limit, DEFAULT_DOCUMENT_LIMIT, MAX_DOCUMENT_LIMIT);
    const feedScopes = this.normalizeFeedScopes(request.feedScopes);
    const requestedEntityUids = [
      ...(request.entityUid?.trim() ? [request.entityUid.trim()] : []),
      ...((request.entityUids ?? []).filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      ).map((value) => value.trim())),
    ];
    const uniqueEntityUids = [...new Set(requestedEntityUids)];
    const entities = await Promise.all(
      uniqueEntityUids.map(async (entityUid) =>
        this.resolveCoreEntity(entityUid, {
          invalidCode: 'INVALID_DOCUMENT_ENTITY_UID',
          notFoundCode: 'DOCUMENT_ENTITY_NOT_FOUND',
        })
      )
    );

    const appids = entities.map((entity) => {
      if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
        throw new PublisherIQError(
          'searchDocuments currently supports only Steam game entity filters.',
          'INVALID_DOCUMENT_ENTITY_KIND',
          {
            entityKind: entity.entity_kind,
            entityUid: entity.entity_uid,
            platform: entity.platform,
          }
        );
      }

      const appid = Number(entity.platform_entity_id);
      if (!Number.isInteger(appid) || appid <= 0) {
        throw new PublisherIQError(
          'Resolved game entity does not have a valid Steam appid.',
          'INVALID_DOCUMENT_ENTITY_ID',
          {
            entityUid: entity.entity_uid,
            platformEntityId: entity.platform_entity_id,
          }
        );
      }

      return appid;
    });

    const appidFilter = appids.length === 1 ? appids[0]! : null;
    let rows =
      mode === 'topic_search'
        ? await this.querySearchDocumentRows({
            appidFilter,
            appids: appids.length > 0 ? appids : null,
            endTime,
            feedScopes,
            limit,
            query,
            startTime,
          })
        : await this.queryLatestNewsDocumentRows({
            appids: appids.length > 0 ? appids : null,
            endTime,
            feedScopes,
            limit: mode === 'latest_item' ? Math.max(limit, 3) : limit,
            startTime,
          });

    if (rows.length === 0 && mode === 'topic_search' && appidFilter !== null) {
      rows = await this.queryLatestEntityDocumentRows({
        appidFilter,
        endTime,
        feedScopes,
        limit,
        startTime,
      });
    }

    if (rows.length === 0 && mode === 'topic_search' && query) {
      rows = await this.querySearchDocumentRowsLexicalFallback({
        appidFilter,
        appids: appids.length > 0 ? appids : null,
        endTime,
        feedScopes,
        limit,
        query,
        startTime,
      });
    }

    const items: SearchDocumentItem[] = rows
      .map((row) => this.mapSearchDocumentRow(row))
      .slice(0, mode === 'latest_item' ? Math.max(limit, 3) : limit);
    const latestItem = items[0] ?? null;

    return {
      entity: entities[0]
        ? {
            displayName: entities[0].canonical_name,
            entityKind: entities[0].entity_kind,
            entityUid: entities[0].entity_uid,
            platform: entities[0].platform,
            platformEntityId: entities[0].platform_entity_id,
          }
        : null,
      interpretedFilters: {
        endTime,
        entityUids: uniqueEntityUids,
        feedScopes,
        mode,
        query,
        startTime,
      },
      items,
      latestItem,
      provenance: buildProvenance(this.config.source, [
        this.relation('apps').sql,
        this.relation('docs_steam_news_items').sql,
        this.relation('docs_steam_news_search_projection').sql,
      ]),
      sufficientToAnswer: items.length > 0,
    };
  }

  async semanticSearch(
    request: SemanticSearchRequest
  ): Promise<SemanticSearchResponse> {
    await this.assertContractRuntime('semanticSearch');
    await this.assertTigerSemanticFiltersSupported(request);

    const result =
      request.mode === 'concept'
        ? await this.runTigerSemanticConceptSearch(request)
        : await this.runTigerSemanticSimilaritySearch(request);

    return {
      ...result,
      provenance: this.buildSemanticSearchProvenance(request.entityKind),
    };
  }

  async getUserContext(
    request: GetUserContextRequest
  ): Promise<GetUserContextResponse> {
    await this.assertContractRuntime('getUserContext');

    const userId = request.userId.trim();
    if (!UUID_PATTERN.test(userId)) {
      throw new PublisherIQError(
        'getUserContext requires a valid UUID userId.',
        'INVALID_USER_CONTEXT_USER_ID',
        {
          userId: request.userId,
        }
      );
    }

    const includePins = request.includePins !== false;
    const includeAlerts = request.includeAlerts !== false;
    const includeAlertPreferences = request.includeAlertPreferences !== false;
    const limitAlerts = normalizeLimit(
      request.limitAlerts,
      DEFAULT_USER_ALERT_LIMIT,
      MAX_USER_ALERT_LIMIT
    );

    const [pins, alertPreferences, alerts, unreadAlertCount] = await Promise.all([
      includePins ? this.queryUserContextPins(userId) : Promise.resolve([]),
      includeAlertPreferences
        ? this.queryUserAlertPreferences(userId)
        : Promise.resolve(null),
      includeAlerts ? this.queryUserContextAlerts(userId, limitAlerts) : Promise.resolve([]),
      includeAlerts ? this.queryUnreadAlertCount(userId) : Promise.resolve(0),
    ]);

    return {
      alertPreferences,
      alerts,
      pins,
      provenance: buildProvenance(this.config.source, [
        this.relation('user_pins').sql,
        this.relation('user_alerts').sql,
        this.relation('user_alert_preferences').sql,
        this.relation('user_pin_alert_settings').sql,
        this.relation('apps').sql,
        this.relation('latest_daily_metrics').sql,
        this.relation('publishers').sql,
        this.relation('developers').sql,
      ]),
      sufficientToAnswer: true,
      totalAlerts: alerts.length,
      totalPins: pins.length,
      unreadAlertCount,
      userId,
    };
  }

  async getYoutubeGameCoverage(
    request: GetYoutubeGameCoverageRequest
  ): Promise<GetYoutubeGameCoverageResponse> {
    const view = this.normalizeYoutubeCoverageView(request.view);
    const resolvedWindow = this.normalizeYoutubeCoverageWindow(view, request.window ?? null);
    const contentClass = this.normalizeYoutubeContentClass(request.contentClass ?? null);
    const includeSummary = request.includeSummary ?? true;
    const includeLanguageOptions = request.includeLanguageOptions ?? true;
    const language = this.normalizeYoutubeCoverageLanguage(request.language ?? null);
    const limit = normalizeLimit(request.limit, DEFAULT_YOUTUBE_LIMIT, MAX_YOUTUBE_LIMIT);
    const offset = normalizeOffset(request.offset);
    const entity = await this.resolveCoreEntity(request.entityUid.trim(), {
      invalidCode: 'INVALID_YOUTUBE_ENTITY_UID',
      notFoundCode: 'YOUTUBE_ENTITY_NOT_FOUND',
    });

    if (entity.entity_kind !== 'game' || entity.platform !== 'steam') {
      throw new PublisherIQError(
        'getYoutubeGameCoverage currently supports only Steam game entities.',
        'INVALID_YOUTUBE_ENTITY_KIND',
        {
          entityKind: entity.entity_kind,
          entityUid: request.entityUid,
          platform: entity.platform,
        }
      );
    }

    const appid = Number(entity.platform_entity_id);
    if (!Number.isInteger(appid) || appid <= 0) {
      throw new PublisherIQError(
        'Resolved game entity does not have a valid Steam appid.',
        'INVALID_YOUTUBE_ENTITY_ID',
        {
          entityUid: request.entityUid,
          platformEntityId: entity.platform_entity_id,
        }
      );
    }

    const responseEntity: YoutubeGameCoverageEntity = {
      displayName: entity.canonical_name,
      entityKind: 'game',
      entityUid: entity.entity_uid,
      platform: 'steam',
      platformEntityId: entity.platform_entity_id,
    };
    const provenance = buildProvenance(this.config.source, [
      this.relation('core_entities').sql,
      this.relation('docs_youtube_videos').sql,
      this.relation('docs_youtube_channels').sql,
      this.relation('docs_youtube_video_matches').sql,
      this.relation('metrics_youtube_video_snapshots').sql,
      this.relation('metrics_youtube_game_daily').sql,
    ]);

    if (this.config.source !== 'tiger') {
      return this.buildYoutubeCoverageResponse({
        availability: {
          blockingTables: [this.relation('docs_youtube_videos').sql],
          reason: 'YouTube game coverage is only available from the Tiger-backed query runtime.',
          state: 'unavailable',
        },
        cadence: null,
        contentClass,
        contentMix: [],
        creators: [],
        entity: responseEntity,
        items: [],
        limit,
        pagination: null,
        provenance,
        resolvedWindow,
        summary: this.buildEmptyYoutubeCoverageSummary(),
        view,
      });
    }

    const blockingTables = await this.getBlockingTables([
      'docs_youtube_videos',
      'docs_youtube_channels',
      'docs_youtube_video_matches',
      'metrics_youtube_video_snapshots',
      'metrics_youtube_game_daily',
    ]);
    if (blockingTables.length > 0) {
      return this.buildYoutubeCoverageResponse({
        availability: {
          blockingTables,
          reason:
            'YouTube coverage is not available on this Tiger environment yet because the mirrored tables are still empty or missing.',
          state: 'unavailable',
        },
        cadence: null,
        contentClass,
        contentMix: [],
        creators: [],
        entity: responseEntity,
        items: [],
        limit,
        pagination: null,
        provenance,
        resolvedWindow,
        summary: this.buildEmptyYoutubeCoverageSummary(),
        view,
      });
    }

    if (this.isBlockedYoutubeGameTitle(entity.canonical_name)) {
      return this.buildYoutubeCoverageResponse({
        availability: {
          blockingTables: [],
          reason:
            'This title is blocked for YouTube answers right now because the current match precision is not reliable enough.',
          state: 'blocked',
        },
        cadence: null,
        contentClass,
        contentMix: [],
        creators: [],
        entity: responseEntity,
        items: [],
        limit,
        pagination: null,
        provenance,
        resolvedWindow,
        summary: this.buildEmptyYoutubeCoverageSummary(),
        view,
      });
    }

    const overrideState = await this.queryYoutubeGameOverrideState(appid);
    if (overrideState === 'suppressed') {
      return this.buildYoutubeCoverageResponse({
        availability: {
          blockingTables: [],
          reason:
            'This title is currently suppressed in the YouTube override state, so the system is not returning a user-facing YouTube answer.',
          state: 'blocked',
        },
        cadence: null,
        contentClass,
        contentMix: [],
        creators: [],
        entity: responseEntity,
        items: [],
        limit,
        pagination: null,
        provenance,
        resolvedWindow,
        summary: this.buildEmptyYoutubeCoverageSummary(),
        view,
      });
    }

    const summary = includeSummary
      ? await this.queryYoutubeCoverageSummary({
          appid,
          contentClass,
        })
      : this.buildEmptyYoutubeCoverageSummary();
    const nonCurrentWindow: Exclude<YoutubeCoverageWindow, 'current'> =
      resolvedWindow === 'current' ? '7d' : resolvedWindow;
    const latestVideosPage =
      view === 'latest_videos'
        ? await this.queryYoutubeLatestVideoRows({
            appid,
            contentClass,
            language,
            limit,
            offset,
            window: resolvedWindow,
          })
        : null;
    const topVideosPage =
      view === 'top_videos'
        ? await this.queryYoutubeTopVideoRows({
            appid,
            contentClass,
            language,
            limit,
            offset,
            window: resolvedWindow,
          })
        : null;
    const growthVideosPage =
      view === 'video_growth'
        ? await this.queryYoutubeVideoGrowthRows({
            appid,
            contentClass,
            language,
            limit,
            offset,
            window: nonCurrentWindow,
          })
        : null;
    const creatorsPage =
      view === 'creator_coverage'
        ? await this.queryYoutubeCreatorCoverageRows({
            appid,
            contentClass,
            limit,
            offset,
            window: resolvedWindow,
          })
        : null;
    const contentMix =
      view === 'content_mix'
        ? await this.queryYoutubeContentMixRows({
            appid,
            contentClass,
            window: nonCurrentWindow,
          })
        : [];
    const cadence =
      view === 'cadence'
        ? await this.queryYoutubeCadenceRow({
            appid,
            contentClass,
            window: nonCurrentWindow,
          })
        : null;
    const languageOptions =
      includeLanguageOptions
      && (view === 'latest_videos' || view === 'top_videos' || view === 'video_growth')
        ? await this.queryYoutubeVideoLanguageOptions({
            appid,
            contentClass,
            window: view === 'video_growth' ? nonCurrentWindow : resolvedWindow,
          })
        : [];
    const pagination =
      latestVideosPage
        ? this.buildYoutubePagination({
            limit,
            offset,
            totalRows: latestVideosPage.totalRows,
          })
        : topVideosPage
          ? this.buildYoutubePagination({
              limit,
              offset,
              totalRows: topVideosPage.totalRows,
            })
          : growthVideosPage
            ? this.buildYoutubePagination({
                limit,
                offset,
                totalRows: growthVideosPage.totalRows,
              })
            : creatorsPage
              ? this.buildYoutubePagination({
                  limit,
                  offset,
                  totalRows: creatorsPage.totalRows,
                })
              : null;

    return this.buildYoutubeCoverageResponse({
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      cadence,
      contentClass,
      contentMix,
      creators: creatorsPage?.rows ?? [],
      entity: responseEntity,
      items: latestVideosPage?.rows.length
        ? latestVideosPage.rows
        : topVideosPage?.rows.length
          ? topVideosPage.rows
          : growthVideosPage?.rows ?? [],
      languageOptions,
      limit,
      pagination,
      provenance,
      resolvedWindow,
      summary,
      view,
    });
  }

  async getYoutubeMarketPulse(
    request: GetYoutubeMarketPulseRequest = {}
  ): Promise<GetYoutubeMarketPulseResponse> {
    const window = this.normalizeYoutubeMarketPulseWindow(request.window ?? '7d');
    const contentClass = this.normalizeYoutubeContentClass(request.contentClass ?? null);
    const sort = this.normalizeYoutubeMarketPulseSort(request.sort ?? 'steam_rank');
    const limit = normalizeLimit(
      request.limit,
      DEFAULT_YOUTUBE_MARKET_LIMIT,
      MAX_YOUTUBE_MARKET_LIMIT
    );
    const offset = normalizeOffset(request.offset);
    const provenance = buildProvenance(this.config.source, [
      this.relation('apps').sql,
      this.relation('latest_daily_metrics').sql,
      this.relation('docs_youtube_videos').sql,
      this.relation('docs_youtube_channels').sql,
      this.relation('docs_youtube_video_matches').sql,
      this.relation('metrics_youtube_video_snapshots').sql,
      this.relation('metrics_youtube_game_daily').sql,
    ]);

    if (this.config.source !== 'tiger') {
      return {
        availability: {
          blockingTables: [this.relation('docs_youtube_videos').sql],
          reason: 'YouTube market pulse is only available from the Tiger-backed query runtime.',
          state: 'unavailable',
        },
        contentClass,
        items: [],
        limit,
        offset,
        pagination: this.buildYoutubePagination({ limit, offset, totalRows: 0 }),
        provenance,
        sort,
        sufficientToAnswer: false,
        summary: this.buildEmptyYoutubeMarketPulseSummary(),
        window,
      };
    }

    const blockingTables = await this.getBlockingTables([
      'apps',
      'latest_daily_metrics',
      'docs_youtube_videos',
      'docs_youtube_channels',
      'docs_youtube_video_matches',
      'metrics_youtube_video_snapshots',
      'metrics_youtube_game_daily',
    ]);

    if (blockingTables.length > 0) {
      return {
        availability: {
          blockingTables,
          reason:
            'YouTube market pulse is not available on this Tiger environment yet because required tables are still empty or missing.',
          state: 'unavailable',
        },
        contentClass,
        items: [],
        limit,
        offset,
        pagination: this.buildYoutubePagination({ limit, offset, totalRows: 0 }),
        provenance,
        sort,
        sufficientToAnswer: false,
        summary: this.buildEmptyYoutubeMarketPulseSummary(),
        window,
      };
    }

    const { items, summary, totalRows } = await this.queryYoutubeMarketPulseRows({
      contentClass,
      limit,
      offset,
      sort,
      window,
    });

    return {
      availability: {
        blockingTables: [],
        reason: null,
        state: 'ready',
      },
      contentClass,
      items,
      limit,
      offset,
      pagination: this.buildYoutubePagination({ limit, offset, totalRows }),
      provenance,
      sort,
      sufficientToAnswer: items.some((item) => item.matchedPrimaryVideoCount > 0),
      summary,
      window,
    };
  }

  async continueResultSet(
    request: ContinueResultSetRequest
  ): Promise<ContinueResultSetResponse> {
    await this.assertContractRuntime('continueResultSet');

    const requestedCount = normalizeLimit(
      request.requestedCount,
      DEFAULT_CONTINUE_LIMIT,
      MAX_CONTINUE_LIMIT
    );

    if (request.sourceContract === 'searchCatalog') {
      await this.assertContractRuntime('searchCatalog');

      const sourceArgs = request.sourceArgs as SearchCatalogRequest;
      const effectiveArgs: SearchCatalogRequest = {
        ...sourceArgs,
        continuationToken: request.continuationToken ?? sourceArgs.continuationToken ?? null,
        limit: requestedCount,
      };

      const result = await this.searchCatalog(effectiveArgs);

      return {
        continuationToken: result.continuationToken,
        effectiveArgs,
        exhausted: result.continuationToken == null,
        provenance: result.provenance,
        result,
        sourceContract: request.sourceContract,
        sufficientToAnswer: result.sufficientToAnswer,
      };
    }

    if (request.sourceContract === 'discoverMomentum') {
      await this.assertContractRuntime('discoverMomentum');

      const sourceArgs = request.sourceArgs as DiscoverMomentumRequest;
      const effectiveArgs = this.applyContinuationDeltaToDiscoverMomentumArgs(
        sourceArgs,
        requestedCount,
        request.delta
      );
      const result = await this.discoverMomentum(effectiveArgs);

      return {
        continuationToken: null,
        effectiveArgs,
        exhausted: result.items.length < requestedCount,
        provenance: result.provenance,
        result,
        sourceContract: request.sourceContract,
        sufficientToAnswer: result.sufficientToAnswer,
      };
    }

    await this.assertContractRuntime('semanticSearch');

    const sourceArgs = request.sourceArgs as SemanticSearchRequest;
    if (sourceArgs.entityKind !== 'game') {
      throw new PublisherIQError(
        'continueResultSet currently supports only game semantic search result sets.',
        'INVALID_CONTINUATION_ENTITY_KIND',
        {
          entityKind: sourceArgs.entityKind,
          sourceContract: request.sourceContract,
        }
      );
    }

    const effectiveArgs = this.applyContinuationDeltaToSemanticSearchArgs(
      sourceArgs,
      request.continuationToken ?? sourceArgs.continuationToken ?? null,
      requestedCount,
      request.delta
    );
    const result = await this.semanticSearch(effectiveArgs);

      return {
        continuationToken: result.continuation_token ?? null,
        effectiveArgs,
        exhausted: (result.continuation_token ?? null) == null,
        provenance: result.provenance,
        result,
        sourceContract: request.sourceContract,
        sufficientToAnswer: result.sufficient_to_answer === true,
      };
    }

  private buildSemanticSearchProvenance(entityKind: EntityKind): QueryProvenance {
    const sharedTables = [
      this.relation('apps').sql,
      this.relation('latest_daily_metrics').sql,
      this.relation('app_publishers').sql,
      this.relation('app_developers').sql,
      this.relation('app_genres').sql,
      this.relation('steam_genres').sql,
      this.relation('app_steam_tags').sql,
      this.relation('steam_tags').sql,
    ];

    const entityTables =
      entityKind === 'game'
        ? sharedTables
        : [
            this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql,
            ...sharedTables,
          ];

    return buildProvenance(this.config.source, entityTables);
  }

  private async runTigerSemanticSimilaritySearch(
    request: SemanticSearchRequest
  ): Promise<Omit<SemanticSearchResponse, 'provenance'>> {
    const resolved = await this.resolveSemanticReference({
      entityKind: request.entityKind,
      referencePlatformEntityId: request.referencePlatformEntityId,
      referenceQuery: request.referenceQuery,
    });

    if (!resolved.entity) {
      return {
        candidates: resolved.candidates,
        entityType: request.entityKind === 'game' ? undefined : request.entityKind,
        error: resolved.error ?? `Could not resolve the requested ${request.entityKind}.`,
        success: false,
      };
    }

    return request.entityKind === 'game'
      ? this.runTigerGameSimilaritySearch(request, resolved.entity)
      : this.runTigerCompanySimilaritySearch(
          request as SemanticSearchRequest & { entityKind: 'developer' | 'publisher' },
          resolved.entity
        );
  }

  private async runTigerSemanticConceptSearch(
    request: SemanticSearchRequest
  ): Promise<Omit<SemanticSearchResponse, 'provenance'>> {
    if (request.entityKind !== 'game') {
      return {
        error: 'Concept search currently supports only game entities.',
        success: false,
      };
    }

    const description = request.description?.trim() ?? '';
    if (!description) {
      return {
        error: 'Description is required for concept search.',
        success: false,
      };
    }

    const requestedLimit = Math.min(
      Math.max(request.limit ?? DEFAULT_SEMANTIC_RESULTS, 1),
      MAX_SEMANTIC_RESULTS
    );
    const { offset } = decodeContinuationToken(request.continuationToken);
    const searchLimit = this.resolveSemanticGameSearchLimit(request.filters, offset, requestedLimit);
    const terms = tokenizeSemanticConcept(description);

    if (terms.length === 0) {
      return {
        error: 'Try describing the kind of game you want with a few concrete traits.',
        success: false,
      };
    }

    const candidates = await this.queryTigerConceptGameCandidates({
      description,
      filters: request.filters,
      limit: searchLimit,
      terms,
    });
    const reranked = this.rankTigerConceptGameCandidates(description, candidates);
    const pageResults = reranked.slice(offset, offset + requestedLimit);
    const nextOffset = offset + pageResults.length;

    return {
      continuation_token:
        nextOffset < reranked.length
          ? encodeContinuationToken({ offset: nextOffset })
          : null,
      debug: {
        searchParams: {
          description,
          entityKind: request.entityKind,
          limit: requestedLimit,
          offset,
          terms,
        },
      },
      mode: 'semantic',
      query_description: description,
      results: pageResults.map((result) => result.item),
      sufficient_to_answer: reranked.length > 0,
      sufficiency_reason:
        reranked.length > 0
          ? 'Returned concept matches that already satisfy the request. Respond directly from these rows instead of broadening.'
          : undefined,
      success: true,
      total_found: reranked.length,
    };
  }

  private async resolveSemanticReference(params: {
    entityKind: EntityKind;
    referencePlatformEntityId?: string | null;
    referenceQuery?: string | null;
  }): Promise<ResolveReferenceResult> {
    const { entityKind, referencePlatformEntityId, referenceQuery } = params;

    if (referencePlatformEntityId?.trim()) {
      const id = Number(referencePlatformEntityId.trim());
      if (!Number.isInteger(id) || id <= 0) {
        return {
          error: `Invalid ${entityKind} id "${referencePlatformEntityId}".`,
        };
      }

      return entityKind === 'game'
        ? { entity: await this.lookupSemanticGameById(id) }
        : { entity: await this.lookupSemanticCompanyById(entityKind, id) };
    }

    const query = referenceQuery?.trim();
    if (!query) {
      return {
        error: `A ${entityKind} reference is required for similarity search.`,
      };
    }

    const resolved = await this.resolveEntities({
      entityKinds: [entityKind],
      includeMetrics: true,
      limit: 5,
      query,
    });

    if (resolved.entities.length === 0) {
      return {
        error: `Could not find ${entityKind} named "${query}". Try a different name or check spelling.`,
      };
    }

    if (entityKind !== 'game' && resolved.ambiguity.requiresClarification) {
      return {
        candidates: resolved.entities.slice(0, 5).map((entity) => ({
          id: Number(entity.platformEntityId),
          name: entity.displayName,
        })),
        error: resolved.ambiguity.message ?? `The ${entityKind} name "${query}" is ambiguous.`,
      };
    }

    const selected = resolved.entities[0];
    const id = Number(selected.platformEntityId);
    if (!Number.isInteger(id) || id <= 0) {
      return {
        error: `Resolved ${entityKind} "${selected.displayName}" does not have a valid platform id.`,
      };
    }

    return entityKind === 'game'
      ? { entity: await this.lookupSemanticGameById(id) }
      : { entity: await this.lookupSemanticCompanyById(entityKind, id) };
  }

  private async lookupSemanticGameById(
    appid: number
  ): Promise<ResolvedReferenceEntity | null> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;

    const result = await runQuery<SemanticGameReferenceRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.type::text AS type,
          a.is_free,
          a.platforms,
          a.current_price_cents,
          a.pics_review_percentage,
          ldm.total_reviews,
          NULL::text AS steam_deck_category,
          COALESCE((
            SELECT array_agg(DISTINCT ap.publisher_id ORDER BY ap.publisher_id)
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
          ), ARRAY[]::int[]) AS publisher_ids,
          COALESCE((
            SELECT array_agg(DISTINCT ad.developer_id ORDER BY ad.developer_id)
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
          ), ARRAY[]::int[]) AS developer_ids
          ,
          COALESCE((
            SELECT array_agg(DISTINCT sg.name ORDER BY sg.name)
            FROM ${appGenresTable} ag
            JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
            WHERE ag.appid = a.appid
          ), ARRAY[]::text[]) AS genres,
          COALESCE((
            SELECT array_agg(DISTINCT st.name ORDER BY st.name)
            FROM ${appSteamTagsTable} ast
            JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
            WHERE ast.appid = a.appid
          ), ARRAY[]::text[]) AS tags
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE a.appid = $1
          AND a.is_delisted = false
          AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LIMIT 1
      `,
      [appid],
      this.config
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.appid,
      metrics: {
        developer_ids: row.developer_ids ?? [],
        price_cents: row.current_price_cents,
        publisher_ids: row.publisher_ids ?? [],
        review_percentage: row.pics_review_percentage,
        total_reviews: row.total_reviews,
      },
      name: row.name,
      type: row.type ?? 'game',
    };
  }

  private async lookupSemanticCompanyById(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    id: number
  ): Promise<ResolvedReferenceEntity | null> {
    const table = this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const result = await runQuery<SemanticCompanyReferenceRow>(
      `
        SELECT
          c.id,
          c.name,
          c.game_count,
          CASE
            WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
              THEN ROUND(
                (
                  SUM(COALESCE(ldm.positive_percentage, 0) * COALESCE(ldm.total_reviews, 0))::numeric
                  / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
                ),
                2
              )::double precision
            ELSE NULL
          END AS avg_review_percentage,
          COALESCE((
            SELECT array_agg(top_genres.name ORDER BY top_genres.cnt DESC, top_genres.name ASC)
            FROM (
              SELECT sg.name, COUNT(*)::int AS cnt
              FROM ${relationTable} rel2
              JOIN ${appsTable} a2
                ON a2.appid = rel2.appid
               AND a2.is_delisted = false
               AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
              JOIN ${appGenresTable} ag ON ag.appid = a2.appid
              JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
              WHERE rel2.${relationColumn} = c.id
              GROUP BY sg.name
              ORDER BY cnt DESC, sg.name ASC
              LIMIT 5
            ) top_genres
          ), ARRAY[]::text[]) AS top_genres,
          COALESCE((
            SELECT array_agg(top_tags.name ORDER BY top_tags.cnt DESC, top_tags.name ASC)
            FROM (
              SELECT st.name, COUNT(*)::int AS cnt
              FROM ${relationTable} rel2
              JOIN ${appsTable} a2
                ON a2.appid = rel2.appid
               AND a2.is_delisted = false
               AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
              JOIN ${appSteamTagsTable} ast ON ast.appid = a2.appid
              JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
              WHERE rel2.${relationColumn} = c.id
              GROUP BY st.name
              ORDER BY cnt DESC, st.name ASC
              LIMIT 5
            ) top_tags
          ), ARRAY[]::text[]) AS top_tags
        FROM ${table} c
        LEFT JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
        LEFT JOIN ${appsTable} a
          ON a.appid = rel.appid
         AND a.is_delisted = false
         AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE c.id = $1
        GROUP BY c.id, c.name, c.game_count
        LIMIT 1
      `,
      [id],
      this.config
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      type: entityKind,
    };
  }

  private mapTigerSemanticGameProfile(
    row: TigerSemanticGameProfileRow
  ): TigerSemanticGameProfile {
    const reviewPercentage = row.pics_review_percentage ?? row.positive_percentage ?? null;

    return {
      appid: row.appid,
      developerIds: row.developer_ids ?? [],
      genres: row.genres ?? [],
      isFree: row.is_free,
      name: row.name,
      platforms: row.platforms
        ? row.platforms.split(',').map((platform) => platform.trim()).filter(Boolean)
        : [],
      priceCents: row.current_price_cents,
      publisherIds: row.publisher_ids ?? [],
      reviewPercentage,
      tags: row.tags ?? [],
      totalReviews: row.total_reviews,
      type: row.type ?? 'game',
    };
  }

  private mapTigerSemanticCompanyProfile(
    row: Pick<
      SemanticCompanyReferenceRow | SemanticCompanyCandidateRow,
      'avg_review_percentage' | 'game_count' | 'id' | 'name' | 'top_genres' | 'top_tags'
    >
  ): TigerSemanticCompanyProfile {
    const gameCount = row.game_count ?? null;
    return {
      avgReviewPercentage: row.avg_review_percentage,
      gameCount,
      id: row.id,
      isIndie: gameCount !== null ? gameCount <= 15 : false,
      isMajor: gameCount !== null ? gameCount >= 50 : false,
      name: row.name,
      topGenres: row.top_genres ?? [],
      topTags: row.top_tags ?? [],
    };
  }

  private async runTigerGameSimilaritySearch(
    request: SemanticSearchRequest,
    reference: ResolvedReferenceEntity
  ): Promise<Omit<SemanticSearchResponse, 'provenance'>> {
    const requestedLimit = Math.min(
      Math.max(request.limit ?? DEFAULT_SEMANTIC_RESULTS, 1),
      MAX_SEMANTIC_RESULTS
    );
    const { offset } = decodeContinuationToken(request.continuationToken);
    const referenceProfile = await this.queryTigerSemanticGameProfile(reference.id);

    if (!referenceProfile) {
      return {
        error: `${reference.name} is not in the system for similarity search yet.`,
        success: false,
      };
    }

    const searchLimit = this.resolveSemanticGameSearchLimit(request.filters, offset, requestedLimit);
    const candidates = await this.queryTigerSemanticGameCandidates({
      filters: request.filters,
      limit: searchLimit,
      reference: referenceProfile,
    });
    const ranked = this.rankTigerGameSimilarityCandidates(referenceProfile, candidates, request.filters);
    const pageResults = ranked.slice(offset, offset + requestedLimit);
    const nextOffset = offset + pageResults.length;
    const closeAlternatives = offset === 0
      ? this.buildGameSimilarityCloseAlternatives({
          candidates,
          filters: request.filters,
          reference: referenceProfile,
          requestedLimit,
          strictRanked: ranked,
        })
      : { items: [], reason: null };
    const hasAnswer = ranked.length > 0 || closeAlternatives.items.length > 0;

    return {
      close_alternatives: closeAlternatives.items.length > 0 ? closeAlternatives.items : undefined,
      close_alternatives_reason: closeAlternatives.reason ?? undefined,
      continuation_token:
        nextOffset < ranked.length
          ? encodeContinuationToken({ offset: nextOffset })
          : null,
      debug: {
        searchParams: {
          entityKind: request.entityKind,
          limit: requestedLimit,
          offset,
          reference_id: reference.id,
        },
      },
      mode: 'semantic',
      reference: {
        id: reference.id,
        name: reference.name,
        type: reference.type,
      },
      results: pageResults.map((result) => result.item),
      sufficient_to_answer: hasAnswer,
      sufficiency_reason:
        ranked.length > 0
          ? closeAlternatives.items.length > 0
            ? 'Returned exact similarity matches and close alternatives. Use the strict rows first, then surface the near misses as a secondary section.'
            : 'Returned similarity rows that already answer the request. Respond directly instead of broadening.'
          : closeAlternatives.items.length > 0
            ? 'No exact similarity matches cleared the requested comparison cutoff, so returned close alternatives that still match the core similarity profile.'
            : undefined,
      success: true,
      total_found: ranked.length,
    };
  }

  private buildGameSimilarityCloseAlternatives(params: {
    candidates: SemanticGameCandidateRow[];
    filters: SemanticSearchFilters | undefined;
    reference: TigerSemanticGameProfile;
    requestedLimit: number;
    strictRanked: RankedSemanticItem[];
  }): { items: SemanticSearchResultItem[]; reason: string | null } {
    if (!this.shouldBuildSemanticCloseAlternatives(params.filters, params.strictRanked.length, params.requestedLimit)) {
      return { items: [], reason: null };
    }

    const desiredCount = Math.min(Math.max(params.requestedLimit - params.strictRanked.length, 2), 4);
    const strictIds = new Set(params.strictRanked.map((result) => result.item.id));
    const selectedIds = new Set<number>();
    const items: SemanticSearchResultItem[] = [];
    let reason: string | null = null;

    for (const stage of this.buildRelaxedSemanticSimilarityStages(params.filters)) {
      const ranked = this.rankTigerGameSimilarityCandidates(params.reference, params.candidates, stage.filters);
      for (const result of ranked) {
        if (strictIds.has(result.item.id) || selectedIds.has(result.item.id)) {
          continue;
        }

        selectedIds.add(result.item.id);
        items.push(result.item);
        if (!reason) {
          reason = stage.reason;
        }

        if (items.length >= desiredCount) {
          return { items, reason };
        }
      }
    }

    return { items, reason };
  }

  private shouldBuildSemanticCloseAlternatives(
    filters: SemanticSearchFilters | undefined,
    strictResultCount: number,
    requestedLimit: number
  ): boolean {
    if (!filters) {
      return false;
    }

    const hasSoftComparisonConstraint =
      (filters.review_comparison != null && filters.review_comparison !== 'any')
      || (filters.popularity_comparison != null && filters.popularity_comparison !== 'any');
    if (!hasSoftComparisonConstraint) {
      return false;
    }

    const minimumStrictTarget = Math.min(Math.max(requestedLimit, 1), 5);
    return strictResultCount < minimumStrictTarget;
  }

  private buildRelaxedSemanticSimilarityStages(
    filters: SemanticSearchFilters | undefined
  ): Array<{ filters: SemanticSearchFilters; reason: string }> {
    if (!filters) {
      return [];
    }

    const stages: Array<{ filters: SemanticSearchFilters; reason: string }> = [];
    const comparisonReason = this.describeSemanticCloseAlternativeReason(filters);

    const firstStage: SemanticSearchFilters = {
      ...filters,
    };
    let firstChanged = false;

    if (firstStage.review_comparison === 'better_only') {
      firstStage.review_comparison = 'similar_or_better';
      firstChanged = true;
    }
    if (firstStage.popularity_comparison && firstStage.popularity_comparison !== 'any') {
      firstStage.popularity_comparison = 'any';
      firstChanged = true;
    }

    if (firstChanged) {
      stages.push({
        filters: firstStage,
        reason: comparisonReason,
      });
    }

    const secondStage: SemanticSearchFilters = {
      ...(firstChanged ? firstStage : filters),
    };
    let secondChanged = false;

    if (secondStage.review_comparison && secondStage.review_comparison !== 'any') {
      secondStage.review_comparison = 'any';
      secondChanged = true;
    }

    if (secondChanged) {
      stages.push({
        filters: secondStage,
        reason: 'These stay highly similar, but they miss one or more of the stricter comparison cutoffs from the original request.',
      });
    }

    return stages;
  }

  private describeSemanticCloseAlternativeReason(filters: SemanticSearchFilters | undefined): string {
    if (!filters) {
      return 'These stay highly similar, but they miss one or more of the stricter comparison cutoffs from the original request.';
    }

    const hasReviewConstraint = filters.review_comparison != null && filters.review_comparison !== 'any';
    const hasPopularityConstraint =
      filters.popularity_comparison != null && filters.popularity_comparison !== 'any';

    if (hasReviewConstraint && hasPopularityConstraint) {
      return 'These stay highly similar, but they miss one or more of the stricter review or popularity cutoffs from the original request.';
    }

    if (filters.review_comparison === 'better_only') {
      return 'These stay highly similar, but they miss the stricter higher-review cutoff from the original request.';
    }

    if (filters.review_comparison === 'similar_or_better') {
      return 'These stay highly similar, but they fall outside the requested review-quality band.';
    }

    if (hasPopularityConstraint) {
      return 'These stay highly similar, but they miss the requested popularity comparison cutoff.';
    }

    return 'These stay highly similar, but they miss one or more of the stricter comparison cutoffs from the original request.';
  }

  private async runTigerCompanySimilaritySearch(
    request: SemanticSearchRequest & { entityKind: 'developer' | 'publisher' },
    reference: ResolvedReferenceEntity
  ): Promise<Omit<SemanticSearchResponse, 'provenance'>> {
    const requestedLimit = Math.min(
      Math.max(request.limit ?? DEFAULT_COMPANY_SEMANTIC_RESULTS, 1),
      DEFAULT_COMPANY_SEMANTIC_RESULTS
    );
    const referenceProfile = await this.queryTigerSemanticCompanyProfile(request.entityKind, reference.id);

    if (!referenceProfile) {
      return {
        entityType: request.entityKind,
        error: `${reference.name} is not in the system for company similarity search yet.`,
        reference: {
          id: reference.id,
          name: reference.name,
          type: request.entityKind,
        },
        success: false,
      };
    }

    const candidates = await this.queryTigerSemanticCompanyCandidates({
      entityKind: request.entityKind,
      filters: request.filters,
      limit: Math.min(Math.max(requestedLimit * 4, 20), MAX_SEMANTIC_SEARCH_WINDOW),
      reference: referenceProfile,
    });
    const ranked = this.rankTigerCompanySimilarityCandidates(referenceProfile, candidates);

    return {
      continuation_token: null,
      debug: {
        searchParams: {
          entityKind: request.entityKind,
          limit: requestedLimit,
          reference_id: reference.id,
        },
      },
      entityType: request.entityKind,
      mode: 'semantic',
      reference: {
        id: reference.id,
        name: reference.name,
        type: request.entityKind,
      },
      results: ranked.slice(0, requestedLimit).map((result) => result.item),
      sufficient_to_answer: ranked.length > 0,
      sufficiency_reason:
        ranked.length > 0
          ? 'Returned company peers that already answer the request. Respond directly instead of broadening.'
          : undefined,
      success: true,
      total_found: ranked.length,
    };
  }

  private rankTigerConceptGameCandidates(
    description: string,
    rows: SemanticGameCandidateRow[]
  ): RankedSemanticItem[] {
    const descriptionTerms = tokenizeSemanticConcept(description);
    const normalizedDescription = normalizeSemanticTextToken(description);

    return rows
      .map((row) => {
        const profile = this.mapTigerSemanticGameProfile(row);
        const payloadTerms = [
          profile.name,
          ...profile.genres,
          ...profile.tags,
        ].join(' ').toLowerCase();
        const normalizedName = normalizeSemanticTextToken(profile.name);
        const matchedTerms = descriptionTerms.filter((term) => payloadTerms.includes(term));
        const termCoverage = descriptionTerms.length > 0
          ? matchedTerms.length / descriptionTerms.length
          : 0;
        const exactNamePhrase =
          normalizedDescription.length >= 4 &&
          normalizedName.length > 0 &&
          normalizedName.includes(normalizedDescription);

        let score = Math.min(matchedTerms.length * 0.18, 0.72);
        score += Math.min(termCoverage * 0.18, 0.18);
        score += semanticReviewSupportBonus(profile.totalReviews, profile.reviewPercentage);
        score -= semanticLowSignalPenalty(profile.totalReviews, profile.reviewPercentage);

        if (exactNamePhrase) {
          score += 0.08;
        }

        if (descriptionTerms.length >= 2 && matchedTerms.length === 0) {
          score -= 0.18;
        }

        const reasons: string[] = [];
        if (matchedTerms.length >= 2) {
          reasons.push(`${matchedTerms[0]} + ${matchedTerms[1]} fit`);
        } else if (matchedTerms.length === 1) {
          reasons.push(`${matchedTerms[0]} fit`);
        }
        if (termCoverage >= 0.75) {
          reasons.push('High term coverage');
        } else if (exactNamePhrase) {
          reasons.push('Strong lexical fit');
        }
        if ((profile.totalReviews ?? 0) >= 100 && (profile.reviewPercentage ?? 0) >= 80) {
          reasons.push('Well-supported reviews');
        }

        return {
          item: {
            genres: profile.genres,
            id: profile.appid,
            is_free: profile.isFree,
            matchReasons: reasons.length > 0 ? reasons : undefined,
            name: profile.name,
            price_cents: profile.priceCents,
            rawScore: Math.round(Math.min((matchedTerms.length * 0.18) + Math.min(termCoverage * 0.18, 0.18), 1) * 100),
            review_percentage: profile.reviewPercentage,
            score: Math.round(Math.max(0, Math.min(score, 1)) * 100),
            steam_deck: normalizeSemanticSteamDeckCategory(row.steam_deck_category),
            tags: profile.tags,
            total_reviews: profile.totalReviews,
            type: profile.type,
          },
          score: Math.max(0, Math.min(score, 1)),
        };
      })
      .filter((result) => result.score >= 0.12)
      .sort((left, right) => right.score - left.score);
  }

  private rankTigerGameSimilarityCandidates(
    reference: TigerSemanticGameProfile,
    rows: SemanticGameCandidateRow[],
    filters: SemanticSearchFilters | undefined
  ): RankedSemanticItem[] {
    const minimumScore = this.resolveSemanticSimilarityThreshold(filters);

    return rows
      .map((row) => {
        const candidate = this.mapTigerSemanticGameProfile(row);
        let score = 0;
        let rawScore = 0;
        const reasons: string[] = [];

        const sharedGenres = sharedSemanticStrings(reference.genres, candidate.genres);
        const sharedTags = sharedSemanticStrings(reference.tags, candidate.tags);
        const informativeGenres = filterSemanticAttributes(sharedGenres);
        const informativeTags = filterSemanticAttributes(sharedTags);

        if (reference.developerIds.some((developerId) => candidate.developerIds.includes(developerId))) {
          score += 0.18;
          rawScore += 0.18;
          reasons.push('Same developer');
        }

        if (reference.publisherIds.some((publisherId) => candidate.publisherIds.includes(publisherId))) {
          score += 0.06;
          rawScore += 0.06;
          reasons.push('Same publisher');
        }

        score += Math.min(sharedGenres.length, 2) * 0.1;
        rawScore += Math.min(sharedGenres.length, 2) * 0.1;
        score += Math.min(sharedTags.length, 3) * 0.06;
        rawScore += Math.min(sharedTags.length, 3) * 0.06;

        for (const reason of [...informativeTags, ...informativeGenres, ...sharedTags, ...sharedGenres]) {
          if (!reasons.includes(reason)) {
            reasons.push(reason);
          }
          if (reasons.length >= 4) {
            break;
          }
        }

        if (
          filters?.review_comparison &&
          filters.review_comparison !== 'any' &&
          reference.totalReviews != null &&
          reference.reviewPercentage != null
        ) {
          if (
            candidate.reviewPercentage == null ||
            ((filters.review_comparison === 'better_only' || filters.review_comparison === 'similar_or_better') &&
              candidate.reviewPercentage < reference.reviewPercentage - (filters.review_comparison === 'better_only' ? 0 : 2))
          ) {
            score = -1;
          } else {
            score += 0.04;
            reasons.push('Review fit');
          }
        }

        if (
          filters?.steam_deck?.length &&
          row.steam_deck_category &&
          filters.steam_deck.includes(row.steam_deck_category as 'verified' | 'playable')
        ) {
          score += 0.04;
          reasons.push(`Steam Deck ${row.steam_deck_category}`);
        }

        if (filters?.popularity_comparison === 'less_popular') {
          if (
            candidate.totalReviews == null ||
            reference.totalReviews == null ||
            candidate.totalReviews >= reference.totalReviews
          ) {
            score = -1;
          } else {
            score += 0.03;
            reasons.push('Smaller review footprint');
          }
        }

        if (
          hasSuspiciousSemanticTitleOverlap(reference.name, candidate.name) &&
          informativeGenres.length === 0 &&
          informativeTags.length === 0 &&
          !reasons.includes('Same developer') &&
          !reasons.includes('Same publisher')
        ) {
          score -= 0.18;
        }

        score += semanticReviewSupportBonus(candidate.totalReviews, candidate.reviewPercentage);
        score -= semanticLowSignalPenalty(candidate.totalReviews, candidate.reviewPercentage);

        const boundedScore = Math.max(0, Math.min(score, 1));
        return {
          item: {
            genres: candidate.genres,
            id: candidate.appid,
            is_free: candidate.isFree,
            matchReasons: reasons.length > 0 ? reasons.slice(0, 4) : undefined,
            name: candidate.name,
            price_cents: candidate.priceCents,
            rawScore: Math.round(Math.max(0, Math.min(rawScore, 1)) * 100),
            review_percentage: candidate.reviewPercentage,
            score: Math.round(boundedScore * 100),
            steam_deck: normalizeSemanticSteamDeckCategory(row.steam_deck_category),
            tags: candidate.tags,
            total_reviews: candidate.totalReviews,
            type: candidate.type,
          },
          score: boundedScore,
        };
      })
      .filter((result) => result.score >= minimumScore)
      .sort((left, right) => right.score - left.score);
  }

  private countSemanticNarrowingFilters(filters: SemanticSearchFilters | undefined): number {
    if (!filters) {
      return 0;
    }

    let count = 0;
    if (filters.review_comparison && filters.review_comparison !== 'any') {
      count += 1;
    }
    if (filters.popularity_comparison && filters.popularity_comparison !== 'any') {
      count += 1;
    }
    if (filters.steam_deck?.length) {
      count += 1;
    }
    if (filters.platforms?.length) {
      count += 1;
    }
    if (typeof filters.is_free === 'boolean') {
      count += 1;
    }
    if (typeof filters.max_price_cents === 'number') {
      count += 1;
    }
    if (typeof filters.min_reviews === 'number' || typeof filters.max_reviews === 'number') {
      count += 1;
    }
    if (filters.review_percentage?.gte != null || filters.review_percentage?.lte != null) {
      count += 1;
    }
    if (filters.release_year?.gte != null || filters.release_year?.lte != null) {
      count += 1;
    }
    if (filters.genres?.length) {
      count += 1;
    }
    if (filters.tags?.length) {
      count += 1;
    }

    return count;
  }

  private resolveSemanticGameSearchLimit(
    filters: SemanticSearchFilters | undefined,
    offset: number,
    requestedLimit: number
  ): number {
    const narrowingCount = this.countSemanticNarrowingFilters(filters);
    const reviewConstrained = filters?.review_comparison != null && filters.review_comparison !== 'any';
    const multiplier = reviewConstrained
      ? Math.max(narrowingCount >= 2 ? 8 : narrowingCount === 1 ? 6 : 4, 10)
      : narrowingCount >= 2 ? 8 : narrowingCount === 1 ? 6 : 4;
    const minimumWindow = reviewConstrained
      ? Math.max(narrowingCount >= 2 ? 60 : narrowingCount === 1 ? 42 : 30, 72)
      : narrowingCount >= 2 ? 60 : narrowingCount === 1 ? 42 : 30;

    return Math.min(
      Math.max((offset + requestedLimit) * multiplier, minimumWindow),
      MAX_SEMANTIC_SEARCH_WINDOW
    );
  }

  private resolveSemanticSimilarityThreshold(filters: SemanticSearchFilters | undefined): number {
    const narrowingCount = this.countSemanticNarrowingFilters(filters);
    const reviewConstrained = filters?.review_comparison != null && filters.review_comparison !== 'any';
    if (reviewConstrained) {
      return narrowingCount >= 2 ? 0.08 : 0.1;
    }
    if (narrowingCount >= 2) {
      return 0.1;
    }
    if (narrowingCount === 1) {
      return 0.12;
    }

    return 0.16;
  }

  private rankTigerCompanySimilarityCandidates(
    reference: TigerSemanticCompanyProfile,
    rows: SemanticCompanyCandidateRow[]
  ): RankedSemanticItem[] {
    return rows
      .map((row) => {
        const candidate = this.mapTigerSemanticCompanyProfile(row);
        const sharedGenres = sharedSemanticStrings(reference.topGenres, candidate.topGenres);
        const sharedTags = sharedSemanticStrings(reference.topTags, candidate.topTags);
        let score = Math.min(sharedGenres.length, 2) * 0.16 + Math.min(sharedTags.length, 3) * 0.1;

        const reasons: string[] = [];
        if (sharedGenres.length > 0) {
          reasons.push('Similar genre footprint');
        }
        if (sharedTags.length > 0) {
          reasons.push('Overlapping portfolio tags');
        }

        const gameCountCloseness = semanticClosenessScore(reference.gameCount, candidate.gameCount);
        if (gameCountCloseness >= 0.65) {
          score += 0.08;
          reasons.push('Similar catalog size');
        }

        if (
          reference.avgReviewPercentage != null &&
          candidate.avgReviewPercentage != null &&
          Math.abs(reference.avgReviewPercentage - candidate.avgReviewPercentage) <= 6
        ) {
          score += 0.06;
          reasons.push('Similar average review quality');
        }

        if (reference.isMajor === candidate.isMajor && (reference.isMajor || candidate.isMajor)) {
          score += 0.03;
        }
        if (reference.isIndie === candidate.isIndie && (reference.isIndie || candidate.isIndie)) {
          score += 0.03;
        }

        const boundedScore = Math.max(0, Math.min(score, 1));
        return {
          item: {
            avg_review_percentage: candidate.avgReviewPercentage,
            game_count: candidate.gameCount ?? undefined,
            id: candidate.id,
            is_indie: candidate.isIndie,
            is_major: candidate.isMajor,
            matchReasons: reasons.length > 0 ? reasons.slice(0, 4) : undefined,
            name: candidate.name,
            score: Math.round(boundedScore * 100),
            top_genres: candidate.topGenres,
            top_tags: candidate.topTags,
          },
          score: boundedScore,
        };
      })
      .filter((result) => result.score >= 0.12)
      .sort((left, right) => right.score - left.score);
  }

  private async queryTigerSemanticGameProfile(appid: number): Promise<TigerSemanticGameProfile | null> {
    const profileRow = await runQuery<SemanticGameReferenceRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.type::text AS type,
          a.is_free,
          a.platforms,
          a.current_price_cents,
          a.pics_review_percentage,
          ldm.total_reviews,
          NULL::text AS steam_deck_category,
          COALESCE((
            SELECT array_agg(DISTINCT ap.publisher_id ORDER BY ap.publisher_id)
            FROM ${this.relation('app_publishers').sql} ap
            WHERE ap.appid = a.appid
          ), ARRAY[]::int[]) AS publisher_ids,
          COALESCE((
            SELECT array_agg(DISTINCT ad.developer_id ORDER BY ad.developer_id)
            FROM ${this.relation('app_developers').sql} ad
            WHERE ad.appid = a.appid
          ), ARRAY[]::int[]) AS developer_ids,
          COALESCE((
            SELECT array_agg(DISTINCT sg.name ORDER BY sg.name)
            FROM ${this.relation('app_genres').sql} ag
            JOIN ${this.relation('steam_genres').sql} sg ON sg.genre_id = ag.genre_id
            WHERE ag.appid = a.appid
          ), ARRAY[]::text[]) AS genres,
          COALESCE((
            SELECT array_agg(DISTINCT st.name ORDER BY st.name)
            FROM ${this.relation('app_steam_tags').sql} ast
            JOIN ${this.relation('steam_tags').sql} st ON st.tag_id = ast.tag_id
            WHERE ast.appid = a.appid
          ), ARRAY[]::text[]) AS tags
        FROM ${this.relation('apps').sql} a
        LEFT JOIN ${this.relation('latest_daily_metrics').sql} ldm ON ldm.appid = a.appid
        WHERE a.appid = $1
        LIMIT 1
      `,
      [appid],
      this.config
    );

    return profileRow.rows[0] ? this.mapTigerSemanticGameProfile(profileRow.rows[0]) : null;
  }

  private async queryTigerSemanticCompanyProfile(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    id: number
  ): Promise<TigerSemanticCompanyProfile | null> {
    const row = await runQuery<SemanticCompanyReferenceRow>(
      `
        SELECT *
        FROM (
          SELECT
            c.id,
            c.name,
            c.game_count,
            CASE
              WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
                THEN ROUND(
                  (
                    SUM(COALESCE(ldm.positive_percentage, 0) * COALESCE(ldm.total_reviews, 0))::numeric
                    / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
                  ),
                  2
                )::double precision
              ELSE NULL
            END AS avg_review_percentage,
            COALESCE((
              SELECT array_agg(top_genres.name ORDER BY top_genres.cnt DESC, top_genres.name ASC)
              FROM (
                SELECT sg.name, COUNT(*)::int AS cnt
                FROM ${this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql} rel2
                JOIN ${this.relation('apps').sql} a2
                  ON a2.appid = rel2.appid
                 AND a2.is_delisted = false
                 AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
                JOIN ${this.relation('app_genres').sql} ag ON ag.appid = a2.appid
                JOIN ${this.relation('steam_genres').sql} sg ON sg.genre_id = ag.genre_id
                WHERE rel2.${entityKind === 'publisher' ? 'publisher_id' : 'developer_id'} = c.id
                GROUP BY sg.name
                ORDER BY cnt DESC, sg.name ASC
                LIMIT 5
              ) top_genres
            ), ARRAY[]::text[]) AS top_genres,
            COALESCE((
              SELECT array_agg(top_tags.name ORDER BY top_tags.cnt DESC, top_tags.name ASC)
              FROM (
                SELECT st.name, COUNT(*)::int AS cnt
                FROM ${this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql} rel2
                JOIN ${this.relation('apps').sql} a2
                  ON a2.appid = rel2.appid
                 AND a2.is_delisted = false
                 AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
                JOIN ${this.relation('app_steam_tags').sql} ast ON ast.appid = a2.appid
                JOIN ${this.relation('steam_tags').sql} st ON st.tag_id = ast.tag_id
                WHERE rel2.${entityKind === 'publisher' ? 'publisher_id' : 'developer_id'} = c.id
                GROUP BY st.name
                ORDER BY cnt DESC, st.name ASC
                LIMIT 5
              ) top_tags
            ), ARRAY[]::text[]) AS top_tags
          FROM ${this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql} c
          LEFT JOIN ${this.relation(entityKind === 'publisher' ? 'app_publishers' : 'app_developers').sql} rel
            ON rel.${entityKind === 'publisher' ? 'publisher_id' : 'developer_id'} = c.id
          LEFT JOIN ${this.relation('apps').sql} a
            ON a.appid = rel.appid
           AND a.is_delisted = false
           AND ${GAME_TYPE_PREDICATE[this.config.source]}
          LEFT JOIN ${this.relation('latest_daily_metrics').sql} ldm ON ldm.appid = a.appid
          WHERE c.id = $1
          GROUP BY c.id, c.name, c.game_count
        ) profile
      `,
      [id],
      this.config
    );

    return row.rows[0] ? this.mapTigerSemanticCompanyProfile(row.rows[0]) : null;
  }

  private async queryTigerSemanticGameCandidates(params: {
    filters: SemanticSearchFilters | undefined;
    limit: number;
    reference: TigerSemanticGameProfile;
  }): Promise<SemanticGameCandidateRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const filters = params.filters;
    const steamDeckSelect = filters?.steam_deck?.length
      ? `(SELECT asd.category::text FROM ${appSteamDeckTable} asd WHERE asd.appid = a.appid LIMIT 1)`
      : 'NULL::text';
    const queryParams: unknown[] = [params.reference.appid];
    const conditions: string[] = [
      'a.appid <> $1',
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (filters?.platforms?.length) {
      for (const platform of filters.platforms) {
        queryParams.push(`%${platform.toLowerCase()}%`);
        conditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${queryParams.length}`);
      }
    }

    if (typeof filters?.is_free === 'boolean') {
      queryParams.push(filters.is_free);
      conditions.push(`a.is_free = $${queryParams.length}`);
    }

    if (typeof filters?.max_price_cents === 'number') {
      queryParams.push(filters.max_price_cents);
      conditions.push(`COALESCE(a.current_price_cents, 0) <= $${queryParams.length}`);
    }

    if (typeof filters?.min_reviews === 'number') {
      queryParams.push(filters.min_reviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) >= $${queryParams.length}`);
    }

    if (typeof filters?.max_reviews === 'number') {
      queryParams.push(filters.max_reviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) <= $${queryParams.length}`);
    }

    if (filters?.review_percentage?.gte != null) {
      queryParams.push(filters.review_percentage.gte);
      conditions.push(`COALESCE(${reviewPercentageSql('ldm')}, 0) >= $${queryParams.length}`);
    }

    if (filters?.review_percentage?.lte != null) {
      queryParams.push(filters.review_percentage.lte);
      conditions.push(`COALESCE(${reviewPercentageSql('ldm')}, 0) <= $${queryParams.length}`);
    }

    if (filters?.release_year?.gte != null) {
      queryParams.push(filters.release_year.gte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${queryParams.length}`);
    }

    if (filters?.release_year?.lte != null) {
      queryParams.push(filters.release_year.lte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${queryParams.length}`);
    }

    if (filters?.genres?.length) {
      queryParams.push(filters.genres.map((genre) => genre.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (filters?.tags?.length) {
      queryParams.push(filters.tags.map((tag) => tag.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (filters?.steam_deck?.length) {
      queryParams.push(filters.steam_deck);
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamDeckTable} asd_filter
          WHERE asd_filter.appid = a.appid
            AND asd_filter.category::text = ANY($${queryParams.length}::text[])
        )`
      );
    }

    const signalClauses: string[] = [];

    if (params.reference.developerIds.length > 0) {
      queryParams.push(params.reference.developerIds);
      signalClauses.push(
        `EXISTS (
          SELECT 1
          FROM ${appDevelopersTable} ad
          WHERE ad.appid = a.appid
            AND ad.developer_id = ANY($${queryParams.length}::int[])
        )`
      );
    }

    if (params.reference.publisherIds.length > 0) {
      queryParams.push(params.reference.publisherIds);
      signalClauses.push(
        `EXISTS (
          SELECT 1
          FROM ${appPublishersTable} ap
          WHERE ap.appid = a.appid
            AND ap.publisher_id = ANY($${queryParams.length}::int[])
        )`
      );
    }

    if (params.reference.genres.length > 0) {
      queryParams.push(params.reference.genres.map((genre) => genre.toLowerCase()));
      signalClauses.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (params.reference.tags.length > 0) {
      queryParams.push(params.reference.tags.map((tag) => tag.toLowerCase()));
      signalClauses.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (signalClauses.length > 0) {
      conditions.push(`(${signalClauses.join(' OR ')})`);
    }

    queryParams.push(params.limit);

    const result = await runQuery<SemanticGameCandidateRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.type::text AS type,
          a.is_free,
          a.platforms,
          a.current_price_cents,
          ldm.positive_percentage,
          ldm.total_reviews,
          ${steamDeckSelect} AS steam_deck_category,
          COALESCE((
            SELECT array_agg(DISTINCT ap.publisher_id ORDER BY ap.publisher_id)
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
          ), ARRAY[]::int[]) AS publisher_ids,
          COALESCE((
            SELECT array_agg(DISTINCT ad.developer_id ORDER BY ad.developer_id)
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
          ), ARRAY[]::int[]) AS developer_ids,
          COALESCE((
            SELECT array_agg(DISTINCT sg.name ORDER BY sg.name)
            FROM ${appGenresTable} ag
            JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
            WHERE ag.appid = a.appid
          ), ARRAY[]::text[]) AS genres,
          COALESCE((
            SELECT array_agg(DISTINCT st.name ORDER BY st.name)
            FROM ${appSteamTagsTable} ast
            JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
            WHERE ast.appid = a.appid
          ), ARRAY[]::text[]) AS tags
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, COALESCE(ldm.ccu_peak, 0) DESC, a.name ASC
        LIMIT $${queryParams.length}
      `,
      queryParams,
      this.config
    );

    return result.rows;
  }

  private async queryTigerConceptGameCandidates(params: {
    description: string;
    filters: SemanticSearchFilters | undefined;
    limit: number;
    terms: string[];
  }): Promise<SemanticGameCandidateRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const steamDeckSelect = params.filters?.steam_deck?.length
      ? `(SELECT asd.category::text FROM ${appSteamDeckTable} asd WHERE asd.appid = a.appid LIMIT 1)`
      : 'NULL::text';
    const queryParams: unknown[] = [];
    const conditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (params.filters?.platforms?.length) {
      for (const platform of params.filters.platforms) {
        queryParams.push(`%${platform.toLowerCase()}%`);
        conditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${queryParams.length}`);
      }
    }

    if (typeof params.filters?.is_free === 'boolean') {
      queryParams.push(params.filters.is_free);
      conditions.push(`a.is_free = $${queryParams.length}`);
    }

    if (typeof params.filters?.max_price_cents === 'number') {
      queryParams.push(params.filters.max_price_cents);
      conditions.push(`COALESCE(a.current_price_cents, 0) <= $${queryParams.length}`);
    }

    if (typeof params.filters?.min_reviews === 'number') {
      queryParams.push(params.filters.min_reviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) >= $${queryParams.length}`);
    }

    if (typeof params.filters?.max_reviews === 'number') {
      queryParams.push(params.filters.max_reviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) <= $${queryParams.length}`);
    }

    if (params.filters?.review_percentage?.gte != null) {
      queryParams.push(params.filters.review_percentage.gte);
      conditions.push(`COALESCE(ldm.positive_percentage, 0) >= $${queryParams.length}`);
    }

    if (params.filters?.review_percentage?.lte != null) {
      queryParams.push(params.filters.review_percentage.lte);
      conditions.push(`COALESCE(ldm.positive_percentage, 0) <= $${queryParams.length}`);
    }

    if (params.filters?.release_year?.gte != null) {
      queryParams.push(params.filters.release_year.gte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${queryParams.length}`);
    }

    if (params.filters?.release_year?.lte != null) {
      queryParams.push(params.filters.release_year.lte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${queryParams.length}`);
    }

    if (params.filters?.genres?.length) {
      queryParams.push(params.filters.genres.map((genre) => genre.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (params.filters?.tags?.length) {
      queryParams.push(params.filters.tags.map((tag) => tag.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${queryParams.length}::text[])
        )`
      );
    }

    if (params.filters?.steam_deck?.length) {
      queryParams.push(params.filters.steam_deck);
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamDeckTable} asd_filter
          WHERE asd_filter.appid = a.appid
            AND asd_filter.category::text = ANY($${queryParams.length}::text[])
        )`
      );
    }

    const termPatterns = params.terms.map((term) => `%${term}%`);
    queryParams.push(termPatterns);
    const namePatternParam = queryParams.length;
    queryParams.push(params.terms);
    const exactTermParam = queryParams.length;

    conditions.push(
      `(
        lower(a.name) LIKE ANY($${namePatternParam}::text[])
        OR EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${exactTermParam}::text[])
        )
        OR EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${exactTermParam}::text[])
        )
      )`
    );

    queryParams.push(params.limit);

    const result = await runQuery<SemanticGameCandidateRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.type::text AS type,
          a.is_free,
          a.platforms,
          a.current_price_cents,
          ldm.positive_percentage,
          ldm.total_reviews,
          ${steamDeckSelect} AS steam_deck_category,
          ARRAY[]::int[] AS publisher_ids,
          ARRAY[]::int[] AS developer_ids,
          COALESCE((
            SELECT array_agg(DISTINCT sg.name ORDER BY sg.name)
            FROM ${appGenresTable} ag
            JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
            WHERE ag.appid = a.appid
          ), ARRAY[]::text[]) AS genres,
          COALESCE((
            SELECT array_agg(DISTINCT st.name ORDER BY st.name)
            FROM ${appSteamTagsTable} ast
            JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
            WHERE ast.appid = a.appid
          ), ARRAY[]::text[]) AS tags
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, COALESCE(ldm.ccu_peak, 0) DESC, a.name ASC
        LIMIT $${queryParams.length}
      `,
      queryParams,
      this.config
    );

    return result.rows;
  }

  private async queryTigerSemanticCompanyCandidates(params: {
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>;
    filters: SemanticSearchFilters | undefined;
    limit: number;
    reference: TigerSemanticCompanyProfile;
  }): Promise<SemanticCompanyCandidateRow[]> {
    const companyTable = this.relation(params.entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      params.entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = params.entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const queryParams: unknown[] = [params.reference.id];
    const filters = params.filters;
    const whereConditions: string[] = ['c.id <> $1'];
    const havingConditions: string[] = ['COUNT(DISTINCT a.appid) > 0'];
    const weightedReviewExpression = `CASE
      WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
        THEN ROUND(
          (
            SUM(COALESCE(ldm.positive_percentage, 0) * COALESCE(ldm.total_reviews, 0))::numeric
            / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
          ),
          2
        )::double precision
      ELSE NULL
    END`;

    if (filters?.game_count?.gte != null) {
      queryParams.push(filters.game_count.gte);
      havingConditions.push(`COUNT(DISTINCT a.appid) >= $${queryParams.length}`);
    }
    if (filters?.game_count?.lte != null) {
      queryParams.push(filters.game_count.lte);
      havingConditions.push(`COUNT(DISTINCT a.appid) <= $${queryParams.length}`);
    }
    if (filters?.avg_review_percentage?.gte != null) {
      queryParams.push(filters.avg_review_percentage.gte);
      havingConditions.push(`${weightedReviewExpression} >= $${queryParams.length}`);
    }
    if (filters?.avg_review_percentage?.lte != null) {
      queryParams.push(filters.avg_review_percentage.lte);
      havingConditions.push(`${weightedReviewExpression} <= $${queryParams.length}`);
    }
    if (filters?.is_major === true) {
      havingConditions.push('COUNT(DISTINCT a.appid) >= 50');
    }
    if (filters?.is_indie === true) {
      havingConditions.push('COUNT(DISTINCT a.appid) <= 15');
    }

    queryParams.push(params.limit);

    const result = await runQuery<SemanticCompanyCandidateRow>(
      `
        SELECT
          c.id,
          c.name,
          COUNT(DISTINCT a.appid)::int AS game_count,
          ${weightedReviewExpression} AS avg_review_percentage,
          SUM(COALESCE(ldm.total_reviews, 0))::double precision AS total_reviews,
          COALESCE((
            SELECT array_agg(top_genres.name ORDER BY top_genres.cnt DESC, top_genres.name ASC)
            FROM (
              SELECT sg.name, COUNT(*)::int AS cnt
              FROM ${relationTable} rel2
              JOIN ${appsTable} a2
                ON a2.appid = rel2.appid
               AND a2.is_delisted = false
               AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
              JOIN ${appGenresTable} ag ON ag.appid = a2.appid
              JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
              WHERE rel2.${relationColumn} = c.id
              GROUP BY sg.name
              ORDER BY cnt DESC, sg.name ASC
              LIMIT 5
            ) top_genres
          ), ARRAY[]::text[]) AS top_genres,
          COALESCE((
            SELECT array_agg(top_tags.name ORDER BY top_tags.cnt DESC, top_tags.name ASC)
            FROM (
              SELECT st.name, COUNT(*)::int AS cnt
              FROM ${relationTable} rel2
              JOIN ${appsTable} a2
                ON a2.appid = rel2.appid
               AND a2.is_delisted = false
               AND ${GAME_TYPE_PREDICATE[this.config.source].replace(/\ba\./g, 'a2.')}
              JOIN ${appSteamTagsTable} ast ON ast.appid = a2.appid
              JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
              WHERE rel2.${relationColumn} = c.id
              GROUP BY st.name
              ORDER BY cnt DESC, st.name ASC
              LIMIT 5
            ) top_tags
          ), ARRAY[]::text[]) AS top_tags
        FROM ${companyTable} c
        LEFT JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
        LEFT JOIN ${appsTable} a
          ON a.appid = rel.appid
         AND a.is_delisted = false
         AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE ${whereConditions.join('\n          AND ')}
        GROUP BY c.id, c.name
        HAVING ${havingConditions.join('\n          AND ')}
        ORDER BY COUNT(DISTINCT a.appid) DESC, SUM(COALESCE(ldm.total_reviews, 0)) DESC, c.name ASC
        LIMIT $${queryParams.length}
      `,
      queryParams,
      this.config
    );

    return result.rows;
  }

  private async queryGames(query: string, limit: number): Promise<EntityRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const fuzzyThreshold = 0.45;
    const sql = `
      SELECT
        a.appid AS entity_id,
        a.name AS display_name,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ${reviewPercentageSql('ldm')} AS review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak,
        CASE
          WHEN lower(a.name) = lower($1) THEN 'exact'
          WHEN lower(a.name) LIKE lower($2) THEN 'prefix'
          WHEN lower(a.name) LIKE lower($3) THEN 'substring'
          ELSE 'fuzzy'
        END AS match_quality,
        similarity(lower(a.name), lower($1)) AS similarity_score
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE a.is_delisted = false
        AND (
          lower(a.name) = lower($1)
          OR lower(a.name) LIKE lower($2)
          OR lower(a.name) LIKE lower($3)
          OR similarity(lower(a.name), lower($1)) >= $4
        )
      ORDER BY
        CASE
          WHEN lower(a.name) = lower($1) THEN 4
          WHEN lower(a.name) LIKE lower($2) THEN 3
          WHEN lower(a.name) LIKE lower($3) THEN 2
          ELSE 1
        END DESC,
        similarity(lower(a.name), lower($1)) DESC,
        COALESCE(ldm.total_reviews, 0) DESC,
        a.name ASC
      LIMIT $5
    `;

    const result = await runQuery<EntityRow>(
      sql,
      [query, `${query}%`, normalizeLikeValue(query), fuzzyThreshold, limit],
      this.config
    );

    return result.rows;
  }

  private async queryGamesLexical(query: string, limit: number): Promise<EntityRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const lexicalPatterns = buildLexicalLikePatterns(query);
    if (lexicalPatterns.length === 0) {
      return [];
    }

    const sql = `
      SELECT
        a.appid AS entity_id,
        a.name AS display_name,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ${reviewPercentageSql('ldm')} AS review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak,
        CASE
          WHEN lower(a.name) = lower($1) THEN 'exact'
          WHEN lower(a.name) LIKE lower($2) THEN 'prefix'
          WHEN to_tsvector('simple', lower(a.name)) @@ websearch_to_tsquery('simple', $1) THEN 'substring'
          ELSE 'fuzzy'
        END AS match_quality,
        GREATEST(
          COALESCE(ts_rank_cd(to_tsvector('simple', lower(a.name)), websearch_to_tsquery('simple', $1)), 0),
          COALESCE(similarity(lower(a.name), lower($1)), 0)
        ) AS similarity_score
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE a.is_delisted = false
        AND ${GAME_TYPE_PREDICATE[this.config.source]}
        AND (
          to_tsvector('simple', lower(a.name)) @@ websearch_to_tsquery('simple', $1)
          OR lower(a.name) LIKE ANY($3::text[])
        )
      ORDER BY
        CASE
          WHEN lower(a.name) = lower($1) THEN 4
          WHEN lower(a.name) LIKE lower($2) THEN 3
          WHEN to_tsvector('simple', lower(a.name)) @@ websearch_to_tsquery('simple', $1) THEN 2
          ELSE 1
        END DESC,
        similarity_score DESC,
        COALESCE(ldm.total_reviews, 0) DESC,
        a.name ASC
      LIMIT $4
    `;

    const result = await runQuery<EntityRow>(
      sql,
      [query, `${query}%`, lexicalPatterns, limit],
      this.config
    );

    return result.rows;
  }

  private async queryChangeEvents(
    appid: number,
    startTime: string,
    endTime: string,
    sources: string[],
    changeTypes: string[]
  ): Promise<ChangeEventRow[]> {
    const eventsTable = this.relation('events_app_change_events').sql;
    const params: unknown[] = [appid, startTime, endTime];
    const conditions = [
      'appid = $1',
      'occurred_at BETWEEN $2::timestamptz AND $3::timestamptz',
    ];

    if (sources.length > 0) {
      params.push(sources);
      conditions.push(`lower(source::text) = ANY($${params.length}::text[])`);
    }

    if (changeTypes.length > 0) {
      params.push(changeTypes);
      conditions.push(`lower(change_type::text) = ANY($${params.length}::text[])`);
    }

    const result = await runQuery<ChangeEventRow>(
      `
        SELECT
          id::text AS id,
          source::text AS source,
          change_type::text AS change_type,
          occurred_at::text,
          news_item_gid,
          before_value,
          after_value,
          context
        FROM ${eventsTable}
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY occurred_at DESC, id DESC
      `,
      params,
      this.config
    );

    return result.rows;
  }

  private buildExplainMoments(
    events: ChangeEventRow[],
    limit: number
  ): ExplainMomentAccumulator[] {
    const moments: ExplainMomentAccumulator[] = [];

    for (const event of events) {
      const occurredAt = parseTimestamp(event.occurred_at);
      const currentMoment = moments.at(-1);

      if (
        currentMoment &&
        currentMoment.windowStart.getTime() - occurredAt.getTime() <= EXPLAIN_CHANGE_MOMENT_GAP_MS
      ) {
        currentMoment.events.push(event);
        currentMoment.windowStart = occurredAt;

        if (event.news_item_gid) {
          currentMoment.directNewsGids.add(event.news_item_gid);
        }

        continue;
      }

      moments.push({
        directNewsGids: new Set(event.news_item_gid ? [event.news_item_gid] : []),
        events: [event],
        linkedNews: [],
        windowEnd: occurredAt,
        windowStart: occurredAt,
      });

      if (moments.length >= limit) {
        break;
      }
    }

    return moments;
  }

  private async attachExplainNews(
    appid: number,
    moments: ExplainMomentAccumulator[]
  ): Promise<void> {
    const directNewsGids = [...new Set(moments.flatMap((moment) => [...moment.directNewsGids]))];
    const earliestMomentStart = moments.reduce(
      (earliest, moment) =>
        moment.windowStart.getTime() < earliest.getTime() ? moment.windowStart : earliest,
      moments[0]!.windowStart
    );
    const latestMomentEnd = moments.reduce(
      (latest, moment) =>
        moment.windowEnd.getTime() > latest.getTime() ? moment.windowEnd : latest,
      moments[0]!.windowEnd
    );

    const newsRows = await this.queryExplainNewsRows(
      appid,
      directNewsGids,
      formatTimestamp(addHours(earliestMomentStart, -24)),
      formatTimestamp(addHours(latestMomentEnd, 24))
    );
    const newsByGid = new Map(newsRows.map((row) => [row.gid, row]));

    for (const moment of moments) {
      const linkedNews: ExplainChangesLinkedNewsItem[] = [];
      const seenGids = new Set<string>();
      const directMatches = [...moment.directNewsGids]
        .map((gid) => newsByGid.get(gid))
        .filter((row): row is ExplainNewsRow => Boolean(row))
        .sort(
          (left, right) =>
            parseTimestamp(right.sort_time).getTime() - parseTimestamp(left.sort_time).getTime()
        );

      for (const row of directMatches) {
        linkedNews.push(this.mapExplainNews(row));
        seenGids.add(row.gid);
      }

      if (linkedNews.length < 3) {
        const nearbyCandidates = newsRows
          .filter((row) => !seenGids.has(row.gid))
          .filter((row) => {
            const sortTime = parseTimestamp(row.sort_time).getTime();
            return (
              sortTime >= moment.windowStart.getTime() - EXPLAIN_NEWS_PROXIMITY_MS &&
              sortTime <= moment.windowEnd.getTime() + EXPLAIN_NEWS_PROXIMITY_MS
            );
          })
          .sort(
            (left, right) =>
              parseTimestamp(right.sort_time).getTime() - parseTimestamp(left.sort_time).getTime()
          )
          .slice(0, 3 - linkedNews.length);

        for (const row of nearbyCandidates) {
          linkedNews.push(this.mapExplainNews(row));
          seenGids.add(row.gid);
        }
      }

      moment.linkedNews = linkedNews;
    }
  }

  private async queryExplainNewsRows(
    appid: number,
    directNewsGids: string[],
    windowStart: string,
    windowEnd: string
  ): Promise<ExplainNewsRow[]> {
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const newsProjectionTable = this.relation('docs_steam_news_search_projection').sql;
    const result = await runQuery<ExplainNewsRow>(
      `
        SELECT
          n.gid,
          n.url,
          n.feedlabel,
          n.feedname,
          n.published_at::text,
          n.first_seen_at::text,
          COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at))::text AS sort_time,
          p.feed_scope,
          p.title
        FROM ${newsItemsTable} n
        LEFT JOIN ${newsProjectionTable} p ON p.gid = n.gid
        WHERE (
          cardinality($2::text[]) > 0
          AND n.gid = ANY($2::text[])
        )
          OR (
            n.appid = $1
            AND COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at))
              BETWEEN $3::timestamptz AND $4::timestamptz
          )
        ORDER BY COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at)) DESC, n.gid DESC
      `,
      [appid, directNewsGids, windowStart, windowEnd],
      this.config
    );

    return result.rows;
  }

  private buildExplainMomentMetadata(moment: ExplainMomentAccumulator): Pick<
    ExplainChangesMoment,
    'burstStrength' | 'linkedNewsCount' | 'significanceReasons'
  > {
    const families = normalizeChangeSignalFamilies(
      [...new Set(moment.events.map((event) => event.change_type))]
        .map((changeType) => this.familyForChangeType(changeType))
    );
    const evidence = this.buildChangeEvidenceSummary({
      eventCount: moment.events.length,
      families,
      hasBeforeAfter: moment.events.some(
        (event) => event.before_value != null || event.after_value != null
      ),
      relatedAnnouncementCount: moment.linkedNews.length,
      windowEnd: moment.windowEnd,
      windowStart: moment.windowStart,
    });

    return {
      burstStrength: evidence.burstStrength,
      linkedNewsCount: moment.linkedNews.length,
      significanceReasons: evidence.significanceReasons,
    };
  }

  private pickStrongestExplainMoment(
    moments: ExplainChangesMoment[]
  ): ExplainChangesMoment | null {
    if (moments.length === 0) {
      return null;
    }

    return [...moments].sort((left, right) => {
      const rightStrength = right.burstStrength === 'high' ? 3 : right.burstStrength === 'medium' ? 2 : 1;
      const leftStrength = left.burstStrength === 'high' ? 3 : left.burstStrength === 'medium' ? 2 : 1;

      return (
        rightStrength - leftStrength
        || right.eventCount - left.eventCount
        || (right.linkedNewsCount ?? 0) - (left.linkedNewsCount ?? 0)
        || parseTimestamp(right.windowEnd).getTime() - parseTimestamp(left.windowEnd).getTime()
      );
    })[0] ?? null;
  }

  private async querySearchDocumentRows(params: {
    appidFilter: number | null;
    appids?: number[] | null;
    endTime: string;
    feedScopes: string[];
    limit: number;
    query: string;
    startTime: string;
  }): Promise<SearchDocumentRow[]> {
    const projectionTable = this.relation('docs_steam_news_search_projection').sql;
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const appsTable = this.relation('apps').sql;
    const normalizedQuery = params.query.replace(/\s+/g, ' ').trim();
    const sqlParams: unknown[] = [normalizedQuery, params.startTime, params.endTime];
    const conditions = [
      'projection.sort_time BETWEEN $2::timestamptz AND $3::timestamptz',
      "projection.search_document @@ websearch_to_tsquery('english', $1::text)",
    ];

    if (params.feedScopes.length > 0) {
      sqlParams.push(params.feedScopes);
      conditions.push(`lower(projection.feed_scope) = ANY($${sqlParams.length}::text[])`);
    }

    if (params.appidFilter !== null) {
      sqlParams.push(params.appidFilter);
      conditions.push(`projection.appid = $${sqlParams.length}`);
    } else if (params.appids && params.appids.length > 0) {
      sqlParams.push(params.appids);
      conditions.push(`projection.appid = ANY($${sqlParams.length}::int[])`);
    }

    sqlParams.push(normalizeLikeValue(normalizedQuery));
    const titleLikeParam = sqlParams.length;
    sqlParams.push(normalizedQuery.toLowerCase());
    const exactTitleParam = sqlParams.length;
    sqlParams.push(params.limit);
    const limitParam = sqlParams.length;

    const result = await runQuery<SearchDocumentRow>(
      `
        SELECT
          projection.gid,
          projection.appid,
          apps.name AS app_name,
          projection.published_at::text,
          projection.first_seen_at::text,
          projection.sort_time::text,
          projection.feed_scope,
          projection.title,
          news.feedlabel,
          news.feedname,
          news.url,
          ts_rank_cd(
            projection.search_document,
            websearch_to_tsquery('english', $1::text)
          )::double precision AS rank,
          lower(COALESCE(projection.title, '')) = $${exactTitleParam} AS title_exact_hit,
          lower(COALESCE(projection.title, '')) LIKE $${titleLikeParam} AS title_phrase_hit,
          lower(COALESCE(apps.name, '')) LIKE $${titleLikeParam} AS app_name_hit,
          NULL::text AS body_preview,
          NULLIF(
            BTRIM(
              CONCAT_WS(
                ' — ',
                NULLIF(BTRIM(projection.title), ''),
                NULLIF(BTRIM(COALESCE(news.feedlabel, news.feedname)), ''),
                NULLIF(BTRIM(apps.name), '')
              )
            ),
            ''
          ) AS content_preview,
          NULLIF(
            BTRIM(
              ts_headline(
                'english',
                COALESCE(NULLIF(BTRIM(projection.title), ''), apps.name, ''),
                websearch_to_tsquery('english', $1::text),
                'StartSel=, StopSel=, MaxWords=18, MinWords=4, MaxFragments=1'
              )
            ),
            ''
          ) AS excerpt,
          CASE
            WHEN lower(COALESCE(projection.title, '')) = $${exactTitleParam} THEN 'matched_exact_title'
            WHEN lower(COALESCE(projection.title, '')) LIKE $${titleLikeParam} THEN 'matched_title_phrase'
            WHEN lower(COALESCE(apps.name, '')) LIKE $${titleLikeParam} THEN 'matched_app_name'
            ELSE 'matched_topic_terms'
          END AS match_reason,
          CASE
            WHEN lower(COALESCE(projection.title, '')) = $${exactTitleParam} THEN 'exact title match'
            WHEN lower(COALESCE(projection.title, '')) LIKE $${titleLikeParam} THEN 'title matched the topic terms'
            WHEN lower(COALESCE(apps.name, '')) LIKE $${titleLikeParam} THEN 'game name matched the topic terms'
            ELSE 'topic terms matched the news projection'
          END AS ranking_reason
        FROM ${projectionTable} projection
        JOIN ${newsItemsTable} news ON news.gid = projection.gid
        JOIN ${appsTable} apps ON apps.appid = projection.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY
          title_exact_hit DESC,
          title_phrase_hit DESC,
          app_name_hit DESC,
          rank DESC,
          projection.sort_time DESC,
          projection.gid DESC
        LIMIT $${limitParam}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async querySearchDocumentRowsLexicalFallback(params: {
    appidFilter: number | null;
    appids?: number[] | null;
    endTime: string;
    feedScopes: string[];
    limit: number;
    query: string;
    startTime: string;
  }): Promise<SearchDocumentRow[]> {
    const projectionTable = this.relation('docs_steam_news_search_projection').sql;
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const appsTable = this.relation('apps').sql;
    const normalizedQuery = params.query.replace(/\s+/g, ' ').trim().toLowerCase();
    const lexicalPatterns = buildLexicalLikePatterns(normalizedQuery);
    if (!normalizedQuery || lexicalPatterns.length === 0) {
      return [];
    }

    const sqlParams: unknown[] = [normalizedQuery, params.startTime, params.endTime, lexicalPatterns];
    const conditions = [
      'projection.sort_time BETWEEN $2::timestamptz AND $3::timestamptz',
      `(
        lower(COALESCE(projection.title, '')) LIKE ANY($4::text[])
        OR lower(COALESCE(apps.name, '')) LIKE ANY($4::text[])
      )`,
    ];

    if (params.feedScopes.length > 0) {
      sqlParams.push(params.feedScopes);
      conditions.push(`lower(projection.feed_scope) = ANY($${sqlParams.length}::text[])`);
    }

    if (params.appidFilter !== null) {
      sqlParams.push(params.appidFilter);
      conditions.push(`projection.appid = $${sqlParams.length}`);
    } else if (params.appids && params.appids.length > 0) {
      sqlParams.push(params.appids);
      conditions.push(`projection.appid = ANY($${sqlParams.length}::int[])`);
    }

    sqlParams.push(normalizeLikeValue(normalizedQuery));
    const phraseParam = sqlParams.length;
    sqlParams.push(params.limit);
    const limitParam = sqlParams.length;

    const result = await runQuery<SearchDocumentRow>(
      `
        SELECT
          projection.gid,
          projection.appid,
          apps.name AS app_name,
          projection.published_at::text,
          projection.first_seen_at::text,
          projection.sort_time::text,
          projection.feed_scope,
          projection.title,
          news.feedlabel,
          news.feedname,
          news.url,
          0.35::double precision AS rank,
          lower(COALESCE(projection.title, '')) = $1 AS title_exact_hit,
          lower(COALESCE(projection.title, '')) LIKE $${phraseParam} AS title_phrase_hit,
          lower(COALESCE(apps.name, '')) LIKE $${phraseParam} AS app_name_hit,
          NULL::text AS body_preview,
          NULLIF(
            BTRIM(
              CONCAT_WS(
                ' — ',
                NULLIF(BTRIM(projection.title), ''),
                NULLIF(BTRIM(COALESCE(news.feedlabel, news.feedname)), ''),
                NULLIF(BTRIM(apps.name), '')
              )
            ),
            ''
          ) AS content_preview,
          NULLIF(BTRIM(COALESCE(projection.title, apps.name)), '') AS excerpt,
          CASE
            WHEN lower(COALESCE(projection.title, '')) = $1 THEN 'matched_exact_title'
            WHEN lower(COALESCE(projection.title, '')) LIKE $${phraseParam} THEN 'matched_title_phrase'
            ELSE 'matched_app_name'
          END AS match_reason,
          CASE
            WHEN lower(COALESCE(projection.title, '')) = $1 THEN 'lexical exact title fallback'
            WHEN lower(COALESCE(projection.title, '')) LIKE $${phraseParam} THEN 'lexical title fallback'
            ELSE 'lexical app-name fallback'
          END AS ranking_reason
        FROM ${projectionTable} projection
        JOIN ${newsItemsTable} news ON news.gid = projection.gid
        JOIN ${appsTable} apps ON apps.appid = projection.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY
          title_exact_hit DESC,
          title_phrase_hit DESC,
          app_name_hit DESC,
          projection.sort_time DESC,
          projection.gid DESC
        LIMIT $${limitParam}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryLatestEntityDocumentRows(params: {
    appidFilter: number;
    endTime: string;
    feedScopes: string[];
    limit: number;
    startTime: string;
  }): Promise<SearchDocumentRow[]> {
    const projectionTable = this.relation('docs_steam_news_search_projection').sql;
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const appsTable = this.relation('apps').sql;
    const sqlParams: unknown[] = [params.appidFilter, params.startTime, params.endTime];
    const conditions = [
      'projection.appid = $1',
      'projection.sort_time BETWEEN $2::timestamptz AND $3::timestamptz',
    ];

    if (params.feedScopes.length > 0) {
      sqlParams.push(params.feedScopes);
      conditions.push(`lower(projection.feed_scope) = ANY($${sqlParams.length}::text[])`);
    }

    sqlParams.push(params.limit);

    const result = await runQuery<SearchDocumentRow>(
      `
        SELECT
          projection.gid,
          projection.appid,
          apps.name AS app_name,
          projection.published_at::text,
          projection.first_seen_at::text,
          projection.sort_time::text,
          projection.feed_scope,
          projection.title,
          news.feedlabel,
          news.feedname,
          news.url,
          0::double precision AS rank,
          false AS title_exact_hit,
          false AS title_phrase_hit,
          false AS app_name_hit,
          NULL::text AS body_preview,
          NULLIF(
            BTRIM(
              CONCAT_WS(
                ' — ',
                NULLIF(BTRIM(projection.title), ''),
                NULLIF(BTRIM(COALESCE(news.feedlabel, news.feedname)), ''),
                NULLIF(BTRIM(apps.name), '')
              )
            ),
            ''
          ) AS content_preview,
          NULLIF(BTRIM(COALESCE(projection.title, apps.name)), '') AS excerpt,
          'recent_entity_news'::text AS match_reason,
          'latest entity coverage fallback'::text AS ranking_reason
        FROM ${projectionTable} projection
        JOIN ${newsItemsTable} news ON news.gid = projection.gid
        JOIN ${appsTable} apps ON apps.appid = projection.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY
          projection.sort_time DESC,
          projection.gid DESC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private buildTigerActivityId(
    activityKind: 'announcement' | 'change',
    appid: number,
    windowStart: Date,
    windowEnd: Date
  ): string {
    return `${activityKind}:${appid}:${windowStart.getTime()}:${windowEnd.getTime()}`;
  }

  private parseTigerActivityId(activityId: string): ParsedTigerActivityId | null {
    const parts = activityId.trim().split(':');
    if (parts.length !== 4) {
      return null;
    }

    const [activityKind, appidRaw, windowStartRaw, windowEndRaw] = parts;
    if (activityKind !== 'announcement' && activityKind !== 'change') {
      return null;
    }

    const appid = Number.parseInt(appidRaw, 10);
    const windowStartMs = Number.parseInt(windowStartRaw, 10);
    const windowEndMs = Number.parseInt(windowEndRaw, 10);

    if (
      !Number.isInteger(appid) ||
      appid <= 0 ||
      !Number.isFinite(windowStartMs) ||
      !Number.isFinite(windowEndMs) ||
      windowEndMs < windowStartMs
    ) {
      return null;
    }

    return {
      activityKind,
      appid,
      windowEnd: new Date(windowEndMs),
      windowStart: new Date(windowStartMs),
    };
  }

  private familyForChangeType(changeType: string): ChangeActivitySignalFamily {
    return CHANGE_TYPE_TO_SIGNAL_FAMILY[changeType] ?? 'store-page';
  }

  private familyMatchesSearchFilter(
    changeType: string,
    signalFamilies: ChangeActivitySignalFamily[]
  ): boolean {
    return signalFamilies.length === 0 || signalFamilies.includes(this.familyForChangeType(changeType));
  }

  private changeTypesForSignalFamilies(
    signalFamilies: ChangeActivitySignalFamily[]
  ): string[] {
    if (signalFamilies.length === 0) {
      return [];
    }

    return [...new Set(signalFamilies.flatMap((family) => CHANGE_TYPES_BY_SIGNAL_FAMILY[family] ?? []))];
  }

  private defaultSignalFamiliesForSearchChangeView(
    view: ChangeActivityView
  ): ChangeActivitySignalFamily[] {
    if (view === 'store-refreshes') {
      return ['store-page', 'media'];
    }

    if (view === 'commercial-moves') {
      return ['pricing', 'announcement', 'store-page', 'media'];
    }

    if (view === 'launch-watch') {
      return ['release', 'platform', 'build', 'announcement'];
    }

    return [];
  }

  private signalFamiliesForChangePattern(
    pattern: ChangePattern
  ): ChangeActivitySignalFamily[] {
    switch (pattern) {
      case 'marketing_push':
        return ['pricing', 'announcement', 'media', 'store-page'];
      case 'relaunch_pattern':
        return ['pricing', 'announcement', 'media', 'store-page', 'release', 'platform'];
      case 'update_tease':
        return ['announcement', 'media', 'store-page', 'build'];
      case 'under_marketed':
      case 'signable_candidate':
        return ['build', 'announcement', 'media', 'store-page'];
      case 'rescue_candidate':
        return ['pricing', 'announcement', 'media', 'store-page'];
      case 'sustained_response':
        return ['pricing', 'media', 'store-page', 'build', 'release', 'platform', 'taxonomy'];
      case 'announcement_weak_response':
        return ['announcement', 'pricing', 'media', 'store-page'];
      default:
        return [];
    }
  }

  private matchesSearchChangeView(
    families: ChangeActivitySignalFamily[],
    isReleased: boolean | null,
    view: ChangeActivityView
  ): boolean {
    if (view === 'all-activity' || view === 'overview') {
      return true;
    }

    if (view === 'store-refreshes') {
      return families.includes('media') || families.includes('store-page');
    }

    if (view === 'commercial-moves') {
      return (
        families.includes('pricing') ||
        families.includes('announcement') ||
        families.includes('media') ||
        families.includes('store-page')
      );
    }

    return (
      isReleased === false ||
      families.includes('release') ||
      families.includes('platform') ||
      families.includes('build')
    );
  }

  private classifySearchChangeStoryKind(params: {
    activityKind: 'announcement' | 'change';
    families: ChangeActivitySignalFamily[];
    isReleased: boolean | null;
    relatedAnnouncementCount: number;
  }): ChangeActivityStoryKind {
    const { activityKind, families, isReleased, relatedAnnouncementCount } = params;

    if (activityKind === 'announcement' && families.length === 1 && families[0] === 'announcement') {
      return 'announcement';
    }

    if (
      isReleased === false ||
      families.includes('release') ||
      families.includes('platform')
    ) {
      return 'launch-prep';
    }

    if (families.includes('taxonomy')) {
      return 'taxonomy-shift';
    }

    if (families.includes('build')) {
      return 'update-tease';
    }

    if (families.includes('pricing') && relatedAnnouncementCount > 0) {
      return 'commercial-move';
    }

    if (families.includes('media') || families.includes('store-page')) {
      return 'store-refresh';
    }

    return 'change-roundup';
  }

  private buildSearchChangeHeadline(params: {
    activityKind: 'announcement' | 'change';
    appName: string;
    directNews: ExplainNewsRow[];
    families: ChangeActivitySignalFamily[];
    storyKind: ChangeActivityStoryKind;
  }): string {
    if (params.activityKind === 'announcement' && params.directNews[0]?.title) {
      return params.directNews[0].title;
    }

    if (params.storyKind === 'launch-prep') {
      return `${params.appName} showed launch-adjacent Steam changes.`;
    }

    if (params.storyKind === 'commercial-move') {
      return `${params.appName} showed a commercial or marketing move on Steam.`;
    }

    if (params.storyKind === 'store-refresh') {
      return `${params.appName} refreshed its Steam page presentation.`;
    }

    if (params.storyKind === 'taxonomy-shift') {
      return `${params.appName} changed tags, genres, or platform positioning.`;
    }

    if (params.storyKind === 'update-tease') {
      return `${params.appName} showed update-adjacent Steam activity.`;
    }

    if (params.families.includes('announcement')) {
      return `${params.appName} mixed announcement activity with Steam page changes.`;
    }

    return `${params.appName} showed recent Steam change activity.`;
  }

  private pickStrongestChangeSignal(
    families: ChangeActivitySignalFamily[]
  ): ChangeActivitySignalFamily | null {
    const priority: ChangeActivitySignalFamily[] = [
      'release',
      'pricing',
      'announcement',
      'build',
      'platform',
      'media',
      'store-page',
      'taxonomy',
    ];

    return priority.find((family) => families.includes(family)) ?? families[0] ?? null;
  }

  private buildChangeEvidenceSummary(params: {
    eventCount: number;
    families: ChangeActivitySignalFamily[];
    hasBeforeAfter: boolean;
    relatedAnnouncementCount: number;
    windowEnd: Date;
    windowStart: Date;
  }): ChangeEvidenceSummary {
    const strongestSignal = this.pickStrongestChangeSignal(params.families);
    const windowHours = Math.max(
      (params.windowEnd.getTime() - params.windowStart.getTime()) / (60 * 60 * 1000),
      1
    );
    const density = params.eventCount / windowHours;
    let relevanceScore =
      params.eventCount * 1.8
      + params.families.length * 1.4
      + Math.min(params.relatedAnnouncementCount, 2) * 1.7
      + (params.hasBeforeAfter ? 1.2 : 0)
      + Math.min(density, 4);

    if (strongestSignal === 'release' || strongestSignal === 'pricing') {
      relevanceScore += 1.2;
    } else if (strongestSignal === 'announcement' || strongestSignal === 'build') {
      relevanceScore += 0.8;
    }

    if (
      params.relatedAnnouncementCount > 0
      && (params.families.includes('pricing') || params.families.includes('media') || params.families.includes('store-page'))
    ) {
      relevanceScore += 1;
    }

    const burstStrength: ChangeBurstStrength =
      relevanceScore >= 11
        ? 'high'
        : relevanceScore >= 6.5
          ? 'medium'
          : 'low';

    const significanceReasons: string[] = [];
    if (params.eventCount >= 4) {
      significanceReasons.push(`${params.eventCount} tracked events landed in the same update window.`);
    }
    if (params.families.length >= 2) {
      significanceReasons.push(`Multiple signal families moved together: ${params.families.join(', ')}.`);
    }
    if (params.relatedAnnouncementCount > 0) {
      significanceReasons.push(
        `${params.relatedAnnouncementCount} linked announcement${params.relatedAnnouncementCount === 1 ? '' : 's'} line up with the same window.`
      );
    }
    if (params.hasBeforeAfter) {
      significanceReasons.push('Structured before/after values are available for drilldown.');
    }

    let relevanceReason = 'recent Steam change activity';
    if (
      params.relatedAnnouncementCount > 0
      && (params.families.includes('pricing') || params.families.includes('media') || params.families.includes('store-page'))
    ) {
      relevanceReason = 'an announcement-linked commercial or marketing update';
    } else if (params.families.includes('release') || params.families.includes('platform')) {
      relevanceReason = 'a launch-adjacent update burst';
    } else if (params.families.includes('pricing')) {
      relevanceReason = 'a commercial storefront move';
    } else if (params.families.includes('build') && params.families.includes('announcement')) {
      relevanceReason = 'an update tease backed by announcement activity';
    } else if (params.families.includes('media') || params.families.includes('store-page')) {
      relevanceReason = 'a store presentation refresh';
    } else if (params.families.length >= 2) {
      relevanceReason = 'a multi-signal Steam update';
    } else if (strongestSignal) {
      relevanceReason = `${strongestSignal.replace(/-/g, ' ')} change activity`;
    }

    return {
      burstStrength,
      relevanceReason,
      relevanceScore: Number(relevanceScore.toFixed(2)),
      significanceReasons: significanceReasons.slice(0, 3),
      strongestSignal,
    };
  }

  private buildSearchChangeFacts(params: {
    directNews: ExplainNewsRow[];
    eventCount: number;
    families: ChangeActivitySignalFamily[];
    hasBeforeAfter: boolean;
    relevanceReason?: string | null;
    relatedAnnouncementCount: number;
    windowEnd: Date;
    windowStart: Date;
  }): string[] {
    const facts: string[] = [
      `${params.eventCount} tracked change event${params.eventCount === 1 ? '' : 's'} in this activity window.`,
      `Window: ${formatTimestamp(params.windowStart)} to ${formatTimestamp(params.windowEnd)}.`,
    ];

    if (params.relevanceReason) {
      facts.push(`Why it stands out: ${params.relevanceReason}.`);
    }
    if (params.families.length > 0) {
      facts.push(`Signals: ${params.families.join(', ')}.`);
    }
    if (params.relatedAnnouncementCount > 0) {
      facts.push(`${params.relatedAnnouncementCount} related announcement${params.relatedAnnouncementCount === 1 ? '' : 's'} linked to the same window.`);
    }
    if (params.hasBeforeAfter) {
      facts.push('Structured before/after values are available for drilldown.');
    }
    if (params.directNews[0]?.title) {
      facts.push(`Headline evidence: ${params.directNews[0].title}.`);
    }

    return facts.slice(0, 4);
  }

  private buildSearchChangeSummary(params: {
    activityKind: 'announcement' | 'change';
    appName: string;
    directNews: ExplainNewsRow[];
    families: ChangeActivitySignalFamily[];
    relevanceReason?: string | null;
    relatedAnnouncementCount: number;
  }): string {
    if (params.activityKind === 'announcement' && params.directNews[0]?.title) {
      return `${params.appName} has recent Steam announcement activity led by "${params.directNews[0].title}".`;
    }

    const signalLabel =
      params.families.length > 0 ? params.families.join(', ') : 'general Steam page';
    const announcementClause =
      params.relatedAnnouncementCount > 0
        ? ` with ${params.relatedAnnouncementCount} linked announcement${params.relatedAnnouncementCount === 1 ? '' : 's'}`
        : ' without a linked announcement';

    if (params.relevanceReason) {
      return `${params.appName} showed ${params.relevanceReason}${announcementClause}.`;
    }

    return `${params.appName} showed ${signalLabel} changes${announcementClause}.`;
  }

  private buildSearchChangeHighlightLabels(params: {
    families: ChangeActivitySignalFamily[];
    relatedAnnouncementCount: number;
    storyKind: ChangeActivityStoryKind;
  }): string[] {
    const labels = new Set<string>();
    labels.add(params.storyKind.replace(/-/g, ' '));

    for (const family of params.families) {
      labels.add(family.replace(/-/g, ' '));
    }

    if (params.relatedAnnouncementCount > 0) {
      labels.add('announcement linked');
    }

    return [...labels].slice(0, 4);
  }

  private scoreSearchChangeActivityRow(
    row: ChangeActivityContractRow,
    sort: ChangeActivitySort
  ): number {
    const families = normalizeChangeSignalFamilies(row.signal_families);
    const occurredAtMs = parseTimestamp(row.occurred_at).getTime();
    const freshnessScore = occurredAtMs / 1_000_000_000_000;
    const commercialScore =
      (families.includes('pricing') ? 3 : 0)
      + (families.includes('media') || families.includes('store-page') ? 2 : 0)
      + Math.min(row.related_announcement_count ?? 0, 2);
    const launchScore =
      (families.includes('release') ? 3 : 0)
      + (families.includes('platform') ? 2 : 0)
      + (families.includes('build') ? 1 : 0)
      + (row.is_released === false ? 1 : 0);
    const impactScore =
      families.length
      + (row.has_before_after ? 1 : 0)
      + Math.min(row.related_announcement_count ?? 0, 2);
    const relevanceScore = row.relevance_score ?? (impactScore + commercialScore + launchScore);

    switch (sort) {
      case 'newest':
        return freshnessScore;
      case 'biggest-change':
        return (impactScore * 6 + relevanceScore * 4) + freshnessScore;
      case 'most-commercial':
        return (commercialScore * 8 + relevanceScore * 2) + freshnessScore;
      case 'most-launch-relevant':
        return (launchScore * 8 + relevanceScore * 2) + freshnessScore;
      case 'relevant':
      default:
        return relevanceScore * 5 + freshnessScore;
    }
  }

  private compareSearchChangeRows(
    left: ChangeActivityContractRow,
    right: ChangeActivityContractRow,
    sort: ChangeActivitySort
  ): number {
    const rightScore = this.scoreSearchChangeActivityRow(right, sort);
    const leftScore = this.scoreSearchChangeActivityRow(left, sort);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return (
      parseTimestamp(right.occurred_at).getTime() - parseTimestamp(left.occurred_at).getTime()
      || left.app_name.localeCompare(right.app_name)
    );
  }

  private async querySearchChangeEventRows(params: {
    allHistory?: boolean;
    appTypes: string[];
    changeTypes?: string[];
    days?: number;
    limit?: number;
    query: string | null;
    startTime?: string;
    endTime?: string;
    appid?: number;
    appids?: number[];
  }): Promise<SearchChangeEventRow[]> {
    const eventsTable = this.relation('events_app_change_events').sql;
    const appsTable = this.relation('apps').sql;
    const sqlParams: unknown[] = [];
    const conditions: string[] = [];
    const appids = normalizePositiveIntegers(params.appids);

    if (params.appid != null) {
      sqlParams.push(params.appid);
      conditions.push(`e.appid = $${sqlParams.length}`);
    } else if (appids.length > 0) {
      sqlParams.push(appids);
      conditions.push(`e.appid = ANY($${sqlParams.length}::int[])`);
    }

    if (params.startTime && params.endTime) {
      sqlParams.push(params.startTime);
      sqlParams.push(params.endTime);
      conditions.push(`e.occurred_at BETWEEN $${sqlParams.length - 1}::timestamptz AND $${sqlParams.length}::timestamptz`);
    } else if (!(params.allHistory && (params.appid != null || appids.length > 0))) {
      sqlParams.push(Math.max(1, Math.trunc(params.days ?? DEFAULT_CHANGE_ACTIVITY_DAYS)));
      conditions.push(`e.occurred_at >= NOW() - ($${sqlParams.length}::int * INTERVAL '1 day')`);
    }

    if (params.query) {
      sqlParams.push(normalizeLikeValue(params.query));
      conditions.push(`lower(a.name) LIKE $${sqlParams.length}`);
    }

    if (params.appTypes.length > 0) {
      sqlParams.push(params.appTypes);
      if (this.config.source === 'supabase-postgres') {
        conditions.push(`a.type = ANY($${sqlParams.length}::public.app_type[])`);
      } else {
        conditions.push(`a.type::text = ANY($${sqlParams.length}::text[])`);
      }
    }

    if (params.changeTypes && params.changeTypes.length > 0) {
      sqlParams.push(params.changeTypes);
      if (this.config.source === 'supabase-postgres') {
        conditions.push(`e.change_type = ANY($${sqlParams.length}::public.app_change_type[])`);
      } else {
        conditions.push(`e.change_type::text = ANY($${sqlParams.length}::text[])`);
      }
    }

    sqlParams.push(params.limit ?? 800);

    const result = await runQuery<SearchChangeEventRow>(
      `
        SELECT
          e.id::text AS id,
          e.appid,
          a.name AS app_name,
          a.type::text AS app_type,
          a.is_released,
          a.release_date::text AS release_date,
          e.source::text AS source,
          e.change_type::text AS change_type,
          e.occurred_at::text,
          e.news_item_gid,
          e.before_value,
          e.after_value,
          e.context
        FROM ${eventsTable} e
        JOIN ${appsTable} a ON a.appid = e.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryNewsRowsByGids(gids: string[]): Promise<ExplainNewsRow[]> {
    if (gids.length === 0) {
      return [];
    }

    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const newsProjectionTable = this.relation('docs_steam_news_search_projection').sql;
    const result = await runQuery<ExplainNewsRow>(
      `
        SELECT
          n.gid,
          n.url,
          n.feedlabel,
          n.feedname,
          n.published_at::text,
          n.first_seen_at::text,
          COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at))::text AS sort_time,
          p.feed_scope,
          p.title
        FROM ${newsItemsTable} n
        LEFT JOIN ${newsProjectionTable} p ON p.gid = n.gid
        WHERE n.gid = ANY($1::text[])
        ORDER BY COALESCE(p.sort_time, COALESCE(n.published_at, n.first_seen_at)) DESC, n.gid DESC
      `,
      [gids],
      this.config
    );

    return result.rows;
  }

  private buildSearchChangeMoments(
    rows: SearchChangeEventRow[]
  ): SearchChangeMomentAccumulator[] {
    const grouped = new Map<number, SearchChangeMomentAccumulator[]>();

    for (const row of rows) {
      const occurredAt = parseTimestamp(row.occurred_at);
      const appMoments = grouped.get(row.appid) ?? [];
      const currentMoment = appMoments.at(-1);

      if (
        currentMoment &&
        currentMoment.windowStart.getTime() - occurredAt.getTime() <= EXPLAIN_CHANGE_MOMENT_GAP_MS
      ) {
        currentMoment.events.push(row);
        currentMoment.windowStart = occurredAt;
        if (row.news_item_gid) {
          currentMoment.directNewsGids.add(row.news_item_gid);
        }
      } else {
        appMoments.push({
          appName: row.app_name,
          appType: row.app_type,
          appid: row.appid,
          directNewsGids: new Set(row.news_item_gid ? [row.news_item_gid] : []),
          events: [row],
          isReleased: row.is_released,
          linkedNews: [],
          releaseDate: row.release_date,
          windowEnd: occurredAt,
          windowStart: occurredAt,
        });
      }

      grouped.set(row.appid, appMoments);
    }

    return [...grouped.values()].flat();
  }

  private mapSearchChangeActivityItem(row: ChangeActivityContractRow): SearchChangeActivityItem {
    return {
      activityId: row.activity_id,
      activityKind: row.activity_kind,
      appType: row.app_type,
      appid: row.appid,
      burstStrength: row.burst_strength ?? undefined,
      externalUrl: row.external_url,
      facts: row.facts ?? [],
      hasBeforeAfter: row.has_before_after ?? false,
      headline: row.headline ?? `${row.app_name} showed recent Steam change activity.`,
      highlightLabels: row.highlight_labels ?? [],
      isReleased: row.is_released,
      name: row.app_name,
      occurredAt: formatTimestamp(parseTimestamp(row.occurred_at)),
      relevanceReason: row.relevance_reason ?? null,
      relevanceScore: row.relevance_score ?? null,
      relatedAnnouncementCount: row.related_announcement_count ?? 0,
      releaseDate: row.release_date,
      signalFamilies: normalizeChangeSignalFamilies(row.signal_families),
      storyKind: normalizeChangeStoryKind(row.story_kind),
      strongestSignal: row.strongest_signal ?? null,
      summary: row.summary ?? `${row.app_name} showed recent Steam change activity.`,
    };
  }

  private async querySearchChangeActivityRows(params: {
    activityId?: string | null;
    allHistory: boolean;
    appids: number[];
    appTypes: string[];
    days: number;
    query: string | null;
    signalFamilies: ChangeActivitySignalFamily[];
    view: ChangeActivityView;
  }): Promise<ChangeActivityContractRow[]> {
    const parsedActivityId = params.activityId ? this.parseTigerActivityId(params.activityId) : null;
    const changeTypes = this.changeTypesForSignalFamilies(
      params.signalFamilies.length > 0
        ? params.signalFamilies
        : this.defaultSignalFamiliesForSearchChangeView(params.view)
    );
    const rawRows = parsedActivityId
      ? await this.querySearchChangeEventRows({
          appTypes: params.appTypes,
          appid: parsedActivityId.appid,
          changeTypes,
          endTime: formatTimestamp(parsedActivityId.windowEnd),
          limit: 200,
          query: null,
          startTime: formatTimestamp(parsedActivityId.windowStart),
        })
      : await this.querySearchChangeEventRows({
          allHistory: params.allHistory,
          appids: params.appids,
          appTypes: params.appTypes,
          changeTypes,
          days: params.days,
          limit: 800,
          query: params.query,
        });

    const filteredRows = rawRows.filter((row) =>
      this.familyMatchesSearchFilter(row.change_type, params.signalFamilies)
    );
    const moments = this.buildSearchChangeMoments(filteredRows);
    const newsRows = await this.queryNewsRowsByGids(
      [...new Set(moments.flatMap((moment) => [...moment.directNewsGids]))]
    );
    const newsByGid = new Map(newsRows.map((row) => [row.gid, row]));

    const rows: ChangeActivityContractRow[] = [];

    for (const moment of moments) {
      const directNews = [...moment.directNewsGids]
        .map((gid) => newsByGid.get(gid))
        .filter((row): row is ExplainNewsRow => Boolean(row))
        .sort(
          (left, right) =>
            parseTimestamp(right.sort_time).getTime() - parseTimestamp(left.sort_time).getTime()
        );
      const families = [...new Set(
        moment.events.map((event) => this.familyForChangeType(event.change_type))
      )].sort();

      if (!this.matchesSearchChangeView(families, moment.isReleased, params.view)) {
        continue;
      }

      const relatedAnnouncementCount = directNews.length;
      const activityKind: 'announcement' | 'change' =
        parsedActivityId?.activityKind
        ?? (families.every((family) => family === 'announcement') ? 'announcement' : 'change');
      const storyKind = this.classifySearchChangeStoryKind({
        activityKind,
        families,
        isReleased: moment.isReleased,
        relatedAnnouncementCount,
      });
      const activityId = parsedActivityId
        ? params.activityId!
        : this.buildTigerActivityId(activityKind, moment.appid, moment.windowStart, moment.windowEnd);
      const hasBeforeAfter = moment.events.some(
        (event) => event.before_value != null || event.after_value != null
      );
      const headline = this.buildSearchChangeHeadline({
        activityKind,
        appName: moment.appName,
        directNews,
        families,
        storyKind,
      });
      const evidence = this.buildChangeEvidenceSummary({
        eventCount: moment.events.length,
        families,
        hasBeforeAfter,
        relatedAnnouncementCount,
        windowEnd: moment.windowEnd,
        windowStart: moment.windowStart,
      });
      const summary = this.buildSearchChangeSummary({
        activityKind,
        appName: moment.appName,
        directNews,
        families,
        relevanceReason: evidence.relevanceReason,
        relatedAnnouncementCount,
      });
      const facts = this.buildSearchChangeFacts({
        directNews,
        eventCount: moment.events.length,
        families,
        hasBeforeAfter,
        relevanceReason: evidence.relevanceReason,
        relatedAnnouncementCount,
        windowEnd: moment.windowEnd,
        windowStart: moment.windowStart,
      });
      const highlightLabels = this.buildSearchChangeHighlightLabels({
        families,
        relatedAnnouncementCount,
        storyKind,
      });
      const contractRow: ChangeActivityContractRow = {
        activity_id: activityId,
        activity_kind: activityKind,
        app_name: moment.appName,
        app_type: moment.appType,
        appid: moment.appid,
        external_url: directNews[0]?.url ?? null,
        facts,
        has_before_after: hasBeforeAfter,
        headline,
        highlight_labels: highlightLabels,
        is_released: moment.isReleased,
        occurred_at: formatTimestamp(moment.windowEnd),
        relevance_reason: evidence.relevanceReason,
        relevance_score: evidence.relevanceScore,
        related_announcement_count: relatedAnnouncementCount,
        release_date: moment.releaseDate,
        signal_families: families,
        sort_score: null,
        strongest_signal: evidence.strongestSignal,
        story_kind: storyKind,
        summary,
        burst_strength: evidence.burstStrength,
      };
      contractRow.sort_score = this.scoreSearchChangeActivityRow(contractRow, 'relevant');
      rows.push(contractRow);
    }

    return rows;
  }

  private async queryChangeBurstDetail(activityId: string): Promise<ChangeBurstDetailRow | null> {
    const parsed = this.parseTigerActivityId(activityId);
    if (!parsed) {
      return null;
    }

    const appsTable = this.relation('apps').sql;
    const appResult = await runQuery<{
      app_name: string;
      app_type: string | null;
      appid: number;
      is_released: boolean | null;
      release_date: string | null;
    }>(
      `
        SELECT
          appid,
          name AS app_name,
          type::text AS app_type,
          is_released,
          release_date::text AS release_date
        FROM ${appsTable}
        WHERE appid = $1
        LIMIT 1
      `,
      [parsed.appid],
      this.config
    );

    const app = appResult.rows[0];
    if (!app) {
      return null;
    }

    const events = await this.querySearchChangeEventRows({
      appTypes: [],
      appid: parsed.appid,
      endTime: formatTimestamp(parsed.windowEnd),
      limit: 200,
      query: null,
      startTime: formatTimestamp(parsed.windowStart),
    });
    const newsRows = await this.queryNewsRowsByGids(
      [...new Set(events.map((event) => event.news_item_gid).filter((gid): gid is string => Boolean(gid)))]
    );

    return {
      activity_kind: parsed.activityKind,
      app_name: app.app_name,
      app_type: app.app_type,
      appid: app.appid,
      burst_ended_at: formatTimestamp(parsed.windowEnd),
      burst_id: activityId,
      burst_started_at: formatTimestamp(parsed.windowStart),
      effective_at: formatTimestamp(parsed.windowEnd),
      events: events.map((event) => ({
        after_value: event.after_value,
        appid: event.appid,
        before_value: event.before_value,
        change_type: event.change_type,
        context: event.context,
        event_id: event.id,
        news_item_gid: event.news_item_gid,
        occurred_at: formatTimestamp(parseTimestamp(event.occurred_at)),
        source: event.source,
      })),
      headline_change_types: [...new Set(events.map((event) => event.change_type))],
      impact: null,
      is_released: app.is_released,
      related_news: newsRows.map((row) => ({
        appid: app.appid,
        app_name: app.app_name,
        app_type: app.app_type,
        feedlabel: row.feedlabel,
        feedname: row.feedname,
        first_seen_at: row.first_seen_at,
        gid: row.gid,
        published_at: row.published_at,
        title: row.title,
        url: row.url,
      })),
      release_date: app.release_date,
    };
  }

  private async queryLatestNewsDocumentRows(params: {
    appids: number[] | null;
    endTime: string;
    feedScopes: string[];
    limit: number;
    startTime: string;
  }): Promise<SearchDocumentRow[]> {
    const projectionTable = this.relation('docs_steam_news_search_projection').sql;
    const newsItemsTable = this.relation('docs_steam_news_items').sql;
    const appsTable = this.relation('apps').sql;
    const sqlParams: unknown[] = [params.startTime, params.endTime];
    const conditions = ['projection.sort_time BETWEEN $1::timestamptz AND $2::timestamptz'];

    if (params.feedScopes.length > 0) {
      sqlParams.push(params.feedScopes);
      conditions.push(`lower(projection.feed_scope) = ANY($${sqlParams.length}::text[])`);
    }

    if (params.appids && params.appids.length > 0) {
      sqlParams.push(params.appids);
      conditions.push(`projection.appid = ANY($${sqlParams.length}::int[])`);
    }

    sqlParams.push(params.limit);

    const result = await runQuery<SearchDocumentRow>(
      `
        SELECT
          projection.gid,
          projection.appid,
          apps.name AS app_name,
          projection.published_at::text,
          projection.first_seen_at::text,
          projection.sort_time::text,
          projection.feed_scope,
          projection.title,
          news.feedlabel,
          news.feedname,
          news.url,
          0::double precision AS rank,
          false AS title_exact_hit,
          false AS title_phrase_hit,
          false AS app_name_hit,
          NULL::text AS body_preview,
          NULLIF(
            BTRIM(
              CONCAT_WS(
                ' — ',
                NULLIF(BTRIM(projection.title), ''),
                NULLIF(BTRIM(COALESCE(news.feedlabel, news.feedname)), ''),
                NULLIF(BTRIM(apps.name), '')
              )
            ),
            ''
          ) AS content_preview,
          NULLIF(BTRIM(COALESCE(projection.title, apps.name)), '') AS excerpt,
          'recent_entity_news'::text AS match_reason,
          'latest recent coverage'::text AS ranking_reason
        FROM ${projectionTable} projection
        JOIN ${newsItemsTable} news ON news.gid = projection.gid
        JOIN ${appsTable} apps ON apps.appid = projection.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY projection.sort_time DESC, projection.gid DESC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private mapSearchDocumentRow(row: SearchDocumentRow): SearchDocumentItem {
    const preview =
      truncatePreview(row.body_preview ?? row.content_preview ?? row.excerpt ?? row.title ?? null, 260);
    const excerpt =
      truncatePreview(row.excerpt ?? row.body_preview ?? row.content_preview ?? row.title ?? null, 180);
    const explicitMatchReason =
      row.match_reason === 'recent_entity_news'
        ? 'recent_entity_news'
        : row.match_reason === 'matched_exact_title'
          ? 'matched_exact_title'
          : row.match_reason === 'matched_app_name'
            ? 'matched_app_name'
        : row.title_phrase_hit
          ? 'matched_title_phrase'
          : 'matched_topic_terms';

    return {
      appName: row.app_name,
      appid: row.appid,
      bodyPreview: preview,
      entityUid: buildEntityUid('steam', 'game', String(row.appid)),
      excerpt,
      feedLabel: row.feedlabel,
      feedName: row.feedname,
      feedScope: row.feed_scope,
      firstSeenAt: formatTimestamp(parseTimestamp(row.first_seen_at)),
      gid: row.gid,
      matchReason: explicitMatchReason,
      publishedAt: row.published_at ? formatTimestamp(parseTimestamp(row.published_at)) : null,
      rank: row.rank,
      rankingReason: row.ranking_reason ?? null,
      sortTime: formatTimestamp(parseTimestamp(row.sort_time)),
      title: row.title,
      url: row.url,
    };
  }

  private async queryChangePatternCandidateRows(params: {
    appTypes: string[];
    days: number;
    pattern: ChangePattern;
    query: string | null;
  }): Promise<ChangePatternCandidateRow[]> {
    const activityRows = (
      await this.querySearchChangeActivityRows({
        allHistory: false,
        appids: [],
        appTypes: params.appTypes,
        days: params.days,
        query: params.query,
        signalFamilies: this.signalFamiliesForChangePattern(params.pattern),
        view: 'all-activity',
      })
    ).map((row) => this.mapSearchChangeActivityItem(row));

    const aggregates = new Map<number, {
      activityIds: string[];
      announcementCount: number;
      appName: string;
      appType: string | null;
      appid: number;
      changeCount: number;
      isReleased: boolean | null;
      latestOccurredAt: string;
      releaseDate: string | null;
      signalFamilies: Set<ChangeActivitySignalFamily>;
      storyKinds: Set<ChangeActivityStoryKind>;
    }>();

    for (const item of activityRows) {
      const aggregate: {
        activityIds: string[];
        announcementCount: number;
        appName: string;
        appType: string | null;
        appid: number;
        changeCount: number;
        isReleased: boolean | null;
        latestOccurredAt: string;
        releaseDate: string | null;
        signalFamilies: Set<ChangeActivitySignalFamily>;
        storyKinds: Set<ChangeActivityStoryKind>;
      } = aggregates.get(item.appid) ?? {
        activityIds: [],
        announcementCount: 0,
        appName: item.name,
        appType: item.appType,
        appid: item.appid,
        changeCount: 0,
        isReleased: item.isReleased,
        latestOccurredAt: item.occurredAt,
        releaseDate: item.releaseDate,
        signalFamilies: new Set<ChangeActivitySignalFamily>(),
        storyKinds: new Set<ChangeActivityStoryKind>(),
      };

      aggregate.activityIds.push(item.activityId);
      aggregate.changeCount += 1;
      aggregate.announcementCount += item.relatedAnnouncementCount;
      if (item.occurredAt > aggregate.latestOccurredAt) {
        aggregate.latestOccurredAt = item.occurredAt;
      }
      for (const family of item.signalFamilies) {
        aggregate.signalFamilies.add(family);
      }
      aggregate.storyKinds.add(item.storyKind);
      aggregates.set(item.appid, aggregate);
    }

    const metricsByApp = await this.queryChangePatternMetricsByApp([...aggregates.keys()]);

    return [...aggregates.values()].map((aggregate) => {
      const metrics = metricsByApp.get(aggregate.appid);
      return {
        activity_ids: aggregate.activityIds.slice(0, 5),
        announcement_count: aggregate.announcementCount,
        app_name: aggregate.appName,
        app_type: aggregate.appType,
        appid: aggregate.appid,
        ccu_peak: metrics?.ccu_peak ?? null,
        ccu_trend_7d_pct: metrics?.ccu_trend_7d_pct ?? null,
        change_count: aggregate.changeCount,
        discount_percent: metrics?.discount_percent ?? null,
        is_released: aggregate.isReleased,
        latest_occurred_at: aggregate.latestOccurredAt,
        positive_percentage: metrics?.positive_percentage ?? null,
        price_cents: metrics?.price_cents ?? null,
        release_date: aggregate.releaseDate,
        review_velocity_30d: metrics?.review_velocity_30d ?? null,
        review_velocity_7d: metrics?.review_velocity_7d ?? null,
        signal_families: [...aggregate.signalFamilies],
        story_kinds: [...aggregate.storyKinds],
        total_reviews: metrics?.total_reviews ?? null,
        trend_30d_direction: metrics?.trend_30d_direction ?? null,
      };
    });
  }

  private async queryChangePatternMetricsByApp(appids: number[]): Promise<Map<number, {
    ccu_peak: number | null;
    ccu_trend_7d_pct: number | null;
    discount_percent: number | null;
    positive_percentage: number | null;
    price_cents: number | null;
    review_velocity_30d: number | null;
    review_velocity_7d: number | null;
    total_reviews: number | null;
    trend_30d_direction: string | null;
  }>> {
    if (appids.length === 0) {
      return new Map();
    }

    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const metricsDailyMetricsTable = this.relation('metrics_daily_metrics').sql;
    const result = await runQuery<{
      appid: number;
      ccu_peak: number | null;
      ccu_trend_7d_pct: number | null;
      discount_percent: number | null;
      positive_percentage: number | null;
      price_cents: number | null;
      review_velocity_30d: number | null;
      review_velocity_7d: number | null;
      total_reviews: number | null;
      trend_30d_direction: string | null;
    }>(
      `
        WITH baseline7 AS (
          SELECT DISTINCT ON (dm.appid)
            dm.appid,
            dm.total_reviews,
            dm.ccu_peak
          FROM ${metricsDailyMetricsTable} dm
          WHERE dm.appid = ANY($1::int[])
            AND dm.metric_date <= CURRENT_DATE - INTERVAL '7 days'
          ORDER BY dm.appid, dm.metric_date DESC
        ),
        baseline30 AS (
          SELECT DISTINCT ON (dm.appid)
            dm.appid,
            dm.total_reviews,
            dm.ccu_peak
          FROM ${metricsDailyMetricsTable} dm
          WHERE dm.appid = ANY($1::int[])
            AND dm.metric_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY dm.appid, dm.metric_date DESC
        )
        SELECT
          a.appid,
          ldm.ccu_peak,
          CASE
            WHEN COALESCE(baseline7.ccu_peak, 0) > 0
              THEN ROUND((((COALESCE(ldm.ccu_peak, 0) - baseline7.ccu_peak)::numeric / baseline7.ccu_peak::numeric) * 100), 2)::double precision
            ELSE NULL
          END AS ccu_trend_7d_pct,
          a.current_discount_percent AS discount_percent,
          ldm.positive_percentage,
          a.current_price_cents AS price_cents,
          ROUND((GREATEST(COALESCE(ldm.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(ldm.total_reviews, 0)), 0)::numeric / 30), 2)::double precision AS review_velocity_30d,
          ROUND((GREATEST(COALESCE(ldm.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(ldm.total_reviews, 0)), 0)::numeric / 7), 2)::double precision AS review_velocity_7d,
          ldm.total_reviews,
          CASE
            WHEN COALESCE(baseline30.ccu_peak, 0) > 0 AND COALESCE(ldm.ccu_peak, 0) > baseline30.ccu_peak * 1.1 THEN 'up'
            WHEN COALESCE(baseline30.ccu_peak, 0) > 0 AND COALESCE(ldm.ccu_peak, 0) < baseline30.ccu_peak * 0.9 THEN 'down'
            ELSE 'stable'
          END AS trend_30d_direction
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN baseline7 ON baseline7.appid = a.appid
        LEFT JOIN baseline30 ON baseline30.appid = a.appid
        WHERE a.appid = ANY($1::int[])
      `,
      [appids],
      this.config
    );

    return new Map(result.rows.map((row) => [row.appid, row]));
  }

  private async mapDiscoverChangePatternItems(
    candidates: ChangePatternCandidateRow[],
    pattern: ChangePattern
  ): Promise<DiscoverChangePatternsResponse['items']> {
    const items: DiscoverChangePatternsResponse['items'] = [];

    for (const candidate of candidates) {
      const families = normalizeChangeSignalFamilies(candidate.signal_families);
      const storyKinds = normalizeChangeStoryKinds(candidate.story_kinds);
      const metrics = {
        ccuPeak: candidate.ccu_peak,
        ccuTrend7dPct: candidate.ccu_trend_7d_pct,
        discountPercent: candidate.discount_percent,
        positivePercentage: candidate.positive_percentage,
        priceCents: candidate.price_cents,
        reviewVelocity30d: candidate.review_velocity_30d,
        reviewVelocity7d: candidate.review_velocity_7d,
        totalReviews: candidate.total_reviews,
        trend30dDirection: candidate.trend_30d_direction,
      };

      let reasons: string[] = [];
      let confidence: 'high' | 'medium' | null = null;

      if (pattern === 'marketing_push') {
        if (
          (candidate.announcement_count ?? 0) > 0 &&
          families.includes('pricing') &&
          (families.includes('media') || families.includes('store-page'))
        ) {
          confidence = 'high';
          reasons = [
            'Announcement activity landed in the same recent window.',
            'Pricing or discount movement is visible.',
            'Store-page or media refresh activity is visible.',
          ];
        }
      } else if (pattern === 'relaunch_pattern') {
        if (
          families.includes('pricing') &&
          (families.includes('media') || families.includes('store-page')) &&
          ((candidate.announcement_count ?? 0) > 0 || storyKinds.includes('launch-prep'))
        ) {
          confidence = 'high';
          reasons = [
            'Pricing changed in the same window as presentation changes.',
            'Store-page or media refresh suggests a packaged beat.',
            'Launch-adjacent or announcement activity supports a relaunch interpretation.',
          ];
        }
      } else if (pattern === 'update_tease') {
        if (
          (candidate.announcement_count ?? 0) > 0 &&
          (families.includes('media') || families.includes('store-page')) &&
          !families.includes('build')
        ) {
          confidence = 'medium';
          reasons = [
            'Announcements are present without matching build activity yet.',
            'Presentation changes suggest setup or teasing behavior.',
          ];
        }
      } else if (pattern === 'under_marketed') {
        if (
          (metrics.positivePercentage ?? 0) >= 80 &&
          (metrics.totalReviews ?? 0) >= 200 &&
          ((metrics.reviewVelocity30d ?? 0) >= 1 || families.includes('build')) &&
          (candidate.announcement_count ?? 0) === 0 &&
          !families.includes('media') &&
          !families.includes('store-page')
        ) {
          confidence = 'medium';
          reasons = [
            `Review quality is ${Math.round(metrics.positivePercentage ?? 0)}% positive on ${Math.round(metrics.totalReviews ?? 0).toLocaleString()} reviews.`,
            'Recent build or review-velocity evidence suggests active product work.',
            'There is little recent announcement or storefront-refresh evidence.',
          ];
        }
      } else if (pattern === 'signable_candidate') {
        if (
          (metrics.positivePercentage ?? 0) >= 85 &&
          (metrics.totalReviews ?? 0) >= 300 &&
          ((metrics.reviewVelocity30d ?? 0) >= 1 || families.includes('build')) &&
          !families.includes('media') &&
          !families.includes('store-page')
        ) {
          confidence = 'medium';
          reasons = [
            `Review quality is ${Math.round(metrics.positivePercentage ?? 0)}% positive with ${Math.round(metrics.totalReviews ?? 0).toLocaleString()} reviews.`,
            'Recent activity suggests the product is still moving.',
            'Public marketing execution looks lighter than product quality would justify.',
          ];
        }
      } else if (pattern === 'rescue_candidate') {
        if (
          (metrics.positivePercentage ?? 0) >= 70 &&
          (metrics.totalReviews ?? 0) >= 100 &&
          families.includes('pricing') &&
          (metrics.trend30dDirection === 'down' || (metrics.ccuTrend7dPct ?? 0) < 0)
        ) {
          confidence = 'medium';
          reasons = [
            `Sentiment remains ${Math.round(metrics.positivePercentage ?? 0)}% positive on ${Math.round(metrics.totalReviews ?? 0).toLocaleString()} reviews.`,
            'Recent pricing or discount activity is visible.',
            'Trend data points to softening demand or momentum.',
          ];
        }
      } else if (pattern === 'sustained_response') {
        if ((metrics.reviewVelocity7d ?? 0) >= 1.5 || (metrics.ccuTrend7dPct ?? 0) >= 15) {
          confidence = (metrics.reviewVelocity7d ?? 0) >= 3 || (metrics.ccuTrend7dPct ?? 0) >= 30 ? 'high' : 'medium';
          reasons = [
            `7-day review velocity is ${roundNumber(metrics.reviewVelocity7d ?? 0, 2)} reviews/day after the change window.`,
            `7-day CCU trend is ${roundNumber(metrics.ccuTrend7dPct ?? 0, 1)}%.`,
          ];
        }
      } else if (pattern === 'announcement_weak_response') {
        if (
          (candidate.announcement_count ?? 0) > 0 &&
          ((metrics.reviewVelocity7d ?? 0) < 0.75 || (metrics.ccuTrend7dPct ?? 0) < 5)
        ) {
          confidence =
            (metrics.reviewVelocity7d ?? 0) < 0.4 && (metrics.ccuTrend7dPct ?? 0) < 2
              ? 'high'
              : 'medium';
          reasons = [
            'A recent announcement is attached to the same change window.',
            `7-day review velocity is only ${roundNumber(metrics.reviewVelocity7d ?? 0, 2)} reviews/day.`,
            `7-day CCU trend is ${roundNumber(metrics.ccuTrend7dPct ?? 0, 1)}%.`,
          ];
        }
      }

      if (!confidence) {
        continue;
      }

      const primaryProof =
        candidate.activity_ids?.[0]
          ? {
              activityId: candidate.activity_ids[0],
              facts: [
                `${candidate.change_count ?? 0} qualifying activity windows in scope.`,
                ...(candidate.announcement_count ?? 0) > 0
                  ? [`${candidate.announcement_count} linked announcements.`]
                  : [],
                ...(families.length > 0 ? [`Signals: ${families.join(', ')}.`] : []),
              ].slice(0, 3),
              headline: `${candidate.app_name} matched the ${pattern.replace(/_/g, ' ')} pattern.`,
              occurredAt: candidate.latest_occurred_at,
              signalFamilies: families,
              summary: `${candidate.app_name} showed recent change activity that fits the ${pattern.replace(/_/g, ' ')} pattern.`,
            }
          : null;

      items.push({
        activityIds: candidate.activity_ids ?? [],
        appType: candidate.app_type,
        appid: candidate.appid,
        confidence,
        metrics,
        name: candidate.app_name,
        occurredAt: candidate.latest_occurred_at,
        primaryProof,
        reasons,
        signalFamilies: families,
        storyKinds,
      });
    }

    return items;
  }

  private compareDiscoverChangePatternItems(
    left: DiscoverChangePatternsResponse['items'][number],
    right: DiscoverChangePatternsResponse['items'][number]
  ): number {
    if (left.confidence !== right.confidence) {
      return left.confidence === 'high' ? -1 : 1;
    }

    const rightReviews = right.metrics?.totalReviews ?? 0;
    const leftReviews = left.metrics?.totalReviews ?? 0;
    if (rightReviews !== leftReviews) {
      return rightReviews - leftReviews;
    }

    return right.occurredAt.localeCompare(left.occurredAt) || left.name.localeCompare(right.name);
  }

  private async queryCanonicalEntities(
    kind: EntityKind,
    query: string,
    limit: number,
    options: CanonicalEntityQueryOptions = {}
  ): Promise<EntityRow[]> {
    const terms = buildCanonicalLookupTerms(query);
    if (!terms) {
      return [];
    }

    const lexicalRows = await this.queryCanonicalEntitiesLexical(
      kind,
      terms,
      limit,
      options.lightweight ?? false
    );

    if (lexicalRows.length > 0 || options.allowFuzzyFallback === false) {
      return lexicalRows;
    }

    return this.queryCanonicalEntitiesFallback(
      kind,
      terms,
      limit,
      options.lightweight ?? false
    );
  }

  private async queryCanonicalEntitiesLexical(
    kind: EntityKind,
    terms: CanonicalLookupTerms,
    limit: number,
    lightweight: boolean
  ): Promise<EntityRow[]> {
    const entitiesTable = this.relation('core_entities').sql;
    const aliasesTable = this.relation('core_entity_aliases').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const platform = kind === 'game' ? 'steam' : 'publisheriq';
    const visibilityPredicate =
      kind === 'game'
        ? `
            AND COALESCE(e.metadata->>'type', '') = 'game'
            AND COALESCE((e.metadata->>'is_delisted')::boolean, false) = false
          `
        : '';
    const releaseYearSql =
      kind === 'game'
        ? `
            CASE
              WHEN COALESCE(e.metadata->>'release_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN EXTRACT(YEAR FROM ((e.metadata->>'release_date')::date))::int
              ELSE NULL::int
            END
          `
        : 'NULL::int';
    const gameCountSql =
      kind === 'game'
        ? 'NULL::int'
        : `
            CASE
              WHEN COALESCE(e.metadata->>'game_count', '') ~ '^\\d+$'
                THEN (e.metadata->>'game_count')::int
              ELSE NULL::int
            END
          `;
    const gameMetricSelect =
      kind === 'game'
        ? `
            ldm.ccu_peak,
            ldm.owners_midpoint,
            ${reviewPercentageSql('ldm')} AS review_score,
            ldm.total_reviews
          `
        : `
            NULL::double precision AS ccu_peak,
            NULL::double precision AS owners_midpoint,
            NULL::double precision AS review_score,
            NULL::double precision AS total_reviews
          `;
    const gameMetricJoin =
      kind === 'game'
        ? `LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = candidate.entity_id`
        : '';
    const totalReviewOrderSql =
      kind === 'game'
        ? 'COALESCE(ldm.total_reviews, 0)'
        : 'COALESCE(NULL::double precision, 0)';

    const result = await runQuery<EntityRow>(
      `
        WITH lexical_candidate_rows AS (
          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'platform_entity_id'::text AS match_source,
            'exact'::text AS match_quality,
            -1::int AS match_rank,
            'platform_id_exact'::text AS resolution_tier,
            0::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.platform_entity_id = $3

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            3::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.normalized_name = $4

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            3::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.loose_normalized_name = $5

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            3::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.compact_normalized_name = $6

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            'prefix'::text AS match_quality,
            3::int AS match_rank,
            'canonical_prefix'::text AS resolution_tier,
            5::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.loose_normalized_name LIKE $7

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            'prefix'::text AS match_quality,
            3::int AS match_rank,
            'canonical_prefix'::text AS resolution_tier,
            5::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(e.loose_normalized_name, $5), 0),
              COALESCE(similarity(e.compact_normalized_name, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND e.compact_normalized_name LIKE $8

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            4::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(alias_hit.loose_normalized_alias, $5), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND normalized_alias = $4
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            4::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(alias_hit.loose_normalized_alias, $5), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND loose_normalized_alias = $5
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            'exact'::text AS match_quality,
            2::int AS match_rank,
            'normalized_exact'::text AS resolution_tier,
            4::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(alias_hit.loose_normalized_alias, $5), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND compact_normalized_alias = $6
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            'prefix'::text AS match_quality,
            3::int AS match_rank,
            'alias_prefix'::text AS resolution_tier,
            6::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(alias_hit.loose_normalized_alias, $5), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND loose_normalized_alias LIKE $7
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            'prefix'::text AS match_quality,
            3::int AS match_rank,
            'alias_prefix'::text AS resolution_tier,
            6::int AS dedupe_rank,
            GREATEST(
              COALESCE(similarity(alias_hit.loose_normalized_alias, $5), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $6), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND compact_normalized_alias LIKE $8
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
        ),
        ranked_candidate_rows AS (
          SELECT
            lexical_candidate_rows.*,
            ROW_NUMBER() OVER (
              PARTITION BY entity_uid
              ORDER BY dedupe_rank ASC, similarity_score DESC, display_name ASC
            ) AS row_rank
          FROM lexical_candidate_rows
        ),
        candidate_entities AS (
          SELECT
            dedupe_rank,
            display_name,
            entity_id,
            entity_uid,
            game_count,
            match_quality,
            match_rank,
            match_source,
            matched_name,
            release_year,
            resolution_tier,
            similarity_score
          FROM ranked_candidate_rows
          WHERE row_rank = 1
        )
        SELECT
          ${gameMetricSelect},
          candidate.display_name,
          candidate.entity_id,
          candidate.game_count,
          candidate.match_quality,
          candidate.match_rank,
          candidate.match_source,
          candidate.matched_name,
          candidate.release_year,
          candidate.resolution_tier,
          candidate.similarity_score
        FROM candidate_entities candidate
        ${gameMetricJoin}
        ORDER BY
          candidate.match_rank ASC,
          candidate.dedupe_rank ASC,
          COALESCE(candidate.game_count, 0) DESC,
          COALESCE(candidate.release_year, 0) DESC,
          ${totalReviewOrderSql} DESC,
          candidate.display_name ASC
        LIMIT $9
      `,
      [
        kind,
        platform,
        terms.rawQuery,
        terms.normalizedQuery,
        terms.looseQuery,
        terms.compactQuery,
        terms.loosePrefix,
        terms.compactPrefix,
        limit,
      ],
      this.config
    );

    return result.rows;
  }

  private async queryCanonicalEntitiesFallback(
    kind: EntityKind,
    terms: CanonicalLookupTerms,
    limit: number,
    lightweight: boolean
  ): Promise<EntityRow[]> {
    const entitiesTable = this.relation('core_entities').sql;
    const aliasesTable = this.relation('core_entity_aliases').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const platform = kind === 'game' ? 'steam' : 'publisheriq';
    const fuzzyThreshold = kind === 'game' ? 0.45 : 0.4;
    const visibilityPredicate =
      kind === 'game'
        ? `
            AND COALESCE(e.metadata->>'type', '') = 'game'
            AND COALESCE((e.metadata->>'is_delisted')::boolean, false) = false
          `
        : '';
    const releaseYearSql =
      kind === 'game'
        ? `
            CASE
              WHEN COALESCE(e.metadata->>'release_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN EXTRACT(YEAR FROM ((e.metadata->>'release_date')::date))::int
              ELSE NULL::int
            END
          `
        : 'NULL::int';
    const gameCountSql =
      kind === 'game'
        ? 'NULL::int'
        : `
            CASE
              WHEN COALESCE(e.metadata->>'game_count', '') ~ '^\\d+$'
                THEN (e.metadata->>'game_count')::int
              ELSE NULL::int
            END
          `;
    const gameMetricSelect =
      kind === 'game'
        ? `
            ldm.ccu_peak,
            ldm.owners_midpoint,
            ${reviewPercentageSql('ldm')} AS review_score,
            ldm.total_reviews
          `
        : `
            NULL::double precision AS ccu_peak,
            NULL::double precision AS owners_midpoint,
            NULL::double precision AS review_score,
            NULL::double precision AS total_reviews
          `;
    const gameMetricJoin =
      kind === 'game'
        ? `LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = candidate.entity_id`
        : '';
    const totalReviewOrderSql =
      kind === 'game'
        ? 'COALESCE(ldm.total_reviews, 0)'
        : 'COALESCE(NULL::double precision, 0)';

    const result = await runQuery<EntityRow>(
      `
        WITH fallback_candidate_rows AS (
          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            e.canonical_name AS matched_name,
            'normalized_name'::text AS match_source,
            CASE
              WHEN e.loose_normalized_name LIKE $5 OR e.compact_normalized_name LIKE $6
                THEN 'substring'::text
              ELSE 'fuzzy'::text
            END AS match_quality,
            CASE
              WHEN e.loose_normalized_name LIKE $5 OR e.compact_normalized_name LIKE $6
                THEN 4::int
              ELSE 5::int
            END AS match_rank,
            CASE
              WHEN e.loose_normalized_name LIKE $5 OR e.compact_normalized_name LIKE $6
                THEN 'canonical_substring'::text
              ELSE 'fuzzy'::text
            END AS resolution_tier,
            CASE
              WHEN e.loose_normalized_name LIKE $5 OR e.compact_normalized_name LIKE $6
                THEN 7::int
              ELSE 8::int
            END AS dedupe_rank,
            GREATEST(
              CASE WHEN e.loose_normalized_name LIKE $5 THEN 1 ELSE 0 END,
              CASE WHEN e.compact_normalized_name LIKE $6 THEN 1 ELSE 0 END,
              COALESCE(similarity(e.loose_normalized_name, $3), 0),
              COALESCE(similarity(e.compact_normalized_name, $4), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM ${entitiesTable} e
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
            AND (
              e.loose_normalized_name LIKE $5
              OR e.compact_normalized_name LIKE $6
              OR GREATEST(
                COALESCE(similarity(e.loose_normalized_name, $3), 0),
                COALESCE(similarity(e.compact_normalized_name, $4), 0)
              ) >= $7
            )

          UNION ALL

          SELECT
            e.entity_uid,
            e.platform_entity_id::int AS entity_id,
            e.canonical_name AS display_name,
            alias_hit.alias AS matched_name,
            'normalized_alias'::text AS match_source,
            CASE
              WHEN alias_hit.loose_normalized_alias LIKE $5 OR alias_hit.compact_normalized_alias LIKE $6
                THEN 'substring'::text
              ELSE 'fuzzy'::text
            END AS match_quality,
            CASE
              WHEN alias_hit.loose_normalized_alias LIKE $5 OR alias_hit.compact_normalized_alias LIKE $6
                THEN 4::int
              ELSE 5::int
            END AS match_rank,
            CASE
              WHEN alias_hit.loose_normalized_alias LIKE $5 OR alias_hit.compact_normalized_alias LIKE $6
                THEN 'alias_substring'::text
              ELSE 'fuzzy'::text
            END AS resolution_tier,
            CASE
              WHEN alias_hit.loose_normalized_alias LIKE $5 OR alias_hit.compact_normalized_alias LIKE $6
                THEN 9::int
              ELSE 10::int
            END AS dedupe_rank,
            GREATEST(
              CASE WHEN alias_hit.loose_normalized_alias LIKE $5 THEN 1 ELSE 0 END,
              CASE WHEN alias_hit.compact_normalized_alias LIKE $6 THEN 1 ELSE 0 END,
              COALESCE(similarity(alias_hit.loose_normalized_alias, $3), 0),
              COALESCE(similarity(alias_hit.compact_normalized_alias, $4), 0)
            ) AS similarity_score,
            ${releaseYearSql} AS release_year,
            ${gameCountSql} AS game_count
          FROM (
            SELECT
              entity_uid,
              alias,
              loose_normalized_alias,
              compact_normalized_alias
            FROM ${aliasesTable}
            WHERE NULLIF(BTRIM(alias), '') IS NOT NULL
              AND (
                loose_normalized_alias LIKE $5
                OR compact_normalized_alias LIKE $6
                OR GREATEST(
                  COALESCE(similarity(loose_normalized_alias, $3), 0),
                  COALESCE(similarity(compact_normalized_alias, $4), 0)
                ) >= $7
              )
          ) alias_hit
          JOIN ${entitiesTable} e ON e.entity_uid = alias_hit.entity_uid
          WHERE e.entity_kind = $1
            AND e.platform = $2
            AND NULLIF(BTRIM(e.canonical_name), '') IS NOT NULL
            ${visibilityPredicate}
        ),
        ranked_candidate_rows AS (
          SELECT
            fallback_candidate_rows.*,
            ROW_NUMBER() OVER (
              PARTITION BY entity_uid
              ORDER BY dedupe_rank ASC, similarity_score DESC, display_name ASC
            ) AS row_rank
          FROM fallback_candidate_rows
        ),
        candidate_entities AS (
          SELECT
            dedupe_rank,
            display_name,
            entity_id,
            entity_uid,
            game_count,
            match_quality,
            match_rank,
            match_source,
            matched_name,
            release_year,
            resolution_tier,
            similarity_score
          FROM ranked_candidate_rows
          WHERE row_rank = 1
        )
        SELECT
          ${gameMetricSelect},
          candidate.display_name,
          candidate.entity_id,
          candidate.game_count,
          candidate.match_quality,
          candidate.match_rank,
          candidate.match_source,
          candidate.matched_name,
          candidate.release_year,
          candidate.resolution_tier,
          candidate.similarity_score
        FROM candidate_entities candidate
        ${gameMetricJoin}
        ORDER BY
          candidate.match_rank ASC,
          candidate.dedupe_rank ASC,
          COALESCE(candidate.game_count, 0) DESC,
          COALESCE(candidate.release_year, 0) DESC,
          ${totalReviewOrderSql} DESC,
          candidate.display_name ASC
        LIMIT $8
      `,
      [
        kind,
        platform,
        terms.looseQuery,
        terms.compactQuery,
        terms.looseSubstring,
        terms.compactSubstring,
        fuzzyThreshold,
        limit,
      ],
      this.config
    );

    return result.rows;
  }

  private async queryCompanies(
    kind: Extract<EntityKind, 'publisher' | 'developer'>,
    query: string,
    limit: number
  ): Promise<EntityRow[]> {
    const table = this.relation(kind === 'publisher' ? 'publishers' : 'developers').sql;
    const idColumn = kind === 'publisher' ? 'id' : 'id';
    const fuzzyThreshold = 0.45;
    const result = await runQuery<EntityRow>(
      `
        SELECT
          ${idColumn} AS entity_id,
          name AS display_name,
          game_count,
          CASE
            WHEN lower(name) = lower($1) THEN 'exact'
            WHEN lower(name) LIKE lower($2) THEN 'prefix'
            WHEN lower(name) LIKE lower($3) THEN 'substring'
            ELSE 'fuzzy'
          END AS match_quality,
          similarity(lower(name), lower($1)) AS similarity_score
        FROM ${table}
        WHERE
          lower(name) = lower($1)
          OR lower(name) LIKE lower($2)
          OR lower(name) LIKE lower($3)
          OR similarity(lower(name), lower($1)) >= $4
        ORDER BY
          CASE
            WHEN lower(name) = lower($1) THEN 4
            WHEN lower(name) LIKE lower($2) THEN 3
            WHEN lower(name) LIKE lower($3) THEN 2
            ELSE 1
          END DESC,
          similarity(lower(name), lower($1)) DESC,
          COALESCE(game_count, 0) DESC,
          name ASC
        LIMIT $5
      `,
      [query, `${query}%`, normalizeLikeValue(query), fuzzyThreshold, limit],
      this.config
    );

    return result.rows;
  }

  private async queryCompaniesLexical(
    kind: Extract<EntityKind, 'publisher' | 'developer'>,
    query: string,
    limit: number
  ): Promise<EntityRow[]> {
    const table = this.relation(kind === 'publisher' ? 'publishers' : 'developers').sql;
    const lexicalPatterns = buildLexicalLikePatterns(query);
    if (lexicalPatterns.length === 0) {
      return [];
    }

    const result = await runQuery<EntityRow>(
      `
        SELECT
          id AS entity_id,
          name AS display_name,
          game_count,
          CASE
            WHEN lower(name) = lower($1) THEN 'exact'
            WHEN lower(name) LIKE lower($2) THEN 'prefix'
            WHEN to_tsvector('simple', lower(name)) @@ websearch_to_tsquery('simple', $1) THEN 'substring'
            ELSE 'fuzzy'
          END AS match_quality,
          GREATEST(
            COALESCE(ts_rank_cd(to_tsvector('simple', lower(name)), websearch_to_tsquery('simple', $1)), 0),
            COALESCE(similarity(lower(name), lower($1)), 0)
          ) AS similarity_score
        FROM ${table}
        WHERE
          to_tsvector('simple', lower(name)) @@ websearch_to_tsquery('simple', $1)
          OR lower(name) LIKE ANY($3::text[])
        ORDER BY
          CASE
            WHEN lower(name) = lower($1) THEN 4
            WHEN lower(name) LIKE lower($2) THEN 3
            WHEN to_tsvector('simple', lower(name)) @@ websearch_to_tsquery('simple', $1) THEN 2
            ELSE 1
          END DESC,
          similarity_score DESC,
          COALESCE(game_count, 0) DESC,
          name ASC
        LIMIT $4
      `,
      [query, `${query}%`, lexicalPatterns, limit],
      this.config
    );

    return result.rows;
  }

  private async queryGameOverview(appid: number): Promise<EntityOverviewRow | null> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const publishersTable = this.relation('publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const developersTable = this.relation('developers').sql;
    const result = await runQuery<EntityOverviewRow>(
      `
        SELECT
          a.appid AS entity_id,
          a.appid,
          a.name AS display_name,
          a.type::text AS app_type,
          a.is_free,
          a.is_released,
          a.release_state,
          a.parent_appid,
          a.current_price_cents AS price_cents,
          a.current_discount_percent AS discount_percent,
          a.platforms,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.total_reviews,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.owners_midpoint,
          ldm.ccu_peak,
          NULL::int AS game_count,
          COALESCE((
            SELECT array_agg(DISTINCT ap.publisher_id ORDER BY ap.publisher_id)
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
          ), ARRAY[]::int[]) AS publisher_ids,
          COALESCE((
            SELECT array_agg(DISTINCT p.name ORDER BY p.name)
            FROM ${appPublishersTable} ap
            JOIN ${publishersTable} p ON p.id = ap.publisher_id
            WHERE ap.appid = a.appid
          ), ARRAY[]::text[]) AS publishers,
          COALESCE((
            SELECT array_agg(DISTINCT ad.developer_id ORDER BY ad.developer_id)
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
          ), ARRAY[]::int[]) AS developer_ids,
          COALESCE((
            SELECT array_agg(DISTINCT d.name ORDER BY d.name)
            FROM ${appDevelopersTable} ad
            JOIN ${developersTable} d ON d.id = ad.developer_id
            WHERE ad.appid = a.appid
          ), ARRAY[]::text[]) AS developers
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE a.appid = $1
        LIMIT 1
      `,
      [appid],
      this.config
    );

    return result.rows[0] ?? null;
  }

  private async queryCompanyOverview(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    entityId: number
  ): Promise<EntityOverviewRow | null> {
    const companyTable = this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const result = await runQuery<EntityOverviewRow>(
      `
        SELECT
          c.id AS entity_id,
          NULL::int AS appid,
          c.name AS display_name,
          NULL::text AS app_type,
          NULL::boolean AS is_free,
          NULL::boolean AS is_released,
          NULL::text AS release_state,
          NULL::int AS parent_appid,
          NULL::int AS price_cents,
          NULL::int AS discount_percent,
          NULL::text AS platforms,
          NULL::text AS release_date,
          NULL::int AS release_year,
          SUM(COALESCE(ldm.total_reviews, 0))::double precision AS total_reviews,
          CASE
            WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
              THEN ROUND(
                (
                  SUM(COALESCE(${reviewPercentageSql('ldm')}, 0) * COALESCE(ldm.total_reviews, 0))::numeric
                  / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
                ),
                2
              )::double precision
            ELSE NULL
          END AS review_score,
          SUM(COALESCE(ldm.owners_midpoint, 0))::double precision AS owners_midpoint,
          MAX(COALESCE(ldm.ccu_peak, 0))::double precision AS ccu_peak,
          COUNT(DISTINCT a.appid)::int AS game_count,
          ARRAY[]::int[] AS publisher_ids,
          ARRAY[]::text[] AS publishers,
          ARRAY[]::int[] AS developer_ids,
          ARRAY[]::text[] AS developers
        FROM ${companyTable} c
        LEFT JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
        LEFT JOIN ${appsTable} a
          ON a.appid = rel.appid
          AND a.is_delisted = false
          AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE c.id = $1
        GROUP BY c.id, c.name
        LIMIT 1
      `,
      [entityId],
      this.config
    );

    return result.rows[0] ?? null;
  }

  private async queryEntityOverviewGames(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    entityId: number,
    limit: number,
    sortBy: 'release_date' | 'reviews'
  ): Promise<EntityOverviewGameRow[]> {
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const orderClause =
      sortBy === 'reviews'
        ? `COALESCE(ldm.total_reviews, 0) DESC, COALESCE(${reviewPercentageSql('ldm')}, 0) DESC, COALESCE(ldm.owners_midpoint, 0) DESC, a.release_date DESC NULLS LAST, a.name ASC`
        : 'a.release_date DESC NULLS LAST, COALESCE(ldm.total_reviews, 0) DESC, a.name ASC';
    const result = await runQuery<EntityOverviewGameRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.total_reviews,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.owners_midpoint
        FROM ${relationTable} rel
        JOIN ${appsTable} a
          ON a.appid = rel.appid
          AND a.is_delisted = false
          AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE rel.${relationColumn} = $1
        ORDER BY ${orderClause}
        LIMIT $2
      `,
      [entityId, limit],
      this.config
    );

    return result.rows;
  }

  private mapRelatedEntityItem(row: RelatedEntityRow): RelatedEntityResultItem {
    return {
      appid: row.appid,
      entityUid: buildEntityUid('steam', 'game', String(row.appid)),
      name: row.name,
      releaseDate: row.release_date,
      releaseYear: row.release_year,
      reviewScore: normalizeReviewPercentageValue(row.positive_percentage ?? row.review_score),
      steamDeckCategory: row.steam_deck_category,
      totalReviews: row.total_reviews,
    };
  }

  private async querySteamDeckCategoryByApp(
    appid: number
  ): Promise<'playable' | 'verified' | 'unsupported' | 'unknown' | null> {
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const result = await runQuery<{ category: 'playable' | 'verified' | 'unsupported' | 'unknown' | null }>(
      `
        SELECT category::text AS category
        FROM ${appSteamDeckTable}
        WHERE appid = $1
        LIMIT 1
      `,
      [appid],
      this.config
    );

    return result.rows[0]?.category ?? null;
  }

  private async queryFranchiseNamesByApp(appid: number): Promise<string[]> {
    const appFranchisesTable = this.relation('app_franchises').sql;
    const franchisesTable = this.relation('franchises').sql;
    const result = await runQuery<{ name: string }>(
      `
        SELECT f.name
        FROM ${appFranchisesTable} af
        JOIN ${franchisesTable} f ON f.id = af.franchise_id
        WHERE af.appid = $1
        ORDER BY f.name ASC
      `,
      [appid],
      this.config
    );

    return result.rows
      .map((row) => row.name)
      .filter((name, index, values) => values.indexOf(name) === index);
  }

  private async lookupRelatedDlcRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceReviewScore: number | null;
  }): Promise<{
    items: RelatedEntityRow[];
    matchMode: GetRelatedEntitiesResponse['matchMode'];
    tables: string[];
    unresolvedAppids?: number[];
  }> {
    const exactTablesBlocked = await this.getBlockingTables(['app_dlc', 'app_steam_deck']);
    if (exactTablesBlocked.length === 0) {
      const exactRows = await this.queryRelatedDlcRows(params);
      if (exactRows.length > 0) {
        return {
          items: exactRows,
          matchMode: 'structured_relation',
          tables: [
            this.relation('apps').sql,
            this.relation('latest_daily_metrics').sql,
            this.relation('app_dlc').sql,
            this.relation('app_steam_deck').sql,
          ],
        };
      }
    }

    const fallbackRows = await this.queryRelatedDlcRowsFromApps(params);
    if (fallbackRows.length > 0) {
      return {
        items: fallbackRows,
        matchMode: 'parent_appid',
        tables: [
          this.relation('apps').sql,
          this.relation('latest_daily_metrics').sql,
          this.relation('app_steam_deck').sql,
        ],
      };
    }

    const unresolvedRelationBlocked = await this.getBlockingTables(['app_dlc']);
    if (unresolvedRelationBlocked.length > 0) {
      return {
        items: [],
        matchMode: 'parent_appid',
        tables: [
          this.relation('apps').sql,
          this.relation('latest_daily_metrics').sql,
          this.relation('app_steam_deck').sql,
        ],
      };
    }

    const unresolvedAppids = await this.queryRelatedDlcAppids(params.sourceAppid, params.limit);
    return {
      items: [],
      matchMode: unresolvedAppids.length > 0 ? 'relation_ids_only' : 'parent_appid',
      tables: [this.relation('app_dlc').sql],
      ...(unresolvedAppids.length > 0 ? { unresolvedAppids } : {}),
    };
  }

  private async lookupRelatedFranchiseRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceDeveloperIds: number[];
    sourceName: string;
    sourcePublisherIds: number[];
    sourceReviewScore: number | null;
  }): Promise<{
    items: RelatedEntityRow[];
    matchMode: GetRelatedEntitiesResponse['matchMode'];
    tables: string[];
    unresolvedAppids?: number[];
  }> {
    const exactTablesBlocked = await this.getBlockingTables(['app_franchises', 'franchises', 'app_steam_deck']);
    if (exactTablesBlocked.length === 0) {
      const exactRows = await this.queryRelatedFranchiseRows(params);
      if (exactRows.length > 0) {
        return {
          items: exactRows,
          matchMode: 'structured_relation',
          tables: [
            this.relation('apps').sql,
            this.relation('latest_daily_metrics').sql,
            this.relation('app_franchises').sql,
            this.relation('franchises').sql,
            this.relation('app_steam_deck').sql,
          ],
        };
      }
    }

    return {
      items: await this.queryRelatedTitleFamilyRows(params),
      matchMode: 'title_family',
      tables: [
        this.relation('apps').sql,
        this.relation('latest_daily_metrics').sql,
        this.relation('app_publishers').sql,
        this.relation('app_developers').sql,
        this.relation('app_steam_deck').sql,
      ],
    };
  }

  private async queryRelatedEntityRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    relationKind: RelatedEntityKind;
    sourceAppid: number;
    sourceReviewScore: number | null;
  }): Promise<RelatedEntityRow[]> {
    if (params.relationKind === 'dlc') {
      return this.queryRelatedDlcRows(params);
    }

    return this.queryRelatedFranchiseRows(params);
  }

  private async queryRelatedDlcRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceReviewScore: number | null;
  }): Promise<RelatedEntityRow[]> {
    const appDlcTable = this.relation('app_dlc').sql;
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const sqlParams: unknown[] = [params.sourceAppid];
    const conditions: string[] = [
      'a.is_delisted = false',
    ];

    if (typeof params.filters?.minReviewScore === 'number') {
      sqlParams.push(params.filters.minReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} >= $${sqlParams.length}`);
    }

    if (params.filters?.reviewComparison === 'better_only' && typeof params.sourceReviewScore === 'number') {
      sqlParams.push(params.sourceReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} > $${sqlParams.length}`);
    }

    if (params.filters?.steamDeck?.length) {
      sqlParams.push(params.filters.steamDeck);
      conditions.push(`COALESCE(asd.category::text, 'unknown') = ANY($${sqlParams.length}::text[])`);
    }

    sqlParams.push(params.limit);

    const result = await runQuery<RelatedEntityRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.positive_percentage,
          ldm.total_reviews,
          asd.category::text AS steam_deck_category,
          NULL::text AS franchise_name
        FROM ${appDlcTable} ad
        JOIN ${appsTable} a ON a.appid = ad.dlc_appid
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN ${appSteamDeckTable} asd ON asd.appid = a.appid
        WHERE ad.parent_appid = $1
          AND ${conditions.join('\n          AND ')}
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, a.release_date DESC NULLS LAST, a.name ASC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryRelatedDlcRowsFromApps(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceReviewScore: number | null;
  }): Promise<RelatedEntityRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const sqlParams: unknown[] = [params.sourceAppid];
    const conditions: string[] = [
      'a.parent_appid = $1',
      'a.is_delisted = false',
    ];

    if (typeof params.filters?.minReviewScore === 'number') {
      sqlParams.push(params.filters.minReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} >= $${sqlParams.length}`);
    }

    if (params.filters?.reviewComparison === 'better_only' && typeof params.sourceReviewScore === 'number') {
      sqlParams.push(params.sourceReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} > $${sqlParams.length}`);
    }

    if (params.filters?.steamDeck?.length) {
      sqlParams.push(params.filters.steamDeck);
      conditions.push(`COALESCE(asd.category::text, 'unknown') = ANY($${sqlParams.length}::text[])`);
    }

    sqlParams.push(params.limit);

    const result = await runQuery<RelatedEntityRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.positive_percentage,
          ldm.total_reviews,
          asd.category::text AS steam_deck_category,
          NULL::text AS franchise_name
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN ${appSteamDeckTable} asd ON asd.appid = a.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, a.release_date DESC NULLS LAST, a.name ASC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryRelatedDlcAppids(sourceAppid: number, limit: number): Promise<number[]> {
    const appDlcTable = this.relation('app_dlc').sql;
    const result = await runQuery<{ dlc_appid: number }>(
      `
        SELECT DISTINCT ad.dlc_appid
        FROM ${appDlcTable} ad
        WHERE ad.parent_appid = $1
        ORDER BY ad.dlc_appid ASC
        LIMIT $2
      `,
      [sourceAppid, limit],
      this.config
    );

    return result.rows
      .map((row) => row.dlc_appid)
      .filter((appid): appid is number => Number.isInteger(appid) && appid > 0);
  }

  private async queryRelatedFranchiseRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceReviewScore: number | null;
  }): Promise<RelatedEntityRow[]> {
    const appFranchisesTable = this.relation('app_franchises').sql;
    const franchisesTable = this.relation('franchises').sql;
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const sqlParams: unknown[] = [params.sourceAppid];
    const conditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (params.excludeSource) {
      conditions.push('af.appid <> $1');
    }

    if (typeof params.filters?.minReviewScore === 'number') {
      sqlParams.push(params.filters.minReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} >= $${sqlParams.length}`);
    }

    if (params.filters?.reviewComparison === 'better_only' && typeof params.sourceReviewScore === 'number') {
      sqlParams.push(params.sourceReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} > $${sqlParams.length}`);
    }

    if (params.filters?.steamDeck?.length) {
      sqlParams.push(params.filters.steamDeck);
      conditions.push(`COALESCE(asd.category::text, 'unknown') = ANY($${sqlParams.length}::text[])`);
    }

    sqlParams.push(params.limit);

    const result = await runQuery<RelatedEntityRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.positive_percentage,
          ldm.total_reviews,
          asd.category::text AS steam_deck_category,
          MIN(f.name)::text AS franchise_name
        FROM ${appFranchisesTable} src
        JOIN ${appFranchisesTable} af ON af.franchise_id = src.franchise_id
        JOIN ${franchisesTable} f ON f.id = af.franchise_id
        JOIN ${appsTable} a ON a.appid = af.appid
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN ${appSteamDeckTable} asd ON asd.appid = a.appid
        WHERE src.appid = $1
          AND ${conditions.join('\n          AND ')}
        GROUP BY
          a.appid,
          a.name,
          a.release_date,
          ldm.review_score,
          ldm.positive_percentage,
          ldm.total_reviews,
          asd.category
        ORDER BY COALESCE(ldm.total_reviews, 0) DESC, a.release_date DESC NULLS LAST, a.name ASC
        LIMIT $${sqlParams.length}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryRelatedTitleFamilyRows(params: {
    excludeSource: boolean;
    filters: GetRelatedEntitiesRequest['filters'] | null;
    limit: number;
    sourceAppid: number;
    sourceDeveloperIds: number[];
    sourceName: string;
    sourcePublisherIds: number[];
    sourceReviewScore: number | null;
  }): Promise<RelatedEntityRow[]> {
    const titleFamily = deriveTitleFamilyQuery(params.sourceName);
    if (!titleFamily) {
      return [];
    }

    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const sqlParams: unknown[] = [
      params.sourceAppid,
      titleFamily.patterns,
    ];
    const conditions: string[] = [
      'lower(a.name) LIKE ANY($2::text[])',
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (params.excludeSource) {
      conditions.push('a.appid <> $1');
    }

    if (typeof params.filters?.minReviewScore === 'number') {
      sqlParams.push(params.filters.minReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} >= $${sqlParams.length}`);
    }

    if (params.filters?.reviewComparison === 'better_only' && typeof params.sourceReviewScore === 'number') {
      sqlParams.push(params.sourceReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} > $${sqlParams.length}`);
    }

    if (params.filters?.steamDeck?.length) {
      sqlParams.push(params.filters.steamDeck);
      conditions.push(`COALESCE(asd.category::text, 'unknown') = ANY($${sqlParams.length}::text[])`);
    }

    if (titleFamily.requiresSharedCompany) {
      const companySignalClauses: string[] = [];

      if (params.sourceDeveloperIds.length > 0) {
        sqlParams.push(params.sourceDeveloperIds);
        companySignalClauses.push(
          `EXISTS (
            SELECT 1
            FROM ${appDevelopersTable} ad
            WHERE ad.appid = a.appid
              AND ad.developer_id = ANY($${sqlParams.length}::int[])
          )`
        );
      }

      if (params.sourcePublisherIds.length > 0) {
        sqlParams.push(params.sourcePublisherIds);
        companySignalClauses.push(
          `EXISTS (
            SELECT 1
            FROM ${appPublishersTable} ap
            WHERE ap.appid = a.appid
              AND ap.publisher_id = ANY($${sqlParams.length}::int[])
          )`
        );
      }

      if (companySignalClauses.length === 0) {
        return [];
      }

      conditions.push(`(${companySignalClauses.join(' OR ')})`);
    }

    sqlParams.push(titleFamily.primaryKey);
    const primaryKeyParam = sqlParams.length;
    sqlParams.push(params.limit);
    const limitParam = sqlParams.length;

    const result = await runQuery<RelatedEntityRow>(
      `
        SELECT
          a.appid,
          a.name,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.positive_percentage,
          ldm.total_reviews,
          asd.category::text AS steam_deck_category,
          NULL::text AS franchise_name
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN ${appSteamDeckTable} asd ON asd.appid = a.appid
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY
          CASE
            WHEN lower(a.name) = lower($${primaryKeyParam}::text) THEN 0
            ELSE 1
          END,
          COALESCE(ldm.total_reviews, 0) DESC,
          a.release_date DESC NULLS LAST,
          a.name ASC
        LIMIT $${limitParam}
      `,
      sqlParams,
      this.config
    );

    return result.rows;
  }

  private async queryRankedGames(
    metric: Exclude<RankMetric, 'game_count'>,
    query: string,
    limit: number,
    direction: 'ASC' | 'DESC'
  ): Promise<RankRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const params: unknown[] = [];
    const conditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (query) {
      params.push(normalizeLikeValue(query));
      conditions.push(`lower(a.name) LIKE $${params.length}`);
    }

    params.push(limit);

    const sql = `
      SELECT
        a.appid AS entity_id,
        a.name AS display_name,
        EXTRACT(YEAR FROM a.release_date)::int AS release_year,
        ldm.total_reviews,
        ${reviewPercentageSql('ldm')} AS review_score,
        ldm.owners_midpoint,
        ldm.ccu_peak,
        NULL::int AS game_count
      FROM ${appsTable} a
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY ${
        metric === 'review_score'
          ? `COALESCE(${reviewPercentageSql('ldm')}, 0)`
          : `COALESCE(ldm.${metric}, 0)`
      } ${direction}, COALESCE(ldm.total_reviews, 0) DESC, a.name ASC
      LIMIT $${params.length}
    `;

    const result = await runQuery<RankRow>(sql, params, this.config);
    return result.rows;
  }

  private async queryRankedCompanies(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    request: RankEntitiesRequest,
    limit: number,
    direction: 'ASC' | 'DESC'
  ): Promise<RankRow[]> {
    const companyTable = this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const metric = request.metric;
    const query = request.query?.trim() ?? '';
    const filters = request.catalogFilters ?? null;
    const aggregateFilters = request.aggregateFilters ?? null;
    const params: unknown[] = [];
    const conditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];

    if (query) {
      params.push(normalizeLikeValue(query));
      conditions.push(`lower(c.name) LIKE $${params.length}`);
    }

    if (filters?.includeAppTypes?.length) {
      params.push(filters.includeAppTypes);
      conditions.push(`a.type::text = ANY($${params.length}::text[])`);
    }

    if (filters?.publisherIds?.length) {
      params.push(filters.publisherIds);
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${this.relation('app_publishers').sql} ap_filter
          WHERE ap_filter.appid = a.appid
            AND ap_filter.publisher_id = ANY($${params.length}::int[])
        )`
      );
    }

    if (filters?.developerIds?.length) {
      params.push(filters.developerIds);
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${this.relation('app_developers').sql} ad_filter
          WHERE ad_filter.appid = a.appid
            AND ad_filter.developer_id = ANY($${params.length}::int[])
        )`
      );
    }

    if (filters?.parentAppids?.length) {
      params.push(filters.parentAppids);
      conditions.push(`a.parent_appid = ANY($${params.length}::int[])`);
    }

    if (typeof filters?.isFree === 'boolean') {
      params.push(filters.isFree);
      conditions.push(`a.is_free = $${params.length}`);
    }

    if (filters?.releaseYear?.gte) {
      params.push(filters.releaseYear.gte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${params.length}`);
    }

    if (filters?.releaseYear?.lte) {
      params.push(filters.releaseYear.lte);
      conditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${params.length}`);
    }

    if (typeof request.releaseDays === 'number' && Number.isFinite(request.releaseDays) && request.releaseDays > 0) {
      params.push(Math.trunc(request.releaseDays));
      conditions.push(`a.release_date >= CURRENT_DATE - ($${params.length}::int * INTERVAL '1 day')`);
    }

    if (typeof filters?.minReviews === 'number') {
      params.push(filters.minReviews);
      conditions.push(`COALESCE(ldm.total_reviews, 0) >= $${params.length}`);
    }

    if (typeof filters?.minReviewScore === 'number') {
      params.push(filters.minReviewScore);
      conditions.push(`${reviewPercentageSql('ldm')} >= $${params.length}`);
    }

    if (typeof filters?.minPriceCents === 'number') {
      params.push(filters.minPriceCents);
      conditions.push(`COALESCE(a.current_price_cents, 0) >= $${params.length}`);
    }

    if (typeof filters?.maxPriceCents === 'number') {
      params.push(filters.maxPriceCents);
      conditions.push(`COALESCE(a.current_price_cents, 0) <= $${params.length}`);
    }

    if (typeof filters?.onSale === 'boolean') {
      conditions.push(
        filters.onSale
          ? 'COALESCE(a.current_discount_percent, 0) > 0'
          : 'COALESCE(a.current_discount_percent, 0) = 0'
      );
    }

    if (filters?.platforms?.length) {
      for (const platform of filters.platforms) {
        params.push(`%${platform.toLowerCase()}%`);
        conditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${params.length}`);
      }
    }

    if (filters?.genres?.length) {
      params.push(filters.genres.map((genre) => genre.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${params.length}::text[])
        )`
      );
    }

    if (filters?.tags?.length) {
      params.push(filters.tags.map((tag) => tag.toLowerCase()));
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${params.length}::text[])
        )`
      );
    }

    const averageReviewExpression = `CASE
      WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
        THEN ROUND(
          (
            SUM(COALESCE(${reviewPercentageSql('ldm')}, 0) * COALESCE(ldm.total_reviews, 0))::numeric
            / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
          ),
          2
        )::double precision
      ELSE NULL
    END`;
    const metricOrderExpression =
      metric === 'game_count'
        ? 'COUNT(DISTINCT a.appid)'
        : metric === 'total_reviews'
          ? 'SUM(COALESCE(ldm.total_reviews, 0))'
          : metric === 'owners_midpoint'
            ? 'SUM(COALESCE(ldm.owners_midpoint, 0))'
            : metric === 'ccu_peak'
              ? 'MAX(COALESCE(ldm.ccu_peak, 0))'
              : averageReviewExpression;
    const havingConditions: string[] = ['COUNT(DISTINCT a.appid) > 0'];

    if (typeof aggregateFilters?.minGameCount === 'number') {
      params.push(aggregateFilters.minGameCount);
      havingConditions.push(`COUNT(DISTINCT a.appid) >= $${params.length}`);
    }

    if (typeof aggregateFilters?.minAverageReviewScore === 'number') {
      params.push(aggregateFilters.minAverageReviewScore);
      havingConditions.push(`${averageReviewExpression} >= $${params.length}`);
    }

    if (typeof aggregateFilters?.minMinimumReviewScore === 'number') {
      params.push(aggregateFilters.minMinimumReviewScore);
      havingConditions.push(`MIN(COALESCE(${reviewPercentageSql('ldm')}, 0)) >= $${params.length}`);
    }

    if (typeof request.recentReleaseDays === 'number' && Number.isFinite(request.recentReleaseDays) && request.recentReleaseDays > 0) {
      params.push(Math.trunc(request.recentReleaseDays));
      havingConditions.push(
        `MAX(CASE WHEN a.release_date >= CURRENT_DATE - ($${params.length}::int * INTERVAL '1 day') THEN 1 ELSE 0 END) = 1`
      );
    }

    params.push(limit);

    const sql = `
      SELECT
        c.id AS entity_id,
        c.name AS display_name,
        NULL::int AS release_year,
        COUNT(DISTINCT a.appid)::int AS game_count,
        SUM(COALESCE(ldm.total_reviews, 0))::double precision AS total_reviews,
        SUM(COALESCE(ldm.owners_midpoint, 0))::double precision AS owners_midpoint,
        MAX(COALESCE(ldm.ccu_peak, 0))::double precision AS ccu_peak,
        ${averageReviewExpression} AS review_score
      FROM ${companyTable} c
      JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
      JOIN ${appsTable} a ON a.appid = rel.appid
      LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
      WHERE ${conditions.join('\n        AND ')}
      GROUP BY c.id, c.name
      HAVING ${havingConditions.join('\n        AND ')}
      ORDER BY COALESCE(${metricOrderExpression}, 0) ${direction}, SUM(COALESCE(ldm.total_reviews, 0)) DESC, c.name ASC
      LIMIT $${params.length}
    `;

    const result = await runQuery<RankRow>(sql, params, this.config);
    return result.rows;
  }

  private normalizeMonthlyPlaytimeWindow(
    requestedStartMonth: string | null,
    requestedEndMonth: string | null
  ): { endMonth: string; startMonth: string } {
    const endMonth = this.normalizeMonthStart(
      requestedEndMonth,
      () => this.defaultLastCompleteMonth()
    );
    const startMonth = this.normalizeMonthStart(requestedStartMonth, () => endMonth);

    if (Date.parse(startMonth) > Date.parse(endMonth)) {
      throw new PublisherIQError(
        'queryMonthlyPlaytime requires startMonth to be before or equal to endMonth.',
        'INVALID_MONTHLY_PLAYTIME_WINDOW',
        { endMonth, startMonth }
      );
    }

    return { endMonth, startMonth };
  }

  private normalizeMonthStart(value: string | null, fallback: () => string): string {
    const raw = value?.trim();
    if (!raw) {
      return fallback();
    }

    const monthMatch = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (!monthMatch) {
      throw new PublisherIQError(
        'queryMonthlyPlaytime months must be formatted as YYYY-MM or YYYY-MM-DD.',
        'INVALID_MONTHLY_PLAYTIME_MONTH',
        { value }
      );
    }

    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new PublisherIQError(
        'queryMonthlyPlaytime received an invalid month.',
        'INVALID_MONTHLY_PLAYTIME_MONTH',
        { value }
      );
    }

    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  private defaultLastCompleteMonth(): string {
    const now = new Date();
    const lastComplete = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${lastComplete.getUTCFullYear()}-${String(lastComplete.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  private async queryMonthlyPlaytimeRows(
    request: QueryMonthlyPlaytimeRequest,
    startMonth: string,
    endMonth: string,
    limit: number
  ): Promise<MonthlyPlaytimeRow[]> {
    const isPublisher = request.entityKind === 'publisher';
    const table = this.relation(
      isPublisher ? 'metrics_monthly_publisher_metrics' : 'metrics_monthly_game_metrics'
    ).sql;
    const idColumn = isPublisher ? 'publisher_id' : 'appid';
    const nameColumn = isPublisher ? 'publisher_name' : 'game_name';
    const params: unknown[] = [startMonth, endMonth];
    const conditions = ['month >= $1::date', 'month <= $2::date'];

    if (request.entityIds?.length) {
      params.push(request.entityIds);
      conditions.push(`${idColumn} = ANY($${params.length}::int[])`);
    }

    params.push(limit);

    const result = await runQuery<MonthlyPlaytimeRow>(
      `
        SELECT
          ${idColumn} AS entity_id,
          ${nameColumn} AS name,
          month::text,
          year,
          month_num,
          ${isPublisher ? 'NULL::bigint' : 'monthly_ccu_sum'} AS monthly_ccu_sum,
          ${isPublisher ? 'game_count' : 'NULL::bigint'} AS game_count,
          estimated_monthly_hours
        FROM ${table}
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY estimated_monthly_hours DESC NULLS LAST, name ASC, month DESC
        LIMIT $${params.length}
      `,
      params,
      this.config
    );

    return result.rows;
  }

  private normalizeCompareMetrics(
    metrics: CompareMetric[] | undefined,
    entityKind: EntityKind
  ): CompareMetric[] {
    const fallback =
      entityKind === 'game'
        ? DEFAULT_COMPARE_METRICS.filter((metric) => metric !== 'game_count')
        : DEFAULT_COMPARE_METRICS;

    if (!Array.isArray(metrics) || metrics.length === 0) {
      return fallback;
    }

    const uniqueMetrics: CompareMetric[] = [];
    for (const metric of metrics) {
      if (!COMPARE_METRIC_SET.has(metric)) {
        throw new PublisherIQError(
          `Unsupported compare metric: ${String(metric)}.`,
          'INVALID_COMPARE_METRIC',
          { metric }
        );
      }

      if (entityKind === 'game' && metric === 'game_count') {
        throw new PublisherIQError(
          'game_count comparisons are only valid for publisher or developer entities.',
          'INVALID_COMPARE_METRIC',
          { entityKind, metric }
        );
      }

      if (!uniqueMetrics.includes(metric)) {
        uniqueMetrics.push(metric);
      }
    }

    return uniqueMetrics;
  }

  private async queryComparedGames(entityIds: number[]): Promise<Map<number, RankRow>> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const result = await runQuery<RankRow>(
      `
        SELECT
          a.appid AS entity_id,
          a.name AS display_name,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.total_reviews,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.owners_midpoint,
          ldm.ccu_peak,
          NULL::int AS game_count
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE a.appid = ANY($1::int[])
      `,
      [entityIds],
      this.config
    );

    return new Map(result.rows.map((row) => [row.entity_id, row]));
  }

  private async queryComparedCompanies(
    entityKind: Extract<EntityKind, 'publisher' | 'developer'>,
    entityIds: number[]
  ): Promise<Map<number, RankRow>> {
    const companyTable = this.relation(entityKind === 'publisher' ? 'publishers' : 'developers').sql;
    const relationTable = this.relation(
      entityKind === 'publisher' ? 'app_publishers' : 'app_developers'
    ).sql;
    const relationColumn = entityKind === 'publisher' ? 'publisher_id' : 'developer_id';
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;

    const result = await runQuery<RankRow>(
      `
        SELECT
          c.id AS entity_id,
          c.name AS display_name,
          NULL::int AS release_year,
          COUNT(DISTINCT a.appid)::int AS game_count,
          SUM(COALESCE(ldm.total_reviews, 0))::double precision AS total_reviews,
          SUM(COALESCE(ldm.owners_midpoint, 0))::double precision AS owners_midpoint,
          MAX(COALESCE(ldm.ccu_peak, 0))::double precision AS ccu_peak,
          CASE
            WHEN SUM(COALESCE(ldm.total_reviews, 0)) > 0
              THEN ROUND(
                (
                  SUM(COALESCE(${reviewPercentageSql('ldm')}, 0) * COALESCE(ldm.total_reviews, 0))::numeric
                  / NULLIF(SUM(COALESCE(ldm.total_reviews, 0)), 0)
                ),
                2
              )::double precision
            ELSE NULL
          END AS review_score
        FROM ${companyTable} c
        LEFT JOIN ${relationTable} rel ON rel.${relationColumn} = c.id
        LEFT JOIN ${appsTable} a
          ON a.appid = rel.appid
          AND a.is_delisted = false
          AND ${GAME_TYPE_PREDICATE[this.config.source]}
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        WHERE c.id = ANY($1::int[])
        GROUP BY c.id, c.name
      `,
      [entityIds],
      this.config
    );

    return new Map(result.rows.map((row) => [row.entity_id, row]));
  }

  private normalizeMomentumTimeframe(
    timeframe: DiscoverMomentumRequest['timeframe'],
    sortBy: DiscoverMomentumRequest['sortBy'],
    trendType: DiscoverMomentumRequest['trendType']
  ): '7d' | '30d' | 'current' {
    if (timeframe === 'current' || timeframe === '7d' || timeframe === '30d') {
      return timeframe;
    }

    if (sortBy === 'ccu_peak') {
      return 'current';
    }

    if (sortBy === 'reviews_added_30d' || trendType === 'breaking_out') {
      return '30d';
    }

    return '7d';
  }

  private getMomentumSentimentBaselineWindow(
    timeframe: '7d' | '30d' | 'current'
  ): 7 | 30 {
    return timeframe === '7d' ? 7 : 30;
  }

  private buildSentimentDeltaExpression(
    timeframe: '7d' | '30d' | 'current',
    baseAlias = 'candidate'
  ): string {
    const baselineAlias = timeframe === '7d' ? 'baseline7' : 'baseline30';
    return `CASE
      WHEN COALESCE(${baselineAlias}.positive_reviews, 0) + COALESCE(${baselineAlias}.negative_reviews, 0) > 0
        THEN COALESCE(${baseAlias}.positive_percentage, 0) - (
          COALESCE(${baselineAlias}.positive_reviews, 0)::numeric
          / NULLIF(COALESCE(${baselineAlias}.positive_reviews, 0) + COALESCE(${baselineAlias}.negative_reviews, 0), 0)::numeric
        ) * 100
      ELSE 0
    END`;
  }

  private labelMomentumRanking(sortBy: DiscoverMomentumRequest['sortBy']): string {
    switch (sortBy) {
      case 'ccu_peak':
        return 'Peak CCU';
      case 'momentum_score':
        return 'Momentum Score';
      case 'review_score':
        return 'Review Percentage';
      case 'reviews_added_30d':
        return 'Reviews Added (30d)';
      case 'reviews_added_7d':
        return 'Reviews Added (7d)';
      case 'sentiment_delta':
        return 'Sentiment Delta';
      case 'total_reviews':
        return 'Total Reviews';
      case 'velocity_acceleration':
        return 'Review Velocity Acceleration';
      case 'velocity_7d':
        return 'Review Velocity (7d)';
      default:
        return 'Momentum';
    }
  }

  private describeMomentumRanking(
    sortBy: DiscoverMomentumRequest['sortBy'],
    timeframe: '7d' | '30d' | 'current',
    trendType: DiscoverMomentumRequest['trendType']
  ): string {
    if (trendType === 'breaking_out') {
      return 'Breakout candidates are ranked by recent review pickup and supporting CCU acceleration while keeping the set constrained to smaller-but-rising titles.';
    }

    if (trendType === 'accelerating') {
      return 'Acceleration ranks titles whose recent review pace is out-running their trailing baseline.';
    }

    if (trendType === 'declining') {
      return 'Declining screens rank titles by the sharpest negative change in review or player momentum.';
    }

    switch (sortBy) {
      case 'ccu_peak':
        return 'Peak CCU uses the latest 24-hour concurrent-player snapshot.';
      case 'momentum_score':
        return `Momentum blends review pickup, velocity acceleration, and player growth over the ${timeframe} window.`;
      case 'review_score':
        return 'Review percentage uses the latest positive-review rate.';
      case 'reviews_added_30d':
        return 'Reviews added (30d) counts net new reviews in the last 30 days.';
      case 'reviews_added_7d':
        return 'Reviews added (7d) counts net new reviews in the last 7 days.';
      case 'sentiment_delta':
        return `Sentiment delta measures the change in positive-review rate versus the trailing ${this.getMomentumSentimentBaselineWindow(timeframe)}-day baseline.`;
      case 'total_reviews':
        return 'Total reviews ranks titles by lifetime Steam review volume.';
      case 'velocity_acceleration':
        return 'Velocity acceleration compares recent review velocity against the trailing 30-day baseline.';
      case 'velocity_7d':
        return 'Velocity (7d) ranks titles by recent reviews per day.';
      default:
        return 'Momentum is ranked from current-state and recent-history metrics.';
    }
  }

  private labelMomentumTimeframe(timeframe: '7d' | '30d' | 'current'): string {
    switch (timeframe) {
      case 'current':
        return 'Current snapshot';
      case '30d':
        return 'Last 30 days';
      case '7d':
      default:
        return 'Last 7 days';
    }
  }

  private buildMomentumFiltersApplied(
    request: DiscoverMomentumRequest,
    timeframe: '7d' | '30d' | 'current'
  ): string[] {
    const filters = request.filters ?? {};
    const applied: string[] = [
      `sort_by: ${request.sortBy}`,
      `timeframe: ${timeframe}`,
    ];

    if (request.trendType) {
      applied.push(`trend_type: ${request.trendType}`);
    }
    if (request.indieHeuristic) {
      applied.push('indie_heuristic: true');
    }
    if (filters.tags?.length) {
      applied.push(`tags: ${filters.tags.join(', ')}`);
    }
    if (filters.genres?.length) {
      applied.push(`genres: ${filters.genres.join(', ')}`);
    }
    if (filters.platforms?.length) {
      applied.push(`platforms: ${filters.platforms.join(', ')}`);
    }
    if (filters.steamDeck?.length) {
      applied.push(`steam_deck: ${filters.steamDeck.join(', ')}`);
    }
    if (typeof filters.isFree === 'boolean') {
      applied.push(`is_free: ${filters.isFree}`);
    }
    if (typeof filters.minReviews === 'number') {
      applied.push(`min_reviews: ${filters.minReviews}`);
    }
    if (typeof filters.maxReviews === 'number') {
      applied.push(`max_reviews: ${filters.maxReviews}`);
    }
    if (typeof filters.minReviewScore === 'number') {
      applied.push(`min_review_score: ${filters.minReviewScore}`);
    }
    if (typeof filters.maxPriceCents === 'number') {
      applied.push(`max_price_cents: ${filters.maxPriceCents}`);
    }
    if (typeof filters.minCcu === 'number') {
      applied.push(`min_ccu: ${filters.minCcu}`);
    }
    if (typeof filters.minReviewsAdded7d === 'number') {
      applied.push(`min_reviews_added_7d: ${filters.minReviewsAdded7d}`);
    }
    if (typeof filters.minReviewsAdded30d === 'number') {
      applied.push(`min_reviews_added_30d: ${filters.minReviewsAdded30d}`);
    }
    if (typeof filters.minSentimentDelta === 'number') {
      applied.push(`min_sentiment_delta: ${filters.minSentimentDelta}`);
    }
    if (typeof filters.maxSentimentDelta === 'number') {
      applied.push(`max_sentiment_delta: ${filters.maxSentimentDelta}`);
    }
    if (filters.releaseYear?.gte != null) {
      applied.push(`release_year >= ${filters.releaseYear.gte}`);
    }
    if (filters.releaseYear?.lte != null) {
      applied.push(`release_year <= ${filters.releaseYear.lte}`);
    }

    return applied;
  }

  private mapMomentumItem(
    row: MomentumRow,
    context: {
      sortBy: DiscoverMomentumRequest['sortBy'];
      timeframe: '7d' | '30d' | 'current';
      trendType: DiscoverMomentumRequest['trendType'];
    },
    ccuSparkline: number[] | null = null
  ): DiscoverMomentumItem {
    const ccuGrowth30dPercent = coerceNullableNumber(row.ccu_growth_30d_percent);
    const ccuGrowth7dPercent = coerceNullableNumber(row.ccu_growth_7d_percent);
    const ccuPeak = coerceNullableNumber(row.ccu_peak);
    const normalizedCcuPeak = ccuPeak != null && ccuPeak > 0 ? ccuPeak : null;
    const discountPercent = coerceNullableNumber(row.discount_percent);
    const priceCents = coerceNullableNumber(row.price_cents);
    const releaseYear = coerceNullableNumber(row.release_year);
    const reviewPercentage = normalizeReviewPercentageValue(coerceNullableNumber(row.positive_percentage));
    const reviewsAdded30d = coerceNullableNumber(row.reviews_added_30d);
    const reviewsAdded7d = coerceNullableNumber(row.reviews_added_7d);
    const sentimentDelta = coerceNullableNumber(row.sentiment_delta);
    const totalReviews = coerceNullableNumber(row.total_reviews);
    const velocity30d = coerceNullableNumber(row.velocity_30d);
    const velocity7d = coerceNullableNumber(row.velocity_7d);
    const velocityAcceleration = coerceNullableNumber(row.velocity_acceleration);
    const supportReasons = this.buildMomentumSupportReasons({
      ccuGrowth30dPercent,
      ccuGrowth7dPercent,
      ccuPeak: normalizedCcuPeak,
      context,
      reviewPercentage,
      reviewsAdded30d,
      reviewsAdded7d,
      sentimentDelta,
      totalReviews,
      velocity30d,
      velocity7d,
      velocityAcceleration,
    });

    const supportLevel: DiscoverMomentumItem['supportLevel'] =
      supportReasons.length >= 3 ? 'high' : supportReasons.length >= 2 ? 'medium' : 'low';
    const momentumScore = roundNumber(
      (reviewsAdded7d ?? 0)
      + Math.max(ccuGrowth7dPercent ?? 0, 0) / 10
      + Math.max(sentimentDelta ?? 0, 0) * 2
      + Math.max(velocityAcceleration ?? 0, 0) / 5,
      2
    );

    return {
      appid: row.appid,
      ccuGrowth30dPercent,
      ccuGrowth7dPercent,
      ccuPeak: normalizedCcuPeak,
      ccuSparkline: ccuSparkline ?? undefined,
      developerName: row.developer_name,
      discountPercent,
      entityUid: buildEntityUid('steam', 'game', String(row.appid)),
      isFree: row.is_free,
      isSelfPublished: row.is_self_published,
      matchedSteamDeck: null,
      momentumScore,
      name: row.name,
      platformSupport: row.platforms
        ? row.platforms.split(',').map((platform) => platform.trim()).filter(Boolean)
        : [],
      priceCents,
      publisherName: row.publisher_name,
      releaseDate: row.release_date,
      releaseYear,
      reviewPercentage,
      reviewsAdded30d,
      reviewsAdded7d,
      sentimentDelta,
      steamDeckCategory: null,
      supportLevel,
      supportReasons: supportReasons.length > 0 ? supportReasons : ['Current-state momentum evidence is limited.'],
      totalReviews,
      trendDirection: row.trend_direction,
      velocity30d,
      velocity7d,
      velocityAcceleration,
    };
  }

  private buildMomentumSupportReasons(params: {
    ccuGrowth30dPercent: number | null;
    ccuGrowth7dPercent: number | null;
    ccuPeak: number | null;
    context: {
      sortBy: DiscoverMomentumRequest['sortBy'];
      timeframe: '7d' | '30d' | 'current';
      trendType: DiscoverMomentumRequest['trendType'];
    };
    reviewPercentage: number | null;
    reviewsAdded30d: number | null;
    reviewsAdded7d: number | null;
    sentimentDelta: number | null;
    totalReviews: number | null;
    velocity30d: number | null;
    velocity7d: number | null;
    velocityAcceleration: number | null;
  }): string[] {
    const reasons: string[] = [];
    const reviewWindow =
      params.context.sortBy === 'reviews_added_30d'
      || params.context.timeframe === '30d'
      || params.context.trendType === 'breaking_out'
        ? '30d'
        : '7d';
    const primaryReviewsAdded = reviewWindow === '30d' ? params.reviewsAdded30d : params.reviewsAdded7d;
    const primaryVelocity = reviewWindow === '30d' ? params.velocity30d : params.velocity7d;
    const primaryCcuGrowth = reviewWindow === '30d' ? params.ccuGrowth30dPercent : params.ccuGrowth7dPercent;

    if (params.context.sortBy === 'ccu_peak' && params.ccuPeak != null) {
      reasons.push(`${Math.round(params.ccuPeak).toLocaleString()} peak CCU in the latest snapshot.`);
    }

    if ((primaryReviewsAdded ?? 0) >= 25) {
      reasons.push(`${Math.round(primaryReviewsAdded ?? 0).toLocaleString()} reviews added over ${reviewWindow}.`);
    }

    if ((params.velocityAcceleration ?? 0) >= 25) {
      reasons.push(`Review velocity is up ${Math.round(params.velocityAcceleration ?? 0)}% versus the trailing baseline.`);
    } else if ((params.velocityAcceleration ?? 0) <= -25) {
      reasons.push(`Review velocity is down ${Math.round(Math.abs(params.velocityAcceleration ?? 0))}% versus the trailing baseline.`);
    }

    if ((primaryVelocity ?? 0) >= 10 && params.context.sortBy === 'velocity_7d') {
      reasons.push(`${roundNumber(primaryVelocity ?? 0, 1)} reviews per day over ${reviewWindow}.`);
    }

    if (params.ccuPeak != null && (primaryCcuGrowth ?? 0) >= 20) {
      reasons.push(`Peak CCU is up ${Math.round(primaryCcuGrowth ?? 0)}% over ${reviewWindow}.`);
    } else if (params.ccuPeak != null && (primaryCcuGrowth ?? 0) <= -20) {
      reasons.push(`Peak CCU is down ${Math.round(Math.abs(primaryCcuGrowth ?? 0))}% over ${reviewWindow}.`);
    }

    if ((params.sentimentDelta ?? 0) >= 2) {
      reasons.push(`Sentiment improved by ${roundNumber(params.sentimentDelta ?? 0, 1)} points.`);
    } else if ((params.sentimentDelta ?? 0) <= -2) {
      reasons.push(`Sentiment fell by ${roundNumber(Math.abs(params.sentimentDelta ?? 0), 1)} points.`);
    }

    if (
      params.context.sortBy === 'review_score'
      && (params.reviewPercentage ?? 0) >= 85
      && (params.totalReviews ?? 0) >= 1000
    ) {
      reasons.push(`${roundNumber(params.reviewPercentage ?? 0, 1)}% positive across ${Math.round(params.totalReviews ?? 0).toLocaleString()} reviews.`);
    }

    return reasons.length > 0 ? reasons.slice(0, 4) : ['Current-state momentum evidence is limited.'];
  }

  private async queryMomentumSparklineData(
    appids: number[],
    pointCount: number
  ): Promise<Map<number, number[]>> {
    const uniqueAppids = [...new Set(
      appids.filter((appid): appid is number => Number.isInteger(appid) && appid > 0)
    )];
    const pointsByApp = new Map<number, number[]>();

    if (uniqueAppids.length === 0) {
      return pointsByApp;
    }

    const metricsDailyMetricsTable = this.relation('metrics_daily_metrics').sql;
    const result = await runQuery<CCUSparklinePeakRow>(
      `
        WITH daily_points AS (
          SELECT
            dm.appid,
            dm.metric_date::text AS snapshot_date,
            MAX(dm.ccu_peak)::double precision AS peak_ccu
          FROM ${metricsDailyMetricsTable} dm
          WHERE dm.appid = ANY($1::int[])
            AND dm.ccu_peak IS NOT NULL
          GROUP BY dm.appid, dm.metric_date
        ),
        ranked_points AS (
          SELECT
            dp.appid,
            dp.snapshot_date,
            dp.peak_ccu,
            ROW_NUMBER() OVER (
              PARTITION BY dp.appid
              ORDER BY dp.snapshot_date DESC
            ) AS point_rank
          FROM daily_points dp
        )
        SELECT
          rp.appid,
          rp.snapshot_date,
          rp.peak_ccu
        FROM ranked_points rp
        WHERE rp.point_rank <= $2::int
        ORDER BY rp.appid ASC, rp.snapshot_date ASC
      `,
      [uniqueAppids, pointCount],
      this.config
    );

    for (const row of result.rows) {
      const point = coerceNullableNumber(row.peak_ccu);
      if (point == null) {
        continue;
      }

      const existing = pointsByApp.get(row.appid);
      if (existing) {
        existing.push(point);
      } else {
        pointsByApp.set(row.appid, [point]);
      }
    }

    return pointsByApp;
  }

  private async queryMomentumRows(params: {
    appids: number[] | null;
    filters: DiscoverMomentumRequest['filters'] | null;
    indieHeuristic: boolean;
    limit: number;
    sortBy: DiscoverMomentumRequest['sortBy'];
    sortDirection: NonNullable<DiscoverMomentumRequest['sortDirection']>;
    timeframe: '7d' | '30d' | 'current';
    trendType: DiscoverMomentumRequest['trendType'];
  }): Promise<MomentumRow[]> {
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const metricsDailyMetricsTable = this.relation('metrics_daily_metrics').sql;
    const appPublishersTable = this.relation('app_publishers').sql;
    const publishersTable = this.relation('publishers').sql;
    const appDevelopersTable = this.relation('app_developers').sql;
    const developersTable = this.relation('developers').sql;
    const appGenresTable = this.relation('app_genres').sql;
    const steamGenresTable = this.relation('steam_genres').sql;
    const appSteamTagsTable = this.relation('app_steam_tags').sql;
    const steamTagsTable = this.relation('steam_tags').sql;
    const appSteamDeckTable = this.relation('app_steam_deck').sql;
    const paramsList: unknown[] = [];
    const candidateConditions: string[] = [
      'a.is_delisted = false',
      GAME_TYPE_PREDICATE[this.config.source],
    ];
    const postConditions: string[] = [];
    const filters = params.filters;
    const needsBaseline7 = this.requiresMomentumBaseline7(params);
    const needsBaseline30 = this.requiresMomentumBaseline30(params);

    if (params.appids?.length) {
      paramsList.push(params.appids);
      candidateConditions.push(`a.appid = ANY($${paramsList.length}::int[])`);
    }

    if (filters?.tags?.length) {
      paramsList.push(filters.tags.map((tag) => tag.toLowerCase()));
      candidateConditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamTagsTable} ast
          JOIN ${steamTagsTable} st ON st.tag_id = ast.tag_id
          WHERE ast.appid = a.appid
            AND lower(st.name) = ANY($${paramsList.length}::text[])
        )`
      );
    }

    if (filters?.genres?.length) {
      paramsList.push(filters.genres.map((genre) => genre.toLowerCase()));
      candidateConditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appGenresTable} ag
          JOIN ${steamGenresTable} sg ON sg.genre_id = ag.genre_id
          WHERE ag.appid = a.appid
            AND lower(sg.name) = ANY($${paramsList.length}::text[])
        )`
      );
    }

    if (filters?.platforms?.length) {
      for (const platform of filters.platforms) {
        paramsList.push(`%${platform.toLowerCase()}%`);
        candidateConditions.push(`lower(COALESCE(a.platforms, '')) LIKE $${paramsList.length}`);
      }
    }

    if (filters?.steamDeck?.length) {
      paramsList.push(filters.steamDeck);
      candidateConditions.push(
        `EXISTS (
          SELECT 1
          FROM ${appSteamDeckTable} asd
          WHERE asd.appid = a.appid
            AND asd.category::text = ANY($${paramsList.length}::text[])
        )`
      );
    }

    if (typeof filters?.isFree === 'boolean') {
      paramsList.push(filters.isFree);
      candidateConditions.push(`a.is_free = $${paramsList.length}`);
    }

    if (typeof filters?.minReviews === 'number') {
      paramsList.push(filters.minReviews);
      candidateConditions.push(`COALESCE(ldm.total_reviews, 0) >= $${paramsList.length}`);
    }

    if (typeof filters?.maxReviews === 'number') {
      paramsList.push(filters.maxReviews);
      candidateConditions.push(`COALESCE(ldm.total_reviews, 0) <= $${paramsList.length}`);
    }

    if (typeof filters?.minReviewScore === 'number') {
      paramsList.push(filters.minReviewScore);
      candidateConditions.push(`COALESCE(${reviewPercentageSql('ldm')}, 0) >= $${paramsList.length}`);
    }

    if (typeof filters?.maxPriceCents === 'number') {
      paramsList.push(filters.maxPriceCents);
      candidateConditions.push(`COALESCE(a.current_price_cents, 0) <= $${paramsList.length}`);
    }

    if (typeof filters?.minCcu === 'number') {
      paramsList.push(filters.minCcu);
      candidateConditions.push(`COALESCE(ldm.ccu_peak, 0) >= $${paramsList.length}`);
    }

    if (filters?.releaseYear?.gte != null) {
      paramsList.push(filters.releaseYear.gte);
      candidateConditions.push(`EXTRACT(YEAR FROM a.release_date) >= $${paramsList.length}`);
    }

    if (filters?.releaseYear?.lte != null) {
      paramsList.push(filters.releaseYear.lte);
      candidateConditions.push(`EXTRACT(YEAR FROM a.release_date) <= $${paramsList.length}`);
    }

    if (params.indieHeuristic) {
      candidateConditions.push(`COALESCE(primary_publisher.portfolio_game_count, 0) <= 25`);
    }

    if (typeof filters?.minReviewsAdded7d === 'number') {
      paramsList.push(filters.minReviewsAdded7d);
      postConditions.push(`GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) >= $${paramsList.length}`);
    }

    if (typeof filters?.minReviewsAdded30d === 'number') {
      paramsList.push(filters.minReviewsAdded30d);
      postConditions.push(`GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) >= $${paramsList.length}`);
    }

    const sentimentDeltaExpression = this.buildSentimentDeltaExpression(params.timeframe);

    if (typeof filters?.minSentimentDelta === 'number') {
      paramsList.push(filters.minSentimentDelta);
      postConditions.push(`(${sentimentDeltaExpression}) >= $${paramsList.length}`);
    }

    if (typeof filters?.maxSentimentDelta === 'number') {
      paramsList.push(filters.maxSentimentDelta);
      postConditions.push(`(${sentimentDeltaExpression}) <= $${paramsList.length}`);
    }

    if (params.trendType === 'accelerating') {
      postConditions.push(`(
        CASE
          WHEN GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) > 0
            THEN (
              (
                GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) / 7.0
              ) - (
                GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) / 30.0
              )
            ) / NULLIF(GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) / 30.0, 0) * 100
          ELSE NULL
        END
      ) >= 10`);
    } else if (params.trendType === 'breaking_out') {
      postConditions.push(`GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) >= 25`);
      if (typeof filters?.maxReviews !== 'number') {
        candidateConditions.push(`COALESCE(ldm.total_reviews, 0) <= 20000`);
      }
      if (typeof filters?.minReviews !== 'number') {
        candidateConditions.push(`COALESCE(ldm.total_reviews, 0) >= 100`);
      }
    } else if (params.trendType === 'declining') {
      postConditions.push(`(
        CASE
          WHEN COALESCE(baseline7.ccu_peak, 0) > 0
            THEN ((COALESCE(candidate.ccu_peak, 0) - baseline7.ccu_peak)::double precision / baseline7.ccu_peak::double precision) * 100
          ELSE NULL
        END
      ) <= -5`);
    }

    const sortDirection = params.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const sortExpression = this.resolveMomentumSortExpression(params.sortBy, params.timeframe, 'candidate');
    paramsList.push(params.limit);
    const baseline7Join = this.buildMomentumBaselineJoin({
      alias: 'baseline7',
      metricsDailyMetricsTable,
      required: needsBaseline7,
      windowDays: 7,
    });
    const baseline30Join = this.buildMomentumBaselineJoin({
      alias: 'baseline30',
      metricsDailyMetricsTable,
      required: needsBaseline30,
      windowDays: 30,
    });

    const sql = `
      WITH publisher_portfolio_counts AS (
        SELECT publisher_id, COUNT(DISTINCT appid)::int AS portfolio_game_count
        FROM ${appPublishersTable}
        GROUP BY publisher_id
      ),
      primary_publisher AS (
        SELECT DISTINCT ON (ap.appid)
          ap.appid,
          ap.publisher_id,
          p.name AS publisher_name,
          COALESCE(ppc.portfolio_game_count, 0) AS portfolio_game_count
        FROM ${appPublishersTable} ap
        JOIN ${publishersTable} p ON p.id = ap.publisher_id
        LEFT JOIN publisher_portfolio_counts ppc ON ppc.publisher_id = ap.publisher_id
        ORDER BY ap.appid, COALESCE(ppc.portfolio_game_count, 0) ASC, p.name ASC
      ),
      primary_developer AS (
        SELECT DISTINCT ON (ad.appid)
          ad.appid,
          ad.developer_id,
          d.name AS developer_name
        FROM ${appDevelopersTable} ad
        JOIN ${developersTable} d ON d.id = ad.developer_id
        ORDER BY ad.appid, d.name ASC
      ),
      candidate_apps AS (
        SELECT
          a.appid,
          a.name,
          a.is_free,
          a.current_price_cents AS price_cents,
          a.current_discount_percent AS discount_percent,
          a.platforms,
          a.release_date::text AS release_date,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.total_reviews,
          ldm.positive_percentage,
          ldm.owners_midpoint,
          ldm.ccu_peak,
          primary_publisher.publisher_name,
          primary_publisher.portfolio_game_count,
          primary_developer.developer_name,
          CASE
            WHEN primary_publisher.publisher_name IS NOT NULL
              AND primary_developer.developer_name IS NOT NULL
              AND lower(primary_publisher.publisher_name) = lower(primary_developer.developer_name)
              THEN true
            ELSE false
          END AS is_self_published
        FROM ${appsTable} a
        LEFT JOIN ${latestDailyMetricsTable} ldm ON ldm.appid = a.appid
        LEFT JOIN primary_publisher ON primary_publisher.appid = a.appid
        LEFT JOIN primary_developer ON primary_developer.appid = a.appid
        WHERE ${candidateConditions.join('\n          AND ')}
      )
      SELECT
        candidate.appid,
        candidate.name,
        candidate.is_free,
        candidate.price_cents,
        candidate.discount_percent,
        candidate.platforms,
        candidate.release_date,
        candidate.release_year,
        candidate.total_reviews,
        candidate.positive_percentage,
        candidate.owners_midpoint,
        candidate.ccu_peak,
        GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::double precision AS reviews_added_7d,
        GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::double precision AS reviews_added_30d,
        ROUND((GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::numeric / 7), 2)::double precision AS velocity_7d,
        ROUND((GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::numeric / 30), 2)::double precision AS velocity_30d,
        CASE
          WHEN GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0) > 0
            THEN ROUND(
              (
                (
                  GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::numeric / 7
                ) - (
                  GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::numeric / 30
                )
              ) / NULLIF((GREATEST(COALESCE(candidate.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(candidate.total_reviews, 0)), 0)::numeric / 30), 0) * 100,
              2
            )::double precision
          ELSE NULL
        END AS velocity_acceleration,
        ROUND((${sentimentDeltaExpression}), 2)::double precision AS sentiment_delta,
        CASE
          WHEN COALESCE(baseline7.ccu_peak, 0) > 0
            THEN ROUND((((COALESCE(candidate.ccu_peak, 0) - baseline7.ccu_peak)::numeric / baseline7.ccu_peak::numeric) * 100), 2)::double precision
          ELSE NULL
        END AS ccu_growth_7d_percent,
        CASE
          WHEN COALESCE(baseline30.ccu_peak, 0) > 0
            THEN ROUND((((COALESCE(candidate.ccu_peak, 0) - baseline30.ccu_peak)::numeric / baseline30.ccu_peak::numeric) * 100), 2)::double precision
          ELSE NULL
        END AS ccu_growth_30d_percent,
        CASE
          WHEN COALESCE(baseline30.ccu_peak, 0) > 0 AND COALESCE(candidate.ccu_peak, 0) > baseline30.ccu_peak * 1.1 THEN 'up'
          WHEN COALESCE(baseline30.ccu_peak, 0) > 0 AND COALESCE(candidate.ccu_peak, 0) < baseline30.ccu_peak * 0.9 THEN 'down'
          ELSE 'stable'
        END AS trend_direction,
        candidate.publisher_name,
        candidate.developer_name,
        candidate.is_self_published
      FROM candidate_apps candidate
      ${baseline7Join}
      ${baseline30Join}
      ${postConditions.length > 0 ? `WHERE ${postConditions.join('\n        AND ')}` : ''}
      ORDER BY ${sortExpression} ${sortDirection}, COALESCE(candidate.total_reviews, 0) DESC, candidate.name ASC
      LIMIT $${paramsList.length}
    `;

    const result = await runQuery<MomentumRow>(sql, paramsList, this.config);
    return result.rows;
  }

  private resolveMomentumSortExpression(
    sortBy: DiscoverMomentumRequest['sortBy'],
    timeframe: '7d' | '30d' | 'current',
    baseAlias = 'ldm'
  ): string {
    switch (sortBy) {
      case 'ccu_peak':
        return `COALESCE(${baseAlias}.ccu_peak, 0)`;
      case 'review_score':
        return `COALESCE(${baseAlias}.positive_percentage, 0)`;
      case 'reviews_added_30d':
        return `GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)`;
      case 'reviews_added_7d':
        return `GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)`;
      case 'sentiment_delta':
        return this.buildSentimentDeltaExpression(timeframe, baseAlias);
      case 'total_reviews':
        return `COALESCE(${baseAlias}.total_reviews, 0)`;
      case 'velocity_acceleration':
        return `CASE
          WHEN GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0) > 0
            THEN (
              (
                GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)::numeric / 7
              ) - (
                GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)::numeric / 30
              )
            ) / NULLIF((GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline30.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)::numeric / 30), 0) * 100
          ELSE 0
        END`;
      case 'velocity_7d':
        return `GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)::numeric / 7`;
      case 'momentum_score':
      default:
        return `(
          GREATEST(COALESCE(${baseAlias}.total_reviews, 0) - COALESCE(baseline7.total_reviews, COALESCE(${baseAlias}.total_reviews, 0)), 0)
          + GREATEST(COALESCE(${baseAlias}.ccu_peak, 0) - COALESCE(baseline7.ccu_peak, COALESCE(${baseAlias}.ccu_peak, 0)), 0) / 10.0
          + GREATEST(
              COALESCE(${baseAlias}.positive_percentage, 0) - (
                CASE
                  WHEN COALESCE(baseline30.positive_reviews, 0) + COALESCE(baseline30.negative_reviews, 0) > 0
                    THEN (
                      COALESCE(baseline30.positive_reviews, 0)::numeric
                      / NULLIF(COALESCE(baseline30.positive_reviews, 0) + COALESCE(baseline30.negative_reviews, 0), 0)::numeric
                    ) * 100
                  ELSE COALESCE(${baseAlias}.positive_percentage, 0)
                END
              ),
              0
            ) * 2
        )`;
    }
  }

  private requiresMomentumBaseline7(params: {
    filters: DiscoverMomentumRequest['filters'] | null;
    sortBy: DiscoverMomentumRequest['sortBy'];
    timeframe: '7d' | '30d' | 'current';
    trendType: DiscoverMomentumRequest['trendType'];
  }): boolean {
    if (
      params.sortBy === 'momentum_score'
      || params.sortBy === 'velocity_7d'
      || params.sortBy === 'velocity_acceleration'
      || params.sortBy === 'reviews_added_7d'
      || params.trendType === 'accelerating'
      || params.trendType === 'declining'
    ) {
      return true;
    }

    if (params.sortBy === 'sentiment_delta' && params.timeframe === '7d') {
      return true;
    }

    return typeof params.filters?.minReviewsAdded7d === 'number'
      || (
        params.timeframe === '7d'
        && (
          typeof params.filters?.minSentimentDelta === 'number'
          || typeof params.filters?.maxSentimentDelta === 'number'
        )
      );
  }

  private requiresMomentumBaseline30(params: {
    filters: DiscoverMomentumRequest['filters'] | null;
    sortBy: DiscoverMomentumRequest['sortBy'];
    timeframe: '7d' | '30d' | 'current';
    trendType: DiscoverMomentumRequest['trendType'];
  }): boolean {
    if (
      params.sortBy === 'momentum_score'
      || params.sortBy === 'reviews_added_30d'
      || params.sortBy === 'sentiment_delta'
      || params.sortBy === 'velocity_acceleration'
      || params.trendType === 'accelerating'
      || params.trendType === 'breaking_out'
    ) {
      return true;
    }

    return typeof params.filters?.minReviewsAdded30d === 'number'
      || (
        params.timeframe !== '7d'
        && (
          typeof params.filters?.minSentimentDelta === 'number'
          || typeof params.filters?.maxSentimentDelta === 'number'
        )
      );
  }

  private buildMomentumBaselineJoin(params: {
    alias: 'baseline7' | 'baseline30';
    metricsDailyMetricsTable: string;
    required: boolean;
    windowDays: 7 | 30;
  }): string {
    if (!params.required) {
      return `
      LEFT JOIN LATERAL (
        SELECT
          NULL::int AS appid,
          NULL::double precision AS total_reviews,
          NULL::double precision AS positive_reviews,
          NULL::double precision AS negative_reviews,
          NULL::double precision AS ccu_peak
      ) ${params.alias} ON true`;
    }

    return `
      LEFT JOIN LATERAL (
        SELECT
          dm.total_reviews::double precision AS total_reviews,
          dm.positive_reviews::double precision AS positive_reviews,
          dm.negative_reviews::double precision AS negative_reviews,
          dm.ccu_peak::double precision AS ccu_peak
        FROM ${params.metricsDailyMetricsTable} dm
        WHERE dm.appid = candidate.appid
          AND dm.metric_date <= CURRENT_DATE - INTERVAL '${params.windowDays} days'
        ORDER BY dm.metric_date DESC
        LIMIT 1
      ) ${params.alias} ON true`;
  }

  private async queryExplainWindowMetrics(
    appid: number,
    start: Date,
    end: Date
  ): Promise<ExplainChangeMetricsWindow | null> {
    if (start >= end) {
      return null;
    }

    const result = await runQuery<ChangeWindowMetricRow>(
      `
        SELECT
          MAX(dm.ccu_peak)::double precision AS ccu_peak,
          MAX(dm.price_cents)::int AS price_cents,
          MAX(dm.discount_percent)::int AS discount_percent,
          MAX(dm.total_reviews)::double precision AS total_reviews,
          MAX(dm.positive_reviews)::double precision AS positive_reviews,
          MAX(dm.negative_reviews)::double precision AS negative_reviews,
          CASE
            WHEN MAX(COALESCE(dm.positive_reviews, 0) + COALESCE(dm.negative_reviews, 0)) > 0
              THEN ROUND(
                (
                  MAX(COALESCE(dm.positive_reviews, 0))::numeric
                  / NULLIF(MAX(COALESCE(dm.positive_reviews, 0) + COALESCE(dm.negative_reviews, 0)), 0)
                ) * 100,
                2
              )::double precision
            ELSE NULL
          END AS review_score
        FROM ${this.relation('metrics_daily_metrics').sql} dm
        WHERE dm.appid = $1
          AND dm.metric_date >= $2::date
          AND dm.metric_date < $3::date
      `,
      [appid, formatDateOnly(start), formatDateOnly(end)],
      this.config
    );

    const row = result.rows[0];
    if (!row || row.total_reviews == null && row.ccu_peak == null && row.review_score == null) {
      return null;
    }

    return {
      ccuPeak: row.ccu_peak,
      discountPercent: row.discount_percent,
      negativeReviews: row.negative_reviews,
      positiveReviews: row.positive_reviews,
      priceCents: row.price_cents,
      reviewScore: row.review_score,
      reviewScoreLabel: this.describeReviewScore(row.review_score),
      totalReviews: row.total_reviews,
    };
  }

  private async buildExplainComparisonWindows(
    appid: number,
    momentStart: Date,
    momentEnd: Date
  ): Promise<ExplainChangesResponse['comparisonWindows']> {
    return {
      baseline7d: await this.queryExplainWindowMetrics(appid, addUtcDays(momentStart, -7), momentStart),
      baseline30d: await this.queryExplainWindowMetrics(appid, addUtcDays(momentStart, -30), momentStart),
      response1d: await this.queryExplainWindowMetrics(appid, momentEnd, addUtcDays(momentEnd, 1)),
      response7d: await this.queryExplainWindowMetrics(appid, momentEnd, addUtcDays(momentEnd, 7)),
      response30d: await this.queryExplainWindowMetrics(appid, momentEnd, addUtcDays(momentEnd, 30)),
    };
  }

  private describeReviewScore(value: number | null): string | null {
    if (value == null) {
      return null;
    }
    if (value >= 95) {
      return 'Overwhelmingly Positive';
    }
    if (value >= 90) {
      return 'Very Positive';
    }
    if (value >= 80) {
      return 'Positive';
    }
    if (value >= 70) {
      return 'Mostly Positive';
    }
    if (value >= 40) {
      return 'Mixed';
    }
    return 'Mostly Negative';
  }

  private applyContinuationDeltaToSemanticSearchArgs(
    sourceArgs: SemanticSearchRequest,
    continuationToken: string | null,
    requestedCount: number,
    delta: ContinueResultSetRequest['delta']
  ): SemanticSearchRequest {
    const nextFilters = { ...(sourceArgs.filters ?? {}) };

    if (typeof delta?.maxPriceCents === 'number' && Number.isFinite(delta.maxPriceCents)) {
      const currentMaxPrice =
        typeof nextFilters.max_price_cents === 'number' && Number.isFinite(nextFilters.max_price_cents)
          ? nextFilters.max_price_cents
          : null;
      nextFilters.max_price_cents =
        currentMaxPrice == null
          ? Math.max(0, Math.trunc(delta.maxPriceCents))
          : Math.min(currentMaxPrice, Math.max(0, Math.trunc(delta.maxPriceCents)));
    }

    if (Array.isArray(delta?.steamDeck) && delta.steamDeck.length > 0) {
      nextFilters.steam_deck = [...new Set(delta.steamDeck)];
    }

    return {
      ...sourceArgs,
      continuationToken,
      filters: nextFilters,
      limit: requestedCount,
    };
  }

  private applyContinuationDeltaToDiscoverMomentumArgs(
    sourceArgs: DiscoverMomentumRequest,
    requestedCount: number,
    delta: ContinueResultSetRequest['delta']
  ): DiscoverMomentumRequest {
    const nextFilters = { ...(sourceArgs.filters ?? {}) };

    if (typeof delta?.maxPriceCents === 'number' && Number.isFinite(delta.maxPriceCents)) {
      const currentMaxPrice =
        typeof nextFilters.maxPriceCents === 'number' && Number.isFinite(nextFilters.maxPriceCents)
          ? nextFilters.maxPriceCents
          : null;
      nextFilters.maxPriceCents =
        currentMaxPrice == null
          ? Math.max(0, Math.trunc(delta.maxPriceCents))
          : Math.min(currentMaxPrice, Math.max(0, Math.trunc(delta.maxPriceCents)));
    }

    if (Array.isArray(delta?.steamDeck) && delta.steamDeck.length > 0) {
      nextFilters.steamDeck = [...new Set(delta.steamDeck)];
    }

    const excludeAppIds = [
      ...new Set(
        (sourceArgs.excludeAppIds ?? []).filter(
          (appid): appid is number => Number.isInteger(appid) && appid > 0
        )
      ),
    ];

    return {
      ...sourceArgs,
      excludeAppIds,
      ...(Object.keys(nextFilters).length > 0 ? { filters: nextFilters } : {}),
      limit: requestedCount,
    };
  }

  private buildTraceSeries(
    metric: TraceMetric,
    rows: DailyMetricHistoryRow[]
  ): TraceMetricHistorySeries {
    const points = rows.map((row) => ({
      date: row.metric_date,
      value: traceMetricValue(metric, row),
    }));
    const valuedPoints = points.filter(
      (point): point is { date: string; value: number } => point.value !== null
    );
    const firstPoint = valuedPoints[0] ?? null;
    const lastPoint = valuedPoints.at(-1) ?? null;
    const deltaAbs =
      firstPoint && lastPoint ? roundNumber(lastPoint.value - firstPoint.value, 2) : null;
    const deltaPct =
      firstPoint && lastPoint && firstPoint.value !== 0
        ? roundNumber(((lastPoint.value - firstPoint.value) / firstPoint.value) * 100, 2)
        : null;

    return {
      metric,
      points,
      summary: {
        deltaAbs,
        deltaPct,
        firstDate: firstPoint?.date ?? null,
        lastDate: lastPoint?.date ?? null,
        latestValue: lastPoint?.value ?? null,
        pointCount: valuedPoints.length,
        startValue: firstPoint?.value ?? null,
      },
    };
  }

  private normalizeTraceDateWindow(
    startDateInput: string | null,
    endDateInput: string | null
  ): { endDate: string; startDate: string } {
    const today = formatDateOnly(new Date());
    const endDate = endDateInput?.trim() ? this.validateDateOnly(endDateInput, 'endDate') : today;
    const startDate = startDateInput?.trim()
      ? this.validateDateOnly(startDateInput, 'startDate')
      : formatDateOnly(addUtcDays(parseDateOnly(endDate), -(DEFAULT_TRACE_DAYS - 1)));

    if (startDate > endDate) {
      throw new PublisherIQError(
        'startDate must be on or before endDate.',
        'INVALID_TRACE_DATE_RANGE',
        { endDate, startDate }
      );
    }

    const rangeDays =
      Math.floor((parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_TRACE_DAYS) {
      throw new PublisherIQError(
        `traceMetricHistory supports a maximum range of ${MAX_TRACE_DAYS} days.`,
        'TRACE_RANGE_TOO_LARGE',
        { endDate, rangeDays, startDate }
      );
    }

    return { endDate, startDate };
  }

  private normalizeTraceMetrics(metrics: TraceMetric[]): TraceMetric[] {
    if (!Array.isArray(metrics) || metrics.length === 0) {
      throw new PublisherIQError(
        'traceMetricHistory requires at least one metric.',
        'INVALID_TRACE_METRICS'
      );
    }

    const uniqueMetrics: TraceMetric[] = [];
    for (const metric of metrics) {
      if (!TRACE_METRIC_SET.has(metric)) {
        throw new PublisherIQError(
          `Unsupported trace metric: ${String(metric)}.`,
          'INVALID_TRACE_METRIC',
          { metric }
        );
      }

      if (!uniqueMetrics.includes(metric)) {
        uniqueMetrics.push(metric);
      }
    }

    if (uniqueMetrics.length > MAX_TRACE_METRICS) {
      throw new PublisherIQError(
        `traceMetricHistory supports at most ${MAX_TRACE_METRICS} metrics per request.`,
        'TRACE_TOO_MANY_METRICS',
        { metrics: uniqueMetrics }
      );
    }

    return uniqueMetrics;
  }

  private normalizeExplainTimeWindow(
    startTimeInput: string | null,
    endTimeInput: string | null
  ): { endTime: string; startTime: string } {
    const endDate = endTimeInput?.trim()
      ? this.validateIsoTimestamp(endTimeInput, 'endTime')
      : new Date();
    const startDate = startTimeInput?.trim()
      ? this.validateIsoTimestamp(startTimeInput, 'startTime')
      : new Date(endDate.getTime() - DEFAULT_EXPLAIN_CHANGES_DAYS * 24 * 60 * 60 * 1000);

    if (startDate.getTime() > endDate.getTime()) {
      throw new PublisherIQError(
        'startTime must be on or before endTime.',
        'INVALID_EXPLAIN_TIME_RANGE',
        {
          endTime: formatTimestamp(endDate),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    const rangeDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (rangeDays > MAX_EXPLAIN_CHANGES_DAYS) {
      throw new PublisherIQError(
        `explainChanges supports a maximum range of ${MAX_EXPLAIN_CHANGES_DAYS} days.`,
        'EXPLAIN_RANGE_TOO_LARGE',
        {
          endTime: formatTimestamp(endDate),
          rangeDays: roundNumber(rangeDays, 2),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    return {
      endTime: formatTimestamp(endDate),
      startTime: formatTimestamp(startDate),
    };
  }

  private normalizeExplainFilters(values: string[] | undefined): string[] {
    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }

    return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  }

  private normalizeDocumentTimeWindow(
    startTimeInput: string | null,
    endTimeInput: string | null
  ): { endTime: string; startTime: string } {
    const endDate = endTimeInput?.trim()
      ? this.validateIsoTimestamp(endTimeInput, 'endTime')
      : new Date();
    const startDate = startTimeInput?.trim()
      ? this.validateIsoTimestamp(startTimeInput, 'startTime')
      : new Date(endDate.getTime() - DEFAULT_DOCUMENT_SEARCH_DAYS * 24 * 60 * 60 * 1000);

    if (startDate.getTime() > endDate.getTime()) {
      throw new PublisherIQError(
        'startTime must be on or before endTime.',
        'INVALID_DOCUMENT_TIME_RANGE',
        {
          endTime: formatTimestamp(endDate),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    const rangeDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (rangeDays > MAX_DOCUMENT_SEARCH_DAYS) {
      throw new PublisherIQError(
        `searchDocuments supports a maximum range of ${MAX_DOCUMENT_SEARCH_DAYS} days.`,
        'DOCUMENT_RANGE_TOO_LARGE',
        {
          endTime: formatTimestamp(endDate),
          rangeDays: roundNumber(rangeDays, 2),
          startTime: formatTimestamp(startDate),
        }
      );
    }

    return {
      endTime: formatTimestamp(endDate),
      startTime: formatTimestamp(startDate),
    };
  }

  private normalizeFeedScopes(feedScopes: string[] | undefined): string[] {
    if (!Array.isArray(feedScopes) || feedScopes.length === 0) {
      return [];
    }

    return [
      ...new Set(
        feedScopes
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0)
      ),
    ];
  }

  private async queryMetricHistoryRows(
    appid: number,
    startDate: string,
    endDate: string
  ): Promise<DailyMetricHistoryRow[]> {
    const metricsTable = this.relation('metrics_daily_metrics').sql;
    const result = await runQuery<DailyMetricHistoryRow>(
      `
        SELECT
          metric_date::text,
          owners_min,
          owners_max,
          ccu_peak,
          average_playtime_forever,
          average_playtime_2weeks,
          total_reviews,
          positive_reviews,
          negative_reviews,
          review_score,
          price_cents,
          discount_percent
        FROM ${metricsTable}
        WHERE appid = $1
          AND metric_date BETWEEN $2::date AND $3::date
        ORDER BY metric_date ASC
      `,
      [appid, startDate, endDate],
      this.config
    );

    return result.rows;
  }

  private normalizeYoutubeCoverageView(view: string): YoutubeGameCoverageView {
    if (
      view === 'latest_videos'
      || view === 'creator_coverage'
      || view === 'top_videos'
      || view === 'video_growth'
      || view === 'content_mix'
      || view === 'cadence'
    ) {
      return view;
    }

    throw new PublisherIQError(
      'getYoutubeGameCoverage requires a supported view.',
      'INVALID_YOUTUBE_VIEW',
      { view }
    );
  }

  private normalizeYoutubeMarketPulseWindow(
    window: string | null
  ): Extract<YoutubeCoverageWindow, '1d' | '7d' | '30d'> {
    const normalized = (window ?? '7d').trim().toLowerCase();
    if (normalized === '1d' || normalized === '7d' || normalized === '30d') {
      return normalized;
    }

    throw new PublisherIQError(
      'getYoutubeMarketPulse requires a supported time window.',
      'INVALID_YOUTUBE_MARKET_WINDOW',
      { window: normalized }
    );
  }

  private normalizeYoutubeMarketPulseSort(sort: string): YoutubeMarketPulseSort {
    if (
      sort === 'steam_rank'
      || sort === 'youtube_velocity'
      || sort === 'new_videos'
      || sort === 'creator_breadth'
    ) {
      return sort;
    }

    throw new PublisherIQError(
      'getYoutubeMarketPulse requires a supported sort.',
      'INVALID_YOUTUBE_MARKET_SORT',
      { sort }
    );
  }

  private normalizeYoutubeContentClass(
    value: string | null
  ): YoutubeContentClass | null {
    if (!value) {
      return null;
    }

    if (
      value === 'standard_video'
      || value === 'short'
      || value === 'live_or_recent_live'
    ) {
      return value;
    }

    throw new PublisherIQError(
      'getYoutubeGameCoverage received an unsupported content class.',
      'INVALID_YOUTUBE_CONTENT_CLASS',
      { contentClass: value }
    );
  }

  private normalizeYoutubeCoverageLanguage(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'all') {
      return null;
    }

    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalized)) {
      throw new PublisherIQError(
        'getYoutubeGameCoverage received an unsupported language filter.',
        'INVALID_YOUTUBE_LANGUAGE',
        { language: normalized }
      );
    }

    return normalized;
  }

  private normalizeYoutubeCoverageWindow(
    view: YoutubeGameCoverageView,
    window: string | null
  ): YoutubeCoverageWindow {
    if (window == null || window.trim().length === 0) {
      if (view === 'video_growth') {
        return '1d';
      }

      if (view === 'content_mix' || view === 'cadence') {
        return '7d';
      }

      return 'current';
    }

    const normalizedWindow = window.trim().toLowerCase();
    if (
      normalizedWindow !== 'current'
      && this.parseYoutubeCoverageWindowDays(normalizedWindow) == null
    ) {
      throw new PublisherIQError(
        'getYoutubeGameCoverage requires a supported time window.',
        'INVALID_YOUTUBE_WINDOW',
        { window: normalizedWindow }
      );
    }

    if (view === 'video_growth' && normalizedWindow === 'current') {
      return '1d';
    }

    if ((view === 'content_mix' || view === 'cadence') && normalizedWindow === 'current') {
      return '7d';
    }

    return normalizedWindow as YoutubeCoverageWindow;
  }

  private buildYoutubeCoverageResponse(params: {
    availability: GetYoutubeGameCoverageResponse['availability'];
    cadence: YoutubeGameCoverageCadenceItem | null;
    contentClass: YoutubeContentClass | null;
    contentMix: YoutubeGameCoverageContentMixItem[];
    creators: YoutubeGameCoverageCreatorItem[];
    entity: YoutubeGameCoverageEntity;
    items: YoutubeGameCoverageVideoItem[];
    languageOptions?: YoutubeGameCoverageLanguageOption[];
    limit: number;
    pagination: YoutubeGameCoveragePagination | null;
    provenance: QueryProvenance;
    resolvedWindow: YoutubeCoverageWindow;
    summary: YoutubeGameCoverageSummary;
    view: YoutubeGameCoverageView;
  }): GetYoutubeGameCoverageResponse {
    const sufficientToAnswer =
      params.availability.state === 'ready'
      && (
        params.items.length > 0
        || params.creators.length > 0
        || params.contentMix.length > 0
        || Boolean(params.cadence)
      );

    return {
      availability: params.availability,
      cadence: params.cadence,
      contentClass: params.contentClass,
      contentMix: params.contentMix,
      creators: params.creators,
      entity: params.entity,
      items: params.items,
      languageOptions: params.languageOptions ?? [],
      limit: params.limit,
      pagination: params.pagination,
      provenance: params.provenance,
      resolvedWindow: params.resolvedWindow,
      sufficientToAnswer,
      summary: params.summary,
      view: params.view,
    };
  }

  private buildEmptyYoutubeCoverageSummary(): YoutubeGameCoverageSummary {
    return {
      distinctUploadChannels30d: 0,
      distinctUploadChannels7d: 0,
      freshestMatchedUploadAt: null,
      latestSnapshotAt: null,
      matchedPrimaryVideoCount: 0,
      matchedVideoViewDelta1d: 0,
      matchedVideoViewDelta7d: 0,
      newMatchedVideos1d: 0,
      newMatchedVideos30d: 0,
      newMatchedVideos7d: 0,
    };
  }

  private buildEmptyYoutubeMarketPulseSummary(): GetYoutubeMarketPulseResponse['summary'] {
    return {
      currentViews: 0,
      gamesAnalyzed: 0,
      gamesWithCoverage: 0,
      latestSnapshotAt: null,
      newMatchedVideos: 0,
      uploadChannels: 0,
      viewDelta: 0,
    };
  }

  private async queryYoutubeMarketPulseRows(params: {
    contentClass: YoutubeContentClass | null;
    limit: number;
    offset: number;
    sort: YoutubeMarketPulseSort;
    window: Extract<YoutubeCoverageWindow, '1d' | '7d' | '30d'>;
  }): Promise<{
    items: YoutubeMarketPulseItem[];
    summary: GetYoutubeMarketPulseResponse['summary'];
    totalRows: number;
  }> {
    const appsTable = this.relation('apps').sql;
    const latestMetricsTable = this.relation('latest_daily_metrics').sql;
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const rollupsTable = this.relation('metrics_youtube_game_daily').sql;
    const orderBy =
      params.sort === 'youtube_velocity'
        ? 'view_delta DESC NULLS LAST, new_matched_videos DESC NULLS LAST, upload_channels DESC NULLS LAST, steam_rank ASC'
        : params.sort === 'new_videos'
          ? 'new_matched_videos DESC NULLS LAST, upload_channels DESC NULLS LAST, view_delta DESC NULLS LAST, steam_rank ASC'
          : params.sort === 'creator_breadth'
            ? 'upload_channels DESC NULLS LAST, new_matched_videos DESC NULLS LAST, view_delta DESC NULLS LAST, steam_rank ASC'
            : 'steam_rank ASC';

    const result = await runQuery<YoutubeMarketPulseRow>(
      `
        WITH steam_ranked AS (
          SELECT
            a.appid,
            a.name,
            COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
            ldm.review_score,
            ldm.total_reviews,
            row_number() OVER (
              ORDER BY COALESCE(ldm.ccu_peak, 0) DESC, COALESCE(ldm.total_reviews, 0) DESC, a.appid ASC
            )::int AS steam_rank
          FROM ${appsTable} a
          LEFT JOIN ${latestMetricsTable} ldm ON ldm.appid = a.appid
          WHERE a.type = 'game'
            AND COALESCE(a.is_delisted, FALSE) = FALSE
            AND COALESCE(a.is_released, TRUE) = TRUE
          ORDER BY COALESCE(ldm.ccu_peak, 0) DESC, COALESCE(ldm.total_reviews, 0) DESC, a.appid ASC
          LIMIT ${YOUTUBE_MARKET_CANDIDATE_LIMIT}
        ),
        latest_rollup_date AS (
          SELECT max(metric_date) AS metric_date
          FROM ${rollupsTable}
        ),
        rollups AS (
          SELECT
            appid,
            content_class,
            matched_primary_video_count::bigint AS matched_primary_video_count,
            CASE $4::text
              WHEN '1d' THEN new_matched_videos_1d
              WHEN '30d' THEN new_matched_videos_30d
              ELSE new_matched_videos_7d
            END::bigint AS new_matched_videos,
            CASE $4::text
              WHEN '30d' THEN distinct_upload_channels_30d
              ELSE distinct_upload_channels_7d
            END::bigint AS upload_channels,
            CASE $4::text
              WHEN '1d' THEN matched_video_view_delta_1d
              WHEN '30d' THEN matched_video_view_delta_7d
              ELSE matched_video_view_delta_7d
            END::bigint AS view_delta,
            latest_snapshot_at::text AS latest_snapshot_at
          FROM ${rollupsTable}
          WHERE metric_date = (SELECT metric_date FROM latest_rollup_date)
            AND ($1::text IS NULL OR content_class = $1::text)
        ),
        rollup_totals AS (
          SELECT
            appid,
            sum(matched_primary_video_count)::bigint AS matched_primary_video_count,
            sum(new_matched_videos)::bigint AS new_matched_videos,
            sum(upload_channels)::bigint AS upload_channels,
            sum(view_delta)::bigint AS view_delta,
            max(latest_snapshot_at)::text AS latest_snapshot_at
          FROM rollups
          GROUP BY appid
        ),
        content_totals AS (
          SELECT
            r.appid,
            0::bigint AS current_views,
            sum(r.matched_primary_video_count)::bigint AS matched_primary_video_count,
            sum(r.new_matched_videos)::bigint AS new_matched_videos,
            sum(r.view_delta)::bigint AS view_delta,
            (
              array_agg(r.content_class ORDER BY r.new_matched_videos DESC, r.view_delta DESC, r.matched_primary_video_count DESC)
            )[1]::text AS dominant_content_class,
            jsonb_agg(
              jsonb_build_object(
                'contentClass', r.content_class,
                'currentViews', 0,
                'matchedPrimaryVideoCount', r.matched_primary_video_count,
                'newMatchedVideos', r.new_matched_videos,
                'viewDelta', r.view_delta
              )
              ORDER BY
                CASE r.content_class
                  WHEN 'standard_video' THEN 1
                  WHEN 'short' THEN 2
                  ELSE 3
                END
            ) AS content_mix
          FROM rollups r
          GROUP BY r.appid
        ),
        match_quality AS (
          SELECT
            m.appid,
            count(*) FILTER (WHERE m.match_state = 'ambiguous')::bigint AS ambiguous_match_count,
            count(*) FILTER (WHERE m.match_state = 'rejected')::bigint AS rejected_match_count
          FROM ${matchesTable} m
          JOIN steam_ranked sr ON sr.appid = m.appid
          GROUP BY m.appid
        ),
        ranked AS (
          SELECT
            sr.appid,
            sr.name,
            sr.ccu_peak,
            sr.review_score,
            sr.total_reviews,
            sr.steam_rank,
            COALESCE(ct.current_views, 0)::bigint AS current_views,
            COALESCE(ct.matched_primary_video_count, rt.matched_primary_video_count, 0)::bigint AS matched_primary_video_count,
            COALESCE(rt.new_matched_videos, ct.new_matched_videos, 0)::bigint AS new_matched_videos,
            COALESCE(rt.upload_channels, 0)::bigint AS upload_channels,
            COALESCE(ct.view_delta, 0)::bigint AS view_delta,
            COALESCE(ct.dominant_content_class, NULL)::text AS dominant_content_class,
            COALESCE(rt.latest_snapshot_at, NULL)::text AS latest_snapshot_at,
            COALESCE(ct.content_mix, '[]'::jsonb) AS content_mix,
            '[]'::jsonb AS latest_videos,
            COALESCE(mq.ambiguous_match_count, 0)::bigint AS ambiguous_match_count,
            COALESCE(mq.rejected_match_count, 0)::bigint AS rejected_match_count
          FROM steam_ranked sr
          LEFT JOIN content_totals ct ON ct.appid = sr.appid
          LEFT JOIN rollup_totals rt ON rt.appid = sr.appid
          LEFT JOIN match_quality mq ON mq.appid = sr.appid
        ),
        ordered AS (
          SELECT *, count(*) OVER ()::int AS total_rows
          FROM ranked
          ORDER BY ${orderBy}
        )
        SELECT *
        FROM ordered
        LIMIT $2
        OFFSET $3
      `,
      [params.contentClass, params.limit, params.offset, params.window],
      this.config
    );

    const items = result.rows.map((row) => this.mapYoutubeMarketPulseRow(row));
    const totalRows = parseCountValue(result.rows[0]?.total_rows);
    const enrichedItems = await this.enrichYoutubeMarketPulseItems({
      contentClass: params.contentClass,
      items,
    });
    const summary = enrichedItems.reduce<GetYoutubeMarketPulseResponse['summary']>(
      (accumulator, item) => ({
        gamesAnalyzed: totalRows || accumulator.gamesAnalyzed,
        gamesWithCoverage:
          accumulator.gamesWithCoverage + (item.matchedPrimaryVideoCount > 0 ? 1 : 0),
        latestSnapshotAt:
          !accumulator.latestSnapshotAt
            ? item.latestSnapshotAt
            : item.latestSnapshotAt && item.latestSnapshotAt > accumulator.latestSnapshotAt
              ? item.latestSnapshotAt
              : accumulator.latestSnapshotAt,
        newMatchedVideos: accumulator.newMatchedVideos + item.newMatchedVideos,
        uploadChannels: accumulator.uploadChannels + item.uploadChannels,
        currentViews: accumulator.currentViews + item.currentViews,
        viewDelta: accumulator.viewDelta + item.viewDelta,
      }),
      {
        ...this.buildEmptyYoutubeMarketPulseSummary(),
        gamesAnalyzed: totalRows,
      }
    );

    return {
      items: enrichedItems,
      summary,
      totalRows,
    };
  }

  private mapYoutubeMarketPulseRow(row: YoutubeMarketPulseRow): YoutubeMarketPulseItem {
    const matchedPrimaryVideoCount = parseCountValue(row.matched_primary_video_count);
    const ambiguousMatchCount = parseCountValue(row.ambiguous_match_count);
    const rejectedMatchCount = parseCountValue(row.rejected_match_count);
    const noisyMatchCount = ambiguousMatchCount + rejectedMatchCount;
    const noiseRatio =
      matchedPrimaryVideoCount > 0
        ? noisyMatchCount / Math.max(matchedPrimaryVideoCount + noisyMatchCount, 1)
        : 0;
    const coverageQuality =
      matchedPrimaryVideoCount === 0
        ? 'none'
        : noiseRatio >= 0.35
          ? 'noisy'
          : matchedPrimaryVideoCount >= 20
            ? 'strong'
            : 'limited';

    return {
      appid: parseCountValue(row.appid),
      ccuPeak: row.ccu_peak == null ? null : parseCountValue(row.ccu_peak),
      contentMix: this.parseYoutubeMarketContentMix(row.content_mix),
      coverageQuality,
      currentViews: parseCountValue(row.current_views),
      dominantContentClass: this.parseYoutubeContentClassValue(row.dominant_content_class),
      entityUid: buildEntityUid('steam', 'game', String(parseCountValue(row.appid))),
      latestSnapshotAt: row.latest_snapshot_at,
      latestVideos: this.parseYoutubeMarketVideos(row.latest_videos),
      matchedPrimaryVideoCount,
      name: row.name,
      newMatchedVideos: parseCountValue(row.new_matched_videos),
      reviewScore: row.review_score == null ? null : Number(row.review_score),
      steamRank: parseCountValue(row.steam_rank),
      totalReviews: row.total_reviews == null ? null : parseCountValue(row.total_reviews),
      uploadChannels: parseCountValue(row.upload_channels),
      viewDelta: parseCountValue(row.view_delta),
    };
  }

  private async enrichYoutubeMarketPulseItems(params: {
    contentClass: YoutubeContentClass | null;
    items: YoutubeMarketPulseItem[];
  }): Promise<YoutubeMarketPulseItem[]> {
    if (params.items.length === 0) {
      return params.items;
    }

    const appids = params.items.map((item) => item.appid);
    const [currentViewsByApp, latestVideosByApp] = await Promise.all([
      this.queryYoutubeMarketCurrentViewsForApps({
        appids,
        contentClass: params.contentClass,
      }),
      this.queryYoutubeMarketLatestVideosForApps({
        appids,
        contentClass: params.contentClass,
      }),
    ]);

    return params.items.map((item) => {
      const viewRows = currentViewsByApp.get(item.appid) ?? new Map<YoutubeContentClass, number>();
      const contentMix = item.contentMix.map((mix) => ({
        ...mix,
        currentViews: viewRows.get(mix.contentClass) ?? mix.currentViews,
      }));
      const currentViews = contentMix.reduce(
        (total, mix) => total + mix.currentViews,
        0
      );

      return {
        ...item,
        contentMix,
        currentViews,
        latestVideos: latestVideosByApp.get(item.appid) ?? item.latestVideos,
      };
    });
  }

  private async queryYoutubeMarketCurrentViewsForApps(params: {
    appids: number[];
    contentClass: YoutubeContentClass | null;
  }): Promise<Map<number, Map<YoutubeContentClass, number>>> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const result = await runQuery<YoutubeMarketPulseCurrentViewRow>(
      `
        SELECT
          m.appid,
          v.content_class,
          COALESCE(sum(COALESCE(v.view_count, 0)), 0)::bigint AS current_views
        FROM ${matchesTable} m
        JOIN ${videosTable} v ON v.video_id = m.video_id
        WHERE m.appid = ANY($1::int[])
          AND m.match_state = 'matched_primary'
          AND ($2::text IS NULL OR v.content_class = $2::text)
        GROUP BY m.appid, v.content_class
      `,
      [params.appids, params.contentClass],
      this.config
    );

    const byApp = new Map<number, Map<YoutubeContentClass, number>>();
    for (const row of result.rows) {
      const appid = parseCountValue(row.appid);
      if (!byApp.has(appid)) {
        byApp.set(appid, new Map<YoutubeContentClass, number>());
      }
      byApp.get(appid)!.set(row.content_class, parseCountValue(row.current_views));
    }

    return byApp;
  }

  private async queryYoutubeMarketLatestVideosForApps(params: {
    appids: number[];
    contentClass: YoutubeContentClass | null;
  }): Promise<Map<number, YoutubeMarketPulseVideoItem[]>> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const channelsTable = this.relation('docs_youtube_channels').sql;
    const result = await runQuery<YoutubeMarketPulseLatestVideoRow>(
      `
        WITH ranked_videos AS (
          SELECT
            m.appid,
            v.video_id,
            v.title,
            v.published_at::text AS published_at,
            v.content_class,
            v.view_count,
            NULL::bigint AS view_delta,
            v.channel_id,
            COALESCE(c.title, v.channel_title, v.channel_id) AS channel_title,
            row_number() OVER (
              PARTITION BY m.appid
              ORDER BY v.published_at DESC NULLS LAST, v.video_id ASC
            ) AS video_rank
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          LEFT JOIN ${channelsTable} c ON c.channel_id = v.channel_id
          WHERE m.appid = ANY($1::int[])
            AND m.match_state = 'matched_primary'
            AND ($2::text IS NULL OR v.content_class = $2::text)
        )
        SELECT *
        FROM ranked_videos
        WHERE video_rank <= 10
        ORDER BY appid ASC, video_rank ASC
      `,
      [params.appids, params.contentClass],
      this.config
    );

    const byApp = new Map<number, YoutubeMarketPulseVideoItem[]>();
    for (const row of result.rows) {
      const appid = parseCountValue(row.appid);
      const videos = byApp.get(appid) ?? [];
      videos.push({
        channelId: row.channel_id ?? '',
        channelTitle: row.channel_title ?? 'Unknown channel',
        contentClass: row.content_class,
        publishedAt: row.published_at,
        title: row.title ?? 'Untitled video',
        url: `https://www.youtube.com/watch?v=${row.video_id}`,
        videoId: row.video_id,
        viewCount: parseNullableCountValue(row.view_count),
        viewDelta: parseNullableCountValue(row.view_delta),
      });
      byApp.set(appid, videos);
    }

    return byApp;
  }

  private parseYoutubeMarketContentMix(value: unknown): YoutubeMarketPulseContentMixItem[] {
    const rows = this.parseJsonArray(value);
    return rows
      .map((row) => {
        const contentClass = this.parseYoutubeContentClassValue(row.contentClass);
        if (!contentClass) {
          return null;
        }

        return {
          contentClass,
          currentViews: parseCountValue(row.currentViews),
          matchedPrimaryVideoCount: parseCountValue(row.matchedPrimaryVideoCount),
          newMatchedVideos: parseCountValue(row.newMatchedVideos),
          viewDelta: parseCountValue(row.viewDelta),
        };
      })
      .filter((row): row is YoutubeMarketPulseContentMixItem => Boolean(row));
  }

  private parseYoutubeMarketVideos(value: unknown): YoutubeMarketPulseVideoItem[] {
    const rows = this.parseJsonArray(value);
    return rows
      .map((row) => {
        const contentClass = this.parseYoutubeContentClassValue(row.contentClass);
        const videoId = typeof row.videoId === 'string' ? row.videoId : null;
        if (!contentClass || !videoId) {
          return null;
        }

        return {
          channelId: typeof row.channelId === 'string' ? row.channelId : '',
          channelTitle: typeof row.channelTitle === 'string' ? row.channelTitle : 'Unknown channel',
          contentClass,
          publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : null,
          title: typeof row.title === 'string' ? row.title : 'Untitled video',
          url:
            typeof row.url === 'string'
              ? row.url
              : `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          viewCount: row.viewCount == null ? null : parseCountValue(row.viewCount),
          viewDelta: row.viewDelta == null ? null : parseCountValue(row.viewDelta),
        };
      })
      .filter((row): row is YoutubeMarketPulseVideoItem => Boolean(row));
  }

  private parseJsonArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
      );
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.parseJsonArray(parsed);
      } catch {
        return [];
      }
    }

    return [];
  }

  private parseYoutubeContentClassValue(value: unknown): YoutubeContentClass | null {
    return value === 'standard_video' || value === 'short' || value === 'live_or_recent_live'
      ? value
      : null;
  }

  private buildYoutubePagination(params: {
    limit: number;
    offset: number;
    totalRows: number;
  }): YoutubeGameCoveragePagination {
    return {
      hasNextPage: params.offset + params.limit < params.totalRows,
      hasPreviousPage: params.offset > 0,
      limit: params.limit,
      offset: params.offset,
      totalRows: params.totalRows,
    };
  }

  private isBlockedYoutubeGameTitle(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return normalized === 'menace' || normalized === 'forager';
  }

  private youtubePublishedWindowPredicate(
    alias: string,
    window: YoutubeCoverageWindow
  ): string {
    if (window === 'current') {
      return '';
    }

    return ` AND ${alias}.published_at >= now() - ${this.youtubeIntervalLiteral(window)}`;
  }

  private youtubeSnapshotWindowPredicate(
    alias: string,
    window: Exclude<YoutubeCoverageWindow, 'current'>
  ): string {
    return ` AND ${alias}.snapshot_time >= now() - ${this.youtubeIntervalLiteral(window)}`;
  }

  private youtubeIntervalLiteral(
    window: Exclude<YoutubeCoverageWindow, 'current'>
  ): string {
    const days = this.parseYoutubeCoverageWindowDays(window);
    if (days == null) {
      throw new PublisherIQError(
        'getYoutubeGameCoverage requires a supported time window.',
        'INVALID_YOUTUBE_WINDOW',
        { window }
      );
    }

    return `INTERVAL '${days} days'`;
  }

  private parseYoutubeCoverageWindowDays(
    window: string
  ): 1 | 2 | 3 | 7 | 14 | 30 | null {
    const match = window.match(/^(\d+)d$/);
    if (!match) {
      return null;
    }

    const days = Number(match[1]);
    if (
      days === 1
      || days === 2
      || days === 3
      || days === 7
      || days === 14
      || days === 30
    ) {
      return days;
    }

    return null;
  }

  private async queryYoutubeGameOverrideState(appid: number): Promise<string | null> {
    const existsResult = await runQuery<{ exists: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      ['ops.youtube_game_overrides'],
      this.config
    );

    if (!(existsResult.rows[0]?.exists ?? false)) {
      return null;
    }

    const result = await runQuery<{ override_state: string | null }>(
      `
        SELECT override_state
        FROM ops.youtube_game_overrides
        WHERE appid = $1
        LIMIT 1
      `,
      [appid],
      this.config
    );

    return result.rows[0]?.override_state ?? null;
  }

  private async queryYoutubeCoverageSummary(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
  }): Promise<YoutubeGameCoverageSummary> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const summaryResult = await runQuery<YoutubeCoverageSummaryRow>(
      `
        WITH matched_videos AS (
          SELECT
            v.video_id,
            v.channel_id,
            v.published_at
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          WHERE m.appid = $1
            AND m.match_state = 'matched_primary'
            AND ($2::text IS NULL OR v.content_class = $2::text)
        )
        SELECT
          COALESCE((SELECT count(*)::int FROM matched_videos), 0) AS matched_primary_video_count,
          COALESCE(
            (SELECT count(*)::int FROM matched_videos WHERE published_at >= now() - INTERVAL '1 day'),
            0
          ) AS new_matched_videos_1d,
          COALESCE(
            (SELECT count(*)::int FROM matched_videos WHERE published_at >= now() - INTERVAL '7 days'),
            0
          ) AS new_matched_videos_7d,
          COALESCE(
            (SELECT count(*)::int FROM matched_videos WHERE published_at >= now() - INTERVAL '30 days'),
            0
          ) AS new_matched_videos_30d,
          COALESCE(
            (
              SELECT count(DISTINCT channel_id)::int
              FROM matched_videos
              WHERE published_at >= now() - INTERVAL '7 days'
            ),
            0
          ) AS distinct_upload_channels_7d,
          COALESCE(
            (
              SELECT count(DISTINCT channel_id)::int
              FROM matched_videos
              WHERE published_at >= now() - INTERVAL '30 days'
            ),
            0
          ) AS distinct_upload_channels_30d,
          (
            SELECT max(published_at)::text
            FROM matched_videos
          ) AS freshest_matched_upload_at,
          (
            SELECT max(snapshot_time)::text
            FROM ${snapshotsTable}
            WHERE appid = $1
              AND ($2::text IS NULL OR content_class = $2::text)
          ) AS latest_snapshot_at,
          NULL::bigint AS matched_video_view_delta_1d,
          NULL::bigint AS matched_video_view_delta_7d
      `,
      [params.appid, params.contentClass],
      this.config
    );

    const row = summaryResult.rows[0];
    if (!row) {
      return this.buildEmptyYoutubeCoverageSummary();
    }

    return {
      distinctUploadChannels30d: row.distinct_upload_channels_30d ?? 0,
      distinctUploadChannels7d: row.distinct_upload_channels_7d ?? 0,
      freshestMatchedUploadAt: row.freshest_matched_upload_at,
      latestSnapshotAt: row.latest_snapshot_at,
      matchedPrimaryVideoCount: row.matched_primary_video_count ?? 0,
      matchedVideoViewDelta1d: await this.queryYoutubeAggregateViewDelta({
        appid: params.appid,
        contentClass: params.contentClass,
        window: '1d',
      }),
      matchedVideoViewDelta7d: await this.queryYoutubeAggregateViewDelta({
        appid: params.appid,
        contentClass: params.contentClass,
        window: '7d',
      }),
      newMatchedVideos1d: row.new_matched_videos_1d ?? 0,
      newMatchedVideos30d: row.new_matched_videos_30d ?? 0,
      newMatchedVideos7d: row.new_matched_videos_7d ?? 0,
    };
  }

  private async queryYoutubeLatestVideoRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    limit: number;
    offset: number;
    window: YoutubeCoverageWindow;
  }): Promise<YoutubeCoveragePage<YoutubeGameCoverageVideoItem>> {
    const [rows, totalRows] = await Promise.all([
      this.queryYoutubeRankedVideoRows({
        ...params,
        orderBy: 'v.published_at DESC NULLS LAST, v.video_id ASC',
      }),
      this.queryYoutubeRankedVideoRowCount(params),
    ]);

    return { rows, totalRows };
  }

  private async queryYoutubeTopVideoRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    limit: number;
    offset: number;
    window: YoutubeCoverageWindow;
  }): Promise<YoutubeCoveragePage<YoutubeGameCoverageVideoItem>> {
    const [rows, totalRows] = await Promise.all([
      this.queryYoutubeRankedVideoRows({
        ...params,
        orderBy: 'view_count DESC NULLS LAST, v.published_at DESC NULLS LAST, v.video_id ASC',
      }),
      this.queryYoutubeRankedVideoRowCount(params),
    ]);

    return { rows, totalRows };
  }

  private async queryYoutubeRankedVideoRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    limit: number;
    offset: number;
    orderBy: string;
    window: YoutubeCoverageWindow;
  }): Promise<YoutubeGameCoverageVideoItem[]> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const channelsTable = this.relation('docs_youtube_channels').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const result = await runQuery<YoutubeVideoCoverageRow>(
      `
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (s.video_id)
            s.video_id,
            s.view_count
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
          ORDER BY s.video_id, s.snapshot_time DESC
        )
        SELECT
          v.video_id,
          v.title,
          v.published_at::text,
          v.content_class,
          v.default_audio_language,
          v.default_language,
          CASE
            WHEN COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')) ILIKE 'en%'
              THEN 'en'
            ELSE lower(COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')))
          END AS language_code,
          COALESCE(
            v.raw_latest_payload #>> '{snippet,thumbnails,medium,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,high,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,standard,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,maxres,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,default,url}'
          ) AS thumbnail_url,
          COALESCE(v.view_count, latest_snapshots.view_count) AS view_count,
          v.like_count,
          v.comment_count,
          v.channel_id,
          COALESCE(c.title, v.channel_title, v.channel_id) AS channel_title,
          c.subscriber_count AS channel_subscriber_count,
          c.country AS channel_country,
          m.confidence_score::double precision AS confidence_score,
          m.matched_alias,
          NULL::text AS first_snapshot_at,
          NULL::text AS last_snapshot_at,
          NULL::bigint AS view_delta,
          NULL::double precision AS growth_pct
        FROM ${matchesTable} m
        JOIN ${videosTable} v ON v.video_id = m.video_id
        LEFT JOIN ${channelsTable} c ON c.channel_id = v.channel_id
        LEFT JOIN latest_snapshots ON latest_snapshots.video_id = v.video_id
        WHERE m.appid = $1
          AND m.match_state = 'matched_primary'
          AND ($2::text IS NULL OR v.content_class = $2::text)
          AND (
            $5::text IS NULL
            OR ($5::text = 'en' AND COALESCE(v.default_language, v.default_audio_language, '') ILIKE 'en%')
            OR lower(COALESCE(v.default_language, v.default_audio_language, '')) = $5::text
          )
          ${this.youtubePublishedWindowPredicate('v', params.window)}
        ORDER BY ${params.orderBy}
        LIMIT $3
        OFFSET $4
      `,
      [params.appid, params.contentClass, params.limit, params.offset, params.language],
      this.config
    );

    return result.rows.map((row) => this.mapYoutubeVideoItem(row));
  }

  private async queryYoutubeRankedVideoRowCount(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    window: YoutubeCoverageWindow;
  }): Promise<number> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const result = await runQuery<{ total_rows: number }>(
      `
        SELECT count(*)::int AS total_rows
        FROM ${matchesTable} m
        JOIN ${videosTable} v ON v.video_id = m.video_id
        WHERE m.appid = $1
          AND m.match_state = 'matched_primary'
          AND ($2::text IS NULL OR v.content_class = $2::text)
          AND (
            $3::text IS NULL
            OR ($3::text = 'en' AND COALESCE(v.default_language, v.default_audio_language, '') ILIKE 'en%')
            OR lower(COALESCE(v.default_language, v.default_audio_language, '')) = $3::text
          )
          ${this.youtubePublishedWindowPredicate('v', params.window)}
      `,
      [params.appid, params.contentClass, params.language],
      this.config
    );

    return result.rows[0]?.total_rows ?? 0;
  }

  private async queryYoutubeVideoGrowthRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    limit: number;
    offset: number;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<YoutubeCoveragePage<YoutubeGameCoverageVideoItem>> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const channelsTable = this.relation('docs_youtube_channels').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const [result, totalRows] = await Promise.all([
      runQuery<YoutubeVideoCoverageRow>(
      `
        WITH scoped_snapshots AS (
          SELECT
            s.video_id,
            MIN(s.snapshot_time) AS first_snapshot_at,
            MAX(s.snapshot_time) AS last_snapshot_at
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
            ${this.youtubeSnapshotWindowPredicate('s', params.window)}
          GROUP BY s.video_id
          HAVING MIN(s.snapshot_time) < MAX(s.snapshot_time)
        )
        SELECT
          v.video_id,
          v.title,
          v.published_at::text,
          v.content_class,
          v.default_audio_language,
          v.default_language,
          CASE
            WHEN COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')) ILIKE 'en%'
              THEN 'en'
            ELSE lower(COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')))
          END AS language_code,
          COALESCE(
            v.raw_latest_payload #>> '{snippet,thumbnails,medium,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,high,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,standard,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,maxres,url}',
            v.raw_latest_payload #>> '{snippet,thumbnails,default,url}'
          ) AS thumbnail_url,
          last_snapshot.view_count,
          v.like_count,
          v.comment_count,
          v.channel_id,
          COALESCE(c.title, v.channel_title, v.channel_id) AS channel_title,
          c.subscriber_count AS channel_subscriber_count,
          c.country AS channel_country,
          m.confidence_score::double precision AS confidence_score,
          m.matched_alias,
          scoped.first_snapshot_at::text,
          scoped.last_snapshot_at::text,
          GREATEST(last_snapshot.view_count - first_snapshot.view_count, 0)::bigint AS view_delta,
          CASE
            WHEN first_snapshot.view_count > 0
              THEN (
                GREATEST(last_snapshot.view_count - first_snapshot.view_count, 0)::double precision
                / first_snapshot.view_count::double precision
              ) * 100.0
            ELSE NULL
          END AS growth_pct
        FROM scoped_snapshots scoped
        JOIN ${snapshotsTable} first_snapshot
          ON first_snapshot.video_id = scoped.video_id
         AND first_snapshot.snapshot_time = scoped.first_snapshot_at
        JOIN ${snapshotsTable} last_snapshot
          ON last_snapshot.video_id = scoped.video_id
         AND last_snapshot.snapshot_time = scoped.last_snapshot_at
        JOIN ${matchesTable} m
          ON m.video_id = scoped.video_id
         AND m.appid = $1
         AND m.match_state = 'matched_primary'
        JOIN ${videosTable} v ON v.video_id = scoped.video_id
        LEFT JOIN ${channelsTable} c ON c.channel_id = v.channel_id
        WHERE GREATEST(last_snapshot.view_count - first_snapshot.view_count, 0) > 0
          AND (
            $5::text IS NULL
            OR ($5::text = 'en' AND COALESCE(v.default_language, v.default_audio_language, '') ILIKE 'en%')
            OR lower(COALESCE(v.default_language, v.default_audio_language, '')) = $5::text
          )
        ORDER BY view_delta DESC, view_count DESC NULLS LAST, v.published_at DESC NULLS LAST, v.video_id ASC
        LIMIT $3
        OFFSET $4
      `,
      [params.appid, params.contentClass, params.limit, params.offset, params.language],
      this.config
    ),
      this.queryYoutubeVideoGrowthRowCount(params),
    ]);

    return {
      rows: result.rows.map((row) => this.mapYoutubeVideoItem(row)),
      totalRows,
    };
  }

  private async queryYoutubeCreatorCoverageRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    limit: number;
    offset: number;
    window: YoutubeCoverageWindow;
  }): Promise<YoutubeCoveragePage<YoutubeGameCoverageCreatorItem>> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const channelsTable = this.relation('docs_youtube_channels').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const [result, totalRows] = await Promise.all([
      runQuery<YoutubeCreatorCoverageRow>(
      `
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (s.video_id)
            s.video_id,
            s.view_count
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
          ORDER BY s.video_id, s.snapshot_time DESC
        )
        SELECT
          v.channel_id,
          COALESCE(c.title, max(v.channel_title), v.channel_id) AS channel_title,
          c.subscriber_count AS channel_subscriber_count,
          c.country AS channel_country,
          count(*)::int AS matched_video_count,
          max(v.published_at)::text AS latest_matched_upload_at,
          sum(COALESCE(v.view_count, latest_snapshots.view_count, 0))::bigint AS total_matched_views
        FROM ${matchesTable} m
        JOIN ${videosTable} v ON v.video_id = m.video_id
        LEFT JOIN ${channelsTable} c ON c.channel_id = v.channel_id
        LEFT JOIN latest_snapshots ON latest_snapshots.video_id = v.video_id
        WHERE m.appid = $1
          AND m.match_state = 'matched_primary'
          AND ($2::text IS NULL OR v.content_class = $2::text)
          ${this.youtubePublishedWindowPredicate('v', params.window)}
        GROUP BY v.channel_id, c.title, c.subscriber_count, c.country
        ORDER BY
          matched_video_count DESC,
          total_matched_views DESC NULLS LAST,
          latest_matched_upload_at DESC NULLS LAST,
          channel_title ASC
        LIMIT $3
        OFFSET $4
      `,
      [params.appid, params.contentClass, params.limit, params.offset],
      this.config
    ),
      this.queryYoutubeCreatorCoverageRowCount(params),
    ]);

    return {
      rows: result.rows.map((row) => ({
        channelCountry: row.channel_country,
        channelId: row.channel_id,
        channelSubscriberCount: row.channel_subscriber_count,
        channelTitle: row.channel_title,
        latestMatchedUploadAt: row.latest_matched_upload_at,
        matchedVideoCount: row.matched_video_count,
        totalMatchedViews: row.total_matched_views,
      })),
      totalRows,
    };
  }

  private async queryYoutubeVideoGrowthRowCount(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    language: string | null;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<number> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const result = await runQuery<{ total_rows: number }>(
      `
        WITH scoped_snapshots AS (
          SELECT
            s.video_id,
            MIN(s.snapshot_time) AS first_snapshot_at,
            MAX(s.snapshot_time) AS last_snapshot_at
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
            ${this.youtubeSnapshotWindowPredicate('s', params.window)}
          GROUP BY s.video_id
          HAVING MIN(s.snapshot_time) < MAX(s.snapshot_time)
        )
        SELECT count(*)::int AS total_rows
        FROM scoped_snapshots scoped
        JOIN ${matchesTable} m
          ON m.video_id = scoped.video_id
         AND m.appid = $1
         AND m.match_state = 'matched_primary'
        JOIN ${videosTable} v ON v.video_id = scoped.video_id
        JOIN ${snapshotsTable} first_snapshot
          ON first_snapshot.video_id = scoped.video_id
         AND first_snapshot.snapshot_time = scoped.first_snapshot_at
        JOIN ${snapshotsTable} last_snapshot
          ON last_snapshot.video_id = scoped.video_id
         AND last_snapshot.snapshot_time = scoped.last_snapshot_at
        WHERE GREATEST(last_snapshot.view_count - first_snapshot.view_count, 0) > 0
          AND (
            $3::text IS NULL
            OR ($3::text = 'en' AND COALESCE(v.default_language, v.default_audio_language, '') ILIKE 'en%')
            OR lower(COALESCE(v.default_language, v.default_audio_language, '')) = $3::text
          )
      `,
      [params.appid, params.contentClass, params.language],
      this.config
    );

    return result.rows[0]?.total_rows ?? 0;
  }

  private async queryYoutubeVideoLanguageOptions(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: YoutubeCoverageWindow;
  }): Promise<YoutubeGameCoverageLanguageOption[]> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const result = await runQuery<YoutubeLanguageOptionRow>(
      `
        WITH scoped_videos AS (
          SELECT
            CASE
              WHEN COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')) ILIKE 'en%'
                THEN 'en'
              WHEN COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')) IS NULL
                THEN 'unknown'
              ELSE lower(COALESCE(NULLIF(v.default_language, ''), NULLIF(v.default_audio_language, '')))
            END AS language_code,
            v.video_id
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          WHERE m.appid = $1
            AND m.match_state = 'matched_primary'
            AND ($2::text IS NULL OR v.content_class = $2::text)
            ${this.youtubePublishedWindowPredicate('v', params.window)}
        )
        SELECT
          language_code,
          count(DISTINCT video_id)::bigint AS video_count
        FROM scoped_videos
        GROUP BY language_code
        ORDER BY
          CASE language_code WHEN 'en' THEN 0 WHEN 'unknown' THEN 2 ELSE 1 END,
          video_count DESC,
          language_code ASC
        LIMIT 25
      `,
      [params.appid, params.contentClass],
      this.config
    );

    return result.rows.map((row) => {
      const code = row.language_code ?? 'unknown';
      return {
        code,
        label: this.formatYoutubeLanguageLabel(code),
        videoCount: parseCountValue(row.video_count),
      };
    });
  }

  private formatYoutubeLanguageLabel(code: string): string {
    if (code === 'en') return 'English';
    if (code === 'unknown') return 'Unknown';

    try {
      const [language] = code.split('-');
      const displayName = new Intl.DisplayNames(['en'], { type: 'language' });
      const label = displayName.of(language);
      return label ? `${label} (${code.toUpperCase()})` : code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  }

  private async queryYoutubeCreatorCoverageRowCount(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: YoutubeCoverageWindow;
  }): Promise<number> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const result = await runQuery<{ total_rows: number }>(
      `
        SELECT count(*)::int AS total_rows
        FROM (
          SELECT v.channel_id
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          WHERE m.appid = $1
            AND m.match_state = 'matched_primary'
            AND ($2::text IS NULL OR v.content_class = $2::text)
            ${this.youtubePublishedWindowPredicate('v', params.window)}
          GROUP BY v.channel_id
        ) grouped_channels
      `,
      [params.appid, params.contentClass],
      this.config
    );

    return result.rows[0]?.total_rows ?? 0;
  }

  private async queryYoutubeContentMixRows(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<YoutubeGameCoverageContentMixItem[]> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const deltaByClass = await this.queryYoutubeViewDeltaByContentClass({
      appid: params.appid,
      contentClass: params.contentClass,
      window: params.window,
    });
    const result = await runQuery<YoutubeContentMixRow>(
      `
        WITH content_classes AS (
          SELECT unnest(ARRAY['standard_video', 'short', 'live_or_recent_live']::text[]) AS content_class
        ),
        latest_snapshots AS (
          SELECT DISTINCT ON (s.video_id)
            s.video_id,
            s.view_count
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
          ORDER BY s.video_id, s.snapshot_time DESC
        ),
        matched_totals AS (
          SELECT
            v.content_class,
            count(*)::int AS matched_primary_video_count,
            COALESCE(sum(COALESCE(v.view_count, latest_snapshots.view_count, 0)), 0)::bigint AS current_views
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          LEFT JOIN latest_snapshots ON latest_snapshots.video_id = v.video_id
          WHERE m.appid = $1
            AND m.match_state = 'matched_primary'
          GROUP BY v.content_class
        ),
        window_rows AS (
          SELECT
            v.content_class,
            count(*)::int AS new_matched_videos,
            count(DISTINCT v.channel_id)::int AS distinct_upload_channels
          FROM ${matchesTable} m
          JOIN ${videosTable} v ON v.video_id = m.video_id
          WHERE m.appid = $1
            AND m.match_state = 'matched_primary'
            ${this.youtubePublishedWindowPredicate('v', params.window)}
          GROUP BY v.content_class
        )
        SELECT
          cc.content_class::text,
          COALESCE(mt.current_views, 0) AS current_views,
          COALESCE(mt.matched_primary_video_count, 0) AS matched_primary_video_count,
          COALESCE(wr.new_matched_videos, 0) AS new_matched_videos,
          COALESCE(wr.distinct_upload_channels, 0) AS distinct_upload_channels,
          0::bigint AS matched_video_view_delta
        FROM content_classes cc
        LEFT JOIN matched_totals mt ON mt.content_class = cc.content_class
        LEFT JOIN window_rows wr ON wr.content_class = cc.content_class
        WHERE ($2::text IS NULL OR cc.content_class = $2::text)
        ORDER BY
          CASE cc.content_class
            WHEN 'standard_video' THEN 1
            WHEN 'short' THEN 2
            ELSE 3
          END ASC
      `,
      [params.appid, params.contentClass],
      this.config
    );

    return result.rows
      .map((row) => ({
        contentClass: row.content_class,
        currentViews: row.current_views ?? 0,
        distinctUploadChannels: row.distinct_upload_channels,
        matchedPrimaryVideoCount: row.matched_primary_video_count,
        matchedVideoViewDelta: deltaByClass.get(row.content_class) ?? 0,
        newMatchedVideos: row.new_matched_videos,
      }))
      .filter((row) =>
        params.contentClass
          ? row.contentClass === params.contentClass
          : row.matchedPrimaryVideoCount > 0 || row.newMatchedVideos > 0 || row.matchedVideoViewDelta > 0
      );
  }

  private async queryYoutubeCadenceRow(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<YoutubeGameCoverageCadenceItem | null> {
    const matchesTable = this.relation('docs_youtube_video_matches').sql;
    const videosTable = this.relation('docs_youtube_videos').sql;
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const result = await runQuery<YoutubeCadenceRow>(
      `
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (s.video_id)
            s.video_id,
            s.view_count
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
          ORDER BY s.video_id, s.snapshot_time DESC
        )
        SELECT
          count(*)::int AS new_matched_videos,
          count(DISTINCT v.channel_id)::int AS distinct_upload_channels,
          COALESCE(sum(COALESCE(v.view_count, latest_snapshots.view_count, 0)), 0)::bigint AS views_on_new_videos,
          0::bigint AS matched_video_view_delta
        FROM ${matchesTable} m
        JOIN ${videosTable} v ON v.video_id = m.video_id
        LEFT JOIN latest_snapshots ON latest_snapshots.video_id = v.video_id
        WHERE m.appid = $1
          AND m.match_state = 'matched_primary'
          AND ($2::text IS NULL OR v.content_class = $2::text)
          ${this.youtubePublishedWindowPredicate('v', params.window)}
      `,
      [params.appid, params.contentClass],
      this.config
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      distinctUploadChannels: row.distinct_upload_channels ?? 0,
      matchedVideoViewDelta:
        (await this.queryYoutubeAggregateViewDelta({
          appid: params.appid,
          contentClass: params.contentClass,
          window: params.window,
        })) ?? 0,
      newMatchedVideos: row.new_matched_videos ?? 0,
      viewsOnNewVideos: row.views_on_new_videos ?? 0,
      window: params.window,
    };
  }

  private async queryYoutubeAggregateViewDelta(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<number> {
    const deltaByClass = await this.queryYoutubeViewDeltaByContentClass(params);
    return [...deltaByClass.values()].reduce((sum, value) => sum + value, 0);
  }

  private async queryYoutubeViewDeltaByContentClass(params: {
    appid: number;
    contentClass: YoutubeContentClass | null;
    window: Exclude<YoutubeCoverageWindow, 'current'>;
  }): Promise<Map<YoutubeContentClass, number>> {
    const snapshotsTable = this.relation('metrics_youtube_video_snapshots').sql;
    const result = await runQuery<{
      content_class: YoutubeContentClass;
      matched_video_view_delta: number;
    }>(
      `
        WITH scoped_snapshots AS (
          SELECT
            s.video_id,
            s.content_class,
            MIN(s.snapshot_time) AS first_snapshot_at,
            MAX(s.snapshot_time) AS last_snapshot_at
          FROM ${snapshotsTable} s
          WHERE s.appid = $1
            AND ($2::text IS NULL OR s.content_class = $2::text)
            ${this.youtubeSnapshotWindowPredicate('s', params.window)}
          GROUP BY s.video_id, s.content_class
          HAVING MIN(s.snapshot_time) < MAX(s.snapshot_time)
        ),
        video_deltas AS (
          SELECT
            scoped.content_class,
            GREATEST(last_snapshot.view_count - first_snapshot.view_count, 0)::bigint AS view_delta
          FROM scoped_snapshots scoped
          JOIN ${snapshotsTable} first_snapshot
            ON first_snapshot.video_id = scoped.video_id
           AND first_snapshot.snapshot_time = scoped.first_snapshot_at
          JOIN ${snapshotsTable} last_snapshot
            ON last_snapshot.video_id = scoped.video_id
           AND last_snapshot.snapshot_time = scoped.last_snapshot_at
        )
        SELECT
          content_class,
          COALESCE(sum(view_delta), 0)::bigint AS matched_video_view_delta
        FROM video_deltas
        GROUP BY content_class
      `,
      [params.appid, params.contentClass],
      this.config
    );

    return new Map(
      result.rows.map((row) => [row.content_class, row.matched_video_view_delta ?? 0] as const)
    );
  }

  private mapYoutubeVideoItem(row: YoutubeVideoCoverageRow): YoutubeGameCoverageVideoItem {
    return {
      channelCountry: row.channel_country,
      channelId: row.channel_id,
      channelSubscriberCount: parseNullableCountValue(row.channel_subscriber_count),
      channelTitle: row.channel_title,
      commentCount: parseNullableCountValue(row.comment_count),
      confidenceScore: row.confidence_score,
      contentClass: row.content_class,
      defaultAudioLanguage: row.default_audio_language,
      defaultLanguage: row.default_language,
      firstSnapshotAt: row.first_snapshot_at,
      growthPct: row.growth_pct,
      languageCode: row.language_code,
      lastSnapshotAt: row.last_snapshot_at,
      likeCount: parseNullableCountValue(row.like_count),
      matchedAlias: row.matched_alias,
      publishedAt: row.published_at,
      thumbnailUrl: row.thumbnail_url,
      title: row.title,
      url: `https://www.youtube.com/watch?v=${row.video_id}`,
      videoId: row.video_id,
      viewCount: parseNullableCountValue(row.view_count),
      viewDelta: parseNullableCountValue(row.view_delta),
    };
  }

  private async resolveCoreEntity(
    entityUid: string,
    codes: {
      invalidCode: string;
      notFoundCode: string;
    }
  ): Promise<CoreEntityRow> {
    if (!UUID_PATTERN.test(entityUid)) {
      throw new PublisherIQError('entityUid must be a valid UUID.', codes.invalidCode, {
        entityUid,
      });
    }

    const entitiesTable = this.relation('core_entities').sql;
    const result = await runQuery<CoreEntityRow>(
      `
        SELECT
          entity_uid::text,
          entity_kind,
          platform,
          platform_entity_id,
          canonical_name
        FROM ${entitiesTable}
        WHERE entity_uid = $1::uuid
        LIMIT 1
      `,
      [entityUid],
      this.config
    );

    const entity = result.rows[0];
    if (!entity) {
      throw new PublisherIQError(
        'No entity found for the provided entityUid.',
        codes.notFoundCode,
        { entityUid }
      );
    }

    return entity;
  }

  private validateDateOnly(value: string, fieldName: 'startDate' | 'endDate'): string {
    if (!ISO_DATE_ONLY_PATTERN.test(value)) {
      throw new PublisherIQError(
        `${fieldName} must be a YYYY-MM-DD string.`,
        'INVALID_TRACE_DATE',
        { fieldName, value }
      );
    }

    const parsed = parseDateOnly(value);
    if (Number.isNaN(parsed.getTime()) || formatDateOnly(parsed) !== value) {
      throw new PublisherIQError(
        `${fieldName} must be a valid calendar date.`,
        'INVALID_TRACE_DATE',
        { fieldName, value }
      );
    }

    return value;
  }

  private validateIsoTimestamp(value: string, fieldName: 'startTime' | 'endTime'): Date {
    const parsed = parseTimestamp(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new PublisherIQError(
        `${fieldName} must be a valid ISO timestamp.`,
        'INVALID_EXPLAIN_TIMESTAMP',
        { fieldName, value }
      );
    }

    return parsed;
  }

  private async assertTigerSearchFiltersSupported(request: SearchCatalogRequest): Promise<void> {
    if (this.config.source !== 'tiger') {
      return;
    }

    const requiredRelations = new Set<DataPlaneRelationKey>();
    const unsupportedFilters: string[] = [];

    if (request.genres?.length) {
      unsupportedFilters.push('genres');
      requiredRelations.add('app_genres');
      requiredRelations.add('steam_genres');
    }

    if (request.tags?.length) {
      unsupportedFilters.push('tags');
      requiredRelations.add('app_steam_tags');
      requiredRelations.add('steam_tags');
    }

    for (const facetKind of request.includeFacets ?? []) {
      if (facetKind === 'tags') {
        unsupportedFilters.push('includeFacets.tags');
        requiredRelations.add('steam_tags');
      } else if (facetKind === 'genres') {
        unsupportedFilters.push('includeFacets.genres');
        requiredRelations.add('steam_genres');
      } else if (facetKind === 'categories') {
        unsupportedFilters.push('includeFacets.categories');
        requiredRelations.add('steam_categories');
      }
    }

    if (requiredRelations.size === 0) {
      return;
    }

    const blockingTables = await this.getBlockingTables([...requiredRelations]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `The system does not support ${unsupportedFilters.join(', ')} filters yet because the required data is still being backfilled.`,
        'searchCatalog',
        blockingTables,
        { unsupportedFilters }
      );
    }
  }

  private async assertTigerMomentumFiltersSupported(
    request: DiscoverMomentumRequest
  ): Promise<void> {
    if (this.config.source !== 'tiger') {
      return;
    }

    const filters = request.filters ?? null;
    if (!filters) {
      return;
    }

    const requiredRelations = new Set<DataPlaneRelationKey>();
    const unsupportedFilters: string[] = [];

    if (filters.genres?.length) {
      unsupportedFilters.push('genres');
      requiredRelations.add('app_genres');
      requiredRelations.add('steam_genres');
    }

    if (filters.tags?.length) {
      unsupportedFilters.push('tags');
      requiredRelations.add('app_steam_tags');
      requiredRelations.add('steam_tags');
    }

    if (filters.steamDeck?.length) {
      unsupportedFilters.push('steamDeck');
      requiredRelations.add('app_steam_deck');
    }

    if (requiredRelations.size === 0) {
      return;
    }

    const blockingTables = await this.getBlockingTables([...requiredRelations]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `The system does not support ${unsupportedFilters.join(', ')} filters yet because the required data is still being backfilled.`,
        'discoverMomentum',
        blockingTables,
        { unsupportedFilters }
      );
    }
  }

  private async assertTigerSemanticFiltersSupported(
    request: SemanticSearchRequest
  ): Promise<void> {
    if (this.config.source !== 'tiger') {
      return;
    }

    const filters = request.filters;
    if (!filters) {
      return;
    }

    const requiredRelations = new Set<DataPlaneRelationKey>([
      'app_genres',
      'steam_genres',
      'app_steam_tags',
      'steam_tags',
    ]);
    const unsupportedFilters: string[] = [];

    if (filters.steam_deck?.length) {
      unsupportedFilters.push('steamDeck');
      requiredRelations.add('app_steam_deck');
    }

    const blockingTables = await this.getBlockingTables([...requiredRelations]);

    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `The system does not support ${unsupportedFilters.length > 0 ? unsupportedFilters.join(', ') : 'the required metadata joins'} yet because the required data is still being backfilled.`,
        'semanticSearch',
        blockingTables,
        { unsupportedFilters }
      );
    }

    if (filters.same_franchise_only) {
      throw new ContractRuntimeUnavailableError(
        'The system does not support same_franchise_only yet because franchise metadata is still being backfilled.',
        'semanticSearch',
        ['legacy.app_franchises'],
        { unsupportedFilters: ['same_franchise_only'] }
      );
    }
  }

  private shouldQueryCatalogItems(request: SearchCatalogRequest): boolean {
    if (request.appids?.length || request.parentAppids?.length) {
      return true;
    }

    if (request.query?.trim() || request.publisherQuery?.trim() || request.developerQuery?.trim()) {
      return true;
    }

    if (request.publisherIds?.length || request.developerIds?.length) {
      return true;
    }

    if (request.includeAppTypes?.length || request.platforms?.length) {
      return true;
    }

    if (request.tags?.length || request.genres?.length) {
      return true;
    }

    if (
      typeof request.isFree === 'boolean'
      || typeof request.isReleased === 'boolean'
      || typeof request.onSale === 'boolean'
      || typeof request.minReviews === 'number'
      || typeof request.minReviewScore === 'number'
      || typeof request.minPriceCents === 'number'
      || typeof request.maxPriceCents === 'number'
      || typeof request.minDiscountPercent === 'number'
      || typeof request.minOwners === 'number'
      || typeof request.minCcu === 'number'
    ) {
      return true;
    }

    if (request.releaseYear?.gte != null || request.releaseYear?.lte != null) {
      return true;
    }

    return false;
  }

  private async lookupCatalogFacets(
    request: SearchCatalogRequest
  ): Promise<SearchCatalogResponse['facets']> {
    const includeFacets = [...new Set(request.includeFacets ?? [])];
    const facetQuery = request.facetQuery?.trim() ?? request.query?.trim() ?? '';

    if (includeFacets.length === 0 || !facetQuery) {
      return null;
    }

    const limit = normalizeLimit(request.limit, 10, 20);
    const normalizedQuery = facetQuery.toLowerCase();
    const likeQuery = normalizeLikeValue(facetQuery);
    const prefixQuery = `${normalizedQuery}%`;

    const facetRows = await Promise.all(
      includeFacets.map(async (facetKind) => {
        const relationKey =
          facetKind === 'tags'
            ? 'steam_tags'
            : facetKind === 'genres'
              ? 'steam_genres'
              : 'steam_categories';
        const table = this.relation(relationKey).sql;
        const result = await runQuery<{ name: string }>(
          `
            SELECT facet_matches.name
            FROM (
              SELECT DISTINCT
                name,
                CASE
                  WHEN lower(name) = $1 THEN 2
                  WHEN lower(name) LIKE $3 THEN 1
                  ELSE 0
                END AS match_rank
              FROM ${table}
              WHERE lower(name) = $1
                 OR lower(name) LIKE $2
            ) facet_matches
            ORDER BY
              facet_matches.match_rank DESC,
              facet_matches.name ASC
            LIMIT $4
          `,
          [normalizedQuery, likeQuery, prefixQuery, limit],
          this.config
        );

        return {
          facetKind,
          names: result.rows
            .map((row) => row.name)
            .filter((name, index, values) => values.indexOf(name) === index),
        };
      })
    );

    const categories = facetRows.find((row) => row.facetKind === 'categories')?.names ?? [];
    const genres = facetRows.find((row) => row.facetKind === 'genres')?.names ?? [];
    const tags = facetRows.find((row) => row.facetKind === 'tags')?.names ?? [];
    const canonicalMatchRow = facetRows.find((row) =>
      row.names.some((name) => name.trim().toLowerCase() === normalizedQuery)
    );
    const canonicalMatchName = canonicalMatchRow?.names.find(
      (name) => name.trim().toLowerCase() === normalizedQuery
    ) ?? null;
    const canonicalMatch =
      canonicalMatchName && canonicalMatchRow
        ? {
            name: canonicalMatchName,
            type: canonicalMatchRow.facetKind,
          }
        : null;

    if (canonicalMatch?.type === 'tags' || canonicalMatch?.type === 'genres') {
      const canonicalFacetKind: 'genres' | 'tags' = canonicalMatch.type;
      const pairedFacetRows = await Promise.all(
        includeFacets.map(async (facetKind) => ({
          facetKind,
          names: await this.queryFacetCooccurrenceNames({
            canonicalFacetKind,
            canonicalFacetName: canonicalMatch.name,
            limit,
            targetFacetKind: facetKind,
          }),
        }))
      );
      const hasPairedFacetRows = pairedFacetRows.some((row) => row.names.length > 0);

      if (hasPairedFacetRows) {
        return {
          canonicalMatch,
          categories: pairedFacetRows.find((row) => row.facetKind === 'categories')?.names ?? categories,
          genres: pairedFacetRows.find((row) => row.facetKind === 'genres')?.names ?? genres,
          tags: pairedFacetRows.find((row) => row.facetKind === 'tags')?.names ?? tags,
        };
      }
    }

    return {
      canonicalMatch,
      categories,
      genres,
      tags,
    };
  }

  private async queryFacetCooccurrenceNames(params: {
    canonicalFacetKind: 'genres' | 'tags';
    canonicalFacetName: string;
    limit: number;
    targetFacetKind: CatalogFacetKind;
  }): Promise<string[]> {
    const seedConfig =
      params.canonicalFacetKind === 'tags'
        ? {
            edgeTable: this.relation('app_steam_tags').sql,
            edgeIdColumn: 'tag_id',
            facetTable: this.relation('steam_tags').sql,
            facetIdColumn: 'tag_id',
          }
        : {
            edgeTable: this.relation('app_genres').sql,
            edgeIdColumn: 'genre_id',
            facetTable: this.relation('steam_genres').sql,
            facetIdColumn: 'genre_id',
          };
    const targetConfig =
      params.targetFacetKind === 'tags'
        ? {
            edgeTable: this.relation('app_steam_tags').sql,
            edgeIdColumn: 'tag_id',
            facetTable: this.relation('steam_tags').sql,
            facetIdColumn: 'tag_id',
          }
        : params.targetFacetKind === 'genres'
          ? {
              edgeTable: this.relation('app_genres').sql,
              edgeIdColumn: 'genre_id',
              facetTable: this.relation('steam_genres').sql,
              facetIdColumn: 'genre_id',
            }
          : null;

    if (!targetConfig) {
      return [];
    }

    const sqlParams: unknown[] = [params.canonicalFacetName.trim().toLowerCase(), params.limit];
    const excludeCanonicalClause =
      params.canonicalFacetKind === params.targetFacetKind
        ? 'AND lower(target.name) <> $1'
        : '';
    const result = await runQuery<{ name: string }>(
      `
        WITH matched_apps AS (
          SELECT DISTINCT seed_rel.appid
          FROM ${seedConfig.edgeTable} seed_rel
          JOIN ${seedConfig.facetTable} seed
            ON seed.${seedConfig.facetIdColumn} = seed_rel.${seedConfig.edgeIdColumn}
          WHERE lower(seed.name) = $1
        )
        SELECT target.name
        FROM matched_apps matched
        JOIN ${targetConfig.edgeTable} target_rel ON target_rel.appid = matched.appid
        JOIN ${targetConfig.facetTable} target
          ON target.${targetConfig.facetIdColumn} = target_rel.${targetConfig.edgeIdColumn}
        WHERE 1 = 1
          ${excludeCanonicalClause}
        GROUP BY target.name
        ORDER BY COUNT(*) DESC, target.name ASC
        LIMIT $2
      `,
      sqlParams,
      this.config
    );

    return result.rows.map((row) => row.name).filter(Boolean);
  }

  private async queryUserContextPins(userId: string): Promise<UserContextPin[]> {
    const pinsTable = this.relation('user_pins').sql;
    const pinSettingsTable = this.relation('user_pin_alert_settings').sql;
    const appsTable = this.relation('apps').sql;
    const latestDailyMetricsTable = this.relation('latest_daily_metrics').sql;
    const publishersTable = this.relation('publishers').sql;
    const developersTable = this.relation('developers').sql;

    const result = await runQuery<UserContextPinRow>(
      `
        SELECT
          p.id::text AS pin_id,
          p.entity_type::text AS entity_type,
          p.entity_id,
          p.display_name,
          p.pin_order,
          p.pinned_at::text AS pinned_at,
          a.type::text AS app_type,
          a.is_free,
          a.platforms,
          EXTRACT(YEAR FROM a.release_date)::int AS release_year,
          ldm.ccu_peak,
          ldm.owners_midpoint,
          ${reviewPercentageSql('ldm')} AS review_score,
          ldm.total_reviews,
          pub.game_count AS publisher_game_count,
          dev.game_count AS developer_game_count,
          ps.use_custom_settings,
          ps.alerts_enabled,
          ps.ccu_sensitivity::double precision AS ccu_sensitivity,
          ps.review_sensitivity::double precision AS review_sensitivity,
          ps.sentiment_sensitivity::double precision AS sentiment_sensitivity,
          ps.alert_ccu_spike,
          ps.alert_ccu_drop,
          ps.alert_trend_reversal,
          ps.alert_review_surge,
          ps.alert_sentiment_shift,
          ps.alert_price_change,
          ps.alert_new_release,
          ps.alert_milestone
        FROM ${pinsTable} p
        LEFT JOIN ${pinSettingsTable} ps ON ps.pin_id = p.id
        LEFT JOIN ${appsTable} a
          ON p.entity_type = 'game'
         AND a.appid = p.entity_id
        LEFT JOIN ${latestDailyMetricsTable} ldm
          ON p.entity_type = 'game'
         AND ldm.appid = p.entity_id
        LEFT JOIN ${publishersTable} pub
          ON p.entity_type = 'publisher'
         AND pub.id = p.entity_id
        LEFT JOIN ${developersTable} dev
          ON p.entity_type = 'developer'
         AND dev.id = p.entity_id
        WHERE p.user_id = $1::uuid
        ORDER BY p.pin_order ASC, p.pinned_at ASC, p.id ASC
      `,
      [userId],
      this.config
    );

    return result.rows.map((row) => this.mapUserContextPin(row));
  }

  private async queryUserAlertPreferences(
    userId: string
  ): Promise<UserContextAlertPreferences> {
    const preferencesTable = this.relation('user_alert_preferences').sql;
    const result = await runQuery<UserContextAlertPreferencesRow>(
      `
        SELECT
          alerts_enabled,
          email_digest_enabled,
          email_digest_frequency,
          ccu_sensitivity::double precision AS ccu_sensitivity,
          review_sensitivity::double precision AS review_sensitivity,
          sentiment_sensitivity::double precision AS sentiment_sensitivity,
          alert_ccu_spike,
          alert_ccu_drop,
          alert_trend_reversal,
          alert_review_surge,
          alert_sentiment_shift,
          alert_price_change,
          alert_new_release,
          alert_milestone
        FROM ${preferencesTable}
        WHERE user_id = $1::uuid
        LIMIT 1
      `,
      [userId],
      this.config
    );

    const row = result.rows[0];
    return row ? this.mapUserAlertPreferences(row) : buildDefaultUserAlertPreferences();
  }

  private async queryUserContextAlerts(
    userId: string,
    limit: number
  ): Promise<UserContextAlert[]> {
    const alertsTable = this.relation('user_alerts').sql;
    const pinsTable = this.relation('user_pins').sql;
    const result = await runQuery<UserContextAlertRow>(
      `
        SELECT
          a.id::text AS alert_id,
          a.pin_id::text AS pin_id,
          a.alert_type::text AS alert_type,
          a.severity::text AS severity,
          a.title,
          a.description,
          a.metric_name,
          a.previous_value::double precision AS previous_value,
          a.current_value::double precision AS current_value,
          a.change_percent::double precision AS change_percent,
          a.is_read,
          a.read_at::text AS read_at,
          a.created_at::text AS created_at,
          p.display_name,
          p.entity_type::text AS entity_type,
          p.entity_id
        FROM ${alertsTable} a
        JOIN ${pinsTable} p
          ON p.id = a.pin_id
        WHERE a.user_id = $1::uuid
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2
      `,
      [userId, limit],
      this.config
    );

    return result.rows.map((row) => this.mapUserContextAlert(row));
  }

  private async queryUnreadAlertCount(userId: string): Promise<number> {
    const alertsTable = this.relation('user_alerts').sql;
    const result = await runQuery<UserContextUnreadCountRow>(
      `
        SELECT count(*)::int AS unread_alert_count
        FROM ${alertsTable}
        WHERE user_id = $1::uuid
          AND is_read = false
      `,
      [userId],
      this.config
    );

    return result.rows[0]?.unread_alert_count ?? 0;
  }

  private mapUserContextPin(row: UserContextPinRow): UserContextPin {
    const entityKind = row.entity_type;
    const platform = entityKind === 'game' ? 'steam' : 'publisheriq';
    const gameCount =
      entityKind === 'publisher'
        ? row.publisher_game_count
        : entityKind === 'developer'
          ? row.developer_game_count
          : null;
    const hasAlertSettings = row.use_custom_settings !== null;

    return {
      alertSettings: hasAlertSettings
        ? {
            alertCcuDrop: row.alert_ccu_drop,
            alertCcuSpike: row.alert_ccu_spike,
            alertMilestone: row.alert_milestone,
            alertNewRelease: row.alert_new_release,
            alertPriceChange: row.alert_price_change,
            alertReviewSurge: row.alert_review_surge,
            alertSentimentShift: row.alert_sentiment_shift,
            alertTrendReversal: row.alert_trend_reversal,
            alertsEnabled: row.alerts_enabled ?? true,
            ccuSensitivity: row.ccu_sensitivity,
            reviewSensitivity: row.review_sensitivity,
            sentimentSensitivity: row.sentiment_sensitivity,
            useCustomSettings: row.use_custom_settings ?? false,
          }
        : null,
      displayName: row.display_name,
      entityKind,
      entityUid: buildEntityUid(platform, entityKind, String(row.entity_id)),
      metrics: {
        ccuPeak: row.ccu_peak,
        gameCount,
        ownersMidpoint: row.owners_midpoint,
        reviewScore: normalizeReviewPercentageValue(row.review_score),
        totalReviews: row.total_reviews,
      },
      pinId: row.pin_id,
      pinOrder: row.pin_order,
      pinnedAt: formatTimestamp(parseTimestamp(row.pinned_at)),
      platform,
      platformEntityId: String(row.entity_id),
      summary: {
        appType: row.app_type,
        isFree: row.is_free,
        platforms: row.platforms
          ? row.platforms.split(',').map((value) => value.trim()).filter(Boolean)
          : [],
        releaseYear: row.release_year,
      },
    };
  }

  private mapUserAlertPreferences(
    row: UserContextAlertPreferencesRow
  ): UserContextAlertPreferences {
    return {
      alertCcuDrop: row.alert_ccu_drop,
      alertCcuSpike: row.alert_ccu_spike,
      alertMilestone: row.alert_milestone,
      alertNewRelease: row.alert_new_release,
      alertPriceChange: row.alert_price_change,
      alertReviewSurge: row.alert_review_surge,
      alertSentimentShift: row.alert_sentiment_shift,
      alertTrendReversal: row.alert_trend_reversal,
      alertsEnabled: row.alerts_enabled,
      ccuSensitivity: row.ccu_sensitivity,
      emailDigestEnabled: row.email_digest_enabled,
      emailDigestFrequency: row.email_digest_frequency,
      reviewSensitivity: row.review_sensitivity,
      sentimentSensitivity: row.sentiment_sensitivity,
      source: 'stored',
    };
  }

  private mapUserContextAlert(row: UserContextAlertRow): UserContextAlert {
    const platform = row.entity_type === 'game' ? 'steam' : 'publisheriq';

    return {
      alertId: row.alert_id,
      alertType: row.alert_type,
      changePercent: row.change_percent,
      createdAt: formatTimestamp(parseTimestamp(row.created_at)),
      currentValue: row.current_value,
      description: row.description,
      entity: {
        displayName: row.display_name,
        entityKind: row.entity_type,
        entityUid: buildEntityUid(platform, row.entity_type, String(row.entity_id)),
        platform,
        platformEntityId: String(row.entity_id),
      },
      isRead: row.is_read,
      metricName: row.metric_name,
      pinId: row.pin_id,
      previousValue: row.previous_value,
      readAt: row.read_at ? formatTimestamp(parseTimestamp(row.read_at)) : null,
      severity: row.severity,
      title: row.title,
    };
  }

  private async assertContractRuntime(
    contractName: RuntimeQueryContractDescriptor['name']
  ): Promise<void> {
    const contract = CONTRACT_REGISTRY.find((candidate) => candidate.name === contractName);
    if (!contract || contract.status !== 'ready') {
      return;
    }

    const blockingTables = await this.getContractBlockers(contract);
    if (blockingTables.length > 0) {
      throw new ContractRuntimeUnavailableError(
        `${contractName} is not ready on ${this.config.source} until the required tables are present and backfilled.`,
        contractName,
        blockingTables
      );
    }
  }

  private async getBlockingTables(requiredRelations: DataPlaneRelationKey[]): Promise<string[]> {
    const blockingTables: string[] = [];

    for (const relationKey of requiredRelations) {
      const location = this.relation(relationKey);
      const relationName = `${location.schema}.${location.table}`;
      const existsResult = await runQuery<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [relationName],
        this.config
      );
      const exists = existsResult.rows[0]?.exists ?? false;

      if (!exists) {
        blockingTables.push(location.sql);
        continue;
      }

      if (ALLOW_EMPTY_RELATIONS.has(relationKey)) {
        continue;
      }

      const hasRowsResult = await runQuery<{ has_rows: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM ${location.sql} LIMIT 1) AS has_rows`,
        [],
        this.config
      );

      if (!(hasRowsResult.rows[0]?.has_rows ?? false)) {
        blockingTables.push(location.sql);
      }
    }

    return blockingTables;
  }

  private async getContractBlockers(
    contract: Pick<RuntimeQueryContractDescriptor, 'name' | 'requiredRelations'>
  ): Promise<string[]> {
    const requiredRelations =
      contract.name === 'getRelatedEntities'
        ? (['apps', 'latest_daily_metrics'] as DataPlaneRelationKey[])
        : contract.requiredRelations;
    const blockingTables = await this.getBlockingTables(requiredRelations);
    return [...blockingTables, ...this.getAdditionalContractBlockers(contract.name)];
  }

  private getAdditionalContractBlockers(
    contractName: RuntimeQueryContractDescriptor['name']
  ): string[] {
    void contractName;
    return [];
  }

  private relation(relationKey: DataPlaneRelationKey): RelationLocation {
    return RELATION_LOCATIONS[this.config.source][relationKey];
  }

  private mapExplainNews(row: ExplainNewsRow): ExplainChangesLinkedNewsItem {
    return {
      feedLabel: row.feedlabel,
      feedName: row.feedname,
      feedScope: row.feed_scope,
      firstSeenAt: formatTimestamp(parseTimestamp(row.first_seen_at)),
      gid: row.gid,
      publishedAt: row.published_at ? formatTimestamp(parseTimestamp(row.published_at)) : null,
      sortTime: formatTimestamp(parseTimestamp(row.sort_time)),
      title: row.title,
      url: row.url,
    };
  }

  private mapRankedEntity(
    entityKind: EntityKind,
    metric: RankMetric,
    row: RankRow,
    rank: number
  ): RankedEntity {
    const platform = entityKind === 'game' ? 'steam' : 'publisheriq';

    return {
      displayName: row.display_name,
      entityKind,
      entityUid: buildEntityUid(platform, entityKind, String(row.entity_id)),
      metricValue: metricValueForRow(metric, row),
      metrics: {
        ccuPeak: row.ccu_peak,
        gameCount: row.game_count,
        ownersMidpoint: row.owners_midpoint,
        reviewScore: row.review_score,
        totalReviews: row.total_reviews,
      },
      platform,
      platformEntityId: String(row.entity_id),
      rank,
      releaseYear: row.release_year ?? null,
    };
  }

  private mapComparedEntity(
    entity: CoreEntityRow,
    row: RankRow | null
  ): ComparedEntity {
    return {
      displayName: entity.canonical_name,
      entityKind: entity.entity_kind,
      entityUid: entity.entity_uid,
      metrics: {
        ccuPeak: row?.ccu_peak ?? null,
        gameCount: row?.game_count ?? null,
        ownersMidpoint: row?.owners_midpoint ?? null,
        reviewScore: row?.review_score ?? null,
        totalReviews: row?.total_reviews ?? null,
      },
      platform: entity.platform,
      platformEntityId: entity.platform_entity_id,
      releaseYear: row?.release_year ?? null,
    };
  }

  private buildCompareHighlights(
    metrics: CompareMetric[],
    items: ComparedEntity[]
  ): CompareEntitiesResponse['highlights'] {
    return metrics.flatMap((metric) => {
      const leader = items.reduce<ComparedEntity | null>((currentLeader, item) => {
        const value = comparedMetricValue(metric, item);
        if (value == null) {
          return currentLeader;
        }

        if (!currentLeader) {
          return item;
        }

        const currentValue = comparedMetricValue(metric, currentLeader);
        return currentValue == null || value > currentValue ? item : currentLeader;
      }, null);

      const value = leader ? comparedMetricValue(metric, leader) : null;
      if (!leader || value == null) {
        return [];
      }

      return [{
        displayName: leader.displayName,
        entityUid: leader.entityUid,
        metric,
        value,
      }];
    });
  }

  private mapResolvedEntity(
    entityKind: EntityKind,
    platform: 'steam' | 'publisheriq',
    row: EntityRow,
    query: string,
    includeMetrics: boolean
  ): ResolvedEntity {
    const matchedName = row.matched_name?.trim() || row.display_name;
    const matchQuality =
      normalizeMatchQuality(row.match_quality) ?? inferMatchQuality(matchedName, query);
    const matchSource =
      normalizeResolveEntityMatchSource(row.match_source)
      ?? (this.config.source === 'tiger' ? 'legacy_name' : 'legacy_name');
    const resolutionTier =
      normalizeResolveEntityResolutionTier(row.resolution_tier)
      ?? inferLegacyResolutionTier(matchQuality);

    return {
      confidence: matchConfidence(matchQuality, row.match_rank ?? null),
      displayName: row.display_name,
      entityKind,
      entityUid: buildEntityUid(platform, entityKind, String(row.entity_id)),
      latestMetrics: includeMetrics
        ? {
            ccuPeak: row.ccu_peak,
            ownersMidpoint: row.owners_midpoint,
            reviewScore: row.review_score,
            totalReviews: row.total_reviews,
          }
        : undefined,
      matchQuality,
      matchSource,
      matchedName,
      platform,
      platformEntityId: String(row.entity_id),
      releaseYear: row.release_year ?? null,
      resolutionTier,
      signals:
        entityKind === 'game'
          ? undefined
          : {
              gameCount: row.game_count ?? null,
            },
    };
  }
}

export async function runReadinessProbe(
  config: DataPlaneConfig = loadDataPlaneConfig()
): Promise<QueryProvenance> {
  const service = new DataPlaneService(config);
  const provenance = await service.healthCheck();
  logger.info('Query API readiness probe succeeded', {
    capturedAt: provenance.capturedAt,
    source: provenance.source,
    tables: provenance.tables,
  });
  return provenance;
}
