#property copyright "Neon Trading Stack"
#property version   "1.00"
#property strict

input string BridgeUrl          = "http://127.0.0.1:4101/api/broker/bridge/mt5";
input string ApiToken           = "";
input bool   ForceReconnect     = true;
input int    HeartbeatInterval  = 30;
input int    RequestTimeoutMs   = 7000;

// === Market Feed (Ticker) ===
input bool   EnableMarketFeed      = true;
input int    MarketFeedIntervalSec = 2;
input int    MarketBarsIntervalSec = 10; // bars update slower than quotes (candles don't change every 2s)
input int    BarsHistoryDepthM1    = 120; // how many M1 bars to send per update
input int    BarsHistoryDepthHTF   = 250; // how many bars to seed for M15/H1/H4/D1 (sent on close)
input int    BarsSymbolsPerCycle   = 3;   // how many tape symbols to post bars for each cycle
input bool   EnableTimeframeSeeding = true; // periodically seed M15/H1/H4/D1 history (don't wait for close)
input int    TimeframeSeedIntervalSec = 60; // per symbol per timeframe
input string FeedSymbolsCsv        = ""; // empty = chart symbol + MarketWatch (if enabled)
input bool   IncludeMarketWatch    = true;
input int    MaxSymbolsToSend      = 500;
input int    MaxQuotesPerPost      = 120;
input bool   AutoPopulateMarketWatch = true; // tries to "Show All" symbols by selecting them into MarketWatch
input int    MaxMarketWatchSymbols   = 3000; // safety cap; broker may expose thousands

// Register the full MarketWatch symbol universe with the server so it can background-scan
// far beyond the currently streamed quotes.
input bool   EnableSymbolUniverseRegistration = true;
input int    SymbolUniverseRegistrationIntervalSec = 300; // 5m
input int    MaxSymbolUniverseToRegister = 2000;
input int    SymbolUniverseChunkSize = 250; // send in chunks to avoid MT5 WebRequest payload limits

// === Smart / Low-Load Improvements ===
// Keep EA very fast while avoiding freezes and unnecessary network pressure.
input bool   EnablePrioritySymbols     = true;  // prioritize requested symbols (from dashboard snapshot requests)
input int    PrioritySymbolsTtlSec     = 900;   // keep requested symbols "hot" for N seconds
input int    MaxPrioritySymbols        = 60;    // cap
input int    MaxPriorityQuotesPerPost  = 25;    // cap per POST
input int    QuoteResendIntervalSec    = 15;    // keepalive resend even if tick time doesn't change
input int    SymbolResolveCacheTtlSec  = 3600;  // cache symbol alias resolution
input int    MaxSymbolResolveCache     = 250;
input int    MaxQuoteStateCache        = 500;   // cache of last sent tick time per symbol
input int    AutoPopulateBatchSize     = 250;   // select at most N symbols per timer tick (prevents MT5 freeze)

// Dashboard-driven lazy-loading
input bool   EnableActiveSymbolsPolling  = true; // poll server for selected symbols
input int    ActiveSymbolsPollIntervalSec= 5;
input int    MaxActiveSymbols            = 40;

// === Market Snapshot (Indicators/Levels) ===
input bool   EnableMarketSnapshot        = true;
input int    MarketSnapshotIntervalSec   = 10;
input bool   EnableIndicatorHandleCache  = true;
input int    IndicatorHandleCacheTtlSec  = 1800;
input int    MaxIndicatorHandleCache     = 120;

// === Reliability / Auto-Reconnect ===
input int    MaxConsecutiveFailures = 3;
input int    ReconnectBackoffSec    = 5;

// === Auto-Trading (Optional) ===
input bool   EnableAutoTrading      = true;
input int    SignalCheckIntervalSec = 15;
input int    SymbolsToCheckPerSignalPoll = 10;  // number of symbols to evaluate per poll
input int    MaxSymbolsToTrade          = 0;  // cap from active-symbols list (0 = use all)
input int    MagicNumber            = 87001;
input double DefaultLots            = 0.01;
input double MinLotSize             = 0.01;
input double MaxLotSize             = 1.00;
input double MaxFreeMarginUsagePct  = 0.50; // auto-reduce lots to use at most this fraction of free margin
input int    MaxNoMoneyRetries      = 8;    // per trade attempt; prevents infinite volume-step loops
input int    SymbolFailureCooldownSec = 600; // if symbol persistently fails with 4756, back off for N seconds

// === Daily Guards (Smart Discipline) ===
// These DO NOT guarantee profit, but they prevent overtrading and protect good days.
input bool   EnableDailyGuards          = true;
input double DailyProfitTargetCurrency  = 0.0;  // e.g. 50 = stop new trades after +$50 realized PnL today
input double DailyProfitTargetPct       = 0.0;  // e.g. 1.0 = stop new trades after +1% of start-of-day equity
input double DailyMaxLossCurrency       = 0.0;  // e.g. 50 = stop new trades after -$50 realized PnL today
input double DailyMaxLossPct            = 0.0;  // e.g. 1.0 = stop new trades after -1% of start-of-day equity
input bool   EnforceMaxTradesPerDay     = false; // if true, stop new trades after MaxTradesPerDay
input int    MaxTradesPerDay            = 0;     // count of entry deals (MagicNumber); 0 = no limit
input int    MaxSpreadPoints        = 80;
input int    MaxSlippagePoints      = 20;
input bool   DropInvalidStops       = true;
input bool   VerboseTradeLogs       = true;
input bool   TradeMajorsAndMetalsOnly = true; // safer defaults; avoids exotics/crypto
input bool   RespectServerExecution = true; // requires server to return execution.shouldExecute=true

// === Smart Market Filters (Optional) ===
input bool          EnableVolatilityFilter   = true;      // filter symbols based on ATR/volatility
input ENUM_TIMEFRAMES VolatilityFilterTf     = PERIOD_M15;
input double        MinAtrPips               = 4.0;       // skip very low volatility markets
input double        MaxAtrPips               = 120.0;     // skip extreme volatility markets
input double        MaxSpreadToAtrPct        = 25.0;      // spread must be <= this % of ATR (in pips)

// === Chart Overlay (Signal Visualization) ===
input bool   EnableSignalOverlay        = true;
input int    SignalOverlayIntervalSec   = 10;
input bool   OverlayRespectServerExecution = false;
input bool   OverlayStrongOnly          = true;
input double OverlayMinStrength         = 60.0;
input double OverlayMinConfidence       = 75.0;
input bool   OverlayDrawStopLossTakeProfit = true;

// === Trade Management ===
input bool   EnableBreakeven        = true;
input double BreakevenTriggerPips   = 8.0;
input int    BreakevenBufferPoints  = 10;   // move SL slightly past entry (covers spread/fees)
input bool   EnableTrailingStop     = true;
input double TrailingStartPips      = 15.0; // start trailing after this profit
input double TrailingDistancePips   = 10.0; // SL distance behind current price
input int    TrailingStepPoints     = 20;   // only modify if SL improves by at least this many points
input int    TradeModifyCooldownSec = 10;   // prevent frequent SL/TP modifications
input bool          EnableAtrTrailing       = true;      // dynamic trailing distances using ATR
input ENUM_TIMEFRAMES AtrTrailingTf         = PERIOD_M15;
input double        AtrStartMultiplier      = 1.0;       // start trailing once profit >= ATR*pips*mult
input double        AtrTrailMultiplier      = 2.0;       // trailing distance = max(TrailingDistancePips, ATR*pips*mult)

datetime g_lastHeartbeat = 0;
bool     g_isConnected   = false;

datetime g_lastMarketFeed = 0;
datetime g_lastSignalCheck = 0;
datetime g_lastSignalOverlay = 0;
bool     g_sentConnectNews = false;

string   g_lastOverlayKey = "";

datetime g_lastMarketSnapshot = 0;
datetime g_lastSnapshotRequestPoll = 0;

datetime g_lastActiveSymbolsPoll = 0;

datetime g_lastSymbolUniverseRegister = 0;

int      g_symbolUniverseCursor = 0;

bool     g_activeSymbolsEndpointSupported = true;

datetime g_lastMarketBars = 0;

int      g_lastHttpStatus = 0;
int      g_lastWebError = 0;
int      g_consecutiveFailures = 0;
datetime g_nextReconnectAt = 0;

bool     g_marketWatchPrepared = false;

// Cooldown a symbol after repeated broker-side execution failures (e.g., 4756).
string   g_tradeCooldownSymbol = "";
datetime g_tradeCooldownUntil  = 0;

datetime g_lastTradeModifyAt = 0;

datetime g_dailyStart = 0;
double   g_dailyStartEquity = 0.0;
bool     g_dailyHalt = false;
string   g_dailyHaltReason = "";
bool     g_dailyHaltLogged = false;

double ClampStopLevelForPosition(const string sym, const long posType, const double desiredSl, const double bid, const double ask)
{
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(!(point > 0.0))
      point = 0.00001;

   long stopsLevelPoints = 0;
   SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL, stopsLevelPoints);
   long freezeLevelPoints = 0;
   SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL, freezeLevelPoints);

   double minDist = (double)MathMax(stopsLevelPoints, freezeLevelPoints) * point;
   double sl = desiredSl;

   // For BUY: SL must be below Bid by at least minDist
   if(posType == POSITION_TYPE_BUY)
   {
      double maxSl = bid - minDist;
      if(minDist > 0.0 && sl > maxSl)
         sl = maxSl;
   }
   else
   {
      // For SELL: SL must be above Ask by at least minDist
      double minSl = ask + minDist;
      if(minDist > 0.0 && sl < minSl)
         sl = minSl;
   }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(digits < 0) digits = 5;
   return NormalizeDouble(sl, digits);
}
int      g_marketFeedCursor = 0;

int      g_marketWatchPrepareCursor = 0;

int      g_tradeCursor = 0;
int      g_snapshotCursor = 0;

string TradeErrorText(const int err)
{
   switch(err)
   {
      // Common trading permission / state issues
      case 4756: return "Order check failed (often unsupported filling mode, or trading disabled by terminal/broker)";
      default:   return "";
   }
}

bool IsOrderCheckAcceptable(const MqlTradeCheckResult &check)
{
   // In practice, OrderCheck may return retcode=0 with comment="Done".
   // Treat both "0" and standard success codes as acceptable to proceed to OrderSend.
   if(check.retcode == 0)
      return true;
   if(check.retcode == TRADE_RETCODE_DONE || check.retcode == TRADE_RETCODE_PLACED)
      return true;
   return false;
}

void LogTradePermissionSnapshot(const string sym)
{
   long termTrade = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   long termConn  = TerminalInfoInteger(TERMINAL_CONNECTED);
   long acctTrade = AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   long acctExpert = AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
   long mqlTrade = (long)MQLInfoInteger(MQL_TRADE_ALLOWED);

   long tradeMode = 0;
   SymbolInfoInteger(sym, SYMBOL_TRADE_MODE, tradeMode);

   long execMode = 0;
   SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE, execMode);

   long fillMode = 0;
   SymbolInfoInteger(sym, SYMBOL_FILLING_MODE, fillMode);

   double vMin = 0.0, vMax = 0.0, vStep = 0.0;
   SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN, vMin);
   SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX, vMax);
   SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP, vStep);

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

   if(VerboseTradeLogs)
      PrintFormat(
         "Trade perms: TERMINAL_CONNECTED=%d TERMINAL_TRADE_ALLOWED=%d MQL_TRADE_ALLOWED=%d ACCOUNT_TRADE_ALLOWED=%d ACCOUNT_TRADE_EXPERT=%d SYMBOL_TRADE_MODE=%d SYMBOL_TRADE_EXEMODE=%d SYMBOL_FILLING_MODE=%d digits=%d vol[min=%.2f step=%.2f max=%.2f]",
         (int)termConn,
         (int)termTrade,
         (int)mqlTrade,
         (int)acctTrade,
         (int)acctExpert,
         (int)tradeMode,
         (int)execMode,
         (int)fillMode,
         digits,
         vMin,
         vStep,
         vMax
      );
}

bool IsMarketFillMode(const ENUM_ORDER_TYPE_FILLING mode)
{
   // For TRADE_ACTION_DEAL (market) BOC is not applicable.
   return (mode == ORDER_FILLING_FOK || mode == ORDER_FILLING_IOC || mode == ORDER_FILLING_RETURN);
}

