'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  ExternalLink,
  Filter,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge, Button, SearchInput } from '@/components/ui';
import type {
  AppType,
  ChangeActivityDetail,
  ChangeActivityMode,
  ChangeActivityRow,
  ChangeActivitySignalFamily,
  ChangeActivitySort,
  ChangeActivityView,
  ChangeBurstImpactWindow,
  ChangeDiffPreview,
  ChangeFeedStatus,
} from './lib';
import {
  CHANGE_ACTIVITY_MODES,
  CHANGE_ACTIVITY_SIGNAL_FAMILIES,
  CHANGE_ACTIVITY_SORTS,
  CHANGE_ACTIVITY_VIEWS,
  CHANGE_FEED_APP_TYPES,
  formatChangeLabel,
} from './lib';
import { ChangeFeedGamePicker, type SelectedGame } from './ChangeFeedGamePicker';

type FeedRange = '24h' | '7d' | '30d';
type AppTypeFilter = 'all' | AppType;
type InspectorMode = 'readable' | 'raw';

interface ChangeFeedWorkspaceProps {
  authReady: boolean;
  status: ChangeFeedStatus | null;
  statusError: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  items: ChangeActivityRow[];
  cursor: string | null;
  selectedActivityId: string | null;
  selectedRow: ChangeActivityRow | null;
  selectedDetail: ChangeActivityDetail | null;
  selectedDetailLoading: boolean;
  selectedDetailError: string | null;
  inspectorMode: InspectorMode;
  searchInput: string;
  selectedApps: SelectedGame[];
  view: ChangeActivityView;
  mode: ChangeActivityMode;
  range: FeedRange;
  sort: ChangeActivitySort;
  appType: AppTypeFilter;
  signalFamilies: ChangeActivitySignalFamily[];
  showAdvancedFilters: boolean;
  onUpdateFilters: (updates: Record<string, string | string[] | null>) => void;
  onSearchInputChange: (value: string) => void;
  onClearFilters: () => void;
  onToggleAdvancedFilters: () => void;
  onSelectActivity: (activityId: string | null) => void;
  onInspectorModeChange: (mode: InspectorMode) => void;
  onLoadMore: () => void;
}

const RANGE_LABELS: Record<FeedRange, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
};

const VIEW_LABELS: Record<ChangeActivityView, string> = {
  overview: 'Overview',
  'launch-watch': 'Launch Watch',
  'commercial-moves': 'Commercial Moves',
  'store-refreshes': 'Store Refreshes',
  'all-activity': 'All Activity',
};

const MODE_LABELS: Record<ChangeActivityMode, string> = {
  all: 'All activity',
  changes: 'Changes only',
  announcements: 'Announcements only',
};

const SORT_LABELS: Record<ChangeActivitySort, string> = {
  relevant: 'Most relevant',
  newest: 'Newest',
  'biggest-change': 'Biggest change',
  'most-commercial': 'Most commercial',
  'most-launch-relevant': 'Most launch-relevant',
};

const SIGNAL_LABELS: Record<ChangeActivitySignalFamily, string> = {
  announcement: 'Announcement',
  release: 'Release',
  pricing: 'Pricing',
  'store-page': 'Store page',
  media: 'Media',
  taxonomy: 'Positioning',
  platform: 'Platform',
  build: 'Build activity',
};

const APP_TYPE_LABELS: Partial<Record<AppType, string>> = {
  game: 'Games',
  demo: 'Demos',
  application: 'Apps',
  dlc: 'DLC',
  mod: 'Mods',
  video: 'Video',
  hardware: 'Hardware',
  music: 'Music',
  episode: 'Episode',
  tool: 'Tools',
  series: 'Series',
  advertising: 'Advertising',
};

const APP_TYPE_OPTIONS: Array<{ id: AppTypeFilter; label: string }> = [
  { id: 'all', label: 'All app types' },
  ...CHANGE_FEED_APP_TYPES.map((appType) => ({
    id: appType,
    label: APP_TYPE_LABELS[appType] ?? formatTokenLabel(appType),
  })),
];

function formatTokenLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(timestamp: string | null): string {
  const date = parseDateSafe(timestamp);
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

function formatAbsoluteTime(timestamp: string | null): string {
  const date = parseDateSafe(timestamp);
  if (!date) {
    return 'Unknown';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabelFromKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map((value) => Number.parseInt(value, 10));
  if (![year, month, day].every((value) => Number.isInteger(value))) {
    return 'Unknown date';
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatAppTypeLabel(appType: AppType | null): string {
  if (!appType) {
    return 'Unknown';
  }

  return APP_TYPE_LABELS[appType] ?? formatTokenLabel(appType);
}

function getSignalBadgeVariant(
  family: ChangeActivitySignalFamily
): 'info' | 'warning' | 'purple' | 'orange' | 'cyan' {
  switch (family) {
    case 'announcement':
      return 'purple';
    case 'release':
      return 'warning';
    case 'pricing':
      return 'orange';
    case 'platform':
      return 'cyan';
    default:
      return 'info';
  }
}

function getStatusBadgeVariant(state: ChangeFeedStatus['state']): 'success' | 'warning' | 'error' {
  switch (state) {
    case 'delayed':
      return 'error';
    case 'catching_up':
      return 'warning';
    default:
      return 'success';
  }
}

function getStatusLabel(state: ChangeFeedStatus['state']): string {
  switch (state) {
    case 'delayed':
      return 'Capture delayed';
    case 'catching_up':
      return 'Capture catching up';
    default:
      return 'Capture healthy';
  }
}

function getStoryLabel(storyKind: ChangeActivityRow['storyKind']): string {
  switch (storyKind) {
    case 'announcement':
      return 'Announcement';
    case 'release-prep':
      return 'Launch prep';
    case 'commercial-move':
      return 'Commercial move';
    case 'store-refresh':
      return 'Store refresh';
    case 'positioning-shift':
      return 'Positioning shift';
    case 'platform-expansion':
      return 'Platform expansion';
    case 'build-activity':
      return 'Build activity';
    default:
      return 'General update';
  }
}

function stripHtml(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Unserializable';
  }
}

function formatMetric(value: number | null, kind: 'number' | 'price' | 'percent' = 'number'): string {
  if (value == null) {
    return '—';
  }

  if (kind === 'price') {
    return `$${(value / 100).toFixed(2)}`;
  }

  if (kind === 'percent') {
    return `${Math.round(value)}%`;
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function hasImpactWindow(window: ChangeBurstImpactWindow | null): boolean {
  if (!window) {
    return false;
  }

  return Object.values(window).some((value) => value !== null);
}

function isImageUrl(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(value);
}

function groupByDate(items: ChangeActivityRow[]): Array<{ key: string; label: string; items: ChangeActivityRow[] }> {
  const groups = new Map<string, ChangeActivityRow[]>();

  for (const item of items) {
    const parsedDate = parseDateSafe(item.occurredAt);
    const dateKey = parsedDate ? formatLocalDateKey(parsedDate) : item.occurredAt.slice(0, 10);
    const current = groups.get(dateKey) ?? [];
    current.push(item);
    groups.set(dateKey, current);
  }

  return Array.from(groups.entries())
    .map(([key, groupedItems]) => ({
      key,
      label: formatDateLabelFromKey(key),
      items: groupedItems,
    }))
    .sort((left, right) => right.key.localeCompare(left.key));
}

function stringifySelectedApps(selectedApps: SelectedGame[]): {
  appIds: string | null;
  appNames: string[] | null;
} {
  if (selectedApps.length === 0) {
    return { appIds: null, appNames: null };
  }

  return {
    appIds: selectedApps.map((game) => String(game.appid)).join(','),
    appNames: selectedApps.map((game) => game.name),
  };
}

function buildRowSecondaryText(row: ChangeActivityRow): string {
  const factText = row.facts.slice(0, 2).filter(Boolean).join(' • ');
  return factText || row.summary;
}

function FilterChip({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors
        ${active ? 'border-accent-primary/35 bg-accent-primary/10 text-text-primary' : 'border-border-subtle bg-surface text-text-secondary hover:bg-surface-elevated/70 hover:text-text-primary'}
      `}
    >
      {label}
    </button>
  );
}

function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="border border-dashed border-border-subtle bg-surface/40 px-4 py-10 text-center">
      <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-surface-elevated text-text-muted">
        {icon}
      </div>
      <h3 className="mt-3 text-body font-medium text-text-primary">{title}</h3>
      <p className="mt-1 text-body-sm text-text-secondary">{description}</p>
    </div>
  );
}

function truncateText(value: string | null, maxLength = 180): string {
  if (!value) {
    return 'None';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function summarizeValue(value: unknown, maxLength = 84): string {
  return truncateText(formatValue(value).replace(/\s+/g, ' ').trim(), maxLength);
}

function formatSourceLabel(source: ChangeActivityDetail['rawEvents'][number]['source']): string {
  switch (source) {
    case 'pics':
      return 'Build data';
    case 'storefront':
      return 'Store data';
    case 'media':
      return 'Media';
    default:
      return formatTokenLabel(source);
  }
}

function ImpactWindowCard({
  title,
  window,
}: {
  title: string;
  window: ChangeBurstImpactWindow | null;
}) {
  return (
    <div className="border border-border-subtle bg-surface/20 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{title}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-5">
        <div className="flex items-center justify-between gap-2 text-text-secondary">
          <dt>Peak CCU</dt>
          <dd className="text-text-primary">{formatMetric(window?.ccuPeak ?? null)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 text-text-secondary">
          <dt>Reviews</dt>
          <dd className="text-text-primary">{formatMetric(window?.totalReviews ?? null)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 text-text-secondary">
          <dt>Score</dt>
          <dd className="text-text-primary">
            {formatMetric(window?.reviewScore ?? null, 'percent')}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 text-text-secondary">
          <dt>Price</dt>
          <dd className="text-text-primary">{formatMetric(window?.priceCents ?? null, 'price')}</dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 text-text-secondary">
          <dt>Discount</dt>
          <dd className="text-text-primary">
            {formatMetric(window?.discountPercent ?? null, 'percent')}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function DiffPreviewBlock({ diff }: { diff: ChangeDiffPreview }) {
  const imageGallery = [...diff.added, ...diff.removed].filter(isImageUrl);
  const compactMeta = [
    diff.added.length > 0 ? `${diff.added.length} added` : null,
    diff.removed.length > 0 ? `${diff.removed.length} removed` : null,
    diff.note,
  ]
    .filter(Boolean)
    .join(' • ');

  if (diff.kind === 'media') {
    return (
      <section className="overflow-hidden border border-border-subtle bg-surface/20">
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-text-primary">{diff.label}</p>
            {diff.note && <p className="mt-1 text-[11px] text-text-muted">{diff.note}</p>}
          </div>
        </div>
        <div className="grid gap-px bg-border-subtle md:grid-cols-2">
          <div className="bg-surface/35 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Before</p>
            {diff.beforeImageUrl && isImageUrl(diff.beforeImageUrl) ? (
              <img
                src={diff.beforeImageUrl}
                alt={`${diff.label} before`}
                className="mt-2 h-20 w-full border border-border-subtle object-cover"
              />
            ) : (
              <div className="mt-2 bg-surface px-2.5 py-2 text-[11px] leading-5 text-text-secondary">
                {diff.beforeImageUrl ?? 'No prior image'}
              </div>
            )}
          </div>
          <div className="bg-surface/35 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">After</p>
            {diff.afterImageUrl && isImageUrl(diff.afterImageUrl) ? (
              <img
                src={diff.afterImageUrl}
                alt={`${diff.label} after`}
                className="mt-2 h-20 w-full border border-border-subtle object-cover"
              />
            ) : (
              <div className="mt-2 bg-surface px-2.5 py-2 text-[11px] leading-5 text-text-secondary">
                {diff.afterImageUrl ?? 'No new image'}
              </div>
            )}
          </div>
        </div>
        {imageGallery.length > 0 && (
          <div className="grid grid-cols-2 gap-2 border-t border-border-subtle px-3 py-2">
            {imageGallery.map((url) => (
              <img
                key={`${diff.id}-${url}`}
                src={url}
                alt={diff.label}
                className="h-16 w-full border border-border-subtle object-cover"
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  if (diff.kind === 'text') {
    return (
      <section className="overflow-hidden border border-border-subtle bg-surface/20">
        <div className="border-b border-border-subtle px-3 py-2">
          <p className="text-[12px] font-medium text-text-primary">{diff.label}</p>
        </div>
        <div className="grid gap-px bg-border-subtle md:grid-cols-2">
          <div className="bg-surface/35 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Before</p>
            <div className="mt-2 bg-surface px-2.5 py-2 text-[12px] leading-5 text-text-secondary">
              {diff.beforeText ?? 'No prior copy'}
            </div>
          </div>
          <div className="bg-surface/35 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">After</p>
            <div className="mt-2 bg-surface px-2.5 py-2 text-[12px] leading-5 text-text-secondary">
              {diff.afterText ?? 'No new copy'}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (diff.kind === 'list') {
    return (
      <section className="overflow-hidden border border-border-subtle bg-surface/20">
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-text-primary">{diff.label}</p>
            {compactMeta ? <p className="mt-1 text-[11px] text-text-muted">{compactMeta}</p> : null}
          </div>
        </div>
        {imageGallery.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 px-3 py-2">
            {imageGallery.map((url) => (
              <img
                key={url}
                src={url}
                alt={diff.label}
                className="h-16 w-full border border-border-subtle object-cover"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-px bg-border-subtle md:grid-cols-2">
            <div className="bg-surface/35 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Added</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {diff.added.length === 0 ? (
                  <span className="text-[11px] text-text-muted">None</span>
                ) : (
                  diff.added.map((item) => (
                    <Badge key={`${diff.id}-${item}`} variant="success" size="sm">
                      {item}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div className="bg-surface/35 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Removed</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {diff.removed.length === 0 ? (
                  <span className="text-[11px] text-text-muted">None</span>
                ) : (
                  diff.removed.map((item) => (
                    <Badge key={`${diff.id}-${item}`} variant="error" size="sm">
                      {item}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (diff.kind === 'note') {
    return (
      <section className="overflow-hidden border border-border-subtle bg-surface/20">
        <div className="px-3 py-2">
          <p className="text-[12px] font-medium text-text-primary">{diff.label}</p>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{diff.note}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden border border-border-subtle bg-surface/20">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,112px)_minmax(0,112px)] gap-px bg-border-subtle">
        <div className="bg-surface/35 px-3 py-2">
          <p className="text-[12px] font-medium text-text-primary">{diff.label}</p>
          {diff.note ? <p className="mt-1 text-[11px] text-text-muted">{diff.note}</p> : null}
        </div>
        <div className="bg-surface/35 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Before</p>
          <p className="mt-1 break-words text-[12px] leading-5 text-text-secondary">
            {diff.beforeText ?? 'None'}
          </p>
        </div>
        <div className="bg-surface/35 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">After</p>
          <p className="mt-1 break-words text-[12px] leading-5 text-text-secondary">
            {diff.afterText ?? 'None'}
          </p>
        </div>
      </div>
    </section>
  );
}

function RawEventPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="bg-surface/35 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{title}</p>
      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-text-secondary">
        {formatValue(value)}
      </pre>
    </div>
  );
}

function RawEventCard({
  event,
}: {
  event: ChangeActivityDetail['rawEvents'][number];
}) {
  const hasContext = Object.keys(event.context).length > 0;

  return (
    <section className="overflow-hidden border border-border-subtle bg-surface/20">
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={event.source === 'pics' ? 'purple' : event.source === 'media' ? 'orange' : 'info'}
              size="sm"
            >
              {formatSourceLabel(event.source)}
            </Badge>
            <span className="text-[12px] font-medium text-text-primary">
              {formatChangeLabel(event.changeType)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-text-secondary">
            {summarizeValue(event.beforeValue, 42)}
            <span className="px-1 text-text-muted">→</span>
            {summarizeValue(event.afterValue, 42)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[11px] text-text-muted">{formatAbsoluteTime(event.occurredAt)}</p>
        </div>
      </div>
      <div className="grid gap-px border-t border-border-subtle bg-border-subtle lg:grid-cols-2">
        <RawEventPanel title="Before" value={event.beforeValue} />
        <RawEventPanel title="After" value={event.afterValue} />
      </div>
      {hasContext && (
        <div className="border-t border-border-subtle px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Context</p>
          <div className="mt-2 grid gap-px bg-border-subtle md:grid-cols-2">
            {Object.entries(event.context).map(([key, value]) => (
              <RawEventPanel key={key} title={formatTokenLabel(key)} value={value} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AnnouncementRawRecord({
  detail,
}: {
  detail: ChangeActivityDetail;
}) {
  const announcement = detail.relatedAnnouncements[0] ?? null;
  const bodyText = detail.body ?? 'No body available';

  return (
    <section className="overflow-hidden border border-border-subtle bg-surface/20">
      <div className="divide-y divide-border-subtle">
        {[
          ['Title', announcement?.title ?? detail.headline],
          ['Feed label', announcement?.feedLabel ?? 'None'],
          ['Feed name', announcement?.feedName ?? 'None'],
          ['Published at', announcement?.publishedAt ?? announcement?.firstSeenAt ?? 'None'],
          ['URL', announcement?.url ?? detail.externalUrl ?? 'None'],
        ].map(([label, value]) => (
          <div key={label} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 px-3 py-2 text-[11px]">
            <p className="uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
            <p className="break-words leading-5 text-text-secondary">{String(value)}</p>
          </div>
        ))}

        <div className="px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Body</p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-text-secondary">
            {formatValue(bodyText)}
          </pre>
        </div>
      </div>
    </section>
  );
}

function ReadableInspector({
  detail,
}: {
  detail: ChangeActivityDetail;
}) {
  const showAftermathSection =
    detail.aftermath &&
    (hasImpactWindow(detail.aftermath.baseline7d) ||
      hasImpactWindow(detail.aftermath.response1d) ||
      hasImpactWindow(detail.aftermath.response7d));
  const visibleAftermathCount = detail.aftermath
    ? [
        detail.aftermath.baseline7d,
        detail.aftermath.response1d,
        detail.aftermath.response7d,
      ].filter((window) => hasImpactWindow(window)).length
    : 0;
  const companionAnnouncements =
    detail.activityKind === 'change' ? detail.relatedAnnouncements : [];
  const announcementBody = stripHtml(detail.body);

  return (
    <div className="space-y-3">
      {detail.activityKind === 'announcement' && announcementBody && (
        <section className="overflow-hidden border border-border-subtle bg-surface/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Body</p>
          <p className="mt-2 text-[12px] leading-6 text-text-secondary">{announcementBody}</p>
        </section>
      )}

      {detail.diffs.length > 0 && (
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              Key changes
            </h4>
            <span className="font-mono text-[11px] text-text-muted">{detail.diffs.length}</span>
          </div>
          <div className="space-y-1.5">
            {detail.diffs.map((diff) => (
              <DiffPreviewBlock key={diff.id} diff={diff} />
            ))}
          </div>
        </section>
      )}

      {companionAnnouncements.length > 0 && (
        <section className="overflow-hidden border border-border-subtle bg-surface/20">
          <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
            <p className="truncate text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
              Related announcements
            </p>
            <span className="font-mono text-[11px] text-text-muted">
              {companionAnnouncements.length}
            </span>
          </div>
          <div className="px-3 py-2">
          <div className="divide-y divide-border-subtle">
            {companionAnnouncements.map((announcement) => (
              <article key={announcement.gid} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium leading-5 text-text-primary">
                      {announcement.title ?? 'Untitled announcement'}
                    </p>
                    {announcement.excerpt && (
                      <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                        {truncateText(announcement.excerpt, 180)}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {announcement.feedLabel && (
                        <Badge variant="purple" size="sm">
                          {announcement.feedLabel}
                        </Badge>
                      )}
                      {announcement.feedName && (
                        <Badge variant="default" size="sm">
                          {announcement.feedName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-text-muted">
                    <p>{formatRelativeTime(announcement.publishedAt ?? announcement.firstSeenAt)}</p>
                    {announcement.url && (
                      <a
                        href={announcement.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-accent-primary transition-colors hover:text-accent-primary/80"
                      >
                        Open
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          </div>
        </section>
      )}

      {showAftermathSection && detail.aftermath && (
        <section className="overflow-hidden border border-border-subtle bg-surface/20">
          <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
            <p className="truncate text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
              Aftermath
            </p>
            <span className="font-mono text-[11px] text-text-muted">{visibleAftermathCount}</span>
          </div>
          <div className="grid gap-2 px-3 py-2">
            <ImpactWindowCard title="Baseline 7d" window={detail.aftermath.baseline7d} />
            <ImpactWindowCard title="Response 1d" window={detail.aftermath.response1d} />
            <ImpactWindowCard title="Response 7d" window={detail.aftermath.response7d} />
          </div>
        </section>
      )}
    </div>
  );
}

function RawInspector({
  detail,
}: {
  detail: ChangeActivityDetail;
}) {
  if (detail.activityKind === 'announcement') {
    return <AnnouncementRawRecord detail={detail} />;
  }

  if (detail.rawEvents.length === 0) {
    return (
      <div className="border border-border-subtle bg-surface/20 px-3 py-2">
        <p className="text-[12px] leading-5 text-text-secondary">
          No raw events were returned for this activity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {detail.rawEvents.map((event) => (
        <RawEventCard key={event.eventId} event={event} />
      ))}
    </div>
  );
}

function TimelineRow({
  row,
  isSelected,
  onInspect,
}: {
  row: ChangeActivityRow;
  isSelected: boolean;
  onInspect: () => void;
}) {
  const secondaryText = buildRowSecondaryText(row);

  return (
    <article
      className={`
        border-l-2 px-3 py-2.5 transition-colors duration-150
        ${isSelected ? 'border-accent-primary bg-accent-primary/10' : 'border-transparent hover:bg-surface-elevated/40'}
      `}
    >
      <div className="grid gap-2 md:grid-cols-[72px_minmax(0,1.45fr)_minmax(0,1fr)_132px] md:items-start">
        <div className="flex items-start justify-between gap-2 md:block">
          <div className="space-y-1">
            <Link
              href={`/apps/${row.appid}`}
              className="block font-mono text-[11px] leading-4 text-accent-blue transition-colors hover:text-accent-blue/80"
            >
              {row.appid}
            </Link>
            <p className="text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {formatAppTypeLabel(row.appType)}
            </p>
            {row.isReleased === false && (
              <Badge variant="warning" size="sm">
                Upcoming
              </Badge>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={row.activityKind === 'announcement' ? 'purple' : 'info'} size="sm">
              {row.activityKind === 'announcement' ? 'Announcement' : 'Change'}
            </Badge>
            <Badge variant="default" size="sm">
              {getStoryLabel(row.storyKind)}
            </Badge>
            {row.signalFamilies.slice(0, 3).map((family) => (
              <Badge key={`${row.activityId}-${family}`} variant={getSignalBadgeVariant(family)} size="sm">
                {SIGNAL_LABELS[family]}
              </Badge>
            ))}
          </div>

          <div className="mt-1.5 min-w-0 text-[13px] leading-5">
            <Link
              href={`/apps/${row.appid}`}
              className="font-medium text-text-primary transition-colors hover:text-accent-primary"
            >
              {row.appName}
            </Link>
            <span className="px-1 text-text-muted">•</span>
            <span className="text-text-secondary">{row.headline}</span>
          </div>

          {secondaryText ? (
            <p className="mt-1 truncate text-[12px] leading-5 text-text-secondary">{secondaryText}</p>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {row.highlightLabels.slice(0, 4).map((label) => (
              <span
                key={`${row.activityId}-${label}`}
                className="inline-flex items-center border border-border-subtle bg-surface/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-text-secondary"
              >
                {label}
              </span>
            ))}
            {row.highlightLabels.length === 0 &&
              row.facts.slice(0, 2).map((fact) => (
                <span
                  key={`${row.activityId}-${fact}`}
                  className="inline-flex items-center border border-border-subtle bg-surface/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-text-secondary"
                >
                  {fact}
                </span>
              ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:flex-col md:items-end md:text-right">
          <div className="text-[11px] text-text-muted">
            <p className="font-medium text-text-secondary">{formatRelativeTime(row.occurredAt)}</p>
            <p className="mt-1 font-mono">{formatAbsoluteTime(row.occurredAt)}</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em]">
            <button
              type="button"
              onClick={onInspect}
              className={`
                transition-colors
                ${isSelected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}
              `}
            >
              {isSelected ? 'Open' : 'Inspect'}
            </button>
            {row.externalUrl && (
              <a
                href={row.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-primary transition-colors hover:text-accent-primary/80"
              >
                Steam
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Timeline({
  items,
  selectedActivityId,
  loading,
  error,
  cursor,
  loadingMore,
  onSelectActivity,
  onLoadMore,
}: {
  items: ChangeActivityRow[];
  selectedActivityId: string | null;
  loading: boolean;
  error: string | null;
  cursor: string | null;
  loadingMore: boolean;
  onSelectActivity: (activityId: string) => void;
  onLoadMore: () => void;
}) {
  const groups = useMemo(() => groupByDate(items), [items]);

  if (loading && items.length === 0) {
    return (
      <div className="overflow-hidden border border-border-subtle bg-surface/25">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="border-b border-border-subtle px-3 py-3 last:border-b-0">
            <div className="h-12 animate-pulse bg-surface-elevated" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-accent-red/30 bg-accent-red/10 px-3 py-2">
        <p className="text-body-sm text-accent-red">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity matched these filters"
        description="Widen the time range, relax the current signal filters, or clear the exact title picker."
        icon={<Sparkles className="h-5 w-5" />}
      />
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <section key={group.key} className="overflow-hidden border border-border-subtle bg-surface/20">
          <div className="border-y border-border-subtle bg-surface/95 px-3 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
                {group.label}
              </p>
              <span className="font-mono text-[11px] text-text-muted">{group.items.length}</span>
            </div>
          </div>

          <div className="divide-y divide-border-subtle">
            {group.items.map((row) => (
              <TimelineRow
                key={row.activityId}
                row={row}
                isSelected={selectedActivityId === row.activityId}
                onInspect={() => onSelectActivity(row.activityId)}
              />
            ))}
          </div>
        </section>
      ))}

      {cursor && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" onClick={onLoadMore} isLoading={loadingMore}>
            Load more activity
          </Button>
        </div>
      )}
    </div>
  );
}

function InspectorPanel({
  hasSelectedActivity,
  selectedRow,
  selectedDetail,
  selectedDetailLoading,
  selectedDetailError,
  inspectorMode,
  onInspectorModeChange,
}: {
  hasSelectedActivity: boolean;
  selectedRow: ChangeActivityRow | null;
  selectedDetail: ChangeActivityDetail | null;
  selectedDetailLoading: boolean;
  selectedDetailError: string | null;
  inspectorMode: InspectorMode;
  onInspectorModeChange: (mode: InspectorMode) => void;
}) {
  const detail = selectedDetail ?? null;
  const row = selectedRow ?? detail;
  const activeInspector =
    detail && inspectorMode === 'readable' ? (
      <ReadableInspector key={`readable-${detail.activityId}`} detail={detail} />
    ) : detail ? (
      <RawInspector key={`raw-${detail.activityId}`} detail={detail} />
    ) : null;
  const summaryTokens = detail
    ? Array.from(new Set([...detail.highlightLabels, ...detail.facts].filter(Boolean))).slice(0, 6)
    : [];
  const inspectorEmptyTitle = hasSelectedActivity ? 'Detail unavailable' : 'Pick a row to inspect';
  const inspectorEmptyBody = hasSelectedActivity
    ? 'This activity did not return a readable or raw payload.'
    : 'Readable and raw evidence appear here once an activity is selected.';

  return (
    <div className="sticky top-24 overflow-hidden border border-border-subtle bg-surface/95">
      <div className="space-y-2 border-b border-border-subtle px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Inspector</p>
            <h2 className="truncate text-[15px] font-medium text-text-primary">
              {detail?.appName ?? row?.appName ?? 'Select an activity'}
            </h2>
            {row && (
              <p className="mt-1 text-[11px] text-text-secondary">
                {formatAbsoluteTime(row.occurredAt)} • {formatRelativeTime(row.occurredAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 border border-border-subtle bg-surface/35 p-0.5">
            <button
              type="button"
              onClick={() => onInspectorModeChange('raw')}
              className={
                inspectorMode === 'raw'
                  ? 'bg-surface-elevated px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-text-primary'
                  : 'px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-text-tertiary transition-colors hover:text-text-secondary'
              }
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => onInspectorModeChange('readable')}
              className={
                inspectorMode === 'readable'
                  ? 'bg-surface-elevated px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-text-primary'
                  : 'px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-text-tertiary transition-colors hover:text-text-secondary'
              }
            >
              Readable
            </button>
          </div>
        </div>

        {detail && (
          <div className="space-y-2 border-t border-border-subtle pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={detail.activityKind === 'announcement' ? 'purple' : 'info'} size="sm">
                {detail.activityKind === 'announcement' ? 'Announcement' : 'Change'}
              </Badge>
              <Badge variant="default" size="sm">{getStoryLabel(detail.storyKind)}</Badge>
              <Badge variant="default" size="sm">{formatAppTypeLabel(detail.appType)}</Badge>
              {detail.isReleased === false && <Badge variant="warning" size="sm">Upcoming</Badge>}
            </div>
            <p className="text-[13px] leading-6 text-text-secondary">{detail.summary}</p>
            {summaryTokens.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summaryTokens.map((token) => (
                  <span
                    key={`${detail.activityId}-${token}`}
                    className="inline-flex items-center border border-border-subtle bg-surface/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-text-secondary"
                  >
                    {token}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 px-3 py-3">
        {hasSelectedActivity && (row || detail) && selectedDetailLoading && (
          <div className="flex items-center gap-2 border border-border-subtle bg-surface/20 px-3 py-2 text-[12px] text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading activity detail...
          </div>
        )}

        {!selectedDetailLoading && selectedDetailError && (
          <div className="border border-accent-red/30 bg-accent-red/10 px-3 py-2">
            <p className="text-body-sm text-accent-red">{selectedDetailError}</p>
          </div>
        )}

        {!selectedDetailLoading && !selectedDetailError && detail && (
          <>
            {activeInspector}

            <div className="flex items-center gap-3 border-t border-border-subtle pt-2 text-[11px] uppercase tracking-[0.08em]">
              <Link
                href={`/apps/${detail.appid}`}
                className="inline-flex items-center gap-1 text-accent-primary transition-colors hover:text-accent-primary/80"
              >
                App
                <ArrowRight className="h-3 w-3" />
              </Link>
              {detail.externalUrl && (
                <a
                  href={detail.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-primary transition-colors hover:text-accent-primary/80"
                >
                  Steam
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </>
        )}

        {!selectedDetailLoading && !selectedDetailError && !detail && (
          <div className="border border-dashed border-border-subtle bg-surface/20 px-4 py-10 text-center">
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-surface-elevated text-text-muted">
              <BellRing className="h-4 w-4" />
            </div>
            <p className="mt-3 text-body-sm font-medium text-text-primary">{inspectorEmptyTitle}</p>
            <p className="mt-1 text-body-sm text-text-secondary">{inspectorEmptyBody}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChangeFeedWorkspace({
  authReady,
  status,
  statusError,
  loading,
  loadingMore,
  error,
  items,
  cursor,
  selectedActivityId,
  selectedRow,
  selectedDetail,
  selectedDetailLoading,
  selectedDetailError,
  inspectorMode,
  searchInput,
  selectedApps,
  view,
  mode,
  range,
  sort,
  appType,
  signalFamilies,
  showAdvancedFilters,
  onUpdateFilters,
  onSearchInputChange,
  onClearFilters,
  onToggleAdvancedFilters,
  onSelectActivity,
  onInspectorModeChange,
  onLoadMore,
}: ChangeFeedWorkspaceProps) {
  const [compactInspectorDismissed, setCompactInspectorDismissed] = useState(false);

  useEffect(() => {
    setCompactInspectorDismissed(false);
  }, [selectedActivityId]);

  const availableGames = useMemo(
    () =>
      Array.from(
        items.reduce((map, row) => {
          if (!map.has(row.appid)) {
            map.set(row.appid, {
              appid: row.appid,
              name: row.appName,
            });
          }
          return map;
        }, new Map<number, SelectedGame>())
      ).map(([, game]) => game),
    [items]
  );
  const groupedCount = useMemo(() => groupByDate(items).length, [items]);
  const activeSignalSet = useMemo(() => new Set(signalFamilies), [signalFamilies]);
  const selectedAppSummary = selectedApps.map((game) => game.name).join(', ');
  const selectedDetailVisible = Boolean(selectedActivityId);
  const visibleChangeCount = items.filter((item) => item.activityKind === 'change').length;
  const visibleAnnouncementCount = items.filter((item) => item.activityKind === 'announcement').length;
  const isDemoFilterActive = appType === 'demo';

  return (
    <div className="space-y-4">
      <div className="sticky top-4 z-30 space-y-2 border border-border-subtle bg-surface/95 px-3 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2">
            <h1 className="text-[15px] font-semibold text-text-primary">Changes</h1>
            <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
              Dense market history with raw evidence intact
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {status && <Badge variant={getStatusBadgeVariant(status.state)} size="sm">{getStatusLabel(status.state)}</Badge>}
            {statusError && <Badge variant="warning" size="sm">Status unavailable</Badge>}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <span>{items.length} rows</span>
            <span>{groupedCount} days</span>
            <span>{visibleChangeCount} changes</span>
            <span>{visibleAnnouncementCount} announcements</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {CHANGE_ACTIVITY_VIEWS.map((option) => (
            <FilterChip
              key={option}
              label={VIEW_LABELS[option]}
              active={view === option}
              onClick={() => onUpdateFilters({ view: option, activity: null })}
            />
          ))}
          <div className="mx-1 hidden h-5 w-px bg-border-subtle lg:block" />
          {CHANGE_ACTIVITY_MODES.map((option) => (
            <FilterChip
              key={option}
              label={MODE_LABELS[option]}
              active={mode === option}
              onClick={() => onUpdateFilters({ mode: option, activity: null })}
            />
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(['24h', '7d', '30d'] as const).map((option) => (
              <FilterChip
                key={option}
                label={RANGE_LABELS[option]}
                active={range === option}
                onClick={() => onUpdateFilters({ range: option, activity: null })}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)_180px]">
          <SearchInput
            id="change-feed-search"
            name="changeFeedSearch"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onClear={() => onSearchInputChange('')}
            placeholder="Search apps, headlines, or change themes"
            className="h-8 rounded-none bg-surface/65 text-[13px]"
          />

          <ChangeFeedGamePicker
            selectedGames={selectedApps}
            availableGames={availableGames}
            onChange={(games) => {
              const selection = stringifySelectedApps(games);
              onUpdateFilters({
                appIds: selection.appIds,
                appNames: selection.appNames,
                activity: null,
              });
            }}
          />

          <label className="flex items-center gap-2 border border-border-subtle bg-surface/65 px-2.5 text-[11px] uppercase tracking-[0.08em] text-text-secondary">
            <span>Sort</span>
            <select
              id="change-feed-sort"
              name="changeFeedSort"
              value={sort}
              onChange={(event) => onUpdateFilters({ sort: event.target.value, activity: null })}
              className="h-8 min-w-0 flex-1 bg-transparent text-[12px] text-text-primary focus:outline-none"
            >
              {CHANGE_ACTIVITY_SORTS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
          <FilterChip
            label="Demos"
            active={isDemoFilterActive}
            onClick={() =>
              onUpdateFilters({
                appTypes: isDemoFilterActive ? null : 'demo',
                activity: null,
              })
            }
          />

          {CHANGE_ACTIVITY_SIGNAL_FAMILIES.map((family) => (
            <FilterChip
              key={family}
              label={SIGNAL_LABELS[family]}
              active={activeSignalSet.has(family)}
              onClick={() => {
                const nextSet = new Set(signalFamilies);
                if (nextSet.has(family)) {
                  nextSet.delete(family);
                } else {
                  nextSet.add(family);
                }

                onUpdateFilters({
                  signals: Array.from(nextSet).join(',') || null,
                  activity: null,
                });
              }}
            />
          ))}

          <div className="ml-auto flex items-center gap-2 text-[11px] uppercase tracking-[0.08em]">
            <Button variant="secondary" size="sm" onClick={onToggleAdvancedFilters}>
              <Filter className="h-3.5 w-3.5" />
              {showAdvancedFilters ? 'Hide filters' : 'Advanced filters'}
            </Button>
            <button
              type="button"
              onClick={onClearFilters}
              className="text-text-secondary transition-colors hover:text-text-primary"
            >
              Clear
            </button>
          </div>
        </div>

        {(showAdvancedFilters ||
          selectedApps.length > 0 ||
          signalFamilies.length > 0 ||
          (appType !== 'all' && !isDemoFilterActive)) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 text-[11px]">
            {showAdvancedFilters && (
              <label className="flex items-center gap-2 border border-border-subtle bg-surface/65 px-2.5 text-[11px] uppercase tracking-[0.08em] text-text-secondary">
                <span>Type</span>
                <select
                  value={appType}
                  onChange={(event) => onUpdateFilters({ appTypes: event.target.value, activity: null })}
                  className="h-8 min-w-0 bg-transparent text-[12px] text-text-primary focus:outline-none"
                >
                  {APP_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedApps.length > 0 && (
              <span className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary">
                Exact: {selectedAppSummary}
              </span>
            )}
            {signalFamilies.map((family) => (
              <span
                key={family}
                className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary"
              >
                {SIGNAL_LABELS[family]}
              </span>
            ))}
            {appType !== 'all' && !isDemoFilterActive && (
              <span className="border border-border-subtle bg-surface/65 px-2 py-1 text-text-secondary">
                Type: {APP_TYPE_OPTIONS.find((option) => option.id === appType)?.label ?? appType}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-3">
          {!authReady ? (
            <div className="flex items-center justify-center gap-2 border border-border-subtle bg-surface/35 py-10 text-body-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Establishing authenticated session...
            </div>
          ) : loading ? (
            <div className="overflow-hidden border border-border-subtle bg-surface/25">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="border-b border-border-subtle px-3 py-3 last:border-b-0">
                  <div className="h-12 animate-pulse bg-surface-elevated" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="border border-accent-red/30 bg-accent-red/10 px-3 py-2">
              <p className="text-body-sm text-accent-red">{error}</p>
            </div>
          ) : (
            <Timeline
              items={items}
              selectedActivityId={selectedActivityId}
              loading={loading}
              error={error}
              cursor={cursor}
              loadingMore={loadingMore}
              onSelectActivity={onSelectActivity}
              onLoadMore={onLoadMore}
            />
          )}
        </main>

        <aside className="hidden xl:block">
          <InspectorPanel
            hasSelectedActivity={selectedDetailVisible}
            selectedRow={selectedRow}
            selectedDetail={selectedDetail}
            selectedDetailLoading={selectedDetailLoading}
            selectedDetailError={selectedDetailError}
            inspectorMode={inspectorMode}
            onInspectorModeChange={onInspectorModeChange}
          />
        </aside>
      </div>

      {selectedDetailVisible && !compactInspectorDismissed && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-raised shadow-lg xl:hidden">
          <div className="max-h-[84vh] overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Inspector</p>
                <p className="truncate text-body font-medium text-text-primary">
                  {selectedDetail?.appName ?? selectedRow?.appName ?? 'Selected activity'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompactInspectorDismissed(true)}
                className="rounded-full p-2 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                aria-label="Close inspector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <InspectorPanel
              hasSelectedActivity={selectedDetailVisible}
              selectedRow={selectedRow}
              selectedDetail={selectedDetail}
              selectedDetailLoading={selectedDetailLoading}
              selectedDetailError={selectedDetailError}
              inspectorMode={inspectorMode}
              onInspectorModeChange={onInspectorModeChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
