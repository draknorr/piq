#!/usr/bin/env node
// Read-only publication step. No Steam calls, database writes, or deployments.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAYLOAD = /(<script type="application\/octet-stream" id="nf-payload">)([^<]+)(<\/script>)/;
const FESTIVAL_START = '2026-10-19T17:00:00.000Z';
const FESTIVAL_END = '2026-10-26T17:00:00.000Z';
const COLLECTION_END = '2026-11-03T00:00:00.000Z';
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function decodeAtlas(html) {
  const match = html.match(PAYLOAD);
  if (!match) throw new Error('Atlas payload is missing');
  return JSON.parse(gunzipSync(Buffer.from(match[2], 'base64')));
}

export function encodeAtlas(html, data) {
  if (!PAYLOAD.test(html)) throw new Error('Atlas payload is missing');
  return html.replace(PAYLOAD, (_, before, _payload, after) =>
    before + gzipSync(JSON.stringify(data), { level: 9 }).toString('base64') + after);
}

export function festivalDemoIds(data) {
  const games = data.games.filter(game => !game.software);
  const ids = games.flatMap(game => [...new Set(game.demos)]);
  if (games.length !== 7218 || ids.length !== 7218 || new Set(ids).size !== 7218 || !ids.every(validCount)) {
    throw new Error('Expected the verified October roster: 7,218 games and distinct demo IDs');
  }
  return ids;
}

export function buildDemoPopularity(row, ccu, previous, exportedAt) {
  const consistent = [row.total_reviews, row.positive_reviews, row.negative_reviews].every(validCount)
    && row.total_reviews === row.positive_reviews + row.negative_reviews;
  const observedAt = validTime(row.last_reviews_sync) && row.last_reviews_sync <= exportedAt
    ? row.last_reviews_sync : null;
  const freshReview = consistent ? {
    total: row.total_reviews,
    positive: row.positive_reviews,
    negative: row.negative_reviews,
    positivity: row.total_reviews > 0 ? 100 * row.positive_reviews / row.total_reviews : null,
    observedAt,
  } : null;
  // A missing or older source row must not erase the last published success.
  const review = previous?.review?.observedAt
    && (!freshReview?.observedAt || previous.review.observedAt > freshReview.observedAt)
    ? previous.review : freshReview;
  // Daily delta rows are mutable and clamp negative changes. A prior export's
  // source observation is an honest baseline, never a fabricated festival start.
  const candidates = [row.review_baseline, previous?.reviewBaseline, previous?.review, review]
    .filter(value => value && validTime(value.observedAt)
      && value.observedAt >= FESTIVAL_START && value.observedAt < COLLECTION_END
      && value.observedAt <= exportedAt)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const reviewBaseline = candidates[0] ?? null;
  const reviewGrowth = review && reviewBaseline && review.observedAt > reviewBaseline.observedAt
    ? { net: review.total - reviewBaseline.total, from: reviewBaseline.observedAt, to: review.observedAt }
    : null;
  const reviewDailyGrowth = review?.observedAt && previous?.review?.observedAt
    && review.observedAt > previous.review.observedAt
    ? { net: review.total - previous.review.total, from: previous.review.observedAt, to: review.observedAt }
    : null;
  const failedReviewAt = [previous?.failedReviewAt,
    row.last_error_source === 'reviews' ? row.last_error_at : null]
    .filter(at => validTime(at) && at <= exportedAt && (!review?.observedAt || at > review.observedAt))
    .sort().at(-1) ?? null;
  const observedCcu = ccu && validCount(ccu.current_players) && validCount(ccu.observed_peak)
    && ccu.observed_peak >= ccu.current_players
    && validCount(Number(ccu.samples)) && Number(ccu.samples) > 0
    && validTime(ccu.window_start) && validTime(ccu.window_end)
    && ccu.window_start >= FESTIVAL_START && ccu.window_start <= ccu.window_end
    && ccu.window_end < COLLECTION_END && ccu.window_end <= exportedAt
    ? { current: ccu.current_players, peak: ccu.observed_peak, from: ccu.window_start,
      observedAt: ccu.window_end, samples: Number(ccu.samples),
      change: Number(ccu.samples) > 1 && validCount(ccu.first_players)
        ? ccu.current_players - ccu.first_players : null } : null;
  return { review, reviewBaseline, reviewGrowth, reviewDailyGrowth, failedReviewAt, ccu: observedCcu ?? previous?.ccu ?? null,
    ccuLastAttemptAt: row.last_ccu_validation_at ?? row.last_ccu_synced ?? null,
    ccuLastAttemptState: row.last_ccu_validation_state ?? row.ccu_fetch_status ?? null };
}