void BuildFillModeTryOrder(const ENUM_ORDER_TYPE_FILLING preferred, ENUM_ORDER_TYPE_FILLING &a, ENUM_ORDER_TYPE_FILLING &b, ENUM_ORDER_TYPE_FILLING &c)
{
   // Default safe order
   a = ORDER_FILLING_FOK;
   b = ORDER_FILLING_IOC;
   c = ORDER_FILLING_RETURN;

   if(preferred == ORDER_FILLING_IOC)
   {
      a = ORDER_FILLING_IOC;
      b = ORDER_FILLING_FOK;
      c = ORDER_FILLING_RETURN;
   }
   else if(preferred == ORDER_FILLING_RETURN)
   {
      a = ORDER_FILLING_RETURN;
      b = ORDER_FILLING_IOC;
      c = ORDER_FILLING_FOK;
   }
   else if(preferred == ORDER_FILLING_FOK)
   {
      a = ORDER_FILLING_FOK;
      b = ORDER_FILLING_IOC;
      c = ORDER_FILLING_RETURN;
   }
   // Anything else (e.g., BOC=3): keep defaults
}

double ClampAndStepVolume(const double volume, const double vMin, const double vMax, const double vStep)
{
   double v = volume;
   if(vMin > 0.0)
      v = MathMax(v, vMin);
   if(vMax > 0.0)
      v = MathMin(v, vMax);
   if(vStep > 0.0)
      v = MathRound(v / vStep) * vStep;
   // 2 digits is typical for lots on FX; keep it stable.
   return NormalizeDouble(v, 2);
}

double ComputeMarginRequired(const ENUM_ORDER_TYPE orderType, const string symbol, const double volume, const double price)
{
   double margin = 0.0;
   if(!OrderCalcMargin(orderType, symbol, volume, price, margin))
      return -1.0;
   return margin;
}

double ComputeMaxAffordableVolume(const ENUM_ORDER_TYPE orderType, const string symbol, const double desiredVolume, const double price, const double vMin, const double vMax, const double vStep)
{
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(!(freeMargin > 0.0))
      return ClampAndStepVolume(desiredVolume, vMin, vMax, vStep);

   double usage = MaxFreeMarginUsagePct;
   if(!(usage > 0.0) || usage > 1.0)
      usage = 0.50;
   double budget = freeMargin * usage;

   double desired = ClampAndStepVolume(desiredVolume, vMin, vMax, vStep);
   double m = ComputeMarginRequired(orderType, symbol, desired, price);
   if(m <= 0.0)
      return desired;
   if(m <= budget)
      return desired;

   // Scale down proportionally, then step-align.
   double scaled = desired * (budget / m);
   double stepped = ClampAndStepVolume(scaled, vMin, vMax, vStep);
   // Ensure we don't return 0 due to rounding.
   if(stepped < vMin && vMin > 0.0)
      stepped = vMin;
   return stepped;
}

string   g_prioritySymbols[];
datetime g_priorityExpires[];

string   g_seedKey[];
datetime g_seedLastAt[];

string   g_activeSymbols[];
int      g_activeCursor = 0;

string   g_resolveReq[];
string   g_resolveRes[];
datetime g_resolveAt[];

string   g_quoteStateSym[];
long     g_quoteStateLastTickMsc[];
datetime g_quoteStateLastSentAt[];

string   g_indKey[];
int      g_indRsiH[];
int      g_indAtrH[];
int      g_indMacdH[];
datetime g_indLastUse[];

// Closed-bar send state (per symbol+timeframe). Used to post M15/H1/H4/D1 only on bar close.
string   g_closedBarKey[];
datetime g_closedBarLastTime[];

int FindIndicatorCacheIndex(const string key)
{
   int n = ArraySize(g_indKey);
   for(int i = 0; i < n; i++)
   {
      if(g_indKey[i] == key)
         return i;
   }
   return -1;
}

void ReleaseIndicatorCacheAt(const int idx)
{
   int n = ArraySize(g_indKey);
   if(idx < 0 || idx >= n)
      return;
   if(g_indRsiH[idx] > 0) IndicatorRelease(g_indRsiH[idx]);
   if(g_indAtrH[idx] > 0) IndicatorRelease(g_indAtrH[idx]);
   if(g_indMacdH[idx] > 0) IndicatorRelease(g_indMacdH[idx]);
   ArrayRemove(g_indKey, idx);
   ArrayRemove(g_indRsiH, idx);
   ArrayRemove(g_indAtrH, idx);
   ArrayRemove(g_indMacdH, idx);
   ArrayRemove(g_indLastUse, idx);
}

void PruneIndicatorCache()
{
   datetime now = TimeCurrent();
   int n = ArraySize(g_indKey);
   for(int i = n - 1; i >= 0; i--)
   {
      if(g_indLastUse[i] != 0 && (now - g_indLastUse[i]) > MathMax(60, IndicatorHandleCacheTtlSec))
      {
         ReleaseIndicatorCacheAt(i);
      }
   }

   while(ArraySize(g_indKey) > MathMax(10, MaxIndicatorHandleCache))
   {
      // Remove least-recently used.
      int oldestIdx = 0;
      datetime oldest = g_indLastUse[0];
      int m = ArraySize(g_indKey);
      for(int j = 1; j < m; j++)
      {
         if(g_indLastUse[j] < oldest)
         {
            oldest = g_indLastUse[j];
            oldestIdx = j;
         }
      }
      ReleaseIndicatorCacheAt(oldestIdx);
   }
}

bool GetIndicatorHandles(const string sym, const ENUM_TIMEFRAMES tf, int &rsiH, int &atrH, int &macdH)
{
   rsiH = 0;
   atrH = 0;
   macdH = 0;

   if(!EnableIndicatorHandleCache)
      return false;

   string key = sym + "|" + IntegerToString((int)tf);
   datetime now = TimeCurrent();
   int idx = FindIndicatorCacheIndex(key);
   if(idx >= 0)
   {
      g_indLastUse[idx] = now;
      rsiH = g_indRsiH[idx];
      atrH = g_indAtrH[idx];
      macdH = g_indMacdH[idx];
      if(rsiH > 0 && atrH > 0 && macdH > 0)
         return true;
      // Broken entry: release and recreate.
      ReleaseIndicatorCacheAt(idx);
   }

   int newRsi = iRSI(sym, tf, 14, PRICE_CLOSE);
   int newAtr = iATR(sym, tf, 14);
   int newMacd = iMACD(sym, tf, 12, 26, 9, PRICE_CLOSE);
   if(newRsi <= 0 || newAtr <= 0 || newMacd <= 0)
   {
      if(newRsi > 0) IndicatorRelease(newRsi);
      if(newAtr > 0) IndicatorRelease(newAtr);
      if(newMacd > 0) IndicatorRelease(newMacd);
      return false;
   }

   PruneIndicatorCache();
   int n = ArraySize(g_indKey);
   ArrayResize(g_indKey, n + 1);
   ArrayResize(g_indRsiH, n + 1);
   ArrayResize(g_indAtrH, n + 1);
   ArrayResize(g_indMacdH, n + 1);
   ArrayResize(g_indLastUse, n + 1);
   g_indKey[n] = key;
   g_indRsiH[n] = newRsi;
   g_indAtrH[n] = newAtr;
   g_indMacdH[n] = newMacd;
   g_indLastUse[n] = now;

   rsiH = newRsi;
   atrH = newAtr;
   macdH = newMacd;
   return true;
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
         out += StringSubstr(value, i, 1);
   }
   return out;
}

bool IsMajorCurrency(const string code)
{
   string c = code;
   StringToUpper(c);
   return (c == "USD" || c == "EUR" || c == "GBP" || c == "JPY" || c == "CHF" || c == "CAD" || c == "AUD" || c == "NZD");
}

bool IsMetalSymbol(const string sym)
{
   string c = CanonicalSymbol(sym);
   if(StringLen(c) < 6)
      return false;
   string base = StringSubstr(c, 0, 3);
   StringToUpper(base);
   return (base == "XAU" || base == "XAG" || base == "XPT" || base == "XPD");
}

bool IsMajorsForexPair(const string sym)
{
   string c = CanonicalSymbol(sym);
   if(StringLen(c) < 6)
      return false;
   string base = StringSubstr(c, 0, 3);
   string quote = StringSubstr(c, 3, 3);
   StringToUpper(base);
   StringToUpper(quote);
   return IsMajorCurrency(base) && IsMajorCurrency(quote);
}

bool IsTradeSymbolEligible(const string sym)
{
   if(!TradeMajorsAndMetalsOnly)
      return true;
   if(IsMetalSymbol(sym))
      return true;
   return IsMajorsForexPair(sym);
}

int ScoreSymbolCandidate(const string requestedCanonical, const string candidate)
{
   string c = CanonicalSymbol(candidate);
   if(StringLen(c) <= 0)
      return -1;
   if(c == requestedCanonical)
      return 10000;
   int pos = StringFind(c, requestedCanonical);
   if(pos == 0)
      return 9000 - (StringLen(c) - StringLen(requestedCanonical));
   if(pos > 0)
      return 7000 - pos;
   return -1;
}

string ResolveBrokerSymbol(string requested)
{
   StringTrimLeft(requested);
   StringTrimRight(requested);
   if(StringLen(requested) <= 0)
      return requested;

   // Fast path: if MT5 can select it, use it.
   if(SymbolSelect(requested, true))
      return requested;

   string reqCan = CanonicalSymbol(requested);
   if(StringLen(reqCan) <= 0)
      return requested;

   datetime now = TimeCurrent();
   // Cache lookup
   int cacheN = ArraySize(g_resolveReq);
   for(int i = 0; i < cacheN; i++)
   {
      if(g_resolveReq[i] == reqCan)
      {
         if(g_resolveAt[i] != 0 && (now - g_resolveAt[i]) <= MathMax(10, SymbolResolveCacheTtlSec))
            return g_resolveRes[i];
      }
   }

   string best = requested;
   int bestScore = -1;

   // First scan MarketWatch (selected symbols)
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

   // Fallback scan all symbols (bounded)
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

   // Cache write
   if(bestScore >= 0)
   {
      int n = ArraySize(g_resolveReq);
      if(n >= MaxSymbolResolveCache)
      {
         // Drop oldest (index 0)
         ArrayRemove(g_resolveReq, 0);
         ArrayRemove(g_resolveRes, 0);
         ArrayRemove(g_resolveAt, 0);
         n = ArraySize(g_resolveReq);
      }
      ArrayResize(g_resolveReq, n + 1);
      ArrayResize(g_resolveRes, n + 1);
      ArrayResize(g_resolveAt, n + 1);
      g_resolveReq[n] = reqCan;
      g_resolveRes[n] = best;
      g_resolveAt[n] = now;
   }

   return best;
}

void PrunePrioritySymbols()
{
   datetime now = TimeCurrent();
   int n = ArraySize(g_prioritySymbols);
   for(int i = n - 1; i >= 0; i--)
   {
      if(g_priorityExpires[i] != 0 && now > g_priorityExpires[i])
      {
         ArrayRemove(g_prioritySymbols, i);
         ArrayRemove(g_priorityExpires, i);
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
      // Replace the oldest
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

bool ShouldSendQuote(const string sym, const long tickMsc)
{
   datetime now = TimeCurrent();
   int n = ArraySize(g_quoteStateSym);
   for(int i = 0; i < n; i++)
   {
      if(g_quoteStateSym[i] == sym)
      {
         bool tickChanged = (g_quoteStateLastTickMsc[i] != tickMsc);
         bool resendDue = (g_quoteStateLastSentAt[i] == 0) || ((now - g_quoteStateLastSentAt[i]) >= MathMax(1, QuoteResendIntervalSec));
         if(tickChanged || resendDue)
         {
            g_quoteStateLastTickMsc[i] = tickMsc;
            g_quoteStateLastSentAt[i] = now;
            return true;
         }
         return false;
      }
   }

   // New symbol state
   if(n >= MaxQuoteStateCache)
   {
      ArrayRemove(g_quoteStateSym, 0);
      ArrayRemove(g_quoteStateLastTickMsc, 0);
      ArrayRemove(g_quoteStateLastSentAt, 0);
      n = ArraySize(g_quoteStateSym);
   }
   ArrayResize(g_quoteStateSym, n + 1);
   ArrayResize(g_quoteStateLastTickMsc, n + 1);
   ArrayResize(g_quoteStateLastSentAt, n + 1);
   g_quoteStateSym[n] = sym;
   g_quoteStateLastTickMsc[n] = tickMsc;
   g_quoteStateLastSentAt[n] = now;
   return true;
}

bool PrepareMarketWatchAllSymbols()
{
   if(!AutoPopulateMarketWatch)
      return true;

   int totalAll = SymbolsTotal(false);
   if(totalAll <= 0)
      return true;

   int batch = MathMax(1, AutoPopulateBatchSize);
   int selectedNow = 0;
   int processed = 0;

   for(int i = g_marketWatchPrepareCursor; i < totalAll && selectedNow < MaxMarketWatchSymbols && processed < batch; i++)
   {
      string name = SymbolName(i, false);
      processed++;
      if(StringLen(name) <= 0)
         continue;

      // Skip already-selected symbols
      if((bool)SymbolInfoInteger(name, SYMBOL_SELECT))
         continue;

      if(SymbolSelect(name, true))
         selectedNow++;

      g_marketWatchPrepareCursor = i + 1;
   }

   if(g_marketWatchPrepareCursor >= totalAll)
   {
      PrintFormat("MarketWatch auto-populate done (cursor=%d total=%d)", g_marketWatchPrepareCursor, totalAll);
      return true;
   }

   // Not finished yet; continue next timer tick.
   return false;
}

string AccountMode()
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   return (mode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "real";
}

string ToUpperStr(string value)
{
   StringToUpper(value);
   return value;
}

// Extract a JSON boolean for a given key (e.g. "\"shouldExecute\"")
bool JsonGetBool(const string json, const string key, bool &outValue)
{
   int pos = StringFind(json, key);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == 10 || StringGetCharacter(json, pos) == 13 || StringGetCharacter(json, pos) == 9))
      pos++;
   string tail = StringSubstr(json, pos, 8);
   tail = ToUpperStr(tail);
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

// Extract a JSON boolean for a given key, starting from a specific offset.
bool JsonGetBoolFrom(const string json, const int startPos, const string key, bool &outValue)
{
   int pos = StringFind(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == 10 || StringGetCharacter(json, pos) == 13 || StringGetCharacter(json, pos) == 9))
      pos++;
   string tail = StringSubstr(json, pos, 8);
   tail = ToUpperStr(tail);
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

bool JsonGetString(const string json, const string key, string &outValue)
{
   int pos = StringFind(json, key);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == 10 || StringGetCharacter(json, pos) == 13 || StringGetCharacter(json, pos) == 9))
      pos++;
   if(pos >= StringLen(json) || StringGetCharacter(json, pos) != '"')
      return false;
   pos++;
   int end = StringFind(json, "\"", pos);
   if(end < 0)
      return false;
   outValue = StringSubstr(json, pos, end - pos);
   return true;
}

