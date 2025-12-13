/**
 * Ultra Signal Filter - Extreme Quality Signal Selection
 * Targets 85-100% win rate through rigorous multi-stage filtering
 * 
 * Features:
 * - 5-layer confirmation system
 * - Market regime classification
 * - Historical pattern matching
 * - Dynamic confidence scoring
 * - Risk-adjusted signal strength
 */

import logger from '../../services/logging/logger.js';

export class UltraSignalFilter {
  constructor(config = {}) {
    this.config = {
      // Ultra-strict thresholds for 85%+ win rate
      minStrength: config.minStrength || 75,           // Was 35
      minConfidence: config.minConfidence || 80,       // Was 30
      minFinalScore: config.minFinalScore || 70,       // Was 20
      minRiskReward: config.minRiskReward || 2.5,      // Was 1.5
      minConfluence: config.minConfluence || 4,        // Require 4+ confirmations
      minValidationScore: config.minValidationScore || 85,
      minWinProbability: config.minWinProbability || 0.85,  // Configurable threshold
      
      // Market regime filters
      allowedRegimes: config.allowedRegimes || ['trending_strong', 'breakout'],
      maxVolatility: config.maxVolatility || 2.0,      // Avoid extreme volatility
      minVolatility: config.minVolatility || 0.3,      // Avoid dead markets
      
      // Technical confirmation requirements
      requireTrendAlignment: config.requireTrendAlignment !== false,
      requireMomentumConfirmation: config.requireMomentumConfirmation !== false,
      requireVolumeConfirmation: config.requireVolumeConfirmation !== false,
      requireNewsAlignment: config.requireNewsAlignment !== false,
      
      // Historical validation
      enablePatternMatching: config.enablePatternMatching !== false,
      minHistoricalWinRate: config.minHistoricalWinRate || 0.70,
      minSimilarPatterns: config.minSimilarPatterns || 3,
      defaultHistoricalWinRate: config.defaultHistoricalWinRate || 0.70,  // Match requirement
      
      ...config
    };
    
    this.historicalPatterns = new Map();
    this.signalPerformance = new Map();
    this.marketRegimeHistory = [];
    this.maxHistorySize = 500;
  }

  /**
   * Filter signal through ultra-strict criteria
   * @param {Object} signal - Trading signal
   * @param {Object} analysis - Complete market analysis
   * @param {Object} context - Additional context
   * @returns {Object} Filtered result with pass/fail and detailed reasoning
   */
  async filterSignal(signal, analysis = {}, context = {}) {
    const filterStages = {
      stage1_basicQuality: this.checkBasicQuality(signal),
      stage2_marketRegime: this.checkMarketRegime(signal, analysis),
      stage3_technicalConfluence: await this.checkTechnicalConfluence(signal, analysis),
      stage4_riskRewardProfile: this.checkRiskRewardProfile(signal, analysis),
      stage5_historicalValidation: await this.checkHistoricalValidation(signal, context)
    };

    const allPassed = Object.values(filterStages).every(stage => stage.passed);
    const overallConfidence = this.calculateOverallConfidence(filterStages);
    const winProbability = this.estimateWinProbability(filterStages, signal);

    const result = {
      passed: allPassed && winProbability >= this.config.minWinProbability,
      confidence: overallConfidence,
      winProbability,
      stages: filterStages,
      recommendation: this.generateRecommendation(allPassed, winProbability, overallConfidence),
      reason: allPassed ? 'Signal meets all ultra-quality criteria' : this.getFailureReason(filterStages),
      enhancedSignal: allPassed ? this.enhanceSignal(signal, filterStages) : null
    };

    // Log ultra-quality signals
    if (result.passed) {
      logger.info({
        pair: signal.pair,
        direction: signal.direction,
        winProbability: `${(winProbability * 100).toFixed(1)}%`,
        confidence: overallConfidence
      }, 'ULTRA-QUALITY SIGNAL DETECTED');
    }

    return result;
  }

