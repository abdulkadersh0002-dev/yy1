/**
 * Unit tests for EA Bridge news-aware context adjustments
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EaBridgeService from '../../../src/infrastructure/services/brokers/ea-bridge-service.js';

describe('EaBridgeService news context', () => {
  const envSnapshot = {
    EA_SIGNAL_NEWS_CONFIDENCE_PENALTY: process.env.EA_SIGNAL_NEWS_CONFIDENCE_PENALTY,
    EA_SIGNAL_NEWS_STRENGTH_PENALTY: process.env.EA_SIGNAL_NEWS_STRENGTH_PENALTY,
    EA_SIGNAL_NEWS_MAX_PENALTY: process.env.EA_SIGNAL_NEWS_MAX_PENALTY,
    EA_SIGNAL_NEWS_LOOKBACK_MINUTES: process.env.EA_SIGNAL_NEWS_LOOKBACK_MINUTES,
    EA_SIGNAL_NEWS_LOOKAHEAD_MINUTES: process.env.EA_SIGNAL_NEWS_LOOKAHEAD_MINUTES,
    EA_SIGNAL_NEWS_IMPACT_THRESHOLD: process.env.EA_SIGNAL_NEWS_IMPACT_THRESHOLD,
    EA_SIGNAL_NEWS_IMMINENT_MINUTES: process.env.EA_SIGNAL_NEWS_IMMINENT_MINUTES,
    EA_SIGNAL_NEWS_IMMINENT_EXTRA_PENALTY: process.env.EA_SIGNAL_NEWS_IMMINENT_EXTRA_PENALTY,
    EA_SIGNAL_NEWS_MEDIUM_IMMINENT_MULTIPLIER:
      process.env.EA_SIGNAL_NEWS_MEDIUM_IMMINENT_MULTIPLIER,
  };

  afterEach(() => {
    Object.entries(envSnapshot).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

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

  it('filters out news outside configured lookback window', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    process.env.EA_SIGNAL_NEWS_LOOKBACK_MINUTES = '10';
    process.env.EA_SIGNAL_NEWS_LOOKAHEAD_MINUTES = '10';

    const now = Date.now();
    const ingest = svc.recordNews({
      broker: 'mt5',
      items: [
        {
          id: 'n-old',
          title: 'EUR headline',
          currency: 'EUR',
          impact: 90,
          time: now - 60 * 60 * 1000,
        },
      ],
    });
    assert.equal(ingest.success, true);

    const context = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'EURUSD', now });
    assert.equal(context.items.length, 0);
  });

  it('honors env overrides for penalties and caps', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    process.env.EA_SIGNAL_NEWS_CONFIDENCE_PENALTY = '20';
    process.env.EA_SIGNAL_NEWS_STRENGTH_PENALTY = '10';
    process.env.EA_SIGNAL_NEWS_MAX_PENALTY = '25';

    const now = Date.now();
    svc.recordNews({
      broker: 'mt5',
      items: [
        {
          id: 'n1',
          title: 'USD jobs report',
          currency: 'USD',
          impact: 95,
          time: now + 60 * 1000,
        },
        {
          id: 'n2',
          title: 'Fed decision',
          currency: 'USD',
          impact: 95,
          time: now + 2 * 60 * 1000,
        },
      ],
    });

    const context = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'USDJPY', now });
    const baseSignal = { confidence: 90, strength: 80, direction: 'SELL' };
    const { signal: adjusted } = svc.applyNewsContextToSignal(baseSignal, context);

    assert.ok(adjusted.newsPenalty <= 25);
    assert.ok(adjusted.newsStrengthPenalty <= 25);
  });

  it('uses imminent and medium multipliers when configured', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    process.env.EA_SIGNAL_NEWS_IMMINENT_EXTRA_PENALTY = '6';
    process.env.EA_SIGNAL_NEWS_MEDIUM_IMMINENT_MULTIPLIER = '0.8';

    const now = Date.now();
    svc.recordNews({
      broker: 'mt5',
      items: [
        {
          id: 'n-med',
          title: 'Medium impact event',
          currency: 'EUR',
          impact: 50,
          time: now + 60 * 1000,
        },
      ],
    });

    const context = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'EURUSD', now });
    const baseSignal = { confidence: 60, strength: 60, direction: 'BUY' };
    const { signal: adjusted } = svc.applyNewsContextToSignal(baseSignal, context);

    assert.ok(adjusted.newsPenalty > 0);
  });

  it('caps penalties when max penalty is exceeded', () => {
    const svc = new EaBridgeService({ logger: { info() {}, warn() {}, error() {} } });
    process.env.EA_SIGNAL_NEWS_MAX_PENALTY = '10';

    const now = Date.now();
    svc.recordNews({
      broker: 'mt5',
      items: [
        { id: 'n1', title: 'USD event', currency: 'USD', impact: 90, time: now + 60 * 1000 },
        { id: 'n2', title: 'USD event 2', currency: 'USD', impact: 90, time: now + 120 * 1000 },
      ],
    });

    const context = svc.buildSignalNewsContext({ broker: 'mt5', symbol: 'USDJPY', now });
    const baseSignal = { confidence: 90, strength: 80, direction: 'SELL' };
    const { signal: adjusted } = svc.applyNewsContextToSignal(baseSignal, context);

    assert.equal(adjusted.newsPenalty, 10);
    assert.equal(adjusted.newsStrengthPenalty, 10);
  });
});
