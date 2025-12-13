/**
 * Configuration Validator
 * Validates application configuration with comprehensive schemas
 */

import { z } from 'zod';

/**
 * Server Configuration Schema
 */
const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(4101),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  corsOrigin: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  rateLimit: z
    .object({
      windowMs: z.number().int().positive(),
      max: z.number().int().positive()
    })
    .optional(),
  providerAvailabilityHistoryLimit: z.number().int().positive().optional(),
  providerAvailabilityAlert: z.record(z.any()).optional()
});

/**
 * Trading Configuration Schema
 */
const TradingConfigSchema = z.object({
  minSignalStrength: z.number().min(0).max(100).default(35),
  riskPerTrade: z.number().min(0).max(1).default(0.02),
  maxDailyRisk: z.number().min(0).max(1).default(0.06),
  maxConcurrentTrades: z.number().int().positive().default(5),
  signalAmplifier: z.number().positive().default(2.5),
  directionThreshold: z.number().min(0).default(12),
  accountBalance: z.number().positive().default(10000),
  maxKellyFraction: z.number().min(0).max(1).optional(),
  minKellyFraction: z.number().min(0).max(1).optional(),
  volatilityRiskMultipliers: z
    .object({
      calm: z.number().positive(),
      normal: z.number().positive(),
      volatile: z.number().positive(),
      extreme: z.number().positive()
    })
    .optional(),
  correlationPenalty: z
    .object({
      samePair: z.number().min(0).max(1),
      sharedCurrency: z.number().min(0).max(1)
    })
    .optional(),
  maxExposurePerCurrency: z.number().positive().optional(),
  apiKeys: z
    .object({
      twelveData: z.string().optional(),
      alphaVantage: z.string().optional(),
      finnhub: z.string().optional(),
      polygon: z.string().optional(),
      newsApi: z.string().optional(),
      fred: z.string().optional(),
      openai: z.string().optional()
    })
    .optional()
});

/**
 * Broker Configuration Schema
 */
const BrokerConfigSchema = z.object({
  oanda: z
    .object({
      enabled: z.boolean(),
      accountMode: z.enum(['demo', 'live']).optional(),
      accessToken: z.string().optional(),
      accountId: z.string().optional()
    })
    .optional(),
  mt4: z
    .object({
      enabled: z.boolean(),
      accountMode: z.enum(['demo', 'live']).optional(),
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      accountNumber: z.string().optional()
    })
    .optional(),
  mt5: z
    .object({
      enabled: z.boolean(),
      accountMode: z.enum(['demo', 'live']).optional(),
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      accountNumber: z.string().optional()
    })
    .optional(),
  ibkr: z
    .object({
      enabled: z.boolean(),
      accountMode: z.enum(['demo', 'live']).optional(),
      baseUrl: z.string().url().optional(),
      accountId: z.string().optional(),
      allowSelfSigned: z.boolean().optional()
    })
    .optional()
});

/**
 * Database Configuration Schema
 */
const DatabaseConfigSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().positive().default(5432),
  name: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  maxConnections: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().positive().optional()
});

/**
 * Service Toggles Schema
 */
const ServiceTogglesSchema = z.object({
  riskReports: z
    .object({
      enabled: z.boolean(),
      reportHourUtc: z.number().int().min(0).max(23).optional()
    })
    .optional(),
  performanceDigests: z
    .object({
      enabled: z.boolean(),
      reportHourUtc: z.number().int().min(0).max(23).optional(),
      outputDir: z.string().optional(),
      includePdf: z.boolean().optional()
    })
    .optional(),
  brokerReconciliation: z
    .object({
      enabled: z.boolean(),
      intervalMs: z.number().int().positive().optional()
    })
    .optional()
});

/**
 * Configuration Validator
 */
class ConfigValidator {
  /**
   * Validate server configuration
   * @param {Object} config - Server configuration
   * @returns {Object} Validation result
   */
  static validateServerConfig(config) {
    try {
      const validated = ServerConfigSchema.parse(config);
      return { valid: true, config: validated, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          config: null,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        };
      }
      return { valid: false, config: null, errors: [{ message: error.message }] };
    }
  }

  /**
   * Validate trading configuration
   * @param {Object} config - Trading configuration
   * @returns {Object} Validation result
   */
  static validateTradingConfig(config) {
    try {
      const validated = TradingConfigSchema.parse(config);
      return { valid: true, config: validated, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          config: null,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        };
      }
      return { valid: false, config: null, errors: [{ message: error.message }] };
    }
  }

  /**
   * Validate broker configuration
   * @param {Object} config - Broker configuration
   * @returns {Object} Validation result
   */
  static validateBrokerConfig(config) {
    try {
      const validated = BrokerConfigSchema.parse(config);
      return { valid: true, config: validated, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          config: null,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        };
      }
      return { valid: false, config: null, errors: [{ message: error.message }] };
    }
  }

  /**
   * Validate database configuration
   * @param {Object} config - Database configuration
   * @returns {Object} Validation result
   */
  static validateDatabaseConfig(config) {
    try {
      const validated = DatabaseConfigSchema.parse(config);
      return { valid: true, config: validated, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          config: null,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        };
      }
      return { valid: false, config: null, errors: [{ message: error.message }] };
    }
  }

  /**
   * Validate service toggles configuration
   * @param {Object} config - Service toggles configuration
   * @returns {Object} Validation result
   */
  static validateServiceToggles(config) {
    try {
      const validated = ServiceTogglesSchema.parse(config);
      return { valid: true, config: validated, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          config: null,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        };
      }
      return { valid: false, config: null, errors: [{ message: error.message }] };
    }
  }

  /**
   * Validate all configuration sections
   * @param {Object} fullConfig - Complete application configuration
   * @returns {Object} Validation result with all sections
   */
  static validateAllConfig(fullConfig) {
    const results = {
      valid: true,
      sections: {}
    };

    if (fullConfig.server) {
      results.sections.server = this.validateServerConfig(fullConfig.server);
      if (!results.sections.server.valid) {
        results.valid = false;
      }
    }

    if (fullConfig.trading) {
      results.sections.trading = this.validateTradingConfig(fullConfig.trading);
      if (!results.sections.trading.valid) {
        results.valid = false;
      }
    }

    if (fullConfig.brokers) {
      results.sections.brokers = this.validateBrokerConfig(fullConfig.brokers);
      if (!results.sections.brokers.valid) {
        results.valid = false;
      }
    }

    if (fullConfig.database) {
      results.sections.database = this.validateDatabaseConfig(fullConfig.database);
      if (!results.sections.database.valid) {
        results.valid = false;
      }
    }

    if (fullConfig.services) {
      results.sections.services = this.validateServiceToggles(fullConfig.services);
      if (!results.sections.services.valid) {
        results.valid = false;
      }
    }

    return results;
  }

  /**
   * Get all validation errors from a validation result
   * @param {Object} validationResult - Result from validateAllConfig
   * @returns {Array} Array of all errors
   */
  static getAllErrors(validationResult) {
    const allErrors = [];

    Object.entries(validationResult.sections || {}).forEach(([section, result]) => {
      if (!result.valid && result.errors) {
        result.errors.forEach((error) => {
          allErrors.push({
            section,
            ...error
          });
        });
      }
    });

    return allErrors;
  }
}

export { ConfigValidator };
export default ConfigValidator;
