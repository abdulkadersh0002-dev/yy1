import { toFixedNumber } from './utils.js';

const DEFAULT_SPREAD_PIPS = 0.8;
const DEFAULT_SLIPPAGE_PIPS = 0.2;
const DEFAULT_COMMISSION_PER_LOT = 7; // USD per standard lot
const DEFAULT_LOT_SIZE = 100000;

export class TransactionCostModel {
  constructor(options = {}) {
    this.spreadPips = Number.isFinite(options.spreadPips)
      ? options.spreadPips
      : DEFAULT_SPREAD_PIPS;
    this.slippagePips = Number.isFinite(options.slippagePips)
      ? options.slippagePips
      : DEFAULT_SLIPPAGE_PIPS;
    this.commissionPerLot = Number.isFinite(options.commissionPerLot)
      ? options.commissionPerLot
      : DEFAULT_COMMISSION_PER_LOT;
    this.lotSize = Number.isFinite(options.lotSize) ? options.lotSize : DEFAULT_LOT_SIZE;
    this.pipPrecisionOverride = options.pipPrecision || null;
  }

  getPipPrecision(pair) {
    if (Number.isFinite(this.pipPrecisionOverride)) {
      return this.pipPrecisionOverride;
    }
    if (typeof pair === 'string' && pair.toUpperCase().includes('JPY')) {
      return 0.01;
    }
    return 0.0001;
  }

  calculateCosts({
    pair,
    direction: _direction,
    entryPrice,
    exitPrice: _exitPrice,
    units = this.lotSize,
    slippagePips = this.slippagePips,
    spreadPips = this.spreadPips
  }) {
    const pipPrecision = this.getPipPrecision(pair);
    const pipValue = (pipPrecision / entryPrice) * units;

    const spreadCost = spreadPips * pipValue;
    const slippageCost = slippagePips * pipValue;
    const commissionCost = (this.commissionPerLot / this.lotSize) * units;

    return {
      spreadCost: toFixedNumber(spreadCost, 8),
      slippageCost: toFixedNumber(slippageCost, 8),
      commissionCost: toFixedNumber(commissionCost, 8),
      totalCost: toFixedNumber(spreadCost + slippageCost + commissionCost, 8),
      pipPrecision,
      pipValue
    };
  }
}

export default TransactionCostModel;
