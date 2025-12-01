-- Enable TimescaleDB extension if available
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Feature snapshots table
CREATE TABLE IF NOT EXISTS feature_snapshots (
    id BIGSERIAL NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    feature_hash TEXT,
    features JSONB NOT NULL,
    signal_strength NUMERIC(10,4),
    signal_confidence NUMERIC(10,4),
    signal_direction TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (captured_at, id)
);

-- Create hypertable for time-series efficiency if extension is available
SELECT create_hypertable('feature_snapshots', 'captured_at', if_not_exists => TRUE, migrate_data => TRUE);

CREATE INDEX IF NOT EXISTS idx_feature_snapshots_pair_timeframe ON feature_snapshots(pair, timeframe, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_snapshots_hash ON feature_snapshots(feature_hash);

-- Trades table
CREATE TABLE IF NOT EXISTS trade_executions (
    id BIGSERIAL PRIMARY KEY,
    trade_id TEXT UNIQUE NOT NULL,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    entry_price NUMERIC(18,8),
    exit_price NUMERIC(18,8),
    pnl NUMERIC(18,8),
    pnl_pct NUMERIC(10,4),
    risk_reward NUMERIC(10,4),
    position_size NUMERIC(18,4),
    confidence NUMERIC(10,4),
    win BOOLEAN,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_trade_executions_pair ON trade_executions(pair, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_executions_trade_id ON trade_executions(trade_id);

-- Provider telemetry table
CREATE TABLE IF NOT EXISTS provider_metrics (
    id BIGSERIAL NOT NULL,
    provider TEXT NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latency_ms NUMERIC(12,4),
    success_count INTEGER,
    failure_count INTEGER,
    rate_limited_count INTEGER,
    success_rate NUMERIC(10,4),
    normalized_quality NUMERIC(10,4),
    confidence_pct NUMERIC(10,4),
    remaining_quota INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (collected_at, id)
);

SELECT create_hypertable('provider_metrics', 'collected_at', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_provider_metrics_provider ON provider_metrics(provider, collected_at DESC);

-- Helper view for latest provider metrics
CREATE OR REPLACE VIEW latest_provider_metrics AS
SELECT DISTINCT ON (provider)
    provider,
    collected_at,
    latency_ms,
    success_count,
    failure_count,
    rate_limited_count,
    success_rate,
    normalized_quality,
    confidence_pct,
    remaining_quota,
    metadata
FROM provider_metrics
ORDER BY provider, collected_at DESC;
