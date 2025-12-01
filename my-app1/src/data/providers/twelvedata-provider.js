import axios from 'axios';
import BasePriceProvider from './base-provider.js';

export default class TwelveDataProvider extends BasePriceProvider {
  constructor(options = {}) {
    super({ ...options, name: 'twelveData' });
    this.apiKey = options.apiKey;
    this.formatPair = options.formatPair;
    this.recordRequest = options.recordRequest;
    this.validatePriceBars = options.validatePriceBars;
    this.normalizeQuote = options.normalizeQuote;
    this.normalizeBars = options.normalizeBars;
    this.registerRateLimitHit = options.registerRateLimitHit;
    this.shouldUseSyntheticData = options.shouldUseSyntheticData;
    this.generateSyntheticQuote = options.generateSyntheticQuote;
    this.convertTimeframe = options.convertTimeframe;
    this.cooldownMs = options.cooldownMs || 5000;
  }

  isConfigured() {
    return Boolean(this.apiKey && !['free', 'demo'].includes(String(this.apiKey).toLowerCase()));
  }

  async fetchBars({ pair, timeframe, bars, options = {} }) {
    if (!this.isConfigured()) {
      return null;
    }

    const { symbol: symbolOverride, timeoutMs, intervalOverride } = options;
    const symbol = symbolOverride || this.formatPair?.(pair);
    if (!symbol) {
      this.logger?.warn?.(
        { provider: 'twelveData', pair },
        'Twelve Data symbol could not be derived'
      );
      return null;
    }

    const interval = intervalOverride || this.convertTimeframe?.(timeframe) || timeframe;
    const params = {
      symbol,
      interval,
      outputsize: bars,
      apikey: this.apiKey,
      order: 'desc'
    };

    const started = Date.now();

    try {
      const { data, status } = await axios.get('https://api.twelvedata.com/time_series', {
        params,
        timeout: timeoutMs || 7000
      });

      if (status === 429 || data?.code === 429) {
        this.registerRateLimitHit?.('twelveData');
        this.recordRequest?.('twelveData', { success: false, latencyMs: Date.now() - started });
        return null;
      }

      const normalized = this.normalizeBars?.(data?.values) || [];
      const validated =
        this.validatePriceBars?.(normalized, { pair, timeframe, provider: 'twelveData' }) || [];
      this.recordRequest?.('twelveData', {
        success: validated.length > 0,
        latencyMs: Date.now() - started
      });
      return validated;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfterMs = error.response.headers?.['retry-after']
          ? Number.parseInt(error.response.headers['retry-after'], 10) * 1000
          : this.cooldownMs;
        this.registerRateLimitHit?.('twelveData', { retryAfterMs });
      }
      this.recordRequest?.('twelveData', { success: false, latencyMs: Date.now() - started });
      this.logger?.warn?.(
        { err: error, provider: 'twelveData', pair, timeframe },
        'Twelve Data bars fetch failed'
      );
      return null;
    }
  }

  async fetchQuote({ pair, options = {} }) {
    if (this.shouldUseSyntheticData?.(options)) {
      return this.generateSyntheticQuote?.(pair, { ...options, provider: 'twelveData' });
    }

    if (!this.isConfigured()) {
      return null;
    }

    const { symbol: symbolOverride, timeoutMs } = options;
    const symbol = symbolOverride || this.formatPair?.(pair);
    if (!symbol) {
      this.logger?.warn?.(
        { provider: 'twelveData', pair },
        'Twelve Data symbol could not be derived'
      );
      return null;
    }

    const params = {
      symbol,
      apikey: this.apiKey
    };

    const started = Date.now();

    try {
      const { data, status } = await axios.get('https://api.twelvedata.com/quote', {
        params,
        timeout: timeoutMs || 5000
      });

      if (status === 429 || data?.code === 429) {
        this.registerRateLimitHit?.('twelveData');
        this.recordRequest?.('twelveData', { success: false, latencyMs: Date.now() - started });
        return null;
      }

      const normalized = this.normalizeQuote?.(data);
      if (normalized) {
        this.recordRequest?.('twelveData', { success: true, latencyMs: Date.now() - started });
        return normalized;
      }

      this.recordRequest?.('twelveData', { success: false, latencyMs: Date.now() - started });
      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfterMs = error.response.headers?.['retry-after']
          ? Number.parseInt(error.response.headers['retry-after'], 10) * 1000
          : this.cooldownMs;
        this.registerRateLimitHit?.('twelveData', { retryAfterMs });
      }
      this.recordRequest?.('twelveData', { success: false, latencyMs: Date.now() - started });
      this.logger?.warn?.(
        { err: error, provider: 'twelveData', pair },
        'Twelve Data quote fetch failed'
      );
      return null;
    }
  }
}
