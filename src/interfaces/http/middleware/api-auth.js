const DEFAULT_HEADER = 'x-api-key';
const DEFAULT_SECRET_NAME = 'api-auth-keys';
const DEFAULT_CACHE_MS = 60 * 1000;
import { appConfig } from '../../../app/config.js';

const normalizeKeys = (raw) => {
  if (!raw) {
    return new Map();
  }

  const entries = [];
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item) {
        return;
      }
      if (item.value || item.key) {
        entries.push({
          id: item.id || item.name || item.key,
          value: item.value || item.key,
          roles: Array.isArray(item.roles) ? item.roles : []
        });
      } else {
        Object.entries(item).forEach(([key, value]) => {
          if (typeof value === 'object') {
            entries.push({
              id: value.id || key,
              value: value.value || key,
              roles: value.roles || []
            });
          } else if (typeof value === 'string') {
            entries.push({ id: key, value, roles: [] });
          }
        });
      }
    });
  } else if (typeof raw === 'object') {
    if (Array.isArray(raw.keys)) {
      return normalizeKeys(raw.keys);
    }
    Object.entries(raw).forEach(([id, value]) => {
      if (!value) {
        return;
      }
      if (typeof value === 'string') {
        entries.push({ id, value, roles: [] });
      } else if (typeof value === 'object') {
        entries.push({
          id: value.id || id,
          value: value.value || value.key || id,
          roles: value.roles || []
        });
      }
    });
  } else if (typeof raw === 'string') {
    raw
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token, index) => {
        entries.push({ id: `key_${index}`, value: token, roles: [] });
      });
  }

  const map = new Map();
  entries.forEach((entry) => {
    if (!entry.value) {
      return;
    }
    map.set(entry.value, {
      id: entry.id || entry.value,
      roles: Array.isArray(entry.roles) ? entry.roles : []
    });
  });
  return map;
};

const pathMatches = (req, matcher) => {
  if (!matcher) {
    return false;
  }
  if (typeof matcher === 'string') {
    return req.path === matcher;
  }
  if (matcher instanceof RegExp) {
    return matcher.test(req.path);
  }
  return false;
};

