import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type ReviewLane =
  | 'launch_critical'
  | 'change_critical'
  | 'active_reviews'
  | 'important_backfill'
  | 'unknown_sweep';

export interface ClaimedReviewApp {
  appid: number;
  lane: ReviewLane;
  priority_score: number;
  velocity_tier: string;
  hours_overdue: number;
  last_known_total_reviews: number | null;
  last_reviews_sync: string | null;
}

export interface AcquireApiRateTokenResult {
  granted: boolean;
  waitMs: number;
}

export interface ReviewsQueueLaneHealth {
  lane: ReviewLane;
  dueCount: number;
  oldestDueHours: number | null;
}

export interface ReviewsQueueHealth {
  evaluatedAt: string;
  lanes: ReviewsQueueLaneHealth[];
  stuckClaimCount: number;
  oldestStuckClaimMinutes: number | null;
}

interface ClaimedReviewAppRow extends QueryResultRow {
  appid: number;
  lane: ReviewLane;
  priority_score: number;
  velocity_tier: string;
  hours_overdue: string | number;
  last_known_total_reviews: number | null;
  last_reviews_sync: Date | string | null;
}

interface AcquireApiRateTokenRow extends QueryResultRow {
  granted: boolean;
  wait_ms: number | string | null;
}

interface RefreshReviewVelocityStatsOptions {
  timeoutMs?: number;
}

interface UpdateReviewVelocityTiersRow extends QueryResultRow {
  count: number | string;
}

interface ReviewsQueueLaneHealthRow extends QueryResultRow {
  lane: ReviewLane;
  due_count: number | string;
  oldest_due_hours: number | string | null;
}

interface ReviewsQueueHealthStuckRow extends QueryResultRow {
  stuck_claim_count: number | string;
  oldest_stuck_claim_minutes: number | string | null;
}

const DEFAULT_POOL_MAX = 3;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const CLAIM_TIMEOUT_MS = 60_000;
const TOKEN_TIMEOUT_MS = 5_000;
const RELEASE_CLAIMS_TIMEOUT_MS = 15_000;
const QUEUE_HEALTH_TIMEOUT_MS = 60_000;
const VELOCITY_REFRESH_TIMEOUT_MS = 600_000;
const VELOCITY_UPDATE_TIMEOUT_MS = 600_000;

let ingestionPool: Pool | null = null;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable');
  }

  return databaseUrl;
}

function parseNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function parseOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = parseNumber(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function createIngestionPool(): Pool {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: DEFAULT_POOL_MAX,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: true,
  });

  pool.on('error', (error: Error) => {
    console.error('[database/ingestion] Unexpected Postgres pool error', error);
  });

  return pool;
}

function getIngestionPool(): Pool {
  if (!ingestionPool) {
    ingestionPool = createIngestionPool();
  }

  return ingestionPool;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getIngestionPool().connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function setLocalStatementTimeout(
  client: PoolClient,
  timeoutMs: number
): Promise<void> {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
}

async function withTransaction<T>(
  timeoutMs: number,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');

    try {
      await setLocalStatementTimeout(client, timeoutMs);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function withSessionStatementTimeout<T>(
  timeoutMs: number,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
    const previousTimeout = rows[0]?.statement_timeout ?? '0';

    await client.query("SELECT set_config('statement_timeout', $1, false)", [`${timeoutMs}ms`]);

    try {
      return await fn(client);
    } finally {
      await client.query("SELECT set_config('statement_timeout', $1, false)", [previousTimeout]);
    }
  });
}

export async function claimAppsForReviewsSync(params: {
  workerId: string;
  limit: number;
  claimTtlMinutes: number;
}): Promise<ClaimedReviewApp[]> {
  return withTransaction(CLAIM_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<ClaimedReviewAppRow>(
      `
        SELECT
          appid,
          lane,
          priority_score,
          velocity_tier,
          hours_overdue,
          last_known_total_reviews,
          last_reviews_sync
        FROM claim_apps_for_reviews_sync($1, $2, $3)
      `,
      [params.workerId, params.limit, params.claimTtlMinutes]
    );

    return rows.map((row: ClaimedReviewAppRow) => ({
      appid: row.appid,
      lane: row.lane,
      priority_score: row.priority_score,
      velocity_tier: row.velocity_tier,
      hours_overdue: parseNumber(row.hours_overdue),
      last_known_total_reviews: row.last_known_total_reviews,
      last_reviews_sync: normalizeTimestamp(row.last_reviews_sync),
    }));
  });
}

