import assert from 'node:assert/strict';
import test from 'node:test';
import type { TypedSupabaseClient } from '@publisheriq/database';
import {
  buildHeroAssetArchiveKey,
  buildHeroAssetObjectPath,
  extractHeroAssets,
  HeroAssetArchiver,
  isRetryableHeroAssetStorageErrorMessage,
  readImageMeta,
} from './hero-archive.js';

function createJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01]);
}

function createFetchStub(
  plans: Record<string, Array<Response | Error>>
): typeof globalThis.fetch {
  const attempts = new Map<string, number>();

  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const plan = plans[url];
    if (!plan || plan.length === 0) {
      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }

    const attempt = attempts.get(url) ?? 0;
    attempts.set(url, attempt + 1);
    const result = plan[Math.min(attempt, plan.length - 1)];
    if (result instanceof Error) {
      throw result;
    }

    return result;
  }) as typeof globalThis.fetch;
}

function createSupabaseMock(options: {
  mediaVersion: {
    heroImages: {
      header: string | null;
      capsule: string | null;
      background: string | null;
    };
  };
  uploadPlans?: Partial<Record<'header' | 'capsule', Array<{ error: { message: string } | null }>>>;
}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const updatedRows: Array<Record<string, unknown>> = [];
  const uploadAttempts = new Map<'header' | 'capsule', number>();

  function createBuilder(table: string) {
    const filters = new Map<string, unknown>();

    const builder = {
      select(_columns: string) {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.set(column, value);
        return builder;
      },
      order(_column: string, _options?: Record<string, unknown>) {
        return builder;
      },
      limit(_count: number) {
        return builder;
      },
      maybeSingle() {
        if (table === 'apps') {
          return Promise.resolve({ data: { release_date: null, is_released: true }, error: null });
        }

        if (table === 'sync_status') {
          return Promise.resolve({ data: { refresh_tier: 'active' }, error: null });
        }

        if (table === 'app_media_versions') {
          return Promise.resolve({
            data: {
              id: 1,
              content_hash: 'media-hash',
              hero_assets: options.mediaVersion.heroImages,
              screenshots: [],
              trailers: [],
            },
            error: null,
          });
        }

        if (table === 'app_hero_asset_versions') {
          return Promise.resolve({ data: null, error: null });
        }

        throw new Error(`Unexpected maybeSingle table in test: ${table}`);
      },
      update(values: Record<string, unknown>) {
        return {
          eq(column: string, value: unknown) {
            updatedRows.push({
              table,
              values,
              [column]: value,
              filters: Object.fromEntries(filters),
            });
            return Promise.resolve({ error: null });
          },
        };
      },
      insert(values: Record<string, unknown>) {
        insertedRows.push({ table, ...values });
        return Promise.resolve({ error: null });
      },
    };

    return builder;
  }

  const client = {
    rpc(name: string) {
      if (name === 'get_storage_bucket_usage_bytes') {
        return Promise.resolve({ data: 0, error: null });
      }

      throw new Error(`Unexpected RPC in test: ${name}`);
    },
    from(table: string) {
      return createBuilder(table);
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'steam-hero-assets');
        return {
          upload(path: string, _buffer: Buffer, _options: Record<string, unknown>) {
            const kind = path.split('/')[0] as 'header' | 'capsule';
            const plan = options.uploadPlans?.[kind] ?? [{ error: null }];
            const attempt = uploadAttempts.get(kind) ?? 0;
            uploadAttempts.set(kind, attempt + 1);
            const result = plan[Math.min(attempt, plan.length - 1)];
            return Promise.resolve({
              data: result.error ? null : { path },
              error: result.error,
            });
          },
        };
      },
    },
  } as unknown as TypedSupabaseClient;

  return {
    client,
    insertedRows,
    updatedRows,
    uploadAttempts,
  };
}

async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};

  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test('extractHeroAssets returns populated hero asset descriptors only', () => {
  const assets = extractHeroAssets({
    heroImages: {
      header: 'https://cdn.example.com/header.jpg',
      capsule: null,
      background: 'https://cdn.example.com/background.webp',
    },
    screenshots: [],
    movies: [],
  });

  assert.deepEqual(assets, [
    { kind: 'header', url: 'https://cdn.example.com/header.jpg' },
  ]);
});

test('buildHeroAssetArchiveKey uses the configured deterministic hero prefix', () => {
  const originalPrefix = process.env.CHANGE_INTEL_HERO_ASSET_PREFIX;
  process.env.CHANGE_INTEL_HERO_ASSET_PREFIX = 'production/change-intel/hero-asset/';

  try {
    const asset = { kind: 'header' as const, url: 'https://cdn.example.com/header.jpg' };
    assert.equal(buildHeroAssetObjectPath(asset, 'abc123', 'jpg'), 'header/abc123.jpg');
    assert.equal(
      buildHeroAssetArchiveKey(asset, 'abc123', 'jpg'),
      'production/change-intel/hero-asset/header/abc123.jpg'
    );
  } finally {
    if (originalPrefix === undefined) {
      delete process.env.CHANGE_INTEL_HERO_ASSET_PREFIX;
    } else {
      process.env.CHANGE_INTEL_HERO_ASSET_PREFIX = originalPrefix;
    }
  }
});

