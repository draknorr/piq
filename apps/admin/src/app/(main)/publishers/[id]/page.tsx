import type { Metadata } from 'next';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getPortfolioPICSData } from '@/lib/portfolio-pics';
import { ConfigurationRequired } from '@/components/ConfigurationRequired';
import { notFound } from 'next/navigation';
import { PageSubHeader } from '@/components/layout';
import { ReviewScoreBadge, RatioBar, TrendSparkline } from '@/components/data-display';
import { ExternalLink } from 'lucide-react';
import { PublisherDetailSections } from './PublisherDetailSections';
import { getCCUSparklinesBatch, getPortfolioCCUSparkline, type CCUSparklineData } from '@/lib/ccu-queries';
import { PinButton } from '@/components/PinButton';
import { getUser, createServerClient } from '@/lib/supabase/server';
import { getAppsByIds } from '@/app/(main)/apps/lib/apps-queries';
import type { App as AppSummary } from '@/app/(main)/apps/lib/apps-types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isSupabaseConfigured()) return { title: 'Publisher Details' };
  const supabase = getServiceSupabase();
  const { data: publisher } = await supabase.from('publishers').select('name').eq('id', Number(id)).single();
  return { title: publisher?.name || 'Publisher Details' };
}

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
  games: ReviewHistogramGame[];
}

interface AppTrend {
  appid: number;
  trend_30d_direction: string | null;
  trend_30d_change_pct: number | null;
}

function mapAppSummaryToPublisherApp(
  app: AppSummary,
  trend: AppTrend | null
): PublisherApp {
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

async function getPublisher(id: number): Promise<Publisher | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('publishers')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as Publisher;
}

async function getPublisherApps(publisherId: number): Promise<PublisherApp[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  // Get all appids for this publisher
  const { data: appLinks } = await supabase
    .from('app_publishers')
    .select('appid')
    .eq('publisher_id', publisherId);

  if (!appLinks || appLinks.length === 0) return [];

  const appIds = [...new Set(appLinks.map((appLink) => appLink.appid))];
  const [apps, trendsResult] = await Promise.all([
    getAppsByIds(appIds),
    supabase
      .from('app_trends')
      .select('appid, trend_30d_direction, trend_30d_change_pct')
      .in('appid', appIds),
  ]);

  const trendsMap = new Map<number, AppTrend>();
  for (const trend of trendsResult.data ?? []) {
    trendsMap.set(trend.appid, trend as AppTrend);
  }

  return apps.map((app) => mapAppSummaryToPublisherApp(app, trendsMap.get(app.appid) ?? null));
}

async function getRelatedDevelopers(publisherId: number): Promise<RelatedDeveloper[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  // Get all apps by this publisher
  const { data: pubApps } = await supabase
    .from('app_publishers')
    .select('appid')
    .eq('publisher_id', publisherId);

  if (!pubApps || pubApps.length === 0) return [];

  const appIds = pubApps.map(a => a.appid);

  // Get all developers for those apps
  const { data: devLinks } = await supabase
    .from('app_developers')
    .select('developer_id, appid')
    .in('appid', appIds);

  if (!devLinks || devLinks.length === 0) return [];

  // Count shared apps per developer
  const devCounts = new Map<number, number>();
  for (const link of devLinks) {
    devCounts.set(link.developer_id, (devCounts.get(link.developer_id) ?? 0) + 1);
  }

  const developerIds = [...devCounts.keys()];

  // Get developer details
  const { data: developers } = await supabase
    .from('developers')
    .select('id, name, game_count')
    .in('id', developerIds);

  if (!developers) return [];

  return developers
    .map((dev: { id: number; name: string; game_count: number | null }) => ({
      id: dev.id,
      name: dev.name,
      game_count: dev.game_count ?? 0,
      shared_apps: devCounts.get(dev.id) ?? 0,
    }))
    .sort((a, b) => b.shared_apps - a.shared_apps)
    .slice(0, 10);
}

async function getPublisherTags(publisherId: number): Promise<{ tag: string; count: number }[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  // Get all apps by this publisher
  const { data: appLinks } = await supabase
    .from('app_publishers')
    .select('appid')
    .eq('publisher_id', publisherId);

  if (!appLinks || appLinks.length === 0) return [];

  const appIds = appLinks.map(a => a.appid);

  // Get all tags for those apps from PICS data (app_steam_tags joined with steam_tags)
  const { data: tagData } = await supabase
    .from('app_steam_tags')
    .select('appid, steam_tags(name)')
    .in('appid', appIds);

  if (!tagData) return [];

  // Aggregate: count how many apps have each tag
  const tagCounts = new Map<string, number>();
  for (const t of tagData) {
    const tagName = (t.steam_tags as { name: string } | null)?.name;
    if (tagName) {
      tagCounts.set(tagName, (tagCounts.get(tagName) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

async function getPublisherReviewHistogram(publisherId: number): Promise<ReviewHistogram[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  // Get all apps by this publisher with their names
  const { data: appLinks } = await supabase
    .from('app_publishers')
    .select('appid, apps(name)')
    .eq('publisher_id', publisherId);

  if (!appLinks || appLinks.length === 0) return [];

  const appIds = appLinks.map(a => a.appid);
  const appNameMap = new Map<number, string>();
  for (const link of appLinks) {
    const appData = link.apps as { name: string } | null;
    if (appData) {
      appNameMap.set(link.appid, appData.name);
    }
  }

  // Get histogram data for all apps with appid included
  const { data } = await supabase
    .from('review_histogram')
    .select('appid, month_start, recommendations_up, recommendations_down')
    .in('appid', appIds)
    .order('month_start', { ascending: false });

  if (!data) return [];

  // Validate ISO date format (YYYY-MM-DD or YYYY-MM)
  const isoDatePattern = /^\d{4}-\d{2}(?:-\d{2})?$/;

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
          name: appNameMap.get(appid) ?? `App ${appid}`,
          recommendations_up: data.up,
          recommendations_down: data.down,
        }))
        .sort((a, b) => b.recommendations_down - a.recommendations_down), // Sort by negative reviews
    }))
    .sort((a, b) => b.month_start.localeCompare(a.month_start))
    .slice(0, 24);
}

