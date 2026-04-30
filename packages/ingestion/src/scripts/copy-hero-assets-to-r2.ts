import { createHash } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import pLimit from 'p-limit';

const DEFAULT_SOURCE_BUCKET = 'steam-hero-assets';
const DEFAULT_SOURCE_REGION = 'us-west-2';
const DEFAULT_DESTINATION_REGION = 'auto';
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 64;
const DEFAULT_PROGRESS_INTERVAL = 250;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

type Mode = 'inventory' | 'copy' | 'delta-copy' | 'verify';

interface StorageObject {
  key: string;
  lastModified?: Date;
  size: number;
}

interface CopyStats {
  copied: number;
  destinationExisting: number;
  destinationMismatched: number;
  failed: number;
  processed: number;
  readBytes: number;
  sourceObjects: number;
  verified: number;
  wouldCopy: number;
  writtenBytes: number;
}

interface InventoryStats {
  bytes: number;
  objects: number;
}

interface CopyConfig {
  concurrency: number;
  destination: S3EndpointConfig;
  dryRun: boolean;
  keys: string[];
  limit: number | null;
  maxAttempts: number;
  mode: Mode;
  overwriteMismatches: boolean;
  prefixes: string[];
  progressInterval: number;
  requestTimeoutMs: number;
  source: S3EndpointConfig;
  verifyHash: boolean;
}

interface S3EndpointConfig {
  accessKeyId?: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey?: string;
}

interface VerificationResult {
  bytes: number;
  key: string;
  ok: boolean;
  reason?: string;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readNullableNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('HERO_ASSET_R2_COPY_LIMIT must be a positive number when set.');
  }

  return Math.floor(parsed);
}

