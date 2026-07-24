# Daily Opportunity Preparation Baseline — 2026-07-24

Captured during the first implementation slice on Friday, July 24, 2026 at `2026-07-24T01:05:08Z`.

This baseline is read-only. No production mutation was performed while capturing it.

After capture and explicit user approval, the two existing Apps materialized
views were refreshed concurrently. That operation and its before/after evidence
are isolated in `apps-projection-refresh.md`.

## Scope

- Tiger production snapshot for PICS progress, queue state, and projection freshness.
- Supabase production snapshot for Auth-adjacent and legacy non-auth migration safeguards, plus legacy product freshness.
- R2 metadata-only prefix inventory and stable object-metadata hash.
- GitHub Actions and Railway runtime/mode inventory without secret values.
- Live query-api health check.
- Live-site observations from the authenticated production review completed on July 24, 2026 UTC.

## Key observations

- Tiger PICS remains stalled: `ops.pics_sync_state.last_change_number = 36631816` and `updated_at = 2026-06-16 22:05:18+00`.
- Post-merge incident evidence is recorded in
  [`pics-restart-incident.md`](./pics-restart-incident.md). The legacy monitor
  was unintentionally restarted by Railway autodeploy, contained at cursor
  `37,491,237`, stopped, and disconnected from its GitHub source.
- Railway also contained a second service with the same `publisheriq` name in
  another project. It was an accidental Query API duplicate, not PICS; it was
  stopped and source-disconnected without changing the genuine legacy PICS
  service. See
  [`railway-pics-service-topology.md`](./railway-pics-service-topology.md).
- Tiger backlog remains large: `ops.sync_status` has `93,557` syncable rows with no completed PICS sync.
- Change-intel queue remains degraded: `179` non-dead queued records and `2,858` dead-lettered records were present in the refreshed snapshot.
- `metrics.apps_page_projection` remains stale: `166,864` rows with newest `data_updated_at = 2026-05-04 03:47:38+00`.
- `metrics.unreleased_games_projection` remains current enough to preserve: `51,427` rows with newest `data_updated_at = 2026-07-23 06:18:07+00`.
- Supabase retained non-auth data still exists and must be preserved until reconciled into Tiger: `9` profiles, `7` pins, `0` user alerts, `9` credit transactions, `0` credit reservations. It is a legacy dependency, not the target source of truth.
- The current Supabase schema no longer exposes `public.alert_preferences` or `public.pin_alert_settings`.
- Supabase product freshness remains stale: `public.daily_metrics.metric_date` tops out at `2026-04-30`, and `public.pics_sync_state.updated_at` is `2026-04-30 03:16:23+00`.
- R2 `production/change-intel` contained `1,188,708` objects totaling `11,182,262,682` bytes; the metadata-only manifest records a stable SHA-256 without exporting object bodies or credentials.
- Live query-api `/healthz` returned `{"ok":true}` with Tiger provenance at `2026-07-24T00:59:39.324Z`.
- Live authenticated `/changes` was empty and marked delayed during the initial July 24 production review, despite current Tiger change activity. After setting the missing strict Tiger read flags and rebuilding the existing Vercel production artifact, it reported `Capture healthy` and displayed `25` current rows for the last day.

## Current implementation implications

- Change Feed must prefer the Tiger/query-api contract whenever it is configured and available; stale Supabase fallback cannot remain the default production path.
- Admin PICS health must report stale cursor progress instead of inferring “active” from the existence of a historical cursor.
- A dedicated Tiger Apps projection refresh workflow is required before any future freshness SLO can be enforced.
- Tiger recovery capability is verified from the authenticated production console: automatic same-region backup and a continuous three-day PITR fork window are available. No Tiger database refresh is authorized until its separate operation-specific approval. Supabase recovery evidence is required only before an auth-plane mutation or an approved migration that changes legacy Supabase rows.

## Artifacts

- `implementation/manifest.json`: reproducible bounded Tiger/Supabase operational snapshot.
- `implementation/tiger-schema.json` and `implementation/supabase-schema.json`: bounded schema inventories.
- `post-implementation/manifest.json` and `protected-object-comparison.json`: second read-only capture and proof that all complete protected user-control key sets were unchanged.
- `r2-manifest.json`: metadata-only object inventory for the production change-intel prefix.
- `runtime-matrix.json`: GitHub Actions, Railway, query-api, PICS, demo CCU, and Vercel observations.
- `route-contract-matrix.json`: source ownership and preservation contracts for current browser/API surfaces.
- `backup-pitr-gate.md`: verified Tiger recovery evidence and the explicit
  one-time production-write approval record.
- `apps-projection-refresh.md`: explicit approval, safe execution settings,
  before/after parity, timing, freshness, and live-route evidence for the
  one-time production refresh.
- `catalog-observation-schema-apply.md`: approved additive Tiger DDL, immutable
  source checksum, post-apply object verification, and proof that observation
  remained disabled.
- `catalog-observation-shadow-rollout.md`: approved bounded, replay, complete
  AppList, and initial complete change-hint shadow evidence, including exact
  manifest reconciliation and sync-status write-scope proof.
- `durable-pics-intake-schema-apply.md`: approved additive Tiger DDL, immutable
  source checksum, empty-object verification, unchanged PICS cursor, and
  stopped-runtime proof.
- `railway-pics-service-topology.md`: disambiguation and final containment
  state for both Railway services named `publisheriq`.
- `verification.md`: passing checks, pre-existing verifier/lint findings, and unresolved external gates.
