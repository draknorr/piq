# Implementation

## Summary

Updated the durable PICS claim order so an eligible retry is selected before
pending work only when both rows are in the same lane and have the same
priority.

## What Changed

- Added a `retrying`-before-`pending` state tie-breaker in
  `TigerPICSDurableWorkStore.claim_work()`.
- Kept lane order first and descending priority second.
- Kept `next_attempt_at`, `dirty_since`, and ID as the deterministic ordering
  inside each lane, priority, and state group.
- Added regression coverage proving the exact ordering precedence and
  preserving `FOR UPDATE ... SKIP LOCKED`.

## What Did Not Change

- Live/new and catch-up claims remain separate calls with unchanged quotas.
- Retry eligibility delay, maximum attempts, leases, stale-claim recovery,
  failure settlement, reconciliation, readiness, cursor advancement, and
  archive behavior are unchanged.
- No database schema, production data, runtime configuration, Railway service,
  R2 object, or Supabase record was changed.

## Validation

- `PYTHONPATH=. pytest tests/test_durable_work.py -q`
  - `15 passed, 1 warning`
- `PYTHONPATH=. pytest -q`
  - `102 passed, 1 warning`
- `PYTHONPYCACHEPREFIX=<temporary-directory> python3 -m compileall -q src`
  - passed
- `ruff check --no-cache src/database/durable_work.py tests/test_durable_work.py`
  - passed
- `black --check src/database/durable_work.py tests/test_durable_work.py`
  - passed
- `git diff --check`
  - passed

The warning in both pytest runs is the existing Pydantic class-based
configuration deprecation.

Repository-wide Ruff and targeted mypy are not clean on the unchanged base:
Ruff reports `116` existing violations outside the changed lines, and mypy
reports the existing `dict_row = None` assignment issue at
`src/database/durable_work.py:126`. Neither baseline issue was expanded into
this contained behavior fix.

## Rollback

Revert the code commit before deployment, or redeploy the preceding PICS
artifact if a later separately approved rollout shows a regression. No data
rollback is needed because this PR performs no production mutation.
