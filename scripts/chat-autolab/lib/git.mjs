import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ROOT } from './constants.mjs';

const execFileAsync = promisify(execFile);

export async function ensureSafeRemote(remote) {
  const remotes = await listRemotes();
  const remoteUrl = remotes.get(remote);
  if (!remoteUrl) {
    throw new Error(`Missing git remote "${remote}". Create a dedicated automation fork remote before running chat-autolab.`);
  }
  const normalized = remoteUrl.toLowerCase();
  if (remote === 'origin' || normalized.includes('/main') || normalized.includes(':main')) {
    throw new Error(`Unsafe automation remote "${remote}" -> ${remoteUrl}`);
  }
  return remoteUrl;
}

export async function createWorktree({ runId, branch, baseBranch, worktreeDir }) {
  await execGit(['worktree', 'add', '-B', branch, worktreeDir, baseBranch]);
  return worktreeDir;
}

export async function getHeadSha(cwd = ROOT) {
  const { stdout } = await execGit(['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

export async function getChangedFiles(cwd = ROOT) {
  const { stdout } = await execGit(['diff', '--name-only'], { cwd });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function hasWorkingTreeChanges(cwd = ROOT) {
  const { stdout } = await execGit(['status', '--porcelain'], { cwd });
  return stdout.trim().length > 0;
}

export async function discardWorkingTree(cwd = ROOT) {
  await execGit(['reset', '--hard', 'HEAD'], { cwd });
  await execGit(['clean', '-fd'], { cwd });
}

export async function commitAll({ cwd = ROOT, message }) {
  await execGit(['add', '-A'], { cwd });
  await execGit(['commit', '-m', message], { cwd });
  return getHeadSha(cwd);
}

export async function pushBranch({ cwd = ROOT, remote, branch }) {
  await execGit(['push', remote, `${branch}:${branch}`], { cwd });
}

export async function removeWorktree(worktreeDir) {
  await execGit(['worktree', 'remove', '--force', worktreeDir]);
}

async function listRemotes() {
  const { stdout } = await execGit(['remote', '-v']);
  const map = new Map();
  for (const line of stdout.split('\n')) {
    const [name, url] = line.trim().split(/\s+/);
    if (!name || !url || map.has(name)) continue;
    map.set(name, url);
  }
  return map;
}

async function execGit(args, { cwd = ROOT } = {}) {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 8,
  });
}
