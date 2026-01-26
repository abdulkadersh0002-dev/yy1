# Configuration Overview

This folder contains runtime configuration files and monitoring assets.

## Core JSON configs

- `backtest.config.json` – Backtesting datasets + Monte Carlo / walk-forward settings.
- `data-refresh.config.json` – Data freshness monitor (uses `historical-warehouse.config.json`).
- `historical-warehouse.config.json` – ETL input sources (prices/macro/news) and ETL mode.

## Validation

Run:

```
npm run config:validate
```

Schemas live in `config/schemas/` and are referenced from each JSON file via `$schema`.

## Monitoring assets

- `prometheus/` – alert rules
- `grafana/` – dashboards
- `alertmanager/` – routing + templates
