import { createServer } from 'http';
import { createHttpApp } from '../interfaces/http/app.js';
import { createWebSocketLayer } from '../interfaces/ws/websocket.js';

export function startServer({
  serverConfig,
  tradingEngine,
  tradeManager,
  heartbeatMonitor,
  brokerRouter,
  eaBridgeService,
  secretManager,
  auditLogger,
  logger,
  alertBus,
  pairPrefetchScheduler,
  services,
  metricsRegistry,
  providerAvailabilityState,
  runtimeSummary,
  onClose,
  factories
}) {
  const createWebSocketLayerImpl = factories?.createWebSocketLayer || createWebSocketLayer;
  const createHttpAppImpl = factories?.createHttpApp || createHttpApp;
  const createServerImpl = factories?.createServer || createServer;

  const websocketLayer = createWebSocketLayerImpl({
    server: null, // WebSocket layer attaches once HTTP server exists
    config: serverConfig,
    logger
  });

  const app = createHttpAppImpl({
    tradingEngine,
    tradeManager,
    heartbeatMonitor,
    brokerRouter,
    eaBridgeService,
    secretManager,
    auditLogger,
    logger,
    alertBus,
    pairPrefetchScheduler,
    services,
    broadcast: websocketLayer.broadcast,
    metricsRegistry,
    providerAvailabilityState,
    runtimeSummary
  });

  const server = createServerImpl(app);

  // Now that server exists, update WebSocket layer if websockets are enabled
  websocketLayer.attach(server);

  const initialPort = Number(serverConfig.port);

  const shouldAllowFallback =
    serverConfig.nodeEnv !== 'production' &&
    serverConfig.nodeEnv !== 'test' &&
    serverConfig.enablePortFallback === true;

  const maxFallbackAttempts = shouldAllowFallback
    ? Math.max(0, Number(serverConfig.portFallbackAttempts ?? 10))
    : 0;

  let fallbackWarningEmitted = false;

  const listenWithFallback = (port, attemptsRemaining) => {
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' && attemptsRemaining > 0) {
        const nextPort = port + 1;
        if (!fallbackWarningEmitted) {
          logger.warn({ port, nextPort }, 'Port already in use; trying next available port');
          fallbackWarningEmitted = true;
        }
        listenWithFallback(nextPort, attemptsRemaining - 1);
        return;
      }

      if (error?.code === 'EADDRINUSE') {
        logger.error(
          {
            err: error,
            port,
            enablePortFallback: Boolean(serverConfig.enablePortFallback),
            nodeEnv: serverConfig.nodeEnv
          },
          'Port already in use. Set PORT to a free port (or ENABLE_PORT_FALLBACK=true in development).'
        );
      } else {
        logger.error({ err: error, port }, 'Server failed to start');
      }
      console.error('Server failed to start:', error?.code || 'error', error?.message || error);
      process.exit(1);
    });

    server.listen(port, () => {
      if (port !== initialPort && shouldAllowFallback && !fallbackWarningEmitted) {
        logger.warn({ initialPort, port }, 'Server started on fallback port');
        fallbackWarningEmitted = true;
      }
      logger.info({ port }, 'Server listening');
    });
  };

  listenWithFallback(initialPort, maxFallbackAttempts);

  server.on('close', () => {
    websocketLayer.shutdown();
    if (typeof onClose === 'function') {
      onClose();
    }
  });

  return { app, server, websocketLayer };
}
