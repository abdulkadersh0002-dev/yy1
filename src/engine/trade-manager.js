/**
 * Trade Manager - Automated Trade Execution and Management
 * Handles opening, monitoring, and closing trades automatically
 */

import { listTargetPairs } from '../config/pair-catalog.js';

class TradeManager {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.autoTradingEnabled = false;
    this.monitoringInterval = null;
    this.signalGenerationInterval = null;

    // Trading pairs to monitor
    this.tradingPairs = listTargetPairs();

    this.lastSignalCheck = new Map();
    this.signalCheckInterval = 900000; // 15 minutes
  }

  /**
   * Start automated trading
   */
  async startAutoTrading() {
    if (this.autoTradingEnabled) {
      console.log('Auto trading is already running');
      return { success: false, message: 'Already running' };
    }

    console.log('Starting automated trading system...');
    this.autoTradingEnabled = true;

    // Start monitoring active trades (every 10 seconds)
    this.monitoringInterval = setInterval(() => {
      this.monitorActiveTrades();
    }, 10000);

    // Start signal generation (every 5 minutes)
    this.signalGenerationInterval = setInterval(() => {
      this.checkForNewSignals();
    }, 300000);

    // Initial signal check
    this.checkForNewSignals();

    return {
      success: true,
      message: 'Auto trading started',
      pairs: this.tradingPairs.length,
      checkInterval: '5 minutes'
    };
  }

  /**
   * Stop automated trading
   */
  stopAutoTrading() {
    if (!this.autoTradingEnabled) {
      return { success: false, message: 'Auto trading is not running' };
    }

    console.log('Stopping automated trading system...');
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

    console.log('Checking for new trading signals...');

    for (const pair of this.tradingPairs) {
      try {
        // Check if enough time has passed since last check
        const lastCheck = this.lastSignalCheck.get(pair) || 0;
        if (Date.now() - lastCheck < this.signalCheckInterval) {
          continue;
        }

        // Generate signal
        const signal = await this.tradingEngine.generateSignal(pair);
        this.lastSignalCheck.set(pair, Date.now());

        // Log signal
        console.log(
          `Signal: ${pair} | ${signal.direction} | ` +
            `Strength: ${signal.strength.toFixed(0)} | ` +
            `Confidence: ${signal.confidence.toFixed(0)}% | ` +
            `Valid: ${signal.isValid.isValid}`
        );

        // Execute if valid
        if (signal.isValid.isValid && this.autoTradingEnabled) {
          const result = await this.tradingEngine.executeTrade(signal);

          if (result.success) {
            console.log(`✓ Trade opened: ${result.trade.id}`);
          } else {
            console.log(`✗ Trade rejected: ${result.reason}`);
          }
        }
      } catch (error) {
        console.error(`Error checking signal for ${pair}:`, error.message);
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
      console.error('Error monitoring trades:', error.message);
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
      failed: results.filter((r) => !r.success).length,
      results
    };
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      enabled: this.autoTradingEnabled,
      pairs: this.tradingPairs,
      activeTrades: this.tradingEngine.activeTrades.size,
      maxTrades: this.tradingEngine.config.maxConcurrentTrades,
      statistics: this.tradingEngine.getStatistics()
    };
  }

  /**
   * Add trading pair
   */
  addPair(pair) {
    if (!this.tradingPairs.includes(pair)) {
      this.tradingPairs.push(pair);
      return { success: true, message: `Added ${pair}`, pairs: this.tradingPairs };
    }
    return { success: false, message: `${pair} already exists` };
  }

  /**
   * Remove trading pair
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
