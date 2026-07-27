import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HistogramBacklogSnapshot,
  HistogramSyncCandidate,
  SyncJobUpdate,
  TigerWriter,
} from '@publisheriq/database';
import type { ReviewHistogramFetchResult } from '../apis/reviews.js';
import { runHistogramSync } from './histogram-worker.js';

function backlogSnapshot(): HistogramBacklogSnapshot {
  return {
    capturedAt: '2026-07-27T07:00:00.000Z',
    dueApps: 3,
    neverSynced: 1,
    oldestWaitingAt: '2026-04-01T00:00:00.000Z',
    stale30Days: 2,
    stale90Days: 1,
    tiers: {
      active_daily: {
        dueApps: 1,
        neverSynced: 0,
        oldestWaitingAt: '2026-07-25T00:00:00.000Z',
        stale30Days: 0,
        stale90Days: 0,
        totalApps: 1,
        withHistogram: 1,
      },
      medium_weekly: {
        dueApps: 1,
        neverSynced: 0,
        oldestWaitingAt: '2026-07-01T00:00:00.000Z',
        stale30Days: 0,
        stale90Days: 0,
        totalApps: 1,
        withHistogram: 1,
      },
      long_tail_monthly: {
        dueApps: 1,
        neverSynced: 1,
        oldestWaitingAt: '2026-04-01T00:00:00.000Z',
        stale30Days: 2,
        stale90Days: 1,
        totalApps: 1,
        withHistogram: 0,
      },
    },
    totalApps: 3,
    withHistogram: 2,
  };
}

function candidate(overrides: Partial<HistogramSyncCandidate> = {}): HistogramSyncCandidate {
  return {
    appid: 10,
    hasHistogram: false,
    lane: 'coverage_oldest',
    lastHistogramSync: null,
    priorityScore: 0,
    serviceTier: 'long_tail_monthly',
    totalReviews: 5,
    ...overrides,
  };
}

function fakeTiger(params: {
  candidates?: HistogramSyncCandidate[];
  jobId?: string | null;
  jobUpdates?: SyncJobUpdate[];
  statusUpdates?: Array<{ appid: number; values: Record<string, unknown> }>;
}): TigerWriter {
  return {
    catalog: {
      getHistogramBacklogSnapshot: async () => backlogSnapshot(),
      listHistogramSyncCandidates: async () => params.candidates ?? [],
    },
    metrics: {
      upsertReviewHistogram: async (rows: unknown[]) => rows.length,
    },
    ops: {
      abandonStaleRunningSyncJobsByTypes: async () => 0,
      heartbeatSyncJob: async () => 1,
      tryCreateSyncJobIfIdle: async () => (params.jobId === undefined ? 'job-1' : params.jobId),
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        params.jobUpdates?.push(values);
        return 1;
      },
    },
    syncStatus: {
      updateFields: async (appid: number, values: Record<string, unknown>) => {
        params.statusUpdates?.push({ appid, values });
        return 1;
      },
    },
  } as unknown as TigerWriter;
}

test('empty histogram responses advance attempt time without being counted as failures', async () => {
  const statusUpdates: Array<{
    appid: number;
    values: Record<string, unknown>;
  }> = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const tiger = fakeTiger({
    candidates: [candidate()],
    jobUpdates,
    statusUpdates,
  });

  const stats = await runHistogramSync({
    env: {
      BATCH_SIZE: '1',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchHistogram: async (): Promise<ReviewHistogramFetchResult> => ({
      attempts: 1,
      entries: [],
      status: 'empty',
    }),
    getTiger: () => tiger,
    now: () => new Date('2026-07-27T07:00:00.000Z'),
  });

  assert.equal(stats.empty, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.processed, 1);
  assert.deepEqual(statusUpdates, [
    {
      appid: 10,
      values: { last_histogram_sync: '2026-07-27T07:00:00.000Z' },
    },
  ]);
  assert.equal(jobUpdates.at(-1)?.items_skipped, 1);
  assert.equal(jobUpdates.at(-1)?.items_failed, 0);
});

test('failed histogram responses remain failures and do not advance attempt time', async () => {
  const statusUpdates: Array<{
    appid: number;
    values: Record<string, unknown>;
  }> = [];
  const tiger = fakeTiger({
    candidates: [candidate()],
    statusUpdates,
  });

  const stats = await runHistogramSync({
    env: {
      BATCH_SIZE: '1',
      DATA_WRITE_TARGET: 'tiger',
    } as NodeJS.ProcessEnv,
    fetchHistogram: async (): Promise<ReviewHistogramFetchResult> => ({
      attempts: 2,
      entries: [],
      errorCode: 'API_ERROR',
      errorMessage: 'rate limited',
      status: 'failed',
      statusCode: 429,
    }),
    getTiger: () => tiger,
    now: () => new Date('2026-07-27T07:00:00.000Z'),
  });

  assert.equal(stats.failed, 1);
  assert.equal(stats.empty, 0);
  assert.equal(stats.requestAttempts, 2);
  assert.equal(
    statusUpdates.some((update) => 'last_histogram_sync' in update.values),
    false
  );
  assert.deepEqual(statusUpdates[0], {
    appid: 10,
    values: {
      last_error_at: '2026-07-27T07:00:00.000Z',
      last_error_message: 'API_ERROR: rate limited',
      last_error_source: 'histogram',
    },
  });
});

test('histogram worker caps batch size and defers queued work at the runtime budget', async () => {
  let nowMs = Date.parse('2026-07-27T07:00:00.000Z');
  let observedLimit = 0;
  const candidates = [candidate({ appid: 1 }), candidate({ appid: 2 }), candidate({ appid: 3 })];
  const tiger = fakeTiger({ candidates });
  tiger.catalog.listHistogramSyncCandidates = async (params) => {
    observedLimit = params.limit;
    return candidates;
  };

  const stats = await runHistogramSync({
    env: {
      BATCH_SIZE: '9000',
      DATA_WRITE_TARGET: 'tiger',
      HISTOGRAM_MAX_RUNTIME_MINUTES: '1',
    } as NodeJS.ProcessEnv,
    fetchHistogram: async (): Promise<ReviewHistogramFetchResult> => {
      nowMs += 61 * 60 * 1000;
      return {
        attempts: 1,
        entries: [],
        status: 'empty',
      };
    },
    getTiger: () => tiger,
    now: () => new Date(nowMs),
  });

  assert.equal(observedLimit, 1200);
  assert.equal(stats.selected, 3);
  assert.equal(stats.processed, 1);
  assert.equal(stats.deferred, 2);
});

test('histogram worker exits before selecting candidates when concurrency guard is held', async () => {
  let selected = false;
  const tiger = fakeTiger({ jobId: null });
  tiger.catalog.listHistogramSyncCandidates = async () => {
    selected = true;
    return [];
  };

  const stats = await runHistogramSync({
    env: { DATA_WRITE_TARGET: 'tiger' } as NodeJS.ProcessEnv,
    getTiger: () => tiger,
    now: () => new Date('2026-07-27T07:00:00.000Z'),
  });

  assert.equal(stats.skippedConcurrent, true);
  assert.equal(selected, false);
});
