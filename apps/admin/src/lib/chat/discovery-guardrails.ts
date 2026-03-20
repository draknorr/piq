import type { ToolCall, ToolResultShape, ToolSufficiencyMetadata } from '@/lib/llm/types';
import { hasSpecificCompanyFilter, isCompanyCube } from '@/lib/chat/company-query-guardrails';

type Primitive = string | number | boolean;

export interface CubeLikeFilter {
  member: string;
  operator: string;
  values?: Primitive[];
}

export interface CubeLikeQuery {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: CubeLikeFilter[];
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
}

export interface SearchGamesLikeArgs {
  tags?: string[];
  genres?: string[];
  categories?: string[];
  platforms?: string[];
  controller_support?: string;
  steam_deck?: string[];
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
  order_by?: string;
}

export interface BroadDiscoveryState extends ToolSufficiencyMetadata {
  toolName: 'query_analytics' | 'search_games';
  signature?: string;
  dimensionFields?: string[];
}

const DISCOVERY_RUNTIME_CUBES = new Set(['Discovery', 'GameCatalog']);
const TIMESERIES_CUBES = new Set(['DailyMetrics', 'ReviewDeltas', 'MonthlyGameMetrics', 'MonthlyPublisherMetrics']);
const MULTI_SLICE_MARKERS = [
  /\balso\b/i,
  /\bplus\b/i,
  /\bas well\b/i,
  /\balong with\b/i,
  /\bin addition\b/i,
  /\btwo lists?\b/i,
  /\bseparate(?:ly)?\b/i,
  /\bcompare\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bboth\b/i,
];

const BROAD_DISCOVERY_QUALITY_MARKERS = [
  /\bgood reviews?\b/i,
  /\bgreat reviews?\b/i,
  /\bhighly rated\b/i,
  /\boverwhemingly positive\b/i,
  /\boverwhelmingly positive\b/i,
  /\bwell reviewed\b/i,
  /\bstrong reviews?\b/i,
];

function stripCubePrefix(value: string): string {
  return value.includes('.') ? value.split('.').pop() ?? value : value;
}

