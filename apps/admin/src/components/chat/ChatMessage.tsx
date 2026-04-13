'use client';

import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Clock, Database, ShieldCheck, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import type {
  ChatRequestOptions,
  ChatSelectedEntity,
  ChatToolCall,
  ChatTiming,
} from '@/lib/llm/types';
import type { StreamDebugInfo } from '@/lib/llm/streaming-types';
import type { TigerPrimaryInfo, TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';
import type { ChatRenderData } from '@/lib/chat/chat-render-data';
import { StreamingContent, CopyButton, CodeBlock } from './content';
import { removeMarkdownTables } from './content/parsers';
import { EntityLinkProvider } from './content/EntityLinkContext';
import { SuggestionChips } from './SuggestionChips';
import type { QuerySuggestion } from '@/lib/chat/query-templates';
import { ChatStructuredVisuals } from './ChatStructuredVisuals';

const CHAT_TIGER_DEBUG = process.env.NEXT_PUBLIC_CHAT_TIGER_DEBUG === 'true';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  selectedEntities?: ChatSelectedEntity[];
  toolCalls?: ChatToolCall[];
  timing?: ChatTiming;
  debug?: StreamDebugInfo;
  followUpSuggestions?: QuerySuggestion[];
  renderData?: ChatRenderData;
  tigerPrimary?: TigerPrimaryInfo;
  tigerShadow?: TigerShadowInfo;
  timestamp: Date;
}

