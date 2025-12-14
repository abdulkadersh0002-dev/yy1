/**
 * Trade Persistence Service
 * Handles storing and retrieving trade execution data from database
 */

import { tradeRepository } from '../index.js';
import logger from '../../services/logging/logger.js';

export class TradePersistenceService {
  /**
   * Save a new trade execution
   */
  async saveTrade(trade) {
    try {
      const tradeData = {
        trade_id: trade.id || trade.trade_id || this.generateTradeId(),
        signal_id: trade.signal_id || trade.signalId,
        
        // Trade details
        pair: trade.pair,
        direction: trade.direction,
        entry_price: trade.entry || trade.entry_price,
        stop_loss: trade.sl || trade.stop_loss,
        take_profit: trade.tp || trade.take_profit,
        position_size: trade.positionSize || trade.position_size,
        
        // Risk management
        risk_reward: trade.riskReward || trade.risk_reward,
        risk_amount: trade.riskAmount || trade.risk_amount,
        potential_profit: trade.potentialProfit || trade.potential_profit,
        
        // Execution details
        execution_type: trade.executionType || trade.execution_type || 'market',
        slippage_pips: trade.slippagePips || trade.slippage_pips || 0,
        commission: trade.commission || 0,
        
        // Management
        managed_by: trade.managedBy || trade.managed_by || 'manual',
        opened_during_session: trade.session || trade.opened_during_session,
        
        // Timestamps
        opened_at: trade.opened_at || trade.timestamp || new Date(),
        
        // Metadata
        metadata: trade.metadata || {},
        management_events: trade.management_events || []
      };

      const saved = await tradeRepository.create(tradeData);
      
      logger.info('Trade saved to database', {
        trade_id: saved.trade_id,
        pair: saved.pair,
        direction: saved.direction,
        managed_by: saved.managed_by
      });

      return saved;
    } catch (error) {
      logger.error('Failed to save trade', {
        error: error.message,
        trade: trade?.trade_id || trade?.id
      });
      throw error;
    }
  }

  /**
   * Update trade (e.g., when closing or managing)
   */
  async updateTrade(tradeId, updates) {
    try {
      // Calculate P&L if closing trade
      if (updates.exit_price || updates.closed_at) {
        const trade = await tradeRepository.findByTradeId(tradeId);
        
        if (trade && updates.exit_price) {
          const pips = this.calculatePips(
            trade.pair,
            trade.entry_price,
            updates.exit_price,
            trade.direction
          );
          
          updates.pnl_pips = pips;
          updates.pnl = pips * (trade.position_size * 10); // Rough calculation
        }
        
        if (updates.closed_at) {
          updates.closed_at = new Date(updates.closed_at);
        }
      }

      await tradeRepository.update(tradeId, updates, 'trade_id');
      
      logger.info('Trade updated in database', {
        trade_id: tradeId,
        updates: Object.keys(updates)
      });

      return await tradeRepository.findByTradeId(tradeId);
    } catch (error) {
      logger.error('Failed to update trade', {
        error: error.message,
        trade_id: tradeId
      });
      throw error;
    }
  }

  /**
   * Close trade
   */
  async closeTrade(tradeId, exitPrice, closedReason) {
    try {
      return await this.updateTrade(tradeId, {
        exit_price: exitPrice,
        closed_at: new Date(),
        closed_reason: closedReason
      });
    } catch (error) {
      logger.error('Failed to close trade', {
        error: error.message,
        trade_id: tradeId
      });
      throw error;
    }
  }

  /**
   * Record break-even move
   */
  async recordBreakEven(tradeId) {
    try {
      return await this.updateTrade(tradeId, {
        break_even_moved: true,
        break_even_at: new Date()
      });
    } catch (error) {
      logger.error('Failed to record break-even', {
        error: error.message,
        trade_id: tradeId
      });
      throw error;
    }
  }

  /**
   * Record partial close
   */
  async recordPartialClose(tradeId, amount) {
    try {
      return await this.updateTrade(tradeId, {
        partial_close_executed: true,
        partial_close_at: new Date(),
        partial_close_amount: amount
      });
    } catch (error) {
      logger.error('Failed to record partial close', {
        error: error.message,
        trade_id: tradeId
      });
      throw error;
    }
  }

  /**
   * Get active trades
   */
  async getActiveTrades(pair = null) {
    try {
      const conditions = { closed_at: null };
      
      if (pair) {
        conditions.pair = pair;
      }

      return await tradeRepository.findAll(conditions, { orderBy: 'opened_at DESC' });
    } catch (error) {
      logger.error('Failed to get active trades', { error: error.message });
      throw error;
    }
  }

  /**
   * Get trade history
   */
  async getTradeHistory(pair = null, days = 30) {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      return await tradeRepository.findByDateRange(startDate, endDate, { limit: 1000 });
    } catch (error) {
      logger.error('Failed to get trade history', { error: error.message });
      throw error;
    }
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(days = 30) {
    try {
      return await tradeRepository.getPerformanceStats(days);
    } catch (error) {
      logger.error('Failed to get performance stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Get win rate for a pair
   */
  async getWinRate(pair, days = 30) {
    try {
      return await tradeRepository.getWinRate(pair, days);
    } catch (error) {
      logger.error('Failed to get win rate', { error: error.message });
      throw error;
    }
  }

  /**
   * Calculate pips difference
   */
  calculatePips(pair, entryPrice, exitPrice, direction) {
    const diff = direction === 'BUY' 
      ? exitPrice - entryPrice 
      : entryPrice - exitPrice;
    
    // JPY pairs have 2 decimals, others have 4-5
    const pipMultiplier = pair.includes('JPY') ? 100 : 10000;
    
    return parseFloat((diff * pipMultiplier).toFixed(2));
  }

  /**
   * Generate unique trade ID
   */
  generateTradeId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `TR-${timestamp}-${random}`;
  }
}

export default new TradePersistenceService();
