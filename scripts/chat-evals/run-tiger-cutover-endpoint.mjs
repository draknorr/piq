#!/usr/bin/env node

import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  [
    'scripts/chat-evals/run-full-blended-endpoint.mjs',
    '--inventory',
    'tiger-cutover',
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

