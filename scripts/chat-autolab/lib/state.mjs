import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AUTOLAB_DIR,
  CURRENT_RUN_PATH,
  DEFAULT_GOLDEN_GOAL,
  DEFAULT_MAX_DISCARDS_PER_PROMPT,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_PIVOTS_PER_PROMPT,
  DEFAULT_PORT,
  ROOT,
} from './constants.mjs';
import { getPromptTarget } from './judge-config.mjs';

export async function ensureAutolabDir() {
  await fs.mkdir(AUTOLAB_DIR, { recursive: true });
}

export function buildRunDir(runId) {
  return path.join(AUTOLAB_DIR, runId);
}

export function buildRunPaths(runId) {
  const runDir = buildRunDir(runId);
  return {
    runDir,
    statePath: path.join(runDir, 'campaign-state.json'),
    statusJsonPath: path.join(runDir, 'status.json'),
    statusMarkdownPath: path.join(runDir, 'status.md'),
    eventsPath: path.join(runDir, 'events.ndjson'),
    resultsPath: path.join(runDir, 'results.tsv'),
    lastMessagePath: path.join(runDir, 'last-agent-message.txt'),
    codexPromptPath: path.join(runDir, 'codex-prompt.md'),
    serverLogPath: path.join(runDir, 'server.log'),
    artifactsDir: path.join(runDir, 'artifacts'),
  };
}

export async function initRunStorage(runId) {
  await ensureAutolabDir();
  const paths = buildRunPaths(runId);
  await fs.mkdir(paths.runDir, { recursive: true });
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  await fs.writeFile(CURRENT_RUN_PATH, `${runId}\n`);
  return paths;
}

export async function getCurrentRunId() {
  try {
    const value = await fs.readFile(CURRENT_RUN_PATH, 'utf8');
    const runId = value.trim();
    return runId || null;
  } catch {
    return null;
  }
}

export async function findLatestRunId() {
  try {
    const entries = await fs.readdir(AUTOLAB_DIR, { withFileTypes: true });
    const runs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return runs.at(-1) || null;
  } catch {
    return null;
  }
}

export async function clearCurrentRun(runId) {
  const current = await getCurrentRunId();
  if (current === runId) {
    await fs.rm(CURRENT_RUN_PATH, { force: true });
  }
}

export function createInitialState({
  runId,
  port = DEFAULT_PORT,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxDiscardsPerPrompt = DEFAULT_MAX_DISCARDS_PER_PROMPT,
  maxPivotsPerPrompt = DEFAULT_MAX_PIVOTS_PER_PROMPT,
  goldenGoal = DEFAULT_GOLDEN_GOAL,
  note = '',
}) {
  const now = new Date().toISOString();
  return {
    version: 4,
    runId,
    status: 'booting',
    startedAt: now,
    updatedAt: now,
    note,
    port,
    branch: null,
    startSha: null,
    workspaceDir: ROOT,
    workspaceMode: 'current-branch',
    pushMode: 'local-only',
    evalOrigin: null,
    evalSecret: null,
    server: {
      pid: null,
      startedByAutolab: false,
    },
    campaignBudget: {
      maxIterations,
      maxDiscardsPerPrompt,
      maxPivotsPerPrompt,
      goldenGoal,
    },
    iterations: {
      total: 0,
      accepted: 0,
      discarded: 0,
      pivots: 0,
    },
    current: {
      phase: 'booting',
      promptId: null,
      prompt: null,
      area: null,
      family: null,
      persona: null,
      targetScore: null,
      hypothesis: null,
      canaryPromptIds: [],
      canaryPrompts: [],
      touchedFiles: [],
      nextAction: 'Boot the campaign.',
    },
    baseline: {
      score: null,
      goldenAtGoal: 0,
      totalGoldens: 0,
      blockingCount: 0,
    },
    best: {
      score: null,
      sha: null,
      acceptedAt: null,
    },
    latest: {
      score: null,
      verdict: null,
      reason: null,
    },
    promptResults: [],
    baselineQueue: [],
    manualReview: [],
    discoveredPrompts: [],
    verificationCheckpoint: null,
    recentEvents: [],
    tokenUsage: {
      answer: createUsageBucket(),
      judge: createUsageBucket(),
      agent: createUsageBucket(),
      total: createUsageBucket(),
    },
    lastGuard: {
      code: null,
      golden: null,
      full: null,
    },
  };
}

function createUsageBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function accumulateUsage(bucket, usage) {
  if (!usage) return bucket;
  bucket.inputTokens += Number(usage.inputTokens || 0);
  bucket.outputTokens += Number(usage.outputTokens || 0);
  bucket.totalTokens += Number(usage.totalTokens || 0);
  return bucket;
}

export function applyUsageToState(state, phase, usage) {
  if (!usage) return state;
  accumulateUsage(state.tokenUsage.total, usage);
  if (phase === 'answer') accumulateUsage(state.tokenUsage.answer, usage);
  if (phase === 'judge') accumulateUsage(state.tokenUsage.judge, usage);
  if (phase === 'agent') accumulateUsage(state.tokenUsage.agent, usage);
  return state;
}

export async function saveState(state) {
  const paths = buildRunPaths(state.runId);
  await fs.mkdir(paths.runDir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  await fs.writeFile(paths.statePath, serialized);
  await fs.writeFile(paths.statusJsonPath, serialized);
  await fs.writeFile(paths.statusMarkdownPath, renderStatusMarkdown(state));
  return paths;
}

export async function loadState(runId = null) {
  const resolvedRunId = runId || (await getCurrentRunId());
  if (!resolvedRunId) {
    throw new Error('No active chat-autolab run was found.');
  }
  const paths = buildRunPaths(resolvedRunId);
  const raw = await fs.readFile(paths.statePath, 'utf8');
  return normalizeLoadedState(JSON.parse(raw));
}

export async function appendEvent(state, event) {
  const paths = buildRunPaths(state.runId);
  const row = {
    at: new Date().toISOString(),
    ...event,
  };
  await fs.appendFile(paths.eventsPath, `${JSON.stringify(row)}\n`);
  state.recentEvents = [row, ...(state.recentEvents || [])].slice(0, 20);
  state.updatedAt = row.at;
  return row;
}

export async function writeEvaluationArtifact({ runId, promptId, stage, payload }) {
  const paths = buildRunPaths(runId);
  await fs.mkdir(paths.artifactsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(
    paths.artifactsDir,
    `${timestamp}-${safeFilePart(stage)}-${safeFilePart(promptId)}.json`
  );
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

export function setCurrentPhase(state, phase, nextAction) {
  state.status = phase;
  state.current.phase = phase;
  if (nextAction) {
    state.current.nextAction = nextAction;
  }
}

export function startVerificationCheckpoint(
  state,
  {
    mode,
    phase,
    leadPromptId,
    candidateFingerprint,
    candidateSnapshot,
    pendingTaskIds,
    completedResults = {},
  }
) {
  const now = new Date().toISOString();
  state.verificationCheckpoint = {
    mode,
    phase,
    leadPromptId,
    candidateFingerprint,
    candidateSnapshot: normalizeSnapshot(candidateSnapshot),
    pendingTaskIds: [...new Set(pendingTaskIds || [])],
    completedResults: { ...completedResults },
    startedAt: now,
    updatedAt: now,
  };
  return state.verificationCheckpoint;
}

export function recordVerificationResult(state, taskId, completedEntry) {
  if (!state.verificationCheckpoint) {
    return null;
  }
  state.verificationCheckpoint.completedResults[taskId] = completedEntry;
  state.verificationCheckpoint.pendingTaskIds = state.verificationCheckpoint.pendingTaskIds.filter(
    (entry) => entry !== taskId
  );
  state.verificationCheckpoint.updatedAt = new Date().toISOString();
  return state.verificationCheckpoint;
}

export function updateVerificationCheckpointPhase(state, phase) {
  if (!state.verificationCheckpoint) {
    return null;
  }
  state.verificationCheckpoint.phase = phase;
  state.verificationCheckpoint.updatedAt = new Date().toISOString();
  return state.verificationCheckpoint;
}

export function clearVerificationCheckpoint(state) {
  state.verificationCheckpoint = null;
}

export function upsertPromptResult(state, result) {
  const index = state.promptResults.findIndex((entry) => entry.id === result.id);
  if (index === -1) {
    state.promptResults.push(result);
    return;
  }
  state.promptResults[index] = result;
}

export function getPromptResult(state, promptId) {
  return state.promptResults.find((entry) => entry.id === promptId) || null;
}

export function renderStatusMarkdown(state) {
  const lines = [];
  const currentTarget = state.current.targetScore;
  lines.push('# Chat Autolab Status');
  lines.push('');
  lines.push(`- Run ID: \`${state.runId}\``);
  lines.push(`- Updated: ${state.updatedAt}`);
  lines.push(`- Status: \`${state.status}\``);
  lines.push(`- Branch: ${state.branch || 'not attached yet'}`);
  lines.push(`- Workspace mode: \`${state.workspaceMode}\``);
  lines.push(`- Workspace path: ${state.workspaceDir || ROOT}`);
  lines.push(`- Push mode: \`${state.pushMode}\``);
  lines.push(`- Start SHA: ${state.startSha || 'not captured yet'}`);
  lines.push(`- Latest kept SHA: ${state.best.sha || 'none yet'}`);
  lines.push(`- Origin: ${state.evalOrigin || 'not started yet'}`);
  lines.push(`- Current prompt: ${state.current.prompt || 'none'}`);
  lines.push(`- Current persona: ${state.current.persona || 'none'}`);
  lines.push(`- Current target: ${typeof currentTarget === 'number' ? currentTarget.toFixed(1) : 'none'}`);
  lines.push(`- Current phase: \`${state.current.phase}\``);
  lines.push(`- Next action: ${state.current.nextAction || 'n/a'}`);
  lines.push(`- Golden progress: ${state.baseline.goldenAtGoal}/${state.baseline.totalGoldens} at target`);
  lines.push(`- Campaign score: ${formatMaybeNumber(state.best.score)}`);
  lines.push(`- Latest prompt score: ${formatMaybeNumber(state.latest.score)}`);
  lines.push(`- Iterations: ${state.iterations.total} total, ${state.iterations.accepted} kept, ${state.iterations.discarded} discarded`);
  lines.push(`- Manual review queue: ${state.manualReview.length}`);
  lines.push('');
  lines.push('## Token Usage');
  lines.push('');
  lines.push('| Phase | Input | Output | Total |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Answer | ${state.tokenUsage.answer.inputTokens} | ${state.tokenUsage.answer.outputTokens} | ${state.tokenUsage.answer.totalTokens} |`);
  lines.push(`| Judge | ${state.tokenUsage.judge.inputTokens} | ${state.tokenUsage.judge.outputTokens} | ${state.tokenUsage.judge.totalTokens} |`);
  lines.push(`| Agent | ${state.tokenUsage.agent.inputTokens} | ${state.tokenUsage.agent.outputTokens} | ${state.tokenUsage.agent.totalTokens} |`);
  lines.push(`| Total | ${state.tokenUsage.total.inputTokens} | ${state.tokenUsage.total.outputTokens} | ${state.tokenUsage.total.totalTokens} |`);
  lines.push('');
  lines.push('## Recent Events');
  lines.push('');
  if (!state.recentEvents.length) {
    lines.push('- No events yet.');
  } else {
    for (const event of state.recentEvents) {
      lines.push(`- ${event.at}: ${event.message}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderDashboard(state) {
  const lines = [];
  const currentTarget = state.current.targetScore;
  lines.push('Chat Autolab');
  lines.push(`Run: ${state.runId}`);
  lines.push(`Status: ${state.status}`);
  lines.push(`Branch: ${state.branch || '-'}`);
  lines.push(`Workspace: ${state.workspaceMode || '-'} | Push: ${state.pushMode || '-'}`);
  lines.push(`Base SHA: ${shortSha(state.startSha)} | Current kept: ${shortSha(state.best.sha)}`);
  lines.push(`Phase: ${state.current.phase}`);
  lines.push(`Prompt: ${state.current.prompt || '-'}`);
  lines.push(`Area / Persona: ${state.current.area || '-'} / ${state.current.persona || '-'}`);
  lines.push(`Target: ${typeof currentTarget === 'number' ? currentTarget.toFixed(1) : '-'}`);
  if (state.current.canaryPrompts?.length) {
    lines.push(`Canaries: ${state.current.canaryPrompts.join(' | ')}`);
  }
  lines.push(`Next: ${state.current.nextAction || '-'}`);
  lines.push('');
  lines.push(`Goldens at target: ${state.baseline.goldenAtGoal}/${state.baseline.totalGoldens}`);
  lines.push(`Campaign score: ${formatMaybeNumber(state.best.score)} | Latest prompt score: ${formatMaybeNumber(state.latest.score)} | Manual review: ${state.manualReview.length}`);
  lines.push(`Iterations: kept ${state.iterations.accepted} | discarded ${state.iterations.discarded} | total ${state.iterations.total}`);
  lines.push('');
  lines.push('Token usage');
  lines.push(`Answer: ${formatUsage(state.tokenUsage.answer)}`);
  lines.push(`Judge : ${formatUsage(state.tokenUsage.judge)}`);
  lines.push(`Agent : ${formatUsage(state.tokenUsage.agent)}`);
  lines.push(`Total : ${formatUsage(state.tokenUsage.total)}`);
  lines.push('');
  lines.push('Touched files');
  if (state.current.touchedFiles?.length) {
    for (const file of state.current.touchedFiles.slice(0, 8)) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push('- none');
  }
  lines.push('');
  lines.push('Recent events');
  if (state.recentEvents?.length) {
    for (const event of state.recentEvents.slice(0, 8)) {
      lines.push(`- ${event.at.slice(11, 19)} ${event.message}`);
    }
  } else {
    lines.push('- none');
  }
  return `${lines.join('\n')}\n`;
}

function formatUsage(bucket) {
  return `${bucket.inputTokens}/${bucket.outputTokens}/${bucket.totalTokens}`;
}

function formatMaybeNumber(value) {
  return typeof value === 'number' ? value.toFixed(2) : '-';
}

function normalizeLoadedState(state) {
  return {
    ...state,
    version: Math.max(Number(state.version || 1), 4),
    startSha: state.startSha || state.best?.sha || null,
    workspaceDir: state.workspaceDir || state.worktreeDir || ROOT,
    workspaceMode: state.workspaceMode || (state.worktreeDir ? 'legacy-worktree' : 'current-branch'),
    pushMode: state.pushMode || (state.remote ? 'legacy-remote' : 'local-only'),
    baselineQueue: Array.isArray(state.baselineQueue) ? state.baselineQueue : [],
    current: {
      ...(state.current || {}),
      canaryPromptIds: Array.isArray(state.current?.canaryPromptIds) ? state.current.canaryPromptIds : [],
      canaryPrompts: Array.isArray(state.current?.canaryPrompts) ? state.current.canaryPrompts : [],
      targetScore: Number.isFinite(Number(state.current?.targetScore))
        ? Number(state.current.targetScore)
        : null,
    },
    verificationCheckpoint: normalizeVerificationCheckpoint(state.verificationCheckpoint),
    promptResults: Array.isArray(state.promptResults)
      ? state.promptResults.map((entry) => ({
        ...entry,
        leadAttemptStreak: Number.isFinite(Number(entry?.leadAttemptStreak))
          ? Number(entry.leadAttemptStreak)
          : 0,
        targetScore: Number.isFinite(Number(entry?.targetScore))
          ? Number(entry.targetScore)
          : getPromptTarget(entry, state.campaignBudget?.goldenGoal),
      }))
      : [],
  };
}

function shortSha(value) {
  return value ? value.slice(0, 7) : '-';
}

function safeFilePart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeVerificationCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return null;
  }
  return {
    mode: checkpoint.mode || 'candidate_gate',
    phase: checkpoint.phase || 'targeted_verify',
    leadPromptId: checkpoint.leadPromptId || null,
    candidateFingerprint: checkpoint.candidateFingerprint || null,
    candidateSnapshot: normalizeSnapshot(checkpoint.candidateSnapshot),
    pendingTaskIds: Array.isArray(checkpoint.pendingTaskIds) ? checkpoint.pendingTaskIds : [],
    completedResults:
      checkpoint.completedResults && typeof checkpoint.completedResults === 'object'
        ? checkpoint.completedResults
        : {},
    startedAt: checkpoint.startedAt || new Date(0).toISOString(),
    updatedAt: checkpoint.updatedAt || checkpoint.startedAt || new Date(0).toISOString(),
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      trackedFiles: [],
      untrackedFiles: [],
      allFiles: [],
      hasChanges: false,
    };
  }
  const trackedFiles = Array.isArray(snapshot.trackedFiles) ? snapshot.trackedFiles : [];
  const untrackedFiles = Array.isArray(snapshot.untrackedFiles) ? snapshot.untrackedFiles : [];
  const allFiles = Array.isArray(snapshot.allFiles)
    ? snapshot.allFiles
    : [...new Set([...trackedFiles, ...untrackedFiles])];
  return {
    trackedFiles,
    untrackedFiles,
    allFiles,
    hasChanges:
      typeof snapshot.hasChanges === 'boolean'
        ? snapshot.hasChanges
        : trackedFiles.length > 0 || untrackedFiles.length > 0,
  };
}
