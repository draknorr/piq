'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendBadge, TierBadge, StackedBarChart, AreaChartComponent, RatioBar, ReviewScoreBadge, VelocityTierBadge } from '@/components/data-display';
import { SimilaritySection } from '@/components/similarity';
import { Card } from '@/components/ui';
import { CheckCircle2, XCircle, AlertTriangle, ChevronRight, ChevronDown, Monitor, Gamepad2, Calendar, FileText, Wrench, Globe, ExternalLink, Layers } from 'lucide-react';
import type { App as AppSummary } from '../lib/apps-types';
import { DataFreshnessFooter } from '../components/DataFreshnessFooter';

interface AppDetails {
  appid: number;
  name: string;
  type: string;
  is_free: boolean;
  release_date: string | null;
  release_date_raw: string | null;
  store_asset_mtime: string | null;
  has_workshop: boolean;
  current_price_cents: number | null;
  current_discount_percent: number | null;
  is_released: boolean;
  is_delisted: boolean;
  has_developer_info: boolean;
  // PICS data
  controller_support: string | null;
  pics_review_score: number | null;
  pics_review_percentage: number | null;
  metacritic_score: number | null;
  metacritic_url: string | null;
  platforms: string | null;
  release_state: string | null;
  parent_appid: number | null;
  homepage_url: string | null;
  last_content_update: string | null;
  current_build_id: string | null;
  app_state: string | null;
  languages: Record<string, unknown> | null;
  content_descriptors: unknown[] | null;
  created_at: string;
  updated_at: string;
}

interface SteamDeckInfo {
  category: 'verified' | 'playable' | 'unsupported' | 'unknown';
  tests_passed: string[] | null;
  tests_failed: string[] | null;
}

interface Genre {
  id: number;
  name: string;
  is_primary: boolean;
}

interface Category {
  id: number;
  name: string;
}

interface Franchise {
  id: number;
  name: string;
}

interface SteamTag {
  id: number;
  name: string;
  rank: number;
}

interface DLCApp {
  appid: number;
  name: string;
  type: string;
}

type DataCoverageStatus = 'ok' | 'missing' | 'stale' | 'unknown';

interface DataCoverageItem {
  key: string;
  label: string;
  status: DataCoverageStatus;
  source: string;
  detail?: string;
}

interface DataCoverage {
  items: DataCoverageItem[];
}

interface DailyMetric {
  metric_date: string;
  review_score: number | null;
  review_score_desc: string | null;
  review_score_is_carried_forward: boolean;
  total_reviews: number | null;
  positive_reviews: number | null;
  negative_reviews: number | null;
  reviews_added: number | null;
  positive_added: number | null;
  negative_added: number | null;
  is_review_interpolated: boolean;
  owners_min: number | null;
  owners_max: number | null;
  ccu_peak: number | null;
  ccu_source: 'steam_api' | 'steamspy' | null;
  average_playtime_forever: number | null;
  average_playtime_2weeks: number | null;
  price_cents: number | null;
  discount_percent: number | null;
}

interface ReviewHistogram {
  month_start: string;
  recommendations_up: number;
  recommendations_down: number;
}

interface AppTrends {
  trend_30d_direction: string | null;
  trend_30d_change_pct: number | null;
  trend_90d_direction: string | null;
  trend_90d_change_pct: number | null;
  current_positive_ratio: number | null;
  previous_positive_ratio: number | null;
  review_velocity_7d: number | null;
  review_velocity_30d: number | null;
  ccu_trend_7d_pct: number | null;
}

interface SyncStatus {
  last_steamspy_sync: string | null;
  last_storefront_sync: string | null;
  last_reviews_sync: string | null;
  last_histogram_sync: string | null;
  priority_score: number | null;
  refresh_tier: string | null;
  review_velocity_tier: 'high' | 'medium' | 'low' | 'dormant' | null;
  last_activity_at: string | null;
  consecutive_errors: number | null;
  last_error_source: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  is_syncable: boolean;
}

interface AppDetailSectionsProps {
  app: AppDetails;
  appSummary: AppSummary | null;
  dataCoverage: DataCoverage;
  developers: { id: number; name: string }[];
  publishers: { id: number; name: string }[];
  tags: { tag: string; vote_count: number | null }[];
  metrics: DailyMetric[];
  histogram: ReviewHistogram[];
  trends: AppTrends | null;
  syncStatus: SyncStatus | null;
  steamDeck: SteamDeckInfo | null;
  genres: Genre[];
  categories: Category[];
  franchises: Franchise[];
  dlcs: DLCApp[];
  steamTags: SteamTag[];
}

const sections = [
  { id: 'summary', label: 'Summary' },
  { id: 'similar', label: 'Similar' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'data', label: 'Data' },
  { id: 'sync', label: 'Sync Status' },
];

