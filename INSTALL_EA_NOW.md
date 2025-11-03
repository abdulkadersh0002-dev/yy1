# 🎯 QUICK START: Install EA in 2 Minutes

## Your Account Details:
- **Server**: mataQuotes-Demo
- **Account**: 5042059866
- **Type**: DEMO

## 🚀 2-Minute Setup:

### Option A: Using MT4/MT5 Shortcut (EASIEST)

1. **Open your MT4 or MT5 terminal**

2. **Press `Ctrl+Shift+D`** (this opens the Data Folder)

3. **Open the "MQL4" or "MQL5" folder**

4. **Open the "Experts" folder**

5. **Copy the EA file here:**
   - For MT4: Copy `MT4_AccountDataSender.mq4` from `C:\Users\wesam\Documents\SignalsStrategy-new\`
   - For MT5: Copy `MT5_AccountDataSender.mq5` from `C:\Users\wesam\Documents\SignalsStrategy-new\`

6. **In MT4/MT5, press `F4`** (opens MetaEditor)

7. **In MetaEditor:**
   - Expand "Experts" in the left panel
   - Find "AccountDataSender"
   - Double-click to open
   - Press `F7` to compile
   - Close MetaEditor

8. **ONLY FOR MT5: Enable WebRequest**
   - Tools → Options
   - Expert Advisors tab
   - ✓ Allow WebRequest for listed URL
   - Add: `http://localhost:4101`
   - Click OK
   - **Restart MT5**

9. **Drag EA onto ANY chart**
   - In Navigator (Ctrl+N), expand "Expert Advisors"
   - Find "AccountDataSender"
   - Drag it onto any chart
   - ✓ Check "Allow live trading"
   - Click OK

10. **Check it's working:**
    - Look at "Experts" tab at bottom
    - Should see every 5 seconds:
    ```
    ✅ Account data sent successfully
       Balance: $9500.01
    ```

## ✅ DONE!

Your dashboard at http://localhost:4101 will now show REAL data from your MT4/MT5 account!

The data updates automatically every 5 seconds.

---

## 📂 File Locations:

**EA Files (Source):**
```
C:\Users\wesam\Documents\SignalsStrategy-new\
├── MT4_AccountDataSender.mq4   ← Copy this for MT4
└── MT5_AccountDataSender.mq5   ← Copy this for MT5
```

**Where to Copy (MT4):**
```
C:\Program Files\MetaTrader 4\MQL4\Experts\
└── MT4_AccountDataSender.mq4   ← Paste here
```

**Where to Copy (MT5):**
```
C:\Program Files\MetaTrader 5\MQL5\Experts\
└── MT5_AccountDataSender.mq5   ← Paste here
```

---

## 🎯 What You'll See:

### Before EA Installation:
```
Balance: $9,500.01     ← Simulated/fake data
⚠️ Install EA to get REAL data
```

### After EA Installation:
```
Balance: $9,500.01     ← REAL data from your account
✅ REAL DATA from MT4/MT5
Updating every 5 seconds...
```

---

## 💡 Important Notes:

1. **The EA only READS data** - it cannot trade
2. **No passwords are sent** - completely safe
3. **Works on localhost only** - no internet connection needed
4. **Updates every 5 seconds** - always fresh data
5. **Works with both Demo and Real accounts**

---

## 🆘 Quick Fixes:

**"WebRequest error 4060"** (MT5 only)
→ Enable WebRequest in Options (Step 8 above)

**"Server error 404"**
→ Make sure dashboard server is running: `node simple-server.cjs`

**EA shows sad face ☹️**
→ Right-click chart → Expert Advisors → Properties → ✓ Allow live trading

**No data in dashboard**
→ Check Experts tab in MT4/MT5, should see "Account data sent successfully"

---

That's it! The EA installation takes only 2 minutes and you'll have REAL account data flowing into your dashboard! 🚀
