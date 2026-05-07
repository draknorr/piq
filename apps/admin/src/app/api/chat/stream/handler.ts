import { NextRequest } from 'next/server';
import { getServiceClient } from '@publisheriq/database';
import { createProvider } from '@/lib/llm/providers';
import { buildTigerNarratorSystemPrompt } from '@/lib/llm/tiger-narrator-prompt';
import { buildTigerSystemPrompt } from '@/lib/llm/tiger-system-prompt';
import { CUBE_TOOLS } from '@/lib/llm/cube-tools';
import {
  findSimilarWithTimeout,
  searchByConceptWithTimeout,
  type FindSimilarArgs,
  type SearchByConceptArgs,
} from '@/lib/semantic-search/query-api-service';
import { searchGames, type SearchGamesArgs } from '@/lib/search/game-search';
import { lookupTags, type LookupTagsArgs } from '@/lib/search/tag-lookup';
import {
  lookupPublishers,
  lookupDevelopers,
  type LookupPublishersArgs,
  type LookupDevelopersArgs,
} from '@/lib/search/publisher-lookup';
import { lookupGames, type LookupGamesArgs } from '@/lib/search/game-lookup';
import { discoverTrending, type DiscoverTrendingArgs } from '@/lib/search/trend-discovery';
import { screenGames, type ScreenGamesArgs } from '@/lib/search/screen-games';
import { formatResultForModel } from '@/lib/llm/format-entity-links';
import {
  buildRedundantDiscoverySkipResult,
  extractBroadDiscoveryState,
  normalizeBroadDiscoveryToolCall,
  type BroadDiscoveryState,
} from '@/lib/chat/discovery-guardrails';
import { buildRedundantNewsToolSkipResult } from '@/lib/chat/news-tool-guardrails';
import {
  buildTigerChatRenderData,
  buildTigerClarificationRenderData,
} from '@/lib/chat/chat-render-data';
import {
  buildTigerPromptInterpreterMessages,
  parseTigerPromptInterpretation,
  tigerInterpretationMeetsThreshold,
  type TigerInterpretationConfidence,
  type TigerPromptInterpretation,
} from '@/lib/chat/tiger-prompt-interpreter';
import { runTigerPrimaryEvaluation, runTigerShadowEvaluation } from '@/lib/chat/tiger-shadow';
import {
  buildTigerAttemptTraceEntries,
  buildTigerContractTraceEntry,
  buildToolExecutionTraceEntry,
  extractToolExecutionProvenance,
  type ChatExecutionTraceEntry,
} from '@/lib/chat/execution-trace';
import {
  applyCompanyToolResultPolicy,
  buildGenericCompanyLookupSkipResult,
  buildUnsupportedCompanyWindowSkipResult,
  classifyCompanyIntent,
  buildRedundantCompanySkipResult,
  extractCompanyAnswerState,
  normalizeCompanyToolCall,
  type CompanyAnswerState,
} from '@/lib/chat/company-answer-policy';
import { normalizeTrendToolCall } from '@/lib/chat/trend-tool-policy';
import { sanitizeCompanyAssistantResponse } from '@/lib/chat/company-response-sanitizer';
import { sanitizeForwardFacingDataCopy } from '@/lib/chat/forward-facing-copy';
import { tryTigerQueryAnalyticsCompat } from '@/lib/chat/query-analytics-tiger-compat';
import { logChatQuery } from '@/lib/chat-query-logger';
import type {
  ChatTurnQualityInfo,
  SessionChatContext,
  SessionChatSelectionState,
  SessionMomentumPromptFamily,
  SessionChatRequestState,
  SessionChatResultSet,
} from '@/lib/chat/chat-context-types';
import {
  compareChangeBeforeAfter,
  findChangePatterns,
  getChangeActivityDetail,
  getGameChangeTimeline,
  getRecentNewsDetail,
  getRecentNewsDigest,
  normalizeChangeIntelToolCall,
  queryChangeActivity,
  searchRecentNewsTopics,
  type CompareChangeBeforeAfterArgs,
  type FindChangePatternsArgs,
  type GetChangeActivityDetailArgs,
  type GetGameChangeTimelineArgs,
  type GetRecentNewsDetailArgs,
  type GetRecentNewsDigestArgs,
  type QueryChangeActivityArgs,
  type SearchRecentNewsTopicsArgs,
} from '@/lib/chat/change-intel-service';
import {
  attachPhase1MetadataToResult,
  buildPhase1QualityInfo,
  buildToolAnswerContractSummary,
  createPhase1GuardrailState,
  maybeBlockPhase1ToolCall,
  observeExecutedToolCall,
} from '@/lib/chat/phase1-quality';
import {
  attachContinuationMeta,
  buildContinuationExhaustedResult,
  buildContinuationResultSet,
  buildTigerContinuationResultSet,
  buildTigerPrimaryResultSet,
  resolveResultSetContinuation,
  type TigerContractContinuationResult,
} from '@/lib/chat/result-set-continuation';
import {
  applyTigerPrimarySessionState,
  buildSessionContextFromTurn,
  buildSessionContextPrompt,
  summarizeSessionContextForLog,
} from '@/lib/chat/session-context';
import {
  buildTigerSuccessBrief,
  renderTigerNarratedAnswer,
  type TigerAnswerBrief,
} from '@/lib/chat/tiger-answer-brief';
import { renderToolResultForChat } from '@/lib/chat/chat-edge-renderer';
import { renderTigerPrimaryResult } from '@/lib/chat/tiger-primary-renderer';
import { postToQueryApi } from '@/lib/query-api-client';
import { createServerClient } from '@/lib/supabase/server';
import {
  calculateTotalCredits,
  MINIMUM_CHARGE,
  DEFAULT_RESERVATION,
  getCreditBreakdown,
} from '@/lib/credits';
import type {
  Message,
  ChatRequest,
  ChatSelectedEntity,
  Tool,
  QueryResult,
  SimilarityResult,
  ToolCall,
  ChatToolCall,
} from '@/lib/llm/types';
import type {
  StreamEvent,
  TextDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  MessageEndEvent,
  ErrorEvent,
  StreamDebugInfo,
} from '@/lib/llm/streaming-types';
import type { TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';

const MAX_TOOL_ITERATIONS = 5;
const LOCAL_BYPASS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function readRequestHostCandidates(request: NextRequest): string[] {
  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';

  return [request.nextUrl.hostname, hostHeader]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);
}

function isLocalHostRequest(request: NextRequest): boolean {
  return readRequestHostCandidates(request).some((hostname) => LOCAL_BYPASS_HOSTS.has(hostname));
}

function normalizeTigerSelectionState(
  selectionState: SessionChatSelectionState | null | undefined
): SessionChatSelectionState | null {
  if (!selectionState?.slots?.length) {
    return null;
  }

  const slotsWithCandidates = selectionState.slots.filter((slot) => slot.candidates.length > 0);
  if (slotsWithCandidates.length === 0) {
    return null;
  }

  return slotsWithCandidates.length === selectionState.slots.length
    ? selectionState
    : {
        ...selectionState,
        slots: slotsWithCandidates,
      };
}

function normalizeTigerLastAnswer(params: {
  lastAnswer: SessionChatContext['lastAnswer'];
  selectionState: SessionChatSelectionState | null;
}): SessionChatContext['lastAnswer'] {
  if (!params.lastAnswer?.clarificationNeeded || params.selectionState) {
    return params.lastAnswer ?? null;
  }

  return {
    ...params.lastAnswer,
    clarificationNeeded: false,
    summary: params.lastAnswer.family
      ? `System could not resolve a stable entity for ${params.lastAnswer.family}.`
      : 'System could not resolve a stable entity.',
  };
}

export interface ChatRouteDependencies {
  createProvider: typeof createProvider;
  createServerClient: typeof createServerClient;
  executeTool: typeof executeTool;
  getServiceClient: typeof getServiceClient;
  logChatQuery: typeof logChatQuery;
  now: () => number;
  postToQueryApi: typeof postToQueryApi;
  randomUUID: () => string;
  runTigerPrimaryEvaluation: typeof runTigerPrimaryEvaluation;
  runTigerShadowEvaluation: typeof runTigerShadowEvaluation;
}

function createDefaultChatRouteDependencies(): ChatRouteDependencies {
  return {
    createProvider,
    createServerClient,
    executeTool,
    getServiceClient,
    logChatQuery,
    now: () => performance.now(),
    postToQueryApi,
    randomUUID: () => crypto.randomUUID(),
    runTigerPrimaryEvaluation,
    runTigerShadowEvaluation,
  };
}

function readCreditsEnabled(): boolean {
  return process.env.CREDITS_ENABLED === 'true';
}

function readChatPhase1QualityEnabled(): boolean {
  return process.env.CHAT_PHASE1_QUALITY_ENABLED === 'true';
}

function readChatEvalSecret(): string | undefined {
  const value = process.env.CHAT_EVAL_SECRET?.trim();
  return value ? value : undefined;
}

function readChatEvalLocalBypassEnabled(): boolean {
  return process.env.CHAT_EVAL_LOCAL_BYPASS_ENABLED === 'true';
}

function readChatLocalBrowserBypassEnabled(): boolean {
  return process.env.CHAT_LOCAL_BROWSER_BYPASS_ENABLED === 'true';
}

function readTigerLegacyFallbackEnabled(): boolean {
  return process.env.CHAT_TIGER_LEGACY_FALLBACK_ENABLED === 'true';
}

function readTigerNarratorEnabled(): boolean {
  if (process.env.CHAT_TIGER_NARRATOR_ENABLED === 'false') {
    return false;
  }

  return process.env.NODE_ENV !== 'test';
}

