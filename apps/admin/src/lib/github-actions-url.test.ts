import assert from "node:assert/strict";
import test from "node:test";

import { buildGitHubActionsRunUrl } from "./github-actions-url";

test("buildGitHubActionsRunUrl targets the current repository", () => {
  assert.equal(
    buildGitHubActionsRunUrl("30234313903"),
    "https://github.com/draknorr/piq/actions/runs/30234313903",
  );
});

test("buildGitHubActionsRunUrl safely encodes the run identifier", () => {
  assert.equal(
    buildGitHubActionsRunUrl("run/with spaces"),
    "https://github.com/draknorr/piq/actions/runs/run%2Fwith%20spaces",
  );
});
