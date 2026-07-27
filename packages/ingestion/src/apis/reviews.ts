import { API_URLS, logger, ApiError } from '@publisheriq/shared';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';

const log = logger.child({ component: 'ReviewsAPI' });

/**
 * Steam Reviews API response
 */
interface ReviewsResponse {
  success: number;
  query_summary: {
    num_reviews: number;
    review_score: number;
    review_score_desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
  reviews: Array<{
    recommendationid: string;
    author: {
      steamid: string;
      num_games_owned: number;
      num_reviews: number;
      playtime_forever: number;
      playtime_last_two_weeks: number;
      playtime_at_review: number;
      last_played: number;
    };
    language: string;
    review: string;
    timestamp_created: number;
    timestamp_updated: number;
    voted_up: boolean;
    votes_up: number;
    votes_funny: number;
    weighted_vote_score: string;
    comment_count: number;
    steam_purchase: boolean;
    received_for_free: boolean;
    written_during_early_access: boolean;
  }>;
  cursor: string;
}

/**
 * Parsed review summary
 */
export interface ReviewSummary {
  appid: number;
  totalReviews: number;
  positiveReviews: number;
  negativeReviews: number;
  reviewScore: number;
  reviewScoreDesc: string;
}

/**
 * Fetch review summary for an app
 * Rate limit: ~20 requests per minute
 *
 * @param appid - Steam app ID
 * @returns Review summary or null if failed
 */
export async function fetchReviewSummary(appid: number): Promise<ReviewSummary | null> {
  await rateLimiters.reviews.acquire();

  const url = `${API_URLS.STEAM_STORE}/appreviews/${appid}?json=1&num_per_page=0&filter=all&language=all&review_type=all&purchase_type=all`;

  try {
    const response = await withRetry(async () => {
      const res = await fetch(url);

      if (!res.ok) {
        throw new ApiError(`Failed to fetch reviews for ${appid}`, res.status, url);
      }

      return res.json() as Promise<ReviewsResponse>;
    });

    if (response.success !== 1) {
      return null;
    }

    const summary = response.query_summary;
    return {
      appid,
      totalReviews: summary.total_reviews,
      positiveReviews: summary.total_positive,
      negativeReviews: summary.total_negative,
      reviewScore: summary.review_score,
      reviewScoreDesc: summary.review_score_desc,
    };
  } catch (error) {
    log.error('Failed to fetch review summary', { appid, error });
    return null;
  }
}

/**
 * Steam Review Histogram API response
 */
interface HistogramResponse {
  success: number;
  results: {
    start_date: number;
    end_date: number;
    weeks: Array<{
      date: number;
      recommendations_up: number;
      recommendations_down: number;
    }>;
    rollups: Array<{
      date: number;
      recommendations_up: number;
      recommendations_down: number;
    }>;
    rollup_type: string; // "month"
    recent: Array<{
      date: number;
      recommendations_up: number;
      recommendations_down: number;
    }>;
  };
}

/**
 * Monthly review histogram entry
 */
export interface ReviewHistogramEntry {
  monthStart: Date;
  recommendationsUp: number;
  recommendationsDown: number;
  positiveRatio: number;
}

export type ReviewHistogramFetchResult =
  | {
      attempts: number;
      entries: ReviewHistogramEntry[];
      status: 'data';
    }
  | {
      attempts: number;
      entries: [];
      status: 'empty';
    }
  | {
      attempts: number;
      entries: [];
      errorCode: string;
      errorMessage: string;
      status: 'failed';
      statusCode?: number;
    };

const DEFAULT_HISTOGRAM_REQUEST_TIMEOUT_MS = 15000;

/**
 * Fetch review histogram for trend analysis
 * Returns monthly buckets of positive/negative reviews
 * Rate limit: ~60 requests per minute
 *
 * @param appid - Steam app ID
 * @returns A structured data, empty, or failure outcome
 */
export async function fetchReviewHistogram(
  appid: number,
  requestTimeoutMs = DEFAULT_HISTOGRAM_REQUEST_TIMEOUT_MS
): Promise<ReviewHistogramFetchResult> {
  const url = `${API_URLS.STEAM_STORE}/appreviewhistogram/${appid}?l=english`;
  let attempts = 0;

  try {
    const response = await withRetry(async () => {
      await rateLimiters.histogram.acquire();
      attempts++;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (!res.ok) {
        throw new ApiError(`Failed to fetch histogram for ${appid}`, res.status, url);
      }

      return res.json() as Promise<HistogramResponse>;
    });

    if (response.success !== 1 || !response.results?.rollups) {
      return {
        attempts,
        entries: [],
        errorCode: 'invalid_response',
        errorMessage: `Steam returned an invalid histogram response for ${appid}`,
        status: 'failed',
      };
    }

    const entries = response.results.rollups.map((entry) => {
      const total = entry.recommendations_up + entry.recommendations_down;
      return {
        monthStart: new Date(entry.date * 1000),
        recommendationsUp: entry.recommendations_up,
        recommendationsDown: entry.recommendations_down,
        positiveRatio: total > 0 ? entry.recommendations_up / total : 0,
      };
    });

    return entries.length > 0
      ? { attempts, entries, status: 'data' }
      : { attempts, entries: [], status: 'empty' };
  } catch (error) {
    log.error('Failed to fetch review histogram', { appid, error });
    return {
      attempts,
      entries: [],
      errorCode: error instanceof ApiError ? error.code : 'request_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      status: 'failed',
      ...(error instanceof ApiError ? { statusCode: error.statusCode } : {}),
    };
  }
}

/**
 * Calculate trend from histogram data
 *
 * @param histogram - Array of histogram entries (newest first)
 * @param days - Number of days to consider for "recent" period
 * @returns Trend analysis or null if insufficient data
 */
export interface TrendAnalysis {
  currentPositiveRatio: number;
  previousPositiveRatio: number;
  trendDirection: 'up' | 'down' | 'stable';
  changePercent: number;
  recentReviews: number;
  previousReviews: number;
}

export function calculateTrend(
  histogram: ReviewHistogramEntry[],
  days = 30
): TrendAnalysis | null {
  if (!histogram || histogram.length < 2) {
    return null;
  }

  // Sort by date descending (newest first)
  const sorted = [...histogram].sort(
    (a, b) => b.monthStart.getTime() - a.monthStart.getTime()
  );

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Split into recent and previous periods
  const recent: ReviewHistogramEntry[] = [];
  const previous: ReviewHistogramEntry[] = [];

  for (const entry of sorted) {
    if (entry.monthStart >= cutoffDate) {
      recent.push(entry);
    } else if (previous.length < 3) {
      // Take up to 3 previous months for comparison
      previous.push(entry);
    }
  }

  if (recent.length === 0 || previous.length === 0) {
    return null;
  }

  // Calculate ratios
  const recentUp = recent.reduce((sum, e) => sum + e.recommendationsUp, 0);
  const recentDown = recent.reduce((sum, e) => sum + e.recommendationsDown, 0);
  const recentTotal = recentUp + recentDown;
  const currentPositiveRatio = recentTotal > 0 ? recentUp / recentTotal : 0;

  const prevUp = previous.reduce((sum, e) => sum + e.recommendationsUp, 0);
  const prevDown = previous.reduce((sum, e) => sum + e.recommendationsDown, 0);
  const prevTotal = prevUp + prevDown;
  const previousPositiveRatio = prevTotal > 0 ? prevUp / prevTotal : 0;

  // Calculate change
  const changePercent =
    previousPositiveRatio > 0
      ? ((currentPositiveRatio - previousPositiveRatio) / previousPositiveRatio) * 100
      : 0;

  // Determine direction (using 2% threshold for "stable")
  let trendDirection: 'up' | 'down' | 'stable' = 'stable';
  if (changePercent > 2) {
    trendDirection = 'up';
  } else if (changePercent < -2) {
    trendDirection = 'down';
  }

  return {
    currentPositiveRatio,
    previousPositiveRatio,
    trendDirection,
    changePercent,
    recentReviews: recentTotal,
    previousReviews: prevTotal,
  };
}

/**
 * Calculate review velocity (reviews per day)
 */
export function calculateReviewVelocity(
  histogram: ReviewHistogramEntry[],
  days: number
): number {
  if (!histogram || histogram.length === 0) {
    return 0;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let totalReviews = 0;
  let daysWithData = 0;

  for (const entry of histogram) {
    if (entry.monthStart >= cutoffDate) {
      totalReviews += entry.recommendationsUp + entry.recommendationsDown;
      // Assume each entry represents ~30 days
      daysWithData += 30;
    }
  }

  if (daysWithData === 0) {
    return 0;
  }

  // Adjust to actual days requested
  return (totalReviews / daysWithData) * Math.min(days, daysWithData);
}
