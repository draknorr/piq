'use client';

import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { getExamplePrompts } from '@/lib/example-prompts';
import { useGlobalSearch } from '@/components/search';

export function DashboardSearch() {
  const suggestions = getExamplePrompts('dashboard', 4);
  const router = useRouter();
  const { open } = useGlobalSearch();

  const handleSuggestionClick = (suggestion: string) => {
    router.push(`/chat?q=${encodeURIComponent(suggestion)}`);
  };

  return (
    <div className="py-12 md:py-16">
      <div className="max-w-2xl mx-auto text-center">
        {/* Heading */}
        <h1 className="text-display text-text-primary mb-3">
          Gaming Intelligence at Your Fingertips
        </h1>
        <p className="text-body-lg text-text-secondary mb-8 max-w-lg mx-auto">
          Research games, track market trends, and benchmark competitors with natural language queries
        </p>

        {/* Search Trigger Button */}
        <button
          onClick={open}
          className="
            w-full flex items-center gap-3 px-5 py-5 mb-8
            bg-surface-raised border border-border-subtle rounded-2xl
            text-text-muted hover:border-border-muted hover:shadow-glow-primary
            transition-all duration-200 group
          "
        >
          <Search className="w-5 h-5" />
          <span className="flex-1 text-left text-body-lg">
            Search games, publishers, developers...
          </span>
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-caption bg-surface rounded border border-border-subtle group-hover:border-border-muted transition-colors">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>

        {/* Example Prompts */}
        <div className="flex flex-wrap gap-2 justify-center">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              onClick={() => handleSuggestionClick(suggestion)}
              className={`
                px-4 py-2 text-body-sm text-text-secondary
                bg-surface-elevated hover:bg-surface-overlay
                border border-border-subtle hover:border-border-muted
                rounded-full transition-all duration-150
                hover:text-text-primary
                animate-fade-in-up
              `}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
