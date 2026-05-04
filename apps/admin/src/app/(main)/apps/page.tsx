import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/layout';
import { AppsPageClient } from './components/AppsPageClient';
import { getApps, getAggregateStats, getAppsByIdsWithFreshReviews, isTigerReadConfigured } from './lib/apps-queries';
import { parseCompareParam } from './lib/apps-compare-utils';
import { TigerConfigRequired } from './lib/tiger-config-required';
import type {
  App,
  AppType,
  SortField,
  SortOrder,
  AppsSearchParams,
  AppsFilterParams,
  AggregateStats,
} from './lib/apps-types';

export const metadata: Metadata = {
  title: 'Games | PublisherIQ',
  description: 'Browse and analyze Steam games, DLC, and demos.',
};

export const dynamic = 'force-dynamic';

// Valid values for each param
const VALID_TYPES: AppType[] = ['all', 'game', 'dlc', 'demo'];

// Server-side sortable fields
const VALID_SORTS: SortField[] = [
  'ccu_peak',
  'owners_midpoint',
  'total_reviews',
  'review_score',
  'price_cents',
  'ccu_growth_7d_percent',
  'ccu_growth_30d_percent',
  'momentum_score',
  'sentiment_delta',
  'velocity_7d',
  'active_player_pct',
  'review_rate',
  'value_score',
  'vs_publisher_avg',
  'release_date',
  'days_live',
];

export default async function AppsPage({
  searchParams,
}: {
  searchParams: Promise<AppsSearchParams>;
}) {
  if (!isTigerReadConfigured()) {
    return <TigerConfigRequired />;
  }

  // Parse and validate search params
  const params = await searchParams;

  const type: AppType = VALID_TYPES.includes(params.type as AppType)
    ? (params.type as AppType)
    : 'game';

  const sort: SortField = VALID_SORTS.includes(params.sort as SortField)
    ? (params.sort as SortField)
    : 'ccu_peak';

  const order: SortOrder = params.order === 'asc' ? 'asc' : 'desc';

  const search = params.search || undefined;

  // Parse numeric filter params
  const parseNumber = (val: string | undefined): number | undefined => {
    if (!val) return undefined;
    const n = parseFloat(val);
    return isNaN(n) ? undefined : n;
  };

  // Parse boolean filter params
  const parseBoolean = (val: string | undefined): boolean | undefined => {
    if (!val) return undefined;
    return val === 'true';
  };

  // Parse publisher size
  const publisherSizeParam = params.publisherSize;
  const publisherSize =
    publisherSizeParam === 'indie' || publisherSizeParam === 'mid' || publisherSizeParam === 'major'
      ? (publisherSizeParam as 'indie' | 'mid' | 'major')
      : undefined;

  // Build filter params for query
  const filterParams: AppsFilterParams = {
    type,
    sort,
    order,
    limit: 50,
    search,
    // Metric filters
    minCcu: parseNumber(params.minCcu),
    maxCcu: parseNumber(params.maxCcu),
    minOwners: parseNumber(params.minOwners),
    maxOwners: parseNumber(params.maxOwners),
    minReviews: parseNumber(params.minReviews),
    minScore: parseNumber(params.minScore),
    // Growth filters
    minGrowth7d: parseNumber(params.minGrowth7d),
    maxGrowth7d: parseNumber(params.maxGrowth7d),
    minMomentum: parseNumber(params.minMomentum),
    // Sentiment filters
    minSentimentDelta: parseNumber(params.minSentimentDelta),
    // Engagement filters
    minReviewRate: parseNumber(params.minReviewRate),
    minValueScore: parseNumber(params.minValueScore),
    // Relationship filters
    minVsPublisher: parseNumber(params.minVsPublisher),
    publisherSize,
    // Release filters
    minAge: parseNumber(params.minAge),
    maxAge: parseNumber(params.maxAge),
    earlyAccess: parseBoolean(params.earlyAccess),
    // Boolean filters
    isFree: parseBoolean(params.isFree),
    hasWorkshop: parseBoolean(params.hasWorkshop),
    // Discount filters
    minDiscount: parseNumber(params.minDiscount),
    // Platform filters
    steamDeck: params.steamDeck || undefined,
  };

  // Parse compare param (M6a)
  const compareAppIds = parseCompareParam(params.compare ?? null);

  // Fetch apps and aggregate stats in parallel
  let apps: App[] = [];
  let compareApps: App[] = [];
  let aggregateStats: AggregateStats = {
    total_games: 0,
    avg_ccu: null,
    avg_score: null,
    avg_momentum: null,
    trending_up_count: 0,
    trending_down_count: 0,
    sentiment_improving_count: 0,
    sentiment_declining_count: 0,
    avg_value_score: null,
  };
  let fetchError: string | null = null;

  try {
    // Fetch apps first (critical for page render).
    apps = await getApps(filterParams);

    // Fetch aggregate stats separately so a stats failure does not blank the page.
    try {
      aggregateStats = await getAggregateStats(filterParams);
    } catch (statsError) {
      console.error('Failed to fetch aggregate stats (non-blocking):', statsError);
    }

    // M6a: Fetch compare apps if valid (2-5 IDs)
    if (compareAppIds.length >= 2 && compareAppIds.length <= 5) {
      try {
        compareApps = await getAppsByIdsWithFreshReviews(compareAppIds);
      } catch (compareError) {
        console.error('Failed to fetch compare apps (non-blocking):', compareError);
        // Modal won't show if compareApps is empty
      }
    }
  } catch (error) {
    console.error('Failed to fetch apps:', error);
    fetchError = error instanceof Error ? error.message : 'Unknown error';
    apps = [];
  }

  // Show error state if fetch failed
  if (fetchError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Games"
          description="Browse and analyze Steam games"
        />
        <Card className="p-6 border-accent-red/50 bg-accent-red/10">
          <h2 className="text-subheading text-accent-red mb-2">
            Error Loading Games
          </h2>
          <p className="text-body text-text-secondary mb-4">
            Failed to load game data. Please try again.
          </p>
          <pre className="p-4 bg-surface-raised rounded-lg text-caption text-text-muted overflow-x-auto whitespace-pre-wrap">
            {fetchError}
          </pre>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AppsPageClient
        initialData={apps}
        initialType={type}
        initialSort={sort}
        initialOrder={order}
        initialSearch={search || ''}
        aggregateStats={aggregateStats}
        compareApps={compareApps}
      />
    </div>
  );
}
