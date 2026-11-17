# PICS backlog drain candidate — deployment held

Prepared November 17, 2026. This checkout contains a review candidate only. No production
deployment, restart, environment change, database migration, enqueue, reconciliation
restart, or write is authorized or performed here.

## Problem and proposed behavior

The read-only diagnostic sample at approximately 22:21 UTC had 97,425 due apps,
33,814 older than 12 hours, and an oldest age of 23.04 hours. The preceding hour
contained 9,741 source positions, 1,280 claims, 907 successful updates and 373
audited source blocks. Source positions can repeat apps; 9,741 is a conservative
arrival assumption, not a measurement of unique new queue admissions.

An 80-app pass every 215 seconds permits only 1,339.5 claims/hour, regardless of
spare CPU. Raising concurrency alone cannot overcome this admission cap. Intake
also moved pending work's `next_attempt_at` to now whenever a new revision
arrived; frequently updated apps could lose queue position. A shared Opportunity
revision row can serialize Tiger writers, so larger passes alone are insufficient.

The candidate:

- Adds an explicit `PICS_CONSUMER_LARGE_BATCHES_ENABLED` opt-in. Defaults retain
  the 200-app combined cap. Opt-in permits at most 1,000 live/new claims, requires
  catch-up zero and successor feeder false, and retains the eight-thread ceiling.
- Aligns the SQL claim and snapshot lookup bounds at 1,000; the old independent
  500-row limits would otherwise silently halve the quota or reject the pass.
- Splits anonymous and token-required work separately into requests of at most
  200 apps. Every chunk uses the existing fetcher, single Steam session and shared
  request governor. A failed chunk is independently archived and settled; other
  chunks continue. Retries/deadlines/circuit rules and 215-second pass spacing stay.
- Uses psycopg pipeline mode for the existing ordered relationship, field-evidence
  and sync statements when the drain opt-in is enabled. Dependent fetches flush
  automatically, and pipeline exit flushes before event/readiness/acknowledgement.
  This reduces network waits while holding revision locks. It retains per-app
  transactions and the revision triggers; it does not eliminate shared-lock contention.
- Preserves pending, retrying and claimed eligibility times when coalescing newer
  source revisions. Completed, blocked and dead-letter work still reopens for newer
  revisions; active claims keep their claimed version/lease and receive follow-up work.

`PICS_CONSUMER_LIVE_BATCH_SIZE=1000`, concurrency `8`, catch-up `0`, cadence `215`,
borrowing false and feeder false are recorded in `scripts/backlog-drain.env.example`.
The example is not loaded automatically. No schema or dependency change is needed.
Existing archive/cursor/recovery guards remain; historical reconciliation stays paused.

## Verification

The processor tests exercise full 1,000-app passes, all-anonymous/all-token/mixed
chunks, a failed middle chunk, request counts, failure settlement, the default cap,
invalid opt-in combinations, bounded native concurrency, responsive gevent scheduling,
and lease renewal across a multi-chunk Steam wait.

The opt-in PostgreSQL test runs only against an explicitly named disposable local
`pics_throughput_test` database. It verifies pending order, delayed retry eligibility,
claimed-version/token preservation, settled-work reopening, source positions, cursor
advancement and exact idempotent replay. Real SQL also returns all 1,000 claims
and prior pointers and renews all 1,000 leases; pointer requests over 1,000 fail. It also exercises the real relationship,
evidence and sync SQL with and without pipeline mode: identical output from 13
statements with one explicit fetch dependency. A queued division-by-zero verifies
that all preceding writes roll back. The existing local recovery integration test
verifies rollback, concurrent recovery/idempotence and exact head/source admission.
Its fixture now initializes a field introduced by the inherited resilience patch.

No production writer verification or load test was run. The relevant write paths
were tested locally; running the production ingestion verifier here would not prove
that an undeployed candidate had written anything.

Final checks: 310 Python tests passed (two opt-in SQL tests skipped in that run),
and both opt-in PostgreSQL tests passed separately. `pnpm build`, `pnpm check-types`,
`pnpm lint` and Ruff on changed Python files passed; existing lint/deprecation
warnings remain. Core Python versions match the service lock: gevent 24.11.1,
psycopg/binary 3.3.4, pool 3.3.1, pydantic 2.13.4 and settings 2.14.2. Other Python
dependencies were installed in an isolated test venv. No lockfile changed. Machine-readable results are in
`backlog-drain-evidence.json`. This local branch has not been pushed; CI and the
previously failing Opportunity browser tests have not been rerun or cleared.

Local setup installed Homebrew PostgreSQL 17 and refreshed its dependencies; no
login service was enabled. The disposable database cluster is stopped after tests.

