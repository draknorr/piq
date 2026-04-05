#!/usr/bin/env node
/* global console, setTimeout */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  assertChatOriginReachable,
  authenticateEval,
  evaluateChatRequest,
  evaluateScenario,
  loadEvalEnvFiles,
  summarizeScenarioSessionContext,
  validateEvalEnv,
} from './lib/endpoint-eval.mjs';
import {
  formatLatencyMs,
  scorePromptResponse,
  scoreScenarioResult,
} from './lib/blended-persona-scoring.mjs';
import { buildBaselineComparisonArtifacts } from './lib/baseline-comparison.mjs';
import {
  buildEvalManifest,
  INVENTORY_ALL_NAME,
} from './lib/eval-manifest.mjs';
import { writeFullSuiteArtifacts } from './lib/full-suite-artifacts.mjs';
import {
  BLENDED_PERSONA,
} from './lib/full-suite-inventory.mjs';
import { normalizeMarkdownForScoring } from './lib/markdown-normalizer.mjs';
import { assessPromptReview } from './lib/prompt-review.mjs';
import {
  TIGER_CUTOVER_ENDPOINT_REPORT_TITLE,
  TIGER_CUTOVER_INVENTORY_NAME,
} from './lib/tiger-cutover-inventory.mjs';
import { writeTigerCutoverGateArtifacts } from './lib/tiger-cutover-gate.mjs';
import { writeTigerCutoverTriageArtifacts } from './lib/tiger-cutover-triage.mjs';

const ROOT = process.cwd();
const DEFAULT_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'http://127.0.0.1:3001';
const DEFAULT_OUT_DIR = path.join(
  '/tmp',
  'publisheriq-chat-evals',
  `full-blended-endpoint-${new Date().toISOString().replace(/[:.]/g, '-')}`
);
const DEFAULT_DELAY_MS = Number(process.env.CHAT_EVAL_DELAY_MS || '1000');
const DEFAULT_TURN_TIMEOUT_MS = Number(process.env.CHAT_EVAL_REQUEST_TIMEOUT_MS || '90000');
const ENV_FILES = [
  path.join(ROOT, '.env'),
  path.join(ROOT, 'apps', 'admin', '.env.local'),
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir || DEFAULT_OUT_DIR;
  const origin = args.origin || DEFAULT_ORIGIN;
  const runtimeConfig = {
    baselineDir: args.baselineDir || '',
    baselineLabel: args.baselineLabel || '',
    delayMs: args.delayMs ?? DEFAULT_DELAY_MS,
    inventoryName: args.inventory || 'full-suite',
    maxPrompts: args.maxPrompts,
    maxScenarios: args.maxScenarios,
    origin,
    queryApiBaseUrl: args.queryApiBaseUrl || process.env.QUERY_API_BASE_URL || '',
    queryApiSource:
      args.queryApiSource
      || process.env.CHAT_EVAL_QUERY_API_SOURCE
      || process.env.DATA_PLANE_SOURCE_KIND
      || '',
    shuffleSeed: args.shuffleSeed || '',
    transport: 'endpoint',
    turnTimeoutMs: args.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
    variantMode: args.variantMode || 'off',
  };

  const env = await loadEvalEnvFiles(ENV_FILES);
  validateEvalEnv({ env, origin });

  const manifest = await buildEvalManifest({
    inventoryName: args.inventory,
    maxPrompts: args.maxPrompts,
    maxScenarios: args.maxScenarios,
    smokeOnly: args.smokeOnly,
    shuffleSeed: args.shuffleSeed,
    variantMode: args.variantMode,
  });
  const filteredManifest = {
    prompts: filterPrompts(manifest.prompts, args.includeCritiqueIds),
    scenarios: args.skipScenarios ? [] : manifest.scenarios,
  };
  const reportTitle =
    args.reportTitle
    || (args.inventory === INVENTORY_ALL_NAME
      ? 'Full Dev-Server Endpoint Chat Eval'
      : args.inventory === TIGER_CUTOVER_INVENTORY_NAME
      ? TIGER_CUTOVER_ENDPOINT_REPORT_TITLE
      : 'Full Blended-Persona Endpoint Chat Eval');

  await fs.mkdir(outDir, { recursive: true });

  const suiteManifestPath = path.join(outDir, 'suite-manifest.json');
  await fs.writeFile(
    suiteManifestPath,
    `${JSON.stringify(
      {
        blendedPersona: BLENDED_PERSONA,
        generatedAt: new Date().toISOString(),
        inventoryName: runtimeConfig.inventoryName,
        prompts: filteredManifest.prompts,
        runtimeConfig,
        scenarios: filteredManifest.scenarios,
      },
      null,
      2
    )}\n`
  );

  if (args.manifestOnly) {
    console.log(`Wrote suite manifest to ${suiteManifestPath}`);
    return;
  }

  await assertChatOriginReachable({
    origin,
    timeoutMs: Math.min(runtimeConfig.turnTimeoutMs, 10_000),
  });

  const auth = await authenticateEval({ env, origin });
  console.log(
    auth.authMode === 'eval_bypass'
      ? `Using local eval bypass against ${origin} as ${auth.email}`
      : auth.authMode === 'local_browser_bypass'
        ? `Using local browser bypass against ${origin} as ${auth.email}`
        : `Authenticated against ${origin} as ${auth.email}`
  );

  const runStartedAt = new Date();

  const promptResults = [];
  for (let index = 0; index < filteredManifest.prompts.length; index += 1) {
    const promptRow = filteredManifest.prompts[index];
    console.log(`[prompt ${index + 1}/${filteredManifest.prompts.length}] ${promptRow.prompt}`);
    const result = await runPromptEvaluation({
      auth,
      origin,
      promptRow,
      turnTimeoutMs: runtimeConfig.turnTimeoutMs,
    });
    promptResults.push(result);

    if (runtimeConfig.delayMs > 0 && index < filteredManifest.prompts.length - 1) {
      await sleep(runtimeConfig.delayMs);
    }
  }

  const scenarioResults = [];
  for (let index = 0; index < filteredManifest.scenarios.length; index += 1) {
    const scenario = filteredManifest.scenarios[index];
    console.log(`[scenario ${index + 1}/${filteredManifest.scenarios.length}] ${scenario.name}`);
    const result = await runScenarioEvaluation({
      auth,
      delayMs: runtimeConfig.delayMs,
      origin,
      scenario,
      turnTimeoutMs: runtimeConfig.turnTimeoutMs,
    });
    scenarioResults.push(result);
  }

  const runEndedAt = new Date();
  const runSummary = buildRunSummary({
    auth,
    origin,
    promptResults,
    runEndedAt,
    runStartedAt,
    runtimeConfig,
    scenarioResults,
  });
  const baselineComparison = await buildBaselineComparisonArtifacts({
    baselineDir: runtimeConfig.baselineDir,
    baselineLabel: runtimeConfig.baselineLabel,
    promptResults: promptResults.filter((result) => result.isVariant !== true),
    runSummary,
    scenarioResults,
  });

  await writeFullSuiteArtifacts({
    baselineComparison,
    outDir,
    promptResults,
    reportTitle,
    runSummary,
    scenarioResults,
  });

  if (args.inventory === TIGER_CUTOVER_INVENTORY_NAME) {
    const gate = await writeTigerCutoverGateArtifacts({
      outDir,
      promptResults,
      runSummary,
      scenarioResults,
    });
    await writeTigerCutoverTriageArtifacts({
      gate,
      outDir,
      promptResults,
      scenarioResults,
    });
  }

  console.log(`Full blended endpoint eval artifacts: ${outDir}`);
}

