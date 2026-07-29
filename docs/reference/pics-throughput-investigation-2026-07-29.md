# Durable PICS Throughput Investigation and Guarded Rollout

> Evidence captured July 29, 2026 UTC. Production investigation was read-only:
> bounded Tiger `SELECT` transactions, Railway status/log reads, the public
> `/status` endpoint, and verified R2 `GET` requests. No production
> configuration, database row, object, migration, deployment, or Steam request
> was changed.

## Scope and production target

The genuine PICS service is:

- Railway project `68a3b2a8-43a6-45df-856e-0ba0e1309216`;
- environment `4d6625a7-d942-4835-b74b-f0eff3e626ac`;
- service `e6c49263-8466-4cb5-a37f-16299aae499e`;
- one running replica in `us-east4-eqdc4a`;
- deployment `94696f5e-5df8-4728-ad6d-dd810f2952d0`; and
- image
  `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`.

The source-disconnected duplicate in the main Railway project was not queried,
started, or changed.

Runtime controls were `change_monitor`, `durable`, primary stream, processing
enabled, `40` live/new claims, `10` catch-up claims, and Tiger latest/history
targets. Unset values resolved to the code defaults of a 300-second Steam
heartbeat, 30-second poll interval, 60-second request timeout, and five Steam
attempts.

## Read-only baseline

Tiger snapshot: `2026-07-29 04:11:46.852251+00`.

### Work state

| Lane     | Pending | Claimed | Completed | Source-blocked | Dead letter |    Open |
| -------- | ------: | ------: | --------: | -------------: | ----------: | ------: |
| Catch-up | 256,865 |      10 |    10,529 |            487 |           3 | 256,875 |
| Live     |   4,072 |      33 |    10,358 |          9,525 |           0 |   4,105 |
| New      |       0 |       0 |         0 |            401 |           0 |       0 |
| Total    | 260,937 |      43 |    20,887 |         10,413 |           3 | 260,980 |

The oldest claimable catch-up row dated to
`2026-07-25 03:23:23.169921+00`. The oldest claimable live row dated to
`2026-07-28 22:15:17.644397+00`.

`missing_access_token` accounted for 10,402 explicit source blocks: 476
catch-up, 9,525 live, and 401 new. Eleven other catch-up rows were
`payload_missing`, along with the three retained historical dead letters.

### Throughput and arrival rate

| Window | All successful promotions/min | Catch-up successful/min | Catch-up terminal/min | Incoming live app positions/min | Live/new rows dirtied/min |
| ------ | ----------------------------: | ----------------------: | --------------------: | ------------------------------: | ------------------------: |
| 15m    |                         3.467 |                   2.533 |                 2.667 |                          14.400 |                    13.000 |
| 1h     |                         3.517 |                   2.683 |                 2.833 |                          13.317 |                    10.550 |
| 24h    |                         5.359 |                   2.323 |                 2.518 |                          19.840 |                     8.827 |

At 2.833 catch-up terminal settlements/minute, 256,875 open rows imply 62.96
days to drain. At the 24-hour rate of 2.518/minute, the measured projection is
70.84 days.

The canonical cursor was `37,606,129`, updated at
`2026-07-29 04:11:16.346227+00`; lag at the repeatable-read snapshot was 0.563
minutes. The latest source-complete batch matched the cursor.

### Steam and failure signals

The exact 24-hour log window ending at `2026-07-29 04:11:46Z` contained:

| Signal                                                   | Count |       Rate |
| -------------------------------------------------------- | ----: | ---------: |
| Committed change batches / scheduled product-info passes |   363 | 15.13/hour |
| Steam disconnects                                        |   365 | 15.21/hour |
| Change-poll retries                                      |   375 | 15.63/hour |
| Product-info retries                                     |     0 |     0/hour |
| Product-info batch failures                              |     0 |     0/hour |
| Processing failures                                      |     4 |  0.17/hour |
| Lease-renewal failures                                   |     0 |     0/hour |
| Lock-timeout signals                                     |     0 |     0/hour |
| New dead-letter signals                                  |     0 |     0/hour |
| Rate-limit signals                                       |     0 |     0/hour |

All four processing failures later completed through the normal durable retry
path. Disconnect duration was tightly clustered: 196.4-second minimum,
225.0-second p50, 263.2-second p95, 352.4-second maximum, and 228.6-second
mean.

## Bottleneck and disconnect diagnosis

For a 50-claim pass, the pre-change processor opened:

