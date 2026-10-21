import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import {
  createNextFestAccessToken,
  getNextFestCookieOptions,
  isNextFestAccessTokenValid,
  isNextFestConfigured,
  isNextFestPasswordValid,
  NEXT_FEST_ACCESS_COOKIE,
  NEXT_FEST_COOKIE_MAX_AGE_SECONDS,
} from "./access";
import { GET, POST } from "./route";

const originalPassword = process.env.NEXT_FEST_PASSWORD;
const originalSecret = process.env.NEXT_FEST_COOKIE_SECRET;
const URL = "https://www.publisheriq.app/next-fest";

beforeEach(() => {
  process.env.NEXT_FEST_PASSWORD = "fixture-password";
  process.env.NEXT_FEST_COOKIE_SECRET = "fixture-secret-with-no-production-use";
});
afterEach(() => {
  if (originalPassword === undefined) delete process.env.NEXT_FEST_PASSWORD;
  else process.env.NEXT_FEST_PASSWORD = originalPassword;
  if (originalSecret === undefined) delete process.env.NEXT_FEST_COOKIE_SECRET;
  else process.env.NEXT_FEST_COOKIE_SECRET = originalSecret;
});

test("missing either server credential fails closed", async () => {
  delete process.env.NEXT_FEST_COOKIE_SECRET;
  assert.equal(isNextFestConfigured(), false);
  assert.equal(isNextFestPasswordValid("fixture-password"), false);
  assert.equal(createNextFestAccessToken(), null);
  const response = await GET(new NextRequest(URL));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /nf-payload/);
});

test("password matching does not accept prefixes or surrounding whitespace", () => {
  assert.equal(isNextFestPasswordValid("fixture-password"), true);
  for (const value of ["", "fixture", "fixture-password ", "wrong-password"]) {
    assert.equal(isNextFestPasswordValid(value), false);
  }
});

test("sessions expire, reject tampering, and are revoked by credential changes", () => {
  const now = 1_790_000_000;
  const token = createNextFestAccessToken(now)!;
  assert.equal(isNextFestAccessTokenValid(token, now), true);
  assert.equal(isNextFestAccessTokenValid(token, now + NEXT_FEST_COOKIE_MAX_AGE_SECONDS), false);
  assert.equal(isNextFestAccessTokenValid(`${token}0`, now), false);
  assert.equal(isNextFestAccessTokenValid(`1999999999.${token.split(".")[1]}`, now), false);
  process.env.NEXT_FEST_PASSWORD = "changed-password";
  assert.equal(isNextFestAccessTokenValid(token, now), false);
  process.env.NEXT_FEST_PASSWORD = "fixture-password";
  process.env.NEXT_FEST_COOKIE_SECRET = "changed-secret";
  assert.equal(isNextFestAccessTokenValid(token, now), false);
});

test("unauthenticated and forged-cookie requests do not contain the atlas dataset", async () => {
  for (const cookie of ["", `${NEXT_FEST_ACCESS_COOKIE}=forged-token`]) {
    const response = await GET(new NextRequest(URL, { headers: { cookie } }));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<label for="password">Password<\/label>/);
    assert.doesNotMatch(html, /nf-payload/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("valid login sets a scoped HttpOnly cookie and unlocks the complete standalone atlas", async () => {
  const response = await POST(new NextRequest(URL, {
    method: "POST",
    headers: { origin: "https://www.publisheriq.app" },
    body: new URLSearchParams({ password: "fixture-password" }),
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), URL);
  const token = response.cookies.get(NEXT_FEST_ACCESS_COOKIE)?.value;
  assert.equal(isNextFestAccessTokenValid(token), true);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(response.headers.get("set-cookie")!, /Path=\/next-fest/);
  assert.match(response.headers.get("set-cookie")!, /SameSite=lax/i);
  const unlocked = await GET(new NextRequest(URL, { headers: { cookie: `${NEXT_FEST_ACCESS_COOKIE}=${token}` } }));
  assert.equal(unlocked.status, 200);
  const html = await unlocked.text();
  assert.match(html, /id="nf-payload"/);
  assert.match(html, /Steam Next Fest Overview/);
  assert.doesNotMatch(html, /<!--nf-payload-->/);
  assert.doesNotMatch(html, /fixture-password|fixture-secret/);
});

test("invalid passwords, foreign origins, and malformed forms never issue a session", async () => {
  const wrong = await POST(new NextRequest(URL, { method: "POST", body: new URLSearchParams({ password: "wrong" }) }));
  assert.equal(wrong.status, 303);
  assert.match(wrong.headers.get("location")!, /error=invalid$/);
  assert.equal(wrong.cookies.get(NEXT_FEST_ACCESS_COOKIE), undefined);
  const foreign = await POST(new NextRequest(URL, { method: "POST", headers: { origin: "https://example.com" }, body: new URLSearchParams({ password: "fixture-password" }) }));
  assert.equal(foreign.status, 403);
  const malformed = await POST(new NextRequest(URL, { method: "POST", body: "not a form" }));
  assert.equal(malformed.status, 400);
  assert.equal(getNextFestCookieOptions().path, "/next-fest");
});
