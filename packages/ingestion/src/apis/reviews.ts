import { API_URLS, logger, ApiError, RETRY_CONFIG } from '@publisheriq/shared';
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

export interface ReviewAttemptTelemetry {
  attempts: number;
  forbidden: number;
  networkErrors: number;
  rateLimited: number;
  retries: number;
  serverErrors: number;
  timeouts: number;
}

export type ReviewSummaryFetchResult =
  | {
      circuitOpened: false;
      status: 'success';
      statusCode: number;
      summary: ReviewSummary;
      telemetry: ReviewAttemptTelemetry;
    }
  | {
      circuitOpenUntil?: string;
      circuitOpened: boolean;
      errorCode: string;
      errorMessage: string;
      retryAfterMs?: number;
      status: 'failed';
      statusCode?: number;
      telemetry: ReviewAttemptTelemetry;
    };

interface ReviewRateLimiter {
  acquire(): Promise<void>;
}

export interface ReviewSummaryFetchOptions {
  beforeAttempt?: () => Promise<void>;
  circuitBreaker?: ReviewRateLimitCircuit;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
  limiter?: ReviewRateLimiter;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReviewCircuitState {
  openUntilMs: number | null;
  opened: boolean;
  remainingMs: number;
}

const DEFAULT_REVIEWS_REQUEST_TIMEOUT_MS = 15000;
const REVIEW_CIRCUIT_THRESHOLD = 3;
const REVIEW_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const REVIEW_CIRCUIT_OPEN_MS = 15 * 60 * 1000;

export class ReviewRateLimitCircuit {
  private readonly rateLimitedAtMs: number[] = [];
  private openUntilMs = 0;

  constructor(
    private readonly threshold = REVIEW_CIRCUIT_THRESHOLD,
    private readonly windowMs = REVIEW_CIRCUIT_WINDOW_MS,
    private readonly openMs = REVIEW_CIRCUIT_OPEN_MS
  ) {}

  getState(nowMs = Date.now()): ReviewCircuitState {
    const remainingMs = Math.max(0, this.openUntilMs - nowMs);
    return {
      openUntilMs: remainingMs > 0 ? this.openUntilMs : null,
      opened: remainingMs > 0,
      remainingMs
    };
  }

  openFor(durationMs: number, nowMs = Date.now()): ReviewCircuitState {
    this.openUntilMs = Math.max(this.openUntilMs, nowMs + Math.max(0, durationMs));
    return this.getState(nowMs);
  }

  recordRateLimit(nowMs = Date.now()): ReviewCircuitState {
    const windowStart = nowMs - this.windowMs;
    while (this.rateLimitedAtMs.length > 0 && (this.rateLimitedAtMs[0] ?? nowMs) < windowStart) {
      this.rateLimitedAtMs.shift();
    }

    this.rateLimitedAtMs.push(nowMs);
    if (this.rateLimitedAtMs.length >= this.threshold) {
      this.openFor(this.openMs, nowMs);
    }

    return this.getState(nowMs);
  }
}

export function parseRetryAfterMs(retryAfter: string | null, nowMs = Date.now()): number | null {
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAtMs = Date.parse(retryAfter);
  if (Number.isNaN(retryAtMs)) {
    return null;
  }

  return Math.max(0, retryAtMs - nowMs);
}

function createReviewAttemptTelemetry(): ReviewAttemptTelemetry {
  return {
    attempts: 0,
    forbidden: 0,
    networkErrors: 0,
    rateLimited: 0,
    retries: 0,
    serverErrors: 0,
    timeouts: 0
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.includes('ETIMEDOUT'))
  );
}

function reviewFailure(
  telemetry: ReviewAttemptTelemetry,
  params: {
    circuitState?: ReviewCircuitState;
    errorCode: string;
    errorMessage: string;
    retryAfterMs?: number | null;
    statusCode?: number;
  }
): ReviewSummaryFetchResult {
  const circuitState = params.circuitState;
  return {
    circuitOpened: circuitState?.opened ?? false,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    status: 'failed',
    telemetry,
    ...(params.statusCode === undefined ? {} : { statusCode: params.statusCode }),
    ...(params.retryAfterMs === null || params.retryAfterMs === undefined ? {} : { retryAfterMs: params.retryAfterMs }),
    ...(circuitState?.openUntilMs ? { circuitOpenUntil: new Date(circuitState.openUntilMs).toISOString() } : {})
  };
}

/**
 * Fetch review summary for an app
 * Rate limit: one actual HTTP attempt per second
 *
 * @param appid - Steam app ID
 * @returns A structured success or failure result with per-attempt telemetry
 */
