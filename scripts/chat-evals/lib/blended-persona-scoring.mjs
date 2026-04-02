import { BLENDED_PERSONA } from './full-suite-inventory.mjs';

const MONTH_PATTERN =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const NUMBER_PATTERN = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;
const MONEY_PATTERN = /\$\d/;
const PERCENT_PATTERN = /\b\d{1,3}%\b/;
const ERROR_PATTERN =
  /\b(?:an error occurred|failed to get response|authentication required|internal server error|unauthorized)\b/i;
const NO_RESULTS_PATTERN =
  /\b(?:no results|no matching|unable to find|could not find|couldn't find|no qualifying|none found|did not find)\b/i;
const CAVEAT_PATTERN =
  /\b(?:if you want|i can narrow|i can also|this set is limited|limited set|heuristic|approximate|approx|relaxed|broadened|narrowed|near match|near matches|caveat)\b/i;
const REASON_PATTERN =
  /\b(?:why it fits|why it matches|why included|because|shares|similar|matches|fit|reason)\b/i;
const STEAM_DECK_PATTERN = /\b(?:steam deck|verified|playable|unsupported)\b/i;
const TIME_WORD_PATTERN =
  /\b(?:right now|today|this month|this year|past|last|recent|recently|upcoming|lately|current)\b/i;
const AMBIGUOUS_FOLLOW_UP_PATTERN =
  /\b(?:same|more|show me more|what about|what changed|only|those|them|that one|same but|under \$|over \$|with steam deck|steam deck verified)\b/i;
const TITLE_CASE_PATTERN =
  /\b(?:[A-Z][a-z0-9&'/:+-]*)(?:\s+(?:[A-Z][a-z0-9&'/:+-]*|II|III|IV|V|VI|VII|VIII|IX|X)){0,4}\b/g;

const FAMILY_EXPECTATIONS = {
  change_before_after: { minItems: 2, wantsAbsoluteDates: true, wantsMetrics: true, wantsReasons: true },
  change_cross_game: { minItems: 3, wantsAbsoluteDates: true, wantsMetrics: true, wantsReasons: true },
  change_pattern: { minItems: 3, wantsAbsoluteDates: true, wantsMetrics: true, wantsReasons: true },
  company_comparison: { minItems: 2, wantsComparison: true, wantsMetrics: true },
  company_ranking: { minItems: 5, wantsItems: true, wantsMetrics: true },
  company_similarity: { minItems: 4, wantsItems: true, wantsMetrics: true, wantsReasons: true },
  concept_search: { minItems: 5, wantsItems: true, wantsMetrics: true, wantsReasons: true },
  developer_lookup: { minItems: 5, wantsItems: true, wantsMetrics: true },
  developer_similarity: { minItems: 4, wantsItems: true, wantsMetrics: true, wantsReasons: true },
  filtered_discovery: { minItems: 5, wantsItems: true, wantsMetrics: true },
  franchise_lookup: { minItems: 4, wantsItems: true, wantsMetrics: true },
  game_lookup: { minItems: 1, wantsAbsoluteDates: true, wantsMetrics: true },
  game_similarity: { minItems: 5, wantsItems: true, wantsMetrics: true, wantsReasons: true },
  multi_turn: { minItems: 1, wantsMetrics: false },
  publisher_lookup: { minItems: 1, wantsMetrics: true },
  publisher_similarity: { minItems: 4, wantsItems: true, wantsMetrics: true, wantsReasons: true },
  tag_lookup: { minItems: 3, wantsItems: true },
  trend_comparison: { minItems: 2, wantsAbsoluteDates: true, wantsComparison: true, wantsMetrics: true },
  trend_ranking: { minItems: 5, wantsAbsoluteDates: true, wantsItems: true, wantsMetrics: true },
  trend_screen: { minItems: 5, wantsAbsoluteDates: true, wantsItems: true, wantsMetrics: true },
};