// Limits for expandable sections
const TAG_LIMIT = 12;
const LANGUAGE_LIMIT = 10;
const DLC_LIMIT = 5;
const CATEGORY_LIMIT = 6;
const CONTENT_DESCRIPTOR_LIMIT = 5;

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 24,
    },
  },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  // Handle YYYY-MM-DD without timezone shifts (date-only columns)
  const dateOnly = parseDateOnlyParts(dateStr);
  if (dateOnly) {
    return `${MONTH_SHORT_NAMES[dateOnly.monthIndex]} ${dateOnly.day}, ${dateOnly.year}`;
  }

  // Fallback for timestamps: format in UTC for SSR/client consistency
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  return `${MONTH_SHORT_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Short month names for consistent formatting between server and client.
 * Using manual lookup avoids toLocaleDateString hydration mismatches.
 */
const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Month names for consistent formatting between server and client.
 * Using manual lookup avoids toLocaleDateString hydration mismatches.
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function parseDateOnlyParts(dateStr: string): { year: number; monthIndex: number; day: number } | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  if (day < 1 || day > 31) return null;

  return { year, monthIndex, day };
}

function formatShortDateLabel(dateStr: string): string {
  const parts = parseDateOnlyParts(dateStr);
  if (!parts) return '—';
  return `${MONTH_SHORT_NAMES[parts.monthIndex]} ${parts.day}`;
}

/**
 * Safely parse a month_start string (YYYY-MM or YYYY-MM-DD format)
 * and return a formatted month label like "December 2025".
 */
function formatMonthLabel(monthStart: string): string {
  if (!monthStart) return '—';

  // Validate YYYY-MM or YYYY-MM-DD format
  const isoPattern = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
  const match = monthStart.match(isoPattern);

  if (!match) {
    // Bad data - hide it
    return '—';
  }

  const year = match[1]; // Keep as string "2025"
  const monthIndex = parseInt(match[2], 10) - 1; // 0-indexed

  if (monthIndex < 0 || monthIndex > 11) return '—';

  return `${MONTH_NAMES[monthIndex]} ${year}`; // "December 2025"
}

function getPICSReviewScoreDescription(score: number): string {
  const descriptions: Record<number, string> = {
    9: 'Overwhelmingly Positive',
    8: 'Very Positive',
    7: 'Positive',
    6: 'Mostly Positive',
    5: 'Mixed',
    4: 'Mostly Negative',
    3: 'Negative',
    2: 'Very Negative',
    1: 'Overwhelmingly Negative',
  };
  return descriptions[score] ?? 'Unknown';
}

function parseContentDescriptors(descriptors: unknown[] | null): { id: string; label: string; severity: 'high' | 'medium' }[] {
  if (!descriptors || !Array.isArray(descriptors)) return [];

  const descriptorMap: Record<string, { label: string; severity: 'high' | 'medium' }> = {
    '1': { label: 'Some Nudity or Sexual Content', severity: 'medium' },
    '2': { label: 'Frequent Violence or Gore', severity: 'medium' },
    '3': { label: 'Adult Only Sexual Content', severity: 'high' },
    '4': { label: 'Frequent Nudity or Sexual Content', severity: 'high' },
    '5': { label: 'General Mature Content', severity: 'medium' },
  };

  return descriptors
    .map(d => {
      const id = String(d);
      const info = descriptorMap[id];
      return info ? { id, ...info } : null;
    })
    .filter((d): d is { id: string; label: string; severity: 'high' | 'medium' } => d !== null);
}

export function AppDetailSections({
  app,
  appSummary,
  dataCoverage,
  developers,
  publishers,
  tags,
  metrics,
  histogram,
  trends,
  syncStatus,
  steamDeck,
  genres,
  categories,
  franchises,
  dlcs,
  steamTags,
}: AppDetailSectionsProps) {
  const [activeSection, setActiveSection] = useState('summary');
  const latestMetrics = metrics[0] ?? null;
  const [similarityCoverage, setSimilarityCoverage] = useState<Pick<DataCoverageItem, 'status' | 'detail'>>({
    status: 'unknown',
    detail: undefined,
  });

  const mergedCoverage: DataCoverage = {
    items: dataCoverage.items.map((item) => {
      if (item.key !== 'similarity') return item;
      return {
        ...item,
        status: similarityCoverage.status,
        detail: similarityCoverage.detail ?? item.detail,
      };
    }),
  };

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections.map(s => document.getElementById(s.id));
      const scrollPosition = window.scrollY + 150;

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const element = sectionElements[i];
        if (element && element.offsetTop <= scrollPosition) {
          setActiveSection(sections[i].id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const offset = 120;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  };

  return (
    <div>
      {/* Sticky section navigation */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-border-subtle -mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 py-3 mb-6">
        <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {sections.map((section, index) => (
            <button
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm font-medium transition-colors ${
                activeSection === section.id
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
              }`}
            >
              {section.label}
              {index < sections.length - 1 && (
                <ChevronRight className="h-3 w-3 text-text-muted ml-1" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* All sections in scrollable view */}
      <div className="space-y-8">
        <SummarySection
          id="summary"
          app={app}
          developers={developers}
          publishers={publishers}
          tags={tags}
          steamTags={steamTags}
          trends={trends}
          genres={genres}
          franchises={franchises}
          steamDeck={steamDeck}
          categories={categories}
          dlcs={dlcs}
        />
        {/* Similar Games Section */}
        {app.type === 'game' && !app.is_delisted && (
          <section id="similar" className="overflow-hidden">
            <SectionHeader title="Similar Games" id="similar-header" />
            <SimilaritySection
              entityId={app.appid}
              entityName={app.name}
              entityType="game"
              limit={10}
              showFilters={true}
              showHeader={false}
              compact={true}
              onStatusChange={setSimilarityCoverage}
            />
          </section>
        )}
        <MetricsSection id="metrics" metrics={metrics} />
        <ReviewsSection id="reviews" histogram={histogram} latestMetrics={latestMetrics} />
        <DataCoverageSection
          id="data"
          coverage={mergedCoverage}
          onJumpToSync={() => scrollToSection('sync')}
        />
        <SyncSection id="sync" syncStatus={syncStatus} />
      </div>

      <DataFreshnessFooter lastUpdated={appSummary?.data_updated_at ?? null} />
    </div>
  );
}

