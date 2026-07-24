import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const TIGER_SCHEMAS = ['chat', 'core', 'docs', 'events', 'legacy', 'metrics', 'ops'];
const SUPABASE_SCHEMAS = ['public'];
const PROTECTED_SUPABASE_TABLES = [
  'credit_reservations',
  'credit_transactions',
  'user_alert_preferences',
  'user_alerts',
  'user_pin_alert_settings',
  'user_pins',
  'user_profiles',
] as const;

interface SchemaInventory {
  columns: QueryResultRow[];
  constraints: QueryResultRow[];
  indexes: QueryResultRow[];
  materializedViews: QueryResultRow[];
  relations: QueryResultRow[];
}

interface ProtectedObjectSummary {
  hashedRows: number;
  primaryKeyColumns: string[];
  primaryKeyHash: string | null;
  primaryKeyHashComplete: boolean;
  rows: number;
}

function getRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function requireConnectionString(name: 'DATABASE_URL' | 'TIGER_PRIMARY_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  writeFileSync(path.join(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveOutputDir(capturedAt: Date): string {
  const repoRoot = getRepoRoot();
  const dateKey = capturedAt.toISOString().slice(0, 10);
  const captureKey =
    process.env.BASELINE_CAPTURE_LABEL?.trim() ??
    capturedAt.toISOString().slice(11, 19).replaceAll(':', '-');

  return path.join(
    repoRoot,
    'docs',
    'reference',
    'daily-opportunity-prep-baseline',
    dateKey,
    captureKey
  );
}

async function withReadOnlyClient<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rows<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await client.query<T>(sql, values);
  return result.rows;
}

async function captureSchema(
  client: PoolClient,
  schemas: readonly string[]
): Promise<SchemaInventory> {
  const [relations, columns, constraints, indexes, materializedViews] = await Promise.all([
    rows(
      client,
      `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name
        LIMIT 5000
      `,
      [schemas]
    ),
    rows(
      client,
      `
        SELECT
          table_schema,
          table_name,
          column_name,
          data_type,
          is_nullable,
          ordinal_position
        FROM information_schema.columns
        WHERE table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name, ordinal_position
        LIMIT 20000
      `,
      [schemas]
    ),
    rows(
      client,
      `
        SELECT
          tc.table_schema,
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = ANY($1::text[])
        ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
        LIMIT 10000
      `,
      [schemas]
    ),
    rows(
      client,
      `
        SELECT schemaname, tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = ANY($1::text[])
        ORDER BY schemaname, tablename, indexname
        LIMIT 20000
      `,
      [schemas]
    ),
    rows(
      client,
      `
        SELECT schemaname, matviewname, ispopulated
        FROM pg_matviews
        WHERE schemaname = ANY($1::text[])
        ORDER BY schemaname, matviewname
        LIMIT 1000
      `,
      [schemas]
    ),
  ]);

  return {
    columns,
    constraints,
    indexes,
    materializedViews,
    relations,
  };
}

async function captureProtectedObject(
  client: PoolClient,
  schema: string,
  table: string
): Promise<ProtectedObjectSummary> {
  const primaryKeyRows = await rows<{ column_name: string }>(
    client,
    `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS keys(attnum, position)
        ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = keys.attnum
      WHERE i.indisprimary
        AND n.nspname = $1
        AND c.relname = $2
      ORDER BY keys.position
      LIMIT 20
    `,
    [schema, table]
  );
  const primaryKeyColumns = primaryKeyRows.map((row) => row.column_name);
  const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const countResult = await rows<{ rows: string }>(
    client,
    `SELECT count(*)::text AS rows FROM ${relation} LIMIT 1`
  );

  if (primaryKeyColumns.length === 0) {
    return {
      hashedRows: 0,
      primaryKeyColumns,
      primaryKeyHash: null,
      primaryKeyHashComplete: false,
      rows: Number(countResult[0]?.rows ?? 0),
    };
  }

  const selectedColumns = primaryKeyColumns.map(quoteIdentifier).join(', ');
  const keyRows = await rows(
    client,
    `SELECT ${selectedColumns} FROM ${relation} ORDER BY ${selectedColumns} LIMIT 100000`
  );
  const primaryKeyHash = createHash('sha256').update(JSON.stringify(keyRows)).digest('hex');

  return {
    hashedRows: keyRows.length,
    primaryKeyColumns,
    primaryKeyHash,
    primaryKeyHashComplete: keyRows.length === Number(countResult[0]?.rows ?? 0),
    rows: Number(countResult[0]?.rows ?? 0),
  };
}

