import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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

function createAuditLogger() {
  return {
    record: async () => {}
  };
}

describe('API contracts (integration)', () => {
  let server;
  let baseUrl;

  let tradeManager;
  let tradingEngine;

  beforeEach(async () => {
    const tradingPairs = ['EURUSD'];

    tradeManager = {
      tradingPairs,
      getStatus: () => ({ enabled: true, pairs: tradingPairs }),
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
      },
      closeAllTrades: async () => ({ success: true, closed: 0 }),
      startAutoTrading: async () => ({ success: true, message: 'started' }),
      stopAutoTrading: () => ({ success: true, message: 'stopped' })
    };

    const activeTrades = new Map();
    const tradingHistory = [];

    tradingEngine = {
      config: {
        minSignalStrength: 35,
        riskPerTrade: 0.02,
        maxDailyRisk: 0.06,
        maxConcurrentTrades: 5,
        signalAmplifier: 2.5,
        directionThreshold: 12
      },
      activeTrades,
      tradingHistory,
      getStatistics: () => ({ totalTrades: tradingHistory.length }),
      observeSignalGeneration: () => {},
      recordTradeExecution: () => {},
      generateSignal: async (pair) => ({
        pair,
        direction: 'BUY',
        strength: 80,
        confidence: 75,
        finalScore: 78,
        components: {},
        entry: null,
        riskManagement: {},
        isValid: { isValid: true, checks: { ok: true }, reason: 'ok' },
        explainability: null,
        reasoning: ['test-signal']
      }),
      executeTrade: async (signal) => {
        const tradeId = randomUUID();
        const trade = {
          id: tradeId,
          pair: signal.pair,
          direction: signal.direction === 'SELL' ? 'SELL' : 'BUY',
          positionSize: 1,
          entryPrice: 1.2345,
          stopLoss: 1.23,
          takeProfit: 1.25,
          openTime: new Date(),
          closeTime: null,
          status: 'OPEN',
          closeReason: null,
          broker: null,
          currentPnL: null,
          finalPnL: null
        };
        activeTrades.set(tradeId, trade);
        tradingHistory.push(trade);
        return { success: true, trade, reason: null, signal };
      },
      getCurrentPriceForPair: async () => 1.2346,
      closeTrade: async (tradeId) => {
        const trade = activeTrades.get(tradeId);
        if (!trade) {
          throw new Error('Trade not found');
        }
        const closed = {
          ...trade,
          closeTime: new Date(),
          status: 'CLOSED',
          closeReason: 'manual_close'
        };
        activeTrades.delete(tradeId);
        tradingHistory.push(closed);
        return closed;
      }
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
      auditLogger: createAuditLogger(),
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

  it('GET /api/config returns current configuration', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.config.minSignalStrength, 35);
  });

  it('POST /api/config/update validates payload', async () => {
    const invalid = await fetch(`${baseUrl}/api/config/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ riskPerTrade: 10 })
    });
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json();
    assert.ok(invalidBody.requestId);

    const valid = await fetch(`${baseUrl}/api/config/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ riskPerTrade: 0.01, maxConcurrentTrades: 3 })
    });
    assert.equal(valid.status, 200);

    const body = await valid.json();
    assert.equal(body.success, true);
    assert.equal(body.config.riskPerTrade, 0.01);
    assert.equal(body.config.maxConcurrentTrades, 3);
  });

  it('pair add/remove endpoints update state', async () => {
    const resPairs = await fetch(`${baseUrl}/api/pairs`);
    assert.equal(resPairs.status, 200);
    const before = await resPairs.json();
    assert.equal(before.success, true);
    assert.deepEqual(before.pairs, ['EURUSD']);

    const add = await fetch(`${baseUrl}/api/pairs/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'GBPUSD' })
    });
    assert.equal(add.status, 200);
    const addBody = await add.json();
    assert.equal(addBody.success, true);
    assert.ok(addBody.pairs.includes('GBPUSD'));

    const remove = await fetch(`${baseUrl}/api/pairs/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'GBPUSD' })
    });
    assert.equal(remove.status, 200);
    const removeBody = await remove.json();
    assert.equal(removeBody.success, true);
    assert.ok(!removeBody.pairs.includes('GBPUSD'));
  });

  it('signal generation endpoint returns validated signal DTO', async () => {
    const bad = await fetch(`${baseUrl}/api/signal/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.ok(badBody.requestId);

    const good = await fetch(`${baseUrl}/api/signal/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'EURUSD' })
    });
    assert.equal(good.status, 200);

    const body = await good.json();
    assert.equal(body.success, true);
    assert.equal(body.signal.pair, 'EURUSD');
    assert.ok(['BUY', 'SELL', 'NEUTRAL'].includes(body.signal.direction));
    assert.equal(body.signal.isValid.isValid, true);
  });

  it('trade execute + close endpoints behave coherently', async () => {
    const execute = await fetch(`${baseUrl}/api/trade/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'EURUSD' })
    });
    assert.equal(execute.status, 200);

    const execBody = await execute.json();
    assert.equal(execBody.success, true);
    assert.ok(execBody.trade);
    assert.equal(execBody.trade.pair, 'EURUSD');

    const closeMissing = await fetch(`${baseUrl}/api/trade/close/not-real`, { method: 'POST' });
    assert.equal(closeMissing.status, 404);
    const closeMissingBody = await closeMissing.json();
    assert.ok(closeMissingBody.requestId);

    const close = await fetch(`${baseUrl}/api/trade/close/${execBody.trade.id}`, {
      method: 'POST'
    });
    assert.equal(close.status, 200);
    const closeBody = await close.json();
    assert.equal(closeBody.success, true);
    assert.equal(closeBody.trade.status, 'CLOSED');
  });

  it('unknown routes return JSON 404 with requestId', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.requestId);
  });
});