bool JsonGetStringFrom(const string json, const int startPos, const string key, string &outValue)
{
   int pos = StringFind(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == 10 || StringGetCharacter(json, pos) == 13 || StringGetCharacter(json, pos) == 9))
      pos++;
   if(pos >= StringLen(json) || StringGetCharacter(json, pos) != '"')
      return false;
   pos++;
   int end = StringFind(json, "\"", pos);
   if(end < 0)
      return false;
   outValue = StringSubstr(json, pos, end - pos);
   return true;
}

bool JsonGetNumberFrom(const string json, const int startPos, const string key, double &outValue)
{
   int pos = StringFind(json, key, startPos);
   if(pos < 0)
      return false;
   pos = StringFind(json, ":", pos);
   if(pos < 0)
      return false;
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == 10 || StringGetCharacter(json, pos) == 13 || StringGetCharacter(json, pos) == 9))
      pos++;
   int end = pos;
   while(end < StringLen(json))
   {
      int c = StringGetCharacter(json, end);
      if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+')
      {
         end++;
         continue;
      }
      break;
   }
   if(end <= pos)
      return false;
   outValue = StringToDouble(StringSubstr(json, pos, end - pos));
   return true;
}

bool ExtractSignalStrengthConfidence(const string json, double &strengthOut, double &confidenceOut)
{
   strengthOut = 0.0;
   confidenceOut = 0.0;
   int sigPos = StringFind(json, "\"signal\"");
   if(sigPos < 0)
      sigPos = 0;

   double s = 0.0;
   double c = 0.0;
   bool okS = JsonGetNumberFrom(json, sigPos, "\"strength\"", s);
   bool okC = JsonGetNumberFrom(json, sigPos, "\"confidence\"", c);
   if(!okS && !okC)
      return false;
   if(okS) strengthOut = s;
   if(okC) confidenceOut = c;
   return true;
}

string WebRequestHint(const int lastErr, const string url)
{
   if(lastErr == 4014)
      return "WebRequest blocked by terminal settings (4014). Allowlisted URL must include the host: http://127.0.0.1:4101";
   if(lastErr == 5203)
      return "Cannot connect to bridge (5203). Make sure the backend is running and listening on http://127.0.0.1:4101 (and port 4101 is free).";
   if(StringFind(url, "127.0.0.1") >= 0 || StringFind(url, "localhost") >= 0)
      return "Local bridge not reachable. Verify backend is started and firewall is not blocking local loopback.";
   return "";
}

bool ShouldCountBridgeFailure(int status)
{
   // Only count failures that are likely transient / connection related.
   if(status == -1) return true;   // WebRequest error
   if(status == 0)  return true;
   if(status == 408) return true;
   if(status == 429) return true;
   if(status >= 500) return true;
   return false;
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
      PrintFormat("Bridge unhealthy (status=%d, webErr=%d). Scheduling reconnect in %d sec.", g_lastHttpStatus, g_lastWebError, MathMax(1, ReconnectBackoffSec));
   }
}

void RecordBridgeSuccess()
{
   g_consecutiveFailures = 0;
   g_lastWebError = 0;
}

bool BridgeRequest(const string method,
                   const string path,
                   const string payload,
                   string &response,
                   const bool affectsConnection)
{
   bool ok = HttpRequest(method, path, payload, response);
   if(ok)
   {
      RecordBridgeSuccess();
      return true;
   }

   if(affectsConnection && ShouldCountBridgeFailure(g_lastHttpStatus))
      RecordBridgeFailure();
   return false;
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
   if(RespectServerExecution)
   {
      bool tmp = false;
      int execPos = StringFind(json, "\"execution\"");
      if(execPos >= 0)
      {
         if(JsonGetBoolFrom(json, execPos, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;
         else if(JsonGetBool(json, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;
      }
      else
      {
         if(JsonGetBool(json, "\"shouldExecute\"", tmp))
            shouldExecuteOut = tmp;
      }
   }

   int sigPos = StringFind(json, "\"signal\"");
   if(sigPos < 0)
      sigPos = 0;
   // Prefer signal.direction (top-level) to avoid picking nested "direction" keys.
   if(!JsonGetStringFrom(json, sigPos, "\"direction\"", directionOut))
   {
      if(!JsonGetString(json, "\"direction\"", directionOut))
         return false;
   }
   directionOut = ToUpperStr(directionOut);

   int entryPos = StringFind(json, "\"entry\"");
   if(entryPos < 0)
      return false;

   if(!JsonGetNumberFrom(json, entryPos, "\"price\"", entryOut))
      return false;
   if(!JsonGetNumberFrom(json, entryPos, "\"stopLoss\"", slOut))
      slOut = 0.0;
   if(!JsonGetNumberFrom(json, entryPos, "\"takeProfit\"", tpOut))
      tpOut = 0.0;

   lotsOut = DefaultLots;
   int rmPos = StringFind(json, "\"riskManagement\"");
   if(rmPos >= 0)
   {
      double size = 0.0;
      if(JsonGetNumberFrom(json, rmPos, "\"positionSize\"", size) && size > 0.0)
         lotsOut = size;
   }

   lotsOut = MathMax(MinLotSize, MathMin(MaxLotSize, lotsOut));
   return true;
}

double PipSize(const string symbol)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(digits == 3 || digits == 5)
      return point * 10.0;
   return point;
}

int CurrentSpreadPoints(const string symbol)
{
   double ask = 0.0, bid = 0.0;
   if(!SymbolInfoDouble(symbol, SYMBOL_ASK, ask) || !SymbolInfoDouble(symbol, SYMBOL_BID, bid))
      return 0;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0)
      return 0;
   return (int)MathRound((ask - bid) / point);
}

ENUM_TIMEFRAMES TfFromLabel(const string tf)
{
   string t = tf;
   StringToUpper(t);
   if(t == "M15") return PERIOD_M15;
   if(t == "H1")  return PERIOD_H1;
   if(t == "H4")  return PERIOD_H4;
   if(t == "D1")  return PERIOD_D1;
   return PERIOD_M15;
}

double ReadIndicatorValue(const int handle, const int bufferIndex)
{
   if(handle <= 0)
      return 0.0;
   double values[];
   ArraySetAsSeries(values, true);
   if(CopyBuffer(handle, bufferIndex, 0, 1, values) <= 0)
      return 0.0;
   if(ArraySize(values) <= 0)
      return 0.0;
   return values[0];
}

double ReadAtrPips(const string symbol, const ENUM_TIMEFRAMES tf)
{
   double pip = PipSize(symbol);
   if(!(pip > 0.0))
      return 0.0;

   int rsiH = 0;
   int atrH = 0;
   int macdH = 0;
   bool cached = GetIndicatorHandles(symbol, tf, rsiH, atrH, macdH);
   if(!cached)
   {
      // Handle cache disabled (or cache miss and disabled): create ATR only.
      atrH = iATR(symbol, tf, 14);
      if(atrH <= 0)
         return 0.0;
   }

   double atr = ReadIndicatorValue(atrH, 0);
   if(!cached)
      IndicatorRelease(atrH);

   if(!(atr > 0.0))
      return 0.0;
   return atr / pip;
}

datetime DayStartTime(const datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   return StructToTime(dt);
}

void RefreshDailyStateIfNeeded()
{
   datetime now = TimeCurrent();
   datetime start = DayStartTime(now);
   if(g_dailyStart == 0 || start != g_dailyStart)
   {
      g_dailyStart = start;
      g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_dailyHalt = false;
      g_dailyHaltReason = "";
      g_dailyHaltLogged = false;
   }
}

double GetTodayRealizedPnl()
{
   RefreshDailyStateIfNeeded();
   datetime from = g_dailyStart;
   datetime to = TimeCurrent();
   if(!HistorySelect(from, to))
      return 0.0;

   double sum = 0.0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;

      long magic = (long)HistoryDealGetInteger(deal, DEAL_MAGIC);
      if(magic != MagicNumber)
         continue;

      double p = HistoryDealGetDouble(deal, DEAL_PROFIT);
      double s = HistoryDealGetDouble(deal, DEAL_SWAP);
      double c = HistoryDealGetDouble(deal, DEAL_COMMISSION);
      sum += (p + s + c);
   }
   return sum;
}

int GetTodayTradesOpenedCount()
{
   RefreshDailyStateIfNeeded();
   datetime from = g_dailyStart;
   datetime to = TimeCurrent();
   if(!HistorySelect(from, to))
      return 0;

   int count = 0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;

      long magic = (long)HistoryDealGetInteger(deal, DEAL_MAGIC);
      if(magic != MagicNumber)
         continue;

      long entry = (long)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN)
         count++;
   }
   return count;
}

bool IsDailyTradingAllowed()
{
   if(!EnableDailyGuards)
      return true;

   RefreshDailyStateIfNeeded();

   // If we halted only because of the trade-count cap, allow recovering immediately when the
   // cap is disabled (so the EA doesn't remain halted until tomorrow).
   if(g_dailyHalt && (!EnforceMaxTradesPerDay || MaxTradesPerDay <= 0))
   {
      if(StringFind(g_dailyHaltReason, "max trades/day hit") == 0)
      {
         g_dailyHalt = false;
         g_dailyHaltReason = "";
         g_dailyHaltLogged = false;
      }
   }

   if(g_dailyHalt)
   {
      if(!g_dailyHaltLogged && VerboseTradeLogs)
      {
         PrintFormat("Daily trading HALTED: %s", g_dailyHaltReason);
         g_dailyHaltLogged = true;
      }
      return false;
   }

   double pnl = GetTodayRealizedPnl();
   double baseEquity = g_dailyStartEquity;

   double profitTarget = 0.0;
   if(DailyProfitTargetPct > 0.0 && baseEquity > 0.0)
      profitTarget = baseEquity * (DailyProfitTargetPct / 100.0);
   else
      profitTarget = DailyProfitTargetCurrency;

   if(profitTarget > 0.0 && pnl >= profitTarget)
   {
      g_dailyHalt = true;
      g_dailyHaltReason = StringFormat("profit target hit (pnl=%.2f target=%.2f)", pnl, profitTarget);
      return false;
   }

   double maxLoss = 0.0;
   if(DailyMaxLossPct > 0.0 && baseEquity > 0.0)
      maxLoss = baseEquity * (DailyMaxLossPct / 100.0);
   else
      maxLoss = DailyMaxLossCurrency;

   if(maxLoss > 0.0 && pnl <= -maxLoss)
   {
      g_dailyHalt = true;
      g_dailyHaltReason = StringFormat("max loss hit (pnl=%.2f limit=%.2f)", pnl, maxLoss);
      return false;
   }

   // Optional: trade-count cap. Disabled by default.
   if(EnforceMaxTradesPerDay && MaxTradesPerDay > 0)
   {
      int trades = GetTodayTradesOpenedCount();
      if(trades >= MaxTradesPerDay)
      {
         g_dailyHalt = true;
         g_dailyHaltReason = StringFormat("max trades/day hit (trades=%d limit=%d)", trades, MaxTradesPerDay);
         return false;
      }
   }

   return true;
}

