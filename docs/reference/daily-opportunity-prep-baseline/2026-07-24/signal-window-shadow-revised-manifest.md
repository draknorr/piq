# Revised Signal-Window Shadow Manifest

Status: **approved, executed, and idempotency-verified on 2026-07-27 UTC**.

The originally approved transaction failed its foreign-key check because seven
selected IDs were absent from `legacy.apps`. The single transaction rolled
back in full, leaving zero matching signal rows and zero creator-readiness
rows.

## Exact substitutions

The replacements were selected deterministically from canonical PICS
`source_blocked` rows outside the original manifest, ordered by
`ops.app_data_readiness.updated_at DESC, appid DESC`.

| Removed app ID | Replacement app ID | Replacement name           |
| -------------- | ------------------ | -------------------------- |
| 5017260        | 2822360            | RoadHouse Manager          |
| 4917500        | 4402950            | HEXSTORM: Tears of Arcadia |
| 4778530        | 1401370            | Viking City Builder        |
| 3396010        | 1913700            | Netspectre                 |
| 4270850        | 4778770            | Skyline Sim                |
| 3798580        | 1552060            | Sockpuppet Noire           |
| 4187420        | 4444510            | Seeding The Wasteland      |

All seven replacements are canonical, non-retryable PICS `source_blocked` rows
with `blocking_reason = 'missing_access_token'`.

The first revised preflight exposed a documentation transcription error: the
list contained 99 IDs because unchanged original cohort app `4625160`
(`Mission: Clear Space`) had been omitted. The fail-closed cardinality check
stopped before any database connection or write. The corrected list below is
the exact executed 100-app cohort.

## Exact executed write

- mode: `PREPARATION_STATE_MODE=shadow`;
- as-of date: `2026-07-26`;
- calculation version: `signal-windows/v1`;
- runner:
  `pnpm --filter @publisheriq/data-plane refresh-preparation-derived-state`;
- exact affected objects:
  - 100 upserted rows in `metrics.app_signal_windows_v1`;
  - 100 upserted `source = 'market_metrics'` rows in
    `ops.app_data_readiness`;
  - 100 upserted `source = 'creator'` rows in
    `ops.app_data_readiness`;
- total footprint: 300 rows across the two named objects;
- no reader cutover.

Exact app IDs:

```text
242050,223850,39140,237110,952070,56437,250820,901583,4960370,4774980,
4992600,4954740,4950440,4564510,4928760,4798440,4616920,4469080,4992320,
4955770,4952150,4852490,4625810,4625160,4993940,4542500,4983930,4980530,
4825530,
2822360,4402950,4294860,1401370,4815890,4842190,4708270,3519630,1913700,
4778770,1552060,4439560,4444510,4521660,3609080,4510830,3656800,496550,
2808930,2605790,1608450,2452280,2592160,3526710,3164330,1875580,1324780,
2211170,2852190,2897580,3447040,2827200,786520,3917090,2753000,3314340,
3101040,3217240,3142050,433790,386420,285070,319320,448830,231120,419590,
313140,1690940,4704030,313650,4738790,628570,2154770,4682480,286200,
4797010,4440600,4791300,337420,4778740,343340,2584240,4753480,4335770,
730,1623730,570,578080,3678970,1172470,2767030
```

## Verified pre-state

The bounded read-only check found:

- 100 manifest rows and 100 distinct app IDs;
- 100 matching canonical `legacy.apps` rows;
- all 15 PICS-cohort rows still `source_blocked`;
- zero matching `metrics.app_signal_windows_v1` rows; and
- zero matching creator-readiness rows.

`metrics.daily_metrics` subsequently advanced to `2026-07-27`. The proposal
retains the previously approved `2026-07-26` boundary instead of silently
changing the calculation day.

## Execution and post-write validation

The first runner invocation failed before opening a database connection because
the sourced root environment variables were not exported to the child process.
The corrected invocation exported the existing environment and completed with:

- `creatorRows = 100`;
- `signalWindowRows = 100`; and
- no reader or runtime mode change.

Post-write inspection identified a second documentation error in the proposed
scope: `metrics.refresh_app_signal_windows_v1` also refreshes
`source = 'market_metrics'` readiness. The executed footprint is therefore 100
signal rows plus 200 readiness rows, not the originally documented 200 total.
All rows were retained as additive reconciliation evidence.

The bounded validation passed:

- 100 signal rows, 100 market-readiness rows, and 100 creator-readiness rows;
- zero date, calendar-boundary, coverage, or provenance violations;
- signal coverage states: 8 complete, 89 partial, and 3 none;
- creator readiness: 6 partial and 94 unknown;
- market readiness: 39 ready, 58 partial, and 3 source-blocked; and
- semantic hashes before and after the mandatory repeat invocation were
  unchanged:
  - signals: `bb3cba15c080769e450960df45ddd7b3`;
  - readiness: `30833466d72c3cd66d2afc9e42cf502d`.

The repeat invocation retained cardinality at 100 signal rows and 200 readiness
rows. Audit timestamps changed as expected; all semantic fields remained
identical.

## Risk and rollback

Risk is low to medium. The write is bounded and additive, and no current reader
uses these rows. The main risks are an incorrect calculated row, unexpected
query cost, or unintended creator readiness.

Containment:

1. both functions run in one transaction and one database connection;
2. a ten-minute local statement timeout bounds the operation;
3. any failure rolls back both functions;
4. `PREPARATION_STATE_MODE` remains `off` outside the invocation; and
5. no reader is cut over.

Generated rows remain reconciliation evidence if post-write validation fails.
A compensating deletion is not authorized and would require another explicit
production-write approval.

## Completed post-write checks

- exactly 100 signal rows, 100 market-readiness rows, and 100
  creator-readiness rows;
- exact `as_of_date = DATE '2026-07-26'`;
- exact 7-day and 30-day calendar boundaries;
- observed plus missing days equal 7 and 30 for reviews and CCU;
- valid complete/partial/none coverage and confidence values;
- non-empty source timestamps, calculation version, and provenance;
- an idempotent repeat invocation; and
- no readiness changes outside the function's documented `market_metrics` and
  `creator` sources for the manifest.
