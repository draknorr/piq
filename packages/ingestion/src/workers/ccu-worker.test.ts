import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DailyCcuPeakUpsert,
  SyncJobUpdate,
  TigerWriter,
} from '@publisheriq/database';
import type { CCUBatchResultWithStatus } from '../apis/steam-ccu.js';
import { runTigerCcuSync } from './ccu-worker.js';

test('runTigerCcuSync writes official CCU peaks and validation state to Tiger', async () => {
  const dailyRows: DailyCcuPeakUpsert[] = [];
  const validationUpdates: Array<{ appids: number[]; values: Record<string, string | null> }> = [];
  const jobUpdates: SyncJobUpdate[] = [];
  let refreshTrigger: string | null = null;
  let suspiciousZeroOption: ReadonlySet<number> | undefined;

  const tiger = {
    ops: {
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        jobUpdates.push(values);
        return 1;
      },
    },
    metrics: {
      listCcuSyncCandidates: async () => [10, 20, 30],
      listSuspiciousZeroAppids: async () => new Set([20]),
      upsertDailyCcuPeaks: async (rows: DailyCcuPeakUpsert[]) => {
        dailyRows.push(...rows);
        return rows.length;
      },
      updateCcuTierAssignments: async (
        appids: number[],
        values: Record<string, string | null>
      ) => {
        validationUpdates.push({ appids, values });
        return appids.length;
      },
    },
  } as unknown as TigerWriter;

  const fetchResult: CCUBatchResultWithStatus = {
    results: new Map([
      [10, { status: 'valid', validationState: 'confirmed_positive', playerCount: 42 }],
      [20, { status: 'valid', validationState: 'confirmed_zero', playerCount: 0 }],
      [30, { status: 'invalid', validationState: 'invalid' }],
    ]),
    validCount: 2,
    invalidCount: 1,
    errorCount: 0,
  };

  const result = await runTigerCcuSync({
    env: {
      DATA_WRITE_TARGET: 'tiger',
      CCU_LIMIT: '3',
      GITHUB_RUN_ID: 'run-123',
    } as NodeJS.ProcessEnv,
    getTiger: () => tiger,
    fetchSteamCCUBatchWithStatus: async (_appids, _onProgress, _shouldStop, options) => {
      suspiciousZeroOption = options?.suspiciousZeroAppids;
      return fetchResult;
    },
    refreshCcuQualityCache: async (trigger) => {
      refreshTrigger = trigger;
    },
  });

  assert.deepEqual(result, {
    appsProcessed: 3,
    appsSucceeded: 2,
    appsFailed: 1,
  });
  assert.equal(suspiciousZeroOption?.has(20), true);
  assert.deepEqual(
    dailyRows.map((row) => [row.appid, row.ccu_peak, row.ccu_source]),
    [
      [10, 42, 'steam_api'],
      [20, 0, 'steam_api'],
    ]
  );
  assert.deepEqual(
    validationUpdates
      .filter((update) => update.appids.length > 0)
      .map((update) => [update.appids, update.values.last_ccu_validation_state]),
    [
      [[10], 'confirmed_positive'],
      [[20], 'confirmed_zero'],
      [[30], 'invalid'],
    ]
  );
  assert.equal(refreshTrigger, 'ccu');
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
});
