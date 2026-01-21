import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../../../src/app/startup.js';

class FakeServer extends EventEmitter {
  constructor({ failPorts = [] } = {}) {
    super();
    this.failPorts = new Set(failPorts);
    this.listenedPorts = [];
  }

  listen(port, callback) {
    this.listenedPorts.push(port);

    if (this.failPorts.has(port)) {
      setImmediate(() => {
        this.emit('error', { code: 'EADDRINUSE', message: 'in use' });
      });
      return;
    }

    setImmediate(() => {
      callback?.();
    });
  }
}

function createLoggerSpy() {
  const calls = {
    info: [],
    warn: [],
    error: []
  };

  return {
    calls,
    logger: {
      info: (...args) => calls.info.push(args),
      warn: (...args) => calls.warn.push(args),
      error: (...args) => calls.error.push(args)
    }
  };
}

async function waitFor(predicate, { timeoutMs = 250, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('startup startServer', () => {
  let originalExit;
  let originalConsoleError;

  beforeEach(() => {
    originalExit = process.exit;
    originalConsoleError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = originalExit;
    console.error = originalConsoleError;
  });

  it('falls back to next port in development when enabled', async () => {
    const { logger, calls } = createLoggerSpy();

    const server = new FakeServer({ failPorts: [5000] });
    const factories = {
      createServer: () => server,
      createHttpApp: () => (req, res) => {
        res.statusCode = 200;
        res.end('ok');
      },
      createWebSocketLayer: () => ({
        broadcast() {},
        attach() {},
        shutdown() {}
      })
    };

    startServer({
      serverConfig: {
        port: 5000,
        nodeEnv: 'development',
        enablePortFallback: true,
        portFallbackAttempts: 2
      },
      logger,
      factories
    });

    await waitFor(
      () => server.listenedPorts.length >= 2 && calls.warn.length >= 1 && calls.info.length >= 1
    );

    assert.deepEqual(server.listenedPorts, [5000, 5001]);
    assert.equal(calls.warn.length, 1);
    assert.equal(calls.info.length, 1);
  });

  it('does not attempt fallback in production and exits on EADDRINUSE', async () => {
    const { logger, calls } = createLoggerSpy();

    const server = new FakeServer({ failPorts: [5000] });
    const factories = {
      createServer: () => server,
      createHttpApp: () => () => {},
      createWebSocketLayer: () => ({
        broadcast() {},
        attach() {},
        shutdown() {}
      })
    };

    let exitCode;
    process.exit = (code) => {
      exitCode = code;
    };

    startServer({
      serverConfig: {
        port: 5000,
        nodeEnv: 'production',
        enablePortFallback: true,
        portFallbackAttempts: 10
      },
      logger,
      factories
    });

    await waitFor(() => exitCode === 1 && calls.error.length >= 1);

    assert.deepEqual(server.listenedPorts, [5000]);
    assert.equal(exitCode, 1);
    assert.equal(calls.error.length, 1);
  });

  it('respects enablePortFallback=false even in development', async () => {
    const { logger, calls } = createLoggerSpy();

    const server = new FakeServer({ failPorts: [5000] });
    const factories = {
      createServer: () => server,
      createHttpApp: () => () => {},
      createWebSocketLayer: () => ({
        broadcast() {},
        attach() {},
        shutdown() {}
      })
    };

    let exitCode;
    process.exit = (code) => {
      exitCode = code;
    };

    startServer({
      serverConfig: {
        port: 5000,
        nodeEnv: 'development',
        enablePortFallback: false,
        portFallbackAttempts: 10
      },
      logger,
      factories
    });

    await waitFor(() => exitCode === 1 && calls.error.length >= 1);

    assert.deepEqual(server.listenedPorts, [5000]);
    assert.equal(exitCode, 1);
    assert.equal(calls.error.length, 1);
  });
});
