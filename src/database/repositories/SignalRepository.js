/**
 * Signal Repository
 * Handles signal/feature snapshot data persistence
 */

import { BaseRepository } from './BaseRepository.js';

export class SignalRepository extends BaseRepository {
  constructor() {
    super('feature_snapshots');
  }

  /**
   * Find signals by pair and timeframe
   */
  async findByPairAndTimeframe(pair, timeframe, options = {}) {
    return this.findAll({ pair, timeframe }, options);
  }

  /**
   * Get recent signals for a pair
   */
  async getRecentSignals(pair, hours = 24, limit = 100) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE pair = $1
        AND captured_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY captured_at DESC
      LIMIT $2
    `;
    
    return this.raw(query, [pair, limit]);
  }

  /**
   * Get signal statistics
   */
  async getSignalStats(pair, days = 7) {
    const query = `
      SELECT 
        COUNT(*) as total_signals,
        AVG(signal_strength) as avg_strength,
        AVG(signal_confidence) as avg_confidence,
        COUNT(CASE WHEN signal_direction = 'BUY' THEN 1 END) as buy_signals,
        COUNT(CASE WHEN signal_direction = 'SELL' THEN 1 END) as sell_signals,
        COUNT(CASE WHEN signal_direction = 'HOLD' THEN 1 END) as hold_signals
      FROM ${this.tableName}
      WHERE pair = $1
        AND captured_at >= NOW() - INTERVAL '${days} days'
    `;
    
    const result = await this.raw(query, [pair]);
    return result[0];
  }

  /**
   * Find similar signals by feature hash
   */
  async findSimilarSignals(featureHash, limit = 10) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE feature_hash = $1
      ORDER BY captured_at DESC
      LIMIT $2
    `;
    
    return this.raw(query, [featureHash, limit]);
  }

  /**
   * Get signals by direction
   */
  async findByDirection(direction, options = {}) {
    return this.findAll({ signal_direction: direction }, options);
  }
}

export default SignalRepository;
