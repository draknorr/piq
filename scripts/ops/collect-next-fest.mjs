#!/usr/bin/env node
// Temporary roster/schedule adapter over the shared Steam clients and Tiger writers.
import { open, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeAtlas, enrichAtlas, festivalDemoIds, readTigerEvidence } from './export-next-fest-popularity.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ATLAS = path.join(ROOT, 'apps/admin/src/app/next-fest/content/atlas.html');
const DIRECTORY = path.join(ROOT, 'output/steam-next-fest-2026-10/daily');
export const ATTEMPT_CAP = 12000; // Both signals combined, in every rolling 24 hours.
export const SIGNAL_CAPS = { ccu: 8000, reviews: 4000 };
export const INTERVAL_MS = 4000;
const DAY_MS = 86400000;
// Reuse through the intervening daily run, but renew on the second run even
// when GitHub starts a little earlier. A 48h cutoff could slip into day three.
const REUSE_MS = 36 * 3600000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Operator-approved, fixed-roster catch-up. Regular collection keeps its limits.
export const REVIEW_CATCH_UP_DAY = '2026-10-21';
const REVIEW_CATCH_UP_LIMIT = 2470;
const REVIEW_CATCH_UP_CUTOFF = '2026-10-20T02:05:14.977Z';

export function festivalLimits(day, reviewCatchUp = false) {
  if (reviewCatchUp && day !== REVIEW_CATCH_UP_DAY) throw new Error('Review catch-up has expired or not started');
  return reviewCatchUp
    ? { attemptCap: 13500, signalCaps: { ...SIGNAL_CAPS, reviews: 6300 }, reviewDemoCap: 3609 + REVIEW_CATCH_UP_LIMIT }
    : { attemptCap: ATTEMPT_CAP, signalCaps: SIGNAL_CAPS, reviewDemoCap: 3609 };
}

export function selectReviewCatchUpIds(ids, manifest) {
  const targets = manifest?.appids;
  if (manifest?.day !== REVIEW_CATCH_UP_DAY || manifest?.observedBefore !== REVIEW_CATCH_UP_CUTOFF
    || !Array.isArray(targets) || targets.length !== REVIEW_CATCH_UP_LIMIT || new Set(targets).size !== targets.length
    || targets.some(id => !Number.isSafeInteger(id) || !ids.includes(id))) throw new Error('Invalid approved review catch-up roster');
  const selected = new Set(targets);
  return ids.filter(id => selected.has(id));
}

function completedForDay(records, signal, day, catchUpIds = null) {
  return new Set(records.filter(r => r.kind === 'result' && (r.signal ?? 'reviews') === signal && r.at.startsWith(day)
    // Twenty-five approved targets were reused earlier today but have since
    // become stale. Keep those records; only a newer result completes them.
    && !(catchUpIds?.has(r.appid) && r.attempts === 0 && (r.observedAt ?? r.at) < REVIEW_CATCH_UP_CUTOFF))
    .map(r => r.appid));
}

export function parseJournal(text) {
  // A torn last write fails closed: never undercount attempts on resume.
  if (text && !text.endsWith('\n')) throw new Error('Incomplete journal; inspect before resuming');
  return text.trim() ? text.trim().split('\n').map(line => {
    const record = JSON.parse(line);
    if (!['attempt', 'result', 'persisted'].includes(record.kind) || !['reviews', 'ccu'].includes(record.signal ?? 'reviews') || !Number.isSafeInteger(record.appid)
      || record.appid <= 0 || !Number.isFinite(Date.parse(record.at))) throw new Error('Invalid journal record');
    if (record.kind === 'result') {
      if (!['success', 'failed'].includes(record.status)) throw new Error('Invalid result status');
      if (record.observedAt && (!Number.isFinite(Date.parse(record.observedAt))
        || Date.parse(record.observedAt) > Date.parse(record.at))) throw new Error('Invalid source observation timestamp');
      if (record.status === 'success') {
        const values = record.signal === 'ccu' ? [record.summary?.playerCount]
          : [record.summary?.totalReviews, record.summary?.positiveReviews, record.summary?.negativeReviews];
        if (!values.every(n => Number.isSafeInteger(n) && n >= 0)
          || (record.signal !== 'ccu' && values[0] !== values[1] + values[2])) throw new Error('Invalid journal counts');
      }
    }
    return record;
  }) : [];
}

