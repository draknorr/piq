#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  authenticateEval,
  evaluateChatRequest as evaluateEndpointChatRequest,
  evaluateScenario as evaluateChatScenario,
  loadEvalEnvFiles,
  parseSse as parseEvalSse,
  readEvalBypassEmail as readEvalBypassEmailHelper,
  serializeCookies as serializeEvalCookies,
  shouldUseLocalEvalBypass as shouldUseLocalEvalBypassHelper,
  summarizeScenarioSessionContext as summarizeScenarioContext,
  validateEvalEnv,
} from './lib/endpoint-eval.mjs';

const ROOT = process.cwd();
const PROD_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'https://www.publisheriq.app';
const MODE = process.env.CHAT_EVAL_MODE || 'full';
const SCENARIOS_FILE = process.env.CHAT_EVAL_SCENARIOS_FILE || '';
const OUT_DIR =
  process.env.CHAT_EVAL_OUT_DIR ||
  path.join('/tmp', 'publisheriq-chat-evals', new Date().toISOString().replace(/[:.]/g, '-'));
const DOC_PATH =
  process.env.CHAT_EVAL_DOC_PATH ||
  (SCENARIOS_FILE ? path.join(OUT_DIR, 'report.md') : path.join(ROOT, 'docs/chat-prompt-evals.md'));
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const RESULTS_PATH = path.join(OUT_DIR, 'results.json');
const BASELINE_OUT_DIR = process.env.CHAT_EVAL_BASELINE_OUT_DIR || '';
const INCLUDE_PROMPTS_FILE = process.env.CHAT_EVAL_INCLUDE_PROMPTS_FILE || '';
const MAX_CONCURRENCY = Number(process.env.CHAT_EVAL_CONCURRENCY || '1');
const REQUEST_DELAY_MS = Number(process.env.CHAT_EVAL_DELAY_MS || '3000');
const REQUEST_TIMEOUT_MS = Number(process.env.CHAT_EVAL_REQUEST_TIMEOUT_MS || '90000');
const MAX_PROMPTS = Number(process.env.CHAT_EVAL_MAX_PROMPTS || '0');
const MAX_RETRIES = Number(process.env.CHAT_EVAL_MAX_RETRIES || '1');
const RETRY_DELAY_MS = Number(process.env.CHAT_EVAL_RETRY_DELAY_MS || '20000');
const RETRY_429_INITIAL_COOLDOWN_MS = Number(
  process.env.CHAT_EVAL_429_INITIAL_COOLDOWN_MS || '300000'
);
const RETRY_429_MAX_ATTEMPTS = Number(process.env.CHAT_EVAL_429_MAX_ATTEMPTS || '3');

const RETRY_429_PROMPT_ORDER = [
  'metroidvania games under $20',
  'Top 10 games by reviews',
  'Show me all games by Krafton',
  'Top Steam Deck verified games with 90%+ reviews and at least 10,000 reviews',
  'Publishers with the most games released in the past 6 months',
  'Show me developers similar to Supergiant Games',
  'What publishers are similar to Devolver Digital?',
  'Steam Deck games similar to Hades II',
  'Steam Deck verified games similar to Celeste',
  'Steam Deck games similar to Hades with better reviews',
  'Show me high velocity games',
];

const SOURCE_FILES = {
  examplePrompts: path.join(ROOT, 'apps/admin/src/lib/example-prompts.ts'),
  chatSmoke: path.join(ROOT, 'apps/admin/src/app/(main)/admin/chat-smoke/page.tsx'),
  queryTemplates: path.join(ROOT, 'apps/admin/src/lib/chat/query-templates.ts'),
  suggestionGenerator: path.join(ROOT, 'apps/admin/src/lib/chat/suggestion-generator.ts'),
  globalSearch: path.join(ROOT, 'apps/admin/src/components/search/GlobalSearch.tsx'),
  chatInput: path.join(ROOT, 'apps/admin/src/components/chat/ChatInput.tsx'),
  chatInterfaceDoc: path.join(ROOT, 'docs/user-guide/chat-interface.md'),
  chatQueryExamplesDoc: path.join(ROOT, 'docs/user-guide/chat-query-examples.md'),
  changeReferenceDoc: path.join(ROOT, 'docs/reference/steam-game-change-intelligence-research.md'),
  rootEnv: path.join(ROOT, '.env'),
};

const TAG_TEMPLATE_SEED = 'metroidvania';
const GAME_TEMPLATE_SEED = 'Hades II';
const PUBLISHER_TEMPLATE_SEED = 'Krafton';
const DEVELOPER_TEMPLATE_SEED = 'FromSoftware';
const GLOBAL_SEARCH_GAME_SEED = 'Elden Ring';
const GLOBAL_SEARCH_SIMILAR_SEED = 'Hades';

async function main() {
  const env = await loadEnvFiles([SOURCE_FILES.rootEnv]);
  validateEnv(env);

  await fs.mkdir(OUT_DIR, { recursive: true });

  if (SCENARIOS_FILE) {
    await runScenarioEvaluation(env);
    return;
  }

  const manifest = await buildManifest();
  const executableManifest = manifest.filter((row) => row.executable);
  const includePrompts = await loadIncludedPrompts();
  if (MODE === 'retry_429_only') {
    await runRetry429Only(env, manifest, executableManifest, includePrompts);
    return;
  }

  await runFullEvaluation(env, manifest, executableManifest, includePrompts);
}

async function runScenarioEvaluation(env) {
  const scenarios = await loadScenarios(SCENARIOS_FILE);
  const executableScenarios = MAX_PROMPTS > 0 ? scenarios.slice(0, MAX_PROMPTS) : scenarios;
  const auth = await authenticate(env);
  const results = [];

  console.log(`Prepared ${executableScenarios.length} multi-turn scenarios against ${PROD_ORIGIN}`);
  console.log(
    auth.authMode === 'eval_bypass'
      ? `Using local eval bypass against ${PROD_ORIGIN} as ${auth.email}`
      : `Authenticated against ${PROD_ORIGIN} as ${auth.email}`
  );

  for (let index = 0; index < executableScenarios.length; index += 1) {
    const scenario = executableScenarios[index];
    console.log(`[${index + 1}/${executableScenarios.length}] ${scenario.name}`);
    const result = await evaluateScenario(scenario, auth);
    console.log(
      `  -> ${result.status} | ${
        result.turns.reduce((sum, turn) => sum + (turn.timing?.totalMs ?? 0), 0)
      }ms | ${result.turns.length} turns`
    );
    results.push(result);
  }

  await fs.writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        mode: 'scenario',
        generatedAt: new Date().toISOString(),
        origin: PROD_ORIGIN,
        scenariosFile: path.relative(ROOT, SCENARIOS_FILE),
        scenarioCount: executableScenarios.length,
        authEmail: auth.email,
        authMode: auth.authMode,
      },
      null,
      2
    )}\n`
  );
  await fs.writeFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
  await fs.writeFile(DOC_PATH, renderScenarioReport(results));

  console.log(`Wrote ${DOC_PATH} and raw artifacts to ${OUT_DIR}`);
}

async function loadScenarios(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Scenario file must contain an array: ${filePath}`);
  }

  return raw.map((scenario) => {
    if (!scenario || typeof scenario !== 'object') {
      throw new Error(`Invalid scenario entry in ${filePath}`);
    }

    if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) {
      throw new Error(`Scenario ${scenario.id || scenario.name || 'unknown'} must define turns`);
    }

    return {
      id: String(scenario.id || scenario.name),
      name: String(scenario.name || scenario.id),
      notes: typeof scenario.notes === 'string' ? scenario.notes : '',
      turns: scenario.turns.map((turn) => {
        if (!turn || typeof turn !== 'object' || typeof turn.user !== 'string') {
          throw new Error(`Scenario ${scenario.id || scenario.name || 'unknown'} has an invalid turn`);
        }

        return {
          user: turn.user,
          expectation: typeof turn.expectation === 'string' ? turn.expectation : '',
        };
      }),
    };
  });
}

