#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'));
const OUTPUT_JSON = args.has('--json');
const FAIL_ON_WRITERS = args.has('--fail-on-supabase-writers');

const WORKFLOW_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const RAILWAY_MANIFESTS = [
  'railway.toml',
  'packages/ingestion/railway.json',
  'services/pics-service/railway.toml',
];
const CODE_SCAN_ROOTS = [
  'apps/admin/src',
  'packages/ingestion/src',
  'services/pics-service/src',
];

const SERVICE_KEY_PATTERN = /\bSUPABASE_(?:SERVICE_KEY|SERVICE_ROLE_KEY|SERVICE_ROLE)\b/;
const SUPABASE_URL_PATTERN = /\bSUPABASE_URL\b/;
const DATABASE_URL_PATTERN = /\bDATABASE_URL\b/;
const TIGER_URL_PATTERN = /\b(?:TIGER_PRIMARY_URL|TIGER_PRODUCTION_URL|TIGER_PREVIEW_URL|CHANGE_INTEL_TIGER_URL|PICS_CHANGE_HISTORY_TIGER_URL|PICS_LATEST_STATE_TIGER_URL)\b/;
const WRITE_OPERATION_PATTERN = /\.(?:insert|upsert|update|delete)\s*\(|\b(?:INSERT|UPDATE|DELETE|UPSERT|ALTER|DROP|TRUNCATE|CREATE TABLE)\b/i;
const SUPABASE_CLIENT_PATTERN = /\b(?:createServiceClient|getServiceClient|getServiceSupabase|SupabaseClient\.get_instance|supabase\.create_client)\b/;
const INLINE_SUPABASE_WRITE_PATTERN = /supabase\.(?:rpc|from)\s*\(|\.table\s*\(|\.insert\s*\(|\.upsert\s*\(|\.update\s*\(|\.delete\s*\(/;

function relPath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).replaceAll(path.sep, '/');
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readTextIfExists(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
}

function walkFiles(rootRelativePath, extensions) {
  const root = path.join(ROOT_DIR, rootRelativePath);
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') {
        continue;
      }

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (extensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) {
    return [];
  }

  return fs.readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => path.join(WORKFLOW_DIR, name));
}

function extractEnvValue(text, name) {
  const match = text.match(new RegExp(`^\\s*${name}:\\s*([^\\n#]+)`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function extractRunCommands(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run: '))
    .map((line) => line.slice('run: '.length).trim())
    .filter(Boolean);
}

function detectTriggers(text) {
  return {
    schedule: /^\s*schedule\s*:/m.test(text) || /^\s*-\s*cron\s*:/m.test(text),
    workflowDispatch: /^\s*workflow_dispatch\s*:/m.test(text),
    push: /^\s*push\s*:/m.test(text),
    pullRequest: /^\s*pull_request\s*:/m.test(text),
  };
}

function workflowUsesIngestion(text) {
  return /@publisheriq\/ingestion|pnpm\s+--filter\s+@publisheriq\/ingestion|packages\/ingestion/.test(text);
}

function workflowUsesSupabaseWrite(text) {
  return INLINE_SUPABASE_WRITE_PATTERN.test(text) || WRITE_OPERATION_PATTERN.test(text);
}

function workflowUsesDatabaseUrlSqlWrite(text) {
  return /\bpsql\s+["']?\$DATABASE_URL\b/.test(text) && WRITE_OPERATION_PATTERN.test(text);
}

function classifyWorkflow(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const triggers = detectTriggers(text);
  const hasSupabaseServiceKey = SERVICE_KEY_PATTERN.test(text);
  const hasSupabaseUrl = SUPABASE_URL_PATTERN.test(text);
  const hasDatabaseUrl = DATABASE_URL_PATTERN.test(text);
  const hasTigerUrl = TIGER_URL_PATTERN.test(text);
  const dataWriteTarget = extractEnvValue(text, 'DATA_WRITE_TARGET');
  const changeIntelWriteTarget = extractEnvValue(text, 'CHANGE_INTEL_WRITE_TARGET');
  const picsChangeHistoryTarget = extractEnvValue(text, 'PICS_CHANGE_HISTORY_TARGET');
  const picsLatestStateTarget = extractEnvValue(text, 'PICS_LATEST_STATE_TARGET');
  const commands = extractRunCommands(text);
  const usesIngestion = workflowUsesIngestion(text);
  const usesSupabaseWrite = workflowUsesSupabaseWrite(text);
  const usesDatabaseUrlSqlWrite = workflowUsesDatabaseUrlSqlWrite(text);
  const hasLegacyWriterGate = /\bENABLE_LEGACY_SUPABASE_WRITERS\b/.test(text);
  const active = triggers.schedule || triggers.workflowDispatch;
  const tigerWriteTarget =
    dataWriteTarget === 'tiger' ||
    changeIntelWriteTarget === 'tiger' ||
    picsChangeHistoryTarget === 'tiger' ||
    picsLatestStateTarget === 'tiger';

  let severity = 'ok';
  const notes = [];

  if (
    active &&
    hasLegacyWriterGate &&
    (
      (hasSupabaseServiceKey && (usesIngestion || usesSupabaseWrite)) ||
      (hasDatabaseUrl && usesDatabaseUrlSqlWrite && !hasTigerUrl)
    )
  ) {
    severity = 'disabled';
    notes.push('Legacy Supabase writer is gated by ENABLE_LEGACY_SUPABASE_WRITERS.');
  } else if (hasDatabaseUrl && active && usesDatabaseUrlSqlWrite && !hasTigerUrl) {
    severity = triggers.schedule ? 'blocker' : 'manual-risk';
    notes.push('Workflow uses DATABASE_URL for direct SQL write operations without a Tiger target.');
  } else if (hasSupabaseServiceKey && active && (usesIngestion || usesSupabaseWrite) && !tigerWriteTarget) {
    severity = triggers.schedule ? 'blocker' : 'manual-risk';
    notes.push('Supabase service credential is present on an active write-capable workflow.');
  } else if (hasSupabaseServiceKey && active && tigerWriteTarget) {
    severity = 'manual-risk';
    notes.push('Tiger write target is set, but Supabase service credential is still present.');
  } else if (hasDatabaseUrl && hasTigerUrl && !hasSupabaseServiceKey) {
    severity = 'reference';
    notes.push('Uses source DATABASE_URL without Supabase service credential; treat as reference/parity unless scheduled source sync remains intentional.');
  } else if (hasSupabaseServiceKey) {
    severity = 'info';
    notes.push('Supabase service credential appears in a non-scheduled or non-write-classified workflow.');
  }

  if (tigerWriteTarget && !hasTigerUrl) {
    severity = severity === 'blocker' ? severity : 'manual-risk';
    notes.push('Tiger write target is set without an obvious Tiger URL secret.');
  }

  return {
    path: relPath(filePath),
    severity,
    triggers,
    hasSupabaseServiceKey,
    hasSupabaseUrl,
    hasDatabaseUrl,
    hasTigerUrl,
    hasLegacyWriterGate,
    dataWriteTarget,
    changeIntelWriteTarget,
    picsChangeHistoryTarget,
    picsLatestStateTarget,
    usesIngestion,
    usesSupabaseWrite,
    usesDatabaseUrlSqlWrite,
    commands,
    notes,
  };
}

function classifyRailwayManifest(relativePath) {
  const text = readTextIfExists(relativePath);
  if (text === null) {
    return null;
  }

  const startCommand = relativePath.endsWith('.json')
    ? JSON.parse(text).deploy?.startCommand ?? null
    : text.match(/^\s*startCommand\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const buildCommand = relativePath.endsWith('.json')
    ? JSON.parse(text).build?.buildCommand ?? null
    : text.match(/^\s*buildCommand\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const usesIngestion = /@publisheriq\/ingestion|change-intel-worker|storefront|reviews|ccu|steamspy|embedding|alert/.test(text);
  const hasManifestSupabaseServiceKey = SERVICE_KEY_PATTERN.test(text);
  const hasManifestTigerUrl = TIGER_URL_PATTERN.test(text);
  const hasManifestTigerWriteTarget =
    /DATA_WRITE_TARGET\s*[:=]\s*['"]?tiger/i.test(text) ||
    /CHANGE_INTEL_WRITE_TARGET\s*[:=]\s*['"]?tiger/i.test(text) ||
    /PICS_CHANGE_HISTORY_TARGET\s*[:=]\s*['"]?tiger/i.test(text) ||
    /PICS_LATEST_STATE_TARGET\s*[:=]\s*['"]?tiger/i.test(text);
  const notes = [];
  let severity = 'ok';

  if (usesIngestion && !hasManifestTigerWriteTarget) {
    severity = 'unknown';
    notes.push('Manifest starts an ingestion-style service, but write-target env is external to the manifest.');
  }

  if (hasManifestSupabaseServiceKey) {
    severity = 'manual-risk';
    notes.push('Manifest text references a Supabase service credential.');
  }

  return {
    path: relativePath,
    severity,
    startCommand,
    buildCommand,
    usesIngestion,
    hasManifestSupabaseServiceKey,
    hasManifestTigerUrl,
    hasManifestTigerWriteTarget,
    notes,
  };
}

function classifyCodePath(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const hasSupabaseServiceClient = SUPABASE_CLIENT_PATTERN.test(text) || SERVICE_KEY_PATTERN.test(text);
  const hasSupabaseUrl = SUPABASE_URL_PATTERN.test(text);
  const hasWriteOperation = WRITE_OPERATION_PATTERN.test(text);
  const hasRpc = /\.rpc\s*\(|\.client\.rpc\s*\(|\.table\s*\(/.test(text);

  if (!hasSupabaseServiceClient && !hasSupabaseUrl) {
    return null;
  }

  const severity = hasSupabaseServiceClient && (hasWriteOperation || hasRpc) ? 'manual-risk' : 'reference';
  const notes = [];

  if (severity === 'manual-risk') {
    notes.push('Static scan found Supabase service-client usage with write-like methods or RPC/table calls.');
  } else {
    notes.push('Static scan found Supabase configuration or service-client usage without obvious writes.');
  }

  return {
    path: relPath(filePath),
    severity,
    hasSupabaseServiceClient,
    hasSupabaseUrl,
    hasWriteOperation,
    hasRpc,
    notes,
  };
}

function runtimeEnvironmentSummary() {
  return {
    ci: Boolean(process.env.CI),
    githubActions: Boolean(process.env.GITHUB_ACTIONS),
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT ?? null,
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    dataWriteTarget: process.env.DATA_WRITE_TARGET ?? null,
    changeIntelWriteTarget: process.env.CHANGE_INTEL_WRITE_TARGET ?? null,
    picsChangeHistoryTarget: process.env.PICS_CHANGE_HISTORY_TARGET ?? null,
    picsLatestStateTarget: process.env.PICS_LATEST_STATE_TARGET ?? null,
    supabaseServiceClientPurpose: process.env.SUPABASE_SERVICE_CLIENT_PURPOSE ?? null,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasTigerPrimaryUrl: Boolean(process.env.TIGER_PRIMARY_URL),
  };
}

function collectReport() {
  const workflows = listWorkflowFiles().map(classifyWorkflow);
  const railway = RAILWAY_MANIFESTS
    .map(classifyRailwayManifest)
    .filter((item) => item !== null);
  const codePaths = CODE_SCAN_ROOTS
    .flatMap((root) => walkFiles(root, ['.ts', '.tsx', '.js', '.mjs', '.py']))
    .map(classifyCodePath)
    .filter((item) => item !== null);

  const blockers = workflows.filter((item) => item.severity === 'blocker');
  const manualRisks = [
    ...workflows.filter((item) => item.severity === 'manual-risk'),
    ...railway.filter((item) => item.severity === 'manual-risk' || item.severity === 'unknown'),
    ...codePaths.filter((item) => item.severity === 'manual-risk'),
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: FAIL_ON_WRITERS ? 'enforce' : 'report-only',
    runtimeEnvironment: runtimeEnvironmentSummary(),
    summary: {
      blockerCount: blockers.length,
      manualRiskCount: manualRisks.length,
      workflowCount: workflows.length,
      railwayManifestCount: railway.length,
      codePathCount: codePaths.length,
    },
    workflows,
    railway,
    codePaths,
  };
}

function printSection(title, rows, formatter) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  none');
    return;
  }

  for (const row of rows) {
    console.log(formatter(row));
    for (const note of row.notes ?? []) {
      console.log(`    - ${note}`);
    }
  }
}

function printHumanReport(report) {
  console.log('Supabase Writer Audit');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Mode: ${report.mode}`);
  console.log(
    `Summary: ${report.summary.blockerCount} scheduled blockers, ${report.summary.manualRiskCount} manual/static risks`
  );
  console.log(
    `Runtime env: DATA_WRITE_TARGET=${report.runtimeEnvironment.dataWriteTarget ?? '(unset)'}, ` +
      `CHANGE_INTEL_WRITE_TARGET=${report.runtimeEnvironment.changeIntelWriteTarget ?? '(unset)'}, ` +
      `SUPABASE_SERVICE_KEY=${report.runtimeEnvironment.hasSupabaseServiceKey ? 'present' : 'absent'}, ` +
      `TIGER_PRIMARY_URL=${report.runtimeEnvironment.hasTigerPrimaryUrl ? 'present' : 'absent'}`
  );

  printSection(
    'GitHub Workflows',
    report.workflows.filter((item) => item.severity !== 'ok'),
    (item) =>
      `  [${item.severity}] ${item.path} ` +
      `(schedule=${item.triggers.schedule ? 'yes' : 'no'}, manual=${item.triggers.workflowDispatch ? 'yes' : 'no'}, ` +
      `service-key=${item.hasSupabaseServiceKey ? 'yes' : 'no'}, tiger=${item.hasTigerUrl ? 'yes' : 'no'})`
  );

  printSection(
    'Railway Manifests',
    report.railway.filter((item) => item.severity !== 'ok'),
    (item) =>
      `  [${item.severity}] ${item.path}` +
      (item.startCommand ? ` start="${item.startCommand}"` : '')
  );

  printSection(
    'App And Worker Service-Role Code Paths',
    report.codePaths.filter((item) => item.severity === 'manual-risk'),
    (item) =>
      `  [${item.severity}] ${item.path} ` +
      `(write-like=${item.hasWriteOperation ? 'yes' : 'no'}, rpc/table=${item.hasRpc ? 'yes' : 'no'})`
  );
}

const report = collectReport();

if (OUTPUT_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (FAIL_ON_WRITERS && report.summary.blockerCount > 0) {
  process.exitCode = 1;
}
