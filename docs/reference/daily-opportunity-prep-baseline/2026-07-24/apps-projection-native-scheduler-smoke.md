# Apps Projection Native Scheduler Smoke

Executed and verified on July 24, 2026 UTC. This record covers one approved
foreground execution of disabled Timescale job `1016`. It does not authorize
or record recurring execution, a reader cutover, deployment, Supabase
operation, or PICS action.

## Approved operation

- Target: Tiger project `n9lactseoj`, production service
  `publisheriq-tiger-prod` (`hdp8cp0w5i`), database `tsdb`.
- Registered procedure:
  `ops.refresh_apps_page_projections_job(integer, jsonb)`.
- Exact command: `CALL public.run_job(1016);`.
- Intended writes:
  - concurrent refresh of `metrics.apps_page_projection`;
  - concurrent refresh of `metrics.apps_page_filter_counts`.
- Intended post-refresh checks:
  eligible source row and app-ID parity, legacy/v2 parity, and exact
  filter-count parity.
- Risk presented: medium because the full refresh uses production CPU, I/O,
  and brief locks.
- Failure containment presented: the procedure transaction retains the
  previous materializations on failure, and the job remains paused.
- Explicit approval: the user replied `yes` after the exact call, effect,
  reason, risk, failure containment, and disabled post-success state were
  presented in the current Codex task.

## Recovery and preflight

Immediately before the write:

- the authenticated Tiger CLI reported `publisheriq-tiger-prod`
  (`hdp8cp0w5i`) as `READY`;
- the authenticated Tiger recovery form offered a point-in-time recovery fork
  to any point in the last three days;
- the `Create recovery fork` control was enabled;
- no recovery fork was submitted or created;
- job `1016` had `scheduled = false`, `job_status = 'Paused'`, zero runs, zero
  successes, zero failures, and zero job-error rows;
- no Apps projection refresh was active;
- eligible source, legacy, and v2 counts were
  `224,050 / 224,030 / 224,030`;
- `21` eligible source IDs were absent from the projection and `1` projected
  ID was no longer eligible;
- the PICS cursor was `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`; and
- both Railway services named `publisheriq` were stopped.

Supabase was not inspected or changed because this was a Tiger-only
product-data operation.

## Execution result

The foreground call completed successfully in approximately 32 seconds and
the PostgreSQL client reported:

```text
CALL
```

The recurring job remained disabled throughout the smoke.

## Post-smoke data verification

At `2026-07-24T21:41:19.123292Z`:

| Check                          | Source/expected | Legacy/actual | v2/difference |
| ------------------------------ | --------------: | ------------: | ------------: |
| Eligible Apps rows             |         224,050 |       224,050 |       224,050 |
| Source IDs missing from legacy |               — |             — |             0 |
| Legacy IDs missing from source |               — |             — |             0 |
| Legacy/v2 ID differences       |               — |             — |         0 / 0 |
| Filter-count rows              |             585 |           585 | 0 differences |

Additional verification:

- newest projected source time:
  `2026-07-24T21:40:07.676868Z`;
- active Apps projection refreshes: `0`;
- job-error rows: `0`;
- PICS cursor unchanged at `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`; and
- the authenticated production `/apps` route loaded a populated 50-row table,
  displayed `130.9K games`, and retained working game and Steam links.

The browser-facing Games count is not expected to equal the projection count:
the page is on its Games surface and applies its existing type/query contract.

## Foreground history behavior

After the successful foreground call, production Tiger 2.27.2 still reported:

- `scheduled = false`;
- `job_status = 'Paused'`;
- job stats `0 / 0 / 0` for runs, successes, and failures;
- `last_run_started_at = '-infinity'`;
- `last_successful_finish = '-infinity'`;
- zero `job_history` rows for job `1016`; and
- `timescaledb.enable_job_execution_logging = on`.

This is live evidence that `CALL run_job` in the current session does not
create background-worker scheduler history on this service. The foreground
client result plus independent data-contract checks are the smoke proof.
`job_stats` and `job_history` remain the health evidence for later scheduled
background executions.

## Runtime containment

Read-only Railway checks after the smoke reported `stopped=true` and latest
deployment status `FAILED` for both same-named services:

- genuine legacy PICS in project `enthusiastic-caring`,
  `e6c49263-8466-4cb5-a37f-16299aae499e`;
- duplicate-named service in project `confident-education`,
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`.

Neither service was restarted, redeployed, reconnected, or used by the
scheduler.

## Next gate

Recurring execution remains disabled. Enabling it is a separate production
metadata write authorizing six refreshes per day and requires fresh recovery
and database preflight evidence plus explicit approval.

Because the paused job retains a past `next_start`, the approved enable command
must also set `next_start` to the next future four-hour `:47` UTC slot. This
prevents enablement from unintentionally triggering an immediate catch-up run.
The first scheduled background execution must then prove job history, duration,
exact parity, route health, and the eight-hour freshness SLO before the
scheduler is considered healthy.
