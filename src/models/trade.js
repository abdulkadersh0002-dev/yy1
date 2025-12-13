/**
 * Trade Domain Model
 * Represents an active or historical trade with P&L tracking
 */

import { z } from 'zod';
import { BaseModel } from './base-model.js';

const TradePnlSchema = z.object({
  amount: z.number().nullable(),
  percentage: z.number().nullable()
});

const TradeSchema = z
  .object({
    id: z.string().min(1),
    pair: z.string().min(6).max(10),
    direction: z.enum(['BUY', 'SELL']),
    positionSize: z.number().positive(),
    entryPrice: z.number().positive(),
    stopLoss: z.number().positive().nullable(),
    takeProfit: z.number().positive().nullable(),
    openTime: z.date(),
    closeTime: z.date().nullable(),
    status: z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'ERROR']),
    closeReason: z.string().nullable(),
    broker: z.string().nullable(),
    currentPnL: TradePnlSchema.nullable(),
    finalPnL: TradePnlSchema.nullable(),
    metadata: z
      .object({
        signalId: z.string().optional(),
        strategyName: z.string().optional(),
        tags: z.array(z.string()).optional()
      })
      .optional()
  })
  .strict();

/**
 * Trade Model
 */
class Trade extends BaseModel {
  constructor(data) {
    const defaults = {
      id: '',
      pair: '',
      direction: 'BUY',
      positionSize: 0,
      entryPrice: 0,
      stopLoss: null,
      takeProfit: null,
      openTime: new Date(),
      closeTime: null,
      status: 'OPEN',
      closeReason: null,
      broker: null,
      currentPnL: null,
      finalPnL: null
    };

    super({ ...defaults, ...data }, TradeSchema);
  }

  /**
   * Check if trade is currently open
   * @returns {boolean} Whether trade is open
   */
  isOpen() {
    return this.get('status') === 'OPEN';
  }

  /**
   * Check if trade is closed
   * @returns {boolean} Whether trade is closed
   */
  isClosed() {
    return this.get('status') === 'CLOSED';
  }

  /**
   * Get trade duration in milliseconds
   * @returns {number} Duration in ms
   */
  getDuration() {
    const openTime = this.get('openTime');
    const closeTime = this.get('closeTime');

    if (closeTime) {
      return closeTime.getTime() - openTime.getTime();
    }

    return Date.now() - openTime.getTime();
  }

  /**
   * Get trade duration in hours
   * @returns {number} Duration in hours
   */
  getDurationHours() {
    return this.getDuration() / (1000 * 60 * 60);
  }

  /**
   * Calculate current P&L based on current price
   * @param {number} currentPrice - Current market price
   * @returns {Object} P&L with amount and percentage
   */
  calculateCurrentPnL(currentPrice) {
    const entryPrice = this.get('entryPrice');
    const positionSize = this.get('positionSize');
    const direction = this.get('direction');

    let pnlAmount = 0;

    if (direction === 'BUY') {
      pnlAmount = (currentPrice - entryPrice) * positionSize;
    } else if (direction === 'SELL') {
      pnlAmount = (entryPrice - currentPrice) * positionSize;
    }

    const pnlPercentage = entryPrice > 0 ? (pnlAmount / (entryPrice * positionSize)) * 100 : 0;

    const pnl = {
      amount: pnlAmount,
      percentage: pnlPercentage
    };

    this.set('currentPnL', pnl);
    return pnl;
  }

  /**
   * Close the trade with final price and reason
   * @param {number} closePrice - Closing price
   * @param {string} reason - Reason for closing
   */
  close(closePrice, reason = 'Manual close') {
    const finalPnL = this.calculateCurrentPnL(closePrice);

    this.update({
      status: 'CLOSED',
      closeTime: new Date(),
      closeReason: reason,
      finalPnL
    });
  }

  /**
   * Check if stop loss is hit
   * @param {number} currentPrice - Current market price
   * @returns {boolean} Whether stop loss is hit
   */
  isStopLossHit(currentPrice) {
    const stopLoss = this.get('stopLoss');
    if (!stopLoss) {
      return false;
    }

    const direction = this.get('direction');

    if (direction === 'BUY') {
      return currentPrice <= stopLoss;
    } else if (direction === 'SELL') {
      return currentPrice >= stopLoss;
    }

    return false;
  }

  /**
   * Check if take profit is hit
   * @param {number} currentPrice - Current market price
   * @returns {boolean} Whether take profit is hit
   */
  isTakeProfitHit(currentPrice) {
    const takeProfit = this.get('takeProfit');
    if (!takeProfit) {
      return false;
    }

    const direction = this.get('direction');

    if (direction === 'BUY') {
      return currentPrice >= takeProfit;
    } else if (direction === 'SELL') {
      return currentPrice <= takeProfit;
    }

    return false;
  }

  /**
   * Get the risk-reward ratio
   * @returns {number|null} Risk-reward ratio
   */
  getRiskRewardRatio() {
    const entryPrice = this.get('entryPrice');
    const stopLoss = this.get('stopLoss');
    const takeProfit = this.get('takeProfit');
    const direction = this.get('direction');

    if (!stopLoss || !takeProfit) {
      return null;
    }

    if (direction === 'BUY') {
      const risk = Math.abs(entryPrice - stopLoss);
      const reward = Math.abs(takeProfit - entryPrice);
      return risk > 0 ? reward / risk : null;
    } else if (direction === 'SELL') {
      const risk = Math.abs(stopLoss - entryPrice);
      const reward = Math.abs(entryPrice - takeProfit);
      return risk > 0 ? reward / risk : null;
    }

    return null;
  }

  /**
   * Get maximum potential loss amount
   * @returns {number|null} Max loss amount
   */
  getMaxLoss() {
    const entryPrice = this.get('entryPrice');
    const stopLoss = this.get('stopLoss');
    const positionSize = this.get('positionSize');

    if (!stopLoss) {
      return null;
    }

    return Math.abs(entryPrice - stopLoss) * positionSize;
  }

  /**
   * Get maximum potential profit amount
   * @returns {number|null} Max profit amount
   */
  getMaxProfit() {
    const entryPrice = this.get('entryPrice');
    const takeProfit = this.get('takeProfit');
    const positionSize = this.get('positionSize');

    if (!takeProfit) {
      return null;
    }

    return Math.abs(takeProfit - entryPrice) * positionSize;
  }

  /**
   * Check if trade is profitable
   * @returns {boolean} Whether trade is profitable
   */
  isProfitable() {
    const pnl = this.get('finalPnL') || this.get('currentPnL');
    return pnl && pnl.amount > 0;
  }

  /**
   * Get trade summary as string
   * @returns {string} Trade summary
   */
  getSummary() {
    const pair = this.get('pair');
    const direction = this.get('direction');
    const status = this.get('status');
    const pnl = this.get('finalPnL') || this.get('currentPnL');

    let pnlStr = 'N/A';
    if (pnl && pnl.amount !== null) {
      const sign = pnl.amount >= 0 ? '+' : '';
      pnlStr = `${sign}${pnl.amount.toFixed(2)} (${sign}${pnl.percentage.toFixed(2)}%)`;
    }

    return `${direction} ${pair} [${status}] P&L: ${pnlStr}`;
  }
}

export { Trade };
export default Trade;
