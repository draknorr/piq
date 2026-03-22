import { NextRequest } from 'next/server';
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
import { formatResultWithEntityLinks } from '@/lib/llm/format-entity-links';
import {
  buildRedundantDiscoverySkipResult,
  extractBroadDiscoveryState,
  normalizeBroadDiscoveryToolCall,
  type BroadDiscoveryState,
} from '@/lib/chat/discovery-guardrails';
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
import {
  compareChangeBeforeAfter,
  findChangePatterns,
  getChangeActivityDetail,
  getGameChangeTimeline,
  queryChangeActivity,
  type CompareChangeBeforeAfterArgs,
  type FindChangePatternsArgs,
  type GetChangeActivityDetailArgs,
  type GetGameChangeTimelineArgs,
  type QueryChangeActivityArgs,
} from '@/lib/chat/change-intel-service';
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

const CREDITS_ENABLED = process.env.CREDITS_ENABLED === 'true';
const MAX_TOOL_ITERATIONS = 5;
const CHAT_EVAL_SECRET = process.env.CHAT_EVAL_SECRET;

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

export async function POST(request: NextRequest): Promise<Response> {
  return handleChatStreamRequest(request, { requireEvalSecret: false });
}

export async function handleChatStreamRequest(
  request: NextRequest,
  { requireEvalSecret }: { requireEvalSecret: boolean }
): Promise<Response> {
  const requestStart = performance.now();
  const encoder = new TextEncoder();
  const isEvalRequest =
    Boolean(CHAT_EVAL_SECRET) &&
    request.headers.get('x-chat-eval-secret') === CHAT_EVAL_SECRET;

  if (requireEvalSecret && !isEvalRequest) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Missing or invalid chat eval secret' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const creditsEnabled = CREDITS_ENABLED && !isEvalRequest;

  // Auth check (always required)
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userId = user.id;
  let reservationId: string | null = null;

  // Check credits if enabled
  if (creditsEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase.from('user_profiles') as any)
      .select('credit_balance')
      .eq('id', user.id)
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
      p_user_id: user.id,
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
      p_user_id: user.id,
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

      try {
        const body = (await request.json()) as ChatRequest;

        if (!body.messages || !Array.isArray(body.messages)) {
          const errorEvent: ErrorEvent = { type: 'error', message: 'Invalid request: messages array required' };
          controller.enqueue(encoder.encode(formatSSE(errorEvent)));
          controller.close();
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
        const systemPrompt = buildCubeSystemPrompt();
        const tools: Tool[] = CUBE_TOOLS;

        const messages: Message[] = [{ role: 'system', content: systemPrompt }, ...body.messages];

        let iterations = 0;
        let totalLlmMs = 0;
        let totalToolsMs = 0;
        const executedToolNames: string[] = []; // Track only executed tools for logging + credits
        const executedToolCalls: ChatToolCall[] = [];
        let lastBroadDiscoveryState: BroadDiscoveryState | null = null;
        let lastCompanyState: CompanyAnswerState | null = null;
        const lastUserPrompt = body.messages.filter((message) => message.role === 'user').pop()?.content ?? '';
        const shouldBufferCompanyResponse = Boolean(classifyCompanyIntent(lastUserPrompt));

        // Debug stats - zero additional cost, just counters
        const debugStats: StreamDebugInfo = {
          iterations: 0,
          textDeltaCount: 0,
          totalChars: 0,
          toolCallCount: 0,
          lastIterationHadText: false,
        };

        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++;
          debugStats.iterations = iterations;
          let iterationTextCount = 0;

          const llmStart = performance.now();
          const llmStream = provider.chatStream(messages, tools);

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
          const toolResults: Array<{ toolCall: ToolCall; result: QueryResult | SimilarityResult | Record<string, unknown> }> = [];
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
            const genericCompanyLookupSkipResult = buildGenericCompanyLookupSkipResult(
              lastUserPrompt,
              effectiveToolCall
            );
            const unsupportedCompanyWindowSkipResult = buildUnsupportedCompanyWindowSkipResult(
              lastUserPrompt,
              effectiveToolCall
            );
            const redundantCompanySkipResult = buildRedundantCompanySkipResult(
              lastCompanyState,
              effectiveToolCall,
              lastUserPrompt
            );
            const redundantSkipResult = buildRedundantDiscoverySkipResult(
              lastBroadDiscoveryState,
              effectiveToolCall,
              lastUserPrompt
            );
            const skipResult =
              genericCompanyLookupSkipResult ??
              unsupportedCompanyWindowSkipResult ??
              redundantCompanySkipResult ??
              redundantSkipResult;

            if (skipResult) {
              const toolResultEvent: ToolResultEvent = {
                type: 'tool_result',
                toolCallId: effectiveToolCall.id,
                name: effectiveToolCall.name,
                arguments: effectiveToolCall.arguments,
                result: skipResult,
                timing: { executionMs: 0 },
              };
              controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));

              toolResults.push({ toolCall: effectiveToolCall, result: skipResult });
              lastBroadDiscoveryState = extractBroadDiscoveryState(
                effectiveToolCall.name,
                effectiveToolCall.arguments,
                skipResult
              ) ?? lastBroadDiscoveryState;
              lastCompanyState = extractCompanyAnswerState(
                lastUserPrompt,
                effectiveToolCall,
                skipResult
              ) ?? lastCompanyState;
              continue;
            }

            const toolStart = performance.now();
            const rawResult = await executeTool(effectiveToolCall);
            const toolExecutionMs = performance.now() - toolStart;
            totalToolsMs += toolExecutionMs;
            executedToolNames.push(effectiveToolCall.name);
            const result = await applyCompanyToolResultPolicy(
              lastUserPrompt,
              effectiveToolCall,
              rawResult
            );

            const toolResultEvent: ToolResultEvent = {
              type: 'tool_result',
              toolCallId: effectiveToolCall.id,
              name: effectiveToolCall.name,
              arguments: effectiveToolCall.arguments,
              result,
              timing: { executionMs: Math.round(toolExecutionMs) },
            };
            controller.enqueue(encoder.encode(formatSSE(toolResultEvent)));

            toolResults.push({ toolCall: effectiveToolCall, result });
            executedToolCalls.push({
              name: effectiveToolCall.name,
              arguments: effectiveToolCall.arguments,
              result,
              timing: { executionMs: Math.round(toolExecutionMs) },
            });
            lastBroadDiscoveryState = extractBroadDiscoveryState(
              effectiveToolCall.name,
              effectiveToolCall.arguments,
              result
            ) ?? lastBroadDiscoveryState;
            lastCompanyState = extractCompanyAnswerState(
              lastUserPrompt,
              effectiveToolCall,
              result
            ) ?? lastCompanyState;
          }

          // Add assistant message ONCE with ALL tool calls
          messages.push({
            role: 'assistant',
            content: accumulatedText,
            toolCalls: toolResults.map(({ toolCall }) => toolCall),
          });

          // Add each tool result to message history (pre-formatted with entity links)
          for (const { toolCall, result } of toolResults) {
            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: formatResultWithEntityLinks(result),
            });
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

        // Log the chat query to database (do this BEFORE sending message_end)
        // Wrap in try-catch to ensure logging failures don't affect the response
        const lastUserMessage = body.messages.filter((m) => m.role === 'user').pop();
        if (lastUserMessage && !isEvalRequest) {
          try {
            await logChatQuery({
              query_text: lastUserMessage.content.slice(0, 2000),
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
