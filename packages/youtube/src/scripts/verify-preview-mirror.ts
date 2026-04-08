import type { Pool } from 'pg';

import { createPgPool, closePools } from '../db.js';
import {
  evaluateMirrorCheck,
  MIRROR_CHECKS,
  type MirrorCheckResult,
  resolveMirrorVerificationConfig,
} from '../verify-preview-mirror.js';

async function queryCheck(pool: Pool, sql: string): Promise<MirrorCheckResult> {
  const result = await pool.query<MirrorCheckResult>(sql);
  const row = result.rows[0];
  return {
    max_time: row?.max_time ?? null,
    min_time: row?.min_time ?? null,
    row_count: row?.row_count ?? 0,
  };
}

async function main(): Promise<void> {
  const config = resolveMirrorVerificationConfig();

  const previewPool = createPgPool({
    applicationName: 'publisheriq-youtube-verify-preview',
    connectionString: config.previewConnectionString,
    statementTimeoutMs: config.statementTimeoutMs,
  });
  const productionPool = createPgPool({
    applicationName: 'publisheriq-youtube-verify-production',
    connectionString: config.productionConnectionString,
    statementTimeoutMs: config.statementTimeoutMs,
  });

  try {
    const evaluations = await Promise.all(
      MIRROR_CHECKS.map(async (check) => {
        const [production, preview] = await Promise.all([
          queryCheck(productionPool, check.sql),
          queryCheck(previewPool, check.sql),
        ]);

        return evaluateMirrorCheck(check, preview, production);
      })
    );

    console.table(
      evaluations.map((evaluation) => ({
        check: evaluation.label,
        preview_max_time: evaluation.normalized.previewMaxTime ?? '-',
        preview_min_time: evaluation.normalized.previewMinTime ?? '-',
        preview_rows: evaluation.preview.row_count,
        production_max_time: evaluation.normalized.productionMaxTime ?? '-',
        production_min_time: evaluation.normalized.productionMinTime ?? '-',
        production_rows: evaluation.production.row_count,
        status: evaluation.status,
        summary: evaluation.notes.join(' | ') || 'counts and freshness aligned',
      }))
    );

    const failures = evaluations.filter((evaluation) => evaluation.status === 'fail');
    const warnings = evaluations.filter((evaluation) => evaluation.status === 'warn');

    if (failures.length > 0) {
      console.error('\nPreview mirror verification failed.');
      for (const failure of failures) {
        console.error(`- ${failure.label}: ${failure.notes.join('; ')}`);
      }
      process.exitCode = 1;
      return;
    }

    if (warnings.length > 0) {
      console.log('\nPreview mirror verification passed with warnings.');
      for (const warning of warnings) {
        console.log(`- ${warning.label}: ${warning.notes.join('; ')}`);
      }
      return;
    }

    console.log('\nPreview mirror verification passed.');
  } finally {
    await closePools([previewPool, productionPool]);
  }
}

await main();