export function reviewEvidence(html, records, checkedAt) {
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  const rows = new Map(ids.map(appid => {
    const p = data.popularity?.demos?.[appid];
    return [appid, { appid, total_reviews: p?.review?.total, positive_reviews: p?.review?.positive,
      negative_reviews: p?.review?.negative, last_reviews_sync: p?.review?.observedAt,
      last_error_source: p?.failedReviewAt ? 'reviews' : null, last_error_at: p?.failedReviewAt,
      last_ccu_validation_at: p?.ccuLastAttemptAt, last_ccu_validation_state: p?.ccuLastAttemptState }];
  }));
  const ccu = new Map();
  for (const record of records.filter(r => r.kind === 'result').sort((a, b) => a.at.localeCompare(b.at))) {
    const row = rows.get(record.appid);
    if (!row || record.at > checkedAt) throw new Error('Journal does not match roster or clock');
    if (record.signal === 'ccu') {
      row.last_ccu_validation_at = record.at;
      if (record.status !== 'success') {
        row.last_ccu_validation_state = record.errorCode === 'invalid_app' ? 'invalid' : 'error';
        continue;
      }
      const count = record.summary?.playerCount;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid CCU journal count');
      row.last_ccu_validation_state = count === 0 ? 'confirmed_zero' : 'confirmed_positive';
      const previous = ccu.get(record.appid);
      ccu.set(record.appid, { appid: record.appid, current_players: count,
        observed_peak: Math.max(previous?.observed_peak ?? count, count), first_players: previous?.first_players ?? count,
        samples: (previous?.samples ?? 0) + 1, window_start: previous?.window_start ?? record.at, window_end: record.at });
      continue;
    }
    if (record.status === 'success') {
      if (!record.summary || ![record.summary.totalReviews, record.summary.positiveReviews, record.summary.negativeReviews]
        .every(n => Number.isSafeInteger(n) && n >= 0)
        || record.summary.totalReviews !== record.summary.positiveReviews + record.summary.negativeReviews) {
        throw new Error('Invalid journal review counts');
      }
      const observedAt = record.observedAt ?? record.at;
      if (!Number.isFinite(Date.parse(observedAt)) || observedAt > record.at) throw new Error('Invalid source observation timestamp');
      const baseline = { total: record.summary.totalReviews, positive: record.summary.positiveReviews,
        negative: record.summary.negativeReviews, observedAt };
      if (observedAt >= '2026-10-19T17:00:00.000Z' && (!row.review_baseline || observedAt < row.review_baseline.observedAt)) row.review_baseline = baseline;
      if (!row.last_reviews_sync || observedAt > row.last_reviews_sync) Object.assign(row, {
        total_reviews: record.summary.totalReviews, positive_reviews: record.summary.positiveReviews,
        negative_reviews: record.summary.negativeReviews, last_reviews_sync: observedAt });
    } else if (record.status === 'failed') {
      if (!row.last_error_at || record.at > row.last_error_at) {
        row.last_error_source = 'reviews'; row.last_error_at = record.at;
      }
    } else throw new Error('Invalid journal result status');
  }
  return { checkedAt, errors: {}, queries: { roster_metrics: { rows: [...rows.values()] }, roster_ccu_window: { rows: [...ccu.values()] } } };
}

