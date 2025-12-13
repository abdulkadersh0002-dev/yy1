/**
 * Model Factory
 * Centralized factory for creating and converting domain models
 */

import TradingSignal from './trading-signal.js';
import Trade from './trade.js';
import {
  TechnicalAnalysisResult,
  EconomicAnalysisResult,
  NewsAnalysisResult
} from './analysis-result.js';

/**
 * Model Factory for creating domain models from raw data
 */
class ModelFactory {
  /**
   * Create a TradingSignal from raw data
   * @param {Object} rawData - Raw signal data
   * @returns {TradingSignal} Trading signal instance
   */
  static createTradingSignal(rawData) {
    return new TradingSignal(rawData);
  }

  /**
   * Create a Trade from raw data
   * @param {Object} rawData - Raw trade data
   * @returns {Trade} Trade instance
   */
  static createTrade(rawData) {
    // Convert date strings to Date objects if needed
    if (rawData.openTime && !(rawData.openTime instanceof Date)) {
      rawData.openTime = new Date(rawData.openTime);
    }
    if (rawData.closeTime && !(rawData.closeTime instanceof Date)) {
      rawData.closeTime = new Date(rawData.closeTime);
    }

    return new Trade(rawData);
  }

  /**
   * Create a TechnicalAnalysisResult from raw data
   * @param {Object} rawData - Raw analysis data
   * @returns {TechnicalAnalysisResult} Technical analysis instance
   */
  static createTechnicalAnalysis(rawData) {
    return new TechnicalAnalysisResult(rawData);
  }

  /**
   * Create an EconomicAnalysisResult from raw data
   * @param {Object} rawData - Raw analysis data
   * @returns {EconomicAnalysisResult} Economic analysis instance
   */
  static createEconomicAnalysis(rawData) {
    return new EconomicAnalysisResult(rawData);
  }

  /**
   * Create a NewsAnalysisResult from raw data
   * @param {Object} rawData - Raw analysis data
   * @returns {NewsAnalysisResult} News analysis instance
   */
  static createNewsAnalysis(rawData) {
    return new NewsAnalysisResult(rawData);
  }

  /**
   * Batch create multiple trading signals
   * @param {Array<Object>} dataArray - Array of raw signal data
   * @returns {Array<TradingSignal>} Array of trading signal instances
   */
  static createTradingSignals(dataArray) {
    return dataArray.map((data) => this.createTradingSignal(data));
  }

  /**
   * Batch create multiple trades
   * @param {Array<Object>} dataArray - Array of raw trade data
   * @returns {Array<Trade>} Array of trade instances
   */
  static createTrades(dataArray) {
    return dataArray.map((data) => this.createTrade(data));
  }

  /**
   * Convert a trading signal to a DTO-compatible plain object
   * @param {TradingSignal} signal - Trading signal instance
   * @returns {Object} Plain object
   */
  static signalToDTO(signal) {
    return signal.toObject();
  }

  /**
   * Convert a trade to a DTO-compatible plain object
   * @param {Trade} trade - Trade instance
   * @returns {Object} Plain object
   */
  static tradeToDTO(trade) {
    return trade.toObject();
  }

  /**
   * Validate and create a trading signal
   * @param {Object} rawData - Raw signal data
   * @returns {Object} Result with signal or errors
   */
  static createAndValidateSignal(rawData) {
    const signal = this.createTradingSignal(rawData);

    if (!signal.validate()) {
      return {
        success: false,
        errors: signal.getErrors(),
        signal: null
      };
    }

    return {
      success: true,
      errors: [],
      signal
    };
  }

  /**
   * Validate and create a trade
   * @param {Object} rawData - Raw trade data
   * @returns {Object} Result with trade or errors
   */
  static createAndValidateTrade(rawData) {
    const trade = this.createTrade(rawData);

    if (!trade.validate()) {
      return {
        success: false,
        errors: trade.getErrors(),
        trade: null
      };
    }

    return {
      success: true,
      errors: [],
      trade
    };
  }

  /**
   * Create a composite analysis result
   * @param {Object} rawTechnical - Raw technical analysis
   * @param {Object} rawEconomic - Raw economic analysis
   * @param {Object} rawNews - Raw news analysis
   * @returns {Object} Composite analysis with all models
   */
  static createCompositeAnalysis(rawTechnical, rawEconomic, rawNews) {
    return {
      technical: rawTechnical ? this.createTechnicalAnalysis(rawTechnical) : null,
      economic: rawEconomic ? this.createEconomicAnalysis(rawEconomic) : null,
      news: rawNews ? this.createNewsAnalysis(rawNews) : null,
      timestamp: Date.now()
    };
  }

  /**
   * Convert any model to a plain object
   * @param {BaseModel} model - Model instance
   * @returns {Object} Plain object
   */
  static toPlainObject(model) {
    if (!model || typeof model.toObject !== 'function') {
      return model;
    }
    return model.toObject();
  }

  /**
   * Convert any model to JSON
   * @param {BaseModel} model - Model instance
   * @returns {string} JSON string
   */
  static toJSON(model) {
    if (!model || typeof model.toJSON !== 'function') {
      return JSON.stringify(model);
    }
    return model.toJSON();
  }
}

export { ModelFactory };
export default ModelFactory;
