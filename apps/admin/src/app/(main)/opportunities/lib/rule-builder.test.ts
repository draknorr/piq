import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOpportunityShortcutGroup,
  parseOpportunityNumericRuleValue,
  upgradeOpportunityRules,
} from "./rule-builder";
import type { OpportunityRuleSet } from "./types";

describe("opportunity rule builder", () => {
  it("upgrades an edited v1 profile without mutating its stored rule object", () => {
    const original: OpportunityRuleSet = {
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "release_date",
              id: "launch",
              operator: "equals",
              value: "2026-09-01",
            },
          ],
          id: "release",
          label: "Release",
          operator: "all",
        },
      ],
      schemaVersion: "opportunity-rules/v1",
    };

    const upgraded = upgradeOpportunityRules(original, "2026-07-30");

    assert.equal(original.schemaVersion, "opportunity-rules/v1");
    assert.equal(original.required[0]!.clauses[0]!.value, "2026-09-01");
    assert.equal(upgraded.schemaVersion, "opportunity-rules/v2");
    assert.deepEqual(upgraded.required[0]!.clauses[0]!.value, {
      date: "2026-09-01",
      kind: "absolute_date",
    });
  });

  it("builds exact demo-only and undated-unreleased required groups", () => {
    let sequence = 0;
    const createId = (prefix: string) => `${prefix}-${++sequence}`;

    const demo = createOpportunityShortcutGroup("demo_only", createId);
    const undated = createOpportunityShortcutGroup(
      "undated_unreleased",
      createId,
    );

    assert.deepEqual(
      demo.clauses.map(({ field, operator, value }) => ({
        field,
        operator,
        value,
      })),
      [{ field: "demo_only", operator: "equals", value: true }],
    );
    assert.deepEqual(
      undated.clauses.map(({ field, operator, value }) => ({
        field,
        operator,
        value,
      })),
      [
        { field: "is_released", operator: "equals", value: false },
        {
          field: "release_date",
          operator: "not_exists",
          value: undefined,
        },
      ],
    );
  });

  it("converts dollar prices to cents but keeps percentages as percentages", () => {
    assert.equal(
      parseOpportunityNumericRuleValue("32.49", "price_cents"),
      3249,
    );
    assert.equal(
      parseOpportunityNumericRuleValue("35", "discount_percent"),
      35,
    );
    assert.equal(
      parseOpportunityNumericRuleValue("92", "positive_percentage"),
      92,
    );
  });
});
