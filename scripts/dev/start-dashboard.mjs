import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 4173);
const API_PORT = Number(process.env.PORT || 4101);

const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}/`;
const BACKEND_STATUS_URL = `http://127.0.0.1:${API_PORT}/api/status`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isReachable(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish(false);
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Connection: 'close'
        }
      },
      (res) => {
        res.resume();
        finish(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400));
      }
    );

    req.on('error', () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
      finish(false);
    });
    req.end();
  });
}

async function waitForBackend(maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isReachable(BACKEND_STATUS_URL)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

if (await isReachable(DASHBOARD_URL)) {
  console.log(`[start-dashboard] Dashboard already running: ${DASHBOARD_URL}`);
  process.exit(0);
}

const backendOk = await waitForBackend();
if (!backendOk) {
  console.warn(`[start-dashboard] Backend not reachable yet: ${BACKEND_STATUS_URL}`);
  console.warn('[start-dashboard] Starting dashboard anyway; it will connect once backend is up.');
}

console.log(`[start-dashboard] Starting dashboard on ${DASHBOARD_URL} ...`);

let child;

const env = {
  ...process.env,
  VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
  VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}`
};

if (process.platform === 'win32') {
  const cmd = `npm --prefix clients\\neon-dashboard run dev -- --host 127.0.0.1 --port ${DASHBOARD_PORT}`;
  child = spawn('cmd.exe', ['/d', '/s', '/c', cmd], { stdio: 'inherit', env });
} else {
  child = spawn(
    'npm',
    [
      '--prefix',
      'clients/neon-dashboard',
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(DASHBOARD_PORT)
    ],
    { stdio: 'inherit', env }
  );
}

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  process.exit(signal ? 1 : 0);
});
