/**
 * Game Search Service
 *
 * Provides flexible game discovery with tag, genre, category, platform,
 * and pricing filters for chat. Content candidate resolution uses the
 * app_filter_data materialized view so large tag sets do not silently
 * truncate at the first PostgREST page.
 */

import { getServiceSupabase } from '@/lib/supabase-service';
import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { buildSearchGamesSufficiencyMetadata } from '@/lib/chat/discovery-guardrails';
import { buildTigerPrimaryResultSet } from '@/lib/chat/result-set-continuation';
import type { ToolSufficiencyMetadata } from '@/lib/llm/types';
import { postToQueryApi } from '@/lib/query-api-client';

/**
 * Common tag/category name normalizations
 * Maps user input variants to canonical database names
 */
const TAG_NORMALIZATIONS: Record<string, string> = {
  'coop': 'co-op',
  'coops': 'co-op',
  'cooperative': 'co-op',
};

const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 20;
const APP_FILTER_PAGE_SIZE = 1000;
const MAIN_QUERY_BATCH_SIZE = 1000;
const UNFILTERED_FETCH_CAP = 1000;

type ServiceSupabase = ReturnType<typeof getServiceSupabase>;
type IdLookupTable = 'steam_tags' | 'steam_genres' | 'steam_categories';
type IdLookupColumn = 'tag_id' | 'genre_id' | 'category_id';
type AppFilterArrayColumn = 'tag_ids' | 'genre_ids' | 'category_ids' | 'platform_array';

function normalizeSearchTerm(term: string): string {
  const lower = term.toLowerCase();
  return TAG_NORMALIZATIONS[lower] || term;
}

/**
 * Arguments for search_games tool
 */
export interface SearchGamesArgs {
  tags?: string[];
  genres?: string[];
  categories?: string[];
  platforms?: ('windows' | 'macos' | 'linux')[];
  controller_support?: 'full' | 'partial' | 'any';
  steam_deck?: ('verified' | 'playable')[];
  release_year?: { gte?: number; lte?: number };
  review_percentage?: { gte?: number };
  min_reviews?: number;
  metacritic_score?: { gte?: number };
  min_price_cents?: number;
  max_price_cents?: number;
  is_free?: boolean;
  on_sale?: boolean;
  min_discount_percent?: number;
  limit?: number;
  order_by?: 'reviews' | 'score' | 'release_date' | 'owners';
  excludeAppIds?: number[];
}

/**
 * Game result from search
 */
export interface GameSearchResult {
  appid: number;
  name: string;
  platforms: string | null;
  controller_support: string | null;
  steam_deck_category: string | null;
  release_date: string | null;
  release_year: number | null;
  release_state: string | null;
  review_percentage: number | null;
  metacritic_score: number | null;
  total_reviews: number | null;
  is_free: boolean;
  priceDollars: number | null;
  discountPercent: number | null;
  publisherId: number | null;
  publisherName: string | null;
  developerId: number | null;
  developerName: string | null;
}

/**
 * Debug info for search tracing
 */
export interface SearchDebugInfo {
  input_args: SearchGamesArgs;
  steps: string[];
  content_filter_backend?: 'app_filter_data';
  resolved_tag_groups?: number[][];
  resolved_genre_groups?: number[][];
  resolved_category_groups?: number[][];
  tag_candidates?: number;
  genre_candidates?: number;
  category_candidates?: number;
  platform_candidates?: number;
  steam_deck_candidates?: number;
  final_candidates?: number | null;
  candidate_pages_fetched?: number;
  batched_query_count?: number;
  query_rows_returned?: number;
  after_release_filter?: number;
  after_review_filter?: number;
  final_count?: number;
  coverage_complete?: boolean;
  sparse_result?: boolean;
  resultShape?: ToolSufficiencyMetadata['result_shape'];
  sufficientToAnswer?: boolean;
  sufficiencyReason?: string;
  allowFollowUpRelaxation?: boolean;
}

/**
 * Result from search_games
 */
export interface SearchGamesResult extends ToolSufficiencyMetadata {
  success: boolean;
  results?: GameSearchResult[];
  total_found?: number;
  filters_applied?: string[];
  coverage_complete?: boolean;
  sparse_result?: boolean;
  debug?: SearchDebugInfo;
  error?: string;
}

interface QueryRow {
  appid: number;
  name: string;
  platforms: string | null;
  controller_support: string | null;
  is_free: boolean;
  release_date: string | null;
  release_state: string | null;
  current_price_cents: number | null;
  current_discount_percent: number | null;
  pics_review_percentage: number | null;
  metacritic_score: number | null;
  app_steam_deck: { category: string }[] | null;
  latest_daily_metrics: {
    total_reviews: number;
    positive_percentage: number;
    owners_midpoint: number;
  }[] | null;
  app_publishers: { publishers: { id: number; name: string } | null }[] | null;
  app_developers: { developers: { id: number; name: string } | null }[] | null;
}

