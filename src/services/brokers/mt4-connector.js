import BaseBrokerConnector from './base-connector.js';
import { appConfig } from '../../app/config.js';

class Mt4Connector extends BaseBrokerConnector {
  constructor(options = {}) {
    const brokerConfig = appConfig.brokers?.mt4 || {};
    const baseURL = options.baseUrl || brokerConfig.baseUrl || 'http://127.0.0.1:5001/api';
    super({
      name: 'mt4',
      accountMode: options.accountMode === 'real' ? 'real' : 'demo',
      logger: options.logger,
      httpOptions: {
        baseURL,
        timeout: options.timeout || 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    });
    this.apiKey = options.apiKey || brokerConfig.apiKey || null;
    this.expectedAccount = options.accountNumber || brokerConfig.accountNumber || null;
  }

  async healthCheck() {
    try {
      const response = await this.http.get('/status', {
        headers: this.authHeaders()
      });
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: Boolean(response.data?.connected),
        details: response.data
      };
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'MT4 health check failed');
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: false,
        error: error.message
      };
    }
  }

  authHeaders() {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined;
  }

  async connect(options = {}) {
    const payload = {
      accountMode: options.accountMode || this.accountMode,
      accountNumber: options.accountNumber || this.expectedAccount,
      forceReconnect: Boolean(options.forceReconnect)
    };

    const response = await this.http.post('/session/connect', payload, {
      headers: this.authHeaders()
    });

    return response.data;
  }

  async disconnect(options = {}) {
    const response = await this.http.post(
      '/session/disconnect',
      {
        accountMode: options.accountMode || this.accountMode,
        accountNumber: options.accountNumber || this.expectedAccount
      },
      {
        headers: this.authHeaders()
      }
    );

    return response.data;
  }

  async restart(options = {}) {
    try {
      await this.disconnect(options);
    } catch (error) {
      this.logger?.warn?.(
        { err: error, broker: this.name },
        'MT4 disconnect failed during restart, continuing'
      );
    }
    return this.connect({ ...options, forceReconnect: true });
  }
}

export default Mt4Connector;
