import 'server-only';

import type { Database } from '@publisheriq/database';
import {
  buildDiffPreview,
  fetchChangeFeedActivityDetail,
  fetchChangeFeedBurstDetail,
  fetchChatChangeActivityResponse,
  fetchChatChangePatternCandidates,
  formatChangeLabel,
  parseActivityId,
  type ChatChangePatternCandidateRow,
  type ChangeActivityDetail,
  type ChangeActivityMode,
  type ChangeActivityRow,
  type ChangeActivitySignalFamily,
  type ChangeActivitySort,
  type ChangeActivityView,
  type ChangeActivityStoryKind,
  type ChangeDetailEvent,
  type JsonValue,
} from '@/app/(main)/changes/lib';
import type { ToolCall } from '@/lib/llm/types';
import { lookupGames } from '@/lib/search/game-lookup';
import { getServiceSupabase } from '@/lib/supabase-service';

type AppType = Database['public']['Enums']['app_type'];

const DEFAULT_ACTIVITY_DAYS = 30;
const MAX_ACTIVITY_DAYS = 180;
const DEFAULT_TIMELINE_DAYS = 90;
const MAX_TIMELINE_DAYS = 365;
const DEFAULT_ACTIVITY_LIMIT = 10;
const MAX_ACTIVITY_LIMIT = 25;
const DEFAULT_TIMELINE_LIMIT = 20;
const MAX_TIMELINE_LIMIT = 50;
const DEFAULT_PATTERN_LIMIT = 10;
const MAX_PATTERN_LIMIT = 10;
const INTERNAL_PATTERN_ACTIVITY_LIMIT = 60;
const DEFAULT_PATTERN_APP_TYPES: AppType[] = ['game'];
const HIGH_CONFIDENCE_SIMILARITY = 0.72;
const MINIMUM_CONFIDENCE_SIMILARITY = 0.45;
const CLEAR_CONFIDENCE_MARGIN = 0.08;
const MAX_AMBIGUITY_CANDIDATES = 3;

export type ChangePattern =
  | 'marketing_push'
  | 'relaunch_pattern'
  | 'update_tease'
  | 'under_marketed'
  | 'signable_candidate'
  | 'rescue_candidate'
  | 'sustained_response';

export interface QueryChangeActivityArgs {
  days?: number;
  view?: ChangeActivityView;
  mode?: ChangeActivityMode;
  sort?: ChangeActivitySort;
  app_types?: AppType[];
  signal_families?: ChangeActivitySignalFamily[];
  search?: string;
  limit?: number;
}

export interface GetGameChangeTimelineArgs {
  app_name?: string;
  appid?: number;
  days?: number;
  limit?: number;
  signal_families?: ChangeActivitySignalFamily[];
}

export interface GetChangeActivityDetailArgs {
  activity_id: string;
}

export interface CompareChangeBeforeAfterArgs {
  activity_id?: string;
  app_name?: string;
  appid?: number;
  days?: number;
}

export interface FindChangePatternsArgs {
  pattern: ChangePattern;
  days?: number;
  search?: string;
  app_types?: AppType[];
  limit?: number;
}

interface ResolvedApp {
  appid: number;
  name: string;
  appType: AppType;
  releaseYear: number | null;
  similarityScore?: number;
  isExactMatch?: boolean;
  alternatives: Array<{
    appid: number;
    name: string;
    releaseYear: number | null;
    similarityScore?: number;
    isExactMatch?: boolean;
  }>;
}

interface ResolveAppReferenceResult {
  app: ResolvedApp | null;
  error?: string;
  candidates?: ResolvedApp['alternatives'];
}

interface MetricsWindow {
  ccuPeak: number | null;
  totalReviews: number | null;
  positiveReviews: number | null;
  negativeReviews: number | null;
  reviewScore: number | null;
  reviewScoreLabel: string | null;
  priceCents: number | null;
  discountPercent: number | null;
}

interface AppMetrics {
  appid: number;
  positivePercentage: number | null;
  totalReviews: number | null;
  ccuPeak: number | null;
  priceCents: number | null;
  discountPercent: number | null;
  reviewVelocity7d: number | null;
  reviewVelocity30d: number | null;
  trend30dDirection: string | null;
  ccuTrend7dPct: number | null;
}

interface PatternProofPacket {
  activityId: string;
  occurredAt: string;
  headline: string;
  summary: string;
  facts: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  diffs: Array<{
    label: string;
    beforeText: string | null;
    afterText: string | null;
    note: string | null;
    added: string[];
    removed: string[];
  }>;
}

interface PatternCandidate {
  appid: number;
  name: string;
  occurredAt: string;
  confidence: 'high' | 'medium';
  reasons: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  storyKinds: string[];
  activityIds: string[];
  metrics: AppMetrics | null;
  primaryProof: PatternProofPacket | null;
}

interface PatternAggregate {
  appid: number;
  name: string;
  latestOccurredAt: string;
  activityIds: string[];
  signalFamilies: Set<ChangeActivitySignalFamily>;
  storyKinds: Set<ChangeActivityStoryKind>;
  announcementCount: number;
  changeCount: number;
}

interface RawAppChangeFeedRow {
  event_id: number;
  appid: number;
  app_name: string;
  source: string;
  change_type: Database['public']['Enums']['app_change_type'];
  occurred_at: string;
  before_value: JsonValue;
  after_value: JsonValue;
  context: JsonValue;
  baseline_7d: JsonValue;
  baseline_30d: JsonValue;
  response_1d: JsonValue;
  response_7d: JsonValue;
  response_30d: JsonValue;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = value ?? fallback;
  return Math.min(Math.max(candidate, min), max);
}

