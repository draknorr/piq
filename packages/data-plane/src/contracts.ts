export type EntityKind = 'game' | 'publisher' | 'developer';
export type EntityPlatform = 'steam' | 'publisheriq';
export type DataPlaneSource = 'supabase-postgres' | 'tiger';
export type MatchQuality = 'exact' | 'prefix' | 'substring' | 'fuzzy';
export type ResolveEntitiesResolutionMode = 'default' | 'chat_strict' | 'autocomplete';
export type ResolveEntitiesResolutionPreference = 'game' | 'company';
export type ResolveEntityMatchSource =
  | 'platform_entity_id'
  | 'canonical_name'
  | 'normalized_name'
  | 'alias'
  | 'normalized_alias'
  | 'legacy_name';
export type ResolveEntityResolutionTier =
  | 'platform_id_exact'
  | 'canonical_exact'
  | 'alias_exact'
  | 'normalized_exact'
  | 'canonical_prefix'
  | 'alias_prefix'
  | 'legacy_prefix'
  | 'canonical_substring'
  | 'alias_substring'
  | 'legacy_substring'
  | 'legacy_exact'
  | 'fuzzy';
export type ContractStatus = 'ready' | 'planned';
export type ContractRuntimeReadiness = 'ready' | 'blocked';
export type SemanticSearchMode = 'similarity' | 'concept';
export type SemanticSearchEntityKind = 'game' | 'publisher' | 'developer';
export type SemanticSearchPlatform = 'windows' | 'macos' | 'linux';
export type SemanticSearchSteamDeckCategory =
  | 'unknown'
  | 'unsupported'
  | 'playable'
  | 'verified';
export type SemanticSearchPopularityComparison =
  | 'any'
  | 'less_popular'
  | 'similar'
  | 'more_popular';
export type SemanticSearchReviewComparison =
  | 'any'
  | 'similar_or_better'
  | 'better_only';

export interface SemanticSearchRange {
  gte?: number;
  lte?: number;
}

export interface SemanticSearchFilters {
  avg_review_percentage?: SemanticSearchRange;
  game_count?: SemanticSearchRange;
  genres?: string[];
  is_free?: boolean;
  is_indie?: boolean;
  is_major?: boolean;
  max_price_cents?: number;
  max_reviews?: number;
  min_reviews?: number;
  platforms?: SemanticSearchPlatform[];
  popularity_comparison?: SemanticSearchPopularityComparison;
  release_year?: SemanticSearchRange;
  review_comparison?: SemanticSearchReviewComparison;
  review_percentage?: SemanticSearchRange;
  same_franchise_only?: boolean;
  steam_deck?: Array<'verified' | 'playable'>;
  tags?: string[];
  top_genres?: string[];
  top_tags?: string[];
}

export interface SemanticSearchReference {
  id: number;
  name: string;
  type: string;
}

export interface SemanticSearchCandidate {
  id: number;
  name: string;
}

export interface SemanticSearchResultItem {
  avg_review_percentage?: number | null;
  game_count?: number;
  genres?: string[];
  id: number;
  is_free?: boolean;
  is_indie?: boolean;
  is_major?: boolean;
  matchReasons?: string[];
  name: string;
  price_cents?: number | null;
  rawScore?: number;
  review_percentage?: number | null;
  score: number;
  steam_deck?: SemanticSearchSteamDeckCategory;
  tags?: string[];
  top_genres?: string[];
  top_tags?: string[];
  total_reviews?: number | null;
  type?: string;
}

export interface SemanticSearchDebugInfo {
  searchParams?: Record<string, unknown>;
  vectorFilter?: Record<string, unknown>;
}

export interface SemanticSearchEngineResult {
  candidates?: SemanticSearchCandidate[];
  close_alternatives?: SemanticSearchResultItem[];
  close_alternatives_reason?: string;
  continuation_token?: string | null;
  debug?: SemanticSearchDebugInfo;
  entityType?: 'publisher' | 'developer';
  error?: string;
  mode?: 'heuristic_portfolio' | 'semantic';
  query_description?: string;
  reference?: SemanticSearchReference;
  results?: SemanticSearchResultItem[];
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  success: boolean;
  total_found?: number;
}

export type RankMetric =
  | 'total_reviews'
  | 'owners_midpoint'
  | 'ccu_peak'
  | 'review_score'
  | 'game_count';
export type TraceMetric =
  | 'owners_midpoint'
  | 'ccu_peak'
  | 'total_reviews'
  | 'positive_reviews'
  | 'negative_reviews'
  | 'review_score'
  | 'positive_percentage'
  | 'price_cents'
  | 'discount_percent'
  | 'average_playtime_forever'
  | 'average_playtime_2weeks';
