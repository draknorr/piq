import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { runChangeIntelWorker } from './change-intel-worker.js';

test('real storefront startup survives a failed budget read and respects persisted request cap', async (t) => {
  const keys = {
    CHANGE_INTEL_WRITE_TARGET: 'tiger', CHANGE_INTEL_TIGER_URL: 'postgres://test:test@localhost/test',
    QUEUE_SOURCES: 'storefront_tags', STOREFRONT_TAGS_ENABLED: 'true',
    STOREFRONT_TAG_DAILY_REQUEST_CAP: '500', MAX_IDLE_POLLS: '1',
    POLL_INTERVAL_MS: '1', CLAIM_STALE_AFTER_MS: '0',
  };
  const before = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
  Object.assign(process.env, keys);
  let budgetReads = 0; let claims = 0;
  const signalsBefore = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  // No network: run the actual worker and repository through a mock pg boundary.
  t.mock.method(Pool.prototype, 'query', async (sql: string) => {
    if (sql.includes('sum(greatest')) {
      budgetReads += 1;
      if (budgetReads === 1) throw Object.assign(new Error('database not ready'), { code: 'ECONNREFUSED' });
      return { rows: [{ count: 500 }], rowCount: 1 };
    }
    if (sql.includes('claim_app_capture_work')) claims += 1;
    return { rows: [], rowCount: 0 };
  });
  try {
    await runChangeIntelWorker();
    assert.equal(budgetReads, 2);
    assert.equal(claims, 0, 'must not claim or fetch tags against an exhausted persisted budget');
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], signalsBefore);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('outage later in a cycle reloads the tag budget before further claims', async (t) => {
  const keys = {
    CHANGE_INTEL_WRITE_TARGET: 'tiger', CHANGE_INTEL_TIGER_URL: 'postgres://test:test@localhost/test',
    QUEUE_SOURCES: 'storefront_tags,projection_refresh', STOREFRONT_TAGS_ENABLED: 'true',
    STOREFRONT_TAG_DAILY_REQUEST_CAP: '500', MAX_IDLE_POLLS: '1',
    POLL_INTERVAL_MS: '1', CLAIM_STALE_AFTER_MS: '0',
  };
  const before = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
  Object.assign(process.env, keys);
  let budgetReads = 0; let tagClaims = 0; let projectionClaims = 0;
  t.mock.method(Pool.prototype, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.includes('sum(greatest')) {
      budgetReads += 1;
      return { rows: [{ count: budgetReads === 1 ? 499 : 500 }], rowCount: 1 };
    }
    if (sql.includes('claim_app_capture_work')) {
      if ((params?.[0] as string[])?.includes('storefront_tags')) tagClaims += 1;
      else {
        projectionClaims += 1;
        if (projectionClaims === 1) throw Object.assign(new Error('restart'), { code: '57P01' });
      }
    }
    return { rows: [], rowCount: 0 };
  });
  try {
    await runChangeIntelWorker();
    assert.equal(budgetReads, 2);
    assert.equal(tagClaims, 1, 'must not reuse pre-outage budget');
    assert.equal(projectionClaims, 2);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('failed UTC rollover read cannot advance the cached budget date', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T23:59:00Z') });
  const keys = {
    CHANGE_INTEL_WRITE_TARGET: 'tiger', CHANGE_INTEL_TIGER_URL: 'postgres://test:test@localhost/test',
    QUEUE_SOURCES: 'storefront_tags', STOREFRONT_TAGS_ENABLED: 'true',
    STOREFRONT_TAG_DAILY_REQUEST_CAP: '500', MAX_IDLE_POLLS: '2',
    POLL_INTERVAL_MS: '1', CLAIM_STALE_AFTER_MS: '0',
  };
  const before = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
  Object.assign(process.env, keys);
  const budgetDays: unknown[] = []; let claims = 0;
  t.mock.method(Pool.prototype, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.includes('sum(greatest')) {
      budgetDays.push(params?.[0]);
      if (budgetDays.length === 2) throw Object.assign(new Error('restart'), { code: '57P01' });
      return { rows: [{ count: 500 }], rowCount: 1 };
    }
    if (sql.includes('WITH sweep')) {
      t.mock.timers.setTime(new Date('2026-09-18T00:01:00Z').getTime());
    }
    if (sql.includes('claim_app_capture_work')) claims += 1;
    return { rows: [], rowCount: 0 };
  });
  try {
    await runChangeIntelWorker();
    assert.deepEqual(budgetDays, [
      '2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z',
    ]);
    assert.equal(claims, 0);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