function normalizeValues(values?: Primitive[]): Primitive[] {
  if (!values) {
    return [];
  }

  return [...values]
    .map((value) => {
      if (typeof value !== 'string') {
        return value;
      }

      const numeric = Number(value);
      return Number.isFinite(numeric) && value.trim() !== '' ? numeric : value;
    })
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function normalizeFilterSignature(filters: CubeLikeFilter[] = []): string[] {
  return filters
    .map((filter) => ({
      member: stripCubePrefix(filter.member),
      operator: filter.operator,
      values: normalizeValues(filter.values),
    }))
    .sort((a, b) => {
      const left = `${a.member}:${a.operator}:${JSON.stringify(a.values)}`;
      const right = `${b.member}:${b.operator}:${JSON.stringify(b.values)}`;
      return left.localeCompare(right);
    })
    .map((filter) => `${filter.member}:${filter.operator}:${JSON.stringify(filter.values)}`);
}

function normalizeSegmentSignature(segments: string[] = []): string[] {
  return [...segments].map(stripCubePrefix).sort();
}

function normalizeOrderSignature(order: Record<string, 'asc' | 'desc'> = {}): Array<[string, 'asc' | 'desc']> {
  return Object.entries(order)
    .map(([member, direction]) => [stripCubePrefix(member), direction] as [string, 'asc' | 'desc'])
    .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
}

function normalizeDimensionFields(dimensions: string[] = []): string[] {
  return [...new Set(dimensions.map(stripCubePrefix))].sort();
}

function hasLookupStyleFilter(filters: CubeLikeFilter[] = []): boolean {
  return filters.some((filter) => {
    const member = stripCubePrefix(filter.member);
    if (!['appid', 'parentAppid', 'relationId', 'publisherId', 'developerId'].includes(member)) {
      return false;
    }

    return ['equals', 'notEquals', 'set', 'notSet', 'contains'].includes(filter.operator);
  });
}

function hasGameListDimensions(query: CubeLikeQuery): boolean {
  const dimensions = normalizeDimensionFields(query.dimensions);
  return dimensions.includes('appid') || dimensions.includes('name') || dimensions.includes('gameName');
}

function getReviewFloor(filters: CubeLikeFilter[] = []): number | null {
  const reviewFloorFilters = filters.filter((filter) =>
    stripCubePrefix(filter.member) === 'totalReviews' &&
    ['gte', 'gt'].includes(filter.operator)
  );

  if (reviewFloorFilters.length === 0) {
    return null;
  }

  const values = reviewFloorFilters
    .flatMap((filter) => normalizeValues(filter.values))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function isRuntimeBroadDiscoveryQuery(query: CubeLikeQuery): boolean {
  return DISCOVERY_RUNTIME_CUBES.has(query.cube) && hasGameListDimensions(query) && !hasLookupStyleFilter(query.filters);
}

function buildQuerySignature(query: CubeLikeQuery): string {
  return JSON.stringify({
    family: 'catalog',
    filters: normalizeFilterSignature(query.filters),
    segments: normalizeSegmentSignature(query.segments),
    order: normalizeOrderSignature(query.order),
    limit: query.limit ?? 50,
  });
}

function isStrictDimensionEnrichment(previousFields: string[] = [], nextFields: string[] = []): boolean {
  if (nextFields.length <= previousFields.length) {
    return false;
  }

  return previousFields.every((field) => nextFields.includes(field));
}

function hasExplicitMultiSliceIntent(userPrompt: string): boolean {
  return MULTI_SLICE_MARKERS.some((pattern) => pattern.test(userPrompt));
}

function hasBroadQualityDiscoveryIntent(userPrompt: string): boolean {
  return BROAD_DISCOVERY_QUALITY_MARKERS.some((pattern) => pattern.test(userPrompt));
}

function extractPromptReviewFloor(userPrompt: string): number | null {
  const matches = [
    userPrompt.match(/\b(\d+)\s*\+\s*reviews?\b/i),
    userPrompt.match(/\bat least\s+(\d+)\s+reviews?\b/i),
    userPrompt.match(/\bminimum of\s+(\d+)\s+reviews?\b/i),
    userPrompt.match(/\bover\s+(\d+)\s+reviews?\b/i),
    userPrompt.match(/\bmore than\s+(\d+)\s+reviews?\b/i),
  ].filter((match): match is RegExpMatchArray => Boolean(match));

  if (matches.length === 0) {
    return null;
  }

  const numericValues = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);

  return numericValues.length > 0 ? Math.max(...numericValues) : null;
}

function buildBroadDiscoveryReviewFloor(
  userPrompt: string,
  previousState: BroadDiscoveryState | null
): number | null {
  if (!hasBroadQualityDiscoveryIntent(userPrompt)) {
    return null;
  }

  const explicitFloor = extractPromptReviewFloor(userPrompt);
  if (explicitFloor !== null) {
    return explicitFloor;
  }

  return previousState?.allow_follow_up_relaxation ? 100 : 1000;
}

function withNormalizedSetFilter(filters: CubeLikeFilter[], member: string): CubeLikeFilter[] {
  const nextFilters = filters.filter((filter) =>
    !(stripCubePrefix(filter.member) === stripCubePrefix(member) && filter.operator === 'set')
  );
  nextFilters.push({ member, operator: 'set' });
  return nextFilters;
}

function withNormalizedReviewFloor(
  filters: CubeLikeFilter[],
  member: string,
  floor: number
): CubeLikeFilter[] {
  const nextFilters = filters.filter((filter) => {
    const sameMember = stripCubePrefix(filter.member) === stripCubePrefix(member);
    return !(sameMember && ['gt', 'gte'].includes(filter.operator));
  });

  nextFilters.push({ member, operator: 'gte', values: [floor] });
  return nextFilters;
}

function dedupeDimensions(dimensions: string[] = []): string[] {
  return [...new Set(dimensions)];
}

export function normalizeBroadDiscoveryToolCall(
  toolCall: ToolCall,
  userPrompt: string,
  previousState: BroadDiscoveryState | null
): ToolCall {
  const reviewFloor = buildBroadDiscoveryReviewFloor(userPrompt, previousState);

  if (toolCall.name === 'query_analytics') {
    const query = toolCall.arguments as unknown as CubeLikeQuery;
    if (!isRuntimeBroadDiscoveryQuery(query) || !hasBroadQualityDiscoveryIntent(userPrompt)) {
      return toolCall;
    }

    const totalReviewsMember = `${query.cube}.totalReviews`;
    const reviewPercentageMember = `${query.cube}.reviewPercentage`;
    const releaseDateMember = `${query.cube}.releaseDate`;
    let filters = [...(query.filters ?? [])];

    if (reviewFloor !== null) {
      filters = withNormalizedSetFilter(filters, totalReviewsMember);
      filters = withNormalizedReviewFloor(filters, totalReviewsMember, Math.max(reviewFloor, 100));
    }

    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        dimensions: dedupeDimensions([
          ...(query.dimensions ?? []),
          totalReviewsMember,
          reviewPercentageMember,
          releaseDateMember,
        ]),
        filters,
        order: {
          [totalReviewsMember]: 'desc',
          [reviewPercentageMember]: 'desc',
          [releaseDateMember]: 'desc',
        },
      },
    };
  }

  if (toolCall.name === 'search_games' && hasBroadQualityDiscoveryIntent(userPrompt)) {
    const args = toolCall.arguments as unknown as SearchGamesLikeArgs;
    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        min_reviews: reviewFloor !== null ? Math.max(reviewFloor, 100) : args.min_reviews,
        order_by: 'reviews',
      },
    };
  }

  return toolCall;
}

