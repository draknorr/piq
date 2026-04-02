import 'server-only';

import { buildQueryAnalyticsSufficiencyMetadata } from '@/lib/chat/discovery-guardrails';
import {
  attachToolExecutionProvenance,
  type ChatExecutionProvenanceOverride,
} from '@/lib/chat/execution-trace';
import { postToQueryApi } from '@/lib/query-api-client';
import type { ToolResultShape, ToolSufficiencyMetadata } from '@/lib/llm/types';

interface CubeFilter {
  member: string;
  operator: string;
  values?: Array<string | number | boolean>;
}

export interface QueryAnalyticsArgs {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: CubeFilter[];
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  reasoning?: string;
}

interface QueryAnalyticsResult extends ToolSufficiencyMetadata {
  success: boolean;
  cached?: boolean;
  data: Record<string, unknown>[];
  debug?: {
    cubeQuery?: Record<string, unknown>;
    filters?: unknown[];
    limit?: number;
    order?: Record<string, string>;
    resultShape?: ToolResultShape;
    sufficientToAnswer?: boolean;
    sufficiencyReason?: string;
    tigerCompatContract?: string;
  };
  error?: string;
  rowCount: number;
}

interface SearchCatalogResponse {
  items?: Array<{
    appType?: string | null;
    appid: number;
    ccuPeak?: number | null;
    developerIds?: number[];
    developers?: string[];
    discountPercent?: number | null;
    isFree: boolean;
    isReleased?: boolean | null;
    name: string;
    ownersMidpoint?: number | null;
    parentAppid?: number | null;
    platforms?: string[];
    priceCents?: number | null;
    publisherIds?: number[];
    publishers?: string[];
    releaseDate?: string | null;
    releaseState?: string | null;
    releaseYear?: number | null;
    reviewScore?: number | null;
    totalReviews?: number | null;
  }>;
}

type SearchCatalogResponseItem = NonNullable<SearchCatalogResponse['items']>[number];

interface GetEntityOverviewResponse {
  entity: {
    details: {
      appType?: string | null;
      developerIds?: number[];
      developers?: string[];
      discountPercent?: number | null;
      isFree?: boolean | null;
      isReleased?: boolean | null;
      parentAppid?: number | null;
      platforms?: string[];
      priceCents?: number | null;
      publisherIds?: number[];
      publishers?: string[];
      releaseDate?: string | null;
      releaseState?: string | null;
      releaseYear?: number | null;
    };
    displayName: string;
    entityKind: 'developer' | 'game' | 'publisher';
    metrics: {
      ccuPeak: number | null;
      gameCount: number | null;
      ownersMidpoint: number | null;
      reviewScore: number | null;
      totalReviews: number | null;
    };
    platformEntityId: string;
  };
  games: Array<{
    appid: number;
    name: string;
    ownersMidpoint: number | null;
    releaseDate: string | null;
    releaseYear: number | null;
    reviewScore: number | null;
    totalReviews: number | null;
  }>;
}

type GetEntityOverviewGame = GetEntityOverviewResponse['games'][number];

const TIGER_QUERY_ANALYTICS_SEARCH_CATALOG_PROVENANCE: ChatExecutionProvenanceOverride = {
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
    'Legacy query_analytics requests for compatible catalog patterns now execute through Tiger search-catalog.',
  recommendedTigerContracts: ['searchCatalog'],
};

const TIGER_QUERY_ANALYTICS_ENTITY_OVERVIEW_PROVENANCE: ChatExecutionProvenanceOverride = {
  backendKinds: ['tiger_query_api'],
  dataSources: [
    'query_api:getEntityOverview',
    'relation:apps',
    'relation:latest_daily_metrics',
    'relation:app_publishers',
    'relation:publishers',
    'relation:app_developers',
    'relation:developers',
  ],
  migrationDisposition: 'already_tiger',
  migrationNotes:
    'Legacy query_analytics requests for single-entity and company game-list patterns now execute through Tiger get-entity-overview.',
  recommendedTigerContracts: ['getEntityOverview'],
};

function dimensionFieldName(dimension: string): string {
  return dimension.includes('.') ? dimension.split('.').pop() ?? dimension : dimension;
}

function normalizeLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(value), maximum));
}

function getFilterValues(
  filters: CubeFilter[] | undefined,
  member: string,
  operator: string
): Array<string | number | boolean> | null {
  const match = filters?.find((filter) => filter.member === member && filter.operator === operator);
  return match?.values?.length ? match.values : null;
}

