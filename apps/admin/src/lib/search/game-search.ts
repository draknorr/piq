/**
 * Game Search Service
 *
 * System-only compatibility wrapper for the legacy `search_games` tool shape.
 */

import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { buildSearchGamesSufficiencyMetadata } from '@/lib/chat/discovery-guardrails';
import { buildTigerPrimaryResultSet } from '@/lib/chat/result-set-continuation';
import type { ToolSufficiencyMetadata } from '@/lib/llm/types';
import { postToQueryApi } from '@/lib/query-api-client';

const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 20;

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

export interface SearchDebugInfo {
  input_args: SearchGamesArgs;
  steps: string[];
  coverage_complete?: boolean;
  sparse_result?: boolean;
  resultShape?: ToolSufficiencyMetadata['result_shape'];
  sufficientToAnswer?: boolean;
  sufficiencyReason?: string;
}

export interface SearchGamesResult extends ToolSufficiencyMetadata {
  success: boolean;
  results?: GameSearchResult[];
  total_found?: number;
  filters_applied?: string[];
  coverage_complete?: boolean;
  sparse_result?: boolean;
  debug?: SearchDebugInfo;
  error?: string;
  unavailable?: boolean;
}

interface TigerSearchCatalogResponse {
  continuationToken: string | null;
  items?: Array<{
    appid: number;
    developers?: string[];
    isFree: boolean;
    name: string;
    platforms?: string[];
    priceCents?: number | null;
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
    'search_games now executes only through the system search-catalog for the supported typed filter set.',
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

function toPriceDollars(priceCents: number | null | undefined): number | null {
  if (typeof priceCents !== 'number') {
    return null;
  }

  return Number((priceCents / 100).toFixed(2));
}

function buildSearchGamesFiltersApplied(args: SearchGamesArgs): string[] {
  const filtersApplied: string[] = [];

  if (args.tags?.length) filtersApplied.push(`tags: ${args.tags.join(', ')}`);
  if (args.genres?.length) filtersApplied.push(`genres: ${args.genres.join(', ')}`);
  if (args.categories?.length) filtersApplied.push(`categories: ${args.categories.join(', ')}`);
  if (args.platforms?.length) filtersApplied.push(`platforms: ${args.platforms.join(', ')}`);
  if (args.controller_support) filtersApplied.push(`controller_support: ${args.controller_support}`);
  if (args.steam_deck?.length) filtersApplied.push(`steam_deck: ${args.steam_deck.join(', ')}`);
  if (args.release_year?.gte !== undefined) filtersApplied.push(`release_year >= ${args.release_year.gte}`);
  if (args.release_year?.lte !== undefined) filtersApplied.push(`release_year <= ${args.release_year.lte}`);
  if (args.review_percentage?.gte !== undefined) {
    filtersApplied.push(`review_percentage >= ${args.review_percentage.gte}`);
  }
  if (args.min_reviews !== undefined) filtersApplied.push(`min_reviews >= ${args.min_reviews}`);
  if (args.metacritic_score?.gte !== undefined) {
    filtersApplied.push(`metacritic_score >= ${args.metacritic_score.gte}`);
  }
  if (args.min_price_cents !== undefined) filtersApplied.push(`min_price_cents >= ${args.min_price_cents}`);
  if (args.max_price_cents !== undefined) filtersApplied.push(`max_price_cents <= ${args.max_price_cents}`);
  if (args.is_free !== undefined) filtersApplied.push(`is_free: ${args.is_free}`);
  if (args.on_sale === true) filtersApplied.push('on_sale: true');
  if (args.min_discount_percent !== undefined) {
    filtersApplied.push(`min_discount_percent >= ${args.min_discount_percent}`);
  }

  return filtersApplied;
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
    priceDollars: toPriceDollars(item.priceCents),
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
          'Search wrapper routed search_games to searchCatalog.',
          `Returned ${results.length} row(s).`,
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

export async function searchGames(args: SearchGamesArgs): Promise<SearchGamesResult> {
  try {
    const actualLimit = Math.min(args.limit ?? DEFAULT_RESULTS, MAX_RESULTS);
    const tigerResult = await tryTigerSearchGames(args, actualLimit);
    if (tigerResult) {
      return tigerResult;
    }

    return {
      success: false,
      unavailable: true,
      filters_applied: buildSearchGamesFiltersApplied(args),
      coverage_complete: false,
      sparse_result: false,
      debug: {
        input_args: args,
        steps: ['Legacy search_games fallback path is disabled.'],
        coverage_complete: false,
        sparse_result: false,
      },
      error:
        'Search-catalog could not serve this search_games request. Rephrase using supported catalog filters or a narrower game discovery prompt.',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search games',
      debug: {
        input_args: args,
        steps: ['Search_games execution failed before producing a catalog response.'],
        coverage_complete: false,
        sparse_result: false,
      },
    };
  }
}
