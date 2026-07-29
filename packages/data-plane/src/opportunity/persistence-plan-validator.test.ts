import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const validatorSource = readFileSync(
  new URL(
    "../scripts/validate-opportunity-persistence-plan.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("opportunity persistence plan validator", () => {
  it("can only plan statements in a forced read-only transaction", () => {
    assert.match(validatorSource, /BEGIN TRANSACTION READ ONLY/);
    assert.match(validatorSource, /SHOW transaction_read_only/);
    assert.match(validatorSource, /default_transaction_read_only=on/);
    assert.match(validatorSource, /lock_timeout=3000/);
    assert.match(validatorSource, /statement_timeout=30000/);
    assert.match(validatorSource, /EXPLAIN \(FORMAT JSON, COSTS OFF\)/);
    assert.doesNotMatch(validatorSource, /EXPLAIN\s*\([^)]*ANALYZE/i);
    assert.doesNotMatch(validatorSource, /EXPLAIN\s+ANALYZE/i);
  });

  it("covers every statement in the optimized publication transaction", () => {
    for (const statement of [
      "result/cohort/market/profile-match publication",
      "candidate-state publication",
      "result ranking",
      "delivery result selection",
      "delivery preference selection",
      "delivery publication",
      "profile schedule advancement",
      "work completion",
      "run completion",
    ]) {
      assert.match(validatorSource, new RegExp(`"${statement}"`));
    }
  });
});
