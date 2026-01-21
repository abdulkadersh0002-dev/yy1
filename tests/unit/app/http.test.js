import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHttpApp } from '../../../src/app/http.js';

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

describe('http app', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const app = createHttpApp({
      tradingEngine: {
        priceDataFetcher: {
          providerConfigured: () => true,
          getAggregateDataConfidence: () => 75,
          metrics: null
        },
        newsAnalyzer: {
          apiKeys: { polygon: 'ok', finnhub: 'ok', newsApi: 'optional' }
        },
        economicAnalyzer: {
          cache: { size: 1 },
          apiKeys: {}
        },
        getStatistics: () => ({ totalTrades: 1 })
      },
      tradeManager: {
        getStatus: () => ({ enabled: true, pairs: ['EURUSD'] })
      },
      heartbeatMonitor: {
        getHeartbeat: () => ({ status: 'ok', timestamp: Date.now(), summary: { ok: true } })
      },
      brokerRouter: null,
      eaBridgeService: null,
      secretManager: null,
      auditLogger: null,
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

  it('serves /api/healthz', async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('x-request-id'));

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(typeof body.timestamp === 'number');
    assert.ok(body.status);
    assert.ok(Array.isArray(body.modules));
  });

  it('echoes incoming x-request-id', async () => {
    const res = await fetch(`${baseUrl}/api/healthz`, {
      headers: { 'x-request-id': 'test-request-id' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-request-id'), 'test-request-id');
  });

  it('serves /api/health/heartbeat', async () => {
    const res = await fetch(`${baseUrl}/api/health/heartbeat`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.heartbeat);
  });

  it('serves /api/health/providers', async () => {
    const res = await fetch(`${baseUrl}/api/health/providers?timeframes=M1,M5&qualityThreshold=60`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.classification);
    assert.ok(body.historyStats);
  });

  it('serves /api/metrics', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/i);

    const body = await res.text();
    assert.match(body, /metric/);
  });
});
