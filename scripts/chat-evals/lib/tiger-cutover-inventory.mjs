import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLENDED_PERSONA } from './full-suite-inventory.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(MODULE_DIR, '..');

export const TIGER_CUTOVER_PROMPTS_PATH = path.join(ROOT_DIR, 'tiger-cutover-prompts.json');
export const TIGER_CUTOVER_SCENARIOS_PATH = path.join(ROOT_DIR, 'tiger-cutover-scenarios.json');
export const TIGER_CUTOVER_INVENTORY_NAME = 'tiger-cutover';
export const TIGER_CUTOVER_ENDPOINT_REPORT_TITLE = 'Tiger Cutover Endpoint Chat Eval';
export const TIGER_CUTOVER_UI_REPORT_TITLE = 'Tiger Cutover Browser Chat Smoke';

export async function buildTigerCutoverManifest(params = {}) {
  const maxPrompts = Number(params.maxPrompts || 0);
  const maxScenarios = Number(params.maxScenarios || 0);
  const smokeOnly = Boolean(params.smokeOnly);
  const promptRows = await loadPromptRows();
  const scenarioRows = await loadScenarioRows();

  const prompts = smokeOnly
    ? promptRows.filter((row) => row.uiSmoke)
    : promptRows;
  const scenarios = smokeOnly
    ? scenarioRows.filter((row) => row.uiSmoke)
    : scenarioRows;

  return {
    blendedPersona: BLENDED_PERSONA,
    prompts: maxPrompts > 0 ? prompts.slice(0, maxPrompts) : prompts,
    scenarios: maxScenarios > 0 ? scenarios.slice(0, maxScenarios) : scenarios,
  };
}

async function loadPromptRows() {
  const raw = JSON.parse(await fs.readFile(TIGER_CUTOVER_PROMPTS_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Tiger cutover prompts must be an array: ${TIGER_CUTOVER_PROMPTS_PATH}`);
  }

  return raw.map((row) => normalizePromptRow(row));
}

async function loadScenarioRows() {
  const raw = JSON.parse(await fs.readFile(TIGER_CUTOVER_SCENARIOS_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Tiger cutover scenarios must be an array: ${TIGER_CUTOVER_SCENARIOS_PATH}`);
  }

  return raw.map((row) => normalizeScenarioRow(row));
}

function normalizePromptRow(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Tiger cutover prompt rows must be objects.');
  }

  const prompt = String(row.prompt || '').trim();
  if (!prompt) {
    throw new Error('Tiger cutover prompt rows must define prompt.');
  }

  const critiqueId = String(row.id || prompt);
  const family = String(row.family || 'unknown');
  const primaryPersona = String(row.primaryPersona || BLENDED_PERSONA.sourceRoles[0]);
  const priority = String(row.priority || 'P2');

  return {
    antiAnchors: normalizeStringArray(row.antiAnchors),
    critiqueId,
    expectedBehavior: String(row.expectedBehavior || 'success'),
    expectedContracts: normalizeStringArray(row.expectedContracts),
    expectedRoutes: normalizeStringArray(row.expectedRoutes),
    factualAnchors: normalizeStringArray(row.factualAnchors),
    family,
    inventoryName: TIGER_CUTOVER_INVENTORY_NAME,
    isVariant: false,
    latencyBudgetMs: normalizeOptionalNumber(row.latencyBudgetMs),
    mustAvoidBackends: normalizeStringArray(row.mustAvoidBackends),
    notes: typeof row.notes === 'string' ? row.notes : '',
    primaryPersona,
    priority,
    prompt,
    seedPromptId: critiqueId,
    section: `Tiger Cutover ${priority}`,
    sourceInventory: TIGER_CUTOVER_INVENTORY_NAME,
    sourceFamilies: [family],
    sourceSections: [`Tiger Cutover ${priority}`],
    sourceSuites: [TIGER_CUTOVER_INVENTORY_NAME],
    uiSmoke: row.uiSmoke === true,
    variantKey: null,
  };
}

function normalizeScenarioRow(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('Tiger cutover scenario rows must be objects.');
  }

  if (!Array.isArray(row.turns) || row.turns.length === 0) {
    throw new Error('Tiger cutover scenarios must define turns.');
  }

  return {
    id: String(row.id || row.name),
    inventoryName: TIGER_CUTOVER_INVENTORY_NAME,
    isVariant: false,
    latencyBudgetMs: normalizeOptionalNumber(row.latencyBudgetMs),
    mustAvoidBackends: normalizeStringArray(row.mustAvoidBackends),
    name: String(row.name || row.id),
    notes: typeof row.notes === 'string' ? row.notes : '',
    priority: String(row.priority || 'P2'),
    seedPromptId: String(row.id || row.name),
    section: `Tiger Cutover ${String(row.priority || 'P2')}`,
    sourceInventory: TIGER_CUTOVER_INVENTORY_NAME,
    turns: row.turns.map((turn, index) => normalizeScenarioTurn(turn, index)),
    uiSmoke: row.uiSmoke === true,
    variantKey: null,
  };
}

function normalizeScenarioTurn(turn, index) {
  if (!turn || typeof turn !== 'object' || typeof turn.user !== 'string') {
    throw new Error(`Tiger cutover scenario turn ${index + 1} is invalid.`);
  }

  return {
    antiAnchors: normalizeStringArray(turn.mustNotInclude),
    expectedContracts: normalizeStringArray(turn.expectedContracts),
    expectedRoutes: normalizeStringArray(turn.expectedRoutes),
    expectation: typeof turn.expectation === 'string' ? turn.expectation : '',
    factualAnchors: normalizeStringArray(turn.mustInclude),
    latencyBudgetMs: normalizeOptionalNumber(turn.latencyBudgetMs),
    user: turn.user,
  };
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
}
