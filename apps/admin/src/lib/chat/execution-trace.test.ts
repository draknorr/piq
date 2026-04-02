import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachToolExecutionProvenance,
  buildTigerContractTraceEntry,
  buildToolExecutionTraceEntry,
  extractToolExecutionProvenance,
  getAuditedTigerContractNames,
  getAuditedToolNames,
} from './execution-trace';
import { CUBE_TOOLS } from '@/lib/llm/cube-tools';

test('execution trace registry covers the current chat tool surface', () => {
  const auditedTools = new Set(getAuditedToolNames());
  const exposedTools = CUBE_TOOLS.map((tool) => tool.function.name);

  for (const toolName of exposedTools) {
    assert.ok(
      auditedTools.has(toolName),
      `expected provenance mapping for tool ${toolName}`
    );
  }

  assert.ok(auditedTools.has('query_database'));
});

test('execution trace registry covers Tiger contracts and continuation', () => {
  const auditedContracts = new Set(getAuditedTigerContractNames());

  for (const contractName of [
    'resolveEntities',
    'rankEntities',
    'compareEntities',
    'searchCatalog',
    'searchDocuments',
    'explainChanges',
    'semanticSearch',
    'traceMetricHistory',
    'continueResultSet',
  ]) {
    assert.ok(
      auditedContracts.has(contractName),
      `expected provenance mapping for contract ${contractName}`
    );
  }
});

test('query analytics traces preserve the queried cube name without raw query text', () => {
  const trace = buildToolExecutionTraceEntry({
    latencyMs: 42,
    result: { success: true },
    toolArguments: {
      cube: 'Discovery',
      measures: ['Discovery.count'],
    },
    toolName: 'query_analytics',
  });

  assert.deepEqual(trace.backendKinds, ['cube']);
  assert.ok(trace.dataSources.includes('cube:Discovery'));
  assert.ok(!trace.dataSources.some((source) => source.includes('select')));
  assert.equal(trace.migrationDisposition, 'needs_tiger_contract');
});

test('Tiger contract trace entries are marked as Tiger-owned', () => {
  const trace = buildTigerContractTraceEntry({
    contractName: 'searchCatalog',
    latencyMs: 7,
    stage: 'tiger_primary',
    status: 'success',
  });

  assert.deepEqual(trace.backendKinds, ['tiger_query_api']);
  assert.ok(trace.dataSources.includes('query_api:searchCatalog'));
  assert.equal(trace.migrationDisposition, 'already_tiger');
  assert.deepEqual(trace.recommendedTigerContracts, ['searchCatalog']);
});

test('tool execution traces can be overridden when a legacy tool routes through Tiger', () => {
  const result = attachToolExecutionProvenance(
    { success: true },
    {
      backendKinds: ['tiger_query_api'],
      dataSources: ['query_api:resolveEntities'],
      migrationDisposition: 'already_tiger',
      migrationNotes: 'Compatibility wrapper used Tiger.',
      recommendedTigerContracts: ['resolveEntities'],
    }
  );

  const provenanceOverride = extractToolExecutionProvenance(result);
  assert.ok(provenanceOverride);

  const trace = buildToolExecutionTraceEntry({
    provenanceOverride,
    result,
    toolName: 'lookup_games',
  });

  assert.deepEqual(trace.backendKinds, ['tiger_query_api']);
  assert.deepEqual(trace.dataSources, ['query_api:resolveEntities']);
  assert.equal(trace.migrationDisposition, 'already_tiger');
  assert.deepEqual(trace.recommendedTigerContracts, ['resolveEntities']);
});
