import assert from 'node:assert/strict';
import test from 'node:test';

import { getPicsRuntimeStatus } from './pics-health';

const NOW_MS = Date.parse('2026-07-24T01:00:00Z');

test('getPicsRuntimeStatus reports inactive before a cursor exists', () => {
  assert.deepEqual(
    getPicsRuntimeStatus(
      {
        lastChangeNumber: 0,
        updatedAt: null,
      },
      NOW_MS
    ),
    {
      label: 'Inactive',
      variant: 'warning',
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
      NOW_MS
    ),
    {
      label: 'Stalled',
      variant: 'warning',
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
      NOW_MS
    ),
    {
      label: 'Active',
      variant: 'success',
    }
  );
});
