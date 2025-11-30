import { existsSync, readFileSync } from 'node:fs';

function loadEntries(path) {
  if (!existsSync(path)) {
    throw new Error(`Runbook payload file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Payload file must contain a JSON array');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse payload JSON: ${error.message}`);
  }
}

export function extractRunbookUrls(entries) {
  const urls = new Set();

  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const body = entry.bodyJson;
    if (entry.path && typeof entry.path === 'string' && entry.path.includes('/slack/')) {
      const text = body?.text;
      if (typeof text === 'string') {
        const match = text.match(/\*Runbook\*:\s*(https?:\/\/\S+)/i);
        if (match && match[1]) {
          urls.add(match[1]);
        }
      }
    }
    if (entry.path && typeof entry.path === 'string' && entry.path.includes('/ticket')) {
      const alerts = Array.isArray(body?.alerts) ? body.alerts : [];
      if (alerts.length > 0) {
        const runbook = alerts[0]?.annotations?.runbook;
        if (typeof runbook === 'string' && runbook.trim().length > 0) {
          urls.add(runbook.trim());
        }
      }
      if (typeof body?.runbook === 'string' && body.runbook.trim().length > 0) {
        urls.add(body.runbook.trim());
      }
    }
  });

  return urls;
}

async function checkUrl(url, { timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'signals-ci-runbook-probe/1.0'
      }
    });
    if (!response.ok) {
      throw new Error(`received HTTP ${response.status}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw new Error(error.message || error);
  } finally {
    clearTimeout(timer);
  }
}

export async function validateRunbookLinks({ inputPath, timeoutMs = 10000, fetchImpl = fetch }) {
  if (!inputPath) {
    throw new Error('inputPath is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive number');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }

  const entries = loadEntries(inputPath);
  const urls = extractRunbookUrls(entries);

  if (urls.size === 0) {
    throw new Error('No runbook URLs detected in captured payloads.');
  }

  for (const url of urls) {
    await checkUrl(url, { timeoutMs, fetchImpl });
  }
}
