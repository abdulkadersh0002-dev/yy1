/**
 * Trade Manager - Automated Trade Execution and Management
 * Handles opening, monitoring, and closing trades automatically
 */

import { listTargetPairs } from '../config/pair-catalog.js';
import logger from '../services/logging/logger.js';

class TradeManager {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.autoTradingEnabled = false;
    this.monitoringInterval = null;
    this.signalGenerationInterval = null;

    // Trading pairs to monitor
    this.tradingPairs = listTargetPairs();

    this.lastSignalCheck = new Map();

    const config = this.tradingEngine?.config || {};
    const autoTradingConfig = config.autoTrading || {};

    this.signalCheckInterval = Number.isFinite(autoTradingConfig.signalCheckIntervalMs)
      ? autoTradingConfig.signalCheckIntervalMs
      : 900000; // 15 minutes default

    this.monitoringIntervalMs = Number.isFinite(autoTradingConfig.monitoringIntervalMs)
      ? autoTradingConfig.monitoringIntervalMs
      : 10000; // 10 seconds default

    this.signalGenerationIntervalMs = Number.isFinite(autoTradingConfig.signalGenerationIntervalMs)
      ? autoTradingConfig.signalGenerationIntervalMs
      : 300000; // 5 minutes default
  }

  /**
   * Start automated trading
   */
  async startAutoTrading() {
    if (this.autoTradingEnabled) {
      logger.info({ module: 'TradeManager' }, 'Auto trading is already running');
      return { success: false, message: 'Already running' };
    }

    logger.info({ module: 'TradeManager' }, 'Starting automated trading system...');
    this.autoTradingEnabled = true;

    // Start monitoring active trades
    this.monitoringInterval = setInterval(() => {
      void this.monitorActiveTrades();
    }, this.monitoringIntervalMs);

    // Start signal generation
    this.signalGenerationInterval = setInterval(() => {
      void this.checkForNewSignals();
    }, this.signalGenerationIntervalMs);

    // Initial signal check
    this.checkForNewSignals();

    return {
      success: true,
      message: 'Auto trading started',
      pairs: this.tradingPairs.length,
      checkIntervalMs: this.signalGenerationIntervalMs
    };
  }

  /**
   * Stop automated trading
   */
  stopAutoTrading() {
    if (!this.autoTradingEnabled) {
      return { success: false, message: 'Auto trading is not running' };
    }

    logger.info({ module: 'TradeManager' }, 'Stopping automated trading system...');
    this.autoTradingEnabled = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.signalGenerationInterval) {
      clearInterval(this.signalGenerationInterval);
      this.signalGenerationInterval = null;
    }

    return {
      success: true,
      message: 'Auto trading stopped',
      activeTrades: this.tradingEngine.activeTrades.size
    };
  }

  /**
   * Check for new trading signals
   */
  async checkForNewSignals() {
    if (!this.autoTradingEnabled) return;

    logger.debug({ module: 'TradeManager' }, 'Checking for new trading signals...');

    for (const pair of this.tradingPairs) {
      try {
        // Check if enough time has passed since last check
        const lastCheck = this.lastSignalCheck.get(pair) || 0;
        if (Date.now() - lastCheck < this.signalCheckInterval) {
          continue;
        }

        // Generate signal (includes risk checks + validateSignal)
        const signal = await this.tradingEngine.generateSignal(pair);
        this.lastSignalCheck.set(pair, Date.now());

        // Log signal
        logger.info(
          {
            module: 'TradeManager',
            pair,
            direction: signal.direction,
            strength: signal.strength,
            confidence: signal.confidence,
            isValid: signal.isValid?.isValid
          },
          'Auto-trading signal evaluated'
        );

        // Execute if valid
        if (signal.isValid.isValid && this.autoTradingEnabled) {
          const result = await this.tradingEngine.executeTrade(signal);

          if (result.success) {
            logger.info(
              { module: 'TradeManager', tradeId: result.trade?.id, pair },
              'Auto-trading opened trade'
            );
          } else {
            logger.warn(
              { module: 'TradeManager', pair, reason: result.reason },
              'Auto-trading trade rejected'
            );
          }
        }
      } catch (error) {
        const classified =
          this.tradingEngine.classifyError?.(error, {
            scope: 'TradeManager.checkForNewSignals',
            pair
          }) || {
            type: 'unknown',
            category: 'Unknown engine error',
            context: { scope: 'TradeManager.checkForNewSignals', pair }
          };
        logger.error(
          { module: 'TradeManager', pair, err: error, errorType: classified.type },
          'Error checking signal for pair'
        );
      }
    }
  }

  /**
   * Monitor active trades
   */
  async monitorActiveTrades() {
    if (!this.autoTradingEnabled) return;

    try {
      await this.tradingEngine.manageActiveTrades();
    } catch (error) {
      const classified =
        this.tradingEngine.classifyError?.(error, {
          scope: 'TradeManager.monitorActiveTrades'
        }) || {
          type: 'unknown',
          category: 'Unknown engine error',
          context: { scope: 'TradeManager.monitorActiveTrades' }
        };
      logger.error(
        { module: 'TradeManager', err: error, errorType: classified.type },
        'Error monitoring trades'
      );
    }
  }

  /**
   * Force close all trades
   */
  async closeAllTrades() {
    const trades = Array.from(this.tradingEngine.activeTrades.keys());
    const results = [];

    for (const tradeId of trades) {
      try {
        const trade = this.tradingEngine.activeTrades.get(tradeId);
        const currentPrice = await this.tradingEngine.getCurrentPriceForPair(trade.pair);
        const closed = await this.tradingEngine.closeTrade(tradeId, currentPrice, 'manual_close');
        results.push({ tradeId, success: true, trade: closed });
      } catch (error) {
        results.push({ tradeId, success: false, error: error.message });
      }
    }

    return {
      success: true,
      closed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length
    };
  }

  getStatus() {
    return {
      enabled: this.autoTradingEnabled,
      pairs: this.tradingPairs,
      activeTrades: this.tradingEngine.activeTrades.size,
      statistics: this.tradingEngine.getStatistics()
    };
  }
  addPair(pair) {
    if (!this.tradingPairs.includes(pair)) {
      this.tradingPairs.push(pair);
      return { success: true, message: `Added ${pair}`, pairs: this.tradingPairs };
    }
    return { success: false, message: `${pair} already exists` };
  }

  /**
      logger.error({ module: 'TradeManager', err: error }, 'Error monitoring trades');
   */
  removePair(pair) {
    const index = this.tradingPairs.indexOf(pair);
    if (index > -1) {
      this.tradingPairs.splice(index, 1);
      return { success: true, message: `Removed ${pair}`, pairs: this.tradingPairs };
    }
    return { success: false, message: `${pair} not found` };
  }
}

export default TradeManager;