interface AppidFetchResult {
  appids: number[];
  pagesFetched: number;
}

interface TigerSearchCatalogResponse {
  continuationToken: string | null;
  items?: Array<{
    appid: number;
    developers?: string[];
    isFree: boolean;
    name: string;
    platforms?: string[];
    publishers?: string[];
    releaseDate: string | null;
    releaseYear: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  }>;
}

const TIGER_SEARCH_GAMES_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: [
    'query_api:searchCatalog',
    'relation:apps',
    'relation:latest_daily_metrics',
    'relation:app_publishers',
    'relation:publishers',
    'relation:app_developers',
    'relation:developers',
  ],
  migrationDisposition: 'already_tiger',
  migrationNotes:
    'search_games now uses Tiger search-catalog when the tool arguments stay within the supported typed filter set.',
  recommendedTigerContracts: ['searchCatalog'],
};

function getStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );

  return items.length > 0 ? items : null;
}

function buildTigerSearchGamesRequest(
  args: SearchGamesArgs,
  limit: number
): Record<string, unknown> | null {
  const unsupported: string[] = [];

  if (getStringArray(args.categories)) unsupported.push('categories');
  if (typeof args.controller_support === 'string') unsupported.push('controller_support');
  if (getStringArray(args.steam_deck)) unsupported.push('steam_deck');
  if (typeof args.metacritic_score?.gte === 'number') unsupported.push('metacritic_score');
  if (Array.isArray(args.excludeAppIds) && args.excludeAppIds.length > 0) unsupported.push('excludeAppIds');
  const orderBy = typeof args.order_by === 'string' ? args.order_by : undefined;
  const sortBy =
    orderBy === 'reviews'
      ? 'reviews'
      : orderBy === 'owners'
        ? 'owners'
        : orderBy === 'release_date'
          ? 'release_date'
          : undefined;

  if (orderBy && !sortBy) {
    unsupported.push(`order_by:${orderBy}`);
  }

  if (unsupported.length > 0) {
    return null;
  }

  return {
    ...(getStringArray(args.tags) ? { tags: getStringArray(args.tags) } : {}),
    ...(getStringArray(args.genres) ? { genres: getStringArray(args.genres) } : {}),
    ...(getStringArray(args.platforms) ? { platforms: getStringArray(args.platforms) } : {}),
    ...(typeof args.is_free === 'boolean' ? { isFree: args.is_free } : {}),
    ...(typeof args.min_reviews === 'number' ? { minReviews: args.min_reviews } : {}),
    ...(typeof args.review_percentage?.gte === 'number'
      ? { minReviewScore: args.review_percentage.gte }
      : {}),
    ...(typeof args.min_price_cents === 'number' ? { minPriceCents: args.min_price_cents } : {}),
    ...(typeof args.max_price_cents === 'number' ? { maxPriceCents: args.max_price_cents } : {}),
    ...(args.on_sale === true ? { onSale: true } : {}),
    ...(typeof args.min_discount_percent === 'number'
      ? { minDiscountPercent: args.min_discount_percent }
      : {}),
    ...(args.release_year
      ? {
          releaseYear: {
            ...(typeof args.release_year.gte === 'number' ? { gte: args.release_year.gte } : {}),
            ...(typeof args.release_year.lte === 'number' ? { lte: args.release_year.lte } : {}),
          },
        }
      : {}),
    ...(sortBy ? { sortBy, sortDirection: 'desc' } : {}),
    limit,
  };
}

function buildSearchGamesFiltersApplied(args: SearchGamesArgs): string[] {
  const filtersApplied: string[] = [];

  if (args.tags && args.tags.length > 0) {
    filtersApplied.push(`tags: ${args.tags.join(', ')}`);
  }
  if (args.genres && args.genres.length > 0) {
    filtersApplied.push(`genres: ${args.genres.join(', ')}`);
  }
  if (args.platforms && args.platforms.length > 0) {
    filtersApplied.push(`platforms: ${args.platforms.join(', ')}`);
  }
  if (args.release_year?.gte !== undefined) {
    filtersApplied.push(`release_year >= ${args.release_year.gte}`);
  }
  if (args.release_year?.lte !== undefined) {
    filtersApplied.push(`release_year <= ${args.release_year.lte}`);
  }
  if (args.review_percentage?.gte !== undefined) {
    filtersApplied.push(`review_percentage >= ${args.review_percentage.gte}`);
  }
  if (args.min_reviews !== undefined) {
    filtersApplied.push(`min_reviews >= ${args.min_reviews}`);
  }
  if (args.is_free !== undefined) {
    filtersApplied.push(`is_free: ${args.is_free}`);
  }

  return filtersApplied;
}

