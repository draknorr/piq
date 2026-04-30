import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';

import { archiveJsonPayload, createChangeIntelArchiveStore } from './archive-store.js';
import { hashNormalizedContent } from './hashing.js';
import { stringifyJsonValue } from './json-sanitize.js';
import { readChangeIntelRuntimeConfig } from './runtime-config.js';
import {
  toComparableMediaVersion,
  toComparableStorefrontSnapshot,
} from './storefront.js';
import type {
  AppCaptureSource,
  AppChangeEventDraft,
  CaptureQueueJob,
  HeroAssetKind,
  NormalizedMediaVersion,
  NormalizedNewsVersion,
  NormalizedStorefrontSnapshot,
  VersionWriteResult,
} from './types.js';

const DEFAULT_POOL_MAX = 5;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const NEWS_CONTENTS_EXCERPT_LENGTH = 4_000;

interface ArchiveColumns {
  archive_bucket: string | null;
  archive_key: string | null;
}

interface SnapshotMetaRow extends ArchiveColumns, QueryResultRow {
  content_hash: string;
  id: number | string;
}

interface MediaVersionRow extends QueryResultRow {
  content_hash: string;
  hero_assets: Record<string, unknown>;
  id: number | string;
  screenshots: Array<Record<string, unknown>>;
  trailers: Array<Record<string, unknown>>;
}

interface NewsVersionRow extends ArchiveColumns, QueryResultRow {
  content_hash: string;
  contents_excerpt: string | null;
  id: number | string;
  title: string | null;
  url: string;
}

interface ClaimCaptureQueueRow extends QueryResultRow {
  appid: number;
  attempts: number | string;
  id: number | string;
  payload: Record<string, unknown> | null;
  source: AppCaptureSource;
  trigger_cursor: string | null;
  trigger_reason: string;
}

interface CountRow extends QueryResultRow {
  count: number | string;
}

interface IdRow extends QueryResultRow {
  id: number | string;
}

export interface TigerHintStatusRow {
  appid: number;
  is_released: boolean | null;
  priority_score: number | null;
  release_date: string | null;
  steam_last_modified: number | null;
  steam_price_change_number: number | null;
  type: string | null;
}

export interface TigerReviewPromotion {
  appid: number;
  bucket: string;
  reason: string;
  score: number;
  until: string;
}

interface HintStatusQueryRow extends QueryResultRow {
  appid: number;
  is_released: boolean | null;
  priority_score: number | string | null;
  release_date: Date | string | null;
  steam_last_modified: number | string | null;
  steam_price_change_number: number | string | null;
  type: string | null;
}

interface HeroAssetVersionParams {
  appid: number;
  assetKind: HeroAssetKind;
  contentHash: string;
  contentLength: number;
  firstSeenAt?: string;
  height: number | null;
  id?: string;
  lastSeenAt?: string;
  mimeType: string | null;
  objectBucket: string;
  objectKey: string;
  sourceUrl: string;
  width: number | null;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireTigerConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const config = readChangeIntelRuntimeConfig(env);
  if (!config.tigerDatabaseUrl) {
    throw new Error('Missing CHANGE_INTEL_TIGER_URL or TIGER_PRIMARY_URL.');
  }

  return config.tigerDatabaseUrl;
}

