import { DEFAULT_GOLDEN_GOAL } from './constants.mjs';

const DEFAULT_REQUIRED_FIELDS = [
  'correct anchor entity',
  'faithful metric labels',
  'no unsupported claims',
];

const FAMILY_RUBRICS = {
  game_lookup: {
    answerShape: 'Compact single-entity lookup grounded in one canonical game record.',
    requiredFields: [
      'release date or release state',
      'price or free status',
      'review percentage and review count',
      'publisher and developer when available',
      'Steam Deck or platform status when available',
    ],
    hardRules: [
      'Anchor to the resolved game and do not import off-platform facts.',
      'Do not invent release, platform, or pricing context absent from tool evidence.',
    ],
    decisionValueFocus: 'Give the product lead an immediate commercial and platform read on the game.',
    sparsePolicy: 'Sparse handling is usually not relevant for a single-game lookup.',
    failureModes: [
      'temporal incoherence',
      'unsupported platform claims',
      'wrong entity or wrong release state',
    ],
  },
  filtered_discovery: {
    answerShape: 'Representative discovery board that stays inside the stated filters.',
    requiredFields: [
      'review percentage and review count',
      'price or free status',
      'release date or release state when available',
      'publisher or developer when available',
    ],
    hardRules: [
      'Hard numeric and categorical constraints apply to the entire answer.',
      'If evidence marks the set as sparse or complete-and-small, say so explicitly instead of broadening.',
    ],
    decisionValueFocus: 'Return a believable shortlist that a PublisherIQ user can scan quickly.',
    sparsePolicy: 'A small but complete on-constraint set can still score well if it is called out honestly.',
    failureModes: [
      'hard constraint violation',
      'implausibly thin coverage with no caveat',
      'bargain-bin or low-signal tail dominating the list',
    ],
  },
  tag_lookup: {
    answerShape: 'Canonical tag answer with adjacent discovery hints when available.',
    requiredFields: ['canonical tag', 'adjacent tags when provided by tools'],
    hardRules: ['Do not invent adjacent tags that the tool did not surface.'],
    decisionValueFocus: 'Help the user understand the tag surface they can explore next.',
    sparsePolicy: 'If only one canonical tag exists, a concise answer is acceptable.',
    failureModes: ['over-thin one-word response when adjacent tags were available'],
  },
  company_ranking: {
    answerShape: 'Ranked board with context that explains why the entity belongs.',
    requiredFields: [
      'requested metric',
      'portfolio or top-title context when available',
      'review-backed support when relevant',
    ],
    hardRules: [
      'Do not answer company rankings with a naked count or a misleading nearby metric.',
      'Keep publisher and developer roles straight.',
    ],
    decisionValueFocus: 'Support strategy and investor-style comparisons, not just list volume.',
    sparsePolicy: 'If the requested screen is thin, explain what made the cut or why it did not.',
    failureModes: [
      'wrong metric shape',
      'scale-blind raw volume dump',
      'obvious category leakage such as non-indie entities in an indie answer',
    ],
  },
  company_comparison: {
    answerShape: 'Side-by-side comparison of the asked entities using the requested metrics.',
    requiredFields: ['requested comparison metric', 'supporting portfolio context', 'clear interpretation'],
    hardRules: ['Compare the same population on both sides instead of mixing nearby metrics.'],
    decisionValueFocus: 'Help the user understand what the metric difference means strategically.',
    sparsePolicy: 'If the exact metric is limited, say that limitation plainly.',
    failureModes: ['different populations', 'missing requested metric', 'bare average with no context'],
  },
  developer_lookup: {
    answerShape: 'Usable developer catalog or flagship view.',
    requiredFields: ['recognizable titles', 'review context', 'ordering that makes sense for the prompt'],
    hardRules: ['Do not return obvious false negatives for known in-database developers.'],
    decisionValueFocus: 'Let the user understand the portfolio quickly without mentally re-ranking everything.',
    sparsePolicy: 'If only a few results exist, keep the set honest rather than padding.',
    failureModes: ['false negative', 'low-signal sort order', 'mobile/archive clutter dominating flagships'],
  },
  publisher_lookup: {
    answerShape: 'Usable publisher lookup with portfolio context.',
    requiredFields: ['count or requested fact', 'review-backed context', 'representative titles when available'],
    hardRules: ['Do not answer company lookups from name resolution alone when richer evidence exists.'],
    decisionValueFocus: 'Give a fast but defensible view of the publisher.',
    sparsePolicy: 'A compact answer is acceptable if it still proves the claim.',
    failureModes: ['bare count only', 'weak supporting examples', 'role confusion'],
  },
  company_similarity: {
    answerShape: 'Peer set with flagship context and believable matching logic.',
    requiredFields: ['peer entities', 'flagship titles when available', 'short why-it-matches explanation'],
    hardRules: [
      'Do not use lexical name collisions as similarity.',
      'Keep scale and posture aligned with the reference company.',
    ],
    decisionValueFocus: 'Produce a peer frame the user could actually use in strategy work.',
    sparsePolicy: 'If the peer set is limited, say so rather than broadening into obvious mismatches.',
    failureModes: ['scale-blind peers', 'name-adjacent collisions', 'no match reasoning'],
  },
  publisher_similarity: {
    answerShape: 'Peer publisher set with believable commercial similarity.',
    requiredFields: ['peer publishers', 'flagship examples', 'why-it-matches reasoning'],
    hardRules: ['Do not widen into publishers with completely different scale or posture.'],
    decisionValueFocus: 'Help the user frame a realistic publisher peer set.',
    sparsePolicy: 'Prefer a smaller honest peer set over a noisy one.',
    failureModes: ['scale-blind peers', 'name-adjacent collisions', 'missing peer rationale'],
  },
  developer_similarity: {
    answerShape: 'Peer developer set with flagship context and believable matching logic.',
    requiredFields: ['peer developers', 'flagship titles', 'why-it-matches reasoning'],
    hardRules: ['Do not rely on lexical similarity or empty generic explanations.'],
    decisionValueFocus: 'Give a product lead a first-pass peer set they could defend.',
    sparsePolicy: 'Prefer fewer credible peers over padding.',
    failureModes: ['lexical contamination', 'generic rationale', 'mismatched portfolio posture'],
  },
  game_similarity: {
    answerShape: 'Comp set with support fields and per-row why-it-fits reasoning.',
    requiredFields: [
      'review percentage',
      'review count',
      'price when available',
      'Steam Deck when relevant',
      'why-it-fits explanation',
    ],
    hardRules: [
      'Do not pad with title-word lookalikes.',
      'Keep hard constraints like Steam Deck and review thresholds intact.',
    ],
    decisionValueFocus: 'Produce believable comps, not just nearby action games.',
    sparsePolicy: 'A shorter credible comp set is better than a long noisy one.',
    failureModes: ['lexical contamination', 'missing why-it-fits', 'constraint leakage'],
  },
  franchise_lookup: {
    answerShape: 'Exact series or franchise list with zero-tolerance precision.',
    requiredFields: ['same-series titles only', 'support fields when available'],
    hardRules: [
      'Exact-series questions are zero-tolerance for off-franchise rows.',
      'If same-franchise evidence is empty, stay honest and narrow instead of broadening into genre cousins.',
    ],
    decisionValueFocus: 'Protect trust above breadth for exact-series lookups.',
    sparsePolicy: 'A sparse exact set is fully acceptable if it is correct.',
    failureModes: ['single false positive', 'genre-neighbor substitution', 'same-series claim without evidence'],
  },
  concept_search: {
    answerShape: 'Curated concept board with a short interpretation of the concept.',
    requiredFields: ['concept interpretation', 'support fields', 'why-it-fits reasoning'],
    hardRules: [
      'Do not let keyword collisions dominate the board.',
      'Respect tone and taste implied by the prompt.',
    ],
    decisionValueFocus: 'Make the board feel intentionally interpreted rather than literally scraped.',
    sparsePolicy: 'A smaller but thoughtful set can score well if it matches the concept cleanly.',
    failureModes: ['title-keyword collisions', 'no interpretation', 'low-signal tail'],
  },
  trend_leaderboard: {
    answerShape: 'Time-anchored leaderboard using the exact ranking metric and support fields.',
    requiredFields: ['exact window anchor', 'exact ranking metric label', 'support fields such as reviews or CCU'],
    hardRules: [
      'Use the metric and timeframe from tool evidence exactly.',
      'Do not relabel owners or reviews as players or momentum if the tool did not.',
    ],
    decisionValueFocus: 'Help an analyst interpret current movement with evidence, not generic hype.',
    sparsePolicy: 'If the leaderboard is intentionally narrow, explain the screen and support floors.',
    failureModes: ['wrong metric label', 'missing time anchor', 'long-tail board that over-claims scale'],
  },
  trend_comparison: {
    answerShape: 'Comparison board that includes all requested comparison columns.',
    requiredFields: ['requested metric columns', 'same population on every row', 'exact window anchor'],
    hardRules: ['Do not omit a requested comparison column like CCU when the prompt asks for it.'],
    decisionValueFocus: 'Let the analyst compare like with like.',
    sparsePolicy: 'Sparse sets are acceptable if the answer is explicit about the limitation.',
    failureModes: ['missing requested column', 'mixed populations', 'single-row answer with no caveat'],
  },
  trend_filtered: {
    answerShape: 'Strict filtered trend screen with clean genre or content compliance.',
    requiredFields: ['exact window anchor', 'clean filter obedience'],
    hardRules: ['A strict empty result is better than a contaminated list.'],
    decisionValueFocus: 'Preserve filter trust over recall.',
    sparsePolicy: 'Empty or tiny results can score well if they are clearly defended.',
    failureModes: ['genre contamination', 'unsupported near-misses', 'vague trend framing'],
  },
  trend_breakout: {
    answerShape: 'Breakout board with evidence of why the titles count as breaking out.',
    requiredFields: ['exact window anchor', 'support fields proving breakout', 'clear scale framing'],
    hardRules: ['Do not call something breaking out without evidence from the surfaced metrics.'],
    decisionValueFocus: 'Help the analyst separate genuine breakouts from small noisy movers.',
    sparsePolicy: 'If the evidence is thin, say the board is exploratory rather than definitive.',
    failureModes: ['noisy breakout list', 'low-support tail', 'over-claiming'],
  },
  trend_velocity: {
    answerShape: 'Review-activity board with exact window and ranking metric.',
    requiredFields: ['exact window anchor', 'review activity metric', 'support fields'],
    hardRules: ['Use the exact review-volume or velocity metric returned by the tool.'],
    decisionValueFocus: 'Make the board immediately usable for market monitoring.',
    sparsePolicy: 'Sparse screens are acceptable if the answer says why the qualifying set is small.',
    failureModes: ['wrong metric name', 'missing anchor', 'claims of acceleration without support'],
  },
  trend_sentiment: {
    answerShape: 'Sentiment-change board with signed deltas and enough support to trust it.',
    requiredFields: ['exact window anchor', 'signed sentiment deltas when available', 'support fields'],
    hardRules: ['Do not overstate sentiment improvements on tiny recent-review samples.'],
    decisionValueFocus: 'Give the analyst a board they can defend internally.',
    sparsePolicy: 'If only a few rows have credible support, keeping the board short is acceptable.',
    failureModes: ['tiny-sample tail', 'missing signed deltas', 'vague positivity claims'],
  },
  change_single_game: {
    answerShape: 'Single-game change brief with before/after evidence and timing.',
    requiredFields: ['what changed', 'when it changed', 'old vs new state when available'],
    hardRules: ['Do not collapse distinct changes into placeholder repetition.'],
    decisionValueFocus: 'Help the user understand a specific title’s recent storefront changes.',
    sparsePolicy: 'If only a few concrete changes exist, list those cleanly.',
    failureModes: ['repeated placeholders', 'wrong window', 'no before/after state'],
  },
  change_before_after: {
    answerShape: 'Before/after brief tied to a specific update or beat.',
    requiredFields: ['identified update beat', 'before state', 'after state', 'impact evidence'],
    hardRules: ['Do not call it before/after if the answer never isolates a specific beat.'],
    decisionValueFocus: 'Support actual change interpretation, not a generic status summary.',
    sparsePolicy: 'If the evidence cannot isolate the beat, say so plainly.',
    failureModes: ['no isolated change beat', 'snapshot summary instead of before/after'],
  },
  change_cross_game: {
    answerShape: 'Cross-title change screen with ranked evidence.',
    requiredFields: ['what changed', 'when', 'why it matters'],
    hardRules: ['Do not fill the board with generic change labels that hide the actual change.'],
    decisionValueFocus: 'Give the user a ranked board of meaningful recent changes.',
    sparsePolicy: 'If only a few entries are truly supported, keep the board short.',
    failureModes: ['generic filler rows', 'missing old vs new state', 'no ranking logic'],
  },
  change_pattern: {
    answerShape: 'Pattern or prospecting screen with title-specific proof.',
    requiredFields: ['evidence of the pattern', 'timing', 'why the title qualifies'],
    hardRules: ['Do not output strategic prose without concrete per-title proof.'],
    decisionValueFocus: 'Make the answer actionable for monitoring or outreach.',
    sparsePolicy: 'If the exact pattern is rare, near-miss explanation is acceptable only when the prompt does not set a hard constraint.',
    failureModes: ['templated generic reasons', 'no proof of the pattern', 'dead-end no-result without evidence of what was checked'],
  },
};

