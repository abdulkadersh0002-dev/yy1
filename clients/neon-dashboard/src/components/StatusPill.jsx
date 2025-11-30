import React from 'react';

const STATE_MAP = {
  healthy: 'status-pill--positive',
  active: 'status-pill--positive',
  running: 'status-pill--positive',
  success: 'status-pill--positive',
  warning: 'status-pill--warning',
  degraded: 'status-pill--warning',
  paused: 'status-pill--neutral',
  idle: 'status-pill--neutral',
  disabled: 'status-pill--neutral',
  stopped: 'status-pill--neutral',
  offline: 'status-pill--negative',
  error: 'status-pill--negative',
  critical: 'status-pill--negative'
};

const normalize = (state) => {
  if (!state) {
    return 'unknown';
  }
  return String(state).toLowerCase();
};

const StatusPill = ({ state, label }) => {
  const normalized = normalize(state);
  const className = STATE_MAP[normalized] || 'status-pill--neutral';
  const text = label || normalized.toUpperCase();
  return <span className={`status-pill ${className}`}>{text}</span>;
};

export default StatusPill;
