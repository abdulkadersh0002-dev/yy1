import React from 'react';
import StatusPill from './StatusPill.jsx';
import {
  formatNumber,
  formatSignedPercent,
  formatDateTime,
  formatRelativeTime,
  formatDirection
} from '../utils/format.js';
import { useModuleHealth } from '../context/ModuleHealthContext.jsx';

const deriveEntryPrice = (trade) => {
  if (!trade) {
    return null;
  }
  return trade.entryPrice ?? trade.entry?.price ?? trade.signal?.entry?.price ?? null;
};

const derivePositionSize = (trade) => trade.positionSize ?? trade.size ?? trade.volume ?? null;

const deriveUnrealized = (trade) => {
  if (!trade) {
    return null;
  }
  const value = trade.unrealized?.percentage ?? trade.metrics?.pnlPct ?? trade.pnl?.percentage;
  return value ?? null;
};

const deriveFinalPnL = (trade) => {
  if (!trade) {
    return null;
  }
  const value = trade.finalPnL?.percentage ?? trade.pnl?.percentage ?? trade.performance?.pnlPct;
  return value ?? null;
};

const renderActiveRow = (trade) => {
  const entry = deriveEntryPrice(trade);
  const size = derivePositionSize(trade);
  const pnl = deriveUnrealized(trade);
  const openedAt = trade.openedAt || trade.openTime || trade.createdAt;

  return (
    <tr key={trade.id || `${trade.pair}-${openedAt || Math.random()}`}>
      <td>{trade.pair || 'N/A'}</td>
      <td><StatusPill state={trade.direction || trade.side} label={formatDirection(trade.direction || trade.side)} /></td>
      <td>{formatNumber(entry, 5)}</td>
      <td>{formatNumber(trade.currentPrice ?? trade.price ?? trade.marketPrice, 5)}</td>
      <td className={pnl > 0 ? 'cell--positive' : pnl < 0 ? 'cell--negative' : ''}>{formatSignedPercent(pnl)}</td>
      <td>{formatNumber(size, 2)}</td>
      <td>{formatRelativeTime(openedAt)}</td>
    </tr>
  );
};

const renderHistoryRow = (trade) => {
  const pnl = deriveFinalPnL(trade);
  const closedAt = trade.closedAt || trade.closeTime || trade.completedAt;

  return (
    <tr key={trade.id || `${trade.pair}-${closedAt || Math.random()}`}>
      <td>{trade.pair || 'N/A'}</td>
      <td><StatusPill state={pnl > 0 ? 'success' : pnl < 0 ? 'error' : 'neutral'} label={formatDirection(trade.direction || trade.side)} /></td>
      <td>{formatNumber(trade.entry?.price ?? trade.entryPrice, 5)}</td>
      <td>{formatNumber(trade.exit?.price ?? trade.closePrice, 5)}</td>
      <td className={pnl > 0 ? 'cell--positive' : pnl < 0 ? 'cell--negative' : ''}>{formatSignedPercent(pnl)}</td>
      <td>{formatDateTime(closedAt)}</td>
    </tr>
  );
};

const TradesTable = ({ activeTrades = [], tradeHistory = [] }) => {
  const { modulesById, loading: moduleHealthLoading, error: moduleHealthError } = useModuleHealth();
  const tradingModule = modulesById?.signals;
  const tradingState = tradingModule ? String(tradingModule.state || '').toLowerCase() : null;
  const tradingDetail = tradingModule?.detail || null;
  const tradingCritical = !moduleHealthLoading && tradingState === 'critical';
  const tradingDegraded = !moduleHealthLoading && tradingState === 'degraded';

  return (
    <section className="panel panel--stretch">
      <div className="panel__header">
        <h2>Trading Activity</h2>
        <p className="panel__hint">Live portfolio insight with recent performance</p>
      </div>

      {moduleHealthError && (
        <div className="engine-panel__alert engine-panel__alert--muted">
          Module health diagnostics unavailable · {moduleHealthError}
        </div>
      )}
      {tradingCritical && (
        <div className="engine-panel__alert">
          Trading engine offline · {tradingDetail || 'Live trade data will resume once connectivity restores.'}
        </div>
      )}
      {!tradingCritical && tradingDegraded && (
        <div className="engine-panel__alert engine-panel__alert--muted">
          Trading engine degraded · {tradingDetail || 'Expect delayed trade updates while the engine stabilises.'}
        </div>
      )}

      <div className="table-group">
        <div className="table-wrapper">
          <h3>Open Positions</h3>
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Last</th>
                <th>PnL</th>
                <th>Size</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {activeTrades.length === 0 && (
                <tr>
                  <td colSpan="7" className="cell--empty">No open trades</td>
                </tr>
              )}
              {activeTrades.map(renderActiveRow)}
            </tbody>
          </table>
        </div>
        <div className="table-wrapper">
          <h3>Recent Closures</h3>
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>PnL</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.length === 0 && (
                <tr>
                  <td colSpan="6" className="cell--empty">No closed trades</td>
                </tr>
              )}
              {tradeHistory.slice(0, 12).map(renderHistoryRow)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export default TradesTable;
