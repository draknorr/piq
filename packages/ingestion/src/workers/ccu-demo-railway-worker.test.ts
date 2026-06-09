import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DemoCcuTieredSyncDependencies,
  DemoCcuTieredSyncStats,
} from './ccu-demo-tiered-worker.js';
import {
  createDemoCcuRailwaySchedulerState,
  getDueDemoCcuRailwaySlotKey,
  readDemoCcuRailwaySchedulerConfig,
  runDemoCcuRailwaySchedulerTick,
  type DemoCcuRailwaySchedulerConfig,
} from './ccu-demo-railway-worker.js';

const config: DemoCcuRailwaySchedulerConfig = {
  hoursUtc: [8, 9, 10],
  minuteUtc: 20,
  refreshMode: 'tiered',
  tickMs: 30_000,
  windowMinutes: 10,
};

function stats(overrides: Partial<DemoCcuTieredSyncStats> = {}): DemoCcuTieredSyncStats {
  return {
    candidateBreakdown: null,
    dailyBudgetRemaining: null,
    dailyBudgetResetIso: null,
    rateLimitedCount: 0,
    refreshMode: 'tiered',
    requestCount: 300,
    rpsFinal: null,
    rpsInitial: null,
    skippedForMainCcu: false,
    steamBackoffUntilIso: null,
    stoppedForDailyBudget: false,
    stoppedForMainCcu: false,
    stoppedForSteamBackoff: false,
    tier1Processed: 300,
    tier1Skipped: 0,
    tier1Succeeded: 300,
    tier2Processed: 0,
    tier2Skipped: 0,
    tier2Succeeded: 0,
    tierRecalculated: true,
    totalFailed: 0,
    totalInvalid: 0,
    ...overrides,
  };
}

test('readDemoCcuRailwaySchedulerConfig reads UTC slot env', () => {
  const parsed = readDemoCcuRailwaySchedulerConfig({
    CCU_DEMO_SCHEDULER_HOURS_UTC: '20,0,8',
    CCU_DEMO_SCHEDULER_MINUTE_UTC: '15',
    CCU_DEMO_SCHEDULER_TICK_MS: '1000',
    CCU_DEMO_SCHEDULER_WINDOW_MINUTES: '5',
  } as NodeJS.ProcessEnv);

  assert.deepEqual(parsed, {
    hoursUtc: [0, 8, 20],
    minuteUtc: 15,
    refreshMode: 'adaptive',
    tickMs: 1000,
    windowMinutes: 5,
  });
});

test('getDueDemoCcuRailwaySlotKey catches starts inside the grace window', () => {
  assert.equal(
    getDueDemoCcuRailwaySlotKey(new Date('2026-06-08T08:27:00.000Z'), config),
    '2026-06-08T08:20:00.000Z'
  );
  assert.equal(getDueDemoCcuRailwaySlotKey(new Date('2026-06-08T08:31:00.000Z'), config), null);
});

test('runDemoCcuRailwaySchedulerTick starts one run per configured slot', async () => {
  const state = createDemoCcuRailwaySchedulerState();
  const envs: NodeJS.ProcessEnv[] = [];

  const first = await runDemoCcuRailwaySchedulerTick({
    config,
    env: { DATA_WRITE_TARGET: 'tiger' } as NodeJS.ProcessEnv,
    now: new Date('2026-06-08T08:20:00.000Z'),
    runDemoSync: async (dependencies: DemoCcuTieredSyncDependencies) => {
      envs.push(dependencies.env ?? {});
      return stats();
    },
    state,
  });
  const activeRun = state.activeRun;
  assert.equal(first.status, 'started');
  assert.ok(activeRun);
  await activeRun;

  const second = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T08:25:00.000Z'),
    runDemoSync: async () => stats(),
    state,
  });

  assert.equal(second.status, 'already_completed');
  assert.equal(envs.length, 1);
  assert.equal(envs[0]?.CCU_DEMO_MAIN_CCU_GUARD_MODE, 'hot_independent');
  assert.equal(envs[0]?.CCU_DEMO_RUNTIME, 'railway');
  assert.equal(envs[0]?.CCU_DEMO_SLOT_KEY, '2026-06-08T08:20:00.000Z');
});

