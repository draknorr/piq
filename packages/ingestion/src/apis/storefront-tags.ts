import { createHash } from 'node:crypto';
import { API_URLS, logger, ParseError } from '@publisheriq/shared';
import { RateLimiter, rateLimiters } from '../utils/rate-limiter.js';

export const STOREFRONT_TAG_PARSER_VERSION = 'steam-store-page-tags/v1';

const DEFAULT_REQUEST_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RESPONSE_BYTES = 2_000_000;
const DEFAULT_MAX_RETRIES = 2;
const CIRCUIT_OPEN_MS = 15 * 60 * 1_000;
const CIRCUIT_WINDOW_MS = 10 * 60 * 1_000;

const log = logger.child({ component: 'StorefrontTags' });

interface AttemptLimiter {
  acquire(): Promise<void>;
}

export interface StorefrontTag {
  count: number;
  name: string;
  rank: number;
  tagid: number;
}

export interface StorefrontTagAttemptTelemetry {
  attempts: number;
  forbidden: number;
  networkErrors: number;
  parserFailures: number;
  rateLimited: number;
  retries: number;
  serverErrors: number;
  timeouts: number;
}

type StorefrontTagErrorCode =
  | 'circuit_open'
  | 'forbidden'
  | 'http_error'
  | 'network_error'
  | 'not_public'
  | 'parse_error'
  | 'rate_limited'
  | 'response_too_large'
  | 'timeout';

export type StorefrontTagFetchResult =
  | {
      appid: number;
      evidence: {
        country: 'us';
        locale: 'english';
        observedAt: string;
        pageUrl: string;
        parserVersion: typeof STOREFRONT_TAG_PARSER_VERSION;
        responseHash: string;
        tags: StorefrontTag[];
      };
      status: 'success';
      statusCode: number;
      telemetry: StorefrontTagAttemptTelemetry;
    }
  | {
      appid: number;
      circuitOpenUntil?: string;
      errorCode: StorefrontTagErrorCode;
      errorMessage: string;
      retryable: boolean;
      status: 'failed';
      statusCode?: number;
      telemetry: StorefrontTagAttemptTelemetry;
    };

export interface StorefrontTagFetchOptions {
  circuit?: StorefrontTagCircuit;
  fetchImpl?: typeof fetch;
  limiter?: AttemptLimiter;
  maxResponseBytes?: number;
  maxRetries?: number;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
  sharedStorefrontLimiter?: AttemptLimiter;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface StorefrontTagCircuitState {
  openUntilMs: number | null;
  opened: boolean;
  remainingMs: number;
}

export class StorefrontTagCircuit {
  private readonly blockingFailuresAt: number[] = [];
  private openUntilMs = 0;

  constructor(
    private readonly threshold = 2,
    private readonly windowMs = CIRCUIT_WINDOW_MS,
    private readonly openMs = CIRCUIT_OPEN_MS
  ) {}

  getState(nowMs = Date.now()): StorefrontTagCircuitState {
    const remainingMs = Math.max(0, this.openUntilMs - nowMs);
    return {
      openUntilMs: remainingMs > 0 ? this.openUntilMs : null,
      opened: remainingMs > 0,
      remainingMs,
    };
  }

  open(nowMs = Date.now()): StorefrontTagCircuitState {
    this.openUntilMs = Math.max(this.openUntilMs, nowMs + this.openMs);
    return this.getState(nowMs);
  }

  recordBlockingFailure(nowMs = Date.now()): StorefrontTagCircuitState {
    const windowStart = nowMs - this.windowMs;
    while (
      this.blockingFailuresAt.length > 0 &&
      (this.blockingFailuresAt[0] ?? nowMs) < windowStart
    ) {
      this.blockingFailuresAt.shift();
    }
    this.blockingFailuresAt.push(nowMs);
    if (this.blockingFailuresAt.length >= this.threshold) {
      return this.open(nowMs);
    }
    return this.getState(nowMs);
  }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createTagLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const intervalMs = Math.max(
    3_000,
    readPositiveInteger(env.STOREFRONT_TAG_REQUEST_INTERVAL_MS, DEFAULT_REQUEST_INTERVAL_MS)
  );
  return new RateLimiter({ requestsPerSecond: 1_000 / intervalMs, burst: 1 });
}

const defaultTagLimiter = createTagLimiter();
const defaultTagCircuit = new StorefrontTagCircuit();

function telemetry(): StorefrontTagAttemptTelemetry {
  return {
    attempts: 0,
    forbidden: 0,
    networkErrors: 0,
    parserFailures: 0,
    rateLimited: 0,
    retries: 0,
    serverErrors: 0,
    timeouts: 0,
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.message.includes('ETIMEDOUT'))
  );
}

function retryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - nowMs);
}

function retryDelayMs(retryIndex: number, random: () => number): number {
  const base = Math.min(30_000, 1_000 * 2 ** retryIndex);
  return Math.max(0, Math.round(base * (0.9 + random() * 0.2)));
}

function failed(
  appid: number,
  attemptTelemetry: StorefrontTagAttemptTelemetry,
  params: {
    circuit?: StorefrontTagCircuitState;
    errorCode: StorefrontTagErrorCode;
    errorMessage: string;
    retryable: boolean;
    statusCode?: number;
  }
): StorefrontTagFetchResult {
  return {
    appid,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    retryable: params.retryable,
    status: 'failed',
    telemetry: attemptTelemetry,
    ...(params.statusCode === undefined ? {} : { statusCode: params.statusCode }),
    ...(params.circuit?.openUntilMs
      ? { circuitOpenUntil: new Date(params.circuit.openUntilMs).toISOString() }
      : {}),
  };
}

function extractJsonArray(html: string, appid: number): string {
  const marker = 'InitAppTagModal';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new ParseError('Steam page did not contain InitAppTagModal', {
      appid,
    });
  }

  const call = html.slice(markerIndex + marker.length);
  const prefix = call.match(/^\s*\(\s*(\d+)\s*,/);
  if (!prefix) {
    throw new ParseError('Steam tag modal call did not contain an app ID', {
      appid,
    });
  }
  const modalAppid = Number(prefix[1]);
  if (modalAppid !== appid) {
    throw new ParseError('Steam tag modal app ID did not match the requested app', {
      appid,
      modalAppid,
    });
  }

  const arrayStart = call.indexOf('[', prefix[0].length);
  if (arrayStart < 0) {
    throw new ParseError('Steam tag modal did not contain a tag array', {
      appid,
    });
  }

  let depth = 0;
  let escaped = false;
  let quoted = false;
  for (let index = arrayStart; index < call.length; index += 1) {
    const character = call[index]!;
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return call.slice(arrayStart, index + 1);
      }
    }
  }

  throw new ParseError('Steam tag modal tag array was truncated', { appid });
}

export function parseStorefrontTagPage(html: string, appid: number): StorefrontTag[] {
  const json = extractJsonArray(html, appid);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new ParseError('Steam tag modal contained invalid JSON', {
      appid,
      error,
    });
  }

  if (!Array.isArray(value) || value.length > 50) {
    throw new ParseError('Steam tag modal contained an invalid tag collection', { appid });
  }

  const seenTagIds = new Set<number>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ParseError('Steam tag modal contained an invalid tag item', {
        appid,
        index,
      });
    }
    const record = item as Record<string, unknown>;
    const tagid = Number(record.tagid);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const count = Number(record.count);
    if (
      !Number.isSafeInteger(tagid) ||
      tagid <= 0 ||
      !name ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      seenTagIds.has(tagid)
    ) {
      throw new ParseError('Steam tag modal contained malformed or duplicate tag data', {
        appid,
        index,
      });
    }
    seenTagIds.add(tagid);
    return { count, name, rank: index + 1, tagid };
  });
}

