import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import type { ToolSufficiencyMetadata } from '@/lib/llm/types';
import { postToQueryApi } from '@/lib/query-api-client';

const MAX_RESULTS = 20;
const DEFAULT_RESULTS = 10;
const SMALL_CATALOG_MAX = 10;

type SupportLevel = 'low' | 'medium' | 'high';
type TrendProfile = 'market_leaders' | 'breakout_watchlist';

const TIGER_SCREEN_GAMES_PROVENANCE: ChatExecutionProvenanceOverride = {
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
    'Momentum and screening prompts now execute only through the system discover-momentum contract.',
  recommendedTigerContracts: ['discoverMomentum'],
};

export interface ScreenGamesArgs {
  sort_by:
    | 'ccu_peak'
    | 'momentum_score'
    | 'velocity_7d'
    | 'velocity_acceleration'
    | 'reviews_added_7d'
    | 'reviews_added_30d'
    | 'sentiment_delta'
    | 'total_reviews'
    | 'review_score';
  sort_order?: 'asc' | 'desc';
  timeframe?: 'current' | '7d' | '30d';
  trend_profile?: TrendProfile;
  indie_heuristic?: boolean;
  filters?: {
    tags?: string[];
    genres?: string[];
    categories?: string[];
    verified_tags_any?: string[];
    platforms?: ('windows' | 'macos' | 'linux')[];
    steam_deck?: ('verified' | 'playable')[];
    is_free?: boolean;
    min_reviews?: number;
    max_reviews?: number;
    min_reviews_added_7d?: number;
    min_reviews_added_30d?: number;
    min_score?: number;
    max_score?: number;
    release_year?: { gte?: number; lte?: number };
    self_published?: boolean;
    publisher_size?: 'indie' | 'mid' | 'major';
    min_ccu?: number;
    min_sentiment_delta?: number;
    max_sentiment_delta?: number;
  };
  limit?: number;
  excludeAppIds?: number[];
}

export interface ScreenedGameResult {
  appid: number;
  name: string;
  isFree: boolean;
  ccuPeak: number | null;
  totalReviews: number | null;
  reviewPercentage: number | null;
  priceDollars: number | null;
  discountPercent: number | null;
  ccuGrowth7dPercent: number | null;
  ccuGrowth30dPercent: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  velocityAcceleration: number | null;
  sentimentDelta: number | null;
  momentumScore: number | null;
  reviewsAdded7d: number | null;
  reviewsAdded30d: number | null;
  metricDate: string | null;
  lastDeltaDate: string | null;
  releaseDate: string | null;
  publisherId: number | null;
  publisherName: string | null;
  publisherGameCount: number | null;
  developerId: number | null;
  developerName: string | null;
  isSelfPublished: boolean;
  hasIndieTag: boolean;
  matchedVerifiedTags: string[];
  indieSignals: string[];
  supportLevel: SupportLevel;
  supportReasons: string[];
}

export interface ScreenGamesResult extends ToolSufficiencyMetadata {
  success: boolean;
  ranking_metric: ScreenGamesArgs['sort_by'];
  ranking_label: string;
  ranking_definition: string;
  timeframe: NonNullable<ScreenGamesArgs['timeframe']>;
  timeframe_label: string;
  recommended_columns?: string[];
  response_guidance?: string;
  window_start?: string;
  window_end?: string;
  filters_applied: string[];
  indie_definition?: string;
  results?: ScreenedGameResult[];
  total_found?: number;
  error?: string;
  unavailable?: boolean;
}

interface TigerDiscoverMomentumResponse {
  filtersApplied?: string[];
  items?: Array<{
    appid: number;
    ccuGrowth30dPercent?: number | null;
    ccuGrowth7dPercent?: number | null;
    ccuPeak?: number | null;
    developerName?: string | null;
    discountPercent?: number | null;
    isFree: boolean;
    isSelfPublished?: boolean;
    momentumScore?: number | null;
    name: string;
    priceCents?: number | null;
    publisherName?: string | null;
    releaseDate?: string | null;
    reviewPercentage?: number | null;
    reviewsAdded30d?: number | null;
    reviewsAdded7d?: number | null;
    sentimentDelta?: number | null;
    supportLevel?: SupportLevel;
    supportReasons?: string[];
    totalReviews?: number | null;
    velocity30d?: number | null;
    velocity7d?: number | null;
    velocityAcceleration?: number | null;
  }>;
  rankingDefinition?: string;
  rankingLabel?: string;
  sufficientToAnswer?: boolean;
  timeframe?: 'current' | '7d' | '30d';
  timeframeLabel?: string;
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) {
    return DEFAULT_RESULTS;
  }
  return Math.max(1, Math.min(limit, MAX_RESULTS));
}

