export function toFixedNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function timestampOf(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function pipPrecisionForPair(pair) {
  if (typeof pair === 'string' && pair.toUpperCase().includes('JPY')) {
    return 0.01;
  }
  return 0.0001;
}
