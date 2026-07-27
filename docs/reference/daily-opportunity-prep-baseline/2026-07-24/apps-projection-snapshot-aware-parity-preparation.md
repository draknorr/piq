# Apps Projection Snapshot-Aware Parity Preparation

Status: **approved and applied to production Tiger on 2026-07-27 UTC; next
natural fixed-slot execution pending validation**.

## Why a forward migration is required

Applied migration 0091 refreshes
`metrics.apps_page_projection` and `metrics.apps_page_filter_counts`
concurrently, then compares the projection with a later statement-level
snapshot of mutable `legacy.apps`.

Accepted catalog writes between the refresh snapshot and the later parity
statements can make a valid refresh fail. Because the exception rolls back the
job transaction, it also rolls back the refreshed materialization.

Read-only production evidence on 2026-07-27 UTC:

| Run start | Result           | Evidence                                          |
| --------- | ---------------- | ------------------------------------------------- |
| 00:47:00  | Failed           | projection 226,082; later source snapshot 226,083 |
| 01:02:34  | Failed retry     | projection 226,089; later source snapshot 226,095 |
| 01:35:04  | Successful retry | exact source/projection parity at 226,115         |

At 01:33:53 UTC, before the final retry, the rolled-back production projection
still contained 225,787 rows while the eligible source contained 226,113. The
third attempt finished successfully at 01:36:11 UTC after finding a quiet
source window, committed exact 226,115-row parity, and restored the normal
04:47 UTC fixed-schedule slot. Production recovered without intervention, but
two accepted source races had already reported failures and rolled back valid
refresh work.

## Prepared migration

Forward migration:

`packages/data-plane/sql/tiger-bootstrap/0096_apps_projection_snapshot_aware_parity.sql`

The migration only replaces
`ops.refresh_apps_page_projections_job(integer, jsonb)`. It does not:

- add, alter, enable, disable, or run a Timescale job;
- change job 1016's config, fixed schedule, retry policy, or runtime limit;
- change either materialized-view definition;
- introduce dynamic SQL; or
- change any reader.

The replacement procedure:

1. captures eligible source row count and ordered app-ID fingerprint before
   the refresh;
2. runs the same two allowlisted concurrent refreshes;
3. captures the post-refresh eligible source count/fingerprint, projection
   count, and bidirectional app-ID mismatch in one statement snapshot;
4. enforces exact row and app-ID parity when the source ID set remained
   stable;
5. emits a notice and defers exact source parity to the next fixed-schedule run
   when accepted source writes changed the eligible ID set during the refresh;
6. always enforces v2/legacy row parity; and
7. always enforces exact filter-count parity.

The source-change path does not run a second full refresh inside the same job.
That avoids doubling the worst-case refresh time under the existing 45-minute
job limit. The next fixed-schedule execution retries exact source parity.

## Read-only runtime validation

The two new validation reads were executed directly against production Tiger
without refreshing or changing data:

- source count/fingerprint: about 0.98 seconds;
- single-snapshot source/projection count, fingerprint, and exact ID
  comparison: about 1.34 seconds.

Both are below the procedure's two-minute validation timeout.

## Local validation

- focused scheduler tests: 5/5;
- complete data-plane tests: 95/95;
- repository type-check targets: 13/13;
- data-plane lint: zero errors (existing warnings only);
- repository production build: 10/10;
- `git diff --check`: clean.

The static tests prove that 0096:

- preserves the procedure signature;
- contains exactly the two allowlisted concurrent refreshes;
- does not add/alter/run a job or set scheduled state;
- captures before/after source fingerprints;
- gates exact source parity on `NOT source_changed`; and
- leaves v2 and filter parity mandatory after that conditional.

## Production apply

The user separately approved applying the exact forward migration:

`packages/data-plane/sql/tiger-bootstrap/0096_apps_projection_snapshot_aware_parity.sql`

The bounded preflight recorded:

- procedure definition MD5:
  `7869dad37e0a575e042db5df5151e88a`;
- snapshot-aware markers absent;
- job 1016 scheduled every four hours with
  `{"contract_version":"apps-projection-refresh/v1"}`;
- maximum runtime 45 minutes, three retries, and 15-minute retry period;
- 17 prior runs: 14 successes and 3 failures; and
- next fixed start at `2026-07-27T04:47:00Z`.

The migration ran atomically with `psql -1` and returned only the expected
session settings, `CREATE PROCEDURE`, and `COMMENT`. It did not execute the job.

Post-apply validation recorded:

- procedure definition MD5:
  `9fdc8e71ab143dcc3b148fe865fc11c3`;
- snapshot-aware and source-change deferral markers present;
- unchanged job ID, schedule, config, retry policy, run counters, and next
  start; and
- no foreground refresh or projection mutation caused by the apply.

The remaining gate for this migration is observation of the first natural
fixed-slot execution under the new procedure, followed by exact legacy/v2 and
filter parity validation.

## Rollback boundary

If an applied replacement misbehaves, the immediate containment is to disable
job 1016 after any active run ends. Restoring the prior 0091 procedure body or
performing any compensating schema change also requires production-write
approval.
