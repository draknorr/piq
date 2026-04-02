#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';

import { loadAutolabEnv } from '../chat-autolab/lib/env.mjs';
import {
  buildFullSuiteManifest,
  BLENDED_PERSONA,
} from './lib/full-suite-inventory.mjs';
import {
  formatLatencyMs,
  scorePromptResponse,
  scoreScenarioResult,
} from './lib/blended-persona-scoring.mjs';
import { writeFullSuiteArtifacts } from './lib/full-suite-artifacts.mjs';

const ROOT = process.cwd();
const DEFAULT_ADMIN_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'http://127.0.0.1:3003';
const DEFAULT_OUT_DIR = path.join(
  '/tmp',
  'publisheriq-chat-evals',
  `full-blended-ui-${new Date().toISOString().replace(/[:.]/g, '-')}`
);
const DEFAULT_QUERY_API_BASE_URL = process.env.QUERY_API_BASE_URL || 'http://127.0.0.1:4318';
const DEFAULT_DELAY_MS = Number(process.env.CHAT_EVAL_DELAY_MS || '1000');
const DEFAULT_TURN_TIMEOUT_MS = Number(process.env.CHAT_EVAL_REQUEST_TIMEOUT_MS || '90000');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir || DEFAULT_OUT_DIR;
  const env = await loadAutolabEnv();
  const adminOrigin = args.origin || DEFAULT_ADMIN_ORIGIN;
  const queryApiBaseUrl = args.queryApiUrl || env.QUERY_API_BASE_URL || DEFAULT_QUERY_API_BASE_URL;
  const manifest = await buildFullSuiteManifest({
    maxPrompts: args.maxPrompts,
    maxScenarios: args.maxScenarios,
  });
  const runtimeConfig = {
    adminOrigin,
    delayMs: args.delayMs ?? DEFAULT_DELAY_MS,
    headless: !args.headed,
    maxPrompts: args.maxPrompts,
    maxScenarios: args.maxScenarios,
    queryApiBaseUrl,
    turnTimeoutMs: args.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
  };

  validateRunnerEnv(env, runtimeConfig);

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(outDir, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'server-logs'), { recursive: true });

  const suiteManifestPath = path.join(outDir, 'suite-manifest.json');
  await fs.writeFile(
    suiteManifestPath,
    `${JSON.stringify(
      {
        blendedPersona: BLENDED_PERSONA,
        generatedAt: new Date().toISOString(),
        prompts: manifest.prompts,
        runtimeConfig,
        scenarios: manifest.scenarios,
      },
      null,
      2
    )}\n`
  );

  if (args.manifestOnly) {
    console.log(`Wrote suite manifest to ${suiteManifestPath}`);
    return;
  }

  const managedProcesses = [];
  const runStartedAt = new Date();

  try {
    const stackInfo = await ensureLocalStack({
      adminOrigin,
      env,
      managedProcesses,
      outDir,
      queryApiBaseUrl,
      turnTimeoutMs: runtimeConfig.turnTimeoutMs,
    });
    const browser = await chromium.launch({
      headless: runtimeConfig.headless,
      slowMo: args.slowMo ?? 0,
    });

    try {
      const context = await browser.newContext({
        baseURL: adminOrigin,
        viewport: { width: 1440, height: 1024 },
      });

      const promptResults = [];
      for (let index = 0; index < manifest.prompts.length; index += 1) {
        const promptRow = manifest.prompts[index];
        console.log(`[prompt ${index + 1}/${manifest.prompts.length}] ${promptRow.prompt}`);
        const result = await runPromptEvaluation({
          context,
          delayMs: runtimeConfig.delayMs,
          outDir,
          promptRow,
          turnTimeoutMs: runtimeConfig.turnTimeoutMs,
        });
        promptResults.push(result);
      }

      const scenarioResults = [];
      for (let index = 0; index < manifest.scenarios.length; index += 1) {
        const scenario = manifest.scenarios[index];
        console.log(`[scenario ${index + 1}/${manifest.scenarios.length}] ${scenario.name}`);
        const result = await runScenarioEvaluation({
          context,
          delayMs: runtimeConfig.delayMs,
          outDir,
          scenario,
          turnTimeoutMs: runtimeConfig.turnTimeoutMs,
        });
        scenarioResults.push(result);
      }

      await context.close();

      await writeArtifacts({
        outDir,
        promptResults,
        runEndedAt: new Date(),
        runStartedAt,
        runtimeConfig,
        scenarioResults,
        stackInfo,
      });

      console.log(`Full blended UI eval artifacts: ${outDir}`);
    } finally {
      await browser.close();
    }
  } finally {
    await stopManagedProcesses(managedProcesses);
  }
}

