# Locked PICS Shadow Redeploy

Deployed and verified on July 25, 2026 UTC. This record covers only the
separately approved replacement of the genuine Railway PICS container with the
reconciliation-aware, dependency-locked service from merged `main`. The
service remained on its existing isolated shadow stream. This operation did
not authorize durable/primary mode, a database migration, a direct database
write, reconciliation processing, reader cutover, Supabase product-data use,
or a change to the duplicate Railway service.

## Approved operation

- Railway project: `68a3b2a8-43a6-45df-856e-0ba0e1309216`.
- Railway environment: `4d6625a7-d942-4835-b74b-f0eff3e626ac`
  (`production`).
- Genuine PICS service:
  `e6c49263-8466-4cb5-a37f-16299aae499e` (`publisheriq`).
- Source commit: merged `main`
  `c6bf7f5452aa7ebd53d941747861bd2e3b26c202`.
- Source service tree:
  `2590745a6391a249cd3b5bd192b9d484d9f5769e`.
- Dockerfile SHA-256:
  `1278dca204231e6acf7d2aa631da99456bc42413b12a6091e05d09bcb34b8eef`.
- Lockfile SHA-256:
  `46b83614a6126b9bbcb9528437ed9b03486bbe6452ed45d6701530fd64d5dee9`.
- Runtime configuration retained:
  `MODE=change_monitor`, `PICS_WORK_MODE=shadow`,
  `PICS_INTAKE_STREAM_KEY=shadow-fixed-2026-07-24-37517027`,
  `PICS_INTAKE_LANE=live`, `PICS_PROCESSING_ENABLED=true`,
  Tiger latest-state/history targets, and R2 object-storage archive target.
- Duplicate non-PICS service:
  project `c36c95df-2284-4ffc-af85-cd3c31a3b8ea`, service
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`; required to remain stopped.
- Risk presented: medium. The deployment replaces and restarts the running
  shadow container and can temporarily interrupt Steam polling.
- Rollback presented: redeploy prior successful deployment
  `e78ad912-c199-4b5e-be05-db0e310a658d` (image
  `sha256:32ca478a6c566754a818bdf554b059481377967b44a5325152317420c98da866`);
  if restoration is unavailable, stop the genuine service. Do not start the
  duplicate service.
- Explicit approval: after the exact target, source, mode, risk, and rollback
  were presented, the user replied `approve`.

Because the deployment remained shadow-only, it did not close the
pre-processing checkpoint rollback window.

## Preflight

Immediately before deployment:

- the genuine service was healthy on deployment
  `e78ad912-c199-4b5e-be05-db0e310a658d`, with `/health=OK` and `/status`
  reporting `pics_work_mode=shadow`, the exact isolated stream, Steam
  connectivity, and no consecutive poll failures;
- the duplicate service had zero active deployments and its latest deployment
  was stopped;
- the isolated stream contained `174` complete contiguous batches from
  `37,517,027` through `37,520,226`;
- all `174` batch manifests had exact source/durable/child-row counts,
  sequential indexes, and recomputed SHA-256 parity;
- shadow work had zero per-app watermark mismatches, expired claims,
  `stale_product_payload` errors, non-shadow rows, or dead letters;
- the canonical cursor remained exactly `37,519,592`, last updated at the
  approved checkpoint timestamp;
- there were zero primary batches; and
- all `282,630` reconciliation items and primary work rows remained pending,
  unattempted, and unclaimed.

Supabase was not inspected or used as a product-data source or target.

## Upload correction

The first CLI upload,
`bacce5cb-6743-42f7-a83d-8a8e0f53706c`, failed before the Docker build because
`--path-as-root` removed the `services/pics-service` prefix while Railway
retained that service root. It produced no image and did not replace the
running deployment.

A second filtered-path attempt was rejected locally with `prefix not found`
and created no Railway deployment. The successful retry uploaded the clean
repository-root snapshot, allowing Railway to select the existing
`/services/pics-service` root. The source commit and service bytes were
unchanged across the attempts.

## Successful deployment

- Deployment ID:
  `e680520e-e072-4cf7-80cd-048e1c076307`.
- Railway status: `SUCCESS`.
- Railway image digest:
  `sha256:b7281a4d329d4e2661c24084a54ddf9d748c56a56cfb5dcd56b82717e40dd198`.
- Root directory: `/services/pics-service`.
- Config file: `/services/pics-service/railway.toml`.

Build logs proved that Railway:

1. loaded `services/pics-service/Dockerfile`;
2. installed exactly `poetry==2.4.1`;
3. copied both `pyproject.toml` and `poetry.lock`;
4. passed `poetry check --lock`;
5. installed production dependencies from the lockfile with
   `--only main --no-root`; and
6. copied only the PICS `src` tree into the runtime image.

The only startup diagnostics were existing `steam` dependency
`SyntaxWarning`s. No application error log was returned by the bounded
post-deploy error query.

## Runtime smoke

The new container:

- started at `2026-07-25T04:24:53Z`;
- explicitly selected `PICS_WORK_MODE=shadow`;
- resumed the exact isolated stream from `37,520,259`;
- connected to Steam anonymously;
- returned `OK` from `/health`;
- reported `status=running`, `health_state=ok`,
  `processing_enabled=true`, and zero consecutive poll failures from
  `/status`; and
- committed its first post-deploy batch
  `bb8d32be-2b6e-4049-9fc7-00349f4b952a`, exactly `3/3` source/durable rows,
  from `37,520,259` through `37,520,262`, with
  `primary_cursor_advanced=false`.

The duplicate service still had zero active deployments after the genuine
service passed health.

## Tiger postflight

The repeatable-read, read-only Tiger snapshot at
`2026-07-25T04:27:27.467708Z` proved:

| Check                             |                          Result |
| --------------------------------- | ------------------------------: |
| Canonical cursor                  |                    `37,519,592` |
| Canonical cursor timestamp        | `2026-07-25 03:23:23.169921+00` |
| Isolated shadow batches           |                           `180` |
| Shadow cursor range               |       `37,517,027`–`37,520,277` |
| Shadow cursor gaps                |                             `0` |
| Stored source rows / child rows   |                 `3,157 / 3,157` |
| Batch manifest mismatches         |                             `0` |
| Shadow work rows                  |                         `1,946` |
| Per-app watermark mismatches      |                             `0` |
| `stale_product_payload` errors    |                             `0` |
| Shadow dead letters               |                             `0` |
| Expired shadow claims             |                             `0` |
| Primary work rows                 |                       `282,630` |
| Non-pending primary work rows     |                             `0` |
| Attempted primary work rows       |                             `0` |
| Claimed primary work rows         |                             `0` |
| Primary batches / cursor advances |                         `0 / 0` |

The deployment therefore resumed contiguous isolated shadow intake and
processing without promoting canonical product state or changing the audited
primary reconciliation queue. Rollback was not invoked.

## Next gate

The next production mutation is the high-risk durable canary on the genuine
service. It must be approved separately because changing
`PICS_WORK_MODE=durable` while processing is enabled will advance the canonical
cursor, begin primary work, promote validated Tiger/R2 product state, and
permanently close the pre-processing checkpoint rollback path.

The canary must keep the protected defaults of `40` live/new rows and `10`
catch-up rows per processing pass. It must fail closed on a source/cursor or
manifest mismatch, and rollback by stopping durable processing or restoring
shadow mode; already committed canonical progress and successful product
promotions are retained and reconciled rather than destructively undone. The
duplicate service must remain stopped.
