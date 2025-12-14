/**
 * Three-Layer Trading Architecture
 * Separates signal generation, risk management, and execution
 */

import logger from '../services/logging/logger.js';
import { riskManagementLayer } from './risk-management-layer.js';
import { dataFreshnessGuard } from '../monitoring/data-freshness-guard.js';

/**
 * Layer 1: Signal/Intent Generator
 * Generates trading intents based on analysis
 */
export class SignalIntentGenerator {
  constructor() {
    this.pendingIntents = [];
  }

  /**
   * Generate trading intent from signal
   */
  generateIntent(signal) {
    try {
      const intent = {
        id: `INTENT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        positionSize: signal.positionSize || 0.1,
        signal_id: signal.signal_id,
        
        // Analysis data
        strength: signal.strength,
        confidence: signal.confidence,
        winProbability: signal.winProbability || 0.6,
        riskReward: signal.riskReward || 2,
        risk: Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice,
        
        // Context
        session: this.getCurrentSession(),
        timeframe: signal.timeframe,
        features: signal.features || {},
        
        // Status
        status: 'PENDING',
        layer: 'INTENT_GENERATION'
      };

      this.pendingIntents.push(intent);
      
      // Keep only last 1000 intents
      if (this.pendingIntents.length > 1000) {
        this.pendingIntents.shift();
      }

      logger.info('Trading intent generated', {
        intentId: intent.id,
        pair: intent.pair,
        direction: intent.direction
      });

      return intent;
    } catch (error) {
      logger.error('Error generating intent', { error: error.message, signal });
      throw error;
    }
  }

  /**
   * Get current trading session
   */
  getCurrentSession() {
    const hour = new Date().getUTCHours();
    
    if (hour >= 8 && hour < 16) return 'LONDON';
    if (hour >= 13 && hour < 21) return 'NEW_YORK';
    if (hour >= 0 && hour < 8) return 'TOKYO';
    return 'SYDNEY';
  }

  /**
   * Get pending intents
   */
  getPendingIntents() {
    return [...this.pendingIntents];
  }

  /**
   * Clear old intents
   */
  clearOldIntents(olderThanHours = 24) {
    const cutoff = Date.now() - (olderThanHours * 60 * 60 * 1000);
    this.pendingIntents = this.pendingIntents.filter(intent => 
      new Date(intent.timestamp).getTime() > cutoff
    );
  }
}

/**
 * Layer 2: Risk Management Layer (imported)
 * See risk-management-layer.js
 */

/**
 * Layer 3: Execution Layer
 * Executes approved trades on EA
 */
export class ExecutionLayer {
  constructor() {
    this.executionQueue = [];
    this.executedTrades = [];
    this.failedExecutions = [];
  }

  /**
   * Execute approved intent
   */
  async executeIntent(approvedIntent) {
    try {
      // Add to queue
      this.executionQueue.push({
        ...approvedIntent,
        executionStatus: 'QUEUED',
        queuedAt: new Date().toISOString()
      });

      // Simulate execution (in real system, this would call EA API)
      const execution = await this.sendToEA(approvedIntent);

      if (execution.success) {
        const trade = {
          trade_id: execution.tradeId,
          ...approvedIntent,
          executionStatus: 'EXECUTED',
          executedAt: new Date().toISOString(),
          actualEntry: execution.actualEntry,
          actualSize: execution.actualSize
        };

        this.executedTrades.push(trade);
        
        // Keep only last 1000 trades
        if (this.executedTrades.length > 1000) {
          this.executedTrades.shift();
        }

        logger.info('Trade executed successfully', {
          tradeId: trade.trade_id,
          pair: trade.pair,
          direction: trade.direction
        });

        return { success: true, trade };
      } else {
        this.failedExecutions.push({
          ...approvedIntent,
          executionStatus: 'FAILED',
          failedAt: new Date().toISOString(),
          error: execution.error
        });

        logger.error('Trade execution failed', {
          intentId: approvedIntent.id,
          error: execution.error
        });

        return { success: false, error: execution.error };
      }
    } catch (error) {
      logger.error('Execution layer error', {
        error: error.message,
        intent: approvedIntent
      });

      this.failedExecutions.push({
        ...approvedIntent,
        executionStatus: 'ERROR',
        failedAt: new Date().toISOString(),
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Send order to EA (stub - implement actual EA communication)
   */
  async sendToEA(intent) {
    // In production, this would make HTTP request to EA endpoint
    // For now, simulate execution
    
    try {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate 98% success rate
      if (Math.random() > 0.02) {
        return {
          success: true,
          tradeId: `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          actualEntry: intent.entryPrice * (1 + (Math.random() - 0.5) * 0.0001), // Small slippage
          actualSize: intent.adjustedSize || intent.positionSize
        };
      } else {
        return {
          success: false,
          error: 'EA_REJECT_INSUFFICIENT_MARGIN'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get execution statistics
   */
  getExecutionStats() {
    return {
      queued: this.executionQueue.filter(e => e.executionStatus === 'QUEUED').length,
      executed: this.executedTrades.length,
      failed: this.failedExecutions.length,
      successRate: this.executedTrades.length / 
        (this.executedTrades.length + this.failedExecutions.length) * 100 || 0
    };
  }

  /**
   * Get recent executions
   */
  getRecentExecutions(limit = 50) {
    return this.executedTrades.slice(-limit);
  }

  /**
   * Get failed executions
   */
  getFailedExecutions(limit = 50) {
    return this.failedExecutions.slice(-limit);
  }
}

/**
 * Orchestrator: Ties all three layers together
 */
export class TradingOrchestrator {
  constructor() {
    this.intentGenerator = new SignalIntentGenerator();
    this.executionLayer = new ExecutionLayer();
    this.rejectedIntents = [];
  }

  /**
   * Process a signal through all three layers
   */
  async processSignal(signal) {
    try {
      // Layer 1: Generate intent
      const intent = this.intentGenerator.generateIntent(signal);

      // Layer 2: Risk management evaluation
      const riskEvaluation = riskManagementLayer.evaluateIntent(intent);

      if (!riskEvaluation.approved) {
        // Record rejection
        this.rejectedIntents.push({
          ...intent,
          rejectedAt: new Date().toISOString(),
          rejectionReason: riskEvaluation.reason
        });

        logger.warn('Intent rejected by risk management', {
          intentId: intent.id,
          reason: riskEvaluation.reason
        });

        return {
          success: false,
          stage: 'RISK_MANAGEMENT',
          reason: riskEvaluation.reason,
          intent
        };
      }

      // Apply adjusted size if provided
      if (riskEvaluation.adjustedSize) {
        intent.adjustedSize = riskEvaluation.adjustedSize;
      }

      // Layer 3: Execute
      const execution = await this.executionLayer.executeIntent(intent);

      if (!execution.success) {
        return {
          success: false,
          stage: 'EXECUTION',
          reason: execution.error,
          intent
        };
      }

      return {
        success: true,
        trade: execution.trade,
        intent
      };
    } catch (error) {
      logger.error('Orchestrator error', {
        error: error.message,
        signal
      });

      return {
        success: false,
        stage: 'ORCHESTRATOR',
        reason: error.message,
        signal
      };
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStatistics() {
    return {
      intents: {
        pending: this.intentGenerator.getPendingIntents().length,
        rejected: this.rejectedIntents.length
      },
      execution: this.executionLayer.getExecutionStats(),
      risk: riskManagementLayer.getRiskState()
    };
  }

  /**
   * Get rejected intents
   */
  getRejectedIntents(limit = 50) {
    return this.rejectedIntents.slice(-limit);
  }

  /**
   * Record trade outcome (feeds back to risk management)
   */
  recordTradeOutcome(trade) {
    riskManagementLayer.recordTradeOutcome(trade);
  }
}

// Singleton instance
export const tradingOrchestrator = new TradingOrchestrator();
export default tradingOrchestrator;
