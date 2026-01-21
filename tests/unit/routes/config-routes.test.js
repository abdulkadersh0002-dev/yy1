import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import configRoutes from '../../../src/routes/config-routes.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';
import { createErrorHandler } from '../../../src/middleware/error-handler.js';

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

describe('config routes (unit)', () => {
  let server;
  let baseUrl;

  let tradingPairs;
  let tradeManager;
  let tradingEngine;

  beforeEach(async () => {
    tradingPairs = ['EURUSD'];

    tradeManager = {
      tradingPairs,
      addPair: (pair) => {
        const normalized = String(pair).toUpperCase();
        if (tradingPairs.includes(normalized)) {
          return { success: false, message: 'Pair already exists', pairs: tradingPairs };
        }
        tradingPairs.push(normalized);
        return { success: true, message: 'Pair added', pairs: tradingPairs };
      },
      removePair: (pair) => {
        const normalized = String(pair).toUpperCase();
        const idx = tradingPairs.indexOf(normalized);
        if (idx === -1) {
          return { success: false, message: 'Pair not found', pairs: tradingPairs };
        }
        tradingPairs.splice(idx, 1);
        return { success: true, message: 'Pair removed', pairs: tradingPairs };
      }
    };

    tradingEngine = {
      config: {
        minSignalStrength: 35,
        riskPerTrade: 0.02,
        maxDailyRisk: 0.06,
        maxConcurrentTrades: 5,
        signalAmplifier: 2.5,
        directionThreshold: 12
      }
    };

    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    app.use(
      '/api',
      configRoutes({
        tradingEngine,
        tradeManager,
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        requireConfigRead: (req, res, next) => next(),
        requireConfigWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

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

  it('GET /api/pairs returns current pairs', async () => {
    const res = await fetch(`${baseUrl}/api/pairs`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.deepEqual(body.pairs, ['EURUSD']);
    assert.equal(body.count, 1);
  });

  it('POST /api/pairs/add validates payload and can add', async () => {
    const bad = await fetch(`${baseUrl}/api/pairs/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.success, false);
    assert.ok(badBody.requestId);

    const good = await fetch(`${baseUrl}/api/pairs/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'GBPUSD' })
    });
    assert.equal(good.status, 200);
    const goodBody = await good.json();
    assert.equal(goodBody.success, true);
    assert.ok(goodBody.pairs.includes('GBPUSD'));
  });

  it('POST /api/pairs/remove validates payload and can remove', async () => {
    const bad = await fetch(`${baseUrl}/api/pairs/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(bad.status, 400);

    // add then remove
    await fetch(`${baseUrl}/api/pairs/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'GBPUSD' })
    });

    const good = await fetch(`${baseUrl}/api/pairs/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'GBPUSD' })
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(body.success, true);
    assert.ok(!body.pairs.includes('GBPUSD'));
  });

  it('GET /api/config returns engine config', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.config.minSignalStrength, 35);
    assert.equal(body.config.riskPerTrade, 0.02);
  });

  it('POST /api/config/update validates and applies updates', async () => {
    const bad = await fetch(`${baseUrl}/api/config/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ riskPerTrade: 10 })
    });
    assert.equal(bad.status, 400);

    const good = await fetch(`${baseUrl}/api/config/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ riskPerTrade: 0.01, maxConcurrentTrades: 3 })
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(body.success, true);
    assert.equal(tradingEngine.config.riskPerTrade, 0.01);
    assert.equal(tradingEngine.config.maxConcurrentTrades, 3);
  });
});
