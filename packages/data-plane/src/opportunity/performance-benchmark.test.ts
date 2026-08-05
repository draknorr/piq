import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPORTUNITY_PRODUCTION_SCALE_FIXTURE,
  runOpportunityPerformanceBenchmark,
} from "./performance-benchmark.js";

describe("opportunity production-scale performance fixture", () => {
  it("measures cold and warm phase timings with exact output parity", () => {
    const report = runOpportunityPerformanceBenchmark();
    const { cold, warm } = report.passes;

    assert.deepEqual(report.fixture, {
      candidateCount: 3_974,
      profileCount: 3,
      surfacedResultCount: 1_245,
    });
    assert.equal(report.localSyntheticOnly, true);
    assert.equal(report.outputParity, true);
    assert.equal(
      cold.candidateEvaluations,
      OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.candidateCount *
        OPPORTUNITY_PRODUCTION_SCALE_FIXTURE.profileCount,
    );
    assert.equal(cold.surfacedResults, 1_245);
    assert.equal(cold.cacheMisses, 1_245);
    assert.equal(cold.cacheHits, 0);
    assert.equal(warm.cacheMisses, 0);
    assert.equal(warm.cacheHits, 1_245);
    assert.equal(cold.resultPersistenceBatches, 13);
    assert.equal(cold.candidatePersistenceBatches, 24);
    assert.equal(
      cold.outputDigest,
      "27fa9be98349f4fe31d0a24d1a6debbf8ef1be9c48c584f9bf9bbbf8f3f2759c",
    );
    assert.equal(warm.outputDigest, cold.outputDigest);
    const baseline = runOpportunityPerformanceBenchmark({
      includeReviewPriorityV2: false,
    });
    assert.equal(
      baseline.passes.cold.outputDigest,
      "d2cb0d80127d5555db643776f26087914cb73ad6685649e1c1075e9362019312",
    );
    assert.ok(cold.timings.totalMs <= report.thresholds.coldMs);
    assert.ok(warm.timings.totalMs <= report.thresholds.warmMs);
    for (const pass of [cold, warm]) {
      assert.ok(pass.timings.inputPreparationMs >= 0);
      assert.ok(pass.timings.profileEvaluationMs >= 0);
      assert.ok(pass.timings.cohortResolutionMs >= 0);
      assert.ok(pass.timings.marketCalculationMs >= 0);
      assert.ok(pass.timings.persistenceMs >= 0);
      assert.ok(pass.timings.totalMs > 0);
    }
  });
});
