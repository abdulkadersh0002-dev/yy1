const { Writable } = require('stream');
const axios = require('axios');

class OpenSearchTransport extends Writable {
  constructor(options = {}) {
    super({ objectMode: true });
    this.endpoint = options.endpoint;
    if (!this.endpoint) {
      throw new Error('Elastic/OpenSearch transport requires an endpoint.');
    }

    this.indexPrefix = options.indexPrefix || 'signals-strategy';
    this.batchSize = Number(options.batchSize || 50);
    this.flushIntervalMs = Number(options.flushIntervalMs || 5000);
    this.apiKey = options.apiKey;
    this.username = options.username;
    this.password = options.password;
    this.headers = options.headers || {};
    this.queue = [];
    this.pendingFlush = false;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/x-ndjson', ...this.headers };
    if (this.apiKey) {
      headers.Authorization = `ApiKey ${this.apiKey}`;
    } else if (this.username && this.password) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    return headers;
  }

  async flush() {
    if (this.pendingFlush || this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) {
      return;
    }

    const indexName = `${this.indexPrefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}`;
    const lines = [];

    for (const entry of batch) {
      let payload;
      try {
        payload = JSON.parse(entry);
      } catch (error) {
        payload = { message: entry };
      }

      const document = {
        '@timestamp': new Date().toISOString(),
        ...payload
      };

      lines.push(JSON.stringify({ index: { _index: indexName } }));
      lines.push(JSON.stringify(document));
    }

    const body = `${lines.join('\n')}\n`;

    this.pendingFlush = true;
    try {
      const url = this.endpoint.endsWith('/') ? `${this.endpoint}_bulk` : `${this.endpoint}/_bulk`;

      await axios.post(url, body, { headers: this.buildHeaders() });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to push logs to Elastic/OpenSearch:', error.message);
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

module.exports = async function createOpenSearchTransport(options) {
  return new OpenSearchTransport(options);
};
