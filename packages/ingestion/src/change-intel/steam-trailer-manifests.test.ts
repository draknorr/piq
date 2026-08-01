import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedSteamHlsUrl, parseSteamTrailerManifests } from '@publisheriq/shared';
import { applyStorefrontTrailerManifests, type ParsedStorefrontApp } from '../apis/storefront.js';
import { diffStorefrontMedia, normalizeStorefrontSnapshot } from './storefront.js';

const HLS_URL =
  'https://video.fastly.steamstatic.com/store_trailers/4672300/379508545/hash/1/hls_264_master.m3u8?t=2';
const POSTER_URL =
  'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/257381675/hash/movie_600x337.jpg?t=2';

function parsedStorefront(): ParsedStorefrontApp {
  return {
    aboutTheGame: null,
    appid: 4672300,
    backgroundImage: null,
    capsuleImage: null,
    categories: [],
    comingSoon: true,
    controllerSupport: null,
    demoAppids: [],
    detailedDescription: null,
    developers: [],
    discountPercent: 0,
    dlcAppids: [],
    genres: [],
    hasPurchasePackages: false,
    hasWorkshop: false,
    headerImage: null,
    isDelisted: false,
    isFree: false,
    metacriticScore: null,
    movies: [
      {
        highlight: true,
        hlsUrl: null,
        id: 257381675,
        mp4Url: null,
        name: 'Gameplay Trailer',
        thumbnailUrl: POSTER_URL,
        webmUrl: null,
      },
    ],
    name: 'Example',
    packageGroupSubs: [],
    packageIds: [],
    parentAppid: null,
    platforms: { linux: false, mac: false, windows: true },
    priceCents: null,
    publishers: [],
    releaseDate: null,
    releaseDateRaw: 'Coming soon',
    screenshots: [],
    shortDescription: null,
    supportedLanguages: null,
    totalRecommendations: null,
    type: 'game',
    website: null,
  };
}

test('Steam trailer parser decodes carousel props and matches the poster media id', () => {
  const props = JSON.stringify({
    appName: 'Example',
    trailers: [
      {
        hlsManifest: HLS_URL,
        poster: POSTER_URL,
        title: 'Gameplay Trailer & More',
      },
    ],
  })
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
  const html = `<div data-props="${props}"></div>`;

  assert.deepEqual(parseSteamTrailerManifests(html), [
    {
      hlsUrl: HLS_URL,
      mediaId: 257381675,
      posterUrl: POSTER_URL,
      title: 'Gameplay Trailer & More',
    },
  ]);
});

test('Steam trailer parser ignores malformed and non-Steam manifests', () => {
  assert.equal(isAllowedSteamHlsUrl(HLS_URL), true);
  assert.equal(isAllowedSteamHlsUrl('https://example.com/video.m3u8'), false);
  assert.deepEqual(
    parseSteamTrailerManifests(
      '<div data-props="{&quot;trailers&quot;:[{&quot;poster&quot;:&quot;bad&quot;,&quot;hlsManifest&quot;:&quot;https://example.com/video.m3u8&quot;}]}"></div>'
    ),
    []
  );
});

test('HLS enrichment adds playback without creating a false trailer change', () => {
  const before = normalizeStorefrontSnapshot(parsedStorefront());
  const enriched = applyStorefrontTrailerManifests(parsedStorefront(), [
    {
      hlsUrl: HLS_URL,
      mediaId: 257381675,
      posterUrl: POSTER_URL,
      title: 'Gameplay Trailer',
    },
  ]);
  const after = normalizeStorefrontSnapshot(enriched);

  assert.equal(after.movies[0]?.hlsUrl, HLS_URL);
  assert.deepEqual(diffStorefrontMedia(before, after), []);
});
