/**
 * Intelligent Trading Engine
 * Combines economic, news, and technical analysis for smart trading decisions
 */

import EconomicAnalyzer from '../analyzers/economic-analyzer.js';
import EnhancedNewsAnalyzer from '../analyzers/enhanced-news-analyzer.js';
import TechnicalAnalyzer from '../analyzers/technical-analyzer.js';
import FeatureStore from '../services/feature-store.js';
import PriceDataFetcher from '../data/price-data-fetcher.js';
import AdaptiveScorer from '../services/adaptive-scorer.js';
import { createPersistenceAdapter } from '../storage/persistence-adapter.js';
import { analysisCore } from './modules/analysis-core.js';
import { riskEngine } from './modules/risk-engine.js';
import { executionEngine } from './modules/execution-engine.js';
import { persistenceHub } from './modules/persistence-hub.js';
import { orchestrationCoordinator } from './modules/orchestration-coordinator.js';
import { dataQualityGuard } from './modules/data-quality-guard.js';
import { getPairMetadata, getPipSize, getPricePrecision } from '../config/pair-catalog.js';
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
} from '../models/dtos.js';

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

    this.adaptiveScorer =
      dependencies.adaptiveScorer ||
      config.adaptiveScorer ||
      new AdaptiveScorer(config.adaptiveScoring || {});

    this.alertBus = dependencyAlertBus;
    this.brokerRouter = dependencies.brokerRouter || config.brokerRouter || null;
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
      adaptiveScorer: this.adaptiveScorer,
      alertBus: this.alertBus,
      brokerRouter: this.brokerRouter
    };

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
      winRateByKey: new Map()
    };

    this.bindAnalysisCoreMethods();
    this.bindRiskEngineMethods();
    this.bindExecutionEngineMethods();
    this.bindPersistenceHubMethods();
    this.bindOrchestrationCoordinator();
    this.bindDataQualityGuard();
    this.updateVaRMetrics();
    this.refreshRiskCommandSnapshot();
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
      return 45;
    }

    const technicalScoreRaw = components?.technical?.score ?? 0;
    const newsConfidenceRaw = components?.news?.confidence ?? 0;
    const economicScoreRaw =
      components?.economic?.score ?? components?.economic?.details?.relativeSentiment ?? 0;
    const riskRewardRaw = entry?.riskReward ?? 0;

    const cacheKey = JSON.stringify({
      direction,
      strength: Math.round(strength ?? 0),
      confidence: Math.round(confidence ?? 0),
      technicalScore: Math.round(technicalScoreRaw),
      newsConfidence: Math.round(newsConfidenceRaw),
      economicScore: Math.round(economicScoreRaw),
      riskReward: Number(riskRewardRaw.toFixed(2)),
      trailingEnabled: Boolean(entry?.trailingStop?.enabled)
    });

    const cached = this.analyticsCache.winRateByKey.get(cacheKey);
    if (typeof cached === 'number') {
      return cached;
    }

    const clampedStrength = Math.min(Math.max(strength || 0, 0), 100);
    const clampedConfidence = Math.min(Math.max(confidence || 0, 0), 100);
    const technicalScore = Math.min(Math.abs(technicalScoreRaw || 0), 120);
    const newsConfidence = Math.min(newsConfidenceRaw || 0, 100);
    const economicEdge = Math.min(Math.abs(economicScoreRaw || 0), 100);
    const riskReward = Math.min(Math.max(riskRewardRaw || 0, 0), 4);

    let composite =
      clampedStrength * 0.32 +
      clampedConfidence * 0.26 +
      technicalScore * 0.2 +
      economicEdge * 0.08 +
      newsConfidence * 0.06 +
      riskReward * 18;

    if (entry?.trailingStop?.enabled) {
      composite += 2;
    }

    if (clampedStrength >= 75 && clampedConfidence >= 75) {
      composite += 6;
    }

    if (riskReward >= 2) {
      composite += 5;
    }

    composite += 8; // baseline edge for curated multi-factor alignment

    const normalized = 67 + (composite / 100) * 35;
    let estimate = Math.max(67, Math.min(normalized, 97));

    if (clampedStrength >= 85 && clampedConfidence >= 85 && riskReward >= 2) {
      estimate = Math.max(estimate, 94 + Math.min(riskReward - 2, 1) * 3);
    }

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
    return [
      `${side} ${pair} (${direction}) near ${entry.price}`,
      `Stop ${entry.stopLoss} (${slPips})`,
      `Target ${entry.takeProfit} (${tpPips})`,
      `Risk/Reward ${rr}`,
      `Estimated edge ${winRate.toFixed(1)}% | Confidence ${confidence.toFixed(1)}%`
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
    const atr = this.getATR(technical);

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

    // Add trailing stop parameters
    entry.trailingStop = {
      enabled: true,
      activationLevel: takeProfitDistance * 0.3, // Activate at 30% of TP
      trailingDistance: stopLossDistance * 0.8 // Trail at 80% of initial SL
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
    const validations = {
      hasDirection: signal.direction !== 'NEUTRAL',
      meetsStrength:
        signal.strength >= this.config.minSignalStrength || signal.estimatedWinRate >= 92,
      hasEntry: signal.entry !== null,
      withinRiskLimit: signal.riskManagement && signal.riskManagement.canTrade,
      underMaxTrades: this.activeTrades.size < this.config.maxConcurrentTrades,
      goodRiskReward: signal.entry && signal.entry.riskReward >= 1.6,
      highConfidence: signal.confidence >= 65,
      highProbability: signal.estimatedWinRate >= 90,
      qualityConfidenceFloor: !signal.components?.marketData?.confidenceFloorBreached
    };

    const isValid = Object.values(validations).every((v) => v === true);

    return {
      isValid,
      checks: validations,
      reason: isValid ? 'Signal passed all validations' : this.getFailureReason(validations)
    };
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
    ensemble = null,
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
      machineLearning: [],
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

    if (news.sentimentFeeds?.compositeScore != null) {
      pushReason(
        'news',
        'NEWS_COMPOSITE_SENTIMENT',
        `Composite sentiment ${news.sentimentFeeds.compositeScore.toFixed(2)} (confidence ${news.sentimentFeeds.confidence ?? 0}%)`,
        Math.min(1, Math.abs(news.sentimentFeeds.compositeScore) / 1.5),
        {
          compositeScore: news.sentimentFeeds.compositeScore,
          confidence: news.sentimentFeeds.confidence
        }
      );
    }

    // Technical component
    if (Array.isArray(technical.signals) && technical.signals.length > 0) {
      const primarySignal = technical.signals[0];
      pushReason(
        'technical',
        'TECH_PRIMARY_SIGNAL',
        `${primarySignal.type} signal on ${primarySignal.timeframe} with ${primarySignal.confidence.toFixed(0)}% confidence`,
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

    // Machine learning component
    if (ensemble) {
      const probability = Number.isFinite(ensemble.probability) ? ensemble.probability : 0.5;
      const defaultBuyThreshold =
        ensemble.thresholds?.buy ?? this.adaptiveScorer?.config?.defaultThreshold ?? 0.6;
      pushReason(
        'machineLearning',
        'ML_ENSEMBLE_PROBABILITY',
        `Ensemble probability ${(probability * 100).toFixed(1)}% vs buy threshold ${(defaultBuyThreshold * 100).toFixed(1)}%`,
        Math.min(1.2, probability * 1.2),
        {
          probability,
          thresholds: ensemble.thresholds,
          direction: ensemble.direction
        }
      );

      const ruleProbability = Number.isFinite(ensemble.ruleProbability)
        ? ensemble.ruleProbability
        : null;
      const modelProbability = Number.isFinite(ensemble.modelProbability)
        ? ensemble.modelProbability
        : null;
      const ruleGap =
        ruleProbability != null && modelProbability != null
          ? Math.abs(ruleProbability - modelProbability)
          : 0;
      if (ruleGap >= 0.05) {
        pushReason(
          'machineLearning',
          'ML_RULE_MODEL_DELTA',
          `Rule vs model probability delta ${(ruleGap * 100).toFixed(1)}%`,
          Math.min(0.8, ruleGap * 2),
          {
            ruleProbability,
            modelProbability
          }
        );
      }

      if (ensemble.direction && ensemble.direction !== 'NEUTRAL') {
        pushReason(
          'machineLearning',
          'ML_DIRECTION',
          `Ensemble directional vote is ${ensemble.direction}`,
          0.7,
          { direction: ensemble.direction }
        );
      }
    }

    const summary = {
      pair,
      direction,
      confidence: Number((confidence ?? 0).toFixed(2)),
      strength: Number((strength ?? 0).toFixed(2)),
      finalScore: Number((finalScore ?? 0).toFixed(2)),
      ensembleProbability: ensemble
        ? Number(
            ((Number.isFinite(ensemble.probability) ? ensemble.probability : 0.5) * 100).toFixed(2)
          )
        : null,
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
      if (Number.isFinite(summary.ensembleProbability)) {
        headline += ` | Ensemble ${summary.ensembleProbability.toFixed(1)}%`;
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
    addCategory('machineLearning', 'Machine Learning');
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

  async getCurrentPriceForPair(pair) {
    // Fetch real-time price from data sources
    return await this.priceDataFetcher.getCurrentPrice(pair);
  }

  getATR(technical) {
    // Get ATR from technical analysis
    const h1 = technical.timeframes['H1'];
    return h1 && h1.indicators.atr ? h1.indicators.atr.value : 0.0015;
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
