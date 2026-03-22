import { serializeCookies } from './env.mjs';

const REQUEST_TIMEOUT_MS = 120000;

export async function evaluatePrompt({
  origin,
  evalSecret,
  auth,
  prompt,
}) {
  const response = await fetch(new URL('/api/chat/eval', origin), {
    method: 'POST',
    headers: {
      Cookie: serializeCookies(auth.cookieJar),
      'Content-Type': 'application/json',
      'x-chat-eval-secret': evalSecret,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    return {
      status: 'error',
      errorMessage: raw,
      answer: '',
      toolCalls: [],
      timing: null,
      usage: null,
      iterations: null,
    };
  }

  return parseSse(await response.text());
}

function parseSse(rawSse) {
  const answerChunks = [];
  const toolCalls = [];
  let timing = null;
  let usage = null;
  let iterations = null;
  let errorMessage = null;

  for (const block of rawSse.split('\n\n')) {
    const line = block
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.startsWith('data: '));
    if (!line) continue;

    let event;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    if (event.type === 'text_delta' && typeof event.delta === 'string') {
      answerChunks.push(event.delta);
      continue;
    }

    if (event.type === 'tool_result') {
      toolCalls.push({
        name: event.name,
        arguments: event.arguments || {},
        executionMs: event.timing?.executionMs ?? null,
        success: event.result?.success !== false,
        result: event.result || null,
        summary: summarizeToolResult(event.result),
      });
      continue;
    }

    if (event.type === 'message_end') {
      timing = event.timing || null;
      usage = event.usage
        ? {
            inputTokens: Number(event.usage.inputTokens || 0),
            outputTokens: Number(event.usage.outputTokens || 0),
            totalTokens:
              Number(event.usage.inputTokens || 0) + Number(event.usage.outputTokens || 0),
          }
        : null;
      iterations = event.debug?.iterations ?? null;
      continue;
    }

    if (event.type === 'error') {
      errorMessage = event.message || 'Unknown SSE error';
    }
  }

  return {
    status: errorMessage ? 'error' : 'success',
    errorMessage,
    answer: answerChunks.join(''),
    toolCalls,
    timing,
    usage,
    iterations,
  };
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (typeof result.total_found === 'number') return `${result.total_found} results`;
  if (typeof result.rowCount === 'number') return `${result.rowCount} rows`;
  if (Array.isArray(result.results)) return `${result.results.length} results`;
  if (Array.isArray(result.events)) return `${result.events.length} events`;
  if (Array.isArray(result.diffs)) return `${result.diffs.length} diffs`;
  return null;
}
