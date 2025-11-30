import React, { useMemo } from 'react';
import { formatRelativeTime, formatPercent } from '../utils/format.js';
import { useModuleHealth } from '../context/ModuleHealthContext.jsx';
import { useProviderAvailability } from '../context/ProviderAvailabilityContext.jsx';

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toTimestamp = (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const getLatestTimestamp = (collection = [], candidates = []) => {
  let latest = null;
  if (Array.isArray(collection)) {
    for (const item of collection) {
      for (const candidate of candidates) {
        const ts = toTimestamp(
          typeof candidate === 'function' ? candidate(item) : item?.[candidate]
        );
        if (ts && (!latest || ts > latest)) {
          latest = ts;
        }
      }
    }
  }
  return latest;
};

const classifyPerformance = (statisticsInput) => {
  const statistics = statisticsInput ?? {};
  const totalTrades = toNumber(statistics.totalTrades);
  const winRate = toNumber(statistics.winRate);
  const profitFactor = toNumber(statistics.profitFactor);

  if (!totalTrades || totalTrades < 5) {
    return {
      state: 'neutral',
      message: 'Insufficient history to rate performance',
      detail: 'Collect 5+ closed trades for meaningful stats'
    };
  }

  if ((winRate ?? 0) >= 55 && (profitFactor ?? 0) >= 1.2) {
    return {
      state: 'positive',
      message: 'Performance trending healthy',
      detail: `Win rate ${formatPercent(winRate, 1)} · PF ${(profitFactor ?? 0).toFixed(2)}`
    };
  }

  if ((profitFactor ?? 0) < 1) {
    return {
      state: 'warning',
      message: 'Profit factor below parity',
      detail: `Win rate ${formatPercent(winRate ?? 0, 1)} · PF ${(profitFactor ?? 0).toFixed(2)}`
    };
  }

  return {
    state: 'neutral',
    message: 'Performance stabilising',
    detail: `Win rate ${formatPercent(winRate ?? 0, 1)} · PF ${(profitFactor ?? 0).toFixed(2)}`
  };
};

const normalizeModuleState = (state) => {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'operational' || normalized === 'healthy') {
    return 'positive';
  }
  if (normalized === 'degraded' || normalized === 'warning' || normalized === 'backoff') {
    return 'warning';
  }
  if (normalized === 'critical' || normalized === 'error' || normalized === 'failed') {
    return 'critical';
  }
  if (normalized === 'positive' || normalized === 'neutral') {
    return normalized;
  }
  return 'neutral';
};

const describeModuleMeta = (module = {}) => {
  const meta = module.meta || {};
  if (!meta) {
    return null;
  }

  if (Array.isArray(meta.providers) && meta.providers.length > 0) {
    const highlights = meta.providers
      .slice(0, 4)
      .map((provider) => {
        const name = provider?.provider || provider?.id || 'provider';
        const status = String(provider?.status || 'unknown').toUpperCase();
        return `${name}: ${status}`;
      });
    if (meta.providers.length > 4) {
      highlights.push(`+${meta.providers.length - 4} more`);
    }
    if (Number.isFinite(meta.aggregateConfidence)) {
      highlights.push(`Confidence ${meta.aggregateConfidence}%`);
    }
    if (Number.isFinite(meta.lastErrorSeconds)) {
      highlights.push(`Last error ${meta.lastErrorSeconds}s ago`);
    }
    return highlights.join(' · ');
  }

  if (Number.isFinite(meta.cacheSize)) {
    return `Cache entries ${meta.cacheSize}`;
  }

  if (meta.configured === false) {
    return 'Not configured';
  }

  if (meta.configured === true && module.id === 'news-sentiment') {
    return 'Live keys configured';
  }

  if (Number.isFinite(meta.totalTrades)) {
    return `${meta.totalTrades} trades recorded`;
  }

  if (meta.enabled === false) {
    return 'Automation paused';
  }

  if (meta.detail) {
    return meta.detail;
  }

  return null;
};

