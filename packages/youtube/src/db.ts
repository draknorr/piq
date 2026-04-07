import { Pool } from 'pg';

const closingPools = new WeakSet<Pool>();
const closedPools = new WeakSet<Pool>();

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
  const uniquePools = [...new Set(pools.filter((pool): pool is Pool => Boolean(pool)))];

  await Promise.all(
    uniquePools.map(async (pool) => {
      if (closingPools.has(pool) || closedPools.has(pool)) {
        return;
      }

      closingPools.add(pool);
      try {
        await pool.end();
        closedPools.add(pool);
      } finally {
        closingPools.delete(pool);
      }
    })
  );
}
