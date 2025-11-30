import { requireRealTimeData } from '../config/runtime-flags.js';

const CRITICAL_PROVIDER_STATUSES = new Set(['missing', 'disabled', 'breaker']);
const DEGRADED_PROVIDER_STATUSES = new Set(['warning', 'backoff']);

const toPercent = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number.parseFloat(value.toFixed(1));
};

const secondsAgo = (timestamp) => {
  if (!timestamp) {
    return null;
  }
  const epoch = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(epoch)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - epoch) / 1000));
};

function summarizeProviderHealth(priceDataFetcher, heartbeat, requireRealtime) {
  if (!priceDataFetcher) {
    return {
      id: 'price-feeds',
      label: 'Price Data Feeds',
      state: 'critical',
      detail: 'Price data fetcher unavailable',
      meta: { providers: [] }
    };
  }

  const providerEntries = [];
  const heartbeatProviders = heartbeat?.providers || {};
  for (const [provider, snapshot] of Object.entries(heartbeatProviders)) {
    if (!snapshot || typeof snapshot !== 'object' || provider === 'providerOrder') {
      continue;
    }
    if ('status' in snapshot || 'healthStatus' in snapshot) {
      providerEntries.push({ provider, snapshot });
    }
  }

  if (providerEntries.length === 0) {
    const configuredProviders = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'].filter(
      (name) => priceDataFetcher.providerConfigured?.(name)
    );
    const state =
      configuredProviders.length > 0 ? 'operational' : requireRealtime ? 'critical' : 'degraded';
    return {
      id: 'price-feeds',
      label: 'Price Data Feeds',
      state,
      detail: configuredProviders.length
        ? `Providers active: ${configuredProviders.join(', ')}`
        : 'No live price providers configured',
      meta: {
        providers: configuredProviders.map((provider) => ({ provider, status: 'configured' }))
      }
    };
  }

  const failing = [];
  const degraded = [];
  const providers = providerEntries.map(({ provider, snapshot }) => {
    const status = snapshot.healthStatus || snapshot.status || 'unknown';
    if (CRITICAL_PROVIDER_STATUSES.has(status)) {
      failing.push(provider);
    } else if (DEGRADED_PROVIDER_STATUSES.has(status)) {
      degraded.push(provider);
    }
    return {
      provider,
      status,
      configured: Boolean(snapshot.configured),
      enabled: snapshot.enabled !== false,
      success: snapshot.success ?? null,
      failed: snapshot.failed ?? null,
      successRate: snapshot.successRate ?? null,
      lastSuccessAt: snapshot.lastSuccessAt || null,
      lastFailureAt: snapshot.lastFailureAt || null,
      dataConfidence: snapshot.dataConfidence ?? null
    };
  });

  const aggregateConfidence =
    heartbeat?.priceData?.dataConfidence?.aggregate ??
    priceDataFetcher.getAggregateDataConfidence?.() ??
    null;
  const lastErrorSeconds = secondsAgo(priceDataFetcher.metrics?.lastError?.timestamp);

  let state = 'operational';
  let detail = `Providers healthy (${providers.length})`;

  if (failing.length > 0) {
    state = requireRealtime ? 'critical' : 'degraded';
    detail = `Provider issues: ${failing.join(', ')}`;
  } else if (degraded.length > 0) {
    state = 'degraded';
    detail = `Providers in backoff: ${degraded.join(', ')}`;
  }

  if (aggregateConfidence != null && aggregateConfidence < 45) {
    state = state === 'critical' ? state : 'degraded';
    detail = `Low data confidence (${aggregateConfidence}%)`;
  }

  if (requireRealtime && lastErrorSeconds != null && lastErrorSeconds < 90) {
    state = 'critical';
    detail = `Recent provider error ${lastErrorSeconds}s ago`;
  }

  return {
    id: 'price-feeds',
    label: 'Price Data Feeds',
    state,
    detail,
    meta: {
      providers,
      aggregateConfidence: aggregateConfidence != null ? toPercent(aggregateConfidence) : null,
      lastErrorSeconds
    }
  };
}

