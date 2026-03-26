import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arraysEqual,
  canonicalizeUrlForComparison,
  hashNormalizedContent,
  normalizeStringArray,
  normalizeText,
  stableStringify,
} from './hashing.js';

test('stableStringify sorts object keys deterministically', () => {
  const left = stableStringify({ b: 2, a: { d: 4, c: 3 } });
  const right = stableStringify({ a: { c: 3, d: 4 }, b: 2 });

  assert.equal(left, right);
  assert.equal(hashNormalizedContent({ a: 1, b: 2 }), hashNormalizedContent({ b: 2, a: 1 }));
});

test('normalize helpers collapse whitespace and dedupe arrays', () => {
  assert.equal(normalizeText('  Hello   world  '), 'Hello world');
  assert.equal(
    canonicalizeUrlForComparison('https://shared.akamai.steamstatic.com/foo.jpg?t=123#hero'),
    'https://shared.akamai.steamstatic.com/foo.jpg'
  );
  assert.deepEqual(
    normalizeStringArray(['Action', ' action ', 'RPG', null, '']),
    ['action', 'rpg']
  );
  assert.equal(arraysEqual([1, 2, 3], [1, 2, 3]), true);
  assert.equal(arraysEqual([1, 2], [2, 1]), false);
  assert.equal(arraysEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]), true);
});
