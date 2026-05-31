import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_MCP_URL, forwardJsonRpcLine, loadConfig } from '../server/proxy.js';

test('loadConfig uses the hosted MCP URL by default', () => {
  const config = loadConfig({
    RESEARCH_MCP_BEARER_TOKEN: 'secret',
  });

  assert.equal(config.url, DEFAULT_MCP_URL);
  assert.equal(config.bearerToken, 'secret');
});

test('forwards JSON-RPC requests with bearer auth', async () => {
  const calls = [];
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
    config: {
      bearerToken: 'secret',
      timeoutMs: 1000,
      url: 'https://example.test/mcp',
    },
    fetchImpl: async (url, init) => {
      calls.push({ init, url });
      return jsonResponse({
        id: 1,
        jsonrpc: '2.0',
        result: { tools: [] },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/mcp');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(response), {
    id: 1,
    jsonrpc: '2.0',
    result: { tools: [] },
  });
});

test('does not write a response for notification-only calls with no hosted response body', async () => {
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
    config: {
      bearerToken: 'secret',
      timeoutMs: 1000,
      url: 'https://example.test/mcp',
    },
    fetchImpl: async () => jsonResponse('', 202, false),
  });

  assert.equal(response, null);
});

test('turns hosted auth failures into JSON-RPC errors', async () => {
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', {
    config: {
      bearerToken: 'wrong',
      timeoutMs: 1000,
      url: 'https://example.test/mcp',
    },
    fetchImpl: async () => jsonResponse({ error: 'Unauthorized' }, 401),
  });

  const payload = JSON.parse(response);
  assert.equal(payload.id, 2);
  assert.equal(payload.jsonrpc, '2.0');
  assert.equal(payload.error.code, -32000);
  assert.match(payload.error.message, /HTTP 401/);
});

test('reports missing token without calling the hosted server', async () => {
  let called = false;
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":3,"method":"tools/list"}', {
    env: {
      RESEARCH_MCP_URL: 'https://example.test/mcp',
    },
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });

  assert.equal(called, false);
  const payload = JSON.parse(response);
  assert.equal(payload.id, 3);
  assert.equal(payload.error.code, -32000);
  assert.match(payload.error.message, /RESEARCH_MCP_BEARER_TOKEN/);
});

test('returns JSON-RPC parse errors for invalid input', async () => {
  const response = await forwardJsonRpcLine('{not json', {
    config: {
      bearerToken: 'secret',
      timeoutMs: 1000,
      url: 'https://example.test/mcp',
    },
  });

  assert.deepEqual(JSON.parse(response), {
    error: {
      code: -32700,
      message: 'Invalid JSON-RPC request.',
    },
    id: null,
    jsonrpc: '2.0',
  });
});

function jsonResponse(body, status = 200, encodeJson = true) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => {
      if (!encodeJson) {
        return String(body);
      }
      return JSON.stringify(body);
    },
  };
}
