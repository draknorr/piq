import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult, QueryResultRow } from 'pg';

import { fetchRoutedGameCandidates } from './cohort.js';

function makeQueryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}

test('fetchRoutedGameCandidates reads Tiger source schemas when legacy apps exists', async () => {
  let candidateSql = '';
  const sourcePool = {
    query: async (sql: string) => {
      if (sql.includes("to_regclass('legacy.apps')")) {
        return makeQueryResult([{ has_tiger_legacy_apps: true }]);
      }

      candidateSql = sql;
      return makeQueryResult([
        {
          appid: 10,
          name: 'Counter-Strike',
          priority_score: 9,
          refresh_tier: 'hot',
          release_date: '2000-11-01',
          review_velocity_7d: 2,
          trend_change_30d_pct: 3,
        },
      ]);
    },
  } as unknown as Pool;
  const targetPool = {
    query: async () => makeQueryResult([]),
  } as unknown as Pool;

  const candidates = await fetchRoutedGameCandidates(sourcePool, targetPool, {
    cohortSize: 1,
    allowlistAppids: [],
  });

  assert.match(candidateSql, /FROM legacy\.apps a/);
  assert.match(candidateSql, /LEFT JOIN ops\.sync_status s/);
  assert.match(candidateSql, /LEFT JOIN metrics\.app_trends t/);
  assert.equal(candidates[0]?.appid, 10);
});

test('fetchRoutedGameCandidates keeps Supabase source schemas when legacy apps is absent', async () => {
  let candidateSql = '';
  const sourcePool = {
    query: async (sql: string) => {
      if (sql.includes("to_regclass('legacy.apps')")) {
        return makeQueryResult([{ has_tiger_legacy_apps: false }]);
      }

      candidateSql = sql;
      return makeQueryResult([]);
    },
  } as unknown as Pool;
  const targetPool = {
    query: async () => makeQueryResult([]),
  } as unknown as Pool;

  await fetchRoutedGameCandidates(sourcePool, targetPool, {
    cohortSize: 1,
    allowlistAppids: [],
  });

  assert.match(candidateSql, /FROM apps a/);
  assert.match(candidateSql, /LEFT JOIN sync_status s/);
  assert.match(candidateSql, /LEFT JOIN app_trends t/);
});