function parseArgs(argv) {
  const args = {
    baselineDir: '',
    baselineLabel: '',
    delayMs: null,
    includeCritiqueIds: [],
    manifestOnly: false,
    maxPrompts: 0,
    maxScenarios: 0,
    origin: '',
    outDir: '',
    queryApiBaseUrl: '',
    queryApiSource: '',
    shuffleSeed: '',
    skipScenarios: false,
    turnTimeoutMs: null,
    variantMode: 'off',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--origin') {
      args.origin = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--inventory') {
      args.inventory = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--out-dir') {
      args.outDir = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--baseline-dir') {
      args.baselineDir = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--baseline-label') {
      args.baselineLabel = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--query-api-base-url') {
      args.queryApiBaseUrl = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--query-api-source') {
      args.queryApiSource = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--variant-mode') {
      args.variantMode = argv[index + 1] || 'off';
      index += 1;
      continue;
    }

    if (arg === '--shuffle-seed') {
      args.shuffleSeed = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--max-prompts') {
      args.maxPrompts = Number(argv[index + 1] || '0');
      index += 1;
      continue;
    }

    if (arg === '--include-critique-ids') {
      args.includeCritiqueIds = parseCsvList(argv[index + 1] || '');
      index += 1;
      continue;
    }

    if (arg === '--max-scenarios') {
      args.maxScenarios = Number(argv[index + 1] || '0');
      index += 1;
      continue;
    }

    if (arg === '--delay-ms') {
      args.delayMs = Number(argv[index + 1] || `${DEFAULT_DELAY_MS}`);
      index += 1;
      continue;
    }

    if (arg === '--turn-timeout-ms') {
      args.turnTimeoutMs = Number(argv[index + 1] || `${DEFAULT_TURN_TIMEOUT_MS}`);
      index += 1;
      continue;
    }

    if (arg === '--manifest-only') {
      args.manifestOnly = true;
      continue;
    }

    if (arg === '--report-title') {
      args.reportTitle = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--smoke-only') {
      args.smokeOnly = true;
      continue;
    }

    if (arg === '--skip-scenarios') {
      args.skipScenarios = true;
      continue;
    }
  }

  return args;
}