function parseArgs(argv) {
  const args = {
    delayMs: null,
    headed: false,
    manifestOnly: false,
    maxPrompts: 0,
    maxScenarios: 0,
    origin: '',
    outDir: '',
    queryApiUrl: '',
    slowMo: 0,
    turnTimeoutMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--origin') {
      args.origin = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--query-api-url') {
      args.queryApiUrl = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--out-dir') {
      args.outDir = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--max-prompts') {
      args.maxPrompts = Number(argv[index + 1] || '0');
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

    if (arg === '--slow-mo') {
      args.slowMo = Number(argv[index + 1] || '0');
      index += 1;
      continue;
    }

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--manifest-only') {
      args.manifestOnly = true;
      continue;
    }
  }

  return args;
}

function validateRunnerEnv(env, runtimeConfig) {
  const bypassEmail =
    env.CHAT_LOCAL_BROWSER_BYPASS_EMAIL ||
    env.CHAT_EVAL_BYPASS_EMAIL ||
    env.BYPASS_AUTH_EMAIL ||
    '';

  if (!bypassEmail.trim()) {
    throw new Error(
      'Missing CHAT_LOCAL_BROWSER_BYPASS_EMAIL, CHAT_EVAL_BYPASS_EMAIL, or BYPASS_AUTH_EMAIL for browser chat runs.'
    );
  }

  if (!env.LLM_PROVIDER?.trim()) {
    throw new Error('Missing LLM_PROVIDER for real chat runs.');
  }

  const provider = env.LLM_PROVIDER.trim().toLowerCase();
  if (provider === 'openai' && !env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY for real chat runs.');
  }

  if (provider === 'anthropic' && !env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error('Missing ANTHROPIC_API_KEY for real chat runs.');
  }

  const adminUrl = new URL(runtimeConfig.adminOrigin);
  if (!['localhost', '127.0.0.1'].includes(adminUrl.hostname)) {
    throw new Error(`Browser UI evals must target a local admin origin, received ${runtimeConfig.adminOrigin}`);
  }
}

async function ensureLocalStack(params) {
  const {
    adminOrigin,
    env,
    managedProcesses,
    outDir,
    queryApiBaseUrl,
    turnTimeoutMs,
  } = params;

  const queryApiInfo = await ensureQueryApi({
    env,
    managedProcesses,
    outDir,
    queryApiBaseUrl,
    timeoutMs: turnTimeoutMs,
  });
  const adminInfo = await startAdminServer({
    adminOrigin,
    env,
    managedProcesses,
    outDir,
    queryApiBaseUrl,
    timeoutMs: turnTimeoutMs,
  });

  return {
    admin: adminInfo,
    queryApi: queryApiInfo,
  };
}