export function classifyQueryAnalyticsResultShape(query: CubeLikeQuery): ToolResultShape {
  if (isRuntimeBroadDiscoveryQuery(query)) {
    return 'broad_discovery';
  }

  if (TIMESERIES_CUBES.has(query.cube)) {
    return 'timeseries';
  }

  if (hasLookupStyleFilter(query.filters)) {
    return 'lookup';
  }

  if ((query.measures?.length ?? 0) > 0 && !hasGameListDimensions(query)) {
    return 'aggregation';
  }

  return 'other';
}

export function buildQueryAnalyticsSufficiencyMetadata(
  query: CubeLikeQuery,
  rowCount: number
): ToolSufficiencyMetadata {
  const resultShape = classifyQueryAnalyticsResultShape(query);

  if (isCompanyCube(query.cube)) {
    if (rowCount === 0 && hasSpecificCompanyFilter(query)) {
      return {
        result_shape: resultShape,
        sufficient_to_answer: true,
        sufficiency_reason: 'No qualifying rows returned for the resolved company under the current constraints. Respond with that limitation and do not broaden to unrelated companies.',
      };
    }

    if (rowCount > 0 && rowCount <= 3) {
      return {
        result_shape: resultShape,
        sufficient_to_answer: true,
        sufficiency_reason: 'Returned a sparse but answerable company result. Respond directly and say the qualifying set is small if helpful.',
      };
    }
  }

  if (resultShape === 'broad_discovery' && isRuntimeBroadDiscoveryQuery(query)) {
    const reviewFloor = getReviewFloor(query.filters);
    const shouldRelaxHighFloor = reviewFloor !== null && reviewFloor >= 1000 && rowCount > 0 && rowCount < 8;
    const shouldStopAtLowFloor = reviewFloor !== null && reviewFloor >= 100 && rowCount > 0 && rowCount < 5;
    const allowRelaxation = rowCount === 0
      ? reviewFloor !== null && reviewFloor >= 1000
      : shouldRelaxHighFloor;

    if (rowCount === 0) {
      if (reviewFloor !== null && reviewFloor >= 100) {
        return {
          result_shape: resultShape,
          sufficient_to_answer: reviewFloor < 1000,
          sufficiency_reason: reviewFloor < 1000
            ? 'No qualifying rows met the current hard constraints at the minimum 100-review floor. Respond directly and say that the qualifying set is empty under these filters.'
            : 'No qualifying rows returned at the current review-count floor. One relaxation retry is allowed.',
          allow_follow_up_relaxation: reviewFloor >= 1000 || undefined,
        };
      }

      return {
        result_shape: resultShape,
        sufficient_to_answer: false,
        sufficiency_reason: allowRelaxation
          ? 'No qualifying rows returned at the current review-count floor. One relaxation retry is allowed.'
          : 'No qualifying rows returned.',
        allow_follow_up_relaxation: allowRelaxation || undefined,
      };
    }

    if (shouldRelaxHighFloor) {
      return {
        result_shape: resultShape,
        sufficient_to_answer: false,
        sufficiency_reason: 'Returned too few rows for a high review-count floor. One relaxation retry is allowed.',
        allow_follow_up_relaxation: true,
      };
    }

    if (shouldStopAtLowFloor) {
      return {
        result_shape: resultShape,
        sufficient_to_answer: true,
        sufficiency_reason: 'Returned only a small number of high-signal rows after relaxing to the 100-review floor. Respond directly, keep the list sparse, and say the qualifying set is limited under these filters.',
      };
    }

    return {
      result_shape: resultShape,
      sufficient_to_answer: true,
      sufficiency_reason: rowCount <= 5
        ? 'Returned a sparse but answerable discovery result. Respond and explicitly say the set is sparse.'
        : 'Returned enough qualifying discovery rows to answer directly. Respond without another adjacent discovery query.',
    };
  }

  return {
    result_shape: resultShape,
    sufficient_to_answer: rowCount > 0,
    sufficiency_reason: rowCount > 0
      ? 'Returned enough data to answer the request directly.'
      : 'No qualifying rows returned.',
  };
}

