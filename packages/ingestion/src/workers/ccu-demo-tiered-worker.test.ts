import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CcuSnapshotInsert,
  DailyCcuPeakUpsert,
  SyncJobUpdate,
  TigerWriter,
} from '@publisheriq/database';
import type { CCUBatchResultWithStatus, CCUResultWithStatus } from '../apis/steam-ccu.js';
import { runTigerCcuDemoTieredSync } from './ccu-demo-tiered-worker.js';

function fetchResultFor(appids: number[]): CCUBatchResultWithStatus {
  const knownResults = new Map<number, CCUResultWithStatus>([
    [10, { status: 'valid', validationState: 'confirmed_positive', playerCount: 42 }],
    [20, { status: 'valid', validationState: 'confirmed_zero', playerCount: 0 }],
    [30, { status: 'invalid', validationState: 'invalid' }],
  ]);
  const results = new Map<number, CCUResultWithStatus>();
  let validCount = 0;
  let invalidCount = 0;
  let errorCount = 0;

  for (const appid of appids) {
    const result =
      knownResults.get(appid) ??
      ({ status: 'valid', validationState: 'confirmed_positive', playerCount: appid } as const);
    results.set(appid, result);

    if (result.status === 'valid') {
      validCount++;
    } else if (result.status === 'invalid') {
      invalidCount++;
    } else {
      errorCount++;
    }
  }

  return { errorCount, invalidCount, results, validCount };
}

test('runTigerCcuDemoTieredSync writes official demo CCU without touching game tier queues', async () => {
  const dailyRows: DailyCcuPeakUpsert[] = [];
  const snapshots: CcuSnapshotInsert[] = [];
  const demoValidationUpdates: Array<{
    appids: number[];
    values: Record<string, string | null>;
  }> = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const fetchedChunks: number[][] = [];
  let refreshTrigger: string | null = null;
  let tier2Listed = false;

  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 0,
      countFreshRunningSyncJobsByTypes: async () => [],
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    metrics: {
      insertCcuSnapshots: async (rows: CcuSnapshotInsert[]) => {
        snapshots.push(...rows);
        return rows.length;
      },
      listDemoCcuTierAppids: async ({ tier }: { tier: number }) => {
        if (tier === 1) {
          return { appids: [10, 20], skippedCount: 1 };
        }
        tier2Listed = true;
        return { appids: [30], skippedCount: 2 };
      },
      listSuspiciousZeroAppids: async () => new Set([20]),
      recalculateDemoCcuTiers: async () => ({ tier1Count: 2, tier2Count: 1 }),
      updateCcuTierAssignments: async () => {
        throw new Error('game tier validation should not be used for demo sync');
      },
      updateDemoCcuTierAssignments: async (
        appids: number[],
        values: Record<string, string | null>
      ) => {
        demoValidationUpdates.push({ appids, values });
        return appids.length;
      },
      upsertDailyCcuPeaks: async (rows: DailyCcuPeakUpsert[]) => {
        dailyRows.push(...rows);
        return rows.length;
      },
    },
  } as unknown as TigerWriter;

  const stats = await runTigerCcuDemoTieredSync({
    env: {
      CCU_DEMO_HOT_LIMIT: '2',
      CCU_DEMO_NEW_DEMO_WINDOW_DAYS: '14',
      CCU_DEMO_TAIL_LIMIT: '1',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async (appids) => {
      fetchedChunks.push(appids);
      return fetchResultFor(appids);
    },
    getTiger: () => tiger,
    refreshCcuQualityCache: async (trigger) => {
      refreshTrigger = trigger;
    },
  });

  assert.deepEqual(stats, {
    skippedForMainCcu: false,
    stoppedForMainCcu: false,
    tier1Processed: 2,
    tier1Skipped: 1,
    tier1Succeeded: 2,
    tier2Processed: 1,
    tier2Skipped: 2,
    tier2Succeeded: 0,
    tierRecalculated: true,
    totalFailed: 1,
    totalInvalid: 1,
  });
  assert.equal(tier2Listed, true);
  assert.deepEqual(fetchedChunks, [[10, 20], [30]]);
  assert.deepEqual(
    dailyRows.map((row) => [row.appid, row.ccu_peak, row.ccu_source]),
    [
      [10, 42, 'steam_api'],
      [20, 0, 'steam_api'],
    ]
  );
  assert.deepEqual(
    snapshots.map((row) => [row.appid, row.player_count, row.ccu_tier]),
    [
      [10, 42, 1],
      [20, 0, 1],
    ]
  );
  assert.deepEqual(
    demoValidationUpdates
      .filter((update) => update.appids.length > 0)
      .map((update) => [update.appids, update.values.last_ccu_validation_state]),
    [
      [[10], 'confirmed_positive'],
      [[20], 'confirmed_zero'],
      [[30], 'invalid'],
    ]
  );
  assert.equal(refreshTrigger, 'ccu-demo-tiered');
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(jobUpdates.at(-1)?.items_processed, 3);
});

test('runTigerCcuDemoTieredSync skips before ranking when a main CCU job is active', async () => {
  const jobUpdates: SyncJobUpdate[] = [];
  let recalculateCalled = false;
  let fetchCalls = 0;

  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 0,
      countFreshRunningSyncJobsByTypes: async () => [{ jobType: 'ccu-daily-p0', count: 1 }],
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    metrics: {
      recalculateDemoCcuTiers: async () => {
        recalculateCalled = true;
        return { tier1Count: 0, tier2Count: 0 };
      },
    },
  } as unknown as TigerWriter;

  const stats = await runTigerCcuDemoTieredSync({
    env: {
      CCU_DEMO_HOT_LIMIT: '2',
      CCU_DEMO_TAIL_LIMIT: '1',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async () => {
      fetchCalls++;
      return fetchResultFor([]);
    },
    getTiger: () => tiger,
    refreshCcuQualityCache: async () => {},
  });

  assert.equal(stats.skippedForMainCcu, true);
  assert.equal(stats.tierRecalculated, false);
  assert.equal(recalculateCalled, false);
  assert.equal(fetchCalls, 0);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(jobUpdates.at(-1)?.items_skipped, 3);
});

