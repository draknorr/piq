import readline from 'node:readline';

export const DEFAULT_MCP_URL = 'https://publisheriq-research-mcp-prod-production.up.railway.app/mcp';

const DEFAULT_TIMEOUT_MS = 60_000;

export function loadConfig(env = process.env) {
  const url = (env.RESEARCH_MCP_URL || DEFAULT_MCP_URL).trim();
  const bearerToken = (env.RESEARCH_MCP_BEARER_TOKEN || '').trim();

  if (!url) {
    throw new Error('Missing RESEARCH_MCP_URL.');
  }
  if (!bearerToken) {
    throw new Error('Missing RESEARCH_MCP_BEARER_TOKEN.');
  }

  return {
    bearerToken,
    timeoutMs: readPositiveNumber(env.RESEARCH_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    url,
  };
}

export async function forwardJsonRpcLine(line, options = {}) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    return JSON.stringify(errorResponse(null, -32700, 'Invalid JSON-RPC request.'));
  }

  const hasResponse = Object.prototype.hasOwnProperty.call(request, 'id');

  let config;
  try {
    config = options.config ?? loadConfig(options.env);
  } catch (error) {
    if (!hasResponse) {
      return null;
    }
    return JSON.stringify(errorResponse(request.id, -32000, messageFromError(error)));
  }

  try {
    const payload = await postToHostedMcp(trimmed, {
      config,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
    });
    return payload === null ? null : JSON.stringify(payload);
  } catch (error) {
    if (!hasResponse) {
      return null;
    }
    return JSON.stringify(errorResponse(request.id, -32000, messageFromError(error)));
  }
}

export function startProxy(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;

  const lines = readline.createInterface({
    input,
    output,
    terminal: false,
  });

  lines.on('line', (line) => {
    void forwardJsonRpcLine(line, { env, fetchImpl })
      .then((responseLine) => {
        if (responseLine) {
          output.write(`${responseLine}\n`);
        }
      })
      .catch((error) => {
        errorOutput.write(`${messageFromError(error)}\n`);
      });
  });
}

async function postToHostedMcp(body, { config, fetchImpl }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This extension requires a Node runtime with fetch support.');
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      body,
      headers: {
        authorization: `Bearer ${config.bearerToken}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: abortController.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`PublisherIQ MCP request failed with HTTP ${response.status}: ${text || 'empty response'}`);
    }
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('PublisherIQ MCP returned invalid JSON.');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorResponse(id, code, message) {
  return {
    error: {
      code,
      message,
    },
    id,
    jsonrpc: '2.0',
  };
}

function messageFromError(error) {
  return error instanceof Error ? error.message : 'Unknown PublisherIQ MCP proxy error.';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startProxy();
}
