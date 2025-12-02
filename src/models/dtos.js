// Common DTO definitions for the trading system
// These are plain JS shape helpers + JSDoc typedefs to keep
// engine, analyzers, and APIs speaking the same language.
//
// Runtime validation is implemented with zod so callers can
// opt into strict checking without changing call sites.

import { z } from 'zod';

/**
 * @typedef {Object} TradingSignalDTO
 * @property {string} pair
 * @property {number} timestamp
 * @property {('BUY'|'SELL'|'NEUTRAL')} direction
 * @property {number} strength
 * @property {number} confidence
 * @property {number} finalScore
 * @property {Object} components
 * @property {Object|null} entry
 * @property {Object} riskManagement
 * @property {{ isValid: boolean, checks: Object<string, boolean>, reason: string }} isValid
 * @property {Object|null} explainability
 * @property {string[]|null} reasoning
 */

// Zod schemas for runtime validation
export const TradingSignalSchema = z
  .object({
    pair: z.string(),
    timestamp: z.number(),
    direction: z.enum(['BUY', 'SELL', 'NEUTRAL']),
    strength: z.number(),
    confidence: z.number(),
    finalScore: z.number(),
    components: z.record(z.any()),
    entry: z.any().nullable(),
    riskManagement: z.record(z.any()),
    isValid: z.object({
      isValid: z.boolean(),
      checks: z.record(z.boolean()),
      reason: z.string()
    }),
    explainability: z.any().nullable(),
    reasoning: z.array(z.string()).nullable().optional()
  })
  .strict();

/**
 * @typedef {Object} TradePnlDTO
 * @property {number|null} amount
 * @property {number|null} percentage
 */

/**
 * @typedef {Object} TradeDTO
 * @property {string} id
 * @property {string} pair
 * @property {('BUY'|'SELL')} direction
 * @property {number} positionSize
 * @property {number} entryPrice
 * @property {number|null} stopLoss
 * @property {number|null} takeProfit
 * @property {Date} openTime
 * @property {Date|null} closeTime
 * @property {('OPEN'|'CLOSED'|'CANCELLED'|'ERROR')} status
 * @property {string|null} closeReason
 * @property {string|null} broker
 * @property {TradePnlDTO|null} currentPnL
 * @property {TradePnlDTO|null} finalPnL
 */

export const TradeSchema = z
  .object({
    id: z.string(),
    pair: z.string(),
    direction: z.enum(['BUY', 'SELL']),
    positionSize: z.number(),
    entryPrice: z.number(),
    stopLoss: z.number().nullable(),
    takeProfit: z.number().nullable(),
    openTime: z.date(),
    closeTime: z.date().nullable(),
    status: z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'ERROR']),
    closeReason: z.string().nullable(),
    broker: z.string().nullable(),
    currentPnL: z
      .object({ amount: z.number().nullable(), percentage: z.number().nullable() })
      .nullable(),
    finalPnL: z
      .object({ amount: z.number().nullable(), percentage: z.number().nullable() })
      .nullable()
  })
  .strict();

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
    indicators: z.record(z.any()),
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
    baseNews: z.array(z.any()),
    quoteNews: z.array(z.any()),
    calendar: z.array(z.any()),
    sentiment: z.object({
      base: z.number(),
      quote: z.number(),
      overall: z.number()
    }),
    impact: z.number(),
    direction: z.string(),
    confidence: z.number(),
    sources: z.record(z.any()),
    sentimentFeeds: z.any().nullable()
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
    timeframes: z.record(z.any()),
    overallScore: z.number(),
    trend: z.string(),
    strength: z.number(),
    signals: z.array(z.any()),
    latestPrice: z.number().nullable(),
    directionSummary: z.record(z.any()).nullable(),
    regimeSummary: z.record(z.any()).nullable(),
    volatilitySummary: z.record(z.any()).nullable(),
    divergenceSummary: z.record(z.any()).nullable(),
    volumePressureSummary: z.record(z.any()).nullable()
  })
  .strict();

export function createTradingSignalDTO(raw) {
  if (!raw) {
    return {
      pair: '',
      timestamp: Date.now(),
      direction: 'NEUTRAL',
      strength: 0,
      confidence: 0,
      finalScore: 0,
      components: {},
      entry: null,
      riskManagement: {},
      isValid: { isValid: false, checks: {}, reason: 'Empty signal' },
      explainability: null,
      reasoning: null
    };
  }

  return {
    pair: String(raw.pair || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    direction: raw.direction || 'NEUTRAL',
    strength: Number(raw.strength) || 0,
    confidence: Number(raw.confidence) || 0,
    finalScore: Number(raw.finalScore) || 0,
    components: raw.components || {},
    entry: raw.entry ?? null,
    riskManagement: raw.riskManagement || {},
    // Normalize validation structure to ensure downstream Zod schema only sees booleans
    // even when upstream signal builders hand back null/undefined states.
    isValid: {
      isValid: Boolean(raw.isValid?.isValid),
      checks: (() => {
        const checks = raw.isValid?.checks || {};
        if (typeof checks !== 'object' || checks === null) {
          return {};
        }
        return Object.fromEntries(
          Object.entries(checks).map(([key, value]) => [
            key,
            value === null ? false : Boolean(value)
          ])
        );
      })(),
      reason: raw.isValid?.reason || 'Unspecified'
    },
    explainability: raw.explainability ?? null,
    reasoning: Array.isArray(raw.reasoning) ? raw.reasoning : null
  };
}

export function createTradeDTO(raw) {
  if (!raw) {
    throw new Error('TradeDTO requires a raw trade object');
  }

  return {
    id: String(raw.id),
    pair: String(raw.pair),
    direction: raw.direction,
    positionSize: Number(raw.positionSize) || 0,
    entryPrice: Number(raw.entryPrice) || 0,
    stopLoss: raw.stopLoss != null ? Number(raw.stopLoss) : null,
    takeProfit: raw.takeProfit != null ? Number(raw.takeProfit) : null,
    openTime: raw.openTime instanceof Date ? raw.openTime : new Date(raw.openTime || Date.now()),
    closeTime:
      raw.closeTime instanceof Date || raw.closeTime == null
        ? raw.closeTime
        : new Date(raw.closeTime),
    status: raw.status || 'OPEN',
    closeReason: raw.closeReason || null,
    broker: raw.broker || null,
    currentPnL: raw.currentPnL || null,
    finalPnL: raw.finalPnL || null
  };
}

export function normalizeEconomicAnalysis(raw) {
  if (!raw) return null;
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
  if (!raw) return null;
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
  if (!raw) return null;
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

export function validateTradingSignalDTO(dto) {
  return TradingSignalSchema.parse(dto);
}

export function validateTradeDTO(dto) {
  return TradeSchema.parse(dto);
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
