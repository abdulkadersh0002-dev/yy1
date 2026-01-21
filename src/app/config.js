import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.preprocess(
      (value) => (value === undefined || value === null || value === '' ? undefined : value),
      z.string().default('development')
    ),
    PORT: z.preprocess(
      (value) => (value === undefined || value === '' ? 4101 : value),
      z.coerce.number().int().positive()
    ),
    REQUEST_JSON_LIMIT: z.preprocess(
      (value) => (value === undefined || value === null || value === '' ? undefined : value),
      z.string().default('5mb')
    )
  })
  .passthrough();

const truthyValues = new Set(['1', 'true', 'yes', 'on']);
const falsyValues = new Set(['0', 'false', 'no', 'off']);

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
  if (truthyValues.has(normalized)) {
    return true;
  }
  if (falsyValues.has(normalized)) {
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

function buildPriceDataConfig(env) {
  const disabledProviders = parseListSafe(env.PRICE_PROVIDERS_DISABLED);

  const providerRequestIntervals = {};
  const twelveDataInterval = parseIntSafe(env.PRICE_PROVIDER_TWELVEDATA_MIN_INTERVAL_MS);
  if (Number.isFinite(twelveDataInterval) && twelveDataInterval >= 0) {
    providerRequestIntervals.twelveData = twelveDataInterval;
  }
  const alphaInterval = parseIntSafe(env.PRICE_PROVIDER_ALPHAVANTAGE_MIN_INTERVAL_MS);
  if (Number.isFinite(alphaInterval) && alphaInterval >= 0) {
    providerRequestIntervals.alphaVantage = alphaInterval;
  }
  const polygonInterval = parseIntSafe(env.PRICE_PROVIDER_POLYGON_MIN_INTERVAL_MS);
  if (Number.isFinite(polygonInterval) && polygonInterval >= 0) {
    providerRequestIntervals.polygon = polygonInterval;
  }
  const finnhubInterval = parseIntSafe(env.PRICE_PROVIDER_FINNHUB_MIN_INTERVAL_MS);
  if (Number.isFinite(finnhubInterval) && finnhubInterval >= 0) {
    providerRequestIntervals.finnhub = finnhubInterval;
  }

  const rateLimitOverrides = {};
  const twelveDataMaxPerMinute = parseIntSafe(env.PRICE_PROVIDER_TWELVEDATA_MAX_PER_MINUTE);
  if (Number.isFinite(twelveDataMaxPerMinute) && twelveDataMaxPerMinute > 0) {
    rateLimitOverrides.twelveData = {
      ...(rateLimitOverrides.twelveData || {}),
      maxRequests: twelveDataMaxPerMinute,
      windowMs: 60000
    };
  }
  const twelveDataCooldown = parseIntSafe(env.PRICE_PROVIDER_TWELVEDATA_COOLDOWN_MS);
  if (Number.isFinite(twelveDataCooldown) && twelveDataCooldown > 0) {
    rateLimitOverrides.twelveData = {
      ...(rateLimitOverrides.twelveData || {}),
      cooldownMs: twelveDataCooldown
    };
  }

  const alphaVantageMaxPerDay = parseIntSafe(env.PRICE_PROVIDER_ALPHAVANTAGE_MAX_PER_DAY);
  if (Number.isFinite(alphaVantageMaxPerDay) && alphaVantageMaxPerDay > 0) {
    rateLimitOverrides.alphaVantage = {
      ...(rateLimitOverrides.alphaVantage || {}),
      maxRequests: alphaVantageMaxPerDay,
      windowMs: 86400000
    };
  }
  const alphaVantageCooldown = parseIntSafe(env.PRICE_PROVIDER_ALPHAVANTAGE_COOLDOWN_MS);
  if (Number.isFinite(alphaVantageCooldown) && alphaVantageCooldown > 0) {
    rateLimitOverrides.alphaVantage = {
      ...(rateLimitOverrides.alphaVantage || {}),
      cooldownMs: alphaVantageCooldown
    };
  }

  const polygonMaxPerMinute = parseIntSafe(env.PRICE_PROVIDER_POLYGON_MAX_PER_MINUTE);
  if (Number.isFinite(polygonMaxPerMinute) && polygonMaxPerMinute > 0) {
    rateLimitOverrides.polygon = {
      ...(rateLimitOverrides.polygon || {}),
      maxRequests: polygonMaxPerMinute,
      windowMs: 60000
    };
  }
  const polygonCooldown = parseIntSafe(env.PRICE_PROVIDER_POLYGON_COOLDOWN_MS);
  if (Number.isFinite(polygonCooldown) && polygonCooldown > 0) {
    rateLimitOverrides.polygon = {
      ...(rateLimitOverrides.polygon || {}),
      cooldownMs: polygonCooldown
    };
  }

  const finnhubMaxPerMinute = parseIntSafe(env.PRICE_PROVIDER_FINNHUB_MAX_PER_MINUTE);
  if (Number.isFinite(finnhubMaxPerMinute) && finnhubMaxPerMinute > 0) {
    rateLimitOverrides.finnhub = {
      ...(rateLimitOverrides.finnhub || {}),
      maxRequests: finnhubMaxPerMinute,
      windowMs: 60000
    };
  }
  const finnhubCooldown = parseIntSafe(env.PRICE_PROVIDER_FINNHUB_COOLDOWN_MS);
  if (Number.isFinite(finnhubCooldown) && finnhubCooldown > 0) {
    rateLimitOverrides.finnhub = {
      ...(rateLimitOverrides.finnhub || {}),
      cooldownMs: finnhubCooldown
    };
  }

  const alphaPreferredTimeframes = parseListSafe(env.PRICE_PROVIDER_ALPHA_PREFERRED_TIMEFRAMES);
  const fastTimeframesOverride = parseListSafe(env.PRICE_PROVIDER_FAST_TIMEFRAMES);
  const slowTimeframesOverride = parseListSafe(env.PRICE_PROVIDER_SLOW_TIMEFRAMES);

  const priceDataConfig = {};
  if (disabledProviders.length) {
    priceDataConfig.disabledProviders = disabledProviders;
  }
  if (Object.keys(providerRequestIntervals).length > 0) {
    priceDataConfig.providerRequestIntervals = providerRequestIntervals;
  }
  if (Object.keys(rateLimitOverrides).length > 0) {
    priceDataConfig.rateLimitOverrides = rateLimitOverrides;
  }
  if (alphaPreferredTimeframes.length) {
    priceDataConfig.alphaPreferredTimeframes = alphaPreferredTimeframes;
  }
  if (fastTimeframesOverride.length) {
    priceDataConfig.fastTimeframes = fastTimeframesOverride;
  }
  if (slowTimeframesOverride.length) {
    priceDataConfig.slowTimeframes = slowTimeframesOverride;
  }

  return priceDataConfig;
}

function buildAlertEmailConfig(env) {
  if (!env.ALERT_EMAIL_FROM || !env.ALERT_EMAIL_TO || !env.ALERT_SMTP_HOST) {
    return null;
  }

  return {
    from: env.ALERT_EMAIL_FROM,
    to: env.ALERT_EMAIL_TO,
    smtp: {
      host: env.ALERT_SMTP_HOST,
      port: parseIntSafe(env.ALERT_SMTP_PORT) || 587,
      secure: String(env.ALERT_SMTP_SECURE || '').toLowerCase() === 'true',
      user: env.ALERT_SMTP_USER,
      pass: env.ALERT_SMTP_PASSWORD
    }
  };
}

function buildTradingEngineConfig(env, priceDataConfig) {
  const presetRaw = String(env.AUTO_TRADING_PRESET || '')
    .trim()
    .toLowerCase();
  const smartStrongPreset =
    presetRaw === 'smart_strong' || presetRaw === 'smart-strong' || presetRaw === 'smartstrong';

  const config = {
    minSignalStrength: 35,
    riskPerTrade: 0.02,
    maxDailyRisk: 0.06,
    maxConcurrentTrades: 5,
    signalAmplifier: 2.5,
    directionThreshold: 12,
    // Used by TradingEngine decision profiles (soft preference).
    minRiskReward: 1.6,
    apiKeys: {
      openai: env.OPENAI_API_KEY,
      twelveData: env.TWELVE_DATA_API_KEY,
      alphaVantage: env.ALPHA_VANTAGE_API_KEY,
      finnhub: env.FINNHUB_API_KEY,
      polygon: env.POLYGON_API_KEY,
      newsApi: env.NEWSAPI_KEY,
      fred: env.FRED_API_KEY,
      exchangeRate: env.EXCHANGERATE_API_KEY,
      fixer: env.FIXER_API_KEY
    },
    // Smart auto-trading guards (opt-in via validateSignal defaults; enabled here for the real app).
    enforceTradingWindows: parseBoolSafe(env.AUTO_TRADING_ENFORCE_TRADING_WINDOWS, false),
    tradingWindowsLondon: parseJsonSafe(env.AUTO_TRADING_TRADING_WINDOWS_LONDON),
    // Momentum guards are helpful but can be overly strict for realtime EA execution.
    // Default OFF unless explicitly enabled by env.
    enforceMomentumGuards: parseBoolSafe(env.AUTO_TRADING_ENFORCE_MOMENTUM_GUARDS, false),
    enforceHtfAlignment: parseBoolSafe(env.AUTO_TRADING_ENFORCE_HTF_ALIGNMENT, true),
    enforceFxAtrRange: parseBoolSafe(env.AUTO_TRADING_ENFORCE_FX_ATR_RANGE, true),
    enforceCryptoVolSpike: parseBoolSafe(env.AUTO_TRADING_ENFORCE_CRYPTO_VOL_SPIKE, true)
  };

  if (smartStrongPreset) {
    const clampPct = (value, fallback) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return fallback;
      }
      return Math.max(0, Math.min(100, numeric));
    };

    const realtimeMinConfidence = clampPct(
      parseFloatSafe(env.AUTO_TRADING_REALTIME_MIN_CONFIDENCE, env.EA_SIGNAL_MIN_CONFIDENCE),
      78
    );
    const realtimeMinStrength = clampPct(
      parseFloatSafe(env.AUTO_TRADING_REALTIME_MIN_STRENGTH, env.EA_SIGNAL_MIN_STRENGTH),
      62
    );

    // "Smart strong" preset:
    // - more decisive entry scoring (handled by AUTO_TRADING_PROFILE defaulting to smart_strong)
    // - keeps risk controls and hard blocks in place
    // - slightly increases analysis sensitivity without going reckless
    config.minSignalStrength = 30;
    config.signalAmplifier = 2.8;
    config.directionThreshold = 10;
    config.maxConcurrentTrades = 4;
    config.minRiskReward = 1.7;

    // TradeManager reads these from tradingEngine.config.autoTrading.
    config.autoTrading = {
      // Keep quality high for execution while allowing more opportunities than the strictest mode.
      realtimeMinConfidence,
      realtimeMinStrength,
      realtimeRequireLayers18: parseBoolSafe(env.AUTO_TRADING_REALTIME_REQUIRE_LAYERS18, true),

      // Scan more symbols from the EA quote strip.
      dynamicUniverseEnabled: true,
      universeMaxAgeMs: 90 * 1000,
      universeMaxSymbols: 300,
      allowAllQuoteSymbols: true,

      // Safety: open at most 1 new trade per cycle.
      maxNewTradesPerCycle: 1,

      // Background scanning cadence (realtime strong-signal execution is separate).
      monitoringIntervalMs: 10 * 1000,
      signalGenerationIntervalMs: 2 * 60 * 1000,
      signalCheckIntervalMs: 30 * 1000
    };
  }

  config.priceData = priceDataConfig;

  config.alerting = {
    drawdownThresholdPct: parseFloatSafe(env.ALERT_DRAWDOWN_THRESHOLD_PCT),
    volatilityScoreThreshold: parseFloatSafe(env.ALERT_VOLATILITY_THRESHOLD),
    volatilityCooldownMs: parseIntSafe(env.ALERT_VOLATILITY_COOLDOWN_MS),
    exposureWarningFraction: parseFloatSafe(env.ALERT_EXPOSURE_WARNING_FRACTION)
  };

  const currencyLimits = parseJsonSafe(env.RISK_CURRENCY_LIMITS);
  const correlationMatrix = parseJsonSafe(env.RISK_CORRELATION_MATRIX);

  config.riskCommandCenter = {
    enabled: parseBoolSafe(env.ENABLE_RISK_COMMAND_CENTER, true),
    blotterSize: parseIntSafe(env.RISK_BLOTTER_SIZE) || 25,
    currencyLimits: currencyLimits || undefined,
    correlation: {
      enabled: parseBoolSafe(env.RISK_CORRELATION_ENABLED, true),
      threshold: parseFloatSafe(env.RISK_CORRELATION_THRESHOLD) || 0.8,
      maxClusterSize: parseIntSafe(env.RISK_MAX_CORRELATED_POSITIONS) || 3,
      matrix: correlationMatrix || undefined
    },
    valueAtRisk: {
      enabled: parseBoolSafe(env.RISK_VAR_ENABLED, true),
      confidence: parseFloatSafe(env.RISK_VAR_CONFIDENCE) || 0.95,
      lookbackTrades: parseIntSafe(env.RISK_VAR_LOOKBACK) || 50,
      maxLossPct: parseFloatSafe(env.RISK_VAR_MAX_LOSS_PCT) || 6,
      minSamples: parseIntSafe(env.RISK_VAR_MIN_SAMPLES) || 20
    }
  };

  return config;
}

