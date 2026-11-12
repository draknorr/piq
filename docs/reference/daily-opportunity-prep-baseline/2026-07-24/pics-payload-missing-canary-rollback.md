# PICS payload-missing canary and automatic rollback

Captured on July 25, 2026 UTC. All database inspection was bounded and
read-only. Tiger and Railway were the product-data and runtime sources of
truth; Supabase was not used for product data.

## Approved scope

The approved operation was:

> Approve the bounded PICS durable canary at 40/10 with automatic rollback to
> shadow, including normal recovery of expired claims but no dead-letter
> repair.

The canary used merged `main` commit
`24f9fc66c83fc95d05d5ea9ef8a1e6a38f6589a4`, which contains the persistent
payload-missing fix from PR #67
(`72285e62505aa0b8f75e691c86cf47e812f1f51c`).

## Runtime topology

Only the genuine PICS service was changed:

- Railway project:
  `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment:
  `4d6625a7-d942-4835-b74b-f0eff3e626ac` (`production`);
- service:
  `e6c49263-8466-4cb5-a37f-16299aae499e` (`publisheriq`);
- image:
  `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`.

The duplicate PICS-named non-PICS service remained stopped:

- Railway project:
  `c36c95df-2284-4ffc-af85-cd3c31a3b8ea`;
- service:
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`;
- latest deployment status: `REMOVED`; and
- zero active deployments.

## Pre-canary boundary

At `2026-07-25T19:37:53.883841Z`, Tiger reported:

- canonical cursor `37,522,925`, last updated at
  `2026-07-25T08:53:26.898387Z`;
- `36` committed durable primary batches through the same cursor;
- `25` primary claims, all expired;
- `1,483` completed primary work rows;
- `281,259` pending primary work rows;
- `617` source-blocked primary rows with `missing_access_token`;
- `3` existing `payload_missing` dead letters; and
- zero other primary dead-letter categories.

The running service was healthy in:

- `PICS_WORK_MODE=shadow`;
- isolated stream `shadow-fixed-2026-07-24-37517027`;
- `PICS_PROCESSING_ENABLED=true`;
- live quota `40`; and
- catch-up quota `10`.

The current shadow claim pass had completed before the mode change, so the
cutover interrupted zero active shadow claims.

## Canary deployment

Only `PICS_WORK_MODE` was staged as `durable`; implicit deployment was
suppressed. Railway then redeployed the exact existing image:

- deployment:
  `1fb2b8b8-0064-4adf-a25e-365642096deb`;
- image digest:
  `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`;
- effective mode and stream:
  `durable / primary`; and
- effective quotas:
  `40` live and `10` catch-up.

No source code, image, processing gate, stream setting, or quota changed with
the mode.

## Confirmed rollback trigger

The first durable poll returned a force-full-app-update response with no app
payload:

- batch:
  `8367fa54-ea2c-4a6e-8300-dccdad8c4004`;
- requested cursor:
  `37,522,925`;
- response cursor:
  `37,522,925`;
- reported target cursor:
  `37,530,073`;
- source / distinct / durable rows:
  `0 / 0 / 0`;
- `force_full_update=false`;
- `force_full_app_update=true`;
- `force_full_package_update=false`;
- `source_complete=false`;
- durable response archive bytes:
  `469`;
- response archive hash:
  `197acfa33b2ca06189a6239260d92038bdccab6e4596bb709f7193d73ebc9f4d`;
- status:
  `source_blocked`; and
- `primary_cursor_advanced=false`.

The live `/status` contract changed to `health_state=degraded` with one
consecutive poll failure and explicitly reported that the incomplete response
was retained without advancing the cursor. This matched the approved
health-regression rollback condition.

The incomplete response was handled fail-closed:

- the canonical cursor stayed exactly `37,522,925`;
- no app IDs were omitted from a committed primary manifest because no primary
  manifest was promoted;
- no snapshot or relationship promotion occurred;
- no new processing retry or dead letter was created; and
- the three pre-existing `payload_missing` dead letters were not changed.

This evidence proves safe containment. It does not establish whether the
force-full response was a transient Steam condition or a repeatable source
contract. That must be tested separately before another durable cutover.

## Automatic rollback

The approved rollback changed only `PICS_WORK_MODE` back to `shadow` and
redeployed the same image:

- rollback deployment:
  `367a8b4b-84c2-4bf2-8835-dda0651f3cf5`;
- Railway status:
  `SUCCESS`;
- image digest:
  `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`;
- effective stream:
  `shadow-fixed-2026-07-24-37517027`; and
- effective quotas:
  `40 / 10`.

After rollback:

- `/health` returned `OK`;
- `/status` reported `health_state=ok`;
- Steam was connected;
- consecutive poll failures returned to zero;
- shadow processing completed work with zero retries and zero dead letters;
- zero durable primary batches were written after the rollback boundary; and
- the canonical cursor remained `37,522,925`.

No database row was manually retried, requeued, deleted, or repaired. The
`25` expired primary claims and `3` persistent payload-missing dead letters
remain available as explicit future work.

## Result

The PR #67 image is healthy in shadow, but the durable canary did not pass.
Primary mode remains contained. A follow-up must determine and rehearse the
force-full-app-update recovery contract before another durable canary.
