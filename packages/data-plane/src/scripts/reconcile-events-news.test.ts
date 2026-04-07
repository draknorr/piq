import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectionReplayMonths,
  buildProjectionUpsertSql,
  parseProjectionRepairScope,
  type PartitionMismatch,
} from './reconcile-events-news.js';

function createMismatch(
  partitionKey: string,
  sourceCount = 10,
  tigerCount = 8
): PartitionMismatch {
  return {
    partitionKey,
    sourceCount,
    tigerCount,
  };
}

test('parseProjectionRepairScope defaults to exact_parity when unset', () => {
  assert.equal(parseProjectionRepairScope(undefined), 'exact_parity');
  assert.equal(parseProjectionRepairScope('recent_window'), 'recent_window');
  assert.equal(parseProjectionRepairScope('exact_parity'), 'exact_parity');
  assert.throws(
    () => parseProjectionRepairScope('invalid'),
    /Unsupported EVENTS_NEWS_SYNC_PROJECTION_REPAIR_SCOPE/
  );
});

test('buildProjectionReplayMonths limits recent-window replay to relevant recent months', () => {
  const replayMonths = buildProjectionReplayMonths(
    [
      createMismatch('2023-10-01'),
      createMismatch('2024-06-01'),
      createMismatch('2026-01-01'),
    ],
    [
      createMismatch('2026-03-29'),
      createMismatch('2026-04-06'),
    ],
    'recent_window',
    new Date('2026-04-07T12:00:00.000Z')
  );

  assert.deepEqual(replayMonths, [
    { partitionKey: '2026-03-01', reason: 'previous_month' },
    { partitionKey: '2026-04-01', reason: 'current_month' },
  ]);
});

test('buildProjectionReplayMonths preserves exact-parity historical month replay', () => {
  const replayMonths = buildProjectionReplayMonths(
    [
      createMismatch('2024-06-01'),
      createMismatch('2026-03-01'),
    ],
    [createMismatch('2026-04-06')],
    'exact_parity',
    new Date('2026-04-07T12:00:00.000Z')
  );

  assert.deepEqual(replayMonths, [
    { partitionKey: '2024-06-01', reason: 'mismatched_month' },
    { partitionKey: '2026-03-01', reason: 'mismatched_month' },
    { partitionKey: '2026-04-01', reason: 'current_month' },
  ]);
});

test('buildProjectionUpsertSql updates conflicting projection rows only when values changed', () => {
  const sql = buildProjectionUpsertSql(
    'docs.steam_news_search_projection',
    'docs.steam_news_search_projection_reconcile_stage'
  );

  assert.match(sql, /ON CONFLICT \(gid\)/);
  assert.match(sql, /DO UPDATE SET/);
  assert.match(
    sql,
    /WHERE docs\.steam_news_search_projection\.appid IS DISTINCT FROM EXCLUDED\.appid/
  );
  assert.match(
    sql,
    /docs\.steam_news_search_projection\.search_document IS DISTINCT FROM EXCLUDED\.search_document/
  );
});
