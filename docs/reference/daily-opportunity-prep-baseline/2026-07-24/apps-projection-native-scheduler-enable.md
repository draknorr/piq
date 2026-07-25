# Apps Projection Native Scheduler Enablement

Status: **enabled; background-worker and first natural execution passed**

This record covers two separately approved production metadata writes:

1. enabling Tiger Timescale job `1016` on its fixed four-hour cadence; and
2. advancing only its next start to validate an actual Timescale background
   execution without waiting for the next natural slot.

Neither operation changed the job procedure, config, retry policy, cadence, or
the browser-facing Apps reader. Supabase is not part of this Tiger product-data
path.

## Approval and recovery gate

Before enablement, the authenticated production Tiger console still exposed
the previously verified automatic backup, restore/fork, and three-day
continuous recovery controls. The live database preflight resolved exactly one
job by procedure identity:

- job ID: `1016`;
- procedure: `ops.refresh_apps_page_projections_job`;
- config: `{"contract_version":"apps-projection-refresh/v1"}`;
- fixed schedule: every four hours at `:47` UTC;
- maximum runtime: 45 minutes;
- retries: three, 15 minutes apart;
- state: disabled; and
- foreground smoke: passed.

The user separately approved enablement after receiving the exact write,
reason, risk, and rollback. The approved write was:

```sql
SELECT *
FROM public.alter_job(
  job_id => 1016,
  scheduled => true,
  next_start => date_bin(
    interval '4 hours',
    clock_timestamp(),
    timestamptz '2000-01-01 00:47:00+00'
  ) + interval '4 hours'
);
```

The result preserved the expected contract, set `scheduled = true`, and set
the next natural execution to `2026-07-25T00:47:00Z`. It did not cause an
immediate run.

## Forced background-worker validation

The prior `CALL public.run_job(1016)` smoke ran in the client session and did
not exercise the background scheduler or create automation history. To verify
that boundary, the user separately approved one extra refresh through the
actual Timescale background worker.

The preflight at `2026-07-24T22:03:41.011008Z` proved:

- job `1016` was scheduled with next start
  `2026-07-25T00:47:00Z`;
- scheduler statistics were `0` runs, `0` successes, and `0` failures;
- no projection refresh was active;
- no recent history or errors existed;
- the PICS cursor was `37,491,237`, last updated
  `2026-07-24T02:52:52.693840Z`; and
- both Railway services named `publisheriq` remained stopped with deployment
  status `FAILED`.

The separately approved metadata write changed only the next execution time:

```sql
SELECT *
FROM public.alter_job(
  job_id => 1016,
  next_start => clock_timestamp()
);
```

Tiger returned `next_start = 2026-07-24T22:03:53.907064Z`. The background
worker began at `2026-07-24T22:03:54.646851Z`; while it ran, the job reported
`Running` and temporarily set `next_start` to infinity to prevent overlap.

The run completed successfully:

- finish: `2026-07-24T22:04:18.045868Z`;
- duration: `23.399017` seconds;
- job statistics: `1` run, `1` success, `0` failures;
- history row: `4049`, `succeeded = true`;
- SQL error code and message: none;
- final job state: `Scheduled`; and
- restored next start: `2026-07-25T00:47:00Z`.

This proves the actual Timescale automation worker can execute the procedure,
record success and history, and return to the fixed schedule after a one-time
next-start override.

## Post-run reconciliation

Read-only verification at `2026-07-24T22:05:23.531285Z` found:

| Check                                                   | Result                        |
| ------------------------------------------------------- | ----------------------------- |
| Eligible source rows                                    | `224,050`                     |
| Legacy Apps projection rows                             | `224,050`                     |
| V2 Apps projection rows                                 | `224,050`                     |
| Source IDs missing from legacy / legacy missing source  | `0 / 0`                       |
| Legacy IDs missing from v2 / v2 IDs missing from legacy | `0 / 0`                       |
| Expected / materialized filter rows                     | `585 / 585`                   |
| Filter differences                                      | `0`                           |
| Recent scheduler errors                                 | `0`                           |
| Active projection refreshes                             | `0`                           |
| Newest projected source time                            | `2026-07-24T21:48:01.179225Z` |
| PICS cursor                                             | `37,491,237`                  |
| PICS cursor updated                                     | `2026-07-24T02:52:52.693840Z` |
| Genuine PICS Railway service                            | stopped; deployment `FAILED`  |
| Duplicate-named Railway service                         | stopped; deployment `FAILED`  |

