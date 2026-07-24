# PR 1 Verification — 2026-07-24

The baseline and all diagnostic access used read-only transactions or bounded
`SELECT` queries. After the Tiger recovery gate passed, one separately approved
operation concurrently refreshed the two existing Apps materialized views. No
base table, cursor, writer target, read flag, workflow schedule, or Railway
service changed. A Vercel configuration-only repair set the missing strict
Tiger Change Feed flags and rebuilt the existing production artifact; it did
not deploy branch code.

## Passed

- `pnpm check-types`: 13 Turbo tasks passed.
- `pnpm --filter @publisheriq/admin build`: production build passed.
- `pnpm --filter @publisheriq/admin test`: 240 tests passed.
- Focused lint for every touched admin source/test file: passed.
- `pnpm --filter @publisheriq/data-plane test`: 58 tests passed.
- Data-plane baseline script type-check and focused lint: passed.
- `pnpm --filter @publisheriq/query-api test`: 19 tests passed, including
  Change Feed status, activity search, and detail routing.
- `pnpm --filter @publisheriq/ingestion test`: 86 tests passed.
- Ingestion R2 manifest script type-check and focused lint: passed.
- `pytest` in `services/pics-service`: 33 tests passed with two dependency/config
  deprecation warnings.
- `pnpm supabase:writer-audit`: completed in report-only mode.
- `pnpm tiger:ingestion-verify -- --live ...`: completed bounded read-only live
  checks.
- `git diff --check`: passed.
- The before/after protected-object comparison reports every complete Supabase
  user/profile/pin/alert/credit primary-key set unchanged.
- The PR 1 Apps projection workflow parsed as YAML and initially gated its
  schedule behind `ENABLE_TIGER_APPS_PROJECTION_REFRESH=true`. PR 7 removes
  that unreliable cron path and retains the workflow as manual fallback only.
- The rebuilt Vercel production artifact retained the `/login?next=` redirect
  and API `401` contracts. Authenticated `/changes` reported `Capture healthy`
  and displayed `25` current Tiger-backed rows for the last day.
- The separately approved Apps projection refresh completed in `57.56s` plus
  `4.41s` for filter counts. Post-validation proved `223,851` source and
  projection rows, zero missing/extra/duplicate IDs, and `0.202h` freshness.
- Authenticated production `/apps` rendered successfully after the refresh with
  its existing filters, sorting, table, entity links, and pin controls.

## Existing blockers surfaced

These failures exist on the captured `origin/main` baseline and were not caused
by this slice:

- `pnpm lint` fails in `@publisheriq/data-plane` with four errors:
  - empty interface in `src/contracts.ts`;
  - unused `toNumber` in
    `src/scripts/backfill-metrics-daily-metrics.ts`;
  - two unused `lightweight` parameters in `src/service.ts`.
- The ingestion verifier reports two static ownership gaps:
  - Review Histogram has no scheduled trigger.
  - Alert Detection remains an active Supabase-service-key path without the
    expected Tiger target/gate.
- The verifier's combined live SQL check timed out, while its bounded catalog,
  sync-status, change-intel-job, and worker-job subchecks returned evidence.
- The writer audit reports one scheduled blocker (`alert-detection.yml`) and
  manual/static risks that require ownership review rather than automatic
  rewriting.

These results block a primary cutover. They do not invalidate the read-only
baseline or the contained admin/configuration changes in PR 1.

## PR 7 Option A validation

- Full `pnpm check-types`: 13 Turbo tasks passed.
- Full `pnpm test`: 10 Turbo tasks passed after rerunning outside the sandbox
  so query-api tests could bind localhost.
- `pnpm --filter @publisheriq/data-plane test`: 76 tests passed, including
  three new native-scheduler/manual-fallback contracts.
- Focused lint for
  `packages/data-plane/src/apps-projection-native-scheduler.test.ts`: passed.
- Prettier check for every touched YAML, TypeScript, and Markdown file: passed.
- `git diff --check`: passed.
- Live Tiger job API signatures and monitoring columns were verified with a
  bounded read-only transaction.
- The final read-only production check found zero matching native Apps jobs,
  proving schema 0091 remains unapplied.
- Both Railway services named `publisheriq` remained stopped and the PICS
  cursor remained unchanged.
- Package-wide lint still reports the four unrelated existing errors listed
  above; the new PR 7 test has no lint findings.

## External gates still open

- Separate approval for every later database migration, backfill, or repair.
- Separate approvals to install schema 0091 disabled, run one native refresh
  smoke, and enable its recurring four-hour schedule.
- Three healthy daily cycles before any primary catalog, PICS, projection, or
  consumer cutover.

The Tiger recovery gate passed at `2026-07-24T02:19:18Z`: the authenticated
production console proved automatic same-region backup and a continuous
three-day PITR fork window. Supabase recovery proof is conditional on a future
Auth-plane or legacy-row mutation and is not a gate for Tiger-only work.
