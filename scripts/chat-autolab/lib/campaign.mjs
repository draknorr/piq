import { execFile } from 'node:child_process';
import readline from 'node:readline/promises';
import { promisify } from 'node:util';

import {
  DEFAULT_GOLDEN_GOAL,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_PORT,
  ROOT,
} from './constants.mjs';
import { runCodexIteration } from './codex-runner.mjs';
import { authenticate, loadAutolabEnv, validateAutolabEnv } from './env.mjs';
import { evaluatePrompt } from './eval-client.mjs';
import {
  commitAll,
  discardWorkingTreeChanges,
  ensureCampaignResume,
  ensureCampaignStart,
  getHeadSha,
  getWorkingTreeSnapshot,
} from './git.mjs';
import { buildPromptInventory, chooseNextPrompt, discoverPromptCandidates } from './inventory.mjs';
import { judgePrompt } from './judge.mjs';
import { ensureLocalServer, stopServerProcess } from './server.mjs';
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
          maxIterations,
          goldenGoal,
          note,
        });
  const managed = {
    server: null,
  };
  const unregisterStopHandlers = installStopHandlers({
    state,
    onStateChange,
    managed,
  });

  try {
    await updateState(state, onStateChange);
    if (runId) {
      if (!state.branch) {
        throw new Error('Stored chat-autolab run is missing branch metadata. Start a new campaign instead.');
      }
      await ensureCampaignResume({
        cwd: ROOT,
        branch: state.branch,
        anchorSha: state.best?.sha || state.startSha,
      });
      state.workspaceDir = ROOT;
      state.workspaceMode = 'current-branch';
      state.pushMode = 'local-only';
    } else {
      const gitState = await ensureCampaignStart(ROOT);
      state.branch = gitState.branch;
      state.startSha = gitState.headSha;
      state.workspaceDir = gitState.workspaceDir;
      state.best.sha = state.best.sha || gitState.headSha;
      await appendEvent(state, {
        type: 'campaign_attached',
        message: `Using current branch ${state.branch} at ${state.startSha.slice(0, 7)}.`,
      });
      await updateState(state, onStateChange);
    }

    const server = await ensureLocalServer({
      cwd: state.workspaceDir,
      port: state.port,
      serverLogPath: paths.serverLogPath,
      env,
      existingPid: state.server.pid,
    });
    managed.server = server.child || null;
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

    const baselineQueueState = await ensureBaselineQueue({
      state,
      databaseUrl: env.DATABASE_URL,
      baselineLimit: parseOptionalInt(env.CHAT_AUTOLAB_BASELINE_LIMIT),
      discoveredLimit: parseOptionalInt(env.CHAT_AUTOLAB_DISCOVERED_LIMIT),
    });
    if (baselineQueueState.initialized) {
      await appendEvent(state, {
        type: 'inventory_loaded',
        message: `Loaded ${baselineQueueState.seedCount} seed prompts and ${baselineQueueState.discoveredCount} discovered prompts; baselining ${baselineQueueState.queueCount}.`,
      });
      await updateState(state, onStateChange);
    }

    const pendingBaselines = getPendingBaselinePrompts(state);
    if (pendingBaselines.length > 0) {
      setCurrentPhase(state, 'baselining', 'Evaluate the initial seed inventory and build the backlog.');
      await updateState(state, onStateChange);

      for (const promptEntry of pendingBaselines) {
        state.current.promptId = promptEntry.id;
        state.current.prompt = promptEntry.prompt;
        state.current.area = promptEntry.area;
        state.current.family = promptEntry.family;
        state.current.persona = promptEntry.persona;
        state.current.hypothesis = null;
        state.current.touchedFiles = [];
        state.current.nextAction = `Baseline "${promptEntry.prompt}".`;
        await updateState(state, onStateChange);

        const result = await evaluateAndJudgePrompt({
          origin: state.evalOrigin,
          evalSecret: state.evalSecret,
          auth,
          promptEntry,
          baselineResult: null,
        });
        applyUsageToState(state, 'answer', result.answerUsage);
        applyUsageToState(state, 'judge', result.judgeUsage);
        upsertPromptResult(state, result);
        state.baseline = buildBaselineSummary(state);
        state.best.score = computeCampaignScore(state);
        state.baseline.score = state.best.score;
        state.latest = {
          score: result.score,
          verdict: 'baseline',
          reason: `Baselined ${promptEntry.prompt}.`,
        };
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
        cwd: state.workspaceDir,
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
      const candidateSnapshot = await getWorkingTreeSnapshot(state.workspaceDir);
      state.current.touchedFiles = candidateSnapshot.allFiles;
      await updateState(state, onStateChange);

      if (!candidateSnapshot.hasChanges) {
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
      const codeGuard = await runCodeGuard(state.workspaceDir, state.current.touchedFiles);
      state.lastGuard.code = codeGuard.success;
      if (!codeGuard.success) {
        await discardCandidateSnapshot(state, candidateSnapshot, onStateChange);
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
        origin: state.evalOrigin,
        evalSecret: state.evalSecret,
        auth,
        promptEntry: nextPrompt,
        baselineResult: leadBaseline,
      });
      applyUsageToState(state, 'answer', leadResult.answerUsage);
      applyUsageToState(state, 'judge', leadResult.judgeUsage);

      const goldenResults = await evaluateGoldenPack({
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
        await discardCandidateSnapshot(state, candidateSnapshot, onStateChange);
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
          origin: state.evalOrigin,
          evalSecret: state.evalSecret,
          auth,
          state,
        });
        state.lastGuard.full = !fullResults.some((result) => result.pairwiseVerdict === 'worse');
        if (!state.lastGuard.full) {
          await discardCandidateSnapshot(state, candidateSnapshot, onStateChange);
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

      const ownedSnapshot = await ensureOwnedCandidateSnapshot(state, candidateSnapshot, onStateChange);
      state.current.touchedFiles = ownedSnapshot.allFiles;
      const commitSha = await commitAll({
        cwd: state.workspaceDir,
        message: `chat-autolab: improve ${nextPrompt.area} for ${nextPrompt.id}`,
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
        message: `Kept ${nextPrompt.prompt} at ${leadResult.score.toFixed(1)} and committed ${commitSha.slice(0, 7)} locally.`,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!['needs_context', 'failed'].includes(state.status)) {
      setCurrentPhase(state, 'failed', message);
    } else {
      state.current.nextAction = message;
    }
    await appendEvent(state, {
      type: 'campaign_error',
      message,
    });
    await updateState(state, onStateChange);
    await clearCurrentRun(state.runId);
    throw error;
  } finally {
    unregisterStopHandlers();
    await stopServerProcess(managed.server);
  }
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function installStopHandlers({ state, onStateChange, managed }) {
  let shuttingDown = false;
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = new Map();

  for (const signal of signals) {
    const handler = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void handleStopSignal({ signal, state, onStateChange, managed }).finally(() => {
        process.exit(signal === 'SIGTERM' ? 143 : 130);
      });
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}

async function handleStopSignal({ signal, state, onStateChange, managed }) {
  try {
    if (['editing', 'targeted_verify', 'full_verify'].includes(state.current.phase)) {
      const snapshot = await getWorkingTreeSnapshot(state.workspaceDir);
      if (snapshot.hasChanges) {
        await discardWorkingTreeChanges(snapshot, state.workspaceDir);
      }
    }
  } catch {
    // Best-effort cleanup for interrupt handling.
  }

  try {
    await stopServerProcess(managed.server);
  } catch {
    // Best-effort cleanup for interrupt handling.
  }

  managed.server = null;
  state.server = {
    pid: null,
    startedByAutolab: false,
  };
  state.current.touchedFiles = [];
  setCurrentPhase(state, 'stopped', 'Run pnpm chat-autolab:resume to continue this campaign.');
  await appendEvent(state, {
    type: 'campaign_stopped',
    message: `Campaign stopped by ${signal}. Run pnpm chat-autolab:resume to continue.`,
  });
  await updateState(state, onStateChange);
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

async function ensureBaselineQueue({ state, databaseUrl, baselineLimit = null, discoveredLimit = null }) {
  if (state.baselineQueue.length > 0) {
    return {
      initialized: false,
      seedCount: countPromptsBySource(state.baselineQueue, 'seed'),
      discoveredCount: countPromptsBySource(state.baselineQueue, 'chat_query_logs'),
      queueCount: state.baselineQueue.length,
    };
  }

  const inventory = await buildPromptInventory();
  let discoveredPrompts = Array.isArray(state.discoveredPrompts) ? state.discoveredPrompts : [];

  if (discoveredPrompts.length === 0 && state.promptResults.length === 0) {
    discoveredPrompts = await discoverPromptCandidates({
      databaseUrl,
      limit: discoveredLimit ?? undefined,
    });
  }

  state.discoveredPrompts = discoveredPrompts;
  state.baselineQueue = dedupePromptEntries([...inventory, ...discoveredPrompts]);
  if (baselineLimit !== null) {
    state.baselineQueue = state.baselineQueue.slice(0, baselineLimit);
  }
  return {
    initialized: true,
    seedCount: inventory.length,
    discoveredCount: discoveredPrompts.length,
    queueCount: state.baselineQueue.length,
  };
}

function getPendingBaselinePrompts(state) {
  return state.baselineQueue.filter((entry) => !getPromptResult(state, entry.id));
}

function countPromptsBySource(entries, source) {
  return entries.filter((entry) => entry.source === source).length;
}

function parseOptionalInt(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
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

async function evaluateGoldenPack({ origin, evalSecret, auth, state }) {
  const goldens = state.promptResults.filter((entry) => entry.isGolden);
  const results = [];
  setCurrentPhase(state, 'golden_verify', 'Run the golden verification pack.');

  for (const golden of goldens) {
    const result = await evaluateAndJudgePrompt({
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

async function evaluateFrontier({ origin, evalSecret, auth, state }) {
  const frontier = state.promptResults.filter((entry) => !entry.isGolden);
  const results = [];
  for (const promptEntry of frontier) {
    const result = await evaluateAndJudgePrompt({
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

async function discardCandidateSnapshot(state, candidateSnapshot, onStateChange) {
  const latestSnapshot = await ensureOwnedCandidateSnapshot(state, candidateSnapshot, onStateChange);
  await discardWorkingTreeChanges(latestSnapshot, state.workspaceDir);
}

async function ensureOwnedCandidateSnapshot(state, candidateSnapshot, onStateChange) {
  const latestSnapshot = await getWorkingTreeSnapshot(state.workspaceDir);
  const allowedFiles = new Set(candidateSnapshot.allFiles);
  const unexpectedFiles = latestSnapshot.allFiles.filter((file) => !allowedFiles.has(file));

  if (unexpectedFiles.length > 0) {
    setCurrentPhase(
      state,
      'needs_context',
      'Autolab found unexpected local changes and stopped instead of discarding them.'
    );
    await appendEvent(state, {
      type: 'candidate_ownership_conflict',
      message: `Refused automatic ownership of changes outside the candidate patch: ${unexpectedFiles.join(', ')}`,
    });
    await updateState(state, onStateChange);
    throw new Error('chat-autolab found unexpected local changes while handling a candidate. Resolve them manually before continuing.');
  }

  return latestSnapshot;
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
