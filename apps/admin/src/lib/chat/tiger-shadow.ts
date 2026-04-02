import 'server-only';

import type { SessionChatContext } from '@/lib/chat/chat-context-types';
import type { ChatToolCall } from '@/lib/llm/types';
import { renderTigerPrimaryResult } from '@/lib/chat/tiger-primary-renderer';

import type {
  TigerPrimaryInfo,
  TigerPrimaryMode,
  TigerRolloutCohort,
  TigerShadowAttempt,
  TigerShadowInfo,
  TigerShadowMatchedIntent,
  TigerShadowMode,
} from './tiger-shadow-types';

const DEFAULT_QUERY_API_BASE_URL = 'http://127.0.0.1:4318';
const DEFAULT_PRIMARY_TIMEOUT_MS = 8000;
const DEFAULT_SHADOW_TIMEOUT_MS = 8000;
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
const NEWS_PROMPT_PATTERN =
  /\b(news|announcement|announcements|patch notes?|devlog|roadmap|update notes?|recent updates?)\b/i;
const CHANGE_PROMPT_PATTERN =
  /\b(what changed|changed recently|why did .* spike|recent changes|change timeline|timeline of changes)\b/i;
const CHANGE_DISCOVERY_PROMPT_PATTERN =
  /\b(biggest steam page refreshes?|store-?page changes?|release timing changes?|changed tags?(?: or genres?)?|marketing push|relaunch pattern|teasing a big update|sustained response|under-marketed|signable indie games|agency leads|without an announcement)\b/i;
const COMPANY_GAME_LIST_PROMPT_PATTERN =
  /\b(?:show|list|find|give|top|best)\b.*\bgames?\b.*\b(?:by|from)\b|\bgames?\b.*\b(?:by|from)\b/i;
const ENTITY_OVERVIEW_PROMPT_PATTERN =
  /\b(?:tell me about|what can you tell me about|give me an overview of|overview of)\b/i;
const COMPANY_COUNT_PROMPT_PATTERN =
  /\bhow many\s+(?:games|titles)\s+has\s+(.+?)\s+(?:published|developed)\b/i;
const SEMANTIC_SIMILARITY_PROMPT_PATTERN =
  /\b(?:games?|publishers?|developers?|studios?)\b.*\b(?:like|similar to)\b|\b(?:similar to|like)\b.*\b(?:games?|publishers?|developers?|studios?)\b/i;
const CONCEPT_DISCOVERY_PROMPT_PATTERN =
  /\b(?:recommend|find|show|give)\b.*\bgames?\b/i;
const COMPARE_PROMPT_PATTERN =
  /\bcompare\b|\bvs\.?\b|\bversus\b|\bstack up\b/i;
const METRIC_HISTORY_PROMPT_PATTERN =
  /\b(?:how have|show|track|history of|over time|trend of)\b.*\b(?:reviews?|review score|sentiment|owners?|sales|ccu|concurrent players?|price|discount|playtime)\b/i;
const RANKING_BASE_PROMPT_PATTERN =
  /\b(?:top|highest|best|most|largest|biggest)\b/i;
const RANKING_DISALLOWED_PROMPT_PATTERN =
  /\b(?:compare|versus|vs\.?|similar|like|breaking out|trending up|accelerating|declining|under \$|steam deck|controller support|linux|co-op|coop|tag|genre|free-to-play|free to play|this year|last \d+ days?|past \d+ days?|released)\b/i;
const METRIC_HISTORY_DISALLOWED_PATTERN =
  /\b(?:compare|versus|vs\.?|publishers?|developers?|studios?|why did)\b/i;
const ENTITY_QUERY_PATTERNS = [
  /(?:about|for|on)\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
  /(?:happened to|changed for)\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
  /(?:news|announcements|updates?)\s+(?:for|about|on)\s+(.+?)(?:\s+(?:this|last|over|in|during|from)\b|[?!.]|$)/i,
  /how have\s+(.+?)\s+(?:reviews?|review score|sentiment|owners?|sales|ccu|concurrent players?|price|discount|playtime)\b/i,
  /show\s+(.+?)\s+(?:ccu|owners?|reviews?|review score|sentiment|price|discount|playtime)\b/i,
];

interface ResolveEntitiesResponse {
  ambiguity?: {
    requiresClarification?: boolean;
  };
  entities?: Array<{
    confidence?: number;
    displayName: string;
    entityKind: string;
    entityUid: string;
    platform: string;
    platformEntityId?: string;
    signals?: {
      gameCount?: number | null;
    };
  }>;
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
  items?: Array<{
    appid?: number;
    entityUid?: string;
    name?: string;
  }>;
  sufficientToAnswer?: boolean;
}

interface RankEntitiesResponse {
  items?: Array<{
    displayName?: string;
    entityUid?: string;
  }>;
  sufficientToAnswer?: boolean;
}

interface SearchDocumentsResponse {
  items?: unknown[];
  sufficientToAnswer?: boolean;
}

interface TraceMetricHistoryResponse {
  series?: unknown[];
  sufficientToAnswer?: boolean;
}

interface ExplainChangesResponse {
  moments?: unknown[];
  sufficientToAnswer?: boolean;
  summary?: {
    eventCount?: number;
  };
}

