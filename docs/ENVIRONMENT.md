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
| `WS_MAX_BUFFERED_BYTES`      | number  | 1000000     | Drop WS broadcasts when client buffer grows |
| `SHUTDOWN_TIMEOUT_MS`        | number  | 15000       | Graceful shutdown timeout before force exit |

## Security Configuration

| Variable                 | Type    | Default | Description                                  |
| ------------------------ | ------- | ------- | -------------------------------------------- |
| `ALLOW_PUBLIC_EA_BRIDGE` | boolean | false   | Allow EA bridge routes without API auth      |
| `CORS_ALLOWED_ORIGINS`   | string  | -       | Comma-separated list of allowed CORS origins |
| `CORS_ALLOW_CREDENTIALS` | boolean | false   | Allow credentials in CORS responses          |

## Job Queue Configuration

| Variable                    | Type    | Default | Description                                     |
| --------------------------- | ------- | ------- | ----------------------------------------------- |
| `ENABLE_JOB_QUEUE`          | boolean | true    | Enable background job queue                     |
| `JOB_QUEUE_CONCURRENCY`     | number  | 2       | Max concurrent jobs                             |
| `JOB_QUEUE_RETRY_ATTEMPTS`  | number  | 2       | Retry attempts per job (excludes first attempt) |
| `JOB_QUEUE_RETRY_BASE_MS`   | number  | 500     | Base retry backoff (ms)                         |
| `JOB_QUEUE_RETRY_MAX_MS`    | number  | 10000   | Max retry backoff (ms)                          |
| `JOB_QUEUE_MAX_SIZE`        | number  | 5000    | Max queued jobs before dropping                 |
| `JOB_QUEUE_DEAD_LETTER_MAX` | number  | 200     | Max retained dead-letter jobs                   |

## Data Providers

### Feature Flags

| Variable                | Type    | Default     | Description                                             |
| ----------------------- | ------- | ----------- | ------------------------------------------------------- |
| `ALLOW_SYNTHETIC_DATA`  | boolean | true (dev)  | Allow synthetic/simulated data                          |
| `REQUIRE_REALTIME_DATA` | boolean | false (dev) | Require real-time data feeds                            |
| `ALLOW_ALL_SYMBOLS`     | boolean | false       | Allow all EA-streamed symbols (disable asset filtering) |
| `EA_ONLY_MODE`          | boolean | true        | Use EA + RSS only (skip provider enforcement)           |

### Provider Configuration

This project defaults to **EA-only + RSS-only** operation.

- No external price/news providers are required.
- No API keys are required.

### Price Bar Data Quality

| Variable                        | Type    | Default | Description                                     |
| ------------------------------- | ------- | ------- | ----------------------------------------------- |
| `PRICE_BARS_MAX_FUTURE_MS`      | number  | 120000  | Max future timestamp tolerance for bars (ms)    |
| `PRICE_BARS_MAX_AGE_MULTIPLIER` | number  | 2.6     | Max age multiplier vs timeframe before stale    |
| `PRICE_BARS_GAP_MULTIPLIER`     | number  | 1.8     | Gap threshold multiplier vs timeframe           |
| `PRICE_BARS_MAX_GAP_RATIO`      | number  | 0.35    | Max allowed gap ratio before warnings/rejection |
| `PRICE_BARS_ENFORCE_QUALITY`    | boolean | false   | Reject low-quality series instead of warning    |

### Data Quality Circuit Breaker

| Variable                            | Type    | Default | Description                                               |
| ----------------------------------- | ------- | ------- | --------------------------------------------------------- |
| `DATA_QUALITY_AUTO_REENABLE`        | boolean | true    | Auto-clear pair circuit breaker after healthy assessments |
| `DATA_QUALITY_REENABLE_MIN_SCORE`   | number  | 78      | Minimum quality score to count as healthy                 |
| `DATA_QUALITY_REENABLE_MIN_HEALTHY` | number  | 2       | Consecutive healthy assessments required to auto-clear    |
| `DATA_QUALITY_REENABLE_WINDOW_MS`   | number  | 240000  | Max time window for consecutive healthy assessments (ms)  |

## News Configuration

