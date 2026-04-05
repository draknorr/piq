import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimCaptureQueue,
  enqueueCaptureJobs,
  requeueStaleCaptureClaims,
  seedDiscoveredApps,
} from './repository.js';

interface QueueRpcArgs {
  p_jobs: Array<Record<string, unknown>>;
  p_cooldown_hours?: number;
}

test('enqueueCaptureJobs delegates dedupe-safe inserts to mark_app_capture_work_dirty', async () => {
  let rpcName: string | null = null;
  let rpcArgs: QueueRpcArgs | null = null;

  const supabase = {
    rpc(name: string, args: QueueRpcArgs) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({ data: 1, error: null });
    },
  } as any;

  const inserted = await enqueueCaptureJobs(supabase, [
    {
      appid: 10,
      source: 'storefront',
      triggerReason: 'steam_app_change_hint',
      triggerCursor: '123:456',
      priority: 100,
      payload: { source: 'hint' },
    },
    {
      appid: 10,
      source: 'news',
      triggerReason: 'stale_news_catchup',
      triggerCursor: null,
      priority: 25,
    },
  ]);

  assert.equal(inserted, 1);
  assert.equal(rpcName, 'mark_app_capture_work_dirty');
  if (!rpcArgs) {
    throw new Error('Expected mark_app_capture_work_dirty RPC to be called');
  }
  const capturedArgs = rpcArgs as QueueRpcArgs;
  const queueRows = capturedArgs.p_jobs;
  assert.equal(capturedArgs.p_cooldown_hours, 6);
  assert.equal(queueRows.length, 2);
  assert.deepEqual(queueRows[0], {
    appid: 10,
    source: 'storefront',
    priority: 100,
    trigger_reason: 'steam_app_change_hint',
    trigger_cursor: '123:456',
    payload: { source: 'hint' },
  });
  assert.deepEqual(queueRows[1], {
    appid: 10,
    source: 'news',
    priority: 25,
    trigger_reason: 'stale_news_catchup',
    trigger_cursor: '',
    payload: {},
  });
});

test('enqueueCaptureJobs returns zero without issuing an RPC for empty batches', async () => {
  let called = false;
  const supabase = {
    rpc() {
      called = true;
      return Promise.resolve({ data: 0, error: null });
    },
  } as any;

  const inserted = await enqueueCaptureJobs(supabase, []);

  assert.equal(inserted, 0);
  assert.equal(called, false);
});

test('enqueueCaptureJobs surfaces RPC errors', async () => {
  const supabase = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: 'boom' } });
    },
  } as any;

  await assert.rejects(
    () =>
      enqueueCaptureJobs(supabase, [
        {
          appid: 10,
          source: 'storefront',
          triggerReason: 'steam_app_change_hint',
          triggerCursor: '123:456',
        },
      ]),
    /Failed to enqueue app capture jobs: boom/
  );
});

test('requeueStaleCaptureClaims requeues stale claimed rows through requeue_stale_app_capture_work', async () => {
  let rpcName: string | null = null;
  let rpcArgs: Record<string, unknown> | null = null;

  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({ data: 2, error: null });
    },
  } as any;

  const requeued = await requeueStaleCaptureClaims(supabase, ['storefront', 'news'], '2026-03-14T09:00:00.000Z', 100);

  assert.equal(requeued, 2);
  assert.equal(rpcName, 'requeue_stale_app_capture_work');
  assert.deepEqual(rpcArgs, {
    p_sources: ['storefront', 'news'],
    p_claimed_before: '2026-03-14T09:00:00.000Z',
    p_limit: 100,
  });
});

test('requeueStaleCaptureClaims returns zero when the stale-claim RPC finds nothing to requeue', async () => {
  let rpcCalled = false;

  const supabase = {
    rpc() {
      rpcCalled = true;
      return Promise.resolve({ data: 0, error: null });
    },
  } as any;

  const requeued = await requeueStaleCaptureClaims(supabase, ['hero_asset'], '2026-03-14T09:00:00.000Z', 100);

  assert.equal(requeued, 0);
  assert.equal(rpcCalled, true);
});

test('seedDiscoveredApps forwards normalized discovery payloads to the seed_discovered_apps RPC', async () => {
  let rpcName: string | null = null;
  let rpcArgs: Record<string, unknown> | null = null;

  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({ data: 2, error: null });
    },
  } as any;

  const seeded = await seedDiscoveredApps(supabase, [
    {
      appid: 2778580,
      appType: 'dlc',
      discoveryReason: 'storefront_dlc_reference',
    },
    {
      appid: 1245620,
      appType: 'game',
      discoveryReason: 'storefront_parent_reference',
      placeholderName: 'ELDEN RING (pending metadata)',
    },
  ]);

  assert.equal(seeded, 2);
  assert.equal(rpcName, 'seed_discovered_apps');
  assert.deepEqual(rpcArgs, {
    p_records: [
      {
        appid: 2778580,
        app_type: 'dlc',
        discovery_reason: 'storefront_dlc_reference',
      },
      {
        appid: 1245620,
        app_type: 'game',
        discovery_reason: 'storefront_parent_reference',
        placeholder_name: 'ELDEN RING (pending metadata)',
      },
    ],
  });
});

test('claimCaptureQueue retries transient RPC failures before succeeding', async () => {
  const originalDelay = process.env.CHANGE_INTEL_SUPABASE_RETRY_DELAY_MS;
  process.env.CHANGE_INTEL_SUPABASE_RETRY_DELAY_MS = '1';

  try {
    let attempts = 0;
    const supabase = {
      rpc() {
        attempts += 1;
        if (attempts === 1) {
          return Promise.resolve({ data: null, error: { message: '502 Bad gateway' } });
        }

        return Promise.resolve({
          data: [
            {
              id: 99,
              appid: 730,
              source: 'news',
              trigger_reason: 'storefront_snapshot_change',
              trigger_cursor: '',
              payload: { news_gids: ['gid-1'] },
              attempts: 1,
            },
          ],
          error: null,
        });
      },
    } as any;

    const jobs = await claimCaptureQueue(supabase, ['news'], 5, 'worker-1');

    assert.equal(attempts, 2);
    assert.deepEqual(jobs, [
      {
        id: '99',
        appid: 730,
        source: 'news',
        triggerReason: 'storefront_snapshot_change',
        triggerCursor: '',
        payload: { news_gids: ['gid-1'] },
        attempts: 1,
      },
    ]);
  } finally {
    if (originalDelay === undefined) {
      delete process.env.CHANGE_INTEL_SUPABASE_RETRY_DELAY_MS;
    } else {
      process.env.CHANGE_INTEL_SUPABASE_RETRY_DELAY_MS = originalDelay;
    }
  }
});
