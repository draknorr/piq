'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Play,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import type {
  FormatParam,
  YoutubeGameVideoItem,
  YoutubeContentClass,
  YoutubeLanguageOption,
  YoutubeMarketPulseItem,
  YoutubeMarketPulseResponse,
  YoutubeMarketPulseVideoItem,
  YoutubeSort,
  YoutubeVideoDrawerSort,
  YoutubeVideosResponse,
  YoutubeWindow,
} from './types';

interface YoutubePulseClientProps {
  error: string | null;
  initialFormat: FormatParam;
  initialPulse: YoutubeMarketPulseResponse;
}

const WINDOW_OPTIONS: Array<{ label: string; value: YoutubeWindow }> = [
  { label: '24h', value: '1d' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

const FORMAT_OPTIONS: Array<{ label: string; value: FormatParam }> = [
  { label: 'All formats', value: 'all' },
  { label: 'Long-form', value: 'long' },
  { label: 'Shorts', value: 'short' },
  { label: 'Live', value: 'live' },
];

const DRAWER_FORMAT_OPTIONS: Array<{ label: string; value: FormatParam }> = FORMAT_OPTIONS;

const SORT_OPTIONS: Array<{ label: string; value: YoutubeSort }> = [
  { label: 'Steam rank', value: 'steam_rank' },
  { label: 'View velocity', value: 'youtube_velocity' },
  { label: 'New videos', value: 'new_videos' },
  { label: 'Creator breadth', value: 'creator_breadth' },
];

const DRAWER_SORT_OPTIONS: Array<{ label: string; value: YoutubeVideoDrawerSort }> = [
  { label: 'Latest', value: 'latest' },
  { label: 'Top views', value: 'top_views' },
  { label: 'Growth', value: 'growth' },
];

function formatCompact(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 100 ? 0 : 1,
    notation: 'compact',
  }).format(value);
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(value: string | null): string {
  const date = parseDateSafe(value);
  if (!date) {
    return 'Unknown';
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) {
    return 'Just now';
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m ago`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)}h ago`;
  }

  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function formatAbsoluteTime(value: string | null): string {
  const date = parseDateSafe(value);
  if (!date) {
    return 'Unknown';
  }

  return date.toLocaleString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });
}

function formatContentClass(value: YoutubeContentClass | null): string {
  if (value === 'short') return 'Shorts';
  if (value === 'live_or_recent_live') return 'Live';
  if (value === 'standard_video') return 'Long-form';
  return 'No dominant format';
}

function formatLanguageCode(value: string | null): string {
  if (!value) return 'Unknown';
  if (value === 'en') return 'EN';
  if (value === 'unknown') return 'Unknown';
  return value.toUpperCase();
}

function formatSortLabel(value: YoutubeSort): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function formatToContentClass(format: FormatParam): YoutubeContentClass | null {
  if (format === 'long') return 'standard_video';
  if (format === 'short') return 'short';
  if (format === 'live') return 'live_or_recent_live';
  return null;
}

function getFormatVariant(value: YoutubeContentClass | null): 'default' | 'purple' | 'orange' | 'cyan' {
  if (value === 'short') return 'purple';
  if (value === 'live_or_recent_live') return 'orange';
  if (value === 'standard_video') return 'cyan';
  return 'default';
}

function getCoverageVariant(
  value: YoutubeMarketPulseItem['coverageQuality']
): 'success' | 'warning' | 'info' | 'default' {
  if (value === 'strong') return 'success';
  if (value === 'noisy') return 'warning';
  if (value === 'limited') return 'info';
  return 'default';
}

function buildLanguageOptions(options: YoutubeLanguageOption[]): YoutubeLanguageOption[] {
  const byCode = new Map<string, YoutubeLanguageOption>();
  byCode.set('en', { code: 'en', label: 'English', videoCount: 0 });
  byCode.set('all', { code: 'all', label: 'All languages', videoCount: 0 });

  for (const option of options) {
    if (!option.code || option.code === 'all') continue;
    byCode.set(option.code, option);
  }

  const english = byCode.get('en')!;
  const all = byCode.get('all')!;
  const rest = Array.from(byCode.values())
    .filter((option) => option.code !== 'en' && option.code !== 'all')
    .sort((a, b) => b.videoCount - a.videoCount || a.label.localeCompare(b.label));

  return [english, all, ...rest];
}

