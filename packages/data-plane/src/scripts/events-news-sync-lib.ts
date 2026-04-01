import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

export const NEWS_BATCH_SIZE = 5_000;
export const EVENT_BATCH_SIZE = 4_000;

export type EventsNewsTableName =
  | 'steam_news_items'
  | 'steam_news_search_projection'
  | 'app_change_events';

export interface PartitionPlan {
  maxCursor: string | null;
  minCursor: string | null;
  partitionKey: string;
  sourceCount: number;
}

export function parseSelectedEventsNewsTables(
  envValue: string | undefined
): Set<EventsNewsTableName> | null {
  if (!envValue?.trim()) {
    return null;
  }

  return new Set(
    envValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as EventsNewsTableName[]
  );
}

export function getRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

export function resolveEventsNewsManifestLabel(
  explicitLabel: string | undefined,
  prefix: string
): string {
  if (explicitLabel?.trim()) {
    return explicitLabel.trim();
  }

  return `${prefix}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
}

export function writeEventsNewsManifest(
  manifest: unknown,
  label: string,
  fileName: string
): string {
  const repoRoot = getRepoRoot();
  const dateKey = new Date().toISOString().slice(0, 10);
  const outputDir = path.join(
    repoRoot,
    'docs',
    'reference',
    'tiger-target-baseline',
    dateKey,
    label
  );

  mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, fileName);
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return filePath;
}

export function buildInsertValuesSql(
  targetRelation: string,
  targetColumns: string[],
  rowCount: number
): string {
  const valuesSql = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = targetColumns.map(
      (_, columnIndex) => `$${rowIndex * targetColumns.length + columnIndex + 1}`
    );
    return `(${placeholders.join(', ')})`;
  }).join(',\n');

  return `
    INSERT INTO ${targetRelation} (${targetColumns.join(', ')})
    VALUES ${valuesSql}
  `;
}

export function buildInsertSql(
  targetRelation: string,
  targetColumns: string[],
  conflictColumns: string[],
  rowCount: number
): string {
  const updateSql = targetColumns
    .filter((columnName) => !conflictColumns.includes(columnName))
    .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
    .join(', ');

  return `
    ${buildInsertValuesSql(targetRelation, targetColumns, rowCount)}
    ON CONFLICT (${conflictColumns.join(', ')})
    DO UPDATE SET ${updateSql}
  `;
}

export async function fetchCount(pool: Pool, relation: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `SELECT count(*)::bigint AS row_count FROM ${relation}`
  );
  return Number(result.rows[0]?.row_count ?? 0);
}

export async function fetchMonthlyPlans(
  pool: Pool,
  relation: string,
  timeColumn: 'first_seen_at' | 'sort_time',
  cursorColumn: 'gid'
): Promise<PartitionPlan[]> {
  const result = await pool.query<{
    max_cursor: string | null;
    min_cursor: string | null;
    month_key: string;
    row_count: string;
  }>(
    `
      SELECT
        date_trunc('month', ${timeColumn})::date::text AS month_key,
        count(*)::bigint AS row_count,
        min(${cursorColumn})::text AS min_cursor,
        max(${cursorColumn})::text AS max_cursor
      FROM ${relation}
      GROUP BY 1
      ORDER BY 1 ASC
    `
  );

  return result.rows.map((row) => ({
    maxCursor: row.max_cursor,
    minCursor: row.min_cursor,
    partitionKey: row.month_key,
    sourceCount: Number(row.row_count),
  }));
}

export async function fetchDailyPlans(
  pool: Pool,
  relation: string,
  timeColumn: 'occurred_at' | 'first_seen_at' | 'sort_time',
  cursorColumn: 'id' | 'gid'
): Promise<PartitionPlan[]> {
  const result = await pool.query<{
    day_key: string;
    max_cursor: string | null;
    min_cursor: string | null;
    row_count: string;
  }>(
    `
      SELECT
        ${timeColumn}::date::text AS day_key,
        count(*)::bigint AS row_count,
        min(${cursorColumn})::text AS min_cursor,
        max(${cursorColumn})::text AS max_cursor
      FROM ${relation}
      GROUP BY 1
      ORDER BY 1 ASC
    `
  );

  return result.rows.map((row) => ({
    maxCursor: row.max_cursor,
    minCursor: row.min_cursor,
    partitionKey: row.day_key,
    sourceCount: Number(row.row_count),
  }));
}

export function addOneMonth(monthKey: string): string {
  const monthStart = new Date(`${monthKey}T00:00:00.000Z`);
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)
  )
    .toISOString()
    .slice(0, 10);
}

export function addOneDay(dayKey: string): string {
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function currentUtcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function shiftUtcDay(dayKey: string, days: number): string {
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  return new Date(dayStart.getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function listRecentUtcDayKeys(
  lookbackDays: number,
  now: Date = new Date()
): string[] {
  const keys = new Set<string>();
  const currentDay = currentUtcDayKey(now);

  for (let offset = 0; offset < lookbackDays; offset += 1) {
    keys.add(shiftUtcDay(currentDay, -offset));
  }

  return [...keys].sort();
}

export function currentUtcMonthKey(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

export function shiftUtcMonth(monthKey: string, months: number): string {
  const monthStart = new Date(`${monthKey}T00:00:00.000Z`);
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + months, 1)
  )
    .toISOString()
    .slice(0, 10);
}
