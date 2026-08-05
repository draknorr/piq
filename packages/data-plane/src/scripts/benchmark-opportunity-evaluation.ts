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
for (let index = 0; index < warmups; index += 1) {
  runOpportunityPerformanceBenchmark({ includeReviewPriorityV2: false });
  runOpportunityPerformanceBenchmark({ includeReviewPriorityV2: true });
}
const samples = Array.from({ length: iterations }, (_, index) => {
  const v2First = index % 2 === 1;
  const first = runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: v2First,
  });
  const second = runOpportunityPerformanceBenchmark({
    includeReviewPriorityV2: !v2First,
  });
  return {
    baseline: v2First ? second : first,
    v2: v2First ? first : second,
  };
});
const modes = ["cold", "warm"] as const;
const summary = Object.fromEntries(
  modes.map((mode) => {
    const baseline = samples.map(
      (sample) => sample.baseline.passes[mode].timings.totalMs,
    );
    const v2 = samples.map((sample) => sample.v2.passes[mode].timings.totalMs);
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
        throughputRatio: {
          p50: percentile(ratios.map((ratio) => 1 / ratio), 0.5),
          p95: percentile(ratios.map((ratio) => 1 / ratio), 0.95),
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
process.stdout.write(
  `${JSON.stringify(
    {
      fixture: samples[0]!.v2.fixture,
      gates,
      iterations,
      outputParity: samples.every(
        (sample) =>
          sample.baseline.outputParity &&
          sample.v2.outputParity &&
          sample.baseline.passes.cold.outputDigest ===
            sample.baseline.passes.warm.outputDigest &&
          sample.v2.passes.cold.outputDigest ===
            sample.v2.passes.warm.outputDigest,
      ),
      summary,
      warmups,
    },
    null,
    2,
  )}\n`,
);
