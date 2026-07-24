# Apps Projection Native Scheduler

The production Apps projection refresh is designed to run as a custom
Timescale background job inside Tiger. It refreshes the maintained legacy
materializations every four hours; the v2 Apps views read through those same
materializations and do not require a second refresh or copy.

The schema source is
`packages/data-plane/sql/tiger-bootstrap/0091_apps_projection_native_scheduler.sql`.
It installs the job **disabled**. Applying the SQL, running the job manually,
and enabling it are three distinct production writes and each requires its own
explicit approval.

## Why Tiger owns the cadence

- Tiger already runs Timescale background jobs and exposes their status,
  history, retries, and errors.
- The measured refresh used about 42 seconds of database work. At six runs per
  day, that is about 4.2 minutes per day or 2.1 hours per 30-day month on the
  existing service.
- No new service, container, or database extension is required.
- A fixed four-hour cadence leaves four hours of scheduling/failure margin
  inside the eight-hour SLO.
- Observed GitHub scheduled events were delayed by up to 2 hours 19 minutes, so
  a six-hour GitHub cadence did not provide enough SLO margin.

The GitHub
`.github/workflows/apps-projection-refresh.yml` workflow remains manual-only.
It is an operator fallback, not a second scheduler.

## Installed contract

The native job has these fail-closed properties:

| Property                 | Value                                                   |
| ------------------------ | ------------------------------------------------------- |
| Procedure                | `ops.refresh_apps_page_projections_job(integer, jsonb)` |
| Job name                 | `apps-projection-refresh-v1`                            |
| Config                   | `{"contract_version":"apps-projection-refresh/v1"}`     |
| Cadence                  | every 4 hours                                           |
| Fixed UTC slots          | `00:47`, `04:47`, `08:47`, `12:47`, `16:47`, `20:47`    |
| Initial state            | `scheduled = false`                                     |
| Maximum runtime          | 45 minutes                                              |
| Retries                  | 3, 15 minutes apart                                     |
| Refresh lock timeout     | 15 seconds                                              |
| Apps statement timeout   | 30 minutes                                              |
| Filter statement timeout | 10 minutes                                              |

The procedure uses only the two allowlisted relations:

1. `metrics.apps_page_projection`
2. `metrics.apps_page_filter_counts`

Both refresh concurrently. The run fails—and therefore appears as failed in
Timescale job history—unless:

- eligible `legacy.apps` and the Apps projection have the same row count;
- their app ID sets match exactly;
- legacy and v2 Apps row counts match; and
- materialized filter counts exactly match a recomputation from the Apps
  projection.

## Recovery gate

Before any install, smoke, enable, disable, or manual fallback:

1. Verify production Tiger is ready.
2. Verify the authenticated Tiger console still offers the expected recovery
   point/fork controls.
3. Capture current projection parity and job state.
4. Present the exact write, reason, risk, and rollback.
5. Obtain explicit approval for that operation.

Do not use Supabase for this operation. Apps ingestion and projection data are
Tiger product data.

## Read-only preflight

Resolve the job by procedure identity; never copy a job ID from another
environment:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT
  jobs.job_id,
  jobs.application_name,
  jobs.schedule_interval,
  jobs.max_runtime,
  jobs.max_retries,
  jobs.retry_period,
  jobs.scheduled,
  jobs.fixed_schedule,
  jobs.config,
  jobs.initial_start,
  jobs.next_start,
  stats.last_run_started_at,
  stats.last_successful_finish,
  stats.last_run_status,
  stats.job_status,
  stats.last_run_duration,
  stats.total_runs,
  stats.total_successes,
  stats.total_failures
FROM timescaledb_information.jobs jobs
LEFT JOIN timescaledb_information.job_stats stats
  USING (job_id)
WHERE jobs.proc_schema = 'ops'
  AND jobs.proc_name = 'refresh_apps_page_projections_job';

COMMIT;
```

Exactly zero rows are expected before 0091 is installed. Exactly one row is
required afterward. More than one row is a blocker.

## Install disabled

Applying 0091 creates or replaces the validator and procedure, registers one
job, and enforces `scheduled = false`. This is a production schema/runtime
metadata write. Do not include it in an automatic bootstrap.

After the separately approved apply, repeat the read-only preflight and prove:

- exactly one matching job exists;
- `scheduled = false`;
- the interval, fixed schedule, UTC anchor, limits, retries, and config match
  the table above; and
- no run history exists unless a separately approved smoke has occurred.

Reapplying 0091 deliberately returns the job to disabled. This prevents a
bootstrap replay from silently starting recurring production writes.

## Manual smoke

A native smoke is a full projection refresh and therefore a production
database write. After separate approval, substitute the job ID resolved by the
read-only query:

```sql
CALL public.run_job(<resolved_job_id>);
```

`run_job` must not be wrapped in a transaction block. When it returns, verify
job history, exact parity, projection query latency, the live Apps route, and
the PICS cursor. Keep both Railway services named `publisheriq` stopped; this
job does not depend on either service.

## Enable recurring execution

Enabling creates six recurring production refreshes per day. After a successful
native smoke, fresh recovery proof, and separate approval:

```sql
SELECT *
FROM public.alter_job(
  job_id => <resolved_job_id>,
  scheduled => true
);
```

Immediately verify that `scheduled = true` and `next_start` is the next
four-hour `:47` UTC slot. If either condition is false, disable the job and
investigate.

## Health and SLO

Use `timescaledb_information.job_stats.last_successful_finish` as the scheduler
freshness clock. `metrics.apps_page_projection.data_updated_at` is source-data
provenance, not proof of when the materialization last ran.

The Apps projection is healthy only when:

- exactly one matching job exists and is scheduled;
- `last_run_status = 'Success'`;
- `clock_timestamp() - last_successful_finish <= interval '8 hours'`;
- no active run exceeds 45 minutes;
- eligible source/projection row and app ID parity remain exact; and
- the live Apps route meets its response-shape and latency checks.

Inspect recent failures with a bounded query:

```sql
SELECT
  job_id,
  start_time,
  finish_time,
  sqlerrcode,
  err_message
FROM timescaledb_information.job_errors
WHERE job_id = <resolved_job_id>
  AND start_time >= clock_timestamp() - interval '7 days'
ORDER BY start_time DESC
LIMIT 50;
```

## Disable and rollback

The immediate rollback is to stop future runs:

```sql
SELECT *
FROM public.alter_job(
  job_id => <resolved_job_id>,
  scheduled => false
);
```

Disabling is a production metadata write and requires approval unless it is an
active incident response already authorized by the operator. It does not
cancel an in-progress refresh. Wait for the active run to finish or fail, then
confirm `scheduled = false` and `next_start = 'infinity'`.

After disabling, the last successfully materialized data remains readable.
Use the approval-gated GitHub manual workflow only after proving no native run
is active. Removing the job/procedure is not part of routine rollback and
requires separate destructive-change approval.
