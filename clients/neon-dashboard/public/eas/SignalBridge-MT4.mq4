//+------------------------------------------------------------------+
//| Expert Advisor: Intelligent Signal Bridge MT4                     |
//| Features: Dynamic Stop-Loss, Risk Management, Auto-Trading        |
//+------------------------------------------------------------------+
#property copyright "Neon Trading Stack - Enhanced EA"
#property version   "2.00"
#property strict

// === Connection Settings ===
extern string BridgeUrl         = "http://localhost:4101/api/broker/bridge/mt4";
extern string ApiToken          = "set-a-secure-token";
extern bool   ForceReconnect    = true;
extern int    HeartbeatInterval = 30;
extern int    RequestTimeoutMs  = 7000;

// === Auto-Trading Settings ===
extern bool   EnableAutoTrading = false;
extern double RiskPercentage    = 2.0;      // % of equity to risk per trade
extern int    MagicNumber       = 87001;
extern int    Slippage          = 10;

// === Intelligent Features ===
extern bool   UseDynamicStopLoss = true;    // Adjust SL based on volatility
extern bool   EnableLearning     = true;     // Learn from trade results
extern double MaxLotSize         = 1.0;
extern double MinLotSize         = 0.01;

// === Global Variables ===
datetime g_lastHeartbeat = 0;
bool     g_isConnected   = false;
bool     g_autoTradingActive = false;
double   g_riskMultiplier = 1.0;
double   g_stopLossMultiplier = 1.0;
int      g_signalCheckInterval = 60;  // Check for new signals every 60 seconds
datetime g_lastSignalCheck = 0;

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
   string payload = StringConcatenate(
      BuildSessionPayload(true),
      ",\"broker\":\"mt4\"}"  // Remove last } from BuildSessionPayload and add broker
   );
   payload = StringSubstr(payload, 0, StringLen(payload) - 2) + ",\"broker\":\"mt4\"}";
   
   string response = "";
   if(HttpRequest("POST", "/session/connect", payload, response))
   {
      g_isConnected = true;
      
      // Parse learning parameters from response if available
      if(EnableLearning && StringFind(response, "riskMultiplier") >= 0)
      {
         // Extract risk multiplier (simplified parsing)
         int riskPos = StringFind(response, "riskMultiplier");
         if(riskPos >= 0)
         {
            string riskStr = StringSubstr(response, riskPos + 16, 4);
            g_riskMultiplier = StrToDouble(riskStr);
            if(g_riskMultiplier < 0.5 || g_riskMultiplier > 2.0)
               g_riskMultiplier = 1.0;
         }
      }
      
      Print("Bridge session registered with intelligent features: ", response);
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
   
   // Send heartbeat
   if(TimeCurrent() - g_lastHeartbeat >= HeartbeatInterval)
   {
      if(!SendHeartbeat())
         Print("Heartbeat failed");
   }
   
   // Check for new signals if auto-trading is enabled
   if(EnableAutoTrading && g_autoTradingActive)
   {
      if(TimeCurrent() - g_lastSignalCheck >= g_signalCheckInterval)
      {
         CheckAndExecuteSignals();
         g_lastSignalCheck = TimeCurrent();
      }
   }
   
   // Monitor and manage open positions
   ManageOpenPositions();
}

//+------------------------------------------------------------------+
//| Check for signals and execute trades                             |
//+------------------------------------------------------------------+
void CheckAndExecuteSignals()
{
   string response = "";
   string payload = StringConcatenate(
      "{\"symbol\":\"", Symbol(),
      "\",\"broker\":\"mt4\"",
      ",\"accountMode\":\"", AccountMode(),
      "\",\"timeframe\":\"", Period(), "\"}"
   );
   
   if(HttpRequest("GET", "/signal/get", payload, response))
   {
      // Parse response and execute if signal is valid
      if(StringFind(response, "\"shouldExecute\":true") >= 0)
      {
         ExecuteSignalFromResponse(response);
      }
   }
}

//+------------------------------------------------------------------+
//| Execute trade based on signal response                           |
//+------------------------------------------------------------------+
void ExecuteSignalFromResponse(string response)
{
   // Parse signal details (simplified - in production use JSON parser)
   string direction = "buy";  // Default
   if(StringFind(response, "\"direction\":\"sell\"") >= 0)
      direction = "sell";
   
   double lots = CalculateLotSize();
   
   // Apply risk multiplier from learning
   lots = lots * g_riskMultiplier;
   lots = MathMax(MinLotSize, MathMin(MaxLotSize, lots));
   
   // Calculate stop loss and take profit
   double sl = 0, tp = 0;
   if(UseDynamicStopLoss)
   {
      sl = CalculateDynamicStopLoss(direction);
      tp = CalculateDynamicTakeProfit(direction, sl);
   }
   
   // Execute order
   int ticket = -1;
   if(direction == "buy")
   {
      ticket = OrderSend(Symbol(), OP_BUY, lots, Ask, Slippage, sl, tp, 
                        "Intelligent EA", MagicNumber, 0, clrGreen);
   }
   else
   {
      ticket = OrderSend(Symbol(), OP_SELL, lots, Bid, Slippage, sl, tp,
                        "Intelligent EA", MagicNumber, 0, clrRed);
   }
   
   if(ticket > 0)
      Print("Trade opened: ", ticket, " Direction: ", direction, " Lots: ", lots);
   else
      Print("Trade failed: ", GetLastError());
}

