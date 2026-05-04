import type { Metadata } from 'next';
import { runTigerQuery } from '@publisheriq/database';
import { getPortfolioPICSData } from '@/lib/portfolio-pics';
import { notFound } from 'next/navigation';
import { PageSubHeader } from '@/components/layout';
import { ReviewScoreBadge, RatioBar, TrendSparkline } from '@/components/data-display';
import { ExternalLink } from 'lucide-react';
import { DeveloperDetailSections } from './DeveloperDetailSections';
import { getCCUSparklinesBatch, getPortfolioCCUSparkline, type CCUSparklineData } from '@/lib/ccu-queries';
import { PinButton } from '@/components/PinButton';
import { getUser, createServerClient } from '@/lib/supabase/server';
import { getAppsByIds, isTigerReadConfigured } from '@/app/(main)/apps/lib/apps-queries';
import type { App as AppSummary } from '@/app/(main)/apps/lib/apps-types';
import { TigerConfigRequired } from '@/app/(main)/apps/lib/tiger-config-required';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isTigerReadConfigured()) return { title: 'Developer Details' };
  const { rows } = await runTigerQuery<{ name: string }>(
    `SELECT name FROM legacy.developers WHERE id = $1 LIMIT 1`,
    [Number(id)]
  );
  return { title: rows[0]?.name || 'Developer Details' };
}

interface Developer {
  id: number;
  name: string;
  normalized_name: string;
  steam_vanity_url: string | null;
  first_game_release_date: string | null;
  game_count: number | null;
  created_at: string;
  updated_at: string;
}

