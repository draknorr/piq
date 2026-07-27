import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8",
);

describe("opportunity Admin proxy", () => {
  it("validates the user and forwards the Supabase access token server-side", () => {
    assert.match(source, /auth\.getUser\(\)/);
    assert.match(source, /auth\.getSession\(\)/);
    assert.match(source, /identityAccessToken: session\.access_token/);
  });

  it("uses an explicit operation allowlist", () => {
    assert.match(source, /ALLOWED_OPERATIONS/);
    assert.doesNotMatch(source, /operation}.*baseUrl/);
  });
});