export async function collectSignal({ ids, records, fetchSummary, append, apiKey, signal = 'reviews',
  now = Date.now, wait = sleep, fetchImpl = fetch, intervalMs = signal === 'ccu' ? 1000 : INTERVAL_MS,
  limit = signal === 'ccu' ? ids.length : Math.min(3609, ids.length), maxRuntimeMs = 300 * 60000,
  onProgress = () => {}, onResult = async () => {}, reviewCatchUp = false } = {}) {
  if (!apiKey?.trim()) throw new Error('STEAM_REVIEWS_API_KEY is required; never use the general key');
  const day = new Date(now()).toISOString().slice(0, 10);
  const deadline = now() + maxRuntimeMs;
  if (day < '2026-10-20' || day > '2026-11-02') throw new Error('Collection window has ended or not started');
  const limits = festivalLimits(day, reviewCatchUp);
  if (reviewCatchUp && (signal !== 'reviews' || ids.length > REVIEW_CATCH_UP_LIMIT)) throw new Error('Catch-up is limited to the approved review roster');
  const matches = r => (r.signal ?? 'reviews') === signal;
  let attempts = 0;
  const completed = completedForDay(records, signal, day, reviewCatchUp ? new Set(ids) : null);
  const window = records.filter(r => r.kind === 'attempt' && Date.parse(r.at) > now() - DAY_MS).sort((a, b) => a.at.localeCompare(b.at));
  const counts = { reviews: 0, ccu: 0 };
  for (const r of window) counts[r.signal ?? 'reviews']++;
  let cursor = 0;
  const attemptsById = new Map();
  let lastAttempt = 0;
  for (const r of records.filter(r => r.kind === 'attempt' && matches(r))) {
    lastAttempt = Math.max(lastAttempt, Date.parse(r.at));
    if (r.at.slice(0, 10) === day) attemptsById.set(r.appid, (attemptsById.get(r.appid) ?? 0) + 1);
  }
  let processed = 0, failures = 0, stopReason = null;
  for (const appid of ids) {
    if (completed.has(appid)) continue;
    if (processed >= limit || stopReason) break;
    if (signal === 'reviews' && !attemptsById.has(appid) && attemptsById.size >= limits.reviewDemoCap) break;
    // Retries cannot take the primary request reserved for another demo.
    let appAttempts = attemptsById.get(appid) ?? 0;
    const result = await fetchSummary(appid, { apiKey, limiter: { acquire: async () => {} },
      requestTimeoutMs: 15000,
      sleep: ms => stopReason ? Promise.resolve() : wait(ms),
      beforeAttempt: async () => {
        if (stopReason) throw new Error(stopReason);
        if (now() >= deadline) { stopReason = 'runtime_deadline'; throw new Error(stopReason); }
        if (appAttempts >= 2) throw new Error('Per-demo attempt cap');
        while (true) {
          while (cursor < window.length && Date.parse(window[cursor].at) <= now() - DAY_MS) {
            counts[window[cursor++].signal ?? 'reviews']--;
          }
          if (counts.ccu + counts.reviews < limits.attemptCap && counts[signal] < limits.signalCaps[signal]) break;
          const oldest = counts[signal] >= limits.signalCaps[signal]
            ? window.slice(cursor).find(matches) : window[cursor];
          const delay = Math.max(1, Date.parse(oldest.at) + DAY_MS + 1 - now());
          if (now() + delay >= deadline) { stopReason = 'rolling_budget_wait_exceeds_deadline'; throw new Error(stopReason); }
          await wait(Math.min(delay, 30000));
        }
        const remainingBudget = Math.min(limits.signalCaps[signal] - counts[signal], limits.attemptCap - counts.ccu - counts.reviews);
        if (appAttempts > 0 && remainingBudget <= Math.min(limit - processed - 1,
          ids.filter(id => !completed.has(id)).length - 1)) throw new Error('Reserve remaining attempts for roster coverage');
        await wait(Math.max(0, intervalMs - (now() - lastAttempt)));
        if (now() >= deadline) { stopReason = 'runtime_deadline'; throw new Error(stopReason); }
        if (new Date(now()).toISOString().slice(0, 10) !== day) { stopReason = 'UTC_day_changed'; throw new Error(stopReason); }
        lastAttempt = now();
        const reservation = { kind: 'attempt', signal, appid, at: new Date(lastAttempt).toISOString() };
        try { await append(reservation); }
        catch { stopReason = 'journal_write_failed'; throw new Error(stopReason); }
        records.push(reservation); window.push(reservation); counts[signal]++;
        attempts++; appAttempts++;
        attemptsById.set(appid, appAttempts);
      },
      // The existing client handles bounded jittered backoff and timeouts.
      // Stop the entire lane on its first 403/429, including Retry-After.
      fetchImpl: async (url, init) => {
        // Redirects would issue an unreserved second request.
        const response = await fetchImpl(url, { ...init, redirect: 'error' });
        if ([401, 403, 429].includes(response.status)) stopReason = `http_${response.status}`;
        return response;
      },
    });
    if (result.telemetry.attempts > 0) {
      const record = { kind: 'result', signal, appid, at: new Date(now()).toISOString(), status: result.status,
        ...(result.status === 'success' ? { summary: result.summary } : { errorCode: stopReason?.startsWith('http_') ? stopReason : result.errorCode }),
        attempts: result.telemetry.attempts };
      await append(record);
      records.push(record);
      await onResult(record);
      processed++;
      completed.add(appid);
      if (processed % 100 === 0) onProgress({ signal, processed, attempts, rollingAttempts: counts.ccu + counts.reviews });
      failures = result.status === 'failed' && result.errorCode !== 'invalid_app' ? failures + 1 : 0;
      if ([401, 403, 429].includes(result.statusCode)) stopReason = `http_${result.statusCode}`;
      if (failures >= 5) stopReason = 'five_consecutive_failures';
    }
    if (appAttempts >= 2 && result.telemetry.attempts === 0) completed.add(appid);
  }
  return { signal, processed, attempts, stopReason, finishedForToday: completed.size,
    rollingAttempts: counts.ccu + counts.reviews };
}

