# Bug Dossier: PICS retry work starves behind pending backlog

- Bug ID: `20260725-071946-pics-retry-work-starves-behind-pending-backlog`
- Status: `fixed`
- Created At: `2026-07-25T07:19:46.620095+00:00`
- Depth: `broad`
- Triage Score: `2`
- Triage Tier: `3`
- Spawned Agents: `bug_mapper`, `runtime_reproducer`, `impact_analyst`

## Summary

Eligible PICS retry rows can wait behind the entire older pending backlog in
their lane. `claim_work()` correctly protects lane and priority, but then
orders by `next_attempt_at` before distinguishing `retrying` from `pending`.
Live Tiger confirms the catch-up backlog's pending timestamps precede every
retry timestamp. The contained fix is to insert retry state as a tie-breaker
after lane and priority and before time ordering.

## Assessment Depth

The bug scored `2`: database correctness (`+2`), an external background worker
(`+1`), and an already isolated owner (`-1`). Database correctness requires
tier-3 fanout, so mapping, reproduction, and impact were assessed
independently.

## Observed Behavior

- `claim_work()` admits both `pending` and `retrying`.
- Its order is lane, priority, `next_attempt_at`, `dirty_since`, and ID.
- At `2026-07-25T07:21:40.498166Z`, primary catch-up contained:
  - `281,353` pending rows at priority `100`;
  - `31` retrying rows at priority `100`;
  - pending `next_attempt_at`:
    `2026-07-25T03:23:23.169921Z`; and
  - retry `next_attempt_at`: between
    `2026-07-25T05:33:00.909498Z` and
    `2026-07-25T06:58:48.041567Z`.
- The current first 20 catch-up candidates were all pending.
- Live work showed the same, smaller effect: `876` pending and `35` retrying
  rows at priority `200`.
- The three most recent catch-up retries remained valid `attempts=1/8`
  `lease_expired` rows.

## Expected Behavior

Lane order and lane quotas must remain unchanged. Higher priority must still
win inside a lane. When lane and priority are equal, an eligible retry should
be claimed before pending work. The existing retry delay, time ordering among
retries, `SKIP LOCKED` lease behavior, maximum attempts, reconciliation, and
readiness settlement must remain unchanged.

## Evidence Gathered

- Live Tiger evidence:
  [live-retry-ordering.md](artifacts/db/live-retry-ordering.md)
- Current/proposed query plans:
  [claim-order-query-plan.md](artifacts/db/claim-order-query-plan.md)
- Minimal ordering reproduction:
  [current-ordering.md](artifacts/reproduction/current-ordering.md)
- Baseline targeted test:
  [pytest-durable-work-baseline.md](artifacts/tests/pytest-durable-work-baseline.md)
- Code owner:
  `services/pics-service/src/database/durable_work.py`
- Calling path:
  `services/pics-service/src/workers/durable_processor.py`

## Reproduction Result

Reproduced. Live Tiger and a minimal two-row ordering example both show an
eligible retry loses to an equally prioritized pending row solely because the
pending row has an older `next_attempt_at`.

## Likely Root Cause

High confidence: the candidate `ORDER BY` is missing a retry-state
tie-breaker. The fault is localized to selection timing; intake, leases,
settlement, cursor movement, promotion, and API contracts are not implicated.

## Possible Impact / Blast Radius

- Both processor calls use `claim_work()`, but separate calls preserve
  live/new versus catch-up quota isolation.
- Proposed production effect at the captured boundary:
  - catch-up top 40 changes from zero retries to all 31 retries;
  - live top 40 changes from one retry to up to 35 retries.
- Existing reconciliation and readiness rows complete earlier for retries.
- Equally prioritized pending work is delayed by a bounded number of retry
  claims.
- Steam request count remains bounded by the unchanged per-pass quotas.
- No browser route, auth, API, RPC, credit, cursor, archive, or database-shape
  contract changes.

## Database Source of Truth Checks

Tiger was queried directly and read-only. Supabase was not inspected because
it is not authoritative for PICS product work.

The live ordering query confirmed `281,353` catch-up pending rows precede
`31` eligible retries at the same priority. `EXPLAIN` showed both current and
proposed orders use the same parallel scan, bounded sort, and gather-merge
shape. Estimated cost changed by less than one percent, so a new index or
migration is not justified.

## Fix Options

1. Add retry-before-pending after lane and priority. This is the smallest,
   recommended change.
2. Split retry and pending queries and add a partial retry index. This adds
   code and a production schema write without demonstrated benefit.
3. Keep the current order and repair rows manually. This leaves the bug in
   place and violates durable ownership.

## Open Questions

None. The user approved continuing with the specifically proposed contained
ordering change.

## Recommended Verification

- Add a regression test proving order precedence is:
  lane, priority, retry state, time, ID.
- Run the targeted durable-work tests.
- Run the full PICS suite.
- Confirm the diff contains no schema, quota, lane, priority, lease,
  settlement, or production configuration changes.
- Open a draft PR without deploying it.

## Fix Result

The approved ordering tie-breaker was added after lane and priority and before
`next_attempt_at`. A dedicated regression test proves that precedence and
retains `FOR UPDATE ... SKIP LOCKED`. The targeted suite passed `15` tests,
the full PICS suite passed `102` tests, compilation passed, and the final diff
contains no schema, quota, lane, priority, lease, settlement, runtime
configuration, or production mutation.

Validation evidence:
[post-fix-validation.md](artifacts/tests/post-fix-validation.md)
