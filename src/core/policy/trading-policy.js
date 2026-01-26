import { readEnvNumber } from '../../utils/env.js';

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function resolveNewsGuardThresholds(engineConfig = {}) {
  const envImpact = readEnvNumber('EA_NEWS_GUARD_IMPACT_THRESHOLD', null);
  const envMinutes = readEnvNumber('EA_NEWS_GUARD_BLACKOUT_MINUTES', null);

  const configImpact = toFiniteNumber(engineConfig.newsBlackoutImpactThreshold);
  const configMinutes = toFiniteNumber(engineConfig.newsBlackoutMinutes);

  return {
    impactThreshold: Number.isFinite(envImpact) ? envImpact : Number.isFinite(configImpact) ? configImpact : 60,
    blackoutMinutes: Number.isFinite(envMinutes) ? envMinutes : Number.isFinite(configMinutes) ? configMinutes : 30
  };
}

export function resolveLiquidityGuardThresholds(engineConfig = {}) {
  // Prefer the newer, explicit env var. Keep backwards compatibility.
  const envMaxSpread = readEnvNumber('EA_LIQUIDITY_MAX_SPREAD_PIPS', null);
  const envMaxSpreadCompat = readEnvNumber('EA_MAX_SPREAD_PIPS', null);

  const configMaxSpread = toFiniteNumber(engineConfig.maxSpreadPips);

  const maxSpreadPips = Number.isFinite(envMaxSpread)
    ? envMaxSpread
    : Number.isFinite(envMaxSpreadCompat)
      ? envMaxSpreadCompat
      : Number.isFinite(configMaxSpread)
        ? configMaxSpread
        : 4.5;

  return { maxSpreadPips };
}
