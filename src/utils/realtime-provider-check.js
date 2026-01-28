import { allowSyntheticData, requireRealTimeData, eaOnlyMode } from '../config/runtime-flags.js';
import { appConfig } from '../app/config.js';

const PLACEHOLDER_PATTERNS = [
  /^demo$/i,
  /^test$/i,
  /^test_/i,
  /^free$/i,
  /^sample$/i,
  /^placeholder$/i,
  /^changeme$/i,
  /^your[_-]/i,
  /^none$/i,
  /^na$/i,
];

function _isLikelyPlaceholder(value) {
  if (!value) {
    return true;
  }
  const normalized = String(value).trim();
  if (normalized.length === 0) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function enforceRealTimeProviderReadiness(apiKeys = {}, envConfig = appConfig.env) {
  void apiKeys;
  if (eaOnlyMode(envConfig)) {
    return;
  }
  if (!requireRealTimeData(envConfig)) {
    return;
  }

  if (allowSyntheticData(envConfig)) {
    const error = new Error('Real-time data enforcement requires ALLOW_SYNTHETIC_DATA=false');
    error.code = 'REALTIME_DATA_REQUIRED';
    throw error;
  }

  const hasEaBrokerEnabled = Boolean(
    appConfig?.brokers?.mt4?.enabled || appConfig?.brokers?.mt5?.enabled
  );

  const issues = [];
  const warnings = [];

  if (!hasEaBrokerEnabled) {
    issues.push('missing EA bridge (enable MT4 and/or MT5 broker bridge)');
  }

  const dbRequired = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'];
  const dbMissing = dbRequired.filter((key) => !envConfig[key]);
  if (dbMissing.length > 0) {
    warnings.push(`database configuration missing (${dbMissing.join(', ')})`);
  }

  if (issues.length > 0) {
    const error = new Error(`Real-time data requirement failed: ${issues.join('; ')}`);
    error.code = 'REALTIME_DATA_REQUIRED';
    throw error;
  }

  if (warnings.length > 0) {
    warnings.forEach((message) => {
      console.warn(`⚠️  ${message}`);
    });
  }
}
