import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ACTIVE_FULL_PACK_KEYS, loadPackDefinition } from '../../chat-evals/lib/prompt-packs.mjs';
import { DEFAULT_MAX_DISCOVERED_PROMPTS, GOLDEN_PACK_KEYS, PERSONA_ALIASES } from './constants.mjs';
import { getPromptTarget } from './judge-config.mjs';

const execFileAsync = promisify(execFile);
const ALL_AREAS = ['company', 'similarity', 'trend'];
const PATH_IMPACT_RULES = [
  {
    prefix: 'apps/admin/src/lib/chat/company-',
    areas: ['company'],
    highRisk: false,
  },
  {
    prefix: 'apps/admin/src/lib/chat/similarity-',
    areas: ['similarity'],
    highRisk: false,
  },
  {
    prefix: 'apps/admin/src/lib/chat/trend-',
    areas: ['trend'],
    highRisk: false,
  },
  {
    prefix: 'apps/admin/src/lib/chat/company-answer-policy',
    areas: ['company'],
    highRisk: false,
  },
  {
    prefix: 'apps/admin/src/lib/chat/',
    areas: ALL_AREAS,
    highRisk: true,
  },
  {
    prefix: 'apps/admin/src/lib/llm/',
    areas: ALL_AREAS,
    highRisk: true,
  },
  {
    prefix: 'apps/admin/src/app/api/chat/',
    areas: ALL_AREAS,
    highRisk: true,
  },
];

export async function buildPromptInventory() {
  const entries = new Map();

  for (const packKey of [...ACTIVE_FULL_PACK_KEYS, ...GOLDEN_PACK_KEYS]) {
    const pack = await loadPackDefinition(packKey);
    for (const entry of pack.entries) {
      const key = normalizePrompt(entry.prompt);
      const existing = entries.get(key);
      if (existing) {
        existing.packKeys = [...new Set([...existing.packKeys, pack.packKey])];
        existing.isGolden = existing.isGolden || pack.packType === 'golden';
        existing.targetScore = entry.targetScore ?? existing.targetScore ?? null;
        existing.targetVerdict = entry.targetVerdict ?? existing.targetVerdict ?? null;
        existing.referenceScore = entry.referenceScore ?? existing.referenceScore ?? null;
        existing.referenceVerdict = entry.referenceVerdict ?? existing.referenceVerdict ?? null;
        existing.judgeNotes = entry.judgeNotes ?? existing.judgeNotes ?? null;
        continue;
      }
      entries.set(key, {
        id: buildPromptId(entry.prompt),
        prompt: entry.prompt,
        area: pack.area,
        family: entry.family || pack.area,
        persona: normalizePersona(entry.primaryPersona),
        critiqueRef: entry.critiqueRef,
        packKeys: [pack.packKey],
        isGolden: pack.packType === 'golden',
        source: 'seed',
        targetScore: entry.targetScore ?? null,
        targetVerdict: entry.targetVerdict ?? null,
        referenceScore: entry.referenceScore ?? null,
        referenceVerdict: entry.referenceVerdict ?? null,
        judgeNotes: entry.judgeNotes ?? null,
      });
    }
  }

  return [...entries.values()];
}

export async function discoverPromptCandidates({
  databaseUrl,
  limit = DEFAULT_MAX_DISCOVERED_PROMPTS,
} = {}) {
  const psql = await resolvePsqlBinary();
  if (!psql || !databaseUrl) {
    return [];
  }

  const sql = `
    SELECT
      query_text,
      COUNT(*)::int AS run_count,
      MAX(iteration_count)::int AS max_iterations,
      MAX(tool_count)::int AS max_tools,
      MAX(timing_total_ms)::int AS max_total_ms,
      MIN(response_length)::int AS min_response_length,
      COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS total_tokens
    FROM chat_query_logs
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND query_text IS NOT NULL
      AND length(trim(query_text)) > 0
    GROUP BY query_text
    ORDER BY
      (MAX(iteration_count) * 4)
      + (MAX(tool_count) * 3)
      + (COALESCE(MAX(timing_total_ms), 0) / 1000.0)
      + (CASE WHEN MIN(response_length) < 180 THEN 10 ELSE 0 END)
      + (COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) / 4000.0)
      DESC
    LIMIT ${Number(limit)};
  `;

  try {
    const { stdout } = await execFileAsync(psql, ['-d', databaseUrl, '-A', '-F', '\t', '-c', sql], {
      maxBuffer: 1024 * 1024 * 4,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [prompt, runCount, maxIterations, maxTools, maxTotalMs, minResponseLength, totalTokens] = line.split('\t');
        return {
          id: buildPromptId(prompt),
          prompt,
          area: inferArea(prompt),
          family: inferArea(prompt),
          persona: inferPersonaFromPrompt(prompt),
          critiqueRef: null,
          packKeys: [],
          isGolden: false,
          source: 'chat_query_logs',
          targetScore: null,
          targetVerdict: null,
          referenceScore: null,
          referenceVerdict: null,
          judgeNotes: null,
          stats: {
            runCount: Number(runCount || 0),
            maxIterations: Number(maxIterations || 0),
            maxTools: Number(maxTools || 0),
            maxTotalMs: Number(maxTotalMs || 0),
            minResponseLength: Number(minResponseLength || 0),
            totalTokens: Number(totalTokens || 0),
          },
        };
      });
  } catch {
    return [];
  }
}