export function buildSearchGamesSufficiencyMetadata(
  args: SearchGamesLikeArgs,
  resultCount: number,
  coverageComplete: boolean,
  sparseResult: boolean
): ToolSufficiencyMetadata {
  const hasExplicitReviewFloor = typeof args.min_reviews === 'number' && args.min_reviews > 0;

  if (resultCount === 0) {
    return {
      result_shape: 'broad_discovery',
      sufficient_to_answer: hasExplicitReviewFloor && args.min_reviews !== undefined && args.min_reviews >= 100,
      sufficiency_reason: hasExplicitReviewFloor
        ? args.min_reviews !== undefined && args.min_reviews >= 100
          ? 'No qualifying rows met the current hard constraints at the minimum review-count floor. Respond directly and say the qualifying set is empty under these filters.'
          : 'No qualifying rows returned at the current review-count floor.'
        : 'No qualifying rows returned.',
    };
  }

  if (sparseResult) {
    return {
      result_shape: 'broad_discovery',
      sufficient_to_answer: true,
      sufficiency_reason: 'Returned all qualifying rows and the result set is sparse. Respond and explicitly say the set is sparse.',
    };
  }

  if (coverageComplete) {
    return {
      result_shape: 'broad_discovery',
      sufficient_to_answer: true,
      sufficiency_reason: 'Returned enough qualifying search results to answer directly.',
    };
  }

  return {
    result_shape: 'broad_discovery',
    sufficient_to_answer: true,
    sufficiency_reason: 'Returned relevant search results. Respond using these rows instead of issuing another adjacent discovery query.',
  };
}

export function extractBroadDiscoveryState(
  toolName: string,
  toolArguments: Record<string, unknown>,
  result: Record<string, unknown>
): BroadDiscoveryState | null {
  const resultShape = result.result_shape;
  if (resultShape !== 'broad_discovery') {
    return null;
  }

  const sufficientToAnswer = result.sufficient_to_answer;
  if (typeof sufficientToAnswer !== 'boolean') {
    return null;
  }

  if (toolName === 'query_analytics') {
    const query = toolArguments as unknown as CubeLikeQuery;
    if (!isRuntimeBroadDiscoveryQuery(query)) {
      return null;
    }

    return {
      toolName: 'query_analytics',
      result_shape: 'broad_discovery',
      sufficient_to_answer: sufficientToAnswer,
      sufficiency_reason: typeof result.sufficiency_reason === 'string' ? result.sufficiency_reason : undefined,
      allow_follow_up_relaxation: result.allow_follow_up_relaxation === true,
      signature: buildQuerySignature(query),
      dimensionFields: normalizeDimensionFields(query.dimensions),
    };
  }

  if (toolName === 'search_games') {
    return {
      toolName: 'search_games',
      result_shape: 'broad_discovery',
      sufficient_to_answer: sufficientToAnswer,
      sufficiency_reason: typeof result.sufficiency_reason === 'string' ? result.sufficiency_reason : undefined,
      allow_follow_up_relaxation: result.allow_follow_up_relaxation === true,
    };
  }

  return null;
}

function isBroadDiscoveryToolCall(toolCall: ToolCall): boolean {
  if (toolCall.name === 'search_games') {
    return true;
  }

  if (toolCall.name !== 'query_analytics') {
    return false;
  }

  return isRuntimeBroadDiscoveryQuery(toolCall.arguments as unknown as CubeLikeQuery);
}

export function buildRedundantDiscoverySkipResult(
  previousState: BroadDiscoveryState | null,
  toolCall: ToolCall,
  userPrompt: string
): { success: boolean; error?: string; [key: string]: unknown } | null {
  if (!previousState || !previousState.sufficient_to_answer || previousState.allow_follow_up_relaxation) {
    return null;
  }

  if (!isBroadDiscoveryToolCall(toolCall)) {
    return null;
  }

  if (hasExplicitMultiSliceIntent(userPrompt)) {
    return null;
  }

  if (previousState.toolName === 'query_analytics' && toolCall.name === 'query_analytics') {
    const nextQuery = toolCall.arguments as unknown as CubeLikeQuery;
    const nextSignature = buildQuerySignature(nextQuery);
    const nextDimensionFields = normalizeDimensionFields(nextQuery.dimensions);

    if (
      previousState.signature === nextSignature &&
      isStrictDimensionEnrichment(previousState.dimensionFields, nextDimensionFields)
    ) {
      return null;
    }
  }

  return {
    success: true,
    skipped_redundant_query: true,
    result_shape: 'broad_discovery',
    sufficient_to_answer: true,
    sufficiency_reason: 'The previous broad discovery result already answered the request. Respond using those rows instead of running another adjacent discovery query.',
    debug: {
      redundantDiscoveryQueryBlocked: true,
      redundantDiscoveryBlockReason: `Blocked redundant ${toolCall.name} call after a sufficient broad discovery result.`,
    },
  };
}
