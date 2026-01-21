import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import brokerRoutes from '../../src/routes/broker-routes.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { createErrorHandler } from '../../src/middleware/error-handler.js';

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

describe('Broker routes (integration)', () => {
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

  it('returns 503 with requestId when broker routing disabled', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    const router = brokerRoutes({
      tradingEngine: { activeTrades: new Map() },
      brokerRouter: {
        getStatus: () => ({ ok: true }),
        getHealthSnapshots: async () => []
      },
      auditLogger: { record: async () => {} },
      logger: createLogger(),
      config: { brokerRouting: { enabled: false } },
      requireBrokerRead: (req, res, next) => next(),
      requireBrokerWrite: (req, res, next) => next()
    });

    app.use('/api', router);
    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/broker/status`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.requestId);
  });

  it('maps probeConnector errors and supports success response', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(express.json());

    const brokerRouter = {
      defaultBroker: 'mt5',
      getStatus: () => ({ routing: 'ok' }),
      getHealthSnapshots: async () => [{ id: 'mt5', ok: true }],
      probeConnector: async (id) => {
        if (id === 'unknown') {
          const err = new Error('Unknown connector');
          err.code = 'UNKNOWN_CONNECTOR';
          throw err;
        }
        return { id, ok: true };
      }
    };

    const router = brokerRoutes({
      tradingEngine: { activeTrades: new Map() },
      brokerRouter,
      auditLogger: { record: async () => {} },
      logger: createLogger(),
      config: { brokerRouting: { enabled: true } },
      requireBrokerRead: (req, res, next) => next(),
      requireBrokerWrite: (req, res, next) => next()
    });

    app.use('/api', router);
    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const statusRes = await fetch(`${baseUrl}/api/broker/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.success, true);
    assert.ok(statusBody.requestId);
    assert.ok(statusBody.status);
    assert.ok(statusBody.health);

    const missing = await fetch(`${baseUrl}/api/broker/connectors/unknown/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.success, false);
    assert.ok(missingBody.requestId);
  });
});
