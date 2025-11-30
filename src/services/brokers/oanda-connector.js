import BaseBrokerConnector from './base-connector.js';

const PRACTICE_URL = 'https://api-fxpractice.oanda.com';
const LIVE_URL = 'https://api-fxtrade.oanda.com';

class OandaConnector extends BaseBrokerConnector {
  constructor(options = {}) {
    const accountMode = options.accountMode === 'real' ? 'real' : 'demo';
    const baseURL = accountMode === 'real' ? LIVE_URL : PRACTICE_URL;
    const accessToken = options.accessToken || process.env.OANDA_ACCESS_TOKEN || '';
    const accountId = options.accountId || process.env.OANDA_ACCOUNT_ID || '';
    super({
      name: 'oanda',
      accountMode,
      logger: options.logger,
      httpOptions: {
        baseURL,
        timeout: options.timeout || 10000,
        headers: {
          Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
          'Content-Type': 'application/json'
        }
      }
    });
    this.accountId = accountId;
    this.accessToken = accessToken;
  }

  async healthCheck() {
    if (!this.accountId || !this.accessToken) {
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: false,
        details: 'Missing account credentials'
      };
    }

    try {
      const response = await this.http.get(`/v3/accounts/${this.accountId}/summary`);
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: true,
        details: response.data?.account || null
      };
    } catch (error) {
      this.logger?.warn?.({ err: error }, 'Oanda health check failed');
      return {
        broker: this.name,
        mode: this.accountMode,
        connected: false,
        error: error.message
      };
    }
  }

  async placeOrder(order) {
    if (!this.accountId || !this.accessToken) {
      return { success: false, error: 'Oanda credentials not configured' };
    }

    const units = order.side === 'buy' ? Math.abs(order.units) : -Math.abs(order.units);
    const payload = {
      order: {
        type: 'MARKET',
        instrument: order.symbol,
        units,
        timeInForce: 'FOK',
        positionFill: 'DEFAULT',
        clientExtensions: order.clientExtensions || undefined,
        stopLossOnFill: order.stopLoss
          ? {
              price: order.stopLoss
            }
          : undefined,
        takeProfitOnFill: order.takeProfit
          ? {
              price: order.takeProfit
            }
          : undefined
      }
    };

    try {
      const response = await this.http.post(`/v3/accounts/${this.accountId}/orders`, payload);
      return {
        success: true,
        order: {
          broker: this.name,
          id:
            response.data?.orderCreateTransaction?.id ||
            response.data?.orderFillTransaction?.orderID,
          fillTransactionId: response.data?.orderFillTransaction?.id,
          price: response.data?.orderFillTransaction?.price || null,
          executedUnits: response.data?.orderFillTransaction?.units || null,
          time: response.data?.orderFillTransaction?.time || new Date().toISOString()
        }
      };
    } catch (error) {
      const detail = error.response?.data || error.message;
      this.logger?.error?.({ err: error, broker: this.name }, 'Oanda placeOrder failed');
      return { success: false, error: detail };
    }
  }

  async closePosition(position) {
    if (!this.accountId || !this.accessToken) {
      return { success: false, error: 'Oanda credentials not configured' };
    }

    try {
      const side = position.side === 'buy' ? 'long' : 'short';
      const response = await this.http.put(
        `/v3/accounts/${this.accountId}/positions/${position.symbol}/close`,
        {
          [`${side}`]: {}
        }
      );
      return {
        success: true,
        result: response.data
      };
    } catch (error) {
      const detail = error.response?.data || error.message;
      this.logger?.error?.({ err: error, broker: this.name }, 'Oanda closePosition failed');
      return { success: false, error: detail };
    }
  }

  async fetchOpenPositions() {
    if (!this.accountId || !this.accessToken) {
      return [];
    }
    try {
      const response = await this.http.get(`/v3/accounts/${this.accountId}/openPositions`);
      return response.data?.positions || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'Oanda fetchOpenPositions failed');
      return [];
    }
  }

  async fetchRecentFills() {
    if (!this.accountId || !this.accessToken) {
      return [];
    }
    try {
      const response = await this.http.get(`/v3/accounts/${this.accountId}/transactions`, {
        params: {
          type: 'ORDER_FILL'
        }
      });
      return response.data?.transactions || [];
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'Oanda fetchRecentFills failed');
      return [];
    }
  }

  async fetchAccountSummary() {
    if (!this.accountId || !this.accessToken) {
      return null;
    }
    try {
      const response = await this.http.get(`/v3/accounts/${this.accountId}/summary`);
      return response.data?.account || null;
    } catch (error) {
      this.logger?.warn?.({ err: error, broker: this.name }, 'Oanda fetchAccountSummary failed');
      return null;
    }
  }
}

export default OandaConnector;