function normalizeSearch(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeEntityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isConfidentGameResolution(
  query: string,
  best: NonNullable<Awaited<ReturnType<typeof lookupGames>>['results'][number]>,
  secondBest: Awaited<ReturnType<typeof lookupGames>>['results'][number] | undefined
): boolean {
  const normalizedQuery = normalizeEntityKey(query);
  const normalizedBest = normalizeEntityKey(best.name);
  const bestScore = best.similarityScore ?? 0;
  const secondScore = secondBest?.similarityScore ?? 0;

  if (best.isExactMatch || normalizedBest === normalizedQuery) {
    return true;
  }

  if (bestScore >= HIGH_CONFIDENCE_SIMILARITY) {
    return true;
  }

  if (bestScore < MINIMUM_CONFIDENCE_SIMILARITY) {
    return false;
  }

  return bestScore - secondScore >= CLEAR_CONFIDENCE_MARGIN;
}

function formatCandidateLabel(candidate: {
  name: string;
  releaseYear: number | null;
}): string {
  return candidate.releaseYear ? `${candidate.name} (${candidate.releaseYear})` : candidate.name;
}

function buildAmbiguousGameError(query: string, candidates: ResolvedApp['alternatives']): string {
  const labels = candidates.map(formatCandidateLabel);

  if (labels.length === 0) {
    return `The game name "${query}" is ambiguous. Ask the user to provide the exact Steam title or appid.`;
  }

  return `The game name "${query}" matched multiple Steam titles. Ask the user to clarify which one they mean: ${labels.join(', ')}.`;
}

function familyForChangeType(changeType: string): ChangeActivitySignalFamily {
  switch (changeType) {
    case 'release_date_text_change':
      return 'release';
    case 'price_change':
    case 'discount_start':
    case 'discount_end':
    case 'dlc_references_changed':
    case 'package_references_changed':
      return 'pricing';
    case 'description_rewrite':
    case 'short_description_rewrite':
      return 'store-page';
    case 'capsule_url_changed':
    case 'header_url_changed':
    case 'background_url_changed':
    case 'screenshot_added':
    case 'screenshot_removed':
    case 'screenshot_reordered':
    case 'trailer_added':
    case 'trailer_removed':
    case 'trailer_reordered':
    case 'trailer_thumbnail_changed':
      return 'media';
    case 'tags_added':
    case 'tags_removed':
    case 'genres_changed':
    case 'categories_changed':
    case 'publisher_association_changed':
    case 'developer_association_changed':
      return 'taxonomy';
    case 'languages_changed':
    case 'platforms_changed':
    case 'controller_support_changed':
    case 'steam_deck_status_changed':
      return 'platform';
    case 'news_published':
    case 'news_edited':
      return 'announcement';
    case 'build_id_changed':
    case 'last_content_update_changed':
      return 'build';
    default:
      return 'store-page';
  }
}

function toChangeDetailEvent(row: RawAppChangeFeedRow): ChangeDetailEvent {
  return {
    eventId: row.event_id,
    appid: row.appid,
    source: row.source as 'storefront' | 'pics' | 'media',
    changeType: row.change_type,
    occurredAt: row.occurred_at,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    context:
      row.context && typeof row.context === 'object' && !Array.isArray(row.context)
        ? (row.context as Record<string, JsonValue | undefined>)
        : {},
  };
}

function normalizeMetricsWindow(value: JsonValue): MetricsWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as {
    daily_metrics?: {
      avg_price_cents?: number | null;
      avg_discount_percent?: number | null;
      max_total_reviews?: number | null;
      avg_review_score?: number | null;
      max_ccu_peak?: number | null;
      max_positive_reviews?: number | null;
      max_negative_reviews?: number | null;
      review_score_desc?: string | null;
    } | null;
    ccu?: {
      max_player_count?: number | null;
    } | null;
  };

  const dailyMetrics = payload.daily_metrics ?? null;
  const ccu = payload.ccu ?? null;

  const normalized: MetricsWindow = {
    ccuPeak: ccu?.max_player_count ?? dailyMetrics?.max_ccu_peak ?? null,
    totalReviews: dailyMetrics?.max_total_reviews ?? null,
    positiveReviews: dailyMetrics?.max_positive_reviews ?? null,
    negativeReviews: dailyMetrics?.max_negative_reviews ?? null,
    reviewScore: dailyMetrics?.avg_review_score ?? null,
    reviewScoreLabel: dailyMetrics?.review_score_desc ?? null,
    priceCents: dailyMetrics?.avg_price_cents ?? null,
    discountPercent: dailyMetrics?.avg_discount_percent ?? null,
  };

  return Object.values(normalized).some((field) => field !== null) ? normalized : null;
}

function metricDelta(afterValue: number | null, beforeValue: number | null): number | null {
  if (afterValue == null || beforeValue == null) {
    return null;
  }

  return afterValue - beforeValue;
}

function percentLift(afterValue: number | null, beforeValue: number | null): number | null {
  if (afterValue == null || beforeValue == null || beforeValue <= 0) {
    return null;
  }

  return ((afterValue - beforeValue) / beforeValue) * 100;
}

async function resolveAppReference(args: {
  appid?: number;
  app_name?: string;
}): Promise<ResolveAppReferenceResult> {
  const supabase = getServiceSupabase();

  if (args.appid) {
    const { data, error } = await supabase
      .from('apps')
      .select('appid, name, release_date, type')
      .eq('appid', args.appid)
      .maybeSingle();

    if (error || !data) {
      return {
        app: null,
        error: 'Unable to resolve the requested game. Use the exact Steam appid or closest Steam title.',
      };
    }

    return {
      app: {
        appid: data.appid,
        name: data.name,
        appType: data.type ?? 'game',
        releaseYear: data.release_date ? new Date(data.release_date).getFullYear() : null,
        alternatives: [],
      },
    };
  }

  const appName = normalizeSearch(args.app_name);
  if (!appName) {
    return {
      app: null,
      error: 'A Steam game name or appid is required.',
    };
  }

  const lookup = await lookupGames({ query: appName, limit: 5 });
  const best = lookup.results[0];

  if (!lookup.success || !best) {
    return {
      app: null,
      error: `Unable to resolve "${appName}" to a Steam game. Ask the user for the exact title or appid.`,
    };
  }

  if (!isConfidentGameResolution(appName, best, lookup.results[1])) {
    const candidates = lookup.results
      .slice(0, MAX_AMBIGUITY_CANDIDATES)
      .map((candidate) => ({
        appid: candidate.appid,
        name: candidate.name,
        releaseYear: candidate.releaseYear,
        similarityScore: candidate.similarityScore,
        isExactMatch: candidate.isExactMatch,
      }));

    return {
      app: null,
      error: buildAmbiguousGameError(appName, candidates),
      candidates,
    };
  }

  return {
    app: {
      appid: best.appid,
      name: best.name,
      appType: 'game',
      releaseYear: best.releaseYear,
      similarityScore: best.similarityScore,
      isExactMatch: best.isExactMatch,
      alternatives: lookup.results.slice(1),
    },
  };
}

