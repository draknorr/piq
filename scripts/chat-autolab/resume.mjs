#!/usr/bin/env node

import { getCurrentRunId, renderDashboard } from './lib/state.mjs';
import { runCampaign } from './lib/campaign.mjs';

async function main() {
  const runId = await getCurrentRunId();
  if (!runId) {
    throw new Error('No active chat-autolab run is available to resume.');
  }
  const maxIterations = parsePositiveInt(process.env.CHAT_AUTOLAB_MAX_ITERATIONS);

  await runCampaign({
    runId,
    maxIterations: maxIterations ?? undefined,
    onStateChange: async (state) => {
      if (process.stdout.isTTY) {
        console.clear();
      }
      process.stdout.write(renderDashboard(state));
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
