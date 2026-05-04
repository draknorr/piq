import 'server-only';

import { runTigerQuery } from '@publisheriq/database';

// Types
export type EntityType = 'developer' | 'publisher';

export interface PortfolioGenre {
  genre_id: number;
  name: string;
  game_count: number | null;
  is_primary_count: number;
}

export interface PortfolioCategory {
  category_id: number;
  name: string;
  game_count: number | null;
}

export interface PortfolioPlatformStats {
  platforms: {
    windows: number;
    macos: number;
    linux: number;
  };
  controllerSupport: {
    full: number;
    partial: number;
    none: number;
  };
  steamDeck: {
    verified: number;
    playable: number;
    unsupported: number;
    unknown: number;
  };
  totalGames: number;
}

export interface PortfolioFranchise {
  id: number;
  name: string;
  game_count: number | null;
}

export interface PortfolioLanguage {
  language: string;
  game_count: number | null;
}

export interface PortfolioContentDescriptor {
  descriptor_id: string;
  label: string;
  severity: 'high' | 'medium';
  game_count: number;
}

export interface PortfolioPICSData {
  genres: PortfolioGenre[];
  categories: PortfolioCategory[];
  platformStats: PortfolioPlatformStats;
  franchises: PortfolioFranchise[];
  languages: PortfolioLanguage[];
  contentDescriptors: PortfolioContentDescriptor[];
}

// Content descriptor mapping
const CONTENT_DESCRIPTOR_MAP: Record<string, { label: string; severity: 'high' | 'medium' }> = {
  '1': { label: 'Some Nudity or Sexual Content', severity: 'medium' },
  '2': { label: 'Frequent Violence or Gore', severity: 'medium' },
  '3': { label: 'Adult Only Sexual Content', severity: 'high' },
  '4': { label: 'Frequent Nudity or Sexual Content', severity: 'high' },
  '5': { label: 'General Mature Content', severity: 'medium' },
};

// Helper: Get all appids for an entity
async function getEntityAppIds(entityType: EntityType, entityId: number): Promise<number[]> {
  const junctionTable = entityType === 'developer' ? 'app_developers' : 'app_publishers';
  const idColumn = entityType === 'developer' ? 'developer_id' : 'publisher_id';

  const { rows } = await runTigerQuery<{ appid: number }>(
    `
      SELECT appid
      FROM legacy.${junctionTable}
      WHERE ${idColumn} = $1
    `,
    [entityId]
  );

  return rows.map((row) => row.appid);
}

// Get genre distribution
async function getPortfolioGenres(appIds: number[]): Promise<PortfolioGenre[]> {
  if (appIds.length === 0) return [];

  const { rows } = await runTigerQuery<PortfolioGenre>(
    `
      SELECT
        ag.genre_id,
        COALESCE(sg.name, 'Unknown') AS name,
        COUNT(DISTINCT ag.appid)::integer AS game_count,
        COUNT(DISTINCT ag.appid) FILTER (WHERE COALESCE(ag.is_primary, false))::integer AS is_primary_count
      FROM legacy.app_genres ag
      LEFT JOIN legacy.steam_genres sg ON sg.genre_id = ag.genre_id
      WHERE ag.appid = ANY($1::int[])
      GROUP BY ag.genre_id, sg.name
      ORDER BY game_count DESC, name
    `,
    [appIds]
  );

  return rows;
}

// Get category/feature distribution
async function getPortfolioCategories(appIds: number[]): Promise<PortfolioCategory[]> {
  if (appIds.length === 0) return [];

  const { rows } = await runTigerQuery<PortfolioCategory>(
    `
      SELECT
        ac.category_id,
        COALESCE(sc.name, 'Unknown') AS name,
        COUNT(DISTINCT ac.appid)::integer AS game_count
      FROM legacy.app_categories ac
      LEFT JOIN legacy.steam_categories sc ON sc.category_id = ac.category_id
      WHERE ac.appid = ANY($1::int[])
      GROUP BY ac.category_id, sc.name
      ORDER BY game_count DESC, name
    `,
    [appIds]
  );

  return rows;
}

