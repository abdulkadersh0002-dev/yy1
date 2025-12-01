import fs from 'node:fs/promises';
import path from 'node:path';

export function parseTimestamp(value, { timezone = 'UTC' } = {}) {
  if (value == null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  let normalized = raw;
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  if (!hasTimezone && timezone && timezone.toUpperCase() === 'UTC') {
    normalized = `${raw.replace(' ', 'T')}Z`;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed);
  }

  return null;
}

export function toNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toStringValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return JSON.stringify(value);
}

export function normalizePair(value, fallback) {
  if (typeof value === 'string' && value.trim().length === 6) {
    return value.trim().toUpperCase();
  }
  return fallback || null;
}

export function normalizeTimeframe(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().toUpperCase();
  }
  return fallback || 'M15';
}

export function chunkArray(items, size) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const data = await fs.readFile(resolved, 'utf8');
  return JSON.parse(data);
}

export function ensureArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

export function boolFrom(value, fallback = null) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', 'f', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return fallback;
}
