# Live Tiger franchise-collision evidence

All statements were bounded and executed in a read-only transaction against
`TIGER_PRIMARY_URL`. No Supabase product data was queried.

## Retry row

Observed at `2026-07-25T08:03:24.978925Z`:

- work ID: `8176`
- app ID: `252190`
- stream/lane: `primary` / `live`
- state: `retrying`
- attempts: `5/8`
- error code: `processing_error`
- error: unique constraint `franchises_name_key`, raw name
  `Defender's  Quest`

The same snapshot had three `payload_missing` retries, one
`processing_error` retry, and zero dead letters.

## Existing identity and relationships

- franchise ID: `1669`
- name: `Defender's  Quest`
- stored normalized name: `defender's  quest`
- linked apps: `2`
- linked app IDs include `218410` and `252190`

Tiger schema inspection confirmed independent unique constraints on `name` and
`normalized_name`.

## Population check

Observed at `2026-07-25T08:08:45.323155Z`:

- total franchises: `14,613`
- stored normalized values that differ from the current normalizer: `16`
- current-normalizer collision groups: `2`
- rows in current-normalizer collision groups: `4`

The collision groups are:

- `Dying Light` (`id=1790`) and `Dying  Light` (`id=248260`)
- `Movavi Software` (`id=6302`) and `Movavi  Software` (`id=14547`)

This evidence rules out a one-row anomaly and also proves that a mass
canonicalization or silent identity merge would be unsafe. The contained
resolver must prefer an exact name before a normalized match.