function renderScenarioReport(results) {
  const lines = ['# Chat Multi-Turn Evaluation Report', ''];

  for (const result of results) {
    lines.push(`## ${result.scenario_name}`);
    if (result.notes) {
      lines.push('', result.notes);
    }
    lines.push('', `- Status: ${result.status}`);
    lines.push(`- Turns: ${result.turns.length}`);
    lines.push('');

    for (const turn of result.turns) {
      lines.push(`### Turn ${turn.turn_index}`);
      lines.push(`- User: ${turn.user_prompt}`);
      if (turn.expectation) {
        lines.push(`- Expectation: ${turn.expectation}`);
      }
      lines.push(`- Status: ${turn.status}`);
      lines.push(`- Tools: ${turn.tool_calls.map((tool) => tool.name).join(', ') || 'none'}`);
      lines.push(`- Time: ${turn.timing?.totalMs ?? '-'}ms`);
      lines.push(`- Tiger primary: ${summarizeTigerPrimary(turn.tiger_primary)}`);
      lines.push(`- Tiger shadow: ${summarizeTigerShadow(turn.tiger_shadow)}`);
      if (turn.session_context_summary) {
        lines.push(
          `- Session Context: ${[
            ...(turn.session_context_summary.entities ?? []),
            ...(turn.session_context_summary.constraints ?? []),
            turn.session_context_summary.candidateSet,
          ]
            .filter(Boolean)
            .join(' | ')}`
        );
      }
      lines.push('');
      lines.push('```text');
      lines.push(turn.assistant_output_raw || turn.error_message || '');
      lines.push('```');
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

async function runFullEvaluation(env, manifest, executableManifest, includePrompts) {
  const manifestToRun = applyManifestFilters(executableManifest, includePrompts);
  const checkpointResults = await loadCheckpointResults();
  const resumedResults = checkpointResults.filter((row) =>
    manifestToRun.some((manifestRow) => manifestRow.prompt_id === row.prompt_id) &&
    !shouldRerunCheckpointRow(row)
  );

  console.log(
    `Prepared ${manifest.length} manifest rows (${manifestToRun.length} executable) against ${PROD_ORIGIN}`
  );
  if (resumedResults.length > 0) {
    console.log(`Resuming from checkpoint with ${resumedResults.length} completed prompts`);
  }

  const metadata = {
    mode: MODE,
    generatedAt: new Date().toISOString(),
    origin: PROD_ORIGIN,
    concurrency: MAX_CONCURRENCY,
    requestDelayMs: REQUEST_DELAY_MS,
    maxPrompts: MAX_PROMPTS,
    outDir: OUT_DIR,
    docPath: DOC_PATH,
    authEmail: readEvalBypassEmail(env),
    authMode: null,
    runStatus: resumedResults.length > 0 ? 'resuming' : 'starting',
    completedPrompts: resumedResults.length,
    totalExecutablePrompts: manifestToRun.length,
    lastUpdatedAt: new Date().toISOString(),
  };
  if (includePrompts.filePath) {
    metadata.includePromptsFile = path.relative(ROOT, includePrompts.filePath);
    metadata.includePromptsCount = includePrompts.entries.length;
  }
  const checkpoint = createCheckpointWriter({
    manifest,
    executableManifest: manifestToRun,
    metadata,
  });
  await checkpoint(resumedResults);

  const auth = await authenticate(env);
  metadata.authMode = auth.authMode;
  console.log(
    auth.authMode === 'eval_bypass'
      ? `Using local eval bypass against ${PROD_ORIGIN} as ${auth.email}`
      : `Authenticated against ${PROD_ORIGIN} as ${auth.email}`
  );

  const results = [...resumedResults];
  if (results.length === 0 && manifestToRun.length > 0) {
    const calibrationPrompt = manifestToRun[0];
    const calibrationResult = await evaluatePrompt(calibrationPrompt, auth);
    if (calibrationResult.status !== 'success') {
      throw new Error(
        `Calibration failed for "${calibrationPrompt.prompt_text}": ${calibrationResult.error_message || 'Unknown error'}`
      );
    }

    results.push(finalizeResult(calibrationPrompt, calibrationResult));
    await checkpoint(results);
  }

  const promptIds = new Set(results.map((row) => row.prompt_id));

  const pending = manifestToRun.filter((row) => !promptIds.has(row.prompt_id));
  const remainingResults = await runPool(
    pending,
    MAX_CONCURRENCY,
    async (row, index, total) => {
      console.log(`[${index + 1}/${total}] ${row.prompt_text}`);
      const finalized = finalizeResult(row, await evaluatePrompt(row, auth));
      console.log(
        `  -> ${finalized.status} | ${finalized.timing?.totalMs ?? '-'}ms | ${
          finalized.tool_calls.map((tool) => tool.name).join(', ') || 'no tools'
        }`
      );
      results.push(finalized);
      await checkpoint(results);
      return finalized;
    },
    REQUEST_DELAY_MS
  );
  const pendingResultIds = new Set(pending.map((row) => row.prompt_id));
  const alreadyCapturedIds = new Set(results.map((row) => row.prompt_id));
  for (const row of remainingResults) {
    if (!row || !pendingResultIds.has(row.prompt_id) || alreadyCapturedIds.has(row.prompt_id)) {
      continue;
    }
    results.push(row);
  }

  metadata.runStatus = 'complete';
  metadata.generatedAt = new Date().toISOString();
  await checkpoint(results);

  console.log(`Wrote ${DOC_PATH} and raw artifacts to ${OUT_DIR}`);
}

async function runRetry429Only(env, manifest, executableManifest, includePrompts) {
  if (MAX_CONCURRENCY !== 1) {
    throw new Error('retry_429_only requires CHAT_EVAL_CONCURRENCY=1');
  }
  if (!BASELINE_OUT_DIR) {
    throw new Error('retry_429_only requires CHAT_EVAL_BASELINE_OUT_DIR');
  }

  const baselineResultsPath = path.join(BASELINE_OUT_DIR, 'results.json');
  const baselineResults = await loadResultsFromFile(baselineResultsPath);
  if (!baselineResults.length) {
    throw new Error(`No baseline results found at ${baselineResultsPath}`);
  }

  const retryTargetsAll = build429RetryTargets(baselineResults, manifest);
  const filteredRetryTargets = applyRetryTargetFilters(retryTargetsAll, includePrompts);
  const retryTargets = MAX_PROMPTS > 0 ? filteredRetryTargets.slice(0, MAX_PROMPTS) : filteredRetryTargets;

  console.log(
    `Prepared ${manifest.length} manifest rows (${baselineResults.length} baseline executable rows) against ${PROD_ORIGIN}`
  );
  console.log(`Loaded baseline results from ${baselineResultsPath}`);
  console.log(`Targeting ${retryTargets.length} OpenAI 429 prompt failures in single-threaded retry mode`);

  const metadata = {
    mode: MODE,
    manualProgress: true,
    generatedAt: new Date().toISOString(),
    origin: PROD_ORIGIN,
    concurrency: MAX_CONCURRENCY,
    requestDelayMs: REQUEST_DELAY_MS,
    maxPrompts: MAX_PROMPTS,
    outDir: OUT_DIR,
    docPath: DOC_PATH,
    authEmail: readEvalBypassEmail(env),
    authMode: null,
    runStatus: 'starting',
    completedPrompts: 0,
    totalExecutablePrompts: retryTargets.length,
    lastUpdatedAt: new Date().toISOString(),
    baselineOutDir: BASELINE_OUT_DIR,
    retryFilter: 'OpenAI API error: 429',
    retryTargetsTotal: retryTargets.length,
    retryTargetsCompleted: 0,
    retryInitialCooldownMs: RETRY_429_INITIAL_COOLDOWN_MS,
    retryAttemptLimit: RETRY_429_MAX_ATTEMPTS,
  };
  if (includePrompts.filePath) {
    metadata.includePromptsFile = path.relative(ROOT, includePrompts.filePath);
    metadata.includePromptsCount = includePrompts.entries.length;
  }
  const checkpoint = createCheckpointWriter({
    manifest,
    executableManifest,
    metadata,
  });

  const results = baselineResults.map((row) => ({ ...row }));
  await checkpoint(results);

  if (retryTargets.length === 0) {
    metadata.runStatus = 'complete';
    metadata.generatedAt = new Date().toISOString();
    await checkpoint(results);
    console.log(`No OpenAI 429 rows found in baseline results. Wrote ${DOC_PATH} to ${OUT_DIR}`);
    return;
  }

  const auth = await authenticate(env);
  metadata.authMode = auth.authMode;
  console.log(
    auth.authMode === 'eval_bypass'
      ? `Using local eval bypass against ${PROD_ORIGIN} as ${auth.email}`
      : `Authenticated against ${PROD_ORIGIN} as ${auth.email}`
  );

  if (RETRY_429_INITIAL_COOLDOWN_MS > 0) {
    metadata.runStatus = 'cooldown';
    await checkpoint(results);
    console.log(`Cooling down for ${RETRY_429_INITIAL_COOLDOWN_MS}ms before retrying OpenAI 429 rows`);
    await sleep(RETRY_429_INITIAL_COOLDOWN_MS);
  }

  metadata.runStatus = 'running';
  await checkpoint(results);

  for (let index = 0; index < retryTargets.length; index += 1) {
    const target = retryTargets[index];
    const originalRow = sanitizeResultForArchive(target.row.original_result || target.row);
    const history = Array.isArray(target.row.retry_history) ? [...target.row.retry_history] : [];
    const baseAttemptCount = Number(target.row.attempts || 0);

    console.log(`[${index + 1}/${retryTargets.length}] ${target.promptRow.prompt_text}`);

    for (let attemptNumber = 1; attemptNumber <= RETRY_429_MAX_ATTEMPTS; attemptNumber += 1) {
      const attemptResult = await evaluatePromptOnce(target.promptRow, auth);
      const totalAttempts = baseAttemptCount + attemptNumber;
      history.push(
        buildRetryHistoryEntry({
          attemptNumber,
          totalAttempts,
          result: attemptResult,
        })
      );
      const mergedRow = buildRetryMergedRow({
        promptRow: target.promptRow,
        attemptResult,
        originalResult: originalRow,
        retryHistory: history,
        retryStatus: isOpenAi429Result(attemptResult) ? 'retrying_429' : 'retry_finished',
        attempts: totalAttempts,
      });

      replaceResultRow(results, mergedRow);
      await checkpoint(results);

      console.log(
        `  -> ${attemptResult.status} | ${attemptResult.timing?.totalMs ?? '-'}ms | ${
          attemptResult.tool_calls.map((tool) => tool.name).join(', ') || 'no tools'
        }`
      );

      if (!isOpenAi429Result(attemptResult)) {
        const finalRetryStatus = attemptResult.status === 'success' ? 'resolved' : 'resolved_non_429';
        const finalizedRow = {
          ...mergedRow,
          retry_status: finalRetryStatus,
          assessment: build429Assessment(mergedRow, finalRetryStatus),
        };
        replaceResultRow(results, finalizedRow);
        await checkpoint(results);
        break;
      }

      if (attemptNumber >= RETRY_429_MAX_ATTEMPTS) {
        const finalizedRow = {
          ...mergedRow,
          retry_status: 'persistent_429',
          assessment: build429Assessment(mergedRow, 'persistent_429'),
        };
        replaceResultRow(results, finalizedRow);
        await checkpoint(results);
        break;
      }

      const retryAfterMs =
        attemptNumber === 1
          ? Math.max(parseRetryAfterMs(attemptResult.error_message) + 5000, REQUEST_DELAY_MS, 60000)
          : 120000;
      console.log(`  -> OpenAI 429 persisted; waiting ${retryAfterMs}ms before next attempt`);
      await sleep(retryAfterMs);
    }

    metadata.retryTargetsCompleted = index + 1;
    metadata.completedPrompts = metadata.retryTargetsCompleted;
    await checkpoint(results);

    if (index < retryTargets.length - 1 && REQUEST_DELAY_MS > 0) {
      console.log(`  -> waiting ${REQUEST_DELAY_MS}ms before the next retry target`);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  metadata.runStatus = 'complete';
  metadata.generatedAt = new Date().toISOString();
  await checkpoint(results);

  console.log(`Wrote ${DOC_PATH} and raw artifacts to ${OUT_DIR}`);
}

async function loadCheckpointResults() {
  return loadResultsFromFile(RESULTS_PATH);
}

async function loadIncludedPrompts() {
  if (!INCLUDE_PROMPTS_FILE) {
    return { filePath: null, entries: [] };
  }

  const filePath = path.isAbsolute(INCLUDE_PROMPTS_FILE)
    ? INCLUDE_PROMPTS_FILE
    : path.join(ROOT, INCLUDE_PROMPTS_FILE);
  const raw = await fs.readFile(filePath, 'utf8');
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = line.match(/^(?<label>[^|]+)\|(?<prompt>.+)$/);
      const promptText = match?.groups?.prompt?.trim() || line;
      const label = match?.groups?.label?.trim() || null;
      return {
        label,
        prompt_text: sanitizePrompt(promptText),
        normalized_text: normalizePrompt(promptText),
      };
    });

  if (entries.length === 0) {
    throw new Error(`No prompts found in include file: ${filePath}`);
  }

  return { filePath, entries };
}

function buildManualIncludeRow(entry, includeFilePath) {
  const sourceKind = 'manual_include';
  const supportTier = inferSupportTier([sourceKind]);
  const family = inferFamily(entry.prompt_text, false);
  const promptKey = entry.label
    ? `manual_include:${entry.label}:${entry.normalized_text}`
    : `manual_include:${entry.normalized_text}`;

  return {
    prompt_id: crypto.createHash('sha1').update(promptKey).digest('hex').slice(0, 12),
    prompt_text: entry.prompt_text,
    normalized_text: entry.normalized_text,
    executable: true,
    is_template: false,
    seed_used: null,
    support_tier: supportTier,
    family,
    expected_tools: inferExpectedTools(family, entry.prompt_text),
    cost_class: inferCostClass(family, supportTier),
    source_kinds: [sourceKind],
    source_locations: includeFilePath ? [path.relative(ROOT, includeFilePath)] : ['manual_include'],
  };
}

function applyManifestFilters(executableManifest, includePrompts) {
  let manifestToRun = executableManifest;

  if (includePrompts.entries.length > 0) {
    const manifestByPrompt = new Map(
      executableManifest.map((row) => [row.normalized_text, row])
    );
    const missing = [];
    const selected = [];

    for (const entry of includePrompts.entries) {
      const row = manifestByPrompt.get(entry.normalized_text);
      if (!row) {
        if (entry.label) {
          selected.push(buildManualIncludeRow(entry, includePrompts.filePath));
          continue;
        }
        missing.push(entry.prompt_text);
        continue;
      }
      selected.push(row);
    }

    if (missing.length > 0) {
      throw new Error(
        `Prompt include filter did not match manifest rows: ${missing.join(' | ')}`
      );
    }

    manifestToRun = selected;
  }

  if (MAX_PROMPTS > 0) {
    manifestToRun = manifestToRun.slice(0, MAX_PROMPTS);
  }

  return manifestToRun;
}

function applyRetryTargetFilters(retryTargets, includePrompts) {
  if (includePrompts.entries.length === 0) {
    return retryTargets;
  }

  const retryTargetByPrompt = new Map(
    retryTargets.map((entry) => [normalizePrompt(entry.promptRow.prompt_text), entry])
  );
  const missing = [];
  const selected = [];

  for (const entry of includePrompts.entries) {
    const target = retryTargetByPrompt.get(entry.normalized_text);
    if (!target) {
      missing.push(entry.prompt_text);
      continue;
    }
    selected.push(target);
  }

  if (missing.length > 0) {
    throw new Error(
      `Prompt include filter did not match retry targets: ${missing.join(' | ')}`
    );
  }

  return selected;
}

async function loadResultsFromFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((row) => row && typeof row.prompt_id === 'string');
  } catch {
    return [];
  }
}

async function loadEnvFiles(files) {
  return loadEvalEnvFiles(files);
}

function validateEnv(env) {
  return validateEvalEnv({ env, origin: PROD_ORIGIN });
}

async function authenticate(env) {
  return authenticateEval({ env, origin: PROD_ORIGIN });
}

function shouldUseLocalEvalBypass(origin, env) {
  return shouldUseLocalEvalBypassHelper(origin, env);
}

function readEvalBypassEmail(env) {
  return readEvalBypassEmailHelper(env);
}

function storeResponseCookies(response, cookieJar) {
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookieJar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

function serializeCookies(cookieJar) {
  return serializeEvalCookies(cookieJar);
}

async function buildManifest() {
  const sources = [];

  const examplePrompts = await extractExamplePrompts();
  const smokePrompts = await extractSmokePrompts();
  const templateCatalog = await extractTemplateCatalog();
  const followUpCatalog = await extractFollowUpCatalog();
  const globalSearchShells = await extractGlobalSearchShells();
  const chatInputShells = await extractChatInputShells();
  const chatInterfacePrompts = await extractChatInterfaceDocPrompts();
  const chatQueryExamplesPrompts = await extractChatQueryExamplesDocPrompts();
  const changeReferencePrompts = await extractChangeReferencePrompts();

  for (const prompt of examplePrompts) {
    sources.push({
      prompt_text: prompt,
      source_kind: 'runtime_example',
      source_locations: [relativePath(SOURCE_FILES.examplePrompts)],
      executable: true,
    });
  }

  for (const row of smokePrompts) {
    sources.push({
      prompt_text: row.prompt,
      source_kind: 'runtime_smoke',
      source_locations: [relativePath(SOURCE_FILES.chatSmoke)],
      executable: true,
      expected_tools: [row.tool],
    });
  }

  for (const row of templateCatalog) {
    sources.push({
      prompt_text: row.template,
      source_kind: row.source_kind,
      source_locations: [relativePath(SOURCE_FILES.queryTemplates)],
      executable: false,
      is_template: true,
      template_seed: row.seed,
    });
    sources.push({
      prompt_text: row.seeded_prompt,
      source_kind: 'template_seed',
      source_locations: [relativePath(SOURCE_FILES.queryTemplates)],
      executable: true,
      seed_used: row.seed,
    });
  }

  for (const row of followUpCatalog) {
    sources.push({
      prompt_text: row.template,
      source_kind: row.source_kind,
      source_locations: [relativePath(SOURCE_FILES.suggestionGenerator)],
      executable: !row.is_template,
      is_template: row.is_template,
      template_seed: row.seed,
    });
    if (row.is_template) {
      sources.push({
        prompt_text: row.seeded_prompt,
        source_kind: 'template_seed',
        source_locations: [relativePath(SOURCE_FILES.suggestionGenerator)],
        executable: true,
        seed_used: row.seed,
      });
    }
  }

  for (const row of globalSearchShells) {
    sources.push({
      prompt_text: row.template,
      source_kind: 'runtime_global_search_shell',
      source_locations: [relativePath(SOURCE_FILES.globalSearch)],
      executable: false,
      is_template: true,
      template_seed: row.seed,
    });
    sources.push({
      prompt_text: row.seeded_prompt,
      source_kind: 'template_seed',
      source_locations: [relativePath(SOURCE_FILES.globalSearch)],
      executable: true,
      seed_used: row.seed,
    });
  }

  for (const row of chatInputShells) {
    sources.push({
      prompt_text: row.template,
      source_kind: 'runtime_chat_input_shell',
      source_locations: [relativePath(SOURCE_FILES.chatInput)],
      executable: false,
      is_template: true,
      template_seed: row.seed,
    });
    sources.push({
      prompt_text: row.seeded_prompt,
      source_kind: 'template_seed',
      source_locations: [relativePath(SOURCE_FILES.chatInput)],
      executable: true,
      seed_used: row.seed,
    });
  }

  for (const prompt of chatInterfacePrompts) {
    sources.push({
      prompt_text: prompt,
      source_kind: 'docs_user_chat_interface',
      source_locations: [relativePath(SOURCE_FILES.chatInterfaceDoc)],
      executable: true,
    });
  }

  for (const prompt of chatQueryExamplesPrompts) {
    sources.push({
      prompt_text: prompt,
      source_kind: 'docs_user_chat_query_examples',
      source_locations: [relativePath(SOURCE_FILES.chatQueryExamplesDoc)],
      executable: true,
    });
  }

  for (const prompt of changeReferencePrompts) {
    sources.push({
      prompt_text: prompt,
      source_kind: 'docs_reference_change_intel',
      source_locations: [relativePath(SOURCE_FILES.changeReferenceDoc)],
      executable: true,
    });
  }

  return dedupeManifestRows(sources);
}

function dedupeManifestRows(rows) {
  const manifestMap = new Map();

  for (const row of rows) {
    const normalized_text = normalizePrompt(row.prompt_text);
    const templateFlag = row.is_template ? 'template' : 'concrete';
    const key = `${templateFlag}:${normalized_text}`;
    const existing = manifestMap.get(key);
    if (!existing) {
      const prompt_id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
      const support_tier = inferSupportTier([row.source_kind]);
      const family = inferFamily(row.prompt_text, row.is_template);
      manifestMap.set(key, {
        prompt_id,
        prompt_text: sanitizePrompt(row.prompt_text),
        normalized_text,
        executable: row.executable,
        is_template: Boolean(row.is_template),
        seed_used: row.seed_used || null,
        support_tier,
        family,
        expected_tools: row.expected_tools || inferExpectedTools(family, row.prompt_text),
        cost_class: inferCostClass(family, support_tier),
        source_kinds: [row.source_kind],
        source_locations: [...new Set(row.source_locations)],
      });
      continue;
    }

    existing.executable = existing.executable || row.executable;
    if (row.seed_used && !existing.seed_used) {
      existing.seed_used = row.seed_used;
    }
    existing.source_kinds = [...new Set([...existing.source_kinds, row.source_kind])];
    existing.source_locations = [...new Set([...existing.source_locations, ...row.source_locations])];
    existing.support_tier = inferSupportTier(existing.source_kinds);
    if (row.expected_tools?.length) {
      existing.expected_tools = [...new Set([...existing.expected_tools, ...row.expected_tools])];
    }
  }

  return [...manifestMap.values()].sort((a, b) => {
    if (a.is_template !== b.is_template) return Number(a.is_template) - Number(b.is_template);
    return a.prompt_text.localeCompare(b.prompt_text);
  });
}

function inferSupportTier(sourceKinds) {
  if (sourceKinds.includes('docs_reference_change_intel')) {
    const nonSpeculative = sourceKinds.filter((kind) => kind !== 'docs_reference_change_intel');
    if (nonSpeculative.length === 0) {
      return 'speculative_reference';
    }
  }
  if (sourceKinds.includes('template_seed')) {
    return 'template_seed';
  }
  return 'production_backed';
}

function inferCostClass(family, supportTier) {
  if (supportTier === 'speculative_reference') return 'heavy';
  if (
    family.startsWith('change_') ||
    family.startsWith('news_') ||
    family === 'lookup_game' ||
    family === 'lookup_entity'
  ) {
    return 'heavy';
  }
  if (family === 'similarity' || family === 'concept_search' || family === 'trending' || family === 'tag_search') {
    return 'medium';
  }
  return 'light';
}

function inferExpectedTools(family, promptText) {
  switch (family) {
    case 'news_detail':
      return ['get_recent_news_detail'];
    case 'news_digest':
      return ['get_recent_news_digest'];
    case 'news_topic_search':
      return ['search_recent_news_topics'];
    case 'change_cross_game':
      return ['query_change_activity'];
    case 'change_single_game':
      return promptText.toLowerCase().includes('hades') || promptText.toLowerCase().includes('elden') || promptText.toLowerCase().includes('rest for the wicked')
        ? ['lookup_games', 'get_game_change_timeline']
        : ['get_game_change_timeline'];
    case 'change_before_after':
      return ['compare_change_before_after', 'get_game_change_timeline'];
    case 'change_pattern':
      return ['find_change_patterns'];
    case 'similarity':
      return ['find_similar'];
    case 'concept_search':
      return ['search_by_concept'];
    case 'trending':
      return ['discover_trending', 'screen_games'];
    case 'lookup_game':
      return ['lookup_games', 'query_analytics'];
    case 'lookup_tags':
      return ['lookup_tags'];
    case 'lookup_entity':
      return ['lookup_publishers', 'lookup_developers', 'query_analytics'];
    case 'tag_search':
      return ['search_games'];
    default:
      return ['query_analytics'];
  }
}

function inferFamily(promptText, isTemplate = false) {
  const text = promptText.toLowerCase();

  if (
    text.includes('latest steam news') ||
    text.includes('newest steam announcement') ||
    text.includes('newest steam post') ||
    text.includes("latest steam announcement") ||
    text.includes("'s latest steam news")
  ) {
    return 'news_detail';
  }

  if (
    text.includes('recent steam news updates') ||
    text.includes('summarize recent steam news') ||
    text.includes('recent steam news changes') ||
    text.includes('recent steam announcements') ||
    text.includes('most meaningful recent steam news across') ||
    text.includes('material recent steam news change')
  ) {
    return 'news_digest';
  }

  if (
    text.includes('developer diar') ||
    text.includes('dev diar') ||
    text.includes('behind-the-scenes updates') ||
    text.includes('behind the scenes updates') ||
    text.includes('roadmap in recent steam news') ||
    text.includes('roadmap recently on steam') ||
    text.includes("what's next in recent steam news") ||
    text.includes('what is next in recent steam news') ||
    text.includes('demo or playtest lately') ||
    text.includes('demo or playtest in recent steam news') ||
    text.includes('public playtest lately') ||
    text.includes('patch notes lately') ||
    text.includes('release notes recently') ||
    text.includes('official steam announcements only')
  ) {
    return 'news_topic_search';
  }

  if (
    text.includes('marketing push') ||
    text.includes('relaunch pattern') ||
    text.includes('teasing a big update') ||
    text.includes('major steam announcement') ||
    text.includes('agency prospects') ||
    text.includes('agency leads') ||
    text.includes('marketing-agency leads') ||
    text.includes('live-service or frequently updated') ||
    text.includes('update tease') ||
    text.includes('signable') ||
    text.includes('rescue candidate') ||
    text.includes('rescue candidates') ||
    text.includes('under-marketed') ||
    text.includes('under marketed') ||
    text.includes('sustained response')
  ) {
    return 'change_pattern';
  }

  if (text.includes('before and after')) {
    return 'change_before_after';
  }

  if (
    text.includes('steam store-page changes for ') ||
    text.includes('steam-page refresh for ') ||
    text.includes('recent steam changes for') ||
    text.includes('recent steam page changes for') ||
    text.startsWith('what changed on ')
  ) {
    return 'change_single_game';
  }

  if (
    text.includes('store-page changes') ||
    text.includes('steam page refreshes') ||
    text.includes('release timing') ||
    text.includes('changed tags or genres materially') ||
    text.includes('screenshots or trailers') ||
    text.includes('capsule art') ||
    text.includes('upcoming games changed')
  ) {
    return 'change_cross_game';
  }

  if (
    text.includes('similar to') ||
    text.includes('games like ') ||
    text.includes('alternatives to ') ||
    text.includes('publishers similar')
  ) {
    return 'similarity';
  }

  if (
    text.includes('breaking out') ||
    text.includes('most players right now') ||
    text.includes('gaining momentum') ||
    text.includes('review velocity and ccu') ||
    text.includes("what's breaking out") ||
    text.includes('gaining traction') ||
    text.includes('declining') ||
    text.includes('accelerating') ||
    text.includes('high velocity') ||
    text.includes('trending games this week')
  ) {
    return 'trending';
  }

  if (
    text.startsWith('tell me about ') ||
    text.includes("what's the review score for") ||
    text.includes('does ') ||
    text.includes('show me recent steam page changes for ')
  ) {
    return 'lookup_game';
  }

  if (text.includes('what tags exist')) {
    return 'lookup_tags';
  }

  if (
    text.includes('games by ') ||
    text.includes('all games by ') ||
    text.includes('published?') ||
    text.includes('publisher') ||
    text.includes('developers have')
  ) {
    if (text.includes('what publisher') || text.includes('publishers') || text.includes('published')) {
      return 'lookup_entity';
    }
  }

  if (
    text.includes('with deck building') ||
    text.includes('cozy farming') ||
    text.includes('investigation elements') ||
    text.includes('beautiful art') ||
    text.includes('deep lore') ||
    text.includes('tight controls') ||
    text.includes('feel like ')
  ) {
    return 'concept_search';
  }

  if (
    text.includes('steam deck') ||
    text.includes('workshop') ||
    text.includes('controller support') ||
    text.includes('linux') ||
    text.includes('vr') ||
    text.includes('roguelike') ||
    text.includes('metroidvania') ||
    text.includes('crpg') ||
    text.includes('tagged as')
  ) {
    return isTemplate ? 'tag_search' : 'tag_search';
  }

  return 'analytics';
}

async function extractExamplePrompts() {
  const text = await fs.readFile(SOURCE_FILES.examplePrompts, 'utf8');
  return extractArrayStrings(text, 'EXAMPLE_PROMPTS');
}

async function extractSmokePrompts() {
  const text = await fs.readFile(SOURCE_FILES.chatSmoke, 'utf8');
  const groupRegex = /tool:\s*'([^']+)'.*?queries:\s*\[(.*?)\]/gs;
  const rows = [];
  for (const match of text.matchAll(groupRegex)) {
    const tool = match[1];
    const prompts = extractStrings(match[2]);
    for (const prompt of prompts) {
      rows.push({ tool, prompt });
    }
  }
  return rows;
}

