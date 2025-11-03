//+------------------------------------------------------------------+
//|                                      AccountDataSender.mq4       |
//|                        Send Real MT4 Account Data via WebSocket  |
//+------------------------------------------------------------------+
#property copyright "Trading Signals Dashboard"
#property version   "1.00"
#property strict

// WebSocket Settings
input string ServerURL = "ws://localhost:8765";  // WebSocket Server URL
input int UpdateInterval = 5;                     // Update interval in seconds

// Global Variables
int socketHandle = -1;
datetime lastUpdate = 0;
bool isConnected = false;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    Print("=== Account Data Sender EA Started ===");
    Print("Server: ", ServerURL);
    Print("Update Interval: ", UpdateInterval, " seconds");
    
    // Try to connect
    ConnectToServer();
    
    return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    Print("=== Account Data Sender EA Stopped ===");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    // Update every X seconds
    if(TimeCurrent() - lastUpdate >= UpdateInterval)
    {
        SendAccountData();
        lastUpdate = TimeCurrent();
    }
}

//+------------------------------------------------------------------+
//| Connect to WebSocket Server                                      |
//+------------------------------------------------------------------+
void ConnectToServer()
{
    // Note: MT4 doesn't have native WebSocket support
    // You need to use one of these methods:
    // 1. Use a DLL that provides WebSocket functionality
    // 2. Use HTTP POST to send data instead
    // 3. Use a file-based bridge
    
    // For this example, we'll use HTTP POST (easier and no DLL needed)
    Print("Initializing connection...");
    isConnected = true;
}

//+------------------------------------------------------------------+
//| Send Account Data to Server                                      |
//+------------------------------------------------------------------+
void SendAccountData()
{
    // Collect account information
    string accountNumber = IntegerToString(AccountNumber());
    string accountType = AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "demo" : "real";
    double balance = AccountBalance();
    double equity = AccountEquity();
    double margin = AccountMargin();
    double freeMargin = AccountFreeMargin();
    double marginLevel = AccountMargin() > 0 ? (AccountEquity() / AccountMargin() * 100) : 0;
    double profit = AccountProfit();
    int openPositions = OrdersTotal();
    string broker = AccountCompany();
    string currency = AccountCurrency();
    int leverage = AccountLeverage();
    
    // Build JSON payload
    string json = "{";
    json += "\"type\":\"account_update\",";
    json += "\"account\":\"" + accountNumber + "\",";
    json += "\"accountType\":\"" + accountType + "\",";
    json += "\"platform\":\"MT4\",";
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
    
    // Send via HTTP POST (easier than WebSocket for MT4)
    string url = "http://localhost:4101/api/mt/ea-update";
    string headers = "Content-Type: application/json\r\n";
    char data[];
    char result[];
    string resultHeaders;
    
    StringToCharArray(json, data, 0, StringLen(json));
    
    int res = WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
    
    if(res == 200)
    {
        Print("✅ Account data sent successfully");
        Print("   Balance: $", DoubleToString(balance, 2));
        Print("   Equity: $", DoubleToString(equity, 2));
        Print("   P/L: $", DoubleToString(profit, 2));
        Print("   Open Positions: ", openPositions);
    }
    else
    {
        Print("❌ Failed to send data. Error code: ", res);
        Print("   Make sure the server is running on http://localhost:4101");
    }
}

//+------------------------------------------------------------------+
