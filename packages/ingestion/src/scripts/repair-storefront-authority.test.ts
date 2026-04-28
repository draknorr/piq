import assert from 'node:assert/strict';
import test from 'node:test';
import type { TypedSupabaseClient } from '@publisheriq/database';
import type { ParsedStorefrontApp } from '../apis/storefront.js';
import {
  buildStorefrontAuthorityRepairCandidate,
  repairStorefrontAuthorityCandidate,
} from './repair-storefront-authority.js';

function buildStorefrontApp(
  overrides: Partial<ParsedStorefrontApp> = {}
): ParsedStorefrontApp {
  return {
    appid: 3308200,
    name: 'Tombwater',
    type: 'game',
    isFree: false,
    isDelisted: false,
    developers: ['Moth Atlas'],
    publishers: ['Moth Atlas'],
    releaseDate: '2026-03-31',
    releaseDateRaw: 'Mar 31, 2026',
    comingSoon: false,
    hasWorkshop: false,
    priceCents: 1999,
    discountPercent: 20,
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

test('buildStorefrontAuthorityRepairCandidate captures all missing storefront-owned fields', () => {
  const candidate = buildStorefrontAuthorityRepairCandidate(
    {
      appid: 3308200,
      is_delisted: false,
      is_free: null,
      is_released: null,
      name: 'Tombwater',
      release_date: null,
      release_date_raw: 'Mar 31, 2026',
      type: 'game',
    },
    {
      appid: 3308200,
      last_pics_sync: '2026-04-11T17:24:17.676Z',
      last_storefront_sync: '2026-04-09T01:40:46.836Z',
    }
  );

  assert.deepEqual(candidate, {
    appid: 3308200,
    lastPicsSync: '2026-04-11T17:24:17.676Z',
    lastStorefrontSync: '2026-04-09T01:40:46.836Z',
    missingFields: ['is_free', 'is_released', 'release_date'],
    name: 'Tombwater',
    type: 'game',
  });
});

test('repairStorefrontAuthorityCandidate routes snapshotless rows through live storefront fallback', async () => {
  let capturedAppid: number | null = null;
  let upsertedAppid: number | null = null;
  let fetchedAppid: number | null = null;

  const result = await repairStorefrontAuthorityCandidate(
    {} as unknown as TypedSupabaseClient,
    {
      appid: 3308200,
      lastPicsSync: '2026-04-11T17:24:17.676Z',
      lastStorefrontSync: '2026-04-09T01:40:46.836Z',
      missingFields: ['is_released'],
      name: 'Tombwater',
      type: 'game',
    },
    {
      deps: {
        captureStorefrontState: async (_supabase, appid) => {
          capturedAppid = appid;
          return { mediaChanged: false, snapshotChanged: true };
        },
        fetchStorefrontAppDetails: async (appid) => {
          fetchedAppid = appid;
          return { status: 'success', data: buildStorefrontApp() };
        },
        getLatestStorefrontSnapshot: async () => null,
        upsertLatestStorefrontState: async (_supabase, appid) => {
          upsertedAppid = appid;
        },
        upsertNormalizedStorefrontSnapshotState: async () => {
          throw new Error('snapshot replay should not be used in this test');
        },
      },
      dryRun: false,
    }
  );

  assert.deepEqual(result, {
    appid: 3308200,
    mode: 'live_fetch',
    repaired: true,
  });
  assert.equal(fetchedAppid, 3308200);
  assert.equal(capturedAppid, 3308200);
  assert.equal(upsertedAppid, 3308200);
});

test('repairStorefrontAuthorityCandidate keeps snapshotless dry runs read-only', async () => {
  let fetched = false;
  let captured = false;
  let upserted = false;

  const result = await repairStorefrontAuthorityCandidate(
    {} as unknown as TypedSupabaseClient,
    {
      appid: 3288210,
      lastPicsSync: null,
      lastStorefrontSync: '2026-04-09T01:40:46.836Z',
      missingFields: ['release_date'],
      name: 'Super Meat Boy 3D',
      type: 'game',
    },
    {
      deps: {
        captureStorefrontState: async () => {
          captured = true;
          return { mediaChanged: false, snapshotChanged: false };
        },
        fetchStorefrontAppDetails: async () => {
          fetched = true;
          return { status: 'success', data: buildStorefrontApp() };
        },
        getLatestStorefrontSnapshot: async () => null,
        upsertLatestStorefrontState: async () => {
          upserted = true;
        },
        upsertNormalizedStorefrontSnapshotState: async () => undefined,
      },
      dryRun: true,
    }
  );

  assert.deepEqual(result, {
    appid: 3288210,
    mode: 'live_fetch',
    repaired: false,
  });
  assert.equal(fetched, false);
  assert.equal(captured, false);
  assert.equal(upserted, false);
});
