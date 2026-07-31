import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNormalizedStorefrontSnapshotUpsertArgs,
  normalizeAppType,
  sanitizeStorefrontPriceCents,
  upsertLatestStorefrontState,
} from './storefront-latest-state.js';
import type { StorefrontAppUpsertArgs, TypedSupabaseClient } from '@publisheriq/database';
import type { ParsedStorefrontApp } from '../apis/storefront.js';
import type { NormalizedStorefrontSnapshot } from './types.js';

type StorefrontWriterArg = NonNullable<Parameters<typeof upsertLatestStorefrontState>[3]>;

function buildStorefrontApp(overrides: Partial<ParsedStorefrontApp> = {}): ParsedStorefrontApp {
  return {
    appid: 10,
    name: 'Example',
    type: 'game',
    isFree: false,
    isDelisted: false,
    hasPurchasePackages: true,
    developers: ['Studio'],
    publishers: ['Publisher'],
    releaseDate: '2026-03-01',
    releaseDateRaw: 'Mar 1, 2026',
    comingSoon: false,
    hasWorkshop: false,
    priceCents: 1999,
    discountPercent: 0,
    categories: [],
    genres: [],
    platforms: { windows: true, mac: false, linux: false },
    metacriticScore: null,
    totalRecommendations: null,
    dlcAppids: [],
    demoAppids: [],
    parentAppid: null,
    detailedDescription: null,
    aboutTheGame: null,
    shortDescription: null,
    supportedLanguages: null,
    controllerSupport: null,
    headerImage: null,
    capsuleImage: null,
    backgroundImage: null,
    website: null,
    packageIds: [],
    packageGroupSubs: [],
    screenshots: [],
    movies: [],
    ...overrides,
  };
}

function buildNormalizedSnapshot(
  overrides: Partial<NormalizedStorefrontSnapshot> = {}
): NormalizedStorefrontSnapshot {
  return {
    name: 'Snapshot Example',
    type: 'game',
    isFree: false,
    isDelisted: false,
    hasPurchasePackages: true,
    comingSoon: false,
    releaseDate: '2026-03-31',
    releaseDateText: 'Mar 31, 2026',
    descriptions: {
      short: null,
      about: null,
      detailed: null,
    },
    supportedLanguages: null,
    developers: ['Snapshot Studio'],
    publishers: ['Snapshot Publisher'],
    price: {
      currentCents: 1499,
      discountPercent: 20,
    },
    categories: [],
    genres: [],
    platforms: { windows: true, mac: false, linux: false },
    controllerSupport: null,
    dlcAppids: [],
    demoAppids: [],
    packageIds: [],
    packageGroupSubs: [],
    heroImages: {
      header: null,
      capsule: null,
      background: null,
    },
    screenshots: [],
    movies: [],
    ...overrides,
  };
}

test('normalizeAppType falls back to game for unknown values', () => {
  assert.equal(normalizeAppType('unknown-type'), 'game');
  assert.equal(normalizeAppType('DLC'), 'dlc');
});

test('sanitizeStorefrontPriceCents drops unreasonable storefront prices', () => {
  assert.equal(sanitizeStorefrontPriceCents(null), null);
  assert.equal(sanitizeStorefrontPriceCents(-1), null);
  assert.equal(sanitizeStorefrontPriceCents(50001), null);
  assert.equal(sanitizeStorefrontPriceCents(1999), 1999);
});

test('upsertLatestStorefrontState sends null release_date to Tiger when parsing failed', async () => {
  let upsertArgs: Record<string, unknown> | null = null;
  const supabase = {} as TypedSupabaseClient;
  const tiger: StorefrontWriterArg = {
    catalog: {
      upsertStorefrontApp(args: StorefrontAppUpsertArgs) {
        upsertArgs = args as unknown as Record<string, unknown>;
        return Promise.resolve();
      },
    },
  };

  await upsertLatestStorefrontState(supabase, 36150, buildStorefrontApp({
    releaseDate: null,
    releaseDateRaw: '',
  }), tiger, '2026-07-31T12:00:00.000Z');

  assert.deepEqual(upsertArgs, {
    p_appid: 36150,
    p_name: 'Example',
    p_type: 'game',
    p_is_free: false,
    p_is_delisted: false,
    p_has_purchase_packages: true,
    p_release_date: null,
    p_release_date_raw: '',
    p_has_workshop: false,
    p_current_price_cents: 1999,
    p_current_discount_percent: 0,
    p_is_released: true,
    p_developers: ['Studio'],
    p_publishers: ['Publisher'],
    p_genres: [],
    p_categories: [],
    p_platforms: ['windows'],
    p_languages: [],
    p_evidence_observed_at: '2026-07-31T12:00:00.000Z',
  });
});

