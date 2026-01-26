# MT4 Setup (EA + Server)

This project runs a local backend server (default `4101`) and an MT4 EA that connects to it.

## 1) Start the backend

Preferred (Windows PowerShell):

- Run one of the backend tasks/scripts that starts the API on `4101`.
- If you’re using EA-only realtime mode (MT4/MT5 bridge), ensure the server is running and reachable at:
  - `http://127.0.0.1:4101`

## 2) MT4 terminal prerequisites

### Enable trading

- Enable the main **AutoTrading** button in MT4.
- On the EA chart: Right-click → **Expert Advisors** → **Properties** → check:
  - **Allow live trading**
  - (Optional) **Allow DLL imports** only if you know you need it

### Allow WebRequest

MT4 must allow the EA to call the local server.

- Tools → Options → **Expert Advisors** → **Allow WebRequest for listed URL**
- Add:
  - `http://127.0.0.1:4101`

If you run the server on a different port, add that exact URL.

## 3) Install the EA

File location (MT4):

- `MQL4/Experts/SignalBridge-MT4.mq4`

Source file in this repo:

- `clients/neon-dashboard/public/eas/SignalBridge-MT4.mq4`

Compile it in MetaEditor, then attach it to a chart.

## 4) Recommended EA inputs (safe defaults)

- `BridgeUrl`: `http://127.0.0.1:4101/api/broker/bridge/mt4`
- `RespectServerExecution`: `true` (prevents local/accidental execution)
- `EnableSignalDedupe`: `true`
- `SignalDedupeTtlSec`: `120`

### Execution safety (recommended)

If your MT4 EA build exposes these inputs (matching the MT5 “world-class” gates), recommended defaults are:

- `MaxEntrySlipPips`: `3.0`
- `MaxPositionsPerSymbol`: `1`
- `MaxTotalPositions`: `5`
- `MaxTotalLots`: `1.50`
- `EnableSessionFilter`: `true`
  - `Session1Start`: `07:00`, `Session1End`: `11:30`
  - `Session2Start`: `13:00`, `Session2End`: `17:00`
- `EnableNewsBlackout`: `true`
  - `NewsBlackoutStart`: `12:25`, `NewsBlackoutEnd`: `12:45`
- `EnableEquityGuard`: `true`
  - `DailyMaxDrawdownCurrency`: `80`
  - or `DailyMaxDrawdownPct`: `1.5`

## 5) Quick verification

From the repo root:

- Health: `curl -s -o NUL -w "heartbeat:%{http_code}\n" http://127.0.0.1:4101/api/health/heartbeat`
- Quotes: `curl -s -o NUL -w "quotes:%{http_code}\n" "http://127.0.0.1:4101/api/broker/bridge/mt4/market/quotes?maxAgeMs=30000"`
- Signal: `curl -s "http://127.0.0.1:4101/api/broker/bridge/mt4/signal/get?symbol=EURUSD&accountMode=demo"`

In MT4 EA logs you should see session connect + periodic heartbeats.

## Notes

- The EA polls signals via `GET /api/broker/bridge/mt4/signal/get?symbol=...&accountMode=...`.
- The chart overlay also uses `GET` with query parameters (no GET body), which is more reliable across terminals and proxies.
