import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

export async function runCodexIteration({
  cwd,
  prompt,
  lastMessagePath,
  onEvent = null,
}) {
  return runCodexPrompt({
    cwd,
    prompt,
    lastMessagePath,
    sandbox: 'workspace-write',
    fullAuto: true,
    onEvent,
  });
}

export async function runCodexPrompt({
  cwd,
  prompt,
  lastMessagePath,
  sandbox = 'read-only',
  fullAuto = false,
  model = null,
  onEvent = null,
}) {
  await fs.writeFile(lastMessagePath, '');

  return new Promise((resolve, reject) => {
    const args = ['exec', '--json', '--sandbox', sandbox, '-C', cwd, '-o', lastMessagePath];
    if (fullAuto) {
      args.push('--full-auto');
    }
    if (model) {
      args.push('-m', model);
    }
    args.push('-');

    const child = spawn('codex', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let stderr = '';
    let stdoutBuffer = '';

    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'turn.completed' && event.usage) {
            usage = {
              inputTokens: Number(event.usage.input_tokens || 0),
              outputTokens: Number(event.usage.output_tokens || 0),
              totalTokens:
                Number(event.usage.input_tokens || 0) + Number(event.usage.output_tokens || 0),
            };
          }
          if (event.type === 'item.completed' && typeof event.item?.text === 'string' && onEvent) {
            onEvent(event.item.text);
          }
        } catch {
          // Ignore non-JSON lines emitted by the CLI.
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', async (code) => {
      if (code !== 0) {
        reject(new Error(`codex exec failed with code ${code}: ${stderr.trim()}`));
        return;
      }
      const lastMessage = await safeRead(lastMessagePath);
      resolve({
        usage,
        lastMessage: lastMessage.trim(),
      });
    });
  });
}

async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
