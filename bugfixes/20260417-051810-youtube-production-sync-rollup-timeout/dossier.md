# Bug Dossier: youtube production sync rollup timeout

- Bug ID: `20260417-051810-youtube-production-sync-rollup-timeout`
- Status: `fixed`
- Created At: `2026-04-17T05:18:10.724427+00:00`
- Depth: `broad`
- Triage Score: `5`
- Triage Tier: `3`
- Spawned Agents: `bug_mapper`, `runtime_reproducer`, `impact_analyst`

## Summary

`pnpm youtube:rollup-daily` was timing out because
[`rebuildDailyRollups`](</Users/ryanbohmann/Desktop/publisheriq/packages/youtube/src/storage.ts:897>)
rebuilt `metrics.youtube_game_daily` with repeated correlated subqueries against
`metrics.youtube_video_snapshots`. On production Tiger, the read-only SELECT form
of the existing query timed out under the configured `15s` statement timeout and
completed in about `29.5s` when given a larger timeout. The implemented fix
keeps the rollup output unchanged but replaces those repeated lookups with a
set-based snapshot-boundary computation that finished in about `4.0s` on the
same production data and matched the old query results exactly.

## Assessment Depth

Tier 3 was used because this bug affected a DB-backed metrics pipeline,
arrived with screenshot-only evidence, and touched downstream Tiger-backed chat
surfaces. The investigation fanned out across code ownership, runtime
reproduction, and blast-radius analysis before the fix.

## Observed Behavior

- GitHub Actions failed on the final `Rebuild YouTube daily rollups` step in
  `.github/workflows/youtube-production-sync.yml`.
- The workflow did not set `DATA_PLANE_STATEMENT_TIMEOUT_MS`, so the YouTube
  package default of `15000` ms applied.
- The failing statement lived in `packages/youtube/src/storage.ts` inside
  `rebuildDailyRollups()`.
- Production Tiger had the expected indexes on `metrics.youtube_video_snapshots`,
  `docs.youtube_video_matches`, `docs.youtube_videos`, and
  `metrics.youtube_game_daily`.
- Read-only reproduction against production Tiger showed:
  - old rollup SELECT timed out under `15s`
  - old rollup SELECT completed in `29483.777 ms` under a `60s` timeout
  - new set-based SELECT completed in `4040.450 ms` under a `15s` timeout
  - old and new result sets had `0` differing rows for the 30-day rollup window
- Before the fix, `metrics.youtube_game_daily` was stale through `2026-04-14`
  while `metrics.youtube_video_snapshots` was fresh through `2026-04-17`.

## Expected Behavior

The YouTube production sync should rebuild `metrics.youtube_game_daily` within
the configured statement timeout so the scheduled workflow completes and the
rollup table stays current.

## Evidence Gathered

- Read-only reproduction and performance evidence:
  [read-only-rollup-repro.md](/Users/ryanbohmann/Desktop/publisheriq/bugfixes/20260417-051810-youtube-production-sync-rollup-timeout/artifacts/reproduction/read-only-rollup-repro.md)
- Source-of-truth Tiger checks:
  [source-of-truth-checks.md](/Users/ryanbohmann/Desktop/publisheriq/bugfixes/20260417-051810-youtube-production-sync-rollup-timeout/artifacts/db/source-of-truth-checks.md)
- Implementation validation:
  [validation.md](/Users/ryanbohmann/Desktop/publisheriq/bugfixes/20260417-051810-youtube-production-sync-rollup-timeout/artifacts/tests/validation.md)

## Reproduction Result

Reproduced. The read-only SELECT equivalent of the pre-fix rollup timed out
under a `15s` statement timeout against production Tiger and matched the GitHub
Actions failure mode.

## Likely Root Cause

High confidence: the pre-fix query shape was too expensive for current
production volume because it evaluated per-video snapshot boundary lookups inside
the aggregate. At current scale that meant roughly `225k` app-day/video rows and
hundreds of thousands of repeated snapshot index probes, which exceeded the
default Postgres statement timeout.

## Possible Impact / Blast Radius

- Primary failure surface: `youtube-production-sync.yml`
- Stale table: `metrics.youtube_game_daily`
- Downstream consumers:
  - `getYoutubeGameCoverage` in `apps/query-api`
  - authenticated `/api/chat/youtube-coverage`
  - preview mirroring via `youtube-preview-mirror`
- Discovery and refresh continued writing fresher raw YouTube data even while
  the daily rollup was stale.

## Database Source of Truth Checks

- Confirmed production scale and recent activity with read-only counts.
- Confirmed the expected production indexes exist.
- Confirmed rollup staleness separately from fresh snapshot ingestion.

## Fix Options

1. Rewrite the rollup query to compute snapshot boundary counts in a set-based way without changing rollup semantics.
2. Raise `DATA_PLANE_STATEMENT_TIMEOUT_MS` in the workflow as an operational stopgap.
3. Reduce `YOUTUBE_ROLLUP_LOOKBACK_DAYS`, accepting a behavior change in the rebuilt history window.

## Open Questions

None.

## Recommended Verification

- `pnpm --filter @publisheriq/youtube check-types`
- `pnpm --filter @publisheriq/youtube lint`
- `pnpm --filter @publisheriq/youtube test`
- Re-run the read-only SELECT equivalent with `statement_timeout=15000`
- Re-run the GitHub Actions workflow or `pnpm youtube:rollup-daily` in a safe
  write environment and confirm the rollup table catches up

## Ready for Fix Verdict

Yes. The bug was a contained performance defect with no product-behavior choice,
and the implemented SQL rewrite preserved the old output exactly in read-only
validation.
