import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTigerPool, shutdownTigerPool } from "./tiger.js";

test("idle Tiger writer errors are handled without leaking client credentials", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logs.push(args);
  });
  const pool = getTigerPool({
    TIGER_PRIMARY_URL: "postgres://test:test@localhost/test",
  });
  try {
    const error = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );
    assert.doesNotThrow(() =>
      (pool as unknown as EventEmitter).emit("error", error, {
        password: "must-not-log",
      }),
    );
    assert.equal(logs.length, 1);
    assert.ok(!JSON.stringify(logs).includes("must-not-log"));
    assert.equal(
      (pool as unknown as { options: { connectionTimeoutMillis: number } })
        .options.connectionTimeoutMillis,
      10_000,
    );
    assert.equal(getTigerPool(), pool);
    const checkedOutClient = new EventEmitter();
    (pool as unknown as EventEmitter).emit('connect', checkedOutClient);
    assert.doesNotThrow(() => checkedOutClient.emit('error', new Error('Connection terminated unexpectedly')));
  } finally {
    await shutdownTigerPool();
  }
});
