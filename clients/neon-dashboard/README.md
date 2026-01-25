# Neon Trading Dashboard

A modern, neon-inspired control center delivering real-time visibility into the Signals Strategy auto-trading engine.

## Features

- Live status summarizing automation state, win rate, PnL, and risk utilization
- Streaming event feed (signals, trade executions, automation toggles) via WebSocket
- Rich trading tables for open positions and recent closures
- Feature store spotlight showcasing technical regime snapshots per pair
- Provider heartbeat overview with latency telemetry
- Configurable API endpoint, key, and WebSocket path via environment variables

## Getting Started

```powershell
cd clients/neon-dashboard
npm install
npm run dev
```

By default the dev server listens on `http://localhost:4173` and proxies `/api`, `/metrics`, and `/ws` to `http://localhost:4101` (the Node backend).

### Environment Variables

Place variables in a `.env` file or export them before running Vite:

| Variable                   | Description                                                       | Default                   |
| -------------------------- | ----------------------------------------------------------------- | ------------------------- |
| `VITE_API_BASE_URL`        | Base URL for REST API requests                                    | `http://localhost:4101`   |
| `VITE_WS_URL`              | Explicit WebSocket URL                                            | Derived from base URL     |
| `VITE_WS_PATH`             | WebSocket path appended to base URL when `VITE_WS_URL` is omitted | `/ws/trading`             |
| `VITE_DEV_PROXY_TARGET`    | Dev proxy override for `/api` and `/metrics`                      | `http://localhost:4101`   |
| `VITE_DISABLE_STRICT_MODE` | Disable React StrictMode in dev (avoids double-invoked effects)   | `false`                   |
| `VITE_FETCH_CACHE_TTL_MS`  | Short-lived GET cache to collapse rapid repeat fetches (ms)       | `250` in dev, `0` in prod |

## Building for Production

```powershell
npm run build
```

Bundles are emitted into `clients/neon-dashboard/dist`. Serve the static assets with any web server (Nginx, S3, CDN) or extend the Node API server to host the directory.

To preview the production build locally:

```powershell
npm run preview
```

## Integration Notes

- The dashboard relies on API routes exposed by `src/server.js` and expects API authentication to be disabled or handled upstream.
- The WebSocket channel listens on `/ws/trading` and forwards broadcast events (`signal`, `trade_opened`, `trade_closed`, automation state changes). Adjust `ENABLE_WEBSOCKETS` in the server if you need to disable streams.
- Heartbeat telemetry is sourced from `/api/health/heartbeat`; ensure the service is enabled to populate provider status.

## Styling

The neon visual language is implemented via `src/styles/global.css`. Tune CSS variables at the top of the file to align with your preferred palette.
