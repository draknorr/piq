import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadSourceBaselineConfig } from '../config.js';
import { runQuery, shutdownPool } from '../pg.js';

function getRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function resolveSnapshotKey(): string {
  const explicitLabel = process.env.BASELINE_CAPTURE_LABEL?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function resolvePgDumpBinary(): string {
  const explicit = process.env.PG_DUMP_BINARY;
  if (explicit) {
    return explicit;
  }

  const homebrewBinary = '/opt/homebrew/opt/libpq/bin/pg_dump';
  return homebrewBinary;
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  writeFileSync(
    path.join(outputDir, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
}

async function fetchRows<T extends QueryResultRow>(sql: string) {
  const result = await runQuery<T>(sql);
  return result.rows;
}

async function main(): Promise<void> {
  const config = loadSourceBaselineConfig();
  const repoRoot = getRepoRoot();
  const dateKey = new Date().toISOString().slice(0, 10);
  const snapshotKey = resolveSnapshotKey();
  const outputDir = path.join(
    repoRoot,
    'docs',
    'reference',
    'tiger-live-baseline',
    dateKey,
    snapshotKey
  );

  mkdirSync(outputDir, { recursive: true });

  const sourceOverview = await fetchRows(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      version() AS version
  `);

  const schemas = await fetchRows(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT LIKE 'pg_temp_%'
      AND schema_name NOT LIKE 'pg_toast_temp_%'
    ORDER BY schema_name
  `);

  const extensions = await fetchRows(`
    SELECT extname, extversion, n.nspname AS schema_name
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY extname
  `);

  const matviews = await fetchRows(`
    SELECT schemaname, matviewname
    FROM pg_matviews
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, matviewname
  `);

  const publicFunctions = await fetchRows(`
    SELECT
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);

  const largeRelations = await fetchRows(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS relation_name,
      c.relkind,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
      c.reltuples::bigint AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND c.relkind IN ('r', 'm')
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 50
  `);

  const chatSurface = await fetchRows(`
    SELECT
      tool_name,
      count(*)::bigint AS call_count
    FROM (
      SELECT unnest(tool_names) AS tool_name
      FROM chat_query_logs
      WHERE tool_names IS NOT NULL
    ) tool_calls
    GROUP BY tool_name
    ORDER BY call_count DESC, tool_name ASC
  `);

  const userSurface = await fetchRows(`
    SELECT
      table_schema,
      table_name,
      pg_total_relation_size(format('%I.%I', table_schema, table_name)::regclass) AS total_bytes,
      pg_size_pretty(pg_total_relation_size(format('%I.%I', table_schema, table_name)::regclass)) AS total_size
    FROM information_schema.tables
    WHERE (table_schema = 'public' AND table_name IN (
      'user_profiles',
      'waitlist',
      'user_pins',
      'user_alerts',
      'user_alert_preferences',
      'user_pin_alert_settings',
      'credit_transactions',
      'rate_limit_state',
      'chat_query_logs'
    )) OR (table_schema = 'auth' AND table_name = 'users')
    ORDER BY table_schema, table_name
  `);

  const portableSchemas = schemas
    .map((row) => String(row.schema_name))
    .filter(
      (schemaName) =>
        !['auth', 'storage', 'vault', 'graphql', 'graphql_public', 'realtime', 'supabase_migrations'].includes(
          schemaName
        )
    );

  writeJson(outputDir, 'source-overview.json', sourceOverview[0] ?? null);
  writeJson(outputDir, 'schemas.json', schemas);
  writeJson(outputDir, 'portable-schemas.json', portableSchemas);
  writeJson(outputDir, 'extensions.json', extensions);
  writeJson(outputDir, 'matviews.json', matviews);
  writeJson(outputDir, 'public-functions.json', publicFunctions);
  writeJson(outputDir, 'large-relations.json', largeRelations);
  writeJson(outputDir, 'chat-surface.json', chatSurface);
  writeJson(outputDir, 'user-surface.json', userSurface);

  const schemaDump = execFileSync(
    resolvePgDumpBinary(),
    ['--schema-only', '--no-owner', '--no-privileges', config.connectionString],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    }
  );
  writeFileSync(path.join(outputDir, 'schema.sql'), schemaDump, 'utf8');

  const readme = `# Tiger Live Baseline Snapshot

- Captured: ${new Date().toISOString()}
- Snapshot key: ${snapshotKey}
- Source: ${config.source}
- Connection source: live production database
- Purpose: bootstrap Tiger migration work from the live database, not historical migration files

## Files

- \`source-overview.json\`: database identity and engine version
- \`schemas.json\`: schema inventory
- \`portable-schemas.json\`: schemas that can move to Tiger without Supabase platform baggage
- \`extensions.json\`: installed extensions on the source system
- \`matviews.json\`: materialized view inventory
- \`public-functions.json\`: public function inventory
- \`large-relations.json\`: top tables and matviews by size
- \`chat-surface.json\`: current chat tool usage surface from \`chat_query_logs\`
- \`user-surface.json\`: auth-adjacent user tables still coupled to Supabase
- \`schema.sql\`: schema-only dump of the live source database
`;

  writeFileSync(path.join(outputDir, 'README.md'), readme, 'utf8');

  logger.info('Captured Tiger migration baseline', {
    outputDir,
    source: config.source,
  });
}

main()
  .catch((error) => {
    logger.error('Failed to capture Tiger migration baseline', { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownPool();
  });