export async function acquireApiRateToken(params: {
  source: string;
  workerId: string;
}): Promise<AcquireApiRateTokenResult> {
  return withTransaction(TOKEN_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<AcquireApiRateTokenRow>(
      `
        SELECT granted, wait_ms
        FROM acquire_api_rate_token($1, $2)
      `,
      [params.source, params.workerId]
    );

    const row = rows[0];

    return {
      granted: Boolean(row?.granted),
      waitMs: Math.max(0, parseNumber(row?.wait_ms)),
    };
  });
}

export async function releaseReviewClaims(params: {
  appids: number[];
  workerId: string;
}): Promise<number> {
  if (params.appids.length === 0) {
    return 0;
  }

  return withTransaction(RELEASE_CLAIMS_TIMEOUT_MS, async (client) => {
    const result = await client.query(
      `
        UPDATE sync_status
        SET
          reviews_claimed_by = NULL,
          reviews_claimed_at = NULL,
          reviews_claim_expires_at = NULL
        WHERE appid = ANY($1::INT[])
          AND reviews_claimed_by = $2
      `,
      [params.appids, params.workerId]
    );

    return result.rowCount ?? 0;
  });
}

export async function refreshReviewVelocityStats(
  options: RefreshReviewVelocityStatsOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? VELOCITY_REFRESH_TIMEOUT_MS;

  await withSessionStatementTimeout(timeoutMs, async (client) => {
    try {
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY review_velocity_stats');
    } catch {
      await client.query('REFRESH MATERIALIZED VIEW review_velocity_stats');
    }
  });
}

export async function updateReviewVelocityTiers(): Promise<number> {
  return withTransaction(VELOCITY_UPDATE_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<UpdateReviewVelocityTiersRow>(
      'SELECT count FROM update_review_velocity_tiers()'
    );

    return parseNumber(rows[0]?.count);
  });
}

export async function getReviewsQueueHealth(): Promise<ReviewsQueueHealth> {
  return withTransaction(QUEUE_HEALTH_TIMEOUT_MS, async (client) => {
    const { rows: laneRows } = await client.query<ReviewsQueueLaneHealthRow>(`
      WITH review_due_base AS (
        SELECT
          CASE
            WHEN s.reviews_priority_override_until IS NOT NULL
                 AND s.reviews_priority_override_until > NOW()
                 AND s.reviews_priority_override_bucket IS NOT NULL
            THEN s.reviews_priority_override_bucket
            WHEN COALESCE(a.is_released, FALSE) = TRUE
                 AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
            THEN 'launch_critical'
            WHEN COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                 OR COALESCE(at.review_velocity_7d, s.velocity_7d, 0) >= 1
            THEN 'active_reviews'
            WHEN COALESCE(s.priority_score, 0) >= 50
                 OR COALESCE(ct.ccu_tier, 99) IN (1, 2)
                 OR COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) >= 1000
            THEN 'important_backfill'
            ELSE 'unknown_sweep'
          END::TEXT AS lane,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(s.next_reviews_sync, NOW()))) / 3600.0 AS hours_overdue
        FROM sync_status s
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN app_trends at ON at.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        LEFT JOIN ccu_tier_assignments ct ON ct.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= NOW())
          AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= NOW())
      )
      SELECT
        lane,
        COUNT(*)::INT AS due_count,
        MAX(hours_overdue) AS oldest_due_hours
      FROM review_due_base
      GROUP BY lane
    `);

    const { rows: stuckRows } = await client.query<ReviewsQueueHealthStuckRow>(`
      SELECT
        COUNT(*)::INT AS stuck_claim_count,
        MAX(EXTRACT(EPOCH FROM (NOW() - reviews_claim_expires_at)) / 60.0) AS oldest_stuck_claim_minutes
      FROM sync_status
      WHERE reviews_claim_expires_at IS NOT NULL
        AND reviews_claim_expires_at < NOW()
    `);

    const laneDefaults: ReviewLane[] = [
      'launch_critical',
      'change_critical',
      'active_reviews',
      'important_backfill',
      'unknown_sweep',
    ];

    const laneMap = new Map<ReviewLane, ReviewsQueueLaneHealth>();
    for (const lane of laneDefaults) {
      laneMap.set(lane, {
        lane,
        dueCount: 0,
        oldestDueHours: null,
      });
    }

    for (const row of laneRows) {
      laneMap.set(row.lane, {
        lane: row.lane,
        dueCount: parseNumber(row.due_count),
        oldestDueHours: parseOptionalNumber(row.oldest_due_hours),
      });
    }

    const stuck = stuckRows[0];

    return {
      evaluatedAt: new Date().toISOString(),
      lanes: laneDefaults.map((lane) => laneMap.get(lane)!),
      stuckClaimCount: parseNumber(stuck?.stuck_claim_count),
      oldestStuckClaimMinutes: parseOptionalNumber(stuck?.oldest_stuck_claim_minutes),
    };
  });
}