function readTigerNarratorTimeoutMs(): number {
  const parsed = Number(process.env.CHAT_TIGER_NARRATOR_TIMEOUT_MS ?? '3000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function readChatNluEnabled(): boolean {
  return process.env.CHAT_NLU_ENABLED === 'true';
}

function readChatNluTimeoutMs(): number {
  const parsed = Number(process.env.CHAT_NLU_TIMEOUT_MS ?? '2500');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
}

function readChatNluModel(): string | undefined {
  const value = process.env.CHAT_NLU_MODEL?.trim();
  return value ? value : undefined;
}

function readChatNluMinConfidence(): TigerInterpretationConfidence {
  const value = process.env.CHAT_NLU_MIN_CONFIDENCE?.trim().toLowerCase();
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'medium';
}

interface QueryAnalyticsArgs {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: Array<{ member: string; operator: string; values?: (string | number | boolean)[] }>;
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  reasoning: string;
}

function isLocalEvalBypassEligible(request: NextRequest, isEvalRequest: boolean): boolean {
  if (!isEvalRequest || !readChatEvalLocalBypassEnabled()) {
    return false;
  }

  return isLocalHostRequest(request);
}

async function resolveLocalEvalBypassUserId(
  deps: Pick<ChatRouteDependencies, 'getServiceClient'>
): Promise<string> {
  return resolveLocalBypassUserId({
    email:
      process.env.CHAT_EVAL_BYPASS_EMAIL?.trim().toLowerCase() ||
      process.env.BYPASS_AUTH_EMAIL?.trim().toLowerCase() ||
      '',
    missingEmailMessage:
      'Missing CHAT_EVAL_BYPASS_EMAIL or BYPASS_AUTH_EMAIL for local chat eval bypass.',
    notFoundMessage: (email) =>
      `Local chat eval bypass user not found in user_profiles for ${email}.`,
    lookupErrorMessage: (message) =>
      `Failed to resolve local chat eval bypass user: ${message || 'unknown error'}`,
  }, deps);
}

function isLocalBrowserBypassEligible(request: NextRequest): boolean {
  if (!readChatLocalBrowserBypassEnabled() || process.env.NODE_ENV !== 'development') {
    return false;
  }

  return isLocalHostRequest(request);
}

function shouldAttachLocalExecutionTrace(request: NextRequest): boolean {
  const traceHeader = request.headers.get('x-chat-eval-trace');
  return (
    (traceHeader === '1' || traceHeader === 'true') &&
    isLocalHostRequest(request)
  );
}

async function resolveLocalBrowserBypassUserId(
  deps: Pick<ChatRouteDependencies, 'getServiceClient'>
): Promise<string> {
  return resolveLocalBypassUserId({
    email:
      process.env.CHAT_LOCAL_BROWSER_BYPASS_EMAIL?.trim().toLowerCase() ||
      process.env.CHAT_EVAL_BYPASS_EMAIL?.trim().toLowerCase() ||
      process.env.BYPASS_AUTH_EMAIL?.trim().toLowerCase() ||
      '',
    missingEmailMessage:
      'Missing CHAT_LOCAL_BROWSER_BYPASS_EMAIL, CHAT_EVAL_BYPASS_EMAIL, or BYPASS_AUTH_EMAIL for local browser chat bypass.',
    notFoundMessage: (email) =>
      `Local browser chat bypass user not found in user_profiles for ${email}.`,
    lookupErrorMessage: (message) =>
      `Failed to resolve local browser chat bypass user: ${message || 'unknown error'}`,
  }, deps);
}

async function resolveLocalBypassUserId(params: {
  email: string;
  missingEmailMessage: string;
  notFoundMessage: (email: string) => string;
  lookupErrorMessage: (message: string | undefined) => string;
}, deps: Pick<ChatRouteDependencies, 'getServiceClient'>): Promise<string> {
  const { email, lookupErrorMessage, missingEmailMessage, notFoundMessage } = params;

  if (!email) {
    throw new Error(missingEmailMessage);
  }

  const serviceSupabase = deps.getServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, error } = await (serviceSupabase.from('user_profiles') as any)
    .select('id, email')
    .eq('email', email)
    .maybeSingle() as { data: { id: string; email: string | null } | null; error: { message?: string } | null };

  if (error) {
    throw new Error(lookupErrorMessage(error.message));
  }

  if (!profile?.id) {
    throw new Error(notFoundMessage(email));
  }

  return profile.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool(toolCall: ToolCall): Promise<{ success: boolean; error?: string; [key: string]: any }> {
  if (toolCall.name === 'query_database') {
    return {
      success: false,
      unavailable: true,
      error: 'query_database is not available in system chat.',
      sufficient_to_answer: false,
    };
  } else if (toolCall.name === 'query_analytics') {
    const args = toolCall.arguments as unknown as QueryAnalyticsArgs;
    const tigerCompatibleResult = await tryTigerQueryAnalyticsCompat(args);
    if (tigerCompatibleResult) {
      return tigerCompatibleResult;
    }
    return {
      success: false,
      unavailable: true,
      error:
        'query_analytics is not available in system chat. Use system-backed discovery, ranking, compare, momentum, or change-intel tools instead.',
      sufficient_to_answer: false,
    };
  } else if (toolCall.name === 'find_similar') {
    const args = toolCall.arguments as unknown as FindSimilarArgs;
    return findSimilarWithTimeout(args);
  } else if (toolCall.name === 'search_by_concept') {
    const args = toolCall.arguments as unknown as SearchByConceptArgs;
    return searchByConceptWithTimeout(args);
  } else if (toolCall.name === 'search_games') {
    const args = toolCall.arguments as unknown as SearchGamesArgs;
    return searchGames(args);
  } else if (toolCall.name === 'lookup_tags') {
    const args = toolCall.arguments as unknown as LookupTagsArgs;
    return lookupTags(args);
  } else if (toolCall.name === 'lookup_publishers') {
    const args = toolCall.arguments as unknown as LookupPublishersArgs;
    return lookupPublishers(args);
  } else if (toolCall.name === 'lookup_developers') {
    const args = toolCall.arguments as unknown as LookupDevelopersArgs;
    return lookupDevelopers(args);
  } else if (toolCall.name === 'lookup_games') {
    const args = toolCall.arguments as unknown as LookupGamesArgs;
    return lookupGames(args);
  } else if (toolCall.name === 'discover_trending') {
    const args = toolCall.arguments as unknown as DiscoverTrendingArgs;
    return discoverTrending(args);
  } else if (toolCall.name === 'screen_games') {
    const args = toolCall.arguments as unknown as ScreenGamesArgs;
    return screenGames(args);
  } else if (toolCall.name === 'query_change_activity') {
    const args = toolCall.arguments as unknown as QueryChangeActivityArgs;
    return queryChangeActivity(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'get_game_change_timeline') {
    const args = toolCall.arguments as unknown as GetGameChangeTimelineArgs;
    return getGameChangeTimeline(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'get_recent_news_detail') {
    const args = toolCall.arguments as unknown as GetRecentNewsDetailArgs;
    return getRecentNewsDetail(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'get_recent_news_digest') {
    const args = toolCall.arguments as unknown as GetRecentNewsDigestArgs;
    return getRecentNewsDigest(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'search_recent_news_topics') {
    const args = toolCall.arguments as unknown as SearchRecentNewsTopicsArgs;
    return searchRecentNewsTopics(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'get_change_activity_detail') {
    const args = toolCall.arguments as unknown as GetChangeActivityDetailArgs;
    return getChangeActivityDetail(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'compare_change_before_after') {
    const args = toolCall.arguments as unknown as CompareChangeBeforeAfterArgs;
    return compareChangeBeforeAfter(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  } else if (toolCall.name === 'find_change_patterns') {
    const args = toolCall.arguments as unknown as FindChangePatternsArgs;
    return findChangePatterns(args) as Promise<{ success: boolean; error?: string; [key: string]: any }>;
  }
  return { success: false, error: `Unknown tool: ${toolCall.name}` };
}

function formatSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSelectedEntities(value: unknown): ChatSelectedEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const validKinds = new Set<ChatSelectedEntity['entityKind']>(['game', 'publisher', 'developer']);
  const validPlatforms = new Set<ChatSelectedEntity['platform']>(['steam', 'publisheriq']);
  const validMatchQualities = new Set<NonNullable<ChatSelectedEntity['matchQuality']>>([
    'exact',
    'prefix',
    'substring',
    'fuzzy',
  ]);

  const normalized: ChatSelectedEntity[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : '';
    const entityKind = typeof item.entityKind === 'string' ? item.entityKind : '';
    const entityUid = typeof item.entityUid === 'string' ? item.entityUid.trim() : '';
    const platform = typeof item.platform === 'string' ? item.platform : '';
    const platformEntityId =
      typeof item.platformEntityId === 'string'
        ? item.platformEntityId.trim()
        : typeof item.platformEntityId === 'number'
          ? String(item.platformEntityId)
          : null;
    const matchQuality =
      typeof item.matchQuality === 'string' && validMatchQualities.has(item.matchQuality as NonNullable<ChatSelectedEntity['matchQuality']>)
        ? item.matchQuality as NonNullable<ChatSelectedEntity['matchQuality']>
        : null;

    if (
      !displayName
      || !entityUid
      || !validKinds.has(entityKind as ChatSelectedEntity['entityKind'])
      || !validPlatforms.has(platform as ChatSelectedEntity['platform'])
    ) {
      continue;
    }

    normalized.push({
      displayName,
      entityKind: entityKind as ChatSelectedEntity['entityKind'],
      entityUid,
      matchQuality,
      platform: platform as ChatSelectedEntity['platform'],
      ...(platformEntityId ? { platformEntityId } : {}),
    });
  }

  return normalized.slice(0, 3);
}

function buildSelectedEntitySelectionState(
  selectedEntities: ChatSelectedEntity[]
): SessionChatSelectionState | null {
  if (selectedEntities.length === 0) {
    return null;
  }

  return {
    family: 'request_binding',
    slots: selectedEntities.map((entity, index) => ({
      candidates: [{
        displayName: entity.displayName,
        entityKind: entity.entityKind,
        entityUid: entity.entityUid,
        matchSource: null,
        matchQuality: entity.matchQuality ?? 'exact',
        ordinal: index + 1,
        platform: entity.platform,
        platformEntityId: entity.platformEntityId ?? null,
        releaseYear: null,
        resolutionTier: null,
        score: 100,
        totalReviews: null,
      }],
      expectedEntityKind: entity.entityKind,
      label: entity.displayName,
      query: entity.displayName,
      requiresClarification: false,
      selectedEntityUid: entity.entityUid,
      slotId: `bound-${index + 1}`,
    })),
  };
}

function stripDebugFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripDebugFields(entry)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'debug') {
      continue;
    }

    sanitized[key] = stripDebugFields(entry);
  }

  return sanitized as T;
}

function sanitizeToolResultForClient<
  T extends { success: boolean; error?: string } & Record<string, unknown>,
>(result: T, canViewAdminDebug: boolean): T {
  return canViewAdminDebug ? result : stripDebugFields(result);
}

function sanitizeMessageEndEventForClient(
  event: MessageEndEvent,
  canViewAdminDebug: boolean
): MessageEndEvent {
  if (canViewAdminDebug) {
    return event;
  }

  const sanitizedEvent = { ...event };
  delete sanitizedEvent.debug;
  delete sanitizedEvent.tigerPrimary;
  delete sanitizedEvent.tigerShadow;
  return sanitizedEvent;
}

class ClientDisconnectError extends Error {
  constructor() {
    super('Client disconnected');
    this.name = 'ClientDisconnectError';
  }
}

function isClientDisconnectError(error: unknown): boolean {
  if (error instanceof ClientDisconnectError) {
    return true;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /already closed|client disconnected|controller is already closed|operation was aborted/i.test(message);
}

function classifyStreamFailureKind(error: unknown): string {
  if (isClientDisconnectError(error)) {
    return 'client_disconnect';
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return 'db_statement_timeout';
  }

  if (/429|rate limit/i.test(message)) {
    return 'openai_429';
  }

  if (/missing message_end/i.test(message)) {
    return 'missing_message_end';
  }

  return 'runtime_error';
}

function sumTigerAttemptTimingMs(
  attempts: Array<{ timingMs?: number | null }> | undefined
): number {
  return (attempts ?? []).reduce((total, attempt) => total + (attempt.timingMs ?? 0), 0);
}

function buildTigerSyntheticToolCall(params: {
  contractName:
    | 'compareEntities'
    | 'discoverMomentum'
    | 'getEntityOverview'
    | 'getRelatedEntities'
    | 'queryMonthlyPlaytime'
    | 'rankEntities'
    | 'searchCatalog'
    | 'semanticSearch';
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  resultSet?: SessionChatResultSet | null;
}): ChatToolCall {
  const { contractName, request, response, resultSet } = params;

  if (contractName === 'compareEntities') {
    return {
      name: 'compareEntities',
      arguments: request,
      result: {
        success: true,
        entityKind: response.entityKind,
        highlights: Array.isArray(response.highlights) ? response.highlights : [],
        items: Array.isArray(response.items) ? response.items : [],
        metrics: Array.isArray(response.metrics) ? response.metrics : [],
        sufficientToAnswer: response.sufficientToAnswer === true,
      },
    };
  }

  if (contractName === 'getEntityOverview') {
    const entity = isRecord(response.entity) ? response.entity : null;
    const details = entity && isRecord(entity.details) ? entity.details : null;
    const metrics = entity && isRecord(entity.metrics) ? entity.metrics : null;
    const entityKind = entity && typeof entity.entityKind === 'string' ? entity.entityKind : null;
    const displayName = entity && typeof entity.displayName === 'string' ? entity.displayName : 'Unknown';
    const platformEntityId =
      entity && typeof entity.platformEntityId === 'string' ? Number(entity.platformEntityId) : null;

    if (entityKind === 'game') {
      return {
        name: 'lookup_games',
        arguments: {
          query: displayName,
        },
        result: {
          query: displayName,
          results: [
            {
              appid: platformEntityId ?? 0,
              isExactMatch: true,
              name: displayName,
              releaseYear: typeof details?.releaseYear === 'number' ? details.releaseYear : null,
              similarityScore: 1,
            },
          ],
          success: true,
        },
      };
    }

    const companyId = typeof platformEntityId === 'number' ? platformEntityId : 0;
    return {
      name: entityKind === 'developer' ? 'lookup_developers' : 'lookup_publishers',
      arguments: {
        query: displayName,
      },
      result: {
        canonicalResult: {
          confidence: 'high',
          id: companyId,
          name: displayName,
        },
        entityType: entityKind,
        needsDisambiguation: false,
        query: displayName,
        resolutionConfidence: 'high',
        results: [
          {
            id: companyId,
            matchKind: 'exact',
            name: displayName,
            resolutionScore: 1,
          },
        ],
        success: true,
        summary: {
          avgReviewScore: typeof metrics?.reviewScore === 'number' ? metrics.reviewScore : null,
          gameCount: typeof metrics?.gameCount === 'number' ? metrics.gameCount : null,
          totalOwners: typeof metrics?.ownersMidpoint === 'number' ? metrics.ownersMidpoint : null,
          totalReviews: typeof metrics?.totalReviews === 'number' ? metrics.totalReviews : null,
        },
      },
    };
  }

  if (contractName === 'searchCatalog') {
    const items = Array.isArray(response.items)
      ? response.items
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            appid: typeof item.appid === 'number' ? item.appid : 0,
            name: typeof item.name === 'string' ? item.name : 'Unknown',
          }))
      : [];

    return {
      name: 'search_games',
      arguments: request,
      result: {
        success: true,
        results: items,
        total_found: items.length,
        ...(resultSet ? { continuation_meta: { resultSet } } : {}),
      },
    };
  }

  if (contractName === 'getRelatedEntities') {
    const items = Array.isArray(response.items)
      ? response.items
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            appid: typeof item.appid === 'number' ? item.appid : 0,
            name: typeof item.name === 'string' ? item.name : 'Unknown',
          }))
      : [];
    const source = isRecord(response.source) ? response.source : null;

    return {
      name: 'search_games',
      arguments: request,
      result: {
        success: true,
        relation_kind:
          typeof response.relationKind === 'string' ? response.relationKind : undefined,
        results: items,
        source_game:
          source && typeof source.displayName === 'string'
            ? {
                appid: typeof source.appid === 'number' ? source.appid : undefined,
                name: source.displayName,
              }
            : undefined,
        total_found: items.length,
        ...(resultSet ? { continuation_meta: { resultSet } } : {}),
      },
    };
  }

  if (contractName === 'rankEntities') {
    const items = Array.isArray(response.items)
      ? response.items
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            displayName: typeof item.displayName === 'string' ? item.displayName : 'Unknown',
            entityKind: typeof item.entityKind === 'string' ? item.entityKind : 'game',
            entityUid: typeof item.entityUid === 'string' ? item.entityUid : null,
            metricValue: typeof item.metricValue === 'number' ? item.metricValue : null,
            platformEntityId:
              typeof item.platformEntityId === 'string' || typeof item.platformEntityId === 'number'
                ? item.platformEntityId
                : null,
            rank: typeof item.rank === 'number' ? item.rank : null,
            releaseYear: typeof item.releaseYear === 'number' ? item.releaseYear : null,
          }))
      : [];

    return {
      name: 'rankEntities',
      arguments: request,
      result: {
        entityKind: typeof response.entityKind === 'string' ? response.entityKind : 'game',
        items,
        metric: typeof response.metric === 'string' ? response.metric : null,
        success: true,
        sufficientToAnswer: response.sufficientToAnswer === true,
      },
    };
  }

  if (contractName === 'discoverMomentum') {
    const items = Array.isArray(response.items)
      ? response.items
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            appid: typeof item.appid === 'number' ? item.appid : 0,
            ccuPeak: typeof item.ccuPeak === 'number' ? item.ccuPeak : null,
            developerName: typeof item.developerName === 'string' ? item.developerName : null,
            isFree: item.isFree === true,
            momentumScore: typeof item.momentumScore === 'number' ? item.momentumScore : null,
            name: typeof item.name === 'string' ? item.name : 'Unknown',
            publisherName: typeof item.publisherName === 'string' ? item.publisherName : null,
            supportLevel: typeof item.supportLevel === 'string' ? item.supportLevel : 'medium',
            supportReasons: Array.isArray(item.supportReasons)
              ? item.supportReasons.map((reason) => String(reason))
              : [],
            totalReviews: typeof item.totalReviews === 'number' ? item.totalReviews : null,
          }))
      : [];

    return {
      name: 'screen_games',
      arguments: request,
      result: {
        success: true,
        filters_applied: Array.isArray(response.filtersApplied)
          ? response.filtersApplied.map((value) => String(value))
          : [],
        ranking_definition:
          typeof response.rankingDefinition === 'string' ? response.rankingDefinition : undefined,
        ranking_label:
          typeof response.rankingLabel === 'string' ? response.rankingLabel : undefined,
        results: items,
        timeframe: typeof response.timeframe === 'string' ? response.timeframe : undefined,
        timeframe_label:
          typeof response.timeframeLabel === 'string' ? response.timeframeLabel : undefined,
        total_found: items.length,
        ...(resultSet ? { continuation_meta: { resultSet } } : {}),
      },
    };
  }

  return {
    name: typeof request.mode === 'string' && request.mode === 'concept' ? 'search_by_concept' : 'find_similar',
    arguments: request,
    result: {
      success: true,
      entityType:
        response.entityType === 'publisher' || response.entityType === 'developer'
          ? response.entityType
          : undefined,
      results: Array.isArray(response.results) ? response.results : [],
      total_found: typeof response.total_found === 'number' ? response.total_found : undefined,
      ...(resultSet ? { continuation_meta: { resultSet } } : {}),
    },
  };
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasAppliedMomentumFilter(
  response: Record<string, unknown>,
  filterKey: string
): boolean {
  if (!Array.isArray(response.filtersApplied)) {
    return false;
  }

  return response.filtersApplied.some(
    (entry) => typeof entry === 'string' && entry.toLowerCase().startsWith(`${filterKey.toLowerCase()}:`)
  );
}