const describeEngineState = (snapshot = {}) => {
  const { status, loading, error, updatedAt } = snapshot;
  const pairs = Array.isArray(status?.pairs) ? status.pairs.length : 0;
  const detail = updatedAt ? `Last sync ${formatRelativeTime(updatedAt)}` : 'Awaiting first telemetry sample';

  if (error) {
    return {
      state: 'critical',
      message: 'Engine telemetry error',
      detail: error
    };
  }

  if (loading && !status) {
    return {
      state: 'warning',
      message: 'Synchronising engine metrics',
      detail
    };
  }

  if (status?.enabled) {
    return {
      state: 'positive',
      message: 'Automation actively trading',
      detail: `${pairs} pairs monitored · ${detail}`
    };
  }

  if (status) {
    return {
      state: 'warning',
      message: 'Engine paused · awaiting resume',
      detail: `${pairs} pairs configured · ${detail}`
    };
  }

  return {
    state: 'warning',
    message: 'Engine status unavailable',
    detail
  };
};

const describeProviderAvailability = (availability = {}) => {
  if (availability.error) {
    return {
      state: 'critical',
      message: 'Provider telemetry unavailable',
      detail: availability.error
    };
  }

  if (availability.loading && !availability.providers?.length) {
    return {
      state: 'warning',
      message: 'Gathering provider telemetry',
      detail: 'Waiting for availability snapshot from core services'
    };
  }

  const providers = Array.isArray(availability.providers) ? availability.providers : [];
  const timeframes = Array.isArray(availability.timeframes) ? availability.timeframes : [];
  const classification = availability.classification || availability.latestClassification || null;

  if (!classification && providers.length === 0 && timeframes.length === 0) {
    return {
      state: 'warning',
      message: 'No provider telemetry captured yet',
      detail: 'Confirm server is broadcasting /api/health/providers snapshots'
    };
  }

  if (classification) {
    const severityToState = {
      critical: 'critical',
      warning: 'warning',
      info: 'positive'
    };
    const state = severityToState[classification.severity] || (classification.state === 'operational' ? 'positive' : 'warning');
    const message = classification.message || 'Provider availability update';

    const detailParts = [];
    const baseDetail = classification.detail || '';
    if (baseDetail) {
      detailParts.push(baseDetail);
    }

    const includeDetail = (text) => {
      if (!text) {
        return;
      }
      if (detailParts.includes(text)) {
        return;
      }
      if (baseDetail && baseDetail.includes(text)) {
        return;
      }
      detailParts.push(text);
    };

    const aggregateQuality = toNumber(classification.metrics?.aggregateQuality ?? availability.aggregateQuality);
    if (aggregateQuality != null) {
      includeDetail(`Quality ${aggregateQuality.toFixed(1)}%`);
    }

    const unavailable = Array.isArray(classification.context?.unavailableProviders)
      ? classification.context.unavailableProviders
      : [];
    if (unavailable.length > 0) {
      includeDetail(`Down: ${unavailable.join(', ')}`);
    }

    const breakers = Array.isArray(classification.context?.breakerProviders)
      ? classification.context.breakerProviders
      : [];
    if (breakers.length > 0) {
      includeDetail(`Breaker: ${breakers.join(', ')}`);
    }

    const blockedTimeframes = Array.isArray(classification.context?.blockedTimeframes)
      ? classification.context.blockedTimeframes
      : [];
    if (blockedTimeframes.length > 0) {
      includeDetail(`Blocked TF: ${blockedTimeframes.slice(0, 4).join(', ')}`);
    }

    if (availability.lastUpdated) {
      includeDetail(`Updated ${formatRelativeTime(availability.lastUpdated)}`);
    }

    if (Array.isArray(availability.history) && availability.history.length > 1) {
      includeDetail(`Samples retained ${availability.history.length}`);
    }

    const stats = availability.historyStats;
    if (stats && typeof stats === 'object') {
      if (typeof stats.uptimeRatio === 'number') {
        includeDetail(`Uptime ${(stats.uptimeRatio * 100).toFixed(1)}%`);
      }
      const recentIncidents = (stats.degradedLastHour || 0) + (stats.criticalLastHour || 0);
      if (recentIncidents > 0) {
        includeDetail(`Incidents 1h ${recentIncidents}`);
      } else {
        const totalIncidents = (stats.degradedSamples || 0) + (stats.criticalSamples || 0);
        if (totalIncidents > 0) {
          includeDetail(`Incidents ${totalIncidents}`);
        }
      }
    }

    if (availability.historyStorage?.persistenceEnabled) {
      includeDetail('Durable history active');
    }

    const detail = detailParts.filter(Boolean).join(' · ') || 'Provider telemetry steady';

    return { state, message, detail };
  }

  const activeProviders = providers.filter((entry) => entry && entry.disabled !== true);
  const unavailableProviders = activeProviders.filter((entry) => entry.available === false);
  const breakerProviders = activeProviders.filter((entry) => entry.circuitBreakerActive === true);
  const blockedTimeframes = timeframes.filter((entry) => entry && entry.viable === false);

  const aggregateQuality = toNumber(availability.aggregateQuality);
  const normalizedQuality = toNumber(availability.normalizedQuality);
  const qualityPercent = aggregateQuality != null ? aggregateQuality : (normalizedQuality != null ? normalizedQuality * 100 : null);

  const detailParts = [];

  if (unavailableProviders.length > 0) {
    detailParts.push(`Down: ${unavailableProviders.map((entry) => entry.provider).join(', ')}`);
  }

  if (breakerProviders.length > 0) {
    detailParts.push(`Breaker: ${breakerProviders.map((entry) => entry.provider).join(', ')}`);
  }

  if (blockedTimeframes.length > 0) {
    detailParts.push(`Blocked TF: ${blockedTimeframes.map((entry) => entry.timeframe).slice(0, 4).join(', ')}`);
  }

  const defaultReasons = availability.defaultAvailability?.reasons;
  if (Array.isArray(defaultReasons) && defaultReasons.length > 0) {
    detailParts.push(`Reasons: ${defaultReasons.slice(0, 3).join(', ')}`);
  }

  if (qualityPercent != null) {
    detailParts.push(`Quality ${qualityPercent.toFixed(1)}%`);
  }

  if (availability.lastUpdated) {
    detailParts.push(`Updated ${formatRelativeTime(availability.lastUpdated)}`);
  }

  if (availability.historyStats && typeof availability.historyStats.uptimeRatio === 'number') {
    detailParts.push(`Uptime ${(availability.historyStats.uptimeRatio * 100).toFixed(1)}%`);
  }

  if (Array.isArray(availability.history) && availability.history.length > 1) {
    detailParts.push(`Samples retained ${availability.history.length}`);
  }

  if (availability.historyStorage?.persistenceEnabled) {
    detailParts.push('Durable history active');
  }

  let state = 'positive';
  let message = 'Providers healthy';

  const activeCount = activeProviders.length;
  const unavailableCount = unavailableProviders.length;
  const blockedRatio = activeCount > 0 ? unavailableCount / activeCount : 0;
  const blockedTimeframeRatio = timeframes.length > 0 ? blockedTimeframes.length / timeframes.length : 0;

  if (activeCount > 0 && unavailableCount === activeCount) {
    state = 'critical';
    message = 'All providers offline';
  } else if (blockedTimeframeRatio >= 0.75 || blockedRatio >= 0.75) {
    state = 'critical';
    message = 'Provider coverage critically degraded';
  } else if (blockedTimeframeRatio > 0 || blockedRatio > 0 || breakerProviders.length > 0) {
    state = 'warning';
    message = 'Provider coverage degraded';
  }

  if (qualityPercent != null) {
    if (qualityPercent < 40) {
      state = 'critical';
      message = 'Data quality critically low';
    } else if (qualityPercent < 60 && state !== 'critical') {
      state = 'warning';
      message = 'Data quality deteriorating';
    }
  }

  const detail = detailParts.length > 0
    ? detailParts.join(' · ')
    : 'Awaiting detailed telemetry from health service';

  return { state, message, detail };
};