export type ChangeActivityView =
  | 'overview'
  | 'launch-watch'
  | 'commercial-moves'
  | 'store-refreshes'
  | 'all-activity';
export type ChangeActivityMode = 'all' | 'changes' | 'announcements';
export type ChangeActivitySort =
  | 'relevant'
  | 'newest'
  | 'biggest-change'
  | 'most-commercial'
  | 'most-launch-relevant';
export type ChangeActivitySignalFamily =
  | 'announcement'
  | 'release'
  | 'pricing'
  | 'store-page'
  | 'media'
  | 'taxonomy'
  | 'platform'
  | 'build';
export type ChangeActivityStoryKind =
  | 'announcement'
  | 'commercial-move'
  | 'launch-prep'
  | 'store-refresh'
  | 'taxonomy-shift'
  | 'update-tease'
  | 'change-roundup';
export type ChangePattern =
  | 'marketing_push'
  | 'relaunch_pattern'
  | 'update_tease'
  | 'under_marketed'
  | 'signable_candidate'
  | 'rescue_candidate'
  | 'sustained_response'
  | 'announcement_weak_response';
export type RelatedEntityKind = 'dlc' | 'franchise_games';
export type CatalogFacetKind = 'tags' | 'genres' | 'categories';
export type DataPlaneRelationKey =
  | 'apps'
  | 'ccu_snapshots'
  | 'developers'
  | 'core_entity_aliases'
  | 'core_entity_external_ids'
  | 'publishers'
  | 'app_dlc'
  | 'app_franchises'
  | 'app_developers'
  | 'app_steam_deck'
  | 'app_publishers'
  | 'user_pins'
  | 'user_alerts'
  | 'user_alert_preferences'
  | 'user_pin_alert_settings'
  | 'latest_daily_metrics'
  | 'metrics_daily_metrics'
  | 'core_entities'
  | 'events_app_change_events'
  | 'events_change_activity_bursts'
  | 'ops_app_capture_work_state'
  | 'docs_steam_news_items'
  | 'docs_steam_news_search_projection'
  | 'franchises'
  | 'app_genres'
  | 'steam_genres'
  | 'app_steam_tags'
  | 'steam_tags'
  | 'steam_categories'
  | 'docs_youtube_videos'
  | 'docs_youtube_channels'
  | 'docs_youtube_video_matches'
  | 'metrics_youtube_video_snapshots'
  | 'metrics_youtube_game_daily';

export interface QueryProvenance {
  capturedAt: string;
  source: DataPlaneSource;
  tables: string[];
}

export interface ResolveEntitiesRequest {
  continuationToken?: string | null;
  entityKinds?: EntityKind[];
  includeMetrics?: boolean;
  limit?: number;
  query: string;
  resolutionMode?: ResolveEntitiesResolutionMode;
  resolutionPreference?: ResolveEntitiesResolutionPreference | null;
}

