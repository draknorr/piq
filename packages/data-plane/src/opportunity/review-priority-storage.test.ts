import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeOpportunityReviewPriorityDecision,
  encodeOpportunityReviewPriorityDecision,
  OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION,
} from "./review-priority-storage.js";
import type { OpportunityReviewPriorityDecision } from "./types.js";

const DECISION: OpportunityReviewPriorityDecision = {
  allMatchedProfileIds: ["profile-a", "profile-b"],
  components: [
    {
      baseWeight: 0.35,
      contribution: 0.28,
      effectiveWeight: 0.35,
      key: "preferred_profile_match",
      value: 0.8,
    },
    {
      baseWeight: 0.15,
      contribution: null,
      effectiveWeight: 0,
      key: "future_component",
      value: null,
    },
  ],
  confidence: {
    applicableCount: 4,
    conflictingCount: 1,
    label: "directional",
    presentCount: 3,
    reasons: ["cohort_coverage_limited"],
    score: 0.72,
    staleCount: 1,
    version: "opportunity-confidence/v2",
  },
  eligibility: "eligible",
  eligibilityReasonCodes: ["eligible_after_required_rules"],
  inputs: [
    {
      assessment: "neutral",
      availability: "available",
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: true,
      key: "eligibility",
      normalizedValue: 1,
      rawValue: "eligible",
      reasonCode: "eligible_after_required_and_excluded_rules",
      source: "profile_evaluation",
      sourceAt: "2026-08-05T16:00:00.000Z",
    },
    {
      assessment: "positive",
      availability: "available",
      calculationVersion: null,
      confidenceWeight: 0.6,
      criticalForConfidence: false,
      key: "preferred:quality-profile",
      normalizedValue: 1,
      rawValue: "true",
      reasonCode: "preferred_true",
      source: "profile_rule_outcome",
      sourceAt: null,
    },
    {
      assessment: "negative",
      availability: "available",
      calculationVersion: null,
      confidenceWeight: 0.2,
      criticalForConfidence: false,
      key: "readiness:header_art",
      normalizedValue: 0,
      rawValue: 0,
      reasonCode: "readiness_missing",
      source: "ops.app_data_readiness",
      sourceAt: "2026-08-05T15:00:00.000Z",
    },
    {
      assessment: "mixed",
      availability: "unavailable",
      calculationVersion: "future-signal/v1",
      confidenceWeight: 0.3,
      criticalForConfidence: true,
      key: "future_signal",
      normalizedValue: null,
      rawValue: { state: "conflicting" },
      reasonCode: "future_signal_conflict",
      source: "future.source",
      sourceAt: "2026-08-04T15:00:00.000Z",
    },
  ],
  internalScore: 0.56,
  lane: "material_change",
  policy: "monitor_material_changes",
  priorityBand: "review_soon",
  reasons: ["Material Steam change", "Quality profile"],
  selectionSource: "legacy_inference",
  sortTuple: [0, 1, 0.56, "2026-08-05T15:30:00.000Z", 3563080, "profile-a"],
  version: "opportunity-ranking/v2",
  winningProfileId: "profile-a",
};

describe("opportunity review-priority storage codec", () => {
  it("round-trips every public decision field losslessly", () => {
    const encoded = encodeOpportunityReviewPriorityDecision(DECISION);

    assert.equal(encoded.e, OPPORTUNITY_REVIEW_PRIORITY_STORAGE_VERSION);
    assert.deepEqual(
      decodeOpportunityReviewPriorityDecision(encoded),
      DECISION,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(encoded), "utf8") <
        Buffer.byteLength(JSON.stringify(DECISION), "utf8"),
    );
  });

  it("keeps legacy full decisions readable", () => {
    assert.equal(decodeOpportunityReviewPriorityDecision(DECISION), DECISION);
  });

  it("restores the standard policy component contract from compact values", () => {
    const component = (
      key: string,
      baseWeight: number,
      value: number,
    ): OpportunityReviewPriorityDecision["components"][number] => ({
      baseWeight,
      contribution: value * baseWeight,
      effectiveWeight: baseWeight,
      key,
      value,
    });
    const decision: OpportunityReviewPriorityDecision = {
      ...DECISION,
      components: [
        component("preferred_profile_match", 0.25, 0.8),
        component("profile_relevance", 0.25, 1),
        component("event_significance", 0.35, 0.7),
        component("event_recency", 0.25, 0.9),
        component("corroboration_consistency", 0.15, 0.7),
      ],
    };
    const encoded = encodeOpportunityReviewPriorityDecision(decision);

    assert.ok(encoded.c.every((value) => !Array.isArray(value)));
    assert.deepEqual(
      decodeOpportunityReviewPriorityDecision(encoded),
      decision,
    );
  });

  it("fails malformed compact dictionaries closed", () => {
    const encoded = encodeOpportunityReviewPriorityDecision(DECISION);
    encoded.i[0]![1] = 999;

    assert.equal(decodeOpportunityReviewPriorityDecision(encoded), null);
  });
});
