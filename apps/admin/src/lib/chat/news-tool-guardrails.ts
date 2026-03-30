import type { ChatToolCall, ToolCall } from '@/lib/llm/types';

const RECENT_NEWS_TOOL_NAMES = new Set([
  'get_recent_news_detail',
  'get_recent_news_digest',
  'search_recent_news_topics',
]);

const RECENT_NEWS_SURFACES = new Set([
  'recent_news_detail',
  'recent_news_digest',
  'recent_news_topic_search',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is number => Number.isInteger(item))
    .sort((left, right) => left - right);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => left.localeCompare(right));
}

function buildRecentNewsSemanticKey(toolCall: ToolCall | ChatToolCall): string | null {
  const args = isRecord(toolCall.arguments) ? toolCall.arguments : null;

  switch (toolCall.name) {
    case 'get_recent_news_detail':
      return JSON.stringify({
        tool: toolCall.name,
        appid: args && Number.isInteger(args.appid) ? args.appid : null,
        appName: args ? normalizeText(args.app_name) : null,
      });
    case 'get_recent_news_digest': {
      const appNames = args
        ? normalizeStringList(args.app_names).concat(
            normalizeText(args.app_name) ? [normalizeText(args.app_name) as string] : []
          )
        : [];
      appNames.sort((left, right) => left.localeCompare(right));
      return JSON.stringify({
        tool: toolCall.name,
        appids: args ? normalizeNumberList(args.appids).concat(Number.isInteger(args.appid) ? [args.appid as number] : []).sort((left, right) => left - right) : [],
        appNames,
      });
    }
    case 'search_recent_news_topics':
      return JSON.stringify({
        tool: toolCall.name,
        query: args ? normalizeText(args.query) : null,
        feedScope: args ? normalizeText(args.feed_scope) ?? 'community_announcements' : 'community_announcements',
        appids: args ? normalizeNumberList(args.appids) : [],
      });
    default:
      return null;
  }
}

function priorResultIsUsable(prior: ChatToolCall): boolean {
  if (!isRecord(prior.result)) {
    return false;
  }

  if (prior.result.success !== true) {
    return false;
  }

  return (
    prior.result.sufficient_to_answer === true ||
    prior.result.no_match === true ||
    RECENT_NEWS_SURFACES.has(String(prior.result.selected_change_surface ?? ''))
  );
}

export function buildRedundantNewsToolSkipResult(
  previousToolCalls: ChatToolCall[],
  toolCall: ToolCall
): { success: boolean; error?: string; [key: string]: unknown } | null {
  if (!RECENT_NEWS_TOOL_NAMES.has(toolCall.name)) {
    return null;
  }

  const currentKey = buildRecentNewsSemanticKey(toolCall);
  if (!currentKey) {
    return null;
  }

  const hasEquivalentPriorNewsResult = previousToolCalls.some((prior) => {
    if (!RECENT_NEWS_TOOL_NAMES.has(prior.name)) {
      return false;
    }

    return priorResultIsUsable(prior) && buildRecentNewsSemanticKey(prior) === currentKey;
  });

  if (!hasEquivalentPriorNewsResult) {
    return null;
  }

  return {
    success: true,
    skipped_redundant_news_query: true,
    sufficient_to_answer: true,
    sufficiency_reason:
      'A recent-news result for this same title set or topic already ran in this turn. Respond from that evidence instead of running another adjacent recent-news query.',
    debug: {
      redundantNewsQueryBlocked: true,
      redundantNewsTool: toolCall.name,
    },
  };
}
