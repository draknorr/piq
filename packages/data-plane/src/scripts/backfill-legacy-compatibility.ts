import { Pool, type QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadSourceBaselineConfig, loadTigerConfig } from '../config.js';

interface TablePlan<Row extends QueryResultRow> {
  batchSize: number;
  columns: Array<keyof Row & string>;
  conflictColumns: string[];
  orderBy: string;
  sourceRelation: string;
  targetRelation: string;
  updateColumns: string[];
}

interface Summary {
  sourceCount: number;
  tableName: string;
  tigerCount: number;
  writtenRows: number;
}

function parseSelectedTables(envValue: string | undefined): Set<string> | null {
  if (!envValue?.trim()) {
    return null;
  }

  return new Set(
    envValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

const CRITICAL_COMPATIBILITY_TABLES = ['apps', 'app_dlc', 'latest_daily_metrics', 'app_steam_deck'] as const;

const TABLE_PLANS: Array<{
  name: string;
  plan: TablePlan<QueryResultRow>;
}> = [
  {
    name: 'apps',
    plan: {
      batchSize: 2000,
      columns: [
        'appid',
        'name',
        'type',
        'is_free',
        'release_date',
        'release_date_raw',
        'store_asset_mtime',
        'has_workshop',
        'current_price_cents',
        'current_discount_percent',
        'is_released',
        'is_delisted',
        'created_at',
        'updated_at',
        'has_developer_info',
        'controller_support',
        'pics_review_score',
        'pics_review_percentage',
        'metacritic_score',
        'metacritic_url',
        'platforms',
        'release_state',
        'parent_appid',
        'homepage_url',
        'app_state',
        'last_content_update',
        'current_build_id',
        'content_descriptors',
        'languages',
        'last_seen_in_steam_applist_at',
      ],
      conflictColumns: ['appid'],
      orderBy: 'appid',
      sourceRelation: `
        (
          SELECT
            appid,
            name,
            type,
            is_free,
            release_date,
            release_date_raw,
            store_asset_mtime,
            has_workshop,
            current_price_cents,
            current_discount_percent,
            is_released,
            is_delisted,
            created_at,
            updated_at,
            has_developer_info,
            controller_support,
            pics_review_score,
            pics_review_percentage,
            metacritic_score,
            metacritic_url,
            platforms,
            release_state,
            parent_appid,
            homepage_url,
            app_state,
            last_content_update,
            current_build_id,
            content_descriptors,
            languages,
            last_seen_in_steam_applist_at
          FROM public.apps
          WHERE catalog_seed_state <> 'stub'
        ) source_apps
      `,
      targetRelation: 'legacy.apps',
      updateColumns: [
        'name',
        'type',
        'is_free',
        'release_date',
        'release_date_raw',
        'store_asset_mtime',
        'has_workshop',
        'current_price_cents',
        'current_discount_percent',
        'is_released',
        'is_delisted',
        'created_at',
        'updated_at',
        'has_developer_info',
        'controller_support',
        'pics_review_score',
        'pics_review_percentage',
        'metacritic_score',
        'metacritic_url',
        'platforms',
        'release_state',
        'parent_appid',
        'homepage_url',
        'app_state',
        'last_content_update',
        'current_build_id',
        'content_descriptors',
        'languages',
        'last_seen_in_steam_applist_at',
      ],
    },
  },
  {
    name: 'developers',
    plan: {
      batchSize: 2000,
      columns: [
        'id',
        'name',
        'normalized_name',
        'steam_vanity_url',
        'first_game_release_date',
        'game_count',
        'created_at',
        'updated_at',
        'last_embedding_sync',
        'embedding_hash',
      ],
      conflictColumns: ['id'],
      orderBy: 'id',
      sourceRelation: 'public.developers',
      targetRelation: 'legacy.developers',
      updateColumns: [
        'name',
        'normalized_name',
        'steam_vanity_url',
        'first_game_release_date',
        'game_count',
        'created_at',
        'updated_at',
        'last_embedding_sync',
        'embedding_hash',
      ],
    },
  },
  {
    name: 'publishers',
    plan: {
      batchSize: 2000,
      columns: [
        'id',
        'name',
        'normalized_name',
        'steam_vanity_url',
        'first_game_release_date',
        'game_count',
        'created_at',
        'updated_at',
        'last_embedding_sync',
        'embedding_hash',
      ],
      conflictColumns: ['id'],
      orderBy: 'id',
      sourceRelation: 'public.publishers',
      targetRelation: 'legacy.publishers',
      updateColumns: [
        'name',
        'normalized_name',
        'steam_vanity_url',
        'first_game_release_date',
        'game_count',
        'created_at',
        'updated_at',
        'last_embedding_sync',
        'embedding_hash',
      ],
    },
  },
  {
    name: 'app_developers',
    plan: {
      batchSize: 5000,
      columns: ['appid', 'developer_id'],
      conflictColumns: ['appid', 'developer_id'],
      orderBy: 'appid, developer_id',
      sourceRelation: 'public.app_developers',
      targetRelation: 'legacy.app_developers',
      updateColumns: ['appid', 'developer_id'],
    },
  },
  {
    name: 'app_publishers',
    plan: {
      batchSize: 5000,
      columns: ['appid', 'publisher_id'],
      conflictColumns: ['appid', 'publisher_id'],
      orderBy: 'appid, publisher_id',
      sourceRelation: 'public.app_publishers',
      targetRelation: 'legacy.app_publishers',
      updateColumns: ['appid', 'publisher_id'],
    },
  },
  {
    name: 'app_dlc',
    plan: {
      batchSize: 5000,
      columns: ['parent_appid', 'dlc_appid', 'source', 'created_at'],
      conflictColumns: ['parent_appid', 'dlc_appid'],
      orderBy: 'parent_appid, dlc_appid',
      sourceRelation: 'public.app_dlc',
      targetRelation: 'legacy.app_dlc',
      updateColumns: ['source', 'created_at'],
    },
  },
  {
    name: 'steam_genres',
    plan: {
      batchSize: 1000,
      columns: ['genre_id', 'name', 'created_at'],
      conflictColumns: ['genre_id'],
      orderBy: 'genre_id',
      sourceRelation: 'public.steam_genres',
      targetRelation: 'legacy.steam_genres',
      updateColumns: ['name', 'created_at'],
    },
  },
  {
    name: 'app_genres',
    plan: {
      batchSize: 5000,
      columns: ['appid', 'genre_id', 'is_primary', 'created_at'],
      conflictColumns: ['appid', 'genre_id'],
      orderBy: 'appid, genre_id',
      sourceRelation: 'public.app_genres',
      targetRelation: 'legacy.app_genres',
      updateColumns: ['is_primary', 'created_at'],
    },
  },
  {
    name: 'steam_tags',
    plan: {
      batchSize: 1000,
      columns: ['tag_id', 'name', 'created_at', 'updated_at'],
      conflictColumns: ['tag_id'],
      orderBy: 'tag_id',
      sourceRelation: 'public.steam_tags',
      targetRelation: 'legacy.steam_tags',
      updateColumns: ['name', 'created_at', 'updated_at'],
    },
  },
  {
    name: 'app_steam_tags',
    plan: {
      batchSize: 5000,
      columns: ['appid', 'tag_id', 'rank', 'created_at'],
      conflictColumns: ['appid', 'tag_id'],
      orderBy: 'appid, tag_id',
      sourceRelation: 'public.app_steam_tags',
      targetRelation: 'legacy.app_steam_tags',
      updateColumns: ['rank', 'created_at'],
    },
  },
  {
    name: 'app_steam_deck',
    plan: {
      batchSize: 2000,
      columns: ['appid', 'category', 'test_timestamp', 'tested_build_id', 'tests', 'updated_at'],
      conflictColumns: ['appid'],
      orderBy: 'appid',
      sourceRelation: 'public.app_steam_deck',
      targetRelation: 'legacy.app_steam_deck',
      updateColumns: ['category', 'test_timestamp', 'tested_build_id', 'tests', 'updated_at'],
    },
  },
  {
    name: 'latest_daily_metrics',
    plan: {
      batchSize: 2000,
      columns: [
        'appid',
        'metric_date',
        'owners_min',
        'owners_max',
        'owners_midpoint',
        'ccu_peak',
        'ccu_source',
        'total_reviews',
        'positive_reviews',
        'negative_reviews',
        'review_score',
        'review_score_desc',
        'positive_percentage',
        'price_cents',
        'discount_percent',
        'average_playtime_forever',
        'average_playtime_2weeks',
        'estimated_weekly_hours',
      ],
      conflictColumns: ['appid'],
      orderBy: 'appid',
      sourceRelation: 'public.latest_daily_metrics',
      targetRelation: 'legacy.latest_daily_metrics',
      updateColumns: [
        'metric_date',
        'owners_min',
        'owners_max',
        'owners_midpoint',
        'ccu_peak',
        'ccu_source',
        'total_reviews',
        'positive_reviews',
        'negative_reviews',
        'review_score',
        'review_score_desc',
        'positive_percentage',
        'price_cents',
        'discount_percent',
        'average_playtime_forever',
        'average_playtime_2weeks',
        'estimated_weekly_hours',
      ],
    },
  },
  {
    name: 'user_pins',
    plan: {
      batchSize: 2000,
      columns: ['id', 'user_id', 'entity_type', 'entity_id', 'display_name', 'pin_order', 'pinned_at'],
      conflictColumns: ['id'],
      orderBy: 'user_id, pin_order, id',
      sourceRelation: 'public.user_pins',
      targetRelation: 'legacy.user_pins',
      updateColumns: ['user_id', 'entity_type', 'entity_id', 'display_name', 'pin_order', 'pinned_at'],
    },
  },
  {
    name: 'user_alert_preferences',
    plan: {
      batchSize: 1000,
      columns: [
        'user_id',
        'alerts_enabled',
        'email_digest_enabled',
        'email_digest_frequency',
        'ccu_sensitivity',
        'review_sensitivity',
        'sentiment_sensitivity',
        'alert_ccu_spike',
        'alert_ccu_drop',
        'alert_trend_reversal',
        'alert_review_surge',
        'alert_sentiment_shift',
        'alert_price_change',
        'alert_new_release',
        'alert_milestone',
        'created_at',
        'updated_at',
      ],
      conflictColumns: ['user_id'],
      orderBy: 'user_id',
      sourceRelation: 'public.user_alert_preferences',
      targetRelation: 'legacy.user_alert_preferences',
      updateColumns: [
        'alerts_enabled',
        'email_digest_enabled',
        'email_digest_frequency',
        'ccu_sensitivity',
        'review_sensitivity',
        'sentiment_sensitivity',
        'alert_ccu_spike',
        'alert_ccu_drop',
        'alert_trend_reversal',
        'alert_review_surge',
        'alert_sentiment_shift',
        'alert_price_change',
        'alert_new_release',
        'alert_milestone',
        'created_at',
        'updated_at',
      ],
    },
  },
  {
    name: 'user_pin_alert_settings',
    plan: {
      batchSize: 1000,
      columns: [
        'pin_id',
        'use_custom_settings',
        'alerts_enabled',
        'ccu_sensitivity',
        'review_sensitivity',
        'sentiment_sensitivity',
        'alert_ccu_spike',
        'alert_ccu_drop',
        'alert_trend_reversal',
        'alert_review_surge',
        'alert_sentiment_shift',
        'alert_price_change',
        'alert_new_release',
        'alert_milestone',
        'created_at',
        'updated_at',
      ],
      conflictColumns: ['pin_id'],
      orderBy: 'pin_id',
      sourceRelation: 'public.user_pin_alert_settings',
      targetRelation: 'legacy.user_pin_alert_settings',
      updateColumns: [
        'use_custom_settings',
        'alerts_enabled',
        'ccu_sensitivity',
        'review_sensitivity',
        'sentiment_sensitivity',
        'alert_ccu_spike',
        'alert_ccu_drop',
        'alert_trend_reversal',
        'alert_review_surge',
        'alert_sentiment_shift',
        'alert_price_change',
        'alert_new_release',
        'alert_milestone',
        'created_at',
        'updated_at',
      ],
    },
  },
  {
    name: 'user_alerts',
    plan: {
      batchSize: 2000,
      columns: [
        'id',
        'user_id',
        'pin_id',
        'alert_type',
        'severity',
        'title',
        'description',
        'metric_name',
        'previous_value',
        'current_value',
        'change_percent',
        'dedup_key',
        'is_read',
        'read_at',
        'created_at',
        'source_data',
      ],
      conflictColumns: ['id'],
      orderBy: 'created_at DESC, id',
      sourceRelation: 'public.user_alerts',
      targetRelation: 'legacy.user_alerts',
      updateColumns: [
        'user_id',
        'pin_id',
        'alert_type',
        'severity',
        'title',
        'description',
        'metric_name',
        'previous_value',
        'current_value',
        'change_percent',
        'dedup_key',
        'is_read',
        'read_at',
        'created_at',
        'source_data',
      ],
    },
  },
];

function buildInsertSql(plan: TablePlan<QueryResultRow>, rowCount: number): string {
  const valuesSql = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = plan.columns.map(
      (_, columnIndex) => `$${rowIndex * plan.columns.length + columnIndex + 1}`
    );
    return `(${placeholders.join(', ')})`;
  }).join(',\n');

  const updateSql = plan.updateColumns
    .map((columnName) => `${columnName} = EXCLUDED.${columnName}`)
    .join(', ');

  return `
    INSERT INTO ${plan.targetRelation} (${plan.columns.join(', ')})
    VALUES ${valuesSql}
    ON CONFLICT (${plan.conflictColumns.join(', ')})
    DO UPDATE SET ${updateSql}
  `;
}

