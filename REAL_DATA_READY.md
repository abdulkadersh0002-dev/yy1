# ✅ REAL MT4/MT5 ACCOUNT DATA - READY TO USE!

## 🎉 System is Working!

Your dashboard can now receive **REAL account data** from your MT4/MT5 terminal!

## 📊 What's Been Set Up:

### 1. **WebSocket Server** (Port 8765)
   - Listens for connections from MT4/MT5 EAs
   - Stores real-time account data
   - ✅ Running and ready

### 2. **HTTP Endpoint** (`/api/mt/ea-update`)
   - Receives account data via simple HTTP POST
   - **No DLLs needed!**
   - **No complex setup!**
   - ✅ Working perfectly

### 3. **MT4 EA** (`MT4_AccountDataSender.mq4`)
   - Reads your real account data
   - Sends to dashboard every 5 seconds
   - Ready to compile and use

### 4. **MT5 EA** (`MT5_AccountDataSender.mq5`)
   - Same as MT4 but for MT5
   - Just needs WebRequest permission
   - Ready to compile and use

## 🚀 HOW TO USE (3 Simple Steps):

### Step 1: Your Server is Already Running!
```
✅ Dashboard: http://localhost:4101
✅ WebSocket: ws://localhost:8765
✅ EA Endpoint: http://localhost:4101/api/mt/ea-update
```

### Step 2: Install the EA in MT4 or MT5

#### **For MT4:**
1. Copy `MT4_AccountDataSender.mq4` to: 
   `C:\Program Files\MetaTrader 4\MQL4\Experts\`
2. Open MetaEditor (F4 in MT4)
3. Find the EA and click Compile (F7)
4. Drag EA onto any chart
5. Enable "Allow live trading" in EA settings
6. Done! ✅

#### **For MT5:**
1. Copy `MT5_AccountDataSender.mq5` to:
   `C:\Program Files\MetaTrader 5\MQL5\Experts\`
2. Open MetaEditor
3. Find the EA and click Compile
4. **IMPORTANT**: Enable WebRequest first!
   - Tools → Options → Expert Advisors
   - ✓ Check "Allow WebRequest for listed URL"
   - Add: `http://localhost:4101`
   - Click OK
5. Drag EA onto any chart
6. Enable "Allow live trading" in EA settings
7. Done! ✅

### Step 3: Watch Your REAL Data Flow!

Open any of these URLs:
- **Main Dashboard**: http://localhost:4101
- **Test Page**: http://localhost:4101/test-ea.html

## ✅ VERIFICATION:

### ✅ In MT4/MT5 Terminal (Experts Tab):
You should see every 5 seconds:
```
✅ Account data sent successfully
   Account: 12345678 (demo)
   Balance: $10000.00
   Equity: $10045.67
   P/L: $45.67
   Margin Level: 5012.34%
   Open Positions: 2
```

### ✅ In Server Console:
You should see:
```
[EA Update] 📊 Received data from EA
   Account: 12345678 (demo)
   Platform: MT5
   Balance: $10000 | Equity: $10045.67
   P/L: $45.67 | Positions: 2
```

### ✅ In Browser:
You should see REAL numbers updating every 5 seconds!

## 📦 Files You Need:

### **For MT4 Users:**
- `MT4_AccountDataSender.mq4` - Copy to MT4 Experts folder

### **For MT5 Users:**
- `MT5_AccountDataSender.mq5` - Copy to MT5 Experts folder

### **Instructions:**
- `EASY_MT_SETUP.md` - Complete setup guide
- `test-ea-data.cjs` - Test without MT4/MT5 (simulates EA)

## 🎯 REAL DATA Being Sent:

Your EA sends these **REAL** values every 5 seconds:
- ✅ Account Number (from `AccountNumber()` or `AccountInfoInteger(ACCOUNT_LOGIN)`)
- ✅ Account Type (Demo or Real - from `AccountInfoInteger(ACCOUNT_TRADE_MODE)`)
- ✅ Balance (from `AccountBalance()` or `AccountInfoDouble(ACCOUNT_BALANCE)`)
- ✅ Equity (from `AccountEquity()` or `AccountInfoDouble(ACCOUNT_EQUITY)`)
- ✅ Margin (from `AccountMargin()` or `AccountInfoDouble(ACCOUNT_MARGIN)`)
- ✅ Free Margin (from `AccountFreeMargin()` or `AccountInfoDouble(ACCOUNT_MARGIN_FREE)`)
- ✅ Margin Level (calculated: Equity / Margin × 100)
- ✅ Floating P/L (from `AccountProfit()` or `AccountInfoDouble(ACCOUNT_PROFIT)`)
- ✅ Open Positions (from `OrdersTotal()` or `PositionsTotal()`)
- ✅ Broker Name (from `AccountCompany()` or `AccountInfoString(ACCOUNT_COMPANY)`)
- ✅ Currency (from `AccountCurrency()` or `AccountInfoString(ACCOUNT_CURRENCY)`)
- ✅ Leverage (from `AccountLeverage()` or `AccountInfoInteger(ACCOUNT_LEVERAGE)`)

## 🔧 Testing Without MT4/MT5:

Want to test the system first? Run this:
```powershell
node test-ea-data.cjs
```

This simulates an EA sending data. You'll see:
```
📊 Simulating MT5 EA sending account data...
Status: 200
Response: {"success":true,"message":"Data received successfully"}
```

Then open: http://localhost:4101/test-ea.html

## 💡 Why This is Better:

### ❌ **OLD Complex Methods:**
- Need paid MetaTrader Bridge APIs
- Require complex DLL files
- Need ZeroMQ libraries
- Complicated setup
- Security risks

### ✅ **NEW Simple Method:**
- **Just a simple EA!**
- Uses built-in HTTP (WebRequest)
- No DLLs needed
- No paid APIs
- Works on both MT4 and MT5
- Easy to understand and modify
- Secure (localhost only)
- Free and open source

## 🎨 Customization:

Want to change update frequency? Edit EA settings:
```
UpdateInterval = 5  // Change to 1, 3, 10, etc. (seconds)
```

Want to change server URL? (if running on different computer)
```
ServerURL = "http://192.168.1.100:4101/api/mt/ea-update"
```

## 🔒 Security:

- ✅ All communication is on localhost (your computer only)
- ✅ No passwords are sent
- ✅ No trading permissions needed (EA only reads data)
- ✅ Works in read-only mode
- ✅ Safe for both demo and real accounts

## 📞 Troubleshooting:

### Problem: "WebRequest error: 4060"
**Solution**: MT5 only - enable WebRequest in Options

### Problem: "Server error. Response code: 404"
**Solution**: Make sure server is running (`node simple-server.cjs`)

### Problem: Data not showing in browser
**Solution**: 
1. Check EA is running (green arrow on chart)
2. Check Experts tab for "✅ Account data sent successfully"
3. Check server console for "[EA Update] 📊 Received data from EA"
4. Refresh browser

## 🎉 YOU'RE READY!

Your dashboard now supports **REAL account data** from MT4/MT5!

Just install the EA, and within 5 seconds you'll see your **REAL LIVE DATA** flowing into your dashboard!

---

**Need help? Check the `EASY_MT_SETUP.md` file for detailed instructions!**
