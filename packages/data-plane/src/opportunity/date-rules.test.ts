import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateOpportunityDateComparison,
  localDateStartUtc,
  resolveOpportunityRelativeDateRange,
} from "./date-rules.js";

describe("opportunity date rules", () => {
  const context = {
    asOf: "2026-07-30T18:00:00.000Z",
    timezone: "America/Los_Angeles",
  };

  it("uses local calendar days and ISO Monday weeks", () => {
    assert.deepEqual(resolveOpportunityRelativeDateRange("today", context), {
      endDateExclusive: "2026-07-31",
      startDate: "2026-07-30",
    });
    assert.deepEqual(
      resolveOpportunityRelativeDateRange("this_week", context),
      {
        endDateExclusive: "2026-08-03",
        startDate: "2026-07-27",
      },
    );
    assert.deepEqual(
      resolveOpportunityRelativeDateRange("next_7_days", context),
      {
        endDateExclusive: "2026-08-07",
        startDate: "2026-07-31",
      },
    );
  });

  it("turns local added-date days into UTC boundaries across DST", () => {
    const springStart = Date.parse(
      localDateStartUtc("2026-03-08", "America/Los_Angeles"),
    );
    const springEnd = Date.parse(
      localDateStartUtc("2026-03-09", "America/Los_Angeles"),
    );
    const fallStart = Date.parse(
      localDateStartUtc("2026-11-01", "America/Los_Angeles"),
    );
    const fallEnd = Date.parse(
      localDateStartUtc("2026-11-02", "America/Los_Angeles"),
    );

    assert.equal((springEnd - springStart) / 3_600_000, 23);
    assert.equal((fallEnd - fallStart) / 3_600_000, 25);
  });

  it("compares DATE values and TIMESTAMPTZ values with the same calendar contract", () => {
    assert.equal(
      evaluateOpportunityDateComparison({
        actual: "2026-07-30",
        context,
        field: "release_date",
        operand: { kind: "relative_window", window: "today" },
        operator: "in_window",
      }),
      true,
    );
    assert.equal(
      evaluateOpportunityDateComparison({
        actual: "2026-07-31T06:30:00.000Z",
        context,
        field: "publisheriq_added_at",
        operand: { date: "2026-07-30", kind: "absolute_date" },
        operator: "equals",
      }),
      true,
    );
    assert.equal(
      evaluateOpportunityDateComparison({
        actual: null,
        context,
        field: "release_date",
        operand: { date: "2026-07-30", kind: "absolute_date" },
        operator: "less_than",
      }),
      null,
    );
  });
});
