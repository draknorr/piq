-- Phase 5 Tiger bootstrap for the PublisherIQ time-series history slice.
-- Creates the first hypertable-backed metrics table for historical game metrics.

CREATE TABLE IF NOT EXISTS metrics.daily_metrics (
    source_daily_metric_id bigint,
    appid integer NOT NULL,
    metric_date date NOT NULL,
    owners_min integer,
    owners_max integer,
    ccu_peak integer,
    average_playtime_forever integer,
    average_playtime_2weeks integer,
    total_reviews integer,
    positive_reviews integer,
    negative_reviews integer,
    review_score smallint,
    review_score_desc text,
    recent_total_reviews integer,
    recent_positive integer,
    recent_negative integer,
    recent_score_desc text,
    price_cents integer,
    discount_percent smallint,
    ccu_source text,
    CONSTRAINT metrics_daily_metrics_pkey PRIMARY KEY (appid, metric_date),
    CONSTRAINT metrics_daily_metrics_ccu_source_check CHECK (
      ccu_source IS NULL OR ccu_source = ANY (ARRAY['steamspy'::text, 'steam_api'::text])
    )
);

COMMENT ON TABLE metrics.daily_metrics IS 'Timescale hypertable for historical daily game metrics migrated from public.daily_metrics.';
COMMENT ON COLUMN metrics.daily_metrics.source_daily_metric_id IS 'Original public.daily_metrics.id value preserved for migration provenance.';

SELECT public.create_hypertable(
  'metrics.daily_metrics',
  'metric_date',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  create_default_indexes => FALSE
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_metrics_appid_date
  ON metrics.daily_metrics (appid, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_metrics_date
  ON metrics.daily_metrics (metric_date);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_metrics_ccu_source
  ON metrics.daily_metrics (ccu_source)
  WHERE ccu_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_metrics_daily_metrics_source_daily_metric_id
  ON metrics.daily_metrics (source_daily_metric_id)
  WHERE source_daily_metric_id IS NOT NULL;
