# Database Setup Guide

This trading platform uses **PostgreSQL** (with optional **TimescaleDB** extension) for persisting trade executions, signal history, and performance metrics.

---

## 🎯 Quick Start (VS Code + Node.js Only)

No Docker required! This setup works with a local PostgreSQL installation.

### 1. Install PostgreSQL

#### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### MacOS (Homebrew):
```bash
brew install postgresql@15
brew services start postgresql@15
```

#### Windows:
Download and install from: https://www.postgresql.org/download/windows/

---

### 2. Create Database and User

```bash
# Switch to postgres user (Linux/Mac)
sudo -u postgres psql

# Or on Windows, open psql as Administrator
```

Then run these SQL commands:

```sql
-- Create database
CREATE DATABASE signals_strategy;

-- Create user
CREATE USER signals_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;

-- Exit psql
\q
```

---

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update database settings:

```bash
cp .env.example .env
```

Edit `.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=signals_strategy
DB_USER=signals_user
DB_PASSWORD=your_secure_password
DB_SSL=false
```

---

### 4. Run Migrations

```bash
npm run db:migrate
```

This will create all required tables:
- `feature_snapshots` - Signal and feature history
- `trade_executions` - Trade performance tracking
- `provider_metrics` - Data provider telemetry
- `news_events` - Economic news and events
- And more...

---

## 🚀 Features

### Connection Pooling
- Automatic connection pooling (max 20 connections)
- Smart retry logic for transient failures
- Health monitoring with automatic reconnection

### Repositories
Pre-built repositories for common operations:

```javascript
import { tradeRepository, signalRepository } from './src/database/index.js';

// Save trade execution
await tradeRepository.create({
  trade_id: 'TR-123',
  pair: 'EURUSD',
  direction: 'BUY',
  entry_price: 1.0850,
  position_size: 0.1,
  opened_at: new Date()
});

// Get win rate
const stats = await tradeRepository.getWinRate('EURUSD', 30); // Last 30 days
console.log(`Win Rate: ${stats.win_rate}%`);

// Save signal
await signalRepository.create({
  pair: 'EURUSD',
  timeframe: 'M15',
  signal_direction: 'BUY',
  signal_strength: 85.5,
  signal_confidence: 92.3,
  features: { rsi: 65, macd: 0.0012 }
});
```

### Transaction Support

```javascript
import { db } from './src/database/index.js';

await db.transaction(async (client) => {
  await client.query('INSERT INTO trade_executions ...');
  await client.query('UPDATE feature_snapshots ...');
  // Automatic commit on success, rollback on error
});
```

---

## 🔧 Optional: TimescaleDB Extension

For enhanced time-series performance (recommended for production):

### Ubuntu/Debian:
```bash
sudo add-apt-repository ppa:timescale/timescaledb-ppa
sudo apt-get update
sudo apt-get install timescaledb-2-postgresql-15
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql
```

### Enable extension:
```sql
psql -d signals_strategy -U signals_user
CREATE EXTENSION IF NOT EXISTS timescaledb;
\q
```

The migrations will automatically detect and use TimescaleDB if available.

---

## 📊 Database Schema

### Main Tables

#### `feature_snapshots`
- Stores all signal features and analysis results
- Hypertable (if TimescaleDB enabled)
- Indexed by pair, timeframe, and timestamp

#### `trade_executions`
- Records all trade entries and exits
- P&L tracking and performance metrics
- Indexed by pair and trade_id

#### `provider_metrics`
- Data provider availability and performance
- Tracks API latency and success rates

#### `news_events`
- Economic calendar and news events
- Impact ratings and sentiment scores

---

## 🛠️ Maintenance

### Backup Database
```bash
pg_dump -U signals_user signals_strategy > backup_$(date +%Y%m%d).sql
```

### Restore Database
```bash
psql -U signals_user signals_strategy < backup_20240101.sql
```

### View Database Size
```sql
SELECT 
  pg_size_pretty(pg_database_size('signals_strategy')) as size;
```

### Clean Old Data (Optional)
```sql
-- Delete signals older than 90 days
DELETE FROM feature_snapshots 
WHERE captured_at < NOW() - INTERVAL '90 days';

-- Delete trades older than 1 year
DELETE FROM trade_executions 
WHERE opened_at < NOW() - INTERVAL '1 year';
```

---

## 🎯 Performance Tips

1. **Regular VACUUM**: Run `VACUUM ANALYZE;` weekly
2. **Index Monitoring**: Check slow queries with `pg_stat_statements`
3. **Connection Pooling**: Use the built-in pool (already configured)
4. **TimescaleDB**: Enable for better time-series performance
5. **Partitioning**: For very large datasets, consider partitioning by month

---

## 🔍 Troubleshooting

### "Connection refused"
- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Check firewall: `sudo ufw allow 5432/tcp`
- Verify pg_hba.conf allows local connections

### "Permission denied"
- Check user privileges: `GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;`
- For all tables: `GRANT ALL ON ALL TABLES IN SCHEMA public TO signals_user;`

### "Database does not exist"
- Create it: `sudo -u postgres psql -c "CREATE DATABASE signals_strategy;"`

---

## 📚 Additional Resources

- PostgreSQL Documentation: https://www.postgresql.org/docs/
- TimescaleDB Documentation: https://docs.timescale.com/
- Node.js pg Library: https://node-postgres.com/

---

**Note**: The application works perfectly without a database in **in-memory mode**. Persistence is optional but recommended for production deployments.
