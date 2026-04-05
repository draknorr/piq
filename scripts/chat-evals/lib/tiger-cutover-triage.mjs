import fs from 'node:fs/promises';
import path from 'node:path';

import { summarizeTraceEntries } from './tool-backend-audit.mjs';

const CLARIFICATION_TEXT_PATTERN =
  /\b(?:which one did you mean|likely matches|i found (?:two|several|\d+) likely matches|please clarify|i matched this to)\b/i;
const UNSUPPORTED_TEXT_PATTERN =
  /\b(?:couldn't route|does not support|doesn't support|not support|unsupported)\b/i;

const CATEGORY_CONFIG = {
  routing: {
    owner: 'apps/admin/src/lib/chat/tiger-shadow.ts',
    title: 'Routing And Family Arbitration',
    broadFix:
      'Tighten intent-family arbitration so ranking, semantic, catalog, compare, and momentum prompts choose the right Tiger contract before any rendering happens.',
  },
  resolution: {
    owner: 'apps/admin/src/lib/chat/tiger-shadow.ts',
    title: 'Entity Resolution And Clarification Policy',
    broadFix:
      'Bias exact entity/title matches and clear portfolio prompts toward the strongest stable entity, and reserve clarification for genuinely close matches.',
  },
  answer_quality: {
    owner:
      'apps/admin/src/lib/chat/tiger-answer-brief.ts + apps/admin/src/lib/chat/tiger-primary-renderer.ts',
    title: 'Answer Shape And Narration Quality',
    broadFix:
      'Keep each prompt family on one evidence shape, ground time-relative answers with absolute dates, and make first turns and follow-ups share the same family-specific framing.',
  },
  unsupported_policy: {
    owner: 'apps/admin/src/app/api/chat/stream/handler.ts',
    title: 'Unsupported-Case Policy',
    broadFix:
      'Use one explicit Tiger-owned unsupported pattern that names the unsupported constraint and suggests the nearest supported reformulation.',
  },
  gate_or_manifest: {
    owner:
      'scripts/chat-evals/lib/tiger-cutover-gate.mjs + scripts/chat-evals/tiger-cutover-prompts.json',
    title: 'Gate Or Manifest',
    broadFix:
      'Fix artifact parsing or prompt expectations only when the observed Tiger route/contracts already show the runtime behavior is correct.',
  },
};

const CATEGORY_ORDER = [
  'routing',
  'resolution',
  'answer_quality',
  'unsupported_policy',
  'gate_or_manifest',
];

