import {
  API_URLS,
  logger,
  ApiError,
  parseSteamTrailerManifests,
  STEAM_CATEGORY_WORKSHOP,
  type SteamTrailerManifest,
} from '@publisheriq/shared';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';

const log = logger.child({ component: 'StorefrontAPI' });

interface StorefrontAttemptLimiter {
  acquire(): Promise<void>;
}

export interface StorefrontFetchOptions {
  fetchImpl?: typeof fetch;
  limiter?: StorefrontAttemptLimiter;
}

/**
 * Steam Storefront API app details response
 */
export interface StorefrontAppDetails {
  success: boolean;
  data?: {
    type: string;
    name: string;
    steam_appid: number;
    required_age: number | string;
    is_free: boolean;
    controller_support?: string;
    dlc?: number[] | null;
    demos?: Array<{
      appid: number | string;
      description?: string;
    }> | null;
    detailed_description?: string;
    about_the_game?: string;
    short_description?: string;
    supported_languages?: string;
    header_image?: string;
    capsule_image?: string;
    capsule_imagev5?: string;
    website?: string;
    pc_requirements?: {
      minimum?: string;
      recommended?: string;
    };
    mac_requirements?: {
      minimum?: string;
      recommended?: string;
    };
    linux_requirements?: {
      minimum?: string;
      recommended?: string;
    };
    developers?: string[];
    publishers?: string[];
    price_overview?: {
      currency: string;
      initial: number;
      final: number;
      discount_percent: number;
      initial_formatted: string;
      final_formatted: string;
    };
    packages?: number[] | null;
    package_groups?: Array<{
      name: string;
      title: string;
      description: string;
      selection_text: string;
      save_text: string;
      display_type: number;
      is_recurring_subscription: string;
      subs: Array<{
        packageid: number;
        percent_savings_text: string;
        percent_savings: number;
        option_text: string;
        option_description: string;
        can_get_free_license: string;
        is_free_license: boolean;
        price_in_cents_with_discount: number;
      }> | null;
    }> | null;
    platforms: {
      windows: boolean;
      mac: boolean;
      linux: boolean;
    };
    metacritic?: {
      score: number;
      url: string;
    };
    categories?: Array<{
      id: number;
      description: string;
    }>;
    genres?: Array<{
      id: string;
      description: string;
    }>;
    screenshots?: Array<{
      id: number;
      path_thumbnail: string;
      path_full: string;
    }>;
    movies?: Array<{
      id: number;
      name: string;
      thumbnail: string;
      webm?: { '480': string; max: string };
      mp4?: { '480': string; max: string };
      highlight: boolean;
    }>;
    recommendations?: {
      total: number;
    };
    achievements?: {
      total: number;
      highlighted: Array<{
        name: string;
        path: string;
      }>;
    };
    release_date: {
      coming_soon: boolean;
      date: string;
    };
    support_info?: {
      url: string;
      email: string;
    };
    background?: string;
    background_raw?: string;
    content_descriptors?: {
      ids: number[];
      notes: string;
    };
    // For DLC and demo items, fullgame contains the parent game info
    fullgame?: {
      appid: string;
      name: string;
    };
  };
}

/**
 * Parsed app details from Storefront API
 */
export interface ParsedStorefrontApp {
  appid: number;
  name: string;
  type: string;
  isFree: boolean;
  isDelisted: boolean; // True when the Storefront page is inaccessible/removed.
  hasPurchasePackages: boolean;
  developers: string[];
  publishers: string[];
  releaseDate: string | null;
  releaseDateRaw: string;
  comingSoon: boolean;
  hasWorkshop: boolean;
  priceCents: number | null;
  discountPercent: number;
  categories: Array<{ id: number; description: string }>;
  genres: Array<{ id: string; description: string }>;
  platforms: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  };
  metacriticScore: number | null;
  totalRecommendations: number | null;
  dlcAppids: number[];
  demoAppids: number[];
  parentAppid: number | null; // For DLC/demo items, the base game appid from fullgame field
  detailedDescription: string | null;
  aboutTheGame: string | null;
  shortDescription: string | null;
  supportedLanguages: string | null;
  controllerSupport: string | null;
  headerImage: string | null;
  capsuleImage: string | null;
  backgroundImage: string | null;
  website: string | null;
  packageIds: number[];
  packageGroupSubs: number[];
  screenshots: Array<{
    id: number | null;
    thumbnailUrl: string | null;
    fullUrl: string;
  }>;
  movies: Array<{
    id: number | null;
    name: string | null;
    thumbnailUrl: string | null;
    mp4Url: string | null;
    webmUrl: string | null;
    hlsUrl: string | null;
    highlight: boolean;
  }>;
  fieldPresence?: {
    categories: boolean;
    genres: boolean;
    languages: boolean;
    platforms: boolean;
  };
}

/**
 * Result type for storefront fetch that distinguishes between
 * "no data available" (Steam returned success=false) and actual errors
 */
