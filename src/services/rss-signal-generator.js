/**
 * RSS-Based Signal Generator
 * Generates trading signals from free RSS news feeds
 * No API keys required - uses Google News and public RSS feeds
 */

import logger from './logging/logger.js';

/**
 * RSS Signal Generator
 * Creates high-quality trading signals from news sentiment analysis
 */
export class RSSSignalGenerator {
  constructor(options = {}) {
    this.rssFeedAggregator = options.rssFeedAggregator;
    this.sentimentProcessor = options.sentimentProcessor;
    this.priceCache = new Map(); // Cache prices from EA
    this.signalCache = new Map(); // Cache generated signals
    this.signalHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Update price cache from MT4/MT5 EA
   * @param {Array} prices - Price data from EA
   */
  updatePrices(prices) {
    if (!Array.isArray(prices)) {
      return;
    }

    prices.forEach((priceData) => {
      this.priceCache.set(priceData.pair, {
        bid: priceData.bid,
        ask: priceData.ask,
        high: priceData.high,
        low: priceData.low,
        close: priceData.close,
        volume: priceData.volume,
        timestamp: priceData.timestamp || Date.now(),
        source: 'MT4/MT5 EA'
      });
    });

    logger.debug({ priceCount: prices.length }, 'Price cache updated from EA');
  }

  /**
   * Generate signals from RSS feeds
   * @param {Object} options - Signal generation options
   * @returns {Promise<Array>} Array of trading signals
   */
  async generateSignals(options = {}) {
    const {
      pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
      maxSignals = 5,
      minConfidence = 60
    } = options;

    try {
      // Fetch fresh RSS news
      const newsItems = await this.fetchRSSNews(pairs);

      // Analyze sentiment from news
      const sentimentAnalysis = await this.analyzeSentiment(newsItems, pairs);

      // Generate signals based on sentiment + prices
      const signals = await this.createSignalsFromAnalysis(sentimentAnalysis, pairs, minConfidence);

      // Filter and rank signals
      const topSignals = this.rankAndFilterSignals(signals, maxSignals);

      // Cache signals
      topSignals.forEach((signal) => {
        this.signalCache.set(signal.pair, signal);
        this.signalHistory.push({
          ...signal,
          generatedAt: Date.now()
        });
      });

      // Trim history
      if (this.signalHistory.length > this.maxHistorySize) {
        this.signalHistory = this.signalHistory.slice(-this.maxHistorySize);
      }

      logger.info({ signalCount: topSignals.length }, 'RSS-based signals generated');

      return topSignals;
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate RSS signals');
      return [];
    }
  }

  /**
   * Fetch RSS news for currency pairs
   * @param {Array} pairs - Currency pairs
   * @returns {Promise<Array>} News items
   */
  async fetchRSSNews(pairs) {
    if (!this.rssFeedAggregator) {
      return [];
    }

    try {
      // Generate search keywords from pairs
      const keywords = this.extractCurrenciesFromPairs(pairs);

      // Fetch from multiple sources
      const newsItems = await this.rssFeedAggregator.fetchNews({
        keywords: keywords.concat(['forex', 'currency', 'central bank', 'interest rate']),
        maxItems: 50,
        sources: ['google-news', 'reuters', 'bloomberg', 'forexlive']
      });

      return newsItems;
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch RSS news');
      return [];
    }
  }

  /**
   * Analyze sentiment from news items
   * @param {Array} newsItems - News items
   * @param {Array} pairs - Currency pairs
   * @returns {Promise<Object>} Sentiment analysis by pair
   */
  async analyzeSentiment(newsItems, pairs) {
    const sentimentByPair = {};

    pairs.forEach((pair) => {
      const [base, quote] = this.splitPair(pair);

      // Filter relevant news
      const relevantNews = newsItems.filter((item) => {
        const text = `${item.title} ${item.summary || ''}`.toLowerCase();
        return (
          text.includes(base.toLowerCase()) ||
          text.includes(quote.toLowerCase()) ||
          text.includes(pair.toLowerCase())
        );
      });

      // Simple sentiment scoring
      let bullishScore = 0;
      let bearishScore = 0;
      let neutralScore = 0;

      relevantNews.forEach((item) => {
        const text = `${item.title} ${item.summary || ''}`.toLowerCase();

        // Bullish keywords
        const bullishKeywords = [
          'rise',
          'gain',
          'strengthen',
          'rally',
          'surge',
          'climb',
          'advance',
          'boost',
          'positive',
          'optimism',
          'growth',
          'expansion'
        ];

        // Bearish keywords
        const bearishKeywords = [
          'fall',
          'drop',
          'weaken',
          'decline',
          'plunge',
          'slide',
          'retreat',
          'negative',
          'concern',
          'recession',
          'contraction',
          'crisis'
        ];

        // Count keyword matches
        bullishKeywords.forEach((keyword) => {
          if (text.includes(keyword)) {
            bullishScore += 1;
          }
        });

        bearishKeywords.forEach((keyword) => {
          if (text.includes(keyword)) {
            bearishScore += 1;
          }
        });

        if (bullishScore === bearishScore) {
          neutralScore += 1;
        }
      });

      const total = bullishScore + bearishScore + neutralScore;
      sentimentByPair[pair] = {
        bullish: total > 0 ? (bullishScore / total) * 100 : 0,
        bearish: total > 0 ? (bearishScore / total) * 100 : 0,
        neutral: total > 0 ? (neutralScore / total) * 100 : 0,
        newsCount: relevantNews.length,
        confidence: Math.min(100, relevantNews.length * 10) // More news = higher confidence
      };
    });

    return sentimentByPair;
  }

  /**
   * Create signals from sentiment analysis
   * @param {Object} sentimentAnalysis - Sentiment by pair
   * @param {Array} pairs - Currency pairs
   * @param {number} minConfidence - Minimum confidence threshold
   * @returns {Promise<Array>} Trading signals
   */
  async createSignalsFromAnalysis(sentimentAnalysis, pairs, minConfidence) {
    const signals = [];

    for (const pair of pairs) {
      const sentiment = sentimentAnalysis[pair];
      if (!sentiment || sentiment.confidence < minConfidence) {
        continue;
      }

      const priceData = this.priceCache.get(pair);
      if (!priceData) {
        continue;
      }

      // Determine direction
      let direction = 'NEUTRAL';
      let strength = 0;
      const confidence = sentiment.confidence;

      if (sentiment.bullish > sentiment.bearish + 20) {
        direction = 'BUY';
        strength = Math.min(100, sentiment.bullish);
      } else if (sentiment.bearish > sentiment.bullish + 20) {
        direction = 'SELL';
        strength = Math.min(100, sentiment.bearish);
      }

      if (direction === 'NEUTRAL') {
        continue;
      }

      // Calculate entry, SL, TP
      const currentPrice = direction === 'BUY' ? priceData.ask : priceData.bid;
      const atr = this.calculateATR(priceData);
      const stopLoss = direction === 'BUY' ? currentPrice - atr * 2 : currentPrice + atr * 2;
      const takeProfit = direction === 'BUY' ? currentPrice + atr * 3 : currentPrice - atr * 3;

      signals.push({
        pair,
        timestamp: Date.now(),
        direction,
        strength,
        confidence,
        finalScore: strength * 0.6 + confidence * 0.4,
        source: 'RSS + EA Price',
        entry: {
          price: currentPrice,
          stopLoss,
          takeProfit,
          riskRewardRatio: 1.5
        },
        components: {
          sentiment: sentiment.bullish - sentiment.bearish,
          newsCount: sentiment.newsCount
        },
        riskManagement: {
          accountRiskPercentage: 2.0
        },
        isValid: {
          isValid: true,
          checks: {
            sentiment: true,
            price: true,
            news: sentiment.newsCount >= 3
          },
          reason: 'Strong RSS sentiment signal'
        },
        reasoning: [
          `${sentiment.newsCount} relevant news items analyzed`,
          `${direction} sentiment: ${direction === 'BUY' ? sentiment.bullish : sentiment.bearish}%`,
          `Price from MT4/MT5 EA: ${currentPrice.toFixed(5)}`
        ]
      });
    }

    return signals;
  }

  /**
   * Rank and filter signals
   * @param {Array} signals - All signals
   * @param {number} maxSignals - Maximum signals to return
   * @returns {Array} Top ranked signals
   */
  rankAndFilterSignals(signals, maxSignals) {
    return signals
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, maxSignals)
      .map((signal, index) => ({
        ...signal,
        rank: index + 1,
        explainability: {
          factors: [
            { name: 'Sentiment', weight: 60, impact: 'high' },
            { name: 'News Volume', weight: 20, impact: 'medium' },
            { name: 'Confidence', weight: 20, impact: 'medium' }
          ],
          summary: `RSS-based signal ranked #${index + 1} with ${signal.finalScore.toFixed(1)}% score`
        }
      }));
  }

