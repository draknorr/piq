import readline from 'node:readline';

import { loadResearchMcpConfig } from './config.js';
import { dispatchMcpRequest } from './dispatcher.js';
import { QueryApiClient } from './query-api-client.js';

const config = loadResearchMcpConfig();
const queryApi = new QueryApiClient(config);

const lines = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

lines.on('line', (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) {
    return;
  }

  try {
    const request = JSON.parse(line) as {
      id?: number | string | null;
      method: string;
      params?: Record<string, unknown>;
    };
    const response = await dispatchMcpRequest(request, {
      queryApi,
      role: config.defaultRole,
    });
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : 'Invalid JSON-RPC request',
        },
        id: null,
        jsonrpc: '2.0',
      })}\n`
    );
  }
}