async function getSimilarPublishers(publisherId: number, topTags: string[]): Promise<SimilarPublisher[]> {
  if (!isSupabaseConfigured() || topTags.length === 0) return [];
  const supabase = getServiceSupabase();

  // First, get tag_ids for the tag names from steam_tags
  const { data: steamTags } = await supabase
    .from('steam_tags')
    .select('tag_id')
    .in('name', topTags.slice(0, 5));

  if (!steamTags || steamTags.length === 0) return [];

  const tagIds = steamTags.map(t => t.tag_id);

  // Get apps that have these top tags from PICS data
  const { data: taggedApps } = await supabase
    .from('app_steam_tags')
    .select('appid')
    .in('tag_id', tagIds);

  if (!taggedApps || taggedApps.length === 0) return [];

  const appIds = [...new Set(taggedApps.map(t => t.appid))];

  // Find publishers of those apps (excluding current publisher)
  const { data: pubLinks } = await supabase
    .from('app_publishers')
    .select('publisher_id, appid')
    .in('appid', appIds)
    .neq('publisher_id', publisherId);

  if (!pubLinks || pubLinks.length === 0) return [];

  // Count shared apps per publisher
  const pubCounts = new Map<number, number>();
  for (const link of pubLinks) {
    pubCounts.set(link.publisher_id, (pubCounts.get(link.publisher_id) ?? 0) + 1);
  }

  const publisherIds = [...pubCounts.keys()].slice(0, 20);

  // Get publisher details
  const { data: publishers } = await supabase
    .from('publishers')
    .select('id, name, game_count')
    .in('id', publisherIds);

  if (!publishers) return [];

  return publishers
    .map((pub: { id: number; name: string; game_count: number | null }) => ({
      id: pub.id,
      name: pub.name,
      game_count: pub.game_count ?? 0,
      shared_tags: pubCounts.get(pub.id) ?? 0,
    }))
    .sort((a, b) => b.shared_tags - a.shared_tags)
    .slice(0, 10);
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

export default async function PublisherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (isNaN(id)) {
    notFound();
  }

  const [publisher, apps, relatedDevelopers, tags, histogram, picsData] = await Promise.all([
    getPublisher(id),
    getPublisherApps(id),
    getRelatedDevelopers(id),
    getPublisherTags(id),
    getPublisherReviewHistogram(id),
    getPortfolioPICSData('publisher', id),
  ]);

  if (!publisher) {
    notFound();
  }

  // Check if user is authenticated and if this publisher is pinned
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
      .eq('entity_type', 'publisher')
      .eq('entity_id', publisher.id)
      .maybeSingle();
    pinStatus = data;
  }

  // Get app IDs for CCU queries and similar publishers
  const appIds = apps.map(a => a.appid);
  const topTagNames = tags.slice(0, 5).map(t => t.tag);

  // Fetch CCU sparklines and similar publishers in parallel
  const [similarPublishers, ccuSparklines, portfolioCCU] = await Promise.all([
    getSimilarPublishers(id, topTagNames),
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
        title={publisher.name}
        backLink={{ label: 'Back to Publishers', href: '/publishers' }}
        actions={
          <div className="flex items-center gap-2">
            <PinButton
              entityType="publisher"
              entityId={publisher.id}
              displayName={publisher.name}
              isAuthenticated={!!user}
              initialPinned={!!pinStatus}
              initialPinId={pinStatus?.id}
            />
            {publisher.steam_vanity_url && (
              <a
                href={`https://store.steampowered.com/publisher/${publisher.steam_vanity_url}`}
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

      {/* Publisher meta */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-body text-text-secondary">
          <span className="font-medium text-text-primary">{publisher.game_count}</span> games
        </span>
        {publisher.first_game_release_date && (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="text-body text-text-tertiary">
              Since {new Date(publisher.first_game_release_date).getFullYear()}
            </span>
          </>
        )}
        {(publisher.game_count ?? 0) >= 10 && (
          <span className="px-2 py-0.5 rounded text-caption bg-accent-purple/15 text-accent-purple font-medium">
            Major Publisher
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
      <PublisherDetailSections
        publisher={publisher}
        apps={apps}
        relatedDevelopers={relatedDevelopers}
        tags={tags}
        histogram={histogram}
        similarPublishers={similarPublishers}
        picsData={picsData}
        ccuSparklines={ccuSparklines}
      />
    </div>
  );
}
