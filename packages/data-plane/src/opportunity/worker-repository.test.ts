import assert from "node:assert/strict";
import { it } from "node:test";

import type { Pool } from "pg";

import { OpportunityWorkerRepository } from "./worker-repository.js";

it("opportunity claims keep lane ordering and leases with disjoint eligible paths", async () => {
  let query = "";
  let values: unknown[] = [];
  const pool = { query: async (text: string, params: unknown[]) => {
    query = text; values = params; return { rows: [] };
  } } as unknown as Pool;
  await new OpportunityWorkerRepository(pool).claimWork("worker-a", 20);
  assert.match(query, /UNION ALL/);
  assert.match(query, /FROM candidates work/);
  assert.match(query, /PARTITION BY work.lane/);
  assert.match(query, /eligible AS MATERIALIZED/);
  assert.match(
    query,
    /FROM ranked\s+--[^\n]*\n\s+WHERE lane_rank <= GREATEST\(1, CEIL\(\$2::numeric \/ 4\)\)::bigint/,
  );
  assert.match(query, /work.id = ANY\(ARRAY\(SELECT id FROM eligible\)\)/);
  assert.match(query, /ORDER BY work.priority DESC, work.scheduled_for, work.id/);
  assert.match(query, /FOR UPDATE OF work SKIP LOCKED/);
  assert.match(query, /claim_expires_at = now\(\) \+ interval '5 minutes'/);
  assert.deepEqual(values, ["worker-a", 20]);
});

it("bounds claim limits before computing the per-lane shortlist", async () => {
  const values: unknown[][] = [];
  const pool = {
    query: async (_text: string, params: unknown[]) => {
      values.push(params);
      return { rows: [] };
    },
  } as unknown as Pool;
  const repository = new OpportunityWorkerRepository(pool);
  for (const limit of [-1, 0, 1.9, 101]) {
    await repository.claimWork("worker-a", limit);
  }
  assert.deepEqual(values, [
    ["worker-a", 1],
    ["worker-a", 1],
    ["worker-a", 1],
    ["worker-a", 100],
  ]);
});

it("limits worker material events to non-delisted canonical games", async () => {
  let query = "";
  const pool = {
    query: async (text: string): Promise<{ rows: unknown[] }> => {
      query = text;
      return { rows: [] };
    },
  } as unknown as Pool;
  const repository = new OpportunityWorkerRepository(pool);

  const events = await repository.getRunMaterialEvents({
    id: "run",
    kind: "daily",
    windowEnd: "2026-07-31T16:00:00.000Z",
    windowStart: "2026-07-30T16:00:00.000Z",
  });

  assert.deepEqual(events, []);
  assert.match(query, /JOIN legacy\.apps canonical_app/);
  assert.match(query, /canonical_app\.type IN \('game', 'Game'\)/);
  assert.match(query, /COALESCE\(canonical_app\.is_delisted, false\) = false/);
});