function assertCriticalTablePlansExist(selectedPlans: Array<{ name: string }>): void {
  const selectedNames = new Set(selectedPlans.map(({ name }) => name));
  const missingTables = CRITICAL_COMPATIBILITY_TABLES.filter((tableName) => !selectedNames.has(tableName));

  if (missingTables.length > 0) {
    throw new Error(
      `Legacy compatibility backfill is missing critical table plans: ${missingTables.join(', ')}`
    );
  }
}

async function fetchCount(pool: Pool, relation: string): Promise<number> {
  const result = await pool.query<{ row_count: string }>(
    `SELECT count(*)::bigint AS row_count FROM ${relation}`
  );
  return Number(result.rows[0]?.row_count ?? 0);
}

async function backfillTable(poolSource: Pool, poolTiger: Pool, name: string, plan: TablePlan<QueryResultRow>): Promise<Summary> {
  const sourceCount = await fetchCount(poolSource, plan.sourceRelation);
  let offset = 0;
  let writtenRows = 0;

  while (offset < sourceCount) {
    const batchResult = await poolSource.query<QueryResultRow>(
      `SELECT ${plan.columns.join(', ')}
       FROM ${plan.sourceRelation}
       ORDER BY ${plan.orderBy}
       LIMIT $1 OFFSET $2`,
      [plan.batchSize, offset]
    );

    if (batchResult.rows.length === 0) {
      break;
    }

    const values: unknown[] = [];
    for (const row of batchResult.rows) {
      for (const columnName of plan.columns) {
        values.push(row[columnName]);
      }
    }

    await poolTiger.query(buildInsertSql(plan, batchResult.rows.length), values);
    writtenRows += batchResult.rows.length;
    offset += batchResult.rows.length;

    logger.info('Backfilled legacy compatibility batch', {
      batchSize: batchResult.rows.length,
      offset,
      sourceCount,
      tableName: name,
      targetRelation: plan.targetRelation,
    });
  }

  const tigerCount = await fetchCount(poolTiger, plan.targetRelation);

  return {
    sourceCount,
    tableName: name,
    tigerCount,
    writtenRows,
  };
}