function drawerCacheKey(params: {
  entityUid: string;
  format: FormatParam;
  language: string;
  offset: number;
  sort: YoutubeVideoDrawerSort;
  window: YoutubeWindow;
}): string {
  return [
    params.entityUid,
    params.format,
    params.language,
    params.sort,
    params.window,
    params.offset,
  ].join('|');
}

function languageOptionsCacheKey(params: {
  entityUid: string;
  format: FormatParam;
  window: YoutubeWindow;
}): string {
  return [params.entityUid, params.format, params.window].join('|');
}

function marketVideoToDrawerVideo(video: YoutubeMarketPulseVideoItem): YoutubeGameVideoItem {
  return {
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    contentClass: video.contentClass,
    defaultAudioLanguage: null,
    defaultLanguage: null,
    growthPct: null,
    languageCode: video.languageCode ?? null,
    publishedAt: video.publishedAt,
    thumbnailUrl: video.thumbnailUrl ?? null,
    title: video.title,
    url: video.url,
    videoId: video.videoId,
    viewCount: video.viewCount,
    viewDelta: video.viewDelta,
  };
}

function updateParams(
  current: URLSearchParams,
  patch: Partial<Record<'format' | 'sort' | 'window', string>>
): string {
  const next = new URLSearchParams(current.toString());

  for (const [key, value] of Object.entries(patch)) {
    if (
      !value
      || (key === 'format' && value === 'all')
      || (key === 'window' && value === '7d')
      || (key === 'sort' && value === 'steam_rank')
    ) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }

  const query = next.toString();
  return query ? `/youtube?${query}` : '/youtube';
}

