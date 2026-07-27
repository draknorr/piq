import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppsPageUrl,
  getAppsPaginationState,
  normalizeAppsPagination,
} from "./apps-pagination";

test("normalizeAppsPagination bounds invalid and oversized URL values", () => {
  assert.deepEqual(normalizeAppsPagination(undefined, undefined), {
    limit: 50,
    offset: 0,
  });
  assert.deepEqual(normalizeAppsPagination(500, -20), {
    limit: 100,
    offset: 0,
  });
  assert.deepEqual(normalizeAppsPagination(25.8, 51.9), {
    limit: 25,
    offset: 51,
  });
});

test("getAppsPaginationState reports the visible range and navigation offsets", () => {
  assert.deepEqual(getAppsPaginationState(127_321, 50, 50, 50), {
    limit: 50,
    offset: 50,
    currentPage: 2,
    totalPages: 2547,
    rangeStart: 51,
    rangeEnd: 100,
    hasPrevious: true,
    hasNext: true,
    previousOffset: 0,
    nextOffset: 100,
  });

  const lastPage = getAppsPaginationState(123, 50, 100, 23);
  assert.equal(lastPage.rangeStart, 101);
  assert.equal(lastPage.rangeEnd, 123);
  assert.equal(lastPage.hasNext, false);
});

test("buildAppsPageUrl preserves filters and removes the first-page offset", () => {
  const currentParams = new URLSearchParams(
    "sort=total_reviews&minScore=80&offset=50",
  );

  assert.equal(
    buildAppsPageUrl(currentParams, 100),
    "/apps?sort=total_reviews&minScore=80&offset=100",
  );
  assert.equal(
    buildAppsPageUrl(currentParams, 0),
    "/apps?sort=total_reviews&minScore=80",
  );
});
