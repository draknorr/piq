/**
 * Trend Discovery Service
 *
 * Discovers games with trend momentum through system-backed query-api contracts.
 * Provides a simplified interface for trend-based queries.
 */

import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { postToQueryApi } from '@/lib/query-api-client';

const TIGER_DISCOVER_TRENDING_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: [
    'query_api:discoverMomentum',
    'relation:apps',
    'relation:latest_daily_metrics',
    'relation:metrics_daily_metrics',
    'relation:app_publishers',
    'relation:publishers',
    'relation:app_developers',
    'relation:developers',
  ],
  migrationDisposition: 'already_tiger',
  migrationNotes:
    'Trend-discovery prompts now execute through the system discover-momentum contract before falling back.',
  recommendedTigerContracts: ['discoverMomentum'],
};

/**
 * Arguments for discover_trending tool
 */
export interface DiscoverTrendingArgs {
  trend_type: 'review_momentum' | 'accelerating' | 'breaking_out' | 'declining';
  timeframe?: '7d' | '30d';
  filters?: {
    tags?: string[];
    genres?: string[];
    platforms?: ('windows' | 'macos' | 'linux')[];
    steam_deck?: ('verified' | 'playable')[];
    max_price_cents?: number;
    min_reviews?: number;
    max_reviews?: number;
    is_free?: boolean;
    release_year?: { gte?: number; lte?: number };
  };
  limit?: number;
  excludeAppIds?: number[];
}

/**
 * Result from discover_trending
 */
export interface DiscoverTrendingResult {
  success: boolean;
  trend_type: string;
  timeframe: string;
  ranking_label?: string;
  ranking_definition?: string;
  timeframe_label?: string;
  response_guidance?: string;
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  results?: Array<{
    appid: number;
    name: string;
    velocity7d: number | null;
    velocity30d: number | null;
    velocityTier: string | null;
    reviewsAdded7d: number | null;
    reviewsAdded30d: number | null;
    totalReviews: number | null;
    reviewPercentage: number | null;
  }>;
  total_found?: number;
  filters_applied?: string[];
  error?: string;
  unavailable?: boolean;
}

interface TigerDiscoverMomentumResponse {
  filtersApplied?: string[];
  items?: Array<{
    appid: number;
    name: string;
    reviewPercentage?: number | null;
    reviewsAdded30d?: number | null;
    reviewsAdded7d?: number | null;
    totalReviews?: number | null;
    velocity30d?: number | null;
    velocity7d?: number | null;
  }>;
  rankingDefinition?: string;
  rankingLabel?: string;
  sufficientToAnswer?: boolean;
  timeframe?: '7d' | '30d' | 'current';
  timeframeLabel?: string;
}

// Maximum results to prevent expensive queries
const MAX_RESULTS = 20;
const DEFAULT_RESULTS = 10;

function buildTigerDiscoverTrendingRequest(
  args: DiscoverTrendingArgs,
  limit: number
): Record<string, unknown> {
  const filters = args.filters ?? {};

  return {
    filters: {
      ...(filters.tags?.length ? { tags: filters.tags } : {}),
      ...(filters.genres?.length ? { genres: filters.genres } : {}),
      ...(filters.platforms?.length ? { platforms: filters.platforms } : {}),
      ...(filters.steam_deck?.length ? { steamDeck: filters.steam_deck } : {}),
      ...(typeof filters.max_price_cents === 'number' ? { maxPriceCents: filters.max_price_cents } : {}),
      ...(typeof filters.min_reviews === 'number' ? { minReviews: filters.min_reviews } : {}),
      ...(typeof filters.max_reviews === 'number' ? { maxReviews: filters.max_reviews } : {}),
      ...(typeof filters.is_free === 'boolean' ? { isFree: filters.is_free } : {}),
      ...(filters.release_year
        ? {
            releaseYear: {
              ...(typeof filters.release_year.gte === 'number' ? { gte: filters.release_year.gte } : {}),
              ...(typeof filters.release_year.lte === 'number' ? { lte: filters.release_year.lte } : {}),
            },
          }
        : {}),
    },
    limit,
    sortBy:
      args.trend_type === 'review_momentum'
        ? 'velocity_7d'
        : args.trend_type === 'accelerating'
          ? 'velocity_acceleration'
          : args.trend_type === 'breaking_out'
            ? 'reviews_added_30d'
            : 'velocity_acceleration',
    sortDirection: args.trend_type === 'declining' ? 'asc' : 'desc',
    timeframe: args.timeframe ?? '7d',
    trendType: args.trend_type,
  };
}

async function tryTigerDiscoverTrending(
  args: DiscoverTrendingArgs
): Promise<DiscoverTrendingResult | null> {
  if (Array.isArray(args.excludeAppIds) && args.excludeAppIds.length > 0) {
    return null;
  }

  const response = await postToQueryApi<TigerDiscoverMomentumResponse>(
    '/v1/contracts/discover-momentum',
    buildTigerDiscoverTrendingRequest(args, Math.min(args.limit ?? DEFAULT_RESULTS, MAX_RESULTS))
  );

  if (!response.ok || !response.data) {
    return null;
  }

  return attachToolExecutionProvenance(
    {
      success: true,
      trend_type: args.trend_type,
      timeframe: response.data.timeframe ?? (args.timeframe ?? '7d'),
      ranking_label: response.data.rankingLabel,
      ranking_definition: response.data.rankingDefinition,
      timeframe_label: response.data.timeframeLabel,
      response_guidance:
        'Use the returned titles as a ranked momentum set. Call out why each game is gaining traction or breaking out from the visible momentum evidence.',
      sufficient_to_answer: response.data.sufficientToAnswer ?? (response.data.items?.length ?? 0) > 0,
      sufficiency_reason:
        (response.data.items?.length ?? 0) > 0
          ? 'System returned a ranked momentum set for the requested trend family.'
          : 'No system momentum results matched the requested trend family and filters.',
      results: (response.data.items ?? []).map((item) => ({
        appid: item.appid,
        name: item.name,
        velocity7d: item.velocity7d ?? null,
        velocity30d: item.velocity30d ?? null,
        velocityTier: null,
        reviewsAdded7d: item.reviewsAdded7d ?? null,
        reviewsAdded30d: item.reviewsAdded30d ?? null,
        totalReviews: item.totalReviews ?? null,
        reviewPercentage: item.reviewPercentage ?? null,
      })),
      total_found: response.data.items?.length ?? 0,
      filters_applied: response.data.filtersApplied ?? [],
    },
    TIGER_DISCOVER_TRENDING_PROVENANCE
  );
}

/**
 * Discover games with trend momentum
 */
export async function discoverTrending(args: DiscoverTrendingArgs): Promise<DiscoverTrendingResult> {
  try {
    const tigerResult = await tryTigerDiscoverTrending(args);
    if (tigerResult) {
      return tigerResult;
    }

    return {
      success: false,
      trend_type: args.trend_type,
      timeframe: args.timeframe ?? '7d',
      error:
        'Discover-momentum could not serve this discover_trending request. Try a narrower momentum query or use screen_games with explicit filters.',
      unavailable: true,
    };
  } catch (error) {
    return {
      success: false,
      trend_type: args.trend_type,
      timeframe: args.timeframe ?? '7d',
      error: error instanceof Error ? error.message : 'Trend discovery failed',
    };
  }
}
