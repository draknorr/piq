import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OpportunityBootstrap, OpportunityResultSummary } from "./types";
import {
  opportunityProfileDispatchSummary,
  opportunityPriorityLabel,
  opportunityResultDescription,
  opportunityResultSections,
} from "./review-priority-presentation";

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
      reviewPriority: {
        confidence: {
          applicableCount: 3,
          conflictingCount: 0,
          label: "high",
          presentCount: 3,
          reasons: [],
          score: 1,
          staleCount: 0,
          version: "opportunity-confidence/v2",
        },
        internalScore: 0.72,
        lane: "new_game",
        policy: "discovery",
        priorityBand: "review_soon",
        reasons: ["New on Steam"],
        version: "opportunity-ranking/v2",
        winningProfileId: "profile",
      },
    });

    assert.equal(opportunityPriorityLabel(game), "New discovery — Review soon");
    assert.equal(
      opportunityResultDescription(game),
      "Steam has not provided a short description for this game yet.",
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
