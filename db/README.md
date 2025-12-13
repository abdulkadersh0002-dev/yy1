# Database Setup

This project uses **PostgreSQL** (with optional **TimescaleDB**) to persist feature snapshots, trade outcomes, and provider telemetry.

## Quick Setup (No Docker Required!)

### 1. Install PostgreSQL Locally

**Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install postgresql postgresql-contrib
```

**MacOS:**
```bash
brew install postgresql@15 && brew services start postgresql@15
```

**Windows:**
Download from https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE signals_strategy;
CREATE USER signals_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;
\q
```

### 3. Configure Environment

Update `.env` with your database credentials:
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

## Environment Variables

The application reads connection settings from:

- `DB_HOST` - Database host (default: localhost)
- `DB_PORT` - Database port (default: 5432)
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password
- `DB_SSL` - Enable SSL (`true`/`false`)

**If these variables are not set, the system operates in in-memory mode without persistence.**

## See Also

For complete setup instructions and advanced features, see:
📖 **[docs/DATABASE_SETUP.md](../docs/DATABASE_SETUP.md)**
