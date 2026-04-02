const LEGACY_BACKEND_KINDS = new Set([
  'cube',
  'supabase_sql',
  'supabase_rpc',
  'supabase_table',
]);

function dedupeStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeTraceEntries(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
}

function summarizeTraceEntries(entries) {
  const normalized = normalizeTraceEntries(entries);
  const executedEntries = normalized.filter((entry) => entry.readOccurred !== false);
  const legacyEntries = executedEntries.filter((entry) =>
    (entry.backendKinds || []).some((kind) => LEGACY_BACKEND_KINDS.has(kind))
  );

  return {
    captured: normalized.length > 0,
    dataSources: sortStrings(
      dedupeStrings(normalized.flatMap((entry) => entry.dataSources || []))
    ),
    executedContracts: sortStrings(
      dedupeStrings(
        executedEntries
          .filter((entry) => entry.kind === 'contract')
          .map((entry) => entry.name)
      )
    ),
    executedTools: sortStrings(
      dedupeStrings(
        executedEntries
          .filter((entry) => entry.kind === 'tool')
          .map((entry) => entry.name)
      )
    ),
    legacyBackends: sortStrings(
      dedupeStrings(legacyEntries.flatMap((entry) => entry.backendKinds || []))
    ),
    legacyNames: sortStrings(
      dedupeStrings(legacyEntries.map((entry) => entry.name))
    ),
    migrationDispositions: sortStrings(
      dedupeStrings(normalized.map((entry) => entry.migrationDisposition))
    ),
    recommendedTigerContracts: sortStrings(
      dedupeStrings(normalized.flatMap((entry) => entry.recommendedTigerContracts || []))
    ),
    skippedNames: sortStrings(
      dedupeStrings(
        normalized
          .filter((entry) => entry.status === 'skipped')
          .map((entry) => entry.name)
      )
    ),
    stillDependsOnLegacyAnswerPath: legacyEntries.length > 0,
    traceCount: normalized.length,
  };
}

function collectPromptTraceRows(promptResults) {
  return promptResults.map((result) => {
    const executionTrace = normalizeTraceEntries(result.diagnostics?.executionTrace);
    return {
      critiqueId: result.critiqueId,
      executionTrace,
      prompt: result.prompt,
      routeSummary: result.routeSummary ?? null,
      status: result.status,
      traceSummary: summarizeTraceEntries(executionTrace),
    };
  });
}

function collectScenarioTraceRows(scenarioResults) {
  return scenarioResults.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    scenarioName: scenario.scenarioName,
    turns: scenario.turns.map((turn) => {
      const executionTrace = normalizeTraceEntries(turn.diagnostics?.executionTrace);
      return {
        executionTrace,
        routeSummary: turn.routeSummary ?? null,
        status: turn.status,
        traceSummary: summarizeTraceEntries(executionTrace),
        turnIndex: turn.turnIndex,
        userPrompt: turn.userPrompt,
      };
    }),
  }));
}

function buildUsageAccumulator() {
  return {
    backendKinds: new Set(),
    dataSources: new Set(),
    itemKeys: new Set(),
    kind: null,
    migrationDispositions: new Set(),
    migrationNotes: new Set(),
    name: '',
    occurrenceCount: 0,
    recommendedTigerContracts: new Set(),
    skippedCount: 0,
    successCount: 0,
    errorCount: 0,
    legacyReadCount: 0,
  };
}

