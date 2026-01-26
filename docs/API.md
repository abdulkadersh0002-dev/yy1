# API Reference

This document provides detailed information about the Intelligent Auto-Trading System API endpoints.

## Base URL

```text
http://localhost:4101/api
```

## WebSocket

The system broadcasts realtime events over WebSocket (used by the dashboard).

- URL: `ws://localhost:4101/ws/trading`
- Typical events: `signal`, `signals` (replay buffer on connect), `trade_opened`, `trade_closed`

## Authentication

API authentication is controlled via the `ENABLE_API_AUTH` environment variable. When enabled, requests must include proper authentication headers.

### Exempt Routes

The following routes do not require authentication:

- `GET /api/health/*` - Health check endpoints
- `GET /api/healthz` - Kubernetes health probe
- `GET /metrics` - Prometheus metrics
- `GET /api/metrics` - Prometheus metrics (legacy)
- `GET /api/client/*` - Client application routes

## Endpoints

### Health Endpoints

#### GET /api/healthz

Kubernetes-style health check endpoint.

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": 1699123456789,
  "data": {
    "engine": "operational",
    "tradeManager": "operational",
    "heartbeat": "active"
  }
}
```

**Status Codes:**

- `200` - Healthy
- `503` - Critical (unhealthy)

---

#### GET /api/health/modules

Get detailed health status for all system modules.

**Response:**

```json
{
  "success": true,
  "overall": "healthy",
  "modules": {
    "tradingEngine": { "status": "operational", "detail": "..." },
    "tradeManager": { "status": "operational", "detail": "..." },
    "priceFeeds": { "status": "operational", "detail": "..." }
  },
  "heartbeat": {
    "lastBeat": "2024-01-01T00:00:00.000Z",
    "intervalMs": 30000
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/health/providers

Get data provider availability and health status.

**Query Parameters:**

| Parameter               | Type    | Description                                            |
| ----------------------- | ------- | ------------------------------------------------------ |
| `timeframes`            | string  | Comma-separated timeframes to check (e.g., `M1,M5,H1`) |
| `qualityThreshold`      | number  | Minimum quality threshold (0-100)                      |
| `requireHealthyQuality` | boolean | Require healthy quality (default: true)                |

**Response:**

```json
{
  "success": true,
  "timestamp": 1699123456789,
  "providers": [],
  "timeframes": [{ "timeframe": "M15", "viable": true }],
  "aggregateQuality": 85.5,
  "classification": {
    "state": "healthy",
    "reason": "ea_only_mode",
    "severity": "info"
  }
}
```

---

#### GET /api/health/heartbeat

Get heartbeat monitor status.

**Response:**

```json
{
  "success": true,
  "heartbeat": {
    "lastBeat": "2024-01-01T00:00:00.000Z",
    "intervalMs": 30000,
    "status": "active"
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/health/runtime

Get a runtime configuration summary (environment, toggles, and effective modes).

**Response:**

```json
{
  "success": true,
  "runtime": {
    "environment": "development",
    "server": { "port": 4101, "enableWebSockets": true, "websocketPath": "/ws/trading" },
    "apiAuthEnabled": false,
    "tradingScope": { "mode": "signals", "allowExecution": false },
    "eaOnlyMode": true,
    "autoTrading": { "autostart": false },
    "brokerRouting": { "enabled": true, "defaultBroker": "mt5" },
    "brokers": { "mt5": true, "mt4": false, "oanda": false, "ibkr": false },
    "services": { "riskReports": true, "performanceDigests": true, "brokerReconciliation": true, "pairPrefetch": true, "jobQueue": true },
    "persistence": { "enabled": false, "ssl": false },
    "endpoints": { "health": "/api/healthz", "metrics": "/metrics", "websocket": "/ws/trading" }
  },
  "timestamp": 1699123456789
}
```

---

#### GET /metrics

Prometheus metrics endpoint.

Also available at `GET /api/metrics` for compatibility.

**Response:** Plain text Prometheus metrics format

---

### Trading Endpoints

#### GET /api/status

Get system trading status.

**Response:**

```json
{
  "success": true,
  "status": {
    "autoTrading": true,
    "activeTrades": 3,
    "tradingPairs": ["EURUSD", "GBPUSD", "USDJPY"]
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/statistics

Get trading performance statistics.

**Response:**

```json
{
  "success": true,
  "statistics": {
    "totalTrades": 150,
    "winRate": 0.65,
    "profitFactor": 1.8,
    "averageWin": 25.5,
    "averageLoss": -15.2,
    "maxDrawdown": -5.2
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/signal/generate

Generate a trading signal for a currency pair.

Note: In EA-driven realtime mode, strong signals can be generated automatically from EA bars and streamed to the dashboard; this endpoint remains useful for manual/debug scenarios.

**Request Body:**

```json
{
  "pair": "EURUSD"
}
```

**Response:**

```json
{
  "success": true,
  "signal": {
    "pair": "EURUSD",
    "direction": "BUY",
    "strength": 75,
    "confidence": 0.85,
    "entryPrice": 1.105,
    "stopLoss": 1.102,
    "takeProfit": 1.111,
    "timestamp": 1699123456789
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/signal/batch

Generate signals for multiple currency pairs.

**Request Body:**

```json
{
  "pairs": ["EURUSD", "GBPUSD", "USDJPY"]
}
```

**Response:**

```json
{
  "success": true,
  "count": 3,
  "signals": [
    { "pair": "EURUSD", "direction": "BUY", "strength": 75 },
    { "pair": "GBPUSD", "direction": "SELL", "strength": 60 },
    { "pair": "USDJPY", "direction": "HOLD", "strength": 25 }
  ],
  "timestamp": 1699123456789
}
```

---

#### POST /api/trade/execute

Execute a trade based on generated signal.

---

### EA Bridge (MT4/MT5)

These endpoints expose the EA-streamed quotes/bars used by the realtime runner and the dashboard.

#### GET /api/broker/bridge/:broker/market/quotes

**Query Parameters:**

| Parameter  | Type   | Description                                      |
| ---------- | ------ | ------------------------------------------------ |
| `maxAgeMs` | number | Cache tolerance; `0` forces fresh               |
| `symbols`  | string | Optional comma-separated symbols (e.g. `EURUSD`) |

**Response (example):**

```json
{
  "success": true,
  "broker": "mt5",
  "quotes": [{ "symbol": "EURUSD", "bid": 1.085, "ask": 1.0851, "receivedAt": 1730000000000 }],
  "count": 1,
  "timestamp": 1730000000000
}
```

#### GET /api/broker/bridge/:broker/market/candles

**Query Parameters:**

| Parameter   | Type   | Description                       |
| ----------- | ------ | --------------------------------- |
| `symbol`    | string | Symbol name (as streamed by EA)   |
| `timeframe` | string | e.g. `M1`, `M5`, `M15`, `H1`      |
| `limit`     | number | Max bars returned                 |
| `maxAgeMs`  | number | Cache tolerance; `0` forces fresh |

**Response (example):**

```json
{
  "success": true,
  "broker": "mt5",
  "symbol": "EURUSD",
  "timeframe": "M15",
  "candles": [{ "time": 1730000000000, "open": 1.08, "high": 1.081, "low": 1.079, "close": 1.0805 }],
  "count": 1,
  "timestamp": 1730000000000
}
```

#### GET /api/broker/bridge/:broker/signal/get

Returns the current **execution-oriented** signal payload for the EA.

**Query Parameters:**

| Parameter     | Type   | Description |
| ------------ | ------ | ----------- |
| `symbol`     | string | Required symbol (e.g. `EURUSD`) |
| `accountMode`| string | Optional (e.g. `demo` or `real`) |

**Response (shape):**

```json
{
  "success": true,
  "message": "OK",
  "signal": { "pair": "EURUSD", "direction": "BUY", "isValid": { "isValid": true } },
  "shouldExecute": true,
  "execution": { "shouldExecute": true },
  "snapshotPending": false,
  "broker": "mt5",
  "timestamp": 1730000000000
}
```

#### GET /api/broker/bridge/:broker/agent/config

Returns server policy (min confidence/strength, news/liquidity guards, runtime flags) to keep the EA aligned.

---

#### GET /api/trades/active

Get all currently active trades.

**Response:**

```json
{
  "success": true,
  "count": 3,
  "trades": [
    {
      "id": "trade-123",
      "pair": "EURUSD",
      "direction": "BUY",
      "entryPrice": 1.105,
      "currentPrice": 1.1065,
      "unrealizedPnL": 15.5
    }
  ],
  "timestamp": 1699123456789
}
```

---

#### GET /api/trades/history

Get trade history.

**Query Parameters:**

| Parameter | Type   | Default | Description                        |
| --------- | ------ | ------- | ---------------------------------- |
| `limit`   | number | 50      | Maximum number of trades to return |

**Response:**

```json
{
  "success": true,
  "count": 50,
  "total": 150,
  "trades": [
    {
      "id": "trade-100",
      "pair": "EURUSD",
      "direction": "BUY",
      "entryPrice": 1.105,
      "exitPrice": 1.1085,
      "realizedPnL": 35.0,
      "closeReason": "take_profit"
    }
  ],
  "timestamp": 1699123456789
}
```

---

#### POST /api/trade/close/:tradeId

Close a specific trade.

**URL Parameters:**

| Parameter | Type   | Description       |
| --------- | ------ | ----------------- |
| `tradeId` | string | Trade ID to close |

**Response:**

```json
{
  "success": true,
  "trade": {
    "id": "trade-123",
    "pair": "EURUSD",
    "exitPrice": 1.1065,
    "realizedPnL": 15.5,
    "closeReason": "manual_close"
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/trade/close-all

Close all active trades.

**Response:**

```json
{
  "success": true,
  "result": {
    "closed": 3,
    "trades": ["trade-123", "trade-124", "trade-125"]
  },
  "timestamp": 1699123456789
}
```

---

### Auto-Trading Endpoints

#### POST /api/auto-trading/start

Start automatic trading.

**Response:**

```json
{
  "success": true,
  "message": "Auto trading started",
  "details": {
    "pairs": ["EURUSD", "GBPUSD"],
    "checkInterval": 60000
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/auto-trading/stop

Stop automatic trading.

**Response:**

```json
{
  "success": true,
  "message": "Auto trading stopped",
  "details": {
    "openPositions": 2
  },
  "timestamp": 1699123456789
}
```

---

### Configuration Endpoints

#### GET /api/config

Get current trading configuration.

**Response:**

```json
{
  "success": true,
  "config": {
    "minSignalStrength": 35,
    "riskPerTrade": 0.02,
    "maxDailyRisk": 0.06,
    "maxConcurrentTrades": 5,
    "signalAmplifier": 2.5,
    "directionThreshold": 12
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/config/update

Update trading configuration.

**Request Body:**

```json
{
  "minSignalStrength": 40,
  "maxConcurrentTrades": 10
}
```

**Response:**

```json
{
  "success": true,
  "message": "Configuration updated",
  "config": {
    "minSignalStrength": 40,
    "maxConcurrentTrades": 10
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/pairs

Get configured trading pairs.

**Response:**

```json
{
  "success": true,
  "pairs": ["EURUSD", "GBPUSD", "USDJPY"],
  "count": 3,
  "timestamp": 1699123456789
}
```

---

#### POST /api/pairs/add

Add a trading pair.

**Request Body:**

```json
{
  "pair": "AUDUSD"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Pair added",
  "pairs": ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"],
  "timestamp": 1699123456789
}
```

---

#### POST /api/pairs/remove

Remove a trading pair.

**Request Body:**

```json
{
  "pair": "AUDUSD"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Pair removed",
  "pairs": ["EURUSD", "GBPUSD", "USDJPY"],
  "timestamp": 1699123456789
}
```

---

### Broker Endpoints

#### GET /api/broker/status

Get broker connection status.

**Response:**

```json
{
  "success": true,
  "status": {
    "defaultBroker": "mt5",
    "killSwitch": false,
    "connectedBrokers": ["mt5"]
  },
  "health": {
    "mt5": { "connected": true, "latencyMs": 50 }
  },
  "timestamp": 1699123456789
}
```

---

#### POST /api/broker/kill-switch

Toggle broker kill switch.

**Request Body:**

```json
{
  "enabled": true,
  "reason": "Market volatility"
}
```

**Response:**

```json
{
  "success": true,
  "state": {
    "enabled": true,
    "reason": "Market volatility",
    "activatedAt": "2024-01-01T00:00:00.000Z"
  },
  "timestamp": 1699123456789
}
```

---

### Feature Endpoints

#### GET /api/features

Get feature store summary.

**Query Parameters:**

| Parameter   | Type   | Default | Description                    |
| ----------- | ------ | ------- | ------------------------------ |
| `limit`     | number | 25      | Maximum recent entries         |
| `snapshots` | number | 0       | Number of snapshots to include |

**Response:**

```json
{
  "success": true,
  "stats": {
    "totalKeys": 100,
    "totalEntries": 5000,
    "recent": [...]
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/features/:pair

Get features for a specific pair.

**URL Parameters:**

| Parameter | Type   | Description                  |
| --------- | ------ | ---------------------------- |
| `pair`    | string | Currency pair (e.g., EURUSD) |

**Query Parameters:**

| Parameter   | Type    | Default | Description      |
| ----------- | ------- | ------- | ---------------- |
| `timeframe` | string  | M15     | Timeframe        |
| `limit`     | number  | 50      | Maximum entries  |
| `snapshot`  | boolean | false   | Include snapshot |

**Response:**

```json
{
  "success": true,
  "pair": "EURUSD",
  "timeframe": "M15",
  "latest": {
    "rsi": 55.5,
    "macd": 0.0012,
    "ema20": 1.1045
  },
  "timestamp": 1699123456789
}
```

---

#### GET /api/risk/command-center

Get risk command center data.

**Response:**

```json
{
  "success": true,
  "snapshot": {
    "totalExposure": 15000,
    "marginUsed": 1500,
    "drawdown": -2.5,
    "positions": [...]
  },
  "timestamp": 1699123456789
}
```

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error description"
}
```

### HTTP Status Codes

| Code | Description                            |
| ---- | -------------------------------------- |
| 200  | Success                                |
| 400  | Bad Request - Invalid parameters       |
| 401  | Unauthorized - Authentication required |
| 403  | Forbidden - Insufficient permissions   |
| 404  | Not Found - Resource not found         |
| 500  | Internal Server Error                  |
| 503  | Service Unavailable - Feature disabled |
