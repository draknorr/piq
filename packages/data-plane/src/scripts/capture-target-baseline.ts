import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { QueryResultRow } from 'pg';

import { logger } from '@publisheriq/shared';

import { loadTigerConfig } from '../config.js';
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
  const config = loadTigerConfig();
  const repoRoot = getRepoRoot();
  const dateKey = new Date().toISOString().slice(0, 10);
  const snapshotKey = resolveSnapshotKey();
  const outputDir = path.join(
    repoRoot,
    'docs',
    'reference',
    'tiger-target-baseline',
    dateKey,
    snapshotKey
  );

  mkdirSync(outputDir, { recursive: true });

  const serviceOverview = await fetchRows(`
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

  const relations = await fetchRows(`
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
    ORDER BY pg_total_relation_size(c.oid) DESC, n.nspname ASC, c.relname ASC
  `);

  writeJson(outputDir, 'service-overview.json', serviceOverview[0] ?? null);
  writeJson(outputDir, 'schemas.json', schemas);
  writeJson(outputDir, 'extensions.json', extensions);
  writeJson(outputDir, 'relations.json', relations);

  const readme = `# Tiger Target Baseline Snapshot

- Captured: ${new Date().toISOString()}
- Snapshot key: ${snapshotKey}
- Source: ${config.source}
- Connection source: Tiger service
- Purpose: verify the empty target before the first bootstrap write

## Files

- \`service-overview.json\`: database identity and engine version
- \`schemas.json\`: schema inventory on Tiger before bootstrap
- \`extensions.json\`: enabled extension inventory on Tiger before bootstrap
- \`relations.json\`: current tables and materialized views on Tiger before bootstrap
`;

  writeFileSync(path.join(outputDir, 'README.md'), readme, 'utf8');

  logger.info('Captured Tiger target baseline', {
    outputDir,
    source: config.source,
  });
}

main()
  .catch((error) => {
    logger.error('Failed to capture Tiger target baseline', { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownPool();
  });