The authenticated production route
`https://www.publisheriq.app/apps` remained populated after the background
run. It rendered 50 data rows plus the table header, and the expected
`Counter-Strike 2` app link was visible. The observed `9,396` ms navigation
measurement included an intentional four-second settle and must not be treated
as a route latency or compared with a median/p95 threshold.

## First natural execution

The first natural fixed-schedule execution fired without an operator override
at `2026-07-25T00:47:00.001542Z` and completed successfully at
`2026-07-25T00:48:05.820258Z`.

Read-only verification at `2026-07-25T01:26:50.875460Z` proved:

- scheduler history row `4056` succeeded;
- duration was `65.818716` seconds, below the 45-minute maximum;
- cumulative statistics were two runs, two successes, and zero failures;
- no retry was required and `timescaledb_information.job_errors` returned no
  row for job `1016`;
- job state returned to `Scheduled`;
- the next fixed slot is `2026-07-25T04:47:00Z`; and
- no Apps projection refresh remained active.

The procedure itself fails its transaction unless eligible-source, legacy,
v2, app-ID, and filter-count parity are exact after both concurrent refreshes.
Its successful completion therefore proves exact in-run parity. The bounded
post-run checkpoint at `2026-07-25T01:27:40.625034Z` found:

| Check                                                   | Result                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| Legacy / v2 Apps projection rows                        | `224,066 / 224,066`                        |
| Legacy IDs missing from v2 / v2 IDs missing from legacy | `0 / 0`                                    |
| Expected / legacy / v2 filter rows                      | `585 / 585 / 585`                          |
| Filter differences                                      | `0`                                        |
| Newest projected source time                            | `2026-07-25T00:46:55.374201Z`              |
| Latest metric date                                      | `2026-07-25`                               |
| Eligible source rows at the later checkpoint            | `224,069`                                  |
| Source IDs not yet projected                            | `3`, all written after the natural refresh |

The three later source rows were independently updated after the scheduler
finished:

|    App ID | Name           | Source update                 |
| --------: | -------------- | ----------------------------- |
| `4732330` | Skelemancer TD | `2026-07-25T00:50:42.615924Z` |
| `3759670` | no fox season  | `2026-07-25T00:53:10.124078Z` |
| `4893300` | Hotel Infinity | `2026-07-25T00:53:11.971389Z` |

This is explained post-refresh source movement within the fixed four-hour
cadence, not an in-run parity failure. The next run will reconcile these rows.

The authenticated production `/apps` route remained populated after the
natural run. It rendered 50 game rows, reported `130.9K games`, and exposed the
expected `/apps/730` Counter-Strike 2 link.

## Concurrent containment evidence

The production PICS topology changed under separate approval before this
natural scheduler run. The genuine Railway `publisheriq` service was running
in `PICS_WORK_MODE=shadow` on the isolated
`shadow-fixed-2026-07-24-37517027` stream; it was not a canonical writer. A
bounded Tiger checkpoint found:

- 61 contiguous shadow batches from `37,517,027` through `37,518,432`;
- exact source, durable, and stored parity at `1,275` app positions;
- zero non-shadow batches, zero incomplete batches, zero invalid hashes, and
  zero primary-cursor advances;
- zero cursor gaps, missing work rows, per-app latest-watermark mismatches,
  stale-product-payload errors, expired claims, or dead letters; and
- the canonical cursor unchanged at `37,491,237`, with its original
  `2026-07-24T02:52:52.693840Z` timestamp.

Railway logs showed successful first-attempt reconnects followed by contiguous
batch commits. The duplicate non-PICS `publisheriq` service in project
`c36c95df-2284-4ffc-af85-cd3c31a3b8ea` remained source-disconnected and
stopped with zero active deployments.

## Accelerated gate

The approved accelerated rollout required one healthy natural execution
rather than three scheduler daily cycles. That gate has passed. No scheduler,
database, Railway, or reader mutation was performed while collecting this
evidence.

`APP_PROJECTION_VERSION=v2` may now proceed to its separate deployment
approval and surface-level verification. The fixed four-hour scheduler remains
subject to ongoing health monitoring and should be rolled back only after
fresh evidence of a missed/failed run, unexplained parity difference, or
unsafe runtime behavior.
