import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatOpportunityMetricValue } from "./api";

describe("opportunity metric presentation", () => {
  it("formats prices as cents and discounts as percentages", () => {
    assert.equal(formatOpportunityMetricValue("price_cents", 3249), "$32.49");
    assert.equal(formatOpportunityMetricValue("Current discount", 35), "35%");
    assert.equal(formatOpportunityMetricValue("discount_percent", 35), "35%");
    assert.equal(
      formatOpportunityMetricValue("Positive Steam review rate", 92),
      "92%",
    );
  });
});
