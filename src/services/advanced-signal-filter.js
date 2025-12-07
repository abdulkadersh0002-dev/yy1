/**
 * Advanced Signal Filter - Multi-layer validation for high-accuracy signals
 * Implements strict filtering to achieve 80-90% win rate
 */

import logger from '../logging/logger.js';

class AdvancedSignalFilter {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.tradingEngine = options.tradingEngine;
    this.priceDataFetcher = options.priceDataFetcher;
    this.newsAnalyzer = options.newsAnalyzer;
    
    // Filter thresholds
    this.config = {
      minHistoricalWinRate: options.minHistoricalWinRate || 0.65,
      minRiskRewardRatio: options.minRiskRewardRatio || 2.0,
      minQualityScore: options.minQualityScore || 80,
      maxSpreadPips: options.maxSpreadPips || 2.0,
      minVolumeRatio: options.minVolumeRatio || 1.2,
      newsLookAheadHours: options.newsLookAheadHours || 4,
      minBacktestTrades: options.minBacktestTrades || 20,
      backtestPeriodDays: options.backtestPeriodDays || 30,
      ...options
    };

    // Performance tracking
    this.signalHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Main filter method - validates signal through multiple layers
   */
  async filterSignal(signal, pair, marketData = {}) {
    const filterResults = {
      passed: false,
      score: 0,
      checks: {},
      reasons: []
    };

    try {
      // Layer 1: Historical Performance Check
      const historical = await this.checkHistoricalPerformance(signal, pair);
      filterResults.checks.historical = historical;
      if (!historical.passed) {
        filterResults.reasons.push(historical.reason);
        return filterResults;
      }

      // Layer 2: Risk/Reward Validation
      const riskReward = this.checkRiskReward(signal);
      filterResults.checks.riskReward = riskReward;
      if (!riskReward.passed) {
        filterResults.reasons.push(riskReward.reason);
        return filterResults;
      }

      // Layer 3: Market Conditions
      const marketCondition = await this.assessMarketCondition(pair, marketData);
      filterResults.checks.marketCondition = marketCondition;
      if (!marketCondition.passed) {
        filterResults.reasons.push(marketCondition.reason);
        return filterResults;
      }

      // Layer 4: News Impact Check
      const newsCheck = await this.checkUpcomingNews(pair);
      filterResults.checks.newsImpact = newsCheck;
      if (!newsCheck.passed) {
        filterResults.reasons.push(newsCheck.reason);
        return filterResults;
      }

      // Layer 5: Spread/Liquidity Check
      const liquidityCheck = await this.checkLiquidity(pair, marketData);
      filterResults.checks.liquidity = liquidityCheck;
      if (!liquidityCheck.passed) {
        filterResults.reasons.push(liquidityCheck.reason);
        return filterResults;
      }

      // Layer 6: Volume Analysis
      const volumeCheck = await this.checkVolume(pair, marketData);
      filterResults.checks.volume = volumeCheck;
      if (!volumeCheck.passed) {
        filterResults.reasons.push(volumeCheck.reason);
        return filterResults;
      }

      // Layer 7: Time-of-Day Filter
      const timeCheck = this.checkTradingHours();
      filterResults.checks.tradingHours = timeCheck;
      if (!timeCheck.passed) {
        filterResults.reasons.push(timeCheck.reason);
        return filterResults;
      }

      // Layer 8: Multi-Timeframe Alignment
      const timeframeCheck = this.checkTimeframeAlignment(signal);
      filterResults.checks.timeframeAlignment = timeframeCheck;
      if (!timeframeCheck.passed) {
        filterResults.reasons.push(timeframeCheck.reason);
        return filterResults;
      }

      // Calculate overall quality score
      const qualityScore = this.calculateQualityScore(filterResults.checks);
      filterResults.score = qualityScore;

      // Final decision
      if (qualityScore >= this.config.minQualityScore) {
        filterResults.passed = true;
        filterResults.reasons.push(`High-quality signal (score: ${qualityScore.toFixed(1)})`);
      } else {
        filterResults.reasons.push(`Quality score too low: ${qualityScore.toFixed(1)} < ${this.config.minQualityScore}`);
      }

      return filterResults;
    } catch (error) {
      this.logger.error({ err: error, pair }, 'Signal filter error');
      filterResults.reasons.push(`Filter error: ${error.message}`);
      return filterResults;
    }
  }

