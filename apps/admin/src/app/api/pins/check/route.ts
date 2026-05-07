import { NextRequest, NextResponse } from 'next/server';
import { getAuthErrorResponse, requireAuthOrThrow } from '@/lib/auth-utils';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Note: user_pins table is created by migration 20260112000001_add_personalization.sql
// Types will be available after running: pnpm --filter database generate

// GET /api/pins/check?entityType=game&entityId=123 - Check if entity is pinned
// GET /api/pins/check?entityType=game&entityIds=123,456 - Bulk check visible rows
export async function GET(request: NextRequest) {
  try {
    const result = await requireAuthOrThrow();

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const entityIds = searchParams.get('entityIds');

    // Validate required params
    if (!entityType || (!entityId && !entityIds)) {
      return NextResponse.json(
        { error: 'entityType and entityId or entityIds are required' },
        { status: 400 }
      );
    }

    // Validate entityType enum
    if (!['game', 'publisher', 'developer'].includes(entityType)) {
      return NextResponse.json(
        { error: 'entityType must be game, publisher, or developer' },
        { status: 400 }
      );
    }

    const supabase = await createServerClient();

    if (entityIds) {
      const ids = Array.from(new Set(
        entityIds
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      )).slice(0, 250);

      if (ids.length === 0) {
        return NextResponse.json({ pins: [], pinnedIds: [], pinIdsByEntityId: {} });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('user_pins')
        .select('id, entity_id')
        .eq('user_id', result.user.id)
        .eq('entity_type', entityType)
        .in('entity_id', ids);

      if (error) {
        console.error('Error checking pins:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const pins = (data ?? []).map((pin: { id: string; entity_id: number }) => ({
        pinId: pin.id,
        entityId: pin.entity_id,
      }));
      const pinIdsByEntityId = Object.fromEntries(
        pins.map((pin: { pinId: string; entityId: number }) => [String(pin.entityId), pin.pinId])
      );

      return NextResponse.json({
        pins,
        pinnedIds: pins.map((pin: { entityId: number }) => pin.entityId),
        pinIdsByEntityId,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('user_pins')
      .select('id')
      .eq('user_id', result.user.id)
      .eq('entity_type', entityType)
      .eq('entity_id', Number(entityId))
      .maybeSingle();

    if (error) {
      console.error('Error checking pin:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      pinned: !!data,
      pinId: data?.id ?? null,
    });
  } catch (error) {
    const authErrorResponse = getAuthErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    console.error('Pins check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
