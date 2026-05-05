import test from 'node:test';
import assert from 'node:assert/strict';

import { inferRouteContext } from './route-context';

test('inferRouteContext extracts app detail route params', () => {
  const context = inferRouteContext('/apps/730', '?token=secret&tab=metrics', 'https://example.com/apps/730?token=secret&tab=metrics');

  assert.equal(context.routeKind, 'app_detail');
  assert.equal(context.routeParams.appId, '730');
  assert.equal(context.searchParams.token, '[redacted]');
  assert.match(context.url ?? '', /token=%5Bredacted%5D/);
});

test('inferRouteContext collects listing filters from URL params', () => {
  const context = inferRouteContext('/apps', '?search=horror&sort=ccu_peak&unknown=value');

  assert.equal(context.routeKind, 'apps_listing');
  assert.deepEqual(context.filters, {
    search: 'horror',
    sort: 'ccu_peak',
  });
  assert.equal(context.searchParams.unknown, 'value');
});
