import type { Pool, PoolClient } from 'pg';

import { logger } from '@publisheriq/shared';

import { classifyVideo, CONTENT_CLASSIFICATION_VERSION, parseIso8601DurationToSeconds } from './classify.js';
import { MATCHER_VERSION } from './matcher.js';
import type {
  DueVideoRefreshRow,
  MatchDecision,
  RoutingRow,
  SnapshotReason,
  YoutubeChannel,
  YoutubeSearchItem,
  YoutubeVideo,
} from './types.js';

const log = logger.child({ package: 'youtube-storage' });
const YOUTUBE_QUOTA_TIME_ZONE = 'America/Los_Angeles';

type Queryable = Pool | PoolClient;

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function toTimestamp(value: string | undefined | null): string | null {
  return value ?? null;
}

function parseCount(value: string | undefined): string {
  if (!value) {
    return '0';
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.max(0, Math.floor(parsed))) : '0';
}

function confidenceScoreFromDecision(decision: MatchDecision): string {
  switch (decision.confidenceBucket) {
    case 'high':
      return '0.95';
    case 'medium':
      return '0.70';
    default:
      return '0.35';
  }
}

function buildAvailabilityState(video: YoutubeVideo): string {
  if (video.snippet?.liveBroadcastContent === 'live') {
    return 'live';
  }

  if (video.liveStreamingDetails?.actualStartTime) {
    return 'vod';
  }

  const privacyStatus = video.status?.privacyStatus;
  if (privacyStatus === 'public' || privacyStatus === 'private' || privacyStatus === 'unlisted') {
    return privacyStatus;
  }

  return 'unknown';
}