interface SemanticSearchResponse {
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

interface SearchCatalogShadowRequest {
  developerQuery?: string;
  genres?: string[];
  isFree?: boolean;
  limit?: number;
  minCcu?: number;
  minReviewScore?: number;
  minReviews?: number;
  platforms?: string[];
  publisherQuery?: string;
  query?: string;
  releaseYear?: {
    gte?: number;
    lte?: number;
  };
  sortBy?: 'ccu_peak' | 'owners' | 'release_date' | 'reviews';
  sortDirection?: 'asc' | 'desc';
  tags?: string[];
}

interface RankEntitiesShadowRequest {
  entityKind: 'developer' | 'game' | 'publisher';
  limit?: number;
  metric: 'ccu_peak' | 'game_count' | 'owners_midpoint' | 'review_score' | 'total_reviews';
  sortDirection?: 'asc' | 'desc';
}

interface SemanticSearchShadowRequest {
  continuationToken?: string | null;
  description?: string | null;
  entityKind: 'developer' | 'game' | 'publisher';
  filters?: {
    is_free?: boolean;
    max_price_cents?: number;
    platforms?: Array<'windows' | 'macos' | 'linux'>;
    steam_deck?: Array<'verified' | 'playable'>;
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

interface CatalogShadowBuildResult {
  request: SearchCatalogShadowRequest | null;
  reason?: string;
}

interface CatalogPrimaryBuildResult {
  reason?: string;
  requests: SearchCatalogShadowRequest[];
}

interface TigerPrimaryEvaluationResult {
  contractResult?: {
    contractName: 'compareEntities' | 'getEntityOverview' | 'searchCatalog' | 'semanticSearch';
    request: Record<string, unknown>;
    response: unknown;
  } | null;
  info: TigerPrimaryInfo;
  renderedText: string | null;
}

interface CompareResolutionGroup {
  entityKind: 'developer' | 'game' | 'publisher';
  platform: string;
}

interface CompareRequestBuildResult {
  attempts: TigerShadowAttempt[];
  request: CompareEntitiesShadowRequest | null;
}

function compareResolutionStrength(entity: ResolvedCompareEntity): number {
  const confidence = typeof entity.confidence === 'number' ? entity.confidence : 0;
  const gameCount =
    typeof entity.signals?.gameCount === 'number' && Number.isFinite(entity.signals.gameCount)
      ? entity.signals.gameCount
      : 0;

  return (confidence * 100) + Math.min(gameCount, 25);
}

type TigerPrimaryMatchedIntent = Exclude<TigerShadowMatchedIntent, null>;

function isTigerPrimaryRenderableIntent(
  intent: TigerPrimaryMatchedIntent
): intent is Exclude<TigerPrimaryMatchedIntent, 'change_discovery'> {
  return intent !== 'change_discovery';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (inferCompareIntent(prompt)) {
    return 'entity_compare';
  }

  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
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

  if (inferCatalogSearchIntent(prompt, toolCalls)) {
    return 'catalog_search';
  }

  if (inferSemanticIntent(prompt, toolCalls)) {
    return 'semantic_search';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  return null;
}

function inferPrimaryMatchedIntent(prompt: string): TigerPrimaryMatchedIntent | null {
  if (inferCompareIntent(prompt)) {
    return 'entity_compare';
  }

  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
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

  if (inferEntityOverviewIntent(prompt)) {
    return 'entity_overview';
  }

  if (inferPrimaryCatalogSearchIntent(prompt)) {
    return 'catalog_search';
  }

  if (inferPrimarySemanticIntent(prompt)) {
    return 'semantic_search';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  return null;
}

function inferCompareIntent(prompt: string): boolean {
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

  return COMPANY_COUNT_PROMPT_PATTERN.test(prompt);
}

function inferSemanticIntent(prompt: string, toolCalls: ChatToolCall[]): boolean {
  if (toolCalls.some((toolCall) => toolCall.name === 'find_similar' || toolCall.name === 'search_by_concept')) {
    return true;
  }

  return inferPrimarySemanticIntent(prompt);
}

function inferPrimarySemanticIntent(prompt: string): boolean {
  const normalized = prompt.toLowerCase();

  if (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  if (!CONCEPT_DISCOVERY_PROMPT_PATTERN.test(prompt)) {
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

  return /\bunder\s+\$?\d+/i.test(prompt)
    || /\bsteam deck\b/i.test(prompt)
    || /\bfree(?:\s+to\s+play)?\b/i.test(prompt)
    || /\bcozy\b/i.test(prompt)
    || /\bfarming\b/i.test(prompt);
}

function inferCatalogSearchIntent(prompt: string, toolCalls: ChatToolCall[]): boolean {
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
  const normalized = prompt.toLowerCase();

  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop)\b/.test(normalized)) {
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

function inferRankingIntent(prompt: string): boolean {
  if (!RANKING_BASE_PROMPT_PATTERN.test(prompt) || RANKING_DISALLOWED_PROMPT_PATTERN.test(prompt)) {
    return false;
  }

  return /\b(?:reviews?|review score|ratings?|owners?|players?|ccu|games?)\b/i.test(prompt);
}

function inferMetricHistoryIntent(prompt: string): boolean {
  if (!METRIC_HISTORY_PROMPT_PATTERN.test(prompt) || METRIC_HISTORY_DISALLOWED_PATTERN.test(prompt)) {
    return false;
  }

  return /\b(?:last \d+ days?|this week|this month|over time|history|recently)\b/i.test(prompt);
}

function normalizeEntityQuery(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  const normalized = candidate
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/\b(this game|this title|it|them)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 1 ? normalized : null;
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

  return null;
}

function extractEntityOverviewQuery(prompt: string): string | null {
  const countMatch = prompt.match(COMPANY_COUNT_PROMPT_PATTERN);
  const countQuery = normalizeEntityQuery(countMatch?.[1] ?? null);
  if (countQuery) {
    return countQuery;
  }

  const overviewMatch =
    prompt.match(/(?:tell me about|what can you tell me about|give me an overview of|overview of)\s+(.+?)(?:[?!.]|$)/i)
    ?? prompt.match(/(?:what is|who is)\s+(.+?)(?:[?!.]|$)/i);
  const overviewQuery = normalizeEntityQuery(overviewMatch?.[1] ?? null);
  if (overviewQuery) {
    return overviewQuery;
  }

  return extractEntityQueryFromPrompt(prompt);
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

  return null;
}

function inferEntityOverviewViewMode(
  prompt: string,
  entityKind: 'developer' | 'game' | 'publisher'
): 'company_count' | 'company_games' | 'game_overview' {
  if (entityKind === 'game') {
    return 'game_overview';
  }

  if (COMPANY_COUNT_PROMPT_PATTERN.test(prompt)) {
    return 'company_count';
  }

  return 'company_games';
}

function buildNewsTopicQuery(prompt: string, entityQuery?: string | null): string {
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
      reason: 'No compatible search_games tool call was available for Tiger catalog shadow routing.',
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
      reason: `Tiger catalog shadow skipped unsupported search_games fields: ${unsupported.join(', ')}.`,
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
      reason: 'No compatible screen_games tool call was available for Tiger catalog shadow routing.',
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
      reason: `Tiger catalog shadow skipped unsupported screen_games fields: ${unsupported.join(', ')}.`,
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
      reason: 'No compatible company-backed game-list prompt was available for Tiger catalog shadow routing.',
    };
  }

  const lookupToolCall = pickLastToolCall(toolCalls, ['lookup_developers', 'lookup_publishers']);
  const canonicalName = extractCanonicalCompanyName(lookupToolCall);
  if (!lookupToolCall || !canonicalName) {
    return {
      request: null,
      reason: 'Tiger catalog shadow could not reuse a canonical company lookup result for this game-list prompt.',
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
  if (searchGamesAttempt.request || searchGamesAttempt.reason?.startsWith('Tiger catalog shadow skipped unsupported')) {
    return searchGamesAttempt;
  }

  const screenGamesAttempt = buildCatalogRequestFromScreenGames(toolCalls);
  if (screenGamesAttempt.request || screenGamesAttempt.reason?.startsWith('Tiger catalog shadow skipped unsupported')) {
    return screenGamesAttempt;
  }

  return buildCatalogRequestFromCompanyLookup(prompt, toolCalls);
}

function extractCompanyQueryFromPrompt(prompt: string): string | null {
  const match = prompt.match(/\bgames?\b.*\b(?:by|from)\b\s+(.+?)(?:[?!.]|$)/i);
  return normalizeEntityQuery(match?.[1] ?? null);
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
  if (/\b(?:past|last)\s+year\b/i.test(prompt)) {
    const currentYear = new Date().getFullYear();
    return { gte: currentYear - 1, lte: currentYear };
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

function buildCatalogSearchPrimaryRequests(prompt: string): CatalogPrimaryBuildResult {
  const normalized = prompt.toLowerCase();
  const limit = extractRequestedTopCount(prompt, 20);
  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop)\b/.test(normalized)) {
    return {
      reason: 'Tiger primary catalog routing does not support that discovery constraint yet.',
      requests: [],
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
  const tags = /\bindie\b/i.test(prompt) ? ['Indie'] : undefined;
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
  const minPriceMatch = prompt.match(/\b(?:over|above)\s+\$?(\d{1,4})(?:\.\d{1,2})?\b/i);
  const maxPriceCents = maxPriceMatch
    ? Math.round(Number.parseFloat(maxPriceMatch[1] ?? '0') * 100)
    : undefined;
  const minPriceCents = minPriceMatch
    ? Math.round(Number.parseFloat(minPriceMatch[1] ?? '0') * 100)
    : undefined;
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
      reason: 'Tiger primary catalog routing could not infer a supported search request from the prompt.',
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
  if (/\bgames?\b/.test(normalized)) {
    return 'game';
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

  return Object.keys(filters).length > 0 ? filters : undefined;
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
    prompt.match(/\bgames?\s+(?:like|similar to)\s+(.+?)(?:\s+with\b|[?!.]|$)/i) ??
    prompt.match(/\b(?:publishers?|developers?|studios?)\s+(?:like|similar to)\s+(.+?)(?:\s+with\b|[?!.]|$)/i) ??
    prompt.match(/\b(?:like|similar to)\s+(.+?)(?:\s+with\b|[?!.]|$)/i);

  return normalizeEntityQuery(match?.[1] ?? null);
}

function buildSemanticRequestFromPrompt(
  prompt: string
): { reason?: string; request: SemanticSearchShadowRequest | null } {
  const entityKindHint = normalizeEntityKindHint(prompt);
  const filters = extractSemanticFilters(prompt);

  if (SEMANTIC_SIMILARITY_PROMPT_PATTERN.test(prompt)) {
    const referenceQuery = extractSemanticReferenceQuery(prompt);
    if (!referenceQuery) {
      return {
        request: null,
        reason: 'Tiger semantic routing could not infer a stable similarity reference from the prompt.',
      };
    }

    return {
      request: {
        entityKind: entityKindHint ?? 'game',
        filters,
        limit: 6,
        mode: 'similarity',
        referenceQuery,
      },
    };
  }

  if (!inferPrimarySemanticIntent(prompt)) {
    return {
      request: null,
      reason: 'Tiger semantic routing could not infer a supported concept request from the prompt.',
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
    .replace(/\s+(?:game|publisher|developer|studio)s?$/i, '')
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

  const separatorsPattern = /\s+vs\.?\s+|\s+versus\s+|\s+and\s+|,\s*/i;
  if (!separatorsPattern.test(explicitBody)) {
    const single = normalizeCompareToken(explicitBody);
    return single ? [single] : [];
  }

  return explicitBody
    .replace(/\s+vs\.?\s+/gi, ',')
    .replace(/\s+versus\s+/gi, ',')
    .replace(/\s+and\s+/gi, ',')
    .split(',')
    .map((part) => normalizeCompareToken(part))
    .filter((part) => part.length > 0)
    .slice(0, 5);
}

function inferUnsupportedCompareReason(prompt: string): string | null {
  if (/\breview velocity\b|\breviews?\s+added\b|\brecent reviews?\b/i.test(prompt)) {
    return 'Tiger compare does not support review-velocity or recent-review-window comparisons yet.';
  }

  if (/\b(momentum|accelerating|declining|breaking out|trending up|sustained response)\b/i.test(prompt)) {
    return 'Tiger compare does not support momentum or post-change response comparisons yet.';
  }

  if (/\bbefore and after\b|\bbefore\/after\b/i.test(prompt)) {
    return 'Tiger compare does not support before/after change comparisons yet.';
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
    return 'Tiger compare does not support game-count comparisons for game peers.';
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

function buildRankingShadowRequest(prompt: string): { reason?: string; request: RankEntitiesShadowRequest | null } {
  if (!inferRankingIntent(prompt)) {
    return {
      request: null,
      reason: 'The prompt did not match a supported Tiger ranking pattern.',
    };
  }

  const normalized = prompt.toLowerCase();
  const limit = extractRequestedTopCount(prompt, 10);
  const entityKind = /\bpublisher(s)?\b/.test(normalized)
    ? 'publisher'
    : /\bdeveloper(s)?\b|\bstudios?\b/.test(normalized)
      ? 'developer'
      : 'game';

  let metric: RankEntitiesShadowRequest['metric'] | null = null;
  if (entityKind !== 'game' && /\b(?:most games|has the most games|game count|catalog size)\b/.test(normalized)) {
    metric = 'game_count';
  } else if (/\bmost reviews\b|\bby reviews\b/.test(normalized)) {
    metric = 'total_reviews';
  } else if (/\breview score\b|\bhighest-rated\b|\bbest rated\b|\bbest reviews\b|\bbest\b/.test(normalized)) {
    metric = 'review_score';
  } else if (/\bowners?\b|\bbiggest\b|\blargest\b/.test(normalized)) {
    metric = 'owners_midpoint';
  } else if (/\bccu\b|\bconcurrent players?\b|\bplayers right now\b|\bmost players\b/.test(normalized)) {
    metric = 'ccu_peak';
  }

  if (!metric) {
    return {
      request: null,
      reason: 'The ranking prompt used filters or semantics Tiger rankEntities does not support yet.',
    };
  }

  return {
    request: {
      entityKind,
      limit,
      metric,
      sortDirection: 'desc',
    },
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
  const baseUrl = process.env.QUERY_API_BASE_URL?.trim() || DEFAULT_QUERY_API_BASE_URL;
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

function pickResolvedPrimaryEntity(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  response: ResolveEntitiesResponse | undefined;
}): ResolvedCompareEntity | null {
  const entities = params.response?.entities ?? [];

  if (params.expectedEntityKind) {
    const exactKind = entities.find((entity) => entity.entityKind === params.expectedEntityKind);
    if (exactKind) {
      return exactKind;
    }
  }

  return entities[0] ?? null;
}

async function resolvePrimaryEntityAttempt(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  query: string | null;
}): Promise<{
  attempt: TigerShadowAttempt;
  entity: ResolvedCompareEntity | null;
}> {
  if (!params.query) {
    return {
      attempt: buildSkippedAttempt(
        'resolveEntities',
        'No resolvable entity reference was available for Tiger overview routing.'
      ),
      entity: null,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<ResolveEntitiesResponse>('/v1/contracts/resolve-entities', {
    entityKinds: params.expectedEntityKind
      ? [params.expectedEntityKind]
      : ['game', 'publisher', 'developer'],
    includeMetrics: false,
    limit: 5,
    query: params.query,
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
      entity: null,
    };
  }

  const entity = pickResolvedPrimaryEntity({
    expectedEntityKind: params.expectedEntityKind,
    response: response.data,
  });

  if (!entity?.entityUid || !entity.platformEntityId) {
    return {
      attempt: {
        contractName: 'resolveEntities',
        httpStatus: response.httpStatus,
        reason: 'Tiger overview routing could not resolve the prompt to a stable entity.',
        resultCount: response.data?.entities?.length ?? 0,
        status: 'error',
        sufficientToAnswer: false,
        timingMs,
      },
      entity: null,
    };
  }

  return {
    attempt: {
      contractName: 'resolveEntities',
      httpStatus: response.httpStatus,
      resultCount: response.data?.entities?.length ?? 0,
      status: 'success',
      sufficientToAnswer: true,
      timingMs,
    },
    entity,
  };
}

async function resolveGameEntityAttempt(query: string | null): Promise<{
  attempt: TigerShadowAttempt;
  entityUid: string | null;
}> {
  if (!query) {
    return {
      attempt: buildSkippedAttempt('resolveEntities', 'No resolvable game reference was available for shadow routing.'),
      entityUid: null,
    };
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<ResolveEntitiesResponse>('/v1/contracts/resolve-entities', {
    entityKinds: ['game'],
    includeMetrics: false,
    limit: 3,
    query,
  });
  const timingMs = Math.round(performance.now() - startedAt);
  const firstEntity = response.data?.entities?.find(
    (entity) => entity.entityKind === 'game' && entity.platform === 'steam'
  );

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
      entityUid: null,
    };
  }

  if (!firstEntity?.entityUid) {
    return {
      attempt: {
        contractName: 'resolveEntities',
        httpStatus: response.httpStatus,
        reason: 'The Tiger resolveEntities contract did not return a Steam game match for the inferred reference.',
        resultCount: response.data?.entities?.length ?? 0,
        status: 'error',
        sufficientToAnswer: false,
        timingMs,
      },
      entityUid: null,
    };
  }

  return {
    attempt: {
      contractName: 'resolveEntities',
      httpStatus: response.httpStatus,
      resultCount: response.data?.entities?.length ?? 0,
      status: 'success',
      sufficientToAnswer: true,
      timingMs,
    },
    entityUid: firstEntity.entityUid,
  };
}

function pickCompareResolutionGroup(params: {
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  responses: Array<{ entities: ResolvedCompareEntity[] }>;
}): CompareResolutionGroup | null {
  const comboScores = new Map<string, { count: number; group: CompareResolutionGroup; score: number }>();

  for (const response of params.responses) {
    const bestScoresForResponse = new Map<string, number>();

    for (const entity of response.entities) {
      if (params.expectedEntityKind && entity.entityKind !== params.expectedEntityKind) {
        continue;
      }

      if (!entity.entityKind || !entity.platform) {
        continue;
      }

      const key = `${entity.entityKind}:${entity.platform}`;
      const score = compareResolutionStrength(entity);
      const currentBest = bestScoresForResponse.get(key) ?? -1;
      if (score > currentBest) {
        bestScoresForResponse.set(key, score);
      }
    }

    for (const [key, score] of bestScoresForResponse.entries()) {
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

  return [...comboScores.values()]
    .filter((candidate) => candidate.count === params.responses.length)
    .sort((left, right) => right.score - left.score)[0]?.group ?? null;
}

function pickResolvedCompareEntityForGroup(params: {
  group: CompareResolutionGroup;
  response: ResolveEntitiesResponse | undefined;
}): ResolvedCompareEntity | null {
  const entities = params.response?.entities ?? [];
  return entities
    .filter((entity) => entity.entityKind === params.group.entityKind && entity.platform === params.group.platform)
    .sort((left, right) => compareResolutionStrength(right) - compareResolutionStrength(left))[0] ?? null;
}

async function resolveExplicitCompareEntitiesAttempt(params: {
  entityNames: string[];
  expectedEntityKind: 'developer' | 'game' | 'publisher' | null;
  timeoutMs: number;
}): Promise<{
  attempts: TigerShadowAttempt[];
  entityKind: 'developer' | 'game' | 'publisher' | null;
  entityUids: string[];
}> {
  if (params.entityNames.length < 2) {
    return {
      attempts: [
        buildSkippedAttempt(
          'resolveEntities',
          'Tiger compare routing could not infer two resolvable entities from the prompt.'
        ),
      ],
      entityKind: null,
      entityUids: [],
    };
  }

  const attempts: TigerShadowAttempt[] = [];
  const responses: Array<{
    entities: ResolvedCompareEntity[];
    entityName: string;
    response: ResolveEntitiesResponse | undefined;
  }> = [];

  for (const entityName of params.entityNames) {
    const startedAt = performance.now();
    const response = await postToQueryApi<ResolveEntitiesResponse>('/v1/contracts/resolve-entities', {
      entityKinds: params.expectedEntityKind ? [params.expectedEntityKind] : ['game', 'publisher', 'developer'],
      includeMetrics: false,
      limit: 5,
      query: entityName,
    }, { timeoutMs: params.timeoutMs });
    const timingMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      attempts.push({
        contractName: 'resolveEntities',
        errorCode: response.errorCode,
        httpStatus: response.httpStatus,
        reason: response.reason,
        status: 'error',
        timingMs,
      });
      return { attempts, entityKind: null, entityUids: [] };
    }

    attempts.push({
      contractName: 'resolveEntities',
      httpStatus: response.httpStatus,
      resultCount: response.data?.entities?.length ?? 0,
      status: 'success',
      sufficientToAnswer: true,
      timingMs,
    });
    responses.push({
      entities: response.data?.entities ?? [],
      entityName,
      response: response.data,
    });
  }

  const group = pickCompareResolutionGroup({
    expectedEntityKind: params.expectedEntityKind,
    responses,
  });

  if (!group) {
    attempts.push(
      buildSkippedAttempt(
        'resolveEntities',
        'Tiger compare routing could not resolve all peers to the same entity kind and platform.'
      )
    );
    return { attempts, entityKind: null, entityUids: [] };
  }

  const entityUids = responses.map((response) =>
    pickResolvedCompareEntityForGroup({
      group,
      response: response.response,
    })?.entityUid ?? null
  );

  if (entityUids.some((entityUid) => !entityUid)) {
    attempts.push(
      buildSkippedAttempt(
        'resolveEntities',
        'Tiger compare routing could not resolve every peer to a stable shared entity type.'
      )
    );
    return { attempts, entityKind: null, entityUids: [] };
  }

  const uniqueEntityUids = [...new Set(entityUids.filter((entityUid): entityUid is string => Boolean(entityUid)))];
  if (uniqueEntityUids.length < 2) {
    attempts.push(
      buildSkippedAttempt(
        'resolveEntities',
        'Tiger compare routing collapsed to fewer than two distinct peers.'
      )
    );
    return { attempts, entityKind: null, entityUids: [] };
  }

  return { attempts, entityKind: group.entityKind, entityUids: uniqueEntityUids };
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
          'Tiger compare could not derive a stable peer set from the ranking results.'
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
          reason ?? 'Tiger compare could not derive a supported catalog peer set from the prompt.'
        ),
        buildSkippedAttempt(
          'compareEntities',
          'Tiger compare did not find a supported derived peer-set strategy for this prompt.'
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
      'Tiger compare could not derive at least two comparable peers from the current catalog results.'
    )
  );
  return { attempts, entityKind: 'game', entityUids: [] };
}

async function buildCompareRequestFromPrompt(params: {
  prompt: string;
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

  if (explicitEntityNames.length >= 2) {
    const resolved = await resolveExplicitCompareEntitiesAttempt({
      entityNames: explicitEntityNames,
      expectedEntityKind,
      timeoutMs: params.timeoutMs,
    });
    const invalidMetricReason = validateCompareMetricsForEntityKind(resolved.entityKind, metrics);
    if (invalidMetricReason) {
      return {
        attempts: [...resolved.attempts, buildSkippedAttempt('compareEntities', invalidMetricReason)],
        request: null,
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
                'Tiger compare routing skipped this prompt because it did not resolve to a stable peer set.'
              ),
            ],
      request:
        resolved.entityUids.length >= 2
          ? {
              entityUids: resolved.entityUids,
              ...(metrics.length > 0 ? { metrics } : {}),
            }
          : null,
    };
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
  };
}

async function runExplainChangesShadow(entityQuery: string | null): Promise<TigerShadowAttempt[]> {
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt(entityQuery);
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

async function runExplainChangesPrimary(entityQuery: string | null): Promise<{
  attempts: TigerShadowAttempt[];
  response: ExplainChangesResponse | null;
}> {
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt(entityQuery);
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    attempts.push(
      buildSkippedAttempt(
        'explainChanges',
        'The Tiger primary explainChanges path was skipped because no game entity could be resolved.'
      )
    );
    return { attempts, response: null };
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
    return { attempts, response: null };
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
        ? response.data ?? null
        : null,
  };
}

async function runSearchDocumentsShadow(params: {
  entityQuery: string | null;
  prompt: string;
}): Promise<TigerShadowAttempt[]> {
  const attempts: TigerShadowAttempt[] = [];
  let entityUid: string | null = null;

  if (params.entityQuery) {
    const resolved = await resolveGameEntityAttempt(params.entityQuery);
    attempts.push(resolved.attempt);
    entityUid = resolved.entityUid;
  } else {
    attempts.push(
      buildSkippedAttempt(
        'resolveEntities',
        'No game entity hint was available, so news search shadow routing ran without an entity filter.'
      )
    );
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SearchDocumentsResponse>('/v1/contracts/search-documents', {
    entityUid,
    limit: 6,
    query: buildNewsTopicQuery(params.prompt, params.entityQuery),
  });
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
}): Promise<{
  attempts: TigerShadowAttempt[];
  response: SearchDocumentsResponse | null;
}> {
  const attempts: TigerShadowAttempt[] = [];
  let entityUid: string | null = null;

  if (params.entityQuery) {
    const resolved = await resolveGameEntityAttempt(params.entityQuery);
    attempts.push(resolved.attempt);
    entityUid = resolved.entityUid;
  } else {
    attempts.push(
      buildSkippedAttempt(
        'resolveEntities',
        'No game entity hint was available, so Tiger primary news routing ran without an entity filter.'
      )
    );
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<SearchDocumentsResponse>('/v1/contracts/search-documents', {
    entityUid,
    limit: 6,
    query: buildNewsTopicQuery(params.prompt, params.entityQuery),
  });
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
    return { attempts, response: null };
  }

  attempts.push({
    contractName: 'searchDocuments',
    httpStatus: response.httpStatus,
    resultCount: response.data?.items?.length ?? 0,
    status: 'success',
    sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
    timingMs,
  });

  return {
    attempts,
    response:
      (response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer
        ? response.data ?? null
        : null,
  };
}

async function runCatalogSearchShadow(params: {
  prompt: string;
  toolCalls: ChatToolCall[];
}): Promise<TigerShadowAttempt[]> {
  const { request, reason } = buildCatalogSearchShadowRequest(params.prompt, params.toolCalls);

  if (!request) {
    return [buildSkippedAttempt('searchCatalog', reason ?? 'Tiger catalog shadow could not build a supported request.')];
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
    resultCount: response.data?.items?.length ?? 0,
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
    return [buildSkippedAttempt('semanticSearch', reason ?? 'Tiger semantic shadow could not build a supported request.')];
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
    return [buildSkippedAttempt('rankEntities', reason ?? 'Tiger ranking shadow could not build a supported request.')];
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

async function runCompareEntitiesShadow(prompt: string): Promise<TigerShadowAttempt[]> {
  const builtRequest = await buildCompareRequestFromPrompt({
    prompt,
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
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt(params.entityQuery);
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
  const { attempt: resolveAttempt, entity } = await resolvePrimaryEntityAttempt({
    expectedEntityKind,
    query,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entity?.platformEntityId || !entity.entityKind) {
    attempts.push(
      buildSkippedAttempt(
        'getEntityOverview',
        'The Tiger entity overview shadow path was skipped because no stable entity could be resolved.'
      )
    );
    return attempts;
  }

  const startedAt = performance.now();
  const response = await postToQueryApi<GetEntityOverviewResponse>(
    '/v1/contracts/get-entity-overview',
    {
      entityKind: entity.entityKind,
      gamesLimit: entity.entityKind === 'game' ? 0 : 5,
      gamesSortBy: /\b(?:top|best)\b/i.test(prompt) ? 'reviews' : 'release_date',
      platformEntityId: entity.platformEntityId,
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

async function runEntityOverviewPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: {
    entityKind: 'developer' | 'game' | 'publisher';
    gamesLimit: number;
    gamesSortBy: 'release_date' | 'reviews';
    platformEntityId: string;
  } | null;
  response: (GetEntityOverviewResponse & {
    viewMode: 'company_count' | 'company_games' | 'game_overview';
  }) | null;
}> {
  const query = extractEntityOverviewQuery(prompt);
  const expectedEntityKind = inferEntityOverviewKindHint(prompt);
  const { attempt: resolveAttempt, entity } = await resolvePrimaryEntityAttempt({
    expectedEntityKind,
    query,
  });
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entity?.platformEntityId || !entity.entityKind) {
    attempts.push(
      buildSkippedAttempt(
        'getEntityOverview',
        'The Tiger primary entity overview path was skipped because the prompt did not resolve to a stable entity.'
      )
    );
    return { attempts, request: null, response: null };
  }

  const request = {
    entityKind: entity.entityKind as 'developer' | 'game' | 'publisher',
    gamesLimit: entity.entityKind === 'game' ? 0 : 5,
    gamesSortBy: /\b(?:top|best)\b/i.test(prompt) ? 'reviews' as const : 'release_date' as const,
    platformEntityId: entity.platformEntityId,
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
    return { attempts, request, response: null };
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
    return { attempts, request, response: null };
  }

  return {
    attempts,
    request,
    response: {
      ...data,
      viewMode: inferEntityOverviewViewMode(prompt, data.entity.entityKind),
    },
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
      attempts: [buildSkippedAttempt('searchCatalog', reason ?? 'Tiger primary catalog routing could not build a request.')],
      request: null,
      response: null,
    };
  }

  const attempts: TigerShadowAttempt[] = [];
  for (const request of requests) {
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

    attempts.push({
      contractName: 'searchCatalog',
      httpStatus: response.httpStatus,
      resultCount: response.data?.items?.length ?? 0,
      status: 'success',
      sufficientToAnswer: response.data?.sufficientToAnswer ?? false,
      timingMs,
    });

    if ((response.data?.items?.length ?? 0) > 0 && response.data?.sufficientToAnswer) {
      return { attempts, request, response: response.data ?? null };
    }
  }

  return { attempts, request: null, response: null };
}

async function runSemanticSearchPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: SemanticSearchShadowRequest | null;
  response: SemanticSearchResponse | null;
}> {
  const { request, reason } = buildSemanticRequestFromPrompt(prompt);
  if (!request) {
    return {
      attempts: [buildSkippedAttempt('semanticSearch', reason ?? 'Tiger primary semantic routing could not build a request.')],
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

async function runRankEntitiesPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  response: RankEntitiesResponse | null;
}> {
  const { request, reason } = buildRankingShadowRequest(prompt);
  if (!request) {
    return {
      attempts: [buildSkippedAttempt('rankEntities', reason ?? 'Tiger primary ranking could not build a request.')],
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
      response: null,
    };
  }

  return {
    attempts: [{
      contractName: 'rankEntities',
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

async function runCompareEntitiesPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  request: CompareEntitiesShadowRequest | null;
  response: CompareEntitiesResponse | null;
}> {
  const builtRequest = await buildCompareRequestFromPrompt({
    prompt,
    timeoutMs: readPrimaryTimeoutMs(),
  });
  const attempts = [...builtRequest.attempts];

  if (!builtRequest.request || builtRequest.request.entityUids.length < 2) {
    return { attempts, request: null, response: null };
  }

  const request: CompareEntitiesShadowRequest = builtRequest.request;
  const startedAt = performance.now();
  const response = await postToQueryApi<CompareEntitiesResponse>(
    '/v1/contracts/compare-entities',
    request,
    { timeoutMs: readPrimaryTimeoutMs() }
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
    return { attempts, request, response: null };
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
    response:
      (response.data?.items?.length ?? 0) >= 2 && response.data?.sufficientToAnswer
        ? response.data ?? null
        : null,
  };
}

async function runMetricHistoryPrimary(params: {
  entityQuery: string | null;
  prompt: string;
}): Promise<{
  attempts: TigerShadowAttempt[];
  response: TraceMetricHistoryResponse | null;
}> {
  const { attempt: resolveAttempt, entityUid } = await resolveGameEntityAttempt(params.entityQuery);
  const attempts: TigerShadowAttempt[] = [resolveAttempt];

  if (!entityUid) {
    attempts.push(
      buildSkippedAttempt(
        'traceMetricHistory',
        'The Tiger primary metric history path was skipped because no game entity could be resolved.'
      )
    );
    return { attempts, response: null };
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
    return { attempts, response: null };
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
    response:
      (response.data?.series?.length ?? 0) > 0 && response.data?.sufficientToAnswer
        ? response.data ?? null
        : null,
  };
}

export async function runTigerPrimaryEvaluation(params: {
  isEvalRequest: boolean;
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
    };
  }

  const matchedIntent = inferPrimaryMatchedIntent(params.prompt);
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
    };
  }

  const entityQuery =
    extractGameNameFromSessionContext(params.sessionContext) ??
    extractEntityQueryFromPrompt(params.prompt);

  try {
    const outcome = matchedIntent === 'change_discovery'
      ? { attempts: [], response: null }
      : matchedIntent === 'entity_overview'
      ? await runEntityOverviewPrimary(params.prompt)
      : matchedIntent === 'catalog_search'
      ? await runCatalogSearchPrimary(params.prompt)
      : matchedIntent === 'entity_ranking'
        ? await runRankEntitiesPrimary(params.prompt)
        : matchedIntent === 'entity_compare'
          ? await runCompareEntitiesPrimary(params.prompt)
          : matchedIntent === 'metric_history'
            ? await runMetricHistoryPrimary({
                entityQuery,
                prompt: params.prompt,
              })
            : matchedIntent === 'news_search'
              ? await runSearchDocumentsPrimary({
                  entityQuery,
                  prompt: params.prompt,
                })
              : matchedIntent === 'semantic_search'
                ? await runSemanticSearchPrimary(params.prompt)
                : await runExplainChangesPrimary(entityQuery);

    if (!outcome.response) {
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

    const renderedText = renderTigerPrimaryResult({
      matchedIntent,
      response: outcome.response,
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

    return {
      contractResult:
        matchedIntent === 'entity_overview' && 'request' in outcome && outcome.request
          ? {
              contractName: 'getEntityOverview',
              request: outcome.request as unknown as Record<string, unknown>,
              response: outcome.response,
            }
          : matchedIntent === 'catalog_search' && 'request' in outcome && outcome.request
          ? {
              contractName: 'searchCatalog',
              request: outcome.request as unknown as Record<string, unknown>,
              response: outcome.response,
            }
          : matchedIntent === 'semantic_search' && 'request' in outcome && outcome.request
            ? {
                contractName: 'semanticSearch',
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
      renderedText,
    };
  } catch (error) {
    return {
      contractResult: null,
      info: {
        attempts: [{
          contractName: matchedIntent === 'entity_overview'
            ? 'getEntityOverview'
            : matchedIntent === 'entity_ranking'
            ? 'rankEntities'
            : matchedIntent === 'entity_compare'
              ? 'compareEntities'
            : matchedIntent === 'metric_history'
              ? 'traceMetricHistory'
              : matchedIntent === 'news_search'
                ? 'searchDocuments'
                : matchedIntent === 'semantic_search'
                  ? 'semanticSearch'
                : matchedIntent === 'change_explanation'
                  ? 'explainChanges'
                  : 'searchCatalog',
          reason: error instanceof Error ? error.message : 'Unknown Tiger primary error',
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
    ? []
    : matchedIntent === 'entity_overview'
    ? await runEntityOverviewShadow(params.prompt)
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
          ? await runCompareEntitiesShadow(params.prompt)
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
        || attempt.contractName === 'rankEntities'
        || attempt.contractName === 'searchCatalog'
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
