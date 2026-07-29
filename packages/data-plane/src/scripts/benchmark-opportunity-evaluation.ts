import { runOpportunityPerformanceBenchmark } from "../opportunity/performance-benchmark.js";

const report = runOpportunityPerformanceBenchmark();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
