/**
 * Chat API Route using Cube.dev Semantic Layer
 *
 * This is an alternative to route.ts that uses Cube.dev for queries
 * instead of raw SQL. Enable by renaming to route.ts when Cube.dev is deployed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createProvider } from '@/lib/llm/providers';
import { buildCubeSystemPrompt } from '@/lib/llm/cube-system-prompt';
import { CUBE_TOOLS } from '@/lib/llm/cube-tools';
import { executeCubeQuery } from '@/lib/cube-executor';
import { findSimilarWithTimeout, type FindSimilarArgs } from '@/lib/qdrant/search-service';
import { searchGames, type SearchGamesArgs } from '@/lib/search/game-search';
import { lookupTags, type LookupTagsArgs } from '@/lib/search/tag-lookup';
import {
  lookupPublishers,
  lookupDevelopers,
  type LookupPublishersArgs,
  type LookupDevelopersArgs,
} from '@/lib/search/publisher-lookup';
import { formatResultWithEntityLinks } from '@/lib/llm/format-entity-links';
import type { Message, ChatRequest, ChatResponse, ChatToolCall, LLMResponse } from '@/lib/llm/types';

// Maximum tool call iterations to prevent infinite loops
const MAX_TOOL_ITERATIONS = 5;

interface QueryAnalyticsArgs {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: Array<{
    member: string;
    operator: string;
    values?: (string | number | boolean)[];
  }>;
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  reasoning: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  try {
    const body = (await request.json()) as ChatRequest;

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { response: '', error: 'Invalid request: messages array required' },
        { status: 400 }
      );
    }

    // Initialize LLM provider
    const provider = createProvider();

    // Build messages with Cube.dev system prompt
    const messages: Message[] = [{ role: 'system', content: buildCubeSystemPrompt() }, ...body.messages];

    // Track tool calls for response
    const executedToolCalls: ChatToolCall[] = [];

    // Tool calling loop
    let iterations = 0;
    let response: LLMResponse | undefined;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Call LLM with Cube.dev tools
      response = await provider.chat(messages, CUBE_TOOLS);

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // Process each tool call
      for (const toolCall of response.toolCalls) {
        if (toolCall.name === 'query_analytics') {
          const args = toolCall.arguments as unknown as QueryAnalyticsArgs;

          // Execute the Cube.dev query
          const queryResult = await executeCubeQuery({
            cube: args.cube,
            dimensions: args.dimensions,
            measures: args.measures,
            filters: args.filters,
            segments: args.segments,
            order: args.order,
            limit: args.limit,
          });

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: queryResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message (pre-formatted with entity links)
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: formatResultWithEntityLinks(queryResult),
          });
        } else if (toolCall.name === 'find_similar') {
          const args = toolCall.arguments as unknown as FindSimilarArgs;

          // Execute the similarity search (unchanged - uses Qdrant)
          const similarityResult = await findSimilarWithTimeout(args);

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: similarityResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message (pre-formatted with entity links)
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: formatResultWithEntityLinks(similarityResult),
          });
        } else if (toolCall.name === 'search_games') {
          const args = toolCall.arguments as unknown as SearchGamesArgs;

          // Execute the game search
          const searchResult = await searchGames(args);

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: searchResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message (pre-formatted with entity links)
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: formatResultWithEntityLinks(searchResult),
          });
        } else if (toolCall.name === 'lookup_tags') {
          const args = toolCall.arguments as unknown as LookupTagsArgs;

          // Execute the tag lookup
          const lookupResult = await lookupTags(args);

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: lookupResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(lookupResult), // lookup_tags doesn't have entity links
          });
        } else if (toolCall.name === 'lookup_publishers') {
          const args = toolCall.arguments as unknown as LookupPublishersArgs;

          // Execute the publisher lookup
          const lookupResult = await lookupPublishers(args);

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: lookupResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(lookupResult),
          });
        } else if (toolCall.name === 'lookup_developers') {
          const args = toolCall.arguments as unknown as LookupDevelopersArgs;

          // Execute the developer lookup
          const lookupResult = await lookupDevelopers(args);

          // Track the tool call
          executedToolCalls.push({
            name: toolCall.name,
            arguments: args as unknown as Record<string, unknown>,
            result: lookupResult,
          });

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });

          // Add tool result message
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(lookupResult),
          });
        } else {
          // Unknown tool - add error result
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: [toolCall],
          });
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
          });
        }
      }
    }

    // Return the final response
    return NextResponse.json({
      response: response?.content || 'I was unable to generate a response.',
      toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
    });
  } catch (error) {
    console.error('Chat API error:', error);

    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

    // Check for specific error types
    if (errorMessage.includes('API key')) {
      return NextResponse.json(
        { response: '', error: 'LLM API not configured. Please set the OPENAI_API_KEY.' },
        { status: 503 }
      );
    }

    if (errorMessage.includes('CUBE_API')) {
      return NextResponse.json(
        { response: '', error: 'Cube.dev not configured. Please set CUBE_API_URL and CUBE_API_SECRET.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ response: '', error: errorMessage }, { status: 500 });
  }
}
