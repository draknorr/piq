'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui';
import { TypeBadge, ReviewScoreBadge, TrendIndicator, StackedBarChart, RatioBar, ReviewBreakdownPopover, TrendSparkline } from '@/components/data-display';
import { ChevronRight, ChevronDown, Users, Building2, Monitor, Gamepad2, Layers, Calendar, Globe, BarChart3 } from 'lucide-react';
import type { PortfolioPICSData } from '@/lib/portfolio-pics';
import type { CCUSparklineData } from '@/lib/ccu-queries';

interface Publisher {
  id: number;
  name: string;
  normalized_name: string;
  steam_vanity_url: string | null;
  first_game_release_date: string | null;
  game_count: number | null;
  created_at: string;
  updated_at: string;
}

interface PublisherApp {
  appid: number;
  name: string;
  type: string;
  is_free: boolean;
  release_date: string | null;
  is_released: boolean;
  is_delisted: boolean;
  review_score: number | null;
  review_score_desc: string | null;
  total_reviews: number | null;
  positive_reviews: number | null;
  negative_reviews: number | null;
  owners_min: number | null;
  owners_max: number | null;
  ccu_peak: number | null;
  trend_30d_direction: string | null;
  trend_30d_change_pct: number | null;
}

interface RelatedDeveloper {
  id: number;
  name: string;
  game_count: number | null;
  shared_apps: number;
}

interface SimilarPublisher {
  id: number;
  name: string;
  game_count: number | null;
  shared_tags: number;
}

interface ReviewHistogramGame {
  appid: number;
  name: string;
  recommendations_up: number;
  recommendations_down: number;
}

interface ReviewHistogram {
  month_start: string;
  recommendations_up: number;
  recommendations_down: number;
  games?: ReviewHistogramGame[];
}

interface PublisherDetailSectionsProps {
  publisher: Publisher;
  apps: PublisherApp[];
  relatedDevelopers: RelatedDeveloper[];
  tags: { tag: string; count: number }[];
  histogram: ReviewHistogram[];
  similarPublishers: SimilarPublisher[];
  picsData: PortfolioPICSData | null;
  ccuSparklines: Map<number, CCUSparklineData>;
}

const sections = [
  { id: 'summary', label: 'Summary' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'games', label: 'Games' },
  { id: 'network', label: 'Network' },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

function formatOwners(min: number | null, max: number | null): string {
  if (min === null || max === null) return '—';
  const formatNum = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return n.toString();
  };
  return `${formatNum(min)} - ${formatNum(max)}`;
}