export function enrichAtlas(html, evidence) {
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  if (evidence.source === 'tiger' && data.popularity?.exportedAt > evidence.checkedAt) {
    throw new Error('Tiger export is older than the published snapshot');
  }
  if (!validTime(evidence.checkedAt) || Object.keys(evidence.errors ?? {}).length) {
    throw new Error('Incomplete or failed source reads; keep the last published snapshot');
  }
  const rows = evidence.queries?.roster_metrics?.rows;
  const ccuRows = evidence.queries?.roster_ccu_window?.rows;
  if (!rows || !ccuRows || rows.length !== ids.length || new Set(rows.map(row => row.appid)).size !== ids.length) {
    throw new Error('A complete metrics read and successful CCU window read are required');
  }
  const byId = new Map(rows.map(row => [row.appid, row]));
  const ccuById = new Map(ccuRows.map(row => [row.appid, row]));
  const demos = {};
  for (const id of ids) {
    if (!byId.has(id)) throw new Error(`Missing demo ${id}`);
    const previous = data.popularity?.demos?.[id];
    if (evidence.source === 'tiger' && ((previous?.review?.observedAt &&
      (!byId.get(id).last_reviews_sync || byId.get(id).last_reviews_sync < previous.review.observedAt))
      || (previous?.ccu?.observedAt && (!ccuById.get(id)?.window_end
        || ccuById.get(id).window_end < previous.ccu.observedAt
        || ccuById.get(id).observed_peak < previous.ccu.peak
        || Number(ccuById.get(id).samples) < previous.ccu.samples)))) {
      throw new Error(`Tiger is missing published observations for demo ${id}; finish replay before export`);
    }
    const observation = buildDemoPopularity(byId.get(id), ccuById.get(id), previous, evidence.checkedAt);
    // The current review already preserves this baseline until a later source
    // observation arrives. Avoid duplicating it and empty fields in the page.
    if (JSON.stringify(observation.reviewBaseline) === JSON.stringify(observation.review)) {
      observation.reviewBaseline = null;
    }
    demos[id] = Object.fromEntries(Object.entries(observation).filter(([, value]) => value !== null));
  }
  data.popularity = { source: evidence.source ?? 'legacy', exportedAt: evidence.checkedAt, previousExportedAt: data.popularity?.exportedAt ?? null, festivalStart: FESTIVAL_START,
    festivalEnd: FESTIVAL_END, collectionEnd: COLLECTION_END, reviewStaleHours: 60, ccuStaleHours: 36, demos };
  return encodeAtlas(html, data);
}

