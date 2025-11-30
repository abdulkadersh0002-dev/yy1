export const createClientSessionMiddleware = ({
  tokenService,
  userService,
  auditLogger,
  logger
}) => {
  if (!tokenService || !userService) {
    throw new Error('Client session middleware requires tokenService and userService');
  }

  const authenticate = async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      if (!header.toLowerCase().startsWith('bearer ')) {
        auditLogger?.record?.('client.auth.missing', {
          path: req.originalUrl || req.url,
          ip: req.ip
        });
        return res.status(401).json({ success: false, error: 'Missing bearer token' });
      }

      const token = header.slice(7).trim();
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing bearer token' });
      }

      const payload = await tokenService.verifyAccessToken(token);
      if (!payload || payload.type !== 'access') {
        return res.status(401).json({ success: false, error: 'Invalid session token' });
      }

      const user = await userService.getById(payload.sub);
      if (!user) {
        auditLogger?.record?.('client.auth.unknown-user', {
          path: req.originalUrl || req.url,
          userId: payload.sub
        });
        return res.status(401).json({ success: false, error: 'Account disabled' });
      }

      if (user.status !== 'active') {
        auditLogger?.record?.('client.auth.inactive', {
          path: req.originalUrl || req.url,
          userId: user.id,
          status: user.status
        });
        return res.status(403).json({ success: false, error: 'Account inactive' });
      }

      if ((user.tokenVersion ?? 0) !== (payload.ver ?? 0)) {
        auditLogger?.record?.('client.auth.token-version-mismatch', {
          path: req.originalUrl || req.url,
          userId: user.id
        });
        return res.status(401).json({ success: false, error: 'Session expired' });
      }

      req.clientUser = {
        id: user.id,
        username: user.username,
        roles: user.roles,
        status: user.status
      };
      res.locals.clientUser = req.clientUser;
      return next();
    } catch (error) {
      logger?.warn?.({ err: error }, 'Client session authentication failed');
      auditLogger?.record?.('client.auth.error', {
        path: req.originalUrl || req.url,
        error: error?.message
      });
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
  };

  const requireRoles = (roles = []) => {
    if (!roles.length) {
      return (req, res, next) => next();
    }
    const normalized = roles.map((role) => `${role}`.trim().toLowerCase());
    return (req, res, next) => {
      const identity = req.clientUser;
      if (!identity || !Array.isArray(identity.roles)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const allowed = normalized.every((role) => identity.roles.includes(role));
      if (!allowed) {
        auditLogger?.record?.('client.auth.forbidden', {
          path: req.originalUrl || req.url,
          userId: identity.id,
          required: normalized
        });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      return next();
    };
  };

  const requireAnyRole = (roles = []) => {
    if (!roles.length) {
      return (req, res, next) => next();
    }
    const normalized = roles.map((role) => `${role}`.trim().toLowerCase());
    return (req, res, next) => {
      const identity = req.clientUser;
      if (!identity || !Array.isArray(identity.roles)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const allowed = identity.roles.some((role) => normalized.includes(role));
      if (!allowed) {
        auditLogger?.record?.('client.auth.forbidden-any', {
          path: req.originalUrl || req.url,
          userId: identity.id,
          options: normalized
        });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      return next();
    };
  };

  return {
    authenticate,
    requireRoles,
    requireAnyRole
  };
};
