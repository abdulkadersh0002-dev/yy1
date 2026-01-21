/**
 * EA Bridge Service - Enhanced MT4/MT5 Expert Advisor Communication
 * Handles intelligent trade execution, dynamic stop-loss management, and learning from trades
 */

import logger from '../logging/logger.js';
import {
  analyzeCandleSeries,
  aggregateCandleAnalyses
} from '../../analyzers/candle-analysis-lite.js';
import { attachLayeredAnalysisToSignal, evaluateLayers18Readiness } from '../ea-signal-pipeline.js';

class EaBridgeService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.tradingEngine = options.tradingEngine;
    this.brokerRouter = options.brokerRouter;

    // Active EA sessions
    this.sessions = new Map();

    // Trade performance history for learning
    this.tradeHistory = [];
    this.maxHistorySize = 1000;

    // Learning parameters
    this.riskAdjustmentFactor = 1.0;
    this.stopLossAdjustmentFactor = 1.0;
    this.winRate = 0.5;
    this.avgProfit = 0;
    this.avgLoss = 0;

    // Dynamic risk management
    this.consecutiveLosses = 0;
    this.consecutiveWins = 0;
    this.maxConsecutiveLosses = 3;

    // Market data + news coming from connected EAs
    this.latestQuotes = new Map(); // key: `${broker}:${symbol}` -> quote
    // Small per-symbol quote history for velocity/acceleration proxies (Layer 1 enrichments).
    // key: `${broker}:${symbol}` -> [{ receivedAt, mid, bid, ask, spreadPoints }]
    this.quoteHistory = new Map();
    this.maxQuotes = 10000;
    this.latestNews = new Map(); // key: `${broker}:${id}` -> item
    this.newsTimeline = new Map(); // broker -> [ids newest-first]
    this.maxNewsPerBroker = 200;

    // Latest technical snapshots coming from connected EAs
    // key: `${broker}:${symbol}` -> snapshot
    this.latestSnapshots = new Map();
    this.maxSnapshots = 10000;

    // Rolling bar windows (optional) coming from connected EAs
    // key: `${broker}:${symbol}:${timeframe}` -> [{ time, open, high, low, close, volume, receivedAt, source }]
    this.latestBars = new Map();
    this.maxBarSeries = 20000;
    this.maxBarsPerSeries = 500;

    // Synthetic candles derived from EA quotes (free realtime fallback).
    // Only maintained for symbols the dashboard marks as active/requested.
    // key: `${broker}:${symbol}:${timeframe}` -> [{ time, open, high, low, close, volume, receivedAt, source }]
    this.syntheticCandles = new Map();
    this.maxSyntheticSeries = 20000;
    this.maxSyntheticCandlesPerSeries = 500;
    this.syntheticTimeframes = ['M1', 'M15', 'H1', 'H4', 'D1'];

    // Cached candle analysis (computed from EA bars preferred, quote-derived fallback).
    // key: `${broker}:${symbol}:${timeframe}:${limit}:${maxAgeMs}` -> { computedAt, lastBarTimeMs, result }
    this.candleAnalysisCache = new Map();
    this.candleAnalysisCacheTtlMs = Number.isFinite(Number(process.env.EA_CANDLE_ANALYSIS_TTL_MS))
      ? Math.max(250, Number(process.env.EA_CANDLE_ANALYSIS_TTL_MS))
      : 1500;

    // Snapshot requests issued by the dashboard (EA can poll and fulfill on-demand)
    // key: broker -> Map(symbol -> expiresAt)
    this.snapshotRequests = new Map();

    // Anti-spam / load-smoothing for on-demand snapshots.
    // key: `${broker}:${symbol}` -> untilMs
    this.snapshotInflight = new Map();
    // If a snapshot arrived recently, don't ask the terminal to recompute.
    this.snapshotFreshMaxAgeMs = 45 * 1000;
    // When the EA consumes a request, treat it as "in-flight" for a short period.
    this.snapshotInflightTtlMs = 25 * 1000;

    // Active symbol hints from the dashboard (used for EA-side lazy loading).
    // broker -> Map(symbol -> expiresAt)
    this.activeSymbols = new Map();
    this.activeSymbolsDefaultTtlMs = 15 * 60 * 1000;

    // Optional: EA can register its full symbol universe (MarketWatch) so the server can
    // scan/broadcast across more than the currently-streamed quotes.
    // broker -> Map(symbol -> receivedAt)
    this.registeredSymbols = new Map();
    this.maxRegisteredSymbolsPerBroker = Number.isFinite(
      Number(process.env.EA_MAX_REGISTERED_SYMBOLS)
    )
      ? Math.max(10, Math.trunc(Number(process.env.EA_MAX_REGISTERED_SYMBOLS)))
      : 5000;

    // Restrict bridge to FX + metals + crypto only by default.
    // Set ALLOW_ALL_SYMBOLS=true to disable filtering.
    this.restrictSymbols = String(process.env.ALLOW_ALL_SYMBOLS || '').toLowerCase() !== 'true';

    const parseBool = (value) => {
      const raw = String(value ?? '')
        .trim()
        .toLowerCase();
      if (!raw) {
        return null;
      }
      if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
        return true;
      }
      if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
        return false;
      }
      return null;
    };

    // Full-scan mode: analyze every EA-streamed symbol automatically (no dashboard clicks).
    // Default behavior stays unchanged unless explicitly enabled via env.
    const explicitFullScan =
      parseBool(process.env.EA_FULL_SCAN) ?? parseBool(process.env.EA_SCAN_ALL_SYMBOLS);
    const autoTradingAutostart =
      String(process.env.AUTO_TRADING_AUTOSTART || '')
        .trim()
        .toLowerCase() === 'true';
    const allowAllSymbols = !this.restrictSymbols;
    this.fullScanEnabled =
      explicitFullScan != null
        ? explicitFullScan
        : Boolean(autoTradingAutostart && allowAllSymbols);

    // When full-scan is enabled we typically do NOT want the dashboard to constrain the EA stream
    // to only a small "active" list (e.g., 40 symbols). Keep it opt-out via env.
    const explicitRespectActive = parseBool(process.env.EA_RESPECT_DASHBOARD_ACTIVE_SYMBOLS);
    this.respectDashboardActiveSymbols =
      explicitRespectActive != null ? explicitRespectActive : !this.fullScanEnabled;

    // Defensive ingestion caps (avoid runaway payloads harming server stability).
    // These are soft caps: we accept the request but only process up to N items.
    this.maxQuotesPerIngest = Number.isFinite(Number(process.env.EA_MAX_QUOTES_PER_INGEST))
      ? Math.max(1, Number(process.env.EA_MAX_QUOTES_PER_INGEST))
      : 500;
    this.maxBarsPerIngest = Number.isFinite(Number(process.env.EA_MAX_BARS_PER_INGEST))
      ? Math.max(1, Number(process.env.EA_MAX_BARS_PER_INGEST))
      : 250;
  }

  getMarketCandleAnalysis({ broker, symbol, timeframe, limit = 200, maxAgeMs = 0 } = {}) {
    const brokerId = String(broker || '')
      .trim()
      .toLowerCase();
    const sym = this.canonicalizeSymbol(symbol);
    const tf = String(timeframe || '')
      .trim()
      .toUpperCase();
    const lim = Number.isFinite(Number(limit)) ? Math.max(3, Math.min(500, Number(limit))) : 200;
    const maxAge = Number.isFinite(Number(maxAgeMs)) ? Math.max(0, Number(maxAgeMs)) : 0;
    if (!brokerId || !sym || !tf) {
      return null;
    }

    const cacheKey = `${brokerId}:${sym}:${tf}:${lim}:${maxAge}`;
    const cached = this.candleAnalysisCache.get(cacheKey);
    const now = Date.now();

    const candles = this.getMarketCandles({
      broker: brokerId,
      symbol: sym,
      timeframe: tf,
      limit: lim,
      maxAgeMs: maxAge
    });

    const series = Array.isArray(candles) ? candles : [];
    const lastBarTimeMs = (() => {
      let best = null;
      for (const c of series) {
        const t = c?.time ?? c?.timestamp;
        const num = Number(t);
        if (!Number.isFinite(num) || num <= 0) {
          continue;
        }
        const ms = num < 10_000_000_000 ? Math.round(num * 1000) : Math.round(num);
        if (best == null || ms > best) {
          best = ms;
        }
      }
      return best;
    })();

    if (
      cached &&
      now - (cached.computedAt || 0) < this.candleAnalysisCacheTtlMs &&
      (cached.lastBarTimeMs == null || cached.lastBarTimeMs === lastBarTimeMs)
    ) {
      return cached.result;
    }

    const result = analyzeCandleSeries(series, { timeframe: tf });
    this.candleAnalysisCache.set(cacheKey, { computedAt: now, lastBarTimeMs, result });
    return result;
  }

  getMarketCandleAnalysisByTimeframe({
    broker,
    symbol,
    timeframes = ['M1', 'M15', 'H1', 'H4', 'D1'],
    limit = 200,
    maxAgeMs = 0
  } = {}) {
    const brokerId = String(broker || '')
      .trim()
      .toLowerCase();
    const sym = this.canonicalizeSymbol(symbol);
    if (!brokerId || !sym) {
      return { analyses: {}, aggregate: null };
    }

    const tfs = Array.isArray(timeframes)
      ? timeframes
          .map((t) =>
            String(t || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : String(timeframes || '')
          .split(',')
          .map((t) =>
            String(t || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean);

    const analyses = {};
    for (const tf of tfs) {
      const analysis = this.getMarketCandleAnalysis({
        broker: brokerId,
        symbol: sym,
        timeframe: tf,
        limit,
        maxAgeMs
      });
      if (analysis) {
        analyses[tf] = analysis;
      }
    }

    return {
      analyses,
      aggregate: aggregateCandleAnalyses(analyses)
    };
  }

  canonicalizeSymbol(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  // Heuristic symbol classifier (FX + metals + major crypto) independent of runtime filtering.
  // Use this for scan/trading safety even when ALLOW_ALL_SYMBOLS=true.
  isSupportedAssetSymbol(value) {
    const symbol = this.canonicalizeSymbol(value);
    if (!symbol) {
      return false;
    }

    const currencyCodes = new Set([
      'USD',
      'EUR',
      'JPY',
      'GBP',
      'CHF',
      'CAD',
      'AUD',
      'NZD',
      'SEK',
      'NOK',
      'DKK',
      'PLN',
      'CZK',
      'HUF',
      'MXN',
      'ZAR',
      'TRY',
      'CNH',
      'CNY',
      'SGD',
      'HKD'
    ]);

    const metalBases = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
    const cryptoBases = new Set([
      'BTC',
      'ETH',
      'LTC',
      'XRP',
      'BCH',
      'ADA',
      'DOT',
      'SOL',
      'DOGE',
      'BNB',
      'AVAX',
      'TRX',
      'XLM',
      'LINK'
    ]);

    if (symbol.length >= 6) {
      const base = symbol.slice(0, 3);
      const quote = symbol.slice(3, 6);
      if (metalBases.has(base) && currencyCodes.has(quote)) {
        return true;
      }
      if (currencyCodes.has(base) && currencyCodes.has(quote)) {
        return true;
      }
    }

    const cryptoQuotes = ['USD', 'USDT', 'EUR'];
    for (const base of cryptoBases) {
      if (!symbol.startsWith(base)) {
        continue;
      }
      const rest = symbol.slice(base.length);
      for (const q of cryptoQuotes) {
        if (rest.startsWith(q)) {
          return true;
        }
      }
    }

    return false;
  }

  isAllowedAssetSymbol(value) {
    if (!this.restrictSymbols) {
      return true;
    }
    return this.isSupportedAssetSymbol(value);
  }

  pruneExpiredActiveSymbols(broker) {
    const normalizedBroker = this.normalizeBroker(broker);
    if (!normalizedBroker) {
      return;
    }
    const map = this.activeSymbols.get(normalizedBroker);
    if (!map) {
      return;
    }
    const now = Date.now();
    for (const [symbol, expiresAt] of map.entries()) {
      if (!expiresAt || now > Number(expiresAt)) {
        map.delete(symbol);
      }
    }
    if (map.size === 0) {
      this.activeSymbols.delete(normalizedBroker);
    }
  }

  touchActiveSymbol(options = {}) {
    if (!this.respectDashboardActiveSymbols) {
      return;
    }
    const broker = this.normalizeBroker(options.broker);
    const symbol = this.normalizeSymbol(options.symbol || options.pair);
    if (!broker || !symbol) {
      return;
    }
    if (!this.isAllowedAssetSymbol(symbol)) {
      // Smart relax: allow any sane symbol *only if* it is already streaming from the EA.
      // This enables dashboards to scan equities/indices/CFDs without turning on ALLOW_ALL_SYMBOLS.
      try {
        const existing = this.getLatestQuoteForSymbolMatch(broker, symbol);
        if (!existing) {
          return;
        }
      } catch (_error) {
        return;
      }
    }
    const ttlMs = Number.isFinite(Number(options.ttlMs))
      ? Math.max(5 * 1000, Number(options.ttlMs))
      : this.activeSymbolsDefaultTtlMs;

    const expiresAt = Date.now() + ttlMs;
    const map = this.activeSymbols.get(broker) || new Map();
    map.set(symbol, expiresAt);
    this.activeSymbols.set(broker, map);

    // Seed candles immediately if a matching quote already exists.
    try {
      const existing = this.getLatestQuoteForSymbolMatch(broker, symbol);
      if (existing) {
        this.updateSyntheticCandlesFromQuote(existing);
      }
    } catch (_error) {
      // best-effort
    }
  }

  setActiveSymbols(options = {}) {
    if (!this.respectDashboardActiveSymbols) {
      const broker = this.normalizeBroker(options.broker);
      return {
        success: true,
        message: 'Active symbols ignored (full-scan enabled)',
        broker: broker || null,
        symbols: []
      };
    }
    const broker = this.normalizeBroker(options.broker);
    const symbols = Array.isArray(options.symbols) ? options.symbols : [];
    if (!broker) {
      return { success: false, message: 'broker is required', symbols: [] };
    }

    const ttlMs = Number.isFinite(Number(options.ttlMs))
      ? Math.max(5 * 1000, Number(options.ttlMs))
      : this.activeSymbolsDefaultTtlMs;
    const expiresAt = Date.now() + ttlMs;

    const normalized = [];
    for (const raw of symbols) {
      const sym = this.normalizeSymbol(raw);
      if (!sym) {
        continue;
      }
      if (!this.isAllowedAssetSymbol(sym)) {
        // Smart relax: accept symbols outside the FX/metals/crypto heuristic if the EA
        // is already streaming quotes for them.
        try {
          const existing = this.getLatestQuoteForSymbolMatch(broker, sym);
          if (!existing) {
            continue;
          }
        } catch (_error) {
          continue;
        }
      }
      normalized.push(sym);
    }

    const map = new Map();
    for (const sym of normalized) {
      map.set(sym, expiresAt);
    }

    if (map.size > 0) {
      this.activeSymbols.set(broker, map);
    } else {
      this.activeSymbols.delete(broker);
    }

    // Seed candles for active symbols using any existing quotes.
    try {
      for (const sym of normalized) {
        const existing = this.getLatestQuoteForSymbolMatch(broker, sym);
        if (existing) {
          this.updateSyntheticCandlesFromQuote(existing);
        }
      }
    } catch (_error) {
      // best-effort
    }

    return { success: true, message: 'Active symbols updated', broker, symbols: normalized };
  }

  getActiveSymbols(options = {}) {
    if (!this.respectDashboardActiveSymbols) {
      // Full-scan mode: provide a broad symbol list (prefer EA-registered universe).
      const broker = this.normalizeBroker(options.broker);
      if (!broker) {
        return [];
      }
      const max = Number.isFinite(Number(options.max)) ? Math.max(1, Number(options.max)) : 2000;
      return this.listKnownSymbols({ broker, max, maxAgeMs: null });
    }
    const broker = this.normalizeBroker(options.broker);
    if (!broker) {
      return [];
    }
    this.pruneExpiredActiveSymbols(broker);
    const map = this.activeSymbols.get(broker);
    if (!map) {
      return [];
    }
    const max = Number.isFinite(Number(options.max)) ? Math.max(1, Number(options.max)) : 200;
    return Array.from(map.keys()).slice(0, max);
  }

  recordSymbols(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    const rawSymbols = Array.isArray(payload.symbols)
      ? payload.symbols
      : Array.isArray(payload.items)
        ? payload.items
        : [];
    if (!broker) {
      return {
        success: false,
        message: 'broker is required',
        broker: null,
        recorded: 0,
        ignored: 0
      };
    }
    if (rawSymbols.length === 0) {
      return {
        success: false,
        message: 'symbols array is required',
        broker,
        recorded: 0,
        ignored: 0
      };
    }

    const isSaneEaSymbolToken = (symbol) => {
      const cleaned = String(symbol || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      if (!cleaned) {
        return false;
      }
      if (cleaned.length < 2 || cleaned.length > 40) {
        return false;
      }
      if (!/^[-A-Z0-9_.#:/]+$/.test(cleaned)) {
        return false;
      }
      const deny = new Set(['BALANCE', 'EQUITY', 'MARGIN', 'FREE', 'ACCOUNT']);
      if (deny.has(cleaned)) {
        return false;
      }
      return true;
    };

    const now = Date.now();
    const map = this.registeredSymbols.get(broker) || new Map();

    const capped = rawSymbols.slice(0, this.maxRegisteredSymbolsPerBroker);
    const ignored = Math.max(0, rawSymbols.length - capped.length);

    let recorded = 0;
    for (const raw of capped) {
      const sym = this.normalizeSymbol(raw);
      if (!sym) {
        continue;
      }
      if (!isSaneEaSymbolToken(sym)) {
        continue;
      }
      // Respect current bridge filtering unless explicitly disabled.
      if (!this.isAllowedAssetSymbol(sym)) {
        continue;
      }
      map.set(sym, now);
      recorded += 1;
    }

    if (map.size > 0) {
      // Hard cap to keep memory bounded.
      if (map.size > this.maxRegisteredSymbolsPerBroker) {
        const entries = Array.from(map.entries()).sort(
          (a, b) => Number(b[1] || 0) - Number(a[1] || 0)
        );
        const trimmed = entries.slice(0, this.maxRegisteredSymbolsPerBroker);
        this.registeredSymbols.set(broker, new Map(trimmed));
      } else {
        this.registeredSymbols.set(broker, map);
      }
    }

    const message = ignored > 0 ? 'Symbols registered (payload truncated)' : 'Symbols registered';
    return {
      success: true,
      message,
      broker,
      recorded,
      ignored,
      count: this.registeredSymbols.get(broker)?.size || 0
    };
  }

  getRegisteredSymbols(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    if (!broker) {
      return [];
    }
    const map = this.registeredSymbols.get(broker);
    if (!map) {
      return [];
    }
    const max = Number.isFinite(Number(options.max)) ? Math.max(1, Number(options.max)) : 5000;
    return Array.from(map.keys()).slice(0, max);
  }

  scoreSymbolMatch(requestedSymbol, candidateSymbol) {
    const requested = this.normalizeSymbol(requestedSymbol);
    const candidate = this.normalizeSymbol(candidateSymbol);
    if (!requested || !candidate) {
      return 0;
    }

    if (candidate === requested) {
      return 1000;
    }

    const reqCanon = this.canonicalizeSymbol(requested);
    const candCanon = this.canonicalizeSymbol(candidate);

    if (reqCanon && candCanon && candCanon === reqCanon) {
      return 900;
    }

    // Most common broker pattern: symbol suffixes (EURUSDm, EURUSD.r, XAUUSD# etc)
    if (candidate.startsWith(requested)) {
      return 800;
    }
    if (requested.startsWith(candidate)) {
      return 750;
    }
    if (reqCanon && candCanon && candCanon.startsWith(reqCanon)) {
      return 700;
    }
    if (reqCanon && candCanon && reqCanon.startsWith(candCanon)) {
      return 650;
    }

    return 0;
  }

  bestSymbolMatch(requestedSymbol, candidates = []) {
    const requested = this.normalizeSymbol(requestedSymbol);
    if (!requested) {
      return null;
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return requested;
    }

    let best = null;
    let bestScore = 0;
    for (const rawCandidate of candidates) {
      const candidate = this.normalizeSymbol(rawCandidate);
      if (!candidate) {
        continue;
      }
      const score = this.scoreSymbolMatch(requested, candidate);
      if (score <= 0) {
        continue;
      }
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
        continue;
      }
      if (score === bestScore && best) {
        // Tie-break: prefer shorter symbol (EURUSD over EURUSDm)
        if (candidate.length < best.length) {
          best = candidate;
        }
      }
    }

    return best || requested;
  }

  resolveSymbolFromQuotes(broker, requestedSymbol, options = {}) {
    const normalizedBroker = this.normalizeBroker(broker);
    const requested = this.normalizeSymbol(requestedSymbol);
    if (!normalizedBroker || !requested) {
      return requested;
    }

    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : null;
    const now = Date.now();

    const candidatesAll = [];
    const candidatesFresh = [];
    for (const quote of this.latestQuotes.values()) {
      if (!quote || quote.broker !== normalizedBroker) {
        continue;
      }
      if (!quote.symbol) {
        continue;
      }
      candidatesAll.push(quote.symbol);
      if (maxAgeMs == null || now - Number(quote.receivedAt || 0) <= maxAgeMs) {
        candidatesFresh.push(quote.symbol);
      }
    }

    // Prefer symbols that are currently streaming (fresh quotes).
    const candidates = candidatesFresh.length > 0 ? candidatesFresh : candidatesAll;
    return this.bestSymbolMatch(requested, candidates);
  }

  resolveSymbolFromSnapshots(broker, requestedSymbol) {
    const normalizedBroker = this.normalizeBroker(broker);
    const requested = this.normalizeSymbol(requestedSymbol);
    if (!normalizedBroker || !requested) {
      return requested;
    }

    const candidates = [];
    for (const snapshot of this.latestSnapshots.values()) {
      if (!snapshot || snapshot.broker !== normalizedBroker) {
        continue;
      }
      if (snapshot.symbol) {
        candidates.push(snapshot.symbol);
      }
    }
    return this.bestSymbolMatch(requested, candidates);
  }

  resolveSymbolFromBars(broker, requestedSymbol, timeframe) {
    const normalizedBroker = this.normalizeBroker(broker);
    const requested = this.normalizeSymbol(requestedSymbol);
    const tf = this.normalizeTimeframe(timeframe);
    if (!normalizedBroker || !requested || !tf) {
      return requested;
    }

    const candidates = [];
    for (const key of this.latestBars.keys()) {
      if (typeof key !== 'string') {
        continue;
      }
      const parts = key.split(':');
      if (parts.length < 3) {
        continue;
      }
      const [keyBroker, keySymbol, keyTf] = parts;
      if (keyBroker !== normalizedBroker) {
        continue;
      }
      if (String(keyTf || '').toUpperCase() !== String(tf).toUpperCase()) {
        continue;
      }
      if (keySymbol) {
        candidates.push(keySymbol);
      }
    }
    return this.bestSymbolMatch(requested, candidates);
  }

  pruneExpiredSnapshotRequests(broker) {
    const normalizedBroker = this.normalizeBroker(broker);
    if (!normalizedBroker) {
      return;
    }
    const map = this.snapshotRequests.get(normalizedBroker);
    if (!map) {
      return;
    }
    const now = Date.now();
    for (const [symbol, expiresAt] of map.entries()) {
      if (!expiresAt || now > Number(expiresAt)) {
        map.delete(symbol);
      }
    }
    if (map.size === 0) {
      this.snapshotRequests.delete(normalizedBroker);
    }

    for (const [key, until] of this.snapshotInflight.entries()) {
      if (!until || now > Number(until)) {
        this.snapshotInflight.delete(key);
      }
    }

    this.pruneExpiredActiveSymbols(normalizedBroker);
  }

  requestMarketSnapshot(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const requestedSymbol = this.normalizeSymbol(options.symbol || options.pair);
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : 2 * 60 * 1000;
    if (!broker || !requestedSymbol) {
      return { success: false, message: 'broker and symbol are required' };
    }

    if (!this.isAllowedAssetSymbol(requestedSymbol)) {
      return { success: false, message: 'Symbol not allowed (FX/metals/crypto only)', broker };
    }

    // IMPORTANT: The dashboard may normalize symbols (EURUSD) while the broker uses suffixes (EURUSDm).
    // Resolve to a symbol that actually exists in the MT terminal (based on recent quotes), so the EA can SymbolSelect().
    const symbol = this.resolveSymbolFromQuotes(broker, requestedSymbol);

    // Mark symbol as active so the EA can prioritize it.
    this.touchActiveSymbol({ broker, symbol, ttlMs });

    // If we already have a fresh snapshot, don't ask the terminal to recompute.
    const existing = this.latestSnapshots.get(`${broker}:${symbol}`) || null;
    const now = Date.now();
    if (existing && now - Number(existing.receivedAt || 0) <= this.snapshotFreshMaxAgeMs) {
      return {
        success: true,
        message: 'Snapshot already fresh',
        broker,
        symbol,
        freshAt: existing.receivedAt || null
      };
    }

    const inflightKey = `${broker}:${symbol}`;
    const inflightUntil = this.snapshotInflight.get(inflightKey);
    if (inflightUntil && now <= Number(inflightUntil)) {
      return {
        success: true,
        message: 'Snapshot already in flight',
        broker,
        symbol,
        inflightUntil
      };
    }

    const expiresAt = now + Math.max(5 * 1000, ttlMs);
    const map = this.snapshotRequests.get(broker) || new Map();
    map.set(symbol, expiresAt);
    this.snapshotRequests.set(broker, map);
    return { success: true, message: 'Snapshot requested', broker, symbol, expiresAt };
  }

  consumeMarketSnapshotRequests(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const max = Number.isFinite(Number(options.max)) ? Math.max(1, Number(options.max)) : 10;
    if (!broker) {
      return [];
    }

    this.pruneExpiredSnapshotRequests(broker);
    const map = this.snapshotRequests.get(broker);
    if (!map || map.size === 0) {
      return [];
    }

    const symbols = [];
    const now = Date.now();
    for (const symbol of map.keys()) {
      symbols.push(symbol);
      map.delete(symbol);

      // Mark as in-flight so repeated dashboard requests don't force recomputation.
      const inflightKey = `${broker}:${symbol}`;
      this.snapshotInflight.set(inflightKey, now + this.snapshotInflightTtlMs);

      if (symbols.length >= max) {
        break;
      }
    }

    if (map.size === 0) {
      this.snapshotRequests.delete(broker);
    }

    return symbols;
  }

  normalizeBroker(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'mt4' || raw === 'metatrader4') {
      return 'mt4';
    }
    if (raw === 'mt5' || raw === 'metatrader5') {
      return 'mt5';
    }
    return raw || null;
  }

  normalizeSymbol(value) {
    const symbol = String(value || '')
      .trim()
      .toUpperCase();
    return symbol || null;
  }

  recordQuote(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    const symbol = this.normalizeSymbol(payload.symbol || payload.pair);
    if (!broker || !symbol) {
      return { success: false, message: 'broker and symbol are required' };
    }

    if (!this.isAllowedAssetSymbol(symbol)) {
      return { success: true, message: 'Symbol ignored (asset class not allowed)', broker, symbol };
    }

    const timestamp = Number(payload.timestamp || payload.time || Date.now());
    const bidRaw = payload.bid != null ? Number(payload.bid) : null;
    const askRaw = payload.ask != null ? Number(payload.ask) : null;
    const last = payload.last != null ? Number(payload.last) : null;

    const digits = payload.digits != null ? Number(payload.digits) : null;
    const point = payload.point != null ? Number(payload.point) : null;
    const spreadPoints = payload.spreadPoints != null ? Number(payload.spreadPoints) : null;
    const tickSize = payload.tickSize != null ? Number(payload.tickSize) : null;
    const tickValue = payload.tickValue != null ? Number(payload.tickValue) : null;
    const contractSize = payload.contractSize != null ? Number(payload.contractSize) : null;

    // Some EAs send bid/ask as 0 for certain symbols; treat non-positive prices as missing.
    let bid = Number.isFinite(bidRaw) && bidRaw > 0 ? bidRaw : null;
    let ask = Number.isFinite(askRaw) && askRaw > 0 ? askRaw : null;

    // If we have a last price and a usable spread definition, derive bid/ask around last.
    if (
      (bid == null || ask == null) &&
      Number.isFinite(last) &&
      last > 0 &&
      Number.isFinite(spreadPoints) &&
      spreadPoints > 0 &&
      Number.isFinite(point) &&
      point > 0
    ) {
      const spreadPrice = spreadPoints * point;
      const half = spreadPrice / 2;
      const derivedBid = last - half;
      const derivedAsk = last + half;
      if (bid == null && derivedBid > 0) {
        bid = derivedBid;
      }
      if (ask == null && derivedAsk > 0) {
        ask = derivedAsk;
      }
    }

    // Ensure bid/ask ordering if both exist.
    if (bid != null && ask != null && ask < bid) {
      const tmp = bid;
      bid = ask;
      ask = tmp;
    }

    const mid =
      Number.isFinite(bid) && Number.isFinite(ask)
        ? (bid + ask) / 2
        : Number.isFinite(last)
          ? last
          : null;

    const histKey = `${broker}:${symbol}`;
    const history = this.quoteHistory.get(histKey) || [];
    const prev = history.length ? history[history.length - 1] : null;

    const receivedAt = Date.now();
    const dtMs = prev?.receivedAt ? Math.max(1, receivedAt - Number(prev.receivedAt)) : null;
    const dMid =
      mid != null && prev?.mid != null ? Number((mid - Number(prev.mid)).toFixed(8)) : null;
    const velocityPerSec =
      dMid != null && dtMs != null ? Number((dMid / (dtMs / 1000)).toFixed(8)) : null;

    const quote = {
      broker,
      symbol,
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      last: Number.isFinite(last) ? last : null,
      mid: mid != null ? Number(mid.toFixed(8)) : null,
      midDelta: dMid,
      midVelocityPerSec: velocityPerSec,
      digits: Number.isFinite(digits) ? Math.max(0, Math.min(20, Math.trunc(digits))) : null,
      point: Number.isFinite(point) ? point : null,
      spreadPoints: Number.isFinite(spreadPoints) ? spreadPoints : null,
      tickSize: Number.isFinite(tickSize) ? tickSize : null,
      tickValue: Number.isFinite(tickValue) ? tickValue : null,
      contractSize: Number.isFinite(contractSize) ? contractSize : null,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      receivedAt,
      source: payload.source || 'ea'
    };

    const key = `${broker}:${symbol}`;
    this.latestQuotes.set(key, quote);

    try {
      history.push({
        receivedAt,
        mid: quote.mid,
        bid: quote.bid,
        ask: quote.ask,
        spreadPoints: quote.spreadPoints
      });
      while (history.length > 6) {
        history.shift();
      }
      this.quoteHistory.set(histKey, history);
    } catch (_error) {
      // best-effort
    }

    try {
      this.updateSyntheticCandlesFromQuote(quote);
    } catch (_error) {
      // best-effort
    }

    // bound memory
    if (this.latestQuotes.size > this.maxQuotes) {
      const firstKey = this.latestQuotes.keys().next().value;
      if (firstKey) {
        this.latestQuotes.delete(firstKey);
      }
    }

    return { success: true, message: 'Quote recorded', quote };
  }

  getLatestQuoteForSymbolMatch(broker, requestedSymbol) {
    const normalizedBroker = this.normalizeBroker(broker);
    const requested = this.normalizeSymbol(requestedSymbol);
    if (!normalizedBroker || !requested) {
      return null;
    }

    let best = null;
    let bestScore = 0;
    for (const quote of this.latestQuotes.values()) {
      if (!quote || quote.broker !== normalizedBroker) {
        continue;
      }
      const candidate = this.normalizeSymbol(quote.symbol);
      if (!candidate) {
        continue;
      }
      const score = this.scoreSymbolMatch(requested, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = quote;
      }
    }

    return best;
  }

  recordQuotes(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    if (!broker) {
      return { success: false, message: 'broker is required' };
    }
    if (quotes.length === 0) {
      // Allow single quote payload
      return this.recordQuote({ ...payload, broker });
    }

    const cappedQuotes = quotes.slice(0, this.maxQuotesPerIngest);
    const ignored = Math.max(0, quotes.length - cappedQuotes.length);

    let recorded = 0;
    for (const quote of cappedQuotes) {
      const result = this.recordQuote({ ...quote, broker });
      if (result.success && result.quote) {
        recorded += 1;
      }
    }

    const message = ignored > 0 ? 'Quotes recorded (payload truncated)' : 'Quotes recorded';
    return { success: true, message, broker, recorded, ignored };
  }

  getQuotes(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const symbols = Array.isArray(options.symbols) ? options.symbols : null;
    const orderBy = String(options.orderBy || '')
      .trim()
      .toLowerCase();
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Number(options.maxAgeMs)
      : 30 * 1000;
    const now = Date.now();

    const wantedSymbols = symbols
      ? new Set(symbols.map((s) => this.normalizeSymbol(s)).filter(Boolean))
      : null;

    const results = [];
    for (const quote of this.latestQuotes.values()) {
      if (broker && quote.broker !== broker) {
        continue;
      }
      if (wantedSymbols && !wantedSymbols.has(quote.symbol)) {
        continue;
      }
      if (maxAgeMs != null && now - Number(quote.receivedAt || 0) > maxAgeMs) {
        continue;
      }
      results.push(quote);
    }

    if (orderBy === 'symbol') {
      results.sort((a, b) => String(a?.symbol || '').localeCompare(String(b?.symbol || '')));
    } else {
      results.sort((a, b) => {
        const aTime = Number(a.receivedAt || a.timestamp || 0);
        const bTime = Number(b.receivedAt || b.timestamp || 0);
        return bTime - aTime;
      });
    }

    return results;
  }

  recordNews(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    if (!broker) {
      return { success: false, message: 'broker is required' };
    }

    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.news)
        ? payload.news
        : [];
    if (items.length === 0) {
      return { success: false, message: 'items/news array is required' };
    }

    const timeline = this.newsTimeline.get(broker) || [];
    let ingested = 0;

    for (const raw of items) {
      if (!raw) {
        continue;
      }

      const id = String(raw.id || raw.eventId || raw.guid || raw.title || '').trim();
      if (!id) {
        continue;
      }

      const item = {
        id,
        broker,
        title: raw.title || raw.headline || 'EA News',
        symbol: raw.symbol ? this.normalizeSymbol(raw.symbol) : null,
        currency: raw.currency ? String(raw.currency).toUpperCase() : null,
        impact: raw.impact ?? raw.importance ?? null,
        time: Number(raw.time || raw.timestamp || raw.date || Date.now()),
        forecast: raw.forecast ?? null,
        previous: raw.previous ?? null,
        actual: raw.actual ?? null,
        source: raw.source || 'ea',
        notes: raw.notes || raw.comment || null,
        receivedAt: Date.now(),
        raw
      };

      const key = `${broker}:${id}`;
      this.latestNews.set(key, item);
      if (!timeline.includes(id)) {
        timeline.unshift(id);
      }
      ingested += 1;
    }

    // bound memory per broker
    if (timeline.length > this.maxNewsPerBroker) {
      const overflow = timeline.splice(this.maxNewsPerBroker);
      for (const id of overflow) {
        this.latestNews.delete(`${broker}:${id}`);
      }
    }

    this.newsTimeline.set(broker, timeline);

    return { success: true, message: 'News ingested', broker, ingested };
  }

  getNews(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 50;
    const timeline = broker ? this.newsTimeline.get(broker) || [] : null;

    const results = [];
    if (broker) {
      for (const id of timeline.slice(0, limit)) {
        const item = this.latestNews.get(`${broker}:${id}`);
        if (item) {
          results.push(item);
        }
      }
      return results;
    }

    // If broker not provided, return newest across all brokers.
    for (const item of this.latestNews.values()) {
      results.push(item);
    }
    results.sort(
      (a, b) => Number(b.receivedAt || b.time || 0) - Number(a.receivedAt || a.time || 0)
    );
    return results.slice(0, limit);
  }

  normalizeTimeframe(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    return raw || null;
  }

  normalizeEpochMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    // Heuristic: epoch seconds are typically < 1e11
    if (numeric < 1e11) {
      return Math.trunc(numeric * 1000);
    }
    return Math.trunc(numeric);
  }

  timeframeToMs(timeframe) {
    const tf = this.normalizeTimeframe(timeframe);
    if (!tf) {
      return null;
    }
    switch (tf) {
      case 'M1':
        return 60 * 1000;
      case 'M5':
        return 5 * 60 * 1000;
      case 'M15':
        return 15 * 60 * 1000;
      case 'M30':
        return 30 * 60 * 1000;
      case 'H1':
        return 60 * 60 * 1000;
      case 'H4':
        return 4 * 60 * 60 * 1000;
      case 'D1':
        return 24 * 60 * 60 * 1000;
      case 'W1':
        return 7 * 24 * 60 * 60 * 1000;
      case 'MN1':
        // Month boundaries are not fixed; this is used only as an approximate bucket.
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return null;
    }
  }

  extractQuotePrice(quote) {
    if (!quote || typeof quote !== 'object') {
      return null;
    }
    const bid = Number(quote.bid);
    const ask = Number(quote.ask);
    const last = Number(quote.last);

    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      return (bid + ask) / 2;
    }
    if (Number.isFinite(last) && last > 0) {
      return last;
    }
    if (Number.isFinite(bid) && bid > 0) {
      return bid;
    }
    if (Number.isFinite(ask) && ask > 0) {
      return ask;
    }
    return null;
  }

  getRequestedSymbolsForBroker(broker) {
    const normalizedBroker = this.normalizeBroker(broker);
    if (!normalizedBroker) {
      return [];
    }

    this.pruneExpiredActiveSymbols(normalizedBroker);
    this.pruneExpiredSnapshotRequests(normalizedBroker);

    const wanted = new Set();
    const active = this.activeSymbols.get(normalizedBroker);
    if (active) {
      for (const symbol of active.keys()) {
        if (symbol) {
          wanted.add(symbol);
        }
      }
    }
    const requests = this.snapshotRequests.get(normalizedBroker);
    if (requests) {
      for (const symbol of requests.keys()) {
        if (symbol) {
          wanted.add(symbol);
        }
      }
    }
    return Array.from(wanted);
  }

  isSymbolRelevantForSynthetic(broker, symbol) {
    const normalizedBroker = this.normalizeBroker(broker);
    const candidate = this.normalizeSymbol(symbol);
    if (!normalizedBroker || !candidate) {
      return false;
    }

    // In full-scan mode, derive synthetic candles for every EA-streamed symbol.
    // This allows analysis without any dashboard "active" symbol hints.
    if (this.fullScanEnabled) {
      return true;
    }

    const requested = this.getRequestedSymbolsForBroker(normalizedBroker);
    if (!requested || requested.length === 0) {
      return false;
    }

    for (const req of requested) {
      if (this.scoreSymbolMatch(req, candidate) > 0) {
        return true;
      }
    }

    return false;
  }

  recordSyntheticCandle({ broker, symbol, timeframe, timestampMs, price }) {
    const normalizedBroker = this.normalizeBroker(broker);
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const tf = this.normalizeTimeframe(timeframe);
    const ts = this.normalizeEpochMs(timestampMs);
    const p = Number(price);

    if (!normalizedBroker || !normalizedSymbol || !tf || !ts || !Number.isFinite(p) || p <= 0) {
      return false;
    }

    const tfMs = this.timeframeToMs(tf);
    if (!tfMs) {
      return false;
    }

    const start = Math.floor(ts / tfMs) * tfMs;
    const key = `${normalizedBroker}:${normalizedSymbol}:${tf}`;
    const now = Date.now();

    const existing = Array.isArray(this.syntheticCandles.get(key))
      ? this.syntheticCandles.get(key)
      : [];

    if (existing.length > 0 && Number(existing[0]?.time || 0) === start) {
      const top = existing[0];
      const open = Number(top?.open);
      const high = Number(top?.high);
      const low = Number(top?.low);

      existing[0] = {
        ...top,
        time: start,
        open: Number.isFinite(open) ? open : p,
        high: Number.isFinite(high) ? Math.max(high, p) : p,
        low: Number.isFinite(low) ? Math.min(low, p) : p,
        close: p,
        receivedAt: now,
        source: 'quotes'
      };
    } else {
      existing.unshift({
        time: start,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: null,
        receivedAt: now,
        source: 'quotes'
      });
    }

    const deduped = [];
    const seen = new Set();
    for (const candle of existing) {
      const t = Number(candle?.time || 0);
      if (!t || seen.has(t)) {
        continue;
      }
      seen.add(t);
      deduped.push(candle);
      if (deduped.length >= this.maxSyntheticCandlesPerSeries) {
        break;
      }
    }

    this.syntheticCandles.set(key, deduped);
    if (this.syntheticCandles.size > this.maxSyntheticSeries) {
      const firstKey = this.syntheticCandles.keys().next().value;
      if (firstKey) {
        this.syntheticCandles.delete(firstKey);
      }
    }

    return true;
  }

  updateSyntheticCandlesFromQuote(quote) {
    if (!quote || typeof quote !== 'object') {
      return;
    }
    const broker = this.normalizeBroker(quote.broker);
    const symbol = this.normalizeSymbol(quote.symbol);
    if (!broker || !symbol) {
      return;
    }
    if (!this.isAllowedAssetSymbol(symbol)) {
      return;
    }
    if (!this.isSymbolRelevantForSynthetic(broker, symbol)) {
      return;
    }

    const price = this.extractQuotePrice(quote);
    if (price == null) {
      return;
    }

    const ts = this.normalizeEpochMs(
      quote.timestamp || quote.time || quote.receivedAt || Date.now()
    );
    for (const tf of this.syntheticTimeframes) {
      this.recordSyntheticCandle({ broker, symbol, timeframe: tf, timestampMs: ts, price });
    }
  }

  getSyntheticCandles(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const requestedSymbol = this.normalizeSymbol(options.symbol || options.pair);
    const timeframe = this.normalizeTimeframe(options.timeframe || options.tf);

    if (!broker || !requestedSymbol || !timeframe) {
      return [];
    }
    if (!this.isAllowedTimeframe(timeframe)) {
      return [];
    }

    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 200;
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Math.max(0, Number(options.maxAgeMs))
      : 10 * 60 * 1000;

    const tryKey = (sym) => {
      const key = `${broker}:${sym}:${timeframe}`;
      const series = this.syntheticCandles.get(key);
      return Array.isArray(series) && series.length ? series : null;
    };

    let series = tryKey(requestedSymbol);
    if (!series) {
      const resolved = this.resolveSymbolFromQuotes(broker, requestedSymbol);
      if (resolved && resolved !== requestedSymbol) {
        series = tryKey(resolved);
      }
    }

    if (!series) {
      // If quotes exist already but the symbol wasn't marked active at the time,
      // seed a candle on-demand and retry.
      try {
        const existing = this.getLatestQuoteForSymbolMatch(broker, requestedSymbol);
        if (existing) {
          this.updateSyntheticCandlesFromQuote(existing);
          series = tryKey(this.normalizeSymbol(existing.symbol) || requestedSymbol);
        }
      } catch (_error) {
        // ignore
      }
    }
    if (!series) {
      return [];
    }

    const now = Date.now();
    const filtered = maxAgeMs
      ? series.filter((candle) => now - Number(candle.receivedAt || 0) <= maxAgeMs)
      : series;
    return filtered.slice(0, limit);
  }

  isAllowedTimeframe(value) {
    const tf = this.normalizeTimeframe(value);
    if (!tf) {
      return false;
    }
    return ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'].includes(tf);
  }

  sanitizeNumber(value, { allowZero = false } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (!allowZero && numeric === 0) {
      return null;
    }
    return numeric;
  }

  recordMarketSnapshot(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    const symbol = this.normalizeSymbol(payload.symbol || payload.pair);
    if (!broker || !symbol) {
      return { success: false, message: 'broker and symbol are required' };
    }

    if (!this.isAllowedAssetSymbol(symbol)) {
      // Smart relax: if the EA is already streaming quotes for this symbol,
      // allow snapshots so the dashboard/runner can analyze indices/CFDs/equities
      // without requiring ALLOW_ALL_SYMBOLS.
      try {
        const existing = this.getLatestQuoteForSymbolMatch(broker, symbol);
        if (!existing) {
          return {
            success: true,
            message: 'Snapshot ignored (asset class not allowed)',
            broker,
            symbol
          };
        }
      } catch (_error) {
        return {
          success: true,
          message: 'Snapshot ignored (asset class not allowed)',
          broker,
          symbol
        };
      }
    }

    const timeframesRaw =
      payload.timeframes && typeof payload.timeframes === 'object' ? payload.timeframes : null;

    const normalizeSnapshotDirection = (value) => {
      const raw = String(value ?? '')
        .trim()
        .toUpperCase();

      if (raw === 'BUY' || raw === 'LONG' || raw === 'BULL' || raw === 'BULLISH' || raw === 'UP') {
        return 'BUY';
      }
      if (
        raw === 'SELL' ||
        raw === 'SHORT' ||
        raw === 'BEAR' ||
        raw === 'BEARISH' ||
        raw === 'DOWN'
      ) {
        return 'SELL';
      }
      if (raw === '1' || raw === '+1' || raw === '+') {
        return 'BUY';
      }
      if (raw === '-1' || raw === '-') {
        return 'SELL';
      }
      return 'NEUTRAL';
    };

    const normalizeSnapshotScore = (value) => {
      const numeric = this.sanitizeNumber(value, { allowZero: true });
      if (numeric == null) {
        return null;
      }

      // Common EA shapes:
      // - 0..100 (percent)
      // - 0..1 (ratio)
      // - -1..1 (signed ratio)
      let score = numeric;
      if (Math.abs(score) > 0 && Math.abs(score) <= 1.2) {
        score *= 100;
      }

      // Snapshot scores are treated as 0..100 strength values (magnitude only).
      score = Math.abs(score);
      score = Math.max(0, Math.min(100, score));
      return score;
    };

    const normalizeIndicatorObject = (raw) => {
      if (raw && typeof raw === 'object') {
        return raw;
      }
      return null;
    };

    const normalizedTimeframes = {};
    if (timeframesRaw) {
      for (const [tfRaw, frameRaw] of Object.entries(timeframesRaw)) {
        const tf = this.normalizeTimeframe(tfRaw);
        if (!tf || !frameRaw || typeof frameRaw !== 'object') {
          continue;
        }

        const direction = normalizeSnapshotDirection(frameRaw.direction ?? frameRaw.bias);
        const scoreCandidate =
          frameRaw.score ??
          frameRaw.strength ??
          frameRaw.signalStrength ??
          frameRaw.biasScore ??
          frameRaw.trendScore ??
          frameRaw.confidence ??
          null;
        const score = normalizeSnapshotScore(scoreCandidate);
        const confidence = normalizeSnapshotScore(frameRaw.confidence);

        const indicatorsRaw =
          frameRaw.indicators && typeof frameRaw.indicators === 'object' ? frameRaw.indicators : {};

        const rsiRaw = normalizeIndicatorObject(indicatorsRaw.rsi) || indicatorsRaw.rsi;
        const macdRaw = normalizeIndicatorObject(indicatorsRaw.macd) || indicatorsRaw.macd;
        const atrRaw = normalizeIndicatorObject(indicatorsRaw.atr) || indicatorsRaw.atr;

        const rsiValue =
          rsiRaw && typeof rsiRaw === 'object'
            ? this.sanitizeNumber(rsiRaw.value, { allowZero: false })
            : this.sanitizeNumber(rsiRaw, { allowZero: false });

        const atrValue =
          atrRaw && typeof atrRaw === 'object'
            ? this.sanitizeNumber(atrRaw.value, { allowZero: false })
            : this.sanitizeNumber(atrRaw, { allowZero: false });

        const macdHistogram =
          macdRaw && typeof macdRaw === 'object'
            ? this.sanitizeNumber(macdRaw.histogram, { allowZero: false })
            : this.sanitizeNumber(macdRaw, { allowZero: false });

        normalizedTimeframes[tf] = {
          timeframe: tf,
          direction,
          score: score != null ? score : 0,
          indicators: {
            rsi: rsiValue != null ? { value: rsiValue } : {},
            macd: macdHistogram != null ? { histogram: macdHistogram } : {},
            atr: atrValue != null ? { value: atrValue } : {}
          }
        };

        if (confidence != null) {
          normalizedTimeframes[tf].confidence = confidence;
        }

        const lastPrice = this.sanitizeNumber(frameRaw.lastPrice, { allowZero: false });
        if (lastPrice != null) {
          normalizedTimeframes[tf].lastPrice = lastPrice;
        }

        if (frameRaw.latestCandle && typeof frameRaw.latestCandle === 'object') {
          const candle = frameRaw.latestCandle;
          const open = this.sanitizeNumber(candle.open, { allowZero: false });
          const high = this.sanitizeNumber(candle.high, { allowZero: false });
          const low = this.sanitizeNumber(candle.low, { allowZero: false });
          const close = this.sanitizeNumber(candle.close, { allowZero: false });
          const time = this.sanitizeNumber(candle.time, { allowZero: false });
          const normalized = {
            open: open != null ? open : null,
            high: high != null ? high : null,
            low: low != null ? low : null,
            close: close != null ? close : null,
            time: time != null ? time : null
          };
          if (
            normalized.open != null ||
            normalized.high != null ||
            normalized.low != null ||
            normalized.close != null ||
            normalized.time != null
          ) {
            normalizedTimeframes[tf].latestCandle = normalized;
          }
        }

        if (frameRaw.ranges && typeof frameRaw.ranges === 'object') {
          normalizedTimeframes[tf].ranges = frameRaw.ranges;
        }
        if (frameRaw.pivotPoints && typeof frameRaw.pivotPoints === 'object') {
          normalizedTimeframes[tf].pivotPoints = frameRaw.pivotPoints;
        }
      }
    }

    const snapshot = {
      broker,
      symbol,
      timestamp:
        this.sanitizeNumber(payload.timestamp || payload.time, { allowZero: false }) || Date.now(),
      receivedAt: Date.now(),
      source: payload.source || 'ea',
      timeframes: normalizedTimeframes
    };

    const key = `${broker}:${symbol}`;
    this.latestSnapshots.set(key, snapshot);

    // Snapshot fulfilled: clear in-flight guard.
    this.snapshotInflight.delete(key);

    if (this.latestSnapshots.size > this.maxSnapshots) {
      const firstKey = this.latestSnapshots.keys().next().value;
      if (firstKey) {
        this.latestSnapshots.delete(firstKey);
      }
    }

    return { success: true, message: 'Snapshot recorded', broker, symbol, snapshot };
  }

  recordMarketBars(payload = {}) {
    const broker = this.normalizeBroker(payload.broker);
    const symbol = this.normalizeSymbol(payload.symbol || payload.pair);
    const timeframe = this.normalizeTimeframe(payload.timeframe || payload.tf);

    if (!broker || !symbol || !timeframe) {
      return { success: false, message: 'broker, symbol, and timeframe are required' };
    }
    if (!this.isAllowedAssetSymbol(symbol)) {
      // Smart relax: accept bars for symbols that are already streaming quotes.
      // This keeps the default allowlist (FX/metals/crypto) while still supporting
      // broker-specific CFD/index/equity symbols when they are truly live.
      try {
        const existing = this.getLatestQuoteForSymbolMatch(broker, symbol);
        if (!existing) {
          return {
            success: true,
            message: 'Bars ignored (asset class not allowed)',
            broker,
            symbol,
            timeframe
          };
        }
      } catch (_error) {
        return {
          success: true,
          message: 'Bars ignored (asset class not allowed)',
          broker,
          symbol,
          timeframe
        };
      }
    }
    if (!this.isAllowedTimeframe(timeframe)) {
      return { success: false, message: `Unsupported timeframe: ${timeframe}` };
    }

    const barsRaw = Array.isArray(payload.bars) ? payload.bars : payload.bar ? [payload.bar] : [];
    const bars = barsRaw.slice(0, this.maxBarsPerIngest);
    const ignored = Math.max(0, barsRaw.length - bars.length);

    if (bars.length === 0) {
      return { success: false, message: 'bars[] or bar is required' };
    }

    const key = `${broker}:${symbol}:${timeframe}`;
    const existing = Array.isArray(this.latestBars.get(key)) ? this.latestBars.get(key) : [];
    const now = Date.now();
    const source = payload.source || 'ea';

    const normalizedIncoming = [];
    for (const raw of bars) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const time = this.normalizeEpochMs(raw.time ?? raw.timestamp ?? raw.t);
      const open = this.sanitizeNumber(raw.open ?? raw.o, { allowZero: false });
      const high = this.sanitizeNumber(raw.high ?? raw.h, { allowZero: false });
      const low = this.sanitizeNumber(raw.low ?? raw.l, { allowZero: false });
      const close = this.sanitizeNumber(raw.close ?? raw.c, { allowZero: false });
      const volume = this.sanitizeNumber(raw.volume ?? raw.v, { allowZero: true });
      if (!time || open == null || high == null || low == null || close == null) {
        continue;
      }
      normalizedIncoming.push({
        time,
        open,
        high,
        low,
        close,
        volume: volume != null ? volume : null,
        receivedAt: now,
        source
      });
    }

    if (normalizedIncoming.length === 0) {
      return { success: false, message: 'No valid bars provided' };
    }

    const merged = [...normalizedIncoming, ...(existing || [])];
    merged.sort((a, b) => Number(b.time || 0) - Number(a.time || 0));

    const deduped = [];
    const seenTimes = new Set();
    for (const bar of merged) {
      const t = Number(bar?.time || 0);
      if (!t || seenTimes.has(t)) {
        continue;
      }
      seenTimes.add(t);
      deduped.push(bar);
      if (deduped.length >= this.maxBarsPerSeries) {
        break;
      }
    }

    this.latestBars.set(key, deduped);
    if (this.latestBars.size > this.maxBarSeries) {
      const firstKey = this.latestBars.keys().next().value;
      if (firstKey) {
        this.latestBars.delete(firstKey);
      }
    }

    return {
      success: true,
      message: ignored > 0 ? 'Bars recorded (payload truncated)' : 'Bars recorded',
      broker,
      symbol,
      timeframe,
      recorded: normalizedIncoming.length,
      ignored,
      seriesSize: deduped.length
    };
  }

  getMarketBars(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const requestedSymbol = this.normalizeSymbol(options.symbol || options.pair);
    const timeframe = this.normalizeTimeframe(options.timeframe || options.tf);

    if (!broker || !requestedSymbol || !timeframe) {
      return [];
    }
    if (!this.isAllowedTimeframe(timeframe)) {
      return [];
    }

    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 200;
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Math.max(0, Number(options.maxAgeMs))
      : 10 * 60 * 1000;

    const tryKey = (sym) => {
      const key = `${broker}:${sym}:${timeframe}`;
      const series = this.latestBars.get(key);
      return Array.isArray(series) && series.length ? series : null;
    };

    let series = tryKey(requestedSymbol);
    if (!series) {
      const resolved = this.resolveSymbolFromBars(broker, requestedSymbol, timeframe);
      if (resolved && resolved !== requestedSymbol) {
        series = tryKey(resolved);
      }
    }
    if (!series) {
      // Last fallback: if bars exist but timeframe matching didn't resolve, try quote-based match.
      const resolved = this.resolveSymbolFromQuotes(broker, requestedSymbol);
      if (resolved && resolved !== requestedSymbol) {
        series = tryKey(resolved);
      }
    }
    if (!series) {
      return [];
    }

    const now = Date.now();
    const filtered = maxAgeMs
      ? series.filter((bar) => now - Number(bar.receivedAt || 0) <= maxAgeMs)
      : series;

    return filtered.slice(0, limit);
  }

  getMarketCandles(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const symbol = this.normalizeSymbol(options.symbol || options.pair);
    const timeframe = this.normalizeTimeframe(options.timeframe || options.tf);

    if (!broker || !symbol || !timeframe) {
      return [];
    }
    if (!this.isAllowedTimeframe(timeframe)) {
      return [];
    }

    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 300;
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Math.max(0, Number(options.maxAgeMs))
      : 0;

    const bars = this.getMarketBars({ broker, symbol, timeframe, limit, maxAgeMs });
    if (Array.isArray(bars) && bars.length > 0) {
      return bars;
    }

    // Respect global "no synthetic" mode used by EA-only realtime setups.
    // When disabled, candles must come from EA bars (not quote-derived).
    // Callers/tests may explicitly override via options.allowSynthetic.
    const allowSyntheticOverride =
      typeof options.allowSynthetic === 'boolean' ? options.allowSynthetic : null;
    const allowSyntheticRaw = String(process.env.ALLOW_SYNTHETIC_DATA || '')
      .trim()
      .toLowerCase();
    const allowSyntheticFromEnv =
      !allowSyntheticRaw ||
      allowSyntheticRaw === '1' ||
      allowSyntheticRaw === 'true' ||
      allowSyntheticRaw === 'yes' ||
      allowSyntheticRaw === 'on';
    const allowSynthetic =
      allowSyntheticOverride != null ? allowSyntheticOverride : allowSyntheticFromEnv;
    if (!allowSynthetic) {
      return [];
    }

    return this.getSyntheticCandles({ broker, symbol, timeframe, limit, maxAgeMs });
  }

  getMarketSnapshot(options = {}) {
    const broker = this.normalizeBroker(options.broker);
    const requestedSymbol = this.normalizeSymbol(options.symbol || options.pair);
    if (!broker || !requestedSymbol) {
      return null;
    }

    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Math.max(0, Number(options.maxAgeMs))
      : 2 * 60 * 1000;
    const tryKey = (sym) => this.latestSnapshots.get(`${broker}:${sym}`) || null;
    let snapshot = tryKey(requestedSymbol);

    if (!snapshot) {
      const resolved = this.resolveSymbolFromSnapshots(broker, requestedSymbol);
      if (resolved && resolved !== requestedSymbol) {
        snapshot = tryKey(resolved);
      }
    }

    if (!snapshot) {
      // If we have quotes but not snapshots for the requested symbol, keep returning null so caller can request a snapshot.
      return null;
    }
    if (maxAgeMs && Date.now() - Number(snapshot.receivedAt || 0) > maxAgeMs) {
      return null;
    }
    return snapshot;
  }

  /**
   * Register EA session
   */
  registerSession(payload) {
    const { accountNumber, accountMode, broker, equity, balance, server, currency } = payload;

    if (!accountNumber || !broker) {
      throw new Error('Account number and broker are required');
    }

    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    const session = {
      id: sessionId,
      broker,
      accountNumber,
      accountMode,
      equity: Number(equity) || 0,
      balance: Number(balance) || 0,
      server,
      currency,
      ea: payload?.ea || null,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      isActive: true,
      tradesExecuted: 0,
      profitLoss: 0
    };

    this.sessions.set(sessionId, session);

    this.logger.info({ sessionId, broker, accountMode, accountNumber }, 'EA session registered');

    return {
      success: true,
      sessionId,
      message: 'Session registered successfully',
      intelligentFeatures: {
        dynamicStopLoss: true,
        adaptiveRisk: true,
        learningEnabled: true
      }
    };
  }

  /**
   * Disconnect EA session
   */
  disconnectSession(payload) {
    const { accountNumber, accountMode, broker } = payload;
    const sessionId = `${broker}-${accountMode}-${accountNumber}`;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.disconnectedAt = Date.now();
      this.sessions.delete(sessionId);

      this.logger.info({ sessionId }, 'EA session disconnected');
      return { success: true, message: 'Session disconnected' };
    }

    return { success: false, message: 'Session not found' };
  }

  /**
   * Handle heartbeat from EA
   */
  handleHeartbeat(payload) {
    const { accountNumber, accountMode, broker, equity, balance, timestamp: _timestamp } = payload;
    const sessionId = `${broker}-${accountMode}-${accountNumber}`;

    let session = this.sessions.get(sessionId);
    if (!session) {
      // Some EA builds send heartbeats before calling /session/connect.
      // Auto-register to keep sessions/diagnostics consistent and unblock downstream logic.
      try {
        const connectResult = this.registerSession(payload);
        if (connectResult?.success) {
          session = this.sessions.get(sessionId) || null;
        }
      } catch (_error) {
        // fall through
      }
    }
    if (!session) {
      return { success: false, message: 'Session not found. Please reconnect.' };
    }

    session.lastHeartbeat = Date.now();
    session.equity = Number(equity) || session.equity;
    if (balance !== undefined) {
      session.balance = Number(balance) || session.balance;
    }

    return {
      success: true,
      instructions: this.getIntelligentInstructions(session)
    };
  }

  /**
   * Get intelligent trading instructions based on current performance
   */
  getIntelligentInstructions(session) {
    return {
      riskMultiplier: this.riskAdjustmentFactor,
      stopLossMultiplier: this.stopLossAdjustmentFactor,
      tradingEnabled: this.shouldEnableTrading(),
      maxPositionSize: this.calculateMaxPositionSize(session),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Handle trade transaction from EA
   */
  async handleTransaction(payload) {
    const {
      type,
      order,
      deal,
      symbol,
      volume,
      price,
      profit,
      timestamp,
      accountNumber,
      accountMode,
      broker
    } = payload;

    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    // Record transaction
    const transaction = {
      id: `${broker}-${deal || order}-${Date.now()}`,
      type,
      order: Number(order) || 0,
      deal: Number(deal) || 0,
      symbol,
      volume: Number(volume) || 0,
      price: Number(price) || 0,
      profit: Number(profit) || 0,
      timestamp: Number(timestamp) || Date.now(),
      broker,
      accountNumber,
      receivedAt: Date.now()
    };

    // Learn from completed trades
    if (type === 'HISTORY_ADD' || type === 'DEAL_ADD') {
      this.learnFromTrade(transaction);
      session.tradesExecuted += 1;
      session.profitLoss += transaction.profit;
    }

    this.logger.info(
      { sessionId, type, symbol, profit: transaction.profit },
      'EA transaction received'
    );

    return {
      success: true,
      message: 'Transaction recorded',
      learning: {
        currentWinRate: this.winRate.toFixed(3),
        consecutiveLosses: this.consecutiveLosses,
        consecutiveWins: this.consecutiveWins,
        riskAdjustment: this.riskAdjustmentFactor.toFixed(2),
        stopLossAdjustment: this.stopLossAdjustmentFactor.toFixed(2)
      }
    };
  }

  /**
   * Learn from trade results
   */
  learnFromTrade(transaction) {
    const { profit, volume } = transaction;

    // Add to history
    this.tradeHistory.push({
      profit,
      volume,
      timestamp: transaction.timestamp,
      symbol: transaction.symbol
    });

    // Keep history bounded
    if (this.tradeHistory.length > this.maxHistorySize) {
      this.tradeHistory.shift();
    }

    // Update consecutive counters
    if (profit > 0) {
      this.consecutiveWins += 1;
      this.consecutiveLosses = 0;
    } else if (profit < 0) {
      this.consecutiveLosses += 1;
      this.consecutiveWins = 0;
    }

    // Recalculate statistics
    this.updateLearningParameters();

    // Adjust risk based on performance
    this.adjustRiskParameters();
  }

  /**
   * Update learning parameters based on trade history
   */
  updateLearningParameters() {
    if (this.tradeHistory.length === 0) {
      return;
    }

    const wins = this.tradeHistory.filter((t) => t.profit > 0);
    const losses = this.tradeHistory.filter((t) => t.profit < 0);

    // Update win rate
    this.winRate = wins.length / this.tradeHistory.length;

    // Update average profit/loss
    if (wins.length > 0) {
      this.avgProfit = wins.reduce((sum, t) => sum + t.profit, 0) / wins.length;
    }
    if (losses.length > 0) {
      this.avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0) / losses.length);
    }
  }

  /**
   * Adjust risk parameters based on recent performance
   */
  adjustRiskParameters() {
    // Reduce risk after consecutive losses
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      this.riskAdjustmentFactor = Math.max(0.5, this.riskAdjustmentFactor * 0.8);
      this.logger.warn(
        { consecutiveLosses: this.consecutiveLosses, newFactor: this.riskAdjustmentFactor },
        'Risk reduced due to consecutive losses'
      );
    }
    // Gradually increase risk after consecutive wins
    else if (this.consecutiveWins >= 3) {
      this.riskAdjustmentFactor = Math.min(1.5, this.riskAdjustmentFactor * 1.1);
    }
    // Return to normal
    else if (this.consecutiveLosses === 0 && this.consecutiveWins === 0) {
      this.riskAdjustmentFactor = this.riskAdjustmentFactor * 0.95 + 1.0 * 0.05; // Slowly return to 1.0
    }

    // Adjust stop-loss based on win rate
    if (this.winRate < 0.4) {
      // Tighter stop-loss when losing
      this.stopLossAdjustmentFactor = Math.max(0.7, this.stopLossAdjustmentFactor * 0.95);
    } else if (this.winRate > 0.6) {
      // Wider stop-loss when winning (let profits run)
      this.stopLossAdjustmentFactor = Math.min(1.3, this.stopLossAdjustmentFactor * 1.05);
    }
  }

  /**
   * Determine if trading should be enabled
   */
  shouldEnableTrading() {
    // Disable if too many consecutive losses
    if (this.consecutiveLosses >= this.maxConsecutiveLosses * 2) {
      return false;
    }
    return true;
  }

  /**
   * Calculate maximum position size based on session and performance
   */
  calculateMaxPositionSize(session) {
    const baseSize = (session.equity || 10000) * 0.02; // 2% of equity
    return baseSize * this.riskAdjustmentFactor;
  }

  /**
   * Generate recommendations based on learning
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.consecutiveLosses >= 2) {
      recommendations.push('Consider reducing position sizes');
    }
    if (this.winRate < 0.4) {
      recommendations.push('Review trading strategy - win rate below 40%');
    }
    if (this.avgLoss > this.avgProfit * 2) {
      recommendations.push('Average loss exceeds average profit - tighten stop-loss');
    }
    if (this.consecutiveWins >= 5) {
      recommendations.push('Strong performance - consider gradual risk increase');
    }

    return recommendations;
  }

  /**
   * Get signal for EA to execute
   */
  async getSignalForExecution(payload) {
    const { symbol, broker: _broker, accountMode: _accountMode } = payload;

    try {
      const broker = this.normalizeBroker(payload?.broker) || null;
      const requested = this.normalizeSymbol(symbol);
      if (!requested) {
        return { success: false, message: 'Symbol is required', signal: null };
      }

      const pair = broker ? this.resolveSymbolFromQuotes(broker, requested) : requested;

      const envQuoteMaxAgeMs = Number(process.env.EA_SIGNAL_QUOTE_MAX_AGE_MS);
      const quoteMaxAgeMs = Number.isFinite(envQuoteMaxAgeMs)
        ? Math.max(1_000, envQuoteMaxAgeMs)
        : 120 * 1000;

      // Require EA realtime context (quote + snapshot) for strong signals.
      const quote = broker
        ? this.getQuotes({ broker, symbols: [pair], maxAgeMs: quoteMaxAgeMs })?.[0] || null
        : null;
      if (!quote) {
        return {
          success: false,
          message: 'No recent EA quote available',
          signal: null
        };
      }

      const snapshot = broker
        ? this.getMarketSnapshot({ broker, symbol: pair, maxAgeMs: 2 * 60 * 1000 })
        : null;
      let snapshotPending = false;
      if (!snapshot && broker) {
        snapshotPending = true;
        this.requestMarketSnapshot({ broker, symbol: pair, ttlMs: 2 * 60 * 1000 });

        // If we already have enough bar history, proceed anyway so the EA can keep operating.
        // This avoids a hard deadlock when snapshot polling is delayed.
        const envTimeframes = String(process.env.EA_SIGNAL_BARS_READY_TIMEFRAMES || '').trim();
        const timeframes = envTimeframes
          ? envTimeframes
              .split(',')
              .map((t) =>
                String(t || '')
                  .trim()
                  .toUpperCase()
              )
              .filter(Boolean)
          : ['M15', 'M1'];

        const envMinBars = Number(process.env.EA_SIGNAL_MIN_BARS);
        const requiredBars = Number.isFinite(envMinBars) ? Math.max(1, envMinBars) : 60;

        const envLimit = Number(process.env.EA_SIGNAL_BARS_LIMIT);
        const limit = Number.isFinite(envLimit) ? Math.max(1, envLimit) : 120;

        const envBarsMaxAgeMs = Number(process.env.EA_SIGNAL_BARS_MAX_AGE_MS);
        const barsMaxAgeMs = Number.isFinite(envBarsMaxAgeMs) ? Math.max(0, envBarsMaxAgeMs) : 0;

        let barsReady = false;
        const barsByTimeframe = {};
        try {
          for (const timeframe of timeframes) {
            const bars = this.getMarketBars({
              broker,
              symbol: pair,
              timeframe,
              limit,
              maxAgeMs: barsMaxAgeMs
            });
            const count = Array.isArray(bars) ? bars.length : 0;
            barsByTimeframe[timeframe] = count;
            if (count >= requiredBars) {
              barsReady = true;
              break;
            }
          }
        } catch (_error) {
          barsReady = false;
        }

        if (!barsReady) {
          return {
            success: false,
            message: 'EA snapshot pending (requested)',
            signal: null,
            snapshotPending: true,
            details: {
              requiredBars,
              checkedTimeframes: timeframes,
              barsByTimeframe
            }
          };
        }
      }

      // Canonical pipeline: use the same analysis snapshot as the dashboard.
      // This keeps the EA execution decision aligned with what the Price Bar analyzer shows.
      const analysis = await this.getAnalysisSnapshot({
        broker,
        symbol: pair,
        accountMode: payload?.accountMode
      });

      const signal = analysis?.signal || null;

      if (!signal) {
        return {
          success: false,
          message: analysis?.message || 'No signal available',
          signal: null
        };
      }

      const expiresAt = Number(signal?.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
        return {
          success: false,
          message: 'Signal expired',
          signal: null
        };
      }

      // Strong-signal gating (avoid noisy weak signals)
      // Defaults align with smart+strong policy; can be tuned via env vars.
      const envMinConfidence = Number(process.env.EA_SIGNAL_MIN_CONFIDENCE);
      const envMinStrength = Number(process.env.EA_SIGNAL_MIN_STRENGTH);

      const config = this.tradingEngine?.config || {};
      const autoTradingConfig = config.autoTrading || {};

      const envLayers18MinConfluence = Number(process.env.EA_SIGNAL_LAYERS18_MIN_CONFLUENCE);
      const layers18MinConfluence = Number.isFinite(
        Number(autoTradingConfig.realtimeLayers18MinConfluence)
      )
        ? Number(autoTradingConfig.realtimeLayers18MinConfluence)
        : Number.isFinite(envLayers18MinConfluence)
          ? Math.max(0, Math.min(100, envLayers18MinConfluence))
          : 30;

      const minConfidence = Number.isFinite(Number(autoTradingConfig.realtimeMinConfidence))
        ? Number(autoTradingConfig.realtimeMinConfidence)
        : Number.isFinite(envMinConfidence)
          ? envMinConfidence
          : 45;

      const minStrength = Number.isFinite(Number(autoTradingConfig.realtimeMinStrength))
        ? Number(autoTradingConfig.realtimeMinStrength)
        : Number.isFinite(envMinStrength)
          ? envMinStrength
          : 35;

      // Require the canonical 18-layer payload to be present/ready before executing.
      const requireLayers18 = autoTradingConfig.realtimeRequireLayers18 !== false;

      const confidence = Number(signal.confidence) || 0;
      const strength = Number(signal.strength) || 0;
      const direction = String(signal.direction || '').toUpperCase();
      const decisionState = signal?.isValid?.decision?.state || null;

      const isEnter = decisionState === 'ENTER' && Boolean(signal?.isValid?.isValid);

      const adjustedSignal = this.adjustSignalWithLearning(signal);

      let layersStatus = null;
      if (requireLayers18) {
        const computedLayersStatus = evaluateLayers18Readiness({
          layeredAnalysis: adjustedSignal?.components?.layeredAnalysis,
          minConfluence: layers18MinConfluence,
          decisionStateFallback: decisionState
        });
        layersStatus = computedLayersStatus;

        if (!computedLayersStatus.ok) {
          // Keep WAIT_MONITOR visible (for UI/EA logging) but never executable.
          if (decisionState === 'WAIT_MONITOR') {
            return {
              success: true,
              message: 'Signal is monitoring (not executable yet)',
              signal: adjustedSignal,
              snapshotPending,
              shouldExecute: false,
              execution: {
                shouldExecute: false,
                riskMultiplier: this.riskAdjustmentFactor,
                stopLossMultiplier: this.stopLossAdjustmentFactor,
                gates: {
                  tradingEnabled: this.shouldEnableTrading(),
                  requireLayers18,
                  layersStatus: computedLayersStatus,
                  decisionState,
                  minConfluence: layers18MinConfluence,
                  minConfidence,
                  minStrength,
                  confidence,
                  strength
                }
              }
            };
          }
          return {
            success: true,
            message: 'Signal missing/failed 18-layer readiness',
            signal: adjustedSignal,
            snapshotPending,
            shouldExecute: false,
            execution: {
              shouldExecute: false,
              riskMultiplier: this.riskAdjustmentFactor,
              stopLossMultiplier: this.stopLossAdjustmentFactor,
              gates: {
                requireLayers18,
                layersStatus: computedLayersStatus,
                decisionState,
                minConfluence: layers18MinConfluence,
                minConfidence,
                minStrength
              }
            }
          };
        }
      }

      if (decisionState && !isEnter) {
        return {
          success: true,
          message: 'Signal is blocked',
          signal: adjustedSignal,
          snapshotPending,
          shouldExecute: false,
          execution: {
            shouldExecute: false,
            riskMultiplier: this.riskAdjustmentFactor,
            stopLossMultiplier: this.stopLossAdjustmentFactor
          }
        };
      }

      if (direction !== 'BUY' && direction !== 'SELL') {
        return {
          success: false,
          message: 'Signal is neutral',
          signal: null
        };
      }

      // Flatten shouldExecute so the EA can parse it easily.
      // Only allow execution when the signal is a trade-valid ENTER *and* the strength/confidence floor is met.
      const tradingEnabled = this.shouldEnableTrading();
      const passesStrengthFloor = confidence >= minConfidence && strength >= minStrength;
      const shouldExecuteNow = tradingEnabled && passesStrengthFloor && isEnter;

      if (!passesStrengthFloor) {
        return {
          success: true,
          message: 'Signal is not strong enough',
          signal: adjustedSignal,
          snapshotPending,
          shouldExecute: false,
          execution: {
            shouldExecute: false,
            riskMultiplier: this.riskAdjustmentFactor,
            stopLossMultiplier: this.stopLossAdjustmentFactor,
            gates: {
              tradingEnabled,
              decisionState,
              isEnter,
              minConfidence,
              minStrength,
              confidence,
              strength,
              passesStrengthFloor,
              layersStatus
            }
          }
        };
      }

      return {
        success: true,
        signal: adjustedSignal,
        snapshotPending,
        shouldExecute: shouldExecuteNow,
        execution: {
          shouldExecute: shouldExecuteNow,
          riskMultiplier: this.riskAdjustmentFactor,
          stopLossMultiplier: this.stopLossAdjustmentFactor,
          gates: {
            tradingEnabled,
            decisionState,
            isEnter,
            minConfidence,
            minStrength,
            confidence,
            strength,
            passesStrengthFloor,
            layersStatus
          }
        }
      };
    } catch (error) {
      this.logger.error({ err: error, symbol }, 'Error getting signal for EA');
      return {
        success: false,
        message: error.message,
        signal: null
      };
    }
  }

  /**
   * Get full analysis snapshot for dashboards (returns signal even if not trade-valid).
   */
  async getAnalysisSnapshot(payload) {
    const broker = this.normalizeBroker(payload?.broker) || null;
    const requested = this.normalizeSymbol(payload?.symbol);

    if (!requested) {
      return { success: false, message: 'Symbol is required', signal: null };
    }

    if (this.restrictSymbols && !this.isAllowedAssetSymbol(requested)) {
      return {
        success: false,
        message: 'Symbol not allowed (FX/metals/crypto only)',
        signal: null
      };
    }

    const symbol = broker ? this.resolveSymbolFromQuotes(broker, requested) : requested;

    if (broker && symbol) {
      this.touchActiveSymbol({ broker, symbol, ttlMs: 15 * 60 * 1000 });
    }

    const now = Date.now();

    const hydrateTechnicalFromSnapshot = (signal, snapshot) => {
      if (!signal || typeof signal !== 'object' || !snapshot || typeof snapshot !== 'object') {
        return signal;
      }

      const frames =
        snapshot.timeframes && typeof snapshot.timeframes === 'object' ? snapshot.timeframes : null;
      if (!frames) {
        return signal;
      }

      // Always ensure the dashboard-facing structure exists.
      // The UI expects: signal.components.technical.timeframes (or .technical.details.timeframes).
      const originalComponents =
        signal.components && typeof signal.components === 'object' ? signal.components : {};
      const originalTechnical =
        originalComponents.technical && typeof originalComponents.technical === 'object'
          ? originalComponents.technical
          : {};

      const originalTimeframes =
        originalTechnical.timeframes && typeof originalTechnical.timeframes === 'object'
          ? originalTechnical.timeframes
          : {};

      const nextTimeframes = { ...originalTimeframes };

      const toTf = (value) =>
        String(value || '')
          .trim()
          .toUpperCase();
      const targetTfs = ['M15', 'H1', 'H4', 'D1'];

      for (const tf of targetTfs) {
        const frame = frames[tf] || frames[tf.toLowerCase()] || null;
        if (!frame || typeof frame !== 'object') {
          continue;
        }

        const current =
          nextTimeframes[tf] && typeof nextTimeframes[tf] === 'object'
            ? nextTimeframes[tf]
            : { timeframe: tf };
        const currentIndicators =
          current.indicators && typeof current.indicators === 'object' ? current.indicators : {};
        const hasRsi = Boolean(
          currentIndicators?.rsi && Number.isFinite(Number(currentIndicators.rsi.value))
        );
        const hasMacd = Boolean(
          currentIndicators?.macd && Number.isFinite(Number(currentIndicators.macd.histogram))
        );
        const hasAtr = Boolean(
          currentIndicators?.atr && Number.isFinite(Number(currentIndicators.atr.value))
        );

        const incomingIndicators =
          frame.indicators && typeof frame.indicators === 'object' ? frame.indicators : null;
        const incomingRanges =
          frame.ranges && typeof frame.ranges === 'object' ? frame.ranges : null;
        const incomingPivots =
          frame.pivotPoints && typeof frame.pivotPoints === 'object' ? frame.pivotPoints : null;

        nextTimeframes[tf] = {
          ...current,
          timeframe: toTf(current.timeframe || tf),
          direction: String(frame.direction || current.direction || 'NEUTRAL').toUpperCase(),
          score: Number.isFinite(Number(frame.score))
            ? Number(frame.score)
            : Number(current.score) || 0,
          lastPrice: Number.isFinite(Number(frame.lastPrice))
            ? Number(frame.lastPrice)
            : current.lastPrice,
          latestCandle:
            frame.latestCandle && typeof frame.latestCandle === 'object'
              ? frame.latestCandle
              : current.latestCandle,
          indicators:
            hasRsi || hasMacd || hasAtr
              ? currentIndicators
              : incomingIndicators && typeof incomingIndicators === 'object'
                ? incomingIndicators
                : currentIndicators,
          ranges: current.ranges || incomingRanges || null,
          pivotPoints: current.pivotPoints || incomingPivots || null
        };
      }

      return {
        ...signal,
        components: {
          ...originalComponents,
          technical: {
            ...originalTechnical,
            timeframes: nextTimeframes
          }
        }
      };
    };

    const bestEffortBarFallback = () => {
      if (!broker || !symbol) {
        return null;
      }
      try {
        const bars = this.getMarketBars({
          broker,
          symbol,
          timeframe: 'M1',
          limit: 2,
          maxAgeMs: 0
        });
        const latest = Array.isArray(bars) && bars.length ? bars[0] : null;
        const prev = Array.isArray(bars) && bars.length > 1 ? bars[1] : null;
        if (!latest || typeof latest !== 'object') {
          return null;
        }

        const close = latest.close ?? latest.c ?? null;
        const open = latest.open ?? latest.o ?? null;
        const volume = latest.volume ?? latest.v ?? null;
        const timeMs = latest.time ?? latest.timestamp ?? latest.t ?? null;
        return {
          timeframe: 'M1',
          price: close != null ? Number(close) : null,
          open: open != null ? Number(open) : null,
          volume: volume != null ? Number(volume) : null,
          timeMs: timeMs != null ? Number(timeMs) : null,
          prevClose: prev && typeof prev === 'object' ? (prev.close ?? prev.c ?? null) : null
        };
      } catch (_error) {
        return null;
      }
    };

    try {
      // If the EA snapshot exists but is older than the strict freshness window,
      // keep using it for dashboard display while requesting a fresh snapshot.
      const snapshotFreshMaxAgeMs = 5 * 60 * 1000;
      const snapshotDisplayMaxAgeMs = 30 * 60 * 1000;

      const freshSnapshot = broker
        ? this.getMarketSnapshot({ broker, symbol, maxAgeMs: snapshotFreshMaxAgeMs })
        : null;

      let snapshotForHydration = freshSnapshot;
      if (!snapshotForHydration && broker) {
        snapshotForHydration = this.getMarketSnapshot({
          broker,
          symbol,
          maxAgeMs: snapshotDisplayMaxAgeMs
        });

        // Best-effort: ask the EA for a new snapshot so future analysis is fully fresh.
        try {
          this.requestMarketSnapshot({ broker, symbol, ttlMs: 2 * 60 * 1000 });
        } catch (_error) {
          // ignore
        }
      }

      const signal = await this.tradingEngine?.generateSignal(
        symbol,
        broker
          ? { broker, eaOnly: true, eaBridgeService: this }
          : { eaOnly: true, eaBridgeService: this }
      );

      const hydratedSignal = snapshotForHydration
        ? hydrateTechnicalFromSnapshot(signal, snapshotForHydration)
        : signal;

      // Dashboard wants a mutable signal so we can attach layered explainability.
      // Some upstream signals may be immutable (frozen), so clone shallowly.
      const dashboardSignal =
        hydratedSignal && typeof hydratedSignal === 'object'
          ? {
              ...hydratedSignal,
              components:
                hydratedSignal.components && typeof hydratedSignal.components === 'object'
                  ? { ...hydratedSignal.components }
                  : {}
            }
          : hydratedSignal;
      const isTradeValid = Boolean(signal?.isValid?.isValid);

      // Always attach the canonical 18-layer explainability payload for the dashboard.
      // This is best-effort and uses EA quote + M1 bars to enrich Layer 1 (raw market physics).
      try {
        attachLayeredAnalysisToSignal({
          rawSignal: dashboardSignal,
          broker,
          symbol,
          eaBridgeService: this,
          quoteMaxAgeMs: 30 * 1000,
          barFallback: bestEffortBarFallback(),
          now
        });
      } catch (_error) {
        // best-effort
      }

      return {
        success: true,
        message: isTradeValid ? 'OK' : 'Signal not valid for trading (showing analysis only)',
        signal: dashboardSignal || null,
        tradeValid: isTradeValid
      };
    } catch (error) {
      this.logger.error({ err: error, symbol, broker }, 'Error getting analysis snapshot');
      return {
        success: false,
        message: error?.message || 'Failed to generate analysis',
        signal: null
      };
    }
  }

  /**
   * Adjust signal parameters based on learning
   */
  adjustSignalWithLearning(signal) {
    return {
      ...signal,
      adjustedRisk: (signal.risk || 0.02) * this.riskAdjustmentFactor,
      adjustedStopLoss: signal.stopLoss ? signal.stopLoss * this.stopLossAdjustmentFactor : null,
      learningMetrics: {
        winRate: this.winRate,
        riskFactor: this.riskAdjustmentFactor,
        stopLossFactor: this.stopLossAdjustmentFactor
      }
    };
  }

  /**
   * Get bridge statistics
   */
  getStatistics() {
    const activeSessions = Array.from(this.sessions.values()).filter((s) => s.isActive);

    const quoteCountsByBroker = {};
    for (const quote of this.latestQuotes.values()) {
      quoteCountsByBroker[quote.broker] = (quoteCountsByBroker[quote.broker] || 0) + 1;
    }

    const newsCountsByBroker = {};
    for (const [broker, timeline] of this.newsTimeline.entries()) {
      newsCountsByBroker[broker] = Array.isArray(timeline) ? timeline.length : 0;
    }

    const snapshotCountsByBroker = {};
    for (const snapshot of this.latestSnapshots.values()) {
      if (!snapshot?.broker) {
        continue;
      }
      snapshotCountsByBroker[snapshot.broker] = (snapshotCountsByBroker[snapshot.broker] || 0) + 1;
    }

    const barsSeriesCountsByBroker = {};
    let totalBarsStored = 0;
    for (const [key, series] of this.latestBars.entries()) {
      if (typeof key === 'string') {
        const broker = key.split(':')[0];
        if (broker) {
          barsSeriesCountsByBroker[broker] = (barsSeriesCountsByBroker[broker] || 0) + 1;
        }
      }
      if (Array.isArray(series)) {
        totalBarsStored += series.length;
      }
    }

    const activeSymbolsByBroker = {};
    for (const [broker, map] of this.activeSymbols.entries()) {
      activeSymbolsByBroker[broker] = map?.size || 0;
    }

    return {
      activeSessions: activeSessions.length,
      totalTradesExecuted: activeSessions.reduce((sum, s) => sum + s.tradesExecuted, 0),
      totalProfitLoss: activeSessions.reduce((sum, s) => sum + s.profitLoss, 0),
      marketFeed: {
        quotes: {
          total: this.latestQuotes.size,
          byBroker: quoteCountsByBroker
        },
        news: {
          total: this.latestNews.size,
          byBroker: newsCountsByBroker
        },
        snapshots: {
          total: this.latestSnapshots.size,
          byBroker: snapshotCountsByBroker
        },
        bars: {
          series: this.latestBars.size,
          totalBars: totalBarsStored,
          seriesByBroker: barsSeriesCountsByBroker
        },
        activeSymbols: {
          brokers: this.activeSymbols.size,
          byBroker: activeSymbolsByBroker
        },
        snapshotRequests: {
          brokers: this.snapshotRequests.size,
          inflight: this.snapshotInflight.size
        }
      },
      learning: {
        winRate: this.winRate,
        tradeHistorySize: this.tradeHistory.length,
        consecutiveLosses: this.consecutiveLosses,
        consecutiveWins: this.consecutiveWins,
        riskAdjustment: this.riskAdjustmentFactor,
        stopLossAdjustment: this.stopLossAdjustmentFactor,
        avgProfit: this.avgProfit,
        avgLoss: this.avgLoss
      },
      sessions: activeSessions.map((s) => ({
        id: s.id,
        broker: s.broker,
        accountNumber: s.accountNumber,
        accountMode: s.accountMode,
        server: s.server,
        currency: s.currency,
        equity: s.equity,
        balance: s.balance,
        tradesExecuted: s.tradesExecuted,
        profitLoss: s.profitLoss,
        connectedAt: s.connectedAt,
        lastHeartbeat: s.lastHeartbeat
      }))
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.isActive);
  }

  /**
   * True when the EA is connected and sending heartbeats recently.
   * Used to prevent generating signals before MT4/MT5 is actually connected.
   */
  listKnownSymbols(options = {}) {
    const broker = this.normalizeBroker(options.broker) || null;
    if (!broker) {
      return [];
    }
    const max = Number.isFinite(Number(options.max)) ? Math.max(1, Number(options.max)) : 2000;
    const maxAgeMs =
      options.maxAgeMs == null
        ? null
        : Number.isFinite(Number(options.maxAgeMs))
          ? Math.max(0, Number(options.maxAgeMs))
          : null;
    const now = Date.now();

    const symbols = new Set();

    const acceptIfFresh = (receivedAt) => {
      if (maxAgeMs == null) {
        return true;
      }
      const t = Number(receivedAt || 0);
      return t > 0 && now - t <= maxAgeMs;
    };

    // EA-registered symbol universe (if provided)
    try {
      const registered = this.registeredSymbols.get(broker);
      if (registered && registered.size > 0) {
        for (const [sym, receivedAt] of registered.entries()) {
          if (!acceptIfFresh(receivedAt)) {
            continue;
          }
          const normalized = this.normalizeSymbol(sym);
          if (normalized) {
            symbols.add(normalized);
          }
          if (symbols.size >= max) {
            break;
          }
        }
      }
    } catch (_error) {
      // best-effort
    }

    // Quotes
    for (const [key, quote] of this.latestQuotes.entries()) {
      if (!key || !quote) {
        continue;
      }
      if (symbols.size >= max) {
        break;
      }
      if (!String(key).toLowerCase().startsWith(`${broker}:`)) {
        continue;
      }
      if (!acceptIfFresh(quote.receivedAt ?? quote.timestamp)) {
        continue;
      }
      const sym = this.normalizeSymbol(quote.symbol || quote.pair);
      if (sym) {
        symbols.add(sym);
      }
    }

    // Snapshots
    if (symbols.size < max) {
      for (const [key, snapshot] of this.latestSnapshots.entries()) {
        if (!key || !snapshot) {
          continue;
        }
        if (!String(key).toLowerCase().startsWith(`${broker}:`)) {
          continue;
        }
        if (!acceptIfFresh(snapshot.receivedAt ?? snapshot.timestamp)) {
          continue;
        }
        const sym = this.normalizeSymbol(snapshot.symbol || snapshot.pair);
        if (sym) {
          symbols.add(sym);
        }
        if (symbols.size >= max) {
          break;
        }
      }
    }

    // Bars
    if (symbols.size < max) {
      for (const [key, bars] of this.latestBars.entries()) {
        if (!key || !bars) {
          continue;
        }
        if (!String(key).toLowerCase().startsWith(`${broker}:`)) {
          continue;
        }
        const list = Array.isArray(bars) ? bars : [];
        const newest = list[0] || null;
        const receivedAt = newest?.receivedAt ?? newest?.timestamp ?? newest?.time ?? newest?.t;
        if (!acceptIfFresh(receivedAt)) {
          continue;
        }

        // key format: broker:symbol:timeframe
        const parts = String(key).split(':');
        const sym = this.normalizeSymbol(parts[1]);
        if (sym) {
          symbols.add(sym);
        }
        if (symbols.size >= max) {
          break;
        }
      }
    }

    return Array.from(symbols);
  }

  isBrokerConnected(options = {}) {
    const broker = this.normalizeBroker(options.broker) || null;
    if (!broker) {
      return false;
    }

    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
      ? Math.max(0, Number(options.maxAgeMs))
      : 2 * 60 * 1000;
    const now = Date.now();

    const hasFreshHeartbeat = this.getActiveSessions().some((session) => {
      if (!session || this.normalizeBroker(session.broker) !== broker) {
        return false;
      }
      if (!maxAgeMs) {
        return true;
      }
      const last = Number(session.lastHeartbeat || 0);
      return last > 0 && now - last <= maxAgeMs;
    });

    if (hasFreshHeartbeat) {
      return true;
    }

    // Some EA builds stream quotes before (or without) registering sessions.
    // Treat a fresh quote feed as a connected bridge.
    const quotes = this.getQuotes({ broker, maxAgeMs });
    return Array.isArray(quotes) && quotes.length > 0;
  }
}

export default EaBridgeService;
