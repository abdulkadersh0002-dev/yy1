export default class BasePriceProvider {
  constructor({ name, logger, rateLimits, requestIntervals, metrics } = {}) {
    this.name = name || 'unknown-provider';
    this.logger = logger;
    this.rateLimits = rateLimits;
    this.requestIntervals = requestIntervals;
    this.metrics = metrics;
  }

  isConfigured() {
    return false;
  }

  async fetchBars() {
    throw new Error('fetchBars not implemented');
  }

  async fetchQuote() {
    throw new Error('fetchQuote not implemented');
  }
}