- two claim transactions;
- 52 heartbeat transactions: before and after Steam, then once before every
  remaining app;
- 50 latest-snapshot pointer transactions; and
- 50 promotion or terminal-settlement transactions.

That is approximately 154 Tiger transactions, or 3.08 per settlement. The
heartbeat statements updated 1,375 row positions per pass because the
remaining-claim suffix shrank from 50 to 1.

The processor then performed prior R2 reads, validation, R2 writes, and Tiger
promotion serially. During that work, synchronous psycopg and boto3 calls and
standard-library `time.sleep()` did not yield the gevent hub. The configured
300-second Steam heartbeat was also longer than the observed disconnect
cluster.

The diagnosis is therefore combined, with one important limit on what the
read-only evidence proves:

1. the per-app database choreography creates avoidable connection and
   transaction latency;
2. synchronous downstream I/O can prevent the ValvePython/gevent connection
   from scheduling while a pass is active; and
3. the 300-second heartbeat is longer than the approximately 225-second median
   connection lifetime, but the logs cannot establish whether heartbeat
   cadence, hub starvation, or an upstream Steam policy is the primary cause.

This matches gevent's documented model: greenlets do not run until the current
greenlet yields, and its hub thread pool exists specifically to move
non-cooperative blocking work off the event-loop thread. Boto3 documents that
low-level clients are generally thread-safe, subject to no mutation of shared
metadata or custom event hooks. The implementation uses one client, native
threads only, and no custom hooks:

- <https://docs.gevent.org/intro.html>
- <https://docs.gevent.org/api/gevent.hub.html>
- <https://boto3.amazonaws.com/v1/documentation/api/latest/guide/clients.html>

## Read-only production phase benchmark

The benchmark opened Tiger connections with
`default_transaction_read_only=on`, performed bounded `SELECT` statements,
verified R2 object hashes, and made zero writes.

### Latest-snapshot pointers

The legacy shape opened one connection/query per app. Fifty reads took 24.687
seconds wall time; per-read p50/p95 latency was 0.487/0.549 seconds.

| Batch | Batched p50 | Batched p95 | Returned |
| ----: | ----------: | ----------: | -------: |
|    50 |      0.511s |      0.519s |       50 |
|    75 |      1.002s |      1.030s |       75 |
|   100 |      0.565s |      0.587s |      100 |
|   150 |      0.621s |      0.623s |      150 |
|   200 |      0.608s |      0.631s |      200 |

At 50 apps, one batched read reduced wall time by approximately 48 times.

### Prior R2 reads and validation

With four bounded native threads:

| Batch | R2 wall time | Objects/second | Object p50 | Object p95 |
| ----: | -----------: | -------------: | ---------: | ---------: |
|    50 |       2.994s |          16.70 |     0.212s |     0.439s |
|    75 |       2.201s |          34.08 |     0.110s |     0.205s |
|   100 |       3.857s |          25.92 |     0.132s |     0.279s |
|   150 |       4.989s |          30.06 |     0.100s |     0.259s |
|   200 |       6.826s |          29.30 |     0.109s |     0.282s |

All 575 reads across the two bounded runs passed hash verification. Validation
and extraction of 200 archived raw payloads took 0.034 seconds total in the
four-size run; the separate 75-app run took 0.015 seconds. Production R2
writes and Tiger promotion transactions were not benchmarked because doing so
would be a production mutation; the candidate instruments those phases for a
separately approved canary.

## Candidate and no-network benchmark

The selected candidate:

- keeps one canonical intake leader and one Steam session;
- keeps one product-info request per batch;
- batches all latest-pointer reads;
- uses four native threads for independent post-Steam work, hard-capped at
  eight;
- heartbeats at completed-wave barriers instead of during active promotion
  races;
- uses gevent-cooperative poll and retry sleeps;
- retains the existing 300-second CM heartbeat so heartbeat traffic does not
  increase before a global Steam-session governor exists;
- holds scheduled product-info pass starts at least 215 seconds apart; and
- emits per-phase, queue, ETA, request, R2, and Tiger metrics.

The repeatable no-network benchmark injected independent 20ms R2 and 20ms
Tiger latency per app, reserved 40 live slots, and tested
50/75/100/150/200 total apps at 1/4/8 workers. Four-worker p95 results were:

