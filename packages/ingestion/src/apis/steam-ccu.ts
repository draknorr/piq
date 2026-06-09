import { API_URLS, logger } from '@publisheriq/shared';
import pLimit from 'p-limit';
import { rateLimiters } from '../utils/rate-limiter.js';

const log = logger.child({ component: 'SteamCCU' });

/**
 * Steam API GetNumberOfCurrentPlayers response
 */
interface CCUResponse {
  response: {
    player_count: number;
    /** 1 = success, 42 = invalid appid */
    result: number;
  };
}

interface SteamCCURequestOptions {
  cacheBust?: string;
  noCacheHeaders?: boolean;
}

interface CCUFetchOptions {
  confirmSuspiciousZero?: boolean;
  limiter?: SteamCcuLimiter;
}

interface BatchCCUFetchOptions {
  concurrency?: number;
  cautionErrorRateThreshold?: number;
  rpsInitial?: number;
  rpsMax?: number;
  rpsMin?: number;
  suspiciousZeroAppids?: ReadonlySet<number>;
}

interface SteamCCUFetchResult {
  data: CCUResponse | null;
  status: number;
  url: string;
}

interface SteamCcuLimiter {
  acquire(): Promise<void>;
}

class AdaptiveSteamCcuLimiter implements SteamCcuLimiter {
  private lastRefill = Date.now();
  private tokens: number;
  private queue: Promise<void> = Promise.resolve();
  private requestsPerSecond: number;

  constructor(
    initialRequestsPerSecond: number,
    private readonly minRequestsPerSecond: number,
    private readonly maxRequestsPerSecond: number
  ) {
    this.requestsPerSecond = Math.min(
      Math.max(initialRequestsPerSecond, minRequestsPerSecond),
      maxRequestsPerSecond
    );
    this.tokens = Math.max(1, Math.ceil(this.requestsPerSecond));
  }

  async acquire(): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitTimeMs = ((1 - this.tokens) / this.requestsPerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
      this.refill();
      this.tokens -= 1;
    } finally {
      release();
    }
  }

  getRequestsPerSecond(): number {
    return this.requestsPerSecond;
  }

  halve(): number {
    this.requestsPerSecond = Math.max(
      this.minRequestsPerSecond,
      this.requestsPerSecond / 2
    );
    this.tokens = Math.min(this.tokens, Math.max(1, Math.ceil(this.requestsPerSecond)));
    return this.requestsPerSecond;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      Math.max(1, Math.ceil(this.maxRequestsPerSecond)),
      this.tokens + elapsedSeconds * this.requestsPerSecond
    );
    this.lastRefill = now;
  }
}

function buildSteamCCUUrl(appid: number, options?: SteamCCURequestOptions): string {
  const url = new URL(`${API_URLS.STEAM_WEB}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/`);
  url.searchParams.set('appid', String(appid));

  if (options?.cacheBust) {
    url.searchParams.set('cb', options.cacheBust);
  }

  return url.toString();
}

async function requestSteamCCU(
  appid: number,
  options?: SteamCCURequestOptions
): Promise<SteamCCUFetchResult> {
  const url = buildSteamCCUUrl(appid, options);
  const headers = options?.noCacheHeaders
    ? {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      }
    : undefined;
  const res = await fetch(url, headers ? { headers } : undefined);

  let data: CCUResponse | null = null;
  try {
    data = (await res.json()) as CCUResponse;
  } catch {
    data = null;
  }

  return { data, status: res.status, url };
}

async function confirmSuspiciousZero(
  appid: number,
  limiter: SteamCcuLimiter
): Promise<{
  httpStatus: number;
  playerCount: number | null;
  rateLimited: boolean;
  requestCount: number;
}> {
  await limiter.acquire();

  const confirmation = await requestSteamCCU(appid, {
    cacheBust: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    noCacheHeaders: true,
  });

  if (confirmation.data?.response?.result !== 1) {
    log.warn('Suspicious zero recheck returned non-success result', {
      appid,
      status: confirmation.status,
      result: confirmation.data?.response?.result ?? null,
      url: confirmation.url,
    });
    return {
      httpStatus: confirmation.status,
      playerCount: null,
      rateLimited: confirmation.status === 429,
      requestCount: 1,
    };
  }

  return {
    httpStatus: confirmation.status,
    playerCount: confirmation.data.response.player_count,
    rateLimited: confirmation.status === 429,
    requestCount: 1,
  };
}

/**
 * Fetch current concurrent player count for a single app from Steam's official API
 *
 * This returns the EXACT player count from Valve - no estimation involved.
 * Rate limit: 1 request per second (conservative)
 *
 * @param appid - Steam app ID
 * @returns Current player count or null if not available
 */
export async function fetchSteamCCU(appid: number): Promise<number | null> {
  return fetchSteamCCUWithOptions(appid, {});
}

