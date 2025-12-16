import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postJson } from '../utils/api.js';
import { formatNumber, formatPercent, formatDateTime } from '../utils/format.js';
import SignalTicker from './SignalTicker.jsx';

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
    technical,
    dataQuality: (() => {
      const marketData = signal.components?.marketData || {};
      if (!marketData || typeof marketData !== 'object') {
        return null;
      }
      return {
        score: toNumber(marketData.score),
        status: marketData.status || null,
        recommendation: marketData.recommendation || null,
        issues: Array.isArray(marketData.issues) ? marketData.issues.filter(Boolean) : [],
        confidencePenalty: toNumber(marketData.confidencePenalty),
        directionBeforeQuality: marketData.directionPreQuality || null,
        syntheticRelaxed: Boolean(marketData.syntheticRelaxed),
        syntheticContext: marketData.syntheticContext || null
      };
    })(),
    validation: (() => {
      const info = signal.isValid || {};
      const checks = info.checks && typeof info.checks === 'object' ? info.checks : {};
      return {
        passes: Boolean(info.isValid),
        reason: info.reason || null,
        failedChecks: Object.entries(checks)
          .filter(([, value]) => value === false)
          .map(([key]) => key)
      };
    })(),
    reasoning: Array.isArray(signal.reasoning) ? signal.reasoning.filter(Boolean) : []
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

const extractSnapshotDetails = (snapshot = {}) => {
  const features = snapshot.features || {};
  const direction = features.direction ?? features.signal ?? features.bias;
  const score = features.score ?? features.strength ?? features.confidence;
  const regime = features.regime?.state ?? features.regimeState ?? features.marketState;
  const volatility = features.volatility?.state ?? features.volatilityState;
  return {
    direction,
    score,
    regime,
    volatility
  };
};