export function formatLatencyMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

export function getVerdictForScore(score) {
  const rounded = roundScore(score);
  const bands = Object.values(BLENDED_PERSONA.verdictBands);
  const match = bands.find((band) => rounded >= band.min && rounded <= band.max);
  return match?.label ?? 'Failure';
}

export function scorePromptResponse(params) {
  const {
    family,
    latencyMs,
    promptText,
    renderedMetrics,
    renderedText,
    status,
  } = params;

  const expectations = buildExpectations(family, promptText);
  const signals = buildSignals({
    expectations,
    latencyMs,
    promptText,
    renderedMetrics,
    renderedText,
    status,
  });

  const directness = scoreDirectness(signals, expectations);
  const completeness = scoreCompleteness(signals, expectations);
  const relevance = scoreRelevance(signals, expectations);
  const trustworthiness = scoreTrustworthiness(signals, expectations);
  const decisionValue = scoreDecisionValue({
    completeness,
    expectations,
    relevance,
    signals,
    trustworthiness,
  });
  const graceUnderAmbiguity = scoreGrace(signals, expectations);

  const breakdown = {
    completeness,
    decisionValue,
    directness,
    graceUnderAmbiguity,
    relevance,
    trustworthiness,
  };

  const draftScore = roundScore(
    Object.entries(BLENDED_PERSONA.rubricWeights).reduce((total, [key, weight]) => {
      return total + breakdown[key] * weight;
    }, 0)
  );

  const verdict = getVerdictForScore(draftScore);
  const qualityNotes = buildQualityNotes(signals, expectations);

  return {
    draftScore,
    qualityNotes,
    scoreBreakdown: breakdown,
    usefulnessSummary: buildUsefulnessSummary({
      draftScore,
      expectations,
      qualityNotes,
      signals,
      verdict,
    }),
    verdict,
  };
}

export function scoreScenarioResult(params) {
  const turnScores = params.turns.map((turn) =>
    scorePromptResponse({
      family: 'multi_turn',
      latencyMs: turn.visibleLatencyMs,
      promptText: turn.userPrompt,
      renderedMetrics: turn.responseMetrics,
      renderedText: turn.responseText,
      status: turn.status,
    })
  );

  const carryForward = evaluateCarryForwardQuality(params.turns);
  const averageTurnScore =
    turnScores.length > 0
      ? turnScores.reduce((sum, turn) => sum + turn.draftScore, 0) / turnScores.length
      : 0;
  const draftScore = roundScore(clampScore(averageTurnScore + carryForward.adjustment));
  const verdict = getVerdictForScore(draftScore);

  const qualityNotes = [
    ...carryForward.notes,
    ...turnScores
      .flatMap((turn, index) =>
        turn.qualityNotes.slice(0, 2).map((note) => `Turn ${index + 1}: ${note}`)
      )
      .slice(0, 6),
  ];

  return {
    carryForwardQuality: carryForward.label,
    draftScore,
    qualityNotes,
    scoreBreakdown: {
      averageTurnScore: roundScore(averageTurnScore),
      carryForwardAdjustment: roundScore(carryForward.adjustment),
    },
    turnScores,
    usefulnessSummary: buildScenarioSummary({
      carryForward,
      draftScore,
      turnScores,
      verdict,
    }),
    verdict,
  };
}

