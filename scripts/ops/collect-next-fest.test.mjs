import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { ATTEMPT_CAP, collectSignal, festivalLimits, selectReviewCatchUpIds, fetchCcuSummary, parseJournal, reusableReviews, reviewEvidence, verifyDailySnapshot } from './collect-next-fest.mjs';
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
      assert.equal(new URL(url).searchParams.get('appid'), '1');
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

test('Tiger replay checkpoints only after persistence and retains original timestamps', async () => {
  const { persistResults } = await import('./collect-next-fest.mjs');
  const record = { kind: 'result', signal: 'ccu', appid: 1, at: start, status: 'success', summary: { playerCount: 0 } };
  const calls = [], receipts = [], records = [record];
  const tiger = { metrics: {
    insertCcuSnapshots: async rows => calls.push(['snapshots', rows]),
    upsertDailyCcuPeaks: async rows => calls.push(['peaks', rows]),
    checkpointDemoCcuValidation: async rows => calls.push(['state', rows]),
  } };
  const result = await persistResults(tiger, records, async r => receipts.push(r), 'ccu');
  assert.deepEqual(result, { persisted: 1, pending: 0 });
  assert.equal(calls[0][1][0].snapshot_time, start);
  assert.equal(calls[0][1][0].player_count, 0);
  assert.equal(calls[1][1][0].ccu_peak, 0);
  assert.equal(calls[2][1][0].validation_state, 'confirmed_zero');
  assert.equal(receipts[0].kind, 'persisted');
  assert.deepEqual(await persistResults(tiger, records, async () => {}, 'ccu'), { persisted: 0, pending: 0 });
  const failed = structuredClone(record);
  failed.appid = 2;
  tiger.metrics.upsertDailyCcuPeaks = async () => { throw new Error('db unavailable'); };
  await assert.rejects(persistResults(tiger, [failed], async () => assert.fail('must not acknowledge'), 'ccu'), /db unavailable/);
});

test('review replay is bounded, preserves source time and does not spend requests', async () => {
  const { persistResults } = await import('./collect-next-fest.mjs');
  const saved = [], batches = [];
  const records = [1, 2, 3].map(appid => ({ kind: 'result', signal: 'reviews', appid, at: start,
    observedAt: '2026-10-20T23:00:00.000Z', status: 'success', summary, attempts: 0 }));
  const result = await persistResults({ reviews: { persistReviewObservations: async rows => batches.push(rows) } },
    records, async r => saved.push(r), 'reviews', 2);
  assert.deepEqual(result, { persisted: 2, pending: 1 });
  assert.equal(batches[0][0].observedAt, '2026-10-20T23:00:00.000Z');
  assert.equal(saved.length, 2);
  assert.equal(records.filter(r => r.kind === 'attempt').length, 0);
});

test('fresh Tiger CCU reuses known zero with its source time and becomes due before tomorrow', async () => {
  const { reusableCcu } = await import('./collect-next-fest.mjs');
  const evidence = { queries: { roster_metrics: { rows: [] }, roster_ccu_window: { rows: [
    { appid: 1, current_players: 0, window_end: '2026-10-21T02:00:00.000Z' },
    { appid: 2, current_players: 50, window_end: '2026-10-20T06:00:00.000Z' },
    { appid: 3, current_players: null, window_end: start },
  ] } } };
  assert.deepEqual(reusableCcu(evidence, start).map(r => [r.appid, r.summary.playerCount, r.observedAt]),
    [[1, 0, '2026-10-21T02:00:00.000Z']]);
});

test('persistence failure stops collection before the next request, retaining the result for replay', async () => {
  const h = harness({ onResult: async () => { throw new Error('checkpoint unavailable'); } });
  await assert.rejects(collectSignal(h.options), /checkpoint unavailable/);
  assert.deepEqual(h.saved.map(r => r.kind), ['attempt', 'result']);
});

