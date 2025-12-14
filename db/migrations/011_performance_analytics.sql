-- Performance Analytics View
-- Aggregated statistics for dashboard and analytics

CREATE OR REPLACE VIEW v_performance_analytics AS
SELECT 
  DATE_TRUNC('day', opened_at) as trade_date,
  pair,
  COUNT(*) as total_trades,
  SUM(CASE WHEN win = true THEN 1 ELSE 0 END) as winning_trades,
  SUM(CASE WHEN win = false THEN 1 ELSE 0 END) as losing_trades,
  ROUND(AVG(CASE WHEN win = true THEN 1 ELSE 0 END) * 100, 2) as win_rate,
  ROUND(SUM(pnl), 2) as total_pnl,
  ROUND(AVG(pnl), 2) as avg_pnl,
  ROUND(MAX(pnl), 2) as max_win,
  ROUND(MIN(pnl), 2) as max_loss,
  ROUND(AVG(risk_reward), 2) as avg_risk_reward,
  ROUND(AVG(duration_seconds) / 60, 2) as avg_duration_minutes,
  SUM(CASE WHEN break_even_moved = true THEN 1 ELSE 0 END) as break_even_count,
  SUM(CASE WHEN partial_close_executed = true THEN 1 ELSE 0 END) as partial_close_count
FROM trade_executions
WHERE closed_at IS NOT NULL
GROUP BY DATE_TRUNC('day', opened_at), pair;

-- Signal Performance View
CREATE OR REPLACE VIEW v_signal_performance AS
SELECT 
  s.pair,
  s.timeframe,
  s.signal_direction,
  COUNT(s.id) as total_signals,
  COUNT(t.id) as executed_signals,
  ROUND(COUNT(t.id)::DECIMAL / NULLIF(COUNT(s.id), 0) * 100, 2) as execution_rate,
  SUM(CASE WHEN t.win = true THEN 1 ELSE 0 END) as winning_trades,
  ROUND(AVG(CASE WHEN t.win = true THEN 1 ELSE 0 END) * 100, 2) as win_rate,
  ROUND(AVG(s.signal_quality), 2) as avg_quality,
  ROUND(AVG(s.signal_confidence), 2) as avg_confidence,
  ROUND(AVG(t.pnl), 2) as avg_pnl
FROM trading_signals s
LEFT JOIN trade_executions t ON s.signal_id = t.signal_id
WHERE s.captured_at >= NOW() - INTERVAL '30 days'
GROUP BY s.pair, s.timeframe, s.signal_direction;

-- Auto-Trader Performance View  
CREATE OR REPLACE VIEW v_auto_trader_stats AS
SELECT 
  managed_by,
  COUNT(*) as total_trades,
  SUM(CASE WHEN win = true THEN 1 ELSE 0 END) as winning_trades,
  ROUND(AVG(CASE WHEN win = true THEN 1 ELSE 0 END) * 100, 2) as win_rate,
  ROUND(SUM(pnl), 2) as total_pnl,
  ROUND(AVG(pnl), 2) as avg_pnl,
  ROUND(AVG(risk_reward), 2) as avg_risk_reward,
  SUM(CASE WHEN break_even_moved = true THEN 1 ELSE 0 END) as break_even_moves,
  SUM(CASE WHEN partial_close_executed = true THEN 1 ELSE 0 END) as partial_closes
FROM trade_executions
WHERE closed_at >= NOW() - INTERVAL '30 days'
GROUP BY managed_by;

COMMENT ON VIEW v_performance_analytics IS 'Daily aggregated trading performance metrics';
COMMENT ON VIEW v_signal_performance IS 'Signal generation and execution performance';
COMMENT ON VIEW v_auto_trader_stats IS 'Auto-trader performance statistics';