function FilterChip({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em]
        transition-colors disabled:cursor-not-allowed disabled:opacity-45
        ${active
          ? 'border-accent-primary/50 bg-accent-primary/12 text-accent-primary'
          : 'border-border-subtle bg-surface/65 text-text-secondary hover:border-border-muted hover:text-text-primary'}
      `}
    >
      {label}
    </button>
  );
}

function ActivityBar({ item }: { item: YoutubeMarketPulseItem }) {
  const maxValue = Math.max(item.newMatchedVideos, item.uploadChannels, 1);
  const newVideoWidth = Math.max(3, Math.round((item.newMatchedVideos / maxValue) * 100));
  const channelWidth = Math.max(3, Math.round((item.uploadChannels / maxValue) * 100));

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 bg-surface-elevated">
        <div className="h-full bg-accent-blue" style={{ width: `${newVideoWidth}%` }} />
      </div>
      <div className="h-1.5 bg-surface-elevated">
        <div className="h-full bg-accent-purple" style={{ width: `${channelWidth}%` }} />
      </div>
    </div>
  );
}

function GameActivityRow({
  item,
  isSelected,
  onOpenVideos,
  onSelect,
}: {
  item: YoutubeMarketPulseItem;
  isSelected: boolean;
  onOpenVideos: () => void;
  onSelect: () => void;
}) {
  const latest = item.latestVideos[0] ?? null;
  const visibleFormats = item.contentMix.filter((mix) => mix.matchedPrimaryVideoCount > 0 || mix.newMatchedVideos > 0);

  return (
    <article
      className={`
        border-l-2 px-3 py-2.5 transition-colors duration-150
        ${isSelected
          ? 'border-accent-primary bg-accent-primary/10'
          : 'border-transparent hover:bg-surface-elevated/40'}
      `}
    >
      <button
        type="button"
        onClick={onSelect}
        className="grid w-full gap-2 text-left md:grid-cols-[72px_minmax(0,1.25fr)_minmax(220px,0.9fr)_132px] md:items-start"
      >
        <div className="flex items-start justify-between gap-2 md:block">
          <div className="space-y-1">
            <p className="font-mono text-[11px] leading-4 text-accent-blue">#{item.steamRank}</p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {formatCompact(item.ccuPeak)} CCU
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.matchedPrimaryVideoCount > 0 ? (
              <>
                <Badge variant={getCoverageVariant(item.coverageQuality)} size="sm">
                  {item.coverageQuality}
                </Badge>
                {visibleFormats.map((mix) => (
                  <Badge key={mix.contentClass} variant={getFormatVariant(mix.contentClass)} size="sm">
                    {formatContentClass(mix.contentClass)}
                  </Badge>
                ))}
              </>
            ) : (
              <Badge variant="default" size="sm">No Videos</Badge>
            )}
          </div>
          <Link
            href={`/apps/${item.appid}`}
            onClick={(event) => event.stopPropagation()}
            className="mt-1 block truncate text-[13px] font-medium leading-5 text-text-primary hover:text-accent-primary"
          >
            {item.name}
          </Link>
          <p className="mt-1 truncate text-[11px] text-text-secondary">
            {latest
              ? `${latest.channelTitle} · ${formatRelativeTime(latest.publishedAt)}`
              : 'No videos matched for this game'}
          </p>
        </div>

        <div className="min-w-0">
          <p className="truncate text-[12px] leading-5 text-text-primary">
            {latest?.title ?? 'No Videos'}
          </p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-text-muted">
            <span>{formatCompact(item.currentViews)} views</span>
            <span>{formatCompact(item.newMatchedVideos)} videos</span>
            <span>{formatCompact(item.uploadChannels)} channels</span>
          </div>
        </div>

        <div className="space-y-2">
          <ActivityBar item={item} />
          <div className="grid grid-cols-2 gap-1 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            <span>Uploads</span>
            <span>Creators</span>
          </div>
        </div>
      </button>
      {item.latestVideos.length > 0 && (
        <button
          type="button"
          onClick={onOpenVideos}
          className="mt-2 text-[11px] uppercase tracking-[0.08em] text-accent-primary transition-colors hover:text-accent-primary/80"
        >
          View all videos
        </button>
      )}
    </article>
  );
}

function FormatMix({ item }: { item: YoutubeMarketPulseItem }) {
  if (item.contentMix.length === 0) {
    return (
      <div className="border border-border-subtle bg-surface/20 px-3 py-2">
        <p className="text-[12px] leading-5 text-text-secondary">
          No format mix returned for this game.
        </p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden border border-border-subtle bg-surface/20">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Format mix</p>
        <span className="font-mono text-[11px] text-text-muted">{item.contentMix.length}</span>
      </div>
      <div className="divide-y divide-border-subtle">
        {item.contentMix.map((mix) => (
          <div
            key={mix.contentClass}
            className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] gap-2 px-3 py-2 text-[11px]"
          >
            <p className="truncate text-text-primary">{formatContentClass(mix.contentClass)}</p>
            <p className="text-right font-mono text-text-secondary">
              {formatCompact(mix.newMatchedVideos)}
            </p>
            <p className="text-right font-mono text-text-secondary">
              {formatCompact(mix.currentViews)}
            </p>
            <p className="text-right font-mono text-text-secondary">
              {formatCompact(mix.matchedPrimaryVideoCount)}
            </p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] gap-2 border-t border-border-subtle px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        <span>Format</span>
        <span className="text-right">New</span>
        <span className="text-right">Views</span>
        <span className="text-right">Total</span>
      </div>
    </section>
  );
}

function VideoEvidence({
  onOpenAll,
  videos,
}: {
  onOpenAll: () => void;
  videos: YoutubeMarketPulseVideoItem[];
}) {
  if (videos.length === 0) {
    return (
      <div className="border border-border-subtle bg-surface/20 px-3 py-2">
        <p className="text-[12px] leading-5 text-text-secondary">
          No matched videos were returned for the current filter.
        </p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden border border-border-subtle bg-surface/20">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
          Latest Videos
        </p>
        <button
          type="button"
          onClick={onOpenAll}
          className="text-[11px] uppercase tracking-[0.08em] text-accent-primary hover:text-accent-primary/80"
        >
          View all
        </button>
      </div>
      <div className="divide-y divide-border-subtle">
        {videos.map((video) => (
          <a
            key={video.videoId}
            href={video.url}
            target="_blank"
            rel="noreferrer"
            className="block px-3 py-2 transition-colors hover:bg-surface-elevated/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-[12px] font-medium leading-5 text-text-primary">
                  {video.title}
                </p>
                <p className="mt-1 truncate text-[11px] text-text-secondary">
                  {video.channelTitle} · {formatAbsoluteTime(video.publishedAt)}
                </p>
              </div>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={getFormatVariant(video.contentClass)} size="sm">
                {formatContentClass(video.contentClass)}
              </Badge>
              <Badge variant="default" size="sm">
                {formatCompact(video.viewCount)} views
              </Badge>
              <Badge variant="info" size="sm">
                +{formatCompact(video.viewDelta)}
              </Badge>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function InspectorPanel({
  onOpenVideos,
  selected,
  summary,
}: {
  onOpenVideos: () => void;
  selected: YoutubeMarketPulseItem | null;
  summary: YoutubeMarketPulseResponse['summary'];
}) {
  if (!selected) {
    return (
      <aside className="sticky top-[188px] space-y-3">
        <section className="border border-border-subtle bg-surface/25 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Market rollup</p>
          <div className="mt-3 grid grid-cols-2 gap-px bg-border-subtle">
            <div className="bg-surface/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Games</p>
              <p className="mt-1 font-mono text-[13px] text-text-primary">
                {formatCompact(summary.gamesAnalyzed)}
              </p>
            </div>
            <div className="bg-surface/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Covered</p>
              <p className="mt-1 font-mono text-[13px] text-text-primary">
                {formatCompact(summary.gamesWithCoverage)}
              </p>
            </div>
            <div className="bg-surface/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Videos</p>
              <p className="mt-1 font-mono text-[13px] text-text-primary">
                {formatCompact(summary.newMatchedVideos)}
              </p>
            </div>
            <div className="bg-surface/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Current views</p>
              <p className="mt-1 font-mono text-[13px] text-text-primary">
                {formatCompact(summary.currentViews)}
              </p>
            </div>
          </div>
        </section>
      </aside>
    );
  }

  return (
    <aside className="sticky top-[188px] space-y-3">
      <section className="border border-border-subtle bg-surface/25">
        <div className="border-b border-border-subtle px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Inspector</p>
          <Link
            href={`/apps/${selected.appid}`}
            className="mt-1 block truncate text-[14px] font-semibold text-text-primary hover:text-accent-primary"
          >
            {selected.name}
          </Link>
          <p className="mt-1 text-[11px] text-text-muted">
            Steam #{selected.steamRank} · {formatCompact(selected.ccuPeak)} peak CCU
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border-subtle">
          <div className="bg-surface/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Current views</p>
            <p className="mt-1 font-mono text-[13px] text-text-primary">
              {formatCompact(selected.currentViews)}
            </p>
          </div>
          <div className="bg-surface/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">New videos</p>
            <p className="mt-1 font-mono text-[13px] text-text-primary">
              {formatCompact(selected.newMatchedVideos)}
            </p>
          </div>
          <div className="bg-surface/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Channels</p>
            <p className="mt-1 font-mono text-[13px] text-text-primary">
              {formatCompact(selected.uploadChannels)}
            </p>
          </div>
          <div className="bg-surface/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Matched</p>
            <p className="mt-1 font-mono text-[13px] text-text-primary">
              {formatCompact(selected.matchedPrimaryVideoCount)}
            </p>
          </div>
          {selected.reviewScore !== null && (
            <div className="bg-surface/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Review score</p>
              <p className="mt-1 font-mono text-[13px] text-text-primary">
                {Math.round(selected.reviewScore)}/10
              </p>
            </div>
          )}
        </div>
      </section>

      <FormatMix item={selected} />
      <VideoEvidence onOpenAll={onOpenVideos} videos={selected.latestVideos} />
    </aside>
  );
}

function VideoThumbnail({ video }: { video: YoutubeGameVideoItem }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden border border-border-subtle bg-surface-elevated sm:w-[132px]">
      {video.thumbnailUrl ? (
        <img
          src={video.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Play className="h-5 w-5 text-text-muted" />
        </div>
      )}
      <span className="absolute bottom-1 left-1 border border-black/30 bg-black/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-white">
        {formatContentClass(video.contentClass)}
      </span>
    </div>
  );
}

function VideoDrawer({
  game,
  initialFormat,
  initialWindow,
  isOpen,
  onClose,
}: {
  game: YoutubeMarketPulseItem | null;
  initialFormat: FormatParam;
  initialWindow: YoutubeWindow;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<FormatParam>(initialFormat);
  const [language, setLanguage] = useState('en');
  const [languageOptions, setLanguageOptions] = useState<YoutubeLanguageOption[]>([]);
  const [sort, setSort] = useState<YoutubeVideoDrawerSort>('latest');
  const [items, setItems] = useState<YoutubeGameVideoItem[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerCacheRef = useRef(new Map<string, {
    hasNextPage: boolean;
    items: YoutubeGameVideoItem[];
    nextOffset: number;
  }>());
  const languageOptionsCacheRef = useRef(new Map<string, YoutubeLanguageOption[]>());

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !game) {
      return;
    }

    setFormat(initialFormat);
    setLanguage('en');
    setSort('latest');
    setItems(game.latestVideos.map(marketVideoToDrawerVideo));
    setNextOffset(game.latestVideos.length);
    setHasNextPage(game.latestVideos.length > 0);
  }, [game?.entityUid, initialFormat, isOpen]);

  useEffect(() => {
    if (!isOpen || !game) {
      return;
    }

    const activeGame = game;
    const controller = new AbortController();
    const key = drawerCacheKey({
      entityUid: activeGame.entityUid,
      format,
      language,
      offset: 0,
      sort,
      window: initialWindow,
    });
    const languageKey = languageOptionsCacheKey({
      entityUid: activeGame.entityUid,
      format,
      window: initialWindow,
    });
    const cached = drawerCacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      setNextOffset(cached.nextOffset);
      setHasNextPage(cached.hasNextPage);
    }

    async function loadVideos(): Promise<void> {
      setLoading(true);
      setError(null);

      const cachedLanguageOptions = languageOptionsCacheRef.current.get(languageKey);
      if (cachedLanguageOptions) {
        setLanguageOptions(cachedLanguageOptions);
      }

      try {
        const response = await fetch('/api/youtube/videos', {
          body: JSON.stringify({
            ...(formatToContentClass(format) ? { contentClass: formatToContentClass(format) } : {}),
            entityUid: activeGame.entityUid,
            includeLanguageOptions: !cachedLanguageOptions,
            includeSummary: false,
            language,
            limit: 25,
            offset: 0,
            sort,
            window: initialWindow,
          }),
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as YoutubeVideosResponse | null;
        if (!response.ok || !payload?.success || !payload.result) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }

        setItems(payload.result.items);
        const responseLanguageOptions = payload.result.languageOptions ?? [];
        if (responseLanguageOptions.length > 0) {
          languageOptionsCacheRef.current.set(languageKey, responseLanguageOptions);
          setLanguageOptions(responseLanguageOptions);
        }
        const responseNextOffset = payload.result.pagination?.offset != null && payload.result.pagination?.limit != null
          ? payload.result.pagination.offset + payload.result.pagination.limit
          : payload.result.items.length;
        const responseHasNextPage = Boolean(payload.result.pagination?.hasNextPage);
        setNextOffset(responseNextOffset);
        setHasNextPage(responseHasNextPage);
        drawerCacheRef.current.set(key, {
          hasNextPage: responseHasNextPage,
          items: payload.result.items,
          nextOffset: responseNextOffset,
        });
      } catch (loadError) {
        if ((loadError as { name?: string }).name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load videos');
          if (!cached) {
            setItems([]);
            setLanguageOptions([]);
            setNextOffset(0);
            setHasNextPage(false);
          }
        }
      } finally {
        setLoading(false);
      }
    }

    void loadVideos();

    return () => controller.abort();
  }, [format, game, initialWindow, isOpen, language, sort]);

  async function loadMore(): Promise<void> {
    if (!game || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setError(null);

    try {
      const response = await fetch('/api/youtube/videos', {
        body: JSON.stringify({
          ...(formatToContentClass(format) ? { contentClass: formatToContentClass(format) } : {}),
          entityUid: game.entityUid,
          includeLanguageOptions: false,
          includeSummary: false,
          language,
          limit: 25,
          offset: nextOffset,
          sort,
          window: initialWindow,
        }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const payload = await response.json().catch(() => null) as YoutubeVideosResponse | null;
      if (!response.ok || !payload?.success || !payload.result) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      const nextItems = [...items, ...payload.result!.items];
      setItems(nextItems);
      setLanguageOptions(payload.result.languageOptions ?? languageOptions);
      setNextOffset(payload.result.pagination?.offset != null && payload.result.pagination?.limit != null
        ? payload.result.pagination.offset + payload.result.pagination.limit
        : nextOffset + payload.result.items.length);
      setHasNextPage(Boolean(payload.result.pagination?.hasNextPage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load more videos');
    } finally {
      setLoadingMore(false);
    }
  }

  if (!isOpen || !game) {
    return null;
  }

  const drawerLanguageOptions = buildLanguageOptions(languageOptions);
  const selectedLanguageLabel =
    drawerLanguageOptions.find((option) => option.code === language)?.label ?? 'English';
  const emptyCopy =
    language === 'en'
      ? 'No English videos match this format and sort.'
      : sort === 'growth'
        ? 'No videos have measurable growth for this window.'
        : `No videos match ${selectedLanguageLabel.toLowerCase()} with this format and sort.`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close video drawer"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${game.name} videos`}
        className="relative z-10 flex h-full w-full max-w-3xl flex-col border-l border-border-subtle bg-surface-raised shadow-lg"
      >
        <div className="border-b border-border-subtle bg-surface-elevated px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">All Videos</p>
              <h2 className="mt-1 truncate text-[15px] font-semibold text-text-primary">
                {game.name}
              </h2>
              <p className="mt-1 text-[11px] text-text-muted">
                {formatCompact(game.matchedPrimaryVideoCount)} matched · {formatCompact(game.currentViews)} views
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
              aria-label="Close all videos"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {DRAWER_FORMAT_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                label={option.label}
                active={format === option.value}
                onClick={() => setFormat(option.value)}
              />
            ))}
            <div className="ml-auto flex items-center gap-2 border border-border-subtle bg-surface/65 px-2.5 text-[11px] uppercase tracking-[0.08em] text-text-secondary max-sm:ml-0">
              <span>Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="h-8 min-w-[112px] bg-transparent text-[12px] text-text-primary focus:outline-none"
              >
                {drawerLanguageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}{option.videoCount > 0 ? ` (${formatCompact(option.videoCount)})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 border border-border-subtle bg-surface/65 px-2.5 text-[11px] uppercase tracking-[0.08em] text-text-secondary">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as YoutubeVideoDrawerSort)}
                className="h-8 min-w-0 bg-transparent text-[12px] text-text-primary focus:outline-none"
              >
                {DRAWER_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex h-56 items-center justify-center gap-2 text-[12px] text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading videos...
            </div>
          ) : error ? (
            <div className="m-4 border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[12px] text-accent-red">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <Search className="h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-medium text-text-primary">No videos</p>
              <p className="text-[12px] text-text-secondary">
                {emptyCopy}
              </p>
            </div>
          ) : (
            <div>
              {loading && (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border-subtle bg-surface-raised/95 px-4 py-2 text-[11px] text-text-secondary backdrop-blur">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Updating videos...
                </div>
              )}
              <div className="divide-y divide-border-subtle">
              {items.map((video) => (
                <a
                  key={`${video.videoId}-${video.publishedAt ?? ''}`}
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-4 py-3 transition-colors hover:bg-surface-elevated/45"
                >
                  <div className="grid gap-3 sm:grid-cols-[132px_minmax(0,1fr)_96px]">
                    <VideoThumbnail video={video} />
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-[13px] font-medium leading-5 text-text-primary">
                          {video.title}
                        </p>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted sm:hidden" />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-secondary">
                        {video.channelTitle} · {formatAbsoluteTime(video.publishedAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant={getFormatVariant(video.contentClass)} size="sm">
                          {formatContentClass(video.contentClass)}
                        </Badge>
                        <Badge variant="default" size="sm">
                          {formatLanguageCode(video.languageCode)}
                        </Badge>
                        {video.viewDelta !== null && video.viewDelta > 0 && (
                          <Badge variant="info" size="sm">
                            +{formatCompact(video.viewDelta)} growth
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3 sm:block sm:text-right">
                      <div>
                        <p className="font-mono text-[13px] text-text-primary">
                          {video.viewCount === null ? 'Unknown' : formatCompact(video.viewCount)}
                        </p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                          views
                        </p>
                      </div>
                      <ExternalLink className="mt-0.5 hidden h-3.5 w-3.5 text-text-muted sm:ml-auto sm:block" />
                    </div>
                  </div>
                </a>
              ))}
              </div>
            </div>
          )}
        </div>

        {hasNextPage && !loading && (
          <div className="border-t border-border-subtle bg-surface-elevated px-4 py-3">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full border border-border-subtle bg-surface/65 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-border-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

export function YoutubePulseClient({
  error,
  initialFormat,
  initialPulse,
}: YoutubePulseClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const pulse = initialPulse;
  const activeFormat = initialFormat;
  const activeWindow = pulse.window;
  const activeSort = pulse.sort;
  const [videoDrawerOpen, setVideoDrawerOpen] = useState(false);
  const [selectedAppid, setSelectedAppid] = useState<number | null>(
    pulse.items[0]?.appid ?? null
  );
  const selected = useMemo(
    () => pulse.items.find((item) => item.appid === selectedAppid) ?? pulse.items[0] ?? null,
    [pulse.items, selectedAppid]
  );

  const navigate = (patch: Partial<Record<'format' | 'sort' | 'window', string>>) => {
    const href = updateParams(searchParams, patch);
    startTransition(() => router.push(href, { scroll: false }));
  };

  const openVideos = (item: YoutubeMarketPulseItem | null = selected) => {
    if (!item) {
      return;
    }

    setSelectedAppid(item.appid);
    setVideoDrawerOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-4 z-30 space-y-2 border border-border-subtle bg-surface/95 px-3 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2">
            <h1 className="text-[15px] font-semibold text-text-primary">YouTube Pulse</h1>
          </div>

          {isPending && (
            <Badge variant="default" size="sm">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Updating
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FORMAT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={activeFormat === option.value}
              onClick={() => navigate({ format: option.value })}
            />
          ))}
          <div className="mx-1 hidden h-5 w-px bg-border-subtle lg:block" />
          {WINDOW_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={activeWindow === option.value}
              onClick={() => navigate({ window: option.value })}
            />
          ))}
          <div className="ml-auto flex items-center gap-2 border border-border-subtle bg-surface/65 px-2.5 text-[11px] uppercase tracking-[0.08em] text-text-secondary">
            <span>Sort</span>
            <select
              value={activeSort}
              onChange={(event) => navigate({ sort: event.target.value })}
              className="h-8 min-w-0 bg-transparent text-[12px] text-text-primary focus:outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 text-[11px]">
          <span className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary">
            Rank basis: top {formatCompact(pulse.summary.gamesAnalyzed)} by Steam CCU
          </span>
          <span className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary">
            Current sort: {formatSortLabel(activeSort)}
          </span>
          <span className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary">
            Snapshot: {formatAbsoluteTime(pulse.summary.latestSnapshotAt)}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[12px] text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {pulse.availability.state !== 'ready' && (
        <div className="border border-accent-yellow/30 bg-accent-yellow/10 px-3 py-2">
          <p className="text-[12px] leading-5 text-text-primary">
            {pulse.availability.reason ?? 'Required YouTube tables are empty or unavailable.'}
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className={`min-w-0 ${isPending ? 'opacity-60' : ''}`}>
          <div className="overflow-hidden border border-border-subtle bg-surface/25">
            <div className="grid grid-cols-[72px_minmax(0,1.25fr)_minmax(220px,0.9fr)_132px] gap-2 border-b border-border-subtle bg-surface/35 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-text-tertiary max-md:hidden">
              <span>Steam</span>
              <span>Game</span>
              <span>YouTube evidence</span>
              <span>Signal bars</span>
            </div>

            {pulse.items.length > 0 ? (
              <div className="divide-y divide-border-subtle">
                {pulse.items.map((item) => (
                  <GameActivityRow
                    key={item.appid}
                    item={item}
                    isSelected={selected?.appid === item.appid}
                    onOpenVideos={() => openVideos(item)}
                    onSelect={() => setSelectedAppid(item.appid)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-3 py-10 text-center">
                <Search className="h-5 w-5 text-text-muted" />
                <p className="text-[13px] font-medium text-text-primary">No YouTube pulse rows</p>
                <p className="max-w-md text-[12px] leading-5 text-text-secondary">
                  The current window and format filter did not return matched creator activity.
                </p>
              </div>
            )}
          </div>
        </main>

        <div className="hidden xl:block">
          <InspectorPanel
            onOpenVideos={() => openVideos(selected)}
            selected={selected}
            summary={pulse.summary}
          />
        </div>
      </div>

      {selected && (
        <div className="space-y-3 xl:hidden">
          <section className="border border-border-subtle bg-surface/25 px-3 py-2">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-text-muted" />
              <p className="truncate text-[13px] font-medium text-text-primary">{selected.name}</p>
              <Badge variant={getFormatVariant(selected.dominantContentClass)} size="sm">
                {formatContentClass(selected.dominantContentClass)}
              </Badge>
            </div>
          </section>
          <FormatMix item={selected} />
          <VideoEvidence onOpenAll={() => openVideos(selected)} videos={selected.latestVideos} />
        </div>
      )}

      <VideoDrawer
        game={selected}
        initialFormat={activeFormat}
        initialWindow={activeWindow}
        isOpen={videoDrawerOpen}
        onClose={() => setVideoDrawerOpen(false)}
      />
    </div>
  );
}
