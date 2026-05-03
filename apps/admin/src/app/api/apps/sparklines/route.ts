import { NextRequest, NextResponse } from 'next/server';
import { runTigerQuery } from '@publisheriq/database';
import { createServerClient } from '@/lib/supabase/server';

interface SparklineRow {
  appid: number;
  sparkline_data: Array<{ date: string; ccu: number }> | null;
}

function parseAppIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((appid) => Number.isInteger(appid) && appid > 0))].slice(0, 100);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { appids?: unknown; days?: unknown } | null;
  const appids = parseAppIds(body?.appids);
  const days = Number(body?.days) === 30 ? 30 : 7;
  if (appids.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { rows } = await runTigerQuery<SparklineRow>(
    `
      WITH daily AS (
        SELECT
          appid,
          date_trunc('day', snapshot_time)::date AS metric_date,
          max(player_count)::integer AS ccu
        FROM metrics.ccu_snapshots
        WHERE appid = ANY($1::int[])
          AND snapshot_time >= now() - ($2::integer * INTERVAL '1 day')
        GROUP BY appid, metric_date
      )
      SELECT
        appid,
        jsonb_agg(
          jsonb_build_object('date', metric_date::text, 'ccu', ccu)
          ORDER BY metric_date ASC
        ) AS sparkline_data
      FROM daily
      GROUP BY appid
    `,
    [appids, days]
  );

  return NextResponse.json({ data: rows });
}
