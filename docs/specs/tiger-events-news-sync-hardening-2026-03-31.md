# Tiger Events and News Sync Hardening

Date: March 31, 2026

This note defines the next Tiger phase after the first change-intel load.

## Goal

Make the current Tiger docs/change-intel slice repeatably convergent while
Supabase remains the live source of truth.

The scope is limited to:

- `docs.steam_news_items`
- `docs.steam_news_search_projection`
- `events.app_change_events`

This phase does not add a new public contract. It exists to make the current
`explainChanges` slice trustworthy and to unblock `searchDocuments`.

## New operator command

```bash
pnpm tiger:reconcile-events-news
```

Supported modes:

- `EVENTS_NEWS_SYNC_MODE=validate`
- `EVENTS_NEWS_SYNC_MODE=reconcile`

Projection repair scope:

- `EVENTS_NEWS_SYNC_PROJECTION_REPAIR_SCOPE=recent_window`
- `EVENTS_NEWS_SYNC_PROJECTION_REPAIR_SCOPE=exact_parity`

Defaults:

- mode defaults to `reconcile`
- all three tables are selected unless `EVENTS_NEWS_SYNC_TABLES` narrows them
- projection repair defaults to `recent_window` for scheduled syncs

## Reconciliation policy

### `docs.steam_news_items`

- validates exact full-table parity
- validates exact per-day parity for the last `7` UTC days
- in reconcile mode always replays:
  - current UTC day
  - previous UTC day
  - any mismatched recent day in the last `7` UTC days
- replay uses idempotent upsert by `gid`

### `events.app_change_events`

- validates exact full-table parity
- validates exact per-day parity for the last `3` UTC days
- in reconcile mode always replays:
  - current UTC day
  - previous UTC day
  - any mismatched recent day in the last `3` UTC days
- replay uses idempotent upsert by Tiger key `(occurred_at, id)`
- post-run validation still requires zero duplicate source `id` values

### `docs.steam_news_search_projection`

- validates exact full-table parity
- validates exact per-month parity across full history
- validates exact per-day parity for the last `7` UTC days
- in reconcile mode:
  - `recent_window` replays the current UTC month, previous UTC month, and any
    month containing a recent-day mismatch
  - `exact_parity` replays every mismatched month found in validation plus the
    current and previous UTC month
- replay is delete-aware:
  - stale Tiger rows in the replayed month are deleted when their `gid` is no
    longer present in the authoritative source month
  - remaining rows are upserted by `gid`

## Validation artifacts

Each run writes a machine-readable manifest under:

- `docs/reference/tiger-target-baseline/<date>/<label>/events-news-sync-manifest.json`

The manifest records:

- mode
- selected tables
- partition mismatches before replay
- replay actions taken
- final source and Tiger counts
- integrity checks
- final pass/fail status

## Safety rules

- reconcile mode acquires a Tiger advisory lock so only one sync run can mutate
  the docs/event slice at a time
- projection month replacement uses an unlogged stage table and drops it after
  the run
- a failed run exits non-zero and leaves a failed manifest instead of silently
  passing