test('runTigerCcuDemoTieredSync abandons stale main CCU rows before active checks', async () => {
  const guardOrder: string[] = [];
  let recalculateCalled = false;

  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => {
        guardOrder.push('abandon');
        return 2;
      },
      countFreshRunningSyncJobsByTypes: async () => {
        guardOrder.push('count');
        return [];
      },
      createSyncJob: async () => 'job-1',
      updateSyncJob: async () => 1,
    },
    metrics: {
      insertCcuSnapshots: async () => 0,
      listDemoCcuTierAppids: async () => ({ appids: [], skippedCount: 0 }),
      recalculateDemoCcuTiers: async () => {
        recalculateCalled = true;
        return { tier1Count: 0, tier2Count: 0 };
      },
      upsertDailyCcuPeaks: async () => 0,
    },
  } as unknown as TigerWriter;

  const stats = await runTigerCcuDemoTieredSync({
    env: {
      CCU_DEMO_HOT_LIMIT: '2',
      CCU_DEMO_TAIL_LIMIT: '0',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async () => fetchResultFor([]),
    getTiger: () => tiger,
    refreshCcuQualityCache: async () => {},
  });

  assert.equal(stats.skippedForMainCcu, false);
  assert.equal(stats.stoppedForMainCcu, false);
  assert.equal(stats.tierRecalculated, true);
  assert.equal(recalculateCalled, true);
  assert.deepEqual(guardOrder.slice(0, 2), ['abandon', 'count']);
});

test('runTigerCcuDemoTieredSync stops before tail work when a main CCU job appears', async () => {
  const guardResponses = [
    [], // pre-run guard
    [], // after recalc guard
    [], // tier 1 chunk guard
    [{ jobType: 'ccu-tiered', count: 1 }], // before tail guard
  ];
  let tier2Listed = false;
  const fetchedChunks: number[][] = [];

  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 0,
      countFreshRunningSyncJobsByTypes: async () => guardResponses.shift() ?? [],
      createSyncJob: async () => 'job-1',
      updateSyncJob: async () => 1,
    },
    metrics: {
      insertCcuSnapshots: async () => 0,
      listDemoCcuTierAppids: async ({ tier }: { tier: number }) => {
        if (tier === 1) {
          return { appids: [10, 20], skippedCount: 0 };
        }
        tier2Listed = true;
        return { appids: [30], skippedCount: 0 };
      },
      listSuspiciousZeroAppids: async () => new Set<number>(),
      recalculateDemoCcuTiers: async () => ({ tier1Count: 2, tier2Count: 1 }),
      updateDemoCcuTierAssignments: async (appids: number[]) => appids.length,
      upsertDailyCcuPeaks: async () => 0,
    },
  } as unknown as TigerWriter;

  const stats = await runTigerCcuDemoTieredSync({
    env: {
      CCU_DEMO_HOT_LIMIT: '2',
      CCU_DEMO_TAIL_LIMIT: '1',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async (appids) => {
      fetchedChunks.push(appids);
      return fetchResultFor(appids);
    },
    getTiger: () => tiger,
    refreshCcuQualityCache: async () => {},
  });

  assert.equal(stats.stoppedForMainCcu, true);
  assert.equal(stats.tier1Processed, 2);
  assert.equal(stats.tier2Processed, 0);
  assert.equal(tier2Listed, false);
  assert.deepEqual(fetchedChunks, [[10, 20]]);
});

test('runTigerCcuDemoTieredSync re-checks main CCU guards every 25 demo appids', async () => {
  const guardResponses = [
    [], // pre-run guard
    [], // after recalc guard
    [], // first tier 1 chunk guard
    [{ jobType: 'ccu-daily-p2', count: 1 }], // second tier 1 chunk guard
  ];
  const tier1Appids = Array.from({ length: 30 }, (_, index) => index + 100);
  const fetchedChunks: number[][] = [];

  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 0,
      countFreshRunningSyncJobsByTypes: async () => guardResponses.shift() ?? [],
      createSyncJob: async () => 'job-1',
      updateSyncJob: async () => 1,
    },
    metrics: {
      insertCcuSnapshots: async () => 0,
      listDemoCcuTierAppids: async () => ({ appids: tier1Appids, skippedCount: 0 }),
      listSuspiciousZeroAppids: async () => new Set<number>(),
      recalculateDemoCcuTiers: async () => ({ tier1Count: 30, tier2Count: 0 }),
      updateDemoCcuTierAssignments: async (appids: number[]) => appids.length,
      upsertDailyCcuPeaks: async () => 0,
    },
  } as unknown as TigerWriter;

  const stats = await runTigerCcuDemoTieredSync({
    env: {
      CCU_DEMO_HOT_LIMIT: '30',
      CCU_DEMO_TAIL_LIMIT: '0',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async (appids) => {
      fetchedChunks.push(appids);
      return fetchResultFor(appids);
    },
    getTiger: () => tiger,
    refreshCcuQualityCache: async () => {},
  });

  assert.equal(stats.stoppedForMainCcu, true);
  assert.equal(stats.tier1Processed, 25);
  assert.equal(fetchedChunks.length, 1);
  assert.equal(fetchedChunks[0]?.length, 25);
});
