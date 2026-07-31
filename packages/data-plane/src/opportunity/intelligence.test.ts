import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MARKET_CALIBRATION,
  buildPercentileDistribution,
  calculateOpportunityMarketContext,
  calculateOpportunityPresetHealth,
  calculateOpportunityRanking,
  cleanOpportunityProfileName,
  decodeOpportunityText,
  describeOpportunityChange,
} from "./intelligence.js";
import type {
  OpportunityCohortMember,
  OpportunityObservedChange,
} from "./types.js";

function member(
  appid: number,
  overrides: Partial<OpportunityCohortMember> = {},
): OpportunityCohortMember {
  return {
    appid,
    ccuPeak: 100 + appid,
    inclusionReasons: ["shared primary tags"],
    inclusionScore: 0.8,
    name: `Game ${appid}`,
    positivePercentage: 90,
    priceCents: 1_999,
    reviewsAdded30d: 10 + appid,
    totalReviews: 1_000 + appid,
    ...overrides,
  };
}

function change(
  overrides: Partial<OpportunityObservedChange> = {},
): OpportunityObservedChange {
  return {
    affectedRuleFields: ["price_cents"],
    after: [{ price_cents: 500 }],
    before: [{ price_cents: 999 }],
    confidence: "high",
    effectiveAt: "2026-07-27T00:00:00.000Z",
    eventType: "business_model_changed",
    observedAt: "2026-07-27T00:00:00.000Z",
    signalFamily: "pricing",
    summary: "",
    ...overrides,
  };
}

describe("opportunity intelligence", () => {
  it("keeps conservative production-calibrated v1 market thresholds", () => {
    assert.deepEqual(DEFAULT_MARKET_CALIBRATION, {
      largeP90Reviews: 5_000,
      meaningfulP75Ccu: 50,
      meaningfulP75Reviews: 500,
      minimumCoverage: 0.6,
      minimumMeasuredGames: 10,
    });
  });

  it("calculates deterministic percentile distributions", () => {
    assert.deepEqual(buildPercentileDistribution([1, 2, 3, 4, null]), {
      measured: 4,
      p25: 1.75,
      p50: 2.5,
      p75: 3.25,
      p90: 3.7,
    });
  });

  it("marks small cohorts as directional and insufficient", () => {
    const result = calculateOpportunityMarketContext([member(1), member(2)]);

    assert.equal(result.potentialBand, "insufficient_data");
    assert.equal(result.confidence, "directional");
  });

  it("shows concentration instead of hiding a breakout", () => {
    const members = Array.from({ length: 10 }, (_, index) =>
      member(index + 1, {
        reviewsAdded30d: index === 0 ? 1_000 : 5,
        totalReviews: index === 0 ? 200_000 : 2_000,
      }),
    );
    const result = calculateOpportunityMarketContext(members);

    assert.equal(result.potentialBand, "large_but_competitive");
    assert.ok((result.concentration.topOneShare ?? 0) > 0.5);
    assert.ok(result.concentration.warning);
  });

  it("keeps the published ranking weights decomposed", () => {
    const result = calculateOpportunityRanking({
      components: {
        evidenceQuality: 1,
        marketMomentum: 1,
        peerPosition: 1,
        signalStrength: 1,
        userFit: 1,
      },
      reasons: ["All components have full evidence."],
    });

    assert.equal(result.finalScore, 100);
    assert.equal(result.weights.userFit, 0.35);
    assert.equal(result.weights.signalStrength, 0.3);
  });

  it("requires breadth, coverage, concentration, and persistence for Surging", () => {
    const first = calculateOpportunityPresetHealth({
      asOfDate: "2026-07-26",
      ccuGrowthMedian: 0.4,
      consecutiveCandidateDays: 1,
      coreCoverage: 0.8,
      evaluatedGames: 25,
      measuredGames: 20,
      positiveBreadth: 0.6,
      priorState: "active",
      reviewAccelerationMedian: 0.5,
      topContributorShare: 0.3,
    });
    const second = calculateOpportunityPresetHealth({
      asOfDate: "2026-07-27",
      ccuGrowthMedian: 0.4,
      consecutiveCandidateDays: 2,
      coreCoverage: 0.8,
      evaluatedGames: 25,
      measuredGames: 20,
      positiveBreadth: 0.6,
      priorState: "growing",
      reviewAccelerationMedian: 0.5,
      topContributorShare: 0.3,
    });

    assert.equal(first.state, "growing");
    assert.equal(second.state, "surging");
  });

  it("explains quiet as measured flat movement", () => {
    const result = calculateOpportunityPresetHealth({
      asOfDate: "2026-07-27",
      ccuGrowthMedian: 0.01,
      consecutiveCandidateDays: 1,
      coreCoverage: 0.8,
      evaluatedGames: 25,
      measuredGames: 20,
      positiveBreadth: 0.2,
      priorState: "active",
      reviewAccelerationMedian: -0.02,
      topContributorShare: 0.4,
    });

    assert.equal(result.state, "quiet");
    assert.match(result.explanation.at(-1) ?? "", /both within ±5%/);
  });

  it("requires both minimum count and minimum coverage", () => {
    const result = calculateOpportunityPresetHealth({
      asOfDate: "2026-07-27",
      ccuGrowthMedian: 0,
      consecutiveCandidateDays: 1,
      coreCoverage: 0.1,
      evaluatedGames: 20,
      measuredGames: 2,
      positiveBreadth: 0,
      priorState: null,
      reviewAccelerationMedian: 0,
      topContributorShare: null,
    });

    assert.equal(result.state, "insufficient_data");
    assert.match(result.explanation[0] ?? "", /2 of 20 evaluated released/);
    assert.match(result.explanation[1] ?? "", /10 measured games and 60%/);
  });
});

