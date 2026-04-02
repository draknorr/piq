import fs from 'node:fs/promises';

export async function loadEvalEnvFiles(files, baseEnv = process.env) {
  const env = { ...baseEnv };

  for (const file of files) {
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) {
        continue;
      }

      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in env)) {
        env[key] = value;
      }
    }
  }

  return env;
}

export function validateEvalEnv({ env, origin }) {
  const requiredKeys = shouldUseLocalEvalBypass(origin, env)
    ? ['CHAT_EVAL_SECRET']
    : ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BYPASS_AUTH_EMAIL'];

  for (const key of requiredKeys) {
    if (!env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  if (!readEvalBypassEmail(env)) {
    throw new Error('Missing required env var: CHAT_EVAL_BYPASS_EMAIL or BYPASS_AUTH_EMAIL');
  }
}

export async function authenticateEval({ env, origin }) {
  const bypassEmail = readEvalBypassEmail(env);
  if (!bypassEmail) {
    throw new Error('Missing required env var: CHAT_EVAL_BYPASS_EMAIL or BYPASS_AUTH_EMAIL');
  }

  if (shouldUseLocalEvalBypass(origin, env)) {
    return {
      authMode: 'eval_bypass',
      cookieJar: new Map(),
      email: bypassEmail,
      evalSecret: env.CHAT_EVAL_SECRET,
    };
  }

  const generateResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: bypassEmail,
    }),
  });

  if (!generateResponse.ok) {
    throw new Error(`Failed to generate auth link: ${generateResponse.status}`);
  }

  const generated = await generateResponse.json();
  if (!generated.hashed_token) {
    throw new Error('Missing hashed_token from generated auth link');
  }

  const cookieJar = new Map();
  const confirmUrl = new URL('/auth/confirm', origin);
  confirmUrl.searchParams.set('token_hash', generated.hashed_token);
  confirmUrl.searchParams.set('type', 'magiclink');
  confirmUrl.searchParams.set('next', '/chat');

  const confirmResponse = await fetch(confirmUrl, {
    method: 'GET',
    redirect: 'manual',
  });

  storeResponseCookies(confirmResponse, cookieJar);

  if (confirmResponse.status !== 307 && confirmResponse.status !== 302) {
    throw new Error(`Unexpected auth confirm status: ${confirmResponse.status}`);
  }

  const chatResponse = await fetch(new URL('/chat', origin), {
    headers: {
      Cookie: serializeCookies(cookieJar),
    },
    redirect: 'manual',
  });

  if (chatResponse.status >= 300 && chatResponse.status < 400) {
    const location = chatResponse.headers.get('location') || '';
    throw new Error(`Authentication failed, redirected to ${location || 'unknown location'}`);
  }

  return {
    authMode: 'magiclink',
    cookieJar,
    email: bypassEmail,
    evalSecret: null,
  };
}

