import { createHash, randomUUID } from 'node:crypto';
import { logger } from '@publisheriq/shared';
import type { TypedSupabaseClient } from '@publisheriq/database';
import { getArchiveEligibility, getLatestMediaVersion } from './repository.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { HeroAssetDescriptor, NormalizedMediaVersion } from './types.js';

const log = logger.child({ component: 'hero-asset-archive' });

const HERO_BUCKET = 'steam-hero-assets';
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const WARN_BYTES = 20 * 1024 * 1024 * 1024;
const TIGHTEN_BYTES = 35 * 1024 * 1024 * 1024;
const PAUSE_BYTES = 50 * 1024 * 1024 * 1024;
const DAILY_DOWNLOAD_BUDGET_BYTES = 10 * 1024 * 1024 * 1024;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

const downloadLimiter = new RateLimiter({ requestsPerSecond: 1, burst: 2 });

interface ImageMeta {
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

function getExtension(url: string, mimeType: string | null): string {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() ?? '';
  const extension = filename.includes('.') ? filename.split('.').pop() ?? '' : '';
  if (extension) {
    return extension.toLowerCase();
  }
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'bin';
}

export async function getRemoteAssetContentHash(url: string): Promise<string | null> {
  await downloadLimiter.acquire();

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  return createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
}

function parsePng(buffer: Buffer): ImageMeta {
  if (buffer.length < 24) {
    return { width: null, height: null, mimeType: 'image/png' };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    mimeType: 'image/png',
  };
}

function parseJpeg(buffer: Buffer): ImageMeta {
  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      break;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        mimeType: 'image/jpeg',
      };
    }

    offset += 2 + length;
  }

  return { width: null, height: null, mimeType: 'image/jpeg' };
}

function parseWebp(buffer: Buffer): ImageMeta {
  if (buffer.length < 30) {
    return { width: null, height: null, mimeType: 'image/webp' };
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      mimeType: 'image/webp',
    };
  }

  return { width: null, height: null, mimeType: 'image/webp' };
}

