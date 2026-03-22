import { execFile } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { promisify } from 'node:util';

import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_GOLDEN_GOAL,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_PORT,
  DEFAULT_REMOTE,
  ROOT,
} from './constants.mjs';
import { runCodexIteration } from './codex-runner.mjs';
import { authenticate, loadAutolabEnv, validateAutolabEnv } from './env.mjs';
import { evaluatePrompt } from './eval-client.mjs';
import {
  commitAll,
  createWorktree,
  discardWorkingTree,
  ensureSafeRemote,
  getChangedFiles,
  getHeadSha,
  hasWorkingTreeChanges,
  pushBranch,
} from './git.mjs';
import { buildPromptInventory, chooseNextPrompt, discoverPromptCandidates } from './inventory.mjs';
import { judgePrompt } from './judge.mjs';
import { ensureLocalServer } from './server.mjs';
import {
  appendEvent,
  applyUsageToState,
  buildRunPaths,
  clearCurrentRun,
  createInitialState,
  getPromptResult,
  initRunStorage,
  loadState,
  saveState,
  setCurrentPhase,
  upsertPromptResult,
} from './state.mjs';

const execFileAsync = promisify(execFile);

export async function runCampaign({
  runId = null,
  note = '',
  port = DEFAULT_PORT,
  remote = DEFAULT_REMOTE,
  baseBranch = DEFAULT_BASE_BRANCH,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  goldenGoal = DEFAULT_GOLDEN_GOAL,
  onStateChange = null,
}) {
  const env = await loadAutolabEnv();
  validateAutolabEnv(env);

  const activeRunId = runId || buildRunId();
  const paths = await initRunStorage(activeRunId);
  const state =
    runId
      ? await loadState(runId)
      : createInitialState({
          runId: activeRunId,
          port,
          remote,
          baseBranch,
          maxIterations,
          goldenGoal,
          note,
        });

  await updateState(state, onStateChange);
  await ensureSafeRemote(state.remote);

  if (!state.worktreeDir) {
    state.branch = state.branch || `chat-autolab/${state.runId}`;
    state.worktreeDir = path.join(paths.runDir, 'worktree');
    await createWorktree({
      runId: state.runId,
      branch: state.branch,
      baseBranch: state.baseBranch,
      worktreeDir: state.worktreeDir,
    });
    await appendEvent(state, {
      type: 'worktree_created',
      message: `Created worktree ${state.worktreeDir} on branch ${state.branch}.`,
    });
    await updateState(state, onStateChange);
  }

  const server = await ensureLocalServer({
    cwd: state.worktreeDir,
    port: state.port,
    serverLogPath: paths.serverLogPath,
    env,
    existingPid: state.server.pid,
  });
  state.evalOrigin = server.origin;
  state.evalSecret = server.evalSecret;
  state.server = {
    pid: server.pid,
    startedByAutolab: server.startedByAutolab,
  };
  await appendEvent(state, {
    type: 'server_ready',
    message: `Local admin server ready at ${state.evalOrigin}.`,
  });
  await updateState(state, onStateChange);

  const auth = await authenticate(state.evalOrigin, env);

  if (!state.promptResults.length) {
    setCurrentPhase(state, 'baselining', 'Evaluate the initial seed inventory and build the backlog.');
    await updateState(state, onStateChange);
    const inventory = await buildPromptInventory();
    const discoveredPrompts = await discoverPromptCandidates({
      databaseUrl: env.DATABASE_URL,
    });
    state.discoveredPrompts = discoveredPrompts;
    await appendEvent(state, {
      type: 'inventory_loaded',
      message: `Loaded ${inventory.length} seed prompts and ${discoveredPrompts.length} discovered prompts.`,
    });
    await updateState(state, onStateChange);

    const initialPrompts = dedupePromptEntries([...inventory, ...discoveredPrompts]);
    for (const promptEntry of initialPrompts) {
    const result = await evaluateAndJudgePrompt({
      origin: state.evalOrigin,
      evalSecret: state.evalSecret,
      auth,
        promptEntry,
        baselineResult: null,
      });
      upsertPromptResult(state, result);
      state.baseline = buildBaselineSummary(state);
      state.best.score = computeCampaignScore(state);
      state.baseline.score = state.best.score;
      await appendEvent(state, {
        type: 'prompt_baselined',
        message: `Baselined ${promptEntry.prompt} at ${result.score.toFixed(1)}.`,
      });
      await updateState(state, onStateChange);
    }
  }

  state.best.score = computeCampaignScore(state);
  await updateState(state, onStateChange);

  while (state.iterations.total < state.campaignBudget.maxIterations) {
    state.baseline = buildBaselineSummary(state);
    const nextPrompt = chooseNextPrompt(state);
    if (!nextPrompt) {
      break;
    }

    if (nextPrompt.isGolden && nextPrompt.score >= state.campaignBudget.goldenGoal) {
      break;
    }

    state.current.promptId = nextPrompt.id;
    state.current.prompt = nextPrompt.prompt;
    state.current.area = nextPrompt.area;
    state.current.family = nextPrompt.family;
    state.current.persona = nextPrompt.persona;
    state.current.touchedFiles = [];
    state.current.hypothesis = nextPrompt.rationale || 'Target the narrowest code path that fixes the current lead prompt.';
    setCurrentPhase(state, 'editing', `Run one Codex iteration for "${nextPrompt.prompt}".`);
    await appendEvent(state, {
      type: 'prompt_selected',
      message: `Selected lead prompt: ${nextPrompt.prompt}`,
    });
    await updateState(state, onStateChange);

    const codexPrompt = buildCodexPrompt(nextPrompt, state);
    const agentResult = await runCodexIteration({
      cwd: state.worktreeDir,
      prompt: codexPrompt,
      lastMessagePath: paths.lastMessagePath,
      onEvent: async (message) => {
        await appendEvent(state, {
          type: 'agent_note',
          message: truncate(message, 180),
        });
        await updateState(state, onStateChange);
      },
    });
    applyUsageToState(state, 'agent', agentResult.usage);
    state.current.hypothesis = agentResult.lastMessage || state.current.hypothesis;
    state.current.touchedFiles = await getChangedFiles(state.worktreeDir);
    await updateState(state, onStateChange);

    if (!(await hasWorkingTreeChanges(state.worktreeDir))) {
      state.iterations.total += 1;
      state.iterations.discarded += 1;
      nextPrompt.discardCount = Number(nextPrompt.discardCount || 0) + 1;
      await appendEvent(state, {
        type: 'discard',
        message: `Discarded ${nextPrompt.prompt} because Codex did not change the worktree.`,
      });
      markManualReviewIfNeeded(state, nextPrompt);
      state.latest = {
        score: nextPrompt.score,
        verdict: 'discard',
        reason: 'No worktree changes were produced.',
      };
      await updateState(state, onStateChange);
      continue;
    }

    setCurrentPhase(state, 'targeted_verify', `Run code guard and targeted prompt verification for "${nextPrompt.prompt}".`);
    await updateState(state, onStateChange);
    const codeGuard = await runCodeGuard(state.worktreeDir, state.current.touchedFiles);
    state.lastGuard.code = codeGuard.success;
    if (!codeGuard.success) {
      await discardWorkingTree(state.worktreeDir);
      state.iterations.total += 1;
      state.iterations.discarded += 1;
      nextPrompt.discardCount = Number(nextPrompt.discardCount || 0) + 1;
      await appendEvent(state, {
        type: 'discard',
        message: `Discarded ${nextPrompt.prompt} because the code guard failed.`,
      });
      markManualReviewIfNeeded(state, nextPrompt);
      state.latest = {
        score: nextPrompt.score,
        verdict: 'discard',
        reason: 'Code guard failed.',
      };
      await updateState(state, onStateChange);
      continue;
    }

    const leadBaseline = getPromptResult(state, nextPrompt.id);
    const leadResult = await evaluateAndJudgePrompt({
      env,
      origin: state.evalOrigin,
      evalSecret: state.evalSecret,
      auth,
      promptEntry: nextPrompt,
      baselineResult: leadBaseline,
    });
    applyUsageToState(state, 'answer', leadResult.answerUsage);
    applyUsageToState(state, 'judge', leadResult.judgeUsage);

    const goldenResults = await evaluateGoldenPack({
      env,
      origin: state.evalOrigin,
      evalSecret: state.evalSecret,
      auth,
      state,
    });

    const hasGoldenRegression = goldenResults.some(
      (result) =>
        result.pairwiseVerdict === 'worse' ||
        (result.blockingFlags?.length || 0) > 0
    );
    const leadImproved =
      leadResult.score > Number(leadBaseline?.score || 0) ||
      (leadBaseline?.blockingFlags?.length || 0) > (leadResult.blockingFlags?.length || 0);

    if (!leadImproved || hasGoldenRegression) {
      await discardWorkingTree(state.worktreeDir);
      state.iterations.total += 1;
      state.iterations.discarded += 1;
      nextPrompt.discardCount = Number(nextPrompt.discardCount || 0) + 1;
      await appendEvent(state, {
        type: 'discard',
        message: `Discarded ${nextPrompt.prompt} because it failed the targeted or golden gate.`,
      });
      markManualReviewIfNeeded(state, nextPrompt);
      state.latest = {
        score: leadResult.score,
        verdict: 'discard',
        reason: hasGoldenRegression ? 'Golden regression detected.' : 'Lead prompt did not improve.',
      };
      await updateState(state, onStateChange);
      continue;
    }

    if (shouldRunFullVerify(state.current.touchedFiles, state.iterations.accepted)) {
      setCurrentPhase(state, 'full_verify', 'Run the broader sections 1-5 verification pass.');
      await updateState(state, onStateChange);
      const fullResults = await evaluateFrontier({
        env,
        origin: state.evalOrigin,
        evalSecret: state.evalSecret,
        auth,
        state,
      });
      state.lastGuard.full = !fullResults.some((result) => result.pairwiseVerdict === 'worse');
      if (!state.lastGuard.full) {
        await discardWorkingTree(state.worktreeDir);
        state.iterations.total += 1;
        state.iterations.discarded += 1;
        nextPrompt.discardCount = Number(nextPrompt.discardCount || 0) + 1;
        await appendEvent(state, {
          type: 'discard',
          message: `Discarded ${nextPrompt.prompt} because the full verification pass regressed.`,
        });
        markManualReviewIfNeeded(state, nextPrompt);
        state.latest = {
          score: leadResult.score,
          verdict: 'discard',
          reason: 'Full verification regressed.',
        };
        await updateState(state, onStateChange);
        continue;
      }
      for (const result of fullResults) {
        upsertPromptResult(state, result);
      }
    }

    upsertPromptResult(state, leadResult);
    for (const result of goldenResults) {
      upsertPromptResult(state, result);
    }

    const commitSha = await commitAll({
      cwd: state.worktreeDir,
      message: `chat-autolab: improve ${nextPrompt.area} for ${nextPrompt.id}`,
    });
    await pushBranch({
      cwd: state.worktreeDir,
      remote: state.remote,
      branch: state.branch,
    });

    state.iterations.total += 1;
    state.iterations.accepted += 1;
    state.best.score = computeCampaignScore(state);
    state.best.sha = commitSha;
    state.best.acceptedAt = new Date().toISOString();
    state.latest = {
      score: leadResult.score,
      verdict: 'keep',
      reason: `Accepted ${nextPrompt.prompt} after passing the golden gate.`,
    };
    await appendEvent(state, {
      type: 'keep',
      message: `Kept ${nextPrompt.prompt} at ${leadResult.score.toFixed(1)} and pushed ${commitSha.slice(0, 7)}.`,
    });
    await updateState(state, onStateChange);
  }

  state.baseline = buildBaselineSummary(state);
  if (state.baseline.goldenAtGoal === state.baseline.totalGoldens && state.manualReview.length === 0) {
    setCurrentPhase(state, 'success', 'All active golden prompts meet the quality target.');
  } else {
    setCurrentPhase(state, 'needs_manual_review', 'Some prompts still need manual review.');
  }
  await appendEvent(state, {
    type: 'campaign_complete',
    message: `Campaign finished with status ${state.status}.`,
  });
  await updateState(state, onStateChange);
  await clearCurrentRun(state.runId);
  return state;
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function updateState(state, onStateChange) {
  await saveState(state);
  if (onStateChange) {
    await onStateChange(state);
  }
}

function dedupePromptEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

async function evaluateAndJudgePrompt({
  origin,
  evalSecret,
  auth,
  promptEntry,
  baselineResult,
}) {
  const evalResult = await evaluatePrompt({
    origin,
    evalSecret,
    auth,
    prompt: promptEntry.prompt,
  });
  const judgeResult = await judgePrompt({
    promptEntry,
    currentResult: evalResult,
    baselineResult,
  });

  return {
    id: promptEntry.id,
    prompt: promptEntry.prompt,
    area: promptEntry.area,
    family: promptEntry.family,
    persona: promptEntry.persona,
    critiqueRef: promptEntry.critiqueRef,
    isGolden: promptEntry.isGolden,
    source: promptEntry.source,
    status: evalResult.status,
    answer: evalResult.answer,
    toolCalls: evalResult.toolCalls,
    iterations: evalResult.iterations,
    timing: evalResult.timing,
    score: judgeResult.score,
    subscores: judgeResult.subscores,
    blockingFlags: judgeResult.blockingFlags,
    rationale: judgeResult.rationale,
    pairwiseVerdict: judgeResult.pairwiseVerdict,
    pairwiseReason: judgeResult.pairwiseReason,
    answerUsage: evalResult.usage || zeroUsage(),
    judgeUsage: judgeResult.usage || zeroUsage(),
  };
}

async function evaluateGoldenPack({ env, origin, evalSecret, auth, state }) {
  const goldens = state.promptResults.filter((entry) => entry.isGolden);
  const results = [];
  setCurrentPhase(state, 'golden_verify', 'Run the golden verification pack.');

  for (const golden of goldens) {
    const result = await evaluateAndJudgePrompt({
      env,
      origin,
      evalSecret,
      auth,
      promptEntry: golden,
      baselineResult: golden,
    });
    applyUsageToState(state, 'answer', result.answerUsage);
    applyUsageToState(state, 'judge', result.judgeUsage);
    results.push(result);
    state.lastGuard.golden = !results.some((row) => row.pairwiseVerdict === 'worse');
  }

  return results;
}

async function evaluateFrontier({ env, origin, evalSecret, auth, state }) {
  const frontier = state.promptResults.filter((entry) => !entry.isGolden);
  const results = [];
  for (const promptEntry of frontier) {
    const result = await evaluateAndJudgePrompt({
      env,
      origin,
      evalSecret,
      auth,
      promptEntry,
      baselineResult: promptEntry,
    });
    applyUsageToState(state, 'answer', result.answerUsage);
    applyUsageToState(state, 'judge', result.judgeUsage);
    results.push(result);
  }
  return results;
}

function buildBaselineSummary(state) {
  const goldens = state.promptResults.filter((entry) => entry.isGolden);
  return {
    score: computeCampaignScore(state),
    totalGoldens: goldens.length,
    goldenAtGoal: goldens.filter((entry) => entry.score >= state.campaignBudget.goldenGoal).length,
    blockingCount: goldens.filter((entry) => (entry.blockingFlags?.length || 0) > 0).length,
  };
}

function computeCampaignScore(state) {
  const goal = state.campaignBudget.goldenGoal;
  const goldens = state.promptResults.filter((entry) => entry.isGolden);
  const frontier = state.promptResults.filter((entry) => !entry.isGolden);
  const regressionViolations = goldens.filter((entry) => entry.pairwiseVerdict === 'worse' || (entry.blockingFlags?.length || 0) > 0).length;
  const goldenBelowGoal = goldens.filter((entry) => entry.score < goal).length;
  const frontierBelowGoal = frontier.filter((entry) => entry.score < goal).length;
  const goldenScoreSum = goldens.reduce((sum, entry) => sum + Number(entry.score || 0), 0);
  const frontierScoreSum = frontier.reduce((sum, entry) => sum + Number(entry.score || 0), 0);

  return (
    10_000_000 -
    regressionViolations * 1_000_000 -
    goldenBelowGoal * 10_000 -
    frontierBelowGoal * 100 +
    Math.round(goldenScoreSum * 10) +
    Math.round(frontierScoreSum)
  );
}

async function runCodeGuard(cwd, touchedFiles) {
  const commands = [['pnpm', ['--filter', '@publisheriq/admin', 'build']]];
  if (touchedFiles.some((file) => file.startsWith('packages/shared/'))) {
    commands.push(['pnpm', ['--filter', '@publisheriq/shared', 'build']]);
  }
  if (touchedFiles.some((file) => file.startsWith('packages/database/'))) {
    commands.push(['pnpm', ['--filter', '@publisheriq/database', 'build']]);
  }

  try {
    for (const [command, args] of commands) {
      await execFileAsync(command, args, {
        cwd,
        maxBuffer: 1024 * 1024 * 8,
      });
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function shouldRunFullVerify(touchedFiles, acceptedCount) {
  const sharedChange = touchedFiles.some((file) =>
    file.startsWith('apps/admin/src/app/api/chat/') ||
    file.startsWith('apps/admin/src/lib/llm/') ||
    file.startsWith('apps/admin/src/lib/chat/')
  );
  return sharedChange || (acceptedCount > 0 && acceptedCount % 3 === 0);
}

function buildCodexPrompt(promptEntry, state) {
  return [
    'You are running one bounded chat-autolab iteration inside PublisherIQ.',
    `Lead prompt: ${promptEntry.prompt}`,
    `Area: ${promptEntry.area}`,
    `Persona: ${promptEntry.persona}`,
    `Current score: ${Number(promptEntry.score || 0).toFixed(1)}`,
    `Known blocking flags: ${(promptEntry.blockingFlags || []).join(', ') || 'none'}`,
    '',
    'Task:',
    '- Inspect the narrowest relevant code path.',
    '- Make one targeted change to improve this prompt.',
    '- Keep scope tight and avoid broad refactors.',
    '- Do not commit.',
    '- Do not run prompt evaluations; chat-autolab will verify the result.',
    '',
    `Current campaign note: ${state.note || 'none'}`,
    `Latest rationale: ${promptEntry.rationale || 'none'}`,
  ].join('\n');
}

function markManualReviewIfNeeded(state, promptEntry) {
  const maxDiscards = state.campaignBudget.maxDiscardsPerPrompt;
  const discardCount = Number(promptEntry.discardCount || 0);
  if (discardCount < maxDiscards) {
    return;
  }
  if (!state.manualReview.find((entry) => entry.id === promptEntry.id)) {
    state.manualReview.push({
      id: promptEntry.id,
      prompt: promptEntry.prompt,
      area: promptEntry.area,
      score: promptEntry.score,
      discardCount,
      recordedAt: new Date().toISOString(),
    });
  }
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export async function promptForCampaignNote() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const note = await rl.question('Campaign note (optional, press enter to skip): ');
    return note.trim();
  } finally {
    rl.close();
  }
}
