import type { Metadata } from 'next';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ConfigurationRequired } from '@/components/ConfigurationRequired';
import { notFound } from 'next/navigation';
import { PageSubHeader } from '@/components/layout';
import { TypeBadge, ReviewScoreBadge, RatioBar, TrendSparkline, CCUSourceBadge } from '@/components/data-display';
import { ExternalLink } from 'lucide-react';
import { AppDetailSections } from './AppDetailSections';
import { getAppDailyPeakSparkline } from '@/lib/ccu-queries';
import { PinButton } from '@/components/PinButton';
import { getUser, createServerClient } from '@/lib/supabase/server';
import { getAppsByIds } from '../lib/apps-queries';
import type { App as AppSummary } from '../lib/apps-types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ appid: string }> }): Promise<Metadata> {
  const { appid } = await params;
  if (!isSupabaseConfigured()) return { title: 'App Details' };
  const supabase = getServiceSupabase();
  const { data: app } = await supabase.from('apps').select('name').eq('appid', Number(appid)).single();
  return { title: app?.name || 'App Details' };
}

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

export interface SteamDeckInfo {
  category: 'verified' | 'playable' | 'unsupported' | 'unknown';
  tests_passed: string[] | null;
  tests_failed: string[] | null;
}

export interface Genre {
  id: number;
  name: string;
  is_primary: boolean;
}

export interface Category {
  id: number;
  name: string;
}

export interface Franchise {
  id: number;
  name: string;
}

export interface SteamTag {
  id: number;
  name: string;
  rank: number;
}

export interface DLCApp {
  appid: number;
  name: string;
  type: string;
}

interface DailyMetric {
  metric_date: string;
  review_score: number | null;
  review_score_desc: string | null;
  total_reviews: number | null;
  positive_reviews: number | null;
  negative_reviews: number | null;
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

async function getAppSummary(appid: number): Promise<AppSummary | null> {
  try {
    const apps = await getAppsByIds([appid]);
    return apps[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch app summary (non-blocking):', error);
    return null;
  }
}

async function getAppDetails(appid: number) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .eq('appid', appid)
    .single();

  if (error || !data) return null;

  const appData = data as typeof data & { has_developer_info?: boolean };
  return {
    ...appData,
    has_developer_info: appData.has_developer_info ?? false,
  } as AppDetails;
}

async function getDevelopers(appid: number): Promise<{ id: number; name: string }[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_developers')
    .select('developers(id, name)')
    .eq('appid', appid);

  return (data ?? [])
    .map((d: { developers: { id: number; name: string } | null }) => d.developers)
    .filter((dev): dev is { id: number; name: string } => dev !== null);
}

async function getPublishers(appid: number): Promise<{ id: number; name: string }[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_publishers')
    .select('publishers(id, name)')
    .eq('appid', appid);

  return (data ?? [])
    .map((p: { publishers: { id: number; name: string } | null }) => p.publishers)
    .filter((pub): pub is { id: number; name: string } => pub !== null);
}

async function getTags(appid: number): Promise<{ tag: string; vote_count: number | null }[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_tags')
    .select('tag, vote_count')
    .eq('appid', appid)
    .order('vote_count', { ascending: false });

  return data ?? [];
}

async function getDailyMetrics(appid: number): Promise<DailyMetric[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('appid', appid)
    .order('metric_date', { ascending: false })
    .limit(30);

  if (!data) return [];

  // Cast ccu_source to the correct literal type
  return data.map(d => ({
    ...d,
    ccu_source: d.ccu_source as DailyMetric['ccu_source'],
  }));
}

async function getReviewHistogram(appid: number): Promise<ReviewHistogram[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('review_histogram')
    .select('month_start, recommendations_up, recommendations_down')
    .eq('appid', appid)
    .order('month_start', { ascending: false });

  if (!data) return [];

  // Validate ISO date format (YYYY-MM-DD or YYYY-MM)
  const isoDatePattern = /^\d{4}-\d{2}(?:-\d{2})?$/;

  // Aggregate by month to handle duplicate entries for the same month
  const monthMap = new Map<string, { up: number; down: number }>();

  for (const h of data) {
    // Skip entries with invalid month_start format
    if (!isoDatePattern.test(h.month_start)) {
      continue;
    }

    // Normalize to YYYY-MM for grouping
    const monthKey = h.month_start.substring(0, 7);
    const existing = monthMap.get(monthKey) ?? { up: 0, down: 0 };

    existing.up += h.recommendations_up;
    existing.down += h.recommendations_down;

    monthMap.set(monthKey, existing);
  }

  return [...monthMap.entries()]
    .map(([month_start, { up, down }]) => ({
      month_start,
      recommendations_up: up,
      recommendations_down: down,
    }))
    .sort((a, b) => b.month_start.localeCompare(a.month_start))
    .slice(0, 24);
}

async function getTrends(appid: number): Promise<AppTrends | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_trends')
    .select('*')
    .eq('appid', appid)
    .single();