async function fetchSteamCCUWithOptions(
  appid: number,
  options: CCUFetchOptions
): Promise<number | null> {
  const result = await fetchSteamCCUWithStatusOptions(appid, options);
  return result.status === 'valid' ? result.playerCount ?? 0 : null;
}

/**
 * Result from batch CCU fetch
 */
export interface CCUBatchResult {
  /** Map of appid to player count */
  data: Map<number, number>;
  /** Number of successful fetches */
  successCount: number;
  /** Number of failed fetches (errors or invalid appids) */
  failedCount: number;
}

/**
 * Status of a CCU fetch result
 * - valid: Steam returned result:1 with player count
 * - invalid: Steam returned result:42 (app doesn't support CCU - DLC, unreleased, etc.)
 * - error: Network/timeout/server error (transient, should retry)
 */
export type CCUFetchStatus = 'valid' | 'invalid' | 'error';

export type CCUValidationState =
  | 'confirmed_positive'
  | 'confirmed_zero'
  | 'suspect_zero'
  | 'invalid'
  | 'error';

/**
 * Result from a single CCU fetch with status tracking
 */
export interface CCUResultWithStatus {
  httpStatus?: number;
  rateLimited?: boolean;
  requestCount?: number;
  status: CCUFetchStatus;
  validationState: CCUValidationState;
  playerCount?: number;
}

/**
 * Fetch CCU with status tracking for skip logic
 *
 * Unlike fetchSteamCCU, this distinguishes between:
 * - invalid: result:42 (should skip for 30 days)
 * - error: network/timeout (should retry, NOT skip)
 *
 * @param appid - Steam app ID
 * @returns CCUResultWithStatus with status and optional player count
 */
export async function fetchSteamCCUWithStatus(appid: number): Promise<CCUResultWithStatus> {
  return fetchSteamCCUWithStatusOptions(appid, {});
}

async function fetchSteamCCUWithStatusOptions(
  appid: number,
  options: CCUFetchOptions
): Promise<CCUResultWithStatus> {
  const limiter = options.limiter ?? rateLimiters.steamCCU;
  await limiter.acquire();

  try {
    const result = await requestSteamCCU(appid);
    const base = {
      httpStatus: result.status,
      rateLimited: result.status === 429,
      requestCount: 1,
    };

    if (!result.data) {
      log.debug('Failed to parse CCU response body', { appid, status: result.status });
      return { ...base, status: 'error', validationState: 'error' };
    }

    // ONLY mark invalid if result === 42 (definitive from Steam)
    if (result.data.response.result === 42) {
      log.debug('Steam CCU returned invalid appid', { appid });
      return { ...base, status: 'invalid', validationState: 'invalid' };
    }

    // Success case
    if (result.data.response.result === 1) {
      let playerCount = result.data.response.player_count;

      if (options.confirmSuspiciousZero && playerCount === 0) {
        const confirmation = await confirmSuspiciousZero(appid, limiter);

        if (confirmation.playerCount !== null) {
          if (confirmation.playerCount > 0) {
            log.warn('Suspicious zero overridden after cache-busting recheck', {
              appid,
              initialPlayerCount: 0,
              confirmedPlayerCount: confirmation.playerCount,
            });
          } else {
            log.info('Suspicious zero confirmed after cache-busting recheck', { appid });
          }

          playerCount = confirmation.playerCount;
        } else {
          return {
            httpStatus: confirmation.httpStatus,
            rateLimited: base.rateLimited || confirmation.rateLimited,
            requestCount: base.requestCount + confirmation.requestCount,
            status: 'valid',
            validationState: 'suspect_zero',
            playerCount: 0,
          };
        }

        base.rateLimited = base.rateLimited || confirmation.rateLimited;
        base.requestCount += confirmation.requestCount;
      }

      return {
        ...base,
        status: 'valid',
        validationState: playerCount > 0 ? 'confirmed_positive' : 'confirmed_zero',
        playerCount,
      };
    }

    // Unknown response format - treat as error, NOT invalid
    log.debug('Steam CCU returned unexpected result', { appid, result: result.data.response.result });
    return { ...base, status: 'error', validationState: 'error' };
  } catch (error) {
    // Network error, timeout, etc. - NEVER mark as invalid
    log.debug('CCU fetch failed with network error', { appid, error });
    return { requestCount: 1, status: 'error', validationState: 'error' };
  }
}

/**
 * Result from batch CCU fetch with status tracking
 */
export interface CCUBatchResultWithStatus {
  /** Map of appid to result with status */
  results: Map<number, CCUResultWithStatus>;
  /** Number of valid fetches (result:1) */
  validCount: number;
  /** Number of invalid appids (result:42) */
  invalidCount: number;
  /** Number of errors (network/timeout) */
  errorCount: number;
  /** Number of HTTP 429 results observed */
  rateLimitedCount?: number;
  /** Total Steam requests, including suspicious-zero rechecks */
  requestCount?: number;
  /** Final adaptive requests-per-second setting for this batch */
  rpsFinal?: number;
}

