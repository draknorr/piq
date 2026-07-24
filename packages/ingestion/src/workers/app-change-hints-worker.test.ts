import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CatalogObservationRow,
  CatalogScanBatchResult,
  TigerWriter,
} from '@publisheriq/database';
import type { TigerChangeIntelRepository } from '../change-intel/tiger-repository.js';
import { runAppChangeHints } from './app-change-hints-worker.js';

function buildHintStatusRows(): Array<{
  appid: number;
  is_released: boolean;
  priority_score: number;
  release_date: string | null;
  steam_last_modified: number;
  steam_price_change_number: number;
  type: string;
}> {
  return [
    {
      appid: 10,
      is_released: true,
      priority_score: 10,
      release_date: null,
      steam_last_modified: 100,
      steam_price_change_number: 1,
      type: 'game',
    },
    {
      appid: 20,
      is_released: true,
      priority_score: 10,
      release_date: null,
      steam_last_modified: 150,
      steam_price_change_number: 2,
      type: 'game',
    },
  ];
}

test('runAppChangeHints shadow mode durably disposes unknown IDs and changed hints', async () => {
  const committedRows: CatalogObservationRow[][] = [];
  const completedScans: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let requestedCursor: number | null | undefined;

  const tiger = {
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_789_100,
        id: '11111111-1111-4111-8111-111111111111',
        lastCommittedBatch: -1,
        requestedIfModifiedSince: 1_721_788_800,
        scanKind: 'incremental' as const,
        sourceStartedAt: '2024-07-24T00:05:00.000Z',
        status: 'running' as const,
      }),
      commitBatch: async (values: { rows: CatalogObservationRow[] }) => {
        committedRows.push(values.rows);
        return {
          acceptedRows: 3,
          batchHash: 'batch-hash',
          batchIndex: 0,
          changedKnownAppids: [20],
          changedKnownRows: 1,
          enqueuedRows: 2,
          eventRows: 1,
          knownRows: 2,
          rejectedRows: 0,
          seededRows: 1,
          unchangedKnownRows: 1,
          unknownAppids: [30],
          unknownRows: 1,
        } satisfies CatalogScanBatchResult;
      },
      completeScan: async (values: Record<string, unknown>) => {
        completedScans.push(values);
      },
      failScan: async () => undefined,
    },
  } as unknown as TigerWriter;

  const tigerChangeIntel = {
    createSyncJobRecord: async () => 'job-1',
    listHintStatusRows: async () => buildHintStatusRows(),
    promoteReviewsSyncBatch: async () => 0,
    updateSyncJobRecord: async (_id: string, values: Record<string, unknown>) => {
      jobUpdates.push(values);
    },
  } as unknown as TigerChangeIntelRepository;

  const result = await runAppChangeHints({
    env: {
      CATALOG_OBSERVATION_MODE: 'shadow',
      DATA_READ_TARGET: 'tiger',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-shadow',
      HINT_BATCH_SIZE: '10',
    } as NodeJS.ProcessEnv,
    fetchHints: async (options) => {
      requestedCursor = options?.ifModifiedSince;
      return [
        {
          appid: 10,
          lastModified: 100,
          name: 'Unchanged',
          priceChangeNumber: 1,
        },
        { appid: 20, lastModified: 200, name: 'Changed', priceChangeNumber: 2 },
        { appid: 30, lastModified: 300, name: 'Unknown', priceChangeNumber: 3 },
      ];
    },
    getTiger: () => tiger,
    getTigerChangeIntel: () => tigerChangeIntel,
    now: () => new Date('2024-07-24T00:05:00.000Z'),
  });

  assert.equal(requestedCursor, 1_721_788_800);
  assert.deepEqual(result, {
    changed: 1,
    enqueued: 2,
    promoted: 0,
    skipped: 1,
    totalHints: 3,
  });
  assert.deepEqual(
    committedRows[0]?.map((row) => row.appid),
    [10, 20, 30]
  );
  assert.equal(completedScans[0]?.expectedSourceRows, 3);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
});

