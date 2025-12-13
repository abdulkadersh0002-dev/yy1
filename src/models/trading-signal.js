/**
 * Trading Signal Domain Model
 * Represents a complete trading signal with validation and business logic
 */

import { z } from 'zod';
import { BaseModel } from './base-model.js';

// Enhanced schema with more detailed validations
const TradingSignalSchema = z
  .object({
    pair: z.string().min(6).max(10),
    timestamp: z.number().int().positive(),
    direction: z.enum(['BUY', 'SELL', 'NEUTRAL']),
    strength: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    finalScore: z.number().min(-100).max(100),
    components: z.object({
      technical: z.number().optional(),
      fundamental: z.number().optional(),
      sentiment: z.number().optional(),
      momentum: z.number().optional(),
      trend: z.number().optional()
    }),
    entry: z
      .object({
        price: z.number().positive(),
        stopLoss: z.number().positive().nullable(),
        takeProfit: z.number().positive().nullable(),
        riskRewardRatio: z.number().positive().optional()
      })
      .nullable(),
    riskManagement: z.object({
      positionSize: z.number().positive().optional(),
      riskAmount: z.number().positive().optional(),
      maxLoss: z.number().optional(),
      accountRiskPercentage: z.number().min(0).max(100).optional()
    }),
    isValid: z.object({
      isValid: z.boolean(),
      checks: z.record(z.boolean()),
      reason: z.string()
    }),
    explainability: z
      .object({
        factors: z.array(
          z.object({
            name: z.string(),
            weight: z.number(),
            impact: z.string()
          })
        ),
        summary: z.string()
      })
      .nullable(),
    reasoning: z.array(z.string()).nullable().optional(),
    metadata: z
      .object({
        generatedBy: z.string().optional(),
        version: z.string().optional(),
        modelId: z.string().optional()
      })
      .optional()
  })
  .strict();

/**
 * Trading Signal Model
 */
class TradingSignal extends BaseModel {
  constructor(data) {
    const defaults = {
      pair: '',
      timestamp: Date.now(),
      direction: 'NEUTRAL',
      strength: 0,
      confidence: 0,
      finalScore: 0,
      components: {},
      entry: null,
      riskManagement: {},
      isValid: { isValid: false, checks: {}, reason: 'Not validated' },
      explainability: null,
      reasoning: null
    };

    super({ ...defaults, ...data }, TradingSignalSchema);
  }

  /**
   * Get the trading direction
   * @returns {string} BUY, SELL, or NEUTRAL
   */
  getDirection() {
    return this.get('direction');
  }

  /**
   * Check if signal is actionable (valid and strong enough)
   * @param {number} minStrength - Minimum strength threshold
   * @returns {boolean} Whether signal is actionable
   */
  isActionable(minStrength = 35) {
    return (
      this.isValid() && this.get('strength') >= minStrength && this.get('direction') !== 'NEUTRAL'
    );
  }

  /**
   * Get risk-reward ratio from entry data
   * @returns {number|null} Risk-reward ratio or null
   */
  getRiskRewardRatio() {
    const entry = this.get('entry');
    if (!entry || !entry.stopLoss || !entry.takeProfit) {
      return null;
    }

    const price = entry.price;
    const direction = this.getDirection();

    if (direction === 'BUY') {
      const risk = Math.abs(price - entry.stopLoss);
      const reward = Math.abs(entry.takeProfit - price);
      return risk > 0 ? reward / risk : null;
    } else if (direction === 'SELL') {
      const risk = Math.abs(entry.stopLoss - price);
      const reward = Math.abs(price - entry.takeProfit);
      return risk > 0 ? reward / risk : null;
    }

    return null;
  }

  /**
   * Calculate signal quality score (0-100)
   * @returns {number} Quality score
   */
  getQualityScore() {
    const strength = this.get('strength');
    const confidence = this.get('confidence');
    const isValid = this.get('isValid').isValid;

    if (!isValid) {
      return 0;
    }

    // Weight confidence more heavily than strength
    return Math.round(strength * 0.4 + confidence * 0.6);
  }

  /**
   * Get human-readable signal description
   * @returns {string} Signal description
   */
  getDescription() {
    const pair = this.get('pair');
    const direction = this.getDirection();
    const strength = this.get('strength').toFixed(1);
    const confidence = this.get('confidence').toFixed(1);

    return `${direction} ${pair} (Strength: ${strength}%, Confidence: ${confidence}%)`;
  }

  /**
   * Check if signal has sufficient risk management data
   * @returns {boolean} Whether risk management is complete
   */
  hasRiskManagement() {
    const rm = this.get('riskManagement');
    return Boolean(rm && (rm.positionSize || rm.riskAmount || rm.accountRiskPercentage));
  }

  /**
   * Add reasoning to the signal
   * @param {string} reason - Reasoning text
   */
  addReasoning(reason) {
    const current = this.get('reasoning') || [];
    this.set('reasoning', [...current, reason]);
  }

  /**
   * Mark signal as invalid with reason
   * @param {string} reason - Reason for invalidation
   * @param {Object} checks - Validation checks that failed
   */
  invalidate(reason, checks = {}) {
    this.set('isValid', {
      isValid: false,
      checks,
      reason
    });
  }

  /**
   * Mark signal as valid
   * @param {Object} checks - Validation checks that passed
   */
  markValid(checks = {}) {
    this.set('isValid', {
      isValid: true,
      checks,
      reason: 'All validation checks passed'
    });
  }
}

export { TradingSignal };
export default TradingSignal;
