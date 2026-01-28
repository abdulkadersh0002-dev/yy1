import { z } from 'zod';

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
    timeframes: z.record(z.unknown()).optional(),
    timestamp: z.number().optional(),
    time: z.number().optional(),
    source: z.string().optional(),
    quote: z.record(z.unknown()).optional()
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
    forecast: z.unknown().optional(),
    previous: z.unknown().optional(),
    actual: z.unknown().optional(),
    source: z.string().nullable().optional(),
    notes: z.unknown().optional(),
    comment: z.unknown().optional(),
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