const describeDataFeeds = (featureSnapshots = []) => {
  const latestSnapshotTs = getLatestTimestamp(featureSnapshots, ['ts', 'timestamp', 'updatedAt']);
  const count = Array.isArray(featureSnapshots) ? featureSnapshots.length : 0;

  if (!count) {
    return {
      state: 'critical',
      message: 'Feature store empty',
      detail: 'Run ETL pipelines to hydrate analytics signals'
    };
  }

  if (!latestSnapshotTs) {
    return {
      state: 'warning',
      message: 'Feature feed present but stale',
      detail: 'Unable to determine last snapshot timestamp'
    };
  }

  const ageMinutes = (Date.now() - latestSnapshotTs) / 60000;
  if (ageMinutes <= 10) {
    return {
      state: 'positive',
      message: 'Feature feeds fresh',
      detail: `Latest snapshot ${formatRelativeTime(latestSnapshotTs)}`
    };
  }

  if (ageMinutes <= 60) {
    return {
      state: 'warning',
      message: 'Feature feeds ageing',
      detail: `Latest snapshot ${formatRelativeTime(latestSnapshotTs)}`
    };
  }

  return {
    state: 'critical',
    message: 'Feature feeds stale',
    detail: `Latest snapshot ${formatRelativeTime(latestSnapshotTs)}`
  };
};