async function tryTigerSearchGames(
  args: SearchGamesArgs,
  actualLimit: number
): Promise<SearchGamesResult | null> {
  const request = buildTigerSearchGamesRequest(args, actualLimit);
  if (!request) {
    return null;
  }

  const response = await postToQueryApi<TigerSearchCatalogResponse>(
    '/v1/contracts/search-catalog',
    request
  );

  if (!response.ok || !response.data) {
    return null;
  }

  const results: GameSearchResult[] = (response.data.items ?? []).map((item) => ({
    appid: item.appid,
    controller_support: null,
    developerId: null,
    developerName: item.developers?.[0] ?? null,
    discountPercent: null,
    is_free: item.isFree,
    metacritic_score: null,
    name: item.name,
    platforms: item.platforms?.join(', ') ?? null,
    priceDollars: null,
    publisherId: null,
    publisherName: item.publishers?.[0] ?? null,
    release_date: item.releaseDate,
    release_state: null,
    release_year: item.releaseYear,
    review_percentage: item.reviewScore,
    steam_deck_category: null,
    total_reviews: item.totalReviews,
  }));

  const coverageComplete = response.data.continuationToken == null;
  const sparseResult = coverageComplete && results.length > 0 && results.length <= 5;
  const sufficiency = buildSearchGamesSufficiencyMetadata(
    args,
    results.length,
    coverageComplete,
    sparseResult
  );
  const tigerResultSet = buildTigerPrimaryResultSet({
    family: 'discovery',
    result: response.data,
    sourceArgs: request,
    sourceContract: 'searchCatalog',
  });

  return attachToolExecutionProvenance(
    {
      success: true,
      results,
      total_found: results.length,
      filters_applied: buildSearchGamesFiltersApplied(args),
      coverage_complete: coverageComplete,
      sparse_result: sparseResult,
      debug: {
        input_args: args,
        steps: [
          'Tiger compatibility wrapper routed search_games to searchCatalog.',
          `Tiger returned ${results.length} row(s).`,
          `Coverage complete: ${coverageComplete}`,
        ],
        coverage_complete: coverageComplete,
        sparse_result: sparseResult,
        resultShape: sufficiency.result_shape,
        sufficientToAnswer: sufficiency.sufficient_to_answer,
        sufficiencyReason: sufficiency.sufficiency_reason,
      },
      ...(tigerResultSet
        ? {
            continuation_meta: {
              resultSet: tigerResultSet,
            },
          }
        : {}),
      ...sufficiency,
    },
    TIGER_SEARCH_GAMES_PROVENANCE
  );
}

/**
 * Search for games matching the specified criteria
 */