function SignalEngineConsole({
  pairs,
  snapshots = [],
  signals = [],
  onSignalGenerated,
  brokerConnectors = [],
  brokerHealth = [],
  onRefreshBrokers
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedSignals, setGeneratedSignals] = useState([]);
  const [partialFailures, setPartialFailures] = useState([]);
  const [generationTimestamp, setGenerationTimestamp] = useState(null);
  const [bridgeActivity, setBridgeActivity] = useState({});

  const sanitizedPairs = useMemo(() => {
    if (Array.isArray(pairs) && pairs.length > 0) {
      return [...pairs]
        .filter(Boolean)
        .map((pair) => String(pair).toUpperCase());
    }
    return FALLBACK_PAIRS;
  }, [pairs]);

  const targetPairs = useMemo(() => sanitizedPairs.slice(0, 7), [sanitizedPairs]);
  const trackedPlatforms = useMemo(() => ['MT4', 'MT5'], []);
  const normalizedConnectors = useMemo(
    () => brokerConnectors.map((id) => String(id).toUpperCase()),
    [brokerConnectors]
  );
  const connectorHealthMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(brokerHealth)) {
      brokerHealth.forEach((snapshot) => {
        if (!snapshot?.broker) {
          return;
        }
        map.set(String(snapshot.broker).toUpperCase(), snapshot);
      });
    }
    return map;
  }, [brokerHealth]);
  const anyBridgeLoading = useMemo(
    () => Object.values(bridgeActivity).some((entry) => entry?.loading),
    [bridgeActivity]
  );
  const pairOrder = useMemo(() => targetPairs.map((pair) => pair.toUpperCase()), [targetPairs]);

  const handleGenerate = useCallback(async () => {
    if (!targetPairs.length) {
      setError('No trading pairs configured');
      setGeneratedSignals([]);
      setPartialFailures([]);
      setGenerationTimestamp(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        targetPairs.map((pair) =>
          postJson('/api/signal/generate', { pair })
            .then((response) => {
              if (!response?.success || !response?.signal) {
                const error = new Error(response?.error || 'Signal generation failed');
                error.pair = pair;
                throw error;
              }
              return { pair, signal: response.signal };
            })
            .catch((err) => {
              const wrapped = err instanceof Error ? err : new Error(err?.message || 'Signal generation failed');
              wrapped.pair = pair;
              throw wrapped;
            })
        )
      );

      const successes = [];
      const failures = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value?.signal) {
          successes.push(result.value);
        } else {
          const reason = result.reason || {};
          const failedPair = reason.pair || targetPairs[index];
          if (failedPair) {
            failures.push(failedPair);
          }
        }
      });

      if (!successes.length) {
        setGeneratedSignals([]);
        setPartialFailures([]);
        setGenerationTimestamp(null);
        setError('Unable to generate signals. Please try again.');
        return;
      }

      setGeneratedSignals(successes.map(({ signal }) => signal));
      setPartialFailures(failures);
      setGenerationTimestamp(Date.now());

      successes.forEach(({ signal }) => {
        if (signal) {
          onSignalGenerated?.(signal);
        }
      });
    } catch (err) {
      setGeneratedSignals([]);
      setPartialFailures([]);
      setGenerationTimestamp(null);
      setError(err.message || 'Signal generation failed');
    } finally {
      setLoading(false);
    }
  }, [onSignalGenerated, targetPairs]);

  const autoSignature = useRef('');

  useEffect(() => {
    const signature = targetPairs.join('|');
    if (!targetPairs.length) {
      setGeneratedSignals([]);
      setPartialFailures([]);
      setGenerationTimestamp(null);
      autoSignature.current = signature;
      return;
    }

    if (autoSignature.current !== signature) {
      autoSignature.current = signature;
      handleGenerate();
    }
  }, [handleGenerate, targetPairs]);

  const summaries = useMemo(() => {
    if (!generatedSignals.length) {
      return [];
    }

    const orderFallback = pairOrder.length;

    return generatedSignals
      .map((signal) => buildSummary(signal))
      .filter(Boolean)
      .sort((a, b) => {
        const rankA = pairOrder.indexOf((a.pair || '').toUpperCase());
        const rankB = pairOrder.indexOf((b.pair || '').toUpperCase());
        const safeA = rankA === -1 ? orderFallback : rankA;
        const safeB = rankB === -1 ? orderFallback : rankB;
        return safeA - safeB;
      });
  }, [generatedSignals, pairOrder]);

  const handleBridgeAction = useCallback(
    async (platform) => {
      if (!platform) {
        return;
      }

      const id = String(platform).toLowerCase();
      setBridgeActivity((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          loading: true,
          error: null,
          message: null
        }
      }));

      try {
        const response = await postJson(`/api/broker/connectors/${id}/probe`, {
          action: 'connect'
        });
        const health = response?.connector?.health || null;
        setBridgeActivity((prev) => ({
          ...prev,
          [id]: {
            loading: false,
            error: null,
            message: health?.connected
              ? 'Bridge verified and online'
              : health?.error || 'Unable to confirm active bridge'
          }
        }));
        onRefreshBrokers?.();
      } catch (err) {
        setBridgeActivity((prev) => ({
          ...prev,
          [id]: {
            loading: false,
            error: err.message || 'Bridge request failed',
            message: null
          }
        }));
      }
    },
    [onRefreshBrokers]
  );
  const snapshotCards = useMemo(() => (Array.isArray(snapshots) ? snapshots.slice(0, 4) : []), [snapshots]);
  const latestSnapshotTimestamp = useMemo(() => {
    if (!snapshotCards.length) {
      return null;
    }
    const timestamps = snapshotCards
      .map((item) => item?.ts ?? item?.timestamp ?? item?.updatedAt ?? null)
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) {
      return null;
    }
    return Math.max(...timestamps);
  }, [snapshotCards]);
  const latestSignalTimestamp = useMemo(() => {
    if (!Array.isArray(signals) || !signals.length) {
      return null;
    }
    const timestamps = signals
      .map((item) => item?.timestamp ?? item?.openedAt ?? item?.createdAt ?? null)
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) {
      return null;
    }
    return Math.max(...timestamps);
  }, [signals]);

  return (
    <section className="engine-console">
      <header className="engine-console__header">
        <div>
          <h2 className="engine-console__title">Signal Engine Console</h2>
          <p className="engine-console__subtitle">Intelligently refresh signals across every covered pair</p>
        </div>
        <div className="engine-console__controls">
          {targetPairs.length > 0 && (
            <span className="engine-console__coverage">Auto coverage · {targetPairs.length} pairs</span>
          )}
          {generationTimestamp && (
            <span className="engine-console__last-run">Last generated {formatDateTime(generationTimestamp)}</span>
          )}
          <button
            type="button"
            className="engine-console__action"
            onClick={handleGenerate}
            disabled={!targetPairs.length || loading}
          >
            {loading ? 'Generating...' : 'Generate All Signals'}
          </button>
        </div>
      </header>

      {error && <div className="engine-console__alert">{error}</div>}
      {!error && partialFailures.length > 0 && (
        <div className="engine-console__warning">
          Failed to refresh: {partialFailures.map((pair) => pair.toUpperCase()).join(', ')}
        </div>
      )}

      <div className="engine-console__bridge">
        <div className="engine-console__bridge-header">
          <div>
            <h3 className="engine-console__bridge-title">MetaTrader Bridge</h3>
            <p className="engine-console__bridge-subtitle">Link MT4 and MT5 terminals for manual trade alignment</p>
          </div>
          {brokerHealth?.length > 0 && (
            <button
              type="button"
              className="engine-console__bridge-refresh"
              onClick={() => onRefreshBrokers?.()}
              disabled={anyBridgeLoading}
            >
              Refresh Status
            </button>
          )}
        </div>
        <div className="engine-console__bridge-grid">
          {trackedPlatforms.map((platform) => {
            const platformId = platform.toLowerCase();
            const snapshot =
              connectorHealthMap.get(platform) ||
              connectorHealthMap.get(platformId.toUpperCase()) ||
              connectorHealthMap.get(platformId);
            const activity = bridgeActivity[platformId] || {};
            const isAvailable = normalizedConnectors.includes(platform);
            const status = snapshot?.connected
              ? 'connected'
              : snapshot
                ? 'disconnected'
                : 'unknown';
            const lastSeen =
              snapshot?.checkedAt ||
              snapshot?.timestamp ||
              snapshot?.updatedAt ||
              snapshot?.healthTimestamp ||
              snapshot?.details?.checkedAt ||
              snapshot?.details?.timestamp ||
              snapshot?.details?.connectedAt ||
              null;
            const downloadHref = `/eas/SignalBridge-${platform}.mq${platform === 'MT5' ? '5' : '4'}`;

            return (
              <article key={platform} className="engine-console__bridge-card">
                <header className="engine-console__bridge-card-header">
                  <span className="engine-console__bridge-label">{platform}</span>
                  <span className={`engine-console__bridge-status engine-console__bridge-status--${status}`}>
                    {status === 'connected' && 'Connected'}
                    {status === 'disconnected' && 'Offline'}
                    {status === 'unknown' && 'Unknown'}
                  </span>
                </header>
                <div className="engine-console__bridge-body">
                  <p className="engine-console__bridge-description">
                    {isAvailable
                      ? 'Mirror trades and synchronize execution with the trading engine.'
                      : 'Connector not provisioned in this environment.'}
                  </p>
                  <dl className="engine-console__bridge-meta">
                    <div>
                      <dt>Account Mode</dt>
                      <dd>{snapshot?.mode ? String(snapshot.mode).toUpperCase() : NA_LABEL}</dd>
                    </div>
                    <div>
                      <dt>Last Check</dt>
                      <dd>
                        {lastSeen ? formatDateTime(lastSeen) : 'N/A'}
                      </dd>
                    </div>
                  </dl>
                </div>
                <footer className="engine-console__bridge-actions">
                  <button
                    type="button"
                    className="engine-console__bridge-button"
                    onClick={() => handleBridgeAction(platform)}
                    disabled={!isAvailable || activity.loading}
                  >
                    {activity.loading ? 'Connecting...' : `Connect ${platform}`}
                  </button>
                  <a
                    className="engine-console__bridge-button engine-console__bridge-button--ghost"
                    href={downloadHref}
                    download
                  >
                    Download EA
                  </a>
                  {activity.error && (
                    <p className="engine-console__bridge-alert">{activity.error}</p>
                  )}
                  {!activity.error && activity.message && (
                    <p className="engine-console__bridge-note">{activity.message}</p>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      </div>

      <div className="engine-console__snapshots">
        <div className="engine-console__snapshots-header">
          <div>
            <h3 className="engine-console__snapshots-title">Feature Store Signals</h3>
            <p className="engine-console__snapshots-subtitle">Live features powering the next signal decision</p>
          </div>
          {latestSnapshotTimestamp && (
            <span className="engine-console__snapshots-meta">
              Updated {formatDateTime(latestSnapshotTimestamp)}
            </span>
          )}
        </div>
        <div className="engine-console__snapshots-grid">
          {snapshotCards.length === 0 && (
            <div className="engine-console__snapshots-empty">Feature snapshots unavailable</div>
          )}
          {snapshotCards.map((snapshot) => {
            const details = extractSnapshotDetails(snapshot);
            const timestampKey = snapshot.ts ?? snapshot.timestamp ?? snapshot.updatedAt ?? 0;
            const key = `${snapshot.pair || 'pair'}-${snapshot.timeframe || 'tf'}-${timestampKey}`;
            return (
              <article key={key} className="engine-console__snapshot-card">
                <header className="engine-console__snapshot-card-header">
                  <h4 className="engine-console__snapshot-card-title">
                    {snapshot.pair}
                    {snapshot.timeframe ? ` · ${snapshot.timeframe}` : ''}
                  </h4>
                  <span className="engine-console__snapshot-card-time">
                    {snapshot.ts || snapshot.timestamp ? formatDateTime(snapshot.ts || snapshot.timestamp) : 'N/A'}
                  </span>
                </header>
                <dl className="engine-console__snapshot-card-metrics">
                  <div>
                    <dt>Direction</dt>
                    <dd>{details.direction ? String(details.direction).toUpperCase() : NA_LABEL}</dd>
                  </div>
                  <div>
                    <dt>Score</dt>
                    <dd>
                      {details.score !== undefined && details.score !== null
                        ? Number(details.score).toFixed(2)
                        : NA_LABEL}
                    </dd>
                  </div>
                  <div>
                    <dt>Regime</dt>
                    <dd>{details.regime ? String(details.regime).toUpperCase() : NA_LABEL}</dd>
                  </div>
                  <div>
                    <dt>Volatility</dt>
                    <dd>{details.volatility ? String(details.volatility).toUpperCase() : NA_LABEL}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </div>

      <div className="engine-console__signals">
        <div className="engine-console__signals-header">
          <div>
            <h3 className="engine-console__signals-title">Signal Stream</h3>
            <p className="engine-console__signals-subtitle">Live opportunities flowing from the engine</p>
          </div>
          {latestSignalTimestamp && (
            <span className="engine-console__signals-meta">
              Updated {formatDateTime(latestSignalTimestamp)}
            </span>
          )}
        </div>
        <div className="engine-console__signals-body">
          <SignalTicker signals={signals} />
        </div>
      </div>

      {!error && summaries.length === 0 && !loading && (
        <div className="engine-console__placeholder">
          Signals populate automatically for all covered pairs once available.
        </div>
      )}

      {summaries.length > 0 && !error && (
        <div className="engine-console__results">
          {summaries.map((summary) => {
            const cardKey = `${summary.pair || 'pair'}-${summary.generatedAt || 'latest'}`;
            return (
              <article key={cardKey} className="engine-console__result">
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

                {(summary.dataQuality || summary.validation || summary.reasoning.length > 0) && (
                  <div className="engine-console__insights">
                    {summary.dataQuality && (
                      <div className="engine-console__insight-card">
                        <h3 className="engine-console__insight-title">Data Quality Guard</h3>
                        <ul className="engine-console__insight-list">
                          {summary.dataQuality.status && (
                            <li>
                              Status: <strong>{summary.dataQuality.status.toUpperCase()}</strong>
                            </li>
                          )}
                          {summary.dataQuality.recommendation && (
                            <li>Recommendation: {summary.dataQuality.recommendation}</li>
                          )}
                          {summary.dataQuality.score != null && (
                            <li>Score: {formatNumber(summary.dataQuality.score, 1)}</li>
                          )}
                          {summary.dataQuality.directionBeforeQuality && (
                            <li>
                              Direction before guard: {summary.dataQuality.directionBeforeQuality}
                            </li>
                          )}
                          {summary.dataQuality.syntheticRelaxed && (
                            <li>Relaxed for synthetic data mode</li>
                          )}
                          {summary.dataQuality.syntheticContext?.suppressedIssues?.length > 0 && (
                            <li>
                              Suppressed issues: {summary.dataQuality.syntheticContext.suppressedIssues.join(', ')}
                            </li>
                          )}
                          {summary.dataQuality.issues.length > 0 && (
                            <li>Issues: {summary.dataQuality.issues.join(', ')}</li>
                          )}
                          {summary.dataQuality.confidencePenalty != null && (
                            <li>
                              Confidence penalty: {formatPercent(summary.dataQuality.confidencePenalty / 100, 0)}
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {summary.validation && (
                      <div className="engine-console__insight-card">
                        <h3 className="engine-console__insight-title">Signal Validation</h3>
                        <p className="engine-console__insight-text">
                          {summary.validation.passes ? 'Signal meets trading criteria.' : 'Signal blocked by safeguards.'}
                        </p>
                        {summary.validation.reason && (
                          <p className="engine-console__insight-text">Reason: {summary.validation.reason}</p>
                        )}
                        {summary.validation.failedChecks.length > 0 && (
                          <ul className="engine-console__insight-list">
                            {summary.validation.failedChecks.map((check) => (
                              <li key={check}>{check}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {summary.reasoning.length > 0 && (
                      <div className="engine-console__insight-card">
                        <h3 className="engine-console__insight-title">Why This Signal?</h3>
                        <ul className="engine-console__insight-list">
                          {summary.reasoning.slice(0, 6).map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default SignalEngineConsole;
