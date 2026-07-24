import assert from "node:assert/strict";
import test from "node:test";

import { readPreparationStateConfig } from "./refresh-preparation-derived-state.js";

test("preparation derived-state refresh defaults off without inputs", () => {
  assert.deepEqual(readPreparationStateConfig({}), {
    appids: [],
    asOfDate: null,
    calculationVersion: "signal-windows/v1",
    mode: "off",
  });
});

test("preparation derived-state refresh accepts a bounded deduplicated shadow batch", () => {
  assert.deepEqual(
    readPreparationStateConfig({
      PREPARATION_APPIDS: "10,20,10",
      PREPARATION_AS_OF_DATE: "2026-07-24",
      PREPARATION_STATE_MODE: "shadow",
    }),
    {
      appids: [10, 20],
      asOfDate: "2026-07-24",
      calculationVersion: "signal-windows/v1",
      mode: "shadow",
    },
  );
});

test("preparation derived-state refresh fails closed on invalid modes and unbounded input", () => {
  assert.throws(
    () =>
      readPreparationStateConfig({
        PREPARATION_STATE_MODE: "enabled",
      }),
    /expected off, shadow, or primary/,
  );
  assert.throws(
    () =>
      readPreparationStateConfig({
        PREPARATION_AS_OF_DATE: "2026-07-24",
        PREPARATION_STATE_MODE: "shadow",
      }),
    /PREPARATION_APPIDS is required/,
  );
});

test("primary preparation mode requires a separate cutover acknowledgement", () => {
  const env = {
    PREPARATION_APPIDS: "10",
    PREPARATION_AS_OF_DATE: "2026-07-24",
    PREPARATION_STATE_MODE: "primary",
  };

  assert.throws(
    () => readPreparationStateConfig(env),
    /PREPARATION_PRIMARY_CUTOVER_APPROVED=true/,
  );
  assert.equal(
    readPreparationStateConfig({
      ...env,
      PREPARATION_PRIMARY_CUTOVER_APPROVED: "true",
    }).mode,
    "primary",
  );
});
