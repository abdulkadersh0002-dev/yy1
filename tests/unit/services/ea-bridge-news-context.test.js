/**
 * Unit tests for EA Bridge news-aware context adjustments
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EaBridgeService from '../../../src/infrastructure/services/brokers/ea-bridge-service.js';

describe('EaBridgeService news context', () => {
  it('applies confidence penalties for high-impact imminent news', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    const now = Date.now();
    const payload = {
      broker: 'mt5',
      items: [
        {
          id: 'n1',
          title: 'ECB rate decision',
          currency: 'EUR',
          impact: 90,
          time: now + 5 * 60 * 1000,
        },
      ],
    };

    const ingest = svc.recordNews(payload);
    assert.equal(ingest.success, true);

    const newsContext = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'EURUSD', now });
    const baseSignal = { confidence: 72, strength: 65, direction: 'BUY' };
    const { signal: adjusted } = svc.applyNewsContextToSignal(baseSignal, newsContext);

    assert.ok(adjusted.confidence < baseSignal.confidence);
    assert.ok(adjusted.strength < baseSignal.strength);
    assert.ok(adjusted.components?.news?.eaContext?.highImpactCount >= 1);
  });

  it('does not penalize when no relevant news exists', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    const now = Date.now();
    const baseSignal = { confidence: 70, strength: 60, direction: 'SELL' };

    const newsContext = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'USDJPY', now });
    const { signal: adjusted } = svc.applyNewsContextToSignal(baseSignal, newsContext);

    assert.equal(adjusted.confidence, baseSignal.confidence);
    assert.equal(adjusted.strength, baseSignal.strength);
  });
});