export const createApiAuthMiddleware = (options = {}) => {
  const securityConfig = appConfig.security?.apiAuth || {};

  const enabled = options.enabled ?? securityConfig.enabled ?? true;
  const secretManager = options.secretManager;
  const logger = options.logger || console;
  const auditLogger = options.auditLogger || null;
  const headerName = (
    options.headerName ||
    securityConfig.headerName ||
    DEFAULT_HEADER
  ).toLowerCase();
  const secretName = options.secretName || securityConfig.secretName || DEFAULT_SECRET_NAME;
  const allowQueryKey = options.allowQueryKey ?? securityConfig.allowQueryKey ?? false;
  const cacheMs = Number.isFinite(options.cacheMs)
    ? options.cacheMs
    : Number.isFinite(securityConfig.cacheMs)
      ? securityConfig.cacheMs
      : DEFAULT_CACHE_MS;

  const exemptRoutes = options.exemptRoutes || [
    { method: 'GET', path: /^\/api\/health(\/.*)?$/ },
    { method: 'GET', path: /^\/api\/health\/heartbeat(\/.*)?$/ },
    { method: 'GET', path: /^\/metrics$/ }
  ];

  const cache = {
    expiresAt: 0,
    map: new Map()
  };

  const shouldSkip = (req) => {
    if (!enabled) {
      return true;
    }
    return exemptRoutes.some((rule) => {
      if (rule.method && rule.method.toUpperCase() !== req.method.toUpperCase()) {
        return false;
      }
      return pathMatches(req, rule.path);
    });
  };

  const loadKeys = async () => {
    if (!enabled) {
      return cache.map;
    }
    const now = Date.now();
    if (cache.expiresAt > now && cache.map.size) {
      return cache.map;
    }
    if (!secretManager) {
      logger?.warn?.('API auth enabled but SecretManager unavailable');
      cache.map = new Map();
      cache.expiresAt = now + cacheMs;
      return cache.map;
    }

    try {
      const secret = await secretManager.getJsonSecret(secretName);
      cache.map = normalizeKeys(secret);
      cache.expiresAt = now + cacheMs;
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to load API auth secrets');
      cache.map = new Map();
      cache.expiresAt = now + cacheMs;
    }
    return cache.map;
  };

  const authenticate = async (req, res, next) => {
    if (shouldSkip(req)) {
      return next();
    }

    const keys = await loadKeys();
    if (!keys.size) {
      logger?.warn?.('API authentication enforced but no keys configured');
      const _requestId = res?.locals?.requestId;
      return res.status(503).json({
        success: false,
        error: 'API authentication temporarily unavailable',
        ...(_requestId ? { requestId: _requestId } : null)
      });
    }

    const supplied = (
      req.headers[headerName] ||
      req.headers[headerName.toLowerCase()] ||
      (allowQueryKey ? req.query.api_key || req.query.key : '') ||
      ''
    )
      .toString()
      .trim();

    if (!supplied) {
      auditLogger?.record('auth.missing', {
        method: req.method,
        path: req.originalUrl || req.url,
        ip: req.ip
      });
      const _requestId = res?.locals?.requestId;
      return res.status(401).json({
        success: false,
        error: 'Missing API key',
        ...(_requestId ? { requestId: _requestId } : null)
      });
    }

    const entry = keys.get(supplied);
    if (!entry) {
      auditLogger?.record('auth.denied', {
        method: req.method,
        path: req.originalUrl || req.url,
        ip: req.ip
      });
      const _requestId = res?.locals?.requestId;
      return res.status(403).json({
        success: false,
        error: 'Invalid API key',
        ...(_requestId ? { requestId: _requestId } : null)
      });
    }

    const identity = {
      id: entry.id,
      roles: Array.from(new Set(entry.roles || [])),
      key: supplied
    };

    req.identity = identity;
    res.locals.identity = identity;
    auditLogger?.record('auth.granted', {
      method: req.method,
      path: req.originalUrl || req.url,
      id: identity.id,
      roles: identity.roles
    });

    return next();
  };

  const requireRoles = (roles = []) => {
    if (!roles.length || !enabled) {
      return (req, res, next) => next();
    }
    return (req, res, next) => {
      const identity = req.identity;
      if (!identity || !Array.isArray(identity.roles)) {
        const _requestId = res?.locals?.requestId;
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          ...(_requestId ? { requestId: _requestId } : null)
        });
      }
      const ok = roles.every((role) => identity.roles.includes(role));
      if (!ok) {
        auditLogger?.record('auth.forbidden', {
          method: req.method,
          path: req.originalUrl || req.url,
          id: identity.id,
          required: roles
        });
        const _requestId = res?.locals?.requestId;
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          ...(_requestId ? { requestId: _requestId } : null)
        });
      }
      return next();
    };
  };

  const requireAnyRole = (roles = []) => {
    if (!roles.length || !enabled) {
      return (req, res, next) => next();
    }
    return (req, res, next) => {
      const identity = req.identity;
      if (!identity || !Array.isArray(identity.roles)) {
        const _requestId = res?.locals?.requestId;
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          ...(_requestId ? { requestId: _requestId } : null)
        });
      }
      const ok = identity.roles.some((role) => roles.includes(role));
      if (!ok) {
        auditLogger?.record('auth.forbidden', {
          method: req.method,
          path: req.originalUrl || req.url,
          id: identity.id,
          anyOf: roles
        });
        const _requestId = res?.locals?.requestId;
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          ...(_requestId ? { requestId: _requestId } : null)
        });
      }
      return next();
    };
  };

  return {
    enabled,
    authenticate,
    requireRoles,
    requireAnyRole,
    loadKeys
  };
};
