# Bug Intake: youtube production sync rollup timeout

- Bug ID: `20260417-051810-youtube-production-sync-rollup-timeout`
- Created At: `2026-04-17T05:18:10.724427+00:00`
- Slug: `youtube-production-sync-rollup-timeout`

## Original Request

The user reported that YouTube production sync was failing in GitHub Actions and
provided a screenshot of the `youtube-production-sync.yml` job failing on
`pnpm youtube:rollup-daily` with `canceling statement due to statement timeout`.

After the assessment was complete, the user approved implementation.

## Supplied Context

- Screenshots copied into the case directory:
  - None
- Relevant files/routes/logs:
  - `.github/workflows/youtube-production-sync.yml`
  - `packages/youtube/src/storage.ts`
  - `packages/youtube/src/jobs.ts`
  - `packages/youtube/src/config.ts`
  - GitHub Actions log excerpt showing Postgres error code `57401`

## Constraints

- Ask before behavior-changing fixes.
- Use read-only DB checks only when relevant.

## Notes

- This was treated as a contained performance bug, not a product-definition
  change.
- Read-only Tiger checks reproduced the timeout without writing to production.
- The implemented fix keeps rollup semantics unchanged and rewrites the SQL to
  avoid repeated correlated snapshot lookups.
