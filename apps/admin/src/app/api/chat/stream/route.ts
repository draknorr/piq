import { NextRequest } from 'next/server';
import { getServiceClient } from '@publisheriq/database';
import { createProvider } from '@/lib/llm/providers';
import { buildCubeSystemPrompt } from '@/lib/llm/cube-system-prompt';
import { CUBE_TOOLS } from '@/lib/llm/cube-tools';
import { executeQuery } from '@/lib/query-executor';
import { executeCubeQuery } from '@/lib/cube-executor';
import {
  findSimilarWithTimeout,
  searchByConceptWithTimeout,
  type FindSimilarArgs,
  type SearchByConceptArgs,
} from '@/lib/qdrant/search-service';
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
import { runTigerPrimaryEvaluation, runTigerShadowEvaluation } from '@/lib/chat/tiger-shadow';
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
import { logChatQuery } from '@/lib/chat-query-logger';
import type { ChatTurnQualityInfo, SessionChatContext } from '@/lib/chat/chat-context-types';
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
  resolveResultSetContinuation,
} from '@/lib/chat/result-set-continuation';
import {
  buildSessionContextFromTurn,
  buildSessionContextPrompt,
  summarizeSessionContextForLog,
} from '@/lib/chat/session-context';
import { renderToolResultForChat } from '@/lib/chat/chat-edge-renderer';
import { createServerClient } from '@/lib/supabase/server';
import {
  calculateTotalCredits,
  MINIMUM_CHARGE,
  DEFAULT_RESERVATION,
  getCreditBreakdown,
} from '@/lib/credits';
import type { Message, ChatRequest, Tool, QueryResult, SimilarityResult, ToolCall, ChatToolCall } from '@/lib/llm/types';
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

const CREDITS_ENABLED = process.env.CREDITS_ENABLED === 'true';
const CHAT_PHASE1_QUALITY_ENABLED = process.env.CHAT_PHASE1_QUALITY_ENABLED === 'true';
const MAX_TOOL_ITERATIONS = 5;
const CHAT_EVAL_SECRET = process.env.CHAT_EVAL_SECRET;
const CHAT_EVAL_LOCAL_BYPASS_ENABLED = process.env.CHAT_EVAL_LOCAL_BYPASS_ENABLED === 'true';
const LOCAL_BYPASS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

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
  if (!isEvalRequest || !CHAT_EVAL_LOCAL_BYPASS_ENABLED) {
    return false;
  }

  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostCandidates = [request.nextUrl.hostname, hostHeader]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);

  return hostCandidates.some((hostname) => LOCAL_BYPASS_HOSTS.has(hostname));
}

async function resolveLocalEvalBypassUserId(): Promise<string> {
  const bypassEmail =
    process.env.CHAT_EVAL_BYPASS_EMAIL?.trim().toLowerCase() ||
    process.env.BYPASS_AUTH_EMAIL?.trim().toLowerCase() ||
    '';

  if (!bypassEmail) {
    throw new Error('Missing CHAT_EVAL_BYPASS_EMAIL or BYPASS_AUTH_EMAIL for local chat eval bypass.');
  }

  const serviceSupabase = getServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, error } = await (serviceSupabase.from('user_profiles') as any)
    .select('id, email')
    .eq('email', bypassEmail)
    .maybeSingle() as { data: { id: string; email: string | null } | null; error: { message?: string } | null };

  if (error) {
    throw new Error(`Failed to resolve local chat eval bypass user: ${error.message || 'unknown error'}`);
  }

  if (!profile?.id) {
    throw new Error(`Local chat eval bypass user not found in user_profiles for ${bypassEmail}.`);
  }

  return profile.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool(toolCall: ToolCall): Promise<{ success: boolean; error?: string; [key: string]: any }> {
  if (toolCall.name === 'query_database') {
    const args = toolCall.arguments as { sql: string; reasoning: string };
    return executeQuery(args.sql);
  } else if (toolCall.name === 'query_analytics') {
    const args = toolCall.arguments as unknown as QueryAnalyticsArgs;
    return executeCubeQuery({
      cube: args.cube,
      dimensions: args.dimensions,
      measures: args.measures,
      filters: args.filters,
      segments: args.segments,
      order: args.order,
      limit: args.limit,
    });
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
    return queryChangeActivity(args);
  } else if (toolCall.name === 'get_game_change_timeline') {
    const args = toolCall.arguments as unknown as GetGameChangeTimelineArgs;
    return getGameChangeTimeline(args);
  } else if (toolCall.name === 'get_recent_news_detail') {
    const args = toolCall.arguments as unknown as GetRecentNewsDetailArgs;
    return getRecentNewsDetail(args);
  } else if (toolCall.name === 'get_recent_news_digest') {
    const args = toolCall.arguments as unknown as GetRecentNewsDigestArgs;
    return getRecentNewsDigest(args);
  } else if (toolCall.name === 'search_recent_news_topics') {
    const args = toolCall.arguments as unknown as SearchRecentNewsTopicsArgs;
    return searchRecentNewsTopics(args);
  } else if (toolCall.name === 'get_change_activity_detail') {
    const args = toolCall.arguments as unknown as GetChangeActivityDetailArgs;
    return getChangeActivityDetail(args);
  } else if (toolCall.name === 'compare_change_before_after') {
    const args = toolCall.arguments as unknown as CompareChangeBeforeAfterArgs;
    return compareChangeBeforeAfter(args);
  } else if (toolCall.name === 'find_change_patterns') {
    const args = toolCall.arguments as unknown as FindChangePatternsArgs;
    return findChangePatterns(args);
  }
  return { success: false, error: `Unknown tool: ${toolCall.name}` };
}

function formatSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classifyStreamFailureKind(error: unknown): string {
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
  const basePrompt = buildCubeSystemPrompt();

  if (!CHAT_PHASE1_QUALITY_ENABLED) {
    return basePrompt;
  }

  const contextPrompt = buildSessionContextPrompt(sessionContext);
  const phase1Instructions = [
    'PHASE 1 QUALITY CONTRACTS:',
    '- Respect phase1_contract metadata in tool results.',
    '- If phase1_contract.needs_clarification is true, ask the clarification instead of broadening.',
    '- If phase1_contract.no_match is true, explain what was checked and stay constrained unless the fallback_action explicitly allows one retry.',
    '- If response_guidance is present, use that answer shape exactly.',
  ].join('\n');

  return [basePrompt, phase1Instructions, contextPrompt].filter(Boolean).join('\n\n');
}

async function executeResolvedToolCall(params: {
  toolCall: ToolCall;
  lastUserPrompt: string;
  phase1State: ReturnType<typeof createPhase1GuardrailState> | null;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  emitResultEvent?: boolean;
}): Promise<{
  result: QueryResult | SimilarityResult | Record<string, unknown>;
  toolExecutionMs: number;
  contract: ReturnType<typeof buildToolAnswerContractSummary> | null;
}> {
  const {
    toolCall,
    lastUserPrompt,
    phase1State,
    controller,
    encoder,
    emitResultEvent = true,
  } = params;
  const toolStart = performance.now();
  const rawResult = await executeTool(toolCall);
  const toolExecutionMs = performance.now() - toolStart;
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
    controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));
  }

  return {
    result,
    toolExecutionMs,
    contract,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleChatStreamRequest(request, { requireEvalSecret: false });
}

