# Opportunity v1 Calibration — July 27, 2026

This note records the production evidence used for conservative v1 market and
preset-health defaults. It is a calibration snapshot, not a promise about future
catalog distributions.

## Read-only production sample

At approximately 08:20 UTC on July 27, 2026, a deterministic bounded sample of
50,000 released, non-delisted Steam games was joined to the latest daily metric
row and the v1 signal-window table.

| Measurement                                         | Observed value |
| --------------------------------------------------- | -------------: |
| Sampled games                                       |         50,000 |
| Games with positive review totals                   |         48,957 |
| Review total P75                                    |            238 |
| Review total P90                                    |        1,394.4 |
| Games with positive peak CCU                        |         12,835 |
| Peak CCU P75                                        |             14 |
| Usable 7d-vs-prior review-acceleration observations |             10 |
| Usable 30d CCU-growth observations                  |             23 |

The catalog, incremental catalog, and live PICS paths were current at inspection
time. This superseded the July 24 preparation note that PICS latest state was
stale. Signal-window coverage was still a small shadow sample, so it was not
sufficient to empirically tune health-state movement thresholds.

The first calibration query referenced a documented-but-nonexistent
`ccu_change_30d` column. Read-only schema inspection established the live columns
as `ccu_peak_first_30d`, `ccu_peak_latest_30d`, and
`ccu_peak_change_30d`. The implementation therefore computes relative CCU growth
from latest versus first and does not interpret the absolute change column as a
percentage.

## Chosen market defaults

`opportunity-market/v1` uses:

| Default                 | Value | Rationale                                          |
| ----------------------- | ----: | -------------------------------------------------- |
| Meaningful review P75   |   500 | More than twice the sampled catalog P75            |
| Large-market review P90 | 5,000 | More than three times the sampled catalog P90      |
| Meaningful peak-CCU P75 |    50 | More than three times the sampled positive-CCU P75 |
| Minimum measured games  |    10 | Product brief launch gate                          |
| Minimum metric coverage |   60% | Product brief launch gate                          |

These gates intentionally favor understatement. Market potential remains
directional and can become `insufficient_data`; no band is a revenue or total
addressable market estimate.

## Preset-health defaults

`opportunity-health/v1` retains the product-brief conservative gates:

- at least 10 measured released games;
- at least 60% core coverage;
- median review acceleration of at least 25% for an improving review signal;
- median relative CCU growth of at least 20% for an improving CCU signal;
- positive movement across at least 40% of measured games;
- top-contributor share no greater than 50%; and
- two consecutive qualifying daily snapshots before `Surging`.

The 25% review and 20% CCU thresholds are explicitly provisional. Only 10 and 23
usable signal-window observations, respectively, existed in the inspected
sample. They must be backtested after the production signal-window population
has broad, stable coverage. Until then, the health engine is allowed to return
`insufficient_data` and does not infer missing observations as negative demand.

## Recalibration rule

Change a threshold only through a new calculation version after recording:

- the bounded population and as-of timestamp;
- source coverage and freshness;
- percentile distributions;
- sensitivity of state/band counts;
- concentration and small-cohort effects;
- the before/after threshold diff; and
- regression evidence for stored historical results.

Existing result, market, cohort, and health snapshots remain tied to their
original calculation version.
