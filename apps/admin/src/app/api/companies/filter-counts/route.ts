import { NextRequest, NextResponse } from 'next/server';
import { runTigerQuery } from '@publisheriq/database';
import { createServerClient } from '@/lib/supabase/server';

type CompanyType = 'all' | 'publisher' | 'developer';
type FilterType = 'genre' | 'tag' | 'category' | 'steam_deck';
type StatusFilter = 'active' | 'dormant';

interface FilterOptionRow {
  option_id: number;
  option_name: string;
  company_count: number | string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const filterCountCache = new Map<string, { data: FilterOptionRow[]; timestamp: number }>();

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseCompanyType(value: string | null): CompanyType {
  return value === 'publisher' || value === 'developer' ? value : 'all';
}

function parseStatus(value: string | null): StatusFilter | undefined {
  return value === 'active' || value === 'dormant' ? value : undefined;
}

function buildCompanyAppsSql(companyType: CompanyType): string {
  const parts: string[] = [];

  if (companyType === 'all' || companyType === 'publisher') {
    parts.push(`
      SELECT 'publisher'::text AS type, p.id, ap.appid
      FROM legacy.publishers p
      JOIN legacy.app_publishers ap ON ap.publisher_id = p.id
      JOIN legacy.apps a ON a.appid = ap.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }

  if (companyType === 'all' || companyType === 'developer') {
    parts.push(`
      SELECT 'developer'::text AS type, d.id, ad.appid
      FROM legacy.developers d
      JOIN legacy.app_developers ad ON ad.developer_id = d.id
      JOIN legacy.apps a ON a.appid = ad.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }

  return parts.join('\nUNION ALL\n');
}

function buildBaseCtes(params: {
  companyType: CompanyType;
  minGames?: number;
  minRevenue?: number;
  status?: StatusFilter;
}): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const having: string[] = ['COUNT(DISTINCT ca.appid) > 0'];
  if (params.minGames !== undefined) {
    values.push(params.minGames);
    having.push(`COUNT(DISTINCT ca.appid) >= $${values.length}`);
  }
  if (params.minRevenue !== undefined) {
    values.push(params.minRevenue);
    having.push(`COALESCE(SUM(COALESCE(ldm.owners_midpoint, ((COALESCE(ldm.owners_min, 0)::bigint + COALESCE(ldm.owners_max, 0)::bigint) / 2))::numeric * COALESCE(ldm.price_cents, a.current_price_cents, 0)), 0) >= $${values.length}`);
  }
  if (params.status === 'active') {
    having.push(`COUNT(*) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year') > 0`);
  }
  if (params.status === 'dormant') {
    having.push(`COUNT(*) FILTER (WHERE a.release_date >= CURRENT_DATE - INTERVAL '1 year') = 0`);
  }

  return {
    values,
    sql: `
      WITH company_apps AS (
        ${buildCompanyAppsSql(params.companyType)}
      ),
      filtered_companies AS (
        SELECT ca.type, ca.id
        FROM company_apps ca
        JOIN legacy.apps a ON a.appid = ca.appid
        LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = ca.appid
        GROUP BY ca.type, ca.id
        HAVING ${having.join(' AND ')}
      )
    `,
  };
}

function queryForFilter(filterType: FilterType, baseSql: string): string {
  switch (filterType) {
    case 'genre':
      return `${baseSql}
        SELECT sg.genre_id AS option_id, sg.name AS option_name, COUNT(DISTINCT fc.type || ':' || fc.id)::integer AS company_count
        FROM filtered_companies fc
        JOIN company_apps ca ON ca.type = fc.type AND ca.id = fc.id
        JOIN legacy.app_genres ag ON ag.appid = ca.appid
        JOIN legacy.steam_genres sg ON sg.genre_id = ag.genre_id
        GROUP BY sg.genre_id, sg.name
        ORDER BY company_count DESC, option_name
        LIMIT 100
      `;
    case 'tag':
      return `${baseSql}
        SELECT st.tag_id AS option_id, st.name AS option_name, COUNT(DISTINCT fc.type || ':' || fc.id)::integer AS company_count
        FROM filtered_companies fc
        JOIN company_apps ca ON ca.type = fc.type AND ca.id = fc.id
        JOIN legacy.app_steam_tags ast ON ast.appid = ca.appid
        JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
        GROUP BY st.tag_id, st.name
        ORDER BY company_count DESC, option_name
        LIMIT 100
      `;
    case 'category':
      return `${baseSql}
        SELECT sc.category_id AS option_id, sc.name AS option_name, COUNT(DISTINCT fc.type || ':' || fc.id)::integer AS company_count
        FROM filtered_companies fc
        JOIN company_apps ca ON ca.type = fc.type AND ca.id = fc.id
        JOIN legacy.app_categories ac ON ac.appid = ca.appid
        JOIN legacy.steam_categories sc ON sc.category_id = ac.category_id
        GROUP BY sc.category_id, sc.name
        ORDER BY company_count DESC, option_name
        LIMIT 100
      `;
    case 'steam_deck':
      return `${baseSql}
        SELECT
          CASE best_category
            WHEN 'verified' THEN 1
            WHEN 'playable' THEN 2
            WHEN 'unsupported' THEN 3
            ELSE 4
          END AS option_id,
          COALESCE(best_category, 'unknown') AS option_name,
          COUNT(*)::integer AS company_count
        FROM (
          SELECT fc.type, fc.id,
            CASE MIN(
              CASE sd.category
                WHEN 'verified' THEN 1
                WHEN 'playable' THEN 2
                WHEN 'unsupported' THEN 3
                ELSE 4
              END
            )
              WHEN 1 THEN 'verified'
              WHEN 2 THEN 'playable'
              WHEN 3 THEN 'unsupported'
              ELSE NULL
            END AS best_category
          FROM filtered_companies fc
          JOIN company_apps ca ON ca.type = fc.type AND ca.id = fc.id
          LEFT JOIN legacy.app_steam_deck sd ON sd.appid = ca.appid
          GROUP BY fc.type, fc.id
        ) companies
        GROUP BY best_category
        ORDER BY option_id
      `;
  }
}

function queryForUnfilteredFacet(filterType: Exclude<FilterType, 'steam_deck'>, companyType: CompanyType): string {
  const config = {
    genre: {
      appFacetTable: 'legacy.app_genres',
      facetAlias: 'ag',
      optionColumn: 'genre_id',
      optionTable: 'legacy.steam_genres',
      optionAlias: 'sg',
      nameColumn: 'name',
      topLimit: 150,
    },
    tag: {
      appFacetTable: 'legacy.app_steam_tags',
      facetAlias: 'ast',
      optionColumn: 'tag_id',
      optionTable: 'legacy.steam_tags',
      optionAlias: 'st',
      nameColumn: 'name',
      topLimit: 250,
    },
    category: {
      appFacetTable: 'legacy.app_categories',
      facetAlias: 'ac',
      optionColumn: 'category_id',
      optionTable: 'legacy.steam_categories',
      optionAlias: 'sc',
      nameColumn: 'name',
      topLimit: 200,
    },
  }[filterType];

  const parts: string[] = [];
  if (companyType === 'all' || companyType === 'publisher') {
    parts.push(`
      SELECT ${config.facetAlias}.${config.optionColumn} AS option_id, 'publisher:' || ap.publisher_id::text AS company_key
      FROM top_options top
      JOIN ${config.appFacetTable} ${config.facetAlias} ON ${config.facetAlias}.${config.optionColumn} = top.option_id
      JOIN legacy.app_publishers ap ON ap.appid = ${config.facetAlias}.appid
      JOIN legacy.apps a ON a.appid = ${config.facetAlias}.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }
  if (companyType === 'all' || companyType === 'developer') {
    parts.push(`
      SELECT ${config.facetAlias}.${config.optionColumn} AS option_id, 'developer:' || ad.developer_id::text AS company_key
      FROM top_options top
      JOIN ${config.appFacetTable} ${config.facetAlias} ON ${config.facetAlias}.${config.optionColumn} = top.option_id
      JOIN legacy.app_developers ad ON ad.appid = ${config.facetAlias}.appid
      JOIN legacy.apps a ON a.appid = ${config.facetAlias}.appid
      WHERE COALESCE(a.type, 'game') = 'game'
        AND COALESCE(a.is_released, true) = true
        AND COALESCE(a.is_delisted, false) = false
    `);
  }

  return `
    WITH top_options AS (
      SELECT ${config.optionColumn} AS option_id
      FROM ${config.appFacetTable}
      GROUP BY ${config.optionColumn}
      ORDER BY COUNT(*) DESC
      LIMIT ${config.topLimit}
    ),
    facet_companies AS (
      ${parts.join('\nUNION ALL\n')}
    )
    SELECT
      ${config.optionAlias}.${config.optionColumn} AS option_id,
      ${config.optionAlias}.${config.nameColumn} AS option_name,
      COUNT(DISTINCT fc.company_key)::integer AS company_count
    FROM facet_companies fc
    JOIN ${config.optionTable} ${config.optionAlias} ON ${config.optionAlias}.${config.optionColumn} = fc.option_id
    GROUP BY ${config.optionAlias}.${config.optionColumn}, ${config.optionAlias}.${config.nameColumn}
    ORDER BY company_count DESC, option_name
    LIMIT 100
  `;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const filterType = searchParams.get('filterType') as FilterType | null;
  if (!filterType || !['genre', 'tag', 'category', 'steam_deck'].includes(filterType)) {
    return NextResponse.json({ error: 'Invalid filterType' }, { status: 400 });
  }

  const cacheKey = searchParams.toString();
  const cached = filterCountCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      data: cached.data.map((row) => ({
        option_id: Number(row.option_id),
        option_name: row.option_name,
        company_count: Number(row.company_count),
      })),
    });
  }

  const companyType = parseCompanyType(searchParams.get('type'));
  const minGames = parseNumber(searchParams.get('minGames'));
  const minRevenue = parseNumber(searchParams.get('minRevenue'));
  const status = parseStatus(searchParams.get('status'));
  const canUseFastFacetQuery = filterType !== 'steam_deck'
    && minGames === undefined
    && minRevenue === undefined
    && status === undefined;

  const query = canUseFastFacetQuery
    ? queryForUnfilteredFacet(filterType as Exclude<FilterType, 'steam_deck'>, companyType)
    : (() => {
        const { sql, values } = buildBaseCtes({ companyType, minGames, minRevenue, status });
        return { sql: queryForFilter(filterType, sql), values };
      })();

  const { rows } = typeof query === 'string'
    ? await runTigerQuery<FilterOptionRow>(query)
    : await runTigerQuery<FilterOptionRow>(query.sql, query.values);
  if (filterCountCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = filterCountCache.keys().next().value as string | undefined;
    if (oldestKey) filterCountCache.delete(oldestKey);
  }
  filterCountCache.set(cacheKey, { data: rows, timestamp: Date.now() });

  return NextResponse.json({
    data: rows.map((row) => ({
      option_id: Number(row.option_id),
      option_name: row.option_name,
      company_count: Number(row.company_count),
    })),
  });
}
