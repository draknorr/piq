import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function main(): Promise<void> {
  const outputPath = requireEnv('R2_MANIFEST_OUTPUT');
  const prefix = process.env.CHANGE_INTEL_ARCHIVE_PREFIX?.trim() || 'change-intel';
  const bucket = requireEnv('CHANGE_INTEL_ARCHIVE_BUCKET');
  const client = new S3Client({
    credentials: {
      accessKeyId: requireEnv('CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY'),
    },
    endpoint: requireEnv('CHANGE_INTEL_ARCHIVE_ENDPOINT'),
    forcePathStyle: parseBoolean(process.env.CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE, true),
    region: process.env.CHANGE_INTEL_ARCHIVE_REGION?.trim() || 'auto',
  });

  const metadataHash = createHash('sha256');
  const groups: Record<string, number> = {};
  let continuationToken: string | undefined;
  let latestModifiedAt: string | null = null;
  let latestModifiedAtMs = Number.NEGATIVE_INFINITY;
  let objects = 0;
  let pages = 0;
  let totalBytes = 0;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
        Prefix: prefix,
      })
    );

    pages += 1;
    for (const object of response.Contents ?? []) {
      const key = object.Key ?? '';
      const modifiedAtMs = object.LastModified?.getTime() ?? Number.NEGATIVE_INFINITY;
      const modifiedAt = object.LastModified?.toISOString() ?? '';
      const size = object.Size ?? 0;
      const relativeKey = key.slice(prefix.length).replace(/^\/+/, '');
      const group = relativeKey.split('/')[0] || '(root)';

      groups[group] = (groups[group] ?? 0) + 1;
      if (modifiedAtMs > latestModifiedAtMs) {
        latestModifiedAt = modifiedAt;
        latestModifiedAtMs = modifiedAtMs;
      }
      metadataHash.update(`${key}\0${object.ETag ?? ''}\0${size}\0${modifiedAt}\n`);
      objects += 1;
      totalBytes += size;
    }

    if (pages % 100 === 0) {
      process.stderr.write(`Listed ${pages} pages and ${objects} objects\n`);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  const manifest = {
    capturedAt: new Date().toISOString(),
    completed: true,
    groups: Object.fromEntries(
      Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
    ),
    latestModifiedAt,
    metadataSha256: metadataHash.digest('hex'),
    objects,
    pages,
    prefix,
    schemaVersion: 1,
    totalBytes,
  };

  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
