#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const DEFAULT_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'https://www.publisheriq.app';
const DEFAULT_OUT_DIR_BASE = path.join('/tmp', 'publisheriq-chat-evals');
const GENERIC_RUNNER_PATH = path.join(ROOT, 'scripts/chat-evals', 'run.mjs');

export const SUITE_ROWS = [
  {
    critiqueId: 158,
    section: '5. Trending and Time-Relative Answers',
    family: 'trend_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'What free-to-play games have the most players right now?',
  },
  {
    critiqueId: 181,
    section: '5. Trending and Time-Relative Answers',
    family: 'trend_screen',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'What horror games are gaining momentum?',
  },
  {
    critiqueId: 102,
    section: '5. Trending and Time-Relative Answers',
    family: 'trend_comparison',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'Compare top 5 roguelites by review velocity and CCU',
  },
  {
    critiqueId: 244,
    section: '5. Trending and Time-Relative Answers',
    family: 'trend_screen',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Breaking out indie games this month',
  },
  {
    critiqueId: 248,
    section: '5. Trending and Time-Relative Answers',
    family: 'trend_screen',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Breaking out horror games for Steam Deck under $25',
  },
  {
    critiqueId: 87,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_cross_game',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'upcoming games with recent release timing changes',
  },
  {
    critiqueId: 88,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_cross_game',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'What are the biggest Steam page refreshes lately?',
  },
  {
    critiqueId: 139,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_single_game',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'Show me the recent Steam changes for Hades II',
  },
  {
    critiqueId: 221,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_single_game',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'Show me the biggest Steam store-page changes for Hades II in the last 90 days.',
  },
  {
    critiqueId: 222,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_cross_game',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'Find games that changed tags or genres materially in the last 6 months and summarize what likely shifted.',
  },
  {
    critiqueId: 20,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'Which games showed a sustained response after recent Steam changes?',
  },
  {
    critiqueId: 46,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Which live-service or frequently updated games look under-marketed and could be good agency prospects?',
  },
  {
    critiqueId: 48,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Show me games that used a likely relaunch pattern recently',
  },
  {
    critiqueId: 54,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_before_after',
    primaryPersona: 'Competitive / Market Intelligence Analyst',
    prompt: 'What changed on the Steam page for No Rest for the Wicked before and after its last major update?',
  },
  {
    critiqueId: 253,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Find games that appear to be teasing a big update before it ships.',
  },
  {
    critiqueId: 254,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Which titles had a major Steam announcement recently, but weak downstream CCU or review response?',
  },
  {
    critiqueId: 255,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Find signable indie games where product quality looks stronger than go-to-market execution.',
  },
  {
    critiqueId: 256,
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Rank possible marketing-agency leads by need, timing, and evidence quality.',
  },
  {
    critiqueId: 'M1',
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Which titles look like they started a new marketing push this month?',
  },
  {
    critiqueId: 'M2',
    section: '6. Change Intelligence and Strategic / Prospecting Answers',
    family: 'change_pattern',
    primaryPersona: 'Agency / Business Development Prospector',
    prompt: 'Which games look like they started a new marketing push recently?',
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.fromResults ?? args.outDir ?? buildDefaultOutDir();

  if (!args.fromResults) {
    await fs.mkdir(outDir, { recursive: true });
    const includeFilePath = path.join(outDir, 'include-prompts.txt');
    const reportPath = path.join(outDir, 'report.md');
    await fs.writeFile(includeFilePath, buildIncludeFileContents());

    await runGenericRunner({
      outDir,
      includeFilePath,
      reportPath,
      origin: args.origin ?? DEFAULT_ORIGIN,
    });
  }

  const summary = await renderDraftArtifacts(outDir);
  console.log(`Draft run markdown: ${summary.draftRunPath}`);
  console.log(`Curation template: ${summary.curationTemplatePath}`);
  console.log(`Raw artifacts: ${outDir}`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from-results') {
      args.fromResults = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out-dir') {
      args.outDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--origin') {
      args.origin = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return args;
}

function buildDefaultOutDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(DEFAULT_OUT_DIR_BASE, `critique-sections-5-6-${timestamp}`);
}

function buildIncludeFileContents() {
  return `${SUITE_ROWS.map((row) => `${row.critiqueId} | ${row.prompt}`).join('\n')}\n`;
}

async function runGenericRunner({ outDir, includeFilePath, reportPath, origin }) {
  const env = {
    ...process.env,
    CHAT_EVAL_ORIGIN: origin,
    CHAT_EVAL_CONCURRENCY: process.env.CHAT_EVAL_CONCURRENCY || '1',
    CHAT_EVAL_DELAY_MS: process.env.CHAT_EVAL_DELAY_MS || '3000',
    CHAT_EVAL_INCLUDE_PROMPTS_FILE: includeFilePath,
    CHAT_EVAL_OUT_DIR: outDir,
    CHAT_EVAL_DOC_PATH: reportPath,
  };

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GENERIC_RUNNER_PATH], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Generic chat eval runner exited with code ${code}`));
    });
  });
}

async function renderDraftArtifacts(outDir) {
  const resultsPath = path.join(outDir, 'results.json');
  const reportPath = path.join(outDir, 'report.md');
  const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
  const reportMarkdown = await fs.readFile(reportPath, 'utf8');
  const metadata = extractMetadata(reportMarkdown);
  const suiteResults = orderSuiteResults(results);
  const timingSummary = summarizeTimings(suiteResults);
  const familySummary = summarizeFamilies(suiteResults);
  const runtimeFailureSummary = summarizeRuntimeFailures(suiteResults);
  const toolFailureSummary = summarizeToolFailures(suiteResults);
  const curationTemplate = buildCurationTemplate(suiteResults);
  const draftRunPath = path.join(outDir, 'ledger-run-draft.md');
  const curationTemplatePath = path.join(outDir, 'curation-template.json');
  const runSummaryPath = path.join(outDir, 'run-summary.json');

  const draftRunMarkdown = renderDraftRunMarkdown({
    outDir,
    metadata,
    suiteResults,
    timingSummary,
    familySummary,
    runtimeFailureSummary,
    toolFailureSummary,
  });

  await fs.writeFile(draftRunPath, draftRunMarkdown);
  await fs.writeFile(curationTemplatePath, `${JSON.stringify(curationTemplate, null, 2)}\n`);
  await fs.writeFile(
    runSummaryPath,
    `${JSON.stringify(
      {
        ...metadata,
        outDir,
        promptCount: suiteResults.length,
        timingSummary,
        familySummary,
        runtimeFailureSummary,
        toolFailureSummary,
        results: suiteResults.map((row) => ({
          critiqueId: row.suite.critiqueId,
          prompt: row.prompt_text,
          section: row.suite.section,
          family: row.suite.family,
          primaryPersona: row.suite.primaryPersona,
          totalMs: row.timing?.totalMs ?? null,
          tools: row.tool_calls.map((tool) => tool.name),
          status: row.status,
          failureKind: row.failure_kind ?? null,
          primaryToolSucceeded: row.primary_tool_succeeded ?? null,
          toolFailureCount: row.tool_failure_count ?? 0,
          toolFailureKinds: row.tool_failure_kinds ?? [],
          workingStatus: isWorkingRow(row) ? 'working' : row.status === 'error' ? 'runtime_failure' : 'tool_failure',
        })),
      },
      null,
      2
    )}\n`
  );

  return {
    draftRunPath,
    curationTemplatePath,
  };
}

function extractMetadata(reportMarkdown) {
  return {
    generatedAt: matchMetadata(reportMarkdown, 'Generated'),
    environment: matchMetadata(reportMarkdown, 'Environment'),
    authAccount: matchMetadata(reportMarkdown, 'Auth account'),
    executionMode: matchMetadata(reportMarkdown, 'Execution mode'),
    concurrency: matchMetadata(reportMarkdown, 'Concurrency'),
    delayBetweenRequests: matchMetadata(reportMarkdown, 'Delay between request starts'),
  };
}

function matchMetadata(reportMarkdown, label) {
  const match = reportMarkdown.match(new RegExp(`- ${escapeRegExp(label)}: (.+)`));
  return match?.[1]?.trim() || null;
}

function orderSuiteResults(results) {
  const resultsByPrompt = new Map(results.map((row) => [row.prompt_text, row]));
  return SUITE_ROWS.map((suiteRow) => {
    const result = resultsByPrompt.get(suiteRow.prompt);
    if (!result) {
      throw new Error(`Missing result row for prompt: ${suiteRow.prompt}`);
    }
    return {
      ...result,
      suite: suiteRow,
    };
  });
}

function summarizeTimings(results) {
  const values = results
    .map((row) => row.timing?.totalMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  return {
    averageMs: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    fastestMs: values[0] ?? null,
    slowestMs: values.at(-1) ?? null,
  };
}

function summarizeFamilies(results) {
  const summary = new Map();

  for (const row of results) {
    const family = row.suite.family;
    const existing = summary.get(family) || {
      family,
      promptCount: 0,
      workingCount: 0,
      transportSuccessCount: 0,
      toolFailureCount: 0,
      runtimeFailureCount: 0,
    };

    existing.promptCount += 1;
    if (row.status === 'success') {
      existing.transportSuccessCount += 1;
    }
    if (isWorkingRow(row)) {
      existing.workingCount += 1;
    } else if (row.primary_tool_succeeded === false) {
      existing.toolFailureCount += 1;
    }
    if (row.status === 'error') {
      existing.runtimeFailureCount += 1;
    }

    summary.set(family, existing);
  }

  return Array.from(summary.values()).sort((left, right) => left.family.localeCompare(right.family));
}

function summarizeRuntimeFailures(results) {
  const summary = new Map();

  for (const row of results) {
    if (row.status !== 'error') {
      continue;
    }

    const failureKind = row.failure_kind || 'unknown';
    summary.set(failureKind, (summary.get(failureKind) || 0) + 1);
  }

  return Array.from(summary.entries())
    .map(([failureKind, count]) => ({ failureKind, count }))
    .sort((left, right) => right.count - left.count);
}

function summarizeToolFailures(results) {
  const summary = new Map();

  for (const row of results) {
    if (row.primary_tool_succeeded !== false) {
      continue;
    }

    const kinds =
      Array.isArray(row.tool_failure_kinds) && row.tool_failure_kinds.length > 0
        ? row.tool_failure_kinds
        : ['unknown'];
    for (const kind of kinds) {
      summary.set(kind, (summary.get(kind) || 0) + 1);
    }
  }

  return Array.from(summary.entries())
    .map(([failureKind, count]) => ({ failureKind, count }))
    .sort((left, right) => right.count - left.count);
}

function isWorkingRow(row) {
  return row.status === 'success' && row.primary_tool_succeeded !== false;
}

function buildCurationTemplate(results) {
  return results.map((row) => ({
    critiqueId: row.suite.critiqueId,
    prompt: row.prompt_text,
    section: row.suite.section,
    family: row.suite.family,
    primaryPersona: row.suite.primaryPersona,
    score: null,
    verdict: null,
    usefulnessSummary: null,
    curatorNotes: null,
    scoreBreakdown: {
      directness: null,
      completeness: null,
      relevance: null,
      trustworthiness: null,
      decisionValue: null,
      graceUnderAmbiguity: null,
    },
  }));
}

function renderDraftRunMarkdown({
  outDir,
  metadata,
  suiteResults,
  timingSummary,
  familySummary,
  runtimeFailureSummary,
  toolFailureSummary,
}) {
  const lines = [];
  lines.push('# Critique Sections 5+6 Draft Run');
  lines.push('');
  lines.push('- Scope: `docs/chat-output-user-critique.md` sections `5` and `6`');
  lines.push(`- Generated: ${metadata.generatedAt || 'unknown'}`);
  lines.push(`- Environment: ${metadata.environment || 'unknown'}`);
  lines.push(`- Auth account: ${metadata.authAccount || 'unknown'}`);
  lines.push(`- Execution mode: ${metadata.executionMode || 'unknown'}`);
  lines.push(`- Concurrency: ${metadata.concurrency || 'unknown'}`);
  lines.push(`- Delay between request starts: ${metadata.delayBetweenRequests || 'unknown'}`);
  lines.push(`- Raw artifacts: ${outDir}`);
  lines.push(`- Prompt count: ${suiteResults.length}`);
  lines.push('');
  lines.push('## Latency Summary');
  lines.push('');
  lines.push('| Average | Median | P95 | Fastest | Slowest |');
  lines.push('|---:|---:|---:|---:|---:|');
  lines.push(
    `| ${formatMs(timingSummary.averageMs)} | ${formatMs(timingSummary.medianMs)} | ${formatMs(timingSummary.p95Ms)} | ${formatMs(timingSummary.fastestMs)} | ${formatMs(timingSummary.slowestMs)} |`
  );
  lines.push('');
  lines.push('## Family Summary');
  lines.push('');
  lines.push('| Family | Prompts | Working | Transport Success | Tool Failures | Runtime Failures |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of familySummary) {
    lines.push(
      `| ${escapeTable(row.family)} | ${row.promptCount} | ${row.workingCount} | ${row.transportSuccessCount} | ${row.toolFailureCount} | ${row.runtimeFailureCount} |`
    );
  }
  lines.push('');
  if (runtimeFailureSummary.length > 0) {
    lines.push('## Runtime Failures');
    lines.push('');
    lines.push('| Failure Kind | Count |');
    lines.push('|---|---:|');
    for (const row of runtimeFailureSummary) {
      lines.push(`| ${escapeTable(row.failureKind)} | ${row.count} |`);
    }
    lines.push('');
  }
  if (toolFailureSummary.length > 0) {
    lines.push('## Tool Failures');
    lines.push('');
    lines.push('| Failure Kind | Count |');
    lines.push('|---|---:|');
    for (const row of toolFailureSummary) {
      lines.push(`| ${escapeTable(row.failureKind)} | ${row.count} |`);
    }
    lines.push('');
  }
  lines.push('## Prompt Inventory');
  lines.push('');
  lines.push('| Critique ID | Section | Family | Primary Persona | Prompt |');
  lines.push('|---:|---|---|---|---|');
  for (const row of SUITE_ROWS) {
    lines.push(
      `| ${row.critiqueId} | ${escapeTable(row.section)} | ${escapeTable(row.family)} | ${escapeTable(row.primaryPersona)} | ${escapeTable(row.prompt)} |`
    );
  }
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Critique ID | Prompt | Total Time | Tools | Status | Primary Tool | Failure Kind | Tool Failure Kinds |');
  lines.push('|---:|---|---:|---|---|---|---|---|');
  for (const row of suiteResults) {
    lines.push(
      `| ${row.suite.critiqueId} | ${escapeTable(row.prompt_text)} | ${row.timing?.totalMs ?? '-'} | ${escapeTable(row.tool_calls.map((tool) => tool.name).join(', ') || '-')} | ${row.status} | ${row.primary_tool_succeeded === true ? 'ok' : row.primary_tool_succeeded === false ? 'failed' : '-'} | ${escapeTable(row.failure_kind || '-')} | ${escapeTable((row.tool_failure_kinds || []).join(', ') || '-')} |`
    );
  }
  lines.push('');
  lines.push('## Detailed Results');
  lines.push('');

  for (const row of suiteResults) {
    lines.push(`### #${row.suite.critiqueId} ${row.prompt_text}`);
    lines.push('');
    lines.push(`- Section: ${row.suite.section}`);
    lines.push(`- Family: ${row.suite.family}`);
    lines.push(`- Primary persona: ${row.suite.primaryPersona}`);
    lines.push('- User score: `TBD`');
    lines.push('- Verdict: `TBD`');
    lines.push('- Usefulness summary: `TBD`');
    lines.push('- Curator notes: `TBD`');
    lines.push(
      `- Timing: total ${row.timing?.totalMs ?? '-'}ms | llm ${row.timing?.llmMs ?? '-'}ms | tools ${row.timing?.toolsMs ?? '-'}ms | iterations ${row.iterations ?? '-'}`
    );
    lines.push(`- Tools: ${row.tool_calls.map((tool) => tool.name).join(', ') || '-'}`);
    lines.push(`- Working: ${isWorkingRow(row) ? 'yes' : 'no'}`);
    lines.push(`- Primary expected tool succeeded: ${row.primary_tool_succeeded === true ? 'yes' : row.primary_tool_succeeded === false ? 'no' : '-'}`);
    lines.push(`- Tool failure count: ${row.tool_failure_count ?? 0}`);
    lines.push(`- Tool failure kinds: ${(row.tool_failure_kinds || []).join(', ') || '-'}`);
    lines.push(`- Failure kind: ${row.failure_kind || '-'}`);
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
    lines.push(JSON.stringify(row.tool_calls, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const index = Math.ceil(values.length * ratio) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value}ms` : '-';
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
