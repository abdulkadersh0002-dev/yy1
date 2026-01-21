/**
 * Trade Manager - Automated Trade Execution and Management
 * Handles opening, monitoring, and closing trades automatically
 */

import { listTargetPairs } from '../config/pair-catalog.js';
import logger from '../services/logging/logger.js';
import { evaluateLayers18Readiness } from '../services/ea-signal-pipeline.js';

const truthy = new Set(['1', 'true', 'yes', 'on']);

const parseCsvSet = (value) => {
  if (!value) {
    return new Set();
  }
  return new Set(
    String(value)
      .split(',')
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
};

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
  'HUF',
  'CZK',
  'MXN',
  'BRL',
  'RUB',
  'INR',
  'CNY',
  'CNH',
  'HKD',
  'KRW',
  'TWD',
  'THB',
  'MYR',
  'IDR',
  'PHP',
  'ILS',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'SGD',
  'TRY',
  'RON',
  'BGN',
  'ZAR'
]);

const metalBases = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const cryptoBases = ['BTC', 'ETH', 'SOL', 'XRP'];

const classifyAutoTradingSymbol = (rawSymbol) => {
  const cleaned = String(rawSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const letters = cleaned.replace(/[^A-Z]/g, '');
  if (letters.length >= 6) {
    const base = letters.slice(0, 3);
    const quote = letters.slice(3, 6);
    if (currencyCodes.has(base) && currencyCodes.has(quote)) {
      return 'forex';
    }
    if (metalBases.has(base) && currencyCodes.has(quote)) {
      return 'metals';
    }
    for (const baseCrypto of cryptoBases) {
      if (
        letters.startsWith(baseCrypto) &&
        (letters.slice(baseCrypto.length).startsWith('USD') ||
          letters.slice(baseCrypto.length).startsWith('USDT') ||
          letters.slice(baseCrypto.length).startsWith('EUR'))
      ) {
        return 'crypto';
      }
    }
  }
  return 'other';
};

const readEnvNumber = (name) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : null;
};

const envLayers18MinConfluence = readEnvNumber('EA_SIGNAL_LAYERS18_MIN_CONFLUENCE');
const layers18MinConfluence =
  envLayers18MinConfluence != null ? Math.max(0, Math.min(100, envLayers18MinConfluence)) : 30;

const getLayers18Status = (signal) =>
  evaluateLayers18Readiness({
    layeredAnalysis: signal?.components?.layeredAnalysis,
    minConfluence: layers18MinConfluence,
    decisionStateFallback: signal?.isValid?.decision?.state
  });

class TradeManager {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    // Optional event emitter (typically wired to WebSocket broadcast).
    this.emit = null;
    this.autoTradingEnabledByBroker = new Map();
    this.monitoringInterval = null;
    this.signalGenerationInterval = null;

    this.brokerHealthCache = new Map();

    // Trading pairs to monitor (seed list; the live universe can expand from EA quotes).
    this.tradingPairs = listTargetPairs();
    this.configuredPairs = [...this.tradingPairs];

    this.lastSignalCheck = new Map();

    // Realtime strong-signal execution (event-driven).
    this.realtimeCandidatesByBroker = new Map(); // broker -> Map(pair -> signal)
    this.realtimeFlushTimersByBroker = new Map();
    this.lastRealtimeTradeAt = new Map(); // broker:pair -> epoch ms

    const config = this.tradingEngine?.config || {};
    const autoTradingConfig = config.autoTrading || {};

    // Strong-only execution thresholds (for auto-trading), sourced from EA strong-signal policy.
    // These are intentionally stricter than SIGNAL_HARD_MIN_* (which are safety floors).
    const envMinConfidence = readEnvNumber('EA_SIGNAL_MIN_CONFIDENCE');
    const envMinStrength = readEnvNumber('EA_SIGNAL_MIN_STRENGTH');
    this.realtimeMinConfidence = Number.isFinite(Number(autoTradingConfig.realtimeMinConfidence))
      ? Number(autoTradingConfig.realtimeMinConfidence)
      : envMinConfidence != null
        ? envMinConfidence
        : 45;
    this.realtimeMinStrength = Number.isFinite(Number(autoTradingConfig.realtimeMinStrength))
      ? Number(autoTradingConfig.realtimeMinStrength)
      : envMinStrength != null
        ? envMinStrength
        : 35;

    // Require the canonical 18-layer payload to be present/ready before executing.
    this.realtimeRequireLayers18 = autoTradingConfig.realtimeRequireLayers18 !== false;

