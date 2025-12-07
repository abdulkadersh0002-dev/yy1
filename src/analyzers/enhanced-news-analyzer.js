/**
 * Enhanced News Analyzer with Multiple Trusted Sources
 * Sources: Unified RSS/API aggregator (Reuters, MarketWatch, Yahoo, Polygon, Finnhub), Economic Calendar
 */

import axios from 'axios';
import EconomicCalendarService from '../services/economic-calendar-service.js';
import SentimentFeedsService from '../services/sentiment-feeds.js';
import RssFeedAggregator from '../services/rss-feed-aggregator.js';
import LanguageProcessor from '../services/language-processor.js';
import { assertSchema } from '../utils/schema-validator.js';
import { getPairMetadata } from '../config/pair-catalog.js';

class EnhancedNewsAnalyzer {
  constructor(apiKeys = {}, options = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheDuration = options.cacheDuration || 600000; // default 10 minutes
    this.persistence = options.persistence || null;
    this.aggregator =
      options.aggregator ||
      new RssFeedAggregator({
        apiKeys,
        cacheTtlMs: options.aggregatorCacheTtlMs || 2 * 60 * 1000
      });
    this.languageProcessor =
      options.languageProcessor || new LanguageProcessor(options.languageOptions || {});
    this.impactKeywords = this.initializeImpactKeywords();
    this.calendarService = new EconomicCalendarService(apiKeys);
    this.sentimentFeeds = new SentimentFeedsService(apiKeys);
    this.ingestWindowMs = options.ingestWindowMs || 6 * 60 * 60 * 1000;
    this.maxArticlesPerSide = options.maxArticlesPerSide || 40;
  }

  /**
   * Initialize impact keywords for sentiment analysis
   */
  initializeImpactKeywords() {
    return {
      veryPositive: [
        'surge',
        'soar',
        'rally',
        'boom',
        'strong growth',
        'record high',
        'significant increase',
        'robust',
        'bullish',
        'optimistic',
        'breakthrough',
        'skyrocket',
        'accelerate',
        'strengthen',
        'outperform'
      ],
      positive: [
        'rise',
        'gain',
        'improve',
        'increase',
        'growth',
        'positive',
        'better than expected',
        'exceeds',
        'upgrade',
        'advance',
        'recovery',
        'expansion',
        'boost'
      ],
      neutral: [
        'unchanged',
        'stable',
        'steady',
        'maintain',
        'as expected',
        'in line with',
        'meets expectations',
        'hold',
        'flat'
      ],
      negative: [
        'fall',
        'decline',
        'drop',
        'decrease',
        'worsen',
        'negative',
        'below expectations',
        'miss',
        'downgrade',
        'weaken',
        'concern',
        'struggle',
        'pressure'
      ],
      veryNegative: [
        'crash',
        'plunge',
        'collapse',
        'slump',
        'crisis',
        'severe decline',
        'major loss',
        'bearish',
        'pessimistic',
        'catastrophic',
        'tumble',
        'devastate',
        'plummet'
      ]
    };
  }