function getRankingLabel(sortBy: ScreenGamesArgs['sort_by']): string {
  switch (sortBy) {
    case 'ccu_peak':
      return 'Peak CCU';
    case 'momentum_score':
      return 'Momentum Score';
    case 'velocity_7d':
      return 'Review Velocity (7d)';
    case 'velocity_acceleration':
      return 'Review Velocity Acceleration';
    case 'reviews_added_7d':
      return 'Reviews Added (7d)';
    case 'reviews_added_30d':
      return 'Reviews Added (30d)';
    case 'sentiment_delta':
      return 'Sentiment Delta';
    case 'total_reviews':
      return 'Total Reviews';
    case 'review_score':
      return 'Review Percentage';
    default:
      return 'Ranking Metric';
  }
}

function getRankingDefinition(sortBy: ScreenGamesArgs['sort_by']): string {
  switch (sortBy) {
    case 'ccu_peak':
      return 'Peak concurrent players from the latest 24-hour metrics snapshot. Use this for current players, not owners.';
    case 'momentum_score':
      return 'Combined trajectory score using recent CCU growth and review-velocity acceleration. Higher means stronger current market momentum.';
    case 'velocity_7d':
      return 'Average new reviews per day over the last 7 days.';
    case 'velocity_acceleration':
      return 'Percentage change in review velocity comparing the last 7 days against the last 30 days.';
    case 'reviews_added_7d':
      return 'Total new reviews added over the last 7 days.';
    case 'reviews_added_30d':
      return 'Total new reviews added over the last 30 days.';
    case 'sentiment_delta':
      return 'Change in positive review percentage between the recent review window and the prior baseline.';
    case 'total_reviews':
      return 'Lifetime Steam review count.';
    case 'review_score':
      return 'Percentage of positive reviews.';
    default:
      return 'Ranking metric from the games screening surface.';
  }
}

function formatFiltersApplied(args: ScreenGamesArgs): string[] {
  const filters = args.filters ?? {};
  const applied: string[] = [];

  if (args.trend_profile) applied.push(`trend_profile: ${args.trend_profile}`);
  if (filters.tags?.length) applied.push(`tags: ${filters.tags.join(', ')}`);
  if (filters.verified_tags_any?.length) {
    applied.push(`verified_tags_any: ${filters.verified_tags_any.join(', ')}`);
  }
  if (filters.genres?.length) applied.push(`genres: ${filters.genres.join(', ')}`);
  if (filters.categories?.length) applied.push(`categories: ${filters.categories.join(', ')}`);
  if (filters.platforms?.length) applied.push(`platforms: ${filters.platforms.join(', ')}`);
  if (filters.steam_deck?.length) applied.push(`steam_deck: ${filters.steam_deck.join(', ')}`);
  if (typeof filters.is_free === 'boolean') applied.push(`is_free: ${filters.is_free}`);
  if (typeof filters.min_reviews === 'number') applied.push(`min_reviews: ${filters.min_reviews}`);
  if (typeof filters.max_reviews === 'number') applied.push(`max_reviews: ${filters.max_reviews}`);
  if (typeof filters.min_reviews_added_7d === 'number') {
    applied.push(`min_reviews_added_7d: ${filters.min_reviews_added_7d}`);
  }
  if (typeof filters.min_reviews_added_30d === 'number') {
    applied.push(`min_reviews_added_30d: ${filters.min_reviews_added_30d}`);
  }
  if (typeof filters.min_score === 'number') applied.push(`min_score: ${filters.min_score}`);
  if (typeof filters.max_score === 'number') applied.push(`max_score: ${filters.max_score}`);
  if (typeof filters.min_ccu === 'number') applied.push(`min_ccu: ${filters.min_ccu}`);
  if (typeof filters.min_sentiment_delta === 'number') {
    applied.push(`min_sentiment_delta: ${filters.min_sentiment_delta}`);
  }
  if (typeof filters.max_sentiment_delta === 'number') {
    applied.push(`max_sentiment_delta: ${filters.max_sentiment_delta}`);
  }
  if (typeof filters.self_published === 'boolean') {
    applied.push(`self_published: ${filters.self_published}`);
  }
  if (filters.publisher_size) applied.push(`publisher_size: ${filters.publisher_size}`);
  if (filters.release_year?.gte !== undefined) {
    applied.push(`release_year >= ${filters.release_year.gte}`);
  }
  if (filters.release_year?.lte !== undefined) {
    applied.push(`release_year <= ${filters.release_year.lte}`);
  }
  if (args.indie_heuristic) {
    applied.push(
      `indie heuristic: <=${SMALL_CATALOG_MAX}-game publisher catalogs, self-published preferred, Steam Indie tag support only`
    );
  }

  return applied;
}