export async function searchGames(args: SearchGamesArgs): Promise<SearchGamesResult> {
  const {
    tags,
    genres,
    categories,
    platforms,
    controller_support,
    steam_deck,
    release_year,
    review_percentage,
    min_reviews,
    metacritic_score,
    min_price_cents,
    max_price_cents,
    is_free,
    on_sale,
    min_discount_percent,
    limit = DEFAULT_RESULTS,
    order_by = 'reviews',
    excludeAppIds = [],
  } = args;

  const debug: SearchDebugInfo = {
    input_args: args,
    steps: [],
    content_filter_backend: 'app_filter_data',
  };

  const filtersApplied: string[] = [];
  const actualLimit = Math.min(limit, MAX_RESULTS);
  const excludedAppIdSet = new Set(excludeAppIds);
  debug.steps.push(`Starting search with limit=${actualLimit}`);

  try {
    const tigerResult = await tryTigerSearchGames(args, actualLimit);
    if (tigerResult) {
      return tigerResult;
    }

    const supabase = getServiceSupabase();

    if (tags && tags.length > 0) {
      filtersApplied.push(`tags: ${tags.join(', ')}`);
    }
    if (genres && genres.length > 0) {
      filtersApplied.push(`genres: ${genres.join(', ')}`);
    }
    if (categories && categories.length > 0) {
      filtersApplied.push(`categories: ${categories.join(', ')}`);
    }
    if (platforms && platforms.length > 0) {
      filtersApplied.push(`platforms: ${platforms.join(', ')}`);
    }
    if (controller_support) {
      filtersApplied.push(`controller_support: ${controller_support}`);
    }
    if (steam_deck && steam_deck.length > 0) {
      filtersApplied.push(`steam_deck: ${steam_deck.join(', ')}`);
    }
    if (release_year?.gte !== undefined) {
      filtersApplied.push(`release_year >= ${release_year.gte}`);
    }
    if (release_year?.lte !== undefined) {
      filtersApplied.push(`release_year <= ${release_year.lte}`);
    }
    if (review_percentage?.gte !== undefined) {
      filtersApplied.push(`review_percentage >= ${review_percentage.gte}`);
    }
    if (min_reviews !== undefined) {
      filtersApplied.push(`min_reviews >= ${min_reviews}`);
    }
    if (metacritic_score?.gte !== undefined) {
      filtersApplied.push(`metacritic_score >= ${metacritic_score.gte}`);
    }
    if (min_price_cents !== undefined) {
      filtersApplied.push(`min_price_cents >= ${min_price_cents}`);
    }
    if (max_price_cents !== undefined) {
      filtersApplied.push(`max_price_cents <= ${max_price_cents}`);
    }
    if (is_free !== undefined) {
      filtersApplied.push(`is_free: ${is_free}`);
    }
    if (on_sale === true) {
      filtersApplied.push('on_sale: true');
    }
    if (min_discount_percent !== undefined) {
      filtersApplied.push(`min_discount_percent >= ${min_discount_percent}`);
    }

    let candidateAppids: number[] | null = null;
    let candidatePagesFetched = 0;

    if (tags && tags.length > 0) {
      const normalizedTags = tags.map(normalizeSearchTerm);
      debug.steps.push(`Filtering by ${normalizedTags.length} tags via app_filter_data: ${normalizedTags.join(', ')}`);

      const resolvedTagGroups = await resolveMatchingIdGroups(
        supabase,
        'steam_tags',
        'tag_id',
        normalizedTags
      );
      debug.resolved_tag_groups = resolvedTagGroups;

      let tagFetch = await getAppidsMatchingResolvedGroups(supabase, 'tag_ids', resolvedTagGroups);
      candidatePagesFetched += tagFetch.pagesFetched;
      debug.tag_candidates = tagFetch.appids.length;
      debug.steps.push(`Tags filter returned ${tagFetch.appids.length} candidate appids`);

      if (tagFetch.appids.length === 0) {
        debug.steps.push('Tags returned 0, trying as categories fallback');
        const categoryFallbackGroups = await resolveMatchingIdGroups(
          supabase,
          'steam_categories',
          'category_id',
          normalizedTags
        );
        if (categoryFallbackGroups.length > 0) {
          debug.resolved_category_groups = categoryFallbackGroups;
          const fallbackFetch = await getAppidsMatchingResolvedGroups(
            supabase,
            'category_ids',
            categoryFallbackGroups
          );
          candidatePagesFetched += fallbackFetch.pagesFetched;
          if (fallbackFetch.appids.length > 0) {
            debug.steps.push(`Category fallback found ${fallbackFetch.appids.length} results`);
            tagFetch = fallbackFetch;
            debug.tag_candidates = fallbackFetch.appids.length;
            debug.category_candidates = fallbackFetch.appids.length;
          }
        }
      }

      candidateAppids = tagFetch.appids;
    }

    if (genres && genres.length > 0) {
      debug.steps.push(`Filtering by ${genres.length} genres via app_filter_data: ${genres.join(', ')}`);
      const resolvedGenreGroups = await resolveMatchingIdGroups(
        supabase,
        'steam_genres',
        'genre_id',
        genres
      );
      debug.resolved_genre_groups = resolvedGenreGroups;

      let genreFetch = await getAppidsMatchingResolvedGroups(supabase, 'genre_ids', resolvedGenreGroups);
      candidatePagesFetched += genreFetch.pagesFetched;
      debug.genre_candidates = genreFetch.appids.length;
      debug.steps.push(`Genres filter returned ${genreFetch.appids.length} candidate appids`);

      if (genreFetch.appids.length === 0) {
        debug.steps.push('Genres returned 0, trying as tags fallback');
        const tagFallbackGroups = await resolveMatchingIdGroups(
          supabase,
          'steam_tags',
          'tag_id',
          genres
        );
        if (tagFallbackGroups.length > 0) {
          debug.resolved_tag_groups = tagFallbackGroups;
          const fallbackFetch = await getAppidsMatchingResolvedGroups(
            supabase,
            'tag_ids',
            tagFallbackGroups
          );
          candidatePagesFetched += fallbackFetch.pagesFetched;
          if (fallbackFetch.appids.length > 0) {
            debug.steps.push(`Tag fallback found ${fallbackFetch.appids.length} results`);
            genreFetch = fallbackFetch;
            debug.genre_candidates = fallbackFetch.appids.length;
            debug.tag_candidates = fallbackFetch.appids.length;
          }
        }
      }

      candidateAppids = intersectCandidateAppids(candidateAppids, genreFetch.appids);
      debug.steps.push(`After genre intersection: ${candidateAppids.length}`);
    }

    if (categories && categories.length > 0) {
      debug.steps.push(`Filtering by ${categories.length} categories via app_filter_data: ${categories.join(', ')}`);
      const resolvedCategoryGroups = await resolveMatchingIdGroups(
        supabase,
        'steam_categories',
        'category_id',
        categories
      );
      debug.resolved_category_groups = resolvedCategoryGroups;

      const categoryFetch = await getAppidsMatchingResolvedGroups(
        supabase,
        'category_ids',
        resolvedCategoryGroups
      );
      candidatePagesFetched += categoryFetch.pagesFetched;
      debug.category_candidates = categoryFetch.appids.length;
      debug.steps.push(`Categories filter returned ${categoryFetch.appids.length} candidate appids`);

      candidateAppids = intersectCandidateAppids(candidateAppids, categoryFetch.appids);
      debug.steps.push(`After category intersection: ${candidateAppids.length}`);
    }

    if (platforms && platforms.length > 0) {
      debug.steps.push(`Filtering by platforms via app_filter_data: ${platforms.join(', ')}`);
      const platformFetch = await getAppidsMatchingArrayOverlap(
        supabase,
        'platform_array',
        platforms
      );
      candidatePagesFetched += platformFetch.pagesFetched;
      debug.platform_candidates = platformFetch.appids.length;
      debug.steps.push(`Platform filter returned ${platformFetch.appids.length} candidate appids`);

      candidateAppids = intersectCandidateAppids(candidateAppids, platformFetch.appids);
      debug.steps.push(`After platform intersection: ${candidateAppids.length}`);
    }

    if (steam_deck && steam_deck.length > 0) {
      debug.steps.push(`Filtering by Steam Deck via app_filter_data: ${steam_deck.join(', ')}`);
      const deckFetch = await getAppidsMatchingSteamDeck(supabase, steam_deck);
      candidatePagesFetched += deckFetch.pagesFetched;
      debug.steam_deck_candidates = deckFetch.appids.length;
      debug.steps.push(`Steam Deck filter returned ${deckFetch.appids.length} candidate appids`);

      candidateAppids = intersectCandidateAppids(candidateAppids, deckFetch.appids);
      debug.steps.push(`After Steam Deck intersection: ${candidateAppids.length}`);
    }

    debug.candidate_pages_fetched = candidatePagesFetched;
    debug.final_candidates = candidateAppids?.length ?? null;

    if (candidateAppids !== null && excludedAppIdSet.size > 0) {
      candidateAppids = candidateAppids.filter((appid) => !excludedAppIdSet.has(appid));
      debug.steps.push(`Excluded ${excludedAppIdSet.size} previously shown appids from candidate set`);
    }

    if (candidateAppids !== null && candidateAppids.length === 0) {
      const sufficiency = buildSearchGamesSufficiencyMetadata(args, 0, true, false);
      debug.coverage_complete = true;
      debug.sparse_result = false;
      debug.resultShape = sufficiency.result_shape;
      debug.sufficientToAnswer = sufficiency.sufficient_to_answer;
      debug.sufficiencyReason = sufficiency.sufficiency_reason;
      debug.allowFollowUpRelaxation = sufficiency.allow_follow_up_relaxation;
      debug.steps.push('No candidates remain after filtering, returning empty');
      if (sufficiency.sufficiency_reason) {
        debug.steps.push(`Sufficiency: ${sufficiency.sufficiency_reason}`);
      }
      return {
        success: true,
        results: [],
        total_found: 0,
        filters_applied: filtersApplied,
        coverage_complete: true,
        sparse_result: false,
        ...sufficiency,
        debug,
      };
    }

    debug.steps.push(`Final candidate count before main query: ${candidateAppids?.length ?? 'unlimited'}`);

    let fetchLimit = Math.min(actualLimit * 2 + excludedAppIdSet.size, UNFILTERED_FETCH_CAP);
    let rawRows: QueryRow[] = [];

    if (candidateAppids !== null) {
      const candidateBatches = chunkArray(candidateAppids, MAIN_QUERY_BATCH_SIZE);
      debug.batched_query_count = candidateBatches.length;
      debug.steps.push(`Querying ${candidateBatches.length} candidate batches for complete coverage`);

      for (const batch of candidateBatches) {
        const { data, error } = await buildMainAppsQuery(supabase, args, debug)
          .in('appid', batch)
          .limit(batch.length);

        if (error) {
          debug.steps.push(`Query error: ${error.message}`);
          return {
            success: false,
            error: error.message,
            debug,
          };
        }

        const batchRows = (data || []) as QueryRow[];
        rawRows = rawRows.concat(batchRows);
        debug.query_rows_returned = (debug.query_rows_returned ?? 0) + batchRows.length;
      }
    } else {
      const hasPostFilters = review_percentage?.gte !== undefined || min_reviews !== undefined;
      const needsInMemoryMetricSort = order_by === 'reviews' || order_by === 'owners';
      fetchLimit = Math.min(
        actualLimit * (hasPostFilters || needsInMemoryMetricSort ? 10 : 2) + excludedAppIdSet.size,
        UNFILTERED_FETCH_CAP
      );

      const { data, error } = await buildMainAppsQuery(supabase, args, debug).limit(fetchLimit);

      if (error) {
        debug.steps.push(`Query error: ${error.message}`);
        return {
          success: false,
          error: error.message,
          debug,
        };
      }

      rawRows = (data || []) as QueryRow[];
      debug.query_rows_returned = rawRows.length;
      debug.steps.push(`Main query returned ${rawRows.length} rows`);
    }

    debug.steps.push(`Main query returned ${rawRows.length} rows`);

    const mappedResults = rawRows
      .filter((row) => !excludedAppIdSet.has(row.appid))
      .map((row) => mapQueryRow(row));
    debug.steps.push(`Mapped ${mappedResults.length} results`);

    const afterReleaseFilter = mappedResults.filter((result) => {
      if (release_year?.gte !== undefined && (result.release_year === null || result.release_year < release_year.gte)) {
        return false;
      }
      if (release_year?.lte !== undefined && (result.release_year === null || result.release_year > release_year.lte)) {
        return false;
      }
      return true;
    });

    debug.after_release_filter = afterReleaseFilter.length;
    if (release_year?.gte !== undefined || release_year?.lte !== undefined) {
      debug.steps.push(`After release year filter: ${afterReleaseFilter.length} (from ${mappedResults.length})`);
    }

    const results = afterReleaseFilter.filter((result) => {
      if (review_percentage?.gte !== undefined) {
        if (result.review_percentage === null || result.review_percentage < review_percentage.gte) {
          return false;
        }
      }
      if (min_reviews !== undefined) {
        if (result.total_reviews === null || result.total_reviews < min_reviews) {
          return false;
        }
      }
      return true;
    });

    debug.after_review_filter = results.length;
    if (review_percentage?.gte !== undefined || min_reviews !== undefined) {
      const filterSummary = [
        review_percentage?.gte !== undefined ? `review % >= ${review_percentage.gte}` : null,
        min_reviews !== undefined ? `reviews >= ${min_reviews}` : null,
      ].filter(Boolean).join(', ');
      debug.steps.push(`After post-filters (${filterSummary}): ${results.length} (from ${afterReleaseFilter.length})`);
    }

    results.sort((a, b) => {
      switch (order_by) {
        case 'score':
          if ((b.review_percentage ?? 0) !== (a.review_percentage ?? 0)) {
            return (b.review_percentage ?? 0) - (a.review_percentage ?? 0);
          }
          return (b.total_reviews ?? 0) - (a.total_reviews ?? 0);
        case 'release_date':
          return compareIsoDatesDesc(a.release_date, b.release_date);
        case 'owners':
          if ((b._owners_midpoint ?? 0) !== (a._owners_midpoint ?? 0)) {
            return (b._owners_midpoint ?? 0) - (a._owners_midpoint ?? 0);
          }
          return (b.total_reviews ?? 0) - (a.total_reviews ?? 0);
        case 'reviews':
        default:
          if ((b.total_reviews ?? 0) !== (a.total_reviews ?? 0)) {
            return (b.total_reviews ?? 0) - (a.total_reviews ?? 0);
          }
          return (b.review_percentage ?? 0) - (a.review_percentage ?? 0);
      }
    });

    const coverageComplete = candidateAppids !== null || rawRows.length < fetchLimit;
    const sparseResult = coverageComplete && results.length > 0 && results.length <= 5;
    const totalFound = coverageComplete ? results.length : Math.min(results.length, actualLimit);

    const finalResults = results.slice(0, actualLimit).map(stripInternalOwnersMetric);
    const sufficiency = buildSearchGamesSufficiencyMetadata(
      args,
      finalResults.length,
      coverageComplete,
      sparseResult
    );

    debug.coverage_complete = coverageComplete;
    debug.sparse_result = sparseResult;
    debug.resultShape = sufficiency.result_shape;
    debug.sufficientToAnswer = sufficiency.sufficient_to_answer;
    debug.sufficiencyReason = sufficiency.sufficiency_reason;
    debug.allowFollowUpRelaxation = sufficiency.allow_follow_up_relaxation;
    debug.final_count = finalResults.length;
    debug.steps.push(`Coverage complete: ${coverageComplete}`);
    if (sparseResult) {
      debug.steps.push(`Sparse result set detected: ${results.length} qualifying rows`);
    }
    if (sufficiency.sufficiency_reason) {
      debug.steps.push(`Sufficiency: ${sufficiency.sufficiency_reason}`);
    }
    debug.steps.push(`Final result count: ${finalResults.length}`);

    return {
      success: true,
      results: finalResults,
      total_found: totalFound,
      filters_applied: filtersApplied,
      coverage_complete: coverageComplete,
      sparse_result: sparseResult,
      ...sufficiency,
      debug,
    };
  } catch (error) {
    debug.steps.push(`Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
      debug,
    };
  }
}

function buildMainAppsQuery(
  supabase: ServiceSupabase,
  args: SearchGamesArgs,
  debug: SearchDebugInfo
) {
  const {
    controller_support,
    release_year,
    review_percentage,
    metacritic_score,
    min_price_cents,
    max_price_cents,
    is_free,
    on_sale,
    min_discount_percent,
    order_by = 'reviews',
  } = args;

  let queryBuilder = supabase
    .from('apps')
    .select(
      `
      appid,
      name,
      platforms,
      controller_support,
      is_free,
      release_date,
      release_state,
      current_price_cents,
      current_discount_percent,
      pics_review_percentage,
      metacritic_score,
      app_steam_deck!left(category),
      latest_daily_metrics!left(total_reviews, positive_percentage, owners_midpoint),
      app_publishers!left(publishers!left(id, name)),
      app_developers!left(developers!left(id, name))
    `
    )
    .eq('type', 'game')
    .eq('is_delisted', false)
    .eq('is_released', true);

  if (controller_support) {
    if (controller_support === 'any') {
      queryBuilder = queryBuilder.in('controller_support', ['full', 'partial']);
    } else {
      queryBuilder = queryBuilder.eq('controller_support', controller_support);
    }
  }

  if (is_free !== undefined) {
    queryBuilder = queryBuilder.eq('is_free', is_free);
  }

  if (min_price_cents !== undefined) {
    queryBuilder = queryBuilder.gte('current_price_cents', min_price_cents);
  }

  if (max_price_cents !== undefined) {
    queryBuilder = queryBuilder.lte('current_price_cents', max_price_cents);
  }

  if (on_sale === true) {
    queryBuilder = queryBuilder.gt('current_discount_percent', 0);
  }

  if (min_discount_percent !== undefined) {
    queryBuilder = queryBuilder.gte('current_discount_percent', min_discount_percent);
  }

  if (release_year?.gte !== undefined) {
    queryBuilder = queryBuilder.gte('release_date', `${release_year.gte}-01-01`);
    debug.steps.push(`Adding release year >= ${release_year.gte} filter`);
  }
  if (release_year?.lte !== undefined) {
    queryBuilder = queryBuilder.lte('release_date', `${release_year.lte}-12-31`);
    debug.steps.push(`Adding release year <= ${release_year.lte} filter`);
  }

  if (metacritic_score?.gte !== undefined) {
    queryBuilder = queryBuilder.gte('metacritic_score', metacritic_score.gte);
  }

  if (review_percentage?.gte !== undefined) {
    const dbThreshold = Math.max(0, review_percentage.gte - 5);
    queryBuilder = queryBuilder.or(`pics_review_percentage.gte.${dbThreshold},pics_review_percentage.is.null`);
    debug.steps.push(`Adding DB-level review % >= ${dbThreshold} OR NULL filter (target: ${review_percentage.gte})`);
  }

  switch (order_by) {
    case 'score':
      queryBuilder = queryBuilder.order('pics_review_percentage', { ascending: false, nullsFirst: false });
      break;
    case 'release_date':
      queryBuilder = queryBuilder.order('release_date', { ascending: false, nullsFirst: false });
      break;
    default:
      queryBuilder = queryBuilder.order('release_date', { ascending: false, nullsFirst: false });
  }

  return queryBuilder;
}

function mapQueryRow(row: QueryRow): GameSearchResult & { _owners_midpoint: number | null } {
  const steamDeck = row.app_steam_deck;
  const metrics = row.latest_daily_metrics;
  const releaseYear = row.release_date ? new Date(row.release_date).getFullYear() : null;
  const reviewPct = metrics?.[0]?.positive_percentage ?? row.pics_review_percentage ?? null;
  const priceDollars = row.current_price_cents !== null ? row.current_price_cents / 100 : null;

  const firstPublisher = row.app_publishers?.[0]?.publishers;
  const firstDeveloper = row.app_developers?.[0]?.developers;

  return {
    appid: row.appid,
    name: row.name,
    platforms: row.platforms,
    controller_support: row.controller_support,
    steam_deck_category: steamDeck?.[0]?.category ?? null,
    release_date: row.release_date,
    release_year: releaseYear,
    release_state: row.release_state,
    review_percentage: reviewPct,
    metacritic_score: row.metacritic_score,
    total_reviews: metrics?.[0]?.total_reviews ?? null,
    is_free: row.is_free,
    priceDollars,
    discountPercent: row.current_discount_percent ?? null,
    publisherId: firstPublisher?.id ?? null,
    publisherName: firstPublisher?.name ?? null,
    developerId: firstDeveloper?.id ?? null,
    developerName: firstDeveloper?.name ?? null,
    _owners_midpoint: metrics?.[0]?.owners_midpoint ?? null,
  };
}

function stripInternalOwnersMetric(
  result: GameSearchResult & { _owners_midpoint: number | null }
): GameSearchResult {
  return {
    appid: result.appid,
    name: result.name,
    platforms: result.platforms,
    controller_support: result.controller_support,
    steam_deck_category: result.steam_deck_category,
    release_date: result.release_date,
    release_year: result.release_year,
    release_state: result.release_state,
    review_percentage: result.review_percentage,
    metacritic_score: result.metacritic_score,
    total_reviews: result.total_reviews,
    is_free: result.is_free,
    priceDollars: result.priceDollars,
    discountPercent: result.discountPercent,
    publisherId: result.publisherId,
    publisherName: result.publisherName,
    developerId: result.developerId,
    developerName: result.developerName,
  };
}

function intersectCandidateAppids(existing: number[] | null, next: number[]): number[] {
  if (existing === null) {
    return next;
  }

  const nextSet = new Set(next);
  return existing.filter((appid) => nextSet.has(appid));
}

function chunkArray(values: number[], chunkSize: number): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function compareIsoDatesDesc(a: string | null, b: string | null): number {
  const aValue = a ? Date.parse(a) : 0;
  const bValue = b ? Date.parse(b) : 0;
  return bValue - aValue;
}

function formatPgIntArray(values: number[]): string {
  return `{${values.join(',')}}`;
}

function formatPgTextArray(values: string[]): string {
  const escaped = values.map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
}

async function resolveMatchingIdGroups(
  supabase: ServiceSupabase,
  table: IdLookupTable,
  idColumn: IdLookupColumn,
  terms: string[]
): Promise<number[][]> {
  const groups: number[][] = [];

  for (const term of terms) {
    const { data, error } = await supabase
      .from(table)
      .select(idColumn)
      .ilike('name', `%${term}%`);

    if (error) {
      throw new Error(`Failed to resolve ${table} for "${term}": ${error.message}`);
    }

    const rows = (data ?? []) as unknown as Array<Record<string, number | null>>;
    const ids = [...new Set(rows
      .map((row) => row[idColumn])
      .filter((value): value is number => typeof value === 'number'))];

    if (ids.length === 0) {
      return [];
    }

    groups.push(ids);
  }

  return groups;
}

async function getAppidsMatchingResolvedGroups(
  supabase: ServiceSupabase,
  column: AppFilterArrayColumn,
  resolvedGroups: number[][]
): Promise<AppidFetchResult> {
  if (resolvedGroups.length === 0) {
    return { appids: [], pagesFetched: 0 };
  }

  let intersected: Set<number> | null = null;
  let pagesFetched = 0;

  for (const group of resolvedGroups) {
    const appidsForGroup = new Set<number>();
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from('app_filter_data')
        .select('appid')
        .filter(column, 'ov', formatPgIntArray(group))
        .order('appid', { ascending: true })
        .range(offset, offset + APP_FILTER_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch ${column} candidates: ${error.message}`);
      }

      const rows = (data ?? []) as Array<Record<'appid', number | null>>;
      pagesFetched += 1;

      for (const row of rows) {
        if (typeof row.appid === 'number') {
          appidsForGroup.add(row.appid);
        }
      }

      if (rows.length < APP_FILTER_PAGE_SIZE) {
        break;
      }

      offset += APP_FILTER_PAGE_SIZE;
    }

    if (appidsForGroup.size === 0) {
      return { appids: [], pagesFetched };
    }

    if (intersected === null) {
      intersected = appidsForGroup;
    } else {
      const currentValues: number[] = Array.from(intersected.values());
      intersected = new Set<number>(currentValues.filter((appid: number) => appidsForGroup.has(appid)));
    }

    if (intersected.size === 0) {
      return { appids: [], pagesFetched };
    }
  }

  return {
    appids: intersected ? [...intersected] : [],
    pagesFetched,
  };
}

