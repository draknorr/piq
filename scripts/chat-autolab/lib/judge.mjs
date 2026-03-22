import path from 'node:path';

import { AUTOLAB_DIR, PERSONAS, ROOT } from './constants.mjs';
import { runCodexPrompt } from './codex-runner.mjs';

export async function judgePrompt({
  promptEntry,
  currentResult,
  baselineResult = null,
}) {
  const hardChecks = runHardChecks(promptEntry.prompt, currentResult);
  const absolute = await runAbsoluteJudge({
    promptEntry,
    currentResult,
    hardChecks,
  });
  const pairwise = baselineResult
    ? await runPairwiseJudge({
        promptEntry,
        currentResult,
        baselineResult,
        hardChecks,
      })
    : {
        verdict: 'same',
        reason: 'No prior baseline was available for comparison.',
        usage: emptyUsage(),
      };

  const blockingFlags = [...new Set([...(hardChecks.blockingFlags || []), ...(absolute.blockingFlags || [])])];

  return {
    score: Number(absolute.score || 0),
    subscores: absolute.subscores,
    blockingFlags,
    rationale: absolute.rationale,
    pairwiseVerdict: pairwise.verdict,
    pairwiseReason: pairwise.reason,
    hardChecks,
    usage: mergeUsage(absolute.usage, pairwise.usage),
  };
}

function runHardChecks(prompt, result) {
  const flags = [];
  const answer = String(result?.answer || '');
  const normalizedPrompt = prompt.toLowerCase();

  if (result?.status !== 'success') {
    flags.push('transport_error');
  }
  if (answer.trim().length < 140) {
    flags.push('thin_output');
  }
  if ((result?.toolCalls?.length || 0) === 0) {
    flags.push('no_tools');
  }
  if (/\b(today|yesterday|tomorrow|this week|this month|last 30 days|recent|recently|right now)\b/i.test(normalizedPrompt)) {
    if (!/\b\d{4}-\d{2}-\d{2}\b/.test(answer) && !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/.test(answer)) {
      flags.push('relative_date_not_grounded');
    }
  }

  const repeatedLines = answer
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (repeatedLines.length >= 4 && new Set(repeatedLines).size <= Math.max(1, repeatedLines.length / 2)) {
    flags.push('repeated_output');
  }

  return {
    blockingFlags: flags,
  };
}

async function runAbsoluteJudge({ promptEntry, currentResult, hardChecks }) {
  const persona = PERSONAS[promptEntry.persona] || PERSONAS.publishing_strategy_lead;
  const response = await runCodexPrompt({
    cwd: ROOT,
    lastMessagePath: path.join(AUTOLAB_DIR, 'judge-absolute-last-message.txt'),
    sandbox: 'read-only',
    prompt: [
      'Judge the quality of a product chat answer for PublisherIQ.',
      'Return strict JSON only. No markdown, no prose before or after the JSON.',
      'If the answer is polished but wrong, score it down.',
      '',
      `Persona: ${persona.label}`,
      `Persona description: ${persona.description}`,
      `Prompt: ${promptEntry.prompt}`,
      `Answer: ${currentResult.answer}`,
      `Tool calls: ${JSON.stringify(currentResult.toolCalls)}`,
      `Hard checks: ${JSON.stringify(hardChecks.blockingFlags)}`,
      'Rubric: directness, completeness, relevance, trustworthiness, decision_value, grace_under_ambiguity.',
      'Respond with JSON in this shape:',
      '{"score": number, "subscores": {"directness": number, "completeness": number, "relevance": number, "trustworthiness": number, "decision_value": number, "grace_under_ambiguity": number}, "blockingFlags": string[], "rationale": string}',
    ].join('\n'),
  });
  const parsed = safeParseJson(response.content) || {};

  return {
    score: clampNumber(parsed.score, 0, 10),
    subscores: parsed.subscores || {},
    blockingFlags: Array.isArray(parsed.blockingFlags) ? parsed.blockingFlags : [],
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided.',
    usage: response.usage,
  };
}

async function runPairwiseJudge({ promptEntry, currentResult, baselineResult, hardChecks }) {
  const persona = PERSONAS[promptEntry.persona] || PERSONAS.publishing_strategy_lead;
  const response = await runCodexPrompt({
    cwd: ROOT,
    lastMessagePath: path.join(AUTOLAB_DIR, 'judge-pairwise-last-message.txt'),
    sandbox: 'read-only',
    prompt: [
      'Compare a candidate answer against a baseline answer for PublisherIQ chat quality.',
      'Return strict JSON only. No markdown, no prose before or after the JSON.',
      'Choose one verdict: better, same, or worse.',
      '',
      `Persona: ${persona.label}`,
      `Persona description: ${persona.description}`,
      `Prompt: ${promptEntry.prompt}`,
      `Baseline answer: ${baselineResult.answer}`,
      `Candidate answer: ${currentResult.answer}`,
      `Candidate hard checks: ${JSON.stringify(hardChecks.blockingFlags)}`,
      'Respond with JSON in this shape:',
      '{"verdict": "better" | "same" | "worse", "reason": string}',
    ].join('\n'),
  });
  const parsed = safeParseJson(response.content) || {};

  return {
    verdict: ['better', 'same', 'worse'].includes(parsed.verdict) ? parsed.verdict : 'same',
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided.',
    usage: response.usage,
  };
}

function mergeUsage(left, right) {
  return {
    inputTokens: Number(left?.inputTokens || 0) + Number(right?.inputTokens || 0),
    outputTokens: Number(left?.outputTokens || 0) + Number(right?.outputTokens || 0),
    totalTokens: Number(left?.totalTokens || 0) + Number(right?.totalTokens || 0),
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/\{[\s\S]*\}$/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}
