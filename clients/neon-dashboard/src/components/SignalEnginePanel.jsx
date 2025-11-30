import React, { useMemo } from 'react';
import StatusPill from './StatusPill.jsx';
import { formatNumber, formatPercent, formatSignedPercent, formatRelativeTime } from '../utils/format.js';
import { useModuleHealth } from '../context/ModuleHealthContext.jsx';

const toNumeric = (value) => {
  if (value == null) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const buildMetrics = (status, statistics) => {
  if (!status && !statistics) {
    return [];
  }

  const stats = statistics || {};
  const pairsCount = Array.isArray(status?.pairs) ? status.pairs.length : null;
  const metrics = [
    {
      id: 'pairs',
      label: 'Pairs Monitored',
      value: pairsCount != null ? formatNumber(pairsCount, 0) : '—',
      hint: status?.pairs?.slice(0, 6).join(' | ') || null
    },
    {
      id: 'max-trades',
      label: 'Max Concurrent Trades',
      value: status?.maxTrades != null ? formatNumber(status.maxTrades, 0) : '—'
    },
    {
      id: 'total-trades',
      label: 'Closed Trades',
      value: stats.totalTrades != null ? formatNumber(stats.totalTrades, 0) : '—'
    },
    {
      id: 'win-rate',
      label: 'Win Rate',
      value: stats.winRate != null ? formatPercent(toNumeric(stats.winRate), 2) : '—'
    },
    {
      id: 'total-pnl',
      label: 'Net PnL',
      value: stats.totalPnL != null ? formatSignedPercent(toNumeric(stats.totalPnL), 2) : '—'
    },
    {
      id: 'profit-factor',
      label: 'Profit Factor',
      value: stats.profitFactor != null ? formatNumber(toNumeric(stats.profitFactor), 2) : '—'
    },
    {
      id: 'daily-risk',
      label: 'Daily Risk Used',
      value: stats.dailyRiskUsed != null ? formatPercent(toNumeric(stats.dailyRiskUsed), 2) : '—'
    }
  ];

  return metrics.filter(Boolean).slice(0, 6);
};

function SignalEnginePanel({ snapshot }) {
  const {
    status,
    statistics,
    updatedAt,
    loading,
    error
  } = snapshot || {};

  const { modulesById, loading: moduleHealthLoading, error: moduleHealthError } = useModuleHealth();
  const engineModuleHealth = modulesById?.signals;

  const healthNotice = useMemo(() => {
    if (moduleHealthError) {
      return `Module health diagnostics unavailable · ${moduleHealthError}`;
    }
    if (!engineModuleHealth || moduleHealthLoading) {
      return null;
    }
    const normalizedState = String(engineModuleHealth.state || '').toLowerCase();
    if (normalizedState === 'critical') {
      const detail = engineModuleHealth.detail || 'Signal engine offline – awaiting recovery';
      return `Signal engine offline · ${detail}`;
    }
    if (normalizedState === 'degraded') {
      const detail = engineModuleHealth.detail || 'Signal engine running in degraded mode';
      return `Signal engine degraded · ${detail}`;
    }
    return null;
  }, [engineModuleHealth, moduleHealthError, moduleHealthLoading]);

  const automationState = status?.enabled ? 'running' : status ? 'stopped' : 'unknown';
  const automationLabel = status?.enabled ? 'RUNNING' : status ? 'PAUSED' : 'PENDING';

  const metrics = useMemo(() => buildMetrics(status, statistics), [status, statistics]);

  const updatedLabel = updatedAt ? formatRelativeTime(updatedAt) : 'Awaiting data';

  return (
    <section className="engine-panel" aria-live="polite">
      <header className="engine-panel__header">
        <div>
          <h2 className="engine-panel__title">Signal Engine</h2>
          <p className="engine-panel__subtitle">Core telemetry from the automated signal processor</p>
        </div>
        <div className="engine-panel__status">
          <StatusPill state={automationState} label={automationLabel} />
          <span className="engine-panel__timestamp">{updatedLabel}</span>
        </div>
      </header>

      {healthNotice && !error && (
        <div className="engine-panel__alert">{healthNotice}</div>
      )}
      {error && <div className="engine-panel__alert">{error}</div>}
      {loading && !metrics.length && !error && (
        <div className="engine-panel__alert engine-panel__alert--muted">Synchronising engine metrics…</div>
      )}

      {metrics.length > 0 && (
        <div className="engine-panel__metrics">
          {metrics.map((metric) => (
            <article key={metric.id} className="engine-panel__metric">
              <span className="engine-panel__metric-label">{metric.label}</span>
              <span className="engine-panel__metric-value">{metric.value}</span>
              {metric.hint && <span className="engine-panel__metric-hint">{metric.hint}</span>}
            </article>
          ))}
        </div>
      )}
      {!metrics.length && !loading && !error && (
        <div className="engine-panel__alert engine-panel__alert--muted">
          Engine telemetry unavailable – waiting for live data.
        </div>
      )}
    </section>
  );
}

export default SignalEnginePanel;
