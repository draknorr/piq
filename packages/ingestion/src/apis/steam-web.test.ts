import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSteamAppChangeHints } from './steam-web.js';

test('fetchSteamAppChangeHints carries the durable cursor across every page', async () => {
  const previousApiKey = process.env.STEAM_API_KEY;
  process.env.STEAM_API_KEY = 'test-key';
  const requestedUrls: URL[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    const isFirstPage = requestedUrls.length === 1;

    return new Response(
      JSON.stringify({
        response: {
          apps: [
            {
              appid: isFirstPage ? 10 : 20,
              last_modified: isFirstPage ? 100 : 200,
              name: isFirstPage ? 'First' : 'Second',
              price_change_number: isFirstPage ? 1 : 2,
            },
          ],
          have_more_results: isFirstPage,
          ...(isFirstPage ? { last_appid: 10 } : {}),
        },
      }),
      {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }
    );
  };

  try {
    const hints = await fetchSteamAppChangeHints({
      fetchImpl,
      ifModifiedSince: 1_721_788_800,
    });

    assert.deepEqual(
      hints.map((hint) => hint.appid),
      [10, 20]
    );
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0]?.searchParams.get('if_modified_since'), '1721788800');
    assert.equal(requestedUrls[1]?.searchParams.get('if_modified_since'), '1721788800');
    assert.equal(requestedUrls[0]?.searchParams.has('last_appid'), false);
    assert.equal(requestedUrls[1]?.searchParams.get('last_appid'), '10');
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.STEAM_API_KEY;
    } else {
      process.env.STEAM_API_KEY = previousApiKey;
    }
  }
});
