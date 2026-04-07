import type { Pool } from 'pg';

import { logger } from '@publisheriq/shared';

import { buildRoutingPlan, fetchRoutedGameCandidates } from './cohort.js';
import { closePools, createPgPool } from './db.js';
import {
  type YoutubeCollectorConfig,
  requireYoutubeApiKey,
} from './config.js';
import { matchVideoToGame } from './matcher.js';
import {
  chunkArray,
  createSearchRun,
  fetchAliasesByAppid,
  fetchDueVideoRefreshes,
  fetchMonitoredChannelIds,
  fetchRoutingRows,
  fetchTodayQuotaUsage,
  insertSearchHits,
  insertSnapshots,
  markSearchRunFailed,
  markSearchRunSucceeded,
  mirrorYoutubeTables,
  rebuildDailyRollups,
  recordMatchDecision,
  refreshChannelMonitorsForGame,
  updateRoutingAfterDiscovery,
  upsertChannels,
  upsertRoutingRows,
  upsertVideoMatch,
  upsertVideos,
} from './storage.js';
import type { SnapshotReason, YoutubeChannel, YoutubeVideo } from './types.js';
import { YoutubeApiClient } from './youtube-api.js';

const log = logger.child({ package: 'youtube-jobs' });

function requireWriteTarget(config: YoutubeCollectorConfig): void {
  if (!config.writeTarget) {
    throw new Error('Missing YOUTUBE_WRITE_TARGET. Set it to preview or production.');
  }
}

function createTargetPool(config: YoutubeCollectorConfig): Pool {
  return createPgPool({
    applicationName: `publisheriq-youtube-${config.writeTarget ?? 'unknown'}`,
    connectionString: config.targetConnectionString,
    statementTimeoutMs: config.statementTimeoutMs,
  });
}

function createSourcePool(config: YoutubeCollectorConfig): Pool {
  if (!config.sourceConnectionString) {
    throw new Error('Missing DATABASE_URL or YOUTUBE_SOURCE_DATABASE_URL.');
  }

  return createPgPool({
    applicationName: 'publisheriq-youtube-source',
    connectionString: config.sourceConnectionString,
    statementTimeoutMs: config.statementTimeoutMs,
  });
}

