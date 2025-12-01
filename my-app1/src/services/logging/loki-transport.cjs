const { Writable } = require('stream');
const axios = require('axios');

class LokiTransport extends Writable {
  constructor(options = {}) {
    super({ objectMode: true });
    this.endpoint = options.endpoint;
    if (!this.endpoint) {
      throw new Error('Loki transport requires an endpoint (LOKI_ENDPOINT).');
    }

    this.labels = options.labels || { service: 'signals-strategy' };
    this.batchSize = Number(options.batchSize || 20);
    this.flushIntervalMs = Number(options.flushIntervalMs || 5000);
    this.basicAuth = options.basicAuth;
    this.tenantId = options.tenantId;
    this.queue = [];
    this.pendingFlush = false;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  async flush() {
    if (this.pendingFlush || this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) {
      return;
    }

    const streams = [
      {
        stream: this.labels,
        values: batch.map((line) => [String(Date.now() * 1e6), line])
      }
    ];

    const headers = { 'Content-Type': 'application/json' };
    if (this.basicAuth) {
      headers.Authorization = `Basic ${this.basicAuth}`;
    }
    if (this.tenantId) {
      headers['X-Scope-OrgID'] = this.tenantId;
    }

    this.pendingFlush = true;
    try {
      const url = this.endpoint.endsWith('/')
        ? `${this.endpoint}loki/api/v1/push`
        : `${this.endpoint}/loki/api/v1/push`;

      await axios.post(url, { streams }, { headers });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to push logs to Loki:', error.message);
    } finally {
      this.pendingFlush = false;
    }
  }

  _write(chunk, _encoding, callback) {
    try {
      const line = typeof chunk === 'string' ? chunk : chunk.toString();
      if (line && line.trim().length > 0) {
        this.queue.push(line.trim());
      }

      if (this.queue.length >= this.batchSize) {
        this.flush().finally(() => callback());
      } else {
        callback();
      }
    } catch (error) {
      callback(error);
    }
  }

  _destroy(error, callback) {
    clearInterval(this.timer);
    this.flush().finally(() => callback(error));
  }
}

module.exports = async function createLokiTransport(options) {
  return new LokiTransport(options);
};
