'use client';

import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BellRing,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, Input } from '@/components/ui';
import { useAuthReady } from '@/hooks/useAuthReady';
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
  ChangeFeedActivityDetailResponse,
  ChangeFeedActivityResponse,
  ChangeFeedStatus,
} from './lib';
import {
  CHANGE_ACTIVITY_MODES,
  CHANGE_ACTIVITY_SIGNAL_FAMILIES,
  CHANGE_ACTIVITY_SORTS,
  CHANGE_ACTIVITY_VIEWS,
  CHANGE_FEED_APP_TYPES,
  parseChangeActivityMode,
  parseChangeActivitySort,
  parseChangeActivityView,
} from './lib';

type FeedRange = '24h' | '7d' | '30d';
type AppTypeFilter = 'all' | AppType;

interface ChangeFeedPageClientProps {
  initialMode?: string;
  initialView?: string;
  initialRange?: string;
  initialAppTypes?: string;
  initialSignals?: string;
  initialSort?: string;
  initialSearch?: string;
  initialActivityResponse?: ChangeFeedActivityResponse;
}

const RANGE_OPTIONS: Array<{ id: FeedRange; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

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

function parseRange(value: string | null | undefined): FeedRange {
  return RANGE_OPTIONS.some((option) => option.id === value) ? (value as FeedRange) : '7d';
}

function parseAppType(value: string | null | undefined): AppTypeFilter {
  if (!value) {
    return 'all';
  }

  return CHANGE_FEED_APP_TYPES.includes(value as AppType) ? (value as AppType) : 'all';
}

function parseSignalFamilies(value: string | null | undefined): ChangeActivitySignalFamily[] {
  if (!value) {
    return [];
  }

  const allowed = new Set<ChangeActivitySignalFamily>(CHANGE_ACTIVITY_SIGNAL_FAMILIES);
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is ChangeActivitySignalFamily =>
      allowed.has(entry as ChangeActivitySignalFamily)
    );
}

function rangeToDays(range: FeedRange): number {
  switch (range) {
    case '24h':
      return 1;
    case '30d':
      return 30;
    default:
      return 7;
  }
}

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) {
    return 'Unknown';
  }

  const diffMs = Date.now() - new Date(timestamp).getTime();
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
  if (!timestamp) {
    return 'Unknown';
  }

  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

