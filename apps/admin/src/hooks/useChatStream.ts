'use client';

import { useState, useCallback, useRef } from 'react';
import type { Message, ChatSelectedEntity, ChatToolCall, ChatTiming } from '@/lib/llm/types';
import type { SessionChatContext } from '@/lib/chat/chat-context-types';
import type { QuerySuggestion } from '@/lib/chat/query-templates';
import type { StreamEvent, StreamDebugInfo } from '@/lib/llm/streaming-types';
import type { TigerPrimaryInfo, TigerShadowInfo } from '@/lib/chat/tiger-shadow-types';
import type { ChatRenderData } from '@/lib/chat/chat-render-data';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ChatToolCall[];
  timing?: ChatTiming;
  debug?: StreamDebugInfo;
  followUpSuggestions?: QuerySuggestion[];
  renderData?: ChatRenderData;
  tigerPrimary?: TigerPrimaryInfo;
  tigerShadow?: TigerShadowInfo;
  timestamp: Date;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface UseChatStreamOptions {
  onError?: (error: string) => void;
}

export function useChatStream(options: UseChatStreamOptions = {}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionContextRef = useRef<SessionChatContext | null>(null);

  const sendMessage = useCallback(async (
    content: string,
    requestOptions?: {
      selectedEntities?: ChatSelectedEntity[];
    }
  ) => {
    if (!content.trim() || isStreaming) return;

    // Add user message
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    // Create placeholder assistant message
    const assistantId = crypto.randomUUID();
    const assistantMessage: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);
    setPendingToolCalls([]);

    // Build message history for API
    const currentMessages = messages;
    const apiMessages: Message[] = currentMessages
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      .concat({ role: 'user', content: content.trim() });

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          sessionContext: sessionContextRef.current,
          selectedEntities: requestOptions?.selectedEntities,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        // Try to parse error details from the response body
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.message) {
            errorMessage = errorBody.message;
          } else if (errorBody.error) {
            errorMessage = typeof errorBody.error === 'string'
              ? errorBody.error
              : `${errorBody.error}: ${errorBody.message || ''}`;
          }
          // Include retry_after hint for rate limiting
          if (errorBody.retry_after) {
            errorMessage += ` (retry in ${errorBody.retry_after}s)`;
          }
        } catch {
          // Body wasn't JSON or couldn't be parsed, use status code
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      const toolCalls: ChatToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event: StreamEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'text_delta':
                accumulatedContent += event.delta;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: accumulatedContent }
                    : m
                ));
                break;

              case 'tool_start':
                setPendingToolCalls(prev => [...prev, {
                  id: event.toolCallId,
                  name: event.name,
                  arguments: event.arguments,
                }]);
                break;

              case 'tool_result': {
                // Remove from pending
                setPendingToolCalls(prev =>
                  prev.filter(tc => tc.id !== event.toolCallId)
                );
                // Use arguments directly from the event (not pendingToolCalls - stale closure issue)
                toolCalls.push({
                  name: event.name,
                  arguments: event.arguments || {},
                  result: event.result,
                  timing: event.timing,
                });
                break;
              }

              case 'message_end':
                if (event.sessionContext !== undefined) {
                  sessionContextRef.current = event.sessionContext ?? null;
                }
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: accumulatedContent,
                        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                        timing: event.timing,
                        debug: event.debug,
                        followUpSuggestions: event.followUpSuggestions,
                        renderData: event.renderData,
                        tigerPrimary: event.tigerPrimary,
                        tigerShadow: event.tigerShadow,
                      }
                    : m
                ));
                break;

              case 'error':
                options.onError?.(event.message);
                // Update assistant message to show error
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: accumulatedContent || 'An error occurred.' }
                    : m
                ));
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        options.onError?.(error.message);
        // Update assistant message to show error state
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: m.content || 'Failed to get response.' }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      setPendingToolCalls([]);
      abortControllerRef.current = null;
    }
  }, [messages, isStreaming, options]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setPendingToolCalls([]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionContextRef.current = null;
  }, []);

  return {
    messages,
    isStreaming,
    pendingToolCalls,
    sendMessage,
    stopStreaming,
    clearMessages,
  };
}