const resultKey = r => `${r.signal ?? 'reviews'}:${r.appid}:${r.at}`;

export async function persistResults(tiger, records, append, signal, limit = Infinity) {
  const committed = new Set(records.filter(r => r.kind === 'persisted').map(resultKey));
  const pending = records.filter(r => r.kind === 'result' && (r.signal ?? 'reviews') === signal
    && !committed.has(resultKey(r)));
  const selected = pending.slice(0, limit);
  for (let offset = 0; offset < selected.length; offset += 25) {
    const batch = selected.slice(offset, offset + 25);
    if (signal === 'reviews') {
      await tiger.reviews.persistReviewObservations(batch.map(r => ({ appid: r.appid,
        observedAt: r.observedAt ?? r.at, status: r.status,
        ...(r.status === 'success' ? { summary: { ...r.summary,
          reviewScore: r.summary.reviewScore ?? null, reviewScoreDesc: r.summary.reviewScoreDesc ?? null } }
          : { errorCode: r.errorCode ?? 'unknown_error' }) })));
    } else {
      if (batch.some(r => r.status === 'success' && (!Number.isSafeInteger(r.summary?.playerCount) || r.summary.playerCount < 0))) throw new Error('Invalid CCU count');
      const snapshots = batch.filter(r => r.status === 'success' && r.source !== 'tiger').map(r => ({
        appid: r.appid, snapshot_time: r.observedAt ?? r.at, player_count: r.summary.playerCount, ccu_tier: 2,
      }));
      await tiger.metrics.insertCcuSnapshots(snapshots);
      const peaks = new Map();
      for (const r of snapshots) {
        const key = `${r.appid}:${r.snapshot_time.slice(0, 10)}`;
        const previous = peaks.get(key);
        if (!previous || previous.ccu_peak < r.player_count) peaks.set(key, {
          appid: r.appid, metric_date: r.snapshot_time.slice(0, 10), ccu_peak: r.player_count, ccu_source: 'steam_api',
        });
      }
      await tiger.metrics.upsertDailyCcuPeaks([...peaks.values()]);
      await tiger.metrics.checkpointDemoCcuValidation(batch.filter(r => r.source !== 'tiger').map(r => ({ appid: r.appid,
        observed_at: r.observedAt ?? r.at, invalid_skip_until: new Date(Date.parse(r.at) + 30 * DAY_MS).toISOString(),
        validation_state: r.status === 'success' ? (r.summary.playerCount === 0 ? 'confirmed_zero' : 'confirmed_positive')
          : r.errorCode === 'invalid_app' ? 'invalid' : r.errorCode === 'suspect_zero' ? 'suspect_zero' : 'error',
      })));
    }
    // Commit acknowledgements follow successful writes. A crash before these
    // acknowledgements replays the same source timestamps idempotently.
    for (const r of batch) {
      const receipt = { kind: 'persisted', signal, appid: r.appid, at: r.at };
      await append(receipt); records.push(receipt);
    }
  }
  return { persisted: selected.length, pending: pending.length - selected.length };
}