export async function assertChatOriginReachable({ origin, timeoutMs = 5000 }) {
  try {
    const response = await fetch(new URL('/chat', origin), {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach chat origin ${origin}. Start the local admin app or pass --origin. Underlying error: ${message}`
    );
  }
}

export async function evaluateChatRequest({ auth, origin, requestBody, timeoutMs }) {
  try {
    const headers = {
      Cookie: serializeCookies(auth.cookieJar),
      'Content-Type': 'application/json',
    };

    if (auth.evalSecret) {
      headers['x-chat-eval-secret'] = auth.evalSecret;
    }

    const response = await fetch(new URL('/api/chat/stream', origin), {
      body: JSON.stringify(requestBody),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const raw = await response.text();
      const errorMessage = raw || `HTTP ${response.status}`;

      return {
        assistant_output_raw: '',
        error_message: errorMessage,
        failure_kind: classifyFailure({
          errorMessage,
          httpStatus: response.status,
          messageEndReceived: false,
          transportOk: false,
        }),
        http_status: response.status,
        iterations: null,
        message_end_received: false,
        quality: null,
        raw_sse: raw,
        sessionContext: null,
        executionTrace: null,
        status: 'error',
        tigerPrimary: null,
        tigerShadow: null,
        timing: null,
        tool_calls: [],
        transport_ok: false,
      };
    }

    const rawSse = await response.text();
    const parsed = parseSse(rawSse);
    const errorMessage =
      parsed.error_message || (parsed.message_end_received ? null : 'Missing message_end SSE event');

    return {
      assistant_output_raw: parsed.assistant_output_raw,
      error_message: errorMessage,
      failure_kind: classifyFailure({
        errorMessage,
        httpStatus: response.status,
        messageEndReceived: parsed.message_end_received,
        transportOk: true,
      }),
      http_status: response.status,
      iterations: parsed.iterations,
      message_end_received: parsed.message_end_received,
      quality: parsed.quality,
      raw_sse: rawSse,
      sessionContext: parsed.sessionContext,
      executionTrace: parsed.executionTrace,
      status: errorMessage ? 'error' : 'success',
      tigerPrimary: parsed.tigerPrimary,
      tigerShadow: parsed.tigerShadow,
      timing: parsed.timing,
      tool_calls: parsed.tool_calls,
      transport_ok: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      assistant_output_raw: '',
      error_message: errorMessage,
      failure_kind: classifyFailure({
        errorMessage,
        httpStatus: null,
        messageEndReceived: false,
        transportOk: false,
      }),
      http_status: null,
      iterations: null,
      message_end_received: false,
      quality: null,
      raw_sse: '',
      sessionContext: null,
      executionTrace: null,
      status: 'error',
      tigerPrimary: null,
      tigerShadow: null,
      timing: null,
      tool_calls: [],
      transport_ok: false,
    };
  }
}

export async function evaluateScenario({ auth, delayMs = 0, origin, scenario, timeoutMs }) {
  const turns = [];
  const messages = [];
  let sessionContext = null;
  let status = 'success';

  for (let index = 0; index < scenario.turns.length; index += 1) {
    const turn = scenario.turns[index];
    const userMessage = { role: 'user', content: turn.user };
    const requestMessages = [...messages, userMessage];
    const result = await evaluateChatRequest({
      auth,
      origin,
      requestBody: {
        messages: requestMessages,
        sessionContext,
      },
      timeoutMs,
    });

    turns.push({
      assistant_output_raw: result.assistant_output_raw,
      error_message: result.error_message,
      expectation: turn.expectation,
      failure_kind: result.failure_kind,
      http_status: result.http_status,
      iterations: result.iterations,
      message_end_received: result.message_end_received,
      quality: result.quality,
      raw_sse: result.raw_sse,
      sessionContext: result.sessionContext,
      executionTrace: result.executionTrace,
      session_context_summary: summarizeScenarioSessionContext(result.sessionContext),
      status: result.status,
      tiger_primary: result.tigerPrimary,
      tiger_shadow: result.tigerShadow,
      timing: result.timing,
      tool_calls: result.tool_calls,
      transport_ok: result.transport_ok,
      turn_index: index + 1,
      user_prompt: turn.user,
    });

    if (result.status !== 'success') {
      status = 'error';
      break;
    }

    sessionContext = result.sessionContext ?? sessionContext;
    messages.push(userMessage, { role: 'assistant', content: result.assistant_output_raw });

    if (delayMs > 0 && index < scenario.turns.length - 1) {
      await sleep(delayMs);
    }
  }

  return {
    final_output: turns[turns.length - 1]?.assistant_output_raw || '',
    notes: scenario.notes,
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    status,
    turns,
  };
}

export function parseSse(rawSse) {
  const assistantOutput = [];
  const toolCalls = [];
  let timing = null;
  let iterations = null;
  let errorMessage = null;
  let quality = null;
  let sessionContext = null;
  let executionTrace = null;
  let tigerPrimary = null;
  let tigerShadow = null;
  let messageEndReceived = false;

  for (const block of String(rawSse || '').split('\n\n')) {
    const line = block
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.startsWith('data: '));
    if (!line) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    if (event.type === 'text_delta' && typeof event.delta === 'string') {
      assistantOutput.push(event.delta);
      continue;
    }

    if (event.type === 'tool_result') {
      toolCalls.push({
        arguments: event.arguments || {},
        error_message: typeof event.result?.error === 'string' ? event.result.error : null,
        executionMs: event.timing?.executionMs ?? null,
        failure_kind:
          typeof event.result?.failure_kind === 'string' ? event.result.failure_kind : null,
        name: event.name,
        result_payload: sanitizeToolResultPayload(event.name, event.result),
        result_summary: summarizeToolResult(event.result),
        success: event.result?.success !== false,
        unavailable: event.result?.unavailable === true,
      });
      continue;
    }

    if (event.type === 'message_end') {
      timing = event.timing || null;
      iterations = event.debug?.iterations ?? null;
      quality = event.quality || null;
      sessionContext = event.sessionContext || null;
      executionTrace = Array.isArray(event.executionTrace) ? event.executionTrace : null;
      tigerPrimary = event.tigerPrimary || null;
      tigerShadow = event.tigerShadow || null;
      messageEndReceived = true;
      continue;
    }

    if (event.type === 'error') {
      errorMessage = event.message || 'Unknown SSE error';
    }
  }

  return {
    assistant_output_raw: assistantOutput.join(''),
    error_message: errorMessage,
    iterations,
    message_end_received: messageEndReceived,
    quality,
    sessionContext,
    executionTrace,
    tigerPrimary,
    tigerShadow,
    timing,
    tool_calls: toolCalls,
  };
}

export function summarizeScenarioSessionContext(sessionContext) {
  if (!sessionContext || typeof sessionContext !== 'object') {
    return null;
  }

  const entities = Array.isArray(sessionContext.entities)
    ? sessionContext.entities
        .slice(0, 4)
        .map((entity) => `${entity.kind}:${entity.name}`)
    : [];
  const constraints = Array.isArray(sessionContext.constraints)
    ? sessionContext.constraints
        .slice(0, 4)
        .map((constraint) => `${constraint.key}=${constraint.value}`)
    : [];
  const candidateSet =
    sessionContext.candidateSet &&
    Array.isArray(sessionContext.candidateSet.names) &&
    sessionContext.candidateSet.names.length > 0
      ? `${sessionContext.candidateSet.kind}: ${sessionContext.candidateSet.names.slice(0, 5).join(', ')}`
      : null;

  return {
    candidateSet,
    constraints,
    entities,
    lastAnswer: sessionContext.lastAnswer?.summary || null,
  };
}

export function shouldUseLocalEvalBypass(origin, env) {
  if (env.CHAT_EVAL_LOCAL_BYPASS_ENABLED !== 'true') {
    return false;
  }

  if (!env.CHAT_EVAL_SECRET?.trim()) {
    return false;
  }

  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function readEvalBypassEmail(env) {
  return env.CHAT_EVAL_BYPASS_EMAIL?.trim() || env.BYPASS_AUTH_EMAIL?.trim() || '';
}

export function serializeCookies(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeResponseCookies(response, cookieJar) {
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) {
      continue;
    }
    cookieJar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

function sanitizeToolResultPayload(toolName, result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  switch (toolName) {
    case 'get_recent_news_detail':
      return {
        app: sanitizeResolvedApp(result.app),
        detail_mode: typeof result.detail_mode === 'string' ? result.detail_mode : null,
        items: sanitizeNewsItems(result.items, 3),
        latestItem: sanitizeNewsItem(result.latestItem),
        meta: sanitizeNewsMeta(result.meta),
      };
    case 'get_recent_news_digest':
      return {
        app: sanitizeResolvedApp(result.app),
        apps: sanitizeResolvedApps(result.apps, 3),
        items: sanitizeNewsItems(result.items, 6),
        meta: sanitizeNewsMeta(result.meta),
        scope: typeof result.scope === 'string' ? result.scope : null,
      };
    case 'search_recent_news_topics':
      return {
        items: sanitizeTopicItems(result.items, 8),
        meta: sanitizeTopicMeta(result.meta),
      };
    case 'get_game_change_timeline':
    case 'compare_change_before_after':
      return {
        app: sanitizeResolvedApp(result.app),
      };
    case 'query_change_activity':
      return {
        results: sanitizeActivityResults(result.results, 3),
      };
    default:
      return null;
  }
}

function sanitizeResolvedApp(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    appid: Number.isInteger(value.appid) ? value.appid : null,
    name: typeof value.name === 'string' ? value.name : null,
  };
}

function sanitizeResolvedApps(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(sanitizeResolvedApp)
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsItems(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(sanitizeNewsItem)
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsItem(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    appName:
      typeof value.appName === 'string'
        ? value.appName
        : typeof value.name === 'string'
          ? value.name
          : null,
    appid: Number.isInteger(value.appid) ? value.appid : null,
    bodyPreview: typeof value.bodyPreview === 'string' ? truncate(value.bodyPreview, 260) : null,
    excerpt: typeof value.excerpt === 'string' ? truncate(value.excerpt, 260) : null,
    firstSeenAt: typeof value.firstSeenAt === 'string' ? value.firstSeenAt : null,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    title: typeof value.title === 'string' ? truncate(value.title, 180) : null,
  };
}

function sanitizeTopicItems(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const newsItem = sanitizeNewsItem(item);
      if (!newsItem) {
        return null;
      }

      return {
        ...newsItem,
        matchReason: typeof item.matchReason === 'string' ? truncate(item.matchReason, 200) : null,
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeNewsMeta(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    days: typeof value.days === 'number' ? value.days : null,
    detailMode: typeof value.detailMode === 'string' ? value.detailMode : null,
    limit: typeof value.limit === 'number' ? value.limit : null,
  };
}

function sanitizeTopicMeta(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    days: typeof value.days === 'number' ? value.days : null,
    feedScope: typeof value.feedScope === 'string' ? value.feedScope : null,
    limit: typeof value.limit === 'number' ? value.limit : null,
    query: typeof value.query === 'string' ? value.query : null,
  };
}

function sanitizeActivityResults(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      return {
        appid: Number.isInteger(item.appid) ? item.appid : null,
        name: typeof item.name === 'string' ? item.name : null,
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  if (result.success === false) {
    const failureKind =
      typeof result.failure_kind === 'string' ? result.failure_kind : null;
    const errorMessage =
      typeof result.error === 'string'
        ? truncate(result.error.replace(/\s+/g, ' ').trim(), 180)
        : null;

    if (failureKind && errorMessage) {
      return `${failureKind}: ${errorMessage}`;
    }
    if (errorMessage) {
      return errorMessage;
    }
    if (failureKind) {
      return failureKind;
    }
    return 'tool failed';
  }

  if (typeof result.total_found === 'number') {
    return `${result.total_found} results`;
  }
  if (typeof result.rowCount === 'number') {
    return `${result.rowCount} rows`;
  }
  if (Array.isArray(result.results)) {
    return `${result.results.length} results`;
  }
  if (Array.isArray(result.events)) {
    return `${result.events.length} events`;
  }
  if (Array.isArray(result.diffs)) {
    return `${result.diffs.length} diffs`;
  }

  return null;
}

function classifyFailure({ errorMessage, httpStatus, transportOk, messageEndReceived }) {
  if (!errorMessage) {
    return null;
  }

  const message = String(errorMessage || '').toLowerCase();

  if (message.includes('statement timeout')) {
    return 'db_statement_timeout';
  }
  if (isOpenAi429ErrorMessage(errorMessage, httpStatus)) {
    return 'openai_429';
  }
  if (message.includes('missing message_end')) {
    return 'missing_message_end';
  }
  if (!transportOk && httpStatus) {
    return 'http_error';
  }
  if (!transportOk && (message.includes('timed out') || message.includes('timeout'))) {
    return 'request_timeout';
  }
  if (!transportOk) {
    return 'network_error';
  }
  if (transportOk && !messageEndReceived) {
    return 'missing_message_end';
  }
  return 'sse_error';
}

function isOpenAi429ErrorMessage(errorMessage, httpStatus) {
  const message = String(errorMessage || '').toLowerCase();
  return httpStatus === 429 || message.includes('openai api error: 429') || message.includes('rate limit reached');
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
