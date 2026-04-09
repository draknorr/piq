'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Send, X } from 'lucide-react';
import { AutocompleteDropdown, type AutocompleteSuggestion } from './AutocompleteDropdown';
import { SuggestionChips } from './SuggestionChips';
import { useAutocompleteData, filterAutocompleteItems } from '@/hooks/useAutocompleteData';
import { matchTemplates } from '@/lib/chat/query-templates';
import { getExamplePrompts } from '@/lib/example-prompts';
import {
  buildEntityAutocompleteSuggestions,
  buildEntityQuickPrompts,
  buildSelectedEntityBinding,
  extractEntitySearchQuery,
  isSelectedEntityPrompt,
  replaceEntitySearchQuery,
  type ChatEntityBinding,
  type ChatEntityPickerResponse,
} from '@/lib/chat/chat-entity-picker';
import type { ChatSelectedEntity } from '@/lib/llm/types';

interface ChatInputProps {
  onSend: (
    message: string,
    requestOptions?: {
      selectedEntities?: ChatSelectedEntity[];
    }
  ) => void;
  disabled?: boolean;
}

// Debounce delay for API search
const SEARCH_DEBOUNCE_MS = 150;
const MIN_SEARCH_LENGTH = 2;
const INPUT_AUTOCOMPLETE_ENABLED = true;

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<AutocompleteSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<ChatEntityBinding | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fetched autocomplete data
  const { tags, genres, isLoading: isLoadingTags } = useAutocompleteData();

  // Random example prompts for empty state
  const examplePrompts = useMemo(() => getExamplePrompts('chat-input', 4), []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Generate instant suggestions (no API call)
  const instantSuggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!INPUT_AUTOCOMPLETE_ENABLED || selectedEntity) {
      return [];
    }

    const trimmedInput = input.trim();

    // Empty input - show example prompts
    if (!trimmedInput) {
      return examplePrompts.map((prompt) => ({
        label: prompt,
        query: prompt,
        category: 'example' as const,
      }));
    }

    // Too short - return nothing
    if (trimmedInput.length < MIN_SEARCH_LENGTH) {
      return [];
    }

    const suggestions: AutocompleteSuggestion[] = [];

    // 1. Match query templates
    const templateMatches = matchTemplates(trimmedInput, { maxResults: 3 });
    suggestions.push(...templateMatches);

    // 2. Match tags/genres
    const allTagItems = [...tags, ...genres];
    const tagMatches = filterAutocompleteItems(allTagItems, trimmedInput, 3);
    for (const tag of tagMatches) {
      suggestions.push({
        label: `${tag} games`,
        query: `${tag} games`,
        category: 'tag' as const,
      });
    }

    return suggestions;
  }, [input, tags, genres, examplePrompts, selectedEntity]);

  // Combine entity results + instant suggestions, preferring direct entity matches
  const allSuggestions = useMemo((): AutocompleteSuggestion[] => {
    const seen = new Set<string>();
    const combined: AutocompleteSuggestion[] = [];

    for (const suggestion of [...entityResults, ...instantSuggestions]) {
      const key = suggestion.query.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      combined.push(suggestion);
    }

    return combined.slice(0, 8);
  }, [entityResults, instantSuggestions]);

  const clearSelectedEntity = useCallback(
    (restoreSourceQuery = false) => {
      if (restoreSourceQuery && selectedEntity?.sourceQuery) {
        setInput(selectedEntity.sourceQuery);
      }
      setSelectedEntity(null);
    },
    [selectedEntity]
  );

  // Debounced entity search
  const searchEntities = useCallback(
    async (query: string) => {
      if (!INPUT_AUTOCOMPLETE_ENABLED) {
        setEntityResults([]);
        setIsSearching(false);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (query.length < MIN_SEARCH_LENGTH) {
        setEntityResults([]);
        setIsSearching(false);
        return;
      }

      const searchQuery = extractEntitySearchQuery(query);
      if (searchQuery.length < MIN_SEARCH_LENGTH) {
        setEntityResults([]);
        setIsSearching(false);
        return;
      }

      if (selectedEntity && isSelectedEntityPrompt(selectedEntity, query)) {
        setEntityResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          abortControllerRef.current = new AbortController();

          const response = await fetch('/api/chat/entities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: searchQuery,
              includeMetrics: true,
              limit: 8,
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            setEntityResults([]);
            setIsSearching(false);
            return;
          }

          const data = (await response.json()) as ChatEntityPickerResponse;
          const entities = Array.isArray(data.results?.entities) ? data.results.entities : [];

          setEntityResults(buildEntityAutocompleteSuggestions(entities, searchQuery));
          setIsSearching(false);
        } catch (error) {
          if (error instanceof Error && error.name !== 'AbortError') {
            setEntityResults([]);
            setIsSearching(false);
          }
        }
      }, SEARCH_DEBOUNCE_MS);
    },
    [selectedEntity]
  );

  // Trigger entity search on input change
  useEffect(() => {
    const trimmedInput = input.trim();
    void searchEntities(trimmedInput);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [input, searchEntities]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allSuggestions.length]);

  const handleSubmit = useCallback(() => {
    if (input.trim() && !disabled) {
      onSend(input.trim(), {
        selectedEntities: selectedEntity ? [selectedEntity.entity] : undefined,
      });
      setInput('');
      setIsDropdownOpen(false);
      setEntityResults([]);
      setSelectedEntity(null);
    }
  }, [input, disabled, onSend, selectedEntity]);

  const handleSelectSuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      if (disabled) {
        return;
      }

      if (suggestion.entity) {
        const binding = buildSelectedEntityBinding(suggestion.entity, input);
        const searchQuery = extractEntitySearchQuery(input);
        setSelectedEntity(binding);
        setInput(replaceEntitySearchQuery(input, searchQuery, suggestion.entity.displayName));
        setIsDropdownOpen(false);
        setEntityResults([]);
        setSelectedIndex(0);
        return;
      }

      onSend(suggestion.query);
      setInput('');
      setIsDropdownOpen(false);
      setEntityResults([]);
      setSelectedEntity(null);
    },
    [disabled, input, onSend]
  );

  const handleQuickPromptSelect = useCallback(
    (query: string) => {
      if (disabled) {
        return;
      }

      onSend(query, {
        selectedEntities: selectedEntity ? [selectedEntity.entity] : undefined,
      });
      setInput('');
      setIsDropdownOpen(false);
      setEntityResults([]);
      setSelectedEntity(null);
    },
    [disabled, onSend, selectedEntity]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled && e.key === 'Enter' && !e.shiftKey) {
      return;
    }

    if (isDropdownOpen && allSuggestions.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < allSuggestions.length - 1 ? prev + 1 : 0));
          return;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : allSuggestions.length - 1
          );
          return;

        case 'Tab':
          e.preventDefault();
          if (allSuggestions[selectedIndex]) {
            handleSelectSuggestion(allSuggestions[selectedIndex]);
          }
          return;

        case 'Escape':
          e.preventDefault();
          setIsDropdownOpen(false);
          return;

        case 'Enter':
          if (disabled) {
            return;
          }
          if (!e.shiftKey && allSuggestions[selectedIndex]) {
            e.preventDefault();
            handleSelectSuggestion(allSuggestions[selectedIndex]);
            return;
          }
          break;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (disabled) {
        return;
      }
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFocus = () => {
    setIsDropdownOpen(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }

    setTimeout(() => setIsDropdownOpen(false), 150);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextInput = e.target.value;
    setInput(nextInput);
    setIsDropdownOpen(true);

    if (selectedEntity && !isSelectedEntityPrompt(selectedEntity, nextInput)) {
      setSelectedEntity(null);
    }
  };

  const trimmedInput = input.trim();
  const isDropdownVisible =
    INPUT_AUTOCOMPLETE_ENABLED &&
    isDropdownOpen &&
    (trimmedInput.length === 0 || trimmedInput.length >= MIN_SEARCH_LENGTH);

  const selectedEntityPrompts = useMemo(() => {
    if (!selectedEntity) {
      return [];
    }

    return buildEntityQuickPrompts(selectedEntity.entity);
  }, [selectedEntity]);

  return (
    <div className="flex gap-3 items-end">
      <div className="flex-1 relative">
        <AutocompleteDropdown
          ref={dropdownRef}
          suggestions={allSuggestions}
          selectedIndex={selectedIndex}
          onSelect={handleSelectSuggestion}
          onHover={setSelectedIndex}
          inputValue={input}
          isLoading={isSearching || isLoadingTags}
          isVisible={isDropdownVisible}
        />

        {selectedEntity && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-elevated px-3 py-1.5 text-body-sm text-text-primary">
              <span className="font-medium">{selectedEntity.entity.displayName}</span>
              <span className="text-caption uppercase tracking-[0.18em] text-text-muted">
                {selectedEntity.entity.entityKind}
              </span>
              <button
                type="button"
                onClick={() => clearSelectedEntity(true)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                aria-label={`Clear selected entity ${selectedEntity.entity.displayName}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {selectedEntity && selectedEntityPrompts.length > 0 && (
          <SuggestionChips
            suggestions={selectedEntityPrompts}
            onSuggestionClick={handleQuickPromptSelect}
            label="Quick prompts"
          />
        )}

        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Ask about Steam games, publishers, or trends..."
          aria-disabled={disabled}
          rows={1}
          autoComplete="off"
          role={INPUT_AUTOCOMPLETE_ENABLED ? 'combobox' : undefined}
          aria-expanded={INPUT_AUTOCOMPLETE_ENABLED ? isDropdownOpen : undefined}
          aria-haspopup={INPUT_AUTOCOMPLETE_ENABLED ? 'listbox' : undefined}
          aria-autocomplete={INPUT_AUTOCOMPLETE_ENABLED ? 'list' : undefined}
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
      </div>

      <Button
        data-testid="chat-send"
        onClick={handleSubmit}
        disabled={disabled || !input.trim()}
        size="lg"
      >
        <Send className="w-4 h-4" />
        <span className="sr-only">Send message</span>
      </Button>
    </div>
  );
}
