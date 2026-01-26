//+------------------------------------------------------------------+
//| Expert Advisor: Intelligent Signal Bridge MT4                     |
//| Features: Dynamic Stop-Loss, Risk Management, Auto-Trading        |
//+------------------------------------------------------------------+
#property copyright "Neon Trading Stack - Enhanced EA"
#property version   "2.00"
#property strict

// === Connection Settings ===
extern string BridgeUrl         = "http://127.0.0.1:4101/api/broker/bridge/mt4";
extern string ApiToken          = "";
extern bool   ForceReconnect    = true;
extern int    HeartbeatInterval = 30;
extern int    RequestTimeoutMs  = 7000;

// === Market Feed (Ticker) ===
extern bool   EnableMarketFeed      = true;
extern int    MarketFeedIntervalSec = 2;
extern int    MarketBarsIntervalSec = 10; // bars update slower than quotes
extern string FeedSymbolsCsv        = ""; // empty = chart symbol + MarketWatch (if enabled)
extern bool   IncludeMarketWatch    = true;
extern int    MaxSymbolsToSend      = 500;
extern int    MaxQuotesPerPost      = 120;
extern bool   AutoPopulateMarketWatch = true; // tries to "Show All" symbols by selecting them into MarketWatch
extern int    MaxMarketWatchSymbols   = 3000; // safety cap

// === Smart / Low-Load Improvements ===
extern bool   EnablePrioritySymbols     = true;
extern int    PrioritySymbolsTtlSec     = 900;
extern int    MaxPrioritySymbols        = 60;
extern int    MaxPriorityQuotesPerPost  = 25;
extern int    QuoteResendIntervalSec    = 15;
extern int    SymbolResolveCacheTtlSec  = 3600;
extern int    MaxSymbolResolveCache     = 250;
extern int    MaxQuoteStateCache        = 500;
extern int    AutoPopulateBatchSize     = 250;

// Dashboard-driven lazy-loading
extern bool   EnableActiveSymbolsPolling   = true;
extern int    ActiveSymbolsPollIntervalSec = 5;
extern int    MaxActiveSymbols             = 40;

// === Market Snapshot (Indicators/Levels) ===
extern bool   EnableMarketSnapshot        = true;
extern int    MarketSnapshotIntervalSec   = 10;

// === Reliability / Auto-Reconnect ===
extern int    MaxConsecutiveFailures = 3;
extern int    ReconnectBackoffSec    = 5;

// === Auto-Trading Settings ===
extern bool   EnableAutoTrading = false;
extern int    SymbolsToCheckPerSignalPoll = 8;
// Prevent repeated entries on the same server signal (common when polling fast)
extern bool   EnableSignalDedupe = true;
extern int    SignalDedupeTtlSec = 120;
extern int    MagicNumber       = 87001;
extern int    Slippage          = 10;
extern int    MaxSpreadPoints   = 80;
extern double MaxFreeMarginUsagePct = 0.50;
extern int    MaxNoMoneyRetries = 6;
extern int    SymbolFailureCooldownSec = 600;
extern bool   DropInvalidStops = true;

// === Daily Guards (Smart Discipline) ===
extern bool   EnableDailyGuards          = true;
extern double DailyProfitTargetCurrency  = 0.0;
extern double DailyProfitTargetPct       = 0.0;
extern double DailyMaxLossCurrency       = 0.0;
extern double DailyMaxLossPct            = 0.0;
extern bool   EnforceMaxTradesPerDay     = false;
extern int    MaxTradesPerDay            = 0;

// === SMART STRONG Mode (recommended) ===
extern bool   SmartStrongMode               = true;
extern bool   EnforceSmartStrongThresholds  = true;
extern double SmartStrongMinStrengthTrade   = 60.0;
extern double SmartStrongMinConfidenceTrade = 75.0;
extern int    ServerPolicyRefreshSec        = 300;
extern int    SmartMaxTickAgeSec            = 6;
extern double SmartMinAtrPips               = 4.0;
extern double SmartMaxAtrPips               = 120.0;
extern double SmartMaxSpreadToAtrPct        = 18.0;

// Smart close: exit open trades when a strong opposite signal appears
extern bool   SmartStrongCloseOnOpposite    = true;
extern double SmartCloseMinStrength         = 60.0;
extern double SmartCloseMinConfidence       = 75.0;
extern int    SmartCloseCheckIntervalSec    = 30;

// === EA Smart Management (Server-Guided) ===
extern bool   EnableServerPositionSync = true;   // Send open positions for smart management
extern int    PositionSyncIntervalSec  = 5;
extern bool   EnableCommandPolling     = true;   // Poll server commands for manage actions
extern int    CommandPollIntervalSec   = 3;

// === Chart Overlay (Signal Visualization) ===
extern bool   EnableSignalOverlay        = true;
extern int    SignalOverlayIntervalSec   = 10;
extern bool   OverlayRespectServerExecution = false;

// === Intelligent Features ===
extern bool   UseDynamicStopLoss = true;    // Adjust SL based on volatility
extern bool   EnableLearning     = true;     // Learn from trade results
extern bool   TradeMajorsAndMetalsOnly = true;
extern bool   CloseLosingTrades = false;
extern double MaxLossPerTradePips = 0.0;
extern double MaxLossPerTradeCurrency = 0.0;

// === Trade Management ===
extern bool   EnableBreakeven        = true;
extern double BreakevenTriggerPips   = 8.0;
extern int    BreakevenBufferPoints  = 10;
extern bool   EnableTrailingStop     = true;
extern double TrailingStartPips      = 15.0;
extern double TrailingDistancePips   = 10.0;
extern int    TrailingStepPoints     = 20;
extern int    TradeModifyCooldownSec = 10;
extern bool   EnableAtrTrailing      = true;
extern int    AtrTrailingTf          = PERIOD_M15;
extern double AtrStartMultiplier     = 1.0;
extern double AtrTrailMultiplier     = 2.0;
extern double RiskPercentage     = 1.0;
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
datetime g_lastSignalOverlay = 0;
string   g_lastOverlayKey = "";

datetime g_lastMarketFeed = 0;
bool     g_sentConnectNews = false;

datetime g_lastMarketSnapshot = 0;
datetime g_lastSnapshotRequestPoll = 0;

datetime g_lastActiveSymbolsPoll = 0;

bool     g_activeSymbolsEndpointSupported = true;

datetime g_lastMarketBars = 0;

bool     g_serverPolicyLoaded = false;
datetime g_lastServerPolicyFetch = 0;
double   g_serverMinStrength = 0.0;
double   g_serverMinConfidence = 0.0;
bool     g_serverRequireLayers18 = false;
bool     g_serverRequiresEnterState = true;

datetime g_lastSmartCloseCheck = 0;

datetime g_lastPositionSync = 0;
datetime g_lastCommandPoll  = 0;

datetime g_lastTradeModifyAt = 0;

datetime g_dailyStart = 0;
double   g_dailyStartEquity = 0.0;
bool     g_dailyHalt = false;
string   g_dailyHaltReason = "";
bool     g_dailyHaltLogged = false;

// Closed-bar send state (per symbol+timeframe). Used to post M15/H1/H4/D1 only on bar close.
string   g_closedBarKey[];
datetime g_closedBarLastTime[];

int      g_lastHttpStatus = 0;
int      g_lastWebError = 0;
int      g_consecutiveFailures = 0;
datetime g_nextReconnectAt = 0;

bool     g_marketWatchPrepared = false;
int      g_marketFeedCursor = 0;

int      g_marketWatchPrepareCursor = 0;

int      g_tradeCursor = 0;

string   g_tradeCooldownSymbol = "";
datetime g_tradeCooldownUntil  = 0;

// Signal idempotency / replay protection
string   g_lastSignalSym[];
string   g_lastSignalKey[];
datetime g_lastSignalAt[];

int FindLastSignalIndex(const string sym)
{
   int n = ArraySize(g_lastSignalSym);
   for(int i = 0; i < n; i++)
   {
      if(g_lastSignalSym[i] == sym)
         return i;
   }
   return -1;
}

bool WasSignalRecentlyProcessed(const string sym, const string key)
{
   if(!EnableSignalDedupe)
      return false;
   if(StringLen(sym) <= 0 || StringLen(key) <= 0)
      return false;
   int ttl = SignalDedupeTtlSec;
   if(ttl <= 0)
      ttl = 120;
   int idx = FindLastSignalIndex(sym);
   if(idx < 0)
      return false;
   if(g_lastSignalKey[idx] != key)
      return false;
   if(g_lastSignalAt[idx] == 0)
      return false;
   return (TimeCurrent() - g_lastSignalAt[idx]) < ttl;
}

void MarkSignalProcessed(const string sym, const string key)
{
   if(StringLen(sym) <= 0 || StringLen(key) <= 0)
      return;
   int idx = FindLastSignalIndex(sym);
   if(idx < 0)
   {
      int n = ArraySize(g_lastSignalSym);
      ArrayResize(g_lastSignalSym, n + 1);
      ArrayResize(g_lastSignalKey, n + 1);
      ArrayResize(g_lastSignalAt, n + 1);
      idx = n;
   }
   g_lastSignalSym[idx] = sym;
   g_lastSignalKey[idx] = key;
   g_lastSignalAt[idx] = TimeCurrent();
}

string   g_prioritySymbols[];
datetime g_priorityExpires[];

string   g_activeSymbols[];
int      g_activeCursor = 0;

string   g_resolveReq[];
string   g_resolveRes[];
datetime g_resolveAt[];

string   g_quoteStateSym[];
datetime g_quoteStateLastTickTime[];
datetime g_quoteStateLastSentAt[];

void RemoveAtString(string &arr[], int idx)
{
   int n = ArraySize(arr);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; i++)
      arr[i] = arr[i + 1];
   ArrayResize(arr, n - 1);
}

void RemoveAtDatetime(datetime &arr[], int idx)
{
   int n = ArraySize(arr);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; i++)
      arr[i] = arr[i + 1];
   ArrayResize(arr, n - 1);
}

string CanonicalSymbol(string value)
{
   StringToUpper(value);
   string out = "";
   for(int i = 0; i < StringLen(value); i++)
   {
      int c = StringGetCharacter(value, i);
      bool isAlpha = (c >= 'A' && c <= 'Z');
      bool isNum = (c >= '0' && c <= '9');
      if(isAlpha || isNum)
         out = StringConcatenate(out, StringSubstr(value, i, 1));
   }
   return(out);
}

bool IsMajorCurrency(const string code)
{
   string c = code;
   StringToUpper(c);
   return(c == "USD" || c == "EUR" || c == "GBP" || c == "JPY" || c == "CHF" || c == "CAD" || c == "AUD" || c == "NZD");
}

bool IsMetalSymbol(const string sym)
{
   string c = CanonicalSymbol(sym);
   if(StringLen(c) < 6)
      return(false);
   string base = StringSubstr(c, 0, 3);
   StringToUpper(base);
   return(base == "XAU" || base == "XAG" || base == "XPT" || base == "XPD");
}

bool IsMajorsForexPair(const string sym)
{
   string c = CanonicalSymbol(sym);
   if(StringLen(c) < 6)
      return(false);
   string base = StringSubstr(c, 0, 3);
   string quote = StringSubstr(c, 3, 3);
   StringToUpper(base);
   StringToUpper(quote);
   return(IsMajorCurrency(base) && IsMajorCurrency(quote));
}

bool IsTradeSymbolEligible(const string sym)
{
   if(!TradeMajorsAndMetalsOnly)
      return(true);
   if(IsMetalSymbol(sym))
      return(true);
   return(IsMajorsForexPair(sym));
}

void ClampStopsForOrder(const string sym, const int cmd, const double price, double &sl, double &tp)
{
   double point = MarketInfo(sym, MODE_POINT);
   if(!(point > 0.0))
      point = 0.00001;
   int stopsLevel = (int)MarketInfo(sym, MODE_STOPLEVEL);
   int freezeLevel = (int)MarketInfo(sym, MODE_FREEZELEVEL);
   double minDist = (double)MathMax(stopsLevel, freezeLevel) * point;
   bool isBuy = (cmd == OP_BUY);

   if(sl > 0.0)
   {
      if((isBuy && sl >= price) || (!isBuy && sl <= price))
      {
         if(DropInvalidStops) sl = 0.0;
      }
      if(sl > 0.0 && minDist > 0.0)
      {
         double dist = isBuy ? (price - sl) : (sl - price);
         if(dist < minDist)
         {
            if(DropInvalidStops) sl = 0.0;
         }
      }
   }

   if(tp > 0.0)
   {
      if((isBuy && tp <= price) || (!isBuy && tp >= price))
      {
         if(DropInvalidStops) tp = 0.0;
      }
      if(tp > 0.0 && minDist > 0.0)
      {
         double dist = isBuy ? (tp - price) : (price - tp);
         if(dist < minDist)
         {
            if(DropInvalidStops) tp = 0.0;
         }
      }
   }
}