const describeSignalFlow = (signals = [], events = []) => {
  const latestSignalTs = signals.length ? toTimestamp(signals[0].openedAt || signals[0].timestamp) : null;
  const signalCount = signals.length;

  const signalDetail = latestSignalTs
    ? `Most recent ${formatRelativeTime(latestSignalTs)} · ${signalCount} signals retained`
    : signalCount
      ? `${signalCount} signals retained`
      : 'No live signals captured yet';

  if (!signalCount) {
    const latestEvent = events.length ? toTimestamp(events[0].timestamp) : null;
    return {
      state: latestEvent ? 'neutral' : 'warning',
      message: latestEvent ? 'Awaiting first live signal' : 'No live activity detected',
      detail: latestEvent ? `Latest event ${formatRelativeTime(latestEvent)}` : 'Check engine connectivity and scoring model'
    };
  }

  if (!latestSignalTs) {
    return {
      state: 'warning',
      message: 'Signal timestamps unavailable',
      detail: signalDetail
    };
  }

  const ageMinutes = (Date.now() - latestSignalTs) / 60000;
  if (ageMinutes <= 5) {
    return {
      state: 'positive',
      message: 'Signals streaming in real-time',
      detail: signalDetail
    };
  }

  if (ageMinutes <= 30) {
    return {
      state: 'warning',
      message: 'Signal cadence slowing',
      detail: signalDetail
    };
  }

  return {
    state: 'critical',
    message: 'Signals stale',
    detail: signalDetail
  };
};

const describeActivity = (events = []) => {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      state: 'neutral',
      message: 'No operations logged yet',
      detail: 'Live event feed will populate as engine broadcasts activity'
    };
  }

  const latestEvent = toTimestamp(events[0].timestamp);
  const lastLabel = latestEvent ? formatRelativeTime(latestEvent) : 'unknown';
  const tradeEvents = events.filter((event) => {
    const type = String(event?.type || '').toLowerCase();
    return type.includes('trade');
  }).length;

  if (!latestEvent) {
    return {
      state: 'warning',
      message: 'Event timestamps missing',
      detail: 'Check WebSocket payload format'
    };
  }

  if (tradeEvents > 0) {
    return {
      state: 'positive',
      message: 'Active trade lifecycle detected',
      detail: `${tradeEvents} trade events · Last event ${lastLabel}`
    };
  }

  return {
    state: 'neutral',
    message: 'Events streaming · monitoring',
    detail: `Last event ${lastLabel}`
  };
};

