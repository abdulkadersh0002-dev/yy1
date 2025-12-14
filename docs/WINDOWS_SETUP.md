# Windows Setup Guide - Trading Platform

Complete guide for setting up the trading platform on Windows with PostgreSQL database.

## Prerequisites

### 1. Node.js (v16 or higher)
Download and install from: https://nodejs.org/

Verify installation:
```powershell
node --version
npm --version
```

### 2. PostgreSQL (v13 or higher)
Download from: https://www.postgresql.org/download/windows/

**Installation Notes:**
- During installation, remember the password you set for the `postgres` superuser
- Default port is 5432 (keep this unless you have a conflict)
- Stack Builder can be skipped
- Keep the locale as default

Verify installation:
```powershell
psql --version
```

**If `psql` is not recognized:**
Add PostgreSQL to your PATH:
1. Open Environment Variables (Win + Pause → Advanced → Environment Variables)
2. Edit `Path` in System variables
3. Add: `C:\Program Files\PostgreSQL\15\bin` (adjust version number as needed)
4. Restart PowerShell

### 3. Git
Download from: https://git-scm.com/download/win

### 4. VS Code (recommended)
Download from: https://code.visualstudio.com/

---

## Installation Steps

### Step 1: Clone the Repository

```powershell
# Navigate to your preferred directory
cd C:\Users\YourUsername\Documents

# Clone the repository
git clone https://github.com/abdulkadersh0002-dev/sg.git
cd sg

# Checkout the working branch
git checkout copilot/refactor-application-structure
```

### Step 2: Install Dependencies

```powershell
npm install
```

This will install all 441 packages (takes 2-3 minutes).

### Step 3: Create Database

**Option A: Using pgAdmin (Graphical Interface)**

1. Open pgAdmin (installed with PostgreSQL)
2. Connect to PostgreSQL server (enter your postgres password)
3. Right-click "Databases" → Create → Database
   - Name: `signals_strategy`
   - Owner: `postgres`
   - Click Save
4. Right-click "Login/Group Roles" → Create → Login/Group Role
   - General tab - Name: `signals_user`
   - Definition tab - Password: `changeme` (or your preferred password)
   - Privileges tab - Enable: Can login
   - Click Save
5. Right-click `signals_strategy` database → Properties → Security
   - Add `signals_user` with all privileges

**Option B: Using psql Command Line**

Open PowerShell as Administrator and run:

```powershell
# Navigate to PostgreSQL bin directory (adjust version as needed)
cd "C:\Program Files\PostgreSQL\15\bin"

# Create database
.\psql.exe -U postgres -c "CREATE DATABASE signals_strategy;"

# Create user (you'll be prompted for postgres password)
.\psql.exe -U postgres -c "CREATE USER signals_user WITH PASSWORD 'changeme';"

# Grant privileges
.\psql.exe -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE signals_strategy TO signals_user;"

# Verify database exists
.\psql.exe -U postgres -l
```

### Step 4: Configure Environment Variables

Navigate back to your project directory:

```powershell
cd C:\Users\YourUsername\Documents\sg
```

Create `.env` file from the example:

```powershell
Copy-Item .env.example .env
```

Edit `.env` file with Notepad or VS Code:

```powershell
notepad .env
# OR
code .env
```

Update the database section (lines 68-76):

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=signals_strategy
DB_USER=signals_user
DB_PASSWORD=changeme
DB_SSL=false
```

**Important:** Change `changeme` to your actual password if you used a different one!

### Step 5: Run Database Migrations

```powershell
npm run db:migrate:windows
```

You should see:
```
=== Database Migration Script (Windows Compatible) ===
Configuration:
  Host: localhost
  Port: 5432
  Database: signals_strategy
  User: signals_user
  SSL: disabled

Connecting to database...
✅ Database connection successful!

Reading migrations from: C:\Users\...\sg\db\migrations
Found X migration file(s):

  ▸ Running 009_trading_signals.sql... ✓ done
  ▸ Running 010_trade_executions.sql... ✓ done
  ▸ Running 011_performance_analytics.sql... ✓ done

