import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CcuSnapshotInsert,
  DailyCcuPeakUpsert,
  SyncJobUpdate,
  TigerWriter,
} from '@publisheriq/database';
import type { CCUBatchResultWithStatus } from '../apis/steam-ccu.js';
import { runTigerCcuDailySync } from './ccu-daily-worker.js';

test('runTigerCcuDailySync heartbeats and cleans up temporary signal handlers', async () => {
  const snapshots: CcuSnapshotInsert[] = [];
  const dailyRows: DailyCcuPeakUpsert[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const sigtermBefore = process.listenerCount('SIGTERM');
  const sigintBefore = process.listenerCount('SIGINT');
  let fetchShouldStopType: string | null = null;
  let heartbeatCalls = 0;
  let refreshTrigger: string | null = null;

  const tiger = {
    ops: {
      createSyncJob: async () => 'job-1',
      heartbeatSyncJob: async () => {
        heartbeatCalls++;
        return 1;
      },
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
      isCcuTierAssignmentsStale: async () => false,
      listSuspiciousZeroAppids: async () => new Set<number>(),
      listTier3CcuAppids: async () => ({ appids: [10], skippedCount: 0 }),
      updateCcuTierAssignments: async () => 1,
      upsertDailyCcuPeaks: async (rows: DailyCcuPeakUpsert[]) => {
        dailyRows.push(...rows);
        return rows.length;
      },
    },
  } as unknown as TigerWriter;

  const fetchResult: CCUBatchResultWithStatus = {
    errorCount: 0,
    invalidCount: 0,
    results: new Map([
      [10, { status: 'valid', validationState: 'confirmed_positive', playerCount: 88 }],
    ]),
    validCount: 1,
  };

  const stats = await runTigerCcuDailySync({
    env: {
      CCU_DAILY_LIMIT: '1',
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async (_appids, _onProgress, shouldStop) => {
      fetchShouldStopType = typeof shouldStop;
      return fetchResult;
    },
    getTiger: () => tiger,
    refreshCcuQualityCache: async (trigger) => {
      refreshTrigger = trigger;
    },
  });

  assert.equal(stats.appsProcessed, 1);
  assert.equal(stats.appsSucceeded, 1);
  assert.equal(fetchShouldStopType, 'function');
  assert.deepEqual(snapshots.map((row) => [row.appid, row.player_count, row.ccu_tier]), [
    [10, 88, 3],
  ]);
  assert.deepEqual(dailyRows.map((row) => [row.appid, row.ccu_peak]), [[10, 88]]);
  assert.equal(refreshTrigger, 'ccu-daily');
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(heartbeatCalls, 0);
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
});
