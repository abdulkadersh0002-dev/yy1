import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { applyPresetEnv, formatPresetList } from './presets.mjs';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const BACKEND_PORT = Number(process.env.PORT || 4101);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 4173);

const BACKEND_STATUS_URL = `http://127.0.0.1:${BACKEND_PORT}/api/healthz`;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}/`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  /** @type {{ preset?: string, listPresets?: boolean, help?: boolean }} */
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }

    if (arg === '--list-presets') {
      out.listPresets = true;
      continue;
    }

    if (arg === '--preset' || arg === '-p') {
      out.preset = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--preset=')) {
      out.preset = arg.slice('--preset='.length);
      continue;
    }
  }

  return out;
}

function printHelp() {
  // Keep help text compact; this is a dev utility.
  console.log('[start-all] Usage: npm run start:all -- [--preset <name>] [--list-presets]');
  console.log('[start-all] Examples:');
  console.log('  npm run start:all');
  console.log('  npm run start:all -- --preset synthetic');
  console.log('  npm run start:all -- --list-presets');
}

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
          Connection: 'close',
        },
      },
      (res) => {
        res.resume();
        const status = res.statusCode || 0;
        const ok = (status >= 200 && status < 400) || status === 503;
        finish(Boolean(status && ok));
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

async function waitFor(url, { timeoutMs = 20000, intervalMs = 500 } = {}) {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await isReachable(url)) {
      return true;
    }
    if (Date.now() - started >= timeoutMs) {
      return false;
    }
    await sleep(intervalMs);
  }
}

function isPortInUse(port, host = '127.0.0.1', timeoutMs = 400) {
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

    socket.connect(port, host);
  });
}

function spawnBackend() {
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
    // Auto-trading remains gated by the stronger ENTER + validity rules.
    EA_DASHBOARD_ALLOW_CANDIDATES: process.env.EA_DASHBOARD_ALLOW_CANDIDATES ?? 'true',
    // Dev UX: allow dashboard analysis even if quotes pause briefly.
    EA_DASHBOARD_QUOTE_MAX_AGE_MS:
      process.env.EA_DASHBOARD_QUOTE_MAX_AGE_MS ?? String(10 * 60 * 1000),
    PORT: String(BACKEND_PORT),
    ENABLE_PORT_FALLBACK: process.env.ENABLE_PORT_FALLBACK ?? 'false',
  };

  return spawn(process.execPath, ['src/server.js'], {
    stdio: 'inherit',
    env,
  });
}

function spawnDashboard() {
  const env = {
    ...process.env,
    VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${BACKEND_PORT}`,
    VITE_API_BASE_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  };

  // On Windows, run through cmd.exe to avoid direct .cmd spawn issues.
  if (process.platform === 'win32') {
    const cmd = `npm --prefix clients\\neon-dashboard run dev -- --host 127.0.0.1 --port ${DASHBOARD_PORT}`;
    return spawn('cmd.exe', ['/d', '/s', '/c', cmd], { stdio: 'inherit', env });
  }

  return spawn(
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
      String(DASHBOARD_PORT),
    ],
    { stdio: 'inherit', env }
  );
}

let backendChild = null;
let dashboardChild = null;

let shuttingDown = false;

