import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSteamCCUBatchWithStatus } from './steam-ccu.js';

function steamResponse(playerCount: number, status: number = 200): Response {
  return new Response(JSON.stringify({ response: { player_count: playerCount, result: 1 } }), {
    status,
  });
}

function invalidJsonResponse(status: number): Response {
  return new Response('too many requests', { status });
}

test('fetchSteamCCUBatchWithStatus counts suspicious-zero confirmation requests', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(String(input));
    return steamResponse(0);
  }) as typeof fetch;

  try {
    const result = await fetchSteamCCUBatchWithStatus([10], undefined, undefined, {
      concurrency: 1,
      rpsInitial: 1000,
      rpsMax: 1000,
      rpsMin: 1000,
      suspiciousZeroAppids: new Set([10]),
    });

    assert.equal(result.validCount, 1);
    assert.equal(result.requestCount, 2);
    assert.equal(result.rateLimitedCount, 0);
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1] ?? '', /cb=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSteamCCUBatchWithStatus caps concurrency and lowers rps after rate limit', async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;

    const url = String(input);
    if (url.includes('appid=2')) {
      return invalidJsonResponse(429);
    }

    return steamResponse(5);
  }) as typeof fetch;

  try {
    const result = await fetchSteamCCUBatchWithStatus([1, 2, 3, 4], undefined, undefined, {
      concurrency: 2,
      rpsInitial: 1000,
      rpsMax: 1000,
      rpsMin: 1,
    });

    assert.equal(maxActive, 2);
    assert.equal(result.rateLimitedCount, 1);
    assert.equal(result.errorCount, 1);
    assert.ok((result.rpsFinal ?? 1000) < 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
