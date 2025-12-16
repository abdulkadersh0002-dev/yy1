import React, { useEffect, useState } from 'react';
import { fetchJson } from '../utils/api.js';
import StatusPill from './StatusPill.jsx';

/**
 * EaBridgeControl Component
 * Displays MT4/MT5 EA connection status and auto-trading control
 */
const EaBridgeControl = () => {
  const [sessions, setSessions] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [autoTradingEnabled, setAutoTradingEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch EA bridge statistics
  const fetchStatistics = async () => {
    try {
      const data = await fetchJson('/broker/bridge/statistics');
      setStatistics(data);
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch EA statistics:', err);
      setError(err.message);
    }
  };

  // Toggle auto-trading
  const toggleAutoTrading = async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = autoTradingEnabled ? '/auto-trading/stop' : '/auto-trading/start';
      await fetchJson(endpoint, { method: 'POST' });
      setAutoTradingEnabled(!autoTradingEnabled);
    } catch (err) {
      console.error('Failed to toggle auto-trading:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatistics();
    const interval = setInterval(fetchStatistics, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const formatPercent = (value) => {
    return (value * 100).toFixed(1) + '%';
  };

  const formatNumber = (value) => {
    return value?.toFixed(2) || '0.00';
  };

  return (
    <div className="ea-bridge-control">
      <div className="ea-bridge-header">
        <h3>🤖 Intelligent EA Bridge</h3>
        <div className="ea-bridge-actions">
          <button
            className={`btn-auto-trading ${autoTradingEnabled ? 'active' : ''}`}
            onClick={toggleAutoTrading}
            disabled={loading}
          >
            {loading ? '⏳' : autoTradingEnabled ? '⏸️ Stop Auto-Trading' : '▶️ Start Auto-Trading'}
          </button>
        </div>
      </div>

      {error && (
        <div className="ea-bridge-error">
          ⚠️ {error}
        </div>
      )}

      {/* Active Sessions */}
      <div className="ea-sessions-section">
        <h4>📡 Active EA Sessions</h4>
        {sessions.length === 0 ? (
          <div className="ea-no-sessions">
            No active EA sessions. Connect MT4/MT5 Expert Advisor to start.
          </div>
        ) : (
          <div className="ea-sessions-grid">
            {sessions.map((session) => (
              <div key={session.id} className="ea-session-card">
                <div className="ea-session-header">
                  <span className="ea-session-broker">{session.broker.toUpperCase()}</span>
                  <StatusPill status="success" label="Connected" />
                </div>
                <div className="ea-session-details">
                  <div className="ea-session-row">
                    <span>Account:</span>
                    <span>{session.accountMode}</span>
                  </div>
                  <div className="ea-session-row">
                    <span>Trades:</span>
                    <span>{session.tradesExecuted}</span>
                  </div>
                  <div className="ea-session-row">
                    <span>P/L:</span>
                    <span className={session.profitLoss >= 0 ? 'profit' : 'loss'}>
                      ${formatNumber(session.profitLoss)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Learning Metrics */}
      {statistics?.learning && (
        <div className="ea-learning-section">
          <h4>🧠 AI Learning Metrics</h4>
          <div className="ea-metrics-grid">
            <div className="ea-metric-card">
              <div className="ea-metric-label">Win Rate</div>
              <div className="ea-metric-value">
                {formatPercent(statistics.learning.winRate)}
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Risk Adjustment</div>
              <div className="ea-metric-value">
                {formatNumber(statistics.learning.riskAdjustment)}x
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Stop-Loss Factor</div>
              <div className="ea-metric-value">
                {formatNumber(statistics.learning.stopLossAdjustment)}x
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Consecutive Wins</div>
              <div className="ea-metric-value success">
                {statistics.learning.consecutiveWins}
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Consecutive Losses</div>
              <div className="ea-metric-value danger">
                {statistics.learning.consecutiveLosses}
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Avg Profit</div>
              <div className="ea-metric-value">
                ${formatNumber(statistics.learning.avgProfit)}
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Avg Loss</div>
              <div className="ea-metric-value">
                ${formatNumber(statistics.learning.avgLoss)}
              </div>
            </div>
            <div className="ea-metric-card">
              <div className="ea-metric-label">Trade History</div>
              <div className="ea-metric-value">
                {statistics.learning.tradeHistorySize}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="ea-setup-section">
        <h4>⚙️ Setup Instructions</h4>
        <ol className="ea-setup-list">
          <li>Download EA files: <code>SignalBridge-MT4.mq4</code> or <code>SignalBridge-MT5.mq5</code></li>
          <li>Copy to MT4/MT5 <code>Experts</code> folder</li>
          <li>Set <code>BridgeUrl</code> and <code>ApiToken</code> in EA settings</li>
          <li>Enable <code>EnableAutoTrading</code> parameter</li>
          <li>Attach EA to chart and enable Auto-Trading in terminal</li>
        </ol>
      </div>

      <style jsx>{`
        .ea-bridge-control {
          background: var(--surface-elevated, #1a1a2e);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .ea-bridge-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .ea-bridge-header h3 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .btn-auto-trading {
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .btn-auto-trading:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .btn-auto-trading.active {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }

        .btn-auto-trading:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .ea-bridge-error {
          background: rgba(245, 87, 108, 0.1);
          border: 1px solid rgba(245, 87, 108, 0.3);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
          color: #f5576c;
        }

        .ea-sessions-section,
        .ea-learning-section,
        .ea-setup-section {
          margin-top: 1.5rem;
        }

        .ea-sessions-section h4,
        .ea-learning-section h4,
        .ea-setup-section h4 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .ea-no-sessions {
          text-align: center;
          padding: 2rem;
          color: var(--text-muted, #888);
          font-style: italic;
        }

        .ea-sessions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
        }

        .ea-session-card {
          background: var(--surface, #16213e);
          border-radius: 8px;
          padding: 1rem;
          border: 1px solid var(--border, #2a2a4e);
        }

        .ea-session-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .ea-session-broker {
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--accent, #667eea);
        }

        .ea-session-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .ea-session-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.9rem;
        }

        .ea-session-row span:first-child {
          color: var(--text-muted, #888);
        }

        .profit {
          color: #22c55e;
          font-weight: 600;
        }

        .loss {
          color: #ef4444;
          font-weight: 600;
        }

        .ea-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 1rem;
        }

        .ea-metric-card {
          background: var(--surface, #16213e);
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
          border: 1px solid var(--border, #2a2a4e);
        }

        .ea-metric-label {
          font-size: 0.75rem;
          color: var(--text-muted, #888);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ea-metric-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary, #fff);
        }

        .ea-metric-value.success {
          color: #22c55e;
        }

        .ea-metric-value.danger {
          color: #ef4444;
        }

        .ea-setup-list {
          padding-left: 1.5rem;
          margin: 0;
        }

        .ea-setup-list li {
          margin-bottom: 0.5rem;
          line-height: 1.6;
        }

        .ea-setup-list code {
          background: var(--surface, #16213e);
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 0.9em;
        }
      `}</style>
    </div>
  );
};

export default EaBridgeControl;
