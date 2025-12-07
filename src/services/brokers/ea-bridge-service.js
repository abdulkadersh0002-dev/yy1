/**
 * EA Bridge Service - Enhanced MT4/MT5 Expert Advisor Communication
 * Handles intelligent trade execution, dynamic stop-loss management, and learning from trades
 */

import logger from '../logging/logger.js';

class EaBridgeService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.tradingEngine = options.tradingEngine;
    this.brokerRouter = options.brokerRouter;
    
    // Active EA sessions
    this.sessions = new Map();
    
    // Trade performance history for learning
    this.tradeHistory = [];
    this.maxHistorySize = 1000;
    
    // Learning parameters
    this.riskAdjustmentFactor = 1.0;
    this.stopLossAdjustmentFactor = 1.0;
    this.winRate = 0.5;
    this.avgProfit = 0;
    this.avgLoss = 0;
    
    // Dynamic risk management
    this.consecutiveLosses = 0;
    this.consecutiveWins = 0;
    this.maxConsecutiveLosses = 3;
  }

  /**
   * Register EA session
   */
  registerSession(payload) {
    const { accountNumber, accountMode, broker, equity, balance, server, currency } = payload;
    
    if (!accountNumber || !broker) {
      throw new Error('Account number and broker are required');
    }

    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    const session = {
      id: sessionId,
      broker,
      accountNumber,
      accountMode,
      equity: Number(equity) || 0,
      balance: Number(balance) || 0,
      server,
      currency,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      isActive: true,
      tradesExecuted: 0,
      profitLoss: 0
    };

    this.sessions.set(sessionId, session);
    
    this.logger.info(
      { sessionId, broker, accountMode, accountNumber },
      'EA session registered'
    );

    return {
      success: true,
      sessionId,
      message: 'Session registered successfully',
      intelligentFeatures: {
        dynamicStopLoss: true,
        adaptiveRisk: true,
        learningEnabled: true
      }
    };
  }

  /**
   * Disconnect EA session
   */
  disconnectSession(payload) {
    const { accountNumber, accountMode, broker } = payload;
    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.disconnectedAt = Date.now();
      this.sessions.delete(sessionId);
      
      this.logger.info({ sessionId }, 'EA session disconnected');
      return { success: true, message: 'Session disconnected' };
    }

    return { success: false, message: 'Session not found' };
  }

  /**
   * Handle heartbeat from EA
   */
  handleHeartbeat(payload) {
    const { accountNumber, accountMode, broker, equity, timestamp } = payload;
    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found. Please reconnect.' };
    }

    session.lastHeartbeat = Date.now();
    session.equity = Number(equity) || session.equity;
    
    return {
      success: true,
      instructions: this.getIntelligentInstructions(session)
    };
  }

  /**
   * Get intelligent trading instructions based on current performance
   */
  getIntelligentInstructions(session) {
    return {
      riskMultiplier: this.riskAdjustmentFactor,
      stopLossMultiplier: this.stopLossAdjustmentFactor,
      tradingEnabled: this.shouldEnableTrading(),
      maxPositionSize: this.calculateMaxPositionSize(session),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Handle trade transaction from EA
   */
  async handleTransaction(payload) {
    const {
      type,
      order,
      deal,
      symbol,
      volume,
      price,
      profit,
      timestamp,
      accountNumber,
      accountMode,
      broker
    } = payload;

    const sessionId = `${broker}-${accountMode}-${accountNumber}`;
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    // Record transaction
    const transaction = {
      id: `${broker}-${deal || order}-${Date.now()}`,
      type,
      order: Number(order) || 0,
      deal: Number(deal) || 0,
      symbol,
      volume: Number(volume) || 0,
      price: Number(price) || 0,
      profit: Number(profit) || 0,
      timestamp: Number(timestamp) || Date.now(),
      broker,
      accountNumber,
      receivedAt: Date.now()
    };

    // Learn from completed trades
    if (type === 'HISTORY_ADD' || type === 'DEAL_ADD') {
      this.learnFromTrade(transaction);
      session.tradesExecuted += 1;
      session.profitLoss += transaction.profit;
    }

    this.logger.info(
      { sessionId, type, symbol, profit: transaction.profit },
      'EA transaction received'
    );

    return {
      success: true,
      message: 'Transaction recorded',
      learning: {
        currentWinRate: this.winRate.toFixed(3),
        consecutiveLosses: this.consecutiveLosses,
        consecutiveWins: this.consecutiveWins,
        riskAdjustment: this.riskAdjustmentFactor.toFixed(2),
        stopLossAdjustment: this.stopLossAdjustmentFactor.toFixed(2)
      }
    };
  }

  /**
   * Learn from trade results
   */
  learnFromTrade(transaction) {
    const { profit, volume } = transaction;
    
    // Add to history
    this.tradeHistory.push({
      profit,
      volume,
      timestamp: transaction.timestamp,
      symbol: transaction.symbol
    });

    // Keep history bounded
    if (this.tradeHistory.length > this.maxHistorySize) {
      this.tradeHistory.shift();
    }

    // Update consecutive counters
    if (profit > 0) {
      this.consecutiveWins += 1;
      this.consecutiveLosses = 0;
    } else if (profit < 0) {
      this.consecutiveLosses += 1;
      this.consecutiveWins = 0;
    }

    // Recalculate statistics
    this.updateLearningParameters();
    
    // Adjust risk based on performance
    this.adjustRiskParameters();
  }

  /**
   * Update learning parameters based on trade history
   */
  updateLearningParameters() {
    if (this.tradeHistory.length === 0) {
      return;
    }

    const wins = this.tradeHistory.filter((t) => t.profit > 0);
    const losses = this.tradeHistory.filter((t) => t.profit < 0);

    // Update win rate
    this.winRate = wins.length / this.tradeHistory.length;

    // Update average profit/loss
    if (wins.length > 0) {
      this.avgProfit = wins.reduce((sum, t) => sum + t.profit, 0) / wins.length;
    }
    if (losses.length > 0) {
      this.avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0) / losses.length);
    }
  }

  /**
   * Adjust risk parameters based on recent performance
   */
  adjustRiskParameters() {
    // Reduce risk after consecutive losses
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      this.riskAdjustmentFactor = Math.max(0.5, this.riskAdjustmentFactor * 0.8);
      this.logger.warn(
        { consecutiveLosses: this.consecutiveLosses, newFactor: this.riskAdjustmentFactor },
        'Risk reduced due to consecutive losses'
      );
    }
    // Gradually increase risk after consecutive wins
    else if (this.consecutiveWins >= 3) {
      this.riskAdjustmentFactor = Math.min(1.5, this.riskAdjustmentFactor * 1.1);
    }
    // Return to normal
    else if (this.consecutiveLosses === 0 && this.consecutiveWins === 0) {
      this.riskAdjustmentFactor = this.riskAdjustmentFactor * 0.95 + 1.0 * 0.05; // Slowly return to 1.0
    }

    // Adjust stop-loss based on win rate
    if (this.winRate < 0.4) {
      // Tighter stop-loss when losing
      this.stopLossAdjustmentFactor = Math.max(0.7, this.stopLossAdjustmentFactor * 0.95);
    } else if (this.winRate > 0.6) {
      // Wider stop-loss when winning (let profits run)
      this.stopLossAdjustmentFactor = Math.min(1.3, this.stopLossAdjustmentFactor * 1.05);
    }
  }

  /**
   * Determine if trading should be enabled
   */
  shouldEnableTrading() {
    // Disable if too many consecutive losses
    if (this.consecutiveLosses >= this.maxConsecutiveLosses * 2) {
      return false;
    }
    return true;
  }

  /**
   * Calculate maximum position size based on session and performance
   */
  calculateMaxPositionSize(session) {
    const baseSize = (session.equity || 10000) * 0.02; // 2% of equity
    return baseSize * this.riskAdjustmentFactor;
  }

  /**
   * Generate recommendations based on learning
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.consecutiveLosses >= 2) {
      recommendations.push('Consider reducing position sizes');
    }
    if (this.winRate < 0.4) {
      recommendations.push('Review trading strategy - win rate below 40%');
    }
    if (this.avgLoss > this.avgProfit * 2) {
      recommendations.push('Average loss exceeds average profit - tighten stop-loss');
    }
    if (this.consecutiveWins >= 5) {
      recommendations.push('Strong performance - consider gradual risk increase');
    }

    return recommendations;
  }

  /**
   * Get signal for EA to execute
   */
  async getSignalForExecution(payload) {
    const { symbol, broker, accountMode } = payload;
    
    try {
      // Generate signal using trading engine
      const signal = await this.tradingEngine?.generateSignal(symbol);
      
      if (!signal || !signal.isValid?.isValid) {
        return {
          success: false,
          message: 'No valid signal available',
          signal: null
        };
      }

      // Adjust signal based on learning
      const adjustedSignal = this.adjustSignalWithLearning(signal);

      return {
        success: true,
        signal: adjustedSignal,
        execution: {
          shouldExecute: this.shouldEnableTrading(),
          riskMultiplier: this.riskAdjustmentFactor,
          stopLossMultiplier: this.stopLossAdjustmentFactor
        }
      };
    } catch (error) {
      this.logger.error({ err: error, symbol }, 'Error getting signal for EA');
      return {
        success: false,
        message: error.message,
        signal: null
      };
    }
  }

  /**
   * Adjust signal parameters based on learning
   */
  adjustSignalWithLearning(signal) {
    return {
      ...signal,
      adjustedRisk: (signal.risk || 0.02) * this.riskAdjustmentFactor,
      adjustedStopLoss: signal.stopLoss ? signal.stopLoss * this.stopLossAdjustmentFactor : null,
      learningMetrics: {
        winRate: this.winRate,
        riskFactor: this.riskAdjustmentFactor,
        stopLossFactor: this.stopLossAdjustmentFactor
      }
    };
  }

  /**
   * Get bridge statistics
   */
  getStatistics() {
    const activeSessions = Array.from(this.sessions.values()).filter((s) => s.isActive);
    
    return {
      activeSessions: activeSessions.length,
      totalTradesExecuted: activeSessions.reduce((sum, s) => sum + s.tradesExecuted, 0),
      totalProfitLoss: activeSessions.reduce((sum, s) => sum + s.profitLoss, 0),
      learning: {
        winRate: this.winRate,
        tradeHistorySize: this.tradeHistory.length,
        consecutiveLosses: this.consecutiveLosses,
        consecutiveWins: this.consecutiveWins,
        riskAdjustment: this.riskAdjustmentFactor,
        stopLossAdjustment: this.stopLossAdjustmentFactor,
        avgProfit: this.avgProfit,
        avgLoss: this.avgLoss
      },
      sessions: activeSessions.map((s) => ({
        id: s.id,
        broker: s.broker,
        accountMode: s.accountMode,
        tradesExecuted: s.tradesExecuted,
        profitLoss: s.profitLoss,
        connectedAt: s.connectedAt,
        lastHeartbeat: s.lastHeartbeat
      }))
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.isActive);
  }
}

export default EaBridgeService;
