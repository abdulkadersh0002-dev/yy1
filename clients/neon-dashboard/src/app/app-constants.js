export const SESSION_BLUEPRINT = [
  {
    id: 'sydney',
    label: 'Sydney Session',
    city: 'Sydney',
    timeZone: 'Australia/Sydney',
    windowLabel: '22:00 - 07:00 UTC',
    openMinutes: 22 * 60,
    closeMinutes: 7 * 60,
    theme: 'aqua',
  },
  {
    id: 'tokyo',
    label: 'Tokyo Session',
    city: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    windowLabel: '00:00 - 09:00 UTC',
    openMinutes: 0,
    closeMinutes: 9 * 60,
    theme: 'violet',
  },
  {
    id: 'london',
    label: 'London Session',
    city: 'London',
    timeZone: 'Europe/London',
    windowLabel: '08:00 - 17:00 UTC',
    openMinutes: 8 * 60,
    closeMinutes: 17 * 60,
    theme: 'magenta',
  },
  {
    id: 'new-york',
    label: 'New York Session',
    city: 'New York',
    timeZone: 'America/New_York',
    windowLabel: '13:00 - 22:00 UTC',
    openMinutes: 13 * 60,
    closeMinutes: 22 * 60,
    theme: 'amber',
  },
];

export const formatDuration = (totalMinutes) => {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;

  if (hoursPart === 0) {
    return `${minutesPart}m`;
  }

  if (minutesPart === 0) {
    return `${hoursPart}h`;
  }

  return `${hoursPart}h ${minutesPart}m`;
};

export const MAX_SIGNAL_ITEMS = 28;
export const MAX_EVENT_ITEMS = 28;
export const MAX_TICKER_RENDER = 120;
export const MAX_CANDIDATE_ITEMS = (() => {
  const raw = Number(import.meta?.env?.VITE_MAX_CANDIDATE_ITEMS);
  if (!Number.isFinite(raw)) {
    return 200;
  }
  return Math.max(25, Math.trunc(raw));
})();
export const MAX_ACTIVE_TRADES = 12;
export const MAX_HISTORY_TRADES = 40;
export const TICKER_WINDOW_SIZE = 220;
export const TICKER_ADVANCE_STEP = 110;
export const MAX_TICKER_SEARCH_RESULTS = 60;

const FX_CATALOG_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'NZD',
  'CAD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'SGD',
  'HKD',
  'ZAR',
  'TRY',
  'MXN',
  'PLN',
  'CZK',
  'HUF',
  'RON',
];

const FX_CATALOG_PAIRS = (() => {
  const pairs = new Set();
  for (const base of FX_CATALOG_CURRENCIES) {
    for (const quote of FX_CATALOG_CURRENCIES) {
      if (base === quote) {
        continue;
      }
      pairs.add(`${base}${quote}`);
    }
  }
  return [...pairs];
})();

const METAL_CATALOG_PAIRS = [
  'XAUUSD',
  'XAGUSD',
  'XPTUSD',
  'XPDUSD',
  'XAUEUR',
  'XAGEUR',
  'XAUJPY',
  'XAGJPY',
  'XAUGBP',
  'XAGGBP',
];

const CRYPTO_CATALOG_BASES = [
  'BTC',
  'ETH',
  'XRP',
  'SOL',
  'ADA',
  'DOGE',
  'LTC',
  'BNB',
  'DOT',
  'LINK',
  'AVAX',
  'MATIC',
  'TRX',
  'BCH',
  'ATOM',
  'XLM',
  'ETC',
  'UNI',
  'FIL',
  'AAVE',
  'NEAR',
  'ALGO',
  'ICP',
  'INJ',
  'APT',
  'SUI',
  'ARB',
  'OP',
  'PEPE',
  'SHIB',
  'TON',
  'HBAR',
];

const CRYPTO_CATALOG_PAIRS = (() => {
  const quotes = ['USD', 'USDT'];
  const pairs = new Set();
  for (const base of CRYPTO_CATALOG_BASES) {
    for (const quote of quotes) {
      if (base === quote) {
        continue;
      }
      pairs.add(`${base}${quote}`);
    }
  }
  return [...pairs];
})();

