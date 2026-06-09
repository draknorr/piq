/**
 * Railway Demo CCU Scheduler
 *
 * Runs the demo mini-tiered CCU sync from a single always-on Railway worker.
 *
 * Run with: pnpm --filter @publisheriq/ingestion ccu-demo-railway-worker
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { logger } from '@publisheriq/shared';
import {
  runCcuDemoTieredSync,
  type DemoCcuTieredSyncDependencies,
  type DemoCcuTieredSyncStats,
} from './ccu-demo-tiered-worker.js';

const log = logger.child({ worker: 'ccu-demo-railway-worker' });

const DEFAULT_HOURS_UTC = [0, 4, 8, 12, 16, 20];
const DEFAULT_MINUTE_UTC = 20;
const DEFAULT_WINDOW_MINUTES = 10;
const DEFAULT_TICK_MS = 300_000;
const COMPLETED_SLOT_RETENTION_MS = 48 * 60 * 60 * 1000;

export type DemoCcuRailwayRefreshMode = 'tiered' | 'adaptive';

export interface DemoCcuRailwaySchedulerConfig {
  hoursUtc: number[];
  minuteUtc: number;
  refreshMode: DemoCcuRailwayRefreshMode;
  tickMs: number;
  windowMinutes: number;
}

export interface DemoCcuRailwaySchedulerState {
  activeRun: Promise<void> | null;
  dailyBudgetBackoffUntilMs: number | null;
  completedSlotKeys: Set<string>;
  steamBackoffUntilMs: number | null;
}

export type DemoCcuRailwayTickStatus =
  | 'active_run'
  | 'already_completed'
  | 'backoff'
  | 'daily_budget'
  | 'outside_window'
  | 'started';

export interface DemoCcuRailwayTickResult {
  backoffUntilIso?: string;
  slotKey?: string;
  status: DemoCcuRailwayTickStatus;
}

type RunDemoSync = (
  dependencies: DemoCcuTieredSyncDependencies
) => Promise<DemoCcuTieredSyncStats>;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }
  return parsed;
}

function parseMinute(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const minute = Number.parseInt(value, 10);
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    throw new Error(`Expected a UTC minute from 0 to 59 but received "${value}"`);
  }
  return minute;
}

function parseHoursUtc(value: string | undefined): number[] {
  if (!value) {
    return DEFAULT_HOURS_UTC;
  }

  const hours = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const hour = Number.parseInt(part, 10);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        throw new Error(`Expected UTC hours from 0 to 23 but received "${value}"`);
      }
      return hour;
    });

  if (hours.length === 0) {
    throw new Error('Expected at least one UTC scheduler hour');
  }

  return [...new Set(hours)].sort((a, b) => a - b);
}

function parseRefreshMode(value: string | undefined): DemoCcuRailwayRefreshMode {
  if (!value) {
    return 'adaptive';
  }

  if (value === 'tiered' || value === 'adaptive') {
    return value;
  }

  throw new Error(
    `Expected CCU_DEMO_REFRESH_MODE to be "tiered" or "adaptive" but received "${value}"`
  );
}

export function readDemoCcuRailwaySchedulerConfig(
  env: NodeJS.ProcessEnv = process.env
): DemoCcuRailwaySchedulerConfig {
  return {
    hoursUtc: parseHoursUtc(env.CCU_DEMO_SCHEDULER_HOURS_UTC),
    minuteUtc: parseMinute(env.CCU_DEMO_SCHEDULER_MINUTE_UTC, DEFAULT_MINUTE_UTC),
    refreshMode: parseRefreshMode(env.CCU_DEMO_REFRESH_MODE),
    tickMs: parsePositiveInteger(env.CCU_DEMO_SCHEDULER_TICK_MS, DEFAULT_TICK_MS),
    windowMinutes: parsePositiveInteger(
      env.CCU_DEMO_SCHEDULER_WINDOW_MINUTES,
      DEFAULT_WINDOW_MINUTES
    ),
  };
}

export function createDemoCcuRailwaySchedulerState(): DemoCcuRailwaySchedulerState {
  return {
    activeRun: null,
    dailyBudgetBackoffUntilMs: null,
    completedSlotKeys: new Set<string>(),
    steamBackoffUntilMs: null,
  };
}

function slotKeyFromStartMs(startMs: number): string {
  return new Date(startMs).toISOString();
}

export function getDueDemoCcuRailwaySlotKey(
  now: Date,
  config: DemoCcuRailwaySchedulerConfig
): string | null {
  const nowMs = now.getTime();
  const dayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const dayStarts = [dayStartMs, dayStartMs - 24 * 60 * 60 * 1000];

  for (const candidateDayStartMs of dayStarts) {
    for (const hour of config.hoursUtc) {
      const slotStartMs =
        candidateDayStartMs + hour * 60 * 60 * 1000 + config.minuteUtc * 60 * 1000;
      const slotEndMs = slotStartMs + config.windowMinutes * 60 * 1000;
      if (nowMs >= slotStartMs && nowMs < slotEndMs) {
        return slotKeyFromStartMs(slotStartMs);
      }
    }
  }

  return null;
}

export function pruneCompletedDemoCcuRailwaySlots(
  state: DemoCcuRailwaySchedulerState,
  now: Date
): void {
  const cutoffMs = now.getTime() - COMPLETED_SLOT_RETENTION_MS;
  for (const slotKey of state.completedSlotKeys) {
    const slotMs = Date.parse(slotKey);
    if (!Number.isFinite(slotMs) || slotMs < cutoffMs) {
      state.completedSlotKeys.delete(slotKey);
    }
  }
}

function adaptiveSlotKey(now: Date): string {
  return `adaptive:${now.toISOString()}`;
}

function buildRailwayDemoSyncEnv(
  env: NodeJS.ProcessEnv,
  slotKey: string,
  refreshMode: DemoCcuRailwayRefreshMode
): NodeJS.ProcessEnv {
  return {
    ...env,
    CCU_DEMO_MAIN_CCU_GUARD_MODE:
      env.CCU_DEMO_MAIN_CCU_GUARD_MODE ?? 'hot_independent',
    CCU_DEMO_REFRESH_MODE: env.CCU_DEMO_REFRESH_MODE ?? refreshMode,
    CCU_DEMO_RUNTIME: env.CCU_DEMO_RUNTIME ?? 'railway',
    CCU_DEMO_SLOT_KEY: slotKey,
  };
}

export async function runDemoCcuRailwaySchedulerTick(params: {
  config: DemoCcuRailwaySchedulerConfig;
  env?: NodeJS.ProcessEnv;
  now: Date;
  runDemoSync?: RunDemoSync;
  state: DemoCcuRailwaySchedulerState;
}): Promise<DemoCcuRailwayTickResult> {
  const env = params.env ?? process.env;
  const runDemoSync = params.runDemoSync ?? runCcuDemoTieredSync;
  pruneCompletedDemoCcuRailwaySlots(params.state, params.now);

  if (params.state.activeRun) {
    return { status: 'active_run' };
  }

  const slotKey =
    params.config.refreshMode === 'adaptive'
      ? adaptiveSlotKey(params.now)
      : getDueDemoCcuRailwaySlotKey(params.now, params.config);

  if (!slotKey) {
    return { status: 'outside_window' };
  }

  if (params.config.refreshMode === 'tiered' && params.state.completedSlotKeys.has(slotKey)) {
    return { slotKey, status: 'already_completed' };
  }

  if (
    params.state.dailyBudgetBackoffUntilMs !== null &&
    params.now.getTime() < params.state.dailyBudgetBackoffUntilMs
  ) {
    return {
      backoffUntilIso: new Date(params.state.dailyBudgetBackoffUntilMs).toISOString(),
      slotKey,
      status: 'daily_budget',
    };
  }

  if (
    params.state.steamBackoffUntilMs !== null &&
    params.now.getTime() < params.state.steamBackoffUntilMs
  ) {
    return {
      backoffUntilIso: new Date(params.state.steamBackoffUntilMs).toISOString(),
      slotKey,
      status: 'backoff',
    };
  }

  if (params.config.refreshMode === 'tiered') {
    params.state.completedSlotKeys.add(slotKey);
  }
  params.state.activeRun = Promise.resolve()
    .then(async () => {
      const stats = await runDemoSync({
        env: buildRailwayDemoSyncEnv(env, slotKey, params.config.refreshMode),
      });
      if (stats.stoppedForDailyBudget && stats.dailyBudgetResetIso) {
        const backoffUntilMs = Date.parse(stats.dailyBudgetResetIso);
        if (Number.isFinite(backoffUntilMs)) {
          params.state.dailyBudgetBackoffUntilMs = backoffUntilMs;
        }
      }
      if (stats.stoppedForSteamBackoff && stats.steamBackoffUntilIso) {
        const backoffUntilMs = Date.parse(stats.steamBackoffUntilIso);
        if (Number.isFinite(backoffUntilMs)) {
          params.state.steamBackoffUntilMs = backoffUntilMs;
        }
      }
    })
    .finally(() => {
      params.state.activeRun = null;
    });

  log.info('Started Railway demo CCU slot', { slotKey });
  return { slotKey, status: 'started' };
}

export async function runDemoCcuRailwayScheduler(params: {
  config?: DemoCcuRailwaySchedulerConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runDemoSync?: RunDemoSync;
  shouldStop?: () => boolean;
  sleepMs?: (ms: number) => Promise<void>;
  state?: DemoCcuRailwaySchedulerState;
} = {}): Promise<void> {
  const env = params.env ?? process.env;
  const config = params.config ?? readDemoCcuRailwaySchedulerConfig(env);
  const state = params.state ?? createDemoCcuRailwaySchedulerState();
  const now = params.now ?? (() => new Date());
  const sleepMs = params.sleepMs ?? sleep;

  log.info('Starting Railway demo CCU scheduler', {
    hoursUtc: config.hoursUtc,
    minuteUtc: config.minuteUtc,
    refreshMode: config.refreshMode,
    tickMs: config.tickMs,
    windowMinutes: config.windowMinutes,
  });

  while (!params.shouldStop?.()) {
    const result = await runDemoCcuRailwaySchedulerTick({
      config,
      env,
      now: now(),
      runDemoSync: params.runDemoSync,
      state,
    });

    if (result.status === 'backoff') {
      log.info('Skipping Railway demo CCU slot during Steam backoff', {
        backoffUntilIso: result.backoffUntilIso,
        slotKey: result.slotKey,
      });
    }
    if (result.status === 'daily_budget') {
      log.info('Skipping Railway demo CCU slot because daily request budget is exhausted', {
        backoffUntilIso: result.backoffUntilIso,
        slotKey: result.slotKey,
      });
    }

    await sleepMs(config.tickMs);
  }

  if (state.activeRun) {
    log.info('Waiting for active Railway demo CCU run to finish before shutdown');
    await state.activeRun;
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  let shuttingDown = false;
  process.on('SIGTERM', () => {
    shuttingDown = true;
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
  });

  runDemoCcuRailwayScheduler({ shouldStop: () => shuttingDown }).catch((error) => {
    log.error('Railway demo CCU scheduler failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