test('readImageMeta parses PNG dimensions from headers', () => {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(640, 16);
  buffer.writeUInt32BE(360, 20);

  assert.deepEqual(readImageMeta(buffer, 'image/png'), {
    width: 640,
    height: 360,
    mimeType: 'image/png',
  });
});

test('readImageMeta parses JPEG and WebP dimensions from headers', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01]);
  assert.deepEqual(readImageMeta(jpeg, 'image/jpeg'), {
    width: 200,
    height: 100,
    mimeType: 'image/jpeg',
  });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUIntLE(1279, 24, 3);
  webp.writeUIntLE(719, 27, 3);

  assert.deepEqual(readImageMeta(webp, 'image/webp'), {
    width: 1280,
    height: 720,
    mimeType: 'image/webp',
  });
});

test('isRetryableHeroAssetStorageErrorMessage matches transient storage responses', () => {
  assert.equal(isRetryableHeroAssetStorageErrorMessage('Unexpected token \'<\', "<html>..." is not valid JSON'), true);
  assert.equal(isRetryableHeroAssetStorageErrorMessage('502 Bad Gateway'), true);
  assert.equal(isRetryableHeroAssetStorageErrorMessage('new row violates unique constraint'), false);
});

test('archiveLatestAssetsForApp skips missing 404 assets and still archives remaining assets', async () => {
  const originalFetch = globalThis.fetch;
  const headerUrl = 'https://cdn.example.com/header.jpg';
  const capsuleUrl = 'https://cdn.example.com/capsule.jpg';
  const supabase = createSupabaseMock({
    mediaVersion: {
      heroImages: {
        header: headerUrl,
        capsule: capsuleUrl,
        background: null,
      },
    },
  });

  try {
    globalThis.fetch = createFetchStub({
      [headerUrl]: [new Response(null, { status: 404 })],
      [capsuleUrl]: [new Response(createJpegBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
    });

    const archiver = new HeroAssetArchiver(supabase.client);
    await archiver.archiveLatestAssetsForApp(10);

    assert.equal(supabase.uploadAttempts.get('header') ?? 0, 0);
    assert.equal(supabase.uploadAttempts.get('capsule') ?? 0, 1);
    assert.equal(supabase.insertedRows.length, 1);
    assert.equal(supabase.insertedRows[0]?.asset_kind, 'capsule');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archiveLatestAssetsForApp retries transient storage upload failures before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  const headerUrl = 'https://cdn.example.com/header.jpg';
  const supabase = createSupabaseMock({
    mediaVersion: {
      heroImages: {
        header: headerUrl,
        capsule: null,
        background: null,
      },
    },
    uploadPlans: {
      header: [
        { error: { message: 'Unexpected token \'<\', "<html>..." is not valid JSON' } },
        { error: { message: 'Unexpected token \'<\', "<html>..." is not valid JSON' } },
        { error: null },
      ],
    },
  });

  try {
    globalThis.fetch = createFetchStub({
      [headerUrl]: [new Response(createJpegBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
    });

    const archiver = new HeroAssetArchiver(supabase.client);
    await withSilencedConsole(() => archiver.archiveLatestAssetsForApp(20));

    assert.equal(supabase.uploadAttempts.get('header'), 3);
    assert.equal(supabase.insertedRows.length, 1);
    assert.equal(supabase.insertedRows[0]?.asset_kind, 'header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archiveLatestAssetsForApp continues other assets before surfacing retryable failures', async () => {
  const originalFetch = globalThis.fetch;
  const headerUrl = 'https://cdn.example.com/header.jpg';
  const capsuleUrl = 'https://cdn.example.com/capsule.jpg';
  const supabase = createSupabaseMock({
    mediaVersion: {
      heroImages: {
        header: headerUrl,
        capsule: capsuleUrl,
        background: null,
      },
    },
    uploadPlans: {
      header: [
        { error: { message: 'Unexpected token \'<\', "<html>..." is not valid JSON' } },
        { error: { message: 'Unexpected token \'<\', "<html>..." is not valid JSON' } },
        { error: { message: 'Unexpected token \'<\', "<html>..." is not valid JSON' } },
      ],
    },
  });

  try {
    globalThis.fetch = createFetchStub({
      [headerUrl]: [new Response(createJpegBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
      [capsuleUrl]: [new Response(createJpegBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
    });

    const archiver = new HeroAssetArchiver(supabase.client);
    await withSilencedConsole(() =>
      assert.rejects(
        () => archiver.archiveLatestAssetsForApp(30),
        /Failed to archive hero assets for app 30: header: Unexpected token/
      )
    );

    assert.equal(supabase.uploadAttempts.get('header'), 3);
    assert.equal(supabase.uploadAttempts.get('capsule'), 1);
    assert.equal(supabase.insertedRows.length, 1);
    assert.equal(supabase.insertedRows[0]?.asset_kind, 'capsule');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
