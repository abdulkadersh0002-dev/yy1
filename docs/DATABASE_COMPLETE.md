# Complete Database Integration Guide

## 🎯 Overview

This trading platform now has a **complete, production-ready PostgreSQL database integration** that stores:
- Trading signals with full analysis details
- Trade executions with P&L tracking
- Performance analytics and statistics
- Auto-trader management events
- AI/ML predictions and outcomes

---

## 📦 What's Included

### Database Tables

1. **`trading_signals`** - All generated signals
   - Signal details (pair, direction, strength, confidence, quality)
   - Entry/SL/TP prices
   - Technical features and indicators
   - AI/ML predictions
   - Validation stages and filter results
   - Status tracking (pending, active, executed, cancelled, expired)

2. **`trade_executions`** - All executed trades
   - Trade details (pair, direction, prices, position size)
   - Risk management (R:R, risk amount, potential profit)
   - Execution details (slippage, commission, swap)
   - Results (P&L in currency and pips, win/loss)
   - Break-even and partial close tracking
   - Management events log

3. **Performance Views**
   - `v_performance_analytics` - Daily aggregated stats
   - `v_signal_performance` - Signal quality and execution rates
   - `v_auto_trader_stats` - Auto-trader performance metrics

### Services

1. **SignalPersistence** - Save and retrieve signals
   - `saveSignal(signal)` - Store new signal
   - `updateSignalStatus(signalId, status, outcome)` - Update status
   - `getRecentSignals(pair, hours, status)` - Get recent signals
   - `getSignalStats(pair, days)` - Get statistics
   - `findSimilarSignals(signal, limit)` - Pattern matching

2. **TradePersistence** - Save and retrieve trades
   - `saveTrade(trade)` - Store new trade
   - `updateTrade(tradeId, updates)` - Update trade
   - `closeTrade(tradeId, exitPrice, reason)` - Close trade
   - `recordBreakEven(tradeId)` - Record break-even move
   - `recordPartialClose(tradeId, amount)` - Record partial close
   - `getActiveTrades(pair)` - Get open trades
   - `getTradeHistory(pair, days)` - Get closed trades
   - `getPerformanceStats(days)` - Get performance metrics
   - `getWinRate(pair, days)` - Get win rate

### Migration System

- Automatic schema versioning
- Sequential migration execution
- Rollback protection with transactions
- Migration status tracking

---

## 🚀 Quick Start

### 1. Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Windows:**
Download from: https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE signals_strategy;
CREATE USER signals_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;

# Exit
\q
```

### 3. Configure Environment

Update your `.env` file:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=signals_strategy
DB_USER=signals_user
DB_PASSWORD=your_password
DB_SSL=false
```

### 4. Run Migrations

```bash
npm run db:migrate
```

You should see:
```
[INFO] Migrations table initialized
[INFO] Found 11 pending migrations
[INFO] Migration executed: 001_init.sql
[INFO] Migration executed: 002_news_events.sql
...
[INFO] Migration executed: 011_performance_analytics.sql
[INFO] Executed 11 migrations successfully
```

---

## 💻 Usage Examples

### Saving Signals

```javascript
import { signalPersistence } from './src/database/services/index.js';

// When a signal is generated
const signal = {
  pair: 'EURUSD',
  timeframe: 'M15',
  direction: 'BUY',
  strength: 85.5,
  confidence: 92.3,
  quality: 88.0,
  entry_price: 1.0850,
  stop_loss: 1.0830,
  take_profit: 1.0900,
  risk_reward: 2.5,
  features: {
    rsi: 65.2,
    macd: 0.0012,
    moving_averages: 'bullish'
  },
  indicators: {
    ema_20: 1.0845,
    ema_50: 1.0820,
    ema_200: 1.0780
  },
  ai_prediction: 'BUY',
  ai_confidence: 87.5,
  ml_score: 90.2,
  sources: ['technical', 'ai', 'sentiment'],
  validation_stages: [
    { stage: 'basic_quality', passed: true, score: 90 },
    { stage: 'technical_confluence', passed: true, score: 88 }
  ]
};

// Save to database
const saved = await signalPersistence.saveSignal(signal);
console.log(`Signal saved: ${saved.signal_id}`);

// Update status when executed
await signalPersistence.updateSignalStatus(saved.signal_id, 'executed');
```