async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function chunkArray<T>(values: T[], size: number): T[][];
export function chunkArray<T>(values: T[], size: number): Array<T[]> {
  const chunks: Array<T[]> = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function fetchTodayQuotaUsage(pool: Pool): Promise<number> {
  const result = await pool.query<{ used_units: string }>(
    `
      SELECT COALESCE(sum(quota_units), 0)::bigint AS used_units
      FROM ops.youtube_search_runs
      WHERE (requested_at AT TIME ZONE '${YOUTUBE_QUOTA_TIME_ZONE}')::date
          = (now() AT TIME ZONE '${YOUTUBE_QUOTA_TIME_ZONE}')::date
        AND status = 'succeeded'
    `
  );

  return Number(result.rows[0]?.used_units ?? 0);
}

export async function fetchRoutingRows(pool: Pool, limit: number): Promise<RoutingRow[]> {
  const result = await pool.query<RoutingRow>(
    `
      SELECT
        appid,
        app_name,
        query_template_id,
        discovery_cursor_published_after,
        routing_state,
        allow_second_page
      FROM ops.youtube_game_routing
      WHERE routing_state <> 'suppressed'
        AND next_discovery_at <= now()
      ORDER BY
        CASE routing_state
          WHEN 'escalated' THEN 1
          WHEN 'active_baseline_daily' THEN 2
          WHEN 'active_baseline_rotating' THEN 3
          WHEN 'evergreen_baseline' THEN 4
          ELSE 5
        END,
        next_discovery_at ASC,
        appid ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function fetchAliasesByAppid(
  pool: Pool,
  appids: number[],
  fallbackNames: Map<number, string>
): Promise<Map<number, string[]>> {
  const aliases = new Map<number, string[]>();

  for (const [appid, name] of fallbackNames.entries()) {
    aliases.set(appid, [name]);
  }

  if (appids.length === 0) {
    return aliases;
  }

  try {
    const result = await pool.query<{ appid: string; alias: string }>(
      `
        SELECT
          e.platform_entity_id AS appid,
          a.alias
        FROM core.entities e
        JOIN core.entity_aliases a
          ON a.entity_uid = e.entity_uid
        WHERE e.platform = 'steam'
          AND e.entity_kind = 'game'
          AND e.platform_entity_id = ANY($1::text[])
      `,
      [appids.map(String)]
    );

    for (const row of result.rows) {
      const appid = Number(row.appid);
      const existing = aliases.get(appid) ?? [];
      existing.push(row.alias);
      aliases.set(appid, existing);
    }
  } catch (error) {
    log.warn('Unable to fetch Tiger aliases for YouTube routing; using app names only', { error });
  }

  return aliases;
}

export async function upsertRoutingRows(
  pool: Pool,
  rows: Array<{
    appid: number;
    appName: string;
    routingState: string;
    sourcePriorityScore: number;
    sourceRefreshTier: string | null;
    queryTemplateId: string;
    allowSecondPage: boolean;
  }>
): Promise<void> {
  await withTransaction(pool, async (client) => {
    for (const row of rows) {
      await client.query(
        `
          INSERT INTO ops.youtube_game_routing (
            appid,
            app_name,
            routing_state,
            source_priority_score,
            source_refresh_tier,
            query_template_id,
            allow_second_page,
            next_discovery_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            CASE $3
              WHEN 'escalated' THEN now()
              WHEN 'active_baseline_daily' THEN now()
              WHEN 'active_baseline_rotating' THEN now() + INTERVAL '1 day'
              WHEN 'evergreen_baseline' THEN now() + INTERVAL '3 days'
              ELSE now() + INTERVAL '30 days'
            END,
            now()
          )
          ON CONFLICT (appid) DO UPDATE SET
            app_name = EXCLUDED.app_name,
            routing_state = EXCLUDED.routing_state,
            source_priority_score = EXCLUDED.source_priority_score,
            source_refresh_tier = EXCLUDED.source_refresh_tier,
            query_template_id = EXCLUDED.query_template_id,
            allow_second_page = EXCLUDED.allow_second_page,
            updated_at = now()
        `,
        [
          row.appid,
          row.appName,
          row.routingState,
          row.sourcePriorityScore,
          row.sourceRefreshTier,
          row.queryTemplateId,
          row.allowSecondPage,
        ]
      );
    }
  });
}

export async function createSearchRun(
  queryable: Queryable,
  params: {
    appid: number;
    runKind?: 'search' | 'playlist';
    queryTemplateId: string | null;
    queryText: string;
    publishedAfter: string | null;
    pageNumber: number;
    pageToken: string | null;
  }
): Promise<number> {
  const result = await queryable.query<{ id: string }>(
    `
      INSERT INTO ops.youtube_search_runs (
        appid,
        run_kind,
        query_template_id,
        query_text,
        published_after,
        page_number,
        page_token,
        search_order,
        status,
        started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'date', 'running', now())
      RETURNING id
    `,
    [
      params.appid,
      params.runKind ?? 'search',
      params.queryTemplateId,
      params.queryText,
      params.publishedAfter,
      params.pageNumber,
      params.pageToken,
    ]
  );

  return Number(result.rows[0].id);
}

export async function markSearchRunSucceeded(
  queryable: Queryable,
  params: {
    searchRunId: number;
    resultCount: number;
    responseTotalResults: number | null;
    responseEtag: string | null;
    responseNextPageToken: string | null;
    quotaUnits: number;
  }
): Promise<void> {
  await queryable.query(
    `
      UPDATE ops.youtube_search_runs
      SET
        status = 'succeeded',
        result_count = $2,
        response_total_results = $3,
        response_etag = $4,
        response_next_page_token = $5,
        quota_units = $6,
        completed_at = now(),
        updated_at = now()
      WHERE id = $1
    `,
    [
      params.searchRunId,
      params.resultCount,
      params.responseTotalResults,
      params.responseEtag,
      params.responseNextPageToken,
      params.quotaUnits,
    ]
  );
}

export async function markSearchRunFailed(
  queryable: Queryable,
  params: {
    searchRunId: number;
    errorMessage: string;
  }
): Promise<void> {
  await queryable.query(
    `
      UPDATE ops.youtube_search_runs
      SET
        status = 'failed',
        error_message = $2,
        retry_count = retry_count + 1,
        completed_at = now(),
        updated_at = now()
      WHERE id = $1
    `,
    [params.searchRunId, params.errorMessage.slice(0, 2000)]
  );
}

export async function insertSearchHits(
  queryable: Queryable,
  params: {
    searchRunId: number;
    appid: number;
    queryTemplateId: string | null;
    capturedAt: string;
    items: YoutubeSearchItem[];
  }
): Promise<void> {
  for (const [index, item] of params.items.entries()) {
    const videoId = item.id?.videoId;
    if (!videoId) {
      continue;
    }

    await queryable.query(
      `
        INSERT INTO events.youtube_search_hits (
          captured_at,
          search_run_id,
          appid,
          query_template_id,
          page_number,
          result_rank,
          video_id,
          channel_id,
          channel_title,
          published_at,
          title,
          description,
          live_broadcast_content,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
        )
      `,
      [
        params.capturedAt,
        params.searchRunId,
        params.appid,
        params.queryTemplateId,
        index + 1,
        videoId,
        item.snippet?.channelId ?? null,
        item.snippet?.channelTitle ?? null,
        toTimestamp(item.snippet?.publishedAt),
        item.snippet?.title ?? null,
        item.snippet?.description ?? null,
        item.snippet?.liveBroadcastContent ?? null,
        toJson(item),
      ]
    );
  }
}

export async function upsertVideos(queryable: Queryable, videos: YoutubeVideo[]): Promise<void> {
  for (const video of videos) {
    const contentClass = classifyVideo(video);
    const durationSeconds = parseIso8601DurationToSeconds(video.contentDetails?.duration);

    await queryable.query(
      `
        INSERT INTO docs.youtube_videos (
          video_id,
          channel_id,
          channel_title,
          published_at,
          title,
          description,
          content_class,
          duration_seconds,
          category_id,
          default_language,
          default_audio_language,
          tags,
          definition,
          caption_status,
          topic_categories,
          live_broadcast_content,
          live_scheduled_start_at,
          live_scheduled_end_at,
          live_actual_start_at,
          live_actual_end_at,
          view_count,
          like_count,
          comment_count,
          concurrent_viewers,
          is_live,
          availability_state,
          made_for_kids,
          embeddable,
          public_stats_viewable,
          licensed_content,
          latest_payload_etag,
          first_hydrated_at,
          last_hydrated_at,
          raw_latest_payload,
          last_seen_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14, $15::text[],
          $16, $17, $18, $19, $20, $21::bigint, $22::bigint, $23::bigint, $24::bigint,
          $25, $26, $27, $28, $29, $30, $31, now(), now(), $32::jsonb, now(), now()
        )
        ON CONFLICT (video_id) DO UPDATE SET
          channel_id = EXCLUDED.channel_id,
          channel_title = EXCLUDED.channel_title,
          published_at = EXCLUDED.published_at,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          content_class = EXCLUDED.content_class,
          duration_seconds = EXCLUDED.duration_seconds,
          category_id = EXCLUDED.category_id,
          default_language = EXCLUDED.default_language,
          default_audio_language = EXCLUDED.default_audio_language,
          tags = EXCLUDED.tags,
          definition = EXCLUDED.definition,
          caption_status = EXCLUDED.caption_status,
          topic_categories = EXCLUDED.topic_categories,
          live_broadcast_content = EXCLUDED.live_broadcast_content,
          live_scheduled_start_at = EXCLUDED.live_scheduled_start_at,
          live_scheduled_end_at = EXCLUDED.live_scheduled_end_at,
          live_actual_start_at = EXCLUDED.live_actual_start_at,
          live_actual_end_at = EXCLUDED.live_actual_end_at,
          view_count = EXCLUDED.view_count,
          like_count = EXCLUDED.like_count,
          comment_count = EXCLUDED.comment_count,
          concurrent_viewers = EXCLUDED.concurrent_viewers,
          is_live = EXCLUDED.is_live,
          availability_state = EXCLUDED.availability_state,
          made_for_kids = EXCLUDED.made_for_kids,
          embeddable = EXCLUDED.embeddable,
          public_stats_viewable = EXCLUDED.public_stats_viewable,
          licensed_content = EXCLUDED.licensed_content,
          latest_payload_etag = EXCLUDED.latest_payload_etag,
          last_hydrated_at = now(),
          raw_latest_payload = EXCLUDED.raw_latest_payload,
          last_seen_at = now(),
          updated_at = now()
      `,
      [
        video.id,
        video.snippet?.channelId ?? 'unknown',
        video.snippet?.channelTitle ?? null,
        toTimestamp(video.snippet?.publishedAt),
        video.snippet?.title ?? video.id,
        video.snippet?.description ?? null,
        contentClass,
        durationSeconds,
        video.snippet?.categoryId ?? null,
        video.snippet?.defaultLanguage ?? null,
        video.snippet?.defaultAudioLanguage ?? null,
        video.snippet?.tags ?? [],
        video.contentDetails?.definition ?? null,
        video.contentDetails?.caption ?? null,
        video.topicDetails?.topicCategories ?? [],
        video.snippet?.liveBroadcastContent ?? null,
        toTimestamp(video.liveStreamingDetails?.scheduledStartTime),
        toTimestamp(video.liveStreamingDetails?.scheduledEndTime),
        toTimestamp(video.liveStreamingDetails?.actualStartTime),
        toTimestamp(video.liveStreamingDetails?.actualEndTime),
        parseCount(video.statistics?.viewCount),
        parseCount(video.statistics?.likeCount),
        parseCount(video.statistics?.commentCount),
        video.liveStreamingDetails?.concurrentViewers
          ? parseCount(video.liveStreamingDetails.concurrentViewers)
          : null,
        video.snippet?.liveBroadcastContent === 'live',
        buildAvailabilityState(video),
        video.status?.madeForKids ?? null,
        video.status?.embeddable ?? null,
        video.status?.publicStatsViewable ?? null,
        video.contentDetails?.licensedContent ?? null,
        video.etag ?? null,
        toJson(video),
      ]
    );
  }
}

export async function upsertChannels(queryable: Queryable, channels: YoutubeChannel[]): Promise<void> {
  for (const channel of channels) {
    await queryable.query(
      `
        INSERT INTO docs.youtube_channels (
          channel_id,
          title,
          description,
          custom_url,
          country,
          published_at,
          uploads_playlist_id,
          subscriber_count,
          hidden_subscriber_count,
          view_count,
          video_count,
          first_hydrated_at,
          last_hydrated_at,
          raw_latest_payload,
          last_seen_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::bigint, $9, $10::bigint, $11::bigint,
          now(), now(), $12::jsonb, now(), now()
        )
        ON CONFLICT (channel_id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          custom_url = EXCLUDED.custom_url,
          country = EXCLUDED.country,
          published_at = EXCLUDED.published_at,
          uploads_playlist_id = EXCLUDED.uploads_playlist_id,
          subscriber_count = EXCLUDED.subscriber_count,
          hidden_subscriber_count = EXCLUDED.hidden_subscriber_count,
          view_count = EXCLUDED.view_count,
          video_count = EXCLUDED.video_count,
          last_hydrated_at = now(),
          raw_latest_payload = EXCLUDED.raw_latest_payload,
          last_seen_at = now(),
          updated_at = now()
      `,
      [
        channel.id,
        channel.snippet?.title ?? channel.id,
        channel.snippet?.description ?? null,
        channel.snippet?.customUrl ?? null,
        channel.snippet?.country ?? null,
        toTimestamp(channel.snippet?.publishedAt),
        channel.contentDetails?.relatedPlaylists?.uploads ?? null,
        channel.statistics?.subscriberCount ? parseCount(channel.statistics.subscriberCount) : null,
        channel.statistics?.hiddenSubscriberCount ?? null,
        channel.statistics?.viewCount ? parseCount(channel.statistics.viewCount) : null,
        channel.statistics?.videoCount ? parseCount(channel.statistics.videoCount) : null,
        toJson(channel),
      ]
    );
  }
}

export async function recordMatchDecision(
  queryable: Queryable,
  params: {
    appid: number;
    videoId: string;
    searchRunId: number;
    decision: MatchDecision;
  }
): Promise<void> {
  const decisionSource =
    params.decision.decisionSource === 'manual'
      ? 'manual'
      : params.decision.decisionSource.includes('playlist')
        ? 'playlist'
        : params.decision.decisionSource.includes('override')
          ? 'override'
          : params.decision.decisionSource.includes('alias')
            ? 'alias'
            : 'search';

  await queryable.query(
    `
      INSERT INTO events.youtube_match_decisions (
        decided_at,
        appid,
        video_id,
        search_run_id,
        match_state,
        decision_source,
        confidence_score,
        matched_alias,
        channel_prior_used,
        evidence_summary,
        methodology_version
      ) VALUES (
        now(), $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::jsonb, $10
      )
    `,
    [
      params.appid,
      params.videoId,
      params.searchRunId,
      params.decision.matchState,
      decisionSource,
      confidenceScoreFromDecision(params.decision),
      params.decision.matchedAlias,
      Boolean(params.decision.evidenceSummary.monitoredChannel),
      toJson(params.decision.evidenceSummary),
      MATCHER_VERSION,
    ]
  );
}

export async function upsertVideoMatch(
  queryable: Queryable,
  params: {
    appid: number;
    videoId: string;
    searchRunId: number;
    decision: MatchDecision;
  }
): Promise<void> {
  await queryable.query(
    `
      INSERT INTO docs.youtube_video_matches (
        appid,
        video_id,
        match_state,
        decision_source,
        confidence_score,
        matched_alias,
        channel_prior_used,
        matched_at,
        last_seen_at,
        last_search_run_id,
        last_decision_at,
        evidence_summary,
        methodology_version,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5::numeric, $6, $7, now(), now(), $8, now(), $9::jsonb, $10, now()
      )
      ON CONFLICT (appid, video_id) DO UPDATE SET
        match_state = EXCLUDED.match_state,
        decision_source = EXCLUDED.decision_source,
        confidence_score = EXCLUDED.confidence_score,
        matched_alias = EXCLUDED.matched_alias,
        channel_prior_used = EXCLUDED.channel_prior_used,
        last_seen_at = now(),
        last_search_run_id = EXCLUDED.last_search_run_id,
        last_decision_at = now(),
        evidence_summary = EXCLUDED.evidence_summary,
        methodology_version = EXCLUDED.methodology_version,
        updated_at = now()
    `,
    [
      params.appid,
      params.videoId,
      params.decision.matchState,
      params.decision.decisionSource.includes('playlist') ? 'playlist' : 'search',
      confidenceScoreFromDecision(params.decision),
      params.decision.matchedAlias,
      Boolean(params.decision.evidenceSummary.monitoredChannel),
      params.searchRunId,
      toJson(params.decision.evidenceSummary),
      MATCHER_VERSION,
    ]
  );
}

export async function updateRoutingAfterDiscovery(
  queryable: Queryable,
  params: {
    appid: number;
    routingState: string;
    latestPublishedAt: string | null;
  }
): Promise<void> {
  await queryable.query(
    `
      UPDATE ops.youtube_game_routing
      SET
        discovery_cursor_published_after = COALESCE($2::timestamptz, discovery_cursor_published_after, now()),
        last_search_run_at = now(),
        last_successful_discovery_at = now(),
        next_discovery_at = CASE $3
          WHEN 'escalated' THEN now() + INTERVAL '12 hours'
          WHEN 'active_baseline_daily' THEN now() + INTERVAL '24 hours'
          WHEN 'active_baseline_rotating' THEN now() + INTERVAL '3 days'
          WHEN 'evergreen_baseline' THEN now() + INTERVAL '7 days'
          ELSE now() + INTERVAL '30 days'
        END,
        updated_at = now()
      WHERE appid = $1
    `,
    [params.appid, params.latestPublishedAt, params.routingState]
  );
}

export async function fetchMonitoredChannelIds(pool: Pool, appid: number): Promise<string[]> {
  const result = await pool.query<{ channel_id: string }>(
    `
      SELECT channel_id
      FROM ops.youtube_channel_monitors
      WHERE appid = $1
        AND monitor_state = 'active'
    `,
    [appid]
  );

  return result.rows.map((row) => row.channel_id);
}

export async function refreshChannelMonitorsForGame(
  queryable: Queryable,
  appid: number
): Promise<void> {
  const counts = await queryable.query<{
    channel_id: string;
    channel_title: string | null;
    uploads_playlist_id: string | null;
    match_count_30d: string;
    first_matched_at: string | null;
    last_matched_at: string | null;
  }>(
    `
      SELECT
        v.channel_id,
        MAX(v.channel_title) AS channel_title,
        MAX(c.uploads_playlist_id) AS uploads_playlist_id,
        count(*)::bigint AS match_count_30d,
        MIN(vm.matched_at)::text AS first_matched_at,
        MAX(vm.last_seen_at)::text AS last_matched_at
      FROM docs.youtube_video_matches vm
      JOIN docs.youtube_videos v ON v.video_id = vm.video_id
      LEFT JOIN docs.youtube_channels c ON c.channel_id = v.channel_id
      WHERE vm.appid = $1
        AND vm.match_state = 'matched_primary'
        AND v.published_at >= now() - INTERVAL '30 days'
      GROUP BY v.channel_id
      HAVING count(*) >= 2
    `,
    [appid]
  );

  for (const row of counts.rows) {
    await queryable.query(
      `
        INSERT INTO ops.youtube_channel_monitors (
          appid,
          channel_id,
          channel_title,
          uploads_playlist_id,
          first_matched_at,
          last_matched_at,
          last_seen_video_published_at,
          next_playlist_poll_at,
          match_count_30d,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, now(), now() + INTERVAL '1 day', $7, now()
        )
        ON CONFLICT (appid, channel_id) DO UPDATE SET
          channel_title = EXCLUDED.channel_title,
          uploads_playlist_id = EXCLUDED.uploads_playlist_id,
          first_matched_at = COALESCE(ops.youtube_channel_monitors.first_matched_at, EXCLUDED.first_matched_at),
          last_matched_at = EXCLUDED.last_matched_at,
          last_seen_video_published_at = now(),
          next_playlist_poll_at = now() + INTERVAL '1 day',
          match_count_30d = EXCLUDED.match_count_30d,
          updated_at = now()
      `,
      [
        appid,
        row.channel_id,
        row.channel_title,
        row.uploads_playlist_id,
        row.first_matched_at,
        row.last_matched_at,
        Number(row.match_count_30d),
      ]
    );
  }
}

export async function fetchDueVideoRefreshes(pool: Pool, limit: number): Promise<DueVideoRefreshRow[]> {
  const result = await pool.query<DueVideoRefreshRow>(
    `
      WITH latest_snapshots AS (
        SELECT
          video_id,
          max(snapshot_time) AS last_snapshot_at
        FROM metrics.youtube_video_snapshots
        GROUP BY video_id
      )
      SELECT
        vm.appid,
        vm.video_id,
        v.channel_id,
        v.published_at::text,
        ls.last_snapshot_at::text
      FROM docs.youtube_video_matches vm
      JOIN docs.youtube_videos v
        ON v.video_id = vm.video_id
      LEFT JOIN latest_snapshots ls
        ON ls.video_id = vm.video_id
      WHERE vm.match_state = 'matched_primary'
        AND (
          (v.published_at >= now() - INTERVAL '7 days'
            AND COALESCE(ls.last_snapshot_at, to_timestamp(0)) <= now() - INTERVAL '6 hours')
          OR
          (v.published_at < now() - INTERVAL '7 days'
            AND v.published_at >= now() - INTERVAL '30 days'
            AND COALESCE(ls.last_snapshot_at, to_timestamp(0)) <= now() - INTERVAL '24 hours')
          OR
          (v.published_at < now() - INTERVAL '30 days'
            AND v.published_at >= now() - INTERVAL '90 days'
            AND COALESCE(ls.last_snapshot_at, to_timestamp(0)) <= now() - INTERVAL '72 hours')
        )
      ORDER BY COALESCE(ls.last_snapshot_at, to_timestamp(0)) ASC, v.published_at DESC NULLS LAST
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function insertSnapshots(
  queryable: Queryable,
  params: Array<{
    appid: number;
    video: YoutubeVideo;
    snapshotReason: SnapshotReason;
  }>
): Promise<void> {
  for (const entry of params) {
    const contentClass = classifyVideo(entry.video);
    await queryable.query(
      `
        INSERT INTO metrics.youtube_video_snapshots (
          snapshot_time,
          video_id,
          appid,
          content_class,
          view_count,
          like_count,
          comment_count,
          concurrent_viewers,
          is_live,
          availability_state,
          snapshot_reason
        ) VALUES (
          now(), $1, $2, $3, $4::bigint, $5::bigint, $6::bigint, $7::bigint, $8, $9, $10
        )
      `,
      [
        entry.video.id,
        entry.appid,
        contentClass,
        parseCount(entry.video.statistics?.viewCount),
        parseCount(entry.video.statistics?.likeCount),
        parseCount(entry.video.statistics?.commentCount),
        entry.video.liveStreamingDetails?.concurrentViewers
          ? parseCount(entry.video.liveStreamingDetails.concurrentViewers)
          : null,
        entry.video.snippet?.liveBroadcastContent === 'live',
        buildAvailabilityState(entry.video),
        entry.snapshotReason,
      ]
    );
  }
}

export async function rebuildDailyRollups(pool: Pool, lookbackDays: number): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `
        DELETE FROM metrics.youtube_game_daily
        WHERE metric_date >= current_date - ($1::int - 1)
      `,
      [lookbackDays]
    );

    await client.query(
      `
        WITH days AS (
          SELECT generate_series(
            current_date - ($1::int - 1),
            current_date,
            INTERVAL '1 day'
          )::date AS metric_date
        ),
        matched AS (
          SELECT
            vm.appid,
            vm.video_id,
            vm.match_state,
            v.channel_id,
            v.content_class,
            v.published_at::date AS published_date,
            COALESCE(v.view_count, 0) AS latest_view_count
          FROM docs.youtube_video_matches vm
          JOIN docs.youtube_videos v
            ON v.video_id = vm.video_id
          WHERE vm.match_state IN ('matched_primary', 'matched_secondary')
            AND v.published_at IS NOT NULL
        ),
        app_days AS (
          SELECT DISTINCT
            d.metric_date,
            m.appid,
            m.content_class
          FROM days d
          JOIN matched m
            ON m.published_date <= d.metric_date
        ),
        discovered AS (
          SELECT
            e.captured_at::date AS metric_date,
            e.appid,
            COALESCE(v.content_class, 'standard_video') AS content_class,
            count(DISTINCT e.video_id)::int AS discovered_video_count
          FROM events.youtube_search_hits e
          LEFT JOIN docs.youtube_videos v
            ON v.video_id = e.video_id
          WHERE e.captured_at >= current_date - ($1::int - 1)
          GROUP BY 1, 2, 3
        ),
        monitor_counts AS (
          SELECT
            appid,
            count(*)::int AS monitored_channel_count
          FROM ops.youtube_channel_monitors
          WHERE monitor_state = 'active'
          GROUP BY appid
        ),
        snapshot_counts AS (
          SELECT
            s.appid,
            s.content_class,
            max(s.snapshot_time) AS latest_snapshot_at,
            count(*)::int AS total_snapshot_count
          FROM metrics.youtube_video_snapshots s
          WHERE s.snapshot_time >= current_date - ($1::int - 1)
          GROUP BY 1, 2
        )
        INSERT INTO metrics.youtube_game_daily (
          metric_date,
          appid,
          content_class,
          coverage_state,
          matched_primary_video_count,
          matched_secondary_video_count,
          monitored_channel_count,
          discovered_video_count,
          new_matched_videos_1d,
          new_matched_videos_7d,
          new_matched_videos_30d,
          distinct_upload_channels_7d,
          distinct_upload_channels_30d,
          views_on_new_videos_7d,
          views_on_new_videos_30d,
          matched_video_view_delta_1d,
          matched_video_view_delta_7d,
          total_snapshot_count,
          latest_snapshot_at,
          rollup_methodology_version,
          created_at,
          updated_at
        )
        SELECT
          ad.metric_date,
          ad.appid,
          ad.content_class,
          'partial' AS coverage_state,
          count(*) FILTER (WHERE m.match_state = 'matched_primary')::int AS matched_primary_video_count,
          count(*) FILTER (WHERE m.match_state = 'matched_secondary')::int AS matched_secondary_video_count,
          COALESCE(mc.monitored_channel_count, 0) AS monitored_channel_count,
          COALESCE(dv.discovered_video_count, 0) AS discovered_video_count,
          count(*) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date = ad.metric_date
          )::int AS new_matched_videos_1d,
          count(*) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 6 AND ad.metric_date
          )::int AS new_matched_videos_7d,
          count(*) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 29 AND ad.metric_date
          )::int AS new_matched_videos_30d,
          count(DISTINCT m.channel_id) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 6 AND ad.metric_date
          )::int AS distinct_upload_channels_7d,
          count(DISTINCT m.channel_id) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 29 AND ad.metric_date
          )::int AS distinct_upload_channels_30d,
          COALESCE(sum(m.latest_view_count) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 6 AND ad.metric_date
          ), 0)::bigint AS views_on_new_videos_7d,
          COALESCE(sum(m.latest_view_count) FILTER (
            WHERE m.match_state = 'matched_primary'
              AND m.published_date BETWEEN ad.metric_date - 29 AND ad.metric_date
          ), 0)::bigint AS views_on_new_videos_30d,
          COALESCE(sum(
            CASE
              WHEN m.match_state <> 'matched_primary' THEN 0
              ELSE GREATEST(
                COALESCE((
                  SELECT s_end.view_count
                  FROM metrics.youtube_video_snapshots s_end
                  WHERE s_end.video_id = m.video_id
                    AND s_end.snapshot_time < ad.metric_date + INTERVAL '1 day'
                  ORDER BY s_end.snapshot_time DESC
                  LIMIT 1
                ), 0) - COALESCE((
                  SELECT s_start.view_count
                  FROM metrics.youtube_video_snapshots s_start
                  WHERE s_start.video_id = m.video_id
                    AND s_start.snapshot_time < ad.metric_date
                  ORDER BY s_start.snapshot_time DESC
                  LIMIT 1
                ), 0),
                0
              )
            END
          ), 0)::bigint AS matched_video_view_delta_1d,
          COALESCE(sum(
            CASE
              WHEN m.match_state <> 'matched_primary' THEN 0
              ELSE GREATEST(
                COALESCE((
                  SELECT s_end.view_count
                  FROM metrics.youtube_video_snapshots s_end
                  WHERE s_end.video_id = m.video_id
                    AND s_end.snapshot_time < ad.metric_date + INTERVAL '1 day'
                  ORDER BY s_end.snapshot_time DESC
                  LIMIT 1
                ), 0) - COALESCE((
                  SELECT s_start.view_count
                  FROM metrics.youtube_video_snapshots s_start
                  WHERE s_start.video_id = m.video_id
                    AND s_start.snapshot_time < ad.metric_date - INTERVAL '6 days'
                  ORDER BY s_start.snapshot_time DESC
                  LIMIT 1
                ), 0),
                0
              )
            END
          ), 0)::bigint AS matched_video_view_delta_7d,
          COALESCE(sc.total_snapshot_count, 0) AS total_snapshot_count,
          sc.latest_snapshot_at,
          $2 AS rollup_methodology_version,
          now(),
          now()
        FROM app_days ad
        JOIN matched m
          ON m.appid = ad.appid
         AND m.content_class = ad.content_class
         AND m.published_date <= ad.metric_date
        LEFT JOIN discovered dv
          ON dv.metric_date = ad.metric_date
         AND dv.appid = ad.appid
         AND dv.content_class = ad.content_class
        LEFT JOIN monitor_counts mc
          ON mc.appid = ad.appid
        LEFT JOIN snapshot_counts sc
          ON sc.appid = ad.appid
         AND sc.content_class = ad.content_class
        GROUP BY
          ad.metric_date,
          ad.appid,
          ad.content_class,
          mc.monitored_channel_count,
          dv.discovered_video_count,
          sc.total_snapshot_count,
          sc.latest_snapshot_at
      `,
      [lookbackDays, CONTENT_CLASSIFICATION_VERSION]
    );
  });
}