function buildBrokerConfig(env) {
  const oandaEnabled =
    parseBoolSafe(env.ENABLE_BROKER_OANDA, false) &&
    Boolean(env.OANDA_ACCESS_TOKEN && env.OANDA_ACCOUNT_ID);
  const mt5Enabled = parseBoolSafe(env.ENABLE_BROKER_MT5, true);
  const mt4Enabled = parseBoolSafe(env.ENABLE_BROKER_MT4, false);
  const ibkrEnabled = parseBoolSafe(env.ENABLE_BROKER_IBKR, false) && Boolean(env.IBKR_GATEWAY_URL);

  return {
    oanda: {
      enabled: oandaEnabled,
      accountMode: env.OANDA_ACCOUNT_MODE || 'demo',
      accessToken: env.OANDA_ACCESS_TOKEN,
      accountId: env.OANDA_ACCOUNT_ID
    },
    mt4: {
      enabled: mt4Enabled,
      accountMode: env.MT4_ACCOUNT_MODE || 'demo',
      baseUrl: env.MT4_BRIDGE_URL,
      apiKey: env.MT4_BRIDGE_TOKEN,
      accountNumber: env.MT4_ACCOUNT_NUMBER
    },
    mt5: {
      enabled: mt5Enabled,
      accountMode: env.MT5_ACCOUNT_MODE || 'demo',
      baseUrl: env.MT5_BRIDGE_URL,
      apiKey: env.MT5_BRIDGE_TOKEN,
      accountNumber: env.MT5_ACCOUNT_NUMBER
    },
    ibkr: {
      enabled: ibkrEnabled,
      accountMode: env.IBKR_ACCOUNT_MODE || 'demo',
      baseUrl: env.IBKR_GATEWAY_URL,
      accountId: env.IBKR_ACCOUNT_ID,
      allowSelfSigned: parseBoolSafe(env.IBKR_ALLOW_SELF_SIGNED, true)
    }
  };
}

