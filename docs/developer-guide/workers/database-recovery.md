# Worker recovery after database interruptions

The opportunity and change-intel workers pause on transient connection failures
and resume from their durable queues. They no longer rely on a rapid Railway
restart loop to outlast a database restart.

## Runtime behavior

- Retry delays grow from 5 seconds to 10, 20, 40, then 60 seconds. Jitter adds up
  to 20%, with a hard 60-second cap. Retry count is unlimited. A successful cycle
  resets the delay. Warnings include the attempt and delay; recovery is logged.
- Connection acquisition is bounded to 10 seconds. SQL statement limits retain
  their existing configuration. Authentication, SQL, integrity, and unrecognized
  errors retain their normal handling; they are not reclassified as connection
  outages. Mixed AggregateErrors fail closed.
- Both idle pool errors and errors from checked-out clients have handlers. Log
  output excludes the client object and its connection credentials.
- Recovery begins a fresh queue cycle. It does not replay individual SQL writes,
  uncertain commits, or external sends. Interrupted items keep their existing
  leases. Database errors do not mark those items as permanent failures.
- Storefront reloads its persisted daily tag budget before resuming after an
  outage. A failed read cannot advance the cached UTC budget date or substitute
  zero. Existing pacing, request caps, priorities, and overlap guards remain.
- Shutdown interrupts backoff immediately and stops new cycles; an in-flight
  cycle still finishes or fails under existing operation timeouts. Pools close
  after the cycle returns. No new work is claimed after an observed stop between
  storefront sources.

Tradeoffs: reconnection can wait up to 60 seconds, plus connection acquisition.
Interrupted items additionally wait for existing lease expiry (opportunity five
minutes; storefront defaults to thirty minutes). The process stays alive during
an outage, so operators must use progress/error logs rather than process liveness
alone. Existing delivery idempotency and lease semantics still apply; this change
does not guarantee exactly-once external delivery after an ambiguous acknowledgment.

## September 17 incident and restoration

At 07:02:40 UTC Tiger logged a controlled fast shutdown. Both workers lost their
connections, exited repeatedly on ECONNREFUSED, and remained CRASHED. Their
ON_FAILURE policy allowed ten retries; the last captured failures preceded
PostgreSQL's 07:03:03 UTC process start. The reason for Tiger's shutdown is not
established.

The user authorized restarts of the existing deployments. Opportunity restarted
at 07:53:45 UTC and storefront at 07:53:50 UTC. By 08:08 UTC, storefront audit rows
showed 150 successful captures and 133 successful projection refreshes, with zero
failed items in those completed batches. Opportunity logs showed renewed claims
and scheduling, including 495 scheduled items in the first pass. These are
restoration measurements on the old images, not a canary of the new recovery code.

The same 15 bounded API reads at 07:59–08:00 UTC all passed. Medians were
170.620/170.169/664.925 ms for the two overview cases and YouTube case, versus
167.687/167.126/673.147 ms in the earlier sample. Five samples per case do not
establish latency percentiles or causation. Shared WAL grew about 446,502 bytes/s
between 07:56:26 and 08:08:17 UTC, including all workloads. SteamSpy and tiered CCU
were active at the latter snapshot, alongside PICS and the restored workers.
Rendered Tiger chart samples show the added overlap: average CPU was about
5.74% during 07:43–07:52 UTC (ten one-minute points) versus 17.60% during
07:54–08:01 UTC (eight points), with an after-restart peak of 28.20%. Average
memory rose from 35.17% to 38.75%, peaking at 40.04%. These are values reconstructed
from the rendered chart and its actual tick scales; other workloads contribute.
No sustained-capacity acceptance or throughput increase follows from this check.

## Validation

Targeted tests cover startup with refused connections in both actual entrypoints,
more than ten failures, bounded delay and jitter, permanent/mixed failures,
shutdown during a sixty-second wait, idle and checked-out pool errors, preserved
claims, ambiguous delivery completion, post-outage budget reload, and failed UTC
budget rollover. The database boundary is mocked; production connections were not
interrupted for testing. Full build, type checks, and lint must pass before rollout,
including the admin build because the shared package is also used by browser code.

## Concrete rollout and rollback

Production approval is required for deploying the new code. Restart approval
restored the old images; it did not deploy this candidate.

1. Use a tracked-source archive of the reviewed recovery branch, excluding local
   environment files, output evidence, dependencies, and unrelated dirty work.
   Pin its commit and record source hashes. No SQL migration is part of this fix.
2. Deploy only opportunity first, preserving its current Railway build/start
   configuration, one replica, pool size, claim limit 8, and five-second polling.
   Project: c36c95df-2284-4ffc-af85-cd3c31a3b8ea.
   Service: daf88ea9-97a7-4658-a806-ff5a9fb248c8.
   Rollback deployment: d44b57c9-b5ed-4a29-a548-a804b13299af.
3. Observe successful scheduling/claims and bounded queue age for at least ten
   minutes. Record current database resource curves, active workloads, WAL and
   matching bounded API reads. Do not create a production database outage.
4. Deploy only storefront with its existing limits/configuration, then observe
   completed capture/projection batches and request-budget enforcement for at
   least fifteen minutes while opportunity and PICS are running.
   Project: 68a3b2a8-43a6-45df-856e-0ba0e1309216.
   Service: 0353f6ae-3578-413f-8220-2ceeafb60ea9.
   Rollback deployment: 72eb7126-2fcb-4472-bf2b-05a5dfaf2fda.
5. Stop advancement on recurrent crashes, duplicate-processing evidence, new
   persistent failures, Steam throttling, CPU above 70% for five minutes, memory
   at or above 80%, or doubled matched API latency. Roll back the affected service
   to its recorded image without resetting queues, leases, archives, or cursors.
   If the old image is unavailable, redeploy its recorded source: opportunity
   3ff6e68 (same runtime tree as the earlier 68b6ed9 canary), storefront 8e2a792.
6. Review automatic deployment scope before merging: shared/database/ingestion
   paths are watched by other services. A targeted two-service canary does not
   authorize deploying every consumer on merge. Keep no more than one active
   replica of each worker. Production outage recovery remains to be observed at
   the next natural interruption; synthetic tests are not that observation.

Before this fix, current main's relevant runtime paths were identical to those
recorded production baselines. The new candidate changes connection recovery
only. No server resize, compression application, embedding funding, queue
clearing, schema change, cadence increase, or PICS configuration change is needed.