async function captureTiger(client: PoolClient): Promise<Record<string, unknown>> {
  const [
    identity,
    changeEvents24h,
    captureWork,
    picsCursor,
    picsCoverage,
    appsProjection,
    unreleasedProjection,
  ] = await Promise.all([
    rows(
      client,
      `
        SELECT
          current_database() AS database_name,
          version() AS engine_version,
          now()::text AS captured_at_utc
        LIMIT 1
      `
    ),
    rows(
      client,
      `
        SELECT
          source,
          count(*)::text AS events_24h,
          max(occurred_at)::text AS latest_event_at
        FROM events.app_change_events
        WHERE occurred_at >= now() - INTERVAL '24 hours'
        GROUP BY source
        ORDER BY source
        LIMIT 50
      `
    ),
    rows(
      client,
      `
        SELECT
          source,
          count(*) FILTER (
            WHERE dirty_since IS NOT NULL AND dead_lettered_at IS NULL
          )::text AS dirty_non_dead,
          count(*) FILTER (
            WHERE dead_lettered_at IS NOT NULL
          )::text AS dead_lettered,
          min(dirty_since) FILTER (
            WHERE dirty_since IS NOT NULL AND dead_lettered_at IS NULL
          )::text AS oldest_dirty_at
        FROM ops.app_capture_work_state
        GROUP BY source
        ORDER BY source
        LIMIT 50
      `
    ),
    rows(
      client,
      `
        SELECT last_change_number::text, updated_at::text
        FROM ops.pics_sync_state
        ORDER BY updated_at DESC
        LIMIT 5
      `
    ),
    rows(
      client,
      `
        SELECT
          count(*) FILTER (
            WHERE last_pics_sync IS NULL
          )::text AS never_pics_synced,
          count(*) FILTER (
            WHERE is_syncable = true AND last_pics_sync IS NULL
          )::text AS syncable_never_pics_synced,
          max(last_pics_sync)::text AS latest_pics_sync
        FROM ops.sync_status
        LIMIT 1
      `
    ),
    rows(
      client,
      `
        SELECT
          count(*)::text AS rows,
          max(data_updated_at)::text AS latest_data_updated_at
        FROM metrics.apps_page_projection
        LIMIT 1
      `
    ),
    rows(
      client,
      `
        SELECT
          count(*)::text AS rows,
          max(data_updated_at)::text AS latest_data_updated_at,
          max(projection_refreshed_at)::text AS latest_projection_refreshed_at
        FROM metrics.unreleased_games_projection
        LIMIT 1
      `
    ),
  ]);

  return {
    appsProjection: appsProjection[0] ?? null,
    captureWork,
    changeEvents24h,
    identity: identity[0] ?? null,
    picsCoverage: picsCoverage[0] ?? null,
    picsCursor,
    unreleasedProjection: unreleasedProjection[0] ?? null,
  };
}

async function captureSupabase(client: PoolClient): Promise<Record<string, unknown>> {
  const [identity, changeEvents24h, latestDailyMetrics] = await Promise.all([
    rows(
      client,
      `
        SELECT
          current_database() AS database_name,
          version() AS engine_version,
          now()::text AS captured_at_utc
        LIMIT 1
      `
    ),
    rows(
      client,
      `
        SELECT
          source::text,
          count(*) FILTER (
            WHERE occurred_at >= now() - INTERVAL '24 hours'
          )::text AS events_24h,
          max(occurred_at)::text AS latest_event_at
        FROM public.app_change_events
        GROUP BY source
        ORDER BY source
        LIMIT 50
      `
    ),
    rows(
      client,
      `
        SELECT max(metric_date)::text AS latest_metric_date
        FROM public.daily_metrics
        WHERE metric_date >= current_date - INTERVAL '120 days'
        LIMIT 1
      `
    ),
  ]);

  const protectedObjects: Record<string, ProtectedObjectSummary> = {};
  for (const table of PROTECTED_SUPABASE_TABLES) {
    protectedObjects[table] = await captureProtectedObject(client, 'public', table);
  }

  return {
    changeEvents24h,
    identity: identity[0] ?? null,
    latestDailyMetrics: latestDailyMetrics[0] ?? null,
    protectedObjects,
  };
}

async function main(): Promise<void> {
  const capturedAt = new Date();
  const outputDir = resolveOutputDir(capturedAt);
  const tigerPool = new Pool({
    connectionString: requireConnectionString('TIGER_PRIMARY_URL'),
    max: 2,
  });
  const supabasePool = new Pool({
    connectionString: requireConnectionString('DATABASE_URL'),
    max: 2,
  });

  try {
    const [tigerResult, supabaseResult] = await Promise.all([
      withReadOnlyClient(tigerPool, async (client) => ({
        data: await captureTiger(client),
        schema: await captureSchema(client, TIGER_SCHEMAS),
      })),
      withReadOnlyClient(supabasePool, async (client) => ({
        data: await captureSupabase(client),
        schema: await captureSchema(client, SUPABASE_SCHEMAS),
      })),
    ]);

    mkdirSync(outputDir, { recursive: true });
    writeJson(outputDir, 'tiger-schema.json', tigerResult.schema);
    writeJson(outputDir, 'supabase-schema.json', supabaseResult.schema);
    writeJson(outputDir, 'manifest.json', {
      captureGaps: [
        'managed backup/PITR dashboard proof',
        'restorable snapshots for future in-place repairs',
        'R2 prefix-level object manifest',
        'GitHub and Railway runtime inventory',
        'authenticated browser route matrix',
      ],
      capturedAt: capturedAt.toISOString(),
      productionMutationPerformed: false,
      schemaVersion: 1,
      status: 'partial',
      supabase: supabaseResult.data,
      tiger: tigerResult.data,
    });
    writeFileSync(
      path.join(outputDir, 'README.md'),
      `# Daily Opportunity Preparation Baseline

- Captured: ${capturedAt.toISOString()}
- Database access: read-only transactions
- Production mutation performed: no

This snapshot contains schema metadata, bounded operational aggregates, and
hashed primary-key sets for protected Supabase user-control tables. It contains
no credentials or private profile fields.

The manifest remains partial until every item in \`captureGaps\` is resolved.
`,
      'utf8'
    );

    process.stdout.write(`${outputDir}\n`);
  } finally {
    await Promise.allSettled([tigerPool.end(), supabasePool.end()]);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
