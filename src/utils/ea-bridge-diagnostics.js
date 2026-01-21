export function buildEaConnectionDiagnostics({ eaBridgeService, broker, symbol, maxAgeMs, now }) {
  const normalizedBroker = broker ? String(broker).trim().toLowerCase() : null;
  const effectiveNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const effectiveMaxAgeMs = Number.isFinite(Number(maxAgeMs))
    ? Math.max(0, Number(maxAgeMs))
    : 2 * 60 * 1000;

  const isConnected =
    normalizedBroker && eaBridgeService?.isBrokerConnected
      ? Boolean(
          eaBridgeService.isBrokerConnected({
            broker: normalizedBroker,
            maxAgeMs: effectiveMaxAgeMs
          })
        )
      : false;

  const sessions =
    typeof eaBridgeService?.getActiveSessions === 'function'
      ? eaBridgeService.getActiveSessions()
      : [];
  const brokerSessions = Array.isArray(sessions)
    ? sessions.filter(
        (s) =>
          String(s?.broker || '')
            .trim()
            .toLowerCase() === normalizedBroker
      )
    : [];
  const lastHeartbeat = brokerSessions.reduce(
    (max, s) => Math.max(max, Number(s?.lastHeartbeat || 0)),
    0
  );
  const lastHeartbeatAgeMs = lastHeartbeat > 0 ? Math.max(0, effectiveNow - lastHeartbeat) : null;

  const quotes =
    typeof eaBridgeService?.getQuotes === 'function' && normalizedBroker
      ? eaBridgeService.getQuotes({
          broker: normalizedBroker,
          ...(symbol ? { symbols: [String(symbol).trim().toUpperCase()] } : null),
          maxAgeMs: effectiveMaxAgeMs
        })
      : [];

  const quoteCount = Array.isArray(quotes) ? quotes.length : 0;
  const latestQuoteAt = Array.isArray(quotes)
    ? quotes.reduce((max, q) => Math.max(max, Number(q?.receivedAt || q?.timestamp || 0)), 0)
    : 0;
  const latestQuoteAgeMs = latestQuoteAt > 0 ? Math.max(0, effectiveNow - latestQuoteAt) : null;

  const stats =
    typeof eaBridgeService?.getStatistics === 'function' ? eaBridgeService.getStatistics() : null;
  const statsSummary = stats
    ? {
        activeSessions: Number(stats.activeSessions || 0),
        marketFeed: {
          quotesTotal: Number(stats?.marketFeed?.quotes?.total || 0),
          quotesByBroker: stats?.marketFeed?.quotes?.byBroker || {},
          snapshotsTotal: Number(stats?.marketFeed?.snapshots?.total || 0),
          barsSeries: Number(stats?.marketFeed?.bars?.series || 0),
          barsTotal: Number(stats?.marketFeed?.bars?.totalBars || 0)
        }
      }
    : null;

  return {
    broker: normalizedBroker,
    connected: isConnected,
    maxAgeMs: effectiveMaxAgeMs,
    sessions: {
      count: brokerSessions.length,
      lastHeartbeat,
      lastHeartbeatAgeMs
    },
    quotes: {
      count: quoteCount,
      latestQuoteAt,
      latestQuoteAgeMs
    },
    statistics: statsSummary
  };
}

export function buildEaNotConnectedResponse({ broker, symbol, eaBridgeService, maxAgeMs, now }) {
  const diagnostics = buildEaConnectionDiagnostics({
    broker,
    symbol,
    eaBridgeService,
    maxAgeMs,
    now
  });

  const upper = String(broker || '')
    .trim()
    .toUpperCase();
  const howToFix = [
    'Start the MT4/MT5 terminal on the same machine as the backend.',
    'Attach the EA bridge to an open chart and enable AutoTrading/Algo Trading.',
    'Confirm the EA is configured to POST heartbeats/quotes to this backend URL/port.',
    'Then refresh this request; the backend requires a fresh heartbeat or quote feed.'
  ];

  return {
    success: false,
    error: `Broker ${upper} is not connected yet`,
    broker:
      String(broker || '')
        .trim()
        .toLowerCase() || null,
    howToFix,
    diagnostics,
    nextChecks: {
      sessions: '/api/broker/bridge/sessions',
      statistics: '/api/broker/bridge/statistics',
      quotes: broker
        ? `/api/broker/bridge/${String(broker).trim().toLowerCase()}/market/quotes?maxAgeMs=30000`
        : null
    }
  };
}
