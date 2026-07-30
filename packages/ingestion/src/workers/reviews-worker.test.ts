import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PersistReviewFailureBatchParams,
  PersistReviewSummaryBatchParams,
  SyncJobUpdate,
  TigerWriter
} from '@publisheriq/database';
import type { ClaimedReviewApp } from '@publisheriq/database/ingestion';
import {
  ReviewRateLimitCircuit,
  type ReviewSummaryFetchOptions,
  type ReviewSummaryFetchResult
} from '../apis/reviews.js';
import { runReviewsSync } from './reviews-worker.js';

function claimedApp(appid: number): ClaimedReviewApp {
  return {
    appid,
    hours_overdue: 1,
    lane: 'unknown_sweep',
    last_known_total_reviews: 0,
    last_reviews_sync: null,
    priority_score: 0,
    velocity_tier: 'dormant'
  };
}

function success(appid: number): ReviewSummaryFetchResult {
  return {
    circuitOpened: false,
    status: 'success',
    statusCode: 200,
    summary: {
      appid,
      negativeReviews: 20,
      positiveReviews: 80,
      reviewScore: 8,
      reviewScoreDesc: 'Very Positive',
      totalReviews: 100
    },
    telemetry: {
      attempts: 1,
      forbidden: 0,
      networkErrors: 0,
      rateLimited: 0,
      retries: 0,
      serverErrors: 0,
      timeouts: 0
    }
  };
}

function failure(params: {
  circuitOpened?: boolean;
  errorCode: string;
  statusCode?: number;
}): ReviewSummaryFetchResult {
  return {
    circuitOpened: params.circuitOpened ?? false,
    errorCode: params.errorCode,
    errorMessage: params.errorCode,
    status: 'failed',
    telemetry: {
      attempts: 1,
      forbidden: params.statusCode === 403 ? 1 : 0,
      networkErrors: 0,
      rateLimited: params.statusCode === 429 ? 1 : 0,
      retries: 0,
      serverErrors: 0,
      timeouts: 0
    },
    ...(params.statusCode === undefined ? {} : { statusCode: params.statusCode })
  };
}

function fakeTiger(params: {
  failureBatches?: PersistReviewFailureBatchParams[];
  jobUpdates?: SyncJobUpdate[];
  successBatches?: PersistReviewSummaryBatchParams[];
}): TigerWriter {
  return {
    ops: {
      createSyncJob: async () => 'job-1',
      updateSyncJob: async (_id: string, values: SyncJobUpdate) => {
        params.jobUpdates?.push(values);
        return 1;
      }
    },
    reviews: {
      loadPreviousSyncData: async (appids: number[]) => ({
        neverSyncedSet: new Set(appids),
        previousSyncData: new Map(
          appids.map((appid) => [
            appid,
            {
              consecutiveErrors: 0,
              intervalHours: 72,
              isPinned: false,
              lastActivityAt: null,
              lastSync: null,
              positiveReviews: 0,
              totalReviews: 0
            }
          ])
        )
      }),
      persistReviewFailuresBatch: async (batch: PersistReviewFailureBatchParams) => {
        params.failureBatches?.push(batch);
        return batch.failures.length;
      },
      persistReviewSummaryBatch: async (batch: PersistReviewSummaryBatchParams) => {
        params.successBatches?.push(batch);
        return batch.items.map((item) => ({
          appid: item.appid,
          intervalHours: 720,
          negativeAdded: 20,
          nextSyncAt: '2026-08-28T12:00:00.000Z',
          nowIso: batch.persistedAt!,
          positiveAdded: 80,
          reviewsAdded: 100
        }));
      }
    }
  } as unknown as TigerWriter;
}

function tigerEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    BATCH_SIZE: '3',
    CLAIM_BATCH_SIZE: '3',
    DATA_WRITE_TARGET: 'tiger',
    EMPTY_CLAIM_EXIT_THRESHOLD: '1',
    MAX_RUNTIME_MINUTES: '5',
    REVIEWS_CONCURRENCY: '1',
    ...overrides
  };
}

