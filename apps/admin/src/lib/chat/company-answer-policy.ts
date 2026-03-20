import type { ToolCall, ToolSufficiencyMetadata } from '@/lib/llm/types';
import { isCompanyCube } from '@/lib/chat/company-query-guardrails';
import { getServiceSupabase } from '@/lib/supabase-service';

type Primitive = string | number | boolean;
type CompanyEntityType = 'publisher' | 'developer';
type CompanyWindowSegment = 'lastYear' | 'last6Months' | 'last3Months' | 'last30Days';
type CompanyTimeWindow =
  | { type: 'year'; year: number }
  | { type: 'segment'; segment: CompanyWindowSegment }
  | { type: 'unsupportedTrailingYears'; years: number; label: string };
type CompanyAnswerMode =
  | 'meaningful_first'
  | 'raw_count'
  | 'top_ranked'
  | 'recent_ranked'
  | 'profile'
  | 'precision_first';

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

interface CompanyAnswerMetricHint {
  label: string;
  member: string;
}

interface CompanyAnswerHints {
  family: CompanyIntentFamily;
  answerMode: CompanyAnswerMode;
  lowSignalIncluded: boolean;
  lowSignalReason?: string;
  primaryMetric: CompanyAnswerMetricHint;
  proofMetric: CompanyAnswerMetricHint;
  contextMetrics: CompanyAnswerMetricHint[];
  requiredColumns: string[];
  narrativeInstruction: string;
}

