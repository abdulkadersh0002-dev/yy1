import {
  mean,
  standardDeviation,
  cumulativeSum,
  maxDrawdown,
  sharpeRatio,
  sum
} from './math-helpers.js';
import { toFixedNumber } from './utils.js';

export function buildPerformanceSummary(trades = [], options = {}) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      grossPips: 0,
      netPips: 0,
      avgReturnPct: 0,
      sharpe: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      expectancyPct: 0
    };
  }

  const grossPips = trades.reduce((acc, trade) => acc + (trade.grossPips ?? 0), 0);
  const netPips = trades.reduce((acc, trade) => acc + (trade.netPips ?? 0), 0);
  const returns = trades.map((trade) => trade.returnPct ?? 0);
  const equityCurve = cumulativeSum(trades.map((trade) => trade.returnPct ?? 0));

  const winners = trades.filter((trade) => (trade.netPips ?? 0) > 0);
  const losers = trades.filter((trade) => (trade.netPips ?? 0) <= 0);

  const winRate = winners.length / trades.length;
  const avgReturnPct = mean(returns);
  const stdReturnPct = standardDeviation(returns, avgReturnPct);
  const expectancyPct = avgReturnPct * winRate - Math.abs(avgReturnPct) * (1 - winRate);

  const totalWin = sum(winners.map((trade) => trade.netPips ?? 0));
  const totalLoss = sum(losers.map((trade) => Math.abs(trade.netPips ?? 0)));
  const profitFactor = totalLoss === 0 ? totalWin : totalWin / totalLoss;

  const { maxDrawdown: maxDdRaw } = maxDrawdown(equityCurve);

  return {
    totalTrades: trades.length,
    winRate: toFixedNumber(winRate, 4),
    grossPips: toFixedNumber(grossPips, 2),
    netPips: toFixedNumber(netPips, 2),
    avgReturnPct: toFixedNumber(avgReturnPct * 100, 3),
    stdReturnPct: toFixedNumber(stdReturnPct * 100, 3),
    sharpe: toFixedNumber(sharpeRatio(returns, options.riskFreeRate ?? 0), 3),
    profitFactor: toFixedNumber(profitFactor, 3),
    maxDrawdownPct: toFixedNumber(Math.abs(maxDdRaw) * 100, 3),
    expectancyPct: toFixedNumber(expectancyPct * 100, 3)
  };
}

export default buildPerformanceSummary;
