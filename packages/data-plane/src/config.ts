import type { DataPlaneSource } from './contracts.js';

const DEFAULT_MAX_POOL_SIZE = 10;
const DEFAULT_QUERY_API_HOST = '0.0.0.0';
const DEFAULT_QUERY_API_PORT = 4318;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface DataPlaneConfig {
  connectionString: string;
  maxPoolSize: number;
  source: DataPlaneSource;
  statementTimeoutMs: number;
}

export interface QueryApiConfig extends DataPlaneConfig {
  bearerToken: string | null;
  host: string;
  port: number;
}

function buildConfig(
  connectionString: string,
  source: DataPlaneSource,
  env: NodeJS.ProcessEnv
): DataPlaneConfig {
  return {
    connectionString,
    maxPoolSize: readNumber(env.DATA_PLANE_MAX_POOL_SIZE, DEFAULT_MAX_POOL_SIZE),
    source,
    statementTimeoutMs: readNumber(
      env.DATA_PLANE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS
    ),
  };
}

export function loadDataPlaneConfig(
  env: NodeJS.ProcessEnv = process.env
): DataPlaneConfig {
  const connectionString =
    env.TIGER_PRIMARY_URL ??
    env.DATA_PLANE_SOURCE_URL ??
    env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'Missing TIGER_PRIMARY_URL, DATA_PLANE_SOURCE_URL, or DATABASE_URL.'
    );
  }

  const source: DataPlaneSource =
    env.TIGER_PRIMARY_URL || env.DATA_PLANE_SOURCE_KIND === 'tiger'
      ? 'tiger'
      : 'supabase-postgres';

  return buildConfig(connectionString, source, env);
}

export function loadSourceBaselineConfig(
  env: NodeJS.ProcessEnv = process.env
): DataPlaneConfig {
  const connectionString = env.DATA_PLANE_SOURCE_URL ?? env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Missing DATA_PLANE_SOURCE_URL or DATABASE_URL.');
  }

  const source: DataPlaneSource =
    env.DATA_PLANE_SOURCE_KIND === 'tiger' ? 'tiger' : 'supabase-postgres';

  return buildConfig(connectionString, source, env);
}

export function loadTigerConfig(
  env: NodeJS.ProcessEnv = process.env
): DataPlaneConfig {
  const connectionString = env.TIGER_PRIMARY_URL;

  if (!connectionString) {
    throw new Error('Missing TIGER_PRIMARY_URL.');
  }

  return buildConfig(connectionString, 'tiger', env);
}

export function loadReadonlyAnalysisConfig(
  env: NodeJS.ProcessEnv = process.env
): DataPlaneConfig {
  const connectionString = env.RESEARCH_SQL_DATABASE_URL?.trim();
  if (!connectionString) {
    return loadDataPlaneConfig(env);
  }

  return buildConfig(connectionString, 'tiger', env);
}

export function loadQueryApiConfig(
  env: NodeJS.ProcessEnv = process.env
): QueryApiConfig {
  const base = loadDataPlaneConfig(env);
  const port = env.QUERY_API_PORT ?? env.PORT;

  return {
    ...base,
    bearerToken: env.QUERY_API_BEARER_TOKEN ?? null,
    host: env.QUERY_API_HOST ?? DEFAULT_QUERY_API_HOST,
    port: readNumber(port, DEFAULT_QUERY_API_PORT),
  };
}
