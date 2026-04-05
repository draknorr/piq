# Data Capture Gap Remediation Checklist

Generated: March 28, 2026

Primary evidence source: [Data Capture Gap Audit](./data-capture-gap-audit-2026-03-27.md)

## Summary

This checklist turns the March 27 audit into a phased rollout plan. It is intentionally split from the audit so the evidence remains stable while the remediation work is tracked separately.

Default rollout rules:

- Do not combine phases that change the same downstream metric family.
- Use observation windows between phases so regressions are attributable.
- Prefer additive states and confidence flags before changing existing semantics.
- Do not do destructive catalog cleanup in this sequence.

## Phase Tracker

| Phase | Objective | Status | Exit gate |
| --- | --- | --- | --- |
| 1 | Stop active data corruption and remove wasted review churn | Planned | 48 hours of stable review metrics after deploy |
| 2 | Repair capture gaps without flooding queues | Planned | 48 to 72 hours of stable queue depth and falling unsynced counts |
| 3 | Fix applist control plane and separate current vs historical catalog semantics | Planned | Two consecutive healthy applist cycles |
| 4 | Ship additive quality improvements and optional media policy cleanup | Planned | Stable CCU confidence states and explicit media policy |

## Cross-Phase Baseline Snapshot

Freeze these values before Phase 1 starts and update them again at each phase exit:

- SteamSpy newer than Reviews by at least 7 days: `34,451` appids
- High-review at-risk review rows: `236` games with `1,000+` reviews
- Future-dated zero-review games synced by Reviews in last 7 days: `5,233`
- Apps with `last_pics_sync IS NULL`: `3,789`
- Released-last-30-days games with `last_pics_sync IS NULL`: `1,015`
- Apps with `last_news_sync IS NULL`: `58,835`
- Fresh storefront apps with `last_news_sync IS NULL` in last day: `65`
- News dead-letter rows: `44`
- DB apps vs live GetAppList: `166,911` vs `150,512`
- `db_not_in_api`: `16,694`
- `api_not_in_db`: `295`
- Appids with CCU snapshots in last day: `69,584`
- Today's `daily_metrics` rows with `ccu_peak = 0`: `77,016`

## Phase 1: Correctness Hotfixes

### Objective

Stop new bad review truth from being written, reduce wasted review capacity, and avoid changing downstream owner semantics abruptly.

### Preflight

- Confirm all review-facing product surfaces that currently read `daily_metrics` or `latest_daily_metrics`.
- Freeze a sample set of contaminated titles, including `388520` and `418500`, to verify post-fix deltas.
- Capture current review freshness counts and the `34,451` at-risk appid count.
- Confirm the backfill order: high-review titles first, broad tail second.

### Execute

- Stop SteamSpy from writing `positive_reviews`, `negative_reviews`, `total_reviews`, `review_score`, and `review_score_desc`.
- Keep SteamSpy owner and playtime enrichment, but classify owner quality additively instead of changing current owner consumers in the same deploy.
- Exclude future-dated zero-review games from routine review cadence.
- Backfill authoritative review truth in two waves:
  - latest-row repair for the `236` high-review at-risk titles
  - latest-row repair for the remaining at-risk tail
- Do not rewrite full history in this phase.

### Verify

- No new rows appear where SteamSpy is the freshest writer of review totals.
- The contaminated sample titles match live Reviews API totals after backfill.
- Future-dated zero-review titles stop consuming routine review slots.
- Review throughput and queue latency remain within normal bounds.

### Rollback Triggers

- Review totals stop updating for actively played titles.
- Review freshness degrades materially for recent releases.
- Owner fields become null or empty for existing consumers due to the confidence change.

### Done When

- The at-risk count is falling.
- The high-review contaminated sample set is corrected.
- Review worker throughput is stable for 48 hours.

## Phase 2: Capture Gap Repair

### Objective

Repair News and PICS first-pass capture holes without creating retry storms or starving normal queue work.

### Preflight

- Freeze current counts for `last_news_sync IS NULL`, `last_pics_sync IS NULL`, released-last-30-days unsynced PICS rows, and News dead letters.
- Confirm dedupe keys or idempotency behavior for News enqueue and PICS first-pass enqueue.
- Define queue-depth, claim-latency, and dead-letter thresholds that constitute stop-ship conditions.

