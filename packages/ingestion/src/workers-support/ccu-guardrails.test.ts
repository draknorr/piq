import assert from 'node:assert/strict';
import test from 'node:test';
import { getSuspiciousZeroAppids } from './ccu-guardrails.js';

type SuspiciousZeroClient = Parameters<typeof getSuspiciousZeroAppids>[0];
type RpcArgs = Record<string, unknown>;
type RpcResponse = Promise<{ data: unknown; error: { message: string } | null }>;

function resolvedRows<T>(data: T[] | null, error: { message: string } | null = null) {
  return Promise.resolve({ data, error });
}

function buildAppsQuery(data: Array<{ appid: number; release_date: string | null }>) {
  return {
    select() {
      return {
        in() {
          return resolvedRows(data);
        },
      };
    },
  } as unknown as SuspiciousZeroClient;
}

function buildLatestMetricsQuery(data: Array<{ appid: number; total_reviews: number | null }>) {
  return {
    select() {
      return {
        in() {
          return resolvedRows(data);
        },
      };
    },
  } as unknown as SuspiciousZeroClient;
}

function buildDailyMetricsQuery(
  data: Array<{ appid: number }> | null,
  error: { message: string } | null = null
) {
  return {
    select() {
      return {
        in() {
          return {
            gte() {
              return {
                gt() {
                  return resolvedRows(data, error);
                },
              };
            },
          };
        },
      };
    },
  };
}

function buildSnapshotsQuery(data: Array<{ appid: number }>) {
  return {
    select() {
      return {
        in() {
          return {
            gte() {
              return {
                gt() {
                  return resolvedRows(data);
                },
              };
            },
          };
        },
      };
    },
  };
}

test('getSuspiciousZeroAppids uses the RPC when available', async () => {
  let fromCalled = false;

  const supabase = {
    rpc(name: string, args: RpcArgs): RpcResponse {
      assert.equal(name, 'get_suspicious_zero_appids');
      assert.deepEqual(args, { p_appids: [11, 22] });
      return Promise.resolve({ data: [11, 22], error: null });
    },
    from() {
      fromCalled = true;
      throw new Error('from() should not be called when RPC succeeds');
    },
  };

  const suspicious = await getSuspiciousZeroAppids(
    supabase as unknown as SuspiciousZeroClient,
    [11, 22, 22]
  );

  assert.deepEqual([...suspicious], [11, 22]);
  assert.equal(fromCalled, false);
});

test('getSuspiciousZeroAppids chunks RPC calls for large batches', async () => {
  const rpcCalls: number[][] = [];
  const appids = Array.from({ length: 251 }, (_, index) => index + 1);

  const supabase = {
    rpc(name: string, args: RpcArgs): RpcResponse {
      assert.equal(name, 'get_suspicious_zero_appids');
      rpcCalls.push(args.p_appids as number[]);
      return Promise.resolve({
        data: [rpcCalls.length === 1 ? 1 : 251],
        error: null,
      });
    },
    from() {
      throw new Error('from() should not be called when chunked RPC succeeds');
    },
  };

  const suspicious = await getSuspiciousZeroAppids(
    supabase as unknown as SuspiciousZeroClient,
    appids
  );

  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0].length, 250);
  assert.equal(rpcCalls[1].length, 1);
  assert.deepEqual([...suspicious], [1, 251]);
});

test('getSuspiciousZeroAppids falls back safely when the RPC is unavailable', async () => {
  const recentRelease = new Date();
  recentRelease.setDate(recentRelease.getDate() - 10);

  const supabase = {
    rpc(): RpcResponse {
      return Promise.resolve({
        data: null,
        error: { message: 'Could not find the function public.get_suspicious_zero_appids' },
      });
    },
    from(table: string) {
      switch (table) {
        case 'apps':
          return buildAppsQuery([{ appid: 1, release_date: recentRelease.toISOString().slice(0, 10) }]);
        case 'latest_daily_metrics':
          return buildLatestMetricsQuery([{ appid: 2, total_reviews: 1500 }]);
        case 'daily_metrics':
          return buildDailyMetricsQuery(null, { message: 'statement timeout' });
        case 'ccu_snapshots':
          return buildSnapshotsQuery([{ appid: 3 }]);
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    },
  };

  const suspicious = await getSuspiciousZeroAppids(
    supabase as unknown as SuspiciousZeroClient,
    [1, 2, 3]
  );

  assert.deepEqual([...suspicious], [1, 2, 3]);
});
