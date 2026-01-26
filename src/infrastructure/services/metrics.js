import client from 'prom-client';
import { appConfig } from '../../app/config.js';

const register = new client.Registry();
const prefix = appConfig.env.METRICS_PREFIX || 'signals';

client.collectDefaultMetrics({
  register,
  prefix: `${prefix}_`
});

const signalGenerationDuration = new client.Histogram({
  name: `${prefix}_signal_generation_duration_seconds`,
  help: 'Signal generation latency in seconds',
  labelNames: ['pair', 'status'],
  registers: [register],
  buckets: [0.25, 0.5, 1, 2, 4, 8, 16]
});

const signalGenerationTotal = new client.Counter({
  name: `${prefix}_signal_generated_total`,
  help: 'Count of generated trading signals',
  labelNames: ['pair', 'status'],
  registers: [register]
});

const tradeExecutionsTotal = new client.Counter({
  name: `${prefix}_trade_executions_total`,
  help: 'Trade executions attempted',
  labelNames: ['status'],
  registers: [register]
});

const providerHealthGauge = new client.Gauge({
  name: `${prefix}_provider_health_status`,
  help: 'Data provider health (1 healthy, 0 unhealthy)',
  labelNames: ['provider'],
  registers: [register]
});

const dataQualityGauge = new client.Gauge({
  name: `${prefix}_data_quality_score`,
  help: 'Recorded data quality scores (0-1)',
  labelNames: ['scope', 'metric'],
  registers: [register]
});

const prefetchQueueGauge = new client.Gauge({
  name: `${prefix}_prefetch_queue_depth`,
  help: 'Pending prefetch jobs in scheduler',
  registers: [register]
});

const prefetchRequestsCounter = new client.Counter({
  name: `${prefix}_prefetch_requests_total`,
  help: 'Prefetch scheduler requests by outcome',
  labelNames: ['pair', 'timeframe', 'status'],
  registers: [register]
});

const providerAvailabilityStateGauge = new client.Gauge({
  name: `${prefix}_provider_availability_state`,
  help: 'Binary indicator for current provider availability state',
  labelNames: ['state'],
  registers: [register]
});

const providerAvailabilityUptimeGauge = new client.Gauge({
  name: `${prefix}_provider_availability_uptime_ratio`,
  help: 'Provider availability uptime ratio over recorded history',
  labelNames: ['window'],
  registers: [register]
});

const providerAvailabilityIncidentGauge = new client.Gauge({
  name: `${prefix}_provider_availability_recent_incidents`,
  help: 'Count of provider availability incidents within recent window',
  labelNames: ['severity', 'window'],
  registers: [register]
});

const providerAvailabilitySamplesGauge = new client.Gauge({
  name: `${prefix}_provider_availability_samples_total`,
  help: 'Count of provider availability samples by state within history window',
  labelNames: ['state'],
  registers: [register]
});

const providerAvailabilityProviderGauge = new client.Gauge({
  name: `${prefix}_provider_availability_provider_state`,
  help: 'Per-provider availability and quality metrics',
  labelNames: ['provider', 'metric'],
  registers: [register]
});

const performanceGauge = new client.Gauge({
  name: `${prefix}_performance_metrics`,
  help: 'Real-time performance metrics snapshot',
  labelNames: ['metric'],
  registers: [register]
});

const executionSlippageHistogram = new client.Histogram({
  name: `${prefix}_execution_slippage_pips`,
  help: 'Observed execution slippage in pips',
  labelNames: ['broker', 'status'],
  registers: [register],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
});

export const metrics = {
  register,
  signalGenerationDuration,
  signalGenerationTotal,
  tradeExecutionsTotal,
  providerHealthGauge,
  dataQualityGauge,
  prefetchQueueGauge,
  prefetchRequestsCounter,
  providerAvailabilityStateGauge,
  providerAvailabilityUptimeGauge,
  providerAvailabilityIncidentGauge,
  providerAvailabilitySamplesGauge,
  providerAvailabilityProviderGauge,
  performanceGauge,
  executionSlippageHistogram
};

export function observeSignalGeneration({ pair, durationSeconds, status }) {
  const labels = { pair: pair || 'UNKNOWN', status };
  signalGenerationDuration.observe(labels, durationSeconds);
  signalGenerationTotal.inc(labels);
}

export function recordTradeExecution(status) {
  tradeExecutionsTotal.inc({ status });
}

export function setProviderHealth(provider, isHealthy) {
  providerHealthGauge.set({ provider }, isHealthy ? 1 : 0);
}

