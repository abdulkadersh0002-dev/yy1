import { mean, percentile } from './math-helpers.js';
import { toFixedNumber } from './utils.js';

function createRandom(seed = Date.now()) {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function runMonteCarloSimulations(trades = [], options = {}) {
  const returns = trades
    .map((trade) => trade.returnPct ?? 0)
    .filter((value) => Number.isFinite(value));
  if (returns.length === 0) {
    return {
      iterations: 0,
      sampleSize: 0,
      meanCumulativeReturnPct: 0,
      percentile5ReturnPct: 0,
      percentile95ReturnPct: 0,
      worstRunPct: 0,
      bestRunPct: 0
    };
  }

  const iterations = options.iterations ? Math.max(1, options.iterations) : 500;
  const sampleSize = options.sampleSize ? Math.max(1, options.sampleSize) : returns.length;
  const rng = createRandom(options.seed || Date.now());

  const cumulativeResults = [];

  for (let i = 0; i < iterations; i += 1) {
    let cumulative = 0;
    for (let j = 0; j < sampleSize; j += 1) {
      const index = Math.floor(rng() * returns.length);
      cumulative += returns[index];
    }
    cumulativeResults.push(cumulative);
  }

  return {
    iterations,
    sampleSize,
    meanCumulativeReturnPct: toFixedNumber(mean(cumulativeResults) * 100, 3),
    percentile5ReturnPct: toFixedNumber(percentile(cumulativeResults, 0.05) * 100, 3),
    percentile95ReturnPct: toFixedNumber(percentile(cumulativeResults, 0.95) * 100, 3),
    worstRunPct: toFixedNumber(Math.min(...cumulativeResults) * 100, 3),
    bestRunPct: toFixedNumber(Math.max(...cumulativeResults) * 100, 3)
  };
}

export default runMonteCarloSimulations;
