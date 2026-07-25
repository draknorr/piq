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

test('runTigerAppListSync resumes finalization without replaying committed batches', async () => {
  const resumedScans: Array<Record<string, unknown>> = [];
  const jobUpdates: SyncJobUpdate[] = [];

  const tiger = {
    ops: {
      abandonStaleSyncJobs: async () => 0,
      createSyncJob: async () => 'job-resume',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    catalog: {
      listExistingAppids: async () => [100],
      upsertApps: async () => {
        throw new Error('committed catalog rows must not replay');
      },
    },
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_788_800,
        id: '33333333-3333-4333-8333-333333333333',
        lastCommittedBatch: 0,
        requestedIfModifiedSince: null,
        scanKind: 'full' as const,
        sourceStartedAt: '2024-07-24T00:00:00.000Z',
        status: 'finalizing' as const,
      }),
      commitBatch: async () => {
        throw new Error('committed catalog batches must not replay');
      },
      completeScan: async () => {
        throw new Error('finalization preparation must not replay');
      },
      resumeScanFinalization: async (values: Record<string, unknown>) => {
        resumedScans.push(values);
        return {
          done: true,
          phase: 'completed' as const,
          processedRows: 0,
          readinessRows: 0,
          stateRows: 1,
          status: 'completed' as const,
        };
      },
      failScan: async () => undefined,
    },
  } as unknown as TigerWriter;

  const result = await runTigerAppListSync({
    env: {
      APPLIST_BATCH_SIZE: '2',
      CATALOG_FINALIZATION_BATCH_SIZE: '250',
      CATALOG_OBSERVATION_MODE: 'shadow',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-resume',
    } as NodeJS.ProcessEnv,
    fetchSteamAppList: async () => [{ appid: 100, name: 'Existing App' }],
    getTiger: () => tiger,
  });

  assert.deepEqual(result, {
    errors: 0,
    newApps: 0,
    reviewPromotions: 0,
    totalApps: 1,
    updatedApps: 1,
  });
  assert.deepEqual(resumedScans, [
    {
      batchSize: 250,
      scanId: '33333333-3333-4333-8333-333333333333',
    },
  ]);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
});

test('runTigerAppListSync leaves failed finalization resumable', async () => {
  const failedScans: Array<{ errorMessage: string; scanId: string }> = [];
  const jobUpdates: SyncJobUpdate[] = [];

  const tiger = {
    ops: {
      abandonStaleSyncJobs: async () => 0,
      createSyncJob: async () => 'job-resume-failure',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    catalog: {
      listExistingAppids: async () => [100],
    },
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_788_800,
        id: '44444444-4444-4444-8444-444444444444',
        lastCommittedBatch: 0,
        requestedIfModifiedSince: null,
        scanKind: 'full' as const,
        sourceStartedAt: '2024-07-24T00:00:00.000Z',
        status: 'finalizing' as const,
      }),
      resumeScanFinalization: async () => {
        throw new Error('injected finalization chunk failure');
      },
      failScan: async (scanId: string, errorMessage: string) => {
        failedScans.push({ errorMessage, scanId });
      },
    },
  } as unknown as TigerWriter;

  await assert.rejects(
    runTigerAppListSync({
      env: {
        CATALOG_OBSERVATION_MODE: 'shadow',
        DATA_WRITE_TARGET: 'tiger',
        GITHUB_RUN_ID: 'run-resume-failure',
      } as NodeJS.ProcessEnv,
      fetchSteamAppList: async () => [{ appid: 100, name: 'Existing App' }],
      getTiger: () => tiger,
    }),
    /injected finalization chunk failure/
  );

  assert.deepEqual(failedScans, [
    {
      errorMessage: 'injected finalization chunk failure',
      scanId: '44444444-4444-4444-8444-444444444444',
    },
  ]);
  assert.equal(jobUpdates.at(-1)?.status, 'failed');
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
