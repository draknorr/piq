'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { StopCircle } from 'lucide-react';
import {
  getChatLandingPromptGroups,
  type ChatLandingPromptGroup,
} from '@/lib/example-prompts';
import { useChatStream } from '@/hooks/useChatStream';
import { generatePostResponseSuggestions } from '@/lib/chat/suggestion-generator';
import type { QuerySuggestion } from '@/lib/chat/query-templates';

interface ChatContainerProps {
  initialQuery?: string;
  promptSeed?: string;
}

export function ChatContainer({
  initialQuery,
  promptSeed = 'chat',
}: ChatContainerProps) {
  const [error, setError] = useState<string | null>(null);
  const landingPromptGroups = useMemo(
    () => getChatLandingPromptGroups(promptSeed, 4),
    [promptSeed]
  );
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
  const showLandingState = messages.length === 0 && !isStreaming && !initialQuery;

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
    if (isStreaming || !lastAssistantMessage) {
      return [];
    }

    if (lastAssistantMessage.followUpSuggestions && lastAssistantMessage.followUpSuggestions.length > 0) {
      return lastAssistantMessage.followUpSuggestions;
    }

    if (!lastAssistantMessage.toolCalls) {
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
      <div
        ref={messagesContainerRef}
        data-testid="chat-messages"
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6"
      >
        {showLandingState && (
          <ChatLandingState
            promptGroups={landingPromptGroups}
            onPromptSelect={handleSend}
          />
        )}

        {messages.map((message, idx) => {
          const isLastAssistant = message.id === lastAssistantMessage?.id;
          return (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isLastMessageStreaming && idx === messages.length - 1}
              pendingToolCallNames={
                isLastAssistant && isLastMessageStreaming
                  ? pendingToolCalls.map((toolCall) => toolCall.name)
                  : undefined
              }
              suggestions={isLastAssistant ? followUpSuggestions : undefined}
              onSuggestionClick={isLastAssistant ? handleSend : undefined}
            />
          );
        })}

        {error && (
          <div
            data-testid="chat-error-banner"
            className="p-4 rounded-lg bg-accent-red/10 border border-accent-red/20"
          >
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
              data-testid="chat-stop"
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

interface ChatLandingStateProps {
  promptGroups: ChatLandingPromptGroup[];
  onPromptSelect: (query: string) => void;
}

function ChatLandingState({
  promptGroups,
  onPromptSelect,
}: ChatLandingStateProps) {
  return (
    <div className="flex min-h-full items-end">
      <section className="mx-auto w-full max-w-5xl pb-4 pt-8 sm:pt-12">
        <div className="rounded-[28px] border border-border-subtle bg-surface-raised px-5 py-6 shadow-sm sm:px-7 sm:py-7">
          <div className="mb-6 max-w-2xl border-b border-border-subtle pb-4 sm:mb-7 sm:pb-5">
            <h2 className="text-[clamp(1.625rem,2vw,2.1rem)] font-semibold tracking-tight text-text-primary">
              Start with a question
            </h2>
            <p className="mt-2 text-body text-text-secondary">
              Ask about games, publishers, market momentum, or recent Steam changes in plain English.
            </p>
            <p className="mt-3 max-w-xl text-body-sm leading-6 text-text-muted">
              Note: The platform is currently in active development and will change rapidly.
            </p>
          </div>

          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {promptGroups.map((group) => (
              <div key={group.id} className="space-y-2.5">
                <h3 className="text-caption font-semibold uppercase tracking-[0.18em] text-text-muted">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.prompts.map((prompt, index) => (
                    <button
                      key={prompt.id}
                      onClick={() => onPromptSelect(prompt.query)}
                      className={[
                        'group w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150',
                        'hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2',
                        'focus-visible:ring-accent-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
                        getPromptVisibilityClasses(index),
                      ].join(' ')}
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full chat-accent-dot opacity-60 transition-opacity duration-150 group-hover:opacity-100" />
                      <span className="text-body-sm leading-6 text-text-secondary transition-colors duration-150 group-hover:text-text-primary">
                        {prompt.query}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function getPromptVisibilityClasses(index: number): string {
  switch (index) {
    case 0:
      return 'flex';
    case 1:
      return 'hidden sm:flex';
    case 2:
      return 'hidden lg:flex';
    default:
      return 'hidden xl:flex';
  }
}