function isExactSingleTitleChangeSearch(
  search: string,
  app: ResolvedApp | null
): app is ResolvedApp {
  if (!app) {
    return false;
  }

  const normalizedSearch = normalizeEntityKey(search);
  const normalizedAppName = normalizeEntityKey(app.name);

  if (!normalizedSearch || !normalizedAppName) {
    return false;
  }

  return (
    app.isExactMatch === true ||
    normalizedSearch === normalizedAppName ||
    (app.similarityScore ?? 0) >= HIGH_CONFIDENCE_SIMILARITY
  );
}

function normalizeTimelineSignalFamilies(
  signalFamilies: ChangeActivitySignalFamily[] | undefined
): ChangeActivitySignalFamily[] | undefined {
  const normalized = signalFamilies?.filter((family) => family !== 'announcement');
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function supportsSingleTitleTimeline(args: QueryChangeActivityArgs): boolean {
  if (args.mode === 'announcements') {
    return false;
  }

  if (args.signal_families?.includes('announcement')) {
    return false;
  }

  return true;
}

function extractSingleTitleChangeSearch(userPrompt: string | undefined): string | null {
  const prompt = normalizeSearch(userPrompt);
  if (!prompt) {
    return null;
  }

  const patterns = [
    /\b(?:steam(?:\s+store-page)? changes?|steam[- ]page refresh(?:es)?|store-page changes?)\s+for\s+(.+?)(?:\s+in the last|\s+over the last|\s+before and after|\s+lately|\s+recently|[?.!]|$)/i,
    /\brecent steam changes for\s+(.+?)(?:\s+in the last|\s+over the last|[?.!]|$)/i,
    /\bwhat changed on the steam page for\s+(.+?)(?:\s+before and after|\s+in the last|\s+over the last|[?.!]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const candidate = normalizeSearch(match?.[1]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function resolveSingleTitleTimelineArgs(
  args: QueryChangeActivityArgs,
  userPrompt?: string
): Promise<GetGameChangeTimelineArgs | null> {
  if (!supportsSingleTitleTimeline(args)) {
    return null;
  }

  const search = normalizeSearch(args.search) ?? extractSingleTitleChangeSearch(userPrompt);
  if (!search) {
    return null;
  }

  const resolved = await resolveAppReference({ app_name: search });
  if (!isExactSingleTitleChangeSearch(search, resolved.app)) {
    return null;
  }

  return {
    appid: resolved.app.appid,
    app_name: resolved.app.name,
    days: args.days,
    limit: args.limit,
    signal_families: normalizeTimelineSignalFamilies(args.signal_families),
  };
}

function classifyChangeIntelError(error: unknown): {
  failureKind: string;
  userMessage: string;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (/statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return {
      failureKind: 'db_statement_timeout',
      userMessage: 'The change-intel projection query timed out before it could finish.',
    };
  }

  if (/not available yet|pending migration|projection/i.test(message)) {
    return {
      failureKind: 'projection_unavailable',
      userMessage: 'The change-intel projection is not available yet.',
    };
  }

  return {
    failureKind: 'change_intel_unavailable',
    userMessage: 'The change-intel surface is temporarily unavailable.',
  };
}

export async function normalizeChangeIntelToolCall(
  toolCall: ToolCall,
  userPrompt?: string
): Promise<ToolCall> {
  if (toolCall.name !== 'query_change_activity') {
    return toolCall;
  }

  const args = toolCall.arguments as QueryChangeActivityArgs;
  const timelineArgs = await resolveSingleTitleTimelineArgs(args, userPrompt);
  if (!timelineArgs) {
    return toolCall;
  }

  return {
    ...toolCall,
    name: 'get_game_change_timeline',
    arguments: timelineArgs as unknown as Record<string, unknown>,
  };
}

async function fetchWindowMetrics(
  appid: number,
  start: string,
  end: string
): Promise<MetricsWindow | null> {
  const supabase = getServiceSupabase();

  // Generated DB types lag migrations for some of the change-intel surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_change_window_metrics', {
    p_appid: appid,
    p_start: start,
    p_end: end,
  }) as { data: JsonValue; error: { message: string } | null };

  if (error) {
    throw new Error(`Failed to fetch change window metrics: ${error.message}`);
  }

  return normalizeMetricsWindow(data);
}

async function fetchAppMetrics(appIds: number[]): Promise<Map<number, AppMetrics>> {
  if (appIds.length === 0) {
    return new Map();
  }

  const supabase = getServiceSupabase();
  const uniqueAppIds = Array.from(new Set(appIds));

  const [latestMetricsResult, trendResult] = await Promise.all([
    supabase
      .from('latest_daily_metrics')
      .select('appid, positive_percentage, total_reviews, ccu_peak, price_cents, discount_percent')
      .in('appid', uniqueAppIds),
    supabase
      .from('app_trends')
      .select('appid, review_velocity_7d, review_velocity_30d, trend_30d_direction, ccu_trend_7d_pct')
      .in('appid', uniqueAppIds),
  ]);

  const metricsByApp = new Map<number, AppMetrics>();

  for (const row of latestMetricsResult.data ?? []) {
    if (row.appid == null) {
      continue;
    }

    metricsByApp.set(row.appid, {
      appid: row.appid,
      positivePercentage: row.positive_percentage,
      totalReviews: row.total_reviews,
      ccuPeak: row.ccu_peak,
      priceCents: row.price_cents,
      discountPercent: row.discount_percent,
      reviewVelocity7d: null,
      reviewVelocity30d: null,
      trend30dDirection: null,
      ccuTrend7dPct: null,
    });
  }

  for (const row of trendResult.data ?? []) {
    const existing = metricsByApp.get(row.appid) ?? {
      appid: row.appid,
      positivePercentage: null,
      totalReviews: null,
      ccuPeak: null,
      priceCents: null,
      discountPercent: null,
      reviewVelocity7d: null,
      reviewVelocity30d: null,
      trend30dDirection: null,
      ccuTrend7dPct: null,
    };

    existing.reviewVelocity7d = row.review_velocity_7d;
    existing.reviewVelocity30d = row.review_velocity_30d;
    existing.trend30dDirection = row.trend_30d_direction;
    existing.ccuTrend7dPct = row.ccu_trend_7d_pct;
    metricsByApp.set(row.appid, existing);
  }

  return metricsByApp;
}

function hydratePatternMetrics(
  candidates: ChatChangePatternCandidateRow[],
  fallbackMetrics: Map<number, AppMetrics>
): Array<ChatChangePatternCandidateRow & { metrics: AppMetrics | null }> {
  return candidates.map((candidate) => {
    const existingMetrics =
      candidate.positivePercentage != null ||
      candidate.totalReviews != null ||
      candidate.reviewVelocity30d != null ||
      candidate.reviewVelocity7d != null ||
      candidate.ccuTrend7dPct != null
        ? {
            appid: candidate.appid,
            positivePercentage: candidate.positivePercentage,
            totalReviews: candidate.totalReviews,
            ccuPeak: candidate.ccuPeak,
            priceCents: candidate.priceCents,
            discountPercent: candidate.discountPercent,
            reviewVelocity7d: candidate.reviewVelocity7d,
            reviewVelocity30d: candidate.reviewVelocity30d,
            trend30dDirection: candidate.trend30dDirection,
            ccuTrend7dPct: candidate.ccuTrend7dPct,
          }
        : null;

    return {
      ...candidate,
      metrics: existingMetrics ?? fallbackMetrics.get(candidate.appid) ?? null,
    };
  });
}

function buildPatternAggregates(
  candidates: Array<ChatChangePatternCandidateRow & { metrics: AppMetrics | null }>
): PatternAggregate[] {
  return candidates.map((candidate) => ({
    appid: candidate.appid,
    name: candidate.appName,
    latestOccurredAt: candidate.latestOccurredAt,
    activityIds: candidate.activityIds.slice(0, 3),
    signalFamilies: new Set(candidate.signalFamilies),
    storyKinds: new Set(candidate.storyKinds),
    announcementCount: candidate.announcementCount,
    changeCount: candidate.changeCount,
  }));
}

function mapActivityRow(row: ChangeActivityRow) {
  return {
    activityId: row.activityId,
    activityKind: row.activityKind,
    storyKind: row.storyKind,
    appid: row.appid,
    name: row.appName,
    appType: row.appType,
    isReleased: row.isReleased,
    releaseDate: row.releaseDate,
    occurredAt: row.occurredAt,
    headline: row.headline,
    summary: row.summary,
    facts: row.facts,
    highlightLabels: row.highlightLabels,
    signalFamilies: row.signalFamilies,
    relatedAnnouncementCount: row.relatedAnnouncementCount,
    externalUrl: row.externalUrl,
  };
}

function buildPatternProofPacket(detail: ChangeActivityDetail | null): PatternProofPacket | null {
  if (!detail) {
    return null;
  }

  return {
    activityId: detail.activityId,
    occurredAt: detail.occurredAt,
    headline: detail.headline,
    summary: detail.summary,
    facts: detail.facts.slice(0, 3),
    signalFamilies: detail.signalFamilies.slice(0, 3),
    diffs: detail.diffs.slice(0, 2).map((diff) => ({
      label: diff.label,
      beforeText: diff.beforeText,
      afterText: diff.afterText,
      note: diff.note,
      added: diff.added.slice(0, 3),
      removed: diff.removed.slice(0, 3),
    })),
  };
}

async function hydratePatternProofPackets(
  candidates: PatternCandidate[],
  maxProofs: number
): Promise<PatternCandidate[]> {
  const shortlist = candidates.slice(0, maxProofs);
  const hydrated: PatternCandidate[] = [];
  const batchSize = 4;

  for (let index = 0; index < shortlist.length; index += batchSize) {
    const batch = shortlist.slice(index, index + batchSize);
    const batchProofs = await Promise.all(
      batch.map(async (candidate) => {
        const activityId = candidate.activityIds[0];
        if (!activityId) {
          return { ...candidate, primaryProof: null };
        }

        const detail = await fetchChangeFeedActivityDetail(activityId).catch(() => null);
        return {
          ...candidate,
          primaryProof: buildPatternProofPacket(detail),
        };
      })
    );

    hydrated.push(...batchProofs);
  }

  return hydrated;
}

export async function queryChangeActivity(args: QueryChangeActivityArgs) {
  const days = clamp(args.days, DEFAULT_ACTIVITY_DAYS, 1, MAX_ACTIVITY_DAYS);
  const limit = clamp(args.limit, DEFAULT_ACTIVITY_LIMIT, 1, MAX_ACTIVITY_LIMIT);

  const timelineArgs = await resolveSingleTitleTimelineArgs(
    {
      ...args,
      days,
      limit,
    },
    undefined
  );

  if (timelineArgs) {
    return getGameChangeTimeline(timelineArgs);
  }

  try {
    const response = await fetchChatChangeActivityResponse({
      days,
      view: args.view ?? 'overview',
      mode: args.mode ?? 'all',
      sort: args.sort ?? 'relevant',
      appTypes: args.app_types ?? null,
      signalFamilies: args.signal_families ?? null,
      search: normalizeSearch(args.search),
      cursor: null,
      limit,
    });

    if (response.items.length === 0) {
      return {
        success: true,
        results: [],
        total_found: 0,
        selected_change_surface: 'projection',
        no_match: true,
        sufficient_to_answer: true,
        sufficiency_reason: 'No cross-game change activity matched the requested constraints and time window.',
        required_answer_fields: ['what was checked', 'time window', 'why there was no qualifying match'],
        response_guidance: 'State the checked window and constraints explicitly. Do not invent a ranked list when nothing matched.',
        meta: response.meta,
      };
    }

    const results = response.items.map(mapActivityRow);

    return {
      success: true,
      results,
      total_found: response.items.length,
      selected_change_surface: 'projection',
      sparse_result: response.items.length < Math.min(limit, 3),
      sufficient_to_answer: response.items.length < 3,
      sufficiency_reason:
        response.items.length < 3
          ? 'Returned a small but directly answerable change-activity set. Keep the answer constrained and say the set is limited.'
          : 'A ranked change-activity set is available. Fetch one supporting detail only if the answer needs a concrete proof example.',
      required_answer_fields: ['what changed', 'when it changed', 'why it matters', 'evidence quality'],
      response_guidance: 'For each row, name the concrete change signal, when it happened, and why it matters. Do not summarize with generic repeated change labels.',
      presentation_hints: {
        format: 'ranked_change_activity',
        proof_field: 'facts',
      },
      answer_payload: {
        rows: results.map((row) => ({
          activityId: row.activityId,
          appid: row.appid,
          name: row.name,
          occurredAt: row.occurredAt,
          headline: row.headline,
          facts: row.facts.slice(0, 2),
          signalFamilies: row.signalFamilies,
          storyKind: row.storyKind,
        })),
      },
      meta: response.meta,
    };
  } catch (error) {
    const classification = classifyChangeIntelError(error);
    return {
      success: false,
      unavailable: true,
      selected_change_surface: 'projection',
      failure_kind: classification.failureKind,
      error: `Unable to load cross-game Steam change activity right now. ${classification.userMessage}`,
      sufficient_to_answer: false,
      no_match: false,
      fallback_allowed: false,
    };
  }
}

export async function getGameChangeTimeline(args: GetGameChangeTimelineArgs) {
  const days = clamp(args.days, DEFAULT_TIMELINE_DAYS, 1, MAX_TIMELINE_DAYS);
  const limit = clamp(args.limit, DEFAULT_TIMELINE_LIMIT, 1, MAX_TIMELINE_LIMIT);
  const resolved = await resolveAppReference({
    appid: args.appid,
    app_name: args.app_name,
  });
  const app = resolved.app;

  if (!app) {
    return {
      success: false,
      error: resolved.error ?? 'Unable to resolve the requested game. Use the closest Steam app name or appid.',
      candidates: resolved.candidates ?? [],
    };
  }

  const supabase = getServiceSupabase();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  // Generated DB types lag migrations for some of the change-intel surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_app_change_feed', {
    p_appid: app.appid,
    p_from: from,
    p_to: to,
    p_limit: limit,
  }) as { data: RawAppChangeFeedRow[] | null; error: { message: string } | null };

  if (error) {
    return {
      success: false,
      error: `Failed to load app change feed: ${error.message}`,
    };
  }

  const events = (data ?? [])
    .map((row) => {
      const detailEvent = toChangeDetailEvent(row);
      const diff = buildDiffPreview(detailEvent);
      return {
        eventId: row.event_id,
        occurredAt: row.occurred_at,
        source: row.source,
        changeType: row.change_type,
        signalFamily: familyForChangeType(row.change_type),
        label: diff?.label ?? formatChangeLabel(row.change_type),
        kind: diff?.kind ?? 'note',
        beforeText: diff?.beforeText ?? null,
        afterText: diff?.afterText ?? null,
        added: diff?.added ?? [],
        removed: diff?.removed ?? [],
        beforeImageUrl: diff?.beforeImageUrl ?? null,
        afterImageUrl: diff?.afterImageUrl ?? null,
        note: diff?.note ?? null,
        baseline7d: normalizeMetricsWindow(row.baseline_7d),
        baseline30d: normalizeMetricsWindow(row.baseline_30d),
        response1d: normalizeMetricsWindow(row.response_1d),
        response7d: normalizeMetricsWindow(row.response_7d),
        response30d: normalizeMetricsWindow(row.response_30d),
      };
    })
    .filter((event) => {
      if (!args.signal_families || args.signal_families.length === 0) {
        return true;
      }

      return args.signal_families.includes(event.signalFamily);
    });

  if (events.length === 0) {
    return {
      success: true,
      app,
      total_found: 0,
      selected_change_surface: 'per_app_timeline',
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'No title-specific change events were found in the requested window.',
      required_answer_fields: ['what window was checked', 'why no qualifying title-specific changes were found'],
      response_guidance: 'State the checked title and time window. Do not imply changes happened when no events were found.',
      events: [],
      meta: {
        days,
        limit,
        signalFamilies: args.signal_families ?? null,
      },
    };
  }

  return {
    success: true,
    app,
    total_found: events.length,
    selected_change_surface: 'per_app_timeline',
    sufficient_to_answer: true,
    sufficiency_reason: 'The timeline events are sufficient to answer directly when you stay grounded in concrete changes and dates.',
    required_answer_fields: ['dates', 'concrete changes', 'before/after values when available'],
    response_guidance: 'Lead with the most material title-specific changes and dates. Use before/after text when it exists.',
    events,
    presentation_hints: {
      format: 'game_change_timeline',
      proof_field: 'events',
    },
    answer_payload: {
      app,
      events: events.map((event) => ({
        occurredAt: event.occurredAt,
        label: event.label,
        beforeText: event.beforeText,
        afterText: event.afterText,
        added: event.added.slice(0, 3),
        removed: event.removed.slice(0, 3),
        note: event.note,
      })),
    },
    meta: {
      days,
      limit,
      signalFamilies: args.signal_families ?? null,
    },
  };
}

export async function getChangeActivityDetail(args: GetChangeActivityDetailArgs) {
  const detail = await fetchChangeFeedActivityDetail(args.activity_id);

  if (!detail) {
    return {
      success: false,
      error: 'Change activity not found.',
    };
  }

  return {
    success: true,
    selected_change_surface: 'burst_detail',
    sufficient_to_answer: true,
    sufficiency_reason: 'The change detail includes enough evidence to answer directly from the structured before/after facts.',
    required_answer_fields: ['headline', 'concrete diffs', 'why it matters'],
    response_guidance: 'Use the concrete structured diffs and related announcements. Avoid generic summary filler.',
    detail: {
      activityId: detail.activityId,
      activityKind: detail.activityKind,
      storyKind: detail.storyKind,
      appid: detail.appid,
      name: detail.appName,
      appType: detail.appType,
      occurredAt: detail.occurredAt,
      headline: detail.headline,
      summary: detail.summary,
      facts: detail.facts,
      highlightLabels: detail.highlightLabels,
      signalFamilies: detail.signalFamilies,
      diffs: detail.diffs,
      relatedAnnouncements: detail.relatedAnnouncements,
      aftermath: detail.aftermath,
      externalUrl: detail.externalUrl,
      body: detail.body,
    },
  };
}

async function resolveComparisonBurst(
  args: CompareChangeBeforeAfterArgs
): Promise<{
  app: ResolvedApp | null;
  error?: string;
  candidates?: ResolvedApp['alternatives'];
  detail: ChangeActivityDetail | null;
  burstDetail: Awaited<ReturnType<typeof fetchChangeFeedBurstDetail>> | null;
  activityId: string | null;
}> {
  if (args.activity_id) {
    const parsed = parseActivityId(args.activity_id);
    if (!parsed) {
      return {
        app: null,
        detail: null,
        burstDetail: null,
        activityId: null,
      };
    }

    if (parsed.kind !== 'change') {
      throw new Error('compare_change_before_after only supports change activities, not announcement-only cards.');
    }

    const [detail, burstDetail] = await Promise.all([
      fetchChangeFeedActivityDetail(args.activity_id),
      fetchChangeFeedBurstDetail(parsed.value),
    ]);

    return {
      app: detail
        ? {
            appid: detail.appid,
            name: detail.appName,
            appType: detail.appType ?? 'game',
            releaseYear: detail.releaseDate ? new Date(detail.releaseDate).getFullYear() : null,
            alternatives: [],
          }
        : null,
      detail,
      burstDetail,
      activityId: args.activity_id,
    };
  }

  const resolvedApp = await resolveAppReference({
    appid: args.appid,
    app_name: args.app_name,
  });
  const app = resolvedApp.app;

  if (!app) {
    return {
      app: null,
      error: resolvedApp.error,
      candidates: resolvedApp.candidates,
      detail: null,
      burstDetail: null,
      activityId: null,
    };
  }

  const response = await fetchChatChangeActivityResponse({
    days: clamp(args.days, DEFAULT_TIMELINE_DAYS, 1, MAX_TIMELINE_DAYS),
    view: 'all-activity',
    mode: 'changes',
    sort: 'newest',
    appTypes: app.appType ? [app.appType] : null,
    signalFamilies: null,
    search: app.name,
    cursor: null,
    limit: 25,
  });

  const matchedActivity = response.items
    .filter((item) => item.appid === app.appid && item.activityKind === 'change')
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];

  if (!matchedActivity) {
    return {
      app,
      detail: null,
      burstDetail: null,
      activityId: null,
    };
  }

  const parsed = parseActivityId(matchedActivity.activityId);
  if (!parsed || parsed.kind !== 'change') {
    return {
      app,
      detail: null,
      burstDetail: null,
      activityId: matchedActivity.activityId,
    };
  }

  const [detail, burstDetail] = await Promise.all([
    fetchChangeFeedActivityDetail(matchedActivity.activityId),
    fetchChangeFeedBurstDetail(parsed.value),
  ]);

  return {
    app,
    detail,
    burstDetail,
    activityId: matchedActivity.activityId,
  };
}

