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

export interface ClaimAppsForReviewsSyncParams {
  workerId: string;
  limit: number;
  claimTtlMinutes: number;
  launchLimit?: number;
  changeLimit?: number;
  activeLimit?: number;
  backfillLimit?: number;
  unknownLimit?: number;
}

export interface AcquireApiRateTokenResult {
  granted: boolean;
  waitMs: number;
}

export interface InterpolationBatchResult {
  apps_processed: number;
  has_more: boolean;
  last_appid: number | null;
  total_interpolated: number;
}

export interface RunInterpolationReviewDeltasBatchParams {
  afterAppId: number;
  appLimit: number;
  endDate: string;
  startDate: string;
  timeoutMs?: number;
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

export interface VelocityTierUpdateBatchResult {
  updatedCount: number;
}

export interface RecalculateCcuTiersResult {
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
}

export interface RefreshMaterializedViewOptions {
  concurrently?: boolean;
  fallbackToNonConcurrent?: boolean;
  lockTimeoutMs?: number;
  timeoutMs?: number;
}

export interface RefreshCcuQualityStatsOptions {
  timeoutMs?: number;
}

export interface ReviewVelocityTierDistribution {
  dormant: number;
  high: number;
  low: number;
  medium: number;
  unknown: number;
}

export interface ReviewTruthRepairCandidate {
  appid: number;
  currentTotalReviews: number;
  lastReviewsSync: string | null;
  lastSteamspySync: string;
}

export type CcuRepairSource = 'steam_api' | 'steamspy';

export interface CcuProvenanceRepairCandidate {
  appid: number;
  ccuPeak: number;
  inferredSource: CcuRepairSource;
  metricDate: string;
}

export interface CcuValidationBackfillCandidate {
  appid: number;
  ccuFetchStatus: string | null;
  ccuPeak: number | null;
  ccuSource: string | null;
  existingValidationAt: string | null;
  existingValidationState: string | null;
  lastCcuSynced: string | null;
  latestPositiveSnapshotAt: string | null;
  metricDate: string | null;
  updatedAt: string | null;
}

export interface NewsCatchupCandidate {
  appid: number;
  lastNewsSync: string | null;
  lastStorefrontSync: string;
}

export interface HotNewsRefreshCandidate {
  appid: number;
  lastNewsSync: string | null;
  lastStorefrontSync: string;
  refreshTier: string | null;
  isLaunchWindow: boolean;
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

interface InterpolationBatchRow extends QueryResultRow {
  apps_processed: number | string;
  has_more: boolean | string | null;
  last_appid: number | string | null;
  total_interpolated: number | string;
}

interface UpdateReviewVelocityTiersRow extends QueryResultRow {
  count: number | string;
}

interface UpdateReviewVelocityTiersBatchRow extends QueryResultRow {
  updated_count: number | string;
}

interface RecalculateCcuTiersRow extends QueryResultRow {
  tier1_count: number | string;
  tier2_count: number | string;
  tier3_count: number | string;
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

interface ReviewVelocityTierDistributionRow extends QueryResultRow {
  count: number | string;
  tier: string | null;
}

interface ReviewTruthRepairCandidateRow extends QueryResultRow {
  appid: number;
  current_total_reviews: number | string;
  last_reviews_sync: Date | string | null;
  last_steamspy_sync: Date | string;
}

interface CcuProvenanceRepairCandidateRow extends QueryResultRow {
  appid: number;
  ccu_peak: number | string;
  inferred_source: CcuRepairSource;
  metric_date: string;
}

interface CcuValidationBackfillCandidateRow extends QueryResultRow {
  appid: number;
  ccu_fetch_status: string | null;
  ccu_peak: number | string | null;
  ccu_source: string | null;
  existing_validation_at: Date | string | null;
  existing_validation_state: string | null;
  last_ccu_synced: Date | string | null;
  latest_positive_snapshot_at: Date | string | null;
  metric_date: string | null;
  updated_at: Date | string | null;
}

interface NewsCatchupCandidateRow extends QueryResultRow {
  appid: number;
  last_news_sync: Date | string | null;
  last_storefront_sync: Date | string;
}

interface HotNewsRefreshCandidateRow extends QueryResultRow {
  appid: number;
  last_news_sync: Date | string | null;
  last_storefront_sync: Date | string;
  refresh_tier: string | null;
  is_launch_window: boolean;
}

const DEFAULT_POOL_MAX = 3;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const CLAIM_TIMEOUT_MS = 60_000;
const TOKEN_TIMEOUT_MS = 5_000;
const RELEASE_CLAIMS_TIMEOUT_MS = 15_000;
const QUEUE_HEALTH_TIMEOUT_MS = 60_000;
const CCU_REPAIR_QUERY_TIMEOUT_MS = 300_000;
const INTERPOLATION_BATCH_TIMEOUT_MS = 60_000;
const VELOCITY_REFRESH_TIMEOUT_MS = 600_000;
const VELOCITY_UPDATE_TIMEOUT_MS = 600_000;
const CCU_TIER_RECALC_TIMEOUT_MS = 300_000;
const CCU_QUALITY_REFRESH_TIMEOUT_MS = 600_000;
const MATVIEW_REFRESH_TIMEOUT_MS = 900_000;
const MATVIEW_LOCK_TIMEOUT_MS = 15_000;

let ingestionPool: Pool | null = null;

export class InterpolationBatchTimeoutError extends Error {
  readonly code = '57014';
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'InterpolationBatchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ClaimAppsTimeoutError extends Error {
  readonly code = '57014';
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'ClaimAppsTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function requireDatabaseUrl(): string {
  if (
    process.env.DATA_WRITE_TARGET?.trim().toLowerCase() === 'tiger' &&
    process.env.TIGER_PRIMARY_URL
  ) {
    return process.env.TIGER_PRIMARY_URL;
  }

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

function parseBoolean(value: boolean | string | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return false;
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value instanceof Date ? value.toISOString() : value;
  return raw.slice(0, 10);
}

function createIngestionPool(): Pool {
  const tigerPrimary = process.env.DATA_WRITE_TARGET?.trim().toLowerCase() === 'tiger';
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: DEFAULT_POOL_MAX,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: true,
    ...(tigerPrimary ? { options: '-c search_path=ops,legacy,metrics,events,docs,public' } : {}),
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

async function withSessionConfig<T>(
  client: PoolClient,
  settingName: string,
  value: string,
  fn: () => Promise<T>
): Promise<T> {
  const { rows } = await client.query<{ current_value: string }>(
    'SELECT current_setting($1) AS current_value',
    [settingName]
  );
  const previousValue = rows[0]?.current_value ?? '0';

  await client.query('SELECT set_config($1, $2, false)', [settingName, value]);

  try {
    return await fn();
  } finally {
    await client.query('SELECT set_config($1, $2, false)', [settingName, previousValue]);
  }
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
    return withSessionConfig(client, 'statement_timeout', `${timeoutMs}ms`, async () => fn(client));
  });
}

function assertSafeIdentifier(identifier: string): void {
  const parts = identifier.split('.');
  if (
    parts.length > 2 ||
    parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))
  ) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
}

function isStatementTimeoutError(error: unknown): error is { code?: string; message?: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;

  return code === '57014' || (typeof message === 'string' && message.includes('statement timeout'));
}

export async function claimAppsForReviewsSync(
  params: ClaimAppsForReviewsSyncParams
): Promise<ClaimedReviewApp[]> {
  return withTransaction(CLAIM_TIMEOUT_MS, async (client) => {
    try {
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
          FROM claim_apps_for_reviews_sync($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          params.workerId,
          params.limit,
          params.claimTtlMinutes,
          params.launchLimit ?? null,
          params.changeLimit ?? null,
          params.activeLimit ?? null,
          params.backfillLimit ?? null,
          params.unknownLimit ?? null,
        ]
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
    } catch (error) {
      if (isStatementTimeoutError(error)) {
        const message =
          error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : `claim_apps_for_reviews_sync exceeded ${CLAIM_TIMEOUT_MS}ms`;

        throw new ClaimAppsTimeoutError(message, CLAIM_TIMEOUT_MS);
      }

      throw error;
    }
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

export async function runInterpolationReviewDeltasBatch(
  params: RunInterpolationReviewDeltasBatchParams
): Promise<InterpolationBatchResult> {
  const timeoutMs = params.timeoutMs ?? INTERPOLATION_BATCH_TIMEOUT_MS;

  return withSessionStatementTimeout(timeoutMs, async (client) => {
    try {
      const { rows } = await client.query<InterpolationBatchRow>(
        `
          SELECT
            total_interpolated,
            apps_processed,
            last_appid,
            has_more
          FROM interpolate_review_deltas_batch($1, $2, $3, $4)
        `,
        [params.startDate, params.endDate, params.afterAppId, params.appLimit]
      );

      const row = rows[0];

      return {
        total_interpolated: parseNumber(row?.total_interpolated),
        apps_processed: parseNumber(row?.apps_processed),
        last_appid: parseOptionalNumber(row?.last_appid),
        has_more: parseBoolean(row?.has_more),
      };
    } catch (error) {
      if (isStatementTimeoutError(error)) {
        const message =
          error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : `interpolate_review_deltas_batch exceeded ${timeoutMs}ms`;

        throw new InterpolationBatchTimeoutError(message, timeoutMs);
      }

      throw error;
    }
  });
}

export async function refreshReviewVelocityStats(
  options: RefreshReviewVelocityStatsOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? VELOCITY_REFRESH_TIMEOUT_MS;

  await refreshMaterializedView('review_velocity_stats', { timeoutMs });
}

export async function refreshMaterializedView(
  viewName: string,
  options: RefreshMaterializedViewOptions = {}
): Promise<void> {
  assertSafeIdentifier(viewName);

  const timeoutMs = options.timeoutMs ?? MATVIEW_REFRESH_TIMEOUT_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? MATVIEW_LOCK_TIMEOUT_MS;
  const useConcurrentRefresh = options.concurrently !== false;
  const allowNonConcurrentFallback = useConcurrentRefresh && options.fallbackToNonConcurrent === true;
  const concurrentRefreshSql = `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`;
  const regularRefreshSql = `REFRESH MATERIALIZED VIEW ${viewName}`;
  const refreshSql = options.concurrently === false
    ? regularRefreshSql
    : concurrentRefreshSql;

  await withSessionStatementTimeout(timeoutMs, async (client) => {
    await withSessionConfig(client, 'lock_timeout', `${lockTimeoutMs}ms`, async () => {
      try {
        await client.query(refreshSql);
      } catch (error) {
        if (!allowNonConcurrentFallback) {
          throw error;
        }

        await client.query(regularRefreshSql);
      }
    });
  });
}

export async function recalculateCcuTiers(options: {
  timeoutMs?: number;
} = {}): Promise<RecalculateCcuTiersResult> {
  const timeoutMs = options.timeoutMs ?? CCU_TIER_RECALC_TIMEOUT_MS;

  return withSessionStatementTimeout(timeoutMs, async (client) => {
    const { rows } = await client.query<RecalculateCcuTiersRow>(
      'SELECT tier1_count, tier2_count, tier3_count FROM recalculate_ccu_tiers()'
    );

    const row = rows[0];

    return {
      tier1Count: parseNumber(row?.tier1_count),
      tier2Count: parseNumber(row?.tier2_count),
      tier3Count: parseNumber(row?.tier3_count),
    };
  });
}

export async function refreshCcuQualityStats(
  options: RefreshCcuQualityStatsOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CCU_QUALITY_REFRESH_TIMEOUT_MS;

  await withSessionStatementTimeout(timeoutMs, async (client) => {
    await client.query('SELECT public.refresh_ccu_quality_stats()');
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

export async function updateReviewVelocityTiersBatch(
  batchLimit = 1000
): Promise<VelocityTierUpdateBatchResult> {
  return withTransaction(VELOCITY_UPDATE_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<UpdateReviewVelocityTiersBatchRow>(
      `
        SELECT updated_count
        FROM update_review_velocity_tiers_batch($1)
      `,
      [batchLimit]
    );

    return {
      updatedCount: parseNumber(rows[0]?.updated_count),
    };
  });
}

export async function getReviewVelocityTierDistribution(): Promise<ReviewVelocityTierDistribution> {
  return withTransaction(QUEUE_HEALTH_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<ReviewVelocityTierDistributionRow>(`
      SELECT
        COALESCE(review_velocity_tier, 'unknown') AS tier,
        COUNT(*)::INT AS count
      FROM sync_status
      GROUP BY COALESCE(review_velocity_tier, 'unknown')
    `);

    const distribution: ReviewVelocityTierDistribution = {
      dormant: 0,
      high: 0,
      low: 0,
      medium: 0,
      unknown: 0,
    };

    for (const row of rows) {
      const tier = (row.tier ?? 'unknown') as keyof ReviewVelocityTierDistribution;
      if (tier in distribution) {
        distribution[tier] = parseNumber(row.count);
      }
    }

    return distribution;
  });
}

export async function getReviewTruthRepairCandidates(params: {
  appids?: number[];
  limit: number;
  minTotalReviews?: number;
}): Promise<ReviewTruthRepairCandidate[]> {
  const requestedLimit = Math.max(1, Math.min(params.limit, 5000));
  const minTotalReviews = Math.max(0, params.minTotalReviews ?? 0);
  const explicitAppids = params.appids && params.appids.length > 0 ? params.appids : null;

  return withTransaction(QUEUE_HEALTH_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<ReviewTruthRepairCandidateRow>(
      `
        SELECT
          s.appid,
          COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0)::INTEGER AS current_total_reviews,
          s.last_reviews_sync,
          s.last_steamspy_sync
        FROM sync_status s
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND s.last_steamspy_sync IS NOT NULL
          AND s.last_steamspy_sync > COALESCE(s.last_reviews_sync, '-infinity'::TIMESTAMPTZ)
          AND (
            $3::INT[] IS NOT NULL
            OR COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) >= $1
          )
          AND (
            $3::INT[] IS NULL
            OR s.appid = ANY($3)
          )
        ORDER BY
          COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) DESC,
          s.last_reviews_sync ASC NULLS FIRST,
          s.last_steamspy_sync DESC,
          s.appid ASC
        LIMIT $2
      `,
      [minTotalReviews, requestedLimit, explicitAppids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      currentTotalReviews: parseNumber(row.current_total_reviews),
      lastReviewsSync: normalizeTimestamp(row.last_reviews_sync),
      lastSteamspySync: normalizeTimestamp(row.last_steamspy_sync)!,
    }));
  });
}

export async function getCcuProvenanceRepairCandidates(params: {
  appids?: number[];
  limit: number;
}): Promise<CcuProvenanceRepairCandidate[]> {
  const requestedLimit = Math.max(1, Math.min(params.limit, 5000));
  const explicitAppids = params.appids && params.appids.length > 0 ? params.appids : null;

  return withSessionStatementTimeout(CCU_REPAIR_QUERY_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<CcuProvenanceRepairCandidateRow>(
      `
        WITH catalog_appids AS (
          SELECT appid
          FROM public.get_current_catalog_appids()
        ),
        candidates AS (
          SELECT
            ldm.appid,
            ldm.ccu_peak,
            ldm.metric_date,
            CASE
              WHEN ct.last_ccu_synced IS NOT NULL
                   AND ldm.metric_date IS NOT NULL
                   AND ct.last_ccu_synced::DATE = ldm.metric_date
                   AND (s.last_steamspy_sync IS NULL OR ct.last_ccu_synced >= s.last_steamspy_sync)
              THEN 'steam_api'
              WHEN s.last_steamspy_sync IS NOT NULL
                   AND ldm.metric_date IS NOT NULL
                   AND s.last_steamspy_sync::DATE = ldm.metric_date
                   AND (ct.last_ccu_synced IS NULL OR s.last_steamspy_sync > ct.last_ccu_synced)
              THEN 'steamspy'
              ELSE NULL
            END AS inferred_source
          FROM catalog_appids c
          JOIN public.latest_daily_metrics ldm ON ldm.appid = c.appid
          LEFT JOIN public.sync_status s ON s.appid = c.appid
          LEFT JOIN public.ccu_tier_assignments ct ON ct.appid = c.appid
          WHERE ldm.ccu_peak IS NOT NULL
            AND ldm.ccu_source IS NULL
            AND (
              $2::INT[] IS NULL
              OR ldm.appid = ANY($2)
            )
        )
        SELECT
          appid,
          ccu_peak,
          inferred_source,
          metric_date
        FROM candidates
        WHERE inferred_source IS NOT NULL
        ORDER BY
          ccu_peak DESC,
          metric_date DESC,
          appid ASC
        LIMIT $1
      `,
      [requestedLimit, explicitAppids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      ccuPeak: parseNumber(row.ccu_peak),
      inferredSource: row.inferred_source,
      metricDate: normalizeDate(row.metric_date)!,
    }));
  });
}

export async function getCcuValidationBackfillCandidates(params: {
  appids?: number[];
  limit: number;
}): Promise<CcuValidationBackfillCandidate[]> {
  const requestedLimit = Math.max(1, Math.min(params.limit, 5000));
  const explicitAppids = params.appids && params.appids.length > 0 ? params.appids : null;

  return withSessionStatementTimeout(CCU_REPAIR_QUERY_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<CcuValidationBackfillCandidateRow>(
      `
        WITH catalog_appids AS (
          SELECT appid
          FROM public.get_current_catalog_appids()
        ),
        positive_snapshots AS (
          SELECT
            cs.appid,
            MAX(cs.snapshot_time) AS latest_positive_snapshot_at
          FROM public.ccu_snapshots cs
          JOIN catalog_appids c ON c.appid = cs.appid
          WHERE cs.player_count > 0
            AND cs.snapshot_time >= NOW() - INTERVAL '30 days'
          GROUP BY cs.appid
        )
        SELECT
          ct.appid,
          ct.ccu_fetch_status,
          ldm.ccu_peak,
          ldm.ccu_source,
          ct.last_ccu_validation_at AS existing_validation_at,
          ct.last_ccu_validation_state AS existing_validation_state,
          ct.last_ccu_synced,
          ps.latest_positive_snapshot_at,
          ldm.metric_date,
          ct.updated_at
        FROM public.ccu_tier_assignments ct
        JOIN catalog_appids c ON c.appid = ct.appid
        LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = ct.appid
        LEFT JOIN positive_snapshots ps ON ps.appid = ct.appid
        WHERE (
            ct.last_ccu_validation_state IS NULL
            OR ct.last_ccu_validation_at IS NULL
          )
          AND (
            $2::INT[] IS NULL
            OR ct.appid = ANY($2)
          )
        ORDER BY
          COALESCE(ldm.ccu_peak, 0) DESC,
          ct.last_ccu_synced DESC NULLS LAST,
          ct.appid ASC
        LIMIT $1
      `,
      [requestedLimit, explicitAppids]
    );

    return rows.map((row) => ({
      appid: row.appid,
      ccuFetchStatus: row.ccu_fetch_status,
      ccuPeak: parseOptionalNumber(row.ccu_peak),
      ccuSource: row.ccu_source,
      existingValidationAt: normalizeTimestamp(row.existing_validation_at),
      existingValidationState: row.existing_validation_state,
      lastCcuSynced: normalizeTimestamp(row.last_ccu_synced),
      latestPositiveSnapshotAt: normalizeTimestamp(row.latest_positive_snapshot_at),
      metricDate: normalizeDate(row.metric_date),
      updatedAt: normalizeTimestamp(row.updated_at),
    }));
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
                 OR COALESCE(s.velocity_7d, 0) >= 1
            THEN 'active_reviews'
            WHEN COALESCE(s.priority_score, 0) >= 50
                 OR COALESCE(s.last_known_total_reviews, 0) >= 1000
            THEN 'important_backfill'
            ELSE 'unknown_sweep'
          END::TEXT AS lane,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(s.next_reviews_sync, NOW()))) / 3600.0 AS hours_overdue
        FROM sync_status s
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= NOW())
          AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= NOW())
          AND NOT (
            a.release_date > CURRENT_DATE + INTERVAL '7 days'
            AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
            AND NOT (
              s.reviews_priority_override_until IS NOT NULL
              AND s.reviews_priority_override_until > NOW()
              AND s.reviews_priority_override_bucket IS NOT NULL
            )
          )
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

