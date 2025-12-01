import express from 'express';
import ClientUserService from '../services/client-auth/user-service.js';
import ClientTokenService from '../services/client-auth/token-service.js';
import ClientDeviceService from '../services/client-auth/device-service.js';
import { createClientSessionMiddleware } from '../middleware/client-session.js';

const ACCESS_EXPIRES_IN_SECONDS = 15 * 60;

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    roles: Array.isArray(user.roles) ? user.roles : [],
    status: user.status || 'inactive',
    mfa: {
      enabled: Boolean(user.mfaEnabled),
      configured: Boolean(user.mfaConfigured)
    },
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    tokenVersion: user.tokenVersion ?? 0
  };
};

const issueSessionTokens = async ({ user, tokenService }) => {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const version = user.tokenVersion ?? 0;
  const [accessToken, refreshToken] = await Promise.all([
    tokenService.signAccessToken({
      type: 'access',
      sub: user.id,
      username: user.username,
      roles,
      ver: version
    }),
    tokenService.signRefreshToken({
      type: 'refresh',
      sub: user.id,
      ver: version
    })
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES_IN_SECONDS
  };
};

const createMfaChallenge = async ({ user, tokenService }) =>
  tokenService.signChallengeToken({
    type: 'mfa-challenge',
    sub: user.id,
    username: user.username,
    ver: user.tokenVersion ?? 0
  });

export const createClientExperienceModule = ({
  secretManager,
  auditLogger,
  logger = console,
  tradingEngine,
  tradeManager,
  brokerRouter
}) => {
  if (!tradingEngine || !tradeManager) {
    throw new Error('Client experience module requires tradingEngine and tradeManager');
  }

  const router = express.Router();
  const userService = new ClientUserService({ logger });
  const tokenService = new ClientTokenService({ secretManager, logger });
  const deviceService = new ClientDeviceService({ logger });
  const session = createClientSessionMiddleware({ tokenService, userService, auditLogger, logger });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    try {
      const user = await userService.getByUsername(username);
      if (!user) {
        auditLogger?.record?.('client.login.failed', { username, reason: 'unknown-user' });
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }

      if (user.status !== 'active') {
        auditLogger?.record?.('client.login.failed', { userId: user.id, reason: 'inactive' });
        return res.status(403).json({ success: false, error: 'Account inactive' });
      }

      const passwordValid = await userService.verifyPassword(user, password);
      if (!passwordValid) {
        auditLogger?.record?.('client.login.failed', { userId: user.id, reason: 'bad-password' });
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }

      if (user.mfaEnabled) {
        const challengeToken = await createMfaChallenge({ user, tokenService });
        auditLogger?.record?.('client.login.mfa-required', { userId: user.id });
        return res.json({
          success: true,
          mfaRequired: true,
          challengeToken,
          methods: ['totp']
        });
      }

      await userService.recordLogin(user.id);
      const sessionPayload = await issueSessionTokens({ user, tokenService });
      auditLogger?.record?.('client.login.success', { userId: user.id });
      return res.json({
        success: true,
        ...sessionPayload,
        user: sanitizeUser(user)
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Client login failed');
      return res.status(500).json({ success: false, error: 'Login failed' });
    }
  });

  router.post('/login/mfa', async (req, res) => {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res
        .status(400)
        .json({ success: false, error: 'Challenge token and code are required' });
    }

    try {
      const challenge = await tokenService.verifyChallengeToken(challengeToken);
      if (!challenge || challenge.type !== 'mfa-challenge') {
        return res.status(400).json({ success: false, error: 'Invalid challenge' });
      }

      const user = await userService.getById(challenge.sub);
      if (!user || user.status !== 'active') {
        auditLogger?.record?.('client.login.failed', {
          userId: challenge.sub,
          reason: 'unknown-or-inactive'
        });
        return res.status(401).json({ success: false, error: 'Invalid challenge' });
      }

      const valid = await userService.validateActiveMfa(user, code);
      if (!valid) {
        auditLogger?.record?.('client.login.mfa-failed', { userId: user.id });
        return res.status(401).json({ success: false, error: 'Verification failed' });
      }

      await userService.recordLogin(user.id);
      const sessionPayload = await issueSessionTokens({ user, tokenService });
      auditLogger?.record?.('client.login.success', { userId: user.id, via: 'mfa' });
      return res.json({
        success: true,
        ...sessionPayload,
        user: sanitizeUser(user)
      });
    } catch (error) {
      logger?.warn?.({ err: error }, 'Client MFA completion failed');
      return res.status(500).json({ success: false, error: 'Verification failed' });
    }
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }

    try {
      const payload = await tokenService.verifyRefreshToken(refreshToken);
      if (!payload || payload.type !== 'refresh') {
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      const user = await userService.getById(payload.sub);
      if (!user || user.status !== 'active') {
        return res.status(401).json({ success: false, error: 'Account inactive' });
      }

      if ((user.tokenVersion ?? 0) !== (payload.ver ?? 0)) {
        return res.status(401).json({ success: false, error: 'Session expired' });
      }

      const sessionPayload = await issueSessionTokens({ user, tokenService });
      return res.json({ success: true, ...sessionPayload });
    } catch (error) {
      logger?.warn?.({ err: error }, 'Client session refresh failed');
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
  });

  router.post('/logout', session.authenticate, async (req, res) => {
    try {
      await userService.bumpTokenVersion(req.clientUser.id);
      auditLogger?.record?.('client.logout', { userId: req.clientUser.id });
      return res.json({ success: true });
    } catch (error) {
      logger?.warn?.({ err: error }, 'Client logout failed');
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
  });

  router.get('/me', session.authenticate, async (req, res) => {
    const user = await userService.getById(req.clientUser.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    return res.json({ success: true, user: sanitizeUser(user) });
  });

  router.post('/mfa/setup', session.authenticate, async (req, res) => {
    try {
      const user = await userService.getById(req.clientUser.id);
      const enrollment = await userService.generateMfaSecret(user);
      auditLogger?.record?.('client.mfa.setup', { userId: user.id });
      return res.json({ success: true, ...enrollment });
    } catch (error) {
      logger?.error?.({ err: error }, 'MFA setup failed');
      return res.status(500).json({ success: false, error: 'Failed to start MFA enrollment' });
    }
  });

  router.post('/mfa/activate', session.authenticate, async (req, res) => {
    try {
      const { code } = req.body || {};
      if (!code) {
        return res.status(400).json({ success: false, error: 'Verification code required' });
      }
      const user = await userService.getById(req.clientUser.id);
      const result = await userService.activateMfa(user, code);
      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: result.error || 'Verification failed' });
      }
      auditLogger?.record?.('client.mfa.activated', { userId: user.id });
      await userService.bumpTokenVersion(user.id);
      return res.json({ success: true });
    } catch (error) {
      logger?.warn?.({ err: error }, 'MFA activate failed');
      return res.status(500).json({ success: false, error: 'Failed to activate MFA' });
    }
  });

  router.delete('/mfa', session.authenticate, async (req, res) => {
    try {
      await userService.disableMfa(req.clientUser.id);
      await userService.bumpTokenVersion(req.clientUser.id);
      auditLogger?.record?.('client.mfa.disabled', { userId: req.clientUser.id });
      return res.json({ success: true });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to disable MFA');
      return res.status(500).json({ success: false, error: 'Failed to disable MFA' });
    }
  });

  router.get('/dashboard/status', session.authenticate, async (req, res) => {
    try {
      const status = tradeManager.getStatus();
      const statistics = tradingEngine.getStatistics();
      const activeTrades = Array.from(tradingEngine.activeTrades.values());
      const brokerRoutingEnabled = Boolean(tradingEngine?.hasBrokerRouting?.());

      const signals = activeTrades
        .map((trade) => {
          if (!trade?.signal) {
            return null;
          }

          const { signal } = trade;
          const primaryTechnical = signal.components?.technical?.signals?.[0] || null;
          const safeNumber = (value) => (Number.isFinite(value) ? Number(value) : null);
          const entry = {
            price: trade.entryPrice ?? signal.entry?.price ?? null,
            stopLoss: trade.stopLoss ?? signal.entry?.stopLoss ?? null,
            takeProfit: trade.takeProfit ?? signal.entry?.takeProfit ?? null,
            riskReward: safeNumber(signal.entry?.riskReward),
            atr: safeNumber(signal.entry?.atr),
            stopMultiple: safeNumber(signal.entry?.stopMultiple),
            takeProfitMultiple: safeNumber(signal.entry?.takeProfitMultiple),
            trailingStop: signal.entry?.trailingStop || trade.trailingStop || null,
            volatilityState:
              signal.entry?.volatilityState ||
              signal.components?.technical?.volatilitySummary?.state ||
              null
          };

          const validation =
            signal.validation ||
            (signal.isValid != null ? { isValid: Boolean(signal.isValid) } : null);

          return {
            id: trade.id,
            pair: trade.pair,
            direction: signal.direction || trade.direction || 'NEUTRAL',
            openedAt: trade.openTime || trade.openedAt || null,
            strength: safeNumber(signal.strength),
            confidence: safeNumber(signal.confidence),
            estimatedWinRate: safeNumber(signal.estimatedWinRate),
            finalScore: safeNumber(signal.finalScore),
            validation,
            entry,
            technical: primaryTechnical
              ? {
                  type: primaryTechnical.type || null,
                  timeframe: primaryTechnical.timeframe || null,
                  confidence: safeNumber(primaryTechnical.confidence),
                  strength: safeNumber(primaryTechnical.strength)
                }
              : null,
            regime: signal.components?.technical?.regimeSummary?.state || null,
            broker: trade.broker || trade.brokerRoute || null,
            status: trade.status || 'open'
          };
        })
        .filter(Boolean);

      let brokers = {
        enabled: brokerRoutingEnabled,
        defaultBroker: tradingEngine?.config?.brokerRouting?.defaultBroker || null,
        connectors: [],
        killSwitchEnabled: brokerRoutingEnabled ? Boolean(brokerRouter?.killSwitchEnabled) : false,
        killSwitchReason: brokerRoutingEnabled ? brokerRouter?.killSwitchReason || null : null,
        lastSyncAt: brokerRoutingEnabled ? brokerRouter?.lastSyncAt || null : null,
        recentOrders: [],
        health: []
      };

      if (brokerRoutingEnabled && brokerRouter) {
        try {
          const statusSnapshot = brokerRouter.getStatus?.();
          const healthSnapshots = await brokerRouter.getHealthSnapshots?.();
          brokers = {
            ...brokers,
            connectors: statusSnapshot?.connectors || brokers.connectors,
            lastSyncAt: statusSnapshot?.lastSyncAt || brokers.lastSyncAt,
            killSwitchEnabled: statusSnapshot?.killSwitchEnabled ?? brokers.killSwitchEnabled,
            killSwitchReason: statusSnapshot?.killSwitchReason ?? brokers.killSwitchReason,
            recentOrders: statusSnapshot?.recentOrders || brokers.recentOrders,
            health: Array.isArray(healthSnapshots) ? healthSnapshots : brokers.health
          };
        } catch (brokerError) {
          logger?.warn?.(
            { err: brokerError },
            'Failed to enrich broker status for client dashboard'
          );
        }
      }

      return res.json({
        success: true,
        data: {
          trading: status,
          statistics,
          activeTrades,
          signals,
          brokers
        }
      });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to fetch dashboard status');
      return res.status(500).json({ success: false, error: 'Failed to load status' });
    }
  });

  router.get('/devices', session.authenticate, async (req, res) => {
    try {
      const devices = await deviceService.listDevices(req.clientUser.id);
      return res.json({ success: true, devices });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to list devices');
      return res.status(500).json({ success: false, error: 'Failed to load devices' });
    }
  });

  router.post('/devices/register', session.authenticate, async (req, res) => {
    try {
      const {
        platform,
        token,
        subscription,
        deviceName,
        osName,
        osVersion,
        appVersion,
        buildNumber,
        locale,
        timezone,
        userAgent
      } = req.body || {};
      if (!platform) {
        return res.status(400).json({ success: false, error: 'Platform required' });
      }
      const device = await deviceService.upsertDevice({
        userId: req.clientUser.id,
        platform,
        token,
        subscription,
        deviceName,
        osName,
        osVersion,
        appVersion,
        buildNumber,
        locale,
        timezone,
        userAgent: userAgent || req.get('user-agent')
      });
      auditLogger?.record?.('client.device.register', {
        userId: req.clientUser.id,
        platform: device?.platform,
        deviceId: device?.id
      });
      return res.json({ success: true, device });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to register device');
      return res.status(500).json({ success: false, error: 'Failed to register device' });
    }
  });

  router.delete('/devices/:deviceId', session.authenticate, async (req, res) => {
    const { deviceId } = req.params || {};
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID required' });
    }
    try {
      const removed = await deviceService.removeDevice({ userId: req.clientUser.id, deviceId });
      if (!removed) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }
      auditLogger?.record?.('client.device.unregister', { userId: req.clientUser.id, deviceId });
      return res.json({ success: true });
    } catch (error) {
      logger?.error?.({ err: error }, 'Failed to remove device');
      return res.status(500).json({ success: false, error: 'Failed to remove device' });
    }
  });

  router.post(
    '/control/auto-trading',
    session.authenticate,
    session.requireAnyRole(['operator', 'admin']),
    async (req, res) => {
      try {
        const { enabled } = req.body || {};
        const shouldEnable = Boolean(enabled);
        let result;
        if (shouldEnable) {
          result = await tradeManager.startAutoTrading();
        } else {
          result = tradeManager.stopAutoTrading();
        }
        auditLogger?.record?.('client.control.auto-trading', {
          userId: req.clientUser.id,
          enabled: shouldEnable,
          success: result?.success
        });
        return res.json({ success: true, result });
      } catch (error) {
        logger?.error?.({ err: error }, 'Auto trading toggle failed');
        return res.status(500).json({ success: false, error: 'Failed to toggle auto trading' });
      }
    }
  );

  router.post(
    '/control/close-all',
    session.authenticate,
    session.requireAnyRole(['operator', 'admin']),
    async (req, res) => {
      try {
        const result = await tradeManager.closeAllTrades();
        auditLogger?.record?.('client.control.close-all', {
          userId: req.clientUser.id,
          closed: result?.closed,
          failed: result?.failed
        });
        return res.json({ success: true, result });
      } catch (error) {
        logger?.error?.({ err: error }, 'Close all trades failed');
        return res.status(500).json({ success: false, error: 'Failed to close trades' });
      }
    }
  );

  return {
    router,
    userService,
    tokenService,
    deviceService,
    session
  };
};