function buildExpectations(family, promptText) {
  const prompt = String(promptText || '').trim();
  const lower = prompt.toLowerCase();
  const base = {
    broadPrompt: false,
    minItems: 1,
    wantsAbsoluteDates: false,
    wantsComparison: false,
    wantsItems: false,
    wantsMetrics: false,
    wantsPrice: false,
    wantsReasons: false,
    wantsSteamDeck: false,
    ...FAMILY_EXPECTATIONS[family],
  };

  if (
    /(?:games?|publishers?|developers?|titles?|which|top|best|show me|find|rank|similar|like|compare)/i.test(
      prompt
    )
  ) {
    base.broadPrompt = true;
  }

  if (TIME_WORD_PATTERN.test(lower) || family?.startsWith('change_') || family?.startsWith('trend_')) {
    base.wantsAbsoluteDates = true;
  }

  if (
    /\breviews?\b|\bccu\b|\bplayers?\b|\bvelocity\b|\bscore\b|\baverag(?:e|ing)\b|\bpublished\b|\breleased\b|\bprice\b/i.test(
      prompt
    )
  ) {
    base.wantsMetrics = true;
  }

  if (/\bunder \$|\bover \$|\$\d/i.test(prompt)) {
    base.wantsPrice = true;
  }

  if (/\bsteam deck\b/i.test(prompt)) {
    base.wantsSteamDeck = true;
  }

  if (/\bcompare\b/i.test(prompt)) {
    base.wantsComparison = true;
  }

  if (/\b(?:similar|like|fits|investigation|puzzle|tactical|relaxing|pixel art|beautiful art)\b/i.test(prompt)) {
    base.wantsReasons = true;
  }

  if (base.minItems > 1) {
    base.wantsItems = true;
  }

  return base;
}

function buildSignals(params) {
  const text = String(params.renderedText || '').trim();
  const metrics = params.renderedMetrics || {};
  const nonEmptyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const duplicateLineCount = countDuplicateLines(nonEmptyLines);
  const numberMatches = text.match(NUMBER_PATTERN) ?? [];

  return {
    caveatSignals: countPatternHits(text, CAVEAT_PATTERN),
    duplicateLineCount,
    expectationCoverage: calculateExpectationCoverage(params.expectations, {
      hasAbsoluteDates: MONTH_PATTERN.test(text) || ISO_DATE_PATTERN.test(text),
      hasMetrics:
        PERCENT_PATTERN.test(text) || MONEY_PATTERN.test(text) || numberMatches.length >= 3,
      hasPrice: MONEY_PATTERN.test(text),
      hasReasons: REASON_PATTERN.test(text),
      hasSteamDeck: STEAM_DECK_PATTERN.test(text),
      itemCount: deriveItemCount(metrics, text),
    }),
    hasAbsoluteDates: MONTH_PATTERN.test(text) || ISO_DATE_PATTERN.test(text),
    hasCaveatSignals: CAVEAT_PATTERN.test(text),
    hasErrorLanguage: ERROR_PATTERN.test(text),
    hasMetrics: PERCENT_PATTERN.test(text) || MONEY_PATTERN.test(text) || numberMatches.length >= 3,
    hasNoResultsLanguage: NO_RESULTS_PATTERN.test(text),
    hasPrice: MONEY_PATTERN.test(text),
    hasReasonSignals: REASON_PATTERN.test(text),
    hasSteamDeckSignals: STEAM_DECK_PATTERN.test(text),
    itemCount: deriveItemCount(metrics, text),
    latencyMs: Number.isFinite(params.latencyMs) ? params.latencyMs : null,
    lineCount: nonEmptyLines.length,
    listItemCount: Number(metrics.listItemCount || 0),
    numberCount: numberMatches.length,
    promptText: params.promptText,
    repeatedLines: duplicateLineCount > 0,
    status: params.status,
    tableRowCount: Number(metrics.tableRowCount || 0),
    text,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
  };
}

function scoreDirectness(signals, expectations) {
  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2;
  }

  let score = 6.5;

  if (signals.wordCount >= 40) {
    score += 1;
  }

  if (signals.expectationCoverage >= 0.75) {
    score += 1.25;
  } else if (signals.expectationCoverage >= 0.5) {
    score += 0.5;
  }

  if (signals.hasNoResultsLanguage) {
    score -= expectations.broadPrompt ? 3 : 2;
  }

  if (expectations.wantsItems && signals.itemCount === 0) {
    score -= 2;
  }

  if (signals.wordCount < 20) {
    score -= 2;
  }

  return clampScore(score);
}

