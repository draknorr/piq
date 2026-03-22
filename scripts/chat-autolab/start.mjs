#!/usr/bin/env node

import { runCampaign, promptForCampaignNote } from './lib/campaign.mjs';
import { renderDashboard } from './lib/state.mjs';

async function main() {
  const note = await promptForCampaignNote();
  await runCampaign({
    note,
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
