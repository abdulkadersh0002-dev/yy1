/**
 * Intelligent Trading Engine
 * Combines economic, news, and technical analysis for smart trading decisions
 */

import EconomicAnalyzer from '../analyzers/economic-analyzer.js';
import EnhancedNewsAnalyzer from '../analyzers/enhanced-news-analyzer.js';
import TechnicalAnalyzer from '../analyzers/technical-analyzer.js';
import FeatureStore from '../../infrastructure/services/feature-store.js';
import PriceDataFetcher from '../../infrastructure/data/price-data-fetcher.js';
import { createPersistenceAdapter } from '../../infrastructure/storage/persistence-adapter.js';
import { updatePerformanceMetrics } from '../../infrastructure/services/metrics.js';
import { analysisCore } from './modules/analysis-core.js';
import { riskEngine } from './modules/risk-engine.js';
import { executionEngine } from './modules/execution-engine.js';
import { persistenceHub } from './modules/persistence-hub.js';
import { orchestrationCoordinator } from './modules/orchestration-coordinator.js';
import { dataQualityGuard } from './modules/data-quality-guard.js';
import { createMarketRules } from './market-rules.js';
import {
  getPairMetadata,
  getPipSize,
  getPricePrecision,
  getSyntheticVolatility
} from '../../config/pair-catalog.js';
import {
  createTradingSignalDTO,
  createTradeDTO,
  normalizeEconomicAnalysis,
  normalizeNewsAnalysis,
  normalizeTechnicalAnalysis,
  validateTradingSignalDTO,
  validateTradeDTO,
  validateEconomicAnalysisDTO,
  validateNewsAnalysisDTO,
  validateTechnicalAnalysisDTO
} from '../../contracts/dtos.js';

class TradingEngine {
  constructor(config = {}) {
    this.config = {
      minSignalStrength: config.minSignalStrength || 35,
      riskPerTrade: config.riskPerTrade || 0.02,
      maxDailyRisk: config.maxDailyRisk || 0.06,
      maxConcurrentTrades: config.maxConcurrentTrades || 5,
      signalAmplifier: config.signalAmplifier || 2.5,
      directionThreshold: config.directionThreshold || 12,
      accountBalance: config.accountBalance || 10000,
      maxKellyFraction: config.maxKellyFraction ?? 0.035,
      minKellyFraction: config.minKellyFraction ?? 0.005,
      volatilityRiskMultipliers: config.volatilityRiskMultipliers || {
        calm: 1.15,
        normal: 1,
        volatile: 0.72,
        extreme: 0.55
      },
      correlationPenalty: config.correlationPenalty || {
        samePair: 0.35,
        sharedCurrency: 0.65
      },
      maxExposurePerCurrency: config.maxExposurePerCurrency || 180000,
      ...config
    };

    const dependencies = config.dependencies || {};
    const dependencyAlertBus = dependencies.alertBus || config.alertBus || null;

    this.persistence =
      dependencies.persistenceAdapter || createPersistenceAdapter(config.persistence || {});

    this.economicAnalyzer =
      dependencies.economicAnalyzer ||
      config.economicAnalyzer ||
      new EconomicAnalyzer(config.apiKeys || {});
    this.newsAnalyzer =
      dependencies.newsAnalyzer ||
      config.newsAnalyzer ||
      new EnhancedNewsAnalyzer(config.apiKeys || {}, {
        persistence: this.persistence
      });
    const priceDataOptions = {
      persistence: this.persistence,
      alertBus: dependencyAlertBus,
      allowUnconfiguredProviders: false,
      ...(config.priceData || {})
    };

    this.priceDataFetcher =
      dependencies.priceDataFetcher ||
      config.priceDataFetcher ||
      new PriceDataFetcher(config.apiKeys || {}, priceDataOptions);
    this.technicalAnalyzer =
      dependencies.technicalAnalyzer || config.technicalAnalyzer || new TechnicalAnalyzer();

    this.technicalAnalyzer.setPriceDataFetcher?.(this.priceDataFetcher);

    this.featureStore =
      dependencies.featureStore ||
      config.featureStoreInstance ||
      new FeatureStore({
        ...(config.featureStore || {}),
        persistence: this.persistence
      });

    if (typeof this.featureStore.setPersistence === 'function' && this.persistence) {
      this.featureStore.setPersistence(this.persistence);
    }
    this.technicalAnalyzer.setFeatureStore?.(this.featureStore);

    this.alertBus = dependencyAlertBus;
    this.brokerRouter = dependencies.brokerRouter || config.brokerRouter || null;
    this.jobQueue = dependencies.jobQueue || config.jobQueue || null;
    this.externalMarketContextProvider =
      dependencies.externalMarketContextProvider || config.externalMarketContextProvider || null;
    this.config.brokerRouting = this.config.brokerRouting || config.brokerRouting || {};
    this.alerting = {
      drawdownThresholdPct: config.alerting?.drawdownThresholdPct ?? 8,
      volatilityScoreThreshold: config.alerting?.volatilityScoreThreshold ?? 92,
      volatilityCooldownMs: config.alerting?.volatilityCooldownMs ?? 30 * 60 * 1000,
      exposureWarningFraction: config.alerting?.exposureWarningFraction ?? 0.9
    };
    const riskCenterConfig = config.riskCommandCenter || {};
    const normalizeCurrencyLimits = (limits) => {
      if (!limits || typeof limits !== 'object') {
        return limits || null;
      }
      return Object.fromEntries(
        Object.entries(limits).map(([currency, value]) => {
          const numericValue = Number(value);
          return [currency, Number.isFinite(numericValue) ? numericValue : value];
        })
      );
    };
    const normalizedLimits = normalizeCurrencyLimits(riskCenterConfig.currencyLimits);
    const explicitDefault = Number(riskCenterConfig.defaultCurrencyLimit);
    const fallbackDefault =
      normalizedLimits && Number.isFinite(Number(normalizedLimits.default))
        ? Math.abs(Number(normalizedLimits.default))
        : undefined;
    const defaultCurrencyLimit = Number.isFinite(explicitDefault)
      ? Math.abs(explicitDefault)
      : Number.isFinite(fallbackDefault)
        ? fallbackDefault
        : this.config.maxExposurePerCurrency || 0;
    this.config.riskCommandCenter = {
      enabled: riskCenterConfig.enabled !== false,
      blotterSize:
        Number.isFinite(riskCenterConfig.blotterSize) && riskCenterConfig.blotterSize > 0
          ? Math.floor(riskCenterConfig.blotterSize)
          : 25,
      currencyLimits: normalizedLimits,
      defaultCurrencyLimit,
      correlation: {
        enabled: riskCenterConfig.correlation?.enabled !== false,
        threshold: Number.isFinite(riskCenterConfig.correlation?.threshold)
          ? riskCenterConfig.correlation.threshold
          : 0.8,
        maxClusterSize: Number.isFinite(riskCenterConfig.correlation?.maxClusterSize)
          ? Math.max(1, Math.floor(riskCenterConfig.correlation.maxClusterSize))
          : 3,
        matrix: riskCenterConfig.correlation?.matrix || null
      },
      valueAtRisk: {
        enabled: riskCenterConfig.valueAtRisk?.enabled !== false,
        confidence: Number.isFinite(riskCenterConfig.valueAtRisk?.confidence)
          ? riskCenterConfig.valueAtRisk.confidence
          : 0.95,
        lookbackTrades: Number.isFinite(riskCenterConfig.valueAtRisk?.lookbackTrades)
          ? Math.max(5, Math.floor(riskCenterConfig.valueAtRisk.lookbackTrades))
          : 50,
        maxLossPct: Number.isFinite(riskCenterConfig.valueAtRisk?.maxLossPct)
          ? Math.abs(riskCenterConfig.valueAtRisk.maxLossPct)
          : 6,
        minSamples: Number.isFinite(riskCenterConfig.valueAtRisk?.minSamples)
          ? Math.max(5, Math.floor(riskCenterConfig.valueAtRisk.minSamples))
          : 20
      }
    };
    this.riskCommandConfig = this.config.riskCommandCenter;
    this.riskCommandMetrics = {
      exposures: {},
      currencyLimitBreaches: [],
      correlation: {
        enabled: this.riskCommandConfig.correlation.enabled,
        threshold: this.riskCommandConfig.correlation.threshold,
        maxCluster: this.riskCommandConfig.correlation.maxClusterSize,
        blocked: false,
        correlations: [],
        clusterLoad: []
      },
      var: null,
      pnlSummary: {
        realized: 0,
        unrealized: 0,
        net: 0,
        bestTrade: null,
        worstTrade: null
      },
      blotter: {
        openTrades: [],
        recentClosed: []
      },
      updatedAt: Date.now()
    };

    this.dependencies = {
      persistence: this.persistence,
      economicAnalyzer: this.economicAnalyzer,
      newsAnalyzer: this.newsAnalyzer,
      priceDataFetcher: this.priceDataFetcher,
      technicalAnalyzer: this.technicalAnalyzer,
      featureStore: this.featureStore,
      alertBus: this.alertBus,
      brokerRouter: this.brokerRouter,
      jobQueue: this.jobQueue,
      externalMarketContextProvider: this.externalMarketContextProvider
    };

    this.marketRules = createMarketRules(this.config.marketRules || {});
    this.dependencies.marketRules = this.marketRules;

    this.newsInsights = new Map();
    this.activeTrades = new Map();
    this.tradingHistory = [];
    this.dataQualityAssessments = new Map();
    this.dailyRisk = 0;
    this.lastResetDate = new Date().toDateString();
    this.volatilityAlertTimestamps = new Map();
    this.exposureAlertTimestamps = new Map();
    const startingEquity = this.config.accountBalance || 10000;
    this.performanceMetrics = {
      startingEquity,
      equityCurve: [startingEquity],
      peakEquity: startingEquity,
      maxDrawdownPct: 0,
      cumulativeReturnPct: 0,
      lastAlertedDrawdownPct: 0,
      latestEquity: startingEquity
    };
    this.lastBrokerSync = 0;

    // Lightweight, in-memory cache for recent analytics to avoid duplicate work
    this.analyticsCache = {
      entryByPair: new Map(),
      winRateByKey: new Map(),
      marketMemoryByPair: new Map(),
      quoteTelemetryByPair: new Map(),
      telemetryByPair: new Map()
    };

    this.rejectionStats = {
      total: 0,
      byPrimary: new Map(),
      bySecondary: new Map(),
      recent: [],
      maxRecent: 200
    };

    this.performanceByPair = new Map();
    this.performanceByStrategy = new Map();

    this.bindAnalysisCoreMethods();
    this.bindRiskEngineMethods();
    this.bindExecutionEngineMethods();
    this.bindPersistenceHubMethods();
    this.bindOrchestrationCoordinator();
    this.bindDataQualityGuard();
    this.updateVaRMetrics();
    this.refreshRiskCommandSnapshot();
  }

  setExternalMarketContextProvider(provider) {
    this.externalMarketContextProvider = provider || null;
    if (this.dependencies && typeof this.dependencies === 'object') {
      this.dependencies.externalMarketContextProvider = this.externalMarketContextProvider;
    }
  }

  classifyError(error, context = {}) {
    const message = error?.message || '';
    const name = error?.name || '';

    if (
      message.includes('ECON_API') ||
      message.includes('NEWS_API') ||
      message.includes('PRICE_API') ||
      message.includes('NETWORK') ||
      /ECONOMICS?|NEWS?|PRICE|HTTP|NETWORK/i.test(message + name)
    ) {
      return { type: 'provider', category: 'Provider/API failure', context };
    }

    if (message.includes('ANALYZER') || /ANALYZER|ANALYSIS|SCORER|MODEL/i.test(message + name)) {
      return { type: 'analyzer', category: 'Analyzer failure', context };
    }

    if (
      message.includes('BROKER') ||
      message.includes('EXECUTION') ||
      /BROKER|EXECUTION|ORDER|POSITION/i.test(message + name)
    ) {
      return { type: 'execution', category: 'Execution/broker failure', context };
    }

    return { type: 'unknown', category: 'Unknown engine error', context };
  }

  recordMarketMemory(pair, { at, price, day, week } = {}) {
    const p = String(pair || '').trim();
    if (!p) {
      return null;
    }

    if (!this.analyticsCache || typeof this.analyticsCache !== 'object') {
      this.analyticsCache = { marketMemoryByPair: new Map() };
    }
    if (!(this.analyticsCache.marketMemoryByPair instanceof Map)) {
      this.analyticsCache.marketMemoryByPair = new Map();
    }

    const px = Number(price);
    const dHigh = Number(day?.high);
    const dLow = Number(day?.low);
    const wHigh = Number(week?.high);
    const wLow = Number(week?.low);

    if (!Number.isFinite(px)) {
      return null;
    }

    const touches = [];
    const proximity = {};

    if (Number.isFinite(dHigh) && Number.isFinite(dLow) && dHigh > dLow) {
      const dr = dHigh - dLow;
      const thr = dr * 0.03;
      const distHigh = Math.abs(px - dHigh);
      const distLow = Math.abs(px - dLow);
      proximity.day = {
        high: dHigh,
        low: dLow,
        range: dr,
        distToHigh: Number(distHigh.toFixed(6)),
        distToLow: Number(distLow.toFixed(6)),
        nearHigh: distHigh <= thr,
        nearLow: distLow <= thr,
        pos: Number(((px - dLow) / dr).toFixed(4))
      };
      if (distHigh <= thr) {
        touches.push('dayHigh');
      }
      if (distLow <= thr) {
        touches.push('dayLow');
      }
    }

    if (Number.isFinite(wHigh) && Number.isFinite(wLow) && wHigh > wLow) {
      const wr = wHigh - wLow;
      const thr = wr * 0.03;
      const distHigh = Math.abs(px - wHigh);
      const distLow = Math.abs(px - wLow);
      proximity.week = {
        high: wHigh,
        low: wLow,
        range: wr,
        distToHigh: Number(distHigh.toFixed(6)),
        distToLow: Number(distLow.toFixed(6)),
        nearHigh: distHigh <= thr,
        nearLow: distLow <= thr,
        pos: Number(((px - wLow) / wr).toFixed(4))
      };
      if (distHigh <= thr) {
        touches.push('weeklyHigh');
      }
      if (distLow <= thr) {
        touches.push('weeklyLow');
      }
    }

    // Only store when we are actually near a key level.
    if (!touches.length) {
      return null;
    }

    const entry = {
      at: Number.isFinite(Number(at)) ? Number(at) : Date.now(),
      price: px,
      touches,
      proximity
    };

    const list = this.analyticsCache.marketMemoryByPair.get(p) || [];
    list.push(entry);
    const MAX = 80;
    if (list.length > MAX) {
      list.splice(0, list.length - MAX);
    }
    this.analyticsCache.marketMemoryByPair.set(p, list);

    return entry;
  }

  getMarketMemory(pair, { limit = 6 } = {}) {
    const p = String(pair || '').trim();
    if (!p || !(this.analyticsCache?.marketMemoryByPair instanceof Map)) {
      return { available: false, recent: [] };
    }
    const list = this.analyticsCache.marketMemoryByPair.get(p) || [];
    const recent = list.slice(-Math.max(1, Math.min(50, Number(limit) || 6))).reverse();
    return {
      available: Boolean(recent.length),
      recent
    };
  }

  setBrokerRouter(router) {
    this.brokerRouter = router;
    this.dependencies.brokerRouter = router;
  }

  hasBrokerRouting() {
    return Boolean(this.brokerRouter);
  }

  bindAnalysisCoreMethods() {
    Object.entries(analysisCore).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  bindRiskEngineMethods() {
    Object.entries(riskEngine).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  bindExecutionEngineMethods() {
    Object.entries(executionEngine).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  bindPersistenceHubMethods() {
    Object.entries(persistenceHub).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  bindOrchestrationCoordinator() {
    Object.entries(orchestrationCoordinator).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  bindDataQualityGuard() {
    Object.entries(dataQualityGuard).forEach(([name, fn]) => {
      if (typeof fn === 'function') {
        this[name] = fn.bind(this);
      }
    });
  }

  getInstrumentMetadata(pair) {
    return getPairMetadata(pair);
  }

  async syncBrokerFills() {
    if (!this.brokerRouter?.runReconciliation) {
      return [];
    }
    return this.brokerRouter.runReconciliation();
  }

  estimateWinRate({ direction, strength, confidence, entry, components }) {
    if (direction === 'NEUTRAL') {
      return 50;
    }

    const technicalScoreRaw = components?.technical?.score ?? 0;
    const newsConfidenceRaw = components?.news?.confidence ?? 0;
    const economicScoreRaw =
      components?.economic?.score ?? components?.economic?.details?.relativeSentiment ?? 0;
    const riskRewardRaw = entry?.riskReward ?? 0;
    const riskRewardNumber = Number(riskRewardRaw);

    const cacheKey = JSON.stringify({
      direction,
      strength: Math.round(strength ?? 0),
      confidence: Math.round(confidence ?? 0),
      technicalScore: Math.round(technicalScoreRaw),
      newsConfidence: Math.round(newsConfidenceRaw),
      economicScore: Math.round(economicScoreRaw),
      riskReward: Number((Number.isFinite(riskRewardNumber) ? riskRewardNumber : 0).toFixed(2)),
      trailingEnabled: Boolean(entry?.trailingStop?.enabled)
    });

    const cached = this.analyticsCache.winRateByKey.get(cacheKey);
    if (typeof cached === 'number') {
      return cached;
    }

    const clampedStrength = Math.min(Math.max(strength || 0, 0), 100);
    const clampedConfidence = Math.min(Math.max(confidence || 0, 0), 100);
    const technicalAbs = Math.min(Math.abs(technicalScoreRaw || 0), 100);
    const newsConfidence = Math.min(Math.max(newsConfidenceRaw || 0, 0), 100);
    const economicAbs = Math.min(Math.abs(economicScoreRaw || 0), 100);
    const riskReward = Math.min(Math.max(riskRewardRaw || 0, 0), 4);

    // Build a conservative edge score (0..100) and map it to a probability-like estimate (35..90).
    const edgeScore =
      clampedStrength * 0.34 +
      clampedConfidence * 0.3 +
      technicalAbs * 0.18 +
      economicAbs * 0.1 +
      newsConfidence * 0.05 +
      Math.min(20, Math.max(0, (riskReward - 1) * 10));

    const centered = (edgeScore - 55) / 12;
    const sigmoid = 1 / (1 + Math.exp(-centered));
    let estimate = 35 + sigmoid * 55;

    if (entry?.trailingStop?.enabled) {
      estimate += 1.2;
    }

    estimate = Math.max(35, Math.min(90, estimate));

    const finalEstimate = parseFloat(estimate.toFixed(1));
    this.analyticsCache.winRateByKey.set(cacheKey, finalEstimate);
    return finalEstimate;
  }

  buildTradePlan(pair, direction, entry, winRate, confidence) {
    if (!entry || direction === 'NEUTRAL') {
      return 'No active trade plan. Monitoring for stronger confirmation.';
    }

    const side = direction === 'BUY' ? 'Buy' : 'Sell';
    const slPips = entry.stopLossPips != null ? `${entry.stopLossPips} pips` : 'n/a';
    const tpPips = entry.takeProfitPips != null ? `${entry.takeProfitPips} pips` : 'n/a';
    const rr = entry.riskReward ? `${entry.riskReward}:1` : 'n/a';

    const winRateDisplay = Number.isFinite(Number(winRate)) ? Number(winRate).toFixed(1) : 'n/a';
    const confidenceDisplay = Number.isFinite(Number(confidence))
      ? Number(confidence).toFixed(1)
      : 'n/a';

    return [
      `${side} ${pair} (${direction}) near ${entry.price}`,
      `Stop ${entry.stopLoss} (${slPips})`,
      `Target ${entry.takeProfit} (${tpPips})`,
      `Risk/Reward ${rr}`,
      `Estimated edge ${winRateDisplay}% | Confidence ${confidenceDisplay}%`
    ].join(' | ');
  }

  /**
   * Calculate entry parameters
   */
  calculateEntryParameters(pair, direction, technical, marketPrice) {
    if (direction === 'NEUTRAL') {
      return null;
    }

    const volatilitySummary = technical?.volatilitySummary || technical?.volatility || {};

    // Build a stable cache key for this pair/direction and current volatility regime
    const cacheKey = JSON.stringify({
      pair,
      direction,
      marketPrice: typeof marketPrice === 'number' ? Number(marketPrice.toFixed(5)) : null,
      volatilityState: volatilitySummary.state || 'normal',
      volatilityScore: Number.isFinite(volatilitySummary.averageScore)
        ? Math.round(volatilitySummary.averageScore)
        : Number.isFinite(volatilitySummary.volatilityScore)
          ? Math.round(volatilitySummary.volatilityScore)
          : 0
    });

    const cachedEntry = this.analyticsCache.entryByPair.get(cacheKey);
    if (cachedEntry) {
      return { ...cachedEntry };
    }

    // Get current price from technical analysis (fallback to live fetch result)
    const currentPrice =
      typeof marketPrice === 'number' ? marketPrice : this.getCurrentPrice(technical);

    if (typeof currentPrice !== 'number' || Number.isNaN(currentPrice)) {
      return null;
    }

    const volatilityScoreRaw = Number.isFinite(volatilitySummary.averageScore)
      ? volatilitySummary.averageScore
      : (volatilitySummary.volatilityScore ?? 70);
    const volatilityScore = Math.min(Math.max(volatilityScoreRaw, 25), 140);
    const volatilityState = (volatilitySummary.state || 'normal').toLowerCase();

    // Calculate ATR for stop loss and take profit
    const atr = this.getATR(pair, technical, currentPrice);

    // Volatility-adjusted stop distance derived from ATR and regime state
    const baseStopMultiple = 1.2 + volatilityScore / 100;
    let stopMultiple = baseStopMultiple;
    if (volatilityState === 'calm') {
      stopMultiple *= 0.9;
    } else if (volatilityState === 'volatile') {
      stopMultiple *= 1.18;
    } else if (volatilityState === 'extreme') {
      stopMultiple *= 1.32;
    }
    stopMultiple = Math.max(1.05, Math.min(stopMultiple, 2.6));
    const stopLossDistance = atr * stopMultiple;

    const rewardBias =
      volatilityState === 'calm' ? 1.55 : volatilityState === 'volatile' ? 1.35 : 1.45;
    let takeProfitMultiple = Math.max(1.6, Math.min(stopMultiple * rewardBias, 3.6));

    // Enforce minimum risk/reward ratio regardless of volatility adjustments
    const minRequiredMultiple = stopMultiple * 1.6;
    if (takeProfitMultiple < minRequiredMultiple) {
      takeProfitMultiple = Math.min(Math.max(minRequiredMultiple, 1.6), 4.8);
    }

    const takeProfitDistance = atr * takeProfitMultiple;

    const entry = {
      price: this.formatPrice(pair, currentPrice),
      direction,
      stopLoss: this.formatPrice(
        pair,
        direction === 'BUY' ? currentPrice - stopLossDistance : currentPrice + stopLossDistance
      ),
      takeProfit: this.formatPrice(
        pair,
        direction === 'BUY' ? currentPrice + takeProfitDistance : currentPrice - takeProfitDistance
      ),
      atr: parseFloat(atr.toFixed(5)),
      riskReward: parseFloat((takeProfitMultiple / stopMultiple).toFixed(2)),
      stopMultiple: parseFloat(stopMultiple.toFixed(3)),
      takeProfitMultiple: parseFloat(takeProfitMultiple.toFixed(3)),
      volatilityState
    };

    // Optional: refine SL/TP using nearby support/resistance + pivots when available.
    // This improves realism by anchoring risk to structure instead of pure ATR.
    try {
      const timeframes =
        technical?.timeframes && typeof technical.timeframes === 'object'
          ? technical.timeframes
          : {};

      const pickFrame = (preferred = []) => {
        for (const tf of preferred) {
          const frame = timeframes?.[tf] || timeframes?.[String(tf || '').toLowerCase()] || null;
          if (!frame || typeof frame !== 'object') {
            continue;
          }
          const sr = frame.supportResistance;
          const hasSr =
            sr &&
            typeof sr === 'object' &&
            (Array.isArray(sr.support) || Array.isArray(sr.resistance));
          const piv = frame.pivotPoints;
          const hasPiv = piv && typeof piv === 'object';
          if (hasSr || hasPiv) {
            return frame;
          }
        }
        return null;
      };

      const frame = pickFrame(['H1', 'M15', 'H4', 'D1']);
      const sr =
        frame?.supportResistance && typeof frame.supportResistance === 'object'
          ? frame.supportResistance
          : null;
      const piv =
        frame?.pivotPoints && typeof frame.pivotPoints === 'object' ? frame.pivotPoints : null;

      const current = currentPrice;
      const buffer = Math.max(atr * 0.12, atr * 0.06);

      const pullLevels = () => {
        const supports = [];
        const resistances = [];

        if (sr) {
          const s = Array.isArray(sr.support) ? sr.support : [];
          const r = Array.isArray(sr.resistance) ? sr.resistance : [];
          s.forEach((v) => {
            const n = Number(v);
            if (Number.isFinite(n)) {
              supports.push(n);
            }
          });
          r.forEach((v) => {
            const n = Number(v);
            if (Number.isFinite(n)) {
              resistances.push(n);
            }
          });
        }

        if (piv) {
          const pivotKeys = ['pivot', 'p', 's1', 's2', 's3', 'r1', 'r2', 'r3'];
          pivotKeys.forEach((k) => {
            const n = Number(piv?.[k]);
            if (!Number.isFinite(n)) {
              return;
            }
            if (n < current) {
              supports.push(n);
            } else if (n > current) {
              resistances.push(n);
            }
          });
        }

        supports.sort((a, b) => b - a);
        resistances.sort((a, b) => a - b);
        return { supports, resistances };
      };

      const { supports, resistances } = pullLevels();
      if (supports.length || resistances.length) {
        const minRr = Number.isFinite(Number(this.config.minRiskReward))
          ? Number(this.config.minRiskReward)
          : 1.6;

        const pickNearestBelow = (levels) => {
          const candidates = levels.filter((lvl) => Number.isFinite(lvl) && lvl < current);
          return candidates.length ? Math.max(...candidates) : null;
        };
        const pickNearestAbove = (levels) => {
          const candidates = levels.filter((lvl) => Number.isFinite(lvl) && lvl > current);
          return candidates.length ? Math.min(...candidates) : null;
        };

        const nearestSupport = pickNearestBelow(supports);
        const nearestResistance = pickNearestAbove(resistances);

        const baseSl = Number(entry.stopLoss);
        const baseTp = Number(entry.takeProfit);

        const propose = () => {
          if (direction === 'BUY') {
            const slAnchor = nearestSupport;
            const tpAnchor = nearestResistance;
            const sl = Number.isFinite(slAnchor) ? slAnchor - buffer : baseSl;
            const tp = Number.isFinite(tpAnchor) ? tpAnchor - buffer : baseTp;
            return { sl, tp };
          }
          if (direction === 'SELL') {
            const slAnchor = nearestResistance;
            const tpAnchor = nearestSupport;
            const sl = Number.isFinite(slAnchor) ? slAnchor + buffer : baseSl;
            const tp = Number.isFinite(tpAnchor) ? tpAnchor + buffer : baseTp;
            return { sl, tp };
          }
          return null;
        };

        const proposal = propose();
        if (proposal && Number.isFinite(proposal.sl) && Number.isFinite(proposal.tp)) {
          const slDist = Math.abs(current - proposal.sl);
          const tpDist = Math.abs(proposal.tp - current);
          const rr = slDist > 0 ? tpDist / slDist : null;

          const slOk = slDist >= atr * 0.6 && slDist <= atr * 3.2;
          const tpOk = tpDist >= atr * 0.7;
          const rrOk = rr != null && rr >= minRr && rr <= 5;

          // Also ensure SL/TP are on the correct sides.
          const sidesOk =
            direction === 'BUY'
              ? proposal.sl < current && proposal.tp > current
              : direction === 'SELL'
                ? proposal.sl > current && proposal.tp < current
                : false;

          if (slOk && tpOk && rrOk && sidesOk) {
            entry.stopLoss = this.formatPrice(pair, proposal.sl);
            entry.takeProfit = this.formatPrice(pair, proposal.tp);
            entry.riskReward = parseFloat(rr.toFixed(2));
            entry.stopMultiple = parseFloat((slDist / atr).toFixed(3));
            entry.takeProfitMultiple = parseFloat((tpDist / atr).toFixed(3));

            // Refresh trailing-stop distances to match the adjusted plan.
            const newStopDist = slDist;
            const newTpDist = tpDist;
            entry.trailingStop = {
              enabled: true,
              breakevenAtFraction: 0.5,
              activationAtFraction: 0.6,
              activationLevel: newTpDist * 0.6,
              trailingDistance: newStopDist * 0.8,
              stepDistance: newStopDist * 0.2
            };
          }
        }
      }
    } catch (_error) {
      // best-effort
    }

    // Add trailing stop parameters
    entry.trailingStop = {
      enabled: true,
      // Move SL to breakeven at 50% of TP; then activate step-trailing a bit later.
      breakevenAtFraction: 0.5,
      activationAtFraction: 0.6,
      // Backwards-compatible numeric activation level (price distance).
      activationLevel: takeProfitDistance * 0.6,
      trailingDistance: stopLossDistance * 0.8,
      // Only update SL when improvement is meaningful.
      stepDistance: stopLossDistance * 0.2
    };

    if (entry.price != null && entry.stopLoss != null) {
      entry.stopLossPips = parseFloat(
        this.calculatePips(pair, Math.abs(entry.price - entry.stopLoss)).toFixed(1)
      );
    }

    if (entry.takeProfit != null && entry.price != null) {
      entry.takeProfitPips = parseFloat(
        this.calculatePips(pair, Math.abs(entry.takeProfit - entry.price)).toFixed(1)
      );
    }

    this.analyticsCache.entryByPair.set(cacheKey, { ...entry });
    return entry;
  }

  /**
   * Validate if signal meets trading criteria
   */
  validateSignal(signal) {
    const now = Date.now();
    const calendarEvents = Array.isArray(signal.components?.news?.calendarEvents)
      ? signal.components.news.calendarEvents
      : [];
    const marketData = signal.components?.marketData || null;
    const blackoutMinutes = Number.isFinite(this.config.newsBlackoutMinutes)
      ? this.config.newsBlackoutMinutes
      : 30;
    const blackoutImpact = Number.isFinite(this.config.newsBlackoutImpactThreshold)
      ? this.config.newsBlackoutImpactThreshold
      : 10;

    const pair = String(signal?.pair || '').trim() || null;
    const assetClass = this.classifyAssetClass(pair);

    // Default spread gates tuned by asset class.
    // For FX, align defaults with the data-quality spread thresholds so we don't double-penalize
    // by marking spread as "critical" and also failing a stricter hard gate.
    const normalizePairCategory = (rawPair) => {
      const value = String(rawPair || '')
        .trim()
        .toUpperCase();
      const majors = new Set([
        'EURUSD',
        'GBPUSD',
        'USDJPY',
        'AUDUSD',
        'USDCHF',
        'USDCAD',
        'NZDUSD'
      ]);
      if (majors.has(value)) {
        return 'majors';
      }
      if (value.endsWith('JPY')) {
        return 'yen';
      }
      if (value.startsWith('EUR') || value.startsWith('GBP') || value.startsWith('AUD')) {
        return 'minors';
      }
      return 'crosses';
    };

    const defaultMaxSpreadPips = (() => {
      if (assetClass === 'crypto') {
        return 25;
      }
      if (assetClass === 'metals') {
        return 6;
      }
      if (assetClass === 'forex') {
        const category = normalizePairCategory(pair);
        if (category === 'majors') {
          return 3.8;
        }
        if (category === 'yen') {
          return 4.2;
        }
        if (category === 'minors') {
          return 5.0;
        }
        return 6.2;
      }
      return 6.0;
    })();
    const maxSpreadPips = Number.isFinite(this.config.maxSpreadPips)
      ? this.config.maxSpreadPips
      : defaultMaxSpreadPips;

    // Expose the resolved spread gate for dashboards/audits.
    if (marketData && typeof marketData === 'object') {
      marketData.maxSpreadPips = maxSpreadPips;
    }

    const parseEventTimeMs = (evt) => {
      const raw = evt?.time ?? evt?.datetime ?? evt?.dateTime ?? evt?.timestamp ?? null;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 2_000_000_000 ? raw * 1000 : raw;
      }
      if (raw instanceof Date) {
        return raw.getTime();
      }
      if (!raw) {
        return NaN;
      }
      const parsed = Date.parse(String(raw));
      return Number.isFinite(parsed) ? parsed : NaN;
    };

    const normalizeCurrency = (value) =>
      String(value || '')
        .trim()
        .toUpperCase();

    const splitFxPair = (symbol) => {
      const s = String(symbol || '')
        .trim()
        .toUpperCase();
      if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
        return { base: s.slice(0, 3), quote: s.slice(3, 6) };
      }
      return null;
    };

    const fxCurrencies = assetClass === 'forex' ? splitFxPair(pair) : null;

    const macroCurrencies = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);

    const isEventRelevantToPair = (evt) => {
      const cur = normalizeCurrency(evt?.currency);
      if (!cur) {
        // If the calendar doesn't provide a currency, treat as potentially relevant.
        return true;
      }
      if (!fxCurrencies) {
        // Crypto/indices often behave like USD macro proxies.
        if (assetClass === 'crypto') {
          return cur === 'USD' || cur === 'EUR';
        }
        return macroCurrencies.has(cur);
      }
      return cur === fxCurrencies.base || cur === fxCurrencies.quote;
    };

    const hasHighImpactSoon = calendarEvents.some((event) => {
      const impact = Number(event?.impact);
      if (!Number.isFinite(impact) || impact < blackoutImpact) {
        return false;
      }
      if (!isEventRelevantToPair(event)) {
        return false;
      }
      const t = parseEventTimeMs(event);
      if (!Number.isFinite(t)) {
        return false;
      }
      const deltaMinutes = (t - now) / 60000;
      return Math.abs(deltaMinutes) <= blackoutMinutes;
    });

    const enforceTradingWindows =
      this.config?.enforceTradingWindows != null
        ? Boolean(this.config.enforceTradingWindows)
        : false;
    const tradingWindowsLondon = Array.isArray(this.config?.tradingWindowsLondon)
      ? this.config.tradingWindowsLondon
      : [
          { start: '08:00', end: '12:00' },
          { start: '14:00', end: '16:00' }
        ];

    const withinTradingWindow = (() => {
      if (!enforceTradingWindows) {
        return true;
      }
      if (assetClass !== 'forex') {
        return true;
      }
      try {
        const d = new Date(now);
        const hour = Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London',
            hour: '2-digit',
            hour12: false
          }).format(d)
        );
        const minute = Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London',
            minute: '2-digit'
          }).format(d)
        );
        const minutesOfDay = hour * 60 + minute;

