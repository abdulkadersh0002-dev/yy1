import { getPairMetadata } from '../config/pair-catalog.js';

const DEFAULT_FOREX_OPEN_UTC = '21:00';
const DEFAULT_FOREX_CLOSE_UTC = '21:00';
const DEFAULT_ROLLOVER_START_UTC = '21:55';
const DEFAULT_ROLLOVER_END_UTC = '22:10';

const toMinutes = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const [h, m] = raw.split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return null;
  }
  return Math.min(24 * 60 - 1, Math.max(0, h * 60 + m));
};

const minutesFromDateUtc = (timeMs) => {
  const date = new Date(timeMs);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
};

const withinWindowUtc = (timeMs, start, end) => {
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin == null || endMin == null) {
    return false;
  }
  const current = minutesFromDateUtc(timeMs);
  if (startMin <= endMin) {
    return current >= startMin && current <= endMin;
  }
  return current >= startMin || current <= endMin;
};

const normalizeSymbolBase = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

export function createMarketRules(options = {}) {
  const brokerMeta = options.brokerMeta || {};
  const symbolAllowlist = new Set(
    (brokerMeta.symbolAllowlist || [])
      .map((value) =>
        String(value || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
  const symbolMap = brokerMeta.symbolMap || {};
  const symbolSuffix = String(brokerMeta.symbolSuffix || '')
    .trim()
    .toUpperCase();

  const forexOpenUtc = options.forexOpenUtc || DEFAULT_FOREX_OPEN_UTC;
  const forexCloseUtc = options.forexCloseUtc || DEFAULT_FOREX_CLOSE_UTC;
  const rolloverStartUtc = options.rolloverStartUtc || DEFAULT_ROLLOVER_START_UTC;
  const rolloverEndUtc = options.rolloverEndUtc || DEFAULT_ROLLOVER_END_UTC;
  const blockRollover = options.blockRollover !== false;
  const blockClosed = options.blockClosed !== false;

  const normalizeSymbol = (value) => {
    const raw = normalizeSymbolBase(value);
    if (!raw) {
      return null;
    }
    const mapped = symbolMap[raw] || symbolMap[raw.replace(/[^A-Z0-9]/g, '')] || null;
    const normalized = mapped ? normalizeSymbolBase(mapped) : raw;
    if (symbolSuffix && normalized.endsWith(symbolSuffix)) {
      return normalized.slice(0, -symbolSuffix.length);
    }
    return normalized;
  };

  const resolveBrokerSymbol = (value) => {
    const normalized = normalizeSymbol(value);
    if (!normalized) {
      return null;
    }
    if (symbolSuffix && !normalized.endsWith(symbolSuffix)) {
      return `${normalized}${symbolSuffix}`;
    }
    return normalized;
  };

  const isSymbolAllowed = (value) => {
    if (symbolAllowlist.size === 0) {
      return true;
    }
    const normalized = normalizeSymbol(value);
    if (!normalized) {
      return false;
    }
    return symbolAllowlist.has(normalized) || symbolAllowlist.has(resolveBrokerSymbol(normalized));
  };

  const isMarketOpen = (value, timeMs = Date.now()) => {
    const symbol = normalizeSymbol(value);
    if (!symbol) {
      return false;
    }
    const instrument = getPairMetadata(symbol);
    const assetClass = instrument?.assetClass || 'forex';
    if (assetClass === 'crypto') {
      return true;
    }

    const date = new Date(timeMs);
    const day = date.getUTCDay();
    const currentMinutes = minutesFromDateUtc(timeMs);
    const openMinutes = toMinutes(forexOpenUtc) ?? 21 * 60;
    const closeMinutes = toMinutes(forexCloseUtc) ?? 21 * 60;

    if (day === 6) {
      return false;
    }
    if (day === 0 && currentMinutes < openMinutes) {
      return false;
    }
    if (day === 5 && currentMinutes >= closeMinutes) {
      return false;
    }
    return true;
  };

  const isRolloverWindow = (timeMs = Date.now()) =>
    withinWindowUtc(timeMs, rolloverStartUtc, rolloverEndUtc);

  const getPrecision = (value) => {
    const symbol = normalizeSymbol(value);
    const instrument = symbol ? getPairMetadata(symbol) : null;
    return {
      symbol,
      pricePrecision: instrument?.pricePrecision ?? 5,
      pipSize: instrument?.pipSize ?? (symbol?.endsWith('JPY') ? 0.01 : 0.0001),
      contractSize: instrument?.contractSize ?? 100000,
      assetClass: instrument?.assetClass || 'forex'
    };
  };

  const validateOrder = (order = {}, timeMs = Date.now()) => {
    const symbol = normalizeSymbol(order.symbol || order.pair);
    if (!symbol) {
      return { allowed: false, reasons: ['symbol_required'] };
    }
    if (!isSymbolAllowed(symbol)) {
      return { allowed: false, reasons: ['symbol_not_allowed'] };
    }
    if (blockClosed && !isMarketOpen(symbol, timeMs)) {
      return { allowed: false, reasons: ['market_closed'] };
    }
    if (blockRollover && isRolloverWindow(timeMs)) {
      return { allowed: false, reasons: ['rollover_window'] };
    }
    return { allowed: true, reasons: [] };
  };

  return {
    normalizeSymbol,
    resolveBrokerSymbol,
    isSymbolAllowed,
    isMarketOpen,
    isRolloverWindow,
    getPrecision,
    validateOrder
  };
}
