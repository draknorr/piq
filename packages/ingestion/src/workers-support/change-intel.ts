import type { TypedSupabaseClient } from '@publisheriq/database';
import * as databaseIngestion from '@publisheriq/database/ingestion';
import { ApiError, logger } from '@publisheriq/shared';
import { fetchAppNews } from '../apis/steam-web.js';
import type { ParsedStorefrontApp } from '../apis/storefront.js';
import {
  getRemoteAssetContentHash,
  HeroAssetArchiver,
} from '../change-intel/hero-archive.js';
import { diffNewsVersions, normalizeNewsVersion } from '../change-intel/news.js';
import {
  completeCaptureQueueItems,
  enqueueCaptureJobs,
  getLastNewsSyncAt,
  getLatestHeroAssetContentHash,
  getLatestMediaVersion,
  getLatestNewsVersion,
  getLatestStorefrontSnapshot,
  insertChangeEvents,
  updateSyncStatusFields,
  upsertNewsItem,
  writeMediaVersion,
  writeNewsVersion,
  writeStorefrontSnapshot,
} from '../change-intel/repository.js';
import {
  collectChangedHeroAssets,
  diffStorefrontMedia,
  diffStorefrontSnapshots,
  diffVerifiedHeroMedia,
  normalizeStorefrontMediaVersion,
  normalizeStorefrontSnapshot,
} from '../change-intel/storefront.js';
import {
  isLaunchWindowRelease,
  promoteReviewsSync,
} from './reviews-sync.js';

const log = logger.child({ component: 'change-intel-support' });
const STEAM_NEWS_MAX_LENGTH = 20_000;
const DEFAULT_NEWS_STALE_HOURS = 24;
const DEFAULT_INCREMENTAL_NEWS_COUNT = 25;
const DEFAULT_CATCHUP_MAX_PAGES = 5;
const PROJECTION_REFRESH_CURSOR = 'recent';
const TERMINAL_NEWS_HTTP_STATUSES = new Set([403, 404, 410]);
const listNewsCatchupCandidates = (
  databaseIngestion as unknown as {
    listNewsCatchupCandidates: (params: {
      limit: number;
      staleBeforeIso: string;
    }) => Promise<Array<{ appid: number }>>;
    listHotNewsRefreshCandidates: (params: {
      limit: number;
      activeStaleBeforeIso: string;
      moderateStaleBeforeIso: string;
    }) => Promise<Array<{ appid: number }>>;
  }
).listNewsCatchupCandidates;
const listHotNewsRefreshCandidates = (
  databaseIngestion as unknown as {
    listHotNewsRefreshCandidates: (params: {
      limit: number;
      activeStaleBeforeIso: string;
      moderateStaleBeforeIso: string;
    }) => Promise<Array<{ appid: number }>>;
  }
).listHotNewsRefreshCandidates;

async function enqueueProjectionRefresh(supabase: TypedSupabaseClient, appid: number, triggerReason: string): Promise<void> {
  await enqueueCaptureJobs(supabase, [
    {
      appid,
      source: 'projection_refresh',
      triggerReason,
      triggerCursor: PROJECTION_REFRESH_CURSOR,
      priority: 80,
    },
  ]);
}

export type NewsCaptureMode = 'incremental' | 'catchup';

export interface CaptureNewsOptions {
  mode: NewsCaptureMode;
  triggerCursor: string | null;
}

function getNewsStaleWindowMs(): number {
  const hours = Math.max(1, parseInt(process.env.STEAM_NEWS_STALE_HOURS || `${DEFAULT_NEWS_STALE_HOURS}`, 10));
  return hours * 60 * 60 * 1000;
}

function getIncrementalNewsCount(): number {
  return Math.max(1, parseInt(process.env.STEAM_NEWS_INCREMENTAL_COUNT || `${DEFAULT_INCREMENTAL_NEWS_COUNT}`, 10));
}

function getCatchupMaxPages(): number {
  return Math.max(
    1,
    parseInt(process.env.STEAM_NEWS_CATCHUP_MAX_PAGES || process.env.STEAM_NEWS_MAX_PAGES || `${DEFAULT_CATCHUP_MAX_PAGES}`, 10)
  );
}

function getHotNewsRefreshLimit(): number {
  return Math.max(0, parseInt(process.env.HOT_NEWS_REFRESH_LIMIT || '0', 10));
}

function getHotNewsActiveStaleWindowMs(): number {
  const minutes = Math.max(5, parseInt(process.env.HOT_NEWS_ACTIVE_STALE_MINUTES || '30', 10));
  return minutes * 60 * 1000;
}

function getHotNewsModerateStaleWindowMs(): number {
  const hours = Math.max(1, parseInt(process.env.HOT_NEWS_MODERATE_STALE_HOURS || '2', 10));
  return hours * 60 * 60 * 1000;
}

export function resolveNewsCaptureMode(triggerReason: string): NewsCaptureMode {
  return triggerReason === 'stale_news_catchup' ? 'catchup' : 'incremental';
}