export async function fetchReviewSummary(
  appid: number,
  options: ReviewSummaryFetchOptions = {}
): Promise<ReviewSummaryFetchResult> {
  const url = `${API_URLS.STEAM_STORE}/appreviews/${appid}?json=1&num_per_page=0&filter=all&language=all&review_type=all&purchase_type=all`;
  const telemetry = createReviewAttemptTelemetry();
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter ?? rateLimiters.reviews;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REVIEWS_REQUEST_TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));

  for (let retryIndex = 0; retryIndex <= RETRY_CONFIG.MAX_RETRIES; retryIndex++) {
    const attemptStartedAtMs = now();
    const existingCircuit = options.circuitBreaker?.getState(attemptStartedAtMs);
    if (existingCircuit?.opened) {
      return reviewFailure(telemetry, {
        circuitState: existingCircuit,
        errorCode: 'circuit_open',
        errorMessage: 'Steam Reviews circuit is open'
      });
    }
    if (options.deadlineMs !== undefined && attemptStartedAtMs >= options.deadlineMs) {
      return reviewFailure(telemetry, {
        errorCode: 'deadline_exceeded',
        errorMessage: 'Reviews worker deadline was reached before the next attempt'
      });
    }

    try {
      await limiter.acquire();
      await options.beforeAttempt?.();
    } catch (error) {
      const deadlineReached =
        error instanceof Error && error.name === 'ReviewsDeadlineReachedError';
      return reviewFailure(telemetry, {
        errorCode: deadlineReached ? 'deadline_exceeded' : 'request_guard_failed',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Reviews request guard failed before the HTTP attempt'
      });
    }
    if (options.deadlineMs !== undefined && now() >= options.deadlineMs) {
      return reviewFailure(telemetry, {
        errorCode: 'deadline_exceeded',
        errorMessage: 'Reviews worker deadline was reached before the HTTP attempt'
      });
    }
    telemetry.attempts += 1;
    telemetry.retries = Math.max(0, telemetry.attempts - 1);

    let retryDelayMs: number | null = null;
    let retryAfterFloorMs = 0;
    let failure: ReviewSummaryFetchResult | null = null;

    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(requestTimeoutMs)
      });

      if (response.ok) {
        let body: ReviewsResponse;
        try {
          body = (await response.json()) as ReviewsResponse;
        } catch (error) {
          return reviewFailure(telemetry, {
            errorCode: 'invalid_response',
            errorMessage:
              error instanceof Error
                ? `Steam returned invalid review JSON: ${error.message}`
                : 'Steam returned invalid review JSON'
          });
        }

        if (body.success !== 1 || !body.query_summary) {
          return reviewFailure(telemetry, {
            errorCode: 'invalid_response',
            errorMessage: `Steam returned an invalid review summary for ${appid}`
          });
        }

        const summary = body.query_summary;
        return {
          circuitOpened: false,
          status: 'success',
          statusCode: response.status,
          summary: {
            appid,
            totalReviews: summary.total_reviews,
            positiveReviews: summary.total_positive,
            negativeReviews: summary.total_negative,
            reviewScore: summary.review_score,
            reviewScoreDesc: summary.review_score_desc
          },
          telemetry
        };
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), now());
      retryAfterFloorMs = retryAfterMs ?? 0;
      if (response.status === 403) {
        telemetry.forbidden += 1;
        return reviewFailure(telemetry, {
          errorCode: 'http_403',
          errorMessage: `Steam returned HTTP 403 for reviews app ${appid}`,
          retryAfterMs,
          statusCode: response.status
        });
      }

      if (response.status === 408) {
        telemetry.timeouts += 1;
      } else if (response.status === 429) {
        telemetry.rateLimited += 1;
        const circuitState = options.circuitBreaker?.recordRateLimit(now());
        if (circuitState?.opened) {
          return reviewFailure(telemetry, {
            circuitState,
            errorCode: 'http_429',
            errorMessage: `Steam returned HTTP 429 for reviews app ${appid}`,
            retryAfterMs,
            statusCode: response.status
          });
        }
      } else if (response.status >= 500) {
        telemetry.serverErrors += 1;
      }

      const retryable =
        response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599);
      failure = reviewFailure(telemetry, {
        errorCode:
          response.status === 429 ? 'http_429' : response.status >= 500 ? 'http_5xx' : `http_${response.status}`,
        errorMessage: `Steam returned HTTP ${response.status} for reviews app ${appid}`,
        retryAfterMs,
        statusCode: response.status
      });

      if (!retryable || retryIndex >= RETRY_CONFIG.MAX_RETRIES) {
        return failure;
      }

      const exponentialDelayMs = Math.min(
        RETRY_CONFIG.INITIAL_DELAY_MS * RETRY_CONFIG.BACKOFF_MULTIPLIER ** retryIndex,
        RETRY_CONFIG.MAX_DELAY_MS
      );
      retryDelayMs = exponentialDelayMs;
    } catch (error) {
      if (isTimeoutError(error)) {
        telemetry.timeouts += 1;
        failure = reviewFailure(telemetry, {
          errorCode: 'timeout',
          errorMessage: `Steam Reviews request timed out for ${appid}`
        });
      } else {
        telemetry.networkErrors += 1;
        failure = reviewFailure(telemetry, {
          errorCode: 'network_error',
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }

      if (retryIndex >= RETRY_CONFIG.MAX_RETRIES) {
        log.error('Failed to fetch review summary', { appid, error });
        return failure;
      }

      retryDelayMs = Math.min(
        RETRY_CONFIG.INITIAL_DELAY_MS * RETRY_CONFIG.BACKOFF_MULTIPLIER ** retryIndex,
        RETRY_CONFIG.MAX_DELAY_MS
      );
    }

    const jitter = retryDelayMs * 0.1 * (random() * 2 - 1);
    const finalDelayMs = Math.max(retryAfterFloorMs, Math.max(0, Math.round(retryDelayMs + jitter)));
    if (options.deadlineMs !== undefined && now() + finalDelayMs >= options.deadlineMs) {
      return reviewFailure(telemetry, {
        errorCode: 'retry_deferred',
        errorMessage: 'Retry delay would exceed the Reviews worker deadline',
        retryAfterMs: finalDelayMs,
        statusCode: failure?.status === 'failed' ? failure.statusCode : undefined
      });
    }

    await sleep(finalDelayMs);
  }

  return reviewFailure(telemetry, {
    errorCode: 'request_failed',
    errorMessage: `Steam Reviews request failed for ${appid}`
  });
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