function SectionHeader({ title, id }: { title: string; id: string }) {
  return (
    <h2 id={id} className="text-heading text-text-primary mb-6 scroll-mt-32">
      {title}
    </h2>
  );
}

function SummarySection({
  id,
  app,
  developers,
  publishers,
  tags,
  steamTags,
  trends,
  genres,
  franchises,
  steamDeck,
  categories,
  dlcs,
}: {
  id: string;
  app: AppDetails;
  developers: { id: number; name: string }[];
  publishers: { id: number; name: string }[];
  tags: { tag: string; vote_count: number | null }[];
  steamTags: SteamTag[];
  trends: AppTrends | null;
  genres: Genre[];
  franchises: Franchise[];
  steamDeck: SteamDeckInfo | null;
  categories: Category[];
  dlcs: DLCApp[];
}) {
  // Expandable states
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [languagesExpanded, setLanguagesExpanded] = useState(false);
  const [contentDescriptorsExpanded, setContentDescriptorsExpanded] = useState(false);
  const [dlcsExpanded, setDlcsExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const contentDescriptors = parseContentDescriptors(app.content_descriptors);
  const languageKeys = app.languages ? Object.keys(app.languages) : [];
  const namedTags = steamTags.filter(t => !t.name.startsWith('Tag '));
  const displayedTags = tagsExpanded ? namedTags : namedTags.slice(0, TAG_LIMIT);

  // Find community tags that are not in official tags (case-insensitive comparison)
  const officialTagNames = new Set(namedTags.map(t => t.name.toLowerCase()));
  const uniqueCommunityTags = tags.filter(t => !officialTagNames.has(t.tag.toLowerCase()));
  const displayedLanguages = languagesExpanded ? languageKeys : languageKeys.slice(0, LANGUAGE_LIMIT);
  const displayedDescriptors = contentDescriptorsExpanded ? contentDescriptors : contentDescriptors.slice(0, CONTENT_DESCRIPTOR_LIMIT);
  const displayedDLCs = dlcsExpanded ? dlcs : dlcs.slice(0, DLC_LIMIT);
  const displayedCategories = categoriesExpanded ? categories : categories.slice(0, CATEGORY_LIMIT);
  const trend30dChangePct = toFiniteNumber(trends?.trend_30d_change_pct);
  const trend90dChangePct = toFiniteNumber(trends?.trend_90d_change_pct);
  const reviewVelocity7d = toFiniteNumber(trends?.review_velocity_7d);

  // Check if we have any extended facts to show
  const hasExtendedFacts = app.pics_review_score !== null ||
    app.metacritic_score !== null ||
    app.parent_appid !== null ||
    app.release_state ||
    app.app_state ||
    app.last_content_update ||
    app.current_build_id ||
    app.homepage_url;

  return (
    <section className="overflow-hidden">
      <SectionHeader title="Summary" id={id} />
      <div className="space-y-4 max-w-full">
        {/* Row 1: Quick Facts + Tags (1:2 grid) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Quick Facts Card */}
          <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-caption text-text-tertiary flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Release
                </p>
                <p className="text-body-sm font-medium text-text-primary">
                  {app.release_date ? formatDate(app.release_date) : app.release_date_raw ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-caption text-text-tertiary flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Page Created
                </p>
                <p className="text-body-sm font-medium text-text-primary">{formatDate(app.store_asset_mtime)}</p>
              </div>
              {trends && (
                <>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 pt-2 border-t border-border-subtle">
                    <TrendBadge
                      direction={(trends.trend_30d_direction as 'up' | 'down' | 'stable') ?? 'stable'}
                      value={trend30dChangePct ?? undefined}
                      label="30d"
                    />
                    <TrendBadge
                      direction={(trends.trend_90d_direction as 'up' | 'down' | 'stable') ?? 'stable'}
                      value={trend90dChangePct ?? undefined}
                      label="90d"
                    />
                    <span className="text-caption text-text-muted ml-auto">
                      {reviewVelocity7d?.toFixed(1) ?? '—'}/day
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Tags - spans 2 columns */}
          <div className="lg:col-span-2 p-3 rounded-md border border-border-subtle bg-surface-raised">
            {/* Official Tags (from Steam's product info) */}
            {namedTags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-caption text-text-tertiary mr-1">Tags:</span>
                {displayedTags.map((tag) => (
                  <a
                    key={tag.id}
                    href={`https://store.steampowered.com/search/?tags=${tag.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 rounded text-caption bg-accent-primary/10 border border-accent-primary/20 text-accent-primary hover:bg-accent-primary/20 transition-colors"
                    title={`Rank #${tag.rank}`}
                  >
                    {tag.name}
                  </a>
                ))}
                {namedTags.length > TAG_LIMIT && (
                  <button
                    onClick={() => setTagsExpanded(!tagsExpanded)}
                    className="px-2 py-0.5 rounded text-caption text-accent-primary hover:bg-accent-primary/10 transition-colors"
                  >
                    {tagsExpanded ? 'Show less' : `+${namedTags.length - TAG_LIMIT} more`}
                  </button>
                )}
              </div>
            ) : tags.length > 0 ? (
              // Fallback to SteamSpy tags if no official tags
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-caption text-text-tertiary mr-1">Tags:</span>
                {tags.slice(0, TAG_LIMIT).map(({ tag }) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-caption bg-surface-elevated border border-border-subtle text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
                {tags.length > TAG_LIMIT && (
                  <span className="text-caption text-text-muted">+{tags.length - TAG_LIMIT}</span>
                )}
              </div>
            ) : (
              <p className="text-caption text-text-muted">No tags available</p>
            )}

            {/* Community Tags - only show if there are unique tags not in official */}
            {namedTags.length > 0 && uniqueCommunityTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border-subtle">
                <span className="text-caption text-text-muted mr-1">Community:</span>
                {uniqueCommunityTags.slice(0, 6).map(({ tag, vote_count }) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-caption bg-accent-purple/10 border border-accent-purple/20 text-accent-purple"
                    title={vote_count ? `${vote_count.toLocaleString()} votes` : undefined}
                  >
                    {tag}
                  </span>
                ))}
                {uniqueCommunityTags.length > 6 && (
                  <span className="text-caption text-text-muted">+{uniqueCommunityTags.length - 6}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Developer/Publisher/Franchise Row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-md border border-border-subtle bg-surface-raised">
          {/* Developers */}
          <div className="flex items-center gap-2">
            <span className="text-caption text-text-tertiary">Developer:</span>
            {developers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {developers.map((dev) => (
                  <Link
                    key={dev.id}
                    href={`/developers/${dev.id}`}
                    className="px-2 py-0.5 rounded text-body-sm text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors"
                  >
                    {dev.name}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="text-text-muted text-body-sm">—</span>
            )}
          </div>

          {/* Publishers */}
          <div className="flex items-center gap-2">
            <span className="text-caption text-text-tertiary">Publisher:</span>
            {publishers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {publishers.map((pub) => (
                  <Link
                    key={pub.id}
                    href={`/publishers/${pub.id}`}
                    className="px-2 py-0.5 rounded text-body-sm text-accent-cyan bg-accent-cyan/10 hover:bg-accent-cyan/20 transition-colors"
                  >
                    {pub.name}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="text-text-muted text-body-sm">—</span>
            )}
          </div>

          {/* Franchises */}
          {franchises.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-text-tertiary">Franchise:</span>
              {franchises.map((franchise) => (
                <span
                  key={franchise.id}
                  className="px-2 py-0.5 rounded text-body-sm bg-accent-cyan/10 text-accent-cyan"
                >
                  {franchise.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Row 3: Platform Stats + Genres (responsive grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Platforms Card */}
          {app.platforms && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Monitor className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Platforms</h3>
              </div>
              <p className="text-body-sm text-text-secondary capitalize">{app.platforms.replace(/,/g, ', ')}</p>
            </Card>
          )}

          {/* Genres Card */}
          {genres.length > 0 && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Genres</h3>
              </div>
              <div className="flex flex-wrap gap-1">
                {genres.map((genre) => (
                  <span
                    key={genre.id}
                    className={`px-1.5 py-0.5 rounded text-caption ${
                      genre.is_primary
                        ? 'bg-accent-purple/20 text-accent-purple font-medium'
                        : 'bg-accent-purple/10 text-accent-purple'
                    }`}
                  >
                    {genre.is_primary && '★ '}{genre.name}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* Steam Deck Card */}
          {steamDeck && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Steam Deck</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-body-sm font-medium ${
                  steamDeck.category === 'verified' ? 'bg-accent-green/15 text-accent-green' :
                  steamDeck.category === 'playable' ? 'bg-accent-yellow/15 text-accent-yellow' :
                  steamDeck.category === 'unsupported' ? 'bg-accent-red/15 text-accent-red' :
                  'bg-surface-elevated text-text-muted'
                }`}>
                  {steamDeck.category === 'verified' ? 'Verified' :
                   steamDeck.category === 'playable' ? 'Playable' :
                   steamDeck.category === 'unsupported' ? 'Unsupported' : 'Unknown'}
                </span>
                {(steamDeck.tests_passed || steamDeck.tests_failed) && (
                  <span className="text-caption text-text-muted">
                    {steamDeck.tests_passed?.length ?? 0}✓ {steamDeck.tests_failed?.length ?? 0}✗
                  </span>
                )}
              </div>
            </Card>
          )}

          {/* Controller Support Card */}
          {app.controller_support && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Controller</h3>
              </div>
              <p className="text-body-sm text-text-secondary capitalize">{app.controller_support}</p>
            </Card>
          )}
        </div>

        {/* Row 4: Extended Facts grid (conditional) */}
        {hasExtendedFacts && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-md border border-border-subtle bg-surface-raised w-full">
            {app.has_workshop !== undefined && (
              <div>
                <p className="text-caption text-text-tertiary flex items-center gap-1"><Wrench className="h-3 w-3" /> Workshop</p>
                <p className={`text-body-sm ${app.has_workshop ? 'text-accent-green' : 'text-text-muted'}`}>
                  {app.has_workshop ? 'Yes' : 'No'}
                </p>
              </div>
            )}
            {app.pics_review_score !== null && (
              <div>
                <p className="text-caption text-text-tertiary">Score</p>
                <p className={`text-body-sm font-medium ${
                  app.pics_review_score >= 7 ? 'text-accent-green' :
                  app.pics_review_score >= 5 ? 'text-accent-yellow' : 'text-accent-red'
                }`}>
                  {app.pics_review_score} ({getPICSReviewScoreDescription(app.pics_review_score).split(' ').slice(-1)[0]})
                </p>
              </div>
            )}
            {app.metacritic_score !== null && (
              <div>
                <p className="text-caption text-text-tertiary">Metacritic</p>
                <p className={`text-body-sm font-medium ${
                  app.metacritic_score >= 75 ? 'text-accent-green' :
                  app.metacritic_score >= 50 ? 'text-accent-yellow' : 'text-accent-red'
                }`}>{app.metacritic_score}</p>
              </div>
            )}
            {app.parent_appid !== null && (
              <div>
                <p className="text-caption text-text-tertiary">Parent App</p>
                <Link href={`/apps/${app.parent_appid}`} className="text-body-sm text-accent-primary hover:underline">
                  {app.parent_appid}
                </Link>
              </div>
            )}
            {app.release_state && (
              <div>
                <p className="text-caption text-text-tertiary">Release State</p>
                <p className="text-body-sm text-text-primary capitalize">{app.release_state}</p>
              </div>
            )}
            {app.app_state && (
              <div>
                <p className="text-caption text-text-tertiary">App State</p>
                <p className="text-body-sm text-text-primary">{app.app_state}</p>
              </div>
            )}
            {app.last_content_update && (
              <div>
                <p className="text-caption text-text-tertiary">Content Update</p>
                <p className="text-body-sm text-text-primary">{formatDate(app.last_content_update)}</p>
              </div>
            )}
            {app.current_build_id && (
              <div>
                <p className="text-caption text-text-tertiary">Build ID</p>
                <p className="text-body-sm text-text-primary font-mono">{app.current_build_id}</p>
              </div>
            )}
            {app.homepage_url && (
              <div className="col-span-2">
                <p className="text-caption text-text-tertiary flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Homepage</p>
                <a href={app.homepage_url} target="_blank" rel="noopener noreferrer" className="text-body-sm text-accent-primary hover:underline truncate block">
                  {app.homepage_url.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Row 5: Features/Categories (expandable) */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 w-full">
            <span className="text-caption text-text-tertiary mr-1">Features:</span>
            {displayedCategories.map((category) => (
              <span key={category.id} className="px-2 py-0.5 rounded text-caption bg-surface-elevated border border-border-subtle text-text-secondary">
                {category.name}
              </span>
            ))}
            {categories.length > CATEGORY_LIMIT && (
              <button
                onClick={() => setCategoriesExpanded(!categoriesExpanded)}
                className="px-2 py-0.5 rounded text-caption text-accent-primary hover:bg-accent-primary/10 transition-colors"
              >
                {categoriesExpanded ? 'Show less' : `+${categories.length - CATEGORY_LIMIT} more`}
              </button>
            )}
          </div>
        )}

        {/* Row 6: DLCs (expandable) */}
        {dlcs.length > 0 && (
          <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
            <div className="flex items-center justify-between mb-2">
              <span className="text-body-sm font-medium text-text-primary">DLC ({dlcs.length})</span>
              {dlcs.length > DLC_LIMIT && (
                <button
                  onClick={() => setDlcsExpanded(!dlcsExpanded)}
                  className="text-caption text-accent-primary hover:bg-accent-primary/10 px-2 py-0.5 rounded transition-colors"
                >
                  {dlcsExpanded ? 'Show less' : `+${dlcs.length - DLC_LIMIT} more`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 w-full">
              {displayedDLCs.map((dlc) => (
                <Link
                  key={dlc.appid}
                  href={`/apps/${dlc.appid}`}
                  className="px-2 py-0.5 rounded text-caption bg-surface-elevated border border-border-subtle text-text-secondary hover:text-accent-primary hover:border-accent-primary/30 transition-colors truncate max-w-48"
                  title={dlc.name}
                >
                  {dlc.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Row 7: Languages + Content Descriptors (expandable) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Languages */}
          {languageKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 w-full">
              <Globe className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="text-caption text-text-tertiary mr-1">Languages:</span>
              {displayedLanguages.map((lang) => (
                <span key={lang} className="px-2 py-0.5 rounded text-caption bg-surface-elevated text-text-secondary">
                  {lang}
                </span>
              ))}
              {languageKeys.length > LANGUAGE_LIMIT && (
                <button
                  onClick={() => setLanguagesExpanded(!languagesExpanded)}
                  className="px-2 py-0.5 rounded text-caption text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  {languagesExpanded ? 'Show less' : `+${languageKeys.length - LANGUAGE_LIMIT} more`}
                </button>
              )}
            </div>
          )}

          {/* Content Descriptors */}
          {contentDescriptors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 w-full">
              <AlertTriangle className="h-3.5 w-3.5 text-accent-orange" />
              <span className="text-caption text-text-tertiary mr-1">Warnings:</span>
              {displayedDescriptors.map((descriptor) => (
                <span
                  key={descriptor.id}
                  className={`px-2 py-0.5 rounded text-caption font-medium ${
                    descriptor.severity === 'high'
                      ? 'bg-accent-red/15 text-accent-red'
                      : 'bg-accent-orange/15 text-accent-orange'
                  }`}
                >
                  {descriptor.label}
                </span>
              ))}
              {contentDescriptors.length > CONTENT_DESCRIPTOR_LIMIT && (
                <button
                  onClick={() => setContentDescriptorsExpanded(!contentDescriptorsExpanded)}
                  className="px-2 py-0.5 rounded text-caption text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  {contentDescriptorsExpanded ? 'Show less' : `+${contentDescriptors.length - CONTENT_DESCRIPTOR_LIMIT} more`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricsSection({
  id,
  metrics,
}: {
  id: string;
  metrics: DailyMetric[];
  }) {
  const chartData = [...metrics].reverse().map((m) => ({
    date: formatShortDateLabel(m.metric_date),
    reviews: m.total_reviews,
    ccu: m.ccu_peak,
    positive: m.positive_reviews,
    negative: m.negative_reviews,
  }));

  return (
    <section>
      <SectionHeader title="Metrics" id={id} />
      {chartData.length > 0 ? (
        <div className="space-y-4">
          {/* Charts - compact */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
              <h3 className="text-body-sm font-medium text-text-primary mb-2">Reviews</h3>
              <AreaChartComponent
                data={chartData}
                xKey="date"
                yKey="reviews"
                height={140}
                color="blue"
                formatYAxis={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toString()}
                tooltipLabel="Reviews"
              />
            </div>
            <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
              <h3 className="text-body-sm font-medium text-text-primary mb-2">Peak CCU</h3>
              <AreaChartComponent
                data={chartData}
                xKey="date"
                yKey="ccu"
                height={140}
                color="cyan"
                formatYAxis={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toString()}
                tooltipLabel="Peak CCU"
              />
            </div>
          </div>

          {/* Metrics - mobile card view, desktop table */}
          <div className="rounded-md border border-border-subtle overflow-hidden">
            {/* Mobile: Card view */}
            <div className="sm:hidden divide-y divide-border-subtle">
              {metrics.slice(0, 5).map((m) => (
                <div key={m.metric_date} className="p-3 bg-surface-raised">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm text-text-primary font-medium">{formatDate(m.metric_date)}</span>
                    <span className={`text-caption font-medium ${
                      m.review_score_desc?.includes('Positive') ? 'text-accent-green' :
                      m.review_score_desc?.includes('Negative') ? 'text-accent-red' :
                      m.review_score_desc === 'Mixed' ? 'text-accent-yellow' : 'text-text-muted'
                    }`}>
                      {m.review_score_desc ?? '—'}
                      {m.review_score_is_carried_forward && (
                        <span className="ml-1 text-text-tertiary">est.</span>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-caption">
                    <div>
                      <span className="text-text-tertiary">Daily +/-: </span>
                      <span className="text-accent-green">{formatNumber(m.positive_added)}</span>
                      <span className="text-text-muted">/</span>
                      <span className="text-accent-red">{formatNumber(m.negative_added)}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">CCU: </span>
                      <span className="text-text-secondary">{formatNumber(m.ccu_peak)}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Total: </span>
                      <span className="text-text-secondary">{formatNumber(m.total_reviews)}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Price: </span>
                      <span className="text-text-secondary">
                        {m.price_cents !== null ? `$${(m.price_cents / 100).toFixed(2)}` : '—'}
                        {m.discount_percent && m.discount_percent > 0 && (
                          <span className="ml-1 text-accent-green">-{m.discount_percent}%</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: Table view */}
            <table className="w-full hidden sm:table">
              <thead className="bg-surface-elevated">
                <tr>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Date</th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Score</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Total</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Daily +/-</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">CCU</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {metrics.slice(0, 5).map((m) => (
                  <tr key={m.metric_date} className="bg-surface-raised">
                    <td className="px-3 py-2 text-caption text-text-primary">{formatDate(m.metric_date)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-caption ${
                        m.review_score_desc?.includes('Positive') ? 'text-accent-green' :
                        m.review_score_desc?.includes('Negative') ? 'text-accent-red' :
                        m.review_score_desc === 'Mixed' ? 'text-accent-yellow' : 'text-text-muted'
                      }`}>
                        {m.review_score_desc ?? '—'}
                        {m.review_score_is_carried_forward && (
                          <span className="ml-1 text-text-tertiary">est.</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-caption text-text-secondary">{formatNumber(m.total_reviews)}</td>
                    <td className="px-3 py-2 text-right text-caption">
                      <span className="text-accent-green">{formatNumber(m.positive_added)}</span>
                      <span className="text-text-muted">/</span>
                      <span className="text-accent-red">{formatNumber(m.negative_added)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-caption text-text-secondary">{formatNumber(m.ccu_peak)}</td>
                    <td className="px-3 py-2 text-right text-caption text-text-secondary">
                      {m.price_cents !== null ? `$${(m.price_cents / 100).toFixed(2)}` : '—'}
                      {m.discount_percent && m.discount_percent > 0 && (
                        <span className="ml-1 text-accent-green">-{m.discount_percent}%</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-body-sm text-text-muted p-3 rounded-md border border-border-subtle bg-surface-raised">
          No metrics data available
        </p>
      )}
    </section>
  );
}

function ReviewsSection({
  id,
  histogram,
  latestMetrics,
}: {
  id: string;
  histogram: ReviewHistogram[];
  latestMetrics: DailyMetric | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const REVIEW_MONTHS_LIMIT = 6;

  const histogramData = [...histogram].reverse().slice(-12).map((h) => ({
    month: formatMonthLabel(h.month_start),
    positive: h.recommendations_up,
    negative: h.recommendations_down,
  }));

  const displayedHistogram = isExpanded ? histogram.slice(0, 12) : histogram.slice(0, REVIEW_MONTHS_LIMIT);

  // Aggregated review data
  const totalReviews = latestMetrics?.total_reviews ?? 0;
  const positiveReviews = latestMetrics?.positive_reviews ?? 0;
  const negativeReviews = latestMetrics?.negative_reviews ?? 0;
  const aggregatedScore = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;

  return (
    <section>
      <SectionHeader title="Reviews" id={id} />
      {histogram.length > 0 ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="space-y-4"
        >
          {/* Aggregated Review Summary */}
          {totalReviews > 0 && (
            <motion.div variants={itemVariants}>
              <div className="p-4 rounded-md border border-border-subtle bg-surface-raised">
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-3">
                    <ReviewScoreBadge
                      score={aggregatedScore}
                      description={latestMetrics?.review_score_desc ?? undefined}
                    />
                    <div>
                      <div className="text-body-sm font-medium text-text-primary">
                        {totalReviews.toLocaleString()} total reviews
                      </div>
                      <div className="text-caption text-text-muted">
                        {latestMetrics?.review_score_desc ?? 'No rating'}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-[200px] max-w-md">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-caption text-accent-green">{positiveReviews.toLocaleString()} positive</span>
                      <span className="text-caption text-text-muted">·</span>
                      <span className="text-caption text-accent-red">{negativeReviews.toLocaleString()} negative</span>
                    </div>
                    <RatioBar positive={positiveReviews} negative={negativeReviews} height={10} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Chart - compact */}
          <motion.div variants={itemVariants}>
            <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
              <h3 className="text-body-sm font-medium text-text-primary mb-2">Monthly Distribution</h3>
              <StackedBarChart
                data={histogramData}
                xKey="month"
                positiveKey="positive"
                negativeKey="negative"
                height={180}
              />
            </div>
          </motion.div>

          {/* Reviews table with animation */}
          <motion.div variants={itemVariants}>
            <div className="rounded-md border border-border-subtle overflow-hidden">
              {/* Mobile: Card view */}
              <div className="sm:hidden divide-y divide-border-subtle">
                <AnimatePresence>
                  {displayedHistogram.map((h) => {
                    const total = h.recommendations_up + h.recommendations_down;
                    const ratio = total > 0 ? (h.recommendations_up / total * 100) : 0;
                    return (
                      <motion.div
                        key={h.month_start}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="p-3 bg-surface-raised"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-body-sm text-text-primary font-medium">{formatMonthLabel(h.month_start)}</span>
                          <span className="text-caption text-text-secondary">{ratio.toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center gap-2 text-caption mb-2">
                          <span className="text-accent-green">{h.recommendations_up.toLocaleString()}</span>
                          <span className="text-text-muted">/</span>
                          <span className="text-accent-red">{h.recommendations_down.toLocaleString()}</span>
                          <span className="text-text-muted">({total.toLocaleString()} total)</span>
                        </div>
                        <RatioBar positive={h.recommendations_up} negative={h.recommendations_down} />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
              {/* Desktop: Table view */}
              <table className="w-full hidden sm:table">
                <thead className="bg-surface-elevated">
                  <tr>
                    <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Month</th>
                    <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Positive</th>
                    <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Negative</th>
                    <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Total</th>
                    <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">%</th>
                    <th className="px-3 py-2 w-24 text-caption font-medium text-text-tertiary">Ratio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  <AnimatePresence>
                    {displayedHistogram.map((h) => {
                      const total = h.recommendations_up + h.recommendations_down;
                      const ratio = total > 0 ? (h.recommendations_up / total * 100) : 0;
                      return (
                        <motion.tr
                          key={h.month_start}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="bg-surface-raised hover:bg-surface-elevated transition-colors"
                        >
                          <td className="px-3 py-2 text-caption text-text-primary">
                            {formatMonthLabel(h.month_start)}
                          </td>
                          <td className="px-3 py-2 text-right text-caption text-accent-green">
                            {h.recommendations_up.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-caption text-accent-red">
                            {h.recommendations_down.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-caption text-text-secondary">{total.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-caption text-text-secondary">{ratio.toFixed(0)}%</td>
                          <td className="px-3 py-2">
                            <RatioBar positive={h.recommendations_up} negative={h.recommendations_down} />
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>

              {/* Expand/Collapse button */}
              {histogram.length > REVIEW_MONTHS_LIMIT && (
                <div className="p-2 bg-surface-elevated border-t border-border-subtle">
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 text-caption text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
                  >
                    {isExpanded ? 'Show less' : `Show ${Math.min(histogram.length, 12) - REVIEW_MONTHS_LIMIT} more months`}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <p className="text-body-sm text-text-muted p-3 rounded-md border border-border-subtle bg-surface-raised">
          No review histogram data available
        </p>
      )}
    </section>
  );
}

function CoverageStatusBadge({ status }: { status: DataCoverageStatus }) {
  const badge = (() => {
    switch (status) {
      case 'ok':
        return { label: 'OK', className: 'bg-accent-green/15 text-accent-green border-accent-green/20' };
      case 'stale':
        return { label: 'Stale', className: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/20' };
      case 'missing':
        return { label: 'Missing', className: 'bg-accent-red/15 text-accent-red border-accent-red/20' };
      case 'unknown':
      default:
        return { label: 'Unknown', className: 'bg-surface-elevated text-text-muted border-border-subtle' };
    }
  })();

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-caption font-medium border ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function DataCoverageSection({
  id,
  coverage,
  onJumpToSync,
}: {
  id: string;
  coverage: DataCoverage;
  onJumpToSync: () => void;
}) {
  const missingItems = coverage.items.filter((i) => i.status === 'missing');
  const staleItems = coverage.items.filter((i) => i.status === 'stale');

  return (
    <section>
      <SectionHeader title="Data Coverage" id={id} />

      <div className="space-y-4">
        <Card padding="md">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-body-sm text-text-secondary">
              {coverage.items.length} sources · {missingItems.length} missing · {staleItems.length} stale
            </span>
            <button
              onClick={onJumpToSync}
              className="ml-auto text-caption text-accent-primary hover:bg-accent-primary/10 px-2 py-1 rounded transition-colors"
            >
              Jump to Sync Status
            </button>
          </div>
        </Card>

        <div className="rounded-md border border-border-subtle overflow-hidden">
          <div className="divide-y divide-border-subtle">
            {coverage.items.map((item) => (
              <div key={item.key} className="p-4 bg-surface-raised">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-body-sm font-medium text-text-primary">{item.label}</span>
                      <CoverageStatusBadge status={item.status} />
                    </div>
                    <div className="text-caption text-text-tertiary mt-1">
                      Source: <span className="font-mono text-[11px]">{item.source}</span>
                    </div>
                    {item.detail && (
                      <div className="text-caption text-text-muted mt-1 whitespace-pre-wrap break-words">
                        {item.detail}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SyncSection({
  id,
  syncStatus,
}: {
  id: string;
  syncStatus: SyncStatus | null;
}) {
  if (!syncStatus) {
    return (
      <section>
        <SectionHeader title="Sync Status" id={id} />
        <p className="text-body-sm text-text-muted p-3 rounded-md border border-border-subtle bg-surface-raised">
          No sync status available
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader title="Sync Status" id={id} />
      <div className="space-y-4">
        {/* Status + Sync times in single row */}
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-md border border-border-subtle bg-surface-raised">
          {syncStatus.refresh_tier && (
            <TierBadge tier={syncStatus.refresh_tier as 'active' | 'moderate' | 'dormant' | 'dead'} />
          )}
          {syncStatus.review_velocity_tier && (
            <VelocityTierBadge tier={syncStatus.review_velocity_tier} />
          )}
          {syncStatus.is_syncable ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-green/10 text-accent-green text-caption font-medium">
              <CheckCircle2 className="h-3 w-3" />
              Syncable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-red/10 text-accent-red text-caption font-medium">
              <XCircle className="h-3 w-3" />
              Disabled
            </span>
          )}
          {syncStatus.priority_score !== null && (
            <span className="text-caption text-text-tertiary">
              Priority: <span className="text-text-secondary font-medium">{syncStatus.priority_score}</span>
            </span>
          )}
          <span className="text-border-subtle">|</span>
          <span className="text-caption text-text-tertiary">Store:</span>
          <span className="text-caption text-text-primary">{timeAgo(syncStatus.last_storefront_sync)}</span>
          <span className="text-caption text-text-tertiary">Reviews:</span>
          <span className="text-caption text-text-primary">{timeAgo(syncStatus.last_reviews_sync)}</span>
          <span className="text-caption text-text-tertiary">SteamSpy:</span>
          <span className="text-caption text-text-primary">{timeAgo(syncStatus.last_steamspy_sync)}</span>
          <span className="text-caption text-text-tertiary">Histogram:</span>
          <span className="text-caption text-text-primary">{timeAgo(syncStatus.last_histogram_sync)}</span>
        </div>

        {/* Errors - only show if there are errors */}
        {syncStatus.consecutive_errors !== null && syncStatus.consecutive_errors > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-accent-red/20 bg-accent-red/5">
            <AlertTriangle className="h-4 w-4 text-accent-red mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-body-sm font-medium text-accent-red">
                {syncStatus.consecutive_errors} error{syncStatus.consecutive_errors > 1 ? 's' : ''}
              </span>
              {syncStatus.last_error_message && (
                <span className="text-body-sm text-accent-red/80 ml-2">{syncStatus.last_error_message}</span>
              )}
              {syncStatus.last_error_at && (
                <span className="text-caption text-accent-red/60 ml-2">
                  ({timeAgo(syncStatus.last_error_at)}{syncStatus.last_error_source && `, ${syncStatus.last_error_source}`})
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