int ScoreSymbolCandidate(const string requestedCanonical, const string candidate)
{
   string c = CanonicalSymbol(candidate);
   if(StringLen(c) <= 0)
      return(-1);
   if(c == requestedCanonical)
      return(10000);
   int pos = StringFind(c, requestedCanonical, 0);
   if(pos == 0)
      return(9000 - (StringLen(c) - StringLen(requestedCanonical)));
   if(pos > 0)
      return(7000 - pos);
   return(-1);
}

string ResolveBrokerSymbol(string requested)
{
   StringTrimLeft(requested);
   StringTrimRight(requested);
   if(StringLen(requested) <= 0)
      return(requested);

   // Fast path: if selectable, use as-is.
   if(SymbolSelect(requested, true))
      return(requested);

   string reqCan = CanonicalSymbol(requested);
   if(StringLen(reqCan) <= 0)
      return(requested);

   datetime now = TimeCurrent();
   int cacheN = ArraySize(g_resolveReq);
   for(int i = 0; i < cacheN; i++)
   {
      if(g_resolveReq[i] == reqCan)
      {
         if(g_resolveAt[i] != 0 && (now - g_resolveAt[i]) <= MathMax(10, SymbolResolveCacheTtlSec))
            return(g_resolveRes[i]);
      }
   }

   string best = requested;
   int bestScore = -1;

   int totalSelected = SymbolsTotal(true);
   for(int i = 0; i < totalSelected; i++)
   {
      string name = SymbolName(i, true);
      int score = ScoreSymbolCandidate(reqCan, name);
      if(score > bestScore)
      {
         bestScore = score;
         best = name;
         if(bestScore >= 10000)
            break;
      }
   }

   if(bestScore < 0)
   {
      int totalAll = SymbolsTotal(false);
      int cap = (int)MathMin((double)totalAll, (double)MathMax(500, MaxMarketWatchSymbols));
      for(int i = 0; i < cap; i++)
      {
         string name = SymbolName(i, false);
         int score = ScoreSymbolCandidate(reqCan, name);
         if(score > bestScore)
         {
            bestScore = score;
            best = name;
            if(bestScore >= 10000)
               break;
         }
      }
   }

   if(bestScore >= 0)
   {
      int n = ArraySize(g_resolveReq);
      if(n >= MaxSymbolResolveCache)
      {
         RemoveAtString(g_resolveReq, 0);
         RemoveAtString(g_resolveRes, 0);
         RemoveAtDatetime(g_resolveAt, 0);
         n = ArraySize(g_resolveReq);
      }
      ArrayResize(g_resolveReq, n + 1);
      ArrayResize(g_resolveRes, n + 1);
      ArrayResize(g_resolveAt, n + 1);
      g_resolveReq[n] = reqCan;
      g_resolveRes[n] = best;
      g_resolveAt[n] = now;
   }

   return(best);
}

void PrunePrioritySymbols()
{
   datetime now = TimeCurrent();
   int n = ArraySize(g_prioritySymbols);
   for(int i = n - 1; i >= 0; i--)
   {
      if(g_priorityExpires[i] != 0 && now > g_priorityExpires[i])
      {
         RemoveAtString(g_prioritySymbols, i);
         RemoveAtDatetime(g_priorityExpires, i);
      }
   }
}

void AddPrioritySymbol(string sym)
{
   if(!EnablePrioritySymbols)
      return;
   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return;

   datetime expiresAt = TimeCurrent() + MathMax(10, PrioritySymbolsTtlSec);
   int n = ArraySize(g_prioritySymbols);
   for(int i = 0; i < n; i++)
   {
      if(g_prioritySymbols[i] == sym)
      {
         g_priorityExpires[i] = expiresAt;
         return;
      }
   }

   if(n >= MaxPrioritySymbols)
   {
      int oldestIdx = 0;
      datetime oldest = g_priorityExpires[0];
      for(int i = 1; i < n; i++)
      {
         if(g_priorityExpires[i] < oldest)
         {
            oldest = g_priorityExpires[i];
            oldestIdx = i;
         }
      }
      g_prioritySymbols[oldestIdx] = sym;
      g_priorityExpires[oldestIdx] = expiresAt;
      return;
   }

   ArrayResize(g_prioritySymbols, n + 1);
   ArrayResize(g_priorityExpires, n + 1);
   g_prioritySymbols[n] = sym;
   g_priorityExpires[n] = expiresAt;
}

bool ShouldSendQuote(const string sym, const datetime tickTime)
{
   datetime now = TimeCurrent();
   int n = ArraySize(g_quoteStateSym);
   for(int i = 0; i < n; i++)
   {
      if(g_quoteStateSym[i] == sym)
      {
         bool tickChanged = (g_quoteStateLastTickTime[i] != tickTime);
         bool resendDue = (g_quoteStateLastSentAt[i] == 0) || ((now - g_quoteStateLastSentAt[i]) >= MathMax(1, QuoteResendIntervalSec));
         if(tickChanged || resendDue)
         {
            g_quoteStateLastTickTime[i] = tickTime;
            g_quoteStateLastSentAt[i] = now;
            return(true);
         }
         return(false);
      }
   }

   if(n >= MaxQuoteStateCache)
   {
      RemoveAtString(g_quoteStateSym, 0);
      RemoveAtDatetime(g_quoteStateLastTickTime, 0);
      RemoveAtDatetime(g_quoteStateLastSentAt, 0);
      n = ArraySize(g_quoteStateSym);
   }
   ArrayResize(g_quoteStateSym, n + 1);
   ArrayResize(g_quoteStateLastTickTime, n + 1);
   ArrayResize(g_quoteStateLastSentAt, n + 1);
   g_quoteStateSym[n] = sym;
   g_quoteStateLastTickTime[n] = tickTime;
   g_quoteStateLastSentAt[n] = now;
   return(true);
}

bool PrepareMarketWatchAllSymbols()
{
   if(!AutoPopulateMarketWatch)
      return(true);

   int totalAll = SymbolsTotal(false);
   if(totalAll <= 0)
      return(true);

   int batch = MathMax(1, AutoPopulateBatchSize);
   int selectedNow = 0;
   int processed = 0;

   for(int i = g_marketWatchPrepareCursor; i < totalAll && selectedNow < MaxMarketWatchSymbols && processed < batch; i++)
   {
      string name = SymbolName(i, false);
      processed++;
      if(StringLen(name) <= 0)
         continue;

      if(SymbolSelect(name, true))
         selectedNow++;

      g_marketWatchPrepareCursor = i + 1;
   }

   if(g_marketWatchPrepareCursor >= totalAll)
   {
      Print("MarketWatch auto-populate done (cursor=", g_marketWatchPrepareCursor, " total=", totalAll, ")");
      return(true);
   }

   return(false);
}

string AccountMode()
{
   int mode = AccountNumber();
   return AccountServer() == "" ? "demo" : (StringFind(AccountServer(), "demo", 0) >= 0 ? "demo" : "real");
}

datetime DayStartTime(datetime t)
{
   string d = TimeToString(t, TIME_DATE);
   return StringToTime(d);
}

double ComputeDailyProfit()
{
   datetime dayStart = DayStartTime(TimeCurrent());
   double total = 0.0;
   int totalHistory = OrdersHistoryTotal();
   for(int i = totalHistory - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(OrderMagicNumber() != MagicNumber)
         continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL)
         continue;
      if(OrderCloseTime() < dayStart)
         continue;
      total += OrderProfit() + OrderSwap() + OrderCommission();
   }
   return total;
}

int CountDailyTrades()
{
   datetime dayStart = DayStartTime(TimeCurrent());
   int count = 0;
   int totalHistory = OrdersHistoryTotal();
   for(int i = totalHistory - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(OrderMagicNumber() != MagicNumber)
         continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL)
         continue;
      if(OrderCloseTime() < dayStart)
         continue;
      count++;
   }
   return count;
}

void UpdateDailyState()
{
   datetime now = TimeCurrent();
   if(g_dailyStart == 0 || DayStartTime(now) != g_dailyStart)
   {
      g_dailyStart = DayStartTime(now);
      g_dailyStartEquity = AccountEquity();
      g_dailyHalt = false;
      g_dailyHaltReason = "";
      g_dailyHaltLogged = false;
   }
}

bool IsDailyTradingAllowed()
{
   if(!EnableDailyGuards)
      return true;

   UpdateDailyState();

   double pnl = ComputeDailyProfit();
   double equity = g_dailyStartEquity > 0.0 ? g_dailyStartEquity : AccountEquity();

   if(DailyProfitTargetCurrency > 0.0 && pnl >= DailyProfitTargetCurrency)
   {
      g_dailyHalt = true;
      g_dailyHaltReason = "Daily profit target reached";
   }
   if(!g_dailyHalt && DailyProfitTargetPct > 0.0 && equity > 0.0 && pnl >= (equity * (DailyProfitTargetPct / 100.0)))
   {
      g_dailyHalt = true;
      g_dailyHaltReason = "Daily profit target (%) reached";
   }
   if(!g_dailyHalt && DailyMaxLossCurrency > 0.0 && pnl <= -DailyMaxLossCurrency)
   {
      g_dailyHalt = true;
      g_dailyHaltReason = "Daily max loss reached";
   }
   if(!g_dailyHalt && DailyMaxLossPct > 0.0 && equity > 0.0 && pnl <= -(equity * (DailyMaxLossPct / 100.0)))
   {
      g_dailyHalt = true;
      g_dailyHaltReason = "Daily max loss (%) reached";
   }

   if(!g_dailyHalt && EnforceMaxTradesPerDay && MaxTradesPerDay > 0)
   {
      int trades = CountDailyTrades();
      if(trades >= MaxTradesPerDay)
      {
         g_dailyHalt = true;
         g_dailyHaltReason = "Max trades per day reached";
      }
   }

   if(g_dailyHalt && !g_dailyHaltLogged)
   {
      Print("Daily guard active: ", g_dailyHaltReason);
      g_dailyHaltLogged = true;
   }

   return !g_dailyHalt;
}

string WebRequestHint(int lastErr, string url)
{
   if(lastErr == 4014)
      return "WebRequest blocked by terminal settings (4014). Allowlisted URL must include the host: http://127.0.0.1:4101";
   if(lastErr == 5203)
      return "Cannot connect to bridge (5203). Make sure the backend is running and listening on http://127.0.0.1:4101 (and port 4101 is free).";
   if(StringFind(url, "127.0.0.1", 0) >= 0 || StringFind(url, "localhost", 0) >= 0)
      return "Local bridge not reachable. Verify backend is started and firewall is not blocking local loopback.";
   return "";
}

bool JsonIsWhitespace(const int c)
{
   return (c == ' ' || c == 9 || c == 10 || c == 13);
}

int JsonSkipWhitespace(const string json, int pos)
{
   int n = StringLen(json);
   while(pos < n && JsonIsWhitespace(StringGetCharacter(json, pos)))
      pos++;
   return pos;
}

int JsonFindKeyOutsideString(const string json, const string key, const int startPos)
{
   int n = StringLen(json);
   int klen = StringLen(key);
   if(klen <= 0)
      return -1;

   bool inStr = false;
   bool esc = false;
   for(int i = MathMax(0, startPos); i <= n - klen; i++)
   {
      int c = StringGetCharacter(json, i);
      if(inStr)
      {
         if(esc)
         {
            esc = false;
            continue;
         }
         if(c == '\\')
         {
            esc = true;
            continue;
         }
         if(c == '"')
         {
            inStr = false;
            continue;
         }
         continue;
      }
      else
      {
         if(c == '"')
         {
            inStr = true;
            esc = false;
            continue;
         }
      }

      if(StringSubstr(json, i, klen) == key)
         return i;
   }
   return -1;
}

bool JsonReadStringValue(const string json, int pos, string &outValue, int &endPos)
{
   outValue = "";
   endPos = pos;
   int n = StringLen(json);
   if(pos < 0 || pos >= n)
      return false;
   if(StringGetCharacter(json, pos) != '"')
      return false;
   pos++;

   bool esc = false;
   string out = "";
   while(pos < n)
   {
      int c = StringGetCharacter(json, pos);
      if(esc)
      {
         if(c == 'n') out = StringConcatenate(out, "\n");
         else if(c == 'r') out = StringConcatenate(out, "\r");
         else if(c == 't') out = StringConcatenate(out, "\t");
         else out = StringConcatenate(out, StringSubstr(json, pos, 1));
         esc = false;
         pos++;
         continue;
      }
      if(c == '\\')
      {
         esc = true;
         pos++;
         continue;
      }
      if(c == '"')
      {
         endPos = pos + 1;
         outValue = out;
         return true;
      }
      out = StringConcatenate(out, StringSubstr(json, pos, 1));
      pos++;
   }
   return false;
}