string ScoreDirectionFromIndicators(const double rsi, const double macdHist, double &scoreOut)
{
   scoreOut = 0.0;
   if(rsi <= 0.0)
      return "NEUTRAL";

   double score = MathAbs(rsi - 50.0) * 2.0;
   if(score > 100.0) score = 100.0;
   scoreOut = score;

   if(rsi >= 55.0 && macdHist > 0.0)
      return "BUY";
   if(rsi <= 45.0 && macdHist < 0.0)
      return "SELL";
   return "NEUTRAL";
}

bool PostMarketSnapshot()
{
   if(!EnableMarketSnapshot)
      return true;
   return PostMarketSnapshotForSymbol(_Symbol, false);
}

bool PostMarketBars()
{
   PrunePrioritySymbols();

   int activeN = ArraySize(g_activeSymbols);
   int cycles = BarsSymbolsPerCycle;
   if(cycles <= 0)
      cycles = 1;
   if(activeN > 0 && cycles > activeN)
      cycles = activeN;

   bool okAny = false;
   for(int n = 0; n < cycles; n++)
   {
      string sym = _Symbol;

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
         int pN = ArraySize(g_prioritySymbols);
         int pIdx = 0;
         if(pN > 0)
         {
            if(g_marketFeedCursor < 0)
               g_marketFeedCursor = 0;
            pIdx = (int)(g_marketFeedCursor % pN);
            g_marketFeedCursor++;
            sym = g_prioritySymbols[pIdx];
         }
      }

      if(StringLen(sym) <= 0)
         sym = _Symbol;

      // M1 is sent as an intra-candle "moving" bar for UI (also includes history to seed quickly).
      if(PostMarketBarsForSymbol(sym, PERIOD_M1, "M1"))
         okAny = true;

      // Seed higher timeframes periodically so the engine can compute signals immediately
      // (without waiting for the next M15/H1/H4/D1 candle close).
      if(ShouldSeedTimeframe(sym, "M15")) PostMarketBarsForSymbol(sym, PERIOD_M15, "M15");
      if(ShouldSeedTimeframe(sym, "H1"))  PostMarketBarsForSymbol(sym, PERIOD_H1,  "H1");
      if(ShouldSeedTimeframe(sym, "H4"))  PostMarketBarsForSymbol(sym, PERIOD_H4,  "H4");
      if(ShouldSeedTimeframe(sym, "D1"))  PostMarketBarsForSymbol(sym, PERIOD_D1,  "D1");

      // Higher timeframes: also send on CLOSED candle (includes history batch starting from shift=1).
      PostClosedMarketBarForSymbol(sym, PERIOD_M15, "M15");
      PostClosedMarketBarForSymbol(sym, PERIOD_H1,  "H1");
      PostClosedMarketBarForSymbol(sym, PERIOD_H4,  "H4");
      PostClosedMarketBarForSymbol(sym, PERIOD_D1,  "D1");
   }

   return okAny;
}

bool PostMarketBarsForSymbol(string sym, ENUM_TIMEFRAMES tf, string tfLabel)
{
   if(!g_isConnected)
      return false;

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return false;

   SymbolSelect(sym, true);

   int depth = BarsHistoryDepthHTF;
   if(tf == PERIOD_M1)
      depth = BarsHistoryDepthM1;

   string barsJson = "";
   int barsCount = 0;
   if(depth > 0)
   {
      MqlRates rates[];
      ArraySetAsSeries(rates, true);
      int copied = CopyRates(sym, tf, 0, depth, rates);
      if(copied > 0)
      {
         barsJson = "[";
         for(int i = 0; i < copied; i++)
         {
            long tt = (long)rates[i].time;
            long vv = (long)rates[i].tick_volume;
            barsJson += StringFormat(
               "{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}",
               tt,
               rates[i].open,
               rates[i].high,
               rates[i].low,
               rates[i].close,
               vv
            );
            if(i < copied - 1)
               barsJson += ",";
         }
         barsJson += "]";
         barsCount = copied;
      }
   }

   double o = iOpen(sym, tf, 0);
   double h = iHigh(sym, tf, 0);
   double l = iLow(sym, tf, 0);
   double c = iClose(sym, tf, 0);
   datetime t = iTime(sym, tf, 0);
   long v = (long)iVolume(sym, tf, 0);

   string payload = "";
   if(barsCount > 0)
   {
      payload = StringFormat(
         "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%I64d,\"bars\":%s,\"bar\":{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}}",
         sym,
         tfLabel,
         (long)TimeCurrent(),
         barsJson,
         (long)t,
         o,
         h,
         l,
         c,
         v
      );
   }
   else
   {
      // Fallback: send a single bar if history isn't available yet.
      payload = StringFormat(
         "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%I64d,\"bar\":{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}}",
         sym,
         tfLabel,
         (long)TimeCurrent(),
         (long)t,
         o,
         h,
         l,
         c,
         v
      );
   }

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

int FindSeedStateIndex(const string key)
{
   int n = ArraySize(g_seedKey);
   for(int i = 0; i < n; i++)
   {
      if(g_seedKey[i] == key)
         return i;
   }
   return -1;
}

bool ShouldSeedTimeframe(const string sym, const string tfLabel)
{
   if(!EnableTimeframeSeeding)
      return false;
   int interval = TimeframeSeedIntervalSec;
   if(interval <= 0)
      interval = 60;

   string key = sym + "|" + tfLabel;
   int idx = FindSeedStateIndex(key);
   datetime now = TimeCurrent();
   if(idx >= 0)
   {
      if(g_seedLastAt[idx] != 0 && (now - g_seedLastAt[idx]) < interval)
         return false;
      g_seedLastAt[idx] = now;
      return true;
   }

   int n = ArraySize(g_seedKey);
   ArrayResize(g_seedKey, n + 1);
   ArrayResize(g_seedLastAt, n + 1);
   g_seedKey[n] = key;
   g_seedLastAt[n] = now;
   return true;
}

bool PostClosedMarketBarForSymbol(string sym, ENUM_TIMEFRAMES tf, string tfLabel)
{
   if(!g_isConnected)
      return false;

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return false;

   // shift=1 => last CLOSED bar
   datetime t = iTime(sym, tf, 1);
   if(t <= 0)
      return true;

   string key = sym + "|" + tfLabel;
   int idx = FindClosedBarStateIndex(key);
   if(idx >= 0 && g_closedBarLastTime[idx] == t)
      return true;

   SymbolSelect(sym, true);

   string barsJson = "";
   int barsCount = 0;
   int depth = BarsHistoryDepthHTF;
   if(depth > 0)
   {
      MqlRates rates[];
      ArraySetAsSeries(rates, true);
      // start_pos=1 => closed bars only
      int copied = CopyRates(sym, tf, 1, depth, rates);
      if(copied > 0)
      {
         barsJson = "[";
         for(int i = 0; i < copied; i++)
         {
            long tt = (long)rates[i].time;
            long vv = (long)rates[i].tick_volume;
            barsJson += StringFormat(
               "{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}",
               tt,
               rates[i].open,
               rates[i].high,
               rates[i].low,
               rates[i].close,
               vv
            );
            if(i < copied - 1)
               barsJson += ",";
         }
         barsJson += "]";
         barsCount = copied;
      }
   }

   double o = iOpen(sym, tf, 1);
   double h = iHigh(sym, tf, 1);
   double l = iLow(sym, tf, 1);
   double c = iClose(sym, tf, 1);
   long v = (long)iVolume(sym, tf, 1);

   string payload = "";
   if(barsCount > 0)
   {
      payload = StringFormat(
         "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%I64d,\"closed\":true,\"bars\":%s,\"bar\":{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}}",
         sym,
         tfLabel,
         (long)TimeCurrent(),
         barsJson,
         (long)t,
         o,
         h,
         l,
         c,
         v
      );
   }
   else
   {
      payload = StringFormat(
         "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"timestamp\":%I64d,\"closed\":true,\"bar\":{\"time\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"volume\":%I64d}}",
         sym,
         tfLabel,
         (long)TimeCurrent(),
         (long)t,
         o,
         h,
         l,
         c,
         v
      );
   }

   string response = "";
   bool ok = BridgeRequest("POST", "/market/bars", payload, response, true);
   if(!ok)
      return false;

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

   return true;
}

int JsonExtractSymbolsArray(const string json, const string key, string &outSymbols[])
{
   ArrayResize(outSymbols, 0);
   int keyPos = StringFind(json, key);
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

string JsonEscapeString(string value)
{
   string s = value;
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

int CollectMarketWatchSymbols(string &outSymbols[], int maxSymbols)
{
   ArrayResize(outSymbols, 0);
   int cap = maxSymbols;
   if(cap <= 0)
      cap = 2000;

   // Prefer selected/MarketWatch symbols.
   int totalSelected = SymbolsTotal(true);
   for(int i = 0; i < totalSelected && ArraySize(outSymbols) < cap; i++)
   {
      string name = SymbolName(i, true);
      if(StringLen(name) <= 0)
         continue;
      int n = ArraySize(outSymbols);
      ArrayResize(outSymbols, n + 1);
      outSymbols[n] = name;
   }

   // Fallback: if MarketWatch is empty, use the full symbol list (bounded).
   if(ArraySize(outSymbols) <= 0)
   {
      int totalAll = SymbolsTotal(false);
      int maxAll = (int)MathMin((double)totalAll, (double)MathMax(500, cap));
      for(int j = 0; j < maxAll && ArraySize(outSymbols) < cap; j++)
      {
         string name2 = SymbolName(j, false);
         if(StringLen(name2) <= 0)
            continue;
         int n2 = ArraySize(outSymbols);
         ArrayResize(outSymbols, n2 + 1);
         outSymbols[n2] = name2;
      }
   }

   return ArraySize(outSymbols);
}

bool PostSymbolUniverse()
{
   if(!EnableSymbolUniverseRegistration)
      return true;
   if(!g_isConnected)
      return false;

   int cap = MaxSymbolUniverseToRegister;
   if(cap <= 0)
      cap = 2000;

   int chunk = SymbolUniverseChunkSize;
   if(chunk <= 0)
      chunk = 200;
   chunk = (int)MathMin((double)chunk, (double)cap);

   string allSyms[];
   int total = CollectMarketWatchSymbols(allSyms, cap);
   if(total <= 0)
      return true;

   int start = 0;
   if(g_symbolUniverseCursor < 0)
      g_symbolUniverseCursor = 0;
   start = (int)(g_symbolUniverseCursor % total);

   string payload = "{\"symbols\":[";
   int added = 0;
   for(int i = 0; i < total && added < chunk; i++)
   {
      int idx = (start + i) % total;
      string sym = allSyms[idx];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) <= 0)
         continue;
      if(added > 0)
         payload += ",";
      payload += "\"" + JsonEscapeString(sym) + "\"";
      added++;
   }
   payload += "]}";

   g_symbolUniverseCursor = (start + added) % MathMax(1, total);

   string response = "";
   return BridgeRequest("POST", "/market/symbols", payload, response, true);
}

bool PollActiveSymbols()
{
   if(!EnableActiveSymbolsPolling)
      return true;
   if(!g_activeSymbolsEndpointSupported)
      return true;
   if(!g_isConnected)
      return false;

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
         return true;
      }
      return false;
   }

   string symbols[];
   int count = JsonExtractSymbolsArray(response, "\"symbols\"", symbols);
   if(count < 0)
      return true;

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
   return true;
}

bool PollAndFulfillSnapshotRequests()
{
   if(!g_isConnected)
      return false;

   string response = "";
   if(!BridgeRequest("GET", "/market/snapshot/requests?max=10", "", response, true))
      return false;

   string symbols[];
   int count = JsonExtractSymbolsArray(response, "\"symbols\"", symbols);
   if(count <= 0)
      return true;

   for(int i = 0; i < count; i++)
   {
      string sym = symbols[i];
      if(StringLen(sym) <= 0)
         continue;

      // Resolve broker-specific symbol variants (e.g., EURGBP -> EURGBPm) and keep it "hot".
      string resolved = ResolveBrokerSymbol(sym);
      AddPrioritySymbol(resolved);

      // Always fulfill on-demand snapshot requests (even if periodic snapshots are disabled).
      PostMarketSnapshotForSymbol(resolved, true);

      // Best-effort: push a lightweight bar too (helps dashboard analysis context).
      PostMarketBarsForSymbol(resolved, PERIOD_M1, "M1");

      // Best-effort: also push closed higher-timeframe bars to support on-demand analysis.
      PostClosedMarketBarForSymbol(resolved, PERIOD_M15, "M15");
      PostClosedMarketBarForSymbol(resolved, PERIOD_H1, "H1");
      PostClosedMarketBarForSymbol(resolved, PERIOD_H4, "H4");
      PostClosedMarketBarForSymbol(resolved, PERIOD_D1, "D1");
   }
   return true;
}

