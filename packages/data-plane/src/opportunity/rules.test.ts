import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPORTUNITY_RULE_SCHEMA_VERSION,
  type OpportunityEvaluationInput,
  type OpportunityFieldValue,
  type OpportunityRuleSet,
} from "./types.js";
import {
  describeOpportunityRuleSet,
  evaluateOpportunityProfile,
} from "./rules.js";

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
