import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeOpportunityLocalDeliveryTime } from "./service.js";

describe("opportunity profile delivery schedule", () => {
  it("defaults new profiles to 09:00 local time", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime(undefined), "09:00");
  });

  it("accepts bounded 24-hour times and rejects ambiguous input", () => {
    assert.equal(normalizeOpportunityLocalDeliveryTime("06:45"), "06:45");
    assert.equal(normalizeOpportunityLocalDeliveryTime("23:59"), "23:59");
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("9:00"),
      /24-hour HH:MM/,
    );
    assert.throws(
      () => normalizeOpportunityLocalDeliveryTime("24:00"),
      /24-hour HH:MM/,
    );
  });
});