  return data ?? null;
}

async function getSyncStatus(appid: number): Promise<SyncStatus | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('sync_status')
    .select('*')
    .eq('appid', appid)
    .single();

  if (!data) return null;

  const syncData = data as typeof data & { refresh_tier?: string; last_activity_at?: string; review_velocity_tier?: string };
  return {
    ...syncData,
    refresh_tier: syncData.refresh_tier ?? null,
    review_velocity_tier: (syncData.review_velocity_tier as SyncStatus['review_velocity_tier']) ?? null,
    last_activity_at: syncData.last_activity_at ?? null,
  } as SyncStatus;
}

async function getSteamDeckInfo(appid: number): Promise<SteamDeckInfo | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_steam_deck')
    .select('category, tests_passed, tests_failed')
    .eq('appid', appid)
    .single();

  return data as SteamDeckInfo | null;
}

async function getGenres(appid: number): Promise<Genre[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_genres')
    .select('is_primary, steam_genres(genre_id, name)')
    .eq('appid', appid)
    .order('is_primary', { ascending: false });

  type GenreRow = { is_primary: boolean; steam_genres: { genre_id: number; name: string } | null };
  return ((data ?? []) as unknown as GenreRow[])
    .map((g) =>
      g.steam_genres ? { id: g.steam_genres.genre_id, name: g.steam_genres.name, is_primary: g.is_primary ?? false } : null)
    .filter((genre): genre is Genre => genre !== null);
}

async function getCategories(appid: number): Promise<Category[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_categories')
    .select('steam_categories(category_id, name)')
    .eq('appid', appid);

  return (data ?? [])
    .map((c: { steam_categories: { category_id: number; name: string } | null }) =>
      c.steam_categories ? { id: c.steam_categories.category_id, name: c.steam_categories.name } : null)
    .filter((category): category is Category => category !== null);
}

async function getFranchises(appid: number): Promise<Franchise[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_franchises')
    .select('franchises(id, name)')
    .eq('appid', appid);

  return (data ?? [])
    .map((f: { franchises: { id: number; name: string } | null }) => f.franchises)
    .filter((franchise): franchise is Franchise => franchise !== null);
}

async function getDLCs(appid: number): Promise<DLCApp[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('apps')
    .select('appid, name, type')
    .eq('parent_appid', appid)
    .order('name');

  return (data ?? []) as DLCApp[];
}

async function getSteamTags(appid: number): Promise<SteamTag[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('app_steam_tags')
    .select('rank, steam_tags(tag_id, name)')
    .eq('appid', appid)
    .order('rank');

  type TagRow = { rank: number; steam_tags: { tag_id: number; name: string } | null };
  return ((data ?? []) as unknown as TagRow[])
    .map((t) =>
      t.steam_tags ? { id: t.steam_tags.tag_id, name: t.steam_tags.name, rank: t.rank } : null)
    .filter((tag): tag is SteamTag => tag !== null);
}