async function extractTemplateCatalog() {
  const text = await fs.readFile(SOURCE_FILES.queryTemplates, 'utf8');
  const rows = [];

  for (const template of extractArrayStrings(text, 'TAG_TEMPLATES')) {
    rows.push({
      template,
      source_kind: 'runtime_template_tag',
      seed: TAG_TEMPLATE_SEED,
      seeded_prompt: template.replaceAll('{input}', TAG_TEMPLATE_SEED),
    });
  }

  for (const template of extractArrayStrings(text, 'GAME_TEMPLATES')) {
    rows.push({
      template,
      source_kind: 'runtime_template_game',
      seed: GAME_TEMPLATE_SEED,
      seeded_prompt: template.replaceAll('{game}', GAME_TEMPLATE_SEED),
    });
  }

  for (const template of extractArrayStrings(text, 'ENTITY_TEMPLATES')) {
    const seed = template.toLowerCase().includes('published') ? PUBLISHER_TEMPLATE_SEED : DEVELOPER_TEMPLATE_SEED;
    rows.push({
      template,
      source_kind: 'runtime_template_entity',
      seed,
      seeded_prompt: template.replaceAll('{entity}', seed),
    });
  }

  for (const template of extractArrayStrings(text, 'DISCOVERY_TEMPLATES')) {
    rows.push({
      template,
      source_kind: 'runtime_template_discovery',
      seed: null,
      seeded_prompt: template,
    });
  }

  return rows;
}

