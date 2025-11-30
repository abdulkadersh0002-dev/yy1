import axios from 'axios';

class BaseBrokerConnector {
  constructor(options = {}) {
    this.name = options.name || 'broker';
    this.logger = options.logger || console;
    this.accountMode = options.accountMode === 'real' ? 'real' : 'demo';
    this.http = options.http || axios.create(options.httpOptions || {});
  }

  get id() {
    return this.name;
  }

  isRealAccount() {
    return this.accountMode === 'real';
  }

  async healthCheck() {
    return {
      broker: this.name,
      mode: this.accountMode,
      connected: false,
      details: 'Not implemented'
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async placeOrder() {
    throw new Error('placeOrder not implemented for connector');
  }

  // eslint-disable-next-line class-methods-use-this
  async closePosition() {
    throw new Error('closePosition not implemented for connector');
  }

  // eslint-disable-next-line class-methods-use-this
  async fetchOpenPositions() {
    return [];
  }

  // eslint-disable-next-line class-methods-use-this
  async fetchRecentFills() {
    return [];
  }

  // eslint-disable-next-line class-methods-use-this
  async fetchAccountSummary() {
    return null;
  }
}

export default BaseBrokerConnector;
