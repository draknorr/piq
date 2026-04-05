import crypto from 'node:crypto';

import {
  buildFullSuiteManifest,
  FULL_SUITE_INVENTORY_NAME,
} from './full-suite-inventory.mjs';
import {
  buildTigerCutoverManifest,
  TIGER_CUTOVER_INVENTORY_NAME,
} from './tiger-cutover-inventory.mjs';

export const INVENTORY_ALL_NAME = 'all';
export const VARIANT_MODE_OFF = 'off';
export const VARIANT_MODE_LIGHT = 'light';

const LIGHT_VARIANT_SPECS = [
  {
    factualAnchors: ['Elden Ring'],
    prompt: 'tell me about Elden Ring',
    templatePrompt: 'tell me about Hades II',
    variantKey: 'light-game-lookup',
  },
  {
    factualAnchors: ['Team Cherry'],
    prompt: 'Show me all games by Team Cherry',
    templatePrompt: 'Show me all games by FromSoftware',
    variantKey: 'light-developer-lookup',
  },
  {
    factualAnchors: ['Supergiant Games', 'Team Cherry'],
    prompt: 'Compare Supergiant Games to Team Cherry',
    templatePrompt: 'Compare FromSoftware to Rockstar Games',
    variantKey: 'light-company-comparison',
  },
  {
    factualAnchors: ['Team Cherry'],
    prompt: 'Show me developers similar to Team Cherry',
    templatePrompt: 'Show me developers similar to Supergiant Games',
    variantKey: 'light-company-similarity',
  },
  {
    factualAnchors: ['Hades'],
    prompt: 'Games like Hades with better reviews',
    templatePrompt: 'Games similar to Hollow Knight with better reviews',
    variantKey: 'light-game-similarity',
  },
  {
    prompt: 'Breaking out indie games this week',
    templatePrompt: 'Breaking out indie games this month',
    variantKey: 'light-trend-screen',
  },
  {
    factualAnchors: ['Hades'],
    prompt: 'What changed on Hades before and after its last big update?',
    templatePrompt: 'What changed on Hades II before and after its last big update?',
    variantKey: 'light-change-before-after',
  },
  {
    factualAnchors: ['Deadlock'],
    prompt: 'Any recent announcements about Deadlock?',
    templatePrompt: 'Any recent announcements about Primeval?',
    variantKey: 'light-news-search',
  },
];

export async function buildEvalManifest(params = {}) {
  const inventoryName = normalizeInventoryName(params.inventoryName);
  const maxPrompts = Number(params.maxPrompts || 0);
  const maxScenarios = Number(params.maxScenarios || 0);
  const smokeOnly = Boolean(params.smokeOnly);
  const variantMode = normalizeVariantMode(params.variantMode);
  const shuffleSeed = trimString(params.shuffleSeed);

  const baseManifest = await loadBaseManifest({
    inventoryName,
    smokeOnly,
  });
  const prompts =
    !smokeOnly && variantMode === VARIANT_MODE_LIGHT
      ? addLightVariants(baseManifest.prompts)
      : [...baseManifest.prompts];
  const shuffledPrompts = shuffleSeed
    ? shufflePrompts(prompts, shuffleSeed)
    : prompts;
  const scenarios = [...baseManifest.scenarios];

  return {
    blendedPersona: baseManifest.blendedPersona,
    inventoryName,
    prompts: maxPrompts > 0 ? shuffledPrompts.slice(0, maxPrompts) : shuffledPrompts,
    scenarios: maxScenarios > 0 ? scenarios.slice(0, maxScenarios) : scenarios,
    shuffleSeed: shuffleSeed || null,
    smokeOnly,
    variantMode,
  };
}