interface WindowPolicyResult {
  rows: Record<string, unknown>[];
  hints?: CompanyAnswerHints;
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

const RAW_COUNT_MARKERS = [
  /\braw count\b/i,
  /\bjust by count\b/i,
  /\bstrictly by count\b/i,
  /\bregardless of reviews?\b/i,
  /\bignore quality\b/i,
  /\bignore reviews?\b/i,
  /\bignore review signal\b/i,
  /\bliteral release count\b/i,
];

const PORTFOLIO_TOP_MARKERS = [
  /\btop games?\b/i,
  /\bbest games?\b/i,
  /\bstrongest games?\b/i,
  /\bmost popular games?\b/i,
  /\bmost reviewed games?\b/i,
  /\bflagship titles?\b/i,
  /\bnotable titles?\b/i,
  /\bbiggest games?\b/i,
];

const PORTFOLIO_RECENT_MARKERS = [
  /\blatest games?\b/i,
  /\bnewest games?\b/i,
  /\brecent games?\b/i,
  /\brecent releases?\b/i,
  /\blatest releases?\b/i,
  /\bnewest releases?\b/i,
];

const COMPANY_ENTITY_MARKER = /\b(publisher|publishers|developer|developers|studio|studios|company|companies)\b/i;

const COMPANY_SIMILARITY_MARKERS = [
  /\bsimilar to\b/i,
  /\bcompanies like\b/i,
  /\bpublishers like\b/i,
  /\bdevelopers like\b/i,
  /\bstudios like\b/i,
  /\bpeer publishers?\b/i,
  /\bpeer developers?\b/i,
  /\bpeers? to\b/i,
  /\bcomparable to\b/i,
  /\bcomparable publishers?\b/i,
  /\bcomparable developers?\b/i,
];

const TIME_WINDOW_RANKING_MARKERS = [
  /\bmost games?\b/i,
  /\bmost releases?\b/i,
  /\bmost games released\b/i,
  /\breleasing the most\b/i,
  /\breleased the most\b/i,
  /\btop publishers?\b/i,
  /\btop developers?\b/i,
  /\btop studios?\b/i,
  /\bhighest release count\b/i,
];

const RELEASE_COUNT_MARKERS = [
  /\brelease count\b/i,
  /\breleases?\b/i,
  /\bgames? released\b/i,
];

const COUNT_THRESHOLD_MARKERS = [
  /\b\d+\s*\+\s*games?\b/i,
  /\b\d+\s*\+\s*releases?\b/i,
  /\bat least\s+\d+\s+(games?|releases?)\b/i,
  /\b\d+\s+or more\s+(games?|releases?)\b/i,
];

const UNIVERSAL_CONSTRAINT_MARKERS = [
  /\ball above\b/i,
  /\bevery game above\b/i,
  /\bevery release above\b/i,
  /\bnone below\b/i,
  /\bminimum\b/i,
  /\bat least\s+\d+%/i,
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

function hasCompanyEntityLanguage(text: string): boolean {
  return COMPANY_ENTITY_MARKER.test(text);
}

function isCompanyCountProfilePrompt(text: string): boolean {
  return (
    (/\bhow many games\b/.test(text) && /\b(published|developed|released|made)\b/.test(text)) ||
    /\b(published|developed|released|made)\s+how many games\b/.test(text) ||
    (/\bgame count\b/.test(text) && /\b(publisher|developer|published|developed|released|made)\b/.test(text))
  );
}

function isCompanySimilarityPrompt(text: string): boolean {
  return (
    COMPANY_SIMILARITY_MARKERS.some((pattern) => pattern.test(text)) &&
    hasCompanyEntityLanguage(text)
  );
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
  const text = normalizePrompt(prompt);
  const patterns = [
    /(\d+)\s*\+\s*(games?|releases?)/,
    /at least\s+(\d+)\s+(games?|releases?)/,
    /(\d+)\s+or more\s+(games?|releases?)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function extractYear(prompt: string): number | null {
  const match = normalizePrompt(prompt).match(/\b(20\d{2})\b/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectTimeWindow(
  prompt: string
): CompanyTimeWindow | null {
  const text = normalizePrompt(prompt);
  const year = extractYear(text);
  const currentYear = new Date().getFullYear();
  const trailingYearsMatch = text.match(/\b(?:past|last|within the past)\s+(\d+)\s+years?\b/);

  if (trailingYearsMatch) {
    const trailingYears = Number(trailingYearsMatch[1]);
    if (Number.isFinite(trailingYears) && trailingYears > 1) {
      return {
        type: 'unsupportedTrailingYears',
        years: trailingYears,
        label: `past ${trailingYears} years`,
      };
    }
  }

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

function isCompanyTimeWindowRankingPrompt(text: string): boolean {
  if (!hasCompanyEntityLanguage(text) || !detectTimeWindow(text)) {
    return false;
  }

  if (TIME_WINDOW_RANKING_MARKERS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return wantsRawCountRanking(text) && RELEASE_COUNT_MARKERS.some((pattern) => pattern.test(text));
}

function isConstrainedCompanyScreenPrompt(text: string): boolean {
  if (!hasCompanyEntityLanguage(text) || !detectTimeWindow(text)) {
    return false;
  }

  const hasCountThreshold = COUNT_THRESHOLD_MARKERS.some((pattern) => pattern.test(text));
  const hasUniversalConstraint =
    UNIVERSAL_CONSTRAINT_MARKERS.some((pattern) => pattern.test(text)) ||
    /\b\d+%\b/.test(text);

  return hasCountThreshold && hasUniversalConstraint;
}

export function classifyCompanyIntent(prompt: string): CompanyIntentFamily | null {
  const text = normalizePrompt(prompt);

  if (isCompanyCountProfilePrompt(text)) {
    return 'company_count_profile';
  }

  if (
    (PORTFOLIO_TOP_MARKERS.some((pattern) => pattern.test(text)) ||
      PORTFOLIO_RECENT_MARKERS.some((pattern) => pattern.test(text))) &&
    (/\b(from|by)\b/.test(text) || /'s\b/.test(text))
  ) {
    return 'portfolio_top_titles';
  }

  if (
    /\b(indie|self[- ]published|external devs|external developers|external publishers|multi[- ]publisher)\b/.test(text)
  ) {
    return 'relationship_screen';
  }

  if (isCompanySimilarityPrompt(text)) {
    return 'company_similarity';
  }

  if (isCompanyTimeWindowRankingPrompt(text)) {
    return 'time_window_ranking';
  }

  if (isConstrainedCompanyScreenPrompt(text)) {
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

function buildWindowRowField(field: string, segment: CompanyWindowSegment): string {
  return `${field}${windowSuffix(segment)}`;
}

function describeWindowSegment(segment: CompanyWindowSegment): string {
  switch (segment) {
    case 'last30Days':
      return 'past 30 days';
    case 'last3Months':
      return 'past 3 months';
    case 'last6Months':
      return 'past 6 months';
    default:
      return 'past year';
  }
}

function wantsMultipleHitGames(prompt: string): boolean {
  const text = normalizePrompt(prompt);
  return /\bmultiple hit games\b|\b2\+\s*hit games\b|\btwo hit games\b/.test(text);
}

function wantsRawCountRanking(prompt: string): boolean {
  return RAW_COUNT_MARKERS.some((pattern) => pattern.test(prompt));
}

function wantsRecentPortfolioTitles(prompt: string): boolean {
  return PORTFOLIO_RECENT_MARKERS.some((pattern) => pattern.test(prompt));
}

function getUnsupportedCompanyTrailingWindow(prompt: string): Extract<
  CompanyTimeWindow,
  { type: 'unsupportedTrailingYears' }
> | null {
  const timeWindow = detectTimeWindow(prompt);
  return timeWindow?.type === 'unsupportedTrailingYears' ? timeWindow : null;
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
    filters.push({ member: `${cube}.exactGameCount`, operator: 'lte', values: [10] });
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
    if (/\bindie\b/.test(text)) {
      order[`${cube}.indieConfidence`] = 'desc';
    }
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

function rewritePortfolioTopTitles(
  prompt: string,
  args: QueryAnalyticsArgs
): QueryAnalyticsArgs | null {
  const cube = args.cube;
  if (cube !== 'PublisherGameMetrics' && cube !== 'DeveloperGameMetrics') {
    return null;
  }

  const isRecentMode = wantsRecentPortfolioTitles(prompt);
  const idMember = cube === 'PublisherGameMetrics'
    ? 'PublisherGameMetrics.publisherId'
    : 'DeveloperGameMetrics.developerId';
  const nameMember = cube === 'PublisherGameMetrics'
    ? 'PublisherGameMetrics.publisherName'
    : 'DeveloperGameMetrics.developerName';

  const filters = Array.isArray(args.filters) ? [...args.filters] : [];
  const existingIdFilter = filters.some((filter) => filter.member === idMember);
  const existingNameFilter = filters.some((filter) => filter.member === nameMember);
  if (!existingIdFilter && !existingNameFilter) {
    return null;
  }

  return {
    cube,
    dimensions: [
      `${cube}.appid`,
      `${cube}.gameName`,
      cube === 'PublisherGameMetrics'
        ? 'PublisherGameMetrics.publisherId'
        : 'DeveloperGameMetrics.developerId',
      cube === 'PublisherGameMetrics'
        ? 'PublisherGameMetrics.publisherName'
        : 'DeveloperGameMetrics.developerName',
      `${cube}.totalReviews`,
      `${cube}.reviewPercentage`,
      `${cube}.owners`,
      `${cube}.releaseDate`,
    ],
    filters,
    order: isRecentMode
      ? { [`${cube}.releaseDate`]: 'desc' }
      : {
          [`${cube}.totalReviews`]: 'desc',
          [`${cube}.reviewPercentage`]: 'desc',
          [`${cube}.owners`]: 'desc',
          [`${cube}.releaseDate`]: 'desc',
        },
    limit: Math.min(args.limit ?? 10, 10),
    reasoning: isRecentMode
      ? `Use the company game surface to answer the recent company titles request: ${prompt}`
      : `Use the company game surface to answer the top company titles request with review-backed ranking: ${prompt}`,
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

  if (timeWindow.type !== 'segment') {
    return null;
  }

  const cube = entityType === 'publisher' ? 'PublisherChatWindowMetrics' : 'DeveloperChatWindowMetrics';
  const rawCountMode = wantsRawCountRanking(prompt);
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
    filters: rawCountMode
      ? []
      : [{ member: meaningfulField, operator: 'gte', values: [1] }],
    order: rawCountMode
      ? {
          [gamesField]: 'desc',
          [totalReviewsField]: 'desc',
          [meaningfulField]: 'desc',
        }
      : {
          [meaningfulField]: 'desc',
          [totalReviewsField]: 'desc',
          [gamesField]: 'desc',
        },
    limit: 25,
    reasoning: normalizeReasoning('time_window_ranking', prompt),
  };
}

function rewriteConstrainedCompanyScreen(
  prompt: string,
  args: QueryAnalyticsArgs
): QueryAnalyticsArgs | null {
  const entityType = inferCompanyEntityType(prompt, args);
  const normalizedPrompt = normalizePrompt(prompt);
  const detectedTimeWindow = detectTimeWindow(prompt);
  const timeWindow =
    detectedTimeWindow?.type === 'year' && /\blast year\b/.test(normalizedPrompt)
      ? { type: 'segment' as const, segment: 'lastYear' as const }
      : detectedTimeWindow;
  const minGames = extractGameCountThreshold(prompt);
  const reviewPercentage = extractPercentThreshold(prompt);

  if (!entityType || !timeWindow || minGames === null || reviewPercentage === null) {
    return null;
  }

  if (timeWindow.type !== 'segment') {
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
      [meaningfulField]: 'desc',
      [totalReviewsField]: 'desc',
      [gamesField]: 'desc',
    },
    limit: 50,
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

  if (family === 'portfolio_top_titles') {
    rewritten = rewritePortfolioTopTitles(userPrompt, args);
  } else if (family === 'relationship_screen') {
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

export function buildUnsupportedCompanyWindowSkipResult(
  userPrompt: string,
  toolCall: ToolCall
): ({ success: true; unsupported_company_window: true; debug: Record<string, unknown> } & ToolSufficiencyMetadata & Record<string, unknown>) | null {
  if (toolCall.name !== 'query_analytics') {
    return null;
  }

  const args = toolCall.arguments as unknown as QueryAnalyticsArgs;
  const family = classifyCompanyIntent(userPrompt);
  const looksLikeCompanyWindowScreen =
    family === 'time_window_ranking' ||
    family === 'constrained_company_screen' ||
    (hasCompanyEntityLanguage(userPrompt) &&
      isCompanyCube(args.cube) &&
      (
        COUNT_THRESHOLD_MARKERS.some((pattern) => pattern.test(userPrompt)) ||
        TIME_WINDOW_RANKING_MARKERS.some((pattern) => pattern.test(userPrompt)) ||
        RELEASE_COUNT_MARKERS.some((pattern) => pattern.test(userPrompt)) ||
        UNIVERSAL_CONSTRAINT_MARKERS.some((pattern) => pattern.test(userPrompt)) ||
        /\baverag\w*\b/i.test(userPrompt)
      ));

  if (!looksLikeCompanyWindowScreen) {
    return null;
  }

  const unsupportedWindow = getUnsupportedCompanyTrailingWindow(userPrompt);
  if (!unsupportedWindow) {
    return null;
  }

  return {
    success: true,
    unsupported_company_window: true,
    requested_window: unsupportedWindow.label,
    supported_window: 'past year',
    sufficient_to_answer: true,
    sufficiency_reason: `The requested trailing company release window (${unsupportedWindow.label}) is not available. Respond directly that PublisherIQ currently supports company release-window screens only for the past year, and do not infer a ${unsupportedWindow.label} answer from shorter data.`,
    debug: {
      unsupportedCompanyWindow: true,
      requestedTrailingYears: unsupportedWindow.years,
      supportedTrailingWindow: 'past year',
      companyIntentFamily: family,
    },
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

function filterLowSignalTopTitles<T extends Record<string, unknown>>(result: T, userPrompt: string): T {
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
    companyAnswerHints: buildPortfolioAnswerHints(userPrompt, sparseTail),
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

function numberFromRow(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function compareRowsByNumericMembers(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  members: string[]
): number {
  for (const member of members) {
    const diff = numberFromRow(right, member) - numberFromRow(left, member);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function buildWindowAnswerHints(
  family: Extract<CompanyIntentFamily, 'time_window_ranking' | 'constrained_company_screen'>,
  answerMode: Extract<CompanyAnswerMode, 'meaningful_first' | 'raw_count'>,
  lowSignalIncluded: boolean,
  segment: CompanyWindowSegment,
  options: {
    gamesMember: string;
    meaningfulMember: string;
    totalReviewsMember: string;
    avgReviewMember: string;
    minReviewMember: string;
    lowSignalReason?: string;
  }
): CompanyAnswerHints {
  const segmentLabel = describeWindowSegment(segment);

  if (family === 'constrained_company_screen') {
    return {
      family,
      answerMode,
      lowSignalIncluded,
      lowSignalReason: options.lowSignalReason,
      primaryMetric: {
        label: 'Games Released',
        member: options.gamesMember,
      },
      proofMetric: {
        label: 'Minimum Review %',
        member: options.minReviewMember,
      },
      contextMetrics: [
        { label: 'Meaningful Releases', member: options.meaningfulMember },
        { label: 'Total Reviews', member: options.totalReviewsMember },
      ],
      requiredColumns: [
        'Company',
        'Games Released',
        'Meaningful Releases',
        'Minimum Review %',
        'Total Reviews',
        'Representative Titles',
      ],
      narrativeInstruction: lowSignalIncluded
        ? `Describe these as companies whose qualifying releases in the ${segmentLabel} all meet the minimum review threshold, and explicitly note that lower rows are low-signal because review-backed evidence is thin.`
        : `Describe these as companies whose qualifying releases in the ${segmentLabel} all meet the minimum review threshold. Do not phrase the proof as an average review score.`,
    };
  }

  return {
    family,
    answerMode,
    lowSignalIncluded,
    lowSignalReason: options.lowSignalReason,
    primaryMetric: {
      label: 'Games Released',
      member: options.gamesMember,
    },
    proofMetric: {
      label: 'Meaningful Releases',
      member: options.meaningfulMember,
    },
    contextMetrics: [
      { label: 'Total Reviews', member: options.totalReviewsMember },
      { label: 'Average Review %', member: options.avgReviewMember },
    ],
    requiredColumns: [
      'Company',
      'Games Released',
      'Meaningful Releases',
      'Total Reviews',
      'Average Review %',
      'Representative Titles',
    ],
    narrativeInstruction:
      answerMode === 'raw_count'
        ? 'Treat this as a literal raw release-count ranking because the prompt explicitly asked to ignore quality or reviews. Keep the context columns, but do not reinterpret the ranking as quality-first.'
        : lowSignalIncluded
          ? `Describe this as a recent release-volume ranking among companies with review-backed releases, and explicitly note that the lower rows are low-signal fillers because the stronger pool in the ${segmentLabel} is limited.`
          : `Describe this as a recent release-volume ranking among companies with review-backed releases in the ${segmentLabel}.`,
  };
}

function buildPortfolioAnswerHints(
  prompt: string,
  lowSignalIncluded: boolean
): CompanyAnswerHints {
  const recentMode = wantsRecentPortfolioTitles(prompt);

  return {
    family: 'portfolio_top_titles',
    answerMode: recentMode ? 'recent_ranked' : 'top_ranked',
    lowSignalIncluded,
    lowSignalReason: lowSignalIncluded
      ? 'Lower-ranked portfolio rows were trimmed or filtered because stronger supported titles existed.'
      : undefined,
    primaryMetric: {
      label: recentMode ? 'Release Date' : 'Total Reviews',
      member: recentMode ? 'releaseDate' : 'totalReviews',
    },
    proofMetric: {
      label: recentMode ? 'Total Reviews' : 'Review Percentage',
      member: recentMode ? 'totalReviews' : 'reviewPercentage',
    },
    contextMetrics: [
      { label: 'Owners', member: 'owners' },
      { label: 'Release Date', member: 'releaseDate' },
    ],
    requiredColumns: recentMode
      ? ['Game', 'Release Date', 'Total Reviews', 'Review Percentage', 'Owners']
      : ['Game', 'Total Reviews', 'Review Percentage', 'Owners', 'Release Date'],
    narrativeInstruction: recentMode
      ? 'Describe this as a recent company-title list ranked by newest releases. Do not call it a top or best-of ranking.'
      : 'Describe this as a top company-title list ranked by review-backed popularity, not by recency.',
  };
}

function buildCompanyCountProfileHints(
  entityType: CompanyEntityType
): CompanyAnswerHints {
  return {
    family: 'company_count_profile',
    answerMode: 'profile',
    lowSignalIncluded: false,
    primaryMetric: {
      label: 'Game Count',
      member: entityType === 'publisher' ? 'gameCount' : 'gameCount',
    },
    proofMetric: {
      label: 'Total Reviews',
      member: entityType === 'publisher' ? 'totalReviews' : 'totalReviews',
    },
    contextMetrics: [
      { label: 'Average Review Score', member: 'avgReviewScore' },
    ],
    requiredColumns: ['Company', 'Game Count', 'Total Reviews', 'Average Review Score', 'Representative Titles'],
    narrativeInstruction: 'Answer with the linked company name, the requested game count, review context, and 2 to 3 representative linked titles. Do not answer with a bare count alone.',
  };
}

function buildCompanySimilarityHints(sparse: boolean): CompanyAnswerHints {
  return {
    family: 'company_similarity',
    answerMode: 'precision_first',
    lowSignalIncluded: sparse,
    lowSignalReason: sparse
      ? 'Only a small number of strong peers survived the precision-first similarity filters.'
      : undefined,
    primaryMetric: {
      label: 'Peer Fit',
      member: 'score',
    },
    proofMetric: {
      label: 'Match Reasons',
      member: 'matchReasons',
    },
    contextMetrics: [
      { label: 'Review Percentage', member: 'review_percentage' },
      { label: 'Flagship Titles', member: 'flagshipTitles' },
    ],
    requiredColumns: ['Company', 'Flagship Titles', 'Review Percentage', 'Why It Matches'],
    narrativeInstruction: sparse
      ? 'Return the smaller precise peer set and explicitly say that the comparable company set is limited. Do not pad with weaker lexical peers.'
      : 'Return only precise peers and explain each with the provided match reasons. Do not use external company URLs.',
  };
}

function annotateTerminalCompanySimilarityResult(
  result: CompanyResultShape
): CompanyResultShape {
  const rows = Array.isArray(result.results) ? result.results : [];
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];

  if (candidates.length > 0) {
    return {
      ...result,
      companyAnswerHints: buildCompanySimilarityHints(true),
      sufficient_to_answer: true,
      sufficiency_reason: 'Company similarity needs a short clarification before any more tool calls. Ask the user which company they meant and stay constrained to the candidate list.',
    };
  }

  return {
    ...result,
    results: rows,
    companyAnswerHints: buildCompanySimilarityHints(true),
    sufficient_to_answer: true,
    sufficiency_reason: result.success === false
      ? 'Company similarity did not return a strong peer set. Respond directly, stay constrained to the requested company, and say that strong comparable peers were not found right now.'
      : 'No strong company peers survived the precision-first similarity filters. Respond directly and say the comparable peer set is limited.',
  };
}

function normalizeCompanyWindowRows(
  family: CompanyIntentFamily,
  userPrompt: string,
  rows: Record<string, unknown>[]
): WindowPolicyResult {
  if (rows.length === 0) {
    return { rows };
  }

  const timeWindow = detectTimeWindow(userPrompt);
  if (timeWindow?.type !== 'segment') {
    return { rows };
  }

  const segment = timeWindow.segment;
  const gamesMember = buildWindowRowField('gamesReleased', segment);
  const meaningfulMember = buildWindowRowField('meaningfulGamesReleased', segment);
  const totalReviewsMember = buildWindowRowField('totalReviews', segment);
  const avgReviewMember = buildWindowRowField('avgReviewPercentage', segment);
  const minReviewMember = buildWindowRowField('minReviewPercentage', segment);

  if (family === 'time_window_ranking') {
    const rankingMode: Extract<CompanyAnswerMode, 'meaningful_first' | 'raw_count'> = wantsRawCountRanking(userPrompt) ? 'raw_count' : 'meaningful_first';
    const orderedRows = rows.slice().sort((left, right) => {
      if (rankingMode === 'raw_count') {
        return compareRowsByNumericMembers(left, right, [
          gamesMember,
          totalReviewsMember,
          meaningfulMember,
        ]);
      }

      return compareRowsByNumericMembers(left, right, [
        meaningfulMember,
        totalReviewsMember,
        gamesMember,
      ]);
    });

    if (rankingMode === 'raw_count') {
      return {
        rows: orderedRows.slice(0, 10),
        hints: buildWindowAnswerHints('time_window_ranking', rankingMode, false, segment, {
          gamesMember,
          meaningfulMember,
          totalReviewsMember,
          avgReviewMember,
          minReviewMember,
        }),
      };
    }

    const strongRows: Record<string, unknown>[] = [];
    const weakRows: Record<string, unknown>[] = [];

    for (const row of orderedRows) {
      const meaningfulCount = numberFromRow(row, meaningfulMember);
      const totalReviews = numberFromRow(row, totalReviewsMember);
      if (meaningfulCount >= 2 || totalReviews >= 1000) {
        strongRows.push(row);
      } else {
        weakRows.push(row);
      }
    }

    const finalRows = [...strongRows, ...weakRows].slice(0, 10);
    const lowSignalIncluded = finalRows.some((row) => weakRows.includes(row));

    return {
      rows: finalRows,
      hints: buildWindowAnswerHints('time_window_ranking', rankingMode, lowSignalIncluded, segment, {
        gamesMember,
        meaningfulMember,
        totalReviewsMember,
        avgReviewMember,
        minReviewMember,
        lowSignalReason: lowSignalIncluded
          ? 'The ranking includes lower-signal filler rows after the strongest review-backed recent release candidates.'
          : undefined,
      }),
    };
  }

  if (family === 'constrained_company_screen') {
    const orderedRows = rows.slice().sort((left, right) =>
      compareRowsByNumericMembers(left, right, [
        meaningfulMember,
        totalReviewsMember,
        gamesMember,
      ]));

    const strongRows: Record<string, unknown>[] = [];
    const weakRows: Record<string, unknown>[] = [];

    for (const row of orderedRows) {
      const meaningfulCount = numberFromRow(row, meaningfulMember);
      const totalReviews = numberFromRow(row, totalReviewsMember);
      if (meaningfulCount >= 1 || totalReviews >= 1000) {
        strongRows.push(row);
      } else {
        weakRows.push(row);
      }
    }

    const strongSlice = strongRows.slice(0, 10);
    const finalRows = strongSlice.length >= 8
      ? strongSlice
      : [...strongSlice, ...weakRows].slice(0, 10);
    const lowSignalIncluded = finalRows.some((row) => weakRows.includes(row));

    return {
      rows: finalRows,
      hints: buildWindowAnswerHints('constrained_company_screen', 'meaningful_first', lowSignalIncluded, segment, {
        gamesMember,
        meaningfulMember,
        totalReviewsMember,
        avgReviewMember,
        minReviewMember,
        lowSignalReason: lowSignalIncluded
          ? 'Some qualifying companies meet the literal constraint but have thin review-backed evidence compared with the leading rows.'
          : undefined,
      }),
    };
  }

  return { rows };
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
    return annotateTerminalCompanySimilarityResult(result);
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
    companyAnswerHints: buildCompanySimilarityHints(sparse),
    sufficient_to_answer: true,
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
  userPrompt: string,
  rows: Record<string, unknown>[],
  hints?: CompanyAnswerHints
): ToolSufficiencyMetadata {
  if (rows.length === 0) {
    if (family === 'relationship_screen' && /\bindie\b/i.test(userPrompt)) {
      return {
        sufficient_to_answer: true,
        sufficiency_reason: 'No companies matched the current relationship screen. If the prompt used "indie", define indie as mostly self-published studios with small catalogs, say no matches qualified under that screen, and offer the nearest useful alternative such as self-published studios with multiple hit games or small studios with multiple hit games.',
      };
    }

    return {};
  }

  if (hints?.lowSignalIncluded) {
    if (family === 'time_window_ranking') {
      return {
        sufficient_to_answer: true,
        sufficiency_reason: 'Returned the strongest available recent company ranking. The leading rows are review-backed, but some lower rows are low-signal because the stronger recent-release pool is limited.',
      };
    }

    if (family === 'constrained_company_screen') {
      return {
        sufficient_to_answer: true,
        sufficiency_reason: 'Returned qualifying companies that meet the literal constraint, but some lower rows have thin supporting review volume. Respond directly and call out the low-signal tail.',
      };
    }
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
    return filterLowSignalTopTitles(result, userPrompt);
  }

  if (
    toolCall.name === 'find_similar' &&
    family === 'company_similarity'
  ) {
    if (result.success === true) {
      return await enrichSimilarityResultsWithTitles(result as CompanyResultShape) as T;
    }

    return annotateTerminalCompanySimilarityResult(result as CompanyResultShape) as T;
  }

  if (toolCall.name !== 'query_analytics' || result.success !== true || !Array.isArray(result.data)) {
    return result;
  }

  if (!['company_count_profile', 'relationship_screen', 'time_window_ranking', 'constrained_company_screen'].includes(family)) {
    return result;
  }

  const windowPolicy = normalizeCompanyWindowRows(family, userPrompt, result.data);
  const enrichedRows = await enrichCompanyRowsWithTitles(family, userPrompt, windowPolicy.rows);
  const sufficiency = annotateSparseCompanyRows(family, userPrompt, enrichedRows, windowPolicy.hints);
  const entityType = family === 'company_count_profile'
    ? inferEntityTypeFromResultRows(enrichedRows)
    : null;
  const profileHints = entityType ? buildCompanyCountProfileHints(entityType) : null;

  return {
    ...result,
    data: enrichedRows,
    rowCount: enrichedRows.length,
    ...(profileHints ? { companyAnswerHints: profileHints } : {}),
    ...(windowPolicy.hints ? { companyAnswerHints: windowPolicy.hints } : {}),
    ...sufficiency,
  };
}

export function buildGenericCompanyLookupSkipResult(
  userPrompt: string,
  toolCall: ToolCall
): ({ success: true; skipped_generic_company_lookup: true; debug: Record<string, unknown> } & ToolSufficiencyMetadata & Record<string, unknown>) | null {
  const family = classifyCompanyIntent(userPrompt);
  if (toolCall.name !== 'lookup_publishers' && toolCall.name !== 'lookup_developers') {
    return null;
  }

  if (family === 'company_similarity') {
    return {
      success: true,
      skipped_generic_company_lookup: true,
      sufficient_to_answer: false,
      sufficiency_reason: 'Skipped lookup because company similarity resolves company identity inside find_similar. Use find_similar directly and stay constrained to the requested company.',
      debug: {
        genericCompanyLookupSkipped: true,
        genericCompanyLookupReason: `Skipped ${toolCall.name} during company similarity because find_similar resolves company identity internally.`,
        companyIntentFamily: family,
      },
    };
  }

  if (family !== 'relationship_screen') {
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
    family === 'company_similarity' &&
    toolCall.name === 'find_similar' &&
    result.sufficient_to_answer === true
  ) {
    return {
      family,
      blockFurtherTools: true,
      reason: typeof result.sufficiency_reason === 'string'
        ? result.sufficiency_reason
        : 'Company similarity is terminal for this turn. Respond directly from the peer set or explain that strong peers were not found.',
    };
  }

  if (result.unsupported_company_window === true) {
    return {
      family,
      blockFurtherTools: true,
      reason: typeof result.sufficiency_reason === 'string'
        ? result.sufficiency_reason
        : 'The requested trailing company release window is not available. Respond directly instead of broadening the query.',
    };
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