function getIndieDefinition(): string {
  return `Indie here is a heuristic, not a legal ownership claim: prefer mostly self-published studios with small catalogs, use a small-catalog cap around ${SMALL_CATALOG_MAX} games, and treat the Steam Indie tag only as a supporting signal or tie-breaker.`;
}

function getRecommendedColumns(
  sortBy: ScreenGamesArgs['sort_by'],
  trendProfile?: TrendProfile
): string[] {
  switch (sortBy) {
    case 'momentum_score':
      return trendProfile === 'market_leaders'
        ? ['Game', 'Momentum Score', 'Reviews Added (7d)', 'CCU Peak', 'Total Reviews', 'Review %']
        : ['Game', 'Momentum Score', 'Reviews Added (7d)', 'CCU Peak', 'Review %'];
    case 'sentiment_delta':
      return ['Game', 'Sentiment Delta', 'Reviews Added (30d)', 'Review %', 'Reviews'];
    case 'velocity_acceleration':
      return ['Game', 'Review Velocity Acceleration', 'Reviews Added (7d)', 'Reviews', 'Review %'];
    case 'reviews_added_7d':
      return ['Game', 'Reviews Added (7d)', 'Review Velocity (7d)', 'Reviews', 'Review %'];
    case 'reviews_added_30d':
      return ['Game', 'Reviews Added (30d)', 'Total Reviews', 'Review %'];
    case 'velocity_7d':
      return ['Game', 'Review Velocity (7d)', 'Reviews Added (7d)', 'Reviews', 'Review %'];
    case 'ccu_peak':
      return ['Game', 'Peak CCU', 'Review %', 'Reviews', 'Price'];
    default:
      return ['Game', 'Review %', 'Reviews'];
  }
}

function getResponseGuidance(
  sortBy: ScreenGamesArgs['sort_by'],
  trendProfile?: TrendProfile
): string {
  switch (sortBy) {
    case 'momentum_score':
      return trendProfile === 'market_leaders'
        ? 'Name the ranking metric as Momentum Score, use the exact timeframe anchor, include Reviews Added (7d), CCU Peak, and Total Reviews, and explain rows as scaled market leaders rather than small breakout candidates.'
        : 'Name the ranking metric as Momentum Score, use the exact timeframe anchor, include Reviews Added (7d) and CCU Peak, and explain rows with numeric support rather than generic momentum prose.';
    case 'sentiment_delta':
      return 'Name the ranking metric as Sentiment Delta, use the exact timeframe anchor, include Reviews Added (30d), and do not paraphrase the deltas as generic improvement or decline language.';
    case 'velocity_7d':
    case 'velocity_acceleration':
    case 'reviews_added_7d':
    case 'reviews_added_30d':
      return 'Name the ranking metric exactly, use the exact timeframe anchor, include the recent review-activity columns, and describe the rows as review activity rather than vague momentum.';
    default:
      return 'Use the exact timeframe anchor and ranking metric from the tool result.';
  }
}

