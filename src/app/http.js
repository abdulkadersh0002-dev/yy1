import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { createApiAuthMiddleware } from '../middleware/api-auth.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { appConfig } from '../app/config.js';
import healthRoutes from '../../routes/health-routes.js';
import tradingRoutes from '../../routes/trading-routes.js';
import autoTradingRoutes from '../../routes/auto-trading-routes.js';
import configRoutes from '../../routes/config-routes.js';
import brokerRoutes from '../../routes/broker-routes.js';
import featureRoutes from '../../routes/feature-routes.js';
import eaBridgeRoutes from '../../routes/ea-bridge-routes.js';

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
    brokerRouting: brokerRoutingConfig
  } = appConfig;

  const requestBodyLimit = serverConfig.requestJsonLimit;

  // Security middleware
  app.use(helmet());
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
  const requireBrokerRead = apiAuth.requireAnyRole(['broker.read', 'admin']);
  const requireBrokerWrite = apiAuth.requireAnyRole(['broker.write', 'admin']);
  const requireSignalsGenerate = apiAuth.requireAnyRole(['signals.generate', 'admin']);
  const requireTradeExecute = apiAuth.requireAnyRole(['trade.execute', 'admin']);
  const requireTradeClose = apiAuth.requireAnyRole(['trade.close', 'trade.execute', 'admin']);
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
      providerAvailabilityState
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

  app.use(
    '/api',
    brokerRoutes({
      tradingEngine,
      brokerRouter,
      auditLogger,
      logger,
      config: { brokerRouting: brokerRoutingConfig },
      requireBrokerRead,
      requireBrokerWrite: [sensitiveRateLimiter, requireBrokerWrite]
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
      auditLogger,
      logger,
      requireBrokerWrite: [sensitiveRateLimiter, requireBrokerWrite]
    })
  );

  // Global error handler
  app.use((err, req, res, _next) => {
    logger.error({ err }, 'Server error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message
    });
  });

  return app;
}