bool JsonGetBool(const string json, const string key, bool &outValue)
{
   int pos = JsonFindKeyOutsideString(json, key, 0);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos = JsonSkipWhitespace(json, pos + 1);
   string tail = StringSubstr(json, pos, 8);
   StringToUpper(tail);
   if(StringFind(tail, "TRUE") == 0)
   {
      outValue = true;
      return true;
   }
   if(StringFind(tail, "FALSE") == 0)
   {
      outValue = false;
      return true;
   }
   return false;
}

bool JsonGetBoolFromPos(const string json, const int startPos, const string key, bool &outValue)
{
   int pos = JsonFindKeyOutsideString(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos = JsonSkipWhitespace(json, pos + 1);
   string tail = StringSubstr(json, pos, 8);
   StringToUpper(tail);
   if(StringFind(tail, "TRUE") == 0)
   {
      outValue = true;
      return true;
   }
   if(StringFind(tail, "FALSE") == 0)
   {
      outValue = false;
      return true;
   }
   return false;
}

bool JsonGetStringFromPos(const string json, const int startPos, const string key, string &outValue)
{
   int pos = JsonFindKeyOutsideString(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos = JsonSkipWhitespace(json, pos + 1);
   int endPos = pos;
   return JsonReadStringValue(json, pos, outValue, endPos);
}

bool JsonGetString(const string json, const string key, string &outValue)
{
   return JsonGetStringFromPos(json, 0, key, outValue);
}

bool JsonGetNumberFrom2(const string json, const int startPos, const string key, double &outValue)
{
   int pos = JsonFindKeyOutsideString(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos = JsonSkipWhitespace(json, pos + 1);
   int end = pos;
   while(end < StringLen(json))
   {
      int c = StringGetCharacter(json, end);
      if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E')
      {
         end++;
         continue;
      }
      break;
   }
   if(end <= pos)
      return false;
   outValue = StrToDouble(StringSubstr(json, pos, end - pos));
   return true;
}

bool JsonGetNumber(const string json, const string key, double &outValue)
{
   return JsonGetNumberFrom2(json, 0, key, outValue);
}

// Backwards-compatible helpers used by older code paths
bool JsonGetNumberFrom(const string src, const string key, double &value)
{
   return JsonGetNumberFrom2(src, 0, key, value);
}

bool JsonGetBoolFrom(const string src, const string key, bool &value)
{
   return JsonGetBoolFromPos(src, 0, key, value);
}

bool ParseSignalForExecution(const string json,
                             string &directionOut,
                             double &entryOut,
                             double &slOut,
                             double &tpOut,
                             double &lotsOut,
                             bool &shouldExecuteOut)
{
   shouldExecuteOut = true;
   if(SmartStrongMode)
   {
      bool tmp = true;
      int execPos = JsonFindKeyOutsideString(json, "\"execution\"", 0);
      if(execPos >= 0)
      {
         if(JsonGetBoolFromPos(json, execPos, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;
         else if(JsonGetBool(json, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;

         bool requireLayers = g_serverRequireLayers18;
         bool requireEnter = g_serverRequiresEnterState;
         JsonGetBoolFromPos(json, execPos, "\"requireLayers18\"", requireLayers);
         JsonGetBoolFromPos(json, execPos, "\"requiresEnterState\"", requireEnter);

         if(requireLayers)
         {
            bool layersOk = true;
            int layersPos = JsonFindKeyOutsideString(json, "\"layersStatus\"", execPos);
            if(layersPos >= 0)
            {
               bool okVal = true;
               if(JsonGetBoolFromPos(json, layersPos, "\"ok\"", okVal) && !okVal)
                  shouldExecuteOut = false;
            }
         }

         if(requireEnter)
         {
            string decision = "";
            int gatesPos = JsonFindKeyOutsideString(json, "\"gates\"", execPos);
            if(gatesPos < 0)
               gatesPos = execPos;
            if(JsonGetStringFromPos(json, gatesPos, "\"decisionState\"", decision) || JsonGetStringFromPos(json, gatesPos, "\"layer18State\"", decision))
            {
               StringToUpper(decision);
               if(decision != "ENTER")
                  shouldExecuteOut = false;
            }
         }
      }
      else
      {
         if(JsonGetBool(json, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;
      }
   }

   directionOut = "";
   int sigPos = JsonFindKeyOutsideString(json, "\"signal\"", 0);
   if(sigPos < 0)
      sigPos = 0;
   if(!JsonGetStringFromPos(json, sigPos, "\"direction\"", directionOut))
   {
      if(!JsonGetString(json, "\"direction\"", directionOut))
         return false;
   }
   StringToUpper(directionOut);
   if(directionOut == "LONG") directionOut = "BUY";
   if(directionOut == "SHORT") directionOut = "SELL";

   entryOut = 0.0;
   slOut = 0.0;
   tpOut = 0.0;

   int entryPos = JsonFindKeyOutsideString(json, "\"entry\"", 0);
   if(entryPos < 0)
      return false;
   if(!JsonGetNumberFrom2(json, entryPos, "\"price\"", entryOut))
      return false;
   JsonGetNumberFrom2(json, entryPos, "\"stopLoss\"", slOut);
   JsonGetNumberFrom2(json, entryPos, "\"takeProfit\"", tpOut);

   lotsOut = 0.0;
   int rmPos = JsonFindKeyOutsideString(json, "\"riskManagement\"", 0);
   if(rmPos >= 0)
      JsonGetNumberFrom2(json, rmPos, "\"positionSize\"", lotsOut);

   return true;
}

bool ExtractSignalDedupeKey(const string json, const string direction, const double entry, const double sl, const double tp, const double lots, const double strength, const double confidence, string &outKey)
{
   outKey = "";
   int sigPos = JsonFindKeyOutsideString(json, "\"signal\"", 0);
   if(sigPos < 0)
      sigPos = 0;
   string id = "";
   if(!JsonGetStringFromPos(json, sigPos, "\"id\"", id))
      JsonGetStringFromPos(json, sigPos, "\"signalId\"", id);
   string ts = "";
   if(!JsonGetStringFromPos(json, sigPos, "\"time\"", ts))
      JsonGetStringFromPos(json, sigPos, "\"timestamp\"", ts);

   if(StringLen(id) > 0)
   {
      outKey = id;
      if(StringLen(ts) > 0)
         outKey = StringConcatenate(id, "|", ts);
      return true;
   }

   outKey = StringConcatenate(direction,
                              "|", DoubleToString(entry, 5),
                              "|", DoubleToString(sl, 5),
                              "|", DoubleToString(tp, 5),
                              "|", DoubleToString(lots, 2),
                              "|", DoubleToString(strength, 0),
                              "|", DoubleToString(confidence, 0));
   return true;
}

bool FetchServerPolicy(bool logOnSuccess)
{
   string response = "";
   if(!BridgeRequest("GET", "/agent/config", "", response, false))
      return false;

   int policyPos = StringFind(response, "\"serverPolicy\"");
   if(policyPos < 0)
      return false;

   int execPos = StringFind(response, "\"execution\"", policyPos);
   if(execPos < 0)
      execPos = policyPos;

   double minC = g_serverMinConfidence;
   double minS = g_serverMinStrength;
   bool requireLayers = g_serverRequireLayers18;
   bool requireEnter = g_serverRequiresEnterState;

   JsonGetNumberFrom(response, "\"minConfidence\"", minC);
   JsonGetNumberFrom(response, "\"minStrength\"", minS);
   JsonGetBoolFrom(response, "\"requireLayers18\"", requireLayers);
   JsonGetBoolFrom(response, "\"requiresEnterState\"", requireEnter);

   g_serverMinConfidence = minC;
   g_serverMinStrength = minS;
   g_serverRequireLayers18 = requireLayers;
   g_serverRequiresEnterState = requireEnter;
   g_serverPolicyLoaded = true;
   g_lastServerPolicyFetch = TimeCurrent();

   if(logOnSuccess)
      Print("Server policy synced: minConfidence=", g_serverMinConfidence,
            " minStrength=", g_serverMinStrength,
            " requireLayers18=", g_serverRequireLayers18,
            " requiresEnterState=", g_serverRequiresEnterState);

   return true;
}

bool HttpRequest(string method,
                 string path,
                 string payload,
                 string &response)
{
   char result[];
   string headers = "Content-Type: application/json\r\n";
   if(StringLen(ApiToken) > 0)
      headers = headers + "Authorization: Bearer " + ApiToken + "\r\n";
   uchar body[];
   int length = StringToCharArray(payload, body);
   // Strip trailing NUL terminator to avoid sending extra bytes after JSON.
   if(length > 0 && body[length - 1] == 0)
      ArrayResize(body, length - 1);

   // Allow leaving BridgeUrl empty ("just attach EA"), defaulting to local bridge.
   string baseUrl = StringLen(BridgeUrl) > 0 ? BridgeUrl : "http://127.0.0.1:4101/api/broker/bridge/mt4";
   string url = baseUrl;
   if(StringSubstr(path, 0, 1) != "/")
      url = url + "/" + path;
   else
      url = url + path;

   ResetLastError();
   int status = WebRequest(method, url, headers, RequestTimeoutMs, body, result, NULL);
   g_lastHttpStatus = status;
   if(status == -1)
   {
      g_lastWebError = GetLastError();
      Print("WebRequest error: ", g_lastWebError, " url=", url);
      if(g_lastWebError == 4014)
      {
         Print("WebRequest blocked by terminal settings (4014). Fix:");
         Print("1) Tools -> Options -> Expert Advisors");
         Print("2) Enable: 'Allow WebRequest for listed URL'");
         Print("3) Add this URL exactly: http://127.0.0.1:4101");
         Print("(Must match BridgeUrl host; restart EA after adding.)");
      }
      string hint = WebRequestHint(g_lastWebError, url);
      if(StringLen(hint) > 0)
         Print("Hint: ", hint);
      return(false);
   }

   // Treat non-HTTP return codes (e.g., 1001) as transport failures.
   if(status < 100 || status > 599)
   {
      g_lastWebError = GetLastError();
      Print("WebRequest transport failure: code=", status, " lastErr=", g_lastWebError, " url=", url);
      string hint2 = WebRequestHint(g_lastWebError, url);
      if(StringLen(hint2) > 0)
         Print("Hint: ", hint2);
      return(false);
   }

   response = CharArrayToString(result);
   if(status >= 200 && status < 300)
      return(true);

   Print("Bridge request failed: ", status, " -> ", response);
   return(false);
}

bool ShouldCountBridgeFailure(int status)
{
   if(status == -1) return(true);
   if(status == 0) return(true);
   if(status == 408) return(true);
   if(status == 429) return(true);
   if(status >= 500) return(true);
   return(false);
}

void RecordBridgeFailure()
{
   g_consecutiveFailures++;
   if(MaxConsecutiveFailures < 1)
      return;
   if(g_consecutiveFailures >= MaxConsecutiveFailures)
   {
      g_isConnected = false;
      g_nextReconnectAt = TimeCurrent() + MathMax(1, ReconnectBackoffSec);
      Print("Bridge unhealthy (status=", g_lastHttpStatus, ", webErr=", g_lastWebError, "). Reconnecting soon...");
   }
}

void RecordBridgeSuccess()
{
   g_consecutiveFailures = 0;
   g_lastWebError = 0;
}

bool BridgeRequest(string method, string path, string payload, string &response, bool affectsConnection)
{
   bool ok = HttpRequest(method, path, payload, response);
   if(ok)
   {
      RecordBridgeSuccess();
      return(true);
   }
   if(affectsConnection && ShouldCountBridgeFailure(g_lastHttpStatus))
      RecordBridgeFailure();
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
   payload = StringConcatenate(
      payload,
      ",\"ea\":{",
      "\"platform\":\"mt4\"",
      ",\"respectServerExecution\":", SmartStrongMode ? "true" : "false",
      ",\"tradeMajorsAndMetalsOnly\":", TradeMajorsAndMetalsOnly ? "true" : "false",
      ",\"maxFreeMarginUsagePct\":", DoubleToString(MaxFreeMarginUsagePct, 3),
      ",\"maxSpreadPoints\":", IntegerToString(MaxSpreadPoints),
      ",\"smartStrongMode\":", SmartStrongMode ? "true" : "false",
      ",\"smartMinAtrPips\":", DoubleToString(SmartMinAtrPips, 2),
      ",\"smartMaxAtrPips\":", DoubleToString(SmartMaxAtrPips, 2),
      ",\"smartMaxSpreadToAtrPct\":", DoubleToString(SmartMaxSpreadToAtrPct, 2),
      ",\"enableDailyGuards\":", EnableDailyGuards ? "true" : "false",
      ",\"dailyProfitTargetCurrency\":", DoubleToString(DailyProfitTargetCurrency, 2),
      ",\"dailyProfitTargetPct\":", DoubleToString(DailyProfitTargetPct, 2),
      ",\"dailyMaxLossCurrency\":", DoubleToString(DailyMaxLossCurrency, 2),
      ",\"dailyMaxLossPct\":", DoubleToString(DailyMaxLossPct, 2),
      ",\"enforceMaxTradesPerDay\":", EnforceMaxTradesPerDay ? "true" : "false",
      ",\"maxTradesPerDay\":", IntegerToString(MaxTradesPerDay),
      "}");
   payload = StringConcatenate(payload, "}");
   return(payload);
}

bool SendSessionConnect()
{
   string payload = BuildSessionPayload(true);
   payload = StringSubstr(payload, 0, StringLen(payload) - 1) + ",\"broker\":\"mt4\"}";

   string response = "";
   if(BridgeRequest("POST", "/session/connect", payload, response, true))
   {
      g_isConnected = true;
      g_sentConnectNews = false;
      g_marketWatchPrepared = false;
      g_marketFeedCursor = 0;

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
   g_nextReconnectAt = TimeCurrent() + MathMax(1, ReconnectBackoffSec);
   return(false);
}

bool PostConnectNewsOnce()
{
   if(g_sentConnectNews || !g_isConnected)
      return(true);

   string id = StringConcatenate("mt4-connect-", AccountNumber(), "-", TimeCurrent());
   string title = StringConcatenate("MT4 connected (", AccountMode(), ") ", AccountServer());
   string notes = StringConcatenate(
      "Equity ", DoubleToString(AccountEquity(), 2),
      " Balance ", DoubleToString(AccountBalance(), 2),
      " Currency ", AccountCurrency()
   );

   string payload = "{\"items\":[";
   payload = StringConcatenate(
      payload,
      "{\"id\":\"", id, "\",\"title\":\"", title, "\",\"time\":", TimeCurrent(),
      ",\"impact\":\"info\",\"source\":\"ea\",\"notes\":\"", notes, "\"}",
      "]}"
   );

   string response = "";
   if(BridgeRequest("POST", "/market/news", payload, response, true))
   {
      g_sentConnectNews = true;
      return(true);
   }
   return(false);
}

bool PostMarketQuotes()
{
   if(!EnableMarketFeed)
      return(true);
   if(!g_isConnected)
      return(false);

   PrunePrioritySymbols();

   string symbols[];
   int symbolCount = 0;
   if(StringLen(FeedSymbolsCsv) > 0)
   {
      string tmp = FeedSymbolsCsv;
      StringReplace(tmp, " ", "");
      symbolCount = StringSplit(tmp, ',', symbols);
      if(symbolCount > 0)
      {
         int kept = 0;
         for(int i = 0; i < symbolCount; i++)
         {
            if(StringLen(symbols[i]) <= 0)
               continue;
            if(!IsTradeSymbolEligible(symbols[i]))
               continue;
            symbols[kept] = symbols[i];
            kept++;
         }
         symbolCount = kept;
         ArrayResize(symbols, symbolCount);
      }
   }
   if(symbolCount <= 0)
   {
      ArrayResize(symbols, 1);
      symbols[0] = Symbol();
      symbolCount = 1;
   }

   // If the dashboard provided an active symbol list, only stream those symbols.
   int activeN = ArraySize(g_activeSymbols);
   if(activeN > 0)
   {
      string activeList[];
      ArrayResize(activeList, 0);

      for(int i = 0; i < activeN && ArraySize(activeList) < MaxActiveSymbols; i++)
      {
         string raw = g_activeSymbols[i];
         if(StringLen(raw) <= 0)
            continue;
         string resolved = ResolveBrokerSymbol(raw);
         if(StringLen(resolved) <= 0)
            continue;
         if(!IsTradeSymbolEligible(resolved))
            continue;

         bool exists = false;
         int n = ArraySize(activeList);
         for(int j = 0; j < n; j++)
         {
            if(activeList[j] == resolved)
            {
               exists = true;
               break;
            }
         }
         if(exists)
            continue;

         ArrayResize(activeList, n + 1);
         activeList[n] = resolved;
      }

      // Always include chart symbol
      string chartSym = Symbol();
      if(StringLen(chartSym) > 0 && IsTradeSymbolEligible(chartSym))
      {
         bool exists = false;
         for(int j = 0; j < ArraySize(activeList); j++)
         {
            if(activeList[j] == chartSym)
            {
               exists = true;
               break;
            }
         }
         if(!exists)
         {
            int n = ArraySize(activeList);
            ArrayResize(activeList, n + 1);
            activeList[n] = chartSym;
         }
      }

      ArrayResize(symbols, ArraySize(activeList));
      for(int k = 0; k < ArraySize(activeList); k++)
         symbols[k] = activeList[k];
      symbolCount = ArraySize(activeList);
   }

   if(IncludeMarketWatch && ArraySize(g_activeSymbols) <= 0)
   {
      int total = SymbolsTotal(true);
      for(int i = 0; i < total && symbolCount < MaxSymbolsToSend; i++)
      {
         string name = SymbolName(i, true);
         if(StringLen(name) <= 0)
            continue;
         if(!IsTradeSymbolEligible(name))
            continue;
         bool exists = false;
         for(int j = 0; j < symbolCount; j++)
         {
            if(symbols[j] == name)
            {
               exists = true;
               break;
            }
         }
         if(exists)
            continue;
         int newSize = symbolCount + 1;
         ArrayResize(symbols, newSize);
         symbols[newSize - 1] = name;
         symbolCount = newSize;
      }
   }

   string payload = "{\"quotes\":[";
   int added = 0;

   int perPost = MaxQuotesPerPost;
   if(perPost <= 0)
      perPost = 50;
   int maxThisPost = MathMin(MaxSymbolsToSend, perPost);
   if(maxThisPost < 1)
      maxThisPost = 1;

   // 1) Priority symbols first
   if(EnablePrioritySymbols)
   {
      int prioN = ArraySize(g_prioritySymbols);
      int prioCap = MaxPriorityQuotesPerPost;
      if(prioCap <= 0) prioCap = 10;
      for(int i = 0; i < prioN && added < maxThisPost && i < prioCap; i++)
      {
         string sym = g_prioritySymbols[i];
         if(StringLen(sym) <= 0)
            continue;
         if(!IsTradeSymbolEligible(sym))
            continue;

         double bid = MarketInfo(sym, MODE_BID);
         double ask = MarketInfo(sym, MODE_ASK);
         if(bid <= 0 || ask <= 0)
            continue;

         datetime tickTime = (datetime)MarketInfo(sym, MODE_TIME);
         if(tickTime <= 0)
            tickTime = TimeCurrent();
         if(!ShouldSendQuote(sym, tickTime))
            continue;

         int digits = (int)MarketInfo(sym, MODE_DIGITS);
         double point = MarketInfo(sym, MODE_POINT);
         double spreadPoints = -1.0;
         if(point > 0.0)
            spreadPoints = (ask - bid) / point;

         if(added > 0)
            payload += ",";
         payload += StringConcatenate(
            "{\"symbol\":\"", sym,
            "\",\"bid\":", DoubleToString(bid, 10),
            ",\"ask\":", DoubleToString(ask, 10),
            ",\"last\":", DoubleToString((bid + ask) / 2.0, 10),
            ",\"digits\":", IntegerToString(digits),
            ",\"point\":", DoubleToString(point, 10),
            ",\"spreadPoints\":", DoubleToString(spreadPoints, 2),
            ",\"timestamp\":", TimeCurrent(), "}"
         );
         added++;
      }
   }

   // 2) Always include chart symbol (if not already priority)
   if(added < maxThisPost)
   {
      string chartSym = Symbol();
      if(StringLen(chartSym) > 0)
      {
         bool isPrio = false;
         int prioN = ArraySize(g_prioritySymbols);
         for(int p = 0; p < prioN; p++)
         {
            if(g_prioritySymbols[p] == chartSym)
            {
               isPrio = true;
               break;
            }
         }

         if(!isPrio)
         {
            double bid = MarketInfo(chartSym, MODE_BID);
            double ask = MarketInfo(chartSym, MODE_ASK);
            if(bid > 0 && ask > 0)
            {
               datetime tickTime = (datetime)MarketInfo(chartSym, MODE_TIME);
               if(tickTime <= 0)
                  tickTime = TimeCurrent();
               if(ShouldSendQuote(chartSym, tickTime))
               {
                  int digits = (int)MarketInfo(chartSym, MODE_DIGITS);
                  double point = MarketInfo(chartSym, MODE_POINT);
                  double spreadPoints = -1.0;
                  if(point > 0.0)
                     spreadPoints = (ask - bid) / point;

                  if(added > 0)
                     payload += ",";
                  payload += StringConcatenate(
                     "{\"symbol\":\"", chartSym,
                     "\",\"bid\":", DoubleToString(bid, 10),
                     ",\"ask\":", DoubleToString(ask, 10),
                     ",\"last\":", DoubleToString((bid + ask) / 2.0, 10),
                     ",\"digits\":", IntegerToString(digits),
                     ",\"point\":", DoubleToString(point, 10),
                     ",\"spreadPoints\":", DoubleToString(spreadPoints, 2),
                     ",\"timestamp\":", TimeCurrent(), "}"
                  );
                  added++;
               }
            }
         }
      }
   }

   // 3) Rotate through remaining symbols
   int start = 0;
   if(symbolCount > 0)
      start = (int)(g_marketFeedCursor % symbolCount);

   for(int k = 0; k < symbolCount && added < maxThisPost; k++)
   {
      int idx = (start + k) % symbolCount;
      string sym = symbols[idx];
      if(StringLen(sym) <= 0)
         continue;

      bool isPrio = false;
      int prioN = ArraySize(g_prioritySymbols);
      for(int p = 0; p < prioN; p++)
      {
         if(g_prioritySymbols[p] == sym)
         {
            isPrio = true;
            break;
         }
      }
      if(isPrio)
         continue;

      double bid = MarketInfo(sym, MODE_BID);
      double ask = MarketInfo(sym, MODE_ASK);
      if(bid <= 0 || ask <= 0)
         continue;

      datetime tickTime = (datetime)MarketInfo(sym, MODE_TIME);
      if(tickTime <= 0)
         tickTime = TimeCurrent();
      if(!ShouldSendQuote(sym, tickTime))
         continue;

      int digits = (int)MarketInfo(sym, MODE_DIGITS);
      double point = MarketInfo(sym, MODE_POINT);
      double spreadPoints = -1.0;
      if(point > 0.0)
         spreadPoints = (ask - bid) / point;

      if(added > 0)
         payload += ",";
      payload += StringConcatenate(
         "{\"symbol\":\"", sym,
         "\",\"bid\":", DoubleToString(bid, 10),
         ",\"ask\":", DoubleToString(ask, 10),
         ",\"last\":", DoubleToString((bid + ask) / 2.0, 10),
         ",\"digits\":", IntegerToString(digits),
         ",\"point\":", DoubleToString(point, 10),
         ",\"spreadPoints\":", DoubleToString(spreadPoints, 2),
         ",\"timestamp\":", TimeCurrent(), "}"
      );
      added++;
   }

   if(symbolCount > 0)
   {
      int adv = added;
      if(adv < 1)
         adv = 1;
      g_marketFeedCursor = (start + adv) % symbolCount;
   }
   payload += "]}";

   if(added <= 0)
      return(true);

   string response = "";
   return(BridgeRequest("POST", "/market/quotes", payload, response, true));
}

string TfLabel(int tf)
{
   if(tf == PERIOD_M15) return("M15");
   if(tf == PERIOD_H1)  return("H1");
   if(tf == PERIOD_H4)  return("H4");
   if(tf == PERIOD_D1)  return("D1");
   return("M15");
}

int TfFromLabel(string tf)
{
   string t = tf;
   StringToUpper(t);
   if(t == "M15") return(PERIOD_M15);
   if(t == "H1")  return(PERIOD_H1);
   if(t == "H4")  return(PERIOD_H4);
   if(t == "D1")  return(PERIOD_D1);
   return(PERIOD_M15);
}

string ScoreDirectionFromIndicators(double rsi, double macdHist, double &scoreOut)
{
   scoreOut = 0.0;
   if(rsi <= 0.0)
      return("NEUTRAL");

   double score = MathAbs(rsi - 50.0) * 2.0;
   if(score > 100.0) score = 100.0;
   scoreOut = score;

   if(rsi >= 55.0 && macdHist > 0.0)
      return("BUY");
   if(rsi <= 45.0 && macdHist < 0.0)
      return("SELL");
   return("NEUTRAL");
}

bool PostMarketSnapshot()
{
   return PostMarketSnapshotForSymbol(Symbol());
}

bool PostMarketBars()
{
   PrunePrioritySymbols();

   string sym = Symbol();

   int activeN = ArraySize(g_activeSymbols);
   if(activeN > 0)
   {
      int idx = 0;
      if(g_activeCursor < 0)
         g_activeCursor = 0;
      idx = (int)(g_activeCursor % activeN);
      g_activeCursor++;
      sym = ResolveBrokerSymbol(g_activeSymbols[idx]);
   }
   else if(EnablePrioritySymbols && ArraySize(g_prioritySymbols) > 0)
   {
      sym = g_prioritySymbols[0];
   }

   if(StringLen(sym) <= 0)
      sym = Symbol();
   if(!IsTradeSymbolEligible(sym))
      return(false);

   // M1 is sent as an intra-candle "moving" bar for UI.
   bool ok = PostMarketBarsForSymbol(sym, PERIOD_M1, "M1");

   // Higher timeframes: send only on closed candle to avoid continuous recomputation.
   PostClosedMarketBarForSymbol(sym, PERIOD_M15, "M15");
   PostClosedMarketBarForSymbol(sym, PERIOD_H1, "H1");
   PostClosedMarketBarForSymbol(sym, PERIOD_H4, "H4");
   PostClosedMarketBarForSymbol(sym, PERIOD_D1, "D1");

   return(ok);
}

bool PostMarketBarsForSymbol(string sym, int tf, string tfLabel)
{
   if(!g_isConnected)
      return false;

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return false;

   double o = iOpen(sym, tf, 0);
   double h = iHigh(sym, tf, 0);
   double l = iLow(sym, tf, 0);
   double c = iClose(sym, tf, 0);
   datetime t = iTime(sym, tf, 0);
   long v = (long)iVolume(sym, tf, 0);

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%d,\"bar\":{\"time\":%d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%d}}",
      sym,
      tfLabel,
      TimeCurrent(),
      t,
      o,
      h,
      l,
      c,
      v
   );

   string response = "";
   return BridgeRequest("POST", "/market/bars", payload, response, true);
}

int FindClosedBarStateIndex(const string key)
{
   int n = ArraySize(g_closedBarKey);
   for(int i = 0; i < n; i++)
   {
      if(g_closedBarKey[i] == key)
         return i;
   }
   return -1;
}

bool PostClosedMarketBarForSymbol(string sym, int tf, string tfLabel)
{
   if(!g_isConnected)
      return(false);

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return(false);

   // shift=1 => last CLOSED bar
   datetime t = iTime(sym, tf, 1);
   if(t <= 0)
      return(true);

   string key = sym + "|" + tfLabel;
   int idx = FindClosedBarStateIndex(key);
   if(idx >= 0 && g_closedBarLastTime[idx] == t)
      return(true);

   double o = iOpen(sym, tf, 1);
   double h = iHigh(sym, tf, 1);
   double l = iLow(sym, tf, 1);
   double c = iClose(sym, tf, 1);
   long v = (long)iVolume(sym, tf, 1);

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%d,\"closed\":true,\"bar\":{\"time\":%d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%d}}",
      sym,
      tfLabel,
      TimeCurrent(),
      t,
      o,
      h,
      l,
      c,
      v
   );

   string response = "";
   bool ok = BridgeRequest("POST", "/market/bars", payload, response, true);
   if(!ok)
      return(false);

   if(idx < 0)
   {
      int n2 = ArraySize(g_closedBarKey);
      ArrayResize(g_closedBarKey, n2 + 1);
      ArrayResize(g_closedBarLastTime, n2 + 1);
      g_closedBarKey[n2] = key;
      g_closedBarLastTime[n2] = t;
   }
   else
   {
      g_closedBarLastTime[idx] = t;
   }

   return(true);
}

int JsonExtractSymbolsArray(const string json, string &outSymbols[])
{
   ArrayResize(outSymbols, 0);
   int keyPos = StringFind(json, "\"symbols\"");
   if(keyPos < 0)
      return 0;
   int start = StringFind(json, "[", keyPos);
   int end = StringFind(json, "]", start);
   if(start < 0 || end < 0 || end <= start)
      return 0;
   string body = StringSubstr(json, start + 1, end - start - 1);

   int pos = 0;
   while(pos < StringLen(body))
   {
      int q1 = StringFind(body, "\"", pos);
      if(q1 < 0)
         break;
      int q2 = StringFind(body, "\"", q1 + 1);
      if(q2 < 0)
         break;
      string sym = StringSubstr(body, q1 + 1, q2 - q1 - 1);
         StringTrimLeft(sym);
         StringTrimRight(sym);
      if(StringLen(sym) > 0)
      {
         int n = ArraySize(outSymbols);
         ArrayResize(outSymbols, n + 1);
         outSymbols[n] = sym;
      }
      pos = q2 + 1;
   }
   return ArraySize(outSymbols);
}

bool PollActiveSymbols()
{
   if(!EnableActiveSymbolsPolling)
      return(true);
   if(!g_activeSymbolsEndpointSupported)
      return(true);
   if(!g_isConnected)
      return(false);

   int cap = MaxActiveSymbols;
   if(cap <= 0)
      cap = 40;

   string response = "";
   string path = StringFormat("/market/active-symbols?max=%d", cap);
   if(!BridgeRequest("GET", path, "", response, true))
   {
      // Backward-compat: older servers may not implement active-symbols yet.
      if(g_lastHttpStatus == 404)
      {
         g_activeSymbolsEndpointSupported = false;
         ArrayResize(g_activeSymbols, 0);
         Print("Active symbols endpoint not found (404). Disabling polling and falling back to MarketWatch rotation.");
         return(true);
      }
      return(false);
   }

   string symbols[];
   int count = JsonExtractSymbolsArray(response, symbols);
   if(count < 0)
      return(true);

   ArrayResize(g_activeSymbols, 0);
   for(int i = 0; i < count && i < cap; i++)
   {
      string sym = symbols[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) <= 0)
         continue;
      int n = ArraySize(g_activeSymbols);
      ArrayResize(g_activeSymbols, n + 1);
      g_activeSymbols[n] = sym;
   }
   return(true);
}

bool PollAndFulfillSnapshotRequests()
{
   if(!g_isConnected)
      return(false);

   string response = "";
   if(!BridgeRequest("GET", "/market/snapshot/requests?max=10", "", response, true))
      return(false);

   string symbols[];
   int count = JsonExtractSymbolsArray(response, symbols);
   if(count <= 0)
      return(true);

   for(int i = 0; i < count; i++)
   {
      string sym = symbols[i];
      if(StringLen(sym) <= 0)
         continue;
      string resolved = ResolveBrokerSymbol(sym);
      AddPrioritySymbol(resolved);
      PostMarketSnapshotForSymbol(resolved);
      PostMarketBarsForSymbol(resolved, PERIOD_M1, "M1");

      // Best-effort: also push closed higher-timeframe bars to support on-demand analysis.
      PostClosedMarketBarForSymbol(resolved, PERIOD_M15, "M15");
      PostClosedMarketBarForSymbol(resolved, PERIOD_H1, "H1");
      PostClosedMarketBarForSymbol(resolved, PERIOD_H4, "H4");
      PostClosedMarketBarForSymbol(resolved, PERIOD_D1, "D1");
   }
   return(true);
}

bool PostMarketSnapshotForSymbol(string sym)
{
   if(!EnableMarketSnapshot)
      return(true);
   if(!g_isConnected)
      return(false);

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return(false);

   // Ensure symbol is available in MarketWatch
   SymbolSelect(sym, true);

   int digits = (int)MarketInfo(sym, MODE_DIGITS);

   // Compute ranges
   double todayHigh = iHigh(sym, PERIOD_D1, 0);
   double todayLow  = iLow(sym,  PERIOD_D1, 0);
   double weekHigh  = iHigh(sym, PERIOD_W1, 0);
   double weekLow   = iLow(sym,  PERIOD_W1, 0);
   double monthHigh = iHigh(sym, PERIOD_MN1, 0);
   double monthLow  = iLow(sym,  PERIOD_MN1, 0);

   // Classic pivot based on previous day
   double prevHigh  = iHigh(sym, PERIOD_D1, 1);
   double prevLow   = iLow(sym,  PERIOD_D1, 1);
   double prevClose = iClose(sym, PERIOD_D1, 1);
   double pivot = 0.0, r1 = 0.0, s1 = 0.0;
   if(prevHigh > 0 && prevLow > 0 && prevClose > 0)
   {
      pivot = (prevHigh + prevLow + prevClose) / 3.0;
      r1 = 2.0 * pivot - prevLow;
      s1 = 2.0 * pivot - prevHigh;
   }

   string tfs[4];
   tfs[0] = "M15";
   tfs[1] = "H1";
   tfs[2] = "H4";
   tfs[3] = "D1";

   string payload = StringConcatenate(
      "{\"symbol\":\"", sym,
      "\",\"timestamp\":", TimeCurrent(),
      ",\"timeframes\":{"
   );

   for(int i = 0; i < 4; i++)
   {
      string tfLabel = tfs[i];
      int tf = TfFromLabel(tfLabel);

      double rsi = iRSI(sym, tf, 14, PRICE_CLOSE, 0);
      double macdMain = iMACD(sym, tf, 12, 26, 9, PRICE_CLOSE, MODE_MAIN, 0);
      double macdSignal = iMACD(sym, tf, 12, 26, 9, PRICE_CLOSE, MODE_SIGNAL, 0);
      double macdHist = macdMain - macdSignal;
      double atr = iATR(sym, tf, 14, 0);

      double o = iOpen(sym, tf, 0);
      double h = iHigh(sym, tf, 0);
      double l = iLow(sym, tf, 0);
      double c = iClose(sym, tf, 0);
      datetime t = iTime(sym, tf, 0);

      double score = 0.0;
      string dir = ScoreDirectionFromIndicators(rsi, macdHist, score);

      if(i > 0)
         payload += ",";

      payload += StringConcatenate(
         "\"", tfLabel, "\":{",
         "\"timeframe\":\"", tfLabel, "\"",
         ",\"direction\":\"", dir, "\"",
         ",\"score\":", DoubleToString(score, 2),
         ",\"lastPrice\":", DoubleToString(c, digits > 5 ? 8 : 6),
         ",\"latestCandle\":{",
            "\"open\":", DoubleToString(o, digits > 5 ? 8 : 6),
            ",\"high\":", DoubleToString(h, digits > 5 ? 8 : 6),
            ",\"low\":", DoubleToString(l, digits > 5 ? 8 : 6),
            ",\"close\":", DoubleToString(c, digits > 5 ? 8 : 6),
            ",\"time\":", (int)t,
         "}",
         ",\"indicators\":{",
            "\"rsi\":{\"value\":", DoubleToString(rsi, 2), "},",
            "\"macd\":{\"histogram\":", DoubleToString(macdHist, 8), "},",
            "\"atr\":{\"value\":", DoubleToString(atr, digits > 5 ? 8 : 6), "}",
         "}"
      );

      if(tfLabel == "D1")
      {
         payload += StringConcatenate(
            ",\"ranges\":{",
              "\"day\":{\"high\":", DoubleToString(todayHigh, 10), ",\"low\":", DoubleToString(todayLow, 10), "},",
              "\"week\":{\"high\":", DoubleToString(weekHigh, 10), ",\"low\":", DoubleToString(weekLow, 10), "},",
              "\"month\":{\"high\":", DoubleToString(monthHigh, 10), ",\"low\":", DoubleToString(monthLow, 10), "}",
            "}",
            ",\"pivotPoints\":{\"pivot\":", DoubleToString(pivot, 10), ",\"r1\":", DoubleToString(r1, 10), ",\"s1\":", DoubleToString(s1, 10), "}"
         );
      }

      payload += "}";
   }

   payload += "}}";

   string response = "";
   if(BridgeRequest("POST", "/market/snapshot", payload, response, true))
   {
      return(true);
   }
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
   string payload = StringConcatenate(
      "{\"timestamp\":", TimeCurrent(),
      ",\"equity\":", DoubleToString(AccountEquity(), 2),
      ",\"accountMode\":\"", AccountMode(), "\"",
      ",\"accountNumber\":\"", AccountNumber(), "\"}"
   );
   string response = "";
   if(BridgeRequest("POST", "/agent/heartbeat", payload, response, true))
   {
      g_lastHeartbeat = TimeCurrent();
      return(true);
   }
   return(false);
}

int OnInit()
{
   // Don't fail init if the bridge is down; keep EA alive and auto-reconnect.
   if(!SendSessionConnect())
      Print("Bridge not connected yet. EA will keep trying (check URL/token/WebRequest allowlist)." );
   if(SmartStrongMode)
      FetchServerPolicy(true);
   EventSetTimer(1);
   return(INIT_SUCCEEDED);
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
      if(g_nextReconnectAt != 0 && TimeCurrent() < g_nextReconnectAt)
         return;
      SendSessionConnect();
      return;
   }

   if(EnableMarketFeed && IncludeMarketWatch && AutoPopulateMarketWatch && !g_marketWatchPrepared)
   {
      bool done = PrepareMarketWatchAllSymbols();
      if(done)
         g_marketWatchPrepared = true;
   }

   // Send heartbeat
   if(TimeCurrent() - g_lastHeartbeat >= HeartbeatInterval)
   {
      if(!SendHeartbeat())
         Print("Heartbeat failed");
   }

   // Periodically refresh server policy (keeps MT4 aligned with backend config changes).
   if(SmartStrongMode && ServerPolicyRefreshSec > 0)
   {
      if(g_lastServerPolicyFetch == 0 || (TimeCurrent() - g_lastServerPolicyFetch) >= ServerPolicyRefreshSec)
         FetchServerPolicy(false);
   }

   // Poll active symbols from dashboard/server (lazy loading)
   if(EnableActiveSymbolsPolling && g_activeSymbolsEndpointSupported && (g_lastActiveSymbolsPoll == 0 || (TimeCurrent() - g_lastActiveSymbolsPoll) >= ActiveSymbolsPollIntervalSec))
   {
      if(PollActiveSymbols())
         g_lastActiveSymbolsPoll = TimeCurrent();
   }

   // One-time connect news so the ticker can confirm ingestion.
   PostConnectNewsOnce();

   // Push quotes for the ticker
   if(EnableMarketFeed && (g_lastMarketFeed == 0 || (TimeCurrent() - g_lastMarketFeed) >= MarketFeedIntervalSec))
   {
      if(PostMarketQuotes())
         g_lastMarketFeed = TimeCurrent();
   }

   // Push a lightweight M1 bar so the dashboard can render a moving candle.
   int barsInterval = MarketBarsIntervalSec;
   if(barsInterval <= 0)
      barsInterval = MarketFeedIntervalSec;

   if(EnableMarketFeed && (g_lastMarketBars == 0 || (TimeCurrent() - g_lastMarketBars) >= barsInterval))
   {
      if(PostMarketBars())
         g_lastMarketBars = TimeCurrent();
   }

   // Push indicator snapshot (for analyzer modal)
   if(EnableMarketSnapshot && (g_lastMarketSnapshot == 0 || (TimeCurrent() - g_lastMarketSnapshot) >= MarketSnapshotIntervalSec))
   {
      if(PostMarketSnapshot())
         g_lastMarketSnapshot = TimeCurrent();
   }

   // Poll on-demand snapshot requests from dashboard (fast)
   if(EnableMarketSnapshot && (g_lastSnapshotRequestPoll == 0 || (TimeCurrent() - g_lastSnapshotRequestPoll) >= 5))
   {
      if(PollAndFulfillSnapshotRequests())
         g_lastSnapshotRequestPoll = TimeCurrent();
   }

   // Check for new signals if auto-trading is enabled
   if(EnableAutoTrading && g_autoTradingActive)
   {
      if(TimeCurrent() - g_lastSignalCheck >= g_signalCheckInterval)
      {
         if(IsDailyTradingAllowed())
            CheckAndExecuteSignals();
         g_lastSignalCheck = TimeCurrent();
      }
   }

   // On-chart signal overlay (independent of auto-trading)
   if(EnableSignalOverlay && (g_lastSignalOverlay == 0 || (TimeCurrent() - g_lastSignalOverlay) >= SignalOverlayIntervalSec))
   {
      UpdateSignalOverlay();
      g_lastSignalOverlay = TimeCurrent();
   }

   // Monitor and manage open positions
   ManageOpenPositions();

   // Smart close on opposite strong signal
   if(SmartStrongMode && SmartStrongCloseOnOpposite)
      CheckSmartCloseOppositeSignals();

   // Server-guided position management + command polling
   if(EnableServerPositionSync && (g_lastPositionSync == 0 || (TimeCurrent() - g_lastPositionSync) >= PositionSyncIntervalSec))
   {
      if(PostPositionManagement(true))
         g_lastPositionSync = TimeCurrent();
   }

   if(EnableCommandPolling && (g_lastCommandPoll == 0 || (TimeCurrent() - g_lastCommandPoll) >= CommandPollIntervalSec))
   {
      if(PollManagementCommands())
         g_lastCommandPoll = TimeCurrent();
   }
}

void ClearSignalOverlayObjects()
{
   ObjectDelete("SG_SIG_ARROW");
   ObjectDelete("SG_SIG_TEXT");
}

void DrawSignalOverlay(const string direction)
{
   datetime t = Time[0];
   double price = (direction == "sell") ? Bid : Ask;
   int arrowCode = (direction == "sell") ? 234 : 233;
   color arrowColor = (direction == "sell") ? clrRed : clrLime;

   ObjectDelete("SG_SIG_ARROW");
   ObjectCreate("SG_SIG_ARROW", OBJ_ARROW, 0, t, price);
   ObjectSet("SG_SIG_ARROW", OBJPROP_COLOR, arrowColor);
   ObjectSet("SG_SIG_ARROW", OBJPROP_ARROWCODE, arrowCode);
   ObjectSet("SG_SIG_ARROW", OBJPROP_WIDTH, 2);

   string dir = direction;
   StringToUpper(dir);
   string label = StringConcatenate(dir, " signal");
   ObjectDelete("SG_SIG_TEXT");
   ObjectCreate("SG_SIG_TEXT", OBJ_TEXT, 0, t, price);
   ObjectSetText("SG_SIG_TEXT", label, 9, "Arial", arrowColor);
}

void UpdateSignalOverlay()
{
   if(!g_isConnected)
      return;

   string response = "";
   string path = StringConcatenate(
      "/signal/get?symbol=", Symbol(),
      "&accountMode=", AccountMode(),
      "&timeframe=", Period(),
      "&broker=mt4"
   );

   if(!BridgeRequest("GET", path, "", response, true))
   {
      ClearSignalOverlayObjects();
      return;
   }

   // Show overlay when a signal exists (even if not executable) unless explicitly disabled.
   if(StringFind(response, "\"success\":true") < 0 && StringFind(response, "\"success\" : true") < 0)
   {
      ClearSignalOverlayObjects();
      return;
   }

   bool shouldExecute = true;
   string directionU = "";
   double entry = 0.0, sl = 0.0, tp = 0.0, lots = 0.0;
   if(!ParseSignalForExecution(response, directionU, entry, sl, tp, lots, shouldExecute))
   {
      ClearSignalOverlayObjects();
      return;
   }
   if(OverlayRespectServerExecution && !shouldExecute)
   {
      ClearSignalOverlayObjects();
      return;
   }

   string direction = (directionU == "SELL") ? "sell" : "buy";

   string key = StringConcatenate(Symbol(), "|", direction);
   if(key == g_lastOverlayKey)
      return;
   g_lastOverlayKey = key;

   DrawSignalOverlay(direction);
}

//+------------------------------------------------------------------+
//| Server-guided trade management                                  |
//+------------------------------------------------------------------+
string ExtractJsonString(const string src, const string key, int startPos)
{
   string needle = StringConcatenate("\"", key, "\"");
   int p = JsonFindKeyOutsideString(src, needle, startPos);
   if(p < 0)
      return "";
   int colon = StringFind(src, ":", p + StringLen(needle));
   if(colon < 0)
      return "";
   int s = JsonSkipWhitespace(src, colon + 1);
   string out = "";
   int endPos = s;
   if(!JsonReadStringValue(src, s, out, endPos))
      return "";
   return out;
}

double ExtractJsonNumber(const string src, const string key, int startPos)
{
   string needle = StringConcatenate("\"", key, "\"");
   int p = JsonFindKeyOutsideString(src, needle, startPos);
   if(p < 0)
      return 0.0;
   int colon = StringFind(src, ":", p + StringLen(needle));
   if(colon < 0)
      return 0.0;
   int s = JsonSkipWhitespace(src, colon + 1);
   int e = s;
   while(e < StringLen(src))
   {
      int c = StringGetCharacter(src, e);
      if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E')
      {
         e++;
         continue;
      }
      break;
   }
   if(e <= s)
      return 0.0;
   return StrToDouble(StringSubstr(src, s, e - s));
}

void ExecuteManagementCommand(string type, string symbol, double price, double percent, double distancePips)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderMagicNumber() != MagicNumber)
         continue;
      if(StringLen(symbol) > 0 && OrderSymbol() != symbol)
         continue;

      bool isBuy = OrderType() == OP_BUY;
      bool isSell = OrderType() == OP_SELL;
      if(!isBuy && !isSell)
         continue;

      if(type == "partial_close")
      {
         double pct = MathMax(0.0, MathMin(1.0, percent));
         if(pct <= 0.0)
            return;
         double closeLots = OrderLots() * pct;
         closeLots = MathMax(MinLotSize, MathMin(OrderLots(), closeLots));
         if(closeLots <= 0)
            return;
         double closePrice = isBuy ? Bid : Ask;
         if(OrderClose(OrderTicket(), closeLots, closePrice, Slippage, clrGold))
            Print("Partial close executed: ", OrderTicket(), " lots=", closeLots);
         else
            Print("Partial close failed: ", GetLastError());
         return;
      }

      if(type == "modify_sl")
      {
         if(price <= 0)
            return;
         double newSL = NormalizeDouble(price, Digits);
         if(OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrBlue))
            Print("Stop loss modified: ", OrderTicket(), " newSL=", newSL);
         else
            Print("Stop loss modify failed: ", GetLastError());
         return;
      }

      if(type == "trail")
      {
         if(distancePips <= 0)
            return;
         double distance = distancePips * Point;
         double newSL = isBuy ? Bid - distance : Ask + distance;
         newSL = NormalizeDouble(newSL, Digits);
         bool shouldModify = false;
         if(isBuy && newSL > OrderStopLoss() && newSL < Bid) shouldModify = true;
         if(isSell && (newSL < OrderStopLoss() || OrderStopLoss() == 0) && newSL > Ask) shouldModify = true;
         if(shouldModify)
         {
            if(OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrBlue))
               Print("Trail SL updated: ", OrderTicket(), " newSL=", newSL);
            else
               Print("Trail SL failed: ", GetLastError());
         }
         return;
      }

      if(type == "close_position")
      {
         double closePrice2 = isBuy ? Bid : Ask;
         if(OrderClose(OrderTicket(), OrderLots(), closePrice2, Slippage, clrRed))
            Print("Position closed: ", OrderTicket());
         else
            Print("Close position failed: ", GetLastError());
         return;
      }
   }
}

void ParseAndExecuteCommands(string response)
{
   int pos = 0;
   while(true)
   {
      int typePos = StringFind(response, "\"type\":\"", pos);
      if(typePos < 0)
         break;
      string type = ExtractJsonString(response, "type", typePos);
      string symbol = ExtractJsonString(response, "symbol", typePos);
      double price = ExtractJsonNumber(response, "price", typePos);
      double percent = ExtractJsonNumber(response, "percent", typePos);
      double distancePips = ExtractJsonNumber(response, "distancePips", typePos);

      if(StringLen(type) > 0)
         ExecuteManagementCommand(type, symbol, price, percent, distancePips);

      pos = typePos + 10;
   }
}

bool PostPositionManagement(bool enqueue)
{
   string payload = "{\"positions\":[";
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderMagicNumber() != MagicNumber)
         continue;

      string sym = OrderSymbol();
      double entry = OrderOpenPrice();
      double current = (OrderType() == OP_BUY) ? Bid : Ask;
      double sl = OrderStopLoss();
      double tp = OrderTakeProfit();
      string dir = (OrderType() == OP_BUY) ? "BUY" : "SELL";

      if(count > 0) payload += ",";
      payload += StringConcatenate(
         "{\"symbol\":\"", sym, "\"",
         ",\"direction\":\"", dir, "\"",
         ",\"entryPrice\":", DoubleToString(entry, Digits),
         ",\"currentPrice\":", DoubleToString(current, Digits),
         ",\"stopLoss\":", DoubleToString(sl, Digits),
         ",\"takeProfit\":", DoubleToString(tp, Digits),
         ",\"ticket\":", OrderTicket(),
         ",\"lots\":", DoubleToString(OrderLots(), 2),
         ",\"managementState\":{\"partialsTaken\":[]}",
         "}"
      );
      count++;
   }
   payload += StringConcatenate("]", ",\"enqueue\":", enqueue ? "true" : "false", "}");

   string response = "";
   if(BridgeRequest("POST", "/agent/manage", payload, response, true))
   {
      if(StringLen(response) > 0)
         ParseAndExecuteCommands(response);
      return(true);
   }
   return(false);
}