function addUsageOccurrence(accumulator, entry, itemKey) {
  accumulator.kind = entry.kind;
  accumulator.name = entry.name;
  accumulator.occurrenceCount += 1;
  accumulator.itemKeys.add(itemKey);

  for (const backend of entry.backendKinds || []) {
    accumulator.backendKinds.add(backend);
  }

  for (const source of entry.dataSources || []) {
    accumulator.dataSources.add(source);
  }

  if (entry.migrationDisposition) {
    accumulator.migrationDispositions.add(entry.migrationDisposition);
  }

  if (entry.migrationNotes) {
    accumulator.migrationNotes.add(entry.migrationNotes);
  }

  for (const contract of entry.recommendedTigerContracts || []) {
    accumulator.recommendedTigerContracts.add(contract);
  }

  if (entry.status === 'success') {
    accumulator.successCount += 1;
  } else if (entry.status === 'error') {
    accumulator.errorCount += 1;
  } else if (entry.status === 'skipped') {
    accumulator.skippedCount += 1;
  }

  if (entry.readOccurred !== false && (entry.backendKinds || []).some((kind) => LEGACY_BACKEND_KINDS.has(kind))) {
    accumulator.legacyReadCount += 1;
  }
}

function buildToolUsageSummary(promptTraceRows, scenarioTraceRows) {
  const byName = new Map();

  for (const row of promptTraceRows) {
    for (const entry of row.executionTrace) {
      const key = `${entry.kind}:${entry.name}`;
      if (!byName.has(key)) {
        byName.set(key, buildUsageAccumulator());
      }
      addUsageOccurrence(byName.get(key), entry, `prompt:${row.critiqueId}`);
    }
  }

  for (const scenario of scenarioTraceRows) {
    for (const turn of scenario.turns) {
      for (const entry of turn.executionTrace) {
        const key = `${entry.kind}:${entry.name}`;
        if (!byName.has(key)) {
          byName.set(key, buildUsageAccumulator());
        }
        addUsageOccurrence(
          byName.get(key),
          entry,
          `scenario:${scenario.scenarioId}:turn:${turn.turnIndex}`
        );
      }
    }
  }

  return [...byName.values()]
    .map((value) => ({
      backendKinds: sortStrings([...value.backendKinds]),
      dataSources: sortStrings([...value.dataSources]),
      itemCount: value.itemKeys.size,
      kind: value.kind,
      legacyReadCount: value.legacyReadCount,
      migrationDispositions: sortStrings([...value.migrationDispositions]),
      migrationNotes: sortStrings([...value.migrationNotes]),
      name: value.name,
      occurrenceCount: value.occurrenceCount,
      recommendedTigerContracts: sortStrings([...value.recommendedTigerContracts]),
      skippedCount: value.skippedCount,
      successCount: value.successCount,
      errorCount: value.errorCount,
    }))
    .sort((left, right) => {
      if (right.occurrenceCount !== left.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildBackendUsageSummary(promptTraceRows, scenarioTraceRows) {
  const byBackend = new Map();

  function observe(entries, itemKey) {
    for (const entry of entries) {
      for (const backendKind of entry.backendKinds || []) {
        if (!byBackend.has(backendKind)) {
          byBackend.set(backendKind, {
            backendKind,
            dataSources: new Set(),
            entryCount: 0,
            itemKeys: new Set(),
            legacyReadCount: 0,
            names: new Set(),
          });
        }

        const target = byBackend.get(backendKind);
        target.entryCount += 1;
        target.itemKeys.add(itemKey);
        target.names.add(entry.name);

        for (const source of entry.dataSources || []) {
          target.dataSources.add(source);
        }

        if (entry.readOccurred !== false && LEGACY_BACKEND_KINDS.has(backendKind)) {
          target.legacyReadCount += 1;
        }
      }
    }
  }

  for (const row of promptTraceRows) {
    observe(row.executionTrace, `prompt:${row.critiqueId}`);
  }

  for (const scenario of scenarioTraceRows) {
    for (const turn of scenario.turns) {
      observe(turn.executionTrace, `scenario:${scenario.scenarioId}:turn:${turn.turnIndex}`);
    }
  }

  return [...byBackend.values()]
    .map((value) => ({
      backendKind: value.backendKind,
      dataSources: sortStrings([...value.dataSources]),
      entryCount: value.entryCount,
      itemCount: value.itemKeys.size,
      legacyReadCount: value.legacyReadCount,
      names: sortStrings([...value.names]),
    }))
    .sort((left, right) => {
      if (right.entryCount !== left.entryCount) {
        return right.entryCount - left.entryCount;
      }
      return left.backendKind.localeCompare(right.backendKind);
    });
}

function buildMigrationMatrix(promptTraceRows, scenarioTraceRows) {
  const rows = [];

  for (const row of promptTraceRows) {
    rows.push({
      itemId: String(row.critiqueId),
      itemType: 'prompt',
      legacyDependencies: row.traceSummary.legacyNames,
      legacyBackends: row.traceSummary.legacyBackends,
      prompt: row.prompt,
      recommendedTigerContracts: row.traceSummary.recommendedTigerContracts,
      routeSummary: row.routeSummary,
      status: row.status,
      stillDependsOnLegacyAnswerPath: row.traceSummary.stillDependsOnLegacyAnswerPath,
      traceCaptured: row.traceSummary.captured,
      migrationDispositions: row.traceSummary.migrationDispositions,
    });
  }

  for (const scenario of scenarioTraceRows) {
    for (const turn of scenario.turns) {
      rows.push({
        itemId: `${scenario.scenarioId}:turn:${turn.turnIndex}`,
        itemType: 'scenario_turn',
        legacyDependencies: turn.traceSummary.legacyNames,
        legacyBackends: turn.traceSummary.legacyBackends,
        prompt: turn.userPrompt,
        recommendedTigerContracts: turn.traceSummary.recommendedTigerContracts,
        routeSummary: turn.routeSummary,
        scenarioId: scenario.scenarioId,
        scenarioName: scenario.scenarioName,
        status: turn.status,
        stillDependsOnLegacyAnswerPath: turn.traceSummary.stillDependsOnLegacyAnswerPath,
        traceCaptured: turn.traceSummary.captured,
        migrationDispositions: turn.traceSummary.migrationDispositions,
        turnIndex: turn.turnIndex,
      });
    }
  }

  return rows.sort((left, right) => {
    if (left.itemType !== right.itemType) {
      return left.itemType.localeCompare(right.itemType);
    }
    return String(left.itemId).localeCompare(String(right.itemId));
  });
}

function buildAuditSummary(promptTraceRows, scenarioTraceRows, toolUsageSummary, backendUsageSummary) {
  const promptLegacyCount = promptTraceRows.filter(
    (row) => row.traceSummary.stillDependsOnLegacyAnswerPath
  ).length;
  const scenarioTurnRows = scenarioTraceRows.flatMap((scenario) =>
    scenario.turns.map((turn) => ({
      scenarioId: scenario.scenarioId,
      turn,
    }))
  );
  const scenarioLegacyCount = scenarioTurnRows.filter(
    ({ turn }) => turn.traceSummary.stillDependsOnLegacyAnswerPath
  ).length;

  return {
    backendUsage: backendUsageSummary.map((row) => ({
      backendKind: row.backendKind,
      entryCount: row.entryCount,
      itemCount: row.itemCount,
    })),
    promptLegacyDependencyCount: promptLegacyCount,
    promptTigerOnlyCount: promptTraceRows.length - promptLegacyCount,
    scenarioTurnLegacyDependencyCount: scenarioLegacyCount,
    scenarioTurnTigerOnlyCount: scenarioTurnRows.length - scenarioLegacyCount,
    topLegacyDependencies: toolUsageSummary
      .filter((row) => row.legacyReadCount > 0)
      .slice(0, 10)
      .map((row) => ({
        kind: row.kind,
        legacyReadCount: row.legacyReadCount,
        migrationDispositions: row.migrationDispositions,
        name: row.name,
        recommendedTigerContracts: row.recommendedTigerContracts,
      })),
  };
}

function renderMigrationMatrixMarkdown(params) {
  const {
    auditSummary,
    backendUsageSummary,
    generatedAt,
    migrationMatrix,
    toolUsageSummary,
  } = params;

  const promptLegacyRows = migrationMatrix.filter(
    (row) => row.itemType === 'prompt' && row.stillDependsOnLegacyAnswerPath
  );
  const scenarioLegacyRows = migrationMatrix.filter(
    (row) => row.itemType === 'scenario_turn' && row.stillDependsOnLegacyAnswerPath
  );

  const lines = [
    '# Chat Tool and Backend Audit',
    '',
    `- Generated: ${generatedAt}`,
    `- Prompts still using legacy answer-path reads: ${auditSummary.promptLegacyDependencyCount}`,
    `- Prompt rows that are Tiger-only: ${auditSummary.promptTigerOnlyCount}`,
    `- Scenario turns still using legacy answer-path reads: ${auditSummary.scenarioTurnLegacyDependencyCount}`,
    `- Scenario turns that are Tiger-only: ${auditSummary.scenarioTurnTigerOnlyCount}`,
    '',
    '## Backend Usage',
    '',
    '| Backend | Entries | Items | Data Sources |',
    '|---|---:|---:|---|',
  ];

  for (const row of backendUsageSummary) {
    lines.push(
      `| ${row.backendKind} | ${row.entryCount} | ${row.itemCount} | ${escapeTable(row.dataSources.join(', ') || '-')} |`
    );
  }

  lines.push('', '## Tool and Contract Usage', '', '| Name | Kind | Occurrences | Legacy Reads | Disposition | Recommended Tiger |', '|---|---|---:|---:|---|---|');

  for (const row of toolUsageSummary) {
    lines.push(
      `| ${escapeTable(row.name)} | ${row.kind} | ${row.occurrenceCount} | ${row.legacyReadCount} | ${escapeTable(row.migrationDispositions.join(', ') || '-')} | ${escapeTable(row.recommendedTigerContracts.join(', ') || '-')} |`
    );
  }

  lines.push('', '## Prompts Still Using Legacy Answer-Path Reads', '', '| Prompt | Legacy Dependencies | Backends | Recommended Tiger |', '|---|---|---|---|');

  for (const row of promptLegacyRows) {
    lines.push(
      `| #${escapeTable(row.itemId)} ${escapeTable(row.prompt)} | ${escapeTable(row.legacyDependencies.join(', ') || '-')} | ${escapeTable(row.legacyBackends.join(', ') || '-')} | ${escapeTable(row.recommendedTigerContracts.join(', ') || '-')} |`
    );
  }

  lines.push('', '## Scenario Turns Still Using Legacy Answer-Path Reads', '', '| Scenario Turn | Prompt | Legacy Dependencies | Recommended Tiger |', '|---|---|---|---|');

  for (const row of scenarioLegacyRows) {
    lines.push(
      `| ${escapeTable(row.itemId)} | ${escapeTable(row.prompt)} | ${escapeTable(row.legacyDependencies.join(', ') || '-')} | ${escapeTable(row.recommendedTigerContracts.join(', ') || '-')} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

export function buildAuditArtifacts(params) {
  const promptTraceRows = collectPromptTraceRows(params.promptResults);
  const scenarioTraceRows = collectScenarioTraceRows(params.scenarioResults);
  const toolUsageSummary = buildToolUsageSummary(promptTraceRows, scenarioTraceRows);
  const backendUsageSummary = buildBackendUsageSummary(promptTraceRows, scenarioTraceRows);
  const migrationMatrix = buildMigrationMatrix(promptTraceRows, scenarioTraceRows);
  const auditSummary = buildAuditSummary(
    promptTraceRows,
    scenarioTraceRows,
    toolUsageSummary,
    backendUsageSummary
  );

  return {
    auditSummary,
    backendUsageSummary,
    migrationMatrix,
    migrationMatrixMarkdown: renderMigrationMatrixMarkdown({
      auditSummary,
      backendUsageSummary,
      generatedAt: params.generatedAt,
      migrationMatrix,
      toolUsageSummary,
    }),
    promptToolTraces: promptTraceRows,
    scenarioToolTraces: scenarioTraceRows,
    toolUsageSummary,
    unmappedTools: [],
  };
}