export function chooseNextPrompt(state) {
  const manualReviewIds = new Set(state.manualReview.map((entry) => entry.id));
  const maxLeadAttempts = Number(state.campaignBudget?.maxPivotsPerPrompt || 0) + 1;
  const candidates = [...state.promptResults]
    .filter((entry) => !manualReviewIds.has(entry.id))
    .filter((entry) => {
      const score = Number(entry.score || 0);
      const hasBlockingFlags = (entry.blockingFlags?.length || 0) > 0;
      return score < getPromptTarget(entry, state.campaignBudget.goldenGoal) || hasBlockingFlags;
    });

  const retryCandidates = candidates
    .filter((entry) => {
      const attempts = Number(entry.leadAttemptStreak || 0);
      return attempts > 0 && attempts < maxLeadAttempts;
    })
    .sort((left, right) => compareRetryPriority(left, right, state.campaignBudget.goldenGoal));
  if (retryCandidates.length > 0) {
    return retryCandidates[0];
  }

  const freshCandidates = candidates.sort((left, right) =>
    compareFreshPriority(left, right, state.campaignBudget.goldenGoal, maxLeadAttempts)
  );
  return freshCandidates[0] || null;
}

export function selectCanaryPrompts({
  state,
  leadPrompt,
  touchedFiles,
  baseLimit = 4,
  highRiskLimit = 6,
}) {
  const impact = inferImpactFromTouchedFiles(touchedFiles, leadPrompt);
  const limit = impact.highRisk ? highRiskLimit : baseLimit;
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const candidates = state.promptResults
    .filter((entry) => entry.isGolden)
    .filter((entry) => entry.id !== leadPrompt.id)
    .sort((left, right) => compareCanaryPriority(left, right, impact, state.campaignBudget.goldenGoal));
  const selected = [];
  const selectedIds = new Set();

  const sameFamily = candidates.filter((entry) => entry.family === leadPrompt.family);
  const sameArea = candidates.filter((entry) => entry.area === impact.primaryArea);
  const crossAreaSentinels = impact.areas
    .map((area) => candidates.find((entry) => entry.area === area))
    .filter(Boolean);

  addCanaries(selected, selectedIds, sameFamily, Math.min(limit, impact.highRisk ? 2 : 1));
  addCanaries(selected, selectedIds, sameArea, Math.min(limit - selected.length, impact.highRisk ? 2 : 1));
  addCanaries(selected, selectedIds, crossAreaSentinels, Math.min(limit - selected.length, 1));
  addCanaries(selected, selectedIds, candidates, limit - selected.length);

  return selected.slice(0, limit);
}

function comparePromptPriority(left, right, defaultGoal) {
  if (left.isGolden !== right.isGolden) {
    return Number(right.isGolden) - Number(left.isGolden);
  }
  if ((right.blockingFlags?.length || 0) !== (left.blockingFlags?.length || 0)) {
    return (right.blockingFlags?.length || 0) - (left.blockingFlags?.length || 0);
  }
  const leftGap = getPromptTarget(left, defaultGoal) - Number(left.score || 0);
  const rightGap = getPromptTarget(right, defaultGoal) - Number(right.score || 0);
  if (leftGap !== rightGap) {
    return rightGap - leftGap;
  }
  if ((left.score ?? 0) !== (right.score ?? 0)) {
    return (left.score ?? 0) - (right.score ?? 0);
  }
  return left.prompt.localeCompare(right.prompt);
}

function compareRetryPriority(left, right, defaultGoal) {
  const streakDelta = Number(right.leadAttemptStreak || 0) - Number(left.leadAttemptStreak || 0);
  if (streakDelta !== 0) {
    return streakDelta;
  }
  return comparePromptPriority(left, right, defaultGoal);
}

