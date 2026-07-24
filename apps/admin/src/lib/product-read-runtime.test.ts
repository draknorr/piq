import assert from "node:assert/strict";
import test from "node:test";

import { resolveProductReadTarget } from "./product-read-runtime";

test("product surfaces default to their legacy rollback readers", () => {
  assert.equal(resolveProductReadTarget("insights", {}), "legacy");
  assert.equal(resolveProductReadTarget("dashboard", {}), "legacy");
  assert.equal(resolveProductReadTarget("admin", {}), "legacy");
});

test("dashboard and admin can inherit the shared product-health target", () => {
  const env = { PRODUCT_HEALTH_READ_TARGET: "tiger" };
  assert.equal(resolveProductReadTarget("dashboard", env), "tiger");
  assert.equal(resolveProductReadTarget("admin", env), "tiger");
});

test("surface targets override the shared product-health target", () => {
  assert.equal(
    resolveProductReadTarget("admin", {
      ADMIN_PRODUCT_READ_TARGET: "legacy",
      PRODUCT_HEALTH_READ_TARGET: "tiger",
    }),
    "legacy",
  );
});

test("unknown product read targets fail closed", () => {
  assert.throws(
    () =>
      resolveProductReadTarget("insights", { INSIGHTS_READ_TARGET: "auto" }),
    /Invalid INSIGHTS_READ_TARGET/,
  );
});
