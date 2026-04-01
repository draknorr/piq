import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Pool, type QueryResult, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadSourceBaselineConfig, loadTigerConfig } from '../config.js';
import {
  EVENT_BATCH_SIZE,
  NEWS_BATCH_SIZE,
  addOneDay,
  addOneMonth,
  buildInsertSql,
  fetchCount,
  fetchDailyPlans,
  fetchMonthlyPlans,
  getRepoRoot,
  parseSelectedEventsNewsTables,
  type EventsNewsTableName as TableName,
  type PartitionPlan,
} from './events-news-sync-lib.js';

interface PartitionSummary extends PartitionPlan {
  tigerCount: number;
  writtenRows: number;
}

interface TableSummary {
  mismatchedPartitions: Array<{
    partitionKey: string;
    sourceCount: number;
    tigerCount: number;
  }>;
  partitions: PartitionSummary[];
  sourceRelation: string;
  sourceTotalCount: number;
  tableName: TableName;
  targetRelation: string;
  tigerTotalCount: number;
  writtenRows: number;
}

interface BackfillManifest {
  capturedAt: string;
  tableSummaries: TableSummary[];
  validations: {
    duplicateEventIds: number;
    orphanedNewsItemGids: number;
    projectionRowsMissingNewsItems: number;
  };
}

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

