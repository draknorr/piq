# Revised Signal-Window Shadow Manifest

Status: verified proposal; **not approved or executed**.

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

## Exact proposed write

- mode: `PREPARATION_STATE_MODE=shadow`;
- as-of date: `2026-07-26`;
- calculation version: `signal-windows/v1`;
- runner:
  `pnpm --filter @publisheriq/data-plane refresh-preparation-derived-state`;
- exact affected objects:
  - 100 upserted rows in `metrics.app_signal_windows_v1`;
  - 100 upserted `source = 'creator'` rows in
    `ops.app_data_readiness`;
- no reader cutover.

Exact app IDs:

```text
242050,223850,39140,237110,952070,56437,250820,901583,4960370,4774980,
4992600,4954740,4950440,4564510,4928760,4798440,4616920,4469080,4992320,
4955770,4952150,4852490,4625810,4993940,4542500,4983930,4980530,4825530,
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

## Required post-write checks

- exactly 100 signal rows and 100 creator-readiness rows;
- exact `as_of_date = DATE '2026-07-26'`;
- exact 7-day and 30-day calendar boundaries;
- observed plus missing days equal 7 and 30 for reviews and CCU;
- valid complete/partial/none coverage and confidence values;
- non-empty source timestamps, calculation version, and provenance;
- an idempotent repeat invocation;
- unchanged Change Feed and Chat response shapes/counts; and
- no readiness changes outside `source = 'creator'` for the manifest.