bool PollManagementCommands()
{
   string response = "";
   if(BridgeRequest("GET", "/agent/commands?limit=20", "", response, true))
   {
      if(StringLen(response) > 0)
         ParseAndExecuteCommands(response);
      return(true);
   }
   return(false);
}

//+------------------------------------------------------------------+
//| Check for signals and execute trades                             |
//+------------------------------------------------------------------+
void CheckAndExecuteSignals()
{
   string candidates[];
   ArrayResize(candidates, 0);

   int activeN = ArraySize(g_activeSymbols);
   if(activeN > 0)
   {
      for(int i = 0; i < activeN && ArraySize(candidates) < MaxActiveSymbols; i++)
      {
         string raw = g_activeSymbols[i];
         if(StringLen(raw) <= 0)
            continue;
         string resolved = ResolveBrokerSymbol(raw);
         if(StringLen(resolved) <= 0)
            continue;
         if(!IsTradeSymbolEligible(resolved))
            continue;
         int n = ArraySize(candidates);
         ArrayResize(candidates, n + 1);
         candidates[n] = resolved;
      }
   }
   else
   {
      int total = SymbolsTotal(true);
      int cap = MaxActiveSymbols;
      if(cap <= 0)
         cap = 40;
      for(int i = 0; i < total && ArraySize(candidates) < cap; i++)
      {
         string name = SymbolName(i, true);
         if(StringLen(name) <= 0)
            continue;
         if(!IsTradeSymbolEligible(name))
            continue;
         int n = ArraySize(candidates);
         ArrayResize(candidates, n + 1);
         candidates[n] = name;
      }
   }

   string chartSym = Symbol();
   if(StringLen(chartSym) > 0 && IsTradeSymbolEligible(chartSym))
   {
      bool exists = false;
      for(int j = 0; j < ArraySize(candidates); j++)
      {
         if(candidates[j] == chartSym)
         {
            exists = true;
            break;
         }
      }
      if(!exists)
      {
         int n = ArraySize(candidates);
         ArrayResize(candidates, n + 1);
         candidates[n] = chartSym;
      }
   }

   int candidateCount = ArraySize(candidates);
   if(candidateCount <= 0)
      return;

   int checks = SymbolsToCheckPerSignalPoll;
   if(checks <= 0)
      checks = 1;
   if(checks > candidateCount)
      checks = candidateCount;

   bool found = false;
   string bestSym = "";
   string bestResponse = "";
   string bestSignalKey = "";
   double bestStrength = -1.0;
   double bestConfidence = -1.0;

   for(int iter = 0; iter < checks; iter++)
   {
      int idx = 0;
      if(g_tradeCursor < 0)
         g_tradeCursor = 0;
      idx = (int)(g_tradeCursor % candidateCount);
      g_tradeCursor++;

      string sym = candidates[idx];
      if(StringLen(sym) <= 0)
         continue;
      if(!IsTradeSymbolEligible(sym))
         continue;
      if(HasOpenPositionForSymbol(sym))
         continue;
      if(StringLen(g_tradeCooldownSymbol) > 0 && sym == g_tradeCooldownSymbol && TimeCurrent() < g_tradeCooldownUntil)
         continue;

      string response = "";
      string path = StringConcatenate("/signal/get?symbol=", sym, "&accountMode=", AccountMode());
      if(!BridgeRequest("GET", path, "", response, true))
         continue;

      if(StringFind(response, "\"success\":true") < 0 && StringFind(response, "\"success\" : true") < 0)
         continue;

      bool shouldExecute = true;
      string dirU = "";
      double entry = 0.0, sl = 0.0, tp = 0.0, lots = 0.0;
      if(!ParseSignalForExecution(response, dirU, entry, sl, tp, lots, shouldExecute))
         continue;
      if(SmartStrongMode && !shouldExecute)
         continue;

      if(SmartStrongMode && EnforceSmartStrongThresholds)
      {
         double strength = ExtractJsonNumber(response, "strength", 0);
         double confidence = ExtractJsonNumber(response, "confidence", 0);

         double minS = SmartStrongMinStrengthTrade;
         double minC = SmartStrongMinConfidenceTrade;
         if(g_serverPolicyLoaded)
         {
            if(g_serverMinStrength > 0) minS = MathMax(minS, g_serverMinStrength);
            if(g_serverMinConfidence > 0) minC = MathMax(minC, g_serverMinConfidence);
         }

         if(strength < minS || confidence < minC)
            continue;

         if(SmartMaxTickAgeSec > 0)
         {
            datetime lastTick = (datetime)MarketInfo(sym, MODE_TIME);
            if(lastTick > 0 && (TimeCurrent() - lastTick) > SmartMaxTickAgeSec)
               continue;
         }

         double atr = iATR(sym, 0, 14, 0);
         int digits = (int)MarketInfo(sym, MODE_DIGITS);
         double point = MarketInfo(sym, MODE_POINT);
         double pip = (digits == 3 || digits == 5) ? point * 10 : point;
         double atrPips = pip > 0 ? atr / pip : 0;
         if(atrPips > 0)
         {
            if(atrPips < SmartMinAtrPips || atrPips > SmartMaxAtrPips)
               continue;
         }

         double ask = MarketInfo(sym, MODE_ASK);
         double bid = MarketInfo(sym, MODE_BID);
         double spreadPips = (ask - bid) / pip;
         if(atrPips > 0)
         {
            double spreadToAtrPct = (spreadPips / atrPips) * 100.0;
            if(spreadToAtrPct > SmartMaxSpreadToAtrPct)
               continue;
         }

         if(g_serverRequireLayers18)
         {
            bool layersOk = (StringFind(response, "\"layersStatus\":{\"ok\":true") >= 0 ||
                             StringFind(response, "\"layersStatus\":{\"ok\" : true") >= 0 ||
                             StringFind(response, "\"layersStatus\" : {\"ok\":true") >= 0 ||
                             StringFind(response, "\"layersStatus\" : {\"ok\" : true") >= 0);
            if(!layersOk)
               continue;
         }

         if(g_serverRequiresEnterState)
         {
            bool enterOk = (StringFind(response, "\"decisionState\":\"ENTER\"") >= 0 ||
                            StringFind(response, "\"layer18State\":\"ENTER\"") >= 0);
            if(!enterOk)
               continue;
         }
      }

      double strength = ExtractJsonNumber(response, "strength", 0);
      double confidence = ExtractJsonNumber(response, "confidence", 0);

      string sigKey = "";
      ExtractSignalDedupeKey(response, dirU, entry, sl, tp, lots, strength, confidence, sigKey);
      if(WasSignalRecentlyProcessed(sym, sigKey))
         continue;

      bool better = false;
      if(!found)
         better = true;
      else if(strength > bestStrength)
         better = true;
      else if(strength == bestStrength && confidence > bestConfidence)
         better = true;

      if(better)
      {
         found = true;
         bestSym = sym;
         bestResponse = response;
         bestSignalKey = sigKey;
         bestStrength = strength;
         bestConfidence = confidence;
      }
   }

   if(!found)
      return;

   if(ExecuteSignalFromResponse(bestResponse, bestSym))
   {
      if(StringLen(bestSignalKey) > 0)
         MarkSignalProcessed(bestSym, bestSignalKey);
   }
}