test('upsertLatestStorefrontState passes null price for unreasonable storefront values', async () => {
  let upsertArgs: Record<string, unknown> | null = null;
  const supabase = {} as TypedSupabaseClient;
  const tiger: StorefrontWriterArg = {
    catalog: {
      upsertStorefrontApp(args: StorefrontAppUpsertArgs) {
        upsertArgs = args as unknown as Record<string, unknown>;
        return Promise.resolve();
      },
    },
  };

  await upsertLatestStorefrontState(supabase, 36150, buildStorefrontApp({
    priceCents: 90000,
  }), tiger);

  if (!upsertArgs) {
    throw new Error('Expected Tiger storefront upsert to be called');
  }
  const capturedArgs = upsertArgs as Record<string, unknown>;
  assert.equal(capturedArgs.p_current_price_cents, null);
});

test('buildNormalizedStorefrontSnapshotUpsertArgs replays stored storefront snapshots through the RPC shape', () => {
  const args = buildNormalizedStorefrontSnapshotUpsertArgs(
    3308200,
    buildNormalizedSnapshot({
      categories: [
        { id: 1, description: 'Multi-player' },
        { id: 30, description: 'Workshop' },
      ],
      comingSoon: true,
      dlcAppids: [111, 222],
      demoAppids: [333],
      hasPurchasePackages: false,
      price: {
        currentCents: 90000,
        discountPercent: 15,
      },
      releaseDateText: null,
    })
  );

  assert.deepEqual(args, {
    p_appid: 3308200,
    p_name: 'Snapshot Example',
    p_type: 'game',
    p_is_free: false,
    p_is_delisted: false,
    p_has_purchase_packages: false,
    p_release_date: '2026-03-31',
    p_release_date_raw: '',
    p_has_workshop: true,
    p_current_price_cents: null,
    p_current_discount_percent: 15,
    p_is_released: false,
    p_developers: ['Snapshot Studio'],
    p_publishers: ['Snapshot Publisher'],
    p_dlc_appids: [111, 222],
    p_demo_appids: [333],
    p_genres: null,
    p_categories: null,
    p_platforms: null,
    p_languages: null,
    p_evidence_observed_at: null,
  });
});

test('Storefront evidence preserves absent fields separately from known empty fields', async () => {
  let upsertArgs: Record<string, unknown> | null = null;
  const tiger: StorefrontWriterArg = {
    catalog: {
      upsertStorefrontApp(args: StorefrontAppUpsertArgs) {
        upsertArgs = args as unknown as Record<string, unknown>;
        return Promise.resolve();
      },
    },
  };

  await upsertLatestStorefrontState(
    {} as TypedSupabaseClient,
    36150,
    buildStorefrontApp({
      categories: [],
      genres: [],
      fieldPresence: {
        categories: true,
        genres: false,
        languages: true,
        platforms: false,
      },
      supportedLanguages: 'English<strong>*</strong>, French, English',
    }),
    tiger,
    '2026-07-31T12:00:00.000Z'
  );

  if (!upsertArgs) {
    throw new Error('Expected Tiger storefront upsert to be called');
  }
  const capturedArgs = upsertArgs as Record<string, unknown>;
  assert.deepEqual(capturedArgs.p_categories, []);
  assert.equal(capturedArgs.p_genres, null);
  assert.deepEqual(capturedArgs.p_languages, ['English', 'French']);
  assert.equal(capturedArgs.p_platforms, null);
});
