import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadSourceBaselineConfig, loadTigerConfig } from '../config.js';

const DEFAULT_BATCH_SIZE = 2000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ColumnMapping {
  sourceExpression: string;
  targetColumn: string;
}

interface DailyPartitionPlan {
  deltaDate: string;
  maxAppid: number | null;
  minAppid: number | null;
  sourceCount: number;
}

interface DailyPartitionSummary extends DailyPartitionPlan {
  tigerCount: number;
  writtenRows: number;
}

interface BackfillManifest {
  appids: number[] | null;
  capturedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  dryRun: boolean;
  mismatchedDaysAtCompletion: Array<{
    deltaDate: string;
    sourceCount: number;
    tigerCount: number;
  }>;
  partitions: DailyPartitionSummary[];
  sourceTotalCountAtCompletion: number;
  sourceTotalCountAtStart: number;
  targetTotalCount: number;
}

interface SourceReviewDeltaRow extends QueryResultRow {
  appid: number;
  [key: string]: unknown;
}

const COLUMN_MAPPINGS: ColumnMapping[] = [
  { sourceExpression: 'appid', targetColumn: 'appid' },
  { sourceExpression: 'delta_date', targetColumn: 'delta_date' },
  { sourceExpression: 'total_reviews', targetColumn: 'total_reviews' },
  { sourceExpression: 'positive_reviews', targetColumn: 'positive_reviews' },
  { sourceExpression: 'review_score', targetColumn: 'review_score' },
  { sourceExpression: 'review_score_desc', targetColumn: 'review_score_desc' },
  { sourceExpression: 'reviews_added', targetColumn: 'reviews_added' },
  { sourceExpression: 'positive_added', targetColumn: 'positive_added' },
  { sourceExpression: 'negative_added', targetColumn: 'negative_added' },
  { sourceExpression: 'hours_since_last_sync', targetColumn: 'hours_since_last_sync' },
  { sourceExpression: 'is_interpolated', targetColumn: 'is_interpolated' },
  { sourceExpression: 'created_at', targetColumn: 'created_at' },
];

function getRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function resolveManifestLabel(): string {
  const explicitLabel = process.env.REVIEW_DELTAS_BACKFILL_MANIFEST_LABEL?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  return `review-deltas-backfill-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }

  throw new Error('REVIEW_DELTAS_BACKFILL_DRY_RUN must be true or false.');
}

function parseBatchSize(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) {
    throw new Error('REVIEW_DELTAS_BACKFILL_BATCH_SIZE must be an integer between 1 and 10000.');
  }

  return parsed;
}

function parseOptionalDate(value: string | undefined, envName: string): string | null {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (!DATE_ONLY_PATTERN.test(trimmed)) {
    throw new Error(`${envName} must be a YYYY-MM-DD string.`);
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error(`${envName} must be a valid calendar date.`);
  }

  return trimmed;
}

function parseOptionalAppids(value: string | undefined): number[] | null {
  if (!value?.trim()) {
    return null;
  }

  const appids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parsed = Number.parseInt(item, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid APPIDS entry: "${item}".`);
      }
      return parsed;
    });

  return [...new Set(appids)].sort((a, b) => a - b);
}

function buildInsertSql(rowCount: number): string {
  const targetColumns = COLUMN_MAPPINGS.map((mapping) => mapping.targetColumn);
  const valuesSql = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = targetColumns.map(
      (_, columnIndex) => `$${rowIndex * targetColumns.length + columnIndex + 1}`
    );
    return `(${placeholders.join(', ')})`;
  }).join(',\n');

  const updateSql = targetColumns
    .filter((columnName) => columnName !== 'appid' && columnName !== 'delta_date')
    .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
    .join(', ');

  return `
    INSERT INTO metrics.review_deltas (${targetColumns.join(', ')})
    VALUES ${valuesSql}
    ON CONFLICT (appid, delta_date)
    DO UPDATE SET ${updateSql}
  `;
}