  /**
   * Get comprehensive news analysis from multiple sources
   */
  async analyzeNews(pair) {
    const cacheKey = `news_${pair}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const metadata = getPairMetadata(pair);
    const [baseCurrency, quoteCurrency] = this.splitPair(pair, metadata);
    const pairTokens = this.buildPairTokens(pair, baseCurrency, quoteCurrency, metadata);
    const aggregatorKeywords = this.buildAggregatorKeywords(
      pair,
      baseCurrency,
      quoteCurrency,
      metadata
    );

    const sources = {
      aggregator: false,
      polygon: false,
      finnhub: false,
      rss: false,
      persistence: Boolean(this.persistence),
      calendar: false,
      sentimentFeeds: false,
      newsApi: false,
      investing: false,
      forexFactory: false
    };

    let liveArticles = [];

    try {
      const liveResult = await this.collectAggregatorArticles({
        pair,
        aggregatorKeywords,
        pairTokens,
        metadata
      });
      liveArticles = liveResult.articles;
      if (liveArticles.length > 0) {
        sources.aggregator = true;
        sources.polygon = liveArticles.some((article) => article.feedId === 'polygon-news');
        sources.finnhub = liveArticles.some((article) => article.feedId === 'finnhub-news');
        sources.rss = liveArticles.some(
          (article) => article.feedId && !['polygon-news', 'finnhub-news'].includes(article.feedId)
        );
      }
    } catch (error) {
      console.error(`News aggregation failed for ${pair}:`, error.message);
    }

    let storedArticles = [];
    try {
      storedArticles = await this.fetchStoredArticles({
        keywords: aggregatorKeywords,
        since: Date.now() - this.ingestWindowMs,
        limit: this.maxArticlesPerSide * 4
      });
      if (storedArticles.length > 0) {
        sources.persistence = true;
      }
    } catch (error) {
      console.error('Stored news retrieval failed:', error.message);
    }

    const allArticles = this.mergeArticles(liveArticles, storedArticles);
    const classified = this.partitionArticles(allArticles, { pairTokens });

    const baseArticles = classified.base.slice(0, this.maxArticlesPerSide);
    const quoteArticles = classified.quote.slice(0, this.maxArticlesPerSide);

    const baseNews = baseArticles.map((article) => this.projectNewsItem(article));
    const quoteNews = quoteArticles.map((article) => this.projectNewsItem(article));

    const [economicCalendar, sentimentFeeds] = await Promise.allSettled([
      this.fetchEconomicCalendar(pair),
      this.sentimentFeeds.getSentimentForPair(pair)
    ]);

    const calendar = economicCalendar.status === 'fulfilled' ? economicCalendar.value : [];
    const sentimentData = sentimentFeeds.status === 'fulfilled' ? sentimentFeeds.value : null;

    if (calendar.length > 0) {
      sources.calendar = true;
    }
    if (sentimentData) {
      sources.sentimentFeeds = true;
    }

    const analysis = {
      pair,
      timestamp: Date.now(),
      baseNews,
      quoteNews,
      calendar,
      sentiment: { base: 0, quote: 0, overall: 0 },
      impact: 0,
      direction: 'neutral',
      confidence: 0,
      sources,
      sentimentFeeds: sentimentData
    };

    analysis.sentiment.base = this.calculateSentiment(analysis.baseNews);
    analysis.sentiment.quote = this.calculateSentiment(analysis.quoteNews);
    analysis.sentiment.overall = analysis.sentiment.base - analysis.sentiment.quote;

    analysis.impact = this.calculateNewsImpact(analysis);
    analysis.direction = this.determineDirection(analysis.sentiment.overall, analysis.impact);
    analysis.confidence = this.calculateConfidence(analysis);

    if (analysis.sentimentFeeds?.compositeScore != null) {
      analysis.sentiment.overall += analysis.sentimentFeeds.compositeScore * 0.1;
      analysis.impact = Math.min(
        100,
        analysis.impact + Math.abs(analysis.sentimentFeeds.compositeScore) * 0.2
      );
    }

    try {
      assertSchema('newsAnalysis', analysis, `news:${pair}`);
    } catch (validationError) {
      console.warn(`⚠️ News analysis validation failed for ${pair}: ${validationError.message}`);
    }

    this.setCached(cacheKey, analysis);
    return analysis;
  }

  buildAggregatorKeywords(pair, baseCurrency, quoteCurrency, metadata) {
    const tokens = new Set([
      baseCurrency,
      quoteCurrency,
      baseCurrency.toLowerCase(),
      quoteCurrency.toLowerCase(),
      ...this.getCurrencyKeywords(baseCurrency).map((token) => token.toLowerCase()),
      ...this.getCurrencyKeywords(quoteCurrency).map((token) => token.toLowerCase()),
      pair,
      pair.toLowerCase(),
      `${baseCurrency}/${quoteCurrency}`.toLowerCase(),
      `${baseCurrency}-${quoteCurrency}`.toLowerCase(),
      `${baseCurrency} ${quoteCurrency}`.toLowerCase()
    ]);

    if (metadata?.aliases) {
      metadata.aliases.forEach((alias) => {
        if (typeof alias === 'string') {
          tokens.add(alias);
          tokens.add(alias.toLowerCase());
        }
      });
    }

    if (metadata?.displayName) {
      tokens.add(metadata.displayName);
      tokens.add(metadata.displayName.toLowerCase());
    }

    if (metadata?.assetClass && metadata.assetClass !== 'forex') {
      tokens.add(metadata.assetClass);
      tokens.add(`${metadata.assetClass} market`);
    }

    return Array.from(tokens)
      .map((token) => (typeof token === 'string' ? token.toLowerCase() : null))
      .filter((token) => token && token.length >= 3);
  }

  buildCurrencyTokens(currency, aliases = []) {
    const lowercase = currency.toLowerCase();
    const variants = this.getCurrencyKeywords(currency)
      .concat(aliases || [])
      .map((token) => (typeof token === 'string' ? token.toLowerCase() : null))
      .filter(Boolean);
    return Array.from(new Set([lowercase, ...variants])).filter(
      (token) => token && token.length >= 3
    );
  }

  buildPairTokens(pair, baseCurrency, quoteCurrency, metadata) {
    const baseAliases = metadata?.assetClass === 'forex' ? [] : metadata?.aliases || [];
    return {
      base: this.buildCurrencyTokens(baseCurrency, baseAliases),
      quote: this.buildCurrencyTokens(quoteCurrency),
      combined: Array.from(
        new Set([
          pair.toLowerCase(),
          `${baseCurrency}/${quoteCurrency}`.toLowerCase(),
          `${baseCurrency}-${quoteCurrency}`.toLowerCase(),
          `${baseCurrency} ${quoteCurrency}`.toLowerCase(),
          `${quoteCurrency}/${baseCurrency}`.toLowerCase()
        ])
      )
    };
  }

  async collectAggregatorArticles({ pair, aggregatorKeywords, pairTokens, metadata }) {
    if (!this.aggregator || typeof this.aggregator.fetchAll !== 'function') {
      return { articles: [], persisted: 0 };
    }

    try {
      const fetchMaxItems = Math.max(60, this.maxArticlesPerSide * 2);
      const rawItems = await this.aggregator.fetchAll({
        maxItems: fetchMaxItems,
        keywords: aggregatorKeywords
      });

      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { articles: [], persisted: 0 };
      }

      const keywordSet = new Set(aggregatorKeywords);
      const now = Date.now();
      const [baseCurrency, quoteCurrency] = this.splitPair(pair, metadata);

      const articles = await Promise.all(
        rawItems.map(async (item) => {
          const normalized = this.normalizeAggregatorItem(item, now);
          const languageInfo = await this.processArticleLanguage(normalized);
          const analysisInput = {
            ...normalized,
            headline: languageInfo.headlineForAnalysis || normalized.headline,
            summary: languageInfo.summaryForAnalysis ?? normalized.summary
          };

          const analyzed = this.analyzeArticle(analysisInput);
          const isRssSource =
            normalized.feedId && !['polygon-news', 'finnhub-news'].includes(normalized.feedId);
          const boostedImpact = isRssSource ? Math.max(analyzed.impact || 1, 3) : analyzed.impact;
          const boostedScore = isRssSource
            ? Number(((analyzed.sentiment || 0) * boostedImpact).toFixed(2))
            : analyzed.score;
          const enrichedArticle = {
            ...analyzed,
            impact: boostedImpact,
            score: boostedScore
          };
          const topics = this.deriveTopics(analysisInput);
          const sentimentLabel = this.deriveSentimentLabel(enrichedArticle.sentiment);
          const baseTags = this.buildKeywordTags({
            article: enrichedArticle,
            additional: [normalized.category, normalized.source],
            keywordSet,
            pairTokens
          });

          const tagSet = this.applyStructuredTags(new Set(baseTags), {
            baseCurrency,
            quoteCurrency,
            languageCode: languageInfo.language?.code,
            sentimentLabel,
            assetClass: metadata?.assetClass,
            topics
          });

          const tags = Array.from(tagSet);

          return {
            ...enrichedArticle,
            feedId: normalized.feedId,
            category: normalized.category,
            raw: normalized.raw,
            tags,
            language: languageInfo.language,
            translation: languageInfo.translation,
            originalHeadline: normalized.headline,
            originalSummary: normalized.summary,
            topics,
            sentimentLabel
          };
        })
      );

      let persisted = 0;
      if (this.persistence && typeof this.persistence.recordNewsItems === 'function') {
        const payload = articles.map((article) => ({
          feedId: article.feedId || 'aggregator',
          source: article.source || 'Unknown',
          category: article.category || null,
          headline: article.headline,
          summary: article.summary || null,
          url: article.url || null,
          publishedAt: new Date(article.timestamp),
          collectedAt: new Date(now),
          keywords: article.tags,
          sentiment: article.sentiment,
          impact: article.impact,
          metadata: {
            score: article.score,
            raw: article.raw || null,
            pair,
            assetClass: metadata?.assetClass || null,
            tags: article.tags,
            language: article.language,
            translation: article.translation,
            topics: article.topics,
            sentimentLabel: article.sentimentLabel,
            originals: {
              headline: article.originalHeadline,
              summary: article.originalSummary
            }
          }
        }));

        persisted = await this.persistence.recordNewsItems(payload);
      }

      return { articles, persisted };
    } catch (error) {
      console.error('Aggregator fetch failed:', error.message);
      return { articles: [], persisted: 0 };
    }
  }

  normalizeAggregatorItem(item, fallbackTimestamp) {
    const timestamp = Number.isFinite(item?.timestamp)
      ? Number(item.timestamp)
      : Number.isFinite(item?.published)
        ? Number(item.published)
        : fallbackTimestamp;

    return {
      headline: item?.headline || item?.title || 'Untitled',
      summary: item?.summary || item?.contentSnippet || item?.content || null,
      source: item?.source || item?.feedId || 'Unknown',
      url: item?.url || item?.link || null,
      timestamp: Number.isFinite(timestamp) ? timestamp : fallbackTimestamp,
      feedId: item?.feedId || 'aggregator',
      category: item?.category || null,
      raw: item?.raw || null
    };
  }

  buildKeywordTags({ article, additional = [], keywordSet, pairTokens }) {
    const tags = new Set();

    if (keywordSet && keywordSet.size > 0) {
      for (const token of keywordSet) {
        if (token && token.length >= 3) {
          tags.add(token);
        }
      }
    }

    if (Array.isArray(article.keywords)) {
      article.keywords.forEach((keyword) => {
        const normalized = typeof keyword === 'string' ? keyword.toLowerCase() : null;
        if (normalized && normalized.length >= 3) {
          tags.add(normalized);
        }
      });
    }

    const text = `${article.headline} ${article.summary || ''}`.toLowerCase();

    const tokenGroups = [
      ...(pairTokens ? [pairTokens.base, pairTokens.quote, pairTokens.combined] : [])
    ].filter(Boolean);

    for (const group of tokenGroups) {
      group.forEach((token) => {
        if (token && text.includes(token)) {
          tags.add(token);
        }
      });
    }

    additional.filter(Boolean).forEach((token) => {
      const normalized = String(token).toLowerCase();
      if (normalized.length >= 3) {
        tags.add(normalized);
      }
    });

    return Array.from(tags);
  }

  applyStructuredTags(
    tagSet = new Set(),
    { baseCurrency, quoteCurrency, languageCode, sentimentLabel, assetClass, topics = [] } = {}
  ) {
    const tags = tagSet instanceof Set ? new Set(tagSet) : new Set();

    const addTag = (value) => {
      if (!value) {
        return;
      }
      const normalized = String(value).toLowerCase();
      if (normalized.length >= 2) {
        tags.add(normalized);
      }
    };

    addTag(languageCode ? `language:${languageCode}` : null);
    addTag(baseCurrency ? `currency:${baseCurrency.toLowerCase()}` : null);
    addTag(quoteCurrency ? `currency:${quoteCurrency.toLowerCase()}` : null);
    addTag(sentimentLabel ? `sentiment:${sentimentLabel}` : null);
    addTag(assetClass ? `asset:${assetClass}` : null);

    topics.forEach((topic) => addTag(`topic:${topic}`));

    return tags;
  }

  async processArticleLanguage(article) {
    if (!this.languageProcessor || typeof this.languageProcessor.processArticle !== 'function') {
      return {
        language: {
          code: 'en',
          raw: 'eng',
          confidence: 1,
          reliability: 'assumed'
        },
        translation: {
          headline: {
            original: article?.headline || null,
            translated: article?.headline || null,
            changed: false
          },
          summary: {
            original: article?.summary || null,
            translated: article?.summary || null,
            changed: false
          },
          provider: null
        },
        headlineForAnalysis: article?.headline || null,
        summaryForAnalysis: article?.summary || null
      };
    }

    try {
      return await this.languageProcessor.processArticle({
        headline: article?.headline || null,
        summary: article?.summary || null
      });
    } catch (error) {
      console.warn('Language processing failed:', error.message);
      return {
        language: {
          code: 'en',
          raw: 'eng',
          confidence: 0,
          reliability: 'fallback'
        },
        translation: {
          headline: {
            original: article?.headline || null,
            translated: article?.headline || null,
            changed: false
          },
          summary: {
            original: article?.summary || null,
            translated: article?.summary || null,
            changed: false
          },
          provider: null
        },
        headlineForAnalysis: article?.headline || null,
        summaryForAnalysis: article?.summary || null
      };
    }
  }

  deriveTopics(article) {
    const topics = new Set();
    const text = `${article?.headline || ''} ${article?.summary || ''}`.toLowerCase();

    if (!text.trim()) {
      return Array.from(topics);
    }

    const topicDefinitions = [
      {
        key: 'monetary_policy',
        patterns: [
          'central bank',
          'rate hike',
          'rate cut',
          'interest rate',
          'tightening',
          'easing',
          'qe',
          'policy meeting'
        ]
      },
      {
        key: 'inflation',
        patterns: [
          'inflation',
          'cpi',
          'ppi',
          'consumer price',
          'producer price',
          'price pressure',
          'cost of living'
        ]
      },
      {
        key: 'employment',
        patterns: [
          'jobs report',
          'unemployment',
          'payroll',
          'employment',
          'labor market',
          'jobless'
        ]
      },
      {
        key: 'growth',
        patterns: ['gdp', 'growth', 'recession', 'expansion', 'economic output', 'slowdown']
      },
      {
        key: 'geopolitics',
        patterns: ['geopolit', 'sanction', 'conflict', 'tension', 'war', 'military']
      },
      {
        key: 'risk',
        patterns: [
          'risk-off',
          'risk-on',
          'volatility',
          'selloff',
          'market rout',
          'flight to safety'
        ]
      },
      {
        key: 'commodities',
        patterns: ['oil', 'crude', 'energy', 'commodity', 'gold', 'metals', 'gas']
      },
      {
        key: 'fiscal_policy',
        patterns: ['budget', 'deficit', 'spending', 'tax', 'stimulus', 'fiscal']
      },
      {
        key: 'banking',
        patterns: ['bank', 'liquidity', 'credit', 'loan', 'deposit', 'capital buffer']
      }
    ];

    for (const { key, patterns } of topicDefinitions) {
      if (patterns.some((pattern) => text.includes(pattern))) {
        topics.add(key);
      }
    }

    return Array.from(topics);
  }

  deriveSentimentLabel(sentiment) {
    if (!Number.isFinite(sentiment)) {
      return 'neutral';
    }
    if (sentiment >= 1.5) {
      return 'positive';
    }
    if (sentiment <= -1.5) {
      return 'negative';
    }
    return 'neutral';
  }

  async fetchStoredArticles({ keywords, since, limit }) {
    if (!this.persistence || typeof this.persistence.getRecentNews !== 'function') {
      return [];
    }

    const rows = await this.persistence.getRecentNews({
      keywords,
      since,
      limit
    });

    return rows.map((row) => this.normalizeStoredArticle(row));
  }

  normalizeStoredArticle(row) {
    const timestamp =
      row?.published_at instanceof Date
        ? row.published_at.getTime()
        : Number.isFinite(Date.parse(row?.published_at))
          ? Date.parse(row.published_at)
          : Date.now();

    const baseArticle = {
      headline: row?.headline || 'Untitled',
      summary: row?.summary || null,
      source: row?.source || 'Unknown',
      url: row?.url || null,
      timestamp,
      feedId: row?.feed_id || 'aggregator',
      category: row?.category || null,
      raw: row?.metadata || null
    };

    const analyzed = this.analyzeArticle(baseArticle);

    analyzed.feedId = baseArticle.feedId;
    analyzed.category = baseArticle.category;
    analyzed.raw = baseArticle.raw;

    if (row?.sentiment != null) {
      analyzed.sentiment = Number(row.sentiment);
    }
    if (row?.impact != null) {
      analyzed.impact = Number(row.impact);
    }

    const storedKeywords = Array.isArray(row?.keywords)
      ? row.keywords
          .map((keyword) => (typeof keyword === 'string' ? keyword.toLowerCase() : null))
          .filter(Boolean)
      : [];

    analyzed.tags = Array.from(
      new Set([
        ...storedKeywords,
        ...(Array.isArray(analyzed.keywords)
          ? analyzed.keywords.map((keyword) => keyword.toLowerCase())
          : [])
      ])
    );

    return analyzed;
  }

  mergeArticles(primary = [], secondary = []) {
    const combined = [...primary, ...secondary];
    const seen = new Set();
    const result = [];

    combined.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const article of combined) {
      const key = `${article.source || 'unknown'}|${article.headline}|${Math.trunc(article.timestamp || 0)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(article);
    }

    return result;
  }