async function extractFollowUpCatalog() {
  const text = await fs.readFile(SOURCE_FILES.suggestionGenerator, 'utf8');
  const rows = [];
  const queries = [...text.matchAll(/query:\s*`([^`]+)`|query:\s*'([^']+)'|query:\s*"([^"]+)"/g)];
  for (const match of queries) {
    const template = match[1] || match[2] || match[3];
    const seed =
      template.includes('${tag}')
        ? TAG_TEMPLATE_SEED
        : template.includes('${pub.name}')
          ? PUBLISHER_TEMPLATE_SEED
          : template.includes('${dev.name}') || template.includes('${results[0].developer}')
            ? DEVELOPER_TEMPLATE_SEED
            : template.includes('${game.name}')
              ? GAME_TEMPLATE_SEED
              : null;
    rows.push({
      template,
      source_kind: template.includes('${') ? 'runtime_followup_template' : 'runtime_followup_fixed',
      is_template: template.includes('${'),
      seed,
      seeded_prompt: seed ? seedFollowUpTemplate(template, seed) : template,
    });
  }

  const unique = new Map();
  for (const row of rows) {
    unique.set(row.template, row);
  }
  return [...unique.values()];
}

function seedFollowUpTemplate(template, seed) {
  return template
    .replaceAll('${game.name}', GAME_TEMPLATE_SEED)
    .replaceAll('${tag}', TAG_TEMPLATE_SEED)
    .replaceAll('${pub.name}', PUBLISHER_TEMPLATE_SEED)
    .replaceAll('${dev.name}', DEVELOPER_TEMPLATE_SEED)
    .replaceAll('${results[0].developer}', DEVELOPER_TEMPLATE_SEED);
}

async function extractGlobalSearchShells() {
  const text = await fs.readFile(SOURCE_FILES.globalSearch, 'utf8');
  const templates = [...text.matchAll(/router\.push\(`\/chat\?q=\$\{encodeURIComponent\(`([^`]+)`\)\}`\)/g)].map(
    (match) => match[1]
  );
  return templates.map((template) => ({
    template: template.replace('${query}', '{query}'),
    seed: template.includes('Tell me about') ? GLOBAL_SEARCH_GAME_SEED : GLOBAL_SEARCH_SIMILAR_SEED,
    seeded_prompt: template.replace('${query}', template.includes('Tell me about') ? GLOBAL_SEARCH_GAME_SEED : GLOBAL_SEARCH_SIMILAR_SEED),
  }));
}

