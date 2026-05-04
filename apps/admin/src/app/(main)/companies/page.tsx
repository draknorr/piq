import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/layout';
import { CompaniesPageClient } from './components/CompaniesPageClient';
import { getCompanies, getAggregateStats, getCompaniesByIds, isTigerReadConfigured } from './lib/companies-queries';
import { TigerConfigRequired } from '../apps/lib/tiger-config-required';
// Columns are parsed from URL in useCompaniesFilters hook
import type {
  Company,
  AggregateStats,
  CompanyType,
  SortField,
  SortOrder,
  CompaniesSearchParams,
  CompaniesFilterParams,
  TimePeriod,
  FilterMode,
  SteamDeckFilterValue,
  RelationshipFilterValue,
  StatusFilterValue,
  PlatformValue,
  CompanyIdentifier,
} from './lib/companies-types';

export const metadata: Metadata = {
  title: 'Companies | PublisherIQ',
  description: 'Browse Steam publishers and developers with unified metrics and analytics.',
};

export const dynamic = 'force-dynamic';

// Valid values for each param
const VALID_TYPES: CompanyType[] = ['all', 'publisher', 'developer'];

// Server-side sortable fields (passed to database query)
const SERVER_SORTS: SortField[] = [
  'name',
  'estimated_weekly_hours',
  'game_count',
  'total_owners',
  'total_ccu',
  'avg_review_score',
  'total_reviews',
  'revenue_estimate_cents',
  'games_trending_up',
  'ccu_growth_7d',
  'growth_30d',
  'review_velocity',
  'revenue_per_game',
  'owners_per_game',
  'reviews_per_1k_owners',
];

// All valid sort fields (including client-side sortable)
const VALID_SORTS: SortField[] = [
  ...SERVER_SORTS,
  // Client-side sortable (computed ratios and metrics)
  'revenue_per_game',
  'owners_per_game',
  'reviews_per_1k_owners',
  'growth_30d',
  'review_velocity',
];
const VALID_STATUS = ['active', 'dormant'] as const;
const VALID_PERIODS: TimePeriod[] = [
  'all', '2025', '2024', '2023',
  'last_12mo', 'last_6mo', 'last_90d', 'last_30d',
];
const VALID_FILTER_MODES: FilterMode[] = ['any', 'all'];
const VALID_PLATFORMS: PlatformValue[] = ['windows', 'mac', 'linux'];
const VALID_STEAM_DECK: SteamDeckFilterValue[] = ['verified', 'playable'];
const VALID_RELATIONSHIPS: RelationshipFilterValue[] = ['self_published', 'external_devs', 'multi_publisher'];

// Helper to parse numeric params
function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

