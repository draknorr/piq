# Apps Projection Native Scheduler Enablement

Status: **enabled; background-worker validation passed; natural cycles pending**

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
next-start override. It does not prove that a naturally timed slot will fire,
and it does not replace the three-healthy-daily-cycle cutover gate.

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

## Remaining gate

The next natural slot is `2026-07-25T00:47:00Z`. Monitoring must still capture:

- a naturally triggered successful execution at a fixed `:47` UTC slot;
- three healthy daily cycles;
- exact source/projection/app-ID/filter parity after each checkpoint;
- an eight-hour-or-better scheduler freshness clock;
- no unexplained errors, prolonged runs, or route regressions; and
- unchanged PICS cursor containment and stopped state for both Railway
  services named `publisheriq`.

No Apps reader cutover is authorized by this record. After the three-cycle gate
passes, `APP_PROJECTION_VERSION=v2` remains the lowest-risk first surface
cutover and requires its own deployment approval.
