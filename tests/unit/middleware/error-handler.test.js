import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createErrorHandler } from '../../../src/middleware/error-handler.js';

function createRes({ requestId = 'rid' } = {}) {
  const res = {
    locals: { requestId },
    headersSent: false,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe('error handler', () => {
  beforeEach(() => {});

  afterEach(() => {});

  it('maps ZodError to 400 with details + requestId', () => {
    const calls = { warn: 0, error: 0 };
    const logger = {
      warn() {
        calls.warn += 1;
      },
      error() {
        calls.error += 1;
      }
    };
    const handler = createErrorHandler({ logger, nodeEnv: 'test' });

    let err;
    try {
      z.object({ pair: z.string().min(3) }).parse({});
    } catch (e) {
      err = e;
    }

    const req = { requestId: 'rid-zod' };
    const res = createRes({ requestId: 'rid-zod' });

    handler(err, req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Validation error');
    assert.equal(res.body.requestId, 'rid-zod');
    assert.ok(Array.isArray(res.body.details));
    assert.ok(res.body.details.some((d) => d.path === 'pair'));
    assert.equal(calls.warn, 1);
    assert.equal(calls.error, 0);
  });

  it('handles 404-style errors as request failures', () => {
    const logger = { warn() {}, error() {} };
    const handler = createErrorHandler({ logger, nodeEnv: 'test' });
    const req = { requestId: 'rid-404' };
    const res = createRes({ requestId: 'rid-404' });

    handler({ statusCode: 404, message: 'nope' }, req, res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Request failed');
    assert.equal(res.body.requestId, 'rid-404');
  });

  it('omits error message in production 500 responses', () => {
    const logger = { warn() {}, error() {} };
    const handler = createErrorHandler({ logger, nodeEnv: 'production' });
    const req = { requestId: 'rid-500' };
    const res = createRes({ requestId: 'rid-500' });

    handler(new Error('sensitive'), req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Internal server error');
    assert.equal(res.body.requestId, 'rid-500');
    assert.equal('message' in res.body, false);
  });
});
