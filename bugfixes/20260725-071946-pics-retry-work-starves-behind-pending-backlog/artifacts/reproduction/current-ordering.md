# Current ordering reproduction

The current SQL order is:

1. lane (`new`, `live`, `catchup`);
2. priority descending;
3. `next_attempt_at` ascending;
4. `dirty_since` ascending;
5. ID ascending.

For two eligible catch-up rows with equal priority:

| ID | State | Priority | Next attempt |
| --: | --- | ---: | --- |
| 1 | pending | 100 | `2026-07-25T07:00:00Z` |
| 2 | retrying | 100 | `2026-07-25T07:05:00Z` |

the current order selects pending ID `1` before retrying ID `2`. This matches
live Tiger, where the bulk pending backlog has an earlier `next_attempt_at`
than every retry row.

The proposed order inserts the state preference only after lane and priority:

1. lane;
2. priority descending;
3. retrying before pending;
4. `next_attempt_at`;
5. `dirty_since`;
6. ID.

This preserves all existing protections while making eligible retries
eventually claimable.
