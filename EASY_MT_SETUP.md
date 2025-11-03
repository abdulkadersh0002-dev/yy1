# 🚀 Easy MT4/MT5 EA Setup - Get REAL Account Data

## ✅ Simple 3-Step Setup

### Step 1: Start Your Dashboard Server
```powershell
node simple-server.cjs
```

You should see:
```
🚀 AI Trading Signals Server
📊 Server: http://localhost:4101
⚡ Real-time signal generation active
🤖 Multi-layer analysis engine running
[MT WebSocket] 🚀 Server running on ws://localhost:8765
[MT WebSocket] 📡 Ready to receive data from MT4/MT5 EAs
```

### Step 2: Install the EA in MT4/MT5

#### For MT4:
1. Copy `MT4_AccountDataSender.mq4` to: `C:\Program Files\MetaTrader 4\MQL4\Experts\`
2. Open MT4 MetaEditor (F4)
3. Find "AccountDataSender.mq4" in Experts folder
4. Click "Compile" (F7)
5. Drag the EA onto any chart

#### For MT5:
1. Copy `MT5_AccountDataSender.mq5` to: `C:\Program Files\MetaTrader 5\MQL5\Experts\`
2. Open MT5 MetaEditor
3. Find "AccountDataSender.mq5" in Experts folder
4. Click "Compile" (F7)
5. **IMPORTANT**: Before running, enable WebRequest:
   - Tools → Options → Expert Advisors
   - ✓ Check "Allow WebRequest for listed URL"
   - Add this URL: `http://localhost:4101`
   - Click OK
6. Drag the EA onto any chart

### Step 3: Check It's Working

#### In MT4/MT5 Terminal (Experts tab), you should see:
```
=== Account Data Sender EA Started (MT5) ===
Server: http://localhost:4101/api/mt/ea-update
Update Interval: 5 seconds
⚠️ Make sure to enable WebRequest for: http://localhost:4101
✅ Account data sent successfully
   Account: 12345678 (demo)
   Balance: $10000.00
   Equity: $10045.67
   P/L: $45.67
   Margin Level: 5234.56%
   Open Positions: 2
```

#### In Your Dashboard Server Console:
```
[EA Update] 📊 Received data from EA
   Account: 12345678 (demo)
   Platform: MT5
   Balance: $10000 | Equity: $10045.67
   P/L: $45.67 | Positions: 2
```

#### In Your Browser Dashboard:
- Open http://localhost:4101
- The Account Information panel will automatically show REAL data from your EA
- Updates every 5 seconds

## 📊 What You'll See (REAL DATA)

```
Account Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Balance:        $10,000.00      ← Your REAL balance
Equity:         $10,045.67      ← Your REAL equity
Margin:         $200.50         ← Your REAL margin used
Free Margin:    $9,845.17       ← Your REAL free margin
Margin Level:   5012%           ← Your REAL margin level
Floating P&L:   +$45.67 ✅      ← Your REAL profit/loss
Open Positions: 2               ← Your REAL open trades
```

## 🔧 EA Settings

You can customize the EA settings when you attach it to the chart:

- **ServerURL**: `http://localhost:4101/api/mt/ea-update` (default - don't change)
- **UpdateInterval**: `5` seconds (how often to send data - you can change to 1, 3, 10, etc.)

## ✅ Verification Checklist

- [ ] Dashboard server running on port 4101
- [ ] WebSocket server running on port 8765
- [ ] EA compiled successfully in MetaEditor
- [ ] MT5: WebRequest enabled for http://localhost:4101
- [ ] EA attached to a chart with "Allow live trading" enabled
- [ ] EA showing "✅ Account data sent successfully" in Experts tab
- [ ] Server console showing "[EA Update] 📊 Received data from EA"
- [ ] Browser dashboard showing real account data

## 🎯 What Data is Sent (100% Real)

Your EA sends this real data every 5 seconds:
- ✅ Account Number
- ✅ Account Type (Demo/Real)
- ✅ Platform (MT4/MT5)
- ✅ Balance
- ✅ Equity
- ✅ Margin
- ✅ Free Margin
- ✅ Margin Level
- ✅ Floating P&L
- ✅ Number of Open Positions
- ✅ Broker Name
- ✅ Account Currency
- ✅ Leverage

## 🔒 Security

- ✅ All communication happens on localhost (127.0.0.1)
- ✅ No passwords are sent
- ✅ Data stays on your computer
- ✅ No external connections
- ✅ Works with both demo and real accounts

## 🐛 Troubleshooting

### Problem: EA shows "WebRequest error: 4060"
**Solution**: You didn't enable WebRequest in MT5
1. Tools → Options → Expert Advisors
2. ✓ Allow WebRequest for listed URL
3. Add: `http://localhost:4101`
4. Restart MT5

### Problem: EA shows "Server error. Response code: 404"
**Solution**: Dashboard server is not running
1. Open PowerShell in project folder
2. Run: `node simple-server.cjs`
3. Wait for "Server running" message
4. Try again

### Problem: Dashboard shows "Failed to fetch account data"
**Solution**: 
1. Make sure EA is running and sending data
2. Check MT4/MT5 Experts tab for "✅ Account data sent successfully"
3. Check server console for "[EA Update] 📊 Received data from EA"
4. If not working, restart both server and EA

### Problem: Data not updating
**Solution**:
1. Check if EA is still running (green arrow in top-right of chart)
2. Check UpdateInterval setting (default is 5 seconds)
3. Look at Experts tab - should show updates every 5 seconds
4. Refresh browser page

## 💡 Pro Tips

1. **Attach EA to any chart**: It doesn't matter which pair/timeframe
2. **One EA per account**: Only need one EA running to send all account data
3. **Works with multiple charts**: EA keeps running even if you switch charts
4. **Demo first**: Test with demo account before using with real account
5. **Keep terminal open**: EA stops when MT4/MT5 is closed

## 🎉 That's It!

You now have REAL account data flowing from your MT4/MT5 into your dashboard!

**No complex DLLs, no external services, no paid APIs - just a simple EA sending HTTP requests!**

---

## 📝 Technical Details (For Advanced Users)

### How It Works:
1. EA reads real account data using MetaTrader built-in functions
2. EA builds a JSON payload with all account information
3. EA sends HTTP POST request to `http://localhost:4101/api/mt/ea-update`
4. Server receives and stores the data
5. Dashboard fetches and displays the data every 5 seconds

### Communication Flow:
```
MT4/MT5 Terminal
      ↓ (every 5 seconds)
   Your EA
      ↓ (HTTP POST with JSON)
Dashboard Server (Port 4101)
      ↓ (stores in memory)
Your Browser
      ↓ (fetches every 5 seconds)
Account Information Panel
```

### Data Format (JSON):
```json
{
  "type": "account_update",
  "account": "12345678",
  "accountType": "demo",
  "platform": "MT5",
  "balance": 10000.00,
  "equity": 10045.67,
  "margin": 200.50,
  "freeMargin": 9845.17,
  "marginLevel": 5012.34,
  "profit": 45.67,
  "openPositions": 2,
  "broker": "ICMarkets",
  "currency": "USD",
  "leverage": "1:500",
  "timestamp": "2025-11-02 14:30:45"
}
```

---

**Need help? Check the Experts tab in MT4/MT5 - the EA prints detailed logs!**
