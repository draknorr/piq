import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MARKET_CALIBRATION,
  buildPercentileDistribution,
  calculateOpportunityMarketContext,
  calculateOpportunityPresetHealth,
  calculateOpportunityRanking,
} from "./intelligence.js";
import type { OpportunityCohortMember } from "./types.js";

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
      measuredGames: 20,
      positiveBreadth: 0.6,
      priorState: "growing",
      reviewAccelerationMedian: 0.5,
      topContributorShare: 0.3,
    });

    assert.equal(first.state, "growing");
    assert.equal(second.state, "surging");
  });
});