async function fetchDailyPlans(
  pool: Pool,
  relation: 'metrics.review_deltas' | 'public.review_deltas',
  dateFrom: string | null,
  dateTo: string | null,
  appids: number[] | null
): Promise<DailyPartitionPlan[]> {
  const result = await pool.query<{
    delta_date: string;
    max_appid: number | null;
    min_appid: number | null;
    row_count: string;
  }>(
    `
      SELECT
        delta_date::text,
        count(*)::bigint AS row_count,
        min(appid) AS min_appid,
        max(appid) AS max_appid
      FROM ${relation}
      WHERE ($1::date IS NULL OR delta_date >= $1::date)
        AND ($2::date IS NULL OR delta_date <= $2::date)
        AND ($3::integer[] IS NULL OR appid = ANY($3::integer[]))
      GROUP BY delta_date
      ORDER BY delta_date ASC
    `,
    [dateFrom, dateTo, appids]
  );

  return result.rows.map((row) => ({
    deltaDate: row.delta_date,
    maxAppid: row.max_appid,
    minAppid: row.min_appid,
    sourceCount: Number(row.row_count),
  }));
}

async function fetchTigerCountForRange(
  pool: Pool,
  dateFrom: string | null,
  dateTo: string | null,
  appids: number[] | null
): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM metrics.review_deltas
      WHERE ($1::date IS NULL OR delta_date >= $1::date)
        AND ($2::date IS NULL OR delta_date <= $2::date)
        AND ($3::integer[] IS NULL OR appid = ANY($3::integer[]))
    `,
    [dateFrom, dateTo, appids]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchTigerCountForDay(
  pool: Pool,
  deltaDate: string,
  appids: number[] | null
): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM metrics.review_deltas
      WHERE delta_date = $1::date
        AND ($2::integer[] IS NULL OR appid = ANY($2::integer[]))
    `,
    [deltaDate, appids]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function backfillDailyPartition(
  sourcePool: Pool,
  tigerPool: Pool,
  plan: DailyPartitionPlan,
  appids: number[] | null,
  batchSize: number,
  dryRun: boolean
): Promise<DailyPartitionSummary> {
  let lastAppid = 0;
  let writtenRows = 0;

  while (true) {
    const batchResult = await sourcePool.query<SourceReviewDeltaRow>(
      `
        SELECT ${COLUMN_MAPPINGS.map(
          (mapping) => `${mapping.sourceExpression} AS ${mapping.targetColumn}`
        ).join(', ')}
        FROM public.review_deltas
        WHERE delta_date = $1::date
          AND appid > $2
          AND ($3::integer[] IS NULL OR appid = ANY($3::integer[]))
        ORDER BY appid ASC
        LIMIT $4
      `,
      [plan.deltaDate, lastAppid, appids, batchSize]
    );

    if (batchResult.rows.length === 0) {
      break;
    }

    if (!dryRun) {
      const values: unknown[] = [];
      for (const row of batchResult.rows) {
        for (const mapping of COLUMN_MAPPINGS) {
          values.push(row[mapping.targetColumn]);
        }
      }

      await tigerPool.query(buildInsertSql(batchResult.rows.length), values);
      writtenRows += batchResult.rows.length;
    }

    lastAppid = batchResult.rows[batchResult.rows.length - 1]?.appid ?? lastAppid;

    logger.info('Scanned metrics.review_deltas backfill batch', {
      deltaDate: plan.deltaDate,
      dryRun,
      lastAppid,
      sourceCount: plan.sourceCount,
      writtenRows,
    });
  }

  const tigerCount = await fetchTigerCountForDay(tigerPool, plan.deltaDate, appids);

  return {
    ...plan,
    tigerCount,
    writtenRows,
  };
}

function writeManifest(manifest: BackfillManifest): string {
  const repoRoot = getRepoRoot();
  const dateKey = new Date().toISOString().slice(0, 10);
  const outputDir = path.join(
    repoRoot,
    'docs',
    'reference',
    'tiger-target-baseline',
    dateKey,
    resolveManifestLabel()
  );

  mkdirSync(outputDir, { recursive: true });

  const filePath = path.join(outputDir, 'review-deltas-backfill-manifest.json');
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return filePath;
}