export function reusableCcu(evidence, now) {
  const states = new Map(evidence.queries.roster_metrics.rows.map(r => [r.appid, r]));
  // Under 20h prevents a nominally daily pass slipping into an alternate-day
  // cadence when GitHub starts a little earlier than yesterday.
  return evidence.queries.roster_ccu_window.rows.filter(r => Number.isSafeInteger(r.current_players)
    && r.current_players >= 0 && Date.parse(r.window_end) >= Date.parse(now) - 20 * 3600000
    && r.window_end <= now && !(states.get(r.appid)?.last_ccu_validation_at > r.window_end
      && ['error', 'invalid', 'suspect_zero'].includes(states.get(r.appid)?.last_ccu_validation_state)))
    .map(r => ({ kind: 'result', signal: 'ccu', source: 'tiger', appid: r.appid, at: now,
      observedAt: r.window_end, status: 'success', attempts: 0, summary: { playerCount: r.current_players } }));
}

export function verifyDailySnapshot(html, records, day, { reviewCatchUp = false } = {}) {
  const limits = festivalLimits(day, reviewCatchUp);
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  const today = records.filter(r => r.at.startsWith(day));
  const results = new Map(today.filter(r => r.kind === 'result' && r.signal === 'ccu').map(r => [r.appid, r]));
  const attempts = records.filter(r => r.kind === 'attempt'
    && Date.parse(r.at) > Date.parse(data.popularity?.exportedAt) - DAY_MS);
  const signalCounts = Object.fromEntries(Object.keys(SIGNAL_CAPS).map(signal => [signal,
    attempts.filter(r => (r.signal ?? 'reviews') === signal).length]));
  const committed = new Set(records.filter(r => r.kind === 'persisted').map(resultKey));
  if (data.popularity?.source === 'tiger' && records.some(r => r.kind === 'result' && !committed.has(resultKey(r)))) {
    throw new Error('Do not publish: uncommitted observations remain in the journal');
  }
  const successful = [...results.values()].filter(r => r.status === 'success').length;
  if (attempts.length > limits.attemptCap || Object.entries(limits.signalCaps).some(([signal, cap]) => signalCounts[signal] > cap)
    || records.some(r => r.at > data.popularity?.exportedAt) || ids.some(id => !results.has(id)) || results.size !== ids.length
    || successful / ids.length < 0.95 || data.popularity?.exportedAt?.slice(0, 10) !== day) {
    throw new Error('Do not publish: roster coverage, success floor, date, or attempt cap failed');
  }
  for (const [id, r] of results) {
    const actual = data.popularity.demos[id]?.ccu;
    if (r.status === 'success' && (!actual || typeof actual.observedAt !== 'string' || actual.observedAt < (r.observedAt ?? r.at)
      || (actual.observedAt === (r.observedAt ?? r.at) && actual.current !== r.summary.playerCount))) throw new Error('Published CCU differs from journal');
  }
  const reviewResults = new Map(today.filter(r => r.kind === 'result' && r.signal === 'reviews').map(r => [r.appid, r]));
  for (const [id, r] of reviewResults) {
    const actual = data.popularity.demos[id]?.review;
    if (r.status === 'success' && (!actual || typeof actual.observedAt !== 'string' || actual.observedAt < (r.observedAt ?? r.at)
      || (actual.observedAt === (r.observedAt ?? r.at) && (actual.total !== r.summary.totalReviews || actual.positive !== r.summary.positiveReviews
      || actual.negative !== r.summary.negativeReviews)))) throw new Error('Published review differs from journal');
  }
  return { attempts: attempts.length, successful, demos: ids.length };
}