function inferMomentumPromptFamilyFromHandler(params: {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}): SessionMomentumPromptFamily | null {
  const { request, response } = params;
  const filters = isRecord(request.filters) ? request.filters : null;
  const sortBy = typeof request.sortBy === 'string' ? request.sortBy : null;
  const sortDirection = request.sortDirection === 'asc' ? 'asc' : 'desc';
  const timeframe =
    request.timeframe === '7d' || request.timeframe === '30d' || request.timeframe === 'current'
      ? request.timeframe
      : null;
  const trendType =
    request.trendType === 'accelerating'
    || request.trendType === 'breaking_out'
    || request.trendType === 'declining'
    || request.trendType === 'review_momentum'
      ? request.trendType
      : null;

  if (sortBy === 'ccu_peak' && timeframe === 'current') {
    return 'current_players';
  }

  if (
    typeof filters?.maxSentimentDelta === 'number'
    || hasAppliedMomentumFilter(response, 'max_sentiment_delta')
  ) {
    return 'review_sentiment_down';
  }

  if (
    typeof filters?.minSentimentDelta === 'number'
    || hasAppliedMomentumFilter(response, 'min_sentiment_delta')
  ) {
    return 'review_sentiment_up';
  }

  if (sortBy === 'sentiment_delta') {
    return sortDirection === 'asc' ? 'review_sentiment_down' : 'review_sentiment_up';
  }

  if (sortBy === 'velocity_acceleration' && sortDirection === 'asc' && trendType !== 'declining') {
    return 'review_activity_down';
  }

  if (
    sortBy === 'reviews_added_7d'
    || sortBy === 'reviews_added_30d'
    || sortBy === 'velocity_7d'
    || trendType === 'review_momentum'
    || hasAppliedMomentumFilter(response, 'min_reviews_added_7d')
    || hasAppliedMomentumFilter(response, 'min_reviews_added_30d')
  ) {
    return 'review_activity_up';
  }

  if (trendType === 'breaking_out') {
    return 'breaking_out';
  }

  if (trendType === 'accelerating') {
    return 'accelerating';
  }

  if (trendType === 'declining') {
    return 'declining';
  }

  if (sortBy === 'momentum_score') {
    return 'trending';
  }

  return null;
}

function buildMomentumRequestStateFromHandler(params: {
  momentumPromptFamily?: SessionMomentumPromptFamily | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  timestamp?: string;
}): SessionChatRequestState | null {
  const items = Array.isArray(params.response.items)
    ? params.response.items.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
  if (items.length === 0) {
    return null;
  }

  const canonicalArgs = cloneRecord(params.request);
  delete canonicalArgs.excludeAppIds;

  return {
    canonicalArgs,
    contractName: 'discoverMomentum',
    entityKind: 'game',
    family: 'momentum_discovery',
    metric: typeof params.request.sortBy === 'string' ? params.request.sortBy : null,
    momentumPromptFamily: params.momentumPromptFamily ?? inferMomentumPromptFamilyFromHandler(params),
    previewItems: items.slice(0, 10).map((item, index) => ({
      entityUid: typeof item.entityUid === 'string' ? item.entityUid : null,
      label: typeof item.name === 'string' ? item.name : `Result ${index + 1}`,
      ordinal: index + 1,
      platformEntityId:
        typeof item.appid === 'number' || typeof item.appid === 'string'
          ? item.appid
          : null,
    })),
    timeframe:
      params.request.timeframe === '7d' || params.request.timeframe === '30d' || params.request.timeframe === 'current'
        ? params.request.timeframe
        : null,
    trendType:
      params.request.trendType === 'accelerating'
      || params.request.trendType === 'breaking_out'
      || params.request.trendType === 'declining'
      || params.request.trendType === 'review_momentum'
        ? params.request.trendType
        : null,
    updatedAt: params.timestamp ?? new Date().toISOString(),
  };
}

