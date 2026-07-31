import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPORTUNITY_RULE_FIELDS,
  OPPORTUNITY_RULE_SCHEMA_V1,
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  type OpportunityRuleOperator,
  type OpportunityRuleSet,
} from "./types.js";
import {
  describeOpportunityRuleSet,
  evaluateOpportunityClause,
  evaluateOpportunityGroup,
  evaluateOpportunityProfile,
  supportsReleasedMarketHealth,
} from "./rules.js";
import { OPPORTUNITY_RULE_INPUT_FIELD_SOURCES } from "./repository.js";

function known(value: unknown): OpportunityFieldValue {
  return {
    confidence: "high",
    evidenceClass: "observed_fact",
    source: "test",
    sourceAt: "2026-07-27T00:00:00.000Z",
    state: "known",
    value,
  };
}

function unknown(reason: string): OpportunityFieldValue {
  return {
    confidence: "directional",
    evidenceClass: "observed_fact",
    reason,
    source: "test",
    sourceAt: null,
    state: "unknown",
    value: null,
  };
}

const RULES: OpportunityRuleSet = {
  excluded: [
    {
      clauses: [
        {
          field: "content_descriptors",
          id: "adult",
          operator: "contains",
          value: "adult",
        },
      ],
      id: "content",
      label: "Content policy",
      operator: "any",
    },
  ],
  preferred: [
    {
      clauses: [
        {
          field: "has_demo",
          id: "demo",
          operator: "equals",
          value: true,
        },
      ],
      id: "demo-preference",
      importance: "high",
      label: "Playable demo",
      operator: "all",
    },
  ],
  required: [
    {
      clauses: [
        {
          field: "tags",
          id: "roguelike",
          operator: "contains",
          value: "Roguelike",
        },
        {
          field: "tags",
          id: "deckbuilder",
          operator: "contains",
          value: "Deckbuilding",
        },
      ],
      id: "taxonomy",
      label: "Roguelike deckbuilder",
      operator: "all",
    },
    {
      clauses: [
        {
          field: "is_released",
          id: "unreleased",
          operator: "equals",
          value: false,
        },
      ],
      id: "release",
      label: "Upcoming",
      operator: "all",
    },
  ],
  schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
};

function input(
  fields: OpportunityEvaluationInput["fields"],
): OpportunityEvaluationInput {
  return { appid: 10, fields, name: "Test Game" };
}

