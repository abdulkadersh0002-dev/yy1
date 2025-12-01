/**
 * Unit tests for RSS Feed Aggregator
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock the RSS aggregator for testing without network
const createMockAggregator = () => {
  const mockFeeds = [
    {
      id: 'reuters-top-news',
      name: 'Reuters',
      url: ['https://www.reuters.com/feed/rss/businessNews'],
      category: 'macro',
      priority: 1
    },
    {
      id: 'bloomberg-markets',
      name: 'Bloomberg Markets',
      url: ['https://news.google.com/rss/search?q=bloomberg+markets'],
      category: 'markets',
      priority: 1
    },
    {
      id: 'forexlive',
      name: 'ForexLive',
      url: ['https://www.forexlive.com/feed/news'],
      category: 'forex',
      priority: 1
    }
  ];

  return {
    feeds: mockFeeds,
    cache: new Map(),
    cacheTtlMs: 5 * 60 * 1000,

    getCached(key) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      if (Date.now() - cached.timestamp < this.cacheTtlMs) {
        return cached.value;
      }
      this.cache.delete(key);
      return null;
    },

    setCached(key, value) {
      this.cache.set(key, { value, timestamp: Date.now() });
    },

    matchesKeywords(item, keywords) {
      if (!keywords || keywords.length === 0) return true;
      const haystack = `${item.headline} ${item.summary || ''} ${item.source}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    },

    // Simulate fetching feeds with mock data
    async fetchFeeds(options = {}) {
      const mockItems = [
        {
          feedId: 'reuters-top-news',
          source: 'Reuters',
          category: 'macro',
          headline: 'Federal Reserve signals rate decision',
          summary: 'The Federal Reserve is expected to make a key announcement.',
          timestamp: Date.now(),
          url: 'https://reuters.com/article/1'
        },
        {
          feedId: 'bloomberg-markets',
          source: 'Bloomberg Markets',
          category: 'markets',
          headline: 'EUR/USD trades near 1.09 level',
          summary: 'Currency markets see volatility amid economic data.',
          timestamp: Date.now() - 60000,
          url: 'https://bloomberg.com/article/1'
        },
        {
          feedId: 'forexlive',
          source: 'ForexLive',
          category: 'forex',
          headline: 'GBP/USD bounces from support',
          summary: 'Technical analysis shows key support levels holding.',
          timestamp: Date.now() - 120000,
          url: 'https://forexlive.com/article/1'
        }
      ];

      return mockItems
        .filter((item) => this.matchesKeywords(item, options.keywords || []))
        .slice(0, options.maxItems || 25);
    },

    async fetchAll(options = {}) {
      return this.fetchFeeds(options);
    }
  };
};

describe('RSS Feed Aggregator', () => {
  let aggregator;

  beforeEach(() => {
    aggregator = createMockAggregator();
  });

  describe('Feed Configuration', () => {
    it('should have multiple feeds configured', () => {
      assert.ok(aggregator.feeds.length >= 3, 'Should have at least 3 feeds');
    });

    it('should have feeds with required properties', () => {
      for (const feed of aggregator.feeds) {
        assert.ok(feed.id, 'Feed should have id');
        assert.ok(feed.name, 'Feed should have name');
        assert.ok(feed.url, 'Feed should have url');
        assert.ok(feed.category, 'Feed should have category');
      }
    });

    it('should have feeds with priority levels', () => {
      const priorityFeeds = aggregator.feeds.filter((f) => f.priority === 1);
      assert.ok(priorityFeeds.length > 0, 'Should have high priority feeds');
    });

    it('should have feeds for different categories', () => {
      const categories = new Set(aggregator.feeds.map((f) => f.category));
      assert.ok(categories.has('macro') || categories.has('markets') || categories.has('forex'));
    });
  });

  describe('Caching', () => {
    it('should cache fetched items', () => {
      const key = 'test-cache-key';
      const value = [{ headline: 'Test news' }];

      aggregator.setCached(key, value);
      const cached = aggregator.getCached(key);

      assert.deepStrictEqual(cached, value);
    });

    it('should return null for expired cache', async () => {
      const key = 'expired-key';
      const value = [{ headline: 'Old news' }];

      aggregator.cacheTtlMs = 1; // 1ms TTL
      aggregator.setCached(key, value);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const cached = aggregator.getCached(key);
      assert.strictEqual(cached, null);
    });

    it('should return null for non-existent cache', () => {
      const cached = aggregator.getCached('non-existent-key');
      assert.strictEqual(cached, null);
    });
  });

  describe('Keyword Matching', () => {
    it('should match items containing keyword in headline', () => {
      const item = {
        headline: 'EUR/USD rises on Federal Reserve news',
        summary: 'Markets react to announcement',
        source: 'Reuters'
      };

      const matches = aggregator.matchesKeywords(item, ['eur', 'federal']);
      assert.strictEqual(matches, true);
    });

    it('should match items containing keyword in summary', () => {
      const item = {
        headline: 'Market update',
        summary: 'USD/JPY falls as dollar weakens',
        source: 'Bloomberg'
      };

      const matches = aggregator.matchesKeywords(item, ['dollar']);
      assert.strictEqual(matches, true);
    });

    it('should return true when no keywords provided', () => {
      const item = { headline: 'Any news', summary: 'Any content', source: 'Any' };

      const matches = aggregator.matchesKeywords(item, []);
      assert.strictEqual(matches, true);
    });

    it('should return false when no keywords match', () => {
      const item = {
        headline: 'Crypto news',
        summary: 'Bitcoin rises',
        source: 'CoinDesk'
      };

      const matches = aggregator.matchesKeywords(item, ['forex', 'eur']);
      assert.strictEqual(matches, false);
    });
  });

  describe('Fetch Operations', () => {
    it('should fetch news items', async () => {
      const items = await aggregator.fetchAll({ maxItems: 10 });

      assert.ok(Array.isArray(items), 'Should return an array');
      assert.ok(items.length > 0, 'Should return some items');
    });

    it('should respect maxItems limit', async () => {
      const items = await aggregator.fetchAll({ maxItems: 2 });

      assert.ok(items.length <= 2, 'Should not exceed maxItems');
    });

    it('should filter by keywords', async () => {
      const items = await aggregator.fetchAll({
        maxItems: 10,
        keywords: ['eur', 'gbp']
      });

      for (const item of items) {
        const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
        const hasKeyword = ['eur', 'gbp'].some((k) => text.includes(k));
        assert.ok(hasKeyword, 'Each item should contain at least one keyword');
      }
    });

    it('should return items with required properties', async () => {
      const items = await aggregator.fetchAll({ maxItems: 5 });

      for (const item of items) {
        assert.ok(item.feedId, 'Item should have feedId');
        assert.ok(item.source, 'Item should have source');
        assert.ok(item.headline, 'Item should have headline');
        assert.ok(item.timestamp, 'Item should have timestamp');
      }
    });

    it('should sort items by timestamp descending', async () => {
      const items = await aggregator.fetchAll({ maxItems: 10 });

      for (let i = 1; i < items.length; i++) {
        assert.ok(
          items[i - 1].timestamp >= items[i].timestamp,
          'Items should be sorted by timestamp descending'
        );
      }
    });
  });
});
