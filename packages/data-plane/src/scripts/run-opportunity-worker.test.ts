import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpportunityWorker } from '../opportunity/worker.js';
import { runOpportunityWorker } from './run-opportunity-worker.js';

test('actual opportunity entrypoint recovers from refused scheduling without process restart', async (t) => {
  const keys = { TIGER_PRIMARY_URL: 'postgres://test:test@localhost/test', MAX_IDLE_POLLS: '1' };
  const before = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
  Object.assign(process.env, keys);
  let cycles = 0;
  const signalsBefore = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  t.mock.method(OpportunityWorker.prototype, 'runOnce', async () => {
    cycles += 1;
    if (cycles === 1) throw new AggregateError([
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    ], '');
    return { claimed: 0, scheduled: 0 };
  });
  try {
    await runOpportunityWorker();
    assert.equal(cycles, 2);
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], signalsBefore);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
