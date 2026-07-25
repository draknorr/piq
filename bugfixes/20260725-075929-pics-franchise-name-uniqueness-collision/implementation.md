# Implementation

## Summary

Added one shared Tiger franchise identity resolver and used it from both PICS
write paths. The resolver preserves exact-name IDs before considering current
normalization, which makes stale legacy rows idempotent without silently
merging distinct franchise entities.

## What Changed

- Resolve an exact franchise `name` before looking up `normalized_name`.
- Insert only when neither identity exists.
- Use targetless `ON CONFLICT DO NOTHING` so either unique constraint is safe
  when another transaction inserts concurrently.
- Reselect after a concurrent conflict and fail explicitly if no identity can
  be resolved.
- Reuse the resolver from durable atomic promotion and the older Tiger
  latest-state relationship path.
- Added regressions for the production stale-normalization shape, exact-name
  precedence, normalized reuse, new insertion, concurrent conflict recovery,
  and both callers.

## What Did Not Change

- Existing franchise names, normalized values, IDs, and app relationships are
  not updated or merged.
- Relationship completeness, deletion scope, promotion transactions, work
  settlement, cursor advancement, readiness, snapshots, and events are
  unchanged.
- No database schema, production row, R2 object, Supabase record, runtime
  variable, Railway service, deployment, or live-site reader was changed.

## Validation

- Targeted PICS regression suite: `22` passed.
- Complete PICS pytest suite: `108` passed.
- Changed-file Black: passed.
- Changed-file Ruff: passed.
- Targeted mypy: passed.
- Python compilation: passed.
- `git diff --check`: passed.

The pytest warning is the existing Pydantic class-based configuration
deprecation. Repository-wide Ruff and mypy retain pre-existing debt documented
in `artifacts/tests/post-fix-validation.md`.

## Rollback

Revert the code commit before deployment, or redeploy the preceding PICS
artifact if a later separately approved rollout shows a regression. No data
rollback is needed because this PR performs no production mutation.