test('Reviews worker rejects every configured concurrency other than one', async () => {
  for (const configuredConcurrency of ['0', '2', '1.5', 'invalid']) {
    await assert.rejects(
      () =>
        runReviewsSync({
          env: tigerEnv({ REVIEWS_CONCURRENCY: configuredConcurrency }),
          getTiger: () => fakeTiger({})
        }),
      /REVIEWS_CONCURRENCY must be exactly 1/
    );
  }
});

test('Reviews worker fetches sequentially and persists one atomic success batch', async () => {
  const successBatches: PersistReviewSummaryBatchParams[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const tiger = fakeTiger({ jobUpdates, successBatches });
  let inFlight = 0;
  let maxInFlight = 0;
  let sharedTokenAcquires = 0;

  const stats = await runReviewsSync({
    acquireRateToken: async () => {
      sharedTokenAcquires += 1;
      return { granted: true, waitMs: 0 };
    },
    claimApps: async () => [claimedApp(1), claimedApp(2), claimedApp(3)],
    env: tigerEnv(),
    fetchSummary: async (appid: number, options?: ReviewSummaryFetchOptions) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await options?.beforeAttempt?.();
      await Promise.resolve();
      inFlight -= 1;
      return success(appid);
    },
    getTiger: () => tiger,
    releaseClaims: async ({ appids }) => appids.length
  });

  assert.equal(maxInFlight, 1);
  assert.equal(sharedTokenAcquires, 3);
  assert.equal(successBatches.length, 1);
  assert.equal(successBatches[0]?.items.length, 3);
  assert.equal(stats.requestAttempts, 3);
  assert.equal(stats.appsCreated, 3);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  assert.equal((jobUpdates.at(-1)?.metadata?.stats as ReviewsStatsMetadata).requestAttempts, 3);
});

type ReviewsStatsMetadata = {
  appsDeferred: number;
  circuitExits: number;
  circuitPauseMs: number;
  requestAttempts: number;
};

