import assert from 'node:assert/strict';
import test from 'node:test';
import type { TigerWriter } from '@publisheriq/database';
import {
  formatMainCcuCounts,
  inspectMainCcuActivity,
  installSyncJobSignalHandlers,
  MAIN_CCU_JOB_TYPES,
} from './ccu-sync-job-guard.js';

test('inspectMainCcuActivity abandons stale rows before counting fresh jobs', async () => {
  const calls: string[] = [];
  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async (params: {
        errorMessage?: string;
        jobTypes: string[];
        staleBeforeIso: string;
      }) => {
        calls.push('abandon');
        assert.deepEqual(params.jobTypes, [...MAIN_CCU_JOB_TYPES]);
        assert.equal(params.staleBeforeIso, '2026-06-08T07:15:00.000Z');
        assert.equal(params.errorMessage, 'demo_guard_cleanup');
        return 2;
      },
      countFreshRunningSyncJobsByTypes: async (jobTypes: string[], freshAfterIso: string) => {
        calls.push('count');
        assert.deepEqual(jobTypes, [...MAIN_CCU_JOB_TYPES]);
        assert.equal(freshAfterIso, '2026-06-08T07:30:00.000Z');
        return [{ jobType: 'ccu-daily-p0', count: 1 }];
      },
    },
  } as unknown as TigerWriter;

  const activity = await inspectMainCcuActivity({
    env: {
      CCU_MAIN_JOB_FRESH_MINUTES: '30',
      CCU_MAIN_JOB_STALE_MINUTES: '45',
    } as NodeJS.ProcessEnv,
    now: new Date('2026-06-08T08:00:00.000Z'),
    staleErrorMessage: 'demo_guard_cleanup',
    tiger,
  });

  assert.deepEqual(calls, ['abandon', 'count']);
  assert.equal(activity.abandonedStale, 2);
  assert.equal(activity.active, true);
  assert.equal(activity.total, 1);
  assert.equal(activity.countsByType['ccu-daily-p0'], 1);
  assert.equal(activity.countsByType['ccu-tiered'], 0);
});

test('inspectMainCcuActivity does not treat abandoned stale rows as active', async () => {
  const tiger = {
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 4,
      countFreshRunningSyncJobsByTypes: async () => [],
    },
  } as unknown as TigerWriter;

  const activity = await inspectMainCcuActivity({
    now: new Date('2026-06-08T08:00:00.000Z'),
    tiger,
  });

  assert.equal(activity.abandonedStale, 4);
  assert.equal(activity.active, false);
  assert.equal(activity.total, 0);
  assert.deepEqual(
    MAIN_CCU_JOB_TYPES.map((jobType) => activity.countsByType[jobType]),
    [0, 0, 0, 0, 0, 0]
  );
});

test('formatMainCcuCounts includes blocking counts by guarded job type', () => {
  assert.equal(
    formatMainCcuCounts({
      ccu: 0,
      'ccu-daily': 0,
      'ccu-daily-p0': 1,
      'ccu-daily-p1': 0,
      'ccu-daily-p2': 2,
      'ccu-tiered': 0,
    }),
    'ccu=0, ccu-tiered=0, ccu-daily=0, ccu-daily-p0=1, ccu-daily-p1=0, ccu-daily-p2=2'
  );
});

test('installSyncJobSignalHandlers removes temporary process listeners', () => {
  const tiger = {
    ops: {
      updateSyncJob: async () => 1,
    },
  } as unknown as TigerWriter;
  const sigtermBefore = process.listenerCount('SIGTERM');
  const sigintBefore = process.listenerCount('SIGINT');

  const cleanup = installSyncJobSignalHandlers({
    jobId: '00000000-0000-0000-0000-000000000001',
    jobType: 'ccu',
    tiger,
  });

  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore + 1);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore + 1);

  cleanup();

  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
});
