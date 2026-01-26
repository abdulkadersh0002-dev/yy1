import { z } from 'zod';

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

export function validateTradeDTO(dto) {
  return TradeSchema.parse(dto);
}
