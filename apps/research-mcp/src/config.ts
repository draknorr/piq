export type ResearchMcpRole = 'admin' | 'internal' | 'researcher';

export interface ResearchMcpConfig {
  bearerToken: string | null;
  defaultRole: ResearchMcpRole;
  host: string;
  port: number;
  queryApiBaseUrl: string;
  queryApiBearerToken: string | null;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRole(value: string | undefined): ResearchMcpRole {
  return value === 'admin' || value === 'researcher' || value === 'internal'
    ? value
    : 'internal';
}

export function loadResearchMcpConfig(env: NodeJS.ProcessEnv = process.env): ResearchMcpConfig {
  const queryApiBaseUrl = env.QUERY_API_BASE_URL?.trim();
  if (!queryApiBaseUrl) {
    throw new Error('Missing QUERY_API_BASE_URL for research MCP gateway.');
  }

  return {
    bearerToken: env.RESEARCH_MCP_BEARER_TOKEN?.trim() || null,
    defaultRole: readRole(env.RESEARCH_MCP_DEFAULT_ROLE),
    host: env.RESEARCH_MCP_HOST ?? '0.0.0.0',
    port: readNumber(env.RESEARCH_MCP_PORT ?? env.PORT, 4320),
    queryApiBaseUrl,
    queryApiBearerToken: env.QUERY_API_BEARER_TOKEN?.trim() || null,
  };
}
