/**
 * Models Index
 * Central export point for all domain models and DTOs
 */

// Base model
export { BaseModel } from './base-model.js';

// Domain models
export { TradingSignal } from './trading-signal.js';
export { Trade } from './trade.js';
export {
  TechnicalAnalysisResult,
  EconomicAnalysisResult,
  NewsAnalysisResult
} from './analysis-result.js';

// Factory
export { ModelFactory } from './model-factory.js';

// DTOs and schemas (backward compatibility)
export {
  TradingSignalSchema,
  TradeSchema,
  EconomicAnalysisSchema,
  NewsAnalysisSchema,
  createTradingSignalDTO,
  createTradeDTO,
  normalizeEconomicAnalysis,
  normalizeNewsAnalysis,
  normalizeTechnicalAnalysis,
  validateTradingSignalDTO,
  validateTradeDTO,
  validateEconomicAnalysisDTO,
  validateNewsAnalysisDTO,
  validateTechnicalAnalysisDTO
} from './dtos.js';

// Re-export default instances for convenience
export { default as TradingSignalModel } from './trading-signal.js';
export { default as TradeModel } from './trade.js';
export { default as ModelFactoryInstance } from './model-factory.js';
