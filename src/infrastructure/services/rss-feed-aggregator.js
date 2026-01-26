import RSSParser from 'rss-parser';
import axios from 'axios';
import { appConfig } from '../../app/config.js';

const DEFAULT_FEEDS = [
  // === MAJOR FINANCIAL NEWS SOURCES ===
  {
    id: 'reuters-top-news',
    name: 'Reuters',
    url: [
      'https://www.reuters.com/feed/rss/businessNews',
      'https://news.google.com/rss/search?q=site:reuters.com+business&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'macro',
    priority: 1
  },
  {
    id: 'reuters-markets',
    name: 'Reuters Markets',
    url: [
      'https://www.reuters.com/markets/europe/rss',
      'https://news.google.com/rss/search?q=site:reuters.com+markets&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 1
  },
  {
    id: 'bloomberg-markets',
    name: 'Bloomberg Markets',
    url: [
      'https://news.google.com/rss/search?q=site:bloomberg.com+markets&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Bloomberg+forex+currency&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 1
  },
  {
    id: 'cnbc-markets',
    name: 'CNBC Markets',
    url: [
      'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
      'https://news.google.com/rss/search?q=site:cnbc.com+markets&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 1
  },
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    url: [
      'https://finance.yahoo.com/news/rssindex',
      'https://news.google.com/rss/search?q=site:finance.yahoo.com+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 2
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    url: [
      'https://feeds.marketwatch.com/marketwatch/marketpulse/',
      'https://news.google.com/rss/search?q=site:marketwatch.com+markets&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 2
  },
  // === FOREX SPECIALIZED SOURCES ===
  {
    id: 'investing-com',
    name: 'Investing.com',
    url: [
      'https://www.investing.com/rss/news_25.rss',
      'https://news.google.com/rss/search?q=site:investing.com+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'forex',
    priority: 1
  },
  {
    id: 'forexlive',
    name: 'ForexLive',
    url: [
      'https://www.forexlive.com/feed/news',
      'https://news.google.com/rss/search?q=site:forexlive.com&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'forex',
    priority: 1
  },
  {
    id: 'dailyfx',
    name: 'DailyFX',
    url: [
      'https://www.dailyfx.com/feeds/forex_market_news',
      'https://news.google.com/rss/search?q=DailyFX+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'forex',
    priority: 1
  },
  {
    id: 'fxstreet',
    name: 'FXStreet',
    url: [
      'https://news.google.com/rss/search?q=site:fxstreet.com+forex&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=FXStreet+currency&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'forex',
    priority: 2
  },
  // === CENTRAL BANK & ECONOMIC SOURCES ===
  {
    id: 'federal-reserve',
    name: 'Federal Reserve',
    url: [
      'https://news.google.com/rss/search?q=Federal+Reserve+interest+rate&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Fed+monetary+policy&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'macro',
    priority: 1
  },
  {
    id: 'ecb-news',
    name: 'ECB News',
    url: [
      'https://news.google.com/rss/search?q=ECB+European+Central+Bank&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=ECB+interest+rate&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'macro',
    priority: 1
  },
  {
    id: 'financial-times',
    name: 'Financial Times',
    url: [
      'https://news.google.com/rss/search?q=site:ft.com+markets&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Financial+Times+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 1
  },
  {
    id: 'wsj-markets',
    name: 'Wall Street Journal',
    url: [
      'https://news.google.com/rss/search?q=site:wsj.com+markets&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Wall+Street+Journal+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets',
    priority: 1
  },
  // === ECONOMIC CALENDAR & DATA (FREE) ===
  {
    id: 'trading-economics',
    name: 'Trading Economics',
    url: [
      'https://tradingeconomics.com/rss/calendar.aspx',
      'https://news.google.com/rss/search?q=site:tradingeconomics.com+economic+calendar&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'economic-calendar',
    priority: 1
  },
  {
    id: 'forex-factory',
    name: 'Forex Factory',
    url: [
      'https://news.google.com/rss/search?q=site:forexfactory.com+calendar&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Forex+Factory+economic+data&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'economic-calendar',
    priority: 1
  },
  {
    id: 'myfxbook',
    name: 'Myfxbook Economic Calendar',
    url: [
      'https://news.google.com/rss/search?q=site:myfxbook.com+economic&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Myfxbook+calendar&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'economic-calendar',
    priority: 2
  },
  // === SENTIMENT & ANALYSIS (FREE) ===
  {
    id: 'sentiment-trader',
    name: 'Sentiment Trader',
    url: [
      'https://news.google.com/rss/search?q=market+sentiment+forex&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=fear+greed+index&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'sentiment',
    priority: 2
  },
  {
    id: 'commitment-of-traders',
    name: 'COT Reports',
    url: [
      'https://news.google.com/rss/search?q=CFTC+commitment+of+traders&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=COT+report+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'sentiment',
    priority: 2
  }
];

function parseDate(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : Date.now();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function buildNormalizedItem(feedMeta, item) {
  const headline = item.title || item.headline || item.summary || 'Untitled';
  const summary = item.contentSnippet || item.summary || item.content || null;
  const timestamp = parseDate(item.isoDate || item.pubDate || item.date || item.published);
  const url = item.link || item.guid || null;

  return {
    feedId: feedMeta.id,
    source: feedMeta.name,
    category: feedMeta.category,
    headline,
    summary,
    timestamp,
    url,
    raw: {
      guid: item.guid || null,
      categories: item.categories || [],
      author: item.creator || item.author || null
    }
  };
}

function isRealKey(value) {
  if (!value) {
    return false;
  }
  const normalized = String(value).toLowerCase();
  if (normalized === 'demo' || normalized === 'free') {
    return false;
  }
  return !normalized.startsWith('test_');
}

export default class RssFeedAggregator {
  constructor(options = {}) {
    const {
      feeds = DEFAULT_FEEDS,
      cacheTtlMs = 5 * 60 * 1000,
      apiKeys = {},
      polygonLimit = 40,
      finnhubCategory = 'forex',
      logger = console,
      nodeEnv = process.env.NODE_ENV
    } = options;
    this.requestHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36',
      Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
    };
    this.parser = new RSSParser({
      timeout: 10000,
      headers: this.requestHeaders,
      requestOptions: {
        headers: this.requestHeaders
      }
    });
    this.feeds = feeds;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.logCooldownMs = 5 * 60 * 1000;
    this.lastErrorLogAt = new Map();
    this.feedFailureState = new Map();
    this.logger = logger;
    const isTestRunner =
      process.env.npm_lifecycle_event === 'test' ||
      (typeof process.env.npm_lifecycle_script === 'string' &&
        process.env.npm_lifecycle_script.includes('--test')) ||
      (Array.isArray(process.argv) && process.argv.includes('--test'));
    this.suppressLogs =
      nodeEnv === 'test' || isTestRunner || process.env.SUPPRESS_RSS_LOGS === 'true';
    // External provider keys are intentionally ignored in EA-only + RSS-only mode.
    // Keep the option for backward compatibility with older callers.
    void apiKeys;
    this.apiKeys = {};
    this.polygonLimit = polygonLimit;
    this.finnhubCategory = finnhubCategory;
  }

  logErrorWithCooldown(key, message) {
    if (this.suppressLogs) {
      return;
    }
    const now = Date.now();
    const lastLogAt = this.lastErrorLogAt.get(key) || 0;
    if (now - lastLogAt < this.logCooldownMs) {
      return;
    }
    this.lastErrorLogAt.set(key, now);
    if (typeof this.logger?.warn === 'function') {
      this.logger.warn(message);
    } else {
      console.warn(message);
    }
  }

  getFeedBackoffState(feedId) {
    return this.feedFailureState.get(feedId) || { failures: 0, nextRetryAt: 0, lastStatus: null };
  }

  resetFeedBackoff(feedId) {
    this.feedFailureState.delete(feedId);
  }

  scheduleFeedRetry(feedId, statusCode) {
    const state = this.getFeedBackoffState(feedId);
    const failures = Math.max(1, state.failures + 1);

    let baseDelayMs = 60 * 1000;
    if (statusCode === 429) {
      baseDelayMs = 10 * 60 * 1000;
    } else if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
      baseDelayMs = 60 * 60 * 1000;
    } else if (typeof statusCode === 'number' && statusCode >= 500) {
      baseDelayMs = 2 * 60 * 1000;
    }

    const exponent = Math.min(failures - 1, 6);
    const delayMs = Math.min(baseDelayMs * 2 ** exponent, 6 * 60 * 60 * 1000);

    const nextRetryAt = Date.now() + delayMs;
    this.feedFailureState.set(feedId, {
      failures,
      nextRetryAt,
      lastStatus: typeof statusCode === 'number' ? statusCode : null
    });

    return delayMs;
  }

  async fetchAll(options = {}) {
    const { maxItems = 25, keywords = [] } = options;
    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.map((k) => String(k).toLowerCase()).filter(Boolean)
      : [];

    const feedsResult = await this.fetchFeeds({ maxItems, keywords: normalizedKeywords });

    return [...feedsResult]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxItems * this.feeds.length);
  }

  async fetchFeeds(options) {
    const results = await Promise.allSettled(
      this.feeds.map((feed) => this.fetchFeed(feed, options))
    );

    return results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
  }

  async fetchFeed(feed, options) {
    const cacheKey = `${feed.id}:${options.maxItems}:${options.keywords.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const backoffState = this.getFeedBackoffState(feed.id);
    if (Date.now() < backoffState.nextRetryAt) {
      this.setCached(cacheKey, []);
      return [];
    }

    const urls = Array.isArray(feed.url) ? feed.url : [feed.url];
    let lastError = null;
    let hadSuccessfulFetch = false;

    for (const url of urls) {
      try {
        const fetchResponse = await axios.get(url, {
          headers: this.requestHeaders,
          timeout: 10000,
          responseType: 'text'
        });

        const parsedFeed = await this.parser.parseString(fetchResponse.data);
        hadSuccessfulFetch = true;
        const items = Array.isArray(parsedFeed.items) ? parsedFeed.items : [];
        const normalized = items
          .map((item) => buildNormalizedItem(feed, item))
          .filter((item) => this.matchesKeywords(item, options.keywords))
          .slice(0, options.maxItems);

        if (normalized.length > 0) {
          this.resetFeedBackoff(feed.id);
          this.setCached(cacheKey, normalized);
          return normalized;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError && !hadSuccessfulFetch) {
      const statusCode = lastError?.response?.status;
      const delayMs = this.scheduleFeedRetry(feed.id, statusCode);
      const statusLabel =
        typeof statusCode === 'number' ? `HTTP ${statusCode}` : lastError.code || 'error';
      this.logErrorWithCooldown(
        `feed:${feed.id}`,
        `RSS fetch failed for ${feed.name} (${statusLabel}); retrying in ${Math.round(
          delayMs / 1000
        )}s: ${lastError.message}`
      );
    }
    this.setCached(cacheKey, []);
    return [];
  }

  async fetchPolygonNews(options) {
    void options;
    return [];
  }

  async fetchFinnhubNews(options) {
    void options;
    return [];
  }

  matchesKeywords(item, keywords) {
    if (!keywords || keywords.length === 0) {
      return true;
    }
    const haystack = `${item.headline} ${item.summary || ''} ${item.source}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.value;
    }
    this.cache.delete(key);
    return null;
  }

  setCached(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }
}