//+------------------------------------------------------------------+
//| Execute trade based on signal response                           |
//+------------------------------------------------------------------+
bool ExecuteSignalFromResponse(string response, string symbol)
{
   bool shouldExecute = true;
   string directionU = "";
   double entry = 0.0, slServer = 0.0, tpServer = 0.0, lotsServer = 0.0;
   if(!ParseSignalForExecution(response, directionU, entry, slServer, tpServer, lotsServer, shouldExecute))
      return false;
   if(SmartStrongMode && !shouldExecute)
      return false;

   string direction = (directionU == "SELL") ? "sell" : "buy";

   if(StringLen(symbol) <= 0)
      symbol = Symbol();
   if(!SymbolSelect(symbol, true))
      return false;

   if(!IsTradeAllowed())
      return false;

   double ask = MarketInfo(symbol, MODE_ASK);
   double bid = MarketInfo(symbol, MODE_BID);
   double point = MarketInfo(symbol, MODE_POINT);
   int digits = (int)MarketInfo(symbol, MODE_DIGITS);

   if(ask <= 0 || bid <= 0)
      return false;

   if(MaxSpreadPoints > 0 && point > 0)
   {
      double spreadPoints = (ask - bid) / point;
      if(spreadPoints > MaxSpreadPoints)
         return false;
   }

      double lots = CalculateLotSize(symbol);
      if(lotsServer > 0.0)
      lots = lotsServer;

   // Apply risk multiplier from learning
   lots = lots * g_riskMultiplier;
   lots = MathMax(MinLotSize, MathMin(MaxLotSize, lots));

   // Calculate stop loss and take profit
   double sl = slServer;
   double tp = tpServer;
   if(UseDynamicStopLoss)
   {
      if(sl <= 0.0)
         sl = CalculateDynamicStopLoss(direction, symbol);
      if(tp <= 0.0 && sl > 0.0)
         tp = CalculateDynamicTakeProfit(direction, sl, symbol);
   }

   // Execute order
   int ticket = -1;
   double minLot = MarketInfo(symbol, MODE_MINLOT);
   double maxLot = MarketInfo(symbol, MODE_MAXLOT);
   double lotStep = MarketInfo(symbol, MODE_LOTSTEP);
   if(minLot > 0 && lots < minLot)
      lots = minLot;
   if(maxLot > 0 && lots > maxLot)
      lots = maxLot;
   if(lotStep > 0)
      lots = MathFloor(lots / lotStep) * lotStep;
   lots = NormalizeDouble(lots, 2);

   if(MaxFreeMarginUsagePct > 0.0)
   {
      double freeMargin = AccountFreeMargin();
      double maxUse = freeMargin * MaxFreeMarginUsagePct;
      if(maxUse > 0.0)
      {
         int cmd = (direction == "buy") ? OP_BUY : OP_SELL;
         double after = AccountFreeMarginCheck(symbol, cmd, lots);
         if(after >= 0.0)
         {
            double used = freeMargin - after;
            if(used > maxUse && used > 0.0)
            {
               double factor = maxUse / used;
               lots = lots * factor;
               if(minLot > 0 && lots < minLot)
                  lots = minLot;
               if(maxLot > 0 && lots > maxLot)
                  lots = maxLot;
               if(lotStep > 0)
                  lots = MathFloor(lots / lotStep) * lotStep;
               lots = NormalizeDouble(lots, 2);
            }
         }
      }
   }

   if(direction == "buy")
   {
      ClampStopsForOrder(symbol, OP_BUY, NormalizeDouble(ask, digits), sl, tp);
      int retries = 0;
      while(true)
      {
         ticket = OrderSend(symbol, OP_BUY, lots, NormalizeDouble(ask, digits), Slippage, sl, tp,
                           "Intelligent EA", MagicNumber, 0, clrGreen);
         if(ticket > 0)
            break;
         int err = GetLastError();
         if(err == 134 && retries < MaxNoMoneyRetries)
         {
            double step = MarketInfo(symbol, MODE_LOTSTEP);
            if(step > 0)
               lots = MathMax(step, lots - step);
            else
               lots = lots * 0.8;
            retries++;
            continue;
         }
         if((err == 130 || err == 129) && SymbolFailureCooldownSec > 0)
         {
            g_tradeCooldownSymbol = symbol;
            g_tradeCooldownUntil = TimeCurrent() + SymbolFailureCooldownSec;
         }
         break;
      }
   }
   else
   {
      ClampStopsForOrder(symbol, OP_SELL, NormalizeDouble(bid, digits), sl, tp);
      int retries = 0;
      while(true)
      {
         ticket = OrderSend(symbol, OP_SELL, lots, NormalizeDouble(bid, digits), Slippage, sl, tp,
                           "Intelligent EA", MagicNumber, 0, clrRed);
         if(ticket > 0)
            break;
         int err = GetLastError();
         if(err == 134 && retries < MaxNoMoneyRetries)
         {
            double step = MarketInfo(symbol, MODE_LOTSTEP);
            if(step > 0)
               lots = MathMax(step, lots - step);
            else
               lots = lots * 0.8;
            retries++;
            continue;
         }
         if((err == 130 || err == 129) && SymbolFailureCooldownSec > 0)
         {
            g_tradeCooldownSymbol = symbol;
            g_tradeCooldownUntil = TimeCurrent() + SymbolFailureCooldownSec;
         }
         break;
      }
   }

   if(ticket > 0)
   {
      Print("Trade opened: ", ticket, " Direction: ", direction, " Lots: ", lots, " Symbol: ", symbol);
      return true;
   }
   else
      Print("Trade failed: ", GetLastError());

   return false;
}

