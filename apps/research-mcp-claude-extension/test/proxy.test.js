import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MCP_URL,
  forwardJsonRpcLine,
  isCliEntrypoint,
  loadConfig,
} from '../server/proxy.js';

test('loadConfig uses the hosted MCP URL by default', () => {
  const config = loadConfig({
    RESEARCH_MCP_BEARER_TOKEN: 'secret',
  });

  assert.equal(config.url, DEFAULT_MCP_URL);
  assert.equal(config.bearerToken, 'secret');
});

test('forwards JSON-RPC requests with bearer auth', async () => {
  const calls = [];
  const response = await forwardJsonRpcLine(
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_report_archive","arguments":{"query":"mortal sin","limit":1}}}',
    {
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
          result: { content: [] },
        });
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/mcp');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(response), {
    id: 1,
    jsonrpc: '2.0',
    result: { content: [] },
  });
});

test('answers initialize locally without calling the hosted server', async () => {
  let called = false;
  const response = await forwardJsonRpcLine(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"Claude","version":"0.1.0"}}}',
    {
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    }
  );

  assert.equal(called, false);
  assert.deepEqual(JSON.parse(response), {
    id: 1,
    jsonrpc: '2.0',
    result: {
      capabilities: {
        resources: {},
        tools: {},
      },
      protocolVersion: '2025-11-25',
      serverInfo: {
        name: 'publisheriq-research',
        version: '0.1.2',
      },
    },
  });
});

test('answers tools/list locally without requiring config', async () => {
  let called = false;
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', {
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });

  assert.equal(called, false);
  const payload = JSON.parse(response);
  assert.equal(payload.id, 2);
  assert.equal(payload.jsonrpc, '2.0');
  assert.ok(payload.result.tools.some((tool) => tool.name === 'build_game_research_pack'));
  assert.ok(payload.result.tools.some((tool) => tool.name === 'get_publisheriq_data_dictionary'));
  assert.ok(payload.result.tools.some((tool) => tool.name === 'query_publisheriq_data'));
});

test('answers resources/list locally without requiring config', async () => {
  let called = false;
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":3,"method":"resources/list"}', {
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
  });

  assert.equal(called, false);
  const payload = JSON.parse(response);
  assert.equal(payload.id, 3);
  assert.equal(payload.jsonrpc, '2.0');
  assert.ok(
    payload.result.resources.some(
      (resource) => resource.uri === 'publisheriq://schemas/evidence-pack/v1'
    )
  );
});

test('does not write a response for notification-only initialization calls', async () => {
  let called = false;
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
    fetchImpl: async () => {
      called = true;
      return jsonResponse('', 202, false);
    },
  });

  assert.equal(called, false);
  assert.equal(response, null);
});

test('turns hosted auth failures into JSON-RPC errors', async () => {
  const response = await forwardJsonRpcLine(
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_report_archive","arguments":{"query":"mortal sin","limit":1}}}',
    {
      config: {
        bearerToken: 'wrong',
        timeoutMs: 1000,
        url: 'https://example.test/mcp',
      },
      fetchImpl: async () => jsonResponse({ error: 'Unauthorized' }, 401),
    }
  );

  const payload = JSON.parse(response);
  assert.equal(payload.id, 4);
  assert.equal(payload.jsonrpc, '2.0');
  assert.equal(payload.error.code, -32000);
  assert.match(payload.error.message, /HTTP 401/);
});

test('reports missing token without calling the hosted server', async () => {
  let called = false;
  const response = await forwardJsonRpcLine(
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"search_report_archive","arguments":{"query":"mortal sin","limit":1}}}',
    {
      env: {
        RESEARCH_MCP_URL: 'https://example.test/mcp',
      },
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    }
  );

  assert.equal(called, false);
  const payload = JSON.parse(response);
  assert.equal(payload.id, 5);
  assert.equal(payload.error.code, -32000);
  assert.match(payload.error.message, /RESEARCH_MCP_BEARER_TOKEN/);
});

test('local discovery works without a token', async () => {
  let called = false;
  const response = await forwardJsonRpcLine('{"jsonrpc":"2.0","id":6,"method":"tools/list"}', {
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
  assert.equal(payload.id, 6);
  assert.ok(payload.result.tools.length > 0);
});

test('recognizes CLI entrypoint paths with spaces', () => {
  assert.equal(
    isCliEntrypoint(
      'file:///Users/example/Library/Application%20Support/Claude/Claude%20Extensions/local.mcpb.publisheriq.publisheriq-research/server/proxy.js',
      '/Users/example/Library/Application Support/Claude/Claude Extensions/local.mcpb.publisheriq.publisheriq-research/server/proxy.js'
    ),
    true
  );
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
