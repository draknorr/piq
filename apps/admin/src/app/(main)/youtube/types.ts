export type YoutubeContentClass = 'standard_video' | 'short' | 'live_or_recent_live';
export type YoutubeWindow = '1d' | '7d' | '30d';
export type YoutubeSort = 'steam_rank' | 'youtube_velocity' | 'new_videos' | 'creator_breadth';
export type FormatParam = 'all' | 'long' | 'short' | 'live';
export type YoutubeVideoDrawerSort = 'latest' | 'top_views' | 'growth';

export interface YoutubeMarketPulseVideoItem {
  channelId: string;
  channelTitle: string;
  contentClass: YoutubeContentClass;
  languageCode?: string | null;
  publishedAt: string | null;
  thumbnailUrl?: string | null;
  title: string;
  url: string;
  videoId: string;
  viewCount: number | null;
  viewDelta: number | null;
}

export interface YoutubeMarketPulseContentMixItem {
  contentClass: YoutubeContentClass;
  currentViews: number;
  matchedPrimaryVideoCount: number;
  newMatchedVideos: number;
  viewDelta: number;
}

export interface YoutubeMarketPulseItem {
  appid: number;
  ccuPeak: number | null;
  contentMix: YoutubeMarketPulseContentMixItem[];
  coverageQuality: 'strong' | 'limited' | 'noisy' | 'none';
  currentViews: number;
  dominantContentClass: YoutubeContentClass | null;
  entityUid: string;
  latestSnapshotAt: string | null;
  latestVideos: YoutubeMarketPulseVideoItem[];
  matchedPrimaryVideoCount: number;
  name: string;
  newMatchedVideos: number;
  reviewScore: number | null;
  steamRank: number;
  totalReviews: number | null;
  uploadChannels: number;
  viewDelta: number;
}

export interface YoutubeMarketPulseResponse {
  availability: {
    blockingTables: string[];
    reason: string | null;
    state: 'ready' | 'blocked' | 'unavailable';
  };
  contentClass: YoutubeContentClass | null;
  items: YoutubeMarketPulseItem[];
  limit: number;
  offset: number;
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    limit: number;
    offset: number;
    totalRows: number;
  };
  sort: YoutubeSort;
  sufficientToAnswer: boolean;
  summary: {
    currentViews: number;
    gamesAnalyzed: number;
    gamesWithCoverage: number;
    latestSnapshotAt: string | null;
    newMatchedVideos: number;
    uploadChannels: number;
    viewDelta: number;
  };
  window: YoutubeWindow;
}

export interface YoutubeGameVideoItem {
  channelId: string;
  channelTitle: string;
  contentClass: YoutubeContentClass;
  defaultAudioLanguage: string | null;
  defaultLanguage: string | null;
  growthPct: number | null;
  languageCode: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  title: string;
  url: string;
  videoId: string;
  viewCount: number | null;
  viewDelta: number | null;
}

export interface YoutubeLanguageOption {
  code: string;
  label: string;
  videoCount: number;
}

export interface YoutubeVideosResponse {
  error?: string;
  result: {
    items: YoutubeGameVideoItem[];
    languageOptions: YoutubeLanguageOption[];
    pagination: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      limit: number;
      offset: number;
      totalRows: number;
    } | null;
  } | null;
  success: boolean;
}