function buildSessionLogSummary(
  context: SessionChatContext | null | undefined,
  toolCalls: ChatToolCall[],
  quality?: ChatTurnQualityInfo | null,
  failureKind?: string,
  tigerPrimary?: MessageEndEvent['tigerPrimary'],
  tigerShadow?: MessageEndEvent['tigerShadow']
): Record<string, unknown> | null {
  const summary = summarizeSessionContextForLog(context) ?? {};
  const selectedChangeSurfaces = Array.from(
    new Set(
      toolCalls
        .map((toolCall) =>
          isRecord(toolCall.result) && typeof toolCall.result.selected_change_surface === 'string'
            ? toolCall.result.selected_change_surface
            : null
        )
        .filter((value): value is string => Boolean(value))
    )
  );

  if (selectedChangeSurfaces.length > 0) {
    summary.selectedChangeSurfaces = selectedChangeSurfaces;
  }

  if (quality?.renderMode) {
    summary.renderMode = quality.renderMode;
  }

  if (typeof quality?.terminalAfterIteration === 'number') {
    summary.terminalAfterIteration = quality.terminalAfterIteration;
  }

  if (typeof quality?.modelHistoryChars === 'number') {
    summary.modelHistoryChars = quality.modelHistoryChars;
  }

  if (quality?.continuationDetected) {
    summary.continuationDetected = true;
    summary.continuationIntent = quality.continuationIntent ?? null;
    summary.continuationSourceTool = quality.continuationSourceTool ?? null;
    summary.requestedCount = quality.requestedCount ?? null;
    summary.excludedCount = quality.excludedCount ?? null;
    summary.continuationExhausted = quality.continuationExhausted ?? false;
  }

  if (failureKind) {
    summary.failureKind = failureKind;
  }

  if (tigerPrimary) {
    summary.tigerPrimaryRoute = tigerPrimary.route;
    summary.tigerPrimaryIntent = tigerPrimary.matchedIntent;
    summary.tigerPrimaryRenderMode = tigerPrimary.renderMode;
    summary.tigerPrimaryEnabled = tigerPrimary.enabled;
    summary.tigerPrimaryCohort = tigerPrimary.cohort;
    summary.tigerPrimaryAttemptedContracts = Array.from(
      new Set((tigerPrimary.attempts ?? []).map((attempt) => attempt.contractName))
    );
    const primaryReasons = Array.from(
      new Set(
        (tigerPrimary.attempts ?? [])
          .map((attempt) => attempt.reason)
          .filter((value): value is string => Boolean(value))
          .map((value) => sanitizeForwardFacingDataCopy(value))
      )
    );
    if (primaryReasons.length > 0) {
      summary.tigerPrimaryReasons = primaryReasons;
    }
  }

  if (tigerShadow) {
    summary.tigerShadowRoute = tigerShadow.route;
    summary.tigerShadowIntent = tigerShadow.matchedIntent;
    summary.tigerShadowEnabled = tigerShadow.enabled;
    summary.tigerShadowCohort = tigerShadow.cohort;
    summary.tigerShadowAttemptedContracts = Array.from(
      new Set((tigerShadow.attempts ?? []).map((attempt) => attempt.contractName))
    );
    const shadowReasons = Array.from(
      new Set(
        (tigerShadow.attempts ?? [])
          .map((attempt) => attempt.reason)
          .filter((value): value is string => Boolean(value))
          .map((value) => sanitizeForwardFacingDataCopy(value))
      )
    );
    if (shadowReasons.length > 0) {
      summary.tigerShadowReasons = shadowReasons;
    }
  }

  if (!summary.tigerRolloutCohort && (tigerPrimary?.cohort || tigerShadow?.cohort)) {
    summary.tigerRolloutCohort = tigerPrimary?.cohort ?? tigerShadow?.cohort ?? null;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function buildSystemPrompt(sessionContext: SessionChatContext | null): string {
  const basePrompt = buildTigerSystemPrompt();
  const contextPrompt = buildSessionContextPrompt(sessionContext);

  if (!readChatPhase1QualityEnabled()) {
    return [basePrompt, contextPrompt].filter(Boolean).join('\n\n');
  }

  const phase1Instructions = [
    'PHASE 1 QUALITY CONTRACTS:',
    '- Respect phase1_contract metadata in tool results.',
    '- If phase1_contract.needs_clarification is true, ask the clarification instead of broadening.',
    '- If phase1_contract.no_match is true, explain what was checked and stay constrained unless the fallback_action explicitly allows one retry.',
    '- If response_guidance is present, use that answer shape exactly.',
  ].join('\n');

  return [basePrompt, phase1Instructions, contextPrompt].filter(Boolean).join('\n\n');
}

function extractTigerPrimaryReasons(
  tigerPrimary: MessageEndEvent['tigerPrimary'] | undefined
): string[] {
  return Array.from(
    new Set(
      (tigerPrimary?.attempts ?? [])
        .map((attempt) => attempt.reason?.trim())
        .filter((reason): reason is string => Boolean(reason))
        .map((reason) => sanitizeForwardFacingDataCopy(reason))
    )
  );
}

const TIGER_RUNTIME_FAILURE_PATTERN =
  /internal server error|failed to fetch|fetch failed|network|timeout|timed out|connection|socket|econn|abort/i;

function isTigerContractRuntimeBlockedAttempt(
  attempt: NonNullable<MessageEndEvent['tigerPrimary']>['attempts'][number]
): boolean {
  if (attempt.errorCode === 'CONTRACT_RUNTIME_UNAVAILABLE') {
    return true;
  }

  return typeof attempt.reason === 'string'
    && /not ready on .* until the required tables are present and backfilled|backfilled/i.test(attempt.reason);
}

function isTigerTransientAttemptFailure(
  attempt: NonNullable<MessageEndEvent['tigerPrimary']>['attempts'][number]
): boolean {
  if (isTigerContractRuntimeBlockedAttempt(attempt)) {
    return false;
  }

  if (attempt.httpStatus === 429) {
    return true;
  }

  if (typeof attempt.httpStatus === 'number' && attempt.httpStatus >= 500) {
    return true;
  }

  return typeof attempt.reason === 'string' && TIGER_RUNTIME_FAILURE_PATTERN.test(attempt.reason);
}

function getContinuationMatchedIntent(
  sourceContract: TigerContractContinuationResult['sourceContract']
): 'catalog_search' | 'momentum_discovery' | 'semantic_search' {
  if (sourceContract === 'discoverMomentum') {
    return 'momentum_discovery';
  }

  if (sourceContract === 'searchCatalog') {
    return 'catalog_search';
  }

  return 'semantic_search';
}

function buildTigerOnlyFallbackReply(params: {
  tigerPrimary: NonNullable<MessageEndEvent['tigerPrimary']>;
}): string {
  const { tigerPrimary } = params;
  const primaryReason = extractTigerPrimaryReasons(tigerPrimary)[0] ?? null;
  const reasonSuffix = primaryReason ? `\n\nReason: ${primaryReason}` : '';
  const hasCompareRuntimeBlockedFailure =
    tigerPrimary.matchedIntent === 'entity_compare'
    && tigerPrimary.attempts.some(isTigerContractRuntimeBlockedAttempt);
  const hasCompareTransientFailure =
    tigerPrimary.matchedIntent === 'entity_compare'
    && tigerPrimary.attempts.some(isTigerTransientAttemptFailure);
  const weeklyReviewSentimentNoResults =
    tigerPrimary.matchedIntent === 'momentum_discovery'
    && primaryReason != null
    && /weekly review-sentiment screen/i.test(primaryReason);

  switch (tigerPrimary.matchedIntent) {
    case 'entity_overview':
      return `I couldn't route that overview cleanly in the system yet because it couldn't resolve a single stable game or company. Try the exact Steam title or the exact studio or publisher name.${reasonSuffix}`;
    case 'entity_compare':
      if (hasCompareRuntimeBlockedFailure) {
        return `I couldn't complete that comparison from the current structured data yet because the compare surface isn't fully ready in this environment.`;
      }
      if (hasCompareTransientFailure) {
        return `I couldn't complete that comparison from PublisherIQ data right now. Please try again in a moment.`;
      }
      return `I couldn't route that comparison cleanly in the system yet. Try \`compare FromSoftware and Rockstar Games by reviews\` or name the exact entities you want compared.${reasonSuffix}`;
    case 'catalog_search':
      return `I couldn't route that catalog search cleanly in the system yet. Try a simpler request like \`show me all games by FromSoftware\` or \`show me Linux games with overwhelmingly positive reviews\`.${reasonSuffix}`;
    case 'entity_ranking':
      return `I couldn't route that ranking cleanly in the system yet. Try a direct ranking like \`what are the top games by reviews?\` or \`what publisher has the most games on Steam?\`.${reasonSuffix}`;
    case 'momentum_discovery':
      if (weeklyReviewSentimentNoResults) {
        return `I couldn't find a stable week-over-week review-sentiment set even after broadening from market-leading titles to established mid-tier games. Try narrowing to indie, Linux, or Steam Deck verified games, or switch back to the 30-day view.${reasonSuffix}`;
      }
      return `I couldn't route that momentum request cleanly in the system yet. Try a direct discovery like \`what games are trending this week?\`, \`what games are breaking out this week?\`, or \`show free-to-play games with the most players\`.${reasonSuffix}`;
    case 'metric_history':
      return `I couldn't route that history request cleanly in the system yet because it couldn't resolve a single game. Try the exact Steam title and a direct time window, like \`How have Hades II reviews changed over the last 30 days?\`${reasonSuffix}`;
    case 'news_search':
      return `I couldn't route that news lookup cleanly in the system yet. Try the exact game title, like \`Any recent announcements about Primeval?\`${reasonSuffix}`;
    case 'change_explanation':
      return `I couldn't route that change explanation cleanly in the system yet. Try the exact game title, like \`What changed for Primeval this week?\`${reasonSuffix}`;
    case 'change_discovery':
      return `I couldn't route that change-discovery prompt cleanly in the system yet. Try a direct prompt like \`show recent store-page changes\` or \`find games teasing a big update\`.${reasonSuffix}`;
    case 'semantic_search':
      return `I couldn't route that similarity prompt cleanly in the system yet. Try \`games like Hades with better reviews\` or describe the concept more directly.${reasonSuffix}`;
    default:
      return `I couldn't route that prompt cleanly in the system yet. It currently handles catalog discovery, rankings, momentum discovery, game and company overviews, direct comparisons, metric history, change and news lookups, and semantic similarity. Try naming the game or company and the task directly.${reasonSuffix}`;
  }
}

const DATE_TOKEN_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const NUMERIC_TOKEN_PATTERN = /\b\d[\d,]*(?:\.\d+)?%?\b/g;

function collectGroundingTokens(values: Array<string | null | undefined>): {
  dates: Set<string>;
  numerics: Set<string>;
} {
  const dates = new Set<string>();
  const numerics = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const match of value.match(DATE_TOKEN_PATTERN) ?? []) {
      dates.add(match);
      numerics.add(match);
    }

    for (const match of value.match(NUMERIC_TOKEN_PATTERN) ?? []) {
      numerics.add(match);
    }
  }

  return { dates, numerics };
}

async function interpretTigerPrompt(params: {
  deps: Pick<ChatRouteDependencies, 'createProvider' | 'now'>;
  prompt: string;
  sessionContext: SessionChatContext | null;
}): Promise<{ durationMs: number; interpretation: TigerPromptInterpretation | null }> {
  if (!readChatNluEnabled()) {
    return { durationMs: 0, interpretation: null };
  }

  const startedAt = params.deps.now();

  try {
    const provider = params.deps.createProvider(undefined, readChatNluModel());
    const response = await Promise.race([
      provider.chat(buildTigerPromptInterpreterMessages({
        prompt: params.prompt,
        sessionContext: params.sessionContext,
      })),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Prompt interpreter timed out')), readChatNluTimeoutMs())
      ),
    ]);
    const durationMs = params.deps.now() - startedAt;
    const interpretation = parseTigerPromptInterpretation(response.content);

    if (!interpretation) {
      return { durationMs, interpretation: null };
    }

    const minConfidence = readChatNluMinConfidence();
    const usable =
      tigerInterpretationMeetsThreshold(interpretation, minConfidence)
      || (interpretation.confidence === 'low' && Boolean(interpretation.clarificationQuestion));

    return {
      durationMs,
      interpretation: usable ? interpretation : null,
    };
  } catch {
    return {
      durationMs: params.deps.now() - startedAt,
      interpretation: null,
    };
  }
}

function buildTigerNarrationMessages(params: {
  brief: TigerAnswerBrief;
  prompt: string;
}): Message[] {
  return [
    {
      role: 'system',
      content: buildTigerNarratorSystemPrompt(),
    },
    {
      role: 'user',
      content: [
        `User question:\n${params.prompt}`,
        '',
        `Answer brief:\n${JSON.stringify({
          answerKind: params.brief.answerKind,
          directAnswer: params.brief.directAnswer,
          narrationConfidence: params.brief.narrationConfidence ?? 'medium',
          narrationFacts: params.brief.narrationFacts ?? params.brief.keyFacts,
          provenanceSummary: params.brief.provenanceSummary ?? null,
          selectionNote: params.brief.selectionNote ?? null,
        }, null, 2)}`,
      ].join('\n'),
    },
  ];
}

function isUsableTigerNarration(
  brief: TigerAnswerBrief,
  value: string | null | undefined
): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (/\b(from (?:the system)|system-backed|contract|tool call|internal routing)\b/i.test(normalized)) {
    return false;
  }

  if (/\b(?:check|look at|look on|see)\b.+\b(?:other platforms|gaming platforms|websites|reviews|sources|coverage)\b/i.test(normalized)) {
    return false;
  }

  if (
    /\b(?:brief|prompt|question)\b.+\b(?:did(?:n't| not)|was(?:n't| not)|weren't|were not)\b/i.test(normalized)
    || /\b(?:titles?|metrics?|details?)\s+(?:weren't|were not|wasn't|was not|didn't)\s+(?:provided|specified)\b/i.test(normalized)
  ) {
    return false;
  }

  const groundingSource = [
    brief.directAnswer,
    ...(brief.narrationFacts ?? brief.keyFacts),
    brief.selectionNote ?? null,
  ];
  const allowed = collectGroundingTokens(groundingSource);
  const candidate = collectGroundingTokens([normalized]);

  for (const date of allowed.dates) {
    if (!candidate.dates.has(date)) {
      return false;
    }
  }

  for (const numeric of candidate.numerics) {
    if (!allowed.numerics.has(numeric)) {
      return false;
    }
  }

  return true;
}

async function narrateTigerAnswer(params: {
  brief: TigerAnswerBrief;
  deps: Pick<ChatRouteDependencies, 'createProvider' | 'now'>;
  prompt: string;
}): Promise<{ content: string | null; durationMs: number }> {
  if (!readTigerNarratorEnabled() || params.brief.answerKind !== 'success') {
    return { content: null, durationMs: 0 };
  }

  const narrationMessages = buildTigerNarrationMessages({
    brief: params.brief,
    prompt: params.prompt,
  });
  const startedAt = params.deps.now();

  try {
    const provider = params.deps.createProvider();
    const response = await Promise.race([
      provider.chat(narrationMessages),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('System narrator timed out')), readTigerNarratorTimeoutMs())
      ),
    ]);
    const durationMs = params.deps.now() - startedAt;
    const content = response && typeof response === 'object' && 'content' in response
      ? (response.content ?? null)
      : null;

    return {
      content: isUsableTigerNarration(params.brief, content) ? content.trim() : null,
      durationMs,
    };
  } catch {
    return {
      content: null,
      durationMs: params.deps.now() - startedAt,
    };
  }
}

