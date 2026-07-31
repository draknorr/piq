import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  StorefrontTagCircuit,
  fetchStorefrontTags,
  parseStorefrontTagPage,
} from './storefront-tags.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/storefront-tags-5005180.html', import.meta.url)),
  'utf8'
);

test('parseStorefrontTagPage extracts the complete ranked tag profile', () => {
  const tags = parseStorefrontTagPage(fixture, 5005180);
  assert.equal(tags.length, 20);
  assert.deepEqual(tags.slice(0, 3), [
    { count: 55, name: 'Action Roguelike', rank: 1, tagid: 42804 },
    { count: 52, name: 'Strategy', rank: 2, tagid: 9 },
    { count: 49, name: 'Card Battler', rank: 3, tagid: 791774 },
  ]);
});

test('parseStorefrontTagPage preserves a known empty tag array', () => {
  assert.deepEqual(
    parseStorefrontTagPage(
      '<script>InitAppTagModal(10, [], [], "a", "b", null, false);</script>',
      10
    ),
    []
  );
});

test('parseStorefrontTagPage rejects mismatched and missing modal pages', () => {
  assert.throws(() => parseStorefrontTagPage(fixture, 10), /did not match/);
  assert.throws(() => parseStorefrontTagPage('<html></html>', 10), /did not contain/);
});

test('fetchStorefrontTags governs every actual retry with both limiters', async () => {
  const responses = [new Response('busy', { status: 500 }), new Response(fixture, { status: 200 })];
  const delays: number[] = [];
  let localAcquires = 0;
  let sharedAcquires = 0;
  let nowMs = Date.parse('2026-07-31T12:00:00Z');

  const result = await fetchStorefrontTags(5005180, {
    circuit: new StorefrontTagCircuit(3),
    fetchImpl: async () => responses.shift()!,
    limiter: {
      acquire: async () => {
        localAcquires += 1;
      },
    },
    now: () => nowMs,
    random: () => 0.5,
    sharedStorefrontLimiter: {
      acquire: async () => {
        sharedAcquires += 1;
      },
    },
    sleep: async (ms) => {
      delays.push(ms);
      nowMs += ms;
    },
  });

  assert.equal(result.status, 'success');
  assert.equal(localAcquires, 2);
  assert.equal(sharedAcquires, 2);
  assert.deepEqual(delays, [1_000]);
  assert.equal(result.telemetry.attempts, 2);
  assert.equal(result.telemetry.retries, 1);
});

test('fetchStorefrontTags opens the circuit on parser drift', async () => {
  const circuit = new StorefrontTagCircuit();
  const result = await fetchStorefrontTags(10, {
    circuit,
    fetchImpl: async () => new Response('<html>challenge</html>', { status: 200 }),
    limiter: { acquire: async () => {} },
    sharedStorefrontLimiter: { acquire: async () => {} },
  });

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.errorCode, 'parse_error');
    assert.equal(result.retryable, false);
    assert.ok(result.circuitOpenUntil);
  }
  assert.equal(circuit.getState().opened, true);
});
