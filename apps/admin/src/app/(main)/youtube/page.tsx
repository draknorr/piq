import type { Metadata } from 'next';
import { postToQueryApi } from '@/lib/query-api-client';
import { YoutubePulseClient } from './YoutubePulseClient';
import type {
  FormatParam,
  YoutubeContentClass,
  YoutubeMarketPulseResponse,
  YoutubeSort,
  YoutubeWindow,
} from './types';

export const metadata: Metadata = {
  title: 'YouTube Pulse | PublisherIQ',
  description: 'Spot YouTube creator activity across top Steam games.',
};

export const dynamic = 'force-dynamic';

function parseWindow(value: string | undefined): YoutubeWindow {
  return value === '1d' || value === '30d' ? value : '7d';
}

function parseSort(value: string | undefined): YoutubeSort {
  if (
    value === 'steam_rank'
    || value === 'youtube_velocity'
    || value === 'new_videos'
    || value === 'creator_breadth'
  ) {
    return value;
  }

  return 'steam_rank';
}

function parseFormat(value: string | undefined): FormatParam {
  if (value === 'long' || value === 'short' || value === 'live') {
    return value;
  }

  return 'all';
}

function formatToContentClass(format: FormatParam): YoutubeContentClass | null {
  if (format === 'long') return 'standard_video';
  if (format === 'short') return 'short';
  if (format === 'live') return 'live_or_recent_live';
  return null;
}

function emptyPulseResponse(params: {
  contentClass: YoutubeContentClass | null;
  sort: YoutubeSort;
  window: YoutubeWindow;
}): YoutubeMarketPulseResponse {
  return {
    availability: {
      blockingTables: [],
      reason: null,
      state: 'ready',
    },
    contentClass: params.contentClass,
    items: [],
    limit: 25,
    offset: 0,
    pagination: {
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 25,
      offset: 0,
      totalRows: 0,
    },
    sort: params.sort,
    sufficientToAnswer: false,
    summary: {
      currentViews: 0,
      gamesAnalyzed: 0,
      gamesWithCoverage: 0,
      latestSnapshotAt: null,
      newMatchedVideos: 0,
      uploadChannels: 0,
      viewDelta: 0,
    },
    window: params.window,
  };
}

export default async function YoutubePulsePage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; sort?: string; window?: string }>;
}) {
  const params = await searchParams;
  const window = parseWindow(params.window);
  const sort = parseSort(params.sort);
  const format = parseFormat(params.format);
  const contentClass = formatToContentClass(format);
  const response = await postToQueryApi<YoutubeMarketPulseResponse>(
    '/v1/contracts/get-youtube-market-pulse',
    {
      ...(contentClass ? { contentClass } : {}),
      limit: 25,
      sort,
      window,
    },
    { timeoutMs: 30_000 }
  );
  const pulse = response.ok && response.data
    ? response.data
    : emptyPulseResponse({ contentClass, sort, window });

  return (
    <YoutubePulseClient
      error={response.ok ? null : response.reason ?? 'Unable to load YouTube pulse'}
      initialFormat={format}
      initialPulse={pulse}
    />
  );
}
