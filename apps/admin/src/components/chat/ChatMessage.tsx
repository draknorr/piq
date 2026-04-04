'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ChevronDown, ChevronRight, Database, User, Bot } from 'lucide-react';
import type { ChatToolCall, ChatTiming } from '@/lib/llm/types';
import type { StreamDebugInfo } from '@/lib/llm/streaming-types';
import type { TigerPrimaryInfo, TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';
import { Clock } from 'lucide-react';
import { StreamingContent, CopyButton, CodeBlock } from './content';
import { EntityLinkProvider } from './content/EntityLinkContext';
import { SuggestionChips } from './SuggestionChips';
import type { QuerySuggestion } from '@/lib/chat/query-templates';

const CHAT_TIGER_DEBUG = process.env.NEXT_PUBLIC_CHAT_TIGER_DEBUG === 'true';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ChatToolCall[];
  timing?: ChatTiming;
  debug?: StreamDebugInfo;
  followUpSuggestions?: QuerySuggestion[];
  tigerPrimary?: TigerPrimaryInfo;
  tigerShadow?: TigerShadowInfo;
  timestamp: Date;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarizeToolResult(result: Record<string, unknown>): string {
  if (typeof result.total_found === 'number') {
    return `${result.total_found} results`;
  }

  if (Array.isArray(result.results)) {
    return `${result.results.length} results`;
  }

  if (Array.isArray(result.events)) {
    return `${result.events.length} timeline events`;
  }

  if (result.detail && typeof result.detail === 'object') {
    return 'detail loaded';
  }

  if (Array.isArray(result.diffs)) {
    return `${result.diffs.length} diffs`;
  }

  return 'completed';
}

function titleCaseIntent(intent: string | null | undefined): string | null {
  if (!intent) {
    return null;
  }

  return intent
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getTigerDebugBadge(message: DisplayMessage): {
  detail?: string;
  label: string;
  tone: 'blue' | 'slate';
} | null {
  if (!CHAT_TIGER_DEBUG || message.role !== 'assistant') {
    return null;
  }

  if (message.tigerPrimary?.route === 'primary_success') {
    return {
      label: 'System primary',
      detail: titleCaseIntent(message.tigerPrimary.matchedIntent) ?? undefined,
      tone: 'blue',
    };
  }

  if (message.tigerShadow?.route === 'shadow_success_legacy_answer') {
    return {
      label: 'System shadow',
      detail: titleCaseIntent(message.tigerShadow.matchedIntent) ?? undefined,
      tone: 'blue',
    };
  }

  if (message.tigerPrimary?.enabled && message.tigerPrimary.route !== 'disabled') {
    return {
      label: 'Legacy fallback',
      detail:
        titleCaseIntent(message.tigerPrimary.matchedIntent) ??
        message.tigerPrimary.route.replaceAll('_', ' '),
      tone: 'slate',
    };
  }

  if (message.tigerShadow?.enabled && message.tigerShadow.route !== 'disabled') {
    return {
      label: 'Legacy path',
      detail:
        titleCaseIntent(message.tigerShadow.matchedIntent) ??
        message.tigerShadow.route.replaceAll('_', ' '),
      tone: 'slate',
    };
  }

  return null;
}

interface ChatMessageProps {
  message: DisplayMessage;
  isStreaming?: boolean;
  suggestions?: QuerySuggestion[];
  onSuggestionClick?: (query: string) => void;
}

export function ChatMessage({
  message,
  isStreaming = false,
  suggestions,
  onSuggestionClick,
}: ChatMessageProps) {
  const [showQueries, setShowQueries] = useState(false);
  const isUser = message.role === 'user';
  const tigerDebugBadge = getTigerDebugBadge(message);

  return (
    <div
      data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
      data-message-id={message.id}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div
        className={`
        flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
        ${isUser ? 'bg-accent-blue' : 'bg-surface-elevated border border-border-muted'}
      `}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-accent-blue" />
        )}
      </div>

      {/* Message content */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <Card
          variant={isUser ? 'default' : 'elevated'}
          padding="md"
          className={`relative group ${isUser ? 'bg-accent-blue/10 border-accent-blue/20' : ''}`}
        >
          {/* Copy button for assistant messages */}
          {!isUser && (
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={message.content} size="sm" />
            </div>
          )}

          {/* Message text */}
          {isUser ? (
            <div
              data-testid="chat-message-user-content"
              className="text-body text-text-primary whitespace-pre-wrap"
            >
              {message.content}
            </div>
          ) : (
            <div data-testid="chat-message-assistant-content" className="pr-8">
              <EntityLinkProvider toolCalls={message.toolCalls}>
                <StreamingContent content={message.content} isStreaming={isStreaming} />
              </EntityLinkProvider>
            </div>
          )}

          {!isUser && tigerDebugBadge && (
            <div className="mt-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-caption ${
                  tigerDebugBadge.tone === 'blue'
                    ? 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue'
                    : 'border-border-subtle bg-surface-overlay text-text-secondary'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    tigerDebugBadge.tone === 'blue' ? 'bg-accent-blue' : 'bg-text-muted'
                  }`}
                />
                <span>{tigerDebugBadge.label}</span>
                {tigerDebugBadge.detail ? <span className="text-text-muted">· {tigerDebugBadge.detail}</span> : null}
              </span>
            </div>
          )}

          {/* Follow-up suggestions (only for assistant messages when not streaming) */}
          {!isUser && !isStreaming && suggestions && suggestions.length > 0 && onSuggestionClick && (
            <SuggestionChips
              suggestions={suggestions}
              onSuggestionClick={onSuggestionClick}
            />
          )}

          {/* Query details (for assistant messages with tool calls) */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border-subtle">
              <button
                onClick={() => setShowQueries(!showQueries)}
                className="flex items-center gap-2 text-body-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                {showQueries ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Database className="w-4 h-4" />
                <span>
                  {message.toolCalls.length} tool{' '}
                  {message.toolCalls.length === 1 ? 'call' : 'calls'}
                </span>
                {message.timing && (
                  <span className="flex items-center gap-1 text-text-muted">
                    <Clock className="w-3 h-3" />
                    {formatMs(message.timing.totalMs)}
                    <span className="text-caption">
                      (LLM: {formatMs(message.timing.llmMs)} | Tools: {formatMs(message.timing.toolsMs)})
                    </span>
                  </span>
                )}
              </button>

              {showQueries && (
                <div className="mt-3 space-y-4">
                  {message.toolCalls.map((tc, idx) => {
                    // Handle database query results
                    if (tc.name === 'query_database') {
                      const args = tc.arguments as { reasoning?: string; sql?: string };
                      const result = tc.result as { success: boolean; rowCount?: number; truncated?: boolean; error?: string; debug?: Record<string, unknown> };
                      return (
                        <div key={idx} className="space-y-2">
                          {args.reasoning && (
                            <p className="text-body-sm text-text-secondary italic">
                              {args.reasoning}
                            </p>
                          )}
                          {args.sql && <CodeBlock code={args.sql} language="sql" />}
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.rowCount} rows returned
                                {result.truncated && ' (truncated)'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                          {result.debug && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                                Debug Info
                              </summary>
                              <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                                {JSON.stringify(result.debug, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }

                    // Handle similarity search results
                    if (tc.name === 'find_similar') {
                      const args = tc.arguments as { reference_name?: string; entity_type?: string };
                      const result = tc.result as { success: boolean; total_found?: number; error?: string; debug?: Record<string, unknown> };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Finding {args.entity_type}s similar to &quot;{args.reference_name}&quot;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.total_found} similar results found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                          {result.debug && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                                Debug Info
                              </summary>
                              <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                                {JSON.stringify(result.debug, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }

                    // Handle Cube.dev analytics queries
                    if (tc.name === 'query_analytics') {
                      const args = tc.arguments as { reasoning?: string; cube?: string };
                      const result = tc.result as { success: boolean; rowCount?: number; cached?: boolean; error?: string; debug?: Record<string, unknown> };
                      return (
                        <div key={idx} className="space-y-2">
                          {args.reasoning && (
                            <p className="text-body-sm text-text-secondary italic">
                              {args.reasoning}
                            </p>
                          )}
                          {args.cube && (
                            <p className="text-body-sm text-text-muted">
                              Querying: {args.cube}
                            </p>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.rowCount} rows returned
                                {result.cached && ' (cached)'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                            {tc.timing && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption bg-surface-elevated text-text-muted">
                                <Clock className="w-3 h-3" />
                                {formatMs(tc.timing.executionMs)}
                              </span>
                            )}
                          </div>
                          {result.debug && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                                Debug Info
                              </summary>
                              <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                                {JSON.stringify(result.debug, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }

                    // Handle search_games results
                    if (tc.name === 'search_games') {
                      const args = tc.arguments as {
                        tags?: string[];
                        genres?: string[];
                        categories?: string[];
                        platforms?: string[];
                        steam_deck?: string[];
                        review_percentage?: { gte?: number };
                        metacritic_score?: { gte?: number };
                        release_year?: { gte?: number; lte?: number };
                        controller_support?: string;
                        is_free?: boolean;
                      };
                      const result = tc.result as {
                        success: boolean;
                        total_found?: number;
                        error?: string;
                        debug?: {
                          input_args?: Record<string, unknown>;
                          steps?: string[];
                          tag_candidates?: number;
                          steam_deck_candidates?: number;
                          final_candidates?: number | null;
                          query_rows_returned?: number;
                          after_review_filter?: number;
                          final_count?: number;
                        };
                      };

                      // Build filter summary
                      const filters: string[] = [];
                      if (args.tags?.length) filters.push(args.tags.join(', '));
                      if (args.genres?.length) filters.push(args.genres.join(', '));
                      if (args.categories?.length) filters.push(args.categories.join(', '));
                      if (args.steam_deck?.length) filters.push(`Steam Deck ${args.steam_deck.join('/')}`);
                      if (args.platforms?.length) filters.push(args.platforms.join(', '));
                      if (args.review_percentage?.gte) filters.push(`${args.review_percentage.gte}%+ reviews`);
                      if (args.metacritic_score?.gte) filters.push(`${args.metacritic_score.gte}+ metacritic`);
                      if (args.controller_support) filters.push(`${args.controller_support} controller`);
                      if (args.is_free !== undefined) filters.push(args.is_free ? 'free' : 'paid');
                      if (args.release_year?.gte || args.release_year?.lte) {
                        const yearParts = [];
                        if (args.release_year.gte) yearParts.push(`from ${args.release_year.gte}`);
                        if (args.release_year.lte) yearParts.push(`to ${args.release_year.lte}`);
                        filters.push(yearParts.join(' '));
                      }
                      const filterText = filters.length > 0 ? filters.join(', ') : 'all games';

                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Searching games for &quot;{filterText}&quot;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.total_found ?? 0} games found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                          {/* Always show debug steps for search_games to help diagnose issues */}
                          {result.debug?.steps && result.debug.steps.length > 0 && (
                            <div className="mt-2 p-2 bg-surface-base rounded text-xs border border-border-subtle">
                              <div className="font-medium text-text-secondary mb-1">Search trace:</div>
                              {result.debug.steps.map((step, i) => (
                                <div key={i} className="text-text-muted pl-2">{step}</div>
                              ))}
                            </div>
                          )}
                          {result.debug && !result.debug.steps && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                                Debug Info
                              </summary>
                              <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                                {JSON.stringify(result.debug, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }

                    // Handle lookup_tags results
                    if (tc.name === 'lookup_tags') {
                      const args = tc.arguments as { query?: string; type?: string };
                      const result = tc.result as {
                        success: boolean;
                        found?: number;
                        canonicalMatch?: { type: string; name: string };
                        adjacentTags?: string[];
                        error?: string;
                        debug?: Record<string, unknown>;
                      };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Looking up tags: {args.query || 'unknown'}
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.found} tags found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                          {result.success && result.canonicalMatch && (
                            <div className="text-xs text-text-secondary">
                              Canonical {result.canonicalMatch.type}: <span className="font-medium text-text-primary">{result.canonicalMatch.name}</span>
                            </div>
                          )}
                          {result.success && result.adjacentTags && result.adjacentTags.length > 0 && (
                            <div className="text-xs text-text-secondary">
                              Adjacent tags: {result.adjacentTags.join(', ')}
                            </div>
                          )}
                          {result.debug && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                                Debug Info
                              </summary>
                              <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                                {JSON.stringify(result.debug, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }

                    // Handle lookup_publishers results
                    if (tc.name === 'lookup_publishers') {
                      const args = tc.arguments as { query?: string };
                      const result = tc.result as { success: boolean; results?: Array<{ id: number; name: string }>; error?: string };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Looking up publishers: &ldquo;{args.query || 'unknown'}&rdquo;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.results?.length || 0} publishers found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Handle lookup_developers results
                    if (tc.name === 'lookup_developers') {
                      const args = tc.arguments as { query?: string };
                      const result = tc.result as { success: boolean; results?: Array<{ id: number; name: string }>; error?: string };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Looking up developers: &ldquo;{args.query || 'unknown'}&rdquo;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.results?.length || 0} developers found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Handle search_by_concept results (v2.4)
                    if (tc.name === 'search_by_concept') {
                      const args = tc.arguments as { description?: string; filters?: Record<string, unknown>; limit?: number };
                      const result = tc.result as { success: boolean; total_found?: number; error?: string };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Searching by concept: &ldquo;{args.description || 'unknown'}&rdquo;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.total_found ?? 0} games found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Handle discover_trending results (v2.4)
                    if (tc.name === 'discover_trending') {
                      const args = tc.arguments as { trend_type?: string; timeframe?: string; filters?: Record<string, unknown> };
                      const result = tc.result as { success: boolean; total_found?: number; error?: string };
                      const trendLabels: Record<string, string> = {
                        review_momentum: 'high momentum',
                        accelerating: 'accelerating',
                        breaking_out: 'breaking out',
                        declining: 'declining',
                      };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Discovering {trendLabels[args.trend_type || ''] || args.trend_type} games ({args.timeframe || '7d'})
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.total_found ?? 0} games found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    if (tc.name === 'screen_games') {
                      const args = tc.arguments as { sort_by?: string; timeframe?: string; indie_heuristic?: boolean };
                      const result = tc.result as { success: boolean; total_found?: number; error?: string };
                      const sortLabels: Record<string, string> = {
                        ccu_peak: 'Peak CCU',
                        momentum_score: 'Momentum score',
                        velocity_7d: 'Review velocity (7d)',
                        velocity_acceleration: 'Velocity acceleration',
                        reviews_added_7d: 'Reviews added (7d)',
                        reviews_added_30d: 'Reviews added (30d)',
                        sentiment_delta: 'Sentiment delta',
                        total_reviews: 'Total reviews',
                        review_score: 'Review percentage',
                      };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Screening games by {sortLabels[args.sort_by || ''] || args.sort_by || 'ranking metric'} ({args.timeframe || '7d'})
                            {args.indie_heuristic ? ', indie heuristic' : ''}
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.total_found ?? 0} games found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Handle lookup_games results (v2.4)
                    if (tc.name === 'lookup_games') {
                      const args = tc.arguments as { query?: string };
                      const result = tc.result as { success: boolean; results?: Array<{ appid: number; name: string }>; error?: string };
                      return (
                        <div key={idx} className="space-y-2">
                          <p className="text-body-sm text-text-secondary italic">
                            Looking up games: &ldquo;{args.query || 'unknown'}&rdquo;
                          </p>
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                                {result.results?.length || 0} games found
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                                Error: {result.error}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const genericResult = tc.result as Record<string, unknown>;

                    // Generic fallback for newer tools
                    return (
                      <div key={idx} className="space-y-2">
                        <p className="text-body-sm text-text-secondary italic">
                          Executed {tc.name}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {genericResult.success !== false ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-green/10 text-accent-green">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                              {summarizeToolResult(genericResult)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-caption bg-accent-red/10 text-accent-red">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                              Error: {typeof genericResult.error === 'string' ? genericResult.error : 'Unknown error'}
                            </span>
                          )}
                          {tc.timing && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption bg-surface-elevated text-text-muted">
                              <Clock className="w-3 h-3" />
                              {formatMs(tc.timing.executionMs)}
                            </span>
                          )}
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                            Raw Result
                          </summary>
                          <pre className="mt-1 p-2 bg-surface-base rounded text-xs overflow-x-auto max-h-48">
                            {JSON.stringify(genericResult, null, 2)}
                          </pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Stream debug info (collapsed by default) */}
          {!isUser && message.debug && (
            <details className="mt-3 pt-3 border-t border-border-subtle">
              <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
                Stream Debug Info
              </summary>
              <pre className="mt-2 p-2 bg-surface-base rounded text-xs overflow-x-auto">
                {JSON.stringify(message.debug, null, 2)}
              </pre>
            </details>
          )}
        </Card>

        {/* Timestamp */}
        <p className={`text-caption text-text-muted mt-1.5 px-1 ${isUser ? 'text-right' : ''}`}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

export type { DisplayMessage };
