import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHttpApp } from '../../src/app/http.js';

async function startEphemeralServer(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) {
    server.close();
    throw new Error('Unable to determine ephemeral port');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

describe('Feature routes (integration)', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const tradingEngine = {
      config: {
        riskCommandCenter: {
          enabled: false
        }
      },
      featureStore: {
        getStats: () => ({ totalKeys: 1, totalEntries: 2, recent: [] })
      }
    };

    const tradeManager = {
      tradingPairs: ['EURUSD'],
      getStatus: () => ({ enabled: true, pairs: ['EURUSD'] }),
      closeAllTrades: async () => ({ success: true, closed: 0 })
    };

    const app = createHttpApp({
      tradingEngine,
      tradeManager,
      heartbeatMonitor: {
        getHeartbeat: () => ({ status: 'ok', timestamp: Date.now(), summary: { ok: true } })
      },
      brokerRouter: null,
      eaBridgeService: null,
      secretManager: null,
      auditLogger: { record: async () => {} },
      logger: createLogger(),
      broadcast: () => {},
      metricsRegistry: {
        register: {
          contentType: 'text/plain; version=0.0.4',
          metrics: async () => 'metric 1\n'
        }
      },
      providerAvailabilityState: {
        buildSnapshot: () => ({
          timestamp: Date.now(),
          providers: [],
          timeframes: [],
          aggregateQuality: null,
          normalizedQuality: null,
          dataConfidence: null,
          providerOrder: [],
          rateLimits: {},
          defaultAvailability: null
        }),
        providerAvailabilityAlertConfig: {},
        history: [],
        historyLimit: 10,
        loadProviderAvailabilityHistory: null
      }
    });

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise((resolve) => server.close(resolve));
    server = null;
    baseUrl = null;
  });

  it('GET /api/features returns stats envelope', async () => {
    const res = await fetch(`${baseUrl}/api/features`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.equal(body.stats.totalKeys, 1);
  });

  it('GET /api/risk/command-center returns 503 with requestId when disabled', async () => {
    const res = await fetch(`${baseUrl}/api/risk/command-center`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.requestId);
  });
});
