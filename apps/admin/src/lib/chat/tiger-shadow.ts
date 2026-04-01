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
const CHANGE_TOOL_NAMES = new Set([
  'query_change_activity',
  'get_game_change_timeline',
  'get_change_activity_detail',
  'compare_change_before_after',
  'find_change_patterns',
]);
const NEWS_PROMPT_PATTERN =
  /\b(news|announcement|announcements|patch notes?|devlog|roadmap|update notes?|recent updates?)\b/i;
const CHANGE_PROMPT_PATTERN =
  /\b(what changed|changed recently|why did .* spike|recent changes|change timeline|timeline of changes)\b/i;
const COMPANY_GAME_LIST_PROMPT_PATTERN =
  /\b(?:show|list|find|give)\b.*\bgames?\b.*\b(?:by|from)\b/i;
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
  entities?: Array<{
    displayName: string;
    entityKind: string;
    entityUid: string;
    platform: string;
  }>;
}

interface SearchCatalogResponse {
  items?: unknown[];
  sufficientToAnswer?: boolean;
}

interface RankEntitiesResponse {
  items?: unknown[];
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
  info: TigerPrimaryInfo;
  renderedText: string | null;
}

type TigerPrimaryMatchedIntent =
  | 'catalog_search'
  | 'entity_ranking'
  | 'metric_history';

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
  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
  }

  if (hasAnyToolCall(toolCalls, CHANGE_TOOL_NAMES) || CHANGE_PROMPT_PATTERN.test(prompt)) {
    return 'change_explanation';
  }

  if (hasAnyToolCall(toolCalls, NEWS_TOOL_NAMES) || NEWS_PROMPT_PATTERN.test(prompt)) {
    return 'news_search';
  }

  if (inferCatalogSearchIntent(prompt, toolCalls)) {
    return 'catalog_search';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  return null;
}

function inferPrimaryMatchedIntent(prompt: string): TigerPrimaryMatchedIntent | null {
  if (inferMetricHistoryIntent(prompt)) {
    return 'metric_history';
  }

  if (inferPrimaryCatalogSearchIntent(prompt)) {
    return 'catalog_search';
  }

  if (inferRankingIntent(prompt)) {
    return 'entity_ranking';
  }

  return null;
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

  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop|on sale)\b/.test(normalized)) {
    return false;
  }

  if (COMPANY_GAME_LIST_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  const hasPlatform = /\b(?:windows|macos|mac|linux)\b/i.test(prompt);
  const hasIndie = /\bindie\b/i.test(prompt);
  const hasReviewConstraint = /\boverwhelmingly positive\b/i.test(prompt);
  const hasReleaseYear = /\bthis year\b/i.test(prompt) || /\b20\d{2}\b/.test(prompt);

  return hasPlatform || hasIndie || hasReviewConstraint || hasReleaseYear;
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

function buildNewsTopicQuery(prompt: string): string {
  const normalized = prompt
    .replace(/^(find|show|give|tell)\s+me\s+/i, '')
    .replace(/\b(any|recent|noteworthy)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 0 ? normalized : prompt.trim();
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
  if (normalizeNumber(args.min_price_cents) != null) unsupported.push('min_price_cents');
  if (normalizeNumber(args.max_price_cents) != null) unsupported.push('max_price_cents');
  if (normalizeBoolean(args.on_sale) === true) unsupported.push('on_sale');
  if (normalizeNumber(args.min_discount_percent) != null) unsupported.push('min_discount_percent');
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
  if (/\b(?:games like|similar to|compare|breaking out|trending up|accelerating|declining|steam deck|controller support|co-op|coop|on sale)\b/.test(normalized)) {
    return {
      reason: 'Tiger primary catalog routing does not support that discovery constraint yet.',
      requests: [],
    };
  }

  const companyQuery = extractCompanyQueryFromPrompt(prompt);
  if (companyQuery) {
    return {
      requests: [
        {
          developerQuery: companyQuery,
          limit: 25,
          sortBy: 'release_date',
          sortDirection: 'desc',
        },
        {
          publisherQuery: companyQuery,
          limit: 25,
          sortBy: 'release_date',
          sortDirection: 'desc',
        },
      ],
    };
  }

  const platforms = extractPrimaryPlatforms(prompt);
  const releaseYear = extractPrimaryReleaseYear(prompt);
  const tags = /\bindie\b/i.test(prompt) ? ['Indie'] : undefined;
  const hasReviewConstraint = /\boverwhelmingly positive\b/i.test(prompt);

  if (!platforms.length && !releaseYear && !tags && !hasReviewConstraint) {
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
      ...(hasReviewConstraint ? { minReviewScore: 95, minReviews: 1000 } : {}),
      limit: 20,
      sortBy: 'reviews',
      sortDirection: 'desc',
    }],
  };
}

