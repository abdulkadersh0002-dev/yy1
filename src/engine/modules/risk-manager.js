/**
 * Enhanced Risk Manager Module
 * Advanced risk management with position sizing, exposure limits, and dynamic adjustments
 */

import logger from '../../services/logging/logger.js';

/**
 * Risk Manager
 * Handles position sizing, risk allocation, and exposure management
 */
export class RiskManager {
  constructor(config = {}) {
    this.config = {
      accountBalance: config.accountBalance || 10000,
      riskPerTrade: config.riskPerTrade || 0.02, // 2% default
      maxDailyRisk: config.maxDailyRisk || 0.06, // 6% default
      maxConcurrentTrades: config.maxConcurrentTrades || 5,
      maxExposurePerCurrency: config.maxExposurePerCurrency || 180000,
      maxDrawdownPercent: config.maxDrawdownPercent || 15,
      minKellyFraction: config.minKellyFraction || 0.005,
      maxKellyFraction: config.maxKellyFraction || 0.035,
      volatilityAdjustment: config.volatilityAdjustment !== false,
      correlationPenalty: config.correlationPenalty || {
        samePair: 0.35,
        sharedCurrency: 0.65
      },
      ...config
    };

    this.state = {
      dailyRisk: 0,
      dailyPnL: 0,
      lastResetDate: new Date().toDateString(),
      drawdown: 0,
      peakEquity: this.config.accountBalance,
      currentEquity: this.config.accountBalance
    };
  }

  /**
   * Calculate position size for a trade
   * @param {Object} signal - Trading signal
   * @param {Object} context - Context with active trades and market conditions
   * @returns {Object} Position sizing details
   */
  calculatePositionSize(signal, context = {}) {
    // Reset daily risk if new day
    this.resetDailyRiskIfNeeded();

    // Check if we can take new trade
    const canTrade = this.canTakeNewTrade(context);
    if (!canTrade.allowed) {
      return {
        allowed: false,
        reason: canTrade.reason,
        positionSize: 0,
        riskAmount: 0
      };
    }

    // Base risk amount (% of account)
    let baseRisk = this.config.riskPerTrade;

    // Apply Kelly Criterion adjustment
    baseRisk = this.applyKellyCriterion(baseRisk, signal, context);

    // Apply volatility adjustment
    if (this.config.volatilityAdjustment && context.volatility) {
      baseRisk = this.applyVolatilityAdjustment(baseRisk, context.volatility);
    }

    // Apply correlation penalty
    if (context.activeTrades) {
      baseRisk = this.applyCorrelationPenalty(baseRisk, signal, context.activeTrades);
    }

    // Apply drawdown adjustment
    baseRisk = this.applyDrawdownAdjustment(baseRisk);

    // Calculate actual risk amount and position size
    const riskAmount = this.state.currentEquity * baseRisk;
    const positionSize = this.calculatePositionFromRisk(riskAmount, signal);

    // Check exposure limits
    const exposureCheck = this.checkExposureLimits(signal, positionSize, context);
    if (!exposureCheck.allowed) {
      return {
        allowed: false,
        reason: exposureCheck.reason,
        positionSize: 0,
        riskAmount: 0
      };
    }

    return {
      allowed: true,
      positionSize,
      riskAmount,
      riskPercent: baseRisk * 100,
      adjustments: {
        kelly: true,
        volatility: this.config.volatilityAdjustment,
        correlation: context.activeTrades && context.activeTrades.length > 0,
        drawdown: this.state.drawdown > 0
      },
      metadata: {
        accountBalance: this.state.currentEquity,
        dailyRiskUsed: this.state.dailyRisk,
        drawdown: this.state.drawdown
      }
    };
  }

