import { NextRequest, NextResponse } from 'next/server';
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
  buildRedundantCompanySkipResult,
  extractCompanyAnswerState,
  normalizeCompanyToolCall,
  type CompanyAnswerState,
} from '@/lib/chat/company-answer-policy';
import { sanitizeCompanyAssistantResponse } from '@/lib/chat/company-response-sanitizer';
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
import type { Message, ChatRequest, ChatResponse, ChatToolCall, ChatTiming, LLMResponse, Tool } from '@/lib/llm/types';

const MAX_TOOL_ITERATIONS = 5;

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

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  const requestStart = performance.now();

  // SECURITY FIX (AUTH-06): Defense-in-depth auth check
  // Middleware handles auth, but API routes should also verify
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { response: '', error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as ChatRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { response: '', error: 'Invalid request: messages array required' },
        { status: 400 }
      );
    }

    const provider = createProvider();

    // Keep the legacy JSON route aligned with the streaming /chat route so
    // direct callers see the same structured tool surface.
    const systemPrompt = buildCubeSystemPrompt();
    const tools: Tool[] = CUBE_TOOLS;

    const messages: Message[] = [{ role: 'system', content: systemPrompt }, ...body.messages];
    const executedToolCalls: ChatToolCall[] = [];
    const lastUserPrompt = body.messages.filter((message) => message.role === 'user').pop()?.content ?? '';

    let iterations = 0;
    let response: LLMResponse | undefined;
    let totalLlmMs = 0;
    let totalToolsMs = 0;
    let lastBroadDiscoveryState: BroadDiscoveryState | null = null;
    let lastCompanyState: CompanyAnswerState | null = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Time the LLM call
      const llmStart = performance.now();
      response = await provider.chat(messages, tools);
      totalLlmMs += performance.now() - llmStart;

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      for (const toolCall of response.toolCalls) {
        const companyNormalizedToolCall = normalizeCompanyToolCall(toolCall, lastUserPrompt);
        const effectiveToolCall = normalizeBroadDiscoveryToolCall(
          companyNormalizedToolCall,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: { success: boolean; error?: string; [key: string]: any };

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

        let toolExecutionMs = 0;
        if (skipResult) {
          result = skipResult;
        } else {
          const toolStart = performance.now();

          if (effectiveToolCall.name === 'query_database') {
            const args = effectiveToolCall.arguments as { sql: string; reasoning: string };
            result = await executeQuery(args.sql);
          } else if (effectiveToolCall.name === 'query_analytics') {
            const args = effectiveToolCall.arguments as unknown as QueryAnalyticsArgs;
            result = await executeCubeQuery({
              cube: args.cube,
              dimensions: args.dimensions,
              measures: args.measures,
              filters: args.filters,
              segments: args.segments,
              order: args.order,
              limit: args.limit,
            });
          } else if (effectiveToolCall.name === 'find_similar') {
            const args = effectiveToolCall.arguments as unknown as FindSimilarArgs;
            result = await findSimilarWithTimeout(args);
          } else if (effectiveToolCall.name === 'search_by_concept') {
            const args = effectiveToolCall.arguments as unknown as SearchByConceptArgs;
            result = await searchByConceptWithTimeout(args);
          } else if (effectiveToolCall.name === 'search_games') {
            const args = effectiveToolCall.arguments as unknown as SearchGamesArgs;
            result = await searchGames(args);
          } else if (effectiveToolCall.name === 'lookup_tags') {
            const args = effectiveToolCall.arguments as unknown as LookupTagsArgs;
            result = await lookupTags(args);
          } else if (effectiveToolCall.name === 'lookup_publishers') {
            const args = effectiveToolCall.arguments as unknown as LookupPublishersArgs;
            result = await lookupPublishers(args);
          } else if (effectiveToolCall.name === 'lookup_developers') {
            const args = effectiveToolCall.arguments as unknown as LookupDevelopersArgs;
            result = await lookupDevelopers(args);
          } else if (effectiveToolCall.name === 'lookup_games') {
            const args = effectiveToolCall.arguments as unknown as LookupGamesArgs;
            result = await lookupGames(args);
          } else if (effectiveToolCall.name === 'discover_trending') {
            const args = effectiveToolCall.arguments as unknown as DiscoverTrendingArgs;
            result = await discoverTrending(args);
          } else if (effectiveToolCall.name === 'query_change_activity') {
            const args = effectiveToolCall.arguments as unknown as QueryChangeActivityArgs;
            result = await queryChangeActivity(args);
          } else if (effectiveToolCall.name === 'get_game_change_timeline') {
            const args = effectiveToolCall.arguments as unknown as GetGameChangeTimelineArgs;
            result = await getGameChangeTimeline(args);
          } else if (effectiveToolCall.name === 'get_change_activity_detail') {
            const args = effectiveToolCall.arguments as unknown as GetChangeActivityDetailArgs;
            result = await getChangeActivityDetail(args);
          } else if (effectiveToolCall.name === 'compare_change_before_after') {
            const args = effectiveToolCall.arguments as unknown as CompareChangeBeforeAfterArgs;
            result = await compareChangeBeforeAfter(args);
          } else if (effectiveToolCall.name === 'find_change_patterns') {
            const args = effectiveToolCall.arguments as unknown as FindChangePatternsArgs;
            result = await findChangePatterns(args);
          } else {
            result = { success: false, error: `Unknown tool: ${effectiveToolCall.name}` };
          }

          toolExecutionMs = performance.now() - toolStart;
          totalToolsMs += toolExecutionMs;
          result = await applyCompanyToolResultPolicy(
            lastUserPrompt,
            effectiveToolCall,
            result
          );
        }

        executedToolCalls.push({
          name: effectiveToolCall.name,
          arguments: effectiveToolCall.arguments as Record<string, unknown>,
          result,
          timing: {
            executionMs: Math.round(toolExecutionMs),
          },
        });
        lastBroadDiscoveryState = extractBroadDiscoveryState(
          effectiveToolCall.name,
          effectiveToolCall.arguments as Record<string, unknown>,
          result
        ) ?? lastBroadDiscoveryState;
        lastCompanyState = extractCompanyAnswerState(
          lastUserPrompt,
          effectiveToolCall,
          result
        ) ?? lastCompanyState;

        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: [effectiveToolCall],
        });

        messages.push({
          role: 'tool',
          toolCallId: effectiveToolCall.id,
          content: formatResultWithEntityLinks(result),
        });
      }
    }

    const timing: ChatTiming = {
      llmMs: Math.round(totalLlmMs),
      toolsMs: Math.round(totalToolsMs),
      totalMs: Math.round(performance.now() - requestStart),
    };

    const finalResponse = sanitizeCompanyAssistantResponse(
      lastUserPrompt,
      response?.content || 'I was unable to generate a response.',
      executedToolCalls
    );

    return NextResponse.json({
      response: finalResponse,
      toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
      timing,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

    if (errorMessage.includes('API key')) {
      return NextResponse.json(
        { response: '', error: 'LLM API not configured.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ response: '', error: errorMessage }, { status: 500 });
  }
}