  partitionArticles(articles = [], { pairTokens }) {
    const base = [];
    const quote = [];
    const shared = [];

    for (const article of articles) {
      const enriched = this.enrichArticleForPair(article, pairTokens);
      const bucket = this.classifyArticle(enriched, pairTokens);

      if (bucket === 'both') {
        shared.push(enriched);
        base.push(enriched);
        quote.push(enriched);
      } else if (bucket === 'base') {
        base.push(enriched);
      } else if (bucket === 'quote') {
        quote.push(enriched);
      }
    }

    return { base, quote, shared };
  }

  enrichArticleForPair(article, pairTokens) {
    const cloned = { ...article };
    const tags = new Set(
      Array.isArray(cloned.tags) ? cloned.tags.map((tag) => String(tag).toLowerCase()) : []
    );
    const text = `${cloned.headline} ${cloned.summary || ''}`.toLowerCase();

    [pairTokens.base, pairTokens.quote, pairTokens.combined].forEach((group) => {
      if (!group) {
        return;
      }
      group.forEach((token) => {
        if (token && token.length >= 3 && text.includes(token)) {
          tags.add(token);
        }
      });
    });

    cloned.tags = Array.from(tags);
    return cloned;
  }

  classifyArticle(article, pairTokens) {
    const tags = new Set((article.tags || []).map((tag) => String(tag).toLowerCase()));
    const text = `${article.headline} ${article.summary || ''}`.toLowerCase();

    const matchesBase = this.matchesTokens(tags, text, pairTokens.base);
    const matchesQuote = this.matchesTokens(tags, text, pairTokens.quote);
    const matchesPair = this.matchesTokens(tags, text, pairTokens.combined);

    if ((matchesBase && matchesQuote) || matchesPair) {
      return 'both';
    }
    if (matchesBase) {
      return 'base';
    }
    if (matchesQuote) {
      return 'quote';
    }
    return 'neutral';
  }

