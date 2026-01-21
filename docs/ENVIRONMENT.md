# Environment Variables

This document provides a complete reference for all environment variables used by the Intelligent Auto-Trading System.

## Server Configuration

| Variable                     | Type    | Default     | Description                                 |
| ---------------------------- | ------- | ----------- | ------------------------------------------- |
| `PORT`                       | number  | 4101        | HTTP server port                            |
| `NODE_ENV`                   | string  | development | Environment (development, production, test) |
| `REQUEST_JSON_LIMIT`         | string  | 1mb         | Maximum JSON request body size              |
| `ENABLE_WEBSOCKETS`          | boolean | true        | Enable WebSocket support                    |
| `WEBSOCKET_PATH`             | string  | /ws/trading | WebSocket endpoint path                     |
| `WEBSOCKET_PING_INTERVAL_MS` | number  | 30000       | WebSocket ping interval                     |

## Data Providers

### Feature Flags

| Variable                | Type    | Default     | Description                                             |
| ----------------------- | ------- | ----------- | ------------------------------------------------------- |
| `ALLOW_SYNTHETIC_DATA`  | boolean | true (dev)  | Allow synthetic/simulated data                          |
| `REQUIRE_REALTIME_DATA` | boolean | false (dev) | Require real-time data feeds                            |
| `ALLOW_ALL_SYMBOLS`     | boolean | false       | Allow all EA-streamed symbols (disable asset filtering) |

### API Keys

| Variable                | Description                           | Required    |
| ----------------------- | ------------------------------------- | ----------- |
| `TWELVE_DATA_API_KEY`   | TwelveData API key                    | Recommended |
| `POLYGON_API_KEY`       | Polygon.io API key                    | Optional    |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key                 | Optional    |
| `FINNHUB_API_KEY`       | Finnhub API key                       | Optional    |
| `NEWSAPI_KEY`           | NewsAPI.org API key                   | Recommended |
| `FRED_API_KEY`          | Federal Reserve Economic Data API key | Optional    |
| `OPENAI_API_KEY`        | OpenAI API key (for AI analysis)      | Optional    |
| `EXCHANGERATE_API_KEY`  | ExchangeRate-API key                  | Optional    |
| `FIXER_API_KEY`         | Fixer.io API key                      | Optional    |

### Provider Configuration

| Variable                                      | Type   | Default         | Description                                 |
| --------------------------------------------- | ------ | --------------- | ------------------------------------------- |
| `PRICE_PROVIDERS_DISABLED`                    | string | -               | Comma-separated list of disabled providers  |
| `PRICE_PROVIDER_TWELVEDATA_MIN_INTERVAL_MS`   | number | 1000            | Min interval between TwelveData requests    |
| `PRICE_PROVIDER_ALPHAVANTAGE_MIN_INTERVAL_MS` | number | 15000           | Min interval between Alpha Vantage requests |
| `PRICE_PROVIDER_POLYGON_MIN_INTERVAL_MS`      | number | 1000            | Min interval between Polygon requests       |
| `PRICE_PROVIDER_FINNHUB_MIN_INTERVAL_MS`      | number | 1000            | Min interval between Finnhub requests       |
| `PRICE_PROVIDER_TWELVEDATA_MAX_PER_MINUTE`    | number | 52              | Max TwelveData requests per minute          |
| `PRICE_PROVIDER_TWELVEDATA_COOLDOWN_MS`       | number | 2000            | TwelveData rate limit cooldown              |
| `PRICE_PROVIDER_ALPHAVANTAGE_MAX_PER_DAY`     | number | 400             | Max Alpha Vantage requests per day          |
| `PRICE_PROVIDER_ALPHAVANTAGE_COOLDOWN_MS`     | number | 60000           | Alpha Vantage rate limit cooldown           |
| `PRICE_PROVIDER_POLYGON_MAX_PER_MINUTE`       | number | 80              | Max Polygon requests per minute             |
| `PRICE_PROVIDER_POLYGON_COOLDOWN_MS`          | number | 10000           | Polygon rate limit cooldown                 |
| `PRICE_PROVIDER_FINNHUB_MAX_PER_MINUTE`       | number | 60              | Max Finnhub requests per minute             |
| `PRICE_PROVIDER_FINNHUB_COOLDOWN_MS`          | number | 15000           | Finnhub rate limit cooldown                 |
| `PRICE_PROVIDER_ALPHA_PREFERRED_TIMEFRAMES`   | string | H4,D1           | Timeframes preferred for Alpha Vantage      |
| `PRICE_PROVIDER_FAST_TIMEFRAMES`              | string | M1,M5,M15,M30   | Fast provider timeframes                    |
| `PRICE_PROVIDER_SLOW_TIMEFRAMES`              | string | H4,H6,H12,D1,W1 | Slow provider timeframes                    |

