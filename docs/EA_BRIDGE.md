# Intelligent EA Bridge - MT4/MT5 Integration

## Overview

The Enhanced EA Bridge provides intelligent, AI-powered integration between MT4/MT5 Expert Advisors and the trading system. Features include:

- **🤖 Intelligent Learning**: AI learns from trade results and adjusts risk/stop-loss dynamically
- **📊 Dynamic Risk Management**: Automatically reduces risk after losses, increases after wins
- **🎯 Adaptive Stop-Loss**: ATR-based stop-loss with learning factor adjustment
- **📈 Auto-Trading**: Fully automated trade execution with signal generation
- **📡 Real-Time Communication**: WebSocket-based bidirectional communication
- **🔒 Secure**: Token-based authentication and encrypted communication

## Features

### 1. AI Learning System
- Tracks win rate, average profit/loss
- Adjusts risk multiplier based on consecutive wins/losses
- Adapts stop-loss factor based on performance
- Learns from mistakes and improves over time

### 2. Dynamic Risk Management
- Reduces position size after consecutive losses
- Gradually increases risk after wins
- Automatic trading pause after severe losses
- Smart position sizing based on account equity

### 3. Intelligent Stop-Loss
- ATR-based dynamic stop-loss calculation
- Trailing stop implementation
- Learning-adjusted stop-loss distance
- 2:1 risk/reward ratio by default

### 4. Auto-Trading
- Automatic signal generation and execution
- Configurable check intervals
- Integration with trading engine signals
- Real-time position monitoring

## Installation

### Step 1: Download EA Files

EA files are located in `clients/neon-dashboard/public/eas/`:
- `SignalBridge-MT4.mq4` - For MetaTrader 4
- `SignalBridge-MT5.mq5` - For MetaTrader 5

### Step 2: Install in MT4/MT5

1. Open MT4/MT5 terminal
2. Click **File → Open Data Folder**
3. Navigate to `MQL4/Experts` (MT4) or `MQL5/Experts` (MT5)
4. Copy the EA file to this directory
5. Restart MT4/MT5 terminal
6. EA will appear in Navigator under "Expert Advisors"

### Step 3: Configure EA Parameters

#### Connection Settings
```
BridgeUrl = "http://localhost:4101/api/broker/bridge/mt4"  // or mt5
ApiToken = "your-secure-token-here"
ForceReconnect = true
HeartbeatInterval = 30  // seconds
RequestTimeoutMs = 7000
```

#### Auto-Trading Settings
```
EnableAutoTrading = true
RiskPercentage = 2.0     // % of equity to risk per trade
MagicNumber = 87001
Slippage = 10
```

#### Intelligent Features
```
UseDynamicStopLoss = true   // Enable ATR-based stop-loss
EnableLearning = true        // Enable AI learning
MaxLotSize = 1.0
MinLotSize = 0.01
```

### Step 4: Attach EA to Chart

1. Drag EA from Navigator onto a chart
2. In EA settings, configure the parameters above
3. Click **OK**
4. Enable "Auto Trading" button in MT4/MT5 toolbar
5. EA will connect to the server automatically

### Step 5: Verify Connection

Check the EA is connected:
- **MT4/MT5 Journal**: Should show "Bridge session registered"
- **Dashboard**: Visit the EA Bridge Control panel
- **API**: GET `/api/broker/bridge/sessions`

## API Endpoints

### Session Management

**POST** `/api/broker/bridge/mt4/session/connect`
```json
{
  "accountMode": "demo",
  "accountNumber": "12345",
  "equity": 10000,
  "balance": 10000,
  "server": "MetaQuotes-Demo",
  "currency": "USD"
}
```

**POST** `/api/broker/bridge/mt4/session/disconnect`

### Trading

**GET** `/api/broker/bridge/mt4/signal/get?symbol=EURUSD`
Returns intelligent signal with learning-adjusted parameters.

**POST** `/api/broker/bridge/mt4/agent/transaction`
```json
{
  "type": "HISTORY_ADD",
  "ticket": 123456,
  "symbol": "EURUSD",
  "volume": 0.1,
  "profit": 25.50,
  "timestamp": 1638360000
}
```

### Monitoring

**GET** `/api/broker/bridge/statistics`
Returns EA bridge statistics and learning metrics.

**GET** `/api/broker/bridge/sessions`
Returns active EA sessions.

## Learning Algorithm

### Risk Adjustment
```
After 3+ consecutive losses: Risk × 0.8 (max 0.5)
After 3+ consecutive wins: Risk × 1.1 (max 1.5)
Otherwise: Slowly return to 1.0
```

### Stop-Loss Adjustment
```
Win rate < 40%: SL × 0.95 (tighten, max 0.7)
Win rate > 60%: SL × 1.05 (widen, max 1.3)
```

### Trading Pause
- Automatic pause after 6+ consecutive losses
- Manual resume required

## Dashboard Integration

The EA Bridge Control component provides:
- Real-time session monitoring
- Auto-trading toggle button
- AI learning metrics display
- Connection status for each broker
- Setup instructions

Add to your dashboard:
```jsx
import EaBridgeControl from './components/EaBridgeControl';

<EaBridgeControl />
```

## Security Considerations

1. **API Token**: Always use a strong, unique token
2. **HTTPS**: Use HTTPS in production (configure BridgeUrl)
3. **Firewall**: Restrict access to bridge endpoints
4. **MT4/MT5 Settings**: Enable URL whitelist in terminal settings

### MT4/MT5 URL Whitelist

Tools → Options → Expert Advisors:
- ☑ Allow WebRequest for listed URLs
- Add: `http://localhost:4101`
- Add: `https://yourdomain.com` (production)

## Troubleshooting

### EA Not Connecting

1. Check BridgeUrl is correct
2. Verify ApiToken matches server configuration
3. Check URL is in MT4/MT5 whitelist
4. Check server is running: `http://localhost:4101/api/healthz`
5. Check EA logs in MT4/MT5 Journal tab

### No Trades Executing

1. Verify `EnableAutoTrading = true` in EA settings
2. Check Auto Trading button is enabled in MT4/MT5
3. Verify trading signals are being generated
4. Check learning metrics - trading may be paused after losses
5. Review MT4/MT5 Journal for error messages

### Learning Not Working

1. Ensure `EnableLearning = true`
2. Check trades are being reported (OnTrade event)
3. Verify transactions appear in bridge statistics
4. Check EA logs for learning parameter updates

## Advanced Configuration

### Custom Risk Models

Modify `CalculateLotSize()` in EA code:
```mql4
double CalculateLotSize()
{
   double riskAmount = AccountEquity() * (RiskPercentage / 100.0);
   // Custom risk calculation here
   return lots;
}
```

### Custom Stop-Loss Logic

Modify `CalculateDynamicStopLoss()`:
```mql4
double CalculateDynamicStopLoss(string direction)
{
   double atr = iATR(Symbol(), 0, 14, 0);
   double slDistance = atr * 2.0 * g_stopLossMultiplier;
   // Custom SL logic here
   return slPrice;
}
```

## Performance Monitoring

Monitor EA performance through:
1. Dashboard EA Bridge Control panel
2. `/api/broker/bridge/statistics` endpoint
3. MT4/MT5 strategy tester
4. Trade history analysis

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review server logs
3. Check MT4/MT5 Journal tab
4. Create an issue on GitHub

## License

MIT License - See main project LICENSE file
