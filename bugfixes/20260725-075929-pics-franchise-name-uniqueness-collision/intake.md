# Bug Intake: PICS franchise name uniqueness collision

- Bug ID: `20260725-075929-pics-franchise-name-uniqueness-collision`
- Created At: `2026-07-25T07:59:29.239647+00:00`
- Slug: `pics-franchise-name-uniqueness-collision`

## Original Request

During the approved deployment of PR #65, the newly unstarved PICS retry pool
revealed one deterministic-looking `processing_error` for app `252190`:

```text
duplicate key value violates unique constraint "franchises_name_key"
DETAIL: Key (name)=(Defender's  Quest) already exists.
```

The user said to continue with the next recommended preparation step. The
immediate objective is to prevent this valid durable work item from exhausting
its retry budget while preserving entity identity and existing relationships.

## Supplied Context

- Screenshots copied into the case directory:
  - None
- Relevant files/routes/logs:
  - production PICS work row `8176`, app `252190`, stream `primary`;
  - first observed before the PR #65 deployment at attempt `1/8`;
  - remained retryable after two post-deploy passes at attempt `3/8`;
  - error code `processing_error`;
  - unique constraint `franchises_name_key`; and
  - likely owner under `services/pics-service/src/database/`.

## Constraints

- Tiger and R2 are the product-data source of truth; do not use Supabase.
- Use bounded read-only Tiger queries during assessment.
- Do not update, requeue, delete, or otherwise repair the production row.
- Do not deploy, restart, or change either Railway service in this fix slice.
- The genuine PICS service remains `durable / primary` with `40/40` quotas.
- The duplicate non-PICS Railway service must remain stopped.
- Preserve existing entity IDs and app-franchise relationships.
- The expected fix is idempotent conflict handling, not name normalization
  that changes product meaning.

## Notes

PR #65 correctly made eligible retries visible. This case is a separate,
pre-existing promotion defect surfaced by that rollout. If a production dead
letter or durable-integrity failure appears during the assessment, the prior
rollback controls still apply independently of this code-only case.
