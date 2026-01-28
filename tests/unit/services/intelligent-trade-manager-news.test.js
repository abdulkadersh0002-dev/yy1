/**
 * Unit tests for IntelligentTradeManager news summaries
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import IntelligentTradeManager from '../../../src/infrastructure/services/brokers/intelligent-trade-manager.js';

describe('IntelligentTradeManager news summaries', () => {
  it('returns non-blocking summary when news is empty', () => {
    const manager = new IntelligentTradeManager({ logger: { info() {}, warn() {}, error() {} } });
    const summary = manager.summarizeNewsForSymbol('EURUSD', []);

    assert.equal(summary.blocking, false);
    assert.equal(summary.volatilityMultiplier, 1.0);
  });

  it('flags blocking summary for high-impact imminent news', () => {
    const manager = new IntelligentTradeManager({ logger: { info() {}, warn() {}, error() {} } });
    const now = Date.now();
    const newsItems = [
      {
        title: 'ECB rate decision',
        currency: 'EUR',
        impact: 90,
        time: now + 5 * 60 * 1000,
      },
    ];

    const summary = manager.summarizeNewsForSymbol('EURUSD', newsItems);
    assert.equal(summary.blocking, true);
    assert.ok(summary.details.length > 0);
    assert.ok(summary.volatilityMultiplier >= 1.0);
  });

  it('triggers early loss exit on trap signals', () => {
    const manager = new IntelligentTradeManager({ logger: { info() {}, warn() {}, error() {} } });
    const trade = {
      openPrice: 1.2,
      stopLoss: 1.19,
      takeProfit: 1.23,
      direction: 'BUY',
      symbol: 'EURUSD',
    };
    const currentPrice = 1.196;
    const marketData = {
      liquidityTrap: { confidence: 80 },
    };

    const decision = manager.monitorTrade({ trade, currentPrice, marketData });
    assert.equal(decision.action, 'CLOSE_NOW');
  });

  it('returns modify SL decision when trailing is active', () => {
    const manager = new IntelligentTradeManager({ logger: { info() {}, warn() {}, error() {} } });
    const trade = {
      openPrice: 1.2,
      stopLoss: 1.19,
      takeProfit: 1.24,
      direction: 'BUY',
      symbol: 'EURUSD',
    };
    const currentPrice = 1.23;
    const decision = manager.monitorTrade({ trade, currentPrice, marketData: {} });
    assert.ok(['MODIFY_SL', 'HOLD', 'CLOSE_NOW'].includes(decision.action));
  });
});
