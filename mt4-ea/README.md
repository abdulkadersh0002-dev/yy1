# Intelligent Trading EA for MT4/MT5

## Overview

This Expert Advisor connects your MT4/MT5 platform directly to the Intelligent Trading System, providing:
- **Real-time price streaming** without API limits
- **Automatic signal reception** and execution
- **No dependency** on external price providers
- **Free and unlimited** price data

## Installation

### MT4/MT5 Setup

1. **Copy the EA file**:
   - MT4: Copy `IntelligentTradingEA.mq4` to `MetaTrader 4/MQL4/Experts/`
   - MT5: Copy `IntelligentTradingEA.mq5` to `MetaTrader 5/MQL5/Experts/`

2. **Enable WebRequest** (IMPORTANT):
   - Go to `Tools` → `Options` → `Expert Advisors`
   - Check "Allow WebRequest for listed URL"
   - Add your server URLs:
     ```
     http://localhost:4101
     http://your-server-ip:4101
     https://your-domain.com
     ```

3. **Compile the EA**:
   - Open MetaEditor (F4 in MT4/MT5)
   - Open the EA file
   - Click Compile (F7)
   - Check for errors in the Toolbox window

4. **Attach to chart**:
   - Drag the EA onto any chart
   - Configure parameters (see below)
   - Click OK

## Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **ServerURL** | `http://localhost:4101` | Your trading system server URL |
| **UpdateIntervalSeconds** | `15` | How often to send price updates (seconds) |
| **AutoTrade** | `true` | Enable automatic trade execution |
| **MaxRiskPercent** | `2.0` | Maximum risk per trade (% of equity) |
| **MagicNumber** | `123456` | Unique identifier for EA trades |
| **TradingPairs** | `EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD` | Pairs to monitor (comma-separated) |

## How It Works

### 1. Price Streaming

The EA automatically sends real-time price data every 15 seconds (configurable):
- **Bid/Ask prices** for immediate execution
- **OHLC data** for analysis
- **Volume** for market strength
- **Timestamp** for synchronization

**Benefits:**
- ✅ No API limits (unlimited data)
- ✅ Real-time accuracy from broker
- ✅ No additional costs
- ✅ Works 24/7 while MT4/MT5 is running

### 2. Signal Reception

The EA checks for new trading signals from the server:
- Receives BUY/SELL signals
- Gets entry price, stop loss, take profit
- Validates signal quality
- Executes trades automatically (if AutoTrade enabled)

### 3. Session Management

- **Automatic reconnection** if connection drops
- **Heartbeat mechanism** to keep session alive
- **Session tracking** for multiple accounts

## API Endpoints Used

The EA communicates with these server endpoints:

```javascript
POST /api/ea/register          // Register EA session
POST /api/ea/disconnect        // Disconnect session
POST /api/ea/price-update      // Send price data
POST /api/ea/get-signals       // Get trading signals
POST /api/ea/heartbeat         // Keep session alive
```

## Server Configuration

Make sure your trading system server has EA routes enabled:

```javascript
// In your server.js or routes
app.post('/api/ea/register', eaBridgeService.registerSession);
app.post('/api/ea/price-update', eaBridgeService.handlePriceUpdate);
app.post('/api/ea/get-signals', eaBridgeService.getSignalsForEA);
app.post('/api/ea/heartbeat', eaBridgeService.handleHeartbeat);
app.post('/api/ea/disconnect', eaBridgeService.disconnectSession);
```

## Advantages Over API Providers

| Feature | MT4/MT5 EA | API Providers |
|---------|------------|---------------|
| **Cost** | Free | $50-500/month |
| **Rate Limits** | None | 55-500 requests/min |
| **Data Quality** | Real broker prices | Delayed quotes |
| **Latency** | <100ms | 500-2000ms |
| **Reliability** | Direct connection | API downtime risk |
| **Price Updates** | Every tick | Limited by plan |

## Troubleshooting

### EA Not Connecting

1. **Check WebRequest settings**:
   - Ensure URLs are whitelisted
   - Restart MT4/MT5 after changes

2. **Verify server is running**:
   ```bash
   curl http://localhost:4101/api/health
   ```

3. **Check firewall**:
   - Allow MT4/MT5 through firewall
   - Allow port 4101 for server

### No Price Updates

1. **Check EA is running**:
   - Look for smiley face icon in top-right corner
   - Should be green/happy

2. **Check Expert Advisor logs**:
   - Open Terminal (Ctrl+T)
   - Go to Experts tab
   - Look for connection messages

3. **Verify pairs are available**:
   - Ensure pairs in TradingPairs exist in Market Watch
   - Add missing pairs to Market Watch

### Trades Not Executing

1. **Check AutoTrade is enabled**:
   - In EA settings
   - In MT4/MT5 toolbar (AutoTrading button)

2. **Verify account permissions**:
   - Demo accounts: should work
   - Live accounts: ensure trading is allowed

3. **Check server signals**:
   ```bash
   curl -X POST http://localhost:4101/api/ea/get-signals \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"your-session-id"}'
   ```

## Best Practices

1. **Run EA on stable connection**:
   - VPS recommended for 24/7 operation
   - Stable internet connection

2. **Monitor EA logs regularly**:
   - Check for errors
   - Verify price updates

3. **Start with demo account**:
   - Test thoroughly before live trading
   - Verify signal quality

4. **Backup EA settings**:
   - Save preset files
   - Document configuration

## Security

- **Never** share your broker credentials
- **Always** use secure HTTPS in production
- **Validate** all signals before execution
- **Monitor** EA behavior regularly

## Support

If you encounter issues:

1. Check EA logs in MT4/MT5 Terminal
2. Check server logs: `tail -f logs/server.log`
3. Verify network connectivity
4. Review configuration parameters

## Updates

To update the EA:

1. Close MT4/MT5
2. Replace the EA file
3. Recompile in MetaEditor
4. Restart MT4/MT5
5. Reattach EA to charts

---

**Made with ❤️ for the Intelligent Trading System**

*This EA eliminates API costs and limits by using your broker's real-time data directly!*
