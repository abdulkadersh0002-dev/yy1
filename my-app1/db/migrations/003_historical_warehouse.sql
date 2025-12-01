-- Historical data warehouse structures for TimescaleDB
CREATE TABLE IF NOT EXISTS historical_price_bars (
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    bucket_time TIMESTAMPTZ NOT NULL,
    open NUMERIC(18,8),
    high NUMERIC(18,8),
    low NUMERIC(18,8),
    close NUMERIC(18,8),
    volume NUMERIC(24,8),
    provider TEXT,
    source TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (pair, timeframe, bucket_time)
);

SELECT create_hypertable('historical_price_bars', 'bucket_time', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_hist_price_pair_tf ON historical_price_bars(pair, timeframe, bucket_time DESC);

CREATE TABLE IF NOT EXISTS macro_economic_events (
    event_id TEXT NOT NULL,
    region TEXT,
    currency TEXT NOT NULL,
    country TEXT,
    indicator TEXT NOT NULL,
    released_at TIMESTAMPTZ NOT NULL,
    period TEXT,
    actual NUMERIC(18,8),
    forecast NUMERIC(18,8),
    previous NUMERIC(18,8),
    surprise NUMERIC(18,8),
    impact_score NUMERIC(8,3),
    source TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (event_id, released_at)
);

SELECT create_hypertable('macro_economic_events', 'released_at', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_macro_events_currency ON macro_economic_events(currency, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_macro_events_indicator ON macro_economic_events(indicator, released_at DESC);

CREATE TABLE IF NOT EXISTS normalized_feature_vectors (
    snapshot_id BIGINT NOT NULL,
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    feature_key TEXT NOT NULL,
    feature_type TEXT NOT NULL,
    numeric_value DOUBLE PRECISION,
    text_value TEXT,
    bool_value BOOLEAN,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (snapshot_id, feature_key, captured_at)
);

SELECT create_hypertable('normalized_feature_vectors', 'captured_at', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS idx_norm_features_key ON normalized_feature_vectors(feature_key, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_norm_features_pair_tf ON normalized_feature_vectors(pair, timeframe, captured_at DESC);

