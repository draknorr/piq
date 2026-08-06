import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOpportunityPriorityV2OrderControl,
  createOpportunityWorkspaceFeatureControl,
  isOpportunityWorkspaceFeatureEnabled,
} from "./feature-controls.js";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000300";

describe("opportunity workspace feature controls", () => {
  it("fails closed when the master control is off", () => {
    const control = createOpportunityWorkspaceFeatureControl("0", WORKSPACE_ID);

    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(control, WORKSPACE_ID),
      false,
    );
  });

  it("enables only allowlisted workspaces", () => {
    const control = createOpportunityWorkspaceFeatureControl(
      "1",
      WORKSPACE_ID.toUpperCase(),
    );

    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(control, WORKSPACE_ID),
      true,
    );
    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(
        control,
        "00000000-0000-4000-8000-000000000301",
      ),
      false,
    );
  });

  it("requires an explicit valid scope when enabled", () => {
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", ""),
      /requires a workspace allowlist/,
    );
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", "invalid"),
      /invalid UUID/,
    );
  });

  it("supports a standalone wildcard for general rollout", () => {
    const control = createOpportunityWorkspaceFeatureControl("1", "*");
    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(
        control,
        "00000000-0000-4000-8000-000000000999",
      ),
      true,
    );
    assert.throws(
      () => createOpportunityWorkspaceFeatureControl("1", `*,${WORKSPACE_ID}`),
      /cannot be combined/,
    );
  });
});

describe("opportunity v2 ordering controls", () => {
  it("stays disabled when every policy control is off", () => {
    const control = createOpportunityPriorityV2OrderControl({
      discovery: "0",
      materialChanges: undefined,
      traction: "0",
      workspaceIds: WORKSPACE_ID,
    });

    assert.equal(control.enabled, false);
    assert.equal(control.allPolicies, false);
  });

  it("requires an atomic all-policy workspace-scoped rollout", () => {
    assert.throws(
      () =>
        createOpportunityPriorityV2OrderControl({
          discovery: "1",
          materialChanges: "0",
          traction: "1",
          workspaceIds: WORKSPACE_ID,
        }),
      /requires all three policy controls/,
    );
    assert.throws(
      () =>
        createOpportunityPriorityV2OrderControl({
          discovery: "1",
          materialChanges: "1",
          traction: "1",
          workspaceIds: "",
        }),
      /requires a workspace allowlist/,
    );
  });

  it("enables all policies only for the explicit workspace scope", () => {
    const control = createOpportunityPriorityV2OrderControl({
      discovery: "1",
      materialChanges: "1",
      traction: "1",
      workspaceIds: WORKSPACE_ID,
    });

    assert.equal(control.allPolicies, true);
    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(control, WORKSPACE_ID),
      true,
    );
    assert.equal(
      isOpportunityWorkspaceFeatureEnabled(
        control,
        "00000000-0000-4000-8000-000000000301",
      ),
      false,
    );
  });
});