export function buildAppConfig(environment = process.env) {
  const env = envSchema.parse(environment);

  const server = {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    enablePortFallback: parseBoolSafe(env.ENABLE_PORT_FALLBACK, false),
    portFallbackAttempts: parseIntSafe(env.PORT_FALLBACK_ATTEMPTS) || 10,
    requestJsonLimit: env.REQUEST_JSON_LIMIT,
    enableWebSockets: parseBoolSafe(env.ENABLE_WEBSOCKETS, true),
    websocketPath: env.WEBSOCKET_PATH || '/ws/trading',
    websocketPingIntervalMs: parseIntSafe(env.WEBSOCKET_PING_INTERVAL_MS) || 30000,
    providerAvailabilityBroadcastIntervalMs:
      parseIntSafe(env.PROVIDER_AVAILABILITY_BROADCAST_INTERVAL_MS) || 20000,
    providerAvailabilityHistoryLimit: parseIntSafe(env.PROVIDER_AVAILABILITY_HISTORY_LIMIT) || 288,
    providerAvailabilityAlert: {
      enabled: parseBoolSafe(env.ALERT_PROVIDER_ENABLED, true),
      degradedRatio: parseFloatSafe(env.ALERT_PROVIDER_DEGRADED_RATIO),
      criticalRatio: parseFloatSafe(env.ALERT_PROVIDER_CRITICAL_RATIO),
      qualityWarningThreshold: parseFloatSafe(env.ALERT_PROVIDER_QUALITY_WARNING),
      qualityCriticalThreshold: parseFloatSafe(env.ALERT_PROVIDER_QUALITY_CRITICAL),
      cooldownMs: parseIntSafe(env.ALERT_PROVIDER_COOLDOWN_MS) || 10 * 60 * 1000
    }
  };

  const providerAvailabilityTimeframes = parseListSafe(env.PROVIDER_AVAILABILITY_TIMEFRAMES);
  if (providerAvailabilityTimeframes.length > 0) {
    server.providerAvailabilityTimeframes = providerAvailabilityTimeframes;
  }

  const apiAuth = {
    enabled: parseBoolSafe(env.ENABLE_API_AUTH, false) || parseBoolSafe(env.API_AUTH_ENABLED, false)
  };

  const priceData = buildPriceDataConfig(env);
  const tradingConfig = buildTradingEngineConfig(env, priceData);

  const alerting = {
    slackWebhookUrl: env.ALERT_SLACK_WEBHOOK || null,
    webhookUrls: env.ALERT_WEBHOOK_URLS || null,
    email: buildAlertEmailConfig(env),
    dedupeMs: parseIntSafe(env.ALERT_DEDUPE_MS)
  };

  const brokers = buildBrokerConfig(env);
  const brokerRouting = {
    enabled: parseBoolSafe(env.ENABLE_BROKER_ROUTING, true),
    defaultBroker: env.BROKER_DEFAULT || 'mt5',
    timeInForce: env.BROKER_TIME_IN_FORCE || 'GTC'
  };

  const tradingModifyApi = {
    enabled: parseBoolSafe(env.ENABLE_TRADING_MODIFY_API, false)
  };

  const riskReports = {
    enabled: env.ENABLE_RISK_REPORTS !== 'false',
    reportHourUtc: parseIntSafe(env.RISK_REPORT_HOUR_UTC)
  };

  const performanceDigests = {
    enabled: env.ENABLE_PERFORMANCE_DIGESTS !== 'false',
    reportHourUtc: parseIntSafe(env.PERFORMANCE_DIGEST_HOUR_UTC),
    outputDir: env.PERFORMANCE_DIGEST_OUTPUT_DIR,
    includePdf: parseBoolSafe(env.PERFORMANCE_DIGEST_PDF_ENABLED, true)
  };

  const brokerReconciliation = {
    intervalMs: parseIntSafe(env.BROKER_RECONCILE_INTERVAL_MS) || 60000
  };

  const pairPrefetch = {
    enabled: env.ENABLE_PREFETCH_SCHEDULER !== 'false',
    tickIntervalMs: parseIntSafe(env.PREFETCH_TICK_MS),
    maxPairsPerTick: parseIntSafe(env.PREFETCH_MAX_PER_TICK)
  };

  const autoTrading = {
    autostart: parseBoolSafe(env.AUTO_TRADING_AUTOSTART, false),
    monitoringIntervalMs: parseIntSafe(env.AUTO_TRADING_MONITORING_INTERVAL_MS),
    signalGenerationIntervalMs: parseIntSafe(env.AUTO_TRADING_SIGNAL_INTERVAL_MS),
    signalCheckIntervalMs: parseIntSafe(env.AUTO_TRADING_SIGNAL_CHECK_INTERVAL_MS)
  };

  const services = {
    riskReports,
    performanceDigests,
    brokerReconciliation,
    pairPrefetch,
    autoTrading
  };

  const database = {
    host: env.DB_HOST,
    port: parseIntSafe(env.DB_PORT) || 5432,
    name: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  };

  return {
    env,
    server,
    apiAuth,
    trading: tradingConfig,
    alerting,
    brokers,
    brokerRouting,
    tradingModifyApi,
    services,
    pairPrefetch,
    autoTrading,
    priceData,
    database
  };
}

export const appConfig = buildAppConfig();
