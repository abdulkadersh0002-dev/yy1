const truthyValues = new Set(['1', 'true', 'yes', 'on']);
const falsyValues = new Set(['0', 'false', 'no', 'off']);

function parseBooleanOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (truthyValues.has(normalized)) {
    return true;
  }
  if (falsyValues.has(normalized)) {
    return false;
  }
  return null;
}

function normalizeNodeEnv(envConfig) {
  return String(envConfig?.NODE_ENV || '').toLowerCase();
}

export function allowSyntheticData(envConfig = process.env) {
  const requireFlag = parseBooleanOrNull(envConfig?.REQUIRE_REALTIME_DATA);
  const allowFlag = parseBooleanOrNull(envConfig?.ALLOW_SYNTHETIC_DATA);

  if (allowFlag !== null) {
    return allowFlag;
  }

  if (requireFlag !== null) {
    return !requireFlag;
  }

  const rawNodeEnv = normalizeNodeEnv(envConfig);
  if (rawNodeEnv === 'test') {
    return true;
  }
  const isProdEnv = rawNodeEnv === 'production';
  if (isProdEnv) {
    return false;
  }

  // Default to real-only in development unless explicitly allowed.
  return false;
}

export function requireRealTimeData(envConfig = process.env) {
  const requireFlag = parseBooleanOrNull(envConfig?.REQUIRE_REALTIME_DATA);
  if (requireFlag !== null) {
    return requireFlag;
  }
  return !allowSyntheticData(envConfig);
}

export function eaOnlyMode(envConfig = process.env) {
  const flag = parseBooleanOrNull(envConfig?.EA_ONLY_MODE);
  if (flag !== null) {
    return flag;
  }

  // Opt-in by default to keep integration/unit tests stable.
  // The production/dev server can choose to default this on at boot.
  return false;
}

export function assertRealTimeDataAvailability(arg1, arg2, arg3 = '') {
  const envConfig =
    arg1 && typeof arg1 === 'object' && arg2 !== undefined ? (arg1 ?? process.env) : process.env;
  const context =
    arg1 && typeof arg1 === 'object' && arg2 !== undefined ? arg2 : (arg1 ?? 'unknown');
  const detail = arg1 && typeof arg1 === 'object' && arg2 !== undefined ? arg3 : (arg2 ?? '');

  if (!requireRealTimeData(envConfig)) {
    return;
  }
  const message = detail ? `${context}: ${detail}` : context;
  const error = new Error(`Real-time data required - ${message}`);
  error.code = 'REALTIME_DATA_REQUIRED';
  throw error;
}
