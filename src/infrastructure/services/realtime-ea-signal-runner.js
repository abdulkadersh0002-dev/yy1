import { createTradingSignalDTO, validateTradingSignalDTO } from '../../contracts/dtos.js';
import { attachLayeredAnalysisToSignal, evaluateLayers18Readiness } from './ea-signal-pipeline.js';
import {
  extractBaseSymbol,
  isSaneEaSymbolToken,
  normalizeBroker,
  normalizeSymbol,
} from '../../utils/ea-symbols.js';

const computeMidFromQuote = (quote) => {
  if (!quote || typeof quote !== 'object') {
    return null;
  }
  const bid = quote.bid != null ? Number(quote.bid) : null;
  const ask = quote.ask != null ? Number(quote.ask) : null;
  const last = quote.last != null ? Number(quote.last) : null;

  const bidOk = Number.isFinite(bid);
  const askOk = Number.isFinite(ask);

  if (bidOk && askOk) {
    return (bid + ask) / 2;
  }
  if (bidOk) {
    return bid;
  }
  if (askOk) {
    return ask;
  }
  if (Number.isFinite(last)) {
    return last;
  }
  return null;
};

const toEpochMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
};

const isStrictEaSymbolFilterEnabled = () => {
  const raw = String(process.env.EA_STRICT_SYMBOL_FILTER || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

export class RealtimeEaSignalRunner {
  constructor(options = {}) {
    this.tradingEngine = options.tradingEngine;
    this.eaBridgeService = options.eaBridgeService;
    this.broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
    this.onSignal = typeof options.onSignal === 'function' ? options.onSignal : null;
    this.logger = options.logger;

    // Throttling / batching
    this.debounceMs = Number.isFinite(Number(options.debounceMs))
      ? Number(options.debounceMs)
      : 250;
    this.minIntervalMs = Number.isFinite(Number(options.minIntervalMs))
      ? Number(options.minIntervalMs)
      : 5000;

    this.maxSymbolsPerFlush = Number.isFinite(Number(options.maxSymbolsPerFlush))
      ? Math.max(1, Math.trunc(Number(options.maxSymbolsPerFlush)))
      : 30;

    this.maxSnapshotRequestsPerFlush = Number.isFinite(Number(options.maxSnapshotRequestsPerFlush))
      ? Math.max(0, Math.trunc(Number(options.maxSnapshotRequestsPerFlush)))
      : 10;

    // Periodic revalidation ("living signals")
    const envRevalidateMs = Number(process.env.EA_SIGNAL_REVALIDATE_INTERVAL_MS);
    this.revalidateIntervalMs = Number.isFinite(Number(options.revalidateIntervalMs))
      ? Math.max(10_000, Number(options.revalidateIntervalMs))
      : Number.isFinite(envRevalidateMs)
        ? Math.max(10_000, envRevalidateMs)
        : 60 * 1000;

    const envRevalidateEnabled = String(process.env.EA_SIGNAL_REVALIDATION_ENABLED || '')
      .trim()
      .toLowerCase();
    this.revalidationEnabled =
      typeof options.revalidationEnabled === 'boolean'
        ? options.revalidationEnabled
        : envRevalidateEnabled === '0' ||
            envRevalidateEnabled === 'false' ||
            envRevalidateEnabled === 'no'
          ? false
          : true;

    this.revalidateTimer = null;
    this.lastRevalidatedAt = new Map(); // key -> timestamp

    // Data freshness
    const envDashQuoteMaxAgeMs = Number(process.env.EA_DASHBOARD_QUOTE_MAX_AGE_MS);
    this.quoteMaxAgeMs = Number.isFinite(Number(options.quoteMaxAgeMs))
      ? Number(options.quoteMaxAgeMs)
      : Number.isFinite(envDashQuoteMaxAgeMs)
        ? Math.max(0, envDashQuoteMaxAgeMs)
        : 30 * 1000;
    this.snapshotMaxAgeMs = Number.isFinite(Number(options.snapshotMaxAgeMs))
      ? Number(options.snapshotMaxAgeMs)
      : 5 * 60 * 1000;
    this.snapshotRequestTtlMs = Number.isFinite(Number(options.snapshotRequestTtlMs))
      ? Number(options.snapshotRequestTtlMs)
      : 2 * 60 * 1000;

    // Strong-signal gating
    const envMinConfidence = Number(process.env.EA_SIGNAL_MIN_CONFIDENCE);
    const envMinStrength = Number(process.env.EA_SIGNAL_MIN_STRENGTH);

    // Dashboard gating can be more permissive than EA execution.
    // This only affects what is *broadcast* to the dashboard, not what is auto-traded.
    const envDashMinConfidence = Number(process.env.EA_DASHBOARD_SIGNAL_MIN_CONFIDENCE);
    const envDashMinStrength = Number(process.env.EA_DASHBOARD_SIGNAL_MIN_STRENGTH);

    // Dashboard publish policy.
    // Note: for dev visibility (EA_DASHBOARD_ALLOW_CANDIDATES), we avoid blocking on snapshots/bars
    // unless explicitly required by env.
    const envRequireSnapshotRaw = String(process.env.EA_DASHBOARD_REQUIRE_SNAPSHOT || '');
    const envRequireSnapshot = envRequireSnapshotRaw.trim().toLowerCase();
    const envRequireBarsRaw = String(process.env.EA_DASHBOARD_REQUIRE_BARS || '');
    const envRequireBars = envRequireBarsRaw.trim().toLowerCase();
    const envRequireConfluence = String(process.env.EA_DASHBOARD_REQUIRE_CONFLUENCE || '')
      .trim()
      .toLowerCase();
    const envRequireEnter = String(process.env.EA_DASHBOARD_REQUIRE_ENTER || '')
      .trim()
      .toLowerCase();
    const envRequireLayers18 = String(process.env.EA_DASHBOARD_REQUIRE_LAYERS18 || '')
      .trim()
      .toLowerCase();

    const envLayers18MinConfluence = Number(process.env.EA_DASHBOARD_LAYERS18_MIN_CONFLUENCE);

    const envAllowCandidates = String(process.env.EA_DASHBOARD_ALLOW_CANDIDATES || '')
      .trim()
      .toLowerCase();

    const eaOnlyMode =
      String(process.env.EA_ONLY_MODE || '')
        .trim()
        .toLowerCase() === 'true';

    const nodeEnv = String(process.env.NODE_ENV || '')
      .trim()
      .toLowerCase();
    const isNonProd = nodeEnv !== 'production';

    const envSmartStrong = String(process.env.EA_SMART_STRONG || '')
      .trim()
      .toLowerCase();
    const smartStrong =
      typeof options.smartStrong === 'boolean'
        ? options.smartStrong
        : envSmartStrong === '1' || envSmartStrong === 'true' || envSmartStrong === 'yes'
          ? true
          : eaOnlyMode;
    this.smartStrong = smartStrong;

    const envSmartRequireBarsCoverage = String(process.env.EA_SMART_REQUIRE_BARS_COVERAGE || '')
      .trim()
      .toLowerCase();
    this.smartRequireBarsCoverage =
      typeof options.smartRequireBarsCoverage === 'boolean'
        ? options.smartRequireBarsCoverage
        : envSmartRequireBarsCoverage
          ? !(
              envSmartRequireBarsCoverage === '0' ||
              envSmartRequireBarsCoverage === 'false' ||
              envSmartRequireBarsCoverage === 'no'
            )
          : this.smartStrong;

    const envSmartBarsMinM15 = Number(process.env.EA_SMART_BARS_MIN_M15);
    const envSmartBarsMinH1 = Number(process.env.EA_SMART_BARS_MIN_H1);
    const envSmartBarsMaxAgeM15Ms = Number(process.env.EA_SMART_BARS_MAX_AGE_M15_MS);
    const envSmartBarsMaxAgeH1Ms = Number(process.env.EA_SMART_BARS_MAX_AGE_H1_MS);

    this.smartBarsMinM15 = Number.isFinite(Number(options.smartBarsMinM15))
      ? Math.max(0, Number(options.smartBarsMinM15))
      : Number.isFinite(envSmartBarsMinM15)
        ? Math.max(0, envSmartBarsMinM15)
        : this.smartStrong
          ? 60
          : 30;

    this.smartBarsMinH1 = Number.isFinite(Number(options.smartBarsMinH1))
      ? Math.max(0, Number(options.smartBarsMinH1))
      : Number.isFinite(envSmartBarsMinH1)
        ? Math.max(0, envSmartBarsMinH1)
        : this.smartStrong
          ? 20
          : 10;

    this.smartBarsMaxAgeM15Ms = Number.isFinite(Number(options.smartBarsMaxAgeM15Ms))
      ? Math.max(0, Number(options.smartBarsMaxAgeM15Ms))
      : Number.isFinite(envSmartBarsMaxAgeM15Ms)
        ? Math.max(0, envSmartBarsMaxAgeM15Ms)
        : this.smartStrong
          ? 30 * 60 * 1000
          : null;

    this.smartBarsMaxAgeH1Ms = Number.isFinite(Number(options.smartBarsMaxAgeH1Ms))
      ? Math.max(0, Number(options.smartBarsMaxAgeH1Ms))
      : Number.isFinite(envSmartBarsMaxAgeH1Ms)
        ? Math.max(0, envSmartBarsMaxAgeH1Ms)
        : this.smartStrong
          ? 3 * 60 * 60 * 1000
          : null;

    const envSmartRequireQuote = String(process.env.EA_SMART_REQUIRE_QUOTE || '')
      .trim()
      .toLowerCase();
    this.smartRequireQuote =
      typeof options.smartRequireQuote === 'boolean'
        ? options.smartRequireQuote
        : envSmartRequireQuote
          ? !(
              envSmartRequireQuote === '0' ||
              envSmartRequireQuote === 'false' ||
              envSmartRequireQuote === 'no'
            )
          : this.smartStrong;

    const envSmartMaxBarAgeMs = Number(process.env.EA_SMART_MAX_BAR_AGE_MS);
    this.smartMaxBarAgeMs = Number.isFinite(Number(options.smartMaxBarAgeMs))
      ? Math.max(0, Number(options.smartMaxBarAgeMs))
      : Number.isFinite(envSmartMaxBarAgeMs)
        ? Math.max(0, envSmartMaxBarAgeMs)
        : this.smartStrong
          ? 20 * 60 * 1000
          : null;

    const envSmartSpreadPct = Number(process.env.EA_SMART_MAX_SPREAD_PCT);
    const envSmartSpreadPoints = Number(process.env.EA_SMART_MAX_SPREAD_POINTS);
    this.smartMaxSpreadPct = Number.isFinite(envSmartSpreadPct)
      ? Math.max(0, envSmartSpreadPct)
      : this.smartStrong
        ? 0.12
        : null;
    this.smartMaxSpreadPoints = Number.isFinite(envSmartSpreadPoints)
      ? Math.max(0, envSmartSpreadPoints)
      : this.smartStrong
        ? 45
        : null;

    // Default: only publish strict entry-ready signals to the dashboard.
    // This keeps the dashboard focused on tradeable setups (ENTER + trade-valid).
    // Set EA_DASHBOARD_ENTRY_ONLY=0/false/no to restore the previous publish policy.
    const envEntryOnly = String(process.env.EA_DASHBOARD_ENTRY_ONLY || '')
      .trim()
      .toLowerCase();

    const allowCandidatesByDefault =
      typeof options.dashboardAllowCandidates === 'boolean'
        ? options.dashboardAllowCandidates
        : envAllowCandidates === '1' ||
            envAllowCandidates === 'true' ||
            envAllowCandidates === 'yes'
          ? true
          : this.smartStrong
            ? false
            : eaOnlyMode || isNonProd;

    const envSnapshotSpecified = envRequireSnapshotRaw.trim().length > 0;
    const envBarsSpecified = envRequireBarsRaw.trim().length > 0;

    this.dashboardRequireSnapshot =
      typeof options.dashboardRequireSnapshot === 'boolean'
        ? options.dashboardRequireSnapshot
        : envSnapshotSpecified
          ? !(
              envRequireSnapshot === '0' ||
              envRequireSnapshot === 'false' ||
              envRequireSnapshot === 'no'
            )
          : this.smartStrong
            ? true
            : allowCandidatesByDefault
              ? false
              : true;

    this.dashboardRequireBars =
      typeof options.dashboardRequireBars === 'boolean'
        ? options.dashboardRequireBars
        : envBarsSpecified
          ? envRequireBars === '1' || envRequireBars === 'true' || envRequireBars === 'yes'
          : this.smartStrong
            ? true
            : allowCandidatesByDefault
              ? false
              : false;

    this.dashboardRequireConfluence =
      typeof options.dashboardRequireConfluence === 'boolean'
        ? options.dashboardRequireConfluence
        : envRequireConfluence === '0' ||
            envRequireConfluence === 'false' ||
            envRequireConfluence === 'no'
          ? false
          : allowCandidatesByDefault
            ? false
            : true;

    this.dashboardRequireEnter =
      typeof options.dashboardRequireEnter === 'boolean'
        ? options.dashboardRequireEnter
        : envRequireEnter === '0' || envRequireEnter === 'false' || envRequireEnter === 'no'
          ? false
          : true;
    // Require the canonical 18-layer analysis to be present and "ready" before publishing.
    this.dashboardRequireLayers18 =
      typeof options.dashboardRequireLayers18 === 'boolean'
        ? options.dashboardRequireLayers18
        : envRequireLayers18 === '0' ||
            envRequireLayers18 === 'false' ||
            envRequireLayers18 === 'no'
          ? false
          : this.smartStrong
            ? true
            : allowCandidatesByDefault
              ? false
              : true;

    this.dashboardLayers18MinConfluence = Number.isFinite(
      Number(options.dashboardLayers18MinConfluence)
    )
      ? Number(options.dashboardLayers18MinConfluence)
      : Number.isFinite(envLayers18MinConfluence)
        ? Math.max(0, Math.min(100, envLayers18MinConfluence))
        : this.smartStrong
          ? 60
          : 55;

    // When enabled, broadcast fully-analyzed WAIT/MONITOR candidates (not trade-valid yet).
    // This keeps the dashboard informative even when no strong ENTER signals exist.
    this.dashboardAllowCandidates =
      typeof options.dashboardAllowCandidates === 'boolean'
        ? options.dashboardAllowCandidates
        : envAllowCandidates === '1' ||
            envAllowCandidates === 'true' ||
            envAllowCandidates === 'yes'
          ? true
          : eaOnlyMode || isNonProd;

    this.dashboardEntryOnly =
      typeof options.dashboardEntryOnly === 'boolean'
        ? options.dashboardEntryOnly
        : envEntryOnly === '0' || envEntryOnly === 'false' || envEntryOnly === 'no'
          ? false
          : envEntryOnly === '1' || envEntryOnly === 'true' || envEntryOnly === 'yes'
            ? true
            : eaOnlyMode || isNonProd
              ? false
              : true;

    this.minConfidence = Number.isFinite(Number(options.minConfidence))
      ? Number(options.minConfidence)
      : Number.isFinite(envMinConfidence)
        ? envMinConfidence
        : this.smartStrong
          ? 55
          : 45;

    this.minStrength = Number.isFinite(Number(options.minStrength))
      ? Number(options.minStrength)
      : Number.isFinite(envMinStrength)
        ? envMinStrength
        : this.smartStrong
          ? 45
          : 35;

    // Broadcast thresholds (dashboard visibility).
    // Default to the strong thresholds; strict mode can be relaxed via env if desired.
    this.dashboardMinConfidence = Number.isFinite(Number(options.dashboardMinConfidence))
      ? Number(options.dashboardMinConfidence)
      : Number.isFinite(envDashMinConfidence)
        ? envDashMinConfidence
        : this.smartStrong
          ? Math.max(60, this.minConfidence)
          : allowCandidatesByDefault
            ? 45
            : this.minConfidence;

    this.dashboardMinStrength = Number.isFinite(Number(options.dashboardMinStrength))
      ? Number(options.dashboardMinStrength)
      : Number.isFinite(envDashMinStrength)
        ? envDashMinStrength
        : this.smartStrong
          ? Math.max(55, this.minStrength)
          : allowCandidatesByDefault
            ? 55
            : this.minStrength;

    // Near-strong: allow slightly-under-threshold watch candidates to be broadcast
    // so the dashboard doesn't look empty while a setup is forming.
    const envNearDeltaConfidence = Number(process.env.EA_SIGNAL_NEAR_DELTA_CONFIDENCE);
    const envNearDeltaStrength = Number(process.env.EA_SIGNAL_NEAR_DELTA_STRENGTH);

    this.nearDeltaConfidence = Number.isFinite(Number(options.nearDeltaConfidence))
      ? Math.max(0, Number(options.nearDeltaConfidence))
      : Number.isFinite(envNearDeltaConfidence)
        ? Math.max(0, envNearDeltaConfidence)
        : this.smartStrong
          ? 6
          : 10;

    this.nearDeltaStrength = Number.isFinite(Number(options.nearDeltaStrength))
      ? Math.max(0, Number(options.nearDeltaStrength))
      : Number.isFinite(envNearDeltaStrength)
        ? Math.max(0, envNearDeltaStrength)
        : this.smartStrong
          ? 6
          : 10;

    // Dashboard: allow early-forming setups only when explicitly enabled.
    const envAllowWait = String(process.env.EA_SIGNAL_ALLOW_WAIT_MONITOR || '').toLowerCase();
    const envAllowNear = String(process.env.EA_SIGNAL_ALLOW_NEAR_STRONG || '').toLowerCase();

    this.allowWaitMonitor =
      typeof options.allowWaitMonitor === 'boolean'
        ? options.allowWaitMonitor
        : envAllowWait === '1' || envAllowWait === 'true' || envAllowWait === 'yes';

    this.allowNearStrong =
      typeof options.allowNearStrong === 'boolean'
        ? options.allowNearStrong
        : envAllowNear === '1' || envAllowNear === 'true' || envAllowNear === 'yes';

    // State
    this.pendingByBroker = new Map(); // broker -> Set(symbol)
    this.flushTimer = null;
    this.lastGeneratedAt = new Map(); // key -> timestamp
    this.lastFingerprint = new Map(); // key -> string
    this.cursorByBroker = new Map(); // broker -> round-robin cursor
    this.lastPublishedBarTime = new Map(); // key -> epoch ms
    this.lastPublishedMeta = new Map(); // key -> { decisionState, tradeValid, status, confluenceScore, expiresAt }
  }

  startRevalidationLoop() {
    if (!this.revalidationEnabled) {
      return;
    }
    if (this.revalidateTimer) {
      return;
    }

    this.revalidateTimer = setInterval(() => {
      void this.revalidatePublishedSignals();
    }, this.revalidateIntervalMs);
    this.revalidateTimer.unref?.();
  }

  stopRevalidationLoop() {
    if (this.revalidateTimer) {
      clearInterval(this.revalidateTimer);
      this.revalidateTimer = null;
    }
  }

  async revalidatePublishedSignals() {
    if (!this.revalidationEnabled) {
      return;
    }

    const keys = Array.from(this.lastPublishedMeta.keys());
    if (keys.length === 0) {
      return;
    }

    const now = Date.now();

    for (const key of keys) {
      const [broker, symbol] = String(key).split(':');
      if (!broker || !symbol) {
        continue;
      }

      const last = this.lastRevalidatedAt.get(key) || 0;
      if (now - last < this.revalidateIntervalMs - 250) {
        continue;
      }

      this.lastRevalidatedAt.set(key, now);
      await this.maybeGenerateSignal({ broker, symbol, ctx: null, force: true });
    }
  }

  isSupportedSymbol(symbol) {
    const s = normalizeSymbol(symbol);
    if (!s) {
      return false;
    }

    // Default behavior: accept any sane EA symbol token.
    // Strict behavior (opt-in): require known/allowed instruments only.
    if (!isStrictEaSymbolFilterEnabled()) {
      return isSaneEaSymbolToken(s);
    }

    if (this.eaBridgeService?.isAllowedAssetSymbol) {
      try {
        return Boolean(this.eaBridgeService.isAllowedAssetSymbol(s));
      } catch (_error) {
        // fall through
      }
    }

    const base = extractBaseSymbol(s);
    if (!base) {
      return false;
    }

    // FX
    if (/^[A-Z]{6}$/.test(base)) {
      return true;
    }

    // Metals
    if (base === 'XAUUSD' || base === 'XAGUSD' || base === 'XPTUSD' || base === 'XPDUSD') {
      return true;
    }
    if (base === 'GOLD' || base === 'SILVER') {
      return true;
    }

    // Crypto (common quote currencies)
    if (/^(BTC|ETH|LTC|XRP|BCH|ADA|DOT|SOL|DOGE|BNB|AVAX|TRX|XLM|LINK)(USD|USDT|EUR)/.test(base)) {
      return true;
    }

    return false;
  }

  getLatestBarTime({ broker, symbol } = {}) {
    if (!this.eaBridgeService?.getMarketBars) {
      return null;
    }
    const brokerId = normalizeBroker(broker);
    const sym = normalizeSymbol(symbol);
    if (!brokerId || !sym) {
      return null;
    }

    const timeframes = ['M1', 'M15', 'H1', 'H4', 'D1'];
    for (const timeframe of timeframes) {
      try {
        const bars = this.eaBridgeService.getMarketBars({
          broker: brokerId,
          symbol: sym,
          timeframe,
          limit: 3,
          maxAgeMs: 0,
        });
        const list = Array.isArray(bars) ? bars : [];
        if (list.length === 0) {
          continue;
        }
        const newest = list[0];
        const t = toEpochMs(newest?.time ?? newest?.timestamp ?? newest?.t);
        if (t != null) {
          return t;
        }
      } catch (_error) {
        // ignore
      }
    }

    return null;
  }

  hasEnoughBars({ broker, symbol, timeframe = 'M15', minBars = 120 } = {}) {
    if (!this.eaBridgeService?.getMarketBars) {
      return false;
    }
    const brokerId = normalizeBroker(broker);
    const sym = normalizeSymbol(symbol);
    const tf = String(timeframe || '')
      .trim()
      .toUpperCase();
    if (!brokerId || !sym || !tf) {
      return false;
    }

    try {
      const bars = this.eaBridgeService.getMarketBars({
        broker: brokerId,
        symbol: sym,
        timeframe: tf,
        limit: minBars,
        maxAgeMs: 0,
      });
      return Array.isArray(bars) && bars.length >= Math.max(30, Number(minBars) || 120);
    } catch (_error) {
      return false;
    }
  }

  ingestSymbols({ broker, symbols } = {}) {
    const brokerId = normalizeBroker(broker);
    if (!brokerId) {
      return;
    }

    const list = Array.isArray(symbols) ? symbols : [];
    if (list.length === 0) {
      return;
    }

    const set = this.pendingByBroker.get(brokerId) || new Set();
    for (const raw of list) {
      const symbol = normalizeSymbol(raw);
      if (!symbol) {
        continue;
      }
      set.add(symbol);
    }
    this.pendingByBroker.set(brokerId, set);

    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending();
    }, this.debounceMs);
  }

  async flushPending() {
    const brokers = Array.from(this.pendingByBroker.keys());
    if (brokers.length === 0) {
      return;
    }

    for (const broker of brokers) {
      const symbolsSet = this.pendingByBroker.get(broker);
      if (!symbolsSet || symbolsSet.size === 0) {
        this.pendingByBroker.delete(broker);
        continue;
      }

      const allSymbols = Array.from(symbolsSet);
      symbolsSet.clear();
      this.pendingByBroker.delete(broker);

      const cursor = this.cursorByBroker.get(broker) || 0;
      const total = allSymbols.length;
      const batchSize = Math.min(this.maxSymbolsPerFlush, total);

      const batch = [];
      const remaining = new Set();
      for (let i = 0; i < total; i++) {
        const idx = (cursor + i) % total;
        const symbol = allSymbols[idx];
        if (batch.length < batchSize) {
          batch.push(symbol);
        } else {
          remaining.add(symbol);
        }
      }

      this.cursorByBroker.set(broker, (cursor + batchSize) % Math.max(1, total));

      if (remaining.size > 0) {
        this.pendingByBroker.set(broker, remaining);
      }

      const ctx = { snapshotRequestsLeft: this.maxSnapshotRequestsPerFlush };

      // Process sequentially to avoid stampeding the engine.
      for (const symbol of batch) {
        if (!this.isSupportedSymbol(symbol)) {
          continue;
        }
        await this.maybeGenerateSignal({ broker, symbol, ctx });
      }
    }

    // If there are still pending symbols, continue flushing.
    if (this.pendingByBroker.size > 0) {
      this.scheduleFlush();
    }
  }

  buildFingerprint(signal) {
    if (!signal || typeof signal !== 'object') {
      return '';
    }

    const dir = String(signal.direction || '').toUpperCase();
    const confidence = Number.isFinite(Number(signal.confidence))
      ? Math.round(Number(signal.confidence))
      : 0;
    const strength = Number.isFinite(Number(signal.strength))
      ? Math.round(Number(signal.strength))
      : 0;
    const entry = Number.isFinite(Number(signal.entry?.price))
      ? Number(signal.entry.price).toFixed(6)
      : 'na';

    const decisionState = String(signal?.isValid?.decision?.state || '').toUpperCase() || 'na';
    const status =
      String(signal?.signalStatus || signal?.validity?.state || '').toUpperCase() || 'na';
    const confluenceScore = Number.isFinite(Number(signal?.components?.confluence?.score))
      ? Math.round(Number(signal.components.confluence.score))
      : 0;

    return `${dir}:${confidence}:${strength}:${entry}:${decisionState}:${status}:${confluenceScore}`;
  }

  async maybeGenerateSignal({ broker, symbol, ctx, force = false }) {
    const key = `${broker}:${symbol}`;
    const now = Date.now();

    const last = this.lastGeneratedAt.get(key) || 0;
    if (!force && now - last < this.minIntervalMs) {
      return;
    }

    const quotes = this.eaBridgeService?.getQuotes
      ? this.eaBridgeService.getQuotes({ broker, symbols: [symbol], maxAgeMs: this.quoteMaxAgeMs })
      : [];
    const quote = Array.isArray(quotes) && quotes.length ? quotes[0] : null;

    const snapshot = this.eaBridgeService?.getMarketSnapshot
      ? this.eaBridgeService.getMarketSnapshot({ broker, symbol, maxAgeMs: this.snapshotMaxAgeMs })
      : null;

    // Fallback: some EA setups stream bars/snapshots but quotes can pause.
    // For dashboard analysis we can use the latest bar close as a best-effort price anchor.
    const barFallback = (() => {
      if (!this.eaBridgeService?.getMarketBars) {
        return null;
      }
      const timeframes = ['M1', 'M15', 'H1', 'H4', 'D1'];
      for (const timeframe of timeframes) {
        try {
          const bars = this.eaBridgeService.getMarketBars({
            broker,
            symbol,
            timeframe,
            limit: 1,
            maxAgeMs: 0,
          });
          const list = Array.isArray(bars) ? bars : [];
          const newest = list[0] || null;
          const close = newest?.close ?? newest?.c;
          const t = toEpochMs(newest?.time ?? newest?.timestamp ?? newest?.t);
          const price = close != null ? Number(close) : null;
          if (Number.isFinite(price)) {
            return { price, timeMs: t || null, timeframe };
          }
        } catch (_error) {
          // ignore
        }
      }
      return null;
    })();

    const snapshotMid = (() => {
      if (!snapshot || typeof snapshot !== 'object') {
        return null;
      }
      const q = snapshot?.quote || snapshot?.tick || snapshot;
      const bid = Number(q?.bid);
      const ask = Number(q?.ask);
      const last = Number(q?.last);

      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        return (bid + ask) / 2;
      }
      if (Number.isFinite(last) && last > 0) {
        return last;
      }
      return null;
    })();

    if (!quote && !barFallback && !Number.isFinite(snapshotMid)) {
      if (this.eaBridgeService?.isBrokerConnected) {
        const connected = this.eaBridgeService.isBrokerConnected({
          broker,
          maxAgeMs: this.quoteMaxAgeMs,
        });
        if (!connected) {
          return;
        }
      }
      // No local market data yet; ask EA to send a snapshot so the next scan cycle can proceed.
      try {
        if (ctx && typeof ctx.snapshotRequestsLeft === 'number') {
          if (ctx.snapshotRequestsLeft > 0) {
            ctx.snapshotRequestsLeft -= 1;
            this.eaBridgeService?.requestMarketSnapshot?.({
              broker,
              symbol,
              ttlMs: this.snapshotRequestTtlMs,
            });
          }
        } else {
          this.eaBridgeService?.requestMarketSnapshot?.({
            broker,
            symbol,
            ttlMs: this.snapshotRequestTtlMs,
          });
        }
      } catch (_error) {
        // best-effort
      }
      return;
    }

    const mid = quote ? computeMidFromQuote(quote) : (barFallback?.price ?? snapshotMid);
    if (!Number.isFinite(mid)) {
      return;
    }

    if (this.smartStrong && this.smartRequireQuote) {
      const hasQuotePrice =
        quote &&
        (Number.isFinite(Number(quote.bid)) ||
          Number.isFinite(Number(quote.ask)) ||
          Number.isFinite(Number(quote.last)));
      if (!hasQuotePrice) {
        return;
      }
    }

    const latestBarTime = this.getLatestBarTime({ broker, symbol });
    const barAgeMs = latestBarTime != null ? Math.max(0, now - latestBarTime) : null;
    if (this.smartStrong && this.smartMaxBarAgeMs != null) {
      if (barAgeMs == null || barAgeMs > this.smartMaxBarAgeMs) {
        return;
      }
    }

    if (this.smartStrong && quote && quote.bid != null && quote.ask != null) {
      const bid = Number(quote.bid);
      const ask = Number(quote.ask);
      if (Number.isFinite(bid) && Number.isFinite(ask) && ask > bid) {
        const spread = ask - bid;
        const spreadPct = mid > 0 ? (spread / mid) * 100 : null;
        const spreadPoints =
          quote.point != null && Number.isFinite(Number(quote.point))
            ? spread / Number(quote.point)
            : quote.spreadPoints != null
              ? Number(quote.spreadPoints)
              : null;

        if (
          this.smartMaxSpreadPct != null &&
          Number.isFinite(spreadPct) &&
          spreadPct > this.smartMaxSpreadPct
        ) {
          return;
        }

        if (
          this.smartMaxSpreadPoints != null &&
          Number.isFinite(spreadPoints) &&
          spreadPoints > this.smartMaxSpreadPoints
        ) {
          return;
        }
      }
    }

    const barsReady = this.hasEnoughBars({ broker, symbol, timeframe: 'M15', minBars: 120 });

    if (!snapshot) {
      // Ask EA to send the full technical snapshot; dashboard publishing may require it.
      if (ctx && typeof ctx.snapshotRequestsLeft === 'number') {
        if (ctx.snapshotRequestsLeft > 0) {
          ctx.snapshotRequestsLeft -= 1;
          this.eaBridgeService?.requestMarketSnapshot?.({
            broker,
            symbol,
            ttlMs: this.snapshotRequestTtlMs,
          });
        }
      } else {
        this.eaBridgeService?.requestMarketSnapshot?.({
          broker,
          symbol,
          ttlMs: this.snapshotRequestTtlMs,
        });
      }

      if (this.dashboardRequireSnapshot) {
        // No decision should be published before the full analysis snapshot is ready.
        this.lastGeneratedAt.set(key, now);
        return;
      }

      if (this.dashboardRequireBars && !barsReady) {
        this.lastGeneratedAt.set(key, now);
        return;
      }
    }

    if (this.dashboardRequireBars && !barsReady) {
      // Even with snapshot, require enough bars for stable candle-based analysis.
      this.lastGeneratedAt.set(key, now);
      return;
    }

    if (this.smartStrong) {
      if (!snapshot || !barsReady) {
        this.lastGeneratedAt.set(key, now);
        return;
      }
    }

    let rawSignal;
    try {
      rawSignal = await this.tradingEngine.generateSignal(symbol, {
        broker,
        analysisMode: 'ea',
        eaOnly: true,
      });
    } catch (error) {
      this.logger?.warn?.(
        { module: 'RealtimeEaSignalRunner', broker, symbol, err: error },
        'EA realtime signal generation failed'
      );
      return;
    }

    if (!rawSignal || typeof rawSignal !== 'object') {
      this.lastGeneratedAt.set(key, now);
      return;
    }

    // Ensure the DTO includes broker context (used by the dashboard to filter).
    rawSignal.broker = broker;

    // Attach the canonical 18-layer analysis for dashboard visibility.
    // Best-effort: never throw.
    attachLayeredAnalysisToSignal({
      rawSignal,
      broker,
      symbol,
      eaBridgeService: this.eaBridgeService,
      quoteMaxAgeMs: this.quoteMaxAgeMs,
      barFallback,
      now,
    });

    if (this.smartStrong && this.smartRequireBarsCoverage) {
      const layers = rawSignal?.components?.layeredAnalysis?.layers;
      const layer1 = Array.isArray(layers)
        ? layers.find((layer) => String(layer?.key || '') === 'L1' || Number(layer?.layer) === 1)
        : null;
      const barsCoverage = layer1?.metrics?.barsCoverage || null;
      const m15 = barsCoverage?.M15 || null;
      const h1 = barsCoverage?.H1 || null;

      const m15Count = Number(m15?.count);
      const h1Count = Number(h1?.count);
      const m15Age = Number(m15?.ageMs);
      const h1Age = Number(h1?.ageMs);

      const m15CountOk = !Number.isFinite(m15Count) || m15Count >= this.smartBarsMinM15;
      const h1CountOk = !Number.isFinite(h1Count) || h1Count >= this.smartBarsMinH1;

      const m15AgeOk =
        this.smartBarsMaxAgeM15Ms == null ||
        !Number.isFinite(m15Age) ||
        m15Age <= this.smartBarsMaxAgeM15Ms;
      const h1AgeOk =
        this.smartBarsMaxAgeH1Ms == null ||
        !Number.isFinite(h1Age) ||
        h1Age <= this.smartBarsMaxAgeH1Ms;

      if (!(m15CountOk && h1CountOk && m15AgeOk && h1AgeOk)) {
        this.lastGeneratedAt.set(key, now);
        return;
      }
    }

    // Best-effort timeframe inference for dashboard display.
    // Prefer explicit/technical timeframe; fallback to the bar fallback timeframe if available.
    if (!rawSignal.timeframe) {
      const inferred =
        rawSignal?.components?.technical?.signals?.[0]?.timeframe ?? barFallback?.timeframe ?? null;
      if (inferred != null && String(inferred).trim()) {
        rawSignal.timeframe = String(inferred);
      }
    }

    const decisionState = rawSignal?.isValid?.decision?.state || null;
    const tradeValid = rawSignal?.isValid?.isValid === true;

    const confluence = rawSignal?.components?.confluence || null;
    const confluencePassed = confluence?.passed === true;
    const confluenceReady = Boolean(
      confluence &&
      Number.isFinite(Number(confluence?.evaluatedAt)) &&
      Array.isArray(confluence?.layers) &&
      confluence.layers.length > 0
    );

    const confidence = Number(rawSignal.confidence) || 0;
    const strength = Number(rawSignal.strength) || 0;

    const minConfidence = Number.isFinite(this.dashboardMinConfidence)
      ? this.dashboardMinConfidence
      : this.minConfidence;
    const minStrength = Number.isFinite(this.dashboardMinStrength)
      ? this.dashboardMinStrength
      : this.minStrength;

    const isStrong = confidence >= minConfidence && strength >= minStrength;
    const isNearStrong =
      this.allowNearStrong &&
      confidence >= minConfidence - this.nearDeltaConfidence &&
      strength >= minStrength - this.nearDeltaStrength;

    const prevMeta = this.lastPublishedMeta.get(key) || null;
    const statusNow =
      String(rawSignal?.signalStatus || rawSignal?.validity?.state || '').toUpperCase() || null;
    const expiresAtNow = Number(rawSignal?.expiresAt ?? rawSignal?.validity?.expiresAt);
    const confluenceScoreNow = Number(rawSignal?.components?.confluence?.score);
    const metaNow = {
      decisionState: decisionState || null,
      tradeValid,
      status: statusNow,
      confluenceScore: Number.isFinite(confluenceScoreNow) ? Number(confluenceScoreNow) : null,
      expiresAt: Number.isFinite(expiresAtNow) ? Number(expiresAtNow) : null,
    };

    const isLifecycleUpdate = Boolean(
      prevMeta &&
      (prevMeta.decisionState !== metaNow.decisionState ||
        prevMeta.tradeValid !== metaNow.tradeValid ||
        prevMeta.status !== metaNow.status ||
        (metaNow.confluenceScore != null && prevMeta.confluenceScore !== metaNow.confluenceScore))
    );

    const directional = (() => {
      const dir = String(rawSignal.direction || '').toUpperCase();
      return dir === 'BUY' || dir === 'SELL';
    })();

    const allowWaitState = this.allowWaitMonitor && decisionState === 'WAIT_MONITOR';
    const actionableState = decisionState === 'ENTER' || allowWaitState;
    const tier = isStrong ? 'strong' : isNearStrong ? 'near' : null;

    const requiresEnter = this.dashboardRequireEnter;
    const meetsEnter = !requiresEnter || decisionState === 'ENTER';
    const meetsConfluence =
      !this.dashboardRequireConfluence || (confluenceReady && confluencePassed);
    const layered = rawSignal?.components?.layeredAnalysis || null;
    const layersStatus = evaluateLayers18Readiness({
      layeredAnalysis: layered,
      minConfluence: this.dashboardLayers18MinConfluence,
      decisionStateFallback: decisionState,
      allowStrongOverride: true,
      signal: rawSignal,
    });
    const layers18 = Array.isArray(layered?.layers) ? layered.layers : [];
    const layers18Ready = layersStatus.ok === true;
    const layers18Override = layersStatus?.strongOverride?.ok === true;

    const meetsLayers18 =
      !this.dashboardRequireLayers18 ||
      layers18Ready ||
      (layers18Override && this.dashboardRequireEnter && decisionState === 'ENTER');
    const meetsTradeValidity = tradeValid === true;

    // "Analyzed" candidates: any signal that includes the canonical 18-layer payload.
    // These are NOT necessarily trade-valid yet; they exist to explain why ENTER=0.
    // Keep it strict on payload shape (18 layers) so the UI has consistent diagnostics.
    const analyzedReady =
      layers18.length === 18 &&
      // Ensure we truly have the analysis payload available for UI.
      Boolean(rawSignal?.components?.layeredAnalysis);

    const publish = (() => {
      const canPublishEntryReady =
        directional &&
        decisionState === 'ENTER' &&
        tier === 'strong' &&
        meetsConfluence &&
        meetsLayers18 &&
        meetsTradeValidity;

      const canPublishCandidate = this.dashboardAllowCandidates && analyzedReady;

      if (this.dashboardEntryOnly) {
        // Strict dashboard: keep the primary stream focused on tradeable ENTER.
        // Still allow lifecycle updates for previously published signals (accuracy), and
        // publish analyzed candidates on a separate channel so the UI can explain "why 0".
        if (canPublishEntryReady || isLifecycleUpdate) {
          return { event: 'signal', keySuffix: '' };
        }
        if (canPublishCandidate) {
          return { event: 'signal_candidate', keySuffix: ':candidate' };
        }
        return null;
      }

      // Legacy publish policy:
      // - Standard: strong/near signals in ENTER (or WAIT_MONITOR if allowed).
      // - Candidates: analyzed payloads (optional).
      // - Lifecycle updates: if we previously published, broadcast state transitions.
      if (
        (directional &&
          actionableState &&
          tier != null &&
          meetsEnter &&
          meetsConfluence &&
          meetsLayers18 &&
          meetsTradeValidity) ||
        (directional && isLifecycleUpdate)
      ) {
        return { event: 'signal', keySuffix: '' };
      }
      if (canPublishCandidate) {
        return { event: 'signal_candidate', keySuffix: ':candidate' };
      }
      return null;
    })();

    if (!publish) {
      this.lastGeneratedAt.set(key, now);
      return;
    }

    const broadcastEvent = publish.event;
    const broadcastKey = publish.keySuffix ? `${key}${publish.keySuffix}` : key;

    // Bar-driven behavior: publish at most once per new bar (prefer M15/H1).
    // Lifecycle updates (validity/status/confluence changes) are allowed intra-bar.
    const lastBarTime = this.lastPublishedBarTime.get(broadcastKey) || null;
    if (
      !isLifecycleUpdate &&
      latestBarTime != null &&
      lastBarTime != null &&
      latestBarTime === lastBarTime
    ) {
      this.lastGeneratedAt.set(broadcastKey, now);
      return;
    }

    const fingerprint = this.buildFingerprint(rawSignal);
    const lastFp = this.lastFingerprint.get(broadcastKey) || '';
    if (fingerprint && fingerprint === lastFp) {
      // Avoid spamming the same signal repeatedly.
      this.lastGeneratedAt.set(broadcastKey, now);
      return;
    }

    const dto = validateTradingSignalDTO(createTradingSignalDTO(rawSignal));

    this.lastGeneratedAt.set(broadcastKey, now);
    this.lastFingerprint.set(broadcastKey, fingerprint);
    if (latestBarTime != null) {
      this.lastPublishedBarTime.set(broadcastKey, latestBarTime);
    }
    this.lastPublishedMeta.set(broadcastKey, metaNow);

    this.broadcast(broadcastEvent, dto);

    // Local hook for auto-trading execution (server-side).
    // Never trigger execution on candidate/diagnostic streams.
    if (broadcastEvent === 'signal' && this.onSignal) {
      try {
        this.onSignal({ broker, signal: dto });
      } catch (_error) {
        // best-effort
      }
    }

    this.logger?.info?.(
      {
        module: 'RealtimeEaSignalRunner',
        broker,
        pair: dto.pair,
        direction: dto.direction,
        strength: dto.strength,
        confidence: dto.confidence,
        tier: tier || (isLifecycleUpdate ? 'update' : 'filtered'),
      },
      'Broadcasted EA realtime signal'
    );
  }
}
