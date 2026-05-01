import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogAppUpsert, SyncJobUpdate, SyncStatusUpsert, TigerWriter } from '@publisheriq/database';
import { runTigerAppListSync } from './applist-worker.js';
import type { SteamApp } from '../apis/steam-web.js';
import type { ReviewPromotion } from '../workers-support/reviews-sync.js';

test('runTigerAppListSync writes app-list rows and new-app sync state to Tiger', async () => {
  const upsertedApps: CatalogAppUpsert[] = [];
  const syncStatuses: SyncStatusUpsert[] = [];
  const promotedReviews: ReviewPromotion[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  let refreshedDashboardStats = false;

  const tiger = {
    ops: {
      abandonStaleSyncJobs: async () => 0,
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
      refreshDashboardStats: async () => {
        refreshedDashboardStats = true;
      },
    },
    catalog: {
      listExistingAppids: async () => [100],
      upsertApps: async (rows: CatalogAppUpsert[]) => {
        upsertedApps.push(...rows);
        return rows.length;
      },
    },
    syncStatus: {
      upsertRows: async (rows: SyncStatusUpsert[]) => {
        syncStatuses.push(...rows);
        return rows.length;
      },
    },
    reviews: {
      promoteReviewsSyncBatch: async (rows: ReviewPromotion[]) => {
        promotedReviews.push(...rows);
        return rows.length;
      },
    },
  } as unknown as TigerWriter;

  const apps: SteamApp[] = [
    { appid: 100, name: 'Existing App' },
    { appid: 101, name: 'New App' },
    { appid: 102, name: 'Smoke Limited App' },
  ];

  const result = await runTigerAppListSync({
    env: {
      DATA_WRITE_TARGET: 'tiger',
      APPLIST_BATCH_SIZE: '2',
      APPLIST_MAX_APPS: '2',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    fetchSteamAppList: async () => apps,
    getTiger: () => tiger,
  });

  assert.deepEqual(result, {
    errors: 0,
    newApps: 1,
    reviewPromotions: 1,
    totalApps: 2,
    updatedApps: 1,
  });
  assert.deepEqual(
    upsertedApps.map((app) => [app.appid, app.name, app.catalog_seed_state]),
    [
      [100, 'Existing App', 'hydrated'],
      [101, 'New App', 'hydrated'],
    ]
  );
  assert.deepEqual(syncStatuses, [{ appid: 101, priority_score: 0 }]);
  assert.equal(promotedReviews[0]?.appid, 101);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(refreshedDashboardStats, true);
});
