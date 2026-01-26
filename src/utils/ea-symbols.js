const denyTokens = new Set(['BALANCE', 'EQUITY', 'MARGIN', 'FREE', 'ACCOUNT']);

export const normalizeBroker = (value) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === 'mt4' || raw === 'metatrader4') {
    return 'mt4';
  }
  if (raw === 'mt5' || raw === 'metatrader5') {
    return 'mt5';
  }
  return raw;
};

export const normalizeSymbol = (value) => {
  const symbol = String(value || '')
    .trim()
    .toUpperCase();
  return symbol || null;
};

export const isSaneEaSymbolToken = (symbol) => {
  const cleaned = String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!cleaned) {
    return false;
  }
  if (cleaned.length < 2 || cleaned.length > 40) {
    return false;
  }
  if (!/^[-A-Z0-9_.#:/]+$/.test(cleaned)) {
    return false;
  }
  if (denyTokens.has(cleaned)) {
    return false;
  }
  return true;
};

export const extractBaseSymbol = (value) => {
  const s = String(value || '')
    .trim()
    .toUpperCase();
  if (!s) {
    return null;
  }

  // Formats like EUR/USD, EUR:USD, EUR-USD
  const sepMatch = s.match(/^([A-Z]{3})(?:-|:|\/)([A-Z]{3})/);
  if (sepMatch) {
    return `${sepMatch[1]}${sepMatch[2]}`;
  }

  // Formats like EURUSD, EURUSDm, EURUSD.r
  const prefixMatch = s.match(/^([A-Z]{6})/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  // Formats like GOLD, SILVER, etc.
  const lettersOnly = s.replace(/[^A-Z]/g, '');
  return lettersOnly || null;
};
