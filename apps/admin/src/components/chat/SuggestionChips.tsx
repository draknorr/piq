'use client';

import type { QuerySuggestion } from '@/lib/chat/query-templates';

interface SuggestionChipsProps {
  suggestions: QuerySuggestion[];
  onSuggestionClick: (query: string) => void;
  isVisible?: boolean;
  label?: string;
}

export function SuggestionChips({
  suggestions,
  onSuggestionClick,
  isVisible = true,
  label = 'Next questions',
}: SuggestionChipsProps) {
  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle animate-in fade-in duration-300">
      <div className="mb-2 text-caption font-medium uppercase tracking-[0.18em] text-text-muted">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick(suggestion.query)}
            className="
              px-3 py-1.5 text-sm rounded-full
              bg-surface-elevated text-text-secondary
              hover:bg-surface-overlay hover:text-text-primary
              border border-border-subtle hover:border-border-muted
              transition-colors cursor-pointer
              focus:outline-none focus:ring-2 focus:ring-accent-primary/40
            "
            aria-label={`${label}: ${suggestion.query}`}
          >
            {truncateLabel(suggestion.label, 40)}
          </button>
        ))}
      </div>
    </div>
  );
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + '…';
}
