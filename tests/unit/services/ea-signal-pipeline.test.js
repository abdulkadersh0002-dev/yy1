import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachLayeredAnalysisToSignal } from '../../../src/infrastructure/services/ea-signal-pipeline.js';

describe('EA signal pipeline layered context', () => {
  it('attaches pairContext, entryContext, expectedMarketBehavior, invalidationRules', () => {
    const rawSignal = {
      pair: 'EURUSD',
      direction: 'BUY',
      confidence: 70,
      finalScore: 65,
      isValid: { isValid: true, decision: { state: 'ENTER', score: 72 } },
      components: {},
    };

    const result = attachLayeredAnalysisToSignal({ rawSignal, symbol: 'EURUSD', now: Date.now() });

    assert.ok(result.components.pairContext);
    assert.ok(result.components.entryContext);
    assert.ok(result.components.expectedMarketBehavior);
    assert.ok(Array.isArray(result.components.invalidationRules));
    assert.ok(result.components.invalidationRules.length > 0);
  });
});
