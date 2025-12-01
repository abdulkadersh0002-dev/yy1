const isNumberLike = (value) =>
  value !== null && value !== undefined && !Number.isNaN(Number(value));

export const formatNumber = (value, decimals = 2) => {
  if (!isNumberLike(value)) {
    return '—';
  }
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export const formatPercent = (value, decimals = 2) => {
  if (!isNumberLike(value)) {
    return '—';
  }
  const numeric = Number(value);
  return `${numeric.toFixed(decimals)}%`;
};

export const formatSignedPercent = (value, decimals = 2) => {
  if (!isNumberLike(value)) {
    return '—';
  }
  const numeric = Number(value);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(decimals)}%`;
};

export const formatDateTime = (value) => {
  if (!value) {
    return '—';
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatRelativeTime = (value) => {
  if (!value) {
    return '—';
  }
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const formatDirection = (direction) => {
  if (!direction) {
    return 'NEUTRAL';
  }
  return String(direction).toUpperCase();
};
