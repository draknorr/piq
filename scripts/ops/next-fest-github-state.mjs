#!/usr/bin/env node
// GitHub Actions state handoff. Artifact loss fails closed; never resets a budget.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function selectState({ current, runs, artifacts, jobsByRun, part, now }) {
  if (part === 2) {
    const artifact = artifacts.find(a => !a.expired && a.workflow_run?.id === current.id && a.name === 'next-fest-state-1');
    if (!artifact) throw new Error('CCU journal artifact is missing');
    return artifact;
  }
  let hadCollection = false;
  for (const run of runs.filter(r => r.id < current.id).sort((a, b) => b.id - a.id)) {
    const jobs = jobsByRun[run.id];
    if (!jobs) throw new Error('Run history is incomplete');
    for (const [name, partNumber] of [['reviews', 2], ['ccu', 1]]) {
      const job = jobs.find(j => j.name === name);
      const step = job?.steps?.find(s => s.name === 'Collect festival observations');
      const started = step && step.conclusion !== 'skipped' && step.status !== 'queued';
      hadCollection ||= Boolean(started);
      const artifact = artifacts.find(a => !a.expired && a.workflow_run?.id === run.id && a.name === `next-fest-state-${partNumber}`);
      if (artifact) return artifact;
      // A failure before collection must not extend the recovery wait forever.
      // An interrupted collector without its final archive may have spent calls.
      if (started && (run.conclusion === 'success' || now - Date.parse(run.updated_at) < 86400000)) {
        throw new Error('Prior collection has no final journal; wait 24 hours or recover its artifact');
      }
    }
  }
  if (hadCollection) throw new Error('All prior journals are missing; refusing to reset history');
  return null;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const part = Number(process.argv[2]);
  if (!repo || !Number.isSafeInteger(runId) || ![1, 2].includes(part)) throw new Error('GitHub run and part are required');
  const api = route => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8' }));
  const today = new Date().toISOString().slice(0, 10);
  if (today < '2026-10-20' || today > '2026-11-02') throw new Error('Next Fest collection window is closed');
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Do not rerun a partially collected GitHub run; dispatch a new run to restore its state');
  const current = api(`repos/${repo}/actions/runs/${runId}`);
  if (!current.created_at.startsWith(today)) throw new Error('A delayed run crossed its UTC day; wait for the next scheduled run');
  const runs = api(`repos/${repo}/actions/workflows/${current.workflow_id}/runs?per_page=100`).workflow_runs;
  if (runs.length === 100) throw new Error('Unexpected run history volume; inspect before collecting');
  const artifacts = [1, 2].flatMap(n => api(`repos/${repo}/actions/artifacts?name=next-fest-state-${n}&per_page=100`).artifacts);
  const jobsByRun = {};
  if (part === 1) for (const run of runs.filter(r => r.id < runId)) {
    jobsByRun[run.id] = api(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
  }
  const latest = selectState({ current, runs, artifacts, jobsByRun, part, now: Date.now() });
  const directory = 'output/steam-next-fest-2026-10/daily';
  if (latest) {
    const destination = `${process.env.RUNNER_TEMP}/next-fest-restore-${part}`;
    await mkdir(destination, { recursive: true });
    execFileSync('gh', ['run', 'download', String(latest.workflow_run.id), '--repo', repo,
      '--name', latest.name, '--dir', destination], { stdio: 'inherit' });
    await cp(`${destination}/${directory}`, directory, { recursive: true });
  }
  // A validated empty initial journal is still meaningful durable state.
  await mkdir(directory, { recursive: true });
  await (await open(`${directory}/${today}.journal.jsonl`, 'a')).close();
  console.log(JSON.stringify({ day: today, part, restoredArtifact: latest?.id ?? null }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
