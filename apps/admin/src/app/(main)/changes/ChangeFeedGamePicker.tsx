'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge, SearchInput } from '@/components/ui';
import {
  buildChatEntitySuggestionDescription,
  type ChatEntityPickerEntity,
} from '@/lib/chat/chat-entity-picker';
import { useGameAutocomplete } from './useGameAutocomplete';

export interface SelectedGame {
  appid: number;
  name: string;
}

interface ChangeFeedGamePickerProps {
  selectedGames: SelectedGame[];
  availableGames?: SelectedGame[];
  onChange: (games: SelectedGame[]) => void;
  disabled?: boolean;
}

const MAX_SELECTED_GAMES = 5;

function dedupeSelectedGames(games: SelectedGame[]): SelectedGame[] {
  const seen = new Set<number>();
  const next: SelectedGame[] = [];

  for (const game of games) {
    if (seen.has(game.appid)) {
      continue;
    }

    seen.add(game.appid);
    next.push(game);
  }

  return next.slice(0, MAX_SELECTED_GAMES);
}

function formatSelectedLabel(game: SelectedGame): string {
  return game.name || `App ${game.appid}`;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getMatchQuality(name: string, query: string): ChatEntityPickerEntity['matchQuality'] | null {
  const normalizedName = normalizeSearchText(name);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedName || !normalizedQuery) {
    return null;
  }

  if (normalizedName === normalizedQuery) {
    return 'exact';
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 'prefix';
  }
  if (normalizedName.includes(normalizedQuery)) {
    return 'substring';
  }

  return null;
}

function getMatchRank(matchQuality: ChatEntityPickerEntity['matchQuality']): number {
  switch (matchQuality) {
    case 'exact':
      return 0;
    case 'prefix':
      return 1;
    case 'substring':
      return 2;
    default:
      return 3;
  }
}

export function ChangeFeedGamePicker({
  selectedGames,
  availableGames = [],
  onChange,
  disabled = false,
}: ChangeFeedGamePickerProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { entities, isLoading, error } = useGameAutocomplete(query);

  const selectedAppIds = useMemo(
    () => new Set(selectedGames.map((game) => game.appid)),
    [selectedGames]
  );

  const localSuggestions = useMemo(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return [] as ChatEntityPickerEntity[];
    }

    return availableGames
      .map((game): ChatEntityPickerEntity | null => {
        const matchQuality = getMatchQuality(game.name, trimmedQuery);
        if (!matchQuality) {
          return null;
        }

        return {
          confidence:
            matchQuality === 'exact'
              ? 0.99
              : matchQuality === 'prefix'
                ? 0.96
                : 0.9,
          displayName: game.name,
          entityKind: 'game' as const,
          entityUid: `feed-game:${game.appid}`,
          matchQuality,
          matchedName: game.name,
          platform: 'steam' as const,
          platformEntityId: String(game.appid),
          releaseYear: null,
        };
      })
      .filter((entity): entity is ChatEntityPickerEntity => entity !== null)
      .sort((left, right) => {
        const rankDelta = getMatchRank(left.matchQuality) - getMatchRank(right.matchQuality);
        if (rankDelta !== 0) {
          return rankDelta;
        }

        const lengthDelta = left.displayName.length - right.displayName.length;
        if (lengthDelta !== 0) {
          return lengthDelta;
        }

        return left.displayName.localeCompare(right.displayName);
      });
  }, [availableGames, query]);

  const suggestions = useMemo(
    () => {
      const merged = [...localSuggestions, ...entities];
      const seen = new Set<number>();

      return merged.filter((entity) => {
        const appid = Number(entity.platformEntityId);
        if (!Number.isFinite(appid) || selectedAppIds.has(appid) || seen.has(appid)) {
          return false;
        }

        seen.add(appid);
        return true;
      });
    },
    [entities, localSuggestions, selectedAppIds]
  );

  const canShowSuggestions = isFocused && query.trim().length >= 2;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, suggestions.length]);

  function handleSelect(entity: ChatEntityPickerEntity): void {
    const appid = Number(entity.platformEntityId);
    if (!Number.isFinite(appid)) {
      return;
    }

    const nextGames = dedupeSelectedGames([...selectedGames, { appid, name: entity.displayName }]);
    onChange(nextGames);
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function handleRemove(appid: number): void {
    onChange(selectedGames.filter((game) => game.appid !== appid));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!canShowSuggestions || suggestions.length === 0) {
      if (event.key === 'Escape') {
        setIsFocused(false);
        inputRef.current?.blur();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
        event.preventDefault();
        handleSelect(suggestions[activeIndex] ?? suggestions[0]);
        break;
      case 'Escape':
        event.preventDefault();
        setIsFocused(false);
        inputRef.current?.blur();
        break;
      default:
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 py-1.5">
        <div className="flex items-center gap-2 pr-1">
          <span className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
            Exact titles
          </span>
          <Badge variant="default" size="sm">
            {selectedGames.length}/{MAX_SELECTED_GAMES}
          </Badge>
        </div>

        {selectedGames.length > 0 &&
          selectedGames.map((game) => (
            <span
              key={game.appid}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 text-caption text-text-primary"
            >
              <span className="max-w-[14rem] truncate">{formatSelectedLabel(game)}</span>
              <button
                type="button"
                onClick={() => handleRemove(game.appid)}
                className="rounded-full p-0.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                aria-label={`Remove ${game.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

        <div className="min-w-[12rem] flex-1">
          <SearchInput
            id="change-feed-exact-title-search"
            name="changeFeedExactTitleSearch"
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setIsFocused(true);
              setQuery(event.target.value);
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              window.setTimeout(() => {
                if (document.activeElement !== inputRef.current) {
                  setIsFocused(false);
                }
              }, 120);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || selectedGames.length >= MAX_SELECTED_GAMES}
            placeholder="Filter exact game titles"
            onClear={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="
              !h-8 !rounded-md !border-border-subtle !bg-surface-elevated !pl-8 !pr-8
              !text-body-sm !shadow-none
            "
          />
        </div>
      </div>

      {canShowSuggestions && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-raised shadow-[0_18px_32px_-24px_rgba(0,0,0,0.55)]">
          <div className="max-h-72 overflow-y-auto p-1">
            {isLoading && (
              <div className="px-2 py-2 text-caption text-text-secondary">Searching titles…</div>
            )}

            {!isLoading && error && (
              <div className="px-2 py-2 text-caption text-accent-red">{error}</div>
            )}

            {!isLoading && !error && suggestions.length === 0 && (
              <div className="px-2 py-2 text-caption text-text-secondary">No exact titles found.</div>
            )}

            {suggestions.map((entity, index) => {
              const appid = Number(entity.platformEntityId);
              const isActive = index === activeIndex;

              return (
                <button
                  key={entity.entityUid}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelect(entity);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`
                    flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors
                    ${isActive ? 'bg-surface-elevated' : 'hover:bg-surface-overlay'}
                  `}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-body-sm font-medium text-text-primary">
                        {entity.displayName}
                      </span>
                      <Badge variant="default" size="sm">
                        {entity.entityKind}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-caption text-text-secondary">
                      {buildChatEntitySuggestionDescription(entity)}
                    </p>
                  </div>
                  <div className="text-caption text-text-muted">
                    <p>appid {appid}</p>
                    {entity.releaseYear ? <p>{entity.releaseYear}</p> : null}
                  </div>
                </button>
              );
            })}

            {selectedGames.length >= MAX_SELECTED_GAMES && (
              <div className="px-2 py-2 text-caption text-text-muted">
                Maximum of {MAX_SELECTED_GAMES} exact titles.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