function scoreCompleteness(signals, expectations) {
  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2;
  }

  let score = 3.5;

  if (signals.wordCount >= 60) {
    score += 2;
  } else if (signals.wordCount >= 30) {
    score += 1;
  }

  if (expectations.wantsItems) {
    if (signals.itemCount >= expectations.minItems) {
      score += 3;
    } else if (signals.itemCount >= Math.max(1, expectations.minItems - 2)) {
      score += 1.5;
    } else {
      score -= 1.5;
    }
  }

  if (expectations.wantsMetrics) {
    score += signals.hasMetrics ? 1.5 : -1.5;
  }

  if (expectations.wantsAbsoluteDates) {
    score += signals.hasAbsoluteDates ? 1.5 : -1;
  }

  if (expectations.wantsReasons) {
    score += signals.hasReasonSignals ? 1 : -1;
  }

  return clampScore(score);
}

function scoreRelevance(signals, expectations) {
  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2.5;
  }

  let score = 5.5;

  if (signals.expectationCoverage >= 0.75) {
    score += 2;
  } else if (signals.expectationCoverage >= 0.5) {
    score += 1;
  } else {
    score -= 1;
  }

  if (expectations.wantsReasons && signals.hasReasonSignals) {
    score += 1;
  }

  if (signals.hasNoResultsLanguage) {
    score -= 2;
  }

  if (expectations.wantsItems && signals.itemCount < Math.max(1, expectations.minItems - 2)) {
    score -= 1.5;
  }

  return clampScore(score);
}

function scoreTrustworthiness(signals, expectations) {
  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2.5;
  }

  let score = 5.5;

  if (expectations.wantsAbsoluteDates) {
    score += signals.hasAbsoluteDates ? 2 : -2.5;
  }

  if (expectations.wantsMetrics) {
    score += signals.hasMetrics ? 1.5 : -2;
  }

  if (expectations.wantsPrice) {
    score += signals.hasPrice ? 0.75 : -1;
  }

  if (signals.repeatedLines) {
    score -= 2.5;
  }

  if (signals.hasNoResultsLanguage) {
    score -= 1.5;
  }

  if (signals.hasCaveatSignals) {
    score += 0.5;
  }

  return clampScore(score);
}

function scoreDecisionValue(params) {
  const { completeness, expectations, relevance, signals, trustworthiness } = params;

  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2;
  }

  let score = completeness * 0.4 + relevance * 0.2 + trustworthiness * 0.4;

  if (expectations.wantsItems && signals.itemCount < expectations.minItems) {
    score -= 1;
  }

  if (signals.hasNoResultsLanguage) {
    score -= 1;
  }

  if (signals.wordCount < 25) {
    score -= 1;
  }

  return clampScore(score);
}

function scoreGrace(signals, expectations) {
  if (signals.status === 'visible_error') {
    return 1;
  }

  if (signals.status === 'incomplete') {
    return 2;
  }

  let score = 5;

  if (signals.hasNoResultsLanguage) {
    score = signals.hasCaveatSignals ? 5.5 : 2.5;
  } else if (signals.hasCaveatSignals) {
    score += expectations.broadPrompt ? 2 : 1;
  }

  if (signals.wordCount >= 60) {
    score += 1;
  }

  if (signals.wordCount < 20) {
    score -= 1.5;
  }

  return clampScore(score);
}

