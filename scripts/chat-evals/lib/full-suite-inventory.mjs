import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUITE_ROWS as SECTIONS_1_2_ROWS } from '../run-critique-sections-1-2.mjs';
import { SUITE_ROWS as SECTIONS_3_4_ROWS } from '../run-critique-sections-3-4.mjs';
import { SUITE_ROWS as SECTIONS_5_6_ROWS } from '../run-critique-sections-5-6.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const BLENDED_PERSONA = {
  name: 'Blended PublisherIQ Operator',
  summary:
    'A senior PublisherIQ user judging answers for trust, completeness, relevance, decision value, and graceful handling of ambiguity across strategy, market intelligence, studio benchmarking, prospecting, and portfolio work.',
  sourceRoles: [
    'Publishing Strategy Lead',
    'Competitive / Market Intelligence Analyst',
    'Developer Studio Lead or Product Lead',
    'Agency / Business Development Prospector',
    'Investor / Portfolio Analyst',
  ],
  rubricWeights: {
    completeness: 0.15,
    decisionValue: 0.25,
    directness: 0.15,
    graceUnderAmbiguity: 0.1,
    relevance: 0.15,
    trustworthiness: 0.2,
  },
  verdictBands: {
    failure: { min: 0, max: 3.9, label: 'Failure' },
    weak: { min: 4, max: 5.4, label: 'Weak' },
    mixed: { min: 5.5, max: 6.9, label: 'Mixed' },
    good: { min: 7, max: 8.4, label: 'Good' },
    strong: { min: 8.5, max: 10, label: 'Strong' },
  },
};

const PROMPT_SUITES = [
  { rows: SECTIONS_1_2_ROWS, suiteId: 'sections-1-2' },
  { rows: SECTIONS_3_4_ROWS, suiteId: 'sections-3-4' },
  { rows: SECTIONS_5_6_ROWS, suiteId: 'sections-5-6' },
];

export const MULTI_TURN_SCENARIOS_PATH = path.join(
  MODULE_DIR,
  '..',
  'multi-turn-phase1-scenarios.json'
);

export function getFullSuitePromptInventory() {
  const deduped = new Map();

  for (const suite of PROMPT_SUITES) {
    for (const row of suite.rows) {
      const key = `${String(row.critiqueId)}::${normalizePrompt(row.prompt)}`;
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, {
          critiqueId: row.critiqueId,
          family: row.family,
          primaryPersona: row.primaryPersona,
          prompt: row.prompt,
          section: row.section,
          sourceFamilies: [row.family],
          sourceSections: [row.section],
          sourceSuites: [suite.suiteId],
        });
        continue;
      }

      if (!existing.sourceFamilies.includes(row.family)) {
        existing.sourceFamilies.push(row.family);
      }

      if (!existing.sourceSections.includes(row.section)) {
        existing.sourceSections.push(row.section);
      }

      if (!existing.sourceSuites.includes(suite.suiteId)) {
        existing.sourceSuites.push(suite.suiteId);
      }
    }
  }

  return [...deduped.values()];
}

export async function loadFullSuiteScenarioInventory() {
  const raw = JSON.parse(await fs.readFile(MULTI_TURN_SCENARIOS_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Scenario inventory must be an array: ${MULTI_TURN_SCENARIOS_PATH}`);
  }

  return raw.map((scenario) => ({
    id: String(scenario.id || scenario.name),
    name: String(scenario.name || scenario.id),
    notes: typeof scenario.notes === 'string' ? scenario.notes : '',
    turns: Array.isArray(scenario.turns)
      ? scenario.turns.map((turn, turnIndex) => ({
          expectation: typeof turn.expectation === 'string' ? turn.expectation : '',
          turnIndex: turnIndex + 1,
          user: String(turn.user || ''),
        }))
      : [],
  }));
}

export async function buildFullSuiteManifest(params = {}) {
  const maxPrompts = Number(params.maxPrompts || 0);
  const maxScenarios = Number(params.maxScenarios || 0);
  const prompts = getFullSuitePromptInventory();
  const scenarios = await loadFullSuiteScenarioInventory();

  return {
    blendedPersona: BLENDED_PERSONA,
    prompts: maxPrompts > 0 ? prompts.slice(0, maxPrompts) : prompts,
    scenarios: maxScenarios > 0 ? scenarios.slice(0, maxScenarios) : scenarios,
  };
}

function normalizePrompt(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