function filterPrompts(prompts, includeCritiqueIds) {
  if (!Array.isArray(includeCritiqueIds) || includeCritiqueIds.length === 0) {
    return prompts;
  }

  const allowed = new Set(includeCritiqueIds.map((value) => String(value)));
  return prompts.filter((prompt) => allowed.has(String(prompt.critiqueId)));
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function runPromptEvaluation(params) {
  const { auth, origin, promptRow, turnTimeoutMs } = params;
  const endpointResult = await evaluateChatRequest({
    auth,
    origin,
    requestBody: {
      messages: [{ role: 'user', content: promptRow.prompt }],
    },
    timeoutMs: turnTimeoutMs,
  });

  const status = deriveEndpointStatus(endpointResult);
  const normalized = normalizeMarkdownForScoring(endpointResult.assistant_output_raw);
  const latencyMs = endpointResult.timing?.totalMs ?? null;
  const scoring = scorePromptResponse({
    family: promptRow.family,
    latencyMs,
    promptText: promptRow.prompt,
    renderedMetrics: normalized.renderedMetrics,
    renderedText: normalized.renderedText,
    status,
  });
  const review = assessPromptReview({
    diagnostics: buildDiagnostics(endpointResult),
    latencyMs,
    promptRow,
    responseMetrics: normalized.renderedMetrics,
    responseText: normalized.renderedText,
    routeMetadata: {
      tigerPrimary: endpointResult.tigerPrimary,
      tigerShadow: endpointResult.tigerShadow,
    },
    status,
  });

  return {
    antiAnchors: promptRow.antiAnchors,
    critiqueId: promptRow.critiqueId,
    diagnostics: buildDiagnostics(endpointResult),
    ...review,
    draftScore: scoring.draftScore,
    executionQuality: endpointResult.quality,
    executionScore: endpointResult.quality?.score ?? null,
    expectedBehavior: promptRow.expectedBehavior,
    expectedContracts: promptRow.expectedContracts,
    expectedRoutes: promptRow.expectedRoutes,
    factualAnchors: promptRow.factualAnchors,
    family: promptRow.family,
    inventoryName: promptRow.inventoryName || promptRow.sourceInventory || null,
    isVariant: promptRow.isVariant === true,
    latencyMs,
    latencyText: formatLatencyMs(latencyMs),
    latencyBudgetMs: promptRow.latencyBudgetMs ?? null,
    mustAvoidBackends: promptRow.mustAvoidBackends,
    normalizedResponseText: normalized.renderedText,
    notes: promptRow.notes,
    primaryPersona: promptRow.primaryPersona,
    priority: promptRow.priority ?? null,
    prompt: promptRow.prompt,
    qualityNotes: scoring.qualityNotes,
    rawAssistantOutput: endpointResult.assistant_output_raw,
    responseMetrics: normalized.renderedMetrics,
    responseText: normalized.renderedText,
    routeMetadata: {
      tigerPrimary: endpointResult.tigerPrimary,
      tigerShadow: endpointResult.tigerShadow,
    },
    routeSummary: summarizeRouteMetadata(endpointResult.tigerPrimary, endpointResult.tigerShadow),
    scoreBreakdown: scoring.scoreBreakdown,
    seedPromptId: promptRow.seedPromptId || String(promptRow.critiqueId),
    section: promptRow.section,
    sourceInventory: promptRow.sourceInventory || promptRow.inventoryName || null,
    sourceFamilies: promptRow.sourceFamilies,
    sourceSections: promptRow.sourceSections,
    sourceSuites: promptRow.sourceSuites,
    status,
    uiSmoke: promptRow.uiSmoke === true,
    usefulnessSummary: scoring.usefulnessSummary,
    variantKey: promptRow.variantKey || null,
    verdict: scoring.verdict,
    visibleLatencyMs: latencyMs,
    visibleLatencyText: formatLatencyMs(latencyMs),
  };
}

async function runScenarioEvaluation(params) {
  const { auth, delayMs, origin, scenario, turnTimeoutMs } = params;
  const scenarioResult = await evaluateScenario({
    auth,
    delayMs,
    origin,
    scenario,
    timeoutMs: turnTimeoutMs,
  });

  const turns = scenarioResult.turns.map((turn) => {
    const status = deriveEndpointStatus(turn);
    const normalized = normalizeMarkdownForScoring(turn.assistant_output_raw);
    const latencyMs = turn.timing?.totalMs ?? null;

    return {
      diagnostics: buildDiagnostics({
        error_message: turn.error_message,
        failure_kind: turn.failure_kind,
        http_status: turn.http_status,
        message_end_received: turn.message_end_received,
        quality: turn.quality,
        raw_sse: turn.raw_sse,
        sessionContext: turn.sessionContext,
        executionTrace: turn.executionTrace,
        tigerPrimary: turn.tiger_primary,
        tigerShadow: turn.tiger_shadow,
        tool_calls: turn.tool_calls,
        transport_ok: turn.transport_ok,
      }),
      expectation: turn.expectation,
      executionQuality: turn.quality,
      executionScore: turn.quality?.score ?? null,
      latencyMs,
      latencyText: formatLatencyMs(latencyMs),
      normalizedResponseText: normalized.renderedText,
      rawAssistantOutput: turn.assistant_output_raw,
      responseMetrics: normalized.renderedMetrics,
      responseText: normalized.renderedText,
      routeMetadata: {
        tigerPrimary: turn.tiger_primary,
        tigerShadow: turn.tiger_shadow,
      },
      routeSummary: summarizeRouteMetadata(turn.tiger_primary, turn.tiger_shadow),
      status,
      turnIndex: turn.turn_index,
      userPrompt: turn.user_prompt,
      visibleLatencyMs: latencyMs,
      visibleLatencyText: formatLatencyMs(latencyMs),
    };
  });

  const scoring = scoreScenarioResult({
    scenario,
    turns,
  });

  return {
    carryForwardQuality: scoring.carryForwardQuality,
    diagnostics: {
      scenarioStatus: scenarioResult.status,
      turns: scenarioResult.turns.map((turn) => buildDiagnostics({
        error_message: turn.error_message,
        failure_kind: turn.failure_kind,
        http_status: turn.http_status,
        message_end_received: turn.message_end_received,
        quality: turn.quality,
        raw_sse: turn.raw_sse,
        sessionContext: turn.sessionContext,
        executionTrace: turn.executionTrace,
        tigerPrimary: turn.tiger_primary,
        tigerShadow: turn.tiger_shadow,
        tool_calls: turn.tool_calls,
        transport_ok: turn.transport_ok,
      })),
    },
    draftScore: scoring.draftScore,
    inventoryName: scenario.inventoryName || scenario.sourceInventory || null,
    isVariant: scenario.isVariant === true,
    notes: scenario.notes,
    latencyBudgetMs: scenario.latencyBudgetMs ?? null,
    mustAvoidBackends: scenario.mustAvoidBackends ?? [],
    priority: scenario.priority ?? null,
    qualityNotes: scoring.qualityNotes,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scoreBreakdown: scoring.scoreBreakdown,
    seedPromptId: scenario.seedPromptId || String(scenario.id),
    sourceInventory: scenario.sourceInventory || scenario.inventoryName || null,
    status: scenarioResult.status,
    turns: turns.map((turn, index) => ({
      ...turn,
      antiAnchors: scenario.turns[index]?.antiAnchors ?? [],
      autoScore: scoring.turnScores[index]?.draftScore ?? null,
      autoVerdict: scoring.turnScores[index]?.verdict ?? null,
      expectedContracts: scenario.turns[index]?.expectedContracts ?? [],
      expectedRoutes: scenario.turns[index]?.expectedRoutes ?? [],
      factualAnchors: scenario.turns[index]?.factualAnchors ?? [],
      latencyBudgetMs: scenario.turns[index]?.latencyBudgetMs ?? null,
      qualityNotes: scoring.turnScores[index]?.qualityNotes ?? [],
      scoreBreakdown: scoring.turnScores[index]?.scoreBreakdown ?? null,
      usefulnessSummary: scoring.turnScores[index]?.usefulnessSummary ?? null,
    })),
    usefulnessSummary: scoring.usefulnessSummary,
    variantKey: scenario.variantKey || null,
    verdict: scoring.verdict,
  };
}

function deriveEndpointStatus(result) {
  const hasOutput = Boolean(String(result.assistant_output_raw || '').trim());

  if (result.status === 'success') {
    return hasOutput ? 'success' : 'incomplete';
  }

  if (result.failure_kind === 'missing_message_end' || result.failure_kind === 'request_timeout') {
    return 'incomplete';
  }

  if (result.failure_kind === 'network_error' && hasOutput) {
    return 'incomplete';
  }

  return 'visible_error';
}

function buildDiagnostics(result) {
  return {
    errorMessage: result.error_message ?? null,
    executionQuality: result.quality ?? null,
    executionTrace: result.executionTrace ?? null,
    failureKind: result.failure_kind ?? null,
    httpStatus: result.http_status ?? null,
    messageEndReceived: result.message_end_received ?? null,
    rawSse: result.raw_sse ?? '',
    sessionContextSummary: summarizeScenarioSessionContext(result.sessionContext),
    tigerPrimary: result.tigerPrimary ?? null,
    tigerShadow: result.tigerShadow ?? null,
    toolCalls: result.tool_calls ?? [],
    transportOk: result.transport_ok ?? null,
  };
}

function summarizeRouteMetadata(tigerPrimary, tigerShadow) {
  const parts = [];

  const primarySummary = summarizeTigerAttemptGroup('primary', tigerPrimary);
  if (primarySummary) {
    parts.push(primarySummary);
  }

  const shadowSummary = summarizeTigerAttemptGroup('shadow', tigerShadow);
  if (shadowSummary) {
    parts.push(shadowSummary);
  }

  return parts.join(' || ') || null;
}

function summarizeTigerAttemptGroup(label, value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const attempts = Array.isArray(value.attempts)
    ? value.attempts
        .map((attempt) => {
          const base = `${attempt.contractName}:${attempt.status}`;
          if (typeof attempt.resultCount === 'number') {
            return `${base}(${attempt.resultCount})`;
          }
          return base;
        })
        .join(', ')
    : '';

  return [
    `${label}=${value.route || 'unknown'}`,
    value.matchedIntent ? `intent=${value.matchedIntent}` : null,
    value.renderMode ? `render=${value.renderMode}` : null,
    attempts ? `attempts=${attempts}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function buildRunSummary(params) {
  const {
    auth,
    origin,
    promptResults,
    runEndedAt,
    runStartedAt,
    runtimeConfig,
    scenarioResults,
  } = params;
  const promptAverage = averageOf(promptResults.map((result) => result.draftScore));
  const scenarioAverage = averageOf(scenarioResults.map((result) => result.draftScore));

  return {
    authEmail: auth.email,
    authMode: auth.authMode,
    baselineDir: runtimeConfig.baselineDir || null,
    baselineLabel: runtimeConfig.baselineLabel || null,
    blendedPersona: BLENDED_PERSONA,
    delayMs: runtimeConfig.delayMs,
    endpointOrigin: origin,
    generatedAt: runEndedAt.toISOString(),
    inventoryName: runtimeConfig.inventoryName,
    promptAverageScore: roundToTenth(promptAverage),
    promptCount: promptResults.length,
    promptFailures: promptResults.filter((result) => result.status !== 'success').length,
    seedPromptCount: promptResults.filter((result) => result.isVariant !== true).length,
    queryApiBaseUrl: runtimeConfig.queryApiBaseUrl || null,
    queryApiSource: runtimeConfig.queryApiSource || null,
    runDurationMs: runEndedAt.getTime() - runStartedAt.getTime(),
    runEndedAt: runEndedAt.toISOString(),
    runStartedAt: runStartedAt.toISOString(),
    scenarioAverageScore: roundToTenth(scenarioAverage),
    scenarioCount: scenarioResults.length,
    shuffleSeed: runtimeConfig.shuffleSeed || null,
    transport: 'endpoint',
    turnTimeoutMs: runtimeConfig.turnTimeoutMs,
    variantMode: runtimeConfig.variantMode || 'off',
    variantPromptCount: promptResults.filter((result) => result.isVariant === true).length,
    weakestPrompts: [...promptResults]
      .sort((left, right) => left.draftScore - right.draftScore)
      .slice(0, 5)
      .map((result) => ({
        critiqueId: result.critiqueId,
        draftScore: result.draftScore,
        prompt: result.prompt,
        verdict: result.verdict,
      })),
    weakestScenarios: [...scenarioResults]
      .sort((left, right) => left.draftScore - right.draftScore)
      .slice(0, 3)
      .map((result) => ({
        draftScore: result.draftScore,
        scenarioId: result.scenarioId,
        scenarioName: result.scenarioName,
        verdict: result.verdict,
      })),
  };
}

function averageOf(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
