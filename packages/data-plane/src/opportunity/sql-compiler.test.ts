import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileOpportunityPreview } from "./sql-compiler.js";
import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityRuleSet,
} from "./types.js";

describe("opportunity SQL compiler", () => {
  it("parameterizes user values and preserves required/excluded semantics", () => {
    const rules: OpportunityRuleSet = {
      excluded: [
        {
          clauses: [
            {
              field: "content_descriptors",
              id: "adult",
              operator: "contains",
              value: "adult' OR TRUE --",
            },
          ],
          id: "excluded-content",
          label: "Excluded content",
          operator: "any",
        },
      ],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "tags",
              id: "tag-a",
              operator: "contains",
              value: "Roguelike",
            },
            {
              field: "tags",
              id: "tag-b",
              operator: "contains",
              value: "Deckbuilding",
            },
          ],
          id: "taxonomy",
          label: "Taxonomy",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    };

    const compiled = compileOpportunityPreview(rules);

    assert.doesNotMatch(compiled.matchSql, /OR TRUE/);
    assert.ok(compiled.matchSql.includes(" AND "));
    assert.ok(compiled.matchSql.includes("NOT"));
    assert.deepEqual(compiled.values, [
      "Roguelike",
      "Deckbuilding",
      "%adult' OR TRUE --%",
    ]);
  });

  it("compiles ANY rule groups with OR", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "genres",
              id: "sim",
              operator: "contains",
              value: "Simulation",
            },
            {
              field: "genres",
              id: "strategy",
              operator: "contains",
              value: "Strategy",
            },
          ],
          id: "genre",
          label: "Genre",
          operator: "any",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(compiled.matchSql, / OR /);
  });

  it("uses relative CCU growth consistently in preview rules", () => {
    const compiled = compileOpportunityPreview({
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "ccu_change_30d",
              id: "ccu-growth",
              operator: "greater_than_or_equal",
              value: 0.2,
            },
          ],
          id: "traction",
          label: "Traction",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    });

    assert.match(
      compiled.matchSql,
      /ccu_peak_latest_30d - sw\.ccu_peak_first_30d/,
    );
    assert.match(compiled.matchSql, /ABS\(sw\.ccu_peak_first_30d\)/);
    assert.doesNotMatch(compiled.matchSql, /ccu_peak_change_30d/);
    assert.deepEqual(compiled.values, [0.2]);
  });
});
