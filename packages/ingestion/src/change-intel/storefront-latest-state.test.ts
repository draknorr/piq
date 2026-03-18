import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAppType, sanitizeStorefrontPriceCents, upsertLatestStorefrontState } from './storefront-latest-state.js';
import type { ParsedStorefrontApp } from '../apis/storefront.js';

function buildStorefrontApp(overrides: Partial<ParsedStorefrontApp> = {}): ParsedStorefrontApp {
  return {
    appid: 10,
    name: 'Example',
    type: 'game',
    isFree: false,
    isDelisted: false,
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

test('upsertLatestStorefrontState sends null release_date when parsing failed', async () => {
  let rpcCall: { fn: string; args: Record<string, unknown> } | null = null;
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCall = { fn, args };
      return Promise.resolve({ error: null });
    },
  };

  await upsertLatestStorefrontState(supabase as any, 36150, buildStorefrontApp({
    releaseDate: null,
    releaseDateRaw: '',
  }));

  assert.deepEqual(rpcCall, {
    fn: 'upsert_storefront_app',
    args: {
      p_appid: 36150,
      p_name: 'Example',
      p_type: 'game',
      p_is_free: false,
      p_is_delisted: false,
      p_release_date: null,
      p_release_date_raw: '',
      p_has_workshop: false,
      p_current_price_cents: 1999,
      p_current_discount_percent: 0,
      p_is_released: true,
      p_developers: ['Studio'],
      p_publishers: ['Publisher'],
    },
  });
});

test('upsertLatestStorefrontState passes null price for unreasonable storefront values', async () => {
  let rpcCall: { fn: string; args: Record<string, unknown> } | null = null;
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCall = { fn, args };
      return Promise.resolve({ error: null });
    },
  };

  await upsertLatestStorefrontState(supabase as any, 36150, buildStorefrontApp({
    priceCents: 90000,
  }));

  if (!rpcCall) {
    throw new Error('Expected upsert_storefront_app RPC to be called');
  }
  const capturedCall = rpcCall as { fn: string; args: Record<string, unknown> };
  assert.equal(capturedCall.args.p_current_price_cents, null);
});