export async function listNewsCatchupCandidates(params: {
  limit: number;
  staleBeforeIso: string;
}): Promise<NewsCatchupCandidate[]> {
  const requestedLimit = Math.max(1, Math.min(params.limit, 500));

  return withTransaction(QUEUE_HEALTH_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<NewsCatchupCandidateRow>(
      `
        SELECT
          s.appid,
          s.last_news_sync,
          s.last_storefront_sync
        FROM sync_status s
        LEFT JOIN app_capture_work_state w
          ON w.appid = s.appid
         AND w.source = 'news'
        WHERE s.last_storefront_sync IS NOT NULL
          AND COALESCE(s.storefront_accessible, TRUE) = TRUE
          AND (
            s.last_news_sync IS NULL
            OR s.last_news_sync < $1::TIMESTAMPTZ
          )
          AND (
            w.id IS NULL
            OR (
              w.dirty_since IS NULL
              AND w.claimed_at IS NULL
              AND w.dead_lettered_at IS NULL
            )
          )
        ORDER BY
          CASE WHEN s.last_news_sync IS NULL THEN 0 ELSE 1 END,
          s.last_storefront_sync DESC,
          s.last_news_sync ASC NULLS FIRST,
          s.appid ASC
        LIMIT $2
      `,
      [params.staleBeforeIso, requestedLimit]
    );

    return rows.map((row) => ({
      appid: row.appid,
      lastNewsSync: normalizeTimestamp(row.last_news_sync),
      lastStorefrontSync: normalizeTimestamp(row.last_storefront_sync)!,
    }));
  });
}

