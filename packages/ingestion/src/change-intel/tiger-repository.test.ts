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
