import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import featureRoutes from '../../../src/routes/feature-routes.js';
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

describe('feature routes (unit)', () => {
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

  it('returns 503 serviceUnavailable when risk command center disabled', async () => {
    const app = express();
    app.use(requestIdMiddleware());

    app.use(
      '/api',
      featureRoutes({
        tradingEngine: {
          config: { riskCommandCenter: { enabled: false } }
        },
        logger: createLogger(),
        requireBasicRead: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/risk/command-center`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Risk command center disabled');
    assert.ok(body.requestId);
  });

  it('returns 200 ok when risk command center enabled', async () => {
    const app = express();
    app.use(requestIdMiddleware());

    app.use(
      '/api',
      featureRoutes({
        tradingEngine: {
          config: { riskCommandCenter: { enabled: true } },
          getRiskCommandSnapshot: () => ({ ok: true })
        },
        logger: createLogger(),
        requireBasicRead: (req, res, next) => next()
      })
    );

    app.use(createErrorHandler({ logger: createLogger() }));

    const started = await startEphemeralServer(app);
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/risk/command-center`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.requestId);
    assert.deepEqual(body.snapshot, { ok: true });
  });
});
