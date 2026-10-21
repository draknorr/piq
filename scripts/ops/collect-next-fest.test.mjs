import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { ATTEMPT_CAP, collectSignal, fetchCcuSummary, parseJournal, reusableReviews, reviewEvidence, verifyDailySnapshot } from './collect-next-fest.mjs';
import { decodeAtlas, enrichAtlas } from './export-next-fest-popularity.mjs';

const start = '2026-10-21T04:00:00.000Z';
const summary = { totalReviews: 10, positiveReviews: 8, negativeReviews: 2 };
const success = async (appid, options) => {
  try { await options.beforeAttempt(); }
  catch { return { status: 'failed', errorCode: 'request_guard_failed', telemetry: { attempts: 0 } }; }
  return { status: 'success', summary: { appid, ...summary }, telemetry: { attempts: 1 } };
};
function harness(overrides = {}) {
  let time = Date.parse(start);
  const saved = [];
  return { saved, options: { ids: [1, 2, 3], records: [], apiKey: 'secret-fixture', fetchSummary: success,
    append: async record => { saved.push(record); }, now: () => time, wait: async ms => { time += ms; }, ...overrides } };
}
function fixture() {
  const games = Array.from({ length: 7218 }, (_, i) => ({ appid: i + 1, demos: [i + 10000], software: false }));
  const html = `<script type="application/octet-stream" id="nf-payload">${gzipSync(JSON.stringify({ games })).toString('base64')}</script>`;
  return { games, html, ids: games.map(g => g.demos[0]) };
}

test('reserve before request, pace every attempt, and resume without repeating completed demos', async () => {
  const h = harness();
  const first = await collectSignal({ ...h.options, limit: 2 });
  assert.equal(first.attempts, 2);
  assert.deepEqual(h.saved.map(r => r.kind), ['attempt', 'result', 'attempt', 'result']);
  assert.equal(Date.parse(h.saved[2].at) - Date.parse(h.saved[0].at), 4000);
  const resumed = await collectSignal({ ...h.options, records: structuredClone(h.saved) });
  assert.equal(resumed.attempts, 1);
  assert.equal(resumed.finishedForToday, 3);
  assert.equal(resumed.processed, 1);
  assert.ok(!JSON.stringify(h.saved).includes('secret-fixture'));
});

test('crash reservations count toward the hard cap; missing key and torn journals fail closed', async () => {
  const records = Array.from({ length: ATTEMPT_CAP }, () => ({ kind: 'attempt', appid: 1, at: start }));
  const h = harness({ ids: [2], records });
  const result = await collectSignal(h.options);
  assert.equal(result.stopReason, 'rolling_budget_wait_exceeds_deadline');
  assert.equal(h.saved.length, 0);
  await assert.rejects(collectSignal({ ...h.options, apiKey: '' }), /STEAM_REVIEWS_API_KEY/);
  assert.throws(() => parseJournal('{"kind":"attempt"'), /Incomplete journal/);
});

test('a 429 stops all further attempts, persists the pause, and avoids sleeping Retry-After before shutdown', async () => {
  const h = harness({ fetchImpl: async () => new Response('', { status: 429 }),
    fetchSummary: async (_id, options) => {
      await options.beforeAttempt();
      await options.fetchImpl('https://example.invalid');
      await options.sleep(3600000);
      await assert.rejects(options.beforeAttempt(), /http_429/);
      return { status: 'failed', errorCode: 'request_guard_failed', telemetry: { attempts: 1 } };
    } });
  const result = await collectSignal(h.options);
  assert.equal(result.stopReason, 'http_429');
  assert.equal(result.attempts, 1);
  assert.equal(h.saved[1].errorCode, 'http_429');
  assert.equal(h.saved[1].at, start);
});

test('stop before midnight, deadline, or an unrecordable request', async () => {
  const midnight = harness({ now: () => Date.parse('2026-11-03T00:00:00Z') });
  await assert.rejects(collectSignal(midnight.options), /window/);
  const deadline = harness({ maxRuntimeMs: 0 });
  assert.equal((await collectSignal(deadline.options)).stopReason, 'runtime_deadline');
  const disk = harness({ append: async () => { throw new Error('disk full'); } });
  assert.equal((await collectSignal(disk.options)).stopReason, 'journal_write_failed');
});

