import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildDemoPopularity, decodeAtlas, enrichAtlas, festivalDemoIds } from './export-next-fest-popularity.mjs';

const now = '2026-10-20T20:00:00.000Z';
const observation = { appid: 1, total_reviews: 100, positive_reviews: 80,
  negative_reviews: 20, positive_percentage: 1, last_reviews_sync: now };

test('derive positivity from consistent votes; unknown and zero are different', () => {
  assert.equal(buildDemoPopularity(observation, null, null, now).review.positivity, 80);
  const zero = buildDemoPopularity({ ...observation, total_reviews: 0, positive_reviews: 0, negative_reviews: 0 }, null, null, now);
  assert.equal(zero.review.total, 0);
  assert.equal(zero.review.positivity, null);
  for (const total of [null, undefined, -1, '100', 99]) {
    assert.equal(buildDemoPopularity({ ...observation, total_reviews: total }, null, null, now).review, null);
  }
});

test('preserve successful timestamps and later failure without inventing a fresh observation', () => {
  const row = { ...observation, last_reviews_sync: '2026-09-26T12:00:00.000Z',
    last_error_source: 'reviews', last_error_at: now };
  const result = buildDemoPopularity(row, null, null, now);
  assert.equal(result.review.observedAt, row.last_reviews_sync);
  assert.equal(result.failedReviewAt, now);
  assert.equal(result.reviewGrowth, null);
  assert.equal(result.ccu, null);
});

test('net review changes use actual observations, preserve declines, and deduplicate unchanged source time', () => {
  const baseline = buildDemoPopularity({ ...observation, last_reviews_sync: '2026-10-19T18:00:00.000Z' }, null, null, now);
  assert.equal(buildDemoPopularity({ ...observation, last_reviews_sync: baseline.review.observedAt }, null, baseline, now).reviewGrowth, null);
  const result = buildDemoPopularity({ ...observation, total_reviews: 95, positive_reviews: 75 }, null, baseline, now);
  assert.deepEqual(result.reviewGrowth, { net: -5, from: baseline.review.observedAt, to: now });
  assert.equal(result.reviewBaseline.total, 100);
});

test('CCU peak and trend are limited to the actual sampled festival window', () => {
  const ccu = { current_players: 0, first_players: 10, observed_peak: 20,
    samples: 3, window_start: '2026-10-19T18:00:00.000Z', window_end: now };
  const result = buildDemoPopularity(observation, ccu, null, now).ccu;
  assert.equal(result.current, 0);
  assert.equal(result.change, -10);
  assert.equal(result.peak, 20);
  assert.equal(buildDemoPopularity(observation, { ...ccu, samples: 1 }, null, now).ccu.change, null);
  assert.equal(buildDemoPopularity(observation, { ...ccu, window_start: '2026-09-26T12:00:00.000Z' }, null, now).ccu, null);
  assert.equal(buildDemoPopularity(observation, { ...ccu, current_players: 25 }, null, now).ccu, null);
  assert.equal(buildDemoPopularity(observation, { ...ccu, window_end: '2026-10-19T17:30:00.000Z' }, null, now).ccu, null);
});

test('export requires complete reads and keeps all original roster fields and source timestamps', () => {
  const games = Array.from({ length: 7218 }, (_, i) => ({ appid: i + 1, demos: [i + 10_000, i + 10_000], software: false, name: `Game ${i}` }));
  const data = { games, meta: { captured_at_utc: '2026-10-20T12:00:00Z' } };
  assert.equal(festivalDemoIds(data).length, 7218);
  const html = `<script type="application/octet-stream" id="nf-payload">${gzipSync(JSON.stringify(data)).toString('base64')}</script>`;
  const evidence = { checkedAt: now, errors: {}, queries: {
    roster_metrics: { rows: games.map(g => ({ ...observation, appid: g.demos[0] })) },
    roster_ccu_window: { rows: [] },
  } };
  const enriched = decodeAtlas(enrichAtlas(html, evidence));
  assert.deepEqual(enriched.games, games);
  assert.deepEqual(enriched.meta, data.meta);
  assert.equal(Object.keys(enriched.popularity.demos).length, 7218);
  const later = '2026-10-21T20:00:00.000Z';
  const refreshed = decodeAtlas(enrichAtlas(enrichAtlas(html, evidence), {
    ...evidence, checkedAt: later, queries: { ...evidence.queries,
      roster_metrics: { rows: evidence.queries.roster_metrics.rows.map(row => ({
        ...row, total_reviews: 105, positive_reviews: 85, last_reviews_sync: later,
      })) },
    },
  }));
  assert.equal(refreshed.popularity.demos[10000].reviewBaseline.total, 100);
  assert.deepEqual(refreshed.popularity.demos[10000].reviewGrowth, { net: 5, from: now, to: later });
  assert.throws(() => enrichAtlas(html, { ...evidence, errors: { ccu: 'timeout' } }));
  assert.throws(() => enrichAtlas(html, { ...evidence, queries: { roster_metrics: { rows: [] } } }));
});

test('older or missing source rows preserve the successful observation and signed interval growth', () => {
  const previous = buildDemoPopularity(observation, null, null, now);
  const later = '2026-10-22T20:00:00.000Z';
  assert.deepEqual(buildDemoPopularity({ appid: 1 }, null, previous, later).review, previous.review);
  assert.deepEqual(buildDemoPopularity({ ...observation, last_reviews_sync: '2026-10-19T18:00:00.000Z' }, null, previous, later).review, previous.review);
  const changed = buildDemoPopularity({ ...observation, total_reviews: 105, positive_reviews: 85, last_reviews_sync: later }, null, previous, later);
  assert.deepEqual(changed.reviewDailyGrowth, { net: 5, from: now, to: later });
  assert.equal(buildDemoPopularity({ ...observation, last_reviews_sync: later }, null, changed, later).reviewDailyGrowth, null);
});
