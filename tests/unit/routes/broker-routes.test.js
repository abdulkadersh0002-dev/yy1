import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import brokerRoutes from '../../../src/routes/broker-routes.js';
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

describe('broker routes (unit)', () => {
  let server;
  let baseUrl;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise((resolve) => server.close(resolve));
    server = null;
    baseUrl = null;
  });

  it('returns 503 serviceUnavailable when disabled', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    app.use(
      '/api',
      brokerRoutes({
        tradingEngine: { activeTrades: new Map() },
        brokerRouter: {},
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        config: { brokerRouting: { enabled: false } },
        requireBrokerRead: (req, res, next) => next(),
        requireBrokerWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/broker/status`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Broker routing disabled');
    assert.ok(body.requestId);
  });

  it('maps UNKNOWN_CONNECTOR to 404 notFound', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    const brokerRouter = {
      defaultBroker: 'mt5',
      getStatus: () => ({ routing: 'ok' }),
      getHealthSnapshots: async () => [],
      probeConnector: async () => {
        const err = new Error('Unknown connector');
        err.code = 'UNKNOWN_CONNECTOR';
        throw err;
      }
    };

    app.use(
      '/api',
      brokerRoutes({
        tradingEngine: { activeTrades: new Map() },
        brokerRouter,
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        config: { brokerRouting: { enabled: true } },
        requireBrokerRead: (req, res, next) => next(),
        requireBrokerWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/broker/connectors/unknown/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.requestId);
  });

  it('handles probeConnector validation and upstream failures', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    const brokerRouter = {
      defaultBroker: 'mt5',
      getStatus: () => ({ routing: 'ok' }),
      getHealthSnapshots: async () => [],
      probeConnector: async (id) => {
        if (id === 'invalid') {
          const err = new Error('Invalid connector id');
          err.code = 'INVALID_CONNECTOR_ID';
          throw err;
        }
        if (id === 'unsupported') {
          const err = new Error('Unsupported action');
          err.code = 'UNSUPPORTED_ACTION';
          throw err;
        }
        if (id === 'failed') {
          const err = new Error('Upstream failed');
          err.code = 'CONNECTOR_ACTION_FAILED';
          throw err;
        }
        if (id === 'boom') {
          throw new Error('Unexpected');
        }
        return { id, ok: true };
      }
    };

    app.use(
      '/api',
      brokerRoutes({
        tradingEngine: { activeTrades: new Map() },
        brokerRouter,
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        config: { brokerRouting: { enabled: true } },
        requireBrokerRead: (req, res, next) => next(),
        requireBrokerWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const invalidRes = await fetch(`${baseUrl}/api/broker/connectors/invalid/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });
    assert.equal(invalidRes.status, 400);

    const unsupportedRes = await fetch(`${baseUrl}/api/broker/connectors/unsupported/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });
    assert.equal(unsupportedRes.status, 400);

    const failedRes = await fetch(`${baseUrl}/api/broker/connectors/failed/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });
    assert.equal(failedRes.status, 502);
    const failedBody = await failedRes.json();
    assert.equal(failedBody.success, false);
    assert.ok(failedBody.requestId);

    const boomRes = await fetch(`${baseUrl}/api/broker/connectors/boom/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });
    assert.equal(boomRes.status, 500);
  });

  it('returns 503 when trading modify API is disabled', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    app.use(
      '/api',
      brokerRoutes({
        tradingEngine: { activeTrades: new Map() },
        brokerRouter: { defaultBroker: 'mt5' },
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        config: { brokerRouting: { enabled: true }, tradingModifyApi: { enabled: false } },
        requireBrokerRead: (req, res, next) => next(),
        requireBrokerWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/broker/positions/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ broker: 'mt5', ticket: '123', symbol: 'EURUSD', stopLoss: 1.2345 })
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Trading modify API disabled');
    assert.ok(body.requestId);
  });

  it('accepts validated modify payload and routes to brokerRouter.modifyPosition', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    const calls = [];
    const brokerRouter = {
      defaultBroker: 'mt5',
      modifyPosition: async (payload) => {
        calls.push(payload);
        return { success: true, broker: payload.broker, result: { ok: true } };
      }
    };

    app.use(
      '/api',
      brokerRoutes({
        tradingEngine: { activeTrades: new Map() },
        brokerRouter,
        auditLogger: { record: async () => {} },
        logger: createLogger(),
        config: { brokerRouting: { enabled: true }, tradingModifyApi: { enabled: true } },
        requireBrokerRead: (req, res, next) => next(),
        requireBrokerWrite: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/broker/positions/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        broker: 'mt5',
        id: '999',
        pair: 'EURUSD',
        sl: '1.11111',
        reason: 'breakeven'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.equal(body.result?.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].broker, 'mt5');
    assert.equal(String(calls[0].ticket), '999');
    assert.equal(calls[0].symbol, 'EURUSD');
    assert.equal(calls[0].stopLoss, 1.11111);
  });
});
