import assert from 'node:assert/strict';
import test from 'node:test';

import { getPicsServiceStatus } from './pics-service-status';

test('getPicsServiceStatus fails closed when no endpoint is configured', async (t) => {
  const previousUrl = process.env.PICS_STATUS_URL;
  process.env.PICS_STATUS_URL = 'https://unexpected.example.test/status';
  t.after(() => {
    if (previousUrl === undefined) {
      delete process.env.PICS_STATUS_URL;
    } else {
      process.env.PICS_STATUS_URL = previousUrl;
    }
  });

  assert.deepEqual(await getPicsServiceStatus({ url: null }), {
    configured: false,
    reachable: false,
    status: null,
    healthState: null,
    updatedAt: null,
    error: 'not_configured',
  });
});

test('getPicsServiceStatus reads the public PICS status contract', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'running',
        health_state: 'ok',
        updated_at: '2026-07-24T02:51:10.675530Z',
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }
    );

  assert.deepEqual(
    await getPicsServiceStatus({
      url: 'https://pics.example.test/status',
      fetchImpl,
    }),
    {
      configured: true,
      reachable: true,
      status: 'running',
      healthState: 'ok',
      updatedAt: '2026-07-24T02:51:10.675530Z',
      error: null,
    }
  );
});

test('getPicsServiceStatus reports a stopped Railway endpoint as unreachable', async () => {
  const fetchImpl: typeof fetch = async () => new Response('not found', { status: 404 });

  assert.deepEqual(
    await getPicsServiceStatus({
      url: 'https://pics.example.test/status',
      fetchImpl,
    }),
    {
      configured: true,
      reachable: false,
      status: null,
      healthState: null,
      updatedAt: null,
      error: 'unreachable',
    }
  );
});

test('getPicsServiceStatus rejects incomplete status payloads', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'running' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });

  assert.deepEqual(
    await getPicsServiceStatus({
      url: 'https://pics.example.test/status',
      fetchImpl,
    }),
    {
      configured: true,
      reachable: true,
      status: 'running',
      healthState: null,
      updatedAt: null,
      error: 'invalid_response',
    }
  );
});
