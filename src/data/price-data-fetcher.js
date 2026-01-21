import axios from 'axios';
import TwelveDataProvider from './providers/twelvedata-provider.js';
import FinnhubProvider from './providers/finnhub-provider.js';
import {
  allowSyntheticData,
  requireRealTimeData,
  assertRealTimeDataAvailability
} from '../config/runtime-flags.js';
import { appConfig } from '../app/config.js';
import {
  getPairMetadata,
  getProviderSymbol,
  getSyntheticBasePrice,
  getSyntheticVolatility,
  getPipSize
} from '../config/pair-catalog.js';

const PROVIDERS = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'];

const PROVIDER_KEY_MAP = PROVIDERS.reduce((acc, name) => {
  acc[name] = name;
  acc[name.toLowerCase()] = name;
  return acc;
}, {});

const IS_TEST_ENV = (appConfig.env.NODE_ENV || '').toLowerCase() === 'test';

const PROVIDER_LABELS = {
  twelveData: 'Twelve Data',
  polygon: 'Polygon.io',
  finnhub: 'Finnhub',
  alphaVantage: 'Alpha Vantage'
};

const DEFAULT_RATE_LIMITS = {
  twelveData: { windowMs: 60_000, maxRequests: 55, cooldownMs: 12_000 },
  polygon: { windowMs: 60_000, maxRequests: 120, cooldownMs: 10_000 },
  finnhub: { windowMs: 60_000, maxRequests: 60, cooldownMs: 15_000 },
  alphaVantage: { windowMs: 86_400_000, maxRequests: 500, cooldownMs: 60_000 }
};

const DEFAULT_LATENCY_TARGETS = {
  twelveData: 1200,
  polygon: 900,
  finnhub: 1400,
  alphaVantage: 2400
};

// Optimized cache TTLs for real data within API limits
// Longer timeframes don't need frequent updates
const DEFAULT_CACHE_TTLS = {
  M1: 45_000, // 45s (was 8s) - M1 rarely used for forex signals
  M5: 4_60_000, // 4.6min (was 20s) - Still responsive for scalping
  M15: 12_00_000, // 12min (was 45s) - Primary timeframe for signals
  M30: 25_00_000, // 25min (was 1min) - Intermediate timeframe
  H1: 50_00_000, // 50min (was 2min) - Hourly updates sufficient
  H2: 90_00_000, // 1.5h (was 2.5min) - Multi-hour perspective
  H4: 3_000_000, // 3h (was 5min) - Daily perspective
  H6: 5_000_000, // 5h (was 7min) - Extended view
  H12: 10_000_000, // 10h (was 9min) - Half-day view
  D1: 18_000_000, // 18h (was 10min) - Daily candles stable
  W1: 1_200_000 // 20min (unchanged) - Weekly updates rare
};

const TIMEFRAME_ALIASES = {
  '1m': 'M1',
  m1: 'M1',
  '60s': 'M1',
  '5m': 'M5',
  m5: 'M5',
  '15m': 'M15',
  m15: 'M15',
  '30m': 'M30',
  m30: 'M30',
  '1h': 'H1',
  '60m': 'H1',
  h1: 'H1',
  '2h': 'H2',
  '120m': 'H2',
  h2: 'H2',
  '4h': 'H4',
  '240m': 'H4',
  h4: 'H4',
  '6h': 'H6',
  '360m': 'H6',
  h6: 'H6',
  '12h': 'H12',
  '720m': 'H12',
  h12: 'H12',
  '1d': 'D1',
  '24h': 'D1',
  d1: 'D1',
  '1w': 'W1',
  w1: 'W1'
};

export const TIMEFRAME_DERIVATIONS = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H2: 7200,
  H4: 14_400,
  H6: 21_600,
  H12: 43_200,
  D1: 86_400,
  W1: 604_800
};

const FAILURE_BREAKER_THRESHOLD = 3;
const LATENCY_BREAKER_MULTIPLIER = 1.6;
const QUALITY_BREAKER_THRESHOLD = 0.4;
const BREAKER_DURATION_MS = 2 * 60_000;

const POLYGON_INTERVALS = {
  M1: { multiplier: 1, unit: 'minute' },
  M5: { multiplier: 5, unit: 'minute' },
  M15: { multiplier: 15, unit: 'minute' },
  M30: { multiplier: 30, unit: 'minute' },
  H1: { multiplier: 1, unit: 'hour' },
  H2: { multiplier: 2, unit: 'hour' },
  H4: { multiplier: 4, unit: 'hour' },
  H6: { multiplier: 6, unit: 'hour' },
  H12: { multiplier: 12, unit: 'hour' },
  D1: { multiplier: 1, unit: 'day' }
};

const ALPHA_ENDPOINTS = {
  M1: { fn: 'FX_INTRADAY', interval: '1min' },
  M5: { fn: 'FX_INTRADAY', interval: '5min' },
  M15: { fn: 'FX_INTRADAY', interval: '15min' },
  M30: { fn: 'FX_INTRADAY', interval: '30min' },
  H1: { fn: 'FX_INTRADAY', interval: '60min' },
  D1: { fn: 'FX_DAILY' }
};

function normalizeTimeframe(input) {
  if (input == null) {
    return 'M15';
  }
  const token = String(input).trim();
  if (!token) {
    return 'M15';
  }
  const lower = token.toLowerCase();
  if (TIMEFRAME_ALIASES[lower]) {
    return TIMEFRAME_ALIASES[lower];
  }
  const upper = token.toUpperCase();
  return TIMEFRAME_DERIVATIONS[upper] ? upper : upper;
}

export function timeframeToSeconds(timeframe) {
  const normalized = normalizeTimeframe(timeframe);
  return TIMEFRAME_DERIVATIONS[normalized] || null;
}

