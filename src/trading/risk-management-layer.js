/**
 * Risk Management Layer
 * Approves, rejects, or modifies trade sizes based on risk rules
 */

import logger from '../services/logging/logger.js';

class RiskManagementLayer {
  constructor() {
    this.config = {
      // Position sizing
      maxRiskPerTrade: 0.02,           // 2% max risk per trade
      fractionalKelly: 0.25,            // Use 25% of Kelly Criterion
      maxPositionSize: 1.0,             // Max 1.0 lot per trade
      
      // Daily/weekly limits
      maxDailyLoss: 0.05,               // 5% max daily loss
      maxWeeklyLoss: 0.10,              // 10% max weekly loss
      maxDailyTrades: 10,               // Max 10 trades per day
      
      // Consecutive loss protection
      maxConsecutiveLosses: 3,          // Stop after 3 consecutive losses
      cooldownAfterLosses: 60 * 60 * 1000, // 1 hour cooldown
      
      // Session risk limits
      maxRiskPerSession: 0.03,          // 3% max risk per session
      sessionNames: ['LONDON', 'NEW_YORK', 'TOKYO', 'SYDNEY']
    };

    this.state = {
      dailyPnL: 0,
      weeklyPnL: 0,
      dailyTradeCount: 0,
      consecutiveLosses: 0,
      lastLossTime: null,
      cooldownUntil: null,
      sessionRisks: {},
      tradeHistory: []
    };

    // Reset counters daily
    setInterval(() => this.resetDailyCounters(), 24 * 60 * 60 * 1000);
  }

  /**
   * Evaluate a trading intent
   * Returns: { approved: boolean, reason: string, adjustedSize?: number }
   */
  evaluateIntent(intent) {
    const checks = [
      this.checkCooldown(),
      this.checkDailyLoss(),
      this.checkWeeklyLoss(),
      this.checkDailyTradeLimit(),
      this.checkConsecutiveLosses(),
      this.checkSessionRisk(intent),
      this.checkPositionSize(intent)
    ];

    // Find first failed check
    const failed = checks.find(check => !check.approved);
    
    if (failed) {
      logger.warn('Trade intent rejected', {
        intent,
        reason: failed.reason,
        state: this.state
      });
      return failed;
    }

    // Calculate optimal position size
    const adjustedSize = this.calculateOptimalSize(intent);
    
    logger.info('Trade intent approved', {
      intent,
      originalSize: intent.positionSize,
      adjustedSize,
      state: this.state
    });

    return {
      approved: true,
      reason: 'All risk checks passed',
      adjustedSize
    };
  }

  /**
   * Check if in cooldown period
   */
  checkCooldown() {
    if (this.state.cooldownUntil && Date.now() < this.state.cooldownUntil) {
      const remainingMs = this.state.cooldownUntil - Date.now();
      return {
        approved: false,
        reason: `In cooldown period. ${Math.ceil(remainingMs / 60000)} minutes remaining.`
      };
    }
    return { approved: true };
  }

  /**
   * Check daily loss limit
   */
  checkDailyLoss() {
    if (this.state.dailyPnL < -this.config.maxDailyLoss) {
      return {
        approved: false,
        reason: `Daily loss limit reached: ${(this.state.dailyPnL * 100).toFixed(2)}%`
      };
    }
    return { approved: true };
  }

  /**
   * Check weekly loss limit
   */
  checkWeeklyLoss() {
    if (this.state.weeklyPnL < -this.config.maxWeeklyLoss) {
      return {
        approved: false,
        reason: `Weekly loss limit reached: ${(this.state.weeklyPnL * 100).toFixed(2)}%`
      };
    }
    return { approved: true };
  }

  /**
   * Check daily trade limit
   */
  checkDailyTradeLimit() {
    if (this.state.dailyTradeCount >= this.config.maxDailyTrades) {
      return {
        approved: false,
        reason: `Daily trade limit reached: ${this.state.dailyTradeCount}/${this.config.maxDailyTrades}`
      };
    }
    return { approved: true };
  }

  /**
   * Check consecutive losses
   */
  checkConsecutiveLosses() {
    if (this.state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      return {
        approved: false,
        reason: `Too many consecutive losses: ${this.state.consecutiveLosses}. Cooldown activated.`
      };
    }
    return { approved: true };
  }

