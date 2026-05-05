import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeObject, sanitizeSearchParams, sanitizeValue } from './sanitizer';

test('sanitizeObject redacts sensitive keys recursively', () => {
  const sanitized = sanitizeObject({
    ok: 'value',
    nested: {
      authorization: 'Bearer abc',
      access_token: 'secret',
    },
  });

  assert.equal(sanitized.ok, 'value');
  assert.deepEqual(sanitized.nested, {
    authorization: '[redacted]',
    access_token: '[redacted]',
  });
});

test('sanitizeValue truncates long arrays and strings', () => {
  const sanitized = sanitizeValue({
    items: Array.from({ length: 30 }, (_, index) => index),
    text: 'x'.repeat(2_100),
  });

  assert.equal(typeof sanitized, 'object');
  assert.ok(JSON.stringify(sanitized).includes('truncated 5 items'));
  assert.ok(JSON.stringify(sanitized).includes('[truncated 100 chars]'));
});

test('sanitizeSearchParams redacts token-like params', () => {
  const params = new URLSearchParams('q=hello&refresh_token=abc');
  const sanitized = sanitizeSearchParams(params);

  assert.equal(sanitized.q, 'hello');
  assert.equal(sanitized.refresh_token, '[redacted]');
});
