import assert from 'node:assert/strict';
import test from 'node:test';
import type { TigerWriter } from '@publisheriq/database';
import { processTigerStorefrontApp, type SyncStats } from './storefront-worker.js';

function buildStats(): SyncStats {
  return {
    appsProcessed: 0,
    appsCreated: 0,
    appsUpdated: 0,
    appsSkipped: 0,
    appsFailed: 0,
  };
}

test('processTigerStorefrontApp marks no-data storefront apps inaccessible in Tiger', async () => {
  const inaccessibleAppids: number[] = [];
  const stats = buildStats();
  const tiger = {
    catalog: {
      markStorefrontInaccessible: async (appid: number) => {
        inaccessibleAppids.push(appid);
        return 1;
      },
    },
  } as unknown as TigerWriter;

  await processTigerStorefrontApp({
    appid: 123,
    fetchDetails: async () => ({ status: 'no_data' }),
    neverSyncedSet: new Set([123]),
    stats,
    tiger,
  });

  assert.deepEqual(inaccessibleAppids, [123]);
  assert.deepEqual(stats, {
    appsProcessed: 1,
    appsCreated: 0,
    appsUpdated: 0,
    appsSkipped: 1,
    appsFailed: 0,
  });
});

test('processTigerStorefrontApp writes storefront fetch errors to Tiger sync status', async () => {
  const syncStatusUpdates: Array<Record<string, unknown>> = [];
  const stats = buildStats();
  const tiger = {
    syncStatus: {
      updateFields: async (_appid: number, values: Record<string, unknown>) => {
        syncStatusUpdates.push(values);
        return 1;
      },
    },
  } as unknown as TigerWriter;

  await processTigerStorefrontApp({
    appid: 456,
    fetchDetails: async () => ({ status: 'error', error: 'steam_500' }),
    neverSyncedSet: new Set([456]),
    stats,
    tiger,
  });

  assert.equal(syncStatusUpdates.length, 1);
  assert.equal(syncStatusUpdates[0]?.last_error_source, 'storefront');
  assert.equal(syncStatusUpdates[0]?.last_error_message, 'steam_500');
  assert.equal(typeof syncStatusUpdates[0]?.last_error_at, 'string');
  assert.equal(stats.appsProcessed, 1);
  assert.equal(stats.appsFailed, 1);
});
