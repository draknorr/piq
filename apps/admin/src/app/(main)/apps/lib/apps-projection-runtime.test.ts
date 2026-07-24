import assert from "node:assert/strict";
import test from "node:test";

import { resolveAppProjectionRelations } from "./apps-projection-runtime";

test("Apps projection defaults to the legacy rollback surface", () => {
  assert.deepEqual(resolveAppProjectionRelations({}), {
    filterCounts: "metrics.apps_page_filter_counts",
    projection: "metrics.apps_page_projection",
    version: "legacy",
  });
});

test("Apps projection resolves the v2 relation pair from the allowlist", () => {
  assert.deepEqual(
    resolveAppProjectionRelations({ APP_PROJECTION_VERSION: " v2 " }),
    {
      filterCounts: "metrics.apps_page_filter_counts_v2",
      projection: "metrics.apps_page_projection_v2",
      version: "v2",
    },
  );
});

test("Apps projection fails closed for an unknown version", () => {
  assert.throws(
    () => resolveAppProjectionRelations({ APP_PROJECTION_VERSION: "latest" }),
    /Invalid APP_PROJECTION_VERSION/,
  );
});
