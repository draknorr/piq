import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CatalogAppUpsert,
  CatalogScanBatchResult,
  SyncJobUpdate,
  SyncStatusUpsert,
  TigerWriter,
} from '@publisheriq/database';
import type { SteamApp } from '../apis/steam-web.js';
import type { ReviewPromotion } from '../workers-support/reviews-sync.js';
import { runAppListSync, runTigerAppListSync } from './applist-worker.js';

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

test('runTigerAppListSync uses the durable catalog ledger in shadow mode', async () => {
  const upsertedApps: CatalogAppUpsert[] = [];
  const syncStatuses: SyncStatusUpsert[] = [];
  const completedScans: Array<Record<string, unknown>> = [];
  const committedBatches: Array<Record<string, unknown>> = [];

  const tiger = {
    ops: {
      abandonStaleSyncJobs: async () => 0,
      createSyncJob: async () => 'job-shadow',
      updateSyncJob: async () => 1,
      refreshDashboardStats: async () => undefined,
    },
    catalog: {
      listExistingAppids: async () => [100],
      upsertApps: async (rows: CatalogAppUpsert[]) => {
        upsertedApps.push(...rows);
        return rows.length;
      },
    },
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_788_800,
        id: '11111111-1111-4111-8111-111111111111',
        lastCommittedBatch: -1,
        requestedIfModifiedSince: null,
        scanKind: 'full' as const,
        sourceStartedAt: '2024-07-24T00:00:00.000Z',
        status: 'running' as const,
      }),
      commitBatch: async (values: Record<string, unknown>) => {
        committedBatches.push(values);
        return {
          acceptedRows: 2,
          batchHash: String(values.batchHash),
          batchIndex: Number(values.batchIndex),
          changedKnownAppids: [],
          changedKnownRows: 0,
          enqueuedRows: 1,
          eventRows: 2,
          knownRows: 1,
          rejectedRows: 0,
          seededRows: 1,
          unchangedKnownRows: 1,
          unknownAppids: [101],
          unknownRows: 1,
        } satisfies CatalogScanBatchResult;
      },
      completeScan: async (values: Record<string, unknown>) => {
        completedScans.push(values);
      },
      failScan: async () => undefined,
    },
    syncStatus: {
      upsertRows: async (rows: SyncStatusUpsert[]) => {
        syncStatuses.push(...rows);
        return rows.length;
      },
    },
    reviews: {
      promoteReviewsSyncBatch: async (rows: ReviewPromotion[]) => rows.length,
    },
  } as unknown as TigerWriter;

  const result = await runTigerAppListSync({
    env: {
      APPLIST_BATCH_SIZE: '2',
      CATALOG_OBSERVATION_MODE: 'shadow',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-shadow',
    } as NodeJS.ProcessEnv,
    fetchSteamAppList: async () => [
      { appid: 100, name: 'Existing App' },
      { appid: 101, name: 'New App' },
    ],
    getTiger: () => tiger,
  });

  assert.deepEqual(result, {
    errors: 0,
    newApps: 1,
    reviewPromotions: 1,
    totalApps: 2,
    updatedApps: 1,
  });
  assert.equal(committedBatches.length, 1);
  assert.equal(completedScans.length, 1);
  assert.equal(completedScans[0]?.expectedSourceRows, 2);
  assert.deepEqual(syncStatuses, []);
  assert.deepEqual(
    upsertedApps.map((app) => [app.appid, app.catalog_seed_state]),
    [
      [100, undefined],
      [101, undefined],
    ]
  );
});

test('runAppListSync rejects catalog observation on the Supabase legacy path', async () => {
  await assert.rejects(
    runAppListSync({
      env: {
        CATALOG_OBSERVATION_MODE: 'shadow',
        DATA_WRITE_TARGET: 'supabase',
        GITHUB_RUN_ID: 'run-invalid-target',
      } as NodeJS.ProcessEnv,
    }),
    /requires Tiger/
  );
});