async function getAppidsMatchingArrayOverlap(
  supabase: ServiceSupabase,
  column: AppFilterArrayColumn,
  values: string[]
): Promise<AppidFetchResult> {
  if (values.length === 0) {
    return { appids: [], pagesFetched: 0 };
  }

  const appids = new Set<number>();
  let pagesFetched = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('app_filter_data')
      .select('appid')
      .filter(column, 'ov', formatPgTextArray(values))
      .order('appid', { ascending: true })
      .range(offset, offset + APP_FILTER_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch ${column} candidates: ${error.message}`);
    }

    const rows = (data ?? []) as Array<Record<'appid', number | null>>;
    pagesFetched += 1;

    for (const row of rows) {
      if (typeof row.appid === 'number') {
        appids.add(row.appid);
      }
    }

    if (rows.length < APP_FILTER_PAGE_SIZE) {
      break;
    }

    offset += APP_FILTER_PAGE_SIZE;
  }

  return {
    appids: [...appids],
    pagesFetched,
  };
}

async function getAppidsMatchingSteamDeck(
  supabase: ServiceSupabase,
  steamDeck: ('verified' | 'playable')[]
): Promise<AppidFetchResult> {
  if (steamDeck.length === 0) {
    return { appids: [], pagesFetched: 0 };
  }

  const appids = new Set<number>();
  let pagesFetched = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('app_filter_data')
      .select('appid')
      .in('steam_deck_category', steamDeck)
      .order('appid', { ascending: true })
      .range(offset, offset + APP_FILTER_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch Steam Deck candidates: ${error.message}`);
    }

    const rows = (data ?? []) as Array<Record<'appid', number | null>>;
    pagesFetched += 1;

    for (const row of rows) {
      if (typeof row.appid === 'number') {
        appids.add(row.appid);
      }
    }

    if (rows.length < APP_FILTER_PAGE_SIZE) {
      break;
    }

    offset += APP_FILTER_PAGE_SIZE;
  }

  return {
    appids: [...appids],
    pagesFetched,
  };
}
