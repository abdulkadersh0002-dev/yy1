import { timestampOf } from './utils.js';
import { buildPerformanceSummary } from './performance-metrics.js';

export function splitIntoWalkForwardWindows(bars = [], options = {}) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return [];
  }

  const windowSize = Number.isInteger(options.windowSize)
    ? Math.max(10, options.windowSize)
    : Math.floor(bars.length / 5);
  const stepSize = Number.isInteger(options.stepSize)
    ? Math.max(5, options.stepSize)
    : Math.floor(windowSize / 2);

  const windows = [];
  for (let start = 0; start + windowSize <= bars.length; start += stepSize) {
    const end = start + windowSize;
    const segment = bars.slice(start, end);
    windows.push({
      index: windows.length,
      start,
      end,
      bars: segment,
      startTs: timestampOf(segment[0]?.timestamp ?? segment[0]?.time),
      endTs: timestampOf(
        segment[segment.length - 1]?.timestamp ?? segment[segment.length - 1]?.time
      )
    });
  }

  return windows;
}

export function runWalkForwardValidation({
  pair,
  timeframe,
  bars = [],
  signals = [],
  backtester,
  options = {}
}) {
  if (!backtester || typeof backtester.run !== 'function') {
    throw new Error('Backtester with run() method is required for walk-forward validation');
  }

  const windows = splitIntoWalkForwardWindows(bars, options);
  const results = [];

  windows.forEach((window) => {
    const windowSignals = signals.filter((signal) => {
      const ts = timestampOf(signal.timestamp ?? signal.time ?? signal.generatedAt);
      return ts != null && ts >= window.startTs && ts <= window.endTs;
    });

    if (windowSignals.length === 0) {
      results.push({
        index: window.index,
        pair,
        timeframe,
        trades: [],
        metrics: buildPerformanceSummary([], {}),
        window
      });
      return;
    }

    const runResult = backtester.run({
      pair,
      timeframe,
      bars: window.bars,
      signals: windowSignals
    });

    results.push({
      index: window.index,
      pair,
      timeframe,
      trades: runResult.trades,
      metrics: runResult.metrics,
      window,
      equityCurve: runResult.equityCurve
    });
  });

  const aggregateMetrics = buildPerformanceSummary(
    results.flatMap((entry) => entry.trades),
    {}
  );

  return {
    windows,
    results,
    aggregateMetrics
  };
}

export default runWalkForwardValidation;
