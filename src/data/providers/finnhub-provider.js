import axios from 'axios';
import BasePriceProvider from './base-provider.js';

export default class FinnhubProvider extends BasePriceProvider {
  constructor(options = {}) {
    super({ ...options, name: 'finnhub' });
    this.apiKey = options.apiKey;
    this.resolveSymbol = options.resolveSymbol;
    this.convertTimeframe = options.convertTimeframe;
    this.getTimeframeSeconds = options.getTimeframeSeconds;
    this.recordRequest = options.recordRequest;
    this.validatePriceBars = options.validatePriceBars;
    this.normalizeBars = options.normalizeBars;
    this.normalizeQuote = options.normalizeQuote;
    this.registerRateLimitHit = options.registerRateLimitHit;
    this.shouldUseSyntheticData = options.shouldUseSyntheticData;
    this.generateSyntheticQuote = options.generateSyntheticQuote;
    this.cooldownMs = options.cooldownMs || 10000;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey !== 'demo');
  }

  resolvePairSymbol(pair, explicitSymbol) {
    if (typeof explicitSymbol === 'string' && explicitSymbol.trim().length > 0) {
      return explicitSymbol.trim();
    }
    if (typeof this.resolveSymbol === 'function') {
      return this.resolveSymbol(pair);
    }
    return null;
  }

  async fetchBars({ pair, timeframe, bars, options = {} }) {
    if (!this.isConfigured()) {
      return null;
    }

    const symbol = this.resolvePairSymbol(pair, options.symbol);
    if (!symbol) {
      this.logger?.warn?.({ provider: 'finnhub', pair }, 'Finnhub symbol could not be derived');
      return null;
    }

    const resolution = this.convertTimeframe?.(timeframe) || timeframe;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowSeconds = this.getTimeframeSeconds?.(timeframe) || 60;
    const from = nowSeconds - windowSeconds * bars;

    const params = {
      symbol,
      resolution,
      from,
      to: nowSeconds,
      token: this.apiKey
    };

    const started = Date.now();

    try {
      const { data, status } = await axios.get('https://finnhub.io/api/v1/forex/candle', {
        params,
        timeout: options.timeoutMs || 10000
      });

      if (status === 429) {
        this.registerRateLimitHit?.('finnhub');
        this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
        return null;
      }

      if (typeof data?.s === 'string' && data.s.toUpperCase() === 'NO_DATA') {
        this.logger?.warn?.(
          { provider: 'finnhub', pair, timeframe },
          'Finnhub returned NO_DATA status'
        );
        this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
        return null;
      }

      const normalized = this.normalizeBars?.(data) || [];
      const validated =
        this.validatePriceBars?.(normalized, { pair, timeframe, provider: 'finnhub' }) || [];
      this.recordRequest?.('finnhub', {
        success: validated.length > 0,
        latencyMs: Date.now() - started
      });
      return validated;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfterHeader = error.response.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10) * 1000
          : this.cooldownMs;
        this.registerRateLimitHit?.('finnhub', { retryAfterMs });
      }
      this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
      this.logger?.warn?.(
        { err: error, provider: 'finnhub', pair, timeframe },
        'Finnhub bars fetch failed'
      );
      return null;
    }
  }

  async fetchQuote({ pair, options = {} }) {
    if (this.shouldUseSyntheticData?.(options)) {
      return this.generateSyntheticQuote?.(pair, { ...options, provider: 'finnhub' });
    }

    if (!this.isConfigured()) {
      return null;
    }

    const symbol = this.resolvePairSymbol(pair, options.symbol);
    if (!symbol) {
      this.logger?.warn?.({ provider: 'finnhub', pair }, 'Finnhub symbol could not be derived');
      return null;
    }

    const params = {
      symbol,
      token: this.apiKey
    };

    const started = Date.now();

    try {
      const { data, status } = await axios.get('https://finnhub.io/api/v1/forex/quote', {
        params,
        timeout: options.timeoutMs || 4000
      });

      if (status === 429) {
        this.registerRateLimitHit?.('finnhub');
        this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
        return null;
      }

      const normalized = this.normalizeQuote?.(data);
      if (normalized) {
        this.recordRequest?.('finnhub', { success: true, latencyMs: Date.now() - started });
        return normalized;
      }

      this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfterHeader = error.response.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10) * 1000
          : this.cooldownMs;
        this.registerRateLimitHit?.('finnhub', { retryAfterMs });
      }
      this.recordRequest?.('finnhub', { success: false, latencyMs: Date.now() - started });
      this.logger?.warn?.({ err: error, provider: 'finnhub', pair }, 'Finnhub quote fetch failed');
      return null;
    }
  }
}
