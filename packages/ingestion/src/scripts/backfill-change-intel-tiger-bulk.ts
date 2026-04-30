import pLimit from 'p-limit';
import { Pool, type QueryResultRow } from 'pg';

import {
  archiveJsonPayload,
  createChangeIntelArchiveStore,
  type ArchivePointer,
  type ChangeIntelArchiveKind,
  type ChangeIntelArchiveStore,
} from '../change-intel/archive-store.js';
import { stringifyJsonValue } from '../change-intel/json-sanitize.js';
import { readChangeIntelRuntimeConfig } from '../change-intel/runtime-config.js';

const DEFAULT_BATCH_SIZE = 5_000;
const DEFAULT_ARCHIVE_CONCURRENCY = 24;
const MAX_ARCHIVE_CONCURRENCY = 64;
const NEWS_EXCERPT_LENGTH = 4_000;

type Surface =
  | 'app_change_events'
  | 'app_capture_work_state'
  | 'app_hero_asset_versions'
  | 'app_media_versions'
  | 'app_source_snapshots'
  | 'change_intel_app_status'
  | 'steam_news_items'
  | 'steam_news_versions';

const DEFAULT_SURFACES: Surface[] = [
  'steam_news_items',
  'app_source_snapshots',
  'steam_news_versions',
  'app_media_versions',
  'app_hero_asset_versions',
  'app_change_events',
  'change_intel_app_status',
  'app_capture_work_state',
];

interface BackfillStats {
  archived: number;
  read: number;
  surface: Surface;
  upserted: number;
}

interface AppSourceSnapshotRow extends QueryResultRow {
  appid: number;
  content_hash: string;
  first_seen_at: string;
  id: string;
  last_seen_at: string;
  observed_at: string;
  previous_snapshot_id: string | null;
  snapshot_data: Record<string, unknown>;
  source: string;
  trigger_cursor: string | null;
  trigger_reason: string;
}

interface SteamNewsItemRow extends QueryResultRow {
  appid: number;
  author: string | null;
  created_at: string;
  feedlabel: string | null;
  feedname: string | null;
  first_seen_at: string;
  gid: string;
  last_seen_at: string;
  published_at: string | null;
  updated_at: string;
  url: string;
}

interface SteamNewsVersionRow extends QueryResultRow {
  content_hash: string;
  contents: string | null;
  first_seen_at: string;
  gid: string;
  id: string;
  last_seen_at: string;
  normalized_payload: Record<string, unknown>;
  previous_version_id: string | null;
  title: string | null;
  url: string;
}

interface AppMediaVersionRow extends QueryResultRow {
  appid: number;
  content_hash: string;
  first_seen_at: string;
  hero_assets: Record<string, unknown>;
  id: string;
  last_seen_at: string;
  previous_version_id: string | null;
  screenshots: Array<Record<string, unknown>>;
  storefront_snapshot_id: string | null;
  trailers: Array<Record<string, unknown>>;
}

interface AppHeroAssetVersionRow extends QueryResultRow {
  appid: number;
  asset_kind: string;
  content_hash: string;
  content_length: number;
  created_at: string;
  first_seen_at: string;
  height: number | null;
  id: string;
  last_seen_at: string;
  mime_type: string | null;
  object_key: string;
  source_url: string;
  width: number | null;
}

interface AppChangeEventRow extends QueryResultRow {
  after_value: unknown;
  appid: number;
  before_value: unknown;
  change_type: string;
  context: Record<string, unknown>;
  created_at: string;
  id: string;
  media_version_id: string | null;
  news_item_gid: string | null;
  occurred_at: string;
  related_snapshot_id: string | null;
  source: string;
  source_snapshot_id: string | null;
  trigger_cursor: string | null;
}

interface ChangeIntelAppStatusRow extends QueryResultRow {
  appid: number;
  last_error_at: string | null;
  last_error_message: string | null;
  last_error_source: string | null;
  last_media_sync: string | null;
  last_news_sync: string | null;
  last_storefront_sync: string | null;
  steam_last_modified: string | null;
  steam_price_change_number: string | null;
  storefront_accessible: boolean | null;
}

interface AppCaptureWorkStateRow extends QueryResultRow {
  appid: number;
  attempts: number;
  created_at: string;
  dead_lettered_at: string | null;
  dirty_since: string | null;
  last_completed_at: string | null;
  last_dirty_at: string | null;
  last_error: string | null;
  latest_trigger_cursor: string;
  latest_trigger_reason: string;
  next_available_at: string;
  payload: Record<string, unknown>;
  priority: number;
  source: string;
  updated_at: string;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function requireSourceUrl(): string {
  const sourceUrl = process.env.CHANGE_INTEL_SOURCE_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('Missing CHANGE_INTEL_SOURCE_URL or DATABASE_URL.');
  }