  /**
   * Check session risk limit
   */
  checkSessionRisk(intent) {
    const session = intent.session || 'UNKNOWN';
    const sessionRisk = this.state.sessionRisks[session] || 0;
    
    if (sessionRisk >= this.config.maxRiskPerSession) {
      return {
        approved: false,
        reason: `Session risk limit reached for ${session}: ${(sessionRisk * 100).toFixed(2)}%`
      };
    }
    return { approved: true };
  }

  /**
   * Check position size
   */
  checkPositionSize(intent) {
    if (intent.positionSize > this.config.maxPositionSize) {
      return {
        approved: false,
        reason: `Position size ${intent.positionSize} exceeds maximum ${this.config.maxPositionSize}`
      };
    }
    return { approved: true };
  }

  /**
   * Calculate optimal position size using Fractional Kelly
   */
  calculateOptimalSize(intent) {
    const { positionSize, winProbability, riskReward } = intent;
    
    // Fractional Kelly formula: f = (p * (b + 1) - 1) / b * fraction
    // where p = win probability, b = risk/reward ratio
    const p = winProbability || 0.6;
    const b = riskReward || 2;
    
    const kellyFraction = ((p * (b + 1) - 1) / b) * this.config.fractionalKelly;
    const kellySize = Math.max(0.01, Math.min(kellyFraction, this.config.maxPositionSize));
    
    // Take the minimum of intent size, Kelly size, and max allowed
    const optimalSize = Math.min(
      positionSize,
      kellySize,
      this.config.maxPositionSize,
      this.config.maxRiskPerTrade / (intent.risk || 0.02)
    );

    return Number(optimalSize.toFixed(2));
  }

  /**
   * Record trade outcome
   */
  recordTradeOutcome(trade) {
    const pnl = trade.pnl || 0;
    const isWin = pnl > 0;

    // Update PnL
    this.state.dailyPnL += pnl;
    this.state.weeklyPnL += pnl;

    // Update consecutive losses
    if (isWin) {
      this.state.consecutiveLosses = 0;
    } else {
      this.state.consecutiveLosses++;
      this.state.lastLossTime = Date.now();
      
      // Activate cooldown if needed
      if (this.state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
        this.state.cooldownUntil = Date.now() + this.config.cooldownAfterLosses;
        logger.warn('Cooldown activated due to consecutive losses', {
          losses: this.state.consecutiveLosses,
          cooldownMinutes: this.config.cooldownAfterLosses / 60000
        });
      }
    }

    // Update session risk
    const session = trade.session || 'UNKNOWN';
    this.state.sessionRisks[session] = (this.state.sessionRisks[session] || 0) + Math.abs(pnl);

    // Update trade count
    this.state.dailyTradeCount++;

    // Store in history
    this.state.tradeHistory.push({
      timestamp: Date.now(),
      pnl,
      isWin,
      pair: trade.pair,
      session
    });

    // Keep only last 100 trades
    if (this.state.tradeHistory.length > 100) {
      this.state.tradeHistory.shift();
    }

    logger.info('Trade outcome recorded', {
      pnl,
      isWin,
      dailyPnL: this.state.dailyPnL,
      consecutiveLosses: this.state.consecutiveLosses,
      dailyTradeCount: this.state.dailyTradeCount
    });
  }

  /**
   * Reset daily counters
   */
  resetDailyCounters() {
    logger.info('Resetting daily counters', { 
      previousDailyPnL: this.state.dailyPnL,
      previousTradeCount: this.state.dailyTradeCount
    });

    this.state.dailyPnL = 0;
    this.state.dailyTradeCount = 0;
    this.state.sessionRisks = {};
  }

  /**
   * Reset weekly counters
   */
  resetWeeklyCounters() {
    logger.info('Resetting weekly counters', { 
      previousWeeklyPnL: this.state.weeklyPnL
    });

    this.state.weeklyPnL = 0;
  }

  /**
   * Get current risk state
   */
  getRiskState() {
    return {
      ...this.state,
      cooldownActive: this.state.cooldownUntil && Date.now() < this.state.cooldownUntil,
      cooldownRemaining: this.state.cooldownUntil ? 
        Math.max(0, this.state.cooldownUntil - Date.now()) : 0
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('Risk management config updated', this.config);
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

// Singleton instance
export const riskManagementLayer = new RiskManagementLayer();
export default riskManagementLayer;
