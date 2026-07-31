import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CatalogObservationRow,
  CatalogScanBatchResult,
  TigerWriter,
} from '@publisheriq/database';
import type { TigerChangeIntelRepository } from '../change-intel/tiger-repository.js';
import { buildStorefrontTagHintJobs, runAppChangeHints } from './app-change-hints-worker.js';

function buildHintStatusRows(): Array<{
  appid: number;
  catalog_first_observation_kind: string | null;
  catalog_first_observed_at: string | null;
  has_known_tags: boolean;
  is_released: boolean;
  parent_appid: number | null;
  priority_score: number;
  release_date: string | null;
  steam_last_modified: number;
  steam_price_change_number: number;
  type: string;
}> {
  return [
    {
      appid: 10,
      catalog_first_observation_kind: 'baseline',
      catalog_first_observed_at: '2026-01-01T00:00:00.000Z',
      has_known_tags: true,
      is_released: true,
      parent_appid: null,
      priority_score: 10,
      release_date: null,
      steam_last_modified: 100,
      steam_price_change_number: 1,
      type: 'game',
    },
    {
      appid: 20,
      catalog_first_observation_kind: 'baseline',
      catalog_first_observed_at: '2026-01-01T00:00:00.000Z',
      has_known_tags: true,
      is_released: true,
      parent_appid: null,
      priority_score: 10,
      release_date: null,
      steam_last_modified: 150,
      steam_price_change_number: 2,
      type: 'game',
    },
  ];
}

test('buildStorefrontTagHintJobs prioritizes new games and deduplicates demos onto parents', () => {
  const jobs = buildStorefrontTagHintJobs(
    [
      { appid: 10, lastModified: 100, priceChangeNumber: 1 },
      { appid: 11, lastModified: 101, priceChangeNumber: 1 },
      { appid: 12, lastModified: 102, priceChangeNumber: 1 },
    ],
    new Map([
      [
        10,
        {
          catalogFirstObservationKind: 'new',
          catalogFirstObservedAt: '2026-07-31T10:00:00.000Z',
          hasKnownTags: false,
          isReleased: false,
          parentAppid: null,
          priorityScore: 0,
          releaseDate: null,
          type: 'game',
        },
      ],
      [
        11,
        {
          catalogFirstObservationKind: 'new',
          catalogFirstObservedAt: '2026-07-31T10:00:00.000Z',
          hasKnownTags: false,
          isReleased: false,
          parentAppid: 10,
          priorityScore: 0,
          releaseDate: null,
          type: 'demo',
        },
      ],
      [
        12,
        {
          catalogFirstObservationKind: 'baseline',
          catalogFirstObservedAt: '2025-01-01T00:00:00.000Z',
          hasKnownTags: false,
          isReleased: false,
          parentAppid: null,
          priorityScore: 0,
          releaseDate: null,
          type: 'game',
        },
      ],
    ]),
    Date.parse('2026-07-31T12:00:00.000Z')
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.appid, 10);
  assert.equal(jobs[0]?.priority, 900);
  assert.equal(jobs[0]?.source, 'storefront_tags');
});

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

test('runAppChangeHints resumes finalization before fetching a new source page', async () => {
  const resumedScans: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let fetchCount = 0;

  const tiger = {
    catalogObservation: {
      beginScan: async () => ({
        committedThrough: 1_721_789_100,
        id: '55555555-5555-4555-8555-555555555555',
        lastCommittedBatch: 0,
        requestedIfModifiedSince: 1_721_788_800,
        scanKind: 'incremental' as const,
        sourceStartedAt: '2024-07-24T00:05:00.000Z',
        status: 'finalizing' as const,
      }),
      resumeScanFinalization: async (values: Record<string, unknown>) => {
        resumedScans.push(values);
        return {
          done: true,
          phase: 'completed' as const,
          processedRows: 0,
          readinessRows: 0,
          stateRows: 2,
          status: 'completed' as const,
        };
      },
    },
  } as unknown as TigerWriter;

  const tigerChangeIntel = {
    createSyncJobRecord: async () => 'job-resume',
    updateSyncJobRecord: async (_id: string, values: Record<string, unknown>) => {
      jobUpdates.push(values);
    },
  } as unknown as TigerChangeIntelRepository;

  const result = await runAppChangeHints({
    env: {
      CATALOG_FINALIZATION_BATCH_SIZE: '300',
      CATALOG_OBSERVATION_MODE: 'shadow',
      DATA_READ_TARGET: 'tiger',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-resume',
    } as NodeJS.ProcessEnv,
    fetchHints: async () => {
      fetchCount += 1;
      return [];
    },
    getTiger: () => tiger,
    getTigerChangeIntel: () => tigerChangeIntel,
  });

  assert.deepEqual(result, {
    changed: 0,
    enqueued: 0,
    promoted: 0,
    skipped: 0,
    totalHints: 0,
  });
  assert.equal(fetchCount, 0);
  assert.deepEqual(resumedScans, [
    {
      batchSize: 300,
      scanId: '55555555-5555-4555-8555-555555555555',
    },
  ]);
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
