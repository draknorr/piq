import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNewsCaptureMode, shouldCaptureIncrementalNews } from '../workers-support/change-intel.js';

test('resolveNewsCaptureMode only uses catchup mode for stale catchup jobs', () => {
  assert.equal(resolveNewsCaptureMode('stale_news_catchup'), 'catchup');
  assert.equal(resolveNewsCaptureMode('storefront_snapshot_change'), 'incremental');
});

test('shouldCaptureIncrementalNews respects the freshness window', () => {
  const observedAt = '2026-03-17T12:00:00.000Z';
  const staleWindowMs = 24 * 60 * 60 * 1000;

  assert.equal(shouldCaptureIncrementalNews(null, observedAt, staleWindowMs), true);
  assert.equal(shouldCaptureIncrementalNews('2026-03-17T11:30:00.000Z', observedAt, staleWindowMs), false);
  assert.equal(shouldCaptureIncrementalNews('2026-03-16T10:00:00.000Z', observedAt, staleWindowMs), true);
});
