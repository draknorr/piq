# Catalog Observation Shadow Rollout

Status: **manual AppList and change-hint shadow scans passed; schedules remain off**

All observations below are time-bound production evidence from July 24, 2026
UTC. The live Tiger database and GitHub Actions runs, rather than the
preparation specification, were used as the source of truth. No Supabase read
or write was required for this Tiger-only rollout.

## Authorization and safety

- The additive Tiger schema was applied under the separate approval recorded in
  `catalog-observation-schema-apply.md`.
- Each production shadow operation was described with its write scope, risk,
  and rollback before the user explicitly approved it.
- Shadow operations were append-only or idempotent upserts. They performed no
  deletes and inferred no removals from a missing source row.
- The GitHub repository variable `CATALOG_OBSERVATION_MODE` remained undefined,
  so scheduled AppList and change-hint workflows continued to fail closed to
  `off`.
- The legacy PICS monitor remained stopped and was not involved.

## Bounded AppList scan and replay

GitHub Actions run
[`30066635313`](https://github.com/draknorr/piq/actions/runs/30066635313)
ran on merged commit `db35775037db69d63796edcfef0f20cfedf01553` with:

- mode `shadow`;
- maximum `1,000` accepted apps;
- batch size `500`;
- scan ID `6f76c3e9-477e-4f06-8984-a3b1c087bdfa`;
- run key `github:steam_applist:30066635313`.

The first attempt committed `1,000` known apps, zero unknown apps, zero
rejections, zero storefront enqueues, two manifests, and `1,000` baseline
events. State and event IDs had the same MD5:
`fa50a7c7d9423e0d4efd1601ae680b3c`.

The explicitly approved same-run replay returned the existing completed scan.
Its timestamps, input hash, manifests, state count, event count, and observation
counts were unchanged. This verified same-run idempotency. Normal audit records
outside the catalog ledger were allowed to record the second workflow attempt.

## Complete AppList scan

The first complete-scan dispatch,
[`30067240664`](https://github.com/draknorr/piq/actions/runs/30067240664),
received GitHub's workflow default of `1,000` when an empty `max_apps` input was
submitted. It was therefore another bounded scan, not complete-scan evidence.
No result from that run was represented as full coverage.

The corrected dispatch,
[`30067424131`](https://github.com/draknorr/piq/actions/runs/30067424131),
used the worker's documented unlimited value `max_apps=0`:

- scan ID `33bcac12-999c-40cc-92c0-db3bc9ecee67`;
- run key `github:steam_applist:30067424131`;
- four Steam source pages and `175,982` source rows;
- `175,964` accepted rows and `18` rejected `missing_name` rows;
- `175,963` known apps and one unknown app;
- `352` sequential manifests, indices `0` through `351`;
- zero changed-known rows, one seed, one storefront enqueue, and `174,964`
  new baseline/first-observed events;
- input SHA-256
  `ce6aaad73619f5b52432b6bb5b09b1759627d4989ac52be558e10a60ee697092`.

Tiger contained exactly `175,964` matching catalog-state and catalog-event
app IDs after the run. Both sets had MD5
`041c4d017d5fa202b3466c18b8495412`; there were zero ID mismatches. The one new
app, `4963400` (`三国时代`), was initially seeded with priority `25` and a
storefront work item, then independently hydrated by the running storefront
consumer.

The 18 rejected source rows all had valid app IDs but no source name. Each
existing `legacy.apps` row was preserved, and no catalog removal was inferred:

`396420, 708030, 803500, 814940, 1001520, 1045750, 1074060, 1356840,
1475730, 1625780, 1636860, 1718090, 1994240, 2101450, 2942140, 3244680,
3400140, 3665180`.

## Initial complete change-hint bootstrap

GitHub Actions run
[`30068443517`](https://github.com/draknorr/piq/actions/runs/30068443517)
passed in `1m38s` on merged commit
`db35775037db69d63796edcfef0f20cfedf01553`. Its log verified:

- `CATALOG_OBSERVATION_MODE=shadow`;
- `DATA_READ_TARGET=tiger` and `DATA_WRITE_TARGET=tiger`;
- `HINT_BATCH_SIZE=1000`;
- workflow result: `175,987` hints, `26` changed known apps, `31`
  storefront enqueues, and `57.2s` worker duration.

Tiger's completed scan was
`4a26ea88-d0b7-4e62-8b4c-1907dd455c1c`, with run key
`github:steam_change_hints:30068443517`:

- full scan with no requested prior cursor;
- source start `2026-07-24T05:05:03.771Z`;
- completion `2026-07-24T05:05:53.812815Z`;
- `175,987` source rows, `175,969` accepted, and the same `18`
  `missing_name` rejections;
- `175,964` known apps, five unknown apps, `26` changed known apps, and
  `175,938` unchanged known apps;
- five seeds, `31` enqueues, and five first-observed events;
- `176` sequential manifests, indices `0` through `175`, all with 64-character
  batch hashes;
- input SHA-256
  `9be72de5009c1618d375f161259b05547f90c5a8a1cb408dc9b649248b954769`;
- reconciliation outcome `{"status":"pending_daily_parity"}`.

Every manifest aggregate matched the scan totals exactly. Changed-known IDs
were distinct with MD5 `b3ee89c2fc7ec5004a791abd48d2b71e`; unknown IDs
were distinct with MD5 `e0d89cc84cfd7dcaa969fc7355e48f42`.

### Sync-status write proof

Before dispatch, a credential-free local snapshot captured all `281,277`
`ops.sync_status` rows. Each row included its app ID, a hash of all content
except `updated_at`, hint cursor fields, and timestamp. The snapshot SHA-256
was:

`4d7e5e46438e954568a0033deccdd35ad3d8299448dd26bc09d1716df56ce261`.

The post-run comparison showed:

- all five unknown IDs were absent before the run;
- all `26` changed-known IDs existed before and changed content;
- zero changed-known IDs were timestamp-only changes;
- rows retaining the catalog transaction's observation timestamp were an exact
  subset of the expected 31 IDs, with zero unexpected IDs.

This proves the catalog hint transaction did not reproduce the legacy defect of
rewriting every known row's `updated_at`.

Other continuously running consumers updated `89` unrelated sync-status rows
during the catalog scan's 49-second database window. Eleven were timestamp-only
updates. They did not carry the catalog observation timestamp and were not in
the scan manifests, so they are recorded as concurrent system activity rather
than attributed to this shadow run.

### New app disposition

The five previously unknown apps were:

|  App ID | Name                                                                      |
| ------: | ------------------------------------------------------------------------- |
| 4719460 | Amlebic                                                                   |
| 4868510 | Party Ships                                                               |
| 4878060 | Fractal Descent                                                           |
| 4917560 | New Canon: The Mane-Tailed Wolf and the Unspeakable Truth of the Universe |
| 4919060 | Escape from Track 7                                                       |

Each app had:

- an immutable `first_observed` event sourced from
  `steam_change_hints`;
- `first_observation_kind = new`;
- initial sync priority `25` and refresh tier `moderate`;
- a `catalog_first_observed` storefront work item;
- successful storefront completion with no error;
- `catalog_seed_state = hydrated` by the time of read-only verification.

## Exit assessment

The manual shadow bootstrap passed source-count reconciliation, manifest
reconciliation, unknown-ID disposition, immutable event creation, and the
unchanged-row timestamp requirement. It did not authorize or enable scheduled
shadow operation.

The next production mutation is setting
`CATALOG_OBSERVATION_MODE=shadow` as a GitHub repository variable. That will
cause hourly change-hint and daily AppList schedules to write the durable
catalog ledger and must receive separate explicit approval before execution.
