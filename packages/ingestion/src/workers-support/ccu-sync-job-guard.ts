import type { SyncJobUpdate, TigerWriter } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';

const log = logger.child({ component: 'ccu-sync-job-guard' });

export const MAIN_CCU_JOB_TYPES = [
  'ccu',
  'ccu-tiered',
  'ccu-daily',
  'ccu-daily-p0',
  'ccu-daily-p1',
  'ccu-daily-p2',
] as const;

const DEFAULT_MAIN_JOB_FRESH_MINUTES = 30;
const DEFAULT_MAIN_JOB_STALE_MINUTES = 45;
const DEFAULT_HEARTBEAT_MINUTES = 5;

interface LoggerLike {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export interface MainCcuActivity {
  abandonedStale: number;
  active: boolean;
  countsByType: Record<string, number>;
  freshAfterIso: string;
  staleBeforeIso: string;
  total: number;
}

export interface SyncJobHeartbeat {
  stop(): void;
}

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

function minutesAgoIso(minutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

export function readMainCcuFreshMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.CCU_MAIN_JOB_FRESH_MINUTES, DEFAULT_MAIN_JOB_FRESH_MINUTES);
}

export function readMainCcuStaleMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.CCU_MAIN_JOB_STALE_MINUTES, DEFAULT_MAIN_JOB_STALE_MINUTES);
}

export function readCcuHeartbeatMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.CCU_SYNC_JOB_HEARTBEAT_MINUTES, DEFAULT_HEARTBEAT_MINUTES);
}

export function emptyMainCcuCountsByType(): Record<string, number> {
  return Object.fromEntries(MAIN_CCU_JOB_TYPES.map((jobType) => [jobType, 0]));
}

export function formatMainCcuCounts(countsByType: Record<string, number>): string {
  return MAIN_CCU_JOB_TYPES
    .map((jobType) => `${jobType}=${countsByType[jobType] ?? 0}`)
    .join(', ');
}

export async function inspectMainCcuActivity(params: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  staleErrorMessage?: string;
  tiger: TigerWriter;
}): Promise<MainCcuActivity> {
  const env = params.env ?? process.env;
  const now = params.now ?? new Date();
  const freshAfterIso = minutesAgoIso(readMainCcuFreshMinutes(env), now);
  const staleBeforeIso = minutesAgoIso(readMainCcuStaleMinutes(env), now);
  const jobTypes = [...MAIN_CCU_JOB_TYPES];

  const abandonedStale = await params.tiger.ops.abandonStaleRunningSyncJobsByTypes({
    errorMessage: params.staleErrorMessage ?? 'abandoned_as_stale_before_ccu_guard',
    jobTypes,
    staleBeforeIso,
  });

  if (abandonedStale > 0) {
    log.warn('Abandoned stale main CCU sync job rows before guard check', {
      abandonedStale,
      staleBeforeIso,
    });
  }

  const counts = await params.tiger.ops.countFreshRunningSyncJobsByTypes(
    jobTypes,
    freshAfterIso
  );
  const countsByType = emptyMainCcuCountsByType();
  for (const row of counts) {
    countsByType[row.jobType] = row.count;
  }

  const total = counts.reduce((sum, row) => sum + row.count, 0);
  return {
    abandonedStale,
    active: total > 0,
    countsByType,
    freshAfterIso,
    staleBeforeIso,
    total,
  };
}

export function startSyncJobHeartbeat(params: {
  env?: NodeJS.ProcessEnv;
  jobId: string | null;
  jobType: string;
  logger?: LoggerLike;
  tiger: TigerWriter;
}): SyncJobHeartbeat {
  if (!params.jobId) {
    return { stop: () => {} };
  }

  const heartbeatMs = readCcuHeartbeatMinutes(params.env) * 60 * 1000;
  const heartbeatLogger = params.logger ?? log;
  const interval = setInterval(() => {
    params.tiger.ops.heartbeatSyncJob(params.jobId as string).catch((error) => {
      heartbeatLogger.warn('Failed to heartbeat CCU sync job', {
        error: error instanceof Error ? error.message : String(error),
        jobId: params.jobId,
        jobType: params.jobType,
      });
    });
  }, heartbeatMs);
  interval.unref?.();

  return {
    stop: () => clearInterval(interval),
  };
}

export function installSyncJobSignalHandlers(params: {
  getMetadata?: (signal: NodeJS.Signals) => Record<string, unknown>;
  jobId: string | null;
  jobType: string;
  logger?: LoggerLike;
  onSignal?: (signal: NodeJS.Signals) => void;
  tiger: TigerWriter;
}): () => void {
  if (!params.jobId) {
    return () => {};
  }

  const signalLogger = params.logger ?? log;
  let handled = false;

  const handler = (signal: NodeJS.Signals): void => {
    params.onSignal?.(signal);

    if (handled) {
      return;
    }
    handled = true;

    const values: SyncJobUpdate = {
      completed_at: new Date().toISOString(),
      error_message: `abandoned_after_${signal.toLowerCase()}`,
      metadata: {
        signal,
        ...(params.getMetadata?.(signal) ?? {}),
      },
      status: 'failed',
    };

    params.tiger.ops.updateSyncJob(params.jobId as string, values).catch((error) => {
      signalLogger.warn('Failed to mark CCU sync job abandoned after signal', {
        error: error instanceof Error ? error.message : String(error),
        jobId: params.jobId,
        jobType: params.jobType,
        signal,
      });
    });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);

  return () => {
    process.off('SIGTERM', handler);
    process.off('SIGINT', handler);
  };
}
