# Alert Detection and Review Histogram Production Restoration

Status captured on 2026-07-27 UTC after merged PR #80 at commit
`129d8eb2988db2856cf7980bd9f872953b0753c5`.

## Scope

PR #80 restored two retained product-compatibility jobs without introducing
opportunity-product behavior:

- Alert Detection keeps Supabase pins, preferences, and delivered alerts while
  reading metrics, events, detection state, and operational jobs from Tiger.
- Review Histogram writes its existing Tiger histogram and sync-state
  contracts on a bounded twice-daily cadence.

The workflows are additive retained-consumer maintenance. They do not change
the signal-window shadow cohort, opportunity eligibility, ranking, delivery,
or any excluded tracker object.

## Production controls

| Workflow                                | Production state | Gate                                                 | Schedule                |
| --------------------------------------- | ---------------- | ---------------------------------------------------- | ----------------------- |
| `.github/workflows/alert-detection.yml` | `active`         | repository variable `ENABLE_TIGER_ALERT_WORKER=true` | hourly at minute 15     |
| `.github/workflows/histogram-sync.yml`  | `active`         | existing Tiger metrics-writer gate enabled           | `04:15` and `16:15` UTC |

Before enablement, Alert Detection was `disabled_manually` and its gate was
false. Histogram remained active but had no current production evidence. The
workflow enablement and Alert repository-variable change were the only control
mutations in this restoration.

## Alert Detection smoke

- GitHub run:
  [30234116732](https://github.com/draknorr/piq/actions/runs/30234116732)
- job ID: `89878436982`
- source commit: `129d8eb2988db2856cf7980bd9f872953b0753c5`
- result: success
- duration: 2 minutes 54 seconds
- runtime contract:
  - Tiger metrics, lifecycle events, detection state, and job tracking;
  - Supabase pin/preferences input and delivered-alert compatibility output;
  - 120-minute detection window.
- worker result:
  - entities processed: `0`;
  - alerts considered: `0`;
  - alerts created: `0`;
  - states updated: `0`;
  - worker duration: 0.99 seconds.

The zero-entity result is a verified no-op, not a hidden failure. A bounded
read-only Supabase check found seven retained pins and one preferences row, but
all seven pins were globally disabled for alerts. The compatibility RPC
therefore returned zero eligible entities. A bounded read-only Tiger check
found the matching completed `alert_detection` job, zero errors, and zero
detection-state rows.

This smoke proves workflow enablement, environment configuration, both
database boundaries, and correct disabled-user behavior. It does not prove the
entity-processing branch because production has no alert-enabled retained pin.
Testing that branch requires an explicitly approved disposable pin and
preference record.

## Review Histogram smoke

The bounded preflight selected exactly 300 due apps:

- ordered candidate hash:
  `3631e87cbb4b2100cf7ef3d9b0805ac2`;
- five candidates had never been synchronized;
- 295 candidates were refreshes;
- 286 candidates already had histogram rows;
- the latest candidate histogram fetch was from May 22, 2026.

Production execution:

- GitHub run:
  [30234313903](https://github.com/draknorr/piq/actions/runs/30234313903)
- job ID: `89879029295`
- source commit: `129d8eb2988db2856cf7980bd9f872953b0753c5`
- result: success
- total workflow duration: 8 minutes 9 seconds
- worker duration: 4.94 minutes
- processed: `300`
- succeeded: `297`
- failed: `0`
- created: `2`
- updated: `295`
- skipped because Steam returned no histogram: `3`.

The worker also marked one abandoned May histogram job failed with the explicit
reason `abandoned_as_stale_by_new_histogram_run`.

Bounded post-run Tiger verification found:

- exactly 300 `ops.sync_status` rows touched in the run interval;
- touched-app hash:
  `26f340949d43c79f203ab542fddefa18`;
- 297 apps with fetched histogram data;
- 29,314 histogram rows written in the run interval;
- completed Tiger job `846075f8-1375-4dd2-bebf-3beed971cb9d`;
- newest overall histogram sync at
  `2026-07-27T03:26:50.946Z`; and
- zero failed apps.

The Admin production surface subsequently rendered the completed
`histogram` job as `297/300` in 4.9 minutes and the completed
`alert_detection` no-op as `0/0`.

## Rollback and remaining observation

- Alert rollback: set `ENABLE_TIGER_ALERT_WORKER=false` or disable only
  `.github/workflows/alert-detection.yml`. Existing pin, alert, and Tiger state
  records remain intact.
- Histogram rollback: disable only
  `.github/workflows/histogram-sync.yml`. Existing histogram and sync-state
  rows remain intact.

No rollback deletes data. The manual production smokes are complete.

The first post-restoration `04:15` natural schedule did not create either run
by `04:49:51Z`. Both workflows remained active, the default-branch cron
expressions were still exact, GitHub reported Actions operational, and other
repository schedule events enqueued after the same boundary. This does not
invalidate the successful manual execution paths, but it leaves the natural
schedule observation open.

The next hourly Alert slot reproduced the problem. PR #82 merged a fresh
default-branch commit at `05:12:50Z`, before the `05:15` boundary, but no Alert
`event=schedule` run existed by `05:26:05Z`. The workflow was still active and
its most recent run remained the successful manual dispatch. This is now a
repeatable natural-scheduler failure rather than only a delayed first trigger.
The tracker-readiness closeout records the distinction and must not treat the
schedule as passed until an actual natural run completes.