    // Dynamic universe: include all symbols recently seen in EA quotes (ticker/price bar).
    this.dynamicUniverseEnabled = autoTradingConfig.dynamicUniverseEnabled !== false;
    this.universeMaxAgeMs = Number.isFinite(Number(autoTradingConfig.universeMaxAgeMs))
      ? Math.max(5 * 1000, Number(autoTradingConfig.universeMaxAgeMs))
      : 60 * 1000;
    this.universeMaxSymbols = Number.isFinite(Number(autoTradingConfig.universeMaxSymbols))
      ? Math.max(10, Number(autoTradingConfig.universeMaxSymbols))
      : 200;
    this.allowAllQuoteSymbols = autoTradingConfig.allowAllQuoteSymbols !== false;

    // Realtime execution from EA strong signals.
    this.realtimeSignalExecutionEnabled =
      autoTradingConfig.realtimeSignalExecutionEnabled !== false;
    this.realtimeExecutionDebounceMs = Number.isFinite(
      Number(autoTradingConfig.realtimeExecutionDebounceMs)
    )
      ? Math.max(50, Number(autoTradingConfig.realtimeExecutionDebounceMs))
      : 500;
    this.realtimeTradeCooldownMs = Number.isFinite(
      Number(autoTradingConfig.realtimeTradeCooldownMs)
    )
      ? Math.max(0, Number(autoTradingConfig.realtimeTradeCooldownMs))
      : 3 * 60 * 1000;

    this.signalCheckInterval = Number.isFinite(autoTradingConfig.signalCheckIntervalMs)
      ? autoTradingConfig.signalCheckIntervalMs
      : 900000; // 15 minutes default

    this.monitoringIntervalMs = Number.isFinite(autoTradingConfig.monitoringIntervalMs)
      ? autoTradingConfig.monitoringIntervalMs
      : 10000; // 10 seconds default

    this.signalGenerationIntervalMs = Number.isFinite(autoTradingConfig.signalGenerationIntervalMs)
      ? autoTradingConfig.signalGenerationIntervalMs
      : 300000; // 5 minutes default

    // Auto-trading asset filter (defaults: forex + metals).
    // This protects execution from "ALLOW_ALL_SYMBOLS" / dashboard full-scan modes.
    const allowAllAssetsRaw = String(process.env.AUTO_TRADING_ALLOW_ALL_ASSETS || '')
      .trim()
      .toLowerCase();
    this.autoTradingAllowAllAssets = truthy.has(allowAllAssetsRaw);