export async function readEvidence(client, ids, options = {}) {
  // One connection, sequential reads, two-second lock limit, eight-second
  // statement limit. No ranking, claims, repairs, or projection refreshes.
  const metrics = options.rateOnly ? { rows: [] } : await client.query(`
    SELECT r.appid, m.total_reviews, m.positive_reviews, m.negative_reviews,
      s.last_reviews_sync, s.last_error_source, s.last_error_at,
      d.last_ccu_synced, d.last_ccu_validation_at, d.last_ccu_validation_state, d.ccu_fetch_status
    FROM unnest($1::integer[]) r(appid)
    LEFT JOIN legacy.latest_daily_metrics m USING(appid)
    LEFT JOIN ops.sync_status s USING(appid)
    LEFT JOIN ops.demo_ccu_tier_assignments d USING(appid)
    LIMIT 7218`, [ids]);
  if (!options.rateOnly) {
    const history = await client.query(`
      SELECT r.appid, latest.observed_at, latest.snapshot_summary,
        baseline.observed_at AS baseline_at, baseline.snapshot_summary AS baseline,
        failed.observed_at AS failed_at
      FROM unnest($1::integer[]) r(appid)
      LEFT JOIN LATERAL (
        SELECT observed_at, snapshot_summary FROM docs.app_source_snapshots
        WHERE appid = r.appid AND source = 'reviews' AND first_seen_at <= now()
          AND snapshot_summary->>'status' = 'success'
        ORDER BY first_seen_at DESC, id DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT observed_at, snapshot_summary FROM docs.app_source_snapshots
        WHERE appid = r.appid AND source = 'reviews' AND first_seen_at >= $2::timestamptz
          AND first_seen_at < $3::timestamptz AND first_seen_at <= now()
          AND snapshot_summary->>'status' = 'success'
        ORDER BY first_seen_at ASC, id ASC LIMIT 1
      ) baseline ON true
      LEFT JOIN LATERAL (
        SELECT observed_at FROM docs.app_source_snapshots
        WHERE appid = r.appid AND source = 'reviews' AND first_seen_at >= $2::timestamptz
          AND first_seen_at < $3::timestamptz AND first_seen_at <= now()
          AND snapshot_summary->>'status' = 'failed'
        ORDER BY first_seen_at DESC, id DESC LIMIT 1
      ) failed ON true LIMIT 7218`, [ids, FESTIVAL_START, COLLECTION_END]);
    const byId = new Map(history.rows.map(row => [row.appid, row]));
    for (const row of metrics.rows) {
      const h = byId.get(row.appid);
      const sourceTime = h?.observed_at ? new Date(h.observed_at).toISOString() : null;
      const currentTime = row.last_reviews_sync ? new Date(row.last_reviews_sync).toISOString() : null;
      if (sourceTime && (!currentTime || sourceTime >= currentTime)) Object.assign(row, {
        total_reviews: h.snapshot_summary.summary.totalReviews,
        positive_reviews: h.snapshot_summary.summary.positiveReviews,
        negative_reviews: h.snapshot_summary.summary.negativeReviews, last_reviews_sync: sourceTime,
      });
      if (h?.baseline_at) row.review_baseline = {
        total: h.baseline.summary.totalReviews, positive: h.baseline.summary.positiveReviews,
        negative: h.baseline.summary.negativeReviews, observedAt: new Date(h.baseline_at).toISOString(),
      };
      if (h?.failed_at && (row.last_error_source !== 'reviews' || !row.last_error_at || new Date(h.failed_at) > new Date(row.last_error_at))) {
        row.last_error_source = 'reviews'; row.last_error_at = h.failed_at;
      }
    }
  }
  const ccu = options.includeCcu === false || options.rateOnly ? { rows: [] } : await client.query(`
    SELECT r.appid, c.* FROM unnest($1::integer[]) r(appid)
    JOIN LATERAL (
      SELECT count(*)::integer AS samples, min(snapshot_time) AS window_start,
        max(snapshot_time) AS window_end, max(player_count) AS observed_peak,
        (array_agg(player_count ORDER BY snapshot_time DESC, id DESC))[1] AS current_players,
        (array_agg(player_count ORDER BY snapshot_time ASC, id ASC))[1] AS first_players
      FROM metrics.ccu_snapshots
      WHERE appid = r.appid AND snapshot_time >= $2::timestamptz
        AND snapshot_time < $3::timestamptz AND snapshot_time <= now()
        AND player_count >= 0
      HAVING count(*) > 0
    ) c ON true LIMIT 7218`, [ids, FESTIVAL_START, COLLECTION_END]);
  const clock = await client.query('SELECT clock_timestamp() AS now LIMIT 1');
  const rate = options.checkRate ? await client.query(`SELECT max_tokens, refill_rate_per_second
    FROM ops.api_rate_limit_state WHERE source = 'reviews' LIMIT 1`) : { rows: [] };
  // Serialize pg Dates exactly once, before validating observation timestamps.
  return JSON.parse(JSON.stringify({ source: 'tiger', checkedAt: clock.rows[0].now, errors: {}, queries: {
    roster_metrics: { rows: metrics.rows }, roster_ccu_window: { rows: ccu.rows },
    review_limiter: { rows: rate.rows },
  } }));
}

export async function readTigerEvidence(ids, options = {}) {
  if (!process.env.TIGER_PRIMARY_URL) throw new Error('TIGER_PRIMARY_URL must be set');
  const require = createRequire(path.join(ROOT, 'packages/database/package.json'));
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.TIGER_PRIMARY_URL,
    application_name: 'next-fest-export-readonly', connectionTimeoutMillis: 10000,
    options: '-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=2000' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
    const evidence = await readEvidence(client, ids, options);
    await client.query('ROLLBACK');
    return evidence;
  } finally { await client.end(); }
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[0];
  const output = args[1];
  const evidencePath = args[2];
  if (!input || !output || !evidencePath) {
    throw new Error('Usage: node scripts/ops/export-next-fest-popularity.mjs INPUT.html OUTPUT.html EVIDENCE.json|--read-tiger');
  }
  const html = await readFile(input, 'utf8');
  let evidence;
  if (evidencePath === '--read-tiger') {
    evidence = await readTigerEvidence(festivalDemoIds(decodeAtlas(html)));
  } else evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const enriched = enrichAtlas(html, evidence);
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, enriched, { flag: 'wx' });
  await rename(temporary, output);
  console.log(JSON.stringify({ output, bytes: Buffer.byteLength(enriched), exportedAt: evidence.checkedAt }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
