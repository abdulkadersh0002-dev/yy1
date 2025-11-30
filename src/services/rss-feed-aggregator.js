import RSSParser from 'rss-parser';
import axios from 'axios';

const DEFAULT_FEEDS = [
  {
    id: 'reuters-top-news',
    name: 'Reuters',
    url: [
      'https://www.reuters.com/feed/rss/businessNews',
      'https://news.google.com/rss/search?q=site:reuters.com+business&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'macro'
  },
  {
    id: 'reuters-markets',
    name: 'Reuters Markets',
    url: [
      'https://www.reuters.com/markets/europe/rss',
      'https://news.google.com/rss/search?q=site:reuters.com+markets&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets'
  },
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/news/rssindex',
    category: 'markets'
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    url: [
      'https://feeds.marketwatch.com/marketwatch/marketpulse/',
      'https://news.google.com/rss/search?q=site:marketwatch.com+markets&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'markets'
  },
  {
    id: 'investing-com',
    name: 'Investing.com',
    url: 'https://www.investing.com/rss/news_25.rss',
    category: 'forex'
  },
  {
    id: 'forexlive',
    name: 'ForexLive',
    url: 'https://www.forexlive.com/feed/news',
    category: 'forex'
  },
  {
    id: 'dailyfx',
    name: 'DailyFX',
    url: [
      'https://www.dailyfx.com/feeds/forex_market_news',
      'https://news.google.com/rss/search?q=DailyFX+forex&hl=en-US&gl=US&ceid=US:en'
    ],
    category: 'forex'
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
      finnhubCategory = 'forex'
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
    this.apiKeys = {
      polygon: apiKeys.polygon || process.env.POLYGON_API_KEY,
      finnhub: apiKeys.finnhub || process.env.FINNHUB_API_KEY
    };
    this.polygonLimit = polygonLimit;
    this.finnhubCategory = finnhubCategory;
  }

  async fetchAll(options = {}) {
    const { maxItems = 25, keywords = [] } = options;
    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.map((k) => String(k).toLowerCase()).filter(Boolean)
      : [];

    const [feedsResult, polygonResult, finnhubResult] = await Promise.all([
      this.fetchFeeds({ maxItems, keywords: normalizedKeywords }),
      this.fetchPolygonNews({ maxItems, keywords: normalizedKeywords }),
      this.fetchFinnhubNews({ maxItems, keywords: normalizedKeywords })
    ]);

    return [...feedsResult, ...polygonResult, ...finnhubResult]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxItems * (this.feeds.length + 2));
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
    const urls = Array.isArray(feed.url) ? feed.url : [feed.url];
    let lastError = null;

    for (const url of urls) {
      try {
        const fetchResponse = await axios.get(url, {
          headers: this.requestHeaders,
          timeout: 10000,
          responseType: 'text'
        });

        const parsedFeed = await this.parser.parseString(fetchResponse.data);
        const items = Array.isArray(parsedFeed.items) ? parsedFeed.items : [];
        const normalized = items
          .map((item) => buildNormalizedItem(feed, item))
          .filter((item) => this.matchesKeywords(item, options.keywords))
          .slice(0, options.maxItems);

        if (normalized.length > 0) {
          this.setCached(cacheKey, normalized);
          return normalized;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      console.error(`RSS fetch failed for ${feed.name}:`, lastError.message);
    }
    this.setCached(cacheKey, []);
    return [];
  }

  async fetchPolygonNews(options) {
    const key = this.apiKeys.polygon;
    if (!isRealKey(key)) {
      return [];
    }
    const cacheKey = `polygon:${options.maxItems}:${options.keywords.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const params = {
        apiKey: key,
        order: 'desc',
        sort: 'published_utc',
        limit: Math.min(this.polygonLimit, Math.max(options.maxItems * 2, 20))
      };
      if (options.keywords.length > 0) {
        params.q = options.keywords.join(' OR ');
      }

      const { data } = await axios.get('https://api.polygon.io/v2/reference/news', {
        params,
        timeout: 10000,
        headers: this.requestHeaders
      });

      const items = Array.isArray(data?.results) ? data.results : [];
      const normalized = items
        .map((article) => ({
          feedId: 'polygon-news',
          source: article.publisher?.name || 'Polygon',
          category: 'markets',
          headline: article.title || 'Untitled',
          summary: article.description || null,
          timestamp: parseDate(article.published_utc),
          url: article.article_url || article.url || null,
          raw: {
            id: article.id || null,
            tickers: article.tickers || [],
            author: article.author || null
          }
        }))
        .filter((item) => this.matchesKeywords(item, options.keywords))
        .slice(0, options.maxItems);

      this.setCached(cacheKey, normalized);
      return normalized;
    } catch (error) {
      console.error('Polygon news fetch failed:', error.message);
      return [];
    }
  }

  async fetchFinnhubNews(options) {
    const key = this.apiKeys.finnhub;
    if (!isRealKey(key)) {
      return [];
    }

    const cacheKey = `finnhub:${options.maxItems}:${options.keywords.join(',')}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const params = {
        category: this.finnhubCategory,
        token: key
      };

      const { data } = await axios.get('https://finnhub.io/api/v1/news', {
        params,
        timeout: 10000,
        headers: this.requestHeaders
      });

      const items = Array.isArray(data) ? data : [];
      const normalized = items
        .map((article) => {
          const rawTimestamp = article.datetime
            ? Number(article.datetime) * 1000
            : article.publishedAt || article.time || article.date;

          return {
            feedId: 'finnhub-news',
            source: article.source || 'Finnhub',
            category: this.finnhubCategory,
            headline: article.headline || article.title || 'Untitled',
            summary: article.summary || null,
            timestamp: parseDate(rawTimestamp),
            url: article.url || null,
            raw: {
              id: article.id || null,
              related: article.related || null
            }
          };
        })
        .filter((item) => this.matchesKeywords(item, options.keywords))
        .slice(0, options.maxItems);

      this.setCached(cacheKey, normalized);
      return normalized;
    } catch (error) {
      console.error('Finnhub news fetch failed:', error.message);
      return [];
    }
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
