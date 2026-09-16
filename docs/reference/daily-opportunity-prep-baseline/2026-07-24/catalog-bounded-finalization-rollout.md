# Catalog bounded-finalization rollout

Captured on July 25, 2026 UTC. Tiger and GitHub Actions were the product-data
and workflow sources of truth. Supabase was not used for product data.

## Approved scope

The approved sequence was:

1. apply Tiger schema `0094` transactionally while catalog observation
   remained off;
2. dispatch one manual Change Hints run with a shadow-only override;
3. if the smoke passed, dispatch one full AppList shadow reconciliation; and
4. leave the repository catalog variable off.

No failed scan repair or primary catalog cutover was approved.

## Schema apply

The applied artifact was:

- merged `main`:
  `24f9fc66c83fc95d05d5ea9ef8a1e6a38f6589a4`;
- file:
  `packages/data-plane/sql/tiger-bootstrap/0094_catalog_bounded_finalization.sql`;
- SHA-256:
  `9078287f8119413b6b319c9e183a9f0786759acd977db56da9f9ed10244fb4eb`.

Provider evidence showed a Tiger recovery fork could be created to a point in
the preceding three days. Immediately before the apply:

- `CATALOG_OBSERVATION_MODE=off`;
- `ops.catalog_scan_runs` had zero finalization columns;
- there were `14` completed scans and one failed scan;
- the failed full AppList scan remained
  `3627d8da-5e3d-4b6b-859e-83b8a061b0ab`;
- the row-level `capture_catalog_readiness_v1` trigger was installed;
- no catalog query was active; and
- `ops.app_catalog_state` contained `176,149` rows.

The SQL ran in one transaction with:

- `lock_timeout=5s`;
- `statement_timeout=180s`; and
- `ON_ERROR_STOP=1`.

It committed in approximately `3.2` seconds. Post-apply validation proved:

- all seven finalization columns exist with the expected defaults;
- all three check constraints are validated;
- all five bounded-finalization indexes exist;
- the old row-level readiness trigger is absent;
- all six expected function signatures exist;
- there are zero active or blocked catalog queries;
- all historical scans retained zero cursors and zero finalization counts; and
- the original failed scan, error, counts, and timestamp were unchanged.

## Change Hints shadow smoke

