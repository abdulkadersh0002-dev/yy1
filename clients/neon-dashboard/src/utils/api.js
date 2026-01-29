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

const resolveDefaultBaseUrl = () => {
  const browserOrigin = resolveBrowserOrigin();
  if (!browserOrigin) {
    return 'http://localhost:4101';
  }

  if (import.meta.env.DEV) {
    try {
      const url = new URL(browserOrigin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        url.port = '4101';
        return url.toString().replace(/\/$/, '');
      }
    } catch (_error) {
      // ignore and fall back to browser origin
    }
  }

  return browserOrigin.replace(/\/$/, '');
};

const sanitizeBaseUrl = (value) => {
  const browserOrigin = resolveBrowserOrigin();

  if (!value) {
    return resolveDefaultBaseUrl();
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
      if (candidate.hostname === 'app') {
        return `${browserUrl.protocol}//${browserUrl.host}`;
      }
    }
    return candidate.toString();
  } catch (_error) {
    return resolveDefaultBaseUrl();
  }
};

const baseUrl = sanitizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

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

const inflightRequests = new Map();
const cachedResponses = new Map();

const resolveDefaultCacheTtlMs = () => {
  const raw = (import.meta.env.VITE_FETCH_CACHE_TTL_MS || '').trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return import.meta.env.DEV ? 250 : 0;
};

const defaultCacheTtlMs = resolveDefaultCacheTtlMs();

export const getApiConfig = () => ({
  baseUrl,
  wsUrl,
});

const buildHeaders = (baseHeaders = {}) => {
  const headers = new Headers(baseHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
};

const joinApiUrl = (path) => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (normalizedBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${normalizedBase}${normalizedPath.slice(4)}`;
  }
  if (normalizedBase.endsWith('/metrics') && normalizedPath === '/metrics') {
    return normalizedBase;
  }

  return `${normalizedBase}${normalizedPath}`;
};

export async function fetchJson(path, options = {}) {
  const url = joinApiUrl(path);
  const method = options.method || 'GET';
  const headers = buildHeaders(options.headers);

  const canDedupe =
    method === 'GET' &&
    options.body === undefined &&
    options.signal === undefined &&
    (options.headers == null || Object.keys(options.headers).length === 0);
  const dedupeKey = canDedupe ? `${method} ${url} expect:${options.expect || 'json'}` : null;

  const cacheTtlMsRaw = options.cacheTtlMs;
  const cacheTtlMs =
    typeof cacheTtlMsRaw === 'number' && Number.isFinite(cacheTtlMsRaw) && cacheTtlMsRaw >= 0
      ? cacheTtlMsRaw
      : defaultCacheTtlMs;
  const cacheKey = canDedupe && cacheTtlMs > 0 ? dedupeKey : null;

  if (cacheKey) {
    const cached = cachedResponses.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }
    cachedResponses.delete(cacheKey);
  }

  if (dedupeKey && inflightRequests.has(dedupeKey)) {
    return inflightRequests.get(dedupeKey);
  }

  const init = {
    method,
    headers,
    signal: options.signal,
  };

  if (options.body !== undefined) {
    const isObjectBody =
      typeof options.body === 'object' && options.body !== null && !options.rawBody;
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.body = isObjectBody ? JSON.stringify(options.body) : options.body;
  }
  if (options.withAuthToken) {
    const token =
      typeof window !== 'undefined' ? window.localStorage.getItem('neon_access_token') : null;
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const requestPromise = (async () => {
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
  })();

  if (cacheKey) {
    const expiresAt = Date.now() + cacheTtlMs;
    const cachedPromise = requestPromise.catch((error) => {
      const current = cachedResponses.get(cacheKey);
      if (current?.promise === cachedPromise) {
        cachedResponses.delete(cacheKey);
      }
      throw error;
    });
    cachedResponses.set(cacheKey, { expiresAt, promise: cachedPromise });
  }

  if (dedupeKey) {
    inflightRequests.set(dedupeKey, requestPromise);
  }

  try {
    return await requestPromise;
  } finally {
    if (dedupeKey) {
      inflightRequests.delete(dedupeKey);
    }
  }
}

export function postJson(path, body, options = {}) {
  return fetchJson(path, {
    ...options,
    method: options.method || 'POST',
    body,
  });
}
