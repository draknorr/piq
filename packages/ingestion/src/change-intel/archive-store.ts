import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { readChangeIntelRuntimeConfig } from './runtime-config.js';

export type ChangeIntelArchiveKind =
  | 'app-source-snapshot'
  | 'change-event-evidence'
  | 'hero-asset'
  | 'steam-news-version';

export interface ArchivePayload {
  body: Buffer | string;
  contentHash?: string;
  contentType: string;
  extension?: string;
  keyParts?: string[];
  kind: ChangeIntelArchiveKind;
}

export interface ArchivePointer {
  bucket: string;
  byteSize: number;
  contentHash: string;
  contentType: string;
  key: string;
}

export interface ChangeIntelArchiveStore {
  read(pointer: Pick<ArchivePointer, 'bucket' | 'key'>): Promise<Buffer>;
  write(payload: ArchivePayload): Promise<ArchivePointer>;
}

interface S3ArchiveConfig {
  accessKeyId?: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretAccessKey?: string;
}

function toBuffer(body: Buffer | string): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function sanitizeKeyPart(part: string): string {
  return part
    .trim()
    .replace(/[^A-Za-z0-9._=-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function todayKeyPrefix(now = new Date()): string {
  return [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('/');
}

function buildArchiveKey(params: {
  contentHash: string;
  extension?: string;
  keyParts?: string[];
  kind: ChangeIntelArchiveKind;
  prefix: string;
}): string {
  const extension = params.extension?.trim().replace(/^\./, '') || 'json';
  const keyParts = (params.keyParts ?? [])
    .map(sanitizeKeyPart)
    .filter((part) => part.length > 0);

  return [
    params.prefix,
    params.kind,
    todayKeyPrefix(),
    ...keyParts,
    `${params.contentHash}.${extension}`,
  ]
    .filter((part) => part.length > 0)
    .join('/');
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return Buffer.from(await body.transformToByteArray());
  }

  throw new Error('Unsupported archive object body returned by S3 client.');
}

export class S3ChangeIntelArchiveStore implements ChangeIntelArchiveStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3ArchiveConfig) {
    this.client = new S3Client({
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });
  }

  async write(payload: ArchivePayload): Promise<ArchivePointer> {
    const body = toBuffer(payload.body);
    const contentHash = payload.contentHash ?? hashBuffer(body);
    const key = buildArchiveKey({
      contentHash,
      extension: payload.extension,
      keyParts: payload.keyParts,
      kind: payload.kind,
      prefix: this.config.prefix,
    });

    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.config.bucket,
        ContentType: payload.contentType,
        Key: key,
      })
    );

    return {
      bucket: this.config.bucket,
      byteSize: body.byteLength,
      contentHash,
      contentType: payload.contentType,
      key,
    };
  }

  async read(pointer: Pick<ArchivePointer, 'bucket' | 'key'>): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: pointer.bucket,
        Key: pointer.key,
      })
    );

    return streamToBuffer(response.Body);
  }
}

export function createChangeIntelArchiveStore(
  env: NodeJS.ProcessEnv = process.env
): ChangeIntelArchiveStore | null {
  const runtimeConfig = readChangeIntelRuntimeConfig(env);
  if (runtimeConfig.archiveTarget !== 'object_storage') {
    return null;
  }

  const bucket = env.CHANGE_INTEL_ARCHIVE_BUCKET ?? env.CHANGE_INTEL_ARCHIVE_S3_BUCKET;
  if (!bucket) {
    throw new Error(
      'CHANGE_INTEL_ARCHIVE_TARGET=object_storage requires CHANGE_INTEL_ARCHIVE_BUCKET.'
    );
  }

  return new S3ChangeIntelArchiveStore({
    accessKeyId: env.CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID,
    bucket,
    endpoint: env.CHANGE_INTEL_ARCHIVE_ENDPOINT,
    forcePathStyle: env.CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE !== 'false',
    prefix: env.CHANGE_INTEL_ARCHIVE_PREFIX ?? 'change-intel',
    region: env.CHANGE_INTEL_ARCHIVE_REGION ?? 'us-east-1',
    secretAccessKey: env.CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY,
  });
}

export async function archiveJsonPayload(params: {
  kind: ChangeIntelArchiveKind;
  keyParts?: string[];
  payload: unknown;
  store?: ChangeIntelArchiveStore | null;
}): Promise<ArchivePointer | null> {
  const store = params.store ?? createChangeIntelArchiveStore();
  if (!store) {
    return null;
  }

  const body = JSON.stringify(params.payload);
  return store.write({
    body,
    contentType: 'application/json',
    extension: 'json',
    keyParts: params.keyParts,
    kind: params.kind,
  });
}
