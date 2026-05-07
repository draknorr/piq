import 'server-only';

import type {
  SessionChatContext,
  SessionChatLastAnswer,
  SessionMomentumPromptFamily,
  SessionChatRequestPreviewItem,
  SessionChatRequestState,
  SessionChatSelectionCandidate,
  SessionChatSelectionSlot,
  SessionChatSelectionState,
  SessionSelectionEntityKind,
  SessionSelectionMatchQuality,
  SessionSelectionMatchSource,
  SessionSelectionResolutionTier,
} from '@/lib/chat/chat-context-types';
import { COMMON_TAGS, type QuerySuggestion } from '@/lib/chat/query-templates';
import { buildChatEntityUid } from '@/lib/chat/entity-uid';
import { resolveQueryApiBaseUrl } from '@/lib/query-api-config';
import type {
  TigerPromptEntityHint,
  TigerPromptInterpretation,
} from '@/lib/chat/tiger-prompt-interpreter';
import {
  buildTigerClarificationBrief,
  buildTigerSuccessBrief,
  renderTigerAnswerBrief,
  type TigerAnswerBrief,
} from '@/lib/chat/tiger-answer-brief';
import type { ChatToolCall } from '@/lib/llm/types';
import { renderTigerPrimaryResult } from '@/lib/chat/tiger-primary-renderer';
import { sanitizeForwardFacingDataCopy } from '@/lib/chat/forward-facing-copy';

import type {
  TigerPrimaryInfo,
  TigerPrimaryMode,
  TigerRolloutCohort,
  TigerShadowAttempt,
  TigerShadowInfo,
  TigerShadowMatchedIntent,
  TigerShadowMode,
} from './tiger-shadow-types';

const DEFAULT_PRIMARY_TIMEOUT_MS = 8000;
const DEFAULT_COMPARE_RESOLUTION_TIMEOUT_MS = 20000;
const DEFAULT_SHADOW_TIMEOUT_MS = 8000;
const MIN_PRIMARY_ENTITY_RESOLUTION_TIMEOUT_MS = 12000;
const NEWS_TOOL_NAMES = new Set([
  'get_recent_news_detail',
  'get_recent_news_digest',
  'search_recent_news_topics',
]);
const CHANGE_DISCOVERY_TOOL_NAMES = new Set([
  'query_change_activity',
  'get_change_activity_detail',
  'find_change_patterns',
]);
const CHANGE_EXPLANATION_TOOL_NAMES = new Set([
  'get_game_change_timeline',
  'compare_change_before_after',
]);
const MOMENTUM_TOOL_NAMES = new Set([
  'discover_trending',
  'screen_games',
]);
const NEWS_PROMPT_PATTERN =
  /\b(news|announcement|announcements|patch notes?|devlog|dev diar(?:y|ies)|developer diar(?:y|ies)|roadmap|demo|playtest|update notes?|recent updates?|behind the scenes)\b/i;
const USER_ALERT_PROMPT_PATTERN =
  /\b(?:my alerts?|unread alerts?|recent alerts?|alert history|what alerts do i have)\b/i;
const USER_PORTFOLIO_PROMPT_PATTERN =
  /\b(?:my portfolio|my pins?|games? i pinned|what have i pinned|what am i tracking|tracked games|tracked publishers|tracked developers)\b/i;
const CHANGE_PROMPT_PATTERN =
  /\b(what changed|changed recently|why did .* spike|recent(?: steam)? changes|steam changes|change timeline|timeline of changes)\b/i;
const CHANGE_DISCOVERY_PROMPT_PATTERN =
  /\b(biggest steam page refreshes?|store-?page changes?|release timing changes?|changed tags?(?: or genres?)?|marketing push|relaunch pattern|teasing a big update|sustained response|under-marketed|signable indie games|agency leads|without an announcement)\b/i;
const YOUTUBE_EXPLICIT_PROMPT_PATTERN =
  /\byoutube\b|\b(?:creators?|channels?|shorts?)\b|\b(?:live(?:\s+or\s+recent\s+live)?(?:\s+videos?)?|livestreams?|upload channels?)\b/i;
const YOUTUBE_IMPLICIT_ACTIVITY_PROMPT_PATTERN =
  /\b(?:latest|newest|recent|fresh(?:est|ness)?|top|biggest|largest|most-viewed|most views|growing|growth|fastest-growing|creator pickup|cover(?:ing|age)|upload channels?|new matched videos?|new uploads?|latest uploads?|latest posts?|content mix|formats?|cadence|activity)\b/i;
const YOUTUBE_ACTIVITY_DETAIL_PROMPT_PATTERN =
  /\b(?:videos?|uploads?|creators?|channels?|who(?:'s|\s+is)?\s+covering|posted about|making content for|creator pickup|upload channels?|content mix|formats?|cadence|fresh(?:est|ness)?|activity|top videos?|most-viewed|most views|fastest-growing|growth)\b/i;
const PROSPECT_DISCOVERY_PROMPT_PATTERN =
  /\b(?:agency|prospects?|marketing[- ]agency|under-?marketed|signable|lead quality|evidence quality)\b/i;
const MOMENTUM_PROMPT_PATTERN =
  /\b(?:most players(?: right now)?|highest ccu|most concurrent players?|most played(?: right now)?|trending(?: up)?|trending down|gaining momentum|gaining traction|hot right now|breaking out|accelerating|declining|review momentum|reviews? surging|trending up in reviews|improving sentiment|worsening sentiment|reviews? slipping|reviews? improving|reviews? slowing down)\b/i;
const MOMENTUM_PLAYER_PROMPT_PATTERN =
  /\b(?:most players(?: right now)?|highest ccu|most concurrent players?|most played(?: right now)?)\b/i;
const MONTHLY_PLAYTIME_PROMPT_PATTERN =
  /\b(?:monthly|last month|this month|january|february|march|april|may|june|july|august|september|october|november|december)\b[\s\S]*\b(?:playtime|played hours|hours played|estimated hours|estimated playtime)\b|\b(?:playtime|played hours|hours played|estimated hours|estimated playtime)\b[\s\S]*\b(?:monthly|last month|this month|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const MOMENTUM_TRENDING_PROMPT_PATTERN =
  /\b(?:trending(?: up)?|gaining momentum|gaining traction|hot right now)\b/i;
const MOMENTUM_BREAKOUT_PROMPT_PATTERN = /\bbreaking out\b/i;
const MOMENTUM_ACCELERATING_PROMPT_PATTERN = /\baccelerating\b/i;
const MOMENTUM_DECLINING_PROMPT_PATTERN = /\b(?:declining|trending down)\b/i;
const MOMENTUM_REVIEW_PROMPT_PATTERN = /\b(?:review momentum|reviews? surging)\b/i;
const MOMENTUM_DISCOVERY_LEAD_PATTERN =
  /\b(?:what(?:'s| is| are)?|which|show|find|give|list)\b/i;
const COMPANY_GAME_LIST_PROMPT_PATTERN =
  /\b(?:show|list|find|give|top|best)\b.*\bgames?\b.*\b(?:by|from)\b|\bgames?\b.*\b(?:by|from)\b/i;
const RELATION_PROMPT_PATTERN =
  /\b(?:show|list|find|give)\b.*\b(?:dlc|downloadable content)\b|\b(?:same franchise|same series)\b/i;
const FACET_DISCOVERY_PROMPT_PATTERN =
  /\b(?:what|which|show|list|find)\b.*\b(tags?|genres?|categories)\b.*\b(?:exist|for|in)\b/i;
const ENTITY_OVERVIEW_PROMPT_PATTERN =
  /\b(?:tell me about|what can you tell me about|what do you know about|give me an overview of|overview of)\b/i;
const COMPANY_COUNT_PROMPT_PATTERN =
  /\bhow many\s+(?:games|titles)\s+has\s+(.+?)\s+(?:published|developed)\b/i;
const COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN =
  /\bhow many\s+(?:players?|owners?|reviews?)\s+do\s+(.+?)\s+games?\s+have\b/i;
const GAME_METRIC_OVERVIEW_PROMPT_PATTERN =
  /\bhow many\s+(?:players?|owners?|reviews?)\s+does\s+(.+?)\s+have\b|\bwhat(?:'s| is)\s+(?:the\s+)?(?:review score|price|discount|ccu|owners?|player count|total reviews?)\s+for\s+(.+?)(?:[?!.]|$)/i;
const GAME_METRIC_OVERVIEW_REVERSED_PROMPT_PATTERN =
  /\bwhat\s+(?:the\s+)?(?:review score|price|discount|ccu|owners?|player count|total reviews?)\s+is\s+(.+?)(?:[?!.]|$)/i;
const NON_ENTITY_GAME_METRIC_QUERY_PATTERN =
  /^(?:the\s+)?(?:highest|most|top|best|largest|biggest|trending|breaking out|hot right now|all games?|all titles?|games?|titles?)\b/i;
const SEMANTIC_SIMILARITY_PROMPT_PATTERN =
  /\b(?:games?|publishers?|developers?|studios?)\b.*\b(?:like|similar to)\b|\b(?:similar to|like)\b.*\b(?:games?|publishers?|developers?|studios?)\b/i;
const CONCEPT_DISCOVERY_PROMPT_PATTERN =
  /\b(?:recommend|find|show|give)\b.*\bgames?\b/i;
const COMPARE_PROMPT_PATTERN =
  /\bcompare\b|\bvs\.?\b|\bversus\b|\bstack up\b/i;
const COMPARE_TOP_PEERSET_PATTERN = /\bcompare\s+top\s+\d+\b/i;
const COMPARE_FOLLOW_UP_PROMPT_PATTERN =
  /\b(?:compare\s+(?:those|them)|same compare|same comparison|same set|same results)\b/i;
const COMPARE_TOP_COUNT_FOLLOW_UP_PROMPT_PATTERN =
  /^(?:now|just)\s+(?:the\s+)?top\s+(\d+)\b/i;
const SAME_FAMILY_ENTITY_FOLLOW_UP_PATTERN =
  /^(?:and\s+)?(?:what|how)\s+about\s+(.+?)(?:[?!.]|$)/i;
const ENTITY_KIND_CORRECTION_PATTERN =
  /^(.+?)\s+is\s+(?:a|an)\s+(game|publisher|developer|studio|company)(?:[?!.]|$)/i;
const METRIC_LIKE_ENTITY_QUERY_PATTERN =
  /\b(?:reviews?|review score|ratings?|owners?|players?|player count|ccu|concurrent players?|sales|price|discount|release date|release year|momentum|velocity)\b/i;
const UNSUPPORTED_SEMANTIC_MIXED_PATTERN =
  /\b(?:breaking out|trending(?: up)?|accelerating|declining|review momentum|reviews? surging|most players(?: right now)?|highest ccu|most concurrent players?)\b/i;
const SAME_FRANCHISE_PATTERN = /\b(?:same franchise|same series)\b/i;
const SINGLE_SELECTION_INDEX_PATTERN =
  /^\s*(\d+)\s*$/i;
const COMPARE_SELECTION_INDEX_PATTERN =
  /^\s*(\d+)\s*(?:and|&)\s*(\d+)\s*$/i;
const SWITCH_TO_OTHER_PATTERN =
  /\b(?:use|switch(?:\s+\w+)?)\s+(?:to\s+)?the\s+other\s+one\b/i;
const SWITCH_TO_ROLE_PATTERN =
  /\b(?:use|switch(?:\s+\w+)?)\s+(?:to\s+)?the\s+(publisher|developer|game)\s+one\b/i;
const SWITCH_TO_NAMED_ENTITY_PATTERN =
  /\b(?:use|switch(?:\s+\w+)?)\b.+\b(?:instead|one)?\b/i;
const DID_YOU_MEAN_PATTERN = /^\s*did\s+you\s+mean\b/i;
const ORGANIZATION_SUFFIX_PATTERN =
  /\b(games|studios?|entertainment|interactive|digital|inc\.?|ltd\.?|llc|works|software|soft|productions?)\b/i;
const METRIC_HISTORY_PROMPT_PATTERN =
  /\b(?:how have|show|track|history of|over time|trend of)\b.*\b(?:reviews?|review score|sentiment|owners?|sales|ccu|concurrent players?|price|discount|playtime)\b/i;
const RANKING_BASE_PROMPT_PATTERN =
  /\b(?:top|highest|best|most|largest|biggest)\b/i;
const METRIC_HISTORY_DISALLOWED_PATTERN =
  /\b(?:compare|versus|vs\.?|publishers?|developers?|studios?|why did)\b/i;
const ENTITY_QUERY_PATTERNS = [
  /how have\s+(.+?)\s+(?:reviews?|review score|sentiment|owners?|sales|ccu|concurrent players?|price|discount|playtime)\b/i,
  /show\s+(.+?)\s+(?:ccu|owners?|reviews?|review score|sentiment|price|discount|playtime)\b/i,
  /\b(?:news|announcements|updates?)\b\s+(?:for|about|on)\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
  /\b(?:happened to|changed for)\b\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
  /\b(?:about|for|on)\b\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
];
const YOUTUBE_ENTITY_QUERY_PATTERNS = [
  /\b(?:videos?|uploads?|shorts?|creators?|channels?)\s+(?:for|about|on)\s+(.+?)(?:\s+\b(?:on youtube|youtube|right now|today|this week|this month|in the last|over the last|sorted by|with|that)\b|[?!.]|$)/i,
  /\b(?:creators?|channels?)\s+(?:are\s+)?(?:covering|posting about|making content for)\s+(.+?)(?:\s+\b(?:on youtube|youtube|right now|today|this week|this month|in the last|over the last)\b|[?!.]|$)/i,
  /\bwhich\s+(?:creators?|channels?)\s+(?:are\s+)?(?:covering|posting about|making content for)\s+(.+?)(?:\s+\b(?:on youtube|youtube|right now|today|this week|this month|in the last|over the last)\b|[?!.]|$)/i,
  /\bwho(?:'s|\s+is)?\s+covering\s+(.+?)(?:\s+\b(?:right now|today|this week|this month|on youtube|youtube|in the last|over the last)\b|[?!.]|$)/i,
  /\bwhich\s+(.+?)\s+youtube\s+(?:videos?|uploads?|shorts?|livestreams?|live\s+videos?)\s+are\s+(?:growing|growing fastest|fastest-growing|taking off|breaking out)\b/i,
  /\bwhat\s+does\s+the\s+youtube\s+content\s+mix\s+look\s+like\s+for\s+(.+?)(?:[?!.]|$)/i,
  /\bwhat\s+(?:content\s+mix|formats?)\s+does\s+(.+?)\s+have(?:\s+\b(?:today|this week|this month|in the last|over the last)\b|[?!.]|$)/i,
  /\bhow\s+many\s+.+?\s+did\s+(.+?)\s+get\s+in\s+the\s+last\s+\d+\s+days?(?:[?!.]|$)/i,
  /\bhow\s+many\s+(?:new\s+)?(?:videos?|uploads?|creators?|channels?|upload channels?)\s+did\s+(.+?)\s+get(?:\s+\b(?:today|this week|this month|in the last|over the last|during the last|past)\b|[?!.]|$)/i,
  /\bhow\s+fresh\s+is\s+(?:the\s+)?(?:youtube\s+)?activity\s+(?:around|for)\s+(.+?)(?:[?!.]|$)/i,
  /\bwhen\s+was\s+(?:the\s+)?freshest\s+(?:matched\s+)?upload\s+(?:for|about)\s+(.+?)(?:[?!.]|$)/i,
  /\b(?:is|does)\s+(.+?)\s+(?:have|get|show)\s+(?:broad\s+)?creator\s+pickup(?:\s+\b(?:today|this week|this month|in the last|over the last)\b|[?!.]|$)/i,
  /\bhow\s+many\s+upload\s+channels?\s+(?:posted|covered|are\s+covering)\s+(?:about\s+)?(.+?)(?:\s+\b(?:today|this week|this month|in the last|over the last)\b|[?!.]|$)/i,
  /\bwhich\s+.+?\s+for\s+(.+?)\s+on\s+youtube\b/i,
];

interface ResolveEntitiesResponse {
  ambiguity?: {
    bestTier?: SessionSelectionResolutionTier;
    bestTierCount?: number | null;
    candidateNames?: string[];
    message?: string | null;
    requiresClarification?: boolean;
  };
  continuationToken?: string | null;
  entities?: Array<{
    confidence?: number;
    displayName: string;
    entityKind: string;
    entityUid: string;
    matchQuality?: SessionSelectionMatchQuality;
    matchSource?: SessionSelectionMatchSource;
    matchedName?: string;
    platform: string;
    platformEntityId?: string;
    releaseYear?: number | null;
    resolutionTier?: SessionSelectionResolutionTier;
    latestMetrics?: {
      totalReviews?: number | null;
    };
    signals?: {
      gameCount?: number | null;
    };
  }>;
  totalCandidates?: number;
}

type ResolvedCompareEntity = NonNullable<ResolveEntitiesResponse['entities']>[number];
type CompareMetricName =
  | 'ccu_peak'
  | 'game_count'
  | 'owners_midpoint'
  | 'review_score'
  | 'total_reviews';

interface GetEntityOverviewResponse {
  entity: {
    details: {
      appType?: string | null;
      developers?: string[];
      discountPercent?: number | null;
      isFree?: boolean | null;
      isReleased?: boolean | null;
      platforms?: string[];
      priceCents?: number | null;
      publishers?: string[];
      releaseDate?: string | null;
      releaseState?: string | null;
      releaseYear?: number | null;
    };
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    metrics: {
      ccuPeak: number | null;
      gameCount: number | null;
      ownersMidpoint: number | null;
      reviewScore: number | null;
      totalReviews: number | null;
    };
    platformEntityId: string;
  };
  games: Array<{
    appid: number;
    name: string;
    ownersMidpoint: number | null;
    releaseDate: string | null;
    releaseYear: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  }>;
  sufficientToAnswer?: boolean;
}

interface SearchCatalogResponse {
  continuationToken?: string | null;
  facets?: {
    canonicalMatch?: {
      name?: string;
      type?: 'categories' | 'genres' | 'tags';
    } | null;
    categories?: string[];
    genres?: string[];
    tags?: string[];
  } | null;
  interpretedFilters?: {
    appids?: number[];
    includeAppTypes?: string[];
    includeFacets?: Array<'categories' | 'genres' | 'tags'>;
    maxPriceCents?: number | null;
    minDiscountPercent?: number | null;
    minPriceCents?: number | null;
    onSale?: boolean | null;
    parentAppids?: number[];
    query?: string | null;
    facetQuery?: string | null;
    developerQuery?: string | null;
    platforms?: string[];
    publisherQuery?: string | null;
    releaseYear?: {
      gte?: number | null;
      lte?: number | null;
    } | null;
    tags?: string[];
  };
  items?: Array<{
    appid?: number;
    appType?: string | null;
    entityUid?: string;
    name?: string;
  }>;
  sufficientToAnswer?: boolean;
}

interface RankEntitiesResponse {
  entityKind?: 'developer' | 'game' | 'publisher';
  items?: Array<{
    displayName?: string;
    entityUid?: string;
  }>;
  metric?: 'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews';
  sufficientToAnswer?: boolean;
}

interface GetRelatedEntitiesResponse {
  items?: Array<{
    appid: number;
    entityUid: string;
    name: string;
    releaseDate?: string | null;
    releaseYear?: number | null;
    reviewScore?: number | null;
    steamDeckCategory?: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
    totalReviews?: number | null;
  }>;
  relationKind?: 'dlc' | 'franchise_games';
  matchMode?: 'parent_appid' | 'relation_ids_only' | 'structured_relation' | 'title_family';
  source?: {
    appid: number;
    displayName: string;
    entityUid: string;
    franchiseNames?: string[];
    reviewScore?: number | null;
    steamDeckCategory?: 'playable' | 'verified' | 'unsupported' | 'unknown' | null;
    totalReviews?: number | null;
  };
  sufficientToAnswer?: boolean;
  unresolvedAppids?: number[];
  unresolvedCount?: number;
}

interface SearchDocumentsResponse {
  entity?: {
    displayName?: string;
  } | null;
  interpretedFilters?: {
    mode?: 'digest' | 'latest_item' | 'topic_search';
    query?: string | null;
  };
  items?: Array<{
    appName?: string;
    appid?: number;
    bodyPreview?: string | null;
    excerpt?: string | null;
    feedLabel?: string | null;
    feedScope?: string;
    publishedAt?: string | null;
    sortTime?: string;
    title?: string | null;
    url?: string;
  }>;
  latestItem?: SearchDocumentsResponse['items'] extends Array<infer T> ? T | null : null;
  sufficientToAnswer?: boolean;
}

type ChangeActivitySignalFamily =
  | 'announcement'
  | 'release'
  | 'pricing'
  | 'store-page'
  | 'media'
  | 'taxonomy'
  | 'platform'
  | 'build';

type ChangePattern =
  | 'marketing_push'
  | 'relaunch_pattern'
  | 'update_tease'
  | 'under_marketed'
  | 'signable_candidate'
  | 'rescue_candidate'
  | 'sustained_response'
  | 'announcement_weak_response';

interface SearchChangeActivityResponse {
  interpretedFilters?: {
    days?: number;
    mode?: 'all' | 'announcements' | 'changes';
    query?: string | null;
    signalFamilies?: ChangeActivitySignalFamily[];
    sort?: string;
    view?: string;
  };
  items?: Array<{
    activityId: string;
    activityKind: 'announcement' | 'change';
    appid: number;
    facts: string[];
    headline: string;
    highlightLabels: string[];
    name: string;
    occurredAt: string;
    relatedAnnouncementCount: number;
    signalFamilies: ChangeActivitySignalFamily[];
    storyKind: string;
    summary: string;
  }>;
  sufficientToAnswer?: boolean;
}

interface DiscoverChangePatternsResponse {
  interpretedFilters?: {
    days?: number;
    pattern?: ChangePattern;
    query?: string | null;
  };
  items?: Array<{
    activityIds: string[];
    appid: number;
    confidence: 'high' | 'medium';
    name: string;
    occurredAt: string;
    primaryProof?: {
      activityId: string;
      facts: string[];
      headline: string;
      occurredAt: string;
      signalFamilies: ChangeActivitySignalFamily[];
      summary: string;
    } | null;
    reasons: string[];
    signalFamilies: ChangeActivitySignalFamily[];
  }>;
  sufficientToAnswer?: boolean;
}

interface ProspectRankingResponse {
  interpretedFilters?: {
    mode?: 'prospect_ranking';
    patterns?: ChangePattern[];
  };
  items?: Array<{
    appid: number;
    evidenceQualityScore: number;
    evidenceSummary: string[];
    latestSignalAt: string;
    name: string;
    needScore: number;
    patternSignals: ChangePattern[];
    timingScore: number;
    totalScore: number;
  }>;
  kind?: 'prospect_ranking';
  sufficientToAnswer?: boolean;
}

interface DiscoverMomentumResponse {
  broadeningApplied?: boolean;
  filtersApplied?: string[];
  idealItems?: number;
  items?: Array<{
    appid: number;
    ccuGrowth30dPercent?: number | null;
    ccuGrowth7dPercent?: number | null;
    ccuPeak?: number | null;
    developerName?: string | null;
    discountPercent?: number | null;
    isFree: boolean;
    isSelfPublished?: boolean;
    matchedSteamDeck?: 'playable' | 'verified' | null;
    momentumScore?: number | null;
    name: string;
    platformSupport?: string[];
    priceCents?: number | null;
    publisherName?: string | null;
    releaseDate?: string | null;
    releaseYear?: number | null;
    reviewPercentage?: number | null;
    reviewsAdded30d?: number | null;
    reviewsAdded7d?: number | null;
    sentimentDelta?: number | null;
    steamDeckCategory?: string | null;
    supportLevel?: 'high' | 'low' | 'medium';
    supportReasons?: string[];
    totalReviews?: number | null;
    trendDirection?: 'down' | 'stable' | 'up' | null;
    velocity30d?: number | null;
    velocity7d?: number | null;
    velocityAcceleration?: number | null;
  }>;
  minimumItems?: number;
  provenance?: {
    capturedAt?: string;
    source?: 'supabase-postgres' | 'tiger';
    tables?: string[];
  } | null;
  provenanceSource?: 'supabase-postgres' | 'tiger' | null;
  rankingDefinition?: string;
  rankingLabel?: string;
  resultCount?: number;
  shortfallReason?: string | null;
  sortBy?:
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
  sufficientToAnswer?: boolean;
  timeframe?: '7d' | '30d' | 'current';
  timeframeLabel?: string;
  trendType?: 'accelerating' | 'breaking_out' | 'declining' | 'review_momentum' | null;
}

interface TraceMetricHistoryResponse {
  series?: unknown[];
  sufficientToAnswer?: boolean;
}

interface ExplainChangesResponse {
  comparisonWindows?: unknown | null;
  entity?: {
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    entityUid: string;
    platform: 'publisheriq' | 'steam';
    platformEntityId: string;
  };
  mode?: 'before_after' | 'timeline';
  moments?: Array<{
    changeTypes: string[];
    eventCount: number;
    events: unknown[];
    linkedNews: unknown[];
    sources: string[];
    windowEnd?: string;
    windowStart: string;
  }>;
  provenance?: unknown;
  selectedMoment?: unknown | null;
  sufficientToAnswer?: boolean;
  summary?: {
    countsByChangeType?: Record<string, number>;
    countsBySource?: Record<string, number>;
    eventCount?: number;
    momentCount?: number;
    newsCount?: number;
  };
  timeWindow?: {
    endTime: string;
    startTime: string;
  };
}

interface SemanticSearchResponse {
  close_alternatives?: unknown[];
  close_alternatives_reason?: string;
  continuation_token?: string | null;
  entityType?: 'developer' | 'publisher';
  query_description?: string;
  reference?: {
    id: number;
    name: string;
    type: string;
  };
  results?: unknown[];
  sufficientToAnswer?: boolean;
  sufficient_to_answer?: boolean;
}

interface GetUserContextResponse {
  alertPreferences?: {
    alertsEnabled?: boolean;
    emailDigestEnabled?: boolean;
    emailDigestFrequency?: string | null;
  } | null;
  alerts?: Array<{
    alertId: string;
    alertType: string;
    createdAt: string;
    description: string;
    entity: {
      displayName: string;
      entityKind: 'developer' | 'game' | 'publisher';
    };
    isRead: boolean;
    severity: 'high' | 'low' | 'medium';
    title: string;
  }>;
  pins?: Array<{
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    metrics: {
      ccuPeak?: number | null;
      gameCount?: number | null;
      ownersMidpoint?: number | null;
      reviewScore?: number | null;
      totalReviews?: number | null;
    };
    pinId: string;
    pinOrder: number;
    pinnedAt: string;
  }>;
  sufficientToAnswer?: boolean;
  totalAlerts?: number;
  totalPins?: number;
  unreadAlertCount?: number;
}

interface CompareEntitiesResponse {
  entityKind?: 'developer' | 'game' | 'publisher';
  highlights?: unknown[];
  items?: unknown[];
  metrics?: CompareMetricName[];
  platform?: 'publisheriq' | 'steam';
  sufficientToAnswer?: boolean;
}

interface QueryApiResponse<T> {
  data?: T;
  errorCode?: string | null;
  httpStatus: number | null;
  ok: boolean;
  reason?: string | null;
}
type YoutubeCoverageView =
  | 'latest_videos'
  | 'creator_coverage'
  | 'top_videos'
  | 'video_growth'
  | 'content_mix'
  | 'cadence';
type YoutubeContentClass =
  | 'standard_video'
  | 'short'
  | 'live_or_recent_live';
type YoutubeCoverageWindowDays = 1 | 2 | 3 | 7 | 14 | 30;
type YoutubeCoverageWindow = 'current' | `${YoutubeCoverageWindowDays}d`;

interface GetYoutubeGameCoverageRequest {
  contentClass?: YoutubeContentClass | null;
  entityUid: string;
  limit?: number;
  offset?: number;
  view: YoutubeCoverageView;
  window?: YoutubeCoverageWindow | null;
}

interface GetYoutubeGameCoverageResponse {
  availability?: {
    blockingTables?: string[];
    reason?: string | null;
    state?: 'blocked' | 'ready' | 'unavailable';
  };
  cadence?: {
    distinctUploadChannels?: number;
    matchedVideoViewDelta?: number;
    newMatchedVideos?: number;
    viewsOnNewVideos?: number;
    window?: YoutubeCoverageWindow;
  } | null;
  contentClass?: YoutubeContentClass | null;
  contentMix?: Array<{
    contentClass?: YoutubeContentClass;
    currentViews?: number;
    distinctUploadChannels?: number;
    matchedPrimaryVideoCount?: number;
    matchedVideoViewDelta?: number;
    newMatchedVideos?: number;
  }>;
  creators?: Array<{
    channelCountry?: string | null;
    channelId?: string;
    channelSubscriberCount?: number | null;
    channelTitle?: string;
    latestMatchedUploadAt?: string | null;
    matchedVideoCount?: number;
    totalMatchedViews?: number | null;
  }>;
  entity?: {
    displayName?: string;
    entityKind?: 'game';
    entityUid?: string;
    platform?: 'steam';
    platformEntityId?: string;
  };
  items?: Array<{
    channelCountry?: string | null;
    channelId?: string;
    channelSubscriberCount?: number | null;
    channelTitle?: string;
    commentCount?: number | null;
    confidenceScore?: number | null;
    contentClass?: YoutubeContentClass;
    firstSnapshotAt?: string | null;
    growthPct?: number | null;
    lastSnapshotAt?: string | null;
    likeCount?: number | null;
    matchedAlias?: string | null;
    publishedAt?: string | null;
    title?: string;
    url?: string;
    videoId?: string;
    viewCount?: number | null;
    viewDelta?: number | null;
  }>;
  limit?: number;
  pagination?: {
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
    limit?: number;
    offset?: number;
    totalRows?: number;
  } | null;
  resolvedWindow?: YoutubeCoverageWindow;
  sufficientToAnswer?: boolean;
  summary?: {
    distinctUploadChannels30d?: number;
    distinctUploadChannels7d?: number;
    freshestMatchedUploadAt?: string | null;
    latestSnapshotAt?: string | null;
    matchedPrimaryVideoCount?: number;
    matchedVideoViewDelta1d?: number | null;
    matchedVideoViewDelta7d?: number | null;
    newMatchedVideos1d?: number;
    newMatchedVideos30d?: number;
    newMatchedVideos7d?: number;
  };
  view?: YoutubeCoverageView;
}

const TIGER_RUNTIME_FAILURE_PATTERN =
  /internal server error|failed to fetch|fetch failed|network|timeout|timed out|connection|socket|econn|abort/i;

function isTigerNetworkRuntimeFailure(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && TIGER_RUNTIME_FAILURE_PATTERN.test(reason);
}

function isTigerContractRuntimeBlockedFailure(params: {
  errorCode?: string | null;
  reason?: string | null;
}): boolean {
  if (params.errorCode === 'CONTRACT_RUNTIME_UNAVAILABLE') {
    return true;
  }

  return typeof params.reason === 'string'
    && /not ready on .* until the required tables are present and backfilled|backfilled/i.test(params.reason);
}

function isTigerTransientRuntimeFailure(params: {
  errorCode?: string | null;
  httpStatus?: number | null;
  reason?: string | null;
}): boolean {
  if (isTigerContractRuntimeBlockedFailure(params)) {
    return false;
  }

  if (params.httpStatus === 429) {
    return true;
  }

  if (typeof params.httpStatus === 'number' && params.httpStatus >= 500) {
    return true;
  }

  return isTigerNetworkRuntimeFailure(params.reason);
}

function hasStableCompareResponse(response: CompareEntitiesResponse | null | undefined): boolean {
  return (response?.items?.length ?? 0) >= 2 && response?.sufficientToAnswer === true;
}

interface SearchCatalogShadowRequest {
  appids?: number[];
  facetQuery?: string;
  developerQuery?: string;
  genres?: string[];
  includeAppTypes?: string[];
  includeFacets?: Array<'categories' | 'genres' | 'tags'>;
  isFree?: boolean;
  limit?: number;
  minCcu?: number;
  minDiscountPercent?: number;
  minPriceCents?: number;
  minReviewScore?: number;
  minReviews?: number;
  maxPriceCents?: number;
  onSale?: boolean;
  platforms?: string[];
  publisherQuery?: string;
  query?: string;
  parentAppids?: number[];
  releaseYear?: {
    gte?: number;
    lte?: number;
  };
  sortBy?: 'ccu_peak' | 'owners' | 'release_date' | 'reviews';
  sortDirection?: 'asc' | 'desc';
  tags?: string[];
}

interface RankEntitiesShadowRequest {
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
  entityKind: 'developer' | 'game' | 'publisher';
  limit?: number;
  metric: 'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews';
  query?: string | null;
  recentReleaseDays?: number | null;
  releaseDays?: number | null;
  sortDirection?: 'asc' | 'desc';
}

interface RankEntitiesRenderRequest extends RankEntitiesShadowRequest {
  fallbackMode?: 'closest_match' | null;
  originalAggregateFilters?: RankEntitiesShadowRequest['aggregateFilters'];
}

interface DiscoverMomentumShadowRequest {
  appids?: number[];
  excludeAppIds?: number[];
  filters?: {
    genres?: string[];
    isFree?: boolean | null;
    maxPriceCents?: number | null;
    maxReviews?: number | null;
    maxSentimentDelta?: number | null;
    minCcu?: number | null;
    minReviewScore?: number | null;
    minReviews?: number | null;
    minReviewsAdded30d?: number | null;
    minReviewsAdded7d?: number | null;
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

type MomentumPromptFamily = SessionMomentumPromptFamily;

interface SemanticSearchShadowRequest {
  continuationToken?: string | null;
  description?: string | null;
  entityKind: 'developer' | 'game' | 'publisher';
  filters?: {
    is_free?: boolean;
    max_reviews?: number;
    min_reviews?: number;
    review_comparison?: 'any' | 'better_only' | 'similar_or_better';
    max_price_cents?: number;
    platforms?: Array<'windows' | 'macos' | 'linux'>;
    steam_deck?: Array<'verified' | 'playable'>;
    tags?: string[];
    top_tags?: string[];
  };
  limit?: number;
  mode: 'concept' | 'similarity';
  referencePlatformEntityId?: string | null;
  referenceQuery?: string | null;
}

interface CompareEntitiesShadowRequest {
  entityUids: string[];
  metrics?: CompareMetricName[];
}

interface GetRelatedEntitiesRequest {
  excludeSource?: boolean;
  filters?: {
    minReviewScore?: number | null;
    reviewComparison?: 'any' | 'better_only';
    steamDeck?: Array<'playable' | 'verified'>;
  } | null;
  limit?: number;
  relationKind: 'dlc' | 'franchise_games';
  sourceAppid?: number | null;
  sourceEntityUid?: string | null;
}

interface TraceMetricHistoryShadowRequest {
  endDate: string;
  entityUid: string;
  metrics: Array<
    | 'average_playtime_2weeks'
    | 'average_playtime_forever'
    | 'ccu_peak'
    | 'discount_percent'
    | 'owners_midpoint'
    | 'positive_percentage'
    | 'price_cents'
    | 'review_score'
    | 'total_reviews'
  >;
  startDate: string;
}

interface QueryMonthlyPlaytimeRequest {
  entityKind: 'game' | 'publisher';
  endMonth?: string | null;
  limit?: number;
  startMonth?: string | null;
}

interface QueryMonthlyPlaytimeResponse {
  endMonth: string;
  entityKind: 'game' | 'publisher';
  items: Array<{
    entityId: number;
    entityKind: 'game' | 'publisher';
    estimatedMonthlyHours: number | string | null;
    gameCount?: number | null;
    month: string;
    monthNum: number;
    monthlyCcuSum?: number | string | null;
    name: string;
    rank: number;
    year: number;
  }>;
  startMonth: string;
  sufficientToAnswer: boolean;
}

interface CatalogShadowBuildResult {
  request: SearchCatalogShadowRequest | null;
  reason?: string;
}

interface MomentumBuildResult {
  explicitReviewTrendFloors?: {
    minCcu: boolean;
    minReviews: boolean;
  } | null;
  momentumPromptFamily?: MomentumPromptFamily | null;
  reason?: string;
  request: DiscoverMomentumShadowRequest | null;
}

interface CatalogPrimaryBuildResult {
  reason?: string;
  requests: SearchCatalogShadowRequest[];
}

interface TigerPrimaryEvaluationResult {
  answerBrief?: TigerAnswerBrief | null;
  contractResult?: {
    contractName:
      | 'compareEntities'
      | 'discoverMomentum'
      | 'getEntityOverview'
      | 'getRelatedEntities'
      | 'getYoutubeGameCoverage'
      | 'queryMonthlyPlaytime'
      | 'rankEntities'
      | 'searchCatalog'
      | 'traceMetricHistory'
      | 'semanticSearch';
    request: Record<string, unknown>;
    response: unknown;
  } | null;
  followUpSuggestions?: QuerySuggestion[] | null;
  info: TigerPrimaryInfo;
  renderedText: string | null;
  sessionState?: {
    lastAnswer: SessionChatLastAnswer | null;
    requestState?: SessionChatRequestState | null;
    selectionState: SessionChatSelectionState | null;
  } | null;
}

interface CompareResolutionGroup {
  entityKind: 'developer' | 'game' | 'publisher';
  platform: string;
}

interface CompareRequestBuildResult {
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  request: CompareEntitiesShadowRequest | null;
  selectionState?: SessionChatSelectionState | null;
}

interface YoutubeGameCoveragePrimaryOutcome {
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  followUpSuggestions?: QuerySuggestion[] | null;
  renderedText: string | null;
  request: GetYoutubeGameCoverageRequest | null;
  response: GetYoutubeGameCoverageResponse | null;
  selectionState: SessionChatSelectionState | null;
}

interface CompareSlotResolutionResult {
  attempts: TigerShadowAttempt[];
  slots: RankedSelectionSlot[];
}

interface ExplicitCompareAnalysisResult {
  entityKind: 'developer' | 'game' | 'publisher' | null;
  entityUids: string[];
  failureReason: string | null;
  selectedCandidates: RankedSelectionCandidate[];
  selectionState: SessionChatSelectionState | null;
  stable: boolean;
}

interface RankedSelectionCandidate
  extends Omit<
    SessionChatSelectionCandidate,
    'matchSource' | 'releaseYear' | 'resolutionTier' | 'totalReviews'
  > {
  confidence: number;
  displayNameNormalized: string;
  gameCount: number;
  matchSource: NonNullable<SessionChatSelectionCandidate['matchSource']> | null;
  organizationCore: string | null;
  releaseYear: number | null;
  resolutionTier: NonNullable<SessionChatSelectionCandidate['resolutionTier']> | null;
  totalReviews: number | null;
}

interface RankedSelectionSlot extends SessionChatSelectionSlot {
  candidates: RankedSelectionCandidate[];
}

interface PrimaryEntityResolutionResult {
  attempt: TigerShadowAttempt;
  entity: ResolvedCompareEntity | null;
  selectionState: SessionChatSelectionState | null;
}

type EntityResolutionPreference = 'company' | 'game' | null;

interface RequestPivotPreviewMatch {
  item: SessionChatRequestPreviewItem;
  ordinal: number;
}

interface RequestPivotResolution {
  compareRequestOverride?: CompareEntitiesShadowRequest | null;
  entityQuery?: string;
  matchedIntent: TigerPrimaryMatchedIntent;
  momentumPromptFamily?: MomentumPromptFamily | null;
  requestOverride?: DiscoverMomentumShadowRequest | RankEntitiesShadowRequest | null;
}

const REQUEST_PIVOT_ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  one: 1,
  second: 2,
  two: 2,
  third: 3,
  three: 3,
  fourth: 4,
  four: 4,
  fifth: 5,
  five: 5,
  sixth: 6,
  six: 6,
  seventh: 7,
  seven: 7,
  eighth: 8,
  eight: 8,
  ninth: 9,
  nine: 9,
  tenth: 10,
  ten: 10,
};

function normalizeForLooseMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function deepCloneRecord<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeFollowUpPrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[?.,!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFollowUpLeadIn(prompt: string): string {
  let next = normalizeFollowUpPrompt(prompt);
  const prefixes = [
    'can you ',
    'could you ',
    'would you ',
    'please ',
    'ok ',
    'okay ',
    'so ',
    'then ',
    'what about ',
    'how about ',
    'what abt ',
    'same but ',
    'same thing but ',
    'same thing ',
    'same set but ',
    'same results but ',
    'instead ',
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (next.startsWith(prefix)) {
        next = next.slice(prefix.length).trim();
        changed = true;
      }
    }
  }

  return next.replace(/\s+instead$/, '').replace(/\s+please$/, '').trim();
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length] ?? right.length;
}

function areSimilarPromptTokens(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  const normalizedLeft = left.replace(/s$/, '');
  const normalizedRight = right.replace(/s$/, '');
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (Math.abs(normalizedLeft.length - normalizedRight.length) > 1) {
    return false;
  }

  const maxDistance = Math.max(normalizedLeft.length, normalizedRight.length) >= 6 ? 2 : 1;
  return levenshteinDistance(normalizedLeft, normalizedRight) <= maxDistance;
}

function tokenizeFollowUpPrompt(prompt: string): string[] {
  return stripFollowUpLeadIn(prompt)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function includesApproxPhrase(tokens: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || tokens.length < phrase.length) {
    return false;
  }

  for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (!areSimilarPromptTokens(tokens[index + offset] ?? '', phrase[offset] ?? '')) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function normalizeOrganizationCore(value: string): string {
  return normalizeForLooseMatch(value)
    .replace(/\b(games|studios?|entertainment|interactive|digital|inc|ltd|llc|works|productions?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectionReferenceMatchesQuery(reference: string | null | undefined, query: string | null | undefined): boolean {
  if (!reference || !query) {
    return false;
  }

  const normalizedReference = normalizeForLooseMatch(reference);
  const normalizedQuery = normalizeForLooseMatch(query);
  if (!normalizedReference || !normalizedQuery) {
    return false;
  }

  if (normalizedReference === normalizedQuery) {
    return true;
  }

  const referenceCore = normalizeOrganizationCore(reference);
  const queryCore = normalizeOrganizationCore(query);
  return Boolean(referenceCore) && referenceCore === queryCore;
}

function promptReferencesEntityName(
  prompt: string | null | undefined,
  entityName: string | null | undefined
): boolean {
  if (!prompt || !entityName) {
    return false;
  }

  const promptTokens = tokenizeFollowUpPrompt(prompt);
  const entityTokens = normalizeForLooseMatch(entityName)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

  return includesApproxPhrase(promptTokens, entityTokens);
}

function matchQualityBaseScore(matchQuality: SessionSelectionMatchQuality | null | undefined): number {
  switch (matchQuality) {
    case 'exact':
      return 100;
    case 'prefix':
      return 92;
    case 'substring':
      return 84;
    case 'fuzzy':
      return 70;
    default:
      return 78;
  }
}

function queryLooksOrganization(value: string): boolean {
  return ORGANIZATION_SUFFIX_PATTERN.test(value);
}

function entityLooksOrganization(value: string): boolean {
  return ORGANIZATION_SUFFIX_PATTERN.test(value);
}

function candidatesShareOrganizationCore(
  left: Pick<RankedSelectionCandidate, 'organizationCore'> | null | undefined,
  right: Pick<RankedSelectionCandidate, 'organizationCore'> | null | undefined
): boolean {
  return Boolean(left?.organizationCore) && left?.organizationCore === right?.organizationCore;
}

function normalizeSelectionKind(value: string): SessionSelectionEntityKind | null {
  return value === 'game' || value === 'publisher' || value === 'developer'
    ? value
    : null;
}

function normalizeEntityResolutionQuery(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/softwere/gi, 'Software');
}

function scoreResolvedEntity(params: {
  entity: ResolvedCompareEntity;
  expectedEntityKind: SessionSelectionEntityKind | null;
  query: string;
  resolutionPreference: EntityResolutionPreference;
}): number {
  const { entity, expectedEntityKind, query, resolutionPreference } = params;
  const entityKind = normalizeSelectionKind(entity.entityKind);
  if (!entityKind) {
    return 0;
  }

  const normalizedQuery = normalizeForLooseMatch(query);
  const normalizedDisplayName = normalizeForLooseMatch(entity.displayName);
  const normalizedMatchedName = normalizeForLooseMatch(entity.matchedName ?? entity.displayName);
  const confidence = typeof entity.confidence === 'number' ? entity.confidence : 0;
  const matchQuality = entity.matchQuality ?? null;
  const queryIsOrganizationLike = queryLooksOrganization(query);
  const displayNameIsOrganizationLike = entityLooksOrganization(entity.displayName);
  const gameCount =
    typeof entity.signals?.gameCount === 'number' && Number.isFinite(entity.signals.gameCount)
      ? entity.signals.gameCount
      : 0;

  let score = matchQualityBaseScore(matchQuality) + (confidence * 8);

  if (normalizedDisplayName === normalizedQuery) {
    score += 24;
  } else if (normalizedMatchedName === normalizedQuery) {
    score += 16;
  }

  if (expectedEntityKind) {
    score += entityKind === expectedEntityKind ? 18 : -18;
  }

  if (resolutionPreference === 'company') {
    score += entityKind === 'game' ? -24 : 22;
  } else if (resolutionPreference === 'game') {
    score += entityKind === 'game' ? 18 : -18;
  }

  if (queryIsOrganizationLike) {
    score += entityKind === 'game' ? -18 : 14;
  }

  if (displayNameIsOrganizationLike && entityKind !== 'game') {
    score += 8;
  }

  if (entityKind !== 'game') {
    score += Math.min(gameCount, 20) * 0.6;
    if (entity.platform === 'publisheriq') {
      score += 4;
    }
  } else if (entity.platform === 'steam') {
    score += 4;
  }

  if (matchQuality === 'fuzzy' && entityKind === 'game') {
    score -= 10;
  }

  if (matchQuality === 'substring' && entityKind === 'game') {
    score -= 6;
  }

  return Math.round(score);
}

function buildRankedSelectionCandidates(params: {
  entities: ResolvedCompareEntity[];
  expectedEntityKind: SessionSelectionEntityKind | null;
  preserveInputOrder?: boolean;
  query: string;
  resolutionPreference: EntityResolutionPreference;
}): RankedSelectionCandidate[] {
  const candidates = params.entities
    .map((entity) => {
      const entityKind = normalizeSelectionKind(entity.entityKind);
      if (!entityKind) {
        return null;
      }

      const gameCount =
        typeof entity.signals?.gameCount === 'number' && Number.isFinite(entity.signals.gameCount)
          ? entity.signals.gameCount
          : 0;

      return {
        confidence: typeof entity.confidence === 'number' ? entity.confidence : 0,
        displayName: entity.displayName,
        displayNameNormalized: normalizeForLooseMatch(entity.displayName),
        entityKind,
        entityUid: entity.entityUid,
        gameCount,
        matchSource: entity.matchSource ?? null,
        matchQuality: entity.matchQuality ?? null,
        ordinal: 0,
        organizationCore: entityKind === 'game' ? null : normalizeOrganizationCore(entity.displayName),
        platform: entity.platform,
        platformEntityId: entity.platformEntityId ?? null,
        releaseYear: entity.releaseYear ?? null,
        resolutionTier: entity.resolutionTier ?? null,
        score: scoreResolvedEntity({
          entity,
          expectedEntityKind: params.expectedEntityKind,
          query: params.query,
          resolutionPreference: params.resolutionPreference,
        }),
        totalReviews: entity.latestMetrics?.totalReviews ?? null,
      };
    })
    .filter((candidate): candidate is RankedSelectionCandidate => Boolean(candidate));

  const companyGroups = new Map<string, RankedSelectionCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.entityKind === 'game') {
      continue;
    }

    const organizationCore = candidate.organizationCore;
    if (!organizationCore) {
      continue;
    }

    const groupKey = `${candidate.platform}:${organizationCore}`;
    const group = companyGroups.get(groupKey) ?? [];
    group.push(candidate);
    companyGroups.set(groupKey, group);
  }

  for (const group of companyGroups.values()) {
    if (group.length < 2) {
      continue;
    }

    const maxGameCount = Math.max(...group.map((candidate) => candidate.gameCount));
    if (maxGameCount < 2) {
      continue;
    }

    for (const candidate of group) {
      if (candidate.gameCount === maxGameCount) {
        candidate.score += 8;
        continue;
      }

      const delta = maxGameCount - candidate.gameCount;
      candidate.score -= Math.min(22, Math.round(delta * 1.75));
    }
  }

  if (params.preserveInputOrder) {
    return candidates.map((candidate, index) => ({
      ...candidate,
      ordinal: index + 1,
    }));
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .map((candidate, index) => ({
      ...candidate,
      ordinal: index + 1,
    }));
}

function needsClarificationForRankedCandidates(params: {
  candidates: RankedSelectionCandidate[];
  query: string;
  resolutionPreference: EntityResolutionPreference;
}): boolean {
  const [top, runnerUp] = params.candidates;
  if (!top || top.score < 70) {
    return true;
  }

  if (!runnerUp) {
    return false;
  }

  const scoreGap = top.score - runnerUp.score;
  const queryIsOrganizationLike = queryLooksOrganization(params.query);
  const normalizedQuery = normalizeForLooseMatch(params.query);
  const sameOrganizationCore = candidatesShareOrganizationCore(top, runnerUp);

  if (
    normalizedQuery
    && top.displayNameNormalized === normalizedQuery
    && top.entityKind === runnerUp.entityKind
  ) {
    if (runnerUp.displayNameNormalized.startsWith(`${normalizedQuery} `) && scoreGap >= 4) {
      return false;
    }

    if (runnerUp.matchQuality !== 'exact' && scoreGap >= 8) {
      return false;
    }
  }

  if (
    params.resolutionPreference === 'company'
    && top.entityKind !== 'game'
    && runnerUp.entityKind !== 'game'
  ) {
    if (sameOrganizationCore && top.gameCount >= Math.max(4, runnerUp.gameCount + 3)) {
      return false;
    }

    if (scoreGap >= 6) {
      return false;
    }
  }

  if (scoreGap < 12) {
    return true;
  }

  if (top.entityKind !== runnerUp.entityKind && scoreGap < 18) {
    return true;
  }

  if (top.matchQuality === 'fuzzy' && scoreGap < 18) {
    return true;
  }

  if (queryIsOrganizationLike && top.entityKind === 'game' && runnerUp.entityKind !== 'game' && scoreGap < 24) {
    return true;
  }

  return false;
}

function shouldOverrideResolverAmbiguity(params: {
  candidates: RankedSelectionCandidate[];
  query: string;
  resolutionPreference: EntityResolutionPreference;
}): boolean {
  const [top, runnerUp] = params.candidates;
  if (!top || top.score < 82) {
    return false;
  }

  const normalizedQuery = normalizeForLooseMatch(params.query);
  const scoreGap = top.score - (runnerUp?.score ?? 0);
  const sameOrganizationCore = candidatesShareOrganizationCore(top, runnerUp);

  if (
    params.resolutionPreference === 'game'
    && top.entityKind === 'game'
    && top.matchQuality === 'exact'
    && top.displayNameNormalized === normalizedQuery
  ) {
    if (!runnerUp) {
      return true;
    }

    if (runnerUp.entityKind === 'game' && runnerUp.displayNameNormalized.startsWith(`${normalizedQuery} `)) {
      return scoreGap >= 6;
    }

    return scoreGap >= 10;
  }

  if (params.resolutionPreference === 'company' && top.entityKind !== 'game') {
    const queryOrganizationCore = normalizeOrganizationCore(params.query);
    if (!queryOrganizationCore || top.organizationCore !== queryOrganizationCore) {
      return false;
    }

    if (!runnerUp) {
      return true;
    }

    if (runnerUp.entityKind === 'game') {
      return scoreGap >= 8;
    }

    if (sameOrganizationCore && top.gameCount >= Math.max(4, runnerUp.gameCount + 3)) {
      return true;
    }

    return scoreGap >= 12;
  }

  return false;
}

type TigerPrimaryMatchedIntent = Exclude<TigerShadowMatchedIntent, null>;

function isTigerPrimaryRenderableIntent(
  intent: TigerPrimaryMatchedIntent
): intent is TigerPrimaryMatchedIntent {
  return Boolean(intent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinTigerHumanList(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  if (values.length === 1) {
    return values[0] ?? '';
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function formatIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function inferPromptWindowLabel(prompt: string | null | undefined): string | null {
  const text = prompt ?? '';
  const now = new Date();
  const end = formatIsoDateOnly(now);
  const startDate = new Date(now);

  if (/\bthis week\b|\bpast week\b|\blast 7 days?\b/i.test(text)) {
    startDate.setUTCDate(startDate.getUTCDate() - 7);
    return `${formatIsoDateOnly(startDate)} to ${end}`;
  }

  if (/\btoday\b/i.test(text)) {
    return end;
  }

  if (/\bthis month\b|\blast 30 days?\b|\bpast 30 days?\b/i.test(text)) {
    startDate.setUTCDate(startDate.getUTCDate() - 30);
    return `${formatIsoDateOnly(startDate)} to ${end}`;
  }

  return null;
}

function extractSimilaritySeedFromPrompt(prompt: string): string | null {
  const match =
    prompt.match(/\b(?:games?|titles?)\s+like\s+(.+?)(?:\s+(?:that|with|under|over|from|are|breaking|trending)\b|[?!.]|$)/i)
    ?? prompt.match(/\bsimilar\s+to\s+(.+?)(?:\s+(?:that|with|under|over|from|are|breaking|trending)\b|[?!.]|$)/i);
  return normalizeEntityQuery(match?.[1] ?? null);
}

function buildTigerPrimaryNoResultText(params: {
  attempts: TigerShadowAttempt[];
  entityQuery?: string | null;
  matchedIntent: TigerPrimaryMatchedIntent;
  prompt?: string;
  request?: unknown;
}): string | null {
  const firstReason = params.attempts.find((attempt) => attempt.reason?.trim())?.reason?.trim() ?? null;
  const request = isRecord(params.request) ? params.request : null;
  const isStructuredRuntimeFailure = firstReason != null
    && isTigerNetworkRuntimeFailure(firstReason);
  const isStructuredTimeout = firstReason != null
    && /query_timeout|statement timeout|timed out|timeout/i.test(firstReason);
  const hasTransientRuntimeFailure = params.attempts.some(
    (attempt) => attempt.status === 'error' && isTigerTransientRuntimeFailure(attempt)
  );
  const hasContractRuntimeBlockedFailure = params.attempts.some(
    (attempt) => attempt.status === 'error' && isTigerContractRuntimeBlockedFailure(attempt)
  );

  if (params.matchedIntent === 'entity_overview') {
    if (isStructuredTimeout) {
      return 'The structured entity resolver timed out before it could lock the right title. Try again in a moment or pick the title from the match list.';
    }

    return isStructuredRuntimeFailure
      ? 'I could not load structured matching for that title right now. Try again in a moment or pick the title from the match list.'
      : 'I could not resolve a single game, publisher, or developer for that request. Try the exact name.';
  }

  if (params.matchedIntent === 'relation_lookup') {
    const relationKind = request?.relationKind === 'dlc' ? 'dlc' : request?.relationKind === 'franchise_games' ? 'franchise_games' : null;
    const filters = isRecord(request?.filters) ? request.filters : null;
    const appliedFilters = [
      Array.isArray(filters?.steamDeck) && filters.steamDeck.length > 0
        ? `Steam Deck ${joinTigerHumanList(filters.steamDeck.map((value) => String(value)))}`
        : null,
      typeof filters?.minReviewScore === 'number' ? `review score >= ${filters.minReviewScore}%` : null,
      filters?.reviewComparison === 'better_only' ? 'better review score than the source title' : null,
    ].filter((value): value is string => Boolean(value));
    const scopeSuffix = appliedFilters.length > 0 ? ` that kept ${joinTigerHumanList(appliedFilters)}` : '';

    if (relationKind === 'dlc') {
      return firstReason?.includes('backfilled')
        ? 'I could not verify the DLC link table for this title yet, so there is no structured DLC set I can trust from the current data slice.'
        : `I could not find any DLC rows in the current structured snapshot${scopeSuffix}.`;
    }

    if (relationKind === 'franchise_games') {
      return firstReason?.includes('backfilled')
        ? 'I could not verify exact franchise links for this title yet, so there is no exact same-series set I can trust from the current data slice.'
        : `I could not find any same-franchise matches in the current structured snapshot${scopeSuffix}.`;
    }
  }

  if (params.matchedIntent === 'entity_ranking') {
    const aggregateFilters = isRecord(request?.aggregateFilters) ? request.aggregateFilters : null;
    const scope: string[] = [
      typeof aggregateFilters?.minGameCount === 'number' ? `at least ${aggregateFilters.minGameCount} games` : null,
      typeof aggregateFilters?.minAverageReviewScore === 'number' ? `average review >= ${aggregateFilters.minAverageReviewScore}%` : null,
      typeof aggregateFilters?.minMinimumReviewScore === 'number' ? `every title >= ${aggregateFilters.minMinimumReviewScore}% reviews` : null,
    ].filter((value): value is string => Boolean(value));
    const releaseDays = normalizeNumber(request?.releaseDays);
    const recentReleaseDays = normalizeNumber(request?.recentReleaseDays);
    if (recentReleaseDays != null) {
      scope.push(`with a release in the past ${recentReleaseDays} days`);
    } else if (releaseDays != null) {
      scope.push(`released in the past ${releaseDays} days`);
    }

    return scope.length > 0
      ? `I could not find any rows that met the current ranking thresholds for ${joinTigerHumanList(scope)}.`
      : 'I could not find any rows that produced a stable ranking for this request in the current structured snapshot.';
  }

  if (params.matchedIntent === 'entity_compare') {
    if (hasContractRuntimeBlockedFailure) {
      return 'I could not complete that comparison from the current structured data yet because the compare surface is not fully ready in this environment.';
    }

    if (hasTransientRuntimeFailure) {
      return 'I could not complete that comparison from PublisherIQ data right now. Please try again in a moment.';
    }

    return 'I could not find a stable comparison set for that request.';
  }

  if (params.matchedIntent === 'momentum_discovery') {
    const entityLabel = extractSimilaritySeedFromPrompt(params.prompt ?? '');
    const windowLabel = inferPromptWindowLabel(params.prompt) ?? 'the current structured snapshot';
    const seedPrefix = entityLabel ? ` for ${entityLabel}` : '';
    return `I could not find enough qualifying titles${seedPrefix} to produce a stable momentum screen for this exact scope in ${windowLabel}.`;
  }

  if (params.matchedIntent === 'semantic_search') {
    return 'I could not find strong matches that satisfied the current similarity or concept constraints in the available data.';
  }

  if (params.matchedIntent === 'news_search') {
    const entityLabel =
      params.entityQuery?.trim()
      || extractEntityQueryFromPrompt(params.prompt ?? '')
      || 'that title';
    const windowLabel = hasExplicitPromptTimeWindow(params.prompt ?? '')
      ? 'the requested time window'
      : 'the recent document window';
    return `I could not find relevant ${entityLabel} documents in ${windowLabel}.`;
  }

  if (params.matchedIntent === 'change_explanation') {
    const entityLabel =
      params.entityQuery?.trim()
      || extractEntityQueryFromPrompt(params.prompt ?? '')
      || 'that title';
    const windowLabel =
      inferPromptWindowLabel(params.prompt)
      ?? (
        hasExplicitPromptTimeWindow(params.prompt ?? '')
          ? 'the requested time window'
          : 'the recent change window'
      );
    return `I checked Steam change evidence for ${entityLabel} in ${windowLabel} and found 0 qualifying change events or linked news items, so there is no grounded change summary for that window. Broaden the window or ask for patch notes if you want nearby update evidence.`;
  }

  if (params.matchedIntent === 'catalog_search') {
    return 'I could not find catalog rows that satisfied the current filters in the available data.';
  }

  if (isStructuredRuntimeFailure) {
    return 'I could not finish that structured lookup right now. Please try again in a moment.';
  }

  return firstReason ?? null;
}

function readShadowMode(): TigerShadowMode {
  const raw = process.env.CHAT_TIGER_SHADOW_MODE?.trim().toLowerCase();
  if (raw === 'eval' || raw === 'canary' || raw === 'all') {
    return raw;
  }

  return 'off';
}

function readShadowTimeoutMs(): number {
  const parsed = Number(process.env.CHAT_TIGER_SHADOW_TIMEOUT_MS ?? DEFAULT_SHADOW_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHADOW_TIMEOUT_MS;
}

function readPrimaryMode(): TigerPrimaryMode {
  const raw = process.env.CHAT_TIGER_PRIMARY_MODE?.trim().toLowerCase();
  if (raw === 'eval' || raw === 'canary' || raw === 'all') {
    return raw;
  }

  return 'off';
}

function readPrimaryTimeoutMs(): number {
  const parsed = Number(process.env.CHAT_TIGER_PRIMARY_TIMEOUT_MS ?? DEFAULT_PRIMARY_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PRIMARY_TIMEOUT_MS;
}

function readYoutubePrimaryEnabled(): boolean {
  return process.env.CHAT_TIGER_YOUTUBE_ENABLED === 'true';
}

function readPrimaryEntityResolutionTimeoutMs(): number {
  return Math.max(readPrimaryTimeoutMs(), MIN_PRIMARY_ENTITY_RESOLUTION_TIMEOUT_MS);
}

function readCompareResolutionTimeoutMs(): number {
  const parsed = Number(
    process.env.CHAT_TIGER_COMPARE_RESOLUTION_TIMEOUT_MS ?? DEFAULT_COMPARE_RESOLUTION_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(parsed, MIN_PRIMARY_ENTITY_RESOLUTION_TIMEOUT_MS)
    : DEFAULT_COMPARE_RESOLUTION_TIMEOUT_MS;
}

function readCanaryUserIds(): Set<string> {
  return new Set(
    (process.env.CHAT_TIGER_CANARY_USER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function classifyTigerRolloutCohort(userId: string | null | undefined): TigerRolloutCohort {
  if (!userId) {
    return 'default';
  }

  return readCanaryUserIds().has(userId) ? 'canary' : 'default';
}

function shouldRunShadow(
  mode: TigerShadowMode,
  isEvalRequest: boolean,
  cohort: TigerRolloutCohort
): boolean {
  return mode === 'all'
    || (mode === 'eval' && isEvalRequest)
    || (mode === 'canary' && cohort === 'canary');
}

function shouldRunPrimary(
  mode: TigerPrimaryMode,
  isEvalRequest: boolean,
  cohort: TigerRolloutCohort
): boolean {
  return mode === 'all'
    || (mode === 'eval' && isEvalRequest)
    || (mode === 'canary' && cohort === 'canary');
}

function hasAnyToolCall(toolCalls: ChatToolCall[], names: Set<string>): boolean {
  return toolCalls.some((toolCall) => names.has(toolCall.name));
}

function inferMatchedIntent(prompt: string, toolCalls: ChatToolCall[]): TigerShadowMatchedIntent {
  if (inferUserContextIntent(prompt)) {
    return 'user_context';
  }

  if (inferRelationIntent(prompt)) {
    return 'relation_lookup';
  }

  if (inferCompareIntent(prompt)) {
    return 'entity_compare';
  }

  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
  }

  if (hasAnyToolCall(toolCalls, MOMENTUM_TOOL_NAMES) || inferMomentumIntent(prompt)) {
    return 'momentum_discovery';
  }

  if (
    hasAnyToolCall(toolCalls, CHANGE_DISCOVERY_TOOL_NAMES)
    || CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
  ) {
    return 'change_discovery';
  }

  if (hasAnyToolCall(toolCalls, CHANGE_EXPLANATION_TOOL_NAMES) || CHANGE_PROMPT_PATTERN.test(prompt)) {
    return 'change_explanation';
  }

  if (hasAnyToolCall(toolCalls, NEWS_TOOL_NAMES) || NEWS_PROMPT_PATTERN.test(prompt)) {
    return 'news_search';
  }

  if (inferEntityOverviewIntent(prompt)) {
    return 'entity_overview';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  if (inferSemanticIntent(prompt, toolCalls)) {
    return 'semantic_search';
  }

  if (inferCatalogSearchIntent(prompt, toolCalls)) {
    return 'catalog_search';
  }

  return null;
}

function inferPrimaryMatchedIntent(prompt: string): TigerPrimaryMatchedIntent | null {
  if (MONTHLY_PLAYTIME_PROMPT_PATTERN.test(prompt)) {
    return 'monthly_playtime';
  }

  if (inferYoutubeGameActivityIntent(prompt)) {
    return 'youtube_game_activity';
  }

  if (inferUserContextIntent(prompt)) {
    return 'user_context';
  }

  if (inferRelationIntent(prompt)) {
    return 'relation_lookup';
  }

  if (inferCompareIntent(prompt)) {
    return 'entity_compare';
  }

  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
  }

  if (inferEntityOverviewIntent(prompt)) {
    return 'entity_overview';
  }

  if (inferMomentumIntent(prompt)) {
    return 'momentum_discovery';
  }

  if (CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)) {
    return 'change_discovery';
  }

  if (CHANGE_PROMPT_PATTERN.test(prompt)) {
    return 'change_explanation';
  }

  if (NEWS_PROMPT_PATTERN.test(prompt)) {
    return 'news_search';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  if (inferPrimarySemanticIntent(prompt)) {
    return 'semantic_search';
  }

  if (inferPrimaryCatalogSearchIntent(prompt)) {
    return 'catalog_search';
  }

  return null;
}

function inferYoutubeGameActivityIntent(prompt: string): boolean {
  if (!readYoutubePrimaryEnabled()) {
    return false;
  }

  if (
    inferCompareIntent(prompt)
    || inferMetricHistoryIntent(prompt)
    || CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
    || CHANGE_PROMPT_PATTERN.test(prompt)
    || NEWS_PROMPT_PATTERN.test(prompt)
    || inferCatalogFacetIntent(prompt)
  ) {
    return false;
  }

  if (YOUTUBE_EXPLICIT_PROMPT_PATTERN.test(prompt)) {
    return YOUTUBE_ACTIVITY_DETAIL_PROMPT_PATTERN.test(prompt);
  }

  return Boolean(extractYoutubeEntityQuery(prompt))
    && YOUTUBE_IMPLICIT_ACTIVITY_PROMPT_PATTERN.test(prompt)
    && YOUTUBE_ACTIVITY_DETAIL_PROMPT_PATTERN.test(prompt);
}

function inferYoutubeCoverageView(prompt: string): YoutubeCoverageView {
  if (
    (
      /\b(?:creators?|channels?)\b/i.test(prompt)
      || /\bwho(?:'s|\s+is)\s+covering\b/i.test(prompt)
    )
    && !/\b(?:how many|distinct)\b/i.test(prompt)
    && !/\b(?:biggest|most-viewed|most views|growing|growth)\b/i.test(prompt)
  ) {
    return 'creator_coverage';
  }

  if (
    /\b(?:content mix|short-form|long-form|formats?|mostly shorts|mostly standard|skew short-form|skew long-form|live presence)\b/i.test(prompt)
  ) {
    return 'content_mix';
  }

  if (
    /\b(?:how many|distinct upload channels?|broad creator pickup|burst of new videos|fresh(?:est|ness)?|recent youtube activity|new matched videos?|new uploads?|how fresh|freshest upload|upload channels?)\b/i.test(prompt)
  ) {
    return 'cadence';
  }

  if (
    /\b(?:growing|growth|fastest-growing|taking off|jump between snapshots|breaking out)\b/i.test(prompt)
  ) {
    return 'video_growth';
  }

  if (/\b(?:biggest|most-viewed|most views|top \d+)\b/i.test(prompt)) {
    return 'top_videos';
  }

  return 'latest_videos';
}

function inferYoutubeCoverageWindow(prompt: string): YoutubeCoverageWindow | null {
  if (/\b(?:today|last 24 hours?|past 24 hours?|(?:last|past)\s+1\s+day)\b/i.test(prompt)) {
    return '1d';
  }

  if (/\b(?:last|past)\s+48\s+hours?\b|\b(?:last|past)\s+2\s+days?\b/i.test(prompt)) {
    return '2d';
  }

  if (/\b(?:last|past)\s+72\s+hours?\b|\b(?:last|past)\s+3\s+days?\b/i.test(prompt)) {
    return '3d';
  }

  const weekMatch = prompt.match(/\b(?:last|past)\s+(\d+)\s+weeks?\b/i);
  if (weekMatch) {
    const weeks = Number(weekMatch[1]);
    if (weeks === 1) {
      return '7d';
    }
    if (weeks === 2) {
      return '14d';
    }
  }

  const dayMatch = prompt.match(/\b(?:last|past|over the last|in the last|during the last)\s+(\d+)\s+days?\b/i);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    if (days === 1) {
      return '1d';
    }
    if (days === 2) {
      return '2d';
    }
    if (days === 3) {
      return '3d';
    }
    if (days === 7) {
      return '7d';
    }
    if (days === 14) {
      return '14d';
    }
    if (days === 30) {
      return '30d';
    }
  }

  if (/\b(?:last|past)\s+7\s+days?\b|\bthis week\b/i.test(prompt)) {
    return '7d';
  }

  if (/\b(?:last|past)\s+14\s+days?\b|\b(?:this|past|last)\s+2\s+weeks?\b/i.test(prompt)) {
    return '14d';
  }

  if (/\b(?:last|past)\s+30\s+days?\b|\bthis month\b/i.test(prompt)) {
    return '30d';
  }

  return null;
}

function inferYoutubeContentClass(prompt: string): YoutubeContentClass | null {
  if (/\b(?:all formats?|all videos?)\b/i.test(prompt)) {
    return null;
  }

  if (/\b(?:live(?:\s+or\s+recent\s+live)?|livestreams?)\b/i.test(prompt)) {
    return 'live_or_recent_live';
  }

  if (/\bshorts?\b/i.test(prompt)) {
    return 'short';
  }

  if (/\b(?:standard videos?|long-form)\b/i.test(prompt)) {
    return 'standard_video';
  }

  return null;
}

function inferUserContextIntent(prompt: string): boolean {
  return USER_ALERT_PROMPT_PATTERN.test(prompt) || USER_PORTFOLIO_PROMPT_PATTERN.test(prompt);
}

function inferUserContextFocus(prompt: string): 'alerts' | 'pins' | 'overview' {
  if (USER_ALERT_PROMPT_PATTERN.test(prompt)) {
    return 'alerts';
  }

  if (USER_PORTFOLIO_PROMPT_PATTERN.test(prompt)) {
    return 'pins';
  }

  return 'overview';
}

function inferCompareFollowUpIntent(
  prompt: string,
  sessionContext: SessionChatContext | null
): boolean {
  const candidateSet = sessionContext?.candidateSet;
  if (!candidateSet || candidateSet.ids.length < 2) {
    return false;
  }

  if (
    candidateSet.kind !== 'games'
    && candidateSet.kind !== 'publishers'
    && candidateSet.kind !== 'developers'
  ) {
    return false;
  }

  return COMPARE_FOLLOW_UP_PROMPT_PATTERN.test(prompt)
    || COMPARE_TOP_COUNT_FOLLOW_UP_PROMPT_PATTERN.test(prompt);
}

function inferCompareIntent(prompt: string): boolean {
  if (
    inferRelationIntent(prompt)
    || inferCompareTopMomentumIntent(prompt)
  ) {
    return false;
  }

  return COMPARE_PROMPT_PATTERN.test(prompt)
    && !METRIC_HISTORY_PROMPT_PATTERN.test(prompt)
    && !CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
    && !CHANGE_PROMPT_PATTERN.test(prompt)
    && !NEWS_PROMPT_PATTERN.test(prompt);
}

function inferEntityOverviewIntent(prompt: string): boolean {
  if (ENTITY_OVERVIEW_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  return COMPANY_COUNT_PROMPT_PATTERN.test(prompt)
    || COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN.test(prompt)
    || hasGameMetricOverviewPrompt(prompt);
}

function isSingleEntityMetricOverviewPrompt(prompt: string): boolean {
  return COMPANY_COUNT_PROMPT_PATTERN.test(prompt)
    || COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN.test(prompt)
    || hasGameMetricOverviewPrompt(prompt);
}

function inferRelationIntent(prompt: string): boolean {
  return RELATION_PROMPT_PATTERN.test(prompt)
    || /\b(?:all\s+)?dlc\b.*\b(?:for|of)\b/i.test(prompt)
    || /\bfind\b.*\b(?:games?|titles?)\b.*\b(?:same franchise|same series)\b/i.test(prompt)
    || SAME_FRANCHISE_PATTERN.test(prompt);
}

function inferSemanticIntent(prompt: string, toolCalls: ChatToolCall[]): boolean {
  if (toolCalls.some((toolCall) => toolCall.name === 'find_similar' || toolCall.name === 'search_by_concept')) {
    return true;
  }

  return inferPrimarySemanticIntent(prompt);
}

function inferPrimarySemanticIntent(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const inferredTags = extractMomentumTags(prompt);

  if (inferRelationIntent(prompt) || looksLikeCompanyRankingScreen(prompt)) {
    return false;
  }

  if (
    !inferredTags?.length
    && (
      /\bon sale\b/i.test(prompt)
      || /\bpremium games?\b/i.test(prompt)
      || (
        /\b(?:under|over|above)\s+\$?\d+/i.test(prompt)
        && /\b(?:great reviews?|highly rated|overwhelmingly positive)\b/i.test(prompt)
      )
    )
  ) {
    return false;
  }

  if (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  if (
    /\bindie\b/i.test(prompt)
    && /\b(?:top|best|popular|currently|right now)\b/i.test(prompt)
    && /\bgames?\b/i.test(prompt)
  ) {
    return false;
  }

  if (
    normalized.includes('games by') ||
    normalized.includes('games from') ||
    normalized.includes('top games') ||
    normalized.includes('best games') ||
    normalized.includes('show me linux games')
  ) {
    return false;
  }

  if (CONCEPT_DISCOVERY_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  return /\bunder\s+\$?\d+/i.test(prompt)
    || /\bsteam deck\b/i.test(prompt)
    || /\bfree(?:\s+to\s+play)?\b/i.test(prompt)
    || /\bcozy\b/i.test(prompt)
    || /\bfarming\b/i.test(prompt)
    || looksLikeConceptPrompt(prompt);
}

function inferCatalogSearchIntent(prompt: string, toolCalls: ChatToolCall[]): boolean {
  if (inferCatalogFacetIntent(prompt)) {
    return true;
  }

  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining)\b/i.test(prompt)) {
    return false;
  }

  if (toolCalls.some((toolCall) => toolCall.name === 'search_games' || toolCall.name === 'screen_games')) {
    return true;
  }

  return COMPANY_GAME_LIST_PROMPT_PATTERN.test(prompt)
    && toolCalls.some((toolCall) =>
      (toolCall.name === 'lookup_developers' || toolCall.name === 'lookup_publishers')
      && extractCanonicalCompanyName(toolCall) !== null
    );
}

function inferPrimaryCatalogSearchIntent(prompt: string): boolean {
  if (inferCatalogFacetIntent(prompt)) {
    return true;
  }

  const normalized = prompt.toLowerCase();

  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop)\b/.test(normalized)) {
    return false;
  }

  if (looksLikeCompanyRankingScreen(prompt)) {
    return false;
  }

  if (extractCompanyQueryFromPrompt(prompt)) {
    return true;
  }

  const hasPlatform = /\b(?:windows|macos|mac|linux)\b/i.test(prompt);
  const hasIndie = /\bindie\b/i.test(prompt);
  const hasReviewConstraint =
    /\boverwhelmingly positive\b/i.test(prompt)
    || /\bhighly rated\b/i.test(prompt)
    || /\bgreat reviews?\b/i.test(prompt);
  const hasReleaseYear = /\bthis year\b/i.test(prompt) || /\b20\d{2}\b/.test(prompt);
  const hasRollingReleaseWindow = /\b(?:past|last)\s+year\b/i.test(prompt);
  const hasPriceConstraint = /\b(?:under|over|above)\s+\$?\d+/i.test(prompt);
  const hasSaleConstraint = /\bon sale\b/i.test(prompt);
  const hasPremiumConstraint = /\bpremium games?\b/i.test(prompt);

  return hasPlatform
    || hasIndie
    || hasReviewConstraint
    || hasReleaseYear
    || hasRollingReleaseWindow
    || hasPriceConstraint
    || hasSaleConstraint
    || hasPremiumConstraint;
}

function inferCatalogFacetIntent(prompt: string): boolean {
  return FACET_DISCOVERY_PROMPT_PATTERN.test(prompt)
    && /\b(?:tags?|genres?|categories)\b/i.test(prompt);
}

function inferSimilarityMomentumIntent(prompt: string): boolean {
  return SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)
    && (MOMENTUM_PROMPT_PATTERN.test(prompt) || hasMomentumMetricClause(prompt))
    && !SAME_FRANCHISE_PATTERN.test(prompt);
}

function hasMomentumMetricClause(prompt: string): boolean {
  return /\b(?:review velocity|reviews?\s+added|recent reviews?|review pace|momentum score|ccu|concurrent players?|players right now|gaining momentum|breaking out|accelerating|declining)\b/i.test(
    prompt
  );
}

function inferCompareTopMomentumIntent(prompt: string): boolean {
  return COMPARE_TOP_PEERSET_PATTERN.test(prompt)
    && (MOMENTUM_PROMPT_PATTERN.test(prompt) || hasMomentumMetricClause(prompt))
    && !/\b(?:publishers?|developers?|studios?|companies?)\b/i.test(prompt);
}

function looksLikeCompanyRankingScreen(prompt: string): boolean {
  if (!/\b(?:publishers?|developers?|studios?)\b/i.test(prompt)) {
    return false;
  }

  if (COMPANY_GAME_LIST_PROMPT_PATTERN.test(prompt) && !/\b(?:released|releasing|shipped|games this year|most games|average|averaging|above|reviews?)\b/i.test(prompt)) {
    return false;
  }

  return /\b(?:most|top|best|largest|biggest|released|releasing|shipped|games?|titles?|reviews?|review score|ratings?|owners?)\b/i.test(prompt)
    || /\b\d+\+\s+games?\b/i.test(prompt)
    || /\ball above\b/i.test(prompt)
    || /\baveraging\b/i.test(prompt);
}

function looksLikeGameRankingScreen(prompt: string): boolean {
  if (/\b(?:publishers?|developers?|studios?)\b/i.test(prompt)) {
    return false;
  }

  if (inferRelationIntent(prompt) || inferCatalogFacetIntent(prompt) || inferSimilarityMomentumIntent(prompt)) {
    return false;
  }

  return RANKING_BASE_PROMPT_PATTERN.test(prompt)
    && /\b(?:reviews?|review score|ratings?|owners?|players?|ccu)\b/i.test(prompt)
    && !/\b(?:similar|like|same franchise|same series)\b/i.test(prompt);
}

function looksLikeConceptPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized || normalized.length < 3) {
    return false;
  }

  if (
    inferRelationIntent(prompt)
    || inferCatalogFacetIntent(prompt)
    || inferRankingIntent(prompt)
    || CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
    || CHANGE_PROMPT_PATTERN.test(prompt)
    || NEWS_PROMPT_PATTERN.test(prompt)
    || METRIC_HISTORY_PROMPT_PATTERN.test(prompt)
  ) {
    return false;
  }

  if (/\b(?:publishers?|developers?|studios?)\b/i.test(prompt)) {
    return false;
  }

  if (/\b(?:how many|what changed|what is|who is)\b/i.test(prompt)) {
    return false;
  }

  const bareWords = normalized.replace(/[?!.]+$/g, '').split(/\s+/).filter(Boolean);
  if (bareWords.length <= 6 && !/\b(?:by|from|for)\b/i.test(prompt)) {
    return true;
  }

  return /\bgames?\b/i.test(prompt) && !/\b(?:all games by|games by|games from)\b/i.test(prompt);
}

function inferRankingIntent(prompt: string): boolean {
  return looksLikeCompanyRankingScreen(prompt) || looksLikeGameRankingScreen(prompt);
}

function inferMomentumIntent(prompt: string): boolean {
  if (isSingleEntityMetricOverviewPrompt(prompt)) {
    return false;
  }

  if (inferSimilarityMomentumIntent(prompt) || inferCompareTopMomentumIntent(prompt)) {
    return true;
  }

  if (inferReviewTrendPromptFamily(prompt)) {
    return true;
  }

  if (looksLikeRecentConceptRankingPrompt(prompt)) {
    return true;
  }

  if (!(MOMENTUM_PROMPT_PATTERN.test(prompt) || hasMomentumMetricClause(prompt))) {
    return false;
  }

  if (
    inferCompareIntent(prompt)
    || (
      SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)
      && !inferSimilarityMomentumIntent(prompt)
    )
    || CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
    || CHANGE_PROMPT_PATTERN.test(prompt)
    || NEWS_PROMPT_PATTERN.test(prompt)
    || inferMetricHistoryIntent(prompt)
    || /\b(?:publishers?|developers?|studios?|companies?)\b/i.test(prompt)
  ) {
    return false;
  }

  if (extractCompanyQueryFromPrompt(prompt)) {
    return false;
  }

  return MOMENTUM_DISCOVERY_LEAD_PATTERN.test(prompt)
    || /\b(?:games?|titles?)\b/i.test(prompt)
    || /\bwhat(?:'s| is)\s+(?:trending|breaking out|hot right now)\b/i.test(prompt);
}

function inferMetricHistoryIntent(prompt: string): boolean {
  if (!METRIC_HISTORY_PROMPT_PATTERN.test(prompt) || METRIC_HISTORY_DISALLOWED_PATTERN.test(prompt)) {
    return false;
  }

  return /\b(?:last \d+ days?|this week|this month|over time|history|recently)\b/i.test(prompt);
}

function inferSelectionBoundIntent(params: {
  prompt: string;
  selectionState: SessionChatSelectionState | null | undefined;
}): TigerPrimaryMatchedIntent | null {
  const selectedCandidate = pickSelectedCandidateFromSelectionState(params.selectionState);
  if (!selectedCandidate) {
    return null;
  }

  if (inferMetricHistoryIntent(params.prompt) && selectedCandidate.entityKind === 'game') {
    return 'metric_history';
  }

  if (inferYoutubeGameActivityIntent(params.prompt) && selectedCandidate.entityKind === 'game') {
    return 'youtube_game_activity';
  }

  if (
    selectionReferenceMatchesQuery(params.prompt, selectedCandidate.displayName)
    || ENTITY_OVERVIEW_PROMPT_PATTERN.test(params.prompt)
  ) {
    return 'entity_overview';
  }

  if (
    selectedCandidate.entityKind === 'game'
    && /\b(?:ccu|concurrent players?|player count|players?\s+right\s+now|owners?|reviews?|review score|price|discount)\b/i.test(params.prompt)
    && !/\b(?:games?|titles?)\b/i.test(params.prompt)
    && !looksLikeGameRankingScreen(params.prompt)
  ) {
    return 'entity_overview';
  }

  if (
    selectedCandidate.entityKind !== 'game'
    && /\b(?:games?|titles?|published|developed|owners?|reviews?)\b/i.test(params.prompt)
    && !inferMomentumIntent(params.prompt)
    && !inferRankingIntent(params.prompt)
    && !looksLikeCompanyRankingScreen(params.prompt)
  ) {
    return 'entity_overview';
  }

  return null;
}

function looksLikeRecentConceptRankingPrompt(prompt: string): boolean {
  if (
    looksLikeCompanyRankingScreen(prompt)
    || looksLikeGameRankingScreen(prompt)
    || inferCompareIntent(prompt)
    || inferRelationIntent(prompt)
    || inferCatalogFacetIntent(prompt)
    || CHANGE_DISCOVERY_PROMPT_PATTERN.test(prompt)
    || CHANGE_PROMPT_PATTERN.test(prompt)
    || NEWS_PROMPT_PATTERN.test(prompt)
    || inferMetricHistoryIntent(prompt)
    || /\b(?:publishers?|developers?|studios?|companies?)\b/i.test(prompt)
  ) {
    return false;
  }

  if (!RANKING_BASE_PROMPT_PATTERN.test(prompt) || !/\b(?:games?|titles?)\b/i.test(prompt)) {
    return false;
  }

  if (!hasExplicitPromptTimeWindow(prompt) && !/\brecent(?:ly)?\b/i.test(prompt)) {
    return false;
  }

  if (/\b(?:reviews?|review score|ratings?|owners?|players?|ccu|concurrent)\b/i.test(prompt)) {
    return false;
  }

  return /\bindie\b/i.test(prompt) || looksLikeConceptPrompt(prompt);
}

function normalizeEntityQuery(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  const normalized = candidate
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/\b(this game|this title|it|them)\b/gi, '')
    .replace(/\s+\b(?:before and after|before|after)\b.*$/i, '')
    .replace(/\s+\b(?:this|last|over|in|during|from|while|since)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 1 ? normalized : null;
}

function matchGameMetricOverviewPrompt(prompt: string): RegExpMatchArray | null {
  const directMatch = prompt.match(GAME_METRIC_OVERVIEW_PROMPT_PATTERN);
  if (directMatch) {
    return directMatch;
  }

  const reversedMatch = prompt.match(GAME_METRIC_OVERVIEW_REVERSED_PROMPT_PATTERN);
  const reversedQuery = normalizeEntityQuery(reversedMatch?.[1] ?? null);
  if (!reversedQuery) {
    return null;
  }

  if (NON_ENTITY_GAME_METRIC_QUERY_PATTERN.test(reversedQuery)) {
    return null;
  }

  return reversedMatch;
}

function hasGameMetricOverviewPrompt(prompt: string): boolean {
  return matchGameMetricOverviewPrompt(prompt) !== null;
}

function extractGameNameFromSessionContext(sessionContext: SessionChatContext | null): string | null {
  if (!sessionContext?.entities?.length) {
    return null;
  }

  const reversed = [...sessionContext.entities].reverse();
  const entity = reversed.find((candidate) => candidate.kind === 'game' && candidate.name);
  return normalizeEntityQuery(entity?.name ?? null);
}

function extractGameNameFromToolCalls(toolCalls: ChatToolCall[]): string | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) {
      continue;
    }

    const app = isRecord(result.app) ? result.app : null;
    if (app && typeof app.name === 'string') {
      return normalizeEntityQuery(app.name);
    }

    if (Array.isArray(result.apps)) {
      const firstApp = result.apps.find((candidate) => isRecord(candidate) && typeof candidate.name === 'string');
      if (isRecord(firstApp) && typeof firstApp.name === 'string') {
        return normalizeEntityQuery(firstApp.name);
      }
    }
  }

  return null;
}

function extractEntityQueryFromPrompt(prompt: string): string | null {
  for (const pattern of ENTITY_QUERY_PATTERNS) {
    const match = prompt.match(pattern);
    const candidate = normalizeEntityQuery(match?.[1] ?? null);
    if (candidate) {
      return candidate;
    }
  }

  const gameMetricMatch = matchGameMetricOverviewPrompt(prompt);
  const gameMetricQuery = normalizeEntityQuery(gameMetricMatch?.[1] ?? gameMetricMatch?.[2] ?? null);
  if (gameMetricQuery) {
    return gameMetricQuery;
  }

  return null;
}

function extractYoutubeEntityQuery(prompt: string): string | null {
  for (const pattern of YOUTUBE_ENTITY_QUERY_PATTERNS) {
    const match = prompt.match(pattern);
    const candidate = normalizeEntityQuery(match?.[1] ?? null);
    if (candidate) {
      return candidate;
    }
  }

  const fallbackCandidate = extractEntityQueryFromPrompt(prompt);
  if (
    !fallbackCandidate
    || /\byoutube\b/i.test(fallbackCandidate)
    || /^(?:right now|today|this week|this month)$/i.test(fallbackCandidate)
  ) {
    return null;
  }

  return fallbackCandidate;
}

function extractEntityOverviewQuery(prompt: string): string | null {
  const countMatch = prompt.match(COMPANY_COUNT_PROMPT_PATTERN);
  const countQuery = normalizeEntityQuery(countMatch?.[1] ?? null);
  if (countQuery) {
    return countQuery;
  }

  const companyMetricMatch = prompt.match(COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN);
  const companyMetricQuery = normalizeEntityQuery(companyMetricMatch?.[1] ?? null);
  if (companyMetricQuery) {
    return companyMetricQuery;
  }

  const gameMetricMatch = matchGameMetricOverviewPrompt(prompt);
  const gameMetricQuery = normalizeEntityQuery(gameMetricMatch?.[1] ?? gameMetricMatch?.[2] ?? null);
  if (gameMetricQuery) {
    return gameMetricQuery;
  }

  const overviewMatch =
    prompt.match(/(?:tell me about|what can you tell me about|what do you know about|give me an overview of|overview of)\s+(.+?)(?:[?!.]|$)/i)
    ?? prompt.match(/(?:what is|who is)\s+(.+?)(?:[?!.]|$)/i);
  const overviewQuery = normalizeEntityQuery(overviewMatch?.[1] ?? null);
  if (overviewQuery) {
    return overviewQuery;
  }

  return extractEntityQueryFromPrompt(prompt);
}

function splitExplicitEntityList(value: string): string[] {
  return value
    .replace(/\s+/g, ' ')
    .split(/\s*,\s*|\s+and\s+/i)
    .map((item) => normalizeEntityQuery(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

function extractExplicitNewsTargets(prompt: string): string[] {
  const patterns = [
    /\bsummar(?:y|ize)\b.+?\bacross\s+(.+?)(?:[?.!]|$)/i,
    /\bnews\s+across\s+(.+?)(?:[?.!]|$)/i,
    /\bupdates?\s+across\s+(.+?)(?:[?.!]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const raw = normalizeEntityQuery(match?.[1] ?? null);
    if (!raw) {
      continue;
    }

    const items = splitExplicitEntityList(raw);
    if (items.length >= 2) {
      return items;
    }
  }

  return [];
}

function inferNewsTopicQuery(prompt: string): string | null {
  if (/\b(?:developer diar(?:y|ies)|dev diar(?:y|ies)|devlog)\b/i.test(prompt)) {
    return 'developer diary';
  }

  if (/\broadmap\b/i.test(prompt)) {
    return 'roadmap';
  }

  if (/\b(?:demo|playtest)\b/i.test(prompt)) {
    return 'demo or playtest';
  }

  if (/\b(?:patch notes?|update notes?)\b/i.test(prompt)) {
    return 'patch notes';
  }

  if (/\bbehind[- ]the[- ]scenes\b/i.test(prompt)) {
    return 'behind the scenes';
  }

  return null;
}

function parsePromptDays(prompt: string, fallback = 30): number {
  const explicitDuration = prompt.match(/\b(?:last|past)\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i);
  if (explicitDuration) {
    const parsed = Number.parseInt(explicitDuration[1] ?? '', 10);
    const unit = explicitDuration[2]?.toLowerCase() ?? 'days';
    if (Number.isFinite(parsed) && parsed > 0) {
      const multiplier =
        unit.startsWith('week') ? 7
          : unit.startsWith('month') ? 30
            : unit.startsWith('year') ? 365
              : 1;
      return Math.min(parsed * multiplier, 180);
    }
  }

  if (/\b(?:last|past)\s+week\b/i.test(prompt)) {
    return 7;
  }

  if (/\b(?:last|past)\s+month\b/i.test(prompt)) {
    return 30;
  }

  if (/\b(?:last|past)\s+quarter\b/i.test(prompt)) {
    return 90;
  }

  if (/\b(?:last|past)\s+year\b/i.test(prompt)) {
    return 180;
  }

  if (/\bthis week\b/i.test(prompt)) {
    return 7;
  }

  if (/\bthis month\b/i.test(prompt)) {
    return 30;
  }

  if (/\bthis quarter\b/i.test(prompt)) {
    return 90;
  }

  if (/\b(?:today|yesterday)\b/i.test(prompt)) {
    return 1;
  }

  return fallback;
}

function hasExplicitPromptTimeWindow(prompt: string): boolean {
  return /\b(?:last|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?|week|month|quarter|year)\b/i.test(prompt)
    || /\b(?:this week|this month|this quarter|today|yesterday)\b/i.test(prompt);
}

function shouldUseDigestNewsMode(prompt: string, entityQueries: string[]): boolean {
  return entityQueries.length >= 2 || /\b(?:summar(?:y|ize)|digest|across)\b/i.test(prompt);
}

function shouldUseLatestNewsMode(prompt: string, entityQuery: string | null): boolean {
  if (!entityQuery) {
    return false;
  }

  if (inferNewsTopicQuery(prompt)) {
    return false;
  }

  if (/\b(?:latest|newest|most recent)\b/i.test(prompt)) {
    return true;
  }

  return /\brecent\b/i.test(prompt)
    && /\b(?:announcements?|news|updates?|devlog|developer diar(?:y|ies)|roadmap|demo|playtest)\b/i.test(prompt)
    && !/\b(?:patch notes?|update notes?)\b/i.test(prompt);
}

function resolveDocumentSearchWindowDays(prompt: string, entityQuery: string | null): number {
  if (hasExplicitPromptTimeWindow(prompt)) {
    return parsePromptDays(prompt, 30);
  }

  if (
    entityQuery
    && (
      shouldUseLatestNewsMode(prompt, entityQuery)
      || /\b(?:patch notes?|update notes?)\b/i.test(prompt)
      || /\brecent\b/i.test(prompt) && NEWS_PROMPT_PATTERN.test(prompt)
    )
  ) {
    return 90;
  }

  return parsePromptDays(prompt, 30);
}

function inferEntityOverviewKindHint(
  prompt: string
): 'developer' | 'game' | 'publisher' | null {
  if (/\b(?:published|publisher|published by)\b/i.test(prompt)) {
    return 'publisher';
  }

  if (/\b(?:developed|developer|studio)\b/i.test(prompt)) {
    return 'developer';
  }

  if (hasGameMetricOverviewPrompt(prompt)) {
    return 'game';
  }

  return null;
}

function inferEntityOverviewViewMode(
  prompt: string,
  entityKind: 'developer' | 'game' | 'publisher'
): 'company_count' | 'company_games' | 'company_metrics' | 'game_overview' {
  if (entityKind === 'game') {
    return 'game_overview';
  }

  if (COMPANY_COUNT_PROMPT_PATTERN.test(prompt)) {
    return 'company_count';
  }

  if (COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN.test(prompt)) {
    return 'company_metrics';
  }

  return 'company_games';
}

function inferEntityOverviewResolutionPreference(
  prompt: string,
  explicitKindHint: 'developer' | 'game' | 'publisher' | null
): EntityResolutionPreference {
  if (explicitKindHint === 'game') {
    return 'game';
  }

  if (explicitKindHint === 'developer' || explicitKindHint === 'publisher') {
    return 'company';
  }

  if (COMPANY_COUNT_PROMPT_PATTERN.test(prompt) || COMPANY_PORTFOLIO_METRIC_PROMPT_PATTERN.test(prompt)) {
    return 'company';
  }

  if (hasGameMetricOverviewPrompt(prompt)) {
    return 'game';
  }

  return null;
}

function buildNewsTopicQuery(prompt: string, entityQuery?: string | null): string {
  const canonicalTopic = inferNewsTopicQuery(prompt);
  if (canonicalTopic) {
    return canonicalTopic;
  }

  let normalized = prompt
    .replace(/^(find|show|give|tell)\s+me\s+/i, '')
    .replace(/\b(any|recent|noteworthy|announcements?|news|updates?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (entityQuery) {
    const escapedEntity = entityQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized
      .replace(new RegExp(`\\b(?:about|for|on)\\s+${escapedEntity}\\b`, 'i'), '')
      .replace(new RegExp(`\\b${escapedEntity}\\b`, 'i'), '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalized = normalized
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length > 0) {
    return normalized;
  }

  return entityQuery?.trim() || prompt.trim();
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSortDirection(value: unknown): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

function normalizeLimit(value: unknown, fallback: number): number {
  const normalized = normalizeNumber(value);
  if (!normalized) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(normalized), 25));
}

function extractRequestedTopCount(
  prompt: string,
  fallback: number,
  max = 25
): number {
  const explicitTop = prompt.match(/\btop\s+(\d{1,2})\b/i);
  if (!explicitTop) {
    return fallback;
  }

  const parsed = Number.parseInt(explicitTop[1] ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(2, Math.min(parsed, max));
}

function normalizeYearRange(value: unknown): { gte?: number; lte?: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const gte = normalizeNumber(value.gte);
  const lte = normalizeNumber(value.lte);
  if (gte == null && lte == null) {
    return undefined;
  }

  return {
    ...(gte != null ? { gte } : {}),
    ...(lte != null ? { lte } : {}),
  };
}

function pickLastToolCall(toolCalls: ChatToolCall[], names: string[]): ChatToolCall | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (names.includes(toolCalls[index]?.name)) {
      return toolCalls[index] ?? null;
    }
  }

  return null;
}

function extractCanonicalCompanyName(toolCall: ChatToolCall | null): string | null {
  if (!toolCall || !isRecord(toolCall.result)) {
    return null;
  }

  const canonicalResult = isRecord(toolCall.result.canonicalResult) ? toolCall.result.canonicalResult : null;
  return canonicalResult && typeof canonicalResult.name === 'string'
    ? canonicalResult.name.trim()
    : null;
}

function buildCatalogRequestFromSearchGames(toolCalls: ChatToolCall[]): CatalogShadowBuildResult {
  const toolCall = pickLastToolCall(toolCalls, ['search_games']);
  const args = isRecord(toolCall?.arguments) ? toolCall.arguments : null;
  if (!args) {
    return {
      request: null,
      reason: 'No compatible search_games tool call was available for system catalog shadow routing.',
    };
  }

  const unsupported: string[] = [];
  if (normalizeStringArray(args.categories)) unsupported.push('categories');
  if (typeof args.controller_support === 'string') unsupported.push('controller_support');
  if (normalizeStringArray(args.steam_deck)) unsupported.push('steam_deck');
  if (isRecord(args.metacritic_score)) unsupported.push('metacritic_score');
  if (Array.isArray(args.excludeAppIds) && args.excludeAppIds.length > 0) unsupported.push('excludeAppIds');

  const orderBy = typeof args.order_by === 'string' ? args.order_by : undefined;
  const sortBy = orderBy === 'reviews'
    ? 'reviews'
    : orderBy === 'owners'
      ? 'owners'
      : orderBy === 'release_date'
        ? 'release_date'
        : undefined;
  if (orderBy && !sortBy) {
    unsupported.push(`order_by:${orderBy}`);
  }

  if (unsupported.length > 0) {
    return {
      request: null,
      reason: `system catalog shadow skipped unsupported search_games fields: ${unsupported.join(', ')}.`,
    };
  }

  return {
    request: {
      ...(normalizeStringArray(args.tags) ? { tags: normalizeStringArray(args.tags) } : {}),
      ...(normalizeStringArray(args.genres) ? { genres: normalizeStringArray(args.genres) } : {}),
      ...(normalizeStringArray(args.platforms) ? { platforms: normalizeStringArray(args.platforms) } : {}),
      ...(normalizeBoolean(args.is_free) != null ? { isFree: normalizeBoolean(args.is_free) } : {}),
      ...(normalizeNumber(args.min_reviews) != null ? { minReviews: normalizeNumber(args.min_reviews) } : {}),
      ...(isRecord(args.review_percentage) && normalizeNumber(args.review_percentage.gte) != null
        ? { minReviewScore: normalizeNumber(args.review_percentage.gte) }
        : {}),
      ...(normalizeNumber(args.min_price_cents) != null ? { minPriceCents: normalizeNumber(args.min_price_cents) } : {}),
      ...(normalizeNumber(args.max_price_cents) != null ? { maxPriceCents: normalizeNumber(args.max_price_cents) } : {}),
      ...(normalizeBoolean(args.on_sale) === true ? { onSale: true } : {}),
      ...(normalizeNumber(args.min_discount_percent) != null
        ? { minDiscountPercent: normalizeNumber(args.min_discount_percent) }
        : {}),
      ...(normalizeYearRange(args.release_year) ? { releaseYear: normalizeYearRange(args.release_year) } : {}),
      ...(sortBy ? { sortBy, sortDirection: 'desc' as const } : {}),
      limit: normalizeLimit(args.limit, 20),
    },
  };
}

function buildCatalogRequestFromScreenGames(toolCalls: ChatToolCall[]): CatalogShadowBuildResult {
  const toolCall = pickLastToolCall(toolCalls, ['screen_games']);
  const args = isRecord(toolCall?.arguments) ? toolCall.arguments : null;
  const filters = isRecord(args?.filters) ? args.filters : null;

  if (!args || !filters) {
    return {
      request: null,
      reason: 'No compatible screen_games tool call was available for system catalog shadow routing.',
    };
  }

  const unsupported: string[] = [];
  if (normalizeStringArray(filters.categories)) unsupported.push('filters.categories');
  if (normalizeStringArray(filters.verified_tags_any)) unsupported.push('filters.verified_tags_any');
  if (normalizeStringArray(filters.steam_deck)) unsupported.push('filters.steam_deck');
  if (normalizeNumber(filters.max_reviews) != null) unsupported.push('filters.max_reviews');
  if (normalizeNumber(filters.min_reviews_added_7d) != null) unsupported.push('filters.min_reviews_added_7d');
  if (normalizeNumber(filters.min_reviews_added_30d) != null) unsupported.push('filters.min_reviews_added_30d');
  if (normalizeNumber(filters.min_sentiment_delta) != null) unsupported.push('filters.min_sentiment_delta');
  if (normalizeNumber(filters.max_sentiment_delta) != null) unsupported.push('filters.max_sentiment_delta');
  if (normalizeBoolean(filters.self_published) != null) unsupported.push('filters.self_published');
  if (typeof filters.publisher_size === 'string') unsupported.push('filters.publisher_size');
  if (normalizeBoolean(args.indie_heuristic) === true) unsupported.push('indie_heuristic');
  if (Array.isArray(args.excludeAppIds) && args.excludeAppIds.length > 0) unsupported.push('excludeAppIds');

  const sortByRaw = typeof args.sort_by === 'string' ? args.sort_by : undefined;
  const sortBy = sortByRaw === 'ccu_peak'
    ? 'ccu_peak'
    : sortByRaw === 'total_reviews'
      ? 'reviews'
      : undefined;
  if (sortByRaw && !sortBy) {
    unsupported.push(`sort_by:${sortByRaw}`);
  }

  if (unsupported.length > 0) {
    return {
      request: null,
      reason: `system catalog shadow skipped unsupported screen_games fields: ${unsupported.join(', ')}.`,
    };
  }

  return {
    request: {
      ...(normalizeStringArray(filters.tags) ? { tags: normalizeStringArray(filters.tags) } : {}),
      ...(normalizeStringArray(filters.genres) ? { genres: normalizeStringArray(filters.genres) } : {}),
      ...(normalizeStringArray(filters.platforms) ? { platforms: normalizeStringArray(filters.platforms) } : {}),
      ...(normalizeBoolean(filters.is_free) != null ? { isFree: normalizeBoolean(filters.is_free) } : {}),
      ...(normalizeNumber(filters.min_reviews) != null ? { minReviews: normalizeNumber(filters.min_reviews) } : {}),
      ...(normalizeNumber(filters.min_score) != null ? { minReviewScore: normalizeNumber(filters.min_score) } : {}),
      ...(normalizeNumber(filters.min_ccu) != null ? { minCcu: normalizeNumber(filters.min_ccu) } : {}),
      ...(normalizeYearRange(filters.release_year) ? { releaseYear: normalizeYearRange(filters.release_year) } : {}),
      ...(sortBy ? { sortBy, sortDirection: normalizeSortDirection(args.sort_order) ?? 'desc' } : {}),
      limit: normalizeLimit(args.limit, 10),
    },
  };
}

function buildCatalogRequestFromCompanyLookup(prompt: string, toolCalls: ChatToolCall[]): CatalogShadowBuildResult {
  if (!COMPANY_GAME_LIST_PROMPT_PATTERN.test(prompt)) {
    return {
      request: null,
      reason: 'No compatible company-backed game-list prompt was available for system catalog shadow routing.',
    };
  }

  const lookupToolCall = pickLastToolCall(toolCalls, ['lookup_developers', 'lookup_publishers']);
  const canonicalName = extractCanonicalCompanyName(lookupToolCall);
  if (!lookupToolCall || !canonicalName) {
    return {
      request: null,
      reason: 'System catalog shadow could not reuse a canonical company lookup result for this game-list prompt.',
    };
  }

  return {
    request: {
      ...(lookupToolCall.name === 'lookup_developers'
        ? { developerQuery: canonicalName }
        : { publisherQuery: canonicalName }),
      limit: 25,
      sortBy: 'release_date',
      sortDirection: 'desc',
    },
  };
}

function buildCatalogSearchShadowRequest(prompt: string, toolCalls: ChatToolCall[]): CatalogShadowBuildResult {
  const searchGamesAttempt = buildCatalogRequestFromSearchGames(toolCalls);
  if (searchGamesAttempt.request || searchGamesAttempt.reason?.startsWith('system catalog shadow skipped unsupported')) {
    return searchGamesAttempt;
  }

  const screenGamesAttempt = buildCatalogRequestFromScreenGames(toolCalls);
  if (screenGamesAttempt.request || screenGamesAttempt.reason?.startsWith('system catalog shadow skipped unsupported')) {
    return screenGamesAttempt;
  }

  return buildCatalogRequestFromCompanyLookup(prompt, toolCalls);
}

function extractCompanyQueryFromPrompt(prompt: string): string | null {
  const match = prompt.match(/\bgames?\b.*\b(?:by|from)\b\s+(.+?)(?:[?!.]|$)/i);
  const candidate = normalizeEntityQuery(match?.[1] ?? null);
  if (!candidate) {
    return null;
  }

  return METRIC_LIKE_ENTITY_QUERY_PATTERN.test(candidate) ? null : candidate;
}

function extractPrimaryPlatforms(prompt: string): string[] {
  const platforms: string[] = [];
  const normalized = prompt.toLowerCase();

  if (normalized.includes('windows')) {
    platforms.push('windows');
  }
  if (normalized.includes('macos') || /\bmac\b/.test(normalized)) {
    platforms.push('macos');
  }
  if (normalized.includes('linux')) {
    platforms.push('linux');
  }

  return platforms;
}

function extractPrimaryReleaseYear(prompt: string): { gte?: number; lte?: number } | undefined {
  if (/\blast year\b/i.test(prompt)) {
    const currentYear = new Date().getFullYear();
    return { gte: currentYear - 1, lte: currentYear - 1 };
  }

  if (/\bthis year\b/i.test(prompt)) {
    const currentYear = new Date().getFullYear();
    return { gte: currentYear, lte: currentYear };
  }

  const explicitYear = prompt.match(/\b(20\d{2})\b/);
  if (!explicitYear) {
    return undefined;
  }

  const year = Number(explicitYear[1]);
  return Number.isFinite(year) ? { gte: year, lte: year } : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toFilterLabel(value: string): string {
  return value
    .split(/(\s+|-)/)
    .map((segment) => (/^\s+$|-$/.test(segment) ? segment : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`))
    .join('');
}

function parseCountToken(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/,/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) {
    return null;
  }

  const base = Number.parseFloat(match[1] ?? '0');
  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') {
    return Math.round(base * 1_000);
  }
  if (suffix === 'm') {
    return Math.round(base * 1_000_000);
  }
  if (suffix === 'b') {
    return Math.round(base * 1_000_000_000);
  }

  return Math.round(base);
}

function extractMinimumPriceCents(prompt: string): number | null {
  const match =
    prompt.match(/\b(?:over|above)\s+\$(\d{1,4})(?:\.\d{1,2})?\b/i)
    ?? prompt.match(/\b(?:over|above)\s+(\d{1,4})(?:\.\d{1,2})?\s+(?:dollars?|usd|bucks?)\b/i);
  if (!match) {
    return null;
  }

  return Math.round(Number.parseFloat(match[1] ?? '0') * 100);
}

function extractMomentumSteamDeck(prompt: string): Array<'playable' | 'verified'> | undefined {
  if (/\bsteam deck verified\b/i.test(prompt)) {
    return ['verified'];
  }

  if (/\bsteam deck playable\b/i.test(prompt)) {
    return ['playable'];
  }

  if (/\bsteam deck\b/i.test(prompt)) {
    return ['verified', 'playable'];
  }

  return undefined;
}

function extractMomentumReviewThreshold(prompt: string): number | undefined {
  if (/\boverwhelmingly positive\b/i.test(prompt)) {
    return 95;
  }

  if (/\bhighly rated\b/i.test(prompt)) {
    return 85;
  }

  if (/\bgreat reviews?\b/i.test(prompt)) {
    return 80;
  }

  return undefined;
}

function extractMomentumMinReviews(prompt: string): number | undefined {
  const match = prompt.match(/\b(?:at least|min(?:imum)?(?: of)?|over|more than)\s+([\d,.]+[kmb]?)\s+reviews?\b/i);
  const parsed = parseCountToken(match?.[1] ?? null);
  return parsed != null ? parsed : undefined;
}

function extractMomentumMaxReviews(prompt: string): number | undefined {
  const match = prompt.match(
    /\b(?:under|below|less than|fewer than|max(?:imum)?(?: of)?|up to)\s+([\d,.]+[kmb]?)\s+reviews?\b/i
  );
  const parsed = parseCountToken(match?.[1] ?? null);
  return parsed != null ? parsed : undefined;
}

function extractMomentumMinCcu(prompt: string): number | undefined {
  const match = prompt.match(
    /\b(?:at least|min(?:imum)?(?: of)?|over|more than)\s+([\d,.]+[kmb]?)\s+(?:ccu|concurrent players?|players?\s+right\s+now)\b/i
  );
  const parsed = parseCountToken(match?.[1] ?? null);
  return parsed != null ? parsed : undefined;
}

function extractMomentumMaxPriceCents(prompt: string): number | undefined {
  const match = prompt.match(/\bunder\s+\$?(\d{1,4})(?:\.\d{1,2})?\b/i);
  if (!match) {
    return undefined;
  }

  return Math.round(Number.parseFloat(match[1] ?? '0') * 100);
}

function extractMomentumTags(prompt: string): string[] | undefined {
  const allowBroadIndieTag =
    /\bindie\b/i.test(prompt)
    && (hasExplicitPromptTimeWindow(prompt) || RANKING_BASE_PROMPT_PATTERN.test(prompt) || MOMENTUM_PROMPT_PATTERN.test(prompt));
  const excluded = new Set([
    'indie',
    'free-to-play',
    'early access',
    'demo',
    'multiplayer',
    'single-player',
    'vr',
  ]);
  if (allowBroadIndieTag) {
    excluded.delete('indie');
  }

  const normalizedPrompt = prompt.toLowerCase();
  const matches = COMMON_TAGS.filter((tag) => {
    if (excluded.has(tag)) {
      return false;
    }

    const escaped = escapeRegex(tag);
    return new RegExp(`\\b${escaped}s?\\b\\s+games?`, 'i').test(prompt)
      || new RegExp(`\\b(?:games?|titles?)\\b[^.?!]{0,24}\\b${escaped}s?\\b`, 'i').test(prompt);
  }).map(toFilterLabel);

  if (/\bpixel art\b/i.test(prompt) && !matches.includes('Pixel')) {
    matches.push('Pixel');
  }
  if (/\bdeck ?building\b/i.test(prompt) && !matches.includes('DeckBuilder')) {
    matches.push('DeckBuilder');
  }
  if (/\broguelites?\b/i.test(prompt) && !matches.includes('Roguelike')) {
    matches.push('Roguelike');
  }
  if (
    (
      normalizedPrompt.split(/\s+/).length <= 6
      || /\bgames?\b/i.test(prompt)
      || inferCompareTopMomentumIntent(prompt)
    )
    && matches.length === 0
  ) {
    for (const tag of COMMON_TAGS) {
      if (excluded.has(tag)) {
        continue;
      }

      const escaped = escapeRegex(tag);
      if (new RegExp(`\\b${escaped}s?\\b`, 'i').test(prompt)) {
        matches.push(toFilterLabel(tag));
      }
    }
  }

  return matches.length > 0 ? Array.from(new Set(matches)) : undefined;
}

const DISCOVERY_MINIMUM_ITEMS = 5;
const DISCOVERY_IDEAL_ITEMS = 10;
const MARKET_LEADING_REVIEW_TREND_MIN_CCU = 100;
const MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS = 10_000;
const MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS_ADDED = 25;
const BALANCED_REVIEW_TREND_MIN_REVIEWS = 1_000;
const BALANCED_REVIEW_TREND_MIN_REVIEWS_ADDED = 5;
const RELAXED_REVIEW_TREND_MIN_REVIEWS = 250;
const RELAXED_REVIEW_TREND_MIN_REVIEWS_ADDED_7D = 2;
const RELAXED_REVIEW_TREND_MIN_REVIEWS_ADDED_30D = 3;
const REVIEW_SENTIMENT_THRESHOLD = 3;

interface MomentumDiscoveryResultPolicy {
  idealItems: number;
  minimumItems: number;
}

function isReviewSentimentPromptFamily(
  promptFamily: MomentumPromptFamily | null | undefined
): promptFamily is 'review_sentiment_down' | 'review_sentiment_up' {
  return promptFamily === 'review_sentiment_down' || promptFamily === 'review_sentiment_up';
}

function isReviewActivityPromptFamily(
  promptFamily: MomentumPromptFamily | null | undefined
): promptFamily is 'review_activity_down' | 'review_activity_up' {
  return (
    promptFamily === 'review_activity_down'
    || promptFamily === 'review_activity_up'
  );
}

function isReviewTrendPromptFamily(
  promptFamily: MomentumPromptFamily | null | undefined
): promptFamily is
  | 'review_activity_down'
  | 'review_activity_up'
  | 'review_momentum'
  | 'review_sentiment_down'
  | 'review_sentiment_up' {
  return (
    isReviewSentimentPromptFamily(promptFamily)
    || isReviewActivityPromptFamily(promptFamily)
    || promptFamily === 'review_momentum'
  );
}

function clearReviewTrendSpecificFilters(
  filters: NonNullable<DiscoverMomentumShadowRequest['filters']>
): void {
  delete filters.minReviewsAdded7d;
  delete filters.minReviewsAdded30d;
  delete filters.minSentimentDelta;
  delete filters.maxSentimentDelta;
}

function getReviewTrendReviewAddedField(
  request: DiscoverMomentumShadowRequest
): 'minReviewsAdded30d' | 'minReviewsAdded7d' {
  return request.timeframe === '30d' || request.sortBy === 'reviews_added_30d'
    ? 'minReviewsAdded30d'
    : 'minReviewsAdded7d';
}

function getRelaxedReviewTrendReviewAddedFloor(
  request: DiscoverMomentumShadowRequest
): number {
  return getReviewTrendReviewAddedField(request) === 'minReviewsAdded30d'
    ? RELAXED_REVIEW_TREND_MIN_REVIEWS_ADDED_30D
    : RELAXED_REVIEW_TREND_MIN_REVIEWS_ADDED_7D;
}

function getMomentumDiscoveryResultPolicy(
  request: DiscoverMomentumShadowRequest
): MomentumDiscoveryResultPolicy | null {
  const requestedLimit = Number.isInteger(request.limit) && (request.limit ?? 0) > 0
    ? (request.limit as number)
    : DISCOVERY_IDEAL_ITEMS;

  if (requestedLimit < DISCOVERY_MINIMUM_ITEMS) {
    return null;
  }

  if (Array.isArray(request.appids) && request.appids.length > 0) {
    return null;
  }

  return {
    idealItems: Math.min(requestedLimit, DISCOVERY_IDEAL_ITEMS),
    minimumItems: Math.min(DISCOVERY_MINIMUM_ITEMS, requestedLimit),
  };
}

function describeMomentumDiscoveryScreen(
  promptFamily: MomentumPromptFamily | null | undefined
): string {
  if (isReviewSentimentPromptFamily(promptFamily)) {
    return 'review-sentiment screen';
  }

  if (isReviewActivityPromptFamily(promptFamily) || promptFamily === 'review_momentum') {
    return 'review-activity screen';
  }

  if (promptFamily === 'current_players') {
    return 'current-player screen';
  }

  return 'momentum screen';
}

function buildMomentumDiscoveryShortfallReason(params: {
  broadeningApplied: boolean;
  policy: MomentumDiscoveryResultPolicy | null;
  promptFamily: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest;
  resultCount: number;
}): string | null {
  if (
    params.policy == null
    || params.resultCount <= 0
    || params.resultCount >= params.policy.minimumItems
  ) {
    return null;
  }

  const countLabel = `${params.resultCount} ${params.resultCount === 1 ? 'title' : 'titles'}`;
  const screenLabel = describeMomentumDiscoveryScreen(params.promptFamily);
  const timeframeLabel = params.request.timeframe === '30d'
    ? '30-day'
    : params.request.timeframe === 'current'
      ? 'current'
      : '7-day';
  const broadenedPrefix = params.broadeningApplied
    ? 'even after relaxing the default popularity floor, '
    : '';
  const historyNote = isReviewTrendPromptFamily(params.promptFamily)
    ? ' The current window or recent history coverage is still too thin to fill the usual list.'
    : '';

  return `Only ${countLabel} qualified ${broadenedPrefix}for this ${timeframeLabel} ${screenLabel}, so I could not fill ${params.policy.minimumItems} spots.${historyNote}`;
}

function decorateMomentumDiscoveryResponse(params: {
  broadeningApplied: boolean;
  policy: MomentumDiscoveryResultPolicy | null;
  response: DiscoverMomentumResponse;
  shortfallReason?: string | null;
}): DiscoverMomentumResponse {
  const resultCount = params.response.items?.length ?? 0;

  return {
    ...params.response,
    ...(params.broadeningApplied ? { broadeningApplied: true } : {}),
    ...(params.policy ? {
      idealItems: params.policy.idealItems,
      minimumItems: params.policy.minimumItems,
    } : {}),
    provenanceSource: params.response.provenance?.source ?? null,
    resultCount,
    ...(params.shortfallReason ? { shortfallReason: params.shortfallReason } : {}),
  };
}

function inferReviewTrendPromptFamily(prompt: string): Exclude<
  MomentumPromptFamily,
  'accelerating' | 'breaking_out' | 'current_players' | 'declining' | 'review_momentum' | 'trending'
> | null {
  const tokens = tokenizeFollowUpPrompt(prompt);

  if (
    includesApproxPhrase(tokens, ['getting', 'worse', 'reviews'])
    || includesApproxPhrase(tokens, ['worse', 'reviews'])
    || includesApproxPhrase(tokens, ['reviews', 'getting', 'worse'])
    || includesApproxPhrase(tokens, ['reviews', 'slipping'])
    || includesApproxPhrase(tokens, ['worsening', 'sentiment'])
    || includesApproxPhrase(tokens, ['declining', 'sentiment'])
    || includesApproxPhrase(tokens, ['sentiment', 'declining'])
    || includesApproxPhrase(tokens, ['sentiment', 'falling'])
    || includesApproxPhrase(tokens, ['mixed', 'lately'])
    || includesApproxPhrase(tokens, ['review', 'sentiment', 'falling'])
  ) {
    return 'review_sentiment_down';
  }

  if (
    includesApproxPhrase(tokens, ['improving', 'sentiment'])
    || includesApproxPhrase(tokens, ['sentiment', 'improving'])
    || includesApproxPhrase(tokens, ['reviews', 'improving'])
    || includesApproxPhrase(tokens, ['sentiment', 'up'])
  ) {
    return 'review_sentiment_up';
  }

  if (
    includesApproxPhrase(tokens, ['trending', 'up', 'reviews'])
    || includesApproxPhrase(tokens, ['trending', 'up', 'in', 'reviews'])
    || includesApproxPhrase(tokens, ['reviews', 'trending', 'up'])
    || includesApproxPhrase(tokens, ['reviews', 'surging'])
    || includesApproxPhrase(tokens, ['review', 'velocity'])
    || includesApproxPhrase(tokens, ['by', 'review', 'velocity'])
    || includesApproxPhrase(tokens, ['getting', 'more', 'reviews'])
    || includesApproxPhrase(tokens, ['reviews', 'picking', 'up'])
  ) {
    return 'review_activity_up';
  }

  if (
    includesApproxPhrase(tokens, ['reviews', 'slowing', 'down'])
    || includesApproxPhrase(tokens, ['review', 'momentum', 'fading'])
    || includesApproxPhrase(tokens, ['fewer', 'reviews'])
    || includesApproxPhrase(tokens, ['reviews', 'trending', 'down'])
  ) {
    return 'review_activity_down';
  }

  return null;
}

function inferMomentumRequestFamily(
  request: DiscoverMomentumShadowRequest
): MomentumPromptFamily | null {
  const filters = request.filters ?? null;

  if (request.sortBy === 'ccu_peak' && request.timeframe === 'current') {
    return 'current_players';
  }

  if (typeof filters?.maxSentimentDelta === 'number') {
    return 'review_sentiment_down';
  }

  if (typeof filters?.minSentimentDelta === 'number') {
    return 'review_sentiment_up';
  }

  if (request.sortBy === 'sentiment_delta') {
    return request.sortDirection === 'asc' ? 'review_sentiment_down' : 'review_sentiment_up';
  }

  if (
    request.sortBy === 'reviews_added_7d'
    || request.sortBy === 'reviews_added_30d'
    || request.sortBy === 'velocity_7d'
    || request.trendType === 'review_momentum'
  ) {
    return 'review_activity_up';
  }

  if (request.sortBy === 'velocity_acceleration' && request.sortDirection === 'asc' && request.trendType !== 'declining') {
    return 'review_activity_down';
  }

  if (request.trendType === 'breaking_out') {
    return 'breaking_out';
  }

  if (request.trendType === 'accelerating') {
    return 'accelerating';
  }

  if (request.trendType === 'declining') {
    return 'declining';
  }

  if (request.sortBy === 'momentum_score') {
    return 'trending';
  }

  return null;
}

function hasMomentumNarrowingScope(request: DiscoverMomentumShadowRequest): boolean {
  const filters = request.filters ?? null;
  return Boolean(
    request.indieHeuristic
      || filters?.platforms?.length
      || filters?.steamDeck?.length
      || filters?.tags?.length
      || filters?.genres?.length
      || filters?.releaseYear
      || filters?.maxPriceCents != null
      || filters?.isFree != null
  );
}

function applyReviewTrendPopularityDefaults(
  prompt: string,
  request: DiscoverMomentumShadowRequest,
  promptFamily: MomentumPromptFamily | null
): DiscoverMomentumShadowRequest {
  if (!isReviewTrendPromptFamily(promptFamily)) {
    return request;
  }

  const filters: NonNullable<DiscoverMomentumShadowRequest['filters']> = {
    ...(request.filters ?? {}),
  };
  const explicitMinReviews = extractMomentumMinReviews(prompt);
  const explicitMinCcu = extractMomentumMinCcu(prompt);
  const reviewAddedField = getReviewTrendReviewAddedField(request);
  const staleReviewAddedField =
    reviewAddedField === 'minReviewsAdded30d' ? 'minReviewsAdded7d' : 'minReviewsAdded30d';

  if (explicitMinReviews == null) {
    filters.minReviews =
      typeof filters.minReviews !== 'number' || filters.minReviews === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS
        ? BALANCED_REVIEW_TREND_MIN_REVIEWS
        : Math.max(filters.minReviews, BALANCED_REVIEW_TREND_MIN_REVIEWS);
  }

  if (explicitMinCcu == null) {
    if (filters.minCcu === MARKET_LEADING_REVIEW_TREND_MIN_CCU) {
      delete filters.minCcu;
    }
  }

  delete filters[staleReviewAddedField];

  const currentReviewAddedFloor = filters[reviewAddedField];
  const normalizedReviewAddedFloor =
    typeof currentReviewAddedFloor !== 'number'
      || currentReviewAddedFloor === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS_ADDED
      ? BALANCED_REVIEW_TREND_MIN_REVIEWS_ADDED
      : Math.max(currentReviewAddedFloor, BALANCED_REVIEW_TREND_MIN_REVIEWS_ADDED);

  filters[reviewAddedField] = normalizedReviewAddedFloor;

  if (isReviewSentimentPromptFamily(promptFamily)) {
    if (promptFamily === 'review_sentiment_down') {
      filters.maxSentimentDelta = typeof filters.maxSentimentDelta === 'number'
        ? Math.min(filters.maxSentimentDelta, -REVIEW_SENTIMENT_THRESHOLD)
        : -REVIEW_SENTIMENT_THRESHOLD;
      delete filters.minSentimentDelta;
    } else {
      filters.minSentimentDelta = Math.max(filters.minSentimentDelta ?? 0, REVIEW_SENTIMENT_THRESHOLD);
      delete filters.maxSentimentDelta;
    }
  } else {
    delete filters.minSentimentDelta;
    delete filters.maxSentimentDelta;
  }

  request.filters = Object.keys(filters).length > 0 ? filters : null;
  return request;
}

function applyMomentumActivityFloorDefaults(
  request: DiscoverMomentumShadowRequest,
  promptFamily: MomentumPromptFamily | null
): DiscoverMomentumShadowRequest {
  if (
    promptFamily !== 'trending'
    && promptFamily !== 'accelerating'
    && promptFamily !== 'breaking_out'
    && promptFamily !== 'review_momentum'
    && promptFamily !== 'review_activity_up'
  ) {
    return request;
  }

  const filters: NonNullable<DiscoverMomentumShadowRequest['filters']> = {
    ...(request.filters ?? {}),
  };
  const isNarrowed = hasMomentumNarrowingScope(request);

  if (request.timeframe === '30d') {
    if (typeof filters.minReviewsAdded30d !== 'number') {
      filters.minReviewsAdded30d = isNarrowed ? 5 : 10;
    }
    delete filters.minReviewsAdded7d;
  } else if (request.timeframe !== 'current') {
    if (typeof filters.minReviewsAdded7d !== 'number') {
      filters.minReviewsAdded7d = isNarrowed ? 2 : 5;
    }
    delete filters.minReviewsAdded30d;
  }

  request.filters = Object.keys(filters).length > 0 ? filters : null;
  return request;
}

function shouldRetrySparseMomentumRequest(params: {
  explicitReviewTrendFloors?: MomentumBuildResult['explicitReviewTrendFloors'];
  policy: MomentumDiscoveryResultPolicy | null;
  promptFamily: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest;
  resultCount: number;
  sufficientToAnswer: boolean;
}): boolean {
  if (params.request.timeframe === 'current') {
    return false;
  }

  const needsMoreItems = params.policy != null
    ? params.resultCount < params.policy.minimumItems
    : !params.sufficientToAnswer;

  if (!needsMoreItems) {
    return false;
  }

  if (isReviewTrendPromptFamily(params.promptFamily)) {
    const filters = params.request.filters ?? null;
    const reviewAddedField = getReviewTrendReviewAddedField(params.request);
    const currentReviewAddedFloor = filters?.[reviewAddedField];
    const explicitFloors = params.explicitReviewTrendFloors ?? null;

    return (
      (!explicitFloors?.minReviews
        && (
          typeof filters?.minReviews !== 'number'
          || filters.minReviews === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS
          || filters.minReviews === BALANCED_REVIEW_TREND_MIN_REVIEWS
        ))
      || (
        typeof currentReviewAddedFloor !== 'number'
        || currentReviewAddedFloor === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS_ADDED
        || currentReviewAddedFloor === BALANCED_REVIEW_TREND_MIN_REVIEWS_ADDED
      )
      || (
        !explicitFloors?.minCcu
        && filters?.minCcu === MARKET_LEADING_REVIEW_TREND_MIN_CCU
      )
    );
  }

  return !params.sufficientToAnswer
    && Array.isArray(params.request.appids)
    && params.request.appids.length > 0
    && (
      params.promptFamily === 'accelerating'
      || params.promptFamily === 'breaking_out'
      || params.promptFamily === 'trending'
    );
}

function buildRelaxedSparseMomentumRequest(params: {
  explicitReviewTrendFloors?: MomentumBuildResult['explicitReviewTrendFloors'];
  promptFamily: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest;
}): DiscoverMomentumShadowRequest {
  const nextRequest: DiscoverMomentumShadowRequest = {
    ...params.request,
    filters: params.request.filters ? { ...params.request.filters } : null,
  };
  const filters: NonNullable<DiscoverMomentumShadowRequest['filters']> = {
    ...(nextRequest.filters ?? {}),
  };

  if (isReviewTrendPromptFamily(params.promptFamily)) {
    const explicitFloors = params.explicitReviewTrendFloors ?? null;
    const reviewAddedField = getReviewTrendReviewAddedField(nextRequest);
    const relaxedReviewAddedFloor = getRelaxedReviewTrendReviewAddedFloor(nextRequest);
    const currentReviewAddedFloor = filters[reviewAddedField];

    if (
      !explicitFloors?.minReviews
      && (
        typeof filters.minReviews !== 'number'
        || filters.minReviews === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS
        || filters.minReviews === BALANCED_REVIEW_TREND_MIN_REVIEWS
      )
    ) {
      filters.minReviews = RELAXED_REVIEW_TREND_MIN_REVIEWS;
    }

    if (
      typeof currentReviewAddedFloor !== 'number'
      || currentReviewAddedFloor === MARKET_LEADING_REVIEW_TREND_MIN_REVIEWS_ADDED
      || currentReviewAddedFloor === BALANCED_REVIEW_TREND_MIN_REVIEWS_ADDED
    ) {
      filters[reviewAddedField] = relaxedReviewAddedFloor;
    }

    delete filters[reviewAddedField === 'minReviewsAdded30d' ? 'minReviewsAdded7d' : 'minReviewsAdded30d'];

    if (!explicitFloors?.minCcu && filters.minCcu === MARKET_LEADING_REVIEW_TREND_MIN_CCU) {
      delete filters.minCcu;
    }
  } else if (Array.isArray(nextRequest.appids) && nextRequest.appids.length > 0) {
    nextRequest.sortBy = nextRequest.timeframe === '30d' ? 'reviews_added_30d' : 'reviews_added_7d';
    nextRequest.sortDirection = 'desc';
    nextRequest.trendType = null;
  }

  nextRequest.filters = Object.keys(filters).length > 0 ? filters : null;
  return nextRequest;
}

function inferMomentumTimeframe(
  prompt: string,
  promptFamily: MomentumPromptFamily
): '7d' | '30d' | 'current' {
  if (promptFamily === 'current_players') {
    return 'current';
  }

  if (hasExplicitPromptTimeWindow(prompt)) {
    return parsePromptDays(prompt, 30) >= 30 ? '30d' : '7d';
  }

  if (/\b(?:this week|last week|past 7 days?|over the last 7 days?)\b/i.test(prompt)) {
    return '7d';
  }

  if (/\b(?:this month|last month|past 30 days?|over the last 30 days?|lately|recently)\b/i.test(prompt)) {
    return '30d';
  }

  if (
    promptFamily === 'accelerating'
    || promptFamily === 'declining'
    || promptFamily === 'review_activity_down'
    || promptFamily === 'review_sentiment_down'
    || promptFamily === 'review_sentiment_up'
  ) {
    return '30d';
  }

  return '7d';
}

function buildMomentumPrimaryRequest(prompt: string): MomentumBuildResult {
  if (
    (inferCompareIntent(prompt) && !inferCompareTopMomentumIntent(prompt))
    || (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt) && !inferSimilarityMomentumIntent(prompt))
  ) {
    return {
      reason: 'The system does not yet combine discovery with compare or similarity prompts.',
      request: null,
    };
  }

  if (extractCompanyQueryFromPrompt(prompt) || /\b(?:publisher|developer|studio|company)\b/i.test(prompt)) {
    return {
      reason: 'The system does not handle company-specific portfolio momentum yet.',
      request: null,
    };
  }

  let promptFamily: MomentumPromptFamily | null = inferReviewTrendPromptFamily(prompt);
  let sortBy: DiscoverMomentumShadowRequest['sortBy'] | null = null;
  let sortDirection: DiscoverMomentumShadowRequest['sortDirection'] = 'desc';
  let trendType: DiscoverMomentumShadowRequest['trendType'] = null;

  if (promptFamily === 'review_sentiment_down') {
    sortBy = 'sentiment_delta';
    sortDirection = 'asc';
  } else if (promptFamily === 'review_sentiment_up') {
    sortBy = 'sentiment_delta';
    sortDirection = 'desc';
  } else if (promptFamily === 'review_activity_up') {
    sortBy = null;
    trendType = 'review_momentum';
  } else if (promptFamily === 'review_activity_down') {
    sortBy = 'velocity_acceleration';
    sortDirection = 'asc';
  } else if (MOMENTUM_PLAYER_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'current_players';
    sortBy = 'ccu_peak';
  } else if (MOMENTUM_BREAKOUT_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'breaking_out';
    sortBy = 'momentum_score';
    trendType = 'breaking_out';
  } else if (MOMENTUM_ACCELERATING_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'accelerating';
    sortBy = 'velocity_acceleration';
    trendType = 'accelerating';
  } else if (MOMENTUM_DECLINING_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'declining';
    sortBy = 'velocity_acceleration';
    sortDirection = 'asc';
    trendType = 'declining';
  } else if (MOMENTUM_REVIEW_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'review_momentum';
    trendType = 'review_momentum';
  } else if (MOMENTUM_TRENDING_PROMPT_PATTERN.test(prompt)) {
    promptFamily = 'trending';
    sortBy = 'momentum_score';
  } else if (looksLikeRecentConceptRankingPrompt(prompt)) {
    promptFamily = 'trending';
    sortBy = 'momentum_score';
  }

  if (!promptFamily) {
    return {
      reason: 'The system could not infer a stable momentum query from the prompt.',
      request: null,
    };
  }

  const timeframe = inferMomentumTimeframe(prompt, promptFamily);
  if (!sortBy) {
    sortBy = promptFamily === 'review_momentum' || promptFamily === 'review_activity_up'
      ? timeframe === '30d'
        ? 'reviews_added_30d'
        : 'reviews_added_7d'
      : 'momentum_score';
  }

  const platforms = extractPrimaryPlatforms(prompt);
  const steamDeck = extractMomentumSteamDeck(prompt);
  const tags = extractMomentumTags(prompt);
  const releaseYear = extractPrimaryReleaseYear(prompt);
  const maxPriceCents = extractMomentumMaxPriceCents(prompt);
  const minReviewScore = extractMomentumReviewThreshold(prompt);
  const minReviews = extractMomentumMinReviews(prompt);
  const minCcu = extractMomentumMinCcu(prompt);
  const isFree =
    /\b(?:free-to-play|free to play)\b/i.test(prompt)
      ? true
      : /\bpremium games?\b/i.test(prompt)
        ? false
        : undefined;
  const filters: NonNullable<DiscoverMomentumShadowRequest['filters']> = {
    ...(platforms.length > 0 ? { platforms } : {}),
    ...(steamDeck ? { steamDeck } : {}),
    ...(tags ? { tags } : {}),
    ...(releaseYear ? { releaseYear } : {}),
    ...(maxPriceCents != null ? { maxPriceCents } : {}),
    ...(minReviewScore != null ? { minReviewScore } : {}),
    ...(minReviews != null ? { minReviews } : {}),
    ...(minCcu != null ? { minCcu } : {}),
    ...(isFree != null ? { isFree } : {}),
  };

  const request: DiscoverMomentumShadowRequest = {
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...( /\bindie\b/i.test(prompt) ? { indieHeuristic: true } : {}),
    limit: extractRequestedTopCount(prompt, 10, 20),
    sortBy,
    sortDirection,
    timeframe,
    trendType,
  };

  return {
    explicitReviewTrendFloors: {
      minCcu: minCcu != null,
      minReviews: minReviews != null,
    },
    momentumPromptFamily: promptFamily,
    request: applyMomentumActivityFloorDefaults(
      applyReviewTrendPopularityDefaults(prompt, request, promptFamily),
      promptFamily
    ),
  };
}

function buildRequestPreviewItems(
  response: RankEntitiesResponse | DiscoverMomentumResponse
): SessionChatRequestPreviewItem[] {
  if (Array.isArray((response as RankEntitiesResponse).items) && 'metric' in response) {
    const items = ((response as RankEntitiesResponse).items ?? []) as Array<{
      displayName?: string | null;
      entityUid?: string | null;
      platformEntityId?: string | number | null;
    }>;
    return items.slice(0, 10).map((item, index) => {
      const label = typeof item.displayName === 'string' && item.displayName.trim().length > 0
        ? item.displayName
        : `Result ${index + 1}`;

      return {
        entityUid: item.entityUid ?? null,
        label,
        ordinal: index + 1,
        platformEntityId: item.platformEntityId ?? null,
      };
    });
  }

  const items = ((response as DiscoverMomentumResponse).items ?? []) as Array<{
    appid?: number | null;
    entityUid?: string | null;
    name?: string | null;
  }>;
  return items.slice(0, 10).map((item, index) => {
    const label = typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name
      : `Result ${index + 1}`;

    return {
      entityUid: item.entityUid ?? null,
      label,
      ordinal: index + 1,
      platformEntityId: item.appid ?? null,
    };
  });
}

function stripMomentumContinuationArgs(
  request: DiscoverMomentumShadowRequest
): DiscoverMomentumShadowRequest {
  const next = deepCloneRecord(request);
  delete next.excludeAppIds;
  return next;
}

function buildPrimaryRequestState(params: {
  intent: 'entity_ranking' | 'momentum_discovery';
  momentumPromptFamily?: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest | RankEntitiesShadowRequest;
  response: DiscoverMomentumResponse | RankEntitiesResponse;
  timestamp?: string;
}): SessionChatRequestState {
  const timestamp = params.timestamp ?? new Date().toISOString();

  if (params.intent === 'entity_ranking') {
    const request = params.request as RankEntitiesShadowRequest;
    return {
      canonicalArgs: deepCloneRecord(request),
      contractName: 'rankEntities',
      entityKind: request.entityKind,
      family: 'entity_ranking',
      metric: request.metric,
      previewItems: buildRequestPreviewItems(params.response as RankEntitiesResponse),
      updatedAt: timestamp,
    };
  }

  const request = stripMomentumContinuationArgs(params.request as DiscoverMomentumShadowRequest);
  return {
    canonicalArgs: request,
    contractName: 'discoverMomentum',
    entityKind: 'game',
    family: 'momentum_discovery',
    metric: request.sortBy,
    momentumPromptFamily: params.momentumPromptFamily ?? inferMomentumRequestFamily(request),
    previewItems: buildRequestPreviewItems(params.response as DiscoverMomentumResponse),
    timeframe: request.timeframe ?? null,
    trendType: request.trendType ?? null,
    updatedAt: timestamp,
  };
}

function inferRankingMetricPivot(
  prompt: string,
  entityKind: RankEntitiesShadowRequest['entityKind']
): RankEntitiesShadowRequest['metric'] | null {
  const tokens = tokenizeFollowUpPrompt(prompt);

  if (
    includesApproxPhrase(tokens, ['review', 'score'])
    || includesApproxPhrase(tokens, ['best', 'rated'])
    || includesApproxPhrase(tokens, ['highest', 'rated'])
  ) {
    return 'review_score';
  }

  if (
    includesApproxPhrase(tokens, ['total', 'reviews'])
    || includesApproxPhrase(tokens, ['reviews'])
  ) {
    return 'total_reviews';
  }

  if (
    includesApproxPhrase(tokens, ['ccu'])
    || includesApproxPhrase(tokens, ['peak', 'ccu'])
    || includesApproxPhrase(tokens, ['concurrent', 'players'])
    || includesApproxPhrase(tokens, ['players', 'right', 'now'])
  ) {
    return 'ccu_peak';
  }

  if (
    entityKind !== 'game'
    && (
      includesApproxPhrase(tokens, ['game', 'count'])
      || includesApproxPhrase(tokens, ['most', 'games'])
      || includesApproxPhrase(tokens, ['catalog', 'size'])
    )
  ) {
    return 'game_count';
  }

  if (
    includesApproxPhrase(tokens, ['owners'])
    || includesApproxPhrase(tokens, ['biggest'])
    || includesApproxPhrase(tokens, ['largest'])
    || includesApproxPhrase(tokens, ['most', 'popular'])
  ) {
    return 'owners_midpoint';
  }

  return null;
}

function inferMomentumPivot(
  prompt: string,
  currentTimeframe: DiscoverMomentumShadowRequest['timeframe']
): (Pick<DiscoverMomentumShadowRequest, 'sortBy' | 'sortDirection' | 'timeframe' | 'trendType'> & {
  promptFamily?: MomentumPromptFamily | null;
}) | null {
  const tokens = tokenizeFollowUpPrompt(prompt);
  const reviewTrendFamily = inferReviewTrendPromptFamily(prompt);

  if (reviewTrendFamily) {
    const timeframe = inferMomentumTimeframe(prompt, reviewTrendFamily) === '30d' ? '30d' : '7d';

    if (reviewTrendFamily === 'review_sentiment_down') {
      return {
        promptFamily: reviewTrendFamily,
        sortBy: 'sentiment_delta',
        sortDirection: 'asc',
        timeframe,
        trendType: null,
      };
    }

    if (reviewTrendFamily === 'review_sentiment_up') {
      return {
        promptFamily: reviewTrendFamily,
        sortBy: 'sentiment_delta',
        sortDirection: 'desc',
        timeframe,
        trendType: null,
      };
    }

    if (reviewTrendFamily === 'review_activity_down') {
      return {
        promptFamily: reviewTrendFamily,
        sortBy: 'velocity_acceleration',
        sortDirection: 'asc',
        timeframe,
        trendType: null,
      };
    }

    return {
      promptFamily: reviewTrendFamily,
      sortBy: timeframe === '30d' ? 'reviews_added_30d' : 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe,
      trendType: 'review_momentum',
    };
  }

  if (
    includesApproxPhrase(tokens, ['ccu'])
    || includesApproxPhrase(tokens, ['peak', 'ccu'])
    || includesApproxPhrase(tokens, ['concurrent', 'players'])
    || includesApproxPhrase(tokens, ['players', 'right', 'now'])
  ) {
    return {
      promptFamily: 'current_players',
      sortBy: 'ccu_peak',
      sortDirection: 'desc',
      timeframe: 'current',
      trendType: null,
    };
  }

  if (
    includesApproxPhrase(tokens, ['review', 'score'])
    || includesApproxPhrase(tokens, ['best', 'rated'])
    || includesApproxPhrase(tokens, ['highest', 'rated'])
  ) {
    return {
      sortBy: 'review_score',
      sortDirection: 'desc',
      timeframe: currentTimeframe ?? '7d',
      trendType: null,
    };
  }

  if (
    includesApproxPhrase(tokens, ['total', 'reviews'])
    || includesApproxPhrase(tokens, ['by', 'reviews'])
  ) {
    return {
      sortBy: 'total_reviews',
      sortDirection: 'desc',
      timeframe: currentTimeframe ?? '7d',
      trendType: null,
    };
  }

  if (
    includesApproxPhrase(tokens, ['breaking', 'out'])
  ) {
    return {
      promptFamily: 'breaking_out',
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: currentTimeframe === 'current' ? '7d' : (currentTimeframe ?? '7d'),
      trendType: 'breaking_out',
    };
  }

  if (
    includesApproxPhrase(tokens, ['accelerating'])
  ) {
    return {
      promptFamily: 'accelerating',
      sortBy: 'velocity_acceleration',
      sortDirection: 'desc',
      timeframe: currentTimeframe === 'current' ? '30d' : (currentTimeframe ?? '30d'),
      trendType: 'accelerating',
    };
  }

  if (
    includesApproxPhrase(tokens, ['declining'])
    || includesApproxPhrase(tokens, ['trending', 'down'])
  ) {
    return {
      promptFamily: 'declining',
      sortBy: 'velocity_acceleration',
      sortDirection: 'asc',
      timeframe: currentTimeframe === 'current' ? '30d' : (currentTimeframe ?? '30d'),
      trendType: 'declining',
    };
  }

  if (
    includesApproxPhrase(tokens, ['review', 'momentum'])
    || includesApproxPhrase(tokens, ['reviews', 'surging'])
  ) {
    const timeframe = currentTimeframe === '30d' ? '30d' : '7d';
    return {
      promptFamily: 'review_momentum',
      sortBy: timeframe === '30d' ? 'reviews_added_30d' : 'reviews_added_7d',
      sortDirection: 'desc',
      timeframe,
      trendType: 'review_momentum',
    };
  }

  if (
    includesApproxPhrase(tokens, ['trending'])
    || includesApproxPhrase(tokens, ['gaining', 'traction'])
    || includesApproxPhrase(tokens, ['hot', 'right', 'now'])
  ) {
    return {
      promptFamily: 'trending',
      sortBy: 'momentum_score',
      sortDirection: 'desc',
      timeframe: currentTimeframe === 'current' ? '7d' : (currentTimeframe ?? '7d'),
      trendType: null,
    };
  }

  return null;
}

function inferPivotLimit(prompt: string, fallback: number): number | null {
  const explicitTop = prompt.match(/\btop\s+(\d{1,2})\b/i);
  if (explicitTop) {
    return extractRequestedTopCount(prompt, fallback, 20);
  }

  const normalized = normalizeFollowUpPrompt(prompt);
  const ordinalCount = normalized.match(/\b(?:first|top)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (ordinalCount) {
    return REQUEST_PIVOT_ORDINAL_WORDS[ordinalCount[1]?.toLowerCase() ?? ''] ?? null;
  }

  return null;
}

function inferPivotTimeframe(prompt: string): DiscoverMomentumShadowRequest['timeframe'] | null {
  const tokens = tokenizeFollowUpPrompt(prompt);
  if (
    includesApproxPhrase(tokens, ['right', 'now'])
    || includesApproxPhrase(tokens, ['currently'])
    || includesApproxPhrase(tokens, ['today'])
  ) {
    return 'current';
  }

  if (includesApproxPhrase(tokens, ['this', 'week'])) {
    return '7d';
  }

  if (
    includesApproxPhrase(tokens, ['this', 'month'])
    || includesApproxPhrase(tokens, ['last', '30', 'days'])
    || includesApproxPhrase(tokens, ['past', '30', 'days'])
  ) {
    return '30d';
  }

  return null;
}

function inferApproxPlatforms(prompt: string): string[] {
  const tokens = tokenizeFollowUpPrompt(prompt);
  const platforms: string[] = [];

  if (includesApproxPhrase(tokens, ['windows'])) {
    platforms.push('windows');
  }
  if (includesApproxPhrase(tokens, ['mac']) || includesApproxPhrase(tokens, ['macos'])) {
    platforms.push('macos');
  }
  if (includesApproxPhrase(tokens, ['linux'])) {
    platforms.push('linux');
  }

  return platforms;
}

function inferApproxSteamDeck(prompt: string): Array<'playable' | 'verified'> | undefined {
  const tokens = tokenizeFollowUpPrompt(prompt);
  if (
    includesApproxPhrase(tokens, ['steam', 'deck', 'verified'])
    || includesApproxPhrase(tokens, ['deck', 'verified'])
  ) {
    return ['verified'];
  }

  if (
    includesApproxPhrase(tokens, ['steam', 'deck', 'playable'])
    || includesApproxPhrase(tokens, ['deck', 'playable'])
  ) {
    return ['playable'];
  }

  return undefined;
}

function inferApproxFreeFlag(prompt: string): boolean | null {
  const tokens = tokenizeFollowUpPrompt(prompt);
  if (
    includesApproxPhrase(tokens, ['free', 'to', 'play'])
    || includesApproxPhrase(tokens, ['f2p'])
  ) {
    return true;
  }

  if (includesApproxPhrase(tokens, ['premium'])) {
    return false;
  }

  return null;
}

function findPreviewMatches(
  prompt: string,
  requestState: SessionChatRequestState,
  maxMatches = 2
): RequestPivotPreviewMatch[] {
  const matches = new Map<number, RequestPivotPreviewMatch>();
  const normalizedPrompt = normalizeForLooseMatch(prompt);

  const hashMatches = [...prompt.matchAll(/#(\d{1,2})/g)];
  for (const match of hashMatches) {
    const ordinal = Number.parseInt(match[1] ?? '', 10);
    const item = requestState.previewItems.find((candidate) => candidate.ordinal === ordinal);
    if (item) {
      matches.set(ordinal, { item, ordinal });
    }
  }

  for (const [word, ordinal] of Object.entries(REQUEST_PIVOT_ORDINAL_WORDS)) {
    if (
      new RegExp(`\\b(?:top|the|#)?\\s*${word}\\b`, 'i').test(prompt)
      || new RegExp(`\\b${word}\\s+one\\b`, 'i').test(prompt)
    ) {
      const item = requestState.previewItems.find((candidate) => candidate.ordinal === ordinal);
      if (item) {
        matches.set(ordinal, { item, ordinal });
      }
    }
  }

  if (
    /\b(?:top|first)\s+two\b/i.test(prompt)
    || /\btop\s+2\b/i.test(prompt)
  ) {
    for (const ordinal of [1, 2]) {
      const item = requestState.previewItems.find((candidate) => candidate.ordinal === ordinal);
      if (item) {
        matches.set(ordinal, { item, ordinal });
      }
    }
  }

  if (matches.size === 0) {
    for (const item of requestState.previewItems) {
      const normalizedLabel = normalizeForLooseMatch(item.label);
      if (normalizedLabel && normalizedPrompt.includes(normalizedLabel)) {
        matches.set(item.ordinal, { item, ordinal: item.ordinal });
      }
    }
  }

  return [...matches.values()]
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(0, maxMatches);
}

function buildRankingPivotRequest(
  prompt: string,
  requestState: SessionChatRequestState
): RankEntitiesShadowRequest | null {
  const current = deepCloneRecord(requestState.canonicalArgs as RankEntitiesShadowRequest & {
    catalogFilters?: {
      isFree?: boolean | null;
      maxPriceCents?: number | null;
      minReviewScore?: number | null;
      minReviews?: number | null;
      platforms?: string[];
      releaseYear?: {
        gte?: number | null;
        lte?: number | null;
      } | null;
      tags?: string[];
    } | null;
  });
  let changed = false;

  const metric = inferRankingMetricPivot(prompt, current.entityKind);
  if (metric && metric !== current.metric) {
    current.metric = metric;
    changed = true;
  }

  const limit = inferPivotLimit(prompt, current.limit ?? 10);
  if (limit != null && limit !== current.limit) {
    current.limit = limit;
    changed = true;
  }

  const platforms = inferApproxPlatforms(prompt);
  if (platforms.length > 0) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      platforms,
    };
    changed = true;
  }

  const isFree = inferApproxFreeFlag(prompt);
  if (isFree != null) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      isFree,
    };
    changed = true;
  }

  const maxPriceCents = extractMomentumMaxPriceCents(prompt);
  if (maxPriceCents != null) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      maxPriceCents,
    };
    changed = true;
  }

  const minReviewScore = extractMomentumReviewThreshold(prompt);
  if (minReviewScore != null) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      minReviewScore,
    };
    changed = true;
  }

  const minReviews = extractMomentumMinReviews(prompt);
  if (minReviews != null) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      minReviews,
    };
    changed = true;
  }

  const tags = extractMomentumTags(prompt);
  if (tags && tags.length > 0) {
    current.catalogFilters = {
      ...(current.catalogFilters ?? {}),
      tags,
    };
    changed = true;
  }

  if (!changed) {
    return null;
  }

  return current;
}

function buildMomentumPivotRequest(
  prompt: string,
  requestState: SessionChatRequestState
): {
  momentumPromptFamily: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest;
} | null {
  const current = deepCloneRecord(requestState.canonicalArgs as DiscoverMomentumShadowRequest);
  const previousPromptFamily = requestState.momentumPromptFamily ?? inferMomentumRequestFamily(current);
  let nextPromptFamily = previousPromptFamily;
  let changed = false;

  const pivot = inferMomentumPivot(prompt, current.timeframe);
  if (pivot) {
    current.sortBy = pivot.sortBy;
    current.sortDirection = pivot.sortDirection;
    current.timeframe = pivot.timeframe;
    current.trendType = pivot.trendType;
    if (pivot.promptFamily) {
      nextPromptFamily = pivot.promptFamily;
    }
    changed = true;
  }

  const timeframe = inferPivotTimeframe(prompt);
  if (timeframe && timeframe !== current.timeframe) {
    current.timeframe = timeframe;
    changed = true;
    if (timeframe === 'current' && current.sortBy !== 'ccu_peak') {
      current.sortBy = 'ccu_peak';
      current.trendType = null;
      current.sortDirection = 'desc';
      nextPromptFamily = 'current_players';
    }
  }

  const limit = inferPivotLimit(prompt, current.limit ?? 10);
  if (limit != null && limit !== current.limit) {
    current.limit = limit;
    changed = true;
  }

  const platforms = inferApproxPlatforms(prompt);
  if (platforms.length > 0) {
    current.filters = {
      ...(current.filters ?? {}),
      platforms,
    };
    changed = true;
  }

  const steamDeck = inferApproxSteamDeck(prompt);
  if (steamDeck?.length) {
    current.filters = {
      ...(current.filters ?? {}),
      steamDeck,
    };
    changed = true;
  }

  const isFree = inferApproxFreeFlag(prompt);
  if (isFree != null) {
    current.filters = {
      ...(current.filters ?? {}),
      isFree,
    };
    changed = true;
  }

  const maxPriceCents = extractMomentumMaxPriceCents(prompt);
  if (maxPriceCents != null) {
    current.filters = {
      ...(current.filters ?? {}),
      maxPriceCents,
    };
    changed = true;
  }

  const minReviewScore = extractMomentumReviewThreshold(prompt);
  if (minReviewScore != null) {
    current.filters = {
      ...(current.filters ?? {}),
      minReviewScore,
    };
    changed = true;
  }

  const minReviews = extractMomentumMinReviews(prompt);
  if (minReviews != null) {
    current.filters = {
      ...(current.filters ?? {}),
      minReviews,
    };
    changed = true;
  }

  const minCcu = extractMomentumMinCcu(prompt);
  if (minCcu != null) {
    current.filters = {
      ...(current.filters ?? {}),
      minCcu,
    };
    changed = true;
  }

  const tags = extractMomentumTags(prompt);
  if (tags && tags.length > 0) {
    current.filters = {
      ...(current.filters ?? {}),
      tags,
    };
    changed = true;
  }

  const releaseYear = extractPrimaryReleaseYear(prompt);
  if (releaseYear) {
    current.filters = {
      ...(current.filters ?? {}),
      releaseYear,
    };
    changed = true;
  }

  if (/\bindie\b/i.test(prompt)) {
    current.indieHeuristic = true;
    changed = true;
  }

  if (!changed) {
    return null;
  }

  if (current.filters) {
    const switchedAwayFromReviewTrend =
      isReviewTrendPromptFamily(previousPromptFamily) && !isReviewTrendPromptFamily(nextPromptFamily);
    if (switchedAwayFromReviewTrend) {
      clearReviewTrendSpecificFilters(current.filters);
    }
  }

  if (isReviewTrendPromptFamily(nextPromptFamily)) {
    applyReviewTrendPopularityDefaults(prompt, current, nextPromptFamily);
  }

  return {
    momentumPromptFamily: nextPromptFamily,
    request: current,
  };
}

function resolveRequestPreviewDrillDown(
  prompt: string,
  requestState: SessionChatRequestState
): RequestPivotResolution | null {
  const matches = findPreviewMatches(prompt, requestState, 2);
  if (matches.length === 0) {
    return null;
  }

  if (inferCompareIntent(prompt) && matches.length >= 2) {
    const entityUids = matches
      .map((match) => match.item.entityUid)
      .filter((entityUid): entityUid is string => Boolean(entityUid));
    if (entityUids.length >= 2) {
      return {
        compareRequestOverride: {
          entityUids: entityUids.slice(0, 2),
          ...(extractCompareMetrics(prompt).length > 0
            ? { metrics: extractCompareMetrics(prompt) }
            : {}),
        },
        matchedIntent: 'entity_compare',
      };
    }
  }

  const target = matches[0]?.item;
  if (!target) {
    return null;
  }

  if (CHANGE_PROMPT_PATTERN.test(prompt)) {
    return { entityQuery: target.label, matchedIntent: 'change_explanation' };
  }

  if (NEWS_PROMPT_PATTERN.test(prompt)) {
    return { entityQuery: target.label, matchedIntent: 'news_search' };
  }

  if (METRIC_HISTORY_PROMPT_PATTERN.test(prompt)) {
    return { entityQuery: target.label, matchedIntent: 'metric_history' };
  }

  if (/^(?:and\s+)?(?:what|how)\s+about\b/i.test(prompt) || /\btell me about\b/i.test(prompt)) {
    return { entityQuery: target.label, matchedIntent: 'entity_overview' };
  }

  return null;
}

function resolveRequestStatePivotFollowUp(
  prompt: string,
  requestState: SessionChatRequestState | null | undefined
): RequestPivotResolution | null {
  if (!requestState) {
    return null;
  }

  const drillDown = resolveRequestPreviewDrillDown(prompt, requestState);
  if (drillDown) {
    return drillDown;
  }

  if (requestState.family === 'entity_ranking') {
    const requestOverride = buildRankingPivotRequest(prompt, requestState);
    return requestOverride
      ? {
          matchedIntent: 'entity_ranking',
          requestOverride,
        }
      : null;
  }

  if (requestState.family === 'momentum_discovery') {
    const momentumOverride = buildMomentumPivotRequest(prompt, requestState);
    return momentumOverride
      ? {
          matchedIntent: 'momentum_discovery',
          momentumPromptFamily: momentumOverride.momentumPromptFamily,
          requestOverride: momentumOverride.request,
        }
      : null;
  }

  return null;
}

function extractCatalogFacetKind(
  prompt: string
): 'categories' | 'genres' | 'tags' | null {
  if (/\bcategories?\b/i.test(prompt)) {
    return 'categories';
  }
  if (/\bgenres?\b/i.test(prompt)) {
    return 'genres';
  }
  if (/\btags?\b/i.test(prompt)) {
    return 'tags';
  }

  return null;
}

function extractCatalogFacetQuery(prompt: string): string | null {
  const match = prompt.match(/\b(?:for|in)\s+(.+?)(?:\s+games?\b|[?!.]|$)/i)
    ?? prompt.match(/\b(?:what|which|show|list|find)\b.*\b(?:tags?|genres?|categories)\b.*\b(?:for|in)\s+(.+?)(?:[?!.]|$)/i);
  return normalizeEntityQuery(match?.[1] ?? null);
}

function buildCatalogSearchPrimaryRequests(prompt: string): CatalogPrimaryBuildResult {
  const normalized = prompt.toLowerCase();
  const limit = extractRequestedTopCount(prompt, 20);
  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop)\b/.test(normalized)) {
    return {
      reason: 'The system does not support that discovery constraint yet.',
      requests: [],
    };
  }

  if (inferCatalogFacetIntent(prompt)) {
    const facetKind = extractCatalogFacetKind(prompt);
    const facetQuery = extractCatalogFacetQuery(prompt);
    if (!facetKind || !facetQuery) {
      return {
        reason: 'The system could not infer which facet list to enumerate.',
        requests: [],
      };
    }

    return {
      requests: [{
        facetQuery,
        includeFacets: [facetKind],
        limit: Math.min(limit, 12),
      }],
    };
  }

  const companyQuery = extractCompanyQueryFromPrompt(prompt);
  if (companyQuery) {
    const sortBy = /\b(?:top|best)\b/i.test(prompt) ? 'reviews' : 'release_date';
    return {
      requests: [
        {
          developerQuery: companyQuery,
          limit,
          sortBy,
          sortDirection: 'desc',
        },
        {
          publisherQuery: companyQuery,
          limit,
          sortBy,
          sortDirection: 'desc',
        },
      ],
    };
  }

  const platforms = extractPrimaryPlatforms(prompt);
  const releaseYear = extractPrimaryReleaseYear(prompt);
  const tags = extractMomentumTags(prompt);
  const minReviewScore =
    /\boverwhelmingly positive\b/i.test(prompt)
      ? 95
      : /\bhighly rated\b/i.test(prompt)
        ? 85
        : /\bgreat reviews?\b/i.test(prompt)
          ? 80
          : undefined;
  const minReviews = minReviewScore != null ? 1000 : undefined;
  const maxPriceMatch = prompt.match(/\bunder\s+\$?(\d{1,4})(?:\.\d{1,2})?\b/i);
  const maxPriceCents = maxPriceMatch
    ? Math.round(Number.parseFloat(maxPriceMatch[1] ?? '0') * 100)
    : undefined;
  const minPriceCents = extractMinimumPriceCents(prompt) ?? undefined;
  const onSale = /\bon sale\b/i.test(prompt) ? true : undefined;
  const isFree = /\bpremium games?\b/i.test(prompt) ? false : undefined;

  if (
    !platforms.length
    && !releaseYear
    && !tags
    && minReviewScore == null
    && maxPriceCents == null
    && minPriceCents == null
    && !onSale
    && isFree == null
  ) {
    return {
      reason: 'The system could not infer a supported search request from the prompt.',
      requests: [],
    };
  }

  return {
    requests: [{
      ...(platforms.length > 0 ? { platforms } : {}),
      ...(releaseYear ? { releaseYear } : {}),
      ...(tags ? { tags } : {}),
      ...(minReviewScore != null ? { minReviewScore, minReviews } : {}),
      ...(maxPriceCents != null ? { maxPriceCents } : {}),
      ...(minPriceCents != null ? { minPriceCents } : {}),
      ...(onSale ? { onSale } : {}),
      ...(isFree != null ? { isFree } : {}),
      limit,
      sortBy: 'reviews',
      sortDirection: 'desc',
    }],
  };
}

function normalizeEntityKindHint(
  prompt: string
): SemanticSearchShadowRequest['entityKind'] | null {
  const normalized = prompt.toLowerCase();
  if (/\bpublishers?\b/.test(normalized)) {
    return 'publisher';
  }
  if (/\bdevelopers?\b|\bstudios?\b/.test(normalized)) {
    return 'developer';
  }

  return null;
}

function extractSemanticFilters(prompt: string): SemanticSearchShadowRequest['filters'] | undefined {
  const filters: NonNullable<SemanticSearchShadowRequest['filters']> = {};
  const platforms = extractPrimaryPlatforms(prompt) as Array<'windows' | 'macos' | 'linux'>;

  if (platforms.length > 0) {
    filters.platforms = platforms;
  }

  const maxPriceMatch = prompt.match(/\bunder\s+\$?(\d{1,4})(?:\.\d{1,2})?\b/i);
  if (maxPriceMatch) {
    filters.max_price_cents = Math.round(Number.parseFloat(maxPriceMatch[1] ?? '0') * 100);
  }

  if (/\bsteam deck verified\b/i.test(prompt)) {
    filters.steam_deck = ['verified'];
  } else if (/\bsteam deck playable\b/i.test(prompt)) {
    filters.steam_deck = ['playable'];
  }

  if (/\bfree to play\b|\bfree games?\b/i.test(prompt)) {
    filters.is_free = true;
  }

  const minReviews = extractMomentumMinReviews(prompt);
  if (minReviews != null) {
    filters.min_reviews = minReviews;
  }

  const maxReviews = extractMomentumMaxReviews(prompt);
  if (maxReviews != null) {
    filters.max_reviews = maxReviews;
  }

  const tags = extractMomentumTags(prompt);
  if (tags && tags.length > 0) {
    filters.tags = tags;
    filters.top_tags = tags;
  }

  if (/\bbetter reviews?\b|\bbetter review score\b/i.test(prompt)) {
    filters.review_comparison = 'better_only';
  } else if (/\bsimilar or better reviews?\b/i.test(prompt)) {
    filters.review_comparison = 'similar_or_better';
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function countSemanticPromptFilters(
  filters: SemanticSearchShadowRequest['filters'] | undefined
): number {
  if (!filters) {
    return 0;
  }

  let count = 0;
  if (filters.platforms?.length) {
    count += 1;
  }
  if (typeof filters.max_price_cents === 'number') {
    count += 1;
  }
  if (filters.steam_deck?.length) {
    count += 1;
  }
  if (typeof filters.is_free === 'boolean') {
    count += 1;
  }
  if (typeof filters.min_reviews === 'number' || typeof filters.max_reviews === 'number') {
    count += 1;
  }
  if (filters.tags?.length) {
    count += 1;
  }
  if (filters.review_comparison && filters.review_comparison !== 'any') {
    count += 1;
  }

  return count;
}

function resolveSemanticPromptLimit(
  filters: SemanticSearchShadowRequest['filters'] | undefined
): number {
  const narrowingCount = countSemanticPromptFilters(filters);
  const reviewConstrained = filters?.review_comparison != null && filters.review_comparison !== 'any';
  if (reviewConstrained) {
    return narrowingCount >= 2 ? 12 : 10;
  }
  if (narrowingCount >= 2) {
    return 10;
  }
  if (narrowingCount === 1) {
    return 8;
  }

  return 6;
}

function stripSemanticLeadIn(prompt: string): string {
  return prompt
    .replace(/^(?:show|find|give|recommend)\s+me\s+/i, '')
    .replace(/^(?:show|find|give|recommend)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
}

function extractSemanticReferenceQuery(prompt: string): string | null {
  const match =
    prompt.match(/\bgames?\s+(?:like|similar to)\s+(.+?)(?:\s+(?:with|that|which|who|from)\b|[?!.]|$)/i) ??
    prompt.match(/\b(?:publishers?|developers?|studios?)\s+(?:like|similar to)\s+(.+?)(?:\s+(?:with|that|which|who|from)\b|[?!.]|$)/i) ??
    prompt.match(/\b(?:like|similar to)\s+(.+?)(?:\s+(?:with|that|which|who|from)\b|[?!.]|$)/i);

  return normalizeEntityQuery(match?.[1] ?? null);
}

function buildSemanticRequestFromPrompt(
  prompt: string,
  options?: {
    allowMomentumMix?: boolean;
  }
): { reason?: string; request: SemanticSearchShadowRequest | null } {
  if (SAME_FRANCHISE_PATTERN.test(prompt)) {
    return {
      request: null,
      reason: 'The system does not support same-franchise semantic filtering yet.',
    };
  }

  if (
    !options?.allowMomentumMix &&
    UNSUPPORTED_SEMANTIC_MIXED_PATTERN.test(prompt)
    && (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt) || inferPrimarySemanticIntent(prompt))
  ) {
    return {
      request: null,
      reason: 'The system does not yet combine similarity or concept search with momentum-style ranking constraints.',
    };
  }

  const entityKindHint = normalizeEntityKindHint(prompt);
  const filters = extractSemanticFilters(prompt);

  if (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)) {
    const referenceQuery = extractSemanticReferenceQuery(prompt);
    if (!referenceQuery) {
      return {
        request: null,
        reason: 'The system could not infer a stable similarity reference from the prompt.',
      };
    }

    return {
      request: {
        entityKind: entityKindHint ?? 'game',
        filters,
        limit: resolveSemanticPromptLimit(filters),
        mode: 'similarity',
        referenceQuery,
      },
    };
  }

  if (!inferPrimarySemanticIntent(prompt)) {
    return {
      request: null,
      reason: 'The system could not infer a supported concept request from the prompt.',
    };
  }

  const description = stripSemanticLeadIn(prompt);
  return {
    request: {
      description,
      entityKind: 'game',
      filters,
      limit: 8,
      mode: 'concept',
    },
  };
}

function buildSemanticSearchShadowRequest(params: {
  prompt: string;
  toolCalls: ChatToolCall[];
}): { reason?: string; request: SemanticSearchShadowRequest | null } {
  const lastSemanticToolCall = pickLastToolCall(params.toolCalls, ['find_similar', 'search_by_concept']);
  const args = isRecord(lastSemanticToolCall?.arguments) ? lastSemanticToolCall.arguments : null;

  if (lastSemanticToolCall?.name === 'find_similar' && args) {
    const entityType = typeof args.entity_type === 'string' ? args.entity_type : 'game';
    if (entityType !== 'game' && entityType !== 'publisher' && entityType !== 'developer') {
      return buildSemanticRequestFromPrompt(params.prompt);
    }

    return {
      request: {
        entityKind: entityType,
        filters: isRecord(args.filters) ? args.filters as SemanticSearchShadowRequest['filters'] : undefined,
        limit: normalizeLimit(normalizeNumber(args.limit) ?? undefined, 6),
        mode: 'similarity',
        referencePlatformEntityId:
          normalizeNumber(args.reference_id) != null
            ? String(normalizeNumber(args.reference_id))
            : null,
        referenceQuery: typeof args.reference_name === 'string' ? args.reference_name.trim() : null,
      },
    };
  }

  if (lastSemanticToolCall?.name === 'search_by_concept' && args && typeof args.description === 'string') {
    return {
      request: {
        description: args.description.trim(),
        entityKind: 'game',
        filters: isRecord(args.filters) ? args.filters as SemanticSearchShadowRequest['filters'] : undefined,
        limit: normalizeLimit(normalizeNumber(args.limit) ?? undefined, 8),
        mode: 'concept',
      },
    };
  }

  return buildSemanticRequestFromPrompt(params.prompt);
}

function normalizeCompareToken(value: string): string {
  return value
    .replace(/^(?:games?|publishers?|developers?|studios?)\s+/i, '')
    .replace(/\b(?:stack up|head to head)\b/gi, '')
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .trim();
}

function stripCompareLeadIn(prompt: string): string {
  return prompt
    .replace(/[?!.]+$/, '')
    .replace(/^compare\s+/i, '')
    .replace(/^how do(?:es)?\s+(?:the\s+)?/i, '')
    .replace(/\s+\bcompare\b$/i, '')
    .replace(/\b(?:stack up|head to head)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCompareMetricClauseStart(prompt: string): number | null {
  const match = /\s+(?:by|on|for)\s+(.+)$/i.exec(prompt);
  if (!match || typeof match.index !== 'number') {
    return null;
  }

  const metricText = (match[1] ?? '').trim();
  if (!metricText) {
    return null;
  }

  if (
    /\b(?:reviews?|review count|review score|rating|ratings|owners?|audience size|player base|ccu|concurrent players?|players right now|game count|catalog size|how many games|most games|review velocity|reviews? added|momentum|accelerating|declining|sustained response|before and after)\b/i.test(
      metricText
    )
  ) {
    return match.index;
  }

  return null;
}

function parseCompareEntities(prompt: string): string[] {
  const compareBody = stripCompareLeadIn(prompt);
  const metricClauseStart = findCompareMetricClauseStart(compareBody);
  const explicitBody = (
    metricClauseStart == null ? compareBody : compareBody.slice(0, metricClauseStart)
  ).trim();

  if (/^top\s+\d{1,2}\b/i.test(explicitBody)) {
    return [];
  }

  const separatorsPattern = /\s+vs\.?\s+|\s+versus\s+|\s+and\s+|\s+to\s+|,\s*/i;
  if (!separatorsPattern.test(explicitBody)) {
    const single = normalizeCompareToken(explicitBody);
    return single ? [single] : [];
  }

  return explicitBody
    .replace(/\s+vs\.?\s+/gi, ',')
    .replace(/\s+versus\s+/gi, ',')
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s+to\s+/gi, ',')
    .split(',')
    .map((part) => normalizeCompareToken(part))
    .filter((part) => part.length > 0)
    .slice(0, 5);
}

function toSelectionCandidate(candidate: RankedSelectionCandidate): SessionChatSelectionCandidate {
  return {
    displayName: candidate.displayName,
    entityKind: candidate.entityKind,
    entityUid: candidate.entityUid,
    matchSource: candidate.matchSource ?? null,
    matchQuality: candidate.matchQuality,
    ordinal: candidate.ordinal,
    platform: candidate.platform,
    platformEntityId: candidate.platformEntityId,
    releaseYear: candidate.releaseYear ?? null,
    resolutionTier: candidate.resolutionTier ?? null,
    score: candidate.score,
    totalReviews: candidate.totalReviews ?? null,
  };
}

function buildSelectionState(params: {
  family: TigerPrimaryMatchedIntent;
  slots: RankedSelectionSlot[];
}): SessionChatSelectionState | null {
  if (params.slots.length === 0) {
    return null;
  }

  if (!params.slots.some((slot) => slot.candidates.length > 0)) {
    return null;
  }

  return {
    family: params.family,
    slots: params.slots.map((slot) => ({
      candidates: slot.candidates.map(toSelectionCandidate),
      continuationToken: slot.continuationToken ?? null,
      expectedEntityKind: slot.expectedEntityKind ?? null,
      label: slot.label,
      query: slot.query,
      requiresClarification: slot.requiresClarification,
      selectedEntityUid: slot.selectedEntityUid,
      slotId: slot.slotId,
      totalCandidates: slot.totalCandidates ?? slot.candidates.length,
    })),
  };
}

function renderSelectionClarification(selectionState: SessionChatSelectionState): string {
  const brief = buildTigerClarificationBrief({
    intent: selectionState.family as TigerPrimaryMatchedIntent,
    selectionState,
  });

  return renderTigerAnswerBrief(brief);
}

function selectionStateRequiresClarification(
  selectionState: SessionChatSelectionState | null | undefined
): boolean {
  return selectionState?.slots?.some((slot) => slot.requiresClarification) ?? false;
}

function buildTigerSelectionLastAnswer(params: {
  family: TigerPrimaryMatchedIntent;
  clarificationNeeded?: boolean;
}): SessionChatLastAnswer {
  return {
    clarificationNeeded: params.clarificationNeeded ?? false,
    family: params.family,
    summary: params.clarificationNeeded
      ? `System needs clarification for ${params.family}.`
      : `System answered ${params.family}.`,
  };
}

function extractSameFamilyEntityFollowUpQuery(prompt: string): string | null {
  const followUpMatch = prompt.match(SAME_FAMILY_ENTITY_FOLLOW_UP_PATTERN);
  const followUpQuery = normalizeEntityQuery(followUpMatch?.[1] ?? null);
  if (followUpQuery) {
    return followUpQuery;
  }

  const correctionMatch = prompt.match(ENTITY_KIND_CORRECTION_PATTERN);
  return normalizeEntityQuery(correctionMatch?.[1] ?? null);
}

function inferEntityKindCorrection(prompt: string): SessionSelectionEntityKind | null {
  const match = prompt.match(ENTITY_KIND_CORRECTION_PATTERN);
  const raw = match?.[2]?.toLowerCase() ?? null;
  if (raw === 'developer' || raw === 'publisher' || raw === 'game') {
    return raw;
  }

  if (raw === 'studio') {
    return 'developer';
  }

  return null;
}

function inferSelectionFollowUpIntent(
  prompt: string,
  sessionContext: SessionChatContext | null
): boolean {
  if (!sessionContext?.selectionState?.slots?.length) {
    return false;
  }

  return SINGLE_SELECTION_INDEX_PATTERN.test(prompt)
    || COMPARE_SELECTION_INDEX_PATTERN.test(prompt)
    || SWITCH_TO_OTHER_PATTERN.test(prompt)
    || SWITCH_TO_ROLE_PATTERN.test(prompt)
    || DID_YOU_MEAN_PATTERN.test(prompt)
    || SWITCH_TO_NAMED_ENTITY_PATTERN.test(prompt);
}

function pickNamedSelectionCandidateFromPrompt(
  prompt: string,
  slot: SessionChatSelectionSlot
): SessionChatSelectionCandidate | null {
  const normalizedPrompt = normalizeForLooseMatch(prompt);
  const switchyPrompt = DID_YOU_MEAN_PATTERN.test(prompt) || /\b(?:use|switch|mean|instead)\b/i.test(prompt);
  if (!switchyPrompt) {
    return null;
  }

  return [...slot.candidates]
    .sort((left, right) => right.displayName.length - left.displayName.length)
    .find((candidate) => {
      const candidateName = normalizeForLooseMatch(candidate.displayName);
      return candidate.entityUid !== slot.selectedEntityUid
        && candidateName.length > 0
        && normalizedPrompt.includes(candidateName);
    }) ?? null;
}

function pickSelectionSlotFromPrompt(
  prompt: string,
  selectionState: SessionChatSelectionState
): SessionChatSelectionSlot | null {
  if (selectionState.slots.length === 1) {
    return selectionState.slots[0];
  }

  const normalizedPrompt = normalizeForLooseMatch(prompt);
  const matches = selectionState.slots.filter((slot) => {
    if (normalizedPrompt.includes(normalizeForLooseMatch(slot.query))) {
      return true;
    }

    return slot.candidates.some((candidate) =>
      normalizedPrompt.includes(normalizeForLooseMatch(candidate.displayName))
    );
  });

  if (matches.length === 1) {
    return matches[0];
  }

  const switchableSlots = selectionState.slots.filter((slot) => slot.candidates.length > 1);
  return switchableSlots.length === 1 ? switchableSlots[0] : null;
}

function applySelectionFollowUpState(params: {
  prompt: string;
  selectionState: SessionChatSelectionState;
}): {
  clarificationText: string | null;
  selectionState: SessionChatSelectionState;
} {
  const numericPair = params.prompt.match(COMPARE_SELECTION_INDEX_PATTERN);
  if (numericPair && params.selectionState.slots.length >= 2) {
    const ordinals = [Number(numericPair[1]), Number(numericPair[2])];
    return {
      clarificationText: null,
      selectionState: {
        ...params.selectionState,
        slots: params.selectionState.slots.map((slot, index) => ({
          ...slot,
          requiresClarification: false,
          selectedEntityUid: slot.candidates.find((candidate) => candidate.ordinal === ordinals[index])?.entityUid ?? null,
        })),
      },
    };
  }

  const numericSingle = params.prompt.match(SINGLE_SELECTION_INDEX_PATTERN);
  if (numericSingle && params.selectionState.slots.length === 1) {
    const ordinal = Number(numericSingle[1]);
    return {
      clarificationText: null,
      selectionState: {
        ...params.selectionState,
        slots: params.selectionState.slots.map((slot) => ({
          ...slot,
          requiresClarification: false,
          selectedEntityUid: slot.candidates.find((candidate) => candidate.ordinal === ordinal)?.entityUid ?? null,
        })),
      },
    };
  }

  const targetSlot = pickSelectionSlotFromPrompt(params.prompt, params.selectionState);
  if (!targetSlot) {
    return {
      clarificationText: 'Which entity should switch? Reply with the slot name or a numbered choice.',
      selectionState: params.selectionState,
    };
  }

  const namedCandidate = pickNamedSelectionCandidateFromPrompt(params.prompt, targetSlot);
  if (namedCandidate) {
    return {
      clarificationText: null,
      selectionState: {
        ...params.selectionState,
        slots: params.selectionState.slots.map((slot) =>
          slot.slotId === targetSlot.slotId
            ? {
                ...slot,
                requiresClarification: false,
                selectedEntityUid: namedCandidate.entityUid,
              }
            : slot
        ),
      },
    };
  }

  const roleMatch = params.prompt.match(SWITCH_TO_ROLE_PATTERN);
  if (roleMatch) {
    const desiredKind = roleMatch[1] as SessionSelectionEntityKind;
    const nextCandidate = targetSlot.candidates.find(
      (candidate) => candidate.entityKind === desiredKind && candidate.entityUid !== targetSlot.selectedEntityUid
    );
    return {
      clarificationText: nextCandidate ? null : `I couldn't find a ${desiredKind} alternative for ${targetSlot.label}.`,
      selectionState: {
        ...params.selectionState,
        slots: params.selectionState.slots.map((slot) =>
          slot.slotId === targetSlot.slotId
            ? {
                ...slot,
                requiresClarification: false,
                selectedEntityUid: nextCandidate?.entityUid ?? slot.selectedEntityUid,
              }
            : slot
        ),
      },
    };
  }

  if (SWITCH_TO_OTHER_PATTERN.test(params.prompt)) {
    const nextCandidate = targetSlot.candidates.find(
      (candidate) => candidate.entityUid !== targetSlot.selectedEntityUid
    );
    return {
      clarificationText: nextCandidate ? null : `I couldn't find another plausible match for ${targetSlot.label}.`,
      selectionState: {
        ...params.selectionState,
        slots: params.selectionState.slots.map((slot) =>
          slot.slotId === targetSlot.slotId
            ? {
                ...slot,
                requiresClarification: false,
                selectedEntityUid: nextCandidate?.entityUid ?? slot.selectedEntityUid,
              }
            : slot
        ),
      },
    };
  }

  return {
    clarificationText: 'I could not map that follow-up to one of the available matches.',
    selectionState: params.selectionState,
  };
}

function inferUnsupportedCompareReason(prompt: string): string | null {
  if (/\breview velocity\b|\breviews?\s+added\b|\brecent reviews?\b/i.test(prompt)) {
    return 'The system does not support review-velocity or recent-review-window comparisons yet.';
  }

  if (/\b(momentum|accelerating|declining|breaking out|trending up|sustained response)\b/i.test(prompt)) {
    return 'The system does not support momentum or post-change response comparisons yet.';
  }

  if (/\bbefore and after\b|\bbefore\/after\b/i.test(prompt)) {
    return 'The system does not support before/after change comparisons yet.';
  }

  return null;
}

function extractCompareMetrics(prompt: string): CompareMetricName[] {
  const compareBody = stripCompareLeadIn(prompt);
  const metricClauseStart = findCompareMetricClauseStart(compareBody);
  const metricText = metricClauseStart == null
    ? ''
    : compareBody.slice(metricClauseStart).replace(/^\s*(?:by|on|for)\s+/i, '').trim();

  if (!metricText) {
    return [];
  }

  const candidates: Array<{ index: number; metric: CompareMetricName }> = [];
  const metricMatchers: Array<{
    metric: CompareMetricName;
    patterns: RegExp[];
  }> = [
    {
      metric: 'review_score',
      patterns: [
        /\breview score\b/i,
        /\brating\b/i,
        /\bratings\b/i,
        /\bhighest rated\b/i,
        /\bbest rated\b/i,
        /\bbest-reviewed\b/i,
        /\bbest reviewed\b/i,
      ],
    },
    {
      metric: 'total_reviews',
      patterns: [
        /\btotal reviews\b/i,
        /\breview count\b/i,
        /\bmost reviews\b/i,
        /\breviews\b/i,
      ],
    },
    {
      metric: 'owners_midpoint',
      patterns: [
        /\bowners?\b/i,
        /\baudience size\b/i,
        /\bplayer base\b/i,
      ],
    },
    {
      metric: 'ccu_peak',
      patterns: [
        /\bccu\b/i,
        /\bconcurrent players?\b/i,
        /\bplayers right now\b/i,
      ],
    },
    {
      metric: 'game_count',
      patterns: [
        /\bgame count\b/i,
        /\bcatalog size\b/i,
        /\bhow many games\b/i,
        /\bmost games\b/i,
      ],
    },
  ];

    for (const { metric, patterns } of metricMatchers) {
    const index = patterns.reduce<number | null>((current, pattern) => {
      const match = pattern.exec(metricText);
      if (typeof match?.index !== 'number') {
        return current;
      }

      return current == null ? match.index : Math.min(current, match.index);
    }, null);

    if (index != null) {
      candidates.push({ index, metric });
    }
  }

  return candidates
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.metric)
    .filter((metric, index, values) => values.indexOf(metric) === index);
}

function validateCompareMetricsForEntityKind(
  entityKind: 'developer' | 'game' | 'publisher' | null,
  metrics: CompareMetricName[]
): string | null {
  if (entityKind === 'game' && metrics.includes('game_count')) {
    return 'The system does not support game-count comparisons for game peers.';
  }

  return null;
}

function extractEntityUidsFromCatalogResponse(
  response: SearchCatalogResponse | null | undefined,
  limit: number
): string[] {
  return (response?.items ?? [])
    .map((item) => (typeof item?.entityUid === 'string' ? item.entityUid : null))
    .filter((entityUid): entityUid is string => Boolean(entityUid))
    .slice(0, limit);
}

function extractEntityUidsFromRankResponse(
  response: RankEntitiesResponse | null | undefined,
  limit: number
): string[] {
  return (response?.items ?? [])
    .map((item) => (typeof item?.entityUid === 'string' ? item.entityUid : null))
    .filter((entityUid): entityUid is string => Boolean(entityUid))
    .slice(0, limit);
}

function countCatalogFacetMatches(response: SearchCatalogResponse | null | undefined): number {
  if (!response?.facets) {
    return 0;
  }

  return (
    (response.facets.tags?.length ?? 0)
    + (response.facets.genres?.length ?? 0)
    + (response.facets.categories?.length ?? 0)
  );
}

function hasCatalogAnswerPayload(response: SearchCatalogResponse | null | undefined): boolean {
  return (response?.items?.length ?? 0) > 0 || countCatalogFacetMatches(response) > 0;
}

function extractSemanticResultAppids(
  response: SemanticSearchResponse | null | undefined,
  limit: number,
  excludedAppids: number[] = []
): number[] {
  const blocked = new Set(excludedAppids);

  return (response?.results ?? [])
    .map((item) => (isRecord(item) ? normalizeNumber(item.id) : null))
    .filter((appid): appid is number => typeof appid === 'number' && !blocked.has(appid))
    .slice(0, limit);
}

function extractRollingReleaseDays(prompt: string): number | null {
  const monthMatch = prompt.match(/\b(?:past|last)\s+(\d+)\s+months?\b/i);
  if (monthMatch) {
    const months = Number.parseInt(monthMatch[1] ?? '', 10);
    return Number.isFinite(months) && months > 0 ? months * 30 : null;
  }

  const yearMatch = prompt.match(/\b(?:past|last)\s+(\d+)\s+years?\b/i);
  if (yearMatch) {
    const years = Number.parseInt(yearMatch[1] ?? '', 10);
    return Number.isFinite(years) && years > 0 ? years * 365 : null;
  }

  if (/\b(?:past|last)\s+year\b/i.test(prompt)) {
    return 365;
  }

  return null;
}

function extractCurrentYearReleaseFilter(prompt: string): { gte?: number | null; lte?: number | null } | null {
  if (!/\bthis year\b/i.test(prompt)) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  return { gte: currentYear, lte: currentYear };
}

function extractRankingAggregateFilters(prompt: string): RankEntitiesShadowRequest['aggregateFilters'] | null {
  const filters: NonNullable<RankEntitiesShadowRequest['aggregateFilters']> = {};
  const minGameCountMatch = prompt.match(/\b(\d+)\+\s+games?\b/i);
  if (minGameCountMatch) {
    const minGameCount = Number.parseInt(minGameCountMatch[1] ?? '', 10);
    if (Number.isFinite(minGameCount) && minGameCount > 0) {
      filters.minGameCount = minGameCount;
    }
  }

  const averageReviewMatch = prompt.match(/\baveraging\s+(\d{2,3})%?\+?\s+reviews?\b/i)
    ?? prompt.match(/\baverage(?:s|ing)?\s+(\d{2,3})%?\+?\s+reviews?\b/i)
    ?? prompt.match(/\bavg(?:\.|erage)?\s+(\d{2,3})%?\+?\s+reviews?\b/i);
  if (averageReviewMatch) {
    const minAverageReviewScore = Number.parseInt(averageReviewMatch[1] ?? '', 10);
    if (Number.isFinite(minAverageReviewScore) && minAverageReviewScore > 0) {
      filters.minAverageReviewScore = minAverageReviewScore;
    }
  }

  const allAboveMatch = prompt.match(/\ball above\s+(\d{2,3})%?\s+reviews?\b/i)
    ?? prompt.match(/\beach above\s+(\d{2,3})%?\s+reviews?\b/i)
    ?? prompt.match(/\bminimum\s+(\d{2,3})%?\s+reviews?\b/i);
  if (allAboveMatch) {
    const minMinimumReviewScore = Number.parseInt(allAboveMatch[1] ?? '', 10);
    if (Number.isFinite(minMinimumReviewScore) && minMinimumReviewScore > 0) {
      filters.minMinimumReviewScore = minMinimumReviewScore;
    }
  }

  const reviewFloorMatch = prompt.match(/\b(\d{2,3})%?\+\s+reviews?\b/i);
  if (reviewFloorMatch && filters.minAverageReviewScore == null && filters.minMinimumReviewScore == null) {
    const score = Number.parseInt(reviewFloorMatch[1] ?? '', 10);
    if (Number.isFinite(score) && score > 0) {
      filters.minAverageReviewScore = score;
    }
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

function extractRankingCatalogFilters(
  prompt: string,
  entityKind: RankEntitiesShadowRequest['entityKind']
): RankEntitiesShadowRequest['catalogFilters'] | null {
  const tags = extractMomentumTags(prompt);
  const platforms = extractPrimaryPlatforms(prompt);
  const releaseYear = extractCurrentYearReleaseFilter(prompt) ?? extractPrimaryReleaseYear(prompt) ?? null;
  const maxPriceCents = extractMomentumMaxPriceCents(prompt);
  const minPriceCents = extractMinimumPriceCents(prompt);
  const onSale = /\bon sale\b/i.test(prompt) ? true : null;
  const isFree =
    /\b(?:free-to-play|free to play)\b/i.test(prompt)
      ? true
      : /\bpremium games?\b/i.test(prompt)
        ? false
        : null;
  const minReviewScore = extractMomentumReviewThreshold(prompt);
  const minReviews = extractMomentumMinReviews(prompt);
  const filters: NonNullable<RankEntitiesShadowRequest['catalogFilters']> = {};

  if (tags?.length) {
    filters.tags = tags;
  }
  if (platforms.length > 0) {
    filters.platforms = platforms;
  }
  if (releaseYear) {
    filters.releaseYear = releaseYear;
  }
  if (maxPriceCents != null) {
    filters.maxPriceCents = maxPriceCents;
  }
  if (minPriceCents != null) {
    filters.minPriceCents = minPriceCents;
  }
  if (onSale != null) {
    filters.onSale = onSale;
  }
  if (isFree != null) {
    filters.isFree = isFree;
  }
  if (minReviewScore != null && entityKind === 'game') {
    filters.minReviewScore = minReviewScore;
  }
  if (minReviews != null && entityKind === 'game') {
    filters.minReviews = minReviews;
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

function inferRankingMetric(
  prompt: string,
  entityKind: RankEntitiesShadowRequest['entityKind'],
  aggregateFilters: RankEntitiesShadowRequest['aggregateFilters'] | null
): RankEntitiesShadowRequest['metric'] | null {
  const normalized = prompt.toLowerCase();

  if (entityKind !== 'game' && /\b(?:most games|has the most games|game count|catalog size|released the most|releasing the most|most releases|most titles|most games this year)\b/.test(normalized)) {
    return 'game_count';
  }
  if (/\bmost reviews\b|\bby reviews\b|\btotal reviews\b/.test(normalized)) {
    return 'total_reviews';
  }
  if (/\breview score\b|\bhighest-rated\b|\bbest rated\b|\bbest reviews\b|\bbest-reviewed\b/.test(normalized)) {
    return 'review_score';
  }
  if (/\bowners?\b|\bbiggest\b|\blargest\b/.test(normalized)) {
    return 'owners_midpoint';
  }
  if (/\bccu\b|\bconcurrent players?\b|\bplayers right now\b|\bmost players\b/.test(normalized)) {
    return 'ccu_peak';
  }
  if (entityKind !== 'game' && aggregateFilters) {
    return aggregateFilters.minAverageReviewScore != null || aggregateFilters.minMinimumReviewScore != null
      ? 'review_score'
      : 'game_count';
  }

  return null;
}

function buildRankingShadowRequest(prompt: string): { reason?: string; request: RankEntitiesShadowRequest | null } {
  if (!inferRankingIntent(prompt)) {
    return {
      request: null,
      reason: 'The prompt did not match a supported ranking pattern.',
    };
  }

  const normalized = prompt.toLowerCase();
  const limit = extractRequestedTopCount(prompt, 10);
  const entityKind = /\bpublisher(s)?\b/.test(normalized)
    ? 'publisher'
    : /\bdeveloper(s)?\b|\bstudios?\b/.test(normalized)
      ? 'developer'
      : 'game';
  const aggregateFilters = extractRankingAggregateFilters(prompt);
  const catalogFilters = extractRankingCatalogFilters(prompt, entityKind);
  const metric = inferRankingMetric(prompt, entityKind, aggregateFilters);
  const recentReleaseDays =
    /\bwith a release in the\b/i.test(prompt)
      ? extractRollingReleaseDays(prompt)
      : null;
  const releaseDays =
    recentReleaseDays == null
      ? extractRollingReleaseDays(prompt)
      : null;

  if (!metric) {
    return {
      request: null,
      reason: 'The ranking prompt used filters or semantics the system does not support yet.',
    };
  }

  return {
    request: {
      ...(aggregateFilters ? { aggregateFilters } : {}),
      ...(catalogFilters ? { catalogFilters } : {}),
      entityKind,
      limit,
      metric,
      ...(recentReleaseDays != null ? { recentReleaseDays } : {}),
      ...(releaseDays != null ? { releaseDays } : {}),
      sortDirection: 'desc',
    },
  };
}

function buildClosestMatchRankingRequest(
  request: RankEntitiesShadowRequest
): {
  apiRequest: RankEntitiesShadowRequest;
  renderRequest: RankEntitiesRenderRequest;
} | null {
  if (request.entityKind === 'game') {
    return null;
  }

  const aggregateFilters = request.aggregateFilters ?? null;
  if (!aggregateFilters) {
    return null;
  }

  const hasReviewThreshold =
    typeof aggregateFilters.minAverageReviewScore === 'number'
    || typeof aggregateFilters.minMinimumReviewScore === 'number';
  if (!hasReviewThreshold) {
    return null;
  }

  const relaxedAggregateFilters = {
    ...(typeof aggregateFilters.minGameCount === 'number'
      ? { minGameCount: aggregateFilters.minGameCount }
      : {}),
  };

  const apiRequest: RankEntitiesShadowRequest = {
    ...request,
    ...(Object.keys(relaxedAggregateFilters).length > 0
      ? { aggregateFilters: relaxedAggregateFilters }
      : { aggregateFilters: null }),
  };

  return {
    apiRequest,
    renderRequest: {
      ...apiRequest,
      fallbackMode: 'closest_match',
      originalAggregateFilters: aggregateFilters,
    },
  };
}

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function formatUtcMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function parseMonthlyPlaytimeWindow(prompt: string): { endMonth: string; startMonth: string } {
  const now = new Date();
  const normalized = prompt.toLowerCase();
  const explicitMonth = normalized.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/
  );

  if (explicitMonth) {
    const monthIndex = MONTH_NAME_TO_INDEX[explicitMonth[1] ?? ''] ?? 0;
    const year = Number(explicitMonth[2]);
    const month = formatUtcMonth(new Date(Date.UTC(year, monthIndex, 1)));
    return { endMonth: month, startMonth: month };
  }

  if (/\bthis month\b/.test(normalized)) {
    const month = formatUtcMonth(startOfUtcMonth(now));
    return { endMonth: month, startMonth: month };
  }

  const lastMonth = startOfUtcMonth(now);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const month = formatUtcMonth(lastMonth);
  return { endMonth: month, startMonth: month };
}

function buildMonthlyPlaytimeRequest(prompt: string): QueryMonthlyPlaytimeRequest {
  return {
    entityKind: /\bpublishers?\b/i.test(prompt) ? 'publisher' : 'game',
    limit: extractRequestedTopCount(prompt, 10),
    ...parseMonthlyPlaytimeWindow(prompt),
  };
}

function addMetric(metrics: TraceMetricHistoryShadowRequest['metrics'], metric: TraceMetricHistoryShadowRequest['metrics'][number]): void {
  if (!metrics.includes(metric) && metrics.length < 4) {
    metrics.push(metric);
  }
}

function extractHistoryMetrics(prompt: string): TraceMetricHistoryShadowRequest['metrics'] {
  const normalized = prompt.toLowerCase();
  const metrics: TraceMetricHistoryShadowRequest['metrics'] = [];

  if (/\breviews?\b/.test(normalized)) {
    addMetric(metrics, 'total_reviews');
    addMetric(metrics, 'review_score');
    addMetric(metrics, 'positive_percentage');
  }

  if (/\breview score\b|\brating\b|\bsentiment\b/.test(normalized)) {
    addMetric(metrics, 'review_score');
    addMetric(metrics, 'positive_percentage');
  }

  if (/\bccu\b|\bconcurrent players?\b|\bplayers right now\b/.test(normalized)) {
    addMetric(metrics, 'ccu_peak');
  }

  if (/\bowners?\b|\bsales\b/.test(normalized)) {
    addMetric(metrics, 'owners_midpoint');
  }

  if (/\bprice\b/.test(normalized)) {
    addMetric(metrics, 'price_cents');
  }

  if (/\bdiscount\b|\bsale price\b/.test(normalized)) {
    addMetric(metrics, 'discount_percent');
  }

  if (/\bplaytime\b/.test(normalized)) {
    addMetric(metrics, /\b2 weeks\b|\b2-week\b/.test(normalized)
      ? 'average_playtime_2weeks'
      : 'average_playtime_forever');
  }

  if (metrics.length === 0) {
    addMetric(metrics, 'total_reviews');
    addMetric(metrics, 'review_score');
  }

  return metrics;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  next.setUTCDate(next.getUTCDate() - diff);
  return next;
}

function startOfUtcMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  return next;
}

function parseHistoryWindow(prompt: string): { endDate: string; startDate: string } {
  const now = new Date();
  const today = formatIsoDate(now);
  const explicitLastDays = prompt.match(/\blast\s+(\d+)\s+days?\b/i);

  if (explicitLastDays) {
    const totalDays = Math.max(1, Math.min(Number(explicitLastDays[1]), 180));
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - (totalDays - 1));
    return {
      endDate: today,
      startDate: formatIsoDate(start),
    };
  }

  if (/\bthis week\b/i.test(prompt)) {
    return {
      endDate: today,
      startDate: formatIsoDate(startOfUtcWeek(now)),
    };
  }

  if (/\bthis month\b/i.test(prompt)) {
    return {
      endDate: today,
      startDate: formatIsoDate(startOfUtcMonth(now)),
    };
  }

  const defaultStart = new Date(now);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);
  return {
    endDate: today,
    startDate: formatIsoDate(defaultStart),
  };
}

async function postToQueryApi<T>(
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<QueryApiResponse<T>> {
  const { baseUrl, reason } = resolveQueryApiBaseUrl();
  if (!baseUrl) {
    return {
      errorCode: 'QUERY_API_BASE_URL_MISSING',
      httpStatus: null,
      ok: false,
      reason,
    };
  }

  const timeoutMs = options?.timeoutMs ?? readShadowTimeoutMs();
  const headers: HeadersInit = {
    'content-type': 'application/json',
  };

  const bearerToken = process.env.QUERY_API_BEARER_TOKEN?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        errorCode:
          isRecord(payload) && typeof payload.code === 'string'
            ? payload.code
            : null,
        httpStatus: response.status,
        ok: false,
        reason:
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`,
      };
    }

    return {
      data: payload as T,
      httpStatus: response.status,
      ok: true,
    };
  } catch (error) {
    return {
      errorCode: null,
      httpStatus: null,
      ok: false,
      reason: error instanceof Error ? error.message : 'Unknown query-api error',
    };
  }
}

function buildSkippedAttempt(
  contractName: TigerShadowAttempt['contractName'],
  reason: string
): TigerShadowAttempt {
  return {
    contractName,
    reason,
    status: 'skipped',
  };
}

function buildResolvedEntityByUidMap(entities: ResolvedCompareEntity[]): Map<string, ResolvedCompareEntity> {
  return new Map(
    entities
      .filter((entity) => entity.entityUid)
      .map((entity) => [entity.entityUid, entity] as const)
  );
}

async function resolveSelectionSlotAttempt(params: {
  entityKinds?: SessionSelectionEntityKind[] | null;
  expectedEntityKind: SessionSelectionEntityKind | null;
  label: string;
  query: string | null;
  resolutionPreference?: EntityResolutionPreference;
  strictResolver?: boolean;
  slotId: string;
  timeoutMs?: number;
}): Promise<{
  attempt: TigerShadowAttempt;
  entitiesByUid: Map<string, ResolvedCompareEntity>;
  slot: RankedSelectionSlot;
}> {
  if (!params.query) {
    return {
      attempt: buildSkippedAttempt(
        'resolveEntities',
        'No resolvable entity reference was available for this request.'
      ),
      entitiesByUid: new Map(),
      slot: {
        candidates: [],
        expectedEntityKind: params.expectedEntityKind,
        label: params.label,
        query: params.query ?? '',
        requiresClarification: true,
        selectedEntityUid: null,
        slotId: params.slotId,
      },
    };
  }

  const resolutionQuery = normalizeEntityResolutionQuery(params.query) ?? params.query;
  const startedAt = performance.now();
  const response = await postToQueryApi<ResolveEntitiesResponse>('/v1/contracts/resolve-entities', {
    entityKinds: params.entityKinds?.length
      ? params.entityKinds
      : params.expectedEntityKind
        ? [params.expectedEntityKind]
        : ['game', 'publisher', 'developer'],
    includeMetrics: false,
    limit: params.strictResolver ? 25 : 6,
    query: resolutionQuery,
    resolutionMode: params.strictResolver
      ? 'chat_strict'
      : (params.resolutionPreference ? 'autocomplete' : 'default'),
    resolutionPreference: params.resolutionPreference ?? null,
  }, {
    timeoutMs: params.timeoutMs ?? readShadowTimeoutMs(),
  });
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempt: {
        contractName: 'resolveEntities',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      },
      entitiesByUid: new Map(),
      slot: {
        candidates: [],
        expectedEntityKind: params.expectedEntityKind,
        label: params.label,
        query: params.query,
        requiresClarification: true,
        selectedEntityUid: null,
        slotId: params.slotId,
      },
    };
  }

  const entities = response.data?.entities ?? [];
  const candidates = buildRankedSelectionCandidates({
    entities,
    expectedEntityKind: params.expectedEntityKind,
    preserveInputOrder: params.strictResolver,
    query: params.query,
    resolutionPreference: params.resolutionPreference ?? null,
  });
  const topCandidate = candidates[0] ?? null;
  const exactSingleCandidate =
    candidates.length === 1
    && topCandidate?.matchQuality === 'exact'
    && topCandidate.displayNameNormalized === normalizeForLooseMatch(params.query);
  const localRequiresClarification = needsClarificationForRankedCandidates({
    candidates,
    query: params.query,
    resolutionPreference: params.resolutionPreference ?? null,
  });
  const resolverRequestedClarification = response.data?.ambiguity?.requiresClarification ?? false;
  const requiresClarification = params.strictResolver
    ? (!exactSingleCandidate && (resolverRequestedClarification || localRequiresClarification))
    : (
      localRequiresClarification
      || (
        resolverRequestedClarification
        && !shouldOverrideResolverAmbiguity({
          candidates,
          query: params.query,
          resolutionPreference: params.resolutionPreference ?? null,
        })
      )
    );
  const selectedEntityUid = !requiresClarification ? candidates[0]?.entityUid ?? null : null;

  return {
    attempt: {
      contractName: 'resolveEntities',
      httpStatus: response.httpStatus,
      reason: requiresClarification
        ? response.data?.ambiguity?.message ?? 'Multiple plausible matches were found and clarification is needed.'
        : entities.length === 0
          ? 'The system could not resolve a stable entity from the prompt.'
          : undefined,
      resultCount: entities.length,
      status: 'success',
      sufficientToAnswer: !requiresClarification && Boolean(selectedEntityUid),
      timingMs,
    },
    entitiesByUid: buildResolvedEntityByUidMap(entities),
    slot: {
      candidates,
      continuationToken: response.data?.continuationToken ?? null,
      expectedEntityKind: params.expectedEntityKind,
      label: params.label,
      query: params.query,
      requiresClarification,
      selectedEntityUid,
      slotId: params.slotId,
      totalCandidates: response.data?.totalCandidates ?? candidates.length,
    },
  };
}

function pickSelectedEntityFromSlot(params: {
  entitiesByUid: Map<string, ResolvedCompareEntity>;
  slot: SessionChatSelectionSlot | RankedSelectionSlot;
}): ResolvedCompareEntity | null {
  if (params.slot.requiresClarification || !params.slot.selectedEntityUid) {
    return null;
  }

  return params.entitiesByUid.get(params.slot.selectedEntityUid) ?? null;
}

function buildResolvedEntityFromSelectionCandidate(
  candidate: SessionChatSelectionCandidate
): ResolvedCompareEntity {
  return {
    confidence: candidate.score / 100,
    displayName: candidate.displayName,
    entityKind: candidate.entityKind,
    entityUid: candidate.entityUid,
    latestMetrics:
      typeof candidate.totalReviews === 'number'
        ? { totalReviews: candidate.totalReviews }
        : undefined,
    matchSource: candidate.matchSource ?? undefined,
    matchQuality: candidate.matchQuality ?? undefined,
    platform: candidate.platform,
    platformEntityId: candidate.platformEntityId ?? undefined,
    releaseYear: candidate.releaseYear ?? undefined,
    resolutionTier: candidate.resolutionTier ?? undefined,
  };
}

function pickSelectedCandidateFromSelectionState(
  selectionState: SessionChatSelectionState | null | undefined
): SessionChatSelectionCandidate | null {
  const slot = selectionState?.slots[0];
  if (!slot || slot.requiresClarification || !slot.selectedEntityUid) {
    return null;
  }

  return slot.candidates.find((candidate) => candidate.entityUid === slot.selectedEntityUid) ?? null;
}

async function resolvePrimaryEntityAttempt(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  family?: TigerPrimaryMatchedIntent;
  preferredEntityKinds?: SessionSelectionEntityKind[] | null;
  prompt?: string | null;
  query: string | null;
  resolutionPreference?: EntityResolutionPreference;
  selectionState?: SessionChatSelectionState | null;
  strictResolver?: boolean;
}): Promise<PrimaryEntityResolutionResult> {
  const selectedCandidate = pickSelectedCandidateFromSelectionState(params.selectionState);
  const selectedSlot = params.selectionState?.slots[0] ?? null;
  const canReuseBoundRequestSelection =
    selectedCandidate
    && params.selectionState?.family === 'request_binding'
    && params.selectionState.slots.length === 1
    && (!params.expectedEntityKind || selectedCandidate.entityKind === params.expectedEntityKind)
    && (
      !params.query
      || promptReferencesEntityName(params.prompt, selectedSlot?.query)
      || promptReferencesEntityName(params.prompt, selectedSlot?.label)
      || promptReferencesEntityName(params.prompt, selectedCandidate.displayName)
    );
  const canReuseSelectedCandidate =
    canReuseBoundRequestSelection
    || (
      selectedCandidate
      && (!params.expectedEntityKind || selectedCandidate.entityKind === params.expectedEntityKind)
      && (
        !params.query
        || selectionReferenceMatchesQuery(selectedSlot?.query, params.query)
        || selectionReferenceMatchesQuery(selectedSlot?.label, params.query)
        || selectionReferenceMatchesQuery(selectedCandidate.displayName, params.query)
      )
    );

  if (canReuseSelectedCandidate) {
    return {
      attempt: {
        contractName: 'resolveEntities',
        reason: 'Reused the current entity selection from session context.',
        status: 'success',
        sufficientToAnswer: true,
      },
      entity: buildResolvedEntityFromSelectionCandidate(selectedCandidate),
      selectionState: params.selectionState ?? null,
    };
  }

  const timeoutMs = readPrimaryEntityResolutionTimeoutMs();
  const resolved = await resolveSelectionSlotAttempt({
    entityKinds: params.preferredEntityKinds ?? null,
    expectedEntityKind: params.expectedEntityKind,
    label: params.query ?? 'entity',
    query: params.query,
    resolutionPreference: params.resolutionPreference ?? null,
    strictResolver: params.strictResolver ?? params.expectedEntityKind != null,
    slotId: 'primary',
    timeoutMs,
  });
  const slotWithBestCandidate =
    !resolved.slot.requiresClarification
    && !resolved.slot.selectedEntityUid
    && resolved.slot.candidates[0]?.entityUid
      ? {
          ...resolved.slot,
          selectedEntityUid: resolved.slot.candidates[0].entityUid,
        }
      : resolved.slot;
  const entity = pickSelectedEntityFromSlot({
    entitiesByUid: resolved.entitiesByUid,
    slot: slotWithBestCandidate,
  });
  const attempt = entity
    ? {
        ...resolved.attempt,
        sufficientToAnswer: true,
      }
    : resolved.attempt;

  return {
    attempt,
    entity,
    selectionState: params.family
      ? buildSelectionState({
          family: params.family,
          slots: [slotWithBestCandidate],
        })
      : null,
  };
}

async function resolveEntityOverviewPrimaryEntityAttempt(params: {
  family?: TigerPrimaryMatchedIntent;
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  prompt?: string | null;
  query: string | null;
  resolutionPreference?: EntityResolutionPreference;
  selectionState?: SessionChatSelectionState | null;
}): Promise<PrimaryEntityResolutionResult> {
  if (params.expectedEntityKind) {
    return resolvePrimaryEntityAttempt({
      ...params,
      preferredEntityKinds: [params.expectedEntityKind],
      strictResolver: true,
    });
  }

  if (params.resolutionPreference === 'company') {
    return resolvePrimaryEntityAttempt({
      ...params,
      preferredEntityKinds: ['publisher', 'developer'],
      strictResolver: false,
    });
  }

  const gameFirst = await resolvePrimaryEntityAttempt({
    ...params,
    expectedEntityKind: 'game',
    preferredEntityKinds: ['game'],
    resolutionPreference: 'game',
    strictResolver: true,
  });

  if (
    gameFirst.entity
    || gameFirst.attempt.status !== 'success'
    || (gameFirst.attempt.resultCount ?? 0) > 0
  ) {
    return gameFirst;
  }

  return resolvePrimaryEntityAttempt({
    ...params,
    preferredEntityKinds: ['publisher', 'developer'],
    resolutionPreference: 'company',
    strictResolver: false,
  });
}

async function resolveGameEntityAttempt(params: {
  family?: TigerPrimaryMatchedIntent;
  prompt?: string | null;
  query: string | null;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempt: TigerShadowAttempt;
  entity: ResolvedCompareEntity | null;
  entityUid: string | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const resolved = await resolvePrimaryEntityAttempt({
    expectedEntityKind: 'game',
    family: params.family,
    prompt: params.prompt,
    query: params.query,
    resolutionPreference: 'game',
    selectionState: params.selectionState,
  });

  if (!resolved.entity?.entityUid || resolved.entity.platform !== 'steam') {
    return {
      attempt: {
        ...resolved.attempt,
        reason: resolved.attempt.reason ?? 'The system did not return a Steam game match for the inferred reference.',
        sufficientToAnswer: false,
      },
      entity: null,
      entityUid: null,
      selectionState: resolved.selectionState,
    };
  }

  return {
    attempt: resolved.attempt,
    entity: resolved.entity,
    entityUid: resolved.entity.entityUid,
    selectionState: resolved.selectionState,
  };
}

async function resolveGameEntityAttempts(queries: string[]): Promise<{
  attempts: TigerShadowAttempt[];
  entityUids: string[];
}> {
  const attempts: TigerShadowAttempt[] = [];
  const entityUids: string[] = [];

  for (const query of queries) {
    const resolved = await resolveGameEntityAttempt({ query });
    attempts.push(resolved.attempt);
    if (resolved.entityUid) {
      entityUids.push(resolved.entityUid);
    }
  }

  return {
    attempts,
    entityUids: Array.from(new Set(entityUids)),
  };
}

function inferRelatedEntityKind(prompt: string): GetRelatedEntitiesRequest['relationKind'] | null {
  if (/\b(?:dlc|downloadable content)\b/i.test(prompt)) {
    return 'dlc';
  }

  if (SAME_FRANCHISE_PATTERN.test(prompt)) {
    return 'franchise_games';
  }

  return null;
}

function extractRelatedEntityQuery(prompt: string): string | null {
  const match =
    prompt.match(/\b(?:all\s+)?(?:dlc|downloadable content)\s+(?:for|of)\s+(.+?)(?:[?!.]|$)/i)
    ?? prompt.match(/\b(?:same franchise|same series)\s+(?:as|from)\s+(.+?)(?:\s+(?:with|that|which)\b|[?!.]|$)/i)
    ?? prompt.match(/\bfind\s+(?:games?|titles?)\s+in\s+the\s+same\s+(?:franchise|series)\s+as\s+(.+?)(?:\s+(?:with|that|which)\b|[?!.]|$)/i)
    ?? prompt.match(/\b(?:similar to|like)\s+(.+?)\s+from\s+the\s+same\s+(?:franchise|series)\b/i);
  return normalizeEntityQuery(match?.[1] ?? null);
}

async function buildRelatedEntitiesRequest(params: {
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
  }): Promise<{
  attempts: TigerShadowAttempt[];
  request: GetRelatedEntitiesRequest | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const relationKind = inferRelatedEntityKind(params.prompt);
  if (!relationKind) {
    return {
      attempts: [
        buildSkippedAttempt(
          'getRelatedEntities',
          'The system could not infer which relation set to expand from the prompt.'
        ),
      ],
      request: null,
      selectionState: params.selectionState ?? null,
    };
  }

  const sourceQuery = extractRelatedEntityQuery(params.prompt);
  const resolved = await resolveGameEntityAttempt({
    family: 'relation_lookup',
    prompt: params.prompt,
    query: sourceQuery,
    selectionState: params.selectionState,
  });
  if (!resolved.entity?.entityUid) {
    return {
      attempts: [resolved.attempt],
      request: null,
      selectionState: resolved.selectionState,
    };
  }

  const filters: NonNullable<GetRelatedEntitiesRequest['filters']> = {};
  const steamDeck = extractMomentumSteamDeck(params.prompt);
  if (steamDeck?.length) {
    filters.steamDeck = steamDeck;
  }
  const minReviewScore = extractMomentumReviewThreshold(params.prompt);
  if (minReviewScore != null) {
    filters.minReviewScore = minReviewScore;
  }
  if (/\bbetter reviews?\b|\bbetter review score\b/i.test(params.prompt)) {
    filters.reviewComparison = 'better_only';
  }

  return {
    attempts: [resolved.attempt],
    request: {
      excludeSource: relationKind === 'franchise_games',
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      limit: extractRequestedTopCount(params.prompt, relationKind === 'dlc' ? 20 : 10, 20),
      relationKind,
      sourceEntityUid: resolved.entity.entityUid,
      ...(resolved.entity.platformEntityId
        ? { sourceAppid: Number.parseInt(resolved.entity.platformEntityId, 10) }
        : {}),
    },
    selectionState: resolved.selectionState,
  };
}

function pickCompareResolutionGroup(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  slots: RankedSelectionSlot[];
}): {
  group: CompareResolutionGroup | null;
  requiresClarification: boolean;
} {
  const comboScores = new Map<string, { count: number; group: CompareResolutionGroup; score: number }>();

  for (const slot of params.slots) {
    const bestScoresForSlot = new Map<string, number>();

    for (const entity of slot.candidates) {
      if (params.expectedEntityKind && entity.entityKind !== params.expectedEntityKind) {
        continue;
      }

      const key = `${entity.entityKind}:${entity.platform}`;
      const currentBest = bestScoresForSlot.get(key) ?? -1;
      if (entity.score > currentBest) {
        bestScoresForSlot.set(key, entity.score);
      }
    }

    for (const [key, score] of bestScoresForSlot.entries()) {
      const [entityKind, platform] = key.split(':');
      if (
        entityKind !== 'developer'
        && entityKind !== 'game'
        && entityKind !== 'publisher'
      ) {
        continue;
      }

      const existing = comboScores.get(key);
      comboScores.set(key, {
        count: (existing?.count ?? 0) + 1,
        group: { entityKind, platform },
        score: (existing?.score ?? 0) + score,
      });
    }
  }

  const rankedGroups = [...comboScores.values()]
    .filter((candidate) => candidate.count === params.slots.length)
    .sort((left, right) => right.score - left.score);
  const developerGroup = rankedGroups.find((candidate) => candidate.group.entityKind === 'developer') ?? null;
  const publisherGroup = rankedGroups.find((candidate) => candidate.group.entityKind === 'publisher') ?? null;
  const preferDeveloperCompanyGroup =
    !params.expectedEntityKind
    && developerGroup
    && publisherGroup
    && Math.abs(developerGroup.score - publisherGroup.score) < 18;
  const topGroup =
    preferDeveloperCompanyGroup
      ? developerGroup
      : (rankedGroups[0] ?? null);
  const runnerUp = rankedGroups.find((candidate) => candidate !== topGroup) ?? null;

  if (!topGroup) {
    return {
      group: null,
      requiresClarification: true,
    };
  }

  return {
    group: topGroup.group,
    requiresClarification:
      topGroup.score < params.slots.length * 70
      || (
        !preferDeveloperCompanyGroup
        && runnerUp != null
        && (topGroup.score - runnerUp.score) < 18
      ),
  };
}

function pickResolvedCompareEntityForGroup(params: {
  group: CompareResolutionGroup;
  slot: RankedSelectionSlot;
}): RankedSelectionCandidate | null {
  return params.slot.candidates
    .filter((entity) => entity.entityKind === params.group.entityKind && entity.platform === params.group.platform)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function looksLikeOrganizationCompareName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return /\b(?:software|softwere|softw|studio|studios|games|interactive|entertainment|digital|publishing|publisher|developer|inc|corp|llc|ltd|gmbh|s\.?a\.?)\b/i.test(normalized)
    || /(?:soft|ware|works|arts|games)$/i.test(normalized)
    || /[a-z][A-Z]/.test(name.trim());
}

async function resolveExplicitCompareEntitiesAttempt(params: {
  entityNames: string[];
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  timeoutMs: number;
}): Promise<{
  attempts: TigerShadowAttempt[];
  entityKind: 'developer' | 'game' | 'publisher' | null;
  entityUids: string[];
  selectionState: SessionChatSelectionState | null;
}> {
  if (params.entityNames.length < 2) {
    return {
      attempts: [
        buildSkippedAttempt(
          'resolveEntities',
          'The system could not infer two resolvable entities from the prompt.'
        ),
      ],
      entityKind: null,
      entityUids: [],
      selectionState: null,
    };
  }

  const allowBroadFallback = params.expectedEntityKind == null;
  const preferCompanyResolver =
    allowBroadFallback
    && params.entityNames.some((entityName) => looksLikeOrganizationCompareName(entityName));
  if (preferCompanyResolver) {
    const companyPass = await resolveExplicitCompareSlots({
      entityKinds: ['publisher', 'developer', 'game'],
      entityNames: params.entityNames,
      expectedEntityKind: null,
      resolutionPreference: 'company',
      strictResolver: false,
      timeoutMs: params.timeoutMs,
    });
    const companyAnalysis = analyzeExplicitCompareSlots({
      expectedEntityKind: null,
      slots: companyPass.slots,
    });

    return {
      attempts: appendExplicitCompareFailureAttempt(
        companyPass.attempts,
        companyAnalysis.failureReason
      ),
      entityKind: companyAnalysis.entityKind,
      entityUids: companyAnalysis.entityUids,
      selectionState: companyAnalysis.selectionState,
    };
  }

  const primaryPass = await resolveExplicitCompareSlots({
    entityNames: params.entityNames,
    expectedEntityKind: allowBroadFallback ? 'game' : params.expectedEntityKind,
    strictResolver: true,
    timeoutMs: params.timeoutMs,
  });
  const primaryAnalysis = analyzeExplicitCompareSlots({
    expectedEntityKind: allowBroadFallback ? 'game' : params.expectedEntityKind,
    slots: primaryPass.slots,
  });
  const shouldFallbackToBroadResolver =
    allowBroadFallback
    && (
      !primaryAnalysis.stable
      || primaryAnalysis.selectedCandidates.every(
        (candidate) => candidate.entityKind === 'game' && candidate.matchQuality === 'fuzzy'
      )
    );

  if (!shouldFallbackToBroadResolver) {
    return {
      attempts: appendExplicitCompareFailureAttempt(
        primaryPass.attempts,
        primaryAnalysis.failureReason
      ),
      entityKind: primaryAnalysis.entityKind,
      entityUids: primaryAnalysis.entityUids,
      selectionState: primaryAnalysis.selectionState,
    };
  }

  const fallbackPass = await resolveExplicitCompareSlots({
    entityNames: params.entityNames,
    expectedEntityKind: params.expectedEntityKind,
    strictResolver: false,
    timeoutMs: params.timeoutMs,
  });
  const fallbackAnalysis = analyzeExplicitCompareSlots({
    expectedEntityKind: params.expectedEntityKind,
    slots: fallbackPass.slots,
  });

  return {
    attempts: appendExplicitCompareFailureAttempt(
      [...primaryPass.attempts, ...fallbackPass.attempts],
      fallbackAnalysis.failureReason
    ),
    entityKind: fallbackAnalysis.entityKind,
    entityUids: fallbackAnalysis.entityUids,
    selectionState: fallbackAnalysis.selectionState,
  };
}

async function resolveExplicitCompareSlots(params: {
  entityKinds?: SessionSelectionEntityKind[] | null;
  entityNames: string[];
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  resolutionPreference?: EntityResolutionPreference;
  strictResolver: boolean;
  timeoutMs: number;
}): Promise<CompareSlotResolutionResult> {
  const resolved = await Promise.all(
    params.entityNames.map((entityName, index) =>
      resolveSelectionSlotAttempt({
        entityKinds: params.entityKinds,
        expectedEntityKind: params.expectedEntityKind,
        label: entityName,
        query: entityName,
        resolutionPreference: params.resolutionPreference,
        slotId: `compare:${index}`,
        strictResolver: params.strictResolver,
        timeoutMs: params.timeoutMs,
      })
    )
  );

  return {
    attempts: resolved.map((result) => result.attempt),
    slots: resolved.map((result) => result.slot),
  };
}

function analyzeExplicitCompareSlots(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  slots: RankedSelectionSlot[];
}): ExplicitCompareAnalysisResult {
  const groupResult = pickCompareResolutionGroup({
    expectedEntityKind: params.expectedEntityKind,
    slots: params.slots,
  });
  const selectedCandidates = groupResult.group
    ? params.slots.map((slot) =>
        pickResolvedCompareEntityForGroup({
          group: groupResult.group!,
          slot,
        })
      )
    : [];
  const normalizedSlots = params.slots.map((slot, index) => ({
    ...slot,
    requiresClarification: groupResult.requiresClarification || !selectedCandidates[index],
    selectedEntityUid:
      !groupResult.requiresClarification && groupResult.group
        ? selectedCandidates[index]?.entityUid ?? null
        : null,
  }));
  const selectionState = buildSelectionState({
    family: 'entity_compare',
    slots: normalizedSlots,
  });

  if (!groupResult.group) {
    return {
      entityKind: null,
      entityUids: [],
      failureReason: 'The system could not resolve all peers to the same entity kind and platform.',
      selectedCandidates: [],
      selectionState,
      stable: false,
    };
  }

  if (groupResult.requiresClarification) {
    return {
      entityKind: groupResult.group.entityKind,
      entityUids: [],
      failureReason: null,
      selectedCandidates: selectedCandidates.filter(
        (candidate): candidate is RankedSelectionCandidate => Boolean(candidate)
      ),
      selectionState,
      stable: false,
    };
  }

  const entityUids = selectedCandidates.map((candidate) => candidate?.entityUid ?? null);

  if (entityUids.some((entityUid) => !entityUid)) {
    return {
      entityKind: null,
      entityUids: [],
      failureReason: 'The system could not resolve every peer to a stable shared entity type.',
      selectedCandidates: selectedCandidates.filter(
        (candidate): candidate is RankedSelectionCandidate => Boolean(candidate)
      ),
      selectionState,
      stable: false,
    };
  }

  const uniqueEntityUids = [...new Set(entityUids.filter((entityUid): entityUid is string => Boolean(entityUid)))];
  if (uniqueEntityUids.length < 2) {
    return {
      entityKind: null,
      entityUids: [],
      failureReason: 'The comparison collapsed to fewer than two distinct peers.',
      selectedCandidates: selectedCandidates.filter(
        (candidate): candidate is RankedSelectionCandidate => Boolean(candidate)
      ),
      selectionState,
      stable: false,
    };
  }

  return {
    entityKind: groupResult.group.entityKind,
    entityUids: uniqueEntityUids,
    failureReason: null,
    selectedCandidates: selectedCandidates.filter(
      (candidate): candidate is RankedSelectionCandidate => Boolean(candidate)
    ),
    selectionState,
    stable: true,
  };
}

function appendExplicitCompareFailureAttempt(
  attempts: TigerShadowAttempt[],
  failureReason: string | null
): TigerShadowAttempt[] {
  if (!failureReason) {
    return attempts;
  }

  return [...attempts, buildSkippedAttempt('resolveEntities', failureReason)];
}

async function resolveDerivedCompareEntitiesAttempt(params: {
  metrics: CompareMetricName[];
  prompt: string;
  timeoutMs: number;
}): Promise<{
  attempts: TigerShadowAttempt[];
  entityKind: 'developer' | 'game' | 'publisher' | null;
  entityUids: string[];
}> {
  const compareSeedPrompt = stripCompareLeadIn(params.prompt);
  const topCount = extractRequestedTopCount(compareSeedPrompt, 5, 5);
  const rankingAttempt = buildRankingShadowRequest(compareSeedPrompt);

  if (rankingAttempt.request) {
    const startedAt = performance.now();
    const response = await postToQueryApi<RankEntitiesResponse>(
      '/v1/contracts/rank-entities',
      rankingAttempt.request,
      { timeoutMs: params.timeoutMs }
    );
    const timingMs = Math.round(performance.now() - startedAt);
    const attempts: TigerShadowAttempt[] = [];

    if (!response.ok) {
      attempts.push({
        contractName: 'rankEntities',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      });
      return { attempts, entityKind: rankingAttempt.request.entityKind, entityUids: [] };
    }

    attempts.push({
      contractName: 'rankEntities',
      httpStatus: response.httpStatus,
      resultCount: response.data?.items?.length ?? 0,
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
      timingMs,
    });

    const invalidMetricReason = validateCompareMetricsForEntityKind(
      rankingAttempt.request.entityKind,
      params.metrics
    );
    if (invalidMetricReason) {
      attempts.push(buildSkippedAttempt('compareEntities', invalidMetricReason));
      return { attempts, entityKind: rankingAttempt.request.entityKind, entityUids: [] };
    }

    const entityUids = extractEntityUidsFromRankResponse(response.data, Math.min(topCount, 5));
    if (entityUids.length < 2) {
      attempts.push(
        buildSkippedAttempt(
          'compareEntities',
          'The system could not derive a stable peer set from the ranking results.'
        )
      );
      return { attempts, entityKind: rankingAttempt.request.entityKind, entityUids: [] };
    }

    return {
      attempts,
      entityKind: rankingAttempt.request.entityKind,
      entityUids,
    };
  }

  const { reason, requests } = buildCatalogSearchPrimaryRequests(compareSeedPrompt);
  if (requests.length === 0) {
    return {
      attempts: [
        buildSkippedAttempt(
          'searchCatalog',
          reason ?? 'The system could not derive a supported catalog peer set from the prompt.'
        ),
        buildSkippedAttempt(
          'compareEntities',
          'The system did not find a supported derived peer-set strategy for this prompt.'
        ),
      ],
      entityKind: null,
      entityUids: [],
    };
  }

  const invalidMetricReason = validateCompareMetricsForEntityKind('game', params.metrics);
  if (invalidMetricReason) {
    return {
      attempts: [buildSkippedAttempt('compareEntities', invalidMetricReason)],
      entityKind: 'game',
      entityUids: [],
    };
  }

  const attempts: TigerShadowAttempt[] = [];
  for (const request of requests) {
    const catalogRequest: SearchCatalogShadowRequest = {
      ...request,
      limit: Math.min(request.limit ?? topCount, 5),
    };
    const startedAt = performance.now();
    const response = await postToQueryApi<SearchCatalogResponse>(
      '/v1/contracts/search-catalog',
      catalogRequest,
      { timeoutMs: params.timeoutMs }
    );
    const timingMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      attempts.push({
        contractName: 'searchCatalog',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      });
      return { attempts, entityKind: 'game', entityUids: [] };
    }

    attempts.push({
      contractName: 'searchCatalog',
      httpStatus: response.httpStatus,
      resultCount: response.data?.items?.length ?? 0,
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
      timingMs,
    });

    const entityUids = extractEntityUidsFromCatalogResponse(response.data, Math.min(topCount, 5));
    if (entityUids.length >= 2) {
      return { attempts, entityKind: 'game', entityUids };
    }
  }

  attempts.push(
    buildSkippedAttempt(
      'compareEntities',
      'The system could not derive at least two comparable peers from the current catalog results.'
    )
  );
  return { attempts, entityKind: 'game', entityUids: [] };
}

async function buildCompareRequestFromPrompt(params: {
  prompt: string;
  sessionContext: SessionChatContext | null;
  timeoutMs: number;
}): Promise<CompareRequestBuildResult> {
  const unsupportedReason = inferUnsupportedCompareReason(params.prompt);
  if (unsupportedReason) {
    return {
      attempts: [buildSkippedAttempt('compareEntities', unsupportedReason)],
      request: null,
    };
  }

  const metrics = extractCompareMetrics(params.prompt);
  const explicitEntityNames = parseCompareEntities(params.prompt);
  const expectedEntityKind = normalizeEntityKindHint(params.prompt);
  const topCount = extractRequestedTopCount(stripCompareLeadIn(params.prompt), 5, 5);
  const selectionState = params.sessionContext?.selectionState;

  if (selectionState?.family === 'entity_compare' && inferSelectionFollowUpIntent(params.prompt, params.sessionContext)) {
    const updatedSelection = applySelectionFollowUpState({
      prompt: params.prompt,
      selectionState,
    });
    if (updatedSelection.clarificationText) {
      return {
        attempts: [],
        clarificationText: updatedSelection.clarificationText,
        request: null,
        selectionState: updatedSelection.selectionState,
      };
    }

    const selectionRequest = buildCompareRequestFromSelectionState({
      metrics,
      selectionState: updatedSelection.selectionState,
      topCount,
    });
    return {
      attempts: [],
      request: selectionRequest,
      selectionState: updatedSelection.selectionState,
    };
  }

  if (explicitEntityNames.length >= 2) {
    const resolved = await resolveExplicitCompareEntitiesAttempt({
      entityNames: explicitEntityNames,
      expectedEntityKind,
      timeoutMs: readCompareResolutionTimeoutMs(),
    });
    const invalidMetricReason = validateCompareMetricsForEntityKind(resolved.entityKind, metrics);
    if (invalidMetricReason) {
      return {
        attempts: [...resolved.attempts, buildSkippedAttempt('compareEntities', invalidMetricReason)],
        request: null,
        selectionState: resolved.selectionState,
      };
    }

    if (resolved.selectionState?.slots.some((slot) => slot.requiresClarification)) {
      return {
        attempts: resolved.attempts,
        clarificationText: resolved.selectionState ? renderSelectionClarification(resolved.selectionState) : null,
        request: null,
        selectionState: resolved.selectionState,
      };
    }

    return {
      attempts:
        resolved.entityUids.length >= 2
          ? resolved.attempts
          : [
              ...resolved.attempts,
              buildSkippedAttempt(
                'compareEntities',
                'The comparison was skipped because it did not resolve to a stable peer set.'
              ),
            ],
      request:
        resolved.entityUids.length >= 2
          ? {
              entityUids: resolved.entityUids,
              ...(metrics.length > 0 ? { metrics } : {}),
            }
          : null,
      selectionState: resolved.selectionState,
    };
  }

  if (inferCompareFollowUpIntent(params.prompt, params.sessionContext)) {
    const sessionRequest = buildCompareRequestFromSessionContext({
      metrics,
      sessionContext: params.sessionContext,
      topCount,
    });
    if (sessionRequest) {
      return {
        attempts: [],
        request: sessionRequest,
        selectionState: params.sessionContext?.selectionState ?? null,
      };
    }
  }

  const derived = await resolveDerivedCompareEntitiesAttempt({
    metrics,
    prompt: params.prompt,
    timeoutMs: params.timeoutMs,
  });
  return {
    attempts: derived.attempts,
    request:
      derived.entityUids.length >= 2
        ? {
            entityUids: derived.entityUids,
            ...(metrics.length > 0 ? { metrics } : {}),
          }
        : null,
    selectionState: params.sessionContext?.selectionState ?? null,
  };
}

function buildCompareRequestFromSelectionState(params: {
  metrics: CompareMetricName[];
  selectionState: SessionChatSelectionState;
  topCount: number;
}): CompareEntitiesShadowRequest | null {
  const entityUids = params.selectionState.slots
    .map((slot) => slot.selectedEntityUid)
    .filter((entityUid): entityUid is string => Boolean(entityUid))
    .slice(0, Math.min(params.topCount, 5));

  if (entityUids.length < 2) {
    return null;
  }

  return {
    entityUids,
    ...(params.metrics.length > 0 ? { metrics: params.metrics } : {}),
  };
}

function buildCompareRequestFromSessionContext(params: {
  metrics: CompareMetricName[];
  sessionContext: SessionChatContext | null;
  topCount: number;
}): CompareEntitiesShadowRequest | null {
  const { metrics, sessionContext, topCount } = params;
  const candidateSet = sessionContext?.candidateSet;
  if (!candidateSet || candidateSet.ids.length < 2) {
    return null;
  }

  if (
    candidateSet.kind !== 'games'
    && candidateSet.kind !== 'publishers'
    && candidateSet.kind !== 'developers'
  ) {
    return null;
  }

  const entityKind =
    candidateSet.kind === 'games'
      ? 'game'
      : candidateSet.kind === 'publishers'
        ? 'publisher'
        : 'developer';
  const derivedEntityUids =
    candidateSet.entityUids?.length
      ? candidateSet.entityUids
      : candidateSet.ids
          .map((id) => buildChatEntityUid({ entityKind, platformEntityId: id }))
          .filter((value) => typeof value === 'string' && value.length > 0);

  const entityUids = [...new Set(derivedEntityUids)].slice(0, Math.min(topCount, 5));
  if (entityUids.length < 2) {
    return null;
  }

  return {
    entityUids,
    ...(metrics.length > 0 ? { metrics } : {}),
  };
}

async function runExplainChangesShadow(entityQuery: string | null): Promise<TigerShadowAttempt[]> {
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt({ query: entityQuery });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    attempts.push(
      buildSkippedAttempt(
        'explainChanges',
        'The explainChanges shadow path was skipped because no game entity could be resolved.'
      )
    );
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<ExplainChangesResponse>('/v1/contracts/explain-changes', {
    entityUid,
    includeNews: true,
    limit: 10,
  });
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'explainChanges',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'explainChanges',
    httpStatus: response.httpStatus,
    resultCount: response.data?.summary?.eventCount ?? response.data?.moments?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runExplainChangesPrimary(params: {
  entityQuery: string | null;
  prompt?: string | null;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  response: ExplainChangesResponse | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const { attempt: resolveAttempt, entity, entityUid, selectionState } = await resolveGameEntityAttempt({
    family: 'change_explanation',
    prompt: params.prompt,
    query: params.entityQuery,
    selectionState: params.selectionState,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    if (!selectionStateRequiresClarification(selectionState)) {
      attempts.push(
        buildSkippedAttempt(
          'explainChanges',
          'The change explanation path was skipped because no game entity could be resolved.'
        )
      );
    }
    return {
      attempts,
      clarificationText: selectionState ? renderSelectionClarification(selectionState) : null,
      response: null,
      selectionState,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<ExplainChangesResponse>('/v1/contracts/explain-changes', {
    entityUid,
    includeNews: true,
    limit: 10,
  });
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'explainChanges',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return { attempts, response: null, selectionState };
  }

  attempts.push({
    contractName: 'explainChanges',
    httpStatus: response.httpStatus,
    resultCount: response.data?.summary?.eventCount ?? response.data?.moments?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    response:
      (response.data?.moments?.length ?? 0) > 0 && response.data?.sufficientToAnswer
        ? {
            ...response.data,
            entity:
              response.data?.entity
              ?? (
                entity
                  ? {
                      displayName: entity.displayName,
                      entityKind: entity.entityKind,
                      entityUid: entity.entityUid,
                      platform: entity.platform,
                      platformEntityId: entity.platformEntityId,
                    }
                  : undefined
              ),
          } as ExplainChangesResponse
        : null,
    selectionState,
  };
}

function inferChangePattern(prompt: string): ChangePattern | null {
  if (/\bmarketing push\b/i.test(prompt)) {
    return 'marketing_push';
  }
  if (/\brelaunch pattern\b/i.test(prompt)) {
    return 'relaunch_pattern';
  }
  if (/\bteasing a big update\b/i.test(prompt)) {
    return 'update_tease';
  }
  if (/\bunder-marketed\b|\bagency leads\b/i.test(prompt)) {
    return 'under_marketed';
  }
  if (/\bsignable indie games\b/i.test(prompt)) {
    return 'signable_candidate';
  }
  if (/\brescue candidate\b/i.test(prompt)) {
    return 'rescue_candidate';
  }
  if (/\bsustained response\b/i.test(prompt)) {
    return 'sustained_response';
  }
  if (/\bannouncement\b.*\bweak\b|\bweak\b.*\bannouncement\b/i.test(prompt)) {
    return 'announcement_weak_response';
  }

  return null;
}

function buildSearchChangeActivityRequest(prompt: string): {
  request: {
    appTypes: string[];
    days: number;
    limit: number;
    mode: 'all' | 'announcements' | 'changes';
    query: string | null;
    signalFamilies: ChangeActivitySignalFamily[];
    sort: 'relevant' | 'newest' | 'biggest-change' | 'most-commercial' | 'most-launch-relevant';
    view: 'overview' | 'launch-watch' | 'commercial-moves' | 'store-refreshes' | 'all-activity';
  };
  requireNoAnnouncement: boolean;
} {
  const days = parsePromptDays(prompt, 30);
  const requireNoAnnouncement = /\bwithout an announcement\b/i.test(prompt);
  const signalFamilies = new Set<ChangeActivitySignalFamily>();
  let view: 'overview' | 'launch-watch' | 'commercial-moves' | 'store-refreshes' | 'all-activity' = 'overview';
  let sort: 'relevant' | 'newest' | 'biggest-change' | 'most-commercial' | 'most-launch-relevant' = 'relevant';

  if (/\b(?:steam page refresh|page refresh|store-?page changes?)\b/i.test(prompt)) {
    signalFamilies.add('store-page');
    signalFamilies.add('media');
    view = 'store-refreshes';
    sort = 'biggest-change';
  }

  if (/\b(?:screenshots?|trailers?)\b/i.test(prompt)) {
    signalFamilies.add('media');
    view = 'store-refreshes';
    sort = 'biggest-change';
  }

  if (/\brelease timing changes?\b/i.test(prompt)) {
    signalFamilies.add('release');
    view = 'launch-watch';
    sort = 'most-launch-relevant';
  }

  if (/\b(?:changed tags?|genres?)\b/i.test(prompt)) {
    signalFamilies.add('taxonomy');
  }

  if (/\bcommercial\b|\bpricing\b/i.test(prompt)) {
    signalFamilies.add('pricing');
    view = 'commercial-moves';
    sort = 'most-commercial';
  }

  return {
    request: {
      appTypes: ['game'],
      days,
      limit: 8,
      mode: 'changes',
      query: null,
      signalFamilies: Array.from(signalFamilies),
      sort,
      view,
    },
    requireNoAnnouncement,
  };
}

function filterSearchChangeActivityItems(params: {
  items: NonNullable<SearchChangeActivityResponse['items']>;
  requireNoAnnouncement: boolean;
}): NonNullable<SearchChangeActivityResponse['items']> {
  let filtered = params.items;

  if (params.requireNoAnnouncement) {
    filtered = filtered.filter(
      (item) => item.relatedAnnouncementCount === 0 && !item.signalFamilies.includes('announcement')
    );
  }

  return filtered;
}

function isProspectDiscoveryPrompt(prompt: string): boolean {
  return PROSPECT_DISCOVERY_PROMPT_PATTERN.test(prompt);
}

function buildProspectPatternPlan(prompt: string): ChangePattern[] {
  const patterns = new Set<ChangePattern>([
    'under_marketed',
    'announcement_weak_response',
  ]);

  if (/\b(?:agency|prospects?|signable|marketing[- ]agency)\b/i.test(prompt)) {
    patterns.add('signable_candidate');
  }

  if (/\b(?:timing|right now|this week|this month|recent|fresh)\b/i.test(prompt)) {
    patterns.add('update_tease');
    patterns.add('sustained_response');
  }

  if (/\b(?:live[- ]service|frequently updated|ongoing|recently updated|updated often)\b/i.test(prompt)) {
    patterns.add('update_tease');
    patterns.add('sustained_response');
  }

  return [...patterns];
}

function scoreProspectRecency(occurredAt: string): number {
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return 4;
  }

  const ageDays = Math.max(0, Math.round((Date.now() - occurredAtMs) / (24 * 60 * 60 * 1000)));
  if (ageDays <= 7) {
    return 10;
  }
  if (ageDays <= 14) {
    return 8;
  }
  if (ageDays <= 30) {
    return 6;
  }
  if (ageDays <= 60) {
    return 4;
  }

  return 3;
}

function buildProspectPatternNeedWeight(pattern: ChangePattern): number {
  switch (pattern) {
    case 'under_marketed':
      return 3.8;
    case 'announcement_weak_response':
      return 3.2;
    case 'signable_candidate':
      return 3.4;
    case 'update_tease':
      return 1.4;
    case 'sustained_response':
      return 1.6;
    default:
      return 1;
  }
}

function buildProspectPatternTimingWeight(pattern: ChangePattern): number {
  switch (pattern) {
    case 'update_tease':
      return 2.6;
    case 'sustained_response':
      return 2.3;
    case 'announcement_weak_response':
      return 1.8;
    case 'under_marketed':
      return 1.4;
    case 'signable_candidate':
      return 1.5;
    default:
      return 1;
  }
}

async function runProspectDiscoveryPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  response: ProspectRankingResponse | null;
}> {
  const timeoutMs = Math.max(readPrimaryTimeoutMs(), 20000);
  const patternPlan = buildProspectPatternPlan(prompt);
  const days = parsePromptDays(prompt, 30);
  const limit = extractRequestedTopCount(prompt, 8, 12);
  const attempts: TigerShadowAttempt[] = [];

  const responses = await Promise.all(
    patternPlan.map(async (pattern) => {
      const request = {
        appTypes: ['game'],
        days,
        limit: 8,
        pattern,
        query: null,
      };
      const startedAt = performance.now();
      const response = await postToQueryApi<DiscoverChangePatternsResponse>(
        '/v1/contracts/discover-change-patterns',
        request,
        { timeoutMs }
      );
      const timingMs = Math.round(performance.now() - startedAt);

      attempts.push({
        contractName: 'discoverChangePatterns',
        errorCode: response.ok ? undefined : response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.ok ? undefined : response.reason,
        resultCount: response.data?.items?.length ?? 0,
        status: response.ok ? 'success' : 'error',
        sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
        timingMs,
      });

      return {
        pattern,
        response,
      };
    })
  );

  const scoredCandidates = new Map<number, {
    appid: number;
    evidenceSummary: string[];
    highConfidenceCount: number;
    latestSignalAt: string;
    name: string;
    needWeight: number;
    patternSignals: Set<ChangePattern>;
    proofCount: number;
    timingWeight: number;
  }>();

  for (const result of responses) {
    if (!result.response.ok || !result.response.data?.sufficientToAnswer) {
      continue;
    }

    for (const item of result.response.data.items ?? []) {
      const current = scoredCandidates.get(item.appid) ?? {
        appid: item.appid,
        evidenceSummary: [],
        highConfidenceCount: 0,
        latestSignalAt: item.occurredAt,
        name: item.name,
        needWeight: 0,
        patternSignals: new Set<ChangePattern>(),
        proofCount: 0,
        timingWeight: 0,
      };

      current.latestSignalAt = current.latestSignalAt > item.occurredAt ? current.latestSignalAt : item.occurredAt;
      current.name = current.name || item.name;
      current.needWeight += buildProspectPatternNeedWeight(result.pattern);
      current.timingWeight += buildProspectPatternTimingWeight(result.pattern);
      current.patternSignals.add(result.pattern);

      if (item.confidence === 'high') {
        current.highConfidenceCount += 1;
      }
      if (item.primaryProof?.headline || item.primaryProof?.summary) {
        current.proofCount += 1;
      }

      for (const evidence of [
        item.primaryProof?.headline ?? null,
        item.primaryProof?.summary ?? null,
        ...(item.reasons ?? []),
      ]) {
        if (!evidence || current.evidenceSummary.includes(evidence)) {
          continue;
        }

        current.evidenceSummary.push(evidence);
        if (current.evidenceSummary.length >= 4) {
          break;
        }
      }

      scoredCandidates.set(item.appid, current);
    }
  }

  const items = [...scoredCandidates.values()]
    .map((candidate) => {
      const recencyScore = scoreProspectRecency(candidate.latestSignalAt);
      const needScore = Math.min(10, Number((2.4 + candidate.needWeight).toFixed(1)));
      const timingScore = Math.min(
        10,
        Number((Math.max(recencyScore, 4) * 0.6 + candidate.timingWeight).toFixed(1))
      );
      const evidenceQualityScore = Math.min(
        10,
        Number((
          2
          + candidate.patternSignals.size * 1.6
          + candidate.proofCount * 1.2
          + candidate.highConfidenceCount * 0.8
        ).toFixed(1))
      );
      const totalScore = Number((
        needScore * 0.45
        + timingScore * 0.3
        + evidenceQualityScore * 0.25
      ).toFixed(1));

      return {
        appid: candidate.appid,
        evidenceQualityScore,
        evidenceSummary: candidate.evidenceSummary.slice(0, 3),
        latestSignalAt: candidate.latestSignalAt,
        name: candidate.name,
        needScore,
        patternSignals: [...candidate.patternSignals],
        timingScore,
        totalScore,
      };
    })
    .sort((left, right) =>
      right.totalScore - left.totalScore
      || right.evidenceQualityScore - left.evidenceQualityScore
      || right.timingScore - left.timingScore
      || left.name.localeCompare(right.name)
    )
    .slice(0, limit);

  if (items.length === 0) {
    attempts.push(
      buildSkippedAttempt(
        'discoverChangePatterns',
        'The system did not find a stable prospect set across the current change-pattern screens.'
      )
    );

    return {
      attempts,
      response: null,
    };
  }

  return {
    attempts,
    response: {
      interpretedFilters: {
        mode: 'prospect_ranking',
        patterns: patternPlan,
      },
      items,
      kind: 'prospect_ranking',
      sufficientToAnswer: true,
    },
  };
}

async function runProspectDiscoveryShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  const result = await runProspectDiscoveryPrimary(prompt);
  return result.attempts;
}

async function runChangeDiscoveryPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  response: DiscoverChangePatternsResponse | ProspectRankingResponse | SearchChangeActivityResponse | null;
}> {
  if (isProspectDiscoveryPrompt(prompt)) {
    return runProspectDiscoveryPrimary(prompt);
  }

  const timeoutMs = Math.max(readPrimaryTimeoutMs(), 20000);
  const pattern = inferChangePattern(prompt);

  if (pattern) {
    const request = {
      appTypes: ['game'],
      days: parsePromptDays(prompt, 30),
      limit: 8,
      pattern,
      query: null,
    };
    const startedAt = performance.now();
    const response = await postToQueryApi<DiscoverChangePatternsResponse>(
      '/v1/contracts/discover-change-patterns',
      request,
      { timeoutMs }
    );
    const timingMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        attempts: [{
          contractName: 'discoverChangePatterns',
          errorCode: response.errorCode,
          httpStatus: response.httpStatus,
          reason: response.reason,
          status: 'error',
          timingMs,
        }],
        response: null,
      };
    }

    return {
      attempts: [{
        contractName: 'discoverChangePatterns',
        httpStatus: response.httpStatus,
        resultCount: response.data?.items?.length ?? 0,
        status: 'success',
        sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
        timingMs,
      }],
      response:
        (response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer
          ? response.data ?? null
          : null,
    };
  }

  const built = buildSearchChangeActivityRequest(prompt);
  const startedAt = performance.now();
  const response = await postToQueryApi<SearchChangeActivityResponse>(
    '/v1/contracts/search-change-activity',
    built.request,
    { timeoutMs }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'searchChangeActivity',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      response: null,
    };
  }

  const items = filterSearchChangeActivityItems({
    items: response.data?.items ?? [],
    requireNoAnnouncement: built.requireNoAnnouncement,
  });

  return {
    attempts: [{
      contractName: 'searchChangeActivity',
      httpStatus: response.httpStatus,
      resultCount: items.length,
      status: 'success',
      sufficientToAnswer: (response.data?.sufficientToAnswer ?? false) && items.length > 0,
      timingMs,
    }],
    response:
      (response.data?.sufficientToAnswer ?? false) && items.length > 0
        ? {
            ...(response.data ?? {}),
            items,
          }
        : null,
  };
}

async function runChangeDiscoveryShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  if (isProspectDiscoveryPrompt(prompt)) {
    return runProspectDiscoveryShadow(prompt);
  }

  const timeoutMs = Math.max(readShadowTimeoutMs(), 20000);
  const pattern = inferChangePattern(prompt);

  if (pattern) {
    const startedAt = performance.now();
    const response = await postToQueryApi<DiscoverChangePatternsResponse>(
      '/v1/contracts/discover-change-patterns',
      {
        appTypes: ['game'],
        days: parsePromptDays(prompt, 30),
        limit: 8,
        pattern,
        query: null,
      },
      { timeoutMs }
    );
    const timingMs = Math.round(performance.now() - startedAt);

    return [{
      contractName: 'discoverChangePatterns',
      errorCode: response.ok ? undefined : response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.ok ? undefined : response.reason,
      resultCount: response.data?.items?.length ?? 0,
      status: response.ok ? 'success' : 'error',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
      timingMs,
    }];
  }

  const built = buildSearchChangeActivityRequest(prompt);
  const startedAt = performance.now();
  const response = await postToQueryApi<SearchChangeActivityResponse>(
    '/v1/contracts/search-change-activity',
    built.request,
    { timeoutMs }
  );
  const timingMs = Math.round(performance.now() - startedAt);
  const items = filterSearchChangeActivityItems({
    items: response.data?.items ?? [],
    requireNoAnnouncement: built.requireNoAnnouncement,
  });

  return [{
    contractName: 'searchChangeActivity',
    errorCode: response.ok ? undefined : response.errorCode,
    httpStatus: response.httpStatus,
    reason: response.ok ? undefined : response.reason,
    resultCount: items.length,
    status: response.ok ? 'success' : 'error',
    sufficientToAnswer: (response.data?.sufficientToAnswer ?? false) && items.length > 0,
    timingMs,
  }];
}

async function runSimilarityMomentumComposition(params: {
  prompt: string;
  timeoutMs: number;
}): Promise<{
  attempts: TigerShadowAttempt[];
  momentumPromptFamily?: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest | null;
  response: (DiscoverMomentumResponse & {
    reference?: {
      id?: number;
      name?: string;
      type?: string;
    } | null;
  }) | null;
}> {
  const semanticBuilt = buildSemanticRequestFromPrompt(params.prompt, {
    allowMomentumMix: true,
  });
  if (!semanticBuilt.request || semanticBuilt.request.mode !== 'similarity') {
    return {
      attempts: [
        buildSkippedAttempt(
          'semanticSearch',
          semanticBuilt.reason ?? 'The system could not derive a stable similarity seed set.'
        ),
      ],
      momentumPromptFamily: null,
      request: null,
      response: null,
    };
  }

  const semanticRequest: SemanticSearchShadowRequest = {
    ...semanticBuilt.request,
    limit: Math.max(semanticBuilt.request.limit ?? 0, 18),
  };
  const attempts: TigerShadowAttempt[] = [];

  const semanticStartedAt = performance.now();
  const semanticResponse = await postToQueryApi<SemanticSearchResponse>(
    '/v1/contracts/semantic-search',
    semanticRequest,
    { timeoutMs: params.timeoutMs }
  );
  const semanticTimingMs = Math.round(performance.now() - semanticStartedAt);

  if (!semanticResponse.ok) {
    attempts.push({
      contractName: 'semanticSearch',
      errorCode: semanticResponse.errorCode,
      httpStatus: semanticResponse.httpStatus,
      reason: semanticResponse.reason,
      status: 'error',
      timingMs: semanticTimingMs,
    });
    return {
      attempts,
      momentumPromptFamily: null,
      request: null,
      response: null,
    };
  }

  const similarityResultCount = semanticResponse.data?.results?.length ?? 0;
  const similaritySufficient = Boolean(
    (semanticResponse.data?.sufficientToAnswer ?? semanticResponse.data?.sufficient_to_answer ?? false)
    && similarityResultCount > 0
  );
  attempts.push({
    contractName: 'semanticSearch',
    httpStatus: semanticResponse.httpStatus,
    resultCount: similarityResultCount,
    status: 'success',
    sufficientToAnswer: similaritySufficient,
    timingMs: semanticTimingMs,
  });

  const referenceAppid =
    semanticResponse.data?.reference?.type === 'game'
      ? normalizeNumber(semanticResponse.data.reference.id)
      : null;
  const similaritySeedAppids = extractSemanticResultAppids(
    semanticResponse.data,
    18,
    referenceAppid != null ? [referenceAppid] : []
  );

  if (!similaritySufficient || similaritySeedAppids.length === 0) {
    attempts.push(
      buildSkippedAttempt(
        'discoverMomentum',
        'The similarity seed set was too thin to build a stable momentum screen.'
      )
    );
    return {
      attempts,
      momentumPromptFamily: null,
      request: null,
      response: null,
    };
  }

  const momentumBuilt = buildMomentumPrimaryRequest(params.prompt);
  if (!momentumBuilt.request) {
    attempts.push(
      buildSkippedAttempt(
        'discoverMomentum',
        momentumBuilt.reason ?? 'The system could not build a supported momentum request.'
      )
    );
    return {
      attempts,
      momentumPromptFamily: momentumBuilt.momentumPromptFamily ?? null,
      request: null,
      response: null,
    };
  }

  const momentumRequest: DiscoverMomentumShadowRequest = {
    ...momentumBuilt.request,
    appids: similaritySeedAppids,
    limit: Math.min(momentumBuilt.request.limit ?? 8, similaritySeedAppids.length),
  };
  const momentumPromptFamily =
    momentumBuilt.momentumPromptFamily ?? inferMomentumRequestFamily(momentumRequest);

  const momentumStartedAt = performance.now();
  const momentumResponse = await postToQueryApi<DiscoverMomentumResponse>(
    '/v1/contracts/discover-momentum',
    momentumRequest,
    { timeoutMs: params.timeoutMs }
  );
  const momentumTimingMs = Math.round(performance.now() - momentumStartedAt);

  if (!momentumResponse.ok) {
    attempts.push({
      contractName: 'discoverMomentum',
      errorCode: momentumResponse.errorCode,
      httpStatus: momentumResponse.httpStatus,
      reason: momentumResponse.reason,
      status: 'error',
      timingMs: momentumTimingMs,
    });
    return {
      attempts,
      momentumPromptFamily,
      request: momentumRequest,
      response: null,
    };
  }

  const momentumResultCount = momentumResponse.data?.items?.length ?? 0;
  const momentumSufficient = Boolean(
    (momentumResponse.data?.sufficientToAnswer ?? false) && momentumResultCount > 0
  );
  if (!momentumSufficient && shouldRetrySparseMomentumRequest({
    explicitReviewTrendFloors: null,
    policy: null,
    promptFamily: momentumPromptFamily,
    request: momentumRequest,
    resultCount: momentumResultCount,
    sufficientToAnswer: momentumSufficient,
  })) {
    const relaxedRequest = buildRelaxedSparseMomentumRequest({
      explicitReviewTrendFloors: null,
      promptFamily: momentumPromptFamily,
      request: momentumRequest,
    });
    const retryStartedAt = performance.now();
    const retryResponse = await postToQueryApi<DiscoverMomentumResponse>(
      '/v1/contracts/discover-momentum',
      relaxedRequest,
      { timeoutMs: params.timeoutMs }
    );
    const retryTimingMs = Math.round(performance.now() - retryStartedAt);

    if (!retryResponse.ok) {
      attempts.push(
        {
          contractName: 'discoverMomentum',
          httpStatus: momentumResponse.httpStatus,
          reason: 'The similarity seed set was too sparse for the first momentum screen, so the system retried with a relaxed momentum view.',
          resultCount: momentumResultCount,
          status: 'skipped',
          sufficientToAnswer: momentumSufficient,
          timingMs: momentumTimingMs,
        },
        {
          contractName: 'discoverMomentum',
          errorCode: retryResponse.errorCode,
          httpStatus: retryResponse.httpStatus,
          reason: retryResponse.reason,
          status: 'error',
          timingMs: retryTimingMs,
        }
      );

      return {
        attempts,
        momentumPromptFamily,
        request: relaxedRequest,
        response: null,
      };
    }

    const retryResultCount = retryResponse.data?.items?.length ?? 0;
    const retrySufficient = Boolean(
      (retryResponse.data?.sufficientToAnswer ?? false) && retryResultCount > 0
    );

    attempts.push(
      {
        contractName: 'discoverMomentum',
        httpStatus: momentumResponse.httpStatus,
        reason: 'The similarity seed set was too sparse for the first momentum screen, so the system retried with a relaxed momentum view.',
        resultCount: momentumResultCount,
        status: 'skipped',
        sufficientToAnswer: momentumSufficient,
        timingMs: momentumTimingMs,
      },
      {
        contractName: 'discoverMomentum',
        httpStatus: retryResponse.httpStatus,
        reason: retrySufficient
          ? undefined
          : 'The relaxed momentum screen still did not find enough active matches inside the similarity seed set.',
        resultCount: retryResultCount,
        status: retrySufficient ? 'success' : 'skipped',
        sufficientToAnswer: retrySufficient,
        timingMs: retryTimingMs,
      }
    );

    return {
      attempts,
      momentumPromptFamily,
      request: relaxedRequest,
      response:
        retrySufficient
          ? {
              ...(retryResponse.data ?? {}),
              reference: semanticResponse.data?.reference
                ?? (
                  semanticRequest.referenceQuery
                    ? {
                        name: semanticRequest.referenceQuery,
                        type: semanticRequest.entityKind,
                      }
                    : null
                ),
            }
          : null,
    };
  }

  attempts.push({
    contractName: 'discoverMomentum',
    httpStatus: momentumResponse.httpStatus,
    reason: momentumSufficient
      ? undefined
      : 'The momentum screen did not find enough active matches inside the similarity seed set.',
    resultCount: momentumResultCount,
    status: momentumSufficient ? 'success' : 'skipped',
    sufficientToAnswer: momentumSufficient,
    timingMs: momentumTimingMs,
  });

  return {
    attempts,
    momentumPromptFamily,
    request: momentumRequest,
    response:
      momentumSufficient
        ? {
            ...(momentumResponse.data ?? {}),
            reference: semanticResponse.data?.reference
              ?? (
                semanticRequest.referenceQuery
                  ? {
                      name: semanticRequest.referenceQuery,
                      type: semanticRequest.entityKind,
                    }
                  : null
              ),
          }
        : null,
  };
}

async function runMomentumPrimary(params: {
  prompt: string;
  requestOverride?: DiscoverMomentumShadowRequest | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  momentumPromptFamily?: MomentumPromptFamily | null;
  request: DiscoverMomentumShadowRequest | null;
  response: DiscoverMomentumResponse | null;
  scopeAdjustedForSparseResults?: boolean;
}> {
  if (!params.requestOverride && inferSimilarityMomentumIntent(params.prompt)) {
    return runSimilarityMomentumComposition({
      prompt: params.prompt,
      timeoutMs: readPrimaryTimeoutMs(),
    });
  }

  const built: MomentumBuildResult = params.requestOverride
    ? {
        explicitReviewTrendFloors: null,
        momentumPromptFamily: null,
        request: params.requestOverride,
      }
    : buildMomentumPrimaryRequest(params.prompt);
  if (!built.request) {
    return {
      attempts: [
        buildSkippedAttempt(
          'discoverMomentum',
          built.reason ?? 'The system could not infer a supported momentum request.'
        ),
      ],
      momentumPromptFamily: built.momentumPromptFamily ?? null,
      request: null,
      response: null,
    };
  }

  const momentumPromptFamily =
    built.momentumPromptFamily ?? inferMomentumRequestFamily(built.request);
  const startedAt = performance.now();
  const response = await postToQueryApi<DiscoverMomentumResponse>(
    '/v1/contracts/discover-momentum',
    built.request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'discoverMomentum',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      momentumPromptFamily,
      request: built.request,
      response: null,
    };
  }

  const resultCount = response.data?.items?.length ?? 0;
  const sufficientToAnswer = Boolean((response.data?.sufficientToAnswer ?? false) && resultCount > 0);
  const policy = getMomentumDiscoveryResultPolicy(built.request);

  if (shouldRetrySparseMomentumRequest({
    explicitReviewTrendFloors: built.explicitReviewTrendFloors ?? null,
    policy,
    promptFamily: momentumPromptFamily,
    request: built.request,
    resultCount,
    sufficientToAnswer,
  })) {
    const relaxedRequest = buildRelaxedSparseMomentumRequest({
      explicitReviewTrendFloors: built.explicitReviewTrendFloors ?? null,
      promptFamily: momentumPromptFamily,
      request: built.request,
    });
    const retryStartedAt = performance.now();
    const retryResponse = await postToQueryApi<DiscoverMomentumResponse>(
      '/v1/contracts/discover-momentum',
      relaxedRequest,
      { timeoutMs: readPrimaryTimeoutMs() }
    );
    const retryTimingMs = Math.round(performance.now() - retryStartedAt);

    if (!retryResponse.ok) {
      const retryReason = policy != null && resultCount > 0 && resultCount < policy.minimumItems
        ? `Only ${resultCount} ${resultCount === 1 ? 'title' : 'titles'} qualified on the first pass, below the ${policy.minimumItems}-result minimum, so the system retried with a relaxed popularity floor.`
        : 'The first momentum screen was too sparse, so the system retried with a relaxed momentum view.';

      return {
        attempts: [
          {
            contractName: 'discoverMomentum',
            httpStatus: response.httpStatus,
            reason: retryReason,
            resultCount,
            status: 'skipped',
            sufficientToAnswer,
            timingMs,
          },
          {
            contractName: 'discoverMomentum',
            errorCode: retryResponse.errorCode,
            httpStatus: retryResponse.httpStatus,
            reason: retryResponse.reason,
            status: 'error',
            timingMs: retryTimingMs,
          },
        ],
        momentumPromptFamily,
        request: relaxedRequest,
        response: null,
      };
    }

    const retryResultCount = retryResponse.data?.items?.length ?? 0;
    const retrySufficientToAnswer = Boolean(
      (retryResponse.data?.sufficientToAnswer ?? false) && retryResultCount > 0
    );
    const retryPolicy = getMomentumDiscoveryResultPolicy(relaxedRequest);
    const retryShortfallReason = retrySufficientToAnswer
      ? buildMomentumDiscoveryShortfallReason({
          broadeningApplied: true,
          policy: retryPolicy,
          promptFamily: momentumPromptFamily,
          request: relaxedRequest,
          resultCount: retryResultCount,
        })
      : null;
    const retryReason = policy != null && resultCount > 0 && resultCount < policy.minimumItems
      ? `Only ${resultCount} ${resultCount === 1 ? 'title' : 'titles'} qualified on the first pass, below the ${policy.minimumItems}-result minimum, so the system retried with a relaxed popularity floor.`
      : 'The first momentum screen was too sparse, so the system retried with a relaxed momentum view.';

    return {
      attempts: [
        {
          contractName: 'discoverMomentum',
          httpStatus: response.httpStatus,
          reason: retryReason,
          resultCount,
          status: 'skipped',
          sufficientToAnswer,
          timingMs,
        },
        {
          contractName: 'discoverMomentum',
          httpStatus: retryResponse.httpStatus,
          reason: retrySufficientToAnswer
            ? (retryShortfallReason ?? undefined)
            : 'The relaxed momentum screen still did not return a stable result set.',
          resultCount: retryResultCount,
          status: retrySufficientToAnswer ? 'success' : 'skipped',
          sufficientToAnswer: retrySufficientToAnswer,
          timingMs: retryTimingMs,
        },
      ],
      momentumPromptFamily,
      request: relaxedRequest,
      response:
        retrySufficientToAnswer && retryResponse.data
          ? decorateMomentumDiscoveryResponse({
              broadeningApplied: true,
              policy: retryPolicy,
              response: retryResponse.data,
              shortfallReason: retryShortfallReason,
            })
          : null,
      scopeAdjustedForSparseResults: retrySufficientToAnswer,
    };
  }

  const shortfallReason = sufficientToAnswer
    ? buildMomentumDiscoveryShortfallReason({
        broadeningApplied: false,
        policy,
        promptFamily: momentumPromptFamily,
        request: built.request,
        resultCount,
      })
    : null;

  return {
    attempts: [{
      contractName: 'discoverMomentum',
      httpStatus: response.httpStatus,
      reason: sufficientToAnswer
        ? (shortfallReason ?? undefined)
        : 'The system did not return a stable momentum set for this prompt.',
      resultCount,
      status: sufficientToAnswer ? 'success' : 'skipped',
      sufficientToAnswer,
      timingMs,
    }],
    momentumPromptFamily,
    request: built.request,
    response:
      sufficientToAnswer && response.data
        ? decorateMomentumDiscoveryResponse({
            broadeningApplied: false,
            policy,
            response: response.data,
            shortfallReason,
          })
        : null,
  };
}

async function runMomentumShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  if (inferSimilarityMomentumIntent(prompt)) {
    const result = await runSimilarityMomentumComposition({
      prompt,
      timeoutMs: readShadowTimeoutMs(),
    });
    return result.attempts;
  }

  const built = buildMomentumPrimaryRequest(prompt);
  if (!built.request) {
    return [
      buildSkippedAttempt(
        'discoverMomentum',
        built.reason ?? 'The system could not infer a supported momentum request.'
      ),
    ];
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<DiscoverMomentumResponse>(
    '/v1/contracts/discover-momentum',
    built.request,
    { timeoutMs: readShadowTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);
  const resultCount = response.data?.items?.length ?? 0;
  const sufficientToAnswer = Boolean((response.data?.sufficientToAnswer ?? false) && resultCount > 0);

  return [{
    contractName: 'discoverMomentum',
    errorCode: response.ok ? undefined : response.errorCode,
    httpStatus: response.httpStatus,
    reason: response.ok
      ? (sufficientToAnswer ? undefined : 'The system did not return a stable momentum set for this prompt.')
      : response.reason,
    resultCount,
    status: response.ok
      ? (sufficientToAnswer ? 'success' : 'skipped')
      : 'error',
    sufficientToAnswer,
    timingMs,
  }];
}

async function buildSearchDocumentsRequest(params: {
  entityQuery: string | null;
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  request: {
    endTime: string;
    entityUids?: string[];
    limit: number;
    mode: 'digest' | 'latest_item' | 'topic_search';
    query?: string | null;
    startTime: string;
  } | null;
  selectionState?: SessionChatSelectionState | null;
}> {
  const explicitTargets = extractExplicitNewsTargets(params.prompt);
  const resolvedTargets = explicitTargets.length > 0
    ? explicitTargets
    : params.entityQuery
      ? [params.entityQuery]
      : [];
  const useDigestMode = shouldUseDigestNewsMode(params.prompt, resolvedTargets);
  const useLatestMode = !useDigestMode && shouldUseLatestNewsMode(params.prompt, params.entityQuery);
  const days = resolveDocumentSearchWindowDays(params.prompt, params.entityQuery);
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date().toISOString();

  if (resolvedTargets.length > 0) {
    const selectedCandidate = pickSelectedCandidateFromSelectionState(params.selectionState);
    if (
      params.selectionState?.family === 'news_search'
      && selectedCandidate?.entityKind === 'game'
      && resolvedTargets.length === 1
    ) {
      return {
        attempts: [{
          contractName: 'resolveEntities',
          reason: 'Reused the current entity selection from session context.',
          status: 'success',
          sufficientToAnswer: true,
        }],
        request: {
          endTime,
          entityUids: [selectedCandidate.entityUid],
          limit: useLatestMode ? 3 : 6,
          mode: useDigestMode ? 'digest' : useLatestMode ? 'latest_item' : 'topic_search',
          startTime,
          ...(!useDigestMode && !useLatestMode
            ? { query: buildNewsTopicQuery(params.prompt, params.entityQuery) }
            : {}),
        },
        selectionState: params.selectionState ?? null,
      };
    }

    if (resolvedTargets.length === 1) {
      const resolved = await resolveGameEntityAttempt({
        family: 'news_search',
        prompt: params.prompt,
        query: resolvedTargets[0] ?? null,
        selectionState: params.selectionState,
      });
      if (!resolved.entityUid) {
        return { attempts: [resolved.attempt], request: null, selectionState: resolved.selectionState };
      }

      return {
        attempts: [resolved.attempt],
        request: {
          endTime,
          entityUids: [resolved.entityUid],
          limit: useLatestMode ? 3 : 6,
          mode: useDigestMode ? 'digest' : useLatestMode ? 'latest_item' : 'topic_search',
          startTime,
          ...(!useDigestMode && !useLatestMode
            ? { query: buildNewsTopicQuery(params.prompt, params.entityQuery) }
            : {}),
        },
        selectionState: resolved.selectionState,
      };
    }

    const resolved = await resolveGameEntityAttempts(resolvedTargets);
    if (resolved.entityUids.length === 0) {
      return { attempts: resolved.attempts, request: null, selectionState: null };
    }

    return {
      attempts: resolved.attempts,
      request: {
        endTime,
        entityUids: resolved.entityUids,
        limit: useLatestMode ? 3 : 6,
        mode: useDigestMode ? 'digest' : useLatestMode ? 'latest_item' : 'topic_search',
        startTime,
        ...(!useDigestMode && !useLatestMode
          ? { query: buildNewsTopicQuery(params.prompt, params.entityQuery) }
          : {}),
      },
      selectionState: null,
    };
  }

  return {
    attempts: [
      buildSkippedAttempt(
        'resolveEntities',
        'No game entity hint was available, so the news lookup ran without an entity filter.'
      ),
    ],
    request: {
      endTime,
      limit: 8,
      mode: 'topic_search',
      query: buildNewsTopicQuery(params.prompt, params.entityQuery),
      startTime,
    },
    selectionState: params.selectionState ?? null,
  };
}

async function runSearchDocumentsShadow(params: {
  entityQuery: string | null;
  prompt: string;
}): Promise<TigerShadowAttempt[]> {
  const builtRequest = await buildSearchDocumentsRequest(params);
  const attempts = [...builtRequest.attempts];

  if (!builtRequest.request) {
    attempts.push(
      buildSkippedAttempt(
        'searchDocuments',
        'The system could not build a supported news request from the prompt.'
      )
    );
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SearchDocumentsResponse>(
    '/v1/contracts/search-documents',
    builtRequest.request,
    { timeoutMs: readShadowTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'searchDocuments',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'searchDocuments',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runSearchDocumentsPrimary(params: {
  entityQuery: string | null;
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  response: SearchDocumentsResponse | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const builtRequest = await buildSearchDocumentsRequest(params);
  const attempts = [...builtRequest.attempts];

  if (!builtRequest.request) {
    if (!selectionStateRequiresClarification(builtRequest.selectionState)) {
      attempts.push(
        buildSkippedAttempt(
          'searchDocuments',
          'The system could not build a supported news request from the prompt.'
        )
      );
    }
    return {
      attempts,
      clarificationText: builtRequest.selectionState ? renderSelectionClarification(builtRequest.selectionState) : null,
      response: null,
      selectionState: builtRequest.selectionState ?? params.selectionState ?? null,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SearchDocumentsResponse>(
    '/v1/contracts/search-documents',
    builtRequest.request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'searchDocuments',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return { attempts, response: null, selectionState: builtRequest.selectionState ?? params.selectionState ?? null };
  }

  attempts.push({
    contractName: 'searchDocuments',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  const fallbackRequest = buildSparseSearchDocumentsFallbackRequest({
    entityQuery: params.entityQuery,
    prompt: params.prompt,
    request: builtRequest.request,
    response: response.data ?? null,
  });

  if (fallbackRequest) {
    const fallbackStartedAt = performance.now();
    const fallbackResponse = await postToQueryApi<SearchDocumentsResponse>(
      '/v1/contracts/search-documents',
      fallbackRequest,
      { timeoutMs: readPrimaryTimeoutMs() }
    );
    const fallbackTimingMs = Math.round(performance.now() - fallbackStartedAt);

    if (!fallbackResponse.ok) {
      attempts.push({
        contractName: 'searchDocuments',
        errorCode: fallbackResponse.errorCode,
        httpStatus: fallbackResponse.httpStatus,
        reason: fallbackResponse.reason,
        status: 'error',
        timingMs: fallbackTimingMs,
      });
    } else {
      attempts.push({
        contractName: 'searchDocuments',
        httpStatus: fallbackResponse.httpStatus,
        reason: 'Broadened to topic search after the entity-scoped news search came back sparse.',
        resultCount: fallbackResponse.data?.items?.length ?? 0,
        status: 'success',
        sufficientToAnswer: fallbackResponse.data?.sufficientToAnswer ?? false,
        timingMs: fallbackTimingMs,
      });

      if ((fallbackResponse.data?.items?.length ?? 0) > 0 && fallbackResponse.data?.sufficientToAnswer) {
        return {
          attempts,
          response: fallbackResponse.data ?? null,
          selectionState: builtRequest.selectionState ?? params.selectionState ?? null,
        };
      }
    }
  }

  return {
    attempts,
    response:
      (response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer
        ? response.data ?? null
        : null,
    selectionState: builtRequest.selectionState ?? params.selectionState ?? null,
  };
}

function buildSparseSearchDocumentsFallbackRequest(params: {
  entityQuery: string | null;
  prompt: string;
  request: {
    endTime: string;
    entityUids?: string[];
    limit: number;
    mode: 'digest' | 'latest_item' | 'topic_search';
    query?: string | null;
    startTime: string;
  };
  response: SearchDocumentsResponse | null;
}): {
  endTime: string;
  limit: number;
  mode: 'topic_search';
  query: string;
  startTime: string;
} | null {
  if (!params.entityQuery) {
    return null;
  }

  if (params.request.mode !== 'latest_item') {
    return null;
  }

  const resultCount = params.response?.items?.length ?? 0;
  const isSparse = resultCount === 0 || !params.response?.sufficientToAnswer;
  if (!isSparse) {
    return null;
  }

  const topicQuery = buildNewsTopicQuery(params.prompt, params.entityQuery).trim();
  if (!topicQuery) {
    return null;
  }

  if (!params.request.entityUids?.length) {
    return null;
  }

  return {
    endTime: params.request.endTime,
    limit: Math.max(params.request.limit, 6),
    mode: 'topic_search',
    query: topicQuery,
    startTime: params.request.startTime,
  };
}

async function runUserContextPrimary(params: {
  prompt: string;
  userId: string | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  request: {
    includeAlertPreferences: boolean;
    includeAlerts: boolean;
    includePins: boolean;
    limitAlerts: number;
    userId: string;
  } | null;
  response: GetUserContextResponse | null;
}> {
  if (!params.userId) {
    return {
      attempts: [
        buildSkippedAttempt(
          'getUserContext',
          'This request requires an authenticated user.'
        ),
      ],
      request: null,
      response: null,
    };
  }

  const focus = inferUserContextFocus(params.prompt);
  const request = {
    includeAlertPreferences: true,
    includeAlerts: focus !== 'pins',
    includePins: true,
    limitAlerts: focus === 'alerts' ? 12 : 5,
    userId: params.userId,
  };

  const startedAt = performance.now();
  const response = await postToQueryApi<GetUserContextResponse>(
    '/v1/contracts/get-user-context',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'getUserContext',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      request,
      response: null,
    };
  }

  return {
    attempts: [{
      contractName: 'getUserContext',
      httpStatus: response.httpStatus,
      resultCount: (response.data?.pins?.length ?? 0) + (response.data?.alerts?.length ?? 0),
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? true,
      timingMs,
    }],
    request,
    response: response.data ?? null,
  };
}

async function runCatalogSearchShadow(params: {
  prompt: string;
  toolCalls: ChatToolCall[];
}): Promise<TigerShadowAttempt[]> {
  const { request, reason } = buildCatalogSearchShadowRequest(params.prompt, params.toolCalls);

  if (!request) {
    return [buildSkippedAttempt('searchCatalog', reason ?? 'The system could not build a supported catalog request.')];
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SearchCatalogResponse>('/v1/contracts/search-catalog', request);
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return [{
      contractName: 'searchCatalog',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    }];
  }

  return [{
    contractName: 'searchCatalog',
    httpStatus: response.httpStatus,
    resultCount: (response.data?.items?.length ?? 0) || countCatalogFacetMatches(response.data),
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  }];
}

async function runSemanticSearchShadow(params: {
  prompt: string;
  toolCalls: ChatToolCall[];
}): Promise<TigerShadowAttempt[]> {
  const { request, reason } = buildSemanticSearchShadowRequest(params);

  if (!request) {
    return [buildSkippedAttempt('semanticSearch', reason ?? 'The system could not build a supported similarity request.')];
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SemanticSearchResponse>('/v1/contracts/semantic-search', request);
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return [{
      contractName: 'semanticSearch',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    }];
  }

  return [{
    contractName: 'semanticSearch',
    httpStatus: response.httpStatus,
    resultCount: response.data?.results?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? response.data?.sufficient_to_answer ?? false,
    timingMs,
  }];
}

async function runRankEntitiesShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  const { request, reason } = buildRankingShadowRequest(prompt);
  if (!request) {
    return [buildSkippedAttempt('rankEntities', reason ?? 'The system could not build a supported ranking request.')];
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<RankEntitiesResponse>('/v1/contracts/rank-entities', request);
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return [{
      contractName: 'rankEntities',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    }];
  }

  return [{
    contractName: 'rankEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  }];
}

async function runCompareEntitiesShadow(
  prompt: string,
  sessionContext: SessionChatContext | null
): Promise<TigerShadowAttempt[]> {
  const builtRequest = await buildCompareRequestFromPrompt({
    prompt,
    sessionContext,
    timeoutMs: readShadowTimeoutMs(),
  });
  const attempts = [...builtRequest.attempts];

  if (!builtRequest.request || builtRequest.request.entityUids.length < 2) {
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<CompareEntitiesResponse>(
    '/v1/contracts/compare-entities',
    builtRequest.request,
    { timeoutMs: readShadowTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'compareEntities',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'compareEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runMetricHistoryShadow(params: {
  entityQuery: string | null;
  prompt: string;
}): Promise<TigerShadowAttempt[]> {
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt({ query: params.entityQuery });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    attempts.push(
      buildSkippedAttempt(
        'traceMetricHistory',
        'The traceMetricHistory shadow path was skipped because no game entity could be resolved.'
      )
    );
    return attempts;
  }

  const request: TraceMetricHistoryShadowRequest = {
    entityUid,
    metrics: extractHistoryMetrics(params.prompt),
    ...parseHistoryWindow(params.prompt),
  };

  const startedAt = performance.now();
  const response = await postToQueryApi<TraceMetricHistoryResponse>('/v1/contracts/trace-metric-history', request);
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'traceMetricHistory',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'traceMetricHistory',
    httpStatus: response.httpStatus,
    resultCount: response.data?.series?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runEntityOverviewShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  const query = extractEntityOverviewQuery(prompt);
  const expectedEntityKind = inferEntityOverviewKindHint(prompt);
  const resolutionPreference = inferEntityOverviewResolutionPreference(prompt, expectedEntityKind);
  const { attempt: resolveAttempt, entity } = await resolveEntityOverviewPrimaryEntityAttempt({
    expectedEntityKind,
    prompt,
    query,
    resolutionPreference,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entity?.entityUid || !entity.entityKind) {
    attempts.push(
      buildSkippedAttempt(
        'getEntityOverview',
        'The entity overview path was skipped because no stable entity could be resolved.'
      )
    );
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<GetEntityOverviewResponse>(
    '/v1/contracts/get-entity-overview',
    {
      entityUid: entity.entityUid,
      entityKind: entity.entityKind,
      gamesLimit: entity.entityKind === 'game' ? 0 : 5,
      gamesSortBy: /\b(?:top|best)\b/i.test(prompt) ? 'reviews' : 'release_date',
      ...(entity.platformEntityId ? { platformEntityId: entity.platformEntityId } : {}),
    },
    { timeoutMs: readShadowTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'getEntityOverview',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'getEntityOverview',
    httpStatus: response.httpStatus,
    resultCount: response.data?.games?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runEntityOverviewPrimary(params: {
  explicitKindHint?: 'developer' | 'game' | 'publisher' | null;
  prompt: string;
  queryOverride?: string | null;
  selectionState?: SessionChatSelectionState | null;
  }): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  request: {
    entityUid: string;
    entityKind: 'developer' | 'game' | 'publisher';
    gamesLimit: number;
    gamesSortBy: 'release_date' | 'reviews';
    platformEntityId?: string;
  } | null;
  response: (GetEntityOverviewResponse & {
    viewMode: 'company_count' | 'company_games' | 'company_metrics' | 'game_overview';
  }) | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const query = params.queryOverride ?? extractEntityOverviewQuery(params.prompt);
  const expectedEntityKind = params.explicitKindHint ?? inferEntityOverviewKindHint(params.prompt);
  const resolutionPreference = inferEntityOverviewResolutionPreference(
    params.prompt,
    expectedEntityKind
  );
  const { attempt: resolveAttempt, entity, selectionState } = await resolveEntityOverviewPrimaryEntityAttempt({
    expectedEntityKind,
    family: 'entity_overview',
    prompt: params.prompt,
    query,
    resolutionPreference,
    selectionState: params.selectionState,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entity?.entityUid || !entity.entityKind) {
    attempts.push(
      buildSkippedAttempt(
        'getEntityOverview',
        'The entity overview path was skipped because the prompt did not resolve to a stable entity.'
      )
    );
    return {
      attempts,
      clarificationText: selectionState ? renderSelectionClarification(selectionState) : null,
      request: null,
      response: null,
      selectionState,
    };
  }

  const request = {
    entityUid: entity.entityUid,
    entityKind: entity.entityKind as 'developer' | 'game' | 'publisher',
    gamesLimit: entity.entityKind === 'game' ? 0 : 5,
    gamesSortBy: /\b(?:top|best)\b/i.test(params.prompt) ? 'reviews' as const : 'release_date' as const,
    ...(entity.platformEntityId ? { platformEntityId: entity.platformEntityId } : {}),
  };

  const startedAt = performance.now();
  const response = await postToQueryApi<GetEntityOverviewResponse>(
    '/v1/contracts/get-entity-overview',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'getEntityOverview',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return { attempts, request, response: null, selectionState };
  }

  const data = response.data;
  attempts.push({
    contractName: 'getEntityOverview',
    httpStatus: response.httpStatus,
    resultCount: data?.games?.length ?? 0,
    status: 'success',
    sufficientToAnswer: data?.sufficientToAnswer ?? false,
    timingMs,
  });

  if (!data?.sufficientToAnswer) {
    return { attempts, request, response: null, selectionState };
  }

  return {
    attempts,
    request,
    response: {
      ...data,
      viewMode: inferEntityOverviewViewMode(params.prompt, data.entity.entityKind),
    },
    selectionState,
  };
}

async function runRelatedEntitiesShadow(params: {
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<TigerShadowAttempt[]> {
  const builtRequest = await buildRelatedEntitiesRequest(params);
  const attempts = [...builtRequest.attempts];
  if (!builtRequest.request) {
    attempts.push(
      buildSkippedAttempt(
        'getRelatedEntities',
        'The system could not build a supported related-entities request from the prompt.'
      )
    );
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<GetRelatedEntitiesResponse>(
    '/v1/contracts/get-related-entities',
    builtRequest.request,
    { timeoutMs: readShadowTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'getRelatedEntities',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return attempts;
  }

  attempts.push({
    contractName: 'getRelatedEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });
  return attempts;
}

async function runRelatedEntitiesPrimary(params: {
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  request: GetRelatedEntitiesRequest | null;
  response: GetRelatedEntitiesResponse | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const builtRequest = await buildRelatedEntitiesRequest(params);
  const attempts = [...builtRequest.attempts];
  if (!builtRequest.request) {
    attempts.push(
      buildSkippedAttempt(
        'getRelatedEntities',
        'The system could not build a supported related-entities request from the prompt.'
      )
    );
    return {
      attempts,
      clarificationText: selectionStateRequiresClarification(builtRequest.selectionState)
        ? renderSelectionClarification(builtRequest.selectionState!)
        : null,
      request: null,
      response: null,
      selectionState: builtRequest.selectionState,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<GetRelatedEntitiesResponse>(
    '/v1/contracts/get-related-entities',
    builtRequest.request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'getRelatedEntities',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return {
      attempts,
      request: builtRequest.request,
      response: null,
      selectionState: builtRequest.selectionState,
    };
  }

  attempts.push({
    contractName: 'getRelatedEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    request: builtRequest.request,
    response:
      (
        ((response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer)
        || (response.data?.unresolvedCount ?? 0) > 0
      )
        ? response.data ?? null
        : null,
    selectionState: builtRequest.selectionState,
  };
}

async function runCatalogSearchPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: SearchCatalogShadowRequest | null;
  response: SearchCatalogResponse | null;
}> {
  const { reason, requests } = buildCatalogSearchPrimaryRequests(prompt);
  if (requests.length === 0) {
    return {
      attempts: [buildSkippedAttempt('searchCatalog', reason ?? 'The system could not build a catalog request.')],
      request: null,
      response: null,
    };
  }

  const attempts: TigerShadowAttempt[] = [];
  let lastRequest: SearchCatalogShadowRequest | null = null;
  for (const request of requests) {
    lastRequest = request;
    const startedAt = performance.now();
    const response = await postToQueryApi<SearchCatalogResponse>(
      '/v1/contracts/search-catalog',
      request,
      { timeoutMs: readPrimaryTimeoutMs() }
    );
    const timingMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      attempts.push({
        contractName: 'searchCatalog',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      });
      return { attempts, request, response: null };
    }

    const resultCount = (response.data?.items?.length ?? 0) || countCatalogFacetMatches(response.data);
    attempts.push({
      contractName: 'searchCatalog',
      httpStatus: response.httpStatus,
      resultCount,
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
      timingMs,
    });

    if (hasCatalogAnswerPayload(response.data) && response.data?.sufficientToAnswer) {
      return { attempts, request, response: response.data ?? null };
    }
  }

  return { attempts, request: lastRequest, response: null };
}

async function runSemanticSearchPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: SemanticSearchShadowRequest | null;
  response: SemanticSearchResponse | null;
}> {
  const { request, reason } = buildSemanticRequestFromPrompt(prompt);
  if (!request) {
    return {
      attempts: [buildSkippedAttempt('semanticSearch', reason ?? 'The system could not build a similarity request.')],
      request: null,
      response: null,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SemanticSearchResponse>(
    '/v1/contracts/semantic-search',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'semanticSearch',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      request,
      response: null,
    };
  }

  return {
    attempts: [{
      contractName: 'semanticSearch',
      httpStatus: response.httpStatus,
      resultCount: response.data?.results?.length ?? 0,
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? response.data?.sufficient_to_answer ?? false,
      timingMs,
    }],
    request,
    response:
      (response.data?.results?.length ?? 0) > 0 &&
      (response.data?.sufficientToAnswer ?? response.data?.sufficient_to_answer)
        ? response.data ?? null
        : null,
  };
}

async function runRankEntitiesPrimary(params: {
  prompt: string;
  requestOverride?: RankEntitiesShadowRequest | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  request: RankEntitiesRenderRequest | null;
  response: RankEntitiesResponse | null;
}> {
  const { request, reason } = params.requestOverride
    ? { request: params.requestOverride }
    : buildRankingShadowRequest(params.prompt);
  if (!request) {
    return {
      attempts: [buildSkippedAttempt('rankEntities', reason ?? 'The system could not build a ranking request.')],
      request: null,
      response: null,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<RankEntitiesResponse>(
    '/v1/contracts/rank-entities',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'rankEntities',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      request,
      response: null,
    };
  }

  const attempts: TigerShadowAttempt[] = [{
    contractName: 'rankEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  }];

  const hasPrimaryRows = (response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer;
  if (!hasPrimaryRows) {
    const closestMatch = buildClosestMatchRankingRequest(request);
    if (closestMatch) {
      const retryStartedAt = performance.now();
      const retryResponse = await postToQueryApi<RankEntitiesResponse>(
        '/v1/contracts/rank-entities',
        closestMatch.apiRequest,
        { timeoutMs: readPrimaryTimeoutMs() }
      );
      const retryTimingMs = Math.round(performance.now() - retryStartedAt);

      if (!retryResponse.ok) {
        attempts.push({
          contractName: 'rankEntities',
          errorCode: retryResponse.errorCode,
          httpStatus: retryResponse.httpStatus,
          reason: retryResponse.reason,
          status: 'error',
          timingMs: retryTimingMs,
        });

        return {
          attempts,
          request,
          response: null,
        };
      }

      const retryHasRows =
        (retryResponse.data?.items?.length ?? 0) > 0
        && Boolean(retryResponse.data?.sufficientToAnswer);
      attempts.push({
        contractName: 'rankEntities',
        httpStatus: retryResponse.httpStatus,
        reason: retryHasRows
          ? 'No rows met every original threshold, so the system returned the closest matches after relaxing the review floor.'
          : 'The closest-match retry still did not produce a stable ranking.',
        resultCount: retryResponse.data?.items?.length ?? 0,
        status: retryHasRows ? 'success' : 'skipped',
        sufficientToAnswer: retryResponse.data?.sufficientToAnswer ?? false,
        timingMs: retryTimingMs,
      });

      return {
        attempts,
        request: closestMatch.renderRequest,
        response: retryHasRows ? (retryResponse.data ?? null) : null,
      };
    }
  }

  return {
    attempts,
    request,
    response:
      hasPrimaryRows
        ? response.data ?? null
        : null,
  };
}

async function runMonthlyPlaytimePrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: QueryMonthlyPlaytimeRequest;
  response: QueryMonthlyPlaytimeResponse | null;
}> {
  const request = buildMonthlyPlaytimeRequest(prompt);
  const startedAt = performance.now();
  const response = await postToQueryApi<QueryMonthlyPlaytimeResponse>(
    '/v1/contracts/query-monthly-playtime',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    return {
      attempts: [{
        contractName: 'queryMonthlyPlaytime',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      }],
      request,
      response: null,
    };
  }

  const resultCount = response.data?.items?.length ?? 0;
  const sufficientToAnswer = response.data?.sufficientToAnswer ?? resultCount > 0;
  return {
    attempts: [{
      contractName: 'queryMonthlyPlaytime',
      httpStatus: response.httpStatus,
      resultCount,
      status: 'success',
      sufficientToAnswer,
      timingMs,
    }],
    request,
    response: resultCount > 0 && sufficientToAnswer ? response.data ?? null : null,
  };
}

async function runCompareEntitiesPrimary(params: {
  prompt: string;
  requestOverride?: CompareEntitiesShadowRequest | null;
  sessionContext: SessionChatContext | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  request: CompareEntitiesShadowRequest | null;
  response: CompareEntitiesResponse | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const builtRequest = params.requestOverride
    ? {
        attempts: [] as TigerShadowAttempt[],
        request: params.requestOverride,
        selectionState: params.sessionContext?.selectionState ?? null,
      }
    : await buildCompareRequestFromPrompt({
        prompt: params.prompt,
        sessionContext: params.sessionContext,
        timeoutMs: readPrimaryTimeoutMs(),
      });
  const attempts = [...builtRequest.attempts];

  if (!builtRequest.request || builtRequest.request.entityUids.length < 2) {
    return {
      attempts,
      clarificationText: builtRequest.clarificationText ?? (builtRequest.selectionState ? renderSelectionClarification(builtRequest.selectionState) : null),
      request: null,
      response: null,
      selectionState: builtRequest.selectionState ?? params.sessionContext?.selectionState ?? null,
    };
  }

  const request: CompareEntitiesShadowRequest = builtRequest.request;
  const selectionState = builtRequest.selectionState ?? params.sessionContext?.selectionState ?? null;
  const timeoutMs = readPrimaryTimeoutMs();
  const startedAt = performance.now();
  const response = await postToQueryApi<CompareEntitiesResponse>(
    '/v1/contracts/compare-entities',
    request,
    { timeoutMs }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'compareEntities',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });

    if (isTigerTransientRuntimeFailure(response)) {
      const retryStartedAt = performance.now();
      const retryResponse = await postToQueryApi<CompareEntitiesResponse>(
        '/v1/contracts/compare-entities',
        request,
        { timeoutMs }
      );
      const retryTimingMs = Math.round(performance.now() - retryStartedAt);

      if (!retryResponse.ok) {
        attempts.push({
          contractName: 'compareEntities',
          errorCode: retryResponse.errorCode,
          httpStatus: retryResponse.httpStatus,
          reason: retryResponse.reason,
          status: 'error',
          timingMs: retryTimingMs,
        });

        return {
          attempts,
          request,
          response: null,
          selectionState,
        };
      }

      attempts.push({
        contractName: 'compareEntities',
        httpStatus: retryResponse.httpStatus,
        resultCount: retryResponse.data?.items?.length ?? 0,
        status: 'success',
        sufficientToAnswer: retryResponse.data?.sufficientToAnswer ?? false,
        timingMs: retryTimingMs,
      });

      return {
        attempts,
        request,
        response: hasStableCompareResponse(retryResponse.data) ? (retryResponse.data ?? null) : null,
        selectionState,
      };
    }

    return {
      attempts,
      request,
      response: null,
      selectionState,
    };
  }

  attempts.push({
    contractName: 'compareEntities',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    request,
    response: hasStableCompareResponse(response.data) ? (response.data ?? null) : null,
    selectionState,
  };
}

async function runMetricHistoryPrimary(params: {
  entityQuery: string | null;
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<{
  attempts: TigerShadowAttempt[];
  clarificationText?: string | null;
  request?: TraceMetricHistoryShadowRequest | null;
  response: TraceMetricHistoryResponse | null;
  selectionState: SessionChatSelectionState | null;
}> {
  const { attempt: resolveAttempt, entityUid, selectionState } = await resolveGameEntityAttempt({
    family: 'metric_history',
    prompt: params.prompt,
    query: params.entityQuery,
    selectionState: params.selectionState,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    attempts.push(
      buildSkippedAttempt(
        'traceMetricHistory',
        'The metric history path was skipped because no game entity could be resolved.'
      )
    );
    return {
      attempts,
      clarificationText: selectionState ? renderSelectionClarification(selectionState) : null,
      request: null,
      response: null,
      selectionState,
    };
  }

  const request: TraceMetricHistoryShadowRequest = {
    entityUid,
    metrics: extractHistoryMetrics(params.prompt),
    ...parseHistoryWindow(params.prompt),
  };

  const startedAt = performance.now();
  const response = await postToQueryApi<TraceMetricHistoryResponse>(
    '/v1/contracts/trace-metric-history',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'traceMetricHistory',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });
    return { attempts, response: null, selectionState };
  }

  attempts.push({
    contractName: 'traceMetricHistory',
    httpStatus: response.httpStatus,
    resultCount: response.data?.series?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    request,
    response:
      (response.data?.series?.length ?? 0) > 0 && response.data?.sufficientToAnswer
        ? response.data ?? null
        : null,
    selectionState,
  };
}

function formatYoutubeMetric(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
}

function formatYoutubeCountPhrase(
  value: number | null | undefined,
  singular: string,
  plural: string
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `n/a ${plural}`;
  }

  const metric = formatYoutubeMetric(value);
  return value === 1 ? `${metric} ${singular}` : `${metric} ${plural}`;
}

function formatYoutubePercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatYoutubeDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

function hasYoutubeNumericMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatYoutubeWindowLabel(value: YoutubeCoverageWindow | null | undefined): string | null {
  if (!value || value === 'current') {
    return null;
  }

  const parsed = Number(value.slice(0, -1));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return value;
  }

  if (parsed === 1) {
    return 'the last 1 day';
  }

  return `the last ${parsed} days`;
}

function formatYoutubeContentClassLabel(
  value: YoutubeContentClass | null | undefined,
  params?: {
    plural?: boolean;
  }
): string | null {
  if (!value) {
    return null;
  }

  const plural = params?.plural ?? false;
  if (value === 'short') {
    return plural ? 'YouTube shorts' : 'short';
  }

  if (value === 'live_or_recent_live') {
    return plural ? 'live or recent-live videos' : 'live or recent-live';
  }

  return plural ? 'standard YouTube videos' : 'standard video';
}

function formatYoutubeContentClassTableLabel(value: YoutubeContentClass | null | undefined): string {
  if (value === 'short') {
    return 'Shorts';
  }

  if (value === 'live_or_recent_live') {
    return 'Live / recent live';
  }

  return 'Standard video';
}

function sanitizeYoutubeMarkdownTableCell(value: string | null | undefined): string {
  const normalized = (value ?? 'n/a')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();

  return normalized || 'n/a';
}

function normalizeYoutubeMarkdownInlineText(value: string | null | undefined, fallback = 'n/a'): string {
  const normalized = (value ?? fallback)
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || fallback;
}

function escapeYoutubeMarkdownLinkLabel(value: string | null | undefined): string {
  return normalizeYoutubeMarkdownInlineText(value ?? 'Untitled', 'Untitled')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function formatYoutubeMarkdownLink(
  label: string | null | undefined,
  url: string | null | undefined
): string {
  const safeLabel = escapeYoutubeMarkdownLinkLabel(label ?? 'Untitled');
  const safeUrl = url?.trim() ?? '';
  if (!/^https?:\/\//i.test(safeUrl)) {
    return safeLabel;
  }

  return `[${safeLabel}](<${safeUrl.replace(/>/g, '%3E')}>)`;
}

function formatYoutubeVideoLink(row: {
  title?: string;
  url?: string;
}): string {
  return formatYoutubeMarkdownLink(row.title ?? 'Untitled video', row.url);
}

function formatYoutubeChannelLink(row: {
  channelId?: string;
  channelTitle?: string;
}): string {
  const title = normalizeYoutubeMarkdownInlineText(row.channelTitle ?? 'Unknown channel', 'Unknown channel');
  if (!row.channelId) {
    return title;
  }

  return formatYoutubeMarkdownLink(title, `https://www.youtube.com/channel/${encodeURIComponent(row.channelId)}`);
}

function buildYoutubeMarkdownTable(columns: string[], rows: string[][]): string {
  const header = `| ${columns.map((column) => sanitizeYoutubeMarkdownTableCell(column)).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => sanitizeYoutubeMarkdownTableCell(cell)).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function buildYoutubeCoverageHeader(response: GetYoutubeGameCoverageResponse): string {
  const entityName = response.entity?.displayName ?? 'this game';
  const windowLabel = formatYoutubeWindowLabel(response.resolvedWindow);
  const classLabel = formatYoutubeContentClassLabel(response.contentClass, { plural: true });
  const windowSuffix = windowLabel ? ` in ${windowLabel}` : '';

  if (response.view === 'creator_coverage') {
    return `YouTube creator coverage for ${entityName}${windowSuffix}`;
  }

  if (response.view === 'top_videos') {
    if (classLabel) {
      return `Top ${classLabel} for ${entityName}${windowSuffix}`;
    }
    return `Top YouTube videos for ${entityName}${windowSuffix}`;
  }

  if (response.view === 'video_growth') {
    if (classLabel) {
      return `Fastest-growing ${classLabel} for ${entityName}${windowSuffix}`;
    }
    return `Fastest-growing YouTube videos for ${entityName}${windowSuffix}`;
  }

  if (response.view === 'content_mix') {
    return `YouTube content mix for ${entityName}${windowSuffix}`;
  }

  if (response.view === 'cadence') {
    return `YouTube activity for ${entityName}${windowSuffix ?? ''}`.trim();
  }

  if (classLabel) {
    return `Latest ${classLabel} for ${entityName}${windowSuffix}`;
  }

  return `Latest YouTube videos for ${entityName}${windowSuffix}`;
}

function buildYoutubeCoverageSummaryText(params: {
  entityName: string;
  freshestMatchedUploadAt?: string | null;
  summary: NonNullable<GetYoutubeGameCoverageResponse['summary']>;
}): string {
  const totalVideos = formatYoutubeCountPhrase(
    params.summary.matchedPrimaryVideoCount,
    'tracked YouTube video',
    'tracked YouTube videos'
  );
  const newVideos7d = formatYoutubeCountPhrase(params.summary.newMatchedVideos7d, 'new video', 'new videos');
  const newVideos30d = formatYoutubeCountPhrase(params.summary.newMatchedVideos30d, 'new video', 'new videos');
  const channels7d = formatYoutubeCountPhrase(params.summary.distinctUploadChannels7d, 'channel', 'channels');
  const channels30d = formatYoutubeCountPhrase(params.summary.distinctUploadChannels30d, 'channel', 'channels');
  const sentences = [
    `${params.entityName} currently has ${totalVideos}.`,
    `In the last 7 days, there were ${newVideos7d} from ${channels7d}. In the last 30 days, there were ${newVideos30d} from ${channels30d}.`,
  ];

  if (params.freshestMatchedUploadAt) {
    sentences.push(`Most recent upload: ${formatYoutubeDate(params.freshestMatchedUploadAt)}.`);
  }

  return sentences.join(' ');
}

function buildYoutubeFollowUpSuggestions(params: {
  entityName: string;
  view: YoutubeCoverageView;
}): QuerySuggestion[] {
  const entity = params.entityName;
  const suggestions =
    params.view === 'creator_coverage'
      ? [
          `How many upload channels posted about ${entity} in the last 14 days?`,
          `Show the fastest-growing YouTube videos for ${entity} in the last 7 days`,
          `Show the top YouTube videos for ${entity} in the last 14 days`,
        ]
      : params.view === 'video_growth'
        ? [
            `Show the fastest-growing YouTube shorts for ${entity} in the last 7 days`,
            `Show the latest YouTube videos for ${entity} in the last 7 days`,
            `What does the YouTube content mix look like for ${entity}?`,
          ]
        : params.view === 'content_mix'
          ? [
              `How many new YouTube videos did ${entity} get in the last 14 days?`,
              `Which creators are covering ${entity} this week?`,
              `Show the fastest-growing YouTube videos for ${entity} in the last 7 days`,
            ]
          : params.view === 'cadence'
            ? [
                `How many upload channels posted about ${entity} this week?`,
                `Show the latest YouTube videos for ${entity} in the last 7 days`,
                `Show the top YouTube videos for ${entity} in the last 14 days`,
              ]
            : [
                `Show the latest YouTube shorts for ${entity} in the last 7 days`,
                `Which creators are covering ${entity} this week?`,
                `Show the fastest-growing YouTube videos for ${entity} in the last 7 days`,
                `How many new YouTube videos did ${entity} get in the last 14 days?`,
              ];

  return suggestions.map((query) => ({
    category: 'game',
    label: query,
    query,
  }));
}

function renderYoutubeGameCoverage(response: GetYoutubeGameCoverageResponse | null): string | null {
  if (!response?.entity?.displayName) {
    return null;
  }

  const entityName = response.entity.displayName;
  const availabilityState = response.availability?.state ?? 'ready';
  const availabilityReason = response.availability?.reason?.trim()
    ? sanitizeForwardFacingDataCopy(response.availability.reason.trim())
    : null;

  if (availabilityState === 'blocked') {
    return `I’m not returning a YouTube answer for ${entityName} right now because ${availabilityReason ?? 'the current match precision is not reliable enough for this title.'}`;
  }

  if (availabilityState === 'unavailable') {
    const blockingTables = response.availability?.blockingTables?.length
      ? ` Blocking tables: ${response.availability.blockingTables.join(', ')}.`
      : '';
    return `I can route this YouTube prompt for ${entityName}, but this data environment does not have mirrored YouTube data ready yet.${availabilityReason ? ` ${availabilityReason}` : ''}${blockingTables}`.trim();
  }

  const summary = response.summary ?? {};
  const header = buildYoutubeCoverageHeader(response);
  const summaryText = buildYoutubeCoverageSummaryText({
    entityName,
    freshestMatchedUploadAt: summary.freshestMatchedUploadAt,
    summary,
  });
  const heading = `### ${header}`;

  if (response.view === 'creator_coverage') {
    const rows = (response.creators ?? []).slice(0, response.limit ?? 10);
    const hasSubscribers = rows.some((row) => hasYoutubeNumericMetric(row.channelSubscriberCount ?? null));
    const body = rows.length > 0
      ? buildYoutubeMarkdownTable(
          [
            'Channel',
            'Videos',
            'Views',
            ...(hasSubscribers ? ['Subscribers'] : []),
            'Latest Upload',
          ],
          rows.map((row) => [
            formatYoutubeChannelLink(row),
            formatYoutubeMetric(row.matchedVideoCount ?? null),
            formatYoutubeMetric(row.totalMatchedViews ?? null),
            ...(hasSubscribers ? [formatYoutubeMetric(row.channelSubscriberCount ?? null)] : []),
            formatYoutubeDate(row.latestMatchedUploadAt),
          ])
        )
      : 'No creator rows were available in the current filtered slice.';

    return `${heading}\n\n${summaryText}\n\n${body}`.trim();
  }

  if (response.view === 'content_mix') {
    const rows = response.contentMix ?? [];
    const body = rows.length > 0
      ? buildYoutubeMarkdownTable(
          ['Format', 'Videos', 'New Videos', 'Channels', 'Views', 'View Delta'],
          rows.map((row) => [
            formatYoutubeContentClassTableLabel(row.contentClass),
            formatYoutubeMetric(row.matchedPrimaryVideoCount ?? null),
            formatYoutubeMetric(row.newMatchedVideos ?? null),
            formatYoutubeMetric(row.distinctUploadChannels ?? null),
            formatYoutubeMetric(row.currentViews ?? null),
            formatYoutubeMetric(row.matchedVideoViewDelta ?? null),
          ])
        )
      : 'No content-mix rows were available in the current filtered slice.';

    return `${heading}\n\n${summaryText}\n\n${body}`.trim();
  }

  if (response.view === 'cadence') {
    const cadence = response.cadence;
    const body = cadence
      ? (() => {
          const windowLabel = formatYoutubeWindowLabel(cadence.window ?? response.resolvedWindow) ?? 'the current window';
          const intro =
            hasYoutubeNumericMetric(cadence.newMatchedVideos) && hasYoutubeNumericMetric(cadence.distinctUploadChannels)
              ? `In ${windowLabel}, ${formatYoutubeMetric(cadence.distinctUploadChannels)} channels posted ${formatYoutubeMetric(cadence.newMatchedVideos)} new videos about ${entityName}.`
              : hasYoutubeNumericMetric(cadence.distinctUploadChannels)
                ? `In ${windowLabel}, ${formatYoutubeMetric(cadence.distinctUploadChannels)} upload channels posted about ${entityName}.`
                : hasYoutubeNumericMetric(cadence.newMatchedVideos)
                  ? `In ${windowLabel}, ${entityName} had ${formatYoutubeMetric(cadence.newMatchedVideos)} new videos.`
                  : `Here is the current YouTube activity summary for ${entityName}.`;

          const detailRows: string[][] = [];

          if (hasYoutubeNumericMetric(cadence.distinctUploadChannels)) {
            detailRows.push(['Upload channels', formatYoutubeMetric(cadence.distinctUploadChannels)]);
          }

          if (hasYoutubeNumericMetric(cadence.newMatchedVideos)) {
            detailRows.push(['New videos', formatYoutubeMetric(cadence.newMatchedVideos)]);
          }

          detailRows.push(['Current views', formatYoutubeMetric(cadence.viewsOnNewVideos)]);

          if (hasYoutubeNumericMetric(cadence.matchedVideoViewDelta)) {
            detailRows.push(['View delta', formatYoutubeMetric(cadence.matchedVideoViewDelta)]);
          }

          if (summary.freshestMatchedUploadAt) {
            detailRows.push(['Most recent upload', formatYoutubeDate(summary.freshestMatchedUploadAt)]);
          }

          return `${intro}\n\n${buildYoutubeMarkdownTable(['Metric', 'Value'], detailRows)}`;
        })()
      : 'No cadence summary was available in the current filtered slice.';

    return `${heading}\n\n${body}`.trim();
  }

  const rows = (response.items ?? []).slice(0, response.limit ?? 10);
  const body = rows.length > 0
    ? response.view === 'video_growth'
      ? buildYoutubeMarkdownTable(
          [
            'Video',
            'Channel',
            'Published',
            'View Delta',
            'Growth',
            'Views',
            'Format',
          ],
          rows.map((row) => [
            formatYoutubeVideoLink(row),
            formatYoutubeChannelLink(row),
            formatYoutubeDate(row.publishedAt),
            formatYoutubeMetric(row.viewDelta ?? null),
            formatYoutubePercent(row.growthPct ?? null),
            formatYoutubeMetric(row.viewCount ?? null),
            formatYoutubeContentClassTableLabel(row.contentClass),
          ])
        )
      : buildYoutubeMarkdownTable(
          ['Video', 'Channel', 'Published', 'Views', 'Format'],
          rows.map((row) => [
            formatYoutubeVideoLink(row),
            formatYoutubeChannelLink(row),
            formatYoutubeDate(row.publishedAt),
            formatYoutubeMetric(row.viewCount ?? null),
            formatYoutubeContentClassTableLabel(row.contentClass),
          ])
        )
    : 'No matched YouTube rows were available in the current filtered slice.';

  return `${heading}\n\n${summaryText}\n\n${body}`.trim();
}

async function runYoutubeGameCoveragePrimary(params: {
  prompt: string;
  selectionState?: SessionChatSelectionState | null;
}): Promise<YoutubeGameCoveragePrimaryOutcome> {
  const entityQuery = extractYoutubeEntityQuery(params.prompt);
  const view = inferYoutubeCoverageView(params.prompt);
  const { attempt: resolveAttempt, entity, entityUid, selectionState } = await resolveGameEntityAttempt({
    family: 'youtube_game_activity',
    prompt: params.prompt,
    query: entityQuery,
    selectionState: params.selectionState,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid || !entity?.displayName) {
    if (!selectionStateRequiresClarification(selectionState)) {
      attempts.push(
        buildSkippedAttempt(
          'getYoutubeGameCoverage',
          'The YouTube coverage path was skipped because no game entity could be resolved.'
        )
      );
    }
    return {
      attempts,
      clarificationText: selectionState ? renderSelectionClarification(selectionState) : null,
      renderedText: null,
      request: null,
      response: null,
      selectionState,
    };
  }

  const request: GetYoutubeGameCoverageRequest = {
    contentClass: inferYoutubeContentClass(params.prompt),
    entityUid,
    limit: extractRequestedTopCount(params.prompt, 10, 25),
    view,
    window: inferYoutubeCoverageWindow(params.prompt),
  };

  const startedAt = performance.now();
  const response = await postToQueryApi<GetYoutubeGameCoverageResponse>(
    '/v1/contracts/get-youtube-game-coverage',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
  );
  const timingMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    attempts.push({
      contractName: 'getYoutubeGameCoverage',
      errorCode: response.errorCode,
      httpStatus: response.httpStatus,
      reason: response.reason,
      status: 'error',
      timingMs,
    });

    return {
      attempts,
      followUpSuggestions: buildYoutubeFollowUpSuggestions({
        entityName: entity.displayName,
        view,
      }),
      renderedText: `I could not load the YouTube coverage view for ${entity.displayName} right now.${response.reason ? ` ${sanitizeForwardFacingDataCopy(response.reason)}` : ''}`.trim(),
      request,
      response: null,
      selectionState,
    };
  }

  attempts.push({
    contractName: 'getYoutubeGameCoverage',
    httpStatus: response.httpStatus,
    resultCount:
      response.data?.items?.length
      ?? response.data?.creators?.length
      ?? response.data?.contentMix?.length
      ?? (response.data?.cadence ? 1 : 0),
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    followUpSuggestions: buildYoutubeFollowUpSuggestions({
      entityName: entity.displayName,
      view,
    }),
    renderedText: renderYoutubeGameCoverage(response.data ?? null),
    request,
    response: response.data ?? null,
    selectionState,
  };
}

function isSingleEntityFollowUpFamily(
  family: string | null | undefined
): family is Extract<TigerPrimaryMatchedIntent, 'change_explanation' | 'entity_overview' | 'metric_history' | 'news_search' | 'youtube_game_activity'> {
  return family === 'change_explanation'
    || family === 'entity_overview'
    || family === 'metric_history'
    || family === 'news_search'
    || family === 'youtube_game_activity';
}

function resolvePrimaryFollowUpContext(params: {
  prompt: string;
  sessionContext: SessionChatContext | null;
}): {
  compareRequestOverride?: CompareEntitiesShadowRequest | null;
  clarificationText?: string | null;
  entityQuery?: string | null;
  explicitKindHint?: SessionSelectionEntityKind | null;
  matchedIntent: TigerPrimaryMatchedIntent;
  momentumPromptFamily?: MomentumPromptFamily | null;
  requestOverride?: DiscoverMomentumShadowRequest | RankEntitiesShadowRequest | null;
  selectionState?: SessionChatSelectionState | null;
} | null {
  const priorSelectionState = params.sessionContext?.selectionState ?? null;
  const priorFamily = priorSelectionState?.family ?? params.sessionContext?.lastAnswer?.family ?? null;
  const namedSwitchMatch = params.prompt.match(/^\s*(?:use|switch(?:\s+\w+)?)\s+(.+?)\s+instead\s*$/i);
  const namedSwitchQuery = normalizeEntityQuery(namedSwitchMatch?.[1] ?? null);

  if (namedSwitchQuery && isSingleEntityFollowUpFamily(priorFamily)) {
    return {
      entityQuery: namedSwitchQuery,
      explicitKindHint: inferEntityKindCorrection(params.prompt),
      matchedIntent: priorFamily,
      selectionState: null,
    };
  }

  if (priorSelectionState && inferSelectionFollowUpIntent(params.prompt, params.sessionContext)) {
    const updatedSelection = applySelectionFollowUpState({
      prompt: params.prompt,
      selectionState: priorSelectionState,
    });

    return {
      clarificationText: updatedSelection.clarificationText,
      explicitKindHint: inferEntityKindCorrection(params.prompt),
      matchedIntent: priorSelectionState.family as TigerPrimaryMatchedIntent,
      selectionState: updatedSelection.selectionState,
    };
  }

  const requestPivot = resolveRequestStatePivotFollowUp(
    params.prompt,
    params.sessionContext?.requestState
  );
  if (requestPivot) {
    return {
      compareRequestOverride: requestPivot.compareRequestOverride ?? null,
      entityQuery: requestPivot.entityQuery ?? null,
      matchedIntent: requestPivot.matchedIntent,
      momentumPromptFamily: requestPivot.momentumPromptFamily ?? null,
      requestOverride: requestPivot.requestOverride ?? null,
      selectionState: null,
    };
  }

  const followUpQuery = extractSameFamilyEntityFollowUpQuery(params.prompt);
  if (followUpQuery && isSingleEntityFollowUpFamily(priorFamily)) {
    return {
      entityQuery: followUpQuery,
      explicitKindHint: inferEntityKindCorrection(params.prompt),
      matchedIntent: priorFamily,
      selectionState: null,
    };
  }

  return null;
}

function extractSelectedCandidateQueryFromSelectionState(
  selectionState: SessionChatSelectionState | null | undefined
): string | null {
  const selectedCandidate = pickSelectedCandidateFromSelectionState(selectionState);
  return selectedCandidate?.displayName?.trim() || null;
}

function getPrimaryInterpretationEntityHint(
  interpretation: TigerPromptInterpretation | null | undefined
): TigerPromptEntityHint | null {
  if (!interpretation) {
    return null;
  }

  return interpretation.entities.find((entity) => entity.role === 'primary')
    ?? interpretation.entities.find((entity) => entity.role === 'reference')
    ?? interpretation.entities[0]
    ?? null;
}

export async function runTigerPrimaryEvaluation(params: {
  isEvalRequest: boolean;
  interpretation?: TigerPromptInterpretation | null;
  prompt: string;
  sessionContext: SessionChatContext | null;
  userId: string | null;
}): Promise<TigerPrimaryEvaluationResult> {
  const mode = readPrimaryMode();
  const cohort = classifyTigerRolloutCohort(params.userId);
  if (!shouldRunPrimary(mode, params.isEvalRequest, cohort)) {
    return {
      contractResult: null,
      info: {
        attempts: [],
        cohort,
        enabled: false,
        matchedIntent: null,
        mode,
        renderMode: 'deterministic',
        route: 'disabled',
      },
      renderedText: null,
      sessionState: null,
    };
  }

  const followUpContext = resolvePrimaryFollowUpContext({
    prompt: params.prompt,
    sessionContext: params.sessionContext,
  });
  const interpretationEntity = getPrimaryInterpretationEntityHint(params.interpretation);
  const interpretationIntent =
    params.interpretation?.intent
    && isTigerPrimaryRenderableIntent(params.interpretation.intent)
      ? params.interpretation.intent
      : null;
  const interpretedIntent =
    params.interpretation?.confidence === 'low'
      ? null
      : interpretationIntent;
  const explicitYoutubeIntent = inferYoutubeGameActivityIntent(params.prompt)
    ? 'youtube_game_activity'
    : null;
  const priorSelectionState = params.sessionContext?.selectionState ?? null;
  const selectionBoundIntent = inferSelectionBoundIntent({
    prompt: params.prompt,
    selectionState: priorSelectionState,
  });
  const explicitMonthlyPlaytimeIntent = MONTHLY_PLAYTIME_PROMPT_PATTERN.test(params.prompt)
    ? 'monthly_playtime'
    : null;
  const matchedIntent = followUpContext?.matchedIntent
    ?? explicitMonthlyPlaytimeIntent
    ?? explicitYoutubeIntent
    ?? selectionBoundIntent
    ?? interpretedIntent
    ?? interpretationIntent
    ?? inferPrimaryMatchedIntent(params.prompt)
    ?? (inferCompareFollowUpIntent(params.prompt, params.sessionContext) ? 'entity_compare' : null);
  if (!matchedIntent) {
    return {
      contractResult: null,
      info: {
        attempts: [],
        cohort,
        enabled: true,
        matchedIntent: null,
        mode,
        renderMode: 'deterministic',
        route: 'unmatched',
      },
      renderedText: null,
      sessionState: null,
    };
  }

  if (
    !followUpContext &&
    !selectionBoundIntent &&
    params.interpretation?.intent === matchedIntent &&
    params.interpretation.confidence === 'low' &&
    params.interpretation.clarificationQuestion
  ) {
    const answerBrief = buildTigerClarificationBrief({
      clarificationText: params.interpretation.clarificationQuestion,
      intent: matchedIntent,
      selectionState: null,
    });

    return {
      answerBrief,
      contractResult: null,
      followUpSuggestions: answerBrief.followUpSuggestions,
      info: {
        attempts: [],
        cohort,
        enabled: true,
        matchedIntent,
        mode,
        renderMode: 'deterministic',
        route: 'primary_success',
      },
      renderedText: renderTigerAnswerBrief(answerBrief),
      sessionState: {
        lastAnswer: buildTigerSelectionLastAnswer({
          family: matchedIntent,
          clarificationNeeded: true,
        }),
        selectionState: null,
      },
    };
  }

  if (followUpContext?.clarificationText) {
    const answerBrief = buildTigerClarificationBrief({
      clarificationText: followUpContext.clarificationText,
      intent: matchedIntent,
      selectionState: followUpContext.selectionState ?? null,
    });

    return {
      answerBrief,
      contractResult: null,
      followUpSuggestions: answerBrief.followUpSuggestions,
      info: {
        attempts: [],
        cohort,
        enabled: true,
        matchedIntent,
        mode,
        renderMode: 'deterministic',
        route: 'primary_success',
      },
      renderedText: renderTigerAnswerBrief(answerBrief),
      sessionState: {
        lastAnswer: buildTigerSelectionLastAnswer({
          family: matchedIntent,
          clarificationNeeded: true,
        }),
        selectionState: followUpContext.selectionState ?? null,
      },
    };
  }

  const reusableSelectionState = selectionBoundIntent && pickSelectedCandidateFromSelectionState(priorSelectionState)
    ? priorSelectionState
    : null;
  const activeSelectionState =
    followUpContext?.entityQuery
      ? (followUpContext.selectionState ?? null)
      : (
        followUpContext?.selectionState
        ?? (priorSelectionState?.family === matchedIntent ? priorSelectionState : null)
        ?? reusableSelectionState
      );
  const entityQuery =
    followUpContext?.entityQuery
    ?? extractSelectedCandidateQueryFromSelectionState(followUpContext?.selectionState)
    ?? interpretationEntity?.query
    ?? extractGameNameFromSessionContext(params.sessionContext)
    ?? extractEntityQueryFromPrompt(params.prompt);

  try {
    const outcome = matchedIntent === 'change_discovery'
      ? await runChangeDiscoveryPrimary(params.prompt)
      : matchedIntent === 'user_context'
      ? await runUserContextPrimary({
          prompt: params.prompt,
          userId: params.userId,
        })
      : matchedIntent === 'momentum_discovery'
      ? await runMomentumPrimary({
          prompt: params.prompt,
          requestOverride:
            followUpContext?.matchedIntent === 'momentum_discovery'
              ? (followUpContext.requestOverride as DiscoverMomentumShadowRequest | null | undefined)
              : null,
        })
      : matchedIntent === 'entity_overview'
      ? await runEntityOverviewPrimary({
          explicitKindHint: followUpContext?.explicitKindHint ?? interpretationEntity?.kindHint ?? null,
          prompt: params.prompt,
          queryOverride: followUpContext?.entityQuery ?? null,
          selectionState: activeSelectionState,
        })
      : matchedIntent === 'relation_lookup'
      ? await runRelatedEntitiesPrimary({
          prompt: params.prompt,
          selectionState: activeSelectionState,
        })
      : matchedIntent === 'youtube_game_activity'
      ? await runYoutubeGameCoveragePrimary({
          prompt: params.prompt,
          selectionState: activeSelectionState,
        })
      : matchedIntent === 'catalog_search'
      ? await runCatalogSearchPrimary(params.prompt)
      : matchedIntent === 'entity_ranking'
        ? await runRankEntitiesPrimary({
            prompt: params.prompt,
            requestOverride:
              followUpContext?.matchedIntent === 'entity_ranking'
                ? (followUpContext.requestOverride as RankEntitiesShadowRequest | null | undefined)
                : null,
          })
        : matchedIntent === 'monthly_playtime'
          ? await runMonthlyPlaytimePrimary(params.prompt)
        : matchedIntent === 'entity_compare'
          ? await runCompareEntitiesPrimary({
            prompt: params.prompt,
            requestOverride:
              followUpContext?.matchedIntent === 'entity_compare' && followUpContext.compareRequestOverride
                ? followUpContext.compareRequestOverride
                : null,
            sessionContext: params.sessionContext,
          })
          : matchedIntent === 'metric_history'
            ? await runMetricHistoryPrimary({
                entityQuery,
                prompt: params.prompt,
                selectionState: activeSelectionState,
              })
            : matchedIntent === 'news_search'
              ? await runSearchDocumentsPrimary({
                  entityQuery,
                  prompt: params.prompt,
                  selectionState: activeSelectionState,
                })
              : matchedIntent === 'semantic_search'
                ? await runSemanticSearchPrimary(params.prompt)
                : await runExplainChangesPrimary({
                    entityQuery,
                    prompt: params.prompt,
                    selectionState: activeSelectionState,
                  });

    if ('clarificationText' in outcome && outcome.clarificationText) {
      const selectionState =
        'selectionState' in outcome ? (outcome.selectionState ?? null) : activeSelectionState;
      const answerBrief = buildTigerClarificationBrief({
        clarificationText: outcome.clarificationText,
        intent: matchedIntent,
        selectionState,
      });

      return {
        answerBrief,
        contractResult: null,
        followUpSuggestions: answerBrief.followUpSuggestions,
        info: {
          attempts: outcome.attempts,
          cohort,
          enabled: true,
          matchedIntent,
          mode,
          renderMode: 'deterministic',
          route: outcome.attempts.some((attempt) => attempt.status === 'error')
            ? 'error'
            : 'primary_success',
        },
        renderedText: renderTigerAnswerBrief(answerBrief),
        sessionState: {
          lastAnswer: buildTigerSelectionLastAnswer({
            family: matchedIntent,
            clarificationNeeded: true,
          }),
          selectionState,
        },
      };
    }

    if (matchedIntent === 'youtube_game_activity') {
      const youtubeOutcome = outcome as YoutubeGameCoveragePrimaryOutcome;
      const selectionState = youtubeOutcome.selectionState ?? activeSelectionState;

      if (youtubeOutcome.renderedText?.trim()) {
        const answerBrief = buildTigerSuccessBrief({
          allowNarration: false,
          fallbackMarkdown: youtubeOutcome.renderedText,
          intent: matchedIntent,
          response: youtubeOutcome.response,
          selectionState,
        });

        return {
          answerBrief,
          contractResult:
            youtubeOutcome.request && youtubeOutcome.response
              ? {
                  contractName: 'getYoutubeGameCoverage',
                  request: youtubeOutcome.request as unknown as Record<string, unknown>,
                  response: youtubeOutcome.response,
                }
              : null,
          followUpSuggestions: youtubeOutcome.followUpSuggestions ?? answerBrief.followUpSuggestions,
          info: {
            attempts: youtubeOutcome.attempts,
            cohort,
            enabled: true,
            matchedIntent,
            mode,
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: renderTigerAnswerBrief(answerBrief),
          sessionState: {
            lastAnswer: buildTigerSelectionLastAnswer({
              family: matchedIntent,
              clarificationNeeded: false,
            }),
            selectionState,
          },
        };
      }

      return {
        contractResult: null,
        info: {
          attempts: youtubeOutcome.attempts,
          cohort,
          enabled: true,
          matchedIntent,
          mode,
          renderMode: 'deterministic',
          route: youtubeOutcome.attempts.some((attempt) => attempt.status === 'error')
            ? 'error'
            : 'fallback_to_legacy',
        },
        renderedText: null,
        sessionState: {
          lastAnswer: buildTigerSelectionLastAnswer({
            family: matchedIntent,
            clarificationNeeded: false,
          }),
          selectionState,
        },
      };
    }

    if (!outcome.response) {
      const selectionState =
        'selectionState' in outcome ? (outcome.selectionState ?? null) : activeSelectionState;
      const noResultText = isTigerPrimaryRenderableIntent(matchedIntent)
        ? buildTigerPrimaryNoResultText({
            attempts: outcome.attempts,
            entityQuery,
            matchedIntent,
            prompt: params.prompt,
            request: 'request' in outcome ? outcome.request : null,
          })
        : null;

      if (noResultText) {
        const answerBrief = buildTigerSuccessBrief({
          allowNarration: false,
          fallbackMarkdown: noResultText,
          intent: matchedIntent,
          response: null,
          selectionState,
        });

        return {
          answerBrief,
          contractResult: null,
          followUpSuggestions: answerBrief.followUpSuggestions,
          info: {
            attempts: outcome.attempts,
            cohort,
            enabled: true,
            matchedIntent,
            mode,
            renderMode: 'deterministic',
            route: 'primary_success',
          },
          renderedText: renderTigerAnswerBrief(answerBrief),
          sessionState: {
            lastAnswer: buildTigerSelectionLastAnswer({
              family: matchedIntent,
              clarificationNeeded: false,
            }),
            selectionState,
          },
        };
      }

      return {
        contractResult: null,
        info: {
          attempts: outcome.attempts,
          cohort,
          enabled: true,
          matchedIntent,
          mode,
          renderMode: 'deterministic',
          route: outcome.attempts.some((attempt) => attempt.status === 'error')
            ? 'error'
            : 'fallback_to_legacy',
        },
        renderedText: null,
        sessionState: {
          lastAnswer: buildTigerSelectionLastAnswer({
            family: matchedIntent,
            clarificationNeeded: false,
          }),
          selectionState,
        },
      };
    }

    if (!isTigerPrimaryRenderableIntent(matchedIntent)) {
      return {
        contractResult: null,
        info: {
          attempts: outcome.attempts,
          cohort,
          enabled: true,
          matchedIntent,
          mode,
          renderMode: 'deterministic',
          route: 'fallback_to_legacy',
        },
        renderedText: null,
      };
    }

    const momentumPromptFamily =
      matchedIntent === 'momentum_discovery' && 'request' in outcome && outcome.request
        ? (
            followUpContext?.matchedIntent === 'momentum_discovery'
              ? (followUpContext.momentumPromptFamily ?? null)
              : ('momentumPromptFamily' in outcome && outcome.momentumPromptFamily)
                ? outcome.momentumPromptFamily
                : inferMomentumRequestFamily(outcome.request as DiscoverMomentumShadowRequest)
          )
        : null;
    const scopeAdjustedForSparseResults =
      matchedIntent === 'momentum_discovery'
      && 'scopeAdjustedForSparseResults' in outcome
      && outcome.scopeAdjustedForSparseResults === true;
    const renderedText = renderTigerPrimaryResult({
      matchedIntent,
      momentumPromptFamily,
      request: 'request' in outcome ? outcome.request : null,
      response: outcome.response,
      scopeAdjustedForSparseResults,
    });

    if (!renderedText.trim()) {
      return {
        contractResult: null,
        info: {
          attempts: outcome.attempts,
          cohort,
          enabled: true,
          matchedIntent,
          mode,
          renderMode: 'deterministic',
          route: 'fallback_to_legacy',
        },
        renderedText: null,
      };
    }

    const selectionState =
      'selectionState' in outcome ? (outcome.selectionState ?? null) : activeSelectionState;
    const requestState =
      matchedIntent === 'entity_ranking' && 'request' in outcome && outcome.request
        ? buildPrimaryRequestState({
            intent: 'entity_ranking',
            request: outcome.request as RankEntitiesShadowRequest,
            response: outcome.response as RankEntitiesResponse,
          })
        : matchedIntent === 'momentum_discovery' && 'request' in outcome && outcome.request
          ? buildPrimaryRequestState({
              intent: 'momentum_discovery',
              momentumPromptFamily,
              request: outcome.request as DiscoverMomentumShadowRequest,
              response: outcome.response as DiscoverMomentumResponse,
            })
          : null;
    const answerBrief = buildTigerSuccessBrief({
      fallbackMarkdown: renderedText,
      intent: matchedIntent,
      momentumPromptFamily,
      response: outcome.response,
      scopeAdjustedForSparseResults,
      selectionState,
    });

    return {
      answerBrief,
      contractResult:
        matchedIntent === 'entity_overview' && 'request' in outcome && outcome.request
          ? {
              contractName: 'getEntityOverview',
              request: outcome.request as unknown as Record<string, unknown>,
              response: outcome.response,
            }
          : matchedIntent === 'relation_lookup' && 'request' in outcome && outcome.request
            ? {
                contractName: 'getRelatedEntities',
                request: outcome.request as unknown as Record<string, unknown>,
                response: outcome.response,
              }
          : matchedIntent === 'entity_ranking' && 'request' in outcome && outcome.request
            ? {
                contractName: 'rankEntities',
                request: outcome.request as unknown as Record<string, unknown>,
                response: outcome.response,
              }
          : matchedIntent === 'monthly_playtime' && 'request' in outcome && outcome.request
            ? {
                contractName: 'queryMonthlyPlaytime',
                request: outcome.request as unknown as Record<string, unknown>,
                response: outcome.response,
              }
          : matchedIntent === 'catalog_search' && 'request' in outcome && outcome.request
        ? {
            contractName: 'searchCatalog',
            request: outcome.request as unknown as Record<string, unknown>,
            response: outcome.response,
          }
          : matchedIntent === 'user_context'
            ? null
          : matchedIntent === 'momentum_discovery' && 'request' in outcome && outcome.request
            ? {
                contractName: 'discoverMomentum',
                request: outcome.request as unknown as Record<string, unknown>,
                response: outcome.response,
              }
          : matchedIntent === 'semantic_search' && 'request' in outcome && outcome.request
            ? {
                contractName: 'semanticSearch',
                request: outcome.request as unknown as Record<string, unknown>,
                response: outcome.response,
              }
            : matchedIntent === 'metric_history' && 'request' in outcome && outcome.request
              ? {
                  contractName: 'traceMetricHistory',
                  request: outcome.request as unknown as Record<string, unknown>,
                  response: outcome.response,
                }
            : matchedIntent === 'entity_compare' && 'request' in outcome && outcome.request
              ? {
                  contractName: 'compareEntities',
                  request: outcome.request as unknown as Record<string, unknown>,
                  response: outcome.response,
                }
              : null,
      info: {
        attempts: outcome.attempts,
        cohort,
        enabled: true,
        matchedIntent,
        mode,
        renderMode: 'deterministic',
        route: 'primary_success',
      },
      followUpSuggestions: answerBrief.followUpSuggestions,
      renderedText: renderTigerAnswerBrief(answerBrief),
      sessionState: {
        lastAnswer: buildTigerSelectionLastAnswer({
          family: matchedIntent,
          clarificationNeeded: false,
        }),
        requestState,
        selectionState,
      },
    };
  } catch (error) {
    return {
      contractResult: null,
      info: {
        attempts: [{
          contractName: matchedIntent === 'entity_overview'
            ? 'getEntityOverview'
            : matchedIntent === 'relation_lookup'
            ? 'getRelatedEntities'
            : matchedIntent === 'entity_ranking'
            ? 'rankEntities'
          : matchedIntent === 'monthly_playtime'
            ? 'queryMonthlyPlaytime'
          : matchedIntent === 'entity_compare'
            ? 'compareEntities'
          : matchedIntent === 'momentum_discovery'
            ? 'discoverMomentum'
          : matchedIntent === 'change_discovery'
            ? 'searchChangeActivity'
            : matchedIntent === 'user_context'
              ? 'getUserContext'
            : matchedIntent === 'youtube_game_activity'
              ? 'getYoutubeGameCoverage'
            : matchedIntent === 'metric_history'
              ? 'traceMetricHistory'
              : matchedIntent === 'news_search'
                ? 'searchDocuments'
                : matchedIntent === 'semantic_search'
                  ? 'semanticSearch'
                : matchedIntent === 'change_explanation'
                  ? 'explainChanges'
                  : 'searchCatalog',
          reason: error instanceof Error ? error.message : 'Unknown system error',
          status: 'error',
        }],
        cohort,
        enabled: true,
        matchedIntent,
        mode,
        renderMode: 'deterministic',
        route: 'error',
      },
      renderedText: null,
      sessionState: null,
    };
  }
}

export async function runTigerShadowEvaluation(params: {
  isEvalRequest: boolean;
  prompt: string;
  sessionContext: SessionChatContext | null;
  toolCalls: ChatToolCall[];
  userId: string | null;
}): Promise<TigerShadowInfo> {
  const mode = readShadowMode();
  const cohort = classifyTigerRolloutCohort(params.userId);
  if (!shouldRunShadow(mode, params.isEvalRequest, cohort)) {
    return {
      attempts: [],
      cohort,
      enabled: false,
      matchedIntent: null,
      mode,
      route: 'disabled',
    };
  }

  const matchedIntent = inferMatchedIntent(params.prompt, params.toolCalls);
  if (!matchedIntent) {
    return {
      attempts: [],
      cohort,
      enabled: true,
      matchedIntent: null,
      mode,
      route: 'unmatched',
    };
  }

  const entityQuery =
    extractGameNameFromSessionContext(params.sessionContext) ??
    extractGameNameFromToolCalls(params.toolCalls) ??
    extractEntityQueryFromPrompt(params.prompt);

  const attempts = matchedIntent === 'change_discovery'
    ? await runChangeDiscoveryShadow(params.prompt)
    : matchedIntent === 'momentum_discovery'
      ? await runMomentumShadow(params.prompt)
    : matchedIntent === 'entity_overview'
    ? await runEntityOverviewShadow(params.prompt)
    : matchedIntent === 'relation_lookup'
    ? await runRelatedEntitiesShadow({ prompt: params.prompt })
    : matchedIntent === 'change_explanation'
    ? await runExplainChangesShadow(entityQuery)
    : matchedIntent === 'news_search'
      ? await runSearchDocumentsShadow({
          entityQuery,
          prompt: params.prompt,
        })
      : matchedIntent === 'semantic_search'
        ? await runSemanticSearchShadow({
            prompt: params.prompt,
            toolCalls: params.toolCalls,
          })
      : matchedIntent === 'catalog_search'
        ? await runCatalogSearchShadow({
            prompt: params.prompt,
            toolCalls: params.toolCalls,
          })
        : matchedIntent === 'entity_compare'
          ? await runCompareEntitiesShadow(params.prompt, params.sessionContext)
        : matchedIntent === 'entity_ranking'
          ? await runRankEntitiesShadow(params.prompt)
          : await runMetricHistoryShadow({
              entityQuery,
              prompt: params.prompt,
            });

  const hasSuccessfulFinalAttempt = attempts.some(
    (attempt) =>
      (
        attempt.contractName === 'explainChanges'
        || attempt.contractName === 'getEntityOverview'
        || attempt.contractName === 'compareEntities'
        || attempt.contractName === 'discoverMomentum'
        || attempt.contractName === 'discoverChangePatterns'
        || attempt.contractName === 'rankEntities'
        || attempt.contractName === 'getRelatedEntities'
        || attempt.contractName === 'searchCatalog'
        || attempt.contractName === 'searchChangeActivity'
        || attempt.contractName === 'searchDocuments'
        || attempt.contractName === 'semanticSearch'
        || attempt.contractName === 'traceMetricHistory'
      )
      && attempt.status === 'success'
  );

  const hasOnlySkippedAttempts = attempts.every((attempt) => attempt.status === 'skipped');

  return {
    attempts,
    cohort,
    enabled: true,
    matchedIntent,
    mode,
    route: hasSuccessfulFinalAttempt
      ? 'shadow_success_legacy_answer'
      : hasOnlySkippedAttempts
        ? 'skipped'
        : 'shadow_failed_legacy_answer',
  };
}
