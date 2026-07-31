import assert from "node:assert/strict";
import { it } from "node:test";

import type { Pool } from "pg";

import { OpportunityWorkerRepository } from "./worker-repository.js";

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
