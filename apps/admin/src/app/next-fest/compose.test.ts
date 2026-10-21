import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { composeNextFestPage, EXPLORER_PAYLOAD_SLOT } from "./compose";

const atlas = (payload: string) =>
  `<html><body>legacy<script type="application/octet-stream" id="nf-payload">${payload}</script></body></html>`;
const shell = `<html><body>explorer<script type="application/octet-stream" id="nf-payload">${EXPLORER_PAYLOAD_SLOT}</script></body></html>`;

test("injects the atlas snapshot into the explorer shell", () => {
  const html = composeNextFestPage(atlas("H4sIAAAA+/9="), shell);
  assert.match(html, /explorer/);
  assert.match(html, /id="nf-payload">H4sIAAAA\+\/9=<\/script>/);
  assert.doesNotMatch(html, /legacy/);
});

test("ignores payloads that are not base64", () => {
  const unsafe = atlas('H4sI"onload="x');
  assert.equal(composeNextFestPage(unsafe, shell), unsafe);
});

test("falls back to the legacy atlas when the shell or payload is unusable", () => {
  assert.equal(composeNextFestPage(atlas("H4sI"), null), atlas("H4sI"));
  assert.equal(composeNextFestPage(atlas("H4sI"), "<html>no slot</html>"), atlas("H4sI"));
  assert.equal(composeNextFestPage("<html>no payload</html>", shell), "<html>no payload</html>");
});

test("the published explorer shell keeps exactly one payload slot", () => {
  const html = readFileSync(path.join(process.cwd(), "src", "app", "next-fest", "content", "explorer.html"), "utf8");
  assert.equal(html.split(EXPLORER_PAYLOAD_SLOT).length, 2);
  assert.match(html, new RegExp(`id="nf-payload">${EXPLORER_PAYLOAD_SLOT}</script>`));
});
