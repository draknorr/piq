import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  digestOpportunityBenchmarkOutput,
  OPPORTUNITY_PRODUCTION_SCALE_FIXTURE,
  runOpportunityPerformanceBenchmark,
} from "./performance-benchmark.js";

describe("opportunity production-scale performance fixture", () => {
  it("canonicalizes floating-point tails without hiding meaningful changes", () => {
    assert.equal(
      digestOpportunityBenchmarkOutput({ score: 0.1 + 0.2 }),
      digestOpportunityBenchmarkOutput({ score: 0.3 }),
    );
    assert.notEqual(
      digestOpportunityBenchmarkOutput({ score: 0.3 }),
      digestOpportunityBenchmarkOutput({ score: 0.300001 }),
    );
  });

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
    assert.ok(cold.resultPersistenceBytes > 0);
    assert.ok(cold.candidatePersistenceBytes > 0);
    assert.ok(cold.marketContextMs >= 0);
    assert.ok(cold.reviewPriorityMs > 0);
    assert.ok(cold.resultPersistenceMs > 0);
    assert.ok(cold.candidatePersistenceMs > 0);
    assert.equal(
      cold.outputDigest,
      "406bbe0ea37853f6f969ea0ed78e091a2424796d730c506dc361024196f0fa21",
    );
    assert.equal(warm.outputDigest, cold.outputDigest);
    const baseline = runOpportunityPerformanceBenchmark({
      includeReviewPriorityV2: false,
    });
    assert.ok(
      cold.resultPersistenceBytes > baseline.passes.cold.resultPersistenceBytes,
    );
    assert.ok(
      cold.resultPersistenceBytes <= 4.5 * 1024 * 1024,
      `expected compact V2 result envelope <= 4.5 MiB, received ${cold.resultPersistenceBytes} bytes`,
    );
    assert.equal(
      baseline.passes.cold.outputDigest,
      "7b625cb983f6f151939a62351a2e7c7157b40919bef1e264253ee03a85a44a52",
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