function buildQualityNotes(signals, expectations) {
  const notes = [];

  if (signals.status === 'visible_error') {
    notes.push('The chat UI showed a visible error instead of a usable answer.');
  } else if (signals.status === 'incomplete') {
    notes.push('The chat response did not complete cleanly in the browser UI.');
  }

  if (expectations.wantsItems && signals.itemCount < expectations.minItems) {
    notes.push(
      `Coverage feels thin for a list-style prompt: only ${signals.itemCount} visible item${signals.itemCount === 1 ? '' : 's'}.`
    );
  }

  if (expectations.wantsAbsoluteDates && !signals.hasAbsoluteDates) {
    notes.push('The answer did not ground a time-relative prompt with absolute dates.');
  }

  if (expectations.wantsMetrics && !signals.hasMetrics) {
    notes.push('The answer lacks enough visible metric detail for the prompt.');
  }

  if (expectations.wantsReasons && !signals.hasReasonSignals) {
    notes.push('The answer gives little visible explanation for why the returned matches belong.');
  }

  if (signals.hasNoResultsLanguage) {
    notes.push('The answer collapsed into a no-results or no-match response.');
  }

  if (signals.repeatedLines) {
    notes.push('Repeated or templated phrasing reduces trust in the answer.');
  }

  if (
    signals.wordCount >= 60 &&
    signals.expectationCoverage >= 0.75 &&
    !signals.hasNoResultsLanguage &&
    !signals.repeatedLines
  ) {
    notes.push('The visible answer is well-supported and close to decision-ready for the blended persona.');
  }

  if (signals.latencyMs !== null && signals.latencyMs >= 1000) {
    notes.push(`Visible latency was ${formatLatencyMs(signals.latencyMs)}.`);
  }

  return notes.slice(0, 5);
}

function buildUsefulnessSummary(params) {
  const { draftScore, expectations, qualityNotes, signals, verdict } = params;

  if (signals.status === 'visible_error') {
    return 'The UI failed visibly instead of delivering a usable answer.';
  }

  if (signals.status === 'incomplete') {
    return 'The answer started, but the visible browser flow did not complete cleanly.';
  }

  if (signals.hasNoResultsLanguage && !signals.hasCaveatSignals) {
    return 'The answer stays visible, but it dead-ends instead of helping the user recover.';
  }

  if (draftScore >= 8.5) {
    return 'The answer is decision-ready, grounded, and strong enough for the blended PublisherIQ persona.';
  }

  if (draftScore >= 7) {
    return 'The answer is useful and mostly trustworthy, but it still leaves meaningful coverage or grounding gaps.';
  }

  if (draftScore >= 5.5) {
    return 'The answer is directionally useful, but thin coverage or missing support limits confidence.';
  }

  if (draftScore >= 4) {
    return expectations.wantsItems
      ? 'The answer responds to the prompt, but it is too thin or weakly supported to trust.'
      : 'The answer is present, but it lacks enough support to be decision-useful.';
  }

  return `The visible answer falls below the trust bar for a ${verdict.toLowerCase()} result.`;
}

function buildScenarioSummary(params) {
  const { carryForward, draftScore, verdict } = params;

  if (draftScore >= 8.5) {
    return 'The multi-turn flow stays coherent in the browser and remains decision-ready across turns.';
  }

  if (draftScore >= 7) {
    return carryForward.label === 'preserved'
      ? 'The multi-turn flow is mostly useful, and visible carry-forward behavior stays intact.'
      : 'The multi-turn flow is useful, but some continuity cues are weaker than they should be.';
  }

  if (draftScore >= 5.5) {
    return 'The multi-turn flow partly works, but continuity or supporting detail degrades across turns.';
  }

  if (draftScore >= 4) {
    return 'The multi-turn flow is visible, but context carry-forward or answer quality is too weak to trust.';
  }

  return `The multi-turn browser flow is a ${verdict.toLowerCase()} from the blended persona perspective.`;
}