function timeframeToMilliseconds(timeframe) {
  const seconds = timeframeToSeconds(timeframe);
  return seconds ? seconds * 1000 : null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function resolveProviderKey(input) {
  if (!input && input !== 0) {
    return null;
  }
  const key = String(input);
  return PROVIDER_KEY_MAP[key] || PROVIDER_KEY_MAP[key.toLowerCase()] || null;
}

function createRealtimeError(context, detail = '') {
  const message = detail ? `${context}: ${detail}` : context;
  const error = new Error(`Real-time data required - ${message}`);
  error.code = 'REALTIME_DATA_REQUIRED';
  return error;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rounded(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export default class PriceDataFetcher {
  constructor(apiKeys = {}, options = {}) {
    const tradingApiKeys = appConfig.trading?.apiKeys || {};

    this.apiKeys = {
      twelveData: apiKeys.twelveData || tradingApiKeys.twelveData || null,
      polygon: apiKeys.polygon || tradingApiKeys.polygon || null,
      finnhub: apiKeys.finnhub || tradingApiKeys.finnhub || null,
      alphaVantage: apiKeys.alphaVantage || tradingApiKeys.alphaVantage || null
    };

    this.logger = options.logger || console;
    this.alertBus = options.alertBus || null;
    this.persistence = options.persistence || null;
    this.allowUnconfiguredProviders = options.allowUnconfiguredProviders ?? true;

    this.disabledProviders = new Set(
      Array.isArray(options.disabledProviders)
        ? options.disabledProviders.map((name) => String(name).toLowerCase())
        : []
    );

    this.providerRequestIntervals = {
      ...options.providerRequestIntervals
    };

    this.fastTimeframes = new Set(
      (options.fastTimeframes || ['M1', 'M5', 'M15', 'M30']).map((tf) => normalizeTimeframe(tf))
    );
    this.slowTimeframes = new Set(
      (options.slowTimeframes || ['H4', 'H6', 'H12', 'D1', 'W1']).map((tf) =>
        normalizeTimeframe(tf)
      )
    );
    this.alphaPreferredTimeframes = new Set(
      (options.alphaPreferredTimeframes || ['D1']).map((tf) => normalizeTimeframe(tf))
    );

    this.rateLimits = this.initializeRateLimits(options.rateLimitOverrides || {});
    this.providerLatencyTargets = {
      ...DEFAULT_LATENCY_TARGETS,
      ...(options.providerLatencyTargets || {})
    };

    this.metrics = this.initializeMetrics();
    this.providerHealth = this.initializeProviderHealth();

    this.dataCache = new Map();
    this.quoteCache = new Map();
    this.inFlight = new Map();
    this.quoteInFlight = new Map();
    this.refreshTimers = new Map();

    this.cacheOptions = {
      defaultTtlMs: options.defaultCacheTtlMs || 45_000
    };

    this.circuitBreakerConfig = {
      failureThreshold: options.failureThreshold ?? FAILURE_BREAKER_THRESHOLD,
      failureCooldownMs: options.failureCooldownMs ?? BREAKER_DURATION_MS,
      latencyMultiplier: options.latencyMultiplier ?? LATENCY_BREAKER_MULTIPLIER,
      latencyCooldownMs: options.latencyCooldownMs ?? BREAKER_DURATION_MS,
      qualityThreshold: options.qualityThreshold ?? QUALITY_BREAKER_THRESHOLD,
      qualityCooldownMs: options.qualityCooldownMs ?? BREAKER_DURATION_MS
    };

    this.providers = {};
    this.bootstrapProviders();
  }

  initializeRateLimits(overrides) {
    const rateLimits = {};
    for (const provider of PROVIDERS) {
      const base = DEFAULT_RATE_LIMITS[provider] || {
        windowMs: 60_000,
        maxRequests: 60,
        cooldownMs: 10_000
      };
      const override = overrides[provider] || {};
      const overrideMax = safeNumber(override.maxRequests);
      const baseMax = safeNumber(base.maxRequests);
      const maxRequests = overrideMax ?? baseMax;

      rateLimits[provider] = {
        ...base,
        ...override,
        maxRequests: Number.isFinite(maxRequests) ? maxRequests : null,
        usage: [],
        count: 0,
        remaining: Number.isFinite(maxRequests) ? Math.max(0, maxRequests) : null,
        resetTime: Date.now() + (base.windowMs || 60_000),
        backoffUntil: 0,
        lastRateLimit: 0
      };
    }
    return rateLimits;
  }

  initializeMetrics() {
    const providerMetrics = {};
    for (const provider of PROVIDERS) {
      providerMetrics[provider] = this.createProviderMetrics(provider);
    }
    return {
      requests: {
        total: 0,
        success: 0,
        failed: 0,
        cached: 0,
        lastRequestAt: null,
        lastSuccessAt: null,
        lastFailureAt: null
      },
      providers: providerMetrics
    };
  }

  initializeProviderHealth() {
    const entries = {};
    for (const provider of PROVIDERS) {
      const entry = {
        provider,
        status: 'unknown',
        lastUpdated: null,
        circuitBreaker: null,
        consecutiveFailures: 0,
        backoffUntil: 0,
        rateLimited: 0
      };
      entries[provider] = entry;
      entries[provider.toLowerCase()] = entry;
    }
    return entries;
  }

  getProviderHealthEntry(provider) {
    const key = resolveProviderKey(provider) || String(provider || '').toLowerCase();
    if (!key) {
      return null;
    }
    return this.providerHealth[key] || this.providerHealth[key.toLowerCase()] || null;
  }

  createProviderMetrics(provider) {
    return {
      provider,
      label: this.getProviderLabel(provider),
      success: 0,
      failed: 0,
      samples: 0,
      rateLimited: 0,
      lastRequestAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      avgLatencyMs: null,
      latencySamples: [],
      qualityScore: null,
      normalizedQuality: 1,
      healthStatus: 'unknown',
      consecutiveFailures: 0,
      circuitBreaker: null,
      backoffUntil: null
    };
  }

  bootstrapProviders() {
    this.providers.twelveData = new TwelveDataProvider({
      apiKey: this.apiKeys.twelveData,
      logger: this.logger,
      formatPair: (pair) => getProviderSymbol(pair, 'twelveData'),
      recordRequest: (providerName, payload) =>
        this.recordRequest(providerName || 'twelveData', payload),
      validatePriceBars: (series, context) => this.validatePriceBars(series, context),
      normalizeQuote: (raw) => this.normalizeTwelveDataQuote(raw),
      normalizeBars: (raw) => this.normalizeTwelveDataSeries(raw),
      registerRateLimitHit: (providerName, meta) =>
        this.registerRateLimitHit(providerName || 'twelveData', meta),
      shouldUseSyntheticData: (opts) => this.shouldUseSyntheticData(opts),
      generateSyntheticQuote: (pair, opts) => this.generateSyntheticQuote(pair, opts),
      convertTimeframe: (tf) => this.convertTimeframeForTwelveData(tf),
      cooldownMs: this.rateLimits.twelveData.cooldownMs,
      requestIntervals: this.providerRequestIntervals
    });

    this.providers.finnhub = new FinnhubProvider({
      apiKey: this.apiKeys.finnhub,
      logger: this.logger,
      resolveSymbol: (pair) => getProviderSymbol(pair, 'finnhub'),
      convertTimeframe: (tf) => this.convertTimeframeForFinnhub(tf),
      getTimeframeSeconds: (tf) => timeframeToSeconds(tf),
      recordRequest: (providerName, payload) =>
        this.recordRequest(providerName || 'finnhub', payload),
      validatePriceBars: (series, context) => this.validatePriceBars(series, context),
      normalizeBars: (raw) => this.normalizeFinnhubSeries(raw),
      normalizeQuote: (raw) => this.normalizeFinnhubQuote(raw),
      registerRateLimitHit: (providerName, meta) =>
        this.registerRateLimitHit(providerName || 'finnhub', meta),
      shouldUseSyntheticData: (opts) => this.shouldUseSyntheticData(opts),
      generateSyntheticQuote: (pair, opts) => this.generateSyntheticQuote(pair, opts),
      cooldownMs: this.rateLimits.finnhub.cooldownMs
    });
  }

  getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || provider;
  }

  providerConfigured(provider) {
    const key = resolveProviderKey(provider);
    if (!key) {
      return false;
    }
    if (this.providerDisabled(key)) {
      return false;
    }
    if (key === 'twelveData') {
      const configured = Boolean(this.providers.twelveData?.isConfigured?.());
      return configured || this.allowUnconfiguredProviders || IS_TEST_ENV;
    }
    if (key === 'finnhub') {
      const configured = Boolean(this.providers.finnhub?.isConfigured?.());
      return configured || this.allowUnconfiguredProviders || IS_TEST_ENV;
    }
    const apiKey = this.apiKeys[key];
    const configured = Boolean(apiKey && String(apiKey).trim().length > 0);
    return configured || this.allowUnconfiguredProviders || IS_TEST_ENV;
  }

  providerDisabled(provider) {
    if (!provider) {
      return false;
    }
    const normalized = String(provider).toLowerCase();
    return this.disabledProviders.has(normalized);
  }

  providerHasCredentials(provider) {
    const key = resolveProviderKey(provider);
    if (!key) {
      return false;
    }
    if (key === 'twelveData') {
      return Boolean(this.providers.twelveData?.isConfigured?.());
    }
    if (key === 'finnhub') {
      return Boolean(this.providers.finnhub?.isConfigured?.());
    }
    const value = this.apiKeys[key];
    if (!value) {
      return false;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return !['demo', 'free', 'placeholder', 'test'].includes(normalized);
  }

  getProviderAvailability(provider, options = {}) {
    const key = resolveProviderKey(provider);
    const now = options.now ?? Date.now();
    const allowUnconfigured =
      options.allowUnconfigured ?? (this.allowUnconfiguredProviders || IS_TEST_ENV);

    if (!key) {
      return {
        provider: provider || null,
        available: false,
        reasons: ['unknown_provider'],
        hasCredentials: false,
        disabled: false,
        circuitBreakerActive: false,
        backoffUntil: null,
        remainingRequests: null
      };
    }

    const reasons = [];
    const disabled = this.providerDisabled(key);
    if (disabled) {
      reasons.push('disabled');
    }

    const hasCredentials = this.providerHasCredentials(key);
    if (!hasCredentials && !allowUnconfigured) {
      reasons.push('missing_credentials');
    }

    const limit = this.rateLimits[key];
    const metrics = this.metrics.providers[key];

    let circuitBreakerActive = false;
    if (metrics?.circuitBreaker) {
      const expiresAt = metrics.circuitBreaker.expiresAt
        ? new Date(metrics.circuitBreaker.expiresAt).getTime()
        : null;
      if (!Number.isFinite(expiresAt) || expiresAt > now) {
        circuitBreakerActive = true;
        const reason = metrics.circuitBreaker.reason || 'blocked';
        reasons.push(`circuit_breaker:${reason}`);
      }
    }

    if (limit) {
      this.trimUsage(key, now);
    }

    if (limit?.backoffUntil && limit.backoffUntil > now) {
      reasons.push('backoff_active');
    }

    const rateLimited = Boolean(limit?.maxRequests && limit.count >= limit.maxRequests);
    if (rateLimited) {
      reasons.push('rate_limit');
    }

    const eligible = !disabled && (hasCredentials || allowUnconfigured);
    const available =
      eligible && !circuitBreakerActive && !(limit?.backoffUntil > now) && !rateLimited;

    return {
      provider: key,
      available,
      reasons: Array.from(new Set(reasons)),
      hasCredentials,
      disabled,
      circuitBreakerActive,
      backoffUntil: limit?.backoffUntil ?? null,
      remainingRequests: limit?.remaining ?? null
    };
  }

  hasAvailableProvider(timeframeInput, options = {}) {
    const viability = this.isDataFetchViable(timeframeInput, {
      ...options,
      includeDetails: true
    });
    return viability?.availableProviders?.length > 0 || false;
  }

  isProviderInBackoff(provider, now = Date.now()) {
    const key = resolveProviderKey(provider);
    if (!key) {
      return false;
    }
    const limit = this.rateLimits[key];
    return Boolean(limit && limit.backoffUntil && limit.backoffUntil > now);
  }

  canMakeRequest(provider, now = Date.now()) {
    const key = resolveProviderKey(provider);
    if (!key) {
      return false;
    }
    const limit = this.rateLimits[key];
    const health = this.getProviderHealthEntry(key);

    if (this.providerDisabled(key)) {
      return false;
    }

    if (!this.providerConfigured(key)) {
      return false;
    }

    // Clear expired circuit breaker
    const metrics = this.metrics.providers[key];
    if (metrics?.circuitBreaker?.expiresAt) {
      const expiresAt = new Date(metrics.circuitBreaker.expiresAt).getTime();
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        this.clearCircuitBreaker(key, 'expired');
      }
    }

    if (metrics?.circuitBreaker) {
      return false;
    }

    if (!limit) {
      return true;
    }

    this.trimUsage(key, now);

    if (limit.backoffUntil && limit.backoffUntil > now) {
      return false;
    }

    if (limit.maxRequests) {
      const windowStart = now - limit.windowMs;
      const usageInWindow = limit.usage.filter((timestamp) => timestamp >= windowStart).length;
      if (usageInWindow >= limit.maxRequests) {
        if (health) {
          health.rateLimited += 1;
        }
        return false;
      }
    }
    return true;
  }

  getRequestAllowance(provider, now = Date.now()) {
    const key = resolveProviderKey(provider);
    const allowed = key ? this.canMakeRequest(key, now) : false;
    if (allowed) {
      return {
        allowed: true,
        reason: null,
        waitMs: 0
      };
    }

    const limitKey = key || resolveProviderKey(provider);
    const limit = limitKey ? this.rateLimits[limitKey] : null;
    let waitMs = 0;
    let reason = 'rate_limit';

    if (!limitKey) {
      reason = 'unknown';
    } else if (this.providerDisabled(limitKey)) {
      reason = 'disabled';
    } else if (!this.providerConfigured(limitKey)) {
      reason = 'unconfigured';
    } else if (this.metrics.providers[limitKey]?.circuitBreaker) {
      reason = `circuit_breaker:${this.metrics.providers[limitKey].circuitBreaker.reason}`;
      const expiresAt = new Date(
        this.metrics.providers[limitKey].circuitBreaker.expiresAt
      ).getTime();
      if (Number.isFinite(expiresAt)) {
        waitMs = Math.max(0, expiresAt - now);
      }
    } else if (limit?.backoffUntil && limit.backoffUntil > now) {
      reason = 'backoff';
      waitMs = Math.max(0, limit.backoffUntil - now);
    } else if (limit?.maxRequests) {
      const oldest = limit.usage[0];
      if (Number.isFinite(oldest)) {
        waitMs = Math.max(0, oldest + limit.windowMs - now);
      }
    }

    return {
      allowed: false,
      reason,
      waitMs
    };
  }

  trimUsage(provider, now = Date.now()) {
    const key = resolveProviderKey(provider);
    const limit = key ? this.rateLimits[key] : null;
    if (!limit) {
      return;
    }
    const windowMs = Number.isFinite(limit.windowMs) ? limit.windowMs : 60_000;
    const cutoff = now - windowMs;
    limit.usage = limit.usage.filter((timestamp) => timestamp >= cutoff);
    limit.count = limit.usage.length;
    if (Number.isFinite(limit.maxRequests)) {
      limit.remaining = Math.max(0, limit.maxRequests - limit.count);
    } else {
      limit.remaining = null;
    }
    limit.resetTime = limit.usage.length > 0 ? limit.usage[0] + windowMs : now + windowMs;
  }

  addUsageSample(provider, timestamp = Date.now()) {
    const key = resolveProviderKey(provider);
    const limit = key ? this.rateLimits[key] : null;
    if (!limit) {
      return;
    }
    limit.usage.push(timestamp);
    this.trimUsage(key, timestamp);
  }

  handleRateLimitSkip(provider) {
    const key = resolveProviderKey(provider);
    const metrics = key ? this.metrics.providers[key] : null;
    if (!metrics) {
      return;
    }
    metrics.rateLimited += 1;
    const health = this.getProviderHealthEntry(key);
    if (health) {
      health.rateLimited += 1;
    }
  }

  registerRateLimitHit(provider, options = {}) {
    const key = resolveProviderKey(provider);
    const limit = key ? this.rateLimits[key] : null;
    if (!limit) {
      return;
    }
    const metrics = this.metrics.providers[key];
    const retryAfterMs = Number.isFinite(options.retryAfterMs)
      ? options.retryAfterMs
      : limit.cooldownMs;
    const now = Date.now();
    const backoff = Math.max(retryAfterMs || limit.cooldownMs || 10_000, 2000);
    limit.backoffUntil = now + backoff;
    limit.lastRateLimit = now;
    if (Number.isFinite(limit.maxRequests)) {
      limit.remaining = 0;
    } else {
      limit.remaining = null;
    }
    if (metrics) {
      metrics.rateLimited += 1;
      metrics.backoffUntil = limit.backoffUntil;
    }
    const health = this.getProviderHealthEntry(key);
    if (health) {
      health.backoffUntil = limit.backoffUntil;
      health.rateLimited += 1;
      health.lastUpdated = now;
    }
  }

  isQuotaPressure(provider, threshold = 0.85, now = Date.now()) {
    const limit = this.rateLimits[provider];
    if (!limit || !limit.maxRequests) {
      return false;
    }
    this.trimUsage(provider, now);
    const ratio = limit.count / limit.maxRequests;
    return ratio >= threshold;
  }

  async fetchPriceData(pair, timeframeInput, bars = 240, options = {}) {
    const timeframe = normalizeTimeframe(timeframeInput);
    const requestedBars = Number.isInteger(bars) && bars > 0 ? bars : 240;
    const cacheKey = this.buildCacheKey(pair, timeframe, requestedBars, options);
    const useCache = options.bypassCache !== true;

    this.metrics.requests.total += 1;
    this.metrics.requests.lastRequestAt = Date.now();

    if (useCache) {
      const cached = this.getCachedSeries(cacheKey, options);
      if (cached) {
        this.metrics.requests.cached += 1;
        this.metrics.requests.success += 1;
        return cached.series;
      }
    }

    const dedupPromise = this.fetchWithDedup(cacheKey, () =>
      this.executeProviderFetch(pair, timeframe, requestedBars, options)
    );
    const result = await dedupPromise;

    if (Array.isArray(result) && result.length > 0) {
      const ttl = this.resolveCacheTtl(timeframe, options.cacheTtlMs);
      if (useCache && ttl > 0) {
        this.cacheSeries(cacheKey, result, {
          ttl,
          provider: result.provider || null,
          timeframe,
          pair,
          bars: requestedBars
        });
      }
      this.metrics.requests.success += 1;
      this.metrics.requests.lastSuccessAt = Date.now();
      return result;
    }

    if (!this.shouldUseSyntheticData(options)) {
      const message = options.disableCrossDerivation
        ? 'No provider returned data'
        : 'Providers unavailable';
      const error = createRealtimeError('fetchPriceData', message);
      if (requireRealTimeData()) {
        throw error;
      }
      throw error;
    }

    const synthetic = this.generateSimulatedData(pair, requestedBars, { timeframe });
    this.metrics.requests.success += 1;
    this.metrics.requests.lastSuccessAt = Date.now();
    return synthetic;
  }

  async executeProviderFetch(pair, timeframe, bars, options) {
    const order = this.getProviderOrder(timeframe);
    const results = [];
    const now = Date.now();
    let lastError = null;

    for (const provider of order) {
      if (!this.providerConfigured(provider)) {
        continue;
      }

      const allowance = this.getRequestAllowance(provider, now);
      if (!allowance.allowed) {
        this.handleRateLimitSkip(provider);
        continue;
      }

      const started = Date.now();
      try {
        const providerOptions = options
          ? { ...options, skipProviderTelemetry: true }
          : { skipProviderTelemetry: true };
        const series = await this.fetchFromProvider(
          provider,
          pair,
          timeframe,
          bars,
          providerOptions
        );
        const latencyMs = Date.now() - started;
        const success = Array.isArray(series) && series.length > 0;
        const qualityScore = success ? clamp(series.length / bars, 0, 1) : 0;

        this.recordRequest(provider, { success, latencyMs, qualityScore });

        if (success) {
          series.provider = provider;
          results.push(series);
          return series;
        }
      } catch (error) {
        lastError = error;
        const latencyMs = Date.now() - started;
        this.recordRequest(provider, { success: false, latencyMs, qualityScore: 0 });
        continue;
      }
    }

    if (lastError) {
      this.metrics.requests.failed += 1;
      this.metrics.requests.lastFailureAt = Date.now();
      this.logger?.warn?.(
        { pair, timeframe, err: lastError },
        'Price data providers exhausted without success'
      );
    } else {
      this.metrics.requests.failed += 1;
      this.metrics.requests.lastFailureAt = Date.now();
    }

    return null;
  }

  async fetchWithDedup(key, executor) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }
    const promise = (async () => {
      try {
        return await executor();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  async fetchFromProvider(provider, pair, timeframe, bars, options) {
    switch (provider) {
      case 'twelveData':
        return this.fetchFromTwelveData(pair, timeframe, bars, options);
      case 'polygon':
        return this.fetchFromPolygon(pair, timeframe, bars, options);
      case 'finnhub':
        return this.fetchFromFinnhub(pair, timeframe, bars, options);
      case 'alphaVantage':
        return this.fetchFromAlphaVantage(pair, timeframe, bars, options);
      default:
        return null;
    }
  }

  async fetchFromTwelveData(pair, timeframe, bars, options = {}) {
    if (!this.providers.twelveData) {
      return null;
    }
    const result = await this.providers.twelveData.fetchBars({ pair, timeframe, bars, options });
    return this.postProcessSeries(result, { pair, timeframe, provider: 'twelveData', bars });
  }

  async fetchFromFinnhub(pair, timeframe, bars, options = {}) {
    if (!this.providers.finnhub) {
      return null;
    }
    const result = await this.providers.finnhub.fetchBars({ pair, timeframe, bars, options });
    return this.postProcessSeries(result, { pair, timeframe, provider: 'finnhub', bars });
  }

  async fetchFromPolygon(pair, timeframe, bars, options = {}) {
    if (!this.providerConfigured('polygon')) {
      return null;
    }
    const apiKey = this.apiKeys.polygon;
    const symbol = getProviderSymbol(pair, 'polygon');
    if (!symbol) {
      return null;
    }
    const normalizedTimeframe = normalizeTimeframe(timeframe);
    const interval = POLYGON_INTERVALS[normalizedTimeframe];
    if (!interval) {
      return null;
    }

    const timeframeMs = timeframeToMilliseconds(normalizedTimeframe) || 60_000;
    const lookbackMs = timeframeMs * Math.max(bars + 5, 20);
    const to = new Date();
    const from = new Date(to.getTime() - lookbackMs);
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${interval.multiplier}/${interval.unit}/${from.toISOString().split('T')[0]}/${to.toISOString().split('T')[0]}`;
    const started = Date.now();

    try {
      const { data, status } = await axios.get(String(url), {
        params: {
          adjusted: true,
          sort: 'desc',
          limit: Math.min(5000, Math.max(bars * 2, 120)),
          apiKey
        },
        timeout: options.timeoutMs || 8000
      });
      const latencyMs = Date.now() - started;

      if (status === 429 || data?.status === 'ERROR') {
        this.registerRateLimitHit('polygon');
        if (!options.skipProviderTelemetry) {
          this.recordRequest('polygon', { success: false, latencyMs, qualityScore: 0 });
        }
        return null;
      }

      const normalized = this.normalizePolygonSeries(data?.results || []);
      const processed = this.postProcessSeries(normalized, {
        pair,
        timeframe: normalizedTimeframe,
        provider: 'polygon',
        bars
      });
      const success = Array.isArray(processed) && processed.length > 0;
      if (!options.skipProviderTelemetry) {
        const qualityScore = success
          ? clamp(processed.length / Math.max(1, bars || processed.length), 0, 1)
          : 0;
        this.recordRequest('polygon', { success, latencyMs, qualityScore });
      }
      return processed;
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error.response?.status === 429) {
        this.registerRateLimitHit('polygon', { retryAfterMs: this.extractRetryAfter(error) });
      }
      if (!options.skipProviderTelemetry) {
        this.recordRequest('polygon', { success: false, latencyMs, qualityScore: 0 });
      }
      throw error;
    }
  }

  async fetchFromAlphaVantage(pair, timeframe, bars, options = {}) {
    if (!this.providerConfigured('alphaVantage')) {
      return null;
    }

    const meta = getPairMetadata(pair);
    if (!meta) {
      return null;
    }

    const endpoint = this.resolveAlphaEndpoint(timeframe);
    if (!endpoint) {
      return null;
    }

    const base = meta.base || pair.slice(0, 3);
    const quote = meta.quote || pair.slice(-3);

    const params = {
      function: endpoint.fn,
      from_symbol: base,
      to_symbol: quote,
      apikey: this.apiKeys.alphaVantage
    };

    if (endpoint.interval) {
      params.interval = endpoint.interval;
    }

    if (options.compact !== false) {
      params.outputsize = 'compact';
    }

    const url = 'https://www.alphavantage.co/query';

    try {
      const { data } = await axios.get(url, {
        params,
        timeout: options.timeoutMs || 12_000
      });

      if (!data || data['Error Message']) {
        return null;
      }
      if (data.Note) {
        this.registerRateLimitHit('alphaVantage', { retryAfterMs: 60_000 });
        return null;
      }

      const normalized = this.normalizeAlphaSeries(data, timeframe);
      return this.postProcessSeries(normalized, {
        pair,
        timeframe,
        provider: 'alphaVantage',
        bars
      });
    } catch (error) {
      if (error.response?.status === 429) {
        this.registerRateLimitHit('alphaVantage', { retryAfterMs: this.extractRetryAfter(error) });
      }
      throw error;
    }
  }

  extractRetryAfter(error) {
    const header = error?.response?.headers?.['retry-after'];
    if (!header) {
      return null;
    }
    const parsed = Number.parseInt(header, 10);
    return Number.isFinite(parsed) ? parsed * 1000 : null;
  }

  postProcessSeries(series, context = {}) {
    if (!Array.isArray(series) || series.length === 0) {
      return null;
    }
    const sanitized = this.validatePriceBars(series, context);
    if (!sanitized || sanitized.length === 0) {
      return null;
    }
    sanitized.sort((a, b) => a.time - b.time);
    return sanitized.slice(-context.bars || sanitized.length);
  }

  validatePriceBars(series, context = {}) {
    if (!Array.isArray(series)) {
      return [];
    }
    const seen = new Set();
    const sanitized = [];
    const provider = context.provider || 'unknown';
    for (const entry of series) {
      const time = safeNumber(entry.time ?? entry.timestamp ?? entry[0]);
      const open = safeNumber(entry.open ?? entry[1]);
      const high = safeNumber(entry.high ?? entry[2]);
      const low = safeNumber(entry.low ?? entry[3]);
      const close = safeNumber(entry.close ?? entry[4]);
      const volume = safeNumber(entry.volume ?? entry[5]) ?? 0;
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }
      const key = `${time}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      sanitized.push({
        time,
        timestamp: time,
        open,
        high,
        low,
        close,
        volume,
        provider
      });
    }
    return sanitized;
  }

  normalizeTwelveDataSeries(rawValues) {
    if (!Array.isArray(rawValues)) {
      return [];
    }
    const normalized = [];
    for (const value of rawValues) {
      const timestamp = value?.datetime
        ? Date.parse(value.datetime)
        : safeNumber(value?.timestamp || value?.time);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      normalized.push({
        time: timestamp,
        open: safeNumber(value.open),
        high: safeNumber(value.high),
        low: safeNumber(value.low),
        close: safeNumber(value.close),
        volume: safeNumber(value.volume) ?? 0
      });
    }
    return normalized;
  }

  normalizeTwelveDataQuote(raw) {
    if (!raw) {
      return null;
    }
    const bid = safeNumber(raw.bid);
    const ask = safeNumber(raw.ask);
    const price = safeNumber(raw.price ?? raw.close);
    const time = raw.datetime
      ? Date.parse(raw.datetime)
      : (safeNumber(raw.timestamp) ?? Date.now());
    return this.normalizeQuoteShape({ bid, ask, price, time, provider: 'twelveData' });
  }

  normalizeFinnhubSeries(raw) {
    if (!raw || !Array.isArray(raw?.c) || !Array.isArray(raw?.t)) {
      return [];
    }
    const { c: close, h: high, l: low, o: open, v: volume, t: time } = raw;
    const length = Math.min(close.length, time.length);
    const series = [];
    for (let i = 0; i < length; i += 1) {
      const timestamp = safeNumber(time[i]) ? time[i] * 1000 : null;
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      series.push({
        time: timestamp,
        open: safeNumber(open[i]),
        high: safeNumber(high[i]),
        low: safeNumber(low[i]),
        close: safeNumber(close[i]),
        volume: safeNumber(volume?.[i]) ?? 0
      });
    }
    return series;
  }

  normalizeFinnhubQuote(raw) {
    if (!raw) {
      return null;
    }
    const bid = safeNumber(raw?.b);
    const ask = safeNumber(raw?.a);
    const price = safeNumber(raw?.c);
    const time = safeNumber(raw?.t) ? raw.t * 1000 : Date.now();
    return this.normalizeQuoteShape({ bid, ask, price, time, provider: 'finnhub' });
  }

  normalizePolygonSeries(results) {
    if (!Array.isArray(results)) {
      return [];
    }
    return results
      .map((entry) => ({
        time: safeNumber(entry.t),
        open: safeNumber(entry.o),
        high: safeNumber(entry.h),
        low: safeNumber(entry.l),
        close: safeNumber(entry.c),
        volume: safeNumber(entry.v) ?? 0
      }))
      .filter((entry) => Number.isFinite(entry.time));
  }

  normalizeAlphaSeries(payload, _timeframe) {
    if (!payload || typeof payload !== 'object') {
      return [];
    }
    const key = Object.keys(payload).find((name) => name.toLowerCase().includes('time series'));
    if (!key || !payload[key]) {
      return [];
    }
    const series = [];
    for (const [timestamp, values] of Object.entries(payload[key])) {
      const time = Date.parse(timestamp);
      if (!Number.isFinite(time)) {
        continue;
      }
      series.push({
        time,
        open: safeNumber(values['1. open'] ?? values.open),
        high: safeNumber(values['2. high'] ?? values.high),
        low: safeNumber(values['3. low'] ?? values.low),
        close: safeNumber(values['4. close'] ?? values.close),
        volume: safeNumber(values['5. volume'] ?? values.volume) ?? 0
      });
    }
    return series.sort((a, b) => a.time - b.time);
  }

  normalizeQuoteShape({ bid, ask, price, time, provider }) {
    let mid = price;
    if (Number.isFinite(bid) && Number.isFinite(ask)) {
      mid = (bid + ask) / 2;
    }
    if (!Number.isFinite(mid) && Number.isFinite(price)) {
      mid = price;
    }
    if (!Number.isFinite(bid) && Number.isFinite(mid)) {
      bid = mid * 0.999;
    }
    if (!Number.isFinite(ask) && Number.isFinite(mid)) {
      ask = mid * 1.001;
    }
    return {
      provider,
      bid: Number.isFinite(bid) ? rounded(bid, 6) : null,
      ask: Number.isFinite(ask) ? rounded(ask, 6) : null,
      mid: Number.isFinite(mid) ? rounded(mid, 6) : null,
      timestamp: Number.isFinite(time) ? time : Date.now()
    };
  }

  recordRequest(provider, payload = {}) {
    const key = resolveProviderKey(provider);
    const metrics = key ? this.metrics.providers[key] : null;
    if (!metrics) {
      return;
    }
    const now = Date.now();

    this.addUsageSample(key, now);

    let success;
    let latencyMs = null;
    let qualityScore = null;

    if (typeof payload === 'boolean') {
      success = payload;
      qualityScore = payload ? 1 : 0;
    } else if (payload && typeof payload === 'object') {
      if (payload.success === undefined) {
        success = true;
      } else {
        success = Boolean(payload.success);
      }
      if (payload.latencyMs != null) {
        const numericLatency = Number(payload.latencyMs);
        if (Number.isFinite(numericLatency) && numericLatency >= 0) {
          latencyMs = numericLatency;
        }
      }
      if (payload.qualityScore != null) {
        const numericQuality = Number(payload.qualityScore);
        if (Number.isFinite(numericQuality)) {
          qualityScore = numericQuality;
        }
      }
    } else {
      success = Boolean(payload);
      qualityScore = success ? 1 : 0;
    }

    if (qualityScore == null) {
      qualityScore = success ? 1 : 0;
    }

    metrics.samples += 1;
    metrics.lastRequestAt = now;
    if (success) {
      metrics.success += 1;
      metrics.lastSuccessAt = now;
      metrics.consecutiveFailures = 0;
    } else {
      metrics.failed += 1;
      metrics.lastFailureAt = now;
      metrics.consecutiveFailures += 1;
    }

    if (Number.isFinite(latencyMs)) {
      metrics.latencySamples.push(latencyMs);
      if (metrics.latencySamples.length > 20) {
        metrics.latencySamples.shift();
      }
      const sum = metrics.latencySamples.reduce((acc, sample) => acc + sample, 0);
      metrics.avgLatencyMs = sum / metrics.latencySamples.length;
    }

    if (Number.isFinite(qualityScore)) {
      metrics.qualityScore = qualityScore;
      metrics.normalizedQuality = clamp(qualityScore, 0, 1);
    }

    this.evaluateProviderHealth(key, { success, latencyMs, qualityScore, metrics });
  }

  evaluateProviderHealth(provider, { success, _latencyMs, _qualityScore, metrics }) {
    const now = Date.now();
    const health = this.getProviderHealthEntry(provider);
    if (!health || !metrics) {
      return;
    }

    const rateLimit = this.rateLimits[provider];
    const latencyTarget = this.providerLatencyTargets[provider];

    if (metrics.circuitBreaker?.expiresAt) {
      const expires = new Date(metrics.circuitBreaker.expiresAt).getTime();
      if (Number.isFinite(expires) && expires <= now) {
        this.clearCircuitBreaker(provider, 'expired');
      }
    }

    if (!success && metrics.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold) {
      this.activateCircuitBreaker(
        provider,
        'failures',
        this.circuitBreakerConfig.failureCooldownMs
      );
    }

    if (metrics.avgLatencyMs && latencyTarget) {
      const latencyThreshold = latencyTarget * this.circuitBreakerConfig.latencyMultiplier;
      if (metrics.avgLatencyMs > latencyThreshold && metrics.samples >= 5) {
        this.activateCircuitBreaker(
          provider,
          'latency',
          this.circuitBreakerConfig.latencyCooldownMs
        );
      }
    }

    if (
      metrics.normalizedQuality != null &&
      metrics.normalizedQuality < this.circuitBreakerConfig.qualityThreshold
    ) {
      this.activateCircuitBreaker(provider, 'quality', this.circuitBreakerConfig.qualityCooldownMs);
    }

    const successRatio =
      metrics.success + metrics.failed > 0
        ? metrics.success / (metrics.success + metrics.failed)
        : 1;

    let status = 'healthy';
    if (metrics.circuitBreaker) {
      status = 'blocked';
    } else if (successRatio < 0.6 || metrics.normalizedQuality < 0.6) {
      status = 'degraded';
    }

    metrics.healthStatus = status;
    health.status = status;
    health.lastUpdated = now;
    health.consecutiveFailures = metrics.consecutiveFailures;
    health.circuitBreaker = metrics.circuitBreaker ? { ...metrics.circuitBreaker } : null;
    health.backoffUntil = rateLimit?.backoffUntil ?? 0;
  }

  activateCircuitBreaker(provider, reason, durationMs = BREAKER_DURATION_MS) {
    const metrics = this.metrics.providers[provider];
    if (!metrics) {
      return;
    }
    const now = Date.now();
    const expiresAt = new Date(now + Math.max(durationMs, 30_000)).toISOString();
    metrics.circuitBreaker = {
      reason,
      activatedAt: new Date(now).toISOString(),
      expiresAt
    };
    const health = this.getProviderHealthEntry(provider);
    if (health) {
      health.circuitBreaker = { ...metrics.circuitBreaker };
      health.status = 'blocked';
      health.lastUpdated = now;
    }
  }

  clearCircuitBreaker(provider, reason = 'manual') {
    const metrics = this.metrics.providers[provider];
    if (metrics) {
      metrics.circuitBreaker = null;
      metrics.consecutiveFailures = 0;
    }
    const health = this.getProviderHealthEntry(provider);
    if (health) {
      health.circuitBreaker = null;
      health.status = 'healthy';
      health.lastUpdated = Date.now();
    }
    this.logger?.debug?.({ provider, reason }, 'Circuit breaker cleared');
  }

  getProviderOrder(timeframeInput) {
    const timeframe = normalizeTimeframe(timeframeInput);
    const priority = this.resolveProviderPriority(timeframe);
    const now = Date.now();
    const scored = priority.map((provider, index) => {
      const metrics = this.metrics.providers[provider];
      let quality = null;
      const qualityScore = Number(metrics?.qualityScore);
      if (Number.isFinite(qualityScore)) {
        quality = clamp(qualityScore, 0, 1);
      }
      if (quality == null) {
        const normalizedQuality = Number(metrics?.normalizedQuality);
        if (Number.isFinite(normalizedQuality)) {
          quality = normalizedQuality;
        }
      }
      if (quality == null) {
        quality = 0.6;
      }
      const success = metrics?.success ?? 0;
      const failed = metrics?.failed ?? 0;
      const latency = metrics?.avgLatencyMs ?? this.providerLatencyTargets[provider] ?? 1_200;
      const limit = this.rateLimits[provider];
      const usageRatio = limit?.maxRequests
        ? clamp(limit.count / Math.max(1, limit.maxRequests), 0, 1.5)
        : 0;
      const breakerPenalty = metrics?.circuitBreaker ? 60 : 0;
      const backoffPenalty = this.isProviderInBackoff(provider, now) ? 40 : 0;
      const configuredPenalty = this.providerConfigured(provider) ? 0 : 80;
      const disabledPenalty = this.providerDisabled(provider) ? 120 : 0;
      const successRatio = success + failed > 0 ? success / (success + failed) : 0.75;
      const score =
        (priority.length - index) * 40 +
        quality * 35 +
        successRatio * 30 -
        latency / 120 -
        usageRatio * 25 -
        breakerPenalty -
        backoffPenalty -
        configuredPenalty -
        disabledPenalty;
      return { provider, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((entry) => this.providerConfigured(entry.provider))
      .map((entry) => entry.provider);
  }

  isDataFetchViable(timeframeInput = 'M15', options = {}) {
    const timeframe = normalizeTimeframe(timeframeInput || 'M15');
    const now = options.now ?? Date.now();
    const allowUnconfigured =
      options.allowUnconfigured ?? (this.allowUnconfiguredProviders || IS_TEST_ENV);
    const requireHealthyQuality = options.requireHealthyQuality ?? false;
    const qualityThreshold = clamp(
      Number.isFinite(options.qualityThreshold) ? options.qualityThreshold : 0.45,
      0,
      1
    );

    const priority = this.resolveProviderPriority(timeframe);
    const availabilityDetails = priority.map((provider) =>
      this.getProviderAvailability(provider, { now, allowUnconfigured })
    );
    const availableProviders = availabilityDetails.filter((detail) => detail.available);
    const blockedProviders = availabilityDetails.filter((detail) => !detail.available);

    let qualitySatisfied = true;
    let normalizedQuality = null;
    if (requireHealthyQuality) {
      const snapshot = this.getDataConfidenceSnapshot();
      normalizedQuality = Number.isFinite(snapshot?.normalized) ? snapshot.normalized : null;
      if (!(Number.isFinite(normalizedQuality) && normalizedQuality >= qualityThreshold)) {
        qualitySatisfied = false;
      }
    }

    const viable = availableProviders.length > 0 && qualitySatisfied;
    const reasons = [];
    if (availableProviders.length === 0) {
      reasons.push('no_providers');
    }
    if (!qualitySatisfied) {
      reasons.push('quality_below_threshold');
    }

    const result = {
      timeframe,
      viable,
      availableProviders: availableProviders.map((detail) => detail.provider),
      blockedProviders,
      normalizedQuality,
      qualityThreshold,
      qualitySatisfied,
      inspectedAt: now,
      reasons
    };

    if (options.includeDetails) {
      result.availabilityDetails = availabilityDetails;
    }

    return result;
  }

  resolveProviderPriority(timeframe) {
    if (this.fastTimeframes.has(timeframe)) {
      return ['twelveData', 'polygon', 'finnhub', 'alphaVantage'];
    }
    if (this.slowTimeframes.has(timeframe)) {
      return ['finnhub', 'twelveData', 'polygon', 'alphaVantage'];
    }
    if (this.alphaPreferredTimeframes.has(timeframe)) {
      return ['finnhub', 'twelveData', 'alphaVantage', 'polygon'];
    }
    return ['twelveData', 'polygon', 'finnhub', 'alphaVantage'];
  }

  buildCacheKey(pair, timeframe, bars, options) {
    const purpose = options.purpose || 'default';
    const providerFilter = options.providerPreference || 'auto';
    return `${String(pair).toUpperCase()}|${timeframe}|${bars}|${purpose}|${providerFilter}`;
  }

  resolveCacheTtl(timeframe, override) {
    if (Number.isFinite(override)) {
      return override;
    }
    return DEFAULT_CACHE_TTLS[timeframe] ?? this.cacheOptions.defaultTtlMs;
  }

  cacheSeries(key, series, metadata = {}) {
    const expiresAt = Date.now() + (metadata.ttl || this.cacheOptions.defaultTtlMs);
    this.dataCache.set(key, {
      series,
      expiresAt,
      metadata
    });
  }

  getCachedSeries(key, options = {}) {
    const cached = this.dataCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now() || options.invalidateCache) {
      this.dataCache.delete(key);
      return null;
    }
    return cached;
  }

  clearCache() {
    this.dataCache.clear();
    this.quoteCache.clear();
  }

  async getCurrentPrice(pair, options = {}) {
    const quote = await this.fetchQuote(pair, options);
    if (quote && Number.isFinite(quote.mid)) {
      return quote.mid;
    }
    if (quote && Number.isFinite(quote.bid) && Number.isFinite(quote.ask)) {
      return (quote.bid + quote.ask) / 2;
    }

    if (!this.shouldUseSyntheticData(options)) {
      throw createRealtimeError('getCurrentPrice', 'quote unavailable');
    }

    const synthetic = this.generateSyntheticQuote(pair, { provider: 'synthetic' });
    return synthetic.mid;
  }

  async fetchQuote(pair, options = {}) {
    const cacheKey = `${String(pair).toUpperCase()}|quote`;
    const useCache = options.bypassCache !== true;
    if (useCache) {
      const cached = this.getCachedQuote(cacheKey, options);
      if (cached) {
        return cached.quote;
      }
    }

    const dedupPromise = this.fetchQuoteWithDedup(cacheKey, () =>
      this.executeQuoteFetch(pair, options)
    );
    const quote = await dedupPromise;

    if (quote) {
      const ttl = options.cacheTtlMs ?? 5_000;
      if (ttl > 0 && useCache) {
        this.cacheQuote(cacheKey, quote, ttl);
      }
      return quote;
    }

    if (!this.shouldUseSyntheticData(options)) {
      assertRealTimeDataAvailability('fetchQuote');
    }

    return this.generateSyntheticQuote(pair, options);
  }

  async fetchQuoteWithDedup(key, executor) {
    if (this.quoteInFlight.has(key)) {
      return this.quoteInFlight.get(key);
    }
    const promise = (async () => {
      try {
        return await executor();
      } finally {
        this.quoteInFlight.delete(key);
      }
    })();
    this.quoteInFlight.set(key, promise);
    return promise;
  }

  async executeQuoteFetch(pair, options) {
    const order = this.getProviderOrder(options.timeframe || 'M15');
    for (const provider of order) {
      if (!this.providerConfigured(provider)) {
        continue;
      }
      const allowance = this.getRequestAllowance(provider);
      if (!allowance.allowed) {
        this.handleRateLimitSkip(provider);
        continue;
      }
      const started = Date.now();
      try {
        const quote = await this.fetchQuoteFromProvider(provider, pair, options);
        const latencyMs = Date.now() - started;
        const success = quote && Number.isFinite(quote.mid);
        this.recordRequest(provider, { success, latencyMs, qualityScore: success ? 1 : 0 });
        if (success) {
          quote.provider = provider;
          const pipSize = getPipSize(pair);
          if (
            Number.isFinite(pipSize) &&
            Number.isFinite(quote.bid) &&
            Number.isFinite(quote.ask)
          ) {
            quote.spreadPips = Number(((quote.ask - quote.bid) / pipSize).toFixed(3));
          }
          return quote;
        }
      } catch (error) {
        const latencyMs = Date.now() - started;
        this.recordRequest(provider, { success: false, latencyMs, qualityScore: 0 });
        continue;
      }
    }
    return null;
  }

  async fetchQuoteFromProvider(provider, pair, options) {
    switch (provider) {
      case 'twelveData':
        return this.providers.twelveData?.fetchQuote({ pair, options });
      case 'finnhub':
        return this.providers.finnhub?.fetchQuote({ pair, options });
      default:
        return null;
    }
  }

  cacheQuote(key, quote, ttlMs) {
    this.quoteCache.set(key, {
      quote,
      expiresAt: Date.now() + ttlMs
    });
  }

  getCachedQuote(key, options = {}) {
    const cached = this.quoteCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now() || options.invalidateCache) {
      this.quoteCache.delete(key);
      return null;
    }
    return cached;
  }

  async getBidAskSnapshot(pair, options = {}) {
    const quote = await this.fetchQuote(pair, options);
    if (!quote) {
      if (!this.shouldUseSyntheticData(options)) {
        throw createRealtimeError('getBidAskSnapshot', 'quote unavailable');
      }
      return this.generateSyntheticQuote(pair, options);
    }
    return quote;
  }

  resolveAlphaEndpoint(timeframe) {
    const normalized = normalizeTimeframe(timeframe);
    return ALPHA_ENDPOINTS[normalized] || null;
  }

  convertTimeframeForTwelveData(timeframe) {
    const normalized = normalizeTimeframe(timeframe);
    if (normalized.startsWith('M')) {
      return `${normalized.slice(1)}min`;
    }
    if (normalized.startsWith('H')) {
      return `${normalized.slice(1)}h`;
    }
    if (normalized === 'D1') {
      return '1day';
    }
    if (normalized === 'W1') {
      return '1week';
    }
    return normalized.toLowerCase();
  }

  convertTimeframeForFinnhub(timeframe) {
    const normalized = normalizeTimeframe(timeframe);
    if (normalized.startsWith('M')) {
      return normalized.slice(1);
    }
    if (normalized.startsWith('H')) {
      return normalized.slice(1) === '1' ? '60' : String(Number(normalized.slice(1)) * 60);
    }
    if (normalized === 'D1') {
      return 'D';
    }
    return normalized;
  }

  shouldUseSyntheticData(options = {}) {
    if (options.forceSynthetic === true) {
      return true;
    }
    if (options.disallowSynthetic === true) {
      return false;
    }
    if (requireRealTimeData()) {
      return false;
    }
    return allowSyntheticData();
  }

  generateSimulatedData(pair, bars = 240, options = {}) {
    const count = Math.max(2, Math.min(2000, Number.isInteger(bars) ? bars : 240));
    const timeframe = normalizeTimeframe(options.timeframe || 'M15');
    const timeframeMs = timeframeToMilliseconds(timeframe) || 60_000;
    const basePrice = getSyntheticBasePrice(pair) || 1.0;
    const volatility = getSyntheticVolatility(pair) || 0.0025;
    const now = Date.now();
    const series = [];
    let price = basePrice;
    for (let i = count - 1; i >= 0; i -= 1) {
      const timestamp = now - i * timeframeMs;
      const drift = (Math.random() - 0.5) * volatility;
      const open = price;
      price = Math.max(0.0001, price + drift);
      const close = price;
      const high = Math.max(open, close) + Math.random() * volatility * 0.6;
      const low = Math.min(open, close) - Math.random() * volatility * 0.6;
      const volume = Math.random() * 10_000 + 1_000;
      series.push({
        time: timestamp,
        timestamp,
        open: rounded(open, 6),
        high: rounded(high, 6),
        low: rounded(low, 6),
        close: rounded(close, 6),
        volume: rounded(volume, 0),
        provider: 'synthetic'
      });
    }
    return series;
  }

  getBasePriceForPair(pair) {
    const metadata = getPairMetadata(pair);
    if (metadata) {
      const direct = safeNumber(metadata.basePrice || metadata.referencePrice);
      if (Number.isFinite(direct)) {
        return direct;
      }
      if (Number.isFinite(metadata.syntheticBasePrice)) {
        return metadata.syntheticBasePrice;
      }
    }
    const synthetic = safeNumber(getSyntheticBasePrice(pair));
    if (Number.isFinite(synthetic)) {
      return synthetic;
    }
    return 1;
  }

  generateSyntheticQuote(pair, options = {}) {
    const basePrice = getSyntheticBasePrice(pair) || 1.0;
    const volatility = getSyntheticVolatility(pair) || 0.0025;
    const mid = basePrice + (Math.random() - 0.5) * volatility;
    const spread = volatility * 0.2;
    const bid = mid - spread / 2;
    const ask = mid + spread / 2;
    const pipSize = getPipSize(pair);
    const spreadPips = Number.isFinite(pipSize) ? Number(((ask - bid) / pipSize).toFixed(3)) : null;
    return {
      provider: options.provider || 'synthetic',
      bid: rounded(bid, 6),
      ask: rounded(ask, 6),
      mid: rounded(mid, 6),
      spreadPips,
      timestamp: Date.now()
    };
  }

  scheduleRefresh(key, fn, ttlMs) {
    if (this.refreshTimers.has(key)) {
      clearTimeout(this.refreshTimers.get(key));
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      this.refreshTimers.delete(key);
      try {
        fn();
      } catch (error) {
        this.logger?.warn?.({ err: error, key }, 'Scheduled refresh failed');
      }
    }, ttlMs);
    this.refreshTimers.set(key, timer);
  }

  clearRefreshTimer(key) {
    if (this.refreshTimers.has(key)) {
      clearTimeout(this.refreshTimers.get(key));
      this.refreshTimers.delete(key);
    }
  }

  getDataConfidenceSnapshot() {
    const providers = {};
    let weightedSum = 0;
    let weightTotal = 0;
    for (const provider of PROVIDERS) {
      const metrics = this.metrics.providers[provider];
      if (!metrics) {
        continue;
      }
      const samples = metrics.samples || 0;
      const quality = metrics.normalizedQuality ?? 0;
      const confidencePct = Number.isFinite(quality) ? Number((quality * 100).toFixed(2)) : null;
      providers[provider] = {
        samples,
        normalizedQuality: quality,
        confidencePct,
        avgLatencyMs: metrics.avgLatencyMs,
        targetLatencyMs: this.providerLatencyTargets[provider] ?? null,
        healthStatus: metrics.healthStatus,
        circuitBreaker: metrics.circuitBreaker || null
      };
      weightedSum += quality * samples;
      weightTotal += samples;
    }
    const normalized = weightTotal > 0 ? weightedSum / weightTotal : null;
    const aggregate = normalized != null ? Number((normalized * 100).toFixed(2)) : null;
    return {
      aggregate,
      normalized,
      providers
    };
  }

  getAggregateDataConfidence() {
    const snapshot = this.getDataConfidenceSnapshot();
    return snapshot?.aggregate ?? null;
  }

  getHealthStatus() {
    const dataConfidence = this.getDataConfidenceSnapshot();
    const defaultAvailability = this.isDataFetchViable('M15', { includeDetails: true });
    const now = Date.now();
    const providerOrderPreview = this.getProviderOrder('M15');
    const rateLimits = {};
    for (const [provider, limit] of Object.entries(this.rateLimits)) {
      rateLimits[provider] = {
        windowMs: limit.windowMs,
        maxRequests: limit.maxRequests,
        count: limit.count,
        remaining: limit.remaining,
        backoffUntil: limit.backoffUntil,
        resetTime: limit.resetTime,
        resetIn: Number.isFinite(limit.resetTime) ? Math.max(0, limit.resetTime - now) : null,
        backoffSeconds: limit.backoffUntil > now ? Math.ceil((limit.backoffUntil - now) / 1000) : 0
      };
    }

    const providerMetrics = {};
    for (const provider of PROVIDERS) {
      const metrics = this.metrics.providers[provider];
      providerMetrics[provider] = {
        success: metrics.success,
        failed: metrics.failed,
        samples: metrics.samples,
        avgLatencyMs: metrics.avgLatencyMs,
        normalizedQuality: metrics.normalizedQuality,
        healthStatus: metrics.healthStatus,
        circuitBreaker: metrics.circuitBreaker,
        rateLimited: metrics.rateLimited,
        consecutiveFailures: metrics.consecutiveFailures,
        lastRequestAt: metrics.lastRequestAt,
        lastSuccessAt: metrics.lastSuccessAt,
        lastFailureAt: metrics.lastFailureAt,
        qualityScore: metrics.qualityScore
      };
    }

    const successTotal = this.metrics.requests.success;
    const failureTotal = this.metrics.requests.failed;
    const ratio =
      successTotal + failureTotal > 0 ? successTotal / (successTotal + failureTotal) : 1;
    const status = ratio >= 0.6 ? 'healthy' : ratio >= 0.3 ? 'degraded' : 'critical';

    const providerHealthSnapshot = {};
    for (const provider of PROVIDERS) {
      const entry = this.getProviderHealthEntry(provider);
      providerHealthSnapshot[provider] = entry ? { ...entry, provider } : null;
    }

    return {
      status,
      metrics: {
        requests: { ...this.metrics.requests },
        providers: providerMetrics
      },
      rateLimits,
      providerHealth: providerHealthSnapshot,
      cache: {
        dataEntries: this.dataCache.size,
        quoteEntries: this.quoteCache.size
      },
      dataConfidence,
      providerOrderPreview,
      availability: defaultAvailability
    };
  }
}
