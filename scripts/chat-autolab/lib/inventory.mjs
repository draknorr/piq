import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ACTIVE_FULL_PACK_KEYS, loadPackDefinition } from '../../chat-evals/lib/prompt-packs.mjs';
import { DEFAULT_MAX_DISCOVERED_PROMPTS, GOLDEN_PACK_KEYS, PERSONA_ALIASES } from './constants.mjs';
import { getPromptTarget } from './judge-config.mjs';

const execFileAsync = promisify(execFile);

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
  const candidates = [...state.promptResults]
    .filter((entry) => !manualReviewIds.has(entry.id))
    .filter((entry) => {
      const score = Number(entry.score || 0);
      const hasBlockingFlags = (entry.blockingFlags?.length || 0) > 0;
      return score < getPromptTarget(entry, state.campaignBudget.goldenGoal) || hasBlockingFlags;
    })
    .sort((left, right) => comparePromptPriority(left, right, state.campaignBudget.goldenGoal));
  return candidates[0] || null;
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
