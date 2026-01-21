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
extern int    MagicNumber       = 87001;
extern int    Slippage          = 10;

// === Chart Overlay (Signal Visualization) ===
extern bool   EnableSignalOverlay        = true;
extern int    SignalOverlayIntervalSec   = 10;
extern bool   OverlayRespectServerExecution = false;

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
datetime g_lastSignalOverlay = 0;
string   g_lastOverlayKey = "";

datetime g_lastMarketFeed = 0;
bool     g_sentConnectNews = false;

datetime g_lastMarketSnapshot = 0;
datetime g_lastSnapshotRequestPoll = 0;

datetime g_lastActiveSymbolsPoll = 0;

bool     g_activeSymbolsEndpointSupported = true;

datetime g_lastMarketBars = 0;

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
      if(StringLen(chartSym) > 0)
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
   string payload = StringConcatenate(
      "{\"symbol\":\"", Symbol(),
      "\",\"broker\":\"mt4\"",
      ",\"accountMode\":\"", AccountMode(),
      "\",\"timeframe\":\"", Period(), "\"}"
   );

   if(!HttpRequest("GET", "/signal/get", payload, response))
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

   if(OverlayRespectServerExecution)
   {
      if(StringFind(response, "\"shouldExecute\":true") < 0 && StringFind(response, "\"shouldExecute\" : true") < 0)
      {
         ClearSignalOverlayObjects();
         return;
      }
   }

   string direction = "buy";
   if(StringFind(response, "\"direction\":\"SELL\"") >= 0 || StringFind(response, "\"direction\":\"sell\"") >= 0)
      direction = "sell";

   string key = StringConcatenate(Symbol(), "|", direction);
   if(key == g_lastOverlayKey)
      return;
   g_lastOverlayKey = key;

   DrawSignalOverlay(direction);
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