bool PostMarketSnapshotForSymbol(string sym, bool force)
{
   if(!EnableMarketSnapshot && !force)
      return true;
   if(!g_isConnected)
      return false;

   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return false;

   SymbolSelect(sym, true);

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

   // Ranges
   double todayHigh = iHigh(sym, PERIOD_D1, 0);
   double todayLow  = iLow(sym,  PERIOD_D1, 0);
   double weekHigh  = iHigh(sym, PERIOD_W1, 0);
   double weekLow   = iLow(sym,  PERIOD_W1, 0);
   double monthHigh = iHigh(sym, PERIOD_MN1, 0);
   double monthLow  = iLow(sym,  PERIOD_MN1, 0);

   // Pivot (previous day)
   double prevHigh  = iHigh(sym, PERIOD_D1, 1);
   double prevLow   = iLow(sym,  PERIOD_D1, 1);
   double prevClose = iClose(sym, PERIOD_D1, 1);
   double pivot = 0.0, r1 = 0.0, s1 = 0.0;
   if(prevHigh > 0.0 && prevLow > 0.0 && prevClose > 0.0)
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

   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"timestamp\":%I64d,\"timeframes\":{",
      sym,
      (long)TimeCurrent()
   );

   for(int i = 0; i < 4; i++)
   {
      string tfLabel = tfs[i];
      ENUM_TIMEFRAMES tf = TfFromLabel(tfLabel);

      int rsiH = 0;
      int atrH = 0;
      int macdH = 0;
      bool cached = GetIndicatorHandles(sym, tf, rsiH, atrH, macdH);
      if(!cached)
      {
         rsiH = iRSI(sym, tf, 14, PRICE_CLOSE);
         atrH = iATR(sym, tf, 14);
         macdH = iMACD(sym, tf, 12, 26, 9, PRICE_CLOSE);
      }

      double rsi = ReadIndicatorValue(rsiH, 0);
      double atr = ReadIndicatorValue(atrH, 0);
      double macdMain = ReadIndicatorValue(macdH, 0);
      double macdSignal = ReadIndicatorValue(macdH, 1);
      double macdHist = macdMain - macdSignal;

      double o = iOpen(sym, tf, 0);
      double h = iHigh(sym, tf, 0);
      double l = iLow(sym, tf, 0);
      double c = iClose(sym, tf, 0);
      datetime t = iTime(sym, tf, 0);

      if(!EnableIndicatorHandleCache)
      {
         if(rsiH > 0) IndicatorRelease(rsiH);
         if(atrH > 0) IndicatorRelease(atrH);
         if(macdH > 0) IndicatorRelease(macdH);
      }

      double score = 0.0;
      string dir = ScoreDirectionFromIndicators(rsi, macdHist, score);

      if(i > 0)
         payload += ",";

      payload += StringFormat(
         "\"%s\":{\"timeframe\":\"%s\",\"direction\":\"%s\",\"score\":%.2f,\"lastPrice\":%.8f,\"latestCandle\":{\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f,\"time\":%I64d},\"indicators\":{\"rsi\":{\"value\":%.2f},\"macd\":{\"histogram\":%.8f},\"atr\":{\"value\":%.8f}}",
         tfLabel,
         tfLabel,
         dir,
         score,
         c,
         o,
         h,
         l,
         c,
         (long)t,
         rsi,
         macdHist,
         atr
      );

      if(tfLabel == "D1")
      {
         payload += StringFormat(
            ",\"ranges\":{\"day\":{\"high\":%.10f,\"low\":%.10f},\"week\":{\"high\":%.10f,\"low\":%.10f},\"month\":{\"high\":%.10f,\"low\":%.10f}},\"pivotPoints\":{\"pivot\":%.10f,\"r1\":%.10f,\"s1\":%.10f}",
            todayHigh,
            todayLow,
            weekHigh,
            weekLow,
            monthHigh,
            monthLow,
            pivot,
            r1,
            s1
         );
      }

      payload += "}";
   }

   payload += "}}";

   string response = "";
   if(BridgeRequest("POST", "/market/snapshot", payload, response, true))
   {
      return true;
   }
   return false;
}

bool HttpRequest(const string method,
                 const string path,
                 const string payload,
                 string &response)
{
   string headers = "Content-Type: application/json\r\n";
   if(StringLen(ApiToken) > 0)
      headers += "Authorization: Bearer " + ApiToken + "\r\n";
   uchar body[];
   int length = StringToCharArray(payload, body, 0, WHOLE_ARRAY, CP_UTF8);
   if(length < 0)
   {
      Print("Failed to encode payload");
      return false;
   }
   // Strip the trailing NUL terminator; Node's JSON parser treats it as non-whitespace.
   if(length > 0 && body[length - 1] == 0)
      length -= 1;
   ArrayResize(body, length);
   uchar result[];
   string resultHeaders = "";

   // Allow leaving BridgeUrl empty ("just attach EA"), defaulting to local bridge.
   string baseUrl = StringLen(BridgeUrl) > 0 ? BridgeUrl : "http://127.0.0.1:4101/api/broker/bridge/mt5";
   string url = baseUrl;
   if(StringSubstr(path, 0, 1) != "/")
      url = url + "/" + path;
   else
      url = url + path;

   ResetLastError();
   int status = WebRequest(method, url, headers, RequestTimeoutMs, body, result, resultHeaders);
   g_lastHttpStatus = status;
   int lastErr = GetLastError();
   if(status == -1)
   {
      g_lastWebError = lastErr;
      PrintFormat("WebRequest error: %d url=%s", lastErr, url);
      if(lastErr == 4014)
      {
         Print("WebRequest blocked by terminal settings (4014). Fix:");
         Print("1) Tools -> Options -> Expert Advisors");
         Print("2) Enable: 'Allow WebRequest for listed URL'");
         Print("3) Add this URL exactly: http://127.0.0.1:4101");
         Print("(Must match BridgeUrl host; restart EA after adding.)");
      }
      string hint = WebRequestHint(lastErr, url);
      if(StringLen(hint) > 0)
         Print("Hint: ", hint);
      return false;
   }

   // WebRequest should return a real HTTP status (100..599). Some terminals return non-HTTP
   // codes (e.g., 1001) for transport failures; treat those as connection errors.
   if(status < 100 || status > 599)
   {
      g_lastWebError = lastErr;
      PrintFormat(
         "WebRequest transport failure: code=%d lastErr=%d url=%s",
         status,
         lastErr,
         url
      );
      string hint = WebRequestHint(lastErr, url);
      if(StringLen(hint) > 0)
         Print("Hint: ", hint);
      return false;
   }

   response = CharArrayToString(result);
   if(status >= 200 && status < 300)
      return true;

   PrintFormat("Bridge request failed: %d -> %s", status, response);
   return false;
}

bool PostMarketQuotes()
{
   if(!EnableMarketFeed)
      return true;
   if(!g_isConnected)
      return false;

   PrunePrioritySymbols();

   string symbols[];
   int symbolCount = 0;

   if(StringLen(FeedSymbolsCsv) > 0)
   {
      string tmp = FeedSymbolsCsv;
      StringReplace(tmp, " ", "");
      symbolCount = StringSplit(tmp, ',', symbols);
   }

   // Always include chart symbol
   string chartSymbol = Symbol();
   if(symbolCount <= 0)
   {
      ArrayResize(symbols, 1);
      symbols[0] = chartSymbol;
      symbolCount = 1;
   }
   else
   {
      bool found = false;
      for(int i = 0; i < symbolCount; i++)
      {
         if(symbols[i] == chartSymbol)
         {
            found = true;
            break;
         }
      }
      if(!found)
      {
         int newSize = symbolCount + 1;
         ArrayResize(symbols, newSize);
         symbols[newSize - 1] = chartSymbol;
         symbolCount = newSize;
      }
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

   // Optionally include MarketWatch symbols
   if(IncludeMarketWatch)
   {
      int total = SymbolsTotal(true);
      for(int i = 0; i < total && symbolCount < MaxMarketWatchSymbols; i++)
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
   int maxThisPost = (int)MathMin((double)MaxSymbolsToSend, (double)perPost);
   if(maxThisPost < 1)
      maxThisPost = 1;

   // 1) Priority symbols first (requested by dashboard)
   if(EnablePrioritySymbols)
   {
      int prioN = ArraySize(g_prioritySymbols);
      int prioCap = MathMax(0, MaxPriorityQuotesPerPost);
      if(prioCap <= 0) prioCap = 10;
      for(int i = 0; i < prioN && added < maxThisPost && i < prioCap; i++)
      {
         string sym = g_prioritySymbols[i];
         if(StringLen(sym) <= 0)
            continue;
         if(!SymbolSelect(sym, true))
            continue;

         MqlTick tick;
         if(!SymbolInfoTick(sym, tick))
            continue;

         if(!ShouldSendQuote(sym, (long)tick.time_msc))
            continue;

         int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
         double point = SymbolInfoDouble(sym, SYMBOL_POINT);
         double spreadPoints = -1.0;
         if(point > 0.0 && tick.bid > 0.0 && tick.ask > 0.0)
            spreadPoints = (tick.ask - tick.bid) / point;

         if(added > 0)
            payload += ",";

         payload += StringFormat(
            "{\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"digits\":%d,\"point\":%.10f,\"spreadPoints\":%.2f,\"timestamp\":%I64d}",
            sym,
            tick.bid,
            tick.ask,
            tick.last,
            digits,
            point,
            spreadPoints,
            (long)tick.time_msc
         );
         added++;
      }
   }

   // 2) Always include chart symbol (if not already sent)
   if(added < maxThisPost)
   {
      string chartSym = Symbol();
      if(StringLen(chartSym) > 0)
      {
         bool already = false;
         int prioN = ArraySize(g_prioritySymbols);
         for(int i = 0; i < prioN; i++)
         {
            if(g_prioritySymbols[i] == chartSym)
            {
               already = true;
               break;
            }
         }

         if(!already && SymbolSelect(chartSym, true))
         {
            MqlTick tick;
            if(SymbolInfoTick(chartSym, tick) && ShouldSendQuote(chartSym, (long)tick.time_msc))
            {
               int digits = (int)SymbolInfoInteger(chartSym, SYMBOL_DIGITS);
               double point = SymbolInfoDouble(chartSym, SYMBOL_POINT);
               double spreadPoints = -1.0;
               if(point > 0.0 && tick.bid > 0.0 && tick.ask > 0.0)
                  spreadPoints = (tick.ask - tick.bid) / point;

               if(added > 0)
                  payload += ",";

               payload += StringFormat(
                  "{\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"digits\":%d,\"point\":%.10f,\"spreadPoints\":%.2f,\"timestamp\":%I64d}",
                  chartSym,
                  tick.bid,
                  tick.ask,
                  tick.last,
                  digits,
                  point,
                  spreadPoints,
                  (long)tick.time_msc
               );
               added++;
            }
         }
      }
   }

   // 3) Then rotate through the large symbol list (MarketWatch / configured feed)
   int start = 0;
   if(symbolCount > 0)
      start = (int)(g_marketFeedCursor % symbolCount);

   for(int k = 0; k < symbolCount && added < maxThisPost; k++)
   {
      int idx = (start + k) % symbolCount;
      string sym = symbols[idx];
      if(StringLen(sym) <= 0)
         continue;

      // Skip if already present in priority list
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

      if(!SymbolSelect(sym, true))
         continue;

      MqlTick tick;
      if(!SymbolInfoTick(sym, tick))
         continue;

      if(!ShouldSendQuote(sym, (long)tick.time_msc))
         continue;

      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      double spreadPoints = -1.0;
      if(point > 0.0 && tick.bid > 0.0 && tick.ask > 0.0)
         spreadPoints = (tick.ask - tick.bid) / point;

      if(added > 0)
         payload += ",";

      payload += StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"last\":%.10f,\"digits\":%d,\"point\":%.10f,\"spreadPoints\":%.2f,\"timestamp\":%I64d}",
         sym,
         tick.bid,
         tick.ask,
         tick.last,
         digits,
         point,
         spreadPoints,
         (long)tick.time_msc
      );
      added++;
   }

   if(symbolCount > 0)
      g_marketFeedCursor = (start + MathMax(1, added)) % symbolCount;

   payload += "]}";

   string response = "";
   if(added <= 0)
      return true;
   return BridgeRequest("POST", "/market/quotes", payload, response, true);
}

bool PostConnectNewsOnce()
{
   if(g_sentConnectNews || !g_isConnected)
      return true;

   string id = StringFormat("mt5-connect-%I64d-%I64d", AccountInfoInteger(ACCOUNT_LOGIN), (long)TimeCurrent());
   string title = StringFormat("MT5 connected (%s) %s", AccountMode(), AccountInfoString(ACCOUNT_SERVER));
   string notes = StringFormat("Equity %.2f Balance %.2f Currency %s", AccountInfoDouble(ACCOUNT_EQUITY), AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoString(ACCOUNT_CURRENCY));

   string payload = "{\"items\":[";
   payload += StringFormat(
      "{\"id\":\"%s\",\"title\":\"%s\",\"time\":%I64d,\"impact\":\"info\",\"source\":\"ea\",\"notes\":\"%s\"}",
      id,
      title,
      (long)TimeCurrent(),
      notes
   );
   payload += "]}";

   string response = "";
   if(BridgeRequest("POST", "/market/news", payload, response, true))
   {
      g_sentConnectNews = true;
      return true;
   }
   return false;
}

bool HasOpenPositionForSymbol(const string symbol)
{
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(sym == symbol && magic == MagicNumber)
         return true;
   }
   return false;
}

