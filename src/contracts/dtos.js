/**
 * Data Transfer Objects (DTOs) - Consolidated Export
 * 
 * Canonical import path for all DTOs in the system.
 * Use: import { TradingSignalSchema, TradeSchema, ... } from 'src/contracts/dtos.js';
 */

// Trading Signal DTOs
export {
  TradingSignalSchema,
  createTradingSignalDTO,
  validateTradingSignalDTO
} from './dtos/schemas/trading-signal.dto.js';

// Trade DTOs
export { 
  TradeSchema, 
  createTradeDTO, 
  validateTradeDTO 
} from './dtos/schemas/trade.dto.js';

// Analysis DTOs
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
} from './dtos/schemas/analysis.dto.js';

// Market Ingest DTOs
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
} from './dtos/schemas/market-ingest.dto.js';
