import { allowSyntheticData, requireRealTimeData } from '../config/runtime-flags.js';

const REQUIRED_PROVIDERS = [
  { envKey: 'TWELVE_DATA_API_KEY', label: 'Twelve Data', configKey: 'twelveData' },
  { envKey: 'ALPHA_VANTAGE_API_KEY', label: 'Alpha Vantage', configKey: 'alphaVantage' },
  { envKey: 'FINNHUB_API_KEY', label: 'Finnhub', configKey: 'finnhub' },
  { envKey: 'POLYGON_API_KEY', label: 'Polygon', configKey: 'polygon' },
  { envKey: 'NEWSAPI_KEY', label: 'NewsAPI', configKey: 'newsApi' }
];

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

  list.forEach(({ envKey, label, configKey, optional }) => {
    const keyValue = apiKeys?.[configKey] ?? process.env[envKey];
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

function parseDisabledProviders(env = process.env) {
  const raw = env.PRICE_PROVIDERS_DISABLED;
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

function preferRssNews(env = process.env) {
  if (env.NEWS_RSS_ONLY === 'true') {
    return true;
  }
  const translationEnabled = env.ENABLE_NEWS_TRANSLATION === 'true';
  return !translationEnabled;
}

export function enforceRealTimeProviderReadiness(apiKeys = {}, env = process.env) {
  if (!requireRealTimeData()) {
    return;
  }

  if (allowSyntheticData()) {
    const error = new Error(
      'Real-time data enforcement requires ALLOW_SYNTHETIC_DATA=false or REQUIRE_REALTIME_DATA=true'
    );
    error.code = 'REALTIME_DATA_REQUIRED';
    throw error;
  }

  const disabledProviders = parseDisabledProviders(env);
  const rssOnlyNews = preferRssNews(env);
  const filteredRequiredProviders = REQUIRED_PROVIDERS.filter((provider) => {
    const normalizedKey = provider.configKey.toLowerCase();
    if (disabledProviders.has(normalizedKey)) {
      return false;
    }
    if (normalizedKey === 'newsapi' && rssOnlyNews) {
      return false;
    }
    return true;
  });

  const requiredCheck = collectInvalidProviders(filteredRequiredProviders, apiKeys);
  const auxiliaryCheck = collectInvalidProviders(AUXILIARY_PROVIDERS, apiKeys);

  const issues = [];
  const warnings = [];

  if (requiredCheck.missing.length > 0) {
    issues.push(`missing API keys for ${requiredCheck.missing.join(', ')}`);
  }
  if (requiredCheck.placeholders.length > 0) {
    warnings.push(`placeholder API keys detected for ${requiredCheck.placeholders.join(', ')}`);
  }

  if (auxiliaryCheck.optionalMissing.length > 0) {
    warnings.push(
      `auxiliary data providers missing keys (${auxiliaryCheck.optionalMissing.join(', ')})`
    );
  }
  if (auxiliaryCheck.optionalPlaceholders.length > 0) {
    warnings.push(
      `auxiliary data providers use placeholder keys (${auxiliaryCheck.optionalPlaceholders.join(', ')})`
    );
  }

  const dbRequired = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'];
  const dbMissing = dbRequired.filter((key) => !env[key]);
  if (dbMissing.length > 0) {
    issues.push(`database configuration missing: ${dbMissing.join(', ')}`);
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
