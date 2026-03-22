#!/usr/bin/env node

import { runCampaign, promptForCampaignNote } from './lib/campaign.mjs';
import { renderDashboard } from './lib/state.mjs';

async function main() {
  const note = await promptForCampaignNote();
  const maxIterations = parsePositiveInt(process.env.CHAT_AUTOLAB_MAX_ITERATIONS);
  await runCampaign({
    note,
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
