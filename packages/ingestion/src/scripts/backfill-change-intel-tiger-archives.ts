import pLimit from 'p-limit';
import { Pool, type QueryResultRow } from 'pg';

import {
  archiveJsonPayload,
  createChangeIntelArchiveStore,
  type ArchivePointer,
  type ChangeIntelArchiveKind,
  type ChangeIntelArchiveStore,
} from '../change-intel/archive-store.js';
import { readChangeIntelRuntimeConfig } from '../change-intel/runtime-config.js';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 32;
const NEWS_EXCERPT_LENGTH = 4_000;

interface BackfillStats {
  archived: number;
  read: number;
  skipped: number;
  surface: string;
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

function readMinFirstSeenAt(): string | null {
  const explicitValue = process.env.CHANGE_INTEL_TIGER_BACKFILL_MIN_FIRST_SEEN_AT;
  if (explicitValue) {
    const parsed = new Date(explicitValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('CHANGE_INTEL_TIGER_BACKFILL_MIN_FIRST_SEEN_AT must be a valid date or ISO timestamp.');
    }

    return parsed.toISOString();
  }

  const recentDays = process.env.CHANGE_INTEL_TIGER_BACKFILL_RECENT_DAYS;
  if (!recentDays) {
    return null;
  }

  const parsed = Number(recentDays);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('CHANGE_INTEL_TIGER_BACKFILL_RECENT_DAYS must be a positive number.');
  }

  return new Date(Date.now() - parsed * 24 * 60 * 60 * 1000).toISOString();
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

function truncateText(value: string | null, length: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > length ? value.slice(0, length) : value;
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
  dryRun: boolean;
  kind: ChangeIntelArchiveKind;
  keyParts: string[];
  payload: unknown;
  store: ChangeIntelArchiveStore | null;
}): Promise<ArchivePointer | null> {
  if (params.dryRun) {
    return null;
  }

  return archiveJsonPayload({
    kind: params.kind,
    keyParts: params.keyParts,
    payload: params.payload,
    store: params.store,
  });
}

function emptyStats(surface: string): BackfillStats {
  return {
    archived: 0,
    read: 0,
    skipped: 0,
    surface,
    upserted: 0,
  };
}

function logSurfaceProgress(stats: BackfillStats, params: { dryRun: boolean; lastId: string; limit: number | null }): void {
  console.error(
    JSON.stringify({
      archived: stats.archived,
      dryRun: params.dryRun,
      lastId: params.lastId,
      limit: params.limit,
      read: stats.read,
      surface: stats.surface,
      upserted: stats.upserted,
    })
  );
}

