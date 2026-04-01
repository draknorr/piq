import 'server-only';

const DEFAULT_QUERY_API_BASE_URL = 'http://127.0.0.1:4318';

export interface QueryApiCallResult<T> {
  data?: T;
  errorCode?: string | null;
  httpStatus: number | null;
  ok: boolean;
  reason?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function postToQueryApi<T>(
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<QueryApiCallResult<T>> {
  const baseUrl = process.env.QUERY_API_BASE_URL?.trim() || DEFAULT_QUERY_API_BASE_URL;
  const headers: HeadersInit = {
    'content-type': 'application/json',
  };

  const bearerToken = process.env.QUERY_API_BEARER_TOKEN?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  try {
    const response = await fetch(new URL(path, baseUrl), {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers,
      method: 'POST',
      signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        errorCode:
          isRecord(payload) && typeof payload.code === 'string'
            ? payload.code
            : null,
        httpStatus: response.status,
        ok: false,
        reason:
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`,
      };
    }

    return {
      data: payload as T,
      httpStatus: response.status,
      ok: true,
    };
  } catch (error) {
    return {
      errorCode: null,
      httpStatus: null,
      ok: false,
      reason: error instanceof Error ? error.message : 'Unknown query-api error',
    };
  }
}
