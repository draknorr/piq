import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CcuSnapshotInsert,
  DailyCcuPeakUpsert,
  SyncJobUpdate,
  TigerWriter,
} from '@publisheriq/database';
import type { CCUBatchResultWithStatus } from '../apis/steam-ccu.js';
import { runTigerCcuTieredSync } from './ccu-tiered-worker.js';

test('runTigerCcuTieredSync heartbeats and cleans up temporary signal handlers', async () => {
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
      listCcuTierAssignments: async () => [{ appid: 10, ccuTier: 1 }],
      listSuspiciousZeroAppids: async () => new Set<number>(),
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
      [10, { status: 'valid', validationState: 'confirmed_positive', playerCount: 77 }],
    ]),
    validCount: 1,
  };

  const stats = await runTigerCcuTieredSync({
    env: {
      DATA_WRITE_TARGET: 'tiger',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    fetchSteamCCUBatchWithStatus: async (_appids, _onProgress, shouldStop) => {
      fetchShouldStopType = typeof shouldStop;
      return fetchResult;
    },
    getTiger: () => tiger,
    now: () => new Date('2026-06-08T01:00:00.000Z'),
    refreshCcuQualityCache: async (trigger) => {
      refreshTrigger = trigger;
    },
  });

  assert.equal(stats.tier1Processed, 1);
  assert.equal(stats.tier1Succeeded, 1);
  assert.equal(fetchShouldStopType, 'function');
  assert.deepEqual(snapshots.map((row) => [row.appid, row.player_count, row.ccu_tier]), [
    [10, 77, 1],
  ]);
  assert.deepEqual(dailyRows.map((row) => [row.appid, row.ccu_peak]), [[10, 77]]);
  assert.equal(refreshTrigger, 'ccu-tiered');
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal(heartbeatCalls, 0);
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
});
