#!/usr/bin/env node

import { findLatestRunId, getCurrentRunId, loadState, renderDashboard } from './lib/state.mjs';

async function main() {
  const runId = await getCurrentRunId();
  const effectiveRunId = runId || (await findLatestRunId());
  if (!effectiveRunId) {
    console.log('No active chat-autolab run.');
    return;
  }

  while (true) {
    const state = await loadState(effectiveRunId);
    if (process.stdout.isTTY) {
      console.clear();
    }
    process.stdout.write(renderDashboard(state));

    if (!runId || ['success', 'needs_manual_review', 'needs_context', 'failed'].includes(state.status)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