function readList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '');
  if (!trimmed) {
    return '';
  }

  if (trimmed.endsWith('*')) {
    return trimmed.slice(0, -1);
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

function readMode(): Mode {
  const value = process.env.HERO_ASSET_R2_COPY_MODE?.trim().toLowerCase() || 'inventory';
  if (value === 'inventory' || value === 'copy' || value === 'delta-copy' || value === 'verify') {
    return value;
  }

  throw new Error('HERO_ASSET_R2_COPY_MODE must be inventory, copy, delta-copy, or verify.');
}

function assertSupabaseEndpointIsBucketless(endpoint: string, bucket: string): void {
  const normalizedEndpoint = endpoint.replace(/\/+$/, '');
  if (normalizedEndpoint.endsWith(`/${bucket}`)) {
    throw new Error(
      [
        'Supabase Storage S3 endpoint must not include the bucket name.',
        `Use ${normalizedEndpoint.slice(0, -bucket.length - 1)} with bucket ${bucket}.`,
      ].join(' ')
    );
  }
}

function readConfig(): CopyConfig {
  const sourceBucket =
    process.env.SUPABASE_STORAGE_S3_BUCKET ??
    process.env.CHANGE_INTEL_HERO_ASSET_BUCKET ??
    DEFAULT_SOURCE_BUCKET;
  const sourceEndpoint = requireEnv('SUPABASE_STORAGE_S3_ENDPOINT');
  assertSupabaseEndpointIsBucketless(sourceEndpoint, sourceBucket);

  const concurrency = Math.min(
    readNumber(process.env.HERO_ASSET_R2_COPY_CONCURRENCY, DEFAULT_CONCURRENCY),
    MAX_CONCURRENCY
  );

  return {
    concurrency,
    destination: {
      accessKeyId: process.env.CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID,
      bucket: requireEnv('CHANGE_INTEL_ARCHIVE_BUCKET'),
      endpoint: requireEnv('CHANGE_INTEL_ARCHIVE_ENDPOINT'),
      forcePathStyle: process.env.CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE !== 'false',
      region: process.env.CHANGE_INTEL_ARCHIVE_REGION ?? DEFAULT_DESTINATION_REGION,
      secretAccessKey: process.env.CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY,
    },
    dryRun: readBoolean(process.env.HERO_ASSET_R2_COPY_DRY_RUN, true),
    keys: readList(process.env.HERO_ASSET_R2_COPY_KEYS),
    limit: readNullableNumber(process.env.HERO_ASSET_R2_COPY_LIMIT),
    maxAttempts: readNumber(process.env.HERO_ASSET_R2_COPY_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    mode: readMode(),
    overwriteMismatches: readBoolean(process.env.HERO_ASSET_R2_COPY_OVERWRITE_MISMATCHES, false),
    prefixes: readList(process.env.HERO_ASSET_R2_COPY_PREFIXES).map(normalizePrefix),
    progressInterval: readNumber(process.env.HERO_ASSET_R2_COPY_PROGRESS_INTERVAL, DEFAULT_PROGRESS_INTERVAL),
    requestTimeoutMs: readNumber(process.env.HERO_ASSET_R2_COPY_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    source: {
      accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID,
      bucket: sourceBucket,
      endpoint: sourceEndpoint,
      forcePathStyle: true,
      region: process.env.SUPABASE_STORAGE_S3_REGION ?? DEFAULT_SOURCE_REGION,
      secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY,
    },
    verifyHash: readBoolean(process.env.HERO_ASSET_R2_COPY_VERIFY_HASH, false),
  };
}

function createClient(config: S3EndpointConfig): S3Client {
  return new S3Client({
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

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const maybeError = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return (
    maybeError.$metadata?.httpStatusCode === 404 ||
    maybeError.name === 'NotFound' ||
    maybeError.name === 'NoSuchKey'
  );
}

function timeoutOptions(timeoutMs: number): { abortSignal: AbortSignal } {
  return {
    abortSignal: AbortSignal.timeout(timeoutMs),
  };
}

async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<HeadObjectCommandOutput | null> {
  try {
    return await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      timeoutOptions(timeoutMs)
    );
  } catch (error) {
    if (isMissingObjectError(error)) {
      return null;
    }

    throw error;
  }
}

function toStorageObject(object: _Object): StorageObject | null {
  if (!object.Key) {
    return null;
  }

  return {
    key: object.Key,
    lastModified: object.LastModified,
    size: object.Size ?? 0,
  };
}

async function* listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): AsyncGenerator<StorageObject> {
  let continuationToken: string | undefined;

  do {
    let response: ListObjectsV2CommandOutput | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
            Prefix: prefix || undefined,
          }),
          timeoutOptions(timeoutMs)
        );
        break;
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        logProgress('list-retry', {
          attempt,
          continuationToken: continuationToken ? 'present' : null,
          maxAttempts,
          message: errorMessage(error),
          prefix,
        });
        await sleep(retryDelayMs(attempt));
      }
    }

    if (!response) {
      throw new Error(`Failed to list objects for prefix ${prefix}.`);
    }

    for (const object of response.Contents ?? []) {
      const storageObject = toStorageObject(object);
      if (storageObject) {
        yield storageObject;
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
}

function destroyBody(body: GetObjectCommandOutput['Body'], error: Error): void {
  if (
    body &&
    typeof body === 'object' &&
    'destroy' in body &&
    typeof body.destroy === 'function'
  ) {
    body.destroy(error);
  }
}

async function withTimeout<T>(params: {
  action: () => Promise<T>;
  onTimeout?: (error: Error) => void;
  timeoutMs: number;
}): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      params.action(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`Timed out after ${params.timeoutMs}ms.`);
          params.onTimeout?.(error);
          reject(error);
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function bodyToBuffer(
  body: GetObjectCommandOutput['Body'],
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  const read = async (): Promise<Buffer> => {
    if (
      typeof body === 'object' &&
      'transformToByteArray' in body &&
      typeof body.transformToByteArray === 'function'
    ) {
      return Buffer.from(await body.transformToByteArray());
    }

    if (Symbol.asyncIterator in Object(body)) {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    }

    throw new Error('Unsupported S3 response body type.');
  };

  return withTimeout({
    action: read,
    onTimeout: (error) => destroyBody(body, error),
    timeoutMs,
  });
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function topLevelPrefix(key: string): string {
  const index = key.indexOf('/');
  return index === -1 ? '' : key.slice(0, index + 1);
}

function addInventory(stats: Map<string, InventoryStats>, key: string, bytes: number): void {
  const prefix = topLevelPrefix(key);
  const current = stats.get(prefix) ?? { bytes: 0, objects: 0 };
  current.bytes += bytes;
  current.objects += 1;
  stats.set(prefix, current);
}

async function readSourceObjects(params: {
  client: S3Client;
  config: CopyConfig;
}): Promise<StorageObject[]> {
  if (params.config.keys.length > 0) {
    const objects: StorageObject[] = [];
    for (const key of params.config.keys) {
      const head = await headObject(
        params.client,
        params.config.source.bucket,
        key,
        params.config.requestTimeoutMs
      );
      if (!head) {
        throw new Error(`Source key not found: ${key}`);
      }

      objects.push({
        key,
        lastModified: head.LastModified,
        size: head.ContentLength ?? 0,
      });
    }

    return params.config.limit ? objects.slice(0, params.config.limit) : objects;
  }

  const prefixes = params.config.prefixes.length > 0 ? params.config.prefixes : [''];
  const objects: StorageObject[] = [];
  for (const prefix of prefixes) {
    for await (const object of listObjects(
      params.client,
      params.config.source.bucket,
      prefix,
      params.config.requestTimeoutMs,
      params.config.maxAttempts
    )) {
      objects.push(object);
      if (params.config.limit && objects.length >= params.config.limit) {
        return objects;
      }
    }
  }

  return objects;
}

function logProgress(event: string, payload: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...payload }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelayMs(attempt: number): number {
  const baseDelay = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return baseDelay + Math.floor(Math.random() * 250);
}

async function withObjectRetries<T>(params: {
  action: () => Promise<T>;
  config: CopyConfig;
  key: string;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= params.config.maxAttempts; attempt += 1) {
    try {
      return await params.action();
    } catch (error) {
      lastError = error;
      if (attempt >= params.config.maxAttempts) {
        break;
      }

      logProgress('copy-retry', {
        attempt,
        key: params.key,
        maxAttempts: params.config.maxAttempts,
        message: errorMessage(error),
      });
      await sleep(retryDelayMs(attempt));
    }
  }

  throw lastError;
}

async function copyOneObject(params: {
  config: CopyConfig;
  destinationClient: S3Client;
  object: StorageObject;
  sourceClient: S3Client;
}): Promise<Pick<CopyStats, 'copied' | 'destinationExisting' | 'destinationMismatched' | 'failed' | 'readBytes' | 'verified' | 'wouldCopy' | 'writtenBytes'>> {
  const key = params.object.key;
  const destinationHead = await headObject(
    params.destinationClient,
    params.config.destination.bucket,
    key,
    params.config.requestTimeoutMs
  );

  if (destinationHead) {
    const destinationSize = destinationHead.ContentLength ?? 0;
    if (destinationSize === params.object.size) {
      return {
        copied: 0,
        destinationExisting: 1,
        destinationMismatched: 0,
        failed: 0,
        readBytes: 0,
        verified: 0,
        wouldCopy: 0,
        writtenBytes: 0,
      };
    }

    if (!params.config.overwriteMismatches) {
      logProgress('destination-size-mismatch', {
        destinationSize,
        key,
        sourceSize: params.object.size,
      });

      return {
        copied: 0,
        destinationExisting: 0,
        destinationMismatched: 1,
        failed: 0,
        readBytes: 0,
        verified: 0,
        wouldCopy: 0,
        writtenBytes: 0,
      };
    }
  }

  if (params.config.dryRun) {
    return {
      copied: 0,
      destinationExisting: 0,
      destinationMismatched: 0,
      failed: 0,
      readBytes: 0,
      verified: 0,
      wouldCopy: 1,
      writtenBytes: 0,
    };
  }

  const source = await params.sourceClient.send(
    new GetObjectCommand({
      Bucket: params.config.source.bucket,
      Key: key,
    }),
    timeoutOptions(params.config.requestTimeoutMs)
  );
  const body = await bodyToBuffer(source.Body, params.config.requestTimeoutMs);
  const sourceHash = params.config.verifyHash ? hashBuffer(body) : null;

  await params.destinationClient.send(
    new PutObjectCommand({
      Body: body,
      Bucket: params.config.destination.bucket,
      CacheControl: source.CacheControl,
      ContentDisposition: source.ContentDisposition,
      ContentEncoding: source.ContentEncoding,
      ContentLanguage: source.ContentLanguage,
      ContentType: source.ContentType,
      Expires: source.Expires,
      Key: key,
      Metadata: source.Metadata,
    }),
    timeoutOptions(params.config.requestTimeoutMs)
  );

  let verified = 0;
  if (params.config.verifyHash && sourceHash) {
    const destination = await params.destinationClient.send(
      new GetObjectCommand({
        Bucket: params.config.destination.bucket,
        Key: key,
      }),
      timeoutOptions(params.config.requestTimeoutMs)
    );
    const destinationBody = await bodyToBuffer(destination.Body, params.config.requestTimeoutMs);
    const destinationHash = hashBuffer(destinationBody);
    if (destinationHash !== sourceHash) {
      throw new Error(`Hash mismatch after copy for ${key}.`);
    }
    verified = 1;
  }

  return {
    copied: 1,
    destinationExisting: 0,
    destinationMismatched: 0,
    failed: 0,
    readBytes: body.byteLength,
    verified,
    wouldCopy: 0,
    writtenBytes: body.byteLength,
  };
}

async function runInventory(params: {
  config: CopyConfig;
  destinationClient: S3Client;
  sourceClient: S3Client;
}): Promise<void> {
  const sourceObjects = await readSourceObjects({
    client: params.sourceClient,
    config: params.config,
  });
  const sourceStats = new Map<string, InventoryStats>();
  for (const object of sourceObjects) {
    addInventory(sourceStats, object.key, object.size);
  }

  const destinationStats = new Map<string, InventoryStats>();
  const destinationPrefixes =
    params.config.prefixes.length > 0
      ? params.config.prefixes
      : [...new Set(sourceObjects.map((object) => topLevelPrefix(object.key)))];

  for (const prefix of destinationPrefixes) {
    for await (const object of listObjects(
      params.destinationClient,
      params.config.destination.bucket,
      prefix,
      params.config.requestTimeoutMs,
      params.config.maxAttempts
    )) {
      addInventory(destinationStats, object.key, object.size);
    }
  }

  console.log(
    JSON.stringify(
      {
        destination: Object.fromEntries(destinationStats),
        dryRun: true,
        limited: params.config.limit !== null,
        mode: 'inventory',
        source: Object.fromEntries(sourceStats),
      },
      null,
      2
    )
  );
}

async function runCopy(params: {
  config: CopyConfig;
  destinationClient: S3Client;
  sourceClient: S3Client;
}): Promise<void> {
  const limiter = pLimit(params.config.concurrency);
  const stats: CopyStats = {
    copied: 0,
    destinationExisting: 0,
    destinationMismatched: 0,
    failed: 0,
    processed: 0,
    readBytes: 0,
    sourceObjects: 0,
    verified: 0,
    wouldCopy: 0,
    writtenBytes: 0,
  };

  async function processBatch(batch: StorageObject[]): Promise<void> {
    await Promise.all(
      batch.map((object) =>
        limiter(async () => {
          try {
            const delta = await withObjectRetries({
              action: () =>
                copyOneObject({
                  config: params.config,
                  destinationClient: params.destinationClient,
                  object,
                  sourceClient: params.sourceClient,
                }),
              config: params.config,
              key: object.key,
            });
            stats.copied += delta.copied;
            stats.destinationExisting += delta.destinationExisting;
            stats.destinationMismatched += delta.destinationMismatched;
            stats.failed += delta.failed;
            stats.readBytes += delta.readBytes;
            stats.verified += delta.verified;
            stats.wouldCopy += delta.wouldCopy;
            stats.writtenBytes += delta.writtenBytes;
          } catch (error) {
            stats.failed += 1;
            logProgress('copy-error', {
              key: object.key,
              message: errorMessage(error),
            });
          } finally {
            stats.processed += 1;
            if (stats.processed % params.config.progressInterval === 0) {
              logProgress('copy-progress', {
                copied: stats.copied,
                destinationExisting: stats.destinationExisting,
                failed: stats.failed,
                listed: stats.sourceObjects,
                processed: stats.processed,
                wouldCopy: stats.wouldCopy,
              });
            }
          }
        })
      )
    );
  }

  if (params.config.keys.length > 0) {
    const sourceObjects = await readSourceObjects({
      client: params.sourceClient,
      config: params.config,
    });
    stats.sourceObjects = sourceObjects.length;
    await processBatch(sourceObjects);
  } else {
    const prefixes = params.config.prefixes.length > 0 ? params.config.prefixes : [''];
    const batchSize = params.config.concurrency * 25;
    const batch: StorageObject[] = [];

    for (const prefix of prefixes) {
      for await (const object of listObjects(
        params.sourceClient,
        params.config.source.bucket,
        prefix,
        params.config.requestTimeoutMs,
        params.config.maxAttempts
      )) {
        batch.push(object);
        stats.sourceObjects += 1;

        if (stats.sourceObjects % params.config.progressInterval === 0) {
          logProgress('list-progress', {
            listed: stats.sourceObjects,
            prefix,
            processed: stats.processed,
          });
        }

        if (batch.length >= batchSize) {
          await processBatch(batch.splice(0, batch.length));
        }

        if (params.config.limit && stats.sourceObjects >= params.config.limit) {
          break;
        }
      }

      if (params.config.limit && stats.sourceObjects >= params.config.limit) {
        break;
      }
    }

    if (batch.length > 0) {
      await processBatch(batch);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: params.config.dryRun,
        mode: 'copy',
        stats,
      },
      null,
      2
    )
  );

  if (stats.failed > 0 || stats.destinationMismatched > 0) {
    process.exitCode = 1;
  }
}

async function runDeltaCopy(params: {
  config: CopyConfig;
  destinationClient: S3Client;
  sourceClient: S3Client;
}): Promise<void> {
  const sourceObjects = await readSourceObjects({
    client: params.sourceClient,
    config: params.config,
  });
  const destinationByKey = new Map<string, StorageObject>();

  if (params.config.keys.length > 0) {
    for (const object of sourceObjects) {
      const head = await headObject(
        params.destinationClient,
        params.config.destination.bucket,
        object.key,
        params.config.requestTimeoutMs
      );
      if (head) {
        destinationByKey.set(object.key, {
          key: object.key,
          lastModified: head.LastModified,
          size: head.ContentLength ?? 0,
        });
      }
    }
  } else {
    const destinationPrefixes =
      params.config.prefixes.length > 0
        ? params.config.prefixes
        : [...new Set(sourceObjects.map((object) => topLevelPrefix(object.key)))];

    for (const prefix of destinationPrefixes) {
      for await (const object of listObjects(
        params.destinationClient,
        params.config.destination.bucket,
        prefix,
        params.config.requestTimeoutMs,
        params.config.maxAttempts
      )) {
        destinationByKey.set(object.key, object);
      }
    }
  }

  const candidates = sourceObjects.filter((object) => {
    const destination = destinationByKey.get(object.key);
    return !destination || destination.size !== object.size;
  });
  const missing = candidates.filter((object) => !destinationByKey.has(object.key)).length;
  const mismatched = candidates.length - missing;

  logProgress('delta-copy-candidates', {
    candidates: candidates.length,
    missing,
    mismatched,
    sourceObjects: sourceObjects.length,
  });

  const previousKeys = params.config.keys;
  params.config.keys = candidates.map((object) => object.key);
  try {
    await runCopy(params);
  } finally {
    params.config.keys = previousKeys;
  }
}

async function verifyOneObject(params: {
  destinationClient: S3Client;
  destinationConfig: S3EndpointConfig;
  object: StorageObject;
  sourceClient: S3Client;
  sourceConfig: S3EndpointConfig;
  timeoutMs: number;
}): Promise<VerificationResult> {
  const destinationHead = await headObject(
    params.destinationClient,
    params.destinationConfig.bucket,
    params.object.key,
    params.timeoutMs
  );
  if (!destinationHead) {
    return {
      bytes: params.object.size,
      key: params.object.key,
      ok: false,
      reason: 'missing-destination',
    };
  }

  const destinationSize = destinationHead.ContentLength ?? 0;
  if (destinationSize !== params.object.size) {
    return {
      bytes: params.object.size,
      key: params.object.key,
      ok: false,
      reason: `size-mismatch source=${params.object.size} destination=${destinationSize}`,
    };
  }

  const source = await params.sourceClient.send(
    new GetObjectCommand({
      Bucket: params.sourceConfig.bucket,
      Key: params.object.key,
    }),
    timeoutOptions(params.timeoutMs)
  );
  const destination = await params.destinationClient.send(
    new GetObjectCommand({
      Bucket: params.destinationConfig.bucket,
      Key: params.object.key,
    }),
    timeoutOptions(params.timeoutMs)
  );
  const sourceHash = hashBuffer(await bodyToBuffer(source.Body, params.timeoutMs));
  const destinationHash = hashBuffer(await bodyToBuffer(destination.Body, params.timeoutMs));

  return {
    bytes: params.object.size,
    key: params.object.key,
    ok: sourceHash === destinationHash,
    reason: sourceHash === destinationHash ? undefined : 'hash-mismatch',
  };
}

async function runVerify(params: {
  config: CopyConfig;
  destinationClient: S3Client;
  sourceClient: S3Client;
}): Promise<void> {
  const sourceObjects = await readSourceObjects({
    client: params.sourceClient,
    config: params.config,
  });
  const limiter = pLimit(params.config.concurrency);
  const results = await Promise.all(
    sourceObjects.map((object) =>
      limiter(() =>
        verifyOneObject({
          destinationClient: params.destinationClient,
          destinationConfig: params.config.destination,
          object,
          sourceClient: params.sourceClient,
          sourceConfig: params.config.source,
          timeoutMs: params.config.requestTimeoutMs,
        })
      )
    )
  );
  const failures = results.filter((result) => !result.ok);

  console.log(
    JSON.stringify(
      {
        failures,
        mode: 'verify',
        verified: results.length - failures.length,
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const sourceClient = createClient(config.source);
  const destinationClient = createClient(config.destination);

  logProgress('config', {
    concurrency: config.concurrency,
    destinationBucket: config.destination.bucket,
    dryRun: config.dryRun,
    keyCount: config.keys.length,
    limit: config.limit,
    mode: config.mode,
    prefixes: config.prefixes,
    sourceBucket: config.source.bucket,
    sourceEndpoint: config.source.endpoint,
  });

  if (config.mode === 'inventory') {
    await runInventory({ config, destinationClient, sourceClient });
    return;
  }

  if (config.mode === 'copy') {
    await runCopy({ config, destinationClient, sourceClient });
    return;
  }

  if (config.mode === 'delta-copy') {
    await runDeltaCopy({ config, destinationClient, sourceClient });
    return;
  }

  await runVerify({ config, destinationClient, sourceClient });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
