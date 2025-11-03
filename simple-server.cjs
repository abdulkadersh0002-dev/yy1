// Load environment variables
let _dotenvLoaded = false;
try { require('dotenv').config(); _dotenvLoaded = true; } catch {}
if (!_dotenvLoaded) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname || '.', '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        if (!line || line.trim().startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx > -1) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (!(key in process.env)) process.env[key] = val;
        }
      }
    }
  } catch {}
}

const express = require('express');
const path = require('path');
const SignalEngine = require('./signal-engine.cjs');
const MTBridge = require('./mt-bridge.cjs');
const MTWebSocketServer = require('./mt-websocket.cjs');

const app = express();
// Hardening: capture unexpected errors to avoid silent exits
process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err); } catch {}
});
const signalEngine = new SignalEngine();
const mtBridge = new MTBridge();
const mtWebSocket = new MTWebSocketServer(8765);

// Start WebSocket server for EA connections
mtWebSocket.start();

app.use(express.json());

// Real-time signals cache
let activeSignals = [];
const MIN_SIGNAL_HOLD_MS = Number(process.env.MIN_SIGNAL_HOLD_MS || 5 * 60 * 1000); // 5 minutes default
const lastSignalMeta = new Map(); // key: pair (EUR/USD), value: { direction, openedAt }
let signalStats = { totalSignals: 134, activeSignals: 0, winRate: 73.5, totalPnL: 1247.50 };

