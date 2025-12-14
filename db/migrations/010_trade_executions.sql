-- Trade Executions Table
-- Stores actual trade execution details and outcomes

CREATE TABLE IF NOT EXISTS trade_executions (
  id SERIAL PRIMARY KEY,
  trade_id VARCHAR(50) UNIQUE NOT NULL,
  signal_id VARCHAR(50) REFERENCES trading_signals(signal_id),
  
  -- Trade details
  pair VARCHAR(10) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price DECIMAL(12,5) NOT NULL,
  exit_price DECIMAL(12,5),
  stop_loss DECIMAL(12,5) NOT NULL,
  take_profit DECIMAL(12,5) NOT NULL,
  position_size DECIMAL(12,8) NOT NULL,
  
  -- Risk management
  risk_reward DECIMAL(10,2),
  risk_amount DECIMAL(12,2),
  potential_profit DECIMAL(12,2),
  
  -- Execution details
  execution_type VARCHAR(20) DEFAULT 'market' CHECK (execution_type IN ('market', 'limit', 'stop')),
  slippage_pips DECIMAL(6,2) DEFAULT 0,
  commission DECIMAL(12,2) DEFAULT 0,
  swap DECIMAL(12,2) DEFAULT 0,
  
  -- Results
  pnl DECIMAL(12,2),
  pnl_pips DECIMAL(8,2),
  win BOOLEAN,
  outcome VARCHAR(10) CHECK (outcome IN ('win', 'loss', 'breakeven', NULL)),
  
  -- Break-even management
  break_even_moved BOOLEAN DEFAULT false,
  break_even_at TIMESTAMP WITH TIME ZONE,
  partial_close_executed BOOLEAN DEFAULT false,
  partial_close_at TIMESTAMP WITH TIME ZONE,
  partial_close_amount DECIMAL(12,8),
  
  -- Trade management
  managed_by VARCHAR(20) DEFAULT 'manual' CHECK (managed_by IN ('manual', 'auto', 'ai')),
  management_events JSONB DEFAULT '[]',
  
  -- Session info
  opened_during_session VARCHAR(20),
  closed_reason VARCHAR(50),
  
  -- Timestamps
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_pair ON trade_executions(pair);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trade_executions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trade_executions(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_win ON trade_executions(win);
CREATE INDEX IF NOT EXISTS idx_trades_signal_id ON trade_executions(signal_id);
CREATE INDEX IF NOT EXISTS idx_trades_managed_by ON trade_executions(managed_by);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_trades_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Calculate duration if closing trade
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
    NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.closed_at - NEW.opened_at))::INTEGER;
    
    -- Determine win/loss
    IF NEW.pnl > 0 THEN
      NEW.win = true;
      NEW.outcome = 'win';
    ELSIF NEW.pnl < 0 THEN
      NEW.win = false;
      NEW.outcome = 'loss';
    ELSE
      NEW.win = NULL;
      NEW.outcome = 'breakeven';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trades_updated_at_trigger
BEFORE UPDATE ON trade_executions
FOR EACH ROW
EXECUTE FUNCTION update_trades_updated_at();

COMMENT ON TABLE trade_executions IS 'Stores actual trade execution details and outcomes';