async function loadBaseManifest(params) {
  const { inventoryName, smokeOnly } = params;

  if (inventoryName === INVENTORY_ALL_NAME) {
    const [fullSuite, tigerCutover] = await Promise.all([
      buildFullSuiteManifest({ smokeOnly }),
      buildTigerCutoverManifest({ smokeOnly }),
    ]);

    return {
      blendedPersona: fullSuite.blendedPersona,
      prompts: [...fullSuite.prompts, ...tigerCutover.prompts],
      scenarios: [...fullSuite.scenarios, ...tigerCutover.scenarios],
    };
  }

  if (inventoryName === TIGER_CUTOVER_INVENTORY_NAME) {
    return buildTigerCutoverManifest({ smokeOnly });
  }

  return buildFullSuiteManifest({ smokeOnly });
}

function addLightVariants(promptRows) {
  const prompts = [...promptRows];
  const promptsByNormalizedText = new Map(
    promptRows.map((row) => [normalizePrompt(row.prompt), row])
  );

  for (const spec of LIGHT_VARIANT_SPECS) {
    const template = promptsByNormalizedText.get(normalizePrompt(spec.templatePrompt));
    if (!template) {
      continue;
    }

    const variant = buildVariantPromptRow(spec, template);
    if (!variant) {
      continue;
    }

    prompts.push(variant);
  }

  return prompts;
}

function buildVariantPromptRow(spec, template) {
  const critiqueId = `VAR-${spec.variantKey}`;

  return {
    ...template,
    critiqueId,
    factualAnchors: Array.isArray(spec.factualAnchors) ? spec.factualAnchors : [],
    inventoryName: template.inventoryName || template.sourceInventory || FULL_SUITE_INVENTORY_NAME,
    isVariant: true,
    notes: [
      template.notes,
      `Light randomized variant derived from ${template.seedPromptId || template.critiqueId}.`,
    ]
      .filter(Boolean)
      .join(' '),
    prompt: spec.prompt,
    section: `${template.section} (Variant)`,
    seedPromptId: String(template.seedPromptId || template.critiqueId),
    sourceSections: [...new Set([...(template.sourceSections || []), `${template.section} (Variant)`])],
    sourceSuites: [...new Set([...(template.sourceSuites || []), 'variant-light'])],
    uiSmoke: false,
    variantKey: spec.variantKey,
  };
}

function shufflePrompts(promptRows, shuffleSeed) {
  return [...promptRows].sort((left, right) => {
    const leftKey = buildStableShuffleKey(left, shuffleSeed);
    const rightKey = buildStableShuffleKey(right, shuffleSeed);
    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }

    return String(left.critiqueId).localeCompare(String(right.critiqueId));
  });
}

function buildStableShuffleKey(promptRow, shuffleSeed) {
  return crypto
    .createHash('sha1')
    .update(`${shuffleSeed}::${String(promptRow.critiqueId)}::${normalizePrompt(promptRow.prompt)}`)
    .digest('hex');
}

function normalizeInventoryName(value) {
  const candidate = lowerCaseTrimmed(value);
  if (!candidate) {
    return FULL_SUITE_INVENTORY_NAME;
  }

  if (
    candidate !== FULL_SUITE_INVENTORY_NAME
    && candidate !== TIGER_CUTOVER_INVENTORY_NAME
    && candidate !== INVENTORY_ALL_NAME
  ) {
    throw new Error(
      `Unknown inventory "${candidate}". Expected ${FULL_SUITE_INVENTORY_NAME}, ${TIGER_CUTOVER_INVENTORY_NAME}, or ${INVENTORY_ALL_NAME}.`
    );
  }

  return candidate;
}

function normalizeVariantMode(value) {
  const candidate = lowerCaseTrimmed(value) || VARIANT_MODE_OFF;
  if (candidate !== VARIANT_MODE_OFF && candidate !== VARIANT_MODE_LIGHT) {
    throw new Error(`Unknown variant mode "${candidate}". Expected ${VARIANT_MODE_OFF} or ${VARIANT_MODE_LIGHT}.`);
  }

  return candidate;
}

function normalizePrompt(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function lowerCaseTrimmed(value) {
  return trimString(value).toLowerCase();
}

function trimString(value) {
  return String(value || '').trim();
}