// Helper to parse comma-separated number array
function parseNumberArray(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const ids = value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

// Helper to parse platforms
function parsePlatforms(value: string | undefined): PlatformValue[] | undefined {
  if (!value) return undefined;
  const platforms = value.split(',')
    .map((s) => s.trim().toLowerCase() as PlatformValue)
    .filter((p) => VALID_PLATFORMS.includes(p));
  return platforms.length > 0 ? platforms : undefined;
}

// Server-safe compare param parser (inlined to avoid client module taint)
const MAX_COMPARE = 5;
function parseCompareParam(param: string | null): CompanyIdentifier[] {
  if (!param) return [];

  const ids = param
    .split(',')
    .map((s) => {
      const match = s.trim().match(/^(pub|dev):(\d+)$/);
      if (!match) return null;
      return {
        type: (match[1] === 'pub' ? 'publisher' : 'developer') as 'publisher' | 'developer',
        id: parseInt(match[2], 10),
      };
    })
    .filter((id): id is CompanyIdentifier => id !== null);

  // Deduplicate and limit
  const seen = new Set<string>();
  const unique: CompanyIdentifier[] = [];
  for (const id of ids) {
    const key = `${id.type}:${id.id}`;
    if (!seen.has(key) && unique.length < MAX_COMPARE) {
      seen.add(key);
      unique.push(id);
    }
  }

  return unique;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<CompaniesSearchParams>;
}) {
  // Check TigerData read configuration
  if (!isTigerReadConfigured()) {
    return <TigerConfigRequired />;
  }

  // Parse and validate search params
  const params = await searchParams;

  const type: CompanyType = VALID_TYPES.includes(params.type as CompanyType)
    ? (params.type as CompanyType)
    : 'all';

  const sort: SortField = VALID_SORTS.includes(params.sort as SortField)
    ? (params.sort as SortField)
    : 'estimated_weekly_hours';

  const order: SortOrder = params.order === 'asc' ? 'asc' : 'desc';

  // Parse filter params
  const search = params.search || undefined;
  const preset = params.preset || undefined;
  // Note: filters param is parsed by useCompaniesFilters hook on client side

  // Metric filter params
  const minGames = parseNumber(params.minGames);
  const maxGames = parseNumber(params.maxGames);
  const minOwners = parseNumber(params.minOwners);
  const maxOwners = parseNumber(params.maxOwners);
  const minCcu = parseNumber(params.minCcu);
  const maxCcu = parseNumber(params.maxCcu);
  const minHours = parseNumber(params.minHours);
  const maxHours = parseNumber(params.maxHours);
  const minRevenue = parseNumber(params.minRevenue);
  const maxRevenue = parseNumber(params.maxRevenue);
  const minScore = parseNumber(params.minScore);
  const maxScore = parseNumber(params.maxScore);
  const minReviews = parseNumber(params.minReviews);
  const maxReviews = parseNumber(params.maxReviews);

  // Growth filter params
  const minGrowth7d = parseNumber(params.minGrowth7d);
  const maxGrowth7d = parseNumber(params.maxGrowth7d);
  const minGrowth30d = parseNumber(params.minGrowth30d);
  const maxGrowth30d = parseNumber(params.maxGrowth30d);

  // Time period param
  const period = VALID_PERIODS.includes(params.period as TimePeriod)
    ? (params.period as TimePeriod)
    : undefined;

  // Status param
  const status: StatusFilterValue = VALID_STATUS.includes(params.status as 'active' | 'dormant')
    ? (params.status as StatusFilterValue)
    : undefined;

  // M4b: Content filter params
  const genres = parseNumberArray(params.genres);
  const genreMode: FilterMode | undefined = VALID_FILTER_MODES.includes(params.genreMode as FilterMode)
    ? (params.genreMode as FilterMode)
    : undefined;
  const tags = parseNumberArray(params.tags);
  const categories = parseNumberArray(params.categories);
  const steamDeck: SteamDeckFilterValue = VALID_STEAM_DECK.includes(params.steamDeck as SteamDeckFilterValue)
    ? (params.steamDeck as SteamDeckFilterValue)
    : undefined;
  const platforms = parsePlatforms(params.platforms);
  const platformMode: FilterMode | undefined = VALID_FILTER_MODES.includes(params.platformMode as FilterMode)
    ? (params.platformMode as FilterMode)
    : undefined;

  // M4b: Relationship param
  const relationship: RelationshipFilterValue = VALID_RELATIONSHIPS.includes(params.relationship as RelationshipFilterValue)
    ? (params.relationship as RelationshipFilterValue)
    : undefined;

  // M5: Columns parsed from URL in useCompaniesFilters hook

  // M6a: Parse compare param
  const compareIds = parseCompareParam(params.compare || null);

  // For database query, use server-compatible sort (fall back to Hours for client-side sorts)
  const dbSort: SortField = SERVER_SORTS.includes(sort) ? sort : 'estimated_weekly_hours';

  // Build filter params for query
  const filterParams: CompaniesFilterParams = {
    type,
    sort: dbSort,
    order,
    limit: 50,
    search,
    // Metric filters
    minGames,
    maxGames,
    minOwners,
    maxOwners,
    minCcu,
    maxCcu,
    minHours,
    maxHours,
    minRevenue,
    maxRevenue,
    minScore,
    maxScore,
    minReviews,
    maxReviews,
    // Growth filters
    minGrowth7d,
    maxGrowth7d,
    minGrowth30d,
    maxGrowth30d,
    period,
    // M4b: Content filters
    genres,
    genreMode,
    tags,
    categories,
    steamDeck,
    platforms,
    platformMode,
    // Status & Relationship
    status,
    relationship,
  };

  // Fetch companies, aggregate stats, and compare companies in parallel
  let companies: Company[] = [];
  let compareCompanies: Company[] = [];
  let aggregateStats: AggregateStats = {
    total_companies: 0,
    total_games: 0,
    total_owners: 0,
    total_revenue: 0,
    avg_review_score: null,
    total_ccu: 0,
  };
  let fetchError: string | null = null;

  try {
    // Build list of promises
    const promises: [Promise<Company[]>, Promise<AggregateStats>, Promise<Company[]>?] = [
      getCompanies(filterParams),
      getAggregateStats(filterParams),
    ];

    // Only fetch compare companies if we have valid compare IDs (2+)
    if (compareIds.length >= 2) {
      promises.push(getCompaniesByIds(compareIds));
    }

    const results = await Promise.all(promises);
    companies = results[0];
    aggregateStats = results[1];
    compareCompanies = results[2] ?? [];
  } catch (error) {
    console.error('Failed to fetch companies:', error);
    fetchError = error instanceof Error ? error.message : 'Unknown error';
    companies = [];
  }

  // Show error state if fetch failed
  if (fetchError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Companies"
          description="Browse Steam publishers and developers"
        />
        <Card className="p-6 border-accent-red/50 bg-accent-red/10">
          <h2 className="text-subheading text-accent-red mb-2">
            Error Loading Companies
          </h2>
          <p className="text-body text-text-secondary mb-4">
            Failed to load company data. Please try again.
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
      <CompaniesPageClient
        initialData={companies}
        initialType={type}
        initialSort={sort}
        initialOrder={order}
        initialSearch={search || ''}
        initialPreset={preset || null}
        aggregateStats={aggregateStats}
        compareCompanies={compareCompanies}
      />
    </div>
  );
}
