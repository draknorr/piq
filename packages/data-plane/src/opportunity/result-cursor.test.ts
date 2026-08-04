import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeOpportunityResultCursor,
  encodeOpportunityResultCursor,
  opportunityCursorFilterKey,
} from "./result-cursor.js";
import type { OpportunityResultSummary } from "./types.js";

const result = {
  appid: 42,
  id: "00000000-0000-0000-0000-000000000042",
  score: 91.5,
} as OpportunityResultSummary;

describe("opportunity result cursors", () => {
  it("round-trips the stable score, appid, and result position", () => {
    const filterKey = opportunityCursorFilterKey({
      eventLabel: "newly_qualified",
      profileId: "profile-a",
      runId: "run-a",
    });
    const cursor = encodeOpportunityResultCursor(result, filterKey);

    assert.deepEqual(decodeOpportunityResultCursor(cursor, filterKey), {
      appid: 42,
      filterKey,
      id: "00000000-0000-0000-0000-000000000042",
      score: 91.5,
    });
  });

  it("rejects cursors reused with another run or filter identity", () => {
    const cursor = encodeOpportunityResultCursor(
      result,
      opportunityCursorFilterKey({
        eventLabel: null,
        profileId: "profile-a",
        runId: "run-a",
      }),
    );

    assert.throws(
      () =>
        decodeOpportunityResultCursor(
          cursor,
          opportunityCursorFilterKey({
            eventLabel: "tracked_update",
            profileId: "profile-a",
            runId: "run-b",
          }),
        ),
      /invalid for these filters/,
    );
  });

  it("rejects malformed opaque cursors", () => {
    assert.throws(
      () => decodeOpportunityResultCursor("not-a-cursor", "run:all:all"),
      /invalid for these filters/,
    );
  });
});
