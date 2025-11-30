import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { postJson } from '../utils/api.js';
import { formatNumber, formatPercent, formatDateTime } from '../utils/format.js';

const NA_LABEL = 'N/A';

const FALLBACK_PAIRS = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
  'USDCAD',
  'NZDUSD',
  'USDCHF',
  'EURJPY',
  'GBPJPY'
];

const toNumber = (value) => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const buildSummary = (signal) => {
  if (!signal) {
    return null;
  }

  const technical = signal.components?.technical?.signals?.[0] || null;
  const entry = signal.entry || {};

  return {
    pair: signal.pair,
    direction: String(signal.direction || 'NEUTRAL').toUpperCase(),
    strategy: signal.strategy || signal.meta?.strategy || null,
    generatedAt: signal.generatedAt || signal.createdAt || signal.timestamp || null,
    confidence: toNumber(signal.confidence),
    strength: toNumber(signal.strength),
    winRate: toNumber(signal.estimatedWinRate || signal.winRate),
    finalScore: toNumber(signal.finalScore || signal.score),
    entryPrice: toNumber(entry.price || signal.entryPrice),
    stopLoss: toNumber(entry.stopLoss || signal.stopLoss),
    takeProfit: toNumber(entry.takeProfit || signal.takeProfit),
    riskReward: toNumber(entry.riskReward || signal.riskReward),
    atr: toNumber(entry.atr || signal.atr),
    technical
  };
};

const formatRiskReward = (value) => {
  if (!value || Number.isNaN(Number(value))) {
    return NA_LABEL;
  }
  const numeric = Number(value);
  if (numeric >= 1) {
    return `1:${numeric.toFixed(2)}`;
  }
  return `${numeric.toFixed(2)}:1`;
};

function SignalEngineConsole({ pairs, onSignalGenerated }) {
  const [selectedPair, setSelectedPair] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const sanitizedPairs = useMemo(() => {
    if (Array.isArray(pairs) && pairs.length > 0) {
      return [...pairs]
        .filter(Boolean)
        .map((pair) => String(pair).toUpperCase());
    }
    return FALLBACK_PAIRS;
  }, [pairs]);

  useEffect(() => {
    if (!selectedPair && sanitizedPairs.length > 0) {
      setSelectedPair(sanitizedPairs[0]);
    }
  }, [sanitizedPairs, selectedPair]);

  const handleGenerate = useCallback(async () => {
    if (!selectedPair) {
      setError('Select a trading pair first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await postJson('/api/signal/generate', { pair: selectedPair });
      if (!response?.success || !response?.signal) {
        throw new Error(response?.error || 'Signal generation failed');
      }
      setResult(response.signal);
      onSignalGenerated?.(response.signal);
    } catch (err) {
      setError(err.message || 'Signal generation failed');
    } finally {
      setLoading(false);
    }
  }, [onSignalGenerated, selectedPair]);

  const summary = useMemo(() => buildSummary(result), [result]);

  return (
    <section className="engine-console">
      <header className="engine-console__header">
        <div>
          <h2 className="engine-console__title">Signal Engine Console</h2>
          <p className="engine-console__subtitle">Trigger on-demand signals aligned with the production engine</p>
        </div>
        <div className="engine-console__controls">
          <select
            className="engine-console__select"
            value={selectedPair}
            onChange={(event) => setSelectedPair(event.target.value)}
            disabled={!sanitizedPairs.length || loading}
          >
            {sanitizedPairs.map((pair) => (
              <option key={pair} value={pair}>
                {pair}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="engine-console__action"
            onClick={handleGenerate}
            disabled={!sanitizedPairs.length || loading}
          >
            {loading ? 'Generating...' : 'Generate Signal'}
          </button>
        </div>
      </header>

      {error && <div className="engine-console__alert">{error}</div>}

      {!error && !summary && (
        <div className="engine-console__placeholder">
          Select a pair and generate to inspect the latest AI signal blueprint.
        </div>
      )}

      {summary && !error && (
        <div className="engine-console__result">
          <div className="engine-console__result-header">
            <span className="engine-console__result-pair">{summary.pair}</span>
            <span className={`engine-console__result-direction engine-console__result-direction--${summary.direction.toLowerCase()}`}>
              {summary.direction}
            </span>
            {summary.strategy && <span className="engine-console__tag">{summary.strategy}</span>}
            {summary.generatedAt && (
              <span className="engine-console__timestamp">{formatDateTime(summary.generatedAt)}</span>
            )}
          </div>

          <div className="engine-console__grid">
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Confidence</span>
              <span className="engine-console__metric-value">{summary.confidence != null ? formatPercent(summary.confidence, 0) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Strength</span>
              <span className="engine-console__metric-value">{summary.strength != null ? formatNumber(summary.strength, 0) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Win Rate</span>
              <span className="engine-console__metric-value">{summary.winRate != null ? formatPercent(summary.winRate, 0) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Score</span>
              <span className="engine-console__metric-value">{summary.finalScore != null ? formatNumber(summary.finalScore, 0) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Entry</span>
              <span className="engine-console__metric-value">{summary.entryPrice != null ? formatNumber(summary.entryPrice, 5) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Take Profit</span>
              <span className="engine-console__metric-value">{summary.takeProfit != null ? formatNumber(summary.takeProfit, 5) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Stop Loss</span>
              <span className="engine-console__metric-value">{summary.stopLoss != null ? formatNumber(summary.stopLoss, 5) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Risk / Reward</span>
              <span className="engine-console__metric-value">{summary.riskReward != null ? formatRiskReward(summary.riskReward) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">ATR</span>
              <span className="engine-console__metric-value">{summary.atr != null ? formatNumber(summary.atr, 4) : NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Net Bias</span>
              <span className="engine-console__metric-value">{summary.technical?.type || NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Timeframe</span>
              <span className="engine-console__metric-value">{summary.technical?.timeframe || summary.technical?.timeFrame || NA_LABEL}</span>
            </div>
            <div className="engine-console__metric">
              <span className="engine-console__metric-label">Technical Score</span>
              <span className="engine-console__metric-value">{summary.technical?.strength != null ? formatNumber(summary.technical.strength, 0) : NA_LABEL}</span>
            </div>
          </div>

          {summary.technical?.narrative && (
            <div className="engine-console__narrative">
              {summary.technical.narrative}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default SignalEngineConsole;
