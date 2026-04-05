'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleSectionProps {
  children: React.ReactNode;
  previewHeight?: number;
  threshold?: {
    lines?: number;
    chars?: number;
  };
  content: string;
}

const DEFAULT_PREVIEW_HEIGHT = 280;
const DEFAULT_THRESHOLD = { lines: 15, chars: 600 };

export function CollapsibleSection({
  children,
  previewHeight = DEFAULT_PREVIEW_HEIGHT,
  threshold = DEFAULT_THRESHOLD,
  content,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if content exceeds threshold
  const lineCount = content.split('\n').length;
  const charCount = content.length;
  const shouldCollapse =
    (threshold.lines && lineCount > threshold.lines) ||
    (threshold.chars && charCount > threshold.chars);

  // If content doesn't exceed threshold, just render children
  if (!shouldCollapse) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      {/* Content container */}
      <div
        className={`
          transition-all duration-300 ease-in-out overflow-hidden
          ${!isExpanded ? 'max-h-[var(--preview-height)]' : ''}
        `}
        style={
          {
            '--preview-height': `${previewHeight}px`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>

      {/* Gradient overlay when collapsed */}
      {!isExpanded && (
        <div
          className="
            absolute bottom-8 left-0 right-0 h-16
            bg-gradient-to-t from-surface-elevated via-surface-elevated/80 to-transparent
            pointer-events-none
          "
        />
      )}

      {/* Expand/Collapse toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="
          flex items-center gap-1.5 mt-2
          text-body-sm text-accent-primary hover:text-accent-primary/80
          transition-colors duration-150
        "
      >
        {isExpanded ? (
          <>
            <ChevronUp className="w-4 h-4" />
            <span>Show less</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4" />
            <span>Show more</span>
          </>
        )}
      </button>
    </div>
  );
}
