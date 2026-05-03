import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { AppsFilterParams, AggregateStats } from '@/app/(main)/apps/lib/apps-types';
import { getAggregateStats, getApps } from '@/app/(main)/apps/lib/apps-queries';

/**
 * Default aggregate stats (used as fallback when stats query fails)
 */
const DEFAULT_STATS: AggregateStats = {
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

/**
 * In-memory cache for default view results.
 * When no filters are applied, the database must scan all ~200K apps which takes 5+ seconds.
 * Caching the default view (Top 50 by CCU) provides instant response when clearing filters.
 */
const defaultViewCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if this is a default view request (no filters applied).
 * Default view = type filter only + default sort (ccu_peak desc) + first page
 */
function isDefaultView(params: AppsFilterParams): boolean {
  return (
    // No search
    !params.search &&
    // No metric filters
    params.minCcu === undefined &&
    params.maxCcu === undefined &&
    params.minOwners === undefined &&
    params.maxOwners === undefined &&
    params.minReviews === undefined &&
    params.maxReviews === undefined &&
    params.minScore === undefined &&
    params.maxScore === undefined &&
    params.minPrice === undefined &&
    params.maxPrice === undefined &&
    params.minPlaytime === undefined &&
    params.maxPlaytime === undefined &&
    // No growth filters
    params.minGrowth7d === undefined &&
    params.maxGrowth7d === undefined &&
    params.minGrowth30d === undefined &&
    params.maxGrowth30d === undefined &&
    params.minMomentum === undefined &&
    params.maxMomentum === undefined &&
    // No sentiment filters
    params.minSentimentDelta === undefined &&
    params.maxSentimentDelta === undefined &&
    params.velocityTier === undefined &&
    // No engagement filters
    params.minActivePct === undefined &&
    params.minReviewRate === undefined &&
    params.minValueScore === undefined &&
    // No content filters
    !params.genres?.length &&
    !params.tags?.length &&
    !params.categories?.length &&
    params.hasWorkshop === undefined &&
    // No platform filters
    !params.platforms?.length &&
    params.steamDeck === undefined &&
    params.controller === undefined &&
    // No release filters
    params.minAge === undefined &&
    params.maxAge === undefined &&
    params.releaseYear === undefined &&
    params.earlyAccess === undefined &&
    params.minHype === undefined &&
    params.maxHype === undefined &&
    // No relationship filters
    !params.publisherSearch &&
    !params.developerSearch &&
    params.selfPublished === undefined &&
    params.minVsPublisher === undefined &&
    params.publisherSize === undefined &&
    // No activity filters
    params.ccuTier === undefined &&
    // No boolean filters
    params.isFree === undefined &&
    // No discount filter
    params.minDiscount === undefined &&
    // Default sort and first page
    params.sort === 'ccu_peak' &&
    params.order === 'desc' &&
    (params.offset ?? 0) === 0
  );
}

/**
 * API route for fetching apps data
 * Used by client-side React Query for data fetching
 */
export async function GET(request: NextRequest) {
  // SECURITY FIX (AUTH-06): Defense-in-depth auth check
  // Middleware handles auth, but API routes should also verify
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;

  // Parse query parameters
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

  // Build filter params
  const params: AppsFilterParams = {
    type: (searchParams.get('type') as AppsFilterParams['type']) || 'game',
    sort: (searchParams.get('sort') as AppsFilterParams['sort']) || 'ccu_peak',
    order: (searchParams.get('order') as AppsFilterParams['order']) || 'desc',
    limit: parseNumber(searchParams.get('limit')) ?? 50,
    offset: parseNumber(searchParams.get('offset')) ?? 0,
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

    // Discount filter
    minDiscount: parseNumber(searchParams.get('minDiscount')),
  };

  // Check cache for default view (no filters = expensive full table scan)
  const cacheKey = `default-${params.type}-${params.limit}`;
  if (isDefaultView(params)) {
    const cached = defaultViewCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
  }

  try {
    const data = await getApps(params);
    let stats: AggregateStats = DEFAULT_STATS;
    try {
      stats = await getAggregateStats(params);
    } catch (statsError) {
      console.error('Error fetching aggregate stats:', statsError);
    }

    const result = { data, stats };

    // Cache default view results for fast subsequent loads
    if (isDefaultView(params)) {
      defaultViewCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in apps API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