async function extractChatInputShells() {
  const text = await fs.readFile(SOURCE_FILES.chatInput, 'utf8');
  const rows = [];
  if (text.includes('label: `${tag} games`')) {
    rows.push({
      template: '{tag} games',
      seed: TAG_TEMPLATE_SEED,
      seeded_prompt: `${TAG_TEMPLATE_SEED} games`,
    });
  }
  if (text.includes('label: `Games by ${dev.name}`')) {
    rows.push({
      template: 'games by {developer}',
      seed: DEVELOPER_TEMPLATE_SEED,
      seeded_prompt: `games by ${DEVELOPER_TEMPLATE_SEED}`,
    });
  }
  return rows;
}

async function extractChatInterfaceDocPrompts() {
  const text = await fs.readFile(SOURCE_FILES.chatInterfaceDoc, 'utf8');
  return [...text.matchAll(/- "([^"]+)"/g)].map((match) => match[1]);
}

async function extractChatQueryExamplesDocPrompts() {
  const text = await fs.readFile(SOURCE_FILES.chatQueryExamplesDoc, 'utf8');
  const prompts = [];

  const quickReferenceSection = text.match(/## Quick Reference([\s\S]*?)## Tool Selection Guide/);
  if (quickReferenceSection) {
    const lines = quickReferenceSection[1].split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
    for (const line of lines.slice(2)) {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const candidate = stripWrappingQuotes(cells[1]);
      if (isConcretePrompt(candidate)) {
        prompts.push(candidate);
      }
    }
  }

  const toolGuideSection = text.match(/## Tool Selection Guide([\s\S]*?)## 1\. Getting Started/);
  if (toolGuideSection) {
    for (const line of toolGuideSection[1].split(/\r?\n/)) {
      const match = line.match(/"([^"]+)"\s+→/);
      if (match && isConcretePrompt(match[1])) {
        prompts.push(match[1]);
      }
    }
  }

  for (const block of [...text.matchAll(/```(?:\w+)?\n([\s\S]*?)\n```/g)].map((match) => match[1])) {
    for (const rawLine of block.split(/\r?\n/)) {
      const candidate = cleanupDocPromptLine(rawLine);
      if (candidate && isConcretePrompt(candidate)) {
        prompts.push(candidate);
      }
    }
  }

  return [...new Set(prompts)];
}

function cleanupDocPromptLine(line) {
  let candidate = line.trim();
  if (!candidate) return null;
  if (candidate.startsWith('|') || candidate.startsWith('Want to...')) return null;
  if (candidate.includes('→')) {
    const quoted = candidate.match(/"([^"]+)"/);
    return quoted ? quoted[1] : null;
  }
  if (candidate.startsWith('Example:')) {
    candidate = candidate.replace(/^Example:\s*/, '');
  }
  if (candidate.includes('(') && candidate.includes(')') && candidate.startsWith('"')) {
    const quoted = candidate.match(/^"([^"]+)"/);
    candidate = quoted ? quoted[1] : candidate;
  }
  candidate = stripWrappingQuotes(candidate);
  if (!candidate) return null;
  return candidate;
}

function isConcretePrompt(candidate) {
  return Boolean(
    candidate &&
      !candidate.includes('[TAG]') &&
      !candidate.includes('[GAME]') &&
      !candidate.includes('[PRICE]') &&
      !candidate.includes('[PLATFORM]') &&
      !candidate.includes('[QUALITY]') &&
      !candidate.includes('[TIME]') &&
      !candidate.includes('[DESCRIPTION]') &&
      !candidate.includes('Use this tool') &&
      !candidate.includes('Returns ') &&
      !candidate.includes('Finds ')
  );
}

async function extractChangeReferencePrompts() {
  const text = await fs.readFile(SOURCE_FILES.changeReferenceDoc, 'utf8');
  return [...text.matchAll(/^\d+\.\s+"(.+)"$/gm)].map((match) => match[1]);
}

function extractArrayStrings(text, exportName) {
  const match = text.match(new RegExp(`export const ${exportName} = \\[(.*?)\\];`, 's'));
  if (!match) return [];
  return extractStrings(match[1]);
}

function extractStrings(text) {
  return [...text.matchAll(/'([^']+)'|"([^"]+)"/g)].map((match) => match[1] || match[2]);
}

function normalizePrompt(promptText) {
  return sanitizePrompt(promptText)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizePrompt(promptText) {
  return promptText.replace(/\r/g, '').trim();
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath);
}

async function evaluatePrompt(promptRow, auth) {
  let attempts = 0;
  while (true) {
    const result = await evaluatePromptOnce(promptRow, auth);
    const attemptCount = attempts + 1;
    if (attempts >= MAX_RETRIES || !isRetryableResult(result)) {
      return {
        ...result,
        attempts: attemptCount,
      };
    }

    attempts += 1;
    console.log(
      `  -> retrying "${promptRow.prompt_text}" after retryable error (${attempts}/${MAX_RETRIES})`
    );
    await sleep(RETRY_DELAY_MS);
  }
}

async function evaluatePromptOnce(promptRow, auth) {
  return evaluateChatRequest(
    {
      messages: [{ role: 'user', content: promptRow.prompt_text }],
    },
    auth
  );
}

