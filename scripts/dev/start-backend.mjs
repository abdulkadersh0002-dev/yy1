import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const DEFAULT_PORT = 4101;
const TIMEOUT_MS = 1500;

function isReachable(url, timeoutMs = TIMEOUT_MS) {
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
          Connection: 'close',
        },
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

const port = Number(process.env.PORT || DEFAULT_PORT);
const statusUrl = `http://127.0.0.1:${port}/api/healthz`;

function isPortInUse(portToCheck, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      finish(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      finish(false);
    });
    socket.once('error', () => {
      socket.destroy();
      finish(false);
    });

    socket.connect(portToCheck, host);
  });
}

if (await isPortInUse(port)) {
  console.error(
    `[start-backend] Port ${port} is already in use. Stop the running backend (or change PORT) and try again.`
  );
  process.exit(1);
}

console.log(`[start-backend] Starting backend on port ${port}...`);

const nodeEnv = process.env.NODE_ENV || 'development';
const rawTradingScope = String(process.env.TRADING_SCOPE || '')
  .trim()
  .toLowerCase();
const allowExecutionScope =
  nodeEnv !== 'production' &&
  nodeEnv !== 'test' &&
  (rawTradingScope === '' || rawTradingScope === 'signals');
const resolvedTradingScope = allowExecutionScope ? 'execution' : rawTradingScope || 'execution';

const env = {
  ...process.env,
  NODE_ENV: nodeEnv,
  REQUIRE_REALTIME_DATA: process.env.REQUIRE_REALTIME_DATA ?? 'false',
  ALLOW_SYNTHETIC_DATA: process.env.ALLOW_SYNTHETIC_DATA ?? 'true',
  TRADING_SCOPE: resolvedTradingScope,
  EA_ONLY_MODE: process.env.EA_ONLY_MODE ?? 'true',
  NEWS_RSS_ONLY: process.env.NEWS_RSS_ONLY ?? 'true',
  // Dev UX: allow showing analyzed WAIT/monitor candidates in the dashboard.
  // Auto-trading remains gated by stronger ENTER + validity rules.
  EA_DASHBOARD_ALLOW_CANDIDATES: process.env.EA_DASHBOARD_ALLOW_CANDIDATES ?? 'true',
  // Dev UX: allow dashboard analysis even if quotes pause briefly.
  EA_DASHBOARD_QUOTE_MAX_AGE_MS:
    process.env.EA_DASHBOARD_QUOTE_MAX_AGE_MS ?? String(10 * 60 * 1000),
  PORT: String(port),
  ENABLE_PORT_FALLBACK: process.env.ENABLE_PORT_FALLBACK ?? 'false',
};

const child = spawn(process.execPath, ['src/server.js'], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  process.exit(signal ? 1 : 0);
});