async function main(): Promise<void> {
  const sourceConfig = loadSourceBaselineConfig();
  const tigerConfig = loadTigerConfig();
  const selectedTables = parseSelectedTables(process.env.LEGACY_BACKFILL_TABLES);
  const sourcePool = new Pool({
    application_name: 'publisheriq-legacy-backfill-source',
    connectionString: sourceConfig.connectionString,
    max: 4,
    statement_timeout: sourceConfig.statementTimeoutMs,
  });
  const tigerPool = new Pool({
    application_name: 'publisheriq-legacy-backfill-target',
    connectionString: tigerConfig.connectionString,
    max: 4,
    statement_timeout: tigerConfig.statementTimeoutMs,
  });

  try {
    const summaries: Summary[] = [];
    const selectedPlans = selectedTables
      ? TABLE_PLANS.filter(({ name }) => selectedTables.has(name))
      : TABLE_PLANS;

    if (selectedTables && selectedPlans.length !== selectedTables.size) {
      const knownTables = new Set(TABLE_PLANS.map(({ name }) => name));
      const unknownTables = [...selectedTables].filter((name) => !knownTables.has(name));
      throw new Error(
        `Unknown LEGACY_BACKFILL_TABLES values: ${unknownTables.join(', ')}`
      );
    }

    if (!selectedTables) {
      assertCriticalTablePlansExist(selectedPlans);
    }

    logger.info('Starting legacy compatibility backfill', {
      selectedTables: selectedPlans.map(({ name }) => name),
    });

    for (const { name, plan } of selectedPlans) {
      summaries.push(await backfillTable(sourcePool, tigerPool, name, plan));
    }

    logger.info('Completed legacy compatibility backfill', { summaries });
  } finally {
    await sourcePool.end();
    await tigerPool.end();
  }
}

main().catch((error) => {
  logger.error('Failed to backfill legacy compatibility tables', { error });
  process.exitCode = 1;
});
