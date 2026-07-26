import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadDataPlaneConfig, type DataPlaneConfig } from './config.js';

const pools = new Map<string, Pool>();

export function getDataPlanePool(config: DataPlaneConfig = loadDataPlaneConfig()): Pool {
  const key = poolKey(config);
  const existing = pools.get(key);
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    application_name: 'publisheriq-data-plane',
    connectionString: config.connectionString,
    max: config.maxPoolSize,
    statement_timeout: config.statementTimeoutMs,
  });

  pool.on('error', (error) => {
    logger.error('Data-plane pool error', { error });
  });

  pools.set(key, pool);
  return pool;
}

export async function withClient<T>(
  callback: (client: PoolClient) => Promise<T>,
  config: DataPlaneConfig = loadDataPlaneConfig()
): Promise<T> {
  const client = await getDataPlanePool(config).connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function runQuery<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  config: DataPlaneConfig = loadDataPlaneConfig()
): Promise<QueryResult<T>> {
  return withClient((client) => client.query<T>(sql, values), config);
}

export async function shutdownPool(): Promise<void> {
  if (pools.size === 0) {
    return;
  }

  const openPools = [...pools.values()];
  pools.clear();
  await Promise.all(openPools.map((pool) => pool.end()));
}

function poolKey(config: DataPlaneConfig): string {
  return [
    config.source,
    config.connectionString,
    config.maxPoolSize,
    config.statementTimeoutMs,
  ].join('\0');
}
