import { formatLatencyMs, getVerdictForScore } from './blended-persona-scoring.mjs';

const MONTH_PATTERN =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const INTERNAL_LANGUAGE_PATTERN =
  /\b(?:qdrant|supabase|cube|contract|fallback|route|tool(?:ing)?|query api|query-api|database|legacy fallback)\b/i;
const UNSUPPORTED_PATTERN =
  /\b(?:couldn't route|does not support|doesn't support|not support|unsupported)\b/i;
const DUPLICATE_LINE_MIN_LENGTH = 24;
const PRICE_PATTERN = /\$([0-9]+(?:\.[0-9]{1,2})?)/g;
const METRIC_KEYWORD_PATTERN = /\b(?:review|reviews|review %|ccu|owners|player|players|peak ccu|price|released?|publisher|developer)\b/i;
const REASON_PATTERN =
  /\b(?:because|why it fits|why it matches|why included|shares|similar|fits|match(?:es|ing)?)\b/i;
const TIME_SENSITIVE_PATTERN =
  /\b(?:right now|today|this week|this month|this year|last \d+ days|past \d+ days|lately|recent|recently)\b/i;
const STEAM_DECK_PATTERN = /\b(?:steam deck|verified|playable|unsupported)\b/i;
const SOULS_LIKE_PATTERN = /\bsouls-?like\b/i;
const GENERIC_FILLER_PATTERN =
  /\b(?:these games share|these publishers share|these developers share|making them great options|enjoy exploring these titles)\b/i;

const SOFT_SIGNAL_AREAS = new Set(['relevance-curation', 'tone-templating']);
const FAMILY_MIN_ITEMS = {
  change_cross_game: 3,
  change_pattern: 3,
  company_ranking: 5,
  company_similarity: 4,
  concept_search: 5,
  developer_similarity: 4,
  filtered_discovery: 5,
  game_similarity: 5,
  publisher_similarity: 4,
  trend_ranking: 5,
  trend_screen: 5,
};