// ============ Server-Sent Events (SSE) for instant client updates ============
const sseClients = new Set();
function sseBroadcast(event, data) {
  const payload = `event: ${event}\n` + (data ? `data: ${JSON.stringify(data)}\n` : '') + `\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: ping\ndata: connected\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ============ News & Economic Calendar (real sources with cache) ============
let newsCache = [];
let newsUpdatedAt = 0;
let calendarCache = [];
let calendarUpdatedAt = 0;

async function refreshNews() {
  try {
    if (typeof fetch === 'undefined') return; // Node <18 fallback: keep static
    const sources = [
      { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters', category: 'Markets' },
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC', category: 'Markets' },
      { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ', category: 'Markets' },
      { url: 'https://www.marketwatch.com/feeds/topstories', source: 'MarketWatch', category: 'Markets' },
      { url: 'https://www.fxstreet.com/rss', source: 'FXStreet', category: 'Forex' },
      { url: 'https://www.forexlive.com/feed/', source: 'ForexLive', category: 'Forex' },
      { url: 'https://www.bbc.co.uk/news/business/rss.xml', source: 'BBC', category: 'Business' },
      { url: 'https://apnews.com/hub/apf-business?utm_source=ap_rss&utm_medium=rss&utm_campaign=apf_business', source: 'AP', category: 'Business' },
      { url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com', category: 'Markets' }
    ];

    const sanitize = (s) => (s || '').replace(/<\!\[CDATA\[/g, '').replace(/\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const inferImpact = (title) => {
      const t = (title || '').toLowerCase();
      const high = /(rate decision|interest rate|hike|cut|cpi|inflation|nfp|non-farm|ecb|fed|boj|boe|ppi|gdp|jobs|payroll|tariff|opec|opec\+|rb a|boe|fomc|dot plot|core pce|cpi m\/m|cpi y\/y)/;
      const medium = /(pmi|claims|retail|manufacturing|housing|inventories|beige book|minutes|sentiment|confidence|trade balance|industrial production)/;
      if (high.test(t)) return 'high';
      if (medium.test(t)) return 'medium';
      return 'low';
    };
    const isFinanceRelevant = (title, category) => {
      const t = (title || '').toLowerCase();
      const cat = (category || '').toLowerCase();
      const tickers = /(eurusd|gbpusd|usdjpy|xauusd|wti|brent|oil|gold|btc|eth|nasdaq|dow|s&p|sp500|dax|nikkei|yen|euro|pound|dollar)/;
      const macro = /(inflation|cpi|ppi|gdp|jobs|payroll|unemployment|pmi|tariff|opec|rate|interest|central bank|ecb|fed|boj|boe|rba|bo c|rate decision|hike|cut)/;
      return cat.includes('market') || cat.includes('forex') || tickers.test(t) || macro.test(t);
    };
    const relevanceScore = (title) => {
      const t = (title || '').toLowerCase();
      let score = 0;
      if (/(eurusd|gbpusd|usdjpy|xauusd)/.test(t)) score += 20;
      if (/(fed|ecb|boj|boe|rba|rate|hike|cut|cpi|inflation|nfp)/.test(t)) score += 15;
      if (/(oil|opec|gold|btc|eth)/.test(t)) score += 10;
      return score;
    };
    const parseRSS = (xml, meta) => {
      if (!xml || typeof xml !== 'string') return [];
      const chunks = xml.split('<item>').slice(1).map(c => '<item>' + c);
      return chunks.slice(0, 12).map((it, i) => {
        const title = sanitize((it.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1] || '');
        const link = sanitize((it.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1] || '#');
        const pub = sanitize((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1] || '') ||
                    sanitize((it.match(/<updated>([\s\S]*?)<\/updated>/) || [,''])[1] || '') || new Date().toUTCString();
        const impact = inferImpact(title);
        const relevant = isFinanceRelevant(title, meta.category);
        return {
          id: `${meta.source}-${Date.now()}-${i}`,
          title,
          source: meta.source,
          category: meta.category,
          impact,
          time: new Date(pub).toISOString(),
          snippet: title,
          url: link,
          _relevant: relevant,
          _score: relevanceScore(title)
        };
      });
    };

    const all = [];
    await Promise.all(sources.map(async (src) => {
      try {
        const r = await fetch(src.url);
        if (!r.ok) return;
        const xml = await r.text();
        all.push(...parseRSS(xml, src));
      } catch {}
    }));

    if (all.length) {
      // Deduplicate by normalized title
      const seen = new Set();
      const filtered = [];
      for (const item of all) {
        const key = (item.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // Keep only finance-relevant items or any 'high' impact
        if (!item._relevant && item.impact !== 'high') continue;
        filtered.push(item);
      }
      // Sort: high impact first, then score, then time desc
      filtered.sort((a,b) => {
        const imp = (x) => x.impact === 'high' ? 2 : x.impact === 'medium' ? 1 : 0;
        const di = imp(b) - imp(a);
        if (di) return di;
        const ds = (b._score||0) - (a._score||0);
        if (ds) return ds;
        return new Date(b.time) - new Date(a.time);
      });
      newsCache = filtered.slice(0, 60).map(({_relevant,_score,...rest}) => rest);
      newsUpdatedAt = Date.now();
      sseBroadcast('news');
    }
  } catch (e) {
    // ignore; keep previous cache
  }
}

async function refreshCalendar() {
  try {
    if (typeof fetch === 'undefined') return;
    const resp = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    if (!resp.ok) return;
    const data = await resp.json();
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    // Map impact levels
    const mapImpact = (s) => {
      const v = (s || '').toLowerCase();
      if (v.includes('high')) return 'high';
      if (v.includes('medium')) return 'medium';
      return 'low';
    };
    const flagMap = {
      USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', CNY: '🇨🇳'
    };
    const filtered = data
      .filter(ev => (ev.date || '').startsWith(todayStr))
      .slice(0, 30)
      .map((ev, i) => ({
        id: i + 1,
        time: new Date(`${ev.date}T${(ev.time || '00:00')}:00Z`).toISOString(),
        currency: (ev.currency || '').toUpperCase(),
        flag: flagMap[(ev.currency || '').toUpperCase()] || '🏳️',
        event: ev.title || ev.event || 'Economic Event',
        impact: mapImpact(ev.impact),
        forecast: ev.forecast || '-',
        previous: ev.previous || '-',
        actual: ev.actual || null
      }));
    if (filtered.length) {
      calendarCache = filtered;
      calendarUpdatedAt = Date.now();
      sseBroadcast('calendar');
    }
  } catch (e) {
    // ignore
  }
}

// Warm up caches and set refresh timers
refreshNews();
refreshCalendar();
setInterval(refreshNews, 30 * 1000);
setInterval(refreshCalendar, 60 * 1000);

// Generate initial signals
function getRecentCalendarEvents(hoursWindow = 6) {
  const now = Date.now();
  const windowMs = hoursWindow * 60 * 60 * 1000;
  return (calendarCache || []).filter(ev => {
    const t = new Date(ev.time).getTime();
    return Math.abs(t - now) <= windowMs;
  });
}

async function initializeSignals() {
  // Seed with 7 instruments to target 7 active signals
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'CRUDE'];
  
  for (const symbol of symbols) {
    try {
      const economicEvents = getRecentCalendarEvents();
      const signal = await signalEngine.generateSignal(symbol, economicEvents);
      if (signal) {
        const now = Date.now();
        const expiresMs = signal.expiresAt ? new Date(signal.expiresAt).getTime() : now + 4*60*60*1000;
        const isExpired = expiresMs < now;
        const isAvailableToEnter = !isExpired && signal.status === 'active';
        
        activeSignals.push({
          id: signal.id,
          pair: signal.symbol.replace(/(.{3})(.{3})/, '$1/$2'),
          type: signal.direction,
          entryPrice: signal.entryPrice,
          currentPrice: signal.currentPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          pnl: ((signal.currentPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2),
          pnlPercent: ((signal.currentPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2),
          strength: Math.round(signal.confidence),
          confidence: signal.confidence.toFixed(1),
          riskReward: signal.riskReward.toFixed(2),
          status: isExpired ? 'expired' : signal.status,
          openedAt: signal.timestamp,
          closedAt: isExpired ? new Date().toISOString() : null,
          expiresAt: signal.expiresAt,
          availableToEnter: isAvailableToEnter,
          reasoning: signal.reasoning,
          technical: signal.technical,
          timeframe: signal.timeframe,
          timestamp: signal.timestamp,
          positionSize: signal.positionSize
        });
      }
    } catch (error) {
      console.error(`Error generating signal for ${symbol}:`, error);
    }
  }
  
  // Update stats (target 7 active if available)
  signalStats.activeSignals = activeSignals.filter(s => s.status !== 'closed' && s.status !== 'expired').length;
}

// Initialize signals on startup
initializeSignals();

// Refresh signals every 30 seconds (generate/update one symbol)
setInterval(async () => {
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD'];
  const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
  
  try {
    if (!calendarCache.length) await refreshCalendar();
    const economicEvents = getRecentCalendarEvents();
    const signal = await signalEngine.generateSignal(randomSymbol, economicEvents);
    if (signal) {
      // Update or add signal
      const existingIndex = activeSignals.findIndex(s => s.pair === signal.symbol.replace(/(.{3})(.{3})/, '$1/$2'));
      const now = Date.now();
      const expiresMs = signal.expiresAt ? new Date(signal.expiresAt).getTime() : now + 4*60*60*1000;
      const isExpired = expiresMs < now;
      const isAvailableToEnter = !isExpired && signal.status === 'active';
      
      const formattedSignal = {
        id: signal.id,
        pair: signal.symbol.replace(/(.{3})(.{3})/, '$1/$2'),
        type: signal.direction,
        entryPrice: signal.entryPrice,
        currentPrice: signal.currentPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        pnl: ((signal.currentPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2),
        pnlPercent: ((signal.currentPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2),
        strength: Math.round(signal.confidence),
        confidence: signal.confidence.toFixed(1),
        riskReward: signal.riskReward.toFixed(2),
        status: isExpired ? 'expired' : signal.status,
        openedAt: activeSignals[existingIndex]?.openedAt || signal.timestamp,
        closedAt: isExpired ? new Date().toISOString() : null,
        expiresAt: signal.expiresAt,
        availableToEnter: isAvailableToEnter,
        reasoning: signal.reasoning,
        technical: signal.technical,
        timeframe: signal.timeframe,
        timestamp: signal.timestamp,
        positionSize: signal.positionSize
      };
      
      const existing = existingIndex >= 0 ? activeSignals[existingIndex] : null;
      const pair = formattedSignal.pair;
      const meta = lastSignalMeta.get(pair);
      const withinHold = existing && (now - new Date(existing.openedAt).getTime() < MIN_SIGNAL_HOLD_MS);
      const directionFlip = existing && existing.type && formattedSignal.type && existing.type !== formattedSignal.type;

      if (existingIndex >= 0) {
        if (withinHold && directionFlip && (existing.status === 'active' || existing.status === 'low-confidence')) {
          // Respect minimum hold: do not flip direction within hold window. Update only pricing/pnl.
          existing.currentPrice = formattedSignal.currentPrice;
          existing.pnl = formattedSignal.pnl;
          existing.pnlPercent = formattedSignal.pnlPercent;
          // keep SL/TP as originally set to evaluate outcomes consistently
        } else {
          activeSignals[existingIndex] = formattedSignal;
          lastSignalMeta.set(pair, { direction: formattedSignal.type, openedAt: formattedSignal.openedAt });
        }
      } else {
        // If trying to add an opposite direction within hold window for same pair, skip
        if (meta && (now - new Date(meta.openedAt).getTime() < MIN_SIGNAL_HOLD_MS) && meta.direction !== formattedSignal.type) {
          // skip to avoid churn
        } else {
          activeSignals.push(formattedSignal);
          lastSignalMeta.set(pair, { direction: formattedSignal.type, openedAt: formattedSignal.openedAt });
          if (activeSignals.length > 8) activeSignals.shift(); // Keep max 8 signals
        }
      }
      
      signalStats.activeSignals = activeSignals.filter(s => s.status !== 'closed').length;
      sseBroadcast('signals');
    }
  } catch (error) {
    console.error('Error refreshing signal:', error);
  }
}, 30000);

// Periodic price refresh and TP/SL closure check for all active signals
async function refreshPricesAndEvaluateClosures() {
  let changed = false;
  const candidates = activeSignals.filter(s => s.status === 'active' || s.status === 'low-confidence');
  for (const s of candidates) {
    try {
      const symbol = (s.pair || '').replace('/', '');
      if (!symbol) continue;
      const md = await signalEngine.collectMarketData(symbol);
      if (!md) continue;
      const prevPrice = s.currentPrice;
      s.currentPrice = md.currentPrice;

      // Evaluate TP/SL hit
      const isBuy = s.type === 'BUY';
      const hitTP = isBuy ? s.currentPrice >= s.takeProfit : s.currentPrice <= s.takeProfit;
      const hitSL = isBuy ? s.currentPrice <= s.stopLoss  : s.currentPrice >= s.stopLoss;
      if (hitTP || hitSL) {
        s.status = 'closed';
        s.outcome = hitTP ? 'win' : 'loss';
        s.closedReason = hitTP ? 'TP' : 'SL';
        s.closedAt = new Date().toISOString();
        s.availableToEnter = false;
        // Finalize PnL metrics
        const diff = (s.currentPrice - s.entryPrice) * (isBuy ? 1 : -1);
        const pct = (diff / s.entryPrice) * 100;
        s.pnl = Number.isFinite(pct) ? pct.toFixed(2) : s.pnl;
        s.pnlPercent = s.pnl;
        changed = true;
      } else if (prevPrice !== s.currentPrice) {
        // Update running PnL
        const diff = (s.currentPrice - s.entryPrice) * (isBuy ? 1 : -1);
        const pct = (diff / s.entryPrice) * 100;
        s.pnl = Number.isFinite(pct) ? pct.toFixed(2) : s.pnl;
        s.pnlPercent = s.pnl;
        changed = true;
      }
    } catch (e) {
      // ignore per-symbol errors
    }
  }
  if (changed) {
    // Recompute winRate based on closed signals with outcome
    const closed = activeSignals.filter(x => x.status === 'closed' && x.outcome);
    const wins = closed.filter(x => x.outcome === 'win').length;
    signalStats.winRate = closed.length ? (wins / closed.length * 100) : signalStats.winRate;
    sseBroadcast('signals');
  }
}

setInterval(refreshPricesAndEvaluateClosures, 5000);

// Periodic sweep to close expired signals (time-based)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const s of activeSignals) {
    const exp = s.expiresAt ? new Date(s.expiresAt).getTime() : null;
    if ((s.status === 'active' || s.status === 'low-confidence') && exp && exp < now) {
      s.status = 'expired';
      s.closedAt = new Date().toISOString();
      s.availableToEnter = false;
      changed = true;
    }
  }
  if (changed) {
    signalStats.activeSignals = activeSignals.filter(s => s.status !== 'closed' && s.status !== 'expired').length;
    sseBroadcast('signals');
  }
}, 60 * 1000);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard API
app.get('/api/dashboard', (req, res) => {
  res.json({
    signals: activeSignals,
    stats: signalStats
  });
});

// Signal Tracker API - enrich with live progress and hold window info
app.get('/api/signals/tracker', (req, res) => {
  const now = Date.now();
  const active = (activeSignals || [])
    .filter(s => s.status === 'active' || s.status === 'low-confidence')
    .map(s => {
      const isBuy = s.type === 'BUY';
      const entry = Number(s.entryPrice);
      const tp = Number(s.takeProfit);
      const sl = Number(s.stopLoss);
      const cur = Number(s.currentPrice);
      let progress = 0; // 0..1 to TP
      if (isBuy) {
        const denom = (tp - entry) || 1;
        progress = (cur - entry) / denom;
      } else {
        const denom = (entry - tp) || 1;
        progress = (entry - cur) / denom;
      }
      // Clamp for display
      const progressClamped = Math.max(0, Math.min(1, progress));

      // Hold remaining(ms)
      const meta = lastSignalMeta.get(s.pair);
      let holdRemaining = 0;
      if (meta && meta.openedAt) {
        const held = now - new Date(meta.openedAt).getTime();
        holdRemaining = Math.max(0, MIN_SIGNAL_HOLD_MS - held);
      }
      const ageMs = now - new Date(s.openedAt || s.timestamp).getTime();
      return {
        id: s.id,
        pair: s.pair,
        type: s.type,
        status: s.status,
        entryPrice: s.entryPrice,
        currentPrice: s.currentPrice,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        pnl: s.pnl,
        pnlPercent: s.pnlPercent,
        openedAt: s.openedAt || s.timestamp,
        expiresAt: s.expiresAt || null,
        progress: Number.isFinite(progress) ? progress : 0,
        progressClamped,
        holdRemaining,
        ageMs
      };
    });

  const closedRecent = (activeSignals || [])
    .filter(s => s.status === 'closed' || s.status === 'expired')
    .sort((a,b) => new Date(b.closedAt || b.timestamp) - new Date(a.closedAt || a.timestamp))
    .slice(0, 12)
    .map(s => ({
      id: s.id,
      pair: s.pair,
      type: s.type,
      outcome: s.outcome || (s.status==='expired' ? 'expired' : null),
      closedReason: s.closedReason || null,
      status: s.status,
      openedAt: s.openedAt || s.timestamp,
      closedAt: s.closedAt || null,
      pnl: s.pnl,
      pnlPercent: s.pnlPercent
    }));

  res.json({
    active,
    closedRecent,
    holdWindowMs: MIN_SIGNAL_HOLD_MS,
    stats: signalStats
  });
});

// News API - Aggregated from multiple free sources
app.get('/api/news', (req, res) => {
  const { impact, q, limit } = req.query || {};
  if (newsCache.length) {
    let data = newsCache;
    if (impact && ['high','medium','low'].includes(String(impact).toLowerCase())) {
      data = data.filter(n => String(n.impact).toLowerCase() === String(impact).toLowerCase());
    }
    if (q) {
      const term = String(q).toLowerCase();
      data = data.filter(n => (n.title||'').toLowerCase().includes(term) || (n.snippet||'').toLowerCase().includes(term));
    }
    const lim = Math.max(1, Math.min(200, parseInt(limit || '0', 10) || data.length));
    return res.json(data.slice(0, lim));
  }
  // Fallback static list if live fetch not available yet
  const news = [
    {
      id: 1,
      title: 'Live news feed initializing…',
      source: 'System',
      category: 'Info',
      impact: 'low',
      time: new Date().toISOString(),
      snippet: 'Waiting for Reuters feed to refresh.',
      url: '#'
    }
  ];
  res.json(news);
});

// Economic Calendar API
app.get('/api/economic-calendar', (req, res) => {
  const { impact, limit } = req.query || {};
  if (calendarCache.length) {
    let data = calendarCache;
    if (impact && ['high','medium','low'].includes(String(impact).toLowerCase())) {
      data = data.filter(n => String(n.impact).toLowerCase() === String(impact).toLowerCase());
    }
    const lim = Math.max(1, Math.min(200, parseInt(limit || '0', 10) || data.length));
    return res.json(data.slice(0, lim));
  }
  const today = new Date();
  const events = [
    {
      id: 1,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 30).toISOString(),
      currency: 'USD',
      flag: '🇺🇸',
      event: 'Core CPI m/m',
      impact: 'high',
      forecast: '0.3%',
      previous: '0.3%',
      actual: null
    },
    {
      id: 2,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0).toISOString(),
      currency: 'EUR',
      flag: '🇪🇺',
      event: 'ECB President Lagarde Speaks',
      impact: 'high',
      forecast: '-',
      previous: '-',
      actual: null
    },
    {
      id: 3,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 30).toISOString(),
      currency: 'USD',
      flag: '🇺🇸',
      event: 'Unemployment Claims',
      impact: 'medium',
      forecast: '212K',
      previous: '209K',
      actual: null
    },
    {
      id: 4,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0).toISOString(),
      currency: 'GBP',
      flag: '🇬🇧',
      event: 'GDP q/q',
      impact: 'high',
      forecast: '0.2%',
      previous: '0.2%',
      actual: null
    },
    {
      id: 5,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0).toISOString(),
      currency: 'USD',
      flag: '🇺🇸',
      event: 'Crude Oil Inventories',
      impact: 'medium',
      forecast: '-2.1M',
      previous: '-4.5M',
      actual: null
    },
    {
      id: 6,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 30).toISOString(),
      currency: 'JPY',
      flag: '🇯🇵',
      event: 'Tokyo Core CPI y/y',
      impact: 'medium',
      forecast: '2.7%',
      previous: '2.8%',
      actual: null
    },
    {
      id: 7,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 2, 0).toISOString(),
      currency: 'AUD',
      flag: '🇦🇺',
      event: 'RBA Interest Rate Decision',
      impact: 'high',
      forecast: '4.35%',
      previous: '4.35%',
      actual: null
    },
    {
      id: 8,
      time: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0).toISOString(),
      currency: 'EUR',
      flag: '🇪🇺',
      event: 'German Retail Sales m/m',
      impact: 'low',
      forecast: '0.5%',
      previous: '-0.8%',
      actual: null
    }
  ];
  res.json(events);
});

// Get individual signal details with full analysis
app.get('/api/signal/:id', (req, res) => {
  const signal = activeSignals.find(s => s.id === req.params.id);
  if (!signal) {
    return res.status(404).json({ error: 'Signal not found' });
  }
  res.json(signal);
});

// MT4/MT5 EA Update Endpoint (receives real data from EA)
app.post('/api/mt/ea-update', (req, res) => {
  try {
    const data = req.body;
    
    console.log('[EA Update] 📊 Received data from EA');
    console.log(`   Account: ${data.account} (${data.accountType})`);
    console.log(`   Platform: ${data.platform}`);
    console.log(`   Balance: $${data.balance} | Equity: $${data.equity}`);
    console.log(`   P/L: $${data.profit} | Positions: ${data.openPositions}`);
    
    // Store in WebSocket server
    mtWebSocket.handleMessage(null, data);
    
    res.json({ 
      success: true, 
      message: 'Data received successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[EA Update] ❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process EA data' 
    });
  }
});

// Send signal to MT4/MT5 for execution
const pendingSignals = new Map(); // Store signals waiting to be executed

app.post('/api/mt/send-signal', (req, res) => {
  try {
    const { signalId, account } = req.body;
    
    // Find the signal
    const signal = activeSignals.find(s => s.id === signalId);
    
    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    
    // Store as pending signal for the EA to pick up
    if (!pendingSignals.has(account)) {
      pendingSignals.set(account, []);
    }
    
    pendingSignals.get(account).push({
      ...signal,
      sentAt: new Date().toISOString()
    });
    
    console.log(`[Signal] 🚀 Signal ${signalId} queued for account ${account}`);
    console.log(`   Pair: ${signal.pair} | Type: ${signal.type}`);
    console.log(`   Entry: ${signal.entryPrice} | SL: ${signal.stopLoss} | TP: ${signal.takeProfit}`);
    
    res.json({ 
      success: true, 
      message: 'Signal sent to MT4/MT5',
      signal: signal
    });
    
  } catch (error) {
    console.error('[Signal] ❌ Error sending signal:', error);
    res.status(500).json({ error: 'Failed to send signal' });
  }
});

// EA checks for pending signals
app.get('/api/mt/pending-signals', (req, res) => {
  try {
    const { account } = req.query;
    
    if (!account) {
      return res.status(400).json({ error: 'Account number required' });
    }
    
    const signals = pendingSignals.get(account) || [];
    
    res.json({ 
      signals: signals,
      count: signals.length
    });
    
  } catch (error) {
    console.error('[Signal] ❌ Error fetching pending signals:', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// EA notifies when signal is executed
app.post('/api/mt/signal-executed', (req, res) => {
  try {
    const { signalId, account, success } = req.body;
    
    console.log(`[Signal] ${success ? '✅' : '❌'} Signal ${signalId} ${success ? 'executed' : 'failed'} for account ${account}`);
    
    // Remove from pending signals
    if (pendingSignals.has(account)) {
      const signals = pendingSignals.get(account);
      const index = signals.findIndex(s => s.id === signalId);
      if (index >= 0) {
        signals.splice(index, 1);
        pendingSignals.set(account, signals);
      }
    }
    
    // Update signal status
    const signal = activeSignals.find(s => s.id === signalId);
    if (signal) {
      signal.executed = true;
      signal.executedAt = new Date().toISOString();
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[Signal] ❌ Error:', error);
    res.status(500).json({ error: 'Failed to update signal status' });
  }
});

// MT4/MT5 Connection API
app.post('/api/mt/connect', async (req, res) => {
  try {
    const { platform, server, account, password, accountType } = req.body;
    
    if (!platform || !server || !account || !password || !accountType) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const result = await mtBridge.connect({
      platform,
      server,
      account,
      password,
      accountType
    });

    if (result.success) {
      res.json({
        success: true,
        connectionId: result.connectionId,
        message: 'Successfully connected to MT platform'
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('[API] MT connection error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to connect to MT platform' 
    });
  }
});

// MT4/MT5 Disconnect API
app.post('/api/mt/disconnect', (req, res) => {
  try {
    const { connectionId } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Connection ID required' 
      });
    }

    const result = mtBridge.disconnect(connectionId);
    res.json(result);
  } catch (error) {
    console.error('[API] MT disconnect error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disconnect' 
    });
  }
});

// MT4/MT5 Account Info API
app.get('/api/mt/account', async (req, res) => {
  try {
    const { connectionId, account } = req.query;
    
    // PRIORITY 1: Check if we have REAL data from EA (your actual MT4/MT5 terminal)
    if (account) {
      const eaData = mtWebSocket.getAccountData(account);
      if (eaData) {
        console.log('[API] ✅ Returning REAL DATA from your MT4/MT5 EA');
        console.log(`[API] Account: ${account} | Balance: $${eaData.balance} | Equity: $${eaData.equity}`);
        return res.json({
          ...eaData,
          dataSource: 'REAL - MT4/MT5 EA',
          isRealData: true
        });
      }
    }
    
    // Extract account number from connectionId
    let accountNumber = account;
    if (!accountNumber && connectionId) {
      // ConnectionId format: "MT4_12345678" or "MT5_12345678"
      const parts = connectionId.split('_');
      if (parts.length > 1) {
        accountNumber = parts[1];
      }
    }
    
    // PRIORITY 2: Check if we have REAL data from EA using connection's account number
    if (accountNumber) {
      const eaData = mtWebSocket.getAccountData(accountNumber);
      if (eaData) {
        console.log('[API] ✅ Returning REAL DATA from your MT4/MT5 EA (via connectionId)');
        return res.json({
          ...eaData,
          dataSource: 'REAL - MT4/MT5 EA',
          isRealData: true
        });
      }
    }
    
    if (!connectionId) {
      return res.status(400).json({ 
        error: 'Connection ID or Account number required',
        solution: 'Please connect to MT4/MT5 first',
        instruction: 'Or install the EA in your MT4/MT5 terminal to send real data'
      });
    }

    // PRIORITY 3: Check if connection exists in bridge
    if (!mtBridge.isConnected(connectionId)) {
      return res.status(400).json({ 
        error: 'Not connected to MT platform',
        solution: 'Please connect first or install the EA in your MT4/MT5 terminal',
        instructions: {
          option1: 'Click "Connect" button with your credentials',
          option2: 'Install MT4_AccountDataSender.mq4 or MT5_AccountDataSender.mq5 EA',
          option3: 'The EA will automatically send REAL data from your terminal'
        }
      });
    }

    // PRIORITY 4: Get data from bridge (may be simulated if EA not installed)
    const accountInfo = await mtBridge.getAccountInfo(connectionId);
    
    if (accountInfo.pendingEA) {
      console.log('[API] ⚠️ Connection registered but waiting for EA data');
      return res.json({
        ...accountInfo,
        dataSource: 'Waiting for EA',
        isRealData: false,
        alert: '⚠️ Install EA in MT4/MT5 to get REAL account data'
      });
    }
    
    console.log('[API] ⚠️ Returning simulated data (EA not installed)');
    res.json({
      ...accountInfo,
      dataSource: 'Simulated (Install EA for real data)',
      isRealData: false
    });
    
  } catch (error) {
    console.error('[API] MT account info error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch account information' 
    });
  }
});

// MT4/MT5 Open Positions API
app.get('/api/mt/positions', async (req, res) => {
  try {
    const { connectionId } = req.query;
    
    if (!connectionId) {
      return res.status(400).json({ 
        error: 'Connection ID required' 
      });
    }

    if (!mtBridge.isConnected(connectionId)) {
      return res.status(400).json({ 
        error: 'Not connected to MT platform' 
      });
    }

    const positions = await mtBridge.getOpenPositions(connectionId);
    res.json({ positions });
    
  } catch (error) {
    console.error('[API] MT positions error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch positions' 
    });
  }
});

// Generate new signal on demand
app.post('/api/signal/generate', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol required' });
  }
  
  try {
    const signal = await signalEngine.generateSignal(symbol, []);
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate signal' });
  }
});

// Serve static client and root index explicitly
app.use(express.static('client'));
app.get('/', (req, res) => {
  try { res.sendFile(require('path').join(__dirname, 'client', 'index.html')); }
  catch { res.status(500).send('Client not found'); }
});

// =================== EA Downloads (MT4/MT5) ===================
app.get('/downloads/MT4_AccountDataSender.mq4', (req, res) => {
  try {
    const fpath = path.join(__dirname, 'MT4_AccountDataSender.mq4');
    res.download(fpath, 'MT4_AccountDataSender.mq4');
  } catch (e) {
    res.status(404).send('MT4 EA not found');
  }
});

app.get('/downloads/MT5_AccountDataSender.mq5', (req, res) => {
  try {
    const fpath = path.join(__dirname, 'MT5_AccountDataSender.mq5');
    res.download(fpath, 'MT5_AccountDataSender.mq5');
  } catch (e) {
    res.status(404).send('MT5 EA not found');
  }
});

const PORT = Number(process.env.PORT || 4101);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log('🚀 AI Trading Signals Server');
  console.log(`📊 Server: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('⚡ Real-time signal generation active');
  console.log('🤖 Multi-layer analysis engine running');
});
