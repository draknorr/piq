#!/usr/bin/env node
// Temporary GitHub file-only collector. Reuses the migrated review API client.
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

export function parseJournal(text) {
  // A torn last write fails closed: never undercount attempts on resume.
  if (text && !text.endsWith('\n')) throw new Error('Incomplete journal; inspect before resuming');
  return text.trim() ? text.trim().split('\n').map(line => {
    const record = JSON.parse(line);
    if (!['attempt', 'result'].includes(record.kind) || !['reviews', 'ccu'].includes(record.signal ?? 'reviews') || !Number.isSafeInteger(record.appid)
      || record.appid <= 0 || !Number.isFinite(Date.parse(record.at))) throw new Error('Invalid journal record');
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
  onProgress = () => {} } = {}) {
  if (!apiKey?.trim()) throw new Error('STEAM_REVIEWS_API_KEY is required; never use the general key');
  const day = new Date(now()).toISOString().slice(0, 10);
  const deadline = now() + maxRuntimeMs;
  if (day < '2026-10-20' || day > '2026-11-02') throw new Error('Collection window has ended or not started');
  const matches = r => (r.signal ?? 'reviews') === signal;
  let attempts = 0;
  const completed = new Set(records.filter(r => r.kind === 'result' && matches(r) && r.at.slice(0, 10) === day).map(r => r.appid));
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
    if (signal === 'reviews' && !attemptsById.has(appid) && attemptsById.size >= 3609) break;
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
          if (counts.ccu + counts.reviews < ATTEMPT_CAP && counts[signal] < SIGNAL_CAPS[signal]) break;
          const oldest = counts[signal] >= SIGNAL_CAPS[signal]
            ? window.slice(cursor).find(matches) : window[cursor];
          const delay = Math.max(1, Date.parse(oldest.at) + DAY_MS + 1 - now());
          if (now() + delay >= deadline) { stopReason = 'rolling_budget_wait_exceeds_deadline'; throw new Error(stopReason); }
          await wait(Math.min(delay, 30000));
        }
        if (appAttempts > 0 && SIGNAL_CAPS[signal] - counts[signal] <= Math.min(limit - processed - 1, ids.length - completed.size - 1)) throw new Error('Reserve remaining attempts for roster coverage');
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

export function verifyDailySnapshot(html, records, day) {
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  const today = records.filter(r => r.at.startsWith(day));
  const results = new Map(today.filter(r => r.kind === 'result' && r.signal === 'ccu').map(r => [r.appid, r]));
  const attempts = records.filter(r => r.kind === 'attempt'
    && Date.parse(r.at) > Date.parse(data.popularity?.exportedAt) - DAY_MS);
  const signalCounts = Object.fromEntries(Object.keys(SIGNAL_CAPS).map(signal => [signal,
    attempts.filter(r => (r.signal ?? 'reviews') === signal).length]));
  const successful = [...results.values()].filter(r => r.status === 'success').length;
  if (attempts.length > ATTEMPT_CAP || Object.entries(SIGNAL_CAPS).some(([signal, cap]) => signalCounts[signal] > cap)
    || records.some(r => r.at > data.popularity?.exportedAt) || ids.some(id => !results.has(id)) || results.size !== ids.length
    || successful / ids.length < 0.95 || data.popularity?.exportedAt?.slice(0, 10) !== day) {
    throw new Error('Do not publish: roster coverage, success floor, date, or attempt cap failed');
  }
  for (const [id, r] of results) {
    const actual = data.popularity.demos[id]?.ccu;
    if (r.status === 'success' && (!actual || actual.observedAt !== r.at
      || actual.current !== r.summary.playerCount)) throw new Error('Published CCU differs from journal');
  }
  const reviewResults = new Map(today.filter(r => r.kind === 'result' && r.signal === 'reviews').map(r => [r.appid, r]));
  for (const [id, r] of reviewResults) {
    const actual = data.popularity.demos[id]?.review;
    if (r.status === 'success' && (!actual || actual.observedAt !== (r.observedAt ?? r.at)
      || actual.total !== r.summary.totalReviews || actual.positive !== r.summary.positiveReviews
      || actual.negative !== r.summary.negativeReviews)) throw new Error('Published review differs from journal');
  }
  return { attempts: attempts.length, successful, demos: ids.length };
}

export async function fetchCcuSummary(appid, options, previousPlayers = null) {
  const telemetry = { attempts: 0 };
  let errorCode = 'network_error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await options.beforeAttempt(); }
    catch { return { status: 'failed', errorCode, telemetry }; }
    telemetry.attempts++;
    try {
      const url = new URL('https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/');
      url.searchParams.set('appid', String(appid));
      if (attempt) url.searchParams.set('cb', String(Date.now()));
      const response = await options.fetchImpl(url, { headers: { 'x-webapi-key': options.apiKey },
        signal: AbortSignal.timeout(options.requestTimeoutMs) });
      if (!response.ok) {
        errorCode = `http_${response.status}`;
        if ([401, 403, 429].includes(response.status) || response.status < 500) {
          return { status: 'failed', statusCode: response.status, errorCode, telemetry };
        }
      } else {
        const body = await response.json();
        const count = body?.response?.player_count;
        if (body?.response?.result === 42) return { status: 'failed', errorCode: 'invalid_app', telemetry };
        if (body?.response?.result !== 1 || !Number.isSafeInteger(count) || count < 0) {
          return { status: 'failed', errorCode: 'invalid_response', telemetry };
        }
        if (count !== 0 || !(previousPlayers > 0) || attempt > 0) {
          return { status: 'success', summary: { playerCount: count }, telemetry };
        }
        errorCode = 'suspect_zero';
      }
    } catch { errorCode = errorCode === 'suspect_zero' ? errorCode : 'network_error'; }
    if (attempt === 0) await options.sleep(1000 + Math.floor(Math.random() * 500));
  }
  return { status: 'failed', errorCode, telemetry };
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
  if (args.some(arg => !['--collect', '--signal=ccu', '--signal=reviews'].includes(arg) && !/^--limit=\d+$/.test(arg))) throw new Error('Usage: collect-next-fest.mjs [--collect] [--signal=ccu|reviews] [--limit=N]');
  const signal = args.find(arg => arg.startsWith('--signal='))?.split('=')[1] ?? 'reviews';
  const html = await readFile(ATLAS, 'utf8');
  const data = decodeAtlas(html);
  const ids = festivalDemoIds(data);
  const limit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? (signal === 'ccu' ? ids.length : 3609));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > (signal === 'ccu' ? ids.length : 3609)) throw new Error('Invalid limit');
  if (!args.includes('--collect')) {
    console.log(JSON.stringify({ mode: 'plan', signal, demos: ids.length, selected: limit, primaryRequests: limit,
      combinedRollingAttemptCap: ATTEMPT_CAP, signalCaps: SIGNAL_CAPS, concurrency: 1,
      intervalMs: signal === 'ccu' ? 1000 : INTERVAL_MS, databaseWrites: 0,
      reviewKeyPresent: Boolean(process.env.STEAM_REVIEWS_API_KEY?.trim()) }, null, 2));
    return;
  }
  if (!process.env.STEAM_REVIEWS_API_KEY?.trim()) throw new Error('GitHub secret STEAM_REVIEWS_API_KEY is required');
  if (!process.env.GITHUB_RUN_ID) throw new Error('Collect through the GitHub workflow so every run shares the same journal and budget');
  await mkdir(DIRECTORY, { recursive: true });
  const lockPath = path.join(DIRECTORY, '.refresh.lock');
  const lock = await open(lockPath, 'wx');
  let journal;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const records = [];
    for (const name of (await readdir(DIRECTORY)).filter(n => /^2026-\d{2}-\d{2}\.journal\.jsonl$/.test(n)).sort()) {
      records.push(...parseJournal(await readFile(path.join(DIRECTORY, name), 'utf8')));
    }
    const roster = new Set(ids);
    if (records.some(r => !roster.has(r.appid) || Date.parse(r.at) > Date.now())) throw new Error('Journal does not match roster or clock');
    const today = new Date().toISOString().slice(0, 10);
    if (records.some(r => r.kind === 'result' && r.at.startsWith(today) && ['http_401', 'http_403', 'http_429'].includes(r.errorCode))) {
      throw new Error('Today’s lane is paused after an authorization/rate error; inspect it before a later run');
    }
    journal = await open(path.join(DIRECTORY, `${today}.journal.jsonl`), 'a');
    const append = async record => { await journal.writeFile(JSON.stringify(record) + '\n'); await journal.sync(); };
    const evidence = await readTigerEvidence(ids, { includeCcu: false, rateOnly: signal === 'reviews', checkRate: true });
    const rate = evidence.queries.review_limiter.rows[0];
    if (Number(rate?.max_tokens) !== 1 || Number(rate?.refill_rate_per_second) !== 1) {
      throw new Error('Regular review rate changed; reassess the shared key budget before collecting');
    }
    if (signal === 'ccu') {
      const completed = new Set(records.filter(r => r.kind === 'result' && r.signal === 'reviews' && r.at.startsWith(today)).map(r => r.appid));
      const checkedAt = new Date().toISOString();
      const reusable = new Map([...reusableReviews(evidence, checkedAt),
        ...reusableReviews(reviewEvidence(html, records, checkedAt), checkedAt, 'prior-snapshot')]
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(r => [r.appid, r]));
      for (const record of reusable.values()) {
        if (!completed.has(record.appid)) { await append(record); records.push(record); }
      }
    }
    const require = createRequire(path.join(ROOT, 'packages/ingestion/package.json'));
    const { tsImport } = await import(require.resolve('tsx/esm/api'));
    const { fetchReviewSummary } = await tsImport(path.join(ROOT, 'packages/ingestion/src/apis/reviews.ts'), import.meta.url);
    ids.sort((a, b) => (signal === 'ccu'
      ? (data.popularity?.demos?.[b]?.ccu?.current ?? 0) - (data.popularity?.demos?.[a]?.ccu?.current ?? 0)
      : (data.popularity?.demos?.[a]?.review?.observedAt ?? '').localeCompare(data.popularity?.demos?.[b]?.review?.observedAt ?? ''))
      || (data.popularity?.demos?.[b]?.review?.total ?? 0) - (data.popularity?.demos?.[a]?.review?.total ?? 0));
    const current = decodeAtlas(enrichAtlas(html, reviewEvidence(html, records, new Date().toISOString())));
    const result = await collectSignal({ ids, records, signal,
      fetchSummary: signal === 'reviews' ? fetchReviewSummary
        : (appid, options) => fetchCcuSummary(appid, options, current.popularity?.demos?.[appid]?.ccu?.current),
      append, apiKey: process.env.STEAM_REVIEWS_API_KEY, limit,
      onProgress: progress => console.log(JSON.stringify(progress)) });
    const enriched = enrichAtlas(html, reviewEvidence(html, records, new Date().toISOString()));
    const snapshot = path.join(DIRECTORY, `${today}.json`);
    await writeFile(snapshot + '.tmp', JSON.stringify({ version: 1,
      source: 'steam-festival-api', run: result, popularity: decodeAtlas(enriched).popularity }));
    await rename(snapshot + '.tmp', snapshot);
    const output = `${ATLAS}.${process.pid}.tmp`;
    await writeFile(output, enriched, { flag: 'wx' });
    await rename(output, ATLAS);
    console.log(JSON.stringify({ ...result, atlas: ATLAS, databaseWrites: 0 }, null, 2));
    if (result.stopReason) process.exitCode = 1;
  } finally { await journal?.close(); await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