interface PendingToolCallSummary {
  name: string;
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

function formatToolName(name: string): string {
  return (
    titleCaseIntent(name) ??
    name
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function summarizeToolCalls(toolCalls: ChatToolCall[]): string | null {
  const uniqueLabels = [...new Set(toolCalls.map((toolCall) => formatToolName(toolCall.name)))];
  if (uniqueLabels.length === 0) {
    return null;
  }

  const visibleLabels = uniqueLabels.slice(0, 2);
  return uniqueLabels.length > 2
    ? `${visibleLabels.join(' · ')} +${uniqueLabels.length - 2}`
    : visibleLabels.join(' · ');
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
      label: 'Structured answer',
      detail: titleCaseIntent(message.tigerPrimary.matchedIntent) ?? undefined,
      tone: 'blue',
    };
  }

  if (message.tigerShadow?.route === 'shadow_success_legacy_answer') {
    return {
      label: 'Verification check',
      detail: titleCaseIntent(message.tigerShadow.matchedIntent) ?? undefined,
      tone: 'blue',
    };
  }

  if (message.tigerPrimary?.enabled && message.tigerPrimary.route !== 'disabled') {
    return {
      label: 'Fallback path',
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

function getTigerProvenanceLine(message: DisplayMessage): string | null {
  if (message.tigerPrimary?.route === 'primary_success') {
    const intent = titleCaseIntent(message.tigerPrimary.matchedIntent);
    return intent
      ? `${intent} came from the structured data path.`
      : 'This answer came from the structured data path.';
  }

  if (message.tigerShadow?.route === 'shadow_success_legacy_answer') {
    const intent = titleCaseIntent(message.tigerShadow.matchedIntent);
    return intent
      ? `${intent} matched the verified legacy answer.`
      : 'This turn used a verified legacy answer.';
  }

  if (message.tigerPrimary?.enabled && message.tigerPrimary.route === 'fallback_to_legacy') {
    const intent = titleCaseIntent(message.tigerPrimary.matchedIntent);
    return intent
      ? `${intent} needed the legacy fallback path.`
      : 'This turn used the legacy fallback path.';
  }

  if (message.tigerShadow?.enabled && message.tigerShadow.route === 'shadow_failed_legacy_answer') {
    return 'The verification pass did not replace the legacy answer.';
  }

  return null;
}

function summarizePendingToolCalls(pendingToolCalls: PendingToolCallSummary[]): string | null {
  if (pendingToolCalls.length === 0) {
    return null;
  }

  const names = [...new Set(pendingToolCalls.map((call) => formatToolName(call.name)))];
  const visible = names.slice(0, 2);
  return names.length > 2 ? `${visible.join(' · ')} +${names.length - 2}` : visible.join(' · ');
}

function getStreamingStatusLine(
  isStreaming: boolean,
  pendingToolCalls: PendingToolCallSummary[]
): string | null {
  if (!isStreaming) {
    return null;
  }

  const pendingSummary = summarizePendingToolCalls(pendingToolCalls);
  if (pendingSummary) {
    return `Checking ${pendingSummary} before I finish the answer.`;
  }

  return 'Working on the answer now.';
}

function Chip({
  tone = 'slate',
  children,
}: {
  tone?: 'blue' | 'green' | 'red' | 'slate';
  children: ReactNode;
}): ReactNode {
  const className =
    tone === 'blue'
      ? 'chat-response-chip chat-response-chip-primary'
      : tone === 'green'
        ? 'chat-response-chip chat-response-chip-success'
        : tone === 'red'
          ? 'chat-response-chip chat-response-chip-danger'
          : 'chat-response-chip chat-response-chip-quiet';

  return <span className={className}>{children}</span>;
}

function Dot({ tone }: { tone: 'blue' | 'green' | 'red' | 'slate' }): ReactNode {
  const className =
    tone === 'blue'
      ? 'chat-accent-dot'
      : tone === 'green'
        ? 'bg-accent-green'
        : tone === 'red'
          ? 'bg-accent-red'
          : 'bg-text-muted';

  return <span className={`h-1.5 w-1.5 rounded-full ${className}`} />;
}

function TimeChip({ ms }: { ms: number }): ReactNode {
  return (
    <Chip tone="slate">
      <Clock className="h-3 w-3" />
      {formatMs(ms)}
    </Chip>
  );
}

function ResultChip({
  success,
  children,
}: {
  success: boolean;
  children: ReactNode;
}): ReactNode {
  return success ? <Chip tone="green">{children}</Chip> : <Chip tone="red">{children}</Chip>;
}

function ToolPanel({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="space-y-2 rounded-xl border border-border-subtle/70 bg-surface-raised/70 p-3">
      {children}
    </div>
  );
}

function EntityBindingPill({ entity }: { entity: ChatSelectedEntity }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-elevated px-2.5 py-1 text-caption font-medium text-text-secondary">
      <span className="max-w-[18rem] truncate text-text-primary">{entity.displayName}</span>
      <span className="uppercase tracking-[0.14em] text-text-muted">{entity.entityKind}</span>
    </span>
  );
}

function StreamDebugPanel({
  debug,
}: {
  debug: StreamDebugInfo;
}): ReactNode {
  return (
    <details className="rounded-xl border border-border-subtle bg-surface-base/80 p-3">
      <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
        Execution trace
      </summary>
      <pre className="mt-2 max-h-48 overflow-x-auto rounded-lg bg-surface-raised p-2 text-xs">
        {JSON.stringify(debug, null, 2)}
      </pre>
    </details>
  );
}

function TrustStrip({
  badge,
  provenanceLine,
  statusLine,
  isStreaming,
}: {
  badge: ReturnType<typeof getTigerDebugBadge>;
  provenanceLine: string | null;
  statusLine: string | null;
  isStreaming: boolean;
}): ReactNode {
  if (!badge && !provenanceLine && !statusLine) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2 rounded-2xl border border-border-subtle bg-surface-base/75 p-3">
      {badge && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={badge.tone}>
            <Dot tone={badge.tone} />
            <span>{badge.label}</span>
            {badge.detail ? <span className="text-text-muted">· {badge.detail}</span> : null}
          </Chip>
        </div>
      )}

      {statusLine && (
        <div
          data-testid={isStreaming ? 'chat-pending-tools' : undefined}
          className="flex items-start gap-2 text-body-sm text-text-secondary"
        >
          <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-raised text-text-muted">
            <ShieldCheck className={`h-3.5 w-3.5 ${isStreaming ? 'animate-pulse' : ''}`} />
          </div>
          <p>{statusLine}</p>
        </div>
      )}

      {provenanceLine && (
        <p className="text-caption leading-6 text-text-muted">
          {provenanceLine}
        </p>
      )}
    </div>
  );
}

function renderToolCall(tc: ChatToolCall, idx: number): ReactNode {
  if (tc.name === 'query_database') {
    const args = tc.arguments as { reasoning?: string; sql?: string };
    const result = tc.result as {
      success: boolean;
      rowCount?: number;
      truncated?: boolean;
      error?: string;
      debug?: Record<string, unknown>;
    };

    return (
      <ToolPanel key={idx}>
        {args.reasoning && <p className="text-body-sm italic text-text-secondary">{args.reasoning}</p>}
        {args.sql && <CodeBlock code={args.sql} language="sql" />}
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.rowCount ?? 0} rows returned${result.truncated ? ' (truncated)' : ''}` : `Error: ${result.error}`}
          </ResultChip>
        </div>
        {result.debug && (
          <details>
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
              Trace details
            </summary>
            <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        )}
      </ToolPanel>
    );
  }

  if (tc.name === 'find_similar') {
    const args = tc.arguments as { reference_name?: string; entity_type?: string };
    const result = tc.result as { success: boolean; total_found?: number; error?: string; debug?: Record<string, unknown> };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">
          Finding {args.entity_type}s similar to &quot;{args.reference_name}&quot;
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.total_found ?? 0} similar results found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
        {result.debug && (
          <details>
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
              Trace details
            </summary>
            <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        )}
      </ToolPanel>
    );
  }

  if (tc.name === 'query_analytics') {
    const args = tc.arguments as { reasoning?: string; cube?: string };
    const result = tc.result as { success: boolean; rowCount?: number; cached?: boolean; error?: string; debug?: Record<string, unknown> };

    return (
      <ToolPanel key={idx}>
        {args.reasoning && <p className="text-body-sm italic text-text-secondary">{args.reasoning}</p>}
        {args.cube && <p className="text-body-sm text-text-muted">Querying: {args.cube}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.rowCount ?? 0} rows returned${result.cached ? ' (cached)' : ''}` : `Error: ${result.error}`}
          </ResultChip>
          {tc.timing && <TimeChip ms={tc.timing.executionMs} />}
        </div>
        {result.debug && (
          <details>
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
              Trace details
            </summary>
            <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        )}
      </ToolPanel>
    );
  }

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
        steps?: string[];
      };
    };

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
      const yearParts: string[] = [];
      if (args.release_year.gte) yearParts.push(`from ${args.release_year.gte}`);
      if (args.release_year.lte) yearParts.push(`to ${args.release_year.lte}`);
      filters.push(yearParts.join(' '));
    }
    const filterText = filters.length > 0 ? filters.join(', ') : 'all games';

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Searching games for &quot;{filterText}&quot;</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.total_found ?? 0} games found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
        {result.debug?.steps && result.debug.steps.length > 0 && (
          <div className="rounded-lg border border-border-subtle bg-surface-base p-2 text-xs">
            <div className="mb-1 font-medium text-text-secondary">Search trace:</div>
            {result.debug.steps.map((step, i) => (
              <div key={i} className="pl-2 text-text-muted">
                {step}
              </div>
            ))}
          </div>
        )}
        {result.debug && !result.debug.steps && (
          <details>
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
              Trace details
            </summary>
            <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        )}
      </ToolPanel>
    );
  }

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
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Looking up tags: {args.query || 'unknown'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.found ?? 0} tags found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
        {result.success && result.canonicalMatch && (
          <div className="text-xs text-text-secondary">
            Canonical {result.canonicalMatch.type}: <span className="font-medium text-text-primary">{result.canonicalMatch.name}</span>
          </div>
        )}
        {result.success && result.adjacentTags && result.adjacentTags.length > 0 && (
          <div className="text-xs text-text-secondary">Adjacent tags: {result.adjacentTags.join(', ')}</div>
        )}
        {result.debug && (
          <details>
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
              Trace details
            </summary>
            <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        )}
      </ToolPanel>
    );
  }

  if (tc.name === 'lookup_publishers') {
    const args = tc.arguments as { query?: string };
    const result = tc.result as { success: boolean; results?: Array<{ id: number; name: string }>; error?: string };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Looking up publishers: &ldquo;{args.query || 'unknown'}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.results?.length || 0} publishers found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
    );
  }

  if (tc.name === 'lookup_developers') {
    const args = tc.arguments as { query?: string };
    const result = tc.result as { success: boolean; results?: Array<{ id: number; name: string }>; error?: string };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Looking up developers: &ldquo;{args.query || 'unknown'}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.results?.length || 0} developers found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
    );
  }

  if (tc.name === 'search_by_concept') {
    const args = tc.arguments as { description?: string };
    const result = tc.result as { success: boolean; total_found?: number; error?: string };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Searching by concept: &ldquo;{args.description || 'unknown'}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.total_found ?? 0} games found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
    );
  }

  if (tc.name === 'discover_trending') {
    const args = tc.arguments as { trend_type?: string; timeframe?: string };
    const result = tc.result as { success: boolean; total_found?: number; error?: string };
    const trendLabels: Record<string, string> = {
      review_momentum: 'high momentum',
      accelerating: 'accelerating',
      breaking_out: 'breaking out',
      declining: 'declining',
    };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">
          Discovering {trendLabels[args.trend_type || ''] || args.trend_type} games ({args.timeframe || '7d'})
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.total_found ?? 0} games found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
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
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">
          Screening games by {sortLabels[args.sort_by || ''] || args.sort_by || 'ranking metric'} ({args.timeframe || '7d'})
          {args.indie_heuristic ? ', indie heuristic' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.total_found ?? 0} games found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
    );
  }

  if (tc.name === 'lookup_games') {
    const args = tc.arguments as { query?: string };
    const result = tc.result as { success: boolean; results?: Array<{ appid: number; name: string }>; error?: string };

    return (
      <ToolPanel key={idx}>
        <p className="text-body-sm italic text-text-secondary">Looking up games: &ldquo;{args.query || 'unknown'}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-2">
          <ResultChip success={result.success}>
            <span className={result.success ? 'h-1.5 w-1.5 rounded-full bg-accent-green' : 'h-1.5 w-1.5 rounded-full bg-accent-red'} />
            {result.success ? `${result.results?.length || 0} games found` : `Error: ${result.error}`}
          </ResultChip>
        </div>
      </ToolPanel>
    );
  }

  const genericResult = tc.result as Record<string, unknown>;

  return (
    <ToolPanel key={idx}>
      <p className="text-body-sm italic text-text-secondary">Executed {tc.name}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ResultChip success={genericResult.success !== false}>
          <span
            className={
              genericResult.success !== false
                ? 'h-1.5 w-1.5 rounded-full bg-accent-green'
                : 'h-1.5 w-1.5 rounded-full bg-accent-red'
            }
          />
          {genericResult.success !== false
            ? summarizeToolResult(genericResult)
            : `Error: ${typeof genericResult.error === 'string' ? genericResult.error : 'Unknown error'}`}
        </ResultChip>
        {tc.timing && <TimeChip ms={tc.timing.executionMs} />}
      </div>
      <details>
        <summary className="cursor-pointer text-caption text-text-muted hover:text-text-secondary">
          Raw output
        </summary>
        <pre className="mt-1 max-h-48 overflow-x-auto rounded-lg bg-surface-base p-2 text-xs">
          {JSON.stringify(genericResult, null, 2)}
        </pre>
      </details>
    </ToolPanel>
  );
}

