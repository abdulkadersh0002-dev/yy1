/**
 * Signal Validator Module
 * Multi-stage validation pipeline for trading signals
 */

import logger from '../../services/logging/logger.js';

/**
 * Signal Validation Pipeline
 * Performs comprehensive validation of trading signals
 */
export class SignalValidator {
  constructor(config = {}) {
    this.config = {
      minStrength: config.minStrength || 35,
      minConfidence: config.minConfidence || 30,
      minFinalScore: config.minFinalScore || 20,
      maxAge: config.maxAge || 300000, // 5 minutes
      requireEntry: config.requireEntry !== false,
      requireRiskManagement: config.requireRiskManagement !== false,
      minRiskRewardRatio: config.minRiskRewardRatio || 1.5,
      maxCorrelation: config.maxCorrelation || 0.8,
      ...config
    };
  }

  /**
   * Validate a trading signal through multiple stages
   * @param {Object} signal - Trading signal to validate
   * @param {Object} context - Additional context for validation
   * @returns {Object} Validation result with detailed checks
   */
  validate(signal, context = {}) {
    const checks = {
      basicData: this.checkBasicData(signal),
      strength: this.checkStrength(signal),
      confidence: this.checkConfidence(signal),
      finalScore: this.checkFinalScore(signal),
      freshness: this.checkFreshness(signal),
      entry: this.checkEntry(signal),
      riskManagement: this.checkRiskManagement(signal),
      riskReward: this.checkRiskReward(signal),
      direction: this.checkDirection(signal),
      correlation: this.checkCorrelation(signal, context)
    };

    const passed = Object.values(checks).every((check) => check.passed);
    const warnings = Object.entries(checks)
      .filter(([_checkName, check]) => check.warning)
      .map(([name, check]) => ({ stage: name, message: check.warning }));

    const result = {
      valid: passed,
      checks,
      warnings,
      score: this.calculateValidationScore(checks),
      reason: passed ? 'Signal passed all validation checks' : this.getFailureReason(checks)
    };

    if (!passed) {
      logger.debug(
        {
          pair: signal.pair,
          direction: signal.direction,
          checks,
          reason: result.reason
        },
        'Signal validation failed'
      );
    }

    return result;
  }

  /**
   * Check basic signal data completeness
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkBasicData(signal) {
    const required = ['pair', 'timestamp', 'direction', 'strength', 'confidence', 'finalScore'];
    const missing = required.filter(
      (field) => signal[field] === undefined || signal[field] === null
    );

    return {
      passed: missing.length === 0,
      missing,
      message:
        missing.length > 0
          ? `Missing required fields: ${missing.join(', ')}`
          : 'All required fields present'
    };
  }

  /**
   * Check signal strength threshold
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkStrength(signal) {
    const strength = Number(signal.strength) || 0;
    const passed = strength >= this.config.minStrength;

    return {
      passed,
      value: strength,
      threshold: this.config.minStrength,
      message: passed
        ? `Strength ${strength.toFixed(1)}% meets threshold`
        : `Strength ${strength.toFixed(1)}% below threshold ${this.config.minStrength}%`
    };
  }

  /**
   * Check signal confidence threshold
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkConfidence(signal) {
    const confidence = Number(signal.confidence) || 0;
    const passed = confidence >= this.config.minConfidence;

    return {
      passed,
      value: confidence,
      threshold: this.config.minConfidence,
      message: passed
        ? `Confidence ${confidence.toFixed(1)}% meets threshold`
        : `Confidence ${confidence.toFixed(1)}% below threshold ${this.config.minConfidence}%`
    };
  }

  /**
   * Check final score threshold
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkFinalScore(signal) {
    const finalScore = Number(signal.finalScore) || 0;
    const passed = Math.abs(finalScore) >= this.config.minFinalScore;

    return {
      passed,
      value: finalScore,
      threshold: this.config.minFinalScore,
      message: passed
        ? `Final score ${finalScore.toFixed(1)} meets threshold`
        : `Final score ${finalScore.toFixed(1)} below threshold ${this.config.minFinalScore}`
    };
  }

  /**
   * Check signal freshness (age)
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkFreshness(signal) {
    const now = Date.now();
    const age = now - (signal.timestamp || now);
    const passed = age <= this.config.maxAge;
    const warning = age > this.config.maxAge / 2 ? 'Signal is aging' : null;

    return {
      passed,
      age,
      maxAge: this.config.maxAge,
      warning,
      message: passed
        ? `Signal is fresh (${Math.round(age / 1000)}s old)`
        : `Signal is stale (${Math.round(age / 1000)}s old, max ${Math.round(this.config.maxAge / 1000)}s)`
    };
  }

  /**
   * Check entry parameters
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkEntry(signal) {
    if (!this.config.requireEntry) {
      return { passed: true, message: 'Entry validation skipped' };
    }

    const entry = signal.entry;
    if (!entry) {
      return { passed: false, message: 'Entry data missing' };
    }

    const hasPrice = entry.price && entry.price > 0;
    const hasStopLoss = entry.stopLoss && entry.stopLoss > 0;
    const hasTakeProfit = entry.takeProfit && entry.takeProfit > 0;

    const passed = hasPrice && hasStopLoss && hasTakeProfit;

    return {
      passed,
      hasPrice,
      hasStopLoss,
      hasTakeProfit,
      message: passed ? 'Entry parameters complete' : 'Entry parameters incomplete'
    };
  }

  /**
   * Check risk management data
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkRiskManagement(signal) {
    if (!this.config.requireRiskManagement) {
      return { passed: true, message: 'Risk management validation skipped' };
    }

    const rm = signal.riskManagement;
    if (!rm || typeof rm !== 'object') {
      return { passed: false, message: 'Risk management data missing' };
    }

    const hasPositionSize = rm.positionSize && rm.positionSize > 0;
    const hasRiskAmount = rm.riskAmount && rm.riskAmount > 0;
    const hasAccountRisk = rm.accountRiskPercentage && rm.accountRiskPercentage > 0;

    const passed = hasPositionSize || hasRiskAmount || hasAccountRisk;

    return {
      passed,
      hasPositionSize,
      hasRiskAmount,
      hasAccountRisk,
      message: passed ? 'Risk management data present' : 'Risk management data incomplete'
    };
  }

  /**
   * Check risk-reward ratio
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkRiskReward(signal) {
    const entry = signal.entry;
    if (!entry || !entry.price || !entry.stopLoss || !entry.takeProfit) {
      return { passed: true, message: 'Risk-reward check skipped (incomplete entry data)' };
    }

    const price = entry.price;
    const stopLoss = entry.stopLoss;
    const takeProfit = entry.takeProfit;
    const direction = signal.direction;

    let riskRewardRatio = 0;

    if (direction === 'BUY') {
      const risk = Math.abs(price - stopLoss);
      const reward = Math.abs(takeProfit - price);
      riskRewardRatio = risk > 0 ? reward / risk : 0;
    } else if (direction === 'SELL') {
      const risk = Math.abs(stopLoss - price);
      const reward = Math.abs(price - takeProfit);
      riskRewardRatio = risk > 0 ? reward / risk : 0;
    }

    const passed = riskRewardRatio >= this.config.minRiskRewardRatio;
    const warning =
      riskRewardRatio < this.config.minRiskRewardRatio * 1.2 ? 'Low risk-reward ratio' : null;

    return {
      passed,
      value: riskRewardRatio,
      threshold: this.config.minRiskRewardRatio,
      warning,
      message: passed
        ? `Risk-reward ratio ${riskRewardRatio.toFixed(2)} meets threshold`
        : `Risk-reward ratio ${riskRewardRatio.toFixed(2)} below threshold ${this.config.minRiskRewardRatio}`
    };
  }

  /**
   * Check signal direction validity
   * @param {Object} signal - Trading signal
   * @returns {Object} Check result
   */
  checkDirection(signal) {
    const direction = signal.direction;
    const validDirections = ['BUY', 'SELL'];
    const passed = validDirections.includes(direction);

    return {
      passed,
      value: direction,
      message: passed
        ? `Valid direction: ${direction}`
        : `Invalid direction: ${direction} (must be BUY or SELL)`
    };
  }

