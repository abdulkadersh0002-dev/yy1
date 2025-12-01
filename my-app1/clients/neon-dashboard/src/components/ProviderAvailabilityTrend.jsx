import React, { useMemo } from 'react';
import StatusPill from './StatusPill.jsx';
import { useProviderAvailability } from '../context/ProviderAvailabilityContext.jsx';

const SLO_TARGET_PERCENT = 99.0;
const WARN_MARGIN_PERCENT = 0.5;

const clamp01 = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const qualityFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const formatPercent = (value) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${percentFormatter.format(value)}%`;
};

const formatRelativeTime = (timestamp, now) => {
  if (!Number.isFinite(timestamp)) {
    return 'None recorded';
  }
  const delta = Math.max(0, now - timestamp);
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const mapStateToValue = (state) => {
  const normalized = typeof state === 'string' ? state.toLowerCase() : state;
  switch (normalized) {
    case 'operational':
      return 1;
    case 'degraded':
      return 0.55;
    case 'critical':
      return 0.1;
    default:
      return 0.4;
  }
};

const buildSparkline = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      hasData: false,
      points: '',
      areaPoints: '',
      markers: []
    };
  }

  const sliceLimit = Math.min(history.length, 60);
  const samples = history.slice(-sliceLimit);
  const values = samples.map((entry) => {
    const normalizedQuality = clamp01(Number(entry?.normalizedQuality));
    if (normalizedQuality != null) {
      return normalizedQuality;
    }
    const aggregateQuality = Number(entry?.aggregateQuality);
    if (Number.isFinite(aggregateQuality)) {
      return clamp01(aggregateQuality / 100);
    }
    return mapStateToValue(entry?.state);
  });

  if (!values.some((value) => Number.isFinite(value))) {
    return {
      hasData: false,
      points: '',
      areaPoints: '',
      markers: []
    };
  }

  const height = 40;
  const width = 100;
  const paddingTop = 4;
  const paddingBottom = 6;
  const usableHeight = height - paddingTop - paddingBottom;

  const points = values.map((value, index) => {
    const numeric = Number.isFinite(value) ? value : 0;
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = paddingTop + (1 - numeric) * usableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  const areaPoints = `${points} ${width},${height - paddingBottom} 0,${height - paddingBottom}`;

  const markers = samples
    .map((entry, index) => {
      const state = typeof entry?.state === 'string' ? entry.state.toLowerCase() : 'unknown';
      if (state !== 'critical' && state !== 'degraded') {
        return null;
      }
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const numeric = Number.isFinite(values[index]) ? values[index] : mapStateToValue(state);
      const y = paddingTop + (1 - numeric) * usableHeight;
      return {
        key: `${entry?.timestamp || index}-${state}`,
        x,
        y,
        state
      };
    })
    .filter(Boolean);

  return {
    hasData: true,
    points,
    areaPoints,
    markers,
    viewBox: `0 0 ${width} ${height}`
  };
};

function ProviderAvailabilityTrend() {
  const availability = useProviderAvailability() || {};
  const {
    history,
    historyStats,
    latestClassification,
    historyLimit,
    historyStorage
  } = availability;

  const now = Date.now();
  const sparkline = useMemo(() => buildSparkline(history), [history]);

  const uptimeRatio = Number.isFinite(historyStats?.uptimeRatio)
    ? historyStats.uptimeRatio * 100
    : null;
  const averageQuality = Number.isFinite(historyStats?.averageAggregateQuality)
    ? historyStats.averageAggregateQuality
    : null;

  const incidentsLastHour = (historyStats?.degradedLastHour || 0) + (historyStats?.criticalLastHour || 0);
  const totalIncidents = (historyStats?.degradedSamples || 0) + (historyStats?.criticalSamples || 0);

  const lastCriticalLabel = historyStats?.lastCriticalAt
    ? formatRelativeTime(historyStats.lastCriticalAt, now)
    : 'None recorded';
  const lastDegradedLabel = historyStats?.lastDegradedAt
    ? formatRelativeTime(historyStats.lastDegradedAt, now)
    : 'None recorded';

  const samplesStored = Array.isArray(history) ? history.length : 0;
  const storageLabel = historyStorage?.persistenceEnabled ? 'TimescaleDB' : 'In-memory';

  const sloState = (() => {
    if (!Number.isFinite(uptimeRatio)) {
      return 'pending';
    }
    if (uptimeRatio >= SLO_TARGET_PERCENT) {
      return 'pass';
    }
    if (uptimeRatio >= SLO_TARGET_PERCENT - WARN_MARGIN_PERCENT) {
      return 'warn';
    }
    return 'fail';
  })();

  const sloLabel = (() => {
    switch (sloState) {
      case 'pass':
        return 'SLO met';
      case 'warn':
        return 'SLO at risk';
      case 'fail':
        return 'SLO breached';
      default:
        return 'SLO pending';
    }
  })();

  const sloBadgeClass = `provider-trend__slo-badge provider-trend__slo-badge--${sloState}`;
  const uptimeLabel = uptimeRatio == null ? '—' : formatPercent(uptimeRatio);
  const qualityLabel = averageQuality == null ? '—' : `${qualityFormatter.format(averageQuality)}%`;
  const incidentLabel = incidentsLastHour > 0
    ? `${incidentsLastHour} (total ${totalIncidents})`
    : `${incidentsLastHour}`;
  const windowMinutes = Number.isFinite(historyStats?.windowMs)
    ? Math.round(historyStats.windowMs / 60000)
    : null;
  const windowLabel = windowMinutes && windowMinutes > 0
    ? `Coverage window · ${windowMinutes}m`
    : historyLimit
      ? `Samples stored · ${samplesStored}/${historyLimit}`
      : `Samples stored · ${samplesStored}`;

  const latestState = latestClassification?.state || availability.classification?.state || null;
  const stateLabel = latestState ? latestState.toUpperCase() : 'UNKNOWN';

  return (
    <article className="provider-trend-card">
      <header className="provider-trend-card__header">
        <div>
          <h2 className="provider-trend-card__title">Provider Availability SLO</h2>
          <p className="provider-trend-card__subtitle">{windowLabel}</p>
        </div>
        <div className="provider-trend-card__badges">
          <span className={sloBadgeClass}>{sloLabel}</span>
          <span className="provider-trend__target">≥ {formatPercent(SLO_TARGET_PERCENT)}</span>
          <StatusPill state={latestState} label={stateLabel} />
        </div>
      </header>

      <div className={`provider-trend-card__sparkline${sparkline.hasData ? '' : ' provider-trend-card__sparkline--empty'}`}>
        {sparkline.hasData ? (
          <svg viewBox={sparkline.viewBox} preserveAspectRatio="none">
            <defs>
              <linearGradient id="provider-trend-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(56, 242, 255, 0.28)" />
                <stop offset="100%" stopColor="rgba(56, 242, 255, 0.04)" />
              </linearGradient>
            </defs>
            <polygon points={sparkline.areaPoints} fill="url(#provider-trend-gradient)" />
            <polyline points={sparkline.points} fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {sparkline.markers.map((marker) => (
              <circle
                key={marker.key}
                cx={marker.x}
                cy={marker.y}
                r={marker.state === 'critical' ? 1.9 : 1.5}
                className={`provider-trend-card__marker provider-trend-card__marker--${marker.state}`}
              />
            ))}
          </svg>
        ) : (
          <span className="provider-trend-card__sparkline-placeholder">Awaiting availability telemetry</span>
        )}
      </div>

      <dl className="provider-trend-card__stats">
        <div>
          <dt>Uptime ratio</dt>
          <dd>{uptimeLabel}</dd>
        </div>
        <div>
          <dt>Avg quality</dt>
          <dd>{qualityLabel}</dd>
        </div>
        <div>
          <dt>Incidents (1h)</dt>
          <dd>{incidentLabel}</dd>
        </div>
        <div>
          <dt>Last degraded</dt>
          <dd>{lastDegradedLabel}</dd>
        </div>
        <div>
          <dt>Last critical</dt>
          <dd>{lastCriticalLabel}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{`${storageLabel} · ${samplesStored}${historyLimit ? `/${historyLimit}` : ''}`}</dd>
        </div>
      </dl>
    </article>
  );
}

export default ProviderAvailabilityTrend;