  matchesTokens(tags, text, tokens = []) {
    if (!tokens || tokens.length === 0) {
      return false;
    }
    return tokens.some((token) => {
      if (!token || token.length < 3) {
        return false;
      }
      const normalized = token.toLowerCase();
      return tags.has(normalized) || text.includes(normalized);
    });
  }

  projectNewsItem(article) {
    const timestamp = Number.isFinite(article?.timestamp)
      ? Math.trunc(article.timestamp)
      : Date.now();

    const keywords = new Set();
    if (Array.isArray(article?.keywords)) {
      article.keywords.forEach((keyword) => {
        const normalized = typeof keyword === 'string' ? keyword.toLowerCase() : null;
        if (normalized && normalized.length >= 3) {
          keywords.add(normalized);
        }
      });
    }
    if (Array.isArray(article?.tags)) {
      article.tags.forEach((keyword) => {
        const normalized = typeof keyword === 'string' ? keyword.toLowerCase() : null;
        if (normalized && normalized.length >= 3) {
          keywords.add(normalized);
        }
      });
    }

    const keywordList = Array.from(keywords);

    return {
      headline: article?.headline || 'Untitled',
      summary: article?.summary || null,
      source: article?.source || 'Unknown',
      timestamp,
      url: article?.url || null,
      sentiment: Number.isFinite(article?.sentiment) ? Number(article.sentiment) : null,
      impact: Number.isFinite(article?.impact) ? Number(article.impact) : null,
      score: Number.isFinite(article?.score) ? Number(article.score) : null,
      keywords: keywordList,
      tags: Array.isArray(article?.tags) ? article.tags : keywordList,
      language: article?.language || null,
      originalHeadline: article?.originalHeadline || null,
      originalSummary: article?.originalSummary || null,
      topics: Array.isArray(article?.topics) ? article.topics : [],
      sentimentLabel: article?.sentimentLabel || this.deriveSentimentLabel(article?.sentiment),
      translation: article?.translation || null
    };
  }