test('daily CCU and half-roster reviews fit the combined cap; publication verifies the journal and rejects partial CCU', async () => {
  const { html, ids } = fixture();
  const h = harness({ ids });
  const ccu = async (_id, options) => { await options.beforeAttempt(); return { status: 'success', summary: { playerCount: 20 }, telemetry: { attempts: 1 } }; };
  await collectSignal({ ...h.options, signal: 'ccu', fetchSummary: ccu, limit: 3609 });
  const first = enrichAtlas(html, reviewEvidence(html, h.saved, new Date(h.options.now()).toISOString()));
  assert.throws(() => verifyDailySnapshot(first, h.saved, '2026-10-21'), /coverage/);
  await collectSignal({ ...h.options, signal: 'ccu', fetchSummary: ccu, records: structuredClone(h.saved), limit: 3609 });
  await collectSignal({ ...h.options, records: structuredClone(h.saved), limit: 3609 });
  const enriched = enrichAtlas(html, reviewEvidence(html, h.saved, new Date(h.options.now()).toISOString()));
  assert.deepEqual(verifyDailySnapshot(enriched, h.saved, '2026-10-21'), { attempts: 10827, successful: 7218, demos: 7218 });
  const data = decodeAtlas(enriched);
  assert.equal(data.popularity.demos[10000].review.positivity, 80);
  const invalid = structuredClone(h.saved);
  invalid.find(r => r.kind === 'result' && r.signal === 'reviews').summary.totalReviews = 99;
  assert.throws(() => verifyDailySnapshot(enriched, invalid, '2026-10-21'), /differs/);
});

test('a rolling cap waits for old reservations to expire rather than resetting at midnight', async () => {
  const at = '2026-10-20T04:01:00.000Z';
  const records = [...Array.from({ length: 8000 }, () => ({ kind: 'attempt', signal: 'ccu', appid: 1, at })),
    ...Array.from({ length: 3999 }, () => ({ kind: 'attempt', signal: 'reviews', appid: 1, at }))];
  const h = harness({ records, ids: [2, 3] });
  const result = await collectSignal(h.options);
  assert.equal(result.attempts, 2);
  assert.equal(result.stopReason, null);
  assert.ok(h.options.now() - Date.parse(start) >= 60000);
  assert.ok(result.rollingAttempts <= ATTEMPT_CAP);
});

test('reuse preserves source time and consistent votes; stale, malformed, and failed sources remain due', () => {
  const row = { appid: 1, total_reviews: 10, positive_reviews: 8, negative_reviews: 2, last_reviews_sync: '2026-10-20T04:00:00.000Z' };
  const evidence = { queries: { roster_metrics: { rows: [row,
    { ...row, appid: 2, total_reviews: null }, { ...row, appid: 3, last_reviews_sync: '2026-10-18T04:00:00.000Z' },
    { ...row, appid: 4, last_error_source: 'reviews', last_error_at: start }] } } };
  const reused = reusableReviews(evidence, start);
  assert.equal(reused.length, 1);
  assert.equal(reused[0].observedAt, row.last_reviews_sync);
  assert.equal(reused[0].at, start);
  assert.equal(reused[0].attempts, 0);
});

test('CCU uses the authorized key, rejects unknown counts, and confirms a zero after a positive sample', async () => {
  let attempts = 0;
  const options = { apiKey: 'fixture-key', requestTimeoutMs: 1000,
    beforeAttempt: async () => { attempts++; }, sleep: async () => {},
    fetchImpl: async (url, init) => {
      assert.equal(init.headers['x-webapi-key'], 'fixture-key');
      assert.equal(url.searchParams.get('appid'), '1');
      return Response.json({ response: { result: 1, player_count: 0 } });
    } };
  assert.equal((await fetchCcuSummary(1, options, 20)).summary.playerCount, 0);
  assert.equal(attempts, 2);
  const unknown = await fetchCcuSummary(1, { ...options, fetchImpl: async () => Response.json({ response: { result: 1 } }) });
  assert.equal(unknown.status, 'failed');
  assert.equal(unknown.errorCode, 'invalid_response');
});

test('a genuine zero remains zero; a later failed attempt retains successful totals and source time', () => {
  const { html } = fixture();
  const zero = { kind: 'result', appid: 10000, at: start, status: 'success', summary: { totalReviews: 0, positiveReviews: 0, negativeReviews: 0 } };
  const failed = { kind: 'result', appid: 10000, at: '2026-10-21T05:00:00.000Z', status: 'failed', errorCode: 'invalid_response' };
  const result = decodeAtlas(enrichAtlas(html, reviewEvidence(html, [zero, failed], failed.at))).popularity.demos[10000];
  assert.equal(result.review.total, 0);
  assert.equal(result.review.positivity, null);
  assert.equal(result.review.observedAt, start);
  assert.equal(result.failedReviewAt, failed.at);
  assert.equal(result.ccu, undefined);
});

test('reuse skips the intervening daily run but becomes due on the second run even if it starts early', () => {
  const row = { appid: 1, total_reviews: 10, positive_reviews: 8, negative_reviews: 2, last_reviews_sync: start };
  const evidence = { queries: { roster_metrics: { rows: [row] } } };
  assert.equal(reusableReviews(evidence, '2026-10-22T03:50:00.000Z').length, 1);
  assert.equal(reusableReviews(evidence, '2026-10-23T03:50:00.000Z').length, 0);
});
