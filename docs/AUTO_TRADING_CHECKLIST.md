# Auto Trading (EA-only) — Checklist & Spec (English)

This document describes the **smart auto-trading** behavior implemented by the backend automation loop.

## 1) Safety Preconditions (must be true)

- Broker must be connected (MT4/MT5 via EA bridge).
- EA-only mode is enforced automatically when broker is `mt4` or `mt5`.
- Risk engine must approve the trade (`riskManagement.canTrade === true`).
- Active trades must be below `maxConcurrentTrades`.

EA-side hard gates (if enabled) also apply in MT4/MT5:

- Session window filter
- Manual news blackout window
- Entry slippage guard
- Exposure caps (per-symbol / total lots / total positions)
- Equity drawdown guard

## 1.1) Signal Universe (what gets scanned)

- Auto-trading is **not limited to the 7 preset pairs**.
- In EA mode (MT4/MT5), it automatically scans **any symbol that appears in recent EA quotes** (the live quote strip / price bar symbols), then applies the normal safety gates (risk/news/spread).
- The universe is capped to avoid accidental over-scanning.

Config:

- `tradingEngine.config.autoTrading.dynamicUniverseEnabled` (default: `true`)
- `tradingEngine.config.autoTrading.universeMaxAgeMs` (default: `60000`)
- `tradingEngine.config.autoTrading.universeMaxSymbols` (default: `200`)
- `tradingEngine.config.autoTrading.allowAllQuoteSymbols` (default: `true`) — when true, allows non-forex/metals/crypto symbols if they appear on the quote strip (still gated by risk/news/spread).

## 2) News Blackout (hard block)

- High-impact calendar events are used to **hard-block entries**.
- Default window is **30 minutes before and 30 minutes after** each event.
- Impact threshold default is `8`.

Config:

- `tradingEngine.config.newsBlackoutMinutes` (default: `30`)
- `tradingEngine.config.newsBlackoutImpactThreshold` (default: `8`)

## 3) Entry / SL / TP Rules

- Entry plan is ATR/volatility-regime based.
- Stop-loss distance is ATR × volatility-adjusted multiple.
- Take-profit distance is ATR × adjusted reward multiple.
- Enforces a minimum RR floor via `minRiskReward`.

Key defaults:

- `minRiskReward` default: `2.0`

## 4) Trailing Stop + Breakeven Rules

Each new trade carries a trailing plan:

- **Move SL to breakeven** when price reaches **50% of TP distance**.
- **Activate trailing** after **60% of TP distance**.
- **Step trailing**: only update SL if it improves by at least `stepDistance` (prevents noisy micro-updates).

Defaults (derived from ATR):

- `trailingDistance` ≈ `0.8 × initial SL distance`
- `stepDistance` ≈ `0.2 × initial SL distance`

## 5) Signal Quality + Ranking

A signal is allowed to enter only when:

- `validateSignal()` returns `ENTER` (hard checks pass + decision score meets the profile).

When scanning many symbols, the automation ranks candidates by:

1. `decision.score` (descending)
2. `confidence` (descending)
3. `strength` (descending)

Then it opens only a limited number per cycle (default: **1**) to avoid overtrading.

Realtime behavior (no manual actions):

- When the EA streams new quotes/bars, the server generates **strong signals**.
- If Auto Trading is ON, those strong signals are **debounced, ranked, and executed automatically** (still respecting news blackout, spread, and risk limits).
- This means trades can open **without clicking “Analyze Pair”**.

Config:

- `tradingEngine.config.autoTrading.maxNewTradesPerCycle` (default: `1`)
- `tradingEngine.config.autoTrading.realtimeSignalExecutionEnabled` (default: `true`)
- `tradingEngine.config.autoTrading.realtimeExecutionDebounceMs` (default: `500`)
- `tradingEngine.config.autoTrading.realtimeTradeCooldownMs` (default: `180000`)

## 6) Execution Cost + Spread

- Spread is hard-blocked when it exceeds `maxSpreadPips` (default: `2.0`).
- Spread is also penalized softly relative to ATR/TP in the decision score.

Config:

- `tradingEngine.config.maxSpreadPips`

## 7) Session Awareness

The engine applies a **soft session modifier**:

- Forex prefers London/NY sessions.
- Metals penalize Asia / off-hours.
- Crypto is mostly neutral.

This is not a hard blocker; it reduces aggressiveness.

## 8) How To Use

- Start auto-trading (per broker):
  - `POST /api/auto-trading/start` with body `{ "broker": "mt5" }`
- Stop auto-trading:
  - `POST /api/auto-trading/stop` with body `{ "broker": "mt5" }`
  - Or without broker to stop all.

WebSocket events:

- Server broadcasts state changes like `auto_trading_started` / `auto_trading_stopped`.

## 9) Recommended Ops Checklist

Before enabling:

- Confirm EA connected and streaming quotes/bars.
- Confirm calendar feed is available (or accept fewer blocks).
- Start with a small `riskPerTrade` and low `maxConcurrentTrades`.
- Watch logs for trade decisions and news blocks.

During runtime:

- Monitor active trades and trailing updates.
- Ensure spreads are reasonable for the broker/symbol.

After runtime:

- Review trade history and outcomes.
- Tune thresholds (strength/confidence/enterScore) only after enough samples.