void ManagePositionsBreakeven()
{
   if(!EnableBreakeven)
      return;

   if(TradeModifyCooldownSec > 0 && g_lastTradeModifyAt > 0 && (TimeCurrent() - g_lastTradeModifyAt) < (datetime)TradeModifyCooldownSec)
      return;

   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(magic != MagicNumber)
         continue;

      long type = PositionGetInteger(POSITION_TYPE);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double pip = PipSize(sym);

      double bid = 0.0, ask = 0.0;
      if(!SymbolInfoDouble(sym, SYMBOL_BID, bid) || !SymbolInfoDouble(sym, SYMBOL_ASK, ask))
         continue;

      double current = (type == POSITION_TYPE_BUY) ? bid : ask;
      double profitPips = (type == POSITION_TYPE_BUY) ? (current - openPrice) / pip : (openPrice - current) / pip;

      if(profitPips < BreakevenTriggerPips)
         continue;

      bool needsMove = false;
      if(type == POSITION_TYPE_BUY)
         needsMove = (sl <= 0.0 || sl < openPrice);
      else
         needsMove = (sl <= 0.0 || sl > openPrice);

      if(!needsMove)
         continue;

      MqlTradeRequest req;
      MqlTradeResult res;
      ZeroMemory(req);
      ZeroMemory(res);

      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(!(point > 0.0))
         point = 0.00001;
      double desiredSl = openPrice;
      if(BreakevenBufferPoints > 0)
      {
         if(type == POSITION_TYPE_BUY)
            desiredSl = openPrice + (double)BreakevenBufferPoints * point;
         else
            desiredSl = openPrice - (double)BreakevenBufferPoints * point;
      }

      // Clamp to broker stop/freeze distance from current price.
      double newSl = ClampStopLevelForPosition(sym, type, desiredSl, bid, ask);

      // If clamping makes the SL worse than entry (e.g., not enough distance yet), wait.
      if(type == POSITION_TYPE_BUY && newSl <= openPrice)
         continue;
      if(type == POSITION_TYPE_SELL && newSl >= openPrice)
         continue;

      req.action = TRADE_ACTION_SLTP;
      req.symbol = sym;
      req.magic = MagicNumber;
      req.position = (ulong)PositionGetInteger(POSITION_TICKET);
      req.sl = newSl;
      req.tp = tp;

      if(!OrderSend(req, res))
      {
         PrintFormat("Breakeven modify failed for %s: %d", sym, GetLastError());
         continue;
      }

      g_lastTradeModifyAt = TimeCurrent();
   }
}

void ManagePositionsTrailingStop()
{
   if(!EnableTrailingStop)
      return;

   if(TrailingStartPips <= 0.0 || TrailingDistancePips <= 0.0)
      return;

   if(TradeModifyCooldownSec > 0 && g_lastTradeModifyAt > 0 && (TimeCurrent() - g_lastTradeModifyAt) < (datetime)TradeModifyCooldownSec)
      return;

   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(magic != MagicNumber)
         continue;

      long type = PositionGetInteger(POSITION_TYPE);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);

      double pip = PipSize(sym);
      if(!(pip > 0.0))
         continue;

      double bid = 0.0, ask = 0.0;
      if(!SymbolInfoDouble(sym, SYMBOL_BID, bid) || !SymbolInfoDouble(sym, SYMBOL_ASK, ask))
         continue;

      double current = (type == POSITION_TYPE_BUY) ? bid : ask;
      double profitPips = (type == POSITION_TYPE_BUY) ? (current - openPrice) / pip : (openPrice - current) / pip;

      double startPips = TrailingStartPips;
      double distPips = TrailingDistancePips;
      if(EnableAtrTrailing)
      {
         double atrPips = ReadAtrPips(sym, AtrTrailingTf);
         if(atrPips > 0.0)
         {
            if(AtrStartMultiplier > 0.0)
               startPips = MathMax(startPips, atrPips * AtrStartMultiplier);
            if(AtrTrailMultiplier > 0.0)
               distPips = MathMax(distPips, atrPips * AtrTrailMultiplier);
         }
      }

      if(profitPips < startPips)
         continue;

      // Propose trailing SL.
      double desiredSl = sl;
      if(type == POSITION_TYPE_BUY)
         desiredSl = current - (distPips * pip);
      else
         desiredSl = current + (distPips * pip);

      double newSl = ClampStopLevelForPosition(sym, type, desiredSl, bid, ask);

      // Only tighten SL.
      if(type == POSITION_TYPE_BUY)
      {
         if(newSl <= 0.0 || newSl <= sl)
            continue;
      }
      else
      {
         if(newSl <= 0.0 || (sl > 0.0 && newSl >= sl))
            continue;
      }

      // Require a minimum improvement to avoid modification spam.
      if(TrailingStepPoints > 0)
      {
         double point = SymbolInfoDouble(sym, SYMBOL_POINT);
         if(!(point > 0.0))
            point = 0.00001;
         if(MathAbs(newSl - sl) < (double)TrailingStepPoints * point)
            continue;
      }

      MqlTradeRequest req;
      MqlTradeResult res;
      ZeroMemory(req);
      ZeroMemory(res);
      req.action = TRADE_ACTION_SLTP;
      req.symbol = sym;
      req.magic = MagicNumber;
      req.position = (ulong)PositionGetInteger(POSITION_TICKET);
      req.sl = newSl;
      req.tp = tp;

      if(!OrderSend(req, res))
      {
         if(VerboseTradeLogs)
            PrintFormat("Trailing modify failed for %s: %d", sym, GetLastError());
         continue;
      }

      if(VerboseTradeLogs)
         PrintFormat("Trailing SL updated for %s: %.5f", sym, newSl);
      g_lastTradeModifyAt = TimeCurrent();
   }
}