function SystemHealthSummary({ snapshot, featureSnapshots, signals, events }) {
  const moduleHealth = useModuleHealth() || {};
  const providerAvailability = useProviderAvailability() || {};
  const overallRawState = moduleHealth?.overall?.state || null;
  const overallState = overallRawState ? normalizeModuleState(overallRawState) : null;
  const overallLabel = overallRawState
    ? overallRawState.charAt(0).toUpperCase() + overallRawState.slice(1)
    : null;
  const overallUpdatedAt = moduleHealth?.overall?.updatedAt || null;

  const items = useMemo(() => {
    const health = [];

    if (moduleHealth?.error) {
      health.push({
        id: 'module-health-error',
        label: 'Module Health API',
        state: 'critical',
        message: 'Health endpoint unavailable',
        detail: moduleHealth.error
      });
    }

    const modules = Array.isArray(moduleHealth?.modules) ? moduleHealth.modules : [];
    const moduleIds = new Set();

    if (modules.length > 0) {
      for (const module of modules) {
        const rawId = module.id || module.label || `module-${health.length}`;
        const moduleId = String(rawId).trim().toLowerCase().replace(/\s+/g, '-');
        if (module.id) {
          moduleIds.add(module.id);
        }
        health.push({
          id: `module-${moduleId}`,
          label: module.label || rawId,
          state: normalizeModuleState(module.state),
          message: module.detail || 'Status unknown',
          detail: describeModuleMeta(module)
        });
      }
    } else if (moduleHealth?.loading) {
      health.push({
        id: 'module-health-loading',
        label: 'Module Diagnostics',
        state: 'warning',
        message: 'Gathering module health',
        detail: 'Waiting for module heartbeat updates'
      });
    }

    const providerSummary = describeProviderAvailability(providerAvailability);
    if (providerSummary) {
      health.push({
        id: 'provider-availability',
        label: 'Provider Availability',
        ...providerSummary
      });
    }

    if (!moduleIds.has('signals')) {
      health.push({
        id: 'insight-engine',
        label: 'Engine Core',
        ...describeEngineState(snapshot)
      });
    }

    health.push({
      id: 'insight-features',
      label: 'Feature Store',
      ...describeDataFeeds(featureSnapshots)
    });

    health.push({
      id: 'insight-signals',
      label: 'Signal Stream',
      ...describeSignalFlow(signals, events)
    });

    const performance = classifyPerformance(snapshot?.statistics);
    health.push({
      id: 'insight-performance',
      label: 'Performance Baseline',
      ...performance
    });

    const activity = describeActivity(events);
    health.push({
      id: 'insight-activity',
      label: 'Operations Feed',
      ...activity
    });

    return health;
  }, [moduleHealth, providerAvailability, snapshot, featureSnapshots, signals, events]);

  return (
    <section className="panel panel--health" aria-live="polite">
      <div className="panel__header">
        <h2>System Health</h2>
        <p className="panel__hint">Real-time readiness across engine, data, and execution</p>
      </div>
      {overallLabel && (
        <div className="health-panel__overall">
          <span className={`health-pill health-pill--${overallState}`}>Overall · {overallLabel}</span>
          {overallUpdatedAt && (
            <span className="health-panel__meta">Updated {formatRelativeTime(overallUpdatedAt)}</span>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <div className="health-panel__empty">Health diagnostics unavailable</div>
      ) : (
        <ul className="health-panel__list">
          {items.map((item) => (
            <li key={item.id} className="health-panel__item">
              <span className={`health-pill health-pill--${item.state}`}>{item.label}</span>
              <div className="health-panel__details">
                <span className="health-panel__status">{item.message}</span>
                {item.detail && <span className="health-panel__meta">{item.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="health-panel__footnote">Health scoring adjusts automatically as telemetry updates and models improve.</p>
    </section>
  );
}

export default SystemHealthSummary;
