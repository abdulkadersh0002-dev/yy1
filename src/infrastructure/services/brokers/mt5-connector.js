import BaseBrokerConnector from './base-connector.js';
import { appConfig } from '../../../app/config.js';

class Mt5Connector extends BaseBrokerConnector {
  constructor(options = {}) {
    const brokerConfig = appConfig.brokers?.mt5 || {};
    const baseURL = options.baseUrl || brokerConfig.baseUrl || 'http://127.0.0.1:5002/api';
    super({
      name: 'mt5',
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
      this.logger?.warn?.({ err: error, broker: this.name }, 'MT5 health check failed');
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
        'MT5 disconnect failed during restart, continuing'
      );
    }
    return this.connect({ ...options, forceReconnect: true });
  }

  async placeOrder(order) {
    try {
      const payload = {
        symbol: order.symbol,
        type: order.side === 'buy' ? 'BUY' : 'SELL',
        volume: Number(order.volume || order.units || 0),
        deviation: order.deviation || 10,
        comment: order.comment || 'auto-trade',
        takeProfit: order.takeProfit || null,
        stopLoss: order.stopLoss || null,
        magicNumber: order.magicNumber || 87001,
        accountMode: this.accountMode,
        accountNumber: order.accountNumber || this.expectedAccount,
        timeInForce: order.timeInForce || 'GTC'
      };

      const response = await this.http.post('/orders', payload, {
        headers: this.authHeaders()
      });
      return {
        success: Boolean(response.data?.success),
        order: response.data?.order || null,
        error: response.data?.error || null
      };
    } catch (error) {
      this.logger?.error?.({ err: error, broker: this.name }, 'MT5 placeOrder failed');
      return { success: false, error: error.message };
    }
  }

  async closePosition(position) {
    try {
      const payload = {
        ticket: position.ticket || position.id,
        symbol: position.symbol,
        volume: Number(position.volume || position.units || 0),
        comment: position.comment || 'auto-close'
      };
      const response = await this.http.post('/positions/close', payload, {
        headers: this.authHeaders()
      });
      return {
        success: Boolean(response.data?.success),
        result: response.data || null,
        error: response.data?.error || null
      };
    } catch (error) {
      this.logger?.error?.({ err: error, broker: this.name }, 'MT5 closePosition failed');
      return { success: false, error: error.message };
    }
  }

  async modifyPosition(position = {}) {
    try {
      const ticket = position.ticket || position.id || null;
      if (!ticket) {
        return { success: false, error: 'Missing position ticket/id' };
      }

      const payload = {
        ticket,
        symbol: position.symbol,
        stopLoss: position.stopLoss ?? null,
        takeProfit: position.takeProfit ?? null,
        comment: position.comment || 'auto-modify',
        accountMode: this.accountMode,
        accountNumber: position.accountNumber || this.expectedAccount
      };

      const response = await this.http.post('/positions/modify', payload, {
        headers: this.authHeaders()
      });

      return {
        success: Boolean(response.data?.success),
        result: response.data || null,
        error: response.data?.error || null
      };
    } catch (error) {
      this.logger?.error?.({ err: error, broker: this.name }, 'MT5 modifyPosition failed');
      return { success: false, error: error.message };
    }
  }

  async fetchOpenPositions() {
    try {
      const response = await this.http.get('/positions', {
        headers: this.authHeaders(),
        params: {
          accountNumber: this.expectedAccount,
          accountMode: this.accountMode
        }
      });
      return response.data?.positions || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'MT5 fetchOpenPositions failed');
      return [];
    }
  }

  async fetchRecentFills() {
    try {
      const response = await this.http.get('/deals', {
        headers: this.authHeaders(),
        params: {
          accountNumber: this.expectedAccount,
          accountMode: this.accountMode,
          limit: 50
        }
      });
      return response.data?.deals || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'MT5 fetchRecentFills failed');
      return [];
    }
  }

  async fetchAccountSummary() {
    try {
      const response = await this.http.get('/account', {
        headers: this.authHeaders(),
        params: {
          accountNumber: this.expectedAccount,
          accountMode: this.accountMode
        }
      });
      return response.data || null;
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'MT5 fetchAccountSummary failed');
      return null;
    }
  }
}

export default Mt5Connector;
