#!/usr/bin/env node

const baseUrl = process.env.QUERY_API_BASE_URL ?? 'http://127.0.0.1:4318';
const token = process.env.QUERY_API_BEARER_TOKEN;

if (!token) {
  console.error('Missing QUERY_API_BEARER_TOKEN.');
  process.exit(1);
}

const MARKET_FORMATS = [null, 'standard_video', 'short', 'live_or_recent_live'];
const WINDOWS = ['1d', '7d', '30d'];
const MARKET_SORTS = ['steam_rank', 'youtube_velocity', 'new_videos', 'creator_breadth'];
const DRAWER_VIEWS = ['latest_videos', 'top_videos', 'video_growth'];
const DRAWER_LANGUAGES = ['en', null];

const drawerEntities = (process.env.YOUTUBE_BENCH_ENTITY_UIDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function postContract(path, body) {
  const started = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  await response.arrayBuffer();
  return {
    ms: performance.now() - started,
    status: response.status,
  };
}

async function runMarketBench() {
  const rows = [];
  for (const contentClass of MARKET_FORMATS) {
    for (const window of WINDOWS) {
      for (const sort of MARKET_SORTS) {
        const body = {
          ...(contentClass ? { contentClass } : {}),
          limit: Number(process.env.YOUTUBE_BENCH_MARKET_LIMIT ?? 25),
          sort,
          window,
        };
        const result = await postContract('/v1/contracts/get-youtube-market-pulse', body);
        rows.push({
          contentClass: contentClass ?? 'all',
          ms: result.ms,
          sort,
          status: result.status,
          window,
        });
      }
    }
  }
  return rows;
}

async function runDrawerBench() {
  const rows = [];
  for (const entityUid of drawerEntities) {
    for (const view of DRAWER_VIEWS) {
      for (const language of DRAWER_LANGUAGES) {
        for (const contentClass of MARKET_FORMATS) {
          const body = {
            ...(contentClass ? { contentClass } : {}),
            entityUid,
            language,
            limit: 25,
            offset: 0,
            view,
            window: '7d',
          };
          const result = await postContract('/v1/contracts/get-youtube-game-coverage', body);
          rows.push({
            contentClass: contentClass ?? 'all',
            entityUid,
            language: language ?? 'all',
            ms: result.ms,
            status: result.status,
            view,
          });
        }
      }
    }
  }
  return rows;
}

function printSummary(label, rows) {
  const timings = rows.map((row) => row.ms);
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 8);
  console.log(`\n${label}`);
  console.table({
    count: rows.length,
    p50_ms: Math.round(percentile(timings, 50)),
    p95_ms: Math.round(percentile(timings, 95)),
    max_ms: Math.round(Math.max(...timings, 0)),
  });
  console.table(worst.map((row) => ({ ...row, ms: Math.round(row.ms) })));
}

const marketRows = await runMarketBench();
printSummary('YouTube market pulse', marketRows);

if (drawerEntities.length > 0) {
  const drawerRows = await runDrawerBench();
  printSummary('YouTube drawer coverage', drawerRows);
} else {
  console.log('\nSkipping drawer coverage; set YOUTUBE_BENCH_ENTITY_UIDS=uid1,uid2.');
}
