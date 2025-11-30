import { TransactionCostModel } from './transaction-cost-model.js';
import { pipPrecisionForPair, timestampOf, toFixedNumber } from './utils.js';
import { buildPerformanceSummary } from './performance-metrics.js';

function findEntryIndex(timestamps, targetTs, offset = 1) {
  if (!Number.isFinite(targetTs)) {
    return -1;
  }
  let left = 0;
  let right = timestamps.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (timestamps[mid] >= targetTs) {
      result = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  if (result === -1) {
    return -1;
  }
  const index = result + offset;
  return index < timestamps.length ? index : -1;
}

function resolvePrice(bar, fallback) {
  if (!bar || typeof bar !== 'object') {
    return fallback;
  }
  if (Number.isFinite(bar.open)) {
    return bar.open;
  }
  if (Number.isFinite(bar.close)) {
    return bar.close;
  }
  if (Number.isFinite(bar.price)) {
    return bar.price;
  }
  return fallback;
}

function determineExitPrice(direction, entryPrice, bar, context) {
  const { takeProfitPips, stopLossPips, pipPrecision } = context;
  const tpPrice = Number.isFinite(takeProfitPips)
    ? entryPrice + (direction === 'LONG' ? takeProfitPips : -takeProfitPips) * pipPrecision
    : null;
  const slPrice = Number.isFinite(stopLossPips)
    ? entryPrice - (direction === 'LONG' ? stopLossPips : -stopLossPips) * pipPrecision
    : null;

  if (!bar) {
    return { price: entryPrice, reason: 'no-data' };
  }

  const high = Number.isFinite(bar.high) ? bar.high : entryPrice;
  const low = Number.isFinite(bar.low) ? bar.low : entryPrice;
  const close = resolvePrice(bar, entryPrice);

  if (tpPrice != null) {
    if (direction === 'LONG' && high >= tpPrice) {
      return { price: tpPrice, reason: 'take-profit' };
    }
    if (direction === 'SHORT' && low <= tpPrice) {
      return { price: tpPrice, reason: 'take-profit' };
    }
  }

  if (slPrice != null) {
    if (direction === 'LONG' && low <= slPrice) {
      return { price: slPrice, reason: 'stop-loss' };
    }
    if (direction === 'SHORT' && high >= slPrice) {
      return { price: slPrice, reason: 'stop-loss' };
    }
  }

  return { price: close, reason: 'timeout' };
}

function evaluateTrade({
  bars,
  entryIndex,
  holdBars,
  direction,
  takeProfitPips,
  stopLossPips,
  pipPrecision,
  pair,
  transactionCostModel,
  units
}) {
  const entryBar = bars[entryIndex];
  if (!entryBar) {
    return null;
  }

  const entryPrice = resolvePrice(entryBar, null);
  if (!Number.isFinite(entryPrice)) {
    return null;
  }

  const finalIndex = Math.min(bars.length - 1, entryIndex + Math.max(1, holdBars));
  let exitPrice = entryPrice;
  let exitReason = 'timeout';

  for (let idx = entryIndex + 1; idx <= finalIndex; idx += 1) {
    const { price, reason } = determineExitPrice(direction, entryPrice, bars[idx], {
      takeProfitPips,
      stopLossPips,
      pipPrecision
    });
    exitPrice = price;
    exitReason = reason;

    if (reason === 'take-profit' || reason === 'stop-loss' || idx === finalIndex) {
      break;
    }
  }

  const grossMove = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;

  const grossPips = grossMove / pipPrecision;

  const transactionCosts = transactionCostModel.calculateCosts({
    pair,
    direction,
    entryPrice,
    exitPrice,
    units
  });

  const netPips = grossPips - transactionCosts.totalCost / transactionCosts.pipValue;
  const returnPct = (netPips * pipPrecision) / entryPrice;

  return {
    pair,
    direction,
    entryIndex,
    exitIndex: finalIndex,
    entryPrice: toFixedNumber(entryPrice, 6),
    exitPrice: toFixedNumber(exitPrice, 6),
    exitReason,
    grossPips: toFixedNumber(grossPips, 3),
    netPips: toFixedNumber(netPips, 3),
    returnPct: toFixedNumber(returnPct, 6),
    transactionCosts,
    units,
    holdBars
  };
}

export class VectorizedBacktester {
  constructor(options = {}) {
    this.entryOffset = options.entryOffset ?? 1;
    this.defaultHoldBars = options.defaultHoldBars ?? 12;
    this.defaultTakeProfitPips = options.defaultTakeProfitPips ?? null;
    this.defaultStopLossPips = options.defaultStopLossPips ?? null;
    this.units = options.units ?? 100000;
    this.transactionCostModel = options.transactionCostModel
      ? options.transactionCostModel
      : new TransactionCostModel(options.transactionCosts || {});
  }

  run(dataset = {}) {
    const { pair = 'EURUSD', timeframe = 'M15', bars = [], signals = [] } = dataset;
    if (
      !Array.isArray(bars) ||
      bars.length === 0 ||
      !Array.isArray(signals) ||
      signals.length === 0
    ) {
      return {
        pair,
        timeframe,
        trades: [],
        metrics: buildPerformanceSummary([], {}),
        equityCurve: [],
        meta: {
          reason: 'insufficient-data'
        }
      };
    }

    const timestamps = bars.map((bar) => timestampOf(bar.timestamp ?? bar.time ?? bar.datetime));
    const pipPrecision = pipPrecisionForPair(pair);
    const trades = [];
    const equityCurve = [];
    let cumulativeReturn = 0;

    signals.forEach((signal) => {
      const direction = (signal.direction || signal.side || 'LONG').toUpperCase();
      if (direction !== 'LONG' && direction !== 'SHORT') {
        return;
      }

      const signalTs = timestampOf(signal.timestamp ?? signal.time ?? signal.generatedAt);
      const entryIndex = findEntryIndex(timestamps, signalTs, this.entryOffset);
      if (entryIndex === -1) {
        return;
      }

      const holdBars = Number.isInteger(signal.holdBars)
        ? Math.max(signal.holdBars, 1)
        : this.defaultHoldBars;
      const takeProfitPips = Number.isFinite(signal.takeProfitPips)
        ? signal.takeProfitPips
        : this.defaultTakeProfitPips;
      const stopLossPips = Number.isFinite(signal.stopLossPips)
        ? signal.stopLossPips
        : this.defaultStopLossPips;

      const trade = evaluateTrade({
        bars,
        pair,
        entryIndex,
        holdBars,
        direction,
        takeProfitPips,
        stopLossPips,
        pipPrecision,
        transactionCostModel: this.transactionCostModel,
        units: signal.units ?? this.units
      });

      if (!trade) {
        return;
      }

      trades.push(trade);
      cumulativeReturn += trade.returnPct ?? 0;
      equityCurve.push(toFixedNumber(cumulativeReturn, 6));
    });

    const metrics = buildPerformanceSummary(trades, {});

    return {
      pair,
      timeframe,
      trades,
      metrics,
      equityCurve,
      meta: {
        signalsEvaluated: signals.length,
        tradesExecuted: trades.length,
        pipPrecision,
        transactionCostModel: {
          spreadPips: this.transactionCostModel.spreadPips,
          slippagePips: this.transactionCostModel.slippagePips,
          commissionPerLot: this.transactionCostModel.commissionPerLot,
          lotSize: this.transactionCostModel.lotSize
        }
      }
    };
  }
}

export default VectorizedBacktester;
