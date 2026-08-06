import { runOpportunityPerformanceBenchmark } from "../opportunity/performance-benchmark.js";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index]!;
}

const iterations = boundedInteger(
  process.env.OPPORTUNITY_BENCHMARK_ITERATIONS,
  1,
  100,
);
const warmups = boundedInteger(
  process.env.OPPORTUNITY_BENCHMARK_WARMUPS,
  iterations > 1 ? 5 : 1,
  20,
);
const verification = {
  baseline: runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: false,
  }),
  v2: runOpportunityPerformanceBenchmark({ includeReviewPriorityV2: true }),
};
for (let index = 0; index < warmups; index += 1) {
  runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: false,
    verifyOutput: false,
  });
  runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: true,
    verifyOutput: false,
  });
}
const samples = Array.from({ length: iterations }, (_, index) => {
  const v2First = index % 2 === 1;
  const first = runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: v2First,
    verifyOutput: false,
  });
  const second = runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: !v2First,
    verifyOutput: false,
  });
  return {
    baseline: v2First ? second : first,
    v2: v2First ? first : second,
  };
});
const modes = ["cold", "warm"] as const;
const phases = [
  "inputPreparationMs",
  "profileEvaluationMs",
  "cohortResolutionMs",
  "marketCalculationMs",
  "persistenceMs",
] as const;
const summary = Object.fromEntries(
  modes.map((mode) => {
    const paired = samples.map((sample) => {
      const baselinePass = sample.baseline.passes[mode];
      const v2Pass = sample.v2.passes[mode];
      const sharedMs =
        (baselinePass.timings.inputPreparationMs +
          v2Pass.timings.inputPreparationMs) /
          2 +
        (baselinePass.timings.profileEvaluationMs +
          v2Pass.timings.profileEvaluationMs) /
          2 +
        (baselinePass.timings.cohortResolutionMs +
          v2Pass.timings.cohortResolutionMs) /
          2 +
        (baselinePass.marketContextMs + v2Pass.marketContextMs) / 2 +
        (baselinePass.candidatePersistenceMs + v2Pass.candidatePersistenceMs) /
          2;
      return {
        baseline:
          sharedMs +
          baselinePass.reviewPriorityMs +
          baselinePass.resultPersistenceMs,
        v2: sharedMs + v2Pass.reviewPriorityMs + v2Pass.resultPersistenceMs,
      };
    });
    const baseline = paired.map((sample) => sample.baseline);
    const v2 = paired.map((sample) => sample.v2);
    const rawBaseline = samples.map(
      (sample) => sample.baseline.passes[mode].timings.totalMs,
    );
    const rawV2 = samples.map(
      (sample) => sample.v2.passes[mode].timings.totalMs,
    );
    const ratios = v2.map((value, index) => value / baseline[index]!);
    return [
      mode,
      {
        baselineMs: {
          p50: percentile(baseline, 0.5),
          p95: percentile(baseline, 0.95),
        },
        regressionRatio: {
          p50: percentile(ratios, 0.5),
          p95: percentile(ratios, 0.95),
        },
        phaseTimingsMs: Object.fromEntries(
          phases.map((phase) => [
            phase,
            {
              baselineP50: percentile(
                samples.map(
                  (sample) => sample.baseline.passes[mode].timings[phase],
                ),
                0.5,
              ),
              v2P50: percentile(
                samples.map((sample) => sample.v2.passes[mode].timings[phase]),
                0.5,
              ),
            },
          ]),
        ),
        rawTotalMs: {
          baselineP50: percentile(rawBaseline, 0.5),
          v2P50: percentile(rawV2, 0.5),
        },
        throughputRatio: {
          p50: percentile(
            ratios.map((ratio) => 1 / ratio),
            0.5,
          ),
          p95: percentile(
            ratios.map((ratio) => 1 / ratio),
            0.95,
          ),
        },
        v2Ms: {
          p50: percentile(v2, 0.5),
          p95: percentile(v2, 0.95),
        },
      },
    ];
  }),
);
const gates = Object.fromEntries(
  modes.map((mode) => [
    mode,
    summary[mode].regressionRatio.p50 <= 1.05 &&
      summary[mode].regressionRatio.p95 <= 1.05,
  ]),
);
const interimP50Gates = Object.fromEntries(
  modes.map((mode) => [mode, summary[mode].regressionRatio.p50 <= 1.25]),
);
process.stdout.write(
  `${JSON.stringify(
    {
      fixture: samples[0]!.v2.fixture,
      gates,
      interimP50Gates,
      iterations,
      normalization:
        "paired mean of identical input/profile/cohort/market-context/candidate-persistence phases; variant result-finalization and result-persistence phases remain measured independently",
      outputDigests: {
        baseline: verification.baseline.passes.cold.outputDigest,
        v2: verification.v2.passes.cold.outputDigest,
      },
      outputParity:
        verification.baseline.outputParity && verification.v2.outputParity,
      summary,
      warmups,
    },
    null,
    2,
  )}\n`,
);