function buildSearchQuery(appName: string): string {
  const escaped = appName.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function computePublishedAfter(
  cursor: Date | string | null,
  lookbackDays: number
): string {
  const now = new Date();
  const cursorDate = cursor ? new Date(cursor) : null;
  const start = cursorDate
    ? new Date(cursorDate.getTime() - 6 * 60 * 60 * 1000)
    : new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export async function runSeedRouting(config: YoutubeCollectorConfig): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  const sourcePool = createSourcePool(config);

  try {
    const candidates = await fetchRoutedGameCandidates(sourcePool, targetPool, {
      cohortSize: config.routingCohortSize,
      allowlistAppids: config.allowlistAppids,
    });
    const plan = await buildRoutingPlan(targetPool, candidates, config.routingCohortSize);
    await upsertRoutingRows(targetPool, plan);

    log.info('Seeded YouTube routing cohort', {
      target: config.writeTarget,
      routedGames: plan.length,
    });
  } finally {
    await closePools([targetPool, sourcePool]);
  }
}

async function hydrateChannelsForVideos(
  api: YoutubeApiClient,
  videos: YoutubeVideo[]
): Promise<Map<string, YoutubeChannel>> {
  const channelIds = [...new Set(videos.map((video) => video.snippet?.channelId).filter(Boolean) as string[])];
  const channelMap = new Map<string, YoutubeChannel>();

  for (const chunk of chunkArray(channelIds, 50)) {
    const response = await api.listChannels(chunk);
    for (const channel of response.items ?? []) {
      channelMap.set(channel.id, channel);
    }
  }

  return channelMap;
}

async function runDiscoveryForRoutingRows(
  config: YoutubeCollectorConfig,
  params: {
    rows: Awaited<ReturnType<typeof fetchRoutingRows>>;
    lookbackDays: number;
    snapshotReason: SnapshotReason;
  }
): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  const api = new YoutubeApiClient(requireYoutubeApiKey(config));

  try {
    const usedQuota = await fetchTodayQuotaUsage(targetPool);
    let quotaSpentThisRun = 0;
    const fallbackNames = new Map(params.rows.map((row) => [row.appid, row.app_name]));
    const aliasesByAppid = await fetchAliasesByAppid(
      targetPool,
      params.rows.map((row) => row.appid),
      fallbackNames
    );

    for (const row of params.rows) {
      const remainingDiscoveryBudget = Math.min(
        config.discoveryBudget,
        config.dailyQuotaBudget - config.quotaReserve
      ) - usedQuota - quotaSpentThisRun;

      if (remainingDiscoveryBudget < 100) {
        log.warn('Stopping discovery to preserve YouTube quota reserve', {
          usedQuota,
          quotaSpentThisRun,
          dailyBudget: config.dailyQuotaBudget,
          quotaReserve: config.quotaReserve,
        });
        break;
      }

      const publishedAfter = computePublishedAfter(
        row.discovery_cursor_published_after,
        params.lookbackDays
      );
      const queryText = buildSearchQuery(row.app_name);
      const searchRunId = await createSearchRun(targetPool, {
        appid: row.appid,
        queryTemplateId: row.query_template_id,
        queryText,
        publishedAfter,
        pageNumber: 1,
        pageToken: null,
      });

      try {
        const searchResponse = await api.searchVideos({
          query: queryText,
          publishedAfter,
          maxResults: 50,
        });

        const items = searchResponse.items ?? [];
        const videoIds = [...new Set(items.map((item) => item.id?.videoId).filter(Boolean) as string[])];
        const videos: YoutubeVideo[] = [];

        for (const chunk of chunkArray(videoIds, 50)) {
          const response = await api.listVideos(chunk);
          videos.push(...(response.items ?? []));
        }

        const videoMap = new Map(videos.map((video) => [video.id, video]));
        const monitoredChannelIds = await fetchMonitoredChannelIds(targetPool, row.appid);
        const channels = await hydrateChannelsForVideos(api, videos);
        const aliases = aliasesByAppid.get(row.appid) ?? [row.app_name];

        await insertSearchHits(targetPool, {
          searchRunId,
          appid: row.appid,
          queryTemplateId: row.query_template_id,
          capturedAt: new Date().toISOString(),
          items,
        });
        await upsertVideos(targetPool, videos);
        await upsertChannels(targetPool, [...channels.values()]);

        const matchedVideosForSnapshots: YoutubeVideo[] = [];
        for (const videoId of videoIds) {
          const video = videoMap.get(videoId);
          if (!video) {
            continue;
          }

          const decision = matchVideoToGame({
            title: video.snippet?.title,
            description: video.snippet?.description,
            aliases,
            monitoredChannelIds,
            channelId: video.snippet?.channelId,
          });

          await recordMatchDecision(targetPool, {
            appid: row.appid,
            videoId,
            searchRunId,
            decision,
          });
          await upsertVideoMatch(targetPool, {
            appid: row.appid,
            videoId,
            searchRunId,
            decision,
          });

          if (decision.matchState === 'matched_primary') {
            matchedVideosForSnapshots.push(video);
          }
        }

        if (matchedVideosForSnapshots.length > 0) {
          await insertSnapshots(
            targetPool,
            matchedVideosForSnapshots.map((video) => ({
              appid: row.appid,
              video,
              snapshotReason: params.snapshotReason,
            }))
          );
        }

        const latestPublishedAt = items
          .map((item) => item.snippet?.publishedAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null;

        await updateRoutingAfterDiscovery(targetPool, {
          appid: row.appid,
          routingState: row.routing_state,
          latestPublishedAt,
        });
        await refreshChannelMonitorsForGame(targetPool, row.appid);
        await markSearchRunSucceeded(targetPool, {
          searchRunId,
          resultCount: items.length,
          responseTotalResults: searchResponse.pageInfo?.totalResults ?? null,
          responseEtag: searchResponse.etag ?? null,
          responseNextPageToken: searchResponse.nextPageToken ?? null,
          quotaUnits: 100 + Math.ceil(videoIds.length / 50) + Math.ceil(channels.size / 50),
        });

        quotaSpentThisRun += 100 + Math.ceil(videoIds.length / 50) + Math.ceil(channels.size / 50);
      } catch (error) {
        await markSearchRunFailed(targetPool, {
          searchRunId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        log.error('YouTube discovery run failed', {
          appid: row.appid,
          error,
        });
      }
    }
  } finally {
    await closePools([targetPool]);
  }
}

export async function runDiscoverySync(config: YoutubeCollectorConfig): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  try {
    const rows = await fetchRoutingRows(targetPool, config.maxSearchCallsPerRun);
    await runDiscoveryForRoutingRows(config, {
      rows,
      lookbackDays: config.bootstrapLookbackDays,
      snapshotReason: 'discovery',
    });
  } finally {
    await closePools([targetPool]);
  }
}

export async function runBootstrapBackfill(config: YoutubeCollectorConfig): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  try {
    await targetPool.query(
      `
        UPDATE ops.youtube_game_routing
        SET next_discovery_at = now(), updated_at = now()
        WHERE routing_state <> 'suppressed'
      `
    );
    const rows = await fetchRoutingRows(targetPool, config.maxSearchCallsPerRun);
    await runDiscoveryForRoutingRows(config, {
      rows,
      lookbackDays: config.bootstrapLookbackDays,
      snapshotReason: 'bootstrap_refresh',
    });
  } finally {
    await closePools([targetPool]);
  }
}

export async function runRefreshSync(
  config: YoutubeCollectorConfig,
  snapshotReason: SnapshotReason = 'scheduled_refresh'
): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  const api = new YoutubeApiClient(requireYoutubeApiKey(config));

  try {
    const dueRows = await fetchDueVideoRefreshes(targetPool, config.maxVideoRefreshesPerRun);
    const appidsByVideo = new Map<string, number[]>();

    for (const row of dueRows) {
      const existing = appidsByVideo.get(row.video_id) ?? [];
      existing.push(row.appid);
      appidsByVideo.set(row.video_id, existing);
    }

    for (const chunk of chunkArray([...appidsByVideo.keys()], 50)) {
      const response = await api.listVideos(chunk);
      const videos = response.items ?? [];
      await upsertVideos(targetPool, videos);
      await insertSnapshots(
        targetPool,
        videos.flatMap((video) =>
          (appidsByVideo.get(video.id) ?? []).map((appid) => ({
            appid,
            video,
            snapshotReason,
          }))
        )
      );
    }

    log.info('Refreshed matched YouTube videos', {
      refreshedVideos: dueRows.length,
      target: config.writeTarget,
    });
  } finally {
    await closePools([targetPool]);
  }
}

