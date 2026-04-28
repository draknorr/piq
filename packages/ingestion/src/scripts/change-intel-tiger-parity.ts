import { Pool } from 'pg';

import { readChangeIntelRuntimeConfig } from '../change-intel/runtime-config.js';

interface ParityCheck {
  cutoffColumn: string;
  name: string;
  sourceRelation: string;
  targetRelation: string;
}

interface ParityResult {
  error?: string;
  name: string;
  sourceCount: number | null;
  targetCount: number | null;
}

const DEFAULT_LOOKBACK_DAYS = 30;

const CHECKS: ParityCheck[] = [
  {
    cutoffColumn: 'occurred_at',
    name: 'app_change_events',
    sourceRelation: 'public.app_change_events',
    targetRelation: 'events.app_change_events',
  },
  {
    cutoffColumn: 'first_seen_at',
    name: 'steam_news_items',
    sourceRelation: 'public.steam_news_items',
    targetRelation: 'docs.steam_news_items',
  },
  {
    cutoffColumn: 'first_seen_at',
    name: 'steam_news_versions',
    sourceRelation: 'public.steam_news_versions',
    targetRelation: 'docs.steam_news_versions',
  },
  {
    cutoffColumn: 'first_seen_at',
    name: 'steam_news_search_projection',
    sourceRelation: 'public.steam_news_search_projection',
    targetRelation: 'docs.steam_news_search_projection',
  },
  {
    cutoffColumn: 'first_seen_at',
    name: 'app_source_snapshots',
    sourceRelation: 'public.app_source_snapshots',
    targetRelation: 'docs.app_source_snapshots',
  },
  {
    cutoffColumn: 'first_seen_at',
    name: 'app_media_versions',
    sourceRelation: 'public.app_media_versions',
    targetRelation: 'docs.app_media_versions',
  },
];

function requireSourceUrl(): string {
  const sourceUrl = process.env.CHANGE_INTEL_SOURCE_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('Missing CHANGE_INTEL_SOURCE_URL or DATABASE_URL.');
  }

  return sourceUrl;
}

function requireTigerUrl(): string {
  const config = readChangeIntelRuntimeConfig();
  if (!config.tigerDatabaseUrl) {
    throw new Error('Missing CHANGE_INTEL_TIGER_URL or TIGER_PRIMARY_URL.');
  }

  return config.tigerDatabaseUrl;
}

function readLookbackDays(): number {
  const parsed = Number(process.env.CHANGE_INTEL_PARITY_LOOKBACK_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOOKBACK_DAYS;
}

function assertSafeRelationName(value: string): void {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe relation name: ${value}`);
  }
}

function assertSafeColumnName(value: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe column name: ${value}`);
  }
}

async function countRows(pool: Pool, relation: string, cutoffColumn: string, cutoffIso: string): Promise<number> {
  assertSafeRelationName(relation);
  assertSafeColumnName(cutoffColumn);

  const { rows } = await pool.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM ${relation}
      WHERE ${cutoffColumn} >= $1::timestamptz
    `,
    [cutoffIso]
  );

  return Number(rows[0]?.count ?? 0);
}

async function runCheck(
  sourcePool: Pool,
  targetPool: Pool,
  check: ParityCheck,
  cutoffIso: string
): Promise<ParityResult> {
  try {
    const [sourceCount, targetCount] = await Promise.all([
      countRows(sourcePool, check.sourceRelation, check.cutoffColumn, cutoffIso),
      countRows(targetPool, check.targetRelation, check.cutoffColumn, cutoffIso),
    ]);

    return {
      name: check.name,
      sourceCount,
      targetCount,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      name: check.name,
      sourceCount: null,
      targetCount: null,
    };
  }
}

async function main(): Promise<void> {
  const lookbackDays = readLookbackDays();
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const sourcePool = new Pool({
    application_name: 'publisheriq-change-intel-parity-source',
    connectionString: requireSourceUrl(),
    max: 2,
  });
  const targetPool = new Pool({
    application_name: 'publisheriq-change-intel-parity-tiger',
    connectionString: requireTigerUrl(),
    max: 2,
  });

  try {
    const results = await Promise.all(
      CHECKS.map((check) => runCheck(sourcePool, targetPool, check, cutoffIso))
    );
    const mismatches = results.filter(
      (result) =>
        result.error ||
        result.sourceCount === null ||
        result.targetCount === null ||
        result.sourceCount !== result.targetCount
    );

    console.log(
      JSON.stringify(
        {
          cutoffIso,
          lookbackDays,
          mismatches,
          results,
        },
        null,
        2
      )
    );

    if (process.env.CHANGE_INTEL_PARITY_STRICT === 'true' && mismatches.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
