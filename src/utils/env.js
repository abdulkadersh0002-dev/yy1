const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

export function parseBoolSafe(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (TRUTHY.has(normalized)) {
    return true;
  }
  if (FALSY.has(normalized)) {
    return false;
  }
  return defaultValue;
}

export function parseIntSafe(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

export function parseFloatSafe(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

export function parseListSafe(value, separator = ',') {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value)
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseJsonSafe(value, defaultValue = undefined) {
  if (!value) {
    return defaultValue;
  }
  try {
    if (typeof value === 'object') {
      return value;
    }
    return JSON.parse(String(value));
  } catch (_error) {
    return defaultValue;
  }
}

export function normalizeTradingScope(value, fallback = 'signals') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'signals' || normalized === 'signal') {
    return 'signals';
  }
  if (normalized === 'execution' || normalized === 'execute') {
    return 'execution';
  }
  if (normalized === 'autonomous' || normalized === 'auto' || normalized === 'full') {
    return 'autonomous';
  }
  return fallback;
}

export const readEnvString = (name, fallback = '') => {
  const value = process.env[name];
  if (value == null) {
    return fallback;
  }
  const s = String(value);
  return s;
};

export const readEnvBool = (name, fallback = null) => {
  const raw = readEnvString(name, '');
  if (raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (TRUTHY.has(normalized)) {
    return true;
  }
  if (FALSY.has(normalized)) {
    return false;
  }
  return fallback;
};

export const readEnvNumber = (name, fallback = null) => {
  const raw = readEnvString(name, '');
  if (raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const readEnvInt = (name, fallback = null) => {
  const n = readEnvNumber(name, fallback);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

export const readEnvCsvSet = (name, { lower = true } = {}) => {
  const raw = readEnvString(name, '').trim();
  if (!raw) {
    return new Set();
  }
  const parts = raw
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .map((v) => (lower ? v.toLowerCase() : v));
  return new Set(parts);
};