function summarizeNewsHealth(newsAnalyzer) {
  if (!newsAnalyzer) {
    return {
      id: 'news',
      label: 'News & Sentiment',
      state: 'critical',
      detail: 'News analyzer unavailable'
    };
  }

  const rssOnlyMode = process.env.NEWS_RSS_ONLY === 'true';
  if (rssOnlyMode) {
    const feedCount = Array.isArray(newsAnalyzer.aggregator?.feeds)
      ? newsAnalyzer.aggregator.feeds.length
      : null;
    return {
      id: 'news-sentiment',
      label: 'News & Sentiment',
      state: feedCount && feedCount > 0 ? 'operational' : 'degraded',
      detail:
        feedCount && feedCount > 0
          ? `RSS feeds active (${feedCount})`
          : 'RSS aggregator configured without feeds',
      meta: {
        rssOnly: true,
        feedCount
      }
    };
  }

  const apiKeys = newsAnalyzer.apiKeys || {};
  const required = ['polygon', 'finnhub'];
  const missing = required.filter((key) => !apiKeys[key] || apiKeys[key] === 'demo');
  const optional = ['newsApi'];
  const optionalMissing = optional.filter((key) => !apiKeys[key]);

  let state = 'operational';
  let detail = 'Live sources connected';

  if (missing.length > 0) {
    state = 'critical';
    detail = `Missing API keys: ${missing.join(', ')}`;
  } else if (optionalMissing.length > 0) {
    state = 'degraded';
    detail = `Optional feeds offline: ${optionalMissing.join(', ')}`;
  }

  return {
    id: 'news-sentiment',
    label: 'News & Sentiment',
    state,
    detail,
    meta: {
      configured: Object.keys(apiKeys)
    }
  };
}

function summarizeEconomicHealth(economicAnalyzer) {
  if (!economicAnalyzer) {
    return {
      id: 'macro',
      label: 'Economic Analyzer',
      state: 'critical',
      detail: 'Economic analyzer unavailable'
    };
  }

  const cacheSize = economicAnalyzer.cache?.size ?? null;
  const apiKeys = economicAnalyzer.apiKeys || {};
  const hasKey = Object.values(apiKeys).some((value) => Boolean(value));

  let state = 'operational';
  let detail = cacheSize ? `Cache entries: ${cacheSize}` : 'Ready';

  if (!hasKey) {
    state = 'degraded';
    detail = 'Operating without API keys';
  }

  return {
    id: 'macro',
    label: 'Economic Analyzer',
    state,
    detail,
    meta: {
      cacheSize,
      configured: hasKey
    }
  };
}

function summarizeSignalEngine(tradeManager, tradingEngine) {
  if (!tradeManager || !tradingEngine) {
    return {
      id: 'signals',
      label: 'Signal Engine',
      state: 'critical',
      detail: 'Trading engine unavailable'
    };
  }

  const status = tradeManager.getStatus?.() || {};
  const statistics = tradingEngine.getStatistics?.() || {};
  const pairs = Array.isArray(status.pairs) ? status.pairs.length : 0;
  const totalTrades = Number.isFinite(statistics.totalTrades) ? statistics.totalTrades : null;

  let state = 'operational';
  let detail = `Monitoring ${pairs} pairs`;

  if (!status.enabled) {
    state = 'degraded';
    detail = pairs > 0 ? 'Automation paused' : 'Engine idle';
  }

  if (pairs === 0) {
    state = 'degraded';
    detail = 'No pairs configured';
  }

  return {
    id: 'signals',
    label: 'Signal Engine',
    state,
    detail,
    meta: {
      pairs,
      enabled: Boolean(status.enabled),
      totalTrades
    }
  };
}

function summarizeHeartbeat(heartbeatMonitor) {
  if (!heartbeatMonitor?.getHeartbeat) {
    return null;
  }
  try {
    return heartbeatMonitor.getHeartbeat();
  } catch (_error) {
    return null;
  }
}

export function buildModuleHealthSummary({ tradingEngine, tradeManager, heartbeatMonitor }) {
  const requireRealtime = requireRealTimeData();
  const heartbeat = summarizeHeartbeat(heartbeatMonitor);
  const modules = [];

  modules.push(
    summarizeProviderHealth(tradingEngine?.priceDataFetcher, heartbeat, requireRealtime)
  );
  modules.push(summarizeNewsHealth(tradingEngine?.newsAnalyzer));
  modules.push(summarizeEconomicHealth(tradingEngine?.economicAnalyzer));
  modules.push(summarizeSignalEngine(tradeManager, tradingEngine));

  const overallState = modules.some((module) => module.state === 'critical')
    ? 'critical'
    : modules.some((module) => module.state === 'degraded')
      ? 'degraded'
      : 'operational';

  return {
    overall: {
      state: overallState,
      requireRealTime: requireRealtime,
      updatedAt: Date.now()
    },
    modules,
    heartbeat: heartbeat
      ? {
          status: heartbeat.status,
          timestamp: heartbeat.timestamp,
          summary: heartbeat.summary
        }
      : null
  };
}