export interface ResolvedEntity {
  confidence: number;
  displayName: string;
  entityKind: EntityKind;
  entityUid: string;
  latestMetrics?: {
    ccuPeak: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  matchQuality: MatchQuality;
  matchSource?: ResolveEntityMatchSource | null;
  matchedName: string;
  platform: EntityPlatform;
  platformEntityId: string;
  releaseYear?: number | null;
  resolutionTier?: ResolveEntityResolutionTier | null;
  signals?: {
    gameCount?: number | null;
  };
}

export interface ResolveEntitiesResponse {
  ambiguity: {
    bestTier?: ResolveEntityResolutionTier | null;
    bestTierCount?: number | null;
    candidateNames: string[];
    message: string | null;
    requiresClarification: boolean;
  };
  continuationToken?: string | null;
  entities: ResolvedEntity[];
  provenance: QueryProvenance;
  totalCandidates?: number;
}

export interface SearchCatalogRequest {
  appids?: number[];
  developerIds?: number[];
  continuationToken?: string | null;
  developerQuery?: string | null;
  facetQuery?: string | null;
  genres?: string[];
  includeFacets?: CatalogFacetKind[];
  includeAppTypes?: string[];
  isFree?: boolean | null;
  isReleased?: boolean | null;
  limit?: number;
  minCcu?: number | null;
  minDiscountPercent?: number | null;
  minPriceCents?: number | null;
  minOwners?: number | null;
  minReviewScore?: number | null;
  minReviews?: number | null;
  onSale?: boolean | null;
  parentAppids?: number[];
  platforms?: string[];
  publisherIds?: number[];
  publisherQuery?: string | null;
  query?: string | null;
  releaseYear?: {
    gte?: number | null;
    lte?: number | null;
  } | null;
  sortBy?: 'relevance' | 'reviews' | 'owners' | 'release_date' | 'ccu_peak';
  sortDirection?: 'asc' | 'desc';
  tags?: string[];
  maxPriceCents?: number | null;
}

export interface SearchCatalogItem {
  appid: number;
  appType: string | null;
  ccuPeak: number | null;
  developers: string[];
  developerIds: number[];
  discountPercent: number | null;
  entityUid: string;
  isFree: boolean;
  isReleased: boolean | null;
  name: string;
  ownersMidpoint: number | null;
  parentAppid: number | null;
  platforms: string[];
  priceCents: number | null;
  publishers: string[];
  publisherIds: number[];
  releaseDate: string | null;
  releaseState: string | null;
  releaseYear: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

export interface SearchCatalogResponse {
  continuationToken: string | null;
  facets?: {
    canonicalMatch: {
      name: string;
      type: CatalogFacetKind;
    } | null;
    categories: string[];
    genres: string[];
    tags: string[];
  } | null;
  interpretedFilters: {
    appids: number[];
    developerIds: number[];
    developerQuery: string | null;
    facetQuery: string | null;
    genres: string[];
    includeFacets: CatalogFacetKind[];
    includeAppTypes: string[];
    isFree: boolean | null;
    isReleased: boolean | null;
    minCcu: number | null;
    minDiscountPercent: number | null;
    minPriceCents: number | null;
    minOwners: number | null;
    minReviewScore: number | null;
    minReviews: number | null;
    onSale: boolean | null;
    parentAppids: number[];
    platforms: string[];
    publisherIds: number[];
    publisherQuery: string | null;
    query: string | null;
    releaseYear: {
      gte: number | null;
      lte: number | null;
    } | null;
    sortBy: SearchCatalogRequest['sortBy'];
    sortDirection: SearchCatalogRequest['sortDirection'];
    tags: string[];
    maxPriceCents: number | null;
  };
  items: SearchCatalogItem[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface GetEntityOverviewRequest {
  entityUid?: string;
  entityKind: EntityKind;
  gamesLimit?: number;
  gamesSortBy?: 'release_date' | 'reviews';
  platformEntityId?: string;
}

export interface EntityOverviewGameItem {
  appid: number;
  name: string;
  ownersMidpoint: number | null;
  releaseDate: string | null;
  releaseYear: number | null;
  reviewScore: number | null;
  totalReviews: number | null;
}

export interface GetEntityOverviewResponse {
  entity: {
    details: {
      appType: string | null;
      developerIds: number[];
      developers: string[];
      discountPercent: number | null;
      isFree: boolean | null;
      isReleased: boolean | null;
      parentAppid: number | null;
      platforms: string[];
      priceCents: number | null;
      publisherIds: number[];
      publishers: string[];
      releaseDate: string | null;
      releaseState: string | null;
      releaseYear: number | null;
    };
    displayName: string;
    entityKind: EntityKind;
    entityUid: string;
    metrics: {
      ccuPeak: number | null;
      gameCount: number | null;
      ownersMidpoint: number | null;
      reviewScore: number | null;
      totalReviews: number | null;
    };
    platform: EntityPlatform;
    platformEntityId: string;
  };
  games: EntityOverviewGameItem[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface RankEntitiesRequest {
  aggregateFilters?: {
    minAverageReviewScore?: number | null;
    minGameCount?: number | null;
    minMinimumReviewScore?: number | null;
  } | null;
  catalogFilters?: {
    developerIds?: number[];
    genres?: string[];
    includeAppTypes?: string[];
    isFree?: boolean | null;
    maxPriceCents?: number | null;
    minPriceCents?: number | null;
    minReviewScore?: number | null;
    minReviews?: number | null;
    onSale?: boolean | null;
    parentAppids?: number[];
    platforms?: string[];
    publisherIds?: number[];
    releaseYear?: {
      gte?: number | null;
      lte?: number | null;
    } | null;
    tags?: string[];
  } | null;
  entityKind: EntityKind;
  limit?: number;
  metric: RankMetric;
  query?: string | null;
  recentReleaseDays?: number | null;
  releaseDays?: number | null;
  sortDirection?: 'asc' | 'desc';
}

export interface RankedEntity {
  displayName: string;
  entityKind: EntityKind;
  entityUid: string;
  metricValue: number | null;
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  platform: EntityPlatform;
  platformEntityId: string;
  rank: number;
  releaseYear?: number | null;
}

export interface RankEntitiesResponse {
  entityKind: EntityKind;
  items: RankedEntity[];
  metric: RankMetric;
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface TraceMetricHistoryRequest {
  endDate?: string | null;
  entityUid: string;
  metrics: TraceMetric[];
  startDate?: string | null;
}

export interface TraceMetricHistoryPoint {
  date: string;
  value: number | null;
}

export interface TraceMetricHistorySeriesSummary {
  deltaAbs: number | null;
  deltaPct: number | null;
  firstDate: string | null;
  lastDate: string | null;
  latestValue: number | null;
  pointCount: number;
  startValue: number | null;
}

export interface TraceMetricHistorySeries {
  metric: TraceMetric;
  points: TraceMetricHistoryPoint[];
  summary: TraceMetricHistorySeriesSummary;
}

export interface TraceMetricHistoryResponse {
  entity: {
    displayName: string;
    entityKind: EntityKind;
    entityUid: string;
    platform: EntityPlatform;
    platformEntityId: string;
  };
  endDate: string;
  metrics: TraceMetric[];
  provenance: QueryProvenance;
  series: TraceMetricHistorySeries[];
  startDate: string;
  sufficientToAnswer: boolean;
}

export interface ExplainChangesRequest {
  activityId?: string | null;
  changeTypes?: string[];
  endTime?: string | null;
  entityUid?: string | null;
  includeNews?: boolean;
  limit?: number;
  mode?: 'timeline' | 'before_after';
  sources?: string[];
  startTime?: string | null;
}

export interface ExplainChangesEvent {
  afterValue: unknown | null;
  beforeValue: unknown | null;
  changeType: string;
  context: unknown;
  id: string;
  newsItemGid: string | null;
  occurredAt: string;
  source: string;
}

export interface ExplainChangesLinkedNewsItem {
  feedLabel: string | null;
  feedName: string | null;
  feedScope: string | null;
  firstSeenAt: string;
  gid: string;
  publishedAt: string | null;
  sortTime: string;
  title: string | null;
  url: string;
}

export interface ExplainChangesMoment {
  burstStrength?: 'high' | 'low' | 'medium';
  changeTypes: string[];
  eventCount: number;
  events: ExplainChangesEvent[];
  linkedNews: ExplainChangesLinkedNewsItem[];
  linkedNewsCount?: number;
  significanceReasons?: string[];
  sources: string[];
  windowEnd: string;
  windowStart: string;
}

export interface ExplainChangeMetricsWindow {
  ccuPeak: number | null;
  discountPercent: number | null;
  negativeReviews: number | null;
  positiveReviews: number | null;
  priceCents: number | null;
  reviewScore: number | null;
  reviewScoreLabel: string | null;
  totalReviews: number | null;
}

export interface ExplainChangesResponse {
  comparisonWindows: {
    baseline30d: ExplainChangeMetricsWindow | null;
    baseline7d: ExplainChangeMetricsWindow | null;
    response1d: ExplainChangeMetricsWindow | null;
    response30d: ExplainChangeMetricsWindow | null;
    response7d: ExplainChangeMetricsWindow | null;
  } | null;
  entity: {
    displayName: string;
    entityKind: EntityKind;
    entityUid: string;
    platform: EntityPlatform;
    platformEntityId: string;
  };
  mode: 'timeline' | 'before_after';
  moments: ExplainChangesMoment[];
  provenance: QueryProvenance;
  selectedMoment: ExplainChangesMoment | null;
  sufficientToAnswer: boolean;
  summary: {
    countsByChangeType: Record<string, number>;
    countsBySource: Record<string, number>;
    eventCount: number;
    momentCount: number;
    newsCount: number;
    strongestMomentReasons?: string[];
    strongestMomentStart?: string | null;
    strongestMomentStrength?: 'high' | 'low' | 'medium' | null;
  };
  timeWindow: {
    endTime: string;
    startTime: string;
  };
}

export interface SearchDocumentsRequest {
  endTime?: string | null;
  entityUid?: string | null;
  entityUids?: string[];
  feedScopes?: string[];
  limit?: number;
  mode?: 'topic_search' | 'latest_item' | 'digest';
  query?: string | null;
  startTime?: string | null;
}

export interface SearchDocumentItem {
  appid: number;
  appName: string;
  bodyPreview?: string | null;
  entityUid: string;
  excerpt?: string | null;
  feedLabel: string | null;
  feedName: string | null;
  feedScope: string;
  firstSeenAt: string;
  gid: string;
  matchReason:
    | 'matched_app_name'
    | 'matched_exact_title'
    | 'matched_title_phrase'
    | 'matched_topic_terms'
    | 'recent_entity_news';
  publishedAt: string | null;
  rank: number;
  rankingReason?: string | null;
  sortTime: string;
  title: string | null;
  url: string;
}

export interface SearchDocumentsResponse {
  entity:
    | {
        displayName: string;
        entityKind: EntityKind;
        entityUid: string;
        platform: EntityPlatform;
        platformEntityId: string;
      }
    | null;
  interpretedFilters: {
    endTime: string;
    entityUids: string[];
    feedScopes: string[];
    mode: 'topic_search' | 'latest_item' | 'digest';
    query: string;
    startTime: string;
  };
  items: SearchDocumentItem[];
  latestItem: SearchDocumentItem | null;
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface SearchChangeActivityRequest {
  activityId?: string | null;
  allHistory?: boolean;
  appids?: number[];
  appTypes?: string[];
  continuationToken?: string | null;
  days?: number;
  excludeActivityIds?: string[];
  limit?: number;
  mode?: ChangeActivityMode;
  query?: string | null;
  signalFamilies?: ChangeActivitySignalFamily[];
  sort?: ChangeActivitySort;
  view?: ChangeActivityView;
}

export interface SearchChangeActivityItem {
  activityId: string;
  activityKind: 'change' | 'announcement';
  appType: string | null;
  appid: number;
  burstStrength?: 'high' | 'low' | 'medium';
  externalUrl: string | null;
  facts: string[];
  hasBeforeAfter: boolean;
  headline: string;
  highlightLabels: string[];
  isReleased: boolean | null;
  name: string;
  occurredAt: string;
  relevanceReason?: string | null;
  relevanceScore?: number | null;
  relatedAnnouncementCount: number;
  releaseDate: string | null;
  signalFamilies: ChangeActivitySignalFamily[];
  storyKind: ChangeActivityStoryKind;
  strongestSignal?: string | null;
  summary: string;
}

export interface SearchChangeActivityResponse {
  continuationToken: string | null;
  interpretedFilters: {
    allHistory: boolean;
    appids: number[];
    appTypes: string[];
    days: number;
    mode: ChangeActivityMode;
    query: string | null;
    signalFamilies: ChangeActivitySignalFamily[];
    sort: ChangeActivitySort;
    view: ChangeActivityView;
  };
  items: SearchChangeActivityItem[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface GetChangeActivityDetailRequest {
  activityId: string;
}

export interface ChangeActivityDetailEventItem {
  afterValue: unknown | null;
  appid: number;
  beforeValue: unknown | null;
  changeType: string;
  context: Record<string, unknown> | null;
  eventId: string;
  newsItemGid: string | null;
  occurredAt: string;
  source: string;
}

export interface ChangeActivityDetailNewsItem {
  appid: number;
  appName: string;
  appType: string | null;
  feedLabel: string | null;
  feedName: string | null;
  firstSeenAt: string | null;
  gid: string;
  publishedAt: string | null;
  title: string | null;
  url: string | null;
}

export interface ChangeActivityDetailItem {
  activity: SearchChangeActivityItem;
  events: ChangeActivityDetailEventItem[];
  impact: Record<string, unknown> | null;
  relatedNews: ChangeActivityDetailNewsItem[];
}

export interface GetChangeActivityDetailResponse {
  item: ChangeActivityDetailItem | null;
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface GetChangeFeedStatusRequest {}

export interface GetChangeFeedStatusResponse {
  latestNewsEventAt: string | null;
  latestProjectionRefreshAt: string | null;
  latestStorefrontEventAt: string | null;
  oldestProjectionQueuedAt: string | null;
  oldestQueuedAt: string | null;
  projectionQueuedJobs: number;
  provenance: QueryProvenance;
  queuedJobs: number;
}

export interface DiscoverChangePatternProof {
  activityId: string;
  facts: string[];
  headline: string;
  occurredAt: string;
  signalFamilies: ChangeActivitySignalFamily[];
  summary: string;
}

export interface DiscoverChangePatternItem {
  activityIds: string[];
  appType: string | null;
  appid: number;
  confidence: 'high' | 'medium';
  metrics: {
    ccuPeak: number | null;
    ccuTrend7dPct: number | null;
    discountPercent: number | null;
    positivePercentage: number | null;
    priceCents: number | null;
    reviewVelocity30d: number | null;
    reviewVelocity7d: number | null;
    totalReviews: number | null;
    trend30dDirection: string | null;
  } | null;
  name: string;
  occurredAt: string;
  primaryProof: DiscoverChangePatternProof | null;
  reasons: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  storyKinds: ChangeActivityStoryKind[];
}

export interface DiscoverChangePatternsRequest {
  appTypes?: string[];
  continuationToken?: string | null;
  days?: number;
  excludeAppIds?: number[];
  limit?: number;
  pattern: ChangePattern;
  query?: string | null;
}

export interface DiscoverChangePatternsResponse {
  continuationToken: string | null;
  interpretedFilters: {
    appTypes: string[];
    days: number;
    pattern: ChangePattern;
    query: string | null;
  };
  items: DiscoverChangePatternItem[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface DiscoverMomentumRequest {
  appids?: number[];
  excludeAppIds?: number[];
  filters?: {
    genres?: string[];
    isFree?: boolean | null;
    maxPriceCents?: number | null;
    maxReviews?: number | null;
    minCcu?: number | null;
    minReviewScore?: number | null;
    minReviews?: number | null;
    minReviewsAdded30d?: number | null;
    minReviewsAdded7d?: number | null;
    maxSentimentDelta?: number | null;
    minSentimentDelta?: number | null;
    platforms?: string[];
    releaseYear?: {
      gte?: number | null;
      lte?: number | null;
    } | null;
    steamDeck?: Array<'playable' | 'verified'>;
    tags?: string[];
  } | null;
  indieHeuristic?: boolean;
  limit?: number;
  sortBy:
    | 'ccu_peak'
    | 'momentum_score'
    | 'review_score'
    | 'reviews_added_30d'
    | 'reviews_added_7d'
    | 'sentiment_delta'
    | 'total_reviews'
    | 'velocity_7d'
    | 'velocity_acceleration';
  sortDirection?: 'asc' | 'desc';
  timeframe?: '7d' | '30d' | 'current';
  trendType?: 'accelerating' | 'breaking_out' | 'declining' | 'review_momentum' | null;
}

export interface DiscoverMomentumItem {
  appid: number;
  ccuGrowth30dPercent: number | null;
  ccuGrowth7dPercent: number | null;
  ccuPeak: number | null;
  ccuSparkline?: number[] | null;
  developerName: string | null;
  discountPercent: number | null;
  entityUid: string;
  isFree: boolean;
  isSelfPublished: boolean;
  matchedSteamDeck: 'playable' | 'verified' | null;
  momentumScore: number | null;
  name: string;
  platformSupport: string[];
  priceCents: number | null;
  publisherName: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  reviewPercentage: number | null;
  reviewsAdded30d: number | null;
  reviewsAdded7d: number | null;
  sentimentDelta: number | null;
  steamDeckCategory: string | null;
  supportLevel: 'high' | 'low' | 'medium';
  supportReasons: string[];
  totalReviews: number | null;
  trendDirection: 'down' | 'stable' | 'up' | null;
  velocity30d: number | null;
  velocity7d: number | null;
  velocityAcceleration: number | null;
}

export interface DiscoverMomentumResponse {
  filtersApplied: string[];
  items: DiscoverMomentumItem[];
  provenance: QueryProvenance;
  rankingDefinition: string;
  rankingLabel: string;
  sortBy: DiscoverMomentumRequest['sortBy'];
  sortDirection?: DiscoverMomentumRequest['sortDirection'];
  sufficientToAnswer: boolean;
  timeframe: '7d' | '30d' | 'current';
  timeframeLabel: string;
  trendType: DiscoverMomentumRequest['trendType'];
}

export interface GetRelatedEntitiesRequest {
  excludeSource?: boolean;
  filters?: {
    minReviewScore?: number | null;
    reviewComparison?: 'any' | 'better_only';
    steamDeck?: Array<'playable' | 'verified'>;
  } | null;
  limit?: number;
  relationKind: RelatedEntityKind;
  sourceAppid?: number | null;
  sourceEntityUid?: string | null;
}

export interface RelatedEntityResultItem {
  appid: number;
  entityUid: string;
  name: string;
  releaseDate: string | null;
  releaseYear: number | null;
  reviewScore: number | null;
  steamDeckCategory: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
  totalReviews: number | null;
}

export interface GetRelatedEntitiesResponse {
  items: RelatedEntityResultItem[];
  matchMode?: 'parent_appid' | 'relation_ids_only' | 'structured_relation' | 'title_family';
  provenance: QueryProvenance;
  relationKind: RelatedEntityKind;
  source: {
    appid: number;
    displayName: string;
    entityUid: string;
    franchiseNames?: string[];
    reviewScore: number | null;
    steamDeckCategory: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
    totalReviews: number | null;
  };
  sufficientToAnswer: boolean;
  unresolvedAppids?: number[];
  unresolvedCount?: number;
}

export interface SemanticSearchRequest {
  continuationToken?: string | null;
  description?: string | null;
  entityKind: EntityKind;
  filters?: SemanticSearchFilters;
  limit?: number;
  mode: 'concept' | 'similarity';
  referencePlatformEntityId?: string | null;
  referenceQuery?: string | null;
}

export type CompareMetric =
  | 'ccu_peak'
  | 'game_count'
  | 'owners_midpoint'
  | 'review_score'
  | 'total_reviews';

export interface CompareEntitiesRequest {
  entityUids: string[];
  metrics?: CompareMetric[];
}

export interface ComparedEntity {
  displayName: string;
  entityKind: EntityKind;
  entityUid: string;
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  platform: EntityPlatform;
  platformEntityId: string;
  releaseYear?: number | null;
}

export interface CompareEntitiesResponse {
  entityKind: EntityKind;
  highlights: Array<{
    displayName: string;
    entityUid: string;
    metric: CompareMetric;
    value: number | null;
  }>;
  items: ComparedEntity[];
  metrics: CompareMetric[];
  platform: EntityPlatform;
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
}

export interface SemanticSearchResponse extends SemanticSearchEngineResult {
  provenance: QueryProvenance;
}

export type UserAlertSeverity = 'low' | 'medium' | 'high';
export type UserAlertType =
  | 'ccu_spike'
  | 'ccu_drop'
  | 'trend_reversal'
  | 'review_surge'
  | 'sentiment_shift'
  | 'price_change'
  | 'new_release'
  | 'milestone';

export interface GetUserContextRequest {
  includeAlertPreferences?: boolean;
  includeAlerts?: boolean;
  includePins?: boolean;
  limitAlerts?: number;
  userId: string;
}

export interface UserContextAlertPreferences {
  alertCcuDrop: boolean;
  alertCcuSpike: boolean;
  alertMilestone: boolean;
  alertNewRelease: boolean;
  alertPriceChange: boolean;
  alertReviewSurge: boolean;
  alertSentimentShift: boolean;
  alertTrendReversal: boolean;
  alertsEnabled: boolean;
  ccuSensitivity: number;
  emailDigestEnabled: boolean;
  emailDigestFrequency: string | null;
  reviewSensitivity: number;
  sentimentSensitivity: number;
  source: 'default' | 'stored';
}

export interface UserContextPinAlertSettings {
  alertCcuDrop: boolean | null;
  alertCcuSpike: boolean | null;
  alertMilestone: boolean | null;
  alertNewRelease: boolean | null;
  alertPriceChange: boolean | null;
  alertReviewSurge: boolean | null;
  alertSentimentShift: boolean | null;
  alertTrendReversal: boolean | null;
  alertsEnabled: boolean;
  ccuSensitivity: number | null;
  reviewSensitivity: number | null;
  sentimentSensitivity: number | null;
  useCustomSettings: boolean;
}

export interface UserContextPin {
  alertSettings: UserContextPinAlertSettings | null;
  displayName: string;
  entityKind: EntityKind;
  entityUid: string;
  metrics: {
    ccuPeak: number | null;
    gameCount: number | null;
    ownersMidpoint: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  };
  pinId: string;
  pinOrder: number;
  pinnedAt: string;
  platform: EntityPlatform;
  platformEntityId: string;
  summary: {
    appType?: string | null;
    isFree?: boolean | null;
    platforms?: string[];
    releaseYear?: number | null;
  };
}

export interface UserContextAlert {
  alertId: string;
  alertType: UserAlertType;
  changePercent: number | null;
  createdAt: string;
  currentValue: number | null;
  description: string;
  entity: {
    displayName: string;
    entityKind: EntityKind;
    entityUid: string;
    platform: EntityPlatform;
    platformEntityId: string;
  };
  isRead: boolean;
  metricName: string | null;
  pinId: string;
  previousValue: number | null;
  readAt: string | null;
  severity: UserAlertSeverity;
  title: string;
}

export interface GetUserContextResponse {
  alertPreferences: UserContextAlertPreferences | null;
  alerts: UserContextAlert[];
  pins: UserContextPin[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
  totalAlerts: number;
  totalPins: number;
  unreadAlertCount: number;
  userId: string;
}

export interface ContinueResultSetRequest {
  continuationToken?: string | null;
  delta?: {
    maxPriceCents?: number;
    steamDeck?: Array<'verified' | 'playable'>;
  };
  requestedCount?: number;
  sourceArgs: DiscoverMomentumRequest | SearchCatalogRequest | SemanticSearchRequest;
  sourceContract: 'discoverMomentum' | 'searchCatalog' | 'semanticSearch';
}

export interface ContinueResultSetResponse {
  continuationToken: string | null;
  effectiveArgs: DiscoverMomentumRequest | SearchCatalogRequest | SemanticSearchRequest;
  exhausted: boolean;
  provenance: QueryProvenance;
  result: DiscoverMomentumResponse | SearchCatalogResponse | SemanticSearchResponse;
  sourceContract: ContinueResultSetRequest['sourceContract'];
  sufficientToAnswer: boolean;
}

export type YoutubeGameCoverageView =
  | 'latest_videos'
  | 'creator_coverage'
  | 'top_videos'
  | 'video_growth'
  | 'content_mix'
  | 'cadence';
export type YoutubeContentClass =
  | 'standard_video'
  | 'short'
  | 'live_or_recent_live';
type YoutubeCoverageWindowDays = 1 | 2 | 3 | 7 | 14 | 30;
export type YoutubeCoverageWindow = 'current' | `${YoutubeCoverageWindowDays}d`;

export interface GetYoutubeGameCoverageRequest {
  contentClass?: YoutubeContentClass | null;
  entityUid: string;
  limit?: number;
  offset?: number;
  view: YoutubeGameCoverageView;
  window?: YoutubeCoverageWindow | null;
}

export interface YoutubeGameCoverageVideoItem {
  channelCountry: string | null;
  channelId: string;
  channelSubscriberCount: number | null;
  channelTitle: string;
  commentCount: number | null;
  confidenceScore: number | null;
  contentClass: YoutubeContentClass;
  firstSnapshotAt: string | null;
  growthPct: number | null;
  likeCount: number | null;
  matchedAlias: string | null;
  publishedAt: string | null;
  url: string;
  videoId: string;
  viewCount: number | null;
  viewDelta: number | null;
  lastSnapshotAt: string | null;
  title: string;
}

export interface YoutubeGameCoverageCreatorItem {
  channelCountry: string | null;
  channelId: string;
  channelSubscriberCount: number | null;
  channelTitle: string;
  latestMatchedUploadAt: string | null;
  matchedVideoCount: number;
  totalMatchedViews: number | null;
}

export interface YoutubeGameCoverageContentMixItem {
  contentClass: YoutubeContentClass;
  currentViews: number;
  distinctUploadChannels: number;
  matchedPrimaryVideoCount: number;
  matchedVideoViewDelta: number;
  newMatchedVideos: number;
}

export interface YoutubeGameCoverageCadenceItem {
  distinctUploadChannels: number;
  matchedVideoViewDelta: number;
  newMatchedVideos: number;
  viewsOnNewVideos: number;
  window: Exclude<YoutubeCoverageWindow, 'current'>;
}

export interface YoutubeGameCoverageEntity {
  displayName: string;
  entityKind: 'game';
  entityUid: string;
  platform: 'steam';
  platformEntityId: string;
}

export interface YoutubeGameCoverageSummary {
  freshestMatchedUploadAt: string | null;
  latestSnapshotAt: string | null;
  matchedPrimaryVideoCount: number;
  matchedVideoViewDelta1d: number | null;
  matchedVideoViewDelta7d: number | null;
  newMatchedVideos1d: number;
  newMatchedVideos30d: number;
  newMatchedVideos7d: number;
  distinctUploadChannels30d: number;
  distinctUploadChannels7d: number;
}

export interface YoutubeGameCoverageAvailability {
  blockingTables: string[];
  reason: string | null;
  state: 'ready' | 'blocked' | 'unavailable';
}

export interface YoutubeGameCoveragePagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  limit: number;
  offset: number;
  totalRows: number;
}

export interface GetYoutubeGameCoverageResponse {
  availability: YoutubeGameCoverageAvailability;
  contentClass: YoutubeContentClass | null;
  creators: YoutubeGameCoverageCreatorItem[];
  entity: YoutubeGameCoverageEntity;
  items: YoutubeGameCoverageVideoItem[];
  limit: number;
  pagination?: YoutubeGameCoveragePagination | null;
  provenance: QueryProvenance;
  resolvedWindow: YoutubeCoverageWindow;
  sufficientToAnswer: boolean;
  summary: YoutubeGameCoverageSummary;
  view: YoutubeGameCoverageView;
  cadence: YoutubeGameCoverageCadenceItem | null;
  contentMix: YoutubeGameCoverageContentMixItem[];
}

export interface QueryContractDescriptor {
  description: string;
  endpoint: string;
  name:
    | 'resolveEntities'
    | 'getEntityOverview'
    | 'searchCatalog'
    | 'searchChangeActivity'
    | 'getChangeActivityDetail'
    | 'getChangeFeedStatus'
    | 'discoverMomentum'
    | 'discoverChangePatterns'
    | 'rankEntities'
    | 'compareEntities'
    | 'traceMetricHistory'
    | 'explainChanges'
    | 'searchDocuments'
    | 'semanticSearch'
    | 'getUserContext'
    | 'getRelatedEntities'
    | 'continueResultSet'
    | 'getYoutubeGameCoverage';
  naturalLanguageStrength: string[];
  requiredRelations: DataPlaneRelationKey[];
  status: ContractStatus;
}

export interface RuntimeQueryContractDescriptor extends QueryContractDescriptor {
  blockingTables: string[];
  runtimeReadiness: ContractRuntimeReadiness;
}

export interface DataPlaneReadiness {
  blockedContracts: Array<{
    blockingTables: string[];
    name: QueryContractDescriptor['name'];
  }>;
  provenance: QueryProvenance;
  ready: boolean;
}