GitHub Actions run
[`30172100547`](https://github.com/draknorr/piq/actions/runs/30172100547)
was dispatched from merged `main` with:

- `CATALOG_OBSERVATION_MODE=shadow`;
- batch size `1,000`; and
- repository variable still `off`.

The workflow succeeded in `43` seconds. Its Tiger run was:

- scan:
  `ce884577-5d55-4c6e-b9d3-da943ad7dc84`;
- run key:
  `github:steam_change_hints:30172100547`;
- status and phase:
  `completed / completed`;
- source / accepted / rejected:
  `820 / 820 / 0`;
- known / unknown:
  `754 / 66`;
- changed-known / unchanged-known:
  `10 / 744`;
- seeded / enqueued / events:
  `66 / 76 / 66`;
- finalization state rows:
  `820`;
- finalization readiness rows:
  `0`, as required in shadow; and
- input hash:
  `9e8845fd402b49a7c361c27525ec85a3defa251bdb11914b5ace50e12313e02f`.

The single manifest had a valid SHA-256 and exact aggregate parity. Every one
of the `66` unknown IDs had:

- a `first_observed` catalog event;
- a seeded `legacy.apps` row;
- a Tiger `ops.sync_status` row with priority at least `25`;
- a catalog-state observation tied to the scan; and
- a non-dead storefront capture-work disposition.

The timestamp-write correction also passed:

- all `76` affected unknown or changed-known rows existed in `sync_status`;
- all `744` unchanged-known rows were observed in catalog state; and
- zero unchanged-known rows had `sync_status.updated_at` rewritten to the
  catalog observation timestamp.

Aggregate capture queues moved concurrently while the scan ran. Exact
scan-linked IDs, rather than aggregate deltas, proved the `66` durable unknown
dispositions.

## AppList bounded smoke

The first AppList dispatch,
[`30172210052`](https://github.com/draknorr/piq/actions/runs/30172210052),
attempted to send an empty `max_apps` input. GitHub normalized the empty value
to the workflow default of `1,000`.

The run was retained as a successful additional bounded smoke:

- source / accepted / rejected:
  `1,000 / 1,000 / 0`;
- status and phase:
  `completed / completed`;
- finalization state rows:
  `1,000`; and
- finalization readiness rows:
  `0`.

It was not counted as the approved full reconciliation. Code inspection
confirmed that `APPLIST_MAX_APPS=0` is the explicit unlimited sentinel.

## Full AppList shadow reconciliation

GitHub Actions run
[`30172342993`](https://github.com/draknorr/piq/actions/runs/30172342993)
was dispatched with:

- `CATALOG_OBSERVATION_MODE=shadow`;
- `APPLIST_MAX_APPS=0`;
- `APPLIST_BATCH_SIZE=500`; and
- repository variable still `off`.

The workflow succeeded in `4m28s`; the actual AppList sync took `81.28`
seconds. Steam returned four pages totaling `176,222` source rows.

Tiger recorded:

- scan:
  `91268cb0-c696-4e81-ad86-fdae28e06d14`;
- run key:
  `github:steam_applist:30172342993`;
- status and phase:
  `completed / completed`;
- source / accepted / rejected:
  `176,222 / 176,204 / 18`;
- known / unknown:
  `176,204 / 0`;
- seeded / enqueued / events:
  `0 / 0 / 0`;
- finalization state rows:
  `176,204`;
- finalization readiness rows:
  `0`;
- reconciliation outcome:
  `matched`; and
- input hash:
  `fd96479c8d65caa09c35415f041443e06974a5cdf3e7c2e0c74555643f99ce59`.

The `353` manifests had:

- indexes exactly `0` through `352`;
- zero non-sequential indexes;
- exact aggregate accepted parity:
  `176,204`;
- exact aggregate rejected parity:
  `18`;
- exact known / unknown parity:
  `176,204 / 0`;
- zero invalid batch hashes; and
- zero seeded, enqueued, or event differences.

Bounded finalization began at `2026-07-25T19:52:41.748148Z`. A live
checkpoint at `2026-07-25T19:53:01.313867Z` showed:

- status `finalizing`;
- phase `catalog_state`;
- cursor app ID `4,383,130`;
- `159,000` finalized rows; and
- a current finalization heartbeat.

It completed at `2026-07-25T19:53:03.656283Z` with all `176,204` state rows
finalized. The former monolithic `completeScan` timeout did not recur.

Additional invariants:

- exactly `176,204` rows referenced the scan as last observed, last full
  observed, and last successful;
- zero catalog events were expected or produced;
- zero `sync_status` rows were rewritten to the full-scan observation
  timestamp;
- no catalog scan remained running or finalizing;
- the original failed scan remained unchanged; and
- repository `CATALOG_OBSERVATION_MODE` remained `off`.

## Concurrent queues and live contracts

Before the smoke, storefront capture work had `1,261` dirty non-dead rows and
`2,753` dead letters. After the full run it had `1,059` dirty non-dead rows and
`2,752` dead letters. The full AppList scan enqueued zero rows, so this
aggregate reduction reflects concurrent capture-worker activity rather than
the reconciliation. The Change Hints scan's exact `66` scan-linked,
non-dead dispositions remain the catalog proof.

After the rollout:

- query API `/healthz` returned `ok=true` with Tiger provenance;
- unauthenticated `/apps` returned the required `307` redirect to
  `/login?next=%2Fapps`;
- the genuine PICS service was healthy in isolated shadow mode;
- the PICS canonical cursor stayed `37,522,925`; and
- the duplicate non-PICS service remained stopped.

## Result

The catalog statement-timeout defect is fixed and validated at full
production scale. Scheduled catalog observation remains disabled. A later
approval may enable scheduled shadow observation or perform a separately
gated primary cutover.
