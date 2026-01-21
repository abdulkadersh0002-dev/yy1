import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200 || response.status === 503) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }

  const error = new Error(`Server did not become ready within ${timeoutMs}ms`);
  error.cause = lastError;
  throw error;
}

function buildChildEnv(port, optionsEnv = {}) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    ENABLE_API_AUTH: 'false',
    EA_ONLY_MODE: 'false',
    ENABLE_WEBSOCKETS: optionsEnv.ENABLE_WEBSOCKETS ?? 'false',
    ALLOW_SYNTHETIC_DATA: 'true',
    REQUIRE_REALTIME_DATA: 'false',
    ENABLE_BROKER_ROUTING: 'false',
    ENABLE_RISK_REPORTS: 'false',
    ENABLE_PERFORMANCE_DIGESTS: 'false',
    ENABLE_BROKER_RECONCILIATION: 'false',
    ENABLE_PREFETCH_SCHEDULER: 'false',
    AUTO_TRADING_AUTOSTART: 'false',
    ENABLE_BROKER_OANDA: 'false',
    ENABLE_BROKER_MT5: 'false',
    ENABLE_BROKER_IBKR: 'false',
    ...optionsEnv
  };
}

export async function startTestServer(options = {}) {
  const port = options.port ?? (await findAvailablePort());
  const readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const inheritLogs = options.inheritLogs ?? false;
  const envOverrides = {
    ENABLE_WEBSOCKETS: options.enableWebSockets ? 'true' : 'false',
    ...options.env
  };

  const stdio = inheritLogs ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'];
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: repoRoot,
    env: buildChildEnv(port, envOverrides),
    stdio
  });

  const collected = { stdout: [], stderr: [] };
  if (!inheritLogs) {
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      collected.stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      collected.stderr.push(chunk);
    });
  }

  const exitPromise = (async () => {
    const [code, signal] = await once(child, 'exit');
    return { code, signal };
  })();

  try {
    await Promise.race([
      waitForHttpReady(`http://127.0.0.1:${port}/api/healthz`, readinessTimeoutMs),
      exitPromise.then(({ code, signal }) => {
        const stderrOutput = collected.stderr.join('').trim();
        const hint = stderrOutput ? `\n${stderrOutput}` : '';
        throw new Error(
          `Test server exited before readiness check (code=${code} signal=${signal})${hint}`
        );
      })
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return exitPromise;
    }
    stopped = true;

    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }

    const timeout = (async () => {
      await delay(shutdownTimeoutMs);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    })();

    await Promise.race([exitPromise, timeout]);
    return exitPromise;
  };

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    url: (pathname = '/') => new URL(pathname, baseUrl).toString(),
    stop,
    output: collected
  };
}
