import 'server-only';

import type { Database } from '@publisheriq/database';
import {
  buildDiffPreview,
  ChangeFeedUnavailableError,
  fetchChangeFeedActivityDetail,
  fetchChangeFeedBurstDetail,
  fetchChatRecentNewsTopicSearch,
  fetchChatRecentNewsDigest,
  fetchChatChangeActivityResponse,
  fetchChatChangePatternCandidates,
  formatChangeLabel,
  parseActivityId,
  type ChatChangePatternCandidateRow,
  type ChangeActivityDetail,
  type ChangeActivityMode,
  type ChangeActivityRow,
  type ChangeRecentNewsFeedScope,
  type ChangeRecentNewsDigestItem,
  type ChangeRecentNewsTopicMatchItem,
  type ChangeRecentNewsScope,
  type ChangeActivitySignalFamily,
  type ChangeActivitySort,
  type ChangeActivityView,
  type ChangeActivityStoryKind,
  type ChangeDetailEvent,
  type JsonValue,
} from '@/app/(main)/changes/lib';
import type { ToolCall } from '@/lib/llm/types';
import { lookupGames, type LookupGamesArgs } from '@/lib/search/game-lookup';
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
const DEFAULT_RECENT_NEWS_DAYS = 14;
const MAX_RECENT_NEWS_DAYS = 30;
const DEFAULT_SINGLE_RECENT_NEWS_LIMIT = 4;
const DEFAULT_MULTI_RECENT_NEWS_LIMIT = 6;
const MAX_RECENT_NEWS_LIMIT = 6;
const DEFAULT_RECENT_NEWS_DETAIL_LIMIT = 3;
const MAX_RECENT_NEWS_DETAIL_LIMIT = 3;
const RECENT_NEWS_DETAIL_MIN_CHARS = 320;
const RECENT_NEWS_DETAIL_MIN_UNITS = 2;
const DEFAULT_NEWS_TOPIC_DAYS = 30;
const MAX_NEWS_TOPIC_DAYS = 30;
const DEFAULT_NEWS_TOPIC_LIMIT = 8;
const MAX_NEWS_TOPIC_LIMIT = 10;
const DEFAULT_NEWS_TOPIC_FEED_SCOPE: ChangeRecentNewsFeedScope = 'community_announcements';
const DEFAULT_PATTERN_LIMIT = 10;
const MAX_PATTERN_LIMIT = 10;
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
  | 'sustained_response'
  | 'announcement_weak_response';

