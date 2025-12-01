import WebSocket, { WebSocketServer } from 'ws';

export function createWebSocketLayer({
  server,
  config,
  logger
}) {
  const websocketClients = new Set();
  const enableWebSockets = config.enableWebSockets;
  const websocketPath = config.websocketPath;
  const websocketPingIntervalMs = config.websocketPingIntervalMs;

  let websocketHeartbeat;
  let wss;

  const broadcast = (type, payload) => {
    if (!enableWebSockets || websocketClients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    });

    for (const client of websocketClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          logger?.warn?.({ err: error }, 'Failed to broadcast WebSocket message');
        }
      }
    }
  };

  if (enableWebSockets) {
    wss = new WebSocketServer({ server, path: websocketPath });

    wss.on('connection', (socket) => {
      socket.isAlive = true;
      websocketClients.add(socket);
      logger?.info?.({ activeClients: websocketClients.size }, 'WebSocket client connected');

      socket.on('pong', () => {
        socket.isAlive = true;
      });

      socket.on('close', () => {
        websocketClients.delete(socket);
        logger?.info?.({ activeClients: websocketClients.size }, 'WebSocket client disconnected');
      });

      socket.on('error', (error) => {
        logger?.warn?.({ err: error }, 'WebSocket client error');
      });

      try {
        socket.send(
          JSON.stringify({
            type: 'connected',
            timestamp: Date.now()
          })
        );
      } catch (error) {
        logger?.warn?.({ err: error }, 'Failed to send WebSocket welcome message');
      }
    });

    const heartbeatInterval = websocketPingIntervalMs > 5000 ? websocketPingIntervalMs : 30000;
    websocketHeartbeat = setInterval(() => {
      for (const socket of websocketClients) {
        if (socket.readyState !== WebSocket.OPEN) {
          websocketClients.delete(socket);
          continue;
        }

        if (socket.isAlive === false) {
          websocketClients.delete(socket);
          socket.terminate();
          continue;
        }

        socket.isAlive = false;
        try {
          socket.ping();
        } catch (error) {
          logger?.warn?.({ err: error }, 'WebSocket ping failed');
          websocketClients.delete(socket);
          socket.terminate();
        }
      }
    }, heartbeatInterval);

    logger?.info?.({ path: websocketPath }, 'WebSocket server initialized');
  } else {
    logger?.info?.('WebSocket broadcasting disabled via ENABLE_WEBSOCKETS flag');
  }

  const shutdown = () => {
    if (websocketHeartbeat) {
      clearInterval(websocketHeartbeat);
    }
    for (const socket of websocketClients) {
      try {
        socket.terminate();
      } catch (error) {
        logger?.warn?.({ err: error }, 'Failed to terminate WebSocket client');
      }
    }
    websocketClients.clear();
    wss?.close();
  };

  return {
    broadcast,
    shutdown,
    websocketClients
  };
}
