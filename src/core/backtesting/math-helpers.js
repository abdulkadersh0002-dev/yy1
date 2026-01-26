export function mean(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
}

export function variance(values = [], avg = mean(values)) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return 0;
  }
  const sumSq = values.reduce((acc, value) => acc + (value - avg) ** 2, 0);
  return sumSq / (values.length - 1);
}

export function standardDeviation(values = [], avg = mean(values)) {
  const vari = variance(values, avg);
  return Math.sqrt(Math.max(vari, 0));
}

export function cumulativeSum(values = []) {
  const result = [];
  let running = 0;
  values.forEach((value) => {
    running += value;
    result.push(running);
  });
  return result;
}

export function maxDrawdown(equityCurve = []) {
  if (!Array.isArray(equityCurve) || equityCurve.length === 0) {
    return { maxDrawdown: 0, peak: 0, trough: 0 };
  }

  let peak = equityCurve[0];
  let trough = equityCurve[0];
  let maxDd = 0;

  equityCurve.forEach((value) => {
    if (value > peak) {
      peak = value;
      trough = value;
    }
    if (value < trough) {
      trough = value;
      const drawdown = peak === 0 ? 0 : (trough - peak) / peak;
      if (drawdown < maxDd) {
        maxDd = drawdown;
      }
    }
  });

  return {
    maxDrawdown: maxDd,
    peak,
    trough
  };
}

export function sharpeRatio(returns = [], riskFreeRate = 0) {
  if (!Array.isArray(returns) || returns.length === 0) {
    return 0;
  }
  const avg = mean(returns);
  const adjusted = returns.map((value) => value - riskFreeRate);
  const std = standardDeviation(adjusted, mean(adjusted));
  if (std === 0) {
    return 0;
  }
  return ((avg - riskFreeRate) / std) * Math.sqrt(returns.length);
}

export function sum(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0);
}

export function percentile(values = [], percentileRank = 0.5) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(percentileRank * sorted.length))
  );
  return sorted[index];
}

export function bounded(value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(Math.max(value, min), max);
}
