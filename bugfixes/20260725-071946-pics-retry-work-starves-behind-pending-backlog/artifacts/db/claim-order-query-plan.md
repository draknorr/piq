# Claim-order query-plan comparison

Live Tiger `EXPLAIN` was run read-only for the current ordering and for the
proposed additional state tie-breaker.

Both queries used the same shape:

- parallel sequential scan of `ops.pics_work_state`;
- bounded sort;
- gather merge; and
- `LIMIT 40`.

Estimated top-level cost:

| Ordering | Limit cost | Gather-merge upper cost |
| --- | ---: | ---: |
| Current | `12008.08..12012.64` | `15435.18` |
| Proposed | `12052.30..12056.86` | `15479.40` |

The current lane `CASE` already prevents the planner from serving the complete
order directly from the claimable index. Adding the retry-state tie-breaker
does not introduce a new plan shape and changes estimated cost by less than
one percent.

Verdict: the contained ordering fix does not require a new index or production
schema migration.