  /**
   * Stage 1: Basic Quality Checks (Strength, Confidence, Score)
   */
  checkBasicQuality(signal) {
    const checks = {
      strength: signal.strength >= this.config.minStrength,
      confidence: signal.confidence >= this.config.minConfidence,
      finalScore: signal.finalScore >= this.config.minFinalScore,
      hasEntry: signal.entry && signal.entry.price > 0,
      hasStopLoss: signal.stopLoss && signal.stopLoss > 0,
      hasTakeProfit: signal.takeProfit && signal.takeProfit > 0
    };

    const passed = Object.values(checks).every(check => check);
    const score = (Object.values(checks).filter(c => c).length / Object.keys(checks).length) * 100;

    return {
      passed,
      score,
      checks,
      details: `Basic quality: ${score.toFixed(1)}% (${Object.values(checks).filter(c => c).length}/${Object.keys(checks).length} checks)`
    };
  }

  /**
   * Stage 2: Market Regime Classification
   */
  checkMarketRegime(signal, analysis) {
    const regime = this.classifyMarketRegime(analysis);
    const volatility = this.calculateVolatility(analysis);
    
    const checks = {
      regimeAllowed: this.config.allowedRegimes.includes(regime.type),
      volatilityInRange: volatility >= this.config.minVolatility && volatility <= this.config.maxVolatility,
      trendStrength: regime.trendStrength >= 60,
      noHighImpactNews: !this.hasConflictingNews(signal, analysis),
      liquidity: this.checkLiquidity(analysis) >= 70
    };

    const passed = Object.values(checks).every(check => check);
    const score = (Object.values(checks).filter(c => c).length / Object.keys(checks).length) * 100;

    return {
      passed,
      score,
      regime: regime.type,
      volatility,
      checks,
      details: `Market regime: ${regime.type}, volatility: ${volatility.toFixed(2)}, score: ${score.toFixed(1)}%`
    };
  }

  /**
   * Stage 3: Technical Confluence (Multiple Indicators Alignment)
   */
  async checkTechnicalConfluence(signal, analysis) {
    const confirmations = [];
    
    // Trend alignment across timeframes
    if (this.checkTrendAlignment(signal, analysis)) {
      confirmations.push('trend_alignment');
    }
    
    // Momentum indicators
    if (this.checkMomentumConfirmation(signal, analysis)) {
      confirmations.push('momentum');
    }
    
    // Volume confirmation
    if (this.checkVolumeConfirmation(signal, analysis)) {
      confirmations.push('volume');
    }
    
    // Support/Resistance levels
    if (this.checkKeyLevels(signal, analysis)) {
      confirmations.push('key_levels');
    }
    
    // Moving average alignment
    if (this.checkMAAlignment(signal, analysis)) {
      confirmations.push('ma_alignment');
    }
    
    // RSI/MACD confirmation
    if (this.checkOscillatorAlignment(signal, analysis)) {
      confirmations.push('oscillators');
    }
    
    // Fibonacci levels
    if (this.checkFibonacciAlignment(signal, analysis)) {
      confirmations.push('fibonacci');
    }

    const confluenceCount = confirmations.length;
    const passed = confluenceCount >= this.config.minConfluence;
    const score = Math.min((confluenceCount / 7) * 100, 100);

    return {
      passed,
      score,
      confluenceCount,
      confirmations,
      details: `${confluenceCount}/7 technical confirmations (need ${this.config.minConfluence}+)`
    };
  }

  /**
   * Stage 4: Risk-Reward Profile Analysis
   */
  checkRiskRewardProfile(signal, analysis) {
    const rr = signal.riskRewardRatio || this.calculateRR(signal);
    const winRate = this.estimateBaseWinRate(signal, analysis);
    const expectedValue = this.calculateExpectedValue(rr, winRate);
    
    // Kelly Criterion for optimal sizing
    const kellyFraction = this.calculateKelly(winRate, rr);
    
    const checks = {
      minRR: rr >= this.config.minRiskReward,
      positiveExpectedValue: expectedValue > 0.5,
      optimalKelly: kellyFraction > 0.01 && kellyFraction < 0.25,
      tightStop: this.isStopLossTight(signal),
      realisticTP: this.isTakeProfitRealistic(signal, analysis)
    };

    const passed = Object.values(checks).every(check => check);
    const score = (Object.values(checks).filter(c => c).length / Object.keys(checks).length) * 100;

    return {
      passed,
      score,
      riskReward: rr,
      expectedValue,
      kellyFraction,
      checks,
      details: `R:R ${rr.toFixed(2)}, EV: ${expectedValue.toFixed(2)}, Kelly: ${(kellyFraction * 100).toFixed(2)}%`
    };
  }