export async function listHotNewsRefreshCandidates(params: {
  limit: number;
  activeStaleBeforeIso: string;
  moderateStaleBeforeIso: string;
}): Promise<HotNewsRefreshCandidate[]> {
  const requestedLimit = Math.max(1, Math.min(params.limit, 500));

  return withTransaction(QUEUE_HEALTH_TIMEOUT_MS, async (client) => {
    const { rows } = await client.query<HotNewsRefreshCandidateRow>(
      `
        SELECT
          s.appid,
          s.last_news_sync,
          s.last_storefront_sync,
          s.refresh_tier,
          (
            COALESCE(a.is_released, FALSE) = FALSE
            OR (
              a.release_date IS NOT NULL
              AND a.release_date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE + INTERVAL '30 days'
            )
          ) AS is_launch_window
        FROM sync_status s
        JOIN apps a
          ON a.appid = s.appid
        LEFT JOIN app_capture_work_state w
          ON w.appid = s.appid
         AND w.source = 'news'
        WHERE s.last_storefront_sync IS NOT NULL
          AND COALESCE(s.storefront_accessible, TRUE) = TRUE
          AND (
            (
              s.refresh_tier = 'active'
              AND (
                s.last_news_sync IS NULL
                OR s.last_news_sync < $1::TIMESTAMPTZ
              )
            )
            OR (
              (
                COALESCE(a.is_released, FALSE) = FALSE
                OR (
                  a.release_date IS NOT NULL
                  AND a.release_date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE + INTERVAL '30 days'
                )
              )
              AND (
                s.last_news_sync IS NULL
                OR s.last_news_sync < $2::TIMESTAMPTZ
              )
            )
          )
          AND (
            w.id IS NULL
            OR (
              w.dirty_since IS NULL
              AND w.claimed_at IS NULL
              AND w.dead_lettered_at IS NULL
            )
          )
        ORDER BY
          CASE WHEN s.refresh_tier = 'active' THEN 0 ELSE 1 END,
          CASE
            WHEN (
              COALESCE(a.is_released, FALSE) = FALSE
              OR (
                a.release_date IS NOT NULL
                AND a.release_date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE + INTERVAL '30 days'
              )
            ) THEN 0
            ELSE 1
          END,
          s.last_news_sync ASC NULLS FIRST,
          s.last_storefront_sync DESC,
          s.appid ASC
        LIMIT $3
      `,
      [params.activeStaleBeforeIso, params.moderateStaleBeforeIso, requestedLimit]
    );

    return rows.map((row) => ({
      appid: row.appid,
      lastNewsSync: normalizeTimestamp(row.last_news_sync),
      lastStorefrontSync: normalizeTimestamp(row.last_storefront_sync)!,
      refreshTier: row.refresh_tier,
      isLaunchWindow: row.is_launch_window,
    }));
  });
}
