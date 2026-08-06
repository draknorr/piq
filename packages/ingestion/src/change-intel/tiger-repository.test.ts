import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { TigerChangeIntelRepository } from './tiger-repository.js';

test('Storefront tag daily budget reserves the full claimed batch', async () => {
  let sql = '';
  const pool = {
    query: async (text: string) => {
      sql = text;
      return { rows: [{ count: '5' }] };
    },
  } as unknown as Pool;

  const count = await new TigerChangeIntelRepository(pool).countStorefrontTagAttemptsSince(
    '2026-07-31T00:00:00.000Z'
  );

  assert.equal(count, 5);
  assert.match(sql, /greatest\(COALESCE\(items_processed, 0\), COALESCE\(batch_size, 0\)\)/);
});

test('Storefront traffic pressure includes queue age as well as running sweeps', async () => {
  const pool = {
    query: async () => ({
      rows: [
        {
          oldest_dirty_at: '2026-07-31T19:00:00.000Z',
          queued: '12',
          running_sweeps: '0',
        },
      ],
    }),
  } as unknown as Pool;

  const pressure = await new TigerChangeIntelRepository(pool).inspectStorefrontTrafficPressure({
    freshSweepAfterIso: '2026-07-31T20:00:00.000Z',
    oldestQueueBeforeIso: '2026-07-31T20:30:00.000Z',
    queueCountThreshold: 50,
  });

  assert.deepEqual(pressure, {
    active: true,
    oldestDirtyAt: '2026-07-31T19:00:00.000Z',
    queued: 12,
    runningSweeps: 0,
  });
});

test('Storefront tag evidence wakes pending opportunity classification immediately', async () => {
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return sql.includes('upsert_storefront_tag_evidence_v1')
        ? { rows: [{ count: '2' }] }
        : { rows: [] };
    },
  } as unknown as Pool;

  const count = await new TigerChangeIntelRepository(pool).upsertStorefrontTagEvidence([
    {
      appid: 20,
      country: 'us',
      locale: 'english',
      observedAt: '2026-08-06T12:00:00.000Z',
      pageUrl: 'https://store.steampowered.com/app/20/?l=english&cc=us',
      parserVersion: 'steam-store-page-tags/v1',
      responseHash: 'a'.repeat(64),
      tags: [{ count: 5, name: 'Strategy', rank: 1, tagid: 9 }],
    },
    {
      appid: 10,
      country: 'us',
      locale: 'english',
      observedAt: '2026-08-06T12:00:00.000Z',
      pageUrl: 'https://store.steampowered.com/app/10/?l=english&cc=us',
      parserVersion: 'steam-store-page-tags/v1',
      responseHash: 'b'.repeat(64),
      tags: [],
    },
  ]);

  assert.equal(count, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[1]?.sql ?? '', /INSERT INTO opportunity\.work_queue/);
  assert.match(queries[1]?.sql ?? '', /classification-ready:storefront-tags:v1/);
  assert.match(queries[1]?.sql ?? '', /'content_descriptors' = ANY\(candidate\.missing_fields\)/);
  assert.match(queries[1]?.sql ?? '', /'tags' = ANY\(candidate\.missing_fields\)/);
  assert.deepEqual(queries[1]?.values, [[10, 20]]);
});