export async function runDailyRollup(config: YoutubeCollectorConfig): Promise<void> {
  requireWriteTarget(config);

  const targetPool = createTargetPool(config);
  try {
    await rebuildDailyRollups(targetPool, config.rollupLookbackDays);
    log.info('Rebuilt YouTube daily rollups', {
      lookbackDays: config.rollupLookbackDays,
      target: config.writeTarget,
    });
  } finally {
    await closePools([targetPool]);
  }
}

export async function runPreviewMirror(config: YoutubeCollectorConfig): Promise<void> {
  if (config.writeTarget !== 'preview') {
    throw new Error('Preview mirror requires YOUTUBE_WRITE_TARGET=preview.');
  }

  if (!config.mirrorSourceConnectionString) {
    throw new Error('Missing YOUTUBE_MIRROR_SOURCE_URL or DATA_PLANE_SOURCE_URL.');
  }

  const targetPool = createTargetPool(config);
  const sourcePool = createPgPool({
    applicationName: 'publisheriq-youtube-mirror-source',
    connectionString: config.mirrorSourceConnectionString,
    statementTimeoutMs: config.statementTimeoutMs,
  });

  try {
    await mirrorYoutubeTables(sourcePool, targetPool, {
      lookbackDays: config.bootstrapLookbackDays,
      batchSize: config.mirrorBatchSize,
    });
    log.info('Mirrored YouTube data into preview Tiger', {
      lookbackDays: config.bootstrapLookbackDays,
    });
  } finally {
    await closePools([targetPool, sourcePool]);
  }
}