## News Configuration

| Variable                  | Type    | Default | Description                     |
| ------------------------- | ------- | ------- | ------------------------------- |
| `ENABLE_NEWS_TRANSLATION` | boolean | false   | Enable news translation         |
| `NEWS_TARGET_LANGUAGE`    | string  | en      | Target language for translation |
| `NEWS_RSS_ONLY`           | boolean | false   | Use only RSS feeds              |

## Trading Configuration

| Variable                                | Type    | Default | Description                                                 |
| --------------------------------------- | ------- | ------- | ----------------------------------------------------------- |
| `AUTO_TRADING_AUTOSTART`                | boolean | true    | Auto-start trading on server start                          |
| `AUTO_TRADING_PRESET`                   | string  | -       | Preset tuning (`smart_strong`)                              |
| `AUTO_TRADING_PROFILE`                  | string  | -       | Decision profile (`balanced`, `smart_strong`, `aggressive`) |
| `AUTO_TRADING_FORCE_BROKER`             | string  | -       | Force auto-trading broker (e.g. `mt5`)                      |
| `AUTO_TRADING_SMART_STRONG_ENTER_SCORE` | number  | 45      | Smart-strong entry score (0..100, lower = more entries)     |
| `AUTO_TRADING_REALTIME_MIN_CONFIDENCE`  | number  | -       | Execution confidence floor (overrides smart_strong default) |
| `AUTO_TRADING_REALTIME_MIN_STRENGTH`    | number  | -       | Execution strength floor (overrides smart_strong default)   |
| `AUTO_TRADING_ASSET_CLASSES`            | string  | -       | Auto-trade universe filter (e.g. `forex,metals`)            |
| `AUTO_TRADING_ALLOW_ALL_ASSETS`         | boolean | false   | Disable asset-class filter (allow any symbol)               |
| `AUTO_TRADING_MONITORING_INTERVAL_MS`   | number  | -       | Monitoring interval                                         |
| `AUTO_TRADING_SIGNAL_INTERVAL_MS`       | number  | -       | Signal generation interval                                  |
| `AUTO_TRADING_SIGNAL_CHECK_INTERVAL_MS` | number  | -       | Signal check interval                                       |
| `ADVANCED_SIGNAL_FILTER_ENABLED`        | boolean | false   | Enable stricter, multi-layer signal gating                  |

## SMC (Candle-Derived) Heuristics

These tuning knobs affect best-effort SMC-style features computed from EA candles in `src/analyzers/candle-analysis-lite.js`.

| Variable                       | Type   | Default | Description                                                                       |
| ------------------------------ | ------ | ------- | --------------------------------------------------------------------------------- |
| `SMC_VOL_IMBALANCE_MIN_ABS`    | number | 0.12    | Minimum normalized volume-imbalance magnitude to classify buying/selling pressure |
| `SMC_SWEEP_WICK_BODY_MIN`      | number | 1.4     | Minimum wick-to-body ratio to consider a liquidity sweep rejection candle         |
| `SMC_SWEEP_WICK_RANGE_MIN`     | number | 0.35    | Minimum wick-to-range fraction to consider a sweep                                |
| `SMC_SWEEP_ATR_DIV`            | number | 0.6     | ATR divisor used in sweep confidence scaling (higher = stricter)                  |
| `SMC_OB_IMPULSE_RANGE_MULT`    | number | 1.8     | Impulse candle range multiplier vs average range to qualify an order-block setup  |
| `SMC_OB_IMPULSE_BODY_FRAC_MIN` | number | 0.55    | Minimum impulse body fraction (body/range)                                        |
| `SMC_OB_NEAR_ATR_FRAC`         | number | 0.35    | “Near price” threshold as a fraction of ATR for an order-block zone               |
| `SMC_VOL_RATIO_MIN`            | number | 1.8     | Volume spike minimum ratio (latest volume / average volume)                       |
| `SMC_VOL_Z_MIN`                | number | 1.5     | Volume spike minimum z-score                                                      |
| `SMC_FVG_MIN_ATR_FRAC`         | number | 0.15    | Minimum FVG gap size as a fraction of ATR to be considered meaningful             |
| `SMC_FVG_MAX_AGE_BARS`         | number | 25      | Maximum age (bars) for a gap to be considered in the nearest/unfilled list        |

## Risk Management