### Saving Trades

```javascript
import { tradePersistence } from './src/database/services/index.js';

// When a trade is opened
const trade = {
  signal_id: 'SIG-1234567890-5678',
  pair: 'EURUSD',
  direction: 'BUY',
  entry_price: 1.0850,
  stop_loss: 1.0830,
  take_profit: 1.0900,
  position_size: 0.1,
  risk_reward: 2.5,
  risk_amount: 20.00,
  potential_profit: 50.00,
  managed_by: 'auto',
  opened_during_session: 'London'
};

// Save to database
const saved = await tradePersistence.saveTrade(trade);
console.log(`Trade opened: ${saved.trade_id}`);

// Record break-even move
await tradePersistence.recordBreakEven(saved.trade_id);

// Record partial close
await tradePersistence.recordPartialClose(saved.trade_id, 0.05);

// Close trade
const closed = await tradePersistence.closeTrade(
  saved.trade_id,
  1.0880,
  'take_profit_hit'
);
console.log(`Trade closed with P&L: ${closed.pnl}`);
```

### Getting Performance Statistics

```javascript
import { tradePersistence } from './src/database/services/index.js';

// Get overall performance (last 30 days)
const stats = await tradePersistence.getPerformanceStats(30);
console.log(`
  Total Trades: ${stats.total_trades}
  Winning Trades: ${stats.winning_trades}
  Win Rate: ${stats.win_rate}%
  Total P&L: $${stats.total_pnl}
  Average P&L: $${stats.avg_pnl}
  Avg R:R: ${stats.avg_risk_reward}
  Max Win: $${stats.max_win}
  Max Loss: $${stats.max_loss}
`);

// Get win rate for specific pair
const eurStats = await tradePersistence.getWinRate('EURUSD', 30);
console.log(`
  EURUSD Performance:
  Total Trades: ${eurStats.total_trades}
  Winning Trades: ${eurStats.winning_trades}
  Win Rate: ${eurStats.win_rate}%
`);

// Get active trades
const active = await tradePersistence.getActiveTrades();
console.log(`Currently ${active.length} active trades`);

// Get trade history
const history = await tradePersistence.getTradeHistory('EURUSD', 7);
console.log(`Found ${history.length} trades in last 7 days`);
```

### Querying Analytics Views

```javascript
import { db } from './src/database/index.js';

// Get daily performance
const dailyPerf = await db.query(`
  SELECT * FROM v_performance_analytics
  WHERE trade_date >= NOW() - INTERVAL '7 days'
  ORDER BY trade_date DESC
`);

// Get signal performance
const signalPerf = await db.query(`
  SELECT * FROM v_signal_performance
  WHERE pair = 'EURUSD'
  ORDER BY win_rate DESC
`);

// Get auto-trader stats
const autoStats = await db.query(`
  SELECT * FROM v_auto_trader_stats
  ORDER BY total_trades DESC
`);
```

---

## 🔄 Auto-Trading Integration

The database seamlessly integrates with the auto-trading system:

```javascript
import { IntelligentAutoTrader } from './src/trading/intelligent-auto-trader.js';
import { signalPersistence, tradePersistence } from './src/database/services/index.js';

// In your signal generation code
async function generateAndSaveSignal(marketData) {
  // Generate signal
  const signal = await signalEngine.generateSignal(marketData);
  
  // Save to database
  const saved = await signalPersistence.saveSignal(signal);
  
  // Auto-trader will pick it up
  return saved;
}

// In auto-trader execution
async function executeSignal(signal) {
  // Execute via broker
  const execution = await broker.openTrade(signal);
  
  // Save to database
  const trade = await tradePersistence.saveTrade({
    signal_id: signal.signal_id,
    ...execution,
    managed_by: 'auto'
  });
  
  // Update signal status
  await signalPersistence.updateSignalStatus(signal.signal_id, 'executed');
  
  return trade;
}

// In trade management
async function moveToBreakEven(tradeId) {
  // Move stop loss via broker
  await broker.modifyStopLoss(tradeId, breakEvenPrice);
  
  // Record in database
  await tradePersistence.recordBreakEven(tradeId);
}
```

