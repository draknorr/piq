import fs from 'node:fs/promises';
import path from 'node:path';

import { formatLatencyMs } from './blended-persona-scoring.mjs';
import { summarizeTraceEntries } from './tool-backend-audit.mjs';

const UNSUPPORTED_TEXT_PATTERN = /\b(?:couldn't route|does not support|doesn't support|not support|unsupported)\b/i;

export async function writeTigerCutoverGateArtifacts(params) {
  const { outDir, promptResults, runSummary, scenarioResults } = params;
  const gate = buildTigerCutoverGate({
    promptResults,
    runSummary,
    scenarioResults,
  });

  await fs.writeFile(
    path.join(outDir, 'tiger-cutover-gate.json'),
    `${JSON.stringify(gate, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'tiger-cutover-gate.md'),
    renderTigerCutoverGateMarkdown(gate)
  );

  return gate;
}

export function buildTigerCutoverGate(params) {
  const { promptResults, runSummary, scenarioResults } = params;
  const blockers = [];
  const warnings = [];
  const promptChecks = promptResults.map((result) => {
    const check = evaluatePromptResult(result);
    blockers.push(...check.blockers);
    warnings.push(...check.warnings);
    return check.summary;
  });
  const scenarioChecks = scenarioResults.map((result) => {
    const check = evaluateScenarioResult(result);
    blockers.push(...check.blockers);
    warnings.push(...check.warnings);
    return check.summary;
  });

  const promptLatencies = promptResults
    .map((result) => result.visibleLatencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  const suiteLatencySummary = {
    p50Ms: percentile(promptLatencies, 0.5),
    p95Ms: percentile(promptLatencies, 0.95),
  };

  if (suiteLatencySummary.p50Ms != null && suiteLatencySummary.p50Ms > 10_000) {
    warnings.push(
      makeIssue(
        'suite',
        'suite-latency-p50',
        `Prompt-suite p50 latency is ${formatLatencyMs(suiteLatencySummary.p50Ms)}, above the 10s warning bar.`,
        'warning'
      )
    );
  }

  if (suiteLatencySummary.p95Ms != null && suiteLatencySummary.p95Ms > 18_000) {
    warnings.push(
      makeIssue(
        'suite',
        'suite-latency-p95',
        `Prompt-suite p95 latency is ${formatLatencyMs(suiteLatencySummary.p95Ms)}, above the 18s warning bar.`,
        'warning'
      )
    );
  }

  return {
    blockers,
    generatedAt: runSummary.generatedAt,
    humanReviewQueue: buildHumanReviewQueue(promptResults),
    inventoryName: runSummary.inventoryName || 'tiger-cutover',
    overallPass: blockers.length === 0,
    promptChecks,
    runSummary: {
      endpointOrigin: runSummary.endpointOrigin ?? null,
      promptAverageScore: runSummary.promptAverageScore,
      promptCount: runSummary.promptCount,
      promptFailures: runSummary.promptFailures,
      runDurationMs: runSummary.runDurationMs,
      scenarioAverageScore: runSummary.scenarioAverageScore,
      scenarioCount: runSummary.scenarioCount,
    },
    scenarioChecks,
    suiteLatencySummary,
    warnings,
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

function evaluatePromptResult(result) {
  const blockers = [];
  const warnings = [];
  const text = String(result.responseText || '');
  const { observedContracts, traceSummary } = collectObservedContracts({
    attempts: result.routeMetadata?.tigerPrimary?.attempts,
    executionTrace: result.diagnostics?.executionTrace,
  });
  const route = result.routeMetadata?.tigerPrimary?.route ?? null;
  const priority = result.priority || 'P2';
  const identifier = String(result.critiqueId);

  if (result.status !== 'success') {
    blockers.push(makeIssue('prompt', identifier, `Prompt finished with status ${result.status}.`));
  }

  if (Array.isArray(result.expectedRoutes) && result.expectedRoutes.length > 0) {
    const expectedRouteMatched = result.expectedRoutes.includes(String(route));
    if (!expectedRouteMatched) {
      blockers.push(
        makeIssue(
          'prompt',
          identifier,
          `Expected Tiger route ${result.expectedRoutes.join(' or ')}, received ${route || 'none'}.`
        )
      );
    }
  }

  if (Array.isArray(result.expectedContracts) && result.expectedContracts.length > 0) {
    const missingContracts = result.expectedContracts.filter(
      (contractName) => !observedContracts.includes(contractName)
    );
    if (missingContracts.length > 0) {
      blockers.push(
        makeIssue(
          'prompt',
          identifier,
          `Missing expected Tiger contracts: ${missingContracts.join(', ')}.`
        )
      );
    }
  }

  const backendViolations = detectForbiddenDependencies(result.mustAvoidBackends, {
    route,
    text,
    traceSummary,
  });
  for (const violation of backendViolations) {
    blockers.push(makeIssue('prompt', identifier, violation));
  }

  const missingAnchors = detectMissingAnchors(result.factualAnchors, text);
  if (missingAnchors.length > 0) {
    const issue = makeIssue(
      'prompt',
      identifier,
      `Missing expected text anchors: ${missingAnchors.join(', ')}.`
    );
    if (priority === 'P0') {
      blockers.push(issue);
    } else {
      warnings.push({ ...issue, severity: 'warning' });
    }
  }

  const presentAntiAnchors = detectPresentAnchors(result.antiAnchors, text);
  if (presentAntiAnchors.length > 0) {
    blockers.push(
      makeIssue(
        'prompt',
        identifier,
        `Found prohibited text anchors: ${presentAntiAnchors.join(', ')}.`
      )
    );
  }

  if (result.expectedBehavior === 'unsupported') {
    if (!UNSUPPORTED_TEXT_PATTERN.test(text)) {
      blockers.push(
        makeIssue(
          'prompt',
          identifier,
          'Expected a Tiger-owned unsupported response, but the answer text did not make that clear.'
        )
      );
    }
  } else if (UNSUPPORTED_TEXT_PATTERN.test(text)) {
    blockers.push(
      makeIssue(
        'prompt',
        identifier,
        'Expected a successful answer, but the prompt responded like an unsupported case.'
      )
    );
  }

  if (priority === 'P0' && Number.isFinite(result.draftScore) && result.draftScore < 7) {
    blockers.push(
      makeIssue(
        'prompt',
        identifier,
        `P0 prompt scored ${result.draftScore}/10, below the 7.0 blocker threshold.`
      )
    );
  } else if (priority === 'P1' && Number.isFinite(result.draftScore)) {
    if (result.draftScore < 6) {
      blockers.push(
        makeIssue(
          'prompt',
          identifier,
          `P1 prompt scored ${result.draftScore}/10, below the 6.0 blocker threshold.`
        )
      );
    } else if (result.draftScore < 7) {
      warnings.push(
        makeIssue(
          'prompt',
          identifier,
          `P1 prompt scored ${result.draftScore}/10, below the 7.0 warning bar.`,
          'warning'
        )
      );
    }
  }

  if (Number.isFinite(result.visibleLatencyMs) && Number.isFinite(result.latencyBudgetMs)) {
    if (result.visibleLatencyMs > result.latencyBudgetMs) {
      const issue = makeIssue(
        'prompt',
        identifier,
        `Prompt latency ${formatLatencyMs(result.visibleLatencyMs)} exceeded budget ${formatLatencyMs(result.latencyBudgetMs)}.`
      );
      if (priority === 'P0') {
        blockers.push(issue);
      } else {
        warnings.push({ ...issue, severity: 'warning' });
      }
    }
  }

  return {
    blockers,
    summary: {
      critiqueId: result.critiqueId,
      draftScore: result.draftScore,
      latencyMs: result.visibleLatencyMs,
      priority,
      prompt: result.prompt,
      route,
      status: result.status,
      verdict: result.verdict,
    },
    warnings,
  };
}

function evaluateScenarioResult(result) {
  const blockers = [];
  const warnings = [];
  const priority = result.priority || 'P2';
  const identifier = String(result.scenarioId);

  if (result.status !== 'success') {
    blockers.push(makeIssue('scenario', identifier, `Scenario finished with status ${result.status}.`));
  }

  if (priority === 'P0' && Number.isFinite(result.draftScore) && result.draftScore < 7) {
    blockers.push(
      makeIssue(
        'scenario',
        identifier,
        `P0 scenario scored ${result.draftScore}/10, below the 7.0 blocker threshold.`
      )
    );
  }

  if (Number.isFinite(result.latencyBudgetMs)) {
    const totalLatencyMs = result.turns.reduce(
      (sum, turn) => sum + (Number.isFinite(turn.visibleLatencyMs) ? turn.visibleLatencyMs : 0),
      0
    );
    if (totalLatencyMs > result.latencyBudgetMs) {
      const issue = makeIssue(
        'scenario',
        identifier,
        `Scenario latency ${formatLatencyMs(totalLatencyMs)} exceeded budget ${formatLatencyMs(result.latencyBudgetMs)}.`
      );
      if (priority === 'P0') {
        blockers.push(issue);
      } else {
        warnings.push({ ...issue, severity: 'warning' });
      }
    }
  }

  for (const turn of result.turns) {
    const { observedContracts, traceSummary: turnTraceSummary } = collectObservedContracts({
      attempts: turn.routeMetadata?.tigerPrimary?.attempts,
      executionTrace: turn.diagnostics?.executionTrace,
    });
    const turnRoute = turn.routeMetadata?.tigerPrimary?.route ?? null;
    const text = String(turn.responseText || '');
    const turnIdentifier = `${identifier}:turn:${turn.turnIndex}`;

    if (turn.status !== 'success') {
      blockers.push(makeIssue('scenario_turn', turnIdentifier, `Turn finished with status ${turn.status}.`));
    }

    if (Array.isArray(turn.expectedRoutes) && turn.expectedRoutes.length > 0) {
      const matched = turn.expectedRoutes.includes(String(turnRoute));
      if (!matched) {
        blockers.push(
          makeIssue(
            'scenario_turn',
            turnIdentifier,
            `Expected Tiger route ${turn.expectedRoutes.join(' or ')}, received ${turnRoute || 'none'}.`
          )
        );
      }
    }

    if (Array.isArray(turn.expectedContracts) && turn.expectedContracts.length > 0) {
      const missingContracts = turn.expectedContracts.filter(
        (contractName) => !observedContracts.includes(contractName)
      );
      if (missingContracts.length > 0) {
        blockers.push(
          makeIssue(
            'scenario_turn',
            turnIdentifier,
            `Missing expected Tiger contracts: ${missingContracts.join(', ')}.`
          )
        );
      }
    }

    const backendViolations = detectForbiddenDependencies(result.mustAvoidBackends, {
      route: turnRoute,
      text,
      traceSummary: turnTraceSummary,
    });
    for (const violation of backendViolations) {
      blockers.push(makeIssue('scenario_turn', turnIdentifier, violation));
    }

    const missingAnchors = detectMissingAnchors(turn.factualAnchors, text);
    if (missingAnchors.length > 0) {
      const issue = makeIssue(
        'scenario_turn',
        turnIdentifier,
        `Missing expected text anchors: ${missingAnchors.join(', ')}.`
      );
      if (priority === 'P0') {
        blockers.push(issue);
      } else {
        warnings.push({ ...issue, severity: 'warning' });
      }
    }

    const presentAntiAnchors = detectPresentAnchors(turn.antiAnchors, text);
    if (presentAntiAnchors.length > 0) {
      blockers.push(
        makeIssue(
          'scenario_turn',
          turnIdentifier,
          `Found prohibited text anchors: ${presentAntiAnchors.join(', ')}.`
        )
      );
    }

    if (Number.isFinite(turn.visibleLatencyMs) && Number.isFinite(turn.latencyBudgetMs) && turn.visibleLatencyMs > turn.latencyBudgetMs) {
      const issue = makeIssue(
        'scenario_turn',
        turnIdentifier,
        `Turn latency ${formatLatencyMs(turn.visibleLatencyMs)} exceeded budget ${formatLatencyMs(turn.latencyBudgetMs)}.`
      );
      if (priority === 'P0') {
        blockers.push(issue);
      } else {
        warnings.push({ ...issue, severity: 'warning' });
      }
    }
  }

  return {
    blockers,
    summary: {
      draftScore: result.draftScore,
      priority,
      scenarioId: result.scenarioId,
      scenarioName: result.scenarioName,
      status: result.status,
      verdict: result.verdict,
    },
    warnings,
  };
}

function buildHumanReviewQueue(promptResults) {
  const slowestPromptIds = [...promptResults]
    .filter((result) => Number.isFinite(result.visibleLatencyMs))
    .sort((left, right) => (right.visibleLatencyMs ?? 0) - (left.visibleLatencyMs ?? 0))
    .slice(0, 5)
    .map((result) => result.critiqueId);

  return {
    promptIds: Array.from(
      new Set([
        ...promptResults
          .filter((result) => result.priority === 'P0')
          .map((result) => result.critiqueId),
        ...promptResults
          .filter((result) => result.verdict === 'Weak' || result.verdict === 'Failure')
          .map((result) => result.critiqueId),
        ...slowestPromptIds,
      ])
    ),
    rationale:
      'Review all P0 prompts, any weak/failure prompts, and the slowest 5 prompts for factual accuracy and conversational quality.',
  };
}

function detectForbiddenDependencies(avoidList, params) {
  if (!Array.isArray(avoidList) || avoidList.length === 0) {
    return [];
  }

  const { route, text, traceSummary } = params;
  const violations = [];

  for (const avoid of avoidList) {
    const key = String(avoid || '').toLowerCase();

    if (key === 'legacy') {
      if (route === 'fallback_to_legacy' || traceSummary.stillDependsOnLegacyAnswerPath) {
        violations.push('Answer still depends on the legacy answer path.');
      }
      continue;
    }

    if (key === 'cube') {
      if (containsMarker(traceSummary, 'cube')) {
        violations.push('Trace still references Cube-backed execution.');
      }
      continue;
    }

    if (key === 'supabase') {
      if (containsMarker(traceSummary, 'supabase')) {
        violations.push('Trace still references Supabase-backed execution.');
      }
      continue;
    }

    if (key === 'qdrant') {
      if (containsMarker(traceSummary, 'qdrant') || /\bqdrant\b/i.test(text)) {
        violations.push('Trace or answer still references Qdrant.');
      }
      continue;
    }
  }

  return violations;
}

function containsMarker(traceSummary, marker) {
  const lower = String(marker || '').toLowerCase();
  const values = [
    ...(traceSummary.dataSources || []),
    ...(traceSummary.executedContracts || []),
    ...(traceSummary.executedTools || []),
    ...(traceSummary.legacyBackends || []),
    ...(traceSummary.legacyNames || []),
  ].map((value) => String(value || '').toLowerCase());

  return values.some((value) => value.includes(lower));
}

function detectMissingAnchors(anchors, text) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return [];
  }

  const haystack = String(text || '').toLowerCase();
  return anchors.filter((anchor) => !haystack.includes(String(anchor).toLowerCase()));
}

function detectPresentAnchors(anchors, text) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return [];
  }

  const haystack = String(text || '').toLowerCase();
  return anchors.filter((anchor) => haystack.includes(String(anchor).toLowerCase()));
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1));
  return values[index];
}

function makeIssue(type, id, message, severity = 'blocker') {
  return {
    id,
    message,
    severity,
    type,
  };
}

function renderTigerCutoverGateMarkdown(gate) {
  const lines = [
    '# Tiger Cutover Gate',
    '',
    `- Generated: ${gate.generatedAt}`,
    `- Inventory: ${gate.inventoryName}`,
    `- Overall pass: ${gate.overallPass ? 'yes' : 'no'}`,
    `- Prompt count: ${gate.runSummary.promptCount}`,
    `- Scenario count: ${gate.runSummary.scenarioCount}`,
    `- Prompt average score: ${gate.runSummary.promptAverageScore}/10`,
    `- Scenario average score: ${gate.runSummary.scenarioAverageScore}/10`,
    `- Prompt latency p50: ${formatLatencyMs(gate.suiteLatencySummary.p50Ms) || '-'}`,
    `- Prompt latency p95: ${formatLatencyMs(gate.suiteLatencySummary.p95Ms) || '-'}`,
    '',
    '## Blockers',
    '',
  ];

  if (gate.blockers.length === 0) {
    lines.push('- None');
  } else {
    for (const blocker of gate.blockers) {
      lines.push(`- [${blocker.type}] ${blocker.id}: ${blocker.message}`);
    }
  }

  lines.push('', '## Warnings', '');
  if (gate.warnings.length === 0) {
    lines.push('- None');
  } else {
    for (const warning of gate.warnings) {
      lines.push(`- [${warning.type}] ${warning.id}: ${warning.message}`);
    }
  }

  lines.push('', '## Human Review Queue', '');
  lines.push(`- Prompt IDs: ${gate.humanReviewQueue.promptIds.join(', ') || 'none'}`);
  lines.push(`- Rationale: ${gate.humanReviewQueue.rationale}`);

  lines.push('', '## Prompt Checks', '', '| ID | Priority | Score | Verdict | Route | Latency | Status |', '|---|---|---:|---|---|---:|---|');
  for (const row of gate.promptChecks) {
    lines.push(
      `| ${escapeTable(row.critiqueId)} | ${escapeTable(row.priority)} | ${Number.isFinite(row.draftScore) ? row.draftScore.toFixed(1) : '-'} | ${escapeTable(row.verdict || '-')} | ${escapeTable(row.route || '-')} | ${escapeTable(formatLatencyMs(row.latencyMs) || '-')} | ${escapeTable(row.status || '-')} |`
    );
  }

  lines.push('', '## Scenario Checks', '', '| ID | Priority | Score | Verdict | Status |', '|---|---|---:|---|---|');
  for (const row of gate.scenarioChecks) {
    lines.push(
      `| ${escapeTable(row.scenarioId)} | ${escapeTable(row.priority)} | ${Number.isFinite(row.draftScore) ? row.draftScore.toFixed(1) : '-'} | ${escapeTable(row.verdict || '-')} | ${escapeTable(row.status || '-')} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}