//+------------------------------------------------------------------+
//| Calculate lot size based on risk percentage                      |
//+------------------------------------------------------------------+
double CalculateLotSize()
{
   double riskAmount = AccountEquity() * (RiskPercentage / 100.0);
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double stopLossPips = 50; // Default
   
   if(tickValue > 0)
   {
      double lots = (riskAmount / stopLossPips) / tickValue;
      lots = MathMax(MinLotSize, MathMin(MaxLotSize, lots));
      return(NormalizeDouble(lots, 2));
   }
   
   return(MinLotSize);
}

//+------------------------------------------------------------------+
//| Calculate dynamic stop loss based on ATR                         |
//+------------------------------------------------------------------+
double CalculateDynamicStopLoss(string direction)
{
   double atr = iATR(Symbol(), 0, 14, 0);
   double slDistance = atr * 2.0 * g_stopLossMultiplier;  // Apply learning factor
   
   if(direction == "buy")
      return(NormalizeDouble(Ask - slDistance, Digits));
   else
      return(NormalizeDouble(Bid + slDistance, Digits));
}

//+------------------------------------------------------------------+
//| Calculate dynamic take profit                                    |
//+------------------------------------------------------------------+
double CalculateDynamicTakeProfit(string direction, double stopLoss)
{
   double slDistance = MathAbs((direction == "buy" ? Ask : Bid) - stopLoss);
   double tpDistance = slDistance * 2.0;  // 2:1 reward/risk ratio
   
   if(direction == "buy")
      return(NormalizeDouble(Ask + tpDistance, Digits));
   else
      return(NormalizeDouble(Bid - tpDistance, Digits));
}

//+------------------------------------------------------------------+
//| Manage open positions with trailing stop                         |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      
      if(OrderMagicNumber() != MagicNumber)
         continue;
      
      if(OrderSymbol() != Symbol())
         continue;
      
      // Implement trailing stop
      double newSL = 0;
      bool shouldModify = false;
      
      if(OrderType() == OP_BUY)
      {
         double trailDistance = iATR(Symbol(), 0, 14, 0) * 1.5 * g_stopLossMultiplier;
         newSL = NormalizeDouble(Bid - trailDistance, Digits);
         
         if(newSL > OrderStopLoss() && newSL < Bid)
         {
            shouldModify = true;
         }
      }
      else if(OrderType() == OP_SELL)
      {
         double trailDistance = iATR(Symbol(), 0, 14, 0) * 1.5 * g_stopLossMultiplier;
         newSL = NormalizeDouble(Ask + trailDistance, Digits);
         
         if((newSL < OrderStopLoss() || OrderStopLoss() == 0) && newSL > Ask)
         {
            shouldModify = true;
         }
      }
      
      if(shouldModify)
      {
         bool success = OrderModify(OrderTicket(), OrderOpenPrice(), newSL, 
                                   OrderTakeProfit(), 0, clrBlue);
         if(success)
            Print("Trailing stop updated for ticket: ", OrderTicket());
      }
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

   // Send trade result for learning
   string payload = StringConcatenate(
      "{\"type\":\"HISTORY_ADD\"",
      ",\"ticket\":", OrderTicket(),
      ",\"symbol\":\"", OrderSymbol(),
      "\",\"volume\":", DoubleToString(OrderLots(), 2),
      ",\"profit\":", DoubleToString(OrderProfit(), 2),
      ",\"timestamp\":", OrderCloseTime(),
      ",\"broker\":\"mt4\"",
      ",\"accountMode\":\"", AccountMode(),
      "\",\"accountNumber\":\"", AccountNumber(), "\"}"
   );

   string response = "";
   if(HttpRequest("POST", "/agent/transaction", payload, response))
   {
      // Update learning parameters from response
      if(EnableLearning && StringFind(response, "riskAdjustment") >= 0)
      {
         // Parse learning metrics from response
         int riskPos = StringFind(response, "riskAdjustment");
         if(riskPos >= 0)
         {
            string riskStr = StringSubstr(response, riskPos + 16, 4);
            g_riskMultiplier = StrToDouble(riskStr);
         }
         
         int slPos = StringFind(response, "stopLossAdjustment");
         if(slPos >= 0)
         {
            string slStr = StringSubstr(response, slPos + 20, 4);
            g_stopLossMultiplier = StrToDouble(slStr);
         }
         
         Print("Learning updated - Risk: ", g_riskMultiplier, " SL: ", g_stopLossMultiplier);
      }
   }
   else
   {
      Print("Failed to forward trade transaction for learning");
   }
}
