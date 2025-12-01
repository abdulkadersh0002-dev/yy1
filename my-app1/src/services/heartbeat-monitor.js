class HeartbeatMonitor {
  constructor({ tradingEngine, tradeManager }) {
    this.tradingEngine = tradingEngine;
    this.tradeManager = tradeManager;
    this.priceDataFetcher = tradingEngine?.priceDataFetcher;
    this.apiKeyConfig = tradingEngine?.config?.apiKeys || {};
  }

  getHeartbeat() {
    const now = Date.now();
    const priceHealth = this.priceDataFetcher?.getHealthStatus?.() || {};

    const apiKeys = this.collectApiKeyStatus();
    const providers = this.collectProviderStatus(priceHealth);
    const cache = this.collectCacheStatus(priceHealth);
    const signalFreshness = this.collectSignalFreshness(now);
    const analyzers = this.collectAnalyzerStatus();
    const marketInsights = this.collectMarketInsights();
    const storage = this.collectStorageStatus();
    const summary = this.buildSummary({
      apiKeys,
      providers,
      signalFreshness,
      cache,
      priceHealth,
      marketInsights,
      storage
    });

    return {
      timestamp: now,
      status: summary.status,
      summary,
      apiKeys,
      providers,
      cache,
      signalFreshness,
      analyzers,
      marketInsights,
      storage,
      priceData: {
        alerts: priceHealth.alerts || [],
        lastSuccessfulFetch: priceHealth.lastSuccessfulFetch || null,
        lastError: priceHealth.lastError || null,
        metrics: priceHealth.metrics || {},
        providerOrderPreview: priceHealth.providerOrderPreview || [],
        dataConfidence: priceHealth.dataConfidence || null
      }
    };
  }

  collectApiKeyStatus() {
    const keys = {
      twelveData: this.apiKeyConfig.twelveData,
      alphaVantage: this.apiKeyConfig.alphaVantage,
      finnhub: this.apiKeyConfig.finnhub,
      polygon: this.apiKeyConfig.polygon,
      newsApi: this.apiKeyConfig.newsApi,
      fred: this.apiKeyConfig.fred,
      exchangeRate: this.apiKeyConfig.exchangeRate,
      fixer: this.apiKeyConfig.fixer
    };

    const result = {};

    Object.entries(keys).forEach(([name, value]) => {
      const configured = Boolean(value && value !== 'demo' && value !== 'free');
      result[name] = {
        configured,
        masked: configured ? this.maskKey(value) : null
      };
    });

    return result;
  }

  collectProviderStatus(priceHealth) {
    const rateLimits = priceHealth.rateLimits || {};
    const metrics = (priceHealth.metrics && priceHealth.metrics.providers) || {};
    const confidenceSnapshot = priceHealth.dataConfidence || { providers: {} };
    const healthSnapshot = priceHealth.providerHealth || {};
    const persistedMetrics =
      this.tradingEngine?.priceDataFetcher?.getLatestPersistedProviderMetrics?.() || {};
    const disabledProviders = new Set(
      (this.tradingEngine?.config?.priceData?.disabledProviders || [])
        .map((name) => `${name}`.trim().toLowerCase())
        .filter(Boolean)
    );

    const providers = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'];
    const status = {};

    providers.forEach((provider) => {
      const normalized = provider.toLowerCase();
      const hasKey = Boolean(
        this.apiKeyConfig[provider] &&
          this.apiKeyConfig[provider] !== 'demo' &&
          this.apiKeyConfig[provider] !== 'free'
      );
      const isDisabled = disabledProviders.has(normalized);
      const enabled = hasKey && !isDisabled;
      const limit = rateLimits[provider] || {};
      const providerMetrics = metrics[provider] || { success: 0, failed: 0, rateLimited: 0 };
      const targetLatency =
        this.priceDataFetcher?.providerLatencyTargets?.[provider] ??
        providerMetrics.targetLatencyMs ??
        null;

      const totalRequests = (providerMetrics.success || 0) + (providerMetrics.failed || 0);
      const successRate =
        totalRequests > 0
          ? parseFloat((((providerMetrics.success || 0) / totalRequests) * 100).toFixed(1))
          : null;

      let providerStatus = 'healthy';
      if (isDisabled) {
        providerStatus = 'disabled';
      } else if (!hasKey) {
        providerStatus = 'missing';
      } else if (limit.backoffSeconds && limit.backoffSeconds > 0) {
        providerStatus = 'backoff';
      } else if (limit.remaining != null && limit.remaining <= 5) {
        providerStatus = 'warning';
      }

      if (providerMetrics?.circuitBreaker) {
        providerStatus = 'breaker';
      }

      status[provider] = {
        status: providerStatus,
        configured: hasKey,
        enabled,
        disabled: isDisabled,
        remaining: limit.remaining != null ? limit.remaining : null,
        resetIn: limit.resetIn != null ? limit.resetIn : null,
        backoffSeconds: limit.backoffSeconds || 0,
        success: providerMetrics.success || 0,
        failed: providerMetrics.failed || 0,
        rateLimited: providerMetrics.rateLimited || 0,
        successRate,
        avgLatencyMs: providerMetrics.avgLatencyMs ?? null,
        qualityScore: providerMetrics.qualityScore ?? null,
        normalizedQuality: providerMetrics.normalizedQuality ?? null,
        dataConfidence: confidenceSnapshot.providers?.[provider]?.confidencePct ?? null,
        samples: providerMetrics.samples || 0,
        lastRequestAt: providerMetrics.lastRequestAt || null,
        lastSuccessAt: providerMetrics.lastSuccessAt || null,
        lastFailureAt: providerMetrics.lastFailureAt || null,
        targetLatencyMs: targetLatency,
        healthStatus: providerMetrics.healthStatus || providerStatus,
        circuitBreaker: providerMetrics.circuitBreaker || null,
        health: healthSnapshot[provider] || null,
        persisted: persistedMetrics[provider] || null
      };
    });

    status.providerOrder = Array.isArray(priceHealth.providerOrderPreview)
      ? priceHealth.providerOrderPreview
      : [];

    return status;
  }

  collectCacheStatus(priceHealth) {
    const cache = priceHealth.cache || {};
    return {
      size: cache.size || 0,
      hitRate: cache.hitRate || 'N/A',
      segments: cache.segments || {},
      scheduledRefreshes: cache.scheduledRefreshes || 0
    };
  }

  collectSignalFreshness(now) {
    const pairs = this.tradeManager?.tradingPairs || [];
    const lastChecks = this.tradeManager?.lastSignalCheck || new Map();
    const interval = this.tradeManager?.signalCheckInterval || 900000;

    const details = pairs.map((pair) => {
      const last = lastChecks.get(pair) || null;
      const ageMs = last ? now - last : null;
      let status = 'unknown';

      if (!last) {
        status = 'missing';
      } else if (ageMs <= interval * 1.2) {
        status = 'fresh';
      } else if (ageMs <= interval * 2) {
        status = 'warning';
      } else {
        status = 'stale';
      }

      return {
        pair,
        status,
        lastSignalAt: last ? new Date(last).toISOString() : null,
        ageMs
      };
    });

    const summary = {
      totalPairs: details.length,
      freshCount: details.filter((d) => d.status === 'fresh').length,
      warningCount: details.filter((d) => d.status === 'warning').length,
      staleCount: details.filter((d) => d.status === 'stale').length,
      missingCount: details.filter((d) => d.status === 'missing').length
    };

    return { summary, pairs: details, expectedIntervalMs: interval };
  }

  collectAnalyzerStatus() {
    const technicalCache = this.tradingEngine?.technicalAnalyzer?.cache?.size || 0;
    const featureStoreStats = this.tradingEngine?.featureStore?.getStats?.(12) || null;
    const featureStorePersistence = this.tradingEngine?.featureStore?.getPersistenceStatus?.() || {
      enabled: false,
      lastPersistedAt: null,
      totalPersisted: 0
    };

    return {
      economic: {
        cacheSize: this.tradingEngine?.economicAnalyzer?.cache?.size || 0
      },
      news: {
        cacheSize: this.tradingEngine?.newsAnalyzer?.cache?.size || 0
      },
      technical: {
        cacheSize: technicalCache,
        featureStore: featureStoreStats,
        featureStorePersistence
      }
    };
  }

  collectMarketInsights() {
    if (typeof this.tradingEngine?.getMarketInsights !== 'function') {
      return { updatedAt: Date.now(), pairs: [], upcomingEvents: [], sentiment: [] };
    }
    return this.tradingEngine.getMarketInsights({ limitEvents: 15, limitPairs: 10 });
  }

  buildSummary({
    apiKeys,
    providers,
    signalFreshness,
    cache,
    priceHealth,
    marketInsights,
    storage
  }) {
    const missingKeys = Object.values(apiKeys).filter((info) => !info.configured).length;

    const providerStatuses = Object.entries(providers)
      .filter(([name]) => name !== 'providerOrder')
      .map(([, info]) => info.status);

    const providerWarnings = providerStatuses.filter((s) => s === 'warning').length;
    const providerBackoffs = providerStatuses.filter((s) => s === 'backoff').length;
    const providerBreakers = providerStatuses.filter((s) => s === 'breaker').length;

    const staleSignals = signalFreshness.summary.staleCount || 0;
    const missingSignals = signalFreshness.summary.missingCount || 0;

    let status = 'healthy';
    if (
      missingKeys > 0 ||
      providerBackoffs > 0 ||
      providerBreakers > 0 ||
      staleSignals > 0 ||
      missingSignals > 0
    ) {
      status = 'degraded';
    }

    return {
      status,
      missingKeys,
      providerWarnings,
      providerBackoffs,
      providerBreakers,
      staleSignals,
      missingSignals,
      cacheHitRate: cache.hitRate,
      providerOrder: providers.providerOrder || [],
      totalAlerts: Array.isArray(priceHealth.alerts) ? priceHealth.alerts.length : 0,
      upcomingEvents: marketInsights?.upcomingEvents?.length || 0,
      dataConfidence: priceHealth?.dataConfidence?.aggregate ?? null,
      storageEnabled: Boolean(storage?.enabled),
      persistedSnapshots: storage?.featureStore?.totalPersisted || 0
    };
  }

  collectStorageStatus() {
    const persistenceEnabled = Boolean(this.tradingEngine?.persistence);
    const featureStoreStatus = this.tradingEngine?.featureStore?.getPersistenceStatus?.() || {
      enabled: persistenceEnabled,
      lastPersistedAt: null,
      totalPersisted: 0
    };

    const providerSnapshots =
      this.tradingEngine?.priceDataFetcher?.getLatestPersistedProviderMetrics?.() || {};
    const providerEntries = Object.values(providerSnapshots);

    const lastProviderPersist = providerEntries.reduce((latest, entry) => {
      if (!entry?.collectedAt) {
        return latest;
      }
      const ts = Date.parse(entry.collectedAt);
      if (!Number.isFinite(ts)) {
        return latest;
      }
      return Math.max(latest, ts);
    }, 0);

    return {
      enabled: persistenceEnabled,
      featureStore: featureStoreStatus,
      providerMetrics: {
        providersTracked: providerEntries.length,
        lastPersistedAt:
          lastProviderPersist > 0 ? new Date(lastProviderPersist).toISOString() : null,
        entries: providerSnapshots
      }
    };
  }

  maskKey(key) {
    if (!key || typeof key !== 'string') {
      return null;
    }

    if (key.length <= 6) {
      return `${key[0]}***${key[key.length - 1]}`;
    }

    return `${key.slice(0, 4)}***${key.slice(-3)}`;
  }
}

export default HeartbeatMonitor;
