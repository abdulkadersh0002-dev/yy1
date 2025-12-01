import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { createApiAuthMiddleware } from '../middleware/api-auth.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { appConfig } from '../app/config.js';
import healthRoutes from '../../routes/health-routes.js';
import tradingRoutes from '../../routes/trading-routes.js';
import autoTradingRoutes from '../../routes/auto-trading-routes.js';
import configRoutes from '../../routes/config-routes.js';

export function createHttpApp({
  tradingEngine,
  tradeManager,
  heartbeatMonitor,
  brokerRouter,
  secretManager,
  auditLogger,
  logger,
  alertBus,
  pairPrefetchScheduler,
  services,
  broadcast,
  metricsRegistry,
  providerAvailabilityState
}) {
  const app = express();

  const {
    server: serverConfig,
    apiAuth: apiAuthConfig,
    trading: tradingConfig,
    alerting: alertingConfig,
    brokers: brokerConfig,
    brokerRouting: brokerRoutingConfig,
    services: serviceToggles,
    pairPrefetch: pairPrefetchSettings,
    autoTrading: autoTradingConfig,
    database: databaseConfig,
    env: rawEnv
  } = appConfig;

  const requestBodyLimit = serverConfig.requestJsonLimit;
  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

  const apiAuth = createApiAuthMiddleware({
    enabled: apiAuthConfig.enabled,
    secretManager,
    logger,
    auditLogger,
    exemptRoutes: [
      { method: 'GET', path: /^\/api\/health(\/.*)?$/ },
      { method: 'GET', path: /^\/api\/health\/heartbeat(\/.*)?$/ },
      { method: 'GET', path: /^\/metrics$/ },
      { path: /^\/api\/client(\/.*)?$/ }
    ]
  });

  const requireBasicRead = apiAuth.requireAnyRole(['read.basic', 'admin']);
  const requireRiskRead = apiAuth.requireAnyRole(['risk.read', 'admin']);
  const requireBrokerRead = apiAuth.requireAnyRole(['broker.read', 'admin']);
  const requireBrokerWrite = apiAuth.requireAnyRole(['broker.write', 'admin']);
  const requireSignalsGenerate = apiAuth.requireAnyRole(['signals.generate', 'admin']);
  const requireTradeExecute = apiAuth.requireAnyRole(['trade.execute', 'admin']);
  const requireTradeClose = apiAuth.requireAnyRole([
    'trade.close',
    'trade.execute',
    'admin'
  ]);
  const requireTradeRead = apiAuth.requireAnyRole(['trade.read', 'admin']);
  const requireAutomationControl = apiAuth.requireAnyRole(['automation.control', 'admin']);
  const requireConfigRead = apiAuth.requireAnyRole(['config.read', 'admin']);
  const requireConfigWrite = apiAuth.requireAnyRole(['config.write', 'admin']);

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
      metricsRegistry,
      logger,
      providerAvailabilityState,
      requireBasicRead
    })
  );

  app.use(
    '/api',
    tradingRoutes({
      tradingEngine,
      tradeManager,
      auditLogger,
      logger,
      broadcast,
      requireBasicRead,
      requireSignalsGenerate,
      requireTradeExecute,
      requireTradeRead,
      requireTradeClose
    })
  );

  app.use(
    '/api',
    autoTradingRoutes({
      tradeManager,
      auditLogger,
      logger,
      broadcast,
      requireAutomationControl: [sensitiveRateLimiter, requireAutomationControl]
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

  return app;
}
