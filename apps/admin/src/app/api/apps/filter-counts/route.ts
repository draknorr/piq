import { NextRequest, NextResponse } from 'next/server';
import { runTigerQuery } from '@publisheriq/database';
import { createServerClient } from '@/lib/supabase/server';

type FilterType = 'genre' | 'tag' | 'category' | 'steam_deck' | 'platform' | 'ccu_tier';

interface FilterOptionRow {
  option_id: number;
  option_name: string;
  app_count: number | string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const filterCountCache = new Map<string, { data: FilterOptionRow[]; timestamp: number }>();
let filterCountProjectionAvailable: boolean | null = null;

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function buildBaseWhere(params: {
  appType: string;
  minCcu?: number;
  minReviews?: number;
  minScore?: number;
  minOwners?: number;
}): { joinSql: string; sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const where: string[] = [];
  const needsMetrics =
    params.minCcu !== undefined ||
    params.minReviews !== undefined ||
    params.minScore !== undefined ||
    params.minOwners !== undefined;

  if (params.appType !== 'all') {
    values.push(params.appType);
    where.push(`COALESCE(a.type, 'game') = $${values.length}`);
  }
  if (params.minCcu !== undefined) {
    values.push(params.minCcu);
    where.push(`COALESCE(ldm.ccu_peak, 0) >= $${values.length}`);
  }
  if (params.minReviews !== undefined) {
    values.push(params.minReviews);
    where.push(`COALESCE(ldm.total_reviews, 0) >= $${values.length}`);
  }
  if (params.minScore !== undefined) {
    values.push(params.minScore);
    where.push(`ldm.review_score >= $${values.length}`);
  }
  if (params.minOwners !== undefined) {
    values.push(params.minOwners);
    where.push(`COALESCE(ldm.owners_midpoint, 0) >= $${values.length}`);
  }

  return {
    joinSql: needsMetrics ? 'LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid' : '',
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    values,
  };
}

function queryForFilter(filterType: FilterType, baseJoinSql: string, baseWhereSql: string): string {
  const base = `
    WITH filtered_apps AS (
      SELECT a.appid
      FROM legacy.apps a
      ${baseJoinSql}
      ${baseWhereSql}
    )
  `;

  switch (filterType) {
    case 'genre':
      return `${base}
        SELECT sg.genre_id AS option_id, sg.name AS option_name, COUNT(*)::integer AS app_count
        FROM filtered_apps fa
        JOIN legacy.app_genres ag ON ag.appid = fa.appid
        JOIN legacy.steam_genres sg ON sg.genre_id = ag.genre_id
        GROUP BY sg.genre_id, sg.name
        ORDER BY app_count DESC, option_name
        LIMIT 100
      `;
    case 'tag':
      return `${base}
        SELECT st.tag_id AS option_id, st.name AS option_name, COUNT(*)::integer AS app_count
        FROM filtered_apps fa
        JOIN legacy.app_steam_tags ast ON ast.appid = fa.appid
        JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
        GROUP BY st.tag_id, st.name
        ORDER BY app_count DESC, option_name
        LIMIT 100
      `;
    case 'category':
      return `${base}
        SELECT sc.category_id AS option_id, sc.name AS option_name, COUNT(*)::integer AS app_count
        FROM filtered_apps fa
        JOIN legacy.app_categories ac ON ac.appid = fa.appid
        JOIN legacy.steam_categories sc ON sc.category_id = ac.category_id
        GROUP BY sc.category_id, sc.name
        ORDER BY app_count DESC, option_name
        LIMIT 100
      `;
    case 'steam_deck':
      return `${base}
        SELECT
          CASE sd.category
            WHEN 'verified' THEN 1
            WHEN 'playable' THEN 2
            WHEN 'unsupported' THEN 3
            ELSE 4
          END AS option_id,
          COALESCE(sd.category, 'unknown') AS option_name,
          COUNT(*)::integer AS app_count
        FROM filtered_apps fa
        LEFT JOIN legacy.app_steam_deck sd ON sd.appid = fa.appid
        GROUP BY sd.category
        ORDER BY option_id
      `;
    case 'platform':
      return `${base}
        SELECT option_id, option_name, app_count
        FROM (
          SELECT 1 AS option_id, 'windows' AS option_name, COUNT(*) FILTER (WHERE a.platforms ILIKE '%windows%')::integer AS app_count
          FROM filtered_apps fa JOIN legacy.apps a ON a.appid = fa.appid
          UNION ALL
          SELECT 2 AS option_id, 'mac' AS option_name, COUNT(*) FILTER (WHERE a.platforms ILIKE '%mac%')::integer AS app_count
          FROM filtered_apps fa JOIN legacy.apps a ON a.appid = fa.appid
          UNION ALL
          SELECT 3 AS option_id, 'linux' AS option_name, COUNT(*) FILTER (WHERE a.platforms ILIKE '%linux%')::integer AS app_count
          FROM filtered_apps fa JOIN legacy.apps a ON a.appid = fa.appid
        ) platforms
        WHERE app_count > 0
        ORDER BY app_count DESC
      `;
    case 'ccu_tier':
      return `${base}
        SELECT cta.ccu_tier AS option_id, ('Tier ' || cta.ccu_tier::text) AS option_name, COUNT(*)::integer AS app_count
        FROM filtered_apps fa
        JOIN ops.ccu_tier_assignments cta ON cta.appid = fa.appid
        GROUP BY cta.ccu_tier
        ORDER BY cta.ccu_tier
      `;
  }
}

async function hasFilterCountProjection(): Promise<boolean> {
  if (filterCountProjectionAvailable !== null) return filterCountProjectionAvailable;
  const { rows } = await runTigerQuery<{ exists: boolean }>(
    `SELECT to_regclass('metrics.apps_page_filter_counts') IS NOT NULL AS exists`,
    []
  );
  filterCountProjectionAvailable = rows[0]?.exists === true;
  return filterCountProjectionAvailable;
}

function defaultProjectionCountQuery(filterType: FilterType): string | null {
  if (filterType === 'genre') {
    return `
      SELECT sg.genre_id AS option_id, sg.name AS option_name, fc.app_count
      FROM metrics.apps_page_filter_counts fc
      JOIN legacy.steam_genres sg ON sg.genre_id = fc.option_id
      WHERE fc.filter_type = 'genre'
      ORDER BY fc.app_count DESC, sg.name
      LIMIT 100
    `;
  }
  if (filterType === 'tag') {
    return `
      SELECT st.tag_id AS option_id, st.name AS option_name, fc.app_count
      FROM metrics.apps_page_filter_counts fc
      JOIN legacy.steam_tags st ON st.tag_id = fc.option_id
      WHERE fc.filter_type = 'tag'
      ORDER BY fc.app_count DESC, st.name
      LIMIT 100
    `;
  }
  if (filterType === 'category') {
    return `
      SELECT sc.category_id AS option_id, sc.name AS option_name, fc.app_count
      FROM metrics.apps_page_filter_counts fc
      JOIN legacy.steam_categories sc ON sc.category_id = fc.option_id
      WHERE fc.filter_type = 'category'
      ORDER BY fc.app_count DESC, sc.name
      LIMIT 100
    `;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const filterType = searchParams.get('filterType') as FilterType | null;
  if (!filterType || !['genre', 'tag', 'category', 'steam_deck', 'platform', 'ccu_tier'].includes(filterType)) {
    return NextResponse.json({ error: 'Invalid filterType' }, { status: 400 });
  }

  const cacheKey = request.nextUrl.searchParams.toString();
  const cached = filterCountCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      data: cached.data.map((row) => ({
        option_id: Number(row.option_id),
        option_name: row.option_name,
        app_count: Number(row.app_count),
      })),
    });
  }

  const { joinSql, sql: whereSql, values } = buildBaseWhere({
    appType: searchParams.get('type') || 'game',
    minCcu: parseNumber(searchParams.get('minCcu')),
    minOwners: parseNumber(searchParams.get('minOwners')),
    minReviews: parseNumber(searchParams.get('minReviews')),
    minScore: parseNumber(searchParams.get('minScore')),
  });

  const projectionQuery =
    values.length === 1 && values[0] === 'game'
      ? defaultProjectionCountQuery(filterType)
      : null;
  const useProjectionQuery = projectionQuery !== null && await hasFilterCountProjection();
  const { rows } = await runTigerQuery<FilterOptionRow>(
    useProjectionQuery
      ? projectionQuery
      : queryForFilter(filterType, joinSql, whereSql),
    useProjectionQuery ? [] : values
  );
  if (filterCountCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = filterCountCache.keys().next().value as string | undefined;
    if (oldestKey) filterCountCache.delete(oldestKey);
  }
  filterCountCache.set(cacheKey, { data: rows, timestamp: Date.now() });
  return NextResponse.json({
    data: rows.map((row) => ({
      option_id: Number(row.option_id),
      option_name: row.option_name,
      app_count: Number(row.app_count),
    })),
  });
}