async function ensureQueryApi(params) {
  const { env, managedProcesses, outDir, queryApiBaseUrl, timeoutMs } = params;
  const url = new URL(queryApiBaseUrl);
  const healthUrl = new URL('/healthz', queryApiBaseUrl);

  if (await isQueryApiHealthy(healthUrl)) {
    return {
      origin: queryApiBaseUrl,
      source: 'reused-existing',
    };
  }

  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Query API at ${queryApiBaseUrl} is not reachable, and only local query-api auto-start is supported.`);
  }

  const logPath = path.join(outDir, 'server-logs', 'query-api.log');
  const child = spawnManagedProcess({
    command: 'pnpm',
    args: ['query-api:dev'],
    cwd: ROOT,
    env: {
      ...env,
      QUERY_API_HOST: url.hostname,
      QUERY_API_PORT: url.port || '4318',
    },
    label: 'query-api',
    logPath,
  });
  managedProcesses.push(child);

  await waitForCondition({
    label: 'query-api',
    timeoutMs,
    verify: () => isQueryApiHealthy(healthUrl),
  });

  return {
    logPath,
    origin: queryApiBaseUrl,
    source: 'spawned',
  };
}

async function startAdminServer(params) {
  const { adminOrigin, env, managedProcesses, outDir, queryApiBaseUrl, timeoutMs } = params;
  const originUrl = new URL(adminOrigin);

  if (await canReachAdminOrigin(adminOrigin)) {
    throw new Error(
      `Admin origin ${adminOrigin} is already serving a page. Use --origin to choose a dedicated port for the browser eval run.`
    );
  }

  const bypassEmail =
    env.CHAT_LOCAL_BROWSER_BYPASS_EMAIL ||
    env.CHAT_EVAL_BYPASS_EMAIL ||
    env.BYPASS_AUTH_EMAIL;
  const logPath = path.join(outDir, 'server-logs', 'admin.log');
  const child = spawnManagedProcess({
    command: 'pnpm',
    args: [
      '--filter',
      '@publisheriq/admin',
      'exec',
      'next',
      'dev',
      '--port',
      originUrl.port || '3003',
    ],
    cwd: ROOT,
    env: {
      ...env,
      CHAT_EVAL_LOCAL_BYPASS_ENABLED: env.CHAT_EVAL_LOCAL_BYPASS_ENABLED || 'true',
      CHAT_LOCAL_BROWSER_BYPASS_EMAIL: bypassEmail,
      CHAT_LOCAL_BROWSER_BYPASS_ENABLED: 'true',
      CHAT_TIGER_PRIMARY_MODE: env.CHAT_TIGER_PRIMARY_MODE || 'eval',
      CHAT_TIGER_SHADOW_MODE: env.CHAT_TIGER_SHADOW_MODE || 'eval',
      NEXT_PUBLIC_CHAT_TIGER_DEBUG: 'false',
      NEXT_PUBLIC_SITE_URL: adminOrigin,
      PUBLISHERIQ_NEXT_DIST_DIR:
        env.PUBLISHERIQ_NEXT_DIST_DIR ||
        `.next-chat-evals-${originUrl.port || '3003'}`,
      QUERY_API_BASE_URL: queryApiBaseUrl,
    },
    label: 'admin',
    logPath,
  });
  managedProcesses.push(child);

  await waitForCondition({
    label: 'admin origin',
    timeoutMs,
    verify: () => canReachAdminOrigin(adminOrigin),
  });

  return {
    logPath,
    origin: adminOrigin,
    source: 'spawned',
  };
}

function spawnManagedProcess(params) {
  const { args, command, cwd, env, label, logPath } = params;
  const logStream = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
    logStream.write(chunk);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
    logStream.write(chunk);
  });

  child.on('exit', () => {
    logStream.end();
  });

  return {
    child,
    label,
    logPath,
  };
}

async function stopManagedProcesses(processes) {
  for (const processInfo of processes.reverse()) {
    const child = processInfo.child;
    if (!child || child.exitCode !== null) {
      continue;
    }

    child.kill('SIGTERM');
    const stopped = await waitForProcessExit(child, 5_000);
    if (!stopped) {
      child.kill('SIGKILL');
      await waitForProcessExit(child, 2_000);
    }
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return true;
  }

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function waitForCondition(params) {
  const { label, timeoutMs, verify } = params;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      if (await verify()) {
        return;
      }
    } catch {
      // keep polling
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function isQueryApiHealthy(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function canReachAdminOrigin(origin) {
  try {
    const response = await fetch(new URL('/', origin), {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      method: 'GET',
    });
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function runPromptEvaluation(params) {
  const { context, delayMs, outDir, promptRow, turnTimeoutMs } = params;
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);

  try {
    await openChat(page, turnTimeoutMs);
    const turn = await submitChatTurn({
      artifactPrefix: `prompt-${sanitizeForFileName(String(promptRow.critiqueId))}`,
      outDir,
      page,
      promptText: promptRow.prompt,
      turnTimeoutMs,
    });

    const scoring = scorePromptResponse({
      family: promptRow.family,
      latencyMs: turn.visibleLatencyMs,
      promptText: promptRow.prompt,
      renderedMetrics: turn.responseMetrics,
      renderedText: turn.responseText,
      status: turn.status,
    });

    if (delayMs > 0) {
      await page.waitForTimeout(delayMs);
    }

    return {
      critiqueId: promptRow.critiqueId,
      diagnostics: {
        chatResponseStatuses: diagnostics.chatResponseStatuses,
        consoleErrors: diagnostics.consoleErrors,
        pageErrors: diagnostics.pageErrors,
      },
      draftScore: scoring.draftScore,
      family: promptRow.family,
      primaryPersona: promptRow.primaryPersona,
      prompt: promptRow.prompt,
      qualityNotes: scoring.qualityNotes,
      responseMetrics: turn.responseMetrics,
      responseText: turn.responseText,
      scoreBreakdown: scoring.scoreBreakdown,
      screenshotPath: turn.screenshotPath,
      section: promptRow.section,
      sourceFamilies: promptRow.sourceFamilies,
      sourceSections: promptRow.sourceSections,
      sourceSuites: promptRow.sourceSuites,
      status: turn.status,
      usefulnessSummary: scoring.usefulnessSummary,
      verdict: scoring.verdict,
      visibleLatencyMs: turn.visibleLatencyMs,
      visibleLatencyText: formatLatencyMs(turn.visibleLatencyMs),
    };
  } finally {
    await page.close();
  }
}

async function runScenarioEvaluation(params) {
  const { context, delayMs, outDir, scenario, turnTimeoutMs } = params;
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);

  try {
    await openChat(page, turnTimeoutMs);

    const turns = [];
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const turnConfig = scenario.turns[index];
      const turn = await submitChatTurn({
        artifactPrefix: `scenario-${sanitizeForFileName(scenario.id)}-turn-${turnConfig.turnIndex}`,
        outDir,
        page,
        promptText: turnConfig.user,
        turnTimeoutMs,
      });

      turns.push({
        expectation: turnConfig.expectation,
        responseMetrics: turn.responseMetrics,
        responseText: turn.responseText,
        screenshotPath: turn.screenshotPath,
        status: turn.status,
        turnIndex: turnConfig.turnIndex,
        userPrompt: turnConfig.user,
        visibleLatencyMs: turn.visibleLatencyMs,
        visibleLatencyText: formatLatencyMs(turn.visibleLatencyMs),
      });

      if (delayMs > 0) {
        await page.waitForTimeout(delayMs);
      }

      if (turn.status === 'incomplete') {
        break;
      }
    }

    const scoring = scoreScenarioResult({
      scenario,
      turns,
    });

    return {
      carryForwardQuality: scoring.carryForwardQuality,
      diagnostics: {
        chatResponseStatuses: diagnostics.chatResponseStatuses,
        consoleErrors: diagnostics.consoleErrors,
        pageErrors: diagnostics.pageErrors,
      },
      draftScore: scoring.draftScore,
      notes: scenario.notes,
      qualityNotes: scoring.qualityNotes,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scoreBreakdown: scoring.scoreBreakdown,
      turns: turns.map((turn, index) => ({
        ...turn,
        autoScore: scoring.turnScores[index]?.draftScore ?? null,
        autoVerdict: scoring.turnScores[index]?.verdict ?? null,
        qualityNotes: scoring.turnScores[index]?.qualityNotes ?? [],
        scoreBreakdown: scoring.turnScores[index]?.scoreBreakdown ?? null,
        usefulnessSummary: scoring.turnScores[index]?.usefulnessSummary ?? null,
      })),
      usefulnessSummary: scoring.usefulnessSummary,
      verdict: scoring.verdict,
    };
  } finally {
    await page.close();
  }
}

function attachDiagnostics(page) {
  const diagnostics = {
    chatResponseStatuses: [],
    consoleErrors: [],
    pageErrors: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    if (response.url().includes('/api/chat/stream')) {
      diagnostics.chatResponseStatuses.push(response.status());
    }
  });

  return diagnostics;
}

async function openChat(page, timeoutMs) {
  await page.goto('/chat', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.getByTestId('chat-input').waitFor({ state: 'visible', timeout: timeoutMs });
}

async function submitChatTurn(params) {
  const { artifactPrefix, outDir, page, promptText, turnTimeoutMs } = params;
  const input = page.getByTestId('chat-input');
  const sendButton = page.getByTestId('chat-send');
  const assistantMessages = page.getByTestId('chat-message-assistant');
  const assistantContent = page.getByTestId('chat-message-assistant-content');
  const beforeAssistantCount = await assistantMessages.count();

  await input.fill(promptText);

  const startedAt = Date.now();
  await sendButton.click();

  await page.waitForFunction(
    ({ count }) => {
      return document.querySelectorAll('[data-testid="chat-message-assistant"]').length > count;
    },
    { count: beforeAssistantCount },
    { timeout: Math.min(turnTimeoutMs, 10_000) }
  );

  let status = 'success';
  try {
    await page.waitForFunction(() => {
      const send = document.querySelector('[data-testid="chat-send"]');
      return Boolean(send && !send.hasAttribute('disabled'));
    }, { timeout: turnTimeoutMs });
  } catch {
    status = 'incomplete';
  }

  const visibleLatencyMs = Date.now() - startedAt;
  const errorBanner = page.getByTestId('chat-error-banner');
  let errorBannerText = '';
  if (await errorBanner.count()) {
    try {
      errorBannerText = ((await errorBanner.innerText()) || '').trim();
    } catch {
      errorBannerText = '';
    }
  }

  if (status === 'success' && errorBannerText) {
    status = 'visible_error';
  }

  const contentLocator = assistantContent.nth(beforeAssistantCount);
  const responseText = ((await contentLocator.innerText().catch(() => '')) || '').trim();
  const responseMetrics = await contentLocator
    .evaluate((element) => {
      const countTableRows = () => {
        return [...element.querySelectorAll('table')].reduce((total, table) => {
          const tbodyRows = table.querySelectorAll('tbody tr').length;
          if (tbodyRows > 0) {
            return total + tbodyRows;
          }
          return total + Math.max(0, table.querySelectorAll('tr').length - 1);
        }, 0);
      };

      return {
        headingCount: element.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        linkCount: element.querySelectorAll('a').length,
        listItemCount: element.querySelectorAll('li').length,
        tableRowCount: countTableRows(),
      };
    })
    .catch(() => ({
      headingCount: 0,
      linkCount: 0,
      listItemCount: 0,
      tableRowCount: 0,
    }));

  let screenshotPath = null;
  if (status !== 'success') {
    const absoluteScreenshotPath = path.join(outDir, 'screenshots', `${artifactPrefix}.png`);
    await page.screenshot({
      filePath: absoluteScreenshotPath,
      fullPage: true,
    });
    screenshotPath = absoluteScreenshotPath;
  }

  return {
    errorBannerText,
    responseMetrics,
    responseText,
    screenshotPath,
    status,
    visibleLatencyMs,
  };
}

async function writeArtifacts(params) {
  const {
    outDir,
    promptResults,
    runEndedAt,
    runStartedAt,
    runtimeConfig,
    scenarioResults,
    stackInfo,
  } = params;
  const runSummary = buildRunSummary({
    promptResults,
    runEndedAt,
    runStartedAt,
    runtimeConfig,
    scenarioResults,
    stackInfo,
  });

  await writeFullSuiteArtifacts({
    outDir,
    promptResults,
    reportTitle: 'Full Blended-Persona Browser Chat Eval',
    runSummary,
    scenarioResults,
  });
}

function buildRankings(results, type) {
  return [...results]
    .sort((left, right) => {
      if (right.draftScore !== left.draftScore) {
        return right.draftScore - left.draftScore;
      }

      const leftLatency = inferRankingLatency(left, type);
      const rightLatency = inferRankingLatency(right, type);
      return leftLatency - rightLatency;
    })
    .map((result, index) => ({
      rank: index + 1,
      ...(type === 'prompt'
        ? {
            critiqueId: result.critiqueId,
            family: result.family,
            prompt: result.prompt,
          }
        : {
            scenarioId: result.scenarioId,
            scenarioName: result.scenarioName,
          }),
      draftScore: result.draftScore,
      status: result.status ?? 'scenario',
      usefulnessSummary: result.usefulnessSummary,
      verdict: result.verdict,
      visibleLatencyMs: inferRankingLatency(result, type),
    }));
}

function inferRankingLatency(result, type) {
  if (type === 'prompt') {
    return result.visibleLatencyMs ?? Number.MAX_SAFE_INTEGER;
  }

  return result.turns.reduce((sum, turn) => sum + (turn.visibleLatencyMs ?? 0), 0);
}

function buildRunSummary(params) {
  const {
    promptResults,
    runEndedAt,
    runStartedAt,
    runtimeConfig,
    scenarioResults,
    stackInfo,
  } = params;
  const promptAverage = averageOf(promptResults.map((result) => result.draftScore));
  const scenarioAverage = averageOf(scenarioResults.map((result) => result.draftScore));

  return {
    adminOrigin: runtimeConfig.adminOrigin,
    blendedPersona: BLENDED_PERSONA,
    generatedAt: runEndedAt.toISOString(),
    promptAverageScore: roundToTenth(promptAverage),
    promptCount: promptResults.length,
    promptFailures: promptResults.filter((result) => result.status !== 'success').length,
    queryApiBaseUrl: runtimeConfig.queryApiBaseUrl,
    queryApiSource: stackInfo.queryApi.source,
    runDurationMs: runEndedAt.getTime() - runStartedAt.getTime(),
    runEndedAt: runEndedAt.toISOString(),
    runStartedAt: runStartedAt.toISOString(),
    scenarioAverageScore: roundToTenth(scenarioAverage),
    scenarioCount: scenarioResults.length,
    turnTimeoutMs: runtimeConfig.turnTimeoutMs,
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

function buildCurationTemplate(promptResults, scenarioResults) {
  return {
    blendedPersona: BLENDED_PERSONA,
    prompts: promptResults.map((result) => ({
      critiqueId: result.critiqueId,
      draftScore: result.draftScore,
      draftVerdict: result.verdict,
      prompt: result.prompt,
      qualityNotes: result.qualityNotes,
      scoreBreakdown: result.scoreBreakdown,
      usefulnessSummary: result.usefulnessSummary,
      curatorNotes: null,
      overrideScore: null,
      overrideUsefulnessSummary: null,
      overrideVerdict: null,
    })),
    scenarios: scenarioResults.map((result) => ({
      scenarioId: result.scenarioId,
      scenarioName: result.scenarioName,
      draftScore: result.draftScore,
      draftVerdict: result.verdict,
      qualityNotes: result.qualityNotes,
      usefulnessSummary: result.usefulnessSummary,
      carryForwardQuality: result.carryForwardQuality,
      curatorNotes: null,
      overrideScore: null,
      overrideUsefulnessSummary: null,
      overrideVerdict: null,
      turns: result.turns.map((turn) => ({
        turnIndex: turn.turnIndex,
        userPrompt: turn.userPrompt,
        expectation: turn.expectation,
        autoScore: turn.autoScore,
        autoVerdict: turn.autoVerdict,
        usefulnessSummary: turn.usefulnessSummary,
        qualityNotes: turn.qualityNotes,
        overrideScore: null,
        notes: null,
      })),
    })),
  };
}

function renderLedgerRunDraft(params) {
  const { promptRankings, promptResults, runSummary, scenarioRankings, scenarioResults } = params;
  const lines = [
    '# Full Blended-Persona Browser Chat Eval',
    '',
    `- Generated: ${runSummary.generatedAt}`,
    `- Admin origin: ${runSummary.adminOrigin}`,
    `- Query API: ${runSummary.queryApiBaseUrl} (${runSummary.queryApiSource})`,
    `- Prompt count: ${runSummary.promptCount}`,
    `- Scenario count: ${runSummary.scenarioCount}`,
    `- Prompt average score: ${runSummary.promptAverageScore}/10`,
    `- Scenario average score: ${runSummary.scenarioAverageScore}/10`,
    `- Run duration: ${formatLatencyMs(runSummary.runDurationMs)}`,
    '',
    '## Blended Persona',
    '',
    `- Name: ${BLENDED_PERSONA.name}`,
    `- Summary: ${BLENDED_PERSONA.summary}`,
    '',
    '## Prompt Ranking',
    '',
    '| Rank | Critique ID | Score | Verdict | Prompt | Latency | Summary |',
    '|---:|---|---:|---|---|---:|---|',
  ];

  for (const row of promptRankings) {
    lines.push(
      `| ${row.rank} | ${escapeTable(row.critiqueId)} | ${row.draftScore.toFixed(1)} | ${row.verdict} | ${escapeTable(row.prompt)} | ${escapeTable(formatLatencyMs(row.visibleLatencyMs) || '-')} | ${escapeTable(row.usefulnessSummary)} |`
    );
  }

  lines.push('', '## Scenario Ranking', '', '| Rank | Scenario | Score | Verdict | Carry-forward | Summary |', '|---:|---|---:|---|---|---|');

  for (const row of scenarioRankings) {
    const scenario = scenarioResults.find((result) => result.scenarioId === row.scenarioId);
    lines.push(
      `| ${row.rank} | ${escapeTable(row.scenarioName)} | ${row.draftScore.toFixed(1)} | ${row.verdict} | ${escapeTable(scenario?.carryForwardQuality || '-')} | ${escapeTable(row.usefulnessSummary)} |`
    );
  }

  lines.push('', '## Prompt Details', '');

  for (const result of promptResults) {
    lines.push(`### #${result.critiqueId} ${result.prompt}`);
    lines.push('');
    lines.push(`- Section: ${result.section}`);
    lines.push(`- Family: ${result.family}`);
    lines.push(`- Status: ${result.status}`);
    lines.push(`- Draft score: ${result.draftScore}/10`);
    lines.push(`- Verdict: ${result.verdict}`);
    lines.push(`- Visible latency: ${result.visibleLatencyText || '-'}`);
    lines.push(`- Usefulness summary: ${result.usefulnessSummary}`);
    lines.push(`- Notes: ${result.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
    if (result.screenshotPath) {
      lines.push(`- Screenshot: ${result.screenshotPath}`);
    }
    lines.push('', '```md', result.responseText || '[no visible assistant text captured]', '```', '');
  }

  lines.push('## Scenario Details', '');

  for (const result of scenarioResults) {
    lines.push(`### ${result.scenarioName}`);
    lines.push('');
    lines.push(`- Scenario ID: ${result.scenarioId}`);
    lines.push(`- Draft score: ${result.draftScore}/10`);
    lines.push(`- Verdict: ${result.verdict}`);
    lines.push(`- Carry-forward quality: ${result.carryForwardQuality}`);
    lines.push(`- Usefulness summary: ${result.usefulnessSummary}`);
    lines.push(`- Notes: ${result.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
    lines.push('');

    for (const turn of result.turns) {
      lines.push(`#### Turn ${turn.turnIndex}`);
      lines.push(`- User prompt: ${turn.userPrompt}`);
      if (turn.expectation) {
        lines.push(`- Expectation: ${turn.expectation}`);
      }
      lines.push(`- Status: ${turn.status}`);
      lines.push(`- Draft score: ${turn.autoScore ?? '-'}`);
      lines.push(`- Verdict: ${turn.autoVerdict ?? '-'}`);
      lines.push(`- Visible latency: ${turn.visibleLatencyText || '-'}`);
      lines.push(`- Usefulness summary: ${turn.usefulnessSummary || '-'}`);
      lines.push(`- Notes: ${turn.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
      if (turn.screenshotPath) {
        lines.push(`- Screenshot: ${turn.screenshotPath}`);
      }
      lines.push('', '```md', turn.responseText || '[no visible assistant text captured]', '```', '');
    }
  }

  return `${lines.join('\n')}\n`;
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

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function sanitizeForFileName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