export function assessPromptReview(params) {
  const {
    diagnostics,
    latencyMs,
    promptRow,
    responseMetrics,
    responseText,
    routeMetadata,
    status,
  } = params;
  const promptText = String(promptRow?.prompt || '');
  const text = String(responseText || '').trim();
  const normalizedText = normalizeText(text);
  const metrics = responseMetrics || {};
  const itemCount = inferItemCount(metrics, text);
  const issues = new Set();
  const confidenceReasons = [];
  const hardSignalCount = countHardSignals(promptRow);
  const routeReview = inspectRouteReview(promptRow, routeMetadata, diagnostics);
  const entityTargets = deriveEntityTargets(promptText);

  let dataQualityScore = status === 'success' ? 8.4 : 4.2;
  let toneScore = status === 'success' ? 8.1 : 4.5;

  if (!text) {
    dataQualityScore -= 3.5;
    toneScore -= 2.5;
    issues.add('unsupported-recovery');
  }

  if (status !== 'success') {
    dataQualityScore -= 2.3;
    toneScore -= 1.4;
    issues.add('unsupported-recovery');
  }

  if (routeReview.routeMismatch) {
    dataQualityScore -= 2.1;
    issues.add('route-contract');
  }

  if (routeReview.missingContracts) {
    dataQualityScore -= 1.8;
    issues.add('route-contract');
  }

  if (routeReview.internalRouteLeak) {
    dataQualityScore -= 1.1;
    toneScore -= 1.8;
    issues.add('route-contract');
    issues.add('tone-templating');
  }

  const missingAnchors = findMissingAnchors(promptRow?.factualAnchors, text);
  if (missingAnchors.length > 0) {
    dataQualityScore -= Math.min(2.2, 0.8 + missingAnchors.length * 0.45);
    issues.add('entity-resolution');
  }

  const presentAntiAnchors = findPresentAnchors(promptRow?.antiAnchors, text);
  if (presentAntiAnchors.length > 0) {
    dataQualityScore -= Math.min(2.5, 0.9 + presentAntiAnchors.length * 0.45);
    toneScore -= 0.8;
    issues.add('entity-resolution');
  }

  if (requiresTimeGrounding(promptText, promptRow?.family) && !hasAbsoluteDate(text)) {
    dataQualityScore -= 1.1;
    issues.add('time-grounding');
  }

  if (expectsMetricLanguage(promptText) && !hasMetricLanguage(text)) {
    dataQualityScore -= 1.2;
    issues.add('metric-labeling');
  }

  if (expectsSteamDeck(promptText) && !STEAM_DECK_PATTERN.test(text)) {
    dataQualityScore -= 1.2;
    issues.add('constraint-integrity');
  }

  const priceConstraintFailure = detectPriceConstraintFailure(promptText, text);
  if (priceConstraintFailure) {
    dataQualityScore -= 2.2;
    issues.add('constraint-integrity');
  }

  if (/\bsame series\b/i.test(promptText) && SOULS_LIKE_PATTERN.test(text)) {
    dataQualityScore -= 1.5;
    issues.add('constraint-integrity');
  }

  const minItems = FAMILY_MIN_ITEMS[promptRow?.family] || 0;
  if (minItems > 0 && itemCount > 0 && itemCount < minItems) {
    dataQualityScore -= itemCount <= 2 ? 1.8 : 1.1;
    issues.add('relevance-curation');
  }

  if (shouldExpectReasons(promptText, promptRow?.family) && !REASON_PATTERN.test(text)) {
    dataQualityScore -= 0.9;
    issues.add('relevance-curation');
  }

  if (entityTargets.length > 0 && !allEntityTargetsPresent(entityTargets, normalizedText)) {
    dataQualityScore -= 1.2;
    issues.add('entity-resolution');
  }

  if (UNSUPPORTED_PATTERN.test(text) && promptRow?.expectedBehavior !== 'unsupported') {
    dataQualityScore -= 1.8;
    toneScore -= 1.1;
    issues.add('unsupported-recovery');
  }

  if (INTERNAL_LANGUAGE_PATTERN.test(text)) {
    dataQualityScore -= 1.0;
    toneScore -= 1.9;
    issues.add('tone-templating');
  }

  const duplicateLineCount = countDuplicateLines(text);
  if (duplicateLineCount > 0) {
    toneScore -= Math.min(1.8, 0.7 + duplicateLineCount * 0.35);
    issues.add('tone-templating');
  }

  if (GENERIC_FILLER_PATTERN.test(text)) {
    toneScore -= 0.8;
    issues.add('tone-templating');
  }

  const wordCount = countWords(text);
  if (wordCount > 0 && wordCount < 28) {
    toneScore -= 1.0;
    issues.add('tone-templating');
  } else if (wordCount > 240) {
    toneScore -= 0.8;
    issues.add('tone-templating');
  }

  if (metrics.tableRowCount > 0 && countSentenceLikeLines(text) < 2) {
    toneScore -= 0.8;
    issues.add('tone-templating');
  }

  const latencyVerdict = determineLatencyVerdict(latencyMs, promptRow?.latencyBudgetMs);
  if (latencyVerdict === 'warning') {
    issues.add('latency');
  }
  if (latencyVerdict === 'slow' || latencyVerdict === 'over_budget') {
    dataQualityScore -= 0.4;
    toneScore -= 0.2;
    issues.add('latency');
  }

  dataQualityScore = clampScore(dataQualityScore);
  toneScore = clampScore(toneScore);

  if (isNearVerdictBoundary(dataQualityScore) || isNearVerdictBoundary(toneScore)) {
    confidenceReasons.push('score_near_boundary');
  }
  if (hardSignalCount < 2 && [...issues].every((issue) => SOFT_SIGNAL_AREAS.has(issue))) {
    confidenceReasons.push('soft_signal_only');
  }
  if (minItems > 0 && itemCount > 0 && Math.abs(itemCount - minItems) <= 1) {
    confidenceReasons.push('borderline_coverage');
  }
  if (missingAnchors.length > 0 && presentAntiAnchors.length === 0 && routeReview.hadHardRouteSignals === false) {
    confidenceReasons.push('missing_entity_but_no_route_signal');
  }

  const reviewConfidence =
    confidenceReasons.length >= 2
      ? 'low'
      : confidenceReasons.length === 1
        ? 'medium'
        : 'high';

  return {
    dataQualityScore,
    dataQualityVerdict: getVerdictForScore(dataQualityScore),
    improvementAreas: [...issues].sort(),
    latencyVerdict,
    reviewConfidence,
    reviewConfidenceReasons: confidenceReasons,
    suggestedFixTarget: suggestFixTarget(issues),
    toneScore,
    toneVerdict: getVerdictForScore(toneScore),
  };
}

