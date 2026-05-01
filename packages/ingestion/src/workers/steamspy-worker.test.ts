import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CatalogAppUpsert,
  DailyMetricUpsert,
  SyncStatusUpsert,
  TigerWriter,
} from '@publisheriq/database';
import type { SteamSpyAppSummary } from '../apis/steamspy.js';
import { processTigerSteamSpyBatch } from './steamspy-worker.js';

function steamSpyApp(overrides: Partial<SteamSpyAppSummary>): SteamSpyAppSummary {
  return {
    appid: 10,
    name: 'Example Game',
    developer: '',
    publisher: '',
    positive: 0,
    negative: 0,
    owners: '1,000 .. 2,000',
    average_forever: 12,
    average_2weeks: 1,
    median_forever: 0,
    median_2weeks: 0,
    price: '499',
    initialprice: '499',
    discount: '0',
    ccu: 25,
    ...overrides,
  };
}

test('processTigerSteamSpyBatch writes apps, metrics, and sync status to Tiger', async () => {
  const appGroups: CatalogAppUpsert[][] = [];
  const metricsRows: DailyMetricUpsert[] = [];
  const syncStatusRows: SyncStatusUpsert[] = [];
  const stats = { appsProcessed: 0, errors: 0 };

  const tiger = {
    catalog: {
      upsertApps: async (rows: CatalogAppUpsert[]) => {
        appGroups.push(rows);
        return rows.length;
      },
    },
    metrics: {
      upsertDailyMetrics: async (rows: DailyMetricUpsert[]) => {
        metricsRows.push(...rows);
        return rows.length;
      },
    },
    syncStatus: {
      upsertRows: async (rows: SyncStatusUpsert[]) => {
        syncStatusRows.push(...rows);
        return rows.length;
      },
    },
  } as unknown as TigerWriter;

  await processTigerSteamSpyBatch(
    tiger,
    [
      steamSpyApp({ appid: 10, name: 'Priced Game', price: '499', discount: '20' }),
      steamSpyApp({ appid: 20, name: 'Bad Price Game', price: '999999' }),
    ],
    stats
  );

  assert.equal(stats.appsProcessed, 2);
  assert.equal(stats.errors, 0);
  assert.deepEqual(appGroups.map((group) => group.map((app) => app.appid)), [[10], [20]]);
  assert.equal(appGroups[0]?.[0]?.current_price_cents, 499);
  assert.equal(appGroups[0]?.[0]?.current_discount_percent, 20);
  assert.equal(appGroups[1]?.[0]?.current_price_cents, undefined);
  assert.deepEqual(
    syncStatusRows.map((row) => [row.appid, row.steamspy_available]),
    [
      [10, true],
      [20, true],
    ]
  );
  assert.deepEqual(
    metricsRows.map((row) => [row.appid, row.owners_min, row.owners_max, row.ccu_source]),
    [
      [10, 1000, 2000, 'steamspy'],
      [20, 1000, 2000, 'steamspy'],
    ]
  );
  assert.equal(metricsRows[1]?.price_cents, null);
});