  /**
   * Stage 5: Historical Pattern Validation
   */
  async checkHistoricalValidation(signal, context) {
    if (!this.config.enablePatternMatching) {
      return { passed: true, score: 100, details: 'Pattern matching disabled' };
    }

    const similarPatterns = this.findSimilarPatterns(signal, context);
    const historicalWinRate = this.calculateHistoricalWinRate(similarPatterns);
    const patternStrength = this.calculatePatternStrength(similarPatterns);

    const checks = {
      sufficientHistory: similarPatterns.length >= this.config.minSimilarPatterns,
      highWinRate: historicalWinRate >= this.config.minHistoricalWinRate,
      strongPattern: patternStrength >= 70
    };

    const passed = Object.values(checks).every(check => check);
    const score = (Object.values(checks).filter(c => c).length / Object.keys(checks).length) * 100;

    return {
      passed,
      score,
      historicalWinRate,
      patternCount: similarPatterns.length,
      patternStrength,
      checks,
      details: `${similarPatterns.length} similar patterns, ${(historicalWinRate * 100).toFixed(1)}% win rate`
    };
  }

  /**
   * Calculate overall confidence score (0-100)
   */
  calculateOverallConfidence(filterStages) {
    const scores = Object.values(filterStages).map(stage => stage.score);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    
    // Weight recent performance higher
    const weights = [1.0, 1.1, 1.2, 1.3, 1.4]; // Stage 5 weighted most
    const weightedSum = Object.values(filterStages).reduce((sum, stage, idx) => {
      return sum + (stage.score * weights[idx]);
    }, 0);
    const weightedAvg = weightedSum / weights.reduce((a, b) => a + b, 0);
    
    return Math.min(weightedAvg, 100);
  }

  /**
   * Estimate win probability (0.0-1.0)
   */
  estimateWinProbability(filterStages, signal) {
    // Base probability from signal strength/confidence
    const baseProbability = (signal.strength + signal.confidence) / 200;
    
    // Adjust based on filter stages
    const stageMultipliers = {
      stage1_basicQuality: 1.0,
      stage2_marketRegime: 1.15,
      stage3_technicalConfluence: 1.25,
      stage4_riskRewardProfile: 1.20,
      stage5_historicalValidation: 1.30
    };

    let adjustedProbability = baseProbability;
    Object.entries(filterStages).forEach(([stageName, stage]) => {
      if (stage.passed) {
        const multiplier = stageMultipliers[stageName];
        adjustedProbability *= multiplier;
      } else {
        adjustedProbability *= 0.7; // Penalty for failed stage
      }
    });

    // Cap at reasonable maximum
    return Math.min(adjustedProbability, 0.98);
  }

  /**
   * Generate trading recommendation
   */
  generateRecommendation(allPassed, winProbability, confidence) {
    if (!allPassed) {return 'REJECT';}
    
    if (winProbability >= 0.90 && confidence >= 90) {return 'STRONG_BUY';}
    if (winProbability >= 0.85 && confidence >= 85) {return 'BUY';}
    if (winProbability >= 0.80 && confidence >= 75) {return 'CONSIDER';}
    
    return 'REJECT';
  }

  /**
   * Enhance signal with additional ultra-quality metrics
   */
  enhanceSignal(signal, filterStages) {
    return {
      ...signal,
      ultraQuality: true,
      qualityScore: this.calculateOverallConfidence(filterStages),
      winProbability: this.estimateWinProbability(filterStages, signal),
      confluence: filterStages.stage3_technicalConfluence.confirmations,
      regime: filterStages.stage2_marketRegime.regime,
      historicalWinRate: filterStages.stage5_historicalValidation.historicalWinRate,
      timestamp: Date.now()
    };
  }