function evaluateCarryForwardQuality(turns) {
  const notes = [];
  let ambiguousFollowUps = 0;
  let preservedCount = 0;

  for (let index = 1; index < turns.length; index += 1) {
    const turn = turns[index];
    if (!isAmbiguousFollowUp(turn.userPrompt)) {
      continue;
    }

    ambiguousFollowUps += 1;
    const priorAnchors = extractAnchors(
      turns
        .slice(0, index)
        .flatMap((previousTurn) => [previousTurn.userPrompt, previousTurn.responseText])
        .join(' ')
    );

    const responseText = String(turn.responseText || '');
    const preserved = [...priorAnchors].some((anchor) =>
      responseText.toLowerCase().includes(anchor.toLowerCase())
    );

    if (preserved) {
      preservedCount += 1;
    }
  }

  if (ambiguousFollowUps === 0) {
    return {
      adjustment: 0,
      label: 'not_applicable',
      notes,
    };
  }

  if (preservedCount === ambiguousFollowUps) {
    notes.push('Visible carry-forward looks preserved across ambiguous follow-up turns.');
    return {
      adjustment: 0.5,
      label: 'preserved',
      notes,
    };
  }

  if (preservedCount > 0) {
    notes.push('Visible carry-forward is mixed: some follow-ups stay anchored, but not all of them do.');
    return {
      adjustment: 0,
      label: 'mixed',
      notes,
    };
  }

  notes.push('Visible carry-forward looks weak on ambiguous follow-up turns.');
  return {
    adjustment: -1,
    label: 'weak',
    notes,
  };
}

function isAmbiguousFollowUp(promptText) {
  const prompt = String(promptText || '').trim();
  return AMBIGUOUS_FOLLOW_UP_PATTERN.test(prompt) || prompt.split(/\s+/).filter(Boolean).length <= 6;
}

function extractAnchors(text) {
  const matches = text.match(TITLE_CASE_PATTERN) ?? [];
  const anchors = new Set();

  for (const match of matches) {
    const value = match.trim();
    if (!value || value.length < 3) {
      continue;
    }

    if (/^(Which|What|Show|Find|Games|Game|Publishers|Developers|Compare|Steam)$/i.test(value)) {
      continue;
    }

    anchors.add(value);
  }

  return anchors;
}

function deriveItemCount(metrics, text) {
  const tableRows = Number(metrics.tableRowCount || 0);
  const listItems = Number(metrics.listItemCount || 0);
  const linkCount = Number(metrics.linkCount || 0);

  if (tableRows > 0 || listItems > 0) {
    return Math.max(tableRows, listItems);
  }

  if (linkCount >= 2) {
    return Math.min(linkCount, 10);
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLikeLines = lines.filter((line) => /^[-*•]|\d+\./.test(line)).length;
  if (bulletLikeLines > 0) {
    return bulletLikeLines;
  }

  return 0;
}

function calculateExpectationCoverage(expectations, coverage) {
  const checks = [];

  if (expectations.wantsItems) {
    checks.push(coverage.itemCount >= expectations.minItems ? 1 : coverage.itemCount > 0 ? 0.5 : 0);
  }

  if (expectations.wantsAbsoluteDates) {
    checks.push(coverage.hasAbsoluteDates ? 1 : 0);
  }

  if (expectations.wantsMetrics) {
    checks.push(coverage.hasMetrics ? 1 : 0);
  }

  if (expectations.wantsPrice) {
    checks.push(coverage.hasPrice ? 1 : 0);
  }

  if (expectations.wantsReasons) {
    checks.push(coverage.hasReasons ? 1 : 0);
  }

  if (expectations.wantsSteamDeck) {
    checks.push(coverage.hasSteamDeck ? 1 : 0);
  }

  if (checks.length === 0) {
    return 1;
  }

  return checks.reduce((sum, value) => sum + value, 0) / checks.length;
}

function countDuplicateLines(lines) {
  const counts = new Map();
  for (const line of lines) {
    if (line.length < 20) {
      continue;
    }
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  let duplicates = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      duplicates += count - 1;
    }
  }

  return duplicates;
}

function countPatternHits(text, pattern) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  return matches?.length ?? 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(10, value));
}

function roundScore(value) {
  return Math.round(clampScore(value) * 10) / 10;
}
