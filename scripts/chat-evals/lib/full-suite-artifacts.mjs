import fs from 'node:fs/promises';
import path from 'node:path';

import { formatLatencyMs } from './blended-persona-scoring.mjs';
import { BLENDED_PERSONA } from './full-suite-inventory.mjs';
import { buildAuditArtifacts } from './tool-backend-audit.mjs';

export async function writeFullSuiteArtifacts(params) {
  const {
    outDir,
    promptResults,
    reportTitle,
    runSummary,
    scenarioResults,
  } = params;

  const promptRankings = buildFullSuiteRankings(promptResults, 'prompt');
  const scenarioRankings = buildFullSuiteRankings(scenarioResults, 'scenario');
  const auditArtifacts = buildAuditArtifacts({
    generatedAt: runSummary.generatedAt,
    promptResults,
    scenarioResults,
  });
  const enrichedRunSummary = {
    ...runSummary,
    auditSummary: auditArtifacts.auditSummary,
  };

  await fs.writeFile(
    path.join(outDir, 'prompt-results.json'),
    `${JSON.stringify(promptResults, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'scenario-results.json'),
    `${JSON.stringify(scenarioResults, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'prompt-rankings.json'),
    `${JSON.stringify(promptRankings, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'scenario-rankings.json'),
    `${JSON.stringify(scenarioRankings, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'curation-template.json'),
    `${JSON.stringify(buildFullSuiteCurationTemplate(promptResults, scenarioResults), null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'run-summary.json'),
    `${JSON.stringify(enrichedRunSummary, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'ledger-run-draft.md'),
    renderFullSuiteLedgerDraft({
      promptRankings,
      promptResults,
      reportTitle,
      runSummary: enrichedRunSummary,
      scenarioRankings,
      scenarioResults,
    })
  );
  await fs.writeFile(
    path.join(outDir, 'prompt-tool-traces.json'),
    `${JSON.stringify(auditArtifacts.promptToolTraces, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'scenario-tool-traces.json'),
    `${JSON.stringify(auditArtifacts.scenarioToolTraces, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'tool-usage-summary.json'),
    `${JSON.stringify(auditArtifacts.toolUsageSummary, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'backend-usage-summary.json'),
    `${JSON.stringify(auditArtifacts.backendUsageSummary, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'migration-matrix.json'),
    `${JSON.stringify(auditArtifacts.migrationMatrix, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outDir, 'migration-matrix.md'),
    auditArtifacts.migrationMatrixMarkdown
  );
  await fs.writeFile(
    path.join(outDir, 'unmapped-tools.json'),
    `${JSON.stringify(auditArtifacts.unmappedTools, null, 2)}\n`
  );

  return {
    auditArtifacts,
    promptRankings,
    scenarioRankings,
  };
}

export function buildFullSuiteRankings(results, type) {
  return [...results]
    .sort((left, right) => {
      if (right.draftScore !== left.draftScore) {
        return right.draftScore - left.draftScore;
      }

      return inferRankingLatency(left, type) - inferRankingLatency(right, type);
    })
    .map((result, index) => ({
      rank: index + 1,
      ...(type === 'prompt'
        ? {
            critiqueId: result.critiqueId,
            family: result.family,
            prompt: result.prompt,
          }
        : {
            scenarioId: result.scenarioId,
            scenarioName: result.scenarioName,
          }),
      draftScore: result.draftScore,
      status: result.status ?? 'scenario',
      usefulnessSummary: result.usefulnessSummary,
      verdict: result.verdict,
      visibleLatencyMs: inferRankingLatency(result, type),
    }));
}

export function buildFullSuiteCurationTemplate(promptResults, scenarioResults) {
  return {
    blendedPersona: BLENDED_PERSONA,
    prompts: promptResults.map((result) => ({
      critiqueId: result.critiqueId,
      curatorNotes: null,
      draftScore: result.draftScore,
      draftVerdict: result.verdict,
      overrideScore: null,
      overrideUsefulnessSummary: null,
      overrideVerdict: null,
      prompt: result.prompt,
      qualityNotes: result.qualityNotes,
      scoreBreakdown: result.scoreBreakdown,
      usefulnessSummary: result.usefulnessSummary,
    })),
    scenarios: scenarioResults.map((result) => ({
      carryForwardQuality: result.carryForwardQuality,
      curatorNotes: null,
      draftScore: result.draftScore,
      draftVerdict: result.verdict,
      overrideScore: null,
      overrideUsefulnessSummary: null,
      overrideVerdict: null,
      qualityNotes: result.qualityNotes,
      scenarioId: result.scenarioId,
      scenarioName: result.scenarioName,
      turns: result.turns.map((turn) => ({
        autoScore: turn.autoScore,
        autoVerdict: turn.autoVerdict,
        expectation: turn.expectation,
        notes: null,
        overrideScore: null,
        qualityNotes: turn.qualityNotes,
        turnIndex: turn.turnIndex,
        usefulnessSummary: turn.usefulnessSummary,
        userPrompt: turn.userPrompt,
      })),
      usefulnessSummary: result.usefulnessSummary,
    })),
  };
}

export function renderFullSuiteLedgerDraft(params) {
  const { promptRankings, promptResults, reportTitle, runSummary, scenarioRankings, scenarioResults } = params;
  const lines = [
    `# ${reportTitle}`,
    '',
    `- Generated: ${runSummary.generatedAt}`,
  ];

  if (runSummary.transport) {
    lines.push(`- Transport: ${runSummary.transport}`);
  }
  if (runSummary.endpointOrigin) {
    lines.push(`- Endpoint origin: ${runSummary.endpointOrigin}`);
  }
  if (runSummary.adminOrigin) {
    lines.push(`- Admin origin: ${runSummary.adminOrigin}`);
  }
  if (runSummary.queryApiBaseUrl) {
    const suffix = runSummary.queryApiSource ? ` (${runSummary.queryApiSource})` : '';
    lines.push(`- Query API: ${runSummary.queryApiBaseUrl}${suffix}`);
  }

  lines.push(
    `- Prompt count: ${runSummary.promptCount}`,
    `- Scenario count: ${runSummary.scenarioCount}`,
    `- Prompt average score: ${runSummary.promptAverageScore}/10`,
    `- Scenario average score: ${runSummary.scenarioAverageScore}/10`,
    `- Run duration: ${formatLatencyMs(runSummary.runDurationMs)}`,
    '',
    '## Blended Persona',
    '',
    `- Name: ${BLENDED_PERSONA.name}`,
    `- Summary: ${BLENDED_PERSONA.summary}`,
    '',
    '## Prompt Ranking',
    '',
    '| Rank | Critique ID | Score | Verdict | Prompt | Latency | Summary |',
    '|---:|---|---:|---|---|---:|---|'
  );

  for (const row of promptRankings) {
    lines.push(
      `| ${row.rank} | ${escapeTable(row.critiqueId)} | ${row.draftScore.toFixed(1)} | ${row.verdict} | ${escapeTable(row.prompt)} | ${escapeTable(formatLatencyMs(row.visibleLatencyMs) || '-')} | ${escapeTable(row.usefulnessSummary)} |`
    );
  }

  lines.push('', '## Scenario Ranking', '', '| Rank | Scenario | Score | Verdict | Carry-forward | Summary |', '|---:|---|---:|---|---|---|');

  for (const row of scenarioRankings) {
    const scenario = scenarioResults.find((result) => result.scenarioId === row.scenarioId);
    lines.push(
      `| ${row.rank} | ${escapeTable(row.scenarioName)} | ${row.draftScore.toFixed(1)} | ${row.verdict} | ${escapeTable(scenario?.carryForwardQuality || '-')} | ${escapeTable(row.usefulnessSummary)} |`
    );
  }

  lines.push('', '## Prompt Details', '');

  for (const result of promptResults) {
    lines.push(`### #${result.critiqueId} ${result.prompt}`);
    lines.push('');
    lines.push(`- Section: ${result.section}`);
    lines.push(`- Family: ${result.family}`);
    lines.push(`- Status: ${result.status}`);
    lines.push(`- Draft score: ${result.draftScore}/10`);
    lines.push(`- Verdict: ${result.verdict}`);
    lines.push(`- Latency: ${result.visibleLatencyText || result.latencyText || '-'}`);
    lines.push(`- Usefulness summary: ${result.usefulnessSummary}`);
    lines.push(`- Notes: ${result.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
    if (result.routeSummary) {
      lines.push(`- Route: ${result.routeSummary}`);
    }
    if (result.screenshotPath) {
      lines.push(`- Screenshot: ${result.screenshotPath}`);
    }
    lines.push('', '```md', result.responseText || '[no assistant text captured]', '```', '');
  }

  lines.push('## Scenario Details', '');

  for (const result of scenarioResults) {
    lines.push(`### ${result.scenarioName}`);
    lines.push('');
    lines.push(`- Scenario ID: ${result.scenarioId}`);
    lines.push(`- Draft score: ${result.draftScore}/10`);
    lines.push(`- Verdict: ${result.verdict}`);
    lines.push(`- Carry-forward quality: ${result.carryForwardQuality}`);
    lines.push(`- Usefulness summary: ${result.usefulnessSummary}`);
    lines.push(`- Notes: ${result.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
    lines.push('');

    for (const turn of result.turns) {
      lines.push(`#### Turn ${turn.turnIndex}`);
      lines.push(`- User prompt: ${turn.userPrompt}`);
      if (turn.expectation) {
        lines.push(`- Expectation: ${turn.expectation}`);
      }
      lines.push(`- Status: ${turn.status}`);
      lines.push(`- Draft score: ${turn.autoScore ?? '-'}`);
      lines.push(`- Verdict: ${turn.autoVerdict ?? '-'}`);
      lines.push(`- Latency: ${turn.visibleLatencyText || turn.latencyText || '-'}`);
      lines.push(`- Usefulness summary: ${turn.usefulnessSummary || '-'}`);
      lines.push(`- Notes: ${turn.qualityNotes.map((note) => `\`${note}\``).join(', ') || '-'}`);
      if (turn.routeSummary) {
        lines.push(`- Route: ${turn.routeSummary}`);
      }
      if (turn.screenshotPath) {
        lines.push(`- Screenshot: ${turn.screenshotPath}`);
      }
      lines.push('', '```md', turn.responseText || '[no assistant text captured]', '```', '');
    }
  }

  return `${lines.join('\n')}\n`;
}

function inferRankingLatency(result, type) {
  if (type === 'prompt') {
    return result.visibleLatencyMs ?? result.latencyMs ?? Number.MAX_SAFE_INTEGER;
  }

  return result.turns.reduce(
    (sum, turn) => sum + (turn.visibleLatencyMs ?? turn.latencyMs ?? 0),
    0
  );
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|');
}
