#property copyright "Neon Trading Stack"
#property version   "1.00"
#property strict

input string BridgeUrl          = "http://localhost:4101/api/broker/bridge/mt5";
input string ApiToken           = "set-a-secure-token";
input bool   ForceReconnect     = true;
input int    HeartbeatInterval  = 30;
input int    RequestTimeoutMs   = 7000;

datetime g_lastHeartbeat = 0;
bool     g_isConnected   = false;

string AccountMode()
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   return (mode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "real";
}

bool HttpRequest(const string method,
                 const string path,
                 const string payload,
                 string &response)
{
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiToken + "\r\n";
   uchar body[];
   int length = StringToCharArray(payload, body);
   if(length < 0)
   {
      Print("Failed to encode payload");
      return false;
   }
   ArrayResize(body, length);
   uchar result[];
   string resultHeaders = "";

   string url = BridgeUrl;
   if(StringSubstr(path, 0, 1) != "/")
      url = url + "/" + path;
   else
      url = url + path;

   ResetLastError();
   int status = WebRequest(method, url, headers, RequestTimeoutMs, body, result, resultHeaders);
   if(status == -1)
   {
      PrintFormat("WebRequest error: %d", GetLastError());
      return false;
   }

   response = CharArrayToString(result);
   if(status >= 200 && status < 300)
      return true;

   PrintFormat("Bridge request failed: %d -> %s", status, response);
   return false;
}

string BuildSessionPayload(bool includeForceFlag)
{
   string payload = StringFormat(
      "{\"accountMode\":\"%s\",\"accountNumber\":\"%I64d\"",
      AccountMode(),
      AccountInfoInteger(ACCOUNT_LOGIN)
   );
   payload += StringFormat(",\"equity\":%.2f,\"balance\":%.2f",
                           AccountInfoDouble(ACCOUNT_EQUITY),
                           AccountInfoDouble(ACCOUNT_BALANCE));
   payload += StringFormat(",\"server\":\"%s\",\"currency\":\"%s\"",
                           AccountInfoString(ACCOUNT_SERVER),
                           AccountInfoString(ACCOUNT_CURRENCY));
   if(includeForceFlag)
      payload += StringFormat(",\"forceReconnect\":%s", ForceReconnect ? "true" : "false");
   payload += "}";
   return payload;
}

bool SendSessionConnect()
{
   string response = "";
   if(HttpRequest("POST", "/session/connect", BuildSessionPayload(true), response))
   {
      g_isConnected = true;
      Print("Bridge session registered: ", response);
      return true;
   }
   g_isConnected = false;
   return false;
}

bool SendSessionDisconnect()
{
   string response = "";
   if(HttpRequest("POST", "/session/disconnect", BuildSessionPayload(false), response))
   {
      Print("Bridge session closed");
      g_isConnected = false;
      return true;
   }
   return false;
}

bool SendHeartbeat()
{
   string payload = StringFormat("{\"timestamp\":%I64d,\"equity\":%.2f}", TimeCurrent(), AccountInfoDouble(ACCOUNT_EQUITY));
   string response = "";
   if(HttpRequest("POST", "/agent/heartbeat", payload, response))
   {
      g_lastHeartbeat = TimeCurrent();
      return true;
   }
   return false;
}

int OnInit()
{
   if(!SendSessionConnect())
   {
      Print("Unable to register bridge session. Check URL/token or allow WebRequest target in terminal settings.");
      return INIT_FAILED;
   }
   EventSetTimer(MathMax(HeartbeatInterval, 10));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   SendSessionDisconnect();
}

void OnTimer()
{
   if(!g_isConnected)
   {
      SendSessionConnect();
      return;
   }
   if(TimeCurrent() - g_lastHeartbeat >= HeartbeatInterval)
   {
      if(!SendHeartbeat())
         Print("Heartbeat failed");
   }
}

string TransactionTypeToString(const ENUM_TRADE_TRANSACTION_TYPE type)
{
   switch(type)
   {
      case TRADE_TRANSACTION_ORDER_ADD: return "ORDER_ADD";
      case TRADE_TRANSACTION_ORDER_UPDATE: return "ORDER_UPDATE";
      case TRADE_TRANSACTION_ORDER_DELETE: return "ORDER_DELETE";
      case TRADE_TRANSACTION_HISTORY_ADD: return "HISTORY_ADD";
      case TRADE_TRANSACTION_HISTORY_UPDATE: return "HISTORY_UPDATE";
      case TRADE_TRANSACTION_DEAL_ADD: return "DEAL_ADD";
      case TRADE_TRANSACTION_DEAL_UPDATE: return "DEAL_UPDATE";
      case TRADE_TRANSACTION_DEAL_DELETE: return "DEAL_DELETE";
      default: return "UNKNOWN";
   }
}

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(!g_isConnected)
      return;

   double eventVolume = trans.volume;
   if(eventVolume <= 0.0)
      eventVolume = request.volume;
   if(eventVolume <= 0.0)
      eventVolume = 0.0;

   double eventPrice = trans.price;
   if(eventPrice <= 0.0)
      eventPrice = request.price;
   if(eventPrice <= 0.0)
   {
      double bid = 0.0;
      if(SymbolInfoDouble(trans.symbol, SYMBOL_BID, bid))
         eventPrice = bid;
   }

   double eventProfit = 0.0;
   long eventTimestamp = (long)TimeCurrent();

   if(result.deal > 0)
   {
      datetime from = (datetime)(TimeCurrent() - 30 * 24 * 60 * 60);
      datetime to = TimeCurrent();
      if(HistorySelect(from, to))
      {
         ResetLastError();
         double dealProfitRaw = HistoryDealGetDouble(result.deal, DEAL_PROFIT);
         if(GetLastError() == 0)
            eventProfit = dealProfitRaw;

         ResetLastError();
         long dealTimeRaw = (long)HistoryDealGetInteger(result.deal, DEAL_TIME);
         if(GetLastError() == 0 && dealTimeRaw > 0)
            eventTimestamp = dealTimeRaw;
      }
   }

   string payload = StringFormat(
      "{\"type\":\"%s\",\"order\":%I64d,\"deal\":%I64d,\"symbol\":\"%s\",\"volume\":%.2f,\"price\":%.5f,\"profit\":%.2f,\"timestamp\":%I64d}",
      TransactionTypeToString((ENUM_TRADE_TRANSACTION_TYPE)trans.type),
      trans.order,
      trans.deal,
      trans.symbol,
      eventVolume,
      eventPrice,
      eventProfit,
      eventTimestamp
   );

   string response = "";
   if(!HttpRequest("POST", "/agent/transaction", payload, response))
      Print("Failed to forward trade transaction");
}
