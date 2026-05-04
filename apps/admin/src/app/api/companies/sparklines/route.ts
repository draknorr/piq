import { NextRequest, NextResponse } from 'next/server';
import { runTigerQuery } from '@publisheriq/database';
import { createServerClient } from '@/lib/supabase/server';

interface SparklineRequestItem {
  id: number;
  type: 'publisher' | 'developer';
}

interface SparklineRow {
  id: number;
  type: 'publisher' | 'developer';
  sparkline_data: Array<{ date: string; total_ccu: number }> | null;
}

function parseCompanies(value: unknown): SparklineRequestItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: SparklineRequestItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const type = record.type;
    if (!Number.isInteger(id) || id <= 0 || (type !== 'publisher' && type !== 'developer')) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id, type });
    if (items.length >= 100) break;
  }

  return items;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { companies?: unknown; days?: unknown } | null;
  const companies = parseCompanies(body?.companies);
  const days = Number(body?.days) === 30 ? 30 : 7;
  if (companies.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const publisherIds = companies.filter((company) => company.type === 'publisher').map((company) => company.id);
  const developerIds = companies.filter((company) => company.type === 'developer').map((company) => company.id);

  const { rows } = await runTigerQuery<SparklineRow>(
    `
      WITH requested AS (
        SELECT 'publisher'::text AS type, unnest($1::int[]) AS id
        UNION ALL
        SELECT 'developer'::text AS type, unnest($2::int[]) AS id
      ),
      company_apps AS (
        SELECT r.type, r.id, ap.appid
        FROM requested r
        JOIN legacy.app_publishers ap ON r.type = 'publisher' AND ap.publisher_id = r.id
        UNION ALL
        SELECT r.type, r.id, ad.appid
        FROM requested r
        JOIN legacy.app_developers ad ON r.type = 'developer' AND ad.developer_id = r.id
      ),
      daily AS (
        SELECT
          ca.type,
          ca.id,
          date_trunc('day', cs.snapshot_time)::date AS metric_date,
          SUM(cs.player_count)::integer AS total_ccu
        FROM company_apps ca
        JOIN metrics.ccu_snapshots cs ON cs.appid = ca.appid
        WHERE cs.snapshot_time >= now() - ($3::integer * INTERVAL '1 day')
        GROUP BY ca.type, ca.id, metric_date
      )
      SELECT
        id,
        type,
        jsonb_agg(
          jsonb_build_object('date', metric_date::text, 'total_ccu', total_ccu)
          ORDER BY metric_date ASC
        ) AS sparkline_data
      FROM daily
      GROUP BY type, id
    `,
    [publisherIds, developerIds, days]
  );

  return NextResponse.json({ data: rows });
}
