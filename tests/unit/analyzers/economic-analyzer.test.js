import test from 'node:test';
import assert from 'node:assert/strict';
import EconomicAnalyzer from '../../../src/core/analyzers/economic-analyzer.js';

test('calculateEconomicScore applies weights and clamps output', () => {
  const analyzer = new EconomicAnalyzer({});
  const indicators = {
    gdp: { impact: 40 },
    inflation: { impact: 10 },
    interestRate: { impact: 15 },
    unemployment: { impact: -20 },
    retailSales: { impact: 12 },
    manufacturing: { impact: 6 }
  };

  const score = analyzer.calculateEconomicScore(indicators);
  const expected = 40 * 0.25 + 10 * 0.2 + 15 * 0.25 + -20 * 0.15 + 12 * 0.1 + 6 * 0.05;
  assert.equal(score, expected);

  const capped = analyzer.calculateEconomicScore({
    gdp: { impact: 400 },
    inflation: { impact: 400 },
    interestRate: { impact: 400 },
    unemployment: { impact: 400 },
    retailSales: { impact: 400 },
    manufacturing: { impact: 400 }
  });
  assert.equal(capped, 100);
});

test('determineEconomicSentiment maps score ranges to sentiment labels', () => {
  const analyzer = new EconomicAnalyzer({});
  assert.equal(analyzer.determineEconomicSentiment(40), 'very_bullish');
  assert.equal(analyzer.determineEconomicSentiment(20), 'bullish');
  assert.equal(analyzer.determineEconomicSentiment(0), 'neutral');
  assert.equal(analyzer.determineEconomicSentiment(-15), 'bearish');
  assert.equal(analyzer.determineEconomicSentiment(-45), 'very_bearish');
});

async function createCachedAnalyzer() {
  const analyzer = new EconomicAnalyzer({});
  const mockIndicator = { impact: 15, value: 1 };
  let gdpCalls = 0;

  analyzer.getGDP = async () => {
    gdpCalls += 1;
    return { ...mockIndicator };
  };
  analyzer.getInflation = async () => ({ ...mockIndicator });
  analyzer.getInterestRate = async () => ({ ...mockIndicator });
  analyzer.getUnemployment = async () => ({ ...mockIndicator });
  analyzer.getRetailSales = async () => ({ ...mockIndicator });
  analyzer.getManufacturing = async () => ({ ...mockIndicator });

  const first = await analyzer.analyzeCurrency('USD');
  const second = await analyzer.analyzeCurrency('USD');

  return { first, second, gdpCalls };
}

test('analyzeCurrency caches computed analyses', async () => {
  const { first, second, gdpCalls } = await createCachedAnalyzer();
  assert.equal(gdpCalls, 1);
  assert.strictEqual(first, second);
  assert.equal(first.currency, 'USD');
  assert.ok(first.score !== undefined);
});
