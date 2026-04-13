import assert from 'node:assert/strict';
import test from 'node:test';

import { mapAppRpcRowToApp } from './apps-queries';

test('mapAppRpcRowToApp preserves null price when the RPC omits daily-metrics price', () => {
  const app = mapAppRpcRowToApp({
    appid: 3308200,
    name: 'Tombwater',
    type: 'game',
    is_free: false,
    price_cents: null,
    current_discount_percent: 20,
  });

  assert.equal(app.price_cents, null);
  assert.equal(app.current_discount_percent, 20);
});

test('mapAppRpcRowToApp preserves concrete storefront-backed price values', () => {
  const app = mapAppRpcRowToApp({
    appid: 3308200,
    name: 'Tombwater',
    type: 'game',
    is_free: false,
    price_cents: 1999,
    current_discount_percent: 20,
  });

  assert.equal(app.price_cents, 1999);
  assert.equal(app.current_discount_percent, 20);
});
