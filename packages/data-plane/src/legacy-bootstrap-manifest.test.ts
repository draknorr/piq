import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CONTRACT_REGISTRY } from './contract-registry.js';
import {
  LEGACY_BACKFILL_RELATION_SPECS,
  TIGER_LEGACY_READY_CONTRACT_FALLBACK_RELATION_KEYS,
  TIGER_LEGACY_RELATION_KEYS,
} from './legacy-relation-manifest.js';
import { LEGACY_BACKFILL_TABLE_PLANS } from './scripts/backfill-legacy-compatibility.js';

const BOOTSTRAP_SQL_URLS = [
  new URL('../sql/tiger-bootstrap/0001_extensions_and_schemas.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0010_core_identity.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0020_legacy_compatibility.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0021_legacy_taxonomy.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0021_legacy_relationship_context.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0040_metrics_daily_metrics.sql', import.meta.url),
  new URL('../sql/tiger-bootstrap/0050_events_and_news.sql', import.meta.url),
].sort((left, right) => left.href.localeCompare(right.href));

function extractBootstrapLegacyTables(sql: string): string[] {
  return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS legacy\.([a-z_]+)\s*\(/g)].map(
    (match) => match[1] ?? ''
  );
}

function normalize(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean).sort();
}

test('legacy backfill target relations match Tiger bootstrap tables', async () => {
  const bootstrapSqlFiles = await Promise.all(
    BOOTSTRAP_SQL_URLS.map(async (sqlUrl) => readFile(sqlUrl, 'utf8'))
  );

  const backfillTargets = normalize(
    LEGACY_BACKFILL_RELATION_SPECS.map(({ name }) => name)
  );
  const bootstrapTables = normalize(bootstrapSqlFiles.flatMap(extractBootstrapLegacyTables));

  assert.deepEqual(backfillTargets, bootstrapTables);
});

test('legacy backfill plans match the shared manifest target relations', () => {
  const manifestTargets = normalize(
    LEGACY_BACKFILL_RELATION_SPECS.map(
      ({ name, targetRelation }) => `${name}:${targetRelation}`
    )
  );
  const plannedTargets = normalize(
    LEGACY_BACKFILL_TABLE_PLANS.map(({ name, plan }) => `${name}:${plan.targetRelation}`)
  );

  assert.deepEqual(plannedTargets, manifestTargets);
});

test('ready Tiger legacy relations are backfill-managed or explicitly fallback-only', () => {
  const managedLegacyRelations = new Set<string>(
    LEGACY_BACKFILL_RELATION_SPECS.map(({ relationKey }) => relationKey)
  );
  const fallbackOnlyLegacyRelations = new Set<string>(
    TIGER_LEGACY_READY_CONTRACT_FALLBACK_RELATION_KEYS
  );
  const knownTigerLegacyRelations = new Set<string>(TIGER_LEGACY_RELATION_KEYS);
  const uncoveredLegacyRelations = new Set<string>();

  for (const contract of CONTRACT_REGISTRY) {
    if (contract.status !== 'ready') {
      continue;
    }

    for (const relationKey of contract.requiredRelations) {
      if (!knownTigerLegacyRelations.has(relationKey)) {
        continue;
      }

      if (
        !managedLegacyRelations.has(relationKey) &&
        !fallbackOnlyLegacyRelations.has(relationKey)
      ) {
        uncoveredLegacyRelations.add(relationKey);
      }
    }
  }

  assert.deepEqual([...uncoveredLegacyRelations].sort(), []);
});