export function buildPromptReviewArtifacts(params) {
  const { promptResults, scenarioResults, runSummary } = params;
  const promptRows = promptResults.map((result) => buildPromptReviewMatrixRow(result));
  const seedRows = promptRows.filter((row) => !row.isVariant);
  const variantRows = promptRows.filter((row) => row.isVariant);
  const calibrationQueue = promptRows
    .filter((row) => row.reviewConfidence === 'low')
    .sort(compareWeakestRows)
    .map((row) => ({
      critiqueId: row.critiqueId,
      dataQualityScore: row.dataQualityScore,
      improvementAreas: row.improvementAreas,
      inventoryName: row.inventoryName,
      prompt: row.prompt,
      reviewConfidence: row.reviewConfidence,
      reviewConfidenceReasons: row.reviewConfidenceReasons,
      seedPromptId: row.seedPromptId,
      suggestedFixTarget: row.suggestedFixTarget,
      toneScore: row.toneScore,
      variantKey: row.variantKey,
    }));
  const latencyHotspots = buildLatencyHotspots({
    promptResults,
    scenarioResults,
  });
  const reviewSummary = {
    calibrationQueueCount: calibrationQueue.length,
    promptDataQualityAverage: roundToTenth(averageOf(promptRows.map((row) => row.dataQualityScore))),
    promptToneAverage: roundToTenth(averageOf(promptRows.map((row) => row.toneScore))),
    seedPromptCount: seedRows.length,
    slowPromptCount: latencyHotspots.promptHotspots.length,
    variantPromptCount: variantRows.length,
  };

  return {
    calibrationQueue,
    latencyHotspots,
    latencyHotspotsMarkdown: renderLatencyHotspotsMarkdown({
      latencyHotspots,
      runSummary,
    }),
    promptReviewMatrix: promptRows,
    promptReviewMatrixMarkdown: renderPromptReviewMatrixMarkdown({
      calibrationQueue,
      promptRows,
      reviewSummary,
      runSummary,
      seedRows,
      variantRows,
    }),
    reviewSummary,
  };
}

function buildPromptReviewMatrixRow(result) {
  return {
    critiqueId: result.critiqueId,
    dataQualityScore: result.dataQualityScore,
    dataQualityVerdict: result.dataQualityVerdict,
    draftScore: result.draftScore,
    family: result.family,
    improvementAreas: result.improvementAreas || [],
    inventoryName: result.inventoryName || result.sourceInventory || 'unknown',
    isVariant: result.isVariant === true,
    latencyMs: result.visibleLatencyMs ?? result.latencyMs ?? null,
    latencyText: result.visibleLatencyText || result.latencyText || formatLatencyMs(result.visibleLatencyMs ?? result.latencyMs),
    latencyVerdict: result.latencyVerdict || 'unknown',
    priority: result.priority || null,
    prompt: result.prompt,
    reviewConfidence: result.reviewConfidence || 'medium',
    reviewConfidenceReasons: result.reviewConfidenceReasons || [],
    seedPromptId: result.seedPromptId || String(result.critiqueId),
    sourceInventory: result.sourceInventory || result.inventoryName || 'unknown',
    status: result.status,
    suggestedFixTarget: result.suggestedFixTarget || null,
    toneScore: result.toneScore,
    toneVerdict: result.toneVerdict,
    variantKey: result.variantKey || null,
    verdict: result.verdict,
    visibleLatencyMs: result.visibleLatencyMs ?? result.latencyMs ?? null,
  };
}

