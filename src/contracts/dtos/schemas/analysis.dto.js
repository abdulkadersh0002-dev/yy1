import { z } from 'zod';

/**
 * @typedef {Object} EconomicAnalysisDTO
 * @property {string} currency
 * @property {number} timestamp
 * @property {Object<string, any>} indicators
 * @property {number} score
 * @property {string} sentiment
 * @property {number} strength
 */

export const EconomicAnalysisSchema = z
  .object({
    currency: z.string(),
    timestamp: z.number(),
    indicators: z.record(z.unknown()),
    score: z.number(),
    sentiment: z.string(),
    strength: z.number()
  })
  .strict();

/**
 * @typedef {Object} NewsAnalysisDTO
 * @property {string} pair
 * @property {number} timestamp
 * @property {Array<Object>} baseNews
 * @property {Array<Object>} quoteNews
 * @property {Array<Object>} calendar
 * @property {{ base: number, quote: number, overall: number }} sentiment
 * @property {number} impact
 * @property {string} direction
 * @property {number} confidence
 * @property {Object} sources
 * @property {Object|null} sentimentFeeds
 */

export const NewsAnalysisSchema = z
  .object({
    pair: z.string(),
    timestamp: z.number(),
    baseNews: z.array(z.unknown()),
    quoteNews: z.array(z.unknown()),
    calendar: z.array(z.unknown()),
    sentiment: z.object({
      base: z.number(),
      quote: z.number(),
      overall: z.number()
    }),
    impact: z.number(),
    direction: z.string(),
    confidence: z.number(),
    sources: z.record(z.unknown()),
    sentimentFeeds: z.unknown().nullable()
  })
  .strict();

/**
 * @typedef {Object} TechnicalTimeframeDTO
 * @property {string} timeframe
 * @property {string|null} pair
 * @property {Object<string, any>} indicators
 * @property {Array<Object>} patterns
 * @property {Object} supportResistance
 * @property {number} score
 * @property {number|null} lastPrice
 * @property {Object|null} latestCandle
 * @property {number} priceChangePercent
 * @property {('BUY'|'SELL'|'NEUTRAL')} direction
 */

/**
 * @typedef {Object} TechnicalAnalysisDTO
 * @property {string} pair
 * @property {number} timestamp
 * @property {Object<string, TechnicalTimeframeDTO>} timeframes
 * @property {number} overallScore
 * @property {string} trend
 * @property {number} strength
 * @property {Array<Object>} signals
 * @property {number|null} latestPrice
 * @property {Object|null} directionSummary
 * @property {Object|null} regimeSummary
 * @property {Object|null} volatilitySummary
 * @property {Object|null} divergenceSummary
 * @property {Object|null} volumePressureSummary
 */

export const TechnicalAnalysisSchema = z
  .object({
    pair: z.string(),
    timestamp: z.number(),
    timeframes: z.record(z.unknown()),
    overallScore: z.number(),
    trend: z.string(),
    strength: z.number(),
    signals: z.array(z.unknown()),
    latestPrice: z.number().nullable(),
    directionSummary: z.record(z.unknown()).nullable(),
    regimeSummary: z.record(z.unknown()).nullable(),
    volatilitySummary: z.record(z.unknown()).nullable(),
    divergenceSummary: z.record(z.unknown()).nullable(),
    volumePressureSummary: z.record(z.unknown()).nullable()
  })
  .strict();

export function normalizeEconomicAnalysis(raw) {
  if (!raw) {
    return null;
  }
  return {
    currency: String(raw.currency || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    indicators: raw.indicators || {},
    score: Number(raw.score) || 0,
    sentiment: raw.sentiment || 'neutral',
    strength: Number(raw.strength) || 0
  };
}

export function normalizeNewsAnalysis(raw) {
  if (!raw) {
    return null;
  }
  return {
    pair: String(raw.pair || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    baseNews: Array.isArray(raw.baseNews) ? raw.baseNews : [],
    quoteNews: Array.isArray(raw.quoteNews) ? raw.quoteNews : [],
    calendar: Array.isArray(raw.calendar) ? raw.calendar : [],
    sentiment: {
      base: Number(raw.sentiment?.base) || 0,
      quote: Number(raw.sentiment?.quote) || 0,
      overall: Number(raw.sentiment?.overall) || 0
    },
    impact: Number(raw.impact) || 0,
    direction: raw.direction || 'neutral',
    confidence: Number(raw.confidence) || 0,
    sources: raw.sources || {},
    sentimentFeeds: raw.sentimentFeeds ?? null
  };
}

export function normalizeTechnicalAnalysis(raw) {
  if (!raw) {
    return null;
  }
  const timeframes = raw.timeframes || {};
  const normalizedFrames = {};
  Object.entries(timeframes).forEach(([tf, value]) => {
    normalizedFrames[tf] = {
      timeframe: value.timeframe || tf,
      pair: value.pair || raw.pair || null,
      indicators: value.indicators || {},
      patterns: Array.isArray(value.patterns) ? value.patterns : [],
      supportResistance: value.supportResistance || {},
      score: Number(value.score) || 0,
      lastPrice: value.lastPrice != null ? Number(value.lastPrice) : null,
      latestCandle: value.latestCandle || null,
      priceChangePercent: Number(value.priceChangePercent) || 0,
      direction: value.direction || 'NEUTRAL'
    };
  });

  return {
    pair: String(raw.pair || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    timeframes: normalizedFrames,
    overallScore: Number(raw.overallScore) || 0,
    trend: raw.trend || 'neutral',
    strength: Number(raw.strength) || 0,
    signals: Array.isArray(raw.signals) ? raw.signals : [],
    latestPrice: raw.latestPrice != null ? Number(raw.latestPrice) : null,
    directionSummary: raw.directionSummary || null,
    regimeSummary: raw.regimeSummary || null,
    volatilitySummary: raw.volatilitySummary || null,
    divergenceSummary: raw.divergenceSummary || null,
    volumePressureSummary: raw.volumePressureSummary || null
  };
}

export function validateEconomicAnalysisDTO(dto) {
  return EconomicAnalysisSchema.parse(dto);
}

export function validateNewsAnalysisDTO(dto) {
  return NewsAnalysisSchema.parse(dto);
}

export function validateTechnicalAnalysisDTO(dto) {
  return TechnicalAnalysisSchema.parse(dto);
}