test('Tiger publication requires persistence receipts and accepts genuinely newer source observations', () => {
  const { html, ids } = fixture();
  const sourceAt = '2026-10-21T04:01:00.000Z';
  const records = ids.map(appid => ({ kind: 'result', signal: 'ccu', appid, at: start,
    status: 'success', summary: { playerCount: 1 } }));
  const evidence = { source: 'tiger', checkedAt: sourceAt, queries: {
    roster_metrics: { rows: ids.map(appid => ({ appid })) },
    roster_ccu_window: { rows: ids.map(appid => ({ appid, current_players: 2, first_players: 1,
      observed_peak: 2, samples: 2, window_start: start, window_end: sourceAt })) },
  } };
  const exported = enrichAtlas(html, evidence);
  assert.throws(() => verifyDailySnapshot(exported, records, '2026-10-21'), /uncommitted/);
  records.push(...records.map(r => ({ kind: 'persisted', appid: r.appid, signal: r.signal, at: r.at })));
  assert.equal(verifyDailySnapshot(exported, records, '2026-10-21').successful, 7218);
  const sameTimeMismatch = enrichAtlas(html, { ...evidence, queries: { ...evidence.queries,
    roster_ccu_window: { rows: evidence.queries.roster_ccu_window.rows.map(r => ({ ...r, window_end: start })) },
  } });
  assert.throws(() => verifyDailySnapshot(sameTimeMismatch, records, '2026-10-21'), /differs/);
});

test('reusing Tiger CCU does not write another sample or advance the validation time', async () => {
  const { persistResults } = await import('./collect-next-fest.mjs');
  const records = [{ kind: 'result', signal: 'ccu', appid: 1, at: start,
    observedAt: '2026-10-21T02:00:00.000Z', source: 'tiger', status: 'success', summary: { playerCount: 0 } }];
  const expectEmpty = async rows => assert.equal(rows.length, 0);
  await persistResults({ metrics: { insertCcuSnapshots: expectEmpty,
    upsertDailyCcuPeaks: expectEmpty, checkpointDemoCcuValidation: expectEmpty } }, records, async () => {}, 'ccu');
  assert.equal(records.at(-1).kind, 'persisted');
});


test('the approved catch-up is date-scoped, keeps regular caps, and fits the shared-key worst case', () => {
  assert.equal(festivalLimits('2026-10-21').attemptCap, 12000);
  assert.equal(festivalLimits('2026-10-22').signalCaps.reviews, 4000);
  const catchUp = festivalLimits('2026-10-21', true);
  assert.equal(catchUp.attemptCap, 13500);
  assert.equal(catchUp.signalCaps.reviews, 6300);
  assert.ok(86401 + catchUp.attemptCap < 100000);
  assert.throws(() => festivalLimits('2026-10-20', true), /expired/);
  assert.throws(() => festivalLimits('2026-10-22', true), /expired/);
});

test('catch-up selection stays inside its fixed 2470-ID manifest and preserves oldest-first ordering', () => {
  const manifest = JSON.parse(readFileSync(new URL('./next-fest-review-catch-up.json', import.meta.url), 'utf8'));
  const ids = [...manifest.appids].reverse();
  assert.deepEqual(selectReviewCatchUpIds([1, ...ids, 2], manifest), ids);
  assert.throws(() => selectReviewCatchUpIds(ids.slice(1), manifest), /Invalid/);
  assert.throws(() => selectReviewCatchUpIds(ids, { ...manifest, day: '2026-10-22' }), /Invalid/);
  assert.throws(() => selectReviewCatchUpIds(ids, { ...manifest, appids: [...ids.slice(1), ids[1]] }), /Invalid/);
});