        const parseHm = (text) => {
          const raw = String(text || '').trim();
          const m = raw.match(/^(\d{1,2}):(\d{2})$/);
          if (!m) {
            return null;
          }
          const hh = Number(m[1]);
          const mm = Number(m[2]);
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
            return null;
          }
          return Math.max(0, Math.min(23, hh)) * 60 + Math.max(0, Math.min(59, mm));
        };

        for (const w of tradingWindowsLondon) {
          const start = parseHm(w?.start);
          const end = parseHm(w?.end);
          if (start == null || end == null) {
            continue;
          }
          if (minutesOfDay >= start && minutesOfDay < end) {
            return true;
          }
        }
        return false;
      } catch (_e) {
        return true;
      }
    })();

    // Risk is only a hard blocker when we actually have an entry to size.
    // If entry isn't computed yet (or lacks levels), keep analysis running.
    const entry = signal?.entry && typeof signal.entry === 'object' ? signal.entry : null;
    const hasEntryLevels =
      entry &&
      Number.isFinite(Number(entry.price)) &&
      Number.isFinite(Number(entry.stopLoss)) &&
      Number.isFinite(Number(entry.takeProfit));
    const hasLocalRiskFlag = typeof signal?.riskManagement?.canTrade === 'boolean';
    const isEaSourced = Boolean(marketData?.eaQuote && typeof marketData.eaQuote === 'object');
    const withinRiskLimit = !hasEntryLevels
      ? true
      : hasLocalRiskFlag
        ? Boolean(signal?.riskManagement?.canTrade) &&
          this.activeTrades.size < this.config.maxConcurrentTrades
        : isEaSourced
          ? this.activeTrades.size < this.config.maxConcurrentTrades
          : false;

    // Market freshness hard-block should only mean: we have a live provider and it's not in a
    // circuit-breaker / explicitly blocked state. Historical completeness belongs to soft penalties.
    const mdStatus = String(marketData?.status || '').toLowerCase();
    const mdRecommendation = String(marketData?.recommendation || '').toLowerCase();
    const mdIssues = Array.isArray(marketData?.issues) ? marketData.issues.map(String) : [];
    const hasCircuitBreaker = Boolean(marketData?.circuitBreaker);
    const isExplicitlyBlocked =
      hasCircuitBreaker ||
      mdIssues.some((issue) => issue.includes('circuit_breaker')) ||
      mdIssues.some((issue) => issue.includes('provider_unavailable'));

    const marketDataFresh =
      !marketData ||
      (marketData.stale !== true &&
        (mdStatus !== 'critical' || !isExplicitlyBlocked) &&
        (mdRecommendation !== 'block' || !isExplicitlyBlocked));

    const spreadPips = Number.isFinite(Number(marketData?.spreadPips))
      ? Number(marketData.spreadPips)
      : null;

    const eaBid = Number(marketData?.eaQuote?.bid);
    const eaAsk = Number(marketData?.eaQuote?.ask);
    const eaMid =
      Number.isFinite(eaBid) && Number.isFinite(eaAsk) && eaBid > 0 && eaAsk > 0
        ? (eaBid + eaAsk) / 2
        : null;
    const eaSpreadRelative =
      eaMid != null &&
      Number.isFinite(eaMid) &&
      eaMid > 0 &&
      Number.isFinite(eaBid) &&
      Number.isFinite(eaAsk) &&
      eaBid > 0 &&
      eaAsk > 0
        ? Math.abs(eaAsk - eaBid) / eaMid
        : null;

    const spreadOk = (() => {
      // FX/metals/crypto: pip-based gate (existing behavior).
      if (assetClass === 'forex' || assetClass === 'metals' || assetClass === 'crypto') {
        return spreadPips == null || spreadPips <= maxSpreadPips;
      }

      // CFDs/indices/etc: use relative spread (price-scaled) so symbols don't get
      // incorrectly blocked by FX pip math.
      const envMaxRel = Number(process.env.CFD_MAX_SPREAD_RELATIVE);
      const maxRel = Number.isFinite(envMaxRel) ? Math.max(0, envMaxRel) : 0.003; // 0.3%

      if (marketData && typeof marketData === 'object') {
        marketData.maxSpreadRelative = maxRel;
      }

      return eaSpreadRelative == null || eaSpreadRelative <= maxRel;
    })();

    const dataQualityOk = (() => {
      const dq = marketData && typeof marketData === 'object' ? marketData : null;
      if (!dq) {
        return true;
      }
      if (dq.circuitBreaker) {
        return false;
      }
      const recommendation = String(dq.recommendation || '').toLowerCase();
      if (recommendation === 'block') {
        return false;
      }
      if (dq.confidenceFloorBreached) {
        return false;
      }
      return true;
    })();

    const hardChecks = {
      marketDataFresh,
      spreadOk,
      noHighImpactNewsSoon: !hasHighImpactSoon,
      withinRiskLimit,
      withinTradingWindow,
      dataQualityOk
    };

    let blocked = Object.values(hardChecks).some((v) => v !== true);

    const atrPrice = entry && Number.isFinite(Number(entry.atr)) ? Number(entry.atr) : null;
    const atrPips =
      atrPrice != null && typeof this.calculatePips === 'function'
        ? Number(this.calculatePips(pair || '', Math.abs(atrPrice)).toFixed(3))
        : null;

    const enforceFxAtrRange =
      this.config?.enforceFxAtrRange != null ? Boolean(this.config.enforceFxAtrRange) : true;
    const fxAtrRangeOk = (() => {
      if (!enforceFxAtrRange) {
        return true;
      }
      if (assetClass !== 'forex') {
        return true;
      }
      if (atrPips == null || !Number.isFinite(atrPips)) {
        return true;
      }
      const min = Number.isFinite(Number(process.env.FX_ATR_PIPS_MIN))
        ? Number(process.env.FX_ATR_PIPS_MIN)
        : 3;
      const max = Number.isFinite(Number(process.env.FX_ATR_PIPS_MAX))
        ? Number(process.env.FX_ATR_PIPS_MAX)
        : 300;
      return atrPips >= min && atrPips <= max;
    })();

    hardChecks.fxAtrRangeOk = fxAtrRangeOk;
    blocked = Object.values(hardChecks).some((v) => v !== true);
    const stopLossPips =
      entry && Number.isFinite(Number(entry.stopLossPips)) ? Number(entry.stopLossPips) : null;
    const takeProfitPips =
      entry && Number.isFinite(Number(entry.takeProfitPips)) ? Number(entry.takeProfitPips) : null;
    const riskReward =
      entry && Number.isFinite(Number(entry.riskReward)) ? Number(entry.riskReward) : null;

    const strength = Number.isFinite(Number(signal?.strength)) ? Number(signal.strength) : 0;
    const confidence = Number.isFinite(Number(signal?.confidence)) ? Number(signal.confidence) : 0;
    const estimatedWinRate = Number.isFinite(Number(signal?.estimatedWinRate))
      ? Number(signal.estimatedWinRate)
      : 50;

    const profile = this.getDecisionProfile(assetClass);

    const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
    const smooth01 = (x) => {
      const t = clamp01(x);
      return t * t * (3 - 2 * t);
    };

    // Contributors (soft): direction/strength/probability/rr/confidence become weighted inputs.
    const directionScore = signal?.direction === 'NEUTRAL' ? 0.4 : 1.0;
    const strengthScore = smooth01((strength - profile.minStrength) / (100 - profile.minStrength));
    const probabilityScore = smooth01(
      (estimatedWinRate - profile.minWinRate) / (95 - profile.minWinRate)
    );
    const confidenceScore = smooth01(
      (confidence - profile.minConfidence) / (100 - profile.minConfidence)
    );
    const rrScore =
      riskReward == null
        ? 0.45
        : smooth01(
            (riskReward - profile.minRiskReward) /
              (profile.targetRiskReward - profile.minRiskReward)
          );

    // Normalized spread penalties (soft): spread vs ATR and spread vs target move.
    const spreadToAtr =
      spreadPips != null && atrPips != null && atrPips > 0
        ? Number((spreadPips / atrPips).toFixed(4))
        : null;
    const spreadToTp =
      spreadPips != null && takeProfitPips != null && takeProfitPips > 0
        ? Number((spreadPips / takeProfitPips).toFixed(4))
        : null;

    const spreadEfficiencyScore = (() => {
      // 1.0 is great; approaches 0 as spread consumes ATR/TP.
      const atrFactor =
        spreadToAtr == null ? 1 : clamp01(1 - spreadToAtr / profile.maxSpreadToAtrWarn);
      const tpFactor = spreadToTp == null ? 1 : clamp01(1 - spreadToTp / profile.maxSpreadToTpWarn);
      return clamp01(0.5 * atrFactor + 0.5 * tpFactor);
    })();

    const enforceSpreadToAtrHard =
      this.config?.enforceSpreadToAtrHard != null
        ? Boolean(this.config.enforceSpreadToAtrHard)
        : false;
    const maxSpreadToAtrHard = Number.isFinite(Number(this.config?.maxSpreadToAtrHard))
      ? Number(this.config.maxSpreadToAtrHard)
      : 0.2;
    const maxSpreadToTpHard = Number.isFinite(Number(this.config?.maxSpreadToTpHard))
      ? Number(this.config.maxSpreadToTpHard)
      : 0.3;

    const executionCostOk = (() => {
      if (!enforceSpreadToAtrHard) {
        return true;
      }
      if (spreadToAtr != null && Number.isFinite(spreadToAtr) && spreadToAtr > maxSpreadToAtrHard) {
        return false;
      }
      if (spreadToTp != null && Number.isFinite(spreadToTp) && spreadToTp > maxSpreadToTpHard) {
        return false;
      }
      return true;
    })();

    // Optional hard gates (smart automation). These never block when data is missing.
    const autoTradingAutostart =
      String(process.env.AUTO_TRADING_AUTOSTART || '')
        .trim()
        .toLowerCase() === 'true';

    const enforceMomentumGuards =
      this.config?.enforceMomentumGuards != null
        ? Boolean(this.config.enforceMomentumGuards)
        : autoTradingAutostart;
    const enforceHtfAlignment =
      this.config?.enforceHtfAlignment != null
        ? Boolean(this.config.enforceHtfAlignment)
        : autoTradingAutostart && (assetClass === 'forex' || assetClass === 'metals');
    const enforceCryptoVolSpike =
      this.config?.enforceCryptoVolSpike != null
        ? Boolean(this.config.enforceCryptoVolSpike)
        : true;

    const technical = signal.components?.technical || {};
    const frames =
      technical?.timeframes && typeof technical.timeframes === 'object' ? technical.timeframes : {};
    const dir = String(signal?.direction || '').toUpperCase();
    const isDirectional = dir === 'BUY' || dir === 'SELL';

    const layered = signal?.components?.layeredAnalysis || null;
    const layer1 = Array.isArray(layered?.layers)
      ? layered.layers.find(
          (layer) => String(layer?.key || '') === 'L1' || Number(layer?.layer) === 1
        )
      : null;
    const barsCoverage = layer1?.metrics?.barsCoverage || null;

    const tfDir = (tf) => {
      const frame = frames?.[tf] || frames?.[String(tf || '').toLowerCase()] || null;
      const raw = String(frame?.direction || '').toUpperCase();
      return raw === 'BUY' || raw === 'SELL' || raw === 'NEUTRAL' ? raw : null;
    };
    const tfInd = (tf) => {
      const frame = frames?.[tf] || frames?.[String(tf || '').toLowerCase()] || null;
      return frame?.indicators && typeof frame.indicators === 'object' ? frame.indicators : null;
    };

    const momentumTf = frames?.H1 ? 'H1' : frames?.M15 ? 'M15' : null;
    const ind = momentumTf ? tfInd(momentumTf) : null;
    const rsiValue = Number(ind?.rsi?.value);
    const macdHist = Number(ind?.macd?.histogram);

    const rsiGuardOk = (() => {
      if (!enforceMomentumGuards) {
        return true;
      }
      if (!isDirectional || !Number.isFinite(rsiValue)) {
        return true;
      }
      if (dir === 'BUY' && rsiValue >= 78) {
        return false;
      }
      if (dir === 'SELL' && rsiValue <= 22) {
        return false;
      }
      return true;
    })();

    const macdGuardOk = (() => {
      if (!enforceMomentumGuards) {
        return true;
      }
      if (!isDirectional || !Number.isFinite(macdHist)) {
        return true;
      }
      if (dir === 'BUY' && macdHist < 0) {
        return false;
      }
      if (dir === 'SELL' && macdHist > 0) {
        return false;
      }
      return true;
    })();

    const htfAlignmentOk = (() => {
      if (!enforceHtfAlignment) {
        return true;
      }
      if (!isDirectional) {
        return true;
      }
      const h4 = tfDir('H4');
      const d1 = tfDir('D1');
      const w1 = tfDir('W1');
      const dirs = [h4, d1, w1].filter((d) => d && d !== 'NEUTRAL').map(String);
      if (dirs.length === 0) {
        return this.config?.requireHtfDirection ? false : true;
      }
      return dirs.every((d) => d === dir);
    })();

    const barsCoverageOk = (() => {
      if (!this.config?.requireBarsCoverage) {
        return true;
      }
      if (!barsCoverage || typeof barsCoverage !== 'object') {
        return false;
      }
      const m15 = barsCoverage.M15 || null;
      const h1 = barsCoverage.H1 || null;
      const m15Count = Number(m15?.count);
      const h1Count = Number(h1?.count);
      const m15Age = Number(m15?.ageMs);
      const h1Age = Number(h1?.ageMs);

      const m15Min = Number.isFinite(Number(this.config?.barsMinM15))
        ? Number(this.config.barsMinM15)
        : 60;
      const h1Min = Number.isFinite(Number(this.config?.barsMinH1))
        ? Number(this.config.barsMinH1)
        : 20;
      const m15MaxAge = Number.isFinite(Number(this.config?.barsMaxAgeM15Ms))
        ? Number(this.config.barsMaxAgeM15Ms)
        : null;
      const h1MaxAge = Number.isFinite(Number(this.config?.barsMaxAgeH1Ms))
        ? Number(this.config.barsMaxAgeH1Ms)
        : null;

      const m15CountOk = !Number.isFinite(m15Count) || m15Count >= m15Min;
      const h1CountOk = !Number.isFinite(h1Count) || h1Count >= h1Min;
      const m15AgeOk = m15MaxAge == null || !Number.isFinite(m15Age) || m15Age <= m15MaxAge;
      const h1AgeOk = h1MaxAge == null || !Number.isFinite(h1Age) || h1Age <= h1MaxAge;

      return m15CountOk && h1CountOk && m15AgeOk && h1AgeOk;
    })();

    const atrPct = Number(technical?.volatilitySummary?.averageScore);
    const cryptoVolSpikeOk = (() => {
      if (!enforceCryptoVolSpike) {
        return true;
      }
      if (assetClass !== 'crypto') {
        return true;
      }
      if (!Number.isFinite(atrPct)) {
        return true;
      }
      const spike = Number.isFinite(Number(process.env.CRYPTO_ATR_PCT_SPIKE))
        ? Number(process.env.CRYPTO_ATR_PCT_SPIKE)
        : 2.2;
      return atrPct <= spike;
    })();

    hardChecks.momentumRsiOk = rsiGuardOk;
    hardChecks.momentumMacdOk = macdGuardOk;
    hardChecks.htfAlignmentOk = htfAlignmentOk;
    hardChecks.cryptoVolSpikeOk = cryptoVolSpikeOk;
    hardChecks.executionCostOk = executionCostOk;
    hardChecks.barsCoverageOk = barsCoverageOk;
    blocked = Object.values(hardChecks).some((v) => v !== true);

    // News modifier (soft): upcoming events reduce confidence but do not veto.
    const newsImpact = Number.isFinite(Number(signal?.components?.news?.impact))
      ? Number(signal.components.news.impact)
      : 0;
    const upcomingEvents = Number.isFinite(Number(signal?.components?.news?.upcomingEvents))
      ? Number(signal.components.news.upcomingEvents)
      : 0;
    const newsModifier = clamp01(
      1 - Math.min(0.22, (newsImpact / 100) * 0.18 + upcomingEvents * 0.01)
    );

    // Session modifier (soft): reduce aggressiveness in low-liquidity sessions.
    const sessionModifier = this.getSessionModifier(assetClass);

    // Market-data quality becomes a soft penalty unless hard-blocked.
    const dataQualityPenalty = (() => {
      const dq = marketData && typeof marketData === 'object' ? marketData : null;
      if (!dq) {
        return 1.0;
      }
      let penalty = Number.isFinite(Number(dq.modifier)) ? Number(dq.modifier) : 1.0;
      if (!Number.isFinite(penalty)) {
        penalty = 1.0;
      }
      penalty = Math.max(0.35, Math.min(1, penalty));
      if (dq.confidenceFloorBreached) {
        penalty = Math.min(penalty, 0.82);
      }
      if (dq.stale) {
        penalty = Math.min(penalty, 0.9);
      }
      return Number(penalty.toFixed(3));
    })();

    const weights = profile.weights;
    const weightedScore01 = (() => {
      const parts = [
        { w: weights.direction, v: directionScore },
        { w: weights.strength, v: strengthScore },
        { w: weights.probability, v: probabilityScore },
        { w: weights.confidence, v: confidenceScore },
        { w: weights.riskReward, v: rrScore },
        { w: weights.spreadEfficiency, v: spreadEfficiencyScore }
      ];
      const wSum = parts.reduce((acc, p) => acc + p.w, 0) || 1;
      const vSum = parts.reduce((acc, p) => acc + p.w * p.v, 0);
      return clamp01(vSum / wSum);
    })();

    // Context memory: reward improving momentum, but never force an ENTER.
    const momentum = this.computeConfidenceMomentum(pair, weightedScore01);
    const momentumBoost =
      momentum == null ? 1.0 : Number(Math.max(0.9, Math.min(1.1, 1 + momentum * 0.06)).toFixed(4));

    const score01 = clamp01(
      weightedScore01 * newsModifier * sessionModifier * dataQualityPenalty * momentumBoost
    );
    const score = Number((score01 * 100).toFixed(1));

    // 18-layer confluence gate (real checks; SKIP when data isn't available).
    const confluenceEnabled = (() => {
      const env = String(process.env.SIGNAL_CONFLUENCE_ENABLED || '')
        .trim()
        .toLowerCase();
      if (!env) {
        return true;
      }
      return env === '1' || env === 'true' || env === 'yes' || env === 'on';
    })();

    const confluence = (() => {
      const evaluatedAt = now;
      const layers = [];

      const strictSmartChecklist = (() => {
        const env = String(process.env.EA_STRICT_SMART_CHECKLIST || '')
          .trim()
          .toLowerCase();
        if (env) {
          return env === '1' || env === 'true' || env === 'yes' || env === 'on';
        }

        const nodeEnv = String(process.env.NODE_ENV || '')
          .trim()
          .toLowerCase();
        if (nodeEnv === 'test') {
          return false;
        }

        // Default behavior:
        // - In development, keep strict checklist opt-in so the dashboard can show analysis and candidates.
        // - In production, default to strict when EA-only mode is enabled.
        const eaOnly = String(process.env.EA_ONLY_MODE || '')
          .trim()
          .toLowerCase();
        const eaOnlyEnabled =
          eaOnly === '1' || eaOnly === 'true' || eaOnly === 'yes' || eaOnly === 'on';
        return nodeEnv === 'production' && eaOnlyEnabled;
      })();

      const addLayer = (id, label, weight, status, reason = null, metrics = null) => {
        layers.push({
          id,
          label,
          weight: Number.isFinite(Number(weight)) ? Number(weight) : 1,
          status,
          reason: reason != null ? String(reason) : null,
          metrics: metrics && typeof metrics === 'object' ? metrics : null
        });
      };

      const dir = String(signal?.direction || '').toUpperCase();
      const isDirectional = dir === 'BUY' || dir === 'SELL';

      const envMinConfidence = Number(process.env.SIGNAL_HARD_MIN_CONFIDENCE);
      const envMinStrength = Number(process.env.SIGNAL_HARD_MIN_STRENGTH);
      const minConfidenceHard = Number.isFinite(envMinConfidence) ? envMinConfidence : 45;
      const minStrengthHard = Number.isFinite(envMinStrength) ? envMinStrength : 25;

      addLayer(
        'direction',
        'Directional bias (BUY/SELL)',
        1.0,
        isDirectional ? 'PASS' : 'FAIL',
        isDirectional ? null : 'Signal direction is NEUTRAL'
      );

      addLayer(
        'min_confidence',
        `Confidence ≥ ${minConfidenceHard}`,
        1.1,
        confidence >= minConfidenceHard ? 'PASS' : 'FAIL',
        confidence >= minConfidenceHard ? null : `confidence=${confidence}`,
        { confidence, min: minConfidenceHard }
      );

      addLayer(
        'min_strength',
        `Strength ≥ ${minStrengthHard}`,
        1.1,
        strength >= minStrengthHard ? 'PASS' : 'FAIL',
        strength >= minStrengthHard ? null : `strength=${strength}`,
        { strength, min: minStrengthHard }
      );

      addLayer(
        'market_data_fresh',
        'Market data freshness',
        1.2,
        hardChecks.marketDataFresh ? 'PASS' : 'FAIL',
        hardChecks.marketDataFresh ? null : 'Market data is stale / blocked'
      );

      addLayer(
        'spread_ok',
        'Execution spread within limit',
        1.1,
        hardChecks.spreadOk ? 'PASS' : 'FAIL',
        hardChecks.spreadOk
          ? null
          : `spreadPips=${spreadPips} maxSpreadPips=${maxSpreadPips} spreadStatus=${marketData?.spreadStatus}`,
        { spreadPips, maxSpreadPips }
      );

      addLayer(
        'news_blackout',
        'No high-impact news blackout',
        0.9,
        hardChecks.noHighImpactNewsSoon ? 'PASS' : 'FAIL',
        hardChecks.noHighImpactNewsSoon ? null : 'High impact event near now'
      );

      // Event-risk governor: hard veto around high-impact releases (pre/post) in strict mode.
      const eventRiskGovernor = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const beforeMinEnv = Number(process.env.EVENT_GOVERNOR_BEFORE_MINUTES);
        const afterMinEnv = Number(process.env.EVENT_GOVERNOR_AFTER_MINUTES);
        const impactEnv = Number(process.env.EVENT_GOVERNOR_IMPACT_THRESHOLD);

        const beforeMinutes = Number.isFinite(beforeMinEnv) ? Math.max(0, beforeMinEnv) : 30;
        const afterMinutes = Number.isFinite(afterMinEnv) ? Math.max(0, afterMinEnv) : 15;
        const impactThreshold = Number.isFinite(impactEnv) ? Math.max(0, impactEnv) : 25;

        const parsedRelevant = calendarEvents
          .filter(Boolean)
          .filter((evt) => isEventRelevantToPair(evt))
          .map((evt) => {
            const t = parseEventTimeMs(evt);
            const impact = Number(evt?.impact);
            return {
              event: evt?.event || evt?.title || evt?.name || null,
              currency: normalizeCurrency(evt?.currency) || null,
              impact: Number.isFinite(impact) ? impact : null,
              timeMs: Number.isFinite(t) ? t : null,
              time: Number.isFinite(t) ? new Date(t).toISOString() : null
            };
          })
          .filter((evt) => evt.timeMs != null)
          .map((evt) => {
            const minutesFromNow = (evt.timeMs - now) / 60000;
            return { ...evt, minutesFromNow: Number(minutesFromNow.toFixed(2)) };
          });

        const hasCalendarFeed = parsedRelevant.length > 0;
        const highImpact = parsedRelevant.filter(
          (evt) => evt.impact != null && evt.impact >= impactThreshold
        );

        // Strict mode requirement: the calendar feed must exist.
        // High-impact events may simply not exist within the current lookahead; that should not be a hard block.
        if (!hasCalendarFeed) {
          return strictSmartChecklist
            ? {
                status: 'FAIL',
                reason: 'No calendar feed/events available (strict)',
                beforeMinutes,
                afterMinutes,
                impactThreshold
              }
            : {
                status: 'SKIP',
                reason: 'No calendar events available',
                beforeMinutes,
                afterMinutes
              };
        }

        if (!highImpact.length) {
          return {
            status: 'PASS',
            reason: null,
            beforeMinutes,
            afterMinutes,
            impactThreshold,
            monitored: 0
          };
        }

        const inWindow = highImpact.filter(
          (evt) => evt.minutesFromNow <= beforeMinutes && evt.minutesFromNow >= -afterMinutes
        );

        if (inWindow.length) {
          const top = inWindow
            .sort((a, b) => Math.abs(a.minutesFromNow) - Math.abs(b.minutesFromNow))
            .slice(0, 3);
          return {
            status: 'FAIL',
            reason: 'Event-risk governor: high-impact release window',
            beforeMinutes,
            afterMinutes,
            impactThreshold,
            hits: top
          };
        }

        return {
          status: 'PASS',
          reason: null,
          beforeMinutes,
          afterMinutes,
          impactThreshold,
          monitored: Math.min(50, highImpact.length)
        };
      })();

      addLayer(
        'smart_event_risk_governor',
        'Event-risk governor (pre/post high-impact blackout)',
        1.1,
        eventRiskGovernor.status,
        eventRiskGovernor.reason,
        {
          beforeMinutes: eventRiskGovernor.beforeMinutes ?? null,
          afterMinutes: eventRiskGovernor.afterMinutes ?? null,
          impactThreshold: eventRiskGovernor.impactThreshold ?? null,
          hits: eventRiskGovernor.hits ?? null
        }
      );

      // Post-news realized market-state classifier (AFTER high-impact only; never a pre-news predictor).
      // Goal: distinguish expansion vs mean-reversion vs chop, then veto choppy post-news entries.
      const postNewsRegimeGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const beforeMinEnv = Number(process.env.EVENT_GOVERNOR_BEFORE_MINUTES);
        const afterMinEnv = Number(process.env.EVENT_GOVERNOR_AFTER_MINUTES);
        const impactEnv = Number(process.env.EVENT_GOVERNOR_IMPACT_THRESHOLD);
        const beforeMinutes = Number.isFinite(beforeMinEnv) ? Math.max(0, beforeMinEnv) : 30;
        const afterMinutes = Number.isFinite(afterMinEnv) ? Math.max(0, afterMinEnv) : 15;
        const impactThreshold = Number.isFinite(impactEnv) ? Math.max(0, impactEnv) : 25;

        const windowEnv = Number(process.env.POST_NEWS_REGIME_WINDOW_MINUTES);
        const windowMinutes = Number.isFinite(windowEnv) ? Math.max(5, windowEnv) : 60;

        const relevant = calendarEvents
          .filter(Boolean)
          .filter((evt) => isEventRelevantToPair(evt))
          .map((evt) => {
            const t = parseEventTimeMs(evt);
            const impact = Number(evt?.impact);
            return {
              timeMs: Number.isFinite(t) ? t : null,
              minutesFromNow: Number.isFinite(t) ? Number(((t - now) / 60000).toFixed(2)) : null,
              impact: Number.isFinite(impact) ? impact : null,
              currency: normalizeCurrency(evt?.currency) || null,
              title: evt?.event || evt?.title || evt?.name || null
            };
          })
          .filter((e) => e.timeMs != null && e.minutesFromNow != null)
          .filter((e) => e.impact != null && e.impact >= impactThreshold)
          .sort((a, b) => Number(b.timeMs) - Number(a.timeMs));

        const latestPast = relevant.find((e) => e.minutesFromNow < 0) || null;
        if (!latestPast) {
          return { status: 'SKIP', reason: 'No recent high-impact event' };
        }

        const minutesSinceEvent = Math.abs(Number(latestPast.minutesFromNow));
        if (!Number.isFinite(minutesSinceEvent) || minutesSinceEvent > windowMinutes) {
          return { status: 'SKIP', reason: 'Outside post-news window', minutesSinceEvent };
        }

        // Only classify AFTER the post-blackout time.
        if (minutesSinceEvent < afterMinutes) {
          return {
            status: 'SKIP',
            reason: 'Within post-news blackout window',
            minutesSinceEvent,
            afterMinutes,
            event: latestPast
          };
        }

        const pipSize = getPipSize(pair);
        const atrPipsLocal = Number.isFinite(Number(atrPips)) ? Number(atrPips) : null;
        const historyAll =
          this.analyticsCache?.quoteTelemetryByPair instanceof Map
            ? this.analyticsCache.quoteTelemetryByPair.get(String(pair || '').trim()) || []
            : [];

        const eventStartMs = latestPast.timeMs;
        const windowStart = Math.max(eventStartMs, now - 15 * 60 * 1000);
        const slice = Array.isArray(historyAll)
          ? historyAll.filter((q) => q && q.at != null && q.mid != null && q.at >= windowStart)
          : [];

        if (slice.length < 6 || !Number.isFinite(Number(pipSize)) || pipSize <= 0) {
          return {
            status: strictSmartChecklist ? 'FAIL' : 'SKIP',
            reason: strictSmartChecklist
              ? 'Post-news regime unavailable (strict: insufficient quote history)'
              : 'Post-news regime unavailable',
            minutesSinceEvent,
            samples: slice.length,
            event: latestPast
          };
        }

        const mids = slice.map((q) => Number(q.mid)).filter((v) => Number.isFinite(v));
        const firstMid = mids[0];
        const lastMid = mids[mids.length - 1];
        const maxMid = Math.max(...mids);
        const minMid = Math.min(...mids);
        const rangePips = Number(((maxMid - minMid) / pipSize).toFixed(2));
        const netPips = Number(((lastMid - firstMid) / pipSize).toFixed(2));
        const retraceRatio =
          rangePips > 0 ? Number((1 - Math.min(1, Math.abs(netPips) / rangePips)).toFixed(3)) : 0;

        let flips = 0;
        let prevSign = 0;
        for (let i = 1; i < mids.length; i += 1) {
          const d = mids[i] - mids[i - 1];
          const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
          if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
            flips += 1;
          }
          if (sign !== 0) {
            prevSign = sign;
          }
        }

        const atrFloor = atrPipsLocal != null ? Math.max(1, atrPipsLocal) : 12;
        const bigMove = rangePips >= atrFloor * 0.55;
        const strongNet = rangePips > 0 ? Math.abs(netPips) >= rangePips * 0.55 : false;

        const regime = (() => {
          if (bigMove && strongNet && retraceRatio <= 0.35 && flips <= 2) {
            return 'expansion';
          }
          if (bigMove && retraceRatio >= 0.65) {
            return 'mean_reversion';
          }
          if (flips >= 4 && (bigMove || rangePips >= atrFloor * 0.25)) {
            return 'choppy';
          }
          return 'unknown';
        })();

        // Choppy post-news is a hard veto in strict mode.
        if (regime === 'choppy') {
          return {
            status: strictSmartChecklist ? 'FAIL' : 'SKIP',
            reason: 'Post-news regime choppy (snap-back/noise)',
            regime,
            minutesSinceEvent,
            rangePips,
            netPips,
            retraceRatio,
            flips,
            beforeMinutes,
            afterMinutes,
            impactThreshold,
            event: latestPast
          };
        }

        // Mean-reversion is usually tricky right after news; keep conservative.
        if (regime === 'mean_reversion' && strictSmartChecklist) {
          return {
            status: 'FAIL',
            reason: 'Post-news regime mean-reversion (strict)',
            regime,
            minutesSinceEvent,
            rangePips,
            netPips,
            retraceRatio,
            flips,
            beforeMinutes,
            afterMinutes,
            impactThreshold,
            event: latestPast
          };
        }

        return {
          status: 'PASS',
          reason: null,
          regime,
          minutesSinceEvent,
          rangePips,
          netPips,
          retraceRatio,
          flips,
          beforeMinutes,
          afterMinutes,
          impactThreshold,
          event: latestPast
        };
      })();

      addLayer(
        'smart_post_news_regime',
        'Post-news regime (realized, after event)',
        0.95,
        postNewsRegimeGate.status,
        postNewsRegimeGate.reason,
        {
          regime: postNewsRegimeGate.regime ?? null,
          minutesSinceEvent: postNewsRegimeGate.minutesSinceEvent ?? null,
          rangePips: postNewsRegimeGate.rangePips ?? null,
          netPips: postNewsRegimeGate.netPips ?? null,
          retraceRatio: postNewsRegimeGate.retraceRatio ?? null,
          flips: postNewsRegimeGate.flips ?? null,
          event: postNewsRegimeGate.event ?? null,
          afterMinutes: postNewsRegimeGate.afterMinutes ?? null
        }
      );

      // Data completeness gate: in strict mode, missing critical feeds becomes a hard FAIL.
      const dataCompletenessGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!strictSmartChecklist) {
          return { status: 'SKIP', reason: 'Not strict' };
        }

        const missing = [];
        const newsComponent = signal?.components?.news || null;
        const calendar = Array.isArray(newsComponent?.calendarEvents)
          ? newsComponent.calendarEvents
          : [];
        const headlines = Array.isArray(newsComponent?.evidence?.external)
          ? newsComponent.evidence.external
          : [];
        const corr =
          signal?.components?.intermarket?.correlation &&
          typeof signal.components.intermarket.correlation === 'object'
            ? signal.components.intermarket.correlation
            : null;

        if (!calendar.length) {
          missing.push('news:calendarEvents');
        }
        if (!headlines.length) {
          missing.push('news:headlines');
        }
        if (!corr || corr.available !== true) {
          missing.push('intermarket:correlation');
        }

        if (missing.length) {
          return {
            status: 'FAIL',
            reason: 'Missing required data feeds (strict)',
            missing
          };
        }

        return { status: 'PASS', reason: null, missing: [] };
      })();

      addLayer(
        'smart_data_completeness',
        'Data completeness (calendar + headlines + correlation)',
        1.1,
        dataCompletenessGate.status,
        dataCompletenessGate.reason,
        { missing: dataCompletenessGate.missing ?? null }
      );

      // Intermarket correlation stability: break/conflict is a veto in strict mode.
      const corrGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const corr =
          signal?.components?.intermarket?.correlation &&
          typeof signal.components.intermarket.correlation === 'object'
            ? signal.components.intermarket.correlation
            : null;
        if (!corr || corr.available !== true) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Correlation snapshot missing/unavailable (strict)' }
            : { status: 'SKIP', reason: 'Correlation snapshot unavailable' };
        }

        const peers = Array.isArray(corr.peers) ? corr.peers : [];
        const usable = peers.filter((p) => p && p.available === true && typeof p.corr === 'number');

        // Core peers are the ones that matter for the current asset class/pair.
        // Non-core peers (e.g., BTC for FX) should not hard-veto entries.
        const usableCore = usable.filter((p) => p.core !== false);
        const breaksCore = usableCore.filter((p) => p.break === true);
        const conflictsCore = usableCore.filter((p) => p.alignedWithExpectation === false);
        const breaksNonCore = usable.filter((p) => p.core === false && p.break === true);

        const stabilityScore = Number.isFinite(Number(corr?.stability?.stabilityScore))
          ? Number(corr.stability.stabilityScore)
          : null;

        // Hard veto if correlation regime is unstable (core peers) or contradicts expected macro mapping.
        if (breaksCore.length || conflictsCore.length) {
          return {
            status: 'FAIL',
            reason: 'Correlation instability/conflict detected',
            stabilityScore,
            breaksCore: breaksCore
              .slice(0, 3)
              .map((p) => ({ peer: p.peer, corr: p.corr, delta: p.delta, role: p.role || null })),
            conflictsCore: conflictsCore.slice(0, 3).map((p) => ({
              peer: p.peer,
              corr: p.corr,
              expectedSign: p.expectedSign,
              role: p.role || null
            })),
            breaksNonCore: breaksNonCore
              .slice(0, 2)
              .map((p) => ({ peer: p.peer, corr: p.corr, delta: p.delta, role: p.role || null }))
          };
        }

        const confidence = Number.isFinite(Number(corr.confidence))
          ? Number(corr.confidence)
          : null;
        if (confidence != null && confidence < 30) {
          return strictSmartChecklist
            ? {
                status: 'FAIL',
                reason: `Correlation confidence too low (${confidence}) (strict)`,
                confidence
              }
            : { status: 'SKIP', reason: `Correlation confidence low (${confidence})`, confidence };
        }

        return { status: 'PASS', reason: null, confidence };
      })();

      addLayer(
        'smart_intermarket_correlation_guard',
        'Intermarket correlation guard (stability + confidence)',
        1.05,
        corrGate.status,
        corrGate.reason,
        {
          confidence: corrGate.confidence ?? null,
          stabilityScore: corrGate.stabilityScore ?? null,
          breaksCore: corrGate.breaksCore ?? null,
          conflictsCore: corrGate.conflictsCore ?? null,
          breaksNonCore: corrGate.breaksNonCore ?? null
        }
      );

      const tradingWindowLayerStatus = (() => {
        if (!enforceTradingWindows) {
          return { status: 'SKIP', reason: 'Trading windows not enforced' };
        }
        if (assetClass !== 'forex') {
          return { status: 'SKIP', reason: 'Non-forex' };
        }
        return hardChecks.withinTradingWindow
          ? { status: 'PASS', reason: null }
          : { status: 'FAIL', reason: 'Outside configured London trading window' };
      })();

      addLayer(
        'trading_window_hard',
        'Trading window guard (London)',
        1.05,
        tradingWindowLayerStatus.status,
        tradingWindowLayerStatus.reason,
        enforceTradingWindows && assetClass === 'forex'
          ? { windowsLondon: tradingWindowsLondon }
          : null
      );

      addLayer(
        'risk_limit',
        'Risk budget / concurrency OK',
        1.0,
        hardChecks.withinRiskLimit ? 'PASS' : 'FAIL',
        hardChecks.withinRiskLimit ? null : 'Risk/capacity constraint'
      );

      const isLondonNy = (() => {
        const utcHour = new Date().getUTCHours();
        const isLondon = utcHour >= 7 && utcHour < 13;
        const isNy = utcHour >= 13 && utcHour < 21;
        return isLondon || isNy;
      })();
      const sessionIsPass = assetClass === 'crypto' ? true : isLondonNy;
      addLayer(
        'session_window',
        'Session window (London/NY for FX/metals)',
        0.6,
        sessionIsPass ? 'PASS' : 'FAIL',
        sessionIsPass ? null : 'Outside London/NY window'
      );

      const technical = signal.components?.technical || {};
      const frames =
        technical?.timeframes && typeof technical.timeframes === 'object'
          ? technical.timeframes
          : {};

      const tfFrame = (tf) => frames?.[tf] || frames?.[String(tf || '').toLowerCase()] || null;
      const tfDir = (tf) => {
        const frame = tfFrame(tf);
        const raw = String(frame?.direction || '').toUpperCase();
        return raw === 'BUY' || raw === 'SELL' || raw === 'NEUTRAL' ? raw : null;
      };
      const tfInd = (tf) => {
        const frame = tfFrame(tf);
        return frame?.indicators && typeof frame.indicators === 'object' ? frame.indicators : null;
      };

      const h4 = tfDir('H4');
      const d1 = tfDir('D1');
      const w1 = tfDir('W1');

      const htfOk = (htfDir) => {
        if (!isDirectional) {
          return null;
        }
        if (!htfDir || htfDir === 'NEUTRAL') {
          return null;
        }
        return htfDir === dir;
      };

      const h4Ok = htfOk(h4);
      addLayer(
        'htf_h4',
        'Higher timeframe alignment (H4)',
        0.9,
        h4Ok == null ? 'SKIP' : h4Ok ? 'PASS' : 'FAIL',
        h4Ok == null ? 'H4 direction unavailable' : h4Ok ? null : `H4=${h4} vs signal=${dir}`
      );

      const d1Ok = htfOk(d1);
      addLayer(
        'htf_d1',
        'Higher timeframe alignment (D1)',
        1.0,
        d1Ok == null
          ? strictSmartChecklist && isDirectional
            ? 'FAIL'
            : 'SKIP'
          : d1Ok
            ? 'PASS'
            : 'FAIL',
        d1Ok == null
          ? strictSmartChecklist && isDirectional
            ? 'D1 direction unavailable/neutral (strict)'
            : 'D1 direction unavailable'
          : d1Ok
            ? null
            : `D1=${d1} vs signal=${dir}`
      );

      // Strict higher-timeframe lock: D1 RSI + MACD must confirm and not be flat.
      const d1Frame = tfFrame('D1');
      const d1Ind = tfInd('D1');
      const d1Rsi = Number(d1Ind?.rsi?.value);
      const d1MacdHist = Number(d1Ind?.macd?.histogram);
      const d1Last = Number(d1Frame?.lastPrice ?? d1Frame?.latestCandle?.close);

      const h4Ind = tfInd('H4');
      const h4Rsi = Number(h4Ind?.rsi?.value);

      const d1RsiGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!Number.isFinite(d1Rsi)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'D1 RSI unavailable (strict)' }
            : { status: 'SKIP', reason: 'D1 RSI unavailable' };
        }
        if (dir === 'BUY' && d1Rsi >= 50) {
          return { status: 'PASS', reason: null };
        }
        if (dir === 'SELL' && d1Rsi <= 45) {
          return { status: 'PASS', reason: null };
        }
        return { status: 'FAIL', reason: `D1 RSI=${d1Rsi} not confirming ${dir}` };
      })();

      addLayer(
        'smart_d1_rsi_lock',
        'HTF lock (D1 RSI threshold)',
        1.05,
        d1RsiGate.status,
        d1RsiGate.reason,
        Number.isFinite(d1Rsi) ? { rsi: d1Rsi, buyMin: 50, sellMax: 45 } : null
      );

      // Mandatory HTF rule: if H4 or D1 RSI is overbought, do not BUY (unless a reset/range exists).
      // We only enforce the strict part here (block when overbought). Range/reset detection is not
      // reliably available from EA snapshots, so missing RSI data is treated as FAIL in strict mode.
      const htfRsiBuyOverboughtGate = (() => {
        if (!isDirectional || dir !== 'BUY') {
          return { status: 'SKIP', reason: 'Not a BUY signal' };
        }
        const overbought = 70;
        const d1Ok = Number.isFinite(d1Rsi) ? d1Rsi <= overbought : null;
        const h4Ok = Number.isFinite(h4Rsi) ? h4Rsi <= overbought : null;

        if (d1Ok == null && h4Ok == null) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'HTF RSI unavailable (strict)' }
            : { status: 'SKIP', reason: 'HTF RSI unavailable' };
        }

        const d1Over = Number.isFinite(d1Rsi) ? d1Rsi > overbought : false;
        const h4Over = Number.isFinite(h4Rsi) ? h4Rsi > overbought : false;
        if (d1Over || h4Over) {
          return {
            status: 'FAIL',
            reason: `Overbought RSI (H4/D1 > ${overbought}) blocks BUY`,
            d1Rsi: Number.isFinite(d1Rsi) ? d1Rsi : null,
            h4Rsi: Number.isFinite(h4Rsi) ? h4Rsi : null
          };
        }
        return {
          status: 'PASS',
          reason: null,
          d1Rsi: Number.isFinite(d1Rsi) ? d1Rsi : null,
          h4Rsi: Number.isFinite(h4Rsi) ? h4Rsi : null
        };
      })();

      addLayer(
        'smart_htf_rsi_buy_overbought',
        'HTF RSI rule (no BUY if H4/D1 RSI > 70)',
        1.05,
        htfRsiBuyOverboughtGate.status,
        htfRsiBuyOverboughtGate.reason,
        {
          d1Rsi: htfRsiBuyOverboughtGate.d1Rsi ?? null,
          h4Rsi: htfRsiBuyOverboughtGate.h4Rsi ?? null,
          overbought: 70
        }
      );

      const d1MacdGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!Number.isFinite(d1MacdHist)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'D1 MACD unavailable (strict)' }
            : { status: 'SKIP', reason: 'D1 MACD unavailable' };
        }
        const epsEnv = Number(process.env.SIGNAL_MACD_FLAT_EPS);
        const eps = Number.isFinite(epsEnv) ? Math.max(0, epsEnv) : 1e-6;
        if (Math.abs(d1MacdHist) <= eps) {
          return { status: 'FAIL', reason: `D1 MACD flat (|hist|≤${eps})` };
        }
        if (dir === 'BUY' && d1MacdHist > 0) {
          return { status: 'PASS', reason: null };
        }
        if (dir === 'SELL' && d1MacdHist < 0) {
          return { status: 'PASS', reason: null };
        }
        return { status: 'FAIL', reason: `D1 MACD hist=${d1MacdHist} opposing ${dir}` };
      })();

      addLayer(
        'smart_d1_macd_lock',
        'HTF lock (D1 MACD agrees + not flat)',
        1.05,
        d1MacdGate.status,
        d1MacdGate.reason,
        Number.isFinite(d1MacdHist) ? { histogram: d1MacdHist } : null
      );

      // Smart price location: avoid pivots and mid-range; buy from discount / sell from premium.
      const locationGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const day = d1Frame?.ranges?.day;
        const week = d1Frame?.ranges?.week;
        const high = Number(day?.high);
        const low = Number(day?.low);
        const wHigh = Number(week?.high);
        const wLow = Number(week?.low);
        const pivots =
          d1Frame?.pivotPoints && typeof d1Frame.pivotPoints === 'object'
            ? d1Frame.pivotPoints
            : null;
        const pivotLevels = [];
        if (pivots) {
          for (const [key, raw] of Object.entries(pivots)) {
            const value = Number(raw);
            if (Number.isFinite(value)) {
              pivotLevels.push({ key, value });
            }
          }
        }
        if (!Number.isFinite(d1Last) || !Number.isFinite(high) || !Number.isFinite(low)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'D1 range/price unavailable (strict)' }
            : { status: 'SKIP', reason: 'D1 range/price unavailable' };
        }
        const range = high - low;
        if (!(range > 0)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Invalid D1 range (strict)' }
            : { status: 'SKIP', reason: 'Invalid D1 range' };
        }
        const pos = (d1Last - low) / range;

        const weekPos = (() => {
          if (!Number.isFinite(wHigh) || !Number.isFinite(wLow) || !(wHigh - wLow > 0)) {
            return null;
          }
          return (d1Last - wLow) / (wHigh - wLow);
        })();

        const atWeeklyLow =
          weekPos != null && Number.isFinite(Number(weekPos)) ? Number(weekPos) <= 0.12 : false;
        const atWeeklyHigh =
          weekPos != null && Number.isFinite(Number(weekPos)) ? Number(weekPos) >= 0.88 : false;

        const nearestPivot = (() => {
          if (!pivotLevels.length || !Number.isFinite(d1Last)) {
            return null;
          }
          let best = null;
          for (const lvl of pivotLevels) {
            const dist = Math.abs(d1Last - lvl.value);
            if (!best || dist < best.dist) {
              best = { ...lvl, dist };
            }
          }
          return best;
        })();

        const nearPivot = nearestPivot ? nearestPivot.dist <= range * 0.06 : false;
        const midDay = pos >= 0.45 && pos <= 0.55;
        const midWeek = weekPos != null ? weekPos >= 0.45 && weekPos <= 0.55 : null;
        const valueAreaBoring = Boolean(midDay && midWeek === true);

        if (nearPivot) {
          return {
            status: 'FAIL',
            reason: `Price too close to pivot level (${nearestPivot?.key || 'pivot'})`,
            nearestPivotKey: nearestPivot?.key ?? null,
            nearestPivotValue: nearestPivot?.value ?? null
          };
        }

        // Directional location kill-switch: do not SELL into weekly low, do not BUY into weekly high.
        if (dir === 'SELL' && atWeeklyLow) {
          return {
            status: 'FAIL',
            reason: 'Bad location: SELL too close to weekly low (liquidity likely exhausted)',
            pos,
            weekPos,
            nearestPivotKey: nearestPivot?.key ?? null,
            nearestPivotValue: nearestPivot?.value ?? null
          };
        }
        if (dir === 'BUY' && atWeeklyHigh) {
          return {
            status: 'FAIL',
            reason: 'Bad location: BUY too close to weekly high (liquidity likely exhausted)',
            pos,
            weekPos,
            nearestPivotKey: nearestPivot?.key ?? null,
            nearestPivotValue: nearestPivot?.value ?? null
          };
        }

        if (valueAreaBoring) {
          return { status: 'FAIL', reason: 'Price inside boring value area (mid day+week)' };
        }
        if (midDay || midWeek === true) {
          return { status: 'FAIL', reason: 'Price in mid-range (day/week)' };
        }
        if (dir === 'BUY' && pos <= 0.45) {
          return {
            status: 'PASS',
            reason: null,
            pos,
            weekPos,
            nearestPivotKey: nearestPivot?.key ?? null,
            nearestPivotValue: nearestPivot?.value ?? null
          };
        }
        if (dir === 'SELL' && pos >= 0.55) {
          return {
            status: 'PASS',
            reason: null,
            pos,
            weekPos,
            nearestPivotKey: nearestPivot?.key ?? null,
            nearestPivotValue: nearestPivot?.value ?? null
          };
        }
        return {
          status: 'FAIL',
          reason: dir === 'BUY' ? 'Not in discount zone' : 'Not in premium zone',
          pos,
          weekPos,
          nearestPivotKey: nearestPivot?.key ?? null,
          nearestPivotValue: nearestPivot?.value ?? null
        };
      })();

      // Allow a confirmed breakout to override the premium/discount constraint.
      // This keeps the default behavior conservative while supporting explicit breakout entries.
      let locationGateFinal = locationGate;

      // Monthly premium/discount hard-block (uses EA-provided D1.month ranges).
      const monthLocationGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const month = d1Frame?.ranges?.month;
        const mHigh = Number(month?.high);
        const mLow = Number(month?.low);
        if (!Number.isFinite(d1Last) || !Number.isFinite(mHigh) || !Number.isFinite(mLow)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Monthly range/price unavailable (strict)' }
            : { status: 'SKIP', reason: 'Monthly range/price unavailable' };
        }
        const mRange = mHigh - mLow;
        if (!(mRange > 0)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Invalid monthly range (strict)' }
            : { status: 'SKIP', reason: 'Invalid monthly range' };
        }

        const monthPos = (d1Last - mLow) / mRange;
        const midMonth = monthPos >= 0.45 && monthPos <= 0.55;
        if (midMonth) {
          return { status: 'FAIL', reason: 'Price in monthly mid-range', monthPos };
        }

        if (dir === 'BUY' && monthPos <= 0.45) {
          return { status: 'PASS', reason: null, monthPos };
        }
        if (dir === 'SELL' && monthPos >= 0.55) {
          return { status: 'PASS', reason: null, monthPos };
        }

        return {
          status: 'FAIL',
          reason: dir === 'BUY' ? 'Not in monthly discount zone' : 'Not in monthly premium zone',
          monthPos
        };
      })();

      let monthLocationGateFinal = monthLocationGate;

      // Digital candlestick must be strong and aligned.
      const candlesSummary = technical?.candlesSummary || null;
      const candleConf = Number(candlesSummary?.confidence);
      const candleDir = String(candlesSummary?.direction || '').toUpperCase();
      const candleGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!Number.isFinite(candleConf) || !candleDir) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Candlestick confidence unavailable (strict)' }
            : { status: 'SKIP', reason: 'Candlestick confidence unavailable' };
        }
        if (candleDir !== dir) {
          return { status: 'FAIL', reason: `Candles ${candleDir} vs signal ${dir}` };
        }
        if (candleConf >= 70) {
          return { status: 'PASS', reason: null };
        }
        return { status: 'FAIL', reason: `Candlestick confidence=${candleConf} (<70)` };
      })();

      addLayer(
        'smart_digital_candle',
        'Digital candlestick strength (≥ 70% aligned)',
        0.95,
        candleGate.status,
        candleGate.reason,
        Number.isFinite(candleConf)
          ? { confidence: candleConf, min: 70, direction: candleDir || null }
          : null
      );

      // Time intelligence: London/NY only + avoid hour/day edges.
      const timeIntel = (() => {
        if (assetClass !== 'forex' && assetClass !== 'metals') {
          return { status: 'SKIP', reason: 'Non-FX/metals', score: null };
        }

        const nowDt = new Date();
        const m = nowDt.getUTCMinutes();
        const h = nowDt.getUTCHours();

        const isLondon = h >= 7 && h < 13;
        const isNy = h >= 13 && h < 21;
        const inSession = isLondon || isNy;
        const lastMinutes = m >= 55;
        const lateClose = h >= 20 && h <= 22;

        let score = 0;
        if (inSession) {
          score += 70;
        }
        if (!lastMinutes) {
          score += 15;
        }
        if (!lateClose) {
          score += 15;
        }
        score = Math.max(0, Math.min(100, score));

        if (!inSession) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Only London/NY sessions allowed', score }
            : { status: 'SKIP', reason: 'Outside London/NY window', score };
        }
        if (lastMinutes) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Avoid last minutes of the hour', score }
            : { status: 'SKIP', reason: 'Last minutes of the hour', score };
        }
        if (lateClose) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Avoid pre-close / late NY window', score }
            : { status: 'SKIP', reason: 'Late NY window', score };
        }
        return {
          status: score >= 65 ? 'PASS' : strictSmartChecklist ? 'FAIL' : 'SKIP',
          reason: score >= 65 ? null : 'Time intelligence < 65',
          score
        };
      })();

      addLayer(
        'smart_time_intelligence',
        'Time intelligence (London/NY only, ≥ 65)',
        0.85,
        timeIntel.status,
        timeIntel.reason,
        timeIntel.score != null ? { score: timeIntel.score, min: 65 } : null
      );

      // Session authority: only trade early London/NY (opening hours). Late session is forbidden.
      const sessionAuthorityGate = (() => {
        if (assetClass !== 'forex' && assetClass !== 'metals') {
          return { status: 'SKIP', reason: 'Non-FX/metals' };
        }

        const nowDt = new Date();
        const h = nowDt.getUTCHours();
        const isLondonOpen = h >= 7 && h < 10;
        const isNyOpen = h >= 13 && h < 16;
        const inOpen = isLondonOpen || isNyOpen;

        if (inOpen) {
          return { status: 'PASS', reason: null, utcHour: h };
        }

        return strictSmartChecklist
          ? {
              status: 'FAIL',
              reason: 'Session authority: only opening hours allowed (strict)',
              utcHour: h
            }
          : { status: 'SKIP', reason: 'Session authority not met', utcHour: h };
      })();

      addLayer(
        'smart_session_authority',
        'Session authority (opening hours only)',
        0.9,
        sessionAuthorityGate.status,
        sessionAuthorityGate.reason,
        sessionAuthorityGate && typeof sessionAuthorityGate === 'object'
          ? { utcHour: sessionAuthorityGate.utcHour ?? null }
          : null
      );

      // Risk/Reward must clear a dynamic floor (asset-class + profile + win-rate breakeven).
      const rr2Gate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const rrFloorByAsset = assetClass === 'crypto' ? 2.0 : 1.6;
        const profileMin = Number.isFinite(Number(profile?.minRiskReward))
          ? Number(profile.minRiskReward)
          : null;

        const winRatePct = Number.isFinite(Number(signal?.estimatedWinRate))
          ? Number(signal.estimatedWinRate)
          : Number.isFinite(Number(signal?.components?.probability?.estimatedWinRate))
            ? Number(signal.components.probability.estimatedWinRate)
            : null;
        const p = winRatePct != null ? Math.min(0.85, Math.max(0.45, winRatePct / 100)) : null;
        const breakevenRr = p != null ? (1 - p) / p : null;
        const minRr = Math.max(
          rrFloorByAsset,
          profileMin ?? rrFloorByAsset,
          (breakevenRr ?? 0) + 0.4
        );

        if (riskReward == null || !Number.isFinite(Number(riskReward))) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Risk/reward unavailable (strict)' }
            : { status: 'SKIP', reason: 'Risk/reward unavailable' };
        }
        return Number(riskReward) >= minRr
          ? { status: 'PASS', reason: null, minRr, breakevenRr }
          : {
              status: 'FAIL',
              reason: `RR=${Number(riskReward).toFixed(2)} < ${Number(minRr).toFixed(2)}`,
              minRr,
              breakevenRr
            };
      })();

      addLayer(
        'smart_atr_rr_2to1',
        'Risk/Reward floor (dynamic)',
        1.0,
        rr2Gate.status,
        rr2Gate.reason,
        riskReward == null
          ? null
          : {
              rr: Number(riskReward),
              min: rr2Gate.minRr != null ? Number(rr2Gate.minRr) : null,
              breakevenRr: rr2Gate.breakevenRr != null ? Number(rr2Gate.breakevenRr) : null
            }
      );

      // Failure-cost check: invalidation must be close/cheap (avoid wide/expensive SL).
      const failureCostGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (stopLossPips == null || !Number.isFinite(Number(stopLossPips))) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Stop loss pips unavailable (strict)' }
            : { status: 'SKIP', reason: 'Stop loss pips unavailable' };
        }
        if (atrPips == null || !Number.isFinite(Number(atrPips)) || Number(atrPips) <= 0) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'ATR pips unavailable (strict)' }
            : { status: 'SKIP', reason: 'ATR pips unavailable' };
        }

        const ratio = Number(stopLossPips) / Number(atrPips);
        const maxRatioEnv = Number(process.env.SIGNAL_MAX_SL_ATR_RATIO);
        const maxRatio = Number.isFinite(maxRatioEnv)
          ? Math.max(0.8, Math.min(3.0, maxRatioEnv))
          : 1.8;

        if (ratio > maxRatio) {
          return {
            status: 'FAIL',
            reason: `Failure cost too high (SL/ATR=${ratio.toFixed(2)} > ${maxRatio})`,
            ratio
          };
        }
        return { status: 'PASS', reason: null, ratio };
      })();

      addLayer(
        'smart_failure_cost_check',
        'Failure cost check (invalidation must be cheap)',
        0.95,
        failureCostGate.status,
        failureCostGate.reason,
        {
          stopLossPips,
          atrPips,
          slToAtr: failureCostGate.ratio != null ? Number(failureCostGate.ratio.toFixed(4)) : null
        }
      );

      // Decisive candle: body clear, close near edge (not lazy wick-only).
      const decisiveCandleGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const frame = tfFrame('M15') || tfFrame('H1') || tfFrame('M5') || null;
        const candle =
          frame?.latestCandle && typeof frame.latestCandle === 'object' ? frame.latestCandle : null;
        const o = Number(candle?.open);
        const h = Number(candle?.high);
        const l = Number(candle?.low);
        const c = Number(candle?.close);
        if (![o, h, l, c].every((v) => Number.isFinite(v))) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Latest candle OHLC unavailable (strict)' }
            : { status: 'SKIP', reason: 'Latest candle OHLC unavailable' };
        }
        const range = Math.max(1e-9, h - l);
        const body = Math.abs(c - o);
        const bodyPct = body / range;
        const closePos = (c - l) / range;
        const bodyMin = 0.55;
        const buyCloseMin = 0.7;
        const sellCloseMax = 0.3;

        if (bodyPct < bodyMin) {
          return {
            status: 'FAIL',
            reason: `Body too small (${Number((bodyPct * 100).toFixed(0))}% < ${bodyMin * 100}%)`,
            bodyPct,
            closePos
          };
        }
        if (dir === 'BUY' && closePos < buyCloseMin) {
          return { status: 'FAIL', reason: 'Close not near high edge', bodyPct, closePos };
        }
        if (dir === 'SELL' && closePos > sellCloseMax) {
          return { status: 'FAIL', reason: 'Close not near low edge', bodyPct, closePos };
        }
        return { status: 'PASS', reason: null, bodyPct, closePos };
      })();

      addLayer(
        'smart_decisive_candle',
        'Decisive candle (body clear + close near edge)',
        0.95,
        decisiveCandleGate.status,
        decisiveCandleGate.reason,
        decisiveCandleGate && typeof decisiveCandleGate === 'object'
          ? {
              bodyPct:
                decisiveCandleGate.bodyPct != null
                  ? Number(decisiveCandleGate.bodyPct.toFixed(4))
                  : null,
              closePos:
                decisiveCandleGate.closePos != null
                  ? Number(decisiveCandleGate.closePos.toFixed(4))
                  : null
            }
          : null
      );

      // EA-only news guard: no hidden nearby events (uses EA-provided impact/upcomingEvents).
      const newsGate = (() => {
        const impact = Number.isFinite(Number(newsImpact)) ? Number(newsImpact) : 0;
        const upcoming = Number.isFinite(Number(upcomingEvents)) ? Number(upcomingEvents) : 0;
        if (impact <= 0 && upcoming <= 0) {
          return { status: 'PASS', reason: null, impact, upcoming };
        }
        // `upcomingEvents` is a count, not a proximity/impact veto.
        // We already run a proper blackout gate elsewhere; treat this as informational.
        if (upcoming > 0 && impact < 35) {
          return { status: 'SKIP', reason: `Upcoming events=${upcoming}`, impact, upcoming };
        }
        if (impact >= 35) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: `News impact=${impact} too high`, impact, upcoming }
            : { status: 'SKIP', reason: `News impact=${impact} (informational)`, impact, upcoming };
        }
        return strictSmartChecklist
          ? { status: 'FAIL', reason: `News impact present (${impact}) (strict)`, impact, upcoming }
          : { status: 'SKIP', reason: 'News impact present', impact, upcoming };
      })();

      addLayer(
        'smart_news_guard',
        'News proximity (EA-provided) clean',
        0.8,
        newsGate.status,
        newsGate.reason,
        { impact: newsGate.impact ?? null, upcomingEvents: newsGate.upcoming ?? null }
      );

      const w1Ok = htfOk(w1);
      addLayer(
        'htf_w1',
        'Higher timeframe alignment (W1)',
        0.7,
        w1Ok == null ? 'SKIP' : w1Ok ? 'PASS' : 'FAIL',
        w1Ok == null ? 'W1 direction unavailable' : w1Ok ? null : `W1=${w1} vs signal=${dir}`
      );

      // Momentum filter from RSI/MACD (prefer H1, then M15).
      const momentumTf = frames?.H1 ? 'H1' : frames?.M15 ? 'M15' : null;
      const ind = momentumTf ? tfInd(momentumTf) : null;
      const rsiValue = Number(ind?.rsi?.value);
      const macdHist = Number(ind?.macd?.histogram);

      const rsiStatus = (() => {
        if (!isDirectional || !Number.isFinite(rsiValue)) {
          return { status: 'SKIP', reason: 'RSI unavailable' };
        }
        if (dir === 'BUY' && rsiValue >= 78) {
          return { status: 'FAIL', reason: `RSI=${rsiValue} (overbought)` };
        }
        if (dir === 'SELL' && rsiValue <= 22) {
          return { status: 'FAIL', reason: `RSI=${rsiValue} (oversold)` };
        }
        return { status: 'PASS', reason: null };
      })();

      addLayer(
        'momentum_rsi',
        `Momentum (RSI @ ${momentumTf || '—'})`,
        0.75,
        rsiStatus.status,
        rsiStatus.reason,
        Number.isFinite(rsiValue) ? { rsi: rsiValue } : null
      );

      const macdStatus = (() => {
        if (!isDirectional || !Number.isFinite(macdHist)) {
          return { status: 'SKIP', reason: 'MACD histogram unavailable' };
        }
        if (dir === 'BUY' && macdHist < 0) {
          return { status: 'FAIL', reason: `MACD hist=${macdHist}` };
        }
        if (dir === 'SELL' && macdHist > 0) {
          return { status: 'FAIL', reason: `MACD hist=${macdHist}` };
        }
        return { status: 'PASS', reason: null };
      })();

      addLayer(
        'momentum_macd',
        `Momentum (MACD hist @ ${momentumTf || '—'})`,
        0.75,
        macdStatus.status,
        macdStatus.reason,
        Number.isFinite(macdHist) ? { histogram: macdHist } : null
      );

      // Divergence veto (downgrade-only): avoid buying into bearish divergence, or selling into bullish divergence.
      // This is designed as a FAIL-only layer (SKIP when no risk) so it never boosts confluence.
      const divergenceGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const div =
          technical?.divergenceSummary && typeof technical.divergenceSummary === 'object'
            ? technical.divergenceSummary
            : null;

        const opposing =
          dir === 'BUY'
            ? Array.isArray(div?.bearish)
              ? div.bearish
              : []
            : dir === 'SELL'
              ? Array.isArray(div?.bullish)
                ? div.bullish
                : []
              : [];

        const thresholdEnv = Number(process.env.SIGNAL_DIVERGENCE_OPPOSING_MIN_CONF);
        const threshold = Number.isFinite(thresholdEnv)
          ? Math.max(50, Math.min(95, thresholdEnv))
          : 70;

        const top = opposing
          .map((d) => ({
            timeframe: d?.timeframe ?? null,
            indicator: d?.indicator ?? null,
            confidence: Number(d?.confidence)
          }))
          .filter((d) => Number.isFinite(d.confidence))
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

        const maxOpp = top && Number.isFinite(top.confidence) ? top.confidence : null;

        if (maxOpp != null && maxOpp >= threshold) {
          return {
            status: 'FAIL',
            reason: `Opposing divergence detected (≥${threshold})`,
            count: opposing.length,
            maxOpposingConfidence: maxOpp,
            top
          };
        }

        return {
          status: 'SKIP',
          reason: opposing.length ? 'No strong opposing divergence' : 'No opposing divergence'
        };
      })();

      addLayer(
        'smart_divergence_guard',
        'Divergence guard (opposing divergence veto)',
        0.95,
        divergenceGate.status,
        divergenceGate.reason,
        divergenceGate && typeof divergenceGate === 'object'
          ? {
              maxOpposingConfidence: divergenceGate.maxOpposingConfidence ?? null,
              top: divergenceGate.top ?? null
            }
          : null
      );

      // Volatility/range sanity.
      const atrPct = Number(signal.components?.technical?.volatilitySummary?.averageScore);
      const atrPctFinite = Number.isFinite(atrPct);

      const forexAtrOk = (() => {
        if (assetClass !== 'forex') {
          return { status: 'SKIP', reason: 'Non-forex' };
        }
        if (!Number.isFinite(atrPips)) {
          return { status: 'SKIP', reason: 'ATR pips unavailable' };
        }
        const min = Number.isFinite(Number(process.env.FX_ATR_PIPS_MIN))
          ? Number(process.env.FX_ATR_PIPS_MIN)
          : 3;
        const max = Number.isFinite(Number(process.env.FX_ATR_PIPS_MAX))
          ? Number(process.env.FX_ATR_PIPS_MAX)
          : 300;
        if (atrPips < min || atrPips > max) {
          return { status: 'FAIL', reason: `ATR pips out-of-range (${atrPips})` };
        }
        return { status: 'PASS', reason: null };
      })();
      addLayer(
        'fx_range_sanity',
        'FX range sanity (ATR pips)',
        0.7,
        forexAtrOk.status,
        forexAtrOk.reason,
        Number.isFinite(atrPips) ? { atrPips } : null
      );

      const cryptoSpikeOk = (() => {
        if (assetClass !== 'crypto') {
          return { status: 'SKIP', reason: 'Non-crypto' };
        }
        const spike = Number.isFinite(Number(process.env.CRYPTO_ATR_PCT_SPIKE))
          ? Number(process.env.CRYPTO_ATR_PCT_SPIKE)
          : 2.2;
        if (!atrPctFinite) {
          return { status: 'SKIP', reason: 'ATR% unavailable' };
        }
        if (atrPct > spike) {
          return { status: 'FAIL', reason: `ATR% spike (${atrPct}%)` };
        }
        return { status: 'PASS', reason: null };
      })();
      addLayer(
        'crypto_vol_spike',
        'Crypto volatility spike guard (ATR%)',
        0.9,
        cryptoSpikeOk.status,
        cryptoSpikeOk.reason,
        atrPctFinite ? { atrPct } : null
      );

      // Entry-level sanity (risk/reward floor).
      addLayer(
        'rr_minimum',
        'Risk/Reward meets minimum',
        0.9,
        riskReward == null ? 'SKIP' : riskReward >= profile.minRiskReward ? 'PASS' : 'FAIL',
        riskReward == null
          ? 'Risk/reward unavailable'
          : riskReward >= profile.minRiskReward
            ? null
            : `RR=${riskReward} < ${profile.minRiskReward}`,
        riskReward == null ? null : { riskReward, min: profile.minRiskReward }
      );

      // Structure/regime hints from candle-derived analyses (if present).
      const candlesByTf =
        technical?.candlesByTimeframe && typeof technical.candlesByTimeframe === 'object'
          ? technical.candlesByTimeframe
          : null;
      const structure = candlesByTf?.M15?.structure || candlesByTf?.H1?.structure || null;

      // Market phase authority: only allow Expansion (early/mid) or Retracement inside expansion.
      const phaseAnalysis =
        candlesByTf?.H1 || candlesByTf?.M15 || candlesByTf?.H4 || candlesByTf?.D1 || null;
      const marketPhase = (() => {
        const smc =
          phaseAnalysis?.smc && typeof phaseAnalysis.smc === 'object' ? phaseAnalysis.smc : null;
        const smcAccDist =
          smc?.accumulationDistribution && typeof smc.accumulationDistribution === 'object'
            ? smc.accumulationDistribution
            : null;
        const ad = String(smcAccDist?.state || '').toLowerCase();
        if (ad.includes('accum')) {
          return 'accumulation';
        }
        if (ad.includes('dist')) {
          return 'distribution';
        }

        const reg = String(phaseAnalysis?.regime?.state || '').toLowerCase();
        const vol = String(phaseAnalysis?.volatility?.state || '').toLowerCase();
        const sBias = String(phaseAnalysis?.structure?.bias || '').toUpperCase();
        const cDir = String(
          phaseAnalysis?.direction || candlesSummary?.direction || ''
        ).toUpperCase();
        const t = Number.isFinite(Number(phaseAnalysis?.trendPct))
          ? Number(phaseAnalysis.trendPct)
          : null;

        if ((sBias === 'BUY' || sBias === 'SELL') && (cDir === 'BUY' || cDir === 'SELL')) {
          const against = sBias !== cDir;
          if (against && (t == null || Math.abs(t) <= 0.12)) {
            return 'retracement';
          }
        }

        if (reg && reg !== 'range' && (vol === 'normal' || vol === 'high')) {
          return 'expansion';
        }

        if (reg === 'range' || vol === 'low') {
          return 'accumulation';
        }

        return 'unknown';
      })();

      const marketPhaseGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!phaseAnalysis) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Market phase unavailable (strict)' }
            : { status: 'SKIP', reason: 'Market phase unavailable' };
        }
        if (marketPhase === 'expansion' || marketPhase === 'retracement') {
          return { status: 'PASS', reason: null, phase: marketPhase };
        }
        if (marketPhase === 'unknown') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Market phase unknown (strict)', phase: marketPhase }
            : { status: 'SKIP', reason: 'Market phase unknown', phase: marketPhase };
        }
        return { status: 'FAIL', reason: `Disallowed phase=${marketPhase}`, phase: marketPhase };
      })();

      addLayer(
        'smart_market_phase_authority',
        'Market phase authority (Expansion/Retracement)',
        1.05,
        marketPhaseGate.status,
        marketPhaseGate.reason,
        { phase: marketPhaseGate.phase ?? marketPhase, tf: phaseAnalysis?.timeframe ?? null }
      );

      // HTF narrative engine: provide an explicit story (continuation vs pullback vs distribution)
      // and optionally veto when the narrative is clearly unfavorable.
      const htfNarrativeGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional', narrative: 'unknown' };
        }
        const phase = String(marketPhase || 'unknown');

        const breakoutConfirmed = null;
        const inLocation =
          locationGateFinal?.status === 'PASS' || monthLocationGateFinal?.status === 'PASS';
        const hasTrigger = decisiveCandleGate?.status === 'PASS';

        if (phase === 'distribution') {
          return {
            status: 'FAIL',
            reason: 'HTF narrative: distribution risk',
            narrative: 'distribution',
            phase,
            breakoutConfirmed,
            inLocation,
            hasTrigger
          };
        }

        if (phase === 'retracement') {
          return {
            status: inLocation ? 'PASS' : strictSmartChecklist ? 'FAIL' : 'SKIP',
            reason: inLocation
              ? null
              : strictSmartChecklist
                ? 'HTF narrative: pullback context missing (strict)'
                : 'HTF narrative: pullback context missing',
            narrative: 'pullback_in_trend',
            phase,
            breakoutConfirmed,
            inLocation,
            hasTrigger
          };
        }

        if (phase === 'expansion') {
          return {
            status: hasTrigger ? 'PASS' : strictSmartChecklist ? 'FAIL' : 'SKIP',
            reason: hasTrigger
              ? null
              : strictSmartChecklist
                ? 'HTF narrative: continuation but no trigger (strict)'
                : 'HTF narrative: continuation but no trigger',
            narrative: 'continuation',
            phase,
            breakoutConfirmed,
            inLocation,
            hasTrigger
          };
        }

        if (phase === 'accumulation') {
          return strictSmartChecklist
            ? {
                status: 'FAIL',
                reason: 'HTF narrative: accumulation/range (strict no-trade)',
                narrative: 'accumulation',
                phase,
                breakoutConfirmed,
                inLocation,
                hasTrigger
              }
            : {
                status: 'SKIP',
                reason: 'HTF narrative: accumulation/range',
                narrative: 'accumulation',
                phase,
                breakoutConfirmed,
                inLocation,
                hasTrigger
              };
        }

        return strictSmartChecklist
          ? {
              status: 'FAIL',
              reason: 'HTF narrative unavailable/unknown (strict)',
              narrative: 'unknown',
              phase,
              breakoutConfirmed,
              inLocation,
              hasTrigger
            }
          : {
              status: 'SKIP',
              reason: 'HTF narrative unavailable/unknown',
              narrative: 'unknown',
              phase,
              breakoutConfirmed,
              inLocation,
              hasTrigger
            };
      })();

      addLayer(
        'smart_htf_narrative',
        'HTF narrative (continuation/pullback/distribution)',
        1.25,
        htfNarrativeGate.status,
        htfNarrativeGate.reason,
        {
          narrative: htfNarrativeGate.narrative ?? null,
          phase: htfNarrativeGate.phase ?? null,
          breakoutConfirmed: htfNarrativeGate.breakoutConfirmed ?? null,
          inLocation: htfNarrativeGate.inLocation ?? null,
          hasTrigger: htfNarrativeGate.hasTrigger ?? null
        }
      );

      const phaseTimingGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        // Retracements are allowed (entries should occur there). Late-expansion is the main veto.
        if (marketPhase !== 'expansion') {
          return { status: 'PASS', reason: null, phase: marketPhase };
        }
        if (!Number.isFinite(rsiValue)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'RSI unavailable for timing (strict)', phase: marketPhase }
            : { status: 'SKIP', reason: 'RSI unavailable for timing', phase: marketPhase };
        }
        const buyLate = dir === 'BUY' && rsiValue >= 72;
        const sellLate = dir === 'SELL' && rsiValue <= 28;
        if (buyLate || sellLate) {
          return {
            status: 'FAIL',
            reason: `Late expansion risk (RSI=${rsiValue})`,
            phase: marketPhase,
            rsi: rsiValue
          };
        }
        return { status: 'PASS', reason: null, phase: marketPhase, rsi: rsiValue };
      })();

      addLayer(
        'smart_phase_timing',
        'Phase timing (anti-FOMO)',
        0.95,
        phaseTimingGate.status,
        phaseTimingGate.reason,
        { phase: phaseTimingGate.phase ?? marketPhase, rsi: phaseTimingGate.rsi ?? null }
      );
      if (!isDirectional || !structure || typeof structure !== 'object') {
        addLayer('structure', 'Structure (HH/HL vs LL/LH)', 0.6, 'SKIP', 'Structure unavailable');
      } else {
        const bias = String(structure?.bias || '').toUpperCase();
        const ok = bias === 'BUY' || bias === 'SELL' ? bias === dir : null;
        addLayer(
          'structure',
          'Structure (HH/HL vs LL/LH)',
          0.6,
          ok == null ? 'SKIP' : ok ? 'PASS' : 'FAIL',
          ok == null ? 'Structure neutral' : ok ? null : `structure=${bias} vs signal=${dir}`,
          { bias: bias || null, confidence: Number(structure?.confidence) || null }
        );
      }

      // Strict structure cleanliness: aligned bias + adequate confidence + trend regime.
      const structureGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        if (!structure || typeof structure !== 'object') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Structure unavailable (strict)' }
            : { status: 'SKIP', reason: 'Structure unavailable' };
        }

        const sBias = String(structure?.bias || '').toUpperCase();
        const sConf = Number(structure?.confidence);
        if (sBias !== 'BUY' && sBias !== 'SELL') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Structure bias invalid (strict)' }
            : { status: 'SKIP', reason: 'Structure bias invalid' };
        }
        if (sBias !== dir) {
          return { status: 'FAIL', reason: `Structure=${sBias} vs signal=${dir}` };
        }
        if (Number.isFinite(sConf) && sConf < 60) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: `Structure confidence=${sConf} (<60)` }
            : { status: 'SKIP', reason: 'Structure confidence low' };
        }

        const regime = candlesByTf?.M15?.regime || candlesByTf?.H1?.regime || null;
        const regState = String(regime?.state || '').toLowerCase();
        const regConf = Number(regime?.confidence);
        if (regState === 'range') {
          return { status: 'FAIL', reason: 'Regime is range (structure not clean)' };
        }
        if (Number.isFinite(regConf) && regConf < 60) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: `Regime confidence=${regConf} (<60)` }
            : { status: 'SKIP', reason: 'Regime confidence low' };
        }
        return {
          status: 'PASS',
          reason: null,
          structureConfidence: Number.isFinite(sConf) ? sConf : null,
          regimeConfidence: Number.isFinite(regConf) ? regConf : null
        };
      })();

      addLayer(
        'smart_structure_clean',
        'Market structure clean (HH/HL or LL/LH)',
        1.0,
        structureGate.status,
        structureGate.reason,
        {
          structureConfidence: structureGate.structureConfidence ?? null,
          regimeConfidence: structureGate.regimeConfidence ?? null
        }
      );

      // Volatility must be tradeable (not contracted/low, not chaotic/high).
      const volStateGate = (() => {
        const v = candlesByTf?.M15?.volatility || candlesByTf?.H1?.volatility || null;
        const state = String(v?.state || '').toLowerCase();
        if (!state) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Volatility state unavailable (strict)' }
            : { status: 'SKIP', reason: 'Volatility state unavailable' };
        }
        if (state === 'normal') {
          return { status: 'PASS', reason: null, state };
        }
        if (state === 'low') {
          return { status: 'FAIL', reason: 'Volatility contracted (low)', state };
        }
        if (state === 'high') {
          return { status: 'FAIL', reason: 'Volatility chaotic (high)', state };
        }
        return { status: 'SKIP', reason: `Volatility state=${state}`, state };
      })();

      addLayer(
        'smart_volatility_state',
        'Volatility tradeable (not low/high)',
        0.9,
        volStateGate.status,
        volStateGate.reason,
        volStateGate && typeof volStateGate === 'object'
          ? { state: volStateGate.state ?? null }
          : null
      );

      const regimeState = String(technical?.candlesSummary?.direction || '').toUpperCase();
      addLayer(
        'candles_summary',
        'Candle summary agreement',
        0.55,
        !isDirectional || !regimeState
          ? 'SKIP'
          : regimeState === 'NEUTRAL'
            ? 'SKIP'
            : regimeState === dir
              ? 'PASS'
              : 'FAIL',
        !isDirectional || !regimeState
          ? 'Candles summary unavailable'
          : regimeState === 'NEUTRAL'
            ? 'Candles summary neutral'
            : regimeState === dir
              ? null
              : `candles=${regimeState} vs signal=${dir}`
      );

      const pickSmc = (byTf) => {
        const map = byTf && typeof byTf === 'object' ? byTf : null;
        if (!map) {
          return { tf: null, smc: null };
        }
        const order = ['H1', 'M15', 'H4', 'D1', 'M1'];
        for (const tf of order) {
          const analysis = map?.[tf] || map?.[String(tf).toLowerCase()] || null;
          const smc = analysis?.smc && typeof analysis.smc === 'object' ? analysis.smc : null;
          if (smc) {
            return { tf, smc };
          }
        }
        const entries = Object.entries(map);
        for (const [tf, analysis] of entries) {
          const smc = analysis?.smc && typeof analysis.smc === 'object' ? analysis.smc : null;
          if (smc) {
            return { tf, smc };
          }
        }
        return { tf: null, smc: null };
      };

      const { tf: smcTf, smc } = pickSmc(candlesByTf);
      const sweep =
        smc?.liquiditySweep && typeof smc.liquiditySweep === 'object' ? smc.liquiditySweep : null;
      const ob = smc?.orderBlock && typeof smc.orderBlock === 'object' ? smc.orderBlock : null;
      const fvg =
        smc?.priceImbalance && typeof smc.priceImbalance === 'object' ? smc.priceImbalance : null;
      const volSpike =
        smc?.volumeSpike && typeof smc.volumeSpike === 'object' ? smc.volumeSpike : null;
      const volImb =
        smc?.volumeImbalance && typeof smc.volumeImbalance === 'object'
          ? smc.volumeImbalance
          : null;

      const sweepStatus = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!sweep) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No sweep confirmation (strict)' }
            : { status: 'SKIP', reason: 'No sweep signal' };
        }
        const bias = String(sweep?.bias || '').toUpperCase();
        const conf = Number(sweep?.confidence);
        if (bias !== 'BUY' && bias !== 'SELL') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Sweep bias unavailable (strict)' }
            : { status: 'SKIP', reason: 'Sweep bias unavailable' };
        }
        if (bias === dir && (!Number.isFinite(conf) || conf >= 55)) {
          return { status: 'PASS', reason: null };
        }
        if (bias === dir && Number.isFinite(conf) && conf < 55) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: `Sweep confidence=${conf} (<55)` }
            : { status: 'SKIP', reason: 'Low-confidence sweep' };
        }
        // Only treat as a meaningful conflict when confidence is decent.
        if (Number.isFinite(conf) && conf >= 55) {
          return { status: 'FAIL', reason: `Sweep bias=${bias} vs signal=${dir}` };
        }
        return strictSmartChecklist
          ? { status: 'FAIL', reason: `Sweep bias=${bias} vs signal=${dir} (strict)` }
          : { status: 'SKIP', reason: 'Low-confidence opposing sweep' };
      })();

      addLayer(
        'smc_liquidity_sweep',
        `SMC liquidity sweep (${smcTf || '—'})`,
        0.7,
        sweepStatus.status,
        sweepStatus.reason,
        sweep
          ? {
              type: sweep.type || null,
              bias: sweep.bias || null,
              level: sweep.level ?? null,
              confidence: sweep.confidence ?? null,
              sweptBy: sweep.sweptBy ?? null,
              rejection: sweep.rejection ?? null
            }
          : null
      );

      // Liquidity quality: follow-through vs snap-back after sweep.
      // Uses sweep.level and live quote history to determine whether price accepted the sweep.
      const sweepAcceptanceGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!sweep || sweepStatus?.status !== 'PASS') {
          return { status: 'SKIP', reason: 'No confirmed sweep' };
        }

        const level = Number(sweep?.level);
        const bias = String(sweep?.bias || '').toUpperCase();
        const conf = Number(sweep?.confidence);
        if (!Number.isFinite(level) || (bias !== 'BUY' && bias !== 'SELL')) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Sweep level/bias unavailable (strict)' }
            : { status: 'SKIP', reason: 'Sweep level/bias unavailable' };
        }

        const pipSize = getPipSize(pair);
        const atrFloor = Number.isFinite(Number(atrPips)) ? Math.max(1, Number(atrPips)) : 12;
        const bufferPips = Number.isFinite(Number(process.env.SWEEP_ACCEPT_BUFFER_PIPS))
          ? Number(process.env.SWEEP_ACCEPT_BUFFER_PIPS)
          : Math.max(0.6, Math.min(3.5, atrFloor * 0.05));

        const historyAll =
          this.analyticsCache?.quoteTelemetryByPair instanceof Map
            ? this.analyticsCache.quoteTelemetryByPair.get(String(pair || '').trim()) || []
            : [];
        const slice = Array.isArray(historyAll) ? historyAll.slice(-16) : [];
        const mids = slice.map((q) => Number(q?.mid)).filter((v) => Number.isFinite(v));
        if (mids.length < 6 || !Number.isFinite(Number(pipSize)) || pipSize <= 0) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Sweep acceptance unavailable (strict)' }
            : { status: 'SKIP', reason: 'Sweep acceptance unavailable' };
        }

        const buffer = bufferPips * pipSize;
        const expectedSide = bias === 'BUY' ? 'above' : 'below';
        const accepted = mids.filter((m) =>
          bias === 'BUY' ? m >= level + buffer : m <= level - buffer
        ).length;
        const acceptanceScore = Number((accepted / Math.max(1, mids.length)).toFixed(3));

        const current = mids[mids.length - 1];
        const distPips = Number(((current - level) / pipSize).toFixed(2));

        // High-confidence sweep must show acceptance; otherwise treat as snap-back risk.
        const needs = Number.isFinite(conf) ? conf >= 65 : strictSmartChecklist;
        if (needs && acceptanceScore < 0.55) {
          return {
            status: strictSmartChecklist ? 'FAIL' : 'SKIP',
            reason: 'Sweep not accepted (snap-back risk)',
            bias,
            expectedSide,
            level,
            bufferPips,
            acceptanceScore,
            distPips,
            samples: mids.length
          };
        }

        return {
          status: 'PASS',
          reason: null,
          bias,
          expectedSide,
          level,
          bufferPips,
          acceptanceScore,
          distPips,
          samples: mids.length
        };
      })();

      addLayer(
        'smart_sweep_acceptance',
        `Sweep acceptance (follow-through vs snap-back, ${smcTf || '—'})`,
        0.85,
        sweepAcceptanceGate.status,
        sweepAcceptanceGate.reason,
        {
          bias: sweepAcceptanceGate.bias ?? null,
          expectedSide: sweepAcceptanceGate.expectedSide ?? null,
          level: sweepAcceptanceGate.level ?? null,
          bufferPips: sweepAcceptanceGate.bufferPips ?? null,
          acceptanceScore: sweepAcceptanceGate.acceptanceScore ?? null,
          distPips: sweepAcceptanceGate.distPips ?? null,
          samples: sweepAcceptanceGate.samples ?? null
        }
      );

      // Signal TTL (setup expiry): if a setup has been present for too long without triggering cleanly,
      // treat it as stale even if price hasn't invalidated.
      const signalTtlGate = (() => {
        if (!isDirectional) {
          // Reset per-pair memory when neutral.
          try {
            if (this.analyticsCache?.telemetryByPair instanceof Map) {
              this.analyticsCache.telemetryByPair.delete(String(pair || '').trim());
            }
          } catch (_e) {
            // best-effort
          }
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        if (!this.analyticsCache || typeof this.analyticsCache !== 'object') {
          this.analyticsCache = { telemetryByPair: new Map() };
        }
        if (!(this.analyticsCache.telemetryByPair instanceof Map)) {
          this.analyticsCache.telemetryByPair = new Map();
        }

        const key = String(pair || '').trim();
        const prev = this.analyticsCache.telemetryByPair.get(key) || null;

        const setupActive =
          isDirectional &&
          strength >= minStrengthHard &&
          confidence >= minConfidenceHard &&
          (sweepStatus?.status === 'PASS' || !strictSmartChecklist);

        const ttlEnv = Number(process.env.SIGNAL_SETUP_TTL_MINUTES);
        const ttlMinutes = Number.isFinite(ttlEnv)
          ? Math.max(3, ttlEnv)
          : assetClass === 'crypto'
            ? 45
            : 25;

        let activeSince = prev?.activeSince ?? null;
        const prevDir = prev?.dir ?? null;

        if (prevDir !== dir) {
          activeSince = setupActive ? now : null;
        } else if (setupActive && activeSince == null) {
          activeSince = now;
        } else if (!setupActive) {
          activeSince = null;
        }

        this.analyticsCache.telemetryByPair.set(key, {
          dir,
          activeSince,
          lastSeen: now
        });

        if (activeSince == null) {
          return { status: 'SKIP', reason: 'Setup not active', ttlMinutes };
        }

        const ageMin = (now - activeSince) / 60000;
        if (ageMin <= ttlMinutes) {
          return { status: 'PASS', reason: null, ttlMinutes, ageMin: Number(ageMin.toFixed(2)) };
        }

        return {
          status: strictSmartChecklist ? 'FAIL' : 'SKIP',
          reason: `Setup expired (age ${Number(ageMin.toFixed(1))}m > ${ttlMinutes}m)`,
          ttlMinutes,
          ageMin: Number(ageMin.toFixed(2))
        };
      })();

      addLayer(
        'smart_signal_ttl',
        'Signal TTL (setup expiry)',
        0.95,
        signalTtlGate.status,
        signalTtlGate.reason,
        { ttlMinutes: signalTtlGate.ttlMinutes ?? null, ageMin: signalTtlGate.ageMin ?? null }
      );

      // Mandatory: liquidity event must happen before entry (sweep/stop-run confirmation).
      const liquidityEventGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (sweepStatus?.status === 'PASS') {
          return { status: 'PASS', reason: null };
        }
        return strictSmartChecklist
          ? { status: 'FAIL', reason: 'Liquidity event required before entry (strict)' }
          : { status: 'SKIP', reason: 'Liquidity event not confirmed' };
      })();

      addLayer(
        'smart_liquidity_event_required',
        `Liquidity event required (sweep, ${smcTf || '—'})`,
        0.95,
        liquidityEventGate.status,
        liquidityEventGate.reason,
        sweep
          ? {
              type: sweep.type || null,
              bias: sweep.bias || null,
              confidence: sweep.confidence ?? null
            }
          : null
      );

      const obStatus = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!ob) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No order-block detected (strict)' }
            : { status: 'SKIP', reason: 'No order-block detected' };
        }
        const obDir = String(ob?.direction || '').toUpperCase();
        const near = ob?.near;
        const conf = Number(ob?.confidence);
        if (obDir !== 'BUY' && obDir !== 'SELL') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'OB direction unavailable (strict)' }
            : { status: 'SKIP', reason: 'OB direction unavailable' };
        }
        // Only relevant when the zone is near current price.
        if (near !== true) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'OB not near price (strict)' }
            : { status: 'SKIP', reason: 'OB not near price' };
        }
        if (obDir === dir && (!Number.isFinite(conf) || conf >= 55)) {
          return { status: 'PASS', reason: null };
        }
        if (obDir === dir && Number.isFinite(conf) && conf < 55) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: `OB confidence=${conf} (<55)` }
            : { status: 'SKIP', reason: 'Low-confidence OB' };
        }
        if (Number.isFinite(conf) && conf >= 55) {
          return { status: 'FAIL', reason: `OB direction=${obDir} vs signal=${dir}` };
        }
        return strictSmartChecklist
          ? { status: 'FAIL', reason: `OB direction=${obDir} vs signal=${dir} (strict)` }
          : { status: 'SKIP', reason: 'Low-confidence opposing OB' };
      })();

      addLayer(
        'smc_order_block',
        `SMC order block (${smcTf || '—'})`,
        0.8,
        obStatus.status,
        obStatus.reason,
        ob
          ? {
              direction: ob.direction || null,
              zoneLow: ob.zoneLow ?? null,
              zoneHigh: ob.zoneHigh ?? null,
              near: ob.near ?? null,
              distance: ob.distance ?? null,
              impulseRatio: ob.impulseRatio ?? null,
              ageBars: ob.ageBars ?? null,
              confidence: ob.confidence ?? null
            }
          : null
      );

      const fvgStatus = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!fvg) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No price-imbalance/FVG (strict)' }
            : { status: 'SKIP', reason: 'No price-imbalance/FVG' };
        }
        const state = String(fvg?.state || '').toLowerCase();
        const bias = state === 'bullish' ? 'BUY' : state === 'bearish' ? 'SELL' : 'NEUTRAL';
        if (bias === 'NEUTRAL') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No meaningful FVG state (strict)' }
            : { status: 'SKIP', reason: 'No meaningful FVG state' };
        }

        const nearest = fvg?.nearest && typeof fvg.nearest === 'object' ? fvg.nearest : null;
        const fillPct = nearest ? Number(nearest?.fillPct) : NaN;
        const ageBars = nearest ? Number(nearest?.ageBars) : NaN;
        const conf = Number(fvg?.confidence);

        // Only consider it actionable when it's reasonably recent and not fully filled.
        const relevant =
          (Number.isFinite(ageBars) ? ageBars <= 20 : true) &&
          (Number.isFinite(fillPct) ? fillPct < 85 : true);
        if (!relevant) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'FVG not relevant (old/filled, strict)' }
            : { status: 'SKIP', reason: 'FVG not relevant (old/filled)' };
        }

        if (bias === dir) {
          return { status: 'PASS', reason: null };
        }

        // Only treat as a meaningful conflict when confidence is decent.
        if (Number.isFinite(conf) && conf >= 60) {
          return { status: 'FAIL', reason: `FVG bias=${bias} vs signal=${dir}` };
        }

        return { status: 'SKIP', reason: 'Low-confidence opposing FVG' };
      })();

      addLayer(
        'smc_price_imbalance',
        `SMC price imbalance / FVG (${smcTf || '—'})`,
        0.55,
        fvgStatus.status,
        fvgStatus.reason,
        fvg
          ? {
              state: fvg.state || null,
              confidence: fvg.confidence ?? null,
              nearest: fvg.nearest || null
            }
          : null
      );

      // Strict entry zone: require OB near price OR a relevant aligned FVG.
      const entryZoneGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const obPass = obStatus?.status === 'PASS';
        const fvgPass = fvgStatus?.status === 'PASS';
        if (obPass || fvgPass) {
          return { status: 'PASS', reason: null };
        }
        if (strictSmartChecklist) {
          return { status: 'FAIL', reason: 'No validated entry zone (OB/FVG) (strict)' };
        }
        return { status: 'SKIP', reason: 'Entry zone not confirmed' };
      })();

      addLayer(
        'smart_smc_entry_zone',
        `Entry zone validated (OB/FVG, ${smcTf || '—'})`,
        0.9,
        entryZoneGate.status,
        entryZoneGate.reason,
        {
          orderBlock: ob ? { near: ob?.near ?? null, direction: ob?.direction ?? null } : null,
          fvg: fvg ? { state: fvg?.state ?? null, confidence: fvg?.confidence ?? null } : null
        }
      );

      const flowStatus = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!volImb) {
          return { status: 'SKIP', reason: 'Volume imbalance unavailable' };
        }
        const state = String(volImb?.state || '').toLowerCase();
        const bias = state === 'buying' ? 'BUY' : state === 'selling' ? 'SELL' : 'NEUTRAL';
        if (bias === 'NEUTRAL') {
          return { status: 'SKIP', reason: 'Neutral volume imbalance' };
        }
        if (bias === dir) {
          return { status: 'PASS', reason: null };
        }
        // Opposing flow is a soft fail when there is also a spike.
        if (volSpike?.isSpike === true) {
          return { status: 'FAIL', reason: `Opposing volume flow with spike (${bias} vs ${dir})` };
        }
        return { status: 'SKIP', reason: 'Opposing flow without spike' };
      })();

      addLayer(
        'smc_volume_flow',
        `Volume flow / spike (${smcTf || '—'})`,
        0.6,
        flowStatus.status,
        flowStatus.reason,
        {
          spike: volSpike
            ? {
                isSpike: Boolean(volSpike?.isSpike),
                ratio: volSpike?.ratio ?? null,
                zScore: volSpike?.zScore ?? null
              }
            : null,
          imbalance: volImb
            ? {
                state: volImb?.state ?? null,
                pressurePct: volImb?.pressurePct ?? null,
                imbalance: volImb?.imbalance ?? null
              }
            : null
        }
      );

      // Strict volume confirmation: require a spike at the decision point.
      const volumeConfirm = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!volSpike || typeof volSpike !== 'object') {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No volume spike (strict)' }
            : { status: 'SKIP', reason: 'No volume spike' };
        }
        return volSpike?.isSpike === true
          ? { status: 'PASS', reason: null }
          : strictSmartChecklist
            ? { status: 'FAIL', reason: 'Volume spike not detected (strict)' }
            : { status: 'SKIP', reason: 'Volume spike not detected' };
      })();

      addLayer(
        'smart_volume_confirm',
        'Volume confirms (spike required)',
        0.85,
        volumeConfirm.status,
        volumeConfirm.reason,
        volSpike
          ? {
              isSpike: Boolean(volSpike?.isSpike),
              ratio: volSpike?.ratio ?? null,
              zScore: volSpike?.zScore ?? null
            }
          : null
      );

      // Breakout confirmation: only required when price is at/through daily+weekly extremes.
      const breakoutGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const day = d1Frame?.ranges?.day;
        const week = d1Frame?.ranges?.week;
        const month = d1Frame?.ranges?.month;
        const high = Number(day?.high);
        const low = Number(day?.low);
        const wHigh = Number(week?.high);
        const wLow = Number(week?.low);
        const mHigh = Number(month?.high);
        const mLow = Number(month?.low);
        if (!Number.isFinite(d1Last) || !Number.isFinite(high) || !Number.isFinite(low)) {
          return { status: 'SKIP', reason: 'D1 price/range unavailable' };
        }
        const range = high - low;
        const pos = range > 0 ? (d1Last - low) / range : null;
        const weekPos =
          Number.isFinite(wHigh) && Number.isFinite(wLow) && wHigh - wLow > 0
            ? (d1Last - wLow) / (wHigh - wLow)
            : null;

        const monthPos =
          Number.isFinite(mHigh) && Number.isFinite(mLow) && mHigh - mLow > 0
            ? (d1Last - mLow) / (mHigh - mLow)
            : null;

        const atUpper =
          (pos != null && pos >= 0.92) || (weekPos != null && weekPos >= 0.92) || d1Last >= high;
        const atLower =
          (pos != null && pos <= 0.08) || (weekPos != null && weekPos <= 0.08) || d1Last <= low;

        const atMonthUpper =
          (monthPos != null && monthPos >= 0.92) ||
          (Number.isFinite(mHigh) ? d1Last >= mHigh : false);
        const atMonthLower =
          (monthPos != null && monthPos <= 0.08) ||
          (Number.isFinite(mLow) ? d1Last <= mLow : false);

        const atUpperFinal = atUpper || atMonthUpper;
        const atLowerFinal = atLower || atMonthLower;

        const needs = dir === 'BUY' ? atUpperFinal : dir === 'SELL' ? atLowerFinal : false;
        if (!needs) {
          return { status: 'SKIP', reason: 'Not at extremes', needs: false };
        }

        const mustPass = [
          decisiveCandleGate?.status === 'PASS',
          volumeConfirm?.status === 'PASS',
          structureGate?.status === 'PASS',
          volStateGate?.status === 'PASS',
          timeIntel?.status === 'PASS'
        ];
        const ok = mustPass.every(Boolean);
        if (ok) {
          return {
            status: 'PASS',
            reason: null,
            needs: true,
            pos,
            weekPos,
            monthPos
          };
        }
        return {
          status: 'FAIL',
          reason: 'At extremes without breakout confirmation',
          needs: true,
          pos,
          weekPos,
          monthPos
        };
      })();

      addLayer(
        'smart_breakout_confirmation',
        'Breakout confirmation (extremes only)',
        0.95,
        breakoutGate.status,
        breakoutGate.reason,
        {
          needs: breakoutGate.needs ?? null,
          posInDayRange: Number.isFinite(Number(breakoutGate.pos))
            ? Number(Number(breakoutGate.pos).toFixed(4))
            : null,
          posInWeekRange:
            breakoutGate.weekPos != null && Number.isFinite(Number(breakoutGate.weekPos))
              ? Number(Number(breakoutGate.weekPos).toFixed(4))
              : null,
          posInMonthRange:
            breakoutGate.monthPos != null && Number.isFinite(Number(breakoutGate.monthPos))
              ? Number(Number(breakoutGate.monthPos).toFixed(4))
              : null
        }
      );

      // If breakout is confirmed, allow price-location gate to pass even if not in discount/premium.
      if (
        breakoutGate.status === 'PASS' &&
        locationGateFinal &&
        locationGateFinal.status === 'FAIL' &&
        (locationGateFinal.reason === 'Not in discount zone' ||
          locationGateFinal.reason === 'Not in premium zone')
      ) {
        locationGateFinal = {
          ...locationGateFinal,
          status: 'PASS',
          reason: 'Breakout override (confirmed)'
        };
      }

      // If breakout is confirmed at extremes, allow monthly location to pass even if not in discount/premium.
      if (
        breakoutGate.status === 'PASS' &&
        monthLocationGateFinal &&
        monthLocationGateFinal.status === 'FAIL' &&
        (monthLocationGateFinal.reason === 'Not in monthly discount zone' ||
          monthLocationGateFinal.reason === 'Not in monthly premium zone')
      ) {
        monthLocationGateFinal = {
          ...monthLocationGateFinal,
          status: 'PASS',
          reason: 'Breakout override (confirmed)'
        };
      }

      // Confirmed discount/premium zone (mandatory): requires a validated zone (OB/FVG) and a
      // meaningful retracement/position context. Breakout confirmation can satisfy the context.
      const confirmedZoneGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const entryZonePass = entryZoneGate?.status === 'PASS';
        const breakoutConfirmed = breakoutGate?.status === 'PASS' && breakoutGate?.needs === true;

        const month = d1Frame?.ranges?.month;
        const mHigh = Number(month?.high);
        const mLow = Number(month?.low);
        const monthPos =
          Number.isFinite(mHigh) &&
          Number.isFinite(mLow) &&
          mHigh - mLow > 0 &&
          Number.isFinite(d1Last)
            ? (d1Last - mLow) / (mHigh - mLow)
            : null;

        const week = d1Frame?.ranges?.week;
        const wHigh = Number(week?.high);
        const wLow = Number(week?.low);
        const weekPos =
          Number.isFinite(wHigh) &&
          Number.isFinite(wLow) &&
          wHigh - wLow > 0 &&
          Number.isFinite(d1Last)
            ? (d1Last - wLow) / (wHigh - wLow)
            : null;

        const impulseRatio = Number(ob?.impulseRatio);
        const impulseOk = Number.isFinite(impulseRatio)
          ? impulseRatio >= 0.5 && impulseRatio <= 0.62
          : null;

        // Practical approximation of "under previous weekly high / above previous weekly low":
        // require headroom (not at current weekly extreme).
        const weeklyHeadroomOk = (() => {
          if (weekPos == null || !Number.isFinite(Number(weekPos))) {
            return null;
          }
          if (dir === 'BUY') {
            return Number(weekPos) <= 0.88;
          }
          if (dir === 'SELL') {
            return Number(weekPos) >= 0.12;
          }
          return null;
        })();

        const locationOk =
          locationGateFinal?.status === 'PASS' ||
          monthLocationGateFinal?.status === 'PASS' ||
          breakoutConfirmed;

        const confirms = [entryZonePass, impulseOk === true, weeklyHeadroomOk === true].filter(
          Boolean
        ).length;

        if (locationOk && confirms >= 1) {
          return {
            status: 'PASS',
            reason: null,
            entryZonePass,
            breakoutConfirmed,
            monthPos,
            weekPos,
            impulseRatio: Number.isFinite(impulseRatio) ? impulseRatio : null
          };
        }

        return strictSmartChecklist
          ? {
              status: 'FAIL',
              reason: 'Confirmed discount/premium zone missing (strict)',
              entryZonePass,
              breakoutConfirmed,
              monthPos,
              weekPos,
              impulseRatio: Number.isFinite(impulseRatio) ? impulseRatio : null
            }
          : {
              status: 'SKIP',
              reason: 'Confirmed discount/premium zone not satisfied',
              entryZonePass,
              breakoutConfirmed,
              monthPos,
              weekPos,
              impulseRatio: Number.isFinite(impulseRatio) ? impulseRatio : null
            };
      })();

      addLayer(
        'smart_confirmed_discount_zone',
        `Confirmed discount/premium zone (${smcTf || '—'})`,
        1.0,
        confirmedZoneGate.status,
        confirmedZoneGate.reason,
        {
          entryZonePass: confirmedZoneGate.entryZonePass ?? null,
          breakoutConfirmed: confirmedZoneGate.breakoutConfirmed ?? null,
          posInWeekRange:
            confirmedZoneGate.weekPos != null && Number.isFinite(Number(confirmedZoneGate.weekPos))
              ? Number(Number(confirmedZoneGate.weekPos).toFixed(4))
              : null,
          posInMonthRange:
            confirmedZoneGate.monthPos != null &&
            Number.isFinite(Number(confirmedZoneGate.monthPos))
              ? Number(Number(confirmedZoneGate.monthPos).toFixed(4))
              : null,
          impulseRatio:
            confirmedZoneGate.impulseRatio != null &&
            Number.isFinite(Number(confirmedZoneGate.impulseRatio))
              ? Number(Number(confirmedZoneGate.impulseRatio).toFixed(4))
              : null
        }
      );

      addLayer(
        'smart_monthly_price_location',
        'Monthly location (premium/discount hard block)',
        1.05,
        monthLocationGateFinal.status,
        monthLocationGateFinal.reason,
        monthLocationGateFinal && typeof monthLocationGateFinal === 'object'
          ? {
              price: Number.isFinite(d1Last) ? d1Last : null,
              month: d1Frame?.ranges?.month || null,
              posInMonthRange:
                monthLocationGateFinal.monthPos != null &&
                Number.isFinite(Number(monthLocationGateFinal.monthPos))
                  ? Number(Number(monthLocationGateFinal.monthPos).toFixed(4))
                  : null
            }
          : null
      );

      addLayer(
        'smart_price_location',
        'Price location (premium/discount + avoid pivot/mid-range)',
        1.15,
        locationGateFinal.status,
        locationGateFinal.reason,
        locationGateFinal && typeof locationGateFinal === 'object'
          ? {
              price: Number.isFinite(d1Last) ? d1Last : null,
              day: d1Frame?.ranges?.day || null,
              week: d1Frame?.ranges?.week || null,
              month: d1Frame?.ranges?.month || null,
              pivot: d1Frame?.pivotPoints?.pivot ?? null,
              nearestPivotKey: locationGateFinal.nearestPivotKey ?? null,
              nearestPivotValue: locationGateFinal.nearestPivotValue ?? null,
              posInDayRange: Number.isFinite(locationGateFinal.pos)
                ? Number(locationGateFinal.pos.toFixed(4))
                : null,
              posInWeekRange:
                locationGateFinal.weekPos != null &&
                Number.isFinite(Number(locationGateFinal.weekPos))
                  ? Number(Number(locationGateFinal.weekPos).toFixed(4))
                  : null
            }
          : null
      );

      // Liquidity target awareness: map the next obvious liquidity pool (day/week/month extremes)
      // and ensure the trade isn't chasing liquidity already taken.
      const nextLiquidityGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        if (!Number.isFinite(d1Last)) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Price unavailable (strict)' }
            : { status: 'SKIP', reason: 'Price unavailable' };
        }

        const day = d1Frame?.ranges?.day || null;
        const week = d1Frame?.ranges?.week || null;
        const month = d1Frame?.ranges?.month || null;

        const candidates = [];
        const pushLevel = (kind, side, value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            return;
          }
          candidates.push({ kind, side, value: n });
        };

        pushLevel('day', 'high', day?.high);
        pushLevel('day', 'low', day?.low);
        pushLevel('week', 'high', week?.high);
        pushLevel('week', 'low', week?.low);
        pushLevel('month', 'high', month?.high);
        pushLevel('month', 'low', month?.low);

        const sideWanted = dir === 'BUY' ? 'high' : 'low';
        const valid = candidates
          .filter((c) => c.side === sideWanted)
          .map((c) => {
            const distPrice = Math.abs(c.value - d1Last);
            const distPips =
              typeof this.calculatePips === 'function'
                ? Number(this.calculatePips(pair || '', distPrice).toFixed(1))
                : null;
            return { ...c, distPrice, distPips };
          })
          .filter((c) => c.distPips != null && Number.isFinite(Number(c.distPips)));

        if (!valid.length) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'No liquidity pool levels available (strict)' }
            : { status: 'SKIP', reason: 'No liquidity pool levels available' };
        }

        valid.sort((a, b) => Number(a.distPips) - Number(b.distPips));
        const next = valid[0];

        const tp =
          takeProfitPips != null && Number.isFinite(Number(takeProfitPips))
            ? Number(takeProfitPips)
            : null;
        const sl =
          stopLossPips != null && Number.isFinite(Number(stopLossPips))
            ? Number(stopLossPips)
            : null;

        const rrToPool =
          sl != null && sl > 0 ? Number((Number(next.distPips) / sl).toFixed(2)) : null;
        const tpFrac =
          tp != null && tp > 0 ? Number((Number(next.distPips) / tp).toFixed(3)) : null;

        const minTpFracEnv = Number(process.env.SIGNAL_MIN_TP_FRACTION_TO_LIQUIDITY);
        const minTpFrac = Number.isFinite(minTpFracEnv)
          ? Math.max(0.05, Math.min(0.95, minTpFracEnv))
          : 0.45;

        if (tpFrac != null && tpFrac < minTpFrac) {
          return {
            status: 'FAIL',
            reason: `Next liquidity too close (dist=${next.distPips}p, <${Math.round(minTpFrac * 100)}% of TP)`,
            next,
            rrToPool,
            tpFrac
          };
        }

        return { status: 'PASS', reason: null, next, rrToPool, tpFrac };
      })();

      addLayer(
        'smart_next_liquidity_pool',
        'Next liquidity pool awareness (distance + R/R to pool)',
        1.25,
        nextLiquidityGate.status,
        nextLiquidityGate.reason,
        nextLiquidityGate && typeof nextLiquidityGate === 'object'
          ? {
              next: nextLiquidityGate.next || null,
              rrToPool: nextLiquidityGate.rrToPool ?? null,
              tpFrac: nextLiquidityGate.tpFrac ?? null,
              minTpFrac: Number.isFinite(Number(process.env.SIGNAL_MIN_TP_FRACTION_TO_LIQUIDITY))
                ? Math.max(
                    0.05,
                    Math.min(0.95, Number(process.env.SIGNAL_MIN_TP_FRACTION_TO_LIQUIDITY))
                  )
                : 0.45
            }
          : null
      );

      // Entry trigger logic: require a trigger candle + a validated zone (or a confirmed breakout).
      const entryTriggerGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const breakoutOk = breakoutGate?.status === 'PASS' && breakoutGate?.needs === true;
        const decisiveOk = decisiveCandleGate?.status === 'PASS';
        const zoneOk =
          entryZoneGate?.status === 'PASS' || confirmedZoneGate?.status === 'PASS' || false;

        if (breakoutOk) {
          return {
            status: 'PASS',
            reason: 'Breakout trigger confirmed',
            type: 'breakout',
            breakoutOk,
            decisiveOk,
            zoneOk
          };
        }
        if (decisiveOk && zoneOk) {
          return {
            status: 'PASS',
            reason: 'Entry trigger confirmed (decisive candle + zone)',
            type: 'zone',
            breakoutOk,
            decisiveOk,
            zoneOk
          };
        }

        return strictSmartChecklist
          ? {
              status: 'FAIL',
              reason:
                'No entry trigger (need decisive candle + zone, or confirmed breakout) (strict)',
              type: 'none',
              breakoutOk,
              decisiveOk,
              zoneOk
            }
          : {
              status: 'SKIP',
              reason: 'Entry trigger not confirmed',
              type: 'none',
              breakoutOk,
              decisiveOk,
              zoneOk
            };
      })();

      addLayer(
        'smart_entry_trigger',
        'Entry trigger authority (candle + zone / breakout)',
        1.2,
        entryTriggerGate.status,
        entryTriggerGate.reason,
        {
          type: entryTriggerGate.type ?? null,
          breakoutOk: entryTriggerGate.breakoutOk ?? null,
          decisiveOk: entryTriggerGate.decisiveOk ?? null,
          zoneOk: entryTriggerGate.zoneOk ?? null
        }
      );

      // HTF memory layer (EA-only): repeated touches of the same HTF extreme + trend-chasing is a veto unless
      // breakout confirmation is present. FAIL-only (SKIP when safe) to avoid ever boosting confluence.
      const htfMemoryGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const memory =
          typeof this.getMarketMemory === 'function'
            ? this.getMarketMemory(pair, { limit: 6 })
            : null;
        const recent = Array.isArray(memory?.recent) ? memory.recent : [];
        if (!recent.length) {
          return { status: 'SKIP', reason: 'No HTF memory' };
        }

        const day = d1Frame?.ranges?.day;
        const week = d1Frame?.ranges?.week;
        const high = Number(day?.high);
        const low = Number(day?.low);
        const wHigh = Number(week?.high);
        const wLow = Number(week?.low);
        const px = Number(d1Last);

        const dayRange = Number.isFinite(high) && Number.isFinite(low) ? high - low : null;
        const weekRange = Number.isFinite(wHigh) && Number.isFinite(wLow) ? wHigh - wLow : null;

        const nearDayHigh =
          dayRange != null && dayRange > 0 && Number.isFinite(px)
            ? Math.abs(px - high) <= dayRange * 0.03
            : false;
        const nearDayLow =
          dayRange != null && dayRange > 0 && Number.isFinite(px)
            ? Math.abs(px - low) <= dayRange * 0.03
            : false;
        const nearWeekHigh =
          weekRange != null && weekRange > 0 && Number.isFinite(px)
            ? Math.abs(px - wHigh) <= weekRange * 0.03
            : false;
        const nearWeekLow =
          weekRange != null && weekRange > 0 && Number.isFinite(px)
            ? Math.abs(px - wLow) <= weekRange * 0.03
            : false;

        const chasingHigh = dir === 'BUY' && (nearDayHigh || nearWeekHigh);
        const chasingLow = dir === 'SELL' && (nearDayLow || nearWeekLow);
        const isChasingExtreme = chasingHigh || chasingLow;
        if (!isChasingExtreme) {
          return { status: 'SKIP', reason: 'Not chasing HTF extreme' };
        }

        const tag = chasingHigh ? 'weeklyHigh' : 'weeklyLow';
        const recentTagged = recent
          .slice(0, 4)
          .filter((m) => Array.isArray(m?.touches) && m.touches.includes(tag)).length;

        if (recentTagged < 2) {
          return { status: 'SKIP', reason: 'No repeated HTF extreme tags' };
        }

        const breakoutConfirmed = breakoutGate?.status === 'PASS' && breakoutGate?.needs === true;
        const volumeOk = volumeConfirm?.status === 'PASS';
        const candleOk = decisiveCandleGate?.status === 'PASS';

        if (breakoutConfirmed && volumeOk && candleOk) {
          return { status: 'SKIP', reason: 'Extreme tags OK with breakout+volume+candle' };
        }

        return {
          status: 'FAIL',
          reason: 'HTF memory warns: repeated extreme tags without breakout confirmation',
          tag,
          recentTagged,
          breakoutConfirmed,
          volumeOk,
          candleOk
        };
      })();

      addLayer(
        'smart_htf_memory_layer',
        'HTF memory layer (repeated extreme tags veto)',
        1.05,
        htfMemoryGate.status,
        htfMemoryGate.reason,
        htfMemoryGate && typeof htfMemoryGate === 'object'
          ? {
              tag: htfMemoryGate.tag ?? null,
              recentTagged: htfMemoryGate.recentTagged ?? null,
              breakoutConfirmed: htfMemoryGate.breakoutConfirmed ?? null
            }
          : null
      );

      // EA quote integrity: to execute safely we need a fresh, valid bid/ask quote.
      // This only hard-fails in strict mode when EA is the market-data source of truth.
      const quoteIntegrityGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const dqIssues = Array.isArray(marketData?.issues) ? marketData.issues.map(String) : [];
        const eaSourceOfTruth = dqIssues.some((i) => i.toLowerCase().includes('ea_bridge_source'));
        if (!eaSourceOfTruth) {
          return { status: 'SKIP', reason: 'Not EA-sourced market data' };
        }

        const eaQuote =
          marketData?.eaQuote && typeof marketData.eaQuote === 'object' ? marketData.eaQuote : null;

        const toMs = (raw) => {
          if (typeof raw === 'number' && Number.isFinite(raw)) {
            return raw < 2_000_000_000 ? raw * 1000 : raw;
          }
          if (raw instanceof Date) {
            return raw.getTime();
          }
          if (!raw) {
            return NaN;
          }
          const parsed = Date.parse(String(raw));
          return Number.isFinite(parsed) ? parsed : NaN;
        };

        const bid = eaQuote && Number.isFinite(Number(eaQuote.bid)) ? Number(eaQuote.bid) : null;
        const ask = eaQuote && Number.isFinite(Number(eaQuote.ask)) ? Number(eaQuote.ask) : null;

        const tsMs = eaQuote ? toMs(eaQuote.timestamp) : NaN;
        const ageMs = Number.isFinite(tsMs) ? Math.max(0, now - tsMs) : null;

        const maxAgeMs = Number.isFinite(Number(process.env.EA_QUOTE_MAX_AGE_MS))
          ? Number(process.env.EA_QUOTE_MAX_AGE_MS)
          : 30 * 1000;

        const hasBidAsk = bid != null && ask != null;
        const bidAskOk = hasBidAsk ? ask > 0 && bid > 0 && ask > bid : false;

        // Optional consistency check: mid price should be reasonably close to analysis/entry price.
        const mid = hasBidAsk && bidAskOk ? (bid + ask) / 2 : null;
        const refPrice =
          entry && Number.isFinite(Number(entry.price))
            ? Number(entry.price)
            : Number.isFinite(Number(technical?.marketPrice))
              ? Number(technical.marketPrice)
              : null;
        const deltaPips =
          mid != null && refPrice != null && typeof this.calculatePips === 'function'
            ? Number(this.calculatePips(pair || '', Math.abs(mid - refPrice)).toFixed(2))
            : null;

        const desync =
          deltaPips != null && atrPips != null && Number.isFinite(atrPips) && atrPips > 0
            ? deltaPips > atrPips * 2
            : false;

        if (strictSmartChecklist) {
          if (!eaQuote) {
            return { status: 'FAIL', reason: 'EA quote missing (strict)', ageMs, bid, ask };
          }
          if (!bidAskOk) {
            return {
              status: 'FAIL',
              reason: 'Invalid EA bid/ask (strict)',
              ageMs,
              bid,
              ask
            };
          }
          if (ageMs == null) {
            return {
              status: 'FAIL',
              reason: 'EA quote timestamp missing/unparseable (strict)',
              ageMs,
              bid,
              ask
            };
          }
          if (ageMs > maxAgeMs) {
            return {
              status: 'FAIL',
              reason: `EA quote stale (${Math.round(ageMs / 1000)}s) (strict)`,
              ageMs,
              maxAgeMs,
              bid,
              ask
            };
          }
          if (desync) {
            return {
              status: 'FAIL',
              reason: 'EA quote price desynced vs analysis price (strict)',
              ageMs,
              bid,
              ask,
              deltaPips,
              atrPips
            };
          }
          return { status: 'PASS', reason: null, ageMs, maxAgeMs, bid, ask, deltaPips, atrPips };
        }

        // Non-strict: expose diagnostics, but do not hard veto.
        return { status: 'SKIP', reason: 'Quote integrity not enforced', ageMs, bid, ask };
      })();

      addLayer(
        'smart_quote_integrity',
        'EA quote integrity (fresh bid/ask required)',
        1.05,
        quoteIntegrityGate.status,
        quoteIntegrityGate.reason,
        {
          ageMs: quoteIntegrityGate.ageMs ?? null,
          maxAgeMs: quoteIntegrityGate.maxAgeMs ?? null,
          bid: quoteIntegrityGate.bid ?? null,
          ask: quoteIntegrityGate.ask ?? null,
          deltaPips: quoteIntegrityGate.deltaPips ?? null,
          atrPips: quoteIntegrityGate.atrPips ?? null
        }
      );

      // Liquidity + execution risk: thin/fake liquidity + high spread is a hard veto in strict mode.
      const liquidityExecGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        if (quoteIntegrityGate?.status === 'FAIL') {
          return { status: 'SKIP', reason: 'Quote integrity veto (see quote integrity layer)' };
        }
        const eaQuote =
          marketData?.eaQuote && typeof marketData.eaQuote === 'object' ? marketData.eaQuote : null;
        const hint = String(eaQuote?.liquidityHint || '').toLowerCase();
        const qVol = Number(eaQuote?.volume);
        const thinHint =
          hint.includes('thin') ||
          hint.includes('fake') ||
          hint.includes('poor') ||
          hint.includes('low');
        const lowVol = Number.isFinite(qVol) ? qVol <= 40 : false;

        if (spreadPips == null) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Spread unavailable for liquidity gate (strict)' }
            : { status: 'SKIP', reason: 'Spread unavailable for liquidity gate' };
        }

        const nearLimit = spreadPips > maxSpreadPips * 0.9;
        const thin = thinHint || lowVol;

        // Mandatory execution gate (strict): thin liquidity OR elevated spread => veto.
        if (strictSmartChecklist) {
          if (thin) {
            return {
              status: 'FAIL',
              reason: 'Thin/fake liquidity (strict veto)',
              thin,
              nearLimit,
              spreadPips
            };
          }
          if (nearLimit) {
            return {
              status: 'FAIL',
              reason:
                spreadPips > maxSpreadPips
                  ? 'Spread above max limit (strict veto)'
                  : 'Spread elevated near limit (strict veto)',
              thin,
              nearLimit,
              spreadPips
            };
          }
          return { status: 'PASS', reason: null, thin, nearLimit, spreadPips };
        }

        // Non-strict behavior: require both thin liquidity and near-limit spread.
        if (thin && nearLimit) {
          return {
            status: 'FAIL',
            reason: 'Thin liquidity + elevated spread',
            thin,
            nearLimit,
            spreadPips
          };
        }
        return { status: 'PASS', reason: null, thin, nearLimit, spreadPips };
      })();

      addLayer(
        'smart_liquidity_execution_risk',
        'Liquidity + execution risk (thin+spread veto)',
        1.05,
        liquidityExecGate.status,
        liquidityExecGate.reason,
        {
          spreadPips,
          maxSpreadPips,
          thin: liquidityExecGate.thin ?? null,
          nearLimit: liquidityExecGate.nearLimit ?? null
        }
      );

      // Execution quality gate (includes slippage risk proxy). We do not have true slippage telemetry from EA;
      // instead we treat thin liquidity + near-limit spread + chaotic vol as a high-slippage-risk veto.
      // FAIL-only (SKIP when safe) to avoid ever boosting confluence.
      const slippageRiskGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const nearLimit = Boolean(liquidityExecGate?.nearLimit);
        const thin = Boolean(liquidityExecGate?.thin);
        const volChaotic = volStateGate?.state === 'high' || volStateGate?.status === 'FAIL';

        const quote =
          signal?.components?.telemetry?.quote &&
          typeof signal.components.telemetry.quote === 'object'
            ? signal.components.telemetry.quote
            : null;
        const newsT =
          signal?.components?.telemetry?.news &&
          typeof signal.components.telemetry.news === 'object'
            ? signal.components.telemetry.news
            : null;

        const pipSize = getPipSize(pair);
        const vPerSec = Number(quote?.midVelocityPerSec);
        const velPipsPerSec =
          Number.isFinite(vPerSec) && Number.isFinite(Number(pipSize)) && pipSize > 0
            ? Number((vPerSec / pipSize).toFixed(3))
            : null;
        const atrFloor = Number.isFinite(Number(atrPips)) ? Math.max(1, Number(atrPips)) : 12;
        const velAtrPerSec = velPipsPerSec != null ? Math.abs(velPipsPerSec) / atrFloor : null;

        const liquidityHint = quote?.liquidityHint ?? null;
        const liquidityHintPenalty = (() => {
          if (typeof liquidityHint === 'number' && Number.isFinite(liquidityHint)) {
            return liquidityHint < 0.35 ? 15 : liquidityHint < 0.5 ? 8 : 0;
          }
          const s = String(liquidityHint || '').toLowerCase();
          if (!s) {
            return 0;
          }
          if (s.includes('thin') || s.includes('illiquid') || s.includes('low')) {
            return 15;
          }
          if (s.includes('medium')) {
            return 6;
          }
          return 0;
        })();

        const nextHighImpactMin =
          newsT && Number.isFinite(Number(newsT.nextHighImpactMinutes))
            ? Number(newsT.nextHighImpactMinutes)
            : null;

        const postNewsRegime = postNewsRegimeGate?.regime || null;
        const postNewsMinutes = postNewsRegimeGate?.minutesSinceEvent ?? null;

        let riskScore = 0;
        if (thin) {
          riskScore += 45;
        }
        if (nearLimit) {
          riskScore += 30;
        }
        if (volChaotic) {
          riskScore += 25;
        }

        // Execution-aware scoring: fast tape + bad liquidity + news proximity.
        riskScore += liquidityHintPenalty;
        if (velAtrPerSec != null) {
          if (velAtrPerSec >= 0.04) {
            riskScore += 25;
          } else if (velAtrPerSec >= 0.015) {
            riskScore += 14;
          }
        }
        if (nextHighImpactMin != null && nextHighImpactMin >= 0 && nextHighImpactMin <= 12) {
          riskScore += 18;
        }
        if (postNewsRegime === 'choppy') {
          riskScore += 18;
        }
        if (
          postNewsMinutes != null &&
          Number.isFinite(Number(postNewsMinutes)) &&
          postNewsMinutes <= 30
        ) {
          riskScore += 10;
        }

        if (riskScore < 65) {
          return {
            status: 'SKIP',
            reason: 'Slippage risk acceptable',
            riskScore,
            velPipsPerSec,
            velAtrPerSec,
            liquidityHintPenalty,
            nextHighImpactMin,
            postNewsRegime
          };
        }

        const estimatedSlippagePips =
          spreadPips != null && Number.isFinite(Number(spreadPips))
            ? Number((Number(spreadPips) * (riskScore / 100) * 0.85).toFixed(3))
            : null;

        // Execution-first adjustment: if estimated slippage collapses effective RR, veto.
        const effectiveRr = (() => {
          if (
            estimatedSlippagePips == null ||
            !Number.isFinite(Number(estimatedSlippagePips)) ||
            estimatedSlippagePips < 0.2
          ) {
            return null;
          }
          if (stopLossPips == null || takeProfitPips == null) {
            return null;
          }
          const sl = Number(stopLossPips);
          const tp = Number(takeProfitPips);
          if (!Number.isFinite(sl) || !Number.isFinite(tp) || sl <= 0 || tp <= 0) {
            return null;
          }
          const slip = Number(estimatedSlippagePips) * 1.2;
          const eff = (tp - slip) / (sl + slip);
          return Number.isFinite(eff) ? Number(eff.toFixed(2)) : null;
        })();

        if (effectiveRr != null && effectiveRr < profile.minRiskReward) {
          return {
            status: 'FAIL',
            reason: `Effective RR below minimum after slippage (effRR=${effectiveRr} < ${profile.minRiskReward})`,
            riskScore,
            estimatedSlippagePips,
            effectiveRr,
            velPipsPerSec,
            velAtrPerSec,
            liquidityHintPenalty,
            nextHighImpactMin,
            postNewsRegime
          };
        }

        return {
          status: 'FAIL',
          reason: 'High slippage risk (thin liquidity + spread + volatility)',
          riskScore,
          estimatedSlippagePips,
          effectiveRr,
          velPipsPerSec,
          velAtrPerSec,
          liquidityHintPenalty,
          nextHighImpactMin,
          postNewsRegime
        };
      })();

      addLayer(
        'smart_execution_slippage_risk',
        'Execution quality (slippage risk proxy)',
        1.05,
        slippageRiskGate.status,
        slippageRiskGate.reason,
        {
          riskScore: slippageRiskGate.riskScore ?? null,
          estimatedSlippagePips: slippageRiskGate.estimatedSlippagePips ?? null,
          effectiveRr: slippageRiskGate.effectiveRr ?? null,
          velPipsPerSec: slippageRiskGate.velPipsPerSec ?? null,
          velAtrPerSec: slippageRiskGate.velAtrPerSec ?? null,
          nextHighImpactMin: slippageRiskGate.nextHighImpactMin ?? null,
          postNewsRegime: slippageRiskGate.postNewsRegime ?? null
        }
      );

      // Continuation vs distribution filter: strong structure + weak volume + thin liquidity => assume distribution.
      const distributionGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }

        const strongStructure = structureGate?.status === 'PASS';
        const weakVolume = volumeConfirm?.status !== 'PASS';
        const thinOrExpensive =
          liquidityExecGate?.thin === true ||
          (spreadPips != null && maxSpreadPips != null && spreadPips > maxSpreadPips * 0.9);

        if (strongStructure && weakVolume && thinOrExpensive) {
          return {
            status: 'FAIL',
            reason: 'Distribution risk (trend + weak volume + thin/expensive execution)',
            strongStructure,
            weakVolume,
            thinOrExpensive
          };
        }

        return { status: 'PASS', reason: null, strongStructure, weakVolume, thinOrExpensive };
      })();

      addLayer(
        'smart_distribution_filter',
        'Continuation vs distribution filter',
        0.9,
        distributionGate.status,
        distributionGate.reason,
        {
          strongStructure: distributionGate.strongStructure ?? null,
          weakVolume: distributionGate.weakVolume ?? null,
          thinOrExpensive: distributionGate.thinOrExpensive ?? null
        }
      );

      // False continuation detector: when structure says trend, but divergence + volume say exhaustion.
      // FAIL-only (SKIP when safe) so it never boosts confluence.
      const falseContinuationGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const strongStructure = structureGate?.status === 'PASS';
        const weakVolume = volumeConfirm?.status !== 'PASS';
        const opposingDiv = divergenceGate?.status === 'FAIL';
        if (strongStructure && weakVolume && opposingDiv) {
          return {
            status: 'FAIL',
            reason: 'False continuation risk (trend + weak volume + opposing divergence)',
            strongStructure,
            weakVolume,
            opposingDiv
          };
        }
        return { status: 'SKIP', reason: 'No false continuation signature' };
      })();

      addLayer(
        'smart_false_continuation_detector',
        'False continuation detector (exhaustion veto)',
        1.0,
        falseContinuationGate.status,
        falseContinuationGate.reason
      );

      // Execution cost vs statistical edge: require positive expectancy and reasonable spread-to-move.
      const edgeVsCostGate = (() => {
        if (!isDirectional) {
          return { status: 'SKIP', reason: 'Non-directional' };
        }
        const rr = Number.isFinite(Number(riskReward)) ? Number(riskReward) : null;
        const win = Number.isFinite(Number(estimatedWinRate)) ? Number(estimatedWinRate) : null;
        const p = win != null ? Math.max(0.35, Math.min(0.9, win / 100)) : null;
        const expectancy = p != null && rr != null ? p * rr - (1 - p) * 1 : null;

        const costTooHigh =
          (spreadToTp != null && spreadToTp > 0.18) || (spreadToAtr != null && spreadToAtr > 0.35);

        if (expectancy == null) {
          return strictSmartChecklist
            ? { status: 'FAIL', reason: 'Edge/expectancy unavailable (strict)' }
            : { status: 'SKIP', reason: 'Edge/expectancy unavailable' };
        }
        if (expectancy <= 0.1) {
          return {
            status: 'FAIL',
            reason: `Negative/low expectancy (${expectancy.toFixed(2)})`,
            expectancy
          };
        }
        if (costTooHigh) {
          return {
            status: 'FAIL',
            reason: 'Execution cost too large vs expected move',
            expectancy,
            spreadToTp,
            spreadToAtr
          };
        }
        if (expectancy < 0.25 && spreadToTp != null && spreadToTp > 0.12) {
          return {
            status: 'FAIL',
            reason: 'Edge too small for spread cost',
            expectancy,
            spreadToTp
          };
        }
        return { status: 'PASS', reason: null, expectancy, spreadToTp, spreadToAtr };
      })();

      addLayer(
        'smart_execution_edge_filter',
        'Execution cost vs edge (expectancy filter)',
        1.05,
        edgeVsCostGate.status,
        edgeVsCostGate.reason,
        {
          expectancy:
            edgeVsCostGate.expectancy != null ? Number(edgeVsCostGate.expectancy.toFixed(3)) : null,
          spreadToTp,
          spreadToAtr
        }
      );

      // Data-quality soft layer (doesn't duplicate hard-block).
      const dq = marketData && typeof marketData === 'object' ? marketData : null;
      const dqScore = Number(dq?.score);
      const dqStatus = String(dq?.status || '').toLowerCase();
      const dqRecommendation = String(dq?.recommendation || '').toLowerCase();
      const dqBlocked =
        dq?.confidenceFloorBreached === true ||
        dq?.circuitBreaker ||
        dqRecommendation === 'block' ||
        dqStatus === 'critical';
      const dqOk = dq == null ? null : !dqBlocked;
      const dqReason =
        dq == null
          ? 'No data-quality report'
          : dqBlocked
            ? `Data quality ${dqStatus || 'blocked'}`
            : dqStatus === 'degraded'
              ? 'Data quality degraded'
              : null;
      addLayer(
        'data_quality',
        'Data quality status',
        0.6,
        dq == null ? 'SKIP' : dqOk ? 'PASS' : 'FAIL',
        dqReason,
        Number.isFinite(dqScore)
          ? {
              score: dqScore,
              status: dqStatus || null,
              recommendation: dqRecommendation || null
            }
          : null
      );

      // Market psychology (EA-only heuristic).
      const psychologyGate = (() => {
        const candleC = Number.isFinite(candleConf) ? candleConf : null;
        const reg = candlesByTf?.M15?.regime || candlesByTf?.H1?.regime || null;
        const regC = Number(reg?.confidence);

        const volPenalty = volStateGate?.status === 'FAIL' ? 20 : 0;
        const newsPenalty = newsGate?.status === 'FAIL' ? 25 : 0;
        const panicPenalty = volSpike?.isSpike === true && flowStatus?.status === 'FAIL' ? 15 : 0;

        const base =
          (candleC != null ? candleC * 0.5 : 30) +
          (Number.isFinite(regC) ? regC * 0.35 : 25) +
          Math.max(0, Math.min(25, Number(confidenceScore) * 100 * 0.25));

        const score = Math.max(
          0,
          Math.min(100, Math.round(base - volPenalty - newsPenalty - panicPenalty))
        );

        return score >= 60
          ? { status: 'PASS', reason: null, score }
          : { status: 'FAIL', reason: `Market psychology=${score} (<60)`, score };
      })();

      addLayer(
        'smart_market_psychology',
        'Market psychology (≥ 60)',
        0.9,
        psychologyGate.status,
        psychologyGate.reason,
        { score: psychologyGate.score ?? null, min: 60 }
      );

      // No strong cross-layer conflicts: key confirmations must not be FAIL.
      const conflictGate = (() => {
        const key = [
          d1RsiGate,
          d1MacdGate,
          locationGateFinal,
          candleGate,
          structureGate,
          sweepStatus,
          entryZoneGate,
          volumeConfirm,
          decisiveCandleGate
        ];
        const anyFail = key.some((k) => k && k.status === 'FAIL');
        return anyFail
          ? { status: 'FAIL', reason: 'Cross-layer conflict exists' }
          : { status: 'PASS', reason: null };
      })();

      addLayer(
        'smart_no_cross_layer_conflicts',
        'No cross-layer conflicts (L2/L7/L13/L15 aligned)',
        1.05,
        conflictGate.status,
        conflictGate.reason
      );

      // Final validation score (>=90) and context awareness (>=70).
      const validationGate = (() => {
        const importantIds = [
          'smart_d1_rsi_lock',
          'smart_d1_macd_lock',
          'smart_price_location',
          'smart_digital_candle',
          'smart_structure_clean',
          'smc_liquidity_sweep',
          'smart_smc_entry_zone',
          'smart_volume_confirm',
          'smart_decisive_candle',
          'smart_time_intelligence',
          'smart_volatility_state',
          'smart_atr_rr_2to1',
          'smart_news_guard',
          'smart_market_psychology',
          'smart_no_cross_layer_conflicts'
        ];
        const map = new Map(layers.map((l) => [l.id, l]));
        const statuses = importantIds
          .map((id) => map.get(id))
          .filter(Boolean)
          .map((l) => l.status);

        const pass = statuses.filter((s) => s === 'PASS').length;
        const fail = statuses.filter((s) => s === 'FAIL').length;
        const denom = statuses.length || 1;
        const score = Math.max(0, Math.min(100, Math.round(((pass - fail * 0.75) / denom) * 100)));

        return score >= 90
          ? { status: 'PASS', reason: null, score }
          : { status: 'FAIL', reason: `Signal validation=${score} (<90)`, score };
      })();

      addLayer(
        'smart_signal_validation',
        'Signal validation (≥ 90)',
        1.1,
        validationGate.status,
        validationGate.reason,
        { score: validationGate.score ?? null, min: 90 }
      );

      const contextGate = (() => {
        const score = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (timeIntel?.score != null ? timeIntel.score * 0.35 : 20) +
                (locationGateFinal?.status === 'PASS' ? 25 : 0) +
                (volStateGate?.status === 'PASS' ? 20 : 0) +
                (newsGate?.status === 'PASS' ? 10 : 0) +
                (psychologyGate?.score != null ? psychologyGate.score * 0.1 : 5)
            )
          )
        );
        return score >= 70
          ? { status: 'PASS', reason: null, score }
          : { status: 'FAIL', reason: `Context awareness=${score} (<70)`, score };
      })();

      addLayer(
        'smart_context_awareness',
        'Context awareness (≥ 70)',
        1.0,
        contextGate.status,
        contextGate.reason,
        { score: contextGate.score ?? null, min: 70 }
      );

      // Killer question.
      const killerGate = (() => {
        const yesSignals = [
          d1RsiGate,
          d1MacdGate,
          structureGate,
          sweepStatus,
          volumeConfirm,
          decisiveCandleGate,
          volStateGate,
          timeIntel,
          validationGate,
          contextGate
        ];
        const pass = yesSignals.filter((s) => s && s.status === 'PASS').length;
        const denom = yesSignals.length || 1;
        const score = Math.round((pass / denom) * 100);

        return score >= 90
          ? { status: 'PASS', reason: 'Yes: market likely continues without you', score }
          : { status: 'FAIL', reason: 'No: this looks like hope, not a trade', score };
      })();

      addLayer(
        'smart_killer_question',
        'Killer question (continue without you?)',
        1.15,
        killerGate.status,
        killerGate.reason,
        { score: killerGate.score ?? null, passScore: 90 }
      );

      // Compute weighted pass ratio (ignore SKIP).
      // In non-strict mode, treat many "smart checklist" FAILs as advisory so the score
      // reflects hard viability (direction/freshness/spread/news/risk) instead of requiring
      // near-perfect 18-layer alignment to ever reach ENTER.
      const advisorySmartFails = (() => {
        const env = String(process.env.SIGNAL_CONFLUENCE_ADVISORY_SMART_FAILS || '')
          .trim()
          .toLowerCase();
        if (env) {
          return env === '1' || env === 'true' || env === 'yes' || env === 'on';
        }
        return !strictSmartChecklist;
      })();

      const scoreEligible = layers.filter((layer) => {
        if (!layer || (layer.status !== 'PASS' && layer.status !== 'FAIL')) {
          return false;
        }
        if (!advisorySmartFails) {
          return true;
        }

        // Keep FAILs for core viability layers; ignore FAILs for advisory layers.
        if (layer.status === 'FAIL') {
          const id = String(layer.id || '');
          const advisoryPrefixes = ['smart_', 'smc_', 'htf_'];
          if (advisoryPrefixes.some((p) => id.startsWith(p))) {
            return false;
          }
        }

        return true;
      });

      const totalW =
        scoreEligible.reduce((acc, layer) => acc + (Number(layer.weight) || 0), 0) || 0;
      const passW = scoreEligible
        .filter((layer) => layer.status === 'PASS')
        .reduce((acc, layer) => acc + (Number(layer.weight) || 0), 0);
      const score01 = totalW > 0 ? passW / totalW : 0;

      const minScoreEnv = Number(process.env.SIGNAL_CONFLUENCE_MIN_SCORE);
      const minScore = Number.isFinite(minScoreEnv) ? Math.max(0, Math.min(100, minScoreEnv)) : 62;
      const score = Number((score01 * 100).toFixed(1));
      const passed = score >= minScore;

      const hardFailIds = new Set(['min_confidence', 'min_strength']);
      if (strictSmartChecklist) {
        // The checklist is meant to be strict: if these fail, downgrade ENTER -> WAIT.
        for (const id of [
          'htf_d1',
          'smart_d1_rsi_lock',
          'smart_d1_macd_lock',
          'smart_htf_rsi_buy_overbought',
          'smart_market_phase_authority',
          'smart_htf_narrative',
          'smart_phase_timing',
          'smart_session_authority',
          'smart_monthly_price_location',
          'smart_price_location',
          'smart_next_liquidity_pool',
          'smart_entry_trigger',
          'smart_htf_memory_layer',
          'smart_divergence_guard',
          'smart_breakout_confirmation',
          'smart_digital_candle',
          'smart_time_intelligence',
          'smart_failure_cost_check',
          'smart_atr_rr_2to1',
          'smart_decisive_candle',
          'smart_structure_clean',
          'smart_volatility_state',
          'smart_news_guard',
          'smart_event_risk_governor',
          'smart_post_news_regime',
          'smart_data_completeness',
          'smart_intermarket_correlation_guard',
          'smart_liquidity_execution_risk',
          'smart_execution_slippage_risk',
          'smart_distribution_filter',
          'smart_false_continuation_detector',
          'smart_execution_edge_filter',
          'smart_market_psychology',
          'smart_no_cross_layer_conflicts',
          'smart_signal_validation',
          'smart_context_awareness',
          'smart_killer_question',
          'smart_volume_confirm',
          'smc_liquidity_sweep',
          'smart_sweep_acceptance',
          'smart_liquidity_event_required',
          'smart_signal_ttl',
          'smart_confirmed_discount_zone',
          'smart_smc_entry_zone'
        ]) {
          hardFailIds.add(id);
        }
      }

      const hardFails = layers
        .filter((l) => l.status === 'FAIL' && hardFailIds.has(l.id))
        .map((l) => l.id);

      return {
        evaluatedAt,
        score,
        minScore,
        passed,
        strictSmartChecklist,
        hardFails,
        layers
      };
    })();

    if (signal && typeof signal === 'object') {
      signal.components =
        signal.components && typeof signal.components === 'object' ? signal.components : {};
      signal.components.confluence = confluence;

      // Confidence cap under extremes (mandatory): do not output "strong BUY" when execution/HTF context is extreme.
      // This is a downgrade-only adjustment.
      try {
        const dir = String(signal?.direction || '').toUpperCase();
        const strict = Boolean(confluence?.strictSmartChecklist);
        if (strict && dir === 'BUY') {
          const byId = new Map(
            Array.isArray(confluence?.layers)
              ? confluence.layers.map((l) => [l?.id, l]).filter(([id]) => Boolean(id))
              : []
          );
          const rsiGate = byId.get('smart_htf_rsi_buy_overbought');
          const execGate = byId.get('smart_liquidity_execution_risk');
          const distGate = byId.get('smart_distribution_filter');
          const breakout = byId.get('smart_breakout_confirmation');
          const needsBreakout = Boolean(breakout?.metrics?.needs);

          const extreme =
            rsiGate?.status === 'FAIL' ||
            execGate?.status === 'FAIL' ||
            distGate?.status === 'FAIL' ||
            needsBreakout === true;

          if (extreme) {
            const cur = Number.isFinite(Number(signal.confidence))
              ? Number(signal.confidence)
              : null;
            if (cur != null && cur > 60) {
              signal.confidence = 60;
            }
          }
        }
      } catch (_e) {
        // no-op
      }

      // Market memory (key-level reactions): derived from EA-provided D1 ranges when available.
      const loc =
        confluence && Array.isArray(confluence.layers)
          ? confluence.layers.find((l) => l && l.id === 'smart_price_location')
          : null;
      const locMetrics = loc?.metrics && typeof loc.metrics === 'object' ? loc.metrics : null;
      if (locMetrics) {
        this.recordMarketMemory(pair, {
          at: now,
          price: locMetrics.price,
          day: locMetrics.day,
          week: locMetrics.week,
          month: locMetrics.month
        });
      }
      signal.components.marketMemory = this.getMarketMemory(pair, { limit: 6 });
    }

    // Kill-switch logic: in strict smart-checklist mode, some FAIL layers become absolute NO-TRADE.
    const killSwitch = (() => {
      const enabled = Boolean(confluenceEnabled && confluence?.strictSmartChecklist);
      if (!enabled) {
        return { enabled: false, blocked: false, items: [], ids: [] };
      }

      const killIds = new Set([
        // Safety-critical governors (hard NO-TRADE)
        'smart_news_guard',
        'smart_event_risk_governor',
        'smart_post_news_regime',

        // Data completeness / integrity
        'smart_data_completeness',
        'smart_quote_integrity',
        'smart_liquidity_execution_risk',
        'smart_execution_slippage_risk',

        // Timing (hard windows / staleness)
        'trading_window_hard',
        'session_window',
        'smart_signal_ttl',

        // Risk sanity
        'smart_failure_cost_check'
      ]);

      const layerList = Array.isArray(confluence?.layers) ? confluence.layers : [];
      const failed = layerList
        .filter((l) => l && l.status === 'FAIL' && killIds.has(String(l.id || '')))
        .map((l) => ({
          id: String(l.id || ''),
          label: l.label || null,
          reason: l.reason || null,
          weight: Number.isFinite(Number(l.weight)) ? Number(l.weight) : null
        }))
        .filter((l) => l.id);

      const ids = failed.map((f) => f.id);
      return {
        enabled: true,
        blocked: failed.length > 0,
        items: failed,
        ids
      };
    })();

    // Apply kill-switch as a hard block.
    if (killSwitch.enabled && killSwitch.blocked) {
      blocked = true;
      hardChecks.smartKillSwitchOk = false;
    } else {
      hardChecks.smartKillSwitchOk = true;
    }

    let state = 'WAIT_MONITOR';
    let category = 'no_signal';
    if (blocked) {
      state = 'NO_TRADE_BLOCKED';
      category = killSwitch.enabled && killSwitch.blocked ? 'killswitch' : 'blocked';
    } else if (signal?.direction !== 'NEUTRAL' && score >= profile.enterScore) {
      state = 'ENTER';
      category = 'enter';
    }

    // Confluence can downgrade ENTER into WAIT_MONITOR (never force an ENTER).
    if (confluenceEnabled && !blocked && state === 'ENTER') {
      const hardFailed = Array.isArray(confluence?.hardFails) && confluence.hardFails.length > 0;
      const below =
        Number.isFinite(Number(confluence?.score)) && Number.isFinite(Number(confluence?.minScore))
          ? Number(confluence.score) < Number(confluence.minScore)
          : true;

      if (hardFailed || below) {
        state = 'WAIT_MONITOR';
        category = 'confluence';
      }
    }

    const cfgMinStrength = Number.isFinite(Number(this.config.minSignalStrength))
      ? Number(this.config.minSignalStrength)
      : 70;
    const cfgMinWinRate = Number.isFinite(Number(this.config.minEstimatedWinRate))
      ? Number(this.config.minEstimatedWinRate)
      : 70;

    const missing = [];
    const whatWouldChange = [];
    if (!blocked && state !== 'ENTER') {
      if (signal?.direction === 'NEUTRAL') {
        missing.push('direction_confirmation');
        whatWouldChange.push('A clear directional bias (technical/structure alignment).');
      }
      if (strengthScore < 0.65) {
        missing.push('strength');
        whatWouldChange.push(`Strength rising above ${Math.min(95, cfgMinStrength)}.`);
      }
      if (probabilityScore < 0.6) {
        missing.push('probability');
        whatWouldChange.push(`Estimated win-rate above ${Math.min(95, cfgMinWinRate)}%.`);
      }
      if (spreadEfficiencyScore < 0.65) {
        missing.push('execution_cost');
        whatWouldChange.push('Tighter spread or larger expected move (ATR/TP).');
      }
      if (momentum != null && momentum < profile.minMomentumForEnter) {
        missing.push('confidence_momentum');
        whatWouldChange.push('Confidence/score improving over the next few updates.');
      }

      if (confluenceEnabled) {
        const minScore = Number.isFinite(Number(confluence?.minScore))
          ? Number(confluence.minScore)
          : null;
        const scoreNow = Number.isFinite(Number(confluence?.score))
          ? Number(confluence.score)
          : null;
        if (minScore != null && scoreNow != null && scoreNow < minScore) {
          missing.push('confluence');
          whatWouldChange.push(`Confluence score above ${minScore}/100 (layer alignment).`);
        }

        // Surface strict smart-checklist failures explicitly.
        if (confluence?.strictSmartChecklist && Array.isArray(confluence?.layers)) {
          const failed = confluence.layers
            .filter((l) => l && l.status === 'FAIL')
            .map((l) => ({ id: String(l.id || ''), label: l.label, reason: l.reason }))
            .filter((l) => l.id);

          const importantIds = new Set([
            'htf_d1',
            'smart_d1_rsi_lock',
            'smart_d1_macd_lock',
            'smart_market_phase_authority',
            'smart_phase_timing',
            'smart_monthly_price_location',
            'smart_price_location',
            'smart_breakout_confirmation',
            'smart_digital_candle',
            'smart_time_intelligence',
            'smart_atr_rr_2to1',
            'smart_decisive_candle',
            'smart_structure_clean',
            'smart_volatility_state',
            'smart_news_guard',
            'smart_event_risk_governor',
            'smart_data_completeness',
            'smart_intermarket_correlation_guard',
            'smart_liquidity_execution_risk',
            'smart_execution_edge_filter',
            'smart_market_psychology',
            'smart_no_cross_layer_conflicts',
            'smart_signal_validation',
            'smart_context_awareness',
            'smart_killer_question',
            'smart_volume_confirm',
            'smc_liquidity_sweep',
            'smart_smc_entry_zone'
          ]);

          const keyFails = failed.filter((f) => importantIds.has(f.id)).slice(0, 6);
          if (keyFails.length) {
            missing.push(...keyFails.map((f) => `smart:${f.id}`));
            whatWouldChange.push(
              ...keyFails.map((f) =>
                f.reason ? `${f.label}: ${f.reason}` : `${f.label}: needs confirmation`
              )
            );
          }
        }
      }
    }

    const blockers = Object.entries(hardChecks)
      .filter(([, ok]) => ok !== true)
      .map(([k]) => k);

    const reason = (() => {
      if (state === 'ENTER') {
        return `ENTER: score=${score}/100 (${assetClass})`;
      }
      if (state === 'WAIT_MONITOR') {
        return `WAIT: score=${score}/100 (${assetClass}) · missing=${missing.join(',') || '—'}`;
      }
      if (killSwitch.enabled && killSwitch.blocked) {
        const ids = Array.isArray(killSwitch.ids) ? killSwitch.ids.slice(0, 6).join(',') : '';
        return `NO-TRADE (kill-switch): ${ids || blockers.join(',') || 'constraints'}`;
      }
      return `NO-TRADE (blocked): ${blockers.join(',') || 'constraints'}`;
    })();

    const decision = {
      state,
      blocked,
      category,
      assetClass,
      score,
      killSwitch: killSwitch && typeof killSwitch === 'object' ? killSwitch : null,
      confluence: confluenceEnabled
        ? {
            score: Number.isFinite(Number(confluence?.score)) ? Number(confluence.score) : null,
            minScore: Number.isFinite(Number(confluence?.minScore))
              ? Number(confluence.minScore)
              : null,
            passed: Boolean(confluence?.passed)
          }
        : null,
      profile: {
        enterScore: profile.enterScore,
        minStrength: profile.minStrength,
        minWinRate: profile.minWinRate,
        minConfidence: profile.minConfidence
      },
      contributors: {
        directionScore: Number(directionScore.toFixed(3)),
        strengthScore: Number(strengthScore.toFixed(3)),
        probabilityScore: Number(probabilityScore.toFixed(3)),
        confidenceScore: Number(confidenceScore.toFixed(3)),
        rrScore: Number(rrScore.toFixed(3)),
        spreadEfficiencyScore: Number(spreadEfficiencyScore.toFixed(3))
      },
      context: {
        spreadPips,
        atrPips,
        spreadToAtr,
        spreadToTp,
        stopLossPips,
        takeProfitPips,
        riskReward
      },
      modifiers: {
        newsModifier: Number(newsModifier.toFixed(3)),
        sessionModifier: Number(sessionModifier.toFixed(3)),
        dataQualityPenalty: Number(dataQualityPenalty.toFixed(3)),
        momentum: momentum == null ? null : Number(momentum.toFixed(4))
      },
      blockers,
      missing,
      whatWouldChange
    };

    this.recordDecisionMemory(pair, { at: now, score01, state });

    if (state !== 'ENTER') {
      this.recordSignalRejection({
        signal,
        decision,
        blockers,
        missing,
        now
      });
    }

    return {
      isValid: state === 'ENTER',
      checks: {
        ...hardChecks,
        confluence: confluenceEnabled ? Boolean(confluence?.passed) : true
      },
      reason,
      decision
    };
  }

  recordSignalRejection({ signal, decision, blockers = [], missing = [], now = Date.now() } = {}) {
    try {
      if (!this.rejectionStats || typeof this.rejectionStats !== 'object') {
        this.rejectionStats = {
          total: 0,
          byPrimary: new Map(),
          bySecondary: new Map(),
          recent: [],
          maxRecent: 200
        };
      }

      const state = decision?.state || 'UNKNOWN';
      const category = decision?.category || null;
      const killSwitchIds = Array.isArray(decision?.killSwitch?.ids) ? decision.killSwitch.ids : [];

      const primary =
        killSwitchIds[0] ||
        blockers?.[0] ||
        missing?.[0] ||
        (state === 'WAIT_MONITOR' ? 'waiting_for_alignment' : 'blocked');
      const secondary = killSwitchIds[1] || blockers?.[1] || missing?.[1] || null;

      const entry = {
        at: new Date(now).toISOString(),
        pair: signal?.pair || null,
        timeframe: signal?.timeframe || signal?.components?.marketData?.timeframe || null,
        state,
        category,
        primary,
        secondary,
        score: decision?.score ?? null,
        reason: decision?.state === 'WAIT_MONITOR' ? 'missing_requirements' : 'blocked'
      };

      this.rejectionStats.total += 1;
      this.incrementRejectionCounter(this.rejectionStats.byPrimary, primary);
      if (secondary) {
        this.incrementRejectionCounter(this.rejectionStats.bySecondary, secondary);
      }

      this.rejectionStats.recent.unshift(entry);
      if (this.rejectionStats.recent.length > this.rejectionStats.maxRecent) {
        this.rejectionStats.recent.length = this.rejectionStats.maxRecent;
      }

      this.config?.auditLogger?.record?.('trade.candidate.rejected', entry);
    } catch (_error) {
      // best-effort logging only
    }
  }

  incrementRejectionCounter(map, key) {
    if (!map || !key) {
      return;
    }
    const current = map.get(key) || 0;
    map.set(key, current + 1);
  }

  getRejectionSummary() {
    const stats = this.rejectionStats;
    if (!stats || typeof stats !== 'object') {
      return { total: 0, topPrimary: [], topSecondary: [], recent: [] };
    }

    const mapToSorted = (map) =>
      Array.from(map.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    return {
      total: stats.total || 0,
      topPrimary: mapToSorted(stats.byPrimary || new Map()),
      topSecondary: mapToSorted(stats.bySecondary || new Map()),
      recent: Array.isArray(stats.recent) ? stats.recent.slice(0, 50) : []
    };
  }

  classifyAssetClass(pair) {
    const normalized = String(pair || '')
      .trim()
      .toUpperCase();
    if (!normalized) {
      return 'forex';
    }
    if (normalized.startsWith('#')) {
      return 'cfd';
    }
    if (
      normalized.startsWith('XAU') ||
      normalized.startsWith('XAG') ||
      normalized.startsWith('XPT') ||
      normalized.startsWith('XPD')
    ) {
      return 'metals';
    }
    if (
      normalized.startsWith('BTC') ||
      normalized.startsWith('ETH') ||
      normalized.startsWith('SOL') ||
      normalized.startsWith('XRP')
    ) {
      return 'crypto';
    }
    return 'forex';
  }

  getDecisionProfile(assetClass) {
    const profileModeRaw = String(process.env.AUTO_TRADING_PROFILE || '')
      .trim()
      .toLowerCase();
    const eaOnlyMode =
      String(process.env.EA_ONLY_MODE || '')
        .trim()
        .toLowerCase() === 'true';
    const autostart =
      String(process.env.AUTO_TRADING_AUTOSTART || '')
        .trim()
        .toLowerCase() === 'true';
    // Defaults:
    // - EA-only mode: prefer "smart strong" so the dashboard can surface ENTER signals
    //   without having to manually tune AUTO_TRADING_PROFILE.
    // - Auto-trading autostart: also default to "smart strong".
    // - Otherwise: balanced.
    const profileMode = profileModeRaw || (eaOnlyMode || autostart ? 'smart_strong' : 'balanced');

    const aggressiveEnterScoreEnv = Number(process.env.AUTO_TRADING_AGGRESSIVE_ENTER_SCORE);
    const aggressiveEnterScore = Number.isFinite(aggressiveEnterScoreEnv)
      ? Math.max(0, Math.min(100, aggressiveEnterScoreEnv))
      : 25;

    const smartStrongEnterScoreEnv = Number(process.env.AUTO_TRADING_SMART_STRONG_ENTER_SCORE);
    const smartStrongEnterScore = Number.isFinite(smartStrongEnterScoreEnv)
      ? Math.max(0, Math.min(100, smartStrongEnterScoreEnv))
      : eaOnlyMode
        ? 30
        : 45;

    const applyAggressiveTuning = (profile) => {
      if (profileMode !== 'aggressive') {
        return profile;
      }
      // More trades, sooner.
      // Still respects hard blocks (news/spread/risk/market freshness).
      return {
        ...profile,
        enterScore: Math.min(profile.enterScore, aggressiveEnterScore),
        minStrength: Math.min(profile.minStrength, 20),
        minWinRate: Math.min(profile.minWinRate, 50),
        minConfidence: Math.min(profile.minConfidence, 20),
        minMomentumForEnter: 0
      };
    };

    const normalizeSmartStrongMode = (value) =>
      value === 'smart_strong' || value === 'smart-strong' || value === 'smartstrong';

    const applySmartStrongTuning = (profile) => {
      if (!normalizeSmartStrongMode(profileMode)) {
        return profile;
      }

      // "Smart strong": noticeably more decisive than balanced, but stays selective.
      // Relies on hard blocks (spread/news/risk/data quality) to stay safe.
      return {
        ...profile,
        enterScore: Math.min(
          profile.enterScore,
          eaOnlyMode ? Math.min(smartStrongEnterScore, 40) : smartStrongEnterScore
        ),
        minStrength: Math.min(profile.minStrength, eaOnlyMode ? 35 : 45),
        minWinRate: Math.min(profile.minWinRate, eaOnlyMode ? 50 : 52),
        minConfidence: Math.min(profile.minConfidence, eaOnlyMode ? 35 : 45),
        minMomentumForEnter: Math.min(profile.minMomentumForEnter, eaOnlyMode ? 0.015 : 0.02)
      };
    };

    const base = {
      enterScore: 72,
      // Soft floors for contributor curves (NOT hard gates).
      minStrength: 55,
      minWinRate: 55,
      minConfidence: 55,
      minRiskReward: Number.isFinite(this.config.minRiskReward) ? this.config.minRiskReward : 1.6,
      targetRiskReward: 2.4,
      maxSpreadToAtrWarn: 0.22,
      maxSpreadToTpWarn: 0.12,
      minMomentumForEnter: 0.04,
      weights: {
        direction: 0.12,
        strength: 0.24,
        probability: 0.22,
        confidence: 0.16,
        riskReward: 0.12,
        spreadEfficiency: 0.14
      }
    };

    if (assetClass === 'metals') {
      return applyAggressiveTuning(
        applySmartStrongTuning({
          ...base,
          enterScore: 75,
          minStrength: 58,
          minWinRate: 57,
          minConfidence: 56,
          targetRiskReward: 2.6,
          maxSpreadToAtrWarn: 0.26,
          weights: { ...base.weights, spreadEfficiency: 0.16, probability: 0.24 }
        })
      );
    }

    if (assetClass === 'crypto') {
      return applyAggressiveTuning(
        applySmartStrongTuning({
          ...base,
          enterScore: 78,
          minStrength: 60,
          minWinRate: 58,
          minConfidence: 56,
          targetRiskReward: 2.9,
          maxSpreadToAtrWarn: 0.3,
          maxSpreadToTpWarn: 0.14,
          weights: { ...base.weights, strength: 0.26, probability: 0.24 }
        })
      );
    }

    return applyAggressiveTuning(applySmartStrongTuning(base));
  }

  getSessionModifier(assetClass) {
    // Very lightweight session intelligence.
    const utcHour = new Date().getUTCHours();
    const isAsia = utcHour >= 0 && utcHour < 7;
    const isLondon = utcHour >= 7 && utcHour < 13;
    const isNy = utcHour >= 13 && utcHour < 21;
    const isOff = !isAsia && !isLondon && !isNy;

    if (assetClass === 'crypto') {
      return isOff ? 0.96 : 1.0;
    }
    if (assetClass === 'metals') {
      if (isAsia) {
        return 0.9;
      }
      if (isLondon || isNy) {
        return 1.0;
      }
      return 0.92;
    }
    // forex
    if (isLondon || isNy) {
      return 1.0;
    }
    if (isAsia) {
      return 0.95;
    }
    return 0.9;
  }

  computeSessionContext(assetClass, now = Date.now()) {
    const utcHour = new Date(now).getUTCHours();
    const isAsia = utcHour >= 0 && utcHour < 7;
    const isLondon = utcHour >= 7 && utcHour < 13;
    const isNy = utcHour >= 13 && utcHour < 21;
    const session = isLondon ? 'London' : isNy ? 'New York' : isAsia ? 'Asia' : 'Off';

    const isOpening = (isLondon && utcHour < 10) || (isNy && utcHour < 16);

    // FX/metals care most about London/NY. Crypto is always on.
    const preferred = assetClass === 'crypto' ? true : Boolean(isLondon || isNy);

    return {
      utcHour,
      session,
      isAsia,
      isLondon,
      isNy,
      isOpening,
      preferred
    };
  }

  recordQuoteTelemetry(pair, quote = {}, now = Date.now()) {
    const p = String(pair || '').trim();
    if (!p) {
      return { available: false, current: null, recent: [] };
    }

    if (!this.analyticsCache || typeof this.analyticsCache !== 'object') {
      this.analyticsCache = { quoteTelemetryByPair: new Map(), telemetryByPair: new Map() };
    }
    if (!(this.analyticsCache.quoteTelemetryByPair instanceof Map)) {
      this.analyticsCache.quoteTelemetryByPair = new Map();
    }

    const bid = Number.isFinite(Number(quote?.bid)) ? Number(quote.bid) : null;
    const ask = Number.isFinite(Number(quote?.ask)) ? Number(quote.ask) : null;
    const mid =
      Number.isFinite(bid) && Number.isFinite(ask)
        ? Number(((bid + ask) / 2).toFixed(8))
        : Number.isFinite(Number(quote?.mid))
          ? Number(quote.mid)
          : null;

    const atRaw = quote?.timestamp ?? quote?.receivedAt ?? null;
    const at = Number.isFinite(Number(atRaw))
      ? Number(atRaw) > 10_000_000_000
        ? Number(atRaw)
        : Number(atRaw) * 1000
      : Number(now);

    const spreadPoints = Number.isFinite(Number(quote?.spreadPoints))
      ? Number(quote.spreadPoints)
      : null;
    const spreadPips = Number.isFinite(Number(quote?.spreadPips)) ? Number(quote.spreadPips) : null;
    const liquidityHint = quote?.liquidityHint ?? null;
    const volume = Number.isFinite(Number(quote?.volume)) ? Number(quote.volume) : null;

    const history = this.analyticsCache.quoteTelemetryByPair.get(p) || [];
    const prev = history.length ? history[history.length - 1] : null;

    const dtMs = prev?.at != null ? Math.max(1, at - Number(prev.at)) : null;
    const midDelta =
      prev?.mid != null && mid != null ? Number((mid - Number(prev.mid)).toFixed(8)) : null;
    const midVelocityPerSec =
      dtMs != null && midDelta != null ? Number((midDelta / (dtMs / 1000)).toFixed(10)) : null;

    const current = {
      at,
      bid,
      ask,
      mid,
      spreadPips,
      spreadPoints,
      liquidityHint,
      volume,
      midDelta,
      midVelocityPerSec,
      // Backwards-compatible alias (older UI prototypes).
      velocityPerSec: midVelocityPerSec
    };

    history.push(current);

    // Retention: prune by time first (handles low/high quote rates), then cap by count.
    const retentionMinEnv = Number(process.env.QUOTE_TELEMETRY_RETENTION_MINUTES);
    const retentionMinutes = Number.isFinite(retentionMinEnv) ? Math.max(5, retentionMinEnv) : 30;
    const cutoff = at - retentionMinutes * 60 * 1000;
    if (Number.isFinite(cutoff) && history.length > 8) {
      const firstKept = history.findIndex((q) => q && q.at != null && Number(q.at) >= cutoff);
      if (firstKept > 0) {
        history.splice(0, firstKept);
      }
    }

    const maxEnv = Number(process.env.QUOTE_TELEMETRY_MAX_POINTS);
    const MAX = Number.isFinite(maxEnv) ? Math.max(60, Math.floor(maxEnv)) : 2400;
    if (history.length > MAX) {
      history.splice(0, history.length - MAX);
    }
    this.analyticsCache.quoteTelemetryByPair.set(p, history);

    const recent = history.slice(-6).reverse();
    return { available: true, current, recent };
  }

  computeNewsTelemetry(signal, pair, assetClass, now = Date.now()) {
    const calendarEvents = Array.isArray(signal?.components?.news?.calendarEvents)
      ? signal.components.news.calendarEvents
      : [];

    const blackoutMinutes = Number.isFinite(this.config?.newsBlackoutMinutes)
      ? Number(this.config.newsBlackoutMinutes)
      : 30;
    const impactThreshold = Number.isFinite(this.config?.newsBlackoutImpactThreshold)
      ? Number(this.config.newsBlackoutImpactThreshold)
      : 10;

    const normalizeCurrency = (value) =>
      String(value || '')
        .trim()
        .toUpperCase();

    const splitFxPair = (symbol) => {
      const s = String(symbol || '')
        .trim()
        .toUpperCase();
      if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
        return { base: s.slice(0, 3), quote: s.slice(3, 6) };
      }
      return null;
    };

    const fx = assetClass === 'forex' ? splitFxPair(pair) : null;
    const macroCurrencies = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);

    const parseEventTimeMs = (evt) => {
      const raw = evt?.time ?? evt?.datetime ?? evt?.dateTime ?? evt?.timestamp ?? evt?.t ?? null;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 2_000_000_000 ? raw * 1000 : raw;
      }
      if (raw instanceof Date) {
        return raw.getTime();
      }
      if (!raw) {
        return NaN;
      }
      const parsed = Date.parse(String(raw));
      return Number.isFinite(parsed) ? parsed : NaN;
    };

    const isRelevant = (evt) => {
      const cur = normalizeCurrency(evt?.currency);
      if (!cur) {
        return true;
      }
      if (!fx) {
        if (assetClass === 'crypto') {
          return cur === 'USD' || cur === 'EUR';
        }
        return macroCurrencies.has(cur);
      }
      return cur === fx.base || cur === fx.quote;
    };

    const relevant = calendarEvents
      .map((evt) => {
        if (!evt || typeof evt !== 'object') {
          return null;
        }
        const t = parseEventTimeMs(evt);
        const impact = Number(evt?.impact);
        if (!Number.isFinite(t) || !Number.isFinite(impact)) {
          return null;
        }
        if (!isRelevant(evt)) {
          return null;
        }
        return {
          timeMs: t,
          minutes: Number(((t - now) / 60000).toFixed(2)),
          impact,
          currency: normalizeCurrency(evt?.currency) || null,
          title: evt?.title || evt?.name || evt?.event || null
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.timeMs) - Number(b.timeMs));

    const upcomingHigh =
      relevant.find((e) => e.minutes >= 0 && e.impact >= impactThreshold) || null;
    const withinBlackout =
      upcomingHigh != null ? Math.abs(upcomingHigh.minutes) <= blackoutMinutes : false;

    const upcomingIn72h = relevant.filter((e) => e.minutes >= 0 && e.minutes <= 72 * 60);
    const highIn72h = upcomingIn72h.filter((e) => e.impact >= impactThreshold);

    return {
      impactThreshold,
      blackoutMinutes,
      withinBlackout,
      nextHighImpactMinutes: upcomingHigh ? upcomingHigh.minutes : null,
      nextHighImpact: upcomingHigh,
      upcomingCount72h: upcomingIn72h.length,
      highImpactCount72h: highIn72h.length
    };
  }

  computeConfidenceMomentum(pair, score01) {
    if (!pair) {
      return null;
    }
    if (!this.decisionMemory) {
      this.decisionMemory = new Map();
    }
    const history = this.decisionMemory.get(pair) || [];
    if (history.length === 0) {
      return null;
    }
    const last = history[history.length - 1];
    const dtMs = Number.isFinite(Number(last?.at)) ? Math.max(1, Date.now() - Number(last.at)) : 1;
    const dScore = score01 - Number(last?.score01 || 0);
    // Normalize per minute.
    return Number((dScore / (dtMs / 60000)).toFixed(4));
  }

  recordDecisionMemory(pair, item) {
    if (!pair) {
      return;
    }
    if (!this.decisionMemory) {
      this.decisionMemory = new Map();
    }
    const history = this.decisionMemory.get(pair) || [];
    history.push(item);
    const max = 8;
    while (history.length > max) {
      history.shift();
    }
    this.decisionMemory.set(pair, history);
  }

  /**
   * Get failure reason
   */
  getFailureReason(validations) {
    const failures = Object.entries(validations)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    return `Failed validations: ${failures.join(', ')}`;
  }

  buildExplainability({
    pair,
    economic = {},
    news = {},
    technical = {},
    direction,
    confidence,
    strength,
    finalScore,
    dataQuality = null,
    dataQualityContext = null,
    directionPreQuality = null
  }) {
    const categories = {
      economic: [],
      news: [],
      technical: [],
      marketData: []
    };

    const clampWeight = (value) => {
      if (!Number.isFinite(value)) {
        return 0.5;
      }
      return Number(Math.max(0, Math.min(1.5, value)).toFixed(3));
    };

    const pushReason = (category, code, description, weight = 0.6, data = {}) => {
      if (!categories[category]) {
        return;
      }
      categories[category].push({
        code,
        description,
        weight: clampWeight(weight),
        data
      });
    };

    // Economic component
    if (Number.isFinite(economic.relativeSentiment)) {
      const bias = economic.relativeSentiment > 0 ? 'base currency' : 'quote currency';
      pushReason(
        'economic',
        'ECON_RELATIVE_SENTIMENT',
        `Relative sentiment favors the ${bias} by ${economic.relativeSentiment.toFixed(1)} pts`,
        Math.min(1.2, Math.abs(economic.relativeSentiment) / 40),
        {
          relativeSentiment: economic.relativeSentiment,
          direction: economic.direction
        }
      );
    }

    if (Number.isFinite(economic.confidence)) {
      pushReason(
        'economic',
        'ECON_CONFIDENCE',
        `Economic confidence at ${economic.confidence.toFixed(1)}%`,
        economic.confidence / 100,
        { confidence: economic.confidence }
      );
    }

    const baseStrength = economic.base?.strength;
    const quoteStrength = economic.quote?.strength;
    if (Number.isFinite(baseStrength) && Number.isFinite(quoteStrength)) {
      const diff = baseStrength - quoteStrength;
      if (Math.abs(diff) >= 5) {
        pushReason(
          'economic',
          'ECON_STRENGTH_DIFFERENTIAL',
          `Base currency strength exceeds quote by ${diff.toFixed(1)} pts`,
          Math.min(1.1, Math.abs(diff) / 35),
          { baseStrength, quoteStrength }
        );
      }
    }

    // News component
    if (Number.isFinite(news.sentiment)) {
      const sentimentBias =
        news.sentiment > 0 ? 'positive' : news.sentiment < 0 ? 'negative' : 'neutral';
      pushReason(
        'news',
        'NEWS_SENTIMENT',
        `News sentiment is ${sentimentBias} (${news.sentiment.toFixed(1)})`,
        Math.min(1, Math.abs(news.sentiment) / 35),
        { sentiment: news.sentiment, direction: news.direction }
      );
    }

    if (Number.isFinite(news.impact) && news.impact >= 25) {
      pushReason(
        'news',
        'NEWS_IMPACT',
        `High impact events score ${news.impact.toFixed(1)} with ${news.upcomingEvents || 0} upcoming`,
        Math.min(1.1, news.impact / 70),
        { impact: news.impact, upcomingEvents: news.upcomingEvents }
      );
    }

    const compositeScore = Number(news.sentimentFeeds?.compositeScore);
    if (Number.isFinite(compositeScore)) {
      const compositeConfidence = Number.isFinite(Number(news.sentimentFeeds?.confidence))
        ? Number(news.sentimentFeeds.confidence)
        : 0;

      pushReason(
        'news',
        'NEWS_COMPOSITE_SENTIMENT',
        `Composite sentiment ${compositeScore.toFixed(2)} (confidence ${compositeConfidence}%)`,
        Math.min(1, Math.abs(compositeScore) / 1.5),
        {
          compositeScore,
          confidence: compositeConfidence
        }
      );
    }

    // Technical component
    if (Array.isArray(technical.signals) && technical.signals.length > 0) {
      const primarySignal = technical.signals[0];
      const primaryConfidence = Number(primarySignal?.confidence);
      const confidenceDisplay = Number.isFinite(primaryConfidence)
        ? `${primaryConfidence.toFixed(0)}%`
        : 'n/a';

      pushReason(
        'technical',
        'TECH_PRIMARY_SIGNAL',
        `${primarySignal.type} signal on ${primarySignal.timeframe} with ${confidenceDisplay} confidence`,
        Math.min(1.2, primarySignal.strength ? primarySignal.strength / 100 : 0.8),
        { signal: primarySignal }
      );
    }

    if (technical.directionSummary) {
      const buyVotes = Number(technical.directionSummary.BUY || 0);
      const sellVotes = Number(technical.directionSummary.SELL || 0);
      const totalVotes = buyVotes + sellVotes + Number(technical.directionSummary.NEUTRAL || 0);
      if (totalVotes > 0) {
        const diff = buyVotes - sellVotes;
        pushReason(
          'technical',
          'TECH_TIMEFRAME_ALIGNMENT',
          `Timeframe alignment BUY ${buyVotes} vs SELL ${sellVotes}`,
          Math.min(1, Math.abs(diff) / Math.max(1, totalVotes)),
          { buyVotes, sellVotes, totalVotes }
        );
      }
    }

    if (technical.regimeSummary?.state) {
      pushReason(
        'technical',
        'TECH_REGIME_STATE',
        `Regime indicates ${technical.regimeSummary.state} with ${technical.regimeSummary.confidence}% confidence`,
        Math.min(1.1, (technical.regimeSummary.confidence || 0) / 90),
        {
          state: technical.regimeSummary.state,
          confidence: technical.regimeSummary.confidence,
          slope: technical.regimeSummary.averageSlope
        }
      );
    }

    if (technical.volatilitySummary?.averageScore != null) {
      pushReason(
        'technical',
        'TECH_VOLATILITY',
        `Volatility score ${technical.volatilitySummary.averageScore} (${technical.volatilitySummary.state || 'normal'})`,
        Math.min(1, (technical.volatilitySummary.averageScore || 0) / 120),
        {
          state: technical.volatilitySummary.state,
          averageScore: technical.volatilitySummary.averageScore
        }
      );
    }

    if ((technical.divergenceSummary?.total || 0) > 0) {
      pushReason(
        'technical',
        'TECH_DIVERGENCE',
        `${technical.divergenceSummary.total} active divergence signals`,
        Math.min(0.9, technical.divergenceSummary.total / 5),
        { divergences: technical.divergenceSummary }
      );
    }

    if (technical.volumePressureSummary?.state) {
      pushReason(
        'technical',
        'TECH_VOLUME_PRESSURE',
        `Volume pressure ${technical.volumePressureSummary.state} (${technical.volumePressureSummary.averagePressure}%)`,
        Math.min(0.9, Math.abs(technical.volumePressureSummary.averagePressure || 0) / 80),
        { volumePressure: technical.volumePressureSummary }
      );
    }

    const qualityDetails =
      dataQualityContext || (dataQuality ? this.deriveDataQualityContext(dataQuality) : null);
    const hasQualitySignal = Boolean(
      qualityDetails &&
      (qualityDetails.score != null ||
        qualityDetails.status ||
        qualityDetails.recommendation ||
        (Array.isArray(qualityDetails.issues) && qualityDetails.issues.length > 0) ||
        directionPreQuality)
    );

    if (hasQualitySignal) {
      const scoreDisplay = qualityDetails.score != null ? qualityDetails.score.toFixed(1) : 'n/a';
      const statusDisplay = qualityDetails.status ?? dataQuality?.status ?? 'unknown';
      const modifierWeight = Math.min(1.15, Math.max(0.45, qualityDetails.modifier ?? 1));

      pushReason(
        'marketData',
        'DATA_QUALITY_STATUS',
        `Market data quality ${statusDisplay} (score ${scoreDisplay})`,
        modifierWeight,
        {
          score: qualityDetails.score,
          status: qualityDetails.status ?? dataQuality?.status ?? null,
          recommendation: qualityDetails.recommendation ?? dataQuality?.recommendation ?? null,
          assessedAt: qualityDetails.assessedAt ?? dataQuality?.assessedAt ?? null
        }
      );

      if (qualityDetails.recommendation) {
        pushReason(
          'marketData',
          'DATA_QUALITY_RECOMMENDATION',
          `Recommendation: ${qualityDetails.recommendation}`,
          0.6,
          { recommendation: qualityDetails.recommendation }
        );
      }

      if (Array.isArray(qualityDetails.issues) && qualityDetails.issues.length > 0) {
        const issues = qualityDetails.issues.slice(0, 4).join(', ');
        pushReason(
          'marketData',
          'DATA_QUALITY_ISSUES',
          `Issues detected: ${issues}`,
          Math.min(0.9, 0.4 + qualityDetails.issues.length * 0.1),
          { issues: qualityDetails.issues }
        );
      }

      if (directionPreQuality && directionPreQuality !== direction) {
        pushReason(
          'marketData',
          'DATA_QUALITY_DIRECTION_ADJUSTMENT',
          `Direction adjusted from ${directionPreQuality} to ${direction} after quality guard`,
          0.8,
          { before: directionPreQuality, after: direction }
        );
      }
    }

    const summary = {
      pair,
      direction,
      confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(2)) : null,
      strength: Number.isFinite(strength) ? Number(strength.toFixed(2)) : null,
      finalScore: Number.isFinite(finalScore) ? Number(finalScore.toFixed(2)) : null,
      ensembleProbability: null,
      dataQualityScore:
        qualityDetails?.score ??
        (Number.isFinite(Number(dataQuality?.score)) ? Number(dataQuality.score) : null),
      dataQualityStatus: qualityDetails?.status ?? dataQuality?.status ?? null,
      dataQualityRecommendation:
        qualityDetails?.recommendation ?? dataQuality?.recommendation ?? null,
      directionPreQuality: directionPreQuality || null
    };

    return {
      ...categories,
      summary
    };
  }

  /**
   * Generate human-readable reasoning
   */
  generateReasoning(explainability) {
    if (!explainability) {
      return [];
    }

    const lines = [];
    const summary = explainability.summary || {};
    if (summary.direction) {
      let headline = `Direction ${summary.direction}`;
      if (Number.isFinite(summary.confidence)) {
        headline += ` | Confidence ${summary.confidence.toFixed(1)}%`;
      }
      if (Number.isFinite(summary.finalScore)) {
        headline += ` | Score ${summary.finalScore}`;
      }
      lines.push(headline);
    }

    if (summary.dataQualityStatus) {
      const scoreText = Number.isFinite(summary.dataQualityScore)
        ? summary.dataQualityScore.toFixed(1)
        : 'n/a';
      let dqLine = `Market data quality ${summary.dataQualityStatus}`;
      if (summary.dataQualityRecommendation) {
        dqLine += ` | Recommendation ${summary.dataQualityRecommendation}`;
      }
      dqLine += ` | Score ${scoreText}`;
      if (summary.directionPreQuality && summary.directionPreQuality !== summary.direction) {
        dqLine += ` | Direction adjusted from ${summary.directionPreQuality}`;
      }
      lines.push(dqLine);
    }

    const addCategory = (category, label) => {
      const reasons = explainability[category];
      if (!Array.isArray(reasons) || reasons.length === 0) {
        return;
      }
      reasons.slice(0, 3).forEach((reason) => {
        lines.push(`${label} [${reason.code}]: ${reason.description}`);
      });
    };

    addCategory('economic', 'Economic');
    addCategory('news', 'News');
    addCategory('technical', 'Technical');
    addCategory('marketData', 'Market Data');

    return lines;
  }

  /**
   * Helper methods
   */
  splitPair(pair) {
    if (!pair) {
      return ['', ''];
    }
    const metadata = getPairMetadata(pair);
    if (metadata?.base && metadata?.quote) {
      return [metadata.base, metadata.quote];
    }
    const normalized = String(pair).toUpperCase();
    if (normalized.includes('/')) {
      const parts = normalized.split(/[:/-]/).filter(Boolean);
      if (parts.length >= 2) {
        return [parts[0], parts[1]];
      }
    }
    if (normalized.length >= 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }
    return [normalized, 'USD'];
  }

  normalizeScore(value, min, max) {
    const clamped = Math.max(min, Math.min(max, value));
    const normalized = (clamped - min) / (max - min);
    return normalized * 2 - 1; // map to -1 .. 1
  }

  getCurrentPrice(technical) {
    if (!technical || !technical.timeframes) {
      return technical?.latestPrice ?? null;
    }

    const priority = ['M15', 'H1', 'H4', 'D1'];
    for (const tf of priority) {
      const frame = technical.timeframes[tf];
      if (frame && typeof frame.lastPrice === 'number') {
        return frame.lastPrice;
      }
    }

    return technical.latestPrice ?? null;
  }

  async getCurrentPriceForPair(pair, options = {}) {
    const broker = options?.broker || options?.brokerPreference || options?.brokerId || null;

    if (typeof this.externalMarketContextProvider === 'function') {
      try {
        const external = await this.externalMarketContextProvider({ pair, broker });
        const quote = external?.quote || null;
        if (quote) {
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
        }
      } catch (_error) {
        // Fall through to provider fetcher.
      }
    }

    return await this.priceDataFetcher.getCurrentPrice(pair);
  }

  getATR(pair, technical, currentPrice) {
    const timeframes = technical && typeof technical === 'object' ? technical.timeframes : null;
    const h1 = timeframes && typeof timeframes === 'object' ? timeframes['H1'] : null;
    const raw = h1?.indicators?.atr?.value;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    // Robust fallback: some EA-only feeds can produce ATR=0 even though price is valid.
    // Use a realistic synthetic volatility baseline so SL/TP distances are never zero.
    const pipSize = getPipSize(pair);
    const volatilityBaseline = getSyntheticVolatility(pair);
    const pctFallback =
      Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0
        ? Number(currentPrice) * 0.0006
        : null;

    const candidates = [
      // Prefer per-instrument volatility baseline (matches the catalog asset class).
      Number.isFinite(volatilityBaseline) && volatilityBaseline > 0 ? volatilityBaseline : null,
      // Ensure at least a handful of pips/ticks so rounding doesn't collapse SL/TP.
      Number.isFinite(pipSize) && pipSize > 0 ? pipSize * 12 : null,
      // Percentage-of-price backup.
      pctFallback,
      // Absolute last resort.
      0.0015
    ].filter((v) => Number.isFinite(v) && v > 0);

    return candidates.length ? candidates[0] : 0.0015;
  }

  formatPrice(pair, price) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
      return null;
    }
    const decimals = getPricePrecision(pair);
    return parseFloat(price.toFixed(decimals));
  }

  calculatePips(pair, priceDiff) {
    const pipSize = getPipSize(pair);
    if (!Number.isFinite(pipSize) || pipSize === 0) {
      return 0;
    }
    return priceDiff / pipSize;
  }

  generateTradeId() {
    return `TRADE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getPairCorrelationScore(pairA, pairB) {
    if (!pairA || !pairB) {
      return 0;
    }
    if (pairA === pairB) {
      return 1;
    }
    const matrix = this.riskCommandConfig?.correlation?.matrix || {};
    const key = `${pairA}:${pairB}`.toUpperCase();
    const reverseKey = `${pairB}:${pairA}`.toUpperCase();
    if (matrix[key] != null) {
      return Number(matrix[key]);
    }
    if (matrix[reverseKey] != null) {
      return Number(matrix[reverseKey]);
    }
    return this.sharesCurrency(pairA, pairB) ? 0.68 : 0.2;
  }

  sharesCurrency(pairA, pairB) {
    const [aBase, aQuote] = this.splitPair(pairA);
    const [bBase, bQuote] = this.splitPair(pairB);
    return aBase === bBase || aBase === bQuote || aQuote === bBase || aQuote === bQuote;
  }

  monitorExposure(pair, exposurePreview) {
    if (!this.alertBus) {
      return;
    }
    const limit = this.config.maxExposurePerCurrency;
    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }
    const warningLevel = limit * (this.alerting.exposureWarningFraction ?? 0.9);
    const exposures = exposurePreview?.current || {};
    const now = Date.now();

    Object.entries(exposures).forEach(([currency, exposureValue]) => {
      const exposure = Number(exposureValue) || 0;
      const magnitude = Math.abs(exposure);
      if (magnitude < warningLevel) {
        return;
      }
      const severity = magnitude >= limit ? 'critical' : 'warning';
      const key = `${pair}-${currency}-${severity}`;
      const last = this.exposureAlertTimestamps.get(key) || 0;
      if (now - last < this.alerting.volatilityCooldownMs) {
        return;
      }
      this.exposureAlertTimestamps.set(key, now);
      void this.alertBus.publish({
        topic: 'risk_exposure',
        severity,
        message: `${currency} exposure at ${Math.round(magnitude)} (limit ${limit})`,
        context: {
          pair,
          currency,
          exposure,
          limit,
          timestamp: new Date(now).toISOString()
        }
      });
    });
  }

  handleTradeClosed(trade) {
    const pct = Number.parseFloat(trade.finalPnL?.percentage) || 0;
    const previousEquity =
      this.performanceMetrics.equityCurve[this.performanceMetrics.equityCurve.length - 1] ||
      this.performanceMetrics.latestEquity ||
      this.performanceMetrics.startingEquity;
    const nextEquity = Number((previousEquity * (1 + pct / 100)).toFixed(2));

    this.performanceMetrics.latestEquity = nextEquity;
    this.performanceMetrics.equityCurve.push(nextEquity);
    if (nextEquity > this.performanceMetrics.peakEquity) {
      this.performanceMetrics.peakEquity = nextEquity;
    }

    const drawdownPct =
      this.performanceMetrics.peakEquity === 0
        ? 0
        : ((nextEquity - this.performanceMetrics.peakEquity) / this.performanceMetrics.peakEquity) *
          100;
    if (drawdownPct < this.performanceMetrics.maxDrawdownPct) {
      this.performanceMetrics.maxDrawdownPct = drawdownPct;
    }

    this.performanceMetrics.cumulativeReturnPct =
      (nextEquity / this.performanceMetrics.startingEquity - 1) * 100;

    this.evaluateDrawdownAlert(drawdownPct, {
      tradeId: trade.id,
      equity: nextEquity,
      drawdownPct
    });

    this.updateVaRMetrics();
    this.refreshRiskCommandSnapshot();

    try {
      updatePerformanceMetrics({
        performance: this.performanceMetrics,
        statistics: this.getStatistics?.() || {}
      });
    } catch (_error) {
      // best-effort
    }

    try {
      this.updatePerformanceBreakdown(trade);
    } catch (_error) {
      // best-effort
    }
  }

  extractStrategyKey(trade) {
    const signal = trade?.signal || null;
    const strategy =
      signal?.strategy ||
      signal?.strategyId ||
      signal?.components?.strategy?.id ||
      signal?.components?.strategy?.key ||
      signal?.components?.layeredAnalysis?.strategy ||
      signal?.source ||
      null;
    return strategy ? String(strategy) : 'default';
  }

  updatePerformanceBreakdown(trade) {
    if (!trade) {
      return;
    }
    const pairKey = String(trade.pair || '').trim();
    if (pairKey) {
      this.updatePerformanceBucket(this.performanceByPair, pairKey, trade);
    }

    const strategyKey = this.extractStrategyKey(trade);
    if (strategyKey) {
      this.updatePerformanceBucket(this.performanceByStrategy, strategyKey, trade);
    }
  }

  updatePerformanceBucket(map, key, trade) {
    if (!map || !key) {
      return;
    }
    const pct = Number.parseFloat(trade.finalPnL?.percentage);
    const pnlPct = Number.isFinite(pct) ? pct : 0;
    const wins = pnlPct > 0 ? 1 : 0;
    const losses = pnlPct < 0 ? 1 : 0;

    const current = map.get(key) || {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      totalWin: 0,
      totalLoss: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      winRate: 0,
      updatedAt: null
    };

    current.totalTrades += 1;
    current.wins += wins;
    current.losses += losses;
    current.totalPnL += pnlPct;
    if (wins) {
      current.totalWin += pnlPct;
    }
    if (losses) {
      current.totalLoss += Math.abs(pnlPct);
    }

    current.avgWin = current.wins ? current.totalWin / current.wins : 0;
    current.avgLoss = current.losses ? current.totalLoss / current.losses : 0;
    current.profitFactor =
      current.totalLoss > 0 ? Number((current.totalWin / current.totalLoss).toFixed(3)) : 0;
    current.winRate = current.totalTrades
      ? Number(((current.wins / current.totalTrades) * 100).toFixed(2))
      : 0;
    current.updatedAt = Date.now();

    map.set(key, current);
  }

  getPerformanceBreakdown({ limit = 20 } = {}) {
    const toList = (map) =>
      Array.from(map.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0))
        .slice(0, Math.max(1, Number(limit) || 0));

    return {
      byPair: toList(this.performanceByPair || new Map()),
      byStrategy: toList(this.performanceByStrategy || new Map())
    };
  }

  evaluateDrawdownAlert(drawdownPct, context = {}) {
    if (!this.alertBus) {
      return;
    }
    const threshold = Math.max(0, this.alerting.drawdownThresholdPct || 0);
    const magnitude = Math.abs(drawdownPct);
    if (magnitude < threshold) {
      return;
    }
    if (magnitude - (this.performanceMetrics.lastAlertedDrawdownPct || 0) < 0.5) {
      return;
    }
    this.performanceMetrics.lastAlertedDrawdownPct = magnitude;
    void this.alertBus.publish({
      topic: 'drawdown',
      severity: 'critical',
      message: `Max drawdown ${magnitude.toFixed(2)}% reached`,
      context,
      channels: ['log', 'slack', 'email', 'webhook']
    });
  }

  evaluateVolatilityAlert(pair, volatilitySummary, context = {}) {
    if (!this.alertBus || !volatilitySummary) {
      return;
    }
    const score = Number.isFinite(volatilitySummary.averageScore)
      ? volatilitySummary.averageScore
      : Number(volatilitySummary.volatilityScore);
    if (!Number.isFinite(score)) {
      return;
    }
    const state = (volatilitySummary.state || 'normal').toLowerCase();
    const threshold = this.alerting.volatilityScoreThreshold ?? 92;
    if (score < threshold && state !== 'extreme') {
      return;
    }
    const now = Date.now();
    const key = `${pair}-${state}`;
    const lastAlert = this.volatilityAlertTimestamps.get(key) || 0;
    if (now - lastAlert < this.alerting.volatilityCooldownMs) {
      return;
    }
    this.volatilityAlertTimestamps.set(key, now);
    const severity = state === 'extreme' ? 'critical' : 'warning';
    void this.alertBus.publish({
      topic: 'volatility_spike',
      severity,
      message: `${pair} volatility ${score.toFixed(1)} (${state})`,
      context: {
        pair,
        score,
        state,
        ...context
      },
      channels: ['log', 'slack', 'webhook', 'email']
    });
  }

  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      equityCurve: this.performanceMetrics.equityCurve.slice()
    };
  }

  updateVaRMetrics() {
    if (!this.riskCommandConfig?.valueAtRisk?.enabled) {
      this.riskCommandMetrics.var = null;
      return;
    }
    const cfg = this.riskCommandConfig.valueAtRisk;
    const lookback = Math.max(cfg.lookbackTrades || 0, cfg.minSamples || 0);
    const trades = this.tradingHistory.slice(-lookback);
    const returns = trades
      .map((trade) => Number.parseFloat(trade.finalPnL?.percentage) / 100)
      .filter((value) => Number.isFinite(value));

    if (returns.length < (cfg.minSamples || 0)) {
      this.riskCommandMetrics.var = {
        ready: false,
        sampleCount: returns.length,
        lookback,
        confidence: cfg.confidence,
        limitPct: cfg.maxLossPct
      };
      return;
    }

    const sorted = returns.slice().sort((a, b) => a - b);
    const rank = Math.max(0, Math.ceil((1 - cfg.confidence) * sorted.length) - 1);
    const tail = sorted[rank] ?? sorted[0];
    const valuePct = Math.abs(tail * 100);
    const breach = valuePct > cfg.maxLossPct;

    this.riskCommandMetrics.var = {
      ready: true,
      valuePct: Number(valuePct.toFixed(2)),
      limitPct: cfg.maxLossPct,
      breach,
      confidence: cfg.confidence,
      lookback,
      sampleCount: returns.length,
      lastUpdated: new Date().toISOString()
    };
  }

  buildTradeBlotter(limit = 25) {
    const maxItems = Math.max(1, limit);
    const openTrades = Array.from(this.activeTrades.values()).map((trade) => ({
      id: trade.id,
      pair: trade.pair,
      direction: trade.direction,
      positionSize: Number(trade.positionSize || 0),
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      openTime: trade.openTime,
      status: trade.status,
      broker: trade.broker || null,
      pnl: trade.currentPnL || null
    }));

    const closedTrades = this.tradingHistory
      .slice(-maxItems)
      .reverse()
      .map((trade) => ({
        id: trade.id,
        pair: trade.pair,
        direction: trade.direction,
        positionSize: Number(trade.positionSize || 0),
        entryPrice: trade.entryPrice,
        closePrice: trade.closePrice,
        closeReason: trade.closeReason,
        openTime: trade.openTime,
        closeTime: trade.closeTime,
        status: trade.status,
        broker: trade.broker || null,
        pnl: trade.finalPnL || null
      }));

    return {
      openTrades,
      recentClosed: closedTrades
    };
  }

  buildPnlSummary(realized, unrealized) {
    const realizedValue = Number.isFinite(realized) ? realized : 0;
    const unrealizedValue = Number.isFinite(unrealized) ? unrealized : 0;
    const trades = this.tradingHistory;

    const bestTrade = trades.reduce((best, trade) => {
      const pct = Number.parseFloat(trade.finalPnL?.percentage);
      if (!Number.isFinite(pct)) {
        return best;
      }
      if (!best || pct > best.pnlPct) {
        return {
          tradeId: trade.id,
          pair: trade.pair,
          pnlPct: Number(pct.toFixed(2)),
          pnlAmount: Number.parseFloat(trade.finalPnL?.amount) || null,
          closeTime: trade.closeTime || null
        };
      }
      return best;
    }, null);

    const worstTrade = trades.reduce((worst, trade) => {
      const pct = Number.parseFloat(trade.finalPnL?.percentage);
      if (!Number.isFinite(pct)) {
        return worst;
      }
      if (!worst || pct < worst.pnlPct) {
        return {
          tradeId: trade.id,
          pair: trade.pair,
          pnlPct: Number(pct.toFixed(2)),
          pnlAmount: Number.parseFloat(trade.finalPnL?.amount) || null,
          closeTime: trade.closeTime || null
        };
      }
      return worst;
    }, null);

    return {
      realized: Number(realizedValue.toFixed(2)),
      unrealized: Number(unrealizedValue.toFixed(2)),
      net: Number((realizedValue + unrealizedValue).toFixed(2)),
      bestTrade,
      worstTrade
    };
  }

  buildCorrelationSnapshot() {
    const correlationConfig = this.riskCommandConfig?.correlation;
    if (!correlationConfig || correlationConfig.enabled === false) {
      return {
        enabled: false,
        threshold: correlationConfig?.threshold ?? 0.8,
        maxCluster: correlationConfig?.maxClusterSize ?? 3,
        correlations: [],
        clusterLoad: [],
        blocked: false
      };
    }

    const threshold = correlationConfig.threshold ?? 0.8;
    const maxCluster = correlationConfig.maxClusterSize ?? 3;
    const trades = Array.from(this.activeTrades.values());
    const correlations = [];
    const clusterMap = new Map();

    for (let i = 0; i < trades.length; i += 1) {
      for (let j = i + 1; j < trades.length; j += 1) {
        const tradeA = trades[i];
        const tradeB = trades[j];
        const score = this.getPairCorrelationScore(tradeA.pair, tradeB.pair);
        if (!Number.isFinite(score) || score < threshold) {
          continue;
        }
        const correlationEntry = {
          tradeA: tradeA.id,
          tradeB: tradeB.id,
          pairA: tradeA.pair,
          pairB: tradeB.pair,
          correlation: Number(score.toFixed(3))
        };
        correlations.push(correlationEntry);
        clusterMap.set(tradeA.id, (clusterMap.get(tradeA.id) || 0) + 1);
        clusterMap.set(tradeB.id, (clusterMap.get(tradeB.id) || 0) + 1);
      }
    }

    const clusterLoad = Array.from(clusterMap.entries()).map(([tradeId, count]) => ({
      tradeId,
      count,
      pair: this.activeTrades.get(tradeId)?.pair || null
    }));
    const peakLoad = clusterLoad.reduce((max, item) => Math.max(max, item.count), 0);

    return {
      enabled: true,
      threshold,
      maxCluster,
      correlations,
      clusterLoad,
      blocked: peakLoad >= maxCluster
    };
  }

  refreshRiskCommandSnapshot() {
    if (!this.riskCommandConfig?.enabled) {
      return;
    }

    const exposures = this.calculateCurrencyExposures();
    const currencyLimits = this.evaluateCurrencyLimitBreaches
      ? this.evaluateCurrencyLimitBreaches(exposures)
      : { breaches: [], allowed: true };

    const realizedPnL = this.tradingHistory.reduce(
      (sum, trade) => sum + (Number.parseFloat(trade.finalPnL?.amount) || 0),
      0
    );
    const unrealizedPnL = Array.from(this.activeTrades.values()).reduce(
      (sum, trade) => sum + (Number.parseFloat(trade.currentPnL?.amount) || 0),
      0
    );

    this.riskCommandMetrics = {
      ...this.riskCommandMetrics,
      exposures,
      currencyLimitBreaches: currencyLimits.breaches || [],
      correlation: this.buildCorrelationSnapshot(),
      pnlSummary: this.buildPnlSummary(realizedPnL, unrealizedPnL),
      blotter: this.buildTradeBlotter(this.riskCommandConfig.blotterSize),
      updatedAt: Date.now()
    };
  }

  getRiskCommandSnapshot() {
    if (!this.riskCommandConfig?.enabled) {
      return { enabled: false };
    }

    this.refreshRiskCommandSnapshot();
    const varGuard = this.evaluateValueAtRiskGuard
      ? this.evaluateValueAtRiskGuard()
      : { allowed: true };

    return {
      enabled: true,
      exposures: this.riskCommandMetrics.exposures,
      currencyLimitBreaches: this.riskCommandMetrics.currencyLimitBreaches,
      limits: {
        currency: this.riskCommandConfig.currencyLimits || null,
        default: this.riskCommandConfig.defaultCurrencyLimit
      },
      correlation: this.riskCommandMetrics.correlation,
      var: {
        ...(this.riskCommandMetrics.var || { ready: false }),
        guard: varGuard
      },
      pnlSummary: this.riskCommandMetrics.pnlSummary,
      blotter: this.riskCommandMetrics.blotter,
      updatedAt: this.riskCommandMetrics.updatedAt
    };
  }

  getDefaultSignal(pair) {
    const raw = {
      pair,
      timestamp: Date.now(),
      direction: 'NEUTRAL',
      strength: 0,
      confidence: 0,
      finalScore: 0,
      components: {},
      entry: null,
      isValid: { isValid: false, checks: {}, reason: 'Error generating signal' }
    };

    return validateTradingSignalDTO(createTradingSignalDTO(raw));
  }

  // DTO helper accessors so other modules can opt in without importing dtos.js directly
  toTradingSignalDTO(raw) {
    return validateTradingSignalDTO(createTradingSignalDTO(raw));
  }

  toTradeDTO(raw) {
    return validateTradeDTO(createTradeDTO(raw));
  }

  toEconomicAnalysisDTO(raw) {
    return validateEconomicAnalysisDTO(normalizeEconomicAnalysis(raw));
  }

  toNewsAnalysisDTO(raw) {
    return validateNewsAnalysisDTO(normalizeNewsAnalysis(raw));
  }

  toTechnicalAnalysisDTO(raw) {
    return validateTechnicalAnalysisDTO(normalizeTechnicalAnalysis(raw));
  }

  /**
   * Get trading statistics
   */
}

export default TradingEngine;
