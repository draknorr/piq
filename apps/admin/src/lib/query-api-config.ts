const LOCAL_QUERY_API_BASE_URL = 'http://127.0.0.1:4318';
const DEPLOYED_VERCEL_ENVS = new Set(['preview', 'production']);

export interface ResolvedQueryApiBaseUrl {
  baseUrl: string | null;
  reason: string | null;
}

export function resolveQueryApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): ResolvedQueryApiBaseUrl {
  const explicitBaseUrl = env.QUERY_API_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return {
      baseUrl: explicitBaseUrl,
      reason: null,
    };
  }

  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv && DEPLOYED_VERCEL_ENVS.has(vercelEnv)) {
    return {
      baseUrl: null,
      reason: 'QUERY_API_BASE_URL must be set for Vercel preview and production deployments.',
    };
  }

  return {
    baseUrl: LOCAL_QUERY_API_BASE_URL,
    reason: null,
  };
}
