/**
 * Configuration Validator
 *
 * Validates all application configuration at startup to fail fast with clear error messages.
 * This prevents runtime errors due to misconfiguration and improves developer experience.
 *
 * @module infrastructure/config/config-validator
 */

import { AppError } from '../middleware/error-handler.js';

/**
 * Validation result
 * @typedef {Object} ValidationResult
 * @property {boolean} isValid - Whether validation passed
 * @property {Array<string>} errors - List of validation errors
 * @property {Array<string>} warnings - List of validation warnings
 */

/**
 * Configuration validator class
 */
export class ConfigValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Validate all configuration
   * @param {Object} env - Environment variables (process.env)
   * @returns {ValidationResult}
   */
  validate(env = process.env) {
    this.errors = [];
    this.warnings = [];

    // Server configuration
    this.validateServer(env);

    // Database configuration
    this.validateDatabase(env);

    // Trading configuration
    this.validateTrading(env);

    // Broker configuration
    this.validateBrokers(env);

    // Security configuration
    this.validateSecurity(env);

    // Performance configuration
    this.validatePerformance(env);

    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  /**
   * Validate server configuration
   */
  validateServer(env) {
    // Port
    this.validateNumber(env.PORT, 'PORT', {
      min: 1,
      max: 65535,
      default: 4101,
    });

    // Node environment
    const nodeEnv = env.NODE_ENV || 'development';
    const validEnvs = ['development', 'production', 'test'];
    if (!validEnvs.includes(nodeEnv)) {
      this.warnings.push(
        `NODE_ENV="${nodeEnv}" is not standard. Expected: ${validEnvs.join(', ')}`
      );
    }

    // Request JSON limit
    if (env.REQUEST_JSON_LIMIT) {
      const limit = env.REQUEST_JSON_LIMIT;
      if (!/^\d+(mb|kb|b)$/i.test(limit)) {
        this.errors.push(
          `REQUEST_JSON_LIMIT="${limit}" invalid format. Expected: number + unit (e.g., "1mb")`
        );
      }
    }

    // Port fallback
    if (env.ENABLE_PORT_FALLBACK === 'true') {
      this.validateNumber(env.PORT_FALLBACK_ATTEMPTS, 'PORT_FALLBACK_ATTEMPTS', {
        min: 1,
        max: 100,
        default: 10,
      });
    }
  }

  /**
   * Validate database configuration
   */
  validateDatabase(env) {
    // Database URL (if using connection string)
    if (env.DATABASE_URL) {
      if (
        !env.DATABASE_URL.startsWith('postgres://') &&
        !env.DATABASE_URL.startsWith('postgresql://')
      ) {
        this.errors.push('DATABASE_URL must start with postgres:// or postgresql://');
      }
    }

    // Individual database settings
    if (!env.DATABASE_URL) {
      if (!env.DB_HOST) {
        this.warnings.push('DB_HOST not set, database connections may fail');
      }
      if (!env.DB_NAME) {
        this.warnings.push('DB_NAME not set, database connections may fail');
      }
    }

    // Connection pool
    this.validateNumber(env.DB_POOL_MAX, 'DB_POOL_MAX', { min: 1, max: 1000 });
    this.validateNumber(env.DB_POOL_MIN, 'DB_POOL_MIN', { min: 0, max: 100 });
    this.validateNumber(env.DB_POOL_IDLE_TIMEOUT_MS, 'DB_POOL_IDLE_TIMEOUT_MS', { min: 0 });
    this.validateNumber(env.DB_POOL_ACQUIRE_TIMEOUT_MS, 'DB_POOL_ACQUIRE_TIMEOUT_MS', { min: 0 });
  }

  /**
   * Validate trading configuration
   */
  validateTrading(env) {
    // Trading scope
    if (env.TRADING_SCOPE) {
      const validScopes = ['signals', 'execution', 'autonomous'];
      if (!validScopes.includes(env.TRADING_SCOPE)) {
        this.errors.push(
          `TRADING_SCOPE="${env.TRADING_SCOPE}" invalid. Expected: ${validScopes.join(', ')}`
        );
      }
    }

    // Auto trading parameters
    if (env.AUTO_TRADING_ENABLED === 'true' || env.EA_ONLY_MODE === 'true') {
      // Min confidence
      this.validateNumber(env.AUTO_TRADING_MIN_CONFIDENCE, 'AUTO_TRADING_MIN_CONFIDENCE', {
        min: 0,
        max: 100,
      });

      // Min strength
      this.validateNumber(env.AUTO_TRADING_MIN_STRENGTH, 'AUTO_TRADING_MIN_STRENGTH', {
        min: 0,
        max: 100,
      });

      // Risk/reward ratio
      this.validateNumber(env.AUTO_TRADING_MIN_RR, 'AUTO_TRADING_MIN_RR', { min: 0, max: 10 });

      // Max concurrent trades
      this.validateNumber(
        env.AUTO_TRADING_MAX_CONCURRENT_TRADES,
        'AUTO_TRADING_MAX_CONCURRENT_TRADES',
        {
          min: 1,
          max: 100,
        }
      );

      // Position size limits
      this.validateNumber(env.AUTO_TRADING_MAX_POSITION_SIZE, 'AUTO_TRADING_MAX_POSITION_SIZE', {
        min: 0.01,
      });

      // Spread limits
      this.validateNumber(
        env.SIGNAL_FILTER_MAX_SPREAD_PIPS_FX,
        'SIGNAL_FILTER_MAX_SPREAD_PIPS_FX',
        {
          min: 0,
        }
      );

      this.validateNumber(
        env.SIGNAL_FILTER_MAX_SPREAD_PIPS_METALS,
        'SIGNAL_FILTER_MAX_SPREAD_PIPS_METALS',
        {
          min: 0,
        }
      );

      // News blackout
      this.validateNumber(
        env.AUTO_TRADING_NEWS_BLACKOUT_MINUTES,
        'AUTO_TRADING_NEWS_BLACKOUT_MINUTES',
        {
          min: 0,
          max: 180,
        }
      );

      this.validateNumber(
        env.AUTO_TRADING_NEWS_BLACKOUT_IMPACT,
        'AUTO_TRADING_NEWS_BLACKOUT_IMPACT',
        {
          min: 0,
          max: 100,
        }
      );
    }
  }

  /**
   * Validate broker configuration
   */
  validateBrokers(env) {
    // Check at least one broker is configured
    const hasMT4 = env.MT4_ENABLED === 'true';
    const hasMT5 = env.MT5_ENABLED === 'true';
    const hasOANDA = !!env.OANDA_API_KEY;
    const hasIBKR = env.IBKR_ENABLED === 'true';

    if (!hasMT4 && !hasMT5 && !hasOANDA && !hasIBKR && env.EA_ONLY_MODE !== 'true') {
      this.warnings.push(
        'No broker configured. Set MT4_ENABLED, MT5_ENABLED, OANDA_API_KEY, or IBKR_ENABLED'
      );
    }

    // OANDA configuration
    if (hasOANDA) {
      if (!env.OANDA_ACCOUNT_ID) {
        this.errors.push('OANDA_API_KEY set but OANDA_ACCOUNT_ID missing');
      }
      if (env.OANDA_ENVIRONMENT && !['practice', 'live'].includes(env.OANDA_ENVIRONMENT)) {
        this.errors.push('OANDA_ENVIRONMENT must be "practice" or "live"');
      }
    }

    // MT4/MT5 validation
    if (hasMT4 || hasMT5) {
      const brokerType = hasMT4 ? 'MT4' : 'MT5';
      if (!env[`${brokerType}_SERVER`]) {
        this.warnings.push(`${brokerType}_ENABLED=true but ${brokerType}_SERVER not set`);
      }
      if (!env[`${brokerType}_LOGIN`]) {
        this.warnings.push(`${brokerType}_ENABLED=true but ${brokerType}_LOGIN not set`);
      }
    }
  }

  /**
   * Validate security configuration
   */
  validateSecurity(env) {
    // CORS
    if (env.CORS_ALLOWED_ORIGINS) {
      const origins = env.CORS_ALLOWED_ORIGINS.split(',');
      for (const origin of origins) {
        if (origin.trim() && !this.isValidUrl(origin.trim()) && origin.trim() !== '*') {
          this.errors.push(`Invalid CORS origin: "${origin.trim()}"`);
        }
      }
    }

    // Production checks
    if (env.NODE_ENV === 'production') {
      if (!env.JWT_SECRET) {
        this.errors.push('JWT_SECRET required in production');
      } else if (env.JWT_SECRET.length < 32) {
        this.errors.push('JWT_SECRET must be at least 32 characters in production');
      }

      if (env.CORS_ALLOWED_ORIGINS === '*') {
        this.warnings.push('CORS_ALLOWED_ORIGINS="*" is not recommended in production');
      }

      if (env.ENABLE_DEBUG_ROUTES === 'true') {
        this.warnings.push('ENABLE_DEBUG_ROUTES=true not recommended in production');
      }
    }

    // Rate limiting
    this.validateNumber(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', { min: 1000 });
    this.validateNumber(env.RATE_LIMIT_MAX_REQUESTS, 'RATE_LIMIT_MAX_REQUESTS', { min: 1 });
  }

  /**
   * Validate performance configuration
   */
  validatePerformance(env) {
    // Job queue
    if (env.ENABLE_JOB_QUEUE === 'true') {
      this.validateNumber(env.JOB_QUEUE_CONCURRENCY, 'JOB_QUEUE_CONCURRENCY', {
        min: 1,
        max: 100,
      });
      this.validateNumber(env.JOB_QUEUE_MAX_SIZE, 'JOB_QUEUE_MAX_SIZE', { min: 1 });
      this.validateNumber(env.JOB_QUEUE_RETRY_ATTEMPTS, 'JOB_QUEUE_RETRY_ATTEMPTS', {
        min: 0,
        max: 10,
      });
    }

    // WebSocket
    if (env.ENABLE_WEBSOCKETS === 'true') {
      this.validateNumber(env.WS_MAX_BUFFERED_BYTES, 'WS_MAX_BUFFERED_BYTES', {
        min: 64 * 1024,
        max: 100 * 1024 * 1024,
      });
    }

    // Cache settings
    this.validateNumber(env.CACHE_TTL_MS, 'CACHE_TTL_MS', { min: 0 });
    this.validateNumber(env.CACHE_MAX_SIZE, 'CACHE_MAX_SIZE', { min: 1 });
  }

  /**
   * Validate a number configuration value
   */
  validateNumber(value, name, options = {}) {
    if (value === undefined || value === null || value === '') {
      if (options.required) {
        this.errors.push(`${name} is required`);
      }
      return options.default;
    }

    const num = Number(value);
    if (!Number.isFinite(num)) {
      this.errors.push(`${name}="${value}" is not a valid number`);
      return options.default;
    }

    if (options.min !== undefined && num < options.min) {
      this.errors.push(`${name}=${num} is below minimum ${options.min}`);
    }

    if (options.max !== undefined && num > options.max) {
      this.errors.push(`${name}=${num} exceeds maximum ${options.max}`);
    }

    if (options.integer && !Number.isInteger(num)) {
      this.errors.push(`${name}=${num} must be an integer`);
    }

    return num;
  }

  /**
   * Check if string is valid URL
   */
  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate and throw if invalid
   * @param {Object} env - Environment variables
   * @throws {AppError} If validation fails
   */
  static validateOrThrow(env = process.env) {
    const validator = new ConfigValidator();
    const result = validator.validate(env);

    // Log warnings
    if (result.warnings.length > 0) {
      console.warn('\n⚠️  Configuration Warnings:');
      result.warnings.forEach((warning) => {
        console.warn(`  - ${warning}`);
      });
      console.warn('');
    }

    // Throw on errors
    if (!result.isValid) {
      const errorMessage = `Configuration validation failed:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`;
      throw new AppError(errorMessage, 'VALIDATION_ERROR', 500);
    }

    console.log('✅ Configuration validation passed');
    return result;
  }

  /**
   * Get configuration summary
   * @param {Object} env - Environment variables
   * @returns {Object} Configuration summary
   */
  static getSummary(env = process.env) {
    return {
      server: {
        nodeEnv: env.NODE_ENV || 'development',
        port: env.PORT || 4101,
        enableWebsockets: env.ENABLE_WEBSOCKETS === 'true',
      },
      trading: {
        scope: env.TRADING_SCOPE || 'signals',
        eaOnlyMode: env.EA_ONLY_MODE === 'true',
        autoTradingEnabled: env.AUTO_TRADING_ENABLED === 'true',
      },
      brokers: {
        mt4: env.MT4_ENABLED === 'true',
        mt5: env.MT5_ENABLED === 'true',
        oanda: !!env.OANDA_API_KEY,
        ibkr: env.IBKR_ENABLED === 'true',
      },
      features: {
        jobQueue: env.ENABLE_JOB_QUEUE === 'true',
        dashboard: env.SERVE_DASHBOARD === 'true',
        advancedFilter: env.ADVANCED_SIGNAL_FILTER_ENABLED === 'true',
      },
    };
  }
}

export default ConfigValidator;
