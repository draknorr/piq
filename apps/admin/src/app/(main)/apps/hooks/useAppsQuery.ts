'use client';

/**
 * React Query hook for fetching apps data
 *
 * Features:
 * - Client-side caching (5 min staleTime)
 * - Deduplication of concurrent requests
 * - Background refetching
 * - Loading and error states
 */

import { useQuery } from '@tanstack/react-query';
import type { App, AppsFilterParams, AggregateStats } from '../lib/apps-types';
import { normalizeAppsPagination } from '../lib/apps-pagination';

/**
 * Build URL search params from filter params
 */
function buildSearchParams(params: AppsFilterParams): URLSearchParams {
  const searchParams = new URLSearchParams();

  // Type, sort, order
  if (params.type !== 'game') searchParams.set('type', params.type);
  if (params.sort !== 'ccu_peak') searchParams.set('sort', params.sort);
  if (params.order !== 'desc') searchParams.set('order', params.order);
  if (params.limit && params.limit !== 50) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  if (params.search) searchParams.set('search', params.search);

  // Metric filters
  if (params.minCcu !== undefined) searchParams.set('minCcu', String(params.minCcu));
  if (params.maxCcu !== undefined) searchParams.set('maxCcu', String(params.maxCcu));
  if (params.minOwners !== undefined) searchParams.set('minOwners', String(params.minOwners));
  if (params.maxOwners !== undefined) searchParams.set('maxOwners', String(params.maxOwners));
  if (params.minReviews !== undefined) searchParams.set('minReviews', String(params.minReviews));
  if (params.maxReviews !== undefined) searchParams.set('maxReviews', String(params.maxReviews));
  if (params.minScore !== undefined) searchParams.set('minScore', String(params.minScore));
  if (params.maxScore !== undefined) searchParams.set('maxScore', String(params.maxScore));
  if (params.minPrice !== undefined) searchParams.set('minPrice', String(params.minPrice));
  if (params.maxPrice !== undefined) searchParams.set('maxPrice', String(params.maxPrice));
  if (params.minPlaytime !== undefined) searchParams.set('minPlaytime', String(params.minPlaytime));
  if (params.maxPlaytime !== undefined) searchParams.set('maxPlaytime', String(params.maxPlaytime));

  // Growth filters
  if (params.minGrowth7d !== undefined) searchParams.set('minGrowth7d', String(params.minGrowth7d));
  if (params.maxGrowth7d !== undefined) searchParams.set('maxGrowth7d', String(params.maxGrowth7d));
  if (params.minGrowth30d !== undefined) searchParams.set('minGrowth30d', String(params.minGrowth30d));
  if (params.maxGrowth30d !== undefined) searchParams.set('maxGrowth30d', String(params.maxGrowth30d));
  if (params.minMomentum !== undefined) searchParams.set('minMomentum', String(params.minMomentum));
  if (params.maxMomentum !== undefined) searchParams.set('maxMomentum', String(params.maxMomentum));

  // Sentiment filters
  if (params.minSentimentDelta !== undefined) searchParams.set('minSentimentDelta', String(params.minSentimentDelta));
  if (params.maxSentimentDelta !== undefined) searchParams.set('maxSentimentDelta', String(params.maxSentimentDelta));
  if (params.velocityTier) searchParams.set('velocityTier', params.velocityTier);

  // Engagement filters
  if (params.minActivePct !== undefined) searchParams.set('minActivePct', String(params.minActivePct));
  if (params.minReviewRate !== undefined) searchParams.set('minReviewRate', String(params.minReviewRate));
  if (params.minValueScore !== undefined) searchParams.set('minValueScore', String(params.minValueScore));

  // Content filters
  if (params.genres?.length) searchParams.set('genres', params.genres.join(','));
  if (params.genreMode === 'all') searchParams.set('genreMode', 'all');
  if (params.tags?.length) searchParams.set('tags', params.tags.join(','));
  if (params.tagMode === 'all') searchParams.set('tagMode', 'all');
  if (params.categories?.length) searchParams.set('categories', params.categories.join(','));
  if (params.hasWorkshop !== undefined) searchParams.set('hasWorkshop', String(params.hasWorkshop));

  // Platform filters
  if (params.platforms?.length) searchParams.set('platforms', params.platforms.join(','));
  if (params.platformMode === 'all') searchParams.set('platformMode', 'all');
  if (params.steamDeck) searchParams.set('steamDeck', params.steamDeck);
  if (params.controller) searchParams.set('controller', params.controller);

  // Release filters
  if (params.minAge !== undefined) searchParams.set('minAge', String(params.minAge));
  if (params.maxAge !== undefined) searchParams.set('maxAge', String(params.maxAge));
  if (params.releaseYear !== undefined) searchParams.set('releaseYear', String(params.releaseYear));
  if (params.earlyAccess !== undefined) searchParams.set('earlyAccess', String(params.earlyAccess));
  if (params.minHype !== undefined) searchParams.set('minHype', String(params.minHype));
  if (params.maxHype !== undefined) searchParams.set('maxHype', String(params.maxHype));

  // Relationship filters
  if (params.publisherSearch) searchParams.set('publisherSearch', params.publisherSearch);
  if (params.developerSearch) searchParams.set('developerSearch', params.developerSearch);
  if (params.selfPublished !== undefined) searchParams.set('selfPublished', String(params.selfPublished));
  if (params.minVsPublisher !== undefined) searchParams.set('minVsPublisher', String(params.minVsPublisher));
  if (params.publisherSize) searchParams.set('publisherSize', params.publisherSize);

  // Activity filters
  if (params.ccuTier !== undefined) searchParams.set('ccuTier', String(params.ccuTier));

  // Boolean filters
  if (params.isFree !== undefined) searchParams.set('isFree', String(params.isFree));

  return searchParams;
}

