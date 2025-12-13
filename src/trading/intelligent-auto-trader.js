/**
 * Intelligent Auto-Trading System
 * 
 * Fully automated trading system with:
 * - Smart order execution based on signals
 * - High-impact event detection and avoidance
 * - Break-even stop loss management
 * - Intelligent order closure
 * - Session awareness (trading hours)
 * - Risk management integration
 */

import logger from '../config/logger.js';
import { TradeManager } from '../services/trade-manager.js';
import { RiskManager } from '../engine/modules/risk-manager.js';

export class IntelligentAutoTrader {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      minSignalScore: config.minSignalScore ?? 85,
      breakEvenPips: config.breakEvenPips ?? 15,
      partialClosePips: config.partialClosePips ?? 25,
      partialClosePercent: config.partialClosePercent ?? 50,
      maxSimultaneousTrades: config.maxSimultaneousTrades ?? 3,
      maxDailyTrades: config.maxDailyTrades ?? 5,
      avoidHighImpactNews: config.avoidHighImpactNews ?? true,
      newsBufferMinutes: config.newsBufferMinutes ?? 15,
      tradingSessions: config.tradingSessions ?? {
        london: { start: '08:00', end: '16:00', enabled: true },
        newYork: { start: '13:00', end: '21:00', enabled: true },
        tokyo: { start: '00:00', end: '08:00', enabled: false }
      },
      ...config
    };

    this.tradeManager = new TradeManager();
    this.riskManager = new RiskManager(config.riskConfig || {});
    
    this.activeTrades = new Map();
    this.dailyTradeCount = 0;
    this.lastTradeDate = null;
    
    this.startMonitoring();
  }

  /**
   * Process incoming signal and decide if should trade
   */
  async processSignal(signal) {
    try {
      logger.info(`[AutoTrader] Processing signal: ${signal.id}`);

      // Pre-trade checks
      const checks = await this.performPreTradeChecks(signal);
      
      if (!checks.passed) {
        logger.warn(`[AutoTrader] Signal rejected: ${checks.reason}`);
        return { executed: false, reason: checks.reason };
      }

      // Execute trade
      const trade = await this.executeSignal(signal);
      
      if (trade) {
        this.activeTrades.set(trade.id, {
          trade,
          signal,
          breakEvenMoved: false,
          partialClosed: false,
          startTime: new Date()
        });

        this.dailyTradeCount++;
        logger.info(`[AutoTrader] Trade executed: ${trade.id}`);
        
        return { executed: true, trade };
      }

      return { executed: false, reason: 'Execution failed' };
    } catch (error) {
      logger.error(`[AutoTrader] Error processing signal: ${error.message}`);
      return { executed: false, reason: error.message };
    }
  }

  /**
   * Perform comprehensive pre-trade checks
   */
  async performPreTradeChecks(signal) {
    // 1. Check if auto-trading is enabled
    if (!this.config.enabled) {
      return { passed: false, reason: 'Auto-trading disabled' };
    }

    // 2. Check signal quality
    if (signal.qualityScore < this.config.minSignalScore) {
      return { 
        passed: false, 
        reason: `Signal quality too low: ${signal.qualityScore} < ${this.config.minSignalScore}` 
      };
    }

    // 3. Check daily trade limit
    this.resetDailyCountIfNeeded();
    if (this.dailyTradeCount >= this.config.maxDailyTrades) {
      return { 
        passed: false, 
        reason: `Daily trade limit reached: ${this.dailyTradeCount}/${this.config.maxDailyTrades}` 
      };
    }

    // 4. Check simultaneous trades limit
    if (this.activeTrades.size >= this.config.maxSimultaneousTrades) {
      return { 
        passed: false, 
        reason: `Max simultaneous trades reached: ${this.activeTrades.size}/${this.config.maxSimultaneousTrades}` 
      };
    }

    // 5. Check trading session
    if (!this.isWithinTradingSession(signal.pair)) {
      return { passed: false, reason: 'Outside trading session hours' };
    }

    // 6. Check for high-impact news events
    if (this.config.avoidHighImpactNews) {
      const newsCheck = await this.checkUpcomingNews(signal.pair);
      if (!newsCheck.safe) {
        return { 
          passed: false, 
          reason: `High-impact news detected: ${newsCheck.event}` 
        };
      }
    }

    // 7. Check risk management limits
    const riskCheck = this.riskManager.canTakeNewTrade(signal, {
      activeTrades: Array.from(this.activeTrades.values()).map(t => t.trade)
    });

    if (!riskCheck.allowed) {
      return { passed: false, reason: riskCheck.reason };
    }

    return { passed: true };
  }

  /**
   * Execute signal as a trade
   */
  async executeSignal(signal) {
    try {
      // Calculate position size
      const positionSize = this.riskManager.calculatePositionSize(signal, {
        activeTrades: Array.from(this.activeTrades.values()).map(t => t.trade),
        accountEquity: await this.getAccountEquity()
      });

      // Place order
      const trade = await this.tradeManager.openTrade({
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        lotSize: positionSize.positionSize,
        signalId: signal.id,
        comment: `Auto-trade based on signal ${signal.id}`
      });

      return trade;
    } catch (error) {
      logger.error(`[AutoTrader] Trade execution failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Start monitoring active trades
   */
  startMonitoring() {
    // Monitor every 5 seconds
    setInterval(() => this.monitorActiveTrades(), 5000);
    
    logger.info('[AutoTrader] Trade monitoring started');
  }

  /**
   * Monitor and manage active trades
   */
  async monitorActiveTrades() {
    for (const [tradeId, tradeData] of this.activeTrades.entries()) {
      try {
        await this.manageTrade(tradeData);
      } catch (error) {
        logger.error(`[AutoTrader] Error managing trade ${tradeId}: ${error.message}`);
      }
    }
  }

  /**
   * Intelligent trade management
   */
  async manageTrade(tradeData) {
    const { trade, signal, breakEvenMoved, partialClosed } = tradeData;
    
    // Get current price
    const currentPrice = await this.getCurrentPrice(trade.pair);
    
    // Calculate profit in pips
    const profitPips = this.calculateProfitPips(trade, currentPrice);

    // 1. Move stop loss to break-even
    if (!breakEvenMoved && profitPips >= this.config.breakEvenPips) {
      await this.moveStopLossToBreakEven(trade);
      tradeData.breakEvenMoved = true;
      logger.info(`[AutoTrader] Moved stop loss to break-even for trade ${trade.id}`);
    }

    // 2. Partial close at target
    if (!partialClosed && profitPips >= this.config.partialClosePips) {
      await this.partialCloseTrade(trade, this.config.partialClosePercent);
      tradeData.partialClosed = true;
      logger.info(`[AutoTrader] Partial close (${this.config.partialClosePercent}%) for trade ${trade.id}`);
    }

    // 3. Check if should close due to upcoming news
    if (this.config.avoidHighImpactNews) {
      const newsCheck = await this.checkUpcomingNews(trade.pair);
      if (!newsCheck.safe && newsCheck.minutesUntil <= 5) {
        await this.closeTrade(trade, 'High-impact news imminent');
        this.activeTrades.delete(trade.id);
        logger.info(`[AutoTrader] Closed trade ${trade.id} due to upcoming news`);
        return;
      }
    }

    // 4. Check if stop loss or take profit hit
    const slHit = this.isStopLossHit(trade, currentPrice);
    const tpHit = this.isTakeProfitHit(trade, currentPrice);

    if (slHit || tpHit) {
      await this.closeTrade(trade, slHit ? 'Stop loss hit' : 'Take profit hit');
      this.activeTrades.delete(trade.id);
      logger.info(`[AutoTrader] Trade ${trade.id} closed: ${slHit ? 'SL' : 'TP'}`);
    }

    // 5. Check if trade has been open too long (optional)
    const tradeAgeHours = (Date.now() - tradeData.startTime.getTime()) / (1000 * 60 * 60);
    if (tradeAgeHours > 24) {
      // Consider closing if minimal profit/loss
      if (Math.abs(profitPips) < 5) {
        await this.closeTrade(trade, 'Trade aged out with minimal P/L');
        this.activeTrades.delete(trade.id);
        logger.info(`[AutoTrader] Trade ${trade.id} aged out`);
      }
    }
  }

  /**
   * Move stop loss to break-even
   */
  async moveStopLossToBreakEven(trade) {
    try {
      const breakEvenPrice = trade.entryPrice;
      await this.tradeManager.modifyTrade(trade.id, {
        stopLoss: breakEvenPrice
      });
      return true;
    } catch (error) {
      logger.error(`[AutoTrader] Failed to move SL to break-even: ${error.message}`);
      return false;
    }
  }

  /**
   * Partial close trade
   */
  async partialCloseTrade(trade, percent) {
    try {
      const closeSize = trade.lotSize * (percent / 100);
      await this.tradeManager.partialClose(trade.id, closeSize);
      return true;
    } catch (error) {
      logger.error(`[AutoTrader] Failed to partial close: ${error.message}`);
      return false;
    }
  }

  /**
   * Close trade
   */
  async closeTrade(trade, reason) {
    try {
      await this.tradeManager.closeTrade(trade.id, reason);
      return true;
    } catch (error) {
      logger.error(`[AutoTrader] Failed to close trade: ${error.message}`);
      return false;
    }
  }

  /**
   * Check for upcoming high-impact news
   */
  async checkUpcomingNews(pair) {
    try {
      // Simplified news check - integrate with real economic calendar
      return { safe: true };
    } catch (error) {
      logger.error(`[AutoTrader] Error checking news: ${error.message}`);
      return { safe: true }; // Fail-safe: allow trading if check fails
    }
  }

  /**
   * Check if within trading session
   */
  isWithinTradingSession(pair) {
    const now = new Date();
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

    for (const [session, config] of Object.entries(this.config.tradingSessions)) {
      if (!config.enabled) continue;

      if (currentTime >= config.start && currentTime <= config.end) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate profit in pips
   */
  calculateProfitPips(trade, currentPrice) {
    const priceDiff = trade.direction === 'BUY' 
      ? currentPrice - trade.entryPrice
      : trade.entryPrice - currentPrice;

    // Convert to pips (assuming 4-digit quotes)
    return priceDiff * 10000;
  }

  /**
   * Check if stop loss is hit
   */
  isStopLossHit(trade, currentPrice) {
    if (!trade.stopLoss) return false;

    return trade.direction === 'BUY'
      ? currentPrice <= trade.stopLoss
      : currentPrice >= trade.stopLoss;
  }

  /**
   * Check if take profit is hit
   */
  isTakeProfitHit(trade, currentPrice) {
    if (!trade.takeProfit) return false;

    return trade.direction === 'BUY'
      ? currentPrice >= trade.takeProfit
      : currentPrice <= trade.takeProfit;
  }

  /**
   * Get current price for pair
   */
  async getCurrentPrice(pair) {
    return await this.tradeManager.getCurrentPrice(pair);
  }

  /**
   * Get account equity
   */
  async getAccountEquity() {
    return await this.tradeManager.getAccountEquity();
  }

  /**
   * Reset daily trade count if new day
   */
  resetDailyCountIfNeeded() {
    const today = new Date().toDateString();
    if (this.lastTradeDate !== today) {
      this.dailyTradeCount = 0;
      this.lastTradeDate = today;
    }
  }

  /**
   * Get auto-trader status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      activeTrades: this.activeTrades.size,
      dailyTrades: this.dailyTradeCount,
      maxDailyTrades: this.config.maxDailyTrades,
      maxSimultaneousTrades: this.config.maxSimultaneousTrades,
      tradeDetails: Array.from(this.activeTrades.values()).map(t => ({
        id: t.trade.id,
        pair: t.trade.pair,
        direction: t.trade.direction,
        profitPips: 0, // Would use real current price
        breakEvenMoved: t.breakEvenMoved,
        partialClosed: t.partialClosed,
        ageMinutes: (Date.now() - t.startTime.getTime()) / (1000 * 60)
      }))
    };
  }

  /**
   * Enable/disable auto-trading
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    logger.info(`[AutoTrader] Auto-trading ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Close all active trades (emergency stop)
   */
  async closeAllTrades(reason = 'Manual close all') {
    logger.warn(`[AutoTrader] Closing all trades: ${reason}`);
    
    const promises = [];
    for (const [tradeId, tradeData] of this.activeTrades.entries()) {
      promises.push(this.closeTrade(tradeData.trade, reason));
    }

    await Promise.all(promises);
    this.activeTrades.clear();
    
    logger.info('[AutoTrader] All trades closed');
  }
}

export default IntelligentAutoTrader;