function parseCount(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord<T>(value: Record<string, unknown>): T {
  return value as unknown as T;
}

function asRecords<T>(value: Array<Record<string, unknown>>): T {
  return value as unknown as T;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncateText(value: string | null | undefined, length: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > length ? value.slice(0, length) : value;
}

function summarizeStorefrontSnapshot(snapshot: NormalizedStorefrontSnapshot): Record<string, unknown> {
  return {
    comingSoon: snapshot.comingSoon,
    isDelisted: snapshot.isDelisted,
    isFree: snapshot.isFree,
    name: snapshot.name,
    price: snapshot.price,
    releaseDate: snapshot.releaseDate,
    releaseDateText: snapshot.releaseDateText,
    type: snapshot.type,
    counts: {
      categories: snapshot.categories.length,
      developers: snapshot.developers.length,
      dlcAppids: snapshot.dlcAppids.length,
      genres: snapshot.genres.length,
      movies: snapshot.movies.length,
      packageGroupSubs: snapshot.packageGroupSubs.length,
      packageIds: snapshot.packageIds.length,
      publishers: snapshot.publishers.length,
      screenshots: snapshot.screenshots.length,
    },
  };
}

function archiveTimestamp(pointer: { key: string } | null): string | null {
  return pointer ? new Date().toISOString() : null;
}

function requireArchivePointer<T extends { key: string } | null>(
  pointer: T,
  label: string
): Exclude<T, null> {
  if (!pointer) {
    throw new Error(
      `CHANGE_INTEL_ARCHIVE_TARGET=object_storage is required to write ${label} to Tiger.`
    );
  }

  return pointer as Exclude<T, null>;
}

async function readArchivedJson<T>(
  row: ArchiveColumns,
  label: string
): Promise<T> {
  if (!row.archive_bucket || !row.archive_key) {
    throw new Error(`${label} does not have an archive pointer in Tiger.`);
  }

  const store = createChangeIntelArchiveStore();
  if (!store) {
    throw new Error(
      `CHANGE_INTEL_ARCHIVE_TARGET=object_storage is required to read ${label} from Tiger.`
    );
  }

  const body = await store.read({
    bucket: row.archive_bucket,
    key: row.archive_key,
  });

  return JSON.parse(body.toString('utf8')) as T;
}

const STATUS_FIELD_COLUMNS = new Map<string, string>([
  ['last_error_at', 'last_error_at'],
  ['last_error_message', 'last_error_message'],
  ['last_error_source', 'last_error_source'],
  ['last_media_sync', 'last_media_sync'],
  ['last_news_sync', 'last_news_sync'],
  ['last_storefront_sync', 'last_storefront_sync'],
  ['steam_last_modified', 'steam_last_modified'],
  ['steam_price_change_number', 'steam_price_change_number'],
  ['storefront_accessible', 'storefront_accessible'],
]);

const SYNC_JOB_FIELD_COLUMNS = new Map<string, string>([
  ['batch_size', 'batch_size'],
  ['completed_at', 'completed_at'],
  ['error_message', 'error_message'],
  ['items_created', 'items_created'],
  ['items_failed', 'items_failed'],
  ['items_processed', 'items_processed'],
  ['items_skipped', 'items_skipped'],
  ['items_succeeded', 'items_succeeded'],
  ['items_updated', 'items_updated'],
  ['status', 'status'],
]);

export class TigerChangeIntelRepository {
  constructor(private readonly pool: Pool) {}

  async listHintStatusRows(appids: number[]): Promise<TigerHintStatusRow[]> {
    const uniqueAppids = Array.from(new Set(appids.filter(Number.isFinite))).sort((left, right) => left - right);
    if (uniqueAppids.length === 0) {
      return [];
    }

    const { rows } = await this.pool.query<HintStatusQueryRow>(
      `
        SELECT
          a.appid,
          a.type,
          a.is_released,
          a.release_date,
          s.steam_last_modified,
          s.steam_price_change_number,
          s.priority_score
        FROM legacy.apps a
        LEFT JOIN ops.sync_status s ON s.appid = a.appid
        WHERE a.appid = ANY($1::integer[])
      `,
      [uniqueAppids]
    );

    return rows.map((row) => ({
      appid: Number(row.appid),
      is_released: row.is_released,
      priority_score: toNullableNumber(row.priority_score),
      release_date: row.release_date instanceof Date ? row.release_date.toISOString().slice(0, 10) : row.release_date,
      steam_last_modified: toNullableNumber(row.steam_last_modified),
      steam_price_change_number: toNullableNumber(row.steam_price_change_number),
      type: row.type,
    }));
  }

  async upsertHintStatusRows(
    rows: Array<{
      appid: number;
      steamLastModified: number;
      steamPriceChangeNumber: number;
    }>
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.pool.query(
      `
        INSERT INTO ops.sync_status (
          appid,
          steam_last_modified,
          steam_price_change_number,
          updated_at
        )
        SELECT
          appid,
          steam_last_modified,
          steam_price_change_number,
          now()
        FROM jsonb_to_recordset($1::jsonb) AS hint_rows (
          appid integer,
          steam_last_modified bigint,
          steam_price_change_number bigint
        )
        ON CONFLICT (appid)
        DO UPDATE SET
          steam_last_modified = EXCLUDED.steam_last_modified,
          steam_price_change_number = EXCLUDED.steam_price_change_number,
          updated_at = now()
      `,
      [
        JSON.stringify(
          rows.map((row) => ({
            appid: row.appid,
            steam_last_modified: row.steamLastModified,
            steam_price_change_number: row.steamPriceChangeNumber,
          }))
        ),
      ]
    );
  }

  async promoteReviewsSyncBatch(promotions: TigerReviewPromotion[]): Promise<number> {
    if (promotions.length === 0) {
      return 0;
    }

    await this.pool.query(
      `
        SELECT ops.promote_reviews_sync(
          appid,
          bucket,
          score,
          reason,
          until_at
        )
        FROM jsonb_to_recordset($1::jsonb) AS promotion_rows (
          appid integer,
          bucket text,
          score integer,
          reason text,
          until_at timestamptz
        )
      `,
      [
        JSON.stringify(
          promotions.map((promotion) => ({
            appid: promotion.appid,
            bucket: promotion.bucket,
            reason: promotion.reason,
            score: promotion.score,
            until_at: promotion.until,
          }))
        ),
      ]
    );

    return promotions.length;
  }

  async getLatestStorefrontSnapshot(appid: number): Promise<NormalizedStorefrontSnapshot | null> {
    const row = await this.getLatestStorefrontSnapshotMeta(appid);
    return row ? readArchivedJson<NormalizedStorefrontSnapshot>(row, 'storefront snapshot') : null;
  }

  async getLatestMediaVersion(appid: number): Promise<NormalizedMediaVersion | null> {
    const row = await this.getLatestMediaVersionRow(appid);
    if (!row) {
      return null;
    }

    return {
      heroImages: asRecord<NormalizedMediaVersion['heroImages']>(row.hero_assets),
      screenshots: asRecords<NormalizedMediaVersion['screenshots']>(row.screenshots),
      movies: asRecords<NormalizedMediaVersion['movies']>(row.trailers),
    };
  }

  async getLatestNewsVersion(gid: string): Promise<NormalizedNewsVersion | null> {
    const row = await this.getLatestNewsVersionRow(gid);
    if (!row) {
      return null;
    }

    if (row.archive_bucket && row.archive_key) {
      return readArchivedJson<NormalizedNewsVersion>(row, 'news version');
    }

    return {
      author: null,
      contents: row.contents_excerpt,
      feedlabel: null,
      feedname: null,
      gid,
      publishedAt: new Date(0).toISOString(),
      title: row.title ?? '',
      url: row.url,
    };
  }

  async writeStorefrontSnapshot(
    appid: number,
    snapshot: NormalizedStorefrontSnapshot,
    triggerReason: string,
    triggerCursor: string | null,
    observedAt = new Date().toISOString(),
    options: { idOverride?: string | null; previousIdOverride?: string | null } = {}
  ): Promise<VersionWriteResult> {
    const previousSnapshot = await this.getLatestStorefrontSnapshotMeta(appid);
    const contentHash = hashNormalizedContent(toComparableStorefrontSnapshot(snapshot));

    if (previousSnapshot && previousSnapshot.content_hash === contentHash) {
      await this.pool.query(
        `
          UPDATE docs.app_source_snapshots
          SET last_seen_at = $2::timestamptz,
              observed_at = $2::timestamptz
          WHERE id = $1::bigint
        `,
        [previousSnapshot.id, observedAt]
      );

      return {
        inserted: false,
        currentHash: contentHash,
        currentId: String(previousSnapshot.id),
        previousId: String(previousSnapshot.id),
      };
    }

    const pointer = requireArchivePointer(await archiveJsonPayload({
      kind: 'app-source-snapshot',
      keyParts: [String(appid), 'storefront', contentHash],
      payload: snapshot,
    }), 'storefront snapshots');
    const idOverride = toNullableNumber(options.idOverride);
    const previousId = previousSnapshot?.id ?? options.previousIdOverride ?? null;
    const params = [
      appid,
      'storefront',
      observedAt,
      contentHash,
      previousId,
      triggerReason,
      triggerCursor,
      stringifyJsonValue(summarizeStorefrontSnapshot(snapshot)),
      pointer?.bucket ?? null,
      pointer?.key ?? null,
      pointer?.contentHash ?? null,
      pointer?.byteSize ?? null,
      pointer?.contentType ?? null,
      archiveTimestamp(pointer),
    ];
    const insertPrefix = idOverride ? 'id, ' : '';
    const valuesPrefix = idOverride ? '$15::bigint, ' : '';
    const insertParams = idOverride ? [...params, idOverride] : params;

    const { rows } = await this.pool.query<IdRow>(
      `
        INSERT INTO docs.app_source_snapshots (
          ${insertPrefix}appid, source, observed_at, first_seen_at, last_seen_at,
          content_hash, previous_snapshot_id, trigger_reason, trigger_cursor,
          snapshot_summary, archive_bucket, archive_key, archive_content_hash,
          archive_byte_size, archive_content_type, archived_at
        )
        VALUES (
          ${valuesPrefix}$1, $2, $3::timestamptz, $3::timestamptz, $3::timestamptz,
          $4, $5::bigint, $6, $7, $8::jsonb, $9, $10, $11, $12::bigint, $13, $14::timestamptz
        )
        RETURNING id
      `,
      insertParams
    );

    const currentId = rows[0]?.id ? String(rows[0].id) : String(idOverride);
    return {
      inserted: true,
      currentHash: contentHash,
      currentId,
      previousId: previousId ? String(previousId) : null,
    };
  }

  async writeMediaVersion(
    appid: number,
    storefrontSnapshotId: string,
    mediaVersion: NormalizedMediaVersion,
    observedAt = new Date().toISOString(),
    options: { idOverride?: string | null; previousIdOverride?: string | null } = {}
  ): Promise<VersionWriteResult> {
    const previousVersion = await this.getLatestMediaVersionRow(appid);
    const contentHash = hashNormalizedContent(toComparableMediaVersion(mediaVersion));

    if (previousVersion && previousVersion.content_hash === contentHash) {
      await this.pool.query(
        `
          UPDATE docs.app_media_versions
          SET last_seen_at = $2::timestamptz
          WHERE id = $1::bigint
        `,
        [previousVersion.id, observedAt]
      );

      return {
        inserted: false,
        currentHash: contentHash,
        currentId: String(previousVersion.id),
        previousId: String(previousVersion.id),
      };
    }

    const idOverride = toNullableNumber(options.idOverride);
    const previousId = previousVersion?.id ?? options.previousIdOverride ?? null;
    const params = [
      appid,
      storefrontSnapshotId,
      contentHash,
      stringifyJsonValue(mediaVersion.heroImages),
      stringifyJsonValue(mediaVersion.screenshots),
      stringifyJsonValue(mediaVersion.movies),
      previousId,
      observedAt,
    ];
    const insertPrefix = idOverride ? 'id, ' : '';
    const valuesPrefix = idOverride ? '$9::bigint, ' : '';
    const insertParams = idOverride ? [...params, idOverride] : params;

    const { rows } = await this.pool.query<IdRow>(
      `
        INSERT INTO docs.app_media_versions (
          ${insertPrefix}appid, storefront_snapshot_id, content_hash, hero_assets,
          screenshots, trailers, previous_version_id, first_seen_at, last_seen_at
        )
        VALUES (
          ${valuesPrefix}$1, $2::bigint, $3, $4::jsonb, $5::jsonb, $6::jsonb,
          $7::bigint, $8::timestamptz, $8::timestamptz
        )
        RETURNING id
      `,
      insertParams
    );

    const currentId = rows[0]?.id ? String(rows[0].id) : String(idOverride);
    return {
      inserted: true,
      currentHash: contentHash,
      currentId,
      previousId: previousId ? String(previousId) : null,
    };
  }

  async upsertNewsItem(appid: number, newsVersion: NormalizedNewsVersion): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
        INSERT INTO docs.steam_news_items (
          gid, appid, url, author, feedlabel, feedname, published_at,
          first_seen_at, last_seen_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $8::timestamptz, $8::timestamptz, $8::timestamptz)
        ON CONFLICT (gid)
        DO UPDATE SET
          appid = EXCLUDED.appid,
          url = EXCLUDED.url,
          author = EXCLUDED.author,
          feedlabel = EXCLUDED.feedlabel,
          feedname = EXCLUDED.feedname,
          published_at = EXCLUDED.published_at,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        newsVersion.gid,
        appid,
        newsVersion.url,
        newsVersion.author,
        newsVersion.feedlabel,
        newsVersion.feedname,
        newsVersion.publishedAt,
        now,
      ]
    );
  }

  async writeNewsVersion(
    newsVersion: NormalizedNewsVersion,
    observedAt = new Date().toISOString(),
    options: { idOverride?: string | null; previousIdOverride?: string | null } = {}
  ): Promise<VersionWriteResult> {
    const previousVersion = await this.getLatestNewsVersionRow(newsVersion.gid);
    const contentHash = hashNormalizedContent(newsVersion);

    if (previousVersion && previousVersion.content_hash === contentHash) {
      await this.pool.query(
        `
          UPDATE docs.steam_news_versions
          SET last_seen_at = $2::timestamptz
          WHERE id = $1::bigint
        `,
        [previousVersion.id, observedAt]
      );

      return {
        inserted: false,
        currentHash: contentHash,
        currentId: String(previousVersion.id),
        previousId: String(previousVersion.id),
      };
    }

    const pointer = requireArchivePointer(await archiveJsonPayload({
      kind: 'steam-news-version',
      keyParts: [newsVersion.gid, contentHash],
      payload: newsVersion,
    }), 'news versions');
    const idOverride = toNullableNumber(options.idOverride);
    const previousId = previousVersion?.id ?? options.previousIdOverride ?? null;
    const params = [
      newsVersion.gid,
      contentHash,
      newsVersion.title,
      truncateText(newsVersion.contents, NEWS_CONTENTS_EXCERPT_LENGTH),
      newsVersion.url,
      previousId,
      pointer?.bucket ?? null,
      pointer?.key ?? null,
      pointer?.contentHash ?? null,
      pointer?.byteSize ?? null,
      pointer?.contentType ?? null,
      archiveTimestamp(pointer),
      observedAt,
    ];
    const insertPrefix = idOverride ? 'id, ' : '';
    const valuesPrefix = idOverride ? '$14::bigint, ' : '';
    const insertParams = idOverride ? [...params, idOverride] : params;

    const { rows } = await this.pool.query<IdRow>(
      `
        INSERT INTO docs.steam_news_versions (
          ${insertPrefix}gid, content_hash, title, contents_excerpt, url,
          previous_version_id, archive_bucket, archive_key, archive_content_hash,
          archive_byte_size, archive_content_type, archived_at, first_seen_at, last_seen_at
        )
        VALUES (
          ${valuesPrefix}$1, $2, $3, $4, $5, $6::bigint, $7, $8, $9,
          $10::bigint, $11, $12::timestamptz, $13::timestamptz, $13::timestamptz
        )
        RETURNING id
      `,
      insertParams
    );

    const currentId = rows[0]?.id ? String(rows[0].id) : String(idOverride);
    return {
      inserted: true,
      currentHash: contentHash,
      currentId,
      previousId: previousId ? String(previousId) : null,
    };
  }

  async insertChangeEvents(
    appid: number,
    events: AppChangeEventDraft[],
    options: {
      sourceSnapshotId?: string | null;
      relatedSnapshotId?: string | null;
      mediaVersionId?: string | null;
      newsItemGid?: string | null;
      triggerCursor?: string | null;
    } = {}
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const rows = events.map((event) => ({
      after_value: event.afterValue ?? null,
      appid,
      before_value: event.beforeValue ?? null,
      change_type: event.eventType,
      context: event.context ?? {},
      created_at: new Date().toISOString(),
      media_version_id: options.mediaVersionId ? Number(options.mediaVersionId) : null,
      news_item_gid: options.newsItemGid ?? null,
      occurred_at: event.observedAt ?? new Date().toISOString(),
      related_snapshot_id: options.relatedSnapshotId ? Number(options.relatedSnapshotId) : null,
      source: event.source,
      source_snapshot_id: options.sourceSnapshotId ? Number(options.sourceSnapshotId) : null,
      trigger_cursor: options.triggerCursor ?? null,
    }));

    await this.pool.query(
      `
        INSERT INTO events.app_change_events (
          appid, source, change_type, occurred_at, source_snapshot_id,
          related_snapshot_id, media_version_id, news_item_gid, before_value,
          after_value, context, trigger_cursor, created_at
        )
        SELECT
          appid, source, change_type, occurred_at, source_snapshot_id,
          related_snapshot_id, media_version_id, news_item_gid, before_value,
          after_value, COALESCE(context, '{}'::jsonb), trigger_cursor, created_at
        FROM jsonb_to_recordset($1::jsonb) AS event_rows (
          appid integer,
          source text,
          change_type text,
          occurred_at timestamptz,
          source_snapshot_id bigint,
          related_snapshot_id bigint,
          media_version_id bigint,
          news_item_gid text,
          before_value jsonb,
          after_value jsonb,
          context jsonb,
          trigger_cursor text,
          created_at timestamptz
        )
      `,
      [stringifyJsonValue(rows)]
    );
  }

  async getLatestHeroAssetContentHash(
    appid: number,
    assetKind: HeroAssetKind
  ): Promise<string | null> {
    const { rows } = await this.pool.query<{ content_hash: string | null }>(
      `
        SELECT content_hash
        FROM docs.app_hero_asset_versions
        WHERE appid = $1
          AND asset_kind = $2
        ORDER BY last_seen_at DESC
        LIMIT 1
      `,
      [appid, assetKind]
    );

    return rows[0]?.content_hash ?? null;
  }

  async upsertHeroAssetVersion(params: HeroAssetVersionParams): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
        INSERT INTO docs.app_hero_asset_versions (
          id, appid, asset_kind, source_url, object_bucket, object_key,
          content_hash, mime_type, content_length, width, height,
          first_seen_at, last_seen_at, created_at
        )
        VALUES (
          $1::uuid, $2::int, $3::text, $4::text, $5::text, $6::text,
          $7::text, $8::text, $9::int, $10::int, $11::int,
          $12::timestamptz, $13::timestamptz, $14::timestamptz
        )
        ON CONFLICT (appid, asset_kind, content_hash)
        DO UPDATE SET
          source_url = EXCLUDED.source_url,
          object_bucket = EXCLUDED.object_bucket,
          object_key = EXCLUDED.object_key,
          mime_type = EXCLUDED.mime_type,
          content_length = EXCLUDED.content_length,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        params.id ?? randomUUID(),
        params.appid,
        params.assetKind,
        params.sourceUrl,
        params.objectBucket,
        params.objectKey,
        params.contentHash,
        params.mimeType,
        params.contentLength,
        params.width,
        params.height,
        params.firstSeenAt ?? now,
        params.lastSeenAt ?? now,
        now,
      ]
    );
  }

  async enqueueCaptureJobs(
    jobs: Array<{
      appid: number;
      source: AppCaptureSource;
      triggerReason: string;
      triggerCursor: string | null;
      priority?: number;
      payload?: Record<string, unknown>;
    }>
  ): Promise<number> {
    if (jobs.length === 0) {
      return 0;
    }

    const payload = jobs.map((job) => ({
      appid: job.appid,
      payload: job.payload ?? {},
      priority: job.priority ?? 100,
      source: job.source,
      trigger_cursor: job.triggerCursor ?? '',
      trigger_reason: job.triggerReason,
    }));

    const { rows } = await this.pool.query<CountRow>(
      'SELECT ops.mark_app_capture_work_dirty($1::jsonb, $2::integer) AS count',
      [stringifyJsonValue(payload), this.getCaptureDirtyWindowHours()]
    );

    return parseCount(rows[0]?.count);
  }

  async claimCaptureQueue(
    sources: AppCaptureSource[],
    limit: number,
    workerId: string
  ): Promise<CaptureQueueJob[]> {
    if (sources.length === 0) {
      return [];
    }

    const { rows } = await this.pool.query<ClaimCaptureQueueRow>(
      `
        SELECT id, appid, source, trigger_reason, trigger_cursor, payload, attempts
        FROM ops.claim_app_capture_work($1::text[], $2::text, $3::integer)
      `,
      [sources, workerId, limit]
    );

    return rows.map((row) => ({
      appid: Number(row.appid),
      attempts: parseCount(row.attempts),
      id: String(row.id),
      payload: isRecord(row.payload) ? row.payload : {},
      source: row.source,
      triggerCursor: row.trigger_cursor ?? '',
      triggerReason: row.trigger_reason,
    }));
  }

  async completeCaptureQueueItems(
    jobIds: string[],
    status: 'completed' | 'failed' | 'queued' | 'dead_letter',
    errorMessage?: string
  ): Promise<void> {
    if (jobIds.length === 0) {
      return;
    }

    await this.pool.query(
      `
        SELECT ops.complete_app_capture_work(
          $1::bigint[],
          $2::text,
          $3::text,
          $4::integer
        )
      `,
      [
        jobIds.map((id) => Number(id)),
        status,
        errorMessage ?? null,
        this.getCaptureDirtyWindowHours(),
      ]
    );
  }

  async requeueStaleCaptureClaims(
    sources: AppCaptureSource[],
    claimedBeforeIso: string,
    limit = 500
  ): Promise<number> {
    if (sources.length === 0) {
      return 0;
    }

    const { rows } = await this.pool.query<CountRow>(
      `
        SELECT ops.requeue_stale_app_capture_work(
          $1::text[],
          $2::timestamptz,
          $3::integer
        ) AS count
      `,
      [sources, claimedBeforeIso, Math.max(1, Math.min(limit, 500))]
    );

    return parseCount(rows[0]?.count);
  }

  async updateSyncStatusFields(appid: number, values: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(values).filter(([key]) => STATUS_FIELD_COLUMNS.has(key));
    if (entries.length === 0) {
      return;
    }

    const columns = entries.map(([key]) => STATUS_FIELD_COLUMNS.get(key)!);
    const insertColumns = ['appid', ...columns, 'created_at', 'updated_at'];
    const valuePlaceholders = ['$1', ...columns.map((_, index) => `$${index + 2}`), 'now()', 'now()'];
    const updateSet = columns.map((column) => `${column} = EXCLUDED.${column}`);
    updateSet.push('updated_at = now()');

    await this.pool.query(
      `
        INSERT INTO ops.change_intel_app_status (${insertColumns.join(', ')})
        VALUES (${valuePlaceholders.join(', ')})
        ON CONFLICT (appid)
        DO UPDATE SET ${updateSet.join(', ')}
      `,
      [appid, ...entries.map(([, value]) => value)]
    );
  }

  async getLastNewsSyncAt(appid: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ last_news_sync: Date | string | null }>(
      `
        SELECT last_news_sync
        FROM ops.change_intel_app_status
        WHERE appid = $1
      `,
      [appid]
    );

    const value = rows[0]?.last_news_sync;
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  async createSyncJobRecord(
    jobType: string,
    batchSize: number,
    options: { idOverride?: string | null } = {}
  ): Promise<string | null> {
    const idOverride = toNullableNumber(options.idOverride);
    const insertPrefix = idOverride ? 'id, ' : '';
    const valuesPrefix = idOverride ? '$3::bigint, ' : '';
    const params = idOverride ? [jobType, batchSize, idOverride] : [jobType, batchSize];

    const { rows } = await this.pool.query<IdRow>(
      `
        INSERT INTO ops.change_intel_sync_jobs (${insertPrefix}job_type, status, batch_size)
        VALUES (${valuesPrefix}$1, 'running', $2)
        RETURNING id
      `,
      params
    );

    return rows[0]?.id ? String(rows[0].id) : null;
  }

  async updateSyncJobRecord(id: string, values: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(values).filter(([key]) => SYNC_JOB_FIELD_COLUMNS.has(key));
    if (entries.length === 0) {
      return;
    }

    const setClauses = entries.map(([key], index) => {
      const column = SYNC_JOB_FIELD_COLUMNS.get(key)!;
      return `${column} = $${index + 2}`;
    });
    setClauses.push('updated_at = now()');

    await this.pool.query(
      `
        UPDATE ops.change_intel_sync_jobs
        SET ${setClauses.join(', ')}
        WHERE id = $1
      `,
      [Number(id), ...entries.map(([, value]) => value)]
    );
  }

  async abandonStaleChangeIntelSyncJobs(
    jobTypes: string[],
    startedBeforeIso: string,
    errorMessage = 'worker_abandoned'
  ): Promise<number> {
    if (jobTypes.length === 0) {
      return 0;
    }

    const result = await this.pool.query(
      `
        UPDATE ops.change_intel_sync_jobs
        SET status = 'failed',
            completed_at = now(),
            error_message = $3,
            updated_at = now()
        WHERE job_type = ANY($1::text[])
          AND status = 'running'
          AND started_at < $2::timestamptz
      `,
      [jobTypes, startedBeforeIso, errorMessage]
    );

    return result.rowCount ?? 0;
  }

  async upsertSteamNewsSearchProjectionForGids(gids: string[]): Promise<number> {
    const normalizedGids = Array.from(
      new Set(gids.map((gid) => gid.trim()).filter((gid) => gid.length > 0))
    );
    if (normalizedGids.length === 0) {
      return 0;
    }

    const result = await this.pool.query(
      `
        WITH latest_news AS (
          SELECT
            n.gid,
            n.appid,
            n.published_at,
            n.first_seen_at,
            COALESCE(n.published_at, n.first_seen_at) AS sort_time,
            CASE
              WHEN COALESCE(n.feedlabel, '') = 'Community Announcements' THEN 'community_announcements'
              ELSE 'external_coverage'
            END AS feed_scope,
            NULLIF(BTRIM(v.title), '') AS title,
            setweight(to_tsvector('english', COALESCE(v.title, '')), 'A') ||
              setweight(to_tsvector('english', COALESCE(v.contents_excerpt, '')), 'B') AS search_document
          FROM unnest($1::text[]) AS requested_gid
          JOIN docs.steam_news_items n ON n.gid = requested_gid
          LEFT JOIN LATERAL (
            SELECT title, contents_excerpt
            FROM docs.steam_news_versions
            WHERE gid = n.gid
            ORDER BY first_seen_at DESC, id DESC
            LIMIT 1
          ) v ON TRUE
        )
        INSERT INTO docs.steam_news_search_projection (
          gid, appid, published_at, first_seen_at, sort_time, feed_scope, title, search_document
        )
        SELECT gid, appid, published_at, first_seen_at, sort_time, feed_scope, title, search_document
        FROM latest_news
        ON CONFLICT (gid) DO UPDATE
        SET appid = EXCLUDED.appid,
            published_at = EXCLUDED.published_at,
            first_seen_at = EXCLUDED.first_seen_at,
            sort_time = EXCLUDED.sort_time,
            feed_scope = EXCLUDED.feed_scope,
            title = EXCLUDED.title,
            search_document = EXCLUDED.search_document
      `,
      [normalizedGids]
    );

    return result.rowCount ?? 0;
  }

  async deleteSteamNewsSearchProjectionForGids(gids: string[]): Promise<number> {
    const normalizedGids = Array.from(
      new Set(gids.map((gid) => gid.trim()).filter((gid) => gid.length > 0))
    );
    if (normalizedGids.length === 0) {
      return 0;
    }

    const result = await this.pool.query(
      'DELETE FROM docs.steam_news_search_projection WHERE gid = ANY($1::text[])',
      [normalizedGids]
    );

    return result.rowCount ?? 0;
  }

  async refreshSteamNewsSearchProjectionForApp(appid: number): Promise<number> {
    const { rows } = await this.pool.query<{ gid: string }>(
      'SELECT gid FROM docs.steam_news_items WHERE appid = $1 ORDER BY gid',
      [appid]
    );
    const gids = rows.map((row) => row.gid);

    if (gids.length === 0) {
      const deleted = await this.pool.query(
        'DELETE FROM docs.steam_news_search_projection WHERE appid = $1',
        [appid]
      );
      return deleted.rowCount ?? 0;
    }

    const refreshed = await this.upsertSteamNewsSearchProjectionForGids(gids);
    await this.pool.query(
      `
        DELETE FROM docs.steam_news_search_projection
        WHERE appid = $1
          AND NOT (gid = ANY($2::text[]))
      `,
      [appid, gids]
    );
    return refreshed;
  }

  async refreshSteamNewsLatestProjectionForApp(appid: number): Promise<number> {
    return this.refreshSteamNewsSearchProjectionForApp(appid);
  }

  async refreshChangeActivityBurstsForApp(appid: number, lookbackDays = 180): Promise<number> {
    const { rows } = await this.pool.query<CountRow>(
      `
        WITH deleted AS (
          DELETE FROM events.change_activity_bursts
          WHERE appid = $1
            AND burst_ended_at >= now() - make_interval(days => greatest($2::integer, 1)) - interval '90 minutes'
        ),
        classified_events AS (
          SELECT
            e.id,
            e.appid,
            e.source,
            e.change_type,
            e.occurred_at,
            CASE e.change_type
              WHEN 'release_date_text_change' THEN 'release'
              WHEN 'price_change' THEN 'pricing'
              WHEN 'discount_start' THEN 'pricing'
              WHEN 'discount_end' THEN 'pricing'
              WHEN 'dlc_references_changed' THEN 'pricing'
              WHEN 'package_references_changed' THEN 'pricing'
              WHEN 'description_rewrite' THEN 'store-page'
              WHEN 'short_description_rewrite' THEN 'store-page'
              WHEN 'capsule_url_changed' THEN 'media'
              WHEN 'header_url_changed' THEN 'media'
              WHEN 'background_url_changed' THEN 'media'
              WHEN 'screenshot_added' THEN 'media'
              WHEN 'screenshot_removed' THEN 'media'
              WHEN 'screenshot_reordered' THEN 'media'
              WHEN 'trailer_added' THEN 'media'
              WHEN 'trailer_removed' THEN 'media'
              WHEN 'trailer_reordered' THEN 'media'
              WHEN 'trailer_thumbnail_changed' THEN 'media'
              WHEN 'tags_added' THEN 'taxonomy'
              WHEN 'tags_removed' THEN 'taxonomy'
              WHEN 'genres_changed' THEN 'taxonomy'
              WHEN 'categories_changed' THEN 'taxonomy'
              WHEN 'publisher_association_changed' THEN 'taxonomy'
              WHEN 'developer_association_changed' THEN 'taxonomy'
              WHEN 'languages_changed' THEN 'platform'
              WHEN 'platforms_changed' THEN 'platform'
              WHEN 'controller_support_changed' THEN 'platform'
              WHEN 'steam_deck_status_changed' THEN 'platform'
              WHEN 'news_published' THEN 'announcement'
              WHEN 'news_edited' THEN 'announcement'
              WHEN 'build_id_changed' THEN 'build'
              WHEN 'last_content_update_changed' THEN 'build'
              ELSE 'store-page'
            END AS signal_family,
            initcap(replace(e.change_type, '_', ' ')) AS highlight_label
          FROM events.app_change_events e
          WHERE e.appid = $1
            AND e.source IN ('storefront', 'pics', 'media')
            AND e.occurred_at >= now() - make_interval(days => greatest($2::integer, 1)) - interval '90 minutes'
        ),
        sequenced AS (
          SELECT
            ce.*,
            CASE
              WHEN lag(ce.occurred_at) OVER app_window IS NULL THEN 1
              WHEN ce.occurred_at - lag(ce.occurred_at) OVER app_window > interval '90 minutes' THEN 1
              ELSE 0
            END AS starts_new_burst
          FROM classified_events ce
          WINDOW app_window AS (PARTITION BY ce.appid ORDER BY ce.occurred_at)
        ),
        burst_members AS (
          SELECT
            s.*,
            sum(s.starts_new_burst) OVER (
              PARTITION BY s.appid
              ORDER BY s.occurred_at
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS burst_number
          FROM sequenced s
        ),
        burst_core AS (
          SELECT
            bm.appid,
            bm.burst_number,
            min(bm.occurred_at) AS burst_started_at,
            max(bm.occurred_at) AS burst_ended_at,
            count(*)::integer AS event_count,
            count(DISTINCT bm.change_type)::integer AS change_type_count,
            bool_or(bm.change_type NOT IN ('build_id_changed', 'last_content_update_changed')) AS has_non_technical
          FROM burst_members bm
          GROUP BY bm.appid, bm.burst_number
        ),
        projection_rows AS (
          SELECT
            format(
              '%s:%s:%s',
              a.appid,
              to_char(bc.burst_started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
              to_char(bc.burst_ended_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"')
            ) AS burst_id,
            a.appid,
            a.name AS app_name,
            a.type AS app_type,
            a.is_released,
            a.release_date,
            bc.burst_ended_at AS effective_at,
            bc.burst_started_at,
            bc.burst_ended_at,
            bc.event_count,
            bc.change_type_count,
            ARRAY(
              SELECT DISTINCT bm.source
              FROM burst_members bm
              WHERE bm.appid = bc.appid AND bm.burst_number = bc.burst_number
              ORDER BY bm.source
            ) AS source_set,
            ARRAY(
              SELECT DISTINCT bm.change_type
              FROM burst_members bm
              WHERE bm.appid = bc.appid AND bm.burst_number = bc.burst_number
              ORDER BY bm.change_type
            ) AS change_types,
            ARRAY(
              SELECT DISTINCT bm.change_type
              FROM burst_members bm
              WHERE bm.appid = bc.appid AND bm.burst_number = bc.burst_number
              ORDER BY bm.change_type
              LIMIT 3
            ) AS headline_change_types,
            ARRAY(
              SELECT DISTINCT bm.highlight_label
              FROM burst_members bm
              WHERE bm.appid = bc.appid AND bm.burst_number = bc.burst_number
              ORDER BY bm.highlight_label
              LIMIT 5
            ) AS highlight_labels,
            ARRAY(
              SELECT DISTINCT bm.signal_family
              FROM burst_members bm
              WHERE bm.appid = bc.appid AND bm.burst_number = bc.burst_number
              ORDER BY bm.signal_family
            ) AS signal_families,
            COALESCE(news_match.related_news_count, 0)::integer AS related_news_count,
            COALESCE(news_match.related_news_count, 0) > 0 AS has_related_news,
            bc.has_non_technical,
            COALESCE(ldm.total_reviews, 0) AS total_reviews,
            COALESCE(ldm.ccu_peak, 0) AS ccu_peak
          FROM burst_core bc
          JOIN legacy.apps a ON a.appid = bc.appid
          LEFT JOIN legacy.latest_daily_metrics ldm ON ldm.appid = a.appid
          LEFT JOIN LATERAL (
            SELECT count(*) AS related_news_count
            FROM docs.steam_news_items n
            WHERE n.appid = bc.appid
              AND COALESCE(n.published_at, n.first_seen_at) >= bc.burst_started_at - interval '24 hours'
              AND COALESCE(n.published_at, n.first_seen_at) <= bc.burst_ended_at + interval '24 hours'
          ) news_match ON TRUE
        ),
        inserted AS (
          INSERT INTO events.change_activity_bursts (
            burst_id, appid, app_name, app_type, is_released, release_date,
            effective_at, burst_started_at, burst_ended_at, event_count,
            change_type_count, source_set, change_types, headline_change_types,
            highlight_labels, signal_families, story_kind, has_related_news,
            related_news_count, include_in_high_signal, updated_at
          )
          SELECT
            pr.burst_id,
            pr.appid,
            pr.app_name,
            pr.app_type,
            pr.is_released,
            pr.release_date,
            pr.effective_at,
            pr.burst_started_at,
            pr.burst_ended_at,
            pr.event_count,
            pr.change_type_count,
            pr.source_set,
            pr.change_types,
            pr.headline_change_types,
            pr.highlight_labels,
            pr.signal_families,
            CASE
              WHEN pr.signal_families && ARRAY['release']::text[] OR pr.is_released = false THEN 'release-prep'
              WHEN pr.signal_families && ARRAY['pricing']::text[] THEN 'commercial-move'
              WHEN pr.signal_families && ARRAY['store-page', 'media']::text[] THEN 'store-refresh'
              WHEN pr.signal_families && ARRAY['taxonomy']::text[] THEN 'positioning-shift'
              WHEN pr.signal_families && ARRAY['platform']::text[] THEN 'platform-expansion'
              WHEN pr.signal_families && ARRAY['build']::text[] THEN 'build-activity'
              ELSE 'general-update'
            END,
            pr.has_related_news,
            pr.related_news_count,
            pr.has_non_technical
              OR pr.is_released = false
              OR (pr.release_date IS NOT NULL AND pr.release_date >= current_date - 30)
              OR pr.has_related_news
              OR pr.total_reviews >= 250
              OR pr.ccu_peak >= 100,
            now()
          FROM projection_rows pr
          ON CONFLICT (burst_id)
          DO UPDATE SET
            app_name = EXCLUDED.app_name,
            app_type = EXCLUDED.app_type,
            is_released = EXCLUDED.is_released,
            release_date = EXCLUDED.release_date,
            effective_at = EXCLUDED.effective_at,
            burst_started_at = EXCLUDED.burst_started_at,
            burst_ended_at = EXCLUDED.burst_ended_at,
            event_count = EXCLUDED.event_count,
            change_type_count = EXCLUDED.change_type_count,
            source_set = EXCLUDED.source_set,
            change_types = EXCLUDED.change_types,
            headline_change_types = EXCLUDED.headline_change_types,
            highlight_labels = EXCLUDED.highlight_labels,
            signal_families = EXCLUDED.signal_families,
            story_kind = EXCLUDED.story_kind,
            has_related_news = EXCLUDED.has_related_news,
            related_news_count = EXCLUDED.related_news_count,
            include_in_high_signal = EXCLUDED.include_in_high_signal,
            updated_at = now()
          RETURNING 1
        )
        SELECT count(*) AS count FROM inserted
      `,
      [appid, lookbackDays]
    );

    return parseCount(rows[0]?.count);
  }

  async refreshChangePatternActivityDaysForApp(appid: number, lookbackDays = 180): Promise<number> {
    const { rows } = await this.pool.query<CountRow>(
      `
        WITH deleted AS (
          DELETE FROM events.change_pattern_activity_days
          WHERE appid = $1
            AND activity_date >= (current_date - greatest($2::integer, 1))
        ),
        source_rows AS (
          SELECT *
          FROM events.change_activity_bursts
          WHERE appid = $1
            AND effective_at >= now() - make_interval(days => greatest($2::integer, 1))
        ),
        grouped AS (
          SELECT
            appid,
            effective_at::date AS activity_date,
            max(app_name) AS app_name,
            max(app_type) AS app_type,
            bool_or(coalesce(is_released, false)) AS is_released,
            max(release_date) AS release_date,
            max(effective_at) AS latest_occurred_at,
            array_agg(burst_id ORDER BY effective_at DESC, burst_id DESC) AS burst_ids,
            count(*) FILTER (WHERE has_related_news)::integer AS announcement_count,
            count(*)::integer AS total_bursts,
            count(*) FILTER (WHERE signal_families && ARRAY['release']::text[])::integer AS release_count,
            count(*) FILTER (WHERE signal_families && ARRAY['pricing']::text[])::integer AS pricing_count,
            count(*) FILTER (WHERE signal_families && ARRAY['store-page']::text[])::integer AS store_page_count,
            count(*) FILTER (WHERE signal_families && ARRAY['media']::text[])::integer AS media_count,
            count(*) FILTER (WHERE signal_families && ARRAY['taxonomy']::text[])::integer AS taxonomy_count,
            count(*) FILTER (WHERE signal_families && ARRAY['platform']::text[])::integer AS platform_count,
            count(*) FILTER (WHERE signal_families && ARRAY['build']::text[])::integer AS build_count
          FROM source_rows
          GROUP BY appid, effective_at::date
        ),
        inserted AS (
          INSERT INTO events.change_pattern_activity_days (
            appid, activity_date, app_name, app_type, is_released, release_date,
            latest_occurred_at, burst_ids, signal_families, story_kinds,
            announcement_count, total_bursts, release_count, pricing_count,
            store_page_count, media_count, taxonomy_count, platform_count,
            build_count, updated_at
          )
          SELECT
            g.appid,
            g.activity_date,
            g.app_name,
            g.app_type,
            g.is_released,
            g.release_date,
            g.latest_occurred_at,
            g.burst_ids,
            COALESCE(families.signal_families, ARRAY[]::text[]),
            COALESCE(kinds.story_kinds, ARRAY[]::text[]),
            g.announcement_count,
            g.total_bursts,
            g.release_count,
            g.pricing_count,
            g.store_page_count,
            g.media_count,
            g.taxonomy_count,
            g.platform_count,
            g.build_count,
            now()
          FROM grouped g
          LEFT JOIN LATERAL (
            SELECT array_agg(DISTINCT family ORDER BY family) AS signal_families
            FROM source_rows sr, unnest(sr.signal_families) AS family
            WHERE sr.appid = g.appid AND sr.effective_at::date = g.activity_date
          ) families ON TRUE
          LEFT JOIN LATERAL (
            SELECT array_agg(DISTINCT sr.story_kind ORDER BY sr.story_kind) AS story_kinds
            FROM source_rows sr
            WHERE sr.appid = g.appid AND sr.effective_at::date = g.activity_date
          ) kinds ON TRUE
          ON CONFLICT (appid, activity_date)
          DO UPDATE SET
            app_name = EXCLUDED.app_name,
            app_type = EXCLUDED.app_type,
            is_released = EXCLUDED.is_released,
            release_date = EXCLUDED.release_date,
            latest_occurred_at = EXCLUDED.latest_occurred_at,
            burst_ids = EXCLUDED.burst_ids,
            signal_families = EXCLUDED.signal_families,
            story_kinds = EXCLUDED.story_kinds,
            announcement_count = EXCLUDED.announcement_count,
            total_bursts = EXCLUDED.total_bursts,
            release_count = EXCLUDED.release_count,
            pricing_count = EXCLUDED.pricing_count,
            store_page_count = EXCLUDED.store_page_count,
            media_count = EXCLUDED.media_count,
            taxonomy_count = EXCLUDED.taxonomy_count,
            platform_count = EXCLUDED.platform_count,
            build_count = EXCLUDED.build_count,
            updated_at = now()
          RETURNING 1
        )
        SELECT count(*) AS count FROM inserted
      `,
      [appid, lookbackDays]
    );

    return parseCount(rows[0]?.count);
  }

  async refreshChangePatternAppWindowsForApp(appid: number, lookbackDays = 180): Promise<number> {
    const maxWindowDays = Math.max(180, lookbackDays);
    const { rows } = await this.pool.query<CountRow>(
      `
        WITH deleted AS (
          DELETE FROM events.change_pattern_app_windows
          WHERE appid = $1
        ),
        windows AS (
          SELECT unnest(ARRAY[7, 30, 90, 180]) AS window_days
        ),
        source_rows AS (
          SELECT w.window_days, cab.*
          FROM windows w
          JOIN events.change_activity_bursts cab
            ON cab.appid = $1
           AND cab.effective_at >= now() - make_interval(days => w.window_days)
           AND cab.effective_at >= now() - make_interval(days => greatest($2::integer, 1))
        ),
        grouped AS (
          SELECT
            appid,
            window_days,
            max(app_name) AS app_name,
            max(app_type) AS app_type,
            bool_or(coalesce(is_released, false)) AS is_released,
            max(release_date) AS release_date,
            max(effective_at) AS latest_occurred_at,
            (array_agg(burst_id ORDER BY effective_at DESC, burst_id DESC))[1:10] AS activity_ids,
            count(*) FILTER (WHERE has_related_news)::integer AS announcement_count,
            count(*)::integer AS change_count,
            count(*) FILTER (WHERE signal_families && ARRAY['release']::text[])::integer AS release_count,
            count(*) FILTER (WHERE signal_families && ARRAY['pricing']::text[])::integer AS pricing_count,
            count(*) FILTER (WHERE signal_families && ARRAY['store-page']::text[])::integer AS store_page_count,
            count(*) FILTER (WHERE signal_families && ARRAY['media']::text[])::integer AS media_count,
            count(*) FILTER (WHERE signal_families && ARRAY['taxonomy']::text[])::integer AS taxonomy_count,
            count(*) FILTER (WHERE signal_families && ARRAY['platform']::text[])::integer AS platform_count,
            count(*) FILTER (WHERE signal_families && ARRAY['build']::text[])::integer AS build_count
          FROM source_rows
          GROUP BY appid, window_days
        ),
        inserted AS (
          INSERT INTO events.change_pattern_app_windows (
            appid, window_days, app_name, app_type, is_released, release_date,
            latest_occurred_at, activity_ids, signal_families, story_kinds,
            announcement_count, change_count, release_count, pricing_count,
            store_page_count, media_count, taxonomy_count, platform_count,
            build_count, updated_at
          )
          SELECT
            g.appid,
            g.window_days,
            g.app_name,
            g.app_type,
            g.is_released,
            g.release_date,
            g.latest_occurred_at,
            g.activity_ids,
            COALESCE(families.signal_families, ARRAY[]::text[]),
            COALESCE(kinds.story_kinds, ARRAY[]::text[]),
            g.announcement_count,
            g.change_count,
            g.release_count,
            g.pricing_count,
            g.store_page_count,
            g.media_count,
            g.taxonomy_count,
            g.platform_count,
            g.build_count,
            now()
          FROM grouped g
          LEFT JOIN LATERAL (
            SELECT array_agg(DISTINCT family ORDER BY family) AS signal_families
            FROM source_rows sr, unnest(sr.signal_families) AS family
            WHERE sr.appid = g.appid AND sr.window_days = g.window_days
          ) families ON TRUE
          LEFT JOIN LATERAL (
            SELECT array_agg(DISTINCT sr.story_kind ORDER BY sr.story_kind) AS story_kinds
            FROM source_rows sr
            WHERE sr.appid = g.appid AND sr.window_days = g.window_days
          ) kinds ON TRUE
          ON CONFLICT (appid, window_days)
          DO UPDATE SET
            app_name = EXCLUDED.app_name,
            app_type = EXCLUDED.app_type,
            is_released = EXCLUDED.is_released,
            release_date = EXCLUDED.release_date,
            latest_occurred_at = EXCLUDED.latest_occurred_at,
            activity_ids = EXCLUDED.activity_ids,
            signal_families = EXCLUDED.signal_families,
            story_kinds = EXCLUDED.story_kinds,
            announcement_count = EXCLUDED.announcement_count,
            change_count = EXCLUDED.change_count,
            release_count = EXCLUDED.release_count,
            pricing_count = EXCLUDED.pricing_count,
            store_page_count = EXCLUDED.store_page_count,
            media_count = EXCLUDED.media_count,
            taxonomy_count = EXCLUDED.taxonomy_count,
            platform_count = EXCLUDED.platform_count,
            build_count = EXCLUDED.build_count,
            updated_at = now()
          RETURNING 1
        )
        SELECT count(*) AS count FROM inserted
      `,
      [appid, maxWindowDays]
    );

    return parseCount(rows[0]?.count);
  }

  private async getLatestStorefrontSnapshotMeta(appid: number): Promise<SnapshotMetaRow | null> {
    const { rows } = await this.pool.query<SnapshotMetaRow>(
      `
        SELECT id, content_hash, archive_bucket, archive_key
        FROM docs.app_source_snapshots
        WHERE appid = $1
          AND source = 'storefront'
        ORDER BY first_seen_at DESC, id DESC
        LIMIT 1
      `,
      [appid]
    );

    return rows[0] ?? null;
  }

  private async getLatestMediaVersionRow(appid: number): Promise<MediaVersionRow | null> {
    const { rows } = await this.pool.query<MediaVersionRow>(
      `
        SELECT id, content_hash, hero_assets, screenshots, trailers
        FROM docs.app_media_versions
        WHERE appid = $1
        ORDER BY first_seen_at DESC, id DESC
        LIMIT 1
      `,
      [appid]
    );

    return rows[0] ?? null;
  }

  private async getLatestNewsVersionRow(gid: string): Promise<NewsVersionRow | null> {
    const { rows } = await this.pool.query<NewsVersionRow>(
      `
        SELECT id, content_hash, title, contents_excerpt, url, archive_bucket, archive_key
        FROM docs.steam_news_versions
        WHERE gid = $1
        ORDER BY first_seen_at DESC, id DESC
        LIMIT 1
      `,
      [gid]
    );

    return rows[0] ?? null;
  }

  private getCaptureDirtyWindowHours(): number {
    return Math.max(1, parseInt(process.env.CHANGE_INTEL_DIRTY_WINDOW_HOURS || '6', 10));
  }
}

let tigerPool: Pool | null = null;
let tigerRepository: TigerChangeIntelRepository | null = null;

export function getTigerChangeIntelRepository(): TigerChangeIntelRepository {
  if (!tigerPool) {
    tigerPool = new Pool({
      application_name: 'publisheriq-change-intel-ingestion',
      connectionString: requireTigerConnectionString(),
      max: readNumber(process.env.CHANGE_INTEL_TIGER_POOL_MAX, DEFAULT_POOL_MAX),
      statement_timeout: readNumber(
        process.env.CHANGE_INTEL_TIGER_STATEMENT_TIMEOUT_MS,
        DEFAULT_STATEMENT_TIMEOUT_MS
      ),
    });
  }

  if (!tigerRepository) {
    tigerRepository = new TigerChangeIntelRepository(tigerPool);
  }

  return tigerRepository;
}

export async function shutdownTigerChangeIntelRepository(): Promise<void> {
  if (!tigerPool) {
    return;
  }

  await tigerPool.end();
  tigerPool = null;
  tigerRepository = null;
}