function getSingleNumericFilterValue(
  filters: CubeFilter[] | undefined,
  member: string,
  operator: string
): number | null {
  const value = getFilterValues(filters, member, operator)?.[0];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function hasSegment(segments: string[] | undefined, segment: string): boolean {
  return segments?.includes(segment) ?? false;
}

function sortRows(
  rows: Record<string, unknown>[],
  order: Record<string, 'asc' | 'desc'> | undefined
): Record<string, unknown>[] {
  const entries = Object.entries(order ?? {});
  if (entries.length === 0) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const [member, direction] of entries) {
      const field = dimensionFieldName(member);
      const leftValue = left[field];
      const rightValue = right[field];

      if (leftValue == null && rightValue == null) {
        continue;
      }
      if (leftValue == null) {
        return 1;
      }
      if (rightValue == null) {
        return -1;
      }

      let comparison = 0;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        comparison = leftValue - rightValue;
      } else {
        comparison = String(leftValue).localeCompare(String(rightValue));
      }

      if (comparison !== 0) {
        return direction === 'desc' ? -comparison : comparison;
      }
    }

    return 0;
  });
}

function buildTigerQueryAnalyticsResult(
  args: QueryAnalyticsArgs,
  data: Record<string, unknown>[],
  provenance: ChatExecutionProvenanceOverride,
  tigerCompatContract: string
): QueryAnalyticsResult {
  const sufficiency = buildQueryAnalyticsSufficiencyMetadata(args, data.length);

  return attachToolExecutionProvenance(
    {
      success: true,
      data: sortRows(data, args.order),
      rowCount: data.length,
      ...sufficiency,
      debug: {
        cubeQuery: {
          cube: args.cube,
          dimensions: args.dimensions,
          filters: args.filters,
          limit: args.limit,
          measures: args.measures,
          order: args.order,
          segments: args.segments,
        },
        filters: args.filters,
        limit: args.limit,
        order: args.order,
        resultShape: sufficiency.result_shape,
        sufficientToAnswer: sufficiency.sufficient_to_answer,
        sufficiencyReason: sufficiency.sufficiency_reason,
        tigerCompatContract,
      },
    },
    provenance
  );
}

function buildSearchCatalogRequestFromGameCatalog(args: QueryAnalyticsArgs): Record<string, unknown> | null {
  const filters = args.filters ?? [];
  const unsupportedSegments = (args.segments ?? []).filter(
    (segment) =>
      ![
        'GameCatalog.free',
        'GameCatalog.highlyRated',
        'GameCatalog.onSale',
        'GameCatalog.overwhelminglyPositive',
        'GameCatalog.paid',
        'GameCatalog.released',
        'GameCatalog.veryPositive',
      ].includes(segment)
  );

  if (unsupportedSegments.length > 0) {
    return null;
  }

  const request: Record<string, unknown> = {
    limit: normalizeLimit(args.limit, 20, 50),
  };

  const appid = getSingleNumericFilterValue(filters, 'GameCatalog.appid', 'equals');
  if (appid != null) {
    request.appids = [appid];
  }

  const publisherId = getSingleNumericFilterValue(filters, 'GameCatalog.publisherId', 'equals');
  if (publisherId != null) {
    request.publisherIds = [publisherId];
  }

  const developerId = getSingleNumericFilterValue(filters, 'GameCatalog.developerId', 'equals');
  if (developerId != null) {
    request.developerIds = [developerId];
  }

  const minReviews = getSingleNumericFilterValue(filters, 'GameCatalog.totalReviews', 'gte');
  if (minReviews != null) {
    request.minReviews = minReviews;
  }

  const minPriceDollars = getSingleNumericFilterValue(filters, 'GameCatalog.priceDollars', 'gte');
  if (minPriceDollars != null) {
    request.minPriceCents = Math.round(minPriceDollars * 100);
  }

  const maxPriceDollars = getSingleNumericFilterValue(filters, 'GameCatalog.priceDollars', 'lte');
  if (maxPriceDollars != null) {
    request.maxPriceCents = Math.round(maxPriceDollars * 100);
  }

  const minReviewScore = getSingleNumericFilterValue(filters, 'GameCatalog.reviewPercentage', 'gte');
  if (minReviewScore != null) {
    request.minReviewScore = minReviewScore;
  } else if (hasSegment(args.segments, 'GameCatalog.overwhelminglyPositive')) {
    request.minReviewScore = 95;
  } else if (hasSegment(args.segments, 'GameCatalog.veryPositive')) {
    request.minReviewScore = 90;
  } else if (hasSegment(args.segments, 'GameCatalog.highlyRated')) {
    request.minReviewScore = 80;
  }

  if (hasSegment(args.segments, 'GameCatalog.free')) {
    request.isFree = true;
  } else if (hasSegment(args.segments, 'GameCatalog.paid')) {
    request.isFree = false;
  }

  if (hasSegment(args.segments, 'GameCatalog.released')) {
    request.isReleased = true;
  }

  if (hasSegment(args.segments, 'GameCatalog.onSale')) {
    request.onSale = true;
  }

  const orderEntries = Object.entries(args.order ?? {});
  const firstOrderField = orderEntries[0]?.[0];
  if (firstOrderField === 'GameCatalog.releaseDate') {
    request.sortBy = 'release_date';
    request.sortDirection = orderEntries[0]?.[1] ?? 'desc';
  } else if (firstOrderField === 'GameCatalog.ownersMidpoint') {
    request.sortBy = 'owners';
    request.sortDirection = orderEntries[0]?.[1] ?? 'desc';
  } else if (firstOrderField === 'GameCatalog.ccuPeak') {
    request.sortBy = 'ccu_peak';
    request.sortDirection = orderEntries[0]?.[1] ?? 'desc';
  } else if (firstOrderField === 'GameCatalog.totalReviews' || firstOrderField === 'GameCatalog.reviewPercentage') {
    request.sortBy = 'reviews';
    request.sortDirection = orderEntries[0]?.[1] ?? 'desc';
  }

  const hasUnsupportedFilters = filters.some((filter) => {
    if (filter.member === 'GameCatalog.totalReviews' && filter.operator === 'set') {
      return false;
    }

    return ![
      'GameCatalog.appid',
      'GameCatalog.developerId',
      'GameCatalog.priceDollars',
      'GameCatalog.publisherId',
      'GameCatalog.reviewPercentage',
      'GameCatalog.totalReviews',
    ].includes(filter.member)
      || !['equals', 'gte', 'lte', 'set'].includes(filter.operator);
  });

  return hasUnsupportedFilters ? null : request;
}

