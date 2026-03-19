'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { MessageSquare, StopCircle, Database } from 'lucide-react';
import { getExamplePrompts } from '@/lib/example-prompts';
import { useChatStream } from '@/hooks/useChatStream';
import { generatePostResponseSuggestions } from '@/lib/chat/suggestion-generator';
import type { QuerySuggestion } from '@/lib/chat/query-templates';

interface ChatContainerProps {
  initialQuery?: string;
}

export function ChatContainer({ initialQuery }: ChatContainerProps) {
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(() => getExamplePrompts('chat', 4), []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasSubmittedInitialQuery = useRef(false);
  const lastScrollTime = useRef<number>(0);

  const {
    messages,
    isStreaming,
    pendingToolCalls,
    sendMessage,
    stopStreaming,
  } = useChatStream({
    onError: setError,
  });

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150; // px from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if user is near bottom)
  const scrollToBottom = useCallback((force = false) => {
    if (!force && !isNearBottom()) return;

    // Throttle scroll calls during streaming to reduce jank
    const now = Date.now();
    if (isStreaming && now - lastScrollTime.current < 100) return;
    lastScrollTime.current = now;

    // Use 'instant' during streaming to avoid fighting smooth scroll
    messagesEndRef.current?.scrollIntoView({
      behavior: isStreaming ? 'instant' : 'smooth',
    });
  }, [isNearBottom, isStreaming]);

  // Scroll on new messages, but throttled during streaming
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Force scroll when streaming starts (new user message)
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(true);
    }
  }, [isStreaming, scrollToBottom]);

  // Auto-submit initial query from URL
  useEffect(() => {
    if (initialQuery && !hasSubmittedInitialQuery.current && !isStreaming) {
      hasSubmittedInitialQuery.current = true;
      sendMessage(initialQuery);
    }
  }, [initialQuery, isStreaming, sendMessage]);

  const handleSend = useCallback((content: string) => {
    setError(null);
    sendMessage(content);
  }, [sendMessage]);

  // Find the last assistant message to determine if it's streaming
  const lastMessage = messages[messages.length - 1];
  const isLastMessageStreaming = isStreaming && lastMessage?.role === 'assistant';

  // Generate follow-up suggestions for the last assistant message (when not streaming)
  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
  }, [messages]);

  const followUpSuggestions: QuerySuggestion[] = useMemo(() => {
    if (isStreaming || !lastAssistantMessage || !lastAssistantMessage.toolCalls) {
      return [];
    }
    // Find the user query that preceded this assistant message
    const assistantIndex = messages.findIndex(m => m.id === lastAssistantMessage.id);
    const userMessage = assistantIndex > 0 ? messages[assistantIndex - 1] : null;
    const originalQuery = userMessage?.role === 'user' ? userMessage.content : '';

    return generatePostResponseSuggestions({
      toolCalls: lastAssistantMessage.toolCalls,
      originalQuery,
    });
  }, [isStreaming, lastAssistantMessage, messages]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-accent-blue" />
            </div>
            <h3 className="text-subheading text-text-primary mb-2">Ask about Steam data</h3>
            <p className="text-body-sm text-text-secondary max-w-md mb-6">
              Ask questions in plain English and I&apos;ll query the database for you.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSend(suggestion)}
                  className="px-3 py-1.5 text-body-sm text-text-secondary bg-surface-elevated hover:bg-surface-overlay border border-border-subtle hover:border-border-muted rounded-full transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, idx) => {
          const isLastAssistant = message.id === lastAssistantMessage?.id;
          return (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isLastMessageStreaming && idx === messages.length - 1}
              suggestions={isLastAssistant ? followUpSuggestions : undefined}
              onSuggestionClick={isLastAssistant ? handleSend : undefined}
            />
          );
        })}

        {/* Pending tool calls indicator */}
        {isStreaming && pendingToolCalls.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-elevated border border-border-subtle">
            <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
            <Database className="w-4 h-4 text-text-muted" />
            <span className="text-body-sm text-text-secondary">
              Executing {pendingToolCalls.map(tc => tc.name).join(', ')}...
            </span>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-accent-red/10 border border-accent-red/20">
            <p className="text-body-sm text-accent-red">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border-subtle p-4 bg-surface-raised">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <ChatInput onSend={handleSend} disabled={isStreaming} />
          </div>
          {isStreaming && (
            <button
              onClick={stopStreaming}
              className="h-10 px-4 rounded-lg bg-accent-red/10 hover:bg-accent-red/20 border border-accent-red/20 text-accent-red transition-colors flex items-center gap-2 shrink-0"
              title="Stop generating"
            >
              <StopCircle className="w-4 h-4" />
              <span className="text-body-sm">Stop</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