export async function writeTigerCutoverTriageArtifacts(params) {
  const { outDir } = params;
  const triage = buildTigerCutoverTriage(params);

  await fs.writeFile(
    path.join(outDir, 'tiger-cutover-triage.json'),
    `${JSON.stringify(triage, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'tiger-cutover-triage.md'),
    renderTigerCutoverTriageMarkdown(triage)
  );

  return triage;
}

export function buildTigerCutoverTriage(params) {
  const { gate, promptResults, scenarioResults } = params;
  const promptMap = new Map(promptResults.map((result) => [String(result.critiqueId), result]));
  const scenarioMap = new Map(scenarioResults.map((result) => [String(result.scenarioId), result]));

  const issueEntries = [
    ...gate.blockers.map((issue) => buildIssueEntry(issue, 'blocker', promptMap, scenarioMap)),
    ...gate.warnings.map((issue) => buildIssueEntry(issue, 'warning', promptMap, scenarioMap)),
  ];

  const tracks = buildFixTracks(issueEntries);

  return {
    blockers: gate.blockers.length,
    generatedAt: gate.generatedAt,
    inventoryName: gate.inventoryName,
    issues: issueEntries,
    overallPass: gate.overallPass,
    rankedFixTracks: tracks,
    warnings: gate.warnings.length,
  };
}

function buildIssueEntry(issue, level, promptMap, scenarioMap) {
  const context = resolveIssueContext(issue, promptMap, scenarioMap);
  const classification = classifyIssue(issue, context);

  return {
    category: classification.category,
    categoryTitle: CATEGORY_CONFIG[classification.category].title,
    expectedBehavior: context.expectedBehavior,
    expectedContracts: context.expectedContracts,
    expectedRoutes: context.expectedRoutes,
    family: context.family,
    findingType: classification.findingType,
    id: issue.id,
    issueType: issue.type,
    level,
    matchedIntent: context.matchedIntent,
    message: issue.message,
    observedContracts: context.observedContracts,
    owner: CATEGORY_CONFIG[classification.category].owner,
    prompt: context.prompt,
    rationale: classification.rationale,
    responseSnippet: context.responseSnippet,
    route: context.route,
    subsystem: classification.subsystem,
    traceContracts: context.traceContracts,
    traceDataSources: context.traceDataSources,
    triageDisposition: classification.findingType === 'harness_mismatch' ? 'harness' : 'runtime',
  };
}

function resolveIssueContext(issue, promptMap, scenarioMap) {
  if (issue.type === 'prompt') {
    return buildPromptContext(promptMap.get(String(issue.id)));
  }

  if (issue.type === 'scenario') {
    return buildScenarioContext(scenarioMap.get(String(issue.id)));
  }

  if (issue.type === 'scenario_turn') {
    const match = /^(.*):turn:(\d+)$/.exec(String(issue.id));
    if (match) {
      const scenario = scenarioMap.get(match[1]);
      const requestedTurnIndex = Number(match[2]);
      const turn = scenario?.turns?.find((entry) => Number(entry.turnIndex) === requestedTurnIndex)
        || scenario?.turns?.[requestedTurnIndex - 1]
        || null;

      return buildScenarioTurnContext(scenario, turn, requestedTurnIndex);
    }
  }

  return buildEmptyContext();
}

function buildPromptContext(result) {
  if (!result) {
    return buildEmptyContext();
  }

  const { observedContracts, traceSummary } = collectObservedContracts({
    attempts: result.routeMetadata?.tigerPrimary?.attempts,
    executionTrace: result.diagnostics?.executionTrace,
  });

  return {
    expectedBehavior: String(result.expectedBehavior || 'success'),
    expectedContracts: normalizeStringArray(result.expectedContracts),
    expectedRoutes: normalizeStringArray(result.expectedRoutes),
    family: String(result.family || 'unknown'),
    matchedIntent: result.routeMetadata?.tigerPrimary?.matchedIntent ?? null,
    observedContracts,
    prompt: String(result.prompt || ''),
    responseSnippet: buildResponseSnippet(result.responseText),
    route: result.routeMetadata?.tigerPrimary?.route ?? null,
    traceContracts: traceSummary.executedContracts || [],
    traceDataSources: traceSummary.dataSources || [],
  };
}

function buildScenarioContext(result) {
  if (!result) {
    return buildEmptyContext();
  }

  const turns = Array.isArray(result.turns) ? result.turns : [];
  const observedContracts = Array.from(
    new Set(
      turns.flatMap((turn) => collectObservedContracts({
        attempts: turn.routeMetadata?.tigerPrimary?.attempts,
        executionTrace: turn.diagnostics?.executionTrace,
      }).observedContracts)
    )
  ).sort((left, right) => left.localeCompare(right));

  const traceDataSources = Array.from(
    new Set(
      turns.flatMap((turn) => collectObservedContracts({
        attempts: turn.routeMetadata?.tigerPrimary?.attempts,
        executionTrace: turn.diagnostics?.executionTrace,
      }).traceSummary.dataSources || [])
    )
  ).sort((left, right) => left.localeCompare(right));

  return {
    expectedBehavior: 'success',
    expectedContracts: Array.from(
      new Set(turns.flatMap((turn) => normalizeStringArray(turn.expectedContracts)))
    ),
    expectedRoutes: Array.from(
      new Set(turns.flatMap((turn) => normalizeStringArray(turn.expectedRoutes)))
    ),
    family: inferScenarioFamily(result),
    matchedIntent: turns.at(-1)?.routeMetadata?.tigerPrimary?.matchedIntent ?? null,
    observedContracts,
    prompt: String(result.scenarioName || result.scenarioId || ''),
    responseSnippet: buildResponseSnippet(
      turns.map((turn) => String(turn.responseText || '')).filter(Boolean).join('\n\n')
    ),
    route: turns.at(-1)?.routeMetadata?.tigerPrimary?.route ?? null,
    traceContracts: observedContracts,
    traceDataSources,
  };
}

function buildScenarioTurnContext(result, turn, turnIndex) {
  if (!result || !turn) {
    return buildEmptyContext();
  }

  const { observedContracts, traceSummary } = collectObservedContracts({
    attempts: turn.routeMetadata?.tigerPrimary?.attempts,
    executionTrace: turn.diagnostics?.executionTrace,
  });

  return {
    expectedBehavior: 'success',
    expectedContracts: normalizeStringArray(turn.expectedContracts),
    expectedRoutes: normalizeStringArray(turn.expectedRoutes),
    family: inferScenarioFamily(result),
    matchedIntent: turn.routeMetadata?.tigerPrimary?.matchedIntent ?? null,
    observedContracts,
    prompt: `${result.scenarioName || result.scenarioId} / turn ${turnIndex}: ${turn.user}`,
    responseSnippet: buildResponseSnippet(turn.responseText),
    route: turn.routeMetadata?.tigerPrimary?.route ?? null,
    traceContracts: traceSummary.executedContracts || [],
    traceDataSources: traceSummary.dataSources || [],
  };
}

function buildEmptyContext() {
  return {
    expectedBehavior: 'success',
    expectedContracts: [],
    expectedRoutes: [],
    family: 'unknown',
    matchedIntent: null,
    observedContracts: [],
    prompt: '',
    responseSnippet: '',
    route: null,
    traceContracts: [],
    traceDataSources: [],
  };
}

function collectObservedContracts(params) {
  const traceSummary = summarizeTraceEntries(params.executionTrace);
  const attemptedContracts = Array.isArray(params.attempts)
    ? params.attempts
        .map((attempt) => String(attempt?.contractName || '').trim())
        .filter(Boolean)
    : [];

  return {
    observedContracts: Array.from(
      new Set([...(traceSummary.executedContracts || []), ...attemptedContracts])
    ).sort((left, right) => left.localeCompare(right)),
    traceSummary,
  };
}

function classifyIssue(issue, context) {
  if (isGateMismatch(issue, context)) {
    return {
      category: 'gate_or_manifest',
      findingType: 'harness_mismatch',
      rationale: 'Observed Tiger route/contracts already satisfy the stated expectation, so the artifact/gate needs correction.',
      subsystem: 'tiger_cutover_gate',
    };
  }

  if (isUnsupportedPolicyIssue(issue, context)) {
    return {
      category: 'unsupported_policy',
      findingType: 'runtime_gap',
      rationale: 'Unsupported constraints need one explicit Tiger-owned response path instead of ambiguous partial-success or vague fallback wording.',
      subsystem: 'stream_handler',
    };
  }

  if (isRoutingIssue(issue, context)) {
    return {
      category: 'routing',
      findingType: 'runtime_gap',
      rationale: 'The prompt family is landing on the wrong Tiger contract or intent family, which affects many prompts with the same shape.',
      subsystem: 'intent_routing',
    };
  }

  if (isResolutionIssue(issue, context)) {
    return {
      category: 'resolution',
      findingType: 'runtime_gap',
      rationale: 'The entity/title resolution policy is over-clarifying or choosing the wrong candidate for a whole class of entity-bearing prompts.',
      subsystem: 'entity_resolution',
    };
  }

  return {
    category: 'answer_quality',
    findingType: 'runtime_gap',
    rationale: 'The prompt is on the right Tiger path, but the answer brief, narration, or evidence shape still needs family-wide quality work.',
    subsystem: 'answer_brief_and_renderer',
  };
}

function isGateMismatch(issue, context) {
  if (/Missing expected Tiger contracts:/i.test(issue.message) && context.expectedContracts.length > 0) {
    return context.expectedContracts.every((contractName) => context.observedContracts.includes(contractName));
  }

  if (/Expected Tiger route /i.test(issue.message) && context.expectedRoutes.length > 0 && context.route) {
    return context.expectedRoutes.includes(String(context.route));
  }

  if (/unsupported response/i.test(issue.message) && UNSUPPORTED_TEXT_PATTERN.test(context.responseSnippet)) {
    return true;
  }

  return false;
}

function isUnsupportedPolicyIssue(issue, context) {
  if (context.expectedBehavior === 'unsupported') {
    return true;
  }

  return /unsupported response|responded like an unsupported case/i.test(issue.message);
}

function isRoutingIssue(issue, context) {
  const expectedContracts = new Set(context.expectedContracts);
  const family = String(context.family || '').toLowerCase();
  const matchedIntent = String(context.matchedIntent || '').toLowerCase();
  const observedContracts = new Set(context.observedContracts);

  if (/Expected Tiger route|Missing expected Tiger contracts/i.test(issue.message)) {
    if (expectedContracts.has('rankEntities') && !observedContracts.has('rankEntities')) {
      return true;
    }
    if (expectedContracts.has('semanticSearch') && !observedContracts.has('semanticSearch')) {
      return true;
    }
    if (family.includes('ranking') && matchedIntent === 'catalog_search') {
      return true;
    }
    if (
      (family.includes('concept') || family.includes('similarity'))
      && matchedIntent === 'catalog_search'
    ) {
      return true;
    }
  }

  return false;
}

function isResolutionIssue(issue, context) {
  const expectedContracts = new Set(context.expectedContracts);
  const family = String(context.family || '').toLowerCase();
  const text = String(context.responseSnippet || '');

  if (CLARIFICATION_TEXT_PATTERN.test(text)) {
    return true;
  }

  if (
    /Portfolio/i.test(issue.message)
    || expectedContracts.has('getEntityOverview')
    || expectedContracts.has('searchDocuments')
    || expectedContracts.has('explainChanges')
  ) {
    if (
      family.includes('publisher')
      || family.includes('developer')
      || family.includes('news')
      || family.includes('change')
      || family.includes('entity')
    ) {
      return true;
    }
  }

  return false;
}

function buildFixTracks(issueEntries) {
  const grouped = new Map();

  for (const category of CATEGORY_ORDER) {
    grouped.set(category, {
      blockerCount: 0,
      broadFix: CATEGORY_CONFIG[category].broadFix,
      category,
      categoryTitle: CATEGORY_CONFIG[category].title,
      findingTypes: new Set(),
      issueIds: new Set(),
      owner: CATEGORY_CONFIG[category].owner,
      prompts: new Set(),
      warningCount: 0,
    });
  }

  for (const entry of issueEntries) {
    const group = grouped.get(entry.category);
    if (!group) {
      continue;
    }

    if (entry.level === 'blocker') {
      group.blockerCount += 1;
    } else {
      group.warningCount += 1;
    }

    group.findingTypes.add(entry.findingType);
    group.issueIds.add(entry.id);
    if (entry.prompt) {
      group.prompts.add(entry.prompt);
    }
  }

  return [...grouped.values()]
    .filter((group) => group.blockerCount > 0 || group.warningCount > 0)
    .sort((left, right) => {
      if (right.blockerCount !== left.blockerCount) {
        return right.blockerCount - left.blockerCount;
      }

      if (right.warningCount !== left.warningCount) {
        return right.warningCount - left.warningCount;
      }

      return CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    })
    .map((group, index) => ({
      blockerCount: group.blockerCount,
      broadFix: group.broadFix,
      category: group.category,
      categoryTitle: group.categoryTitle,
      findingTypes: [...group.findingTypes].sort((left, right) => left.localeCompare(right)),
      issueIds: [...group.issueIds].sort((left, right) => left.localeCompare(right)),
      owner: group.owner,
      prompts: [...group.prompts].slice(0, 5),
      rank: index + 1,
      warningCount: group.warningCount,
    }));
}

function inferScenarioFamily(result) {
  const turns = Array.isArray(result?.turns) ? result.turns : [];
  const observedContracts = Array.from(
    new Set(
      turns.flatMap((turn) => normalizeStringArray(turn.expectedContracts))
    )
  );

  if (observedContracts.includes('continueResultSet') || observedContracts.includes('discoverMomentum')) {
    return 'result_set_continuation';
  }
  if (observedContracts.includes('semanticSearch')) {
    return 'semantic_search';
  }
  if (observedContracts.includes('explainChanges')) {
    return 'change_explanation';
  }
  if (observedContracts.includes('searchCatalog')) {
    return 'catalog_search';
  }

  return 'scenario';
}

function buildResponseSnippet(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > 240
    ? `${normalized.slice(0, 237)}...`
    : normalized;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
}

function renderTigerCutoverTriageMarkdown(triage) {
  const lines = [
    '# Tiger Cutover Triage',
    '',
    `- Generated: ${triage.generatedAt}`,
    `- Inventory: ${triage.inventoryName}`,
    `- Overall pass: ${triage.overallPass ? 'yes' : 'no'}`,
    `- Blockers: ${triage.blockers}`,
    `- Warnings: ${triage.warnings}`,
    '',
    '## Ranked Fix Tracks',
    '',
  ];

  if (triage.rankedFixTracks.length === 0) {
    lines.push('- None');
  } else {
    for (const track of triage.rankedFixTracks) {
      lines.push(`### ${track.rank}. ${track.categoryTitle}`);
      lines.push('');
      lines.push(`- Blockers: ${track.blockerCount}`);
      lines.push(`- Warnings: ${track.warningCount}`);
      lines.push(`- Owner: ${track.owner}`);
      lines.push(`- Finding types: ${track.findingTypes.join(', ') || 'runtime_gap'}`);
      lines.push(`- Issues: ${track.issueIds.join(', ')}`);
      lines.push(`- Broad fix: ${track.broadFix}`);
      if (track.prompts.length > 0) {
        lines.push(`- Example prompts: ${track.prompts.join(' | ')}`);
      }
      lines.push('');
    }
  }

  lines.push(
    '## Detailed Findings',
    '',
    '| Level | ID | Category | Finding | Route | Intent | Contracts | Latency/Data | Message |',
    '|---|---|---|---|---|---|---|---|---|'
  );

  for (const issue of triage.issues) {
    lines.push(
      `| ${escapeTable(issue.level)} | ${escapeTable(issue.id)} | ${escapeTable(issue.categoryTitle)} | ${escapeTable(issue.findingType)} | ${escapeTable(issue.route || '-')} | ${escapeTable(issue.matchedIntent || '-')} | ${escapeTable(issue.observedContracts.join(', ') || '-')} | ${escapeTable(buildTraceSummaryCell(issue.traceDataSources))} | ${escapeTable(issue.message)} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildTraceSummaryCell(dataSources) {
  if (!Array.isArray(dataSources) || dataSources.length === 0) {
    return '-';
  }

  return dataSources.slice(0, 3).join(', ');
}

function escapeTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}
