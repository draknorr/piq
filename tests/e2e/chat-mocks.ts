import type { Page } from '@playwright/test';

type MockTextDeltaEvent = {
  type: 'text_delta';
  delta: string;
};

type MockToolStartEvent = {
  type: 'tool_start';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type MockToolResultEvent = {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  timing: {
    executionMs: number;
  };
};

type MockMessageEndEvent = {
  type: 'message_end';
  timing: {
    llmMs: number;
    toolsMs: number;
    totalMs: number;
  };
  debug?: Record<string, unknown>;
  sessionContext?: Record<string, unknown> | null;
};

type MockErrorEvent = {
  type: 'error';
  message: string;
};

type MockStreamEvent =
  | MockErrorEvent
  | MockMessageEndEvent
  | MockTextDeltaEvent
  | MockToolResultEvent
  | MockToolStartEvent;

export interface MockStreamFrame {
  delayMs?: number;
  event: MockStreamEvent;
}

export interface MockChatStreamResponse {
  events: MockStreamFrame[];
  status?: number;
}

const DEFAULT_AUTOCOMPLETE_RESPONSE = {
  cachedAt: 0,
  categories: [],
  genres: [],
  tags: [],
};

const DEFAULT_SEARCH_RESPONSE = {
  results: {
    developers: [],
    games: [],
    publishers: [],
  },
};

export async function installChatFetchMocks(
  page: Page,
  params: {
    autocompleteResponse?: Record<string, unknown>;
    chatResponses: MockChatStreamResponse[];
    searchResponse?: Record<string, unknown>;
    supabaseOrigin?: string;
  }
): Promise<void> {
  const supabaseOrigin =
    params.supabaseOrigin ??
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co').origin;

  await page.addInitScript(
    ({ autocompleteResponse, chatResponses, searchResponse, targetSupabaseOrigin }) => {
      const streamQueue = [...chatResponses];
      const originalFetch = window.fetch.bind(window);
      const defaultAutocompleteResponse =
        autocompleteResponse ?? {
          cachedAt: 0,
          categories: [],
          genres: [],
          tags: [],
        };
      const defaultSearchResponse =
        searchResponse ?? {
          results: {
            developers: [],
            games: [],
            publishers: [],
          },
        };

      const jsonResponse = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: {
            'content-type': 'application/json',
          },
        });

      const sseResponse = (frames: Array<{ delayMs?: number; event: unknown }>, status = 200): Response => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for (const frame of frames) {
              if (frame.delayMs && frame.delayMs > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, frame.delayMs));
              }

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(frame.event)}\n\n`)
              );
            }

            controller.close();
          },
        });

        return new Response(stream, {
          status,
          headers: {
            'cache-control': 'no-cache',
            'content-type': 'text/event-stream; charset=utf-8',
          },
        });
      };

      window.fetch = async (input, init) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const url = new URL(rawUrl, window.location.origin);

        if (url.pathname === '/api/autocomplete/tags') {
          return jsonResponse(defaultAutocompleteResponse);
        }

        if (url.pathname === '/api/search') {
          return jsonResponse(defaultSearchResponse);
        }

        if (url.pathname === '/api/chat/stream') {
          const nextResponse = streamQueue.shift();

          if (!nextResponse) {
            return jsonResponse(
              { error: 'No mocked chat stream response remaining.' },
              500
            );
          }

          return sseResponse(nextResponse.events, nextResponse.status ?? 200);
        }

        if (url.origin === targetSupabaseOrigin) {
          if (url.pathname.includes('/auth/v1/user')) {
            return jsonResponse({ user: null });
          }

          if (url.pathname.includes('/auth/v1/token')) {
            return jsonResponse({
              access_token: null,
              refresh_token: null,
              user: null,
            });
          }

          return jsonResponse({});
        }

        return originalFetch(input, init);
      };
    },
    {
      autocompleteResponse: params.autocompleteResponse ?? DEFAULT_AUTOCOMPLETE_RESPONSE,
      chatResponses: params.chatResponses,
      searchResponse: params.searchResponse ?? DEFAULT_SEARCH_RESPONSE,
      targetSupabaseOrigin: supabaseOrigin,
    }
  );
}