export async function compareChangeBeforeAfter(args: CompareChangeBeforeAfterArgs) {
  const resolved = await resolveComparisonBurst(args);

  if (!resolved.app) {
    return {
      success: false,
      error: resolved.error ?? 'Unable to resolve the requested game or activity.',
      candidates: resolved.candidates ?? [],
    };
  }

  if (!resolved.detail || !resolved.burstDetail || !resolved.activityId) {
    return {
      success: false,
      error: `I didn't find a recent change burst for ${resolved.app.name} in the requested window.`,
    };
  }

  const baseline30d = await fetchWindowMetrics(
    resolved.app.appid,
    new Date(Date.parse(resolved.burstDetail.burstStartedAt) - 30 * 24 * 60 * 60 * 1000).toISOString(),
    resolved.burstDetail.burstStartedAt
  );

  const response30d = await fetchWindowMetrics(
    resolved.app.appid,
    resolved.burstDetail.burstEndedAt,
    new Date(Date.parse(resolved.burstDetail.burstEndedAt) + 30 * 24 * 60 * 60 * 1000).toISOString()
  );

  return {
    success: true,
    app: resolved.app,
    activityId: resolved.activityId,
    selected_change_surface: 'before_after',
    sufficient_to_answer: true,
    sufficiency_reason: 'The before/after comparison is sufficient to answer directly when you structure the response around before state, after state, and impact.',
    required_answer_fields: ['what changed', 'before state', 'after state', 'why it matters', 'confidence'],
    response_guidance: 'Use sections in this order: What changed, Before, After, Why it matters, Confidence.',
    selectedActivity: {
      headline: resolved.detail.headline,
      summary: resolved.detail.summary,
      occurredAt: resolved.detail.occurredAt,
      signalFamilies: resolved.detail.signalFamilies,
      storyKind: resolved.detail.storyKind,
    },
    diffs: resolved.detail.diffs,
    relatedAnnouncements: resolved.detail.relatedAnnouncements,
    presentation_hints: {
      format: 'before_after_change',
      proof_field: 'diffs',
    },
    answer_payload: {
      app: resolved.app,
      selectedActivity: {
        headline: resolved.detail.headline,
        summary: resolved.detail.summary,
        occurredAt: resolved.detail.occurredAt,
      },
      diffs: resolved.detail.diffs.slice(0, 3),
      windows: {
        baseline30d,
        response30d,
      },
    },
    windows: {
      baseline7d: resolved.detail.aftermath?.baseline7d ?? null,
      baseline30d,
      response1d: resolved.detail.aftermath?.response1d ?? null,
      response7d: resolved.detail.aftermath?.response7d ?? null,
      response30d,
    },
  };
}