export type StorefrontResult =
  | { status: 'success'; data: ParsedStorefrontApp }
  | { status: 'no_data' } // Steam returned success=false (private/removed/age-gated)
  | { status: 'error'; error: string };

/**
 * Parse a date string from Steam's format
 * Handles various formats like "Mar 15, 2020", "15 Mar 2020", "Q1 2021", etc.
 */
function parseReleaseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.toLowerCase() === 'coming soon') {
    return null;
  }

  // Try standard formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  // Handle "Q1 2021" style dates - return first day of quarter
  const quarterMatch = dateStr.match(/Q(\d)\s*(\d{4})/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = parseInt(quarterMatch[2], 10);
    const month = (quarter - 1) * 3;
    return `${year}-${String(month + 1).padStart(2, '0')}-01`;
  }

  // Handle "2021" only
  const yearMatch = dateStr.match(/^(\d{4})$/);
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`;
  }

  return null;
}

/**
 * Check if app has Workshop support based on categories
 */
function hasWorkshopSupport(categories?: Array<{ id: number }>): boolean {
  if (!categories) return false;
  return categories.some((cat) => cat.id === STEAM_CATEGORY_WORKSHOP);
}

function normalizeAppidList(values: Array<number | string | null | undefined>): number[] {
  return Array.from(
    new Set(
      values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    )
  ).sort((left, right) => left - right);
}

function normalizeOptionalAppid(value: number | string | null | undefined): number | null {
  const appid = Number(value);
  return Number.isInteger(appid) && appid > 0 ? appid : null;
}

/**
 * Parse Storefront API response into a cleaner format
 */
export function parseStorefrontResponse(
  appid: number,
  response: StorefrontAppDetails
): ParsedStorefrontApp | null {
  if (!response.success || !response.data) {
    return null;
  }

  const data = response.data;
  const packageIds = data.packages ?? [];
  const packageGroupSubs =
    data.package_groups?.flatMap((group) => (group.subs ?? []).map((sub) => sub.packageid)) ?? [];
  const hasPurchasePackages = packageIds.length > 0 || packageGroupSubs.length > 0;

  return {
    appid,
    name: data.name,
    type: data.type,
    isFree: data.is_free,
    isDelisted: false,
    hasPurchasePackages,
    developers: data.developers || [],
    publishers: data.publishers || [],
    releaseDate: parseReleaseDate(data.release_date?.date || ''),
    releaseDateRaw: data.release_date?.date || '',
    comingSoon: data.release_date?.coming_soon || false,
    hasWorkshop: hasWorkshopSupport(data.categories),
    priceCents: data.price_overview?.final ?? null,
    discountPercent: data.price_overview?.discount_percent ?? 0,
    categories: data.categories || [],
    genres: data.genres || [],
    platforms: data.platforms || { windows: false, mac: false, linux: false },
    metacriticScore: data.metacritic?.score ?? null,
    totalRecommendations: data.recommendations?.total ?? null,
    dlcAppids: normalizeAppidList(data.dlc ?? []),
    demoAppids: normalizeAppidList((data.demos ?? []).map((demo) => demo.appid)),
    parentAppid: normalizeOptionalAppid(data.fullgame?.appid),
    detailedDescription: data.detailed_description ?? null,
    aboutTheGame: data.about_the_game ?? null,
    shortDescription: data.short_description ?? null,
    supportedLanguages: data.supported_languages ?? null,
    controllerSupport: data.controller_support ?? null,
    headerImage: data.header_image ?? null,
    capsuleImage: data.capsule_imagev5 ?? data.capsule_image ?? null,
    backgroundImage: data.background_raw ?? data.background ?? null,
    website: data.website ?? null,
    packageIds,
    packageGroupSubs,
    screenshots: (data.screenshots ?? []).map((screenshot) => ({
      id: screenshot.id ?? null,
      thumbnailUrl: screenshot.path_thumbnail ?? null,
      fullUrl: screenshot.path_full,
    })),
    movies: (data.movies ?? []).map((movie) => ({
      id: movie.id ?? null,
      name: movie.name ?? null,
      thumbnailUrl: movie.thumbnail ?? null,
      mp4Url: movie.mp4?.max ?? movie.mp4?.['480'] ?? null,
      webmUrl: movie.webm?.max ?? movie.webm?.['480'] ?? null,
      hlsUrl: null,
      highlight: Boolean(movie.highlight),
    })),
    fieldPresence: {
      categories: Object.prototype.hasOwnProperty.call(data, 'categories'),
      genres: Object.prototype.hasOwnProperty.call(data, 'genres'),
      languages: Object.prototype.hasOwnProperty.call(data, 'supported_languages'),
      platforms: Object.prototype.hasOwnProperty.call(data, 'platforms'),
    },
  };
}

export function applyStorefrontTrailerManifests(
  details: ParsedStorefrontApp,
  manifests: SteamTrailerManifest[]
): ParsedStorefrontApp {
  const byMediaId = new Map(manifests.map((manifest) => [manifest.mediaId, manifest]));
  return {
    ...details,
    movies: details.movies.map((movie) => ({
      ...movie,
      hlsUrl: movie.id === null ? movie.hlsUrl : (byMediaId.get(movie.id)?.hlsUrl ?? movie.hlsUrl),
    })),
  };
}

export async function fetchStorefrontTrailerManifests(
  appid: number
): Promise<SteamTrailerManifest[]> {
  await rateLimiters.storefront.acquire();
  const url = `${API_URLS.STEAM_STORE}/app/${appid}/?l=english&cc=us`;
  try {
    const response = await withRetry(async () => {
      const result = await fetch(url, {
        headers: {
          Accept: 'text/html',
          Cookie: 'birthtime=0; mature_content=1',
        },
      });
      if (!result.ok) {
        throw new ApiError(
          `Failed to fetch Storefront trailer data for ${appid}`,
          result.status,
          url
        );
      }
      return result.text();
    });
    return parseSteamTrailerManifests(response);
  } catch (error) {
    log.warn('Failed to fetch Storefront trailer manifests', { appid, error });
    return [];
  }
}

/**
 * Fetch app details from Steam Storefront API
 * Rate limit: ~200 requests per 5 minutes
 *
 * @param appid - Steam app ID
 * @returns StorefrontResult with status indicating success, no_data, or error
 */
export async function fetchStorefrontAppDetails(
  appid: number,
  options: StorefrontFetchOptions = {}
): Promise<StorefrontResult> {
  const url = `${API_URLS.STEAM_STORE}/api/appdetails/?appids=${appid}&cc=us`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter ?? rateLimiters.storefront;

  try {
    const response = await withRetry(async () => {
      // Every actual attempt consumes a Storefront-origin governor token.
      await limiter.acquire();
      // Include age-gate cookies to access adult content
      const res = await fetchImpl(url, {
        headers: {
          Cookie: 'birthtime=0; mature_content=1',
        },
      });

      if (!res.ok) {
        throw new ApiError(`Failed to fetch Storefront details for ${appid}`, res.status, url);
      }

      return res.json() as Promise<Record<string, StorefrontAppDetails>>;
    });

    const appData = response[String(appid)];

    // Steam returned success=false - app is private, removed, or age-gated
    if (!appData || !appData.success || !appData.data) {
      return { status: 'no_data' };
    }

    const parsed = parseStorefrontResponse(appid, appData);
    if (!parsed) {
      return { status: 'no_data' };
    }

    return { status: 'success', data: parsed };
  } catch (error) {
    log.error('Failed to fetch Storefront app details', { appid, error });
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetch multiple apps from Storefront API
 * Note: Bulk requests only work reliably with price_overview filter
 *
 * @param appids - Array of Steam app IDs
 * @returns Map of appid to StorefrontResult
 */
export async function fetchStorefrontAppDetailsBatch(
  appids: number[]
): Promise<Map<number, StorefrontResult>> {
  const results = new Map<number, StorefrontResult>();

  // Process one at a time with rate limiting
  for (const appid of appids) {
    const result = await fetchStorefrontAppDetails(appid);
    results.set(appid, result);
  }

  return results;
}

/**
 * Fetch only price information for multiple apps
 * This is faster as it uses the filters parameter
 */
export async function fetchStorefrontPrices(
  appids: number[],
  options: StorefrontFetchOptions = {}
): Promise<Map<number, { priceCents: number | null; discountPercent: number }>> {
  const url = `${API_URLS.STEAM_STORE}/api/appdetails/?appids=${appids.join(',')}&filters=price_overview&cc=us`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.limiter ?? rateLimiters.storefront;

  const results = new Map<number, { priceCents: number | null; discountPercent: number }>();

  try {
    const response = await withRetry(async () => {
      // Every actual attempt consumes a Storefront-origin governor token.
      await limiter.acquire();
      // Include age-gate cookies to access adult content
      const res = await fetchImpl(url, {
        headers: {
          Cookie: 'birthtime=0; mature_content=1',
        },
      });

      if (!res.ok) {
        throw new ApiError('Failed to fetch Storefront prices', res.status, url);
      }

      return res.json() as Promise<Record<string, StorefrontAppDetails>>;
    });

    for (const appid of appids) {
      const appData = response[String(appid)];
      if (appData?.success && appData.data?.price_overview) {
        results.set(appid, {
          priceCents: appData.data.price_overview.final,
          discountPercent: appData.data.price_overview.discount_percent,
        });
      } else {
        results.set(appid, { priceCents: null, discountPercent: 0 });
      }
    }
  } catch (error) {
    log.error('Failed to fetch Storefront prices', { appids, error });
    // Return empty results for all
    for (const appid of appids) {
      results.set(appid, { priceCents: null, discountPercent: 0 });
    }
  }

  return results;
}