async function copyRowsInBatches(
  targetPool: Pool,
  tableName: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  batchSize: number
): Promise<void> {
  for (const batch of chunkArray(rows, batchSize)) {
    await withTransaction(targetPool, async (client) => {
      for (const row of batch) {
        const values = columns.map((column) => row[column] ?? null);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          values
        );
      }
    });
  }
}

export async function mirrorYoutubeTables(
  sourcePool: Pool,
  targetPool: Pool,
  params: {
    lookbackDays: number;
    batchSize: number;
  }
): Promise<void> {
  const fullTables = [
    'docs.youtube_channels',
    'docs.youtube_videos',
    'docs.youtube_video_matches',
  ];
  const windowedTables = [
    { table: 'events.youtube_search_hits', timeColumn: 'captured_at' },
    { table: 'events.youtube_match_decisions', timeColumn: 'decided_at' },
    { table: 'metrics.youtube_video_snapshots', timeColumn: 'snapshot_time' },
    { table: 'metrics.youtube_game_daily', timeColumn: 'metric_date' },
  ];

  for (const table of fullTables) {
    const rows = await sourcePool.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    const columns = rows.fields.map((field) => field.name);
    await targetPool.query(`DELETE FROM ${table}`);
    await copyRowsInBatches(targetPool, table, columns, rows.rows, params.batchSize);
  }

  for (const { table, timeColumn } of windowedTables) {
    const rows = await sourcePool.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE ${timeColumn} >= current_date - ($1::int - 1)`,
      [params.lookbackDays]
    );
    const columns = rows.fields.map((field) => field.name);
    await targetPool.query(
      `DELETE FROM ${table} WHERE ${timeColumn} >= current_date - ($1::int - 1)`,
      [params.lookbackDays]
    );
    await copyRowsInBatches(targetPool, table, columns, rows.rows, params.batchSize);
  }
}
