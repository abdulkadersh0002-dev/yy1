const isNumberLike = (value) =>
  value !== null && value !== undefined && !Number.isNaN(Number(value));

const clampFractionDigits = (value, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const intValue = Math.trunc(value);
  if (intValue < 0) {
    return 0;
  }
  if (intValue > 20) {
    return 20;
  }
  return intValue;
};

export const formatNumber = (value, decimalsOrOptions = 2) => {
  if (!isNumberLike(value)) {
    return '—';
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '—';
  }

  const defaultDigits = 2;
  let minimumFractionDigits = defaultDigits;
  let maximumFractionDigits = defaultDigits;

  if (typeof decimalsOrOptions === 'number') {
    const clamped = clampFractionDigits(decimalsOrOptions, defaultDigits);
    minimumFractionDigits = clamped;
    maximumFractionDigits = clamped;
  } else if (decimalsOrOptions && typeof decimalsOrOptions === 'object') {
    const rawMin = Number(decimalsOrOptions.minimumFractionDigits);
    const rawMax = Number(decimalsOrOptions.maximumFractionDigits);

    const hasMin = Number.isFinite(rawMin);
    const hasMax = Number.isFinite(rawMax);

    if (hasMin || hasMax) {
      minimumFractionDigits = clampFractionDigits(rawMin, 0);
      maximumFractionDigits = clampFractionDigits(rawMax, minimumFractionDigits);
      if (maximumFractionDigits < minimumFractionDigits) {
        maximumFractionDigits = minimumFractionDigits;
      }
    } else {
      const clamped = clampFractionDigits(Number(decimalsOrOptions.decimals), defaultDigits);
      minimumFractionDigits = clamped;
      maximumFractionDigits = clamped;
    }
  } else {
    const clamped = clampFractionDigits(Number(decimalsOrOptions), defaultDigits);
    minimumFractionDigits = clamped;
    maximumFractionDigits = clamped;
  }

  return number.toLocaleString('en-US', {
    minimumFractionDigits,
    maximumFractionDigits
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
  const seconds = Math.floor(Math.abs(diff) / 1000);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (seconds < 60) {
    return `${seconds}s ${suffix}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${suffix}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${suffix}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${suffix}`;
};

export const formatDirection = (direction) => {
  if (!direction) {
    return 'NEUTRAL';
  }
  return String(direction).toUpperCase();
};