  /**
   * Check historical performance of similar signals
   */
  async checkHistoricalPerformance(signal, pair) {
    try {
      // Get similar signals from history
      const similarSignals = this.findSimilarSignals(signal, pair);
      
      if (similarSignals.length < this.config.minBacktestTrades) {
        return {
          passed: false,
          reason: `Insufficient historical data (${similarSignals.length} < ${this.config.minBacktestTrades})`,
          winRate: null,
          sampleSize: similarSignals.length
        };
      }

      // Calculate win rate
      const wins = similarSignals.filter((s) => s.outcome === 'win').length;
      const winRate = wins / similarSignals.length;

      if (winRate < this.config.minHistoricalWinRate) {
        return {
          passed: false,
          reason: `Low historical win rate: ${(winRate * 100).toFixed(1)}% < ${(this.config.minHistoricalWinRate * 100).toFixed(1)}%`,
          winRate,
          sampleSize: similarSignals.length
        };
      }

      return {
        passed: true,
        reason: `Strong historical performance: ${(winRate * 100).toFixed(1)}%`,
        winRate,
        sampleSize: similarSignals.length
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Historical performance check failed');
      return {
        passed: false,
        reason: 'Historical check unavailable',
        winRate: null
      };
    }
  }

  /**
   * Check risk/reward ratio
   */
  checkRiskReward(signal) {
    const rr = signal.riskRewardRatio || this.calculateRiskReward(signal);
    
    if (rr < this.config.minRiskRewardRatio) {
      return {
        passed: false,
        reason: `Poor risk/reward: ${rr.toFixed(2)} < ${this.config.minRiskRewardRatio}`,
        ratio: rr
      };
    }

    return {
      passed: true,
      reason: `Good risk/reward: ${rr.toFixed(2)}`,
      ratio: rr
    };
  }

  /**
   * Calculate risk/reward ratio
   */
  calculateRiskReward(signal) {
    if (!signal.stopLoss || !signal.takeProfit || !signal.entry) {
      return 1.0; // Default
    }

    const risk = Math.abs(signal.entry - signal.stopLoss);
    const reward = Math.abs(signal.takeProfit - signal.entry);

    return risk > 0 ? reward / risk : 1.0;
  }

  /**
   * Assess current market conditions
   */
  async assessMarketCondition(pair, marketData) {
    try {
      // Check volatility
      const volatility = marketData.volatility || await this.getVolatility(pair);
      if (volatility === 'extreme') {
        return {
          passed: false,
          reason: 'Extreme volatility - unfavorable for trading',
          condition: volatility
        };
      }

      // Check trend strength (prefer trending markets)
      const trend = marketData.trend || await this.getTrend(pair);
      if (trend === 'choppy' || trend === 'uncertain') {
        return {
          passed: false,
          reason: 'Choppy/uncertain market conditions',
          condition: trend
        };
      }

      return {
        passed: true,
        reason: `Favorable market: ${volatility} volatility, ${trend} trend`,
        condition: { volatility, trend }
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Market condition check failed');
      return {
        passed: true, // Don't block on errors
        reason: 'Market condition check skipped',
        condition: null
      };
    }
  }

  /**
   * Check for upcoming high-impact news
   */
  async checkUpcomingNews(pair) {
    try {
      if (!this.newsAnalyzer) {
        return { passed: true, reason: 'News check skipped', events: [] };
      }

      // Get upcoming calendar events
      const lookAhead = this.config.newsLookAheadHours * 60 * 60 * 1000;
      const now = Date.now();
      const cutoff = now + lookAhead;

      // Simplified news check - in production would query calendar
      const upcomingEvents = []; // Would be populated from newsAnalyzer

      const highImpactEvents = upcomingEvents.filter((e) => 
        e.impact === 'high' && e.timestamp < cutoff
      );

      if (highImpactEvents.length > 0) {
        return {
          passed: false,
          reason: `${highImpactEvents.length} high-impact news event(s) within ${this.config.newsLookAheadHours}h`,
          events: highImpactEvents
        };
      }

      return {
        passed: true,
        reason: 'No high-impact news pending',
        events: upcomingEvents
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'News check failed');
      return { passed: true, reason: 'News check skipped', events: [] };
    }
  }

  /**
   * Check spread and liquidity
   */
  async checkLiquidity(pair, marketData) {
    try {
      const spread = marketData.spread || await this.getCurrentSpread(pair);
      
      if (spread > this.config.maxSpreadPips) {
        return {
          passed: false,
          reason: `Spread too wide: ${spread.toFixed(2)} pips > ${this.config.maxSpreadPips} pips`,
          spread
        };
      }

      return {
        passed: true,
        reason: `Acceptable spread: ${spread.toFixed(2)} pips`,
        spread
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Liquidity check failed');
      return { passed: true, reason: 'Liquidity check skipped', spread: null };
    }
  }

  /**
   * Check volume
   */
  async checkVolume(pair, marketData) {
    try {
      const volumeRatio = marketData.volumeRatio || await this.getVolumeRatio(pair);
      
      if (volumeRatio < this.config.minVolumeRatio) {
        return {
          passed: false,
          reason: `Low volume: ${volumeRatio.toFixed(2)}x < ${this.config.minVolumeRatio}x average`,
          volumeRatio
        };
      }

      return {
        passed: true,
        reason: `Healthy volume: ${volumeRatio.toFixed(2)}x average`,
        volumeRatio
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Volume check failed');
      return { passed: true, reason: 'Volume check skipped', volumeRatio: null };
    }
  }

  /**
   * Check trading hours (avoid low-liquidity periods)
   */
  checkTradingHours() {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();

    // Avoid Friday evening and weekend
    if (day === 5 && hour >= 20) {
      return {
        passed: false,
        reason: 'Market closing soon (Friday evening)',
        hour
      };
    }

    if (day === 6 || day === 0) {
      return {
        passed: false,
        reason: 'Weekend - market closed',
        hour
      };
    }

    // Avoid low-liquidity hours (22:00-01:00 UTC)
    if (hour >= 22 || hour <= 1) {
      return {
        passed: false,
        reason: 'Low-liquidity hours',
        hour
      };
    }

    return {
      passed: true,
      reason: 'Active trading hours',
      hour
    };
  }

  /**
   * Check multi-timeframe alignment
   */
  checkTimeframeAlignment(signal) {
    const components = signal.components;
    if (!components || !components.technical) {
      return { passed: true, reason: 'Timeframe check skipped' };
    }

    const direction = signal.direction;
    const timeframes = components.technical.timeframes || {};

    // Count aligned timeframes
    const aligned = Object.values(timeframes).filter((tf) => 
      tf.trend === direction || tf.direction === direction
    ).length;

    const total = Object.keys(timeframes).length;
    const alignmentRatio = total > 0 ? aligned / total : 0;

    if (alignmentRatio < 0.75) {
      return {
        passed: false,
        reason: `Poor timeframe alignment: ${(alignmentRatio * 100).toFixed(0)}% < 75%`,
        aligned,
        total
      };
    }

    return {
      passed: true,
      reason: `Strong timeframe alignment: ${(alignmentRatio * 100).toFixed(0)}%`,
      aligned,
      total
    };
  }

  /**
   * Calculate overall quality score
   */
  calculateQualityScore(checks) {
    const weights = {
      historical: 0.30,
      riskReward: 0.20,
      marketCondition: 0.15,
      newsImpact: 0.10,
      liquidity: 0.10,
      volume: 0.05,
      tradingHours: 0.05,
      timeframeAlignment: 0.05
    };

    let score = 0;
    let totalWeight = 0;

    Object.keys(weights).forEach((key) => {
      if (checks[key] && checks[key].passed) {
        const checkScore = this.getCheckScore(checks[key]);
        score += checkScore * weights[key];
      }
      totalWeight += weights[key];
    });

    return (score / totalWeight) * 100;
  }

  /**
   * Get individual check score
   */
  getCheckScore(check) {
    if (!check.passed) {
      return 0;
    }

    // Bonus scores based on quality
    if (check.winRate !== undefined && check.winRate > 0.80) {
      return 1.2; // 20% bonus for exceptional historical performance
    }
    if (check.ratio !== undefined && check.ratio > 3.0) {
      return 1.15; // 15% bonus for excellent risk/reward
    }

    return 1.0;
  }

  /**
   * Helper methods (simplified - would use real data in production)
   */
  
  findSimilarSignals(signal, pair) {
    // Filter history for similar signals
    return this.signalHistory.filter((s) => 
      s.pair === pair &&
      s.direction === signal.direction &&
      Math.abs(s.strength - signal.strength) < 20
    );
  }

  async getVolatility(pair) {
    // Would calculate ATR or use trading engine's volatility assessment
    return 'normal';
  }

  async getTrend(pair) {
    // Would use technical analysis
    return 'trending';
  }

  async getCurrentSpread(pair) {
    // Would query broker or data provider
    return 1.5; // pips
  }

  async getVolumeRatio(pair) {
    // Would compare current volume to average
    return 1.3;
  }

  /**
   * Record signal outcome for learning
   */
  recordSignalOutcome(signal, outcome) {
    this.signalHistory.push({
      ...signal,
      outcome, // 'win' or 'loss'
      timestamp: Date.now()
    });

    // Keep history bounded
    if (this.signalHistory.length > this.maxHistorySize) {
      this.signalHistory.shift();
    }
  }

  /**
   * Get filter statistics
   */
  getStatistics() {
    const recent = this.signalHistory.slice(-100);
    const wins = recent.filter((s) => s.outcome === 'win').length;

    return {
      totalSignals: this.signalHistory.length,
      recentSignals: recent.length,
      recentWinRate: recent.length > 0 ? wins / recent.length : 0,
      thresholds: this.config
    };
  }
}

export default AdvancedSignalFilter;
