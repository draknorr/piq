'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AtSign, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { AutocompleteDropdown } from './AutocompleteDropdown';
import {
  buildEntityAutocompleteSuggestions,
  extractActiveMentionQuery,
  extractComposerEntityQuery,
  inferComposerEntityResolutionPreference,
  isSelectedEntityPrompt,
  replaceComposerEntityQuery,
  type ChatEntityBinding,
  type ChatEntityPickerResponse,
  type ChatEntitySuggestion,
} from '@/lib/chat/chat-entity-picker';
import type { ChatRequestOptions } from '@/lib/llm/types';

interface ChatInputProps {
  onSend: (message: string, requestOptions?: ChatRequestOptions) => void;
  disabled?: boolean;
}

const ENTITY_AUTOCOMPLETE_LIMIT = 5;
const ENTITY_KIND_FILTER = ['game', 'publisher', 'developer'] as const;
const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;

function dedupeBindings(bindings: ChatEntityBinding[], binding: ChatEntityBinding): ChatEntityBinding[] {
  if (bindings.some((item) => item.entity.entityUid === binding.entity.entityUid)) {
    return bindings;
  }

  return [...bindings, binding];
}

function mergeSuggestions(
  previous: ChatEntitySuggestion[],
  incoming: ChatEntitySuggestion[]
): ChatEntitySuggestion[] {
  const merged: ChatEntitySuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of [...previous, ...incoming]) {
    const entity = suggestion.entity;
    const key = entity
      ? `${entity.entityUid}:${entity.platformEntityId ?? ''}`
      : `${suggestion.category}:${suggestion.query}:${suggestion.label}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(suggestion);
  }

  return merged;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<ChatEntitySuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [totalCandidates, setTotalCandidates] = useState<number | null>(null);
  const [selectedBindings, setSelectedBindings] = useState<ChatEntityBinding[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const keyboardSelectionEnabledRef = useRef(false);
  const activeAutocompleteQueryRef = useRef('');
  const suppressNextAutocompleteRef = useRef(false);

  const autocompleteQuery = useMemo(() => extractComposerEntityQuery(input), [input]);
  const isAutocompleteQueryActive = autocompleteQuery.length >= MIN_AUTOCOMPLETE_QUERY_LENGTH;
  const isDropdownVisible =
    isAutocompleteQueryActive
    && (isLoading || isLoadingMore || suggestions.length > 0 || continuationToken !== null || totalCandidates !== null);

  const requestEntityMatches = useCallback(async ({
    append,
    continuation,
    query,
  }: {
    append: boolean;
    continuation?: string | null;
    query: string;
  }): Promise<ChatEntityPickerResponse | null> => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      keyboardSelectionEnabledRef.current = false;
    }

    try {
      const response = await fetch('/api/chat/entities', {
        body: JSON.stringify({
          continuationToken: continuation ?? null,
          entityKinds: [...ENTITY_KIND_FILTER],
          includeMetrics: true,
          limit: ENTITY_AUTOCOMPLETE_LIMIT,
          query,
          resolutionMode: 'autocomplete',
          resolutionPreference: inferComposerEntityResolutionPreference(input, query),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ChatEntityPickerResponse;
      if (controller.signal.aborted) {
        return null;
      }

      activeAutocompleteQueryRef.current = query;
      const entitySuggestions = buildEntityAutocompleteSuggestions(payload.results.entities, query);
      setSuggestions((previous) => {
        const nextSuggestions = append
          ? mergeSuggestions(previous, entitySuggestions)
          : entitySuggestions;
        setSelectedIndex((current) => {
          if (nextSuggestions.length === 0) {
            return -1;
          }

          return current >= 0 && current < nextSuggestions.length ? current : 0;
        });
        return nextSuggestions;
      });
      setContinuationToken(payload.results.continuationToken ?? null);
      setTotalCandidates(payload.results.totalCandidates ?? payload.results.entities.length);
      return payload;
    } catch {
      if (controller.signal.aborted) {
        return null;
      }

      if (!append) {
        setSuggestions([]);
        setSelectedIndex(-1);
        setContinuationToken(null);
        setTotalCandidates(null);
      }
      return null;
    } finally {
      if (fetchControllerRef.current === controller) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [input]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const query = autocompleteQuery;

    if (suppressNextAutocompleteRef.current) {
      suppressNextAutocompleteRef.current = false;
      return;
    }

    if (!isAutocompleteQueryActive || disabled) {
      fetchControllerRef.current?.abort();
      activeAutocompleteQueryRef.current = '';
      setSuggestions([]);
      setSelectedIndex(-1);
      setIsLoading(false);
      setIsLoadingMore(false);
      setContinuationToken(null);
      setTotalCandidates(null);
      keyboardSelectionEnabledRef.current = false;
      return;
    }

    if (activeAutocompleteQueryRef.current !== query) {
      fetchControllerRef.current?.abort();
      activeAutocompleteQueryRef.current = query;
      setSuggestions([]);
      setSelectedIndex(-1);
      setContinuationToken(null);
      setTotalCandidates(null);
    }

    const timeout = window.setTimeout(() => {
      void requestEntityMatches({ query, append: false });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autocompleteQuery, disabled, isAutocompleteQueryActive, requestEntityMatches]);

  useEffect(() => {
    setSelectedBindings((previous) => {
      const next = previous.filter((binding) => isSelectedEntityPrompt(binding, input));
      return next.length === previous.length ? previous : next;
    });
  }, [input]);

  const handleSubmit = useCallback(async () => {
    const message = input.trim();
    if (!message || disabled) {
      return;
    }

    const activeMentionQuery = extractActiveMentionQuery(message);
    let nextMessage = message;
    let nextBindings = [...selectedBindings];

    if (activeMentionQuery.length >= MIN_AUTOCOMPLETE_QUERY_LENGTH) {
      let payload: ChatEntityPickerResponse | null;
      const canReuseCurrentSuggestions =
        autocompleteQuery === activeMentionQuery
        && !isLoading
        && activeAutocompleteQueryRef.current === activeMentionQuery;

      if (canReuseCurrentSuggestions) {
        payload = {
          query: activeMentionQuery,
          results: {
            ambiguity: {
              candidateNames: suggestions
                .filter((suggestion): suggestion is ChatEntitySuggestion & { entity: NonNullable<ChatEntitySuggestion['entity']> } => Boolean(suggestion.entity))
                .map((suggestion) => suggestion.entity.displayName),
              message: null,
              requiresClarification: suggestions.length > 1,
            },
            continuationToken,
            entities: suggestions
              .map((suggestion) => suggestion.entity)
              .filter((entity): entity is NonNullable<ChatEntitySuggestion['entity']> => Boolean(entity)),
            provenance: {
              capturedAt: new Date().toISOString(),
              source: 'tiger',
              tables: [],
            },
            totalCandidates: totalCandidates ?? suggestions.length,
          },
          success: true,
        };
      } else {
        payload = await requestEntityMatches({
          append: false,
          query: activeMentionQuery,
        });
      }

      const entities = payload?.results.entities ?? [];
      if (entities.length !== 1) {
        return;
      }

      const entity = entities[0];
      if (!entity) {
        return;
      }

      nextMessage = replaceComposerEntityQuery(message, activeMentionQuery, entity.displayName);
      nextBindings = dedupeBindings(nextBindings, {
        entity,
        prompt: nextMessage,
        sourceQuery: activeMentionQuery,
      });
    }

    fetchControllerRef.current?.abort();
    activeAutocompleteQueryRef.current = '';

    const bindings = nextBindings.length > 0
      ? nextBindings
      : undefined;

    onSend(
      nextMessage,
      bindings
        ? { selectedEntities: bindings.map((binding) => binding.entity) }
        : undefined
    );

    setInput('');
    setSuggestions([]);
    setSelectedIndex(-1);
    setContinuationToken(null);
    setTotalCandidates(null);
    setSelectedBindings([]);
    keyboardSelectionEnabledRef.current = false;
  }, [
    autocompleteQuery,
    continuationToken,
    disabled,
    input,
    isLoading,
    onSend,
    requestEntityMatches,
    selectedBindings,
    suggestions,
    totalCandidates,
  ]);

  const handleSelectSuggestion = useCallback((suggestion: ChatEntitySuggestion) => {
    if (!suggestion.entity) {
      return;
    }

    fetchControllerRef.current?.abort();
    const nextInput = replaceComposerEntityQuery(input, autocompleteQuery, suggestion.entity.displayName);
    const binding: ChatEntityBinding = {
      entity: suggestion.entity,
      prompt: nextInput,
      sourceQuery: autocompleteQuery,
    };
    suppressNextAutocompleteRef.current = true;
    setSelectedBindings((previous) => dedupeBindings(previous, binding));
    setSuggestions([]);
    setSelectedIndex(-1);
    setContinuationToken(null);
    setTotalCandidates(null);
    setInput(nextInput);
    keyboardSelectionEnabledRef.current = false;
  }, [autocompleteQuery, input]);

  const handleLoadMore = useCallback(() => {
    if (!continuationToken || isLoadingMore || !isAutocompleteQueryActive) {
      return;
    }

    void requestEntityMatches({
      append: true,
      continuation: continuationToken,
      query: autocompleteQuery,
    });
  }, [autocompleteQuery, continuationToken, isAutocompleteQueryActive, isLoadingMore, requestEntityMatches]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      keyboardSelectionEnabledRef.current = false;
      setSelectedIndex(-1);
      return;
    }

    if (!isDropdownVisible || suggestions.length === 0) {
      if (event.key === 'Enter' && !event.shiftKey) {
        if (disabled) {
          return;
        }

        event.preventDefault();
        void handleSubmit();
      }

      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      keyboardSelectionEnabledRef.current = true;
      setSelectedIndex((current) => {
        if (suggestions.length === 0) {
          return -1;
        }

        if (event.key === 'ArrowDown') {
          return (current + 1 + suggestions.length) % suggestions.length;
        }

        return (current - 1 + suggestions.length) % suggestions.length;
      });
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      const candidate = keyboardSelectionEnabledRef.current ? suggestions[selectedIndex] : null;
      if (candidate?.entity) {
        event.preventDefault();
        handleSelectSuggestion(candidate);
        return;
      }

      if (disabled) {
        return;
      }

      event.preventDefault();
      void handleSubmit();
    }
  }, [disabled, handleSelectSuggestion, handleSubmit, isDropdownVisible, selectedIndex, suggestions]);

  const handleChipRemove = useCallback((entityUid: string) => {
    setSelectedBindings((previous) => previous.filter((binding) => binding.entity.entityUid !== entityUid));
  }, []);

  return (
    <div className="flex gap-3 items-end">
      <div className="relative flex-1">
        {selectedBindings.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedBindings.map((binding) => (
              <button
                key={binding.entity.entityUid}
                type="button"
                onClick={() => handleChipRemove(binding.entity.entityUid)}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-elevated px-3 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:border-border-muted hover:text-text-primary"
                aria-label={`Remove ${binding.entity.displayName}`}
              >
                <AtSign className="h-3 w-3" />
                <span className="max-w-[14rem] truncate">{binding.entity.displayName}</span>
                <span className="uppercase tracking-[0.14em] text-text-muted">{binding.entity.entityKind}</span>
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about Steam games, publishers, or trends..."
          aria-disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={isDropdownVisible}
          role="combobox"
          rows={1}
          autoComplete="off"
          className={`
            block w-full min-h-[40px] max-h-[200px] overflow-x-hidden overflow-y-auto scrollbar-none py-2.5 px-4 rounded-lg resize-none
            bg-surface-elevated border border-border-muted
            text-body text-text-primary placeholder:text-text-muted
            transition-colors duration-150
            hover:border-border-prominent
            focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary
            ${disabled ? 'opacity-90' : 'opacity-100'}
          `}
        />

        <AutocompleteDropdown
          continuationToken={continuationToken}
          inputValue={autocompleteQuery}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          isVisible={isDropdownVisible}
          onHover={(index) => {
            keyboardSelectionEnabledRef.current = false;
            setSelectedIndex(index);
          }}
          onLoadMore={handleLoadMore}
          onSelect={handleSelectSuggestion}
          selectedIndex={selectedIndex}
          suggestions={suggestions}
          totalCandidates={totalCandidates}
        />
      </div>

      <Button
        data-testid="chat-send"
        onClick={() => {
          void handleSubmit();
        }}
        disabled={disabled || !input.trim()}
        size="lg"
      >
        <Send className="w-4 h-4" />
        <span className="sr-only">Send message</span>
      </Button>
    </div>
  );
}
