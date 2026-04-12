import { pathToFileURL } from "node:url";

import { Pool, type QueryResult, type QueryResultRow } from "pg";

import { logger } from "@publisheriq/shared";

import { loadSourceBaselineConfig, loadTigerConfig } from "../config.js";
import {
  EVENT_BATCH_SIZE,
  NEWS_BATCH_SIZE,
  addOneDay,
  addOneMonth,
  fetchDailyPlans,
  buildInsertSql,
  buildInsertValuesSql,
  currentUtcDayKey,
  currentUtcMonthKey,
  fetchCount,
  listRecentUtcDayKeys,
  parseSelectedEventsNewsTables,
  resolveEventsNewsManifestLabel,
  shiftUtcDay,
  shiftUtcMonth,
  writeEventsNewsManifest,
  type EventsNewsTableName,
} from "./events-news-sync-lib.js";

const DEFAULT_NEWS_DAY_LOOKBACK = 7;
const DEFAULT_EVENT_DAY_LOOKBACK = 3;
const DEFAULT_PROJECTION_DAY_LOOKBACK = 7;
const EVENTS_NEWS_RECONCILE_LOCK_KEY = 20260331;
const PROJECTION_STAGE_RELATION =
  "docs.steam_news_search_projection_reconcile_stage";
const PROJECTION_TARGET_RELATION = "docs.steam_news_search_projection";
const PROJECTION_TARGET_COLUMNS = [
  "gid",
  "appid",
  "published_at",
  "first_seen_at",
  "sort_time",
  "feed_scope",
  "title",
  "search_document",
] as const;
const PROJECTION_MUTABLE_COLUMNS = PROJECTION_TARGET_COLUMNS.filter(
  (columnName) => columnName !== "gid",
);

type SyncMode = "reconcile" | "validate";
export type ProjectionRepairScope = "recent_window" | "exact_parity";

interface SteamNewsItemRow extends QueryResultRow {
  appid: number;
  author: string | null;
  created_at: string;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  last_seen_at: string;
  published_at: string | null;
  updated_at: string;
  url: string;
}

interface SteamNewsProjectionRow extends QueryResultRow {
  appid: number;
  feed_scope: string;
  first_seen_at: string;
  gid: string;
  published_at: string | null;
  search_document: string;
  sort_time: string;
  title: string | null;
}

interface AppChangeEventRow extends QueryResultRow {
  after_value: unknown | null;
  appid: number;
  before_value: unknown | null;
  change_type: string;
  context: unknown;
  created_at: string;
  id: string;
  media_version_id: string | null;
  news_item_gid: string | null;
  occurred_at: string;
  related_snapshot_id: string | null;
  source: string;
  source_snapshot_id: string | null;
  trigger_cursor: string | null;
}

export interface PartitionMismatch {
  partitionKey: string;
  sourceCount: number;
  tigerCount: number;
}

export interface ProjectionReplayMonth {
  partitionKey: string;
  reason: string;
}

interface PartitionActionSummary {
  analyzeMs?: number;
  batches?: number;
  deletedRows: number;
  deleteMs?: number;
  elapsedMs?: number;
  fetchMs?: number;
  partitionKey: string;
  reason: string;
  replayed: boolean;
  sourceCountBefore: number;
  stageInsertMs?: number;
  stagedRows?: number;
  tigerCountAfter: number;
  tigerCountBefore: number;
  upsertMs?: number;
  writtenRows: number;
}

interface TableSyncSummary {
  actions: PartitionActionSummary[];
  dayMismatchesAfter: PartitionMismatch[];
  dayMismatchesBefore: PartitionMismatch[];
  fullCountMatches: boolean;
  historicalDayMismatchesAfter: PartitionMismatch[];
  historicalDayMismatchesBefore: PartitionMismatch[];
  passed: boolean;
  sourceRelation: string;
  sourceTotalCount: number;
  tableName: EventsNewsTableName;
  targetRelation: string;
  tigerTotalCount: number;
  totalDeletedRows: number;
  totalWrittenRows: number;
}

interface ProjectionSyncSummary extends TableSyncSummary {
  monthMismatchesAfter: PartitionMismatch[];
  monthMismatchesBefore: PartitionMismatch[];
}

interface ProjectionReplayProgress {
  monthIndex: number;
  replayPass: number;
  totalMonths: number;
}

interface ProjectionSourceSnapshot {
  dayCounts: Map<string, number>;
  monthCounts: Map<string, number>;
  totalCount: number;
}

interface SyncValidations {
  duplicateEventIds: number;
  orphanedNewsItemGids: number;
  projectionRowsMissingNewsItems: number;
}

