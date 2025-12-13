//+------------------------------------------------------------------+
//|                                       IntelligentTradingEA.mq4   |
//|                        Intelligent Auto-Trading System MT4 EA    |
//|                         Sends real prices and receives signals   |
//+------------------------------------------------------------------+
#property copyright "Intelligent Trading System"
#property link      "https://github.com/abdulkadersh0002-dev/sg"
#property version   "2.00"
#property strict

//--- Input parameters
input string ServerURL = "http://127.0.0.1:5002";  // Server URL
input int    UpdateIntervalSeconds = 15;            // Price update interval (seconds)
input bool   AutoTrade = true;                     // Enable auto-trading
input double MaxRiskPercent = 2.0;                 // Maximum risk per trade (%)
input int    MagicNumber = 123456;                 // Magic number for trades
input string TradingPairs = "EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD"; // Pairs to monitor

//--- Global variables
datetime lastUpdate = 0;
string sessionId = "";
bool isConnected = false;

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("═══════════════════════════════════════════════════");
   Print("  Intelligent Trading EA v2.0 - Starting...");
   Print("═══════════════════════════════════════════════════");
   Print("Server: ", ServerURL);
   Print("Update interval: ", UpdateIntervalSeconds, " seconds");
   Print("Auto-trading: ", (AutoTrade ? "ENABLED" : "DISABLED"));
   Print("Monitoring pairs: ", TradingPairs);
   
   // Register session with server
   if(RegisterSession())
   {
      Print("✓ Successfully connected to trading system");
      isConnected = true;
   }
   else
   {
      Print("✗ Failed to connect. Will retry on next tick...");
      isConnected = false;
   }
   
   Print("═══════════════════════════════════════════════════");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("EA shutting down. Reason: ", reason);
   
   // Disconnect session
   if(isConnected)
   {
      DisconnectSession();
   }
}

//+------------------------------------------------------------------+
//| Expert tick function                                              |
//+------------------------------------------------------------------+
void OnTick()
{
   // Check if it's time to update
   if(TimeCurrent() - lastUpdate < UpdateIntervalSeconds)
      return;
      
   lastUpdate = TimeCurrent();
   
   // Reconnect if disconnected
   if(!isConnected)
   {
      if(RegisterSession())
         isConnected = true;
      else
         return;
   }
   
   // Send price data to server
   SendPriceData();
   
   // Check for new signals
   if(AutoTrade)
   {
      CheckForSignals();
   }
   
   // Send heartbeat
   SendHeartbeat();
}

//+------------------------------------------------------------------+
//| Register session with server                                      |
//+------------------------------------------------------------------+
bool RegisterSession()
{
   string url = ServerURL + "/api/ea/register";
   string headers = "Content-Type: application/json\r\n";
   
   string payload = StringFormat(
      "{\"accountNumber\":\"%d\",\"accountMode\":\"%s\",\"broker\":\"%s\",\"equity\":%.2f,\"balance\":%.2f,\"server\":\"%s\",\"currency\":\"%s\"}",
      AccountNumber(),
      (IsDemo() ? "demo" : "live"),
      AccountCompany(),
      AccountEquity(),
      AccountBalance(),
      AccountServer(),
      AccountCurrency()
   );
   
   char data[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(payload, data, 0, StringLen(payload));
   
   int res = WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      
      if(StringFind(response, "success\":true") > 0)
      {
         sessionId = StringFormat("%s-%s-%d", AccountCompany(), (IsDemo() ? "demo" : "live"), AccountNumber());
         return true;
      }
   }
   else
   {
      Print("Registration failed. HTTP code: ", res);
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Disconnect session                                                |
//+------------------------------------------------------------------+
void DisconnectSession()
{
   string url = ServerURL + "/api/ea/disconnect";
   string headers = "Content-Type: application/json\r\n";
   
   string payload = StringFormat(
      "{\"accountNumber\":\"%d\",\"accountMode\":\"%s\",\"broker\":\"%s\"}",
      AccountNumber(),
      (IsDemo() ? "demo" : "live"),
      AccountCompany()
   );
   
   char data[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(payload, data, 0, StringLen(payload));
   WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
}

//+------------------------------------------------------------------+
//| Send price data to server                                         |
//+------------------------------------------------------------------+
void SendPriceData()
{
   string url = ServerURL + "/api/ea/price-update";
   string headers = "Content-Type: application/json\r\n";
   
   // Split trading pairs
   string pairs[];
   int pairCount = StringSplit(TradingPairs, ',', pairs);
   
   string priceData = "[";
   
   for(int i = 0; i < pairCount; i++)
   {
      string pair = pairs[i];
      StringTrimLeft(pair);
      StringTrimRight(pair);
      
      double bid = MarketInfo(pair, MODE_BID);
      double ask = MarketInfo(pair, MODE_ASK);
      double high = iHigh(pair, PERIOD_M15, 0);
      double low = iLow(pair, PERIOD_M15, 0);
      double close = iClose(pair, PERIOD_M15, 0);
      double volume = iVolume(pair, PERIOD_M15, 0);
      
      if(i > 0) priceData += ",";
      
      priceData += StringFormat(
         "{\"pair\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%.0f,\"timestamp\":%d}",
         pair, bid, ask, high, low, close, volume, TimeCurrent()
      );
   }
   
   priceData += "]";
   
   string payload = StringFormat(
      "{\"sessionId\":\"%s\",\"prices\":%s}",
      sessionId,
      priceData
   );
   
   char data[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(payload, data, 0, StringLen(payload));
   
   int res = WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
   
   if(res != 200)
   {
      Print("Failed to send price data. HTTP code: ", res);
   }
}

//+------------------------------------------------------------------+
//| Check for new trading signals                                     |
//+------------------------------------------------------------------+
void CheckForSignals()
{
   string url = ServerURL + "/api/ea/get-signals";
   string headers = "Content-Type: application/json\r\n";
   
   string payload = StringFormat("{\"sessionId\":\"%s\"}", sessionId);
   
   char data[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(payload, data, 0, StringLen(payload));
   
   int res = WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      
      if(StringLen(response) > 10)
      {
         ProcessSignals(response);
      }
   }
}

//+------------------------------------------------------------------+
//| Process trading signals                                           |
//+------------------------------------------------------------------+
void ProcessSignals(string response)
{
   // Log received signals
   if(StringFind(response, "\"direction\":\"BUY\"") > 0)
   {
      Print("✓ BUY signal received from server");
   }
   else if(StringFind(response, "\"direction\":\"SELL\"") > 0)
   {
      Print("✓ SELL signal received from server");
   }
}

//+------------------------------------------------------------------+
//| Send heartbeat to keep session alive                             |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string url = ServerURL + "/api/ea/heartbeat";
   string headers = "Content-Type: application/json\r\n";
   
   string payload = StringFormat(
      "{\"sessionId\":\"%s\",\"equity\":%.2f,\"balance\":%.2f,\"openTrades\":%d}",
      sessionId,
      AccountEquity(),
      AccountBalance(),
      OrdersTotal()
   );
   
   char data[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(payload, data, 0, StringLen(payload));
   WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
}

//+------------------------------------------------------------------+
//| Check if account is demo                                          |
//+------------------------------------------------------------------+
bool IsDemo()
{
   return (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
}
//+------------------------------------------------------------------+
