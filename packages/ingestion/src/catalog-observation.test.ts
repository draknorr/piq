import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCatalogShadowParity,
  buildCatalogBatchHash,
  buildCatalogScanRunKey,
  normalizeCatalogObservationRows,
  readCatalogObservationMode,
} from './catalog-observation.js';

test('readCatalogObservationMode defaults off and fails closed on unknown values', () => {
  assert.equal(readCatalogObservationMode({} as NodeJS.ProcessEnv), 'off');
  assert.equal(
    readCatalogObservationMode({
      CATALOG_OBSERVATION_MODE: ' SHADOW ',
    } as NodeJS.ProcessEnv),
    'shadow'
  );
  assert.throws(
    () =>
      readCatalogObservationMode({
        CATALOG_OBSERVATION_MODE: 'enabled',
      } as NodeJS.ProcessEnv),
    /expected off, shadow, or primary/
  );
});

test('buildCatalogScanRunKey is stable for a GitHub workflow retry', () => {
  assert.equal(
    buildCatalogScanRunKey('steam_change_hints', {
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_RUN_ID: '30063718694',
    } as NodeJS.ProcessEnv),
    'github:steam_change_hints:30063718694'
  );
});

test('normalizeCatalogObservationRows records every invalid source row', () => {
  const observation = normalizeCatalogObservationRows(
    [
      { appid: 30, name: ' New App ', lastModified: 300, priceChangeNumber: 3 },
      { appid: -1, name: 'Invalid', lastModified: 1, priceChangeNumber: 1 },
      { appid: 30, name: 'Duplicate', lastModified: 301, priceChangeNumber: 4 },
      { appid: 40, name: '', lastModified: 400, priceChangeNumber: 5 },
      { appid: 50, name: 'Missing Hint', priceChangeNumber: 6 },
    ],
    { requireHints: true }
  );

  assert.deepEqual(observation.rows, [
    {
      appid: 30,
      last_modified: 300,
      name: 'New App',
      price_change_number: 3,
    },
  ]);
  assert.deepEqual(
    observation.rejections.map((row) => [row.source_index, row.appid, row.reason]),
    [
      [1, -1, 'invalid_appid'],
      [2, 30, 'duplicate_appid'],
      [3, 40, 'missing_name'],
      [4, 50, 'invalid_last_modified'],
    ]
  );
  assert.equal(
    observation.rejections.every((row) => row.row_hash.length === 64),
    true
  );
  assert.equal(observation.sourceRowCount, 5);
});

test('buildCatalogBatchHash is stable for equivalent object key order', () => {
  const left = buildCatalogBatchHash(
    [{ appid: 10, name: 'App', last_modified: 100, price_change_number: 1 }],
    []
  );
  const right = buildCatalogBatchHash(
    [{ price_change_number: 1, last_modified: 100, name: 'App', appid: 10 }],
    []
  );

  assert.equal(left, right);
});

test('assertCatalogShadowParity ignores input order but rejects missing IDs', () => {
  assert.doesNotThrow(() =>
    assertCatalogShadowParity({
      actualChangedKnownAppids: [20, 10],
      actualUnknownAppids: [40, 30],
      expectedChangedKnownAppids: [10, 20],
      expectedUnknownAppids: [30, 40],
    })
  );
  assert.throws(
    () =>
      assertCatalogShadowParity({
        actualChangedKnownAppids: [10],
        actualUnknownAppids: [],
        expectedChangedKnownAppids: [10],
        expectedUnknownAppids: [30],
      }),
    /unknown-ID parity failed/
  );
});
