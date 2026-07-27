import { randomUUID } from "node:crypto";

import { logger } from "@publisheriq/shared";

import { getDataPlanePool, shutdownPool } from "../pg.js";
import {
  loadOpportunityDestinationCipher,
  OpportunityDeliveryDispatcher,
  OpportunityDeliveryRepository,
  OpportunityHttpDeliveryProvider,
  OpportunityWorker,
  OpportunityWorkerRepository,
} from "../opportunity/index.js";

const log = logger.child({ worker: "steam-opportunity" });

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const workerId = process.env.WORKER_ID ?? `opportunity-${randomUUID()}`;
  const pollIntervalMs = positiveInteger(process.env.POLL_INTERVAL_MS, 5_000);
  const claimLimit = positiveInteger(process.env.CLAIM_LIMIT, 8);
  const deliveryLimit = positiveInteger(process.env.DELIVERY_CLAIM_LIMIT, 10);
  const maxIdlePolls = Math.max(
    0,
    Number.parseInt(process.env.MAX_IDLE_POLLS ?? "0", 10) || 0,
  );
  const websiteBaseUrl =
    process.env.OPPORTUNITY_WEBSITE_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3001";
  const pool = getDataPlanePool();
  const worker = new OpportunityWorker(new OpportunityWorkerRepository(pool), {
    claimLimit,
    websiteBaseUrl,
    workerId,
  });
  const cipher = loadOpportunityDestinationCipher();
  const deliveryDispatcher = cipher
    ? new OpportunityDeliveryDispatcher(
        new OpportunityDeliveryRepository(pool),
        cipher,
        new OpportunityHttpDeliveryProvider({
          resendApiKey: process.env.RESEND_API_KEY ?? "",
          resendFrom:
            process.env.OPPORTUNITY_EMAIL_FROM ??
            "PublisherIQ <opportunities@publisheriq.com>",
        }),
        workerId,
      )
    : null;
  let shuttingDown = false;
  let idlePolls = 0;

  const stop = (): void => {
    shuttingDown = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  log.info("Starting Steam opportunity worker", {
    claimLimit,
    deliveryEnabled: Boolean(deliveryDispatcher),
    deliveryLimit,
    maxIdlePolls: maxIdlePolls || null,
    pollIntervalMs,
    websiteBaseUrl,
    workerId,
  });

  try {
    while (!shuttingDown) {
      const evaluation = await worker.runOnce();
      const deliveries = deliveryDispatcher
        ? await deliveryDispatcher.runOnce(deliveryLimit)
        : 0;
      const active =
        evaluation.claimed > 0 || evaluation.scheduled > 0 || deliveries > 0;
      idlePolls = active ? 0 : idlePolls + 1;

      if (active) {
        log.info("Processed opportunity work", {
          claimed: evaluation.claimed,
          deliveries,
          scheduled: evaluation.scheduled,
          workerId,
        });
      }
      if (maxIdlePolls > 0 && idlePolls >= maxIdlePolls) {
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }
  } finally {
    await shutdownPool();
  }
}

main().catch((error) => {
  log.error("Steam opportunity worker stopped unexpectedly", { error });
  process.exitCode = 1;
});