function buildLatencyHotspots(params) {
  const promptHotspots = [...params.promptResults]
    .filter((result) => ['warning', 'slow', 'over_budget'].includes(result.latencyVerdict))
    .sort(compareLatencyRows)
    .map((result) => ({
      critiqueId: result.critiqueId,
      inventoryName: result.inventoryName || result.sourceInventory || 'unknown',
      isVariant: result.isVariant === true,
      latencyBudgetMs: result.latencyBudgetMs ?? null,
      latencyMs: result.visibleLatencyMs ?? result.latencyMs ?? null,
      latencyText: result.visibleLatencyText || result.latencyText || '-',
      latencyVerdict: result.latencyVerdict,
      prompt: result.prompt,
      status: result.status,
      variantKey: result.variantKey || null,
    }));
  const scenarioHotspots = [...params.scenarioResults]
    .map((scenario) => {
      const totalLatencyMs = scenario.turns.reduce(
        (sum, turn) => sum + (turn.visibleLatencyMs ?? turn.latencyMs ?? 0),
        0
      );
      return {
        inventoryName: scenario.inventoryName || scenario.sourceInventory || 'unknown',
        latencyBudgetMs: scenario.latencyBudgetMs ?? null,
        latencyMs: totalLatencyMs,
        latencyText: formatLatencyMs(totalLatencyMs),
        latencyVerdict: determineLatencyVerdict(totalLatencyMs, scenario.latencyBudgetMs ?? null),
        scenarioId: scenario.scenarioId,
        scenarioName: scenario.scenarioName,
        status: scenario.status,
      };
    })
    .filter((row) => ['warning', 'slow', 'over_budget'].includes(row.latencyVerdict))
    .sort(compareLatencyRows);

  return {
    promptHotspots,
    scenarioHotspots,
    summary: {
      promptP50Ms: percentile(
        params.promptResults
          .map((result) => result.visibleLatencyMs ?? result.latencyMs)
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => left - right),
        0.5
      ),
      promptP95Ms: percentile(
        params.promptResults
          .map((result) => result.visibleLatencyMs ?? result.latencyMs)
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => left - right),
        0.95
      ),
      scenarioP50Ms: percentile(
        params.scenarioResults
          .map((scenario) =>
            scenario.turns.reduce((sum, turn) => sum + (turn.visibleLatencyMs ?? turn.latencyMs ?? 0), 0)
          )
          .sort((left, right) => left - right),
        0.5
      ),
      scenarioP95Ms: percentile(
        params.scenarioResults
          .map((scenario) =>
            scenario.turns.reduce((sum, turn) => sum + (turn.visibleLatencyMs ?? turn.latencyMs ?? 0), 0)
          )
          .sort((left, right) => left - right),
        0.95
      ),
    },
  };
}

function renderPromptReviewMatrixMarkdown(params) {
  const { calibrationQueue, promptRows, reviewSummary, runSummary, seedRows, variantRows } = params;
  const lines = [
    '# Prompt Review Matrix',
    '',
    `- Generated: ${runSummary.generatedAt}`,
    `- Inventory: ${runSummary.inventoryName}`,
    `- Seed prompts: ${reviewSummary.seedPromptCount}`,
    `- Variant prompts: ${reviewSummary.variantPromptCount}`,
    `- Avg data quality: ${reviewSummary.promptDataQualityAverage}/10`,
    `- Avg tone: ${reviewSummary.promptToneAverage}/10`,
    `- Calibration queue: ${reviewSummary.calibrationQueueCount}`,
    '',
    '## Seed Prompts',
    '',
    '| ID | Inventory | Family | Data | Tone | Overall | Latency | Confidence | Fix Target | Improvement Areas | Prompt |',
    '|---|---|---|---:|---:|---:|---|---|---|---|---|',
  ];

  for (const row of [...seedRows].sort(compareWeakestRows)) {
    lines.push(renderPromptReviewTableRow(row));
  }

  lines.push('', '## Variant Prompts', '', '| ID | Inventory | Family | Data | Tone | Overall | Latency | Confidence | Fix Target | Improvement Areas | Prompt |', '|---|---|---|---:|---:|---:|---|---|---|---|---|');

  if (variantRows.length === 0) {
    lines.push('| - | - | - | - | - | - | - | - | - | - | No variants in this run |');
  } else {
    for (const row of [...variantRows].sort(compareWeakestRows)) {
      lines.push(renderPromptReviewTableRow(row));
    }
  }

  lines.push('', '## Calibration Queue', '', '| ID | Confidence Reasons | Improvement Areas | Prompt |', '|---|---|---|---|');
  if (calibrationQueue.length === 0) {
    lines.push('| - | - | - | No low-confidence prompts in this run |');
  } else {
    for (const row of calibrationQueue) {
      lines.push(
        `| ${escapeTable(row.critiqueId)} | ${escapeTable(row.reviewConfidenceReasons.join(', ') || '-')} | ${escapeTable(row.improvementAreas.join(', ') || '-')} | ${escapeTable(row.prompt)} |`
      );
    }
  }

  if (promptRows.length === 0) {
    lines.push('', 'No prompts were evaluated in this run.');
  }

  return `${lines.join('\n')}\n`;
}

