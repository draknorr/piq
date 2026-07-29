import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeOpportunityChange } from "./api.js";
import type { OpportunityObservedChange } from "./types.js";

const baseChange: OpportunityObservedChange = {
  affectedRuleFields: ["price_cents"],
  after: null,
  before: null,
  confidence: "high",
  effectiveAt: "2026-07-27T07:30:00.000Z",
  eventType: "business_model_changed",
  observedAt: "2026-07-27T07:31:00.000Z",
  signalFamily: "pricing",
};

describe("opportunity observed-change presentation", () => {
  it("formats exact stored values for customer-facing changes", () => {
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        after: [{ price_cents: 1499 }],
        before: [{ price_cents: 1999 }],
      }),
      "Price changed from $19.99 to $14.99.",
    );
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        affectedRuleFields: ["developer"],
        after: [{ developers: ["Harborlight"] }],
        before: [{ developers: ["Old Harbor Studio"] }],
        eventType: "developer_changed",
        signalFamily: "store-page",
      }),
      "Developer changed from Old Harbor Studio to Harborlight.",
    );
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        affectedRuleFields: ["platforms"],
        after: [{ platforms: { mac: true, windows: true } }],
        before: [{ platforms: { mac: false, windows: true } }],
        eventType: "platform_expanded",
        signalFamily: "platform",
      }),
      "macOS support was added.",
    );
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        affectedRuleFields: ["tags"],
        after: '[{"tags":["Cozy","Deckbuilder"]}]',
        before: '[{"tags":["Cozy","Puzzle"]}]',
        eventType: "taxonomy_repositioned",
        signalFamily: "taxonomy",
      }),
      "Steam tags changed: added Deckbuilder; removed Puzzle.",
    );
  });

  it("uses truthful fallbacks for null, sparse, and malformed evidence", () => {
    assert.equal(
      describeOpportunityChange(null),
      "PublisherIQ identified a new sourcing signal, but no before-and-after snapshot is linked.",
    );
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        affectedRuleFields: ["publisher"],
        after: "{malformed",
        before: null,
        eventType: "publisher_changed",
        signalFamily: "store-page",
      }),
      "The listed publisher changed, but the stored evidence does not contain both names.",
    );
    assert.equal(
      describeOpportunityChange({
        ...baseChange,
        after: "{malformed",
        before: "[malformed",
      }),
      "The game's price or business model changed, but the stored evidence does not support a more exact comparison.",
    );
  });
});
