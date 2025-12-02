import { createServer } from 'http';
import { createHttpApp } from './http.js';
import { createWebSocketLayer } from './websocket.js';

export function startServer({
  serverConfig,
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
  metricsRegistry,
  providerAvailabilityState,
  onClose
}) {
  const websocketLayer = createWebSocketLayer({
    server: null, // WebSocket layer attaches once HTTP server exists
    config: serverConfig,
    logger
  });

  const app = createHttpApp({
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
    broadcast: websocketLayer.broadcast,
    metricsRegistry,
    providerAvailabilityState
  });

  const server = createServer(app);

  // Now that server exists, update WebSocket layer if websockets are enabled
  websocketLayer.attach(server);

  const PORT = serverConfig.port;

  server.listen(PORT, () => {
    logger.info({ port: Number(PORT) }, 'Server listening');
  });

  server.on('close', () => {
    websocketLayer.shutdown();
    if (typeof onClose === 'function') {
      onClose();
    }
  });

  return { app, server, websocketLayer };
}
