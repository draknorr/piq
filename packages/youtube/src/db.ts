import { Pool } from 'pg';

export function createPgPool(params: {
  connectionString: string;
  applicationName: string;
  statementTimeoutMs: number;
}): Pool {
  return new Pool({
    application_name: params.applicationName,
    connectionString: params.connectionString,
    max: 10,
    statement_timeout: params.statementTimeoutMs,
  });
}

export async function closePools(pools: Array<Pool | null | undefined>): Promise<void> {
  await Promise.all(
    pools
      .filter((pool): pool is Pool => Boolean(pool))
      .map(async (pool) => pool.end())
  );
}
