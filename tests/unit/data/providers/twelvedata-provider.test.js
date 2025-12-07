/**
 * Unit tests for TwelveData Provider
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock TwelveData provider for testing without network
const createMockProvider = (options = {}) => {
  return {
    apiKey: options.apiKey,
    name: 'twelveData',
    cooldownMs: options.cooldownMs || 5000,

    isConfigured() {
      if (!this.apiKey) {
        return false;
      }
      const keyStr = String(this.apiKey).toLowerCase();
      if (keyStr === 'free' || keyStr === 'demo' || keyStr === '') {
        return false;
      }
      return true;
    },

    formatPair(pair) {
      if (!pair) {
        return null;
      }
      const normalized = pair.toUpperCase().replace(/[^A-Z]/g, '');
      if (normalized.length !== 6) {
        return null;
      }
      return `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
    },

    convertTimeframe(timeframe) {
      const mapping = {
        M1: '1min',
        M5: '5min',
        M15: '15min',
        M30: '30min',
        H1: '1h',
        H4: '4h',
        D1: '1day',
        W1: '1week'
      };
      return mapping[timeframe] || timeframe;
    },

    normalizeQuote(data) {
      if (!data || !data.close) {
        return null;
      }
      return {
        open: parseFloat(data.open),
        high: parseFloat(data.high),
        low: parseFloat(data.low),
        close: parseFloat(data.close),
        volume: parseFloat(data.volume) || 0,
        timestamp: Date.now()
      };
    },

    normalizeBars(values) {
      if (!Array.isArray(values)) {
        return [];
      }
      return values.map((bar) => ({
        datetime: bar.datetime,
        open: parseFloat(bar.open),
        high: parseFloat(bar.high),
        low: parseFloat(bar.low),
        close: parseFloat(bar.close),
        volume: parseFloat(bar.volume) || 0
      }));
    },

    async fetchQuote({ pair }) {
      if (!this.isConfigured()) {
        return null;
      }

      const symbol = this.formatPair(pair);
      if (!symbol) {
        return null;
      }

      // Mock response
      return this.normalizeQuote({
        open: '1.0850',
        high: '1.0920',
        low: '1.0800',
        close: '1.0890',
        volume: '125000'
      });
    },

    async fetchBars({ pair, timeframe: _timeframe, bars }) {
      if (!this.isConfigured()) {
        return null;
      }

      const symbol = this.formatPair(pair);
      if (!symbol) {
        return null;
      }

      // Mock response with requested number of bars
      const mockBars = [];
      const basePrice = 1.085;
      const now = Date.now();

      for (let i = 0; i < bars; i++) {
        const variation = (Math.random() - 0.5) * 0.01;
        mockBars.push({
          datetime: new Date(now - i * 900000).toISOString(),
          open: (basePrice + variation).toFixed(5),
          high: (basePrice + variation + 0.002).toFixed(5),
          low: (basePrice + variation - 0.002).toFixed(5),
          close: (basePrice + variation + 0.001).toFixed(5),
          volume: Math.floor(Math.random() * 10000).toString()
        });
      }

      return this.normalizeBars(mockBars);
    }
  };
};

describe('TwelveData Provider', () => {
  let provider;

  beforeEach(() => {
    provider = createMockProvider({ apiKey: 'valid_api_key_123' });
  });

  describe('Configuration', () => {
    it('should be configured with valid API key', () => {
      assert.strictEqual(provider.isConfigured(), true);
    });

    it('should not be configured with demo key', () => {
      const demoProvider = createMockProvider({ apiKey: 'demo' });
      assert.strictEqual(demoProvider.isConfigured(), false);
    });

    it('should not be configured with free key', () => {
      const freeProvider = createMockProvider({ apiKey: 'free' });
      assert.strictEqual(freeProvider.isConfigured(), false);
    });

    it('should not be configured without API key', () => {
      const noKeyProvider = createMockProvider({ apiKey: '' });
      assert.strictEqual(noKeyProvider.isConfigured(), false);
    });
  });

  describe('Pair Formatting', () => {
    it('should format valid forex pairs', () => {
      assert.strictEqual(provider.formatPair('EURUSD'), 'EUR/USD');
      assert.strictEqual(provider.formatPair('EUR/USD'), 'EUR/USD');
      assert.strictEqual(provider.formatPair('eur-usd'), 'EUR/USD');
    });

    it('should return null for invalid pairs', () => {
      assert.strictEqual(provider.formatPair('EUR'), null);
      assert.strictEqual(provider.formatPair('EURUSDJPY'), null);
      assert.strictEqual(provider.formatPair(''), null);
      assert.strictEqual(provider.formatPair(null), null);
    });
  });

  describe('Timeframe Conversion', () => {
    it('should convert standard timeframes', () => {
      assert.strictEqual(provider.convertTimeframe('M1'), '1min');
      assert.strictEqual(provider.convertTimeframe('M5'), '5min');
      assert.strictEqual(provider.convertTimeframe('M15'), '15min');
      assert.strictEqual(provider.convertTimeframe('H1'), '1h');
      assert.strictEqual(provider.convertTimeframe('H4'), '4h');
      assert.strictEqual(provider.convertTimeframe('D1'), '1day');
    });

    it('should pass through unknown timeframes', () => {
      assert.strictEqual(provider.convertTimeframe('unknown'), 'unknown');
    });
  });

  describe('Quote Normalization', () => {
    it('should normalize valid quote data', () => {
      const rawQuote = {
        open: '1.0850',
        high: '1.0920',
        low: '1.0800',
        close: '1.0890',
        volume: '125000'
      };

      const normalized = provider.normalizeQuote(rawQuote);

      assert.strictEqual(normalized.open, 1.085);
      assert.strictEqual(normalized.high, 1.092);
      assert.strictEqual(normalized.low, 1.08);
      assert.strictEqual(normalized.close, 1.089);
      assert.strictEqual(normalized.volume, 125000);
      assert.ok(normalized.timestamp > 0);
    });

    it('should return null for invalid data', () => {
      assert.strictEqual(provider.normalizeQuote(null), null);
      assert.strictEqual(provider.normalizeQuote({}), null);
      assert.strictEqual(provider.normalizeQuote({ open: '1.0' }), null);
    });
  });

  describe('Bars Normalization', () => {
    it('should normalize array of bars', () => {
      const rawBars = [
        {
          datetime: '2024-01-01 12:00:00',
          open: '1.0850',
          high: '1.0870',
          low: '1.0840',
          close: '1.0860',
          volume: '5000'
        }
      ];

      const normalized = provider.normalizeBars(rawBars);

      assert.strictEqual(normalized.length, 1);
      assert.strictEqual(normalized[0].open, 1.085);
      assert.strictEqual(normalized[0].close, 1.086);
    });

    it('should return empty array for invalid data', () => {
      assert.deepStrictEqual(provider.normalizeBars(null), []);
      assert.deepStrictEqual(provider.normalizeBars('invalid'), []);
    });
  });

  describe('Fetch Quote', () => {
    it('should fetch quote for valid pair', async () => {
      const quote = await provider.fetchQuote({ pair: 'EURUSD' });

      assert.ok(quote, 'Should return quote');
      assert.ok(quote.open > 0, 'Should have open price');
      assert.ok(quote.high > 0, 'Should have high price');
      assert.ok(quote.low > 0, 'Should have low price');
      assert.ok(quote.close > 0, 'Should have close price');
    });

    it('should return null for invalid pair', async () => {
      const quote = await provider.fetchQuote({ pair: 'INVALID' });
      assert.strictEqual(quote, null);
    });

    it('should return null when not configured', async () => {
      const unconfigured = createMockProvider({ apiKey: '' });
      const quote = await unconfigured.fetchQuote({ pair: 'EURUSD' });
      assert.strictEqual(quote, null);
    });
  });

  describe('Fetch Bars', () => {
    it('should fetch requested number of bars', async () => {
      const bars = await provider.fetchBars({
        pair: 'EURUSD',
        timeframe: 'M15',
        bars: 10
      });

      assert.strictEqual(bars.length, 10);
    });

    it('should return bars with OHLC data', async () => {
      const bars = await provider.fetchBars({
        pair: 'EURUSD',
        timeframe: 'H1',
        bars: 5
      });

      for (const bar of bars) {
        assert.ok(bar.datetime, 'Bar should have datetime');
        assert.ok(bar.open > 0, 'Bar should have open');
        assert.ok(bar.high > 0, 'Bar should have high');
        assert.ok(bar.low > 0, 'Bar should have low');
        assert.ok(bar.close > 0, 'Bar should have close');
      }
    });

    it('should return null for invalid pair', async () => {
      const bars = await provider.fetchBars({
        pair: 'X',
        timeframe: 'M15',
        bars: 10
      });
      assert.strictEqual(bars, null);
    });
  });
});
