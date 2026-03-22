import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureLocalServer({
  cwd,
  port,
  serverLogPath,
  env,
  existingPid = null,
}) {
  const origin = `http://127.0.0.1:${port}`;
  if (await isServerHealthy(origin)) {
    return {
      origin,
      pid: existingPid,
      evalSecret: env.CHAT_EVAL_SECRET,
      startedByAutolab: false,
    };
  }

  const evalSecret = env.CHAT_EVAL_SECRET || crypto.randomUUID();
  await fs.mkdir(path.dirname(serverLogPath), { recursive: true });
  const logHandle = await fs.open(serverLogPath, 'a');

  const child = spawn(
    'pnpm',
    ['--filter', '@publisheriq/admin', 'exec', 'next', 'dev', '--port', String(port)],
    {
      cwd,
      env: {
        ...process.env,
        ...env,
        CHAT_EVAL_SECRET: evalSecret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    }
  );

  child.stdout?.pipe(logHandle.createWriteStream());
  child.stderr?.pipe(logHandle.createWriteStream());
  child.unref();

  await waitForHealthy(origin);

  return {
    origin,
    pid: child.pid,
    evalSecret,
    startedByAutolab: true,
  };
}

async function isServerHealthy(origin) {
  try {
    const response = await fetch(new URL('/login', origin), {
      redirect: 'manual',
    });
    return response.status === 200 || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}

async function waitForHealthy(origin, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerHealthy(origin)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for local admin server at ${origin}`);
}
