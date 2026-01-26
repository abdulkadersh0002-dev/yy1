import logger from '../../infrastructure/services/logging/logger.js';

const DEFAULT_AVAILABILITY_QUALITY_THRESHOLD = 0.55;

/**
 * Advanced Technical Analysis Engine
 * Comprehensive technical indicators and pattern recognition
 */

class TechnicalAnalyzer {
  constructor(options = {}) {
    this.cache = new Map();
    this.cacheDuration = 300000; // 5 minutes
    this.featureStore = null;
    this.logger = options.logger || logger;
    this.availabilityQualityThreshold = Number.isFinite(options.availabilityQualityThreshold)
      ? options.availabilityQualityThreshold
      : DEFAULT_AVAILABILITY_QUALITY_THRESHOLD;
  }

  analyzeTechnicalCacheKeyFromSeries(pair, timeframes, seriesByTimeframe) {
    try {
      const keyParts = [`tech_ea_${pair}`, ...(Array.isArray(timeframes) ? timeframes : [])];
      const newest = (tf) => {
        const series =
          seriesByTimeframe?.[tf] || seriesByTimeframe?.[String(tf || '').toLowerCase()];
        if (!Array.isArray(series) || series.length === 0) {
          return null;
        }
        const last = series[series.length - 1];
        const t = last?.time ?? last?.timestamp ?? last?.t;
        const numeric = Number(t);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return null;
        }
        const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        return Math.round(ms);
      };

      for (const tf of Array.isArray(timeframes) ? timeframes : []) {
        const ts = newest(tf);
        keyParts.push(`${tf}:${ts ?? 'na'}`);
      }
      return keyParts.join('|');
    } catch (_error) {
      return `tech_ea_${pair}`;
    }
  }

  /**
   * Perform technical analysis using pre-supplied candle series (e.g. EA-driven bars).
   * This avoids external providers and produces richer indicators/patterns than the lite candle analyzer.
   */
  async analyzeTechnicalFromCandles(
    pair,
    seriesByTimeframe = {},
    timeframes = ['M15', 'H1', 'H4', 'D1']
  ) {
    const requested =
      Array.isArray(timeframes) && timeframes.length ? timeframes : ['M15', 'H1', 'H4', 'D1'];
    const cacheKey = this.analyzeTechnicalCacheKeyFromSeries(pair, requested, seriesByTimeframe);
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const analysis = {
        pair,
        timestamp: Date.now(),
        timeframes: {},
        overallScore: 0,
        trend: 'neutral',
        strength: 0,
        signals: []
      };

      const availabilityByTimeframe = {};
      for (const tf of requested) {
        availabilityByTimeframe[tf] = {
          timeframe: tf,
          inspectedAt: Date.now(),
          viable: true,
          reasons: ['ea_bridge'],
          normalizedQuality: 1,
          availableProviders: ['eaBridge'],
          blockedProviders: [],
          availabilityDetails: []
        };

        const series =
          seriesByTimeframe?.[tf] ||
          seriesByTimeframe?.[String(tf || '').toLowerCase()] ||
          seriesByTimeframe?.[String(tf || '').toUpperCase()] ||
          null;

        const normalizedSeries = Array.isArray(series) ? series : [];
        const timeframeAnalysis = await this.analyzeTimeframe(normalizedSeries, tf, pair);
        analysis.timeframes[tf] = this.applyAvailabilityMetadata(
          timeframeAnalysis,
          availabilityByTimeframe[tf]
        );
      }

      analysis.dataAvailability = this.summarizeAvailability(
        pair,
        availabilityByTimeframe,
        requested
      );

      analysis.overallScore = this.calculateOverallScore(analysis.timeframes);
      analysis.trend = this.determineTrend(analysis.overallScore);
      analysis.strength = Math.min(Math.abs(analysis.overallScore), 100);
      analysis.signals = this.generateSignals(analysis.timeframes);
      analysis.latestPrice = this.getLatestPriceFromTimeframes(analysis.timeframes);
      analysis.directionSummary = this.buildDirectionSummary(analysis.timeframes);
      analysis.regimeSummary = this.aggregateRegime(analysis.timeframes);
      analysis.volatilitySummary = this.aggregateVolatility(analysis.timeframes);
      analysis.divergenceSummary = this.aggregateDivergences(analysis.timeframes);
      analysis.volumePressureSummary = this.aggregateVolumePressure(analysis.timeframes);

      this.setCached(cacheKey, analysis);
      return analysis;
    } catch (error) {
      this.logger.error({ err: error, pair }, 'EA candle technical analysis failed');
      return this.getDefaultAnalysis(pair);
    }
  }

  /**
   * Perform complete technical analysis
   */
  async analyzeTechnical(pair, timeframes = ['M15', 'H1', 'H4', 'D1']) {
    const cacheKey = `tech_${pair}_${timeframes.join('_')}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const analysis = {
        pair,
        timestamp: Date.now(),
        timeframes: {},
        overallScore: 0,
        trend: 'neutral',
        strength: 0,
        signals: []
      };

      // Analyze each timeframe
      const availabilityByTimeframe = {};
      for (const tf of timeframes) {
        const availabilityDetail = this.evaluateAvailability(tf);
        if (availabilityDetail) {
          availabilityByTimeframe[tf] = {
            timeframe: tf,
            inspectedAt: Date.now(),
            ...availabilityDetail
          };
        }

        let priceData = null;
        if (!availabilityDetail || availabilityDetail.viable !== false) {
          priceData = await this.fetchPriceData(pair, tf);
        } else {
          this.logger.warn(
            { pair, timeframe: tf, availability: availabilityDetail },
            'Technical analyzer skipping timeframe due to provider availability gating'
          );
        }

        const timeframeAnalysis = await this.analyzeTimeframe(priceData, tf, pair);
        analysis.timeframes[tf] = this.applyAvailabilityMetadata(
          timeframeAnalysis,
          availabilityByTimeframe[tf]
        );
      }

      analysis.dataAvailability = this.summarizeAvailability(
        pair,
        availabilityByTimeframe,
        timeframes
      );

      // Calculate overall analysis
      analysis.overallScore = this.calculateOverallScore(analysis.timeframes);
      analysis.trend = this.determineTrend(analysis.overallScore);
      analysis.strength = Math.min(Math.abs(analysis.overallScore), 100);
      analysis.signals = this.generateSignals(analysis.timeframes);
      analysis.latestPrice = this.getLatestPriceFromTimeframes(analysis.timeframes);
      analysis.directionSummary = this.buildDirectionSummary(analysis.timeframes);
      analysis.regimeSummary = this.aggregateRegime(analysis.timeframes);
      analysis.volatilitySummary = this.aggregateVolatility(analysis.timeframes);
      analysis.divergenceSummary = this.aggregateDivergences(analysis.timeframes);
      analysis.volumePressureSummary = this.aggregateVolumePressure(analysis.timeframes);

      if (!analysis.dataAvailability || analysis.dataAvailability.viable) {
        this.setCached(cacheKey, analysis);
      }
      return analysis;
    } catch (error) {
      this.logger.error({ err: error, pair, timeframes }, 'Technical analysis failed');
      return this.getDefaultAnalysis(pair);
    }
  }

  evaluateAvailability(timeframe) {
    if (!this.priceDataFetcher || typeof this.priceDataFetcher.isDataFetchViable !== 'function') {
      return null;
    }
    try {
      return this.priceDataFetcher.isDataFetchViable(timeframe, {
        includeDetails: true,
        requireHealthyQuality: true,
        qualityThreshold: this.availabilityQualityThreshold
      });
    } catch (error) {
      this.logger?.debug?.({ err: error, timeframe }, 'Availability evaluation failed');
      return null;
    }
  }

  applyAvailabilityMetadata(frame, availabilityDetail) {
    if (!frame || !availabilityDetail) {
      return frame;
    }
    const inspectedAt = Number.isFinite(availabilityDetail.inspectedAt)
      ? availabilityDetail.inspectedAt
      : Date.now();
    frame.dataAvailability = {
      ...availabilityDetail,
      inspectedAt
    };
    frame.availabilityStatus = frame.dataAvailability.viable === false ? 'degraded' : 'available';
    frame.availabilityReasons = Array.isArray(frame.dataAvailability.reasons)
      ? [...frame.dataAvailability.reasons]
      : [];
    return frame;
  }

  summarizeAvailability(pair, availabilityMap, requestedTimeframes) {
    if (!availabilityMap || !requestedTimeframes) {
      return null;
    }
    const entries = [];
    for (const tf of requestedTimeframes) {
      const detail = availabilityMap[tf];
      if (detail) {
        entries.push({
          ...detail,
          timeframe: detail.timeframe || tf
        });
      }
    }
    if (entries.length === 0) {
      return null;
    }
    const blocked = entries.filter((entry) => entry.viable === false);
    const reasons = new Set();
    blocked.forEach((entry) => {
      (entry.reasons || []).forEach((reason) => reasons.add(reason));
    });
    const normalizedValues = entries
      .map((entry) => Number(entry.normalizedQuality))
      .filter((value) => Number.isFinite(value));
    const normalizedQuality =
      normalizedValues.length > 0
        ? Number(
            (
              normalizedValues.reduce((sum, value) => sum + value, 0) / normalizedValues.length
            ).toFixed(3)
          )
        : null;
    const inspectedAtCandidate = entries.reduce((latest, entry) => {
      const timestamp = Number(entry.inspectedAt);
      if (Number.isFinite(timestamp)) {
        return Math.max(latest, timestamp);
      }
      return latest;
    }, 0);
    const inspectedAt = inspectedAtCandidate > 0 ? inspectedAtCandidate : Date.now();

    return {
      pair,
      inspectedAt,
      viable: blocked.length === 0,
      totalTimeframes: entries.length,
      availableTimeframes: entries
        .filter((entry) => entry.viable !== false)
        .map((entry) => entry.timeframe),
      blockedTimeframes: blocked.map((entry) => entry.timeframe),
      reasons: Array.from(reasons),
      normalizedQuality,
      timeframes: entries.reduce((acc, entry) => {
        acc[entry.timeframe] = entry;
        return acc;
      }, {})
    };
  }

  /**
   * Analyze single timeframe
   */
  async analyzeTimeframe(priceData, timeframe, pair = null) {
    if (!priceData || priceData.length < 2) {
      return this.getFallbackTimeframeAnalysis(timeframe);
    }

    const analysis = {
      timeframe,
      pair,
      indicators: {},
      patterns: [],
      supportResistance: {},
      score: 0,
      lastPrice: null,
      latestCandle: null,
      priceChangePercent: 0,
      direction: 'NEUTRAL'
    };

    // Calculate all indicators
    analysis.indicators.sma = this.calculateSMA(priceData, [20, 50, 200]);
    analysis.indicators.ema = this.calculateEMA(priceData, [9, 21, 55]);
    analysis.indicators.rsi = this.calculateRSI(priceData, 14);
    analysis.indicators.macd = this.calculateMACD(priceData);
    analysis.indicators.bollinger = this.calculateBollingerBands(priceData, 20, 2);
    analysis.indicators.stochastic = this.calculateStochastic(priceData, 14, 3, 3);
    analysis.indicators.atr = this.calculateATR(priceData, 14);
    analysis.indicators.adx = this.calculateADX(priceData, 14);
    analysis.indicators.ichimoku = this.calculateIchimoku(priceData);
    analysis.indicators.fibonacci = this.calculateFibonacci(priceData);
    analysis.indicators.rsiSeries = this.calculateRSISeries(priceData, 14);
    analysis.indicators.macdSeries = this.calculateMACDSeries(priceData);

    // Detect patterns
    analysis.patterns = this.detectPatterns(priceData);

    const latestCandle = priceData[priceData.length - 1];
    const prevCandle = priceData[priceData.length - 2];
    analysis.lastPrice = latestCandle.close;
    analysis.latestCandle = latestCandle;
    analysis.priceChangePercent = prevCandle
      ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
      : 0;

    // Calculate support/resistance
    analysis.supportResistance = this.calculateSupportResistance(priceData);

    if (timeframe === 'D1') {
      analysis.ranges = this.calculateDailyRanges(priceData);
      analysis.pivotPoints = this.calculateClassicPivotPoints(priceData);
    } else {
      analysis.ranges = null;
      analysis.pivotPoints = null;
    }

    // Regime detection (trend vs range)
    analysis.regime = this.detectRegime(analysis, priceData);

    // Volatility clustering
    analysis.volatility = this.analyzeVolatility(priceData, analysis);

    // Divergences (RSI, MACD)
    analysis.divergences = this.detectDivergences(priceData, analysis);

    // Volume/order-book heuristics
    analysis.volumePressure = this.computeVolumePressure(priceData);

    // Calculate timeframe score after regime context is available
    analysis.score = this.calculateTimeframeScore(analysis);
    analysis.direction = analysis.score > 12 ? 'BUY' : analysis.score < -12 ? 'SELL' : 'NEUTRAL';

    // Persist features via feature store if configured
    if (this.featureStore && typeof this.featureStore.recordFeatures === 'function') {
      const features = this.extractFeaturesForStore(analysis);
      try {
        this.featureStore.recordFeatures(pair || 'UNKNOWN', timeframe, features);
      } catch (e) {
        // ignore store errors
      }
    }

    return analysis;
  }

  calculateDailyRanges(priceData) {
    if (!Array.isArray(priceData) || priceData.length === 0) {
      return null;
    }
    const latest = priceData[priceData.length - 1] || null;
    const takeHighLow = (slice) => {
      if (!Array.isArray(slice) || slice.length === 0) {
        return null;
      }
      const highs = slice
        .map((candle) => Number(candle?.high))
        .filter((value) => Number.isFinite(value));
      const lows = slice
        .map((candle) => Number(candle?.low))
        .filter((value) => Number.isFinite(value));
      if (!highs.length || !lows.length) {
        return null;
      }
      return {
        high: Math.max(...highs),
        low: Math.min(...lows)
      };
    };

    const day =
      latest && Number.isFinite(Number(latest.high)) && Number.isFinite(Number(latest.low))
        ? { high: Number(latest.high), low: Number(latest.low) }
        : null;
    const week = takeHighLow(priceData.slice(-5));
    const month = takeHighLow(priceData.slice(-22));

    return { day, week, month };
  }

  calculateClassicPivotPoints(priceData) {
    if (!Array.isArray(priceData) || priceData.length < 2) {
      return null;
    }

    const prev = priceData[priceData.length - 2] || null;
    const high = prev ? Number(prev.high) : NaN;
    const low = prev ? Number(prev.low) : NaN;
    const close = prev ? Number(prev.close) : NaN;
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      return null;
    }

    const pivot = (high + low + close) / 3;
    const r1 = 2 * pivot - low;
    const s1 = 2 * pivot - high;
    const r2 = pivot + (high - low);
    const s2 = pivot - (high - low);

    return {
      pivot,
      r1,
      s1,
      r2,
      s2,
      basedOn: prev?.time ?? null
    };
  }

  /**
   * Fetch price data from real data sources
   */
  async fetchPriceData(pair, timeframe) {
    // Note: This will be injected by TradingEngine
    // For now, generate simulated data as fallback
    if (this.priceDataFetcher) {
      try {
        this.logger.debug({ pair, timeframe }, 'Technical analyzer fetching price data');
        const data = await this.priceDataFetcher.fetchPriceData(
          pair,
          timeframe,
          this.getBarCount(timeframe)
        );
        this.logger.debug(
          { pair, timeframe, barCount: data ? data.length : 0 },
          'Technical analyzer received price data'
        );
        if (data && data.length > 0) {
          return data;
        }
        this.logger.warn(
          { pair, timeframe },
          'Technical analyzer received no data, using fallback'
        );
      } catch (error) {
        this.logger.error(
          { err: error, pair, timeframe },
          'Technical analyzer price data fetch failed'
        );
      }
    } else {
      this.logger.warn({ pair, timeframe }, 'Technical analyzer price data fetcher not configured');
    }

    // Fallback to simulated data
    this.logger.debug({ pair, timeframe }, 'Technical analyzer generating simulated data');
    const bars = this.getBarCount(timeframe);
    const data = [];
    let basePrice = 1.1 + Math.random() * 0.1;

    for (let i = 0; i < bars; i++) {
      const change = (Math.random() - 0.5) * 0.001;
      basePrice += change;

      const high = basePrice + Math.random() * 0.0005;
      const low = basePrice - Math.random() * 0.0005;
      const open = i === 0 ? basePrice : data[i - 1].close;
      const close = basePrice;

      data.push({
        time: Date.now() - (bars - i) * this.getTimeframeMs(timeframe),
        open,
        high,
        low,
        close,
        volume: Math.random() * 10000
      });
    }

    return data;
  }

  /**
   * Set price data fetcher (injected by TradingEngine)
   */
  setPriceDataFetcher(fetcher) {
    this.priceDataFetcher = fetcher;
  }

  /**
   * Inject feature store for persisting computed features
   */
  setFeatureStore(store) {
    this.featureStore = store;
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(data, periods) {
    const result = {};

    periods.forEach((period) => {
      if (data.length < period) {
        result[period] = null;
        return;
      }

      const slice = data.slice(-period);
      const sum = slice.reduce((acc, candle) => acc + candle.close, 0);
      const sma = sum / period;
      const currentPrice = data[data.length - 1].close;

      result[period] = {
        value: sma,
        signal: currentPrice > sma ? 'bullish' : 'bearish',
        distance: ((currentPrice - sma) / sma) * 100
      };
    });

    return result;
  }

  /**
   * Calculate Exponential Moving Average
   */
  calculateEMA(data, periods) {
    const result = {};

    periods.forEach((period) => {
      if (data.length < period) {
        result[period] = null;
        return;
      }

      const multiplier = 2 / (period + 1);
      let ema = data.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;

      for (let i = period; i < data.length; i++) {
        ema = (data[i].close - ema) * multiplier + ema;
      }

      const currentPrice = data[data.length - 1].close;

      result[period] = {
        value: ema,
        signal: currentPrice > ema ? 'bullish' : 'bearish',
        distance: ((currentPrice - ema) / ema) * 100
      };
    });

    return result;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(data, period = 14) {
    if (data.length < period + 1) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return {
      value: rsi,
      signal: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral',
      trend: rsi > 50 ? 'bullish' : 'bearish'
    };
  }

  /**
   * Calculate MACD
   */
  calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = this.calculateEMAValue(data, fastPeriod);
    const slowEMA = this.calculateEMAValue(data, slowPeriod);
    const macdLine = fastEMA - slowEMA;

    // Calculate signal line (EMA of MACD)
    const macdData = data.slice(-signalPeriod).map(() => ({ close: macdLine }));
    const signalLine = this.calculateEMAValue(macdData, signalPeriod);
    const histogram = macdLine - signalLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
      crossover: histogram > 0 ? 'bullish' : 'bearish',
      strength: Math.abs(histogram)
    };
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(data, period = 20, stdDev = 2) {
    if (data.length < period) {
      return null;
    }

    const slice = data.slice(-period);
    const sma = slice.reduce((sum, candle) => sum + candle.close, 0) / period;

    const squaredDiffs = slice.map((candle) => Math.pow(candle.close - sma, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    const upper = sma + standardDeviation * stdDev;
    const lower = sma - standardDeviation * stdDev;
    const currentPrice = data[data.length - 1].close;

    const bandwidth = ((upper - lower) / sma) * 100;
    const position = ((currentPrice - lower) / (upper - lower)) * 100;

    return {
      upper,
      middle: sma,
      lower,
      bandwidth,
      position,
      signal: position > 80 ? 'overbought' : position < 20 ? 'oversold' : 'neutral'
    };
  }

  /**
   * Calculate Stochastic Oscillator
   */
  calculateStochastic(data, period = 14, kSmooth = 3, dSmooth = 3) {
    if (!Array.isArray(data) || data.length < period) {
      return null;
    }

    const rawK = [];
    for (let i = period - 1; i < data.length; i++) {
      const window = data.slice(i - period + 1, i + 1);
      const currentClose = window[window.length - 1].close;
      const lowestLow = Math.min(...window.map((candle) => candle.low));
      const highestHigh = Math.max(...window.map((candle) => candle.high));
      const range = highestHigh - lowestLow;
      const value =
        range === 0
          ? rawK.length
            ? rawK[rawK.length - 1]
            : 50
          : ((currentClose - lowestLow) / range) * 100;
      rawK.push(value);
    }

    if (rawK.length === 0) {
      return null;
    }

    const smooth = (values, length) => {
      const windowSize = Math.max(1, Math.min(length, values.length));
      const result = [];
      for (let i = windowSize - 1; i < values.length; i++) {
        const slice = values.slice(i - windowSize + 1, i + 1);
        const average = slice.reduce((sum, val) => sum + val, 0) / slice.length;
        result.push(average);
      }
      return result;
    };

    const smoothedK = smooth(rawK, kSmooth);
    if (smoothedK.length === 0) {
      return null;
    }
    const smoothedD = smooth(smoothedK, dSmooth);

    const k = smoothedK[smoothedK.length - 1];
    const d = smoothedD.length > 0 ? smoothedD[smoothedD.length - 1] : k;

    return {
      k,
      d,
      signal: k > 80 ? 'overbought' : k < 20 ? 'oversold' : 'neutral',
      crossover: k > d ? 'bullish' : 'bearish'
    };
  }

  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(data, period = 14) {
    if (data.length < period + 1) {
      return null;
    }

    const trueRanges = [];
    for (let i = 1; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const prevClose = data[i - 1].close;

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }

    const atr = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
    const currentPrice = data[data.length - 1].close;

    return {
      value: atr,
      percentage: (atr / currentPrice) * 100,
      volatility: atr > currentPrice * 0.01 ? 'high' : 'low'
    };
  }

  /**
   * Calculate ADX (Average Directional Index)
   */
  calculateADX(data, period = 14) {
    if (data.length < period + 1) {
      return null;
    }

    // Simplified ADX calculation
    let plusDM = 0;
    let minusDM = 0;

    for (let i = 1; i < Math.min(period, data.length); i++) {
      const highDiff = data[i].high - data[i - 1].high;
      const lowDiff = data[i - 1].low - data[i].low;

      if (highDiff > lowDiff && highDiff > 0) {
        plusDM += highDiff;
      }
      if (lowDiff > highDiff && lowDiff > 0) {
        minusDM += lowDiff;
      }
    }

    const atr = this.calculateATR(data, period);
    if (!atr) {
      return null;
    }

    const plusDI = (plusDM / period / atr.value) * 100;
    const minusDI = (minusDM / period / atr.value) * 100;
    const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;
    const adx = dx; // Simplified

    return {
      value: adx,
      plusDI,
      minusDI,
      trend: adx > 25 ? 'strong' : adx > 20 ? 'moderate' : 'weak',
      direction: plusDI > minusDI ? 'bullish' : 'bearish'
    };
  }

  /**
   * Calculate Ichimoku Cloud
   */
  calculateIchimoku(data) {
    if (data.length < 52) {
      return null;
    }

    const getHL = (period) => {
      const slice = data.slice(-period);
      const high = Math.max(...slice.map((c) => c.high));
      const low = Math.min(...slice.map((c) => c.low));
      return (high + low) / 2;
    };

    const tenkan = getHL(9);
    const kijun = getHL(26);
    const senkouA = (tenkan + kijun) / 2;
    const senkouB = getHL(52);
    const currentPrice = data[data.length - 1].close;

    return {
      tenkan,
      kijun,
      senkouA,
      senkouB,
      signal:
        currentPrice > Math.max(senkouA, senkouB)
          ? 'bullish'
          : currentPrice < Math.min(senkouA, senkouB)
            ? 'bearish'
            : 'neutral',
      cloudThickness: Math.abs(senkouA - senkouB)
    };
  }

  /**
   * Calculate Fibonacci Retracement Levels
   */
  calculateFibonacci(data) {
    if (data.length < 20) {
      return null;
    }

    const prices = data.map((c) => c.close);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const diff = high - low;

    const levels = {
      0: high,
      23.6: high - diff * 0.236,
      38.2: high - diff * 0.382,
      50.0: high - diff * 0.5,
      61.8: high - diff * 0.618,
      78.6: high - diff * 0.786,
      100: low
    };

    const currentPrice = data[data.length - 1].close;
    let nearestLevel = null;
    let minDistance = Infinity;

    Object.entries(levels).forEach(([level, price]) => {
      const distance = Math.abs(currentPrice - price);
      if (distance < minDistance) {
        minDistance = distance;
        nearestLevel = { level: parseFloat(level), price };
      }
    });

    return {
      levels,
      nearest: nearestLevel,
      high,
      low
    };
  }

  /**
   * Detect candlestick patterns
   */
  detectPatterns(data) {
    if (data.length < 3) {
      return [];
    }

    const patterns = [];
    const recent = data.slice(-5);

    // Doji
    if (this.isDoji(recent[recent.length - 1])) {
      patterns.push({ name: 'Doji', signal: 'reversal', strength: 60 });
    }

    // Spinning Top
    if (this.isSpinningTop(recent[recent.length - 1])) {
      patterns.push({ name: 'Spinning Top', signal: 'neutral', strength: 55 });
    }

    // Hammer
    if (this.isHammer(recent[recent.length - 1])) {
      patterns.push({ name: 'Hammer', signal: 'bullish', strength: 70 });
    }

    // Shooting Star
    if (this.isShootingStar(recent[recent.length - 1])) {
      patterns.push({ name: 'Shooting Star', signal: 'bearish', strength: 70 });
    }

    // Engulfing
    if (recent.length >= 2) {
      if (this.isBullishEngulfing(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', strength: 80 });
      }
      if (this.isBearishEngulfing(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', strength: 80 });
      }
      if (this.isBullishHarami(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Bullish Harami', signal: 'bullish', strength: 65 });
      }
      if (this.isBearishHarami(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Bearish Harami', signal: 'bearish', strength: 65 });
      }
      if (this.isPiercingLine(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Piercing Line', signal: 'bullish', strength: 82 });
      }
      if (this.isDarkCloudCover(recent[recent.length - 2], recent[recent.length - 1])) {
        patterns.push({ name: 'Dark Cloud Cover', signal: 'bearish', strength: 82 });
      }
    }

    // Morning Star / Evening Star
    if (recent.length >= 3) {
      if (this.isMorningStar(recent.slice(-3))) {
        patterns.push({ name: 'Morning Star', signal: 'bullish', strength: 85 });
      }
      if (this.isEveningStar(recent.slice(-3))) {
        patterns.push({ name: 'Evening Star', signal: 'bearish', strength: 85 });
      }
      if (this.isThreeWhiteSoldiers(recent.slice(-3))) {
        patterns.push({ name: 'Three White Soldiers', signal: 'bullish', strength: 88 });
      }
      if (this.isThreeBlackCrows(recent.slice(-3))) {
        patterns.push({ name: 'Three Black Crows', signal: 'bearish', strength: 88 });
      }
    }

    return patterns;
  }

  /**
   * Pattern detection helpers
   */
  isDoji(candle) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    return body < range * 0.1;
  }

  isHammer(candle) {
    const body = Math.abs(candle.close - candle.open);
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
    const upperShadow = candle.high - Math.max(candle.open, candle.close);
    return lowerShadow > body * 2 && upperShadow < body * 0.5;
  }

  isShootingStar(candle) {
    const body = Math.abs(candle.close - candle.open);
    const upperShadow = candle.high - Math.max(candle.open, candle.close);
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
    return upperShadow > body * 2 && lowerShadow < body * 0.5;
  }

  isBullishEngulfing(prev, current) {
    return (
      prev.close < prev.open &&
      current.close > current.open &&
      current.open < prev.close &&
      current.close > prev.open
    );
  }

  isBearishEngulfing(prev, current) {
    return (
      prev.close > prev.open &&
      current.close < current.open &&
      current.open > prev.close &&
      current.close < prev.open
    );
  }

  isMorningStar(candles) {
    return (
      candles[0].close < candles[0].open &&
      Math.abs(candles[1].close - candles[1].open) < (candles[0].high - candles[0].low) * 0.3 &&
      candles[2].close > candles[2].open &&
      candles[2].close > (candles[0].open + candles[0].close) / 2
    );
  }

  isEveningStar(candles) {
    return (
      candles[0].close > candles[0].open &&
      Math.abs(candles[1].close - candles[1].open) < (candles[0].high - candles[0].low) * 0.3 &&
      candles[2].close < candles[2].open &&
      candles[2].close < (candles[0].open + candles[0].close) / 2
    );
  }

  isSpinningTop(candle) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    if (range === 0) {
      return false;
    }
    const upperShadow = candle.high - Math.max(candle.open, candle.close);
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
    return (
      body > 0 && body <= range * 0.35 && upperShadow >= body * 0.8 && lowerShadow >= body * 0.8
    );
  }

  isBullishHarami(prev, current) {
    if (!prev || !current) {
      return false;
    }
    const prevBearish = prev.close < prev.open;
    const currentBullish = current.close > current.open;
    const bodyPrev = Math.abs(prev.close - prev.open);
    const bodyCurr = Math.abs(current.close - current.open);
    if (!prevBearish || !currentBullish || bodyPrev === 0) {
      return false;
    }
    return bodyCurr <= bodyPrev * 0.6 && current.open >= prev.close && current.close <= prev.open;
  }

  isBearishHarami(prev, current) {
    if (!prev || !current) {
      return false;
    }
    const prevBullish = prev.close > prev.open;
    const currentBearish = current.close < current.open;
    const bodyPrev = Math.abs(prev.close - prev.open);
    const bodyCurr = Math.abs(current.close - current.open);
    if (!prevBullish || !currentBearish || bodyPrev === 0) {
      return false;
    }
    return bodyCurr <= bodyPrev * 0.6 && current.open <= prev.close && current.close >= prev.open;
  }

  isPiercingLine(prev, current) {
    if (!prev || !current) {
      return false;
    }
    if (!(prev.close < prev.open && current.close > current.open)) {
      return false;
    }
    const prevBody = Math.abs(prev.open - prev.close);
    if (prevBody === 0) {
      return false;
    }
    const midpoint = prev.open - prevBody / 2;
    return current.open <= prev.close && current.close > midpoint && current.close < prev.open;
  }

  isDarkCloudCover(prev, current) {
    if (!prev || !current) {
      return false;
    }
    if (!(prev.close > prev.open && current.close < current.open)) {
      return false;
    }
    const prevBody = Math.abs(prev.close - prev.open);
    if (prevBody === 0) {
      return false;
    }
    const midpoint = prev.open + prevBody / 2;
    return current.open >= prev.close && current.close < midpoint && current.close > prev.open;
  }

  isThreeWhiteSoldiers(candles) {
    if (!Array.isArray(candles) || candles.length !== 3) {
      return false;
    }
    const bodies = candles.map((c) => Math.abs(c.close - c.open));
    if (bodies.some((body) => body === 0)) {
      return false;
    }
    const bullishRun = candles.every((candle, idx) => {
      if (candle.close <= candle.open) {
        return false;
      }
      if (idx === 0) {
        return true;
      }
      const prev = candles[idx - 1];
      return candle.open <= prev.close && candle.open >= prev.open && candle.close > prev.close;
    });
    if (!bullishRun) {
      return false;
    }
    const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
    return bodies.every((body) => body >= avgBody * 0.7);
  }

  isThreeBlackCrows(candles) {
    if (!Array.isArray(candles) || candles.length !== 3) {
      return false;
    }
    const bodies = candles.map((c) => Math.abs(c.close - c.open));
    if (bodies.some((body) => body === 0)) {
      return false;
    }
    const bearishRun = candles.every((candle, idx) => {
      if (candle.close >= candle.open) {
        return false;
      }
      if (idx === 0) {
        return true;
      }
      const prev = candles[idx - 1];
      return candle.open >= prev.close && candle.open <= prev.open && candle.close < prev.close;
    });
    if (!bearishRun) {
      return false;
    }
    const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
    return bodies.every((body) => body >= avgBody * 0.7);
  }

  /**
   * Calculate support and resistance levels
   */
  calculateSupportResistance(data) {
    const highs = data.map((c) => c.high);
    const lows = data.map((c) => c.low);

    const resistance = [this.findLevel(highs, 'high'), this.findLevel(highs.slice(0, -10), 'high')];

    const support = [this.findLevel(lows, 'low'), this.findLevel(lows.slice(0, -10), 'low')];

    return {
      resistance: resistance.sort((a, b) => b - a),
      support: support.sort((a, b) => b - a),
      currentPrice: data[data.length - 1].close
    };
  }

  findLevel(prices, type) {
    if (type === 'high') {
      return Math.max(...prices);
    } else {
      return Math.min(...prices);
    }
  }

  /**
   * Calculate timeframe score
   */
  calculateTimeframeScore(analysis) {
    let score = 0;

    // Moving averages
    if (analysis.indicators.sma) {
      Object.values(analysis.indicators.sma).forEach((sma) => {
        if (!sma) {
          return;
        }
        if (sma.signal === 'bullish') {
          score += 10;
        }
        if (sma.signal === 'bearish') {
          score -= 10;
        }
      });
    }

    if (analysis.indicators.ema) {
      Object.values(analysis.indicators.ema).forEach((ema) => {
        if (!ema) {
          return;
        }
        if (ema.signal === 'bullish') {
          score += 8;
        }
        if (ema.signal === 'bearish') {
          score -= 8;
        }
      });
    }

    // RSI
    if (analysis.indicators.rsi) {
      if (analysis.indicators.rsi.signal === 'oversold') {
        score += 15;
      }
      if (analysis.indicators.rsi.signal === 'overbought') {
        score -= 15;
      }
    }

    // MACD
    if (analysis.indicators.macd) {
      if (analysis.indicators.macd.crossover === 'bullish') {
        score += 18;
      }
      if (analysis.indicators.macd.crossover === 'bearish') {
        score -= 18;
      }
    }

    // Bollinger Bands
    if (analysis.indicators.bollinger) {
      const signal = analysis.indicators.bollinger.signal;
      if (signal === 'oversold') {
        score += 12;
      }
      if (signal === 'overbought') {
        score -= 12;
      }
    }

    // Stochastic
    if (analysis.indicators.stochastic) {
      const stoch = analysis.indicators.stochastic;
      if (stoch.signal === 'oversold') {
        score += 9;
      }
      if (stoch.signal === 'overbought') {
        score -= 9;
      }
      if (stoch.crossover === 'bullish') {
        score += 4;
      }
      if (stoch.crossover === 'bearish') {
        score -= 4;
      }
    }

    // Patterns
    analysis.patterns.forEach((pattern) => {
      if (pattern.signal === 'bullish') {
        score += pattern.strength / 5;
      }
      if (pattern.signal === 'bearish') {
        score -= pattern.strength / 5;
      }
    });

    // Ichimoku
    if (analysis.indicators.ichimoku) {
      const signal = analysis.indicators.ichimoku.signal;
      if (signal === 'bullish') {
        score += 14;
      }
      if (signal === 'bearish') {
        score -= 14;
      }
    }

    // Fibonacci proximity
    if (
      analysis.indicators.fibonacci &&
      analysis.indicators.fibonacci.nearest &&
      typeof analysis.lastPrice === 'number'
    ) {
      const nearest = analysis.indicators.fibonacci.nearest.level;
      if (nearest >= 61.8) {
        score += 6;
      } // Near deeper retracement support
      if (nearest <= 38.2) {
        score -= 6;
      } // Near resistance zone
    }

    // ADX (trend strength)
    if (analysis.indicators.adx) {
      const adx = analysis.indicators.adx;
      const trendBoost = adx.trend === 'strong' ? 1.35 : adx.trend === 'moderate' ? 1.15 : 1;
      if (adx.direction === 'bullish') {
        score *= trendBoost;
      }
      if (adx.direction === 'bearish') {
        score *= trendBoost;
      }
    }

    // Momentum boost from recent price change
    if (analysis.priceChangePercent) {
      score += analysis.priceChangePercent;
    }

    if (analysis.regime && analysis.regime.state) {
      const multiplier =
        analysis.regime.state === 'trend' ? 1.08 : analysis.regime.state === 'range' ? 0.96 : 1;
      score *= multiplier;
    }

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Calculate overall score from all timeframes
   */
  calculateOverallScore(timeframes) {
    const weights = { M15: 0.2, H1: 0.25, H4: 0.25, D1: 0.3 };
    let totalScore = 0;
    let totalWeight = 0;

    Object.entries(timeframes).forEach(([tf, analysis]) => {
      const weight = weights[tf] || 0.33;
      totalScore += analysis.score * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  getLatestPriceFromTimeframes(timeframes) {
    const priority = ['M15', 'H1', 'H4', 'D1'];
    for (const tf of priority) {
      const frame = timeframes[tf];
      if (frame && typeof frame.lastPrice === 'number') {
        return frame.lastPrice;
      }
    }
    return null;
  }

  buildDirectionSummary(timeframes) {
    const summary = { BUY: 0, SELL: 0, NEUTRAL: 0 };
    Object.values(timeframes).forEach((frame) => {
      if (frame && frame.direction) {
        summary[frame.direction] = (summary[frame.direction] || 0) + 1;
      }
    });
    return summary;
  }

  getFallbackTimeframeAnalysis(timeframe) {
    return {
      timeframe,
      indicators: {},
      patterns: [],
      supportResistance: {},
      ranges: null,
      pivotPoints: null,
      score: 0,
      lastPrice: null,
      latestCandle: null,
      priceChangePercent: 0,
      direction: 'NEUTRAL'
    };
  }

  /**
   * Determine overall trend
   */
  determineTrend(score) {
    if (score > 40) {
      return 'strong_bullish';
    }
    if (score > 15) {
      return 'bullish';
    }
    if (score < -40) {
      return 'strong_bearish';
    }
    if (score < -15) {
      return 'bearish';
    }
    return 'neutral';
  }

  /**
   * Generate trading signals
   */
  generateSignals(timeframes) {
    const signals = [];

    Object.entries(timeframes).forEach(([tf, analysis]) => {
      if (Math.abs(analysis.score) > 25) {
        signals.push({
          timeframe: tf,
          type: analysis.score > 0 ? 'BUY' : 'SELL',
          strength: Math.abs(analysis.score),
          confidence: Math.min(Math.abs(analysis.score), 95),
          price: analysis.lastPrice,
          direction: analysis.direction,
          patterns: analysis.patterns.map((p) => p.name)
        });
      }
    });

    return signals;
  }

  detectRegime(analysis, priceData) {
    const adxVal = analysis.indicators?.adx?.value ?? null;
    const bb = analysis.indicators?.bollinger;
    const bandwidth = Number.isFinite(bb?.bandwidth)
      ? bb.bandwidth
      : (() => {
          if (!bb || typeof bb.upper !== 'number' || typeof bb.lower !== 'number' || !bb.middle) {
            return null;
          }
          const mid = bb.middle;
          const width = bb.upper - bb.lower;
          return mid !== 0 ? (width / mid) * 100 : null;
        })();

    const window = Math.min(120, priceData.length);
    const recent = priceData.slice(-window);
    let slopePct = 0;
    let slopeAngle = 0;
    if (recent.length >= 20) {
      const closes = recent.map((candle) => candle.close);
      const times = recent.map((candle, idx) => idx);
      const { slope } = this.linearRegression(times, closes);
      const latest = closes[closes.length - 1] || 1;
      slopePct = latest ? (slope / latest) * recent.length : 0;
      slopeAngle = Math.atan(slopePct) * (180 / Math.PI);
    }

    const momentum = Number.isFinite(analysis.priceChangePercent) ? analysis.priceChangePercent : 0;
    const slopeStrength = Math.min(1, Math.abs(slopePct) * 15);
    const adxStrength = Number.isFinite(adxVal) ? Math.min(1, adxVal / 50) : 0;
    const momentumStrength = Math.min(1, Math.abs(momentum) / 10);
    const composite = slopeStrength * 0.45 + adxStrength * 0.4 + momentumStrength * 0.15;

    let state = 'transition';
    if ((Number.isFinite(adxVal) && adxVal >= 25) || Math.abs(slopePct) >= 0.018) {
      state = 'trend';
    } else if (Number.isFinite(bandwidth) && bandwidth <= 6.5 && Math.abs(slopePct) < 0.012) {
      state = 'range';
    }

    const confidenceBoost = Number.isFinite(bandwidth)
      ? state === 'trend'
        ? bandwidth >= 12
          ? 0.12
          : bandwidth >= 9
            ? 0.07
            : 0
        : bandwidth <= 6
          ? 0.1
          : 0
      : 0;
    const confidence = Math.max(10, Math.min(100, Math.round((composite + confidenceBoost) * 100)));

    return {
      state,
      confidence,
      adx: adxVal,
      bandwidth: Number.isFinite(bandwidth) ? Number(bandwidth.toFixed(2)) : null,
      slope: Number(slopePct.toFixed(4)),
      slopeAngle: Number(slopeAngle.toFixed(2)),
      momentum: Number(momentum.toFixed(2)),
      sampleSize: recent.length
    };
  }

  analyzeVolatility(data, analysis) {
    const atr = analysis.indicators?.atr?.value ?? null;
    const window = Math.min(60, data.length);
    if (window < 15) {
      return { state: 'unknown', current: atr, clusters: [], volatilityScore: 0 };
    }

    const slice = data.slice(-window);
    const returns = [];
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1];
      const curr = slice[i];
      const base = prev.close || 1;
      returns.push((curr.close - prev.close) / base);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    const meanAbs = returns.reduce((acc, r) => acc + Math.abs(r), 0) / returns.length;
    const atrPerc =
      Number.isFinite(atr) && slice[slice.length - 1].close
        ? atr / slice[slice.length - 1].close
        : 0;

    const volScore = Math.min(1.2, Math.abs(std) * 12 + atrPerc * 4 + meanAbs * 6);
    const thresholdHigh = meanAbs * 1.8;
    const thresholdLow = meanAbs * 0.7;

    const clusters = [];
    let current = null;
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1];
      const curr = slice[i];
      const change = (curr.close - prev.close) / (prev.close || 1);
      const magnitude = Math.abs(change);
      const tag =
        magnitude > thresholdHigh ? 'volatile' : magnitude < thresholdLow ? 'calm' : 'normal';
      if (!current || current.state !== tag) {
        if (current) {
          clusters.push(current);
        }
        current = {
          state: tag,
          start: prev.time,
          end: curr.time,
          count: 1,
          avgMagnitude: magnitude
        };
      } else {
        current.end = curr.time;
        current.count++;
        current.avgMagnitude =
          (current.avgMagnitude * (current.count - 1) + magnitude) / current.count;
      }
    }
    if (current) {
      clusters.push(current);
    }

    const latestCluster = clusters[clusters.length - 1];
    const state = latestCluster ? latestCluster.state : 'normal';
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    const range = high - low;

    return {
      state,
      current: atr,
      std: Number(std.toFixed(6)),
      meanAbs: Number(meanAbs.toFixed(6)),
      atrPercentage: Number((atrPerc * 100).toFixed(3)),
      range,
      volatilityScore: Number((volScore * 100).toFixed(1)),
      clusters
    };
  }

  detectDivergences(data, analysis) {
    const window = Math.min(120, data.length);
    if (window < 25) {
      return [];
    }

    const slice = data.slice(-window);
    const swings = this.identifySwings(slice, 4);
    const rsiSeries = Array.isArray(analysis.indicators?.rsiSeries)
      ? analysis.indicators.rsiSeries
      : [];
    const macdSeries = Array.isArray(analysis.indicators?.macdSeries)
      ? analysis.indicators.macdSeries
      : [];

    const getSeriesValue = (series, timestamp) => {
      if (!Array.isArray(series) || series.length === 0) {
        return null;
      }
      let closest = series[series.length - 1];
      let minDiff = Math.abs((closest?.time ?? 0) - timestamp);
      for (const entry of series) {
        const diff = Math.abs(entry.time - timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closest = entry;
        }
        if (diff === 0) {
          break;
        }
      }
      return closest?.value ?? null;
    };

    const divergences = [];

    const evaluate = (first, second, direction) => {
      if (!first || !second) {
        return;
      }
      const priceDelta = (second.price - first.price) / (first.price || 1);
      const meaningfulMove = Math.abs(priceDelta) >= 0.0015;
      if (!meaningfulMove) {
        return;
      }

      const rsiPrev = getSeriesValue(rsiSeries, first.time);
      const rsiCurr = getSeriesValue(rsiSeries, second.time);
      const macdPrev = getSeriesValue(macdSeries, first.time);
      const macdCurr = getSeriesValue(macdSeries, second.time);

      if (direction === 'bearish' && priceDelta > 0) {
        if (Number.isFinite(rsiPrev) && Number.isFinite(rsiCurr) && rsiCurr < rsiPrev - 1.5) {
          const diff = rsiPrev - rsiCurr;
          divergences.push({
            type: 'bearish',
            indicator: 'RSI',
            confidence: Math.min(92, Math.round(45 + diff * 1.8)),
            price: { previous: first.price, current: second.price },
            oscillator: {
              previous: Number(rsiPrev.toFixed(2)),
              current: Number(rsiCurr.toFixed(2))
            },
            occurredAt: { previous: first.time, current: second.time }
          });
        }
        if (
          Number.isFinite(macdPrev) &&
          Number.isFinite(macdCurr) &&
          macdCurr < macdPrev - 0.0005
        ) {
          const diff = (macdPrev - macdCurr) * 1000;
          divergences.push({
            type: 'bearish',
            indicator: 'MACD',
            confidence: Math.min(95, Math.round(50 + diff)),
            price: { previous: first.price, current: second.price },
            oscillator: {
              previous: Number(macdPrev.toFixed(5)),
              current: Number(macdCurr.toFixed(5))
            },
            occurredAt: { previous: first.time, current: second.time }
          });
        }
      }

      if (direction === 'bullish' && priceDelta < 0) {
        if (Number.isFinite(rsiPrev) && Number.isFinite(rsiCurr) && rsiCurr > rsiPrev + 1.5) {
          const diff = rsiCurr - rsiPrev;
          divergences.push({
            type: 'bullish',
            indicator: 'RSI',
            confidence: Math.min(92, Math.round(45 + diff * 1.8)),
            price: { previous: first.price, current: second.price },
            oscillator: {
              previous: Number(rsiPrev.toFixed(2)),
              current: Number(rsiCurr.toFixed(2))
            },
            occurredAt: { previous: first.time, current: second.time }
          });
        }
        if (
          Number.isFinite(macdPrev) &&
          Number.isFinite(macdCurr) &&
          macdCurr > macdPrev + 0.0005
        ) {
          const diff = (macdCurr - macdPrev) * 1000;
          divergences.push({
            type: 'bullish',
            indicator: 'MACD',
            confidence: Math.min(95, Math.round(50 + diff)),
            price: { previous: first.price, current: second.price },
            oscillator: {
              previous: Number(macdPrev.toFixed(5)),
              current: Number(macdCurr.toFixed(5))
            },
            occurredAt: { previous: first.time, current: second.time }
          });
        }
      }
    };

    const highs = swings.highs.slice(-3);
    if (highs.length >= 2) {
      evaluate(highs[highs.length - 2], highs[highs.length - 1], 'bearish');
    }

    const lows = swings.lows.slice(-3);
    if (lows.length >= 2) {
      evaluate(lows[lows.length - 2], lows[lows.length - 1], 'bullish');
    }

    return divergences;
  }

  computeVolumePressure(data) {
    if (!data || data.length < 10) {
      return { pressure: 0, state: 'neutral', sampleSize: data ? data.length : 0 };
    }

    const window = data.slice(-40);
    const volumes = window.map((c) => c.volume || 0);
    const avgVolume = volumes.reduce((acc, v) => acc + v, 0) / Math.max(1, volumes.length);
    const variance =
      volumes.reduce((acc, v) => acc + Math.pow(v - avgVolume, 2), 0) / Math.max(1, volumes.length);
    const stdVolume = Math.sqrt(variance);

    let upVol = 0;
    let downVol = 0;
    let rangeUp = 0;
    let rangeDown = 0;
    window.forEach((c) => {
      const vol = c.volume || 0;
      if (c.close >= c.open) {
        upVol += vol;
        rangeUp += c.high - c.low;
      } else {
        downVol += vol;
        rangeDown += c.high - c.low;
      }
    });

    const totalVol = upVol + downVol;
    const imbalance =
      totalVol > 0
        ? (upVol - downVol) / totalVol
        : (rangeUp - rangeDown) / Math.max(1e-6, rangeUp + rangeDown);
    const state = imbalance > 0.12 ? 'buying' : imbalance < -0.12 ? 'selling' : 'neutral';
    const volumeRate = totalVol > 0 && avgVolume > 0 ? totalVol / (avgVolume * volumes.length) : 1;
    const zScore =
      stdVolume > 0
        ? (totalVol - avgVolume * volumes.length) /
          (stdVolume * Math.sqrt(Math.max(1, volumes.length)))
        : 0;
    const priceDelta = window[window.length - 1].close - window[0].close;
    const priceDeltaPct = priceDelta / (window[0].close || 1);

    return {
      pressure: Number((imbalance * 100).toFixed(2)),
      state,
      imbalance: Number(imbalance.toFixed(4)),
      volumeRate: Number(volumeRate.toFixed(2)),
      volumeZScore: Number(zScore.toFixed(2)),
      priceDeltaPct: Number((priceDeltaPct * 100).toFixed(2)),
      sampleSize: window.length
    };
  }

  calculateRSISeries(data, period = 14) {
    if (!Array.isArray(data) || data.length <= period) {
      return [];
    }

    const series = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    const computeRsi = (gain, loss) => {
      if (loss === 0 && gain === 0) {
        return 50;
      }
      if (loss === 0) {
        return 100;
      }
      if (gain === 0) {
        return 0;
      }
      const rs = gain / loss;
      return 100 - 100 / (1 + rs);
    };

    let rsi = computeRsi(avgGain, avgLoss);
    series.push({ time: data[period].time, value: Number(rsi.toFixed(2)) });

    for (let i = period + 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi = computeRsi(avgGain, avgLoss);
      series.push({ time: data[i].time, value: Number(rsi.toFixed(2)) });
    }

    return series;
  }

  calculateMACDSeries(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!Array.isArray(data) || data.length < slowPeriod + signalPeriod) {
      return [];
    }

    const closes = data.map((candle) => candle.close);
    const macdSeries = [];
    const multiplierFast = 2 / (fastPeriod + 1);
    const multiplierSlow = 2 / (slowPeriod + 1);
    const multiplierSignal = 2 / (signalPeriod + 1);

    let emaFast = closes.slice(0, fastPeriod).reduce((sum, price) => sum + price, 0) / fastPeriod;
    for (let i = fastPeriod; i < slowPeriod; i++) {
      const price = closes[i];
      emaFast = (price - emaFast) * multiplierFast + emaFast;
    }

    let emaSlow = closes.slice(0, slowPeriod).reduce((sum, price) => sum + price, 0) / slowPeriod;
    const macdValues = [];
    let signal = null;

    for (let i = slowPeriod; i < closes.length; i++) {
      const price = closes[i];
      emaFast = (price - emaFast) * multiplierFast + emaFast;
      emaSlow = (price - emaSlow) * multiplierSlow + emaSlow;
      const macdValue = emaFast - emaSlow;
      macdValues.push(macdValue);

      if (macdValues.length === signalPeriod) {
        signal = macdValues.reduce((a, b) => a + b, 0) / signalPeriod;
      } else if (macdValues.length > signalPeriod && signal !== null) {
        signal = (macdValue - signal) * multiplierSignal + signal;
      }

      const histogram = signal !== null ? macdValue - signal : null;
      macdSeries.push({
        time: data[i].time,
        value: Number(macdValue.toFixed(6)),
        signal: signal !== null ? Number(signal.toFixed(6)) : null,
        histogram: histogram !== null ? Number(histogram.toFixed(6)) : null
      });
    }

    return macdSeries;
  }

  identifySwings(data, lookback = 3) {
    const highs = [];
    const lows = [];
    if (!Array.isArray(data) || data.length === 0) {
      return { highs, lows };
    }

    const window = Math.max(1, lookback);
    for (let i = window; i < data.length - window; i++) {
      const current = data[i];
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= window; j++) {
        if (data[i - j].high >= current.high || data[i + j].high > current.high) {
          isHigh = false;
        }
        if (data[i - j].low <= current.low || data[i + j].low < current.low) {
          isLow = false;
        }
        if (!isHigh && !isLow) {
          break;
        }
      }

      if (isHigh) {
        highs.push({ time: current.time, price: current.high, index: i });
      }
      if (isLow) {
        lows.push({ time: current.time, price: current.low, index: i });
      }
    }

    return { highs, lows };
  }

  linearRegression(xValues, yValues) {
    if (
      !Array.isArray(xValues) ||
      !Array.isArray(yValues) ||
      xValues.length !== yValues.length ||
      xValues.length === 0
    ) {
      return { slope: 0, intercept: 0, rSquared: 0 };
    }

    const n = xValues.length;
    const meanX = xValues.reduce((a, b) => a + b, 0) / n;
    const meanY = yValues.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = xValues[i] - meanX;
      numerator += xDiff * (yValues[i] - meanY);
      denominator += xDiff * xDiff;
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;

    let ssTot = 0;
    let ssRes = 0;

    for (let i = 0; i < n; i++) {
      const predicted = slope * xValues[i] + intercept;
      ssTot += Math.pow(yValues[i] - meanY, 2);
      ssRes += Math.pow(yValues[i] - predicted, 2);
    }

    const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return { slope, intercept, rSquared };
  }

  extractFeaturesForStore(analysis) {
    const ind = analysis.indicators || {};
    const bb = ind.bollinger || {};
    return {
      pair: analysis.pair || null,
      timeframe: analysis.timeframe || null,
      timestamp: analysis.latestCandle?.time || Date.now(),
      price: analysis.lastPrice,
      score: analysis.score,
      direction: analysis.direction,
      rsi: ind.rsi?.value ?? null,
      macd: ind.macd?.histogram ?? null,
      adx: ind.adx?.value ?? null,
      atr: ind.atr?.value ?? null,
      bbBandwidth:
        typeof bb.upper === 'number' && typeof bb.lower === 'number' && bb.middle
          ? Number((((bb.upper - bb.lower) / bb.middle) * 100).toFixed(4))
          : null,
      regime: analysis.regime?.state || null,
      regimeConfidence: analysis.regime?.confidence || null,
      regimeSlope: analysis.regime?.slope ?? null,
      regimeSlopeAngle: analysis.regime?.slopeAngle ?? null,
      volatilityState: analysis.volatility?.state || null,
      volatilityScore: analysis.volatility?.volatilityScore ?? null,
      volumePressure: analysis.volumePressure?.pressure ?? null,
      volumeImbalance: analysis.volumePressure?.imbalance ?? null,
      volumeZScore: analysis.volumePressure?.volumeZScore ?? null,
      volumeRate: analysis.volumePressure?.volumeRate ?? null,
      priceDeltaPct: analysis.volumePressure?.priceDeltaPct ?? null,
      patternCount: Array.isArray(analysis.patterns) ? analysis.patterns.length : 0,
      divergenceCount: Array.isArray(analysis.divergences) ? analysis.divergences.length : 0
    };
  }

  aggregateRegime(timeframes) {
    const entries = Object.entries(timeframes)
      .filter(([, tf]) => tf?.regime)
      .map(([timeframe, tf]) => ({ timeframe, ...tf.regime }));
    if (entries.length === 0) {
      return null;
    }

    const trendScore = entries.reduce((acc, entry) => {
      if (entry.state === 'trend') {
        return acc + entry.confidence;
      }
      if (entry.state === 'range') {
        return acc - entry.confidence;
      }
      return acc;
    }, 0);
    const averageConfidence =
      entries.reduce((acc, entry) => acc + (entry.confidence || 0), 0) / entries.length;
    const confidence = Math.min(
      100,
      Math.max(
        15,
        Math.round(Math.max(Math.abs(trendScore) / entries.length, averageConfidence * 0.75))
      )
    );
    const avgBandwidth = (() => {
      const vals = entries.map((e) => e.bandwidth).filter((v) => Number.isFinite(v));
      if (vals.length === 0) {
        return null;
      }
      return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
    })();
    const avgSlope = (() => {
      const vals = entries.map((e) => e.slope).filter((v) => Number.isFinite(v));
      if (vals.length === 0) {
        return null;
      }
      return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
    })();
    const avgSlopeAngle = (() => {
      const vals = entries.map((e) => e.slopeAngle).filter((v) => Number.isFinite(v));
      if (vals.length === 0) {
        return null;
      }
      return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
    })();

    const summaryEntries = entries
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 4)
      .map(({ timeframe, state, confidence: cf, bandwidth, slope, slopeAngle, momentum }) => ({
        timeframe,
        state,
        confidence: cf,
        bandwidth,
        slope,
        slopeAngle,
        momentum
      }));

    let state = 'transition';
    if (trendScore > confidence * entries.length * 0.15) {
      state = 'trend';
    } else if (trendScore < -confidence * entries.length * 0.15) {
      state = 'range';
    }

    return {
      state,
      confidence,
      averageBandwidth: avgBandwidth,
      averageSlope: avgSlope,
      averageSlopeAngle: avgSlopeAngle,
      timeframes: summaryEntries
    };
  }

  aggregateVolatility(timeframes) {
    const entries = Object.entries(timeframes)
      .filter(([, tf]) => tf?.volatility)
      .map(([timeframe, tf]) => ({ timeframe, ...tf.volatility }));
    if (entries.length === 0) {
      return null;
    }

    const score = entries.reduce((acc, entry) => {
      if (entry.state === 'volatile') {
        return acc + 2 * (entry.count || 1);
      }
      if (entry.state === 'calm') {
        return acc - 1 * (entry.count || 1);
      }
      return acc;
    }, 0);

    const atrValues = entries.map((entry) => entry.current).filter((v) => Number.isFinite(v));
    const stdValues = entries.map((entry) => entry.std).filter((v) => Number.isFinite(v));
    const volScores = entries
      .map((entry) => entry.volatilityScore)
      .filter((v) => Number.isFinite(v));

    const averageScore = volScores.length
      ? Number((volScores.reduce((a, b) => a + b, 0) / volScores.length).toFixed(1))
      : null;

    const averageAtr = atrValues.length
      ? Number((atrValues.reduce((a, b) => a + b, 0) / atrValues.length).toFixed(6))
      : null;
    const averageStd = stdValues.length
      ? Number((stdValues.reduce((a, b) => a + b, 0) / stdValues.length).toFixed(6))
      : null;

    const summaryEntries = entries
      .sort((a, b) => (b.std || 0) - (a.std || 0))
      .slice(0, 4)
      .map(({ timeframe, state, std, current, volatilityScore, range }) => ({
        timeframe,
        state,
        std,
        atr: current,
        volatilityScore,
        range
      }));

    return {
      state: score >= 0 ? 'volatile' : 'calm',
      averageATR: averageAtr,
      averageStd: averageStd,
      averageScore,
      timeframes: summaryEntries
    };
  }

  aggregateDivergences(timeframes) {
    const bullish = [];
    const bearish = [];

    Object.entries(timeframes).forEach(([timeframe, tf]) => {
      if (!Array.isArray(tf?.divergences)) {
        return;
      }
      tf.divergences.forEach((div) => {
        const entry = {
          timeframe,
          indicator: div.indicator,
          confidence: div.confidence,
          price: div.price || null,
          oscillator: div.oscillator || null,
          occurredAt: div.occurredAt || null
        };
        if (div.type === 'bullish') {
          bullish.push(entry);
        } else if (div.type === 'bearish') {
          bearish.push(entry);
        }
      });
    });

    return {
      bullish: bullish.slice(0, 5),
      bearish: bearish.slice(0, 5),
      total: bullish.length + bearish.length
    };
  }

  aggregateVolumePressure(timeframes) {
    const entries = Object.entries(timeframes)
      .filter(([, tf]) => tf?.volumePressure)
      .map(([timeframe, tf]) => ({ timeframe, ...tf.volumePressure }));
    if (entries.length === 0) {
      return null;
    }

    const averagePressure =
      entries.reduce((acc, entry) => acc + (Number(entry.pressure) || 0), 0) / entries.length;
    const stateScore = entries.reduce((acc, entry) => {
      if (entry.state === 'buying') {
        return acc + 1;
      }
      if (entry.state === 'selling') {
        return acc - 1;
      }
      return acc;
    }, 0);
    const avgVolumeRate = entries
      .map((entry) => entry.volumeRate)
      .filter((v) => Number.isFinite(v));
    const avgZScore = entries.map((entry) => entry.volumeZScore).filter((v) => Number.isFinite(v));

    const summaryEntries = entries
      .sort((a, b) => Math.abs(b.pressure ?? 0) - Math.abs(a.pressure ?? 0))
      .slice(0, 4)
      .map(({ timeframe, state, pressure, volumeRate, volumeZScore, priceDeltaPct }) => ({
        timeframe,
        state,
        pressure,
        volumeRate,
        volumeZScore,
        priceDeltaPct
      }));

    return {
      state: stateScore > 0 ? 'buying' : stateScore < 0 ? 'selling' : 'neutral',
      averagePressure: Number(averagePressure.toFixed(2)),
      averageVolumeRate: avgVolumeRate.length
        ? Number((avgVolumeRate.reduce((a, b) => a + b, 0) / avgVolumeRate.length).toFixed(2))
        : null,
      averageVolumeZScore: avgZScore.length
        ? Number((avgZScore.reduce((a, b) => a + b, 0) / avgZScore.length).toFixed(2))
        : null,
      timeframes: summaryEntries
    };
  }

  /**
   * Helper: Calculate EMA value
   */
  calculateEMAValue(data, period) {
    if (data.length < period) {
      return 0;
    }

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i].close - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Helper: Get bar count for timeframe
   */
  getBarCount(timeframe) {
    const counts = {
      M1: 500,
      M5: 400,
      M15: 300,
      M30: 250,
      H1: 200,
      H4: 150,
      D1: 100
    };
    return counts[timeframe] || 200;
  }

  /**
   * Helper: Get timeframe in milliseconds
   */
  getTimeframeMs(timeframe) {
    const ms = {
      M1: 60000,
      M5: 300000,
      M15: 900000,
      M30: 1800000,
      H1: 3600000,
      H4: 14400000,
      D1: 86400000
    };
    return ms[timeframe] || 3600000;
  }

  /**
   * Get default analysis
   */
  getDefaultAnalysis(pair) {
    return {
      pair,
      timestamp: Date.now(),
      timeframes: {},
      overallScore: 0,
      trend: 'neutral',
      strength: 0,
      signals: []
    };
  }

  /**
   * Cache management
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}

export default TechnicalAnalyzer;
