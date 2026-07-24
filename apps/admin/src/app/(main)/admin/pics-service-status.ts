import type { PicsServiceProgress } from './pics-health';

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 10_000;

interface PicsStatusPayload {
  status?: unknown;
  health_state?: unknown;
  updated_at?: unknown;
}

export interface PicsServiceStatus extends PicsServiceProgress {
  error: 'not_configured' | 'unreachable' | 'invalid_response' | null;
}

interface PicsServiceStatusOptions {
  url?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function unavailableStatus(
  configured: boolean,
  error: PicsServiceStatus['error']
): PicsServiceStatus {
  return {
    configured,
    reachable: false,
    status: null,
    healthState: null,
    updatedAt: null,
    error,
  };
}

function readTimeoutMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(parsed, MAX_TIMEOUT_MS);
}

export async function getPicsServiceStatus(
  options: PicsServiceStatusOptions = {}
): Promise<PicsServiceStatus> {
  const configuredUrl =
    options.url === undefined ? process.env.PICS_STATUS_URL : options.url;
  const url = configuredUrl?.trim() || null;
  if (!url) {
    return unavailableStatus(false, 'not_configured');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.timeoutMs ?? readTimeoutMs(process.env.PICS_STATUS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return unavailableStatus(true, 'unreachable');
    }

    const payload = (await response.json()) as PicsStatusPayload;
    const status = typeof payload.status === 'string' ? payload.status : null;
    const healthState =
      typeof payload.health_state === 'string' ? payload.health_state : null;
    const updatedAt =
      typeof payload.updated_at === 'string' ? payload.updated_at : null;

    if (!status || !healthState || !updatedAt) {
      return {
        configured: true,
        reachable: true,
        status,
        healthState,
        updatedAt,
        error: 'invalid_response',
      };
    }

    return {
      configured: true,
      reachable: true,
      status,
      healthState,
      updatedAt,
      error: null,
    };
  } catch {
    return unavailableStatus(true, 'unreachable');
  }
}