  /**
   * Calculate ATR for stop loss/take profit
   * @param {Object} priceData - Price data
   * @returns {number} ATR value
   */
  calculateATR(priceData) {
    // Simplified ATR calculation
    const range = priceData.high - priceData.low;
    return range * 0.5; // Use 50% of range as ATR approximation
  }

  /**
   * Split pair into base and quote currencies
   * @param {string} pair - Currency pair
   * @returns {Array} [base, quote]
   */
  splitPair(pair) {
    if (pair.length === 6) {
      return [pair.substring(0, 3), pair.substring(3, 6)];
    }
    return [pair, pair];
  }

  /**
   * Extract unique currencies from pairs
   * @param {Array} pairs - Currency pairs
   * @returns {Array} Unique currencies
   */
  extractCurrenciesFromPairs(pairs) {
    const currencies = new Set();
    pairs.forEach((pair) => {
      const [base, quote] = this.splitPair(pair);
      currencies.add(base);
      currencies.add(quote);
    });
    return Array.from(currencies);
  }

  /**
   * Get cached signals
   * @returns {Array} Cached signals
   */
  getCachedSignals() {
    return Array.from(this.signalCache.values());
  }

  /**
   * Get signal for specific pair
   * @param {string} pair - Currency pair
   * @returns {Object|null} Signal or null
   */
  getSignalForPair(pair) {
    return this.signalCache.get(pair) || null;
  }

  /**
   * Get signal history
   * @param {number} limit - Maximum signals to return
   * @returns {Array} Signal history
   */
  getSignalHistory(limit = 20) {
    return this.signalHistory.slice(-limit);
  }
}

export default RSSSignalGenerator;