describe("opportunity presentation", () => {
  it("uses directional price language", () => {
    assert.equal(
      describeOpportunityChange(change()),
      "Price lowered from $9.99 to $5.00.",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          after: [{ price_cents: 699 }],
          before: [{ price_cents: 499 }],
        }),
      ),
      "Price raised from $4.99 to $6.99.",
    );
  });

  it("keeps grouped price and discount values in their correct units", () => {
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["price_cents", "is_free", "discount_percent"],
          after: [3249, 35],
          before: [4999, 0],
        }),
      ),
      "Price lowered from $49.99 to $32.49 (35% off).",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: [
            "price_cents",
            "is_free",
            "discount_percent",
            "has_purchase_packages",
          ],
          after: [3249, 35, ["package:123"]],
          before: [4999, 0, ["package:123"]],
        }),
      ),
      "Price lowered from $49.99 to $32.49 (35% off).",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["price_cents", "discount_percent"],
          after: [{ discount_percent: 35, price_cents: 3249 }],
          before: [{ discount_percent: 0, price_cents: 4999 }],
        }),
      ),
      "Price lowered from $49.99 to $32.49 (35% off).",
    );
  });

  it("describes discount-only changes as percentages instead of prices", () => {
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["discount_percent"],
          after: [35],
          before: [0],
        }),
      ),
      "A Steam discount started at 35% off.",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["discount_percent"],
          after: [0],
          before: [35],
        }),
      ),
      "The 35% Steam discount ended.",
    );
  });

  it("describes free-to-play and paid transitions", () => {
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["is_free", "price_cents"],
          after: [{ is_free: true, price_cents: 0 }],
          before: [{ is_free: false, price_cents: 999 }],
        }),
      ),
      "The game became free to play.",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["is_free", "price_cents"],
          after: [{ is_free: false, price_cents: 999 }],
          before: [{ is_free: true, price_cents: 0 }],
        }),
      ),
      "The game changed from free to play to a paid release.",
    );
  });

  it("resolves Steam tag and category IDs without exposing numbers", () => {
    const taxonomy = {
      categories: new Map([
        ["18", "Partial Controller Support"],
        ["55", "Steam Achievements"],
      ]),
      genres: new Map<string, string>(),
      tags: new Map([
        ["4195", "Roguelike"],
        ["4305", "Deckbuilding"],
      ]),
    };
    const tagSummary = describeOpportunityChange(
      change({
        affectedRuleFields: ["tags"],
        after: [[4195, 4305]],
        before: [[]],
        eventType: "taxonomy_repositioned",
        signalFamily: "taxonomy",
      }),
      "materially_changed",
      taxonomy,
    );
    const categorySummary = describeOpportunityChange(
      change({
        affectedRuleFields: ["categories"],
        after: [[18, 55]],
        before: [[]],
        eventType: "taxonomy_repositioned",
        signalFamily: "taxonomy",
      }),
      "materially_changed",
      taxonomy,
    );

    assert.equal(tagSummary, "Tags added: Roguelike and Deckbuilding.");
    assert.equal(
      categorySummary,
      "Steam features added: Partial Controller Support and Steam Achievements.",
    );
    assert.doesNotMatch(
      `${tagSummary} ${categorySummary}`,
      /\b(?:18|55|4195|4305)\b/,
    );
  });

  it("describes developer and publisher changes by name", () => {
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["developer"],
          after: [{ developers: ["CREEK &amp; RIVER"] }],
          before: [{ developers: ["Old Studio"] }],
          eventType: "developer_changed",
          signalFamily: "store-page",
        }),
      ),
      "Developer changed from Old Studio to CREEK & RIVER.",
    );
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: ["publisher"],
          after: [{ publishers: ["New Publisher"] }],
          before: [{ publishers: ["Old Publisher"] }],
          eventType: "publisher_changed",
          signalFamily: "store-page",
        }),
      ),
      "Publisher changed from Old Publisher to New Publisher.",
    );
  });

  it("decodes named and numeric HTML entities as text", () => {
    assert.equal(
      decodeOpportunityText("CREEK &amp; RIVER &#38; FRIENDS &#x26; CO."),
      "CREEK & RIVER & FRIENDS & CO.",
    );
  });

  it("cleans internal smoke-test profile names", () => {
    assert.equal(
      cleanOpportunityProfileName(
        "Production smoke — Roguelike Deckbuilder — 2026-07-27",
      ),
      "Roguelike Deckbuilder",
    );
  });

  it("explains the Vampire Crawlers build change specifically", () => {
    assert.equal(
      describeOpportunityChange(
        change({
          affectedRuleFields: [],
          after: ["23803422", "2026-06-23T13:00:28+00:00"],
          before: ["23012943", "2026-04-30T10:01:00"],
          eventType: "material_change",
          signalFamily: "build",
        }),
      ),
      "A new Steam build was published on Jun 23, 2026.",
    );
  });
});
