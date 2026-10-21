import assert from 'node:assert/strict';
import test from 'node:test';
import { selectState } from './next-fest-github-state.mjs';

const now = Date.parse('2026-10-21T06:00:00Z');
const current = { id: 3 };
const previous = { id: 2, conclusion: 'failure', updated_at: '2026-10-21T05:00:00Z' };
const artifact = (id, part) => ({ id: id * 10 + part, workflow_run: { id }, name: `next-fest-state-${part}` });
const job = (name, conclusion = 'success') => ({ name, steps: [{ name: 'Collect festival observations', status: 'completed', conclusion }] });
const options = { current, runs: [], artifacts: [], jobsByRun: {}, part: 1, now };

test('first run, same-run phase handoff, and successful canary followed by full collection', () => {
  assert.equal(selectState(options), null);
  const state = artifact(3, 1);
  assert.equal(selectState({ ...options, part: 2, artifacts: [state] }), state);
  assert.throws(() => selectState({ ...options, part: 2 }), /missing/);
  const latest = artifact(2, 2);
  assert.equal(selectState({ ...options, runs: [{ ...previous, conclusion: 'success' }],
    artifacts: [artifact(2, 1), latest], jobsByRun: { 2: [job('ccu'), job('reviews')] } }), latest);
});

test('lost review journal blocks use of the earlier CCU archive for 24h; retrying preflight does not reset that wait', () => {
  const base = { ...options, runs: [previous], artifacts: [artifact(2, 1)], jobsByRun: { 2: [job('ccu'), job('reviews', 'cancelled')] } };
  assert.throws(() => selectState(base), /24 hours/);
  assert.equal(selectState({ ...base, now: now + 86400000 }).id, 21);
  const retry = { id: 4, conclusion: 'failure', updated_at: '2026-10-22T05:55:00Z' };
  assert.equal(selectState({ ...base, current: { id: 5 }, runs: [previous, retry], now: now + 86400000,
    jobsByRun: { ...base.jobsByRun, 4: [job('ccu', 'skipped')] } }).id, 21);
});

test('final artifacts allow recovery after publish failure; missing successful history never resets counters', () => {
  const state = artifact(2, 2);
  assert.equal(selectState({ ...options, runs: [previous], artifacts: [state], jobsByRun: { 2: [job('ccu'), job('reviews')] } }), state);
  assert.throws(() => selectState({ ...options, runs: [{ ...previous, conclusion: 'success' }],
    jobsByRun: { 2: [job('ccu'), job('reviews')] }, now: now + 86400000 }), /no final journal/);
  assert.equal(selectState({ ...options, runs: [previous], jobsByRun: { 2: [job('ccu', 'skipped')] } }), null);
});

test('a preceding run must be fully drained even when its CCU artifact already exists', () => {
  assert.throws(() => selectState({ ...options, runs: [{ ...previous, status: 'in_progress' }],
    artifacts: [artifact(2, 1)], jobsByRun: { 2: [job('ccu'), job('reviews')] } }), /still active/);
});