---

## 📊 Schema Reference

### trading_signals Table

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| signal_id | VARCHAR(50) | Unique signal identifier |
| pair | VARCHAR(10) | Currency pair |
| timeframe | VARCHAR(10) | Chart timeframe |
| signal_direction | VARCHAR(10) | BUY, SELL, or HOLD |
| signal_strength | DECIMAL(5,2) | 0-100 |
| signal_confidence | DECIMAL(5,2) | 0-100 |
| signal_quality | DECIMAL(5,2) | 0-100 |
| entry_price | DECIMAL(12,5) | Entry price |
| stop_loss | DECIMAL(12,5) | Stop loss price |
| take_profit | DECIMAL(12,5) | Take profit price |
| risk_reward | DECIMAL(10,2) | Risk:reward ratio |
| features | JSONB | Technical features |
| indicators | JSONB | Indicator values |
| ai_prediction | VARCHAR(10) | AI prediction |
| ai_confidence | DECIMAL(5,2) | AI confidence |
| sources | TEXT[] | Signal sources |
| status | VARCHAR(20) | pending, active, executed, cancelled, expired |
| outcome | VARCHAR(10) | win, loss, breakeven |
| captured_at | TIMESTAMP | Signal generation time |
| executed_at | TIMESTAMP | Execution time |
| closed_at | TIMESTAMP | Close time |

### trade_executions Table

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| trade_id | VARCHAR(50) | Unique trade identifier |
| signal_id | VARCHAR(50) | Related signal |
| pair | VARCHAR(10) | Currency pair |
| direction | VARCHAR(10) | BUY or SELL |
| entry_price | DECIMAL(12,5) | Entry price |
| exit_price | DECIMAL(12,5) | Exit price |
| stop_loss | DECIMAL(12,5) | Stop loss |
| take_profit | DECIMAL(12,5) | Take profit |
| position_size | DECIMAL(12,8) | Position size (lots) |
| risk_reward | DECIMAL(10,2) | R:R ratio |
| pnl | DECIMAL(12,2) | Profit/loss in currency |
| pnl_pips | DECIMAL(8,2) | Profit/loss in pips |
| win | BOOLEAN | Win/loss flag |
| break_even_moved | BOOLEAN | Break-even activated |
| partial_close_executed | BOOLEAN | Partial close executed |
| managed_by | VARCHAR(20) | manual, auto, or ai |
| opened_at | TIMESTAMP | Trade open time |
| closed_at | TIMESTAMP | Trade close time |
| duration_seconds | INTEGER | Trade duration |

---

## 🔍 Troubleshooting

### Database not connecting

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -h localhost -U signals_user -d signals_strategy

# Check logs
tail -f /var/log/postgresql/postgresql-15-main.log
```

### Migrations failing

```bash
# Check migration status
npm run db:status

# View database logs
# Platform logs will show migration errors with details
```

### Performance issues

```bash
# Connect to database
psql -U signals_user -d signals_strategy

# Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check index usage
SELECT * FROM pg_stat_user_indexes;

# Analyze tables
ANALYZE trading_signals;
ANALYZE trade_executions;
```

---

## ✅ Complete Integration Checklist

- [x] Database schema designed (3 tables, 3 views)
- [x] Migrations created (11 SQL files)
- [x] Connection manager with pooling
- [x] Repository pattern (BaseRepository + specialized)
- [x] Signal persistence service
- [x] Trade persistence service
- [x] Migration runner with status tracking
- [x] npm scripts for database operations
- [x] Complete documentation
- [x] Environment configuration
- [x] Auto-trading integration
- [x] Performance analytics views
- [x] Error handling and logging
- [x] Transaction support
- [x] Health monitoring

---

## 🎉 Summary

The platform now has a **complete, production-ready database layer** that:

✅ Stores all signals with full analysis details
✅ Tracks all trade executions and outcomes
✅ Provides real-time performance analytics
✅ Integrates seamlessly with auto-trading
✅ Supports advanced querying and reporting
✅ Includes automatic schema migrations
✅ Has robust error handling and logging
✅ Works perfectly with VS Code + Node.js (no Docker needed)

**The database is 100% ready for production use!**