async function executeResolvedToolCall(params: {
  deps: Pick<ChatRouteDependencies, 'executeTool' | 'now'>;
  toolCall: ToolCall;
  lastUserPrompt: string;
  phase1State: ReturnType<typeof createPhase1GuardrailState> | null;
  emitToolResultEvent?: (event: ToolResultEvent) => void;
  emitResultEvent?: boolean;
}): Promise<{
  result: QueryResult | SimilarityResult | Record<string, unknown>;
  toolExecutionMs: number;
  contract: ReturnType<typeof buildToolAnswerContractSummary> | null;
}> {
  const {
    deps,
    toolCall,
    lastUserPrompt,
    phase1State,
    emitToolResultEvent,
    emitResultEvent = true,
  } = params;
  const toolStart = deps.now();
  const rawResult = await deps.executeTool(toolCall);
  const toolExecutionMs = deps.now() - toolStart;
  const policyResult = await applyCompanyToolResultPolicy(
    lastUserPrompt,
    toolCall,
    rawResult
  );
  const contract =
    phase1State && isRecord(policyResult)
      ? buildToolAnswerContractSummary(toolCall, policyResult)
      : null;
  const result = contract && isRecord(policyResult)
    ? attachPhase1MetadataToResult(policyResult, contract)
    : policyResult;

  if (phase1State && contract) {
    observeExecutedToolCall(phase1State, toolCall, contract);
  }

  if (emitResultEvent) {
    const toolResultEvent: ToolResultEvent = {
      type: 'tool_result',
      toolCallId: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      result,
      timing: { executionMs: Math.round(toolExecutionMs) },
    };
    emitToolResultEvent?.(toolResultEvent);
  }

  return {
    result,
    toolExecutionMs,
    contract,
  };
}

