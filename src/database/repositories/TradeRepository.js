/**
 * Trade Repository
 * Handles trade execution data persistence
 */

import { BaseRepository } from './BaseRepository.js';

export class TradeRepository extends BaseRepository {
  constructor() {
    super('trade_executions');
  }

  /**
   * Find trades by pair
   */
  async findByPair(pair, options = {}) {
    return this.findAll({ pair }, options);
  }

  /**
   * Find trades by trade_id
   */
  async findByTradeId(tradeId) {
    return this.findOne({ trade_id: tradeId });
  }

  /**
   * Get win rate for a specific pair
   */
  async getWinRate(pair, days = 30) {
    const query = `
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN win = true THEN 1 ELSE 0 END) as winning_trades,
        ROUND(AVG(CASE WHEN win = true THEN 1 ELSE 0 END) * 100, 2) as win_rate
      FROM ${this.tableName}
      WHERE pair = $1
        AND closed_at IS NOT NULL
        AND opened_at >= NOW() - INTERVAL '${days} days'
    `;
    
    const result = await this.raw(query, [pair]);
    return result[0];
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(days = 30) {
    const query = `
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN win = true THEN 1 ELSE 0 END) as winning_trades,
        ROUND(AVG(CASE WHEN win = true THEN 1 ELSE 0 END) * 100, 2) as win_rate,
        ROUND(AVG(pnl), 2) as avg_pnl,
        ROUND(SUM(pnl), 2) as total_pnl,
        ROUND(AVG(risk_reward), 2) as avg_risk_reward,
        ROUND(MAX(pnl), 2) as max_win,
        ROUND(MIN(pnl), 2) as max_loss
      FROM ${this.tableName}
      WHERE closed_at IS NOT NULL
        AND opened_at >= NOW() - INTERVAL '${days} days'
    `;
    
    const result = await this.raw(query);
    return result[0];
  }

  /**
   * Get trades by date range
   */
  async findByDateRange(startDate, endDate, options = {}) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE opened_at >= $1 AND opened_at <= $2
      ORDER BY opened_at DESC
      LIMIT $3 OFFSET $4
    `;
    
    const { limit = 100, offset = 0 } = options;
    return this.raw(query, [startDate, endDate, limit, offset]);
  }
}

export default TradeRepository;