void CheckAndExecuteSignals()
{
   if(!EnableAutoTrading || !g_isConnected)
      return;

   // Smart discipline: stop initiating new trades after daily limits/targets.
   // (Position management continues independently.)
   if(!IsDailyTradingAllowed())
      return;

   // Trade across dashboard-driven active symbols (or fallback to chart symbol).
   string candidates[];
   int activeN = ArraySize(g_activeSymbols);
   if(activeN > 0)
   {
      int cap = activeN;
      if(MaxSymbolsToTrade > 0)
         cap = (int)MathMin((double)activeN, (double)MaxSymbolsToTrade);
      ArrayResize(candidates, cap);
      for(int i = 0; i < cap; i++)
         candidates[i] = g_activeSymbols[i];

      // Always include a core set of liquid majors/crosses/metals so the EA can still
      // catch executable signals even if the dashboard symbol list is narrow.
      string core[];
      ArrayResize(core, 18);
      core[0]  = "EURUSD";
      core[1]  = "GBPUSD";
      core[2]  = "USDJPY";
      core[3]  = "USDCHF";
      core[4]  = "USDCAD";
      core[5]  = "AUDUSD";
      core[6]  = "NZDUSD";
      core[7]  = "EURJPY";
      core[8]  = "GBPJPY";
      core[9]  = "AUDJPY";
      core[10] = "NZDJPY";
      core[11] = "EURGBP";
      core[12] = "EURAUD";
      core[13] = "EURNZD";
      core[14] = "GBPAUD";
      core[15] = "GBPNZD";
      core[16] = "XAUUSD";
      core[17] = "XAGUSD";

      for(int c = 0; c < ArraySize(core); c++)
      {
         string s = core[c];
         bool exists = false;
         for(int j = 0; j < ArraySize(candidates); j++)
         {
            if(candidates[j] == s)
            {
               exists = true;
               break;
            }
         }
         if(exists)
            continue;

         if(MaxSymbolsToTrade > 0 && ArraySize(candidates) >= MaxSymbolsToTrade)
            break;

         int newN = ArraySize(candidates) + 1;
         ArrayResize(candidates, newN);
         candidates[newN - 1] = s;
      }
   }
   else
   {
      // Fallback set: chart symbol + a few liquid majors/metals.
      // Prevents "no trades" when the chart is on an exotic/crypto.
      ArrayResize(candidates, 19);
      candidates[0]  = Symbol();
      candidates[1]  = "EURUSD";
      candidates[2]  = "GBPUSD";
      candidates[3]  = "USDJPY";
      candidates[4]  = "USDCHF";
      candidates[5]  = "USDCAD";
      candidates[6]  = "AUDUSD";
      candidates[7]  = "NZDUSD";
      candidates[8]  = "EURJPY";
      candidates[9]  = "GBPJPY";
      candidates[10] = "AUDJPY";
      candidates[11] = "NZDJPY";
      candidates[12] = "EURGBP";
      candidates[13] = "EURAUD";
      candidates[14] = "EURNZD";
      candidates[15] = "GBPAUD";
      candidates[16] = "GBPNZD";
      candidates[17] = "XAUUSD";
      candidates[18] = "XAGUSD";
   }

   int n = ArraySize(candidates);
   if(n <= 0)
      return;

   int checks = SymbolsToCheckPerSignalPoll;
   if(checks <= 0)
      checks = 1;
   if(checks > n)
      checks = n;

   // Pick the strongest executable signal among the checked symbols.
   bool found = false;
   string bestSym = "";
   string bestDirection = "";
   double bestEntry = 0.0, bestSl = 0.0, bestTp = 0.0, bestLots = DefaultLots;
   double bestStrength = -1.0;
   double bestConfidence = -1.0;

   for(int iter = 0; iter < checks; iter++)
   {
      int idx = 0;
      if(g_tradeCursor < 0)
         g_tradeCursor = 0;
      idx = (int)(g_tradeCursor % n);
      g_tradeCursor++;

      string sym = ResolveBrokerSymbol(candidates[idx]);
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) <= 0)
         continue;

      if(!IsTradeSymbolEligible(sym))
         continue;

      SymbolSelect(sym, true);

      if(HasOpenPositionForSymbol(sym))
         continue;

      if(MaxSpreadPoints > 0 && CurrentSpreadPoints(sym) > MaxSpreadPoints)
         continue;

      if(EnableVolatilityFilter)
      {
         double atrPips = ReadAtrPips(sym, VolatilityFilterTf);
         if(atrPips <= 0.0)
            continue;
         if(MinAtrPips > 0.0 && atrPips < MinAtrPips)
            continue;
         if(MaxAtrPips > 0.0 && atrPips > MaxAtrPips)
            continue;

         if(MaxSpreadToAtrPct > 0.0)
         {
            double point = SymbolInfoDouble(sym, SYMBOL_POINT);
            if(!(point > 0.0))
               point = 0.00001;
            double pip = PipSize(sym);
            if(pip > 0.0)
            {
               int spreadPts = CurrentSpreadPoints(sym);
               double spreadPips = (spreadPts * point) / pip;
               if(spreadPips > (atrPips * (MaxSpreadToAtrPct / 100.0)))
                  continue;
            }
         }
      }

      string response = "";
      string path = StringFormat("/signal/get?symbol=%s&accountMode=%s", sym, AccountMode());
      if(!BridgeRequest("GET", path, "", response, true))
         continue;

      if(StringFind(response, "\"success\":true") < 0 && StringFind(response, "\"success\" : true") < 0)
         continue;

      bool shouldExecute = true;
      string direction = "";
      double entry = 0.0, sl = 0.0, tp = 0.0, lots = DefaultLots;
      if(!ParseSignalForExecution(response, direction, entry, sl, tp, lots, shouldExecute))
         continue;
      if(RespectServerExecution && !shouldExecute)
         continue;

      double strength = 0.0;
      double confidence = 0.0;
      ExtractSignalStrengthConfidence(response, strength, confidence);

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
         bestDirection = direction;
         bestEntry = entry;
         bestSl = sl;
         bestTp = tp;
         bestLots = lots;
         bestStrength = strength;
         bestConfidence = confidence;
      }
   }

   if(!found)
      return;

   // Resolve broker-specific symbol naming (suffix/prefix) before trading.
   string resolvedSym = ResolveBrokerSymbol(bestSym);
   if(StringLen(resolvedSym) > 0 && resolvedSym != bestSym)
   {
      if(VerboseTradeLogs)
         PrintFormat("Resolved trade symbol %s -> %s", bestSym, resolvedSym);
      bestSym = resolvedSym;
   }

   // Ensure the symbol is selected and has a current tick.
   if(!SymbolSelect(bestSym, true))
   {
      if(VerboseTradeLogs)
         PrintFormat("Cannot select symbol for trading: %s (err=%d)", bestSym, GetLastError());
      return;
   }

   // If this symbol recently failed in a broker-specific way, back off for a while.
   if(StringLen(g_tradeCooldownSymbol) > 0 && bestSym == g_tradeCooldownSymbol && TimeCurrent() < g_tradeCooldownUntil)
   {
      if(VerboseTradeLogs)
         PrintFormat("Skipping %s due to cooldown until %s", bestSym, TimeToString(g_tradeCooldownUntil, TIME_DATE|TIME_SECONDS));
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(bestSym, tick) || !(tick.bid > 0.0) || !(tick.ask > 0.0))
   {
      if(VerboseTradeLogs)
         PrintFormat("No valid tick for %s (bid=%.5f ask=%.5f err=%d)", bestSym, tick.bid, tick.ask, GetLastError());
      return;
   }

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      if(VerboseTradeLogs)
         Print("Trade not allowed (check MT5 Algo Trading / account permissions).");
      return;
   }

   // This is the most common hidden blocker: EA is attached but 'Allow Algo Trading' is OFF.
   long mqlTradeAllowed = (long)MQLInfoInteger(MQL_TRADE_ALLOWED);
   if(mqlTradeAllowed == 0)
   {
      if(VerboseTradeLogs)
      {
         Print("MQL_TRADE_ALLOWED=0 (EA is not permitted to trade). Open EA properties -> Common -> enable 'Allow Algo Trading', and ensure the main Algo Trading button is ON.");
         LogTradePermissionSnapshot(bestSym);
      }
      return;
   }

   long acctExpertAllowed = 1;
   acctExpertAllowed = AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
   if(acctExpertAllowed == 0)
   {
      if(VerboseTradeLogs)
      {
         Print("ACCOUNT_TRADE_EXPERT=0 (broker/account blocks Expert trading). Try a different account or ask broker to enable EA trading.");
         LogTradePermissionSnapshot(bestSym);
      }
      return;
   }

   // Verify symbol trading mode supports the requested direction.
   long tradeMode = 0;
   if(SymbolInfoInteger(bestSym, SYMBOL_TRADE_MODE, tradeMode))
   {
      bool buyOk = (tradeMode == SYMBOL_TRADE_MODE_FULL || tradeMode == SYMBOL_TRADE_MODE_LONGONLY);
      bool sellOk = (tradeMode == SYMBOL_TRADE_MODE_FULL || tradeMode == SYMBOL_TRADE_MODE_SHORTONLY);
      if((bestDirection == "BUY" || bestDirection == "LONG") && !buyOk)
      {
         if(VerboseTradeLogs)
            PrintFormat("Symbol %s is not BUY-tradable (tradeMode=%d)", bestSym, (int)tradeMode);
         return;
      }
      if((bestDirection == "SELL" || bestDirection == "SHORT") && !sellOk)
      {
         if(VerboseTradeLogs)
            PrintFormat("Symbol %s is not SELL-tradable (tradeMode=%d)", bestSym, (int)tradeMode);
         return;
      }
   }

   // Clamp lot size
   if(bestLots <= 0.0)
      bestLots = DefaultLots;
   if(bestLots < MinLotSize)
      bestLots = MinLotSize;
   if(bestLots > MaxLotSize)
      bestLots = MaxLotSize;

   // Normalize lots to broker's volume constraints (min/max/step)
   double vMin = 0.0, vMax = 0.0, vStep = 0.0;
   SymbolInfoDouble(bestSym, SYMBOL_VOLUME_MIN, vMin);
   SymbolInfoDouble(bestSym, SYMBOL_VOLUME_MAX, vMax);
   SymbolInfoDouble(bestSym, SYMBOL_VOLUME_STEP, vStep);
   bestLots = ClampAndStepVolume(bestLots, vMin, vMax, vStep);

   // Ensure trade context
   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_DEAL;
   req.symbol = bestSym;
   req.magic = MagicNumber;
   req.volume = bestLots;
   req.deviation = MaxSlippagePoints;
   req.type_time = ORDER_TIME_GTC;

   long fillMode = 0;
   if(SymbolInfoInteger(bestSym, SYMBOL_FILLING_MODE, fillMode))
      req.type_filling = (ENUM_ORDER_TYPE_FILLING)fillMode;
   else
      req.type_filling = ORDER_FILLING_FOK;

   // Some brokers report BOC (3) as a default; it's not valid for market deals.
   if(!IsMarketFillMode(req.type_filling))
      req.type_filling = ORDER_FILLING_FOK;

   double ask = tick.ask;
   double bid = tick.bid;

   if(bestDirection == "BUY" || bestDirection == "LONG")
   {
      req.type = ORDER_TYPE_BUY;
      req.price = ask;
      req.sl = bestSl;
      req.tp = bestTp;
   }
   else if(bestDirection == "SELL" || bestDirection == "SHORT")
   {
      req.type = ORDER_TYPE_SELL;
      req.price = bid;
      req.sl = bestSl;
      req.tp = bestTp;
   }
   else
   {
      return;
   }

   // Normalize price levels to symbol digits.
   int digits = (int)SymbolInfoInteger(bestSym, SYMBOL_DIGITS);
   if(digits < 0) digits = 5;
   req.price = NormalizeDouble(req.price, digits);
   if(req.sl > 0.0) req.sl = NormalizeDouble(req.sl, digits);
   if(req.tp > 0.0) req.tp = NormalizeDouble(req.tp, digits);

   // Smart sizing: reduce lots to fit free margin budget.
   double affordable = ComputeMaxAffordableVolume(req.type, bestSym, req.volume, req.price, vMin, vMax, vStep);
   if(affordable > 0.0 && affordable < req.volume)
   {
      if(VerboseTradeLogs)
      {
         double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
         double needBefore = ComputeMarginRequired(req.type, bestSym, req.volume, req.price);
         double needAfter = ComputeMarginRequired(req.type, bestSym, affordable, req.price);
         PrintFormat("Auto-sizing lots for margin: %.2f -> %.2f (freeMargin=%.2f needBefore=%.2f needAfter=%.2f)", req.volume, affordable, freeMargin, needBefore, needAfter);
      }
      req.volume = affordable;
   }

   // Sanitize SL/TP so invalid levels don't block order placement.
   long stopsLevelPoints = 0;
   SymbolInfoInteger(bestSym, SYMBOL_TRADE_STOPS_LEVEL, stopsLevelPoints);
   double point = SymbolInfoDouble(bestSym, SYMBOL_POINT);
   if(!(point > 0.0))
      point = 0.00001;
   double minStopDist = (double)stopsLevelPoints * point;

   bool isBuy = (req.type == ORDER_TYPE_BUY);
   if(req.sl > 0.0)
   {
      if((isBuy && req.sl >= req.price) || (!isBuy && req.sl <= req.price))
      {
         if(DropInvalidStops)
            req.sl = 0.0;
      }
      if(req.sl > 0.0 && minStopDist > 0.0)
      {
         double dist = isBuy ? (req.price - req.sl) : (req.sl - req.price);
         if(dist < minStopDist)
         {
            if(DropInvalidStops)
               req.sl = 0.0;
         }
      }
   }
   if(req.tp > 0.0)
   {
      if((isBuy && req.tp <= req.price) || (!isBuy && req.tp >= req.price))
      {
         if(DropInvalidStops)
            req.tp = 0.0;
      }
      if(req.tp > 0.0 && minStopDist > 0.0)
      {
         double dist = isBuy ? (req.tp - req.price) : (req.price - req.tp);
         if(dist < minStopDist)
         {
            if(DropInvalidStops)
               req.tp = 0.0;
         }
      }
   }

   if(VerboseTradeLogs)
      PrintFormat("SG trade attempt %s %s lots=%.2f price=%.5f sl=%.5f tp=%.5f", bestSym, bestDirection, bestLots, req.price, req.sl, req.tp);

   // Try with a couple of fill modes; brokers sometimes reject one mode.
   // Always try the symbol's default fill mode first (if valid for market deals).
   ENUM_ORDER_TYPE_FILLING fills[3];
   BuildFillModeTryOrder(req.type_filling, fills[0], fills[1], fills[2]);
   bool sent = false;
   bool had4756 = false;
   int noMoneyRetries = 0;
   for(int i = 0; i < 3; i++)
   {
      req.type_filling = fills[i];

      // Pre-flight validation with OrderCheck for actionable diagnostics.
      MqlTradeCheckResult check;
      ZeroMemory(check);
      ResetLastError();
      bool checkOk = OrderCheck(req, check);
      if(!checkOk)
      {
         int err = GetLastError();
         if(err == 4756)
            had4756 = true;
         if(VerboseTradeLogs)
         {
            string hint = TradeErrorText(err);
            PrintFormat("OrderCheck failed for %s (fill=%d): err=%d %s", bestSym, (int)req.type_filling, err, hint);
            LogTradePermissionSnapshot(bestSym);
         }
         continue;
      }

      if(!IsOrderCheckAcceptable(check))
      {
         // Many brokers return detailed reasons here even when OrderSend would just fail.
         if(VerboseTradeLogs)
            PrintFormat("OrderCheck rejected for %s (fill=%d): retcode=%d comment=%s", bestSym, (int)req.type_filling, (int)check.retcode, check.comment);
         continue;
      }

      ZeroMemory(res);
      ResetLastError();
      if(!OrderSend(req, res))
      {
         int err = GetLastError();
         if(err == 4756)
            had4756 = true;
         if(VerboseTradeLogs)
            PrintFormat(
               "OrderSend failed for %s (fill=%d): err=%d retcode=%d comment=%s",
               bestSym,
               (int)req.type_filling,
               err,
               (int)res.retcode,
               res.comment
            );

         // If broker says "No money", automatically step lots down and retry a few times.
         if(res.retcode == 10019)
         {
            if(MaxNoMoneyRetries >= 0 && noMoneyRetries >= MaxNoMoneyRetries)
            {
               if(VerboseTradeLogs)
                  PrintFormat("No-money retries exhausted for %s (max=%d)", bestSym, MaxNoMoneyRetries);
               continue;
            }

            double current = req.volume;
            double next = current;
            if(vStep > 0.0)
               next = current - vStep;
            else
               next = current * 0.5;
            next = ClampAndStepVolume(next, vMin, vMax, vStep);
            if(next >= vMin && next < current)
            {
               if(VerboseTradeLogs)
                  PrintFormat("Reducing lots due to No money: %.2f -> %.2f and retrying", current, next);
               req.volume = next;
               noMoneyRetries++;
               // redo this fill mode with smaller volume
               i -= 1;
            }
            else
            {
               if(VerboseTradeLogs)
                  Print("Cannot reduce lots further; insufficient margin.");
            }
         }
         continue;
      }

      if(res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED)
      {
         sent = true;
         if(VerboseTradeLogs)
            PrintFormat("Order accepted for %s: retcode=%d comment=%s", bestSym, (int)res.retcode, res.comment);
         break;
      }

      if(VerboseTradeLogs)
         PrintFormat("Order rejected for %s (fill=%d): retcode=%d comment=%s", bestSym, (int)req.type_filling, (int)res.retcode, res.comment);
   }

   if(!sent && had4756 && SymbolFailureCooldownSec > 0)
   {
      g_tradeCooldownSymbol = bestSym;
      g_tradeCooldownUntil = TimeCurrent() + (datetime)SymbolFailureCooldownSec;
      if(VerboseTradeLogs)
         PrintFormat("Cooldown set for %s due to 4756 failures (until %s)", bestSym, TimeToString(g_tradeCooldownUntil, TIME_DATE|TIME_SECONDS));
   }

   if(!sent)
      return;
}

void ClearSignalOverlayObjects()
{
   ObjectDelete(0, "SG_SIG_ARROW");
   ObjectDelete(0, "SG_SIG_TEXT");
   ObjectDelete(0, "SG_SIG_SL");
   ObjectDelete(0, "SG_SIG_TP");
}

