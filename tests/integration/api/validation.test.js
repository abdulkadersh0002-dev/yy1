import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../../helpers/test-server.js';

test('API validation errors include details', async (t) => {
  const server = await startTestServer();

  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(server.url('/api/signal/generate'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.equal(payload.error, 'Invalid pair');
  assert.ok(Array.isArray(payload.details), 'validation details missing');
  assert.ok(payload.details.length > 0, 'validation details empty');
});
