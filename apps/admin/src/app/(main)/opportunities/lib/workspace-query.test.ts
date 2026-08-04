import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseOpportunityEventFilter,
  parseOpportunityWorkspaceTab,
} from "./workspace-query";

describe("opportunity workspace URL state", () => {
  it("defaults missing and invalid tabs to Daily Brief", () => {
    assert.equal(parseOpportunityWorkspaceTab(null), "daily-brief");
    assert.equal(parseOpportunityWorkspaceTab("unknown"), "daily-brief");
  });

  it("restores every addressable workspace tab", () => {
    for (const tab of [
      "daily-brief",
      "profile-lists",
      "profiles",
      "delivery",
    ] as const) {
      assert.equal(parseOpportunityWorkspaceTab(tab), tab);
    }
  });

  it("accepts only the five Profile Lists event filters", () => {
    assert.equal(
      parseOpportunityEventFilter("materially_changed"),
      "materially_changed",
    );
    assert.equal(parseOpportunityEventFilter("not-an-event"), null);
  });
});