| Variable                            | Type    | Default | Description                                                       |
| ----------------------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `ENABLE_NEWS_TRANSLATION`           | boolean | false   | Enable news translation                                           |
| `NEWS_TARGET_LANGUAGE`              | string  | en      | Target language for translation                                   |
| `NEWS_RSS_ONLY`                     | boolean | false   | Use only RSS feeds                                                |
| `EA_SIGNAL_NEWS_LOOKBACK_MINUTES`   | number  | 120     | Lookback window for EA news-aware signal adjustments (minutes)    |
| `EA_SIGNAL_NEWS_LOOKAHEAD_MINUTES`  | number  | 90      | Lookahead window for EA news-aware signal adjustments (minutes)   |
| `EA_SIGNAL_NEWS_IMPACT_THRESHOLD`   | number  | 70      | Minimum impact score to flag news as high-impact for EA execution |
| `EA_SIGNAL_NEWS_IMMINENT_MINUTES`   | number  | 20      | Imminent window for EA news impact scoring (minutes)              |
| `EA_SIGNAL_NEWS_MAX_ITEMS`          | number  | 120     | Max news items to consider for EA signal context                  |
| `EA_SIGNAL_NEWS_CONFIDENCE_PENALTY` | number  | 12      | Confidence penalty per high-impact news item                      |
| `EA_SIGNAL_NEWS_STRENGTH_PENALTY`   | number  | 8       | Strength penalty per high-impact news item                        |
| `EA_SIGNAL_NEWS_MAX_PENALTY`        | number  | 45      | Maximum combined news penalty applied to confidence/strength      |
| `EA_SIGNAL_NEWS_IMMINENT_EXTRA_PENALTY` | number | 4 | Extra penalty applied per imminent high-impact news event |
| `EA_SIGNAL_NEWS_MEDIUM_IMMINENT_MULTIPLIER` | number | 0.6 | Multiplier applied for medium-impact imminent news penalty |
| `EA_SIGNAL_NEWS_VOLATILITY_MULTIPLIER_THRESHOLD` | number | 2.2 | News volatility multiplier threshold treated as extreme |
| `EA_EARLY_EXIT_LOSS_R` | number | 0.35 | Close losing trades early when reversal/trap/news risks appear |
| `EA_LIQUIDITY_TRAP_EXIT_SCORE` | number | 70 | Trap confidence threshold to force protective exit |
| `SMC_TRAP_FOLLOW_THROUGH_MAX_PCT` | number | 0.12 | Max follow-through move (pct) to classify trap |
| `SMC_TRAP_CONFIDENCE_MIN` | number | 62 | Minimum trap confidence to emit trap signal |
| `SMC_TRAP_VOLUME_RATIO_MAX` | number | 1.1 | Max volume ratio before trap signal is suppressed |

## Trading Configuration

| Variable                                | Type    | Default | Description                                                 |
| --------------------------------------- | ------- | ------- | ----------------------------------------------------------- |
| `AUTO_TRADING_AUTOSTART`                | boolean | false   | Auto-start trading on server start                          |
| `AUTO_TRADING_PRESET`                   | string  | -       | Preset tuning (`smart_strong`)                              |
| `AUTO_TRADING_PROFILE`                  | string  | -       | Decision profile (`balanced`, `smart_strong`, `aggressive`) |
| `AUTO_TRADING_FORCE_BROKER`             | string  | -       | Force auto-trading broker (e.g. `mt5`)                      |
| `AUTO_TRADING_SMART_STRONG_ENTER_SCORE` | number  | 45      | Smart-strong entry score (0..100, lower = more entries)     |
| `AUTO_TRADING_REALTIME_MIN_STRENGTH`    | number  | -       | Execution strength floor (overrides smart_strong default)   |
| `AUTO_TRADING_ASSET_CLASSES`            | string  | -       | Auto-trade universe filter (e.g. `forex,metals`)            |
| `AUTO_TRADING_ALLOW_ALL_ASSETS`         | boolean | false   | Disable asset-class filter (allow any symbol)               |
| `AUTO_TRADING_MONITORING_INTERVAL_MS`   | number  | -       | Monitoring interval                                         |
| `AUTO_TRADING_SIGNAL_INTERVAL_MS`       | number  | -       | Signal generation interval                                  |
| `AUTO_TRADING_SIGNAL_CHECK_INTERVAL_MS` | number  | -       | Signal check interval                                       |
| `ADVANCED_SIGNAL_FILTER_ENABLED`        | boolean | false   | Enable stricter, multi-layer signal gating                  |

## Market Rules (UTC-only)

| Variable                    | Type    | Default | Description                           |
| --------------------------- | ------- | ------- | ------------------------------------- |
| `MARKET_FOREX_OPEN_UTC`     | string  | 21:00   | Sunday open time (UTC)                |
| `MARKET_FOREX_CLOSE_UTC`    | string  | 21:00   | Friday close time (UTC)               |
| `MARKET_ROLLOVER_START_UTC` | string  | 21:55   | Rollover window start (UTC)           |
| `MARKET_ROLLOVER_END_UTC`   | string  | 22:10   | Rollover window end (UTC)             |
| `MARKET_BLOCK_ROLLOVER`     | boolean | true    | Block execution during rollover       |
| `MARKET_BLOCK_CLOSED`       | boolean | true    | Block execution when market is closed |

