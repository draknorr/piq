import assert from 'node:assert/strict';
import test from 'node:test';
import { claimCaptureQueue, enqueueCaptureJobs, requeueStaleCaptureClaims } from './repository.js';

interface QueueRpcArgs {
  p_jobs: Array<Record<string, unknown>>;
}

test('enqueueCaptureJobs delegates dedupe-safe inserts to enqueue_app_capture_queue', async () => {
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
  assert.equal(rpcName, 'enqueue_app_capture_queue');
  if (!rpcArgs) {
    throw new Error('Expected enqueue_app_capture_queue RPC to be called');
  }
  const queueRows = (rpcArgs as QueueRpcArgs).p_jobs;
  assert.equal(queueRows.length, 2);
  assert.deepEqual(queueRows[0], {
    appid: 10,
    source: 'storefront',
    priority: 100,
    trigger_reason: 'steam_app_change_hint',
    trigger_cursor: '123:456',
    payload: { source: 'hint' },
    available_at: queueRows[0].available_at,
  });
  assert.deepEqual(queueRows[1], {
    appid: 10,
    source: 'news',
    priority: 25,
    trigger_reason: 'stale_news_catchup',
    trigger_cursor: '',
    payload: {},
    available_at: queueRows[0].available_at,
  });
  assert.ok(typeof queueRows[0].available_at === 'string');
  assert.ok(!Number.isNaN(Date.parse(String(queueRows[0].available_at))));
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

test('requeueStaleCaptureClaims requeues stale claimed rows through complete_app_capture_queue', async () => {
  let rpcName: string | null = null;
  let rpcArgs: Record<string, unknown> | null = null;

  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    lt() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({
        data: [{ id: 41 }, { id: 42 }],
        error: null,
      });
    },
  };

  const supabase = {
    from(table: string) {
      assert.equal(table, 'app_capture_queue');
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({ data: 2, error: null });
    },
  } as any;

  const requeued = await requeueStaleCaptureClaims(supabase, ['storefront', 'news'], '2026-03-14T09:00:00.000Z', 100);

  assert.equal(requeued, 2);
  assert.equal(rpcName, 'complete_app_capture_queue');
  assert.deepEqual(rpcArgs, {
    p_ids: [41, 42],
    p_status: 'queued',
    p_error: 'stale_claim_requeued',
  });
});

test('requeueStaleCaptureClaims skips completion when no stale rows were found', async () => {
  let rpcCalled = false;
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    lt() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({
        data: [],
        error: null,
      });
    },
  };

  const supabase = {
    from() {
      return query;
    },
    rpc() {
      rpcCalled = true;
      return Promise.resolve({ data: 0, error: null });
    },
  } as any;

  const requeued = await requeueStaleCaptureClaims(supabase, ['hero_asset'], '2026-03-14T09:00:00.000Z', 100);

  assert.equal(requeued, 0);
  assert.equal(rpcCalled, false);
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
