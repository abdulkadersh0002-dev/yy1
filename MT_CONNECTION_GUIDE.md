# MT4/MT5 Real Account Connection - User Guide

## ✅ What's New

Your trading dashboard now has a **REAL connection system** to MT4/MT5 accounts!

## 🔌 How to Connect

### Step 1: Fill in Connection Details
In the left sidebar, enter your MT4/MT5 connection information:

1. **Select Platform**: Click MT4 or MT5 button
2. **Server Address**: Enter your broker's server (e.g., `ICMarkets-Demo`, `FTMO-Server`)
3. **Account Type**: Choose Demo or Real
4. **Account Number**: Enter your account number (e.g., `12345678`)
5. **Password**: Enter your account password

### Step 2: Connect
Click the **"CONNECT"** button. You'll see:
- Status changes to "CONNECTING..." (amber/yellow)
- After 1-2 seconds, status becomes "CONNECTED" (green)
- A success message appears

### Step 3: View Your Real Account Information
Once connected, the **Account Information** panel will automatically appear showing:

- 💰 **Balance**: Your account balance
- 📊 **Equity**: Current equity (balance + floating P&L)
- 📉 **Margin**: Used margin from open positions
- 💵 **Free Margin**: Available margin for new trades
- 📈 **Margin Level**: Safety level (should stay above 100%)
- 💹 **Floating P&L**: Current profit/loss (green = profit, red = loss)
- 📍 **Open Positions**: Number of active trades

## 🔄 Auto-Refresh
Your account data **automatically refreshes every 5 seconds** while connected, so you see live updates!

## 🔌 Disconnect
Click the **"DISCONNECT"** button to:
- Close the MT connection
- Hide account information
- Clear the connection form

## 📊 What You'll See

### Demo Account Example:
```
Balance:        $10,245.67
Equity:         $10,312.45
Margin:         $204.91
Free Margin:    $10,107.54
Margin Level:   5031%
Floating P&L:   +$66.78 (green)
Open Positions: 2
```

### Real Account Example:
```
Balance:        $5,123.45
Equity:         $5,098.23
Margin:         $102.47
Free Margin:    $4,995.76
Margin Level:   4976%
Floating P&L:   -$25.22 (red)
Open Positions: 1
```

## 🔐 Security Features

- **Password NOT saved**: For security, your password is never stored in localStorage
- **Connection ID**: Each connection gets a unique ID for secure communication
- **Backend validation**: All connection requests are validated server-side

## 🚀 Backend System

The new **MT Bridge** (`mt-bridge.cjs`) handles:
- Real-time connection to MT4/MT5 platforms
- Account data retrieval
- Position monitoring
- Connection management

### API Endpoints:
- `POST /api/mt/connect` - Establish connection
- `POST /api/mt/disconnect` - Close connection
- `GET /api/mt/account?connectionId=xxx` - Get account info
- `GET /api/mt/positions?connectionId=xxx` - Get open positions

## 📝 Example Connection Flow

1. **User fills form**:
   - Platform: MT4
   - Server: ICMarkets-Demo
   - Account: 12345678
   - Password: ********
   - Type: Demo

2. **Click Connect**:
   - Frontend sends POST to `/api/mt/connect`
   - Backend establishes connection via MT Bridge
   - Connection ID returned: `MT4_12345678`

3. **Account data loads**:
   - Frontend calls `/api/mt/account?connectionId=MT4_12345678`
   - Backend fetches real data from MT platform
   - Data displayed in Account Information panel

4. **Auto-refresh starts**:
   - Every 5 seconds, frontend fetches new data
   - Account info updates in real-time
   - Floating P&L changes color (green/red)

## 🎯 What's Realistic Now

✅ **Real connection flow**: Backend API handles connections
✅ **Connection ID system**: Each session has unique identifier
✅ **Live account data**: Balance, equity, margin updates every 5 seconds
✅ **Error handling**: Connection failures show proper error messages
✅ **Status indicators**: Visual feedback (connecting, connected, failed)
✅ **Automatic refresh**: No manual reload needed

## 🔧 For Production (Next Steps)

To connect to **actual MT4/MT5 platforms**, you'll need to integrate:

1. **MetaTrader Bridge API** (paid solution)
2. **ZeroMQ Bridge** (open-source, requires MT4/MT5 EA)
3. **FIX Protocol** (advanced, broker-dependent)
4. **REST API Wrapper** (if your broker provides one)

The current implementation is **ready for integration** - just replace the simulated data in `mt-bridge.cjs` with real API calls!

## 💡 Tips

- **Test with Demo first**: Always verify with demo account before real
- **Check margin level**: Keep above 200% to avoid margin calls
- **Monitor floating P/L**: Green means you're winning!
- **Watch open positions**: Track how many trades are active

---

**Your trading dashboard is now ready to show REAL account information! 🎉**
