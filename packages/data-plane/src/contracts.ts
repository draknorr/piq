import type {
  SemanticSearchCandidate,
  SemanticSearchDebugInfo,
  SemanticSearchEngineResult,
  SemanticSearchFilters,
  SemanticSearchReference,
  SemanticSearchResultItem,
} from '@publisheriq/semantic-search';

export type {
  SemanticSearchCandidate,
  SemanticSearchDebugInfo,
  SemanticSearchFilters,
  SemanticSearchReference,
  SemanticSearchResultItem,
};

export type EntityKind = 'game' | 'publisher' | 'developer';
export type EntityPlatform = 'steam' | 'publisheriq';
export type DataPlaneSource = 'supabase-postgres' | 'tiger';
export type MatchQuality = 'exact' | 'prefix' | 'substring';
export type ContractStatus = 'ready' | 'planned';
export type ContractRuntimeReadiness = 'ready' | 'blocked';
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
export type DataPlaneRelationKey =
  | 'apps'
  | 'developers'
  | 'publishers'
  | 'app_dlc'
  | 'app_developers'
  | 'app_publishers'
  | 'latest_daily_metrics'
  | 'metrics_daily_metrics'
  | 'core_entities'
  | 'events_app_change_events'
  | 'docs_steam_news_items'
  | 'docs_steam_news_search_projection'
  | 'app_genres'
  | 'steam_genres'
  | 'app_steam_tags'
  | 'steam_tags';

export interface QueryProvenance {
  capturedAt: string;
  source: DataPlaneSource;
  tables: string[];
}

export interface ResolveEntitiesRequest {
  entityKinds?: EntityKind[];
  includeMetrics?: boolean;
  limit?: number;
  query: string;
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
  matchedName: string;
  platform: EntityPlatform;
  platformEntityId: string;
  releaseYear?: number | null;
  signals?: {
    gameCount?: number | null;
  };
}

export interface ResolveEntitiesResponse {
  ambiguity: {
    candidateNames: string[];
    message: string | null;
    requiresClarification: boolean;
  };
  entities: ResolvedEntity[];
  provenance: QueryProvenance;
}

export interface SearchCatalogRequest {
  appids?: number[];
  developerIds?: number[];
  continuationToken?: string | null;
  developerQuery?: string | null;
  genres?: string[];
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
  interpretedFilters: {
    appids: number[];
    developerIds: number[];
    developerQuery: string | null;
    genres: string[];
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
  entityKind: EntityKind;
  gamesLimit?: number;
  gamesSortBy?: 'release_date' | 'reviews';
  platformEntityId: string;
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
  entityKind: EntityKind;
  limit?: number;
  metric: RankMetric;
  query?: string | null;
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
  changeTypes?: string[];
  endTime?: string | null;
  entityUid: string;
  includeNews?: boolean;
  limit?: number;
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
  changeTypes: string[];
  eventCount: number;
  events: ExplainChangesEvent[];
  linkedNews: ExplainChangesLinkedNewsItem[];
  sources: string[];
  windowEnd: string;
  windowStart: string;
}

export interface ExplainChangesResponse {
  entity: {
    displayName: string;
    entityKind: EntityKind;
    entityUid: string;
    platform: EntityPlatform;
    platformEntityId: string;
  };
  moments: ExplainChangesMoment[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
  summary: {
    countsByChangeType: Record<string, number>;
    countsBySource: Record<string, number>;
    eventCount: number;
    momentCount: number;
    newsCount: number;
  };
  timeWindow: {
    endTime: string;
    startTime: string;
  };
}

export interface SearchDocumentsRequest {
  endTime?: string | null;
  entityUid?: string | null;
  feedScopes?: string[];
  limit?: number;
  query: string;
  startTime?: string | null;
}

export interface SearchDocumentItem {
  appid: number;
  appName: string;
  entityUid: string;
  feedLabel: string | null;
  feedName: string | null;
  feedScope: string;
  firstSeenAt: string;
  gid: string;
  matchReason: 'matched_title_phrase' | 'matched_topic_terms';
  publishedAt: string | null;
  rank: number;
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
    feedScopes: string[];
    query: string;
    startTime: string;
  };
  items: SearchDocumentItem[];
  provenance: QueryProvenance;
  sufficientToAnswer: boolean;
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

export interface ContinueResultSetRequest {
  continuationToken?: string | null;
  delta?: {
    maxPriceCents?: number;
    steamDeck?: Array<'verified' | 'playable'>;
  };
  requestedCount?: number;
  sourceArgs: SearchCatalogRequest | SemanticSearchRequest;
  sourceContract: 'searchCatalog' | 'semanticSearch';
}

export interface ContinueResultSetResponse {
  continuationToken: string | null;
  effectiveArgs: SearchCatalogRequest | SemanticSearchRequest;
  exhausted: boolean;
  provenance: QueryProvenance;
  result: SearchCatalogResponse | SemanticSearchResponse;
  sourceContract: ContinueResultSetRequest['sourceContract'];
  sufficientToAnswer: boolean;
}

export interface QueryContractDescriptor {
  description: string;
  endpoint: string;
  name:
    | 'resolveEntities'
    | 'getEntityOverview'
    | 'searchCatalog'
    | 'rankEntities'
    | 'compareEntities'
    | 'traceMetricHistory'
    | 'explainChanges'
    | 'searchDocuments'
    | 'semanticSearch'
    | 'getUserContext'
    | 'continueResultSet';
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
