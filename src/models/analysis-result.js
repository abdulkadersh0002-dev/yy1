/**
 * Analysis Result Models
 * Domain models for technical, economic, and news analysis results
 */

import { z } from 'zod';
import { BaseModel } from './base-model.js';

// Technical Analysis Schema
const TechnicalAnalysisSchema = z
  .object({
    pair: z.string().min(6).max(10),
    timestamp: z.number().int().positive(),
    timeframes: z.record(z.any()),
    overallScore: z.number().min(-100).max(100),
    trend: z.string(),
    strength: z.number().min(0).max(100),
    signals: z.array(z.any()),
    latestPrice: z.number().positive().nullable(),
    directionSummary: z.record(z.any()).nullable(),
    regimeSummary: z.record(z.any()).nullable(),
    volatilitySummary: z.record(z.any()).nullable(),
    divergenceSummary: z.record(z.any()).nullable(),
    volumePressureSummary: z.record(z.any()).nullable()
  })
  .strict();

/**
 * Technical Analysis Result Model
 */
class TechnicalAnalysisResult extends BaseModel {
  constructor(data) {
    const defaults = {
      pair: '',
      timestamp: Date.now(),
      timeframes: {},
      overallScore: 0,
      trend: 'neutral',
      strength: 0,
      signals: [],
      latestPrice: null,
      directionSummary: null,
      regimeSummary: null,
      volatilitySummary: null,
      divergenceSummary: null,
      volumePressureSummary: null
    };

    super({ ...defaults, ...data }, TechnicalAnalysisSchema);
  }

  /**
   * Get the dominant trend direction
   * @returns {string} Trend direction
   */
  getTrendDirection() {
    return this.get('trend');
  }

  /**
   * Check if trend is bullish
   * @returns {boolean} Whether trend is bullish
   */
  isBullish() {
    const trend = this.getTrendDirection().toLowerCase();
    return trend.includes('bull') || trend.includes('up');
  }

  /**
   * Check if trend is bearish
   * @returns {boolean} Whether trend is bearish
   */
  isBearish() {
    const trend = this.getTrendDirection().toLowerCase();
    return trend.includes('bear') || trend.includes('down');
  }

  /**
   * Get timeframe analysis for a specific timeframe
   * @param {string} timeframe - Timeframe code (e.g., 'M15', 'H1')
   * @returns {Object|null} Timeframe analysis
   */
  getTimeframeAnalysis(timeframe) {
    const timeframes = this.get('timeframes');
    return timeframes[timeframe] || null;
  }

  /**
   * Get all available timeframes
   * @returns {Array<string>} Array of timeframe codes
   */
  getAvailableTimeframes() {
    return Object.keys(this.get('timeframes'));
  }

  /**
   * Calculate overall consensus across timeframes
   * @returns {Object} Consensus with direction and confidence
   */
  getConsensus() {
    const timeframes = this.get('timeframes');
    const directions = { BUY: 0, SELL: 0, NEUTRAL: 0 };

    Object.values(timeframes).forEach((tf) => {
      const dir = tf.direction || 'NEUTRAL';
      directions[dir] = (directions[dir] || 0) + 1;
    });

    const total = Object.values(directions).reduce((sum, count) => sum + count, 0);
    const maxDirection = Object.entries(directions).reduce(
      (max, [dir, count]) => (count > max.count ? { direction: dir, count } : max),
      { direction: 'NEUTRAL', count: 0 }
    );

    return {
      direction: maxDirection.direction,
      confidence: total > 0 ? (maxDirection.count / total) * 100 : 0,
      breakdown: directions
    };
  }

  /**
   * Check if analysis is stale
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {boolean} Whether analysis is stale
   */
  isStale(maxAgeMs = 300000) {
    const age = Date.now() - this.get('timestamp');
    return age > maxAgeMs;
  }
}

// Economic Analysis Schema
const EconomicAnalysisSchema = z
  .object({
    currency: z.string().length(3),
    timestamp: z.number().int().positive(),
    indicators: z.record(z.any()),
    score: z.number().min(-100).max(100),
    sentiment: z.string(),
    strength: z.number().min(0).max(100)
  })
  .strict();

/**
 * Economic Analysis Result Model
 */
class EconomicAnalysisResult extends BaseModel {
  constructor(data) {
    const defaults = {
      currency: '',
      timestamp: Date.now(),
      indicators: {},
      score: 0,
      sentiment: 'neutral',
      strength: 0
    };

    super({ ...defaults, ...data }, EconomicAnalysisSchema);
  }