const shutdown = (signal) => {
  shuttingDown = true;
  const signalToSend = signal || 'SIGTERM';

  if (dashboardChild && !dashboardChild.killed) {
    dashboardChild.kill(signalToSend);
  }
  if (backendChild && !backendChild.killed) {
    backendChild.kill(signalToSend);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Apply preset env overrides (single source of truth) before any child spawns.
const cli = parseArgs(process.argv.slice(2));
if (cli.help) {
  printHelp();
  process.exit(0);
}
if (cli.listPresets) {
  console.log(formatPresetList());
  process.exit(0);
}

const { presetKey, preset, env: resolvedEnv } = applyPresetEnv(process.env, cli.preset);
for (const [k, v] of Object.entries(resolvedEnv)) {
  if (process.env[k] !== v) {
    process.env[k] = v;
  }
}
if (presetKey !== 'default') {
  console.log(`[start-all] Preset: ${presetKey} (${preset.label})`);
}

const backendPortInUse = await isPortInUse(BACKEND_PORT);
const backendAlreadyRunning = backendPortInUse && (await isReachable(BACKEND_STATUS_URL));

if (backendPortInUse && !backendAlreadyRunning) {
  console.error(
    `[start-all] Port ${BACKEND_PORT} is already in use, but backend is not reachable at ${BACKEND_STATUS_URL}. Stop the stale listener (or change PORT) and try again.`
  );
  process.exit(1);
}

if (backendAlreadyRunning) {
  console.log(`[start-all] Backend already running: ${BACKEND_STATUS_URL}`);
} else {
  console.log(`[start-all] Starting backend: ${BACKEND_STATUS_URL}`);
  backendChild = spawnBackend();

  const backendReady = await waitFor(BACKEND_STATUS_URL, { timeoutMs: 30000 });
  if (!backendReady) {
    console.error(`[start-all] Backend did not become ready: ${BACKEND_STATUS_URL}`);
    shutdown('SIGTERM');
    process.exit(1);
  }
}

const dashboardPortInUse = await isPortInUse(DASHBOARD_PORT);
const dashboardAlreadyRunning = dashboardPortInUse && (await isReachable(DASHBOARD_URL));

if (dashboardPortInUse && !dashboardAlreadyRunning) {
  console.error(
    `[start-all] Dashboard port ${DASHBOARD_PORT} is already in use, but dashboard is not reachable at ${DASHBOARD_URL}. Stop the stale listener (or change DASHBOARD_PORT) and try again.`
  );
  shutdown('SIGTERM');
  process.exit(1);
}

if (dashboardAlreadyRunning) {
  console.log(`[start-all] Dashboard already running: ${DASHBOARD_URL}`);
} else {
  console.log(`[start-all] Starting dashboard: ${DASHBOARD_URL}`);
  dashboardChild = spawnDashboard();
}

// If we didn't start anything, exit cleanly.
const children = [backendChild, dashboardChild].filter(Boolean);
if (children.length === 0) {
  process.exit(0);
}

// Keep this process alive while any child we started is alive.
await new Promise((resolve, reject) => {
  let settled = false;

  // On Windows, terminated processes often report exit code 4294967295.
  const WINDOWS_TERMINATION_EXIT_CODE = 4294967295;

  const maybeResolve = () => {
    if (settled) {
      return;
    }
    const anyAlive = children.some((child) => child.exitCode === null && !child.killed);
    if (!anyAlive) {
      settled = true;
      resolve();
    }
  };

  for (const child of children) {
    child.on('exit', (code, signal) => {
      const normalizedExitCode = typeof code === 'number' ? code >>> 0 : null;
      const isWindowsTermination =
        typeof code === 'number' && normalizedExitCode === WINDOWS_TERMINATION_EXIT_CODE;

      // VS Code task restarts (or terminal closes) can terminate children abruptly.
      // Treat common termination cases as non-fatal even if we didn't observe our own shutdown.
      const isTerminationSignal = signal === 'SIGINT' || signal === 'SIGTERM';
      const isNegativeOne = typeof code === 'number' && code === -1;
      if (isWindowsTermination || isNegativeOne || isTerminationSignal) {
        maybeResolve();
        return;
      }

      if (!shuttingDown && typeof code === 'number' && code !== 0 && !isWindowsTermination) {
        settled = true;
        reject(new Error(`Child process exited with code ${code}`));
        return;
      }

      if (!shuttingDown && signal && code === null) {
        settled = true;
        reject(new Error(`Child process exited with signal ${signal}`));
        return;
      }
      maybeResolve();
    });
    child.on('error', (error) => {
      settled = true;
      reject(error);
    });
  }
});
