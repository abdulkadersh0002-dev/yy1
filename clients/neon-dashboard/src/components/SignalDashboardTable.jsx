import React, { useEffect, useMemo, useState } from 'react';
import {
  formatNumber,
  formatRelativeTime,
  formatDirection,
  formatDateTime
} from '../utils/format.js';

const selectPricePrecision = (pair) => {
  if (!pair) {
    return 4;
  }
  const normalized = String(pair).toUpperCase();
  if (normalized.includes('JPY')) {
    return 3;
  }
  if (normalized.includes('XAU') || normalized.includes('XAG')) {
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

const toPercentLabel = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—';
  }
  const numeric = Number(value);
  const scaled = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${scaled.toFixed(0)}%`;
};

const formatLayerStatus = (status) => {
  const s = String(status || '').toUpperCase();
  if (s === 'PASS') {
    return 'PASS';
  }
  if (s === 'FAIL') {
    return 'FAIL';
  }
  return 'SKIP';
};

const formatConfluenceScore = (confluence) => {
  const score = Number(confluence?.score);
  if (!Number.isFinite(score)) {
    return '—';
  }
  return `${Math.round(score)}%`;
};

const formatLayer18Score = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  // Keep a compact but readable precision for layer scores.
  return Math.abs(numeric) >= 100 ? numeric.toFixed(0) : numeric.toFixed(2);
};

function SignalDashboardTable({
  signals = [],
  snapshots = [],
  selectedId,
  onSelect,
  mode = 'strong',
  emptyDetails,
  emptyTitle
}) {
  const [ageTick, setAgeTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setAgeTick((value) => (value + 1) % 1000000);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    if (!Array.isArray(signals) || signals.length === 0) {
      return [];
    }

    const snapshotMap = new Map();
    const snapshotPairFallback = new Map();
    const snapshotsSource = Array.isArray(snapshots) ? snapshots : [];

    for (const snapshot of snapshotsSource) {
      if (!snapshot?.pair) {
        continue;
      }
      const pair = String(snapshot.pair).toUpperCase();
      const timeframe = snapshot.timeframe ? String(snapshot.timeframe).toUpperCase() : '';
      const key = `${pair}:${timeframe}`;
      const ts = snapshot.ts ?? snapshot.timestamp ?? snapshot.updatedAt ?? null;

      const existing = snapshotMap.get(key);
      const existingTs = existing?.ts ?? existing?.timestamp ?? existing?.updatedAt ?? null;
      const numericTs = typeof ts === 'number' ? ts : Date.parse(String(ts || ''));
      const numericExisting =
        typeof existingTs === 'number' ? existingTs : Date.parse(String(existingTs || ''));
      if (!existing || (Number(numericTs) || 0) > (Number(numericExisting) || 0)) {
        snapshotMap.set(key, snapshot);
      }

      const existingPair = snapshotPairFallback.get(pair);
      const existingPairTs =
        existingPair?.ts ?? existingPair?.timestamp ?? existingPair?.updatedAt ?? null;
      const numericPairExisting =
        typeof existingPairTs === 'number'
          ? existingPairTs
          : Date.parse(String(existingPairTs || ''));
      if (!existingPair || (Number(numericTs) || 0) > (Number(numericPairExisting) || 0)) {
        snapshotPairFallback.set(pair, snapshot);
      }
    }

    return signals.filter(Boolean).map((signal) => {
      const pair = signal.pair || 'N/A';
      const timeframe = signal.timeframe ? String(signal.timeframe).toUpperCase() : '—';
      const direction = formatDirection(signal.direction);
      const dirClass = direction === 'BUY' ? 'long' : direction === 'SELL' ? 'short' : 'neutral';

      const ts = signal.openedAt || signal.timestamp || signal.createdAt;
      const ageLabel = formatRelativeTime(ts);

      const entry = signal.entryPrice ?? signal.entry?.price ?? null;
      const takeProfit = signal.takeProfit ?? signal.entry?.takeProfit ?? null;
      const stopLoss = signal.stopLoss ?? signal.entry?.stopLoss ?? null;
      const riskReward = signal.riskReward ?? signal.entry?.riskReward ?? null;
      const atr = signal.atr ?? signal.entry?.atr ?? null;

      const technical = signal.components?.technical?.signals?.[0] || null;
      const netBias =
        technical?.bias ?? technical?.signal ?? technical?.direction ?? technical?.type ?? null;
      const techTimeframe = technical?.timeframe ?? technical?.timeFrame ?? null;
      const techScore = technical?.strength ?? technical?.score ?? null;

      const precision = selectPricePrecision(pair);

      const snapKey = `${String(pair).toUpperCase()}:${timeframe === '—' ? '' : timeframe}`;
      const snapshot =
        snapshotMap.get(snapKey) || snapshotPairFallback.get(String(pair).toUpperCase()) || null;

      const snapshotFeatures = snapshot?.features || {};
      const snapshotTs = snapshot?.ts ?? snapshot?.timestamp ?? snapshot?.updatedAt ?? null;

      const signalTechnical = signal.components?.technical || {};
      const signalTrend = signalTechnical.trend || null;
      const signalRegime = signalTechnical.regime?.state || signalTechnical.regimeState || null;
      const signalVolatility =
        signal.entry?.volatilityState || signalTechnical.volatility?.state || null;

      const snapshotDirection = formatDirection(
        snapshotFeatures.direction ??
          snapshotFeatures.signal ??
          snapshotFeatures.bias ??
          signalTechnical.direction
      );
      const snapshotDirClass =
        snapshotDirection === 'BUY' ? 'long' : snapshotDirection === 'SELL' ? 'short' : 'neutral';
      const snapshotScore =
        snapshotFeatures.score ??
        snapshotFeatures.strength ??
        snapshotFeatures.confidence ??
        signalTechnical.score;

      const snapshotRegime =
        snapshotFeatures.regime?.state ??
        snapshotFeatures.regimeState ??
        snapshotFeatures.marketState ??
        signalRegime ??
        signalTrend;

      const snapshotVolatility =
        snapshotFeatures.volatility?.state ?? snapshotFeatures.volatilityState ?? signalVolatility;

      const confluence = signal.components?.confluence || null;
      const layeredAnalysis = signal.components?.layeredAnalysis || null;
      const layers = Array.isArray(confluence?.layers) ? confluence.layers : [];
      const evaluated = layers.filter((l) => String(l?.status || '').toUpperCase() !== 'SKIP');
      const fails = evaluated.filter((l) => String(l?.status || '').toUpperCase() === 'FAIL');
      const passCount = evaluated.filter(
        (l) => String(l?.status || '').toUpperCase() === 'PASS'
      ).length;
      const failCount = fails.length;
      const layerCount = layers.length;
      const confluenceVariant = failCount > 0 ? 'fail' : passCount > 0 ? 'pass' : 'neutral';
      const confluenceLabel = formatConfluenceScore(confluence);
      const confluenceMin = Number(confluence?.minScore);
      const confluenceMinLabel = Number.isFinite(confluenceMin)
        ? `${Math.round(confluenceMin)}%`
        : '—';

      return {
        id: signal.id || `${pair}-${timeframe}-${ts || Math.random()}`,
        raw: signal,
        pair,
        timeframe,
        status: (() => {
          const expiresAt = Number(signal?.expiresAt ?? signal?.validity?.expiresAt);
          if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
            return 'EXPIRED';
          }
          const base = signal.signalStatus || signal.status || 'PENDING';
          return String(base).toUpperCase();
        })(),
        ageLabel,
        direction,
        dirClass,
        entryLabel: formatNumber(entry, precision),
        takeProfitLabel: formatNumber(takeProfit, precision),
        stopLossLabel: formatNumber(stopLoss, precision),
        riskRewardLabel: formatRiskReward(riskReward),
        atrLabel:
          atr !== undefined && atr !== null && !Number.isNaN(Number(atr))
            ? formatNumber(atr, 4)
            : '—',
        netBiasLabel: netBias ? String(netBias).toUpperCase() : '—',
        techTimeframeLabel: techTimeframe ? String(techTimeframe).toUpperCase() : '—',
        techScoreLabel:
          techScore !== undefined && techScore !== null && !Number.isNaN(Number(techScore))
            ? Math.round(Number(techScore))
            : '—',
        confidenceLabel: toPercentLabel(signal.confidence),
        strengthLabel: signal.strength != null ? Math.round(Number(signal.strength)) : '—',
        scoreLabel: signal.score != null ? Math.round(Number(signal.score)) : '—',
        featureUpdatedLabel: snapshotTs
          ? formatDateTime(snapshotTs)
          : ts
            ? formatDateTime(ts)
            : '—',
        featureDirection: snapshotDirection || '—',
        featureDirClass: snapshotDirection ? snapshotDirClass : 'neutral',
        featureScoreLabel:
          snapshotScore !== undefined &&
          snapshotScore !== null &&
          !Number.isNaN(Number(snapshotScore))
            ? Number(snapshotScore).toFixed(2)
            : '—',
        featureRegimeLabel: snapshotRegime ? String(snapshotRegime).toUpperCase() : '—',
        featureVolatilityLabel: snapshotVolatility ? String(snapshotVolatility).toUpperCase() : '—',
        confluence,
        layeredAnalysis,
        confluenceLabel,
        confluenceMinLabel,
        confluenceVariant,
        confluenceLayerCount: layerCount,
        confluenceFailCount: failCount
      };
    });
  }, [ageTick, signals, snapshots]);

  const isStrongMode = String(mode || '').toLowerCase() === 'strong';

  if (!rows.length) {
    return (
      <table className="signal-dashboard__table" aria-label="Trading signals">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Timeframe</th>
            <th>Age</th>
            <th>Dir</th>
            <th>Entry</th>
            <th>SL</th>
            <th>TP</th>
            <th>R:R</th>
            <th>Layers</th>
            <th>Conf</th>
            <th>Strength</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan="11" className="cell--empty">
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 650 }}>
                  {emptyTitle
                    ? String(emptyTitle)
                    : isStrongMode
                      ? 'No strong trade signals right now.'
                      : 'No trade signals to show right now.'}
                </div>
                {emptyDetails ? (
                  <div style={{ opacity: 0.85, lineHeight: 1.35 }}>{String(emptyDetails)}</div>
                ) : null}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table className="signal-dashboard__table" aria-label="Trading signals">
      <thead>
        <tr>
          <th>Pair</th>
          <th>Timeframe</th>
          {!isStrongMode && <th>Status</th>}
          <th>Age</th>
          <th>Dir</th>
          <th>Entry</th>
          <th>SL</th>
          <th>TP</th>
          <th>R:R</th>
          <th>Layers</th>
          {!isStrongMode && <th>ATR</th>}
          {!isStrongMode && <th>Net Bias</th>}
          {!isStrongMode && <th>Tech TF</th>}
          {!isStrongMode && <th>Tech Score</th>}
          <th>Conf</th>
          <th>Strength</th>
          {!isStrongMode && <th>Score</th>}
          {!isStrongMode && <th>Feat Updated</th>}
          {!isStrongMode && <th>Feat Dir</th>}
          {!isStrongMode && <th>Feat Score</th>}
          {!isStrongMode && <th>Regime</th>}
          {!isStrongMode && <th>Vol</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isSelected = selectedId && row.id === selectedId;
          return (
            <React.Fragment key={row.id}>
              <tr
                className={`signal-dashboard__row ${isSelected ? 'signal-dashboard__row--selected' : ''}`}
                onClick={() => onSelect?.(row.raw, row.id)}
                role="row"
                aria-selected={isSelected}
              >
                <td>{row.pair}</td>
                <td>{row.timeframe}</td>
                {!isStrongMode && <td>{row.status}</td>}
                <td>{row.ageLabel}</td>
                <td>
                  <span
                    className={`signal-dashboard__direction signal-dashboard__direction--${row.dirClass}`}
                  >
                    {row.direction}
                  </span>
                </td>
                <td>{row.entryLabel}</td>
                <td>{row.stopLossLabel}</td>
                <td>{row.takeProfitLabel}</td>
                <td>{row.riskRewardLabel}</td>
                <td>
                  <span
                    title={`Min ${row.confluenceMinLabel} | ${row.confluenceLayerCount} layers | ${row.confluenceFailCount} fails`}
                    style={{
                      fontWeight: 600,
                      color:
                        row.confluenceVariant === 'fail'
                          ? 'var(--danger, #d14343)'
                          : row.confluenceVariant === 'pass'
                            ? 'var(--success, #2eaa6a)'
                            : 'inherit'
                    }}
                  >
                    {row.confluenceLabel}
                  </span>
                </td>
                {!isStrongMode && <td>{row.atrLabel}</td>}
                {!isStrongMode && <td>{row.netBiasLabel}</td>}
                {!isStrongMode && <td>{row.techTimeframeLabel}</td>}
                {!isStrongMode && <td>{row.techScoreLabel}</td>}
                <td>{row.confidenceLabel}</td>
                <td>{row.strengthLabel}</td>
                {!isStrongMode && <td>{row.scoreLabel}</td>}
                {!isStrongMode && <td>{row.featureUpdatedLabel}</td>}
                {!isStrongMode && (
                  <td>
                    <span
                      className={`signal-dashboard__direction signal-dashboard__direction--${row.featureDirClass}`}
                    >
                      {row.featureDirection}
                    </span>
                  </td>
                )}
                {!isStrongMode && <td>{row.featureScoreLabel}</td>}
                {!isStrongMode && <td>{row.featureRegimeLabel}</td>}
                {!isStrongMode && <td>{row.featureVolatilityLabel}</td>}
              </tr>

              {isSelected && row.layeredAnalysis && Array.isArray(row.layeredAnalysis.layers) && (
                <tr className="signal-dashboard__row signal-dashboard__row--details">
                  <td colSpan={isStrongMode ? 11 : 22} style={{ padding: '10px 12px' }}>
                    <details open>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                        18 Layers — Full Analysis
                      </summary>
                      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                        {row.layeredAnalysis.layers.map((layer) => {
                          const layerNo = Number(layer?.layer);
                          const label = layer?.nameEn || layer?.key || `L${layerNo || '—'}`;
                          const arrow = layer?.arrow || '•';
                          const dir = layer?.direction || 'NEUTRAL';
                          const conf =
                            layer?.confidence !== undefined && layer?.confidence !== null
                              ? `${layer.confidence}%`
                              : '—';
                          const scoreLabel = formatLayer18Score(layer?.score);
                          const score = scoreLabel != null ? ` · ${scoreLabel}` : '';
                          const summary = layer?.summaryEn ? String(layer.summaryEn) : '';

                          return (
                            <div
                              key={layer?.key || `${label}-${layerNo}`}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(220px, 1fr) minmax(140px, 220px)',
                                gap: 10,
                                alignItems: 'baseline',
                                fontSize: 13
                              }}
                            >
                              <div style={{ fontWeight: 650 }}>
                                {layer?.key || `L${layerNo}`} · {label}
                              </div>
                              <div
                                style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {arrow} {dir} · {conf}
                                {score}
                              </div>
                              {summary ? (
                                <div
                                  style={{
                                    gridColumn: '1 / -1',
                                    opacity: 0.85,
                                    fontSize: 12,
                                    lineHeight: 1.35
                                  }}
                                >
                                  {summary}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </td>
                </tr>
              )}

              {isSelected &&
                (!row.layeredAnalysis || !Array.isArray(row.layeredAnalysis.layers)) &&
                row.confluence &&
                Array.isArray(row.confluence.layers) && (
                  <tr className="signal-dashboard__row signal-dashboard__row--details">
                    <td colSpan={isStrongMode ? 11 : 22} style={{ padding: '10px 12px' }}>
                      <details open>
                        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                          Analysis Layers ({row.confluenceLayerCount}) — Score {row.confluenceLabel}{' '}
                          (min {row.confluenceMinLabel})
                        </summary>
                        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                          {row.confluence.layers.map((layer, idx) => {
                            const status = formatLayerStatus(layer?.status);
                            const reason = layer?.reason ? String(layer.reason) : '';
                            return (
                              <div
                                key={`${String(layer?.id || 'layer')}-${idx}`}
                                style={{
                                  display: 'flex',
                                  gap: 10,
                                  alignItems: 'baseline',
                                  fontSize: 13,
                                  opacity: status === 'SKIP' ? 0.7 : 1
                                }}
                              >
                                <span
                                  style={{
                                    minWidth: 44,
                                    fontWeight: 700,
                                    color:
                                      status === 'FAIL'
                                        ? 'var(--danger, #d14343)'
                                        : status === 'PASS'
                                          ? 'var(--success, #2eaa6a)'
                                          : 'inherit'
                                  }}
                                >
                                  {status}
                                </span>
                                <span style={{ minWidth: 220, fontWeight: 600 }}>
                                  {layer?.label || layer?.id || `Layer ${idx + 1}`}
                                </span>
                                <span style={{ opacity: 0.9 }}>{reason || '—'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default SignalDashboardTable;
