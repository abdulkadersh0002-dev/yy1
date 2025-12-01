import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { compareAlertSnapshots } from '../../../scripts/ci/lib/alertmanager-snapshots.js';
import { validateRunbookLinks } from '../../../scripts/ci/lib/runbook-links.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const fixturesDir = path.resolve(repoRoot, 'scripts/ci/fixtures/alertmanager');

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForFile(pathname, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await readFile(pathname, 'utf8');
      return;
    } catch (_error) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for file ${pathname}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function sendFixturePayload(port, endpoint, fixtureName, transform = (payload) => payload) {
  const payload = JSON.parse(await readFile(path.join(fixturesDir, fixtureName), 'utf8'));
  const body = transform(payload);
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  assert.ok(response.ok, `Request to ${endpoint} failed with ${response.status}`);
}

test('Alerting pipeline harness captures and validates payloads', async (t) => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'alerts-'));
  const outputPath = path.join(tmpDir, 'mock-alerts.json');
  const port = await findOpenPort();

  const receiver = spawn(
    process.execPath,
    ['scripts/ci/mock-alert-receivers.mjs', '--port', String(port), '--output', outputPath],
    {
      cwd: repoRoot,
      stdio: 'ignore'
    }
  );

  let receiverStopped = false;
  const stopReceiver = async () => {
    if (receiverStopped) {
      return;
    }
    receiverStopped = true;
    if (receiver.exitCode === null) {
      receiver.kill('SIGTERM');
      try {
        await once(receiver, 'exit');
      } catch (_error) {
        // ignore
      }
    }
  };

  t.after(async () => {
    await stopReceiver();
    await rm(tmpDir, { recursive: true, force: true });
  });

  await waitForFile(outputPath);

  await sendFixturePayload(port, '/slack/critical', 'slack-critical-firing.json');
  await sendFixturePayload(port, '/slack/critical', 'slack-critical-resolved.json');
  await sendFixturePayload(port, '/slack/default', 'slack-warning-slo-firing.json');
  await sendFixturePayload(port, '/slack/default', 'slack-warning-slo-resolved.json');
  const ticketTransform = (fixture) => ({
    receiver: fixture.receiver,
    status: fixture.status,
    alerts: [fixture.alert]
  });
  await sendFixturePayload(port, '/ticket', 'ticket-critical-firing.json', ticketTransform);
  await sendFixturePayload(port, '/ticket', 'ticket-critical-resolved.json', ticketTransform);

  await stopReceiver();

  await compareAlertSnapshots({ inputPath: outputPath, fixturesDir });

  const okFetch = async () => new Response('ok', { status: 200 });
  await validateRunbookLinks({ inputPath: outputPath, timeoutMs: 2000, fetchImpl: okFetch });
});