  /**
   * Check if we can take a new trade
   * @param {Object} context - Trading context
   * @returns {Object} Result with allowed flag and reason
   */
  canTakeNewTrade(context = {}) {
    // Check max concurrent trades
    const activeTrades = context.activeTrades || [];
    if (activeTrades.length >= this.config.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Maximum concurrent trades limit reached (${this.config.maxConcurrentTrades})`
      };
    }

    // Check daily risk limit
    const remainingDailyRisk = this.config.maxDailyRisk - this.state.dailyRisk;
    if (remainingDailyRisk < this.config.riskPerTrade * 0.5) {
      return {
        allowed: false,
        reason: `Daily risk limit nearly exhausted (${(this.state.dailyRisk * 100).toFixed(1)}%/${(this.config.maxDailyRisk * 100).toFixed(1)}%)`
      };
    }

    // Check drawdown limit
    if (this.state.drawdown > this.config.maxDrawdownPercent) {
      return {
        allowed: false,
        reason: `Maximum drawdown exceeded (${this.state.drawdown.toFixed(1)}%)`
      };
    }

    return { allowed: true };
  }

  /**
   * Apply Kelly Criterion for position sizing
   * @param {number} baseRisk - Base risk percentage
   * @param {Object} signal - Trading signal
   * @param {Object} context - Trading context
   * @returns {number} Adjusted risk
   */
  applyKellyCriterion(baseRisk, signal, context) {
    // Estimate win rate from signal quality
    const winRate = this.estimateWinRate(signal, context);

    // Estimate average win/loss ratio from risk-reward
    const avgWinLoss = signal.entry
      ? this.calculateRiskRewardRatio(signal.entry, signal.direction)
      : 2.0;

    // Kelly formula: (p * b - q) / b
    // where p = win probability, q = loss probability, b = win/loss ratio
    const kelly = (winRate * avgWinLoss - (1 - winRate)) / avgWinLoss;

    // Apply fractional Kelly with bounds
    const fractionalKelly = Math.max(
      this.config.minKellyFraction,
      Math.min(this.config.maxKellyFraction, kelly * 0.25)
    );

    // Blend Kelly with base risk
    return (baseRisk + fractionalKelly) / 2;
  }

  /**
   * Apply volatility adjustment to risk
   * @param {number} risk - Base risk
   * @param {Object} volatility - Volatility data
   * @returns {number} Adjusted risk
   */
  applyVolatilityAdjustment(risk, volatility) {
    const regime = volatility.regime || 'normal';
    const multipliers = {
      calm: 1.15,
      normal: 1.0,
      volatile: 0.72,
      extreme: 0.55
    };

    const multiplier = multipliers[regime] || 1.0;
    return risk * multiplier;
  }

  /**
   * Apply correlation penalty
   * @param {number} risk - Base risk
   * @param {Object} signal - New signal
   * @param {Array} activeTrades - Active trades
   * @returns {number} Adjusted risk
   */
  applyCorrelationPenalty(risk, signal, activeTrades) {
    const penalties = this.config.correlationPenalty;

    // Check for same pair
    const samePair = activeTrades.find((trade) => trade.pair === signal.pair);
    if (samePair) {
      risk *= penalties.samePair;
    }

    // Check for shared currency
    const [base1, quote1] = signal.pair.match(/.{3}/g) || [];
    const sharedCurrency = activeTrades.filter((trade) => {
      const [base2, quote2] = trade.pair.match(/.{3}/g) || [];
      return base1 === base2 || base1 === quote2 || quote1 === base2 || quote1 === quote2;
    });

    if (sharedCurrency.length > 0) {
      risk *= Math.pow(penalties.sharedCurrency, sharedCurrency.length);
    }

    return risk;
  }

  /**
   * Apply drawdown adjustment
   * @param {number} risk - Base risk
   * @returns {number} Adjusted risk
   */
  applyDrawdownAdjustment(risk) {
    if (this.state.drawdown > 5) {
      // Reduce risk proportionally to drawdown
      const reductionFactor = Math.max(0.3, 1 - this.state.drawdown / 100);
      return risk * reductionFactor;
    }
    return risk;
  }

  /**
   * Calculate position size from risk amount
   * @param {number} riskAmount - Risk amount in currency
   * @param {Object} signal - Trading signal
   * @returns {number} Position size
   */
  calculatePositionFromRisk(riskAmount, signal) {
    if (!signal.entry || !signal.entry.price || !signal.entry.stopLoss) {
      // Fallback: simple position sizing
      return Math.floor(riskAmount * 100);
    }

    const price = signal.entry.price;
    const stopLoss = signal.entry.stopLoss;
    const stopDistance = Math.abs(price - stopLoss);

    if (stopDistance === 0) {
      return 0;
    }

    // Position size = risk amount / stop distance
    return Math.floor(riskAmount / stopDistance);
  }

  /**
   * Check exposure limits
   * @param {Object} signal - Trading signal
   * @param {number} positionSize - Proposed position size
   * @param {Object} context - Trading context
   * @returns {Object} Result with allowed flag
   */
  checkExposureLimits(signal, positionSize, context) {
    const [base, quote] = signal.pair.match(/.{3}/g) || [];
    const activeTrades = context.activeTrades || [];

    // Calculate current exposures
    const baseExposure = activeTrades
      .filter((trade) => trade.pair.includes(base))
      .reduce((sum, trade) => sum + (trade.positionSize || 0), 0);

    const quoteExposure = activeTrades
      .filter((trade) => trade.pair.includes(quote))
      .reduce((sum, trade) => sum + (trade.positionSize || 0), 0);

    // Check if new position would exceed limits
    const newBaseExposure = baseExposure + positionSize;
    const newQuoteExposure = quoteExposure + positionSize;

    if (newBaseExposure > this.config.maxExposurePerCurrency) {
      return {
        allowed: false,
        reason: `${base} exposure limit would be exceeded (${newBaseExposure} > ${this.config.maxExposurePerCurrency})`
      };
    }

    if (newQuoteExposure > this.config.maxExposurePerCurrency) {
      return {
        allowed: false,
        reason: `${quote} exposure limit would be exceeded (${newQuoteExposure} > ${this.config.maxExposurePerCurrency})`
      };
    }

    return { allowed: true };
  }

  /**
   * Update risk state after trade execution
   * @param {Object} trade - Executed trade
   */
  updateRiskState(trade) {
    const riskPercent = (trade.riskAmount || 0) / this.state.currentEquity;
    this.state.dailyRisk += riskPercent;

    logger.debug(
      {
        pair: trade.pair,
        riskAmount: trade.riskAmount,
        riskPercent: (riskPercent * 100).toFixed(2),
        dailyRisk: (this.state.dailyRisk * 100).toFixed(2)
      },
      'Risk state updated'
    );
  }

  /**
   * Update equity and drawdown
   * @param {number} currentEquity - Current account equity
   */
  updateEquity(currentEquity) {
    this.state.currentEquity = currentEquity;

    // Update peak equity
    if (currentEquity > this.state.peakEquity) {
      this.state.peakEquity = currentEquity;
    }

    // Calculate drawdown
    this.state.drawdown = ((this.state.peakEquity - currentEquity) / this.state.peakEquity) * 100;
  }

  /**
   * Reset daily risk if new day
   */
  resetDailyRiskIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.state.lastResetDate) {
      this.state.dailyRisk = 0;
      this.state.dailyPnL = 0;
      this.state.lastResetDate = today;
      logger.info('Daily risk limits reset');
    }
  }

  /**
   * Estimate win rate from signal
   * @param {Object} signal - Trading signal
   * @param {Object} context - Historical context
   * @returns {number} Win rate (0-1)
   */
  estimateWinRate(signal, context) {
    // Base win rate from confidence
    let winRate = signal.confidence / 100;

    // Adjust based on signal strength
    if (signal.strength > 70) {
      winRate = Math.min(1, winRate + 0.1);
    }

    // Adjust based on historical performance if available
    if (context.historicalWinRate) {
      winRate = (winRate + context.historicalWinRate) / 2;
    }

    return Math.max(0.4, Math.min(0.7, winRate));
  }

  /**
   * Calculate risk-reward ratio
   * @param {Object} entry - Entry parameters
   * @param {string} direction - Trade direction
   * @returns {number} Risk-reward ratio
   */
  calculateRiskRewardRatio(entry, direction) {
    if (!entry.price || !entry.stopLoss || !entry.takeProfit) {
      return 2.0;
    }

    const price = entry.price;
    const stopLoss = entry.stopLoss;
    const takeProfit = entry.takeProfit;

    if (direction === 'BUY') {
      const risk = Math.abs(price - stopLoss);
      const reward = Math.abs(takeProfit - price);
      return risk > 0 ? reward / risk : 2.0;
    } else if (direction === 'SELL') {
      const risk = Math.abs(stopLoss - price);
      const reward = Math.abs(price - takeProfit);
      return risk > 0 ? reward / risk : 2.0;
    }

    return 2.0;
  }

  /**
   * Get current risk state
   * @returns {Object} Risk state
   */
  getRiskState() {
    return {
      ...this.state,
      config: { ...this.config }
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info({ config: this.config }, 'Risk manager configuration updated');
  }
}

export default RiskManager;