export interface QueryChangeActivityArgs {
  days?: number;
  view?: ChangeActivityView;
  mode?: ChangeActivityMode;
  sort?: ChangeActivitySort;
  app_types?: AppType[];
  signal_families?: ChangeActivitySignalFamily[];
  search?: string;
  limit?: number;
  excludeActivityIds?: string[];
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

export interface GetRecentNewsDigestArgs {
  app_name?: string;
  appid?: number;
  app_names?: string[];
  appids?: number[];
  days?: number;
  limit?: number;
}

export interface GetRecentNewsDetailArgs {
  app_name?: string;
  appid?: number;
  days?: number;
  limit?: number;
}

export interface SearchRecentNewsTopicsArgs {
  query?: string;
  days?: number;
  limit?: number;
  feed_scope?: ChangeRecentNewsFeedScope;
  app_types?: AppType[];
  appids?: number[];
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
  excludeAppIds?: number[];
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

interface ResolveAppReferencesResult {
  apps: ResolvedApp[];
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

interface NewsTopicDefinition {
  key: string;
  canonicalQuery: string;
  phrases: string[];
  patterns: RegExp[];
}

interface CheckedDateWindow {
  windowStart: string;
  windowEnd: string;
}

const NEWS_TOPIC_DEFINITIONS: NewsTopicDefinition[] = [
  {
    key: 'developer_diary',
    canonicalQuery: 'developer diary',
    phrases: ['developer diary', 'developer diaries', 'dev diary', 'dev diaries', 'devlog', 'behind the scenes', 'development update'],
    patterns: [
      /\bdeveloper diar(?:y|ies)\b/i,
      /\bdev diar(?:y|ies)\b/i,
      /\bdevlog\b/i,
      /\bbehind[- ]the[- ]scenes\b/i,
      /\bdevelopment update\b/i,
    ],
  },
  {
    key: 'roadmap',
    canonicalQuery: 'roadmap',
    phrases: ['roadmap', "what's next", 'what is next', 'future plans'],
    patterns: [/\broadmap\b/i, /\bwhat(?:'s| is) next\b/i, /\bfuture plans\b/i],
  },
  {
    key: 'demo_playtest',
    canonicalQuery: 'demo or playtest',
    phrases: ['demo', 'demo available', 'playtest', 'public playtest'],
    patterns: [/\bdemo\b/i, /\bplaytest\b/i, /\bpublic playtest\b/i],
  },
  {
    key: 'patch_notes',
    canonicalQuery: 'patch notes',
    phrases: ['patch notes', 'update notes', 'release notes'],
    patterns: [/\bpatch notes?\b/i, /\bupdate notes?\b/i, /\brelease notes?\b/i],
  },
  {
    key: 'behind_the_scenes',
    canonicalQuery: 'behind the scenes',
    phrases: ['behind the scenes', 'behind-the-scenes', 'inside look', 'development insight'],
    patterns: [/\bbehind[- ]the[- ]scenes\b/i, /\binside look\b/i, /\bdevelopment insight\b/i],
  },
];

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

function buildCheckedDateWindow(days: number): CheckedDateWindow {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    windowStart: windowStart.toISOString().split('T')[0] ?? '',
    windowEnd: windowEnd.toISOString().split('T')[0] ?? '',
  };
}

function toResolvedApp(row: {
  appid: number;
  name: string;
  release_date?: string | null;
  type?: AppType | null;
}): ResolvedApp {
  return {
    appid: row.appid,
    name: row.name,
    appType: row.type ?? 'game',
    releaseYear: row.release_date ? new Date(row.release_date).getFullYear() : null,
    isExactMatch: true,
    alternatives: [],
  };
}

async function findExactGameMatchesByName(appName: string): Promise<ResolvedApp[]> {
  const normalizedName = normalizeSearch(appName);
  if (!normalizedName) {
    return [];
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('apps')
    .select('appid, name, release_date, type')
    .eq('type', 'game')
    .ilike('name', normalizedName)
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(MAX_AMBIGUITY_CANDIDATES + 1);

  if (error || !data || data.length === 0) {
    return [];
  }

  return data.map((row) => toResolvedApp(row));
}

function splitExplicitTitleList(value: string): string[] {
  return value
    .replace(/\s+/g, ' ')
    .split(/\s*,\s*|\s+and\s+/i)
    .map((item) => normalizeSearch(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
}

function extractExplicitMultiTitleNewsTargets(userPrompt: string | undefined): string[] {
  const prompt = normalizeSearch(userPrompt);
  if (!prompt) {
    return [];
  }

  const patterns = [
    /\bsummar(?:y|ize)\b.+?\bacross\s+(.+?)(?:[?.!]|$)/i,
    /\bwhich of\s+(.+?)\s+h(?:ad|as)\s+the most material recent steam news change/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const rawList = normalizeSearch(match?.[1]);
    if (!rawList) {
      continue;
    }

    const titles = splitExplicitTitleList(rawList);
    if (titles.length >= 2) {
      return titles;
    }
  }

  return [];
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

  const exactMatches = await findExactGameMatchesByName(appName);
  if (exactMatches.length === 1) {
    return {
      app: exactMatches[0] ?? null,
    };
  }

  if (exactMatches.length > 1) {
    const candidates = exactMatches.slice(0, MAX_AMBIGUITY_CANDIDATES).map((candidate) => ({
      appid: candidate.appid,
      name: candidate.name,
      releaseYear: candidate.releaseYear,
      similarityScore: candidate.similarityScore,
      isExactMatch: true,
    }));

    return {
      app: null,
      error: buildAmbiguousGameError(appName, candidates),
      candidates,
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

async function resolveAppReferences(args: {
  appids?: number[];
  app_names?: string[];
}): Promise<ResolveAppReferencesResult> {
  const appIds = Array.from(new Set((args.appids ?? []).filter((value): value is number => Number.isInteger(value))));
  if (appIds.length > 0) {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('apps')
      .select('appid, name, release_date, type')
      .in('appid', appIds.slice(0, 3));

    if (error || !data || data.length === 0) {
      return {
        apps: [],
        error: 'Unable to resolve the requested games for recent news.',
      };
    }

    const byAppId = new Map<number, ResolvedApp>(
      data.map((row): [number, ResolvedApp] => [
        row.appid,
        {
          appid: row.appid,
          name: row.name,
          appType: row.type ?? 'game',
          releaseYear: row.release_date ? new Date(row.release_date).getFullYear() : null,
          alternatives: [],
        },
      ])
    );
    const resolvedApps = appIds
      .map((appid) => byAppId.get(appid))
      .filter((app): app is ResolvedApp => Boolean(app));

    if (resolvedApps.length === 0) {
      return {
        apps: [],
        error: 'Unable to resolve the requested games for recent news.',
      };
    }

    return {
      apps: resolvedApps,
    };
  }

  const appNames = Array.from(
    new Set((args.app_names ?? []).map((value) => value.trim()).filter((value) => value.length > 0))
  ).slice(0, 3);

  if (appNames.length === 0) {
    return {
      apps: [],
      error: 'At least one Steam game name or appid is required for recent news.',
    };
  }

  const resolvedApps: ResolvedApp[] = [];
  for (const appName of appNames) {
    const resolved = await resolveAppReference({ app_name: appName });
    if (!resolved.app) {
      return {
        apps: [],
        error: resolved.error ?? `Unable to resolve "${appName}" to a Steam game.`,
        candidates: resolved.candidates,
      };
    }

    resolvedApps.push(resolved.app);
  }

  return {
    apps: resolvedApps,
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

function shouldUseAnnouncementWeakResponsePattern(userPrompt: string | undefined): boolean {
  const prompt = normalizeSearch(userPrompt)?.toLowerCase();
  if (!prompt) {
    return false;
  }

  const mentionsAnnouncement = /\bannouncement\b/.test(prompt);
  const mentionsWeakResponse =
    /\bweak\b/.test(prompt) ||
    /\bdownstream\b/.test(prompt) ||
    /\bsoft\b/.test(prompt) ||
    /\blimited\b/.test(prompt) ||
    /\bunderwhelming\b/.test(prompt);
  const mentionsOutcome =
    /\bccu\b/.test(prompt) ||
    /\breview\b/.test(prompt) ||
    /\bresponse\b/.test(prompt) ||
    /\bmomentum\b/.test(prompt);

  return mentionsAnnouncement && mentionsWeakResponse && mentionsOutcome;
}

function resolveNewsTopicDefinition(value: string | undefined): NewsTopicDefinition | null {
  const normalized = normalizeSearch(value);
  if (!normalized) {
    return null;
  }

  return (
    NEWS_TOPIC_DEFINITIONS.find((definition) =>
      definition.patterns.some((pattern) => pattern.test(normalized))
    ) ?? null
  );
}

function isCrossGameTopicPrompt(userPrompt: string | undefined): boolean {
  const prompt = normalizeSearch(userPrompt)?.toLowerCase();
  if (!prompt) {
    return false;
  }

  return (
    /\bwhat games\b/.test(prompt) ||
    /\bwhich games\b/.test(prompt) ||
    /\bacross all news\b/.test(prompt) ||
    /\bacross games\b/.test(prompt) ||
    /\blately\b/.test(prompt) ||
    /\brecent(?:ly)?\b/.test(prompt)
  );
}

function extractRecentNewsTopicQuery(
  args?: Partial<QueryChangeActivityArgs & SearchRecentNewsTopicsArgs>,
  userPrompt?: string
): {
  query: string;
  aliases: string[];
} | null {
  const argsSearch = args?.search ? normalizeSearch(args.search) : null;
  const argsQuery = args?.query ? normalizeSearch(args.query) : null;
  const definition =
    resolveNewsTopicDefinition(argsSearch ?? undefined) ??
    resolveNewsTopicDefinition(argsQuery ?? undefined) ??
    resolveNewsTopicDefinition(userPrompt);

  if (definition) {
    return {
      query: definition.canonicalQuery,
      aliases: definition.phrases,
    };
  }

  const explicitQuery = argsSearch ?? argsQuery;
  if (!explicitQuery) {
    return null;
  }

  return {
    query: explicitQuery,
    aliases: [explicitQuery],
  };
}

function shouldUseRecentNewsTopicSearch(
  userPrompt: string | undefined,
  args?: QueryChangeActivityArgs | SearchRecentNewsTopicsArgs
): boolean {
  if (!isCrossGameTopicPrompt(userPrompt)) {
    return false;
  }

  return extractRecentNewsTopicQuery(args ?? {}, userPrompt) !== null;
}

function shouldUseRecentNewsDetail(userPrompt: string | undefined): boolean {
  const prompt = normalizeSearch(userPrompt)?.toLowerCase();
  if (!prompt) {
    return false;
  }

  const mentionsNews = /\bnews\b/.test(prompt) || /\bannouncement\b/.test(prompt);
  const mentionsDetailIntent =
    /\bwhat actually changed\b/.test(prompt) ||
    /\blatest\b/.test(prompt) ||
    /\bnewest\b/.test(prompt) ||
    /\bmost recent\b/.test(prompt);
  const mentionsDigestIntent =
    /\bsummar(?:y|ize)\b/.test(prompt) ||
    /\bupdates?\b/.test(prompt) ||
    /\brecent news\b/.test(prompt);

  return mentionsNews && mentionsDetailIntent && !mentionsDigestIntent;
}

function shouldUseRecentNewsDigest(userPrompt: string | undefined): boolean {
  const prompt = normalizeSearch(userPrompt)?.toLowerCase();
  if (!prompt) {
    return false;
  }

  if (shouldUseRecentNewsDetail(userPrompt) || shouldUseRecentNewsTopicSearch(userPrompt)) {
    return false;
  }

  const mentionsNews = /\bnews\b/.test(prompt) || /\bannouncement\b/.test(prompt);
  const mentionsDigestIntent =
    /\bsummar(?:y|ize)\b/.test(prompt) ||
    /\bupdate(?:s)?\b/.test(prompt) ||
    /\blatest\b/.test(prompt) ||
    /\brecent\b/.test(prompt) ||
    /\bwhat actually changed\b/.test(prompt);

  return mentionsNews && mentionsDigestIntent;
}

function buildRecentNewsDateMeta(days: number): { days: number } & CheckedDateWindow {
  return {
    days,
    ...buildCheckedDateWindow(days),
  };
}

function countNewsDetailUnits(body: string | null): number {
  const normalized = body?.trim() ?? null;
  if (!normalized) {
    return 0;
  }

  return normalized
    .split(/(?:[.!?]+\s+)|(?:\s*[-*]\s+)|(?:\n+)/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length >= 24).length;
}

function shouldUseSingleItemNewsDetail(item: ChangeRecentNewsDigestItem | null | undefined): boolean {
  if (!item) {
    return false;
  }

  const body = item.bodyPreview ?? item.excerpt ?? null;
  if (!body) {
    return false;
  }

  return body.length >= RECENT_NEWS_DETAIL_MIN_CHARS || countNewsDetailUnits(body) >= RECENT_NEWS_DETAIL_MIN_UNITS;
}

function patternNeedsLiveMetrics(pattern: ChangePattern): boolean {
  return pattern === 'under_marketed' || pattern === 'signable_candidate' || pattern === 'rescue_candidate';
}

function isResponsePattern(pattern: ChangePattern): pattern is 'sustained_response' | 'announcement_weak_response' {
  return pattern === 'sustained_response' || pattern === 'announcement_weak_response';
}

function getPatternRpcLimit(limit: number): number {
  return Math.min(Math.max(limit * 2, 20), 30);
}

function getPatternShortlistWindowDays(days: number): number {
  if (days <= 7) {
    return 7;
  }

  if (days <= 30) {
    return 30;
  }

  if (days <= 90) {
    return 90;
  }

  return 180;
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
  const explicitMultiTitleTargets = extractExplicitMultiTitleNewsTargets(userPrompt);

  if (toolCall.name === 'lookup_games') {
    const args = toolCall.arguments as unknown as LookupGamesArgs;
    const normalizedQuery = normalizeSearch(args.query);

    if (shouldUseRecentNewsTopicSearch(userPrompt)) {
      const topicQuery = extractRecentNewsTopicQuery(
        normalizedQuery ? { query: normalizedQuery } : {},
        userPrompt
      );
      if (topicQuery) {
        return {
          ...toolCall,
          name: 'search_recent_news_topics',
          arguments: {
            query: topicQuery.query,
          } as unknown as Record<string, unknown>,
        };
      }
    }

    if (explicitMultiTitleTargets.length >= 2 && shouldUseRecentNewsDigest(userPrompt)) {
      return {
        ...toolCall,
        name: 'get_recent_news_digest',
        arguments: {
          app_names: explicitMultiTitleTargets,
        } as unknown as Record<string, unknown>,
      };
    }

    if (normalizedQuery && shouldUseRecentNewsDetail(userPrompt)) {
      return {
        ...toolCall,
        name: 'get_recent_news_detail',
        arguments: {
          app_name: normalizedQuery,
        } as unknown as Record<string, unknown>,
      };
    }

    if (normalizedQuery && shouldUseRecentNewsDigest(userPrompt)) {
      return {
        ...toolCall,
        name: 'get_recent_news_digest',
        arguments: {
          app_name: normalizedQuery,
        } as unknown as Record<string, unknown>,
      };
    }
  }

  if (toolCall.name === 'get_recent_news_digest' && shouldUseRecentNewsDetail(userPrompt)) {
    const args = toolCall.arguments as GetRecentNewsDigestArgs;
    const hasMultipleTargets = (args.appids?.length ?? 0) > 0 || (args.app_names?.length ?? 0) > 0;
    if (!hasMultipleTargets) {
      return {
        ...toolCall,
        name: 'get_recent_news_detail',
        arguments: {
          appid: args.appid,
          app_name: args.app_name,
          days: args.days,
          limit: args.limit,
        } as unknown as Record<string, unknown>,
      };
    }
  }

  if (toolCall.name === 'get_recent_news_digest' && explicitMultiTitleTargets.length >= 2) {
    const args = toolCall.arguments as GetRecentNewsDigestArgs;
    const hasMultipleTargets =
      (args.appids?.length ?? 0) > 1 ||
      (args.app_names?.length ?? 0) > 1;

    if (!hasMultipleTargets && shouldUseRecentNewsDigest(userPrompt)) {
      return {
        ...toolCall,
        arguments: {
          app_names: explicitMultiTitleTargets,
          days: args.days,
          limit: args.limit,
        } as unknown as Record<string, unknown>,
      };
    }
  }

  if (toolCall.name !== 'query_change_activity') {
    return toolCall;
  }

  const args = toolCall.arguments as QueryChangeActivityArgs;
  const topicQuery = extractRecentNewsTopicQuery(args, userPrompt);
  if (shouldUseRecentNewsTopicSearch(userPrompt, args) && topicQuery) {
    return {
      ...toolCall,
      name: 'search_recent_news_topics',
      arguments: {
        query: topicQuery.query,
        days: args.days,
        limit: args.limit,
        app_types: args.app_types,
      } as unknown as Record<string, unknown>,
    };
  }

  if (explicitMultiTitleTargets.length >= 2 && shouldUseRecentNewsDigest(userPrompt)) {
    return {
      ...toolCall,
      name: 'get_recent_news_digest',
      arguments: {
        app_names: explicitMultiTitleTargets,
        days: args.days,
        limit: args.limit,
      } as unknown as Record<string, unknown>,
    };
  }

  const timelineArgs = await resolveSingleTitleTimelineArgs(args, userPrompt);
  if (timelineArgs && shouldUseRecentNewsDetail(userPrompt)) {
    return {
      ...toolCall,
      name: 'get_recent_news_detail',
      arguments: {
        appid: timelineArgs.appid,
        app_name: timelineArgs.app_name,
        days: args.days,
        limit: args.limit,
      } as unknown as Record<string, unknown>,
    };
  }

  if (timelineArgs && shouldUseRecentNewsDigest(userPrompt)) {
    return {
      ...toolCall,
      name: 'get_recent_news_digest',
      arguments: {
        appid: timelineArgs.appid,
        app_name: timelineArgs.app_name,
        days: args.days,
        limit: args.limit,
      } as unknown as Record<string, unknown>,
    };
  }

  if (!timelineArgs) {
    if (shouldUseAnnouncementWeakResponsePattern(userPrompt)) {
      return {
        ...toolCall,
        name: 'find_change_patterns',
        arguments: {
          pattern: 'announcement_weak_response',
          days: args.days,
          search: normalizeSearch(args.search) ?? undefined,
          app_types: args.app_types,
          limit: args.limit,
        } as unknown as Record<string, unknown>,
      };
    }

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

function candidateHasEmbeddedMetrics(candidate: ChatChangePatternCandidateRow): boolean {
  return (
    candidate.positivePercentage != null ||
    candidate.totalReviews != null ||
    candidate.reviewVelocity30d != null ||
    candidate.reviewVelocity7d != null ||
    candidate.ccuTrend7dPct != null
  );
}

function hydratePatternMetrics(
  candidates: ChatChangePatternCandidateRow[],
  fallbackMetrics: Map<number, AppMetrics>
): Array<ChatChangePatternCandidateRow & { metrics: AppMetrics | null }> {
  return candidates.map((candidate) => {
    const existingMetrics = candidateHasEmbeddedMetrics(candidate)
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

function buildResponsePatternCandidate(
  pattern: Extract<ChangePattern, 'sustained_response' | 'announcement_weak_response'>,
  detail: ChangeActivityDetail
) {
  if (!detail.aftermath) {
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

  if (pattern === 'sustained_response') {
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
  }

  const hasRelatedAnnouncement = detail.relatedAnnouncements.length > 0 || detail.signalFamilies.includes('announcement');
  const weakReviewResponse = reviewDelta == null || reviewDelta < 10;
  const weakCcuResponse = ccuLift == null || ccuLift < 5;

  if (!hasRelatedAnnouncement || (!weakReviewResponse && !weakCcuResponse)) {
    return null;
  }

  const reasons: string[] = ['A recent announcement is attached to the same change window.'];
  if (reviewDelta != null) {
    reasons.push(`7-day review total moved by only ${reviewDelta.toLocaleString()} after the announcement window.`);
  } else {
    reasons.push('Review totals did not show a clear 7-day lift after the announcement window.');
  }
  if (ccuLift != null) {
    reasons.push(`7-day CCU peak was only ${ccuLift.toFixed(0)}% above the baseline window.`);
  } else {
    reasons.push('CCU did not show a clear post-announcement lift.');
  }

  return {
    appid: detail.appid,
    name: detail.appName,
    occurredAt: detail.occurredAt,
    confidence: weakReviewResponse && weakCcuResponse ? 'high' : 'medium',
    activityId: detail.activityId,
    headline: detail.headline,
    reasons,
    signalFamilies: detail.signalFamilies,
    aftermath: detail.aftermath,
    primaryProof: buildPatternProofPacket(detail),
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
  const excludeActivityIds = Array.isArray(args.excludeActivityIds)
    ? args.excludeActivityIds.filter((value): value is string => typeof value === 'string')
    : [];

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
      excludeActivityIds,
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

export async function getRecentNewsDigest(args: GetRecentNewsDigestArgs) {
  const hasMultipleTargets = (args.appids?.length ?? 0) > 0 || (args.app_names?.length ?? 0) > 0;
  const scope: ChangeRecentNewsScope = hasMultipleTargets ? 'multi_app' : 'single_app';
  const resolvedAppsResult = hasMultipleTargets
    ? await resolveAppReferences({
        appids: args.appids,
        app_names: args.app_names,
      })
    : (() => null)();

  const resolvedSingleApp = hasMultipleTargets
    ? null
    : await resolveAppReference({
        appid: args.appid,
        app_name: args.app_name,
      });

  const resolvedApps = hasMultipleTargets
    ? resolvedAppsResult?.apps ?? []
    : resolvedSingleApp?.app
      ? [resolvedSingleApp.app]
      : [];
  const resolutionError = hasMultipleTargets
    ? resolvedAppsResult?.error
    : resolvedSingleApp?.error;
  const resolutionCandidates = hasMultipleTargets
    ? resolvedAppsResult?.candidates ?? []
    : resolvedSingleApp?.candidates ?? [];

  if (resolvedApps.length === 0) {
    return {
      success: false,
      error: resolutionError ?? 'Unable to resolve the requested game or games for recent news.',
      candidates: resolutionCandidates,
    };
  }

  const days = clamp(args.days, DEFAULT_RECENT_NEWS_DAYS, 1, MAX_RECENT_NEWS_DAYS);
  const checkedWindow = buildRecentNewsDateMeta(days);
  const limit = clamp(
    args.limit,
    scope === 'single_app' ? DEFAULT_SINGLE_RECENT_NEWS_LIMIT : DEFAULT_MULTI_RECENT_NEWS_LIMIT,
    1,
    MAX_RECENT_NEWS_LIMIT
  );
  const items = await fetchChatRecentNewsDigest({
    appIds: resolvedApps.map((app) => app.appid),
    days,
    limit,
    perAppLimit: scope === 'multi_app' ? 2 : null,
  });

  if (items.length === 0) {
    return {
      success: true,
      app: scope === 'single_app' ? resolvedApps[0] : undefined,
      apps: resolvedApps,
      scope,
      total_found: 0,
      selected_change_surface: 'recent_news_digest',
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'No recent Steam news items were found in the requested window.',
      required_answer_fields: ['checked time window', 'which titles were checked', 'that no qualifying recent news was found'],
      response_guidance: 'State the checked titles and exact checked window from meta.windowStart to meta.windowEnd. Do not imply there were recent news updates when none were found.',
      items: [],
      meta: {
        ...checkedWindow,
        limit,
      },
    };
  }

  return {
    success: true,
    app: scope === 'single_app' ? resolvedApps[0] : undefined,
    apps: resolvedApps,
    scope,
    total_found: items.length,
    selected_change_surface: 'recent_news_digest',
    sufficient_to_answer: true,
    sufficiency_reason: 'A bounded recent-news digest is available and can be answered directly from the stored news copy.',
    required_answer_fields: ['dates', 'news titles', 'concrete changes from the news copy'],
    response_guidance:
      'Use a short intro sentence and 2-4 bullets. Each bullet should name the game, the exact date, and the concrete update from the news body. Avoid generic announcement filler.',
    presentation_hints: {
      format: 'recent_news_digest',
      proof_field: 'items',
    },
    items,
    answer_payload: {
      scope,
      apps: resolvedApps.map((app) => ({
        appid: app.appid,
        name: app.name,
      })),
      items: items.map((item: ChangeRecentNewsDigestItem) => ({
        appid: item.appid,
        appName: item.appName,
        title: item.title,
        publishedAt: item.publishedAt,
        firstSeenAt: item.firstSeenAt,
        excerpt: item.excerpt,
        bodyPreview: item.bodyPreview,
      })),
    },
    meta: {
      ...checkedWindow,
      limit,
    },
  };
}

export async function getRecentNewsDetail(args: GetRecentNewsDetailArgs) {
  const resolved = await resolveAppReference({
    appid: args.appid,
    app_name: args.app_name,
  });

  if (!resolved.app) {
    return {
      success: false,
      error: resolved.error ?? 'Unable to resolve the requested game for recent news.',
      candidates: resolved.candidates ?? [],
    };
  }

  const days = clamp(args.days, DEFAULT_RECENT_NEWS_DAYS, 1, MAX_RECENT_NEWS_DAYS);
  const checkedWindow = buildRecentNewsDateMeta(days);
  const limit = clamp(args.limit, DEFAULT_RECENT_NEWS_DETAIL_LIMIT, 1, MAX_RECENT_NEWS_DETAIL_LIMIT);
  const items = await fetchChatRecentNewsDigest({
    appIds: [resolved.app.appid],
    days,
    limit,
    perAppLimit: null,
  });

  if (items.length === 0) {
    return {
      success: true,
      app: resolved.app,
      scope: 'single_app' as const,
      total_found: 0,
      selected_change_surface: 'recent_news_detail',
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'No recent Steam news items were found for the requested title in the checked window.',
      required_answer_fields: ['checked time window', 'which title was checked', 'that no qualifying recent news was found'],
      response_guidance: 'State the checked title and exact checked window from meta.windowStart to meta.windowEnd. Do not imply there were recent news updates when none were found.',
      items: [],
      meta: {
        ...checkedWindow,
        limit,
        detailMode: 'no_match',
      },
    };
  }

  const latestItem = items[0];
  const detailMode = shouldUseSingleItemNewsDetail(latestItem) ? 'latest_item' : 'fallback_digest';
  const detailItems = detailMode === 'latest_item' ? [latestItem] : items.slice(0, Math.min(items.length, 3));

  return {
    success: true,
    app: resolved.app,
    scope: 'single_app' as const,
    total_found: detailItems.length,
    selected_change_surface: 'recent_news_detail',
    sufficient_to_answer: true,
    sufficiency_reason:
      detailMode === 'latest_item'
        ? 'The newest Steam news item is substantial enough to answer from the latest post alone.'
        : 'The newest Steam news item is too thin on its own, so a short fallback digest gives the necessary context.',
    required_answer_fields:
      detailMode === 'latest_item'
        ? ['date', 'latest news title', 'concrete changes from the latest news body']
        : ['dates', 'news titles', 'concrete changes from the recent news copy'],
    response_guidance:
      detailMode === 'latest_item'
        ? 'Use one short intro sentence and 2-5 bullets from the newest item only. Each bullet should summarize a concrete change or takeaway from the latest news body and include the exact date.'
        : 'The newest item is too thin on its own. Use one short intro sentence and 2-4 bullets across the most recent 2-3 items, naming the exact date and concrete update from each item.',
    presentation_hints: {
      format: 'recent_news_detail',
      proof_field: 'items',
    },
    items: detailItems,
    latestItem,
    detail_mode: detailMode,
    answer_payload: {
      detailMode,
      app: {
        appid: resolved.app.appid,
        name: resolved.app.name,
      },
      latestItem: {
        appid: latestItem.appid,
        appName: latestItem.appName,
        title: latestItem.title,
        publishedAt: latestItem.publishedAt,
        firstSeenAt: latestItem.firstSeenAt,
        excerpt: latestItem.excerpt,
        bodyPreview: latestItem.bodyPreview,
      },
      items: detailItems.map((item) => ({
        appid: item.appid,
        appName: item.appName,
        title: item.title,
        publishedAt: item.publishedAt,
        firstSeenAt: item.firstSeenAt,
        excerpt: item.excerpt,
        bodyPreview: item.bodyPreview,
      })),
    },
    meta: {
      ...checkedWindow,
      limit,
      detailMode,
    },
  };
}

export async function searchRecentNewsTopics(args: SearchRecentNewsTopicsArgs) {
  const topicQuery = extractRecentNewsTopicQuery(args);
  if (!topicQuery) {
    return {
      success: false,
      error: 'A recent-news topic query is required, such as developer diary, roadmap, demo, playtest, or patch notes.',
    };
  }

  const days = clamp(args.days, DEFAULT_NEWS_TOPIC_DAYS, 1, MAX_NEWS_TOPIC_DAYS);
  const limit = clamp(args.limit, DEFAULT_NEWS_TOPIC_LIMIT, 1, MAX_NEWS_TOPIC_LIMIT);
  const checkedWindow = buildRecentNewsDateMeta(days);
  const appTypes = args.app_types && args.app_types.length > 0 ? args.app_types : DEFAULT_PATTERN_APP_TYPES;
  const appIds = Array.from(new Set((args.appids ?? []).filter((value): value is number => Number.isInteger(value)))).slice(0, 10);
  const feedScope = args.feed_scope ?? DEFAULT_NEWS_TOPIC_FEED_SCOPE;

  let items: ChangeRecentNewsTopicMatchItem[];
  try {
    items = await fetchChatRecentNewsTopicSearch({
      query: topicQuery.query,
      aliases: topicQuery.aliases,
      appIds: appIds.length > 0 ? appIds : null,
      appTypes,
      days,
      limit,
      feedScope,
    });
  } catch (error) {
    if (error instanceof ChangeFeedUnavailableError) {
      return {
        success: false,
        unavailable: true,
        error: 'Recent news topic search is not available yet. Backfill the latest-news projection first.',
      };
    }

    const classified = classifyChangeIntelError(error);
    return {
      success: false,
      unavailable: classified.failureKind === 'projection_unavailable',
      error: `${classified.userMessage} It was checking ${feedScope.replace(/_/g, ' ')} for "${topicQuery.query}" from ${checkedWindow.windowStart} to ${checkedWindow.windowEnd}. Try narrowing the topic or limiting it to one title.`,
      failure_kind: classified.failureKind,
      meta: {
        ...checkedWindow,
        limit,
        query: topicQuery.query,
        feedScope,
        appTypes,
      },
    };
  }

  if (items.length === 0) {
    return {
      success: true,
      total_found: 0,
      selected_change_surface: 'recent_news_topic_search',
      no_match: true,
      sufficient_to_answer: true,
      sufficiency_reason: 'No recent official Steam news items matched the requested topic in the checked window.',
      required_answer_fields: ['checked time window', 'searched topic', 'that no qualifying recent news was found'],
      response_guidance: 'State the searched topic, official-news scope, and exact checked window from meta.windowStart to meta.windowEnd. Do not imply matches were found when none qualified.',
      items: [],
      meta: {
        ...checkedWindow,
        limit,
        query: topicQuery.query,
        feedScope,
        appTypes,
      },
    };
  }

  return {
    success: true,
    total_found: items.length,
    selected_change_surface: 'recent_news_topic_search',
    sufficient_to_answer: true,
    sufficiency_reason: 'The result set is grounded in bounded recent official Steam news text that matched the requested topic.',
    required_answer_fields: ['matched games', 'dates', 'matched topic evidence', 'why each result matched'],
    response_guidance:
      'Use one short intro sentence and 3-6 bullets. Each bullet should name the game, the exact date, the matching headline or excerpt, and why it matched the topic.',
    presentation_hints: {
      format: 'recent_news_topic_search',
      proof_field: 'items',
    },
    items,
    answer_payload: {
      query: topicQuery.query,
      aliases: topicQuery.aliases,
      items: items.map((item) => ({
        appid: item.appid,
        appName: item.appName,
        title: item.title,
        publishedAt: item.publishedAt,
        firstSeenAt: item.firstSeenAt,
        excerpt: item.excerpt,
        bodyPreview: item.bodyPreview,
        matchReason: item.matchReason,
      })),
    },
    meta: {
      ...checkedWindow,
      limit,
      query: topicQuery.query,
      feedScope,
      appTypes,
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
    case 'announcement_weak_response':
      return null;
  }
}

export async function findChangePatterns(args: FindChangePatternsArgs) {
  const days = clamp(args.days, DEFAULT_ACTIVITY_DAYS, 1, MAX_ACTIVITY_DAYS);
  const limit = clamp(args.limit, DEFAULT_PATTERN_LIMIT, 1, MAX_PATTERN_LIMIT);
  const search = normalizeSearch(args.search);
  const appTypes = args.app_types && args.app_types.length > 0 ? args.app_types : DEFAULT_PATTERN_APP_TYPES;
  const shortlistWindowDays = getPatternShortlistWindowDays(days);
  const excludeAppIds = Array.isArray(args.excludeAppIds)
    ? args.excludeAppIds.filter((value): value is number => typeof value === 'number')
    : [];
  let rawCandidates: ChatChangePatternCandidateRow[];
  try {
    rawCandidates = await fetchChatChangePatternCandidates({
      pattern: args.pattern,
      days,
      appTypes,
      search,
      limit: Math.min(Math.max(limit + excludeAppIds.length + 10, getPatternRpcLimit(limit)), 80),
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
  const meta = {
    days,
    limit,
    search,
    evaluatedDays: days,
    shortlistWindowDays,
    shortlistCount: rawCandidates.length,
    excludedAppCount: excludeAppIds.length,
  };
  const filteredRawCandidates =
    excludeAppIds.length > 0
      ? rawCandidates.filter((candidate) => !excludeAppIds.includes(candidate.appid))
      : rawCandidates;

  if (isResponsePattern(args.pattern)) {
    const responsePattern = args.pattern;
    const details = await Promise.all(
      filteredRawCandidates.slice(0, Math.min(limit * 2, 8)).map(async (candidate) => {
        const activityId = candidate.activityIds[0];
        if (!activityId) {
          return null;
        }

        const detail = await fetchChangeFeedActivityDetail(activityId).catch(() => null);
        if (!detail) {
          return null;
        }

        return buildResponsePatternCandidate(responsePattern, detail);
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
        sufficiency_reason:
          args.pattern === 'announcement_weak_response'
            ? 'No recent announcement windows showed a clearly weak downstream response in the requested timeframe.'
            : 'No sustained-response candidates met the evidence threshold in the requested window.',
        required_answer_fields: ['what was checked', 'why the evidence was insufficient'],
        response_guidance:
          args.pattern === 'announcement_weak_response'
            ? 'Explain that the query looked for announcement-linked change windows with weak follow-through and that no candidates cleared the threshold.'
            : 'Explain the checked response threshold and say no candidates cleared it.',
        meta,
      };
    }

    return {
      success: true,
      pattern: args.pattern,
      results,
      total_found: results.length,
      selected_change_surface: 'projection_pattern',
      sufficient_to_answer: true,
      sufficiency_reason:
        args.pattern === 'announcement_weak_response'
          ? 'A ranked announcement-response set with proof packets is available and can be answered directly.'
          : 'A ranked sustained-response set with proof packets is available and can be answered directly.',
      required_answer_fields: ['ranked candidates', 'evidence', 'timing', 'why it qualifies'],
      response_guidance:
        args.pattern === 'announcement_weak_response'
          ? 'For each row, cite the attached announcement evidence and the weak downstream response window. Avoid generic “low engagement” filler.'
          : 'For each row, cite the concrete response signal and the post-change window. Avoid canned repeated reasons.',
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
      meta,
    };
  }

  const fallbackMetrics = patternNeedsLiveMetrics(args.pattern)
    ? await fetchAppMetrics(
        filteredRawCandidates
          .filter((candidate) => !candidateHasEmbeddedMetrics(candidate))
          .map((candidate) => candidate.appid)
      )
    : new Map<number, AppMetrics>();
  const hydratedCandidates = hydratePatternMetrics(filteredRawCandidates, fallbackMetrics);

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
      meta,
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
    meta,
  };
}
