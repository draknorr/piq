'use client';

import { forwardRef } from 'react';
import { Search, Sparkles, Gamepad2 } from 'lucide-react';
import { highlightMatch } from '@/lib/chat/query-templates';
import type { ChatEntitySuggestion } from '@/lib/chat/chat-entity-picker';

export type AutocompleteSuggestion = ChatEntitySuggestion;

interface AutocompleteDropdownProps {
  suggestions: AutocompleteSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  onHover: (index: number) => void;
  inputValue: string;
  isLoading?: boolean;
  isVisible: boolean;
}

export const AutocompleteDropdown = forwardRef<HTMLDivElement, AutocompleteDropdownProps>(
  function AutocompleteDropdown(
    {
      suggestions,
      selectedIndex,
      onSelect,
      onHover,
      inputValue,
      isLoading,
      isVisible,
    },
    ref
  ) {
    if (!isVisible) return null;

    // Group suggestions by category
    const grouped = groupSuggestions(suggestions);

    return (
      <div
        ref={ref}
        className="absolute bottom-full left-0 right-0 mb-2 bg-surface-raised border border-border-muted rounded-lg shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto"
        role="listbox"
      >
        {isLoading && suggestions.length === 0 && (
          <div className="px-4 py-3 text-body-sm text-text-muted flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-accent-primary border-t-transparent animate-spin" />
            Searching...
          </div>
        )}

        {!isLoading && suggestions.length === 0 && inputValue.length >= 2 && (
          <div className="px-4 py-3 text-body-sm text-text-muted">
            No suggestions found
          </div>
        )}

        {grouped.map((group, groupIndex) => (
          <div key={group.category}>
            {groupIndex > 0 && <div className="border-t border-border-subtle" />}
            <div className="px-3 py-1.5 text-caption text-text-muted bg-surface-elevated flex items-center gap-1.5">
              <CategoryIcon category={group.category} />
              {getCategoryLabel(group.category)}
            </div>
            {group.items.map((suggestion) => {
              const globalIndex = suggestions.indexOf(suggestion);
              const isSelected = globalIndex === selectedIndex;

              return (
                <button
                  key={`${suggestion.category}-${suggestion.label}`}
                  className={`
                    w-full px-4 py-2 text-left text-body-sm
                    transition-colors cursor-pointer
                    ${isSelected ? 'chat-accent-soft text-text-primary' : 'text-text-secondary hover:bg-surface-elevated'}
                  `}
                  onClick={() => onSelect(suggestion)}
                  onMouseEnter={() => onHover(globalIndex)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <HighlightedText text={suggestion.label} highlight={inputValue} />
                    {suggestion.description && (
                      <span className="text-caption text-text-muted">
                        {suggestion.description}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }
);

function CategoryIcon({ category }: { category: string }) {
  switch (category) {
    case 'template':
    case 'example':
      return <Sparkles className="w-3 h-3" />;
    case 'game':
      return <Gamepad2 className="w-3 h-3" />;
    default:
      return <Search className="w-3 h-3" />;
  }
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case 'entity':
      return 'Matched entities';
    case 'template':
      return 'Suggested queries';
    case 'example':
      return 'Try asking';
    case 'tag':
      return 'Tags';
    case 'game':
      return 'Games';
    case 'publisher':
      return 'Publishers';
    case 'developer':
      return 'Developers';
    default:
      return 'Suggestions';
  }
}

interface GroupedSuggestions {
  category: string;
  items: AutocompleteSuggestion[];
}

function groupSuggestions(suggestions: AutocompleteSuggestion[]): GroupedSuggestions[] {
  const groups: Map<string, AutocompleteSuggestion[]> = new Map();

  // Priority order for categories
  const categoryOrder = ['entity', 'example', 'template', 'tag', 'game', 'publisher', 'developer'];

  for (const suggestion of suggestions) {
    const existing = groups.get(suggestion.category) || [];
    existing.push(suggestion);
    groups.set(suggestion.category, existing);
  }

  return categoryOrder
    .filter(cat => groups.has(cat))
    .map(category => ({
      category,
      items: groups.get(category)!,
    }));
}

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  const segments = highlightMatch(text, highlight);

  return (
    <span>
      {segments.map((segment, i) => (
        segment.isMatch ? (
          <span key={i} className="chat-accent-icon font-medium">{segment.text}</span>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      ))}
    </span>
  );
}
