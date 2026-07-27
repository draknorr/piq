import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpportunityDestinationCipher } from "./delivery-secrets.js";

describe("opportunity delivery destination encryption", () => {
  it("round-trips a destination without storing plaintext", () => {
    const cipher = new OpportunityDestinationCipher(
      Buffer.alloc(32, 7).toString("base64"),
    );
    const plaintext = "https://hooks.slack.com/services/example";
    const encrypted = cipher.encrypt(plaintext);

    assert.notEqual(encrypted, plaintext);
    assert.doesNotMatch(encrypted, /hooks\.slack/);
    assert.equal(cipher.decrypt(encrypted), plaintext);
  });

  it("rejects keys that are not 256 bits", () => {
    assert.throws(
      () => new OpportunityDestinationCipher("too-short"),
      /exactly 32 bytes/,
    );
  });
});
