import type { ToolCall } from '@/lib/llm/types';

const DEFAULT_MOMENTUM_MIN_REVIEWS_ADDED_7D = 3;
const DEFAULT_SENTIMENT_MIN_REVIEWS_ADDED_30D = 5;
const POPULAR_TREND_MIN_REVIEWS = 1000;
const POPULAR_TREND_MIN_REVIEWS_ADDED_7D = 10;
const POPULAR_TREND_MIN_REVIEWS_ADDED_30D = 10;
const STRICT_TAG_SORTS = new Set([
  'momentum_score',
  'sentiment_delta',
  'velocity_7d',
  'velocity_acceleration',
  'reviews_added_7d',
  'reviews_added_30d',
]);

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function ensureMinNumber(value: unknown, minimum: number): number {
  return typeof value === 'number' ? Math.max(value, minimum) : minimum;
}

function mergeUniqueStrings(...groups: Array<string[] | undefined>): string[] | undefined {
  const merged = groups
    .flatMap((group) => group ?? [])
    .filter((value, index, allValues) => allValues.indexOf(value) === index);

  return merged.length > 0 ? merged : undefined;
}

function buildScreenGamesToolCall(
  toolCall: ToolCall,
  argumentsShape: Record<string, unknown>
): ToolCall {
  return {
    ...toolCall,
    name: 'screen_games',
    arguments: argumentsShape,
  };
}

function applyScreenGamesSemantics(
  toolCall: ToolCall,
  normalizedPrompt: string
): ToolCall {
  if (toolCall.name !== 'screen_games') {
    return toolCall;
  }

  const argumentsShape = isRecord(toolCall.arguments)
    ? { ...toolCall.arguments }
    : {};
  const filters = isRecord(argumentsShape.filters)
    ? { ...argumentsShape.filters }
    : {};
  const sortBy = typeof argumentsShape.sort_by === 'string'
    ? argumentsShape.sort_by
    : undefined;
  const tagFilters = getStringArray(filters.tags);
  const verifiedTags = getStringArray(filters.verified_tags_any);

  if (sortBy === 'momentum_score' && typeof filters.min_reviews_added_7d !== 'number') {
    filters.min_reviews_added_7d = DEFAULT_MOMENTUM_MIN_REVIEWS_ADDED_7D;
  }

  if (sortBy === 'sentiment_delta' && typeof filters.min_reviews_added_30d !== 'number') {
    filters.min_reviews_added_30d = DEFAULT_SENTIMENT_MIN_REVIEWS_ADDED_30D;
  }

  if (sortBy && STRICT_TAG_SORTS.has(sortBy) && tagFilters?.length) {
    filters.verified_tags_any = mergeUniqueStrings(verifiedTags, tagFilters);
  }

  if (normalizedPrompt.includes('popular') && (sortBy === 'momentum_score' || sortBy === 'sentiment_delta')) {
    filters.min_reviews = ensureMinNumber(filters.min_reviews, POPULAR_TREND_MIN_REVIEWS);

    if (sortBy === 'momentum_score') {
      filters.min_reviews_added_7d = ensureMinNumber(
        filters.min_reviews_added_7d,
        POPULAR_TREND_MIN_REVIEWS_ADDED_7D
      );
    }

    if (sortBy === 'sentiment_delta') {
      filters.min_reviews_added_30d = ensureMinNumber(
        filters.min_reviews_added_30d,
        POPULAR_TREND_MIN_REVIEWS_ADDED_30D
      );
    }
  }

  return buildScreenGamesToolCall(toolCall, {
    ...argumentsShape,
    filters,
  });
}

export function normalizeTrendToolCall(
  toolCall: ToolCall,
  userPrompt: string
): ToolCall {
  const normalized = normalizeText(userPrompt);

  if (
    normalized.includes('free to play') &&
    normalized.includes('most players')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'ccu_peak',
      timeframe: 'current',
      filters: {
        is_free: true,
        min_ccu: 1000,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized.includes('roguelite') &&
    normalized.includes('review velocity') &&
    normalized.includes('ccu')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'velocity_7d',
      timeframe: '7d',
      filters: {
        tags: ['Roguelite'],
        min_reviews: 1000,
      },
      limit: 5,
    }), normalized);
  }

  if (
    normalized.includes('horror') &&
    normalized.includes('gaining momentum')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'momentum_score',
      timeframe: '7d',
      filters: {
        tags: ['Horror'],
        min_reviews: 100,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized === 'what games are trending right now' ||
    normalized === 'games trending right now' ||
    (normalized.includes('trending right now') && !normalized.includes('reviews'))
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'momentum_score',
      timeframe: '7d',
      filters: {
        min_reviews: 1000,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized.includes('breaking out indie') &&
    normalized.includes('month')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'reviews_added_30d',
      timeframe: '30d',
      indie_heuristic: true,
      filters: {
        min_reviews: 100,
        max_reviews: 10000,
      },
      limit: 10,
    }), normalized);
  }

  if (normalized.includes('breaking out indie')) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'momentum_score',
      timeframe: '7d',
      indie_heuristic: true,
      filters: {
        min_reviews: 100,
        max_reviews: 10000,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized.includes('breaking out') &&
    normalized.includes('overwhelmingly positive')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'momentum_score',
      timeframe: '7d',
      filters: {
        min_score: 95,
        min_reviews: 100,
        max_reviews: 10000,
      },
      limit: 10,
    }), normalized);
  }

  if (normalized.includes('most active games by reviews')) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'velocity_7d',
      timeframe: '7d',
      filters: {
        min_reviews: 1000,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized.includes('improving sentiment') &&
    normalized.includes('30 days')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'sentiment_delta',
      timeframe: '30d',
      filters: {
        min_sentiment_delta: 3,
        min_reviews: 1000,
      },
      limit: 10,
    }), normalized);
  }

  if (normalized.includes('improving sentiment')) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'sentiment_delta',
      timeframe: '30d',
      filters: {
        min_sentiment_delta: 3,
        min_reviews: 1000,
      },
      limit: 10,
    }), normalized);
  }

  if (
    normalized.includes('worse reviews lately') ||
    normalized.includes('getting worse reviews lately')
  ) {
    return applyScreenGamesSemantics(buildScreenGamesToolCall(toolCall, {
      sort_by: 'sentiment_delta',
      sort_order: 'asc',
      timeframe: '30d',
      filters: {
        max_sentiment_delta: -3,
        min_reviews: 1000,
      },
      limit: 10,
    }), normalized);
  }

  return applyScreenGamesSemantics(toolCall, normalized);
}
