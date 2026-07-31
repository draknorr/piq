import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStorefrontAppDetails,
  parseStorefrontResponse,
  type StorefrontAppDetails,
} from './storefront.js';

function buildResponse(
  data: Partial<NonNullable<StorefrontAppDetails['data']>> = {}
): StorefrontAppDetails {
  return {
    success: true,
    data: {
      type: 'game',
      name: 'Example',
      steam_appid: 10,
      required_age: 0,
      is_free: false,
      platforms: { windows: true, mac: false, linux: false },
      release_date: {
        coming_soon: false,
        date: 'May 12, 2026',
      },
      ...data,
    },
  };
}

test('parseStorefrontResponse captures parent demo references', () => {
  const parsed = parseStorefrontResponse(
    4615010,
    buildResponse({
      name: 'Kibble Cats',
      demos: [{ appid: 4707330, description: '' }, { appid: '4707330' }, { appid: 'not-an-appid' }],
    })
  );

  assert.deepEqual(parsed?.demoAppids, [4707330]);
});

test('parseStorefrontResponse records source field presence before applying defaults', () => {
  const absentResponse = buildResponse();
  delete (absentResponse.data as Partial<NonNullable<StorefrontAppDetails['data']>>).platforms;
  const absent = parseStorefrontResponse(10, absentResponse);
  const empty = parseStorefrontResponse(
    10,
    buildResponse({ categories: [], genres: [], supported_languages: '' })
  );

  assert.deepEqual(absent?.fieldPresence, {
    categories: false,
    genres: false,
    languages: false,
    platforms: false,
  });
  assert.deepEqual(empty?.fieldPresence, {
    categories: true,
    genres: true,
    languages: true,
    platforms: true,
  });
});

test('parseStorefrontResponse captures demo parent from fullgame', () => {
  const parsed = parseStorefrontResponse(
    4707330,
    buildResponse({
      type: 'demo',
      name: 'Kibble Cats Prologue',
      is_free: true,
      fullgame: {
        appid: '4615010',
        name: 'Kibble Cats',
      },
    })
  );

  assert.equal(parsed?.type, 'demo');
  assert.equal(parsed?.isFree, true);
  assert.equal(parsed?.parentAppid, 4615010);
});

test('parseStorefrontResponse treats accessible no-package pages as not delisted', () => {
  const parsed = parseStorefrontResponse(
    4615010,
    buildResponse({
      packages: null,
      package_groups: [],
      release_date: {
        coming_soon: true,
        date: 'Coming soon',
      },
    })
  );

  assert.equal(parsed?.isDelisted, false);
  assert.equal(parsed?.hasPurchasePackages, false);
  assert.equal(parsed?.comingSoon, true);
});

test('parseStorefrontResponse computes hasPurchasePackages from package group subs', () => {
  const parsed = parseStorefrontResponse(
    10,
    buildResponse({
      packages: null,
      package_groups: [
        {
          name: 'default',
          title: 'Buy Example',
          description: '',
          selection_text: '',
          save_text: '',
          display_type: 0,
          is_recurring_subscription: 'false',
          subs: [
            {
              packageid: 123,
              percent_savings_text: '',
              percent_savings: 0,
              option_text: '',
              option_description: '',
              can_get_free_license: '0',
              is_free_license: false,
              price_in_cents_with_discount: 1999,
            },
          ],
        },
      ],
    })
  );

  assert.equal(parsed?.hasPurchasePackages, true);
  assert.deepEqual(parsed?.packageGroupSubs, [123]);
});

test('fetchStorefrontAppDetails rate-limits every retry attempt', async () => {
  let attempts = 0;
  let limiterAcquires = 0;
  const result = await fetchStorefrontAppDetails(10, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('busy', { status: 500 });
      }
      return new Response(JSON.stringify({ 10: buildResponse() }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    },
    limiter: {
      acquire: async () => {
        limiterAcquires += 1;
      },
    },
  });

  assert.equal(result.status, 'success');
  assert.equal(attempts, 2);
  assert.equal(limiterAcquires, 2);
});
