import { getServiceSupabase } from '@/lib/supabase-service';
import type { ToolSufficiencyMetadata } from '@/lib/llm/types';

const MAX_RESULTS = 20;
const DEFAULT_RESULTS = 10;
const PREFETCH_MIN = 50;
const PREFETCH_MAX = 200;
const SMALL_CATALOG_MAX = 10;
const INDIE_TAG_TERM = 'Indie';
const DEFAULT_MOMENTUM_MIN_REVIEWS_ADDED_7D = 3;
const DEFAULT_SENTIMENT_MIN_REVIEWS_ADDED_30D = 5;
const SATURATED_SENTIMENT_MIN_REVIEWS_ADDED_30D = 10;

type ServiceSupabase = ReturnType<typeof getServiceSupabase>;
type IdLookupTable = 'steam_tags' | 'steam_genres' | 'steam_categories';
type IdLookupColumn = 'tag_id' | 'genre_id' | 'category_id';
type SupportLevel = 'low' | 'medium' | 'high';

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
}

interface RpcAppRow {
  appid: number;
  name: string;
  is_free: boolean;
  ccu_peak: number | null;
  total_reviews: number | null;
  positive_percentage: number | null;
  review_score: number | null;
  price_cents: number | null;
  current_discount_percent: number | null;
  ccu_growth_7d_percent: number | null;
  ccu_growth_30d_percent: number | null;
  velocity_7d: number | null;
  velocity_30d: number | null;
  velocity_acceleration: number | null;
  sentiment_delta: number | null;
  momentum_score: number | null;
  release_date: string | null;
  metric_date: string | null;
  publisher_id: number | null;
  publisher_name: string | null;
  publisher_game_count: number | null;
  developer_id: number | null;
  developer_name: string | null;
}

interface ReviewVelocityRow {
  appid: number;
  reviews_added_7d: number | null;
  reviews_added_30d: number | null;
  last_delta_date: string | null;
}

interface ExactTagEntry {
  id: number;
  name: string;
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
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) {
    return DEFAULT_RESULTS;
  }
  return Math.max(1, Math.min(limit, MAX_RESULTS));
}

function buildPrefetchLimit(limit: number): number {
  return Math.min(Math.max(limit * 8, PREFETCH_MIN), PREFETCH_MAX);
}

function normalizeRpcSortField(sortBy: ScreenGamesArgs['sort_by']): string {
  switch (sortBy) {
    case 'ccu_peak':
      return 'ccu_peak';
    case 'momentum_score':
      return 'momentum_score';
    case 'velocity_7d':
      return 'velocity_7d';
    case 'velocity_acceleration':
      return 'velocity_acceleration';
    case 'reviews_added_7d':
    case 'reviews_added_30d':
      return 'velocity_7d';
    case 'sentiment_delta':
      return 'sentiment_delta';
    case 'total_reviews':
      return 'total_reviews';
    case 'review_score':
      return 'review_score';
    default:
      return 'momentum_score';
  }
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
      return 'Change in positive review percentage between the recent review window and the prior baseline. Positive means improving sentiment; negative means worsening sentiment.';
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

  if (filters.tags?.length) applied.push(`tags: ${filters.tags.join(', ')}`);
  if (filters.verified_tags_any?.length) applied.push(`verified_tags_any: ${filters.verified_tags_any.join(', ')}`);
  if (filters.genres?.length) applied.push(`genres: ${filters.genres.join(', ')}`);
  if (filters.categories?.length) applied.push(`categories: ${filters.categories.join(', ')}`);
  if (filters.platforms?.length) applied.push(`platforms: ${filters.platforms.join(', ')}`);
  if (filters.steam_deck?.length) applied.push(`steam_deck: ${filters.steam_deck.join(', ')}`);
  if (typeof filters.is_free === 'boolean') applied.push(`is_free: ${filters.is_free}`);
  if (typeof filters.min_reviews === 'number') applied.push(`min_reviews: ${filters.min_reviews}`);
  if (typeof filters.max_reviews === 'number') applied.push(`max_reviews: ${filters.max_reviews}`);
  if (typeof filters.min_reviews_added_7d === 'number') applied.push(`min_reviews_added_7d: ${filters.min_reviews_added_7d}`);
  if (typeof filters.min_reviews_added_30d === 'number') applied.push(`min_reviews_added_30d: ${filters.min_reviews_added_30d}`);
  if (typeof filters.min_score === 'number') applied.push(`min_score: ${filters.min_score}`);
  if (typeof filters.max_score === 'number') applied.push(`max_score: ${filters.max_score}`);
  if (typeof filters.min_ccu === 'number') applied.push(`min_ccu: ${filters.min_ccu}`);
  if (typeof filters.min_sentiment_delta === 'number') applied.push(`min_sentiment_delta: ${filters.min_sentiment_delta}`);
  if (typeof filters.max_sentiment_delta === 'number') applied.push(`max_sentiment_delta: ${filters.max_sentiment_delta}`);
  if (typeof filters.self_published === 'boolean') applied.push(`self_published: ${filters.self_published}`);
  if (filters.publisher_size) applied.push(`publisher_size: ${filters.publisher_size}`);
  if (filters.release_year?.gte !== undefined) applied.push(`release_year >= ${filters.release_year.gte}`);
  if (filters.release_year?.lte !== undefined) applied.push(`release_year <= ${filters.release_year.lte}`);
  if (args.indie_heuristic) {
    applied.push('indie heuristic: <=10-game publisher catalogs, self-published preferred, Steam Indie tag support only');
  }

  return applied;
}