//+------------------------------------------------------------------+
//| Smart close on opposite strong signal                           |
//+------------------------------------------------------------------+
void CheckSmartCloseOppositeSignals()
{
   if(!SmartStrongMode || !SmartStrongCloseOnOpposite)
      return;
   if(SmartCloseCheckIntervalSec > 0 && g_lastSmartCloseCheck > 0 && (TimeCurrent() - g_lastSmartCloseCheck) < SmartCloseCheckIntervalSec)
      return;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderMagicNumber() != MagicNumber)
         continue;

      string sym = OrderSymbol();
      int type = OrderType();

      string response = "";
      string path = StringConcatenate("/signal/get?symbol=", sym, "&accountMode=", AccountMode());
      if(!BridgeRequest("GET", path, "", response, true))
         continue;

      if(StringFind(response, "\"success\":true") < 0 && StringFind(response, "\"success\" : true") < 0)
         continue;

      bool shouldExecute = true;
      string dirU = "";
      double entry = 0.0, sl = 0.0, tp = 0.0, lots = 0.0;
      if(!ParseSignalForExecution(response, dirU, entry, sl, tp, lots, shouldExecute))
         continue;
      if(!shouldExecute)
         continue;

      double strength = ExtractJsonNumber(response, "strength", 0);
      double confidence = ExtractJsonNumber(response, "confidence", 0);

      double minS = SmartCloseMinStrength;
      double minC = SmartCloseMinConfidence;
      if(g_serverPolicyLoaded)
      {
         if(g_serverMinStrength > 0) minS = MathMax(minS, g_serverMinStrength);
         if(g_serverMinConfidence > 0) minC = MathMax(minC, g_serverMinConfidence);
      }

      if(strength < minS || confidence < minC)
         continue;

      string direction = (dirU == "SELL") ? "sell" : "buy";

      bool closed = false;
      if(type == OP_BUY && direction == "sell")
         closed = OrderClose(OrderTicket(), OrderLots(), Bid, Slippage, clrRed);
      else if(type == OP_SELL && direction == "buy")
         closed = OrderClose(OrderTicket(), OrderLots(), Ask, Slippage, clrGreen);

      if(closed)
         Print("Smart close executed for ticket: ", OrderTicket());
   }

   g_lastSmartCloseCheck = TimeCurrent();
}

