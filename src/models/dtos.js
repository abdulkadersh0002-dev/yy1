// Common DTO definitions for the trading system
// These are plain JS shape helpers + JSDoc typedefs to keep
// engine, analyzers, and APIs speaking the same language.
//
// Runtime validation is implemented with zod so callers can
// opt into strict checking without changing call sites.

import { z } from 'zod';

/**
 * @typedef {Object} TradingSignalDTO
 * @property {string|null|undefined} broker
 * @property {string} pair
 * @property {number} timestamp
 * @property {number|null|undefined} expiresAt
 * @property {string|null|undefined} signalStatus
 * @property {string|null|undefined} timeframe
 * @property {{ state?: string, expiresAt?: (number|null), ttlMs?: (number|null), evaluatedAt?: (number|null), reason?: (string|null) }|null|undefined} validity
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
 * @property {{ action: ('BUY'|'SELL'|'NEUTRAL'), reason: (string|null), reasons: string[], tradeValid: (boolean|null) }|null|undefined} finalDecision
 */

// Zod schemas for runtime validation
export const TradingSignalSchema = z
  .object({
    broker: z.string().nullable().optional(),
    pair: z.string(),
    timestamp: z.number(),
    expiresAt: z.number().nullable().optional(),
    signalStatus: z.string().nullable().optional(),
    timeframe: z.string().nullable().optional(),
    validity: z
      .object({
        state: z.string().optional(),
        expiresAt: z.number().nullable().optional(),
        ttlMs: z.number().nullable().optional(),
        evaluatedAt: z.number().nullable().optional(),
        reason: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    direction: z.enum(['BUY', 'SELL', 'NEUTRAL']),
    strength: z.number(),
    confidence: z.number(),
    finalScore: z.number(),
    finalDecision: z
      .object({
        action: z.enum(['BUY', 'SELL', 'NEUTRAL']),
        reason: z.string().nullable().optional(),
        reasons: z.array(z.string()).optional(),
        tradeValid: z.boolean().nullable().optional()
      })
      .nullable()
      .optional(),
    components: z.record(z.any()),
    entry: z.any().nullable(),
    riskManagement: z.record(z.any()),
    isValid: z.object({
      isValid: z.boolean(),
      checks: z.record(z.boolean()),
      reason: z.string(),
      decision: z
        .object({
          state: z.enum(['ENTER', 'WAIT_MONITOR', 'NO_TRADE_BLOCKED']).optional(),
          blocked: z.boolean().optional(),
          score: z.number().optional(),
          assetClass: z.string().optional(),
          category: z.string().optional(),
          killSwitch: z
            .object({
              enabled: z.boolean().optional(),
              blocked: z.boolean().optional(),
              ids: z.array(z.string()).optional(),
              items: z
                .array(
                  z.object({
                    id: z.string(),
                    label: z.string().nullable().optional(),
                    reason: z.string().nullable().optional(),
                    weight: z.number().nullable().optional()
                  })
                )
                .optional()
            })
            .nullable()
            .optional(),
          blockers: z.array(z.string()).optional(),
          missing: z.array(z.string()).optional(),
          whatWouldChange: z.array(z.string()).optional(),
          missingInputs: z
            .object({
              missing: z.array(z.string()).optional(),
              details: z.record(z.any()).optional()
            })
            .optional(),
          nextSteps: z.array(z.string()).optional(),
          contributors: z.record(z.any()).optional(),
          modifiers: z.record(z.any()).optional(),
          context: z.record(z.any()).optional()
        })
        .optional()
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

export const PriceBarSchema = z
  .object({
    // Epoch ms recommended. If the EA sends epoch seconds, the backend will normalize.
    time: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number().optional().nullable()
  })
  .passthrough();

export const MarketQuoteSchema = z
  .object({
    symbol: z.string().min(1),
    pair: z.string().min(1).optional(),
    bid: z.number().nullable().optional(),
    ask: z.number().nullable().optional(),
    last: z.number().nullable().optional(),
    digits: z.number().nullable().optional(),
    point: z.number().nullable().optional(),
    spreadPoints: z.number().nullable().optional(),
    tickSize: z.number().nullable().optional(),
    tickValue: z.number().nullable().optional(),
    contractSize: z.number().nullable().optional(),
    timestamp: z.number().nullable().optional(),
    time: z.number().nullable().optional(),
    source: z.string().nullable().optional()
  })
  .passthrough();

export const MarketQuotesIngestSchema = z
  .object({
    broker: z.string().min(1),
    quotes: z.array(MarketQuoteSchema).optional()
  })
  .passthrough()
  .refine(
    (value) =>
      (Array.isArray(value.quotes) && value.quotes.length > 0) ||
      Boolean(value.symbol || value.pair),
    {
      message: 'quotes[] or single quote payload is required'
    }
  )
  .transform((value) => {
    if (Array.isArray(value.quotes) && value.quotes.length > 0) {
      return { ...value, quotes: value.quotes };
    }
    const single = {
      ...value,
      symbol: value.symbol ?? value.pair
    };
    return { broker: value.broker, quotes: [single] };
  });

export const MarketSnapshotSchema = z
  .object({
    broker: z.string().min(1),
    symbol: z.string().min(1),
    pair: z.string().min(1).optional(),
    timeframes: z.record(z.any()).optional(),
    timestamp: z.number().optional(),
    time: z.number().optional(),
    source: z.string().optional(),
    quote: z.record(z.any()).optional()
  })
  .passthrough();

export const MarketNewsItemSchema = z
  .object({
    id: z.string().min(1).nullable().optional(),
    eventId: z.string().min(1).nullable().optional(),
    guid: z.string().min(1).nullable().optional(),
    title: z.string().min(1).nullable().optional(),
    headline: z.string().min(1).nullable().optional(),
    symbol: z.string().min(1).nullable().optional(),
    currency: z.string().min(1).nullable().optional(),
    impact: z.union([z.number(), z.string()]).optional(),
    importance: z.union([z.number(), z.string()]).optional(),
    time: z.number().nullable().optional(),
    timestamp: z.number().nullable().optional(),
    date: z.union([z.number(), z.string()]).nullable().optional(),
    forecast: z.any().optional(),
    previous: z.any().optional(),
    actual: z.any().optional(),
    source: z.string().nullable().optional(),
    notes: z.any().optional(),
    comment: z.any().optional(),
    kind: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    link: z.string().nullable().optional()
  })
  .passthrough();

export const MarketNewsIngestSchema = z
  .object({
    broker: z.string().min(1),
    items: z.array(MarketNewsItemSchema).optional(),
    news: z.array(MarketNewsItemSchema).optional()
  })
  .passthrough()
  .refine(
    (value) =>
      (Array.isArray(value.items) && value.items.length > 0) ||
      (Array.isArray(value.news) && value.news.length > 0),
    { message: 'items/news array is required' }
  )
  .transform((value) => ({
    broker: value.broker,
    items: Array.isArray(value.items) && value.items.length ? value.items : value.news || []
  }));

export const MarketBarsIngestSchema = z
  .object({
    broker: z.string().min(1),
    symbol: z.string().min(1),
    timeframe: z.string().min(1),
    bars: z.array(PriceBarSchema).optional(),
    bar: PriceBarSchema.optional(),
    source: z.string().optional(),
    timestamp: z.number().optional()
  })
  .passthrough()
  .refine((value) => (Array.isArray(value.bars) ? value.bars.length > 0 : Boolean(value.bar)), {
    message: 'bars[] or bar is required'
  })
  .transform((value) => ({
    ...value,
    bars: Array.isArray(value.bars) && value.bars.length ? value.bars : value.bar ? [value.bar] : []
  }));

const optionalFiniteNumber = () =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().finite()
  );

export const ModifyPositionSchema = z
  .object({
    broker: z.string().min(1).optional(),
    ticket: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    id: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    positionId: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    symbol: z.string().min(1).optional(),
    pair: z.string().min(1).optional(),
    stopLoss: optionalFiniteNumber().optional().nullable(),
    sl: optionalFiniteNumber().optional().nullable(),
    takeProfit: optionalFiniteNumber().optional().nullable(),
    tp: optionalFiniteNumber().optional().nullable(),
    accountNumber: z
      .union([z.string().min(1), z.number().int().positive()])
      .optional()
      .nullable(),
    comment: z.string().max(120).optional().nullable(),
    source: z.string().max(60).optional().nullable(),
    tradeId: z.string().max(80).optional().nullable(),
    reason: z.string().max(120).optional().nullable()
  })
  .passthrough()
  .refine(
    (value) => Boolean(value.ticket ?? value.id ?? value.positionId),
    'ticket/id/positionId is required'
  )
  .refine((value) => Boolean(value.symbol ?? value.pair), 'symbol/pair is required')
  .refine(
    (value) =>
      value.stopLoss != null || value.sl != null || value.takeProfit != null || value.tp != null,
    'stopLoss/takeProfit (or sl/tp) is required'
  )
  .transform((value) => {
    const stopLoss = value.stopLoss ?? value.sl ?? null;
    const takeProfit = value.takeProfit ?? value.tp ?? null;
    return {
      broker: value.broker,
      ticket: value.ticket ?? value.id ?? value.positionId,
      symbol: value.symbol ?? value.pair,
      stopLoss: stopLoss == null ? null : Number(stopLoss),
      takeProfit: takeProfit == null ? null : Number(takeProfit),
      accountNumber: value.accountNumber ?? null,
      comment: value.comment ?? null,
      source: value.source ?? null,
      tradeId: value.tradeId ?? null,
      reason: value.reason ?? null
    };
  });

export function createTradingSignalDTO(raw) {
  if (!raw) {
    return {
      broker: null,
      pair: '',
      timestamp: Date.now(),
      expiresAt: null,
      signalStatus: null,
      timeframe: null,
      validity: null,
      direction: 'NEUTRAL',
      strength: 0,
      confidence: 0,
      finalScore: 0,
      finalDecision: null,
      components: {},
      entry: null,
      riskManagement: {},
      isValid: { isValid: false, checks: {}, reason: 'Empty signal' },
      explainability: null,
      reasoning: null
    };
  }

  const timeframe = (() => {
    const direct = raw.timeframe ?? raw.meta?.timeframe;
    if (direct != null && String(direct).trim()) {
      return String(direct);
    }
    const technicalTf = raw.components?.technical?.signals?.[0]?.timeframe;
    if (technicalTf != null && String(technicalTf).trim()) {
      return String(technicalTf);
    }
    return null;
  })();

  return {
    broker: raw.broker || null,
    pair: String(raw.pair || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    expiresAt: Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : null,
    signalStatus: raw.signalStatus != null ? String(raw.signalStatus) : null,
    timeframe,
    validity:
      raw.validity && typeof raw.validity === 'object'
        ? {
            state: raw.validity.state != null ? String(raw.validity.state) : undefined,
            expiresAt:
              raw.validity.expiresAt == null || !Number.isFinite(Number(raw.validity.expiresAt))
                ? null
                : Number(raw.validity.expiresAt),
            ttlMs:
              raw.validity.ttlMs == null || !Number.isFinite(Number(raw.validity.ttlMs))
                ? null
                : Number(raw.validity.ttlMs),
            evaluatedAt:
              raw.validity.evaluatedAt == null || !Number.isFinite(Number(raw.validity.evaluatedAt))
                ? null
                : Number(raw.validity.evaluatedAt),
            reason: raw.validity.reason != null ? String(raw.validity.reason) : null
          }
        : null,
    direction: raw.direction || 'NEUTRAL',
    strength: Number(raw.strength) || 0,
    confidence: Number(raw.confidence) || 0,
    finalScore: Number(raw.finalScore) || 0,
    finalDecision:
      raw.finalDecision && typeof raw.finalDecision === 'object'
        ? {
            action: raw.finalDecision.action || raw.direction || 'NEUTRAL',
            reason:
              raw.finalDecision.reason != null
                ? String(raw.finalDecision.reason)
                : raw.isValid?.reason || null,
            reasons: Array.isArray(raw.finalDecision.reasons)
              ? raw.finalDecision.reasons.map((r) => String(r)).slice(0, 6)
              : [],
            tradeValid:
              raw.finalDecision.tradeValid === null || raw.finalDecision.tradeValid === undefined
                ? null
                : Boolean(raw.finalDecision.tradeValid)
          }
        : null,
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
      reason: raw.isValid?.reason || 'Unspecified',
      decision:
        raw.isValid?.decision && typeof raw.isValid.decision === 'object'
          ? {
              state: raw.isValid.decision.state || undefined,
              blocked:
                raw.isValid.decision.blocked === undefined
                  ? undefined
                  : Boolean(raw.isValid.decision.blocked),
              score: Number.isFinite(Number(raw.isValid.decision.score))
                ? Number(raw.isValid.decision.score)
                : undefined,
              assetClass: raw.isValid.decision.assetClass || undefined,
              category: raw.isValid.decision.category || undefined,
              blockers: Array.isArray(raw.isValid.decision.blockers)
                ? raw.isValid.decision.blockers.map((v) => String(v)).slice(0, 10)
                : undefined,
              missing: Array.isArray(raw.isValid.decision.missing)
                ? raw.isValid.decision.missing.map((v) => String(v)).slice(0, 12)
                : undefined,
              whatWouldChange: Array.isArray(raw.isValid.decision.whatWouldChange)
                ? raw.isValid.decision.whatWouldChange.map((v) => String(v)).slice(0, 12)
                : undefined,
              contributors:
                raw.isValid.decision.contributors &&
                typeof raw.isValid.decision.contributors === 'object'
                  ? raw.isValid.decision.contributors
                  : undefined,
              modifiers:
                raw.isValid.decision.modifiers && typeof raw.isValid.decision.modifiers === 'object'
                  ? raw.isValid.decision.modifiers
                  : undefined,
              context:
                raw.isValid.decision.context && typeof raw.isValid.decision.context === 'object'
                  ? raw.isValid.decision.context
                  : undefined
            }
          : undefined
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

export function validateMarketBarsIngestDTO(dto) {
  return MarketBarsIngestSchema.parse(dto);
}

export function validateMarketQuotesIngestDTO(dto) {
  return MarketQuotesIngestSchema.parse(dto);
}

export function validateMarketSnapshotIngestDTO(dto) {
  return MarketSnapshotSchema.parse(dto);
}

export function validateMarketNewsIngestDTO(dto) {
  return MarketNewsIngestSchema.parse(dto);
}

export function validateModifyPositionDTO(dto) {
  return ModifyPositionSchema.parse(dto);
}