✅ All migrations applied successfully!
```

### Step 6: Verify Installation

Run tests to ensure everything is working:

```powershell
npm test
```

Expected result: **176/179 tests passing (98.3%)**
- 3 network-dependent tests will fail in offline mode (this is normal)

### Step 7: Start the Application

```powershell
npm start
```

You should see:
```
Server running on port 5002
Database connected successfully
Trading engine initialized
WebSocket server started
```

### Step 8: Access the Dashboard

Open your browser and navigate to:
```
http://localhost:5002
```

Or open the dashboard HTML file directly:
```powershell
start dashboard/index.html
```

---

## Using VS Code

### Open Project in VS Code

```powershell
cd C:\Users\YourUsername\Documents\sg
code .
```

### Install Recommended Extensions

When VS Code opens, you'll see a notification:
"This workspace has extension recommendations"

Click **"Install All"** to install 20+ recommended extensions including:
- ESLint
- Prettier
- PostgreSQL
- GitLens
- And more...

### VS Code Features

**Start Application:**
- Press `F5` to start with debugger
- Or use Terminal → Run Task → "Start Platform"

**Run Tests:**
- Terminal → Run Task → "Run Tests"

**Database Migrations:**
- Terminal → Run Task → "Database Migration"

**Format Code:**
- Save any file (Ctrl+S) - auto-formats with Prettier
- Or right-click → Format Document

**Debug:**
- Press `F9` to set breakpoints
- Press `F5` to start debugging
- Press `F10` to step over, `F11` to step into

---

## Troubleshooting

### Error: "psql is not recognized"

**Solution:** Add PostgreSQL to PATH
1. Find PostgreSQL installation directory (usually `C:\Program Files\PostgreSQL\15\bin`)
2. Add to PATH environment variable
3. Restart PowerShell

### Error: "ECONNREFUSED"

**Problem:** PostgreSQL is not running

**Solution:**
1. Open Services (Win + R → `services.msc`)
2. Find "postgresql-x64-15" (or similar)
3. Right-click → Start
4. Set Startup Type to "Automatic" if needed

### Error: "password authentication failed"

**Problem:** Wrong database password

**Solution:**
1. Edit `.env` file
2. Update `DB_PASSWORD=` with correct password
3. Save and retry

### Error: "database does not exist"

**Problem:** Database not created

**Solution:** Follow Step 3 again to create the database

### Error: "npm install" fails

**Problem:** Network issues or proxy

**Solution:**
```powershell
# Clear npm cache
npm cache clean --force

# Retry installation
npm install
```

### Error: Port 5002 already in use

**Problem:** Another application is using the port

**Solution:**
```powershell
# Find process using port 5002
Get-NetTCPConnection -LocalPort 5002 | Select-Object OwningProcess

# Kill the process (replace PID with actual process ID)
Stop-Process -Id PID -Force

# Or use different port
$env:PORT=5003
npm start
```

---

## PostgreSQL Management Tools

### pgAdmin
- Graphical interface for PostgreSQL
- Installed with PostgreSQL by default
- Access: Start Menu → PostgreSQL → pgAdmin 4

### Command Line Tools

**Connect to database:**
```powershell
psql -U signals_user -d signals_strategy -h localhost
```

**List all databases:**
```powershell
psql -U postgres -l
```

**Backup database:**
```powershell
pg_dump -U signals_user signals_strategy > backup.sql
```

**Restore database:**
```powershell
psql -U signals_user signals_strategy < backup.sql
```

---

## NPM Scripts Reference

All available commands:

```powershell
# Application
npm start                # Start platform
npm run dev             # Start with auto-reload
npm test                # Run all tests

# Database
npm run db:migrate:windows  # Run migrations (Windows-compatible)
npm run db:migrate          # Alternative (may need manual env loading)

# Code Quality
npm run lint            # Check code quality
npm run lint:fix        # Auto-fix lint issues
npm run format:check    # Check formatting
npm run format:write    # Auto-format all files

# Data Testing
npm run test:data-sources   # Test data source connectivity
npm run validate:providers  # Validate data providers

# Advanced
npm run backtest:run        # Run backtests
npm run optimize            # Run optimization
```

---

## Next Steps

1. **Configure API Keys** (Optional)
   - Edit `.env` file
   - Add your API keys for:
     - TwelveData (market data)
     - OpenAI (AI features)
     - NewsAPI (news feeds)

2. **Setup MT4/MT5 Bridge** (Optional)
   - Install MT4/MT5 terminal
   - Install EA from `mt4-ea/` directory
   - Configure bridge settings in `.env`

3. **Review Documentation**
   - `docs/COMPLETE_SETUP_GUIDE.md` - Complete setup guide
   - `docs/DATABASE_COMPLETE.md` - Database documentation
   - `docs/VSCODE_SETUP.md` - VS Code tips and tricks
   - `docs/PRODUCTION_CHECKLIST.md` - Pre-production checklist

4. **Start Trading**
   - Open dashboard: http://localhost:5002
   - Review live signals
   - Enable auto-trading (when ready)
   - Monitor performance

---

## Getting Help

- **Documentation:** `docs/` directory
- **Issues:** GitHub repository issues
- **Logs:** Check `logs/` directory for detailed logs

---

## Summary Checklist

- [ ] Node.js v16+ installed
- [ ] PostgreSQL v13+ installed and running
- [ ] Git installed
- [ ] VS Code installed (recommended)
- [ ] Project cloned
- [ ] Dependencies installed (`npm install`)
- [ ] Database created (`signals_strategy`)
- [ ] Database user created (`signals_user`)
- [ ] `.env` file configured
- [ ] Migrations run successfully
- [ ] Tests passing (176/179)
- [ ] Application starts without errors
- [ ] Dashboard accessible in browser
- [ ] VS Code extensions installed

**If all checked - you're ready to trade! 🚀**
