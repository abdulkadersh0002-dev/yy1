# 🎯 GET REAL MT4/MT5 ACCOUNT DATA - STEP BY STEP

## Current Status:
✅ Server is running
✅ Connection system is ready
✅ WebSocket is listening for EA data
⚠️ **Need to install EA in MT4/MT5 to get REAL DATA**

---

## 🔴 IMPORTANT: The Only Way to Get REAL Account Data

Your dashboard is now connected to **`mataQuotes-Demo`** server with account **`5042059866`**.

However, to show **REAL** balance, equity, and P/L from your actual MT4/MT5 terminal, you MUST:

### ✅ Install the Expert Advisor (EA) in Your MT4/MT5

**Why EA is needed:**
- MT4/MT5 doesn't allow direct external connections for security
- The EA runs INSIDE your terminal and has access to REAL account data
- EA sends your REAL data to the dashboard every 5 seconds via HTTP

---

## 📋 STEP-BY-STEP INSTALLATION:

### Step 1: Locate the EA File

Based on your platform:
- **MT4**: Use file `MT4_AccountDataSender.mq4`
- **MT5**: Use file `MT5_AccountDataSender.mq5`

Both files are in: `C:\Users\wesam\Documents\SignalsStrategy-new\`

### Step 2: Copy EA to MT4/MT5 Experts Folder

#### For MT4:
1. Open File Explorer
2. Copy `MT4_AccountDataSender.mq4`
3. Go to: `C:\Program Files\MetaTrader 4\MQL4\Experts\`
   (or wherever your MT4 is installed)
4. Paste the file there

#### For MT5:
1. Open File Explorer
2. Copy `MT5_AccountDataSender.mq5`
3. Go to: `C:\Program Files\MetaTrader 5\MQL5\Experts\`
   (or wherever your MT5 is installed)
4. Paste the file there

**OR** use the shortcut:
- Open MT4/MT5
- Press `Ctrl+Shift+D` (opens Data Folder)
- Navigate to `MQL4\Experts` or `MQL5\Experts`
- Paste the EA file there

### Step 3: Compile the EA

1. Open MT4/MT5 terminal
2. Press `F4` to open MetaEditor
3. In Navigator panel (left side), expand "Experts"
4. Find `AccountDataSender` 
5. Double-click to open it
6. Press `F7` to compile
7. Wait for "0 errors, 0 warnings" message
8. Close MetaEditor

### Step 4: Enable WebRequest (MT5 ONLY!)

⚠️ **CRITICAL for MT5 users:**

1. In MT5, go to: **Tools → Options**
2. Click **"Expert Advisors"** tab
3. ✓ Check **"Allow WebRequest for listed URL:"**
4. In the box below, add: `http://localhost:4101`
5. Click **OK**
6. **Restart MT5**

### Step 5: Attach EA to Chart

1. In MT4/MT5, open **ANY** chart (doesn't matter which pair)
2. In Navigator panel (Ctrl+N), expand "Expert Advisors"
3. Find `AccountDataSender`
4. **Drag and drop** it onto the chart
5. A settings window appears:
   - ✓ Check "Allow live trading"
   - ✓ Check "Allow DLL imports" (if available)
   - Click **OK**
6. You should see a **smiling face icon** 😊 in top-right corner of chart

### Step 6: Verify It's Working

#### In MT4/MT5 Terminal:
1. Click **"Experts"** tab at the bottom
2. You should see every 5 seconds:
```
✅ Account data sent successfully
   Account: 5042059866 (demo)
   Balance: $9500.01
   Equity: $9500.01
   P/L: $0.00
   Margin Level: ∞%
   Open Positions: 0
```

#### In Server Console (PowerShell):
You should see:
```
[EA Update] 📊 Received data from EA
   Account: 5042059866 (demo)
   Platform: MT5
   Balance: $9500.01 | Equity: $9500.01
   P/L: $0.00 | Positions: 0
```

#### In Your Browser Dashboard:
1. Go to http://localhost:4101
2. The **Account Information** panel will show YOUR REAL DATA
3. Balance, Equity, P/L will update every 5 seconds with REAL values

---

## ✅ CHECKLIST:

Before contacting support, verify:

- [ ] Dashboard server is running (`node simple-server.cjs`)
- [ ] EA file copied to correct Experts folder
- [ ] EA compiled successfully (F7 in MetaEditor, 0 errors)
- [ ] (MT5 only) WebRequest enabled for `http://localhost:4101`
- [ ] EA attached to a chart
- [ ] Smiling face 😊 visible on chart (EA is running)
- [ ] "Allow live trading" is checked
- [ ] Experts tab shows "Account data sent successfully"
- [ ] Server console shows "[EA Update] Received data from EA"

---

## 🐛 TROUBLESHOOTING:

### ❌ Problem: "WebRequest error: 4060"
**Platform**: MT5 only
**Cause**: WebRequest not enabled
**Solution**:
1. Tools → Options → Expert Advisors
2. ✓ Allow WebRequest for listed URL
3. Add: `http://localhost:4101`
4. **Restart MT5**

### ❌ Problem: EA shows sad face ☹️
**Cause**: EA has an error or "Allow live trading" not checked
**Solution**:
1. Right-click chart → Expert Advisors → Properties
2. ✓ Check "Allow live trading"
3. Click OK
4. If still sad, check Experts tab for error messages

### ❌ Problem: "Server error. Response code: 404"
**Cause**: Dashboard server not running
**Solution**:
1. Open PowerShell in `C:\Users\wesam\Documents\SignalsStrategy-new\`
2. Run: `node simple-server.cjs`
3. Wait for "Server running" message
4. EA will automatically retry

### ❌ Problem: Dashboard shows "Waiting for EA"
**Cause**: EA not sending data yet
**Solution**:
1. Check MT4/MT5 Experts tab
2. Should see "Account data sent successfully" every 5 seconds
3. If not, restart EA (remove from chart and drag back)
4. Check server is running on http://localhost:4101

### ❌ Problem: Wrong account data showing
**Cause**: Multiple MT terminals open or wrong account
**Solution**:
1. Make sure EA is attached in the correct MT terminal
2. Verify account number matches: 5042059866
3. Verify server matches: mataQuotes-Demo
4. Close other MT terminals if any

---

## 🎉 SUCCESS!

Once working, you'll see:

### Dashboard:
```
💰 Account Information
━━━━━━━━━━━━━━━━━━━━
✅ REAL DATA from MT4/MT5

Balance:        $9,500.01
Equity:         $9,500.01
Margin:         $0.00
Free Margin:    $9,500.01
Margin Level:   ∞
Floating P&L:   +$0.00
Open Positions: 0
```

### Console:
```
📊 Data Source: ✅ REAL DATA from MT4/MT5
```

---

## 📞 Need Help?

1. Check the Experts tab in MT4/MT5 for error messages
2. Check PowerShell console for server errors
3. Make sure account 5042059866 is logged in
4. Make sure server mataQuotes-Demo is connected
5. Try restarting both MT4/MT5 and the dashboard server

**Your data will be 100% REAL once EA is installed!** 🚀
