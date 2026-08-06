import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  OpportunityBootstrap,
  OpportunityReviewPriorityDecision,
  OpportunityReviewPrioritySummary,
  OpportunityResultSummary,
} from "./types";
import {
  opportunityNotApplicablePeerSummary,
  opportunityProfileDispatchSummary,
  opportunityPriorityLabel,
  opportunityResultDescription,
  opportunityResultSections,
  opportunityTractionIsNotApplicable,
  opportunityVisibleReviewReasons,
} from "./review-priority-presentation";

function reviewPriority(): OpportunityReviewPrioritySummary {
  return {
    confidence: {
      applicableCount: 3,
      conflictingCount: 0,
      label: "high",
      presentCount: 3,
      reasons: ["post_release_traction_not_applicable"],
      score: 1,
      staleCount: 0,
      version: "opportunity-confidence/v2",
    },
    internalScore: 0.72,
    lane: "new_game",
    policy: "discovery",
    priorityBand: "review_soon",
    reasons: ["New on Steam", "Large, competitive market"],
    version: "opportunity-ranking/v2",
    winningProfileId: "profile",
  };
}

function tractionDecision(): OpportunityReviewPriorityDecision {
  const summary = reviewPriority();
  return {
    ...summary,
    allMatchedProfileIds: ["profile"],
    components: [],
    eligibility: "eligible",
    eligibilityReasonCodes: [],
    inputs: [
      "total_reviews",
      "ccu_peak",
      "reviews_added_7d",
      "reviews_added_30d",
      "ccu_change_7d",
      "ccu_change_30d",
    ].map((key) => ({
      assessment: "not_assessed" as const,
      availability: "not_applicable" as const,
      calculationVersion: null,
      confidenceWeight: 1,
      criticalForConfidence: false,
      key,
      normalizedValue: null,
      rawValue: null,
      reasonCode: "post_release_traction_not_applicable",
      source: "opportunity-ranking/v2",
      sourceAt: null,
    })),
    selectionSource: "explicit",
    sortTuple: [0, 1, 0.72, "2026-08-05T00:00:00.000Z", 1, "profile"],
  };
}

function result(
  id: string,
  rank: number,
  overrides: Partial<OpportunityResultSummary> = {},
): OpportunityResultSummary {
  return {
    appid: rank,
    change: null,
    changeSummary: "Steam activity changed.",
    confidence: "high",
    createdAt: "2026-08-05T00:00:00.000Z",
    eventFingerprint: `event-${id}`,
    eventLabel: "materially_changed",
    gameDescription: null,
    headerImageUrl: null,
    id,
    marketPotential: "large_but_competitive",
    matchedProfiles: [],
    name: id,
    rank,
    rankComponents: {},
    reviewPriority: null,
    score: 100 - rank,
    screenshotThumbnailUrl: null,
    strongestEvidence: [],
    triggeredByMediaAddition: false,
    whyNow: "Steam activity changed.",
    ...overrides,
  };
}

function emptyGroups(): OpportunityBootstrap["dailyOverview"]["groups"] {
  return {
    materiallyChanged: [],
    newlyDiscovered: [],
    newlyQualified: [],
    newlyReleased: [],
    trackedUpdates: [],
  };
}

describe("opportunity review-priority presentation", () => {
  it("keeps the exact persisted feed order in one V2 review queue", () => {
    const results = [result("rank-1", 1), result("rank-2", 2)];
    const sections = opportunityResultSections({
      groups: {
        ...emptyGroups(),
        materiallyChanged: [results[1]!],
        newlyDiscovered: [results[0]!],
      },
      presentReviewPriorityV2: true,
      results,
    });

    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.title, "Ordered for review");
    assert.deepEqual(
      sections[0]?.results.map((item) => item.id),
      ["rank-1", "rank-2"],
    );
  });

  it("retains event-based sections when V2 is off", () => {
    const material = result("material", 1);
    const discovery = result("discovery", 2);
    const sections = opportunityResultSections({
      groups: {
        ...emptyGroups(),
        materiallyChanged: [material],
        newlyDiscovered: [discovery],
      },
      presentReviewPriorityV2: false,
      results: [material, discovery],
    });

    assert.deepEqual(
      sections.map((section) => section.title),
      ["New discoveries", "Material changes"],
    );
  });

  it("formats canonical V2 labels and the honest description fallback", () => {
    const game = result("swords", 1, {
      reviewPriority: reviewPriority(),
    });

    assert.equal(opportunityPriorityLabel(game), "New discovery — Review soon");
    assert.equal(
      opportunityResultDescription(game),
      "Steam has not provided a short description for this game yet.",
    );
  });

  it("does not repeat the complete market label as a why-now reason", () => {
    const game = result("market", 1, { reviewPriority: reviewPriority() });
    assert.deepEqual(opportunityVisibleReviewReasons(game), ["New on Steam"]);
  });

  it("uses the winning decision to distinguish not-applicable traction", () => {
    assert.equal(
      opportunityTractionIsNotApplicable({
        matchedProfiles: [
          { id: "profile", reviewPriority: tractionDecision() },
        ],
        result: { reviewPriority: reviewPriority() },
      }),
      true,
    );
    assert.equal(
      opportunityNotApplicablePeerSummary({
        marketContext: {
          distributions: { totalReviews: { measured: 50, p50: 144 } },
        },
      }),
      "50 comparable released games informed the market context; their median total Steam reviews were 144.",
    );
  });

  it("replaces legacy event nouns with neutral V2 profile copy", () => {
    assert.equal(
      opportunityProfileDispatchSummary({
        description: null,
        eventCounts: {
          materially_changed: 1,
          newly_discovered: 0,
          newly_qualified: 0,
          newly_released: 0,
          tracked_update: 0,
        },
        highConfidenceCount: 1,
        id: "profile",
        listUrl: "/opportunities",
        name: "Profile",
        resultCount: 1,
        status: "enabled",
        summary: "1 game matched; 1 material change, led by Swords.",
        topResult: { appid: 1, name: "Swords", resultId: "result" },
      }),
      "1 game matched, led by Swords.",
    );
  });
});
