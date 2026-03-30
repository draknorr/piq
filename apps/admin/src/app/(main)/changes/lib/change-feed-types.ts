import type { Database } from '@publisheriq/database';

export type AppType = Database['public']['Enums']['app_type'];

export const CHANGE_ACTIVITY_VIEWS = [
  'overview',
  'launch-watch',
  'commercial-moves',
  'store-refreshes',
  'all-activity',
] as const;

export type ChangeActivityView = (typeof CHANGE_ACTIVITY_VIEWS)[number];

export const CHANGE_ACTIVITY_MODES = ['all', 'changes', 'announcements'] as const;

export type ChangeActivityMode = (typeof CHANGE_ACTIVITY_MODES)[number];

export const CHANGE_ACTIVITY_SORTS = [
  'relevant',
  'newest',
  'biggest-change',
  'most-commercial',
  'most-launch-relevant',
] as const;

export type ChangeActivitySort = (typeof CHANGE_ACTIVITY_SORTS)[number];

export const CHANGE_ACTIVITY_SIGNAL_FAMILIES = [
  'announcement',
  'release',
  'pricing',
  'store-page',
  'media',
  'taxonomy',
  'platform',
  'build',
] as const;

export type ChangeActivitySignalFamily = (typeof CHANGE_ACTIVITY_SIGNAL_FAMILIES)[number];

export const CHANGE_ACTIVITY_STORY_KINDS = [
  'announcement',
  'release-prep',
  'commercial-move',
  'store-refresh',
  'positioning-shift',
  'platform-expansion',
  'build-activity',
  'general-update',
] as const;

export type ChangeActivityStoryKind = (typeof CHANGE_ACTIVITY_STORY_KINDS)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export const CHANGE_FEED_PRESETS = [
  'high-signal',
  'upcoming-radar',
  'all-changes',
] as const;

export type ChangeFeedPreset = (typeof CHANGE_FEED_PRESETS)[number];

export const CHANGE_FEED_SOURCES = ['storefront', 'pics', 'media'] as const;

export type ChangeFeedSource = (typeof CHANGE_FEED_SOURCES)[number];

export const CHANGE_FEED_STATUS_STATES = [
  'healthy',
  'catching_up',
  'delayed',
] as const;

export type ChangeFeedStatusState = (typeof CHANGE_FEED_STATUS_STATES)[number];

export const CHANGE_FEED_APP_TYPES: AppType[] = [
  'game',
  'dlc',
  'demo',
  'mod',
  'video',
  'hardware',
  'music',
  'episode',
  'tool',
  'application',
  'series',
  'advertising',
];

export interface ChangeFeedCursor {
  time: string;
  key: string;
}

export interface ChangeActivityParamsCursor {
  score: number;
  time: string;
  id: string;
}

export interface ChangeDiffPreview {
  id: string;
  label: string;
  kind: 'scalar' | 'list' | 'text' | 'media' | 'note';
  beforeText: string | null;
  afterText: string | null;
  added: string[];
  removed: string[];
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  note: string | null;
}

export interface ChangeAnnouncementPreview {
  gid: string;
  title: string | null;
  url: string | null;
  feedLabel: string | null;
  feedName: string | null;
  publishedAt: string | null;
  firstSeenAt: string | null;
  excerpt: string | null;
}

export interface ChangeActivityRow {
  activityId: string;
  activityKind: 'change' | 'announcement';
  storyKind: ChangeActivityStoryKind;
  appid: number;
  appName: string;
  appType: AppType | null;
  isReleased: boolean | null;
  releaseDate: string | null;
  occurredAt: string;
  headline: string;
  summary: string;
  facts: string[];
  highlightLabels: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  hasBeforeAfter: boolean;
  relatedAnnouncementCount: number;
  externalUrl: string | null;
}

