import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupOpportunitySourceEvents,
  type OpportunitySourceEvent,
} from "./material-events.js";

function event(
  overrides: Partial<OpportunitySourceEvent> = {},
): OpportunitySourceEvent {
  return {
    affectsEligibilityInputs: true,
    afterValue: { value: "new" },
    appid: 10,
    beforeValue: { value: "old" },
    effectiveAt: "2026-07-27T00:00:00.000Z",
    observedAt: "2026-07-27T00:00:00.000Z",
    rawEventType: "tags_added",
    signalFamily: "taxonomy",
    source: "storefront",
    sourceEventId: "1",
    ...overrides,
  };
}

describe("opportunity material event classifier", () => {
  it("groups related events into one stable material moment", () => {
    const moments = groupOpportunitySourceEvents([
      event(),
      event({
        observedAt: "2026-07-27T00:10:00.000Z",
        rawEventType: "genres_changed",
        sourceEventId: "2",
      }),
    ]);

    assert.equal(moments.length, 1);
    assert.equal(moments[0]!.eventType, "taxonomy_repositioned");
    assert.equal(moments[0]!.rawEventIds.length, 2);
    assert.equal(moments[0]!.createsDailyResult, true);
  });

  it("keeps separate change moments outside the grouping window", () => {
    const moments = groupOpportunitySourceEvents([
      event(),
      event({
        observedAt: "2026-07-27T01:00:00.000Z",
        sourceEventId: "2",
      }),
    ]);

    assert.equal(moments.length, 2);
    assert.notEqual(moments[0]!.eventFingerprint, moments[1]!.eventFingerprint);
  });

  it("makes first observation the only v1 immediate event", () => {
    const firstObserved = groupOpportunitySourceEvents([
      event({
        rawEventType: "first_observed",
        signalFamily: "release",
        source: "catalog",
      }),
    ])[0]!;
    const released = groupOpportunitySourceEvents([
      event({
        afterValue: { is_released: true },
        rawEventType: "release_state_changed",
        signalFamily: "release",
      }),
    ])[0]!;

    assert.equal(firstObserved.eligibleForImmediate, true);
    assert.equal(released.eligibleForImmediate, false);
    assert.equal(released.eventType, "released");
  });

  it("keeps low-value churn for re-evaluation without forcing a result", () => {
    const moment = groupOpportunitySourceEvents([
      event({
        rawEventType: "discount_start",
        signalFamily: "pricing",
      }),
    ])[0]!;

    assert.equal(moment.reevaluateEligibility, true);
    assert.equal(moment.createsDailyResult, false);
  });
});
