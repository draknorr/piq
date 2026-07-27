import { logger } from "@publisheriq/shared";

import { OpportunityWorkerRepository } from "../opportunity/index.js";
import { getDataPlanePool, shutdownPool } from "../pg.js";

const log = logger.child({ worker: "steam-opportunity-reconciliation" });
const MAX_PASSES = 10;

function boundedPasses(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PASSES) {
    throw new Error(
      `OPPORTUNITY_RECONCILE_PASSES must be between 1 and ${MAX_PASSES}.`,
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const passes = boundedPasses(process.env.OPPORTUNITY_RECONCILE_PASSES);
  const repository = new OpportunityWorkerRepository(getDataPlanePool());
  let materialized = 0;
  let completedPasses = 0;

  try {
    for (let pass = 1; pass <= passes; pass += 1) {
      const inserted = await repository.materializeEvents();
      materialized += inserted;
      completedPasses = pass;
      log.info("Completed bounded opportunity event reconciliation pass", {
        inserted,
        pass,
        passes,
      });
      if (inserted === 0) {
        break;
      }
    }
  } finally {
    await shutdownPool();
  }

  log.info("Completed Steam opportunity event reconciliation", {
    completedPasses,
    materialized,
    requestedPasses: passes,
  });
}

main().catch((error) => {
  log.error("Steam opportunity reconciliation failed", { error });
  process.exitCode = 1;
});