function buildUrl(
  pathname: string,
  searchParams: URLSearchParams,
  updates: Record<string, string | null>
): string {
  const params = new URLSearchParams(searchParams.toString());

  Object.entries(updates).forEach(([key, value]) => {
    const shouldDelete =
      !value ||
      value === 'all' ||
      value.length === 0 ||
      (key === 'view' && value === 'overview') ||
      (key === 'mode' && value === 'all') ||
      (key === 'range' && value === '7d') ||
      (key === 'sort' && value === 'relevant');

    if (shouldDelete) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildActivityParams(args: {
  range: FeedRange;
  view: ChangeActivityView;
  mode: ChangeActivityMode;
  sort: ChangeActivitySort;
  appType: AppTypeFilter;
  signalFamilies: ChangeActivitySignalFamily[];
  search: string;
  cursor?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('days', String(rangeToDays(args.range)));
  params.set('view', args.view);
  params.set('mode', args.mode);
  params.set('sort', args.sort);
  params.set('limit', '50');

  if (args.appType !== 'all') {
    params.set('appTypes', args.appType);
  }
  if (args.signalFamilies.length > 0) {
    params.set('signals', args.signalFamilies.join(','));
  }
  if (args.search) {
    params.set('search', args.search);
  }
  if (args.cursor) {
    params.set('cursor', args.cursor);
  }

  return params;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
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
    <Card className="py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated text-text-muted">
        {icon}
      </div>
      <h3 className="mt-3 text-subheading text-text-primary">{title}</h3>
      <p className="mt-1 text-body-sm text-text-secondary">{description}</p>
    </Card>
  );
}

function ImpactWindowCard({
  title,
  window,
}: {
  title: string;
  window: ChangeBurstImpactWindow | null;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-3">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{title}</p>
      <div className="mt-3 grid gap-1 text-body-sm text-text-secondary">
        <p>
          Peak CCU <span className="text-text-primary">{formatMetric(window?.ccuPeak ?? null)}</span>
        </p>
        <p>
          Reviews <span className="text-text-primary">{formatMetric(window?.totalReviews ?? null)}</span>
        </p>
        <p>
          Review score{' '}
          <span className="text-text-primary">
            {formatMetric(window?.reviewScore ?? null, 'percent')}
          </span>
        </p>
        <p>
          Price <span className="text-text-primary">{formatMetric(window?.priceCents ?? null, 'price')}</span>
        </p>
        <p>
          Discount{' '}
          <span className="text-text-primary">
            {formatMetric(window?.discountPercent ?? null, 'percent')}
          </span>
        </p>
      </div>
    </div>
  );
}

function DiffPreviewBlock({ diff }: { diff: ChangeDiffPreview }) {
  const imageGallery = [...diff.added, ...diff.removed].filter(isImageUrl);

  if (diff.kind === 'media') {
    return (
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-body-sm font-medium text-text-primary">{diff.label}</p>
          {diff.note && <span className="text-caption text-text-muted">{diff.note}</span>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Before</p>
            {diff.beforeImageUrl && isImageUrl(diff.beforeImageUrl) ? (
              <img
                src={diff.beforeImageUrl}
                alt={`${diff.label} before`}
                className="mt-2 h-32 w-full rounded-lg border border-border-subtle object-cover"
              />
            ) : (
              <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-body-sm text-text-secondary">
                {diff.beforeImageUrl ?? 'No prior image'}
              </div>
            )}
          </div>
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">After</p>
            {diff.afterImageUrl && isImageUrl(diff.afterImageUrl) ? (
              <img
                src={diff.afterImageUrl}
                alt={`${diff.label} after`}
                className="mt-2 h-32 w-full rounded-lg border border-border-subtle object-cover"
              />
            ) : (
              <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-body-sm text-text-secondary">
                {diff.afterImageUrl ?? 'No new image'}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (diff.kind === 'text') {
    return (
      <Card padding="md" className="space-y-3">
        <p className="text-body-sm font-medium text-text-primary">{diff.label}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Before</p>
            <div className="mt-2 rounded-lg bg-surface px-3 py-3 text-body-sm text-text-secondary">
              {diff.beforeText ?? 'No prior copy'}
            </div>
          </div>
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">After</p>
            <div className="mt-2 rounded-lg bg-surface px-3 py-3 text-body-sm text-text-secondary">
              {diff.afterText ?? 'No new copy'}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (diff.kind === 'list') {
    return (
      <Card padding="md" className="space-y-3">
        <p className="text-body-sm font-medium text-text-primary">{diff.label}</p>
        {imageGallery.length > 0 ? (
          <div className="space-y-3">
            <p className="text-body-sm text-text-secondary">
              {diff.added.length > 0 && `${diff.added.length} added`}
              {diff.added.length > 0 && diff.removed.length > 0 ? ' • ' : ''}
              {diff.removed.length > 0 && `${diff.removed.length} removed`}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {imageGallery.slice(0, 3).map((url) => (
                <img
                  key={url}
                  src={url}
                  alt={diff.label}
                  className="h-28 w-full rounded-lg border border-border-subtle object-cover"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Added</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {diff.added.length === 0 ? (
                  <span className="text-body-sm text-text-muted">None</span>
                ) : (
                  diff.added.map((item) => (
                    <Badge key={`${diff.id}-${item}`} variant="success" size="sm">
                      {item}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Removed</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {diff.removed.length === 0 ? (
                  <span className="text-body-sm text-text-muted">None</span>
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
      </Card>
    );
  }

  if (diff.kind === 'note') {
    return (
      <Card padding="md">
        <p className="text-body-sm font-medium text-text-primary">{diff.label}</p>
        <p className="mt-2 text-body-sm text-text-secondary">{diff.note}</p>
      </Card>
    );
  }

  return (
    <Card padding="md" className="space-y-3">
      <p className="text-body-sm font-medium text-text-primary">{diff.label}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Before</p>
          <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-body-sm text-text-secondary">
            {diff.beforeText ?? 'None'}
          </div>
        </div>
        <div>
          <p className="text-caption uppercase tracking-wide text-text-tertiary">After</p>
          <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-body-sm text-text-secondary">
            {diff.afterText ?? 'None'}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ActivityCard({
  row,
  detail,
  expanded,
  loading,
  error,
  onToggle,
}: {
  row: ChangeActivityRow;
  detail: ChangeActivityDetail | null;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  onToggle: () => void;
}) {
  const showAftermath =
    detail?.aftermath &&
    (hasImpactWindow(detail.aftermath.baseline7d) ||
      hasImpactWindow(detail.aftermath.response1d) ||
      hasImpactWindow(detail.aftermath.response7d));

  return (
    <Card
      padding="md"
      className={`space-y-4 transition-colors ${expanded ? 'border-border-muted bg-surface-elevated' : ''}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/apps/${row.appid}`}
              className="truncate text-body font-medium text-text-primary transition-colors hover:text-accent-blue"
            >
              {row.appName}
            </Link>
            <Badge variant="default" size="sm">
              {formatAppTypeLabel(row.appType)}
            </Badge>
            {row.activityKind === 'announcement' ? (
              <Badge variant="purple" size="sm">
                Announcement
              </Badge>
            ) : (
              <Badge variant="info" size="sm">
                {VIEW_LABELS[
                  row.storyKind === 'commercial-move'
                    ? 'commercial-moves'
                    : row.storyKind === 'release-prep'
                      ? 'launch-watch'
                      : row.storyKind === 'store-refresh' || row.storyKind === 'positioning-shift'
                        ? 'store-refreshes'
                        : 'overview'
                ]}
              </Badge>
            )}
            {row.isReleased === false && (
              <Badge variant="warning" size="sm">
                Upcoming
              </Badge>
            )}
          </div>

          <h3 className="mt-3 text-heading-sm text-text-primary">{row.headline}</h3>
          <p className="mt-2 text-body-sm text-text-secondary">{row.summary}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {row.signalFamilies.map((family) => (
              <Badge key={`${row.activityId}-${family}`} variant={getSignalBadgeVariant(family)} size="sm">
                {SIGNAL_LABELS[family]}
              </Badge>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {row.highlightLabels.map((label) => (
              <span
                key={`${row.activityId}-${label}`}
                className="rounded-full bg-surface px-2.5 py-1 text-caption text-text-secondary"
              >
                {label}
              </span>
            ))}
          </div>

          {row.facts.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {row.facts.map((fact) => (
                <div
                  key={`${row.activityId}-${fact}`}
                  className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-body-sm text-text-secondary"
                >
                  {fact}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="text-left text-caption text-text-muted lg:text-right">
            <p>{formatRelativeTime(row.occurredAt)}</p>
            <p className="mt-1">{formatAbsoluteTime(row.occurredAt)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? (
              <>
                Collapse
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Expand
                <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border-subtle pt-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          )}

          {!loading && error && (
            <Card className="border-accent-red/30 bg-accent-red/10">
              <p className="text-body-sm text-accent-red">{error}</p>
            </Card>
          )}

          {!loading && !error && detail && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/apps/${detail.appid}`}
                  className="inline-flex items-center gap-1 text-body-sm text-accent-blue transition-colors hover:text-accent-blue/80"
                >
                  Open app page
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                {detail.externalUrl && (
                  <a
                    href={detail.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-body-sm text-accent-blue transition-colors hover:text-accent-blue/80"
                  >
                    Open on Steam
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {detail.body && detail.activityKind === 'announcement' && (
                <Card padding="md">
                  <p className="text-caption uppercase tracking-wide text-text-tertiary">
                    Announcement summary
                  </p>
                  <p className="mt-3 text-body-sm leading-6 text-text-secondary">
                    {stripHtml(detail.body)}
                  </p>
                </Card>
              )}

              {detail.diffs.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-subheading text-text-primary">Before / after</h4>
                    <Badge variant="default" size="sm">
                      {detail.diffs.length}
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {detail.diffs.map((diff) => (
                      <DiffPreviewBlock key={diff.id} diff={diff} />
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-subheading text-text-primary">Related announcements</h4>
                  <Badge variant="default" size="sm">
                    {detail.relatedAnnouncements.length}
                  </Badge>
                </div>
                {detail.relatedAnnouncements.length === 0 ? (
                  <Card padding="md">
                    <p className="text-body-sm text-text-secondary">
                      No nearby Steam announcement was attached to this activity.
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {detail.relatedAnnouncements.map((announcement) => (
                      <Card key={announcement.gid} padding="md">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-medium text-text-primary">
                              {announcement.title ?? 'Untitled announcement'}
                            </p>
                            {announcement.excerpt && (
                              <p className="mt-2 text-body-sm text-text-secondary">
                                {announcement.excerpt}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                          <div className="text-caption text-text-muted lg:text-right">
                            <p>{formatRelativeTime(announcement.publishedAt ?? announcement.firstSeenAt)}</p>
                            <p className="mt-1">
                              {formatAbsoluteTime(announcement.publishedAt ?? announcement.firstSeenAt)}
                            </p>
                            {announcement.url && (
                              <a
                                href={announcement.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-1 text-accent-blue transition-colors hover:text-accent-blue/80"
                              >
                                Open
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              {showAftermath && detail.aftermath && (
                <section className="space-y-3">
                  <div>
                    <h4 className="text-subheading text-text-primary">Aftermath</h4>
                    <p className="mt-1 text-body-sm text-text-secondary">
                      Baseline and response windows around this activity.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <ImpactWindowCard title="Baseline 7d" window={detail.aftermath.baseline7d} />
                    <ImpactWindowCard title="Response 1d" window={detail.aftermath.response1d} />
                    <ImpactWindowCard title="Response 7d" window={detail.aftermath.response7d} />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function ChangeFeedPageClient({
  initialMode,
  initialView,
  initialRange,
  initialAppTypes,
  initialSignals,
  initialSort,
  initialSearch,
  initialActivityResponse,
}: ChangeFeedPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authReady = useAuthReady();
  const [, startTransition] = useTransition();
  const pathname = '/changes';

  const view = parseChangeActivityView(searchParams.get('view') ?? initialView);
  const mode = parseChangeActivityMode(searchParams.get('mode') ?? initialMode);
  const range = parseRange(searchParams.get('range') ?? initialRange);
  const appType = parseAppType(searchParams.get('appTypes') ?? initialAppTypes);
  const signalFamilies = parseSignalFamilies(searchParams.get('signals') ?? initialSignals);
  const rawSort = parseChangeActivitySort(searchParams.get('sort') ?? initialSort);
  const sort = view === 'all-activity' && rawSort === 'relevant' ? 'newest' : rawSort;
  const search = searchParams.get('search') ?? initialSearch ?? '';
  const queryKey = `${view}|${mode}|${range}|${appType}|${signalFamilies.join(',')}|${sort}|${search}`;
  const hasServerActivityResponse = Boolean(initialActivityResponse);

  const [searchInput, setSearchInput] = useState(search);
  const deferredSearch = useDeferredValue(searchInput);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [items, setItems] = useState<ChangeActivityRow[]>(() => initialActivityResponse?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(() => initialActivityResponse?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(() =>
    initialActivityResponse ? queryKey : null
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ChangeActivityDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<ChangeFeedStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const requestVersionRef = useRef(0);
  const previousQueryKeyRef = useRef(queryKey);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (deferredSearch === search) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const nextUrl = buildUrl(pathname, searchParams, {
        search: deferredSearch || null,
        cursor: null,
      });

      startTransition(() => {
        router.replace(nextUrl, { scroll: false });
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deferredSearch, pathname, router, search, searchParams]);

  useEffect(() => {
    if (previousQueryKeyRef.current === queryKey) {
      return;
    }

    previousQueryKeyRef.current = queryKey;
    requestVersionRef.current += 1;
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setExpandedId(null);
    setDetails({});
    setDetailErrors({});
    setDetailLoadingId(null);

    if (hasServerActivityResponse) {
      return;
    }

    setItems([]);
    setCursor(null);
    setLoadedKey(null);
  }, [hasServerActivityResponse, queryKey]);

  useEffect(() => {
    if (!initialActivityResponse) {
      return;
    }

    setItems(initialActivityResponse.items);
    setCursor(initialActivityResponse.nextCursor);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setLoadedKey(queryKey);
  }, [initialActivityResponse, queryKey]);

  useEffect(() => {
    if (!authReady || hasServerActivityResponse || loadedKey === queryKey) {
      return;
    }

    const version = requestVersionRef.current;
    let cancelled = false;

    const loadActivity = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = buildActivityParams({
          range,
          view,
          mode,
          sort,
          appType,
          signalFamilies,
          search,
        });
        const data = await fetchJson<ChangeFeedActivityResponse>(
          `/api/change-feed/activity?${params.toString()}`
        );

        if (!cancelled && requestVersionRef.current === version) {
          setItems(data.items);
          setCursor(data.nextCursor);
          setLoadedKey(queryKey);
        }
      } catch (nextError) {
        if (!cancelled && requestVersionRef.current === version) {
          setItems([]);
          setCursor(null);
          setError(nextError instanceof Error ? nextError.message : 'Failed to load Steam activity');
        }
      } finally {
        if (!cancelled && requestVersionRef.current === version) {
          setLoading(false);
        }
      }
    };

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    hasServerActivityResponse,
    loadedKey,
    queryKey,
    range,
    view,
    mode,
    sort,
    appType,
    signalFamilies,
    search,
  ]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    let cancelled = false;

    const loadStatus = async () => {
      try {
        const nextStatus = await fetchJson<ChangeFeedStatus>('/api/change-feed/status');
        if (!cancelled) {
          setStatus(nextStatus);
          setStatusError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setStatus(null);
          setStatusError(nextError instanceof Error ? nextError.message : 'Status unavailable');
        }
      }
    };

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [authReady]);

  useEffect(() => {
    if (!expandedId || details[expandedId] || detailLoadingId === expandedId) {
      return;
    }

    let cancelled = false;
    setDetailLoadingId(expandedId);
    setDetailErrors((current) => {
      const next = { ...current };
      delete next[expandedId];
      return next;
    });

    fetchJson<ChangeFeedActivityDetailResponse>(
      `/api/change-feed/activity/${encodeURIComponent(expandedId)}`
    )
      .then((response) => {
        if (!cancelled) {
          setDetails((current) => ({
            ...current,
            [expandedId]: response.item,
          }));
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDetailErrors((current) => ({
            ...current,
            [expandedId]:
              nextError instanceof Error ? nextError.message : 'Failed to load activity detail',
          }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoadingId((current) => (current === expandedId ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [details, expandedId]);

  const handleParamChange = (updates: Record<string, string | null>) => {
    const nextUrl = buildUrl(pathname, searchParams, {
      ...updates,
      cursor: null,
    });

    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  };

  const handleSignalToggle = (family: ChangeActivitySignalFamily) => {
    const nextSet = new Set(signalFamilies);
    if (nextSet.has(family)) {
      nextSet.delete(family);
    } else {
      nextSet.add(family);
    }

    const nextValue = Array.from(nextSet).join(',');
    handleParamChange({ signals: nextValue || null });
  };

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) {
      return;
    }

    const version = requestVersionRef.current;
    setLoadingMore(true);

    try {
      const params = buildActivityParams({
        range,
        view,
        mode,
        sort,
        appType,
        signalFamilies,
        search,
        cursor,
      });

      const data = await fetchJson<ChangeFeedActivityResponse>(
        `/api/change-feed/activity?${params.toString()}`
      );

      if (requestVersionRef.current !== version) {
        return;
      }

      setItems((current) => {
        const seen = new Set(current.map((item) => item.activityId));
        const merged = [...current];

        data.items.forEach((item) => {
          if (!seen.has(item.activityId)) {
            seen.add(item.activityId);
            merged.push(item);
          }
        });

        return merged;
      });
      setCursor(data.nextCursor);
    } catch (nextError) {
      if (requestVersionRef.current === version) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load more activity');
      }
    } finally {
      if (requestVersionRef.current === version) {
        setLoadingMore(false);
      }
    }
  };

  const activeSignalSet = useMemo(() => new Set(signalFamilies), [signalFamilies]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Steam Activity"
        description="A live exploration feed for Steam activity with readable cards, announcement context, and expandable before/after detail."
        actions={
          <div className="flex items-center gap-2">
            {status && (
              <Badge variant={getStatusBadgeVariant(status.state)}>{getStatusLabel(status.state)}</Badge>
            )}
            {statusError && <Badge variant="warning">Status unavailable</Badge>}
          </div>
        }
      />

      <Card padding="md" className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {CHANGE_ACTIVITY_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleParamChange({ view: option })}
              className={`rounded-full border px-3 py-1.5 text-body-sm font-medium transition-colors ${
                view === option
                  ? 'border-border-muted bg-surface-elevated text-text-primary'
                  : 'border-border-subtle bg-surface text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
              }`}
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {CHANGE_ACTIVITY_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleParamChange({ mode: option })}
              className={`rounded-md border px-3 py-1.5 text-body-sm transition-colors ${
                mode === option
                  ? 'border-border-muted bg-surface-elevated text-text-primary'
                  : 'border-transparent text-text-secondary hover:border-border-subtle hover:bg-surface-elevated hover:text-text-primary'
              }`}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px_220px_auto]">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search apps, headlines, or change themes"
            leftIcon={<Search className="h-4 w-4" />}
          />

          <div className="flex items-center gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleParamChange({ range: option.id })}
                className={`rounded-md border px-2.5 py-1.5 text-body-sm transition-colors ${
                  range === option.id
                    ? 'border-border-muted bg-surface-elevated text-text-primary'
                    : 'border-transparent text-text-secondary hover:border-border-subtle hover:bg-surface-elevated hover:text-text-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 text-body-sm text-text-secondary">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => handleParamChange({ sort: event.target.value })}
              className="h-9 min-w-0 flex-1 bg-transparent text-text-primary focus:outline-none"
            >
              {CHANGE_ACTIVITY_SORTS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="secondary"
            onClick={() => setShowAdvancedFilters((current) => !current)}
          >
            <Filter className="h-4 w-4" />
            {showAdvancedFilters ? 'Hide filters' : 'Advanced filters'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {CHANGE_ACTIVITY_SIGNAL_FAMILIES.map((family) => (
            <button
              key={family}
              type="button"
              onClick={() => handleSignalToggle(family)}
              className={`rounded-full border px-3 py-1.5 text-body-sm transition-colors ${
                activeSignalSet.has(family)
                  ? 'border-border-muted bg-surface-elevated text-text-primary'
                  : 'border-border-subtle bg-surface text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
              }`}
            >
              {SIGNAL_LABELS[family]}
            </button>
          ))}
        </div>

        {showAdvancedFilters && (
          <div className="grid gap-3 border-t border-border-subtle pt-4 md:grid-cols-[220px_auto]">
            <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 text-body-sm text-text-secondary">
              <span>Type</span>
              <select
                value={appType}
                onChange={(event) => handleParamChange({ appTypes: event.target.value })}
                className="h-9 min-w-0 flex-1 bg-transparent text-text-primary focus:outline-none"
              >
                {APP_TYPE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleParamChange({
                    appTypes: null,
                    signals: null,
                    sort: null,
                  })
                }
              >
                Clear filters
              </Button>
              <span className="text-body-sm text-text-secondary">
                Use the quick views for launch, commercial, and store refresh slices. Use signals and sort to refine the raw stream.
              </span>
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        {!authReady ? (
          <Card className="flex items-center justify-center gap-2 py-10 text-body-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Establishing authenticated session...
          </Card>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : error ? (
          <Card className="border-accent-red/30 bg-accent-red/10">
            <p className="text-body-sm text-accent-red">{error}</p>
          </Card>
        ) : items.length === 0 ? (
          <EmptyState
            title="No activity matched these filters"
            description="Widen the time range or relax the current signal filters."
            icon={<Sparkles className="h-5 w-5" />}
          />
        ) : (
          items.map((row) => (
            <ActivityCard
              key={row.activityId}
              row={row}
              detail={details[row.activityId] ?? null}
              expanded={expandedId === row.activityId}
              loading={detailLoadingId === row.activityId}
              error={detailErrors[row.activityId] ?? null}
              onToggle={() => {
                setExpandedId((current) => (current === row.activityId ? null : row.activityId));
              }}
            />
          ))
        )}

        {!loading && !error && cursor && (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" onClick={handleLoadMore} isLoading={loadingMore}>
              Load more activity
            </Button>
          </div>
        )}
      </div>

      <Card className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-surface-elevated p-2 text-text-muted">
            <BellRing className="h-4 w-4" />
          </div>
          <div>
            <p className="text-body-sm font-medium text-text-primary">How to read this page</p>
            <p className="mt-1 text-body-sm text-text-secondary">
              Each row groups Steam activity into a readable card. Overview keeps the stream useful,
              All Activity keeps it raw and recent, and expanding a card reveals the actual before /
              after evidence.
            </p>
          </div>
        </div>

        <div className="grid gap-2 text-body-sm text-text-secondary sm:grid-cols-3 md:text-right">
          <div>
            <p className="font-medium text-text-primary">Launch Watch</p>
            <p>Upcoming titles, recent launches, and date-locking activity.</p>
          </div>
          <div>
            <p className="font-medium text-text-primary">Commercial Moves</p>
            <p>Pricing, discounts, package changes, and monetization shifts.</p>
          </div>
          <div>
            <p className="font-medium text-text-primary">Store Refreshes</p>
            <p>Copy, artwork, screenshots, trailers, tags, and presentation changes.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
