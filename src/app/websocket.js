import WebSocket, { WebSocketServer } from 'ws';

export function createWebSocketLayer({ server, config, logger }) {
  const websocketClients = new Set();
  const enableWebSockets = config.enableWebSockets;
  const websocketPath = config.websocketPath;
  const websocketPingIntervalMs = config.websocketPingIntervalMs;

  const recentSignals = [];
  const maxRecentSignals = 40;

  const recentCandidateSignals = [];
  const maxRecentCandidateSignals = (() => {
    const raw = Number(process.env.WS_MAX_RECENT_CANDIDATE_SIGNALS);
    if (!Number.isFinite(raw)) {
      return 200;
    }
    return Math.max(20, Math.trunc(raw));
  })();

  let websocketHeartbeat;
  let wss;
  let initializeLogged = false;

  const broadcast = (type, payload) => {
    if (!enableWebSockets) {
      return;
    }

    if (type === 'signal' && payload) {
      try {
        recentSignals.unshift(payload);
        while (recentSignals.length > maxRecentSignals) {
          recentSignals.pop();
        }
      } catch (_error) {
        // best-effort
      }
    }

    if (type === 'signal_candidate' && payload) {
      try {
        recentCandidateSignals.unshift(payload);
        while (recentCandidateSignals.length > maxRecentCandidateSignals) {
          recentCandidateSignals.pop();
        }
      } catch (_error) {
        // best-effort
      }
    }

    if (websocketClients.size === 0) {
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

  const initializeServer = (httpServer) => {
    if (!enableWebSockets) {
      if (!initializeLogged) {
        logger?.info?.('WebSocket broadcasting disabled via ENABLE_WEBSOCKETS flag');
        initializeLogged = true;
      }
      return;
    }

    if (!httpServer || wss) {
      return;
    }

    wss = new WebSocketServer({ server: httpServer, path: websocketPath });

    wss.on('error', (error) => {
      logger?.warn?.({ err: error }, 'WebSocket server error');
    });

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

      // Replay recent strong signals so the dashboard has context immediately.
      if (recentSignals.length > 0) {
        try {
          socket.send(
            JSON.stringify({
              type: 'signals',
              payload: { items: recentSignals.slice(0, maxRecentSignals) },
              timestamp: Date.now()
            })
          );
        } catch (error) {
          logger?.warn?.({ err: error }, 'Failed to send recent signals to client');
        }
      }

      // Replay recent analyzed candidates (best-effort) so the dashboard can explain why ENTER=0.
      if (recentCandidateSignals.length > 0) {
        try {
          socket.send(
            JSON.stringify({
              type: 'signal_candidates',
              payload: { items: recentCandidateSignals.slice(0, maxRecentCandidateSignals) },
              timestamp: Date.now()
            })
          );
        } catch (error) {
          logger?.warn?.({ err: error }, 'Failed to send recent candidate signals to client');
        }
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
    initializeLogged = true;
  };

  if (server) {
    initializeServer(server);
  } else if (!enableWebSockets && !initializeLogged) {
    logger?.info?.('WebSocket broadcasting disabled via ENABLE_WEBSOCKETS flag');
    initializeLogged = true;
  }

  const shutdown = () => {
    if (websocketHeartbeat) {
      clearInterval(websocketHeartbeat);
      websocketHeartbeat = undefined;
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
    wss = undefined;
  };

  return {
    broadcast,
    shutdown,
    websocketClients,
    attach(serverInstance) {
      initializeServer(serverInstance);
    }
  };
}
