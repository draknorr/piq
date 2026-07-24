# Daily Opportunity Preparation Baseline

- Captured: 2026-07-24T01:27:56.667Z
- Database access: read-only transactions
- Production mutation performed: no

This snapshot contains schema metadata, bounded operational aggregates, and
hashed primary-key sets for Supabase Auth-adjacent and legacy non-auth tables
that must survive a reconciled migration. These hashes are preservation
evidence, not a declaration that Supabase remains the non-auth authority. It contains
no credentials or private profile fields.

The manifest remains partial until every item in `captureGaps` is resolved.