function formatPrice(cents: number | null, isFree: boolean): string {
  if (isFree) return 'Free';
  if (cents === null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
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

function formatPlaytime(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

function getAgeDays(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return null;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function getCoverageStatus(args: {
  present: boolean;
  lastSyncedAt?: string | null;
  staleAfterDays?: number;
}): DataCoverageStatus {
  if (!args.present) return 'missing';
  if (!args.lastSyncedAt || args.staleAfterDays === undefined) return 'ok';
  const ageDays = getAgeDays(args.lastSyncedAt);
  if (ageDays === null) return 'unknown';
  return ageDays > args.staleAfterDays ? 'stale' : 'ok';
}

function shouldPreferLatestReviewMetrics(
  appSummary: AppSummary | null,
  latestMetrics: DailyMetric | null,
  lastReviewsSync: string | null | undefined
): boolean {
  if (!latestMetrics) {
    return false;
  }

  const latestMetricDateMs = Date.parse(latestMetrics.metric_date);
  const appMetricDateMs = appSummary?.metric_date ? Date.parse(appSummary.metric_date) : Number.NaN;

  if (!Number.isNaN(latestMetricDateMs) && (Number.isNaN(appMetricDateMs) || latestMetricDateMs > appMetricDateMs)) {
    return true;
  }

  const lastReviewsSyncMs = lastReviewsSync ? Date.parse(lastReviewsSync) : Number.NaN;
  const appReviewsMissingOrZero =
    appSummary === null || appSummary.total_reviews === 0 || appSummary.positive_reviews === 0;

  return (
    appReviewsMissingOrZero &&
    !Number.isNaN(lastReviewsSyncMs) &&
    (Number.isNaN(appMetricDateMs) || lastReviewsSyncMs > appMetricDateMs)
  );
}

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ appid: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }

  const { appid: appidStr } = await params;
  const appid = parseInt(appidStr, 10);

  if (isNaN(appid)) {
    notFound();
  }

  const [
    app,
    appSummary,
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
    ccuSparkline,
  ] = await Promise.all([
    getAppDetails(appid),
    getAppSummary(appid),
    getDevelopers(appid),
    getPublishers(appid),
    getTags(appid),
    getDailyMetrics(appid),
    getReviewHistogram(appid),
    getTrends(appid),
    getSyncStatus(appid),
    getSteamDeckInfo(appid),
    getGenres(appid),
    getCategories(appid),
    getFranchises(appid),
    getDLCs(appid),
    getSteamTags(appid),
    getAppDailyPeakSparkline(appid, 7),
  ]);

  if (!app) {
    notFound();
  }

  // Check if user is authenticated and if this game is pinned
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
      .eq('entity_type', 'game')
      .eq('entity_id', app.appid)
      .maybeSingle();
    pinStatus = data;
  }

  const latestMetrics = metrics[0] ?? null;
  const preferLatestReviewMetrics = shouldPreferLatestReviewMetrics(
    appSummary,
    latestMetrics,
    syncStatus?.last_reviews_sync
  );
  const isFree = appSummary?.is_free ?? app.is_free;
  const discountPercent = appSummary?.current_discount_percent ?? app.current_discount_percent ?? 0;
  const priceCents = appSummary?.price_cents ?? app.current_price_cents;
  const totalReviews = preferLatestReviewMetrics
    ? latestMetrics?.total_reviews ?? appSummary?.total_reviews ?? null
    : appSummary?.total_reviews ?? latestMetrics?.total_reviews ?? null;
  const positiveReviews = preferLatestReviewMetrics
    ? latestMetrics?.positive_reviews ?? appSummary?.positive_reviews ?? null
    : appSummary?.positive_reviews ?? latestMetrics?.positive_reviews ?? null;
  const negativeReviews =
    latestMetrics?.negative_reviews ??
    (totalReviews !== null && positiveReviews !== null ? Math.max(totalReviews - positiveReviews, 0) : null);
  const reviewScorePct =
    totalReviews !== null && positiveReviews !== null && totalReviews > 0
      ? Math.round((positiveReviews / totalReviews) * 100)
      : null;
  const ownersMin = appSummary?.owners_min ?? latestMetrics?.owners_min ?? null;
  const ownersMax = appSummary?.owners_max ?? latestMetrics?.owners_max ?? null;
  const peakCcu = appSummary?.ccu_peak ?? latestMetrics?.ccu_peak ?? null;
  const avgPlaytimeForever = appSummary?.average_playtime_forever ?? latestMetrics?.average_playtime_forever ?? null;
  const avgPlaytime2Weeks = appSummary?.average_playtime_2weeks ?? latestMetrics?.average_playtime_2weeks ?? null;
  const growthPct =
    appSummary?.ccu_growth_7d_percent !== null && appSummary?.ccu_growth_7d_percent !== undefined
      ? Math.round(appSummary.ccu_growth_7d_percent)
      : ccuSparkline.growthPct;

  const dataCoverage: DataCoverage = {
    items: [
      {
        key: 'app_record',
        label: 'App record',
        status: 'ok',
        source: 'apps (table)',
        detail: `apps.appid = ${app.appid}`,
      },
      {
        key: 'canonical_metrics',
        label: 'Canonical metrics + computed insights',
        status: getCoverageStatus({ present: appSummary !== null }),
        source: 'get_apps_by_ids (RPC)',
        detail:
          appSummary
            ? `metric_date: ${appSummary.metric_date ?? '—'} · data_updated_at: ${appSummary.data_updated_at ?? '—'}`
            : app.is_delisted
              ? 'Not returned by RPC for delisted apps'
              : !app.is_released
                ? 'Not returned by RPC for unreleased apps'
                : 'No RPC result (check get_apps_by_ids)',
      },
      {
        key: 'storefront',
        label: 'Storefront pricing + discount',
        status: getCoverageStatus({
          present: isFree || priceCents !== null,
          lastSyncedAt: syncStatus?.last_storefront_sync ?? null,
          staleAfterDays: 7,
        }),
        source: 'apps (table) + sync_status.last_storefront_sync',
        detail: `price_cents: ${priceCents ?? '—'} · discount_percent: ${discountPercent} · last_storefront_sync: ${syncStatus?.last_storefront_sync ?? '—'}`,
      },
      {
        key: 'developers',
        label: 'Developers',
        status: getCoverageStatus({ present: developers.length > 0 }),
        source: 'app_developers → developers (tables)',
        detail: `count: ${developers.length}`,
      },
      {
        key: 'publishers',
        label: 'Publishers',
        status: getCoverageStatus({ present: publishers.length > 0 }),
        source: 'app_publishers → publishers (tables)',
        detail: `count: ${publishers.length}`,
      },
      {
        key: 'steam_deck',
        label: 'Steam Deck compatibility',
        status: getCoverageStatus({ present: steamDeck !== null }),
        source: 'app_steam_deck (table)',
        detail: steamDeck ? `category: ${steamDeck.category}` : 'No row in app_steam_deck',
      },
      {
        key: 'genres',
        label: 'Genres',
        status: getCoverageStatus({ present: genres.length > 0 }),
        source: 'app_genres → steam_genres (tables)',
        detail: `count: ${genres.length}`,
      },
      {
        key: 'categories',
        label: 'Features / categories',
        status: getCoverageStatus({ present: categories.length > 0 }),
        source: 'app_categories → steam_categories (tables)',
        detail: `count: ${categories.length}`,
      },
      {
        key: 'franchises',
        label: 'Franchises',
        status: getCoverageStatus({ present: franchises.length > 0 }),
        source: 'app_franchises → franchises (tables)',
        detail: `count: ${franchises.length}`,
      },
      {
        key: 'official_tags',
        label: 'Official Steam tags',
        status: getCoverageStatus({ present: steamTags.length > 0 }),
        source: 'app_steam_tags → steam_tags (tables)',
        detail: `count: ${steamTags.length}`,
      },
      {
        key: 'community_tags',
        label: 'Community tags',
        status: getCoverageStatus({ present: tags.length > 0 }),
        source: 'app_tags (table)',
        detail: `count: ${tags.length}`,
      },
      {
        key: 'dlcs',
        label: 'DLCs (children)',
        status: getCoverageStatus({ present: dlcs.length > 0 }),
        source: 'apps.parent_appid (table)',
        detail: `count: ${dlcs.length}`,
      },
      {
        key: 'trends',
        label: 'Trend analysis',
        status: getCoverageStatus({ present: trends !== null }),
        source: 'app_trends (table)',
        detail: trends ? 'app_trends row present' : 'No app_trends row',
      },
      {
        key: 'daily_metrics',
        label: 'Daily metrics (time-series)',
        status: getCoverageStatus({
          present: metrics.length > 0,
          lastSyncedAt: syncStatus?.last_steamspy_sync ?? null,
          staleAfterDays: 14,
        }),
        source: 'daily_metrics (table)',
        detail: `rows: ${metrics.length} · latest: ${metrics[0]?.metric_date ?? '—'} · last_steamspy_sync: ${syncStatus?.last_steamspy_sync ?? '—'} · last_reviews_sync: ${syncStatus?.last_reviews_sync ?? '—'}`,
      },
      {
        key: 'review_histogram',
        label: 'Review histogram',
        status: getCoverageStatus({
          present: histogram.length > 0,
          lastSyncedAt: syncStatus?.last_histogram_sync ?? null,
          staleAfterDays: 30,
        }),
        source: 'review_histogram (table)',
        detail: `rows: ${histogram.length} · latest: ${histogram[0]?.month_start ?? '—'} · last_histogram_sync: ${syncStatus?.last_histogram_sync ?? '—'}`,
      },
      {
        key: 'ccu_snapshots',
        label: 'CCU snapshots sparkline',
        status: getCoverageStatus({ present: ccuSparkline.dataPoints.length > 0 }),
        source: 'get_app_sparkline_data (RPC) ← ccu_snapshots (table)',
        detail:
          ccuSparkline.dataPoints.length > 0
            ? `points: ${ccuSparkline.dataPoints.length} (last 7 days)`
            : appSummary?.ccu_tier === 3 || appSummary?.ccu_tier === null || appSummary?.ccu_tier === undefined
              ? `No snapshots expected for CCU tier ${appSummary?.ccu_tier ?? '—'}`
              : `No snapshots found in last 7 days (CCU tier ${appSummary?.ccu_tier})`,
      },
      {
        key: 'sync_status',
        label: 'Sync status + errors',
        status: getCoverageStatus({ present: syncStatus !== null }),
        source: 'sync_status (table)',
        detail: syncStatus
          ? `is_syncable: ${syncStatus.is_syncable} · errors: ${syncStatus.consecutive_errors ?? 0} · last_error: ${syncStatus.last_error_message ?? '—'}`
          : 'No sync_status row',
      },
      {
        key: 'similarity',
        label: 'Similarity search index',
        status: 'unknown',
        source: 'Qdrant via /api/similarity',
        detail: 'Resolved client-side (configured vs indexed vs no results)',
      },
    ],
  };

  return (
    <div>
      {/* Header */}
      <PageSubHeader
        title={app.name}
        backLink={{ label: 'Back to Apps', href: '/apps' }}
        actions={
          <div className="flex items-center gap-2">
            <PinButton
              entityType="game"
              entityId={app.appid}
              displayName={app.name}
              isAuthenticated={!!user}
              initialPinned={!!pinStatus}
              initialPinId={pinStatus?.id}
            />
            <a
              href={`https://store.steampowered.com/app/${app.appid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm font-medium text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-surface-overlay border border-border-subtle transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Steam Store
            </a>
          </div>
        }
      />

      {/* App meta */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <TypeBadge type={app.type as 'game' | 'dlc' | 'demo' | 'mod' | 'video'} />
        {steamDeck && (
          <span className={`px-2 py-0.5 rounded text-caption font-medium ${
            steamDeck.category === 'verified' ? 'bg-accent-green/15 text-accent-green' :
            steamDeck.category === 'playable' ? 'bg-accent-yellow/15 text-accent-yellow' :
            steamDeck.category === 'unsupported' ? 'bg-accent-red/15 text-accent-red' :
            'bg-surface-elevated text-text-muted'
          }`}>
            {steamDeck.category === 'verified' ? 'Deck Verified' :
             steamDeck.category === 'playable' ? 'Deck Playable' :
             steamDeck.category === 'unsupported' ? 'Deck Unsupported' : 'Deck Unknown'}
          </span>
        )}
        {app.is_delisted && (
          <span className="px-2 py-0.5 rounded text-caption bg-accent-red/15 text-accent-red font-medium">
            Delisted
          </span>
        )}
        {!app.is_released && (
          <span className="px-2 py-0.5 rounded text-caption bg-accent-yellow/15 text-accent-yellow font-medium">
            Unreleased
          </span>
        )}
        <a
          href={`https://store.steampowered.com/app/${app.appid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary text-body-sm hover:text-accent-blue transition-colors"
        >
          ID: <span className="font-mono text-text-secondary hover:text-accent-blue">{app.appid}</span>
        </a>
        <span className="text-text-tertiary">·</span>
        <div className="flex items-center gap-2">
          <span className={`text-subheading font-semibold ${
            discountPercent > 0
              ? 'text-accent-green'
              : 'text-text-primary'
          }`}>
            {formatPrice(priceCents, isFree)}
          </span>
          {discountPercent > 0 && (
            <span className="px-2 py-0.5 rounded-md bg-accent-green/15 text-accent-green text-body-sm font-medium">
              -{discountPercent}%
            </span>
          )}
        </div>
      </div>

      {/* Key metrics row - compact */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
        <div className="col-span-3 md:col-span-2 p-3 rounded-md border border-border-subtle bg-surface-raised">
          <div className="flex items-center gap-2 mb-1.5">
            {reviewScorePct !== null ? (
              <ReviewScoreBadge
                score={reviewScorePct}
                description={latestMetrics.review_score_desc ?? undefined}
              />
            ) : (
              <span className="text-text-muted text-body-sm">No reviews</span>
            )}
          </div>
          <div className="text-caption text-text-secondary mb-1.5">
            {formatNumber(positiveReviews)} pos / {formatNumber(negativeReviews)} neg
          </div>
          {positiveReviews !== null && negativeReviews !== null && (
            <RatioBar positive={positiveReviews} negative={negativeReviews} />
          )}
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Owners</p>
          <p className="text-body font-semibold text-text-primary">{formatOwners(ownersMin, ownersMax)}</p>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <div className="flex items-center justify-between">
            <p className="text-caption text-text-tertiary">Peak CCU</p>
            {growthPct !== null && (
              <span className={`text-caption font-medium ${growthPct >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {growthPct >= 0 ? '+' : ''}{growthPct}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-body font-semibold text-text-primary">{formatNumber(peakCcu)}</p>
            {latestMetrics?.ccu_source && <CCUSourceBadge source={latestMetrics.ccu_source} />}
            <div className="hidden sm:block">
              <TrendSparkline data={ccuSparkline.dataPoints} trend={ccuSparkline.trend} height={24} width={60} />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Avg Playtime</p>
          <p className="text-body font-semibold text-text-primary">{formatPlaytime(avgPlaytimeForever)}</p>
        </div>
        <div className="p-3 rounded-md border border-border-subtle bg-surface-raised">
          <p className="text-caption text-text-tertiary">Recent 2w</p>
          <p className="text-body font-semibold text-text-primary">{formatPlaytime(avgPlaytime2Weeks)}</p>
        </div>
      </div>

      {/* All sections */}
      <AppDetailSections
        app={app}
        appSummary={appSummary}
        dataCoverage={dataCoverage}
        developers={developers}
        publishers={publishers}
        tags={tags}
        metrics={metrics}
        histogram={histogram}
        trends={trends}
        syncStatus={syncStatus}
        steamDeck={steamDeck}
        genres={genres}
        categories={categories}
        franchises={franchises}
        dlcs={dlcs}
        steamTags={steamTags}
      />
    </div>
  );
}
