/**
 * Unit tests for EA signal pipeline news enrichment
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarioForLayeredAnalysis } from '../../../src/infrastructure/services/ea-signal-pipeline.js';

describe('EA signal pipeline news enrichment', () => {
  it('surfaces news impact in market snapshot', () => {
    const rawSignal = {
      pair: 'EURUSD',
      direction: 'BUY',
      confidence: 60,
      components: {
        news: {
          impact: 40,
          upcomingEvents: 2,
          direction: 'bearish',
          confidence: 55,
          eaContext: { total: 3 },
        },
      },
    };

    const scenario = buildScenarioForLayeredAnalysis({
      rawSignal,
      symbol: 'EURUSD',
      effectiveQuote: { bid: 1.1, ask: 1.11, receivedAt: Date.now() },
      now: Date.now(),
    });

    assert.equal(scenario.market.news.impactScore, 40);
    assert.equal(scenario.market.news.upcomingEvents, 2);
    assert.equal(scenario.market.news.matchedItems, 3);
  });
});