function buildTimeframeLabel(
  timeframe: NonNullable<ScreenGamesArgs['timeframe']>,
  responseLabel?: string
): string {
  if (responseLabel) {
    return responseLabel;
  }

  return timeframe === 'current'
    ? 'latest available metrics snapshot'
    : `${timeframe} rolling window`;
}

function buildTigerDiscoverMomentumRequest(
  args: ScreenGamesArgs,
  limit: number
): Record<string, unknown> | null {
  const filters = args.filters ?? {};
  const combinedTags = [...(filters.tags ?? []), ...(filters.verified_tags_any ?? [])].filter(
    (value, index, values) => values.indexOf(value) === index
  );
  const unsupported: string[] = [];

  if (filters.categories?.length) unsupported.push('categories');
  if (typeof filters.max_score === 'number') unsupported.push('max_score');
  if (typeof filters.min_sentiment_delta === 'number') unsupported.push('min_sentiment_delta');
  if (typeof filters.max_sentiment_delta === 'number') unsupported.push('max_sentiment_delta');
  if (typeof filters.self_published === 'boolean') unsupported.push('self_published');
  if (filters.publisher_size) unsupported.push('publisher_size');
  if (Array.isArray(args.excludeAppIds) && args.excludeAppIds.length > 0) unsupported.push('excludeAppIds');

  if (unsupported.length > 0) {
    return null;
  }

  return {
    filters: {
      ...(combinedTags.length ? { tags: combinedTags } : {}),
      ...(filters.genres?.length ? { genres: filters.genres } : {}),
      ...(filters.platforms?.length ? { platforms: filters.platforms } : {}),
      ...(filters.steam_deck?.length ? { steamDeck: filters.steam_deck } : {}),
      ...(typeof filters.is_free === 'boolean' ? { isFree: filters.is_free } : {}),
      ...(typeof filters.min_reviews === 'number' ? { minReviews: filters.min_reviews } : {}),
      ...(typeof filters.max_reviews === 'number' ? { maxReviews: filters.max_reviews } : {}),
      ...(typeof filters.min_reviews_added_7d === 'number'
        ? { minReviewsAdded7d: filters.min_reviews_added_7d }
        : {}),
      ...(typeof filters.min_reviews_added_30d === 'number'
        ? { minReviewsAdded30d: filters.min_reviews_added_30d }
        : {}),
      ...(typeof filters.min_score === 'number' ? { minReviewScore: filters.min_score } : {}),
      ...(typeof filters.min_ccu === 'number' ? { minCcu: filters.min_ccu } : {}),
      ...(filters.release_year
        ? {
            releaseYear: {
              ...(typeof filters.release_year.gte === 'number' ? { gte: filters.release_year.gte } : {}),
              ...(typeof filters.release_year.lte === 'number' ? { lte: filters.release_year.lte } : {}),
            },
          }
        : {}),
    },
    indieHeuristic: args.indie_heuristic ?? false,
    limit,
    sortBy: args.sort_by,
    sortDirection: args.sort_order ?? 'desc',
    timeframe: args.timeframe ?? '7d',
  };
}