function mapSearchCatalogItemToGameCatalogRow(item: SearchCatalogResponseItem): Record<string, unknown> {
  return {
    appid: item.appid,
    ccuPeak: item.ccuPeak ?? null,
    developerId: item.developerIds?.[0] ?? null,
    developerName: item.developers?.[0] ?? null,
    discountPercent: item.discountPercent ?? null,
    isFree: item.isFree,
    isReleased: item.isReleased ?? null,
    name: item.name,
    ownersMidpoint: item.ownersMidpoint ?? null,
    parentAppid: item.parentAppid ?? null,
    platforms: item.platforms?.join(', ') ?? null,
    priceCents: item.priceCents ?? null,
    priceDollars: typeof item.priceCents === 'number' ? Number((item.priceCents / 100).toFixed(2)) : null,
    publisherId: item.publisherIds?.[0] ?? null,
    publisherName: item.publishers?.[0] ?? null,
    releaseDate: item.releaseDate ?? null,
    releaseState: item.releaseState ?? null,
    releaseYear: item.releaseYear ?? null,
    reviewPercentage: item.reviewScore ?? null,
    steamDeckCategory: null,
    totalReviews: item.totalReviews ?? null,
    type: item.appType ?? null,
  };
}

function mapEntityOverviewGameRow(
  item: GetEntityOverviewGame,
  entity: GetEntityOverviewResponse['entity']
): Record<string, unknown> {
  const baseName = entity.entityKind === 'developer' ? 'developer' : 'publisher';
  return {
    appid: item.appid,
    gameName: item.name,
    [`${baseName}Id`]: Number(entity.platformEntityId),
    [`${baseName}Name`]: entity.displayName,
    owners: item.ownersMidpoint ?? null,
    releaseDate: item.releaseDate ?? null,
    releaseYear: item.releaseYear ?? null,
    reviewPercentage: item.reviewScore ?? null,
    totalReviews: item.totalReviews ?? null,
  };
}

function mapEntityOverviewMetricRow(entity: GetEntityOverviewResponse['entity']): Record<string, unknown> {
  const baseName = entity.entityKind === 'developer' ? 'developer' : 'publisher';
  return {
    [`${baseName}Id`]: Number(entity.platformEntityId),
    [`${baseName}Name`]: entity.displayName,
    avgReviewScore: entity.metrics.reviewScore ?? null,
    gameCount: entity.metrics.gameCount ?? null,
    totalOwners: entity.metrics.ownersMidpoint ?? null,
    totalReviews: entity.metrics.totalReviews ?? null,
  };
}

