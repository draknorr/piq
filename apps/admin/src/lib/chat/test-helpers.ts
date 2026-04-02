import { NextRequest } from 'next/server';

import type { SessionChatContext } from '@/lib/chat/chat-context-types';
import type { Message, ChatRequest } from '@/lib/llm/types';
import type { MessageEndEvent, StreamEvent, TextDeltaEvent } from '@/lib/llm/streaming-types';

export async function collectStreamEvents(response: Response): Promise<StreamEvent[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    return [];
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const events: StreamEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data: '));

      if (dataLine) {
        events.push(JSON.parse(dataLine.slice('data: '.length)) as StreamEvent);
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  const trailingFrame = buffer.trim();
  if (trailingFrame.startsWith('data: ')) {
    events.push(JSON.parse(trailingFrame.slice('data: '.length)) as StreamEvent);
  }

  return events;
}

export function buildChatRequest(params: {
  messages?: Message[];
  sessionContext?: SessionChatContext | null;
  userPrompt?: string;
}): ChatRequest {
  const messages =
    params.messages ??
    (params.userPrompt
      ? [{ role: 'user', content: params.userPrompt }]
      : []);

  return {
    messages,
    sessionContext: params.sessionContext ?? null,
  };
}

export function createJsonNextRequest(params: {
  body: ChatRequest;
  headers?: HeadersInit;
  url?: string;
}): NextRequest {
  return new NextRequest(params.url ?? 'http://localhost/api/chat/stream', {
    body: JSON.stringify(params.body),
    headers: {
      'content-type': 'application/json',
      ...(params.headers ?? {}),
    },
    method: 'POST',
  });
}

export interface ChatScenarioTurn {
  headers?: HeadersInit;
  messages?: Message[];
  user: string;
}

export async function runChatScenario(params: {
  defaultHeaders?: HeadersInit;
  handler: (request: NextRequest) => Promise<Response>;
  initialSessionContext?: SessionChatContext | null;
  turns: ChatScenarioTurn[];
  url?: string;
}): Promise<{
  finalSessionContext: SessionChatContext | null;
  turns: Array<{
    events: StreamEvent[];
    finalEvent: MessageEndEvent | null;
    text: string;
  }>;
}> {
  let sessionContext = params.initialSessionContext ?? null;
  const turnResults: Array<{
    events: StreamEvent[];
    finalEvent: MessageEndEvent | null;
    text: string;
  }> = [];

  for (const turn of params.turns) {
    const request = createJsonNextRequest({
      body: buildChatRequest({
        messages: turn.messages,
        sessionContext,
        userPrompt: turn.messages ? undefined : turn.user,
      }),
      headers: {
        ...(params.defaultHeaders ?? {}),
        ...(turn.headers ?? {}),
      },
      url: params.url,
    });
    const response = await params.handler(request);
    const events = await collectStreamEvents(response);
    const finalEvent =
      events.findLast((event): event is MessageEndEvent => event.type === 'message_end') ?? null;
    const text = events
      .filter((event): event is TextDeltaEvent => event.type === 'text_delta')
      .map((event) => event.delta)
      .join('');

    sessionContext = finalEvent?.sessionContext ?? sessionContext;
    turnResults.push({
      events,
      finalEvent,
      text,
    });
  }

  return {
    finalSessionContext: sessionContext,
    turns: turnResults,
  };
}
