import { allowSyntheticData, requireRealTimeData, eaOnlyMode } from '../config/runtime-flags.js';
import { appConfig } from '../app/config.js';

const PRICE_PROVIDERS = [
  { envKey: 'TWELVE_DATA_API_KEY', label: 'Twelve Data', configKey: 'twelveData' },
  { envKey: 'ALPHA_VANTAGE_API_KEY', label: 'Alpha Vantage', configKey: 'alphaVantage' },
  { envKey: 'FINNHUB_API_KEY', label: 'Finnhub', configKey: 'finnhub' },
  { envKey: 'POLYGON_API_KEY', label: 'Polygon', configKey: 'polygon' }
];

const NEWS_PROVIDERS = [{ envKey: 'NEWSAPI_KEY', label: 'NewsAPI', configKey: 'newsApi' }];

const AUXILIARY_PROVIDERS = [
  { envKey: 'FRED_API_KEY', label: 'FRED', configKey: 'fred', optional: true },
  {
    envKey: 'EXCHANGERATE_API_KEY',
    label: 'ExchangeRate',
    configKey: 'exchangeRate',
    optional: true
  },
  { envKey: 'FIXER_API_KEY', label: 'Fixer', configKey: 'fixer', optional: true }
];

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
  /^na$/i
];

function isLikelyPlaceholder(value) {
  if (!value) {
    return true;
  }
  const normalized = String(value).trim();
  if (normalized.length === 0) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectInvalidProviders(list, apiKeys) {
  const result = {
    missing: [],
    placeholders: [],
    optionalMissing: [],
    optionalPlaceholders: []
  };

  list.forEach(({ label, configKey, optional }) => {
    const keyValue = apiKeys?.[configKey] ?? appConfig.trading?.apiKeys?.[configKey];
    if (!keyValue) {
      if (optional) {
        result.optionalMissing.push(label);
      } else {
        result.missing.push(label);
      }
      return;
    }

    if (isLikelyPlaceholder(keyValue)) {
      if (optional) {
        result.optionalPlaceholders.push(label);
      } else {
        result.placeholders.push(label);
      }
    }
  });

  return result;
}

function parseDisabledProviders(envConfig) {
  const raw = envConfig?.PRICE_PROVIDERS_DISABLED;
  if (!raw) {
    return new Set();
  }
  return new Set(
    String(raw)
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
  );
}

function preferRssNews(envConfig) {
  if (envConfig?.NEWS_RSS_ONLY === 'true') {
    return true;
  }
  const translationEnabled = envConfig?.ENABLE_NEWS_TRANSLATION === 'true';
  return !translationEnabled;
}

export function enforceRealTimeProviderReadiness(apiKeys = {}, envConfig = appConfig.env) {
  if (eaOnlyMode(envConfig)) {
    return;
  }
  if (!requireRealTimeData(envConfig)) {
    return;
  }

  if (allowSyntheticData(envConfig)) {
    const error = new Error(
      'Real-time data enforcement requires ALLOW_SYNTHETIC_DATA=false or REQUIRE_REALTIME_DATA=true'
    );
    error.code = 'REALTIME_DATA_REQUIRED';
    throw error;
  }

  const disabledProviders = parseDisabledProviders(envConfig);
  const rssOnlyNews = preferRssNews(envConfig);

  const hasEaBrokerEnabled = Boolean(
    appConfig?.brokers?.mt4?.enabled || appConfig?.brokers?.mt5?.enabled
  );

  // Real-time price requirement:
  // - If the MT4/MT5 bridge is enabled, the EA can serve as the real-time price source.
  // - Otherwise, require at least one configured price provider (TwelveData / Finnhub / Polygon / AlphaVantage).
  const enabledPriceProviders = PRICE_PROVIDERS.filter((provider) => {
    const normalizedKey = provider.configKey.toLowerCase();
    return !disabledProviders.has(normalizedKey);
  });

  const priceCheck = collectInvalidProviders(enabledPriceProviders, apiKeys);

  const hasAnyPriceKey = enabledPriceProviders.some((provider) => {
    const keyValue =
      apiKeys?.[provider.configKey] ?? appConfig.trading?.apiKeys?.[provider.configKey];
    return Boolean(keyValue) && !isLikelyPlaceholder(keyValue);
  });

  const enabledNewsProviders = rssOnlyNews
    ? []
    : NEWS_PROVIDERS.filter((provider) => {
        const normalizedKey = provider.configKey.toLowerCase();
        return !disabledProviders.has(normalizedKey);
      });

  const newsCheck = collectInvalidProviders(enabledNewsProviders, apiKeys);

  const auxiliaryCheck = collectInvalidProviders(AUXILIARY_PROVIDERS, apiKeys);

  const issues = [];
  const warnings = [];

  if (!hasEaBrokerEnabled && !hasAnyPriceKey) {
    issues.push(
      `missing real-time price provider (configure one of: ${enabledPriceProviders
        .map((p) => p.label)
        .join(', ')})`
    );
  }

  if (priceCheck.placeholders.length > 0) {
    warnings.push(`placeholder credentials detected for ${priceCheck.placeholders.join(', ')}`);
  }

  if (newsCheck.missing.length > 0) {
    warnings.push(`news provider credentials missing (${newsCheck.missing.join(', ')})`);
  }

  if (newsCheck.placeholders.length > 0) {
    warnings.push(
      `placeholder news provider credentials detected (${newsCheck.placeholders.join(', ')})`
    );
  }

  if (auxiliaryCheck.optionalMissing.length > 0) {
    warnings.push(
      `auxiliary data providers missing credentials (${auxiliaryCheck.optionalMissing.join(', ')})`
    );
  }
  if (auxiliaryCheck.optionalPlaceholders.length > 0) {
    warnings.push(
      `auxiliary data providers use placeholder credentials (${auxiliaryCheck.optionalPlaceholders.join(
        ', '
      )})`
    );
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
