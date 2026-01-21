import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startTestServer } from '../../helpers/test-server.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function check() {
      const result = predicate();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(check, 50);
    }
    check();
  });
};

test('WebSocket broadcast flow', async (t) => {
  const server = await startTestServer({
    enableWebSockets: true,
    env: {
      PROVIDER_AVAILABILITY_BROADCAST_INTERVAL_MS: '200'
    }
  });

  t.after(async () => {
    await server.stop();
  });

  await t.test('receives signal broadcasts via WebSocket', async () => {
    const wsUrl = server.url('/ws/trading').replace('http', 'ws');
    const socket = new WebSocket(wsUrl);
    const received = [];

    socket.on('message', (data) => {
      try {
        received.push(JSON.parse(data.toString('utf8')));
      } catch (error) {
        // ignore malformed JSON in tests
      }
    });

    await once(socket, 'open');

    // Ensure the server has fully registered this client before we trigger broadcasts.
    // This reduces flakiness when the full test suite is running under heavy load.
    await waitFor(() => received.find((message) => message.type === 'connected'), 4000);

    const response = await fetch(server.url('/api/signal/generate'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ pair: 'EURUSD', broadcast: true })
    });
    assert.equal(response.status, 200);

    const broadcast = await waitFor(
      () => received.find((message) => message.type === 'signal'),
      10000
    );

    assert.equal(broadcast.payload?.pair, 'EURUSD');
    assert.equal(typeof broadcast.timestamp, 'number');

    socket.terminate();
  });
});
