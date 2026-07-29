import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";

import { presentOpportunityChanges } from "./repository.js";
import { normalizeOpportunityLocalDeliveryTime } from "./service.js";

describe("opportunity profile delivery schedule", () => {
  it("defaults new profiles to 09:00 local time", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime(undefined), "09:00");
  });

  it("accepts bounded 24-hour times and rejects ambiguous input", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime("06:45"), "06:45");
    assert.equal(normalizeOpportunityLocalDeliveryTime("23:59"), "23:59");
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("9:00"),
      /24-hour HH:MM/,
    );
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("24:00"),
      /24-hour HH:MM/,
    );
  });
});

describe("opportunity API presentation", () => {
  it("loads Tiger taxonomy names before returning change summaries", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const queryable = {
      async query(text: string, values: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            { id: 4195, kind: "tags", name: "Roguelike" },
            { id: 4305, kind: "tags", name: "Deckbuilding" },
          ],
        };
      },
    } as unknown as Pool;

    const [presented] = await presentOpportunityChanges(
      queryable,
      [
        {
          affectedRuleFields: ["tags"],
          after: [[4195, 4305]],
          before: [[]],
          confidence: "high",
          effectiveAt: "2026-07-27T00:00:00.000Z",
          eventType: "taxonomy_repositioned",
          observedAt: "2026-07-27T00:00:00.000Z",
          signalFamily: "taxonomy",
          summary: "",
        },
      ],
      ["materially_changed"],
    );

    assert.equal(presented?.summary, "Tags added: Roguelike and Deckbuilding.");
    assert.deepEqual(queries[0]?.values, [[4195, 4305]]);
    assert.match(queries[0]?.text ?? "", /legacy\.steam_tags/);
  });
});
