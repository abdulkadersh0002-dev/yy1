//+------------------------------------------------------------------+
//|                                      AccountDataSender.mq5       |
//|            Send Account Data & Receive Signals for Auto-Trading  |
//+------------------------------------------------------------------+
#property copyright "Trading Signals Dashboard"
#property version   "2.00"

// Server Settings
input string ServerURL = "http://localhost:4101";                    // Server URL
input int UpdateInterval = 5;                                         // Update interval in seconds
input bool AutoTrade = true;                                          // Enable auto-trading from dashboard signals
input double RiskPercent = 2.0;                                       // Risk per trade (% of balance)
input int MagicNumber = 123456;                                       // Magic number for EA trades

// Global Variables
datetime lastUpdate = 0;
datetime lastSignalCheck = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    Print("=== Trading Signals EA Started (MT5) ===");
    Print("Server: ", ServerURL);
    Print("Update Interval: ", UpdateInterval, " seconds");
    Print("Auto-Trade: ", AutoTrade ? "ENABLED ✅" : "DISABLED ❌");
    Print("Risk Per Trade: ", RiskPercent, "%");
    
    // Important: Add this URL to allowed URLs in MT5
    // Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL
    Print("⚠️ Make sure to enable WebRequest for: ", ServerURL);
    
    if(AutoTrade)
    {
        Print("🤖 Auto-trading is ACTIVE - EA will execute signals from dashboard!");
    }
    
    return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    Print("=== Trading Signals EA Stopped ===");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    // Send account data every X seconds
    if(TimeCurrent() - lastUpdate >= UpdateInterval)
    {
        SendAccountData();
        lastUpdate = TimeCurrent();
    }
    
    // Check for new signals every 2 seconds (if auto-trade enabled)
    if(AutoTrade && TimeCurrent() - lastSignalCheck >= 2)
    {
        CheckForNewSignals();
        lastSignalCheck = TimeCurrent();
    }
}

//+------------------------------------------------------------------+
//| Send Account Data to Server                                      |
//+------------------------------------------------------------------+
void SendAccountData()
{
    // Collect account information
    long accountNumber = AccountInfoInteger(ACCOUNT_LOGIN);
    string accountType = AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "demo" : "real";
    double balance = AccountInfoDouble(ACCOUNT_BALANCE);
    double equity = AccountInfoDouble(ACCOUNT_EQUITY);
    double margin = AccountInfoDouble(ACCOUNT_MARGIN);
    double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
    double marginLevel = margin > 0 ? (equity / margin * 100) : 0;
    double profit = AccountInfoDouble(ACCOUNT_PROFIT);
    int openPositions = PositionsTotal();
    string broker = AccountInfoString(ACCOUNT_COMPANY);
    string currency = AccountInfoString(ACCOUNT_CURRENCY);
    long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
    
    // Build JSON payload
    string json = "{";
    json += "\"type\":\"account_update\",";
    json += "\"account\":\"" + IntegerToString(accountNumber) + "\",";
    json += "\"accountType\":\"" + accountType + "\",";
    json += "\"platform\":\"MT5\",";
    json += "\"balance\":" + DoubleToString(balance, 2) + ",";
    json += "\"equity\":" + DoubleToString(equity, 2) + ",";
    json += "\"margin\":" + DoubleToString(margin, 2) + ",";
    json += "\"freeMargin\":" + DoubleToString(freeMargin, 2) + ",";
    json += "\"marginLevel\":" + DoubleToString(marginLevel, 2) + ",";
    json += "\"profit\":" + DoubleToString(profit, 2) + ",";
    json += "\"openPositions\":" + IntegerToString(openPositions) + ",";
    json += "\"broker\":\"" + broker + "\",";
    json += "\"currency\":\"" + currency + "\",";
    json += "\"leverage\":\"1:" + IntegerToString(leverage) + "\",";
    json += "\"timestamp\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\"";
    json += "}";
    
    // Send via HTTP POST
    char data[];
    char result[];
    string headers = "Content-Type: application/json\r\n";
    string url = ServerURL + "/api/mt/ea-update";
    
    StringToCharArray(json, data, 0, StringLen(json));
    
    int res = WebRequest("POST", url, headers, 5000, data, result, headers);
    
    if(res == 200)
    {
        Print("✅ Account data sent successfully");
        Print("   Account: ", accountNumber, " (", accountType, ")");
        Print("   Balance: $", DoubleToString(balance, 2));
        Print("   Equity: $", DoubleToString(equity, 2));
        Print("   P/L: $", DoubleToString(profit, 2));
        Print("   Margin Level: ", DoubleToString(marginLevel, 2), "%");
        Print("   Open Positions: ", openPositions);
    }
    else if(res == -1)
    {
        int error = GetLastError();
        Print("❌ WebRequest error: ", error);
        Print("⚠️ Make sure to enable WebRequest for this URL:");
        Print("   Tools -> Options -> Expert Advisors");
        Print("   ✓ Allow WebRequest for listed URL");
        Print("   Add: http://localhost:4101");
    }
    else
    {
        Print("❌ Server error. Response code: ", res);
        Print("   Make sure the server is running on http://localhost:4101");
    }
}

