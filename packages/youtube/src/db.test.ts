import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { closePools } from './db.js';

test('closePools is idempotent across duplicate references and repeated calls', async () => {
  let endCalls = 0;
  const pool = {
    end: async () => {
      endCalls += 1;
    },
  } as unknown as Pool;

  await closePools([pool, pool]);
  await closePools([pool]);

  assert.equal(endCalls, 1);
});