function renderPromptReviewTableRow(row) {
  return `| ${escapeTable(row.critiqueId)} | ${escapeTable(row.inventoryName)} | ${escapeTable(row.family)} | ${Number(row.dataQualityScore ?? 0).toFixed(1)} | ${Number(row.toneScore ?? 0).toFixed(1)} | ${Number(row.draftScore ?? 0).toFixed(1)} | ${escapeTable(`${row.latencyText || '-'} (${row.latencyVerdict || 'unknown'})`)} | ${escapeTable(row.reviewConfidence)} | ${escapeTable(row.suggestedFixTarget || '-')} | ${escapeTable((row.improvementAreas || []).join(', ') || '-')} | ${escapeTable(row.prompt)} |`;
}

function renderLatencyHotspotsMarkdown(params) {
  const { latencyHotspots, runSummary } = params;
  const lines = [
    '# Latency Hotspots',
    '',
    `- Generated: ${runSummary.generatedAt}`,
    `- Inventory: ${runSummary.inventoryName}`,
    `- Prompt p50: ${formatLatencyMs(latencyHotspots.summary.promptP50Ms) || '-'}`,
    `- Prompt p95: ${formatLatencyMs(latencyHotspots.summary.promptP95Ms) || '-'}`,
    `- Scenario p50: ${formatLatencyMs(latencyHotspots.summary.scenarioP50Ms) || '-'}`,
    `- Scenario p95: ${formatLatencyMs(latencyHotspots.summary.scenarioP95Ms) || '-'}`,
    '',
    '## Prompt Hotspots',
    '',
    '| ID | Inventory | Latency | Budget | Verdict | Status | Prompt |',
    '|---|---|---:|---:|---|---|---|',
  ];

  if (latencyHotspots.promptHotspots.length === 0) {
    lines.push('| - | - | - | - | - | - | No prompt hotspots |');
  } else {
    for (const row of latencyHotspots.promptHotspots) {
      lines.push(
        `| ${escapeTable(row.critiqueId)} | ${escapeTable(row.inventoryName)} | ${escapeTable(row.latencyText || '-')} | ${escapeTable(formatLatencyMs(row.latencyBudgetMs) || '-')} | ${escapeTable(row.latencyVerdict)} | ${escapeTable(row.status || '-')} | ${escapeTable(row.prompt)} |`
      );
    }
  }

  lines.push('', '## Scenario Hotspots', '', '| Scenario | Inventory | Latency | Budget | Verdict | Status |', '|---|---|---:|---:|---|---|');

  if (latencyHotspots.scenarioHotspots.length === 0) {
    lines.push('| - | - | - | - | - | No scenario hotspots |');
  } else {
    for (const row of latencyHotspots.scenarioHotspots) {
      lines.push(
        `| ${escapeTable(row.scenarioName)} | ${escapeTable(row.inventoryName)} | ${escapeTable(row.latencyText || '-')} | ${escapeTable(formatLatencyMs(row.latencyBudgetMs) || '-')} | ${escapeTable(row.latencyVerdict)} | ${escapeTable(row.status || '-')} |`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function inspectRouteReview(promptRow, routeMetadata, diagnostics) {
  const primaryRoute = routeMetadata?.tigerPrimary?.route ?? null;
  const observedContracts = new Set(
    (routeMetadata?.tigerPrimary?.attempts || [])
      .map((attempt) => String(attempt?.contractName || '').trim())
      .filter(Boolean)
  );
  for (const entry of diagnostics?.executionTrace || []) {
    if (entry?.kind === 'contract' && entry?.readOccurred !== false && entry?.name) {
      observedContracts.add(String(entry.name).trim());
    }
  }

  const expectedRoutes = Array.isArray(promptRow?.expectedRoutes) ? promptRow.expectedRoutes : [];
  const expectedContracts = Array.isArray(promptRow?.expectedContracts) ? promptRow.expectedContracts : [];
  const routeMismatch =
    expectedRoutes.length > 0
      ? !expectedRoutes.includes(String(primaryRoute || ''))
      : false;
  const missingContracts =
    expectedContracts.length > 0
      ? expectedContracts.some((contract) => !observedContracts.has(String(contract)))
      : false;

  return {
    hadHardRouteSignals: expectedRoutes.length > 0 || expectedContracts.length > 0,
    internalRouteLeak:
      INTERNAL_LANGUAGE_PATTERN.test(String(diagnostics?.errorMessage || ''))
      || INTERNAL_LANGUAGE_PATTERN.test(String(routeMetadata?.tigerPrimary?.matchedIntent || '')),
    missingContracts,
    routeMismatch,
  };
}

function deriveEntityTargets(promptText) {
  const prompt = String(promptText || '').trim();
  const patterns = [
    /\bcompare\s+(.+?)\s+(?:and|to)\s+(.+?)(?:\s+by\s+.+)?$/i,
    /\btell me about\s+(.+)$/i,
    /\b(?:games?|titles?)\s+by\s+(.+)$/i,
    /\bsimilar to\s+(.+)$/i,
    /\blike\s+(.+?)(?:\s+but|\s+with|\s+under|\s+over|$)/i,
    /\babout\s+(.+)$/i,
    /\bchanged on\s+(.+?)(?:\s+before|\s+in the last|\s+lately|$)/i,
    /\bannouncements about\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) {
      continue;
    }
    return match
      .slice(1)
      .flatMap((value) => String(value || '').split(/\s+and\s+|\s*,\s*/))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

function allEntityTargetsPresent(entityTargets, normalizedText) {
  return entityTargets.every((target) => {
    const normalizedTarget = normalizeText(target);
    if (!normalizedTarget) {
      return true;
    }

    if (normalizedText.includes(normalizedTarget)) {
      return true;
    }

    const targetTokens = normalizedTarget
      .split(' ')
      .filter((token) => token.length >= 4);
    if (targetTokens.length === 0) {
      return false;
    }

    return targetTokens.every((token) => normalizedText.includes(token));
  });
}

function inferItemCount(metrics, text) {
  const metricCount = Math.max(
    Number(metrics?.tableRowCount || 0),
    Number(metrics?.listItemCount || 0)
  );
  if (metricCount > 0) {
    return metricCount;
  }

  const candidateLines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\||^- |^\d+\./.test(line));
  return candidateLines.length;
}

function countHardSignals(promptRow) {
  return [
    Array.isArray(promptRow?.expectedRoutes) && promptRow.expectedRoutes.length > 0,
    Array.isArray(promptRow?.expectedContracts) && promptRow.expectedContracts.length > 0,
    Array.isArray(promptRow?.factualAnchors) && promptRow.factualAnchors.length > 0,
    Array.isArray(promptRow?.antiAnchors) && promptRow.antiAnchors.length > 0,
    Boolean(promptRow?.latencyBudgetMs),
  ].filter(Boolean).length;
}

function requiresTimeGrounding(promptText, family) {
  return TIME_SENSITIVE_PATTERN.test(promptText) || String(family || '').startsWith('change_') || String(family || '').startsWith('trend_');
}

function expectsMetricLanguage(promptText) {
  return /\b(?:players?|ccu|owners?|reviews?|review velocity|price|published|released|momentum)\b/i.test(promptText);
}

function expectsSteamDeck(promptText) {
  return /\bsteam deck\b/i.test(promptText);
}

function hasAbsoluteDate(text) {
  return MONTH_PATTERN.test(text) || ISO_DATE_PATTERN.test(text);
}

function hasMetricLanguage(text) {
  return METRIC_KEYWORD_PATTERN.test(text);
}

function shouldExpectReasons(promptText, family) {
  return /\b(?:similar|like|cozy|beautiful art|investigation|horror|tactical|roguelike|roguelites?)\b/i.test(promptText)
    || ['concept_search', 'game_similarity', 'company_similarity', 'developer_similarity', 'publisher_similarity'].includes(String(family || ''));
}

function detectPriceConstraintFailure(promptText, responseText) {
  const match = String(promptText || '').match(/\bunder \$([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!match) {
    return false;
  }

  const limit = Number(match[1]);
  return [...String(responseText || '').matchAll(PRICE_PATTERN)].some((priceMatch) => Number(priceMatch[1]) > limit);
}

function findMissingAnchors(anchors, text) {
  return coerceStringArray(anchors).filter((anchor) => !normalizeText(text).includes(normalizeText(anchor)));
}

function findPresentAnchors(anchors, text) {
  return coerceStringArray(anchors).filter((anchor) => normalizeText(text).includes(normalizeText(anchor)));
}

function countDuplicateLines(text) {
  const counts = new Map();
  for (const line of String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= DUPLICATE_LINE_MIN_LENGTH)) {
    const normalized = normalizeText(line);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.values()].filter((count) => count > 1).length;
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countSentenceLikeLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[.!?]$/.test(line)).length;
}

function determineLatencyVerdict(latencyMs, latencyBudgetMs) {
  if (!Number.isFinite(latencyMs)) {
    return 'unknown';
  }

  if (Number.isFinite(latencyBudgetMs) && latencyBudgetMs > 0) {
    if (latencyMs <= latencyBudgetMs) {
      return 'within_budget';
    }
    if (latencyMs <= latencyBudgetMs * 1.2) {
      return 'warning';
    }
    return 'over_budget';
  }

  if (latencyMs <= 10_000) {
    return 'within_budget';
  }
  if (latencyMs <= 18_000) {
    return 'warning';
  }
  return 'slow';
}

function suggestFixTarget(issues) {
  const issueSet = new Set(issues);
  if (issueSet.has('latency')) {
    return 'latency-path';
  }
  if (issueSet.has('follow-up-state')) {
    return 'session-state';
  }
  if (issueSet.has('route-contract')) {
    return 'tool-contract';
  }
  if (issueSet.has('constraint-integrity') || issueSet.has('relevance-curation')) {
    return 'ranking-curation';
  }
  if (issueSet.has('tone-templating') && issueSet.size === 1) {
    return 'narrator';
  }
  if (
    issueSet.has('entity-resolution')
    || issueSet.has('metric-labeling')
    || issueSet.has('time-grounding')
    || issueSet.has('unsupported-recovery')
  ) {
    return 'system-prompt';
  }
  if (issueSet.has('tone-templating')) {
    return 'narrator';
  }
  return 'system-prompt';
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1));
  return values[index];
}

function compareWeakestRows(left, right) {
  if (left.dataQualityScore !== right.dataQualityScore) {
    return left.dataQualityScore - right.dataQualityScore;
  }
  if (left.toneScore !== right.toneScore) {
    return left.toneScore - right.toneScore;
  }
  return (right.visibleLatencyMs ?? 0) - (left.visibleLatencyMs ?? 0);
}

function compareLatencyRows(left, right) {
  const severityOrder = {
    over_budget: 3,
    slow: 2,
    warning: 1,
    within_budget: 0,
    unknown: -1,
  };
  if ((severityOrder[right.latencyVerdict] || 0) !== (severityOrder[left.latencyVerdict] || 0)) {
    return (severityOrder[right.latencyVerdict] || 0) - (severityOrder[left.latencyVerdict] || 0);
  }
  return (right.latencyMs ?? 0) - (left.latencyMs ?? 0);
}

function averageOf(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToTenth(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coerceStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function isNearVerdictBoundary(score) {
  const boundaries = [4, 5.5, 7, 8.5];
  return boundaries.some((boundary) => Math.abs(score - boundary) <= 0.35);
}

function clampScore(value) {
  return roundToTenth(Math.max(0, Math.min(10, value)));
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|');
}
