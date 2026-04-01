import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Pool, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadSourceBaselineConfig, loadTigerConfig } from '../config.js';

const BATCH_SIZE = 2000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ColumnMapping {
  sourceExpression: string;
  targetColumn: string;
}

interface DailyPartitionPlan {
  maxAppid: number | null;
  metricDate: string;
  minAppid: number | null;
  sourceCount: number;
}

interface DailyPartitionSummary extends DailyPartitionPlan {
  tigerCount: number;
  writtenRows: number;
}

interface BackfillManifest {
  capturedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  mismatchedDaysAtCompletion: Array<{
    metricDate: string;
    sourceCount: number;
    tigerCount: number;
  }>;
  targetTotalCount: number;
  sourceTotalCountAtCompletion: number;
  sourceTotalCountAtStart: number;
  partitions: DailyPartitionSummary[];
}

const COLUMN_MAPPINGS: ColumnMapping[] = [
  { sourceExpression: 'id', targetColumn: 'source_daily_metric_id' },
  { sourceExpression: 'appid', targetColumn: 'appid' },
  { sourceExpression: 'metric_date', targetColumn: 'metric_date' },
  { sourceExpression: 'owners_min', targetColumn: 'owners_min' },
  { sourceExpression: 'owners_max', targetColumn: 'owners_max' },
  { sourceExpression: 'ccu_peak', targetColumn: 'ccu_peak' },
  { sourceExpression: 'average_playtime_forever', targetColumn: 'average_playtime_forever' },
  { sourceExpression: 'average_playtime_2weeks', targetColumn: 'average_playtime_2weeks' },
  { sourceExpression: 'total_reviews', targetColumn: 'total_reviews' },
  { sourceExpression: 'positive_reviews', targetColumn: 'positive_reviews' },
  { sourceExpression: 'negative_reviews', targetColumn: 'negative_reviews' },
  { sourceExpression: 'review_score', targetColumn: 'review_score' },
  { sourceExpression: 'review_score_desc', targetColumn: 'review_score_desc' },
  { sourceExpression: 'recent_total_reviews', targetColumn: 'recent_total_reviews' },
  { sourceExpression: 'recent_positive', targetColumn: 'recent_positive' },
  { sourceExpression: 'recent_negative', targetColumn: 'recent_negative' },
  { sourceExpression: 'recent_score_desc', targetColumn: 'recent_score_desc' },
  { sourceExpression: 'price_cents', targetColumn: 'price_cents' },
  { sourceExpression: 'discount_percent', targetColumn: 'discount_percent' },
  { sourceExpression: 'ccu_source', targetColumn: 'ccu_source' },
];

interface SourceMetricRow extends QueryResultRow {
  appid: number;
  source_daily_metric_id: string | number;
  [key: string]: unknown;
}

function getRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function resolveManifestLabel(): string {
  const explicitLabel = process.env.METRICS_BACKFILL_MANIFEST_LABEL?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  return `metrics-backfill-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
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

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return 0;
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
    .filter((columnName) => columnName !== 'appid' && columnName !== 'metric_date')
    .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
    .join(', ');

  return `
    INSERT INTO metrics.daily_metrics (${targetColumns.join(', ')})
    VALUES ${valuesSql}
    ON CONFLICT (appid, metric_date)
    DO UPDATE SET ${updateSql}
  `;
}

async function fetchDailyPlans(
  pool: Pool,
  relation: 'metrics.daily_metrics' | 'public.daily_metrics',
  dateFrom: string | null,
  dateTo: string | null
): Promise<DailyPartitionPlan[]> {
  const result = await pool.query<{
    max_appid: number | null;
    metric_date: string;
    min_appid: number | null;
    row_count: string;
  }>(
    `
      SELECT
        metric_date::text,
        count(*)::bigint AS row_count,
        min(appid) AS min_appid,
        max(appid) AS max_appid
      FROM ${relation}
      WHERE ($1::date IS NULL OR metric_date >= $1::date)
        AND ($2::date IS NULL OR metric_date <= $2::date)
      GROUP BY metric_date
      ORDER BY metric_date ASC
    `,
    [dateFrom, dateTo]
  );

  return result.rows.map((row) => ({
    maxAppid: row.max_appid,
    metricDate: row.metric_date,
    minAppid: row.min_appid,
    sourceCount: Number(row.row_count),
  }));
}

async function fetchTigerCountForRange(
  pool: Pool,
  dateFrom: string | null,
  dateTo: string | null
): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM metrics.daily_metrics
      WHERE ($1::date IS NULL OR metric_date >= $1::date)
        AND ($2::date IS NULL OR metric_date <= $2::date)
    `,
    [dateFrom, dateTo]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchTigerCountForDay(pool: Pool, metricDate: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM metrics.daily_metrics
      WHERE metric_date = $1::date
    `,
    [metricDate]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function backfillDailyPartition(
  sourcePool: Pool,
  tigerPool: Pool,
  plan: DailyPartitionPlan
): Promise<DailyPartitionSummary> {
  let lastAppid = 0;
  let writtenRows = 0;

  while (true) {
    const batchResult = await sourcePool.query<SourceMetricRow>(
      `
        SELECT ${COLUMN_MAPPINGS.map(
          (mapping) => `${mapping.sourceExpression} AS ${mapping.targetColumn}`
        ).join(', ')}
        FROM public.daily_metrics
        WHERE metric_date = $1::date
          AND appid > $2
        ORDER BY appid ASC
        LIMIT $3
      `,
      [plan.metricDate, lastAppid, BATCH_SIZE]
    );

    if (batchResult.rows.length === 0) {
      break;
    }

    const values: unknown[] = [];
    for (const row of batchResult.rows) {
      for (const mapping of COLUMN_MAPPINGS) {
        values.push(row[mapping.targetColumn]);
      }
    }

    await tigerPool.query(buildInsertSql(batchResult.rows.length), values);
    writtenRows += batchResult.rows.length;
    lastAppid = batchResult.rows[batchResult.rows.length - 1]?.appid ?? lastAppid;

    logger.info('Backfilled metrics.daily_metrics batch', {
      lastAppid,
      metricDate: plan.metricDate,
      sourceCount: plan.sourceCount,
      writtenRows,
    });
  }

  const tigerCount = await fetchTigerCountForDay(tigerPool, plan.metricDate);

  return {
    ...plan,
    tigerCount,
    writtenRows,
  };
}

function writeManifest(manifest: BackfillManifest): string {
  const repoRoot = getRepoRoot();
  const dateKey = new Date().toISOString().slice(0, 10);
  const label = resolveManifestLabel();
  const outputDir = path.join(
    repoRoot,
    'docs',
    'reference',
    'tiger-target-baseline',
    dateKey,
    label
  );

  mkdirSync(outputDir, { recursive: true });

  const filePath = path.join(outputDir, 'daily-metrics-backfill-manifest.json');
  writeFileSync(`${filePath}`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return filePath;
}

async function main(): Promise<void> {
  const dateFrom = parseOptionalDate(
    process.env.METRICS_BACKFILL_DATE_FROM,
    'METRICS_BACKFILL_DATE_FROM'
  );
  const dateTo = parseOptionalDate(
    process.env.METRICS_BACKFILL_DATE_TO,
    'METRICS_BACKFILL_DATE_TO'
  );

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('METRICS_BACKFILL_DATE_FROM must be on or before METRICS_BACKFILL_DATE_TO.');
  }

  const sourceConfig = loadSourceBaselineConfig();
  const tigerConfig = loadTigerConfig();
  const sourcePool = new Pool({
    application_name: 'publisheriq-metrics-backfill-source',
    connectionString: sourceConfig.connectionString,
    max: 4,
    statement_timeout: sourceConfig.statementTimeoutMs,
  });
  const tigerPool = new Pool({
    application_name: 'publisheriq-metrics-backfill-target',
    connectionString: tigerConfig.connectionString,
    max: 4,
    statement_timeout: tigerConfig.statementTimeoutMs,
  });

  try {
    const dailyPlans = await fetchDailyPlans(sourcePool, 'public.daily_metrics', dateFrom, dateTo);
    const summaries: DailyPartitionSummary[] = [];
    const sourceTotalCountAtStart = dailyPlans.reduce((sum, plan) => sum + plan.sourceCount, 0);

    logger.info('Starting metrics.daily_metrics backfill', {
      dateFrom,
      dateTo,
      partitionCount: dailyPlans.length,
      totalSourceRows: sourceTotalCountAtStart,
    });

    for (const plan of dailyPlans) {
      summaries.push(await backfillDailyPartition(sourcePool, tigerPool, plan));
    }

    const finalSourcePlans = await fetchDailyPlans(
      sourcePool,
      'public.daily_metrics',
      dateFrom,
      dateTo
    );
    const finalTigerPlans = await fetchDailyPlans(
      tigerPool,
      'metrics.daily_metrics',
      dateFrom,
      dateTo
    );
    const sourceTotalCountAtCompletion = finalSourcePlans.reduce(
      (sum, plan) => sum + plan.sourceCount,
      0
    );
    const targetTotalCount = await fetchTigerCountForRange(tigerPool, dateFrom, dateTo);
    const sourceCountByDate = new Map(
      finalSourcePlans.map((plan) => [plan.metricDate, plan.sourceCount])
    );
    const tigerCountByDate = new Map(
      finalTigerPlans.map((plan) => [plan.metricDate, plan.sourceCount])
    );
    const mismatchedDaysAtCompletion = [...new Set([
      ...sourceCountByDate.keys(),
      ...tigerCountByDate.keys(),
    ])]
      .sort()
      .flatMap((metricDate) => {
        const sourceCount = sourceCountByDate.get(metricDate) ?? 0;
        const tigerCount = tigerCountByDate.get(metricDate) ?? 0;

        return sourceCount === tigerCount
          ? []
          : [{ metricDate, sourceCount, tigerCount }];
      });
    const manifestPath = writeManifest({
      capturedAt: new Date().toISOString(),
      dateFrom,
      dateTo,
      mismatchedDaysAtCompletion,
      partitions: summaries,
      sourceTotalCountAtCompletion,
      sourceTotalCountAtStart,
      targetTotalCount,
    });

    logger.info('Completed metrics.daily_metrics backfill', {
      mismatchedDaysAtCompletion: mismatchedDaysAtCompletion.length,
      manifestPath,
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
  logger.error('Failed to backfill metrics.daily_metrics', { error });
  process.exitCode = 1;
});
