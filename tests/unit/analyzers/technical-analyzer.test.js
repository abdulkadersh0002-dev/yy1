import test from 'node:test';
import assert from 'node:assert/strict';
import TechnicalAnalyzer from '../../../src/core/analyzers/technical-analyzer.js';

function createAnalyzer() {
  return new TechnicalAnalyzer({ logger: { info() {}, warn() {}, error() {} } });
}

test('calculateOverallScore uses timeframe weights', () => {
  const analyzer = createAnalyzer();
  const score = analyzer.calculateOverallScore({
    M15: { score: 20 },
    H1: { score: 40 },
    H4: { score: -10 },
    D1: { score: 5 }
  });
  const expected = (20 * 0.2 + 40 * 0.25 + -10 * 0.25 + 5 * 0.3) / (0.2 + 0.25 + 0.25 + 0.3);
  assert.equal(score, expected);
});

test('determineTrend maps composite scores to descriptive states', () => {
  const analyzer = createAnalyzer();
  assert.equal(analyzer.determineTrend(50), 'strong_bullish');
  assert.equal(analyzer.determineTrend(25), 'bullish');
  assert.equal(analyzer.determineTrend(-5), 'neutral');
  assert.equal(analyzer.determineTrend(-25), 'bearish');
  assert.equal(analyzer.determineTrend(-60), 'strong_bearish');
});

test('generateSignals emits entries for strong timeframe scores', () => {
  const analyzer = createAnalyzer();
  const signals = analyzer.generateSignals({
    M15: { score: 30, lastPrice: 1.1, direction: 'BUY', patterns: [{ name: 'EMA Cross' }] },
    H1: { score: -35, lastPrice: 1.09, direction: 'SELL', patterns: [{ name: 'MACD' }] },
    H4: { score: 10, lastPrice: 1.08, direction: 'NEUTRAL', patterns: [] }
  });

  assert.equal(signals.length, 2);
  assert.deepEqual(
    signals.map((s) => s.type),
    ['BUY', 'SELL']
  );
  assert.ok(signals.every((s) => s.strength >= 25));
});
