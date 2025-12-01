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

| Variable                | Type    | Default     | Description                    |
| ----------------------- | ------- | ----------- | ------------------------------ |
| `ALLOW_SYNTHETIC_DATA`  | boolean | true (dev)  | Allow synthetic/simulated data |
| `REQUIRE_REALTIME_DATA` | boolean | false (dev) | Require real-time data feeds   |

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

| Variable                                | Type    | Default | Description                        |
| --------------------------------------- | ------- | ------- | ---------------------------------- |
| `AUTO_TRADING_AUTOSTART`                | boolean | true    | Auto-start trading on server start |
| `AUTO_TRADING_MONITORING_INTERVAL_MS`   | number  | -       | Monitoring interval                |
| `AUTO_TRADING_SIGNAL_INTERVAL_MS`       | number  | -       | Signal generation interval         |
| `AUTO_TRADING_SIGNAL_CHECK_INTERVAL_MS` | number  | -       | Signal check interval              |

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

| Variable             | Type    | Default                   | Description              |
| -------------------- | ------- | ------------------------- | ------------------------ |
| `ENABLE_BROKER_MT5`  | boolean | true                      | Enable MT5 broker        |
| `MT5_ACCOUNT_MODE`   | string  | demo                      | Account mode (demo/live) |
| `MT5_BRIDGE_URL`     | string  | http://127.0.0.1:5002/api | MT5 bridge URL           |
| `MT5_BRIDGE_TOKEN`   | string  | -                         | MT5 bridge API token     |
| `MT5_ACCOUNT_NUMBER` | string  | -                         | MT5 account number       |

### IBKR

| Variable                 | Type    | Default                       | Description                |
| ------------------------ | ------- | ----------------------------- | -------------------------- |
| `ENABLE_BROKER_IBKR`     | boolean | false                         | Enable Interactive Brokers |
| `IBKR_ACCOUNT_MODE`      | string  | demo                          | Account mode (demo/live)   |
| `IBKR_GATEWAY_URL`       | string  | https://127.0.0.1:5000/v1/api | IBKR gateway URL           |
| `IBKR_ACCOUNT_ID`        | string  | -                             | IBKR account ID            |
| `IBKR_ALLOW_SELF_SIGNED` | boolean | true                          | Allow self-signed certs    |

### General Broker Settings

| Variable                       | Type   | Default | Description             |
| ------------------------------ | ------ | ------- | ----------------------- |
| `BROKER_DEFAULT`               | string | mt5     | Default broker          |
| `BROKER_TIME_IN_FORCE`         | string | GTC     | Order time in force     |
| `BROKER_RECONCILE_INTERVAL_MS` | number | 60000   | Reconciliation interval |

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