export function buildHealthzPayload(context) {
  const summary = buildModuleHealthSummary(context);
  const ok = summary.overall.state === 'operational';
  return {
    ok,
    status: summary.overall.state,
    requireRealTime: summary.overall.requireRealTime,
    updatedAt: summary.overall.updatedAt,
    modules: summary.modules
  };
}

const PROVIDER_AVAILABILITY_PROVIDERS = ['twelveData', 'polygon', 'finnhub', 'alphaVantage'];
const DEFAULT_AVAILABILITY_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];

export function buildProviderAvailabilitySnapshot({
  priceDataFetcher,
  timeframes,
  requireHealthyQuality = true,
  qualityThreshold
} = {}) {
  const timestamp = Date.now();

  if (!priceDataFetcher || typeof priceDataFetcher.getProviderAvailability !== 'function') {
    return {
      timestamp,
      providers: [],
      timeframes: [],
      aggregateQuality: null,
      normalizedQuality: null,
      dataConfidence: null,
      providerOrder: [],
      rateLimits: {},
      defaultAvailability: null
    };
  }

  const selectedTimeframes = (() => {
    if (!Array.isArray(timeframes) || timeframes.length === 0) {
      return DEFAULT_AVAILABILITY_TIMEFRAMES;
    }
    const unique = new Set();
    timeframes.forEach((entry) => {
      if (!entry && entry !== 0) {
        return;
      }
      const token = String(entry).trim();
      if (!token) {
        return;
      }
      unique.add(token.toUpperCase());
    });
    return unique.size > 0 ? Array.from(unique) : DEFAULT_AVAILABILITY_TIMEFRAMES;
  })();

  const health =
    typeof priceDataFetcher.getHealthStatus === 'function'
      ? priceDataFetcher.getHealthStatus()
      : {};
  const dataConfidence =
    health?.dataConfidence ?? priceDataFetcher.getDataConfidenceSnapshot?.() ?? null;
  const aggregateQuality = Number.isFinite(dataConfidence?.aggregate)
    ? dataConfidence.aggregate
    : null;
  const normalizedQuality = Number.isFinite(dataConfidence?.normalized)
    ? dataConfidence.normalized
    : null;

  const providerMetrics = health?.metrics?.providers || {};

  const providers = PROVIDER_AVAILABILITY_PROVIDERS.map((provider) => {
    const availability =
      priceDataFetcher.getProviderAvailability(provider, { allowUnconfigured: true }) || {};
    const metrics = providerMetrics[provider] || {};
    return {
      provider,
      available: availability.available !== false,
      reasons: Array.isArray(availability.reasons) ? [...availability.reasons] : [],
      hasCredentials: availability.hasCredentials ?? null,
      disabled: availability.disabled ?? false,
      circuitBreakerActive: availability.circuitBreakerActive ?? false,
      backoffUntil: availability.backoffUntil ?? null,
      remainingRequests: availability.remainingRequests ?? null,
      metrics: {
        success: metrics.success ?? 0,
        failed: metrics.failed ?? 0,
        samples: metrics.samples ?? 0,
        avgLatencyMs: metrics.avgLatencyMs ?? null,
        normalizedQuality: metrics.normalizedQuality ?? null,
        healthStatus: metrics.healthStatus ?? 'unknown',
        rateLimited: metrics.rateLimited ?? 0
      }
    };
  });

  const effectiveQualityThreshold = Number.isFinite(Number(qualityThreshold))
    ? Number(qualityThreshold)
    : undefined;

  const timeframeReports = selectedTimeframes.map((timeframe) => {
    const viabilityOptions = {
      includeDetails: true,
      requireHealthyQuality
    };
    if (Number.isFinite(effectiveQualityThreshold)) {
      viabilityOptions.qualityThreshold = effectiveQualityThreshold;
    }
    const viability = priceDataFetcher.isDataFetchViable?.(timeframe, viabilityOptions) || null;
    if (!viability) {
      return {
        timeframe,
        viable: false,
        availableProviders: [],
        blockedProviders: [],
        normalizedQuality: null,
        qualitySatisfied: false,
        inspectedAt: timestamp,
        reasons: ['viability_unavailable'],
        availabilityDetails: []
      };
    }
    const blockedProviders = Array.isArray(viability.blockedProviders)
      ? viability.blockedProviders.map((detail) => ({ ...detail }))
      : [];
    const availabilityDetails = Array.isArray(viability.availabilityDetails)
      ? viability.availabilityDetails.map((detail) => ({ ...detail }))
      : [];
    return {
      timeframe: viability.timeframe || timeframe,
      viable: viability.viable !== false,
      availableProviders: Array.isArray(viability.availableProviders)
        ? [...viability.availableProviders]
        : [],
      blockedProviders,
      normalizedQuality: Number.isFinite(viability.normalizedQuality)
        ? viability.normalizedQuality
        : null,
      qualityThreshold: Number.isFinite(viability.qualityThreshold)
        ? viability.qualityThreshold
        : Number.isFinite(effectiveQualityThreshold)
          ? effectiveQualityThreshold
          : null,
      qualitySatisfied: viability.qualitySatisfied !== false,
      inspectedAt: Number.isFinite(viability.inspectedAt) ? viability.inspectedAt : timestamp,
      reasons: Array.isArray(viability.reasons) ? [...viability.reasons] : [],
      availabilityDetails
    };
  });

  const rateLimits = {};
  const rawRateLimits = health?.rateLimits || {};
  for (const [provider, entry] of Object.entries(rawRateLimits)) {
    rateLimits[provider] = {
      remaining: entry?.remaining ?? null,
      count: entry?.count ?? null,
      maxRequests: entry?.maxRequests ?? null,
      resetInMs: entry?.resetIn ?? null,
      backoffSeconds: entry?.backoffSeconds ?? null,
      backoffUntil: entry?.backoffUntil ?? null
    };
  }

  const providerOrder = Array.isArray(health?.providerOrderPreview)
    ? [...health.providerOrderPreview]
    : [];

  return {
    timestamp,
    providers,
    timeframes: timeframeReports,
    aggregateQuality,
    normalizedQuality,
    dataConfidence,
    providerOrder,
    rateLimits,
    defaultAvailability: health?.availability ?? null
  };
}

