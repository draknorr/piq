-- Add the versioned /apps read contract without duplicating the large legacy
-- materialized projection or its taxonomy indexes.
--
-- The maintained legacy materialized view remains the compatibility storage
-- layer during preparation. This v2 view adds normalized readiness and signal
-- window provenance while preserving every existing browser-facing column.
-- Its stable relation name lets the storage implementation be replaced later
-- without another reader cutover.
--
-- This file is intentionally not applied by scheduled workflows. Applying it
-- is a production Tiger write and requires a separately approved write window.

SET statement_timeout = '5min';
SET lock_timeout = '15s';

CREATE OR REPLACE VIEW metrics.apps_page_projection_v2 AS
SELECT
  projection.*,
  readiness.status AS overall_readiness_status,
  readiness.source_at AS overall_readiness_source_at,
  readiness.processed_at AS overall_readiness_processed_at,
  readiness.version AS overall_readiness_version,
  readiness.blocking_reason AS overall_readiness_blocking_reason,
  readiness.retryable AS overall_readiness_retryable,
  readiness.provenance AS overall_readiness_provenance,
  signals.as_of_date AS signal_window_as_of_date,
  signals.review_change_7d,
  signals.review_change_30d,
  signals.ccu_peak_avg_7d,
  signals.ccu_peak_avg_30d,
  signals.ccu_peak_change_7d,
  signals.ccu_peak_change_30d,
  signals.review_observed_days_7d,
  signals.review_missing_days_7d,
  signals.ccu_observed_days_7d,
  signals.ccu_missing_days_7d,
  signals.review_observed_days_30d,
  signals.review_missing_days_30d,
  signals.ccu_observed_days_30d,
  signals.ccu_missing_days_30d,
  signals.coverage_state AS signal_coverage_state,
  signals.incomplete_coverage AS signal_incomplete_coverage,
  signals.source_max_metric_date AS signal_source_max_metric_date,
  signals.source_at AS signal_source_at,
  signals.calculated_at AS signal_calculated_at,
  signals.calculation_version AS signal_calculation_version,
  signals.confidence AS signal_confidence,
  signals.provenance AS signal_provenance
FROM metrics.apps_page_projection projection
LEFT JOIN ops.app_data_readiness readiness
  ON readiness.appid = projection.appid
 AND readiness.source = 'overall'
LEFT JOIN metrics.app_signal_windows_v1 signals
  ON signals.appid = projection.appid;

CREATE OR REPLACE VIEW metrics.apps_page_filter_counts_v2 AS
SELECT
  filter_type,
  option_id,
  app_count
FROM metrics.apps_page_filter_counts;

COMMENT ON VIEW metrics.apps_page_projection_v2 IS
  'Versioned /apps read contract. Preserves the maintained legacy Apps projection shape and adds readiness-v1 plus signal-windows/v1 provenance without duplicating projection storage.';

COMMENT ON VIEW metrics.apps_page_filter_counts_v2 IS
  'Versioned /apps default taxonomy-count contract. Row/filter semantics intentionally match the legacy projection during the v2 parity stage.';