function buildReasons(
  pattern: ChangePattern,
  aggregate: Pick<PatternAggregate, 'signalFamilies' | 'storyKinds' | 'announcementCount' | 'changeCount'>,
  metrics: AppMetrics | null
): { confidence: 'high' | 'medium'; reasons: string[] } | null {
  const reasons: string[] = [];

  switch (pattern) {
    case 'marketing_push': {
      const hasPricing = aggregate.signalFamilies.has('pricing');
      const hasMerch = aggregate.signalFamilies.has('media') || aggregate.signalFamilies.has('store-page');
      const hasAnnouncement = aggregate.announcementCount > 0;

      if (!(hasPricing && hasMerch && hasAnnouncement)) {
        return null;
      }

      reasons.push('Announcement activity landed in the same window.');
      reasons.push('Pricing or discount movement is visible.');
      reasons.push('Store-page or media refresh activity is visible.');
      return { confidence: 'high', reasons };
    }

    case 'relaunch_pattern': {
      const hasPricing = aggregate.signalFamilies.has('pricing');
      const hasRefresh = aggregate.signalFamilies.has('media') || aggregate.signalFamilies.has('store-page');
      const hasLaunchSignal =
        aggregate.storyKinds.has('release-prep') || aggregate.announcementCount > 0;

      if (!(hasPricing && hasRefresh && hasLaunchSignal)) {
        return null;
      }

      reasons.push('Pricing changed in the same window as presentation changes.');
      reasons.push('Store-page or media refresh suggests a packaged beat.');
      reasons.push('Launch-adjacent or announcement activity supports a relaunch interpretation.');
      return { confidence: 'high', reasons };
    }

    case 'update_tease': {
      const hasAnnouncement = aggregate.announcementCount > 0;
      const hasRefresh = aggregate.signalFamilies.has('media') || aggregate.signalFamilies.has('store-page');
      const hasBuild = aggregate.signalFamilies.has('build');

      if (!(hasAnnouncement && hasRefresh) || hasBuild) {
        return null;
      }

      reasons.push('Announcements are present without matching build activity yet.');
      reasons.push('Presentation changes suggest setup or teasing behavior.');
      return { confidence: 'medium', reasons };
    }

    case 'under_marketed': {
      if (
        !metrics ||
        (metrics.positivePercentage ?? 0) < 80 ||
        (metrics.totalReviews ?? 0) < 200 ||
        ((metrics.reviewVelocity30d ?? 0) < 1 && !aggregate.signalFamilies.has('build')) ||
        aggregate.announcementCount > 0 ||
        aggregate.signalFamilies.has('media') ||
        aggregate.signalFamilies.has('store-page')
      ) {
        return null;
      }

      reasons.push(`Review quality is ${metrics.positivePercentage}% positive on ${(metrics.totalReviews ?? 0).toLocaleString()} reviews.`);
      reasons.push('Recent build or review-velocity evidence suggests active product work.');
      reasons.push('There is little recent announcement or storefront-refresh evidence.');
      return { confidence: 'medium', reasons };
    }

    case 'signable_candidate': {
      if (
        !metrics ||
        (metrics.positivePercentage ?? 0) < 85 ||
        (metrics.totalReviews ?? 0) < 300 ||
        ((metrics.reviewVelocity30d ?? 0) < 1 && !aggregate.signalFamilies.has('build')) ||
        aggregate.signalFamilies.has('media') ||
        aggregate.signalFamilies.has('store-page')
      ) {
        return null;
      }

      reasons.push(`Review quality is ${metrics.positivePercentage}% positive with ${(metrics.totalReviews ?? 0).toLocaleString()} reviews.`);
      reasons.push('Recent activity suggests the product is still moving.');
      reasons.push('Public marketing execution looks lighter than product quality would justify.');
      return { confidence: 'medium', reasons };
    }

    case 'rescue_candidate': {
      const hasPricing = aggregate.signalFamilies.has('pricing');
      const declining =
        metrics?.trend30dDirection === 'down' ||
        (metrics?.ccuTrend7dPct ?? 0) < 0;

      if (
        !metrics ||
        (metrics.positivePercentage ?? 0) < 70 ||
        (metrics.totalReviews ?? 0) < 100 ||
        !hasPricing ||
        !declining
      ) {
        return null;
      }

      reasons.push(`Sentiment remains ${metrics.positivePercentage}% positive on ${(metrics.totalReviews ?? 0).toLocaleString()} reviews.`);
      reasons.push('Recent pricing or discount activity is visible.');
      reasons.push('Trend data points to softening demand or momentum.');
      return { confidence: 'medium', reasons };
    }

    case 'sustained_response':
      return null;
  }
}

