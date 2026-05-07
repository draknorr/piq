'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Columns, RotateCcw } from 'lucide-react';
import {
  DEFAULT_UNRELEASED_COLUMNS,
  UNRELEASED_COLUMN_CATEGORIES,
  UNRELEASED_COLUMN_DEFINITIONS,
  type UnreleasedColumnId,
} from '../lib/unreleased-columns';

interface UnreleasedColumnSelectorProps {
  visibleColumns: UnreleasedColumnId[];
  onChange: (columns: UnreleasedColumnId[]) => void;
  disabled?: boolean;
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function moveColumn(columns: UnreleasedColumnId[], columnId: UnreleasedColumnId, direction: -1 | 1): UnreleasedColumnId[] {
  const index = columns.indexOf(columnId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return columns;
  const next = [...columns];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function UnreleasedColumnSelector({
  visibleColumns,
  onChange,
  disabled,
}: UnreleasedColumnSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isDefault = arraysEqual(visibleColumns, DEFAULT_UNRELEASED_COLUMNS);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleColumn = (columnId: UnreleasedColumnId) => {
    if (visibleColumns.includes(columnId)) {
      if (visibleColumns.length <= 1) return;
      onChange(visibleColumns.filter((id) => id !== columnId));
      return;
    }
    onChange([...visibleColumns, columnId]);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        disabled={disabled}
        className="flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 text-body-sm text-text-secondary transition-colors hover:bg-surface-elevated disabled:opacity-50"
      >
        <Columns className="h-4 w-4 text-text-muted" />
        Columns ({visibleColumns.length})
        <ChevronDown className={`h-4 w-4 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[560px] w-80 overflow-y-auto rounded-lg border border-border-subtle bg-surface-elevated shadow-lg">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-surface-elevated p-3">
            <span className="text-caption text-text-muted">Customize data columns</span>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_UNRELEASED_COLUMNS)}
              disabled={isDefault}
              className="flex items-center gap-1 text-caption text-accent-primary hover:underline disabled:cursor-default disabled:text-text-muted disabled:no-underline"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          <div className="border-b border-border-subtle">
            <div className="bg-surface-overlay/50 px-3 py-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Visible order
            </div>
            <div className="p-2">
              {visibleColumns.map((columnId, index) => {
                const column = UNRELEASED_COLUMN_DEFINITIONS[columnId];
                return (
                  <div
                    key={columnId}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-overlay"
                  >
                    <div className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                      {column.label}
                    </div>
                    <button
                      type="button"
                      onClick={() => onChange(moveColumn(visibleColumns, columnId, -1))}
                      disabled={index === 0}
                      className="rounded p-1 text-text-muted hover:bg-surface-elevated hover:text-text-primary disabled:opacity-30"
                      aria-label={`Move ${column.label} left`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(moveColumn(visibleColumns, columnId, 1))}
                      disabled={index === visibleColumns.length - 1}
                      className="rounded p-1 text-text-muted hover:bg-surface-elevated hover:text-text-primary disabled:opacity-30"
                      aria-label={`Move ${column.label} right`}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {Object.entries(UNRELEASED_COLUMN_CATEGORIES).map(([categoryKey, category]) => (
            <div key={categoryKey} className="border-b border-border-subtle last:border-b-0">
              <div className="bg-surface-overlay/50 px-3 py-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
                {category.label}
              </div>
              {category.columns.map((columnId) => {
                const column = UNRELEASED_COLUMN_DEFINITIONS[columnId];
                const isVisible = visibleColumns.includes(columnId);
                const cannotHide = isVisible && visibleColumns.length <= 1;

                return (
                  <button
                    key={columnId}
                    type="button"
                    onClick={() => toggleColumn(columnId)}
                    disabled={cannotHide}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-overlay disabled:cursor-default disabled:opacity-50"
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isVisible
                          ? 'border-accent-primary bg-accent-primary'
                          : 'border-border-subtle'
                      }`}
                    >
                      {isVisible && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-body-sm text-text-primary">{column.label}</div>
                      {column.methodology && (
                        <p className="truncate text-caption text-text-muted">{column.methodology}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