//+------------------------------------------------------------------+
//| Check for new signals from dashboard                             |
//+------------------------------------------------------------------+
void CheckForNewSignals()
{
    long accountNumber = AccountInfoInteger(ACCOUNT_LOGIN);
    string url = ServerURL + "/api/mt/pending-signals?account=" + IntegerToString(accountNumber);
    
    char data[];
    char result[];
    string headers = "";
    
    int res = WebRequest("GET", url, headers, 5000, data, result, headers);
    
    if(res == 200)
    {
        string response = CharArrayToString(result);
        
        // Check if there are pending signals
        if(StringFind(response, "\"signals\":[]") < 0 && StringFind(response, "signals") >= 0)
        {
            Print("📊 New signal received from dashboard!");
            ParseAndExecuteSignal(response);
        }
    }
}

//+------------------------------------------------------------------+
//| Parse JSON response and execute signal                           |
//+------------------------------------------------------------------+
void ParseAndExecuteSignal(string jsonResponse)
{
    // Simple JSON parsing (in production, use a proper JSON library)
    string symbol = ExtractJSONValue(jsonResponse, "pair");
    string type = ExtractJSONValue(jsonResponse, "type");
    double entryPrice = StringToDouble(ExtractJSONValue(jsonResponse, "entryPrice"));
    double stopLoss = StringToDouble(ExtractJSONValue(jsonResponse, "stopLoss"));
    double takeProfit = StringToDouble(ExtractJSONValue(jsonResponse, "takeProfit"));
    string signalId = ExtractJSONValue(jsonResponse, "id");
    
    // Convert pair format (EUR/USD -> EURUSD)
    StringReplace(symbol, "/", "");
    
    Print("🎯 Executing signal:");
    Print("   Pair: ", symbol);
    Print("   Type: ", type);
    Print("   Entry: ", entryPrice);
    Print("   SL: ", stopLoss);
    Print("   TP: ", takeProfit);
    
    // Calculate lot size based on risk
    double lotSize = CalculateLotSize(symbol, stopLoss, entryPrice);
    
    // Execute trade
    bool success = false;
    if(type == "BUY")
    {
        success = ExecuteBuyOrder(symbol, lotSize, stopLoss, takeProfit, signalId);
    }
    else if(type == "SELL")
    {
        success = ExecuteSellOrder(symbol, lotSize, stopLoss, takeProfit, signalId);
    }
    
    if(success)
    {
        Print("✅ Signal executed successfully!");
        // Notify dashboard that signal was executed
        NotifySignalExecuted(signalId, true);
    }
    else
    {
        Print("❌ Failed to execute signal");
        NotifySignalExecuted(signalId, false);
    }
}

//+------------------------------------------------------------------+
//| Calculate lot size based on risk percentage                      |
//+------------------------------------------------------------------+
double CalculateLotSize(string symbol, double stopLoss, double entryPrice)
{
    double balance = AccountInfoDouble(ACCOUNT_BALANCE);
    double riskAmount = balance * (RiskPercent / 100.0);
    
    double pipValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
    double pipSize = SymbolInfoDouble(symbol, SYMBOL_POINT);
    
    double stopLossPips = MathAbs(entryPrice - stopLoss) / pipSize;
    
    if(stopLossPips == 0) return 0.01; // Minimum lot
    
    double lotSize = riskAmount / (stopLossPips * pipValue);
    
    // Normalize to broker's lot step
    double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    
    lotSize = MathFloor(lotSize / lotStep) * lotStep;
    lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
    
    return lotSize;
}