test('runAppChangeHints off mode does not rewrite unchanged hint timestamps', async () => {
  const upsertedAppids: number[] = [];

  const tigerChangeIntel = {
    createSyncJobRecord: async () => 'job-2',
    enqueueCaptureJobs: async () => 1,
    listHintStatusRows: async () => buildHintStatusRows(),
    promoteReviewsSyncBatch: async () => 0,
    updateSyncJobRecord: async () => undefined,
    upsertHintStatusRows: async (rows: Array<{ appid: number }>) => {
      upsertedAppids.push(...rows.map((row) => row.appid));
    },
  } as unknown as TigerChangeIntelRepository;

  const result = await runAppChangeHints({
    env: {
      CATALOG_OBSERVATION_MODE: 'off',
      DATA_READ_TARGET: 'tiger',
      DATA_WRITE_TARGET: 'tiger',
      HINT_BATCH_SIZE: '10',
    } as NodeJS.ProcessEnv,
    fetchHints: async () => [
      { appid: 10, lastModified: 100, name: 'Unchanged', priceChangeNumber: 1 },
      { appid: 20, lastModified: 200, name: 'Changed', priceChangeNumber: 2 },
    ],
    getTigerChangeIntel: () => tigerChangeIntel,
  });

  assert.deepEqual(upsertedAppids, [20]);
  assert.equal(result.changed, 1);
});

test('runAppChangeHints fails and records the scan when shadow parity diverges', async () => {
  const failedScans: Array<{ errorMessage: string; scanId: string }> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];

  const tiger = {
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_789_100,
        id: '22222222-2222-4222-8222-222222222222',
        lastCommittedBatch: -1,
        requestedIfModifiedSince: null,
        scanKind: 'full' as const,
        sourceStartedAt: '2024-07-24T00:05:00.000Z',
        status: 'running' as const,
      }),
      commitBatch: async () =>
        ({
          acceptedRows: 1,
          batchHash: 'batch-hash',
          batchIndex: 0,
          changedKnownAppids: [],
          changedKnownRows: 0,
          enqueuedRows: 0,
          eventRows: 0,
          knownRows: 1,
          rejectedRows: 0,
          seededRows: 0,
          unchangedKnownRows: 1,
          unknownAppids: [],
          unknownRows: 0,
        }) satisfies CatalogScanBatchResult,
      completeScan: async () => undefined,
      failScan: async (scanId: string, errorMessage: string) => {
        failedScans.push({ errorMessage, scanId });
      },
    },
  } as unknown as TigerWriter;

  const tigerChangeIntel = {
    createSyncJobRecord: async () => 'job-3',
    listHintStatusRows: async () => [],
    promoteReviewsSyncBatch: async () => 0,
    updateSyncJobRecord: async (_id: string, values: Record<string, unknown>) => {
      jobUpdates.push(values);
    },
  } as unknown as TigerChangeIntelRepository;

  await assert.rejects(
    runAppChangeHints({
      env: {
        CATALOG_OBSERVATION_MODE: 'shadow',
        DATA_READ_TARGET: 'tiger',
        DATA_WRITE_TARGET: 'tiger',
        GITHUB_RUN_ID: 'run-parity-failure',
      } as NodeJS.ProcessEnv,
      fetchHints: async () => [
        {
          appid: 30,
          lastModified: 300,
          name: 'Unknown',
          priceChangeNumber: 3,
        },
      ],
      getTiger: () => tiger,
      getTigerChangeIntel: () => tigerChangeIntel,
      now: () => new Date('2024-07-24T00:05:00.000Z'),
    }),
    /unknown-ID parity failed/
  );

  assert.equal(failedScans.length, 1);
  assert.match(failedScans[0]?.errorMessage ?? '', /unknown-ID parity failed/);
  assert.equal(jobUpdates.at(-1)?.status, 'failed');
});