function normalizeCompanyName(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function isSelfPublishedRow(row: Pick<RpcAppRow, 'publisher_name' | 'developer_name'>): boolean {
  const publisherName = normalizeCompanyName(row.publisher_name);
  const developerName = normalizeCompanyName(row.developer_name);

  return publisherName.length > 0 && publisherName === developerName;
}

function buildIndieSignals(
  publisherGameCount: number | null,
  isSelfPublished: boolean,
  hasIndieTag: boolean
): string[] {
  const signals: string[] = [];

  if (publisherGameCount !== null && publisherGameCount <= SMALL_CATALOG_MAX) {
    signals.push(`publisher catalog <= ${SMALL_CATALOG_MAX} games`);
  }
  if (isSelfPublished) {
    signals.push('self-published on Steam');
  }
  if (hasIndieTag) {
    signals.push('Steam Indie tag');
  }

  return signals;
}

function getIndieDefinition(): string {
  return `Indie here is a heuristic, not a legal ownership claim: prefer mostly self-published studios with small catalogs, use a small-catalog cap around ${SMALL_CATALOG_MAX} games, and treat the Steam Indie tag only as a supporting signal or tie-breaker.`;
}

function getRecommendedColumns(sortBy: ScreenGamesArgs['sort_by']): string[] {
  switch (sortBy) {
    case 'momentum_score':
      return ['Game', 'Momentum Score', 'Reviews Added (7d)', 'CCU Peak', 'Review %'];
    case 'sentiment_delta':
      return ['Game', 'Sentiment Delta', 'Reviews Added (30d)', 'Review %', 'Reviews'];
    case 'reviews_added_7d':
      return ['Game', 'Reviews Added (7d)', 'Total Reviews', 'Review %'];
    case 'reviews_added_30d':
      return ['Game', 'Reviews Added (30d)', 'Total Reviews', 'Review %'];
    case 'velocity_7d':
      return ['Game', 'Review Velocity (7d)', 'Reviews Added (7d)', 'Review %'];
    case 'ccu_peak':
      return ['Game', 'Peak CCU', 'Review %', 'Reviews', 'Price'];
    default:
      return ['Game', 'Review %', 'Reviews'];
  }
}

function getResponseGuidance(sortBy: ScreenGamesArgs['sort_by']): string {
  switch (sortBy) {
    case 'momentum_score':
      return 'Name the ranking metric as Momentum Score, use the exact timeframe anchor, include Reviews Added (7d) and CCU Peak, and explain rows with numeric support rather than generic momentum prose.';
    case 'sentiment_delta':
      return 'Name the ranking metric as Sentiment Delta, use the exact timeframe anchor, include Reviews Added (30d), and do not paraphrase the deltas as generic 100% improvement or complete decline language.';
    default:
      return 'Use the exact timeframe anchor and ranking metric from the tool result.';
  }
}

function toPriceDollars(priceCents: number | null): number | null {
  if (priceCents === null || priceCents === undefined) {
    return null;
  }
  return Number((priceCents / 100).toFixed(2));
}

function parseIsoDate(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatSignedPercent(value: number | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function buildTimeframeMetadata(
  timeframe: NonNullable<ScreenGamesArgs['timeframe']>,
  results: ScreenedGameResult[]
): Pick<ScreenGamesResult, 'timeframe_label' | 'window_start' | 'window_end'> {
  const dateCandidates = results
    .map((result) => timeframe === 'current' ? result.metricDate : (result.lastDeltaDate ?? result.metricDate))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (dateCandidates.length === 0) {
    if (timeframe === 'current') {
      return { timeframe_label: 'latest available metrics snapshot' };
    }

    const days = timeframe === '30d' ? 30 : 7;
    return { timeframe_label: `${days}-day rolling window` };
  }

  const windowEndRaw = dateCandidates.reduce((latest, value) =>
    parseIsoDate(value) > parseIsoDate(latest) ? value : latest
  );
  const windowEndDate = new Date(windowEndRaw);
  const windowEnd = formatDateOnly(windowEndDate);

  if (timeframe === 'current') {
    return {
      timeframe_label: `latest metrics snapshot as of ${windowEnd}`,
      window_end: windowEnd,
    };
  }

  const windowDays = timeframe === '30d' ? 30 : 7;
  const windowStartDate = new Date(windowEndDate);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - (windowDays - 1));

  return {
    timeframe_label: `${windowDays}-day window ending ${windowEnd}`,
    window_start: formatDateOnly(windowStartDate),
    window_end: windowEnd,
  };
}

function getSortValue(result: ScreenedGameResult, sortBy: ScreenGamesArgs['sort_by']): number | null {
  switch (sortBy) {
    case 'ccu_peak':
      return result.ccuPeak;
    case 'momentum_score':
      return result.momentumScore;
    case 'velocity_7d':
      return result.velocity7d;
    case 'velocity_acceleration':
      return result.velocityAcceleration;
    case 'reviews_added_7d':
      return result.reviewsAdded7d;
    case 'reviews_added_30d':
      return result.reviewsAdded30d;
    case 'sentiment_delta':
      return result.sentimentDelta;
    case 'total_reviews':
      return result.totalReviews;
    case 'review_score':
      return result.reviewPercentage;
    default:
      return null;
  }
}

function compareSupportSignals(
  left: ScreenedGameResult,
  right: ScreenedGameResult,
  sortBy: ScreenGamesArgs['sort_by']
): number {
  switch (sortBy) {
    case 'momentum_score': {
      const reviewComparison = (right.reviewsAdded7d ?? Number.NEGATIVE_INFINITY) - (left.reviewsAdded7d ?? Number.NEGATIVE_INFINITY);
      if (reviewComparison !== 0) {
        return reviewComparison;
      }

      const ccuComparison = (right.ccuPeak ?? Number.NEGATIVE_INFINITY) - (left.ccuPeak ?? Number.NEGATIVE_INFINITY);
      if (ccuComparison !== 0) {
        return ccuComparison;
      }

      return (right.totalReviews ?? Number.NEGATIVE_INFINITY) - (left.totalReviews ?? Number.NEGATIVE_INFINITY);
    }
    case 'sentiment_delta': {
      const reviewComparison = (right.reviewsAdded30d ?? Number.NEGATIVE_INFINITY) - (left.reviewsAdded30d ?? Number.NEGATIVE_INFINITY);
      if (reviewComparison !== 0) {
        return reviewComparison;
      }

      const totalReviewComparison = (right.totalReviews ?? Number.NEGATIVE_INFINITY) - (left.totalReviews ?? Number.NEGATIVE_INFINITY);
      if (totalReviewComparison !== 0) {
        return totalReviewComparison;
      }

      return (right.ccuPeak ?? Number.NEGATIVE_INFINITY) - (left.ccuPeak ?? Number.NEGATIVE_INFINITY);
    }
    case 'reviews_added_7d':
      return (right.totalReviews ?? Number.NEGATIVE_INFINITY) - (left.totalReviews ?? Number.NEGATIVE_INFINITY);
    case 'reviews_added_30d':
      return (right.totalReviews ?? Number.NEGATIVE_INFINITY) - (left.totalReviews ?? Number.NEGATIVE_INFINITY);
    default:
      return 0;
  }
}

function compareResultsByMetric(
  left: ScreenedGameResult,
  right: ScreenedGameResult,
  sortBy: ScreenGamesArgs['sort_by'],
  sortOrder: NonNullable<ScreenGamesArgs['sort_order']>
): number {
  const leftMetric = getSortValue(left, sortBy);
  const rightMetric = getSortValue(right, sortBy);
  const leftMissing = leftMetric === null || leftMetric === undefined;
  const rightMissing = rightMetric === null || rightMetric === undefined;

  if (leftMissing !== rightMissing) {
    return leftMissing ? 1 : -1;
  }

  const metricComparison = leftMissing || rightMissing ? 0 : (leftMetric - rightMetric);
  if (metricComparison !== 0) {
    return sortOrder === 'asc' ? metricComparison : -metricComparison;
  }

  const supportComparison = compareSupportSignals(left, right, sortBy);
  if (supportComparison !== 0) {
    return supportComparison;
  }

  const leftReviews = left.totalReviews ?? Number.NEGATIVE_INFINITY;
  const rightReviews = right.totalReviews ?? Number.NEGATIVE_INFINITY;
  const reviewComparison = leftReviews - rightReviews;
  if (reviewComparison !== 0) {
    return -reviewComparison;
  }

  return left.name.localeCompare(right.name);
}

function sortResults(
  results: ScreenedGameResult[],
  sortBy: ScreenGamesArgs['sort_by'],
  sortOrder: NonNullable<ScreenGamesArgs['sort_order']>
): ScreenedGameResult[] {
  return [...results].sort((left, right) =>
    compareResultsByMetric(left, right, sortBy, sortOrder)
  );
}

function getIndieSignalWeight(result: ScreenedGameResult): number {
  let weight = 0;

  if (result.publisherGameCount !== null && result.publisherGameCount <= SMALL_CATALOG_MAX) {
    weight += 2;
  }
  if (result.isSelfPublished) {
    weight += 2;
  }
  if (result.hasIndieTag) {
    weight += 1;
  }

  return weight;
}

function buildSupportMetadata(
  result: ScreenedGameResult,
  sortBy: ScreenGamesArgs['sort_by']
): Pick<ScreenedGameResult, 'supportLevel' | 'supportReasons'> {
  const reasons: string[] = [];
  let score = 0;

  if (sortBy === 'momentum_score') {
    const reviewsAdded7d = result.reviewsAdded7d ?? 0;
    const ccuPeak = result.ccuPeak ?? 0;
    if (reviewsAdded7d >= 10) {
      score += 2;
      reasons.push(`${reviewsAdded7d} reviews added in the last 7 days`);
    } else if (reviewsAdded7d >= DEFAULT_MOMENTUM_MIN_REVIEWS_ADDED_7D) {
      score += 1;
      reasons.push(`${reviewsAdded7d} reviews added in the last 7 days`);
    }

    if (ccuPeak >= 100) {
      score += 2;
      reasons.push(`Peak CCU ${ccuPeak.toLocaleString()}`);
    } else if (ccuPeak >= 5) {
      score += 1;
      reasons.push(`Peak CCU ${ccuPeak.toLocaleString()}`);
    }

    const ccuGrowth = formatSignedPercent(result.ccuGrowth7dPercent);
    if (ccuGrowth) {
      reasons.push(`CCU growth ${ccuGrowth} over 7 days`);
    }
  }

  if (sortBy === 'sentiment_delta') {
    const reviewsAdded30d = result.reviewsAdded30d ?? 0;
    const sentimentDelta = formatSignedPercent(result.sentimentDelta);
    if (reviewsAdded30d >= SATURATED_SENTIMENT_MIN_REVIEWS_ADDED_30D) {
      score += 2;
      reasons.push(`${reviewsAdded30d} reviews added in the last 30 days`);
    } else if (reviewsAdded30d >= DEFAULT_SENTIMENT_MIN_REVIEWS_ADDED_30D) {
      score += 1;
      reasons.push(`${reviewsAdded30d} reviews added in the last 30 days`);
    }

    if (sentimentDelta) {
      reasons.push(`Sentiment delta ${sentimentDelta}`);
    }
  }

  const totalReviews = result.totalReviews ?? 0;
  if (totalReviews >= 10000) {
    score += 2;
    reasons.push(`${totalReviews.toLocaleString()} total reviews`);
  } else if (totalReviews >= 1000) {
    score += 1;
    reasons.push(`${totalReviews.toLocaleString()} total reviews`);
  }

  if (result.matchedVerifiedTags.length > 0) {
    reasons.push(`Verified tags: ${result.matchedVerifiedTags.join(', ')}`);
  }

  let supportLevel: SupportLevel = 'low';
  if (score >= 4) {
    supportLevel = 'high';
  } else if (score >= 2) {
    supportLevel = 'medium';
  }

  return {
    supportLevel,
    supportReasons: reasons,
  };
}

function applySupportFilters(
  results: ScreenedGameResult[],
  args: ScreenGamesArgs
): ScreenedGameResult[] {
  const filters = args.filters ?? {};
  const minReviewsAdded7d = typeof filters.min_reviews_added_7d === 'number'
    ? filters.min_reviews_added_7d
    : args.sort_by === 'momentum_score'
      ? DEFAULT_MOMENTUM_MIN_REVIEWS_ADDED_7D
      : undefined;
  const minReviewsAdded30d = typeof filters.min_reviews_added_30d === 'number'
    ? filters.min_reviews_added_30d
    : args.sort_by === 'sentiment_delta'
      ? DEFAULT_SENTIMENT_MIN_REVIEWS_ADDED_30D
      : undefined;

  return results.filter((result) => {
    if (
      typeof minReviewsAdded7d === 'number' &&
      (result.reviewsAdded7d ?? 0) < minReviewsAdded7d
    ) {
      return false;
    }

    if (
      typeof minReviewsAdded30d === 'number' &&
      (result.reviewsAdded30d ?? 0) < minReviewsAdded30d
    ) {
      return false;
    }

    if (
      filters.verified_tags_any?.length &&
      result.matchedVerifiedTags.length === 0
    ) {
      return false;
    }

    if (
      args.sort_by === 'sentiment_delta' &&
      Math.abs(result.sentimentDelta ?? 0) === 100 &&
      (result.reviewsAdded30d ?? 0) < SATURATED_SENTIMENT_MIN_REVIEWS_ADDED_30D
    ) {
      return false;
    }

    return true;
  });
}

function applyIndieHeuristic(
  results: ScreenedGameResult[],
  sortBy: ScreenGamesArgs['sort_by'],
  sortOrder: NonNullable<ScreenGamesArgs['sort_order']>
): ScreenedGameResult[] {
  return [...results]
    .filter((result) =>
      result.publisherGameCount !== null &&
      result.publisherGameCount <= SMALL_CATALOG_MAX &&
      (result.isSelfPublished || result.hasIndieTag)
    )
    .sort((left, right) => {
      const signalComparison = getIndieSignalWeight(right) - getIndieSignalWeight(left);
      if (signalComparison !== 0) {
        return signalComparison;
      }

      return compareResultsByMetric(left, right, sortBy, sortOrder);
    });
}

async function resolveMatchingIds(
  supabase: ServiceSupabase,
  table: IdLookupTable,
  idColumn: IdLookupColumn,
  terms?: string[]
): Promise<number[] | undefined> {
  if (!terms || terms.length === 0) {
    return undefined;
  }

  const resolvedIds = new Set<number>();

  for (const term of terms) {
    const { data, error } = await supabase
      .from(table)
      .select(idColumn)
      .ilike('name', `%${term}%`);

    if (error) {
      throw new Error(`Failed to resolve ${table} for "${term}": ${error.message}`);
    }

    const rows = (data ?? []) as unknown as Array<Record<string, number | null>>;
    const matchingIds = rows
      .map((row) => row[idColumn])
      .filter((value): value is number => typeof value === 'number');

    if (matchingIds.length === 0) {
      return [];
    }

    for (const id of matchingIds) {
      resolvedIds.add(id);
    }
  }

  return [...resolvedIds];
}

async function resolveExactTagEntries(
  supabase: ServiceSupabase,
  tagNames: string[]
): Promise<ExactTagEntry[] | undefined> {
  if (tagNames.length === 0) {
    return undefined;
  }

  const resolvedEntries = new Map<number, string>();

  for (const tagName of tagNames) {
    const { data, error } = await supabase
      .from('steam_tags')
      .select('tag_id, name')
      .ilike('name', tagName);

    if (error) {
      throw new Error(`Failed to resolve exact Steam tag "${tagName}": ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ tag_id: number | null; name: string | null }>;
    const matchingEntries = rows
      .filter((row): row is { tag_id: number; name: string } =>
        typeof row.tag_id === 'number' &&
        typeof row.name === 'string' &&
        row.name.length > 0
      );

    if (matchingEntries.length === 0) {
      return [];
    }

    for (const entry of matchingEntries) {
      resolvedEntries.set(entry.tag_id, entry.name);
    }
  }

  return [...resolvedEntries.entries()].map(([id, name]) => ({ id, name }));
}

async function fetchVelocityRows(
  supabase: ServiceSupabase,
  appids: number[]
): Promise<Map<number, ReviewVelocityRow>> {
  if (appids.length === 0) {
    return new Map();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('review_velocity_stats')
    .select('appid, reviews_added_7d, reviews_added_30d, last_delta_date')
    .in('appid', appids);

  if (error) {
    throw new Error(`Failed to fetch review velocity data: ${error.message}`);
  }

  const rows = (data ?? []) as ReviewVelocityRow[];
  return new Map(rows.map((row) => [row.appid, row]));
}

async function fetchTagMembership(
  supabase: ServiceSupabase,
  appids: number[],
  tagEntries: ExactTagEntry[]
): Promise<Map<number, string[]>> {
  if (appids.length === 0 || tagEntries.length === 0) {
    return new Map();
  }

  const tagIds = tagEntries.map((entry) => entry.id);
  const tagNamesById = new Map(tagEntries.map((entry) => [entry.id, entry.name]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('app_steam_tags')
    .select('appid, tag_id')
    .in('appid', appids)
    .in('tag_id', tagIds);

  if (error) {
    throw new Error(`Failed to fetch app tag membership: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ appid: number | null; tag_id: number | null }>;
  const membership = new Map<number, string[]>();

  for (const row of rows) {
    if (typeof row.appid !== 'number' || typeof row.tag_id !== 'number') {
      continue;
    }

    const tagName = tagNamesById.get(row.tag_id);
    if (!tagName) {
      continue;
    }

    const existingTags = membership.get(row.appid) ?? [];
    if (!existingTags.includes(tagName)) {
      existingTags.push(tagName);
      membership.set(row.appid, existingTags);
    }
  }

  return membership;
}

async function fetchScreenedApps(
  supabase: ServiceSupabase,
  args: ScreenGamesArgs,
  resolvedTagIds?: number[],
  resolvedGenreIds?: number[],
  resolvedCategoryIds?: number[]
): Promise<RpcAppRow[]> {
  const filters = args.filters ?? {};
  const sortOrder = args.sort_order ?? 'desc';
  const limit = buildPrefetchLimit(clampLimit(args.limit));
  const steamDeck = filters.steam_deck?.length ? filters.steam_deck.join(',') : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_apps_with_filters', {
    p_type: 'game',
    p_sort_field: normalizeRpcSortField(args.sort_by),
    p_sort_order: sortOrder,
    p_limit: limit,
    p_offset: 0,
    p_search: undefined,
    p_min_ccu: filters.min_ccu,
    p_max_ccu: undefined,
    p_min_owners: undefined,
    p_max_owners: undefined,
    p_min_reviews: filters.min_reviews,
    p_max_reviews: filters.max_reviews,
    p_min_score: filters.min_score,
    p_max_score: filters.max_score,
    p_min_price: undefined,
    p_max_price: undefined,
    p_min_playtime: undefined,
    p_max_playtime: undefined,
    p_min_growth_7d: undefined,
    p_max_growth_7d: undefined,
    p_min_growth_30d: undefined,
    p_max_growth_30d: undefined,
    p_min_momentum: undefined,
    p_max_momentum: undefined,
    p_min_sentiment_delta: filters.min_sentiment_delta,
    p_max_sentiment_delta: filters.max_sentiment_delta,
    p_velocity_tier: undefined,
    p_min_active_pct: undefined,
    p_min_review_rate: undefined,
    p_min_value_score: undefined,
    p_genres: resolvedGenreIds,
    p_genre_mode: resolvedGenreIds?.length ? 'all' : 'any',
    p_tags: resolvedTagIds,
    p_tag_mode: resolvedTagIds?.length ? 'all' : 'any',
    p_categories: resolvedCategoryIds,
    p_has_workshop: undefined,
    p_platforms: filters.platforms,
    p_platform_mode: filters.platforms?.length ? 'all' : 'any',
    p_steam_deck: steamDeck,
    p_controller: undefined,
    p_min_age: undefined,
    p_max_age: undefined,
    p_release_year: filters.release_year?.gte === filters.release_year?.lte
      ? filters.release_year?.gte
      : undefined,
    p_early_access: undefined,
    p_min_hype: undefined,
    p_max_hype: undefined,
    p_publisher_search: undefined,
    p_developer_search: undefined,
    p_self_published: filters.self_published,
    p_min_vs_publisher: undefined,
    p_publisher_size: filters.publisher_size,
    p_ccu_tier: undefined,
    p_is_free: filters.is_free,
    p_min_discount: undefined,
  });

  if (error) {
    throw new Error(`Failed to fetch screened games: ${error.message}`);
  }

  let rows = (data ?? []) as RpcAppRow[];

  if (filters.release_year?.gte !== undefined || filters.release_year?.lte !== undefined) {
    rows = rows.filter((row) => {
      if (!row.release_date) {
        return false;
      }
      const year = new Date(row.release_date).getUTCFullYear();
      if (filters.release_year?.gte !== undefined && year < filters.release_year.gte) {
        return false;
      }
      if (filters.release_year?.lte !== undefined && year > filters.release_year.lte) {
        return false;
      }
      return true;
    });
  }

  return rows;
}

function mapScreenedResult(row: RpcAppRow, velocityRow?: ReviewVelocityRow): ScreenedGameResult {
  const isSelfPublished = isSelfPublishedRow(row);

  return {
    appid: row.appid,
    name: row.name,
    isFree: row.is_free,
    ccuPeak: row.ccu_peak,
    totalReviews: row.total_reviews,
    reviewPercentage: row.positive_percentage ?? row.review_score,
    priceDollars: toPriceDollars(row.price_cents),
    discountPercent: row.current_discount_percent,
    ccuGrowth7dPercent: row.ccu_growth_7d_percent,
    ccuGrowth30dPercent: row.ccu_growth_30d_percent,
    velocity7d: row.velocity_7d,
    velocity30d: row.velocity_30d,
    velocityAcceleration: row.velocity_acceleration,
    sentimentDelta: row.sentiment_delta,
    momentumScore: row.momentum_score,
    reviewsAdded7d: velocityRow?.reviews_added_7d ?? null,
    reviewsAdded30d: velocityRow?.reviews_added_30d ?? null,
    metricDate: row.metric_date,
    lastDeltaDate: velocityRow?.last_delta_date ?? null,
    releaseDate: row.release_date,
    publisherId: row.publisher_id,
    publisherName: row.publisher_name,
    publisherGameCount: row.publisher_game_count,
    developerId: row.developer_id,
    developerName: row.developer_name,
    isSelfPublished,
    hasIndieTag: false,
    matchedVerifiedTags: [],
    indieSignals: buildIndieSignals(row.publisher_game_count, isSelfPublished, false),
    supportLevel: 'low',
    supportReasons: [],
  };
}

function buildSufficiency(results: ScreenedGameResult[]): ToolSufficiencyMetadata {
  if (results.length === 0) {
    return {
      result_shape: 'broad_discovery',
      sufficient_to_answer: true,
      sufficiency_reason: 'No qualifying games matched the current screen. Respond directly and keep the hard filters intact.',
    };
  }

  if (results.length <= 5) {
    return {
      result_shape: 'broad_discovery',
      sufficient_to_answer: true,
      sufficiency_reason: 'Returned a sparse but precise screened result. Respond directly and say the qualifying set is limited if helpful.',
    };
  }

  return {
    result_shape: 'broad_discovery',
    sufficient_to_answer: true,
    sufficiency_reason: 'Returned a precise screened ranking. Respond directly from these rows.',
  };
}

export async function screenGames(args: ScreenGamesArgs): Promise<ScreenGamesResult> {
  const supabase = getServiceSupabase();
  const timeframe = args.timeframe ?? '7d';
  const sortOrder = args.sort_order ?? 'desc';
  const filtersApplied = formatFiltersApplied(args);
  const recommendedColumns = getRecommendedColumns(args.sort_by);
  const responseGuidance = getResponseGuidance(args.sort_by);

  try {
    const [
      resolvedTagIds,
      resolvedGenreIds,
      resolvedCategoryIds,
      resolvedVerifiedTagEntries,
      resolvedIndieTagEntries,
    ] = await Promise.all([
      resolveMatchingIds(supabase, 'steam_tags', 'tag_id', args.filters?.tags),
      resolveMatchingIds(supabase, 'steam_genres', 'genre_id', args.filters?.genres),
      resolveMatchingIds(supabase, 'steam_categories', 'category_id', args.filters?.categories),
      resolveExactTagEntries(supabase, args.filters?.verified_tags_any ?? []),
      args.indie_heuristic
        ? resolveExactTagEntries(supabase, [INDIE_TAG_TERM])
        : Promise.resolve(undefined),
    ]);

    if (
      resolvedTagIds?.length === 0 ||
      resolvedGenreIds?.length === 0 ||
      resolvedCategoryIds?.length === 0 ||
      resolvedVerifiedTagEntries?.length === 0
    ) {
      const emptyResults: ScreenedGameResult[] = [];
      return {
        success: true,
        ranking_metric: args.sort_by,
        ranking_label: getRankingLabel(args.sort_by),
        ranking_definition: getRankingDefinition(args.sort_by),
        timeframe,
        timeframe_label: timeframe === 'current' ? 'latest available metrics snapshot' : `${timeframe} rolling window`,
        recommended_columns: recommendedColumns,
        response_guidance: responseGuidance,
        filters_applied: filtersApplied,
        indie_definition: args.indie_heuristic
          ? getIndieDefinition()
          : undefined,
        results: emptyResults,
        total_found: 0,
        ...buildSufficiency(emptyResults),
      };
    }

    let appRows: RpcAppRow[];
    if (args.indie_heuristic) {
      const candidateArgs = ['indie', 'mid'].map((publisherSize) => ({
        ...args,
        filters: {
          ...args.filters,
          self_published: undefined,
          publisher_size: publisherSize as 'indie' | 'mid',
        },
      }));

      const appRowsByBucket = await Promise.all(
        candidateArgs.map((candidateArgsForBucket) =>
          fetchScreenedApps(
            supabase,
            candidateArgsForBucket,
            resolvedTagIds,
            resolvedGenreIds,
            resolvedCategoryIds
          )
        )
      );

      appRows = [...new Map(
        appRowsByBucket
          .flat()
          .map((row) => [row.appid, row])
      ).values()];
    } else {
      appRows = await fetchScreenedApps(
        supabase,
        args,
        resolvedTagIds,
        resolvedGenreIds,
        resolvedCategoryIds
      );
    }

    const appids = appRows.map((row) => row.appid);
    const [velocityRows, verifiedTagMembership, indieTagMembership] = await Promise.all([
      fetchVelocityRows(supabase, appids),
      resolvedVerifiedTagEntries?.length
        ? fetchTagMembership(supabase, appids, resolvedVerifiedTagEntries)
        : Promise.resolve(new Map<number, string[]>()),
      args.indie_heuristic && resolvedIndieTagEntries?.length
        ? fetchTagMembership(supabase, appids, resolvedIndieTagEntries)
        : Promise.resolve(new Map<number, string[]>()),
    ]);

    const mappedResults = appRows.map((row) => {
      const baseResult = mapScreenedResult(row, velocityRows.get(row.appid));
      const matchedVerifiedTags = verifiedTagMembership.get(row.appid) ?? [];
      const hasIndieTag = (indieTagMembership.get(row.appid)?.length ?? 0) > 0;

      return {
        ...baseResult,
        hasIndieTag,
        matchedVerifiedTags,
        indieSignals: buildIndieSignals(
          row.publisher_game_count,
          baseResult.isSelfPublished,
          hasIndieTag
        ),
      };
    });
    const supportedResults = applySupportFilters(mappedResults, args).map((result) => ({
      ...result,
      ...buildSupportMetadata(result, args.sort_by),
    }));
    const rankedResults = args.indie_heuristic
      ? applyIndieHeuristic(supportedResults, args.sort_by, sortOrder)
      : sortResults(supportedResults, args.sort_by, sortOrder);
    const sortedResults = rankedResults.slice(0, clampLimit(args.limit));
    const timeframeMetadata = buildTimeframeMetadata(timeframe, sortedResults);

    return {
      success: true,
      ranking_metric: args.sort_by,
      ranking_label: getRankingLabel(args.sort_by),
      ranking_definition: getRankingDefinition(args.sort_by),
      timeframe,
      timeframe_label: timeframeMetadata.timeframe_label,
      window_start: timeframeMetadata.window_start,
      window_end: timeframeMetadata.window_end,
      recommended_columns: recommendedColumns,
      response_guidance: responseGuidance,
      filters_applied: filtersApplied,
      indie_definition: args.indie_heuristic
        ? getIndieDefinition()
        : undefined,
      results: sortedResults,
      total_found: rankedResults.length,
      ...buildSufficiency(sortedResults),
    };
  } catch (error) {
    return {
      success: false,
      ranking_metric: args.sort_by,
      ranking_label: getRankingLabel(args.sort_by),
      ranking_definition: getRankingDefinition(args.sort_by),
      timeframe,
      timeframe_label: timeframe === 'current' ? 'latest available metrics snapshot' : `${timeframe} rolling window`,
      recommended_columns: recommendedColumns,
      response_guidance: responseGuidance,
      filters_applied: filtersApplied,
      indie_definition: args.indie_heuristic
        ? getIndieDefinition()
        : undefined,
      error: error instanceof Error ? error.message : 'Failed to screen games',
    };
  }
}
