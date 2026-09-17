import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransientDatabaseConnectionError, runDatabaseWorker, waitForWorkerDelay } from '@publisheriq/shared';

const failure = (code: string): Error => Object.assign(new Error(code), { code });

test('classifies actual pg and dual-stack errors but rejects SQL/authentication/mixed failures', () => {
  for (const code of ['57P01', '57P02', '57P03', '08006', '53300', 'ECONNREFUSED', 'ECONNRESET']) {
    assert.equal(isTransientDatabaseConnectionError(failure(code)), true, code);
  }
  assert.equal(isTransientDatabaseConnectionError(new AggregateError([failure('ECONNREFUSED'), failure('ECONNREFUSED')], '')), true);
  assert.equal(isTransientDatabaseConnectionError(new Error('wrapper', { cause: failure('57P01') })), true);
  for (const code of ['28P01', '42P01', '23505', '57014', '40P01', 'ENOTFOUND']) {
    assert.equal(isTransientDatabaseConnectionError(failure(code)), false, code);
  }
  assert.equal(isTransientDatabaseConnectionError(new AggregateError([failure('ECONNREFUSED'), failure('28P01')], '')), false);
  assert.equal(isTransientDatabaseConnectionError(new AggregateError([], '')), false);
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(isTransientDatabaseConnectionError(cyclic), false);
  assert.equal(isTransientDatabaseConnectionError(new Error('query timed out')), false);
  assert.equal(isTransientDatabaseConnectionError(new Error('timeout exceeded when trying to connect')), true);
});

test('cold startup survives more than ten failures with bounded retries and one recovery', async () => {
  const waits: number[] = []; const recovered: number[] = [];
  let cycles = 0;
  await runDatabaseWorker(async () => {
    cycles += 1;
    if (cycles <= 15) throw new AggregateError([failure('ECONNREFUSED')], '');
    return false;
  }, {
    signal: new AbortController().signal,
    random: () => 0,
    wait: async ms => { waits.push(ms); },
    onUnavailable: () => {}, onRecovered: n => { recovered.push(n); },
  });
  assert.equal(cycles, 16);
  assert.deepEqual(waits.slice(0, 6), [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.ok(waits.every(ms => ms <= 60000));
  assert.deepEqual(recovered, [15]);
});

test('new outage resets delay only after a successful cycle, without retrying a claimed item', async () => {
  const waits: number[] = []; const writes: string[] = [];
  let cycle = 0;
  await runDatabaseWorker(async () => {
    cycle += 1;
    if (cycle === 1) { writes.push('committed-item'); throw failure('57P01'); }
    if (cycle === 2) return true; // fresh claim finds no expired lease
    if (cycle === 3) throw failure('ECONNRESET');
    return false;
  }, {
    signal: new AbortController().signal, random: () => 0.5,
    wait: async ms => { waits.push(ms); }, onUnavailable: () => {}, onRecovered: () => {},
  });
  assert.deepEqual(writes, ['committed-item']);
  assert.deepEqual(waits, [5500, 5500]);
});

test('permanent failure exits without sleeping or claiming another batch', async () => {
  let cycles = 0;
  const error = failure('28P01');
  await assert.rejects(runDatabaseWorker(async () => { cycles += 1; throw error; }, {
    signal: new AbortController().signal,
    wait: async () => { assert.fail('must not retry credentials'); },
    onUnavailable: () => { assert.fail('must not label permanent errors transient'); },
    onRecovered: () => {},
  }), error);
  assert.equal(cycles, 1);
});

test('shutdown interrupts a real sixty-second wait and starts no extra cycle', async () => {
  const shutdown = new AbortController(); let cycles = 0;
  const started = Date.now();
  await runDatabaseWorker(async () => { cycles += 1; throw failure('ECONNREFUSED'); }, {
    signal: shutdown.signal,
    onUnavailable: () => { setTimeout(() => shutdown.abort(), 5); },
    onRecovered: () => { assert.fail('not recovered'); },
    wait: (_ms, signal) => waitForWorkerDelay(60000, signal),
  });
  assert.equal(cycles, 1);
  assert.ok(Date.now() - started < 1000);
});

test('already stopped worker makes no connection attempt', async () => {
  await runDatabaseWorker(async () => { assert.fail('stopped'); }, {
    signal: AbortSignal.abort(), onUnavailable: () => {}, onRecovered: () => {},
  });
});
