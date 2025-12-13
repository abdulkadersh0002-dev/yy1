/**
 * Trade Model Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Trade } from '../../../src/models/trade.js';

describe('Trade', () => {
  describe('Constructor', () => {
    it('should create trade with defaults', () => {
      const trade = new Trade({ id: 'test-1', pair: 'EURUSD' });
      assert.equal(trade.get('id'), 'test-1');
      assert.equal(trade.get('pair'), 'EURUSD');
      assert.equal(trade.get('status'), 'OPEN');
    });

    it('should create trade with provided data', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1,
        stopLoss: 1.095,
        takeProfit: 1.11
      });
      assert.equal(trade.get('direction'), 'BUY');
      assert.equal(trade.get('positionSize'), 10000);
      assert.equal(trade.get('entryPrice'), 1.1);
    });
  });

  describe('Status Checks', () => {
    it('should check if trade is open', () => {
      const trade = new Trade({ id: 'test-1', pair: 'EURUSD', status: 'OPEN' });
      assert.equal(trade.isOpen(), true);
      assert.equal(trade.isClosed(), false);
    });

    it('should check if trade is closed', () => {
      const trade = new Trade({ id: 'test-1', pair: 'EURUSD', status: 'CLOSED' });
      assert.equal(trade.isOpen(), false);
      assert.equal(trade.isClosed(), true);
    });
  });

  describe('P&L Calculations', () => {
    it('should calculate P&L for BUY trade in profit', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1
      });
      const pnl = trade.calculateCurrentPnL(1.105);
      assert.ok(pnl.amount > 0);
      assert.ok(Math.abs(pnl.amount - 50) < 0.01); // (1.1050 - 1.1000) * 10000
      assert.ok(pnl.percentage > 0);
    });

    it('should calculate P&L for BUY trade in loss', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1
      });
      const pnl = trade.calculateCurrentPnL(1.095);
      assert.ok(pnl.amount < 0);
      assert.ok(Math.abs(pnl.amount - -50) < 0.01); // (1.0950 - 1.1000) * 10000
    });

    it('should calculate P&L for SELL trade in profit', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'SELL',
        positionSize: 10000,
        entryPrice: 1.1
      });
      const pnl = trade.calculateCurrentPnL(1.095);
      assert.ok(pnl.amount > 0);
      assert.ok(Math.abs(pnl.amount - 50) < 0.01); // (1.1000 - 1.0950) * 10000
    });

    it('should calculate P&L for SELL trade in loss', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'SELL',
        positionSize: 10000,
        entryPrice: 1.1
      });
      const pnl = trade.calculateCurrentPnL(1.105);
      assert.ok(pnl.amount < 0);
      assert.ok(Math.abs(pnl.amount - -50) < 0.01); // (1.1000 - 1.1050) * 10000
    });
  });

  describe('Trade Lifecycle', () => {
    it('should close a trade', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1,
        status: 'OPEN'
      });
      trade.close(1.105, 'Take profit hit');
      assert.equal(trade.get('status'), 'CLOSED');
      assert.ok(trade.get('closeTime') instanceof Date);
      assert.equal(trade.get('closeReason'), 'Take profit hit');
      assert.ok(trade.get('finalPnL'));
      assert.ok(trade.get('finalPnL').amount > 0);
    });

    it('should check stop loss hit for BUY trade', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.1,
        stopLoss: 1.095
      });
      assert.equal(trade.isStopLossHit(1.094), true);
      assert.equal(trade.isStopLossHit(1.096), false);
    });

    it('should check stop loss hit for SELL trade', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'SELL',
        entryPrice: 1.1,
        stopLoss: 1.105
      });
      assert.equal(trade.isStopLossHit(1.106), true);
      assert.equal(trade.isStopLossHit(1.104), false);
    });

    it('should check take profit hit for BUY trade', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.1,
        takeProfit: 1.11
      });
      assert.equal(trade.isTakeProfitHit(1.111), true);
      assert.equal(trade.isTakeProfitHit(1.109), false);
    });

    it('should check take profit hit for SELL trade', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'SELL',
        entryPrice: 1.1,
        takeProfit: 1.09
      });
      assert.equal(trade.isTakeProfitHit(1.089), true);
      assert.equal(trade.isTakeProfitHit(1.091), false);
    });
  });

  describe('Risk Metrics', () => {
    it('should calculate risk-reward ratio', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.1,
        stopLoss: 1.095,
        takeProfit: 1.11
      });
      const rrRatio = trade.getRiskRewardRatio();
      assert.ok(rrRatio > 1.9 && rrRatio < 2.1); // Should be about 2
    });

    it('should calculate max loss', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1,
        stopLoss: 1.095
      });
      const maxLoss = trade.getMaxLoss();
      assert.ok(Math.abs(maxLoss - 50) < 0.01); // |1.1000 - 1.0950| * 10000
    });

    it('should calculate max profit', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        positionSize: 10000,
        entryPrice: 1.1,
        takeProfit: 1.11
      });
      const maxProfit = trade.getMaxProfit();
      assert.ok(Math.abs(maxProfit - 100) < 0.01); // |1.1100 - 1.1000| * 10000
    });
  });

  describe('Trade Information', () => {
    it('should get trade duration', () => {
      const openTime = new Date(Date.now() - 3600000); // 1 hour ago
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        openTime
      });
      const duration = trade.getDuration();
      assert.ok(duration >= 3600000 - 1000); // Allow 1 second tolerance
    });

    it('should check if trade is profitable', () => {
      const trade1 = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        currentPnL: { amount: 50, percentage: 0.5 }
      });
      assert.equal(trade1.isProfitable(), true);

      const trade2 = new Trade({
        id: 'test-2',
        pair: 'EURUSD',
        currentPnL: { amount: -50, percentage: -0.5 }
      });
      assert.equal(trade2.isProfitable(), false);
    });

    it('should get trade summary', () => {
      const trade = new Trade({
        id: 'test-1',
        pair: 'EURUSD',
        direction: 'BUY',
        status: 'OPEN',
        currentPnL: { amount: 50.25, percentage: 0.45 }
      });
      const summary = trade.getSummary();
      assert.ok(summary.includes('BUY'));
      assert.ok(summary.includes('EURUSD'));
      assert.ok(summary.includes('OPEN'));
      assert.ok(summary.includes('50.25'));
    });
  });
});
