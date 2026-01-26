// DTO barrel.
// Canonical import path: "src/contracts/dtos.js".
// Legacy compatibility path: "src/models/dtos.js".

export {
  TradingSignalSchema,
  createTradingSignalDTO,
  validateTradingSignalDTO
} from '../trading-signal/index.js';

export { TradeSchema, createTradeDTO, validateTradeDTO } from '../trade/index.js';

export {
  EconomicAnalysisSchema,
  NewsAnalysisSchema,
  TechnicalAnalysisSchema,
  normalizeEconomicAnalysis,
  normalizeNewsAnalysis,
  normalizeTechnicalAnalysis,
  validateEconomicAnalysisDTO,
  validateNewsAnalysisDTO,
  validateTechnicalAnalysisDTO
} from '../analysis/index.js';

export {
  PriceBarSchema,
  MarketQuoteSchema,
  MarketQuotesIngestSchema,
  MarketSnapshotSchema,
  MarketNewsItemSchema,
  MarketNewsIngestSchema,
  MarketBarsIngestSchema,
  ModifyPositionSchema,
  validateMarketBarsIngestDTO,
  validateMarketQuotesIngestDTO,
  validateMarketSnapshotIngestDTO,
  validateMarketNewsIngestDTO,
  validateModifyPositionDTO
} from '../market-ingest/index.js';
