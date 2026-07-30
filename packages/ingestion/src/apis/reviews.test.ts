import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchReviewHistogram, fetchReviewSummary, parseRetryAfterMs, ReviewRateLimitCircuit } from './reviews.js';

function summaryResponse(status = 200, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      cursor: '*',
      query_summary: {
        num_reviews: 0,
        review_score: 8,
        review_score_desc: 'Very Positive',
        total_negative: 20,
        total_positive: 80,
        total_reviews: 100
      },
      reviews: [],
      success: 1
    }),
    {
      headers: {
        'content-type': 'application/json',
        ...headers
      },
      status
    }
  );
}

function histogramResponse(rollups: unknown[], success = 1): Response {
  return new Response(
    JSON.stringify({
      success,
      results: {
        end_date: 0,
        recent: [],
        rollup_type: 'month',
        rollups,
        start_date: 0,
        weeks: [],
      },
    }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }
  );
}

test('fetchReviewHistogram distinguishes data from an empty successful response', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    histogramResponse([
      {
        date: 1_767_225_600,
        recommendations_down: 2,
        recommendations_up: 8,
      },
    ]),
    histogramResponse([]),
  ];
  globalThis.fetch = async () => responses.shift() as Response;

  try {
    const data = await fetchReviewHistogram(10, 1000);
    const empty = await fetchReviewHistogram(20, 1000);

    assert.equal(data.status, 'data');
    assert.equal(data.attempts, 1);
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0]?.recommendationsUp, 8);
    assert.equal(data.entries[0]?.positiveRatio, 0.8);
    assert.deepEqual(empty, {
      attempts: 1,
      entries: [],
      status: 'empty',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchReviewHistogram reports invalid Steam responses as failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => histogramResponse([], 0);

  try {
    const result = await fetchReviewHistogram(30, 1000);

    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 1);
    if (result.status === 'failed') {
      assert.equal(result.errorCode, 'invalid_response');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchReviewSummary guards and counts every actual retry attempt', async () => {
  const responses = [summaryResponse(500), summaryResponse(429, { 'retry-after': '2' }), summaryResponse()];
  const delays: number[] = [];
  let limiterAcquires = 0;
  let sharedTokenAcquires = 0;

  const result = await fetchReviewSummary(10, {
    beforeAttempt: async () => {
      sharedTokenAcquires += 1;
    },
    fetchImpl: async () => responses.shift()!,
    limiter: {
      acquire: async () => {
        limiterAcquires += 1;
      }
    },
    random: () => 0.5,
    sleep: async (ms) => {
      delays.push(ms);
    }
  });

  assert.equal(result.status, 'success');
  assert.equal(limiterAcquires, 3);
  assert.equal(sharedTokenAcquires, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(result.telemetry, {
    attempts: 3,
    forbidden: 0,
    networkErrors: 0,
    rateLimited: 1,
    retries: 2,
    serverErrors: 1,
    timeouts: 0
  });
  if (result.status === 'success') {
    assert.equal(result.statusCode, 200);
    assert.equal(result.summary.totalReviews, 100);
  }
});

test('fetchReviewSummary retries HTTP 408 and generic fetch network failures', async () => {
  const responses: Array<Response | Error> = [
    summaryResponse(408),
    new TypeError('socket closed unexpectedly'),
    summaryResponse()
  ];

  const result = await fetchReviewSummary(15, {
    fetchImpl: async () => {
      const response = responses.shift()!;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    limiter: { acquire: async () => {} },
    random: () => 0.5,
    sleep: async () => {}
  });

  assert.equal(result.status, 'success');
  assert.equal(result.telemetry.attempts, 3);
  assert.equal(result.telemetry.timeouts, 1);
  assert.equal(result.telemetry.networkErrors, 1);
});

test('fetchReviewSummary reports guard failures without counting an HTTP attempt', async () => {
  const result = await fetchReviewSummary(16, {
    beforeAttempt: async () => {
      throw new Error('shared limiter unavailable');
    },
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
    limiter: { acquire: async () => {} }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.telemetry.attempts, 0);
  if (result.status === 'failed') {
    assert.equal(result.errorCode, 'request_guard_failed');
  }
});

test('fetchReviewSummary defers a retry at the deadline without opening the 429 circuit', async () => {
  const nowMs = Date.parse('2026-07-29T12:00:00.000Z');
  const circuit = new ReviewRateLimitCircuit();
  const result = await fetchReviewSummary(17, {
    circuitBreaker: circuit,
    deadlineMs: nowMs + 500,
    fetchImpl: async () => summaryResponse(500),
    limiter: { acquire: async () => {} },
    now: () => nowMs,
    random: () => 0.5,
    sleep: async () => {}
  });

  assert.equal(result.status, 'failed');
  assert.equal(circuit.getState(nowMs).opened, false);
  if (result.status === 'failed') {
    assert.equal(result.errorCode, 'retry_deferred');
    assert.equal(result.circuitOpened, false);
  }
});

test('fetchReviewSummary caps timeout retries at four attempts', async () => {
  let attempts = 0;
  const timeout = new Error('request timed out');
  timeout.name = 'TimeoutError';

  const result = await fetchReviewSummary(20, {
    fetchImpl: async () => {
      attempts += 1;
      throw timeout;
    },
    limiter: { acquire: async () => {} },
    random: () => 0.5,
    sleep: async () => {}
  });

  assert.equal(result.status, 'failed');
  assert.equal(attempts, 4);
  assert.equal(result.telemetry.attempts, 4);
  assert.equal(result.telemetry.retries, 3);
  assert.equal(result.telemetry.timeouts, 4);
  if (result.status === 'failed') {
    assert.equal(result.errorCode, 'timeout');
  }
});

test('fetchReviewSummary treats HTTP 403 as a fatal non-retryable outcome', async () => {
  let attempts = 0;
  const result = await fetchReviewSummary(30, {
    fetchImpl: async () => {
      attempts += 1;
      return summaryResponse(403);
    },
    limiter: { acquire: async () => {} },
    sleep: async () => {}
  });

  assert.equal(attempts, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.telemetry.forbidden, 1);
  if (result.status === 'failed') {
    assert.equal(result.statusCode, 403);
    assert.equal(result.circuitOpened, false);
  }
});

test('fetchReviewSummary opens the rolling circuit after three 429 responses', async () => {
  const circuit = new ReviewRateLimitCircuit();
  let nowMs = Date.parse('2026-07-29T12:00:00.000Z');
  let attempts = 0;
  const result = await fetchReviewSummary(40, {
    circuitBreaker: circuit,
    fetchImpl: async () => {
      attempts += 1;
      return summaryResponse(429);
    },
    limiter: { acquire: async () => {} },
    now: () => nowMs,
    random: () => 0.5,
    sleep: async (ms) => {
      nowMs += ms;
    }
  });

  assert.equal(attempts, 3);
  assert.equal(result.status, 'failed');
  assert.equal(result.telemetry.rateLimited, 3);
  if (result.status === 'failed') {
    assert.equal(result.circuitOpened, true);
    assert.equal(result.circuitOpenUntil, new Date(nowMs + 15 * 60 * 1000).toISOString());
  }
});

test('parseRetryAfterMs supports delta seconds and HTTP dates', () => {
  const nowMs = Date.parse('2026-07-29T12:00:00.000Z');

  assert.equal(parseRetryAfterMs('2.5', nowMs), 2500);
  assert.equal(parseRetryAfterMs('Wed, 29 Jul 2026 12:00:05 GMT', nowMs), 5000);
  assert.equal(parseRetryAfterMs('not-a-date', nowMs), null);
});

test('ReviewRateLimitCircuit uses a rolling ten-minute 429 window', () => {
  const circuit = new ReviewRateLimitCircuit();
  const start = Date.parse('2026-07-29T12:00:00.000Z');

  assert.equal(circuit.recordRateLimit(start).opened, false);
  assert.equal(circuit.recordRateLimit(start + 9 * 60 * 1000).opened, false);
  assert.equal(circuit.recordRateLimit(start + 9 * 60 * 1000 + 1).opened, true);

  const freshCircuit = new ReviewRateLimitCircuit();
  assert.equal(freshCircuit.recordRateLimit(start).opened, false);
  assert.equal(freshCircuit.recordRateLimit(start + 11 * 60 * 1000).opened, false);
  assert.equal(freshCircuit.recordRateLimit(start + 11 * 60 * 1000 + 1).opened, false);
});