## Capacity evidence and limits

The extended no-network benchmark validates real payloads and prior archive hashes,
then models one Tiger promotion transaction and one R2 read/write per changed app.
It uses the shared Steam scheduler and counts every product-info chunk. All apps
succeed and change snapshots in these samples; this is deliberately heavier than
source-blocking them, but it does not model the full production payload distribution.

Injected R2 latency is 150 ms per operation, Tiger promotion 900 ms, and Steam
product request latency 1,000 ms. With three scaled samples per configuration:

| Profile           | Modeled pass p95 | Gross settlements/hour | Net against 9,741 arrivals/hour |
| ----------------- | ---------------: | ---------------------: | ------------------------------: |
| 80 / 3 workers    |          50.57 s |                  1,340 |                          -8,401 |
| 1,000 / 3 workers |         496.30 s |                  7,254 |                          -2,487 |
| 80 / 8 workers    |          21.85 s |                  1,340 |                          -8,401 |
| 1,000 / 8 workers |         199.08 s |                 16,744 |                          +7,003 |

A full-speed, unscaled 1,000/8 sample took 163.37 seconds and settled all 1,000
apps with five product-info calls, 1,000 R2 reads and 1,000 writes. The gross rate
still uses the 215-second floor. Under these assumptions the 97,425-item backlog
would drain in approximately 13.9 hours. This is a model, not a production ETA.
The scaled runs include unscaled Python overhead and small samples are not percentiles
of production latency. Poll scheduling, newer revisions requeuing claims, network
variance and competing workloads can lower realized throughput.

Doubling modeled Tiger latency to 1,800 ms yielded a 318.98-second pass,
11,286 settlements/hour and +1,545 net/hour. A deliberately adverse 900-ms Tiger
case with half its duration serialized behind a shared lock yielded only 5,385/hour
and **did not drain**. The model does not assume pipelining removes that lock: actual
lock duration and pool waits must be measured. Do not accept full capacity on the
strength of the favorable model. A 1,000-app cycle above about 370 seconds cannot
outpace the conservative 9,741/hour arrival assumption even with perfect settlement.

Benchmark commands (from this service directory; no credentials required):

```sh
python scripts/benchmark_durable_processor.py --warm-durable \
  --batch-sizes 80,1000 --workers 3,8 --live-reserve 1000 --samples 3 \
  --r2-latency-ms 150 --tiger-latency-ms 900 --steam-latency-ms 1000 \
  --incoming-apps-per-hour 9741 --live-open 97425 --time-scale 0.03
```

For the full-speed sample use `--batch-sizes 1000 --workers 8 --samples 1` and
omit `--time-scale`. For the doubled-latency case set `--tiger-latency-ms 1800`.
For contention add `--serialized-tiger-fraction 0.5` to the 900-ms warm case.
Disconnects, request failures, query latency and resource headroom require a canary.

## Review and later rollout requirements

This branch builds on the held PR #145 resilience branch at `c2dad939`; it therefore
also includes that branch's undeployed transient Steam recovery behavior and resolver
pin. Review those together before choosing a production image. The held production
image is deployment `2ade5128-28c0-4a80-95ec-caf2fa8d11b1`, commit `9293c27`.

After separate approval, start with the opt-in enabled at live 200/concurrency 8
for bounded observation of pipeline and locking, then 500 and finally 1,000 only
when telemetry supports each step. Early canaries are not expected to drain at the
conservative arrival rate. Judge the final profile by net unique admissions versus
settlements/requeues, shrinking due count and age buckets over matched windows,
fresh cursor/poll/processing progress, and successful archive/lease audits. An audited
source block is not recovered product data; do not count it as a successful update.

Require actual Tiger CPU/memory telemetry and matched workload overlap for GitHub,
Railway and native writers. Missing telemetry is not headroom. Hold or roll back a
canary for CPU over 70% for five minutes, memory at/over 80%, OOM, query errors or
doubled matched latency, deadlocks/timeouts, sustained queue-age worsening, expired
leases, archive/cursor problems, new audited gaps, or Steam throttle/deadline/
disconnect/circuit failures. More concurrency is not an answer to sustained serialized
locking. The separate descriptor alias error and broader Tiger efficiency work remain
unresolved by this patch.

Future rollback: restore the prior image and prior 80/3/215 configuration; disable
large batches before lowering the cap (flag false with live 1,000 deliberately fails
startup). Retain all committed cursor positions, immutable archives, audits and work
rows. Set the automatic forward-recovery flag false if future recovery transitions
must stop; never rewind its committed cursor. No rollback is executed during preparation.
