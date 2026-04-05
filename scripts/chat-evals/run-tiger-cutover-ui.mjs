#!/usr/bin/env node

import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  [
    'scripts/chat-evals/run-full-blended-ui.mjs',
    '--inventory',
    'tiger-cutover',
    '--smoke-only',
    ...process.argv.slice(2),
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
