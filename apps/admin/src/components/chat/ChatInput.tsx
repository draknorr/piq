'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Send } from 'lucide-react';
import { AutocompleteDropdown, type AutocompleteSuggestion } from './AutocompleteDropdown';
import { useAutocompleteData, filterAutocompleteItems } from '@/hooks/useAutocompleteData';
import {
  matchTemplates,
  generateGameSuggestions,
} from '@/lib/chat/query-templates';
import { getExamplePrompts } from '@/lib/example-prompts';
import type { SearchResponse } from '@/components/search/types';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

// Debounce delay for API search
const SEARCH_DEBOUNCE_MS = 150;
const MIN_SEARCH_LENGTH = 2;
const INPUT_AUTOCOMPLETE_ENABLED = false;

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<AutocompleteSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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
    if (!INPUT_AUTOCOMPLETE_ENABLED) {
      return [];
    }

    const trimmedInput = input.trim();

    // Empty input - show example prompts
    if (!trimmedInput) {
      return examplePrompts.map(prompt => ({
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
      // Generate template-based suggestions for matching tags
      suggestions.push({
        label: `${tag} games`,
        query: `${tag} games`,
        category: 'tag' as const,
      });
    }

    return suggestions;
  }, [input, tags, genres, examplePrompts]);

  // Combine instant + entity results
  const allSuggestions = useMemo((): AutocompleteSuggestion[] => {
    // Dedupe by query
    const seen = new Set<string>();
    const combined: AutocompleteSuggestion[] = [];

    for (const s of [...instantSuggestions, ...entityResults]) {
      const key = s.query.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(s);
      }
    }

    return combined.slice(0, 8);
  }, [instantSuggestions, entityResults]);

  // Debounced entity search
  const searchEntities = useCallback(async (query: string) => {
    if (!INPUT_AUTOCOMPLETE_ENABLED) {
      setEntityResults([]);
      setIsSearching(false);
      return;
    }

    // Cancel previous request
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

    setIsSearching(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        abortControllerRef.current = new AbortController();

        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 5 }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          setEntityResults([]);
          setIsSearching(false);
          return;
        }

        const data = (await response.json()) as SearchResponse;
        const results: AutocompleteSuggestion[] = [];

        // Add game results
        if (data.results.games?.length) {
          for (const game of data.results.games.slice(0, 3)) {
            // Generate game-based suggestions
            const gameSuggestions = generateGameSuggestions(game.name, 2);
            results.push(...gameSuggestions);
          }
        }

        // Add publisher results
        if (data.results.publishers?.length) {
          for (const pub of data.results.publishers.slice(0, 2)) {
            results.push({
              label: `All games by ${pub.name}`,
              query: `all games by ${pub.name}`,
              category: 'publisher' as const,
            });
          }
        }

        // Add developer results
        if (data.results.developers?.length) {
          for (const dev of data.results.developers.slice(0, 2)) {
            results.push({
              label: `Games by ${dev.name}`,
              query: `games by ${dev.name}`,
              category: 'developer' as const,
            });
          }
        }

        setEntityResults(results);
        setIsSearching(false);
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          setEntityResults([]);
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  // Trigger entity search on input change
  useEffect(() => {
    searchEntities(input.trim());
  }, [input, searchEntities]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allSuggestions.length]);

  const handleSubmit = useCallback(() => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
      setIsDropdownOpen(false);
      setEntityResults([]);
    }
  }, [input, disabled, onSend]);

  const handleSelectSuggestion = useCallback((suggestion: AutocompleteSuggestion) => {
    if (disabled) {
      return;
    }

    onSend(suggestion.query);
    setInput('');
    setIsDropdownOpen(false);
    setEntityResults([]);
  }, [disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled && e.key === 'Enter' && !e.shiftKey) {
      return;
    }

    // Handle dropdown navigation
    if (isDropdownOpen && allSuggestions.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < allSuggestions.length - 1 ? prev + 1 : 0
          );
          return;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev =>
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

    // Default Enter behavior (submit without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      if (disabled) {
        return;
      }
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFocus = () => {
    setIsDropdownOpen(false);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Check if the new focus target is inside the dropdown
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    // Small delay to allow click events on dropdown items
    setTimeout(() => setIsDropdownOpen(false), 150);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setIsDropdownOpen(false);
  };

  const trimmedInput = input.trim();
  const isDropdownVisible =
    INPUT_AUTOCOMPLETE_ENABLED &&
    isDropdownOpen &&
    (trimmedInput.length === 0 || trimmedInput.length >= MIN_SEARCH_LENGTH);

  return (
    <div className="flex gap-3 items-end">
      <div className="flex-1 relative">
        {/* Autocomplete dropdown */}
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
            w-full min-h-[40px] max-h-[200px] py-2.5 px-4 rounded-lg resize-none
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