//+------------------------------------------------------------------+
//| Execute BUY order                                                 |
//+------------------------------------------------------------------+
bool ExecuteBuyOrder(string symbol, double lotSize, double stopLoss, double takeProfit, string signalId)
{
    MqlTradeRequest request;
    MqlTradeResult result;
    
    ZeroMemory(request);
    ZeroMemory(result);
    
    double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = symbol;
    request.volume = lotSize;
    request.type = ORDER_TYPE_BUY;
    request.price = ask;
    request.sl = stopLoss;
    request.tp = takeProfit;
    request.deviation = 10;
    request.magic = MagicNumber;
    request.comment = "Dashboard Signal #" + signalId;
    request.type_filling = ORDER_FILLING_FOK;
    
    if(!OrderSend(request, result))
    {
        Print("❌ OrderSend failed. Error: ", GetLastError());
        Print("   Return code: ", result.retcode);
        return false;
    }
    
    if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED)
    {
        Print("✅ BUY order opened:");
        Print("   Ticket: ", result.order);
        Print("   Volume: ", lotSize);
        Print("   Price: ", result.price);
        return true;
    }
    
    return false;
}

//+------------------------------------------------------------------+
//| Execute SELL order                                                |
//+------------------------------------------------------------------+
bool ExecuteSellOrder(string symbol, double lotSize, double stopLoss, double takeProfit, string signalId)
{
    MqlTradeRequest request;
    MqlTradeResult result;
    
    ZeroMemory(request);
    ZeroMemory(result);
    
    double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = symbol;
    request.volume = lotSize;
    request.type = ORDER_TYPE_SELL;
    request.price = bid;
    request.sl = stopLoss;
    request.tp = takeProfit;
    request.deviation = 10;
    request.magic = MagicNumber;
    request.comment = "Dashboard Signal #" + signalId;
    request.type_filling = ORDER_FILLING_FOK;
    
    if(!OrderSend(request, result))
    {
        Print("❌ OrderSend failed. Error: ", GetLastError());
        Print("   Return code: ", result.retcode);
        return false;
    }
    
    if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED)
    {
        Print("✅ SELL order opened:");
        Print("   Ticket: ", result.order);
        Print("   Volume: ", lotSize);
        Print("   Price: ", result.price);
        return true;
    }
    
    return false;
}

//+------------------------------------------------------------------+
//| Notify dashboard that signal was executed                        |
//+------------------------------------------------------------------+
void NotifySignalExecuted(string signalId, bool success)
{
    long accountNumber = AccountInfoInteger(ACCOUNT_LOGIN);
    string url = ServerURL + "/api/mt/signal-executed";
    
    string json = "{";
    json += "\"signalId\":\"" + signalId + "\",";
    json += "\"account\":\"" + IntegerToString(accountNumber) + "\",";
    json += "\"success\":" + (success ? "true" : "false");
    json += "}";
    
    char data[];
    char result[];
    string headers = "Content-Type: application/json\r\n";
    
    StringToCharArray(json, data, 0, StringLen(json));
    
    WebRequest("POST", url, headers, 5000, data, result, headers);
}

//+------------------------------------------------------------------+
//| Extract value from JSON string (simple parser)                   |
//+------------------------------------------------------------------+
string ExtractJSONValue(string json, string key)
{
    string searchKey = "\"" + key + "\":";
    int startPos = StringFind(json, searchKey);
    
    if(startPos < 0) return "";
    
    startPos += StringLen(searchKey);
    
    // Skip whitespace and quotes
    while(startPos < StringLen(json))
    {
        string char = StringSubstr(json, startPos, 1);
        if(char != " " && char != "\"") break;
        startPos++;
    }
    
    // Find end of value
    int endPos = startPos;
    bool inQuotes = false;
    
    if(StringSubstr(json, startPos - 1, 1) == "\"") inQuotes = true;
    
    while(endPos < StringLen(json))
    {
        string char = StringSubstr(json, endPos, 1);
        
        if(inQuotes)
        {
            if(char == "\"") break;
        }
        else
        {
            if(char == "," || char == "}" || char == "]") break;
        }
        
        endPos++;
    }
    
    return StringSubstr(json, startPos, endPos - startPos);
}

//+------------------------------------------------------------------+