export interface ChangeActivityDetail {
  activityId: string;
  activityKind: 'change' | 'announcement';
  storyKind: ChangeActivityStoryKind;
  appid: number;
  appName: string;
  appType: AppType | null;
  isReleased: boolean | null;
  releaseDate: string | null;
  occurredAt: string;
  headline: string;
  summary: string;
  facts: string[];
  highlightLabels: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  hasBeforeAfter: boolean;
  relatedAnnouncementCount: number;
  externalUrl: string | null;
  diffs: ChangeDiffPreview[];
  relatedAnnouncements: ChangeAnnouncementPreview[];
  aftermath: ChangeBurstImpact | null;
  body: string | null;
}

export interface ChangeFeedActivityResponse {
  items: ChangeActivityRow[];
  nextCursor: string | null;
  meta: {
    days: number;
    view: ChangeActivityView;
    mode: ChangeActivityMode;
    sort: ChangeActivitySort;
    limit: number;
    appTypes: AppType[] | null;
    signalFamilies: ChangeActivitySignalFamily[] | null;
    search: string | null;
  };
}

export interface ChatChangePatternCandidateRow {
  appid: number;
  appName: string;
  appType: AppType | null;
  isReleased: boolean | null;
  releaseDate: string | null;
  latestOccurredAt: string;
  activityIds: string[];
  signalFamilies: ChangeActivitySignalFamily[];
  storyKinds: ChangeActivityStoryKind[];
  announcementCount: number;
  changeCount: number;
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

export interface ChangeFeedActivityDetailResponse {
  item: ChangeActivityDetail;
}

export interface ChangeBurstImpactWindow {
  ccuPeak: number | null;
  totalReviews: number | null;
  positiveReviews: number | null;
  negativeReviews: number | null;
  reviewScore: number | null;
  reviewScoreLabel: string | null;
  priceCents: number | null;
  discountPercent: number | null;
}

export interface ChangeBurstImpact {
  baseline7d: ChangeBurstImpactWindow | null;
  response1d: ChangeBurstImpactWindow | null;
  response7d: ChangeBurstImpactWindow | null;
}

export interface ChangeBurstRow {
  burstId: string;
  appid: number;
  appName: string;
  appType: AppType | null;
  isReleased: boolean | null;
  releaseDate: string | null;
  effectiveAt: string;
  burstStartedAt: string;
  burstEndedAt: string;
  eventCount: number;
  sourceSet: ChangeFeedSource[];
  headlineChangeTypes: string[];
  changeTypeCount: number;
  hasRelatedNews: boolean;
  relatedNewsCount: number;
}

export interface ChangeDetailEvent {
  eventId: number;
  appid: number;
  source: ChangeFeedSource;
  changeType: string;
  occurredAt: string;
  beforeValue: JsonValue;
  afterValue: JsonValue;
  context: Record<string, JsonValue | undefined>;
}

export interface ChangeNewsRow {
  gid: string;
  appid: number;
  appName: string;
  appType: AppType | null;
  publishedAt: string | null;
  firstSeenAt: string | null;
  title: string | null;
  feedLabel: string | null;
  feedName: string | null;
  url: string | null;
}

export type ChangeRecentNewsScope = 'single_app' | 'multi_app';

export interface ChangeRecentNewsDigestItem {
  gid: string;
  appid: number;
  appName: string;
  appType: AppType | null;
  publishedAt: string | null;
  firstSeenAt: string | null;
  title: string | null;
  feedLabel: string | null;
  feedName: string | null;
  url: string | null;
  excerpt: string | null;
  bodyPreview: string | null;
}

export interface ChangeBurstDetail {
  burstId: string;
  appid: number;
  appName: string;
  appType: AppType | null;
  isReleased: boolean | null;
  releaseDate: string | null;
  effectiveAt: string;
  burstStartedAt: string;
  burstEndedAt: string;
  eventCount: number;
  sourceSet: ChangeFeedSource[];
  headlineChangeTypes: string[];
  changeTypeCount: number;
  hasRelatedNews: boolean;
  relatedNewsCount: number;
  events: ChangeDetailEvent[];
  relatedNews: ChangeNewsRow[];
  impact: ChangeBurstImpact | null;
}

export interface ChangeFeedStatus {
  state: ChangeFeedStatusState;
  queuedJobs: number;
  oldestQueuedAt: string | null;
  latestStorefrontEventAt: string | null;
  latestNewsEventAt: string | null;
  projectionQueuedJobs?: number;
  oldestProjectionQueuedAt?: string | null;
  latestProjectionRefreshAt?: string | null;
  reasons: string[];
}

export interface ChangeFeedBurstsResponse {
  items: ChangeBurstRow[];
  nextCursor: ChangeFeedCursor | null;
  meta: {
    days: number;
    preset: ChangeFeedPreset;
    limit: number;
    appTypes: AppType[] | null;
    sourceFilter: ChangeFeedSource[] | null;
    search: string | null;
  };
}

export interface ChangeFeedNewsResponse {
  items: ChangeNewsRow[];
  nextCursor: ChangeFeedCursor | null;
  meta: {
    days: number;
    limit: number;
    appTypes: AppType[] | null;
    search: string | null;
  };
}

export interface ChangeBurstDetailResponse {
  item: ChangeBurstDetail;
}

export interface RawChangeActivityRow {
  activity_id: string;
  activity_kind: 'change' | 'announcement';
  story_kind: ChangeActivityStoryKind;
  appid: number;
  app_name: string;
  app_type: AppType | null;
  is_released: boolean | null;
  release_date: string | null;
  occurred_at: string;
  headline: string;
  summary: string;
  facts: unknown;
  highlight_labels: unknown;
  signal_families: unknown;
  has_before_after: boolean;
  related_announcement_count: number;
  external_url: string | null;
  sort_score: number | null;
}

export interface RawChangeBurstRow {
  burst_id: string;
  appid: number;
  app_name: string;
  app_type: AppType | null;
  is_released: boolean | null;
  release_date: string | null;
  effective_at: string;
  burst_started_at: string;
  burst_ended_at: string;
  event_count: number;
  source_set: unknown;
  headline_change_types: unknown;
  change_type_count: number;
  has_related_news: boolean;
  related_news_count: number;
}

export interface RawChatChangeActivityCandidateRow extends RawChangeBurstRow {
  signal_families: unknown;
  story_kind: ChangeActivityStoryKind;
  sort_score: number | null;
}

export interface RawChatChangePatternCandidateRow {
  appid: number;
  app_name: string;
  app_type: AppType | null;
  is_released: boolean | null;
  release_date: string | null;
  latest_occurred_at: string;
  activity_ids: unknown;
  signal_families: unknown;
  story_kinds: unknown;
  announcement_count: number;
  change_count: number;
  positive_percentage: number | null;
  total_reviews: number | null;
  ccu_peak: number | null;
  price_cents: number | null;
  discount_percent: number | null;
  review_velocity_7d: number | null;
  review_velocity_30d: number | null;
  trend_30d_direction: string | null;
  ccu_trend_7d_pct: number | null;
}

export interface RawChangeBurstDetailEvent {
  event_id: number;
  appid: number;
  source: ChangeFeedSource;
  change_type: string;
  occurred_at: string;
  before_value: JsonValue;
  after_value: JsonValue;
  context: Record<string, JsonValue | undefined> | null;
}

export interface RawChangeNewsRow {
  gid: string;
  appid: number;
  app_name: string;
  app_type: AppType | null;
  published_at: string | null;
  first_seen_at: string | null;
  title: string | null;
  feedlabel: string | null;
  feedname: string | null;
  url: string | null;
}

export interface RawChatRecentNewsRow extends RawChangeNewsRow {
  contents: string | null;
}

export interface RawChangeBurstDetailRow extends RawChangeBurstRow {
  events: RawChangeBurstDetailEvent[] | null;
  related_news: RawChangeNewsRow[] | null;
  impact: Record<string, JsonValue | undefined> | null;
}
