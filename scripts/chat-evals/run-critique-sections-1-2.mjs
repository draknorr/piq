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
    critiqueId: 2,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'filtered_discovery',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'free metroidvania games',
  },
  {
    critiqueId: 10,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'game_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'tell me about Hades II',
  },
  {
    critiqueId: 21,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'game_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'Show me all the DLC for Elden Ring',
  },
  {
    critiqueId: 138,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'filtered_discovery',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Games currently on sale',
  },
  {
    critiqueId: 141,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'filtered_discovery',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Highly rated games under $10 released in the past year',
  },
  {
    critiqueId: 219,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'filtered_discovery',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Games under $5 with overwhelmingly positive reviews',
  },
  {
    critiqueId: 242,
    section: '1. Game Lookups and Filtered Discovery',
    family: 'filtered_discovery',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Premium games over $40 with great reviews',
  },
  {
    critiqueId: 89,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Which indie developers have multiple hit games?',
  },
  {
    critiqueId: 97,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_comparison',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'Compare FromSoftware and Team Cherry by reviews',
  },
  {
    critiqueId: 127,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'What publishers are releasing the most games this year?',
  },
  {
    critiqueId: 130,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Publishers with the most games released in the past 6 months',
  },
  {
    critiqueId: 140,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'Publishers with 5+ games averaging 85%+ reviews in the past 3 years',
  },
  {
    critiqueId: 151,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Developers with 3+ games, all above 90% reviews, with a release in the past year',
  },
  {
    critiqueId: 152,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'tag_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'What tags exist for colony sim games?',
  },
  {
    critiqueId: 155,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'developer_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'Show me all games by FromSoftware',
  },
  {
    critiqueId: 156,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'developer_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'top games from FromSoftware',
  },
  {
    critiqueId: 157,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'Which publishers released the most games this year?',
  },
  {
    critiqueId: 161,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'developer_lookup',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'games by FromSoftware',
  },
  {
    critiqueId: 170,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_similarity',
    primaryPersona: 'Publishing Strategy Lead',
    prompt: 'What publishers are similar to Devolver Digital?',
  },
  {
    critiqueId: 171,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_similarity',
    primaryPersona: 'Developer Studio Lead or Product Lead',
    prompt: 'Show me developers similar to Supergiant Games',
  },
  {
    critiqueId: 175,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'company_ranking',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'Publishers with releases in every year since 2020',
  },
  {
    critiqueId: 178,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'publisher_lookup',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'how many games has Krafton published?',
  },
  {
    critiqueId: 179,
    section: '2. Publisher, Developer, and Company Answers',
    family: 'publisher_lookup',
    primaryPersona: 'Investor / Portfolio Analyst',
    prompt: 'How many games has Valve published?',
  },
];

const SUITE_BY_PROMPT = new Map(SUITE_ROWS.map((row) => [row.prompt, row]));

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
  return path.join(DEFAULT_OUT_DIR_BASE, `critique-sections-1-2-${timestamp}`);
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
  const curationTemplate = buildCurationTemplate(suiteResults);
  const draftRunPath = path.join(outDir, 'ledger-run-draft.md');
  const curationTemplatePath = path.join(outDir, 'curation-template.json');
  const runSummaryPath = path.join(outDir, 'run-summary.json');

  const draftRunMarkdown = renderDraftRunMarkdown({
    outDir,
    metadata,
    suiteResults,
    timingSummary,
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
        results: suiteResults.map((row) => ({
          critiqueId: row.suite.critiqueId,
          prompt: row.prompt_text,
          section: row.suite.section,
          family: row.suite.family,
          primaryPersona: row.suite.primaryPersona,
          totalMs: row.timing?.totalMs ?? null,
          tools: row.tool_calls.map((tool) => tool.name),
          status: row.status,
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

function renderDraftRunMarkdown({ outDir, metadata, suiteResults, timingSummary }) {
  const lines = [];
  lines.push('# Critique Sections 1+2 Draft Run');
  lines.push('');
  lines.push('- Scope: `docs/chat-output-user-critique.md` sections `1` and `2`');
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
  lines.push('| Critique ID | Prompt | Total Time | Tools | Status |');
  lines.push('|---:|---|---:|---|---|');
  for (const row of suiteResults) {
    lines.push(
      `| ${row.suite.critiqueId} | ${escapeTable(row.prompt_text)} | ${row.timing?.totalMs ?? '-'} | ${escapeTable(row.tool_calls.map((tool) => tool.name).join(', ') || '-')} | ${row.status} |`
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