interface ChatMessageProps {
  message: DisplayMessage;
  isStreaming?: boolean;
  suggestions?: QuerySuggestion[];
  onSuggestionClick?: (query: string, requestOptions?: ChatRequestOptions) => void;
  pendingToolCallNames?: string[];
}

export function ChatMessage({
  message,
  isStreaming = false,
  suggestions,
  onSuggestionClick,
  pendingToolCallNames = [],
}: ChatMessageProps) {
  const [showQueries, setShowQueries] = useState(false);
  const isUser = message.role === 'user';
  const tigerDebugBadge = getTigerDebugBadge(message);
  const provenanceLine = getTigerProvenanceLine(message);
  const streamingStatusLine = getStreamingStatusLine(
    isStreaming,
    pendingToolCallNames.map((name) => ({ name }))
  );
  const querySummary = message.toolCalls ? summarizeToolCalls(message.toolCalls) : null;
  const visibleAssistantContent =
    !isUser
    && (
      message.renderData?.kind === 'momentum_current_players'
      || message.renderData?.kind === 'youtube_game_activity'
    )
      ? removeMarkdownTables(message.content)
      : message.content;
  const renderStructuredAfterContent = !isUser && message.renderData?.kind === 'youtube_game_activity';
  const selectedEntities = isUser ? message.selectedEntities ?? [] : [];

  return (
    <div
      data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
      data-message-id={message.id}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`
          flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full
          ${isUser ? 'bg-accent-primary' : 'border border-border-muted bg-surface-elevated'}
        `}
      >
        {isUser ? <User className="h-4 w-4 text-white" /> : <Bot className="chat-accent-icon h-4 w-4" />}
      </div>

      <div className={`flex-1 max-w-[85%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <Card
          variant={isUser ? 'default' : 'elevated'}
          padding="md"
          className={`relative group overflow-hidden ${isUser ? 'chat-accent-soft-border' : ''}`}
        >
          {!isUser && (
            <div className="absolute right-3 top-3 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <CopyButton text={message.content} size="sm" />
            </div>
          )}

          {isUser ? (
            <div className="space-y-2">
              {selectedEntities.length > 0 && (
                <div
                  data-testid="chat-message-user-selected-entities"
                  className="flex flex-wrap gap-2"
                >
                  {selectedEntities.map((entity) => (
                    <EntityBindingPill key={`${entity.entityUid}-${entity.platformEntityId ?? 'na'}`} entity={entity} />
                  ))}
                </div>
              )}
              <div
                data-testid="chat-message-user-content"
                className="text-body whitespace-pre-wrap text-text-primary"
              >
                {message.content}
              </div>
            </div>
          ) : (
            <div
              data-testid="chat-message-assistant-content"
              className="space-y-4 pr-10 sm:pr-12"
            >
              {!isStreaming && (
                !renderStructuredAfterContent && (
                  <ChatStructuredVisuals
                    onSuggestionClick={onSuggestionClick}
                    renderData={message.renderData}
                  />
                )
              )}
              <EntityLinkProvider toolCalls={message.toolCalls}>
                <StreamingContent content={visibleAssistantContent} isStreaming={isStreaming} />
              </EntityLinkProvider>
              {!isStreaming && (
                renderStructuredAfterContent && (
                  <ChatStructuredVisuals
                    onSuggestionClick={onSuggestionClick}
                    renderData={message.renderData}
                  />
                )
              )}

              <TrustStrip
                badge={tigerDebugBadge}
                provenanceLine={provenanceLine}
                statusLine={streamingStatusLine}
                isStreaming={isStreaming}
              />

              {!isStreaming && suggestions && suggestions.length > 0 && onSuggestionClick && (
                <SuggestionChips
                  suggestions={suggestions}
                  onSuggestionClick={onSuggestionClick}
                  label="Ask next"
                />
              )}
            </div>
          )}

          {!isUser && ((message.toolCalls && message.toolCalls.length > 0) || message.debug) && (
            <div className="mt-4 space-y-4 border-t border-border-subtle/80 pt-4">
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="space-y-3 rounded-2xl border border-border-subtle bg-surface-base/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowQueries(!showQueries)}
                      className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-left text-body-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
                      aria-expanded={showQueries}
                    >
                      {showQueries ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Database className="h-4 w-4" />
                      <span>Source trail</span>
                    </button>
                    <Chip tone="slate">
                      {message.toolCalls.length} {message.toolCalls.length === 1 ? 'query' : 'queries'}
                    </Chip>
                    {message.timing && <TimeChip ms={message.timing.totalMs} />}
                    {querySummary && <Chip tone="slate">{querySummary}</Chip>}
                  </div>

                  {message.timing && (
                    <p className="text-caption text-text-muted">
                      LLM {formatMs(message.timing.llmMs)} · Tools {formatMs(message.timing.toolsMs)}
                    </p>
                  )}

                  {showQueries && <div className="space-y-4">{message.toolCalls.map(renderToolCall)}</div>}
                </div>
              )}

              {message.debug && <StreamDebugPanel debug={message.debug} />}
            </div>
          )}
        </Card>

        <p className={`mt-1.5 px-1 text-caption text-text-muted ${isUser ? 'text-right' : ''}`}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

export type { DisplayMessage };
