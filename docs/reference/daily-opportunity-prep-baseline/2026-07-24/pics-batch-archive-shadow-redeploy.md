# PICS Batch Archive Shadow Redeploy

Deployed and verified on July 25, 2026 UTC. This record covers the approved
squash merge of PR #61 and the shadow-only replacement of the genuine Railway
PICS service with the repaired upstream-response archive handoff. It does not
authorize durable mode, canonical cursor advancement, primary claim recovery,
catch-up acceleration, database repair, a migration, or any change to the
duplicate Railway service.

Supabase was not inspected or used for product data.

## Approval and scope

The user explicitly approved:

> Approve PR #61 ready and squash-merge.

> Approve the genuine PICS shadow-only redeploy from merged PR #61.

The approved deployment was restricted to:

- Railway project: `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment: `4d6625a7-d942-4835-b74b-f0eff3e626ac`
  (`production`);
- genuine PICS service:
  `e6c49263-8466-4cb5-a37f-16299aae499e` (`publisheriq`);
- `MODE=change_monitor`;
- `PICS_WORK_MODE=shadow`;
- isolated stream `shadow-fixed-2026-07-24-37517027`;
- `PICS_PROCESSING_ENABLED=true`;
- Tiger latest-state/history targets and R2 object-storage archive target;
- protected `40` live/new and `10` catch-up claims per processing pass; and
- no production database command or direct data repair.

The risk was medium: the genuine shadow container would restart, Steam
polling could be interrupted, and the repaired runtime would create isolated
shadow batch/work rows and R2 objects.

The rollback was the prior successful shadow deployment
`63adb1e6-5f63-4eab-9de5-1fc7272a911a`, image
`sha256:b7281a4d329d4e2661c24084a54ddf9d748c56a56cfb5dcd56b82717e40dd198`.
If restoration was unavailable, the safe fallback was to stop the genuine
service. The duplicate service was not a rollback target.

## PR merge and immutable source

PR [#61](https://github.com/draknorr/piq/pull/61) was fully green, clean, and
mergeable immediately before the approved action. It was marked ready and
squash-merged as:

- merged commit:
  `c69e83d4c95a7d5b4edc0c1f24dfaf9582c33fc0`;
- merged subject:
  `Archive PICS batches before cursor advance (#61)`;
- PICS service tree:
  `fe438cf98134e3695876ece77adf606f6232c5fe`;
- Dockerfile SHA-256:
  `1278dca204231e6acf7d2aa631da99456bc42413b12a6091e05d09bcb34b8eef`;
- Poetry lock SHA-256:
  `46b83614a6126b9bbcb9528437ed9b03486bbe6452ed45d6701530fd64d5dee9`;
- repaired intake worker SHA-256:
  `df77db0d09dddb3b70650b47a297ecd6a8ab596e300f7945a29cd0ab7b6a6e73`;
  and
- repaired durable store SHA-256:
  `6407854ac55e00126723354b8a053e92826e24648568bebf143dba335f236760`.

PR validation included:

- `100` passing PICS tests;
- passing Black, Ruff, and MyPy checks;
- passing repository type checks;
- lint with zero errors;
- a successful full production build;
- successful GitHub build and Vercel checks; and
- passing Prettier and diff checks.

## Preflight source-of-truth snapshot

At `2026-07-25T05:11:16.968548Z`, read-only Tiger and Railway checks proved:

- canonical cursor `37,520,458`, unchanged since
  `2026-07-25T04:45:22.703217Z`;
- `206` isolated shadow batches through `37,520,706`;
- zero existing shadow parent response archive pointers, matching the
  pre-repair runtime behavior;
- `21` primary claims still durably claimed with expired leases;
- `62` completed and `65` explicitly source-blocked primary work rows;
- zero primary retrying or dead-letter rows;
- the genuine service healthy in the exact isolated shadow mode with Steam
  connected and zero poll failures; and
- the duplicate non-PICS service still stopped with zero active deployments.

The previous container committed one more contiguous shadow batch through
`37,520,737` while the new image built. The repaired container correctly
resumed from that live Tiger cursor instead of the earlier observation.

## Railway deployment

The clean repository-root upload from merged `main` created deployment:

- deployment ID:
  `dfbb0f1a-108c-47bf-9a00-451f9c81a2fb`;
- Railway status: `SUCCESS`;
- Railway image digest:
  `sha256:f687cb44fa0662d7f604e31f0322329bd69f070f405a087bf2707337cacf1c21`;
- OCI build digest:
  `sha256:c6b1c5dddab0465280685fca62e7ea242b7fbe6a55c7ea3ba6a65a129e5c1896`;
- root directory: `/services/pics-service`; and
- config file: `/services/pics-service/railway.toml`.

Build logs proved that Railway:

1. loaded `services/pics-service/Dockerfile`;
2. used the locked Python base image;
3. installed exactly `poetry==2.4.1`;
4. copied `pyproject.toml` and `poetry.lock`;
5. passed `poetry check --lock`;
6. installed only the production dependencies; and
7. copied the repaired PICS source tree.

The `/health` check passed on its first attempt.

## Runtime smoke

Runtime logs proved that the new container:

- started its health server at `2026-07-25T05:13:06.206877Z`;
- explicitly selected `PICS_WORK_MODE=shadow`;
- selected stream `shadow-fixed-2026-07-24-37517027`;
- resumed from live Tiger cursor `37,520,737`;
- connected to Steam at `2026-07-25T05:13:09.011110Z`; and
- committed its first repaired shadow batch
  `08f85c45-c95d-4b91-b602-f27a72e3a182` from `37,520,737` through
  `37,520,750`.

The live endpoints then reported:

- `/health=OK`;
- `status=running`;
- `health_state=ok`;
- `pics_work_mode=shadow`;
- the exact isolated stream;
- `processing_enabled=true`;
- Steam connected;
- zero consecutive poll failures;
- no poll error; and
- no bounded runtime log match for an intake error, traceback, fatal error,
  unhealthy transition, archive failure, or hash mismatch.

The repaired deployment is the genuine service's only active deployment.

## First batch Tiger proof

The repeatable-read Tiger snapshot at
`2026-07-25T05:14:08.033436Z` proved that batch
`08f85c45-c95d-4b91-b602-f27a72e3a182` retained:

| Check                          | Result                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| Cursor range                   | `37,520,737`–`37,520,750`                                          |
| Echoed response cursor         | `37,520,737`                                                       |
| Source / distinct / durable    | `10 / 10 / 10`                                                     |
| Child rows / distinct          | `10 / 10`                                                          |
| Child indexes                  | sequential `0`–`9`                                                 |
| Parent and child manifest hash | `afdd09cb8fd83157dcfc606708b621e7412672c0378881ab0743494c22595aa7` |
| Source completeness            | `true`                                                             |
| Status                         | `committed`                                                        |
| Parent archive pointer         | complete                                                           |
| Archive bytes                  | `1,287`                                                            |
| Primary cursor advanced        | `false`                                                            |

The parent pointer, permanent child rows, and exact ordered manifest were
therefore present before the shadow stream cursor became restart-visible.

## Direct R2 verification

The verifier fetched the parent response object through the production R2
configuration without printing credentials or object keys. For the first
batch it independently proved:

- object SHA-256 matches Tiger;
- byte count matches Tiger;
- content type is `application/json`;
- schema is `pics-change-response/v2`;
- stream, mode, and lane match Tiger;
- from, to, and echoed response cursors match Tiger;
- source and distinct counts match Tiger and the document;
- source indexes are sequential; and
- the manifest recomputed from every ordered app entry matches both the
  document and Tiger.

A second repaired batch,
`3670e598-c57d-460f-9654-a03683dad7cd`, then advanced the isolated stream
from `37,520,750` through `37,520,779`. A second direct R2 pass verified both
post-deploy batches and all `33` ordered source entries with zero failures
across the same checks.

## Full postflight

The full isolated-stream verification after the second repaired batch proved:

| Check                                     | Result                    |
| ----------------------------------------- | ------------------------- |
| Shadow batches                            | `209`                     |
| Shadow cursor range                       | `37,517,027`–`37,520,779` |
| Cursor gaps                               | `0`                       |
| Source rows / child rows                  | `3,642 / 3,642`           |
| Manifest mismatches                       | `0`                       |
| Parent response archive rows              | `2`                       |
| Repaired post-deploy batches              | `2`                       |
| Repaired R2 batches / ordered source rows | `2 / 33`                  |
| Repaired R2 verification failures         | `0`                       |
| Canonical cursor                          | `37,520,458`              |
| Primary expired claims                    | `21`, unchanged           |
| Primary completed / source-blocked        | `62 / 65`, unchanged      |
| Primary retrying / dead-letter            | `0 / 0`                   |
| Genuine active deployments                | `1`                       |
| Duplicate service active deployments      | `0`                       |

Only the two repaired batches have parent response archives; the prior `207`
historical shadow batches remain unchanged. This is expected and makes the
deployment boundary directly auditable.

Rollback was not invoked.

## Next gate

The upstream-response archive defect is repaired and proven in the isolated
production shadow stream. A second durable canary remains a separate
production mutation and requires fresh explicit approval.

The next canary should retain:

- the genuine service and exact repaired image;
- `PICS_WORK_MODE=durable`;
- `PICS_PROCESSING_ENABLED=true`;
- protected quotas of `40` live/new and `10` catch-up rows per pass;
- automatic rollback to this proven shadow mode if any parent archive,
  object hash/size, cursor, manifest, lease, promotion, or health gate fails;
- durable recovery of the `21` expired primary claims through the existing
  stale-claim path, without direct requeue or repair; and
- continued containment of the duplicate service.