### Execute

- Introduce terminal News outcomes for hard source-side failures such as durable Steam `403` responses.
- Add a News catch-up sweep for storefront-synced apps with no durable News outcome and no active queue work.
- Add a first-pass PICS queue seeded from newly discovered appids.
- Prioritize released and near-release games in the PICS first-pass queue.
- Keep PICS first-pass work idempotent so repeated discovery cannot flood the queue.

### Verify

- `last_news_sync IS NULL` declines on fresh storefront apps.
- Dead-letter News rows stop recurring for hard-failure apps.
- `last_pics_sync IS NULL` declines, with the released-last-30-days cohort dropping first.
- Queue depth and claim latency stay inside the agreed thresholds for 48 to 72 hours.

### Rollback Triggers

- Queue depth grows continuously after deploy.
- News catch-up creates duplicate items or repeated dead letters.
- PICS first-pass work starves change-driven PICS updates.

### Done When

- Fresh storefront apps are no longer getting stranded without a durable News state.
- Released and near-release PICS gaps are shrinking without queue instability.

## Phase 3: Catalog Control and Reporting Semantics

### Objective

Fix applist operational drift while preserving historical rows and making catalog semantics explicit.

### Preflight

- Freeze counts for DB apps, live GetAppList apps, `db_not_in_api`, `api_not_in_db`, and stale-running applist jobs.
- Identify every report or queue that currently assumes the full `apps` table is the current live catalog.
- Confirm that no destructive deletes are part of this phase.

### Execute

- Fix applist job completion so stale `running` rows do not accumulate.
- Reconcile live-only appids into the DB on normal applist cadence.
- Add explicit reporting semantics for:
  - current catalog
  - historical retained catalog
- Keep DB-only rows as retained historical rows unless a later retention policy says otherwise.

### Verify

- Two consecutive applist cycles complete cleanly.
- `api_not_in_db` remains near zero after the next normal cycle.
- Current-catalog reporting excludes historical retained rows where intended.

### Rollback Triggers

- New app discovery regresses after the applist changes.
- Existing reports or workers break because they expected historical rows to remain in the live-catalog denominator.

### Done When

- Applist cycles are healthy for two straight runs.
- Live-only appids are no longer lingering outside the DB.
- Current vs historical catalog counts are intentionally separated.

## Phase 4: Additive Quality Improvements

### Objective

Improve confidence and policy clarity for CCU and media history without mixing cost-heavy work into ingestion repair phases.

### Preflight

- Freeze current CCU zero/null/positive counts and the suspicious-zero proxy counts from the audit.
- Confirm which downstream consumers need additive CCU state rather than changed `ccu_peak` semantics.
- Default media policy for this phase:
  - keep screenshot and trailer history as URL-history only
  - make background handling explicit
  - defer full screenshot and trailer binary archival unless product requirements change

### Execute

- Add explicit CCU confidence or state alongside existing CCU values.
- Distinguish confirmed zero, suspected zero, skipped, invalid, and unavailable states.
- Align background media handling with the documented product policy.
- Do not add full screenshot or trailer binary archival in this phase.

### Verify

- CCU consumers can distinguish zero from uncertain-zero without losing existing peak values.
- Background handling is no longer partially implied by the current implementation.
- No material storage, download, or worker-throughput cost is introduced in this phase.

### Rollback Triggers

- Downstream consumers misread additive CCU states as value changes.
- Media handling changes create new archival work or throughput costs accidentally.

### Done When

- CCU confidence is exposed without changing existing peak semantics.
- Media policy is explicit and matches the implementation.

## Phase Exit Checklist

Run this at the end of every phase:

- Recompute the baseline metrics listed above.
- Compare sample appids used in the audit against live source truth.
- Review queue depth, dead letters, and claim latency for affected workers.
- Confirm no unrelated ingestion surface regressed while the target phase changed.
- Record the before/after counts and any anomalies directly in this file.

## Status Log

### 2026-03-28

- Created the companion phased checklist from the March 27 audit.
- Locked the rollout order to four phases with explicit observation windows.
- Chose the default media policy to defer full screenshot and trailer archival.
- Chose latest-row review repair first, not full-history correction, to limit blast radius.
