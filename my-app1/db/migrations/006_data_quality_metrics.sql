-- Data quality evaluations captured by the monitoring pipeline
CREATE TABLE IF NOT EXISTS data_quality_metrics (
    id BIGSERIAL NOT NULL,
    pair TEXT NOT NULL,
    assessed_at TIMESTAMPTZ NOT NULL,
    score NUMERIC(10,4),
    status TEXT,
    recommendation TEXT,
    issues TEXT[] DEFAULT NULL,
    timeframe_reports JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (assessed_at, id)
);

SELECT create_hypertable('data_quality_metrics', 'assessed_at', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_data_quality_pair ON data_quality_metrics(pair, assessed_at DESC);