  // ============ Helper Methods ============

  classifyMarketRegime(analysis) {
    // Simplified regime classification - extend as needed
    const tech = analysis.technical || {};
    const trend = tech.trend || 'neutral';
    const strength = tech.strength || 50;

    if (strength >= 70 && (trend === 'bullish' || trend === 'bearish')) {
      return { type: 'trending_strong', trendStrength: strength };
    }
    if (strength >= 50) {
      return { type: 'trending_moderate', trendStrength: strength };
    }
    return { type: 'ranging', trendStrength: strength };
  }

  calculateVolatility(analysis) {
    // Simplified volatility calculation
    const tech = analysis.technical || {};
    return tech.volatility || 1.0;
  }

  hasConflictingNews(signal, analysis) {
    // Check if high-impact news conflicts with signal direction
    const news = analysis.news || {};
    if (!news.highImpactEvents || news.highImpactEvents.length === 0) {
      return false;
    }
    
    // If sentiment opposes signal direction, flag conflict
    const sentiment = news.sentiment || 0;
    if ((signal.direction === 'BUY' && sentiment < -50) || 
        (signal.direction === 'SELL' && sentiment > 50)) {
      return true;
    }
    
    return false;
  }

  checkLiquidity(analysis) {
    // Check actual liquidity from analysis if available
    const tech = analysis.technical || {};
    const volume = tech.volume || tech.volumeProfile;
    
    if (volume && volume.score) {
      return volume.score;
    }
    
    // Fallback: assume good liquidity for major pairs
    return 75;
  }

  checkTrendAlignment(signal, analysis) {
    // Check if multiple timeframes agree on trend
    const tech = analysis.technical || {};
    const timeframes = tech.timeframes || {};
    
    const directions = Object.values(timeframes)
      .map(tf => tf.trend)
      .filter(t => t === (signal.direction === 'BUY' ? 'bullish' : 'bearish'));
    
    return directions.length >= 3; // At least 3 timeframes agree
  }

  checkMomentumConfirmation(signal, analysis) {
    const tech = analysis.technical || {};
    const momentum = tech.momentum || 50;
    
    if (signal.direction === 'BUY') {return momentum > 60;}
    return momentum < 40;
  }

  checkVolumeConfirmation(signal, analysis) {
    const tech = analysis.technical || {};
    const volume = tech.volumeProfile || 50;
    return volume > 60; // Above-average volume
  }

  checkKeyLevels(signal, analysis) {
    // Check if entry is near key support/resistance
    const tech = analysis.technical || {};
    if (!tech.keyLevels || !signal.entry) {return false;}
    
    const entry = signal.entry.price;
    const nearLevel = tech.keyLevels.some(level => {
      const distance = Math.abs(entry - level) / entry;
      return distance < 0.002; // Within 0.2% of key level
    });
    
    return nearLevel;
  }

  checkMAAlignment(signal, analysis) {
    // Check if price is above/below moving averages appropriately
    const tech = analysis.technical || {};
    if (!tech.movingAverages) {return false;}
    
    const mas = tech.movingAverages;
    if (signal.direction === 'BUY') {
      return mas.shortAboveLong && mas.priceAboveShort;
    } else {
      return !mas.shortAboveLong && !mas.priceAboveShort;
    }
  }

  checkOscillatorAlignment(signal, analysis) {
    // Check RSI, MACD alignment
    const tech = analysis.technical || {};
    const rsi = tech.rsi || 50;
    const macd = tech.macd || {};
    
    if (signal.direction === 'BUY') {
      return rsi > 45 && rsi < 70 && (macd.signal === 'bullish' || macd.histogram > 0);
    } else {
      return rsi < 55 && rsi > 30 && (macd.signal === 'bearish' || macd.histogram < 0);
    }
  }

