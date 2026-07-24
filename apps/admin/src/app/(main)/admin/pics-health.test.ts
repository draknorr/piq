import assert from 'node:assert/strict';
import test from 'node:test';

import { getPicsRuntimeStatus } from './pics-health';

const NOW_MS = Date.parse('2026-07-24T01:00:00Z');
const ACTIVE_SERVICE_STATUS = {
  configured: true,
  reachable: true,
  status: 'running',
  healthState: 'ok',
  updatedAt: '2026-07-24T00:59:30Z',
};

test('getPicsRuntimeStatus reports inactive before a cursor exists', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 0,
        updatedAt: null,
      },
      ACTIVE_SERVICE_STATUS,
      NOW_MS
    ),
    {
      label: 'Inactive',
      variant: 'warning',
      description: 'Tiger cursor is unavailable',
    }
  );
});

test('getPicsRuntimeStatus reports a stale cursor as stalled', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 36_631_816,
        updatedAt: '2026-06-16T22:05:18.735848Z',
      },
      ACTIVE_SERVICE_STATUS,
      NOW_MS
    ),
    {
      label: 'Stalled',
      variant: 'warning',
      description: 'cursor progress is stale',
    }
  );
});

test('getPicsRuntimeStatus reports recent cursor progress as active', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 36_700_000,
        updatedAt: '2026-07-24T00:30:00Z',
      },
      ACTIVE_SERVICE_STATUS,
      NOW_MS
    ),
    {
      label: 'Active',
      variant: 'success',
      description: 'live cursor progress',
    }
  );
});

test('getPicsRuntimeStatus reports a stopped endpoint as inactive immediately', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 37_491_237,
        updatedAt: '2026-07-24T00:59:00Z',
      },
      {
        configured: true,
        reachable: false,
        status: null,
        healthState: null,
        updatedAt: null,
      },
      NOW_MS
    ),
    {
      label: 'Inactive',
      variant: 'warning',
      description: 'worker status endpoint is unavailable',
    }
  );
});

test('getPicsRuntimeStatus reports a stale worker heartbeat as stalled', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 37_491_237,
        updatedAt: '2026-07-24T00:59:00Z',
      },
      {
        configured: true,
        reachable: true,
        status: 'running',
        healthState: 'ok',
        updatedAt: '2026-07-24T00:30:00Z',
      },
      NOW_MS
    ),
    {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker heartbeat is stale',
    }
  );
});

test('getPicsRuntimeStatus fails closed when worker status is not configured', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 37_491_237,
        updatedAt: '2026-07-24T00:59:00Z',
      },
      {
        configured: false,
        reachable: false,
        status: null,
        healthState: null,
        updatedAt: null,
      },
      NOW_MS
    ),
    {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker status is not configured',
    }
  );
});
