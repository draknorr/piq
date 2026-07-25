# PICS Durable Canary Acceptance

Accepted on July 25, 2026 UTC. This record covers the explicitly approved
durable PICS canary on the genuine Railway service after the upstream-response
archive and PostgreSQL parameter-typing repairs. The canary passed its intake,
archive, cursor, processing, event, and health gates, so the approved rollback
was not invoked.

The counts in this record are timestamped observations, not permanent
thresholds. Supabase was not inspected or used for product data.

## Approval and scope

The user explicitly approved:

> Approve the bounded durable canary with Tiger/R2 writes and automatic
> rollback to shadow on failure.

The approved operation was restricted to:

- Railway project: `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment: `4d6625a7-d942-4835-b74b-f0eff3e626ac`
  (`production`);
- genuine PICS service:
  `e6c49263-8466-4cb5-a37f-16299aae499e` (`publisheriq`);
- `MODE=change_monitor`;
- `PICS_WORK_MODE=durable`, which resolves to stream `primary`;
- `PICS_PROCESSING_ENABLED=true`;
- protected claim limits of `40` live/new and `10` catch-up rows per pass;
- Tiger for durable relational state and R2 for immutable response and product
  payload archives; and
- automatic restoration of shadow mode on a confirmed cursor, archive,
  manifest, settlement, lease, promotion, or health failure.

Rollback would retain already committed canonical batches and promotions. It
would not rewind the cursor, delete data, directly repair a queue row, or start
the duplicate Railway service.

## Immutable runtime

PR [#63](https://github.com/draknorr/piq/pull/63) passed its full PICS suite
and was squash-merged as:

- commit: `874754305cce0f0557e77f1724d0a4ae2e55c255`;
- subject: `Fix PICS failure settlement parameter typing (#63)`; and
- Railway image:
  `sha256:bdf4c23d40530c2bb950146695d65a2d6128933a7361b65a7d54431889a6dd5`.

The image includes the mandatory upstream-response archive handoff from
PR #61 and explicit PostgreSQL casts for retrying/dead-letter reconciliation
dispositions from PR #63.

## Pre-canary source-of-truth boundary

The repeatable-read Tiger checkpoint at
`2026-07-25T06:22:17.296821Z` proved:

| Check                                       | Result                          |
| ------------------------------------------- | ------------------------------- |
| Canonical cursor                            | `37,521,023`                    |
| Canonical cursor timestamp                  | `2026-07-25 05:40:24.013574+00` |
| Existing primary batches                    | `6`                             |
| Existing source / durable positions         | `1,039 / 1,039`                 |
| Historical missing parent response archives | `3`                             |
| Expired primary claims                      | `44`                            |
| Existing `lease_expired` retries            | `21`                            |
| Completed primary work                      | `113`                           |
| Source-blocked primary work                 | `105`                           |
| Pending primary work                        | `282,721`                       |
| Completed reconciliation items              | `99`                            |
| Source-blocked reconciliation items         | `39`                            |
| Pending reconciliation items                | `282,492`                       |

The three missing parent response archives belong to the first, pre-repair
durable canary. They are a retained source limitation and were not rewritten.
The later three primary batches already had complete parent archive pointers.

Immediately before the canary:

- the genuine service was healthy in `shadow` mode on the exact isolated
  `shadow-fixed-2026-07-24-37517027` stream;
- the newest three shadow parent objects passed direct R2 hash, byte-count,
  content-type, schema, cursor, count, index, flag, and manifest checks;
- `MODE`, processing, lane, and the `40/10` limits matched the intended
  runtime; and
- the duplicate non-PICS service in project
  `c36c95df-2284-4ffc-af85-cd3c31a3b8ea` remained stopped.

## Deployment

`PICS_WORK_MODE=durable` was staged with implicit deployment suppressed and
then verified alongside the unchanged `40/10` limits. Railway redeployed the
existing verified image as:

- deployment: `ce1daa01-a064-48ea-b959-d88ba1b7635f`;
- status: `SUCCESS`;
- startup: `2026-07-25T06:26:40.915617Z`;
- selected work mode and stream: `durable / primary`;
- starting cursor: `37,521,023`; and
- Steam connection: successful at `2026-07-25T06:26:44.732026Z`.

The existing dependency-level `steam` package `SyntaxWarning` messages were
the only bounded error-level logs. No application error, traceback, `42P18`,
archive failure, hash mismatch, or unhealthy transition occurred.

## Canonical intake proof

The acceptance snapshot at `2026-07-25T06:35:13.650883Z` contained three new
contiguous canonical batches:

| Batch                                  |              Cursor range | Source / distinct / durable | Archive bytes |
| -------------------------------------- | ------------------------: | --------------------------: | ------------: |
| `f605cc37-e9f3-4e21-9411-777e0ea97be9` | `37,521,023`–`37,521,435` |           `361 / 361 / 361` |      `29,765` |
| `d22b00ee-47e8-42aa-acbf-124d11d4168d` | `37,521,435`–`37,521,461` |              `24 / 24 / 24` |       `2,388` |
| `6379e510-78fc-48e4-bf0f-cd5d2bfbf723` | `37,521,461`–`37,521,499` |              `29 / 29 / 29` |       `2,786` |

The aggregate proof was:

- exact `414 / 414 / 414` source, durable, and permanent child positions;
- zero cursor gaps;
- zero count, source-index, mode, completeness, status, or cursor-advance
  mismatches;
- zero missing parent response archive pointers; and
- canonical cursor `37,521,499`.

A credential-free verifier fetched all three parent objects directly from R2
and independently recomputed:

- object SHA-256;
- byte count and content type;
- `pics-change-response/v2` schema;
- durable mode and primary stream;
- from, to, and echoed response cursors;
- source and distinct counts;
- sequential source indexes;
- force-full flags; and
- the ordered per-app manifest hash.

All three objects passed every check.

## Processing and promotion proof

The first two protected processing passes completed:

| Pass | Claimed | Completed | Source-blocked | Retried | Dead-lettered | Changed snapshots | Events |
| ---- | ------: | --------: | -------------: | ------: | ------------: | ----------------: | -----: |
| 1    |    `50` |      `25` |           `25` |     `0` |           `0` |              `25` |   `22` |
| 2    |    `50` |      `31` |           `19` |     `0` |           `0` |              `31` |   `36` |

Each pass respected `40` live/new plus `10` catch-up claims. The third pass
was in progress at the acceptance checkpoint.

Stale-claim recovery moved the original `44` expired claims into durable
`lease_expired` retry state. Combined with the earlier `21` retrying rows,
this produced an expected pool of `65`; one row had begun draining naturally
by the acceptance checkpoint. No direct requeue, repair, or data edit was
performed.

At the repeatable-read acceptance snapshot:

- primary work was `168` completed, `151` source-blocked, `64` retrying,
  `39` actively claimed, and `282,703` pending;
- there were zero dead letters, zero stale-product-payload errors, and zero
  expired active claims;
- reconciliation items were `146` completed, `55` source-blocked, and
  `282,429` pending;
- `59` new PICS snapshots had zero missing archive pointers;
- `60` new PICS events had zero missing evidence pointers; and
- active registry interpretation had zero unknown event types.

Processing continued while the direct verifier ran. Its final bounded pass
fetched `63` promoted snapshot objects totaling `412,625` bytes and found zero
read failures, SHA-256 mismatches, byte-count differences, content-type
differences, or invalid JSON bodies.

## Transient reconnect

Steam disconnected once at `2026-07-25T06:30:18.997828Z`. The client:

1. scheduled its bounded reconnect;
2. reconnected successfully on attempt one at
   `2026-07-25T06:30:26.709736Z`;
3. retried one timed-out change poll; and
4. committed the next contiguous canonical batch.

The service returned to `health_state=ok`, zero consecutive poll failures, and
no poll error. This was a successful recovery test, not a rollback condition.

## Result and continuing controls

The canary passed and remains in `durable / primary` mode on the verified
image. The duplicate service remains stopped. Catalog observation remains
separately contained in `off` mode, and the Apps projection scheduler was not
changed by this operation.

The rollout monitor now checks every new primary batch and processing pass for
cursor continuity, exact manifests, readable R2 evidence, lease and retry
health, dead letters, settlement errors, event-registry unknowns, promotion
evidence, and duplicate-service containment. The previously approved
automatic shadow rollback remains active for a confirmed gate failure.

Increasing the catch-up quota above `10`, directly repairing retry rows, or
changing another production service remains a separate mutation requiring
explicit approval.
