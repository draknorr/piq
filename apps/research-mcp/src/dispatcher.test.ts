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
  assert.ok(Array.isArray((tools?.result as { tools?: unknown[] }).tools));

  const resources = await dispatchMcpRequest(
    { id: 2, jsonrpc: '2.0', method: 'resources/list' },
    { queryApi, role: 'internal' }
  );
  assert.ok(Array.isArray((resources?.result as { resources?: unknown[] }).resources));
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
