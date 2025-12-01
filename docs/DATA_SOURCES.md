# Data Sources Configuration

This document describes the data sources used by the Intelligent Auto-Trading System for real-time market data and news analysis.

## Price Data Providers

### TwelveData (Primary)

TwelveData is the primary price data provider for forex pairs.

**Configuration:**

```env
TWELVE_DATA_API_KEY=your_api_key_here
PRICE_PROVIDER_TWELVEDATA_MAX_PER_MINUTE=52
PRICE_PROVIDER_TWELVEDATA_COOLDOWN_MS=2000
```

**Supported Pairs:**

- Major: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD
- Crosses: EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY, EUR/AUD
- All forex pairs available on TwelveData

**Timeframes:**

- M1 (1 minute)
- M5 (5 minutes)
- M15 (15 minutes)
- M30 (30 minutes)
- H1 (1 hour)
- H4 (4 hours)
- D1 (Daily)
- W1 (Weekly)

### Fallback Providers

The system also supports these providers as fallbacks:

1. **Polygon.io** - `POLYGON_API_KEY`
2. **Finnhub** - `FINNHUB_API_KEY`
3. **Alpha Vantage** - `ALPHA_VANTAGE_API_KEY`

## RSS News Feeds

The system aggregates news from 14 high-quality financial news sources:

### Major Financial News

| Source              | Category | Priority | Coverage                   |
| ------------------- | -------- | -------- | -------------------------- |
| Reuters             | Macro    | 1        | Global business & economy  |
| Reuters Markets     | Markets  | 1        | European markets focus     |
| Bloomberg Markets   | Markets  | 1        | Global markets & analysis  |
| CNBC Markets        | Markets  | 1        | US markets & breaking news |
| Financial Times     | Markets  | 1        | Global finance & markets   |
| Wall Street Journal | Markets  | 1        | US-focused market news     |

### Forex Specialized

| Source        | Category | Priority | Coverage                  |
| ------------- | -------- | -------- | ------------------------- |
| Investing.com | Forex    | 1        | Comprehensive forex news  |
| ForexLive     | Forex    | 1        | Real-time forex analysis  |
| DailyFX       | Forex    | 1        | Technical analysis & news |
| FXStreet      | Forex    | 2        | Currency market analysis  |

### Central Bank & Economic

| Source          | Category | Priority | Coverage                   |
| --------------- | -------- | -------- | -------------------------- |
| Federal Reserve | Macro    | 1        | Fed policy & announcements |
| ECB News        | Macro    | 1        | European Central Bank news |
| Yahoo Finance   | Markets  | 2        | General market news        |
| MarketWatch     | Markets  | 2        | Market pulse & analysis    |

## API News Sources

In addition to RSS feeds, the system can use:

### Polygon.io News API

```env
POLYGON_API_KEY=your_key
```

Provides real-time market news with ticker associations.

### Finnhub News API

```env
FINNHUB_API_KEY=your_key
```

Provides forex-focused news with category filtering.

## Testing Data Sources

Run the data source connectivity test:

```bash
npm run test:data-sources
```

This will verify:

1. All RSS feeds are accessible
2. TwelveData API is responding
3. Price quotes are being received
4. Time series data is available

## Configuration Best Practices

### Production

```env
ALLOW_SYNTHETIC_DATA=false
REQUIRE_REALTIME_DATA=true
TWELVE_DATA_API_KEY=your_real_key
```

### Development

```env
ALLOW_SYNTHETIC_DATA=true
REQUIRE_REALTIME_DATA=false
```

## Rate Limiting

The system implements intelligent rate limiting:

| Provider      | Max Requests | Window   | Cooldown   |
| ------------- | ------------ | -------- | ---------- |
| TwelveData    | 52/minute    | 60s      | 2 seconds  |
| Polygon       | 80/minute    | 60s      | 10 seconds |
| Finnhub       | 60/minute    | 60s      | 15 seconds |
| Alpha Vantage | 500/day      | 24 hours | 60 seconds |

## Caching

Price data is cached to reduce API calls:

| Timeframe | Cache TTL  |
| --------- | ---------- |
| M1        | 8 seconds  |
| M5        | 20 seconds |
| M15       | 45 seconds |
| H1        | 2 minutes  |
| H4        | 5 minutes  |
| D1        | 10 minutes |

## Troubleshooting

### No Data Received

1. Check API key is valid: `npm run validate:providers`
2. Check rate limits haven't been exceeded
3. Verify network connectivity
4. Check provider status pages

### Rate Limit Errors

The system automatically handles rate limits with exponential backoff. If you see frequent rate limit errors:

1. Reduce `PREFETCH_MAX_PER_TICK` setting
2. Increase provider cooldown times
3. Consider upgrading API plan

### RSS Feed Errors

RSS feeds use fallback URLs. If primary URL fails, Google News RSS search is used as backup.