| Total batch | Live | Catch-up | Pass p50 | Pass p95 | Governed catch-up/min | Steam calls/hour | Tiger tx/settlement | Projected drain |
| ----------: | ---: | -------: | -------: | -------: | --------------------: | ---------------: | ------------------: | --------------: |
|          50 |   40 |       10 |   0.936s |   0.948s |                  2.79 |            16.74 |               1.100 |      63.92 days |
|          75 |   40 |       35 |   1.294s |   1.314s |                  9.77 |            16.74 |               1.067 |      18.26 days |
|         100 |   40 |       60 |   1.617s |   1.649s |                 16.74 |            16.74 |               1.050 |      10.65 days |
|         150 |   40 |      110 |   2.434s |   2.446s |                 30.70 |            16.74 |               1.033 |       5.81 days |
|         200 |   40 |      160 |   3.087s |   3.135s |                 44.65 |            16.74 |               1.025 |       4.00 days |

Eight workers reduced synthetic pass latency further but did not improve
governed throughput because the 215-second Steam cadence became the binding
limit. Four is therefore the safer default. A total batch of 150 clears the
20/minute initial benchmark goal while staying within the requested
approximate 17 calls/hour ceiling. The measured 15.13 committed batches/hour
is only a product-pass proxy, so the canary gates scheduled starts and actual
attempts explicitly. The 50/minute stretch goal is not reachable with a
200-app cap, 40 protected live slots, and a 215-second cadence; increasing
Steam frequency or the existing cap is not proposed.

The candidate reduces the deterministic Tiger estimate from `3N + 4`
transactions to approximately `N + 6`, including one queue-metrics query. For
50 apps this is 154 to 56 transactions. Heartbeat row updates fall from 1,375
to 100 when the pass finishes before another timed barrier.

## Options considered

| Option                                                                   | Decision        | Evidence and trade-off                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch latest pointers and remaining-claim heartbeats                     | Implement       | Largest proven low-risk reduction; no schema or dependency.                                                                                                                                                                |
| Reuse or pool psycopg connections                                        | Defer           | Psycopg pooling is thread-safe and can reduce connection latency, but adds the separately packaged `psycopg_pool` dependency and needs production pool sizing evidence.                                                    |
| Four-worker bounded post-Steam concurrency                               | Implement       | R2 read scaling was strong through four workers; eight did not change cadence-governed throughput.                                                                                                                         |
| Fully decouple change polling from downstream processing                 | Defer           | Cooperative four-worker passes are expected to remain far below the five-minute cursor gate. Add a queue/scheduler only if canary p95 pass time threatens that bound.                                                      |
| Single-owner Steam request scheduler with independent downstream workers | Defer           | Correct long-term shape if Steam request classes must overlap, but substantially larger state-machine and circuit-breaker scope.                                                                                           |
| Adaptive live/catch-up scheduling                                        | Defer           | Protected 40 live slots remain fixed. Measure the faster processor before adding feedback control.                                                                                                                         |
| Route `needs_token` apps                                                 | Separate design | Current explicit source blocks are correct evidence. A compliant route requires token acquisition/expiry, an owned authenticated session, and the global Steam governor; it must not silently skip or synthesize payloads. |

Psycopg documents that pools bound concurrent connections and support
multithreaded callers, but the pool is a separate package. That makes it a
follow-up rather than part of the smallest safe patch:
<https://www.psycopg.org/psycopg3/docs/advanced/pool.html>.

## `needs_token` follow-up

Do not retry the 10,402 current source blocks anonymously or mark them ready.
A separate proposal should:

1. surface `needs_token` from the latest durable batch manifest on each claim;
2. route such claims to an explicit token-needed queue state;
3. acquire, cache, expire, and refresh tokens through the one owned Steam
   scheduler;
4. cover token calls, product-info, change polls, reconnects, and backoff with
   one token bucket, bounded queues, exponential backoff with full jitter, and
   a circuit breaker;
5. archive raw token-required and token-acquired evidence; and
6. preserve the present `source_blocked` outcome when no compliant token is
   available.

Any new persisted state or Tiger function requires a separately approved
migration window.

## Guarded production rollout

This PR does not deploy or change production configuration.

### Pre-canary gates

- merge only after the full PICS suite and focused lint pass;
- verify the exact genuine service and keep the duplicate stopped;
- retain `durable / primary`, processing enabled, and `40 / 10`;
- retain the 215-second product-info minimum and four workers;
- record a fresh repeatable-read queue/cursor snapshot and fixed-window log
  baseline;
- verify no expired claims, new dead letters, or missing parent archives; and
- start the automatic canary monitor described below against the exact
  deployment ID. The canary is blocked until that monitor is live.

### First 30 minutes: unchanged `40 / 10`