  /**
   * Fetch from NewsAPI.org
   */
  async fetchFromNewsAPI(baseCurrency, quoteCurrency) {
    if (!this.apiKeys.newsApi || this.apiKeys.newsApi === 'demo') {
      return { base: [], quote: [] };
    }

    try {
      const baseNews = await this.fetchNewsAPIForCurrency(baseCurrency);
      const quoteNews = await this.fetchNewsAPIForCurrency(quoteCurrency);

      return {
        base: baseNews.map((article) => this.analyzeArticle(article)),
        quote: quoteNews.map((article) => this.analyzeArticle(article))
      };
    } catch (error) {
      console.error('NewsAPI fetch error:', error.message);
      return { base: [], quote: [] };
    }
  }

  /**
   * Fetch news for specific currency from NewsAPI
   */
  async fetchNewsAPIForCurrency(currency) {
    const keywords = this.getCurrencyKeywords(currency);
    const searchQuery = keywords.join(' OR ');

    try {
      const url = 'https://newsapi.org/v2/everything';
      const params = {
        q: searchQuery,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 10,
        apiKey: this.apiKeys.newsApi
      };

      const response = await axios.get(url, { params, timeout: 10000 });

      if (response.data && response.data.articles) {
        return response.data.articles.map((article) => ({
          title: article.title,
          description: article.description || '',
          publishedAt: article.publishedAt,
          source: article.source.name,
          url: article.url
        }));
      }

      return [];
    } catch (error) {
      console.error(`NewsAPI currency fetch error for ${currency}:`, error.message);
      return [];
    }
  }