export async function findChangePatterns(args: FindChangePatternsArgs) {
  const days = clamp(args.days, DEFAULT_ACTIVITY_DAYS, 1, MAX_ACTIVITY_DAYS);
  const limit = clamp(args.limit, DEFAULT_PATTERN_LIMIT, 1, MAX_PATTERN_LIMIT);
  const search = normalizeSearch(args.search);
  const appTypes = args.app_types && args.app_types.length > 0
    ? args.app_types
    : DEFAULT_PATTERN_APP_TYPES;
  let rawCandidates: ChatChangePatternCandidateRow[];
  try {
    rawCandidates = await fetchChatChangePatternCandidates({
      pattern: args.pattern,
      days,
      appTypes,
      search,
      limit: INTERNAL_PATTERN_ACTIVITY_LIMIT,
    });
  } catch (error) {
    const classification = classifyChangeIntelError(error);
    return {
      success: false,
      unavailable: true,
      selected_change_surface: 'projection_pattern',
      failure_kind: classification.failureKind,
      error: `Unable to load change-pattern candidates right now. ${classification.userMessage}`,
      sufficient_to_answer: false,
      fallback_allowed: false,
      response_guidance:
        'Say the change-pattern surface is temporarily unavailable and suggest a narrower follow-up such as a specific title, recent store-page changes, or release-timing changes.',
    };
  }
  const fallbackMetrics = await fetchAppMetrics(rawCandidates.map((candidate) => candidate.appid));
  const hydratedCandidates = hydratePatternMetrics(rawCandidates, fallbackMetrics);

  if (args.pattern === 'sustained_response') {
    const details = await Promise.all(
      hydratedCandidates
        .flatMap((candidate) => candidate.activityIds.slice(0, 1))
        .slice(0, 12)
        .map(async (activityId) => {
        const detail = await fetchChangeFeedActivityDetail(activityId);
        if (!detail?.aftermath) {
          return null;
        }

        const reviewDelta = metricDelta(
          detail.aftermath.response7d?.totalReviews ?? null,
          detail.aftermath.baseline7d?.totalReviews ?? null
        );
        const ccuLift = percentLift(
          detail.aftermath.response7d?.ccuPeak ?? null,
          detail.aftermath.baseline7d?.ccuPeak ?? null
        );

        if ((reviewDelta ?? 0) < 25 && (ccuLift ?? 0) < 15) {
          return null;
        }

        const reasons: string[] = [];
        if (reviewDelta != null && reviewDelta >= 25) {
          reasons.push(`7-day review total rose by ${reviewDelta.toLocaleString()} after the change window.`);
        }
        if (ccuLift != null && ccuLift >= 15) {
          reasons.push(`7-day CCU peak was ${ccuLift.toFixed(0)}% above the baseline window.`);
        }

        return {
          appid: detail.appid,
          name: detail.appName,
          occurredAt: detail.occurredAt,
          confidence: reviewDelta != null && reviewDelta >= 50 ? 'high' : 'medium',
          activityId: detail.activityId,
          headline: detail.headline,
          reasons,
          signalFamilies: detail.signalFamilies,
          aftermath: detail.aftermath,
          primaryProof: buildPatternProofPacket(detail),
        };
      })
    );

    const results = details.filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, limit);

    if (results.length === 0) {
      return {
        success: true,
        pattern: args.pattern,
        results: [],
        total_found: 0,
        selected_change_surface: 'projection_pattern',
        no_match: true,
        sufficient_to_answer: true,
        sufficiency_reason: 'No sustained-response candidates met the evidence threshold in the requested window.',
        required_answer_fields: ['what was checked', 'why the evidence was insufficient'],
        response_guidance: 'Explain the checked response threshold and say no candidates cleared it.',
        meta: { days, limit, search },
      };
    }

    return {
      success: true,
      pattern: args.pattern,
      results,
      total_found: results.length,
      selected_change_surface: 'projection_pattern',
      sufficient_to_answer: true,
      sufficiency_reason: 'A ranked sustained-response set with proof packets is available and can be answered directly.',
      required_answer_fields: ['ranked candidates', 'evidence', 'timing', 'why it qualifies'],
      response_guidance: 'For each row, cite the concrete response signal and the post-change window. Avoid canned repeated reasons.',
      presentation_hints: {
        format: 'ranked_change_patterns',
        proof_field: 'primaryProof',
      },
      answer_payload: {
        pattern: args.pattern,
        results: results.map((result) => ({
          appid: result.appid,
          name: result.name,
          occurredAt: result.occurredAt,
          confidence: result.confidence,
          reasons: result.reasons,
          signalFamilies: result.signalFamilies,
          primaryProof: result.primaryProof,
        })),
      },
      meta: { days, limit, search },
    };
  }

  const aggregates = buildPatternAggregates(hydratedCandidates);
  const candidates: PatternCandidate[] = [];

  for (const aggregate of aggregates) {
    const metrics =
      hydratedCandidates.find((candidate) => candidate.appid === aggregate.appid)?.metrics ?? null;
    const decision = buildReasons(args.pattern, aggregate, metrics);

    if (!decision) {
      continue;
    }

    candidates.push({
      appid: aggregate.appid,
      name: aggregate.name,
      occurredAt: aggregate.latestOccurredAt,
      confidence: decision.confidence,
      reasons: decision.reasons,
      signalFamilies: Array.from(aggregate.signalFamilies),
      storyKinds: Array.from(aggregate.storyKinds),
      activityIds: aggregate.activityIds,
      metrics,
      primaryProof: null,
    });
  }

  candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return left.confidence === 'high' ? -1 : 1;
    }

    const rightReviews = right.metrics?.totalReviews ?? 0;
    const leftReviews = left.metrics?.totalReviews ?? 0;
    if (rightReviews !== leftReviews) {
      return rightReviews - leftReviews;
    }

    return right.occurredAt.localeCompare(left.occurredAt);
  });

  const rankedResults = candidates.slice(0, limit);

  if (rankedResults.length === 0) {
    return {
      success: true,
      pattern: args.pattern,
      results: [],
      total_found: 0,
      selected_change_surface: 'projection_pattern',
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'No change-pattern candidates matched the requested evidence threshold.',
      required_answer_fields: ['what was checked', 'time window', 'why no candidate qualified'],
      response_guidance: 'State the requested pattern and why no candidate cleared the evidence threshold.',
      meta: { days, limit, search },
    };
  }

  const results = await hydratePatternProofPackets(rankedResults, Math.min(limit, 5));

  return {
    success: true,
    pattern: args.pattern,
    results,
    total_found: results.length,
    selected_change_surface: 'projection_pattern',
    sparse_result: results.length < Math.min(limit, 3),
    sufficient_to_answer: true,
    sufficiency_reason: 'A ranked pattern set with supporting proof packets is available and can be answered directly.',
    required_answer_fields: ['ranked candidates', 'evidence', 'timing', 'why it qualifies'],
    response_guidance: 'For each row, state the exact evidence behind the pattern and why it matters. Do not reuse identical canned reasons.',
    presentation_hints: {
      format: 'ranked_change_patterns',
      proof_field: 'primaryProof',
    },
    answer_payload: {
      pattern: args.pattern,
      results: results.map((result) => ({
        appid: result.appid,
        name: result.name,
        occurredAt: result.occurredAt,
        confidence: result.confidence,
        reasons: result.reasons,
        signalFamilies: result.signalFamilies,
        primaryProof: result.primaryProof,
      })),
    },
    meta: { days, limit, search },
  };
}
