import type { Metadata } from 'next';
import { runTigerQuery } from '@publisheriq/database';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { MetricCard, ReviewScoreBadge, TierBadge } from '@/components/data-display';
import { Card } from '@/components/ui';
import { Users, Layers, TrendingUp, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { AdvancedFilters } from '@/components/filters/AdvancedFilters';
import { isTigerReadConfigured } from '@/app/(main)/apps/lib/apps-queries';
import { TigerConfigRequired } from '@/app/(main)/apps/lib/tiger-config-required';

export const metadata: Metadata = {
  title: 'Developers',
};

export const dynamic = 'force-dynamic';

type SortField = 'name' | 'game_count' | 'first_game_release_date' | 'total_owners_max' | 'total_ccu_peak' | 'weighted_review_score' | 'estimated_revenue_usd' | 'games_trending_up';
type SortOrder = 'asc' | 'desc';

interface DeveloperWithMetrics {
  id: number;
  name: string;
  normalized_name: string;
  steam_vanity_url: string | null;
  first_game_release_date: string | null;
  game_count: number | null;
  total_owners_min: number;
  total_owners_max: number;
  total_ccu_peak: number;
  max_ccu_peak: number;
  total_reviews: number;
  weighted_review_score: number | null;
  estimated_revenue_usd: number;
  games_trending_up: number;
  games_trending_down: number;
  games_released_last_year: number;
  computed_at: string | null;
}

interface FilterParams {
  search?: string;
  sort: SortField;
  order: SortOrder;
  filter?: string;
  minOwners?: number;
  minCcu?: number;
  minScore?: number;
  minGames?: number;
  status?: 'active' | 'dormant';
}

async function getDevelopers(params: FilterParams): Promise<DeveloperWithMetrics[]> {
  const values: Array<string | number> = [];
  const where: string[] = [];
  const having: string[] = [];
  const sortSql: Record<SortField, string> = {
    estimated_revenue_usd: 'estimated_revenue_usd',
    first_game_release_date: 'first_game_release_date',
    game_count: 'game_count',
    games_trending_up: 'games_trending_up',
    name: 'name',
    total_ccu_peak: 'total_ccu_peak',
    total_owners_max: 'total_owners_max',
    weighted_review_score: 'weighted_review_score',
  };

  const addParam = (value: string | number) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (params.search?.trim()) {
    where.push(`d.name ILIKE ${addParam(`%${params.search.trim()}%`)}`);
  }

  const minGames = params.filter === 'prolific' ? 5 : params.minGames;
  if (typeof minGames === 'number' && Number.isFinite(minGames)) {
    having.push(`COUNT(DISTINCT a.appid) >= ${addParam(minGames)}`);
  }
  if (params.filter === 'recent' || params.status === 'active') {
    having.push(`COUNT(DISTINCT a.appid) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year') > 0`);
  } else if (params.status === 'dormant') {
    having.push(`COUNT(DISTINCT a.appid) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year') = 0`);
  }
  if (typeof params.minOwners === 'number' && Number.isFinite(params.minOwners)) {
    having.push(`COALESCE(SUM(ldm.owners_max), 0) >= ${addParam(params.minOwners)}`);
  }
  if (typeof params.minCcu === 'number' && Number.isFinite(params.minCcu)) {
    having.push(`COALESCE(SUM(ldm.ccu_peak), 0) >= ${addParam(params.minCcu)}`);
  }
  if (typeof params.minScore === 'number' && Number.isFinite(params.minScore)) {
    having.push(`CASE WHEN SUM(ldm.total_reviews) > 0 THEN ROUND((SUM(ldm.positive_reviews)::numeric / NULLIF(SUM(ldm.total_reviews), 0)) * 100, 2) ELSE NULL END >= ${addParam(params.minScore)}`);
  }

  const orderSql = params.order === 'asc' ? 'ASC' : 'DESC';
  const orderBy = sortSql[params.sort] ?? 'game_count';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';

  const { rows } = await runTigerQuery<DeveloperWithMetrics>(
    `
      SELECT
        d.id,
        d.name,
        d.normalized_name,
        d.steam_vanity_url,
        d.first_game_release_date,
        COUNT(DISTINCT a.appid)::integer AS game_count,
        COALESCE(SUM(ldm.owners_min), 0)::bigint AS total_owners_min,
        COALESCE(SUM(ldm.owners_max), 0)::bigint AS total_owners_max,
        COALESCE(SUM(ldm.ccu_peak), 0)::bigint AS total_ccu_peak,
        COALESCE(MAX(ldm.ccu_peak), 0)::integer AS max_ccu_peak,
        COALESCE(SUM(ldm.total_reviews), 0)::bigint AS total_reviews,
        CASE
          WHEN SUM(ldm.total_reviews) > 0
            THEN ROUND((SUM(ldm.positive_reviews)::numeric / NULLIF(SUM(ldm.total_reviews), 0)) * 100, 2)
          ELSE NULL
        END AS weighted_review_score,
        COALESCE(SUM((COALESCE(ldm.price_cents, a.current_price_cents, 0)::numeric / 100) * COALESCE(ldm.owners_midpoint, 0)), 0)::numeric AS estimated_revenue_usd,
        COUNT(DISTINCT a.appid) FILTER (WHERE trends.trend_30d_direction = 'up' OR trends.ccu_trend_7d_pct > 5)::integer AS games_trending_up,
        COUNT(DISTINCT a.appid) FILTER (WHERE trends.trend_30d_direction = 'down' OR trends.ccu_trend_7d_pct < -5)::integer AS games_trending_down,
        COUNT(DISTINCT a.appid) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year')::integer AS games_released_last_year,
        MAX(GREATEST(d.updated_at, COALESCE(trends.updated_at, d.updated_at))) AS computed_at
      FROM legacy.developers d
      LEFT JOIN legacy.app_developers ad ON ad.developer_id = d.id
      LEFT JOIN legacy.apps a ON a.appid = ad.appid
      LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
      LEFT JOIN metrics.app_trends trends ON trends.appid = a.appid
      ${whereSql}
      GROUP BY d.id, d.name, d.normalized_name, d.steam_vanity_url, d.first_game_release_date
      ${havingSql}
      ORDER BY ${orderBy} ${orderSql} NULLS LAST, d.name ASC
      LIMIT 100
    `,
    values
  );

  return rows;
}

async function getDeveloperStats() {
  const { rows } = await runTigerQuery<{ total: number; prolific: number; recentlyactive: number }>(
    `
      WITH developer_rollups AS (
        SELECT
          d.id,
          COUNT(DISTINCT ad.appid)::integer AS game_count,
          COUNT(DISTINCT ad.appid) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year')::integer AS recent_games
        FROM legacy.developers d
        LEFT JOIN legacy.app_developers ad ON ad.developer_id = d.id
        LEFT JOIN legacy.apps a ON a.appid = ad.appid
        GROUP BY d.id
      )
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE game_count >= 5)::integer AS prolific,
        COUNT(*) FILTER (WHERE recent_games > 0)::integer AS recentlyActive
      FROM developer_rollups
    `,
    []
  );

  return rows[0] ? {
    total: rows[0].total,
    prolific: rows[0].prolific,
    recentlyActive: rows[0].recentlyactive,
  } : { total: 0, prolific: 0, recentlyActive: 0 };
}

// Format helpers
function formatOwners(min: number, max: number): string {
  if (min === 0 && max === 0) return '—';

  const formatNum = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return n.toString();
  };

  if (min === max) return formatNum(max);

  return `${formatNum(min)} - ${formatNum(max)}`;
}