async function handleChatStreamRequest(
  request: NextRequest,
  { requireEvalSecret }: { requireEvalSecret: boolean }
): Promise<Response> {
  const requestStart = performance.now();
  const encoder = new TextEncoder();
  const presentedEvalSecret = request.headers.get('x-chat-eval-secret');
  const isEvalRequest =
    Boolean(CHAT_EVAL_SECRET) &&
    presentedEvalSecret === CHAT_EVAL_SECRET;

  if (requireEvalSecret && !isEvalRequest) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Missing or invalid chat eval secret' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const creditsEnabled = CREDITS_ENABLED && !isEvalRequest;

  // Auth check, with an eval-only localhost bypass for local shadow testing.
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let userId = user?.id ?? null;

  if (!userId && isLocalEvalBypassEligible(request, isEvalRequest)) {
    try {
      userId = await resolveLocalEvalBypassUserId();
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

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  let reservationId: string | null = null;

  // Check credits if enabled
  if (creditsEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase.from('user_profiles') as any)
      .select('credit_balance')
      .eq('id', userId)
      .single() as { data: { credit_balance: number } | null };

    if (!profile || profile.credit_balance < MINIMUM_CHARGE) {
      return new Response(
        JSON.stringify({
          error: 'insufficient_credits',
          message: "You don't have enough credits to use chat. Please contact your administrator.",
          balance: profile?.credit_balance ?? 0,
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
          balance: profile.credit_balance,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    reservationId = reserveResult;
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Track token usage across all iterations
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let creditsCharged = 0;
      let body: ChatRequest | null = null;
      let lastUserMessageContent: string | null = null;
      let tigerPrimaryResult: MessageEndEvent['tigerPrimary'];
      let tigerShadow: TigerShadowInfo | undefined;
      const executedToolNames: string[] = [];
      const executedToolCalls: ChatToolCall[] = [];
      const allToolCalls: ChatToolCall[] = [];
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

      try {
        body = (await request.json()) as ChatRequest;

        if (!body.messages || !Array.isArray(body.messages)) {
          const errorEvent: ErrorEvent = { type: 'error', message: 'Invalid request: messages array required' };
          controller.enqueue(encoder.encode(formatSSE(errorEvent)));
          controller.close();
          return;
        }

        const sessionContext =
          CHAT_PHASE1_QUALITY_ENABLED && isRecord(body.sessionContext)
            ? (body.sessionContext as SessionChatContext)
            : null;
        const lastUserPrompt = body.messages.filter((message) => message.role === 'user').pop()?.content ?? '';
        lastUserMessageContent = lastUserPrompt || null;
        updatedSessionContext = sessionContext;

        const tigerPrimaryEvaluation = await runTigerPrimaryEvaluation({
          isEvalRequest,
          prompt: lastUserPrompt,
          sessionContext,
          userId,
        });
        const tigerPrimaryInfo = tigerPrimaryEvaluation.info;
        totalToolsMs += sumTigerAttemptTimingMs(tigerPrimaryInfo.attempts);
        tigerPrimaryResult = tigerPrimaryInfo;

        if (tigerPrimaryResult.route === 'primary_success' && tigerPrimaryEvaluation.renderedText) {
          debugStats.textDeltaCount = 1;
          debugStats.totalChars = tigerPrimaryEvaluation.renderedText.length;
          debugStats.lastIterationHadText = true;

          if (lastUserMessageContent && !isEvalRequest) {
            try {
              await logChatQuery({
                query_text: lastUserMessageContent.slice(0, 2000),
                tool_names: [],
                tool_count: 0,
                iteration_count: 0,
                response_length: debugStats.totalChars,
                timing_llm_ms: 0,
                timing_tools_ms: Math.round(totalToolsMs),
                timing_total_ms: Math.round(performance.now() - requestStart),
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
              console.error('Failed to log Tiger primary chat query:', logError);
            }
          }

          const textEvent: TextDeltaEvent = {
            type: 'text_delta',
            delta: tigerPrimaryEvaluation.renderedText,
          };
          controller.enqueue(encoder.encode(formatSSE(textEvent)));

          const endEvent: MessageEndEvent = {
            type: 'message_end',
            timing: {
              llmMs: 0,
              toolsMs: Math.round(totalToolsMs),
              totalMs: Math.round(performance.now() - requestStart),
            },
            debug: debugStats,
            quality: phase1Quality,
            sessionContext: CHAT_PHASE1_QUALITY_ENABLED ? updatedSessionContext : undefined,
            tigerPrimary: tigerPrimaryResult,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
            creditsCharged: creditsEnabled ? creditsCharged : undefined,
          };
          controller.enqueue(encoder.encode(formatSSE(endEvent)));
          return;
        }

        const provider = createProvider();

        // Check if provider supports streaming
        if (!provider.chatStream) {
          const errorEvent: ErrorEvent = { type: 'error', message: 'Provider does not support streaming' };
          controller.enqueue(encoder.encode(formatSSE(errorEvent)));
          controller.close();
          return;
        }

        // Streaming /chat is the canonical production runtime. Keep one
        // structured tool surface here so change-intel behavior does not
        // silently disappear behind legacy SQL-mode environment toggles.
        const systemPrompt = buildSystemPrompt(sessionContext);
        const tools: Tool[] = CUBE_TOOLS;

        let messages: Message[] = [{ role: 'system', content: systemPrompt }, ...body.messages];

        let iterations = 0;
        let lastBroadDiscoveryState: BroadDiscoveryState | null = null;
        let lastCompanyState: CompanyAnswerState | null = null;
        const shouldBufferCompanyResponse = Boolean(classifyCompanyIntent(lastUserPrompt));
        const phase1State = CHAT_PHASE1_QUALITY_ENABLED
          ? createPhase1GuardrailState(Boolean(sessionContext))
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

        const continuationResolution = CHAT_PHASE1_QUALITY_ENABLED
          ? resolveResultSetContinuation(lastUserPrompt, sessionContext)
          : null;

        if (continuationResolution) {
          const continuationToolCall: ToolCall = {
            id: `continuation_${crypto.randomUUID()}`,
            name: continuationResolution.sourceTool,
            arguments: continuationResolution.sourceArgs,
          };
          const toolStartEvent: ToolStartEvent = {
            type: 'tool_start',
            toolCallId: continuationToolCall.id,
            name: continuationToolCall.name,
            arguments: continuationToolCall.arguments,
          };
          controller.enqueue(encoder.encode(formatSSE(toolStartEvent)));

          const executed = await executeResolvedToolCall({
            toolCall: continuationToolCall,
            lastUserPrompt,
            phase1State: null,
            controller,
            encoder,
            emitResultEvent: false,
          });

          totalToolsMs += executed.toolExecutionMs;
          executedToolNames.push(continuationToolCall.name);

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
          controller.enqueue(encoder.encode(formatSSE(continuationToolResultEvent)));

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
            controller.enqueue(encoder.encode(formatSSE(textEvent)));
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

        while (debugStats.totalChars === 0 && iterations < MAX_TOOL_ITERATIONS) {
          iterations++;
          debugStats.iterations = iterations;
          let iterationTextCount = 0;

          const llmStart = performance.now();
          const llmStream = provider.chatStream(messages, forceFinalRenderWithoutTools ? undefined : tools);

          let accumulatedText = '';
          const completedToolCalls: ToolCall[] = [];

          // Stream through the LLM response
          for await (const chunk of llmStream) {
            if (chunk.type === 'text' && chunk.text) {
              accumulatedText += chunk.text;
              if (!shouldBufferCompanyResponse) {
                debugStats.textDeltaCount++;
                debugStats.totalChars += chunk.text.length;
                iterationTextCount++;
                const textEvent: TextDeltaEvent = { type: 'text_delta', delta: chunk.text };
                controller.enqueue(encoder.encode(formatSSE(textEvent)));
              }
            }

            if (chunk.type === 'tool_use_start' && chunk.toolCall) {
              const toolStartEvent: ToolStartEvent = {
                type: 'tool_start',
                toolCallId: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: chunk.toolCall.arguments,
              };
              controller.enqueue(encoder.encode(formatSSE(toolStartEvent)));
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

          totalLlmMs += performance.now() - llmStart;

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
              controller.enqueue(encoder.encode(formatSSE(textEvent)));
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
              controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));

              toolResults.push({ toolCall: routedToolCall, result: phase1Result });
              allToolCalls.push({
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              });
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
              controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));

              toolResults.push({ toolCall: routedToolCall, result: phase1Result });
              allToolCalls.push({
                name: routedToolCall.name,
                arguments: routedToolCall.arguments,
                result: phase1Result,
                timing: { executionMs: 0 },
              });
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

            const toolStart = performance.now();
            const rawResult = await executeTool(routedToolCall);
            const toolExecutionMs = performance.now() - toolStart;
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
            controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));

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
              controller.enqueue(encoder.encode(formatSSE(textEvent)));
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
          controller.enqueue(encoder.encode(formatSSE(fallbackEvent)));
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

          updatedSessionContext = buildSessionContextFromTurn({
            previousContext: sessionContext,
            executedToolCalls: allToolCalls,
            terminalContract: phase1Quality.terminalContract ?? null,
          });
        }

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
          tigerShadow = await runTigerShadowEvaluation({
            isEvalRequest,
            prompt: lastUserPrompt,
            sessionContext: updatedSessionContext,
            toolCalls: allToolCalls,
            userId,
          });
        } catch (shadowError) {
          console.error('Tiger shadow evaluation failed:', shadowError);
        }

        // Log the chat query to database (do this BEFORE sending message_end)
        // Wrap in try-catch to ensure logging failures don't affect the response
        if (lastUserMessageContent && !isEvalRequest) {
          try {
            await logChatQuery({
              query_text: lastUserMessageContent.slice(0, 2000),
              tool_names: [...new Set(executedToolNames)],
              tool_count: debugStats.toolCallCount,
              iteration_count: debugStats.iterations,
              response_length: debugStats.totalChars,
              timing_llm_ms: Math.round(totalLlmMs),
              timing_tools_ms: Math.round(totalToolsMs),
              timing_total_ms: Math.round(performance.now() - requestStart),
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
            totalMs: Math.round(performance.now() - requestStart),
          },
          debug: debugStats,
          quality: phase1Quality,
          sessionContext: CHAT_PHASE1_QUALITY_ENABLED ? updatedSessionContext : undefined,
          tigerPrimary: tigerPrimaryResult,
          tigerShadow,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          creditsCharged: creditsEnabled ? creditsCharged : undefined,
        };
        controller.enqueue(encoder.encode(formatSSE(endEvent)));

      } catch (error) {
        console.error('Streaming chat error:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        const failureKind = classifyStreamFailureKind(error);

        if (lastUserMessageContent && !isEvalRequest) {
          try {
            await logChatQuery({
              query_text: lastUserMessageContent.slice(0, 2000),
              tool_names: [...new Set(executedToolNames)],
              tool_count: debugStats.toolCallCount,
              iteration_count: debugStats.iterations,
              response_length: debugStats.totalChars,
              timing_llm_ms: totalLlmMs > 0 ? Math.round(totalLlmMs) : null,
              timing_tools_ms: totalToolsMs > 0 ? Math.round(totalToolsMs) : null,
              timing_total_ms: Math.round(performance.now() - requestStart),
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

        const errorEvent: ErrorEvent = { type: 'error', message: errorMessage };
        controller.enqueue(encoder.encode(formatSSE(errorEvent)));

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
        controller.close();
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
