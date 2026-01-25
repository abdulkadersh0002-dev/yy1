import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createApiAuthMiddleware } from '../middleware/api-auth.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { requestIdMiddleware } from '../middleware/request-id.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { appConfig } from '../app/config.js';
import healthRoutes from '../routes/health-routes.js';
import tradingRoutes from '../routes/trading-routes.js';
import autoTradingRoutes from '../routes/auto-trading-routes.js';
import configRoutes from '../routes/config-routes.js';
import brokerRoutes from '../routes/broker-routes.js';
import featureRoutes from '../routes/feature-routes.js';
import eaBridgeRoutes from '../routes/ea-bridge-routes.js';
import scenarioRoutes from '../routes/scenario-routes.js';
import { createClientExperienceModule } from '../routes/client-experience.js';
import { notFound } from '../utils/http-response.js';

export function createHttpApp({
  tradingEngine,
  tradeManager,
  heartbeatMonitor,
  brokerRouter,
  eaBridgeService,
  secretManager,
  auditLogger,
  logger,
  broadcast,
  metricsRegistry,
  providerAvailabilityState
}) {
  const app = express();

  const {
    server: serverConfig,
    apiAuth: apiAuthConfig,
    brokerRouting: brokerRoutingConfig,
    security: securityConfig
  } = appConfig;

  const allowPublicEaBridge = securityConfig?.allowPublicEaBridge === true;

  const requestBodyLimit = serverConfig.requestJsonLimit;

  app.disable('x-powered-by');

  // Security middleware
  app.use(helmet());

  // API responses don't benefit from browser-focused headers like CSP/X-XSS-Protection.
  // Keep Helmet defaults for the dashboard/static HTML, but strip these from /api.
  app.use('/api', (req, res, next) => {
    try {
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Content-Security-Policy-Report-Only');
      res.removeHeader('X-XSS-Protection');
    } catch (_error) {
      // best-effort
    }
    next();
  });
  app.use(compression());
  const allowedOrigins = Array.isArray(securityConfig?.cors?.allowedOrigins)
    ? securityConfig.cors.allowedOrigins
    : [];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        if (!allowedOrigins.length) {
          if (serverConfig.nodeEnv !== 'production') {
            return callback(null, true);
          }
          return callback(null, false);
        }
        return callback(null, allowedOrigins.includes(origin));
      },
      credentials: securityConfig?.cors?.allowCredentials === true
    })
  );
  app.use(requestIdMiddleware());
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

  const apiAuth = createApiAuthMiddleware({
    enabled: apiAuthConfig.enabled,
    secretManager,
    logger,
    auditLogger,
    allowQueryKey: securityConfig?.apiAuth?.allowQueryKey,
    exemptRoutes: [
      { method: 'GET', path: /^\/api\/health(\/.*)?$/ },
      { method: 'GET', path: /^\/api\/health\/heartbeat(\/.*)?$/ },
      { method: 'GET', path: /^\/metrics$/ },
      { path: /^\/api\/client(\/.*)?$/ },
      ...(allowPublicEaBridge ? [{ path: /^\/api\/broker\/bridge(\/.*)?$/ }] : [])
    ]
  });

  const requireBasicRead = apiAuth.requireAnyRole(['read.basic', 'admin']);
  const requireBrokerRead = apiAuth.requireAnyRole(['broker.read', 'admin']);
  const requireBrokerWrite = apiAuth.requireAnyRole(['broker.write', 'admin']);
  const requireSignalsGenerate = apiAuth.requireAnyRole(['signals.generate', 'admin']);
  const requireTradeExecute = apiAuth.requireAnyRole(['trade.execute', 'admin']);
  const requireTradeClose = apiAuth.requireAnyRole(['trade.close', 'trade.execute', 'admin']);
  const requireTradeRead = apiAuth.requireAnyRole(['trade.read', 'admin']);
  const requireAutomationControl = apiAuth.requireAnyRole(['automation.control', 'admin']);
  const requireConfigRead = apiAuth.requireAnyRole(['config.read', 'admin']);
  const requireConfigWrite = apiAuth.requireAnyRole(['config.write', 'admin']);

  const requireExecutionScope = (req, res, next) => {
    if (appConfig.tradingScope?.allowExecution) {
      return next();
    }
    const _requestId = res?.locals?.requestId;
    return res.status(403).json({
      success: false,
      error: 'Trade execution is disabled (TRADING_SCOPE=signals)',
      ...(_requestId ? { requestId: _requestId } : null)
    });
  };

  const sensitiveRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    logger
  });

  app.use('/api', apiAuth.authenticate);

  app.use(
    '/api',
    healthRoutes({
      tradingEngine,
      tradeManager,
      heartbeatMonitor,
      eaBridgeService,
      metricsRegistry,
      logger,
      providerAvailabilityState
    })
  );

  app.use(
    '/api',
    tradingRoutes({
      tradingEngine,
      tradeManager,
      eaBridgeService,
      auditLogger,
      logger,
      broadcast,
      requireBasicRead,
      requireSignalsGenerate,
      requireTradeExecute: [requireExecutionScope, requireTradeExecute],
      requireTradeRead,
      requireTradeClose: [requireExecutionScope, requireTradeClose]
    })
  );

  app.use(
    '/api',
    scenarioRoutes({
      tradingEngine,
      eaBridgeService,
      logger,
      requireSignalsGenerate
    })
  );

  app.use(
    '/api',
    autoTradingRoutes({
      tradeManager,
      eaBridgeService,
      auditLogger,
      logger,
      broadcast,
      requireAutomationControl: [
        requireExecutionScope,
        sensitiveRateLimiter,
        requireAutomationControl
      ],
      requireBasicRead
    })
  );

  app.use(
    '/api',
    configRoutes({
      tradingEngine,
      tradeManager,
      auditLogger,
      logger,
      requireConfigRead,
      requireConfigWrite: [sensitiveRateLimiter, requireConfigWrite]
    })
  );

  app.use(
    '/api',
    brokerRoutes({
      tradingEngine,
      brokerRouter,
      auditLogger,
      logger,
      config: { brokerRouting: brokerRoutingConfig },
      requireBrokerRead,
      requireBrokerWrite: [requireExecutionScope, sensitiveRateLimiter, requireBrokerWrite]
    })
  );

  app.use(
    '/api',
    featureRoutes({
      tradingEngine,
      logger,
      requireBasicRead
    })
  );

  // EA Bridge routes (MT4/MT5 Expert Advisor communication)
  app.use(
    '/api',
    eaBridgeRoutes({
      eaBridgeService,
      tradingEngine,
      brokerRouter,
      tradeManager,
      auditLogger,
      logger,
      broadcast,
      requireBrokerWrite: allowPublicEaBridge ? null : [sensitiveRateLimiter, requireBrokerWrite]
    })
  );

  app.use(
    '/api/client',
    createClientExperienceModule({
      secretManager,
      auditLogger,
      logger,
      tradingEngine,
      tradeManager,
      brokerRouter
    }).router
  );

  const projectRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
  const dashboardDistDir = path.join(projectRoot, 'clients', 'neon-dashboard', 'dist');
  const dashboardIndexFile = path.join(dashboardDistDir, 'index.html');
  const serveDashboard =
    serverConfig.nodeEnv === 'production' ||
    String(process.env.SERVE_DASHBOARD || '')
      .trim()
      .toLowerCase() === 'true';

  if (serveDashboard && fs.existsSync(dashboardIndexFile)) {
    app.use(express.static(dashboardDistDir));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/metrics')) {
        return next();
      }

      res.sendFile(dashboardIndexFile);
    });
  }

  // Not found handler (JSON)
  app.use((req, res) => notFound(res));

  // Global error handler
  app.use(createErrorHandler({ logger }));

  return app;
}