test('Reviews worker releases unprocessed claims and fails the job on HTTP 403', async () => {
  const successBatches: PersistReviewSummaryBatchParams[] = [];
  const failureBatches: PersistReviewFailureBatchParams[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const releases: number[][] = [];
  const tiger = fakeTiger({ failureBatches, jobUpdates, successBatches });

  await assert.rejects(
    () =>
      runReviewsSync({
        acquireRateToken: async () => ({ granted: true, waitMs: 0 }),
        claimApps: async () => [claimedApp(1), claimedApp(2), claimedApp(3)],
        env: tigerEnv(),
        fetchSummary: async (appid) =>
          appid === 2 ? failure({ errorCode: 'http_403', statusCode: 403 }) : success(appid),
        getTiger: () => tiger,
        releaseClaims: async ({ appids }) => {
          releases.push(appids);
          return appids.length;
        }
      }),
    /HTTP 403/
  );

  assert.deepEqual(releases[0], [3]);
  assert.equal(successBatches[0]?.items.length, 1);
  assert.equal(failureBatches[0]?.failures.length, 1);
  assert.equal(jobUpdates.at(-1)?.status, 'failed');
});

test('Reviews worker releases claims, pauses an open circuit, and resumes', async () => {
  const circuit = new ReviewRateLimitCircuit();
  const successBatches: PersistReviewSummaryBatchParams[] = [];
  const failureBatches: PersistReviewFailureBatchParams[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const releases: number[][] = [];
  let nowMs = Date.parse('2026-07-29T12:00:00.000Z');
  let claimRound = 0;

  const stats = await runReviewsSync({
    acquireRateToken: async () => ({ granted: true, waitMs: 0 }),
    circuitBreaker: circuit,
    claimApps: async () => {
      claimRound += 1;
      return claimRound === 1 ? [claimedApp(1)] : [claimedApp(2)];
    },
    env: tigerEnv({ BATCH_SIZE: '2', CLAIM_BATCH_SIZE: '1' }),
    fetchSummary: async (appid) => {
      if (appid === 1) {
        circuit.openFor(1000, nowMs);
        return failure({
          circuitOpened: true,
          errorCode: 'http_429',
          statusCode: 429
        });
      }
      return success(appid);
    },
    getTiger: () => fakeTiger({ failureBatches, jobUpdates, successBatches }),
    now: () => new Date(nowMs),
    releaseClaims: async ({ appids }) => {
      releases.push(appids);
      return appids.length;
    },
    sleep: async (ms) => {
      nowMs += ms;
    }
  });

  assert.equal(stats.circuitOpens, 1);
  assert.equal(stats.circuitPauseMs, 1000);
  assert.equal(stats.appsProcessed, 2);
  assert.equal(failureBatches.length, 1);
  assert.equal(successBatches.length, 1);
  assert.ok(releases.some((appids) => appids.includes(1)));
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
});

test('Reviews worker exits cleanly when the circuit outlasts its deadline', async () => {
  const circuit = new ReviewRateLimitCircuit();
  const jobUpdates: SyncJobUpdate[] = [];
  const releases: number[][] = [];
  const tiger = fakeTiger({ jobUpdates });
  const nowMs = Date.parse('2026-07-29T12:00:00.000Z');

  const stats = await runReviewsSync({
    acquireRateToken: async () => ({ granted: true, waitMs: 0 }),
    circuitBreaker: circuit,
    claimApps: async () => [claimedApp(1), claimedApp(2)],
    env: tigerEnv({
      BATCH_SIZE: '2',
      CLAIM_BATCH_SIZE: '2',
      MAX_RUNTIME_MINUTES: '1'
    }),
    fetchSummary: async () => {
      circuit.openFor(2 * 60 * 1000, nowMs);
      return failure({
        circuitOpened: true,
        errorCode: 'http_429',
        statusCode: 429
      });
    },
    getTiger: () => tiger,
    now: () => new Date(nowMs),
    releaseClaims: async ({ appids }) => {
      releases.push(appids);
      return appids.length;
    },
    sleep: async () => {}
  });

  assert.equal(stats.appsDeferred, 1);
  assert.equal(stats.circuitExits, 1);
  assert.deepEqual(releases[0], [2]);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
  const metadataStats = jobUpdates.at(-1)?.metadata?.stats as ReviewsStatsMetadata;
  assert.equal(metadataStats.appsDeferred, 1);
  assert.equal(metadataStats.circuitExits, 1);
});

test('Reviews worker releases unprocessed claims on a retry deadline without circuit activity', async () => {
  const failureBatches: PersistReviewFailureBatchParams[] = [];
  const jobUpdates: SyncJobUpdate[] = [];
  const releases: number[][] = [];

  const stats = await runReviewsSync({
    acquireRateToken: async () => ({ granted: true, waitMs: 0 }),
    claimApps: async () => [claimedApp(1), claimedApp(2)],
    env: tigerEnv({ BATCH_SIZE: '2', CLAIM_BATCH_SIZE: '2' }),
    fetchSummary: async () =>
      failure({
        circuitOpened: false,
        errorCode: 'retry_deferred'
      }),
    getTiger: () => fakeTiger({ failureBatches, jobUpdates }),
    releaseClaims: async ({ appids }) => {
      releases.push(appids);
      return appids.length;
    }
  });

  assert.equal(stats.appsProcessed, 1);
  assert.equal(stats.appsDeferred, 1);
  assert.equal(stats.circuitExits, 0);
  assert.equal(stats.circuitOpens, 0);
  assert.equal(failureBatches[0]?.failures.length, 1);
  assert.deepEqual(releases[0], [2]);
  assert.equal(jobUpdates.at(-1)?.status, 'completed');
});