export function readImageMeta(buffer: Buffer, contentType: string | null): ImageMeta {
  if (contentType === 'image/png' || buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return parsePng(buffer);
  }

  if (contentType === 'image/jpeg' || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
    return parseJpeg(buffer);
  }

  if (
    contentType === 'image/webp' ||
    (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
  ) {
    return parseWebp(buffer);
  }

  return { width: null, height: null, mimeType: contentType };
}

export function extractHeroAssets(mediaVersion: NormalizedMediaVersion | null): HeroAssetDescriptor[] {
  if (!mediaVersion) {
    return [];
  }

  const candidates: Array<HeroAssetDescriptor | null> = [
    mediaVersion.heroImages.header ? { kind: 'header', url: mediaVersion.heroImages.header } : null,
    mediaVersion.heroImages.capsule ? { kind: 'capsule', url: mediaVersion.heroImages.capsule } : null,
  ];

  return candidates.filter((candidate): candidate is HeroAssetDescriptor => Boolean(candidate));
}

export class HeroAssetArchiver {
  private downloadedTodayBytes = 0;
  private usageCache: { bytes: number; fetchedAt: number } | null = null;

  constructor(private readonly supabase: TypedSupabaseClient) {}

  private async getBucketUsageBytes(): Promise<number> {
    if (this.usageCache && Date.now() - this.usageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
      return this.usageCache.bytes;
    }

    const db = this.supabase as any;
    const { data, error } = await db.rpc('get_storage_bucket_usage_bytes', {
      p_bucket_id: HERO_BUCKET,
    });

    if (error) {
      log.warn('Failed to query storage usage', { error: error.message });
      const fallbackBytes = this.usageCache?.bytes ?? 0;
      this.usageCache = { bytes: fallbackBytes, fetchedAt: Date.now() };
      return fallbackBytes;
    }

    const bytes = Number(data ?? 0);
    if (!Number.isFinite(bytes)) {
      log.warn('Received invalid storage usage value', { data });
      const fallbackBytes = this.usageCache?.bytes ?? 0;
      this.usageCache = { bytes: fallbackBytes, fetchedAt: Date.now() };
      return fallbackBytes;
    }

    this.usageCache = { bytes, fetchedAt: Date.now() };
    return bytes;
  }

  private async shouldArchive(appid: number): Promise<boolean> {
    const eligible = await getArchiveEligibility(this.supabase, appid);
    if (!eligible) {
      return false;
    }

    const bucketBytes = await this.getBucketUsageBytes();
    if (bucketBytes >= PAUSE_BYTES) {
      log.warn('Hero asset archival paused at hard cap', { appid, bucketBytes });
      return false;
    }

    if (bucketBytes >= TIGHTEN_BYTES) {
      log.warn('Hero asset archival in tightened mode', { appid, bucketBytes });
    } else if (bucketBytes >= WARN_BYTES) {
      log.warn('Hero asset archival warning threshold reached', { appid, bucketBytes });
    }

    if (this.downloadedTodayBytes >= DAILY_DOWNLOAD_BUDGET_BYTES) {
      log.warn('Hero asset archival daily budget reached', { appid, downloadedTodayBytes: this.downloadedTodayBytes });
      return false;
    }

    return true;
  }

  private async uploadAsset(appid: number, asset: HeroAssetDescriptor): Promise<void> {
    await downloadLimiter.acquire();

    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${asset.kind} asset: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > MAX_ASSET_BYTES) {
      log.warn('Skipping oversized hero asset', { appid, kind: asset.kind, bytes: buffer.byteLength });
      return;
    }

    if (this.downloadedTodayBytes + buffer.byteLength > DAILY_DOWNLOAD_BUDGET_BYTES) {
      log.warn('Skipping hero asset due to daily download budget', { appid, kind: asset.kind, bytes: buffer.byteLength });
      return;
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const contentType = response.headers.get('content-type');
    const meta = readImageMeta(buffer, contentType);
    const extension = getExtension(asset.url, meta.mimeType);
    const objectPath = `${asset.kind}/${sha256}.${extension}`;

    const storage = this.supabase.storage.from(HERO_BUCKET);
    const { error: uploadError } = await storage.upload(objectPath, buffer, {
      contentType: meta.mimeType ?? 'application/octet-stream',
      upsert: false,
    });

    if (uploadError && !String(uploadError.message).toLowerCase().includes('already exists')) {
      throw uploadError;
    }

    const db = this.supabase as any;
    const now = new Date().toISOString();
    const { data: existingVersion, error: existingVersionError } = await db
      .from('app_hero_asset_versions')
      .select('id')
      .eq('appid', appid)
      .eq('asset_kind', asset.kind)
      .eq('content_hash', sha256)
      .maybeSingle();

    if (existingVersionError) {
      throw new Error(`Failed to fetch app_hero_asset_versions: ${existingVersionError.message}`);
    }

    if (existingVersion) {
      const { error: updateError } = await db
        .from('app_hero_asset_versions')
        .update({
          source_url: asset.url,
          object_key: objectPath,
          mime_type: meta.mimeType,
          content_length: buffer.byteLength,
          width: meta.width,
          height: meta.height,
          last_seen_at: now,
        })
        .eq('id', existingVersion.id);

      if (updateError) {
        throw new Error(`Failed to update app_hero_asset_versions: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await db.from('app_hero_asset_versions').insert({
        id: randomUUID(),
        appid,
        asset_kind: asset.kind,
        source_url: asset.url,
        object_key: objectPath,
        content_hash: sha256,
        mime_type: meta.mimeType,
        content_length: buffer.byteLength,
        width: meta.width,
        height: meta.height,
        first_seen_at: now,
        last_seen_at: now,
      });

      if (insertError) {
        throw new Error(`Failed to insert app_hero_asset_versions: ${insertError.message}`);
      }
    }

    this.downloadedTodayBytes += buffer.byteLength;
  }

  async archiveLatestAssetsForApp(appid: number): Promise<void> {
    if (!(await this.shouldArchive(appid))) {
      return;
    }

    const latestMediaVersion = await getLatestMediaVersion(this.supabase, appid);
    const assets = extractHeroAssets(latestMediaVersion);

    for (const asset of assets) {
      await this.uploadAsset(appid, asset);
    }
  }
}
