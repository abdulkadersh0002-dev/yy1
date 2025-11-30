import https from 'https';
import BaseBrokerConnector from './base-connector.js';

class IbkrConnector extends BaseBrokerConnector {
  constructor(options = {}) {
    const baseURL =
      options.baseUrl || process.env.IBKR_GATEWAY_URL || 'https://127.0.0.1:5000/v1/api';
    const accountId = options.accountId || process.env.IBKR_ACCOUNT_ID || null;
    const allowSelfSigned =
      options.allowSelfSigned != null
        ? Boolean(options.allowSelfSigned)
        : process.env.IBKR_ALLOW_SELF_SIGNED === 'true';
    const agent = new https.Agent({ rejectUnauthorized: !allowSelfSigned });

    super({
      name: 'ibkr',
      accountMode: options.accountMode === 'real' ? 'real' : 'demo',
      logger: options.logger,
      httpOptions: {
        baseURL,
        timeout: options.timeout || 10000,
        httpsAgent: agent,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    });

    this.accountId = accountId;
    this.baseURL = baseURL;
  }

  async healthCheck() {
    try {
      const response = await this.http.get('/iserver/account/pnl/partitioned');
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: true,
        details: response.data || null
      };
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'IBKR health check failed');
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: false,
        error: error.message
      };
    }
  }

  async placeOrder(order) {
    try {
      const payload = {
        conid: order.contractId || order.conid || null,
        secType: order.secType || 'CASH',
        ccy: order.currency || 'USD',
        exchange: order.exchange || 'IDEALPRO',
        tif: order.timeInForce || 'GTC',
        side: order.side?.toUpperCase?.() || 'BUY',
        orderType: order.type || 'MKT',
        quantity: Number(order.quantity || order.units || 0),
        account: order.account || this.accountId,
        price: order.price || null,
        auxPrice: order.stopLoss || null
      };

      const path = this.accountId
        ? `/iserver/account/${this.accountId}/order`
        : '/iserver/account/order';
      const response = await this.http.post(path, payload);
      return {
        success: true,
        order: response.data || null
      };
    } catch (error) {
      this.logger?.error?.({ err: error, broker: this.name }, 'IBKR placeOrder failed');
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  async closePosition(position) {
    try {
      const payload = {
        conid: position.conid || position.contractId,
        quantity: Number(position.quantity || position.units || 0),
        side: position.side === 'BUY' ? 'SELL' : 'BUY',
        account: position.account || this.accountId
      };
      const path = this.accountId
        ? `/iserver/account/${this.accountId}/segment/closing`
        : '/iserver/account/segment/closing';
      const response = await this.http.post(path, payload);
      return {
        success: true,
        result: response.data || null
      };
    } catch (error) {
      this.logger?.error?.({ err: error, broker: this.name }, 'IBKR closePosition failed');
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  async fetchOpenPositions() {
    try {
      const response = await this.http.get('/portfolio/accounts');
      return response.data || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'IBKR fetchOpenPositions failed');
      return [];
    }
  }

  async fetchRecentFills() {
    try {
      const response = await this.http.get('/iserver/account/trades');
      return response.data || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'IBKR fetchRecentFills failed');
      return [];
    }
  }

  async fetchAccountSummary() {
    try {
      const response = await this.http.get('/portfolio/accounts');
      return Array.isArray(response.data) ? response.data[0] : response.data;
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'IBKR fetchAccountSummary failed');
      return null;
    }
  }
}

export default IbkrConnector;
