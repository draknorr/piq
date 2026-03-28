import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@publisheriq/shared';
import {
  classifyNewsCaptureError,
  isTerminalNewsCaptureError,
  resolveNewsCaptureMode,
  shouldCaptureIncrementalNews,
} from '../workers-support/change-intel.js';

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

test('isTerminalNewsCaptureError recognizes durable HTTP failures', () => {
  const terminal = new ApiError('News not available', 404, 'https://example.com/news');
  const transient = new ApiError('Steam unavailable', 500, 'https://example.com/news');

  assert.equal(isTerminalNewsCaptureError(terminal), true);
  assert.equal(isTerminalNewsCaptureError(transient), false);
  assert.equal(isTerminalNewsCaptureError(new Error('timeout')), false);
});

test('classifyNewsCaptureError keeps News HTTP status visible', () => {
  const error = new ApiError('Failed to fetch news for app 730', 502, 'https://example.com/news');

  assert.equal(classifyNewsCaptureError(error), 'steam_news_http_502: Failed to fetch news for app 730');
  assert.equal(classifyNewsCaptureError(new Error('network timeout')), 'network timeout');
});