// Get platform, controller support, and Steam Deck stats
async function getPortfolioPlatformStats(appIds: number[]): Promise<PortfolioPlatformStats> {
  const emptyStats: PortfolioPlatformStats = {
    platforms: { windows: 0, macos: 0, linux: 0 },
    controllerSupport: { full: 0, partial: 0, none: 0 },
    steamDeck: { verified: 0, playable: 0, unsupported: 0, unknown: 0 },
    totalGames: 0,
  };

  if (appIds.length === 0) return emptyStats;

  const [appsResult, steamDeckResult] = await Promise.all([
    runTigerQuery<{ appid: number; platforms: string | null; controller_support: string | null }>(
      `
        SELECT appid, platforms, controller_support
        FROM legacy.apps
        WHERE appid = ANY($1::int[])
      `,
      [appIds]
    ),
    runTigerQuery<{ appid: number; category: string | null }>(
      `
        SELECT appid, category
        FROM legacy.app_steam_deck
        WHERE appid = ANY($1::int[])
      `,
      [appIds]
    ),
  ]);

  const platforms = { windows: 0, macos: 0, linux: 0 };
  const controllerSupport = { full: 0, partial: 0, none: 0 };
  const steamDeck = { verified: 0, playable: 0, unsupported: 0, unknown: 0 };

  for (const app of appsResult.rows) {
    const platformStr = (app.platforms ?? '').toLowerCase();
    if (platformStr.includes('windows')) platforms.windows++;
    if (platformStr.includes('macos') || platformStr.includes('mac')) platforms.macos++;
    if (platformStr.includes('linux')) platforms.linux++;

    const controller = (app.controller_support ?? '').toLowerCase();
    if (controller === 'full') controllerSupport.full++;
    else if (controller === 'partial') controllerSupport.partial++;
    else controllerSupport.none++;
  }

  for (const sd of steamDeckResult.rows) {
    const category = (sd.category ?? '').toLowerCase();
    if (category === 'verified') steamDeck.verified++;
    else if (category === 'playable') steamDeck.playable++;
    else if (category === 'unsupported') steamDeck.unsupported++;
    else steamDeck.unknown++;
  }

  // Games without Steam Deck data count as unknown
  const gamesWithDeckData = steamDeckResult.rows.length;
  steamDeck.unknown += appIds.length - gamesWithDeckData;

  return {
    platforms,
    controllerSupport,
    steamDeck,
    totalGames: appIds.length,
  };
}

// Get franchises
async function getPortfolioFranchises(appIds: number[]): Promise<PortfolioFranchise[]> {
  if (appIds.length === 0) return [];

  const { rows } = await runTigerQuery<PortfolioFranchise>(
    `
      SELECT
        f.id::integer AS id,
        f.name,
        COUNT(DISTINCT af.appid)::integer AS game_count
      FROM legacy.app_franchises af
      JOIN legacy.franchises f ON f.id = af.franchise_id
      WHERE af.appid = ANY($1::int[])
      GROUP BY f.id, f.name
      ORDER BY game_count DESC, f.name
    `,
    [appIds]
  );

  return rows;
}

// Get language support
async function getPortfolioLanguages(appIds: number[]): Promise<PortfolioLanguage[]> {
  if (appIds.length === 0) return [];

  const { rows } = await runTigerQuery<PortfolioLanguage>(
    `
      SELECT
        language,
        COUNT(*)::integer AS game_count
      FROM legacy.apps a
      CROSS JOIN LATERAL jsonb_object_keys(
        CASE WHEN jsonb_typeof(a.languages) = 'object' THEN a.languages ELSE '{}'::jsonb END
      ) AS language
      WHERE a.appid = ANY($1::int[])
      GROUP BY language
      ORDER BY game_count DESC, language
    `,
    [appIds]
  );

  return rows;
}

// Get content descriptors
async function getPortfolioContentDescriptors(appIds: number[]): Promise<PortfolioContentDescriptor[]> {
  if (appIds.length === 0) return [];

  const { rows } = await runTigerQuery<{ descriptor_id: string; game_count: number }>(
    `
      SELECT
        descriptor.value #>> '{}' AS descriptor_id,
        COUNT(*)::integer AS game_count
      FROM legacy.apps a
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.content_descriptors) = 'array' THEN a.content_descriptors ELSE '[]'::jsonb END
      ) AS descriptor(value)
      WHERE a.appid = ANY($1::int[])
      GROUP BY descriptor_id
      ORDER BY game_count DESC
    `,
    [appIds]
  );

  const results: PortfolioContentDescriptor[] = [];
  for (const { descriptor_id, game_count } of rows) {
    const info = CONTENT_DESCRIPTOR_MAP[descriptor_id];
    if (info) {
      results.push({ descriptor_id, label: info.label, severity: info.severity, game_count });
    }
  }
  return results.sort((a, b) => b.game_count - a.game_count);
}

// Main function to get all portfolio PICS data
export async function getPortfolioPICSData(
  entityType: EntityType,
  entityId: number
): Promise<PortfolioPICSData | null> {
  // Get all appids for this entity
  const appIds = await getEntityAppIds(entityType, entityId);
  if (appIds.length === 0) return null;

  // Run all PICS queries in parallel
  const [genres, categories, platformStats, franchises, languages, contentDescriptors] = await Promise.all([
    getPortfolioGenres(appIds),
    getPortfolioCategories(appIds),
    getPortfolioPlatformStats(appIds),
    getPortfolioFranchises(appIds),
    getPortfolioLanguages(appIds),
    getPortfolioContentDescriptors(appIds),
  ]);

  return {
    genres,
    categories,
    platformStats,
    franchises,
    languages,
    contentDescriptors,
  };
}