| Variable                        | Type    | Default | Description                      |
| ------------------------------- | ------- | ------- | -------------------------------- |
| `ENABLE_RISK_COMMAND_CENTER`    | boolean | true    | Enable risk command center       |
| `RISK_BLOTTER_SIZE`             | number  | 25      | Number of trades in risk blotter |
| `RISK_CURRENCY_LIMITS`          | JSON    | -       | Currency exposure limits         |
| `RISK_CORRELATION_MATRIX`       | JSON    | -       | Custom correlation matrix        |
| `RISK_CORRELATION_ENABLED`      | boolean | true    | Enable correlation checks        |
| `RISK_CORRELATION_THRESHOLD`    | number  | 0.8     | Correlation threshold            |
| `RISK_MAX_CORRELATED_POSITIONS` | number  | 3       | Max correlated positions         |
| `RISK_VAR_ENABLED`              | boolean | true    | Enable Value at Risk             |
| `RISK_VAR_CONFIDENCE`           | number  | 0.95    | VaR confidence level             |
| `RISK_VAR_LOOKBACK`             | number  | 50      | VaR lookback trades              |
| `RISK_VAR_MAX_LOSS_PCT`         | number  | 6       | Max VaR loss percentage          |
| `RISK_VAR_MIN_SAMPLES`          | number  | 20      | Min samples for VaR              |

## Alerting Configuration

### Alert Thresholds

| Variable                          | Type   | Description                |
| --------------------------------- | ------ | -------------------------- |
| `ALERT_DRAWDOWN_THRESHOLD_PCT`    | number | Drawdown alert threshold   |
| `ALERT_VOLATILITY_THRESHOLD`      | number | Volatility alert threshold |
| `ALERT_VOLATILITY_COOLDOWN_MS`    | number | Volatility alert cooldown  |
| `ALERT_EXPOSURE_WARNING_FRACTION` | number | Exposure warning threshold |

### Email Alerts

| Variable              | Type    | Description              |
| --------------------- | ------- | ------------------------ |
| `ALERT_EMAIL_FROM`    | string  | Sender email address     |
| `ALERT_EMAIL_TO`      | string  | Recipient email address  |
| `ALERT_SMTP_HOST`     | string  | SMTP server host         |
| `ALERT_SMTP_PORT`     | number  | SMTP port (default: 587) |
| `ALERT_SMTP_SECURE`   | boolean | Use TLS                  |
| `ALERT_SMTP_USER`     | string  | SMTP username            |
| `ALERT_SMTP_PASSWORD` | string  | SMTP password            |

### Webhook Alerts

| Variable              | Type   | Description                  |
| --------------------- | ------ | ---------------------------- |
| `ALERT_SLACK_WEBHOOK` | string | Slack webhook URL            |
| `ALERT_WEBHOOK_URLS`  | string | Comma-separated webhook URLs |
| `ALERT_DEDUPE_MS`     | number | Alert deduplication window   |

## Database Configuration

| Variable      | Type    | Default          | Description           |
| ------------- | ------- | ---------------- | --------------------- |
| `DB_HOST`     | string  | localhost        | Database host         |
| `DB_PORT`     | number  | 5432             | Database port         |
| `DB_NAME`     | string  | signals_strategy | Database name         |
| `DB_USER`     | string  | signals_user     | Database username     |
| `DB_PASSWORD` | string  | -                | Database password     |
| `DB_SSL`      | boolean | false            | Enable SSL connection |

## Broker Configuration

### OANDA

| Variable              | Type    | Default | Description              |
| --------------------- | ------- | ------- | ------------------------ |
| `ENABLE_BROKER_OANDA` | boolean | false   | Enable OANDA broker      |
| `OANDA_ACCOUNT_MODE`  | string  | demo    | Account mode (demo/live) |
| `OANDA_ACCESS_TOKEN`  | string  | -       | OANDA API token          |
| `OANDA_ACCOUNT_ID`    | string  | -       | OANDA account ID         |

### MT5

| Variable             | Type    | Default                     | Description              |
| -------------------- | ------- | --------------------------- | ------------------------ |
| `ENABLE_BROKER_MT5`  | boolean | true                        | Enable MT5 broker        |
| `MT5_ACCOUNT_MODE`   | string  | demo                        | Account mode (demo/live) |
| `MT5_BRIDGE_URL`     | string  | <http://127.0.0.1:5002/api> | MT5 bridge URL           |
| `MT5_BRIDGE_TOKEN`   | string  | -                           | MT5 bridge API token     |
| `MT5_ACCOUNT_NUMBER` | string  | -                           | MT5 account number       |

The MT5 bridge service is expected to expose (at minimum) these endpoints:

- `GET /status`
- `POST /session/connect`
- `POST /orders`
- `POST /positions/close`
- `POST /positions/modify` (required for broker-side breakeven/trailing stop updates)

### IBKR

| Variable                 | Type    | Default                         | Description                |
| ------------------------ | ------- | ------------------------------- | -------------------------- |
| `ENABLE_BROKER_IBKR`     | boolean | false                           | Enable Interactive Brokers |
| `IBKR_ACCOUNT_MODE`      | string  | demo                            | Account mode (demo/live)   |
| `IBKR_GATEWAY_URL`       | string  | <https://127.0.0.1:5000/v1/api> | IBKR gateway URL           |
| `IBKR_ACCOUNT_ID`        | string  | -                               | IBKR account ID            |
| `IBKR_ALLOW_SELF_SIGNED` | boolean | true                            | Allow self-signed certs    |

