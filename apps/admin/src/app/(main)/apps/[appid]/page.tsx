import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageSubHeader } from '@/components/layout';
import { TypeBadge, ReviewScoreBadge, RatioBar, TrendSparkline, CCUSourceBadge } from '@/components/data-display';
import { ExternalLink } from 'lucide-react';
import { AppDetailSections } from './AppDetailSections';
import { PinButton } from '@/components/PinButton';
import { getUser } from '@/lib/supabase/server';
import { runTigerQuery } from '@publisheriq/database';
import { getAppsByIds, isTigerReadConfigured, mapAppRpcRowToApp } from '../lib/apps-queries';
import { TigerConfigRequired } from '../lib/tiger-config-required';
import type { App as AppSummary } from '../lib/apps-types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ appid: string }> }): Promise<Metadata> {
  const { appid } = await params;
  if (!isTigerReadConfigured()) return { title: 'App Details' };
  const { rows } = await runTigerQuery<{ name: string }>(
    'SELECT name FROM legacy.apps WHERE appid = $1 LIMIT 1',
    [Number(appid)]
  );
  return { title: rows[0]?.name || 'App Details' };
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

interface AppProfileBundle {
  app: AppDetails | null;
  developers: { id: number; name: string }[];
  publishers: { id: number; name: string }[];
  steamDeck: SteamDeckInfo | null;
  genres: Genre[];
  categories: Category[];
  franchises: Franchise[];
  dlcs: DLCApp[];
  steamTags: SteamTag[];
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

function hasFreshSummaryMetrics(appSummary: AppSummary | null): boolean {
  return Boolean(appSummary?.metric_date || appSummary?.data_updated_at);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === 't' || value === '1';
  return fallback;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function getAppSummary(appid: number): Promise<AppSummary | null> {
  try {
    try {
      const { rows } = await runTigerQuery<Parameters<typeof mapAppRpcRowToApp>[0]>(
        'SELECT * FROM metrics.apps_page_projection WHERE appid = $1 LIMIT 1',
        [appid]
      );
      if (rows[0]) return mapAppRpcRowToApp(rows[0]);
    } catch {
      // Fall back for environments that have Tiger reads without the /apps projection materialized view.
    }

    const apps = await getAppsByIds([appid]);
    return apps[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch app summary (non-blocking):', error);
    return null;
  }
}

function mapAppDetails(appData: Record<string, unknown> | null | undefined, appid: number): AppDetails | null {
  if (!appData) return null;

  return {
    appid: toNumber(appData.appid) ?? appid,
    name: String(appData.name ?? ''),
    type: String(appData.type ?? 'game'),
    is_free: toBoolean(appData.is_free),
    release_date: toIso(appData.release_date),
    release_date_raw: typeof appData.release_date_raw === 'string' ? appData.release_date_raw : null,
    store_asset_mtime: toIso(appData.store_asset_mtime),
    has_workshop: toBoolean(appData.has_workshop),
    current_price_cents: toNumber(appData.current_price_cents),
    current_discount_percent: toNumber(appData.current_discount_percent),
    is_released: toBoolean(appData.is_released, true),
    is_delisted: toBoolean(appData.is_delisted),
    has_developer_info: toBoolean(appData.has_developer_info),
    controller_support: typeof appData.controller_support === 'string' ? appData.controller_support : null,
    pics_review_score: toNumber(appData.pics_review_score),
    pics_review_percentage: toNumber(appData.pics_review_percentage),
    metacritic_score: toNumber(appData.metacritic_score),
    metacritic_url: typeof appData.metacritic_url === 'string' ? appData.metacritic_url : null,
    platforms: typeof appData.platforms === 'string' ? appData.platforms : null,
    release_state: typeof appData.release_state === 'string' ? appData.release_state : null,
    parent_appid: toNumber(appData.parent_appid),
    homepage_url: typeof appData.homepage_url === 'string' ? appData.homepage_url : null,
    last_content_update: toIso(appData.last_content_update),
    current_build_id: typeof appData.current_build_id === 'string' ? appData.current_build_id : null,
    app_state: typeof appData.app_state === 'string' ? appData.app_state : null,
    languages: typeof appData.languages === 'object' && appData.languages !== null && !Array.isArray(appData.languages)
      ? appData.languages as Record<string, unknown>
      : null,
    content_descriptors: Array.isArray(appData.content_descriptors) ? appData.content_descriptors : null,
    created_at: toIso(appData.created_at) ?? '',
    updated_at: toIso(appData.updated_at) ?? '',
  } as AppDetails;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function mapSteamTags(rows: SteamTag[]): SteamTag[] {
  return rows.map((row) => ({ ...row, rank: toNumber(row.rank) ?? 0 }));
}

async function getAppProfileBundle(appid: number): Promise<AppProfileBundle> {
  const { rows } = await runTigerQuery<{
    app: Record<string, unknown> | null;
    developers: { id: number; name: string }[] | null;
    publishers: { id: number; name: string }[] | null;
    steam_deck: { category: SteamDeckInfo['category']; tests: unknown } | null;
    genres: Genre[] | null;
    categories: Category[] | null;
    franchises: Franchise[] | null;
    dlcs: DLCApp[] | null;
    steam_tags: SteamTag[] | null;
  }>(
    `
      SELECT
        to_jsonb(a) AS app,
        COALESCE(developers.items, '[]'::jsonb) AS developers,
        COALESCE(publishers.items, '[]'::jsonb) AS publishers,
        to_jsonb(deck) AS steam_deck,
        COALESCE(genres.items, '[]'::jsonb) AS genres,
        COALESCE(categories.items, '[]'::jsonb) AS categories,
        COALESCE(franchises.items, '[]'::jsonb) AS franchises,
        COALESCE(dlcs.items, '[]'::jsonb) AS dlcs,
        COALESCE(steam_tags.items, '[]'::jsonb) AS steam_tags
      FROM legacy.apps a
      LEFT JOIN legacy.app_steam_deck deck ON deck.appid = a.appid
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name) AS items
        FROM legacy.app_developers ad
        JOIN legacy.developers d ON d.id = ad.developer_id
        WHERE ad.appid = a.appid
      ) developers ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name) AS items
        FROM legacy.app_publishers ap
        JOIN legacy.publishers p ON p.id = ap.publisher_id
        WHERE ap.appid = a.appid
      ) publishers ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object('id', sg.genre_id, 'name', sg.name, 'is_primary', COALESCE(ag.is_primary, false))
          ORDER BY ag.is_primary DESC NULLS LAST, sg.name
        ) AS items
        FROM legacy.app_genres ag
        JOIN legacy.steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ag.appid = a.appid
      ) genres ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', sc.category_id, 'name', sc.name) ORDER BY sc.name) AS items
        FROM legacy.app_categories ac
        JOIN legacy.steam_categories sc ON sc.category_id = ac.category_id
        WHERE ac.appid = a.appid
      ) categories ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', f.id::integer, 'name', f.name) ORDER BY f.name) AS items
        FROM legacy.app_franchises af
        JOIN legacy.franchises f ON f.id = af.franchise_id
        WHERE af.appid = a.appid
      ) franchises ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('appid', child.appid, 'name', child.name, 'type', COALESCE(child.type, 'dlc')) ORDER BY child.name) AS items
        FROM legacy.apps child
        WHERE child.parent_appid = a.appid
      ) dlcs ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', st.tag_id, 'name', st.name, 'rank', ast.rank) ORDER BY ast.rank NULLS LAST, st.name) AS items
        FROM legacy.app_steam_tags ast
        JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
        WHERE ast.appid = a.appid
      ) steam_tags ON true
      WHERE a.appid = $1
      LIMIT 1
    `,
    [appid]
  );
  const row = rows[0];
  const steamDeck = row?.steam_deck
    ? {
        category: row.steam_deck.category,
        tests_failed: null,
        tests_passed: Array.isArray(row.steam_deck.tests) ? row.steam_deck.tests.map(String) : null,
      }
    : null;
  const steamTags = mapSteamTags(asArray<SteamTag>(row?.steam_tags));

  return {
    app: mapAppDetails(row?.app, appid),
    developers: asArray(row?.developers),
    publishers: asArray(row?.publishers),
    steamDeck,
    genres: asArray(row?.genres),
    categories: asArray(row?.categories),
    franchises: asArray(row?.franchises),
    dlcs: asArray(row?.dlcs),
    steamTags,
  };
}

async function getDailyMetrics(appid: number): Promise<DailyMetric[]> {
  const { rows } = await runTigerQuery<DailyMetric>(
    `
      SELECT
        metric_date,
        review_score,
        review_score_desc,
        total_reviews,
        positive_reviews,
        negative_reviews,
        owners_min,
        owners_max,
        ccu_peak,
        ccu_source,
        average_playtime_forever,
        average_playtime_2weeks,
        price_cents,
        discount_percent
      FROM metrics.daily_metrics
      WHERE appid = $1
      ORDER BY metric_date DESC
      LIMIT 30
    `,
    [appid]
  );

  return rows.map((row) => ({
    ...row,
    metric_date: toIso(row.metric_date) ?? '',
    ccu_source: row.ccu_source as DailyMetric['ccu_source'],
  }));
}

async function getReviewHistogram(appid: number): Promise<ReviewHistogram[]> {
  const { rows } = await runTigerQuery<ReviewHistogram>(
    `
      SELECT
        to_char(month_start, 'YYYY-MM') AS month_start,
        SUM(recommendations_up)::integer AS recommendations_up,
        SUM(recommendations_down)::integer AS recommendations_down
      FROM metrics.review_histogram
      WHERE appid = $1
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 24
    `,
    [appid]
  );

  return rows;
}

async function getTrends(appid: number): Promise<AppTrends | null> {
  const { rows } = await runTigerQuery<AppTrends>(
    'SELECT * FROM metrics.app_trends WHERE appid = $1 LIMIT 1',
    [appid]
  );
  return rows[0] ?? null;
}

async function getSyncStatus(appid: number): Promise<SyncStatus | null> {
  const { rows } = await runTigerQuery<Record<string, unknown>>(
    'SELECT * FROM ops.sync_status WHERE appid = $1 LIMIT 1',
    [appid]
  );
  const syncData = rows[0];
  if (!syncData) return null;

  return {
    last_steamspy_sync: toIso(syncData.last_steamspy_sync),
    last_storefront_sync: toIso(syncData.last_storefront_sync),
    last_reviews_sync: toIso(syncData.last_reviews_sync),
    last_histogram_sync: toIso(syncData.last_histogram_sync),
    priority_score: toNumber(syncData.priority_score),
    refresh_tier: typeof syncData.refresh_tier === 'string' ? syncData.refresh_tier : null,
    review_velocity_tier: (syncData.review_velocity_tier as SyncStatus['review_velocity_tier']) ?? null,
    last_activity_at: toIso(syncData.last_activity_at),
    consecutive_errors: toNumber(syncData.consecutive_errors),
    last_error_source: typeof syncData.last_error_source === 'string' ? syncData.last_error_source : null,
    last_error_message: typeof syncData.last_error_message === 'string' ? syncData.last_error_message : null,
    last_error_at: toIso(syncData.last_error_at),
    is_syncable: toBoolean(syncData.is_syncable, true),
  } as SyncStatus;
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

async function getAppDailyPeakSparkline(appid: number, days: 7 | 30 = 7) {
  const { rows } = await runTigerQuery<{ bucket: string; ccu: number | string | null }>(
    `
      SELECT date_trunc('day', snapshot_time)::date AS bucket, max(player_count) AS ccu
      FROM metrics.ccu_snapshots
      WHERE appid = $1
        AND snapshot_time >= now() - ($2::integer * INTERVAL '1 day')
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    [appid, days]
  );
  const dataPoints = rows.map((row) => toNumber(row.ccu) ?? 0).filter((value) => value > 0);
  const midpoint = Math.floor(dataPoints.length / 2);
  const firstHalf = dataPoints.slice(0, midpoint);
  const secondHalf = dataPoints.slice(midpoint);
  const firstAverage = firstHalf.length > 0 ? firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length : 0;
  const secondAverage = secondHalf.length > 0 ? secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length : 0;
  const growthPct = firstAverage > 0 ? Math.round(((secondAverage - firstAverage) / firstAverage) * 100) : null;
  const trend: 'up' | 'down' | 'stable' =
    growthPct === null ? 'stable' : growthPct > 5 ? 'up' : growthPct < -5 ? 'down' : 'stable';

  return {
    dataPoints,
    growthPct,
    peakCCU: dataPoints.length > 0 ? Math.max(...dataPoints) : null,
    trend,
  };
}

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ appid: string }>;
}) {
  if (!isTigerReadConfigured()) {
    return <TigerConfigRequired />;
  }

  const { appid: appidStr } = await params;
  const appid = parseInt(appidStr, 10);

  if (isNaN(appid)) {
    notFound();
  }

  const [
    appProfile,
    appSummary,
    metrics,
    histogram,
    trends,
    syncStatus,
    ccuSparkline,
  ] = await Promise.all([
    getAppProfileBundle(appid),
    getAppSummary(appid),
    getDailyMetrics(appid),
    getReviewHistogram(appid),
    getTrends(appid),
    getSyncStatus(appid),
    getAppDailyPeakSparkline(appid, 7),
  ]);
  const { app, developers, publishers, steamDeck, genres, categories, franchises, dlcs, steamTags } = appProfile;
  const tags = steamTags.slice(0, 30).map((tag) => ({ tag: tag.name, vote_count: null }));

  if (!app) {
    notFound();
  }

  // Check if user is authenticated and if this game is pinned
  // Note: user_pins table is created by migration 20260112000001_add_personalization.sql
  const user = await getUser();
  let pinStatus: { id: string } | null = null;
  if (user) {
    const { rows } = await runTigerQuery<{ id: string }>(
      `
        SELECT id::text AS id
        FROM legacy.user_pins
        WHERE user_id = $1::uuid
          AND entity_type = 'game'
          AND entity_id = $2
        LIMIT 1
      `,
      [user.id, app.appid]
    );
    pinStatus = rows[0] ?? null;
  }

  const latestMetrics = metrics[0] ?? null;
  const summaryMetricsAreFresh = hasFreshSummaryMetrics(appSummary);
  const preferLatestReviewMetrics = shouldPreferLatestReviewMetrics(
    appSummary,
    latestMetrics,
    syncStatus?.last_reviews_sync
  );
  const isFree = appSummary?.is_free ?? app.is_free;
  const discountPercent = appSummary?.current_discount_percent ?? app.current_discount_percent ?? 0;
  const priceCents = appSummary?.price_cents ?? app.current_price_cents;
  const shouldShowDiscountBadge = !isFree && priceCents !== null && discountPercent > 0;
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
  const ownersMin = summaryMetricsAreFresh
    ? appSummary?.owners_min ?? latestMetrics?.owners_min ?? null
    : latestMetrics?.owners_min ?? null;
  const ownersMax = summaryMetricsAreFresh
    ? appSummary?.owners_max ?? latestMetrics?.owners_max ?? null
    : latestMetrics?.owners_max ?? null;
  const peakCcu = summaryMetricsAreFresh
    ? appSummary?.ccu_peak ?? latestMetrics?.ccu_peak ?? null
    : latestMetrics?.ccu_peak ?? null;
  const avgPlaytimeForever = summaryMetricsAreFresh
    ? appSummary?.average_playtime_forever ?? latestMetrics?.average_playtime_forever ?? null
    : latestMetrics?.average_playtime_forever ?? null;
  const avgPlaytime2Weeks = summaryMetricsAreFresh
    ? appSummary?.average_playtime_2weeks ?? latestMetrics?.average_playtime_2weeks ?? null
    : latestMetrics?.average_playtime_2weeks ?? null;
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
        source: 'Tiger legacy.apps',
        detail: `legacy.apps.appid = ${app.appid}`,
      },
      {
        key: 'canonical_metrics',
        label: 'Canonical metrics + computed insights',
        status: getCoverageStatus({ present: appSummary !== null }),
        source: 'Tiger apps summary query',
        detail:
          appSummary
            ? `metric_date: ${appSummary.metric_date ?? '—'} · data_updated_at: ${appSummary.data_updated_at ?? '—'}`
            : app.is_delisted
              ? 'Not returned by Tiger summary for delisted apps'
              : !app.is_released
                ? 'Not returned by Tiger summary for unreleased apps'
                : 'No Tiger summary result',
      },
      {
        key: 'storefront',
        label: 'Storefront pricing + discount',
        status: getCoverageStatus({
          present: isFree || priceCents !== null,
          lastSyncedAt: syncStatus?.last_storefront_sync ?? null,
          staleAfterDays: 7,
        }),
        source: 'Tiger legacy.apps + ops.sync_status',
        detail: `price_cents: ${priceCents ?? '—'} · discount_percent: ${discountPercent} · last_storefront_sync: ${syncStatus?.last_storefront_sync ?? '—'}`,
      },
      {
        key: 'developers',
        label: 'Developers',
        status: getCoverageStatus({ present: developers.length > 0 }),
        source: 'Tiger legacy.app_developers → legacy.developers',
        detail: `count: ${developers.length}`,
      },
      {
        key: 'publishers',
        label: 'Publishers',
        status: getCoverageStatus({ present: publishers.length > 0 }),
        source: 'Tiger legacy.app_publishers → legacy.publishers',
        detail: `count: ${publishers.length}`,
      },
      {
        key: 'steam_deck',
        label: 'Steam Deck compatibility',
        status: getCoverageStatus({ present: steamDeck !== null }),
        source: 'Tiger legacy.app_steam_deck',
        detail: steamDeck ? `category: ${steamDeck.category}` : 'No row in legacy.app_steam_deck',
      },
      {
        key: 'genres',
        label: 'Genres',
        status: getCoverageStatus({ present: genres.length > 0 }),
        source: 'Tiger legacy.app_genres → legacy.steam_genres',
        detail: `count: ${genres.length}`,
      },
      {
        key: 'categories',
        label: 'Features / categories',
        status: getCoverageStatus({ present: categories.length > 0 }),
        source: 'Tiger legacy.app_categories → legacy.steam_categories',
        detail: `count: ${categories.length}`,
      },
      {
        key: 'franchises',
        label: 'Franchises',
        status: getCoverageStatus({ present: franchises.length > 0 }),
        source: 'Tiger legacy.app_franchises → legacy.franchises',
        detail: `count: ${franchises.length}`,
      },
      {
        key: 'official_tags',
        label: 'Official Steam tags',
        status: getCoverageStatus({ present: steamTags.length > 0 }),
        source: 'Tiger legacy.app_steam_tags → legacy.steam_tags',
        detail: `count: ${steamTags.length}`,
      },
      {
        key: 'community_tags',
        label: 'Community tags',
        status: getCoverageStatus({ present: tags.length > 0 }),
        source: 'Tiger legacy.app_steam_tags → legacy.steam_tags',
        detail: `count: ${tags.length}`,
      },
      {
        key: 'dlcs',
        label: 'DLCs (children)',
        status: getCoverageStatus({ present: dlcs.length > 0 }),
        source: 'Tiger legacy.apps.parent_appid',
        detail: `count: ${dlcs.length}`,
      },
      {
        key: 'trends',
        label: 'Trend analysis',
        status: getCoverageStatus({ present: trends !== null }),
        source: 'Tiger metrics.app_trends',
        detail: trends ? 'metrics.app_trends row present' : 'No metrics.app_trends row',
      },
      {
        key: 'daily_metrics',
        label: 'Daily metrics (time-series)',
        status: getCoverageStatus({
          present: metrics.length > 0,
          lastSyncedAt: syncStatus?.last_steamspy_sync ?? null,
          staleAfterDays: 14,
        }),
        source: 'Tiger metrics.daily_metrics',
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
        source: 'Tiger metrics.review_histogram',
        detail: `rows: ${histogram.length} · latest: ${histogram[0]?.month_start ?? '—'} · last_histogram_sync: ${syncStatus?.last_histogram_sync ?? '—'}`,
      },
      {
        key: 'ccu_snapshots',
        label: 'CCU snapshots sparkline',
        status: getCoverageStatus({ present: ccuSparkline.dataPoints.length > 0 }),
        source: 'Tiger metrics.ccu_snapshots',
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
        source: 'Tiger ops.sync_status',
        detail: syncStatus
          ? `is_syncable: ${syncStatus.is_syncable} · errors: ${syncStatus.consecutive_errors ?? 0} · last_error: ${syncStatus.last_error_message ?? '—'}`
          : 'No sync_status row',
      },
      {
        key: 'similarity',
        label: 'Similarity search index',
        status: 'unknown',
        source: 'system semantic search via /api/similarity',
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
          className="text-text-tertiary text-body-sm hover:text-accent-primary transition-colors"
        >
          ID: <span className="font-mono text-text-secondary hover:text-accent-primary">{app.appid}</span>
        </a>
        <span className="text-text-tertiary">·</span>
        <div className="flex items-center gap-2">
          <span className={`text-subheading font-semibold ${
            shouldShowDiscountBadge
              ? 'text-accent-green'
              : 'text-text-primary'
          }`}>
            {formatPrice(priceCents, isFree)}
          </span>
          {shouldShowDiscountBadge && (
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
