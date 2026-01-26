# MT5 Setup (EA + Server)

This project runs a local backend server (default `4101`) and an MT5 EA that connects to it.

## 1) Start the backend

Preferred (Windows PowerShell):

- Run: `scripts/start-backend-mt5-smart-strong.ps1 -Port 4101 -FreePort`

This uses an EA-only realtime mode and autostarts auto-trading using a **SMART STRONG** preset.

## 2) (Optional) Start the dashboard

- Run: `scripts/start-dashboard-dev.ps1 -ApiPort 4101 -Port 4173`

Or start both:

- Run: `scripts/start-all-mt5-smart-strong.ps1 -ApiPort 4101 -DashboardPort 4173 -FreePorts`

## 3) MT5 terminal prerequisites

### Enable trading

- Enable the main **Algo Trading** button in MT5.
- On the EA chart: Right-click → **Expert Advisors** → **Properties** → check:
  - **Allow Algo Trading**
  - (Optional) allow DLL imports only if you know you need it

### Allow WebRequest

MT5 must allow the EA to call the local server.

- Tools → Options → Expert Advisors → **Allow WebRequest for listed URL**
- Add:
  - `http://127.0.0.1:4101`

If you run the server on a different port, add that exact URL.

## 4) Install the EA

File location (MT5):

- `MQL5/Experts/SignalBridge-MT5.mq5`

Source file in this repo:

- `clients/neon-dashboard/public/eas/SignalBridge-MT5.mq5`

Compile it in MetaEditor, then attach it to a chart.

## 5) Recommended EA inputs (safe defaults)

- `BridgeUrl`: `http://127.0.0.1:4101/api/broker/bridge/mt5`
- `RespectServerExecution`: `true` (prevents local/accidental execution)
- `TradeMajorsAndMetalsOnly`: `true`
- `DefaultLots`: keep small (the EA will auto-reduce if margin is insufficient)
- `MaxFreeMarginUsagePct`: e.g. `0.50`
- `EnableSignalDedupe`: `true` (prevents repeated re-entry on the same signal)
- `SignalDedupeTtlSec`: `120`

### Smart market handling (recommended)

- `EnableVolatilityFilter`: `true`
  - `VolatilityFilterTf`: `M15`
  - `MinAtrPips`: `4`
  - `MaxAtrPips`: `120`
  - `MaxSpreadToAtrPct`: `25`

This avoids trading when the market is too flat (no movement) or when spread is too large relative to volatility.

### Smart trailing (recommended)

- `EnableTrailingStop`: `true`
- `EnableAtrTrailing`: `true`
  - `AtrTrailingTf`: `M15`
  - `AtrStartMultiplier`: `1.0`
  - `AtrTrailMultiplier`: `2.0`

This makes trailing distance adapt automatically as volatility changes.

### Daily discipline (recommended)

These settings help the EA behave consistently and avoid overtrading. They **do not guarantee profit**, but they protect good days and stop bad days.

- `EnableDailyGuards`: `true`
- Choose either currency-based targets/limits (simple) **or** percent-based (scales by account size):
  - Profit lock:
    - `DailyProfitTargetCurrency`: e.g. `50` (stop new trades after +50 realized today)
    - or `DailyProfitTargetPct`: e.g. `1.0` (stop after +1% of start-of-day equity)
  - Loss stop:
    - `DailyMaxLossCurrency`: e.g. `50`
    - or `DailyMaxLossPct`: e.g. `1.0`
- `MaxTradesPerDay`: e.g. `6`

### World-class safety gates (recommended)

- **Entry slippage guard** (rejects stale/fast spikes):
  - `MaxEntrySlipPips`: e.g. `3.0`

- **Exposure caps** (avoid over-stacking):
  - `MaxPositionsPerSymbol`: `1`
  - `MaxTotalPositions`: e.g. `5`
  - `MaxTotalLots`: e.g. `1.50`

- **Session filter** (server time, hard gate):
  - `EnableSessionFilter`: `true`
  - `Session1Start`: `07:00`, `Session1End`: `11:30`
  - `Session2Start`: `13:00`, `Session2End`: `17:00`

- **News blackout** (manual time window, server time):
  - `EnableNewsBlackout`: `true`
  - `NewsBlackoutStart`: `12:25`, `NewsBlackoutEnd`: `12:45`

- **Equity guard (daily trailing drawdown)**:
  - `EnableEquityGuard`: `true`
  - `DailyMaxDrawdownCurrency`: e.g. `80`
  - or `DailyMaxDrawdownPct`: e.g. `1.5`

## 6) Quick verification

From the repo root:

- Health: `curl -s -o NUL -w "heartbeat:%{http_code}\n" http://127.0.0.1:4101/api/health/heartbeat`
- Quotes: `curl -s -o NUL -w "quotes:%{http_code}\n" "http://127.0.0.1:4101/api/broker/bridge/mt5/market/quotes?maxAgeMs=30000"`
- Bridge status: `curl -s "http://127.0.0.1:4101/api/broker/bridge/status?broker=mt5"`

In MT5 EA logs you should see session connect + periodic heartbeats.

## 7) Common issues

### "No money" / retcode=10019

This means insufficient free margin for the requested lot size.

The EA now auto-sizes lots using `OrderCalcMargin()` and will step lots down and retry (bounded).

### Error 4756

Often indicates a broker/symbol execution constraint (fill mode / permissions / symbol restrictions).

The EA now applies a per-symbol cooldown when repeated 4756 failures happen to avoid endless spam.

---

## MT4?

This document covers the MT5 (`.mq5`) Expert Advisor.

An MT4 (`.mq4`) EA is also included in this repo:

- See [docs/MT4_SETUP.md](docs/MT4_SETUP.md)