test('runDemoCcuRailwaySchedulerTick never overlaps active runs', async () => {
  const state = createDemoCcuRailwaySchedulerState();
  let resolveRun!: (value: DemoCcuTieredSyncStats) => void;
  const pendingRun = new Promise<DemoCcuTieredSyncStats>((resolve) => {
    resolveRun = resolve;
  });
  let runCount = 0;

  const first = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T08:20:00.000Z'),
    runDemoSync: async () => {
      runCount++;
      return pendingRun;
    },
    state,
  });
  const activeRun = state.activeRun;
  const second = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T08:21:00.000Z'),
    runDemoSync: async () => stats(),
    state,
  });

  assert.equal(first.status, 'started');
  assert.equal(second.status, 'active_run');
  assert.equal(runCount, 1);
  resolveRun(stats());
  assert.ok(activeRun);
  await activeRun;
});

test('runDemoCcuRailwaySchedulerTick respects and resumes after Steam backoff', async () => {
  const state = createDemoCcuRailwaySchedulerState();
  let runCount = 0;

  const first = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T08:20:00.000Z'),
    runDemoSync: async () => {
      runCount++;
      return stats({
        steamBackoffUntilIso: '2026-06-08T09:45:00.000Z',
        stoppedForSteamBackoff: true,
      });
    },
    state,
  });
  const firstRun = state.activeRun;
  assert.equal(first.status, 'started');
  assert.ok(firstRun);
  await firstRun;

  const duringBackoff = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T09:20:00.000Z'),
    runDemoSync: async () => {
      runCount++;
      return stats();
    },
    state,
  });
  assert.equal(duringBackoff.status, 'backoff');
  assert.equal(duringBackoff.backoffUntilIso, '2026-06-08T09:45:00.000Z');

  const afterBackoff = await runDemoCcuRailwaySchedulerTick({
    config,
    now: new Date('2026-06-08T10:20:00.000Z'),
    runDemoSync: async () => {
      runCount++;
      return stats();
    },
    state,
  });
  const secondRun = state.activeRun;
  assert.equal(afterBackoff.status, 'started');
  assert.ok(secondRun);
  await secondRun;
  assert.equal(runCount, 2);
});

test('runDemoCcuRailwaySchedulerTick adaptive mode starts outside fixed slots', async () => {
  const state = createDemoCcuRailwaySchedulerState();
  const envs: NodeJS.ProcessEnv[] = [];

  const first = await runDemoCcuRailwaySchedulerTick({
    config: { ...config, refreshMode: 'adaptive' },
    env: { DATA_WRITE_TARGET: 'tiger' } as NodeJS.ProcessEnv,
    now: new Date('2026-06-08T08:03:00.000Z'),
    runDemoSync: async (dependencies: DemoCcuTieredSyncDependencies) => {
      envs.push(dependencies.env ?? {});
      return stats({ refreshMode: 'adaptive' });
    },
    state,
  });
  const activeRun = state.activeRun;

  assert.equal(first.status, 'started');
  assert.equal(first.slotKey, 'adaptive:2026-06-08T08:03:00.000Z');
  assert.ok(activeRun);
  await activeRun;
  assert.equal(envs[0]?.CCU_DEMO_REFRESH_MODE, 'adaptive');
});

test('runDemoCcuRailwaySchedulerTick pauses adaptive mode after daily budget exhaustion', async () => {
  const state = createDemoCcuRailwaySchedulerState();

  const first = await runDemoCcuRailwaySchedulerTick({
    config: { ...config, refreshMode: 'adaptive' },
    now: new Date('2026-06-08T08:03:00.000Z'),
    runDemoSync: async () =>
      stats({
        dailyBudgetResetIso: '2026-06-09T00:00:00.000Z',
        refreshMode: 'adaptive',
        stoppedForDailyBudget: true,
      }),
    state,
  });
  const activeRun = state.activeRun;
  assert.equal(first.status, 'started');
  assert.ok(activeRun);
  await activeRun;

  const second = await runDemoCcuRailwaySchedulerTick({
    config: { ...config, refreshMode: 'adaptive' },
    now: new Date('2026-06-08T08:08:00.000Z'),
    runDemoSync: async () => stats({ refreshMode: 'adaptive' }),
    state,
  });

  assert.equal(second.status, 'daily_budget');
  assert.equal(second.backoffUntilIso, '2026-06-09T00:00:00.000Z');
});
