import { NextRequest, NextResponse } from 'next/server';
import { postToQueryApi } from '@/lib/query-api-client';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CONTENT_CLASSES = new Set(['standard_video', 'short', 'live_or_recent_live']);
const SORTS = new Set(['latest', 'top_views', 'growth']);
const WINDOWS = new Set(['1d', '7d', '30d']);

type ContentClass = 'standard_video' | 'short' | 'live_or_recent_live';
type DrawerSort = 'latest' | 'top_views' | 'growth';
type DrawerWindow = '1d' | '7d' | '30d';

function normalizeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(Math.trunc(value), 25))
    : 25;
}

function normalizeOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'en';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'en';
  }

  return normalized === 'all' ? null : normalized;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sortToCoverageView(sort: DrawerSort): 'latest_videos' | 'top_videos' | 'video_growth' {
  if (sort === 'top_views') return 'top_videos';
  if (sort === 'growth') return 'video_growth';
  return 'latest_videos';
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', result: null, success: false },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const entityUid = typeof body?.entityUid === 'string' ? body.entityUid.trim() : '';
  if (!entityUid) {
    return NextResponse.json(
      { error: 'entityUid is required', result: null, success: false },
      { status: 400 }
    );
  }

  const contentClass =
    typeof body?.contentClass === 'string' && CONTENT_CLASSES.has(body.contentClass)
      ? body.contentClass as ContentClass
      : null;
  const sort =
    typeof body?.sort === 'string' && SORTS.has(body.sort)
      ? body.sort as DrawerSort
      : 'latest';
  const window =
    typeof body?.window === 'string' && WINDOWS.has(body.window)
      ? body.window as DrawerWindow
      : '7d';
  const language = normalizeLanguage(body?.language);

  const result = await postToQueryApi('/v1/contracts/get-youtube-game-coverage', {
    ...(contentClass ? { contentClass } : {}),
    entityUid,
    includeLanguageOptions: normalizeBoolean(body?.includeLanguageOptions, true),
    includeSummary: normalizeBoolean(body?.includeSummary, false),
    language,
    limit: normalizeLimit(body?.limit),
    offset: normalizeOffset(body?.offset),
    view: sortToCoverageView(sort),
    window,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        error: result.reason ?? 'Unable to load YouTube videos',
        result: null,
        success: false,
      },
      { status: result.httpStatus ?? 502 }
    );
  }

  return NextResponse.json({
    result: result.data,
    success: true,
  });
}
