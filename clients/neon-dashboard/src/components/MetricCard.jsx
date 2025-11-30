import React from 'react';

const trendClassName = (trend) => {
  const numeric = Number(trend);
  if (Number.isNaN(numeric)) {
    return 'metric-card__trend metric-card__trend--flat';
  }
  if (numeric > 0) {
    return 'metric-card__trend metric-card__trend--up';
  }
  if (numeric < 0) {
    return 'metric-card__trend metric-card__trend--down';
  }
  return 'metric-card__trend metric-card__trend--flat';
};

const trendLabel = (trend, label) => {
  const numeric = Number(trend);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return label ?? 'No change';
  }
  const sign = numeric > 0 ? '+' : '';
  return label || `${sign}${numeric.toFixed(2)}%`;
};

const MetricCard = ({
  title,
  value,
  accent,
  subtitle,
  trend,
  trendLabelText,
  footer
}) => (
  <article className={`metric-card${accent ? ` metric-card--${accent}` : ''}`}>
    <header className="metric-card__header">
      <h3>{title}</h3>
      {subtitle && <span className="metric-card__subtitle">{subtitle}</span>}
    </header>
    <div className="metric-card__value">{value}</div>
    {trend !== undefined && trend !== null && (
      <div className={trendClassName(trend)}>{trendLabel(trend, trendLabelText)}</div>
    )}
    {footer && <footer className="metric-card__footer">{footer}</footer>}
  </article>
);

export default MetricCard;
