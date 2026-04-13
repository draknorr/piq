import { NextRequest, NextResponse } from 'next/server';

import { postToQueryApi } from '@/lib/query-api-client';
import { createServerClient } from '@/lib/supabase/server';

const ALLOWED_VIEWS = new Set([
  'latest_videos',
  'creator_coverage',
  'top_videos',
  'video_growth',
  'content_mix',
  'cadence',
] as const);

const ALLOWED_CONTENT_CLASSES = new Set([
  'standard_video',
  'short',
  'live_or_recent_live',
] as const);

const ALLOWED_WINDOWS = new Set([
  'current',
  '1d',
  '2d',
  '3d',
  '7d',
  '14d',
  '30d',
] as const);

type YoutubeCoverageView =
  | 'latest_videos'
  | 'creator_coverage'
  | 'top_videos'
  | 'video_growth'
  | 'content_mix'
  | 'cadence';
type YoutubeContentClass =
  | 'standard_video'
  | 'short'
  | 'live_or_recent_live';
type YoutubeCoverageWindow = 'current' | '1d' | '2d' | '3d' | '7d' | '14d' | '30d';

interface YoutubeCoverageRequestBody {
  contentClass?: YoutubeContentClass | null;
  entityUid: string;
  limit?: number;
  offset?: number;
  view: YoutubeCoverageView;
  window?: YoutubeCoverageWindow | null;
}

export interface ChatYoutubeCoverageRouteSuccess {
  result: unknown;
  success: true;
  timing: {
    total_ms: number;
  };
}

export interface ChatYoutubeCoverageRouteFailure {
  error: string;
  result: null;
  success: false;
}

export type ChatYoutubeCoverageRouteResponse =
  | ChatYoutubeCoverageRouteFailure
  | ChatYoutubeCoverageRouteSuccess;

export interface ChatYoutubeCoverageRouteDeps {
  createServerClient: typeof createServerClient;
  postToQueryApi: typeof postToQueryApi;
}

const defaultDeps: ChatYoutubeCoverageRouteDeps = {
  createServerClient,
  postToQueryApi,
};

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(Math.trunc(value), 25));
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

export async function handleChatYoutubeCoverageRequest(
  request: NextRequest,
  deps: ChatYoutubeCoverageRouteDeps = defaultDeps
): Promise<NextResponse<ChatYoutubeCoverageRouteResponse>> {
  const startTime = Date.now();

  try {
    const supabase = await deps.createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: 'Authentication required',
          result: null,
          success: false,
        },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => null)) as Partial<YoutubeCoverageRequestBody> | null;
    const entityUid = typeof body?.entityUid === 'string' ? body.entityUid.trim() : '';
    const view = typeof body?.view === 'string' && ALLOWED_VIEWS.has(body.view as YoutubeCoverageView)
      ? body.view as YoutubeCoverageView
      : null;

    if (!entityUid) {
      return NextResponse.json(
        {
          error: 'entityUid is required',
          result: null,
          success: false,
        },
        { status: 400 }
      );
    }

    if (!view) {
      return NextResponse.json(
        {
          error: 'view is required',
          result: null,
          success: false,
        },
        { status: 400 }
      );
    }

    const contentClass = typeof body?.contentClass === 'string'
      && ALLOWED_CONTENT_CLASSES.has(body.contentClass as YoutubeContentClass)
      ? body.contentClass as YoutubeContentClass
      : null;
    const window = typeof body?.window === 'string'
      && ALLOWED_WINDOWS.has(body.window as YoutubeCoverageWindow)
      ? body.window as YoutubeCoverageWindow
      : null;

    const normalizedBody: YoutubeCoverageRequestBody = {
      entityUid,
      limit: normalizeLimit(body?.limit),
      offset: normalizeOffset(body?.offset),
      view,
      ...(contentClass ? { contentClass } : {}),
      ...(window ? { window } : {}),
    };

    const result = await deps.postToQueryApi(
      '/v1/contracts/get-youtube-game-coverage',
      normalizedBody
    );

    if (!result.ok || !result.data) {
      return NextResponse.json(
        {
          error: result.reason ?? 'Unable to load YouTube coverage',
          result: null,
          success: false,
        },
        { status: result.httpStatus ?? 502 }
      );
    }

    return NextResponse.json({
      result: result.data,
      success: true,
      timing: {
        total_ms: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Chat YouTube coverage API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        result: null,
        success: false,
      },
      { status: 500 }
    );
  }
}