  /**
   * Fetch from Investing.com RSS feeds
   */
  async fetchFromInvestingRSS(baseCurrency, quoteCurrency) {
    try {
      // Investing.com provides RSS feeds for forex news
      const baseNews = await this.fetchInvestingRSSForCurrency(baseCurrency);
      const quoteNews = await this.fetchInvestingRSSForCurrency(quoteCurrency);

      return {
        base: baseNews.map((article) => this.analyzeArticle(article)),
        quote: quoteNews.map((article) => this.analyzeArticle(article))
      };
    } catch (error) {
      console.error('Investing.com fetch error:', error.message);
      return { base: [], quote: [] };
    }
  }

  /**
   * Fetch Investing.com RSS for currency
   */
  async fetchInvestingRSSForCurrency(currency) {
    // Simulate Investing.com RSS data
    // In production, you would parse actual RSS feeds
    const mockNews = [
      {
        title: `${currency} Analysis: Market Sentiment Shifts`,
        description: `Latest analysis of ${currency} movements in forex markets`,
        publishedAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        source: 'Investing.com',
        url: 'https://www.investing.com'
      },
      {
        title: `${currency} Forex Outlook: Key Levels to Watch`,
        description: `Technical and fundamental outlook for ${currency}`,
        publishedAt: new Date(Date.now() - Math.random() * 7200000).toISOString(),
        source: 'Investing.com',
        url: 'https://www.investing.com'
      }
    ];

    return mockNews;
  }