async function evaluateScenario(scenario, auth) {
  return evaluateChatScenario({
    auth,
    delayMs: REQUEST_DELAY_MS,
    origin: PROD_ORIGIN,
    scenario,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

async function evaluateChatRequest(requestBody, auth) {
  return evaluateEndpointChatRequest({
    auth,
    origin: PROD_ORIGIN,
    requestBody,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

function parseSse(rawSse) {
  return parseEvalSse(rawSse);
}

function summarizeScenarioSessionContext(sessionContext) {
  return summarizeScenarioContext(sessionContext);
}

function summarizeTigerShadow(tigerShadow) {
  if (!tigerShadow || typeof tigerShadow !== 'object') {
    return '-';
  }

  const attempts = Array.isArray(tigerShadow.attempts)
    ? tigerShadow.attempts
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
    tigerShadow.route || 'unknown',
    tigerShadow.matchedIntent ? `intent=${tigerShadow.matchedIntent}` : null,
    attempts ? `attempts=${attempts}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function summarizeTigerPrimary(tigerPrimary) {
  if (!tigerPrimary || typeof tigerPrimary !== 'object') {
    return '-';
  }

  const attempts = Array.isArray(tigerPrimary.attempts)
    ? tigerPrimary.attempts
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
    tigerPrimary.route || 'unknown',
    tigerPrimary.matchedIntent ? `intent=${tigerPrimary.matchedIntent}` : null,
    tigerPrimary.renderMode ? `render=${tigerPrimary.renderMode}` : null,
    attempts ? `attempts=${attempts}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function buildTigerShadowCoverageRows(results) {
  const coverage = new Map();

  for (const row of results) {
    const tigerShadow = row?.tigerShadow;
    if (!tigerShadow || typeof tigerShadow !== 'object') {
      continue;
    }

    const intent = tigerShadow.matchedIntent || 'unmatched';
    const current = coverage.get(intent) || {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      contracts: new Set(),
    };

    current.total += 1;
    if (tigerShadow.route === 'shadow_success_legacy_answer') {
      current.success += 1;
    } else if (tigerShadow.route === 'skipped') {
      current.skipped += 1;
    } else if (tigerShadow.route === 'shadow_failed_legacy_answer') {
      current.failed += 1;
    }

    if (Array.isArray(tigerShadow.attempts)) {
      for (const attempt of tigerShadow.attempts) {
        if (attempt?.contractName) {
          current.contracts.add(attempt.contractName);
        }
      }
    }

    coverage.set(intent, current);
  }

  return [...coverage.entries()]
    .map(([intent, stats]) => ({
      intent,
      total: stats.total,
      success: stats.success,
      failed: stats.failed,
      skipped: stats.skipped,
      contracts: [...stats.contracts].sort(),
    }))
    .sort((left, right) => right.total - left.total || String(left.intent).localeCompare(String(right.intent)));
}

function buildTigerPrimaryCoverageRows(results) {
  const coverage = new Map();

  for (const row of results) {
    const tigerPrimary = row?.tigerPrimary;
    if (!tigerPrimary || typeof tigerPrimary !== 'object') {
      continue;
    }

    const intent = tigerPrimary.matchedIntent || 'unmatched';
    const current = coverage.get(intent) || {
      total: 0,
      success: 0,
      fallback: 0,
      error: 0,
      contracts: new Set(),
    };

    current.total += 1;
    if (tigerPrimary.route === 'primary_success') {
      current.success += 1;
    } else if (tigerPrimary.route === 'fallback_to_legacy') {
      current.fallback += 1;
    } else if (tigerPrimary.route === 'error') {
      current.error += 1;
    }

    if (Array.isArray(tigerPrimary.attempts)) {
      for (const attempt of tigerPrimary.attempts) {
        current.contracts.add(attempt.contractName);
      }
    }

    coverage.set(intent, current);
  }

  return [...coverage.entries()]
    .map(([intent, data]) => ({
      intent,
      total: data.total,
      success: data.success,
      fallback: data.fallback,
      error: data.error,
      contracts: [...data.contracts].sort(),
    }))
    .sort((left, right) => left.intent.localeCompare(right.intent));
}

function sanitizeToolResultPayload(toolName, result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  switch (toolName) {
    case 'get_recent_news_detail':
      return {
        app: sanitizeResolvedApp(result.app),
        detail_mode: typeof result.detail_mode === 'string' ? result.detail_mode : null,
        latestItem: sanitizeNewsItem(result.latestItem),
        items: sanitizeNewsItems(result.items, 3),
        meta: sanitizeNewsMeta(result.meta),
      };
    case 'get_recent_news_digest':
      return {
        app: sanitizeResolvedApp(result.app),
        apps: sanitizeResolvedApps(result.apps, 3),
        scope: typeof result.scope === 'string' ? result.scope : null,
        items: sanitizeNewsItems(result.items, 6),
        meta: sanitizeNewsMeta(result.meta),
      };
    case 'search_recent_news_topics':
      return {
        items: sanitizeTopicItems(result.items, 8),
        meta: sanitizeTopicMeta(result.meta),
      };
    case 'get_game_change_timeline':
    case 'compare_change_before_after':
      return {
        app: sanitizeResolvedApp(result.app),
      };
    case 'query_change_activity':
      return {
        results: sanitizeActivityResults(result.results, 3),
      };
    default:
      return null;
  }
}

function sanitizeResolvedApp(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    appid: Number.isInteger(value.appid) ? value.appid : null,
    name: typeof value.name === 'string' ? value.name : null,
  };
}

function sanitizeResolvedApps(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(sanitizeResolvedApp)
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsItems(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(sanitizeNewsItem)
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsItem(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    appid: Number.isInteger(value.appid) ? value.appid : null,
    appName:
      typeof value.appName === 'string'
        ? value.appName
        : typeof value.name === 'string'
          ? value.name
          : null,
    title: typeof value.title === 'string' ? truncate(value.title, 180) : null,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    firstSeenAt: typeof value.firstSeenAt === 'string' ? value.firstSeenAt : null,
    excerpt: typeof value.excerpt === 'string' ? truncate(value.excerpt, 260) : null,
    bodyPreview: typeof value.bodyPreview === 'string' ? truncate(value.bodyPreview, 260) : null,
  };
}

function sanitizeTopicItems(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const newsItem = sanitizeNewsItem(item);
      if (!newsItem) {
        return null;
      }

      return {
        ...newsItem,
        matchReason: typeof item.matchReason === 'string' ? truncate(item.matchReason, 200) : null,
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsMeta(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    days: typeof value.days === 'number' ? value.days : null,
    limit: typeof value.limit === 'number' ? value.limit : null,
    detailMode: typeof value.detailMode === 'string' ? value.detailMode : null,
  };
}

function sanitizeTopicMeta(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    days: typeof value.days === 'number' ? value.days : null,
    limit: typeof value.limit === 'number' ? value.limit : null,
    query: typeof value.query === 'string' ? value.query : null,
    feedScope: typeof value.feedScope === 'string' ? value.feedScope : null,
  };
}

function sanitizeActivityResults(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      return {
        appid: Number.isInteger(item.appid) ? item.appid : null,
        name: typeof item.name === 'string' ? item.name : null,
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.success === false) {
    const failureKind =
      typeof result.failure_kind === 'string' ? result.failure_kind : null;
    const errorMessage =
      typeof result.error === 'string'
        ? truncate(result.error.replace(/\s+/g, ' ').trim(), 180)
        : null;
    if (failureKind && errorMessage) return `${failureKind}: ${errorMessage}`;
    if (errorMessage) return errorMessage;
    if (failureKind) return failureKind;
    return 'tool failed';
  }
  if (typeof result.total_found === 'number') return `${result.total_found} results`;
  if (typeof result.rowCount === 'number') return `${result.rowCount} rows`;
  if (Array.isArray(result.results)) return `${result.results.length} results`;
  if (Array.isArray(result.events)) return `${result.events.length} events`;
  if (Array.isArray(result.diffs)) return `${result.diffs.length} diffs`;
  return null;
}

function summarizeToolExecution(promptRow, result) {
  const toolCalls = Array.isArray(result.tool_calls) ? result.tool_calls : [];
  const expectedTools = Array.isArray(promptRow.expected_tools) ? promptRow.expected_tools : [];
  const matchedExpectedTools = expectedTools.filter((toolName) =>
    toolCalls.some((tool) => tool.name === toolName)
  );
  const successfulExpectedTools = matchedExpectedTools.filter((toolName) =>
    toolCalls.some((tool) => tool.name === toolName && tool.success !== false)
  );
  const failedExpectedTools = matchedExpectedTools.filter(
    (toolName) =>
      toolCalls.some((tool) => tool.name === toolName && tool.success === false) &&
      !toolCalls.some((tool) => tool.name === toolName && tool.success !== false)
  );
  const toolFailureKinds = [
    ...new Set(
      toolCalls
        .filter((tool) => tool.success === false)
        .map((tool) => tool.failure_kind || 'tool_failure')
    ),
  ];

  return {
    primary_tool_succeeded:
      expectedTools.length > 0 ? successfulExpectedTools.length > 0 : null,
    matched_expected_tool_count: matchedExpectedTools.length,
    successful_expected_tool_count: successfulExpectedTools.length,
    failed_expected_tool_count: failedExpectedTools.length,
    tool_failure_count: toolCalls.filter((tool) => tool.success === false).length,
    tool_failure_kinds: toolFailureKinds,
  };
}

function finalizeResult(promptRow, result) {
  return {
    ...promptRow,
    environment: PROD_ORIGIN,
    run_started_at: new Date().toISOString(),
    ...result,
    ...summarizeToolExecution(promptRow, result),
  };
}

function build429RetryTargets(results, manifest) {
  const orderMap = new Map(RETRY_429_PROMPT_ORDER.map((prompt, index) => [normalizePrompt(prompt), index]));
  return results
    .filter((row) => isOpenAi429ErrorRow(row))
    .map((row) => ({
      row,
      promptRow: findManifestRowForResult(row, manifest) || row,
    }))
    .sort((a, b) => {
      const aOrder = orderMap.get(a.row.normalized_text) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = orderMap.get(b.row.normalized_text) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.row.prompt_text.localeCompare(b.row.prompt_text);
    });
}

function findManifestRowForResult(resultRow, manifest) {
  return (
    manifest.find((row) => row.prompt_id === resultRow.prompt_id) ||
    manifest.find((row) => row.normalized_text === resultRow.normalized_text) ||
    null
  );
}

function buildRetryMergedRow({
  promptRow,
  attemptResult,
  originalResult,
  retryHistory,
  retryStatus,
  attempts,
}) {
  return {
    ...finalizeResult(promptRow, attemptResult),
    original_result: sanitizeResultForArchive(originalResult),
    retry_history: retryHistory,
    retry_status: retryStatus,
    retry_targeted: true,
    attempts,
  };
}

function buildRetryHistoryEntry({ attemptNumber, totalAttempts, result }) {
  return {
    attemptNumber,
    totalAttempts,
    recordedAt: new Date().toISOString(),
    status: result.status,
    http_status: result.http_status,
    error_message: summarizeError(result.error_message),
    totalMs: result.timing?.totalMs ?? null,
    tool_calls: result.tool_calls.map((tool) => tool.name),
  };
}

function replaceResultRow(results, updatedRow) {
  const idx = results.findIndex(
    (row) =>
      row.prompt_id === updatedRow.prompt_id ||
      row.normalized_text === updatedRow.normalized_text ||
      normalizePrompt(row.prompt_text) === normalizePrompt(updatedRow.prompt_text)
  );
  if (idx === -1) {
    results.push(updatedRow);
    return;
  }
  results[idx] = updatedRow;
}

function sanitizeResultForArchive(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }
  const copy = JSON.parse(JSON.stringify(row));
  delete copy.original_result;
  delete copy.retry_history;
  return copy;
}

function isOpenAi429ErrorRow(row) {
  return row?.status === 'error' && isOpenAi429ErrorMessage(row.error_message, row.http_status);
}

function isOpenAi429Result(result) {
  return result?.status === 'error' && isOpenAi429ErrorMessage(result.error_message, result.http_status);
}

function isOpenAi429ErrorMessage(errorMessage, httpStatus) {
  const message = String(errorMessage || '').toLowerCase();
  return httpStatus === 429 || message.includes('openai api error: 429') || message.includes('rate limit reached');
}

function parseRetryAfterMs(errorMessage) {
  const match = String(errorMessage || '').match(/please try again in ([\d.]+)s/i);
  if (!match) {
    return 0;
  }
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.ceil(seconds * 1000);
}

function summarizeError(errorMessage) {
  return truncate(String(errorMessage || '').replace(/\s+/g, ' ').trim(), 240);
}

function classifyFailure({ httpStatus, errorMessage, transportOk, messageEndReceived }) {
  if (!errorMessage) {
    return null;
  }

  const message = String(errorMessage || '').toLowerCase();

  if (message.includes('statement timeout')) {
    return 'db_statement_timeout';
  }
  if (isOpenAi429ErrorMessage(errorMessage, httpStatus)) {
    return 'openai_429';
  }
  if (message.includes('missing message_end')) {
    return 'missing_message_end';
  }
  if (!transportOk && httpStatus) {
    return 'http_error';
  }
  if (!transportOk && (message.includes('timed out') || message.includes('timeout'))) {
    return 'request_timeout';
  }
  if (!transportOk) {
    return 'network_error';
  }
  if (transportOk && !messageEndReceived) {
    return 'missing_message_end';
  }
  return 'sse_error';
}

function build429Assessment(result, retryStatus) {
  if (retryStatus === 'resolved') {
    return 'Resolved on isolated single-thread retry; prior failure was consistent with transient org TPM saturation during the broader batch run.';
  }

  if (retryStatus === 'resolved_non_429') {
    return `The OpenAI 429 cleared on isolated retry; the prompt now fails for another reason: ${summarizeError(result.error_message)}.`;
  }

  const prompt = result.prompt_text;
  const actualTools = result.tool_calls.map((tool) => tool.name);
  const expectedTools = Array.isArray(result.expected_tools) ? result.expected_tools : [];
  const matchedExpectedTools = expectedTools.filter((tool) => actualTools.includes(tool));

  if (prompt === 'Show me high velocity games') {
    return 'Persistent OpenAI 429. This prompt appears prompt-specific: it should route to discover_trending, but the observed analytics-plus-lookup loop creates unusually large tool fan-out and synthesis context.';
  }

  if (
    prompt === 'Steam Deck games similar to Hades II' ||
    prompt === 'Steam Deck verified games similar to Celeste' ||
    prompt === 'Steam Deck games similar to Hades with better reviews'
  ) {
    return 'Persistent OpenAI 429. This prompt likely amplifies tokens through similarity plus platform/filter composition, which expands tool fan-out and increases synthesis context.';
  }

  if (prompt === 'Publishers with the most games released in the past 6 months') {
    return 'Persistent OpenAI 429. This looks prompt-specific: the publisher-ranking request is decomposing into repeated analytics work, producing more intermediate context than the prompt should require.';
  }

  if (actualTools.length <= 2 && matchedExpectedTools.length > 0) {
    return 'Persistent OpenAI 429, but the routing looks normal and low-fan-out. This most likely reflects ambient org TPM saturation or an oversized final answer rather than a prompt-specific orchestration issue.';
  }

  if (actualTools.length > 3 || actualTools.length > expectedTools.length + 2) {
    return 'Persistent OpenAI 429. The prompt appears to trigger prompt-specific tool fan-out or routing expansion, which likely increases token pressure before the final answer is produced.';
  }

  return 'Persistent OpenAI 429. The most likely cause is ambient org TPM saturation, with some additional context growth during synthesis.';
}

function shouldRerunCheckpointRow(row) {
  if (row?.primary_tool_succeeded === false) {
    return true;
  }
  return row?.status === 'error' && isRetryableErrorMessage(row.error_message, row.http_status);
}

function isRetryableResult(result) {
  return result?.status === 'error' && isRetryableErrorMessage(result.error_message, result.http_status);
}

function isRetryableErrorMessage(errorMessage, httpStatus) {
  const message = String(errorMessage || '').toLowerCase();
  if (message.includes('statement timeout')) {
    return false;
  }
  return (
    httpStatus === 429 ||
    httpStatus === 408 ||
    message.includes('rate limit reached') ||
    message.includes('openai api error: 429') ||
    message.includes('too many requests') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('socket hang up')
  );
}

function scoreResult(result) {
  let score = 0;
  const notes = [];
  const issue_tags = [];
  const runtimeFailure = result.status === 'error';
  const primaryToolFailure = result.primary_tool_succeeded === false;

  if (!runtimeFailure && !primaryToolFailure) {
    score += 3;
  } else {
    if (runtimeFailure) {
      issue_tags.push('error');
      issue_tags.push(result.failure_kind || 'runtime_failure');
      notes.push(
        `Runtime failure (${result.failure_kind || 'unknown'}): ${truncate(result.error_message || 'Unknown error', 180)}`
      );
    }
    if (primaryToolFailure) {
      issue_tags.push('tool_failure');
      issue_tags.push(...(result.tool_failure_kinds || []));
      notes.push(
        `Primary expected tool failed (${(result.tool_failure_kinds || ['unknown']).join(', ')}). ${
          result.status === 'success'
            ? 'The chat stream still completed, but only with fallback prose.'
            : 'The request did not complete cleanly.'
        }`
      );
    }
  }

  if (runtimeFailure || primaryToolFailure) {
    return {
      ...result,
      score: 0,
      issue_tags,
      notes,
      verdict: verdictFromScore(0, 'error'),
    };
  }

  if (result.assistant_output_raw.length >= 80) {
    score += 1;
  } else if (result.status === 'success') {
    issue_tags.push('thin_output');
    notes.push('Output is brief and may be incomplete.');
  }

  if (result.tool_calls.length > 0) {
    score += 1;
  } else {
    issue_tags.push('no_tools');
    notes.push('No tool calls were captured.');
  }

  const actualTools = result.tool_calls.map((tool) => tool.name);
  const matchedExpectedTools = result.expected_tools.filter((tool) => actualTools.includes(tool));
  if (matchedExpectedTools.length > 0) {
    score += 2;
  } else if (result.expected_tools.length > 0 && result.status === 'success') {
    issue_tags.push('tool_mismatch');
    notes.push(`Expected ${result.expected_tools.join(', ')}, got ${actualTools.join(', ') || 'none'}.`);
  }

  if (result.tool_failure_count > 0) {
    issue_tags.push('non_primary_tool_failure');
    notes.push(
      `A non-primary tool failed (${(result.tool_failure_kinds || ['unknown']).join(', ')}), but an expected tool still completed.`
    );
  }

  if (hasMarkdownEntityLinks(result.assistant_output_raw)) {
    score += 1;
  } else if (result.status === 'success') {
    issue_tags.push('missing_links');
    notes.push('Output does not include obvious markdown entity links.');
  }

  if (hasRelativeDatePrompt(result.prompt_text)) {
    if (hasAbsoluteDate(result.assistant_output_raw)) {
      score += 1;
    } else {
      issue_tags.push('relative_date_not_normalized');
      notes.push('Relative-date prompt did not obviously normalize to exact dates.');
    }
  } else {
    score += 1;
  }

  if (result.timing?.totalMs && result.timing.totalMs <= 3000) {
    score += 1;
  } else if (result.timing?.totalMs && result.timing.totalMs > 8000) {
    issue_tags.push('slow');
    notes.push(`Slow response: ${result.timing.totalMs}ms total.`);
  }

  score = Math.max(0, Math.min(10, score));

  if (result.support_tier === 'speculative_reference') {
    notes.push('Speculative reference prompt; validate the answer against current tool coverage.');
  }

  if (result.retry_targeted) {
    notes.push(`429 retry status: ${result.retry_status || 'in_progress'}.`);
    notes.push(`Total attempts across baseline and retry pass: ${result.attempts ?? '-'}.`);
    if (result.assessment) {
      notes.push(`429 assessment: ${result.assessment}`);
    }
  }

  if (!notes.length) {
    notes.push('Response completed without obvious transport, timing, or routing issues.');
  }

  return {
    ...result,
    score,
    issue_tags,
    notes,
    verdict: verdictFromScore(score, result.status),
  };
}

function hasMarkdownEntityLinks(text) {
  return /\[[^\]]+\]\((game:\d+|\/publishers\/\d+|\/developers\/\d+)\)/.test(text);
}

function hasRelativeDatePrompt(text) {
  return /\b(today|yesterday|tomorrow|this month|this week|last 30 days|recent|recently|right now)\b/i.test(text);
}

function hasAbsoluteDate(text) {
  return /\b\d{4}-\d{2}-\d{2}\b/.test(text) || /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/.test(text);
}

function verdictFromScore(score, status) {
  if (status !== 'success') return 'Failure';
  if (score >= 8) return 'Strong';
  if (score >= 6) return 'Acceptable';
  if (score >= 4) return 'Weak';
  return 'Poor';
}

function compareResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aTime = a.timing?.totalMs ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.timing?.totalMs ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return a.tool_calls.length - b.tool_calls.length;
}

async function runPool(items, concurrency, worker, delayMs = 0) {
  const results = new Array(items.length);
  let index = 0;
  let nextStartAt = 0;

  async function throttleStart() {
    if (delayMs <= 0) return;
    const now = Date.now();
    const waitMs = Math.max(0, nextStartAt - now);
    nextStartAt = Math.max(now, nextStartAt) + delayMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  async function runner() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await throttleStart();
      results[current] = await worker(items[current], current, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runner()));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCheckpointWriter({ manifest, executableManifest, metadata }) {
  let pendingWrite = Promise.resolve();
  return async function checkpoint(results) {
    pendingWrite = pendingWrite.then(async () => {
      const scored = results.map(scoreResult).sort(compareResults);
      if (!metadata.manualProgress) {
        metadata.completedPrompts = results.length;
      }
      metadata.lastUpdatedAt = new Date().toISOString();
      const markdown = renderMarkdown({
        manifest,
        executableManifest,
        results: scored,
        metadata,
      });

      await writeAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      await writeAtomic(RESULTS_PATH, JSON.stringify(scored, null, 2));
      await writeAtomic(DOC_PATH, markdown);
      console.log(
        `  -> checkpointed ${metadata.completedPrompts}/${metadata.totalExecutablePrompts} prompts to ${DOC_PATH}`
      );
    });
    return pendingWrite;
  };
}

async function writeAtomic(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, contents);
  await fs.rename(tempPath, filePath);
}

function renderMarkdown({ manifest, executableManifest, results, metadata }) {
  const runtimeRows = manifest.filter((row) => row.source_kinds.some((kind) => kind.startsWith('runtime')));
  const templateRows = manifest.filter((row) => row.is_template);
  const speculativeRows = manifest.filter((row) => row.support_tier === 'speculative_reference');
  const openAi429Rows = results.filter((row) => isOpenAi429ErrorRow(row));
  const runtimeFailures = results.filter((row) => row.status === 'error');
  const toolFailures = results.filter((row) => row.primary_tool_succeeded === false);
  const runtimeFailureCounts = Array.from(
    runtimeFailures.reduce((map, row) => {
      const key = row.failure_kind || 'unknown';
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map())
  ).sort((left, right) => right[1] - left[1]);
  const toolFailureCounts = Array.from(
    toolFailures.reduce((map, row) => {
      const kinds =
        Array.isArray(row.tool_failure_kinds) && row.tool_failure_kinds.length > 0
          ? row.tool_failure_kinds
          : ['unknown'];
      for (const kind of kinds) {
        map.set(kind, (map.get(kind) || 0) + 1);
      }
      return map;
    }, new Map())
  ).sort((left, right) => right[1] - left[1]);

  const lines = [];
  lines.push('# /chat Prompt Evaluations');
  lines.push('');
  lines.push('## Run Metadata');
  lines.push('');
  lines.push(`- Generated: ${metadata.generatedAt}`);
  lines.push(`- Environment: ${metadata.origin}`);
  lines.push(`- Auth account: ${metadata.authEmail}`);
  lines.push(`- Auth mode: ${metadata.authMode || 'magiclink'}`);
  lines.push(
    metadata.authMode === 'eval_bypass'
      ? '- Execution mode: local eval-bypass run against the same `/api/chat/stream` endpoint used by the browser UI'
      : '- Execution mode: authenticated production chat API run against the same `/api/chat/stream` endpoint used by the browser UI'
  );
  lines.push(`- Run mode: ${metadata.mode || 'full'}`);
  lines.push(`- Run status: ${metadata.runStatus}`);
  lines.push(`- Progress: ${metadata.completedPrompts}/${metadata.totalExecutablePrompts}`);
  lines.push(`- Last checkpoint: ${metadata.lastUpdatedAt}`);
  lines.push(`- Concurrency: ${metadata.concurrency}`);
  lines.push(`- Delay between request starts: ${metadata.requestDelayMs}ms`);
  if (metadata.maxPrompts > 0) {
    lines.push(`- Prompt cap: ${metadata.maxPrompts}`);
  }
  if (metadata.includePromptsFile) {
    lines.push(`- Prompt include file: ${metadata.includePromptsFile}`);
    lines.push(`- Included prompt count: ${metadata.includePromptsCount}`);
  }
  lines.push(`- Executable prompts tested: ${results.length}`);
  lines.push(`- Full manifest rows: ${manifest.length}`);
  lines.push(`- Runtime-backed manifest rows: ${runtimeRows.length}`);
  lines.push(`- Template catalog rows: ${templateRows.length}`);
  lines.push(`- Speculative reference rows: ${speculativeRows.length}`);
  lines.push(`- Current OpenAI 429 rows: ${openAi429Rows.length}`);
  lines.push(`- Runtime failure rows: ${runtimeFailures.length}`);
  lines.push(`- Primary expected tool failure rows: ${toolFailures.length}`);
  if (metadata.mode === 'retry_429_only') {
    lines.push(`- Retry baseline: ${metadata.baselineOutDir}`);
    lines.push(`- Retry filter: ${metadata.retryFilter}`);
    lines.push(`- Retry targets: ${metadata.retryTargetsCompleted}/${metadata.retryTargetsTotal}`);
    lines.push(`- Retry initial cooldown: ${metadata.retryInitialCooldownMs}ms`);
    lines.push(`- Retry attempt limit: ${metadata.retryAttemptLimit}`);
  }
  lines.push(`- Raw artifacts: ${metadata.outDir}`);
  lines.push(`- Rendered doc path: ${metadata.docPath}`);
  lines.push('');
  lines.push('## Prompt Inventory');
  lines.push('');
  lines.push('| Bucket | Count | Notes |');
  lines.push('|---|---:|---|');
  lines.push(`| Runtime-backed rows | ${runtimeRows.length} | Fixed prompts, shells, and live registry-backed shapes from the app code |`);
  lines.push(`| Executable rows | ${executableManifest.length} | Concrete prompts actually run in this pass |`);
  lines.push(`| Template rows | ${templateRows.length} | Cataloged separately from seeded concrete prompts |`);
  lines.push(`| Speculative reference rows | ${speculativeRows.length} | Prompt shapes from the change-intelligence research doc |`);
  lines.push('');
  if (runtimeFailureCounts.length > 0) {
    lines.push('## Runtime Failures');
    lines.push('');
    lines.push('| Failure Kind | Count |');
    lines.push('|---|---:|');
    for (const [failureKind, count] of runtimeFailureCounts) {
      lines.push(`| ${escapeTable(failureKind)} | ${count} |`);
    }
    lines.push('');
  }
  if (toolFailureCounts.length > 0) {
    lines.push('## Tool Failures');
    lines.push('');
    lines.push('| Failure Kind | Count |');
    lines.push('|---|---:|');
    for (const [failureKind, count] of toolFailureCounts) {
      lines.push(`| ${escapeTable(failureKind)} | ${count} |`);
    }
    lines.push('');
  }
  const tigerShadowCoverageRows = buildTigerShadowCoverageRows(results);
  if (tigerShadowCoverageRows.length > 0) {
    lines.push('## Tiger Shadow Coverage');
    lines.push('');
    lines.push('| Intent | Prompts | Success | Failed | Skipped | Contracts |');
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const row of tigerShadowCoverageRows) {
      lines.push(
        `| ${escapeTable(row.intent)} | ${row.total} | ${row.success} | ${row.failed} | ${row.skipped} | ${escapeTable(row.contracts.join(', ') || '-')} |`
      );
    }
    lines.push('');
  }
  const tigerPrimaryCoverageRows = buildTigerPrimaryCoverageRows(results);
  if (tigerPrimaryCoverageRows.length > 0) {
    lines.push('## Tiger Primary Coverage');
    lines.push('');
    lines.push('| Intent | Prompts | Primary Success | Fallback | Error | Contracts |');
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const row of tigerPrimaryCoverageRows) {
      lines.push(
        `| ${escapeTable(row.intent)} | ${row.total} | ${row.success} | ${row.fallback} | ${row.error} | ${escapeTable(row.contracts.join(', ') || '-')} |`
      );
    }
    lines.push('');
  }
  lines.push('<details>');
  lines.push('<summary>Runtime Template Catalog</summary>');
  lines.push('');
  for (const row of templateRows) {
    lines.push(`- \`${escapeInlineCode(row.prompt_text)}\``);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('## Ranking');
  lines.push('');
  lines.push('| Rank | Score | Prompt | Family | Tier | Total Time | Tools | Verdict |');
  lines.push('|---:|---:|---|---|---|---:|---|---|');
  results.forEach((row, idx) => {
    lines.push(
      `| ${idx + 1} | ${row.score}/10 | ${escapeTable(row.prompt_text)} | ${row.family} | ${row.support_tier} | ${row.timing?.totalMs ?? '-'} | ${escapeTable(row.tool_calls.map((tool) => tool.name).join(', ') || '-')} | ${row.verdict} |`
    );
  });
  lines.push('');
  lines.push('## Detailed Results');
  lines.push('');

  results.forEach((row, idx) => {
    lines.push(`### ${idx + 1}. ${row.prompt_text}`);
    lines.push('');
    lines.push(`- Score: ${row.score}/10`);
    lines.push(`- Verdict: ${row.verdict}`);
    lines.push(`- Family: ${row.family}`);
    lines.push(`- Support tier: ${row.support_tier}`);
    lines.push(`- Failure kind: ${row.failure_kind || '-'}`);
    lines.push(`- Transport OK: ${row.transport_ok === true ? 'yes' : row.transport_ok === false ? 'no' : '-'}`);
    lines.push(`- message_end received: ${row.message_end_received === true ? 'yes' : row.message_end_received === false ? 'no' : '-'}`);
    lines.push(`- Primary expected tool succeeded: ${row.primary_tool_succeeded === true ? 'yes' : row.primary_tool_succeeded === false ? 'no' : '-'}`);
    lines.push(`- Tool failure count: ${row.tool_failure_count ?? 0}`);
    lines.push(`- Tool failure kinds: ${(row.tool_failure_kinds || []).join(', ') || '-'}`);
    lines.push(`- Sources: ${row.source_locations.join(', ')}`);
    lines.push(`- Expected tools: ${row.expected_tools.join(', ') || '-'}`);
    lines.push(`- Actual tools: ${row.tool_calls.map((tool) => tool.name).join(', ') || '-'}`);
    lines.push(`- Tiger primary: ${summarizeTigerPrimary(row.tigerPrimary)}`);
    lines.push(`- Tiger shadow: ${summarizeTigerShadow(row.tigerShadow)}`);
    lines.push(
      `- Timing: total ${row.timing?.totalMs ?? '-'}ms | llm ${row.timing?.llmMs ?? '-'}ms | tools ${row.timing?.toolsMs ?? '-'}ms | iterations ${row.iterations ?? '-'}`
    );
    if (row.retry_targeted) {
      lines.push(`- Retry status: ${row.retry_status || 'in_progress'}`);
      lines.push(`- Total attempts: ${row.attempts ?? '-'}`);
      if (row.assessment) {
        lines.push(`- 429 assessment: ${row.assessment}`);
      }
    }
    lines.push(`- Comments: ${row.notes.join(' ')}`);
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Exact Output</summary>');
    lines.push('');
    lines.push('```md');
    lines.push(row.assistant_output_raw || '[no assistant output captured]');
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Tool Calls</summary>');
    lines.push('');
    lines.push('```json');
    lines.push(
      JSON.stringify(
        row.tool_calls.map((tool) => ({
          name: tool.name,
          executionMs: tool.executionMs,
          success: tool.success,
          unavailable: tool.unavailable,
          failure_kind: tool.failure_kind,
          error_message: tool.error_message,
          result_summary: tool.result_summary,
          result_payload: tool.result_payload || null,
        })),
        null,
        2
      )
    );
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
    if (row.tigerPrimary) {
      lines.push('<details>');
      lines.push('<summary>Tiger Primary</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(row.tigerPrimary, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (row.tigerShadow) {
      lines.push('<details>');
      lines.push('<summary>Tiger Shadow</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(row.tigerShadow, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (row.retry_targeted) {
      lines.push('<details>');
      lines.push('<summary>429 Retry History</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(row.retry_history || [], null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  });

  return `${lines.join('\n')}\n`;
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|');
}

function escapeInlineCode(value) {
  return String(value).replace(/`/g, '\\`');
}

function truncate(value, max) {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
