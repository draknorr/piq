import type { ToolCall, ToolSufficiencyMetadata } from '@/lib/llm/types';
import { isCompanyCube } from '@/lib/chat/company-query-guardrails';
import { getServiceSupabase } from '@/lib/supabase-service';

type Primitive = string | number | boolean;
type CompanyEntityType = 'publisher' | 'developer';
type CompanyWindowSegment = 'lastYear' | 'last6Months' | 'last3Months' | 'last30Days';

interface QueryAnalyticsArgs {
  cube: string;
  dimensions?: string[];
  measures?: string[];
  filters?: Array<{ member: string; operator: string; values?: Primitive[] }>;
  segments?: string[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  reasoning?: string;
}

interface SimilarityArgs {
  entity_type: 'game' | 'publisher' | 'developer';
  reference_id?: number;
  reference_name?: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

interface RepresentativeTitle {
  appid: number;
  name: string;
  totalReviews: number;
  reviewPercentage: number | null;
  releaseDate: string | null;
}

interface CompanyResultShape {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>[];
  rowCount?: number;
  results?: Record<string, unknown>[];
  total_found?: number;
  sufficient_to_answer?: boolean;
  sufficiency_reason?: string;
  [key: string]: unknown;
}

export type CompanyIntentFamily =
  | 'company_count_profile'
  | 'portfolio_top_titles'
  | 'time_window_ranking'
  | 'constrained_company_screen'
  | 'relationship_screen'
  | 'company_similarity';

export interface CompanyAnswerState {
  family: CompanyIntentFamily;
  blockFurtherTools: boolean;
  reason: string;
}

const MULTI_SLICE_MARKERS = [
  /\balso\b/i,
  /\bplus\b/i,
  /\bas well\b/i,
  /\balong with\b/i,
  /\bin addition\b/i,
  /\bboth\b/i,
  /\bcompare\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
];

const GENERIC_RELATIONSHIP_LOOKUPS = new Set([
  'indie',
  'indie developer',
  'indie developers',
  'indie publisher',
  'indie publishers',
  'self published',
  'self-published',
  'external',
  'external devs',
  'external developers',
  'external publishers',
  'publisher',
  'publishers',
  'developer',
  'developers',
]);

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().trim();
}

function normalizeLookupQuery(query: string): string {
  return normalizePrompt(query).replace(/[^a-z0-9]+/g, ' ').trim();
}

function inferCompanyEntityType(
  prompt: string,
  args?: QueryAnalyticsArgs
): CompanyEntityType | null {
  const text = normalizePrompt(prompt);

  if (/\bpublisher(s)?\b/.test(text)) return 'publisher';
  if (/\bdeveloper(s)?\b/.test(text)) return 'developer';

  switch (args?.cube) {
    case 'PublisherMetrics':
    case 'PublisherYearMetrics':
    case 'PublisherGameMetrics':
    case 'PublisherRelationshipMetrics':
    case 'PublisherChatScreenMetrics':
    case 'PublisherChatWindowMetrics':
      return 'publisher';
    case 'DeveloperMetrics':
    case 'DeveloperYearMetrics':
    case 'DeveloperGameMetrics':
    case 'DeveloperRelationshipMetrics':
    case 'DeveloperChatScreenMetrics':
    case 'DeveloperChatWindowMetrics':
      return 'developer';
    default:
      return null;
  }
}

function extractPercentThreshold(prompt: string): number | null {
  const match = normalizePrompt(prompt).match(/(\d{2,3})\s*%/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractGameCountThreshold(prompt: string): number | null {
  const match = normalizePrompt(prompt).match(/(\d+)\s*\+\s*games?/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractYear(prompt: string): number | null {
  const match = normalizePrompt(prompt).match(/\b(20\d{2})\b/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectTimeWindow(
  prompt: string
): { type: 'year'; year: number } | { type: 'segment'; segment: CompanyWindowSegment } | null {
  const text = normalizePrompt(prompt);
  const year = extractYear(text);
  const currentYear = new Date().getFullYear();

  if (/\bthis year\b/.test(text)) {
    return { type: 'year', year: currentYear };
  }

  if (/\blast year\b/.test(text)) {
    return { type: 'year', year: currentYear - 1 };
  }

  if (/\bpast 6 months\b|\blast 6 months\b/.test(text)) {
    return { type: 'segment', segment: 'last6Months' };
  }

  if (/\bpast 3 months\b|\blast 3 months\b/.test(text)) {
    return { type: 'segment', segment: 'last3Months' };
  }

  if (/\bpast 30 days\b|\blast 30 days\b|\bpast month\b|\blast month\b/.test(text)) {
    return { type: 'segment', segment: 'last30Days' };
  }

  if (/\bpast year\b|\bpast 12 months\b|\bwithin the past year\b/.test(text)) {
    return { type: 'segment', segment: 'lastYear' };
  }

  if (year !== null && /\breleased\b|\breleases\b/.test(text)) {
    return { type: 'year', year };
  }

  return null;
}

export function classifyCompanyIntent(prompt: string): CompanyIntentFamily | null {
  const text = normalizePrompt(prompt);

  if (
    /\bhow many games has\b/.test(text) &&
    /\b(published|developed|released|made)\b/.test(text)
  ) {
    return 'company_count_profile';
  }

  if (
    (/\btop games?\b/.test(text) || /\bbest games?\b/.test(text)) &&
    /\b(from|by)\b/.test(text)
  ) {
    return 'portfolio_top_titles';
  }

  if (
    /\b(indie|self[- ]published|external devs|external developers|external publishers|multi[- ]publisher)\b/.test(text)
  ) {
    return 'relationship_screen';
  }

  if (
    /\b(similar to|like)\b/.test(text) &&
    /\b(publisher|publishers|developer|developers|studio|studios|company|companies)\b/.test(text)
  ) {
    return 'company_similarity';
  }

  if (
    /\b(publisher|publishers|developer|developers)\b/.test(text) &&
    /\b(most games|releasing the most|released the most)\b/.test(text) &&
    detectTimeWindow(text)
  ) {
    return 'time_window_ranking';
  }

  if (
    /\b(publisher|publishers|developer|developers)\b/.test(text) &&
    /\bwith\b/.test(text) &&
    /\b\d+\s*\+\s*games?\b/.test(text)
  ) {
    return 'constrained_company_screen';
  }

  return null;
}

function buildCompanyIdNameDimensions(
  entityType: CompanyEntityType,
  cube: string
): string[] {
  return entityType === 'publisher'
    ? [`${cube}.publisherId`, `${cube}.publisherName`]
    : [`${cube}.developerId`, `${cube}.developerName`];
}

function normalizeReasoning(family: CompanyIntentFamily, prompt: string): string {
  switch (family) {
    case 'relationship_screen':
      return `Use the chat-only company screen surface to answer the relationship query exactly: ${prompt}`;
    case 'time_window_ranking':
      return `Use the chat-only company window surface to answer the rolling-window ranking with meaningful-release context: ${prompt}`;
    case 'constrained_company_screen':
      return `Use the chat-only company window surface to enforce universal company constraints exactly: ${prompt}`;
    default:
      return prompt;
  }
}

function windowSuffix(segment: CompanyWindowSegment): 'Last30Days' | 'Last3Months' | 'Last6Months' | 'LastYear' {
  switch (segment) {
    case 'last30Days':
      return 'Last30Days';
    case 'last3Months':
      return 'Last3Months';
    case 'last6Months':
      return 'Last6Months';
    default:
      return 'LastYear';
  }
}

function buildWindowMetricMember(cube: string, field: string, segment: CompanyWindowSegment): string {
  return `${cube}.${field}${windowSuffix(segment)}`;
}

function wantsMultipleHitGames(prompt: string): boolean {
  const text = normalizePrompt(prompt);
  return /\bmultiple hit games\b|\b2\+\s*hit games\b|\btwo hit games\b/.test(text);
}

function rewriteRelationshipScreen(
  prompt: string,
  args: QueryAnalyticsArgs
): QueryAnalyticsArgs | null {
  const text = normalizePrompt(prompt);
  const entityType = inferCompanyEntityType(prompt, args);
  if (!entityType) {
    return null;
  }

  const cube = entityType === 'publisher' ? 'PublisherChatScreenMetrics' : 'DeveloperChatScreenMetrics';
  const dimensions = [
    ...buildCompanyIdNameDimensions(entityType, cube),
    `${cube}.exactGameCount`,
    `${cube}.releasedGameCount`,
    `${cube}.meaningfulGameCount`,
    `${cube}.hitGameCount`,
    `${cube}.totalReviews`,
    `${cube}.avgReviewPercentage`,
    `${cube}.indieConfidence`,
  ];
  const filters: NonNullable<QueryAnalyticsArgs['filters']> = [];

  if (/\bindie\b/.test(text)) {
    filters.push({ member: `${cube}.isIndieChat`, operator: 'equals', values: [true] });
  }

  if (/\bself[- ]published\b/.test(text)) {
    filters.push({ member: `${cube}.isSelfPublished`, operator: 'equals', values: [true] });
  }

  if (/\bexternal devs\b|\bexternal developers\b|\bexternal publishers\b/.test(text)) {
    filters.push({ member: `${cube}.worksWithExternalPartners`, operator: 'equals', values: [true] });
  }

  if (wantsMultipleHitGames(prompt)) {
    filters.push({ member: `${cube}.hitGameCount`, operator: 'gte', values: [2] });
  }

  const order: Record<string, 'desc'> = {};

  if (wantsMultipleHitGames(prompt)) {
    order[`${cube}.hitGameCount`] = 'desc';
    order[`${cube}.meaningfulGameCount`] = 'desc';
  } else if (/\bindie\b/.test(text)) {
    order[`${cube}.indieConfidence`] = 'desc';
    order[`${cube}.hitGameCount`] = 'desc';
  }

  order[`${cube}.totalReviews`] = 'desc';

  return {
    cube,
    dimensions,
    filters,
    order,
    limit: Math.min(args.limit ?? 10, 10),
    reasoning: normalizeReasoning('relationship_screen', prompt),
  };
}

function rewriteTimeWindowRanking(
  prompt: string,
  args: QueryAnalyticsArgs
): QueryAnalyticsArgs | null {
  const entityType = inferCompanyEntityType(prompt, args);
  const timeWindow = detectTimeWindow(prompt);

  if (!entityType || !timeWindow) {
    return null;
  }

  if (timeWindow.type === 'year') {
    const cube = entityType === 'publisher' ? 'PublisherYearMetrics' : 'DeveloperYearMetrics';
    const idNameDimensions = buildCompanyIdNameDimensions(entityType, cube);

    return {
      cube,
      dimensions: [
        ...idNameDimensions,
        `${cube}.gameCount`,
        `${cube}.totalReviews`,
        `${cube}.avgReviewScore`,
      ],
      filters: [
        { member: `${cube}.releaseYear`, operator: 'equals', values: [timeWindow.year] },
        { member: `${cube}.totalReviews`, operator: 'gte', values: [100] },
      ],
      order: {
        [`${cube}.gameCount`]: 'desc',
        [`${cube}.totalReviews`]: 'desc',
      },
      limit: Math.min(args.limit ?? 10, 10),
      reasoning: normalizeReasoning('time_window_ranking', prompt),
    };
  }

  const cube = entityType === 'publisher' ? 'PublisherChatWindowMetrics' : 'DeveloperChatWindowMetrics';
  const gamesField = buildWindowMetricMember(cube, entityType === 'publisher' ? 'gamesReleased' : 'gamesReleased', timeWindow.segment);
  const meaningfulField = buildWindowMetricMember(cube, 'meaningfulGamesReleased', timeWindow.segment);
  const totalReviewsField = buildWindowMetricMember(cube, 'totalReviews', timeWindow.segment);
  const avgField = buildWindowMetricMember(cube, 'avgReviewPercentage', timeWindow.segment);
  const minField = buildWindowMetricMember(cube, 'minReviewPercentage', timeWindow.segment);

  return {
    cube,
    dimensions: [
      ...buildCompanyIdNameDimensions(entityType, cube),
      `${cube}.exactGameCount`,
      gamesField,
      meaningfulField,
      totalReviewsField,
      avgField,
      minField,
    ],
    filters: [
      { member: meaningfulField, operator: 'gte', values: [1] },
    ],
    order: {
      [gamesField]: 'desc',
      [meaningfulField]: 'desc',
      [totalReviewsField]: 'desc',
    },
    limit: Math.min(args.limit ?? 10, 10),
    reasoning: normalizeReasoning('time_window_ranking', prompt),
  };
}

function rewriteConstrainedCompanyScreen(
  prompt: string,
  args: QueryAnalyticsArgs
): QueryAnalyticsArgs | null {
  const entityType = inferCompanyEntityType(prompt, args);
  const timeWindow = detectTimeWindow(prompt);
  const minGames = extractGameCountThreshold(prompt);
  const reviewPercentage = extractPercentThreshold(prompt);

  if (!entityType || !timeWindow || minGames === null || reviewPercentage === null) {
    return null;
  }

  if (timeWindow.type === 'year') {
    return null;
  }

  const cube = entityType === 'publisher' ? 'PublisherChatWindowMetrics' : 'DeveloperChatWindowMetrics';
  const gamesField = buildWindowMetricMember(cube, 'gamesReleased', timeWindow.segment);
  const meaningfulField = buildWindowMetricMember(cube, 'meaningfulGamesReleased', timeWindow.segment);
  const totalReviewsField = buildWindowMetricMember(cube, 'totalReviews', timeWindow.segment);
  const avgField = buildWindowMetricMember(cube, 'avgReviewPercentage', timeWindow.segment);
  const minField = buildWindowMetricMember(cube, 'minReviewPercentage', timeWindow.segment);

  return {
    cube,
    dimensions: [
      ...buildCompanyIdNameDimensions(entityType, cube),
      `${cube}.exactGameCount`,
      gamesField,
      meaningfulField,
      totalReviewsField,
      avgField,
      minField,
    ],
    filters: [
      { member: gamesField, operator: 'gte', values: [minGames] },
      { member: minField, operator: 'gte', values: [reviewPercentage] },
    ],
    order: {
      [gamesField]: 'desc',
      [totalReviewsField]: 'desc',
    },
    limit: Math.min(args.limit ?? 25, 25),
    reasoning: normalizeReasoning('constrained_company_screen', prompt),
  };
}

function normalizeCompanySimilarityToolCall(toolCall: ToolCall): ToolCall {
  if (toolCall.name !== 'find_similar') {
    return toolCall;
  }

  const args = toolCall.arguments as unknown as SimilarityArgs;
  if (args.entity_type === 'game') {
    return toolCall;
  }

  return {
    ...toolCall,
    arguments: {
      ...toolCall.arguments,
      limit: Math.min(args.limit ?? 6, 6),
    },
  };
}

export function normalizeCompanyToolCall(toolCall: ToolCall, userPrompt: string): ToolCall {
  const family = classifyCompanyIntent(userPrompt);
  if (!family) {
    return toolCall;
  }

  if (family === 'company_similarity' && toolCall.name === 'find_similar') {
    return normalizeCompanySimilarityToolCall(toolCall);
  }

  if (toolCall.name !== 'query_analytics') {
    return toolCall;
  }

  const args = toolCall.arguments as unknown as QueryAnalyticsArgs;

  let rewritten: QueryAnalyticsArgs | null = null;

  if (family === 'relationship_screen') {
    rewritten = rewriteRelationshipScreen(userPrompt, args);
  } else if (family === 'time_window_ranking') {
    rewritten = rewriteTimeWindowRanking(userPrompt, args);
  } else if (family === 'constrained_company_screen') {
    rewritten = rewriteConstrainedCompanyScreen(userPrompt, args);
  }

  if (!rewritten) {
    return toolCall;
  }

  return {
    ...toolCall,
    arguments: rewritten as unknown as Record<string, unknown>,
  };
}

function isCompanyTopTitlesQuery(toolCall: ToolCall): boolean {
  if (toolCall.name !== 'query_analytics') {
    return false;
  }

  const args = toolCall.arguments as unknown as QueryAnalyticsArgs;
  if (!['PublisherGameMetrics', 'DeveloperGameMetrics'].includes(args.cube)) {
    return false;
  }

  const dimensions = new Set(args.dimensions ?? []);
  return dimensions.has(`${args.cube}.gameName`) || dimensions.has(`${args.cube}.appid`);
}

function filterLowSignalTopTitles<T extends Record<string, unknown>>(result: T): T {
  const data = Array.isArray(result.data) ? result.data : [];
  if (data.length === 0) {
    return result;
  }

  const meaningfulRows = data.filter((row) => Number(row.totalReviews ?? 0) >= 100);
  const fallbackRows = meaningfulRows.length > 0
    ? meaningfulRows
    : data.filter((row) => Number(row.totalReviews ?? 0) > 0);

  const trimmedRows = (fallbackRows.length > 0 ? fallbackRows : data).slice(0, 8);
  const sparseTail = trimmedRows.length < 5;

  return {
    ...result,
    data: trimmedRows,
    rowCount: trimmedRows.length,
    sufficient_to_answer: true,
    sufficiency_reason: sparseTail
      ? 'Returned the strongest available company titles after filtering low-signal tail rows. Respond directly and say the qualifying set is sparse if helpful.'
      : 'Returned the strongest available company titles after filtering low-signal tail rows. Respond directly from these rows.',
  } as T;
}

function inferEntityTypeFromResultRows(rows: Record<string, unknown>[]): CompanyEntityType | null {
  if (rows.length === 0) {
    return null;
  }

  const sample = rows[0];
  if ('publisherId' in sample) {
    return 'publisher';
  }
  if ('developerId' in sample) {
    return 'developer';
  }

  return null;
}

function getCompanyIdFromRow(row: Record<string, unknown>, entityType: CompanyEntityType): number | null {
  const value = entityType === 'publisher' ? row.publisherId : row.developerId;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundReviewPercentage(positiveReviews: number | null, totalReviews: number): number | null {
  if (!Number.isFinite(totalReviews) || totalReviews <= 0 || positiveReviews === null) {
    return null;
  }

  return Math.round((positiveReviews / totalReviews) * 1000) / 10;
}

function isoDateDaysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

function lowerBoundForSegment(segment: CompanyWindowSegment | null): string | null {
  switch (segment) {
    case 'last30Days':
      return isoDateDaysAgo(30);
    case 'last3Months':
      return isoDateDaysAgo(91);
    case 'last6Months':
      return isoDateDaysAgo(183);
    case 'lastYear':
      return isoDateDaysAgo(365);
    default:
      return null;
  }
}

async function fetchRepresentativeTitles(
  entityType: CompanyEntityType,
  companyIds: number[],
  options: {
    segment?: CompanyWindowSegment | null;
    meaningfulOnly?: boolean;
    hitsOnly?: boolean;
    minReviewPercentage?: number | null;
    perCompany?: number;
  } = {}
): Promise<Map<number, RepresentativeTitle[]>> {
  const uniqueIds = [...new Set(companyIds)].filter((id) => Number.isFinite(id));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = getServiceSupabase();
  const table = entityType === 'publisher' ? 'publisher_game_metrics' : 'developer_game_metrics';
  const idColumn = entityType === 'publisher' ? 'publisher_id' : 'developer_id';
  const lowerBound = lowerBoundForSegment(options.segment ?? null);
  const perCompany = Math.max(1, Math.min(options.perCompany ?? 2, 3));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from(table as any) as any)
    .select(`${idColumn}, appid, game_name, release_date, total_reviews, positive_reviews, owners`)
    .in(idColumn, uniqueIds)
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(uniqueIds.length * 80, 160), 1500));

  if (lowerBound) {
    query = query.gte('release_date', lowerBound);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (query as any);
  if (error || !Array.isArray(data)) {
    return new Map();
  }

  const allRows = new Map<number, RepresentativeTitle[]>();
  const strictRows = new Map<number, RepresentativeTitle[]>();

  for (const row of data as Record<string, unknown>[]) {
    const companyId = Number(row[idColumn] ?? 0);
    const appid = Number(row.appid ?? 0);
    if (!Number.isFinite(companyId) || companyId <= 0 || !Number.isFinite(appid) || appid <= 0) {
      continue;
    }

    const totalReviews = Number(row.total_reviews ?? 0);
    const positiveReviews = row.positive_reviews === null ? null : Number(row.positive_reviews ?? 0);
    const owners = Number(row.owners ?? 0);
    const reviewPercentage = roundReviewPercentage(positiveReviews, totalReviews);
    const title: RepresentativeTitle = {
      appid,
      name: String(row.game_name ?? 'Unknown'),
      totalReviews,
      reviewPercentage,
      releaseDate: typeof row.release_date === 'string' ? row.release_date : null,
    };

    const allList = allRows.get(companyId) ?? [];
    if (!allList.some((entry) => entry.appid === appid)) {
      allList.push(title);
      allRows.set(companyId, allList);
    }

    const passesMeaningful = totalReviews >= 100 || owners >= 100000;
    const passesHits = totalReviews >= 1000 || owners >= 100000;
    const passesReviewFloor = options.minReviewPercentage === null || options.minReviewPercentage === undefined
      ? true
      : reviewPercentage !== null && reviewPercentage >= options.minReviewPercentage;
    const passesStrict = (!options.meaningfulOnly || passesMeaningful)
      && (!options.hitsOnly || passesHits)
      && passesReviewFloor;

    if (!passesStrict) {
      continue;
    }

    const strictList = strictRows.get(companyId) ?? [];
    if (!strictList.some((entry) => entry.appid === appid)) {
      strictList.push(title);
      strictRows.set(companyId, strictList);
    }
  }

  const output = new Map<number, RepresentativeTitle[]>();
  for (const companyId of uniqueIds) {
    const strict = (strictRows.get(companyId) ?? []).slice(0, perCompany);
    if (strict.length > 0) {
      output.set(companyId, strict);
      continue;
    }

    const fallback = (allRows.get(companyId) ?? [])
      .filter((title) => title.totalReviews > 0)
      .slice(0, perCompany);
    if (fallback.length > 0) {
      output.set(companyId, fallback);
      continue;
    }

    const rawFallback = (allRows.get(companyId) ?? []).slice(0, perCompany);
    if (rawFallback.length > 0) {
      output.set(companyId, rawFallback);
    }
  }

  return output;
}

function inferRepresentativeTitleOptions(
  family: CompanyIntentFamily,
  userPrompt: string
): {
  segment?: CompanyWindowSegment | null;
  meaningfulOnly?: boolean;
  hitsOnly?: boolean;
  minReviewPercentage?: number | null;
} {
  const timeWindow = detectTimeWindow(userPrompt);

  if (family === 'relationship_screen') {
    return {
      hitsOnly: wantsMultipleHitGames(userPrompt),
      meaningfulOnly: !wantsMultipleHitGames(userPrompt),
    };
  }

  if (family === 'time_window_ranking') {
    return {
      segment: timeWindow?.type === 'segment' ? timeWindow.segment : null,
      meaningfulOnly: true,
    };
  }

  if (family === 'constrained_company_screen') {
    return {
      segment: timeWindow?.type === 'segment' ? timeWindow.segment : null,
      meaningfulOnly: true,
      minReviewPercentage: extractPercentThreshold(userPrompt),
    };
  }

  if (family === 'company_count_profile') {
    return {
      meaningfulOnly: true,
    };
  }

  return {};
}

async function enrichCompanyRowsWithTitles(
  family: CompanyIntentFamily,
  userPrompt: string,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const entityType = inferEntityTypeFromResultRows(rows);
  if (!entityType) {
    return rows;
  }

  const ids = rows
    .map((row) => getCompanyIdFromRow(row, entityType))
    .filter((id): id is number => id !== null);
  if (ids.length === 0) {
    return rows;
  }

  const representativeTitles = await fetchRepresentativeTitles(
    entityType,
    ids,
    inferRepresentativeTitleOptions(family, userPrompt)
  );

  return rows.map((row) => {
    const companyId = getCompanyIdFromRow(row, entityType);
    if (companyId === null) {
      return row;
    }

    return {
      ...row,
      representativeTitles: representativeTitles.get(companyId) ?? [],
    };
  });
}

async function enrichSimilarityResultsWithTitles(
  result: CompanyResultShape
): Promise<CompanyResultShape> {
  const entityType = result.entityType === 'publisher' || result.entityType === 'developer'
    ? result.entityType
    : null;
  const rows = Array.isArray(result.results) ? result.results : [];

  if (!entityType || rows.length === 0) {
    return result;
  }

  const ids = rows
    .map((row) => Number(row.id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) {
    return result;
  }

  const representativeTitles = await fetchRepresentativeTitles(entityType, ids, {
    meaningfulOnly: true,
    perCompany: 2,
  });

  const trimmedResults = rows.slice(0, 6).map((row) => {
    const companyId = Number(row.id ?? 0);
    return {
      ...row,
      flagshipTitles: representativeTitles.get(companyId) ?? [],
    };
  });

  const sparse = trimmedResults.length < 3;
  const heuristic = result.mode === 'heuristic_portfolio';

  return {
    ...result,
    results: trimmedResults,
    sufficient_to_answer: trimmedResults.length > 0,
    sufficiency_reason: sparse
      ? heuristic
        ? 'Returned a sparse but precise heuristic portfolio-similarity set. Respond directly and label it as heuristic portfolio similarity.'
        : 'Returned a sparse but precise company similarity set. Respond directly and say the peer set is limited.'
      : heuristic
        ? 'Returned a precise heuristic portfolio-similarity set. Respond directly and label it as heuristic portfolio similarity.'
        : 'Returned a precise company similarity set. Respond directly from these peers.',
  };
}

function annotateSparseCompanyRows(
  family: CompanyIntentFamily,
  rows: Record<string, unknown>[]
): ToolSufficiencyMetadata {
  if (rows.length === 0) {
    return {};
  }

  if (family === 'constrained_company_screen') {
    const lowSignal = rows.every((row) => Number(row.totalReviewsLastYear ?? row.totalReviewsLast6Months ?? row.totalReviewsLast3Months ?? row.totalReviewsLast30Days ?? row.totalReviews ?? 0) < 100);
    if (lowSignal) {
      return {
        sufficient_to_answer: true,
        sufficiency_reason: 'Returned the only qualifying companies, but the supporting review volume is sparse. Respond directly and say the set is low-signal.',
      };
    }
  }

  if (rows.length <= 3) {
    return {
      sufficient_to_answer: true,
      sufficiency_reason: 'Returned a small but answerable company result. Respond directly and say the set is sparse if helpful.',
    };
  }

  return {
    sufficient_to_answer: true,
    sufficiency_reason: 'Returned enough structured company data to answer directly.',
  };
}

export async function applyCompanyToolResultPolicy<
  T extends { success: boolean; error?: string } & Record<string, unknown>,
>(
  userPrompt: string,
  toolCall: ToolCall,
  result: T
): Promise<T> {
  const family = classifyCompanyIntent(userPrompt);
  if (!family) {
    return result;
  }

  if (
    family === 'portfolio_top_titles' &&
    result.success === true &&
    isCompanyTopTitlesQuery(toolCall)
  ) {
    return filterLowSignalTopTitles(result);
  }

  if (
    toolCall.name === 'find_similar' &&
    family === 'company_similarity' &&
    result.success === true
  ) {
    return await enrichSimilarityResultsWithTitles(result as CompanyResultShape) as T;
  }

  if (toolCall.name !== 'query_analytics' || result.success !== true || !Array.isArray(result.data)) {
    return result;
  }

  if (!['company_count_profile', 'relationship_screen', 'time_window_ranking', 'constrained_company_screen'].includes(family)) {
    return result;
  }

  const enrichedRows = await enrichCompanyRowsWithTitles(family, userPrompt, result.data);
  const sufficiency = annotateSparseCompanyRows(family, enrichedRows);

  return {
    ...result,
    data: enrichedRows,
    rowCount: enrichedRows.length,
    ...sufficiency,
  };
}

export function buildGenericCompanyLookupSkipResult(
  userPrompt: string,
  toolCall: ToolCall
): ({ success: true; skipped_generic_company_lookup: true; debug: Record<string, unknown> } & ToolSufficiencyMetadata & Record<string, unknown>) | null {
  const family = classifyCompanyIntent(userPrompt);
  if (family !== 'relationship_screen') {
    return null;
  }

  if (toolCall.name !== 'lookup_publishers' && toolCall.name !== 'lookup_developers') {
    return null;
  }

  const query = typeof toolCall.arguments.query === 'string' ? normalizeLookupQuery(toolCall.arguments.query) : '';
  if (!GENERIC_RELATIONSHIP_LOOKUPS.has(query)) {
    return null;
  }

  return {
    success: true,
    skipped_generic_company_lookup: true,
    sufficient_to_answer: false,
    sufficiency_reason: 'Skipped a generic relationship keyword lookup. Use the company relationship analytics surface directly.',
    debug: {
      genericCompanyLookupSkipped: true,
      genericCompanyLookupReason: `Skipped ${toolCall.name}("${query}") because the prompt is a generic company relationship screen, not a specific entity lookup.`,
      companyIntentFamily: family,
    },
  };
}

export function extractCompanyAnswerState(
  userPrompt: string,
  toolCall: ToolCall,
  result: Record<string, unknown>
): CompanyAnswerState | null {
  const family = classifyCompanyIntent(userPrompt);
  if (!family) {
    return null;
  }

  if (
    (toolCall.name === 'lookup_publishers' || toolCall.name === 'lookup_developers') &&
    (result.needsDisambiguation === true || (result.success === false && typeof result.error === 'string'))
  ) {
    return {
      family,
      blockFurtherTools: true,
      reason: typeof result.error === 'string'
        ? result.error
        : 'The company lookup needs user clarification before any other tool call.',
    };
  }

  if (toolCall.name === 'query_analytics') {
    const args = toolCall.arguments as unknown as QueryAnalyticsArgs;
    if (
      isCompanyCube(args.cube) &&
      result.success === true &&
      result.sufficient_to_answer === true &&
      Number(result.rowCount ?? 0) === 0
    ) {
      return {
        family,
        blockFurtherTools: true,
        reason: typeof result.sufficiency_reason === 'string'
          ? result.sufficiency_reason
          : 'The constrained company screen returned no qualifying rows. Respond directly instead of broadening the query.',
      };
    }
  }

  return null;
}

function hasExplicitMultiSliceIntent(userPrompt: string): boolean {
  return MULTI_SLICE_MARKERS.some((pattern) => pattern.test(userPrompt));
}

export function buildRedundantCompanySkipResult(
  previousState: CompanyAnswerState | null,
  toolCall: ToolCall,
  userPrompt: string
): ({ success: true; skipped_redundant_company_query: true; debug: Record<string, unknown> } & ToolSufficiencyMetadata & Record<string, unknown>) | null {
  if (!previousState?.blockFurtherTools) {
    return null;
  }

  if (hasExplicitMultiSliceIntent(userPrompt)) {
    return null;
  }

  return {
    success: true,
    skipped_redundant_company_query: true,
    sufficient_to_answer: true,
    sufficiency_reason: previousState.reason,
    debug: {
      redundantCompanyQueryBlocked: true,
      redundantCompanyBlockReason: `Blocked ${toolCall.name} after a sufficient company result that should end the tool loop.`,
      companyIntentFamily: previousState.family,
    },
  };
}