const DEFAULT_PROVIDER_CLASSIFICATION = {
  degradedRatio: 0.3,
  criticalRatio: 0.75,
  qualityWarningThreshold: 60,
  qualityCriticalThreshold: 45
};

const numberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function classifyProviderAvailabilitySnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      state: 'unknown',
      severity: 'info',
      reason: 'missing_snapshot',
      message: 'Provider availability unknown',
      detail: 'No snapshot available',
      metrics: {
        activeProviders: 0,
        unavailableProviders: 0,
        breakerProviders: 0,
        blockedTimeframes: 0,
        blockedProviderRatio: 0,
        blockedTimeframeRatio: 0,
        aggregateQuality: null,
        normalizedQuality: null
      },
      context: {
        unavailableProviders: [],
        breakerProviders: [],
        blockedTimeframes: [],
        reasons: []
      }
    };
  }

  const thresholds = {
    ...DEFAULT_PROVIDER_CLASSIFICATION,
    ...Object.entries(options).reduce((acc, [key, value]) => {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        acc[key] = numericValue;
      } else if (key === 'enabled') {
        acc.enabled = Boolean(value);
      }
      return acc;
    }, {})
  };

  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  const timeframes = Array.isArray(snapshot.timeframes) ? snapshot.timeframes : [];
  const activeProviders = providers.filter((entry) => entry && entry.disabled !== true);
  const unavailableProviders = activeProviders.filter((entry) => entry.available === false);
  const breakerProviders = activeProviders.filter((entry) => entry.circuitBreakerActive === true);
  const blockedTimeframes = timeframes.filter((entry) => entry && entry.viable === false);

  const aggregateQualityRaw = numberOrNull(snapshot.aggregateQuality);
  const normalizedQualityRaw = numberOrNull(snapshot.normalizedQuality);
  const aggregateQuality =
    aggregateQualityRaw != null
      ? aggregateQualityRaw
      : normalizedQualityRaw != null
        ? normalizedQualityRaw * 100
        : numberOrNull(snapshot.dataConfidence?.aggregate);
  const normalizedQuality =
    normalizedQualityRaw != null
      ? normalizedQualityRaw
      : aggregateQuality != null
        ? aggregateQuality / 100
        : numberOrNull(snapshot.dataConfidence?.normalized);

  const blockedProviderRatio =
    activeProviders.length > 0 ? unavailableProviders.length / activeProviders.length : 0;
  const blockedTimeframeRatio =
    timeframes.length > 0 ? blockedTimeframes.length / timeframes.length : 0;

  let state = 'operational';
  let reason = 'healthy';

  if (snapshot.defaultAvailability?.viable === false) {
    state = 'critical';
    reason = 'default_timeframe_blocked';
  }

  if (state !== 'critical' && aggregateQuality != null) {
    if (aggregateQuality <= thresholds.qualityCriticalThreshold) {
      state = 'critical';
      reason = 'quality_critical';
    } else if (aggregateQuality <= thresholds.qualityWarningThreshold) {
      state = 'degraded';
      reason = 'quality_warning';
    }
  }

  if (state !== 'critical') {
    if (
      blockedProviderRatio >= thresholds.criticalRatio ||
      blockedTimeframeRatio >= thresholds.criticalRatio
    ) {
      state = 'critical';
      reason = 'provider_ratio_critical';
    } else if (
      blockedProviderRatio >= thresholds.degradedRatio ||
      blockedTimeframeRatio >= thresholds.degradedRatio
    ) {
      state = 'degraded';
      reason = 'provider_ratio_degraded';
    }
  }

  if (state === 'operational') {
    if (unavailableProviders.length > 0) {
      state = 'degraded';
      reason = 'providers_unavailable';
    } else if (breakerProviders.length > 0) {
      state = 'degraded';
      reason = 'circuit_breaker_active';
    } else if (blockedTimeframes.length > 0) {
      state = 'degraded';
      reason = 'timeframes_blocked';
    }
  }

  const severity = state === 'critical' ? 'critical' : state === 'degraded' ? 'warning' : 'info';

  const detailParts = [];
  if (unavailableProviders.length > 0) {
    detailParts.push(
      `Unavailable: ${unavailableProviders.map((entry) => entry.provider).join(', ')}`
    );
  }
  if (breakerProviders.length > 0) {
    detailParts.push(`Breaker: ${breakerProviders.map((entry) => entry.provider).join(', ')}`);
  }
  if (blockedTimeframes.length > 0) {
    detailParts.push(`Blocked TF: ${blockedTimeframes.map((entry) => entry.timeframe).join(', ')}`);
  }
  if (aggregateQuality != null) {
    detailParts.push(`Quality ${aggregateQuality.toFixed(1)}%`);
  }

  const detail = detailParts.length > 0 ? detailParts.join(' · ') : 'Provider availability steady';

  let message = 'Provider availability healthy';
  if (state === 'degraded') {
    const total = activeProviders.length || providers.length || 0;
    message = `Provider availability degraded${total ? `: ${unavailableProviders.length}/${total} affected` : ''}`;
  } else if (state === 'critical') {
    const total = activeProviders.length || providers.length || 0;
    message = `Critical provider outage${total ? `: ${unavailableProviders.length}/${total} offline` : ''}`;
  }

  return {
    state,
    severity,
    reason,
    message,
    detail,
    metrics: {
      activeProviders: activeProviders.length,
      unavailableProviders: unavailableProviders.length,
      breakerProviders: breakerProviders.length,
      blockedTimeframes: blockedTimeframes.length,
      blockedProviderRatio,
      blockedTimeframeRatio,
      aggregateQuality,
      normalizedQuality
    },
    context: {
      unavailableProviders: unavailableProviders.map((entry) => entry.provider),
      breakerProviders: breakerProviders.map((entry) => entry.provider),
      blockedTimeframes: blockedTimeframes.map((entry) => entry.timeframe),
      reasons: Array.isArray(snapshot.defaultAvailability?.reasons)
        ? [...snapshot.defaultAvailability.reasons]
        : [],
      inspectedAt: snapshot.defaultAvailability?.inspectedAt ?? snapshot.timestamp ?? Date.now(),
      providerOrder: Array.isArray(snapshot.providerOrder) ? [...snapshot.providerOrder] : [],
      aggregateQuality,
      normalizedQuality,
      blockedProviderRatio,
      blockedTimeframeRatio
    }
  };
}