export async function fetchCcuSummary(...args) {
  const { fetchDemoCcuSummary } = await ingestionClients();
  return fetchDemoCcuSummary(...args);
}

async function ingestionClients() {
  const require = createRequire(path.join(ROOT, 'packages/ingestion/package.json'));
  const { tsImport } = await import(require.resolve('tsx/esm/api'));
  const reviews = await tsImport(path.join(ROOT, 'packages/ingestion/src/apis/reviews.ts'), import.meta.url);
  const ccu = await tsImport(path.join(ROOT, 'packages/ingestion/src/apis/steam-ccu.ts'), import.meta.url);
  return { ...reviews, ...ccu };
}

export function reusableReviews(evidence, now, source = 'tiger') {
  const cutoff = Date.parse(now) - REUSE_MS;
  return (evidence.queries.roster_metrics.rows ?? []).filter(row =>
    [row.total_reviews, row.positive_reviews, row.negative_reviews].every(n => Number.isSafeInteger(n) && n >= 0)
    && row.total_reviews === row.positive_reviews + row.negative_reviews
    && Date.parse(row.last_reviews_sync) >= cutoff && row.last_reviews_sync <= now
    && !(row.last_error_source === 'reviews' && row.last_error_at > row.last_reviews_sync))
    .map(row => ({ kind: 'result', signal: 'reviews', appid: row.appid, at: now,
      observedAt: row.last_reviews_sync, status: 'success', source, attempts: 0,
      summary: { totalReviews: row.total_reviews, positiveReviews: row.positive_reviews, negativeReviews: row.negative_reviews } }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--collect', '--replay-only', '--signal=ccu', '--signal=reviews', '--review-catch-up'].includes(arg) && !/^--limit=\d+$/.test(arg))) throw new Error('Usage: collect-next-fest.mjs [--collect|--replay-only] [--signal=ccu|reviews] [--limit=N] [--review-catch-up]');
  const signal = args.find(arg => arg.startsWith('--signal='))?.split('=')[1] ?? 'reviews';
  const reviewCatchUp = args.includes('--review-catch-up');
  const limits = festivalLimits(new Date().toISOString().slice(0, 10), reviewCatchUp);
  if (reviewCatchUp && (signal !== 'reviews' || args.includes('--replay-only'))) throw new Error('Catch-up is reviews-only collection');
  if (reviewCatchUp && args.includes('--collect') && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Review catch-up requires an explicit manual workflow dispatch');
  }
  const html = await readFile(ATLAS, 'utf8');
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  const limit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? (signal === 'ccu' ? ids.length : 3609));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > (signal === 'ccu' ? ids.length : 3609)) throw new Error('Invalid limit');
  if (reviewCatchUp && limit !== 3609) throw new Error('Review catch-up requires the full workflow batch');
  const catchUpManifest = reviewCatchUp
    ? JSON.parse(await readFile(path.join(ROOT, 'scripts/ops/next-fest-review-catch-up.json'), 'utf8')) : null;
  const catchUpIds = reviewCatchUp ? new Set(selectReviewCatchUpIds(ids, catchUpManifest)) : null;
  if (!args.includes('--collect') && !args.includes('--replay-only')) {
    console.log(JSON.stringify({ mode: 'plan', signal, demos: ids.length, selected: catchUpIds?.size ?? limit, primaryRequests: catchUpIds?.size ?? limit,
      combinedRollingAttemptCap: limits.attemptCap, signalCaps: limits.signalCaps, concurrency: 1,
      intervalMs: signal === 'ccu' ? 1000 : INTERVAL_MS, databaseWrites: 'up to 25 observations per checkpoint; replay before collection',
      reviewKeyPresent: Boolean(process.env.STEAM_REVIEWS_API_KEY?.trim()) }, null, 2));
    return;
  }
  if (!args.includes('--replay-only') && !process.env.STEAM_REVIEWS_API_KEY?.trim()) throw new Error('GitHub secret STEAM_REVIEWS_API_KEY is required');
  if (process.env.ENABLE_NEXT_FEST_TIGER_WRITES !== 'true') throw new Error('Tiger writes require the separately approved activation gate');
  if (!process.env.TIGER_PRIMARY_URL) throw new Error('TIGER_PRIMARY_URL is required');
  if (!process.env.GITHUB_RUN_ID) throw new Error('Collect through the GitHub workflow so every run shares the same journal and budget');
  await mkdir(DIRECTORY, { recursive: true });
  const lockPath = path.join(DIRECTORY, '.refresh.lock');
  const lock = await open(lockPath, 'wx');
  let journal;
  let pool;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const records = [];
    for (const name of (await readdir(DIRECTORY)).filter(n => /^2026-\d{2}-\d{2}\.journal\.jsonl$/.test(n)).sort()) {
      records.push(...parseJournal(await readFile(path.join(DIRECTORY, name), 'utf8')));
    }
    const roster = new Set(ids);
    if (records.some(r => !roster.has(r.appid) || Date.parse(r.at) > Date.now())) throw new Error('Journal does not match roster or clock');
    const today = new Date().toISOString().slice(0, 10);
    if (today < '2026-10-20' || today > '2026-11-02') throw new Error('Next Fest collection window is closed');
    if (!args.includes('--replay-only') && records.some(r => r.kind === 'result' && r.at.startsWith(today) && ['http_401', 'http_403', 'http_429'].includes(r.errorCode))) {
      throw new Error('Today’s lane is paused after an authorization/rate error; inspect it before a later run');
    }
    journal = await open(path.join(DIRECTORY, `${today}.journal.jsonl`), 'a');
    const append = async record => { await journal.writeFile(JSON.stringify(record) + '\n'); await journal.sync(); };
    const require = createRequire(path.join(ROOT, 'packages/database/package.json'));
    const { Pool } = require('pg');
    const { createTigerWriterForPool } = await import(pathToFileURL(path.join(ROOT, 'packages/database/dist/tiger-writer.js')));
    pool = new Pool({ connectionString: process.env.TIGER_PRIMARY_URL, max: 1, connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000, application_name: 'next-fest-tiger',
      options: '-c statement_timeout=8000 -c lock_timeout=2000' });
    const surface = await pool.query(`SELECT i.relname AS indexname FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE n.nspname = 'docs' AND i.relname = 'idx_app_source_snapshots_review_observation'
        AND x.indisvalid AND x.indisready AND x.indisunique LIMIT 1`);
    if (surface.rows.length !== 1) throw new Error('Approved review snapshot migration must be applied before any festival writes');
    const tiger = createTigerWriterForPool(pool);
    // Retain pre-cutover review baselines with their source times. They are
    // staged in the existing journal until acknowledged by Tiger.
    const known = new Set(records.filter(r => r.kind === 'result' && (r.signal ?? 'reviews') === 'reviews')
      .map(r => `${r.appid}:${r.observedAt ?? r.at}`));
    for (const appid of ids) for (const review of [data.popularity?.demos?.[appid]?.reviewBaseline, data.popularity?.demos?.[appid]?.review]) {
      if (!review?.observedAt || ![review.total, review.positive, review.negative].every(n => Number.isSafeInteger(n) && n >= 0)
        || review.total !== review.positive + review.negative || known.has(`${appid}:${review.observedAt}`)) continue;
      const r = { kind: 'result', signal: 'reviews', appid, at: review.observedAt, observedAt: review.observedAt,
        status: 'success', source: 'cutover-snapshot', attempts: 0,
        summary: { totalReviews: review.total, positiveReviews: review.positive, negativeReviews: review.negative } };
      await append(r); records.push(r); known.add(`${appid}:${review.observedAt}`);
    }
    const replay = await persistResults(tiger, records, append, signal, limit);
    if (args.includes('--replay-only') || replay.pending) {
      console.log(JSON.stringify({ mode: 'replay', signal, ...replay, steamRequests: 0 }));
      if (replay.pending && !args.includes('--replay-only')) process.exitCode = 1;
      return;
    }
    const evidence = await readTigerEvidence(ids, { checkRate: true });
    const rate = evidence.queries.review_limiter.rows[0];
    if (Number(rate?.max_tokens) !== 1 || Number(rate?.refill_rate_per_second) !== 1) {
      throw new Error('Regular review rate changed; reassess the shared key budget before collecting');
    }
    const current = decodeAtlas(enrichAtlas(html, evidence));
    const { fetchReviewSummary, fetchDemoCcuSummary } = await ingestionClients();
    ids.sort((a, b) => (signal === 'ccu'
      ? (current.popularity?.demos?.[b]?.ccu?.current ?? 0) - (current.popularity?.demos?.[a]?.ccu?.current ?? 0)
      : (current.popularity?.demos?.[a]?.review?.observedAt ?? '').localeCompare(current.popularity?.demos?.[b]?.review?.observedAt ?? '')) || a - b);
    const collectionIds = reviewCatchUp ? ids.filter(id => catchUpIds.has(id))
      : limit < (signal === 'ccu' ? ids.length : 3609) ? ids.slice(0, limit) : ids;
    const selectedIds = new Set(collectionIds);
    const completed = completedForDay(records, signal, today, catchUpIds);
    const reusable = signal === 'ccu' ? reusableCcu(evidence, evidence.checkedAt) : reusableReviews(evidence, evidence.checkedAt);
    for (const record of reusable) {
      if (selectedIds.has(record.appid) && !completed.has(record.appid)) { await append(record); records.push(record); }
    }
    await persistResults(tiger, records, append, signal);
    let checkpointSize = 0;
    const result = await collectSignal({ ids: collectionIds, records, signal, reviewCatchUp,
      fetchSummary: signal === 'reviews' ? fetchReviewSummary
        : (appid, options) => fetchDemoCcuSummary(appid, options, current.popularity?.demos?.[appid]?.ccu?.current),
      append, apiKey: process.env.STEAM_REVIEWS_API_KEY, limit,
      onProgress: progress => console.log(JSON.stringify(progress)),
      onResult: async () => {
        if (++checkpointSize >= 25) { await persistResults(tiger, records, append, signal); checkpointSize = 0; }
      } });
    await persistResults(tiger, records, append, signal);
    const enriched = enrichAtlas(html, await readTigerEvidence(ids));
    const snapshot = path.join(DIRECTORY, `${today}.json`);
    await writeFile(snapshot + '.tmp', JSON.stringify({ version: 1,
      source: 'tiger', run: result, popularity: decodeAtlas(enriched).popularity }));
    await rename(snapshot + '.tmp', snapshot);
    const output = `${ATLAS}.${process.pid}.tmp`;
    await writeFile(output, enriched, { flag: 'wx' });
    await rename(output, ATLAS);
    console.log(JSON.stringify({ ...result, atlas: ATLAS, databaseSource: 'tiger' }, null, 2));
    if (result.stopReason) process.exitCode = 1;
  } finally { await pool?.end(); await journal?.close(); await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
