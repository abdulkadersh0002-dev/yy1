/**
 * Signal Persistence Service
 * Handles storing and retrieving trading signals from database
 */

import { signalRepository } from '../index.js';
import logger from '../../services/logging/logger.js';

export class SignalPersistenceService {
  /**
   * Save a new trading signal
   */
  async saveSignal(signal) {
    try {
      const signalData = {
        signal_id: signal.id || signal.signal_id || this.generateSignalId(),
        pair: signal.pair,
        timeframe: signal.timeframe,
        signal_direction: signal.direction || signal.signal_direction,
        signal_strength: signal.strength || signal.signal_strength,
        signal_confidence: signal.confidence || signal.signal_confidence,
        signal_quality: signal.quality || signal.signal_quality || 0,
        
        // Entry details
        entry_price: signal.entry || signal.entry_price,
        stop_loss: signal.sl || signal.stop_loss,
        take_profit: signal.tp || signal.take_profit,
        risk_reward: signal.riskReward || signal.risk_reward,
        position_size: signal.positionSize || signal.position_size,
        
        // Technical features
        features: signal.features || {},
        indicators: signal.indicators || {},
        
        // AI/ML predictions
        ai_prediction: signal.aiPrediction || signal.ai_prediction,
        ai_confidence: signal.aiConfidence || signal.ai_confidence,
        ml_score: signal.mlScore || signal.ml_score,
        
        // Sources
        sources: signal.sources || [],
        validation_stages: signal.validationStages || signal.validation_stages || [],
        filter_results: signal.filterResults || signal.filter_results || {},
        
        // Status
        status: signal.status || 'pending',
        
        // Timestamps
        captured_at: signal.captured_at || signal.timestamp || new Date(),
        expires_at: signal.expires_at || this.calculateExpiry(signal.timeframe),
        
        // Metadata
        metadata: signal.metadata || {}
      };

      const saved = await signalRepository.create(signalData);
      
      logger.info('Signal saved to database', {
        signal_id: saved.signal_id,
        pair: saved.pair,
        direction: saved.signal_direction,
        quality: saved.signal_quality
      });

      return saved;
    } catch (error) {
      logger.error('Failed to save signal', {
        error: error.message,
        signal: signal?.signal_id || signal?.id
      });
      throw error;
    }
  }

  /**
   * Update signal status
   */
  async updateSignalStatus(signalId, status, outcome = null) {
    try {
      const updates = { status };
      
      if (outcome) {
        updates.outcome = outcome;
      }
      
      if (status === 'executed') {
        updates.executed_at = new Date();
      } else if (status === 'closed') {
        updates.closed_at = new Date();
      }

      await signalRepository.update(signalId, updates, 'signal_id');
      
      logger.info('Signal status updated', {
        signal_id: signalId,
        status,
        outcome
      });
    } catch (error) {
      logger.error('Failed to update signal status', {
        error: error.message,
        signal_id: signalId
      });
      throw error;
    }
  }

  /**
   * Get recent signals
   */
  async getRecentSignals(pair = null, hours = 24, status = null) {
    try {
      const conditions = {};
      
      if (pair) {
        conditions.pair = pair;
      }
      
      if (status) {
        conditions.status = status;
      }

      const signals = await signalRepository.getRecentSignals(pair, hours);
      
      // Filter by status if provided
      if (status) {
        return signals.filter(s => s.status === status);
      }
      
      return signals;
    } catch (error) {
      logger.error('Failed to get recent signals', { error: error.message });
      throw error;
    }
  }

  /**
   * Get signal statistics
   */
  async getSignalStats(pair = null, days = 30) {
    try {
      return await signalRepository.getSignalStats(pair, days);
    } catch (error) {
      logger.error('Failed to get signal stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Find similar signals (for pattern matching)
   */
  async findSimilarSignals(signal, limit = 10) {
    try {
      return await signalRepository.findSimilarSignals(signal, limit);
    } catch (error) {
      logger.error('Failed to find similar signals', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate unique signal ID
   */
  generateSignalId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `SIG-${timestamp}-${random}`;
  }

  /**
   * Calculate expiry time based on timeframe
   */
  calculateExpiry(timeframe) {
    const expiryMinutes = {
      'M1': 5,
      'M5': 15,
      'M15': 60,
      'M30': 120,
      'H1': 240,
      'H4': 960,
      'D1': 1440
    };

    const minutes = expiryMinutes[timeframe] || 60;
    return new Date(Date.now() + minutes * 60 * 1000);
  }
}

export default new SignalPersistenceService();