//+------------------------------------------------------------------+
//| Calculate lot size based on risk percentage                      |
//+------------------------------------------------------------------+
double CalculateLotSize(string symbol)
{
   double riskAmount = AccountEquity() * (RiskPercentage / 100.0);
   if(StringLen(symbol) <= 0)
      symbol = Symbol();
   double tickValue = MarketInfo(symbol, MODE_TICKVALUE);
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
double CalculateDynamicStopLoss(string direction, string symbol)
{
   if(StringLen(symbol) <= 0)
      symbol = Symbol();
   double atr = iATR(symbol, 0, 14, 0);
   double slDistance = atr * 2.0 * g_stopLossMultiplier;  // Apply learning factor

   if(direction == "buy")
   {
      double ask = MarketInfo(symbol, MODE_ASK);
      int digits = (int)MarketInfo(symbol, MODE_DIGITS);
      return(NormalizeDouble(ask - slDistance, digits));
   }
   else
   {
      double bid = MarketInfo(symbol, MODE_BID);
      int digits = (int)MarketInfo(symbol, MODE_DIGITS);
      return(NormalizeDouble(bid + slDistance, digits));
   }
}

//+------------------------------------------------------------------+
//| Calculate dynamic take profit                                    |
//+------------------------------------------------------------------+
double CalculateDynamicTakeProfit(string direction, double stopLoss, string symbol)
{
   if(StringLen(symbol) <= 0)
      symbol = Symbol();
   double ask = MarketInfo(symbol, MODE_ASK);
   double bid = MarketInfo(symbol, MODE_BID);
   int digits = (int)MarketInfo(symbol, MODE_DIGITS);
   double slDistance = MathAbs((direction == "buy" ? ask : bid) - stopLoss);
   double tpDistance = slDistance * 2.0;  // 2:1 reward/risk ratio

   if(direction == "buy")
      return(NormalizeDouble(ask + tpDistance, digits));
   else
      return(NormalizeDouble(bid - tpDistance, digits));
}

//+------------------------------------------------------------------+
//| Manage open positions with trailing stop                         |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
   if(TradeModifyCooldownSec > 0 && g_lastTradeModifyAt > 0 && (TimeCurrent() - g_lastTradeModifyAt) < TradeModifyCooldownSec)
      return;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderMagicNumber() != MagicNumber)
         continue;

      string sym = OrderSymbol();
      if(StringLen(sym) <= 0)
         continue;

      double point = MarketInfo(sym, MODE_POINT);
      int digits = (int)MarketInfo(sym, MODE_DIGITS);
      double pip = (digits == 3 || digits == 5) ? point * 10 : point;

      double bid = MarketInfo(sym, MODE_BID);
      double ask = MarketInfo(sym, MODE_ASK);
      if(bid <= 0 || ask <= 0 || !(pip > 0.0))
         continue;

      double openPrice = OrderOpenPrice();
      double profitPips = (OrderType() == OP_BUY) ? (bid - openPrice) / pip : (openPrice - ask) / pip;

      // Breakeven
      if(EnableBreakeven && BreakevenTriggerPips > 0 && profitPips >= BreakevenTriggerPips)
      {
         double desiredSl = openPrice;
         if(BreakevenBufferPoints > 0)
         {
            if(OrderType() == OP_BUY)
               desiredSl = openPrice + (double)BreakevenBufferPoints * point;
            else
               desiredSl = openPrice - (double)BreakevenBufferPoints * point;
         }

         double tmpSl = desiredSl;
         double tp = OrderTakeProfit();
         ClampStopsForOrder(sym, OrderType() == OP_BUY ? OP_BUY : OP_SELL, OrderType() == OP_BUY ? bid : ask, tmpSl, tp);

         bool needsMove = false;
         if(OrderType() == OP_BUY)
            needsMove = (OrderStopLoss() <= 0 || OrderStopLoss() < tmpSl);
         else
            needsMove = (OrderStopLoss() <= 0 || OrderStopLoss() > tmpSl);

         if(needsMove)
         {
            if(OrderModify(OrderTicket(), OrderOpenPrice(), tmpSl, OrderTakeProfit(), 0, clrBlue))
            {
               g_lastTradeModifyAt = TimeCurrent();
               continue;
            }
         }
      }

      // Implement trailing stop
      double newSL = 0;
      bool shouldModify = false;

      if(OrderType() == OP_BUY)
      {
         double trailPips = TrailingDistancePips;
         if(EnableAtrTrailing)
         {
            double atr = iATR(sym, AtrTrailingTf, 14, 0);
            double atrPips = pip > 0 ? atr / pip : 0;
            if(atrPips > 0)
            {
               if(AtrStartMultiplier > 0 && profitPips < (atrPips * AtrStartMultiplier))
                  trailPips = 0;
               else
                  trailPips = MathMax(trailPips, atrPips * AtrTrailMultiplier);
            }
         }

         if(EnableTrailingStop && trailPips > 0 && profitPips >= TrailingStartPips)
            newSL = NormalizeDouble(bid - (trailPips * pip), digits);
         else
            newSL = 0;

         double tmpSl = newSL;
         double tp = OrderTakeProfit();
         ClampStopsForOrder(sym, OP_BUY, bid, tmpSl, tp);
         newSL = tmpSl;

         if(newSL > 0 && newSL < bid)
         {
            double stepPoints = TrailingStepPoints;
            if(stepPoints <= 0)
               stepPoints = 1;
            if(OrderStopLoss() <= 0 || (newSL - OrderStopLoss()) >= (stepPoints * point))
               shouldModify = true;
         }

         if(CloseLosingTrades)
         {
            double point = MarketInfo(sym, MODE_POINT);
            double pip = (digits == 3 || digits == 5) ? point * 10 : point;
            if(pip > 0)
            {
               double lossPips = (OrderOpenPrice() - bid) / pip;
               if(MaxLossPerTradePips > 0.0 && lossPips >= MaxLossPerTradePips)
               {
                  if(OrderClose(OrderTicket(), OrderLots(), bid, Slippage, clrRed))
                     Print("Loss cut (pips) for ticket: ", OrderTicket());
                  continue;
               }
            }
            if(MaxLossPerTradeCurrency > 0.0 && OrderProfit() <= -MaxLossPerTradeCurrency)
            {
               if(OrderClose(OrderTicket(), OrderLots(), bid, Slippage, clrRed))
                  Print("Loss cut (currency) for ticket: ", OrderTicket());
               continue;
            }
         }
      }
      else if(OrderType() == OP_SELL)
      {
         double trailPips = TrailingDistancePips;
         if(EnableAtrTrailing)
         {
            double atr = iATR(sym, AtrTrailingTf, 14, 0);
            double atrPips = pip > 0 ? atr / pip : 0;
            if(atrPips > 0)
            {
               if(AtrStartMultiplier > 0 && profitPips < (atrPips * AtrStartMultiplier))
                  trailPips = 0;
               else
                  trailPips = MathMax(trailPips, atrPips * AtrTrailMultiplier);
            }
         }

         if(EnableTrailingStop && trailPips > 0 && profitPips >= TrailingStartPips)
            newSL = NormalizeDouble(ask + (trailPips * pip), digits);
         else
            newSL = 0;

         double tmpSl = newSL;
         double tp = OrderTakeProfit();
         ClampStopsForOrder(sym, OP_SELL, ask, tmpSl, tp);
         newSL = tmpSl;

         if(newSL > 0 && newSL > ask)
         {
            double stepPoints = TrailingStepPoints;
            if(stepPoints <= 0)
               stepPoints = 1;
            if(OrderStopLoss() <= 0 || (OrderStopLoss() - newSL) >= (stepPoints * point))
               shouldModify = true;
         }

         if(CloseLosingTrades)
         {
            double point = MarketInfo(sym, MODE_POINT);
            double pip = (digits == 3 || digits == 5) ? point * 10 : point;
            if(pip > 0)
            {
               double lossPips = (ask - OrderOpenPrice()) / pip;
               if(MaxLossPerTradePips > 0.0 && lossPips >= MaxLossPerTradePips)
               {
                  if(OrderClose(OrderTicket(), OrderLots(), ask, Slippage, clrRed))
                     Print("Loss cut (pips) for ticket: ", OrderTicket());
                  continue;
               }
            }
            if(MaxLossPerTradeCurrency > 0.0 && OrderProfit() <= -MaxLossPerTradeCurrency)
            {
               if(OrderClose(OrderTicket(), OrderLots(), ask, Slippage, clrRed))
                  Print("Loss cut (currency) for ticket: ", OrderTicket());
               continue;
            }
         }
      }

      if(shouldModify)
      {
         bool success = OrderModify(OrderTicket(), OrderOpenPrice(), newSL,
                                   OrderTakeProfit(), 0, clrBlue);
         if(success)
         {
            g_lastTradeModifyAt = TimeCurrent();
            Print("Trailing stop updated for ticket: ", OrderTicket());
         }
      }
   }
}

bool HasOpenPositionForSymbol(const string sym)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderMagicNumber() != MagicNumber)
         continue;
      if(OrderSymbol() == sym)
         return(true);
   }
   return(false);
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
   if(BridgeRequest("POST", "/agent/transaction", payload, response, true))
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
