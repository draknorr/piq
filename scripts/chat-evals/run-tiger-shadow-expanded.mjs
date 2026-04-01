#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadAutolabEnv, validateAutolabEnv } from '../chat-autolab/lib/env.mjs';

const ROOT = process.cwd();
const DEFAULT_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'http://localhost:3001';
const DEFAULT_OUT_DIR_BASE = path.join('/tmp', 'publisheriq-chat-evals');
const GENERIC_RUNNER_PATH = path.join(ROOT, 'scripts/chat-evals', 'run.mjs');
const INCLUDE_FILE_PATH = path.join(ROOT, 'scripts/chat-evals', 'tiger-shadow-expanded-prompts.txt');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadAutolabEnv();
  validateAutolabEnv(env);

  const outDir = args.outDir || buildDefaultOutDir();
  const reportPath = path.join(outDir, 'report.md');
  const origin = args.origin || DEFAULT_ORIGIN;

  await fs.mkdir(outDir, { recursive: true });

  await runGenericRunner({
    outDir,
    reportPath,
    origin,
  });

  const gate = await evaluateTigerShadowGate(outDir);
  printTigerShadowGate(gate);

  console.log(`Tiger shadow expanded eval report: ${reportPath}`);
  console.log(`Raw artifacts: ${outDir}`);

  if (!gate.passed) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = {
    origin: '',
    outDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--origin') {
      args.origin = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--out-dir') {
      args.outDir = argv[index + 1] || '';
      index += 1;
    }
  }

  return args;
}

function buildDefaultOutDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(DEFAULT_OUT_DIR_BASE, `tiger-shadow-expanded-${timestamp}`);
}

async function runGenericRunner({ outDir, reportPath, origin }) {
  const env = {
    ...process.env,
    CHAT_EVAL_ORIGIN: origin,
    CHAT_EVAL_INCLUDE_PROMPTS_FILE: INCLUDE_FILE_PATH,
    CHAT_EVAL_OUT_DIR: outDir,
    CHAT_EVAL_DOC_PATH: reportPath,
    CHAT_EVAL_CONCURRENCY: process.env.CHAT_EVAL_CONCURRENCY || '1',
    CHAT_EVAL_DELAY_MS: process.env.CHAT_EVAL_DELAY_MS || '1000',
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

async function evaluateTigerShadowGate(outDir) {
  const [resultsRaw, promptFileRaw] = await Promise.all([
    fs.readFile(path.join(outDir, 'results.json'), 'utf8'),
    fs.readFile(INCLUDE_FILE_PATH, 'utf8'),
  ]);

  const results = JSON.parse(resultsRaw);
  const expectations = parsePromptExpectations(promptFileRaw);
  const resultsByPrompt = new Map(
    results.map((result) => [result.prompt_text, result])
  );

  const evaluations = expectations.map((expectation) => {
    const result = resultsByPrompt.get(expectation.promptText);
    if (!result) {
      return {
        ...expectation,
        ok: false,
        reason: 'missing_result',
      };
    }

    const tigerShadow = result.tigerShadow ?? {};
    const route = tigerShadow.route ?? null;
    const matchedIntent = tigerShadow.matchedIntent ?? null;

    if (expectation.kind === 'negative') {
      const ok = route === 'unmatched' || route === 'skipped';
      return {
        ...expectation,
        matchedIntent,
        ok,
        reason: ok ? 'ok' : `expected_unmatched_or_skipped:${route ?? 'missing'}`,
        route,
      };
    }

    const ok = route === 'shadow_success_legacy_answer' && matchedIntent === expectation.expectedIntent;
    return {
      ...expectation,
      matchedIntent,
      ok,
      reason: ok
        ? 'ok'
        : `expected_${expectation.expectedIntent}:route=${route ?? 'missing'}:intent=${matchedIntent ?? 'missing'}`,
      route,
    };
  });

  return {
    evaluations,
    failed: evaluations.filter((evaluation) => !evaluation.ok),
    passed: evaluations.every((evaluation) => evaluation.ok),
  };
}

function parsePromptExpectations(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('|');
      const label = separator === -1 ? line : line.slice(0, separator).trim();
      const promptText = separator === -1 ? line : line.slice(separator + 1).trim();

      if (label.startsWith('negative_')) {
        return {
          kind: 'negative',
          label,
          promptText,
        };
      }

      return {
        expectedIntent: mapExpectedIntent(label),
        kind: 'positive',
        label,
        promptText,
      };
    });
}

function mapExpectedIntent(label) {
  if (label.startsWith('catalog_')) {
    return 'catalog_search';
  }

  if (label.startsWith('ranking_')) {
    return 'entity_ranking';
  }

  if (label.startsWith('history_')) {
    return 'metric_history';
  }

  throw new Error(`Unsupported Tiger shadow expanded prompt label: ${label}`);
}

function printTigerShadowGate(gate) {
  const passedCount = gate.evaluations.length - gate.failed.length;
  console.log(`Tiger shadow gate: ${gate.passed ? 'PASS' : 'FAIL'} (${passedCount}/${gate.evaluations.length})`);

  for (const evaluation of gate.failed) {
    console.log(`  - ${evaluation.label}: ${evaluation.reason}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
