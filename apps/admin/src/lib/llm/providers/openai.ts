import { BaseLLMProvider } from './base';
import type { Message, Tool, LLMResponse, ToolCall, StreamChunk, LLMStreamOptions } from '../types';

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
}

export class OpenAIProvider extends BaseLLMProvider {
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    super(apiKey, model);
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    const openaiMessages = this.formatMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      temperature: 0.1,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    return this.parseResponse(data);
  }

  async *chatStream(
    messages: Message[],
    tools?: Tool[],
    options?: LLMStreamOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const openaiMessages = this.formatMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      temperature: 0.1,
      stream: true,
      // Enable usage tracking in stream response
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Track tool calls being accumulated
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // Emit any completed tool calls
            for (const [, toolCall] of toolCallsInProgress) {
              try {
                yield {
                  type: 'tool_use_end',
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: JSON.parse(toolCall.arguments || '{}'),
                  },
                };
              } catch {
                // Handle JSON parse error for tool arguments
                yield {
                  type: 'tool_use_end',
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: {},
                  },
                };
              }
            }
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);

            // Handle usage data (returned with stream_options.include_usage)
            if (parsed.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: parsed.usage.prompt_tokens ?? 0,
                  outputTokens: parsed.usage.completion_tokens ?? 0,
                  totalTokens: parsed.usage.total_tokens ?? 0,
                },
              };
            }

            const delta = parsed.choices?.[0]?.delta;

            if (!delta) continue;

            // Handle text content
            if (delta.content) {
              yield { type: 'text', text: delta.content };
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;

                if (tc.id) {
                  // New tool call starting
                  toolCallsInProgress.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  });
                  yield {
                    type: 'tool_use_start',
                    toolCall: {
                      id: tc.id,
                      name: tc.function?.name || '',
                      arguments: {},
                    },
                  };
                } else {
                  // Continuing to accumulate tool call
                  const existing = toolCallsInProgress.get(index);
                  if (existing) {
                    if (tc.function?.name) {
                      existing.name += tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      existing.arguments += tc.function.arguments;
                    }
                  }
                }
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private formatMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        };
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  private parseResponse(data: OpenAIResponse): LLMResponse {
    const choice = data.choices[0];
    const message = choice.message;

    let toolCalls: ToolCall[] | null = null;
    if (message.tool_calls) {
      toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return {
      content: message.content,
      toolCalls,
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    };
  }
}
