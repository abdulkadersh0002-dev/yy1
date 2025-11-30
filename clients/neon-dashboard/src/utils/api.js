const resolveBrowserOrigin = () => {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }
  const { protocol, host } = window.location;
  if (!protocol || !host) {
    return null;
  }
  return `${protocol}//${host}`;
};

const sanitizeBaseUrl = (value) => {
  const browserOrigin = resolveBrowserOrigin();

  if (!value) {
    return browserOrigin || 'http://localhost:4101';
  }

  const trimmed = value.trim().replace(/\/$/, '');
  let normalized = trimmed;

  if (!/^https?:/i.test(normalized)) {
    normalized = `http://${normalized.replace(/^\/*/, '')}`;
  }

  try {
    const candidate = new URL(normalized);
    if (browserOrigin) {
      const browserUrl = new URL(browserOrigin);
      if (candidate.hostname === 'app' || candidate.hostname === 'localhost') {
        return `${browserUrl.protocol}//${browserUrl.host}`;
      }
    }
    return candidate.toString();
  } catch (_error) {
    return browserOrigin || 'http://localhost:4101';
  }
};

const baseUrl = sanitizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const apiKey = (import.meta.env.VITE_API_KEY || '').trim() || null;

const resolveWebSocketUrl = () => {
  const explicit = (import.meta.env.VITE_WS_URL || '').trim();
  const path = (import.meta.env.VITE_WS_PATH || '/ws/trading').trim();
  if (explicit) {
    if (/^wss?:/i.test(explicit)) {
      return explicit;
    }
    if (/^https?:/i.test(explicit)) {
      return explicit.replace(/^http/i, 'ws');
    }
  }
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    url.pathname = normalizedPath;
    url.search = '';
    return url.toString();
  } catch (_error) {
    return null;
  }
};

const wsUrl = resolveWebSocketUrl();

export const getApiConfig = () => ({
  baseUrl,
  apiKey,
  wsUrl
});

const buildHeaders = (baseHeaders = {}, skipAuth = false) => {
  const headers = new Headers(baseHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (!skipAuth && apiKey) {
    headers.set('x-api-key', apiKey);
  }
  return headers;
};

export async function fetchJson(path, options = {}) {
  const url =
    path.startsWith('http://') || path.startsWith('https://') ? path : `${baseUrl}${path}`;
  const method = options.method || 'GET';
  const skipAuth = Boolean(options.skipAuth);
  const headers = buildHeaders(options.headers, skipAuth);

  const init = {
    method,
    headers,
    signal: options.signal
  };

  if (options.body !== undefined) {
    const isObjectBody =
      typeof options.body === 'object' && options.body !== null && !options.rawBody;
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.body = isObjectBody ? JSON.stringify(options.body) : options.body;
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = response.statusText || 'Request failed';
    try {
      const payload = await response.json();
      detail = payload.error || payload.message || detail;
    } catch (_error) {
      // Silent fallback to status text
    }
    throw new Error(`${method} ${path} -> ${detail}`);
  }

  if (options.expect === 'text') {
    return response.text();
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function postJson(path, body, options = {}) {
  return fetchJson(path, {
    ...options,
    method: options.method || 'POST',
    body
  });
}
