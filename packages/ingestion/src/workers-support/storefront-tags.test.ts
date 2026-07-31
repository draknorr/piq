import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaptureQueueJob } from '../change-intel/types.js';
import type { StorefrontTagFetchResult } from '../apis/storefront-tags.js';
import {
  isScheduledStorefrontSweepWindow,
  processStorefrontTagBatch,
  storefrontTagMinimumPriority,
} from './storefront-tags.js';

function job(id: string, appid: number, priority: number): CaptureQueueJob {
  return {
    appid,
    attempts: 1,
    id,
    payload: {},
    priority,
    source: 'storefront_tags',
    triggerCursor: '',
    triggerReason: 'test',
  };
}

function success(appid: number): StorefrontTagFetchResult {
  return {
    appid,
    evidence: {
      country: 'us',
      locale: 'english',
      observedAt: '2026-07-31T12:00:00.000Z',
      pageUrl: `https://store.steampowered.com/app/${appid}/?l=english&cc=us`,
      parserVersion: 'steam-store-page-tags/v1',
      responseHash: 'a'.repeat(64),
      tags: [{ count: 5, name: 'Strategy', rank: 1, tagid: 9 }],
    },
    status: 'success',
    statusCode: 200,
    telemetry: {
      attempts: 1,
      forbidden: 0,
      networkErrors: 0,
      parserFailures: 0,
      rateLimited: 0,
      retries: 0,
      serverErrors: 0,
      timeouts: 0,
    },
  };
}

test('sweep guard admits only urgent tag work during expected GitHub overlap', () => {
  const overlap = new Date('2026-07-31T14:20:00Z');
  const quiet = new Date('2026-07-31T15:20:00Z');
  assert.equal(isScheduledStorefrontSweepWindow(overlap), true);
  assert.equal(storefrontTagMinimumPriority(overlap), 900);
  assert.equal(isScheduledStorefrontSweepWindow(quiet), false);
  assert.equal(storefrontTagMinimumPriority(quiet), undefined);
  assert.equal(storefrontTagMinimumPriority(quiet, process.env, true), 900);
});

test('tag batches flush urgent evidence immediately and normal evidence together', async () => {
  const completed: string[][] = [];
  const writeBatches: number[][] = [];
  const batch = await processStorefrontTagBatch(
    [job('1', 10, 1000), job('2', 20, 700), job('3', 30, 700)],
    {
      complete: async (ids) => {
        completed.push(ids);
      },
      defer: async () => {},
      fetchTags: async (appid) => success(appid),
      upsertEvidence: async (rows) => {
        writeBatches.push(rows.map((row) => row.appid));
        return rows.length;
      },
    }
  );

  assert.deepEqual(writeBatches, [[10], [20, 30]]);
  assert.deepEqual(completed, [['1'], ['2', '3']]);
  assert.deepEqual(batch, {
    attempts: 3,
    changed: 3,
    claimed: 3,
    failed: 0,
    succeeded: 3,
  });
});

test('parser drift dead-letters the failed app and defers the untouched batch', async () => {
  const deadLetters: string[][] = [];
  const deferred: string[][] = [];
  const failure: StorefrontTagFetchResult = {
    appid: 10,
    circuitOpenUntil: '2026-07-31T12:15:00.000Z',
    errorCode: 'parse_error',
    errorMessage: 'modal missing',
    retryable: false,
    status: 'failed',
    statusCode: 200,
    telemetry: {
      attempts: 1,
      forbidden: 0,
      networkErrors: 0,
      parserFailures: 1,
      rateLimited: 0,
      retries: 0,
      serverErrors: 0,
      timeouts: 0,
    },
  };

  await processStorefrontTagBatch([job('1', 10, 1000), job('2', 20, 1000)], {
    complete: async (ids, status) => {
      if (status === 'dead_letter') deadLetters.push(ids);
    },
    defer: async (ids) => {
      deferred.push(ids);
    },
    fetchTags: async () => failure,
    upsertEvidence: async () => 0,
  });

  assert.deepEqual(deadLetters, [['1']]);
  assert.deepEqual(deferred, [['2']]);
});
