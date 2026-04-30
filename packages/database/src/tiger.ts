import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const DEFAULT_POOL_MAX = 5;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

let tigerPool: Pool | null = null;

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function requireTigerPrimaryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.TIGER_PRIMARY_URL ?? env.CHANGE_INTEL_TIGER_URL;
  if (!url) {
    throw new Error('Missing TIGER_PRIMARY_URL or CHANGE_INTEL_TIGER_URL.');
  }

  return url;
}

export function getTigerPool(env: NodeJS.ProcessEnv = process.env): Pool {
  if (!tigerPool) {
    tigerPool = new Pool({
      application_name: env.TIGER_APPLICATION_NAME ?? 'publisheriq-tiger-writer',
      connectionString: requireTigerPrimaryUrl(env),
      max: readNumber(env.TIGER_POOL_MAX, DEFAULT_POOL_MAX),
      statement_timeout: readNumber(
        env.TIGER_STATEMENT_TIMEOUT_MS,
        DEFAULT_STATEMENT_TIMEOUT_MS
      ),
    });
  }

  return tigerPool;
}

export async function withTigerClient<T>(
  callback: (client: PoolClient) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T> {
  const client = await getTigerPool(env).connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function withTigerTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T> {
  return withTigerClient(async (client) => {
    await client.query('BEGIN');

    try {
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }, env);
}

export async function runTigerQuery<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  env: NodeJS.ProcessEnv = process.env
): Promise<QueryResult<T>> {
  return withTigerClient((client) => client.query<T>(sql, values), env);
}

export async function shutdownTigerPool(): Promise<void> {
  if (!tigerPool) {
    return;
  }

  await tigerPool.end();
  tigerPool = null;
}