  /**
   * Get sentiment direction
   * @returns {string} Sentiment
   */
  getSentiment() {
    return this.get('sentiment');
  }

  /**
   * Check if economic outlook is positive
   * @returns {boolean} Whether outlook is positive
   */
  isPositive() {
    const score = this.get('score');
    return score > 10;
  }

  /**
   * Check if economic outlook is negative
   * @returns {boolean} Whether outlook is negative
   */
  isNegative() {
    const score = this.get('score');
    return score < -10;
  }

  /**
   * Get specific economic indicator
   * @param {string} indicatorName - Name of the indicator
   * @returns {*} Indicator value
   */
  getIndicator(indicatorName) {
    const indicators = this.get('indicators');
    return indicators[indicatorName];
  }

  /**
   * Check if analysis is stale
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {boolean} Whether analysis is stale
   */
  isStale(maxAgeMs = 3600000) {
    // Economic data is typically less frequent, 1 hour default
    const age = Date.now() - this.get('timestamp');
    return age > maxAgeMs;
  }
}

// News Analysis Schema
const NewsAnalysisSchema = z
  .object({
    pair: z.string().min(6).max(10),
    timestamp: z.number().int().positive(),
    baseNews: z.array(z.any()),
    quoteNews: z.array(z.any()),
    calendar: z.array(z.any()),
    sentiment: z.object({
      base: z.number().min(-100).max(100),
      quote: z.number().min(-100).max(100),
      overall: z.number().min(-100).max(100)
    }),
    impact: z.number().min(0).max(100),
    direction: z.string(),
    confidence: z.number().min(0).max(100),
    sources: z.record(z.any()),
    sentimentFeeds: z.any().nullable()
  })
  .strict();

/**
 * News Analysis Result Model
 */
class NewsAnalysisResult extends BaseModel {
  constructor(data) {
    const defaults = {
      pair: '',
      timestamp: Date.now(),
      baseNews: [],
      quoteNews: [],
      calendar: [],
      sentiment: { base: 0, quote: 0, overall: 0 },
      impact: 0,
      direction: 'neutral',
      confidence: 0,
      sources: {},
      sentimentFeeds: null
    };

    super({ ...defaults, ...data }, NewsAnalysisSchema);
  }

  /**
   * Get overall sentiment score
   * @returns {number} Overall sentiment
   */
  getOverallSentiment() {
    return this.get('sentiment').overall;
  }

  /**
   * Check if sentiment is bullish
   * @returns {boolean} Whether sentiment is bullish
   */
  isBullish() {
    return this.getOverallSentiment() > 10;
  }

  /**
   * Check if sentiment is bearish
   * @returns {boolean} Whether sentiment is bearish
   */
  isBearish() {
    return this.getOverallSentiment() < -10;
  }

  /**
   * Get high-impact news items
   * @param {number} minImpact - Minimum impact threshold
   * @returns {Array} High-impact news items
   */
  getHighImpactNews(minImpact = 70) {
    const baseNews = this.get('baseNews').filter((item) => (item.impact || 0) >= minImpact);
    const quoteNews = this.get('quoteNews').filter((item) => (item.impact || 0) >= minImpact);

    return [...baseNews, ...quoteNews];
  }

  /**
   * Get upcoming economic calendar events
   * @param {number} hoursAhead - Hours to look ahead
   * @returns {Array} Upcoming calendar events
   */
  getUpcomingEvents(hoursAhead = 24) {
    const now = Date.now();
    const cutoff = now + hoursAhead * 60 * 60 * 1000;

    return this.get('calendar').filter((event) => {
      const eventTime = new Date(event.date || event.datetime || event.time).getTime();
      return eventTime >= now && eventTime <= cutoff;
    });
  }

  /**
   * Check if there are high-impact events soon
   * @param {number} hoursAhead - Hours to look ahead
   * @param {number} minImpact - Minimum impact threshold
   * @returns {boolean} Whether high-impact events are upcoming
   */
  hasHighImpactEventsSoon(hoursAhead = 4, minImpact = 70) {
    const upcomingEvents = this.getUpcomingEvents(hoursAhead);
    return upcomingEvents.some((event) => (event.impact || 0) >= minImpact);
  }

  /**
   * Check if analysis is stale
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {boolean} Whether analysis is stale
   */
  isStale(maxAgeMs = 600000) {
    // News data updates frequently, 10 minutes default
    const age = Date.now() - this.get('timestamp');
    return age > maxAgeMs;
  }
}

export { TechnicalAnalysisResult, EconomicAnalysisResult, NewsAnalysisResult };