/**
 * Fetch CCU for multiple apps with status tracking
 *
 * Returns detailed status for each appid to enable skip logic.
 *
 * @param appids - Array of Steam app IDs to fetch
 * @param onProgress - Optional callback for progress updates
 * @param shouldStop - Optional callback to check if we should stop early (for graceful shutdown)
 * @returns Map of appid to CCUResultWithStatus
 */
export async function fetchSteamCCUBatchWithStatus(
  appids: number[],
  onProgress?: (processed: number, total: number) => void,
  shouldStop?: () => boolean,
  options?: BatchCCUFetchOptions
): Promise<CCUBatchResultWithStatus> {
  const results = new Map<number, CCUResultWithStatus>();
  let validCount = 0;
  let invalidCount = 0;
  let errorCount = 0;
  let rateLimitedCount = 0;
  let requestCount = 0;
  let processedCount = 0;
  let rpsAdjustedForCaution = false;
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
  const adaptiveLimiter =
    options?.rpsInitial !== undefined
      ? new AdaptiveSteamCcuLimiter(
          options.rpsInitial,
          options.rpsMin ?? Math.min(options.rpsInitial, 1),
          options.rpsMax ?? options.rpsInitial
        )
      : null;
  const limiter = adaptiveLimiter ?? rateLimiters.steamCCU;
  const limit = pLimit(concurrency);
  let stopRequested = false;

  await Promise.all(
    appids.map((appid) =>
      limit(async () => {
        if (stopRequested || shouldStop?.()) {
          stopRequested = true;
          return;
        }

        const result = await fetchSteamCCUWithStatusOptions(appid, {
          confirmSuspiciousZero: options?.suspiciousZeroAppids?.has(appid) ?? false,
          limiter,
        });

        results.set(appid, result);

        if (result.status === 'valid') {
          validCount++;
        } else if (result.status === 'invalid') {
          invalidCount++;
        } else {
          errorCount++;
        }

        requestCount += result.requestCount ?? 1;
        if (result.rateLimited) {
          rateLimitedCount++;
          adaptiveLimiter?.halve();
        }

        processedCount++;
        const processedErrorRate = processedCount > 0 ? errorCount / processedCount : 0;
        if (
          adaptiveLimiter &&
          !rpsAdjustedForCaution &&
          (options?.cautionErrorRateThreshold ?? 1) <= processedErrorRate
        ) {
          adaptiveLimiter.halve();
          rpsAdjustedForCaution = true;
        }

        if (onProgress && processedCount % 100 === 0) {
          onProgress(processedCount, appids.length);
        }
      })
    )
  );

  if (stopRequested) {
    // Check for graceful shutdown before each request
    log.info('Graceful shutdown requested, stopping batch early', {
      processed: results.size,
      total: appids.length,
      validCount,
      invalidCount,
      errorCount,
    });
  }

  log.info('Batch CCU fetch with status complete', {
    total: appids.length,
    processed: results.size,
    validCount,
    invalidCount,
    errorCount,
    rateLimitedCount,
    requestCount,
    rpsFinal: adaptiveLimiter?.getRequestsPerSecond(),
  });

  return {
    results,
    validCount,
    invalidCount,
    errorCount,
    rateLimitedCount,
    requestCount,
    rpsFinal: adaptiveLimiter?.getRequestsPerSecond(),
  };
}

/**
 * Fetch CCU for multiple apps in sequence (rate limited)
 *
 * @param appids - Array of Steam app IDs to fetch
 * @param onProgress - Optional callback for progress updates
 * @returns Map of appid to player count (only includes successful fetches)
 */
export async function fetchSteamCCUBatch(
  appids: number[],
  onProgress?: (processed: number, total: number) => void,
  options?: BatchCCUFetchOptions
): Promise<CCUBatchResult> {
  const results = new Map<number, number>();
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < appids.length; i++) {
    const appid = appids[i];
    const result = await fetchSteamCCUWithStatusOptions(appid, {
      confirmSuspiciousZero: options?.suspiciousZeroAppids?.has(appid) ?? false,
    });

    if (result.status === 'valid' && result.playerCount !== undefined) {
      results.set(appid, result.playerCount);
      successCount++;
    } else {
      failedCount++;
    }

    if (onProgress && (i + 1) % 100 === 0) {
      onProgress(i + 1, appids.length);
    }
  }

  log.info('Batch CCU fetch complete', {
    total: appids.length,
    successCount,
    failedCount,
  });

  return { data: results, successCount, failedCount };
}
