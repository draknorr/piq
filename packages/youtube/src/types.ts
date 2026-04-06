export type RoutingLane =
  | 'escalated'
  | 'active_baseline_daily'
  | 'active_baseline_rotating'
  | 'evergreen_baseline';

export type ContentClass =
  | 'standard_video'
  | 'short'
  | 'live_or_recent_live';

export type MatchState =
  | 'matched_primary'
  | 'matched_secondary'
  | 'ambiguous'
  | 'rejected'
  | 'suppressed';

export type ConfidenceBucket = 'high' | 'medium' | 'low';

export type SnapshotReason =
  | 'discovery'
  | 'scheduled_refresh'
  | 'bootstrap_refresh';

export interface RoutedGameCandidate {
  appid: number;
  name: string;
  priorityScore: number;
  refreshTier: string | null;
  releaseDate: string | null;
  reviewVelocity7d: number;
  trendChange30dPct: number;
  aliases: string[];
}

export interface RoutingRow {
  appid: number;
  app_name: string;
  query_template_id: string | null;
  discovery_cursor_published_after: Date | null;
  routing_state: RoutingLane | 'suppressed';
  allow_second_page: boolean;
}

export interface YoutubeSearchItem {
  etag?: string;
  id?: {
    kind?: string;
    videoId?: string;
  };
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
}

export interface YoutubeSearchResponse {
  etag?: string;
  nextPageToken?: string;
  items?: YoutubeSearchItem[];
  pageInfo?: {
    totalResults?: number;
    resultsPerPage?: number;
  };
}

export interface YoutubeVideo {
  id: string;
  etag?: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    categoryId?: string;
    tags?: string[];
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: {
    duration?: string;
    definition?: string;
    caption?: string;
    licensedContent?: boolean;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  status?: {
    embeddable?: boolean;
    publicStatsViewable?: boolean;
    madeForKids?: boolean;
    privacyStatus?: string;
  };
  topicDetails?: {
    topicCategories?: string[];
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    concurrentViewers?: string;
  };
}

export interface YoutubeVideoListResponse {
  items?: YoutubeVideo[];
}

export interface YoutubeChannel {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    country?: string;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    viewCount?: string;
    videoCount?: string;
  };
}

export interface YoutubeChannelListResponse {
  items?: YoutubeChannel[];
}

export interface MatchDecision {
  matchState: MatchState;
  confidenceBucket: ConfidenceBucket;
  matchedAlias: string | null;
  decisionSource: string;
  evidenceSummary: Record<string, unknown>;
}

export interface DueVideoRefreshRow {
  appid: number;
  video_id: string;
  channel_id: string;
  published_at: string | null;
  last_snapshot_at: string | null;
}
