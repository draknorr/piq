import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOpportunityWorkspaceFeatureControl } from "./feature-controls";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000300";

describe("opportunity workspace feature controls", () => {
  it("fails closed when the master control is off", () => {
    const control = createOpportunityWorkspaceFeatureControl("0", WORKSPACE_ID);

    assert.equal(control.enabled, false);
    assert.equal(control.allWorkspaces, false);
    assert.equal(control.workspaceIds.size, 0);
  });

  it("normalizes and deduplicates scoped workspace IDs", () => {
    const control = createOpportunityWorkspaceFeatureControl(
      "1",
      ` ${WORKSPACE_ID.toUpperCase()},${WORKSPACE_ID} `,
    );

    assert.equal(control.enabled, true);
    assert.equal(control.allWorkspaces, false);
    assert.deepEqual([...control.workspaceIds], [WORKSPACE_ID]);
  });

  it("requires an explicit scope when enabled", () => {
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", ""),
      /requires a workspace allowlist/,
    );
  });

  it("accepts only a standalone wildcard for general rollout", () => {
    const general = createOpportunityWorkspaceFeatureControl("1", "*");
    assert.equal(general.allWorkspaces, true);
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", `*,${WORKSPACE_ID}`),
      /cannot be combined/,
    );
  });

  it("rejects malformed workspace IDs", () => {
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", "not-a-workspace"),
      /invalid UUID/,
    );
  });
});
