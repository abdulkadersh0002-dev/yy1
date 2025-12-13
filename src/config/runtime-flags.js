/**
 * Runtime Flags - Production Mode Only
 * ALWAYS requires real-time data, NO synthetic data allowed
 */

// Production mode - always require real data
export function allowSyntheticData() {
  // NEVER allow synthetic data in production
  return false;
}

export function requireRealTimeData() {
  // ALWAYS require real-time data
  return true;
}

export function assertRealTimeDataAvailability(context, detail = '') {
  // Always validate real-time data availability
  const message = detail ? `${context}: ${detail}` : context;
  const error = new Error(`Real-time data required - ${message}`);
  error.code = 'REALTIME_DATA_REQUIRED';
  throw error;
}