export async function handleChatStreamRequest(
  request: NextRequest,
  {
    deps: dependencyOverrides,
    requireEvalSecret,
  }: {
    deps?: Partial<ChatRouteDependencies>;
    requireEvalSecret: boolean;
  }
): Promise<Response> {
  const deps = {
    ...createDefaultChatRouteDependencies(),
    ...dependencyOverrides,
  } satisfies ChatRouteDependencies;
  const requestStart = deps.now();
  const encoder = new TextEncoder();
  const presentedEvalSecret = request.headers.get('x-chat-eval-secret');
  const chatEvalSecret = readChatEvalSecret();
  const isEvalRequest =
    Boolean(chatEvalSecret) &&
    presentedEvalSecret === chatEvalSecret;
  const captureExecutionTrace = isEvalRequest || shouldAttachLocalExecutionTrace(request);

  if (requireEvalSecret && !isEvalRequest) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Missing or invalid chat eval secret' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Auth check, with an eval-only localhost bypass for local shadow testing.
  const supabase = await deps.createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let userId = user?.id ?? null;
  let usedLocalBrowserBypass = false;

  if (!userId && isLocalEvalBypassEligible(request, isEvalRequest)) {
    try {
      userId = await resolveLocalEvalBypassUserId(deps);
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'eval_bypass_misconfigured',
          message: error instanceof Error ? error.message : 'Local chat eval bypass is misconfigured',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (!userId && !isEvalRequest && isLocalBrowserBypassEligible(request)) {
    try {
      userId = await resolveLocalBrowserBypassUserId(deps);
      usedLocalBrowserBypass = true;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'local_browser_bypass_misconfigured',
          message: error instanceof Error ? error.message : 'Local browser chat bypass is misconfigured',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const skipUsageAccounting = isEvalRequest || usedLocalBrowserBypass;
  const creditsEnabled = readCreditsEnabled() && !skipUsageAccounting;
  let reservationId: string | null = null;
  const serviceSupabase = deps.getServiceClient();
  type ChatProfileLookup = {
    data: { credit_balance: number; role: string | null } | null;
    error: { message?: string } | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatProfileLookup: ChatProfileLookup = userId
    ? await ((serviceSupabase.from('user_profiles') as any)
        .select('credit_balance, role')
        .eq('id', userId)
        .maybeSingle() as Promise<ChatProfileLookup>)
    : { data: null, error: null };
  const { data: chatProfile } = chatProfileLookup;
  const canViewAdminDebug = chatProfile?.role === 'admin';

  // Check credits if enabled
  if (creditsEnabled) {
    if (!chatProfile || chatProfile.credit_balance < MINIMUM_CHARGE) {
      return new Response(
        JSON.stringify({
          error: 'insufficient_credits',
          message: "You don't have enough credits to use chat. Please contact your administrator.",
          balance: chatProfile?.credit_balance ?? 0,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rateLimitResult } = await (supabase.rpc as any)('check_and_increment_rate_limit', {
      p_user_id: userId,
    }) as { data: Array<{ allowed: boolean; retry_after_seconds: number }> | null };

    if (rateLimitResult && !rateLimitResult[0]?.allowed) {
      const retryAfter = rateLimitResult[0]?.retry_after_seconds ?? 60;
      return new Response(
        JSON.stringify({
          error: 'rate_limited',
          message: 'Too many requests. Please try again later.',
          retry_after: retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        }
      );
    }

    // Reserve credits upfront
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reserveResult } = await (supabase.rpc as any)('reserve_credits', {
      p_user_id: userId,
      p_amount: DEFAULT_RESERVATION,
    }) as { data: string | null };

    if (!reserveResult) {
      return new Response(
        JSON.stringify({
          error: 'insufficient_credits',
          message: "Failed to reserve credits. You may not have enough credits.",
          balance: chatProfile.credit_balance,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    reservationId = reserveResult;
  }

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const markStreamClosed = () => {
        streamClosed = true;
      };
      const ensureStreamWritable = () => {
        if (streamClosed || request.signal.aborted) {
          throw new ClientDisconnectError();
        }
      };
      const emitEvent = (event: StreamEvent) => {
        ensureStreamWritable();
        try {
          controller.enqueue(encoder.encode(formatSSE(event)));
        } catch (error) {
          if (isClientDisconnectError(error)) {
            markStreamClosed();
            throw new ClientDisconnectError();
          }
          throw error;
        }
      };
      const emitToolResultEvent = (event: ToolResultEvent) => {
        emitEvent({
          ...event,
          result: sanitizeToolResultForClient(event.result, canViewAdminDebug),
        });
      };
      const emitMessageEndEvent = (event: MessageEndEvent) => {
        emitEvent(sanitizeMessageEndEventForClient(event, canViewAdminDebug));
      };
      const closeStream = () => {
        if (streamClosed) {
          return;
        }
        markStreamClosed();
        try {
          controller.close();
        } catch (error) {
          if (!isClientDisconnectError(error)) {
            throw error;
          }
        }
      };
      const handleAbort = () => {
        markStreamClosed();
      };

      request.signal.addEventListener('abort', handleAbort, { once: true });

      // Track token usage across all iterations
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let creditsCharged = 0;
      let body: ChatRequest | null = null;
      let lastUserMessageContent: string | null = null;
      let tigerPrimaryResult: MessageEndEvent['tigerPrimary'];
      let tigerFollowUpSuggestions: MessageEndEvent['followUpSuggestions'];
      let tigerRequestState: SessionChatRequestState | null = null;
      let tigerShadow: TigerShadowInfo | undefined;
      const executedToolNames: string[] = [];
      const executedToolCalls: ChatToolCall[] = [];
      const allToolCalls: ChatToolCall[] = [];
      const executionTrace: ChatExecutionTraceEntry[] = [];
      let phase1Quality: ChatTurnQualityInfo | undefined;
      let updatedSessionContext: SessionChatContext | null = null;
      let totalLlmMs = 0;
      let totalToolsMs = 0;
      const debugStats: StreamDebugInfo = {
        iterations: 0,
        textDeltaCount: 0,
        totalChars: 0,
        toolCallCount: 0,
        lastIterationHadText: false,
      };
      const recordExecutionTrace = (entries: ChatExecutionTraceEntry[]) => {
        if (!captureExecutionTrace || entries.length === 0) {
          return;
        }

        executionTrace.push(...entries);
      };

      try {
        body = (await request.json()) as ChatRequest;

        if (!body.messages || !Array.isArray(body.messages)) {
          const errorEvent: ErrorEvent = { type: 'error', message: 'Invalid request: messages array required' };
          emitEvent(errorEvent);
          closeStream();
          return;
        }

        const chatPhase1QualityEnabled = readChatPhase1QualityEnabled();
        const sessionContext = isRecord(body.sessionContext)
          ? (body.sessionContext as SessionChatContext)
          : null;
        const selectedEntities = normalizeSelectedEntities(body.selectedEntities);
        const requestSelectionState = buildSelectedEntitySelectionState(selectedEntities);
        const requestSessionContext = requestSelectionState
          ? applyTigerPrimarySessionState({
              baseContext: sessionContext,
              selectionState: requestSelectionState,
            })
          : sessionContext;
        const lastUserPrompt = body.messages.filter((message) => message.role === 'user').pop()?.content ?? '';
        lastUserMessageContent = lastUserPrompt || null;
        updatedSessionContext = requestSessionContext;
        const tigerPromptInterpretation = lastUserPrompt
          ? await interpretTigerPrompt({
              deps,
              prompt: lastUserPrompt,
              sessionContext: requestSessionContext,
            })
          : { durationMs: 0, interpretation: null };
        totalLlmMs += tigerPromptInterpretation.durationMs;

        const prePrimaryContinuationResolution = resolveResultSetContinuation(
          lastUserPrompt,
          requestSessionContext
        );

        if (!prePrimaryContinuationResolution) {
          const tigerPrimaryEvaluation = await deps.runTigerPrimaryEvaluation({
            interpretation: tigerPromptInterpretation.interpretation,
            isEvalRequest,
            prompt: lastUserPrompt,
            sessionContext: requestSessionContext,
            userId,
          });
          const tigerPrimaryInfo = tigerPrimaryEvaluation.info;
          totalToolsMs += sumTigerAttemptTimingMs(tigerPrimaryInfo.attempts);
          tigerPrimaryResult = tigerPrimaryInfo;
          const normalizedTigerSelectionState = normalizeTigerSelectionState(
            tigerPrimaryEvaluation.sessionState?.selectionState
          );
          const normalizedTigerLastAnswer = normalizeTigerLastAnswer({
            lastAnswer: tigerPrimaryEvaluation.sessionState?.lastAnswer ?? null,
            selectionState: normalizedTigerSelectionState,
          });
          const tigerRenderData = tigerPrimaryEvaluation.contractResult
            ? buildTigerChatRenderData({
                contractName: tigerPrimaryEvaluation.contractResult.contractName,
                response: tigerPrimaryEvaluation.contractResult.response,
              })
            : buildTigerClarificationRenderData({
                originalPrompt: lastUserPrompt,
                selectionState: normalizedTigerSelectionState,
              });
          recordExecutionTrace(
            buildTigerAttemptTraceEntries({
              attempts: tigerPrimaryInfo.attempts,
              stage: 'tiger_primary',
            })
          );

          if (tigerPrimaryResult.route === 'primary_success' && tigerPrimaryEvaluation.renderedText) {
            tigerFollowUpSuggestions = tigerPrimaryEvaluation.followUpSuggestions ?? undefined;

            if (
              tigerPrimaryEvaluation.contractResult &&
              isRecord(tigerPrimaryEvaluation.contractResult.response)
            ) {
              const contractResult = tigerPrimaryEvaluation.contractResult;
              const resultSet =
                contractResult.contractName === 'discoverMomentum'
                  ? buildTigerPrimaryResultSet({
                      family: 'momentum',
                      result: contractResult.response as Record<string, unknown>,
                      sourceArgs: contractResult.request,
                      sourceContract: 'discoverMomentum',
                      sourceTool: 'screen_games',
                    })
                  : contractResult.contractName === 'rankEntities'
                    ? null
                  : contractResult.contractName === 'searchCatalog'
                  ? buildTigerPrimaryResultSet({
                      family: 'discovery',
                      result: contractResult.response as Record<string, unknown>,
                      sourceArgs: contractResult.request,
                      sourceContract: 'searchCatalog',
                    })
                  : contractResult.contractName === 'semanticSearch'
                    ? buildTigerPrimaryResultSet({
                        family:
                          contractResult.request.mode === 'concept'
                            ? 'concept'
                            : contractResult.request.entityKind === 'game'
                              ? 'similarity'
                              : 'company_similarity',
                        result: contractResult.response as Record<string, unknown>,
                        sourceArgs: contractResult.request,
                        sourceContract: 'semanticSearch',
                      })
                    : null;

              const syntheticToolCall =
                contractResult.contractName === 'traceMetricHistory'
                || contractResult.contractName === 'getYoutubeGameCoverage'
                || contractResult.contractName === 'queryMonthlyPlaytime'
                  ? null
                  : buildTigerSyntheticToolCall({
                      contractName: contractResult.contractName,
                      request: contractResult.request,
                      response: contractResult.response as Record<string, unknown>,
                      resultSet,
                    });

              if (syntheticToolCall) {
                updatedSessionContext = buildSessionContextFromTurn({
                  previousContext: requestSessionContext,
                  executedToolCalls: [syntheticToolCall],
                  terminalContract: null,
                });
              }
            }

            tigerRequestState = tigerPrimaryEvaluation.sessionState?.requestState ?? null;
            if (tigerPrimaryEvaluation.sessionState) {
              updatedSessionContext = applyTigerPrimarySessionState({
                baseContext: updatedSessionContext,
                lastAnswer: normalizedTigerLastAnswer,
                requestState: tigerPrimaryEvaluation.sessionState.requestState,
                selectionState: normalizedTigerSelectionState,
              });
            }

          let primaryText = tigerPrimaryEvaluation.renderedText;
          const primaryAnswerBrief = tigerPrimaryEvaluation.answerBrief;
          if (primaryAnswerBrief && primaryAnswerBrief.allowNarration !== false) {
            const narration = await narrateTigerAnswer({
              brief: primaryAnswerBrief,
              deps,
              prompt: lastUserPrompt,
            });
            totalLlmMs += narration.durationMs;

            if (narration.content) {
              primaryText = renderTigerNarratedAnswer({
                brief: primaryAnswerBrief,
                narration: narration.content,
              });
              tigerPrimaryResult = {
                ...tigerPrimaryResult,
                renderMode: 'hybrid_narrator',
              };
            }
          }

          debugStats.textDeltaCount = 1;
          debugStats.totalChars = primaryText.length;
          debugStats.lastIterationHadText = true;

          if (lastUserMessageContent && !skipUsageAccounting) {
            try {
              await deps.logChatQuery({
                query_text: lastUserMessageContent.slice(0, 2000),
                tool_names: [],
                tool_count: 0,
                iteration_count: 0,
                response_length: debugStats.totalChars,
                timing_llm_ms: totalLlmMs > 0 ? Math.round(totalLlmMs) : 0,
                timing_tools_ms: Math.round(totalToolsMs),
                timing_total_ms: Math.round(deps.now() - requestStart),
                user_id: userId ?? undefined,
                input_tokens: undefined,
                output_tokens: undefined,
                tool_credits_used: creditsEnabled ? 0 : undefined,
                total_credits_charged: creditsEnabled ? creditsCharged : undefined,
                chat_family: phase1Quality?.family,
                quality_flags: phase1Quality?.qualityFlags,
                session_context_summary: buildSessionLogSummary(
                  updatedSessionContext,
                  allToolCalls,
                  phase1Quality,
                  undefined,
                  tigerPrimaryResult,
                  undefined
                ),
                guardrail_trace: phase1Quality?.guardrailTrace,
                answer_contract_summary: phase1Quality?.terminalContract ?? null,
              });
            } catch (logError) {
              console.error('Failed to log system primary chat query:', logError);
            }
          }

          const textEvent: TextDeltaEvent = {
            type: 'text_delta',
            delta: primaryText,
          };
          emitEvent(textEvent);

          const endEvent: MessageEndEvent = {
            type: 'message_end',
            timing: {
              llmMs: Math.round(totalLlmMs),
              toolsMs: Math.round(totalToolsMs),
              totalMs: Math.round(deps.now() - requestStart),
            },
            debug: debugStats,
            quality: phase1Quality,
            sessionContext: updatedSessionContext,
            executionTrace: captureExecutionTrace ? executionTrace : undefined,
            followUpSuggestions: tigerFollowUpSuggestions,
            renderData: tigerRenderData ?? undefined,
            tigerPrimary: tigerPrimaryResult,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
            creditsCharged: creditsEnabled ? creditsCharged : undefined,
          };
          emitMessageEndEvent(endEvent);
          return;
        }
        }

        const provider = deps.createProvider();

        // Check if provider supports streaming
        if (!provider.chatStream) {
          const errorEvent: ErrorEvent = { type: 'error', message: 'Provider does not support streaming' };
          emitEvent(errorEvent);
          closeStream();
          return;
        }

        // Streaming /chat is the canonical production runtime. Keep one
        // structured tool surface here so change-intel behavior does not
        // silently disappear behind legacy SQL-mode environment toggles.
        const systemPrompt = buildSystemPrompt(requestSessionContext);
        const tools: Tool[] = CUBE_TOOLS;

        let messages: Message[] = [{ role: 'system', content: systemPrompt }, ...body.messages];

        let iterations = 0;
        let lastBroadDiscoveryState: BroadDiscoveryState | null = null;
        let lastCompanyState: CompanyAnswerState | null = null;
        const shouldBufferCompanyResponse = Boolean(classifyCompanyIntent(lastUserPrompt));
        const phase1State = chatPhase1QualityEnabled
          ? createPhase1GuardrailState(Boolean(requestSessionContext))
          : null;
        let forceFinalRenderWithoutTools = false;
        let renderMode: 'model' | 'deterministic' = 'model';
        let modelHistoryChars = 0;
        let terminalAfterIteration: number | null = null;
        let continuationQualityInfo:
          | Pick<
              ChatTurnQualityInfo,
              | 'continuationDetected'
              | 'continuationIntent'
              | 'continuationSourceTool'
              | 'requestedCount'
              | 'excludedCount'
              | 'continuationExhausted'
            >
          | null = null;

        const continuationResolution =
          prePrimaryContinuationResolution
          ?? resolveResultSetContinuation(lastUserPrompt, requestSessionContext);

        if (continuationResolution) {
          if (continuationResolution.sourceContract) {
            const continuationToolCall: ToolCall = {
              id: `continuation_${deps.randomUUID()}`,
              name: continuationResolution.sourceContract,
              arguments: {
                continuationToken: continuationResolution.continuationToken ?? null,
                requestedCount: continuationResolution.requestedCount,
                sourceArgs: continuationResolution.sourceArgs,
                sourceContract: continuationResolution.sourceContract,
              },
            };
            const toolStartEvent: ToolStartEvent = {
              type: 'tool_start',
              toolCallId: continuationToolCall.id,
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
            };
            emitEvent(toolStartEvent);

            const continuationStartedAt = deps.now();
            const contractResponse = await deps.postToQueryApi<TigerContractContinuationResult>(
              '/v1/contracts/continue-result-set',
              continuationToolCall.arguments
            );
            const executionMs = deps.now() - continuationStartedAt;
            totalToolsMs += executionMs;
            executedToolNames.push(continuationToolCall.name);

            let continuationResult: { success: boolean; error?: string } & Record<string, unknown>;
            let renderedContinuationText: string | null = null;
            let syntheticToolCall: ChatToolCall | null = null;

            if (!contractResponse.ok || !contractResponse.data || !isRecord(contractResponse.data.result)) {
              continuationResult = {
                error: contractResponse.reason
                  ? sanitizeForwardFacingDataCopy(contractResponse.reason)
                  : 'Unknown system continuation error',
                success: false,
              };
              tigerPrimaryResult = {
                ...(tigerPrimaryResult ?? {
                  attempts: [],
                  cohort: 'default',
                  enabled: true,
                  matchedIntent: null,
                  mode: 'all',
                  renderMode: 'deterministic',
                  route: 'error',
                }),
                renderMode: 'deterministic',
                route: 'error',
              };
            } else {
              const nextResultSet = buildTigerContinuationResultSet({
                resolution: continuationResolution,
                response: contractResponse.data,
              });
              const continuationMatchedIntent = getContinuationMatchedIntent(
                contractResponse.data.sourceContract
              );
              tigerRequestState =
                contractResponse.data.sourceContract === 'discoverMomentum'
                  && isRecord(contractResponse.data.effectiveArgs)
                  && isRecord(contractResponse.data.result)
                  ? buildMomentumRequestStateFromHandler({
                      momentumPromptFamily: requestSessionContext?.requestState?.momentumPromptFamily ?? null,
                      request: contractResponse.data.effectiveArgs,
                      response: contractResponse.data.result,
                    })
                  : tigerRequestState;

              syntheticToolCall = buildTigerSyntheticToolCall({
                contractName: contractResponse.data.sourceContract,
                request: contractResponse.data.effectiveArgs,
                response: contractResponse.data.result as Record<string, unknown>,
                resultSet: nextResultSet.resultSet,
              });
              continuationResult = syntheticToolCall.result;

              continuationQualityInfo = {
                continuationDetected: true,
                continuationIntent: continuationResolution.intent,
                continuationSourceTool: continuationResolution.sourceContract,
                requestedCount: continuationResolution.requestedCount,
                excludedCount: continuationResolution.excludedCount,
                continuationExhausted: nextResultSet.exhausted,
              };

              const continuationAnswerBrief =
                nextResultSet.exhausted && nextResultSet.returnedIds.length === 0
                  ? null
                  : buildTigerSuccessBrief({
                      fallbackMarkdown: renderTigerPrimaryResult({
                        matchedIntent: continuationMatchedIntent,
                        momentumPromptFamily: requestSessionContext?.requestState?.momentumPromptFamily ?? null,
                        response: contractResponse.data.result,
                      }),
                      intent: continuationMatchedIntent,
                      momentumPromptFamily: requestSessionContext?.requestState?.momentumPromptFamily ?? null,
                      response: contractResponse.data.result,
                      selectionState: null,
                    });

              renderedContinuationText =
                nextResultSet.exhausted && nextResultSet.returnedIds.length === 0
                  ? 'No additional matching results remain beyond the rows already shown.'
                  : continuationAnswerBrief?.fallbackMarkdown ?? null;

              if (continuationAnswerBrief) {
                const narration = await narrateTigerAnswer({
                  brief: continuationAnswerBrief,
                  deps,
                  prompt: lastUserPrompt,
                });
                totalLlmMs += narration.durationMs;

                if (narration.content) {
                  renderedContinuationText = renderTigerNarratedAnswer({
                    brief: continuationAnswerBrief,
                    narration: narration.content,
                  });
                }
              }

              tigerPrimaryResult = {
                ...(tigerPrimaryResult ?? {
                  attempts: [],
                  cohort: 'default',
                  enabled: true,
                  matchedIntent: continuationMatchedIntent,
                  mode: 'all',
                  renderMode: 'deterministic',
                  route: 'primary_success',
                }),
                attempts: [
                  {
                    contractName: 'continueResultSet',
                    httpStatus: 200,
                    resultCount: nextResultSet.returnedIds.length,
                    status: 'success',
                    sufficientToAnswer: true,
                    timingMs: Math.round(executionMs),
                  },
                  {
                    contractName: contractResponse.data.sourceContract,
                    httpStatus: 200,
                    resultCount: nextResultSet.returnedIds.length,
                    status: 'success',
                    sufficientToAnswer: true,
                    timingMs: Math.round(executionMs),
                  },
                ],
                matchedIntent: continuationMatchedIntent,
                renderMode: continuationAnswerBrief && renderedContinuationText !== continuationAnswerBrief.fallbackMarkdown
                  ? 'hybrid_narrator'
                  : 'deterministic',
                route: 'primary_success',
              };
              tigerFollowUpSuggestions = continuationAnswerBrief?.followUpSuggestions ?? undefined;
            }
            recordExecutionTrace([
              buildTigerContractTraceEntry({
                contractName: 'continueResultSet',
                fallbackReason:
                  !contractResponse.ok || !contractResponse.data || !isRecord(contractResponse.data.result)
                    ? contractResponse.reason
                      ? sanitizeForwardFacingDataCopy(contractResponse.reason)
                      : 'Unknown system continuation error'
                    : null,
                latencyMs: Math.round(executionMs),
                stage: 'continuation',
                status:
                  !contractResponse.ok || !contractResponse.data || !isRecord(contractResponse.data.result)
                    ? 'error'
                    : 'success',
              }),
            ]);

            const continuationToolResultEvent: ToolResultEvent = {
              type: 'tool_result',
              toolCallId: continuationToolCall.id,
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
              result: continuationResult,
              timing: { executionMs: Math.round(executionMs) },
            };
            emitToolResultEvent(continuationToolResultEvent);

            if (syntheticToolCall) {
              executedToolCalls.push({
                ...syntheticToolCall,
                timing: { executionMs: Math.round(executionMs) },
              });
              allToolCalls.push({
                ...syntheticToolCall,
                timing: { executionMs: Math.round(executionMs) },
              });
            } else {
              executedToolCalls.push({
                name: continuationToolCall.name,
                arguments: continuationToolCall.arguments,
                result: continuationResult,
                timing: { executionMs: Math.round(executionMs) },
              });
              allToolCalls.push({
                name: continuationToolCall.name,
                arguments: continuationToolCall.arguments,
                result: continuationResult,
                timing: { executionMs: Math.round(executionMs) },
              });
            }
            debugStats.toolCallCount += 1;

            if (renderedContinuationText) {
              renderMode = 'deterministic';
              debugStats.textDeltaCount++;
              debugStats.totalChars += renderedContinuationText.length;
              debugStats.lastIterationHadText = true;
              const textEvent: TextDeltaEvent = { type: 'text_delta', delta: renderedContinuationText };
              emitEvent(textEvent);
            } else {
              const modelContent = formatResultForModel(continuationResult, { compact: true });
              messages = [
                ...messages,
                {
                  role: 'assistant',
                  content: '',
                  toolCalls: [continuationToolCall],
                },
                {
                  role: 'tool',
                  toolCallId: continuationToolCall.id,
                  content: modelContent,
                },
              ];
              modelHistoryChars += modelContent.length;
              forceFinalRenderWithoutTools = true;
            }
          } else {
            const continuationToolCall: ToolCall = {
              id: `continuation_${deps.randomUUID()}`,
              name: continuationResolution.sourceTool,
              arguments: continuationResolution.sourceArgs,
            };
            const toolStartEvent: ToolStartEvent = {
              type: 'tool_start',
              toolCallId: continuationToolCall.id,
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
            };
            emitEvent(toolStartEvent);

            const executed = await executeResolvedToolCall({
              deps,
              toolCall: continuationToolCall,
              lastUserPrompt,
              phase1State: null,
              emitToolResultEvent,
              emitResultEvent: false,
            });

            totalToolsMs += executed.toolExecutionMs;
            executedToolNames.push(continuationToolCall.name);
            recordExecutionTrace([
              buildToolExecutionTraceEntry({
                latencyMs: Math.round(executed.toolExecutionMs),
                result: isRecord(executed.result) ? executed.result : null,
                stage: 'continuation',
                toolArguments: continuationToolCall.arguments,
                toolName: continuationToolCall.name,
              }),
            ]);

            let continuationResult = executed.result;
            let continuationContract = executed.contract;

            if (isRecord(continuationResult)) {
              const nextResultSet = buildContinuationResultSet({
                resolution: continuationResolution,
                result: continuationResult,
                terminalContract: executed.contract,
              });

              continuationResult = nextResultSet.exhausted && continuationResult.success === true
                ? buildContinuationExhaustedResult({
                    resultSet: nextResultSet.resultSet,
                    requestedCount: continuationResolution.requestedCount,
                    terminalContract: executed.contract,
                  })
                : attachContinuationMeta(continuationResult, {
                    resultSet: nextResultSet.resultSet,
                    intent: continuationResolution.intent,
                    requestedCount: continuationResolution.requestedCount,
                    excludedCount: continuationResolution.excludedCount,
                    exhausted: nextResultSet.exhausted,
                  });

              continuationQualityInfo = {
                continuationDetected: true,
                continuationIntent: continuationResolution.intent,
                continuationSourceTool: continuationResolution.sourceTool,
                requestedCount: continuationResolution.requestedCount,
                excludedCount: continuationResolution.excludedCount,
                continuationExhausted: nextResultSet.exhausted,
              };

              const hasContinuationSuccessFlag = typeof continuationResult.success === 'boolean';
              continuationContract = executed.contract;
              if (phase1State && hasContinuationSuccessFlag) {
                continuationContract = buildToolAnswerContractSummary(
                  continuationToolCall,
                  continuationResult as { success: boolean; error?: string } & Record<string, unknown>
                );
              }
              if (phase1State && continuationContract) {
                observeExecutedToolCall(phase1State, continuationToolCall, continuationContract);
              }
              if (continuationContract?.sufficientToAnswer && terminalAfterIteration == null) {
                terminalAfterIteration = 0;
              }
            }

            const continuationToolResultEvent: ToolResultEvent = {
              type: 'tool_result',
              toolCallId: continuationToolCall.id,
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
              result: continuationResult as { success: boolean; error?: string } & Record<string, unknown>,
              timing: { executionMs: Math.round(executed.toolExecutionMs) },
            };
            emitToolResultEvent(continuationToolResultEvent);

            executedToolCalls.push({
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
              result: continuationResult as { success: boolean; error?: string } & Record<string, unknown>,
              timing: { executionMs: Math.round(executed.toolExecutionMs) },
            });
            allToolCalls.push({
              name: continuationToolCall.name,
              arguments: continuationToolCall.arguments,
              result: continuationResult as { success: boolean; error?: string } & Record<string, unknown>,
              timing: { executionMs: Math.round(executed.toolExecutionMs) },
            });
            debugStats.toolCallCount += 1;

            const renderedContinuationText = isRecord(continuationResult)
              ? renderToolResultForChat(
                  continuationToolCall,
                  continuationResult,
                  continuationContract
                )
              : null;

            if (renderedContinuationText) {
              renderMode = 'deterministic';
              debugStats.textDeltaCount++;
              debugStats.totalChars += renderedContinuationText.length;
              debugStats.lastIterationHadText = true;
              const textEvent: TextDeltaEvent = { type: 'text_delta', delta: renderedContinuationText };
              emitEvent(textEvent);
            } else {
              const modelContent = formatResultForModel(continuationResult, { compact: true });
              messages = [
                ...messages,
                {
                  role: 'assistant',
                  content: '',
                  toolCalls: [continuationToolCall],
                },
                {
                  role: 'tool',
                  toolCallId: continuationToolCall.id,
                  content: modelContent,
                },
              ];
              modelHistoryChars += modelContent.length;
              forceFinalRenderWithoutTools = true;
            }
          }
        }

        if (
          tigerPrimaryResult?.enabled === true
          && !readTigerLegacyFallbackEnabled()
          && debugStats.totalChars === 0
        ) {
          const tigerOnlyReply = buildTigerOnlyFallbackReply({
            tigerPrimary: tigerPrimaryResult,
          });

          tigerPrimaryResult = {
            ...tigerPrimaryResult,
            route: 'primary_success',
          };
          debugStats.textDeltaCount++;
          debugStats.totalChars += tigerOnlyReply.length;
          debugStats.lastIterationHadText = true;

          const textEvent: TextDeltaEvent = {
            type: 'text_delta',
            delta: tigerOnlyReply,
          };
          emitEvent(textEvent);
        }

        while (debugStats.totalChars === 0 && iterations < MAX_TOOL_ITERATIONS) {
          ensureStreamWritable();
          iterations++;
          debugStats.iterations = iterations;
          let iterationTextCount = 0;

          const llmStart = deps.now();
          const llmStream = provider.chatStream(
            messages,
            forceFinalRenderWithoutTools ? undefined : tools,
            { signal: request.signal }
          );

          let accumulatedText = '';
          const completedToolCalls: ToolCall[] = [];

          // Stream through the LLM response
          for await (const chunk of llmStream) {
            ensureStreamWritable();
            if (chunk.type === 'text' && chunk.text) {
              accumulatedText += chunk.text;
              if (!shouldBufferCompanyResponse) {
                debugStats.textDeltaCount++;
                debugStats.totalChars += chunk.text.length;
                iterationTextCount++;
                const textEvent: TextDeltaEvent = { type: 'text_delta', delta: chunk.text };
                emitEvent(textEvent);
              }
            }

            if (chunk.type === 'tool_use_start' && chunk.toolCall) {
              const toolStartEvent: ToolStartEvent = {
                type: 'tool_start',
                toolCallId: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: chunk.toolCall.arguments,
              };
              emitEvent(toolStartEvent);
            }

            if (chunk.type === 'tool_use_end' && chunk.toolCall) {
              completedToolCalls.push({
                id: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: chunk.toolCall.arguments,
              });
            }

            // Track token usage from stream
            if (chunk.type === 'usage' && chunk.usage) {
              totalInputTokens += chunk.usage.inputTokens;
              totalOutputTokens += chunk.usage.outputTokens;
            }
          }

          totalLlmMs += deps.now() - llmStart;

          if (shouldBufferCompanyResponse && completedToolCalls.length === 0 && accumulatedText.length > 0) {
            accumulatedText = sanitizeCompanyAssistantResponse(
              lastUserPrompt,
              accumulatedText,
              executedToolCalls
            );

            if (accumulatedText.length > 0) {
              debugStats.textDeltaCount++;
              debugStats.totalChars += accumulatedText.length;
              iterationTextCount++;
              const textEvent: TextDeltaEvent = { type: 'text_delta', delta: accumulatedText };
              emitEvent(textEvent);
            }
          }

          debugStats.lastIterationHadText = iterationTextCount > 0;
          debugStats.toolCallCount += completedToolCalls.length;

          // If no tool calls, we're done
          if (completedToolCalls.length === 0) {
            break;
          }

          // Execute all tool calls and collect results
          const toolResults: Array<{
            toolCall: ToolCall;
            result: QueryResult | SimilarityResult | Record<string, unknown>;
          }> = [];
          for (const toolCall of completedToolCalls) {
            const companyNormalizedToolCall = normalizeCompanyToolCall(toolCall, lastUserPrompt);
            const trendNormalizedToolCall = normalizeTrendToolCall(
              companyNormalizedToolCall,
              lastUserPrompt
            );
            const effectiveToolCall = normalizeBroadDiscoveryToolCall(
              trendNormalizedToolCall,
              lastUserPrompt,
              lastBroadDiscoveryState
            );
            const routedToolCall = await normalizeChangeIntelToolCall(
              effectiveToolCall,
              lastUserPrompt
            );
            const genericCompanyLookupSkipResult = buildGenericCompanyLookupSkipResult(
              lastUserPrompt,
              routedToolCall
            );
            const unsupportedCompanyWindowSkipResult = buildUnsupportedCompanyWindowSkipResult(
              lastUserPrompt,
              routedToolCall
            );
            const redundantCompanySkipResult = buildRedundantCompanySkipResult(
              lastCompanyState,
              routedToolCall,
              lastUserPrompt
            );
            const redundantSkipResult = buildRedundantDiscoverySkipResult(
              lastBroadDiscoveryState,
              routedToolCall,
              lastUserPrompt
            );
            const redundantNewsSkipResult = buildRedundantNewsToolSkipResult(
              allToolCalls,
              routedToolCall
            );
            const skipResult =
              genericCompanyLookupSkipResult ??
              unsupportedCompanyWindowSkipResult ??
              redundantCompanySkipResult ??
              redundantSkipResult ??
              redundantNewsSkipResult;

            if (skipResult) {
              const contract = phase1State
                ? buildToolAnswerContractSummary(routedToolCall, skipResult)
                : null;
              const phase1Result = contract
                ? attachPhase1MetadataToResult(skipResult, contract)
                : skipResult;

              if (phase1State && contract) {
                observeExecutedToolCall(phase1State, routedToolCall, contract);
              }

              const toolResultEvent: ToolResultEvent = {
                type: 'tool_result',
                toolCallId: routedToolCall.id,
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              };
              emitToolResultEvent(toolResultEvent);

              toolResults.push({ toolCall: routedToolCall, result: phase1Result });
              allToolCalls.push({
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              });
            {
              const traceEntry = buildToolExecutionTraceEntry({
                latencyMs: 0,
                readOccurred: false,
                result: phase1Result,
                status: 'skipped',
                toolArguments: routedToolCall.arguments,
                toolName: routedToolCall.name,
              });
              recordExecutionTrace([traceEntry]);
            }
              lastBroadDiscoveryState = extractBroadDiscoveryState(
                routedToolCall.name,
                routedToolCall.arguments,
                phase1Result
              ) ?? lastBroadDiscoveryState;
              lastCompanyState = extractCompanyAnswerState(
                lastUserPrompt,
                routedToolCall,
                phase1Result
              ) ?? lastCompanyState;
              continue;
            }

            const phase1SkipResult = phase1State
              ? maybeBlockPhase1ToolCall(phase1State, routedToolCall)
              : null;

            if (phase1SkipResult) {
              const contract = phase1State
                ? buildToolAnswerContractSummary(routedToolCall, phase1SkipResult)
                : null;
              const phase1Result = contract
                ? attachPhase1MetadataToResult(phase1SkipResult, contract)
                : phase1SkipResult;

              if (phase1State && contract) {
                observeExecutedToolCall(phase1State, routedToolCall, contract);
              }

              const toolResultEvent: ToolResultEvent = {
                type: 'tool_result',
                toolCallId: routedToolCall.id,
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              };
              emitToolResultEvent(toolResultEvent);

              toolResults.push({ toolCall: routedToolCall, result: phase1Result });
              allToolCalls.push({
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              });
              {
                const traceEntry = buildToolExecutionTraceEntry({
                  latencyMs: 0,
                  readOccurred: false,
                  result: phase1Result,
                  status: 'skipped',
                  toolArguments: routedToolCall.arguments,
                  toolName: routedToolCall.name,
                });
                recordExecutionTrace([traceEntry]);
              }
              lastBroadDiscoveryState = extractBroadDiscoveryState(
                routedToolCall.name,
                routedToolCall.arguments,
                phase1Result
              ) ?? lastBroadDiscoveryState;
              lastCompanyState = extractCompanyAnswerState(
                lastUserPrompt,
                routedToolCall,
                phase1Result
              ) ?? lastCompanyState;
              continue;
            }

            const toolStart = deps.now();
            const rawResult = await deps.executeTool(routedToolCall);
            const toolExecutionMs = deps.now() - toolStart;
            const executionProvenance = extractToolExecutionProvenance(rawResult);
            totalToolsMs += toolExecutionMs;
            executedToolNames.push(routedToolCall.name);
            const policyResult = await applyCompanyToolResultPolicy(
              lastUserPrompt,
              routedToolCall,
              rawResult
            );
            const contract =
              phase1State && isRecord(policyResult)
                ? buildToolAnswerContractSummary(routedToolCall, policyResult)
                : null;
            const result = contract && isRecord(policyResult)
              ? attachPhase1MetadataToResult(policyResult, contract)
              : policyResult;

            if (phase1State && contract) {
              observeExecutedToolCall(phase1State, routedToolCall, contract);
            }

            const toolResultEvent: ToolResultEvent = {
              type: 'tool_result',
              toolCallId: routedToolCall.id,
              name: routedToolCall.name,
              arguments: routedToolCall.arguments,
              result,
              timing: { executionMs: Math.round(toolExecutionMs) },
            };
            emitToolResultEvent(toolResultEvent);
            {
              const traceEntry = buildToolExecutionTraceEntry({
                latencyMs: Math.round(toolExecutionMs),
                provenanceOverride: executionProvenance ?? undefined,
                result: isRecord(result) ? result : null,
                toolArguments: routedToolCall.arguments,
                toolName: routedToolCall.name,
              });
              recordExecutionTrace([traceEntry]);
            }

            toolResults.push({ toolCall: routedToolCall, result });
            executedToolCalls.push({
              name: routedToolCall.name,
              arguments: routedToolCall.arguments,
              result,
              timing: { executionMs: Math.round(toolExecutionMs) },
            });
            allToolCalls.push({
              name: routedToolCall.name,
              arguments: routedToolCall.arguments,
              result,
              timing: { executionMs: Math.round(toolExecutionMs) },
            });
            lastBroadDiscoveryState = extractBroadDiscoveryState(
              routedToolCall.name,
              routedToolCall.arguments,
              result
            ) ?? lastBroadDiscoveryState;
            lastCompanyState = extractCompanyAnswerState(
              lastUserPrompt,
              routedToolCall,
              result
            ) ?? lastCompanyState;
          }

          const terminalContract = phase1State?.lastContract ?? null;
          if (terminalContract?.sufficientToAnswer && terminalAfterIteration == null) {
            terminalAfterIteration = iterations;
          }

          const lastToolResult = toolResults[toolResults.length - 1];
          if (
            !forceFinalRenderWithoutTools &&
            accumulatedText.trim().length === 0 &&
            lastToolResult &&
            isRecord(lastToolResult.result)
          ) {
            const renderedText = renderToolResultForChat(
              lastToolResult.toolCall,
              lastToolResult.result,
              terminalContract
            );

            if (renderedText) {
              renderMode = 'deterministic';
              debugStats.textDeltaCount++;
              debugStats.totalChars += renderedText.length;
              debugStats.lastIterationHadText = true;
              const textEvent: TextDeltaEvent = { type: 'text_delta', delta: renderedText };
              emitEvent(textEvent);
              break;
            }
          }

          // Add assistant message ONCE with ALL tool calls
          messages.push({
            role: 'assistant',
            content: accumulatedText,
            toolCalls: toolResults.map(({ toolCall }) => toolCall),
          });

          // Add each tool result to message history (pre-formatted with entity links)
          for (const { toolCall, result } of toolResults) {
            const modelContent = formatResultForModel(result, { compact: true });
            modelHistoryChars += modelContent.length;
            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: modelContent,
            });
          }

          if (
            terminalContract?.sufficientToAnswer &&
            !terminalContract.needsClarification &&
            !terminalContract.noMatch
          ) {
            forceFinalRenderWithoutTools = true;
          }

          // Reset accumulated text for next iteration
          accumulatedText = '';
        }

        // If we hit max iterations with no text response, send a fallback message
        if (debugStats.totalChars === 0 && debugStats.toolCallCount > 0) {
          const fallbackText = `I executed ${debugStats.toolCallCount} tool calls but wasn't able to generate a response. This may be due to hitting the maximum iteration limit (${MAX_TOOL_ITERATIONS}). Please try rephrasing your question or being more specific.`;
          const fallbackEvent: TextDeltaEvent = { type: 'text_delta', delta: fallbackText };
          emitEvent(fallbackEvent);
          debugStats.textDeltaCount = 1;
          debugStats.totalChars = fallbackText.length;
        }

        if (phase1State) {
          phase1Quality = {
            ...buildPhase1QualityInfo(phase1State),
            renderMode,
            terminalAfterIteration,
            modelHistoryChars,
            ...continuationQualityInfo,
          };
          if (iterations >= MAX_TOOL_ITERATIONS && debugStats.toolCallCount > 0) {
            phase1Quality = {
              ...phase1Quality,
              qualityFlags: [
                ...new Set<ChatTurnQualityInfo['qualityFlags'][number]>([
                  ...phase1Quality.qualityFlags,
                  'iteration_limit',
                ]),
              ],
            };
          }
        }

        updatedSessionContext = buildSessionContextFromTurn({
          previousContext: requestSessionContext,
          executedToolCalls: allToolCalls,
          terminalContract: phase1Quality?.terminalContract ?? null,
        });
        updatedSessionContext = applyTigerPrimarySessionState({
          baseContext: updatedSessionContext,
          requestState: tigerRequestState,
        });

        // Calculate credits if enabled
        if (creditsEnabled && reservationId) {
          creditsCharged = calculateTotalCredits(
            executedToolNames,
            totalInputTokens,
            totalOutputTokens
          );

          // Finalize credits (charge actual, refund excess)
          const breakdown = getCreditBreakdown(executedToolNames, totalInputTokens, totalOutputTokens);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.rpc as any)('finalize_credits', {
            p_reservation_id: reservationId,
            p_actual_amount: creditsCharged,
            p_description: `Chat: ${debugStats.toolCallCount} tools, ${totalInputTokens}/${totalOutputTokens} tokens`,
            p_input_tokens: totalInputTokens,
            p_output_tokens: totalOutputTokens,
            p_tool_credits: breakdown.toolCredits,
          });
        }

        try {
          tigerShadow = await deps.runTigerShadowEvaluation({
            isEvalRequest,
            prompt: lastUserPrompt,
            sessionContext: updatedSessionContext,
            toolCalls: allToolCalls,
            userId,
          });
          recordExecutionTrace(
            buildTigerAttemptTraceEntries({
              attempts: tigerShadow.attempts,
              stage: 'tiger_shadow',
            })
          );
        } catch (shadowError) {
          console.error('System shadow evaluation failed:', shadowError);
        }

        // Log the chat query to database (do this BEFORE sending message_end)
        // Wrap in try-catch to ensure logging failures don't affect the response
        if (lastUserMessageContent && !skipUsageAccounting) {
          try {
            await deps.logChatQuery({
              query_text: lastUserMessageContent.slice(0, 2000),
              tool_names: [...new Set(executedToolNames)],
              tool_count: debugStats.toolCallCount,
              iteration_count: debugStats.iterations,
              response_length: debugStats.totalChars,
              timing_llm_ms: Math.round(totalLlmMs),
              timing_tools_ms: Math.round(totalToolsMs),
              timing_total_ms: Math.round(deps.now() - requestStart),
              // New fields for credit tracking
              user_id: userId ?? undefined,
              input_tokens: totalInputTokens > 0 ? totalInputTokens : undefined,
              output_tokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
              tool_credits_used: creditsEnabled ? getCreditBreakdown(executedToolNames, 0, 0).toolCredits : undefined,
              total_credits_charged: creditsEnabled ? creditsCharged : undefined,
              chat_family: phase1Quality?.family,
              quality_flags: phase1Quality?.qualityFlags,
              session_context_summary: buildSessionLogSummary(
                updatedSessionContext,
                allToolCalls,
                phase1Quality,
                undefined,
                tigerPrimaryResult,
                tigerShadow
              ),
              guardrail_trace: phase1Quality?.guardrailTrace,
              answer_contract_summary: phase1Quality?.terminalContract ?? null,
            });
          } catch (logError) {
            // Log to console but don't fail the request
            console.error('Failed to log chat query:', logError);
          }
        }

        // Send completion event with debug info (after logging to prevent error-after-end)
        const endEvent: MessageEndEvent = {
          type: 'message_end',
          timing: {
            llmMs: Math.round(totalLlmMs),
            toolsMs: Math.round(totalToolsMs),
            totalMs: Math.round(deps.now() - requestStart),
          },
          debug: debugStats,
          quality: phase1Quality,
          sessionContext: updatedSessionContext,
          executionTrace: captureExecutionTrace ? executionTrace : undefined,
          followUpSuggestions: tigerFollowUpSuggestions,
          tigerPrimary: tigerPrimaryResult,
          tigerShadow,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          creditsCharged: creditsEnabled ? creditsCharged : undefined,
        };
        emitMessageEndEvent(endEvent);

      } catch (error) {
        const clientDisconnected = request.signal.aborted || isClientDisconnectError(error);
        if (!clientDisconnected) {
          console.error('Streaming chat error:', error);
        }
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        const failureKind = classifyStreamFailureKind(error);

        if (lastUserMessageContent && !skipUsageAccounting) {
          try {
            await deps.logChatQuery({
              query_text: lastUserMessageContent.slice(0, 2000),
              tool_names: [...new Set(executedToolNames)],
              tool_count: debugStats.toolCallCount,
              iteration_count: debugStats.iterations,
              response_length: debugStats.totalChars,
              timing_llm_ms: totalLlmMs > 0 ? Math.round(totalLlmMs) : null,
              timing_tools_ms: totalToolsMs > 0 ? Math.round(totalToolsMs) : null,
              timing_total_ms: Math.round(deps.now() - requestStart),
              user_id: userId ?? undefined,
              input_tokens: totalInputTokens > 0 ? totalInputTokens : undefined,
              output_tokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
              tool_credits_used: creditsEnabled ? getCreditBreakdown(executedToolNames, 0, 0).toolCredits : undefined,
              chat_family: phase1Quality?.family,
              quality_flags: [
                ...new Set([
                  ...(phase1Quality?.qualityFlags ?? []),
                  'runtime_failure',
                  failureKind,
                ]),
              ],
              session_context_summary: buildSessionLogSummary(
                updatedSessionContext,
                allToolCalls,
                phase1Quality,
                failureKind,
                tigerPrimaryResult,
                tigerShadow
              ),
              guardrail_trace: phase1Quality?.guardrailTrace,
              answer_contract_summary: phase1Quality?.terminalContract ?? null,
            });
          } catch (logError) {
            console.error('Failed to log errored chat query:', logError);
          }
        }

        if (!clientDisconnected) {
          const errorEvent: ErrorEvent = { type: 'error', message: errorMessage };
          emitEvent(errorEvent);
        }

        // Refund credits on server error
        if (creditsEnabled && reservationId) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.rpc as any)('refund_reservation', { p_reservation_id: reservationId });
          } catch (refundError) {
            console.error('Failed to refund credits:', refundError);
          }
        }
      } finally {
        request.signal.removeEventListener('abort', handleAbort);
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
