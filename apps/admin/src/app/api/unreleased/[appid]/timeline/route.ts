import { NextRequest, NextResponse } from 'next/server';
import { getAuthErrorResponse, requireAuthOrThrow } from '@/lib/auth-utils';
import { getUnreleasedGameTimeline } from '@/app/(main)/unreleased/lib/unreleased-queries';

export const dynamic = 'force-dynamic';

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appid: string }> }
) {
  try {
    await requireAuthOrThrow();

    const { appid } = await params;
    const parsedAppid = Number.parseInt(appid, 10);
    if (!Number.isInteger(parsedAppid) || parsedAppid <= 0) {
      return NextResponse.json({ error: 'Invalid appid' }, { status: 400 });
    }

    const limit = parsePositiveInteger(request.nextUrl.searchParams.get('limit'), 40);
    const offset = parsePositiveInteger(request.nextUrl.searchParams.get('offset'), 0);
    const data = await getUnreleasedGameTimeline(parsedAppid, { limit, offset });

    return NextResponse.json({ data });
  } catch (error) {
    const authErrorResponse = getAuthErrorResponse(error);
    if (authErrorResponse) return authErrorResponse;

    console.error('Unreleased timeline API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