function formatCompactNumber(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString();
}

function formatRevenue(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000000000) return `$${(n / 1000000000).toFixed(1)}B`;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function SortHeader({
  field,
  label,
  currentSort,
  currentOrder,
  searchParams,
  className = '',
}: {
  field: SortField;
  label: string;
  currentSort: SortField;
  currentOrder: SortOrder;
  searchParams: URLSearchParams;
  className?: string;
}) {
  const isActive = currentSort === field;
  const nextOrder = isActive && currentOrder === 'desc' ? 'asc' : 'desc';
  const arrow = isActive ? (currentOrder === 'asc' ? ' ↑' : ' ↓') : '';

  // Build URL preserving other params
  const newParams = new URLSearchParams(searchParams);
  newParams.set('sort', field);
  newParams.set('order', nextOrder);

  return (
    <th className={`px-3 py-2 text-left text-caption font-medium text-text-tertiary ${className}`}>
      <Link
        href={`?${newParams.toString()}`}
        className={`hover:text-text-primary transition-colors ${isActive ? 'text-accent-primary' : ''}`}
      >
        {label}{arrow}
      </Link>
    </th>
  );
}

function TrendingBadge({ up, down }: { up: number; down: number }) {
  if (up === 0 && down === 0) return <span className="text-text-muted">—</span>;

  return (
    <div className="flex items-center gap-2 text-caption">
      {up > 0 && (
        <span className="inline-flex items-center gap-0.5 text-accent-green">
          <ChevronUp className="h-3 w-3" />
          {up}
        </span>
      )}
      {down > 0 && (
        <span className="inline-flex items-center gap-0.5 text-accent-red">
          <ChevronDown className="h-3 w-3" />
          {down}
        </span>
      )}
    </div>
  );
}

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    sort?: SortField;
    order?: SortOrder;
    filter?: string;
    minOwners?: string;
    minCcu?: string;
    minScore?: string;
    minGames?: string;
    status?: 'active' | 'dormant';
  }>;
}) {
  if (!isTigerReadConfigured()) {
    return <TigerConfigRequired />;
  }

  const params = await searchParams;
  const { search, filter, status } = params;
  const sort = params.sort ?? 'game_count';
  const order = params.order ?? 'desc';
  const minOwners = params.minOwners ? parseInt(params.minOwners) : undefined;
  const minCcu = params.minCcu ? parseInt(params.minCcu) : undefined;
  const minScore = params.minScore ? parseInt(params.minScore) : undefined;
  const minGames = params.minGames ? parseInt(params.minGames) : undefined;

  // Build URLSearchParams for passing to SortHeader
  const currentParams = new URLSearchParams();
  if (search) currentParams.set('search', search);
  if (filter) currentParams.set('filter', filter);
  if (status) currentParams.set('status', status);
  if (minOwners) currentParams.set('minOwners', minOwners.toString());
  if (minCcu) currentParams.set('minCcu', minCcu.toString());
  if (minScore) currentParams.set('minScore', minScore.toString());
  if (minGames) currentParams.set('minGames', minGames.toString());

  const hasAdvancedFilters = minOwners || minCcu || minScore || minGames || status;

  let developers: DeveloperWithMetrics[] = [];
  let stats = { total: 0, prolific: 0, recentlyActive: 0 };
  let fetchError: string | null = null;

  try {
    [developers, stats] = await Promise.all([
      getDevelopers({ search, sort, order, filter, minOwners, minCcu, minScore, minGames, status }),
      getDeveloperStats(),
    ]);
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
    console.error('Developers page error:', error);
  }

  if (fetchError) {
    return (
      <div className="p-6">
        <Card className="p-6 border-accent-red/50 bg-accent-red/10">
          <h2 className="text-subheading text-accent-red mb-2">Error Loading Developers</h2>
          <p className="text-body text-text-secondary mb-4">
            There was an error fetching developer data. This might be due to missing database migrations.
          </p>
          <pre className="p-4 bg-surface-raised rounded-lg text-caption text-text-muted overflow-x-auto">
            {fetchError}
          </pre>
          <p className="mt-4 text-body-sm text-text-tertiary">
            Ensure the following migrations have been applied:
          </p>
          <ul className="list-disc list-inside text-body-sm text-text-tertiary mt-2">
            <li>20251228100000_add_developer_metrics_view.sql</li>
            <li>20251228100001_add_publisher_metrics_view.sql</li>
            <li>20251228100002_add_metrics_refresh_function.sql</li>
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Developers"
        description={`Browse Steam developers (${stats.total.toLocaleString()} total)`}
      />

      {/* Stats Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total developers"
          value={stats.total}
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          label="Prolific (5+ games)"
          value={stats.prolific}
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="Recently active"
          value={stats.recentlyActive}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* Search & Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <form className="flex-1">
          <div className="relative">
            <input
              type="text"
              name="search"
              defaultValue={search}
              placeholder="Search developers by name..."
              className="w-full h-10 rounded-md bg-surface-elevated border border-border-muted px-4 pl-10 text-body text-text-primary placeholder:text-text-muted transition-colors hover:border-border-prominent focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </form>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/developers"
            className={`px-3 py-2 rounded-md text-body-sm font-medium transition-colors ${
              !filter && !hasAdvancedFilters
                ? 'bg-accent-primary text-white'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border-subtle'
            }`}
          >
            All
          </Link>
          <Link
            href="/developers?filter=prolific"
            className={`px-3 py-2 rounded-md text-body-sm font-medium transition-colors ${
              filter === 'prolific'
                ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border-subtle'
            }`}
          >
            Prolific
          </Link>
          <Link
            href="/developers?status=active"
            className={`px-3 py-2 rounded-md text-body-sm font-medium transition-colors ${
              status === 'active'
                ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border-subtle'
            }`}
          >
            Active
          </Link>
          <Link
            href="/developers?minOwners=100000"
            className={`px-3 py-2 rounded-md text-body-sm font-medium transition-colors ${
              minOwners && minOwners >= 100000
                ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border-subtle'
            }`}
          >
            100K+ Owners
          </Link>
          <Link
            href="/developers?minScore=80"
            className={`px-3 py-2 rounded-md text-body-sm font-medium transition-colors ${
              minScore && minScore >= 80
                ? 'bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/30'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border-subtle'
            }`}
          >
            80%+ Reviews
          </Link>
        </div>
      </div>

      {/* Advanced Filters Row */}
      <AdvancedFilters
        basePath="/developers"
        filters={[
          {
            name: 'minOwners',
            label: 'Min Owners',
            options: [
              { value: '', label: 'Any' },
              { value: '1000', label: '1K+' },
              { value: '10000', label: '10K+' },
              { value: '100000', label: '100K+' },
              { value: '1000000', label: '1M+' },
              { value: '10000000', label: '10M+' },
            ],
          },
          {
            name: 'minCcu',
            label: 'Min CCU Peak',
            options: [
              { value: '', label: 'Any' },
              { value: '100', label: '100+' },
              { value: '1000', label: '1K+' },
              { value: '10000', label: '10K+' },
              { value: '100000', label: '100K+' },
            ],
          },
          {
            name: 'minScore',
            label: 'Min Review Score',
            options: [
              { value: '', label: 'Any' },
              { value: '50', label: '50%+' },
              { value: '70', label: '70%+' },
              { value: '80', label: '80%+' },
              { value: '90', label: '90%+' },
              { value: '95', label: '95%+' },
            ],
          },
          {
            name: 'minGames',
            label: 'Min Games',
            options: [
              { value: '', label: 'Any' },
              { value: '2', label: '2+' },
              { value: '5', label: '5+' },
              { value: '10', label: '10+' },
              { value: '25', label: '25+' },
              { value: '50', label: '50+' },
            ],
          },
          {
            name: 'status',
            label: 'Activity Status',
            options: [
              { value: '', label: 'Any' },
              { value: 'active', label: 'Active (released in last year)' },
              { value: 'dormant', label: 'Dormant' },
            ],
          },
        ]}
      />

      {developers.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-surface-overlay flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-text-tertiary" />
          </div>
          <h3 className="text-subheading text-text-primary">No developers found</h3>
          <p className="mt-2 text-body-sm text-text-secondary">
            {search || hasAdvancedFilters
              ? 'Try adjusting your filters'
              : 'Run the Storefront sync to populate developers'}
          </p>
        </Card>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-2">
            {developers.map((developer) => (
              <Link key={developer.id} href={`/developers/${developer.id}`}>
                <Card variant="interactive" padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="text-body font-medium text-text-primary">
                      {developer.name}
                    </span>
                    <div className="flex gap-1.5">
                      {(developer.game_count ?? 0) >= 5 && (
                        <span className="px-1.5 py-0.5 rounded text-caption bg-accent-cyan/15 text-accent-cyan">
                          Prolific
                        </span>
                      )}
                      {developer.games_released_last_year > 0 && (
                        <TierBadge tier="active" />
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-body-sm">
                    <div>
                      <p className="text-caption text-text-tertiary">Games</p>
                      <p className="text-text-primary font-medium">{developer.game_count}</p>
                    </div>
                    <div>
                      <p className="text-caption text-text-tertiary">Owners</p>
                      <p className="text-text-primary">{formatOwners(developer.total_owners_min, developer.total_owners_max)}</p>
                    </div>
                    <div>
                      <p className="text-caption text-text-tertiary">Peak CCU</p>
                      <p className="text-text-primary">{formatCompactNumber(developer.total_ccu_peak)}</p>
                    </div>
                    <div>
                      <p className="text-caption text-text-tertiary">Review Score</p>
                      {developer.weighted_review_score !== null ? (
                        <ReviewScoreBadge score={developer.weighted_review_score} />
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto scrollbar-thin rounded-lg border border-border-subtle">
            <table className="w-full">
              <thead className="bg-surface-elevated sticky top-0 z-10">
                <tr>
                  <SortHeader field="name" label="Name" currentSort={sort} currentOrder={order} searchParams={currentParams} className="min-w-[200px]" />
                  <SortHeader field="game_count" label="Games" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <SortHeader field="total_owners_max" label="Owners" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <SortHeader field="total_ccu_peak" label="Peak CCU" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <SortHeader field="weighted_review_score" label="Reviews" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <SortHeader field="estimated_revenue_usd" label="Est. Revenue" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <SortHeader field="games_trending_up" label="Trending" currentSort={sort} currentOrder={order} searchParams={currentParams} />
                  <th className="px-3 py-2 text-left text-caption font-medium text-text-tertiary">Steam</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {developers.map((developer) => (
                  <tr key={developer.id} className="bg-surface-raised hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/developers/${developer.id}`}
                          className="text-body font-medium text-text-primary hover:text-accent-primary transition-colors"
                        >
                          {developer.name}
                        </Link>
                        {(developer.game_count ?? 0) >= 5 && (
                          <span className="px-1.5 py-0.5 rounded text-caption bg-accent-cyan/15 text-accent-cyan">
                            Prolific
                          </span>
                        )}
                        {developer.games_released_last_year > 0 && (
                          <TierBadge tier="active" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-secondary">
                      {(developer.game_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-secondary">
                      {formatOwners(developer.total_owners_min, developer.total_owners_max)}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-secondary">
                      {formatCompactNumber(developer.total_ccu_peak)}
                    </td>
                    <td className="px-3 py-2">
                      {developer.weighted_review_score !== null ? (
                        <ReviewScoreBadge score={developer.weighted_review_score} />
                      ) : (
                        <span className="text-text-muted text-body-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-secondary">
                      {formatRevenue(developer.estimated_revenue_usd)}
                    </td>
                    <td className="px-3 py-2">
                      <TrendingBadge up={developer.games_trending_up} down={developer.games_trending_down} />
                    </td>
                    <td className="px-3 py-2">
                      {developer.steam_vanity_url ? (
                        <a
                          href={`https://store.steampowered.com/developer/${developer.steam_vanity_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-body-sm text-accent-primary hover:text-accent-primary/80 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View
                        </a>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {developers.length === 100 && (
        <p className="mt-4 text-center text-body-sm text-text-tertiary">
          Showing first 100 results. Use filters to narrow down.
        </p>
      )}

      {developers[0]?.computed_at && (
        <p className="mt-2 text-center text-caption text-text-muted">
          Metrics last updated: {new Date(developers[0].computed_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
