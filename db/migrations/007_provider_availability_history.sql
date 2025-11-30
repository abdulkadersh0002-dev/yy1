-- Provider availability history for durable analytics
CREATE TABLE IF NOT EXISTS provider_availability_history (
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT,
    aggregate_quality NUMERIC(10,4),
    normalized_quality NUMERIC(10,4),
    unavailable_providers TEXT[] DEFAULT NULL,
    breaker_providers TEXT[] DEFAULT NULL,
    blocked_timeframes TEXT[] DEFAULT NULL,
    blocked_provider_ratio NUMERIC(10,4),
    blocked_timeframe_ratio NUMERIC(10,4),
    detail TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('provider_availability_history', 'captured_at', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_provider_availability_captured_at ON provider_availability_history (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_availability_state ON provider_availability_history (captured_at DESC, state, severity);