/**
 * Response shape from /api/apps
 */
interface AppsApiResponse {
  data: App[];
  stats: AggregateStats;
}

/**
 * Fetch apps from the API with timeout protection
 */
async function fetchApps(params: AppsFilterParams): Promise<AppsApiResponse> {
  const searchParams = buildSearchParams(params);
  const url = `/api/apps?${searchParams.toString()}`;

  // Add 15-second timeout to prevent queries from hanging indefinitely
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const json = await response.json();
    return {
      data: json.data as App[],
      stats: json.stats as AggregateStats,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Query timed out. Try reducing the number of filters.');
    }
    throw error;
  }
}

interface UseAppsQueryOptions {
  /** Whether the query should run. Use to defer until auth is ready. */
  enabled?: boolean;
}

/**
 * Hook for fetching apps with React Query
 *
 * @param params - Filter parameters for the query
 * @param options - Query options (e.g., enabled to defer until auth ready)
 * @returns Object with apps, stats, isLoading, and isFetching states
 */
export function useAppsQuery(params: AppsFilterParams, options: UseAppsQueryOptions = {}) {
  const { enabled = true } = options;

  const query = useQuery({
    // Unique key for this query, includes all filter params
    queryKey: ['apps', params],
    // Fetch function
    queryFn: () => fetchApps(params),
    // Cache for 5 minutes
    staleTime: 5 * 60 * 1000,
    // Keep in cache for 30 minutes
    gcTime: 30 * 60 * 1000,
    // Defer query until enabled (e.g., auth is ready)
    enabled,
    // Note: placeholderData was removed to ensure loading state shows during slow queries
    // (prevents stale data from appearing when 3+ tags cause query delays)
  });

  return {
    apps: query.data?.data ?? null,
    stats: query.data?.stats ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

/**
 * Build filter params from URL search params
 * Used by client components to derive params from the URL
 */
export function buildFilterParamsFromUrl(searchParams: URLSearchParams): AppsFilterParams {
  const parseNumber = (val: string | null): number | undefined => {
    if (!val) return undefined;
    const n = parseFloat(val);
    return isNaN(n) ? undefined : n;
  };

  const parseBoolean = (val: string | null): boolean | undefined => {
    if (!val) return undefined;
    return val === 'true';
  };

  const parseNumberArray = (val: string | null): number[] | undefined => {
    if (!val) return undefined;
    return val
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  };

  const parseStringArray = (val: string | null): string[] | undefined => {
    if (!val) return undefined;
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const pagination = normalizeAppsPagination(
    parseNumber(searchParams.get('limit')),
    parseNumber(searchParams.get('offset'))
  );

  return {
    type: (searchParams.get('type') as AppsFilterParams['type']) || 'game',
    sort: (searchParams.get('sort') as AppsFilterParams['sort']) || 'ccu_peak',
    order: (searchParams.get('order') as AppsFilterParams['order']) || 'desc',
    limit: pagination.limit,
    offset: pagination.offset,
    search: searchParams.get('search') || undefined,

    // Metric filters
    minCcu: parseNumber(searchParams.get('minCcu')),
    maxCcu: parseNumber(searchParams.get('maxCcu')),
    minOwners: parseNumber(searchParams.get('minOwners')),
    maxOwners: parseNumber(searchParams.get('maxOwners')),
    minReviews: parseNumber(searchParams.get('minReviews')),
    maxReviews: parseNumber(searchParams.get('maxReviews')),
    minScore: parseNumber(searchParams.get('minScore')),
    maxScore: parseNumber(searchParams.get('maxScore')),
    minPrice: parseNumber(searchParams.get('minPrice')),
    maxPrice: parseNumber(searchParams.get('maxPrice')),
    minPlaytime: parseNumber(searchParams.get('minPlaytime')),
    maxPlaytime: parseNumber(searchParams.get('maxPlaytime')),

    // Growth filters
    minGrowth7d: parseNumber(searchParams.get('minGrowth7d')),
    maxGrowth7d: parseNumber(searchParams.get('maxGrowth7d')),
    minGrowth30d: parseNumber(searchParams.get('minGrowth30d')),
    maxGrowth30d: parseNumber(searchParams.get('maxGrowth30d')),
    minMomentum: parseNumber(searchParams.get('minMomentum')),
    maxMomentum: parseNumber(searchParams.get('maxMomentum')),

    // Sentiment filters
    minSentimentDelta: parseNumber(searchParams.get('minSentimentDelta')),
    maxSentimentDelta: parseNumber(searchParams.get('maxSentimentDelta')),
    velocityTier: searchParams.get('velocityTier') as AppsFilterParams['velocityTier'],

    // Engagement filters
    minActivePct: parseNumber(searchParams.get('minActivePct')),
    minReviewRate: parseNumber(searchParams.get('minReviewRate')),
    minValueScore: parseNumber(searchParams.get('minValueScore')),

    // Content filters
    genres: parseNumberArray(searchParams.get('genres')),
    genreMode: (searchParams.get('genreMode') as 'any' | 'all') || 'all', // Default 'all' so adding tags narrows results
    tags: parseNumberArray(searchParams.get('tags')),
    tagMode: (searchParams.get('tagMode') as 'any' | 'all') || 'all', // Default 'all' so adding tags narrows results
    categories: parseNumberArray(searchParams.get('categories')),
    hasWorkshop: parseBoolean(searchParams.get('hasWorkshop')),

    // Platform filters
    platforms: parseStringArray(searchParams.get('platforms')),
    platformMode: (searchParams.get('platformMode') as 'any' | 'all') || 'all', // Default 'all' so adding platforms narrows results
    steamDeck: searchParams.get('steamDeck') || undefined,
    controller: searchParams.get('controller') || undefined,

    // Release filters
    minAge: parseNumber(searchParams.get('minAge')),
    maxAge: parseNumber(searchParams.get('maxAge')),
    releaseYear: parseNumber(searchParams.get('releaseYear')),
    earlyAccess: parseBoolean(searchParams.get('earlyAccess')),
    minHype: parseNumber(searchParams.get('minHype')),
    maxHype: parseNumber(searchParams.get('maxHype')),

    // Relationship filters
    publisherSearch: searchParams.get('publisherSearch') || undefined,
    developerSearch: searchParams.get('developerSearch') || undefined,
    selfPublished: parseBoolean(searchParams.get('selfPublished')),
    minVsPublisher: parseNumber(searchParams.get('minVsPublisher')),
    publisherSize: searchParams.get('publisherSize') as AppsFilterParams['publisherSize'],

    // Activity filters
    ccuTier: parseNumber(searchParams.get('ccuTier')) as AppsFilterParams['ccuTier'],

    // Boolean filters
    isFree: parseBoolean(searchParams.get('isFree')),
  };
}

/**
 * Default aggregate stats (used as fallback)
 */
export const DEFAULT_AGGREGATE_STATS: AggregateStats = {
  total_games: 0,
  avg_ccu: null,
  avg_score: null,
  avg_momentum: null,
  trending_up_count: 0,
  trending_down_count: 0,
  sentiment_improving_count: 0,
  sentiment_declining_count: 0,
  avg_value_score: null,
};