const DEFAULT_RUBRIC = {
  answerShape: 'Answer the user directly from PublisherIQ evidence.',
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  hardRules: [
    'Use only same-run tool evidence and the answer text.',
    'Do not reward unsupported claims.',
  ],
  decisionValueFocus: 'Be useful to the named persona using only product-grounded evidence.',
  sparsePolicy: 'If the data is genuinely sparse, honesty can still score well.',
  failureModes: ['unsupported claims', 'wrong answer shape', 'constraint violations'],
};

export function getFamilyRubric(family) {
  return FAMILY_RUBRICS[family] || DEFAULT_RUBRIC;
}

export function getPromptTarget(promptEntry, defaultGoal = DEFAULT_GOLDEN_GOAL) {
  const explicit = Number(promptEntry?.targetScore);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return defaultGoal;
}

export function isPromptAtTarget(promptEntry, defaultGoal = DEFAULT_GOLDEN_GOAL) {
  return Number(promptEntry?.score || 0) >= getPromptTarget(promptEntry, defaultGoal);
}

export function getPromptCalibration(promptEntry, defaultGoal = DEFAULT_GOLDEN_GOAL) {
  const referenceScore = Number(promptEntry?.referenceScore);
  return {
    targetScore: getPromptTarget(promptEntry, defaultGoal),
    targetVerdict: promptEntry?.targetVerdict || null,
    referenceScore: Number.isFinite(referenceScore) ? referenceScore : null,
    referenceVerdict: promptEntry?.referenceVerdict || null,
    judgeNotes: promptEntry?.judgeNotes || null,
  };
}

export function buildEvidenceDigest(result) {
  return {
    status: result?.status || 'unknown',
    errorMessage: result?.errorMessage || null,
    answerLength: String(result?.answer || '').trim().length,
    iterations: result?.iterations ?? null,
    timing: result?.timing || null,
    toolCalls: Array.isArray(result?.toolCalls)
      ? result.toolCalls.map((toolCall) => ({
        name: toolCall.name,
        arguments: compactValue(toolCall.arguments),
        success: toolCall.success !== false,
        executionMs: toolCall.executionMs ?? null,
        summary: toolCall.summary ?? null,
        result: compactValue(toolCall.result),
      }))
      : [],
  };
}

function compactValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length <= 320 ? value : `${value.slice(0, 317)}...`;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) {
      return `[array ${value.length}]`;
    }
    return '[object]';
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 12).map((item) => compactValue(item, depth + 1));
    if (value.length > 12) {
      items.push(`[truncated ${value.length - 12} more]`);
    }
    return items;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const output = {};
    for (const [key, entryValue] of entries.slice(0, 40)) {
      output[key] = compactValue(entryValue, depth + 1);
    }
    if (entries.length > 40) {
      output.__truncatedKeys = entries.length - 40;
    }
    return output;
  }
  return String(value);
}
