import React from 'react';
import StatusPill from './StatusPill.jsx';
import { formatDateTime, formatRelativeTime, formatPercent } from '../utils/format.js';

const describe = (event) => {
  const type = event.type || 'event';
  const payload = event.payload || {};
  switch (type) {
    case 'signal':
      return `Signal generated for ${payload.pair || 'unknown pair'} (${payload.direction || 'N/A'})`;
    case 'trade_opened':
      return `Trade opened on ${payload.pair || 'N/A'} (${payload.direction || 'N/A'})`;
    case 'trade_closed': {
      const pnl = payload.finalPnL?.percentage ?? payload.pnl?.percentage ?? null;
      const formatted = pnl === null ? 'n/a' : formatPercent(pnl);
      return `Trade closed on ${payload.pair || 'N/A'} with PnL ${formatted}`;
    }
    case 'all_trades_closed':
      return `Bulk close completed (${payload.closed || 0} positions)`;
    case 'auto_trading_started':
      return 'Auto trading started';
    case 'auto_trading_stopped':
      return 'Auto trading stopped';
    default:
      return `${type} event received`;
  }
};

const classify = (type) => {
  switch (type) {
    case 'trade_opened':
    case 'auto_trading_started':
      return 'success';
    case 'trade_closed':
    case 'all_trades_closed':
      return 'warning';
    case 'auto_trading_stopped':
      return 'warning';
    default:
      return 'neutral';
  }
};

const LiveEventFeed = ({ events = [] }) => (
  <section className="panel panel--feed">
    <div className="panel__header">
      <h2>Live Operations</h2>
      <p className="panel__hint">Real-time broadcast from the trading engine</p>
    </div>
    <ul className="event-feed">
      {events.length === 0 && (
        <li className="event-feed__empty">Waiting for live activity...</li>
      )}
      {events.map((event) => (
        <li key={event.id} className="event-feed__item">
          <div className="event-feed__meta">
            <StatusPill state={classify(event.type)} label={event.type.replace(/_/g, ' ').toUpperCase()} />
            <span className="event-feed__time" title={formatDateTime(event.timestamp)}>{formatRelativeTime(event.timestamp)}</span>
          </div>
          <p className="event-feed__description">{describe(event)}</p>
        </li>
      ))}
    </ul>
  </section>
);

export default LiveEventFeed;