  /**
   * Fetch from Forex Factory (simulated)
   */
  async fetchForexFactoryNews(pair) {
    try {
      // Forex Factory provides free news and calendar
      // This would parse their website or use an unofficial API
      const mockNews = [
        {
          title: `${pair} Trading Ideas and Analysis`,
          description: 'Latest trading ideas from the community',
          publishedAt: new Date(Date.now() - Math.random() * 1800000).toISOString(),
          source: 'Forex Factory',
          url: 'https://www.forexfactory.com'
        }
      ];

      return mockNews.map((article) => this.analyzeArticle(article));
    } catch (error) {
      console.error('Forex Factory fetch error:', error.message);
      return [];
    }
  }

  /**
   * Fetch economic calendar events
   */
  async fetchEconomicCalendar(pair) {
    try {
      return await this.calendarService.getEventsForPair(pair, { daysAhead: 3 });
    } catch (error) {
      console.error('Economic calendar fetch error:', error.message);
      return [];
    }
  }

  /**
   * Analyze individual article for sentiment
   */
  analyzeArticle(article) {
    const normalized = this.normalizeArticle(article);
    const text = `${normalized.headline} ${normalized.summary || ''}`.toLowerCase();

    let sentiment = 0;
    let impact = 1;
    const matchedKeywords = [];

    // Check for impact keywords
    for (const [category, keywords] of Object.entries(this.impactKeywords)) {
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword);

          switch (category) {
            case 'veryPositive':
              sentiment += 2;
              impact = Math.max(impact, 3);
              break;
            case 'positive':
              sentiment += 1;
              impact = Math.max(impact, 2);
              break;
            case 'negative':
              sentiment -= 1;
              impact = Math.max(impact, 2);
              break;
            case 'veryNegative':
              sentiment -= 2;
              impact = Math.max(impact, 3);
              break;
          }
        }
      }
    }

    const uniqueKeywords = [...new Set(matchedKeywords)];

    return {
      ...normalized,
      sentiment,
      impact,
      score: Number((sentiment * impact).toFixed(2)),
      keywords: uniqueKeywords
    };
  }

  normalizeArticle(article) {
    const headline = article?.headline || article?.title || article?.name || 'Untitled';
    const summary = article?.summary ?? article?.description ?? article?.body ?? null;
    const source =
      typeof article?.source === 'string'
        ? article.source
        : article?.source?.name || article?.publisher || 'Unknown';
    const url = article?.url || article?.link || null;
    const timestamp = this.normalizeTimestamp(
      article?.timestamp ?? article?.publishedAt ?? article?.pubDate ?? article?.date
    );

    return {
      headline,
      summary,
      source,
      timestamp,
      url
    };
  }

  normalizeTimestamp(value) {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Date.now();
  }

  /**
   * Calculate overall sentiment from news array
   */
  calculateSentiment(newsArray) {
    if (!newsArray || newsArray.length === 0) {
      return 0;
    }

    const totalScore = newsArray.reduce((sum, news) => sum + (news.score || 0), 0);
    const totalImpact = newsArray.reduce((sum, news) => sum + (news.impact || 1), 0);

    return totalImpact > 0 ? (totalScore / totalImpact) * 10 : 0;
  }

  /**
   * Calculate overall news impact
   */
  calculateNewsImpact(analysis) {
    const baseCount = analysis.baseNews.length;
    const quoteCount = analysis.quoteNews.length;
    const calendarImpact = analysis.calendar.reduce((sum, event) => sum + event.impact, 0) / 2;

    const newsImpact =
      Math.abs(analysis.sentiment.overall) * Math.min((baseCount + quoteCount) / 10, 1);

    return Math.min(newsImpact * 10 + calendarImpact, 100);
  }

  /**
   * Determine trading direction from sentiment
   */
  determineDirection(sentiment, impact) {
    if (impact < 20) {
      return 'neutral';
    }
    if (sentiment > 15) {
      return 'strong_buy';
    }
    if (sentiment > 5) {
      return 'buy';
    }
    if (sentiment < -15) {
      return 'strong_sell';
    }
    if (sentiment < -5) {
      return 'sell';
    }
    return 'neutral';
  }

  /**
   * Calculate confidence level
   */
  calculateConfidence(analysis) {
    const newsCount = analysis.baseNews.length + analysis.quoteNews.length;
    const calendarCount = analysis.calendar.length;
    const sourcesActive = Object.values(analysis.sources).filter(Boolean).length;

    let confidence = 0;

    // More news = higher confidence
    confidence += Math.min(newsCount * 4, 35);

    // Economic events add confidence
    confidence += Math.min(calendarCount * 8, 25);

    // Multiple sources add confidence
    confidence += sourcesActive * 10;

    // Strong sentiment adds confidence
    confidence += Math.min(Math.abs(analysis.sentiment.overall) * 2, 20);

    return Math.min(confidence, 100);
  }

  /**
   * Check if event is upcoming (within 72 hours)
   */
  isUpcomingEvent(event) {
    const eventTime = new Date(event.time).getTime();
    const now = Date.now();
    const hoursDiff = (eventTime - now) / 3600000;
    return hoursDiff > 0 && hoursDiff < 72;
  }

  /**
   * Get currency-specific keywords
   */
  getCurrencyKeywords(currency) {
    const keywords = {
      USD: ['dollar', 'fed', 'federal reserve', 'us economy', 'powell', 'treasury'],
      EUR: ['euro', 'ecb', 'european central bank', 'eurozone', 'lagarde'],
      GBP: ['pound', 'sterling', 'boe', 'bank of england', 'bailey'],
      JPY: ['yen', 'boj', 'bank of japan', 'ueda'],
      AUD: ['aussie', 'rba', 'reserve bank australia', 'lowe'],
      CAD: ['loonie', 'boc', 'bank of canada', 'macklem'],
      CHF: ['franc', 'snb', 'swiss national bank', 'jordan'],
      NZD: ['kiwi', 'rbnz', 'reserve bank new zealand', 'orr'],
      SPX500: ['spx', 's&p 500', 'us500', 'sp500', 'wall street', 'us equities'],
      NAS100: ['nasdaq', 'nasdaq 100', 'us100', 'ndx', 'tech stocks'],
      GER40: ['dax', 'dax40', 'german equities', 'de40', 'frankfurt market'],
      XAU: ['gold', 'bullion', 'precious metal', 'xau'],
      XAG: ['silver', 'precious metals', 'xag'],
      USOIL: ['wti', 'crude oil', 'oil', 'petroleum'],
      BTC: ['bitcoin', 'crypto', 'btc', 'digital asset'],
      ETH: ['ethereum', 'crypto', 'eth', 'ether']
    };
    return keywords[currency] || [currency.toLowerCase()];
  }

  /**
   * Split currency pair
   */
  splitPair(pair, metadata = null) {
    const resolved = metadata || getPairMetadata(pair);
    if (resolved?.base && resolved?.quote) {
      return [resolved.base, resolved.quote];
    }

    const normalized = String(pair || '').toUpperCase();
    if (normalized.includes('/')) {
      const parts = normalized.split(/[:/-]/).filter(Boolean);
      if (parts.length >= 2) {
        return [parts[0], parts[1]];
      }
    }

    if (normalized.length >= 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }

    return [normalized, 'USD'];
  }

  /**
   * Get default analysis
   */
  getDefaultAnalysis(pair) {
    return {
      pair,
      timestamp: Date.now(),
      baseNews: [],
      quoteNews: [],
      calendar: [],
      sentiment: { base: 0, quote: 0, overall: 0 },
      impact: 0,
      direction: 'neutral',
      confidence: 0,
      sources: {
        aggregator: false,
        polygon: false,
        finnhub: false,
        rss: false,
        persistence: false,
        calendar: false,
        sentimentFeeds: false,
        newsApi: false,
        investing: false,
        forexFactory: false
      },
      sentimentFeeds: null
    };
  }

  /**
   * Cache management
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}

export default EnhancedNewsAnalyzer;
