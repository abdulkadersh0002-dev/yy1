import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ok,
  badRequest,
  notFound,
  serverError,
  serviceUnavailable
} from '../../../src/utils/http-response.js';

function createRes({ requestId = null } = {}) {
  const res = {
    locals: requestId ? { requestId } : {},
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

describe('http-response helpers', () => {
  beforeEach(() => {});

  afterEach(() => {});

  it('ok() includes requestId when available', () => {
    const res = createRes({ requestId: 'rid-1' });
    ok(res, { hello: 'world' }, { timestamp: 123 });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.hello, 'world');
    assert.equal(res.body.timestamp, 123);
    assert.equal(res.body.requestId, 'rid-1');
  });

  it('badRequest() includes requestId when available', () => {
    const res = createRes({ requestId: 'rid-2' });
    badRequest(res, 'Invalid payload', { timestamp: 456 });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Invalid payload');
    assert.equal(res.body.timestamp, 456);
    assert.equal(res.body.requestId, 'rid-2');
  });

  it('notFound() includes requestId when available', () => {
    const res = createRes({ requestId: 'rid-3' });
    notFound(res, 'Nope', { timestamp: 789 });

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Nope');
    assert.equal(res.body.timestamp, 789);
    assert.equal(res.body.requestId, 'rid-3');
  });

  it('serviceUnavailable() includes requestId when available', () => {
    const res = createRes({ requestId: 'rid-3b' });
    serviceUnavailable(res, 'Temporarily down', { timestamp: 999 });

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Temporarily down');
    assert.equal(res.body.timestamp, 999);
    assert.equal(res.body.requestId, 'rid-3b');
  });

  it('serverError() includes message outside production', () => {
    const res = createRes({ requestId: 'rid-4' });
    serverError(res, new Error('boom'), { timestamp: 1000, nodeEnv: 'test' });

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Internal server error');
    assert.equal(res.body.message, 'boom');
    assert.equal(res.body.requestId, 'rid-4');
  });

  it('serverError() omits message in production', () => {
    const res = createRes({ requestId: 'rid-5' });
    serverError(res, new Error('secret-details'), { nodeEnv: 'production' });

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Internal server error');
    assert.equal('message' in res.body, false);
    assert.equal(res.body.requestId, 'rid-5');
  });
});