async function tryTigerScreenGames(
  args: ScreenGamesArgs,
  limit: number
): Promise<ScreenGamesResult | null> {
  const request = buildTigerDiscoverMomentumRequest(args, limit);
  if (!request) {
    return null;
  }

  const response = await postToQueryApi<TigerDiscoverMomentumResponse>(
    '/v1/contracts/discover-momentum',
    request
  );

  if (!response.ok || !response.data) {
    return null;
  }

  const matchedVerifiedTags = [...new Set(args.filters?.verified_tags_any ?? [])];
  const results: ScreenedGameResult[] = (response.data.items ?? []).map((item) => ({
    appid: item.appid,
    ccuGrowth30dPercent: item.ccuGrowth30dPercent ?? null,
    ccuGrowth7dPercent: item.ccuGrowth7dPercent ?? null,
    ccuPeak: item.ccuPeak ?? null,
    developerId: null,
    developerName: item.developerName ?? null,
    discountPercent: item.discountPercent ?? null,
    hasIndieTag: false,
    indieSignals: item.isSelfPublished ? ['self_published'] : [],
    isFree: item.isFree,
    isSelfPublished: item.isSelfPublished ?? false,
    lastDeltaDate: null,
    matchedVerifiedTags,
    metricDate: null,
    momentumScore: item.momentumScore ?? null,
    name: item.name,
    priceDollars: typeof item.priceCents === 'number' ? Number((item.priceCents / 100).toFixed(2)) : null,
    publisherGameCount: null,
    publisherId: null,
    publisherName: item.publisherName ?? null,
    releaseDate: item.releaseDate ?? null,
    reviewPercentage: item.reviewPercentage ?? null,
    reviewsAdded30d: item.reviewsAdded30d ?? null,
    reviewsAdded7d: item.reviewsAdded7d ?? null,
    sentimentDelta: item.sentimentDelta ?? null,
    supportLevel: item.supportLevel ?? 'medium',
    supportReasons: item.supportReasons ?? [],
    totalReviews: item.totalReviews ?? null,
    velocity30d: item.velocity30d ?? null,
    velocity7d: item.velocity7d ?? null,
    velocityAcceleration: item.velocityAcceleration ?? null,
  }));

  return attachToolExecutionProvenance(
    {
      success: true,
      ranking_metric: args.sort_by,
      ranking_label: response.data.rankingLabel ?? getRankingLabel(args.sort_by),
      ranking_definition: response.data.rankingDefinition ?? getRankingDefinition(args.sort_by),
      timeframe: response.data.timeframe ?? (args.timeframe ?? '7d'),
      timeframe_label: buildTimeframeLabel(args.timeframe ?? '7d', response.data.timeframeLabel),
      filters_applied: response.data.filtersApplied ?? formatFiltersApplied(args),
      indie_definition: args.indie_heuristic ? getIndieDefinition() : undefined,
      recommended_columns: getRecommendedColumns(args.sort_by, args.trend_profile),
      response_guidance: getResponseGuidance(args.sort_by, args.trend_profile),
      results,
      total_found: results.length,
      sufficient_to_answer: response.data.sufficientToAnswer ?? results.length > 0,
      sufficiency_reason:
        results.length > 0
          ? 'System momentum results are sufficient to answer directly.'
          : 'No system momentum candidates matched the requested filters.',
    },
    TIGER_SCREEN_GAMES_PROVENANCE
  );
}

export async function screenGames(args: ScreenGamesArgs): Promise<ScreenGamesResult> {
  try {
    const tigerResult = await tryTigerScreenGames(args, clampLimit(args.limit));
    if (tigerResult) {
      return tigerResult;
    }

    return {
      success: false,
      ranking_metric: args.sort_by,
      ranking_label: getRankingLabel(args.sort_by),
      ranking_definition: getRankingDefinition(args.sort_by),
      timeframe: args.timeframe ?? '7d',
      timeframe_label: buildTimeframeLabel(args.timeframe ?? '7d'),
      filters_applied: formatFiltersApplied(args),
      recommended_columns: getRecommendedColumns(args.sort_by, args.trend_profile),
      response_guidance: getResponseGuidance(args.sort_by, args.trend_profile),
      error:
        'Discover-momentum could not serve this screen_games request. Rephrase with supported momentum filters or a narrower leaderboard prompt.',
      unavailable: true,
    };
  } catch (error) {
    return {
      success: false,
      ranking_metric: args.sort_by,
      ranking_label: getRankingLabel(args.sort_by),
      ranking_definition: getRankingDefinition(args.sort_by),
      timeframe: args.timeframe ?? '7d',
      timeframe_label: buildTimeframeLabel(args.timeframe ?? '7d'),
      recommended_columns: getRecommendedColumns(args.sort_by, args.trend_profile),
      response_guidance: getResponseGuidance(args.sort_by, args.trend_profile),
      filters_applied: formatFiltersApplied(args),
      indie_definition: args.indie_heuristic ? getIndieDefinition() : undefined,
      error: error instanceof Error ? error.message : 'Failed to screen games',
    };
  }
}
