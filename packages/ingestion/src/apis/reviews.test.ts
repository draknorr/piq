import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchReviewHistogram } from './reviews.js';

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
