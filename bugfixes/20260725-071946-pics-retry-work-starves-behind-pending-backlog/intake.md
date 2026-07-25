# Bug Intake: PICS retry work starves behind pending backlog

- Bug ID: `20260725-071946-pics-retry-work-starves-behind-pending-backlog`
- Created At: `2026-07-25T07:19:46.620095+00:00`
- Slug: `pics-retry-work-starves-behind-pending-backlog`

## Original Request

After approving the genuine durable PICS catch-up quota increase from `10` to
`40`, the user instructed Codex to continue to the next step. The immediately
preceding recommended step was to fix the observed retry starvation:
eligible `retrying` work should be selected before equally prioritized
`pending` work within the existing lane and priority protections.

## Supplied Context

- Screenshots copied into the case directory:
  - None
- Relevant files/routes/logs:
  - `services/pics-service/src/database/durable_work.py`
  - `services/pics-service/src/workers/durable_processor.py`
  - `services/pics-service/tests/test_durable_processing.py`
  - Live Tiger `ops.pics_work_state`
  - Genuine Railway PICS deployment
    `6cadb3f4-b55a-4fbc-a055-2197aedc62d1`
  - At `2026-07-25T07:11:40Z`, the known `lease_expired` retry pool had
    decreased from its controlled-redeploy peak of `67` to `66`; all other
    retry/dead-letter error categories were absent.
  - Three controlled-redeploy catch-up retries had `priority=100`,
    `attempts=1/8`, and eligible `next_attempt_at` values, but remained behind
    older `priority=100` pending catch-up work.
  - The current claim query orders lane, priority, `next_attempt_at`,
    `dirty_since`, and ID without preferring `retrying` over `pending`.

## Constraints

- The user's “continue onto next step” approves the specifically proposed
  retry-ordering fix.
- Preserve lane separation and existing lane order (`new`, `live`, then
  `catchup`).
- Preserve priority ordering within a lane.
- Only prefer retrying work when lane and priority are equal.
- Do not mutate Tiger, R2, Railway, Supabase, or production queue rows.
- Supabase is not a product-data source for this investigation.
- Use bounded read-only Tiger checks and the live service as sources of truth.
- Open a draft PR; do not merge or deploy without separate approval.

## Notes

This is a backend queue-correctness defect with a known owning query. Triage
score is `2`: database correctness (`+2`), external/background worker (`+1`),
and an already isolated owning function (`-1`). The database-correctness
override requires tier-3 assessment fanout.