describe("opportunity rule engine", () => {
  it("preserves all 35 supported fields through the versioned input contract", () => {
    assert.equal(OPPORTUNITY_RULE_FIELDS.length, 35);
    assert.deepEqual(
      Object.keys(OPPORTUNITY_RULE_INPUT_FIELD_SOURCES).sort(),
      [...OPPORTUNITY_RULE_FIELDS].sort(),
    );
    const fields = Object.fromEntries(
      OPPORTUNITY_RULE_FIELDS.map((field) => [field, known(`${field}-value`)]),
    ) as OpportunityEvaluationInput["fields"];
    const result = evaluateOpportunityProfile(
      {
        excluded: [],
        preferred: [],
        required: [
          {
            clauses: OPPORTUNITY_RULE_FIELDS.map((field) => ({
              field,
              id: field,
              operator: "exists" as const,
            })),
            id: "all-supported-fields",
            label: "All supported fields",
            operator: "all",
          },
        ],
        schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
      },
      input(fields),
    );

    assert.equal(result.outcome, "eligible");
    assert.equal(result.requiredOutcomes[0]?.clauseOutcomes.length, 35);
  });

  it("preserves the truth contract for all 13 operators", () => {
    const fixtures: Array<{
      actual: unknown;
      expected?: boolean | number | string | Array<boolean | number | string>;
      operator: OpportunityRuleOperator;
    }> = [
      { actual: "Indie", expected: "indie", operator: "equals" },
      { actual: "Indie", expected: "AAA", operator: "not_equals" },
      { actual: "Indie", expected: ["AAA", "indie"], operator: "in" },
      { actual: "Indie", expected: ["AAA", "AA"], operator: "not_in" },
      {
        actual: ["Roguelike", "Deckbuilding"],
        expected: ["roguelike", "deckbuilding"],
        operator: "contains",
      },
      {
        actual: ["Roguelike", "Deckbuilding"],
        expected: "horror",
        operator: "not_contains",
      },
      { actual: 101, expected: 100, operator: "greater_than" },
      {
        actual: 100,
        expected: 100,
        operator: "greater_than_or_equal",
      },
      { actual: 99, expected: 100, operator: "less_than" },
      {
        actual: 100,
        expected: 100,
        operator: "less_than_or_equal",
      },
      { actual: 100, expected: [99, 101], operator: "between" },
      { actual: false, operator: "exists" },
      { actual: null, operator: "not_exists" },
    ];

    for (const fixture of fixtures) {
      const result = evaluateOpportunityClause(
        {
          field: "tags",
          id: fixture.operator,
          operator: fixture.operator,
          value: fixture.expected,
        },
        input({ tags: known(fixture.actual) }),
      );
      assert.equal(result.state, "true", fixture.operator);
    }
  });

  it("never coerces a known null into zero for numeric comparisons", () => {
    const outcome = evaluateOpportunityClause(
      {
        field: "price_cents",
        id: "price",
        operator: "less_than",
        value: 100,
      },
      input({ price_cents: known(null) }),
    );

    assert.equal(outcome.state, "unknown");
  });

  it("continues to read v1 rules while reserving v2 fields for v2", () => {
    const v1Rules: OpportunityRuleSet = {
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "is_released",
              id: "released",
              operator: "equals",
              value: false,
            },
          ],
          id: "release",
          label: "Release",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_V1,
    };

    assert.equal(
      evaluateOpportunityProfile(v1Rules, input({ is_released: known(false) }))
        .outcome,
      "eligible",
    );
    assert.equal(
      evaluateOpportunityClause(
        {
          field: "release_date",
          id: "legacy-date",
          operator: "equals",
          value: "2026-09-01",
        },
        input({ release_date: known("2026-09-01") }),
        { asOf: "2026-07-30T18:00:00.000Z", timezone: "UTC" },
      ).state,
      "true",
    );
    assert.throws(
      () =>
        evaluateOpportunityProfile(
          {
            ...v1Rules,
            required: [
              {
                clauses: [
                  {
                    field: "demo_only",
                    id: "demo-only",
                    operator: "equals",
                    value: true,
                  },
                ],
                id: "demo",
                label: "Demo",
                operator: "all",
              },
            ],
          },
          input({ demo_only: known(true) }),
        ),
      /not supported/,
    );
  });

  it("preserves ANY and ALL three-state truth tables", () => {
    const group = (operator: "any" | "all") => ({
      clauses: [
        {
          field: "has_demo" as const,
          id: "known",
          operator: "equals" as const,
          value: true,
        },
        {
          field: "is_free" as const,
          id: "unknown",
          operator: "equals" as const,
          value: true,
        },
      ],
      id: operator,
      label: operator,
      operator,
    });

    assert.equal(
      evaluateOpportunityGroup(
        group("all"),
        input({ has_demo: known(false), is_free: unknown("pending") }),
      ).state,
      "false",
    );
    assert.equal(
      evaluateOpportunityGroup(
        group("all"),
        input({ has_demo: known(true), is_free: unknown("pending") }),
      ).state,
      "unknown",
    );
    assert.equal(
      evaluateOpportunityGroup(
        group("any"),
        input({ has_demo: known(true), is_free: unknown("pending") }),
      ).state,
      "true",
    );
    assert.equal(
      evaluateOpportunityGroup(
        group("any"),
        input({ has_demo: known(false), is_free: unknown("pending") }),
      ).state,
      "unknown",
    );
  });

  it("preserves low, medium, and high preference weights", () => {
    const result = evaluateOpportunityProfile(
      {
        excluded: [],
        preferred: (["low", "medium", "high"] as const).map((importance) => ({
          clauses: [
            {
              field: "has_demo" as const,
              id: importance,
              operator: "equals" as const,
              value: true,
            },
          ],
          id: importance,
          importance,
          label: importance,
          operator: "all" as const,
        })),
        required: [],
        schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
      },
      input({ has_demo: known(true) }),
    );

    assert.deepEqual(
      result.preferredOutcomes.map((outcome) => outcome.contribution),
      [1 / 6, 2 / 6, 3 / 6],
    );
    assert.equal(result.preferenceContribution, 1);
  });

  it("excludes explicitly unreleased rule sets from released-market health", () => {
    assert.equal(supportsReleasedMarketHealth(RULES), false);
    assert.equal(
      supportsReleasedMarketHealth({
        ...RULES,
        required: [
          {
            clauses: [
              {
                field: "is_released",
                id: "released",
                operator: "equals",
                value: true,
              },
            ],
            id: "release",
            label: "Released",
            operator: "all",
          },
        ],
      }),
      true,
    );
  });

  it("requires every required group and supports ALL inside a taxonomy group", () => {
    const result = evaluateOpportunityProfile(
      RULES,
      input({
        content_descriptors: known([]),
        has_demo: known(true),
        is_released: known(false),
        tags: known(["Roguelike", "Deckbuilding", "Indie"]),
      }),
    );

    assert.equal(result.outcome, "eligible");
    assert.equal(result.preferenceContribution, 1);
  });

  it("holds an unknown required field instead of treating it as false", () => {
    const result = evaluateOpportunityProfile(
      RULES,
      input({
        content_descriptors: known([]),
        has_demo: known(false),
        is_released: known(false),
        tags: unknown("PICS taxonomy is pending."),
      }),
    );

    assert.equal(result.outcome, "pending");
    assert.deepEqual(result.missingRequiredFields, ["tags"]);
  });

  it("does not exclude on an unknown exclusion", () => {
    const result = evaluateOpportunityProfile(
      RULES,
      input({
        content_descriptors: unknown("Content descriptors unavailable."),
        has_demo: unknown("Demo state unavailable."),
        is_released: known(false),
        tags: known(["Roguelike", "Deckbuilding"]),
      }),
    );

    assert.equal(result.outcome, "eligible");
    assert.equal(result.excluded, false);
    assert.equal(result.preferenceContribution, 0);
  });

  it("excludes on any positively matched exclusion", () => {
    const result = evaluateOpportunityProfile(
      RULES,
      input({
        content_descriptors: known(["adult"]),
        has_demo: known(true),
        is_released: known(false),
        tags: known(["Roguelike", "Deckbuilding"]),
      }),
    );

    assert.equal(result.outcome, "ineligible");
    assert.equal(result.excluded, true);
  });

  it("uses case-insensitive substring semantics for scalar contains rules", () => {
    const scalarRules: OpportunityRuleSet = {
      excluded: [],
      preferred: [],
      required: [
        {
          clauses: [
            {
              field: "release_state",
              id: "early-access",
              operator: "contains",
              value: "early access",
            },
          ],
          id: "release-state",
          label: "Early Access",
          operator: "all",
        },
      ],
      schemaVersion: OPPORTUNITY_RULE_SCHEMA_VERSION,
    };

    assert.equal(
      evaluateOpportunityProfile(
        scalarRules,
        input({ release_state: known("Coming Soon — Early Access") }),
      ).outcome,
      "eligible",
    );
  });

  it("generates visible copy from the same rule structure", () => {
    const description = describeOpportunityRuleSet(RULES);

    assert.equal(description.length, 4);
    assert.match(description[0]!, /Required/);
    assert.match(description[2]!, /Preferred \(high\)/);
  });
});