/**
 * Month names for consistent formatting between server and client.
 * Using manual lookup avoids toLocaleDateString hydration mismatches.
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

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

export function PublisherDetailSections({
  publisher,
  apps,
  relatedDevelopers,
  tags,
  histogram,
  similarPublishers,
  picsData,
  ccuSparklines,
}: PublisherDetailSectionsProps) {
  const [activeSection, setActiveSection] = useState('summary');

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
                  ? 'bg-accent-blue/10 text-accent-blue'
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
          publisher={publisher}
          tags={tags}
          picsData={picsData}
          totalGames={apps.length}
        />
        <ReviewsSection id="reviews" histogram={histogram} apps={apps} />
        <GamesSection id="games" apps={apps} ccuSparklines={ccuSparklines} />
        <NetworkSection
          id="network"
          relatedDevelopers={relatedDevelopers}
          similarPublishers={similarPublishers}
        />
      </div>
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

// ============================================================================
// SUMMARY SECTION - Merged Overview + Portfolio PICS
// ============================================================================

function SummarySection({
  id,
  publisher,
  tags,
  picsData,
  totalGames,
}: {
  id: string;
  publisher: Publisher;
  tags: { tag: string; count: number }[];
  picsData: PortfolioPICSData | null;
  totalGames: number;
}) {
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [featuresExpanded, setFeaturesExpanded] = useState(false);
  const [languagesExpanded, setLanguagesExpanded] = useState(false);

  const TAG_LIMIT = 12;
  const FEATURE_LIMIT = 10;
  const LANGUAGE_LIMIT = 8;

  const displayedTags = tagsExpanded ? tags : tags.slice(0, TAG_LIMIT);
  const displayedFeatures = picsData ? (featuresExpanded ? picsData.categories : picsData.categories.slice(0, FEATURE_LIMIT)) : [];
  const displayedLanguages = picsData ? (languagesExpanded ? picsData.languages : picsData.languages.slice(0, LANGUAGE_LIMIT)) : [];
  const coverageTotalGames = picsData?.platformStats.totalGames ?? totalGames;

  return (
    <section>
      <SectionHeader title="Summary" id={id} />
      <div className="space-y-4">
        {/* Row 1: Quick Facts + Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Quick Facts Card */}
          <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col sm:items-center text-left sm:text-center">
                <Calendar className="h-4 w-4 text-text-tertiary mb-1" />
                <p className="text-caption text-text-tertiary">First Release</p>
                <p className="text-body-sm font-medium text-text-primary">{formatDate(publisher.first_game_release_date)}</p>
              </div>
              <div className="flex flex-col sm:items-center text-left sm:text-center">
                <Gamepad2 className="h-4 w-4 text-text-tertiary mb-1" />
                <p className="text-caption text-text-tertiary">Total Games</p>
                <p className="text-body-sm font-medium text-text-primary">{publisher.game_count}</p>
              </div>
            </div>
          </div>

          {/* Tags - spans 2 columns */}
          <div className="lg:col-span-2 p-3 rounded-md border border-border-subtle bg-surface-raised">
            {tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-caption text-text-tertiary mr-1">Top Tags:</span>
                {displayedTags.map(({ tag, count }) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded bg-surface-elevated border border-border-subtle text-caption text-text-secondary hover:border-border-muted transition-colors"
                    title={`${count} game${count !== 1 ? 's' : ''}`}
                  >
                    {tag}
                    <span className="ml-1.5 text-text-muted">{count}</span>
                  </span>
                ))}
                {tags.length > TAG_LIMIT && (
                  <button
                    onClick={() => setTagsExpanded(!tagsExpanded)}
                    className="px-2 py-0.5 rounded text-caption text-accent-blue hover:bg-accent-blue/10 transition-colors"
                  >
                    {tagsExpanded ? 'Show less' : `+${tags.length - TAG_LIMIT} more`}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-caption text-text-muted">No tags available</p>
            )}
          </div>
        </div>

        {/* Row 2: Platform Stats Grid */}
        {picsData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Platform Coverage */}
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Monitor className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Platform Coverage</h3>
              </div>
              <div className="space-y-2">
                <PlatformBar label="Windows" count={picsData.platformStats.platforms.windows} total={coverageTotalGames} />
                <PlatformBar label="macOS" count={picsData.platformStats.platforms.macos} total={coverageTotalGames} />
                <PlatformBar label="Linux" count={picsData.platformStats.platforms.linux} total={coverageTotalGames} />
              </div>
            </Card>

            {/* Steam Deck */}
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Steam Deck</h3>
              </div>
              <div className="space-y-1.5">
                <DistributionRow label="Verified" count={picsData.platformStats.steamDeck.verified} total={coverageTotalGames} color="green" />
                <DistributionRow label="Playable" count={picsData.platformStats.steamDeck.playable} total={coverageTotalGames} color="yellow" />
                <DistributionRow label="Unsupported" count={picsData.platformStats.steamDeck.unsupported} total={coverageTotalGames} color="red" />
                <DistributionRow label="Unknown" count={picsData.platformStats.steamDeck.unknown} total={coverageTotalGames} color="gray" />
              </div>
            </Card>

            {/* Controller Support */}
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-body-sm font-medium text-text-primary">Controller Support</h3>
              </div>
              <div className="space-y-1.5">
                <DistributionRow label="Full" count={picsData.platformStats.controllerSupport.full} total={coverageTotalGames} color="green" />
                <DistributionRow label="Partial" count={picsData.platformStats.controllerSupport.partial} total={coverageTotalGames} color="yellow" />
                <DistributionRow label="None" count={picsData.platformStats.controllerSupport.none} total={coverageTotalGames} color="gray" />
              </div>
            </Card>
          </div>
        )}

        {/* Row 3: Genre Distribution - Horizontal Bar Chart */}
        {picsData && picsData.genres.length > 0 && (
          <GenreBarChart genres={picsData.genres} totalGames={coverageTotalGames} />
        )}

        {/* Row 4: Features + Franchises */}
        {picsData && (picsData.categories.length > 0 || picsData.franchises.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {picsData.categories.length > 0 && (
              <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
                <h3 className="text-body-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                  <Gamepad2 className="h-4 w-4 text-text-tertiary" />
                  Top Features
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {displayedFeatures.map((cat) => (
                    <span
                      key={cat.category_id}
                      className="px-2 py-1 rounded-md bg-surface-elevated border border-border-subtle text-caption text-text-secondary hover:border-border-muted transition-colors"
                    >
                      {cat.name}
                      <span className="ml-1.5 text-text-muted">{cat.game_count}</span>
                    </span>
                  ))}
                  {picsData.categories.length > FEATURE_LIMIT && (
                    <button
                      onClick={() => setFeaturesExpanded(!featuresExpanded)}
                      className="px-2 py-1 rounded text-caption text-accent-blue hover:bg-accent-blue/10 transition-colors"
                    >
                      {featuresExpanded ? 'Show less' : `+${picsData.categories.length - FEATURE_LIMIT} more`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {picsData.franchises.length > 0 && (
              <FranchisesCard franchises={picsData.franchises} />
            )}
          </div>
        )}

        {/* Row 5: Languages + Content Warnings */}
        {picsData && (picsData.languages.length > 0 || picsData.contentDescriptors.length > 0) && (
          <div className="flex flex-wrap gap-3">
            {picsData.languages.length > 0 && (
              <div className="flex-1 min-w-[200px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-caption text-text-tertiary mr-1">Languages:</span>
                  {displayedLanguages.map((lang) => (
                    <span
                      key={lang.language}
                      className="px-1.5 py-0.5 rounded text-caption bg-surface-elevated text-text-secondary"
                    >
                      {lang.language}
                      <span className="ml-1 text-text-muted">{lang.game_count}</span>
                    </span>
                  ))}
                  {picsData.languages.length > LANGUAGE_LIMIT && (
                    <button
                      onClick={() => setLanguagesExpanded(!languagesExpanded)}
                      className="px-1.5 py-0.5 rounded text-caption text-accent-blue hover:bg-accent-blue/10 transition-colors"
                    >
                      {languagesExpanded ? 'Show less' : `+${picsData.languages.length - LANGUAGE_LIMIT}`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {picsData.contentDescriptors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-caption text-text-tertiary">Warnings:</span>
                {picsData.contentDescriptors.map((descriptor) => (
                  <span
                    key={descriptor.descriptor_id}
                    className={`px-2 py-0.5 rounded text-caption font-medium ${
                      descriptor.severity === 'high'
                        ? 'bg-accent-red/15 text-accent-red'
                        : 'bg-accent-orange/15 text-accent-orange'
                    }`}
                  >
                    {descriptor.label}
                    <span className="ml-1.5 opacity-70">{descriptor.game_count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// GENRE BAR CHART - Horizontal bars for overlapping genre data
// ============================================================================

const GENRE_BAR_COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-cyan-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-orange-500',
  'bg-rose-500',
  'bg-pink-500',
];

interface GenreBarChartProps {
  genres: { genre_id: number; name: string; game_count: number | null; is_primary_count: number }[];
  totalGames: number;
}

function GenreBarChart({ genres, totalGames }: GenreBarChartProps) {
  return (
    <div className="p-4 rounded-lg border border-border-subtle bg-surface-raised">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-text-tertiary" />
        <h3 className="text-body-sm font-medium text-text-primary">Genre Distribution</h3>
        <span className="text-caption text-text-muted">(games can have multiple genres)</span>
      </div>
      <div className="space-y-2">
        {genres.slice(0, 8).map((genre, i) => {
          const percentage = totalGames > 0
            ? Math.round(((genre.game_count ?? 0) / totalGames) * 100)
            : 0;
          return (
            <div key={genre.genre_id} className="flex items-center gap-2 sm:gap-3">
              <div className="w-16 sm:w-24 text-caption text-text-secondary truncate" title={genre.name}>
                {genre.name}
              </div>
              <div className="flex-1 h-5 bg-surface-elevated rounded overflow-hidden">
                <motion.div
                  className={`h-full ${GENRE_BAR_COLORS[i]} rounded`}
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                />
              </div>
              <div className="w-12 sm:w-20 text-caption text-text-muted text-right">
                {percentage}%
                <span className="text-text-tertiary ml-1 hidden sm:inline">({genre.game_count})</span>
              </div>
            </div>
          );
        })}
        {genres.length > 8 && (
          <p className="text-caption text-text-muted pt-1">+{genres.length - 8} more genres</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// FRANCHISES CARD
// ============================================================================

interface FranchisesCardProps {
  franchises: { id: number; name: string; game_count: number | null }[];
}

function FranchisesCard({ franchises }: FranchisesCardProps) {
  return (
    <div className="p-3 rounded-md border border-accent-cyan/20 bg-accent-cyan/5">
      <h3 className="text-body-sm font-medium text-text-primary mb-2 flex items-center gap-2">
        <Layers className="h-4 w-4 text-accent-cyan" />
        Franchises
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {franchises.map((f) => (
          <span
            key={f.id}
            className="px-2 py-1 rounded-md bg-accent-cyan/10 border border-accent-cyan/20 text-caption text-accent-cyan font-medium"
          >
            {f.name}
            <span className="ml-1.5 opacity-70">{f.game_count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PlatformBar({ label, count, total }: { label: string; count: number; total: number }) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 text-body-sm text-text-secondary">{label}</div>
      <div className="flex-1 h-3 bg-surface-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-blue/60 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="w-12 text-body-sm text-text-tertiary text-right">{percentage}%</div>
    </div>
  );
}

function DistributionRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: 'green' | 'yellow' | 'red' | 'gray';
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const colorClasses = {
    green: 'bg-accent-green/15 text-accent-green',
    yellow: 'bg-accent-yellow/15 text-accent-yellow',
    red: 'bg-accent-red/15 text-accent-red',
    gray: 'bg-surface-elevated text-text-muted',
  };

  return (
    <div className="flex items-center justify-between">
      <span className={`px-2 py-0.5 rounded text-caption font-medium ${colorClasses[color]}`}>
        {label}
      </span>
      <span className="text-body-sm text-text-secondary">
        {count} <span className="text-text-muted">({percentage}%)</span>
      </span>
    </div>
  );
}

function GamesSection({
  id,
  apps,
  ccuSparklines,
}: {
  id: string;
  apps: PublisherApp[];
  ccuSparklines: Map<number, CCUSparklineData>;
}) {
  // Sort apps by total_reviews descending
  const sortedApps = [...apps].sort((a, b) => (b.total_reviews ?? 0) - (a.total_reviews ?? 0));

  return (
    <section>
      <SectionHeader title="Games" id={id} />
      {sortedApps.length > 0 ? (
        <div className="rounded-md border border-border-subtle overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between bg-surface-raised">
            <h3 className="text-body-sm font-medium text-text-primary">All Games</h3>
            <span className="text-caption text-text-tertiary">{sortedApps.length} games</span>
          </div>
          {/* Mobile: Card view */}
          <div className="md:hidden divide-y divide-border-subtle">
            {sortedApps.map((app) => (
              <Link
                key={app.appid}
                href={`/apps/${app.appid}`}
                className="block p-3 bg-surface-raised hover:bg-surface-elevated transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-body-sm font-medium text-text-primary">{app.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <TypeBadge type={app.type as 'game' | 'dlc' | 'demo' | 'mod' | 'video'} />
                      {app.is_delisted && (
                        <span className="px-1 py-0.5 rounded text-caption-sm bg-accent-red/15 text-accent-red">
                          Delisted
                        </span>
                      )}
                    </div>
                  </div>
                  {app.total_reviews && app.total_reviews > 0 && (
                    <ReviewScoreBadge
                      score={Math.round((app.positive_reviews ?? 0) / app.total_reviews * 100)}
                    />
                  )}
                </div>
                <div className="flex items-center gap-4 text-caption text-text-secondary">
                  <span>{formatNumber(app.total_reviews)} reviews</span>
                  <span>{formatOwners(app.owners_min, app.owners_max)}</span>
                  {app.trend_30d_direction && (
                    <TrendIndicator
                      direction={app.trend_30d_direction as 'up' | 'down' | 'stable'}
                      value={app.trend_30d_change_pct ?? undefined}
                      size="sm"
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
          {/* Desktop: Table view */}
          <div className="hidden md:block overflow-x-auto scrollbar-thin">
            <table className="w-full">
              <thead className="bg-surface-elevated">
                <tr>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Name</th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Type</th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Reviews</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Count</th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">CCU</th>
                  <th className="px-3 py-2 text-right text-caption font-medium text-text-tertiary">Owners</th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">30d Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {sortedApps.map((app) => (
                  <tr key={app.appid} className="bg-surface-raised hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/apps/${app.appid}`}
                          className="text-body-sm font-medium text-text-primary hover:text-accent-blue transition-colors"
                        >
                          {app.name}
                        </Link>
                        {app.is_delisted && (
                          <span className="px-1 py-0.5 rounded text-caption-sm bg-accent-red/15 text-accent-red">
                            Delisted
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <TypeBadge type={app.type as 'game' | 'dlc' | 'demo' | 'mod' | 'video'} />
                    </td>
                    <td className="px-3 py-2">
                      {app.total_reviews && app.total_reviews > 0 ? (
                        <ReviewScoreBadge
                          score={Math.round((app.positive_reviews ?? 0) / app.total_reviews * 100)}
                        />
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-caption text-text-secondary">
                      {formatNumber(app.total_reviews)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {ccuSparklines.get(app.appid)?.dataPoints && ccuSparklines.get(app.appid)!.dataPoints.length > 0 && (
                          <TrendSparkline
                            data={ccuSparklines.get(app.appid)!.dataPoints}
                            trend={ccuSparklines.get(app.appid)!.trend}
                            height={20}
                            width={50}
                          />
                        )}
                        <span className="text-caption text-text-secondary">
                          {formatNumber(app.ccu_peak)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-caption text-text-secondary">
                      {formatOwners(app.owners_min, app.owners_max)}
                    </td>
                    <td className="px-3 py-2">
                      {app.trend_30d_direction ? (
                        <TrendIndicator
                          direction={app.trend_30d_direction as 'up' | 'down' | 'stable'}
                          value={app.trend_30d_change_pct ?? undefined}
                          size="sm"
                        />
                      ) : (
                        <span className="text-text-muted">—</span>
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
          No games found for this publisher
        </p>
      )}
    </section>
  );
}

// ============================================================================
// REVIEWS SECTION - Fixed table layout with animations
// ============================================================================

function ReviewsSection({
  id,
  histogram,
  apps,
}: {
  id: string;
  histogram: ReviewHistogram[];
  apps: PublisherApp[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const histogramData = [...histogram].reverse().slice(-12).map((h) => ({
    month: formatMonthLabel(h.month_start),
    positive: h.recommendations_up,
    negative: h.recommendations_down,
  }));

  // Prepare game data for the aggregated popover
  const gameReviewData = apps
    .filter((app) => app.total_reviews && app.total_reviews > 0)
    .map((app) => ({
      appid: app.appid,
      name: app.name,
      positive_reviews: app.positive_reviews ?? 0,
      negative_reviews: app.negative_reviews ?? 0,
      total_reviews: app.total_reviews ?? 0,
    }));

  // Calculate aggregated review score
  const totalPositive = apps.reduce((sum, app) => sum + (app.positive_reviews ?? 0), 0);
  const totalNegative = apps.reduce((sum, app) => sum + (app.negative_reviews ?? 0), 0);
  const totalReviews = totalPositive + totalNegative;
  const aggregatedScore = totalReviews > 0 ? Math.round((totalPositive / totalReviews) * 100) : 0;

  const displayedHistogram = isExpanded ? histogram.slice(0, 12) : histogram.slice(0, 6);

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
                  <ReviewBreakdownPopover
                    games={gameReviewData}
                    trigger={
                      <div className="flex items-center gap-3 p-2 -m-2 rounded hover:bg-surface-elevated transition-colors cursor-pointer">
                        <ReviewScoreBadge score={aggregatedScore} />
                        <div>
                          <div className="text-body-sm font-medium text-text-primary">
                            {totalReviews.toLocaleString()} reviews
                          </div>
                          <div className="text-caption text-text-muted">
                            across {gameReviewData.length} games
                          </div>
                        </div>
                      </div>
                    }
                    title="Overall Review Breakdown"
                  />
                  <div className="flex-1 min-w-[200px] max-w-md">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-caption text-accent-green">{totalPositive.toLocaleString()} positive</span>
                      <span className="text-caption text-text-muted">·</span>
                      <span className="text-caption text-accent-red">{totalNegative.toLocaleString()} negative</span>
                    </div>
                    <RatioBar positive={totalPositive} negative={totalNegative} height={10} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Monthly Distribution Chart */}
          <motion.div variants={itemVariants}>
            <div className="p-4 rounded-md border border-border-subtle bg-surface-raised">
              <h3 className="text-body-sm font-medium text-text-primary mb-3">Monthly Distribution</h3>
              <StackedBarChart
                data={histogramData}
                xKey="month"
                positiveKey="positive"
                negativeKey="negative"
                height={160}
              />
            </div>
          </motion.div>

          {/* Monthly Breakdown Table */}
          <motion.div variants={itemVariants}>
            <div className="rounded-md border border-border-subtle overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised">
                <h3 className="text-body-sm font-medium text-text-primary">Monthly Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-elevated">
                    <tr>
                      <th className="px-4 py-3 text-left text-caption font-medium text-text-tertiary w-24">Month</th>
                      <th className="px-4 py-3 text-right text-caption font-medium text-text-tertiary w-28">Positive</th>
                      <th className="px-4 py-3 text-right text-caption font-medium text-text-tertiary w-28">Negative</th>
                      <th className="px-4 py-3 text-right text-caption font-medium text-text-tertiary w-24">Total</th>
                      <th className="px-4 py-3 text-right text-caption font-medium text-text-tertiary w-20">Score</th>
                      <th className="px-4 py-3 text-caption font-medium text-text-tertiary w-40">Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    <AnimatePresence mode="popLayout">
                      {displayedHistogram.map((h) => {
                        const total = h.recommendations_up + h.recommendations_down;
                        const ratio = total > 0 ? (h.recommendations_up / total * 100) : 0;
                        const monthLabel = formatMonthLabel(h.month_start);

                        return (
                          <motion.tr
                            key={h.month_start}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="bg-surface-raised hover:bg-surface-elevated transition-colors"
                          >
                            <td className="px-4 py-3 text-body-sm text-text-primary font-medium">
                              {monthLabel}
                            </td>
                            <td className="px-4 py-3 text-right text-body-sm text-accent-green">
                              {h.recommendations_up.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-body-sm text-accent-red">
                              {h.recommendations_down.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-body-sm text-text-secondary">
                              {total.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-body-sm text-text-secondary">
                              {ratio.toFixed(0)}%
                            </td>
                            <td className="px-4 py-3">
                              <RatioBar positive={h.recommendations_up} negative={h.recommendations_down} />
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

              {/* Expand/Collapse Button */}
              {histogram.length > 6 && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-full px-4 py-3 text-body-sm text-accent-blue hover:bg-surface-elevated transition-colors flex items-center justify-center gap-2 border-t border-border-subtle"
                >
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </motion.span>
                  {isExpanded ? 'Show Less' : `Show ${Math.min(histogram.length - 6, 6)} More Months`}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <p className="text-body-sm text-text-muted p-4 rounded-md border border-border-subtle bg-surface-raised">
          No review histogram data available
        </p>
      )}
    </section>
  );
}

function NetworkSection({
  id,
  relatedDevelopers,
  similarPublishers,
}: {
  id: string;
  relatedDevelopers: RelatedDeveloper[];
  similarPublishers: SimilarPublisher[];
}) {
  return (
    <section>
      <SectionHeader title="Network" id={id} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Related Developers */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-text-tertiary" />
            <h3 className="text-body-sm font-medium text-text-primary">Related Developers</h3>
          </div>
          {relatedDevelopers.length > 0 ? (
            <div className="space-y-1">
              {relatedDevelopers.map((dev) => (
                <Link
                  key={dev.id}
                  href={`/developers/${dev.id}`}
                  className="flex items-center justify-between p-1.5 rounded hover:bg-surface-elevated transition-colors group"
                >
                  <span className="text-body-sm text-text-primary group-hover:text-accent-blue transition-colors">
                    {dev.name}
                  </span>
                  <span className="text-caption text-text-tertiary">
                    {dev.shared_apps} shared
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-caption text-text-muted">No related developers found</p>
          )}
        </Card>

        {/* Similar Publishers */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-4 w-4 text-text-tertiary" />
            <h3 className="text-body-sm font-medium text-text-primary">Similar Publishers</h3>
          </div>
          {similarPublishers.length > 0 ? (
            <div className="space-y-1">
              {similarPublishers.map((pub) => (
                <Link
                  key={pub.id}
                  href={`/publishers/${pub.id}`}
                  className="flex items-center justify-between p-1.5 rounded hover:bg-surface-elevated transition-colors group"
                >
                  <span className="text-body-sm text-text-primary group-hover:text-accent-blue transition-colors">
                    {pub.name}
                  </span>
                  <span className="text-caption text-text-tertiary">
                    {pub.game_count} games
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-caption text-text-muted">No similar publishers found</p>
          )}
        </Card>
      </div>
    </section>
  );
}
