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

describe('Trading routes (integration)', () => {
  let server;
  let baseUrl;

  let tradeManager;
  let tradingEngine;

  beforeEach(async () => {
    const tradingPairs = ['EURUSD', 'GBPUSD'];

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
      getStatistics: () => ({ totalTrades: tradingHistory.length, active: activeTrades.size }),
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

  it('GET /api/status returns trading status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.equal(body.status.enabled, true);
  });

  it('GET /api/statistics returns engine statistics', async () => {
    const res = await fetch(`${baseUrl}/api/statistics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.equal(typeof body.statistics.totalTrades, 'number');
  });

  it('POST /api/signal/batch validates payloads', async () => {
    const bad = await fetch(`${baseUrl}/api/signal/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.success, false);
    assert.ok(badBody.requestId);

    const good = await fetch(`${baseUrl}/api/signal/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairs: ['EURUSD', 'GBPUSD'] })
    });
    assert.equal(good.status, 200);
    const goodBody = await good.json();
    assert.equal(goodBody.success, true);
    assert.equal(goodBody.count, 2);
    assert.ok(Array.isArray(goodBody.signals));
  });

  it('active/history/close-all endpoints return coherent shapes', async () => {
    const execute = await fetch(`${baseUrl}/api/trade/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair: 'EURUSD' })
    });
    assert.equal(execute.status, 200);
    const executeBody = await execute.json();
    assert.equal(executeBody.success, true);

    const activeRes = await fetch(`${baseUrl}/api/trades/active`);
    assert.equal(activeRes.status, 200);
    const activeBody = await activeRes.json();
    assert.equal(activeBody.success, true);
    assert.ok(Array.isArray(activeBody.trades));

    const historyRes = await fetch(`${baseUrl}/api/trades/history?limit=1`);
    assert.equal(historyRes.status, 200);
    const historyBody = await historyRes.json();
    assert.equal(historyBody.success, true);
    assert.equal(historyBody.count, 1);
    assert.equal(historyBody.total >= 1, true);

    const closeAllRes = await fetch(`${baseUrl}/api/trade/close-all`, { method: 'POST' });
    assert.equal(closeAllRes.status, 200);
    const closeAllBody = await closeAllRes.json();
    assert.equal(closeAllBody.success, true);
    assert.ok(closeAllBody.result);
  });
});