  return sourceUrl;
}

function requireTigerUrl(): string {
  const config = readChangeIntelRuntimeConfig();
  if (!config.tigerDatabaseUrl) {
    throw new Error('Missing CHANGE_INTEL_TIGER_URL or TIGER_PRIMARY_URL.');
  }

  return config.tigerDatabaseUrl;
}

function readLimit(): number | null {
  const value = process.env.CHANGE_INTEL_TIGER_BULK_LIMIT;
  return value ? readNumber(value, DEFAULT_BATCH_SIZE) : null;
}

function readSurfaces(): Surface[] {
  const value = process.env.CHANGE_INTEL_TIGER_BULK_SURFACES;
  if (!value?.trim()) {
    return DEFAULT_SURFACES;
  }

  const allowed = new Set(DEFAULT_SURFACES);
  const surfaces = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const surface of surfaces) {
    if (!allowed.has(surface as Surface)) {
      throw new Error(`Unknown CHANGE_INTEL_TIGER_BULK_SURFACES value: ${surface}`);
    }
  }

  return surfaces as Surface[];
}

function readSnapshotSources(): string[] {
  const value = process.env.CHANGE_INTEL_TIGER_BULK_SNAPSHOT_SOURCES ?? 'storefront';
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function readEventSources(): string[] {
  const value = process.env.CHANGE_INTEL_TIGER_BULK_EVENT_SOURCES ?? 'storefront,news,media';
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function readSkipArchived(): boolean {
  return readBoolean(process.env.CHANGE_INTEL_TIGER_BULK_SKIP_ARCHIVED, false);
}

function readStartAfter(surface: Surface): string {
  const surfaceKey = surface.toUpperCase();
  return process.env[`CHANGE_INTEL_TIGER_BULK_START_AFTER_${surfaceKey}`]?.trim() ?? '';
}

function truncateText(value: string | null, length: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > length ? value.slice(0, length) : value;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function heroAssetBucket(): string {
  const bucket = process.env.CHANGE_INTEL_HERO_ASSET_BUCKET ?? process.env.CHANGE_INTEL_ARCHIVE_BUCKET;
  if (!bucket) {
    throw new Error('Missing CHANGE_INTEL_HERO_ASSET_BUCKET or CHANGE_INTEL_ARCHIVE_BUCKET.');
  }

  return bucket;
}

function snapshotSummary(snapshot: Record<string, unknown>): Record<string, unknown> {
  const screenshots = Array.isArray(snapshot.screenshots) ? snapshot.screenshots : [];
  const movies = Array.isArray(snapshot.movies) ? snapshot.movies : [];
  const genres = Array.isArray(snapshot.genres) ? snapshot.genres : [];
  const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];

  return {
    comingSoon: snapshot.comingSoon ?? null,
    isDelisted: snapshot.isDelisted ?? null,
    isFree: snapshot.isFree ?? null,
    name: snapshot.name ?? null,
    price: snapshot.price ?? null,
    releaseDate: snapshot.releaseDate ?? null,
    releaseDateText: snapshot.releaseDateText ?? null,
    type: snapshot.type ?? null,
    counts: {
      categories: categories.length,
      genres: genres.length,
      movies: movies.length,
      screenshots: screenshots.length,
    },
  };
}

async function archivePayload(params: {
  kind: ChangeIntelArchiveKind;
  keyParts: string[];
  payload: unknown;
  store: ChangeIntelArchiveStore | null;
}): Promise<ArchivePointer | null> {
  if (!params.store) {
    return null;
  }

  return archiveJsonPayload({
    kind: params.kind,
    keyParts: params.keyParts,
    payload: params.payload,
    store: params.store,
  });
}

function emptyStats(surface: Surface): BackfillStats {
  return { archived: 0, read: 0, surface, upserted: 0 };
}

function logProgress(stats: BackfillStats, params: { dryRun: boolean; lastKey: string; limit: number | null }): void {
  console.error(JSON.stringify({ ...stats, dryRun: params.dryRun, lastKey: params.lastKey, limit: params.limit }));
}

function remainingBatchSize(stats: BackfillStats, batchSize: number, limit: number | null): number {
  if (!limit) {
    return batchSize;
  }

  return Math.max(0, Math.min(batchSize, limit - stats.read));
}

async function filterRowsMissingArchive<T extends { id: string }>(params: {
  relation: 'docs.app_source_snapshots' | 'docs.steam_news_versions';
  rows: T[];
  targetPool: Pool;
}): Promise<T[]> {
  if (params.rows.length === 0) {
    return params.rows;
  }

  const ids = params.rows.map((row) => row.id);
  const { rows } = await params.targetPool.query<{ id: string }>(
    `
      SELECT id::text
      FROM ${params.relation}
      WHERE id = ANY($1::bigint[])
        AND archive_key IS NOT NULL
    `,
    [ids]
  );
  const archivedIds = new Set(rows.map((row) => row.id));

  return params.rows.filter((row) => !archivedIds.has(row.id));
}

async function backfillSteamNewsItems(params: {
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('steam_news_items');
  let lastGid = params.startAfter;

  while (true) {
    const batchSize = remainingBatchSize(stats, params.batchSize, params.limit);
    if (batchSize <= 0) break;

    const { rows } = await params.sourcePool.query<SteamNewsItemRow>(
      `
        SELECT gid, appid, url, author, feedlabel, feedname, published_at::text,
               first_seen_at::text, last_seen_at::text, created_at::text, updated_at::text
        FROM public.steam_news_items
        WHERE gid > $1
        ORDER BY gid ASC
        LIMIT $2
      `,
      [lastGid, batchSize]
    );
    if (rows.length === 0) break;

    stats.read += rows.length;
    lastGid = rows[rows.length - 1]?.gid ?? lastGid;

    if (!params.dryRun) {
      await upsertSteamNewsItems(params.targetPool, rows);
      stats.upserted += rows.length;
    }

    logProgress(stats, { dryRun: params.dryRun, lastKey: lastGid, limit: params.limit });
  }

  return stats;
}

async function upsertSteamNewsItems(
  targetPool: Pool,
  rows: SteamNewsItemRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await targetPool.query(
    `
      INSERT INTO docs.steam_news_items (
        gid, appid, url, author, feedlabel, feedname, published_at,
        first_seen_at, last_seen_at, created_at, updated_at
      )
      SELECT gid, appid, url, author, feedlabel, feedname, published_at,
             first_seen_at, last_seen_at, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS rows (
        gid text, appid integer, url text, author text, feedlabel text,
        feedname text, published_at timestamptz, first_seen_at timestamptz,
        last_seen_at timestamptz, created_at timestamptz, updated_at timestamptz
      )
      ON CONFLICT (gid)
      DO UPDATE SET
        appid = EXCLUDED.appid,
        url = EXCLUDED.url,
        author = EXCLUDED.author,
        feedlabel = EXCLUDED.feedlabel,
        feedname = EXCLUDED.feedname,
        published_at = EXCLUDED.published_at,
        first_seen_at = EXCLUDED.first_seen_at,
        last_seen_at = EXCLUDED.last_seen_at,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [stringifyJsonValue(rows)]
  );
}

async function upsertSteamNewsItemsForVersionRows(params: {
  rows: SteamNewsVersionRow[];
  sourcePool: Pool;
  targetPool: Pool;
}): Promise<void> {
  const gids = Array.from(new Set(params.rows.map((row) => row.gid)));
  if (gids.length === 0) {
    return;
  }

  const { rows } = await params.sourcePool.query<SteamNewsItemRow>(
    `
      SELECT gid, appid, url, author, feedlabel, feedname, published_at::text,
             first_seen_at::text, last_seen_at::text, created_at::text, updated_at::text
      FROM public.steam_news_items
      WHERE gid = ANY($1::text[])
    `,
    [gids]
  );
  await upsertSteamNewsItems(params.targetPool, rows);
}

async function backfillAppSourceSnapshots(params: {
  archiveConcurrency: number;
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  snapshotSources: string[];
  skipArchived: boolean;
  sourcePool: Pool;
  startAfter: string;
  store: ChangeIntelArchiveStore | null;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('app_source_snapshots');
  let lastId = params.startAfter || '0';

  while (true) {
    const batchSize = remainingBatchSize(stats, params.batchSize, params.limit);
    if (batchSize <= 0) break;

    const { rows } = await params.sourcePool.query<AppSourceSnapshotRow>(
      `
        SELECT id::text, appid, source::text, observed_at::text, first_seen_at::text,
               last_seen_at::text, content_hash, previous_snapshot_id::text,
               trigger_reason, trigger_cursor, snapshot_data
        FROM public.app_source_snapshots
        WHERE id > $1::bigint
          AND source::text = ANY($2::text[])
        ORDER BY public.app_source_snapshots.id ASC
        LIMIT $3
      `,
      [lastId, params.snapshotSources, batchSize]
    );
    if (rows.length === 0) break;

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (!params.dryRun) {
      const rowsToArchive = params.skipArchived
        ? await filterRowsMissingArchive({
            relation: 'docs.app_source_snapshots',
            rows,
            targetPool: params.targetPool,
          })
        : rows;
      const limiter = pLimit(params.archiveConcurrency);
      const payload = await Promise.all(rowsToArchive.map((row) => limiter(async () => {
        const pointer = await archivePayload({
          kind: 'app-source-snapshot',
          keyParts: [String(row.appid), row.source, row.id],
          payload: row.snapshot_data,
          store: params.store,
        });
        return {
          ...row,
          archive_bucket: pointer?.bucket ?? null,
          archive_byte_size: pointer?.byteSize ?? null,
          archive_content_hash: pointer?.contentHash ?? null,
          archive_content_type: pointer?.contentType ?? null,
          archive_key: pointer?.key ?? null,
          archived_at: pointer ? new Date().toISOString() : null,
          snapshot_summary: snapshotSummary(row.snapshot_data),
        };
      })));

      if (payload.length > 0) {
        await params.targetPool.query(
          `
            INSERT INTO docs.app_source_snapshots (
              id, appid, source, observed_at, first_seen_at, last_seen_at, content_hash,
              previous_snapshot_id, trigger_reason, trigger_cursor, snapshot_summary,
              archive_bucket, archive_key, archive_content_hash, archive_byte_size,
              archive_content_type, archived_at
            )
            SELECT id, appid, source, observed_at, first_seen_at, last_seen_at, content_hash,
                   previous_snapshot_id, trigger_reason, trigger_cursor, snapshot_summary,
                   archive_bucket, archive_key, archive_content_hash, archive_byte_size,
                   archive_content_type, archived_at
            FROM jsonb_to_recordset($1::jsonb) AS rows (
              id bigint, appid integer, source text, observed_at timestamptz,
              first_seen_at timestamptz, last_seen_at timestamptz, content_hash text,
              previous_snapshot_id bigint, trigger_reason text, trigger_cursor text,
              snapshot_summary jsonb, archive_bucket text, archive_key text,
              archive_content_hash text, archive_byte_size bigint,
              archive_content_type text, archived_at timestamptz
            )
            ON CONFLICT (id)
            DO UPDATE SET
              observed_at = EXCLUDED.observed_at,
              last_seen_at = EXCLUDED.last_seen_at,
              trigger_cursor = EXCLUDED.trigger_cursor,
              snapshot_summary = EXCLUDED.snapshot_summary,
              archive_bucket = EXCLUDED.archive_bucket,
              archive_key = EXCLUDED.archive_key,
              archive_content_hash = EXCLUDED.archive_content_hash,
              archive_byte_size = EXCLUDED.archive_byte_size,
              archive_content_type = EXCLUDED.archive_content_type,
              archived_at = EXCLUDED.archived_at
          `,
          [stringifyJsonValue(payload)]
        );
        stats.archived += payload.filter((row) => row.archive_key).length;
        stats.upserted += payload.length;
      }
    }

    logProgress(stats, { dryRun: params.dryRun, lastKey: lastId, limit: params.limit });
  }

  return stats;
}

async function backfillSteamNewsVersions(params: {
  archiveConcurrency: number;
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  skipArchived: boolean;
  sourcePool: Pool;
  startAfter: string;
  store: ChangeIntelArchiveStore | null;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('steam_news_versions');
  let lastId = params.startAfter || '0';

  while (true) {
    const batchSize = remainingBatchSize(stats, params.batchSize, params.limit);
    if (batchSize <= 0) break;

    const { rows } = await params.sourcePool.query<SteamNewsVersionRow>(
      `
        SELECT id::text, gid, content_hash, title, contents, url,
               previous_version_id::text, normalized_payload,
               first_seen_at::text, last_seen_at::text
        FROM public.steam_news_versions
        WHERE id > $1::bigint
        ORDER BY public.steam_news_versions.id ASC
        LIMIT $2
      `,
      [lastId, batchSize]
    );
    if (rows.length === 0) break;

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (!params.dryRun) {
      const rowsToArchive = params.skipArchived
        ? await filterRowsMissingArchive({
            relation: 'docs.steam_news_versions',
            rows,
            targetPool: params.targetPool,
          })
        : rows;
      const limiter = pLimit(params.archiveConcurrency);
      const payload = await Promise.all(rowsToArchive.map((row) => limiter(async () => {
        const pointer = await archivePayload({
          kind: 'steam-news-version',
          keyParts: [row.gid, row.id],
          payload: {
            ...row.normalized_payload,
            contents: row.contents,
            gid: row.gid,
            title: row.title,
            url: row.url,
          },
          store: params.store,
        });
        return {
          ...row,
          archive_bucket: pointer?.bucket ?? null,
          archive_byte_size: pointer?.byteSize ?? null,
          archive_content_hash: pointer?.contentHash ?? null,
          archive_content_type: pointer?.contentType ?? null,
          archive_key: pointer?.key ?? null,
          archived_at: pointer ? new Date().toISOString() : null,
          contents_excerpt: truncateText(row.contents, NEWS_EXCERPT_LENGTH),
        };
      })));

      if (payload.length > 0) {
        await upsertSteamNewsItemsForVersionRows({
          rows: rowsToArchive,
          sourcePool: params.sourcePool,
          targetPool: params.targetPool,
        });
        await params.targetPool.query(
          `
            INSERT INTO docs.steam_news_versions (
              id, gid, content_hash, title, contents_excerpt, url, previous_version_id,
              archive_bucket, archive_key, archive_content_hash, archive_byte_size,
              archive_content_type, archived_at, first_seen_at, last_seen_at
            )
            SELECT id, gid, content_hash, title, contents_excerpt, url, previous_version_id,
                   archive_bucket, archive_key, archive_content_hash, archive_byte_size,
                   archive_content_type, archived_at, first_seen_at, last_seen_at
            FROM jsonb_to_recordset($1::jsonb) AS rows (
              id bigint, gid text, content_hash text, title text, contents_excerpt text,
              url text, previous_version_id bigint, archive_bucket text, archive_key text,
              archive_content_hash text, archive_byte_size bigint,
              archive_content_type text, archived_at timestamptz,
              first_seen_at timestamptz, last_seen_at timestamptz
            )
            ON CONFLICT (id)
            DO UPDATE SET
              title = EXCLUDED.title,
              contents_excerpt = EXCLUDED.contents_excerpt,
              url = EXCLUDED.url,
              archive_bucket = EXCLUDED.archive_bucket,
              archive_key = EXCLUDED.archive_key,
              archive_content_hash = EXCLUDED.archive_content_hash,
              archive_byte_size = EXCLUDED.archive_byte_size,
              archive_content_type = EXCLUDED.archive_content_type,
              archived_at = EXCLUDED.archived_at,
              last_seen_at = EXCLUDED.last_seen_at
          `,
          [stringifyJsonValue(payload)]
        );
        stats.archived += payload.filter((row) => row.archive_key).length;
        stats.upserted += payload.length;
      }
    }

    logProgress(stats, { dryRun: params.dryRun, lastKey: lastId, limit: params.limit });
  }

  return stats;
}

async function backfillJsonRows<T extends QueryResultRow & { id?: string | number }>(params: {
  batchSize: number;
  dryRun: boolean;
  fetchRows: (lastId: string, batchSize: number) => Promise<T[]>;
  limit: number | null;
  startAfter: string;
  surface: Surface;
  targetPool: Pool;
  upsertSql: string;
}): Promise<BackfillStats> {
  const stats = emptyStats(params.surface);
  let lastId = params.startAfter || '0';

  while (true) {
    const batchSize = remainingBatchSize(stats, params.batchSize, params.limit);
    if (batchSize <= 0) break;

    const rows = await params.fetchRows(lastId, batchSize);
    if (rows.length === 0) break;

    stats.read += rows.length;
    lastId = String(rows[rows.length - 1]?.id ?? lastId);

    if (!params.dryRun) {
      await params.targetPool.query(params.upsertSql, [stringifyJsonValue(rows)]);
      stats.upserted += rows.length;
    }

    logProgress(stats, { dryRun: params.dryRun, lastKey: lastId, limit: params.limit });
  }

  return stats;
}

async function backfillAppMediaVersions(params: {
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  return backfillJsonRows<AppMediaVersionRow>({
    ...params,
    surface: 'app_media_versions',
    fetchRows: async (lastId, batchSize) => {
      const { rows } = await params.sourcePool.query<AppMediaVersionRow>(
        `
          SELECT id::text, appid, storefront_snapshot_id::text, content_hash, hero_assets,
                 screenshots, trailers, previous_version_id::text,
                 first_seen_at::text, last_seen_at::text
          FROM public.app_media_versions
          WHERE id > $1::bigint
          ORDER BY public.app_media_versions.id ASC
          LIMIT $2
        `,
        [lastId, batchSize]
      );
      return rows;
    },
    upsertSql: `
      INSERT INTO docs.app_media_versions (
        id, appid, storefront_snapshot_id, content_hash, hero_assets, screenshots,
        trailers, previous_version_id, first_seen_at, last_seen_at
      )
      SELECT id, appid, storefront_snapshot_id, content_hash, hero_assets, screenshots,
             trailers, previous_version_id, first_seen_at, last_seen_at
      FROM jsonb_to_recordset($1::jsonb) AS rows (
        id bigint, appid integer, storefront_snapshot_id bigint, content_hash text,
        hero_assets jsonb, screenshots jsonb, trailers jsonb, previous_version_id bigint,
        first_seen_at timestamptz, last_seen_at timestamptz
      )
      ON CONFLICT (id)
      DO UPDATE SET
        storefront_snapshot_id = EXCLUDED.storefront_snapshot_id,
        content_hash = EXCLUDED.content_hash,
        hero_assets = EXCLUDED.hero_assets,
        screenshots = EXCLUDED.screenshots,
        trailers = EXCLUDED.trailers,
        previous_version_id = EXCLUDED.previous_version_id,
        last_seen_at = EXCLUDED.last_seen_at
    `,
  });
}

async function backfillHeroAssetVersions(params: {
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const objectBucket = heroAssetBucket();
  return backfillJsonRows<AppHeroAssetVersionRow & { object_bucket: string; target_object_key: string }>({
    batchSize: params.batchSize,
    dryRun: params.dryRun,
    limit: params.limit,
    startAfter: params.startAfter,
    surface: 'app_hero_asset_versions',
    targetPool: params.targetPool,
    fetchRows: async (lastId, batchSize) => {
      const { rows } = await params.sourcePool.query<AppHeroAssetVersionRow>(
        `
          SELECT id::text, appid, asset_kind, source_url, object_key, content_hash,
                 mime_type, content_length, width, height, first_seen_at::text,
                 last_seen_at::text, created_at::text
          FROM public.app_hero_asset_versions
          WHERE id::text > $1::text
          ORDER BY id::text ASC
          LIMIT $2
        `,
        [lastId === '0' ? '' : lastId, batchSize]
      );
      return rows.map((row) => ({
        ...row,
        object_bucket: objectBucket,
        target_object_key: trimSlashes(row.object_key),
      }));
    },
    upsertSql: `
      INSERT INTO docs.app_hero_asset_versions (
        id, appid, asset_kind, source_url, object_bucket, object_key, content_hash,
        mime_type, content_length, width, height, first_seen_at, last_seen_at, created_at
      )
      SELECT id, appid, asset_kind, source_url, object_bucket, target_object_key,
             content_hash, mime_type, content_length, width, height, first_seen_at,
             last_seen_at, created_at
      FROM jsonb_to_recordset($1::jsonb) AS rows (
        id uuid, appid integer, asset_kind text, source_url text, object_bucket text,
        target_object_key text, content_hash text, mime_type text, content_length integer,
        width integer, height integer, first_seen_at timestamptz, last_seen_at timestamptz,
        created_at timestamptz
      )
      ON CONFLICT (id)
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
  });
}

async function backfillAppChangeEvents(params: {
  batchSize: number;
  dryRun: boolean;
  eventSources: string[];
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  return backfillJsonRows<AppChangeEventRow>({
    ...params,
    surface: 'app_change_events',
    fetchRows: async (lastId, batchSize) => {
      const { rows } = await params.sourcePool.query<AppChangeEventRow>(
        `
          SELECT id::text, appid, source::text, change_type::text, occurred_at::text,
                 source_snapshot_id::text, related_snapshot_id::text,
                 media_version_id::text, news_item_gid, before_value, after_value,
                 context, trigger_cursor, created_at::text
          FROM public.app_change_events
          WHERE id > $1::bigint
            AND source::text = ANY($2::text[])
          ORDER BY public.app_change_events.id ASC
          LIMIT $3
        `,
        [lastId, params.eventSources, batchSize]
      );
      return rows;
    },
    upsertSql: `
      WITH incoming AS (
        SELECT id, appid, source, change_type, occurred_at, source_snapshot_id,
               related_snapshot_id, media_version_id, news_item_gid, before_value,
               after_value, COALESCE(context, '{}'::jsonb) AS context,
               trigger_cursor, created_at
        FROM jsonb_to_recordset($1::jsonb) AS rows (
          id bigint, appid integer, source text, change_type text, occurred_at timestamptz,
          source_snapshot_id bigint, related_snapshot_id bigint, media_version_id bigint,
          news_item_gid text, before_value jsonb, after_value jsonb, context jsonb,
          trigger_cursor text, created_at timestamptz
        )
      )
      INSERT INTO events.app_change_events (
        id, appid, source, change_type, occurred_at, source_snapshot_id,
        related_snapshot_id, media_version_id, news_item_gid, before_value,
        after_value, context, trigger_cursor, created_at
      )
      SELECT id, appid, source, change_type, occurred_at, source_snapshot_id,
             related_snapshot_id, media_version_id, news_item_gid, before_value,
             after_value, context, trigger_cursor, created_at
      FROM incoming
      WHERE NOT EXISTS (
        SELECT 1
        FROM events.app_change_events existing
        WHERE existing.id = incoming.id
      )
    `,
  });
}

async function backfillChangeIntelAppStatus(params: {
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  return backfillJsonRows<ChangeIntelAppStatusRow & { id: number }>({
    ...params,
    surface: 'change_intel_app_status',
    fetchRows: async (lastId, batchSize) => {
      const { rows } = await params.sourcePool.query<ChangeIntelAppStatusRow & { id: number }>(
        `
          SELECT appid AS id, appid, storefront_accessible, last_storefront_sync::text,
                 last_news_sync::text, last_media_sync::text, last_error_source::text,
                 last_error_message, last_error_at::text, steam_last_modified::text,
                 steam_price_change_number::text
          FROM public.sync_status
          WHERE appid > $1::int
          ORDER BY appid ASC
          LIMIT $2
        `,
        [lastId, batchSize]
      );
      return rows;
    },
    upsertSql: `
      INSERT INTO ops.change_intel_app_status (
        appid, storefront_accessible, last_storefront_sync, last_news_sync,
        last_media_sync, last_error_source, last_error_message, last_error_at,
        steam_last_modified, steam_price_change_number, created_at, updated_at
      )
      SELECT appid, storefront_accessible, last_storefront_sync, last_news_sync,
             last_media_sync, last_error_source, last_error_message, last_error_at,
             steam_last_modified, steam_price_change_number, now(), now()
      FROM jsonb_to_recordset($1::jsonb) AS rows (
        appid integer, storefront_accessible boolean, last_storefront_sync timestamptz,
        last_news_sync timestamptz, last_media_sync timestamptz, last_error_source text,
        last_error_message text, last_error_at timestamptz, steam_last_modified bigint,
        steam_price_change_number bigint
      )
      ON CONFLICT (appid)
      DO UPDATE SET
        storefront_accessible = EXCLUDED.storefront_accessible,
        last_storefront_sync = EXCLUDED.last_storefront_sync,
        last_news_sync = EXCLUDED.last_news_sync,
        last_media_sync = EXCLUDED.last_media_sync,
        last_error_source = EXCLUDED.last_error_source,
        last_error_message = EXCLUDED.last_error_message,
        last_error_at = EXCLUDED.last_error_at,
        steam_last_modified = EXCLUDED.steam_last_modified,
        steam_price_change_number = EXCLUDED.steam_price_change_number,
        updated_at = now()
    `,
  });
}

async function backfillAppCaptureWorkState(params: {
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  sourcePool: Pool;
  startAfter: string;
  targetPool: Pool;
}): Promise<BackfillStats> {
  return backfillJsonRows<AppCaptureWorkStateRow & { id: string }>({
    ...params,
    surface: 'app_capture_work_state',
    fetchRows: async (lastId, batchSize) => {
      const { rows } = await params.sourcePool.query<AppCaptureWorkStateRow & { id: string }>(
        `
          SELECT id::text, appid, source::text, priority, latest_trigger_reason,
                 latest_trigger_cursor, payload, dirty_since::text, last_dirty_at::text,
                 attempts, next_available_at::text, last_completed_at::text, last_error,
                 dead_lettered_at::text, created_at::text, updated_at::text
          FROM public.app_capture_work_state
          WHERE id > $1::bigint
          ORDER BY public.app_capture_work_state.id ASC
          LIMIT $2
        `,
        [lastId, batchSize]
      );
      return rows;
    },
    upsertSql: `
      INSERT INTO ops.app_capture_work_state (
        appid, source, priority, latest_trigger_reason, latest_trigger_cursor,
        payload, dirty_since, last_dirty_at, claimed_at, worker_id, attempts,
        next_available_at, last_completed_at, last_error, dead_lettered_at,
        created_at, updated_at
      )
      SELECT appid, source, priority, latest_trigger_reason, latest_trigger_cursor,
             COALESCE(payload, '{}'::jsonb), dirty_since, last_dirty_at, NULL, NULL,
             attempts, next_available_at, last_completed_at, last_error,
             dead_lettered_at, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS rows (
        appid integer, source text, priority integer, latest_trigger_reason text,
        latest_trigger_cursor text, payload jsonb, dirty_since timestamptz,
        last_dirty_at timestamptz, attempts integer, next_available_at timestamptz,
        last_completed_at timestamptz, last_error text, dead_lettered_at timestamptz,
        created_at timestamptz, updated_at timestamptz
      )
      ON CONFLICT (appid, source)
      DO UPDATE SET
        priority = EXCLUDED.priority,
        latest_trigger_reason = EXCLUDED.latest_trigger_reason,
        latest_trigger_cursor = EXCLUDED.latest_trigger_cursor,
        payload = EXCLUDED.payload,
        dirty_since = EXCLUDED.dirty_since,
        last_dirty_at = EXCLUDED.last_dirty_at,
        claimed_at = NULL,
        worker_id = NULL,
        attempts = EXCLUDED.attempts,
        next_available_at = EXCLUDED.next_available_at,
        last_completed_at = EXCLUDED.last_completed_at,
        last_error = EXCLUDED.last_error,
        dead_lettered_at = EXCLUDED.dead_lettered_at,
        updated_at = EXCLUDED.updated_at
    `,
  });
}

async function runSurface(surface: Surface, params: {
  archiveConcurrency: number;
  batchSize: number;
  dryRun: boolean;
  eventSources: string[];
  limit: number | null;
  snapshotSources: string[];
  skipArchived: boolean;
  sourcePool: Pool;
  startAfter: string;
  store: ChangeIntelArchiveStore | null;
  targetPool: Pool;
}): Promise<BackfillStats> {
  switch (surface) {
    case 'steam_news_items':
      return backfillSteamNewsItems(params);
    case 'app_source_snapshots':
      return backfillAppSourceSnapshots(params);
    case 'steam_news_versions':
      return backfillSteamNewsVersions(params);
    case 'app_media_versions':
      return backfillAppMediaVersions(params);
    case 'app_hero_asset_versions':
      return backfillHeroAssetVersions(params);
    case 'app_change_events':
      return backfillAppChangeEvents(params);
    case 'change_intel_app_status':
      return backfillChangeIntelAppStatus(params);
    case 'app_capture_work_state':
      return backfillAppCaptureWorkState(params);
  }
}

async function main(): Promise<void> {
  const dryRun = readBoolean(process.env.CHANGE_INTEL_TIGER_BULK_DRY_RUN, true);
  const batchSize = readNumber(process.env.CHANGE_INTEL_TIGER_BULK_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const archiveConcurrency = Math.min(
    readNumber(process.env.CHANGE_INTEL_TIGER_BULK_ARCHIVE_CONCURRENCY, DEFAULT_ARCHIVE_CONCURRENCY),
    MAX_ARCHIVE_CONCURRENCY
  );
  const eventSources = readEventSources();
  const limit = readLimit();
  const skipArchived = readSkipArchived();
  const snapshotSources = readSnapshotSources();
  const surfaces = readSurfaces();
  const sourcePool = new Pool({
    application_name: 'publisheriq-change-intel-tiger-bulk-source',
    connectionString: requireSourceUrl(),
    max: 2,
  });
  const targetPool = new Pool({
    application_name: 'publisheriq-change-intel-tiger-bulk-target',
    connectionString: requireTigerUrl(),
    max: Math.max(2, Math.min(archiveConcurrency, 12)),
  });
  sourcePool.on('error', (error) => {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      pool: 'source',
      type: 'idle_pool_error',
    }));
  });
  targetPool.on('error', (error) => {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      pool: 'target',
      type: 'idle_pool_error',
    }));
  });
  const store = dryRun ? null : createChangeIntelArchiveStore();

  if (!dryRun && !store) {
    throw new Error('CHANGE_INTEL_ARCHIVE_TARGET=object_storage is required when CHANGE_INTEL_TIGER_BULK_DRY_RUN=false.');
  }

  try {
    const results: BackfillStats[] = [];
    for (const surface of surfaces) {
      results.push(await runSurface(surface, {
        archiveConcurrency,
        batchSize,
        dryRun,
        eventSources,
        limit,
        snapshotSources,
        skipArchived,
        sourcePool,
        startAfter: readStartAfter(surface),
        store,
        targetPool,
      }));
    }

    console.log(JSON.stringify({
      archiveConcurrency,
      batchSize,
      dryRun,
      eventSources,
      limit,
      results,
      snapshotSources,
      skipArchived,
      surfaces,
    }, null, 2));
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
