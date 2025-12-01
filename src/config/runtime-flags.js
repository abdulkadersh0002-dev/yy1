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

const rawNodeEnv = (process.env.NODE_ENV || '').toLowerCase();
const isTestEnv = rawNodeEnv === 'test';
const isProdEnv = rawNodeEnv === 'production';

export function allowSyntheticData() {
  const requireFlag = parseBooleanOrNull(process.env.REQUIRE_REALTIME_DATA);
  const allowFlag = parseBooleanOrNull(process.env.ALLOW_SYNTHETIC_DATA);

  if (allowFlag !== null) {
    return allowFlag;
  }

  if (requireFlag !== null) {
    return !requireFlag;
  }

  if (isProdEnv) {
    return false;
  }

  return true;
}

export function requireRealTimeData() {
  const requireFlag = parseBooleanOrNull(process.env.REQUIRE_REALTIME_DATA);
  if (requireFlag !== null) {
    return requireFlag;
  }
  return !allowSyntheticData();
}

export function assertRealTimeDataAvailability(context, detail = '') {
  if (!requireRealTimeData()) {
    return;
  }
  const message = detail ? `${context}: ${detail}` : context;
  const error = new Error(`Real-time data required - ${message}`);
  error.code = 'REALTIME_DATA_REQUIRED';
  throw error;
}
