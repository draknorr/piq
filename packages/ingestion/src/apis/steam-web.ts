import { API_URLS, logger, ApiError } from '@publisheriq/shared';
import { withRetry } from '../utils/retry.js';

const log = logger.child({ component: 'SteamWebAPI' });

/**
 * Response from Steam's IStoreService/GetAppList API
 */
interface StoreAppListResponse {
  response: {
    apps: Array<{
      appid: number;
      name: string;
      last_modified: number;
      price_change_number: number;
    }>;
    have_more_results?: boolean;
    last_appid?: number;
  };
}

export interface SteamAppChangeHint extends SteamApp {
  lastModified: number;
  priceChangeNumber: number;
}

/**
 * Simplified app entry from Steam
 */
export interface SteamApp {
  appid: number;
  name: string;
}

async function fetchStoreAppListPage(
  lastAppId?: number,
  ifModifiedSince?: number,
  fetchImpl: typeof fetch = fetch
): Promise<StoreAppListResponse> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    throw new Error('STEAM_API_KEY environment variable is required');
  }

  const url = new URL(`${API_URLS.STEAM_WEB}/IStoreService/GetAppList/v1/`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('max_results', '50000');
  if (lastAppId !== undefined) {
    url.searchParams.set('last_appid', lastAppId.toString());
  }
  if (ifModifiedSince !== undefined) {
    url.searchParams.set('if_modified_since', ifModifiedSince.toString());
  }

  return withRetry(async () => {
    const res = await fetchImpl(url.toString());

    if (!res.ok) {
      throw new ApiError(`Failed to fetch app list: ${res.statusText}`, res.status, url.toString());
    }

    return res.json() as Promise<StoreAppListResponse>;
  });
}

/**
 * Fetch the complete list of all apps on Steam using IStoreService
 * This is the recommended endpoint as ISteamApps/GetAppList is deprecated.
 * Requires a Steam Web API key.
 *
 * @returns Array of all Steam apps with appid and name
 */
export async function fetchSteamAppList(
  options: { fetchImpl?: typeof fetch } = {}
): Promise<SteamApp[]> {
  const allApps: SteamApp[] = [];
  let lastAppId: number | undefined;
  let hasMore = true;
  let pageCount = 0;

  log.info('Fetching Steam app list from IStoreService');

  while (hasMore) {
    pageCount++;
    const response = await fetchStoreAppListPage(lastAppId, undefined, options.fetchImpl);

    const apps = response.response.apps || [];
    for (const app of apps) {
      allApps.push({
        appid: app.appid,
        name: app.name,
      });
    }

    hasMore = response.response.have_more_results === true;
    lastAppId = response.response.last_appid;

    log.info('Fetched app list page', { page: pageCount, appsInPage: apps.length, totalApps: allApps.length });
  }

  log.info('Fetched complete Steam app list', { count: allApps.length, pages: pageCount });

  return allApps;
}

export async function fetchSteamAppChangeHints(
  options: { fetchImpl?: typeof fetch; ifModifiedSince?: number | null } = {}
): Promise<SteamAppChangeHint[]> {
  const hints: SteamAppChangeHint[] = [];
  let lastAppId: number | undefined;
  let hasMore = true;
  const ifModifiedSince =
    typeof options.ifModifiedSince === 'number' &&
    Number.isSafeInteger(options.ifModifiedSince) &&
    options.ifModifiedSince >= 0
      ? options.ifModifiedSince
      : undefined;

  while (hasMore) {
    const response = await fetchStoreAppListPage(lastAppId, ifModifiedSince, options.fetchImpl);
    const apps = response.response.apps ?? [];
    for (const app of apps) {
      hints.push({
        appid: app.appid,
        name: app.name,
        lastModified: app.last_modified,
        priceChangeNumber: app.price_change_number,
      });
    }

    hasMore = response.response.have_more_results === true;
    lastAppId = response.response.last_appid;
  }

  return hints;
}

/**
 * Get news for a specific app
 */
export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
}

interface NewsResponse {
  appnews: {
    appid: number;
    newsitems: NewsItem[];
    count: number;
  };
}

/**
 * Fetch news/announcements for a specific app
 *
 * @param appid - Steam app ID
 * @param count - Number of news items to fetch (max 100)
 * @returns Array of news items
 */
export async function fetchAppNews(
  appid: number,
  options: {
    count?: number;
    maxLength?: number;
    endDateUnix?: number;
  } = {}
): Promise<NewsItem[]> {
  const url = new URL(`${API_URLS.STEAM_WEB}/ISteamNews/GetNewsForApp/v2/`);
  url.searchParams.set('appid', appid.toString());
  url.searchParams.set('count', String(options.count ?? 10));
  if (options.maxLength !== undefined) {
    url.searchParams.set('maxlength', String(options.maxLength));
  }
  if (options.endDateUnix !== undefined) {
    url.searchParams.set('enddate', String(options.endDateUnix));
  }

  const response = await withRetry(async () => {
    const res = await fetch(url.toString());

    // Steam returns 403 with an empty body for some delisted or inaccessible apps.
    // Treat that as "no accessible news" so workers do not burn through 5 queue retries.
    if (res.status === 403) {
      log.info('Steam news inaccessible for app; treating as empty response', {
        appid,
        url: url.toString(),
      });
      return {
        appnews: {
          appid,
          newsitems: [],
          count: 0,
        },
      } satisfies NewsResponse;
    }

    if (!res.ok) {
      throw new ApiError(`Failed to fetch news for app ${appid}`, res.status, url.toString());
    }

    return res.json() as Promise<NewsResponse>;
  });

  return response.appnews?.newsitems || [];
}