function buildRankingShadowRequest(prompt: string): { reason?: string; request: RankEntitiesShadowRequest | null } {
  if (!inferRankingIntent(prompt)) {
    return {
      request: null,
      reason: 'The prompt did not match a supported Tiger ranking pattern.',
    };
  }

  const normalized = prompt.toLowerCase();
  const entityKind = /\bpublisher(s)?\b/.test(normalized)
    ? 'publisher'
    : /\bdeveloper(s)?\b|\bstudios?\b/.test(normalized)
      ? 'developer'
      : 'game';

  let metric: RankEntitiesShadowRequest['metric'] | null = null;
  if (entityKind !== 'game' && /\bmost games\b|\bhas the most games\b/.test(normalized)) {
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
      limit: 10,
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
    query: buildNewsTopicQuery(params.prompt),
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

async function runCatalogSearchPrimary(prompt: string): Promise<{
  attempts: TigerShadowAttempt[];
  response: SearchCatalogResponse | null;
}> {
  const { reason, requests } = buildCatalogSearchPrimaryRequests(prompt);
  if (requests.length === 0) {
    return {
      attempts: [buildSkippedAttempt('searchCatalog', reason ?? 'Tiger primary catalog routing could not build a request.')],
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
      return { attempts, response: null };
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
      return { attempts, response: response.data ?? null };
    }
  }

  return { attempts, response: null };
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
    const outcome = matchedIntent === 'catalog_search'
      ? await runCatalogSearchPrimary(params.prompt)
      : matchedIntent === 'entity_ranking'
        ? await runRankEntitiesPrimary(params.prompt)
        : await runMetricHistoryPrimary({
            entityQuery,
            prompt: params.prompt,
          });

    if (!outcome.response) {
      return {
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

    const renderedText = matchedIntent === 'catalog_search'
      ? renderTigerPrimaryResult({
          matchedIntent,
          response: outcome.response as SearchCatalogResponse,
        })
      : matchedIntent === 'entity_ranking'
        ? renderTigerPrimaryResult({
            matchedIntent,
            response: outcome.response as RankEntitiesResponse,
          })
        : renderTigerPrimaryResult({
            matchedIntent,
            response: outcome.response as TraceMetricHistoryResponse,
          });

    if (!renderedText.trim()) {
      return {
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
      info: {
        attempts: [{
          contractName: matchedIntent === 'entity_ranking'
            ? 'rankEntities'
            : matchedIntent === 'metric_history'
              ? 'traceMetricHistory'
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

  const attempts = matchedIntent === 'change_explanation'
    ? await runExplainChangesShadow(entityQuery)
    : matchedIntent === 'news_search'
      ? await runSearchDocumentsShadow({
          entityQuery,
          prompt: params.prompt,
        })
      : matchedIntent === 'catalog_search'
        ? await runCatalogSearchShadow({
            prompt: params.prompt,
            toolCalls: params.toolCalls,
          })
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
        || attempt.contractName === 'rankEntities'
        || attempt.contractName === 'searchCatalog'
        || attempt.contractName === 'searchDocuments'
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