async function backfillAppSourceSnapshots(params: {
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  limit: number | null;
  minFirstSeenAt: string | null;
  sourcePool: Pool;
  store: ChangeIntelArchiveStore | null;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('app_source_snapshots');
  let lastId = '0';

  while (!params.limit || stats.read < params.limit) {
    const remaining = params.limit ? params.limit - stats.read : params.batchSize;
    const batchSize = Math.min(params.batchSize, remaining);
    const { rows } = await params.sourcePool.query<AppSourceSnapshotRow>(
      `
        SELECT
          id::text,
          appid,
          source::text,
          observed_at::text,
          first_seen_at::text,
          last_seen_at::text,
          content_hash,
          previous_snapshot_id::text,
          trigger_reason,
          trigger_cursor,
          snapshot_data
        FROM public.app_source_snapshots
        WHERE id > $1::bigint
          AND ($2::timestamptz IS NULL OR first_seen_at >= $2::timestamptz)
        ORDER BY id ASC
        LIMIT $3
      `,
      [lastId, params.minFirstSeenAt, batchSize]
    );

    if (rows.length === 0) {
      break;
    }

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (params.dryRun) {
      logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
      continue;
    }

    const limiter = pLimit(params.concurrency);
    const results = await Promise.all(
      rows.map((row) =>
        limiter(async () => {
          const pointer = await archivePayload({
            dryRun: params.dryRun,
            kind: 'app-source-snapshot',
            keyParts: [String(row.appid), row.source, row.id],
            payload: row.snapshot_data,
            store: params.store,
          });

          await params.targetPool.query(
            `
          INSERT INTO docs.app_source_snapshots (
            id,
            appid,
            source,
            observed_at,
            first_seen_at,
            last_seen_at,
            content_hash,
            previous_snapshot_id,
            trigger_reason,
            trigger_cursor,
            snapshot_summary,
            archive_bucket,
            archive_key,
            archive_content_hash,
            archive_byte_size,
            archive_content_type,
            archived_at
          )
          VALUES (
            $1::bigint,
            $2::int,
            $3::text,
            $4::timestamptz,
            $5::timestamptz,
            $6::timestamptz,
            $7::text,
            $8::bigint,
            $9::text,
            $10::text,
            $11::jsonb,
            $12::text,
            $13::text,
            $14::text,
            $15::bigint,
            $16::text,
            CASE WHEN $13::text IS NULL THEN NULL ELSE now() END
          )
          ON CONFLICT (id) DO UPDATE SET
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
            [
              row.id,
              row.appid,
              row.source,
              row.observed_at,
              row.first_seen_at,
              row.last_seen_at,
              row.content_hash,
              row.previous_snapshot_id,
              row.trigger_reason,
              row.trigger_cursor,
              JSON.stringify(snapshotSummary(row.snapshot_data)),
              pointer?.bucket ?? null,
              pointer?.key ?? null,
              pointer?.contentHash ?? null,
              pointer?.byteSize ?? null,
              pointer?.contentType ?? null,
            ]
          );

          return {
            archived: pointer ? 1 : 0,
            upserted: 1,
          };
        })
      )
    );

    for (const result of results) {
      stats.archived += result.archived;
      stats.upserted += result.upserted;
    }

    logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
  }

  return stats;
}

async function backfillSteamNewsVersions(params: {
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  limit: number | null;
  minFirstSeenAt: string | null;
  sourcePool: Pool;
  store: ChangeIntelArchiveStore | null;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('steam_news_versions');
  let lastId = '0';

  while (!params.limit || stats.read < params.limit) {
    const remaining = params.limit ? params.limit - stats.read : params.batchSize;
    const batchSize = Math.min(params.batchSize, remaining);
    const { rows } = await params.sourcePool.query<SteamNewsVersionRow>(
      `
        SELECT
          id::text,
          gid,
          content_hash,
          title,
          contents,
          url,
          previous_version_id::text,
          normalized_payload,
          first_seen_at::text,
          last_seen_at::text
        FROM public.steam_news_versions
        WHERE id > $1::bigint
          AND ($2::timestamptz IS NULL OR first_seen_at >= $2::timestamptz)
        ORDER BY id ASC
        LIMIT $3
      `,
      [lastId, params.minFirstSeenAt, batchSize]
    );

    if (rows.length === 0) {
      break;
    }

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (params.dryRun) {
      logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
      continue;
    }

    const limiter = pLimit(params.concurrency);
    const results = await Promise.all(
      rows.map((row) =>
        limiter(async () => {
          const payload = {
            ...row.normalized_payload,
            contents: row.contents,
            gid: row.gid,
            title: row.title,
            url: row.url,
          };
          const pointer = await archivePayload({
            dryRun: params.dryRun,
            kind: 'steam-news-version',
            keyParts: [row.gid, row.id],
            payload,
            store: params.store,
          });

          await params.targetPool.query(
            `
          INSERT INTO docs.steam_news_versions (
            id,
            gid,
            content_hash,
            title,
            contents_excerpt,
            url,
            previous_version_id,
            archive_bucket,
            archive_key,
            archive_content_hash,
            archive_byte_size,
            archive_content_type,
            archived_at,
            first_seen_at,
            last_seen_at
          )
          VALUES (
            $1::bigint,
            $2::text,
            $3::text,
            $4::text,
            $5::text,
            $6::text,
            $7::bigint,
            $8::text,
            $9::text,
            $10::text,
            $11::bigint,
            $12::text,
            CASE WHEN $9::text IS NULL THEN NULL ELSE now() END,
            $13::timestamptz,
            $14::timestamptz
          )
          ON CONFLICT (id) DO UPDATE SET
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
            [
              row.id,
              row.gid,
              row.content_hash,
              row.title,
              truncateText(row.contents, NEWS_EXCERPT_LENGTH),
              row.url,
              row.previous_version_id,
              pointer?.bucket ?? null,
              pointer?.key ?? null,
              pointer?.contentHash ?? null,
              pointer?.byteSize ?? null,
              pointer?.contentType ?? null,
              row.first_seen_at,
              row.last_seen_at,
            ]
          );

          return {
            archived: pointer ? 1 : 0,
            upserted: 1,
          };
        })
      )
    );

    for (const result of results) {
      stats.archived += result.archived;
      stats.upserted += result.upserted;
    }

    logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
  }

  return stats;
}

async function backfillAppMediaVersions(params: {
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  limit: number | null;
  minFirstSeenAt: string | null;
  sourcePool: Pool;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('app_media_versions');
  let lastId = '0';

  while (!params.limit || stats.read < params.limit) {
    const remaining = params.limit ? params.limit - stats.read : params.batchSize;
    const batchSize = Math.min(params.batchSize, remaining);
    const { rows } = await params.sourcePool.query<AppMediaVersionRow>(
      `
        SELECT
          id::text,
          appid,
          storefront_snapshot_id::text,
          content_hash,
          hero_assets,
          screenshots,
          trailers,
          previous_version_id::text,
          first_seen_at::text,
          last_seen_at::text
        FROM public.app_media_versions
        WHERE id > $1::bigint
          AND ($2::timestamptz IS NULL OR first_seen_at >= $2::timestamptz)
        ORDER BY id ASC
        LIMIT $3
      `,
      [lastId, params.minFirstSeenAt, batchSize]
    );

    if (rows.length === 0) {
      break;
    }

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (params.dryRun) {
      logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
      continue;
    }

    const limiter = pLimit(params.concurrency);
    const results = await Promise.all(
      rows.map((row) =>
        limiter(async () => {
          await params.targetPool.query(
            `
          INSERT INTO docs.app_media_versions (
            id,
            appid,
            storefront_snapshot_id,
            content_hash,
            hero_assets,
            screenshots,
            trailers,
            previous_version_id,
            first_seen_at,
            last_seen_at
          )
          VALUES (
            $1::bigint,
            $2::int,
            $3::bigint,
            $4::text,
            $5::jsonb,
            $6::jsonb,
            $7::jsonb,
            $8::bigint,
            $9::timestamptz,
            $10::timestamptz
          )
          ON CONFLICT (id) DO UPDATE SET
            hero_assets = EXCLUDED.hero_assets,
            screenshots = EXCLUDED.screenshots,
            trailers = EXCLUDED.trailers,
            last_seen_at = EXCLUDED.last_seen_at
        `,
            [
              row.id,
              row.appid,
              row.storefront_snapshot_id,
              row.content_hash,
              JSON.stringify(row.hero_assets),
              JSON.stringify(row.screenshots),
              JSON.stringify(row.trailers),
              row.previous_version_id,
              row.first_seen_at,
              row.last_seen_at,
            ]
          );

          return 1;
        })
      )
    );

    stats.upserted += results.reduce((total, value) => total + value, 0);
    logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
  }

  return stats;
}

async function backfillHeroAssetVersions(params: {
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  limit: number | null;
  minFirstSeenAt: string | null;
  sourcePool: Pool;
  targetPool: Pool;
}): Promise<BackfillStats> {
  const stats = emptyStats('app_hero_asset_versions');
  let lastId = '';
  const objectBucket = process.env.CHANGE_INTEL_HERO_ASSET_BUCKET ?? 'steam-hero-assets';

  while (!params.limit || stats.read < params.limit) {
    const remaining = params.limit ? params.limit - stats.read : params.batchSize;
    const batchSize = Math.min(params.batchSize, remaining);
    const { rows } = await params.sourcePool.query<AppHeroAssetVersionRow>(
      `
        SELECT
          id::text,
          appid,
          asset_kind,
          source_url,
          object_key,
          content_hash,
          mime_type,
          content_length,
          width,
          height,
          first_seen_at::text,
          last_seen_at::text,
          created_at::text
        FROM public.app_hero_asset_versions
        WHERE id::text > $1::text
          AND ($2::timestamptz IS NULL OR first_seen_at >= $2::timestamptz)
        ORDER BY id::text ASC
        LIMIT $3
      `,
      [lastId, params.minFirstSeenAt, batchSize]
    );

    if (rows.length === 0) {
      break;
    }

    stats.read += rows.length;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    if (params.dryRun) {
      logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
      continue;
    }

    const limiter = pLimit(params.concurrency);
    const results = await Promise.all(
      rows.map((row) =>
        limiter(async () => {
          await params.targetPool.query(
            `
          INSERT INTO docs.app_hero_asset_versions (
            id,
            appid,
            asset_kind,
            source_url,
            object_bucket,
            object_key,
            content_hash,
            mime_type,
            content_length,
            width,
            height,
            first_seen_at,
            last_seen_at,
            created_at
          )
          VALUES (
            $1::uuid,
            $2::int,
            $3::text,
            $4::text,
            $5::text,
            $6::text,
            $7::text,
            $8::text,
            $9::int,
            $10::int,
            $11::int,
            $12::timestamptz,
            $13::timestamptz,
            $14::timestamptz
          )
          ON CONFLICT (id) DO UPDATE SET
            object_bucket = EXCLUDED.object_bucket,
            object_key = EXCLUDED.object_key,
            last_seen_at = EXCLUDED.last_seen_at
        `,
            [
              row.id,
              row.appid,
              row.asset_kind,
              row.source_url,
              objectBucket,
              row.object_key,
              row.content_hash,
              row.mime_type,
              row.content_length,
              row.width,
              row.height,
              row.first_seen_at,
              row.last_seen_at,
              row.created_at,
            ]
          );

          return 1;
        })
      )
    );

    stats.upserted += results.reduce((total, value) => total + value, 0);
    logSurfaceProgress(stats, { dryRun: params.dryRun, lastId, limit: params.limit });
  }

  return stats;
}

async function main(): Promise<void> {
  const dryRun = readBoolean(process.env.CHANGE_INTEL_TIGER_BACKFILL_DRY_RUN, true);
  const batchSize = readNumber(process.env.CHANGE_INTEL_TIGER_BACKFILL_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const concurrency = Math.min(
    readNumber(process.env.CHANGE_INTEL_TIGER_BACKFILL_CONCURRENCY, DEFAULT_CONCURRENCY),
    MAX_CONCURRENCY
  );
  const minFirstSeenAt = readMinFirstSeenAt();
  const limitValue = process.env.CHANGE_INTEL_TIGER_BACKFILL_LIMIT;
  const limit = limitValue ? readNumber(limitValue, DEFAULT_BATCH_SIZE) : null;
  const sourcePool = new Pool({
    application_name: 'publisheriq-change-intel-tiger-archive-backfill-source',
    connectionString: requireSourceUrl(),
    max: 2,
  });
  const targetPool = new Pool({
    application_name: 'publisheriq-change-intel-tiger-archive-backfill-target',
    connectionString: requireTigerUrl(),
    max: Math.max(2, Math.min(concurrency, 10)),
  });
  const store = dryRun ? null : createChangeIntelArchiveStore();

  if (!dryRun && !store) {
    throw new Error(
      'CHANGE_INTEL_ARCHIVE_TARGET=object_storage is required when CHANGE_INTEL_TIGER_BACKFILL_DRY_RUN=false.'
    );
  }

  try {
    const results: BackfillStats[] = [];
    results.push(
      await backfillAppSourceSnapshots({
        batchSize,
        concurrency,
        dryRun,
        limit,
        minFirstSeenAt,
        sourcePool,
        store,
        targetPool,
      })
    );
    results.push(
      await backfillSteamNewsVersions({
        batchSize,
        concurrency,
        dryRun,
        limit,
        minFirstSeenAt,
        sourcePool,
        store,
        targetPool,
      })
    );
    results.push(
      await backfillAppMediaVersions({
        batchSize,
        concurrency,
        dryRun,
        limit,
        minFirstSeenAt,
        sourcePool,
        targetPool,
      })
    );
    results.push(
      await backfillHeroAssetVersions({
        batchSize,
        concurrency,
        dryRun,
        limit,
        minFirstSeenAt,
        sourcePool,
        targetPool,
      })
    );

    console.log(
      JSON.stringify(
        {
          batchSize,
          concurrency,
          dryRun,
          limit,
          minFirstSeenAt,
          results,
        },
        null,
        2
      )
    );
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
