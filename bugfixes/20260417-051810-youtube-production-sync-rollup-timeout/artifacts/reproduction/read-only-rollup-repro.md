# Read-Only Rollup Reproduction

## Goal

Reproduce the GitHub Actions timeout without writing to production Tiger.

## Results

- The read-only SELECT equivalent of the original `rebuildDailyRollups()` query
  timed out under `PGOPTIONS='-c statement_timeout=15000'`.
- The same old query completed in `29483.777 ms` under
  `PGOPTIONS='-c statement_timeout=60000'`.
- The set-based replacement query completed in `4040.450 ms` under
  `PGOPTIONS='-c statement_timeout=15000'`.
- A full comparison of the old and new 30-day rollup result sets returned
  `diff_rows = 0`.

## Interpretation

This reproduced the production failure mode with read-only SQL and showed that
the fix addressed query cost rather than masking it with a larger timeout.
