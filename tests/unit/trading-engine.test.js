import test from 'node:test';
import assert from 'node:assert/strict';
import TradingEngine from '../../src/engine/trading-engine.js';

function createEngine(config = {}) {
  const dependencies = {
    persistenceAdapter: {},
    economicAnalyzer: {},
    newsAnalyzer: {},
    priceDataFetcher: {
      getCurrentPrice: async () => 1.1
    },
    technicalAnalyzer: {
      setPriceDataFetcher() {},
      setFeatureStore() {}
    },
    featureStore: {
      setPersistence() {}
    },
    adaptiveScorer: {}
  };

  return new TradingEngine({
    ...config,
    dependencies: { ...dependencies, ...(config.dependencies || {}) }
  });
}

test('estimateWinRate rewards stronger multi-factor signals', () => {
  const engine = createEngine();
  const components = {
    technical: { score: 80 },
    news: { confidence: 70 },
    economic: { score: 25, details: { relativeSentiment: 10 } }
  };
  const winRate = engine.estimateWinRate({
    direction: 'BUY',
    strength: 85,
    confidence: 80,
    entry: { riskReward: 2.1 },
    components
  });
  assert.ok(winRate >= 80 && winRate <= 97);
});

test('calculateEntryParameters builds coherent trade plan inputs', () => {
  const engine = createEngine();
  const technical = {
    timeframes: {
      H1: { indicators: { atr: { value: 0.0008 } } }
    },
    volatilitySummary: {
      averageScore: 70,
      state: 'normal'
    }
  };

  const entry = engine.calculateEntryParameters('EURUSD', 'BUY', technical, 1.085);
  assert(entry, 'entry should be constructed');
  assert.equal(entry.direction, 'BUY');
  assert.ok(entry.stopLoss < entry.price);
  assert.ok(entry.takeProfit > entry.price);
  assert.ok(entry.riskReward >= 1.6);
  assert.ok(entry.trailingStop.enabled);
});

test('validateSignal enforces gating and reports failures', () => {
  const engine = createEngine();
  const goodSignal = {
    pair: 'EURUSD',
    direction: 'BUY',
    strength: 80,
    confidence: 85,
    estimatedWinRate: 93,
    entry: { riskReward: 2.0 },
    riskManagement: { canTrade: true },
    components: {
      marketData: { confidenceFloorBreached: false },
      technical: {
        candlesByTimeframe: {
          M15: {
            smc: {
              priceImbalance: {
                state: 'bullish',
                confidence: 72,
                nearest: {
                  type: 'bullish',
                  zoneLow: 1.1,
                  zoneHigh: 1.101,
                  fillPct: 15,
                  ageBars: 4,
                  distance: 0.0
                }
              }
            }
          }
        }
      }
    }
  };
  const passing = engine.validateSignal(goodSignal);
  assert.equal(passing.isValid, true);
  assert.equal(passing.decision.state, 'ENTER');

  const layers = goodSignal?.components?.confluence?.layers;
  assert.ok(Array.isArray(layers), 'confluence layers should exist');
  assert.ok(layers.some((l) => l?.id === 'smc_price_imbalance'));

  const badSignal = {
    pair: 'EURUSD',
    direction: 'NEUTRAL',
    strength: 10,
    confidence: 40,
    estimatedWinRate: 50,
    entry: null,
    riskManagement: { canTrade: false },
    components: { marketData: { confidenceFloorBreached: true } }
  };
  const failing = engine.validateSignal(badSignal);
  assert.equal(failing.isValid, false);
  assert.equal(failing.decision.state, 'WAIT_MONITOR');
  assert.match(failing.reason, /WAIT|monitor/i);
});