Pass only if:

- no cursor gap, manifest mismatch, archive-before-cursor violation, lost
  claim, readiness regression, or reconciliation mismatch;
- live cursor lag stays below five minutes;
- scheduled product-info starts are at most nine;
- product-info attempts remain one per successful pass;
- Steam disconnects are no more than two and reconnect succeeds on the first
  bounded attempt;
- zero lock timeouts, lease-renewal failures, new dead letters, rate-limit
  signals, or unarchived terminal settlements;
- processing pass p95 is below 180 seconds; and
- Tiger transactions/settlement are at most 1.25.

### Six hours: unchanged `40 / 10`

Pass only if:

- all 30-minute correctness gates continue to hold;
- product-info starts are at most 102;
- cursor lag p95 and maximum remain below five minutes;
- disconnects average no more than one/hour, with zero unrecovered sessions;
- change-poll retry rate is no higher than disconnect rate plus one/hour;
- catch-up terminal throughput is at least the 2.5/minute 24-hour baseline;
- zero lock timeouts, new dead letters, lost/expired claims, or rate-limit
  signals; and
- R2/Tiger phase p95 and queue ETA remain stable rather than worsening across
  consecutive hours.

### Automatic canary monitor

The rollback automation is an operator control, not an in-process second
leader. It must be configured and separately approved when a canary is
authorized; this PR neither installs it nor gives it production credentials.
Once authorized, it samples `/status`, fixed-window Railway logs, and bounded
read-only Tiger queue/cursor queries once per minute.

The monitor uses an idempotent state machine scoped to project
`68a3b2a8-43a6-45df-856e-0ba0e1309216`, environment
`4d6625a7-d942-4835-b74b-f0eff3e626ac`, service
`e6c49263-8466-4cb5-a37f-16299aae499e`, and the canary deployment ID:

1. **Observe:** evaluate the 30-minute or six-hour gates above. One correctness
   failure, rate-limit signal, lost/expired claim, lock timeout, lease-renewal
   failure, new dead letter, unrecovered Steam session, or unexpected
   deployment ID trips immediately. Latency/ETA gates trip after two
   consecutive samples to avoid reacting to one scrape artifact.
2. **Baseline quota:** if a larger quota is active, set only
   `PICS_CONSUMER_LIVE_BATCH_SIZE=40` and
   `PICS_CONSUMER_CATCHUP_BATCH_SIZE=10`, wait for the resulting deployment,
   and verify its `/status` reports `40 / 10`. Repeating this action is a
   no-op.
3. **Baseline image:** if a code-candidate gate still fails at baseline quota,
   redeploy the retained pre-canary image
   `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`.
4. **Verify and page:** require cursor lag below five minutes, one healthy
   canonical leader, no new correctness/failure signals, and an advancing
   source-complete cursor before declaring rollback complete. Otherwise stop
   automation and page an operator; never rewind or mutate durable data.

The approval for a canary must explicitly pre-authorize only those exact
rollback actions. A future experiment that increases any Steam-session request
frequency remains prohibited until one global token bucket, bounded request
queues, full-jitter exponential backoff, and circuit breaker cover change
polls, product info, token acquisition, heartbeats, and reconnects.

### Throughput canary: separate approval

Only after the unchanged-quota six-hour gate, obtain separate approval to test
larger, fuller requests without increasing frequency:

1. `40 / 60` (100 total) for 30 minutes, then six hours;
2. `40 / 110` (150 total) for 30 minutes, then six hours; and
3. stop at the first configuration sustaining at least 20 catch-up terminal
   settlements/minute with every correctness and Steam-health gate passing.

Eight workers are not part of the initial canary. A 200-app pass is a bounded
benchmark ceiling, not an automatic production setting.

### Immediate rollback

If the automatic monitor trips, or an operator confirms a gate failure:

1. stop quota escalation;
2. restore `40 / 10` if a larger batch was active;
3. if the code canary itself is implicated, redeploy the retained pre-canary
   image
   `sha256:12d637b2a33e2a1d593af0ee7a95ae03159fd20e9e1695d87a15e591d08e9f1f`;
4. keep the canonical cursor, archives, manifests, promotions, readiness, and
   leases intact;
5. do not rewind, delete, directly requeue, run the lossy legacy monitor, or
   start the duplicate service; and
6. verify the last committed batch, expired-claim recovery, `/status`, and
   fixed-window error rates after rollback.

Every deploy, variable change, rollback, database write, and migration remains
separately approval-gated.