## Risk Caps

| Variable              | Type   | Default | Description                  |
| --------------------- | ------ | ------- | ---------------------------- |
| `MAX_RISK_PER_SYMBOL` | number | 0.04    | Max risk fraction per symbol |

## EA Ingest Guards

| Variable                 | Type   | Default     | Description                             |
| ------------------------ | ------ | ----------- | --------------------------------------- |
| `EA_MAX_QUOTE_AGE_MS`    | number | 120000      | Max age for EA quotes (ms)              |
| `EA_MAX_QUOTE_FUTURE_MS` | number | 120000      | Max future tolerance for EA quotes (ms) |
| `EA_MAX_NEWS_AGE_MS`     | number | 1209600000  | Max age for EA news (ms)                |
| `EA_MAX_NEWS_FUTURE_MS`  | number | 31536000000 | Max future tolerance for EA news (ms)   |
| `EA_MAX_BAR_FUTURE_MS`   | number | 300000      | Max future tolerance for EA bars (ms)   |

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

## Persistence Configuration

| Variable                        | Type    | Default | Description                                  |
| ------------------------------- | ------- | ------- | -------------------------------------------- |
| `PERSISTENCE_RETRY_BASE_MS`     | number  | 5000    | Base retry backoff for DB writes (ms)        |
| `PERSISTENCE_RETRY_MAX_MS`      | number  | 60000   | Max retry backoff for DB writes (ms)         |
| `PERSISTENCE_MAX_FAILURES`      | number  | 10      | Failures before permanent disable (optional) |
| `PERSISTENCE_DISABLE_PERMANENT` | boolean | false   | Permanently disable after max failures       |

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

| Variable                       | Type   | Default       | Description              |
| ------------------------------ | ------ | ------------- | ------------------------ |
| `BROKER_DEFAULT`               | string | mt5           | Default broker           |
| `BROKER_TIME_IN_FORCE`         | string | GTC           | Order time in force      |
| `BROKER_IDEMPOTENCY_TTL_MS`    | number | 600000        | Idempotency cache TTL    |
| `BROKER_RETRY_ATTEMPTS`        | number | 1             | Retry attempts per order |
| `BROKER_RETRY_BASE_MS`         | number | 400           | Base retry delay (ms)    |
| `BROKER_BREAKER_THRESHOLD`     | number | 3             | Failures to open breaker |
| `BROKER_BREAKER_COOLDOWN_MS`   | number | 60000         | Breaker cooldown (ms)    |
| `BROKER_RECONCILE_INTERVAL_MS` | number | 60000         | Reconciliation interval  |
| `BROKER_SERVER_TIMEZONE`       | string | UTC           | Broker server timezone   |
| `BROKER_SYMBOL_SUFFIX`         | string | -             | Broker symbol suffix     |
| `BROKER_SYMBOL_ALLOWLIST`      | string | -             | Allowed symbols (CSV)    |
| `BROKER_SYMBOL_MAP`            | JSON   | -             | Symbol alias map JSON    |
| `BROKER_METALS_SYMBOLS`        | string | XAUUSD,XAGUSD | Metals symbols (CSV)     |

### Broker Modification API (optional)

| Variable                    | Type    | Default | Description                                                                               |
| --------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------- |
| `ENABLE_TRADING_MODIFY_API` | boolean | false   | Enable `POST /api/broker/positions/modify` for manual/diagnostic SL/TP modification calls |

## Governance & Targets

| Variable                    | Type   | Default | Description                                                   |
| --------------------------- | ------ | ------- | ------------------------------------------------------------- |
| `TRADING_SCOPE`             | string | signals | `signals`, `execution`, or `autonomous`                       |
| `TARGET_UPTIME_PCT`         | number | 99.9    | Target uptime percentage                                      |
| `TARGET_P95_LATENCY_MS`     | number | 250     | Target API p95 latency in milliseconds                        |
| `TARGET_MAX_ERROR_RATE_PCT` | number | 0.5     | Target max error rate percentage                              |
| `TARGET_MAX_DRAWDOWN_PCT`   | number | 8       | Target max drawdown percentage                                |
| `TARGET_MAX_SLIPPAGE_PIPS`  | number | 0.8     | Target max slippage in pips (forex) / points (metals, broker) |

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
- Use separate credentials for development and production