  /**
   * Check correlation with existing positions
   * @param {Object} signal - Trading signal
   * @param {Object} context - Context with existing positions
   * @returns {Object} Check result
   */
  checkCorrelation(signal, context) {
    if (!context.activeTrades || context.activeTrades.length === 0) {
      return { passed: true, message: 'No active trades to check correlation' };
    }

    const samePair = context.activeTrades.filter((trade) => trade.pair === signal.pair);
    const sharedCurrency = context.activeTrades.filter((trade) => {
      const [base1, quote1] = signal.pair.match(/.{3}/g) || [];
      const [base2, quote2] = trade.pair.match(/.{3}/g) || [];
      return base1 === base2 || base1 === quote2 || quote1 === base2 || quote1 === quote2;
    });

    const highCorrelation = samePair.length > 0 || sharedCurrency.length >= 2;
    const passed = !highCorrelation;
    const warning =
      sharedCurrency.length === 1 ? 'Moderate correlation with existing positions' : null;

    return {
      passed,
      samePairCount: samePair.length,
      sharedCurrencyCount: sharedCurrency.length,
      warning,
      message: passed
        ? 'Low correlation with existing positions'
        : `High correlation detected (same pair: ${samePair.length}, shared currency: ${sharedCurrency.length})`
    };
  }

  /**
   * Calculate overall validation score
   * @param {Object} checks - Validation checks
   * @returns {number} Score from 0-100
   */
  calculateValidationScore(checks) {
    const weights = {
      basicData: 15,
      strength: 20,
      confidence: 20,
      finalScore: 15,
      freshness: 5,
      entry: 10,
      riskManagement: 5,
      riskReward: 5,
      direction: 3,
      correlation: 2
    };

    let totalWeight = 0;
    let achievedWeight = 0;

    Object.entries(checks).forEach(([name, check]) => {
      const weight = weights[name] || 0;
      totalWeight += weight;
      if (check.passed) {
        achievedWeight += weight;
      }
    });

    return totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0;
  }

  /**
   * Get failure reason from checks
   * @param {Object} checks - Validation checks
   * @returns {string} Failure reason
   */
  getFailureReason(checks) {
    const failures = Object.entries(checks)
      .filter(([_, check]) => !check.passed)
      .map(([name, check]) => `${name}: ${check.message}`);

    return failures.length > 0 ? failures.join('; ') : 'Unknown validation failure';
  }

  /**
   * Update validator configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info({ config: this.config }, 'Signal validator configuration updated');
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

export default SignalValidator;
