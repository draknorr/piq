import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncJobUpdate, TigerWriter } from '@publisheriq/database';
import { runTigerPriceSync } from './price-sync-worker.js';

test('runTigerPriceSync reads due apps and writes price batches to Tiger', async () => {
  const priceUpdates: Array<{
    appids: number[];
    prices: number[];
    discounts: number[];
  }> = [];
  const jobUpdates: SyncJobUpdate[] = [];

  const tiger = {
    ops: {
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    metrics: {
      listPriceSyncAppids: async () => [10, 20],
      batchUpdatePrices: async (values: {
        appids: number[];
        prices: number[];
        discounts: number[];
      }) => {
        priceUpdates.push(values);
        return values.appids.length;
      },
    },
  } as unknown as TigerWriter;

  const result = await runTigerPriceSync({
    env: {
      DATA_WRITE_TARGET: 'tiger',
      BATCH_SIZE: '2',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    getTiger: () => tiger,
    fetchStorefrontPrices: async (appids) =>
      new Map(appids.map((appid) => [appid, {
        priceCents: appid === 10 ? 499 : null,
        discountPercent: appid === 10 ? 10 : 0,
      }])),
  });

  assert.deepEqual(result, {
    appsProcessed: 2,
    appsUpdated: 2,
    appsFailed: 0,
    batchesMade: 1,
  });
  assert.deepEqual(priceUpdates, [
    {
      appids: [10, 20],
      prices: [499, 0],
      discounts: [10, 0],
    },
  ]);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(jobUpdates.at(-1)?.items_processed, 2);
});