function resolveManifestLabel(): string {
  const explicitLabel = process.env.EVENTS_NEWS_BACKFILL_MANIFEST_LABEL?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  return `events-news-backfill-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
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
  const filePath = path.join(outputDir, 'events-news-backfill-manifest.json');
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return filePath;
}

function serializeJsonColumnValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

async function fetchNewsItemsPartitionCount(pool: Pool, monthKey: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM docs.steam_news_items
      WHERE first_seen_at >= $1::date
        AND first_seen_at < $2::date
    `,
    [monthKey, addOneMonth(monthKey)]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchNewsProjectionPartitionCount(pool: Pool, monthKey: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM docs.steam_news_search_projection
      WHERE sort_time >= $1::date
        AND sort_time < $2::date
    `,
    [monthKey, addOneMonth(monthKey)]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function fetchAppChangeEventsPartitionCount(pool: Pool, dayKey: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `
      SELECT count(*)::bigint AS row_count
      FROM events.app_change_events
      WHERE occurred_at >= $1::date
        AND occurred_at < $2::date
    `,
    [dayKey, addOneDay(dayKey)]
  );

  return Number(result.rows[0]?.row_count ?? 0);
}

async function backfillSteamNewsItemsPartition(
  sourcePool: Pool,
  tigerPool: Pool,
  plan: PartitionPlan
): Promise<PartitionSummary> {
  const targetColumns = [
    'gid',
    'appid',
    'url',
    'author',
    'feedlabel',
    'feedname',
    'published_at',
    'first_seen_at',
    'last_seen_at',
    'created_at',
    'updated_at',
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
          [plan.partitionKey, addOneMonth(plan.partitionKey), cursorFirstSeenAt, cursorGid, NEWS_BATCH_SIZE]
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
          [plan.partitionKey, addOneMonth(plan.partitionKey), NEWS_BATCH_SIZE]
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
        row.updated_at
      );
    }

    await tigerPool.query(
      buildInsertSql('docs.steam_news_items', targetColumns, ['gid'], batchResult.rows.length),
      values
    );

    writtenRows += batchResult.rows.length;
    const lastRow: SteamNewsItemRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorFirstSeenAt = lastRow.first_seen_at;
    cursorGid = lastRow.gid;

    logger.info('Backfilled docs.steam_news_items batch', {
      monthKey: plan.partitionKey,
      writtenRows,
    });
  }

  return {
    ...plan,
    tigerCount: await fetchNewsItemsPartitionCount(tigerPool, plan.partitionKey),
    writtenRows,
  };
}

async function backfillSteamNewsProjectionPartition(
  sourcePool: Pool,
  tigerPool: Pool,
  plan: PartitionPlan
): Promise<PartitionSummary> {
  const targetColumns = [
    'gid',
    'appid',
    'published_at',
    'first_seen_at',
    'sort_time',
    'feed_scope',
    'title',
    'search_document',
  ];
  let cursorSortTime: string | null = null;
  let cursorGid: string | null = null;
  let writtenRows = 0;

  while (true) {
    let batchResult: QueryResult<SteamNewsProjectionRow>;

    if (cursorSortTime && cursorGid) {
      batchResult = await sourcePool.query<SteamNewsProjectionRow>(
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
          [plan.partitionKey, addOneMonth(plan.partitionKey), cursorSortTime, cursorGid, NEWS_BATCH_SIZE]
        );
    } else {
      batchResult = await sourcePool.query<SteamNewsProjectionRow>(
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
          [plan.partitionKey, addOneMonth(plan.partitionKey), NEWS_BATCH_SIZE]
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
        row.published_at,
        row.first_seen_at,
        row.sort_time,
        row.feed_scope,
        row.title,
        row.search_document
      );
    }

    await tigerPool.query(
      buildInsertSql(
        'docs.steam_news_search_projection',
        targetColumns,
        ['gid'],
        batchResult.rows.length
      ),
      values
    );

    writtenRows += batchResult.rows.length;
    const lastRow: SteamNewsProjectionRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorSortTime = lastRow.sort_time;
    cursorGid = lastRow.gid;

    logger.info('Backfilled docs.steam_news_search_projection batch', {
      monthKey: plan.partitionKey,
      writtenRows,
    });
  }

  return {
    ...plan,
    tigerCount: await fetchNewsProjectionPartitionCount(tigerPool, plan.partitionKey),
    writtenRows,
  };
}

async function backfillAppChangeEventsPartition(
  sourcePool: Pool,
  tigerPool: Pool,
  plan: PartitionPlan
): Promise<PartitionSummary> {
  const targetColumns = [
    'id',
    'appid',
    'source',
    'change_type',
    'occurred_at',
    'source_snapshot_id',
    'related_snapshot_id',
    'media_version_id',
    'news_item_gid',
    'before_value',
    'after_value',
    'context',
    'trigger_cursor',
    'created_at',
  ];
  let cursorOccurredAt: string | null = null;
  let cursorId: string | null = null;
  let writtenRows = 0;

  while (true) {
    let batchResult: QueryResult<AppChangeEventRow>;

    if (cursorOccurredAt && cursorId) {
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
            WHERE occurred_at >= $1::date
              AND occurred_at < $2::date
              AND (occurred_at, id) > ($3::timestamptz, $4::bigint)
            ORDER BY occurred_at ASC, id ASC
            LIMIT $5
          `,
          [plan.partitionKey, addOneDay(plan.partitionKey), cursorOccurredAt, cursorId, EVENT_BATCH_SIZE]
        );
    } else {
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
            WHERE occurred_at >= $1::date
              AND occurred_at < $2::date
            ORDER BY occurred_at ASC, id ASC
            LIMIT $3
          `,
          [plan.partitionKey, addOneDay(plan.partitionKey), EVENT_BATCH_SIZE]
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
        row.created_at
      );
    }

    await tigerPool.query(
      buildInsertSql(
        'events.app_change_events',
        targetColumns,
        ['occurred_at', 'id'],
        batchResult.rows.length
      ),
      values
    );

    writtenRows += batchResult.rows.length;
    const lastRow: AppChangeEventRow = batchResult.rows[batchResult.rows.length - 1]!;
    cursorOccurredAt = lastRow.occurred_at;
    cursorId = lastRow.id;

    logger.info('Backfilled events.app_change_events batch', {
      dayKey: plan.partitionKey,
      writtenRows,
    });
  }

  return {
    ...plan,
    tigerCount: await fetchAppChangeEventsPartitionCount(tigerPool, plan.partitionKey),
    writtenRows,
  };
}

async function summarizeTable(
  tableName: TableName,
  sourceRelation: string,
  targetRelation: string,
  partitions: PartitionSummary[],
  sourcePool: Pool,
  tigerPool: Pool,
  fetchSourcePlans: () => Promise<PartitionPlan[]>,
  fetchTigerPlans: () => Promise<PartitionPlan[]>
): Promise<TableSummary> {
  const finalSourcePlans = await fetchSourcePlans();
  const finalTigerPlans = await fetchTigerPlans();
  const sourceCounts = new Map(finalSourcePlans.map((plan) => [plan.partitionKey, plan.sourceCount]));
  const tigerCounts = new Map(finalTigerPlans.map((plan) => [plan.partitionKey, plan.sourceCount]));
  const mismatchedPartitions = [...new Set([...sourceCounts.keys(), ...tigerCounts.keys()])]
    .sort()
    .flatMap((partitionKey) => {
      const sourceCount = sourceCounts.get(partitionKey) ?? 0;
      const tigerCount = tigerCounts.get(partitionKey) ?? 0;

      return sourceCount === tigerCount
        ? []
        : [{ partitionKey, sourceCount, tigerCount }];
    });

  return {
    mismatchedPartitions,
    partitions,
    sourceRelation,
    sourceTotalCount: await fetchCount(sourcePool, sourceRelation),
    tableName,
    targetRelation,
    tigerTotalCount: await fetchCount(tigerPool, targetRelation),
    writtenRows: partitions.reduce((sum, partition) => sum + partition.writtenRows, 0),
  };
}

async function main(): Promise<void> {
  const sourceConfig = loadSourceBaselineConfig();
  const tigerConfig = loadTigerConfig();
  const selectedTables = parseSelectedEventsNewsTables(
    process.env.EVENTS_NEWS_BACKFILL_TABLES
  );
  const sourcePool = new Pool({
    application_name: 'publisheriq-events-news-backfill-source',
    connectionString: sourceConfig.connectionString,
    max: 4,
    statement_timeout: sourceConfig.statementTimeoutMs,
  });
  const tigerPool = new Pool({
    application_name: 'publisheriq-events-news-backfill-target',
    connectionString: tigerConfig.connectionString,
    max: 4,
    statement_timeout: tigerConfig.statementTimeoutMs,
  });

  try {
    const supportedTables: TableName[] = [
      'steam_news_items',
      'steam_news_search_projection',
      'app_change_events',
    ];

    if (selectedTables) {
      const unknownTables = [...selectedTables].filter((name) => !supportedTables.includes(name));
      if (unknownTables.length > 0) {
        throw new Error(
          `Unknown EVENTS_NEWS_BACKFILL_TABLES values: ${unknownTables.join(', ')}`
        );
      }
    }

    const summaries: TableSummary[] = [];
    const shouldRun = (tableName: TableName): boolean =>
      selectedTables ? selectedTables.has(tableName) : true;

    if (shouldRun('steam_news_items')) {
      const plans = await fetchMonthlyPlans(sourcePool, 'public.steam_news_items', 'first_seen_at', 'gid');
      logger.info('Starting docs.steam_news_items backfill', {
        partitionCount: plans.length,
        sourceCount: plans.reduce((sum, plan) => sum + plan.sourceCount, 0),
      });

      const partitions: PartitionSummary[] = [];
      for (const plan of plans) {
        partitions.push(await backfillSteamNewsItemsPartition(sourcePool, tigerPool, plan));
      }

      summaries.push(
        await summarizeTable(
          'steam_news_items',
          'public.steam_news_items',
          'docs.steam_news_items',
          partitions,
          sourcePool,
          tigerPool,
          () => fetchMonthlyPlans(sourcePool, 'public.steam_news_items', 'first_seen_at', 'gid'),
          () => fetchMonthlyPlans(tigerPool, 'docs.steam_news_items', 'first_seen_at', 'gid')
        )
      );
    }

    if (shouldRun('steam_news_search_projection')) {
      const plans = await fetchMonthlyPlans(
        sourcePool,
        'public.steam_news_search_projection',
        'sort_time',
        'gid'
      );
      logger.info('Starting docs.steam_news_search_projection backfill', {
        partitionCount: plans.length,
        sourceCount: plans.reduce((sum, plan) => sum + plan.sourceCount, 0),
      });

      const partitions: PartitionSummary[] = [];
      for (const plan of plans) {
        partitions.push(await backfillSteamNewsProjectionPartition(sourcePool, tigerPool, plan));
      }

      summaries.push(
        await summarizeTable(
          'steam_news_search_projection',
          'public.steam_news_search_projection',
          'docs.steam_news_search_projection',
          partitions,
          sourcePool,
          tigerPool,
          () => fetchMonthlyPlans(sourcePool, 'public.steam_news_search_projection', 'sort_time', 'gid'),
          () => fetchMonthlyPlans(tigerPool, 'docs.steam_news_search_projection', 'sort_time', 'gid')
        )
      );
    }

    if (shouldRun('app_change_events')) {
      const plans = await fetchDailyPlans(sourcePool, 'public.app_change_events', 'occurred_at', 'id');
      logger.info('Starting events.app_change_events backfill', {
        partitionCount: plans.length,
        sourceCount: plans.reduce((sum, plan) => sum + plan.sourceCount, 0),
      });

      const partitions: PartitionSummary[] = [];
      for (const plan of plans) {
        partitions.push(await backfillAppChangeEventsPartition(sourcePool, tigerPool, plan));
      }

      summaries.push(
        await summarizeTable(
          'app_change_events',
          'public.app_change_events',
          'events.app_change_events',
          partitions,
          sourcePool,
          tigerPool,
          () => fetchDailyPlans(sourcePool, 'public.app_change_events', 'occurred_at', 'id'),
          () => fetchDailyPlans(tigerPool, 'events.app_change_events', 'occurred_at', 'id')
        )
      );
    }

    const validations = {
      duplicateEventIds: shouldRun('app_change_events')
        ? Number(
            (
              await tigerPool.query<{ duplicate_count: string }>(
                `
                  SELECT count(*)::bigint AS duplicate_count
                  FROM (
                    SELECT id
                    FROM events.app_change_events
                    GROUP BY id
                    HAVING count(*) > 1
                  ) duplicates
                `
              )
            ).rows[0]?.duplicate_count ?? 0
          )
        : 0,
      orphanedNewsItemGids:
        shouldRun('app_change_events') && shouldRun('steam_news_items')
          ? Number(
              (
                await tigerPool.query<{ orphan_count: string }>(
                  `
                    SELECT count(*)::bigint AS orphan_count
                    FROM events.app_change_events e
                    LEFT JOIN docs.steam_news_items n ON n.gid = e.news_item_gid
                    WHERE e.news_item_gid IS NOT NULL
                      AND n.gid IS NULL
                  `
                )
              ).rows[0]?.orphan_count ?? 0
            )
          : 0,
      projectionRowsMissingNewsItems:
        shouldRun('steam_news_items') && shouldRun('steam_news_search_projection')
          ? Number(
              (
                await tigerPool.query<{ missing_count: string }>(
                  `
                    SELECT count(*)::bigint AS missing_count
                    FROM docs.steam_news_search_projection p
                    LEFT JOIN docs.steam_news_items n ON n.gid = p.gid
                    WHERE n.gid IS NULL
                  `
                )
              ).rows[0]?.missing_count ?? 0
            )
          : 0,
    };

    const manifestPath = writeManifest({
      capturedAt: new Date().toISOString(),
      tableSummaries: summaries,
      validations,
    });

    logger.info('Completed events/news Tiger backfill', {
      manifestPath,
      tableNames: summaries.map((summary) => summary.tableName),
      validations,
    });
  } finally {
    await sourcePool.end();
    await tigerPool.end();
  }
}

main().catch((error) => {
  logger.error('Failed to backfill Tiger events/news tables', { error });
  process.exitCode = 1;
});
