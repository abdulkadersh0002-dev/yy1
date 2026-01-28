/**
 * Unit tests for liquidity trap detection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandleSeries } from '../../../src/core/analyzers/candle-analysis-lite.js';

describe('candle-analysis-lite liquidity trap', () => {
  it('detects a trap after a liquidity sweep with weak follow-through', () => {
    const base = Math.trunc(Date.now() / 1000) - 900;
    const series = [];
    for (let i = 0; i < 30; i += 1) {
      series.push({
        time: base + i * 60,
        open: 1.2,
        high: 1.205,
        low: 1.195,
        close: 1.201,
        volume: 100 + i,
      });
    }
    series.push({
      time: base + 30 * 60,
      open: 1.202,
      high: 1.215,
      low: 1.199,
      close: 1.2005,
      volume: 220,
    });

    const analysis = analyzeCandleSeries(series, { timeframe: 'M15' });
    assert.ok(analysis?.smc?.liquidityTrap);
    assert.ok(analysis.smc.liquidityTrap.confidence >= 60);
  });
});