function compareFreshPriority(left, right, defaultGoal, maxLeadAttempts) {
  const leftExhausted = Number(left.leadAttemptStreak || 0) >= maxLeadAttempts;
  const rightExhausted = Number(right.leadAttemptStreak || 0) >= maxLeadAttempts;
  if (leftExhausted !== rightExhausted) {
    return Number(leftExhausted) - Number(rightExhausted);
  }
  return comparePromptPriority(left, right, defaultGoal);
}

function compareCanaryPriority(left, right, impact, defaultGoal) {
  const areaDelta = compareBoolean(right.area === impact.primaryArea, left.area === impact.primaryArea);
  if (areaDelta !== 0) {
    return areaDelta;
  }
  const familyDelta = compareBoolean(right.family === impact.primaryFamily, left.family === impact.primaryFamily);
  if (familyDelta !== 0) {
    return familyDelta;
  }
  const blockingDelta = (right.blockingFlags?.length || 0) - (left.blockingFlags?.length || 0);
  if (blockingDelta !== 0) {
    return blockingDelta;
  }
  const rightGap = getPromptTarget(right, defaultGoal) - Number(right.score || 0);
  const leftGap = getPromptTarget(left, defaultGoal) - Number(left.score || 0);
  if (rightGap !== leftGap) {
    return rightGap - leftGap;
  }
  return left.prompt.localeCompare(right.prompt);
}

function normalizePrompt(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildPromptId(prompt) {
  return crypto.createHash('sha1').update(normalizePrompt(prompt)).digest('hex').slice(0, 12);
}

function normalizePersona(value) {
  if (!value) return 'publishing_strategy_lead';
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return PERSONA_ALIASES[normalized] || normalized;
}

function inferPersonaFromPrompt(prompt) {
  const value = prompt.toLowerCase();
  if (/\bpublisher|developer|company\b/.test(value)) {
    return 'publishing_strategy_lead';
  }
  if (/\bright now|this week|this month|momentum|break(ing|out)|trend|velocity\b/.test(value)) {
    return 'competitive_market_intelligence_analyst';
  }
  if (/\bsimilar|like|series|steam deck|pixel art|beautiful art|horror\b/.test(value)) {
    return 'developer_studio_lead';
  }
  if (/\bunder-marketed|agency|relaunch|prospect\b/.test(value)) {
    return 'agency_business_development_prospector';
  }
  return 'investor_portfolio_analyst';
}

function inferArea(prompt) {
  const value = prompt.toLowerCase();
  if (/\bright now|this week|this month|momentum|break(ing|out)|trend|velocity|sentiment\b/.test(value)) {
    return 'trend';
  }
  if (/\bsimilar|like|series|steam deck|horror|beautiful art|pixel art\b/.test(value)) {
    return 'similarity';
  }
  return 'company';
}

async function resolvePsqlBinary() {
  for (const candidate of ['/opt/homebrew/opt/libpq/bin/psql', 'psql']) {
    try {
      await execFileAsync(candidate, ['--version']);
      return candidate;
    } catch {
      // Try the next binary.
    }
  }
  return null;
}

function inferImpactFromTouchedFiles(touchedFiles, leadPrompt) {
  const matchedAreas = new Set();
  let highRisk = false;

  for (const file of touchedFiles || []) {
    for (const rule of PATH_IMPACT_RULES) {
      if (!file.startsWith(rule.prefix)) {
        continue;
      }
      highRisk = highRisk || rule.highRisk;
      for (const area of rule.areas) {
        matchedAreas.add(area);
      }
    }
  }

  if (matchedAreas.size === 0) {
    matchedAreas.add(leadPrompt.area || 'company');
  }

  const primaryArea = matchedAreas.has(leadPrompt.area) ? leadPrompt.area : [...matchedAreas][0];
  const areas = ALL_AREAS.filter((area) => area !== primaryArea);
  return {
    highRisk,
    primaryArea,
    primaryFamily: leadPrompt.family,
    areas,
  };
}

function addCanaries(target, selectedIds, entries, count) {
  if (count <= 0) {
    return;
  }
  const targetSize = target.length + count;
  for (const entry of entries) {
    if (target.length >= targetSize) {
      return;
    }
    if (!entry || selectedIds.has(entry.id)) {
      continue;
    }
    selectedIds.add(entry.id);
    target.push(entry);
    if (target.length >= targetSize) {
      return;
    }
  }
}

function compareBoolean(left, right) {
  return Number(left) - Number(right);
}
