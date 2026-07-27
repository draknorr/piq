import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL(
    "../../../../.github/workflows/opportunity-reconcile.yml",
    import.meta.url,
  ),
  "utf8",
);
const script = readFileSync(
  new URL("../scripts/reconcile-opportunity-events.ts", import.meta.url),
  "utf8",
);

test("opportunity reconciliation is bounded and manually approval-gated", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /backup_pitr_verified == true/);
  assert.match(workflow, /approval_reference != ''/);
  assert.match(script, /const MAX_PASSES = 10/);
  assert.match(script, /repository\.materializeEvents\(\)/);
});

test("opportunity reconciliation cannot dispatch delivery work", () => {
  assert.doesNotMatch(script, /OpportunityDelivery/);
  assert.doesNotMatch(workflow, /opportunity-worker/);
  assert.match(workflow, /opportunity-reconcile/);
});
