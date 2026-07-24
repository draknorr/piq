import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHANGE_EVENT_REGISTRY,
  CHANGE_EVENT_REGISTRY_VERSION,
  resolveChangeEventDefinition,
  resolveChangeEventType,
} from "@publisheriq/shared";

const REGISTRY_SQL_URL = new URL(
  "../sql/tiger-bootstrap/0089_readiness_events_signal_windows.sql",
  import.meta.url,
);

test("change-event registry has unique source/type keys and one version", () => {
  const keys = CHANGE_EVENT_REGISTRY.map(
    (entry) => `${entry.source}:${entry.rawEventType}`,
  );

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(CHANGE_EVENT_REGISTRY_VERSION, "change-events/v1");
});

test("demo relationships and release-state transitions are explicit release signals", () => {
  const demo = resolveChangeEventDefinition(
    "storefront",
    "demo_references_changed",
  );
  const releaseState = resolveChangeEventDefinition(
    "storefront",
    "release_state_changed",
  );

  assert.equal(demo.isKnown, true);
  assert.equal(demo.signalFamily, "release");
  assert.equal(demo.storyKind, "release-prep");
  assert.equal(demo.affectsReadiness, true);
  assert.equal(releaseState.isKnown, true);
  assert.equal(releaseState.signalFamily, "release");
});

test("unknown event types stay visible as unknown", () => {
  const definition = resolveChangeEventDefinition(
    "storefront",
    "new_unregistered_signal",
  );

  assert.equal(definition.isKnown, false);
  assert.equal(definition.signalFamily, "unknown");
  assert.equal(definition.storyKind, "general-update");
  assert.equal(definition.unknownBehavior, "preserve_unknown");
  assert.equal(definition.label, "New Unregistered Signal");
  assert.equal(
    resolveChangeEventType("new_unregistered_signal").signalFamily,
    "unknown",
  );
});

test("Tiger registry seed mirrors every shared registry entry", async () => {
  const sql = await readFile(REGISTRY_SQL_URL, "utf8");

  for (const entry of CHANGE_EVENT_REGISTRY) {
    const tuplePrefix = [
      `('${CHANGE_EVENT_REGISTRY_VERSION}'`,
      `'${entry.source}'`,
      `'${entry.rawEventType}'`,
      `'${entry.signalFamily}'`,
      `'${entry.label}'`,
      `'${entry.storyKind}'`,
    ].join(", ");

    assert.ok(
      sql.includes(tuplePrefix),
      `missing Tiger registry seed for ${entry.source}:${entry.rawEventType}`,
    );
  }
});

test("bounded refresh functions reject missing app IDs in SQL", async () => {
  const sql = await readFile(REGISTRY_SQL_URL, "utf8");

  assert.match(
    sql,
    /refresh_app_signal_windows_v1 requires at least one appid/,
  );
  assert.match(sql, /refresh_creator_readiness_v1 requires at least one appid/);
  assert.match(sql, /refresh_overall_readiness_v1 requires at least one appid/);
  assert.equal((sql.match(/accepts at most 5000 appids/g) ?? []).length, 3);
  assert.equal(
    (sql.match(/WHERE input\.appid IS NULL OR input\.appid <= 0/g) ?? [])
      .length,
    3,
  );
});

test("release-state transitions stay in the separate lifecycle stream", async () => {
  const sql = await readFile(REGISTRY_SQL_URL, "utf8");

  assert.doesNotMatch(sql, /idx_events_release_state_change_snapshot/);
  assert.match(
    sql,
    /'storefront:release_state_changed:snapshot:' \|\| NEW\.id::text/,
  );
});

test("storefront readiness freshness comes from successful sync time", async () => {
  const sql = await readFile(REGISTRY_SQL_URL, "utf8");

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION ops\.capture_storefront_sync_readiness_v1\(\)/,
  );
  assert.match(
    sql,
    /NEW\.last_storefront_sync,\s+clock_timestamp\(\),\s+'storefront-readiness\/v1'/,
  );
});