export function summarizeProviderAvailabilityHistory(history = [], options = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      totalSamples: 0,
      operationalSamples: 0,
      degradedSamples: 0,
      criticalSamples: 0,
      unknownSamples: 0,
      uptimeRatio: null,
      degradedLastHour: 0,
      criticalLastHour: 0,
      lastDegradedAt: null,
      lastCriticalAt: null,
      windowStart: null,
      windowEnd: null,
      windowMs: null,
      averageAggregateQuality: null,
      averageNormalizedQuality: null
    };
  }

  const sorted = [...history].filter(Boolean).sort((a, b) => {
    const aTs = Number(a.timestamp || a.capturedAt || 0);
    const bTs = Number(b.timestamp || b.capturedAt || 0);
    return aTs - bTs;
  });

  if (sorted.length === 0) {
    return {
      totalSamples: 0,
      operationalSamples: 0,
      degradedSamples: 0,
      criticalSamples: 0,
      unknownSamples: 0,
      uptimeRatio: null,
      degradedLastHour: 0,
      criticalLastHour: 0,
      lastDegradedAt: null,
      lastCriticalAt: null,
      windowStart: null,
      windowEnd: null,
      windowMs: null,
      averageAggregateQuality: null,
      averageNormalizedQuality: null
    };
  }

  const now = Date.now();
  const lookbackMs =
    Number.isFinite(options.lookbackMs) && options.lookbackMs > 0
      ? options.lookbackMs
      : 60 * 60 * 1000;

  let operationalSamples = 0;
  let degradedSamples = 0;
  let criticalSamples = 0;
  let unknownSamples = 0;
  let degradedLastHour = 0;
  let criticalLastHour = 0;
  let lastDegradedAt = null;
  let lastCriticalAt = null;

  let aggregateQualityTotal = 0;
  let aggregateQualityCount = 0;
  let normalizedQualityTotal = 0;
  let normalizedQualityCount = 0;

  for (const entry of sorted) {
    const timestamp = Number(entry.timestamp || entry.capturedAt || 0);
    const state = (entry.state || 'unknown').toLowerCase();

    if (timestamp && (state === 'degraded' || state === 'critical')) {
      if (state === 'degraded') {
        lastDegradedAt = timestamp;
      } else if (state === 'critical') {
        lastCriticalAt = timestamp;
      }
    }

    if (state === 'operational') {
      operationalSamples += 1;
    } else if (state === 'degraded') {
      degradedSamples += 1;
    } else if (state === 'critical') {
      criticalSamples += 1;
    } else {
      unknownSamples += 1;
    }

    if (lookbackMs && timestamp && now - timestamp <= lookbackMs) {
      if (state === 'degraded') {
        degradedLastHour += 1;
      } else if (state === 'critical') {
        criticalLastHour += 1;
      }
    }

    const aggregate = Number(entry.aggregateQuality ?? entry.aggregate_quality);
    if (Number.isFinite(aggregate)) {
      aggregateQualityTotal += aggregate;
      aggregateQualityCount += 1;
    }

    const normalized = Number(entry.normalizedQuality ?? entry.normalized_quality);
    if (Number.isFinite(normalized)) {
      normalizedQualityTotal += normalized;
      normalizedQualityCount += 1;
    }
  }

  const totalSamples = sorted.length;
  const windowStart = Number(sorted[0].timestamp || sorted[0].capturedAt || null) || null;
  const windowEnd =
    Number(sorted[sorted.length - 1].timestamp || sorted[sorted.length - 1].capturedAt || null) ||
    null;
  const windowMs = windowStart && windowEnd ? Math.max(0, windowEnd - windowStart) : null;
  const uptimeRatio = totalSamples > 0 ? operationalSamples / totalSamples : null;

  return {
    totalSamples,
    operationalSamples,
    degradedSamples,
    criticalSamples,
    unknownSamples,
    uptimeRatio,
    degradedLastHour,
    criticalLastHour,
    lastDegradedAt,
    lastCriticalAt,
    windowStart,
    windowEnd,
    windowMs,
    averageAggregateQuality:
      aggregateQualityCount > 0 ? aggregateQualityTotal / aggregateQualityCount : null,
    averageNormalizedQuality:
      normalizedQualityCount > 0 ? normalizedQualityTotal / normalizedQualityCount : null
  };
}
