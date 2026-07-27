# Daily Opportunity Brief Operations

This guide covers the Tiger-backed opportunity domain, the browser contract,
continuous Railway worker, bounded GitHub reconciliation, deployment, monitoring,
and rollback.

## Runtime ownership

```text
Next.js /opportunities
  -> authenticated admin API proxy
  -> query-api /v1/opportunities/*
  -> Supabase token verification
  -> Tiger opportunity schema

Steam catalog/lifecycle/change events
  -> versioned material-event classifier
  -> leased Tiger work queue
  -> per-user evaluation runs
  -> immutable result/cohort/market evidence
  -> delivery outbox
  -> email or Slack summary linking to the website
```

- Supabase owns authentication, sessions, and the verified email identity.
- Tiger owns workspaces, memberships, presets, profile versions, material
  events, runs, results, evidence, team/personal state, and deliveries.
- The query API is the only browser-facing Tiger boundary.
- Railway continuously schedules, leases, evaluates, retries, and dispatches.
- GitHub Actions can run only the bounded event reconciliation fallback. It does
  not evaluate users or send deliveries.

The implementation does not reuse legacy pin/alert storage or infer newness from
mutable projection timestamps.

## Schema and seed files

Apply in this order only after a separately approved production-write window:

1. `packages/data-plane/sql/tiger-bootstrap/0097_opportunity_mvp.sql`
2. `packages/data-plane/sql/tiger-bootstrap/0098_opportunity_preset_seed.sql`

`0097` creates the additive `opportunity` schema and its versioned control,
event, run, result, state, queue, outbox, audit, cohort, market, and health
tables plus the timezone-aware `next_profile_evaluation_v1` scheduler.
`0098` inserts immutable v1 versions for the eight launch presets and can be
rerun safely.

No checked-in command applies these files automatically. Before a production
write, record:

- the exact two files and commit SHA;
- why the feature needs them;
- risk level and a current backup/PITR proof;
- the approval reference; and
- the rollback plan below.

### Preflight, read only

```sql
BEGIN TRANSACTION READ ONLY;
SELECT
  to_regclass('legacy.apps') AS apps,
  to_regclass('events.app_catalog_events') AS catalog_events,
  to_regclass('events.app_lifecycle_events') AS lifecycle_events,
  to_regclass('events.app_change_events') AS change_events,
  to_regclass('metrics.app_signal_windows_v1') AS signal_windows,
  to_regclass('ops.app_data_readiness') AS readiness;
COMMIT;
```

### Post-apply verification, read only

```sql
BEGIN TRANSACTION READ ONLY;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'opportunity'
ORDER BY table_name
LIMIT 100;

SELECT slug, current_version_id, editorial_status
FROM opportunity.presets
ORDER BY slug
LIMIT 20;
COMMIT;
```

## Query API configuration

The existing query-api service needs:

| Variable                                               | Purpose                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `TIGER_PRIMARY_URL`                                    | Opportunity domain and Steam evidence connection                    |
| `QUERY_API_BEARER_TOKEN`                               | Existing admin-to-query-api service authentication                  |
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`           | Verify the forwarded user token                                     |
| `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase auth verification                                          |
| `OPPORTUNITY_DELIVERY_ENCRYPTION_KEY`                  | 32-byte hex or base64 AES-256-GCM key used when saving destinations |

Use the same encryption key in the query API and worker. Rotating it without
reencrypting existing destination ciphertext makes those destinations
undecryptable.

## Railway worker

Create a dedicated background service from the repository root using
`packages/data-plane/railway-opportunity.json`.

The start command is:

```bash
pnpm --filter @publisheriq/data-plane opportunity-worker
```

Do not configure an HTTP health check; this is a process worker.

| Variable                              | Default                            | Purpose                                                           |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `TIGER_PRIMARY_URL`                   | required                           | Tiger connection                                                  |
| `OPPORTUNITY_WEBSITE_BASE_URL`        | `NEXT_PUBLIC_APP_URL` or localhost | Canonical result links                                            |
| `OPPORTUNITY_DELIVERY_ENCRYPTION_KEY` | required for external delivery     | Enables encrypted email/Slack destinations                        |
| `RESEND_API_KEY`                      | required before enabling email     | Enables email provider calls                                      |
| `OPPORTUNITY_EMAIL_FROM`              | PublisherIQ default                | Verified Resend sender                                            |
| `WORKER_ID`                           | generated UUID                     | Lease owner identity                                              |
| `CLAIM_LIMIT`                         | `8`                                | Fair queue claims per poll, clamped by the repository             |
| `DELIVERY_CLAIM_LIMIT`                | `10`                               | Delivery claims per poll                                          |
| `POLL_INTERVAL_MS`                    | `5000`                             | Delay between idle polls                                          |
| `MAX_IDLE_POLLS`                      | `0`                                | `0` runs continuously; positive values are for bounded local runs |

If the encryption key is absent, evaluations and website results still run, but
delivery configuration and dispatch remain unavailable.