export function isTerminalNewsCaptureError(error: unknown): boolean {
  return error instanceof ApiError && TERMINAL_NEWS_HTTP_STATUSES.has(error.statusCode);
}

export function classifyNewsCaptureError(error: unknown): string {
  if (error instanceof ApiError) {
    return `steam_news_http_${error.statusCode}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function shouldCaptureIncrementalNews(
  lastNewsSync: string | null,
  observedAt = new Date().toISOString(),
  staleWindowMs = getNewsStaleWindowMs()
): boolean {
  if (!lastNewsSync) {
    return true;
  }

  const lastNewsSyncMs = Date.parse(lastNewsSync);
  const observedAtMs = Date.parse(observedAt);

  if (Number.isNaN(lastNewsSyncMs) || Number.isNaN(observedAtMs)) {
    return true;
  }

  return observedAtMs - lastNewsSyncMs >= staleWindowMs;
}

export function buildHintCursor(lastModified: number, priceChangeNumber: number): string {
  return `${lastModified}:${priceChangeNumber}`;
}

export async function captureStorefrontState(
  supabase: TypedSupabaseClient,
  appid: number,
  details: ParsedStorefrontApp,
  trigger: {
    triggerReason: string;
    triggerCursor: string | null;
  }
): Promise<{ snapshotChanged: boolean; mediaChanged: boolean }> {
  const observedAt = new Date().toISOString();
  const previousSnapshot = await getLatestStorefrontSnapshot(supabase, appid);
  const previousMedia = await getLatestMediaVersion(supabase, appid);

  const normalizedSnapshot = normalizeStorefrontSnapshot(details);
  const snapshotVersion = await writeStorefrontSnapshot(
    supabase,
    appid,
    normalizedSnapshot,
    trigger.triggerReason,
    trigger.triggerCursor,
    observedAt
  );

  const normalizedMedia = normalizeStorefrontMediaVersion(normalizedSnapshot);
  const mediaVersion = await writeMediaVersion(
    supabase,
    appid,
    snapshotVersion.currentId,
    normalizedMedia,
    observedAt
  );

  const verifiedHeroChanges = await diffVerifiedHeroMedia(previousMedia, normalizedMedia, {
    getPreviousContentHash: (kind) => getLatestHeroAssetContentHash(supabase, appid, kind),
    getCurrentContentHash: async (_kind, url) => getRemoteAssetContentHash(url),
  });

  const changeEvents = [
    ...diffStorefrontSnapshots(previousSnapshot, normalizedSnapshot),
    ...diffStorefrontMedia(previousMedia, normalizedMedia),
    ...verifiedHeroChanges.events,
  ];

  await insertChangeEvents(supabase, appid, changeEvents, {
    sourceSnapshotId: snapshotVersion.currentId,
    relatedSnapshotId: snapshotVersion.previousId,
    mediaVersionId: mediaVersion.currentId,
    triggerCursor: trigger.triggerCursor,
  });

  if (changeEvents.length > 0) {
    await enqueueProjectionRefresh(supabase, appid, 'storefront_change_event');
  }

  await updateSyncStatusFields(supabase, appid, {
    last_storefront_sync: observedAt,
    last_media_sync: observedAt,
    storefront_accessible: true,
    last_error_source: null,
    last_error_message: null,
    last_error_at: null,
  });

  const changedHeroAssets =
    previousMedia === null
      ? collectChangedHeroAssets(previousMedia, normalizedMedia)
      : verifiedHeroChanges.changedAssets;
  if (changedHeroAssets.length > 0) {
    await enqueueCaptureJobs(supabase, [
      {
        appid,
        source: 'hero_asset',
        triggerReason: 'storefront_media_change',
        triggerCursor: trigger.triggerCursor,
        priority: 50,
      },
    ]);
  }

  if (snapshotVersion.inserted) {
    const lastNewsSync = await getLastNewsSyncAt(supabase, appid);
    if (shouldCaptureIncrementalNews(lastNewsSync, observedAt)) {
      await enqueueCaptureJobs(supabase, [
        {
          appid,
          source: 'news',
          triggerReason: 'storefront_snapshot_change',
          triggerCursor: null,
          priority: 75,
        },
      ]);
    } else {
      log.debug('Skipping snapshot-triggered news enqueue because app news is still fresh', {
        appid,
        lastNewsSync,
      });
    }
  }

  const isGame = (details.type || 'game').toLowerCase() === 'game';
  const inLaunchWindow = isLaunchWindowRelease(!details.comingSoon, details.releaseDate);
  const shouldPromoteChangeCritical =
    isGame &&
    trigger.triggerReason !== 'storefront_safety_sweep' &&
    (snapshotVersion.inserted || changeEvents.length > 0);

  if (isGame && inLaunchWindow) {
    await promoteReviewsSync(supabase, {
      appid,
      bucket: 'launch_critical',
      score: 100,
      reason: 'storefront_launch_window_refresh',
      until: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    });
  } else if (shouldPromoteChangeCritical) {
    await promoteReviewsSync(supabase, {
      appid,
      bucket: 'change_critical',
      score: 70,
      reason: 'storefront_change_detected',
      until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });
  }

  return {
    snapshotChanged: snapshotVersion.inserted,
    mediaChanged: mediaVersion.inserted,
  };
}

export async function captureNewsForApp(
  supabase: TypedSupabaseClient,
  appid: number,
  options: CaptureNewsOptions
): Promise<number> {
  const observedAt = new Date().toISOString();
  if (options.mode === 'incremental') {
    const lastNewsSync = await getLastNewsSyncAt(supabase, appid);
    if (!shouldCaptureIncrementalNews(lastNewsSync, observedAt)) {
      log.debug('Skipping incremental news capture because app is already fresh', {
        appid,
        lastNewsSync,
      });
      return 0;
    }
  }

  const seen = new Set<string>();
  const maxPages = options.mode === 'catchup' ? getCatchupMaxPages() : 1;
  const pageSize = options.mode === 'catchup' ? 100 : getIncrementalNewsCount();
  let processedCount = 0;
  let endDateUnix: number | undefined;
  let stopPagination = false;
  let projectionRefreshNeeded = false;

  for (let page = 0; page < maxPages && !stopPagination; page += 1) {
    const batch = await fetchAppNews(appid, {
      count: pageSize,
      endDateUnix,
      maxLength: STEAM_NEWS_MAX_LENGTH,
    });

    if (batch.length === 0) {
      break;
    }

    for (const item of batch) {
      if (seen.has(item.gid)) {
        continue;
      }

      seen.add(item.gid);
      processedCount += 1;

      const normalized = normalizeNewsVersion(item);
      const previousVersion = await getLatestNewsVersion(supabase, item.gid);

      await upsertNewsItem(supabase, appid, normalized);
      const version = await writeNewsVersion(supabase, normalized, observedAt);
      const events = diffNewsVersions(previousVersion, normalized);

      await insertChangeEvents(supabase, appid, events, {
        newsItemGid: item.gid,
        triggerCursor: options.triggerCursor,
      });

      projectionRefreshNeeded = projectionRefreshNeeded || events.length > 0;

      if (previousVersion && !version.inserted && events.length === 0) {
        stopPagination = true;
        break;
      }
    }

    if (stopPagination) {
      break;
    }

    const oldestTimestamp = Math.min(...batch.map((item) => item.date));
    if (batch.length < pageSize || !Number.isFinite(oldestTimestamp) || oldestTimestamp <= 1) {
      break;
    }

    endDateUnix = oldestTimestamp - 1;
  }

  if (projectionRefreshNeeded) {
    await enqueueProjectionRefresh(supabase, appid, 'news_change_event');
  }

  await updateSyncStatusFields(supabase, appid, {
    last_news_sync: observedAt,
    last_error_source: null,
    last_error_message: null,
    last_error_at: null,
  });
  return processedCount;
}

export async function archiveHeroAssetsForApp(
  supabase: TypedSupabaseClient,
  appid: number
): Promise<void> {
  const archiver = new HeroAssetArchiver(supabase);
  await archiver.archiveLatestAssetsForApp(appid);
}

export async function seedStaleNewsCatchup(
  supabase: TypedSupabaseClient,
  limit: number
): Promise<number> {
  const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const candidates = await listNewsCatchupCandidates({
    limit,
    staleBeforeIso: staleBefore,
  });

  return enqueueCaptureJobs(
    supabase,
    candidates.map((row: { appid: number }) => ({
      appid: row.appid,
      source: 'news' as const,
      triggerReason: 'stale_news_catchup',
      triggerCursor: null,
      priority: 25,
    }))
  );
}

export async function seedHotNewsRefresh(
  supabase: TypedSupabaseClient,
  limit = getHotNewsRefreshLimit()
): Promise<number> {
  if (limit <= 0) {
    return 0;
  }

  const candidates = await listHotNewsRefreshCandidates({
    limit,
    activeStaleBeforeIso: new Date(Date.now() - getHotNewsActiveStaleWindowMs()).toISOString(),
    moderateStaleBeforeIso: new Date(Date.now() - getHotNewsModerateStaleWindowMs()).toISOString(),
  });

  if (candidates.length === 0) {
    return 0;
  }

  return enqueueCaptureJobs(
    supabase,
    candidates.map((row: { appid: number }) => ({
      appid: row.appid,
      source: 'news' as const,
      triggerReason: 'hot_news_refresh',
      triggerCursor: null,
      priority: 90,
    }))
  );
}

export async function requeueFailedJobs(
  supabase: TypedSupabaseClient,
  jobIds: string[],
  errorMessage: string
): Promise<void> {
  log.warn('Re-queueing failed capture jobs', { jobIds, errorMessage });
  await completeCaptureQueueItems(supabase, jobIds, 'queued', errorMessage);
}
