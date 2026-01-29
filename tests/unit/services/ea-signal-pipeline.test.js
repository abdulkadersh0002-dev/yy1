import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachLayeredAnalysisToSignal,
  evaluateLayers18Readiness,
} from '../../../src/infrastructure/services/ea-signal-pipeline.js';

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

  it('allows strong override when layers are missing but signal is strong', () => {
    const result = evaluateLayers18Readiness({
      layeredAnalysis: { layers: [] },
      minConfluence: 60,
      decisionStateFallback: 'ENTER',
      allowStrongOverride: true,
      signal: {
        direction: 'BUY',
        confidence: 92,
        strength: 80,
        isValid: { isValid: true, decision: { state: 'ENTER' } },
        entry: { price: 1.1, stopLoss: 1.09, takeProfit: 1.12 },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.strongOverride?.ok, true);
  });

  it('blocks strong override when validation fails', () => {
    const result = evaluateLayers18Readiness({
      layeredAnalysis: { layers: [] },
      minConfluence: 60,
      decisionStateFallback: 'ENTER',
      allowStrongOverride: false,
      signal: {
        direction: 'BUY',
        confidence: 92,
        strength: 80,
        isValid: { isValid: true, decision: { state: 'ENTER' } },
        entry: { price: 1.1, stopLoss: 1.09, takeProfit: 1.12 },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.strongOverride?.ok, false);
  });

  it('allows strong override when layers exist but fail readiness', () => {
    const result = evaluateLayers18Readiness({
      layeredAnalysis: {
        layers: Array.from({ length: 18 }).map((_, index) => ({
          key: `L${index + 1}`,
          confidence: index === 16 ? 35 : 0,
          metrics: index === 15 ? { verdict: 'FAIL' } : {},
        })),
      },
      minConfluence: 60,
      decisionStateFallback: 'ENTER',
      allowStrongOverride: true,
      signal: {
        direction: 'BUY',
        confidence: 90,
        strength: 75,
        isValid: { isValid: true, decision: { state: 'ENTER' } },
        entry: { price: 1.1, stopLoss: 1.09, takeProfit: 1.12 },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.strongOverride?.ok, true);
  });
});
