-- News events storage leveraging TimescaleDB hypertable capabilities
CREATE TABLE IF NOT EXISTS news_events (
    id BIGSERIAL NOT NULL,
    feed_id TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT,
    headline TEXT NOT NULL,
    summary TEXT,
    url TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    keywords TEXT[],
    sentiment NUMERIC(10,4),
    impact NUMERIC(10,4),
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (published_at, id)
);

-- Promote efficient time-series queries
SELECT create_hypertable('news_events', 'published_at', if_not_exists => TRUE, migrate_data => TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_events_unique ON news_events(feed_id, headline, published_at);
CREATE INDEX IF NOT EXISTS idx_news_events_source ON news_events(source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_category ON news_events(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_keywords ON news_events USING GIN (keywords);
