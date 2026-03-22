import fs from 'node:fs/promises';
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
  getWorkingTreeFingerprint,
  getWorkingTreeSnapshot,
} from './git.mjs';
import {
  buildPromptInventory,
  chooseNextPrompt,
  discoverPromptCandidates,
} from './inventory.mjs';
import { getPromptTarget, isPromptAtTarget } from './judge-config.mjs';
import { judgePrompt } from './judge.mjs';
import { ensureLocalServer, stopServerProcess } from './server.mjs';
import {
  appendEvent,
  applyUsageToState,
  buildRunPaths,
  clearVerificationCheckpoint,
  clearCurrentRun,
  createInitialState,
  getPromptResult,
  initRunStorage,
  loadState,
  recordVerificationResult,
  saveState,
  setCurrentPhase,
  startVerificationCheckpoint,
  updateVerificationCheckpointPhase,
  upsertPromptResult,
  writeEvaluationArtifact,
} from './state.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_GOLDEN_SWEEP_INTERVAL = 5;

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
  const verificationPolicy = {
    goldenSweepInterval:
      parsePositiveInt(env.CHAT_AUTOLAB_GOLDEN_SWEEP_INTERVAL) ?? DEFAULT_GOLDEN_SWEEP_INTERVAL,
  };

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
        allowDirty: Boolean(state.verificationCheckpoint) || isVerificationPhase(state.current?.phase),
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
        state.current.targetScore = getPromptTarget(promptEntry, state.campaignBudget.goldenGoal);
        state.current.hypothesis = null;
        state.current.canaryPromptIds = [];
        state.current.canaryPrompts = [];
        state.current.touchedFiles = [];
        state.current.nextAction = `Baseline "${promptEntry.prompt}".`;
        await updateState(state, onStateChange);

        const result = await evaluateAndJudgePrompt({
          state,
          origin: state.evalOrigin,
          evalSecret: state.evalSecret,
          auth,
          promptEntry,
          baselineResult: null,
          stage: 'baseline',
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
    await recoverVerificationCheckpointFromArtifacts({ state, onStateChange });
    await updateState(state, onStateChange);

    while (state.iterations.total < state.campaignBudget.maxIterations) {
      if (await continueVerificationCheckpoint({
        state,
        origin: state.evalOrigin,
        evalSecret: state.evalSecret,
        auth,
        onStateChange,
        verificationPolicy,
      })) {
        if (state.status === 'stopped') {
          return state;
        }
        continue;
      }

      state.baseline = buildBaselineSummary(state);
      const nextPrompt = chooseNextPrompt(state);
      if (!nextPrompt) {
        break;
      }

      if (nextPrompt.isGolden && isPromptAtTarget(nextPrompt, state.campaignBudget.goldenGoal)) {
        break;
      }

      state.current.promptId = nextPrompt.id;
      state.current.prompt = nextPrompt.prompt;
      state.current.area = nextPrompt.area;
      state.current.family = nextPrompt.family;
      state.current.persona = nextPrompt.persona;
      state.current.targetScore = getPromptTarget(nextPrompt, state.campaignBudget.goldenGoal);
      state.current.canaryPromptIds = [];
      state.current.canaryPrompts = [];
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
        recordLeadFailureAttempt(state, nextPrompt);
        await appendEvent(state, {
          type: 'discard',
          message: buildLeadFailureMessage(
            state,
            nextPrompt,
            `Discarded ${nextPrompt.prompt} because Codex did not change the worktree.`
          ),
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
        recordLeadFailureAttempt(state, nextPrompt);
        await appendEvent(state, {
          type: 'discard',
          message: buildLeadFailureMessage(
            state,
            nextPrompt,
            `Discarded ${nextPrompt.prompt} because the code guard failed.`
          ),
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

      const candidateFingerprint = await getWorkingTreeFingerprint(candidateSnapshot, state.workspaceDir);
      state.current.canaryPromptIds = [];
      state.current.canaryPrompts = [];
      startVerificationCheckpoint(state, {
        mode: 'candidate_gate',
        phase: 'targeted_verify',
        leadPromptId: nextPrompt.id,
        candidateFingerprint,
        candidateSnapshot,
        pendingTaskIds: [buildVerificationTaskId('targeted', nextPrompt.id)],
      });
      await appendEvent(state, {
        type: 'verification_started',
        message: `Checkpointed targeted verification for ${nextPrompt.prompt}.`,
      });
      await updateState(state, onStateChange);
      await continueVerificationCheckpoint({
        state,
        origin: state.evalOrigin,
        evalSecret: state.evalSecret,
        auth,
        onStateChange,
        verificationPolicy,
      });
      if (state.status === 'stopped') {
        return state;
      }
      continue;
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
    if (error?.code === 'JUDGE_TIMEOUT' && state.verificationCheckpoint) {
      setCurrentPhase(state, 'stopped', 'Run pnpm chat-autolab:resume to continue verification from the first unfinished judge call.');
      await appendEvent(state, {
        type: 'campaign_stopped',
        message: `Campaign stopped after a ${error.mode || 'judge'} timeout. Run pnpm chat-autolab:resume to continue.`,
      });
      await updateState(state, onStateChange);
      return state;
    }
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
    if (state.current.phase === 'editing') {
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
  if (state.current.phase === 'editing') {
    state.current.touchedFiles = [];
  }
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
  state,
  origin,
  evalSecret,
  auth,
  promptEntry,
  baselineResult,
  stage,
  onJudgeStatus = null,
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
    onStatus: onJudgeStatus,
  });

  await writeEvaluationArtifact({
    runId: state.runId,
    promptId: promptEntry.id,
    stage,
    payload: {
      prompt: promptEntry.prompt,
      family: promptEntry.family,
      persona: promptEntry.persona,
      targetScore: getPromptTarget(promptEntry, state.campaignBudget.goldenGoal),
      referenceScore: promptEntry.referenceScore ?? null,
      referenceVerdict: promptEntry.referenceVerdict ?? null,
      judgeNotes: promptEntry.judgeNotes ?? null,
      baselineScore: baselineResult?.score ?? null,
      baselineVerdict: baselineResult?.pairwiseVerdict ?? null,
      eval: {
        status: evalResult.status,
        errorMessage: evalResult.errorMessage || null,
        answer: evalResult.answer,
        toolCalls: evalResult.toolCalls,
        iterations: evalResult.iterations,
        timing: evalResult.timing,
        usage: evalResult.usage,
      },
      judge: {
        score: judgeResult.score,
        subscores: judgeResult.subscores,
        blockingFlags: judgeResult.blockingFlags,
        rationale: judgeResult.rationale,
        pairwiseVerdict: judgeResult.pairwiseVerdict,
        pairwiseReason: judgeResult.pairwiseReason,
        hardChecks: judgeResult.hardChecks,
        evidenceDigest: judgeResult.evidenceDigest,
        calibration: judgeResult.calibration,
        absoluteJudge: judgeResult.absoluteJudge,
        pairwiseJudge: judgeResult.pairwiseJudge,
        usage: judgeResult.usage,
      },
    },
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
    targetScore: getPromptTarget(promptEntry, state.campaignBudget.goldenGoal),
    targetVerdict: promptEntry.targetVerdict || null,
    referenceScore: promptEntry.referenceScore ?? null,
    referenceVerdict: promptEntry.referenceVerdict ?? null,
    judgeNotes: promptEntry.judgeNotes ?? null,
    status: evalResult.status,
    answer: evalResult.answer,
    toolCalls: summarizeToolCallsForState(evalResult.toolCalls),
    iterations: evalResult.iterations,
    timing: evalResult.timing,
    score: judgeResult.score,
    subscores: judgeResult.subscores,
    blockingFlags: judgeResult.blockingFlags,
    rationale: judgeResult.rationale,
    pairwiseVerdict: judgeResult.pairwiseVerdict,
    pairwiseReason: judgeResult.pairwiseReason,
    evidenceDigest: judgeResult.evidenceDigest,
    calibration: judgeResult.calibration,
    answerUsage: evalResult.usage || zeroUsage(),
    judgeUsage: judgeResult.usage || zeroUsage(),
  };
}

async function continueVerificationCheckpoint({
  state,
  origin,
  evalSecret,
  auth,
  onStateChange,
  verificationPolicy,
}) {
  const checkpoint = state.verificationCheckpoint;
  if (!checkpoint) {
    return false;
  }

  await assertMatchingVerificationCheckpoint(state, onStateChange);

  if (checkpoint.mode === 'candidate_gate') {
    await runVerificationTasks({
      state,
      origin,
      evalSecret,
      auth,
      onStateChange,
      stageFilter: new Set(['targeted', 'canary']),
    });

    const refreshedCheckpoint = state.verificationCheckpoint;
    if (!refreshedCheckpoint) {
      return true;
    }
    const leadPrompt = findPromptEntry(state, refreshedCheckpoint.leadPromptId);
    const leadBaseline = getPromptResult(state, refreshedCheckpoint.leadPromptId);
    const leadResult = getCheckpointResult(refreshedCheckpoint, 'targeted', refreshedCheckpoint.leadPromptId);
    const canaryResults = getCheckpointResultsByStage(refreshedCheckpoint, 'canary');
    if (!leadPrompt || !leadBaseline || !leadResult) {
      throw new Error('chat-autolab verification checkpoint is missing the lead prompt result.');
    }

    const hasCanaryRegression = canaryResults.some(
      (result) => result.pairwiseVerdict === 'worse' || (result.blockingFlags?.length || 0) > 0
    );
    const leadImproved =
      leadResult.pairwiseVerdict === 'better' ||
      leadResult.score > Number(leadBaseline?.score || 0) ||
      (leadBaseline?.blockingFlags?.length || 0) > (leadResult.blockingFlags?.length || 0);

    if (!leadImproved || hasCanaryRegression) {
      await discardAfterVerificationFailure({
        state,
        promptEntry: leadPrompt,
        candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
        onStateChange,
        score: leadResult.score,
        incrementLeadAttempt: !leadImproved,
        reason: hasCanaryRegression ? 'Canary regression detected.' : 'Lead prompt did not improve.',
        message: `Discarded ${leadPrompt.prompt} because it failed the targeted or canary gate.`,
      });
      return true;
    }

    if (!shouldRunGoldenSweep(refreshedCheckpoint.candidateSnapshot.allFiles, state.iterations.accepted, verificationPolicy)) {
      await acceptVerifiedCandidate({
        state,
        promptEntry: leadPrompt,
        candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
        leadResult,
        goldenResults: [],
        fullResults: [],
        onStateChange,
      });
      return true;
    }

    startVerificationCheckpoint(state, {
      mode: 'golden_gate',
      phase: 'golden_verify',
      leadPromptId: refreshedCheckpoint.leadPromptId,
      candidateFingerprint: refreshedCheckpoint.candidateFingerprint,
      candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
      completedResults: refreshedCheckpoint.completedResults,
      pendingTaskIds: getGoldenVerificationTaskIds(state, refreshedCheckpoint),
    });
    setCurrentPhase(state, 'golden_verify', 'Run the final live golden sweep before keeping this candidate.');
    await appendEvent(state, {
      type: 'verification_started',
      message: `Lead prompt passed for ${leadPrompt.prompt}; running the final live golden sweep before keep.`,
    });
    await updateState(state, onStateChange);
    return await continueVerificationCheckpoint({
      state,
      origin,
      evalSecret,
      auth,
      onStateChange,
      verificationPolicy,
    });
  }

  if (checkpoint.mode === 'golden_gate') {
    await runVerificationTasks({
      state,
      origin,
      evalSecret,
      auth,
      onStateChange,
      stageFilter: new Set(['golden']),
    });

    const refreshedCheckpoint = state.verificationCheckpoint;
    if (!refreshedCheckpoint) {
      return true;
    }
    const leadPrompt = findPromptEntry(state, refreshedCheckpoint.leadPromptId);
    const leadResult = getCheckpointResult(refreshedCheckpoint, 'targeted', refreshedCheckpoint.leadPromptId);
    const goldenResults = getAllGoldenGateResults(state, refreshedCheckpoint);
    if (!leadPrompt || !leadResult) {
      throw new Error('chat-autolab golden verification checkpoint is missing the lead prompt result.');
    }

    const hasGoldenRegression = goldenResults.some(
      (result) => result.pairwiseVerdict === 'worse' || (result.blockingFlags?.length || 0) > 0
    );
    if (hasGoldenRegression) {
      await discardAfterVerificationFailure({
        state,
        promptEntry: leadPrompt,
        candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
        onStateChange,
        score: leadResult.score,
        incrementLeadAttempt: false,
        reason: 'Golden regression detected.',
        message: `Discarded ${leadPrompt.prompt} because it failed the final golden sweep.`,
      });
      return true;
    }

    await acceptVerifiedCandidate({
      state,
      promptEntry: leadPrompt,
      candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
      leadResult,
      goldenResults,
      fullResults: [],
      onStateChange,
    });
    return true;
  }

  if (checkpoint.mode === 'full_verify') {
    await runVerificationTasks({
      state,
      origin,
      evalSecret,
      auth,
      onStateChange,
      stageFilter: new Set(['frontier']),
    });

    const refreshedCheckpoint = state.verificationCheckpoint;
    if (!refreshedCheckpoint) {
      return true;
    }
    const leadPrompt = findPromptEntry(state, refreshedCheckpoint.leadPromptId);
    const leadResult = getCheckpointResult(refreshedCheckpoint, 'targeted', refreshedCheckpoint.leadPromptId);
    const goldenResults = getCheckpointResultsByStage(refreshedCheckpoint, 'golden');
    const fullResults = getCheckpointResultsByStage(refreshedCheckpoint, 'frontier');
    if (!leadPrompt || !leadResult) {
      throw new Error('chat-autolab full verification checkpoint is missing the lead prompt result.');
    }

    state.lastGuard.full = !fullResults.some((result) => result.pairwiseVerdict === 'worse');
    if (!state.lastGuard.full) {
      await discardAfterVerificationFailure({
        state,
        promptEntry: leadPrompt,
        candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
        onStateChange,
        score: leadResult.score,
        reason: 'Full verification regressed.',
        message: `Discarded ${leadPrompt.prompt} because the full verification pass regressed.`,
      });
      return true;
    }

    await acceptVerifiedCandidate({
      state,
      promptEntry: leadPrompt,
      candidateSnapshot: refreshedCheckpoint.candidateSnapshot,
      leadResult,
      goldenResults,
      fullResults,
      onStateChange,
    });
    return true;
  }

  throw new Error(`Unsupported verification checkpoint mode "${checkpoint.mode}".`);
}

async function runVerificationTasks({
  state,
  origin,
  evalSecret,
  auth,
  onStateChange,
  stageFilter,
}) {
  const checkpoint = state.verificationCheckpoint;
  if (!checkpoint) {
    return;
  }

  for (const taskId of [...checkpoint.pendingTaskIds]) {
    const task = parseVerificationTaskId(taskId);
    if (!stageFilter.has(task.stage)) {
      continue;
    }

    const promptEntry = findPromptEntry(state, task.promptId);
    if (!promptEntry) {
      throw new Error(`chat-autolab could not find prompt ${task.promptId} while resuming verification.`);
    }

    if (task.stage === 'golden') {
      updateVerificationCheckpointPhase(state, 'golden_verify');
      setCurrentPhase(state, 'golden_verify', 'Run the final live golden sweep before keeping this candidate.');
    } else if (task.stage === 'canary') {
      updateVerificationCheckpointPhase(state, 'canary_verify');
      setCurrentPhase(state, 'canary_verify', `Run live canary verification for "${state.current.prompt}".`);
    } else if (task.stage === 'frontier') {
      updateVerificationCheckpointPhase(state, 'full_verify');
      setCurrentPhase(state, 'full_verify', 'Run the broader sections 1-5 verification pass.');
    } else {
      updateVerificationCheckpointPhase(state, 'targeted_verify');
      setCurrentPhase(state, 'targeted_verify', `Run code guard and targeted prompt verification for "${state.current.prompt}".`);
    }
    state.current.nextAction = `Verify ${task.stage} prompt "${promptEntry.prompt}".`;
    await appendEvent(state, {
      type: 'judge_started',
      message: `Started ${task.stage} verification for ${promptEntry.prompt}.`,
    });
    await updateState(state, onStateChange);

    const baselineResult =
      task.stage === 'targeted' ? getPromptResult(state, promptEntry.id) : getPromptResult(state, promptEntry.id);
    const result = await evaluateAndJudgePrompt({
      state,
      origin,
      evalSecret,
      auth,
      promptEntry,
      baselineResult,
      stage: task.stage,
      onJudgeStatus: async (status) => {
        const message = formatJudgeStatusMessage(promptEntry.prompt, task.stage, status);
        if (!message) {
          return;
        }
        await appendEvent(state, {
          type: 'judge_progress',
          message,
        });
        await updateState(state, onStateChange);
      },
    });
    applyUsageToState(state, 'answer', result.answerUsage);
    applyUsageToState(state, 'judge', result.judgeUsage);
    recordVerificationResult(state, taskId, {
      promptId: promptEntry.id,
      stage: task.stage,
      result,
      recordedAt: new Date().toISOString(),
    });
    if (task.stage === 'golden' || task.stage === 'canary') {
      state.lastGuard.golden = !getAllGoldenGateResults(state, state.verificationCheckpoint).some(
        (row) => row.pairwiseVerdict === 'worse'
      );
    }
    if (task.stage === 'frontier') {
      state.lastGuard.full = !getCheckpointResultsByStage(state.verificationCheckpoint, 'frontier').some(
        (row) => row.pairwiseVerdict === 'worse'
      );
    }
    await appendEvent(state, {
      type: 'judge_completed',
      message: `Saved ${task.stage} verification for ${promptEntry.prompt}. ${state.verificationCheckpoint.pendingTaskIds.length} verification tasks remain.`,
    });
    await updateState(state, onStateChange);
  }
}

async function acceptVerifiedCandidate({
  state,
  promptEntry,
  candidateSnapshot,
  leadResult,
  goldenResults,
  fullResults,
  onStateChange,
}) {
  upsertPromptResult(state, leadResult);
  for (const result of goldenResults) {
    upsertPromptResult(state, result);
  }
  for (const result of fullResults) {
    upsertPromptResult(state, result);
  }

  const ownedSnapshot = await ensureOwnedCandidateSnapshot(state, candidateSnapshot, onStateChange);
  state.current.touchedFiles = ownedSnapshot.allFiles;
  const commitSha = await commitAll({
    cwd: state.workspaceDir,
    message: `chat-autolab: improve ${promptEntry.area} for ${promptEntry.id}`,
  });

  resetLeadAttemptState(promptEntry);
  state.iterations.total += 1;
  state.iterations.accepted += 1;
  state.best.score = computeCampaignScore(state);
  state.best.sha = commitSha;
  state.best.acceptedAt = new Date().toISOString();
  state.latest = {
    score: leadResult.score,
    verdict: 'keep',
    reason: `Accepted ${promptEntry.prompt} after passing the golden gate.`,
  };
  state.current.canaryPromptIds = [];
  state.current.canaryPrompts = [];
  clearVerificationCheckpoint(state);
  await appendEvent(state, {
    type: 'keep',
    message: `Kept ${promptEntry.prompt} at ${leadResult.score.toFixed(1)} and committed ${commitSha.slice(0, 7)} locally.`,
  });
  await updateState(state, onStateChange);
}

async function discardAfterVerificationFailure({
  state,
  promptEntry,
  candidateSnapshot,
  onStateChange,
  score,
  incrementLeadAttempt = false,
  reason,
  message,
}) {
  await discardCandidateSnapshot(state, candidateSnapshot, onStateChange);
  clearVerificationCheckpoint(state);
  state.iterations.total += 1;
  state.iterations.discarded += 1;
  promptEntry.discardCount = Number(promptEntry.discardCount || 0) + 1;
  if (incrementLeadAttempt) {
    recordLeadFailureAttempt(state, promptEntry);
  } else {
    resetLeadAttemptState(promptEntry);
  }
  await appendEvent(state, {
    type: 'discard',
    message: incrementLeadAttempt ? buildLeadFailureMessage(state, promptEntry, message) : message,
  });
  markManualReviewIfNeeded(state, promptEntry);
  state.latest = {
    score,
    verdict: 'discard',
    reason,
  };
  state.current.canaryPromptIds = [];
  state.current.canaryPrompts = [];
  await updateState(state, onStateChange);
}

async function recoverVerificationCheckpointFromArtifacts({ state, onStateChange }) {
  if (state.verificationCheckpoint || !isVerificationPhase(state.current.phase) || !state.current.promptId) {
    return false;
  }

  const candidateSnapshot = await getWorkingTreeSnapshot(state.workspaceDir);
  if (!candidateSnapshot.hasChanges) {
    return false;
  }

  const relevantStages = getRelevantRecoveryStages(state.current.phase);
  if (relevantStages.length === 0) {
    return false;
  }

  const artifacts = await loadVerificationArtifacts(state.runId);
  const anchor = [...artifacts]
    .reverse()
    .find((artifact) => artifact.stage === 'targeted' && artifact.promptId === state.current.promptId);
  if (!anchor) {
    return false;
  }

  const expectedTaskIds = [
    buildVerificationTaskId('targeted', state.current.promptId),
    ...state.current.canaryPromptIds.map((promptId) => buildVerificationTaskId('canary', promptId)),
    ...state.promptResults
      .filter((entry) => entry.isGolden)
      .map((entry) => buildVerificationTaskId('golden', entry.id)),
    ...(
      state.current.phase === 'full_verify'
        ? state.promptResults
            .filter((entry) => !entry.isGolden)
            .map((entry) => buildVerificationTaskId('frontier', entry.id))
        : []
    ),
  ];
  const completedResults = {};

  for (const artifact of artifacts) {
    if (artifact.sortKey < anchor.sortKey || !relevantStages.includes(artifact.stage)) {
      continue;
    }
    const taskId = buildVerificationTaskId(artifact.stage, artifact.promptId);
    completedResults[taskId] = {
      promptId: artifact.promptId,
      stage: artifact.stage,
      result: hydratePromptResultFromArtifact(artifact),
      recordedAt: artifact.timestamp,
    };
  }

  if (Object.keys(completedResults).length === 0) {
    return false;
  }

  startVerificationCheckpoint(state, {
    mode: inferRecoveryMode(state.current.phase, completedResults),
    phase: state.current.phase,
    leadPromptId: state.current.promptId,
    candidateFingerprint: await getWorkingTreeFingerprint(candidateSnapshot, state.workspaceDir),
    candidateSnapshot,
    completedResults,
    pendingTaskIds: expectedTaskIds.filter((taskId) => !completedResults[taskId]),
  });
  await appendEvent(state, {
    type: 'verification_recovered',
    message: `Recovered ${Object.keys(completedResults).length} completed verification tasks from saved artifacts.`,
  });
  await updateState(state, onStateChange);
  return true;
}

async function assertMatchingVerificationCheckpoint(state, onStateChange) {
  const checkpoint = state.verificationCheckpoint;
  if (!checkpoint) {
    return;
  }

  const currentSnapshot = await getWorkingTreeSnapshot(state.workspaceDir);
  if (!currentSnapshot.hasChanges) {
    setCurrentPhase(
      state,
      'needs_context',
      'The candidate changes for this verification checkpoint are no longer in the working tree.'
    );
    await appendEvent(state, {
      type: 'verification_checkpoint_invalid',
      message: 'Verification checkpoint no longer matches the working tree. Resolve the candidate changes manually before resuming.',
    });
    await updateState(state, onStateChange);
    throw new Error('chat-autolab cannot resume verification because the candidate patch is no longer present.');
  }

  const currentFingerprint = await getWorkingTreeFingerprint(currentSnapshot, state.workspaceDir);
  if (checkpoint.candidateFingerprint && checkpoint.candidateFingerprint !== currentFingerprint) {
    setCurrentPhase(
      state,
      'needs_context',
      'The candidate worktree changed after verification was checkpointed.'
    );
    await appendEvent(state, {
      type: 'verification_checkpoint_invalid',
      message: 'Verification checkpoint fingerprint mismatch. Resolve the worktree manually before resuming.',
    });
    await updateState(state, onStateChange);
    throw new Error('chat-autolab cannot resume verification because the candidate fingerprint changed.');
  }

  state.current.touchedFiles = checkpoint.candidateSnapshot?.allFiles || currentSnapshot.allFiles;
  const canaryPromptIds = new Set([
    ...(state.current.canaryPromptIds || []),
    ...Object.values(checkpoint.completedResults || {})
      .filter((entry) => entry.stage === 'canary')
      .map((entry) => entry.promptId),
  ]);
  state.current.canaryPromptIds = [...canaryPromptIds];
  state.current.canaryPrompts = state.current.canaryPromptIds
    .map((promptId) => findPromptEntry(state, promptId)?.prompt || null)
    .filter(Boolean);
}

async function loadVerificationArtifacts(runId) {
  const { artifactsDir } = buildRunPaths(runId);
  let filenames = [];
  try {
    filenames = await fs.readdir(artifactsDir);
  } catch {
    return [];
  }

  const artifacts = [];
  for (const filename of filenames.sort()) {
    const match = filename.match(/^(.+?)-(targeted|canary|golden|frontier)-([^.]+)\.json$/);
    if (!match) {
      continue;
    }
    const [, timestamp, stage, promptId] = match;
    try {
      const raw = await fs.readFile(`${artifactsDir}/${filename}`, 'utf8');
      artifacts.push({
        filename,
        sortKey: filename,
        timestamp: timestamp.replace(/-/g, ':').replace(/:(\d\d\d)Z$/, '.$1Z'),
        stage,
        promptId,
        payload: JSON.parse(raw),
      });
    } catch {
      // Ignore malformed artifacts while recovering older runs.
    }
  }
  return artifacts;
}

function hydratePromptResultFromArtifact(artifact) {
  const payload = artifact.payload || {};
  return {
    id: artifact.promptId || payload?.prompt || 'unknown',
    prompt: payload?.prompt || '',
    area: payload?.area || null,
    family: payload?.family || null,
    persona: payload?.persona || null,
    critiqueRef: payload?.critiqueRef || null,
    isGolden: payload?.isGolden === true || artifact.stage === 'golden',
    source: payload?.source || null,
    targetScore: payload?.targetScore ?? null,
    targetVerdict: payload?.targetVerdict ?? null,
    referenceScore: payload?.referenceScore ?? null,
    referenceVerdict: payload?.referenceVerdict ?? null,
    judgeNotes: payload?.judgeNotes ?? null,
    status: payload?.eval?.status || 'success',
    answer: payload?.eval?.answer || '',
    toolCalls: summarizeToolCallsForState(payload?.eval?.toolCalls),
    iterations: payload?.eval?.iterations || [],
    timing: payload?.eval?.timing || null,
    score: Number(payload?.judge?.score || 0),
    subscores: payload?.judge?.subscores || {},
    blockingFlags: payload?.judge?.blockingFlags || [],
    rationale: payload?.judge?.rationale || 'No rationale provided.',
    pairwiseVerdict: payload?.judge?.pairwiseVerdict || 'same',
    pairwiseReason: payload?.judge?.pairwiseReason || '',
    evidenceDigest: payload?.judge?.evidenceDigest || null,
    calibration: payload?.judge?.calibration || null,
    answerUsage: payload?.eval?.usage || zeroUsage(),
    judgeUsage: payload?.judge?.usage || zeroUsage(),
  };
}

function getRelevantRecoveryStages(phase) {
  if (phase === 'targeted_verify' || phase === 'canary_verify') {
    return ['targeted', 'canary'];
  }
  if (phase === 'golden_verify') {
    return ['targeted', 'canary', 'golden'];
  }
  if (phase === 'full_verify') {
    return ['targeted', 'canary', 'golden', 'frontier'];
  }
  return [];
}

function inferRecoveryMode(phase, completedResults) {
  if (phase === 'full_verify') {
    return 'full_verify';
  }
  const completedStages = new Set(Object.values(completedResults || {}).map((entry) => entry.stage));
  if (completedStages.has('golden') || phase === 'golden_verify') {
    return 'golden_gate';
  }
  return 'candidate_gate';
}

function findPromptEntry(state, promptId) {
  return (
    state.promptResults.find((entry) => entry.id === promptId) ||
    state.baselineQueue.find((entry) => entry.id === promptId) ||
    state.discoveredPrompts.find((entry) => entry.id === promptId) ||
    null
  );
}

function buildVerificationTaskId(stage, promptId) {
  return `${stage}:${promptId}`;
}

function parseVerificationTaskId(taskId) {
  const [stage, ...rest] = String(taskId || '').split(':');
  return {
    stage,
    promptId: rest.join(':'),
  };
}

function getCheckpointResult(checkpoint, stage, promptId) {
  return checkpoint?.completedResults?.[buildVerificationTaskId(stage, promptId)]?.result || null;
}

function getCheckpointResultsByStage(checkpoint, stage) {
  return Object.values(checkpoint?.completedResults || {})
    .filter((entry) => entry?.stage === stage)
    .map((entry) => entry.result);
}

function getGoldenVerificationTaskIds(state, checkpoint) {
  const coveredGoldenIds = new Set(getCheckpointResultsByStage(checkpoint, 'canary').map((entry) => entry.id));
  if (findPromptEntry(state, checkpoint.leadPromptId)?.isGolden) {
    coveredGoldenIds.add(checkpoint.leadPromptId);
  }
  return state.promptResults
    .filter((entry) => entry.isGolden)
    .filter((entry) => !coveredGoldenIds.has(entry.id))
    .map((entry) => buildVerificationTaskId('golden', entry.id));
}

function getAllGoldenGateResults(state, checkpoint) {
  const results = [];
  const leadPrompt = findPromptEntry(state, checkpoint?.leadPromptId);
  const leadResult = getCheckpointResult(checkpoint, 'targeted', checkpoint?.leadPromptId);
  if (leadPrompt?.isGolden && leadResult) {
    results.push(leadResult);
  }
  results.push(...getCheckpointResultsByStage(checkpoint, 'canary'));
  results.push(...getCheckpointResultsByStage(checkpoint, 'golden'));
  return results;
}

function formatJudgeStatusMessage(prompt, stage, status) {
  const elapsed = Number(status?.elapsedMs || 0);
  const seconds = elapsed > 0 ? `${Math.round(elapsed / 1000)}s` : null;
  switch (status?.kind) {
    case 'absolute_started':
      return `Started absolute judge for ${prompt} during ${stage} verification.`;
    case 'pairwise_started':
      return `Started pairwise judge for ${prompt} during ${stage} verification.`;
    case 'absolute_heartbeat':
      return `Absolute judge still running for ${prompt}${seconds ? ` (${seconds})` : ''}.`;
    case 'pairwise_heartbeat':
      return `Pairwise judge still running for ${prompt}${seconds ? ` (${seconds})` : ''}.`;
    case 'absolute_completed':
      return `Absolute judge completed for ${prompt}.`;
    case 'pairwise_completed':
      return `Pairwise judge completed for ${prompt}.`;
    case 'absolute_timed_out':
      return `Absolute judge timed out for ${prompt}.`;
    case 'pairwise_timed_out':
      return `Pairwise judge timed out for ${prompt}.`;
    default:
      return null;
  }
}

function isVerificationPhase(phase) {
  return ['targeted_verify', 'canary_verify', 'golden_verify', 'full_verify'].includes(phase);
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
    goldenAtGoal: goldens.filter((entry) => isPromptAtTarget(entry, state.campaignBudget.goldenGoal)).length,
    blockingCount: goldens.filter((entry) => (entry.blockingFlags?.length || 0) > 0).length,
  };
}

function computeCampaignScore(state) {
  const goldens = state.promptResults.filter((entry) => entry.isGolden);
  const frontier = state.promptResults.filter((entry) => !entry.isGolden);
  const regressionViolations = goldens.filter((entry) => entry.pairwiseVerdict === 'worse' || (entry.blockingFlags?.length || 0) > 0).length;
  const goldenBelowGoal = goldens.filter((entry) => !isPromptAtTarget(entry, state.campaignBudget.goldenGoal)).length;
  const frontierBelowGoal = frontier.filter((entry) => !isPromptAtTarget(entry, state.campaignBudget.goldenGoal)).length;
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

function shouldRunGoldenSweep(touchedFiles, acceptedCount, verificationPolicy) {
  if (hasHighRiskSharedChange(touchedFiles)) {
    return true;
  }
  const nextAcceptedCount = acceptedCount + 1;
  const interval = verificationPolicy?.goldenSweepInterval;
  return Number.isFinite(interval) && interval > 0 && nextAcceptedCount % interval === 0;
}

function hasHighRiskSharedChange(touchedFiles) {
  return touchedFiles.some((file) =>
    file.startsWith('apps/admin/src/app/api/chat/') ||
    file.startsWith('apps/admin/src/lib/llm/') ||
    file.startsWith('apps/admin/src/lib/chat/')
  );
}

function buildCodexPrompt(promptEntry, state) {
  const targetScore = getPromptTarget(promptEntry, state.campaignBudget.goldenGoal);
  return [
    'You are running one bounded chat-autolab iteration inside PublisherIQ.',
    `Lead prompt: ${promptEntry.prompt}`,
    `Area: ${promptEntry.area}`,
    `Persona: ${promptEntry.persona}`,
    `Current score: ${Number(promptEntry.score || 0).toFixed(1)}`,
    `Target score: ${targetScore.toFixed(1)}`,
    `Reference score: ${promptEntry.referenceScore ?? 'none'}`,
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
    `Judge notes: ${promptEntry.judgeNotes || 'none'}`,
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
      targetScore: getPromptTarget(promptEntry, state.campaignBudget.goldenGoal),
      discardCount,
      recordedAt: new Date().toISOString(),
    });
  }
}

function recordLeadFailureAttempt(state, promptEntry) {
  promptEntry.leadAttemptStreak = Number(promptEntry.leadAttemptStreak || 0) + 1;
  if (promptEntry.leadAttemptStreak < getMaxLeadAttempts(state)) {
    state.iterations.pivots += 1;
  }
}

function resetLeadAttemptState(promptEntry) {
  promptEntry.leadAttemptStreak = 0;
}

function getMaxLeadAttempts(state) {
  return Number(state.campaignBudget?.maxPivotsPerPrompt || 0) + 1;
}

function buildLeadFailureMessage(state, promptEntry, baseMessage) {
  const attempts = Number(promptEntry.leadAttemptStreak || 0);
  const maxAttempts = getMaxLeadAttempts(state);
  if (attempts < maxAttempts) {
    return `${baseMessage} Retrying ${promptEntry.prompt} (${attempts + 1}/${maxAttempts}) before moving on.`;
  }
  return `${baseMessage} Reached ${attempts}/${maxAttempts} lead attempts, so autolab will move to the next prompt.`;
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function summarizeToolCallsForState(toolCalls) {
  return Array.isArray(toolCalls)
    ? toolCalls.map((toolCall) => ({
      name: toolCall.name,
      arguments: toolCall.arguments,
      executionMs: toolCall.executionMs ?? null,
      success: toolCall.success !== false,
      summary: toolCall.summary ?? null,
    }))
    : [];
}

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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