If the encryption key is present but `RESEND_API_KEY` or a verified
`OPPORTUNITY_EMAIL_FROM` is not accepted, keep email preferences disabled.
Slack can be tested independently with an explicitly designated incoming
webhook. Never invent a destination for a rollout smoke.

## Bounded GitHub reconciliation

`.github/workflows/opportunity-reconcile.yml` is manual-only and requires:

- verified backup/PITR input;
- a non-empty production-write approval reference; and
- one to ten materialization passes.

Each pass reads at most 100 catalog rows, 100 lifecycle rows, and 500 raw change
rows, advances the durable materialization cursor, and stores grouped events.
The same bounds are used by the Railway worker. The active queue claim is
renewed every 50 processed moments, and one worker pass claims at most one
global `materialize_events` trigger. Reconciliation cannot dispatch email or
Slack and does not replace the Railway worker.

Local command:

```bash
OPPORTUNITY_RECONCILE_PASSES=1 \
  pnpm --filter @publisheriq/data-plane opportunity-reconcile
```

This is a database write and requires the same production approval as the
workflow.

## Monitoring

All examples are bounded and read only.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT state, lane, count(*) AS items
FROM opportunity.work_queue
WHERE created_at >= now() - interval '7 days'
GROUP BY state, lane
ORDER BY lane, state
LIMIT 100;

SELECT status, channel, count(*) AS deliveries
FROM opportunity.deliveries
WHERE created_at >= now() - interval '7 days'
GROUP BY status, channel
ORDER BY channel, status
LIMIT 20;

SELECT status, run_kind, count(*) AS runs, max(completed_at) AS last_completed_at
FROM opportunity.runs
WHERE created_at >= now() - interval '7 days'
GROUP BY status, run_kind
ORDER BY run_kind, status
LIMIT 30;

SELECT cursor_key, cursor_value, updated_at
FROM opportunity.worker_cursors
ORDER BY cursor_key
LIMIT 20;

COMMIT;
```

Investigate:

- claimed rows whose lease is repeatedly expiring;
- a materialization claim whose heartbeat does not advance during progress;
- more than one active materialization claim owned by the same current worker;
- growing retry/dead-letter counts by lane;
- source-blocked work;
- delivery rows exhausting retry attempts;
- daily runs without a successful completion; and
- stale materialization cursors.

Queue failures use exponential backoff and dead-letter after the configured
attempt ceiling. A failed run does not advance the user’s successful daily
window.

Readiness runs are deliberately separate from daily/manual/replay runs. They
retain the original material-event ID, never advance the durable daily cursor,
never move a profile's local schedule, and do not emit a standalone daily
digest. A qualification completed by a readiness run is absorbed into the next
daily website overview and channel summary.

Profile schedules use an IANA timezone and local `HH:MM` delivery time. The
first evaluation after enabling is immediate; later successful daily runs call
`opportunity.next_profile_evaluation_v1`, which is daylight-saving aware.
Channel preferences may be user-wide or profile-scoped. Profile-scoped
preferences are evaluated first, and a canonical result is included at most
once per channel. A summary that reaches its result limit includes an explicit
truncation notice.

Historical `last_error_code` and `last_error_message` values are retained on a
completed queue row. Use `state`, `completed_at`, and the current worker/lease
fields to determine present health; retained error text is prior-attempt
evidence, not a new failure.

## Rollout

1. Confirm change-intelligence and PICS source readiness with read-only checks.
2. Record backup/PITR proof and explicit database-write approval.
3. Apply `0097`, then `0098`.
4. Run the post-apply read-only verification.
5. Deploy query-api with auth verification and the shared encryption key.
6. Deploy the admin app.
7. Deploy one Railway opportunity worker.
8. Create a test profile, preview it, enable it, and verify one canonical
   website result before enabling delivery.
9. Enable email, then Slack, for a test identity and confirm only one outbox
   delivery per idempotency key.
10. Review queue, run, source-health, cohort, and preset-health evidence before a
    broader rollout.

The July 27 rollout completed steps 1–7 and the profile
create/clone/preview/enable/pause/resume portion of step 8. A non-empty result,
real-result state actions, and external provider sends remain open; see the
[production rollout closeout](../../reference/opportunity-production-rollout-closeout-2026-07-27.md).

## Rollback

The low-risk rollback is a service cutback, not data deletion:

1. Stop the Railway opportunity worker.
2. Revert the admin and query-api deployments to the previous known-good commit.
3. Leave the additive `opportunity` schema intact so run and delivery evidence is
   preserved.
4. Inspect any claimed work and pending outbox rows read only before deciding on
   further action.

Dropping the schema or deleting rows is intentionally not part of routine
rollback. That would destroy evidence and requires a new destructive migration,
separate risk review, backup proof, and explicit approval.

## Verification commands

```bash
pnpm --filter @publisheriq/data-plane test
pnpm --filter @publisheriq/data-plane check-types
pnpm --filter @publisheriq/query-api test
pnpm --filter @publisheriq/query-api check-types
pnpm --filter @publisheriq/admin test
pnpm lint
pnpm check-types
pnpm build
```

Also run the repository’s ingestion/change-intelligence, PICS, ingestion
verification, writer-audit, and browser regression commands before production
cutover.
