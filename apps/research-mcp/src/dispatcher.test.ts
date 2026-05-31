import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchMcpRequest } from './dispatcher.js';

test('research MCP lists tools and resources', async () => {
  const queryApi = {
    post: async () => ({}),
  };

  const tools = await dispatchMcpRequest(
    { id: 1, jsonrpc: '2.0', method: 'tools/list' },
    { queryApi, role: 'internal' }
  );
  assert.equal(tools?.jsonrpc, '2.0');
  const listedTools = (tools?.result as { tools?: Array<{ name: string }> }).tools ?? [];
  assert.ok(Array.isArray(listedTools));
  assert.ok(listedTools.some((tool) => tool.name === 'get_publisheriq_data_dictionary'));
  assert.ok(listedTools.some((tool) => tool.name === 'query_publisheriq_data'));

  const resources = await dispatchMcpRequest(
    { id: 2, jsonrpc: '2.0', method: 'resources/list' },
    { queryApi, role: 'internal' }
  );
  assert.ok(Array.isArray((resources?.result as { resources?: unknown[] }).resources));
});

test('research MCP returns local data dictionary for SQL-backed questions', async () => {
  const queryApi = {
    post: async () => {
      throw new Error('should not be called');
    },
  };

  const response = await dispatchMcpRequest(
    {
      id: 'dictionary',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: { topic: 'top indie games' },
        name: 'get_publisheriq_data_dictionary',
      },
    },
    { queryApi, role: 'researcher' }
  );

  const text = (((response?.result as { content: Array<{ text: string }> }).content[0]).text);
  assert.match(text, /metrics\.apps_page_projection/);
  assert.match(text, /legacy\.steam_tags/);
  assert.match(text, /lower\(st\.name\) = 'indie'/);
});

test('research MCP dispatches tool calls to query-api', async () => {
  const calls: Array<{ body: unknown; path: string; role: string | undefined }> = [];
  const queryApi = {
    post: async (path: string, body: unknown, role?: string) => {
      calls.push({ body, path, role });
      return { ok: true };
    },
  };

  const response = await dispatchMcpRequest(
    {
      id: 'call-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: { reportId: 'mortal-sin-investor-diligence-2026-05-19' },
        name: 'build_report_recreation_pack',
      },
    },
    { queryApi, role: 'researcher' }
  );

  assert.equal(calls[0].path, '/v1/research/evidence-packs/report-recreation');
  assert.equal(calls[0].role, 'researcher');
  assert.match(
    (((response?.result as { content: Array<{ text: string }> }).content[0]).text),
    /"ok": true/
  );
});

test('research MCP maps broad data questions to readonly analysis', async () => {
  const calls: Array<{ body: Record<string, unknown>; path: string; role: string | undefined }> = [];
  const queryApi = {
    post: async (path: string, body: unknown, role?: string) => {
      calls.push({ body: body as Record<string, unknown>, path, role });
      return { ok: true };
    },
  };

  await dispatchMcpRequest(
    {
      id: 'call-2',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          expectedRows: 10,
          question: 'Top 10 indie games',
          sql: 'SELECT appid, name FROM metrics.apps_page_projection LIMIT 10',
        },
        name: 'query_publisheriq_data',
      },
    },
    { queryApi, role: 'researcher' }
  );

  assert.equal(calls[0].path, '/v1/research/readonly-analysis');
  assert.equal(calls[0].role, 'researcher');
  assert.equal(calls[0].body.purpose, 'Top 10 indie games');
  assert.equal(calls[0].body.question, 'Top 10 indie games');
});

test('research MCP reads static resources without query-api', async () => {
  const queryApi = {
    post: async () => {
      throw new Error('should not be called');
    },
  };

  const response = await dispatchMcpRequest(
    {
      id: 3,
      jsonrpc: '2.0',
      method: 'resources/read',
      params: { uri: 'publisheriq://schemas/evidence-pack/v1' },
    },
    { queryApi, role: 'internal' }
  );

  const contents = (response?.result as { contents: Array<{ text: string }> }).contents;
  assert.match(contents[0].text, /packId/);
});
