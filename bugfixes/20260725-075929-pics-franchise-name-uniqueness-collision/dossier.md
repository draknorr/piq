# Bug Dossier: PICS franchise name uniqueness collision

- Bug ID: `20260725-075929-pics-franchise-name-uniqueness-collision`
- Status: `fixed`
- Created At: `2026-07-25T07:59:29.239647+00:00`

## Summary

Durable PICS promotion for app `252190` is deterministicly retrying because
Tiger already contains the exact franchise name `Defender's  Quest` under a
legacy double-space `normalized_name`. The current writer collapses that value
to `defender's quest`, inserts the existing raw name with the new normalized
value, and handles only `normalized_name` conflicts. Tiger therefore rejects
the statement on its separate `franchises_name_key` constraint.

## Evidence Gathered

- At `2026-07-25T08:03:24.978925Z`, `ops.pics_work_state.id=8176` was
  `retrying`, attempt `5/8`, with the exact `franchises_name_key` error.
- `legacy.franchises.id=1669` owns the exact source name and its old
  double-space normalized value.
- App `252190` is already linked to franchise `1669`; the same franchise is
  shared by two apps, so preserving the existing ID is required.
- `legacy.franchises` independently makes both `name` and `normalized_name`
  unique.
- Both Tiger writer paths handle only a conflict on `normalized_name`.
- The current normalizer converts the source value to the single-space
  `defender's quest`.
- At `2026-07-25T08:08:45.323155Z`, Tiger contained `14,613` franchises and
  `16` legacy noncanonical normalized values.
- Two current-normalizer collision groups contain four intentionally distinct
  exact-name rows: `Dying Light` / `Dying  Light` and `Movavi Software` /
  `Movavi  Software`. Exact-name precedence is therefore required to preserve
  IDs; silent canonical merging would be unsafe.
- The targeted pre-fix test baseline passed `16` tests.

The bugfix database helper was not used because it is hardcoded to the Supabase
`DATABASE_URL`; bounded direct read-only queries against `TIGER_PRIMARY_URL`
were required because Tiger is the product-data source of truth.

## Recommended Fix

Resolve franchise identity before inserting:

1. Prefer an existing exact raw-name row.
2. Otherwise reuse an existing current-normalized row.
3. Insert only when neither exists, with `ON CONFLICT DO NOTHING` so either
   unique constraint is safe under concurrency.
4. If a concurrent insert won, reselect the identity.

Use the same resolver in durable promotion and the Tiger latest-state path.
Exact-name precedence preserves the two live canonical-collision groups. Do
not rewrite existing names, normalized values, IDs, or relationships.

## Ready for Fix Verdict

The contained code-only fix is implemented and validated. No schema migration,
production data repair, service restart, merge, or deployment was performed.
