#property copyright "Neon Trading Stack"
#property version   "1.00"
#property strict

extern string BridgeUrl         = "http://localhost:4101/api/broker/bridge/mt4";
extern string ApiToken          = "set-a-secure-token";
extern bool   ForceReconnect    = true;
extern int    HeartbeatInterval = 30;
extern int    RequestTimeoutMs  = 7000;

datetime g_lastHeartbeat = 0;
bool     g_isConnected   = false;

string AccountMode()
{
   int mode = AccountNumber();
   return AccountServer() == "" ? "demo" : (StringFind(AccountServer(), "demo", 0) >= 0 ? "demo" : "real");
}

bool HttpRequest(string method,
                 string path,
                 string payload,
                 string &response)
{
   char result[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiToken + "\r\n";
   uchar body[];
   StringToCharArray(payload, body);

   string url = BridgeUrl;
   if(StringSubstr(path, 0, 1) != "/")
      url = url + "/" + path;
   else
      url = url + path;

   ResetLastError();
   int status = WebRequest(method, url, headers, RequestTimeoutMs, body, result, NULL);
   if(status == -1)
   {
      Print("WebRequest error: ", GetLastError());
      return(false);
   }

   response = CharArrayToString(result);
   if(status >= 200 && status < 300)
      return(true);

   Print("Bridge request failed: ", status, " -> ", response);
   return(false);
}

string BuildSessionPayload(bool includeForceFlag)
{
   string payload = StringConcatenate(
      "{\"accountMode\":\"", AccountMode(),
      "\",\"accountNumber\":\"", AccountNumber(),
      "\",\"equity\":", DoubleToString(AccountEquity(), 2),
      ",\"balance\":", DoubleToString(AccountBalance(), 2),
      ",\"server\":\"", AccountServer(),
      "\",\"currency\":\"", AccountCurrency(), "\"");
   if(includeForceFlag)
      payload = StringConcatenate(payload, ",\"forceReconnect\":", ForceReconnect ? "true" : "false");
   payload = StringConcatenate(payload, "}");
   return(payload);
}

bool SendSessionConnect()
{
   string response = "";
   if(HttpRequest("POST", "/session/connect", BuildSessionPayload(true), response))
   {
      g_isConnected = true;
      Print("Bridge session registered: ", response);
      return(true);
   }
   g_isConnected = false;
   return(false);
}

bool SendSessionDisconnect()
{
   string response = "";
   if(HttpRequest("POST", "/session/disconnect", BuildSessionPayload(false), response))
   {
      Print("Bridge session closed");
      g_isConnected = false;
      return(true);
   }
   return(false);
}

bool SendHeartbeat()
{
   string payload = StringConcatenate("{\"timestamp\":", TimeCurrent(), ",\"equity\":", DoubleToString(AccountEquity(), 2), "}");
   string response = "";
   if(HttpRequest("POST", "/agent/heartbeat", payload, response))
   {
      g_lastHeartbeat = TimeCurrent();
      return(true);
   }
   return(false);
}

int OnInit()
{
   if(!SendSessionConnect())
   {
      Print("Unable to register bridge session. Check URL/token or allow WebRequest target in terminal settings.");
      return(INIT_FAILED);
   }
   EventSetTimer(MathMax(HeartbeatInterval, 10));
   return(INIT_SUCCEEDED);
}

int OnDeinit()
{
   EventKillTimer();
   SendSessionDisconnect();
   return(0);
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

void OnTrade()
{
   if(!g_isConnected)
      return;

   int total = OrdersHistoryTotal();
   if(total <= 0)
      return;

   if(!OrderSelect(total - 1, SELECT_BY_POS, MODE_HISTORY))
      return;

   string payload = StringConcatenate(
      "{\"ticket\":", OrderTicket(),
      ",\"symbol\":\"", OrderSymbol(),
      "\",\"volume\":", DoubleToString(OrderLots(), 2),
      ",\"profit\":", DoubleToString(OrderProfit(), 2),
      ",\"timestamp\":", OrderCloseTime(), "}");

   string response = "";
   if(!HttpRequest("POST", "/agent/transaction", payload, response))
      Print("Failed to forward trade transaction");
}
