# Apps Projection Native Scheduler Decision

Status: **installed disabled; native smoke pending separate approval**

This record captures the Option A decision for the recurring Apps projection
refresh. No scheduler job, function, procedure, extension, service, deployment,
reader flag, or recurring database write was created or enabled while making
this decision.

## Live source-of-truth checks

Read-only production Tiger inspection confirmed:

- TimescaleDB `2.27.2` is installed;
- `pg_cron` is available but not installed;
- Tiger already runs native Timescale background jobs;
- the live `add_job`, `alter_job`, `run_job`, and `delete_job` APIs support the
  required fixed schedule, config validator, disabled state, runtime, retry,
  and UTC controls; and
- `timescaledb_information.jobs`, `job_stats`, and `job_errors` expose the
  required identity, last-success, duration, retry, and failure evidence.

Final containment check at `2026-07-24T20:02:49.715113Z`:

- matching native Apps jobs: `0`;
- eligible source rows: `224,031`;
- legacy and v2 projection rows: `224,030 / 224,030`;
- current projection delta: `-1`, reflecting one source row added since the
  separately approved manual refresh;
- latest projected source-data freshness: `0.786` hours; and
- PICS cursor unchanged at `37,491,237`, updated
  `2026-07-24T02:52:52.69384Z`.

The row delta is timestamped evidence, not an enablement threshold. It also
demonstrates why a durable cadence is needed; no further refresh was authorized
while preparing the source.

The approved manual GitHub refresh completed the two materializations in about
42 seconds. A four-hour cadence is six runs per day:

- about `252` seconds (`4.2` minutes) of database work per day;
- about `7,560` seconds (`2.1` hours) per 30-day month; and
- no additional always-on service or extension.

On the current 0.5 CPU / 2 GiB Tiger service, expected incremental billed cost
is effectively zero unless the recurring refresh materially changes service
utilization or forces a larger plan.

## Decision

Use a custom Timescale job because it:

- uses the existing database scheduler and failure history;
- avoids a new Railway worker or other always-on service;
- avoids GitHub schedule-delay risk;
- keeps the same data and scheduler failure domain, which is acceptable for a
  derived projection with a manual fallback;
- leaves four hours of margin inside the eight-hour SLO; and
- can be disabled without changing any browser-facing reader.

The fixed schedule is every four hours at `:47` UTC. It avoids the current
hourly `:10`, two-hour `:00`, and Unreleased `:50` workload anchors.

## Source changes

- `0091_apps_projection_native_scheduler.sql`:
  - SHA-256
    `3ef1882699193857164f8e46f92f6240e862270992608a693f97a88c065ea330`;
  - versioned, exact config validator;
  - allowlisted concurrent refresh procedure;
  - exact source/app-ID/v2/filter-count validation;
  - one fixed four-hour UTC job;
  - 45-minute maximum runtime;
  - three 15-minute retries;
  - disabled initial and reapplied state.
- `apps-projection-refresh.yml`:
  - removes the cron trigger;
  - retains the backup/PITR and explicit-approval inputs;
  - remains manual-only.
- `apps-projection-native-scheduler.test.ts`:
  - proves the job stays disabled in source;
  - proves only the two intended materializations refresh;
  - proves the cadence, retry, config, and manual-fallback contracts.
- `docs/developer-guide/operations/apps-projection-native-scheduler.md`:
  - separates install, smoke, and enable approvals;
  - defines health, SLO, monitoring, and rollback.

## Safety boundary

Schema 0091 was applied after a separate explicit approval and installed one
job in the disabled state. The post-apply record is in
`apps-projection-native-scheduler-schema-apply.md`.

A native `run_job` smoke remains unapplied and requires a second approval
because it refreshes production materializations. Enabling the recurring
schedule remains unapplied and requires a third approval because it authorizes
six ongoing database writes per day.

Both Railway services named `publisheriq` remain outside this architecture and
must stay stopped. The scheduler neither connects to nor restarts either
service. The final read-only Railway check reported `stopped=true` and
`status=FAILED` for both service IDs:

- genuine legacy PICS: `e6c49263-8466-4cb5-a37f-16299aae499e`;
- duplicate-named service: `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`.

Supabase is not part of this Tiger product-data path.