export const TICKER_CATALOG_SYMBOLS = (() => {
  const all = [...FX_CATALOG_PAIRS, ...METAL_CATALOG_PAIRS, ...CRYPTO_CATALOG_PAIRS];
  const unique = new Set(
    all
      .map((s) =>
        String(s || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
  return [...unique].sort();
})();

export const ACTIVE_SYMBOLS_SYNC_MAX = (() => {
  const raw = Number(import.meta?.env?.VITE_ACTIVE_SYMBOLS_SYNC_MAX);
  if (!Number.isFinite(raw)) {
    return 80;
  }
  return Math.max(1, Math.trunc(raw));
})();

// EA-only workspace mode:
// - Quotes come from EA bridge
// - Signals come from EA analysis only
// - Auto trading should be auto-started server-side (not via the dashboard UI)
export const EA_ONLY_UI_MODE = true;

export const toTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const minValidMs = Date.UTC(2010, 0, 1);
  const maxFutureMs = Date.now() + 1000 * 60 * 60 * 24 * 365 * 3;

  if (value instanceof Date) {
    const ts = value.getTime();
    if (!Number.isFinite(ts) || ts < minValidMs || ts > maxFutureMs) {
      return null;
    }
    return ts;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const maybeSeconds = value > 0 && value < 1e11;
    const ts = maybeSeconds ? value * 1000 : value;
    if (!Number.isFinite(ts) || ts < minValidMs || ts > maxFutureMs) {
      return null;
    }
    return ts;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      if (parsed < minValidMs || parsed > maxFutureMs) {
        return null;
      }
      return parsed;
    }
  }

  return null;
};

export const toNumber = (value) => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const normalizeBrokerId = (value) => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return '';
  }
  const cleaned = raw.replace(/["']/g, '').replace(/[\\/]+/g, '');
  if (cleaned === 'metatrader4') {
    return 'mt4';
  }
  if (cleaned === 'metatrader5') {
    return 'mt5';
  }
  if (cleaned === 'mt4' || cleaned === 'mt5') {
    return cleaned;
  }
  return cleaned;
};

export const normalizeTickerSymbol = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  let normalized = raw;
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.startsWith('#')) {
    normalized = normalized.slice(1);
  }

  // Handle UI decorations like "EURUSD · MT5".
  if (normalized.includes('·')) {
    normalized = normalized.split('·')[0];
  }

  normalized = normalized.replace(/\s+/g, '');
  normalized = normalized.replace(/[^A-Za-z0-9.]/g, '');

  return normalized.toUpperCase();
};

export const extractFxCurrencies = (symbolUpper) => {
  if (!symbolUpper || typeof symbolUpper !== 'string') {
    return null;
  }
  if (/^[A-Z]{6}$/.test(symbolUpper)) {
    return [symbolUpper.slice(0, 3), symbolUpper.slice(3, 6)];
  }
  return null;
};

export const TICKER_CATEGORIES = [
  { id: 'ALL', label: 'FX + Metals + Crypto' },
  { id: 'FX', label: 'FX' },
  { id: 'METALS', label: 'Metals' },
  { id: 'CRYPTO', label: 'Crypto' },
];

export const isFxSymbol = (symbolUpper) => {
  if (!symbolUpper) {
    return false;
  }
  if (!/^[A-Z]{6}$/.test(symbolUpper)) {
    return false;
  }
  return Boolean(extractFxCurrencies(symbolUpper));
};

export const isMetalSymbol = (symbolUpper) => {
  if (!symbolUpper) {
    return false;
  }
  return (
    symbolUpper.startsWith('XAU') ||
    symbolUpper.startsWith('XAG') ||
    symbolUpper.startsWith('XPT') ||
    symbolUpper.startsWith('XPD')
  );
};

export const isCryptoSymbol = (symbolUpper) => {
  if (!symbolUpper) {
    return false;
  }
  const sym = String(symbolUpper).trim().toUpperCase();

  // Common broker conventions: BTCUSD, ETHUSD, BTCUSDT, etc.
  // Keep this heuristic permissive so "all crypto" can still show.
  if (
    sym.startsWith('BTC') ||
    sym.startsWith('ETH') ||
    sym.startsWith('XRP') ||
    sym.startsWith('SOL') ||
    sym.startsWith('ADA') ||
    sym.startsWith('DOGE') ||
    sym.startsWith('LTC') ||
    sym.startsWith('BNB') ||
    sym.startsWith('DOT') ||
    sym.startsWith('LINK') ||
    sym.startsWith('AVAX') ||
    sym.startsWith('MATIC') ||
    sym.startsWith('TRX') ||
    sym.startsWith('BCH')
  ) {
    return true;
  }

  // Generic quote currencies for many crypto CFD feeds.
  // Example: BNBUSD, AAVEUSDT
  if (/^[A-Z]{3,6}(USD|USDT)$/.test(sym)) {
    return true;
  }

  return false;
};

export const classifyTickerSymbol = (symbolUpper) => {
  if (!symbolUpper) {
    return 'UNKNOWN';
  }
  if (isFxSymbol(symbolUpper)) {
    return 'FX';
  }
  if (isMetalSymbol(symbolUpper)) {
    return 'METALS';
  }
  if (isCryptoSymbol(symbolUpper)) {
    return 'CRYPTO';
  }
  return 'UNKNOWN';
};
