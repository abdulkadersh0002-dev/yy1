-- Trading Signals Table
-- Stores all generated trading signals with full details

CREATE TABLE IF NOT EXISTS trading_signals (
  id SERIAL PRIMARY KEY,
  signal_id VARCHAR(50) UNIQUE NOT NULL,
  pair VARCHAR(10) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  signal_direction VARCHAR(10) NOT NULL CHECK (signal_direction IN ('BUY', 'SELL', 'HOLD')),
  signal_strength DECIMAL(5,2) NOT NULL CHECK (signal_strength >= 0 AND signal_strength <= 100),
  signal_confidence DECIMAL(5,2) NOT NULL CHECK (signal_confidence >= 0 AND signal_confidence <= 100),
  signal_quality DECIMAL(5,2) DEFAULT 0,
  
  -- Entry details
  entry_price DECIMAL(12,5),
  stop_loss DECIMAL(12,5),
  take_profit DECIMAL(12,5),
  risk_reward DECIMAL(10,2),
  position_size DECIMAL(12,8),
  
  -- Technical features
  features JSONB DEFAULT '{}',
  indicators JSONB DEFAULT '{}',
  
  -- AI/ML predictions
  ai_prediction VARCHAR(10),
  ai_confidence DECIMAL(5,2),
  ml_score DECIMAL(5,2),
  
  -- Sources and validation
  sources TEXT[],
  validation_stages JSONB DEFAULT '[]',
  filter_results JSONB DEFAULT '{}',
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'executed', 'cancelled', 'expired')),
  outcome VARCHAR(10) CHECK (outcome IN ('win', 'loss', 'breakeven', NULL)),
  
  -- Timestamps
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_signals_pair ON trading_signals(pair);
CREATE INDEX IF NOT EXISTS idx_signals_direction ON trading_signals(signal_direction);
CREATE INDEX IF NOT EXISTS idx_signals_captured_at ON trading_signals(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON trading_signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_quality ON trading_signals(signal_quality DESC);
CREATE INDEX IF NOT EXISTS idx_signals_features ON trading_signals USING GIN (features);
CREATE INDEX IF NOT EXISTS idx_signals_indicators ON trading_signals USING GIN (indicators);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_signals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signals_updated_at_trigger
BEFORE UPDATE ON trading_signals
FOR EACH ROW
EXECUTE FUNCTION update_signals_updated_at();

COMMENT ON TABLE trading_signals IS 'Stores all generated trading signals with full technical analysis';