test('catch-up resumes past the ordinary daily limit without discarding reservations or repeating fresh results', async () => {
  const prior = [
    ...Array.from({ length: 7218 }, (_, i) => ({ kind: 'attempt', signal: 'ccu', appid: i + 10000, at: start })),
    ...Array.from({ length: 3609 }, (_, i) => ({ kind: 'attempt', signal: 'reviews', appid: i + 10000, at: start })),
    { kind: 'attempt', signal: 'reviews', appid: 10000, at: start },
    { kind: 'result', signal: 'reviews', appid: 3, at: start, observedAt: '2026-10-20T02:00:00.000Z', attempts: 0, status: 'success', summary },
    { kind: 'result', signal: 'reviews', appid: 4, at: start, observedAt: '2026-10-20T02:06:00.000Z', attempts: 0, status: 'success', summary },
  ];
  const ordinary = harness({ ids: [1, 2, 3, 4], records: structuredClone(prior) });
  assert.equal((await collectSignal(ordinary.options)).attempts, 0);
  const h = harness({ ids: [1, 2, 3, 4], records: structuredClone(prior), reviewCatchUp: true });
  const result = await collectSignal(h.options);
  assert.equal(result.attempts, 3);
  assert.equal(result.rollingAttempts, 10831);
  assert.deepEqual(h.saved.filter(r => r.kind === 'attempt').map(r => r.appid), [1, 2, 3]);
  assert.deepEqual(h.options.records.slice(0, prior.length), prior);
  assert.equal((await collectSignal({ ...h.options, records: structuredClone(h.options.records) })).attempts, 0);
});

test('catch-up enforces its combined and review rolling caps including crash reservations', async () => {
  const attempts = (signal, count) => Array.from({ length: count }, () => ({ kind: 'attempt', signal, appid: 9000, at: start }));
  const combined = harness({ ids: [1, 2], reviewCatchUp: true, records: [...attempts('ccu', 7218), ...attempts('reviews', 6281)] });
  const result = await collectSignal(combined.options);
  assert.equal(result.attempts, 1);
  assert.equal(result.rollingAttempts, 13500);
  assert.equal(result.stopReason, 'rolling_budget_wait_exceeds_deadline');
  const reviews = harness({ ids: [1], reviewCatchUp: true, records: attempts('reviews', 6300) });
  assert.equal((await collectSignal(reviews.options)).attempts, 0);
  await assert.rejects(collectSignal({ ...reviews.options, signal: 'ccu' }), /reviews|review roster/);
  await assert.rejects(collectSignal({ ...reviews.options, now: () => Date.parse('2026-10-22T04:00:00Z') }), /expired/);
});

test('publication accepts only the explicit same-day catch-up budget and keeps its hard limit', () => {
  const { html, ids } = fixture();
  const records = ids.flatMap(appid => [
    { kind: 'attempt', signal: 'ccu', appid, at: start },
    { kind: 'result', signal: 'ccu', appid, at: start, status: 'success', summary: { playerCount: 0 } },
  ]);
  records.push(...Array.from({ length: 6080 }, () => ({ kind: 'attempt', signal: 'reviews', appid: ids[0], at: start })));
  const enriched = enrichAtlas(html, reviewEvidence(html, records, start));
  assert.throws(() => verifyDailySnapshot(enriched, records, '2026-10-21'), /cap/);
  assert.equal(verifyDailySnapshot(enriched, records, '2026-10-21', { reviewCatchUp: true }).attempts, 13298);
  records.push(...Array.from({ length: 203 }, () => ({ kind: 'attempt', signal: 'reviews', appid: ids[0], at: start })));
  assert.throws(() => verifyDailySnapshot(enriched, records, '2026-10-21', { reviewCatchUp: true }), /cap/);
});


test('catch-up reserves combined-budget capacity for remaining targets despite completed out-of-scope demos', async () => {
  const records = [
    ...Array.from({ length: 7218 }, () => ({ kind: 'attempt', signal: 'ccu', appid: 9000, at: start })),
    ...Array.from({ length: 6279 }, () => ({ kind: 'attempt', signal: 'reviews', appid: 9000, at: start })),
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'result', signal: 'reviews', appid: 10000 + i, at: start, status: 'success', summary })),
  ];
  const attempted = [];
  const h = harness({ records, reviewCatchUp: true, fetchSummary: async (appid, options) => {
    await options.beforeAttempt(); attempted.push(appid);
    await assert.rejects(options.beforeAttempt(), /Reserve remaining attempts|rolling_budget_wait/);
    return { status: 'success', summary, telemetry: { attempts: 1 } };
  } });
  const result = await collectSignal(h.options);
  assert.deepEqual(attempted, [1, 2, 3]);
  assert.equal(result.attempts, 3);
  assert.equal(result.rollingAttempts, 13500);
});
