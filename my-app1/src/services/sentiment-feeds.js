import axios from 'axios';
import { assertRealTimeDataAvailability } from '../config/runtime-flags.js';
import { getPairMetadata, getProviderSymbol } from '../config/pair-catalog.js';

class SentimentFeedsService {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheDurationMs = 10 * 60 * 1000; // 10 minutes
    this.sentimentKeywords = this.buildSentimentKeywords();
    this.backoffUntil = new Map();
  }

  buildSentimentKeywords() {
    return {
      positive: [
        'surge',
        'rally',
        'bullish',
        'strengthen',
        'improve',
        'optimistic',
        'beat expectations',
        'accumulate'
      ],
      negative: [
        'drop',
        'selloff',
        'bearish',
        'weaken',
        'decline',
        'pessimistic',
        'miss expectations',
        'distribution'
      ]
    };
  }

  async getSentimentForPair(pair, options = {}) {
    const cacheKey = `${pair}_${options.window || 'default'}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const metadata = getPairMetadata(pair);
    const assetClass = metadata?.assetClass || 'forex';

    const [social, cot, optionsFlow] = await Promise.all([
      this.fetchSocialSentiment(pair, metadata, options),
      this.fetchCOTSentiment(pair, metadata, options),
      this.fetchOptionsFlow(pair, metadata, options)
    ]);

    const composite = this.calculateCompositeScore({ social, cot, optionsFlow });

    const payload = {
      pair,
      timestamp: Date.now(),
      social,
      commitmentOfTraders: cot,
      optionsFlow,
      compositeScore: composite.score,
      confidence: composite.confidence,
      assetClass,
      sources: {
        social: !this.isSyntheticSource(social.source),
        cot: !this.isSyntheticSource(cot.source),
        options: !this.isSyntheticSource(optionsFlow.source)
      }
    };

    this.setCached(cacheKey, payload);
    return payload;
  }

  async fetchSocialSentiment(pair, metadata) {
    const assetClass = metadata?.assetClass || 'forex';
    if (assetClass !== 'forex') {
      return this.syntheticSocialSentiment(pair, assetClass);
    }

    const key = this.apiKeys.finnhub;
    if (!this.isRealKey(key)) {
      assertRealTimeDataAvailability('SentimentFeeds.social', 'Finnhub API key missing or invalid');
      return this.syntheticSocialSentiment(pair);
    }
    if (this.isInBackoff('finnhub-sentiment')) {
      assertRealTimeDataAvailability(
        'SentimentFeeds.social',
        'Finnhub sentiment provider in backoff state'
      );
      return this.syntheticSocialSentiment(pair);
    }

    try {
      const url = 'https://finnhub.io/api/v1/news';
      const params = { category: 'forex', token: key };
      const { data } = await axios.get(url, { params, timeout: 10000 });
      const [base, quote] = this.splitPair(pair, metadata);
      const relevant = (data || []).filter((item) => this.matchesPair(item, base, quote, metadata));
      const analysis = this.scoreArticles(relevant);
      return {
        score: analysis.score,
        confidence: analysis.confidence,
        mentions: relevant.length,
        sampleSize: data?.length || 0,
        source: 'Finnhub',
        windowHours: 24
      };
    } catch (error) {
      this.handleFinnhubError(error, `Social sentiment fetch failed for ${pair}`);
      this.applyBackoff('finnhub-sentiment', error);
      assertRealTimeDataAvailability(
        'SentimentFeeds.social',
        error?.message || 'Finnhub sentiment request failed'
      );
      return this.syntheticSocialSentiment(pair);
    }
  }

  async fetchCOTSentiment(pair, metadata) {
    const key = this.apiKeys.finnhub;
    if (!this.isRealKey(key)) {
      assertRealTimeDataAvailability('SentimentFeeds.cot', 'Finnhub API key missing or invalid');
      return this.syntheticCOT(pair);
    }
    if (this.isInBackoff('finnhub-sentiment')) {
      assertRealTimeDataAvailability(
        'SentimentFeeds.cot',
        'Finnhub sentiment provider in backoff state'
      );
      return this.syntheticCOT(pair);
    }

    try {
      const assetClass = metadata?.assetClass || 'forex';
      const [base] = this.splitPair(pair, metadata);
      const symbol =
        assetClass === 'forex'
          ? this.cotSymbolForCurrency(base)
          : this.cotSymbolForInstrument(metadata);
      if (!symbol) {
        assertRealTimeDataAvailability('SentimentFeeds.cot', `No COT symbol mapping for ${base}`);
        return this.syntheticCOT(pair);
      }
      const url = 'https://finnhub.io/api/v1/cot';
      const params = { symbol, token: key };
      const { data } = await axios.get(url, { params, timeout: 10000 });
      const records = Array.isArray(data?.data) ? data.data : [];
      if (records.length === 0) {
        assertRealTimeDataAvailability(
          'SentimentFeeds.cot',
          `Finnhub returned no COT records for ${pair}`
        );
        return this.syntheticCOT(pair);
      }

      const latest = records[0];
      const netLong = Number(latest?.net_position ?? latest?.netLong ?? 0);
      const netShort = Number(latest?.net_short ?? latest?.netShort ?? 0);
      const openInterest = Number(latest?.open_interest ?? latest?.openInterest ?? 0);
      const score = this.calculateCotScore(netLong, netShort, openInterest);

      return {
        score,
        confidence: openInterest > 0 ? Math.min(Math.abs(score) / 1.5, 100) : 20,
        netLong,
        netShort,
        openInterest,
        reportDate: latest.date || latest.report_date || null,
        source: 'Finnhub'
      };
    } catch (error) {
      this.handleFinnhubError(error, `COT sentiment fetch failed for ${pair}`);
      this.applyBackoff('finnhub-sentiment', error);
      assertRealTimeDataAvailability(
        'SentimentFeeds.cot',
        error?.message || 'Finnhub COT request failed'
      );
      return this.syntheticCOT(pair);
    }
  }

  async fetchOptionsFlow(pair, metadata) {
    const key = this.apiKeys.polygon;
    if (!this.isRealKey(key)) {
      assertRealTimeDataAvailability(
        'SentimentFeeds.options',
        'Polygon API key missing or invalid'
      );
      return this.syntheticOptions(pair, 'synthetic-backoff');
    }
    if (this.isInBackoff('polygon-options')) {
      assertRealTimeDataAvailability(
        'SentimentFeeds.options',
        'Polygon options provider in backoff state'
      );
      return this.syntheticOptions(pair, 'synthetic-backoff');
    }

    try {
      const providerSymbol = (() => {
        if (metadata?.providers?.polygon) {
          if (typeof metadata.providers.polygon === 'string') {
            return metadata.providers.polygon;
          }
          return metadata.providers.polygon.symbol || null;
        }
        return getProviderSymbol(pair, 'polygon');
      })();
      const symbol = providerSymbol || metadata?.polygonSymbol || this.polygonFxTicker(pair);
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 3600000);
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/5/minute/${from.toISOString().split('T')[0]}/${to.toISOString().split('T')[0]}`;
      const params = { adjusted: true, sort: 'desc', limit: 1200, apiKey: key };
      const { data } = await axios.get(url, { params, timeout: 10000 });
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) {
        assertRealTimeDataAvailability(
          'SentimentFeeds.options',
          `Polygon returned no options flow results for ${pair}`
        );
        return this.syntheticOptions(pair);
      }

      const volume = results.reduce((sum, row) => sum + (row.v || 0), 0);
      const priceChange = this.computePriceChange(results);
      const score = this.calculateOptionsScore(volume, priceChange);

      return {
        score,
        confidence: Math.min((volume / 1e6) * 100, 90),
        totalVolume: volume,
        priceChange,
        source: 'Polygon',
        windowHours: 24
      };
    } catch (error) {
      this.handlePolygonError(error, `Options flow fetch failed for ${pair}`);
      this.applyBackoff('polygon-options', error);
      const status = error?.response?.status;
      const reason =
        status === 429
          ? 'synthetic-rate-limit'
          : status === 403
            ? 'synthetic-unauthorized'
            : 'synthetic';
      assertRealTimeDataAvailability(
        'SentimentFeeds.options',
        error?.message || 'Polygon options flow request failed'
      );
      return this.syntheticOptions(pair, reason);
    }
  }

  calculateCompositeScore(components) {
    const weights = {
      social: 0.3,
      cot: 0.4,
      optionsFlow: 0.3
    };

    let score = 0;
    let confidence = 0;

    Object.entries(components).forEach(([key, value]) => {
      const componentScore = Number(value?.score) || 0;
      const componentConfidence = Number(value?.confidence) || 0;
      score += componentScore * (weights[key] || 0);
      confidence += componentConfidence * (weights[key] || 0.5);
    });

    return {
      score: Number(score.toFixed(2)),
      confidence: Math.min(100, Number(confidence.toFixed(1)))
    };
  }

  scoreArticles(articles = []) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return { score: 0, confidence: 10 };
    }
    let totalScore = 0;
    let totalWeight = 0;

    articles.forEach((article) => {
      const text =
        `${article.headline || ''} ${article.summary || article.body || ''}`.toLowerCase();
      let weight = 1;
      let articleScore = 0;

      this.sentimentKeywords.positive.forEach((keyword) => {
        if (text.includes(keyword)) {
          articleScore += 1;
          weight += 0.5;
        }
      });

      this.sentimentKeywords.negative.forEach((keyword) => {
        if (text.includes(keyword)) {
          articleScore -= 1;
          weight += 0.5;
        }
      });

      totalScore += articleScore * weight;
      totalWeight += weight;
    });

    const score = totalWeight > 0 ? (totalScore / totalWeight) * 25 : 0;
    const confidence = Math.min(90, articles.length * 8);
    return { score: Number(score.toFixed(2)), confidence };
  }

  calculateCotScore(netLong, netShort, openInterest) {
    if (
      !Number.isFinite(netLong) ||
      !Number.isFinite(netShort) ||
      !Number.isFinite(openInterest) ||
      openInterest === 0
    ) {
      return 0;
    }
    const ratio = (netLong - netShort) / openInterest;
    return Number((ratio * 100).toFixed(2));
  }

  computePriceChange(results) {
    if (!Array.isArray(results) || results.length === 0) {
      return 0;
    }
    const latest = results[0].c ?? results[0].close ?? results[0].vw;
    const oldestEntry = results[results.length - 1];
    const oldest = oldestEntry?.c ?? oldestEntry?.close ?? oldestEntry?.vw;
    if (!Number.isFinite(latest) || !Number.isFinite(oldest) || oldest === 0) {
      return 0;
    }
    return Number((((latest - oldest) / oldest) * 100).toFixed(2));
  }

  calculateOptionsScore(volume, priceChange) {
    if (!Number.isFinite(volume) || volume <= 0) {
      return 0;
    }
    const normalizedVolume = Math.min(volume / 500000, 1); // FX aggregation approx
    return Number((normalizedVolume * 60 + priceChange * 0.4).toFixed(2));
  }

  matchesPair(item, base, quote, metadata) {
    const headline = `${item.headline || ''} ${item.summary || ''}`.toLowerCase();
    const tokens = new Set(
      [
        base?.toLowerCase?.(),
        quote?.toLowerCase?.(),
        ...(metadata?.aliases || []).map((alias) => alias.toLowerCase())
      ].filter(Boolean)
    );

    for (const token of tokens) {
      if (token.length >= 3 && headline.includes(token)) {
        return true;
      }
    }

    return false;
  }

  polygonFxTicker(pair) {
    return `C:${pair.toUpperCase()}`;
  }

  cotSymbolForCurrency(currency) {
    const map = {
      EUR: 'CHRIS/CME_EC1',
      GBP: 'CHRIS/CME_BP1',
      AUD: 'CHRIS/CME_AD1',
      NZD: 'CHRIS/CME_NE1',
      CAD: 'CHRIS/CME_CD1',
      JPY: 'CHRIS/CME_JY1',
      CHF: 'CHRIS/CME_SF1'
    };
    return map[currency] || null;
  }

  cotSymbolForInstrument(metadata) {
    if (!metadata) {
      return null;
    }
    const pair = metadata.pair?.toUpperCase?.() || metadata.pair || null;
    if (!pair) {
      return null;
    }
    const map = {
      SPX500USD: 'CHRIS/CME_ES1',
      NAS100USD: 'CHRIS/CME_NQ1',
      GER40EUR: 'CHRIS/EUREX_FDAX1',
      XAUUSD: 'CHRIS/CME_GC1',
      XAGUSD: 'CHRIS/CME_SI1',
      USOILUSD: 'CHRIS/CME_CL1'
    };
    return map[pair] || null;
  }

  syntheticSocialSentiment(pair) {
    return {
      pair,
      score: 0,
      confidence: 25,
      mentions: 0,
      sampleSize: 0,
      source: 'synthetic',
      windowHours: 24
    };
  }

  syntheticCOT(pair) {
    return {
      pair,
      score: 0,
      confidence: 20,
      netLong: 0,
      netShort: 0,
      openInterest: 0,
      reportDate: null,
      source: 'synthetic'
    };
  }

  syntheticOptions(pair, source = 'synthetic') {
    return {
      pair,
      score: 0,
      confidence: 15,
      totalVolume: 0,
      priceChange: 0,
      source,
      windowHours: 24
    };
  }

  handlePolygonError(error, context) {
    if (!error || typeof error !== 'object') {
      console.warn(`${context}: unexpected error`);
      return;
    }
    const status = error.response?.status;
    const retryAfter = error.response?.headers?.['retry-after'];
    if (status === 429) {
      console.warn(
        `${context}: Polygon rate limit reached${retryAfter ? `, retry after ${retryAfter}s` : ''}.`
      );
    } else if (status === 403) {
      console.warn(`${context}: Polygon API key rejected (403). Using synthetic options flow.`);
    } else {
      console.error(`${context}:`, error.message);
    }
  }

  handleFinnhubError(error, context) {
    if (!error || typeof error !== 'object') {
      console.warn(`${context}: unexpected error`);
      return;
    }
    const status = error.response?.status;
    const retryAfter = error.response?.headers?.['retry-after'];
    if (status === 403) {
      console.warn(`${context}: Finnhub access denied (403). Serving synthetic sentiment.`);
    } else if (status === 429) {
      console.warn(
        `${context}: Finnhub rate limit hit${retryAfter ? `, retry after ${retryAfter}s` : ''}.`
      );
    } else {
      console.error(`${context}:`, error.message);
    }
  }

  applyBackoff(key, error) {
    const status = error?.response?.status;
    if (!status) {
      return;
    }
    let ttlMs = 0;
    if (status === 429) {
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      ttlMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 10 * 60 * 1000;
    } else if (status === 403) {
      ttlMs = 30 * 60 * 1000;
    }
    if (ttlMs > 0) {
      this.backoffUntil.set(key, Date.now() + ttlMs);
    }
  }

  isInBackoff(key) {
    const until = this.backoffUntil.get(key);
    if (!until) {
      return false;
    }
    if (Date.now() < until) {
      return true;
    }
    this.backoffUntil.delete(key);
    return false;
  }

  isSyntheticSource(source) {
    if (!source) {
      return true;
    }
    return String(source).toLowerCase().startsWith('synthetic');
  }

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

  isRealKey(value) {
    if (!value) {
      return false;
    }
    const normalized = String(value).toLowerCase();
    if (normalized === 'demo' || normalized === 'free') {
      return false;
    }
    return !normalized.startsWith('test_');
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.timestamp < this.cacheDurationMs) {
      return cached.value;
    }
    this.cache.delete(key);
    return null;
  }

  setCached(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }
}

export default SentimentFeedsService;