export async function fetchStorefrontTags(
  appid: number,
  options: StorefrontTagFetchOptions = {}
): Promise<StorefrontTagFetchResult> {
  if (!Number.isSafeInteger(appid) || appid <= 0) {
    throw new Error(`Invalid Steam app ID: ${appid}`);
  }

  const attemptTelemetry = telemetry();
  const circuit = options.circuit ?? defaultTagCircuit;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter ?? defaultTagLimiter;
  const sharedLimiter = options.sharedStorefrontLimiter ?? rateLimiters.storefront;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const userAgent =
    options.userAgent ??
    process.env.STOREFRONT_TAG_USER_AGENT ??
    'PublisherIQ/1.0 Steam tag evidence collector';
  const pageUrl = `${API_URLS.STEAM_STORE}/app/${appid}/?l=english&cc=us`;

  for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex += 1) {
    const attemptStartedAt = now();
    const circuitState = circuit.getState(attemptStartedAt);
    if (circuitState.opened) {
      return failed(appid, attemptTelemetry, {
        circuit: circuitState,
        errorCode: 'circuit_open',
        errorMessage: 'Steam Store tag circuit is open',
        retryable: true,
      });
    }

    await limiter.acquire();
    await sharedLimiter.acquire();
    attemptTelemetry.attempts += 1;

    let response: Response;
    try {
      response = await fetchImpl(pageUrl, {
        headers: {
          Cookie: 'birthtime=0; mature_content=1',
          'User-Agent': userAgent,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      if (timedOut) {
        attemptTelemetry.timeouts += 1;
      } else {
        attemptTelemetry.networkErrors += 1;
      }
      if (retryIndex < maxRetries) {
        attemptTelemetry.retries += 1;
        await sleep(retryDelayMs(retryIndex, random));
        continue;
      }
      return failed(appid, attemptTelemetry, {
        errorCode: timedOut ? 'timeout' : 'network_error',
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }

    if (response.status === 403) {
      attemptTelemetry.forbidden += 1;
      const state = circuit.recordBlockingFailure(now());
      return failed(appid, attemptTelemetry, {
        circuit: state,
        errorCode: 'forbidden',
        errorMessage: `Steam Store returned HTTP 403 for app ${appid}`,
        retryable: true,
        statusCode: response.status,
      });
    }
    if (response.status === 429) {
      attemptTelemetry.rateLimited += 1;
      const state = circuit.recordBlockingFailure(now());
      if (retryIndex < maxRetries && !state.opened) {
        attemptTelemetry.retries += 1;
        await sleep(
          retryAfterMs(response.headers.get('retry-after'), now()) ??
            retryDelayMs(retryIndex, random)
        );
        continue;
      }
      return failed(appid, attemptTelemetry, {
        circuit: state,
        errorCode: 'rate_limited',
        errorMessage: `Steam Store returned HTTP 429 for app ${appid}`,
        retryable: true,
        statusCode: response.status,
      });
    }
    if (response.status === 404 || response.status === 410) {
      return failed(appid, attemptTelemetry, {
        errorCode: 'not_public',
        errorMessage: `Steam Store page is not public for app ${appid}`,
        retryable: false,
        statusCode: response.status,
      });
    }
    if (response.status >= 500) {
      attemptTelemetry.serverErrors += 1;
      const state = circuit.recordBlockingFailure(now());
      if (retryIndex < maxRetries && !state.opened) {
        attemptTelemetry.retries += 1;
        await sleep(retryDelayMs(retryIndex, random));
        continue;
      }
      return failed(appid, attemptTelemetry, {
        circuit: state,
        errorCode: 'http_error',
        errorMessage: `Steam Store returned HTTP ${response.status} for app ${appid}`,
        retryable: true,
        statusCode: response.status,
      });
    }
    if (!response.ok) {
      return failed(appid, attemptTelemetry, {
        errorCode: 'http_error',
        errorMessage: `Steam Store returned HTTP ${response.status} for app ${appid}`,
        retryable: false,
        statusCode: response.status,
      });
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      return failed(appid, attemptTelemetry, {
        errorCode: 'response_too_large',
        errorMessage: `Steam Store response exceeded ${maxResponseBytes} bytes`,
        retryable: false,
        statusCode: response.status,
      });
    }

    const html = await response.text();
    const responseBytes = Buffer.byteLength(html, 'utf8');
    if (responseBytes > maxResponseBytes) {
      return failed(appid, attemptTelemetry, {
        errorCode: 'response_too_large',
        errorMessage: `Steam Store response exceeded ${maxResponseBytes} bytes`,
        retryable: false,
        statusCode: response.status,
      });
    }

    try {
      const tags = parseStorefrontTagPage(html, appid);
      return {
        appid,
        evidence: {
          country: 'us',
          locale: 'english',
          observedAt: new Date(now()).toISOString(),
          pageUrl,
          parserVersion: STOREFRONT_TAG_PARSER_VERSION,
          responseHash: createHash('sha256').update(html).digest('hex'),
          tags,
        },
        status: 'success',
        statusCode: response.status,
        telemetry: attemptTelemetry,
      };
    } catch (error) {
      attemptTelemetry.parserFailures += 1;
      const state = circuit.open(now());
      log.error('Failed to parse Steam Store tag page', { appid, error });
      return failed(appid, attemptTelemetry, {
        circuit: state,
        errorCode: 'parse_error',
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: false,
        statusCode: response.status,
      });
    }
  }

  return failed(appid, attemptTelemetry, {
    errorCode: 'network_error',
    errorMessage: 'Steam Store tag request exhausted attempts',
    retryable: true,
  });
}
