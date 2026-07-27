# Review Histogram Capacity Runbook

**Last verified:** July 27, 2026

**Owner:** ingestion / Tiger metrics writers

**Workflow:** `.github/workflows/histogram-sync.yml`

## Service Objective

Histogram ingestion is not a daily full-catalog sweep. The eligible cohort is
released, non-delisted Steam games that are syncable and have a positive review
count in Tiger.

| Tier | Existing Tiger signals | Target |
| --- | --- | --- |
| Active | high/medium review-velocity tier, at least 1 review/day, priority at least 100, or at least 10,000 reviews | 24 hours |
| Medium | priority at least 25 or at least 1,000 reviews | 7 days |
| Long tail | remaining useful released games | 30 days |
| Coverage / oldest | never attempted, missing stored histogram, then oldest due candidates across all tiers | reserved capacity every run |

A change in review activity moves a game into a faster tier immediately. The
next run can then select it when its new tier interval is exceeded.

## July 27, 2026 Baseline

All database evidence was collected from production Tiger with bounded,
read-only queries and local statement timeouts.

| Metric | Apps |
| --- | ---: |
| Catalog rows | 285,441 |
| Apps projection rows | 226,253 |
| Visible games | 126,993 |
| Visible games with reviews | 119,280 |
| Useful released-game cohort | 118,991 |
| Due under the old 24-hour rule | 118,774 |
| Never attempted | 1,169 |
| Fresh under 24 hours | 217 |
| 30–90 days old | 33,098 |
| At least 90 days old | 84,507 |

Tiger contained 30,503 distinct histogram app IDs across the entire catalog. A
cohort-matched follow-up query found about 24,406 useful released games with
stored rows, or roughly 20.5% coverage. Attempt coverage and stored-data
coverage must be monitored separately because a valid Steam response can be
empty.

The old selector returned the next 600 apps entirely from priority 80–95 and
included zero never-attempted apps. This is direct evidence of starvation.

## Capacity Calculation

The measured tier populations require:

```text
active:    3,716 / 1 day  = 3,716.00/day
medium:   12,191 / 7 days = 1,741.57/day
long tail:103,084 / 30 days = 3,436.13/day
total                         8,893.70/day
```

Production run `30234313903` processed 300 apps in 4.93 worker minutes, or
60.85 apps/minute. A 1,200-app run should therefore take about 19.72 worker
minutes at the normal Steam limit. The worker stops starting new requests after
22 minutes, and the workflow hard timeout remains 30 minutes.

The capacity-v2 target is eight runs/day at 1,200 selected apps/run:

```text
1,200 * 8 = 9,600 nominal selections/day
9,600 - 8,893.70 = 706.30/day headroom (7.9%)
```

Each scheduled 1,200-app run reserves:

| Lane | Per run | Per day |
| --- | ---: | ---: |
| Active daily | 480 | 3,840 |
| Medium weekly | 228 | 1,824 |
| Long-tail monthly | 324 | 2,592 |
| Coverage / oldest | 168 | 1,344 |

After never-attempted work is cleared, the coverage lane mostly contributes to
missing-histogram and oldest long-tail work. Empty lane capacity is
deterministically reallocated to the most overdue remaining candidates.

## Selection And Outcome Semantics

The Tiger-specific selector:

1. Filters to useful released games.
2. Applies the daily, weekly, or monthly target.
3. Excludes a histogram request failure for six hours.
4. Reserves coverage capacity for never-attempted, missing-histogram, and
   oldest-waiting candidates.
5. Orders each tier by oldest attempt first. Never-attempted rows use their
   `ops.sync_status.created_at` queue age, followed by priority, total reviews,
   and `appid` for deterministic tie-breaks.
6. Reallocates unused quota by overdue ratio.

Steam outcomes are distinct:

- `data`: upsert histogram rows and advance `last_histogram_sync`.
- `empty`: advance `last_histogram_sync` so the app is not immediately
  requeued; count it separately from data and failure.
- `failed`: do not advance `last_histogram_sync`; record a bounded error in
  `ops.sync_status` and apply the selector's six-hour retry cooldown.
- `deferred`: no request was started because the worker reached its 22-minute
  runtime budget.

The 1,200 hard batch cap applies even to larger manual workflow inputs.
Individual Steam requests time out after 15 seconds by default.

## Concurrency Protection

GitHub Actions retains `concurrency.group=histogram-sync` with
`cancel-in-progress=false`.

The worker also uses an atomic Tiger guard:

- an advisory transaction lock serializes the check-and-insert;
- a fresh running `ops.sync_jobs` row suppresses duplicate work;
- the active job heartbeats every five minutes;
- a new run marks a job stale only after 45 minutes without a fresh heartbeat.

This protects manual, local, or future non-GitHub entrypoints in addition to
the workflow-level guard.

## Observability

Every `ops.sync_jobs` histogram row continues to populate the standard
processed, succeeded, failed, skipped, created, and updated columns. Its
`metadata` now includes:

- `policyVersion`
- `maxRuntimeMs` and `deadlineReached`
- `laneQuotas`
- `selectedByLane` and `selectedByTier`
- `processedPerMinute`
- `stats.data`, `stats.empty`, `stats.failed`, `stats.deferred`,
  `stats.requestAttempts`, and `stats.skippedConcurrent`
- `backlogBefore` and `backlogAfter`

Each backlog snapshot includes useful-cohort totals, stored coverage,
never-attempted count, due count, 30-day and 90-day stale counts, oldest waiting
timestamp, and the same fields by service tier.

The worker logs the same snapshots, selection mix, 10-second progress updates,
failures, concurrency suppression, and final throughput.

## Alert Thresholds

Evaluate backlog alerts over at least two consecutive runs unless the condition
is marked critical.

| Signal | Warning | Critical |
| --- | --- | --- |
| Active oldest waiting | over 36 hours | over 48 hours |
| Medium oldest waiting | over 10 days | over 14 days |
| Long-tail oldest waiting | over 45 days | over 60 days |
| Never attempted | no decline over 24 hours during catch-up | increases for 48 hours |
| Active due backlog | over 960 (two lane allocations) | over 3,716 |
| Worker duration | over 20 minutes | deferred work or workflow timeout |
| Throughput | under 50 apps/minute for 3 runs | under 40 apps/minute for 2 runs |
| Item failures | over 2% for 3 runs | over 5% for 2 runs |
| Empty responses | over 50% for 3 runs | sudden increase of 25 percentage points |
| Concurrency | any suppressed run | repeated suppression or a running row older than 45 minutes |
| Stored coverage | week-over-week decline over 2 percentage points | unexplained row loss |

The total empty-response threshold is intentionally high because the long tail
contains legitimate no-data responses. Investigate tier mix before treating
empty responses as Steam failures.

## Rollout

No database migration is required.

### Stage 1: code and fairness

Merge the reviewed code while leaving `ENABLE_HISTOGRAM_CAPACITY_V2` unset or
false. The existing `04:23` and `16:23` UTC runs remain at 300 apps, but use the
new fairness, outcome, concurrency, runtime, and observability behavior.

Success gate:

- two completed baseline runs;
- no concurrency suppression;
- no deferred candidates;
- failures below 2%;
- `selectedByLane` contains coverage capacity;
- `backlogBefore` and `backlogAfter` are present.

### Stage 2: bounded canary

With explicit approval, manually dispatch one `BATCH_SIZE=1200` run. Do not
change the production variable yet.

Success gate:

- duration under 22 worker minutes and 30 workflow minutes;
- at least 95% of selected candidates processed;
- no unexplained failure-rate increase;
- observed throughput at least 50 apps/minute;
- job metadata and backlog snapshots complete.

### Stage 3: full capacity

With separate explicit approval, set the GitHub Actions repository variable:

```text
ENABLE_HISTOGRAM_CAPACITY_V2=true
```

This enables the six additional `01:23`, `07:23`, `10:23`, `13:23`, `19:23`,
and `22:23` UTC runs and changes all scheduled batches from 300 to 1,200. The
baseline `04:23` and `16:23` runs remain.

Review alert thresholds after 24 hours, 7 days, and 30 days.

## Rollback

Fast operational rollback:

```text
ENABLE_HISTOGRAM_CAPACITY_V2=false
```

This immediately returns scheduled capacity to two 300-app runs/day without a
code rollback. Risk is low: backlog growth resumes, but no data is deleted.

Code rollback:

1. Revert the histogram capacity PR.
2. Keep `ENABLE_HISTOGRAM_CAPACITY_V2=false`.
3. Confirm the next baseline job completes.

No schema rollback or data repair is required. Histogram upserts are
idempotent on `(appid, month_start)`, and empty responses only advance the
attempt timestamp.

## Approval-Gated Production Actions

The following remain prohibited until explicitly approved:

- merge the pull request;
- manually dispatch the 1,200-app canary;
- set or change `ENABLE_HISTOGRAM_CAPACITY_V2`;
- apply any future Tiger DDL or data mutation.
