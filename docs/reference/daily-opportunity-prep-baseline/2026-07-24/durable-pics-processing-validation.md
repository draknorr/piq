# Durable PICS Processing Validation

Captured on July 24, 2026 UTC while preparing PR 4. All production checks in
this record were read-only. No Tiger, R2, Supabase, Railway, or Steam product
state was mutated.

## Runtime precondition

PR #43 merged to `origin/main` as `ac81b9d`. Immediately afterward, both
distinct Railway services named `publisheriq` remained stopped:

- genuine legacy PICS
  `e6c49263-8466-4cb5-a37f-16299aae499e`: `stopped=true`,
  deployment status `FAILED`;
- accidental Query API duplicate
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`: `stopped=true`,
  deployment status `FAILED`.

PR 4 was created from that merged commit in a separate worktree. Processing
defaults to disabled and no service configuration was changed.

## Live source-shape findings

Bounded anonymous Steam product-info requests established the source contract
that the legacy normalized extractor could not retain:

- apps `730` and `1245620` returned full product records with
  `_missing_token=false`, source change number, SHA, size, and all inspected
  relationship-family keys;
- demo `4578540` returned complete categories, genres, and associations while
  `store_tags` and `listofdlc` were absent;
- demo `4795520` returned a present two-item genres family while the stalled
  Tiger latest state still had zero genre edges; and
- ValvePython `steam` 1.4.4 documents `_missing_token=true` as lacking access
  to full app information.

These observations rule out using an empty normalized list as deletion proof.
PR 4 records `complete`, `absent`, or `partial` family evidence before
normalization. Only a present, well-typed family in a source-complete payload
may replace Tiger relationships.

## Live Tiger contract validation

Bounded `information_schema` and `pg_constraint` reads verified the current
columns and constraints for:

- `ops.pics_work_state`;
- `ops.app_data_readiness`;
- `docs.app_source_snapshots`;
- `events.app_change_events`;
- `legacy.apps`;
- category, genre, tag, franchise, DLC, and Steam Deck relationships.

All 34 parameterized SQL statements in the new work and promotion stores
parsed with `pglast`. Read-only `EXPLAIN` against production Tiger then planned:

| Contract group                                            | Statements |
| --------------------------------------------------------- | ---------: |
| PICS-owned app, taxonomy, relationship, DLC, and sync SQL |         17 |
| Stale-lease recovery plus `SKIP LOCKED` claim SQL         |          4 |
| Heartbeat, retry, source-block, and acknowledgement SQL   |         15 |
| Full snapshot/latest-state/readiness/ack promotion path   |         15 |

`EXPLAIN` planned the writer statements but did not execute them. This caught
one pre-runtime defect: PostgreSQL cannot bind a parameter directly in
`SET LOCAL`. The work store now uses the same transaction-local
`set_config(..., true)` pattern already proven by durable intake.

## Unit and failure-injection evidence

The focused durable-processing suites cover:

- deterministic raw and normalized hashes;
- host-independent UTC timestamp normalization;
- snapshot evidence for every PICS field promoted to latest state;
- missing, malformed, and explicitly complete-empty families;
- preservation of absent scalar fields and relationship edges;
- token-blocked and stale product payloads;
- protected live and catch-up quotas;
- stale-lease recovery and `FOR UPDATE SKIP LOCKED`;
- heartbeat ownership and renewal of every unprocessed lease;
- batch-fetch failure settlement without waiting for lease expiry;
- capped retry and lost-claim behavior;
- shadow validation without primary promotion;
- archive-before-promotion ordering;
- snapshot/latest-state/readiness/ack transaction ordering; and
- rollback injection at snapshot, app, relationship, sync-status, readiness,
  and acknowledgement boundaries.

At this checkpoint:

```text
focused durable-processing tests: 32 passed
full PICS pytest: 88 passed
data-plane tests: 58 passed
targeted Ruff lint/format: passed
pnpm check-types: passed (13/13)
pnpm build: passed (10/10)
production writes: 0
```

The existing 29 warnings are unchanged deprecation warnings.

The repository-wide `pnpm lint` remains red on four pre-existing errors in
unchanged `packages/data-plane` files: one empty-interface rule violation, one
unused helper, and two unused `lightweight` parameters. The PR 4 Python files
pass their changed-file Ruff checks, and `git diff origin/main` confirms that
PR 4 does not change `packages/data-plane` or `apps/query-api`.

## Final no-write invariant

A final bounded read-only Tiger transaction returned:

| Check                                              |                         Result |
| -------------------------------------------------- | -----------------------------: |
| Total `ops.pics_change_batches` rows               |                              1 |
| Total `ops.pics_change_batch_apps` rows            |                              0 |
| Total `ops.pics_work_state` rows                   |                              0 |
| PICS `ops.app_data_readiness` rows                 |                              0 |
| Canonical `ops.pics_sync_state.last_change_number` |                     37,491,237 |
| Canonical cursor `updated_at`                      | `2026-07-24 02:52:52.69384+00` |

Both exact Railway services named `publisheriq` were checked again by service
ID. Each still had zero active deployments, `deploymentStopped=true`, and
latest status `FAILED`.

## Remaining rollout gates

- Open PR 4 without deploying it.
- Design a full-state historical reconciliation because Steam no longer
  retains the June incremental interval.
- After merge, require fresh recovery evidence and separate approval before
  any R2/Tiger shadow processing or Railway configuration change.
