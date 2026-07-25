# Live Tiger retry-ordering evidence

- Observed at: `2026-07-25T07:21:40.498166Z`
- Database: live Tiger product-data plane
- Access: bounded read-only transaction
- Supabase: not inspected

## Question

Can currently eligible retry rows lose the existing claim order to older pending
rows in the same lane and priority?

## SQL

```sql
SELECT
  lane,
  priority,
  state,
  count(*) AS rows,
  min(next_attempt_at) AS earliest_next_attempt,
  max(next_attempt_at) AS latest_next_attempt,
  min(dirty_since) AS oldest_dirty
FROM ops.pics_work_state
WHERE stream_key = 'primary'
  AND state IN ('pending', 'retrying')
GROUP BY lane, priority, state
ORDER BY lane, priority DESC, state
LIMIT 30;

SELECT
  id,
  appid,
  lane,
  priority,
  state,
  attempts,
  max_attempts,
  next_attempt_at,
  dirty_since,
  last_error_code,
  updated_at
FROM ops.pics_work_state
WHERE stream_key = 'primary'
  AND state = 'retrying'
ORDER BY updated_at DESC, id DESC
LIMIT 20;

SELECT
  id,
  appid,
  lane,
  priority,
  state,
  next_attempt_at,
  dirty_since
FROM ops.pics_work_state
WHERE stream_key = 'primary'
  AND lane = 'catchup'
  AND priority = 100
  AND state IN ('pending', 'retrying')
  AND next_attempt_at <= clock_timestamp()
  AND attempts < max_attempts
ORDER BY
  priority DESC,
  next_attempt_at ASC,
  dirty_since ASC,
  id ASC
LIMIT 20;
```

## Results

- Catch-up priority `100`:
  - pending: `281,353`, with `next_attempt_at` fixed at
    `2026-07-25T03:23:23.169921Z`;
  - retrying: `31`, with eligible `next_attempt_at` values from
    `2026-07-25T05:33:00.909498Z` through
    `2026-07-25T06:58:48.041567Z`.
- Live priority `200`:
  - pending: `876`;
  - retrying: `35`.
- The three claims interrupted by the quota redeploy remained recoverable
  catch-up retries with IDs `3450`–`3452`, `attempts=1`,
  `max_attempts=8`, and `last_error_code=lease_expired`.
- The first 20 rows selected by the current catch-up ordering were all pending
  rows. No retry row appeared.

## Verdict

This is source-of-truth evidence confirming the bug. The claim query's
`next_attempt_at` tie-breaker places the entire older pending catch-up backlog
ahead of eligible retries when lane and priority are equal.
