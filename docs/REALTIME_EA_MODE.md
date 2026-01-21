# Real-time EA Mode (MT4/MT5) — Current Behavior

This project supports a **real-time, EA-driven** workflow where MetaTrader (MT4/MT5) is the source of truth for symbols, quotes, and bars.

## What “EA-driven” means

- **Symbol universe** comes from what the EA streams (price strip / subscribed symbols).
- **Signals** are generated server-side from EA quotes/bars (bar-driven dedupe).
- **Signals stream automatically** to the dashboard via WebSocket; you do not need to click “Analyze Pair”.
- If **Auto Trading** is enabled, strong signals can be **enqueued immediately** for execution (subject to risk rules and news blackout).

## Key URLs / ports

- Backend (Node): `http://127.0.0.1:4101`
- Dashboard (Vite dev): `http://127.0.0.1:4173`
- WebSocket (dashboard + backend): `ws://127.0.0.1:4101/ws/trading`

## Useful endpoints (EA bridge)

- Heartbeat: `GET /api/health/heartbeat`
- EA quotes (symbol strip): `GET /api/broker/bridge/mt5/market/quotes?maxAgeMs=30000`
- EA candles: `GET /api/broker/bridge/mt5/market/candles?symbol=EURUSD&timeframe=M15&limit=100&maxAgeMs=0`

## WebSocket events

The server broadcasts real-time events on `/ws/trading`.

- `signal`: emitted when a new strong signal is published
- `signals`: replay payload sent on connect (recent buffer) so the dashboard populates immediately
- `trade_opened`, `trade_closed`: emitted by the trading engine when trades change state

## Auto-trading behavior (high level)

- Strong EA-driven signals are **ranked and debounced**.
- Execution is gated by:
  - broker connectivity
  - cooldown / de-duplication
  - risk checks and limits
  - news blackout (default 30 min before/after events)

## Allow all symbols (beyond FX/metals/crypto)

By default, EA bridge symbol filtering may restrict to common assets (FX/metals/crypto). To allow _any_ symbol that the EA streams:

- set `ALLOW_ALL_SYMBOLS=true`

## Recommended Windows workflow (VS Code)

- Use the VS Code tasks in `.vscode/tasks.json` to start services and run health checks.
- `npm run start:all` is tolerant of already-running services on ports 4101/4173 (it will report “already running” when reachable).