async function main(): Promise<void> {
  const dateFrom = parseOptionalDate(
    process.env.REVIEW_DELTAS_BACKFILL_DATE_FROM,
    'REVIEW_DELTAS_BACKFILL_DATE_FROM'
  );
  const dateTo = parseOptionalDate(
    process.env.REVIEW_DELTAS_BACKFILL_DATE_TO,
    'REVIEW_DELTAS_BACKFILL_DATE_TO'
  );
  const appids = parseOptionalAppids(process.env.APPIDS);
  const batchSize = parseBatchSize(process.env.REVIEW_DELTAS_BACKFILL_BATCH_SIZE);
  const dryRun = parseBoolean(process.env.REVIEW_DELTAS_BACKFILL_DRY_RUN, true);

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('REVIEW_DELTAS_BACKFILL_DATE_FROM must be on or before REVIEW_DELTAS_BACKFILL_DATE_TO.');
  }

  const sourceConfig = loadSourceBaselineConfig();
  const tigerConfig = loadTigerConfig();
  const sourcePool = new Pool({
    application_name: 'publisheriq-review-deltas-backfill-source',
    connectionString: sourceConfig.connectionString,
    max: 4,
    statement_timeout: sourceConfig.statementTimeoutMs,
  });
  const tigerPool = new Pool({
    application_name: 'publisheriq-review-deltas-backfill-target',
    connectionString: tigerConfig.connectionString,
    max: 4,
    statement_timeout: tigerConfig.statementTimeoutMs,
  });

  try {
    const dailyPlans = await fetchDailyPlans(
      sourcePool,
      'public.review_deltas',
      dateFrom,
      dateTo,
      appids
    );
    const summaries: DailyPartitionSummary[] = [];
    const sourceTotalCountAtStart = dailyPlans.reduce((sum, plan) => sum + plan.sourceCount, 0);

    logger.info('Starting metrics.review_deltas backfill', {
      appids,
      batchSize,
      dateFrom,
      dateTo,
      dryRun,
      partitionCount: dailyPlans.length,
      totalSourceRows: sourceTotalCountAtStart,
    });

    for (const plan of dailyPlans) {
      summaries.push(
        await backfillDailyPartition(sourcePool, tigerPool, plan, appids, batchSize, dryRun)
      );
    }

    const finalSourcePlans = await fetchDailyPlans(
      sourcePool,
      'public.review_deltas',
      dateFrom,
      dateTo,
      appids
    );
    const finalTigerPlans = await fetchDailyPlans(
      tigerPool,
      'metrics.review_deltas',
      dateFrom,
      dateTo,
      appids
    );
    const sourceTotalCountAtCompletion = finalSourcePlans.reduce(
      (sum, plan) => sum + plan.sourceCount,
      0
    );
    const targetTotalCount = await fetchTigerCountForRange(tigerPool, dateFrom, dateTo, appids);
    const sourceCountByDate = new Map(
      finalSourcePlans.map((plan) => [plan.deltaDate, plan.sourceCount])
    );
    const tigerCountByDate = new Map(
      finalTigerPlans.map((plan) => [plan.deltaDate, plan.sourceCount])
    );
    const mismatchedDaysAtCompletion = [...new Set([
      ...sourceCountByDate.keys(),
      ...tigerCountByDate.keys(),
    ])]
      .sort()
      .flatMap((deltaDate) => {
        const sourceCount = sourceCountByDate.get(deltaDate) ?? 0;
        const tigerCount = tigerCountByDate.get(deltaDate) ?? 0;

        return sourceCount === tigerCount
          ? []
          : [{ deltaDate, sourceCount, tigerCount }];
      });
    const manifestPath = writeManifest({
      appids,
      capturedAt: new Date().toISOString(),
      dateFrom,
      dateTo,
      dryRun,
      mismatchedDaysAtCompletion,
      partitions: summaries,
      sourceTotalCountAtCompletion,
      sourceTotalCountAtStart,
      targetTotalCount,
    });

    logger.info('Completed metrics.review_deltas backfill', {
      dryRun,
      manifestPath,
      mismatchedDaysAtCompletion: mismatchedDaysAtCompletion.length,
      sourceTotalCountAtCompletion,
      sourceTotalCountAtStart,
      targetTotalCount,
    });
  } finally {
    await sourcePool.end();
    await tigerPool.end();
  }
}

main().catch((error) => {
  logger.error('Failed to backfill metrics.review_deltas', { error });
  process.exitCode = 1;
});