interface DeveloperApp {
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

interface RelatedPublisher {
  id: number;
  name: string;
  game_count: number | null;
  shared_apps: number;
}

interface SimilarDeveloper {
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
  games: ReviewHistogramGame[];
}

interface AppTrend {
  appid: number;
  trend_30d_direction: string | null;
  trend_30d_change_pct: number | null;
}

function mapAppSummaryToDeveloperApp(
  app: AppSummary,
  trend: AppTrend | null
): DeveloperApp {
  const totalReviews = app.total_reviews ?? 0;
  const positiveReviews = app.positive_reviews ?? 0;
  const unreleasedStates = new Set(['coming_soon', 'prerelease', 'unreleased']);

  return {
    appid: app.appid,
    name: app.name,
    type: app.type,
    is_free: app.is_free,
    release_date: app.release_date,
    is_released: app.release_state
      ? !unreleasedStates.has(app.release_state.toLowerCase())
      : true,
    is_delisted: app.is_delisted,
    review_score: app.positive_percentage ?? app.review_score ?? null,
    review_score_desc: null,
    total_reviews: totalReviews,
    positive_reviews: positiveReviews,
    negative_reviews: Math.max(totalReviews - positiveReviews, 0),
    owners_min: app.owners_min ?? null,
    owners_max: app.owners_max ?? null,
    ccu_peak: app.ccu_peak ?? null,
    trend_30d_direction: trend?.trend_30d_direction ?? null,
    trend_30d_change_pct: trend?.trend_30d_change_pct ?? null,
  };
}

async function getDeveloper(id: number): Promise<Developer | null> {
  const { rows } = await runTigerQuery<Developer>(
    `
      SELECT id, name, normalized_name, steam_vanity_url, first_game_release_date, game_count, created_at, updated_at
      FROM legacy.developers
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return rows[0] ?? null;
}

async function getDeveloperApps(developerId: number): Promise<DeveloperApp[]> {
  const { rows: appLinks } = await runTigerQuery<{ appid: number }>(
    `
      SELECT appid
      FROM legacy.app_developers
      WHERE developer_id = $1
    `,
    [developerId]
  );

  if (appLinks.length === 0) return [];

  const appIds = [...new Set(appLinks.map((appLink) => appLink.appid))];
  const [apps, trendsResult] = await Promise.all([
    getAppsByIds(appIds),
    runTigerQuery<AppTrend>(
      `
        SELECT appid, trend_30d_direction, trend_30d_change_pct
        FROM metrics.app_trends
        WHERE appid = ANY($1::int[])
      `,
      [appIds]
    ),
  ]);

  const trendsMap = new Map<number, AppTrend>();
  for (const trend of trendsResult.rows) {
    trendsMap.set(trend.appid, trend);
  }

  return apps.map((app) => mapAppSummaryToDeveloperApp(app, trendsMap.get(app.appid) ?? null));
}

async function getRelatedPublishers(developerId: number): Promise<RelatedPublisher[]> {
  const { rows } = await runTigerQuery<RelatedPublisher>(
    `
      SELECT
        p.id,
        p.name,
        p.game_count,
        COUNT(DISTINCT ap.appid)::integer AS shared_apps
      FROM legacy.app_developers ad
      JOIN legacy.app_publishers ap ON ap.appid = ad.appid
      JOIN legacy.publishers p ON p.id = ap.publisher_id
      WHERE ad.developer_id = $1
      GROUP BY p.id, p.name, p.game_count
      ORDER BY shared_apps DESC, p.game_count DESC NULLS LAST, p.name
      LIMIT 10
    `,
    [developerId]
  );

  return rows;
}

async function getDeveloperTags(developerId: number): Promise<{ tag: string; count: number }[]> {
  const { rows } = await runTigerQuery<{ tag: string; count: number }>(
    `
      SELECT
        st.name AS tag,
        COUNT(DISTINCT ast.appid)::integer AS count
      FROM legacy.app_developers ad
      JOIN legacy.app_steam_tags ast ON ast.appid = ad.appid
      JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
      WHERE ad.developer_id = $1
      GROUP BY st.name
      ORDER BY count DESC, st.name
      LIMIT 20
    `,
    [developerId]
  );

  return rows;
}

async function getDeveloperReviewHistogram(developerId: number): Promise<ReviewHistogram[]> {
  const { rows: data } = await runTigerQuery<{
    appid: number;
    name: string;
    month_start: string;
    recommendations_up: number;
    recommendations_down: number;
  }>(
    `
      SELECT
        rh.appid,
        a.name,
        rh.month_start,
        rh.recommendations_up,
        rh.recommendations_down
      FROM legacy.app_developers ad
      JOIN metrics.review_histogram rh ON rh.appid = ad.appid
      JOIN legacy.apps a ON a.appid = rh.appid
      WHERE ad.developer_id = $1
      ORDER BY rh.month_start DESC
    `,
    [developerId]
  );

  if (data.length === 0) return [];

  // Validate ISO date format (YYYY-MM-DD or YYYY-MM)
  const isoDatePattern = /^\d{4}-\d{2}(?:-\d{2})?$/;
  const rowsByAppName = new Map(data.map((row) => [row.appid, row.name]));

  // Aggregate by month while preserving per-game data
  const monthMap = new Map<string, {
    up: number;
    down: number;
    games: Map<number, { up: number; down: number }>;
  }>();

  for (const h of data) {
    // Skip entries with invalid month_start format (bad data like "Since jun 25")
    if (!isoDatePattern.test(h.month_start)) {
      continue;
    }

    // Normalize to YYYY-MM for grouping (e.g., "2025-12" from "2025-12-15")
    const monthKey = h.month_start.substring(0, 7);
    const existing = monthMap.get(monthKey) ?? { up: 0, down: 0, games: new Map() };

    // Update totals
    existing.up += h.recommendations_up;
    existing.down += h.recommendations_down;

    // Update per-game data
    const gameData = existing.games.get(h.appid) ?? { up: 0, down: 0 };
    gameData.up += h.recommendations_up;
    gameData.down += h.recommendations_down;
    existing.games.set(h.appid, gameData);

    monthMap.set(monthKey, existing);
  }

  return [...monthMap.entries()]
    .map(([month_start, { up, down, games }]) => ({
      month_start,
      recommendations_up: up,
      recommendations_down: down,
      games: [...games.entries()]
        .map(([appid, data]) => ({
          appid,
          name: rowsByAppName.get(appid) ?? `App ${appid}`,
          recommendations_up: data.up,
          recommendations_down: data.down,
        }))
        .sort((a, b) => b.recommendations_down - a.recommendations_down), // Sort by negative reviews
    }))
    .sort((a, b) => b.month_start.localeCompare(a.month_start))
    .slice(0, 24);
}

async function getSimilarDevelopers(developerId: number, topTags: string[]): Promise<SimilarDeveloper[]> {
  if (topTags.length === 0) return [];

  const { rows } = await runTigerQuery<SimilarDeveloper>(
    `
      WITH selected_tags AS (
        SELECT tag_id
        FROM legacy.steam_tags
        WHERE name = ANY($2::text[])
      ),
      tagged_apps AS (
        SELECT DISTINCT ast.appid
        FROM legacy.app_steam_tags ast
        JOIN selected_tags st ON st.tag_id = ast.tag_id
      )
      SELECT
        d.id,
        d.name,
        d.game_count,
        COUNT(DISTINCT ad.appid)::integer AS shared_tags
      FROM tagged_apps ta
      JOIN legacy.app_developers ad ON ad.appid = ta.appid
      JOIN legacy.developers d ON d.id = ad.developer_id
      WHERE d.id <> $1
      GROUP BY d.id, d.name, d.game_count
      ORDER BY shared_tags DESC, d.game_count DESC NULLS LAST, d.name
      LIMIT 10
    `,
    [developerId, topTags.slice(0, 5)]
  );

  return rows;
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

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

export default async function DeveloperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isTigerReadConfigured()) {
    return <TigerConfigRequired />;
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (isNaN(id)) {
    notFound();
  }

  const [developer, apps, relatedPublishers, tags, histogram, picsData] = await Promise.all([
    getDeveloper(id),
    getDeveloperApps(id),
    getRelatedPublishers(id),
    getDeveloperTags(id),
    getDeveloperReviewHistogram(id),
    getPortfolioPICSData('developer', id),
  ]);

  if (!developer) {
    notFound();
  }

  // Check if user is authenticated and if this developer is pinned
  // Note: user_pins table is created by migration 20260112000001_add_personalization.sql
  const user = await getUser();
  let pinStatus: { id: string } | null = null;
  if (user) {
    const supabaseAuth = await createServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAuth as any)
      .from('user_pins')
      .select('id')
      .eq('user_id', user.id)
      .eq('entity_type', 'developer')
      .eq('entity_id', developer.id)
      .maybeSingle();
    pinStatus = data;
  }

  // Get app IDs for CCU queries and similar developers
  const appIds = apps.map(a => a.appid);
  const topTagNames = tags.slice(0, 5).map(t => t.tag);

  // Fetch CCU sparklines and similar developers in parallel
  const [similarDevelopers, ccuSparklines, portfolioCCU] = await Promise.all([
    getSimilarDevelopers(id, topTagNames),
    appIds.length > 0 ? getCCUSparklinesBatch(appIds, '7d') : Promise.resolve(new Map<number, CCUSparklineData>()),
    appIds.length > 0 ? getPortfolioCCUSparkline(appIds, '7d') : Promise.resolve({ dataPoints: [], trend: 'stable' as const, growthPct: null, peakCCU: null }),
  ]);

  // Calculate aggregated metrics
  const totalReviews = apps.reduce((sum, a) => sum + (a.total_reviews ?? 0), 0);
  const totalPositive = apps.reduce((sum, a) => sum + (a.positive_reviews ?? 0), 0);
  const totalNegative = apps.reduce((sum, a) => sum + (a.negative_reviews ?? 0), 0);
  const avgScore = totalReviews > 0 ? Math.round((totalPositive / totalReviews) * 100) : null;

  const totalOwnersMin = apps.reduce((sum, a) => sum + (a.owners_min ?? 0), 0);
  const totalOwnersMax = apps.reduce((sum, a) => sum + (a.owners_max ?? 0), 0);
  const totalCCU = apps.reduce((sum, a) => sum + (a.ccu_peak ?? 0), 0);

  const gamesWithReviews = apps.filter(a => a.total_reviews && a.total_reviews > 0).length;

  return (
    <div>
      {/* Header */}
      <PageSubHeader
        title={developer.name}
        backLink={{ label: 'Back to Developers', href: '/developers' }}
        actions={
          <div className="flex items-center gap-2">
            <PinButton
              entityType="developer"
              entityId={developer.id}
              displayName={developer.name}
              isAuthenticated={!!user}
              initialPinned={!!pinStatus}
              initialPinId={pinStatus?.id}
            />
            {developer.steam_vanity_url && (
              <a
                href={`https://store.steampowered.com/developer/${developer.steam_vanity_url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm font-medium text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-surface-overlay border border-border-subtle transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Steam
              </a>
            )}
          </div>
        }
      />

      {/* Developer meta */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-body text-text-secondary">
          <span className="font-medium text-text-primary">{developer.game_count}</span> games
        </span>
        {developer.first_game_release_date && (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="text-body text-text-tertiary">
              Since {new Date(developer.first_game_release_date).getFullYear()}
            </span>
          </>
        )}
        {(developer.game_count ?? 0) >= 5 && (
          <span className="px-2 py-0.5 rounded text-caption bg-accent-cyan/15 text-accent-cyan font-medium">
            Prolific Developer
          </span>
        )}
      </div>

      {/* Key aggregated metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
        <div className="col-span-2 p-3 rounded-md border border-border-subtle bg-surface-raised">
          <div className="flex items-center justify-between mb-1.5">
            {avgScore !== null ? (
              <ReviewScoreBadge score={avgScore} />
            ) : (
              <span className="text-text-muted text-body-sm">No reviews</span>
            )}
            <span className="text-caption text-text-tertiary">
              {gamesWithReviews} of {apps.length} games
            </span>
          </div>
          <div className="text-caption text-text-secondary mb-1.5">
            {formatNumber(totalPositive)} positive / {formatNumber(totalNegative)} negative
          </div>
          {totalPositive > 0 || totalNegative > 0 ? (
            <RatioBar positive={totalPositive} negative={totalNegative} />
          ) : null}
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Total Reviews</p>
          <p className="text-body font-semibold text-text-primary">{formatNumber(totalReviews)}</p>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Est. Owners</p>
          <p className="text-body font-semibold text-text-primary">{formatOwners(totalOwnersMin, totalOwnersMax)}</p>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <div className="flex items-center justify-between">
            <p className="text-caption text-text-tertiary">Total Peak CCU</p>
            {portfolioCCU.growthPct !== null && (
              <span className={`text-caption font-medium ${portfolioCCU.growthPct >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {portfolioCCU.growthPct >= 0 ? '+' : ''}{portfolioCCU.growthPct}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-body font-semibold text-text-primary">{formatNumber(totalCCU)}</p>
            <div className="hidden sm:block">
              <TrendSparkline data={portfolioCCU.dataPoints} trend={portfolioCCU.trend} height={24} width={60} />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Games</p>
          <p className="text-body font-semibold text-text-primary">{apps.length}</p>
        </div>
      </div>

      {/* All sections */}
      <DeveloperDetailSections
        developer={developer}
        apps={apps}
        relatedPublishers={relatedPublishers}
        tags={tags}
        histogram={histogram}
        similarDevelopers={similarDevelopers}
        picsData={picsData}
        ccuSparklines={ccuSparklines}
      />
    </div>
  );
}