    const classes = parseCsvSet(process.env.AUTO_TRADING_ASSET_CLASSES);
    this.autoTradingAssetClasses = classes.size ? classes : new Set(['forex', 'metals']);
  }

  evaluateExecutionGate({ broker, signal, source, shouldExecuteHint } = {}) {
    const brokerId = this.normalizeBrokerId(broker);
    const pair = String(signal?.pair || '').trim();
    const decisionState = signal?.isValid?.decision?.state || null;
    const decisionScore = Number(signal?.isValid?.decision?.score ?? null);
    const confidence = Number(signal?.confidence) || 0;
    const strength = Number(signal?.strength) || 0;

    if (!signal) {
      return { ok: false, reason: 'Missing signal', details: { broker: brokerId, source } };
    }

    if (brokerId && pair && !this.isAutoTradingSymbolAllowed(pair)) {
      return {
        ok: false,
        reason: 'Symbol not allowed for auto-trading',
        details: {
          broker: brokerId,
          pair,
          source,
          decisionState,
          decisionScore,
          confidence,
          strength
        }
      };
    }

    if (pair && this.hasOpenTradeForPair(pair)) {
      return {
        ok: false,
        reason: 'Trade already open for pair',
        details: {
          broker: brokerId,
          pair,
          source,
          decisionState,
          decisionScore,
          confidence,
          strength
        }
      };
    }

    // Safety: never execute watchlist/blocked/non-enter signals.
    if (decisionState !== 'ENTER' || signal?.isValid?.isValid !== true) {
      return {
        ok: false,
        reason: `Signal not executable (state=${decisionState || 'unknown'})`,
        details: {
          broker: brokerId,
          pair,
          source,
          decisionState,
          decisionScore,
          confidence,
          strength
        }
      };
    }

    // If the EA pipeline explicitly says "do not execute", respect it.
    if (shouldExecuteHint === false) {
      return {
        ok: false,
        reason: 'EA execution gate disabled (shouldExecute=false)',
        details: {
          broker: brokerId,
          pair,
          source,
          decisionState,
          decisionScore,
          confidence,
          strength
        }
      };
    }

    if (confidence < this.realtimeMinConfidence || strength < this.realtimeMinStrength) {
      return {
        ok: false,
        reason: `Signal not strong enough (confidence=${confidence}, strength=${strength})`,
        details: {
          broker: brokerId,
          pair,
          source,
          decisionState,
          decisionScore,
          confidence,
          strength
        }
      };
    }

    if (this.realtimeRequireLayers18) {
      const layersStatus = getLayers18Status(signal);
      if (!layersStatus.ok) {
        return {
          ok: false,
          reason: `Missing/failed 18-layer readiness (layers=${layersStatus.layersCount})`,
          details: {
            broker: brokerId,
            pair,
            source,
            decisionState,
            decisionScore,
            confidence,
            strength,
            layersStatus
          }
        };
      }
    }

    return {
      ok: true,
      details: {
        broker: brokerId,
        pair,
        source,
        decisionState,
        decisionScore,
        confidence,
        strength
      }
    };
  }

  emitEvent(type, payload) {
    if (typeof this.emit !== 'function') {
      return;
    }
    try {
      this.emit(type, payload);
    } catch (_error) {
      // best-effort
    }
  }

  isAutoTradingSymbolAllowed(symbol) {
    const raw = String(symbol || '').trim();
    if (!raw) {
      return false;
    }

    // Hard filter: default to forex + metals only.
    if (!this.autoTradingAllowAllAssets && !this.autoTradingAssetClasses.has('any')) {
      const assetClass = classifyAutoTradingSymbol(raw);
      if (!this.autoTradingAssetClasses.has(assetClass)) {
        return false;
      }
    }

    // Prefer EA bridge filtering (forex/metals/crypto) when enabled.
    if (this.eaBridgeService?.isAllowedAssetSymbol) {
      try {
        if (!this.eaBridgeService.isAllowedAssetSymbol(raw)) {
          return false;
        }
      } catch (_error) {
        // fall through
      }
    }

    // If EA bridge explicitly allows it, and our asset-class filter allowed it, we can accept.
    if (this.eaBridgeService?.isAllowedAssetSymbol) {
      try {
        if (this.eaBridgeService.isAllowedAssetSymbol(raw)) {
          return true;
        }
      } catch (_error) {
        // fall through
      }
    }

    // If user wants everything from the live quote strip, allow it conservatively.
    if (!this.allowAllQuoteSymbols) {
      return false;
    }

    const cleaned = raw.toUpperCase().replace(/\s+/g, '');
    if (cleaned.length < 3 || cleaned.length > 20) {
      return false;
    }
    if (!/^[A-Z0-9_.#-]+$/.test(cleaned)) {
      return false;
    }

    // Filter obvious non-tradable meta tokens.
    const deny = new Set(['BALANCE', 'EQUITY', 'MARGIN', 'FREE', 'ACCOUNT']);
    if (deny.has(cleaned)) {
      return false;
    }

    return true;
  }

  hasOpenTradeForPair(pair) {
    const wanted = String(pair || '')
      .trim()
      .toUpperCase();
    if (!wanted) {
      return false;
    }
    const trades = this.tradingEngine?.activeTrades;
    if (!trades || typeof trades.values !== 'function') {
      return false;
    }
    for (const trade of trades.values()) {
      const p = String(trade?.pair || '')
        .trim()
        .toUpperCase();
      if (p && p === wanted && String(trade?.status || 'open').toLowerCase() === 'open') {
        return true;
      }
    }
    return false;
  }

  enqueueRealtimeSignal({ broker, signal } = {}) {
    if (!this.realtimeSignalExecutionEnabled) {
      return;
    }
    const brokerId = this.normalizeBrokerId(broker);
    if (!brokerId || !this.isAutoTradingEnabled(brokerId)) {
      return;
    }
    if (!signal || signal.isValid?.isValid !== true) {
      return;
    }

    const pair = String(signal.pair || '').trim();
    if (!pair) {
      return;
    }

    // Skip if we already have an open trade for this pair.
    if (this.hasOpenTradeForPair(pair)) {
      return;
    }

    // Cooldown to avoid repeated opens when signals are very frequent.
    const cooldownKey = `${brokerId}:${pair}`;
    const last = Number(this.lastRealtimeTradeAt.get(cooldownKey) || 0);
    const now = Date.now();
    if (this.realtimeTradeCooldownMs > 0 && last && now - last < this.realtimeTradeCooldownMs) {
      return;
    }

    const map = this.realtimeCandidatesByBroker.get(brokerId) || new Map();
    const existing = map.get(pair);
    const existingScore = Number(existing?.isValid?.decision?.score ?? -1);
    const nextScore = Number(signal?.isValid?.decision?.score ?? -1);
    if (!existing || nextScore >= existingScore) {
      map.set(pair, signal);
    }
    this.realtimeCandidatesByBroker.set(brokerId, map);

    if (!this.realtimeFlushTimersByBroker.get(brokerId)) {
      const timer = setTimeout(() => {
        void this.flushRealtimeSignalsForBroker(brokerId);
      }, this.realtimeExecutionDebounceMs);
      timer.unref?.();
      this.realtimeFlushTimersByBroker.set(brokerId, timer);
    }
  }

  async flushRealtimeSignalsForBroker(brokerId) {
    const id = this.normalizeBrokerId(brokerId);
    if (!id) {
      return;
    }

    const timer = this.realtimeFlushTimersByBroker.get(id);
    if (timer) {
      clearTimeout(timer);
      this.realtimeFlushTimersByBroker.delete(id);
    }

    if (!this.isAutoTradingEnabled(id)) {
      this.realtimeCandidatesByBroker.delete(id);
      return;
    }

    const connected = await this.isBrokerConnected(id);
    if (!connected) {
      this.realtimeCandidatesByBroker.delete(id);
      return;
    }

    const config = this.tradingEngine?.config || {};
    const autoTradingConfig = config.autoTrading || {};
    const maxNewTradesPerCycle = Number.isFinite(Number(autoTradingConfig.maxNewTradesPerCycle))
      ? Math.max(1, Number(autoTradingConfig.maxNewTradesPerCycle))
      : 1;

    const map = this.realtimeCandidatesByBroker.get(id) || new Map();
    const candidates = Array.from(map.values());
    this.realtimeCandidatesByBroker.delete(id);

    candidates.sort((a, b) => {
      const sa = Number(a?.isValid?.decision?.score ?? -1);
      const sb = Number(b?.isValid?.decision?.score ?? -1);
      if (sb !== sa) {
        return sb - sa;
      }
      const ca = Number(a?.confidence ?? -1);
      const cb = Number(b?.confidence ?? -1);
      if (cb !== ca) {
        return cb - ca;
      }
      const ta = Number(a?.strength ?? -1);
      const tb = Number(b?.strength ?? -1);
      return tb - ta;
    });

    let opened = 0;
    for (const signal of candidates) {
      if (opened >= maxNewTradesPerCycle) {
        break;
      }

      const pair = String(signal?.pair || '').trim();
      if (!pair) {
        continue;
      }

      if (!this.isAutoTradingSymbolAllowed(pair)) {
        this.emitEvent('auto_trade_rejected', {
          broker: id,
          pair,
          source: 'realtime',
          reason: 'Symbol not allowed for auto-trading',
          decisionScore: signal?.isValid?.decision?.score,
          confidence: signal?.confidence,
          strength: signal?.strength,
          signal
        });
        continue;
      }

      if (this.hasOpenTradeForPair(pair)) {
        continue;
      }

      const gate = this.evaluateExecutionGate({ broker: id, signal, source: 'realtime' });
      if (!gate.ok) {
        this.emitEvent('auto_trade_rejected', {
          broker: id,
          pair,
          source: 'realtime',
          reason: gate.reason,
          decisionScore: signal?.isValid?.decision?.score,
          confidence: signal?.confidence,
          strength: signal?.strength,
          ...(gate.details?.layersStatus ? { layersStatus: gate.details.layersStatus } : {}),
          signal
        });
        continue;
      }

      const signalForBroker = {
        ...signal,
        brokerPreference: id
      };

      this.emitEvent('auto_trade_attempt', {
        broker: id,
        pair,
        source: 'realtime',
        decisionScore: signal?.isValid?.decision?.score,
        confidence: signal?.confidence,
        strength: signal?.strength,
        signal: signalForBroker
      });

      const result = await this.tradingEngine.executeTrade(signalForBroker);
      if (result.success) {
        opened += 1;
        this.lastRealtimeTradeAt.set(`${id}:${pair}`, Date.now());

        // Ensure the dashboard can link a trade back to the originating signal.
        const tradePayload = result.trade
          ? { ...result.trade, originSignal: result.trade?.originSignal || signalForBroker }
          : null;
        if (tradePayload) {
          this.emitEvent('trade_opened', tradePayload);
        }

        logger.info(
          {
            module: 'TradeManager',
            broker: id,
            tradeId: result.trade?.id,
            pair,
            decisionScore: signal?.isValid?.decision?.score
          },
          'Auto-trading opened trade (realtime strong signal)'
        );
      } else {
        this.emitEvent('auto_trade_rejected', {
          broker: id,
          pair,
          source: 'realtime',
          reason: result?.reason || 'Trade rejected',
          decisionScore: signal?.isValid?.decision?.score,
          confidence: signal?.confidence,
          strength: signal?.strength,
          signal: signalForBroker
        });
        logger.warn(
          { module: 'TradeManager', broker: id, pair, reason: result.reason },
          'Auto-trading trade rejected (realtime strong signal)'
        );
      }
    }
  }

  getDynamicPairsForBroker(brokerId) {
    const normalized = this.normalizeBrokerId(brokerId);
    if (!normalized || !this.dynamicUniverseEnabled) {
      return [];
    }
    const requiresEa = normalized === 'mt4' || normalized === 'mt5';
    if (!requiresEa || !this.eaBridgeService?.getQuotes) {
      return [];
    }

    let quotes = [];
    try {
      quotes = this.eaBridgeService.getQuotes({
        broker: normalized,
        maxAgeMs: this.universeMaxAgeMs,
        orderBy: 'symbol'
      });
    } catch (_error) {
      quotes = [];
    }

    const symbols = [];
    const seen = new Set();
    for (const q of Array.isArray(quotes) ? quotes : []) {
      const sym = String(q?.symbol || '').trim();
      if (!sym) {
        continue;
      }
      if (!this.isAutoTradingSymbolAllowed(sym)) {
        continue;
      }
      const key = sym.toUpperCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      symbols.push(sym);
      if (symbols.length >= this.universeMaxSymbols) {
        break;
      }
    }
    return symbols;
  }

  getPairsToScanForBroker(brokerId) {
    const base = Array.isArray(this.tradingPairs) ? this.tradingPairs : [];
    const dynamic = this.getDynamicPairsForBroker(brokerId);
    const merged = [];
    const seen = new Set();
    for (const p of [...base, ...dynamic]) {
      const pair = String(p || '').trim();
      if (!pair) {
        continue;
      }
      const key = pair.toUpperCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(pair);
    }
    return merged;
  }

  async isBrokerConnected(brokerId) {
    const normalized = this.normalizeBrokerId(brokerId);
    if (!normalized) {
      return false;
    }

    const requiresEa = normalized === 'mt4' || normalized === 'mt5';
    if (!requiresEa) {
      return true;
    }

    if (this.eaBridgeService?.isBrokerConnected) {
      const envMaxAgeMs = readEnvNumber('AUTO_TRADING_EA_QUOTE_MAX_AGE_MS');
      const maxAgeMs = envMaxAgeMs != null ? Math.max(0, envMaxAgeMs) : 2 * 60 * 1000;
      return this.eaBridgeService.isBrokerConnected({ broker: normalized, maxAgeMs });
    }

    const cacheKey = normalized;
    const cached = this.brokerHealthCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - Number(cached.checkedAt || 0) < 5000) {
      return Boolean(cached.connected);
    }

    const connector = this.tradingEngine?.brokerRouter?.getConnector
      ? this.tradingEngine.brokerRouter.getConnector(normalized)
      : null;
    if (!connector?.healthCheck) {
      this.brokerHealthCache.set(cacheKey, { checkedAt: now, connected: false });
      return false;
    }

    try {
      const health = await connector.healthCheck();
      const connected = Boolean(health?.connected);
      this.brokerHealthCache.set(cacheKey, { checkedAt: now, connected });
      return connected;
    } catch (_error) {
      this.brokerHealthCache.set(cacheKey, { checkedAt: now, connected: false });
      return false;
    }
  }

  normalizeBrokerId(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (!raw) {
      return null;
    }
    if (raw === 'mt4' || raw === 'metatrader4') {
      return 'mt4';
    }
    if (raw === 'mt5' || raw === 'metatrader5') {
      return 'mt5';
    }
    return raw;
  }

  getDefaultBrokerId() {
    const fromConfig = this.normalizeBrokerId(
      this.tradingEngine?.config?.brokerRouting?.defaultBroker
    );
    return fromConfig || 'mt5';
  }

  getEnabledBrokerIds() {
    return Array.from(this.autoTradingEnabledByBroker.entries())
      .filter(([, enabled]) => Boolean(enabled))
      .map(([broker]) => broker);
  }

  isAutoTradingEnabled(broker) {
    const brokerId = this.normalizeBrokerId(broker);
    if (!brokerId) {
      return this.getEnabledBrokerIds().length > 0;
    }
    return Boolean(this.autoTradingEnabledByBroker.get(brokerId));
  }

  shouldMonitorTrades() {
    const activeCount = Number(this.tradingEngine?.activeTrades?.size || 0);
    return this.getEnabledBrokerIds().length > 0 || activeCount > 0;
  }

  ensureIntervalsRunning() {
    if (!this.monitoringInterval) {
      this.monitoringInterval = setInterval(() => {
        void this.monitorActiveTrades();
      }, this.monitoringIntervalMs);
    }

    if (!this.signalGenerationInterval) {
      this.signalGenerationInterval = setInterval(() => {
        void this.checkForNewSignals();
      }, this.signalGenerationIntervalMs);
    }
  }

  maybeStopIntervals() {
    const enabledBrokers = this.getEnabledBrokerIds();
    const activeCount = Number(this.tradingEngine?.activeTrades?.size || 0);

    // If nothing is enabled and there are no active trades, shut everything down.
    if (enabledBrokers.length === 0 && activeCount === 0) {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      if (this.signalGenerationInterval) {
        clearInterval(this.signalGenerationInterval);
        this.signalGenerationInterval = null;
      }
      return;
    }

    // If nothing is enabled, stop only signal generation (no new trades),
    // but keep monitoring running to manage/close existing trades safely.
    if (enabledBrokers.length === 0 && this.signalGenerationInterval) {
      clearInterval(this.signalGenerationInterval);
      this.signalGenerationInterval = null;
    }
  }

  /**
   * Start automated trading
   */
  async startAutoTrading(options = {}) {
    const brokerId = this.normalizeBrokerId(options.broker) || this.getDefaultBrokerId();
    const allowDisconnected = Boolean(options.allowDisconnected);
    const alreadyEnabled = this.isAutoTradingEnabled(brokerId);

    if (alreadyEnabled) {
      logger.info({ module: 'TradeManager', broker: brokerId }, 'Auto trading is already running');
      return { success: false, message: 'Already running', broker: brokerId };
    }

    logger.info(
      { module: 'TradeManager', broker: brokerId },
      'Starting automated trading system...'
    );

    const connected = await this.isBrokerConnected(brokerId);
    if (!connected && !allowDisconnected) {
      return {
        success: false,
        message: `Broker ${String(brokerId).toUpperCase()} is not connected yet. Connect MT4/MT5 first.`,
        broker: brokerId
      };
    }

    this.autoTradingEnabledByBroker.set(brokerId, true);

    this.ensureIntervalsRunning();

    // Initial signal check
    void this.checkForNewSignals();

    if (!connected) {
      logger.warn(
        { module: 'TradeManager', broker: brokerId },
        'Auto trading enabled while broker disconnected; waiting for connectivity'
      );
      return {
        success: true,
        message: `Auto trading enabled for ${String(brokerId).toUpperCase()} (waiting for broker connection)`,
        broker: brokerId,
        connected: false,
        enabledBrokers: this.getEnabledBrokerIds(),
        pairs: this.tradingPairs.length,
        checkIntervalMs: this.signalGenerationIntervalMs
      };
    }

    return {
      success: true,
      message: `Auto trading started for ${String(brokerId).toUpperCase()}`,
      broker: brokerId,
      connected: true,
      enabledBrokers: this.getEnabledBrokerIds(),
      pairs: this.tradingPairs.length,
      checkIntervalMs: this.signalGenerationIntervalMs
    };
  }

  /**
   * Stop automated trading
   */
  stopAutoTrading(options = {}) {
    const brokerProvided = this.normalizeBrokerId(options.broker);
    const activeTrades = Number(this.tradingEngine?.activeTrades?.size || 0);

    if (!brokerProvided) {
      if (this.getEnabledBrokerIds().length === 0) {
        return { success: false, message: 'Auto trading is not running' };
      }

      logger.info({ module: 'TradeManager' }, 'Stopping automated trading system (all brokers)...');
      this.autoTradingEnabledByBroker.clear();
      this.maybeStopIntervals();

      return {
        success: true,
        message: 'Auto trading stopped',
        enabledBrokers: this.getEnabledBrokerIds(),
        activeTrades
      };
    }

    if (!this.isAutoTradingEnabled(brokerProvided)) {
      return {
        success: false,
        message: `Auto trading is not running for ${String(brokerProvided).toUpperCase()}`,
        broker: brokerProvided
      };
    }

    logger.info(
      { module: 'TradeManager', broker: brokerProvided },
      'Stopping automated trading system...'
    );
    this.autoTradingEnabledByBroker.set(brokerProvided, false);
    this.maybeStopIntervals();

    return {
      success: true,
      message: `Auto trading stopped for ${String(brokerProvided).toUpperCase()}`,
      broker: brokerProvided,
      enabledBrokers: this.getEnabledBrokerIds(),
      activeTrades
    };
  }

  /**
   * Check for new trading signals
   */
  async checkForNewSignals() {
    const enabledBrokers = this.getEnabledBrokerIds();
    if (enabledBrokers.length === 0) {
      return;
    }

    logger.debug({ module: 'TradeManager' }, 'Checking for new trading signals...');

    const config = this.tradingEngine?.config || {};
    const autoTradingConfig = config.autoTrading || {};
    const maxNewTradesPerCycle = Number.isFinite(Number(autoTradingConfig.maxNewTradesPerCycle))
      ? Math.max(1, Number(autoTradingConfig.maxNewTradesPerCycle))
      : 1;

    for (const brokerId of enabledBrokers) {
      if (!this.isAutoTradingEnabled(brokerId)) {
        continue;
      }

      const connected = await this.isBrokerConnected(brokerId);
      if (!connected) {
        continue;
      }

      const candidates = [];
      const pairsToScan = this.getPairsToScanForBroker(brokerId);
      for (const pair of pairsToScan) {
        try {
          // Check if enough time has passed since last check (per broker+pair)
          const lastKey = `${brokerId}:${pair}`;
          const lastCheck = this.lastSignalCheck.get(lastKey) || 0;
          if (Date.now() - lastCheck < this.signalCheckInterval) {
            continue;
          }

          const isEaBroker = brokerId === 'mt4' || brokerId === 'mt5';
          let signal = null;
          let shouldExecuteHint = null;

          if (isEaBroker && typeof this.eaBridgeService?.getSignalForExecution === 'function') {
            const execution = await this.eaBridgeService.getSignalForExecution({
              broker: brokerId,
              symbol: pair
            });
            signal = execution?.signal || null;
            shouldExecuteHint = execution?.shouldExecute;
          } else {
            signal = await this.tradingEngine.generateSignal(pair, {
              broker: brokerId,
              ...(isEaBroker ? { eaOnly: true } : {})
            });
          }
          this.lastSignalCheck.set(lastKey, Date.now());

          logger.info(
            {
              module: 'TradeManager',
              broker: brokerId,
              pair,
              direction: signal.direction,
              strength: signal.strength,
              confidence: signal.confidence,
              isValid: signal.isValid?.isValid,
              decisionScore: signal.isValid?.decision?.score,
              decisionState: signal?.isValid?.decision?.state,
              shouldExecute: shouldExecuteHint
            },
            'Auto-trading signal evaluated'
          );

          const gate = this.evaluateExecutionGate({
            broker: brokerId,
            signal,
            source: 'scheduled',
            shouldExecuteHint
          });
          if (!gate.ok) {
            this.emitEvent('auto_trade_rejected', {
              broker: brokerId,
              pair,
              source: 'scheduled',
              reason: gate.reason,
              decisionScore: signal?.isValid?.decision?.score,
              confidence: signal?.confidence,
              strength: signal?.strength,
              ...(gate.details?.layersStatus ? { layersStatus: gate.details.layersStatus } : {}),
              signal
            });
            continue;
          }

          candidates.push(signal);
        } catch (error) {
          const classified = this.tradingEngine.classifyError?.(error, {
            scope: 'TradeManager.checkForNewSignals',
            pair,
            broker: brokerId
          }) || {
            type: 'unknown',
            category: 'Unknown engine error',
            context: { scope: 'TradeManager.checkForNewSignals', pair, broker: brokerId }
          };
          logger.error(
            {
              module: 'TradeManager',
              broker: brokerId,
              pair,
              err: error,
              errorType: classified.type
            },
            'Error checking signal for pair'
          );
        }
      }

      // Rank by decision score (preferred), then confidence/strength.
      candidates.sort((a, b) => {
        const sa = Number(a?.isValid?.decision?.score ?? -1);
        const sb = Number(b?.isValid?.decision?.score ?? -1);
        if (sb !== sa) {
          return sb - sa;
        }
        const ca = Number(a?.confidence ?? -1);
        const cb = Number(b?.confidence ?? -1);
        if (cb !== ca) {
          return cb - ca;
        }
        const ta = Number(a?.strength ?? -1);
        const tb = Number(b?.strength ?? -1);
        return tb - ta;
      });

      let opened = 0;
      for (const signal of candidates) {
        if (opened >= maxNewTradesPerCycle) {
          break;
        }

        const signalForBroker = {
          ...signal,
          brokerPreference: brokerId
        };

        this.emitEvent('auto_trade_attempt', {
          broker: brokerId,
          pair: signal?.pair,
          source: 'scheduled',
          decisionScore: signal?.isValid?.decision?.score,
          confidence: signal?.confidence,
          strength: signal?.strength,
          signal: signalForBroker
        });

        const result = await this.tradingEngine.executeTrade(signalForBroker);
        if (result.success) {
          opened += 1;

          const tradePayload = result.trade
            ? { ...result.trade, originSignal: result.trade?.originSignal || signalForBroker }
            : null;
          if (tradePayload) {
            this.emitEvent('trade_opened', tradePayload);
          }

          logger.info(
            {
              module: 'TradeManager',
              broker: brokerId,
              tradeId: result.trade?.id,
              pair: signal?.pair,
              decisionScore: signal?.isValid?.decision?.score
            },
            'Auto-trading opened trade'
          );
        } else {
          this.emitEvent('auto_trade_rejected', {
            broker: brokerId,
            pair: signal?.pair,
            source: 'scheduled',
            reason: result?.reason || 'Trade rejected',
            decisionScore: signal?.isValid?.decision?.score,
            confidence: signal?.confidence,
            strength: signal?.strength,
            signal: signalForBroker
          });
          logger.warn(
            { module: 'TradeManager', broker: brokerId, pair: signal?.pair, reason: result.reason },
            'Auto-trading trade rejected'
          );
        }
      }
    }
  }

  /**
   * Monitor active trades
   */
  async monitorActiveTrades() {
    if (!this.shouldMonitorTrades()) {
      return;
    }

    try {
      await this.tradingEngine.manageActiveTrades();
    } catch (error) {
      const classified = this.tradingEngine.classifyError?.(error, {
        scope: 'TradeManager.monitorActiveTrades'
      }) || {
        type: 'unknown',
        category: 'Unknown engine error',
        context: { scope: 'TradeManager.monitorActiveTrades' }
      };
      logger.error(
        { module: 'TradeManager', err: error, errorType: classified.type },
        'Error monitoring trades'
      );
    }
  }

  /**
   * Force close all trades
   */
  async closeAllTrades() {
    const trades = Array.from(this.tradingEngine.activeTrades.keys());
    const results = [];

    for (const tradeId of trades) {
      try {
        const trade = this.tradingEngine.activeTrades.get(tradeId);
        const currentPrice = await this.tradingEngine.getCurrentPriceForPair(trade.pair, {
          broker: trade?.broker || trade?.brokerRoute || null
        });
        const closed = await this.tradingEngine.closeTrade(tradeId, currentPrice, 'manual_close');
        results.push({ tradeId, success: true, trade: closed });
      } catch (error) {
        results.push({ tradeId, success: false, error: error.message });
      }
    }

    return {
      success: true,
      closed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length
    };
  }

  getStatus() {
    const enabledBrokers = this.getEnabledBrokerIds();
    const knownBrokers = Array.isArray(this.tradingEngine?.brokerRouter?.listConnectorIds?.())
      ? this.tradingEngine.brokerRouter.listConnectorIds()
      : ['mt4', 'mt5'];
    const enabledByBroker = {};
    for (const broker of knownBrokers) {
      const id = this.normalizeBrokerId(broker);
      if (!id) {
        continue;
      }
      enabledByBroker[id] = Boolean(this.autoTradingEnabledByBroker.get(id));
    }

    const defaultBroker = this.getDefaultBrokerId();
    const universeBroker = enabledBrokers[0] || defaultBroker;
    const signalUniverse = this.getPairsToScanForBroker(universeBroker);

    const forcedBrokerEnv = this.normalizeBrokerId(process.env.AUTO_TRADING_FORCE_BROKER);
    const preset = String(process.env.AUTO_TRADING_PRESET || '').trim() || null;
    const profile = String(process.env.AUTO_TRADING_PROFILE || '').trim() || null;
    const autostart = String(process.env.AUTO_TRADING_AUTOSTART || '').toLowerCase() === 'true';
    const smartStrongEnterScoreRaw = Number(process.env.AUTO_TRADING_SMART_STRONG_ENTER_SCORE);
    const smartStrongEnterScore = Number.isFinite(smartStrongEnterScoreRaw)
      ? smartStrongEnterScoreRaw
      : null;

    return {
      enabled: enabledBrokers.length > 0,
      enabledBrokers,
      enabledByBroker,
      autoTrading: {
        forcedBroker: forcedBrokerEnv || null,
        defaultBroker,
        universeBroker,
        preset,
        profile,
        autostart,
        smartStrongEnterScore
      },
      // For UI: show the live universe (not just the configured 7 majors).
      pairs: signalUniverse,
      configuredPairs: this.configuredPairs,
      activeTrades: this.tradingEngine.activeTrades.size,
      statistics: this.tradingEngine.getStatistics()
    };
  }
  addPair(pair) {
    if (!this.tradingPairs.includes(pair)) {
      this.tradingPairs.push(pair);
      return { success: true, message: `Added ${pair}`, pairs: this.tradingPairs };
    }
    return { success: false, message: `${pair} already exists` };
  }

  /**
      logger.error({ module: 'TradeManager', err: error }, 'Error monitoring trades');
   */
  removePair(pair) {
    const index = this.tradingPairs.indexOf(pair);
    if (index > -1) {
      this.tradingPairs.splice(index, 1);
      return { success: true, message: `Removed ${pair}`, pairs: this.tradingPairs };
    }
    return { success: false, message: `${pair} not found` };
  }
}

export default TradeManager;