interface EventsNewsSyncManifest {
  capturedAt: string;
  mode: SyncMode;
  settings: {
    appChangeMaxId: string | null;
    eventDayLookback: number;
    newsDayLookback: number;
    projectionDayLookback: number;
    projectionRepairScope: ProjectionRepairScope;
    selectedTables: EventsNewsTableName[];
  };
  success: boolean;
  tableSummaries: Array<TableSyncSummary | ProjectionSyncSummary>;
  validations: SyncValidations | null;
  error?: {
    failingTable: EventsNewsTableName | null;
    message: string;
    name: string;
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function readOptionalBigIntString(
  envName: string,
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Unsupported ${envName} value: ${value}`);
  }

  return trimmed;
}

function serializeJsonColumnValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

async function measureDurationMs<T>(
  operation: () => Promise<T>,
): Promise<{ elapsedMs: number; result: T }> {
  const startedAt = Date.now();
  const result = await operation();
  return {
    elapsedMs: Date.now() - startedAt,
    result,
  };
}

function sumCounts(counts: Map<string, number>): number {
  let total = 0;
  for (const value of counts.values()) {
    total += value;
  }

  return total;
}

function readSyncMode(value: string | undefined): SyncMode {
  if (!value?.trim()) {
    return "reconcile";
  }

  if (value === "validate" || value === "reconcile") {
    return value;
  }

  throw new Error(`Unsupported EVENTS_NEWS_SYNC_MODE value: ${value}`);
}

export function parseProjectionRepairScope(
  value: string | undefined,
): ProjectionRepairScope {
  if (!value?.trim()) {
    return "exact_parity";
  }

  if (value === "recent_window" || value === "exact_parity") {
    return value;
  }

  throw new Error(
    `Unsupported EVENTS_NEWS_SYNC_PROJECTION_REPAIR_SCOPE value: ${value}`,
  );
}

function comparePartitionCounts(
  sourceCounts: Map<string, number>,
  tigerCounts: Map<string, number>,
): PartitionMismatch[] {
  return [...new Set([...sourceCounts.keys(), ...tigerCounts.keys()])]
    .sort()
    .flatMap((partitionKey) => {
      const sourceCount = sourceCounts.get(partitionKey) ?? 0;
      const tigerCount = tigerCounts.get(partitionKey) ?? 0;

      return sourceCount === tigerCount
        ? []
        : [{ partitionKey, sourceCount, tigerCount }];
    });
}

async function fetchDayCountMap(
  pool: Pool,
  relation: string,
  timeColumn: "first_seen_at" | "occurred_at" | "sort_time",
  dayKeys: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (dayKeys.length === 0) {
    return counts;
  }

  const startDay = dayKeys[0]!;
  const endDay = addOneDay(dayKeys[dayKeys.length - 1]!);
  const result = await pool.query<{ day_key: string; row_count: string }>(
    `
      SELECT
        ${timeColumn}::date::text AS day_key,
        count(*)::bigint AS row_count
      FROM ${relation}
      WHERE ${timeColumn} >= $1::date
        AND ${timeColumn} < $2::date
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    [startDay, endDay],
  );

  for (const dayKey of dayKeys) {
    counts.set(dayKey, 0);
  }

  for (const row of result.rows) {
    counts.set(row.day_key, Number(row.row_count));
  }

  return counts;
}

function addQueryParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

async function fetchAppChangeCount(
  pool: Pool,
  relation: string,
  appChangeMaxId: string | null = null,
): Promise<number> {
  const params: unknown[] = [];
  const maxIdFilter = appChangeMaxId
    ? ` WHERE id <= ${addQueryParam(params, appChangeMaxId)}::bigint`
    : "";
  const result = await pool.query<{ row_count: string }>(
    `SELECT count(*)::bigint AS row_count FROM ${relation}${maxIdFilter}`,
    params,
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchAppChangeDayCountMap(
  pool: Pool,
  relation: string,
  dayKeys: string[],
  appChangeMaxId: string | null = null,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (dayKeys.length === 0) {
    return counts;
  }

  const params: unknown[] = [];
  const startParam = addQueryParam(params, dayKeys[0]!);
  const endParam = addQueryParam(params, addOneDay(dayKeys[dayKeys.length - 1]!));
  const maxIdFilter = appChangeMaxId
    ? `\n        AND id <= ${addQueryParam(params, appChangeMaxId)}::bigint`
    : "";
  const result = await pool.query<{ day_key: string; row_count: string }>(
    `
      SELECT
        occurred_at::date::text AS day_key,
        count(*)::bigint AS row_count
      FROM ${relation}
      WHERE occurred_at >= ${startParam}::date
        AND occurred_at < ${endParam}::date${maxIdFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    params,
  );

  for (const dayKey of dayKeys) {
    counts.set(dayKey, 0);
  }

  for (const row of result.rows) {
    counts.set(row.day_key, Number(row.row_count));
  }

  return counts;
}

async function fetchMonthCountMap(
  pool: Pool,
  relation: string,
  timeColumn: "sort_time",
): Promise<Map<string, number>> {
  const result = await pool.query<{ month_key: string; row_count: string }>(
    `
      SELECT
        date_trunc('month', ${timeColumn})::date::text AS month_key,
        count(*)::bigint AS row_count
      FROM ${relation}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  );

  return new Map(
    result.rows.map((row) => [row.month_key, Number(row.row_count)]),
  );
}

async function fetchFullDayCountMap(
  pool: Pool,
  relation: string,
  timeColumn: "first_seen_at" | "occurred_at" | "sort_time",
  cursorColumn: "gid" | "id",
): Promise<Map<string, number>> {
  const plans = await fetchDailyPlans(pool, relation, timeColumn, cursorColumn);
  return new Map(plans.map((plan) => [plan.partitionKey, plan.sourceCount]));
}

async function fetchAppChangeFullDayCountMap(
  pool: Pool,
  relation: string,
  appChangeMaxId: string | null = null,
): Promise<Map<string, number>> {
  const params: unknown[] = [];
  const maxIdFilter = appChangeMaxId
    ? ` WHERE id <= ${addQueryParam(params, appChangeMaxId)}::bigint`
    : "";
  const result = await pool.query<{ day_key: string; row_count: string }>(
    `
      SELECT
        occurred_at::date::text AS day_key,
        count(*)::bigint AS row_count
      FROM ${relation}${maxIdFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    params,
  );

  return new Map(
    result.rows.map((row) => [row.day_key, Number(row.row_count)]),
  );
}

async function fetchNewsItemsDayCount(
  pool: Pool,
  dayKey: string,
): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM docs.steam_news_items
      WHERE first_seen_at >= $1::date
        AND first_seen_at < $2::date
    `,
    [dayKey, addOneDay(dayKey)],
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchAppChangeEventsDayCount(
  pool: Pool,
  dayKey: string,
): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM events.app_change_events
      WHERE occurred_at >= $1::date
        AND occurred_at < $2::date
    `,
    [dayKey, addOneDay(dayKey)],
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchProjectionSourceSnapshot(
  sourcePool: Pool,
  recentDayKeys: string[],
): Promise<ProjectionSourceSnapshot> {
  const [dayCounts, monthCounts] = await Promise.all([
    fetchDayCountMap(
      sourcePool,
      "public.steam_news_search_projection",
      "sort_time",
      recentDayKeys,
    ),
    fetchMonthCountMap(
      sourcePool,
      "public.steam_news_search_projection",
      "sort_time",
    ),
  ]);

  return {
    dayCounts,
    monthCounts,
    totalCount: sumCounts(monthCounts),
  };
}

function buildRecentReplayDays(
  lookbackDays: number,
  mismatches: PartitionMismatch[],
  now: Date = new Date(),
): Array<{ partitionKey: string; reason: string }> {
  const currentDay = currentUtcDayKey(now);
  const previousDay = shiftUtcDay(currentDay, -1);
  const selected = new Map<string, string>();

  selected.set(currentDay, "current_day");
  selected.set(previousDay, "previous_day");

  const recentKeys = new Set(listRecentUtcDayKeys(lookbackDays, now));
  for (const mismatch of mismatches) {
    if (recentKeys.has(mismatch.partitionKey)) {
      selected.set(mismatch.partitionKey, "mismatched_recent_day");
    }
  }

  return [...selected.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([partitionKey, reason]) => ({ partitionKey, reason }));
}

function monthKeyFromDayKey(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

function orderProjectionReplayMonths(
  selected: Map<string, string>,
  previousMonth: string,
  currentMonth: string,
): ProjectionReplayMonth[] {
  const ordered = [...selected.entries()].sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const older = ordered.filter(
    ([partitionKey]) =>
      partitionKey !== previousMonth && partitionKey !== currentMonth,
  );
  const recent = ordered.filter(
    ([partitionKey]) =>
      partitionKey === previousMonth || partitionKey === currentMonth,
  );

  return [...older, ...recent].map(([partitionKey, reason]) => ({
    partitionKey,
    reason,
  }));
}

function buildExactParityProjectionReplayMonths(
  mismatches: PartitionMismatch[],
  now: Date = new Date(),
): ProjectionReplayMonth[] {
  const currentMonth = currentUtcMonthKey(now);
  const previousMonth = shiftUtcMonth(currentMonth, -1);
  const selected = new Map<string, string>();

  for (const mismatch of mismatches) {
    selected.set(mismatch.partitionKey, "mismatched_month");
  }

  selected.set(previousMonth, selected.get(previousMonth) ?? "previous_month");
  selected.set(currentMonth, selected.get(currentMonth) ?? "current_month");

  return orderProjectionReplayMonths(selected, previousMonth, currentMonth);
}

function buildRecentWindowProjectionReplayMonths(
  recentDayMismatches: PartitionMismatch[],
  now: Date = new Date(),
): ProjectionReplayMonth[] {
  const currentMonth = currentUtcMonthKey(now);
  const previousMonth = shiftUtcMonth(currentMonth, -1);
  const selected = new Map<string, string>();

  selected.set(previousMonth, "previous_month");
  selected.set(currentMonth, "current_month");

  for (const mismatch of recentDayMismatches) {
    const monthKey = monthKeyFromDayKey(mismatch.partitionKey);
    selected.set(
      monthKey,
      selected.get(monthKey) ?? "mismatched_recent_window_day",
    );
  }

  return orderProjectionReplayMonths(selected, previousMonth, currentMonth);
}

export function buildProjectionReplayMonths(
  monthMismatches: PartitionMismatch[],
  recentDayMismatches: PartitionMismatch[],
  scope: ProjectionRepairScope,
  now: Date = new Date(),
): ProjectionReplayMonth[] {
  return scope === "recent_window"
    ? buildRecentWindowProjectionReplayMonths(recentDayMismatches, now)
    : buildExactParityProjectionReplayMonths(monthMismatches, now);
}

export function buildProjectionUpsertSql(
  targetRelation: string,
  stageRelation: string,
  targetColumns: readonly string[] = PROJECTION_TARGET_COLUMNS,
): string {
  const updateSql = PROJECTION_MUTABLE_COLUMNS.map(
    (columnName) => `${columnName} = EXCLUDED.${columnName}`,
  ).join(",\n        ");
  const changedSql = PROJECTION_MUTABLE_COLUMNS.map(
    (columnName) =>
      `${targetRelation}.${columnName} IS DISTINCT FROM EXCLUDED.${columnName}`,
  ).join("\n          OR ");

  return `
      INSERT INTO ${targetRelation}
      (${targetColumns.join(", ")})
      SELECT ${targetColumns.join(", ")}
      FROM ${stageRelation}
      ON CONFLICT (gid)
      DO UPDATE SET
        ${updateSql}
      WHERE ${changedSql}
    `;
}

function serializeError(error: unknown): {
  message: string;
  name: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name || "Error",
    };
  }

  return {
    message: typeof error === "string" ? error : JSON.stringify(error),
    name: "Error",
  };
}

async function acquireReconcileLock(pool: Pool): Promise<void> {
  const result = await pool.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [EVENTS_NEWS_RECONCILE_LOCK_KEY],
  );

  if (!result.rows[0]?.locked) {
    throw new Error(
      "Another Tiger events/news reconciliation run is already active.",
    );
  }
}

async function releaseReconcileLock(pool: Pool): Promise<void> {
  await pool.query("SELECT pg_advisory_unlock($1)", [
    EVENTS_NEWS_RECONCILE_LOCK_KEY,
  ]);
}

async function reconcileSteamNewsItemsDay(
  sourcePool: Pool,
  tigerPool: Pool,
  dayKey: string,
  sourceCountBefore: number,
  tigerCountBefore: number,
  reason: string,
): Promise<PartitionActionSummary> {
  const targetColumns = [
    "gid",
    "appid",
    "url",
    "author",
    "feedlabel",
    "feedname",
    "published_at",
    "first_seen_at",
    "last_seen_at",
    "created_at",
    "updated_at",
  ];
  let cursorFirstSeenAt: string | null = null;
  let cursorGid: string | null = null;
  let writtenRows = 0;

  while (true) {
    let batchResult: QueryResult<SteamNewsItemRow>;

    if (cursorFirstSeenAt && cursorGid) {
      batchResult = await sourcePool.query<SteamNewsItemRow>(
        `
          SELECT
            gid,
            appid,
            url,
            author,
            feedlabel,
            feedname,
            published_at::text,
            first_seen_at::text,
            last_seen_at::text,
            created_at::text,
            updated_at::text
          FROM public.steam_news_items
          WHERE first_seen_at >= $1::date
            AND first_seen_at < $2::date
            AND (first_seen_at, gid) > ($3::timestamptz, $4::text)
          ORDER BY first_seen_at ASC, gid ASC
          LIMIT $5
        `,
        [
          dayKey,
          addOneDay(dayKey),
          cursorFirstSeenAt,
          cursorGid,
          NEWS_BATCH_SIZE,
        ],
      );
    } else {
      batchResult = await sourcePool.query<SteamNewsItemRow>(
        `
          SELECT
            gid,
            appid,
            url,
            author,
            feedlabel,
            feedname,
            published_at::text,
            first_seen_at::text,
            last_seen_at::text,
            created_at::text,
            updated_at::text
          FROM public.steam_news_items
          WHERE first_seen_at >= $1::date
            AND first_seen_at < $2::date
          ORDER BY first_seen_at ASC, gid ASC
          LIMIT $3
        `,
        [dayKey, addOneDay(dayKey), NEWS_BATCH_SIZE],
      );
    }

    if (batchResult.rows.length === 0) {
      break;
    }

    const values: unknown[] = [];
    for (const row of batchResult.rows) {
      values.push(
        row.gid,
        row.appid,
        row.url,
        row.author,
        row.feedlabel,
        row.feedname,
        row.published_at,
        row.first_seen_at,
        row.last_seen_at,
        row.created_at,
        row.updated_at,
      );
    }

    await tigerPool.query(
      buildInsertSql(
        "docs.steam_news_items",
        targetColumns,
        ["gid"],
        batchResult.rows.length,
      ),
      values,
    );

    writtenRows += batchResult.rows.length;
    const lastRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorFirstSeenAt = lastRow.first_seen_at;
    cursorGid = lastRow.gid;
  }

  return {
    deletedRows: 0,
    partitionKey: dayKey,
    reason,
    replayed: true,
    sourceCountBefore,
    tigerCountAfter: await fetchNewsItemsDayCount(tigerPool, dayKey),
    tigerCountBefore,
    writtenRows,
  };
}

async function reconcileAppChangeEventsDay(
  sourcePool: Pool,
  tigerPool: Pool,
  dayKey: string,
  sourceCountBefore: number,
  tigerCountBefore: number,
  appChangeMaxId: string | null,
  reason: string,
): Promise<PartitionActionSummary> {
  const targetColumns = [
    "id",
    "appid",
    "source",
    "change_type",
    "occurred_at",
    "source_snapshot_id",
    "related_snapshot_id",
    "media_version_id",
    "news_item_gid",
    "before_value",
    "after_value",
    "context",
    "trigger_cursor",
    "created_at",
  ];
  let cursorOccurredAt: string | null = null;
  let cursorId: string | null = null;
  let writtenRows = 0;

  while (true) {
    let batchResult: QueryResult<AppChangeEventRow>;

    if (cursorOccurredAt && cursorId) {
      const params: unknown[] = [];
      const dayStartParam = addQueryParam(params, dayKey);
      const dayEndParam = addQueryParam(params, addOneDay(dayKey));
      const maxIdFilter = appChangeMaxId
        ? `\n            AND id <= ${addQueryParam(params, appChangeMaxId)}::bigint`
        : "";
      const cursorOccurredAtParam = addQueryParam(params, cursorOccurredAt);
      const cursorIdParam = addQueryParam(params, cursorId);
      const limitParam = addQueryParam(params, EVENT_BATCH_SIZE);
      batchResult = await sourcePool.query<AppChangeEventRow>(
        `
          SELECT
            id::text,
            appid,
            source::text AS source,
            change_type::text AS change_type,
            occurred_at::text,
            source_snapshot_id::text,
            related_snapshot_id::text,
            media_version_id::text,
            news_item_gid,
            before_value,
            after_value,
            context,
            trigger_cursor,
            created_at::text
          FROM public.app_change_events
          WHERE occurred_at >= ${dayStartParam}::date
            AND occurred_at < ${dayEndParam}::date${maxIdFilter}
            AND (occurred_at, id) > (${cursorOccurredAtParam}::timestamptz, ${cursorIdParam}::bigint)
          ORDER BY occurred_at ASC, id ASC
          LIMIT ${limitParam}
        `,
        params,
      );
    } else {
      const params: unknown[] = [];
      const dayStartParam = addQueryParam(params, dayKey);
      const dayEndParam = addQueryParam(params, addOneDay(dayKey));
      const maxIdFilter = appChangeMaxId
        ? `\n            AND id <= ${addQueryParam(params, appChangeMaxId)}::bigint`
        : "";
      const limitParam = addQueryParam(params, EVENT_BATCH_SIZE);
      batchResult = await sourcePool.query<AppChangeEventRow>(
        `
          SELECT
            id::text,
            appid,
            source::text AS source,
            change_type::text AS change_type,
            occurred_at::text,
            source_snapshot_id::text,
            related_snapshot_id::text,
            media_version_id::text,
            news_item_gid,
            before_value,
            after_value,
            context,
            trigger_cursor,
            created_at::text
          FROM public.app_change_events
          WHERE occurred_at >= ${dayStartParam}::date
            AND occurred_at < ${dayEndParam}::date${maxIdFilter}
          ORDER BY occurred_at ASC, id ASC
          LIMIT ${limitParam}
        `,
        params,
      );
    }

    if (batchResult.rows.length === 0) {
      break;
    }

    const values: unknown[] = [];
    for (const row of batchResult.rows) {
      values.push(
        row.id,
        row.appid,
        row.source,
        row.change_type,
        row.occurred_at,
        row.source_snapshot_id,
        row.related_snapshot_id,
        row.media_version_id,
        row.news_item_gid,
        serializeJsonColumnValue(row.before_value),
        serializeJsonColumnValue(row.after_value),
        serializeJsonColumnValue(row.context),
        row.trigger_cursor,
        row.created_at,
      );
    }

    await tigerPool.query(
      buildInsertSql(
        "events.app_change_events",
        targetColumns,
        ["occurred_at", "id"],
        batchResult.rows.length,
      ),
      values,
    );

    writtenRows += batchResult.rows.length;
    const lastRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorOccurredAt = lastRow.occurred_at;
    cursorId = lastRow.id;
  }

  return {
    deletedRows: 0,
    partitionKey: dayKey,
    reason,
    replayed: true,
    sourceCountBefore,
    tigerCountAfter: await fetchAppChangeEventsDayCount(tigerPool, dayKey),
    tigerCountBefore,
    writtenRows,
  };
}

async function prepareProjectionStageTable(tigerPool: Pool): Promise<void> {
  await tigerPool.query(
    `
      DROP TABLE IF EXISTS ${PROJECTION_STAGE_RELATION};
      CREATE UNLOGGED TABLE ${PROJECTION_STAGE_RELATION}
      (LIKE docs.steam_news_search_projection INCLUDING DEFAULTS);
      CREATE UNIQUE INDEX steam_news_search_projection_reconcile_stage_gid_idx
        ON ${PROJECTION_STAGE_RELATION} (gid)
    `,
  );
}

async function dropProjectionStageTable(tigerPool: Pool): Promise<void> {
  await tigerPool.query(`DROP TABLE IF EXISTS ${PROJECTION_STAGE_RELATION}`);
}

async function reconcileProjectionMonth(
  sourcePool: Pool,
  tigerPool: Pool,
  monthKey: string,
  sourceCountBefore: number,
  tigerCountBefore: number,
  reason: string,
  progress: ProjectionReplayProgress,
): Promise<PartitionActionSummary> {
  const startedAt = Date.now();
  const targetColumns = [...PROJECTION_TARGET_COLUMNS];
  let cursorSortTime: string | null = null;
  let cursorGid: string | null = null;
  let batchCount = 0;
  let fetchMs = 0;
  let stageInsertMs = 0;
  let stagedRows = 0;

  logger.info("Replaying Tiger projection month", {
    pass: progress.replayPass,
    monthIndex: progress.monthIndex,
    totalMonths: progress.totalMonths,
    monthKey,
    reason,
    sourceCountBefore,
    tigerCountBefore,
  });

  await tigerPool.query(`TRUNCATE TABLE ${PROJECTION_STAGE_RELATION}`);

  while (true) {
    let batchResult: QueryResult<SteamNewsProjectionRow>;

    if (cursorSortTime && cursorGid) {
      const measuredBatch = await measureDurationMs(() =>
        sourcePool.query<SteamNewsProjectionRow>(
          `
            SELECT
              gid,
              appid,
              published_at::text,
              first_seen_at::text,
              sort_time::text,
              feed_scope,
              title,
              search_document::text
            FROM public.steam_news_search_projection
            WHERE sort_time >= $1::date
              AND sort_time < $2::date
              AND (sort_time, gid) > ($3::timestamptz, $4::text)
            ORDER BY sort_time ASC, gid ASC
            LIMIT $5
          `,
          [
            monthKey,
            addOneMonth(monthKey),
            cursorSortTime,
            cursorGid,
            NEWS_BATCH_SIZE,
          ],
        ),
      );
      batchResult = measuredBatch.result;
      fetchMs += measuredBatch.elapsedMs;
    } else {
      const measuredBatch = await measureDurationMs(() =>
        sourcePool.query<SteamNewsProjectionRow>(
          `
            SELECT
              gid,
              appid,
              published_at::text,
              first_seen_at::text,
              sort_time::text,
              feed_scope,
              title,
              search_document::text
            FROM public.steam_news_search_projection
            WHERE sort_time >= $1::date
              AND sort_time < $2::date
            ORDER BY sort_time ASC, gid ASC
            LIMIT $3
          `,
          [monthKey, addOneMonth(monthKey), NEWS_BATCH_SIZE],
        ),
      );
      batchResult = measuredBatch.result;
      fetchMs += measuredBatch.elapsedMs;
    }

    if (batchResult.rows.length === 0) {
      break;
    }

    batchCount += 1;
    const values: unknown[] = [];
    for (const row of batchResult.rows) {
      values.push(
        row.gid,
        row.appid,
        row.published_at,
        row.first_seen_at,
        row.sort_time,
        row.feed_scope,
        row.title,
        row.search_document,
      );
    }

    const stageInsertResult = await measureDurationMs(() =>
      tigerPool.query(
        buildInsertValuesSql(
          PROJECTION_STAGE_RELATION,
          targetColumns,
          batchResult.rows.length,
        ),
        values,
      ),
    );
    stageInsertMs += stageInsertResult.elapsedMs;

    stagedRows += batchResult.rows.length;
    const lastRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorSortTime = lastRow.sort_time;
    cursorGid = lastRow.gid;
  }

  const analyzeResult = await measureDurationMs(() =>
    tigerPool.query(`ANALYZE ${PROJECTION_STAGE_RELATION}`),
  );

  const deleteResult = await measureDurationMs(() =>
    tigerPool.query(
      `
        DELETE FROM ${PROJECTION_TARGET_RELATION} target
        WHERE target.sort_time >= $1::date
          AND target.sort_time < $2::date
          AND NOT EXISTS (
            SELECT 1
            FROM ${PROJECTION_STAGE_RELATION} stage
            WHERE stage.gid = target.gid
          )
      `,
      [monthKey, addOneMonth(monthKey)],
    ),
  );

  const upsertResult = await measureDurationMs(() =>
    tigerPool.query(
      buildProjectionUpsertSql(
        PROJECTION_TARGET_RELATION,
        PROJECTION_STAGE_RELATION,
        targetColumns,
      ),
    ),
  );

  const action: PartitionActionSummary = {
    analyzeMs: analyzeResult.elapsedMs,
    batches: batchCount,
    deletedRows: deleteResult.result.rowCount ?? 0,
    deleteMs: deleteResult.elapsedMs,
    elapsedMs: Date.now() - startedAt,
    fetchMs,
    partitionKey: monthKey,
    reason,
    replayed: true,
    sourceCountBefore,
    stagedRows,
    stageInsertMs,
    tigerCountAfter: stagedRows,
    tigerCountBefore,
    upsertMs: upsertResult.elapsedMs,
    writtenRows: stagedRows,
  };

  logger.info("Completed Tiger projection month replay", {
    pass: progress.replayPass,
    monthIndex: progress.monthIndex,
    totalMonths: progress.totalMonths,
    monthKey,
    reason,
    sourceCountBefore,
    tigerCountBefore,
    tigerCountAfter: action.tigerCountAfter,
    batches: action.batches,
    stagedRows,
    deletedRows: action.deletedRows,
    upsertAffectedRows: upsertResult.result.rowCount ?? 0,
    elapsedMs: action.elapsedMs,
    fetchMs: action.fetchMs,
    stageInsertMs: action.stageInsertMs,
    analyzeMs: action.analyzeMs,
    deleteMs: action.deleteMs,
    upsertMs: action.upsertMs,
  });

  return action;
}

async function fetchValidationCounts(
  tigerPool: Pool,
): Promise<SyncValidations> {
  const [
    duplicateEventIds,
    orphanedNewsItemGids,
    projectionRowsMissingNewsItems,
  ] = await Promise.all([
    tigerPool.query<{ duplicate_count: string }>(
      `
          SELECT count(*)::bigint AS duplicate_count
          FROM (
            SELECT id
            FROM events.app_change_events
            GROUP BY id
            HAVING count(*) > 1
          ) duplicates
        `,
    ),
    tigerPool.query<{ orphan_count: string }>(
      `
          SELECT count(*)::bigint AS orphan_count
          FROM events.app_change_events e
          LEFT JOIN docs.steam_news_items n ON n.gid = e.news_item_gid
          WHERE e.news_item_gid IS NOT NULL
            AND n.gid IS NULL
        `,
    ),
    tigerPool.query<{ missing_count: string }>(
      `
          SELECT count(*)::bigint AS missing_count
          FROM docs.steam_news_search_projection p
          LEFT JOIN docs.steam_news_items n ON n.gid = p.gid
          WHERE n.gid IS NULL
        `,
    ),
  ]);

  return {
    duplicateEventIds: Number(duplicateEventIds.rows[0]?.duplicate_count ?? 0),
    orphanedNewsItemGids: Number(
      orphanedNewsItemGids.rows[0]?.orphan_count ?? 0,
    ),
    projectionRowsMissingNewsItems: Number(
      projectionRowsMissingNewsItems.rows[0]?.missing_count ?? 0,
    ),
  };
}

async function summarizeNewsItems(
  sourcePool: Pool,
  tigerPool: Pool,
  lookbackDays: number,
  actions: PartitionActionSummary[],
): Promise<TableSyncSummary> {
  const dayKeys = listRecentUtcDayKeys(lookbackDays);
  const [sourceCounts, tigerCounts, sourceTotalCount, tigerTotalCount] =
    await Promise.all([
      fetchDayCountMap(
        sourcePool,
        "public.steam_news_items",
        "first_seen_at",
        dayKeys,
      ),
      fetchDayCountMap(
        tigerPool,
        "docs.steam_news_items",
        "first_seen_at",
        dayKeys,
      ),
      fetchCount(sourcePool, "public.steam_news_items"),
      fetchCount(tigerPool, "docs.steam_news_items"),
    ]);
  const dayMismatches = comparePartitionCounts(sourceCounts, tigerCounts);

  return {
    actions,
    dayMismatchesAfter: dayMismatches,
    dayMismatchesBefore: [],
    fullCountMatches: sourceTotalCount === tigerTotalCount,
    historicalDayMismatchesAfter: [],
    historicalDayMismatchesBefore: [],
    passed: sourceTotalCount === tigerTotalCount && dayMismatches.length === 0,
    sourceRelation: "public.steam_news_items",
    sourceTotalCount,
    tableName: "steam_news_items",
    targetRelation: "docs.steam_news_items",
    tigerTotalCount,
    totalDeletedRows: actions.reduce(
      (sum, action) => sum + action.deletedRows,
      0,
    ),
    totalWrittenRows: actions.reduce(
      (sum, action) => sum + action.writtenRows,
      0,
    ),
  };
}

async function summarizeAppChangeEvents(
  sourcePool: Pool,
  tigerPool: Pool,
  lookbackDays: number,
  sourceAppChangeMaxId: string | null,
  actions: PartitionActionSummary[],
): Promise<TableSyncSummary> {
  const dayKeys = listRecentUtcDayKeys(lookbackDays);
  const [sourceCounts, tigerCounts, sourceTotalCount, tigerTotalCount] =
    await Promise.all([
      fetchAppChangeDayCountMap(
        sourcePool,
        "public.app_change_events",
        dayKeys,
        sourceAppChangeMaxId,
      ),
      fetchAppChangeDayCountMap(
        tigerPool,
        "events.app_change_events",
        dayKeys,
      ),
      fetchAppChangeCount(
        sourcePool,
        "public.app_change_events",
        sourceAppChangeMaxId,
      ),
      fetchAppChangeCount(tigerPool, "events.app_change_events"),
    ]);
  const dayMismatches = comparePartitionCounts(sourceCounts, tigerCounts);

  return {
    actions,
    dayMismatchesAfter: dayMismatches,
    dayMismatchesBefore: [],
    fullCountMatches: sourceTotalCount === tigerTotalCount,
    historicalDayMismatchesAfter: [],
    historicalDayMismatchesBefore: [],
    passed: sourceTotalCount === tigerTotalCount && dayMismatches.length === 0,
    sourceRelation: "public.app_change_events",
    sourceTotalCount,
    tableName: "app_change_events",
    targetRelation: "events.app_change_events",
    tigerTotalCount,
    totalDeletedRows: actions.reduce(
      (sum, action) => sum + action.deletedRows,
      0,
    ),
    totalWrittenRows: actions.reduce(
      (sum, action) => sum + action.writtenRows,
      0,
    ),
  };
}

async function summarizeProjection(
  sourceSnapshot: ProjectionSourceSnapshot,
  tigerPool: Pool,
  recentDayKeys: string[],
  actions: PartitionActionSummary[],
): Promise<ProjectionSyncSummary> {
  const [tigerDayCounts, tigerMonthCounts] = await Promise.all([
    fetchDayCountMap(
      tigerPool,
      "docs.steam_news_search_projection",
      "sort_time",
      recentDayKeys,
    ),
    fetchMonthCountMap(
      tigerPool,
      "docs.steam_news_search_projection",
      "sort_time",
    ),
  ]);
  const monthMismatches = comparePartitionCounts(
    sourceSnapshot.monthCounts,
    tigerMonthCounts,
  );
  const dayMismatches = comparePartitionCounts(
    sourceSnapshot.dayCounts,
    tigerDayCounts,
  );
  const sourceTotalCount = sourceSnapshot.totalCount;
  const tigerTotalCount = sumCounts(tigerMonthCounts);

  return {
    actions,
    dayMismatchesAfter: dayMismatches,
    dayMismatchesBefore: [],
    fullCountMatches: sourceTotalCount === tigerTotalCount,
    historicalDayMismatchesAfter: [],
    historicalDayMismatchesBefore: [],
    monthMismatchesAfter: monthMismatches,
    monthMismatchesBefore: [],
    passed:
      sourceTotalCount === tigerTotalCount &&
      monthMismatches.length === 0 &&
      dayMismatches.length === 0,
    sourceRelation: "public.steam_news_search_projection",
    sourceTotalCount,
    tableName: "steam_news_search_projection",
    targetRelation: "docs.steam_news_search_projection",
    tigerTotalCount,
    totalDeletedRows: actions.reduce(
      (sum, action) => sum + action.deletedRows,
      0,
    ),
    totalWrittenRows: actions.reduce(
      (sum, action) => sum + action.writtenRows,
      0,
    ),
  };
}

async function main(): Promise<void> {
  const sourceConfig = loadSourceBaselineConfig();
  const tigerConfig = loadTigerConfig();
  const mode = readSyncMode(process.env.EVENTS_NEWS_SYNC_MODE);
  const projectionRepairScope = parseProjectionRepairScope(
    process.env.EVENTS_NEWS_SYNC_PROJECTION_REPAIR_SCOPE,
  );
  const appChangeMaxId = readOptionalBigIntString(
    "EVENTS_NEWS_SYNC_APP_CHANGE_MAX_ID",
    process.env.EVENTS_NEWS_SYNC_APP_CHANGE_MAX_ID,
  );
  const selectedTables = parseSelectedEventsNewsTables(
    process.env.EVENTS_NEWS_SYNC_TABLES,
  );
  const newsDayLookback = readPositiveInt(
    process.env.EVENTS_NEWS_SYNC_NEWS_DAY_LOOKBACK,
    DEFAULT_NEWS_DAY_LOOKBACK,
  );
  const eventDayLookback = readPositiveInt(
    process.env.EVENTS_NEWS_SYNC_EVENT_DAY_LOOKBACK,
    DEFAULT_EVENT_DAY_LOOKBACK,
  );
  const projectionDayLookback = readPositiveInt(
    process.env.EVENTS_NEWS_SYNC_PROJECTION_DAY_LOOKBACK,
    DEFAULT_PROJECTION_DAY_LOOKBACK,
  );

  const supportedTables: EventsNewsTableName[] = [
    "steam_news_items",
    "app_change_events",
    "steam_news_search_projection",
  ];

  if (selectedTables) {
    const unknownTables = [...selectedTables].filter(
      (name) => !supportedTables.includes(name),
    );
    if (unknownTables.length > 0) {
      throw new Error(
        `Unknown EVENTS_NEWS_SYNC_TABLES values: ${unknownTables.join(", ")}`,
      );
    }
  }

  const activeTables = supportedTables.filter((tableName) =>
    selectedTables ? selectedTables.has(tableName) : true,
  );
  const sourcePool = new Pool({
    application_name: `publisheriq-events-news-${mode}-source`,
    allowExitOnIdle: true,
    connectionString: sourceConfig.connectionString,
    max: 4,
    statement_timeout: sourceConfig.statementTimeoutMs,
  });
  const tigerPool = new Pool({
    application_name: `publisheriq-events-news-${mode}-target`,
    allowExitOnIdle: true,
    connectionString: tigerConfig.connectionString,
    max: 4,
    statement_timeout: tigerConfig.statementTimeoutMs,
  });
  const manifestLabel = resolveEventsNewsManifestLabel(
    process.env.EVENTS_NEWS_SYNC_MANIFEST_LABEL,
    `events-news-sync-${mode}`,
  );
  const tableSummaries: Array<TableSyncSummary | ProjectionSyncSummary> = [];
  let currentTable: EventsNewsTableName | null = null;
  let validations: SyncValidations | null = null;

  let lockAcquired = false;
  let projectionStagePrepared = false;

  try {
    logger.info("Starting Tiger events/news sync", {
      mode,
      manifestLabel,
      selectedTables: activeTables,
      appChangeMaxId,
      eventDayLookback,
      newsDayLookback,
      projectionDayLookback,
      projectionRepairScope,
    });

    if (mode === "reconcile") {
      await acquireReconcileLock(tigerPool);
      lockAcquired = true;
    }

    if (activeTables.includes("steam_news_items")) {
      currentTable = "steam_news_items";
      logger.info("Reconciling Tiger table", {
        mode,
        tableName: "steam_news_items",
      });
      const recentDayKeys = listRecentUtcDayKeys(newsDayLookback);
      const recentDayKeySet = new Set(recentDayKeys);
      const [sourceDayCountsBefore, tigerDayCountsBefore] = await Promise.all([
        fetchDayCountMap(
          sourcePool,
          "public.steam_news_items",
          "first_seen_at",
          recentDayKeys,
        ),
        fetchDayCountMap(
          tigerPool,
          "docs.steam_news_items",
          "first_seen_at",
          recentDayKeys,
        ),
      ]);
      const dayMismatchesBefore = comparePartitionCounts(
        sourceDayCountsBefore,
        tigerDayCountsBefore,
      );
      const [sourceHistoricalCountsBefore, tigerHistoricalCountsBefore] =
        await Promise.all([
          fetchFullDayCountMap(
            sourcePool,
            "public.steam_news_items",
            "first_seen_at",
            "gid",
          ),
          fetchFullDayCountMap(
            tigerPool,
            "docs.steam_news_items",
            "first_seen_at",
            "gid",
          ),
        ]);
      const historicalDayMismatchesBefore = comparePartitionCounts(
        sourceHistoricalCountsBefore,
        tigerHistoricalCountsBefore,
      ).filter((mismatch) => !recentDayKeySet.has(mismatch.partitionKey));
      const actions: PartitionActionSummary[] = [];

      if (mode === "reconcile") {
        logger.info("Replaying Tiger news item recent windows", {
          replayCount: buildRecentReplayDays(
            newsDayLookback,
            dayMismatchesBefore,
          ).length,
        });
        for (const { partitionKey, reason } of buildRecentReplayDays(
          newsDayLookback,
          dayMismatchesBefore,
        )) {
          actions.push(
            await reconcileSteamNewsItemsDay(
              sourcePool,
              tigerPool,
              partitionKey,
              sourceDayCountsBefore.get(partitionKey) ?? 0,
              tigerDayCountsBefore.get(partitionKey) ?? 0,
              reason,
            ),
          );
        }

        const postRecentSummary = await summarizeNewsItems(
          sourcePool,
          tigerPool,
          newsDayLookback,
          actions,
        );
        if (
          !postRecentSummary.fullCountMatches &&
          historicalDayMismatchesBefore.length > 0
        ) {
          logger.info("Replaying Tiger news item historical mismatches", {
            replayCount: historicalDayMismatchesBefore.length,
          });
          for (const mismatch of historicalDayMismatchesBefore) {
            actions.push(
              await reconcileSteamNewsItemsDay(
                sourcePool,
                tigerPool,
                mismatch.partitionKey,
                sourceHistoricalCountsBefore.get(mismatch.partitionKey) ?? 0,
                tigerHistoricalCountsBefore.get(mismatch.partitionKey) ?? 0,
                "mismatched_historical_day",
              ),
            );
          }

          const [
            sourceDayCountsAfterHistorical,
            tigerDayCountsAfterHistorical,
          ] = await Promise.all([
            fetchDayCountMap(
              sourcePool,
              "public.steam_news_items",
              "first_seen_at",
              recentDayKeys,
            ),
            fetchDayCountMap(
              tigerPool,
              "docs.steam_news_items",
              "first_seen_at",
              recentDayKeys,
            ),
          ]);
          const recentMismatchesAfterHistorical = comparePartitionCounts(
            sourceDayCountsAfterHistorical,
            tigerDayCountsAfterHistorical,
          );
          logger.info(
            "Replaying Tiger news item recent windows after historical repair",
            {
              replayCount: buildRecentReplayDays(
                newsDayLookback,
                recentMismatchesAfterHistorical,
              ).length,
            },
          );
          for (const { partitionKey, reason } of buildRecentReplayDays(
            newsDayLookback,
            recentMismatchesAfterHistorical,
          )) {
            actions.push(
              await reconcileSteamNewsItemsDay(
                sourcePool,
                tigerPool,
                partitionKey,
                sourceDayCountsAfterHistorical.get(partitionKey) ?? 0,
                tigerDayCountsAfterHistorical.get(partitionKey) ?? 0,
                `post_historical_${reason}`,
              ),
            );
          }
        }
      }

      const summary = await summarizeNewsItems(
        sourcePool,
        tigerPool,
        newsDayLookback,
        actions,
      );
      summary.dayMismatchesBefore = dayMismatchesBefore;
      summary.historicalDayMismatchesBefore = historicalDayMismatchesBefore;
      {
        const [sourceHistoricalCountsAfter, tigerHistoricalCountsAfter] =
          await Promise.all([
            fetchFullDayCountMap(
              sourcePool,
              "public.steam_news_items",
              "first_seen_at",
              "gid",
            ),
            fetchFullDayCountMap(
              tigerPool,
              "docs.steam_news_items",
              "first_seen_at",
              "gid",
            ),
          ]);
        summary.historicalDayMismatchesAfter = comparePartitionCounts(
          sourceHistoricalCountsAfter,
          tigerHistoricalCountsAfter,
        ).filter((mismatch) => !recentDayKeySet.has(mismatch.partitionKey));
      }
      summary.passed =
        summary.fullCountMatches &&
        summary.dayMismatchesAfter.length === 0 &&
        summary.historicalDayMismatchesAfter.length === 0;
      tableSummaries.push(summary);
      logger.info("Completed Tiger table sync", {
        tableName: "steam_news_items",
        passed: summary.passed,
        fullCountMatches: summary.fullCountMatches,
        recentDayMismatches: summary.dayMismatchesAfter.length,
        historicalDayMismatches: summary.historicalDayMismatchesAfter.length,
        actions: summary.actions.length,
      });
      currentTable = null;
    }

    if (activeTables.includes("app_change_events")) {
      currentTable = "app_change_events";
      logger.info("Reconciling Tiger table", {
        mode,
        tableName: "app_change_events",
      });
      const recentDayKeys = listRecentUtcDayKeys(eventDayLookback);
      const recentDayKeySet = new Set(recentDayKeys);
      const [sourceDayCountsBefore, tigerDayCountsBefore] = await Promise.all([
        fetchAppChangeDayCountMap(
          sourcePool,
          "public.app_change_events",
          recentDayKeys,
          appChangeMaxId,
        ),
        fetchAppChangeDayCountMap(
          tigerPool,
          "events.app_change_events",
          recentDayKeys,
        ),
      ]);
      const dayMismatchesBefore = comparePartitionCounts(
        sourceDayCountsBefore,
        tigerDayCountsBefore,
      );
      const [sourceHistoricalCountsBefore, tigerHistoricalCountsBefore] =
        await Promise.all([
          fetchAppChangeFullDayCountMap(
            sourcePool,
            "public.app_change_events",
            appChangeMaxId,
          ),
          fetchAppChangeFullDayCountMap(
            tigerPool,
            "events.app_change_events",
          ),
        ]);
      const historicalDayMismatchesBefore = comparePartitionCounts(
        sourceHistoricalCountsBefore,
        tigerHistoricalCountsBefore,
      ).filter((mismatch) => !recentDayKeySet.has(mismatch.partitionKey));
      const actions: PartitionActionSummary[] = [];

      if (mode === "reconcile") {
        logger.info("Replaying Tiger app change recent windows", {
          replayCount: buildRecentReplayDays(
            eventDayLookback,
            dayMismatchesBefore,
          ).length,
        });
        for (const { partitionKey, reason } of buildRecentReplayDays(
          eventDayLookback,
          dayMismatchesBefore,
        )) {
          actions.push(
            await reconcileAppChangeEventsDay(
              sourcePool,
              tigerPool,
              partitionKey,
              sourceDayCountsBefore.get(partitionKey) ?? 0,
              tigerDayCountsBefore.get(partitionKey) ?? 0,
              appChangeMaxId,
              reason,
            ),
          );
        }

        const postRecentSummary = await summarizeAppChangeEvents(
          sourcePool,
          tigerPool,
          eventDayLookback,
          appChangeMaxId,
          actions,
        );
        if (
          !postRecentSummary.fullCountMatches &&
          historicalDayMismatchesBefore.length > 0
        ) {
          logger.info("Replaying Tiger app change historical mismatches", {
            replayCount: historicalDayMismatchesBefore.length,
          });
          for (const mismatch of historicalDayMismatchesBefore) {
            actions.push(
              await reconcileAppChangeEventsDay(
                sourcePool,
                tigerPool,
                mismatch.partitionKey,
                sourceHistoricalCountsBefore.get(mismatch.partitionKey) ?? 0,
                tigerHistoricalCountsBefore.get(mismatch.partitionKey) ?? 0,
                appChangeMaxId,
                "mismatched_historical_day",
              ),
            );
          }

          const [
            sourceDayCountsAfterHistorical,
            tigerDayCountsAfterHistorical,
          ] = await Promise.all([
            fetchAppChangeDayCountMap(
              sourcePool,
              "public.app_change_events",
              recentDayKeys,
              appChangeMaxId,
            ),
            fetchAppChangeDayCountMap(
              tigerPool,
              "events.app_change_events",
              recentDayKeys,
            ),
          ]);
          const recentMismatchesAfterHistorical = comparePartitionCounts(
            sourceDayCountsAfterHistorical,
            tigerDayCountsAfterHistorical,
          );
          logger.info(
            "Replaying Tiger app change recent windows after historical repair",
            {
              replayCount: buildRecentReplayDays(
                eventDayLookback,
                recentMismatchesAfterHistorical,
              ).length,
            },
          );
          for (const { partitionKey, reason } of buildRecentReplayDays(
            eventDayLookback,
            recentMismatchesAfterHistorical,
          )) {
            actions.push(
              await reconcileAppChangeEventsDay(
                sourcePool,
                tigerPool,
                partitionKey,
                sourceDayCountsAfterHistorical.get(partitionKey) ?? 0,
                tigerDayCountsAfterHistorical.get(partitionKey) ?? 0,
                appChangeMaxId,
                `post_historical_${reason}`,
              ),
            );
          }
        }
      }

      const summary = await summarizeAppChangeEvents(
        sourcePool,
        tigerPool,
        eventDayLookback,
        appChangeMaxId,
        actions,
      );
      summary.dayMismatchesBefore = dayMismatchesBefore;
      summary.historicalDayMismatchesBefore = historicalDayMismatchesBefore;
      {
        const [sourceHistoricalCountsAfter, tigerHistoricalCountsAfter] =
          await Promise.all([
            fetchAppChangeFullDayCountMap(
              sourcePool,
              "public.app_change_events",
              appChangeMaxId,
            ),
            fetchAppChangeFullDayCountMap(
              tigerPool,
              "events.app_change_events",
            ),
          ]);
        summary.historicalDayMismatchesAfter = comparePartitionCounts(
          sourceHistoricalCountsAfter,
          tigerHistoricalCountsAfter,
        ).filter((mismatch) => !recentDayKeySet.has(mismatch.partitionKey));
      }
      summary.passed =
        summary.fullCountMatches &&
        summary.dayMismatchesAfter.length === 0 &&
        summary.historicalDayMismatchesAfter.length === 0;
      tableSummaries.push(summary);
      logger.info("Completed Tiger table sync", {
        tableName: "app_change_events",
        passed: summary.passed,
        fullCountMatches: summary.fullCountMatches,
        recentDayMismatches: summary.dayMismatchesAfter.length,
        historicalDayMismatches: summary.historicalDayMismatchesAfter.length,
        actions: summary.actions.length,
      });
      currentTable = null;
    }

    if (
      activeTables.includes("steam_news_search_projection") &&
      mode === "reconcile"
    ) {
      currentTable = "steam_news_search_projection";
      await prepareProjectionStageTable(tigerPool);
      projectionStagePrepared = true;
    }

    if (activeTables.includes("steam_news_search_projection")) {
      currentTable = "steam_news_search_projection";
      logger.info("Reconciling Tiger table", {
        mode,
        tableName: "steam_news_search_projection",
      });
      const tableStartedAt = Date.now();
      const recentDayKeys = listRecentUtcDayKeys(projectionDayLookback);
      const [sourceSnapshot, tigerMonthCountsBefore, tigerDayCountsBefore] =
        await Promise.all([
          fetchProjectionSourceSnapshot(sourcePool, recentDayKeys),
          fetchMonthCountMap(
            tigerPool,
            "docs.steam_news_search_projection",
            "sort_time",
          ),
          fetchDayCountMap(
            tigerPool,
            "docs.steam_news_search_projection",
            "sort_time",
            recentDayKeys,
          ),
        ]);
      const sourceMonthCountsBefore = sourceSnapshot.monthCounts;
      const sourceDayCountsBefore = sourceSnapshot.dayCounts;
      const monthMismatchesBefore = comparePartitionCounts(
        sourceMonthCountsBefore,
        tigerMonthCountsBefore,
      );
      const dayMismatchesBefore = comparePartitionCounts(
        sourceDayCountsBefore,
        tigerDayCountsBefore,
      );
      const actions: PartitionActionSummary[] = [];
      let summaryElapsedMs = 0;
      let summary: ProjectionSyncSummary;

      if (mode === "reconcile") {
        const firstPassMonths = buildProjectionReplayMonths(
          monthMismatchesBefore,
          dayMismatchesBefore,
          projectionRepairScope,
        );
        logger.info("Replaying Tiger projection months", {
          pass: 1,
          replayCount: firstPassMonths.length,
          scope: projectionRepairScope,
        });
        for (const [
          index,
          { partitionKey, reason },
        ] of firstPassMonths.entries()) {
          actions.push(
            await reconcileProjectionMonth(
              sourcePool,
              tigerPool,
              partitionKey,
              sourceMonthCountsBefore.get(partitionKey) ?? 0,
              tigerMonthCountsBefore.get(partitionKey) ?? 0,
              reason,
              {
                monthIndex: index + 1,
                replayPass: 1,
                totalMonths: firstPassMonths.length,
              },
            ),
          );
        }

        const postFirstPassSummaryResult = await measureDurationMs(() =>
          summarizeProjection(
            sourceSnapshot,
            tigerPool,
            recentDayKeys,
            actions,
          ),
        );
        summaryElapsedMs += postFirstPassSummaryResult.elapsedMs;
        const postFirstPassSummary = postFirstPassSummaryResult.result;
        if (!postFirstPassSummary.passed) {
          const secondPassMonths = buildProjectionReplayMonths(
            postFirstPassSummary.monthMismatchesAfter,
            postFirstPassSummary.dayMismatchesAfter,
            projectionRepairScope,
          );
          const tigerMonthCountsForSecondPass = await fetchMonthCountMap(
            tigerPool,
            "docs.steam_news_search_projection",
            "sort_time",
          );
          logger.info("Replaying Tiger projection months", {
            pass: 2,
            replayCount: secondPassMonths.length,
            scope: projectionRepairScope,
          });
          for (const [
            index,
            { partitionKey, reason },
          ] of secondPassMonths.entries()) {
            actions.push(
              await reconcileProjectionMonth(
                sourcePool,
                tigerPool,
                partitionKey,
                sourceMonthCountsBefore.get(partitionKey) ?? 0,
                tigerMonthCountsForSecondPass.get(partitionKey) ?? 0,
                `second_pass_${reason}`,
                {
                  monthIndex: index + 1,
                  replayPass: 2,
                  totalMonths: secondPassMonths.length,
                },
              ),
            );
          }

          const finalSummaryResult = await measureDurationMs(() =>
            summarizeProjection(
              sourceSnapshot,
              tigerPool,
              recentDayKeys,
              actions,
            ),
          );
          summaryElapsedMs += finalSummaryResult.elapsedMs;
          summary = finalSummaryResult.result;
        } else {
          summary = postFirstPassSummary;
        }
      } else {
        const summaryResult = await measureDurationMs(() =>
          summarizeProjection(
            sourceSnapshot,
            tigerPool,
            recentDayKeys,
            actions,
          ),
        );
        summaryElapsedMs += summaryResult.elapsedMs;
        summary = summaryResult.result;
      }
      summary.dayMismatchesBefore = dayMismatchesBefore;
      summary.monthMismatchesBefore = monthMismatchesBefore;
      tableSummaries.push(summary);
      logger.info("Completed Tiger table sync", {
        tableName: "steam_news_search_projection",
        passed: summary.passed,
        fullCountMatches: summary.fullCountMatches,
        recentDayMismatches: summary.dayMismatchesAfter.length,
        monthMismatches: summary.monthMismatchesAfter.length,
        actions: summary.actions.length,
        totalDeletedRows: summary.totalDeletedRows,
        totalWrittenRows: summary.totalWrittenRows,
        summaryElapsedMs,
        tableElapsedMs: Date.now() - tableStartedAt,
      });
      currentTable = null;
    }

    currentTable = null;
    validations = await fetchValidationCounts(tigerPool);
    const success =
      tableSummaries.every((summary) => summary.passed) &&
      validations.duplicateEventIds === 0 &&
      validations.orphanedNewsItemGids === 0 &&
      validations.projectionRowsMissingNewsItems === 0;

    const manifestPath = writeEventsNewsManifest(
      {
        capturedAt: new Date().toISOString(),
        mode,
        settings: {
          appChangeMaxId,
          eventDayLookback,
          newsDayLookback,
          projectionDayLookback,
          projectionRepairScope,
          selectedTables: activeTables,
        },
        success,
        tableSummaries,
        validations,
      } satisfies EventsNewsSyncManifest,
      manifestLabel,
      "events-news-sync-manifest.json",
    );

    logger.info(`Completed Tiger events/news ${mode}`, {
      manifestPath,
      success,
      tableNames: activeTables,
      validations,
    });

    if (!success) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (validations === null) {
      try {
        validations = await fetchValidationCounts(tigerPool);
      } catch {
        validations = null;
      }
    }

    try {
      const manifestPath = writeEventsNewsManifest(
        {
          capturedAt: new Date().toISOString(),
          mode,
          settings: {
            appChangeMaxId,
            eventDayLookback,
            newsDayLookback,
            projectionDayLookback,
            projectionRepairScope,
            selectedTables: activeTables,
          },
          success: false,
          tableSummaries,
          validations,
          error: {
            ...serializeError(error),
            failingTable: currentTable,
          },
        } satisfies EventsNewsSyncManifest,
        manifestLabel,
        "events-news-sync-manifest.json",
      );

      logger.error("Wrote failure manifest for Tiger events/news sync", {
        currentTable,
        manifestPath,
      });
    } catch (manifestError) {
      logger.error("Failed to write Tiger events/news failure manifest", {
        error: manifestError,
      });
    }

    throw error;
  } finally {
    try {
      if (projectionStagePrepared) {
        await dropProjectionStageTable(tigerPool);
      }
    } finally {
      if (lockAcquired) {
        await releaseReconcileLock(tigerPool);
      }
      await sourcePool.end();
      await tigerPool.end();
    }
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      logger.error("Failed to reconcile Tiger events/news tables", { error });
      process.exit(1);
    });
}
