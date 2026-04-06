import { logger } from '@publisheriq/shared';

import type {
  YoutubeChannelListResponse,
  YoutubeSearchResponse,
  YoutubeVideoListResponse,
} from './types.js';

const API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

function buildUrl(
  path: string,
  params: Record<string, string | number | undefined | null>,
  apiKey: string
): URL {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
  url.searchParams.set('key', apiKey);
  return url;
}

export class YoutubeApiClient {
  private readonly log = logger.child({ package: 'youtube-api' });

  constructor(private readonly apiKey: string) {}

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined | null>
  ): Promise<T> {
    const url = buildUrl(path, params, this.apiKey);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      this.log.error('YouTube API request failed', {
        path,
        status: response.status,
        body,
      });
      throw new Error(`YouTube API request failed with status ${response.status}.`);
    }

    return response.json() as Promise<T>;
  }

  async searchVideos(params: {
    query: string;
    publishedAfter?: string | null;
    pageToken?: string | null;
    maxResults?: number;
  }): Promise<YoutubeSearchResponse> {
    return this.request<YoutubeSearchResponse>('/search', {
      part: 'snippet',
      type: 'video',
      order: 'date',
      maxResults: params.maxResults ?? 50,
      q: params.query,
      publishedAfter: params.publishedAfter ?? undefined,
      pageToken: params.pageToken ?? undefined,
    });
  }

  async listVideos(videoIds: string[]): Promise<YoutubeVideoListResponse> {
    if (videoIds.length === 0) {
      return { items: [] };
    }

    return this.request<YoutubeVideoListResponse>('/videos', {
      part: 'snippet,contentDetails,statistics,status,topicDetails,liveStreamingDetails',
      id: videoIds.join(','),
      maxResults: Math.min(videoIds.length, 50),
    });
  }

  async listChannels(channelIds: string[]): Promise<YoutubeChannelListResponse> {
    if (channelIds.length === 0) {
      return { items: [] };
    }

    return this.request<YoutubeChannelListResponse>('/channels', {
      part: 'snippet,contentDetails,statistics',
      id: channelIds.join(','),
      maxResults: Math.min(channelIds.length, 50),
    });
  }
}
