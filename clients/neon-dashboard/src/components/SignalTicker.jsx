import React, { useMemo } from 'react';
import { formatNumber, formatRelativeTime, formatDateTime } from '../utils/format.js';

const selectPricePrecision = (pair) => {
  if (!pair) {
    return 4;
  }
  if (pair.toUpperCase().includes('JPY')) {
    return 3;
  }
  if (pair.toUpperCase().includes('XAU') || pair.toUpperCase().includes('XAG')) {
    return 2;
  }
  return 5;
};

const formatRiskReward = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return '—';
  }
  if (numeric >= 1) {
    return `1:${numeric.toFixed(2)}`;
  }
  return `${numeric.toFixed(2)}:1`;
};

const resolveStatusVariant = (status) => {
  switch (status) {
    case 'OPEN':
    case 'ACTIVE':
    case 'LIVE':
      return 'positive';
    case 'CLOSED':
    case 'FILLED':
      return 'neutral';
    case 'REJECTED':
    case 'CANCELLED':
    case 'FAILED':
      return 'negative';
    default:
      return 'info';
  }
};

const toDisplayMetrics = (signals) => {
  const toPercentLabel = (value) => {
    if (value == null || Number.isNaN(Number(value))) {
      return '—';
    }
    const numeric = Number(value);
    const scaled = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${scaled.toFixed(0)}%`;
  };

  return signals.map((signal) => {
  const directionClass = signal.direction === 'BUY'
    ? 'long'
    : signal.direction === 'SELL'
      ? 'short'
      : 'neutral';

  const pricePrecision = selectPricePrecision(signal.pair);
  const entryLabel = formatNumber(signal.entryPrice, pricePrecision);
  const takeProfitLabel = formatNumber(signal.takeProfit, pricePrecision);
  const stopLossLabel = formatNumber(signal.stopLoss, pricePrecision);
  const riskRewardLabel = formatRiskReward(signal.riskReward);
  const strengthLabel = signal.strength != null ? Math.round(signal.strength) : '—';
  const confidenceLabel = toPercentLabel(signal.confidence);
  const winRateLabel = toPercentLabel(signal.winRate);
  const scoreLabel = signal.score != null ? Math.round(signal.score) : '—';
  const timeframeLabel = signal.timeframe ? signal.timeframe.toUpperCase() : null;
  const statusLabel = signal.status || 'PENDING';
  const statusVariant = resolveStatusVariant(statusLabel);
  const relativeTime = formatRelativeTime(signal.openedAt || signal.timestamp);
  const absoluteTime = formatDateTime(signal.openedAt || signal.timestamp);
  const profitBasis = Number.isFinite(signal.realizedPnl) ? signal.realizedPnl : signal.expectedPnl;
  const profitLabel = Number.isFinite(signal.realizedPnl) ? 'PNL' : 'EXP';
  const profitValue = profitBasis != null ? formatNumber(profitBasis, 2) : '—';
  const pnlVariant = profitBasis == null
    ? 'neutral'
    : profitBasis > 0
      ? 'positive'
      : profitBasis < 0
        ? 'negative'
        : 'neutral';

    return {
      ...signal,
      directionClass,
      entryLabel,
      takeProfitLabel,
      stopLossLabel,
      riskRewardLabel,
      strengthLabel,
      confidenceLabel,
      winRateLabel,
      scoreLabel,
      timeframeLabel,
      statusLabel,
      statusVariant,
      relativeTime,
      absoluteTime,
      profitLabel,
      profitValue,
      pnlVariant
    };
  });
};

function SignalTicker({ signals }) {
  const enrichedSignals = useMemo(() => toDisplayMetrics(signals), [signals]);

  if (!enrichedSignals.length) {
    return (
      <div className="signal-ticker signal-ticker--empty">
        <span className="signal-ticker__empty-label">Awaiting live trading signals…</span>
      </div>
    );
  }

  return (
    <div className="signal-ticker" role="list" aria-label="Latest trading signals">
      {enrichedSignals.map((signal) => (
        <article
          key={signal.id}
          className={`signal-ticker__item signal-ticker__item--${signal.directionClass}`}
          role="listitem"
        >
          <header className="signal-ticker__header">
            <div className="signal-ticker__identity">
              <span className="signal-ticker__pair">{signal.pair}</span>
              {signal.timeframeLabel && (
                <span className="signal-ticker__tag">{signal.timeframeLabel}</span>
              )}
            </div>
            <div className="signal-ticker__meta">
              <span
                className={`signal-ticker__status signal-ticker__status--${signal.statusVariant}`}
              >
                {signal.statusLabel}
              </span>
              <span className="signal-ticker__timestamp" title={signal.absoluteTime}>
                {signal.relativeTime}
              </span>
            </div>
          </header>

          <div className="signal-ticker__direction">
            <span className="signal-ticker__direction-label">{signal.direction}</span>
            {signal.strategy && (
              <span className="signal-ticker__strategy">{signal.strategy}</span>
            )}
          </div>

          <div className="signal-ticker__metrics signal-ticker__metrics--primary">
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">ENTRY</span>
              <span className="signal-ticker__metric-value">{signal.entryLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">TP</span>
              <span className="signal-ticker__metric-value">{signal.takeProfitLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">SL</span>
              <span className="signal-ticker__metric-value">{signal.stopLossLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">R:R</span>
              <span className="signal-ticker__metric-value">{signal.riskRewardLabel}</span>
            </span>
            <span
              className={`signal-ticker__metric signal-ticker__metric--pnl signal-ticker__metric--${signal.pnlVariant}`}
              title={signal.profitLabel === 'PNL' ? 'Realized PnL' : 'Expected PnL'}
            >
              <span className="signal-ticker__metric-label">{signal.profitLabel}</span>
              <span className="signal-ticker__metric-value">{signal.profitValue}</span>
            </span>
          </div>

          <div className="signal-ticker__metrics signal-ticker__metrics--secondary">
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">STRENGTH</span>
              <span className="signal-ticker__metric-value">{signal.strengthLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">CONF</span>
              <span className="signal-ticker__metric-value">{signal.confidenceLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">WIN%</span>
              <span className="signal-ticker__metric-value">{signal.winRateLabel}</span>
            </span>
            <span className="signal-ticker__metric">
              <span className="signal-ticker__metric-label">SCORE</span>
              <span className="signal-ticker__metric-value">{signal.scoreLabel}</span>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

export default SignalTicker;