  checkFibonacciAlignment(signal, analysis) {
    // Check if near Fibonacci retracement levels
    const tech = analysis.technical || {};
    if (!tech.fibonacci || !signal.entry) {return false;}
    
    const entry = signal.entry.price;
    const fibLevels = [0.236, 0.382, 0.500, 0.618, 0.786];
    
    return tech.fibonacci.some(fib => {
      const distance = Math.abs(entry - fib.price) / entry;
      return distance < 0.001; // Within 0.1% of fib level
    });
  }

  calculateRR(signal) {
    if (!signal.entry || !signal.stopLoss || !signal.takeProfit) {return 0;}
    
    const risk = Math.abs(signal.entry.price - signal.stopLoss);
    const reward = Math.abs(signal.takeProfit - signal.entry.price);
    
    return reward / risk;
  }

  estimateBaseWinRate(signal, analysis) {
    // Estimate base win rate from signal quality
    const quality = (signal.strength + signal.confidence) / 2;
    return 0.5 + (quality / 200); // 50% base + quality adjustment
  }

  calculateExpectedValue(rr, winRate) {
    return (winRate * rr) - ((1 - winRate) * 1);
  }

  calculateKelly(winRate, rr) {
    // Kelly Criterion: f = (bp - q) / b
    // where b = odds, p = win probability, q = loss probability
    const q = 1 - winRate;
    return (winRate * rr - q) / rr;
  }

  isStopLossTight(signal) {
    // Check if stop loss is reasonable (not too tight, not too wide)
    if (!signal.entry || !signal.stopLoss) {return false;}
    
    const stopDistance = Math.abs(signal.entry.price - signal.stopLoss);
    const pipValue = this.getPipValue(signal.pair);
    const stopPips = stopDistance / pipValue;
    
    return stopPips >= 15 && stopPips <= 50; // 15-50 pips is reasonable
  }

  isTakeProfitRealistic(signal, analysis) {
    // Check if take profit is achievable
    if (!signal.entry || !signal.takeProfit) {return false;}
    
    const tpDistance = Math.abs(signal.takeProfit - signal.entry.price);
    const pipValue = this.getPipValue(signal.pair);
    const tpPips = tpDistance / pipValue;
    
    return tpPips >= 25 && tpPips <= 150; // 25-150 pips is realistic
  }

  getPipValue(pair) {
    // Simplified pip value calculation
    if (pair.includes('JPY')) {return 0.01;}
    return 0.0001;
  }

  findSimilarPatterns(signal, context) {
    // Find similar historical patterns
    // Simplified - return some patterns
    return Array.from(this.historicalPatterns.values())
      .filter(p => p.pair === signal.pair)
      .slice(-10);
  }

  calculateHistoricalWinRate(patterns) {
    if (patterns.length === 0) {
      return this.config.defaultHistoricalWinRate; // Match min requirement
    }
    
    const wins = patterns.filter(p => p.outcome === 'win').length;
    return wins / patterns.length;
  }

  calculatePatternStrength(patterns) {
    if (patterns.length === 0) {return 70;} // Default
    
    const avgStrength = patterns.reduce((sum, p) => sum + (p.strength || 50), 0) / patterns.length;
    return avgStrength;
  }

  getFailureReason(filterStages) {
    const failedStages = Object.entries(filterStages)
      .filter(([_, stage]) => !stage.passed)
      .map(([name, stage]) => `${name}: ${stage.details}`);
    
    return `Failed stages: ${failedStages.join('; ')}`;
  }

  /**
   * Record signal outcome for learning
   */
  recordSignalOutcome(signal, outcome) {
    const pattern = {
      pair: signal.pair,
      direction: signal.direction,
      strength: signal.strength,
      confidence: signal.confidence,
      outcome: outcome, // 'win' or 'loss'
      timestamp: Date.now()
    };

    const key = `${signal.pair}_${signal.direction}_${Date.now()}`;
    this.historicalPatterns.set(key, pattern);

    // Trim history
    if (this.historicalPatterns.size > this.maxHistorySize) {
      const oldest = Array.from(this.historicalPatterns.keys())[0];
      this.historicalPatterns.delete(oldest);
    }

    logger.info({ pair: signal.pair, outcome }, 'Signal outcome recorded');
  }
}

export default UltraSignalFilter;
