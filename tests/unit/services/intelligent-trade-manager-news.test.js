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
});