### General Broker Settings

| Variable                       | Type   | Default | Description             |
| ------------------------------ | ------ | ------- | ----------------------- |
| `BROKER_DEFAULT`               | string | mt5     | Default broker          |
| `BROKER_TIME_IN_FORCE`         | string | GTC     | Order time in force     |
| `BROKER_RECONCILE_INTERVAL_MS` | number | 60000   | Reconciliation interval |

### Broker Modification API (optional)

| Variable                    | Type    | Default | Description                                                                               |
| --------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------- |
| `ENABLE_TRADING_MODIFY_API` | boolean | false   | Enable `POST /api/broker/positions/modify` for manual/diagnostic SL/TP modification calls |

## Service Configuration

### Risk Reports

| Variable               | Type    | Default | Description                  |
| ---------------------- | ------- | ------- | ---------------------------- |
| `ENABLE_RISK_REPORTS`  | boolean | true    | Enable daily risk reports    |
| `RISK_REPORT_HOUR_UTC` | number  | 7       | Report generation hour (UTC) |

### Performance Digests

| Variable                         | Type    | Default   | Description                  |
| -------------------------------- | ------- | --------- | ---------------------------- |
| `ENABLE_PERFORMANCE_DIGESTS`     | boolean | true      | Enable performance digests   |
| `PERFORMANCE_DIGEST_HOUR_UTC`    | number  | 20        | Digest generation hour (UTC) |
| `PERFORMANCE_DIGEST_OUTPUT_DIR`  | string  | ./digests | Output directory             |
| `PERFORMANCE_DIGEST_PDF_ENABLED` | boolean | true      | Generate PDF reports         |

### Prefetch Scheduler

| Variable                    | Type    | Default | Description            |
| --------------------------- | ------- | ------- | ---------------------- |
| `ENABLE_PREFETCH_SCHEDULER` | boolean | true    | Enable pair prefetch   |
| `PREFETCH_TICK_MS`          | number  | 5000    | Prefetch tick interval |
| `PREFETCH_MAX_PER_TICK`     | number  | 10      | Max pairs per tick     |

## Provider Availability Monitoring

| Variable                                      | Type    | Default            | Description                |
| --------------------------------------------- | ------- | ------------------ | -------------------------- |
| `ALERT_PROVIDER_ENABLED`                      | boolean | true               | Enable provider alerts     |
| `ALERT_PROVIDER_DEGRADED_RATIO`               | number  | 0.3                | Degraded threshold ratio   |
| `ALERT_PROVIDER_CRITICAL_RATIO`               | number  | 0.75               | Critical threshold ratio   |
| `ALERT_PROVIDER_QUALITY_WARNING`              | number  | 60                 | Quality warning threshold  |
| `ALERT_PROVIDER_QUALITY_CRITICAL`             | number  | 45                 | Quality critical threshold |
| `ALERT_PROVIDER_COOLDOWN_MS`                  | number  | 600000             | Alert cooldown (10 min)    |
| `PROVIDER_AVAILABILITY_BROADCAST_INTERVAL_MS` | number  | 20000              | Broadcast interval         |
| `PROVIDER_AVAILABILITY_HISTORY_LIMIT`         | number  | 288                | History sample limit       |
| `PROVIDER_AVAILABILITY_TIMEFRAMES`            | string  | M1,M5,M15,H1,H4,D1 | Monitored timeframes       |

## Metrics

| Variable         | Type   | Default | Description               |
| ---------------- | ------ | ------- | ------------------------- |
| `METRICS_PREFIX` | string | signals | Prometheus metrics prefix |

## Example Configuration

Create a `.env` file based on `.env.example`:

```bash
# Copy the example
cp .env.example .env

# Edit with your values
nano .env
```

### Development Configuration

```env
NODE_ENV=development
PORT=4101
ALLOW_SYNTHETIC_DATA=true
REQUIRE_REALTIME_DATA=false
AUTO_TRADING_AUTOSTART=false
```

### Production Configuration

```env
NODE_ENV=production
PORT=4101
ALLOW_SYNTHETIC_DATA=false
REQUIRE_REALTIME_DATA=true
AUTO_TRADING_AUTOSTART=true

# Required API keys
TWELVE_DATA_API_KEY=your_key
NEWSAPI_KEY=your_key

# Database
DB_HOST=your_db_host
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=signals_strategy
DB_SSL=true
```

## Security Notes

- **Never commit** `.env` files to version control
- Use a **secrets manager** in production (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate API keys regularly
- Use separate credentials for development and production
