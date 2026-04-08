import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateMirrorCheck,
  type MirrorCheckDefinition,
  resolveMirrorVerificationConfig,
} from './verify-preview-mirror.js';

const MUTABLE_CHECK: MirrorCheckDefinition = {
  label: 'docs.youtube_videos',
  mode: 'mutable_full_table',
  sql: 'SELECT 1',
  timeGranularity: 'second',
};

const WINDOW_CHECK: MirrorCheckDefinition = {
  label: 'metrics.youtube_video_snapshots_30d',
  mode: 'append_only_window',
  sql: 'SELECT 1',
  timeGranularity: 'second',
};

test('evaluateMirrorCheck passes when only sub-second precision differs', () => {
  const evaluation = evaluateMirrorCheck(
    WINDOW_CHECK,
    {
      max_time: '2026-04-08 03:33:24.368+00',
      min_time: '2026-04-06 22:44:21.747+00',
      row_count: 7657,
    },
    {
      max_time: '2026-04-08 03:33:24.368687+00',
      min_time: '2026-04-06 22:44:21.747908+00',
      row_count: 7657,
    }
  );

  assert.equal(evaluation.status, 'pass');
  assert.deepEqual(evaluation.notes, []);
});

test('evaluateMirrorCheck warns when mutable full tables lag production freshness', () => {
  const evaluation = evaluateMirrorCheck(
    MUTABLE_CHECK,
    {
      max_time: '2026-04-07 19:31:28.74+00',
      min_time: '2026-03-09 10:34:27+00',
      row_count: 6704,
    },
    {
      max_time: '2026-04-08 03:33:20.619501+00',
      min_time: '2026-03-09 10:34:27+00',
      row_count: 6704,
    }
  );

  assert.equal(evaluation.status, 'warn');
  assert.match(evaluation.notes[0] ?? '', /preview max_time trails production by/i);
});

test('evaluateMirrorCheck fails when append-only windows drift at second precision', () => {
  const evaluation = evaluateMirrorCheck(
    WINDOW_CHECK,
    {
      max_time: '2026-04-08 03:33:24+00',
      min_time: '2026-04-06 22:44:21+00',
      row_count: 7657,
    },
    {
      max_time: '2026-04-08 03:33:25+00',
      min_time: '2026-04-06 22:44:21+00',
      row_count: 7657,
    }
  );

  assert.equal(evaluation.status, 'fail');
  assert.match(evaluation.notes[0] ?? '', /max_time mismatch/i);
});

test('evaluateMirrorCheck fails when preview row counts do not match production', () => {
  const evaluation = evaluateMirrorCheck(
    MUTABLE_CHECK,
    {
      max_time: '2026-04-07 19:31:28+00',
      min_time: '2026-03-09 10:34:27+00',
      row_count: 6703,
    },
    {
      max_time: '2026-04-07 19:31:28+00',
      min_time: '2026-03-09 10:34:27+00',
      row_count: 6704,
    }
  );

  assert.equal(evaluation.status, 'fail');
  assert.match(evaluation.notes[0] ?? '', /row_count mismatch/i);
});

test('resolveMirrorVerificationConfig prefers preview and production tiger URLs from local env', () => {
  const config = resolveMirrorVerificationConfig({
    DATA_PLANE_STATEMENT_TIMEOUT_MS: '12000',
    TIGER_PREVIEW_URL: 'postgres://preview',
    TIGER_PRODUCTION_URL: 'postgres://production',
    TIGER_PRIMARY_URL: 'postgres://primary',
  });

  assert.equal(config.previewConnectionString, 'postgres://preview');
  assert.equal(config.productionConnectionString, 'postgres://production');
  assert.equal(config.statementTimeoutMs, 12000);
});
