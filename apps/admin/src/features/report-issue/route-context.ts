import { sanitizeObject, sanitizeSearchParams, sanitizeUrl } from './sanitizer';
import type { JsonObject, RegisteredReportContext, ReportIssueClientContext } from './types';

const LISTING_FILTER_KEYS = new Set([
  'type',
  'search',
  'sort',
  'order',
  'preset',
  'quick',
  'minCcu',
  'maxCcu',
  'minScore',
  'maxScore',
  'minOwners',
  'maxOwners',
  'minGrowth7d',
  'minMomentum',
  'genres',
  'genreMode',
  'tags',
  'tagMode',
  'categories',
  'platforms',
  'platformMode',
  'steamDeck',
  'controller',
  'releaseYear',
  'minAge',
  'maxAge',
  'earlyAccess',
  'publisher',
  'developer',
  'selfPublished',
  'publisherSize',
  'vsPublisher',
  'ccuTier',
]);

export interface InferredRouteContext {
  filters: JsonObject;
  pathname: string;
  routeKind: string;
  routeParams: JsonObject;
  searchParams: JsonObject;
  url: string | null;
}

function collectListingFilters(params: URLSearchParams): JsonObject {
  const filters: JsonObject = {};
  for (const [key, value] of params.entries()) {
    if (LISTING_FILTER_KEYS.has(key)) {
      filters[key] = value;
    }
  }
  return filters;
}

export function inferRouteContext(pathname: string, search = '', url?: string): InferredRouteContext {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const routeParams: JsonObject = {};
  let routeKind = 'unknown';

  const appDetail = pathname.match(/^\/apps\/([^/?#]+)$/);
  const developerDetail = pathname.match(/^\/developers\/([^/?#]+)$/);
  const publisherDetail = pathname.match(/^\/publishers\/([^/?#]+)$/);

  if (pathname === '/chat') {
    routeKind = 'chat';
  } else if (appDetail) {
    routeKind = 'app_detail';
    routeParams.appId = appDetail[1];
  } else if (pathname === '/apps') {
    routeKind = 'apps_listing';
  } else if (pathname === '/companies') {
    routeKind = 'companies_listing';
  } else if (developerDetail) {
    routeKind = 'developer_detail';
    routeParams.developerId = developerDetail[1];
  } else if (pathname === '/developers') {
    routeKind = 'developers_listing';
  } else if (publisherDetail) {
    routeKind = 'publisher_detail';
    routeParams.publisherId = publisherDetail[1];
  } else if (pathname === '/publishers') {
    routeKind = 'publishers_listing';
  } else if (pathname === '/changes') {
    routeKind = 'change_feed';
  } else if (pathname === '/insights') {
    routeKind = 'insights';
  } else if (pathname === '/dashboard') {
    routeKind = 'dashboard';
  } else if (pathname.startsWith('/admin')) {
    routeKind = 'admin';
  } else if (pathname === '/account') {
    routeKind = 'account';
  }

  return {
    filters: sanitizeObject(collectListingFilters(params), { maxStringLength: 500 }),
    pathname,
    routeKind,
    routeParams,
    searchParams: sanitizeSearchParams(params),
    url: sanitizeUrl(url),
  };
}

function collectBrowserContext(): JsonObject {
  if (typeof window === 'undefined') return {};

  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  }).connection ?? null;

  return sanitizeObject({
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    maxTouchPoints: navigator.maxTouchPoints,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    screen: window.screen
      ? {
          width: window.screen.width,
          height: window.screen.height,
          colorDepth: window.screen.colorDepth,
        }
      : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connection: connection
      ? {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
        }
      : null,
  });
}

function collectAppContext(): JsonObject {
  return sanitizeObject({
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      null,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? null,
  });
}

export function collectReportIssueClientContext(
  registeredContexts: RegisteredReportContext[] = []
): ReportIssueClientContext {
  const route = typeof window === 'undefined'
    ? inferRouteContext('', '')
    : inferRouteContext(
        window.location.pathname,
        window.location.search,
        window.location.href
      );

  const pageContext = sanitizeObject({
    documentTitle: typeof document === 'undefined' ? null : document.title,
    registered: registeredContexts,
  });

  return {
    app: collectAppContext(),
    browser: collectBrowserContext(),
    debug: {},
    page: pageContext,
    route: sanitizeObject(route),
  };
}