async function tryGameCatalogCompat(args: QueryAnalyticsArgs): Promise<QueryAnalyticsResult | null> {
  const request = buildSearchCatalogRequestFromGameCatalog(args);
  if (!request) {
    return null;
  }

  const appids = Array.isArray(request.appids) ? request.appids : null;
  if (appids?.length === 1) {
    const overviewResponse = await postToQueryApi<GetEntityOverviewResponse>(
      '/v1/contracts/get-entity-overview',
      {
        entityKind: 'game',
        gamesLimit: 0,
        platformEntityId: String(appids[0]),
      }
    );

    if (!overviewResponse.ok || !overviewResponse.data) {
      return null;
    }

    const item = overviewResponse.data.entity;
    const row = mapSearchCatalogItemToGameCatalogRow({
      appid: Number(item.platformEntityId),
      ccuPeak: item.metrics.ccuPeak,
      developerIds: item.details.developerIds,
      developers: item.details.developers,
      discountPercent: item.details.discountPercent,
      isFree: item.details.isFree ?? false,
      isReleased: item.details.isReleased,
      name: item.displayName,
      ownersMidpoint: item.metrics.ownersMidpoint,
      parentAppid: item.details.parentAppid,
      platforms: item.details.platforms,
      priceCents: item.details.priceCents,
      publisherIds: item.details.publisherIds,
      publishers: item.details.publishers,
      releaseDate: item.details.releaseDate,
      releaseState: item.details.releaseState,
      releaseYear: item.details.releaseYear,
      reviewScore: item.metrics.reviewScore,
      totalReviews: item.metrics.totalReviews,
      appType: item.details.appType,
    });

    return buildTigerQueryAnalyticsResult(
      args,
      [row],
      TIGER_QUERY_ANALYTICS_ENTITY_OVERVIEW_PROVENANCE,
      'getEntityOverview'
    );
  }

  const response = await postToQueryApi<SearchCatalogResponse>('/v1/contracts/search-catalog', request);
  if (!response.ok || !response.data) {
    return null;
  }
  const data = response.data;

  return buildTigerQueryAnalyticsResult(
    args,
    (data.items ?? []).map(mapSearchCatalogItemToGameCatalogRow),
    TIGER_QUERY_ANALYTICS_SEARCH_CATALOG_PROVENANCE,
    'searchCatalog'
  );
}

async function tryCompanyGameCompat(args: QueryAnalyticsArgs): Promise<QueryAnalyticsResult | null> {
  const cube = args.cube;
  const isDeveloper = cube === 'DeveloperGameMetrics';
  const isPublisher = cube === 'PublisherGameMetrics';
  if (!isDeveloper && !isPublisher) {
    return null;
  }

  const entityKind = isDeveloper ? 'developer' : 'publisher';
  const filterMember = `${cube}.${entityKind}Id`;
  const entityId = getSingleNumericFilterValue(args.filters, filterMember, 'equals');
  if (entityId == null) {
    return null;
  }

  const orderEntries = Object.entries(args.order ?? {});
  const gamesSortBy =
    orderEntries[0]?.[0] === `${cube}.totalReviews` ? 'reviews' : 'release_date';
  const response = await postToQueryApi<GetEntityOverviewResponse>(
    '/v1/contracts/get-entity-overview',
    {
      entityKind,
      gamesLimit: normalizeLimit(args.limit, 10, 25),
      gamesSortBy,
      platformEntityId: String(entityId),
    }
  );

  if (!response.ok || !response.data) {
    return null;
  }
  const data = response.data;

  return buildTigerQueryAnalyticsResult(
    args,
    data.games.map((item) => mapEntityOverviewGameRow(item, data.entity)),
    TIGER_QUERY_ANALYTICS_ENTITY_OVERVIEW_PROVENANCE,
    'getEntityOverview'
  );
}

async function tryCompanyMetricCompat(args: QueryAnalyticsArgs): Promise<QueryAnalyticsResult | null> {
  const cube = args.cube;
  const isDeveloper = cube === 'DeveloperMetrics';
  const isPublisher = cube === 'PublisherMetrics';
  if (!isDeveloper && !isPublisher) {
    return null;
  }

  const entityKind = isDeveloper ? 'developer' : 'publisher';
  const filterMember = `${cube}.${entityKind}Id`;
  const entityId = getSingleNumericFilterValue(args.filters, filterMember, 'equals');
  if (entityId == null) {
    return null;
  }

  const response = await postToQueryApi<GetEntityOverviewResponse>(
    '/v1/contracts/get-entity-overview',
    {
      entityKind,
      gamesLimit: 0,
      platformEntityId: String(entityId),
    }
  );

  if (!response.ok || !response.data) {
    return null;
  }
  const data = response.data;

  return buildTigerQueryAnalyticsResult(
    args,
    [mapEntityOverviewMetricRow(data.entity)],
    TIGER_QUERY_ANALYTICS_ENTITY_OVERVIEW_PROVENANCE,
    'getEntityOverview'
  );
}

export async function tryTigerQueryAnalyticsCompat(
  args: QueryAnalyticsArgs
): Promise<QueryAnalyticsResult | null> {
  if (args.cube === 'GameCatalog') {
    return tryGameCatalogCompat(args);
  }

  if (args.cube === 'DeveloperGameMetrics' || args.cube === 'PublisherGameMetrics') {
    return tryCompanyGameCompat(args);
  }

  if (args.cube === 'DeveloperMetrics' || args.cube === 'PublisherMetrics') {
    return tryCompanyMetricCompat(args);
  }

  return null;
}