void DrawSignalOverlay(const string sym, const string direction, const double entry, const double sl, const double tp, const double strength, const double confidence)
{
   if(sym != Symbol())
      return;

   datetime t = iTime(sym, PERIOD_CURRENT, 0);
   if(t <= 0)
      t = TimeCurrent();

   double price = entry;
   if(!(price > 0.0))
   {
      double bid = 0.0;
      if(SymbolInfoDouble(sym, SYMBOL_BID, bid))
         price = bid;
      else
         price = iClose(sym, PERIOD_CURRENT, 0);
   }

   color arrowColor = clrDodgerBlue;
   int arrowCode = 233;
   string dir = direction;
   StringToUpper(dir);
   if(dir == "BUY" || dir == "LONG")
   {
      arrowColor = clrLime;
      arrowCode = 233;
   }
   else if(dir == "SELL" || dir == "SHORT")
   {
      arrowColor = clrTomato;
      arrowCode = 234;
   }

   ObjectDelete(0, "SG_SIG_ARROW");
   ObjectCreate(0, "SG_SIG_ARROW", OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, "SG_SIG_ARROW", OBJPROP_COLOR, arrowColor);
   ObjectSetInteger(0, "SG_SIG_ARROW", OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, "SG_SIG_ARROW", OBJPROP_ARROWCODE, arrowCode);

   string label = StringFormat("%s  S%.0f  C%.0f%%", dir, strength, confidence);
   ObjectDelete(0, "SG_SIG_TEXT");
   ObjectCreate(0, "SG_SIG_TEXT", OBJ_TEXT, 0, t, price);
   ObjectSetString(0, "SG_SIG_TEXT", OBJPROP_TEXT, label);
   ObjectSetInteger(0, "SG_SIG_TEXT", OBJPROP_COLOR, arrowColor);
   ObjectSetInteger(0, "SG_SIG_TEXT", OBJPROP_FONTSIZE, 9);

   if(OverlayDrawStopLossTakeProfit)
   {
      if(sl > 0.0)
      {
         ObjectDelete(0, "SG_SIG_SL");
         ObjectCreate(0, "SG_SIG_SL", OBJ_HLINE, 0, 0, sl);
         ObjectSetInteger(0, "SG_SIG_SL", OBJPROP_COLOR, clrTomato);
         ObjectSetInteger(0, "SG_SIG_SL", OBJPROP_STYLE, STYLE_DOT);
      }
      else
      {
         ObjectDelete(0, "SG_SIG_SL");
      }

      if(tp > 0.0)
      {
         ObjectDelete(0, "SG_SIG_TP");
         ObjectCreate(0, "SG_SIG_TP", OBJ_HLINE, 0, 0, tp);
         ObjectSetInteger(0, "SG_SIG_TP", OBJPROP_COLOR, clrLime);
         ObjectSetInteger(0, "SG_SIG_TP", OBJPROP_STYLE, STYLE_DOT);
      }
      else
      {
         ObjectDelete(0, "SG_SIG_TP");
      }
   }
}

void UpdateSignalOverlay()
{
   if(!EnableSignalOverlay || !g_isConnected)
      return;

   string sym = ResolveBrokerSymbol(Symbol());
   StringTrimLeft(sym);
   StringTrimRight(sym);
   if(StringLen(sym) <= 0)
      return;

   string response = "";
   string path = StringFormat("/signal/get?symbol=%s&accountMode=%s", sym, AccountMode());
   if(!BridgeRequest("GET", path, "", response, true))
   {
      ClearSignalOverlayObjects();
      return;
   }

   if(StringFind(response, "\"success\":true") < 0 && StringFind(response, "\"success\" : true") < 0)
   {
      ClearSignalOverlayObjects();
      return;
   }

   bool shouldExecute = true;
   string direction = "";
   double entry = 0.0, sl = 0.0, tp = 0.0, lots = DefaultLots;
   if(!ParseSignalForExecution(response, direction, entry, sl, tp, lots, shouldExecute))
   {
      ClearSignalOverlayObjects();
      return;
   }
   if(OverlayRespectServerExecution && !shouldExecute)
   {
      ClearSignalOverlayObjects();
      return;
   }

   double strength = 0.0;
   double confidence = 0.0;
   ExtractSignalStrengthConfidence(response, strength, confidence);

   if(OverlayStrongOnly)
   {
      if(strength < OverlayMinStrength || confidence < OverlayMinConfidence)
      {
         ClearSignalOverlayObjects();
         return;
      }
   }

   string key = StringFormat("%s|%s|%0.5f|%0.5f|%0.5f|%0.0f|%0.0f", sym, direction, entry, sl, tp, strength, confidence);
   if(key == g_lastOverlayKey)
      return;
   g_lastOverlayKey = key;

   DrawSignalOverlay(sym, direction, entry, sl, tp, strength, confidence);
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

   // Report key EA settings so the backend/dashboard can verify the EA and server are aligned.
   payload += StringFormat(
      ",\"ea\":{\"platform\":\"mt5\",\"respectServerExecution\":%s,\"tradeMajorsAndMetalsOnly\":%s,\"maxFreeMarginUsagePct\":%.3f,\"maxSpreadPoints\":%d,\"enableVolatilityFilter\":%s,\"volatilityTf\":%d,\"minAtrPips\":%.2f,\"maxAtrPips\":%.2f,\"maxSpreadToAtrPct\":%.2f,\"enableAtrTrailing\":%s,\"atrTrailingTf\":%d,\"atrStartMultiplier\":%.2f,\"atrTrailMultiplier\":%.2f,\"enableDailyGuards\":%s,\"dailyProfitTargetCurrency\":%.2f,\"dailyProfitTargetPct\":%.2f,\"dailyMaxLossCurrency\":%.2f,\"dailyMaxLossPct\":%.2f,\"enforceMaxTradesPerDay\":%s,\"maxTradesPerDay\":%d}",
      RespectServerExecution ? "true" : "false",
      TradeMajorsAndMetalsOnly ? "true" : "false",
      MaxFreeMarginUsagePct,
      MaxSpreadPoints,
      EnableVolatilityFilter ? "true" : "false",
      (int)VolatilityFilterTf,
      MinAtrPips,
      MaxAtrPips,
      MaxSpreadToAtrPct,
      EnableAtrTrailing ? "true" : "false",
      (int)AtrTrailingTf,
      AtrStartMultiplier,
      AtrTrailMultiplier,
      EnableDailyGuards ? "true" : "false",
      DailyProfitTargetCurrency,
      DailyProfitTargetPct,
      DailyMaxLossCurrency,
      DailyMaxLossPct,
      EnforceMaxTradesPerDay ? "true" : "false",
      MaxTradesPerDay
   );
   if(includeForceFlag)
      payload += StringFormat(",\"forceReconnect\":%s", ForceReconnect ? "true" : "false");
   payload += "}";
   return payload;
}

bool SendSessionConnect()
{
   string response = "";
   if(BridgeRequest("POST", "/session/connect", BuildSessionPayload(true), response, true))
   {
      g_isConnected = true;
      g_sentConnectNews = false;
      g_marketWatchPrepared = false;
      g_marketFeedCursor = 0;
      Print("Bridge session registered: ", response);
      return true;
   }
   g_isConnected = false;
   g_nextReconnectAt = TimeCurrent() + MathMax(1, ReconnectBackoffSec);
   return false;
}

bool SendSessionDisconnect()
{
   string response = "";
   if(HttpRequest("POST", "/session/disconnect", BuildSessionPayload(false), response))
   {
      Print("Bridge session closed");
      g_isConnected = false;
      g_sentConnectNews = false;
      return true;
   }
   return false;
}

bool SendHeartbeat()
{
   string payload = StringFormat(
      "{\"timestamp\":%I64d,\"equity\":%.2f,\"balance\":%.2f,\"accountMode\":\"%s\",\"accountNumber\":\"%I64d\"}",
      TimeCurrent(),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountMode(),
      AccountInfoInteger(ACCOUNT_LOGIN)
   );
   string response = "";
   if(BridgeRequest("POST", "/agent/heartbeat", payload, response, true))
   {
      g_lastHeartbeat = TimeCurrent();
      return true;
   }
   return false;
}

int OnInit()
{
   // Don't fail init if the bridge is down; keep the EA alive and auto-reconnect.
   if(!SendSessionConnect())
      Print("Bridge not connected yet. EA will keep trying (check URL/token/WebRequest allowlist)." );

   if(!EnableAutoTrading)
      Print("AUTO-TRADING is OFF in EA inputs. Set EnableAutoTrading=true to allow order execution.");

   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   // Release cached indicator handles to avoid leaks.
   int n = ArraySize(g_indKey);
   for(int i = n - 1; i >= 0; i--)
   {
      ReleaseIndicatorCacheAt(i);
   }
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

   // One-time news item so you can confirm ingestion in the dashboard.
   PostConnectNewsOnce();

   if(TimeCurrent() - g_lastHeartbeat >= HeartbeatInterval)
   {
      if(!SendHeartbeat())
         Print("Heartbeat failed");
   }

   // Fulfill on-demand snapshot requests from the server.
   // This is required for /signal/get to stop returning "EA snapshot pending".
   if(g_lastSnapshotRequestPoll == 0 || (TimeCurrent() - g_lastSnapshotRequestPoll) >= 2)
   {
      PollAndFulfillSnapshotRequests();
      g_lastSnapshotRequestPoll = TimeCurrent();
   }

   // Poll active symbols from dashboard/server (lazy loading)
   if(EnableActiveSymbolsPolling && g_activeSymbolsEndpointSupported && (g_lastActiveSymbolsPoll == 0 || (TimeCurrent() - g_lastActiveSymbolsPoll) >= ActiveSymbolsPollIntervalSec))
   {
      if(PollActiveSymbols())
         g_lastActiveSymbolsPoll = TimeCurrent();
   }

   // Register the MarketWatch symbol universe so the server can background-scan it.
   if(EnableSymbolUniverseRegistration && (g_lastSymbolUniverseRegister == 0 || (TimeCurrent() - g_lastSymbolUniverseRegister) >= SymbolUniverseRegistrationIntervalSec))
   {
      if(PostSymbolUniverse())
         g_lastSymbolUniverseRegister = TimeCurrent();
   }

   // Push quotes for the ticker
   if(EnableMarketFeed && (g_lastMarketFeed == 0 || (TimeCurrent() - g_lastMarketFeed) >= MarketFeedIntervalSec))
   {
      if(PostMarketQuotes())
         g_lastMarketFeed = TimeCurrent();
   }

   // Periodic snapshot (helps the engine validate signals without waiting for an explicit request).
   if(EnableMarketSnapshot && (g_lastMarketSnapshot == 0 || (TimeCurrent() - g_lastMarketSnapshot) >= MarketSnapshotIntervalSec))
   {
      string snapSym = _Symbol;
      int activeN = ArraySize(g_activeSymbols);
      if(activeN > 0)
      {
         int idx = (int)(g_snapshotCursor % activeN);
         g_snapshotCursor++;
         snapSym = ResolveBrokerSymbol(g_activeSymbols[idx]);
      }
      else if(EnablePrioritySymbols && ArraySize(g_prioritySymbols) > 0)
      {
         snapSym = g_prioritySymbols[0];
      }

      if(StringLen(snapSym) <= 0)
         snapSym = _Symbol;

      if(PostMarketSnapshotForSymbol(snapSym, false))
         g_lastMarketSnapshot = TimeCurrent();
   }

   // Push bars/candle history (slower cadence)
   if(EnableMarketFeed && (g_lastMarketBars == 0 || (TimeCurrent() - g_lastMarketBars) >= MarketBarsIntervalSec))
   {
      if(PostMarketBars())
         g_lastMarketBars = TimeCurrent();
   }

   // Auto-trading polling
   if(EnableAutoTrading && (g_lastSignalCheck == 0 || (TimeCurrent() - g_lastSignalCheck) >= SignalCheckIntervalSec))
   {
      CheckAndExecuteSignals();
      g_lastSignalCheck = TimeCurrent();
   }

   // On-chart signal overlay (independent of auto-trading)
   if(EnableSignalOverlay && (g_lastSignalOverlay == 0 || (TimeCurrent() - g_lastSignalOverlay) >= SignalOverlayIntervalSec))
   {
      UpdateSignalOverlay();
      g_lastSignalOverlay = TimeCurrent();
   }

   // Position management
   ManagePositionsBreakeven();
   ManagePositionsTrailingStop();
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
      "{\"type\":\"%s\",\"order\":%I64d,\"deal\":%I64d,\"symbol\":\"%s\",\"volume\":%.2f,\"price\":%.5f,\"profit\":%.2f,\"timestamp\":%I64d,\"accountMode\":\"%s\",\"accountNumber\":\"%I64d\"}",
      TransactionTypeToString((ENUM_TRADE_TRANSACTION_TYPE)trans.type),
      trans.order,
      trans.deal,
      trans.symbol,
      eventVolume,
      eventPrice,
      eventProfit,
      eventTimestamp,
      AccountMode(),
      AccountInfoInteger(ACCOUNT_LOGIN)
   );

   string response = "";
   if(!BridgeRequest("POST", "/agent/transaction", payload, response, true))
      Print("Failed to forward trade transaction");
}
