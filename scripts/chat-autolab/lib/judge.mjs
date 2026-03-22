import path from 'node:path';

import { AUTOLAB_DIR, PERSONAS, ROOT } from './constants.mjs';
import { buildEvidenceDigest, getFamilyRubric, getPromptCalibration } from './judge-config.mjs';
import { runCodexPrompt } from './codex-runner.mjs';

const ABSOLUTE_JUDGE_TIMEOUT_MS = 120000;
const PAIRWISE_JUDGE_TIMEOUT_MS = 90000;

export async function judgePrompt({
  promptEntry,
  currentResult,
  baselineResult = null,
}) {
  const hardChecks = runHardChecks(promptEntry.prompt, currentResult);
  const calibration = getPromptCalibration(promptEntry);
  const evidenceDigest = buildEvidenceDigest(currentResult);
  const absolute = await runAbsoluteJudge({
    promptEntry,
    currentResult,
    hardChecks,
    evidenceDigest,
    calibration,
  });
  const pairwise = baselineResult
    ? await runPairwiseJudge({
        promptEntry,
        currentResult,
        baselineResult,
        hardChecks,
        candidateEvidenceDigest: evidenceDigest,
        baselineEvidenceDigest: baselineResult.evidenceDigest || buildEvidenceDigest(baselineResult),
        calibration,
      })
    : {
        verdict: 'same',
        reason: 'No prior baseline was available for comparison.',
        usage: emptyUsage(),
        rawResponse: null,
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
    evidenceDigest,
    calibration,
    absoluteJudge: {
      rawResponse: absolute.rawResponse,
      parsed: absolute.parsed,
    },
    pairwiseJudge: {
      rawResponse: pairwise.rawResponse,
      parsed: pairwise.parsed,
    },
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
  if ((result?.toolCalls || []).some((toolCall) => toolCall.success === false)) {
    flags.push('tool_failure_present');
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

async function runAbsoluteJudge({
  promptEntry,
  currentResult,
  hardChecks,
  evidenceDigest,
  calibration,
}) {
  const persona = PERSONAS[promptEntry.persona] || PERSONAS.publishing_strategy_lead;
  const familyRubric = getFamilyRubric(promptEntry.family);
  try {
    const response = await runCodexPrompt({
      cwd: ROOT,
      lastMessagePath: path.join(AUTOLAB_DIR, 'judge-absolute-last-message.txt'),
      sandbox: 'read-only',
      timeoutMs: ABSOLUTE_JUDGE_TIMEOUT_MS,
      prompt: buildAbsoluteJudgePrompt({
        promptEntry,
        persona,
        familyRubric,
        hardChecks,
        evidenceDigest,
        calibration,
        answer: currentResult.answer,
      }),
    });
    const parsed = parseJudgeJson(response, 'absolute');

    return {
      score: clampNumber(parsed.score, 0, 10),
      subscores: parsed.subscores || {},
      blockingFlags: Array.isArray(parsed.blockingFlags) ? parsed.blockingFlags : [],
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided.',
      usage: response.usage,
      rawResponse: getRawResponseText(response),
      parsed,
    };
  } catch (error) {
    return {
      score: 0,
      subscores: {},
      blockingFlags: ['absolute_judge_unavailable'],
      rationale: `Absolute judge unavailable: ${error instanceof Error ? error.message : String(error)}`,
      usage: emptyUsage(),
      rawResponse: null,
      parsed: null,
    };
  }
}

async function runPairwiseJudge({
  promptEntry,
  currentResult,
  baselineResult,
  hardChecks,
  candidateEvidenceDigest,
  baselineEvidenceDigest,
  calibration,
}) {
  const persona = PERSONAS[promptEntry.persona] || PERSONAS.publishing_strategy_lead;
  const familyRubric = getFamilyRubric(promptEntry.family);
  try {
    const response = await runCodexPrompt({
      cwd: ROOT,
      lastMessagePath: path.join(AUTOLAB_DIR, 'judge-pairwise-last-message.txt'),
      sandbox: 'read-only',
      timeoutMs: PAIRWISE_JUDGE_TIMEOUT_MS,
      prompt: buildPairwiseJudgePrompt({
        promptEntry,
        persona,
        familyRubric,
        calibration,
        hardChecks,
        baselineAnswer: baselineResult.answer,
        baselineEvidenceDigest,
        candidateAnswer: currentResult.answer,
        candidateEvidenceDigest,
      }),
    });
    const parsed = parseJudgeJson(response, 'pairwise');

    return {
      verdict: ['better', 'same', 'worse'].includes(parsed.verdict) ? parsed.verdict : 'same',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided.',
      usage: response.usage,
      rawResponse: getRawResponseText(response),
      parsed,
    };
  } catch (error) {
    return {
      verdict: 'same',
      reason: `Pairwise judge unavailable: ${error instanceof Error ? error.message : String(error)}`,
      usage: emptyUsage(),
      rawResponse: null,
      parsed: null,
    };
  }
}

function mergeUsage(left, right) {
  return {
    inputTokens: Number(left?.inputTokens || 0) + Number(right?.inputTokens || 0),
    outputTokens: Number(left?.outputTokens || 0) + Number(right?.outputTokens || 0),
    totalTokens: Number(left?.totalTokens || 0) + Number(right?.totalTokens || 0),
  };
}

function parseJudgeJson(response, mode) {
  const parsed = safeParseJson(getRawResponseText(response));
  if (parsed) {
    return parsed;
  }

  const raw = getRawResponseText(response);
  throw new Error(
    `chat-autolab ${mode} judge returned invalid JSON${raw ? `: ${truncate(raw, 240)}` : '.'}`
  );
}

function buildAbsoluteJudgePrompt({
  promptEntry,
  persona,
  familyRubric,
  hardChecks,
  evidenceDigest,
  calibration,
  answer,
}) {
  return [
    'You are a calibrated PublisherIQ judge.',
    'Your goal is to score this answer the way a careful human PublisherIQ reviewer would, not the way a generic world-knowledge critic would.',
    'Use ONLY the prompt, the answer, the family rubric, the calibration notes, the hard checks, and the same-run tool evidence provided below.',
    'If a fact is not present in the answer or the same-run tool evidence, ignore it completely.',
    'Do NOT use outside knowledge about games, companies, dates, platforms, or Steam.',
    'Do NOT reward or penalize facts that are absent from PublisherIQ evidence.',
    'Unsupported claims in the answer should reduce trustworthiness.',
    'Honest sparse answers can still score well when the evidence shows the qualifying set is genuinely sparse.',
    'referenceScore and referenceVerdict describe the last curated human score for this prompt; use them as calibration anchors, not as scores to copy blindly.',
    'targetScore and targetVerdict describe the campaign goal for this prompt.',
    'Return strict JSON only.',
    '',
    `Prompt: ${promptEntry.prompt}`,
    `Family: ${promptEntry.family}`,
    `Persona: ${persona.label}`,
    `Persona description: ${persona.description}`,
    `Calibration: ${JSON.stringify(calibration)}`,
    `Family rubric: ${JSON.stringify(familyRubric)}`,
    `Hard checks: ${JSON.stringify(hardChecks.blockingFlags)}`,
    `Same-run tool evidence: ${JSON.stringify(evidenceDigest)}`,
    `Answer: ${answer}`,
    '',
    'Score the answer on this 0-10 scale using these subscores: directness, completeness, relevance, trustworthiness, decision_value, grace_under_ambiguity.',
    'Respond with JSON in this exact shape:',
    '{"score": number, "subscores": {"directness": number, "completeness": number, "relevance": number, "trustworthiness": number, "decision_value": number, "grace_under_ambiguity": number}, "blockingFlags": string[], "rationale": string}',
  ].join('\n');
}

function buildPairwiseJudgePrompt({
  promptEntry,
  persona,
  familyRubric,
  calibration,
  hardChecks,
  baselineAnswer,
  baselineEvidenceDigest,
  candidateAnswer,
  candidateEvidenceDigest,
}) {
  return [
    'You are a calibrated PublisherIQ pairwise judge.',
    'Compare the candidate answer against the baseline answer using only the provided same-run evidence, family rubric, and calibration notes.',
    'Do NOT use outside knowledge or any facts absent from the provided evidence.',
    'Prefer the answer that is more faithful to PublisherIQ evidence, more on-shape for the prompt family, and more useful to the named persona using only that evidence.',
    'Exact-constraint families should punish false positives heavily.',
    'referenceScore and referenceVerdict are calibration anchors from human review; targetScore is the campaign goal.',
    'Return strict JSON only.',
    '',
    `Prompt: ${promptEntry.prompt}`,
    `Family: ${promptEntry.family}`,
    `Persona: ${persona.label}`,
    `Calibration: ${JSON.stringify(calibration)}`,
    `Family rubric: ${JSON.stringify(familyRubric)}`,
    `Candidate hard checks: ${JSON.stringify(hardChecks.blockingFlags)}`,
    `Baseline evidence: ${JSON.stringify(baselineEvidenceDigest)}`,
    `Baseline answer: ${baselineAnswer}`,
    `Candidate evidence: ${JSON.stringify(candidateEvidenceDigest)}`,
    `Candidate answer: ${candidateAnswer}`,
    '',
    'Choose one verdict: better, same, or worse.',
    'Respond with JSON in this exact shape:',
    '{"verdict": "better" | "same" | "worse", "reason": string}',
  ].join('\n');
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function getRawResponseText(response) {
  return String(response?.text || response?.lastMessage || response?.content || '').trim();
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

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}
