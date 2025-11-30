import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../../helpers/test-server.js';

const expectJson = async (response) => {
  const payload = await response.json();
  return { response, payload };
};

test('REST API health endpoints', async (t) => {
  const server = await startTestServer();

  t.after(async () => {
    await server.stop();
  });

  await t.test('GET /api/healthz returns summary payload', async () => {
    const response = await fetch(server.url('/api/healthz'));
    assert.ok([200, 503].includes(response.status), 'unexpected status code');
    const { payload } = await expectJson(response);

    assert.equal(typeof payload.ok, 'boolean');
    assert.equal(typeof payload.status, 'string');
    assert.equal(typeof payload.requireRealTime, 'boolean');
    assert.ok(Array.isArray(payload.modules), 'modules array missing');
    assert.ok(payload.modules.length > 0, 'modules array empty');
    assert.ok(
      payload.modules.every(
        (module) => typeof module.id === 'string' && typeof module.state === 'string'
      ),
      'module entries missing id/state'
    );
  });

  await t.test('GET /api/health/providers returns availability snapshot', async () => {
    const response = await fetch(server.url('/api/health/providers'));
    assert.equal(response.status, 200);
    const { payload } = await expectJson(response);

    assert.equal(payload.success, true);
    assert.ok(Array.isArray(payload.providers));
    assert.ok(Array.isArray(payload.timeframes));
    assert.ok('classification' in payload);
    assert.ok('history' in payload);
    assert.ok(Array.isArray(payload.history));
    assert.ok(payload.historyLimit > 0);
  });

  await t.test('GET /api/health/providers accepts timeframe overrides', async () => {
    const response = await fetch(server.url('/api/health/providers?timeframes=M1,M30'));
    assert.equal(response.status, 200);
    const { payload } = await expectJson(response);

    const returnedTimeframes = payload.timeframes.map((entry) => entry.timeframe);
    assert.deepEqual(returnedTimeframes, ['M1', 'M30']);
    payload.providers.forEach((provider) => {
      assert.equal(typeof provider.provider, 'string');
      assert.ok('available' in provider);
    });
    payload.timeframes.forEach((entry) => {
      assert.equal(typeof entry.viable, 'boolean');
    });
  });

  await t.test('POST /api/signal/generate produces synthetic signal', async () => {
    const response = await fetch(server.url('/api/signal/generate'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ pair: 'EURUSD' })
    });

    assert.equal(response.status, 200);
    const { payload } = await expectJson(response);

    assert.equal(payload.success, true);
    assert.ok(payload.signal);
    assert.equal(payload.signal.pair, 'EURUSD');
    assert.ok(['BUY', 'SELL', 'NEUTRAL', undefined, null].includes(payload.signal.direction));
    assert.equal(typeof payload.signal.timestamp, 'number');
    assert.equal(typeof payload.timestamp, 'number');
  });
});