export function recordDataQuality(scope, metric, score) {
  if (typeof score === 'number') {
    dataQualityGauge.set({ scope, metric }, score);
  }
}

export function setPrefetchQueueDepth(count) {
  prefetchQueueGauge.set(count);
}

export function recordPrefetchResult(pair, timeframe, status) {
  prefetchRequestsCounter.inc({ pair, timeframe, status });
}

const knownAvailabilityProviders = new Set();

export function updateProviderAvailabilityMetrics({ state, historyStats, providers = [] } = {}) {
  const allowedStates = ['operational', 'degraded', 'critical', 'unknown'];
  const normalizedState = allowedStates.includes(String(state)?.toLowerCase())
    ? String(state).toLowerCase()
    : 'unknown';

  for (const candidate of allowedStates) {
    providerAvailabilityStateGauge.set({ state: candidate }, candidate === normalizedState ? 1 : 0);
  }

  const uptimeRatio = Number(historyStats?.uptimeRatio);
  if (Number.isFinite(uptimeRatio)) {
    providerAvailabilityUptimeGauge.set({ window: 'history' }, uptimeRatio);
  } else {
    providerAvailabilityUptimeGauge.set({ window: 'history' }, 0);
  }

  const degradedIncidents = Number(historyStats?.degradedLastHour);
  const criticalIncidents = Number(historyStats?.criticalLastHour);
  providerAvailabilityIncidentGauge.set(
    { severity: 'degraded', window: '1h' },
    Number.isFinite(degradedIncidents) ? degradedIncidents : 0
  );
  providerAvailabilityIncidentGauge.set(
    { severity: 'critical', window: '1h' },
    Number.isFinite(criticalIncidents) ? criticalIncidents : 0
  );

  const stateSamples = {
    operational: Number(historyStats?.operationalSamples) || 0,
    degraded: Number(historyStats?.degradedSamples) || 0,
    critical: Number(historyStats?.criticalSamples) || 0,
    unknown: Number(historyStats?.unknownSamples) || 0
  };

  for (const candidate of allowedStates) {
    providerAvailabilitySamplesGauge.set({ state: candidate }, stateSamples[candidate] ?? 0);
  }

  const seenProviders = new Set();
  if (Array.isArray(providers)) {
    for (const entry of providers) {
      const provider = entry?.provider ? String(entry.provider) : 'unknown';
      seenProviders.add(provider);
      knownAvailabilityProviders.add(provider);

      const available = entry?.available === false ? 0 : 1;
      providerAvailabilityProviderGauge.set({ provider, metric: 'available' }, available);

      const normalizedQuality = Number(
        entry?.metrics?.normalizedQuality ?? entry?.metrics?.normalized_quality
      );
      providerAvailabilityProviderGauge.set(
        { provider, metric: 'normalized_quality' },
        Number.isFinite(normalizedQuality) ? normalizedQuality : 0
      );
    }
  }

  for (const provider of knownAvailabilityProviders) {
    if (!seenProviders.has(provider)) {
      providerAvailabilityProviderGauge.set({ provider, metric: 'available' }, 0);
      providerAvailabilityProviderGauge.set({ provider, metric: 'normalized_quality' }, 0);
    }
  }
}

export function updatePerformanceMetrics({ performance = {}, statistics = {} } = {}) {
  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  performanceGauge.set({ metric: 'equity' }, toNumber(performance.latestEquity));
  performanceGauge.set({ metric: 'cumulative_return_pct' }, toNumber(performance.cumulativeReturnPct));
  performanceGauge.set({ metric: 'max_drawdown_pct' }, Math.abs(toNumber(performance.maxDrawdownPct)));
  performanceGauge.set({ metric: 'total_trades' }, toNumber(statistics.totalTrades));
  performanceGauge.set({ metric: 'win_rate_pct' }, toNumber(statistics.winRate));
  performanceGauge.set({ metric: 'profit_factor' }, toNumber(statistics.profitFactor));
}

export function recordExecutionSlippage({ broker, status, slippagePips } = {}) {
  const value = Number(slippagePips);
  if (!Number.isFinite(value)) {
    return;
  }
  executionSlippageHistogram.observe(
    { broker: broker || 'unknown', status: status || 'ok' },
    value
  );
}

export default {
  metrics,
  observeSignalGeneration,
  recordTradeExecution,
  setProviderHealth,
  recordDataQuality,
  setPrefetchQueueDepth,
  recordPrefetchResult,
  updateProviderAvailabilityMetrics,
  updatePerformanceMetrics,
  recordExecutionSlippage
};
