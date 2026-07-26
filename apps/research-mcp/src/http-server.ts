import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadResearchMcpConfig, type ResearchMcpRole } from './config.js';
import { dispatchMcpRequest } from './dispatcher.js';
import { QueryApiClient } from './query-api-client.js';

const config = loadResearchMcpConfig();
const queryApi = new QueryApiClient(config);

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!config.bearerToken) {
    return true;
  }
  return request.headers.authorization === `Bearer ${config.bearerToken}`;
}

function resolveRole(request: IncomingMessage): ResearchMcpRole {
  const header = request.headers['x-publisheriq-research-role'];
  const value = Array.isArray(header) ? header[0] : header;
  return value === 'admin' || value === 'researcher' || value === 'internal'
    ? value
    : config.defaultRole;
}

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, {
        ok: true,
        service: 'publisheriq-research-mcp',
      });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized' });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJson(request);
    const result = await dispatchMcpRequest(
      body as { id?: number | string | null; method: string; params?: Record<string, unknown> },
      {
        queryApi,
        role: resolveRole(request),
      }
    );

    if (result === null) {
      response.writeHead(202).end();
      return;
    }

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown research MCP error',
    });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(config.port, config.host, () => {
    console.log(`PublisherIQ research MCP listening on http://${config.host}:${config.port}/mcp`);
  });
}
