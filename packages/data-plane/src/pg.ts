import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadDataPlaneConfig, type DataPlaneConfig } from './config.js';

let pool: Pool | null = null;

export function getDataPlanePool(config: DataPlaneConfig = loadDataPlaneConfig()): Pool {
  if (!pool) {
    pool = new Pool({
      application_name: 'publisheriq-data-plane',
      connectionString: config.connectionString,
      max: config.maxPoolSize,
      statement_timeout: config.statementTimeoutMs,
    });

    pool.on('error', (error) => {
      logger.error('Data-plane pool error', { error });
    });
  }

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
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
